'use strict';
/* The Work loop, in one place: the order things must happen in, and the reasons they must.
 *
 * `12` and `15` SC-02 fix the sequence before a Work exists, and each step can refuse:
 *   1. Claude Code available?      → 사용 불가 card (WBS-09)   — reason, and remaining paths
 *   2. no other Work running?      → guard card (WBS-07)       — text kept, never queued
 *   3. can a before-basis be built? → 확립 불가 card (WBS-08)  — the Work does not start
 *   4. session starts and emits?   → legacy Work stays transient; Task Run is durable before spawn
 * Existing unlinked Work keeps the old Canon behavior. A Task Run is a first-class attempt and
 * is durably reserved before spawn so even a failed start has an honest Run ID and outcome.
 *
 * Nothing here decides a state on a timer or on an exit code. Every transition comes from a
 * signal, and every signal is persisted before it is interpreted.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const repo = require('../db/repo');
const claude = require('../claude-detect');
const session = require('../claude/session');
const { scopedRetryTools, summarizeRun } = require('../provider/claude-contract');
const gitEvidence = require('../evidence/git');
const manifest = require('../evidence/manifest');
const { toSignal, reduce, initial, openPermission, openPermissions, KIND } = require('./reducer');
const resultBuilder = require('./result');
const { testEvidenceFromSignals } = require('./run-evidence');
const blocks = require('../change/blocks');
const explain = require('../change/explain');
const exclude = require('../evidence/exclude');
const { buildContextBundle, safeSnapshot, safeStructuredSnapshot, redactionRules, redactionLocations } = require('./context');
const { unknownTaskRunWithLiveRunner } = require('./runner-liveness');

/** Live state for Works this process started. Nothing here is authoritative — the DB is. */
const live = new Map();   // workId -> { child, state, sessionId, cwd, projectId }

/**
 * Projects with a start in flight.
 *
 * `preflight`'s `activeWork` read is advisory; the engine's real guard is `beginWork`'s insert,
 * which happens only once the session speaks. Two submits could both pass preflight, both
 * capture a basis and both SPAWN — the loser got the guard card, but its process kept running
 * untracked, unstoppable, and its writes were folded into the winner's after-basis and reported
 * as the winner's changes. D-117 has to hold from the moment we decide to start.
 */
const starting = new Set();   // projectId
/* One retry at a time per Work: two concurrent allows ran two `--resume` sessions on the same
 * session id, and only one child ended up in `entry.child` — the other was orphaned and could
 * not be cancelled. */
const retrying = new Set();   // workId

const now = () => new Date().toISOString();

/* `15` SC-03 names 2분 for 새 신호 없음 and 90초 for 취소 확인 불가. They are thresholds on
 * OBSERVED silence, which is a fact about us, not a judgement about the Work. */
/* `15` names the two numbers and they are the defaults. The override exists so a test can
 * REACH the states — 새 신호 없음 and 취소 확인 불가 are defined by elapsed silence, and a run
 * that had to wait two real minutes for each would never photograph either. Same convention as
 * `JUQODE_CLAUDE_TIMEOUT_MS`; `tests/loop.test.js` pins the defaults so an override cannot
 * quietly become the product's answer. */
const QUIET_MS = Number(process.env.JUQODE_QUIET_MS) || 2 * 60 * 1000;
const CANCEL_CONFIRM_MS = Number(process.env.JUQODE_CANCEL_CONFIRM_MS) || 90 * 1000;

const sinceMs = (iso) => (iso ? Date.now() - new Date(iso).getTime() : 0);

/**
 * @returns {'live'|'quiet'|'unknown'} `quiet` = nothing new for a while and we still have the
 * process; `unknown` = we cannot tell, which `15` draws dashed and calls not-a-failure.
 */
function livenessOf(state, work) {
  if (!work || work.status === 'ended') return 'live';
  if (!state.lastObserved?.at) return 'unknown';
  return sinceMs(state.lastObserved.at) > QUIET_MS ? 'quiet' : 'live';
}

/**
 * Everything that must be true before a Work can start, checked in Canon's order.
 * @returns {{ok:true, useGit:boolean, evidenceStore:string} | {ok:false, reason:string, detail?:any}}
 */
async function preflight(db, project, { evidenceStore, detect = claude.detect, taskId = null,
  retryOfWorkId = null, allowUnknownWorkId = null }) {
  const uncertain = unknownTaskRunWithLiveRunner(db, project.id, allowUnknownWorkId);
  if (uncertain) return { ok: false, reason: 'prior-process-may-still-live', detail: { workId: uncertain.id } };
  const taskRefusal = repo.taskRunRefusal(db, project.id, taskId, { retryOfWorkId });
  if (taskRefusal) return { ok: false, reason: taskRefusal };
  const status = await detect();
  if (!status.available) return { ok: false, reason: 'claude-unavailable', detail: status };

  const active = repo.activeWork(db, project.id);
  if (active) return { ok: false, reason: 'active-work', detail: active };

  /* Task Run evidence stores path/hash manifests only. The legacy Work path retains its
   * existing Git object/diff behavior. */
  const useGit = !taskId && gitEvidence.isGitRepo(project.path);
  if (useGit) {
    const refused = gitEvidence.refusal(project.path);
    if (refused) return { ok: false, reason: 'evidence-blocked', detail: refused };
  }
  return { ok: true, useGit, evidenceStore };
}

/** Take the before-basis. Separated so a failure here is 확립 불가, not a half-started Work. */
function captureBasis(project, store, phase, useGit) {
  if (useGit) return gitEvidence.capture(project.path, store, phase);
  const m = manifest.capture(project.path);
  if (m.error) throw Object.assign(new Error(m.error), { code: m.error, detail: m.detail });
  if (Buffer.byteLength(JSON.stringify(m.files), 'utf8') > 16 * 1024 * 1024) {
    throw Object.assign(new Error('manifest snapshot is too large to persist'), { code: 'manifest-too-large' });
  }
  return m;
}

/**
 * Start a Work. Resolves as soon as the session has produced its first event (or failed to),
 * because that is the moment `15` navigates to SC-03. The session keeps running after.
 */
async function start(db, project, intent, opts = {}) {
  const {
    evidenceStore, onUpdate = () => {}, bin, detect, taskId = null,
    idempotencyKey = null, attempt = 1, retryOfWorkId = null, retryReason = null, appSessionId = null,
    allowUnknownWorkId = null, executionMode,
  } = opts;
  void session.prewarmIdentity(bin);      // background hash only: not awaited, so start()'s synchronous reservation order is untouched

  if (retryOfWorkId) {
    const prior = repo.getWork(db, retryOfWorkId);
    if (prior?.project_id === project.id && prior.task_id === taskId && prior.status === 'ended') {
      const successor = repo.workForRetrySource(db, retryOfWorkId);
      if (successor) return { ok: true, workId: successor.id, existing: true,
        done: Promise.resolve({ ok: true, workId: successor.id }) };
    }
  }

  if (idempotencyKey) {
    const existing = repo.workForIdempotency(db, project.id, idempotencyKey);
    if (existing) return existing.task_id === taskId
      ? { ok: true, workId: existing.id, existing: true, done: Promise.resolve({ ok: true, workId: existing.id }) }
      : { ok: false, reason: 'idempotency-key-conflict' };
  }

  if (starting.has(project.id)) return { ok: false, reason: 'active-work', detail: { starting: true } };
  starting.add(project.id);
  try {
    return await startGuarded(db, project, intent, {
      evidenceStore, onUpdate, bin, detect, taskId, idempotencyKey, attempt, retryOfWorkId, retryReason,
      appSessionId, allowUnknownWorkId, executionMode,
    });
  } finally {
    starting.delete(project.id);
  }
}

async function startGuarded(db, project, intent, {
  evidenceStore, onUpdate, bin, detect, taskId, idempotencyKey, attempt, retryOfWorkId, retryReason,
  appSessionId, allowUnknownWorkId, executionMode,
}) {
  const pre = await preflight(db, project, { evidenceStore, detect, taskId, retryOfWorkId, allowUnknownWorkId });
  if (!pre.ok) return pre;

  let context = null;
  let agentPrompt = intent;
  /* V1-409: what is STORED is masked for EVERY Work, Task or not; `agentPrompt` (what the provider is sent) stays the user's text. */
  const storedIntent = safeSnapshot(intent).safe;
  if (taskId) {
    const task = repo.getTask(db, taskId);
    if (!task) return { ok: false, reason: 'no-task' };
    context = buildContextBundle({ project, task, userPrompt: intent });
    agentPrompt = context.agentPrompt;
  }

  const sessionId = crypto.randomUUID();
  /* Pin the binary: from here on the child is spawned from this absolute path, never from a
   * name that PATH could resolve differently at resume. An executable whose identity cannot be
   * established is refused BEFORE any process exists — falling through to `session.run` would
   * resolve the name through PATH again, which is exactly what the pin exists to prevent. */
  const pin = session.binaryIdentity(bin || claude.resolveBin());
  if (!pin) return { ok: false, reason: 'binary-unverified' };
  bin = pin.launchPath;

  /* The first init is judged ONCE. `initVerdict` is write-once: a wrong first id can never be
   * repaired by a later, correct-looking init, and a later init (a duplicate, or one with another
   * id) revokes an earlier good binding instead of replacing it. Every init line is also
   * persisted verbatim by `persist`, so the anomaly is on the record. */
  let reportedSessionId = null;      // what the FIRST init event said
  let initCount = 0, initVerdict = null, initAnomaly = false;
  /* what the launch preflight established (binary sha256 per fingerprint; version from the process's own init). A later resume must find the same binary. */
  let launchFacts = null; let launchVersion = null;
  const bindEntry = (e) => {
    e.mode = launchFacts?.mode ?? executionMode ?? null;
    e.launchIdentity = launchFacts?.identityVerified ? { path: launchFacts.identity.path, sha256: launchFacts.identity.sha256, version: launchVersion } : null;
    e.initAnomaly = initAnomaly;
    e.binding = initVerdict === 'ok' && !initAnomaly
      ? session.bindSession({ cwd: e.cwd, sessionId: e.sessionId, reportedSessionId, bin: e.bin })
      : null;
  };
  let basis;
  try {
    basis = captureBasis(project, evidenceStore, 'before', pre.useGit);
  } catch (e) {
    return { ok: false, reason: 'evidence-blocked', detail: { reason: e.code || 'capture-failed' } };
  }

  /* Buffer until the first event: `20` forbids a row for a Work that never started, so the
   * signals have nowhere to go until we know there is one. */
  const pending = [];
  const pendingChild = { child: null };
  let justBegan = false;
  let workId = null;
  let runEntry = null;
  let state = initial();
  const reserveRunBeforeSpawn = Boolean(taskId);

  if (reserveRunBeforeSpawn) {
    const begun = repo.beginWork(db, project.id, storedIntent, {
      taskId, status: 'starting', idempotencyKey, attempt, retryOfWorkId,
      retryReason: retryReason == null ? null : safeSnapshot(retryReason).safe, appSessionId,
    });
    if (!begun.ok) return begun;
    workId = begun.work.id;
    repo.saveBasis(db, workId, 'before', basis);
    repo.saveRunContextBundle(db, workId, context);
    runEntry = { state, sessionId, cwd: project.path, projectId: project.id,
      bin, child: null, store: evidenceStore, useGit: pre.useGit };
    live.set(workId, runEntry);
  }

  const persist = (sig, raw, line) => {
    if (!workId) { pending.push({ sig, line }); return; }
    writeSignal(db, workId, { source: 'claude', kind: sig.kind, payload: line });
    apply(db, workId, sig, onUpdate);
  };

  /* `first` resolves at the FIRST event, because that is the moment `15` navigates to SC-03.
   * `done` resolves when the turn actually ends — the screen does not wait for it, but a
   * caller that needs the finished state (a test, a headless run) must be able to. */
  let markDone;
  const done = new Promise((res) => { markDone = res; });
  if (runEntry) runEntry.markDone = markDone;

  const first = new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

    const runP = session.run({
      cwd: project.path, sessionId, prompt: agentPrompt, bin, mode: executionMode,
      onLaunch: (f) => { launchFacts = f; },
      onChild: (c) => {
        pendingChild.child = c;
        pendingChild.spawnedAt = now();
        if (!workId) return;           // no row yet: the identity is stored the moment beginWork creates it (below)
        const at = pendingChild.spawnedAt;
        repo.setRunnerIdentity(db, workId, sessionId, c.pid, at);
        const e = runEntry ?? live.get(workId) ?? { state, sessionId, cwd: project.path, projectId: project.id,
          bin, store: evidenceStore, useGit: pre.useGit };
        runEntry = e;
        e.markDone ??= markDone;
        e.child = c;
        bindEntry(e);
        live.set(workId, e);
        if (!e.cancelRequested) repo.setWorkState(db, workId, { status: 'running' });
        else stopEntryTree(db, workId, e, onUpdate);
        justBegan = true;
        settle({ ok: true, workId, done });
      },
      onSignal: (sig, raw, line) => {
        if (sig.kind === KIND.SESSION_START) {
          initCount += 1;
          const said = typeof sig.payload?.sessionId === 'string' ? sig.payload.sessionId : null;
          if (initCount === 1) {
            launchVersion = typeof raw?.claude_code_version === 'string' && raw.claude_code_version ? raw.claude_code_version : null;
            reportedSessionId = said;
            initVerdict = said !== null && said === sessionId ? 'ok' : 'bad';
          } else {
            initAnomaly = true;
            if (workId) {
              writeSignal(db, workId, { source: 'juqode', kind: KIND.RAW,
                payload: JSON.stringify({ juqodeInitAnomaly: { initCount, reported: said, firstVerdict: initVerdict } }) });
            } else { pending.push({ sig: { kind: KIND.RAW, payload: null }, line: JSON.stringify({ juqodeInitAnomaly: { initCount, reported: said } }) }); }
          }
          if (runEntry) bindEntry(runEntry);
        }
        if (!workId) {
          /* The session spoke, so a Work exists. The guard is re-checked here by the engine
           * itself — `beginWork` inserts, and the partial unique index is the arbiter. */
          const begun = repo.beginWork(db, project.id, storedIntent, { taskId });
          if (!begun.ok) {
            /* We lost the race for the slot. The process we started is ours to stop — leaving
             * it running would put two Claude Code sessions in one repository. */
            if (pendingChild.child) session.stop(pendingChild.child);
            const reason = begun.reason ?? 'active-work';
            settle({ ok: false, reason, detail: begun.active });
            markDone({ ok: false, reason });
            return;
          }
          workId = begun.work.id;
          /* V1-404 · the first child exists BEFORE its Work row does, so the identity the liveness observer judges
           * (pid + the time it was spawned) is written here. Until now only the later resume children were stored. */
          if (pendingChild.child?.pid) repo.setRunnerIdentity(db, workId, sessionId, pendingChild.child.pid, pendingChild.spawnedAt ?? now());
          if (context) repo.saveRunContextBundle(db, workId, context);
          repo.saveBasis(db, workId, 'before', basis);
          runEntry = live.get(workId) ?? { state, sessionId, cwd: project.path, projectId: project.id,
            bin, child: pendingChild.child, store: evidenceStore, useGit: pre.useGit };
          runEntry.markDone ??= markDone;
          runEntry.child = pendingChild.child;
          bindEntry(runEntry);
          live.set(workId, runEntry);
          for (const p of pending) {
            writeSignal(db, workId, { source: 'claude', kind: p.sig.kind, payload: p.line });
            apply(db, workId, p.sig, onUpdate);
          }
          pending.length = 0;
          settle({ ok: true, workId, done });
          justBegan = true;
        }
        persist(sig, raw, line);
        if (justBegan) {
          justBegan = false;
          /* The pid marker goes after the first event is on the record, so the stream begins
           * with what the session actually said rather than with our own bookkeeping.
           * `07` §8.5: a pid alone is not identity — it is reusable — so the start time goes
           * with it, and startup reconciliation compares both before calling a Work lost. */
          if (pendingChild.child?.pid) {
            writeSignal(db, workId, { source: 'juqode', kind: KIND.RAW,
              payload: JSON.stringify({ juqodeProcess: { pid: pendingChild.child.pid, startedAt: now() } }) });
          }
        }
      },
    });

    runP.then((r) => {
      if (runEntry?.cancelFinalized) {
        settle({ ok: true, workId, done });
        markDone({ ok: true, workId, cancelled: true });
        return;
      }
      if (runEntry?.cancelTreeUnknown) {
        settle({ ok: true, workId, done });
        return;
      }
      if (runEntry?.cancelRequested && !runEntry.cancelTreeStopped) {
        /* No owned-child stop observation has arrived yet. Keep the request visible until its
         * timeout records ended_unknown and releases the slot behind an explicit acknowledgement. */
        if (repo.getWork(db, workId)?.status === 'ended') {
          repo.setWorkState(db, workId, { status: 'cancel_requested' });
        }
        onUpdate(snapshot(db, workId));
        settle({ ok: true, workId, done });
        return;
      }
      if (!workId) {
        /* `15` SC-02 시작 실패: a card, and no row. */
        settle({ ok: false, reason: 'start-failed', detail: { code: r.code, stderr: r.stderr } });
        markDone({ ok: false, reason: 'start-failed' });
      } else if (reserveRunBeforeSpawn && !r.sawEvent) {
        /* A Task Run row already exists, so a process that produced no event is a durable failed
         * attempt. Keep stderr out of the database; the stable reason is enough to distinguish
         * this from an Agent-reported failure without persisting arbitrary CLI output. */
        repo.setWorkState(db, workId, { status: 'ended', outcome: 'failed' });
        repo.setRunFailureReason(db, workId, 'agent-start-failed-before-first-event');
        writeSignal(db, workId, { source: 'juqode', kind: KIND.RAW,
          payload: JSON.stringify({ runFailure: 'agent-start-failed-before-first-event' }) });
        captureAfter(db, workId, project, pre.useGit, evidenceStore);
        finishResult(db, workId, project, evidenceStore);
        release(db, workId);
        onUpdate(snapshot(db, workId));
        settle({ ok: true, workId, done });
        markDone({ ok: false, reason: 'start-failed' });
      } else {
        /* WBS-17 · the after-basis, taken when the session's turn ends. It is what makes
         * `변경 n개` a measured number rather than a claim, and it is captured whatever the
         * outcome — a cancelled or failed Work has changes too, and `12` says so. */
        captureAfter(db, workId, project, pre.useGit, evidenceStore);
        finishResult(db, workId, project, evidenceStore);
        /* Only NOW is the live entry released. Dropping it the moment the status changed threw
         * away the state the result is built from — `entryFor` then rebuilt a bare state from
         * the row, and Claude Code's own report vanished from the result it belongs to. */
        release(db, workId);
        onUpdate(snapshot(db, workId));
        markDone({ ok: true, workId });
      }
    });
  });

  return first;
}

/**
 * WBS-17 · after-snapshot. A basis that cannot be taken is recorded as exactly that —
 * `15` SC-03 남은 변경 확인 불가 — never as "nothing changed".
 */
function captureAfter(db, workId, project, useGit, store, { replace = false } = {}) {
  /* `replace` is what a retry needs: the first turn's after-basis describes a project that had
   * not been edited yet, and leaving it in place made `changes()` report `known: true` with an
   * empty file list — "바뀐 파일이 없어요" about a change the user personally approved. */
  if (repo.basisFor(db, workId, 'after')) {
    if (!replace) return null;
    db.prepare('delete from evidence_basis where work_id = ? and phase = ?').run(workId, 'after');
  }
  try {
    const after = captureBasis(project, store, 'after', useGit);
    repo.saveBasis(db, workId, 'after', after);   // carries `files` for a manifest basis
    return after;
  } catch (e) {
    writeSignal(db, workId, { source: 'juqode', kind: KIND.EVIDENCE_GAP,
      payload: { phase: 'after', reason: e.code || 'capture-failed' } });
    return null;
  }
}

/**
 * What actually changed between the two bases. Paths only — the diff content is SC-04's.
 * With no after-basis the answer is "we could not tell", which is not "nothing".
 */
function changes(db, workId, project, store = null) {
  const before = repo.basisFor(db, workId, 'before');
  const after = repo.basisFor(db, workId, 'after');
  if (!before || !after) return { known: false, files: [] };
  if (before.kind === 'git_tree') {
    /* The caller's store path is PREFERRED over the live map, and the map is only the fallback:
     * a finished Work is removed from that map, and History has to answer 변경 n개 for a Work
     * that ended. The caller derives the path from the project, which a restart also can. */
    store = store ?? live.get(workId)?.store;
    if (!store) return { known: false, files: [] };
    try {
      return { known: true, files: gitEvidence.changedPaths(project.path, store, before.ref, after.ref) };
    } catch { return { known: false, files: [] }; }
  }

  /* The non-Git path is comparable too, and it has to be: the header states `시작 전 상태를
   * 기록해 두었어요 ✓ 확인됨`, and a basis that can never produce a before/after answer would
   * make that chip a claim about evidence the product cannot use. */
  const beforeFiles = manifestFiles(db, workId, 'before');
  const afterFiles = manifestFiles(db, workId, 'after');
  if (!beforeFiles || !afterFiles) return { known: false, files: [] };
  return { known: true, files: manifest.diff({ files: beforeFiles }, { files: afterFiles }).map((c) => c.path) };
}

/* Migration 14 makes manifest path/hash lists durable. The repository's in-process fallback
 * supports older rows; if neither source has a snapshot, `known: false` remains the honest answer. */
function manifestFiles(db, workId, phase) {
  const row = repo.basisFor(db, workId, phase);
  if (!row || row.kind !== 'hash_manifest' || !row.files) return null;
  try { return JSON.parse(row.files); } catch { return null; }
}

/**
 * A denial, plus what allowing it would actually grant.
 *
 * `scopable` lets the screen decide before it draws a button. `spec` is the grant STRING —
 * `Edit(src/a.ts)` — and it travels because the card has to name the same thing the flag will:
 * `allowSpec` resolves the model's path against the project (a relative `../../../etc/shadow`
 * resolved into an unrelated tree before it did), so the raw `input.file_path` and the grant
 * can point at one file while READING as two different places. The card showed the raw one.
 */
const withScope = (d, cwd) => {
  const r = session.scopeOf(d, cwd ?? '/');
  return { ...d, scopable: Boolean(r.spec), spec: r.spec ?? null, ...(r.spec ? {} : { scopeRefusal: r.refusal }) };
};

/* One masking rule for what is STORED and for what a row stored by an OLDER build shows when it is read back
 * (`readOnly`: an untouched payload is returned byte for byte, and a hit is marked `at:'read'` so the
 * display copy is auditable). The row itself is never rewritten. */
function maskPayload(payload, { readOnly = false } = {}) {
  let parsed = payload;
  let wasJson = false;
  if (typeof payload === 'string') {
    try { parsed = JSON.parse(payload); wasJson = true; } catch { parsed = payload; }
  }
  const rules = redactionRules(parsed);
  if (!rules.length && readOnly) return payload;
  if (rules.length) {
    const safe = safeStructuredSnapshot(parsed);
    const record = safe && typeof safe === 'object' && !Array.isArray(safe) ? safe : { value: safe };
    record.juqodeRedaction = { applied: true, rules, paths: redactionLocations(parsed).map((item) => item.path), ...(readOnly ? { at: 'read' } : {}) };
    return JSON.stringify(record);
  }
  if (wasJson) return JSON.stringify(safeStructuredSnapshot(parsed));
  if (typeof parsed !== 'string') return safeStructuredSnapshot(parsed);
  return safeSnapshot(parsed).safe;
}

/**
 * ONE authority for `seq`, and a boundary around it.
 *
 * The session's own per-run counter collided with `unique (work_id, seq)` as soon as a retry
 * advanced the sequence and the first child emitted one more line — and it threw inside a
 * stdout handler, which in the main process is an uncaught exception that takes the window
 * down. A stream is exactly where an error must not be fatal: the signal is the thing we may
 * lose, never the app.
 */
function writeSignal(db, workId, { source, kind, payload }) {
  try {
    const persistedPayload = maskPayload(payload);   // masked for EVERY Work (V1-409); shape and event identifiers survive
    repo.addSignal(db, workId, { seq: repo.nextSeq(db, workId), source, kind, payload: persistedPayload, observedAt: now() });
    return true;
  } catch (e) {
    try { repo.addSignal(db, workId, { seq: repo.nextSeq(db, workId), source: 'juqode', kind: KIND.RAW, payload: `signal-write-failed: ${typeof e?.code === 'string' && /^[A-Za-z0-9_.-]{1,48}$/.test(e.code) ? e.code : 'unknown'}` }); }
    catch { /* the store is beyond us; the app stays up */ }
    return false;
  }
}

/**
 * The live entry for a Work, or one rebuilt from the row. Inventing `initial()` — which says
 * `running` — for an unknown id was the mechanism behind two defects at once: a cancel on an
 * ENDED Work resurrected it and erased its outcome, and the reducer's own "an ended Work is
 * ended" guard never saw the real state. The file's header says the DB is authoritative; this
 * is what makes that true.
 */
function entryFor(db, workId) {
  const found = live.get(workId);
  if (found) return found;
  const row = repo.getWork(db, workId);
  if (!row) return null;
  return { state: { ...initial(), status: row.status, outcome: row.outcome }, hydrated: true };
}

/**
 * WBS-18 · write the result once the Work has actually ended. It is built from the evidence
 * pair and the observed signals — never from the exit code, which `07` §8.1 measured as blind
 * to both cancellation and refusal.
 */
function finishResult(db, workId, project, store) {
  const work = repo.getWork(db, workId);
  if (!work || work.status !== 'ended') return null;
  saveDiffs(db, workId, project, store);
  const measuredChanges = changes(db, workId, project, store);
  if (measuredChanges.known) {
    const files = [...measuredChanges.files];
    const digest = crypto.createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex');
    repo.saveRunEvidence(db, workId, {
      kind: 'changed_files', source_ref: `evidence:before→after:${digest.slice(0, 16)}`, observed_at: now(),
      summary: `${files.length} changed file${files.length === 1 ? '' : 's'} measured`,
      content_digest: digest,
      details: { known: true, files },
    });
  }
  const signals = db.prepare('select * from work_signal where work_id = ? order by seq').all(workId);
  for (const evidence of testEvidenceFromSignals(signals)) repo.saveRunEvidence(db, workId, evidence);
  const entry = entryFor(db, workId) ?? { state: initial() };
  /* `saveResult` deletes and reinserts. An EXISTING result is never replaced by one rebuilt from
   * the row. A Work that ended while the app was gone has no result yet, and still gets one. */
  if (entry.hydrated) {
    const written = repo.resultFor(db, workId);
    if (written) return written;
  }
  const { result, problems } = resultBuilder.buildChecked({
    state: { ...entry.state, outcome: work.outcome },
    changes: measuredChanges,
    /* Counted over the WHOLE history and over every block in it — see `countToolResults`. The
     * capped `signalsFor` read was producing a 확인됨 number that undercounted. */
    toolResults: repo.countToolResults(db, workId),
  });
  /* An invariant we broke is a fact about this Work, so it goes on the record rather than into
   * a log the user cannot see. `buildChecked` has already downgraded any sourceless 확인됨 to
   * 확인 못함; a missing 된 것/안 된 것 list it can only REPORT, which is why this is written
   * whatever the problem was. */
  if (problems.length) {
    writeSignal(db, workId, { source: 'juqode', kind: KIND.RAW, payload: JSON.stringify({ resultProblems: problems }) });
  }
  const safeResult = safeStructuredSnapshot(result);
  const rules = redactionRules(result);
  const report = safeResult.claims?.find((claim) => claim.kind === 'agent-report');
  if (rules.length && report?.data) {
    report.data.redacted = true;
    report.data.redactionRules = rules;
  }
  return repo.saveResult(db, workId, safeResult);
}

/**
 * WBS-17 · WBS-27 — the patch, per file, at the fixed `-U3`. Stored so the change reader can
 * be opened later from History without the session or the live map still existing.
 */
function saveDiffs(db, workId, project, store) {
  if (repo.getWork(db, workId)?.task_id) return; // Task Runs persist measured names/hashes, not source patches.
  const before = repo.basisFor(db, workId, 'before');
  const after = repo.basisFor(db, workId, 'after');
  if (!before || !after || before.kind !== 'git_tree' || !store || !project?.path) return;
  let patch, names;
  try {
    patch = gitEvidence.diff(project.path, store, before.ref, after.ref);
    /* The SAME list `changes()` reports. Two parsers reading one patch is how the 확인됨 claim
     * and the change reader came to disagree on every quoted, spaced and renamed path. */
    names = gitEvidence.changedPaths(project.path, store, before.ref, after.ref);
  } catch { return; }

  /* The two git calls must describe the same patch. If they ever disagree on how many files
   * there are, zipping them BY INDEX would file one file's diff under another's name — so the
   * name list is dropped and the header is used, which is wrong for exotic paths but never
   * wrong about WHICH change belongs to WHICH file. */
  const zipped = blocks.splitDiff(patch, names);
  const files = zipped.length === names.length ? zipped : blocks.splitDiff(patch);

  /* Rows for files this Work no longer changes are removed FIRST — a retry that reverted a file
   * used to leave its diff on SC-04 for good, disagreeing with `changes()`, which reads git. */
  repo.pruneDiffs(db, workId, files.map((f) => f.path), store);

  for (const file of files) {
    repo.saveDiff(db, workId, {
      file: file.path,
      patch: file.lines.join('\n'),
      displayable: !file.binary,
    }, store);
  }
}

/**
 * WBS-28 · everything SC-04 needs for one Work, in one read.
 *
 * The change groups are the spine (`19` §C5-X), and each one carries the diffs it cites with
 * their code blocks already derived. A Work whose explanation pass has not run — or never will,
 * because it refused — still reads: `groupsFrom(null, …)` produces exactly one 설명 못함 group
 * holding every change, so `21` WBS-28's "Code Block 없음 → Raw 로만 도달 가능" is the DEFAULT
 * shape rather than a special case that has to be remembered.
 */
function readerFor(db, workId, project, store) {
  const diffs = repo.diffsFor(db, workId);
  if (!diffs.length) {
    /* NO stored patch is not the same fact as NO CHANGE, and SC-04's empty state is a 확인됨
     * claim. Only a git basis produces a patch, so a non-Git project — or a Work whose diff
     * could not be rendered — used to reach the sentence `이 작업은 프로젝트 파일을 바꾸지
     * 않았어요` while SC-03, one click earlier, said 변경 3개. `12` has a state for "we could
     * not tell" (UF-REMAIN-UNKNOWN) and none for telling the user the opposite. */
    const changed = changes(db, workId, project, store);
    if (changed.known && changed.files.length === 0) return { groups: [], files: 0, unknown: false };
    return { groups: [], files: 0, unknown: true, changedFiles: changed.known ? changed.files : null };
  }

  let groups = repo.changeGroupsFor(db, workId);
  if (!groups.length) {
    /* Nothing has explained this Work yet. That is 설명 못함, not an error and not an empty
     * screen — `21` WBS-28: change_group 이 하나도 없음 → 빈 상태가 오류로 보이지 않는다.
     *
     * DERIVED, not written: this is a read, and a read that writes surprises every caller. The
     * shape comes from `groupsFrom` rather than being built here, so the default the screen
     * shows and the default the pass falls back to are the same code. */
    const byId = new Map(diffs.map((d) => [d.id, d.file]));
    groups = explain.groupsFrom(null, { diffs, signals: [] }).groups
      /* `pending`, not `explainable: false`. Nothing has FAILED here — nothing has been asked.
       * `18` reader.unexplained's truth condition is "LLM 설명 실패/거부", and announcing that
       * for a pass that was never run is the same overclaim inverted: the product reporting its
       * own failure for work it never attempted. */
      .map((g) => ({ ...g, pending: true, files: g.files.map((id) => byId.get(id)) }));
  }

  const segments = new Map(blocksFor(db, workId, project, store).map((b) => [b.file, b]));
  const byFile = new Map(diffs.map((d) => [d.file, d]));
  return {
    files: diffs.length,
    evidenceGap: evidenceGap(db, workId),
    groups: groups.map((g) => ({
      ...masked({ ...g, files: undefined }),   // title / what / why / affects: explanation text; patch and blocks below stay raw (SC-04)
      files: g.files.map((file) => {
        const d = byFile.get(file);
        const seg = segments.get(file) ?? {};
        return {
          file,
          displayable: d?.displayable ?? false,
          truncated: d?.truncated ?? false,
          ref: d?.ref ?? null,
          patch: d?.patch ?? '',
          strategy: seg.strategy ?? 'S2',
          note: seg.note ?? null,
          blocks: seg.blocks ?? [],
        };
      }),
    })),
  };
}

/**
 * `19` §E · changes the evidence could not cover.
 *
 * `.gitignore`d and excluded paths are not in the diff — by design (D-126a). The product still
 * has to SAY they changed, and it says it from the ledger the two bases recorded: `(path, size,
 * mtime_ns)`, and nothing else. The contents were never opened, so nothing here can describe
 * what changed inside them, and nothing tries.
 *
 * @returns {{known:boolean, paths:{path:string, change:string}[]}}
 *   `known: false` when a ledger is missing — which is NOT the same as "nothing changed". An
 *   answer of "none" is only ever given when both ledgers exist to prove it.
 */
function evidenceGap(db, workId) {
  const parse = (row) => {
    if (!row?.excluded) return null;
    try { const v = JSON.parse(row.excluded); return Array.isArray(v) ? v : null; } catch { return null; }
  };
  const before = parse(repo.basisFor(db, workId, 'before'));
  const after = parse(repo.basisFor(db, workId, 'after'));
  if (!before || !after) return { known: false, paths: [] };
  return { known: true, paths: exclude.ledgerDiff(before, after) };
}

/**
 * The units a file's change was split into. Derived on demand from the stored patch — it is
 * deterministic, and `20` cannot hold a block until WBS-26 gives it a change group (CF-10).
 */
function blocksFor(db, workId, project, store) {
  const before = repo.basisFor(db, workId, 'before');
  const after = repo.basisFor(db, workId, 'after');
  return repo.diffsFor(db, workId).map((d) => {
    /* The path is given, not re-parsed out of the header this line writes: `d.file` came from
     * git plumbing and may hold a space or a non-ASCII byte that no header regex survives. */
    const file = blocks.splitDiff(`diff --git a/x b/x\n${d.patch}`, [d.file])[0];
    if (!file) return { file: d.file, strategy: 'S2', blocks: [], note: 'unreadable' };
    const sources = (before && after && project?.path && store && before.kind === 'git_tree')
      ? { before: gitEvidence.fileAt(project.path, store, before.ref, d.file),
          after: gitEvidence.fileAt(project.path, store, after.ref, d.file) }
      : {};
    const out = blocks.blocksFor(file, sources);
    /* A patch over the head limit was split into blocks from the part we KEPT, and the result
     * looked complete. The note is what stops the reader believing the change ends there;
     * `d.ref` is where the whole patch actually is (D-129). */
    if (d.truncated) return { file: d.file, ...out, note: 'truncated', ref: d.ref };
    return { file: d.file, ...out };
  });
}

/**
 * Let go of a finished Work. The handle is dead and the state holds denial payloads with tool
 * inputs, which have no reason to stay in memory — but it happens AFTER the result is written,
 * because the result is built from that state.
 */
function release(db, workId) {
  if (repo.getWork(db, workId)?.status === 'ended') live.delete(workId);
}

/** Fold one signal into the live state and write what it justifies. */
function apply(db, workId, sig, onUpdate) {
  const entry = entryFor(db, workId) ?? { state: initial() };
  const before = entry.state;
  const after = reduce(before, sig, now());
  entry.state = after;
  if (!entry.hydrated) live.set(workId, entry);

  if (after.status !== before.status || after.outcome !== before.outcome) {
    repo.setWorkState(db, workId, { status: after.status, outcome: after.outcome });
  }
  onUpdate(snapshot(db, workId));
}

/** What the screen renders. Only facts: nothing here is derived from elapsed time. */
/* V1-409: the live state is built from the provider's raw lines (a denied command, a result text). What LEAVES for the
 * renderer is masked; the state itself, and so what a grant acts on, is untouched. */
const masked = (v) => (v == null ? v : safeStructuredSnapshot(v));
/* What the card shows is the masked copy; what the grant acts on is the raw denial. When they differ, the user is approving
 * something part of which they cannot read. the card offers no allow button and `allow` refuses - in every execution mode (V1-004 §7.8). */
const hidesArgs = (raw) => JSON.stringify(masked(raw)) !== JSON.stringify(raw);
const shownPermission = (d, cwd) => {
  const raw = withScope(d, cwd);
  const hidden = hidesArgs(raw);
  /* V1-004 §7.8: a grant whose effective scope the card cannot show is not offered, in ANY execution mode. */
  return { ...masked(raw), argsHidden: hidden, ...(hidden ? { scopable: false, scopeRefusal: 'args-hidden' } : {}) };
};

function snapshot(db, workId) {
  const work = repo.getWork(db, workId);
  if (!work) return null;
  const entry = entryFor(db, workId) ?? { state: initial() };
  const s = entry.state;
  /* V1-409: rows an OLDER build stored may still hold what the user typed or the provider printed. The row is never
   * rewritten; the copy that leaves for the renderer is masked by the same rule as a new row. */
  return {
    work: { ...work, intent: safeSnapshot(work.intent).safe },
    contextBundle: masked(repo.contextBundleFor(db, workId)),
    runEvidence: masked(repo.runEvidenceFor(db, workId)),
    steps: masked(repo.stepsFor(db, workId)),
    status: work.status,
    outcome: work.outcome,
    lastObserved: s.lastObserved,
    toolsUsed: s.toolsUsed,
    /* `scopable` travels with the denial so the screen can decide BEFORE it draws a button:
     * offering `허용하고 다시 해 보기` and then explaining that no button can be offered is a
     * control that contradicts itself. */
    openPermissions: openPermissions(s).map((d) => shownPermission(d, entry.cwd)),
    permission: openPermission(s) ? shownPermission(openPermission(s), entry.cwd) : null,
    finish: masked(s.finish),
    /* WBS-15 · `15` names two quiet states and both are about the ABSENCE of a signal, so they
     * are the one place a clock is legitimate — and it measures how long since the last
     * OBSERVED fact, never how far along anything is. */
    liveness: livenessOf(s, work),
    inputRequest: masked(s.inputRequest ?? null),
    /* WBS-16 · we asked it to stop and have not seen it stop. Red, because claiming the stop
     * would be the lie (`07` §8.1: a cancelled child exits 0). */
    cancelUnconfirmed: work.status === 'cancel_requested' && sinceMs(s.cancelRequestedAt) > CANCEL_CONFIRM_MS,
    answerDelivery: answerDeliveryOf(db, workId, entryFor(db, workId)),
    signalCount: repo.nextSeq(db, workId),
    evidence: { before: Boolean(repo.basisFor(db, workId, 'before')), after: Boolean(repo.basisFor(db, workId, 'after')) },
    result: work.status === 'ended' ? masked(repo.resultFor(db, workId)) : null,
  };
}

/* Resume is allowed only into the folder, session and binary the Work started with. Anything
 * unverifiable refuses BEFORE a process exists, so no grant reaches a CLI that could act
 * elsewhere. */
function resumeRefusal(db, entry) {
  const project = entry.projectId ? db.prepare('select path from project where id = ?').get(entry.projectId) : null;
  const v = session.verifyResume(entry.binding, { cwd: entry.cwd, sessionId: entry.sessionId, bin: entry.bin,
    projectPath: project?.path });
  return v.ok ? null : { ok: false, reason: 'resume-binding-unverified', detail: v.reason };
}

/* The init-cwd check fires after the child is running, so what it may have written before
 * stopping is unknown, and a root exit proves nothing about descendants (`stop`). Never `failed`
 * and never a freed slot without acknowledgement: `ended_unknown` (D-124), side effects measured
 * and recorded, not claimed as prevented. */
function endResumeMismatch(db, workId, entry, r, onUpdate) {
  const kind = r.mismatch?.kind === 'session' ? 'session' : 'cwd';
  writeSignal(db, workId, { source: 'juqode', kind: KIND.RAW,
    payload: JSON.stringify({ [kind === 'cwd' ? 'juqodeCwdMismatch' : 'juqodeSessionMismatch']: r.mismatch, sideEffectsPrevented: false }) });
  repo.setWorkState(db, workId, { status: 'ended', outcome: 'ended_unknown' });
  repo.setRunFailureReason(db, workId, `${kind}-mismatch`);
  const project = entry.cwd ? { path: entry.cwd } : db.prepare('select path from project where id = ?').get(entry.projectId);
  captureAfter(db, workId, project, entry.useGit ?? false, entry.store ?? null, { replace: true });
  finishResult(db, workId, project, entry.store ?? null);
  release(db, workId);
  onUpdate(snapshot(db, workId));
  return { ok: false, reason: `${kind}-mismatch` };
}

/**
 * WBS-14 · the user allows ONE refused action. D-116: JuQode never approves on their behalf,
 * so this only ever runs because a person pressed the button.
 */
async function allow(db, workId, toolUseId, opts = {}) {
  /* The authoritative source first: a Work the screen has already declared finished must not
   * be edited by a stale button, and that is true whether or not it is still in the live map. */
  const current = repo.getWork(db, workId);
  if (!current) return { ok: false, reason: 'no-work' };
  if (current.status === 'ended') return { ok: false, reason: 'ended' };
  const entry = live.get(workId);
  if (!entry) return { ok: false, reason: 'not-live' };
  if (retrying.has(workId)) return { ok: false, reason: 'retry-in-flight' };
  /* An id that names nothing must be REFUSED. Falling back to "the oldest open denial" meant
   * a caller could name anything and still get a real grant and a real retry, with the
   * `source: 'juqode'` record — the thing D-116 makes queryable — naming a refusal the caller
   * never asked about. */
  const open = openPermissions(entry.state);
  const denial = toolUseId ? open.find((d) => d.toolUseId === toolUseId) : open[0];
  if (!denial) return { ok: false, reason: toolUseId ? 'no-such-permission' : 'no-open-permission' };

  const refused = resumeRefusal(db, entry);
  if (refused) return refused;

  const scope = session.scopeOf(denial, entry.cwd);
  const spec = scope.spec ?? null;
  /* Nothing we can scope narrowly means no grant at all — never a grant of the whole tool. A file outside the project (or one that
   * leads out through a link, or that cannot be told apart from one) is refused here: no grant record, no process. */
  if (!spec) return { ok: false, reason: scope.refusal === 'outside-project' ? 'outside-project' : 'cannot-scope' };


  /* THE WHOLE TOOL SURFACE of the retry, not just the grant: `--allowedTools` only pre-approves, it does not remove tools. The retry may use the
   * denied tool and Read; every other built-in tool and every connector (MCP) tool is off (`--tools` + `--strict-mcp-config`). A denied tool that
   * cannot be confined this way is not retried at all. */
  const tools = scopedRetryTools(denial);
  if (tools === null) return { ok: false, reason: 'cannot-scope-tool-surface' };
  const mode = opts.executionMode ?? entry.mode ?? undefined;
  /* No approval of something the card could not show - the mode (dev-compat or v1-protected) does not matter. Refused BEFORE the
   * grant record and before any process; this is a refusal, not an audit: nothing ran. */
  const argsHidden = hidesArgs(withScope(denial, entry.cwd));
  if (argsHidden) return { ok: false, reason: 'permission-args-hidden' };
  /* Dry run of the launch checks BEFORE the grant is recorded or the state moves: a refused launch leaves the Work exactly as it was. */
  const pf = session.preflightRun({ sessionId: entry.sessionId, resume: true, allowedTools: [spec], tools, bin: entry.bin, mode, recorded: entry.launchIdentity ?? null });
  if (!pf.ok) return { ok: false, reason: 'preflight-refused', detail: pf.reason };

  retrying.add(workId);
  try {
    return await runRetry(db, workId, entry, denial, spec, { ...opts, tools, mode, argsHidden });
  } finally {
    retrying.delete(workId);
  }
}

/* The retry's audit record. `violation` = something the stream shows that the grant did not allow: an exposed connector tool, a built-in tool beyond
 * the retry's surface, or a file write that ran outside the granted file. It is DETECTION: the process already ran (Hooks start before `init`). */
const VIOLATIONS = ['mcp-exposed', 'builtin-tools-beyond-claim'];
function auditRetry(events, { entry, spec, tools, exitCode, launch, runResult }) {
  const claimed = String(tools ?? '').split(',').filter(Boolean);
  const sum = summarizeRun(events, { requestedSessionId: entry.sessionId, resume: true, callCwd: entry.cwd, claimsRestrictedTools: true, claimedTools: claimed, grants: [spec], exitCode, realpath: fs.realpathSync });
  const binaryChanged = Boolean(entry.launchIdentity?.version && runResult?.initVersion && entry.launchIdentity.version !== runResult.initVersion);
  /* the version the process reports is the only post-hoc evidence of WHICH build ran: absent -> UNKNOWN, never "unchanged" */
  const versionUnknown = !runResult?.initVersion || !entry.launchIdentity?.version;
  if (versionUnknown) sum.notes.push('binary-version-unverified');
  const problems = [...sum.problems, ...(binaryChanged ? ['binary-version-changed-since-start'] : [])];
  const violation = problems.find((p) => VIOLATIONS.includes(p) || p.startsWith('write-ran-without-grant') || p.startsWith('bash-ran-outside-grant') || p === 'binary-version-changed-since-start') ?? null;
  return { violation, record: {
    mode: launch?.mode ?? null, safety: launch?.safety ?? null, containment: launch?.containment ?? null, tools: claimed, grant: spec,
    problems, notes: sum.notes, hooksBeforeInit: sum.hooksBeforeInit, exposedTools: sum.tools.exposed, outcome: sum.outcome,
    sideEffectsPrevented: false } };
}
function endRetryViolation(db, workId, entry, audit, onUpdate) {
  repo.setWorkState(db, workId, { status: 'ended', outcome: 'ended_unknown' });
  repo.setRunFailureReason(db, workId, 'retry-surface-violation');
  const project = entry.cwd ? { path: entry.cwd } : db.prepare('select path from project where id = ?').get(entry.projectId);
  captureAfter(db, workId, project, entry.useGit ?? false, entry.store ?? null, { replace: true });
  finishResult(db, workId, project, entry.store ?? null);
  release(db, workId);
  onUpdate(snapshot(db, workId));
  return { ok: false, reason: 'retry-surface-violation', detail: audit.violation };
}

async function runRetry(db, workId, entry, denial, spec, opts) {
  const granted = session.grantedSignal(denial, spec);
  writeSignal(db, workId, { source: 'juqode', kind: KIND.PERMISSION_GRANTED, payload: { ...granted.payload, argsHidden: Boolean(opts.argsHidden) } });
  apply(db, workId, granted, opts.onUpdate ?? (() => {}));

  /* Same Work, same session. Restating the whole request made Claude repeat completed writes
   * after each one-action grant; the existing conversation already contains the original task
   * and denied tool call. This fixed continuation keeps that context without replaying the task. */
  const seen = []; let launch = null;
  const retryRun = await session.run({
    cwd: entry.cwd, sessionId: entry.sessionId, resume: true, allowedTools: [spec], tools: opts.tools, mode: opts.mode, recorded: entry.launchIdentity ?? null,
    prompt: 'Continue the original request from this session. Retry the one action that was just allowed, then finish without repeating completed work.',
    bin: entry.bin,
    onLaunch: (f) => { launch = f; },
    onChild: (c) => { entry.child = c; },
    onSignal: (sig, raw, line) => {
      if (raw) seen.push(raw);
      writeSignal(db, workId, { source: 'claude', kind: sig.kind, payload: line });
      apply(db, workId, sig, opts.onUpdate ?? (() => {}));
    },
  });

  /* What this launch could and could NOT claim, and what the stream then showed -- from events and the granted path, never from the exit code. */
  const audit = auditRetry(seen, { entry, spec, tools: opts.tools, exitCode: retryRun.code, launch, runResult: retryRun });
  writeSignal(db, workId, { source: 'juqode', kind: KIND.RAW, payload: JSON.stringify({ juqodeRetryAudit: audit.record }) });
  if (audit.violation) return endRetryViolation(db, workId, entry, audit, opts.onUpdate ?? (() => {}));

  if (retryRun.mismatch) return endResumeMismatch(db, workId, entry, retryRun, opts.onUpdate ?? (() => {}));

  /* The retry is when the change actually lands, so the after-basis is taken again. An earlier
   * one recorded a project that had not been edited yet. */
  /* After EVERY retry turn, ended or not — a retry that lands in a second denial still moved
   * files, and the old basis would report them as no change at all. */
  captureAfter(db, workId, opts.project ?? { path: entry.cwd }, entry.useGit, entry.store, { replace: true });
  finishResult(db, workId, opts.project ?? { path: entry.cwd }, entry.store);
  release(db, workId);
  (opts.onUpdate ?? (() => {}))(snapshot(db, workId));
  return { ok: true, scope: spec, argsHidden: Boolean(opts.argsHidden), safety: launch?.safety ?? 'dev-compat-unattested', containment: launch?.containment ?? null };
}

/**
 * WBS-13 · the user answers. `15`: the answer returns to 진행 중 in the SAME Work, never a new
 * one, so it resumes the same session id rather than starting anything.
 */
async function answer(db, workId, text, opts = {}) {
  /* Argument validation first — it does not depend on any state, and answering it precisely
   * is what lets the screen say WHY. Then the authoritative source, then the live handle. */
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty-answer' };
  const work = repo.getWork(db, workId);
  if (!work) return { ok: false, reason: 'no-work' };
  if (work.status === 'ended') return { ok: false, reason: 'ended' };
  const entry = live.get(workId);
  if (!entry) return { ok: false, reason: 'not-live' };

  const refused = resumeRefusal(db, entry);
  if (refused) return refused;

  writeSignal(db, workId, { source: 'user', kind: KIND.ANSWER, payload: text });
  apply(db, workId, { kind: KIND.ANSWER, payload: { text } }, opts.onUpdate ?? (() => {}));

  /* §8.3: the answer is RECORDED here, locally. That is not the same fact as the provider having RECEIVED it, and nothing in this
   * function can prove the second one - a started process, an init event or an exit code 0 are not receipt. So the only
   * delivery states this code produces are `answer_submitted_locally` (default), `delivery_pending` (the resume is running) and
   * `delivery_failed_unknown` (it did not start, said nothing, or was refused). `delivered_observed` is reserved: it needs an
   * evidence definition from a real provider measurement (G1) and is never produced. */
  entry.answerInFlight = true;
  let answerRun;
  try {
    answerRun = await session.run({
      cwd: entry.cwd, sessionId: entry.sessionId, resume: true, prompt: text, bin: entry.bin,
      mode: opts.executionMode ?? entry.mode ?? undefined, recorded: entry.launchIdentity ?? null,
      onChild: (c) => { entry.child = c; },
      onSignal: (sig, raw, line) => {
        writeSignal(db, workId, { source: 'claude', kind: sig.kind, payload: line });
        apply(db, workId, sig, opts.onUpdate ?? (() => {}));
      },
    });
  } catch (e) {
    markAnswerFailed(db, workId, 'exception');
    throw e;
  } finally { entry.answerInFlight = false; }
  if (answerRun.mismatch) { markAnswerFailed(db, workId, 'mismatch'); return endResumeMismatch(db, workId, entry, answerRun, opts.onUpdate ?? (() => {})); }
  if (answerRun.startFailed || !answerRun.sawEvent) markAnswerFailed(db, workId, answerRun.startFailed ? 'start-failed' : 'no-event');
  (opts.onUpdate ?? (() => {}))(snapshot(db, workId));
  return { ok: true };
}

const ANSWER_DELIVERY = Object.freeze({
  SUBMITTED: 'answer_submitted_locally', PENDING: 'delivery_pending', OBSERVED: 'delivered_observed', FAILED: 'delivery_failed_unknown' });
const markAnswerFailed = (db, workId, reason) => writeSignal(db, workId, { source: 'juqode', kind: KIND.RAW,
  payload: JSON.stringify({ juqodeAnswerDelivery: { state: ANSWER_DELIVERY.FAILED, reason } }) });
/** What is KNOWN about the user's latest answer, read from rows (no schema change; an answer an older build stored reads as `answer_submitted_locally`).
 * `delivered_observed` is never returned. */
function answerDeliveryOf(db, workId, entry) {
  const last = db.prepare("select seq from work_signal where work_id = ? and source = 'user' and kind = 'answer' order by seq desc limit 1").get(workId);
  if (!last) return null;
  if (entry?.answerInFlight) return ANSWER_DELIVERY.PENDING;
  const failed = db.prepare("select 1 as x from work_signal where work_id = ? and source = 'juqode' and seq > ? and payload like '%juqodeAnswerDelivery%' limit 1").get(workId, last.seq);
  return failed ? ANSWER_DELIVERY.FAILED : ANSWER_DELIVERY.SUBMITTED;
}

/**
 * WBS-16 · cancel. The request is recorded; the STOP is only claimed when it is OBSERVED, and
 * there is an observer for both ways it can happen.
 *
 * Two ways it is observed, and both close the Work — without one of them the Work sat in
 * 취소 요청됨 forever and D-117's slot stayed held until the app restarted:
 *   - the process is already gone (nothing to stop, so it is stopped);
 *   - the child exits after the signal, which `start`/`allow`'s run promise reports.
 * If neither happens the Work stays 취소 요청됨 and the screen says 확인할 수 없어요 — which is
 * the honest answer, not a stuck one.
 */
function cancel(db, workId, opts = {}) {
  const work = repo.getWork(db, workId);
  if (!work) return { ok: false, reason: 'no-work' };
  /* A Work the screen has already finished must not be reopened by a stale button. */
  if (work.status === 'ended') return { ok: false, reason: 'ended' };

  const onUpdate = opts.onUpdate ?? (() => {});
  const entry = live.get(workId);
  writeSignal(db, workId, { source: 'user', kind: KIND.CANCEL_REQUEST, payload: null });
  apply(db, workId, { kind: KIND.CANCEL_REQUEST, payload: null }, onUpdate);

  const child = entry?.child;
  if (entry) {
    entry.cancelRequested = true;
    if (child) stopEntryTree(db, workId, entry, onUpdate);
    /* During spawn there is no handle yet. onChild notices cancelRequested and stops the tree
     * as soon as the root handle exists; missing child is never treated as proof of death. */
  } else {
    /* Without the live ChildProcess/session observer, a missing PID only proves there is no
     * process now. It does not prove this cancel request stopped the Run or that it made no
     * changes before exiting. Preserve the outcome as unknown; never infer cancelled_nochange. */
    repo.setWorkState(db, workId, { status: 'ended', outcome: 'ended_unknown' });
    repo.setRunFailureReason(db, workId, 'cancel-requested-without-process-handle');
    writeSignal(db, workId, { source: 'juqode', kind: KIND.RAW,
      payload: JSON.stringify({ cancelUnconfirmed: 'process-handle-unavailable' }) });
    release(db, workId);
    onUpdate(snapshot(db, workId));
  }
  return { ok: true };
}

function stopEntryTree(db, workId, entry, onUpdate) {
  if (!entry?.child || entry.cancelStopStarted || entry.cancelTreeUnknown) return;
  entry.cancelStopStarted = true;
  session.stop(entry.child, {
    onUnconfirmed: () => {
      entry.cancelTreeUnknown = true;
      const work = repo.getWork(db, workId);
      if (work?.status !== 'ended' || work.outcome !== 'ended_unknown') {
        repo.setWorkState(db, workId, { status: 'ended', outcome: 'ended_unknown' });
        repo.setRunFailureReason(db, workId, 'cancel-process-tree-not-confirmed-stopped');
        writeSignal(db, workId, { source: 'juqode', kind: KIND.RAW,
          payload: JSON.stringify({ cancelUnconfirmed: 'process-tree-not-confirmed-stopped' }) });
      }
      const project = db.prepare('select path from project where id = ?').get(work.project_id);
      captureAfter(db, workId, entry.cwd ? { path: entry.cwd } : project, entry.useGit ?? false, entry.store ?? null);
      finishResult(db, workId, entry.cwd ? { path: entry.cwd } : project, entry.store ?? null);
      release(db, workId);
      onUpdate(snapshot(db, workId));
      entry.markDone?.({ ok: false, reason: 'cancel-tree-unconfirmed', workId });
    },
  });
}

/**
 * The states `15` defines by the ABSENCE of a signal cannot be delivered by a signal.
 *
 * 새 신호 없음 and 취소 확인 불가 are both "nothing has happened for a while", so a push-only
 * screen could never show them: the only event that would deliver the news is the event that
 * makes it untrue. This is the one place a timer is legitimate, and it measures silence since
 * the last OBSERVED fact — never how far along anything is.
 *
 * The interval is never coarser than HALF the threshold it is judging. At the shipped 2분 that
 * is the same 15 s it always was; with a shortened threshold the state would otherwise appear
 * up to a full tick late, which is a screen that is wrong for as long as the tick is long.
 */
function watchQuiet(db, onUpdate, { everyMs = Math.min(15_000, Math.floor(QUIET_MS / 2)) } = {}) {
  const tick = setInterval(() => {
    for (const [workId] of live) {
      const snap = snapshot(db, workId);
      if (!snap || snap.status === 'ended') continue;
      if (snap.liveness !== 'live' || snap.cancelUnconfirmed) onUpdate(snap);
    }
  }, everyMs);
  tick.unref?.();
  return () => clearInterval(tick);
}

/**
 * WBS-19b · 되돌리기 — put this Work's changed files back to the before-basis.
 *
 * D-115 stands for what it was about: there is no global undo and the product must not promise
 * one. This is the narrow thing the evidence can carry, and every way it can fail to be
 * complete is REPORTED rather than smoothed over — see `restore()` in `../evidence/git.js` for
 * the three structural limits the copy has to repeat.
 *
 * A Work with a `hash_manifest` basis cannot be reverted at all: a manifest holds hashes, not
 * content, so there is nothing to put back. That is `not-git-basis`, and it is a fact about the
 * project (no Git repository) rather than a failure.
 */
function revert(db, workId, project, store) {
  const before = repo.basisFor(db, workId, 'before');
  const after = repo.basisFor(db, workId, 'after');
  if (!before || !after) return { ok: false, reason: 'no-basis' };
  if (before.kind !== 'git_tree' || after.kind !== 'git_tree') return { ok: false, reason: 'not-git-basis' };
  if (!store) return { ok: false, reason: 'no-basis' };

  let files;
  try {
    files = gitEvidence.restore(project.path, store, before.ref, after.ref);
  } catch (e) {
    return { ok: false, reason: 'restore-failed', detail: e?.code ?? null };
  }

  /* F-13 · D-126a: the basis never held the excluded paths, so they were not restored — and a
   * 되돌렸어요 that quietly skipped `.env` would be the product overstating its own evidence.
   *
   * A COUNT is not enough. If the Work changed the user's `.env`, that file is recoverable from
   * nowhere — not from this restore, not from 저장(`qc.git.commit` uses the same exclusions) —
   * and the one thing the product can do is NAME it. The ledger (D-126a) records
   * `(path, size, mtimeNs)` for exactly this: it never opens the file, so a secret cannot leak
   * through it, and it can still tell that the file changed. */
  const parseLedger = (row) => { try { return row.excluded ? JSON.parse(row.excluded) : []; } catch { return []; } };
  const beforeLedger = parseLedger(before);
  let changedExcluded = [];
  try { changedExcluded = exclude.ledgerDiff(beforeLedger, parseLedger(after)); } catch { changedExcluded = []; }

  return {
    ok: true,
    files,
    restored: files.filter((f) => f.action === 'restored').length,
    removed: files.filter((f) => f.action === 'removed').length,
    failed: files.filter((f) => f.action === 'failed').map((f) => f.path),
    excluded: beforeLedger.length,
    /* Paths the Work touched that this restore could not reach. Names only — the ledger has
     * no contents to give away. */
    excludedChanged: changedExcluded.map((c) => c.path),
  };
}

module.exports = { start, allow, answer, cancel, snapshot, preflight, changes, captureAfter,
                   finishResult, saveDiffs, blocksFor, readerFor, revert, watchQuiet, live, starting,
                   QUIET_MS, CANCEL_CONFIRM_MS, maskPayload, ANSWER_DELIVERY };
