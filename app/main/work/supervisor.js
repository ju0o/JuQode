'use strict';
/* The Work loop, in one place: the order things must happen in, and the reasons they must.
 *
 * `12` and `15` SC-02 fix the sequence before a Work exists, and each step can refuse:
 *   1. Claude Code available?      → 사용 불가 card (WBS-09)   — reason, and remaining paths
 *   2. no other Work running?      → guard card (WBS-07)       — text kept, never queued
 *   3. can a before-basis be built? → 확립 불가 card (WBS-08)  — the Work does not start
 *   4. session starts and emits?   → 시작 실패 card (WBS-10)   — NO `work` row is written
 * Only after all four does a row exist, because `20` says History is Works that started.
 *
 * Nothing here decides a state on a timer or on an exit code. Every transition comes from a
 * signal, and every signal is persisted before it is interpreted.
 */
const crypto = require('node:crypto');
const repo = require('../db/repo');
const claude = require('../claude-detect');
const session = require('../claude/session');
const gitEvidence = require('../evidence/git');
const manifest = require('../evidence/manifest');
const { toSignal, reduce, initial, openPermission, openPermissions, KIND } = require('./reducer');
const resultBuilder = require('./result');
const blocks = require('../change/blocks');
const explain = require('../change/explain');
const exclude = require('../evidence/exclude');

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
async function preflight(db, project, { evidenceStore, detect = claude.detect }) {
  const status = await detect();
  if (!status.available) return { ok: false, reason: 'claude-unavailable', detail: status };

  const active = repo.activeWork(db, project.id);
  if (active) return { ok: false, reason: 'active-work', detail: active };

  const useGit = gitEvidence.isGitRepo(project.path);
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
  return m;
}

/**
 * Start a Work. Resolves as soon as the session has produced its first event (or failed to),
 * because that is the moment `15` navigates to SC-03. The session keeps running after.
 */
async function start(db, project, intent, opts = {}) {
  const { evidenceStore, onUpdate = () => {}, bin, detect } = opts;

  if (starting.has(project.id)) return { ok: false, reason: 'active-work', detail: { starting: true } };
  starting.add(project.id);
  try {
    return await startGuarded(db, project, intent, { evidenceStore, onUpdate, bin, detect });
  } finally {
    starting.delete(project.id);
  }
}

async function startGuarded(db, project, intent, { evidenceStore, onUpdate, bin, detect }) {
  const pre = await preflight(db, project, { evidenceStore, detect });
  if (!pre.ok) return pre;

  const sessionId = crypto.randomUUID();
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
  let state = initial();

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

  const first = new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

    const runP = session.run({
      cwd: project.path, sessionId, prompt: intent, bin,
      onChild: (c) => { const e = live.get(workId) ?? {}; e.child = c; if (workId) live.set(workId, e); else pendingChild.child = c; },
      onSignal: (sig, raw, line) => {
        if (!workId) {
          /* The session spoke, so a Work exists. The guard is re-checked here by the engine
           * itself — `beginWork` inserts, and the partial unique index is the arbiter. */
          const begun = repo.beginWork(db, project.id, intent);
          if (!begun.ok) {
            /* We lost the race for the slot. The process we started is ours to stop — leaving
             * it running would put two Claude Code sessions in one repository. */
            if (pendingChild.child) session.stop(pendingChild.child);
            settle({ ok: false, reason: 'active-work', detail: begun.active });
            markDone({ ok: false, reason: 'active-work' });
            return;
          }
          workId = begun.work.id;
          repo.saveBasis(db, workId, 'before', basis);
          live.set(workId, { state, sessionId, cwd: project.path, projectId: project.id, bin, child: pendingChild.child, store: evidenceStore, useGit: pre.useGit });
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
      if (!workId) {
        /* `15` SC-02 시작 실패: a card, and no row. */
        settle({ ok: false, reason: 'start-failed', detail: { code: r.code, stderr: r.stderr } });
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

/* The manifest's file list is held in-process by the repository layer, keyed by work and phase.
 * It does NOT survive a restart — `20` has no column for it (CANON_FINDINGS CF-9) — so a
 * non-Git Work that outlives the app reports `known: false`, which is the honest answer. */
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
  const spec = session.allowSpec(d, cwd ?? '/');
  return { ...d, scopable: Boolean(spec), spec };
};

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
    repo.addSignal(db, workId, { seq: repo.nextSeq(db, workId), source, kind, payload, observedAt: now() });
    return true;
  } catch (e) {
    try { repo.addSignal(db, workId, { seq: repo.nextSeq(db, workId), source: 'juqode', kind: KIND.RAW, payload: `signal-write-failed: ${e?.code ?? e?.message ?? 'unknown'}` }); }
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
  const entry = entryFor(db, workId) ?? { state: initial() };
  /* `saveResult` deletes and reinserts, so a SECOND call overwrites the first. On the cancel
   * path there is always a second: `confirmCancel` writes the result from the live state and
   * releases, then the child's own exit fires this again — with the entry gone, `entryFor`
   * rebuilds a bare state and the rewrite lands 된 것 없음 · 안 된 것 없음 under a 부분 완료
   * card, which is exactly what WBS-18's acceptance row forbids. So: an EXISTING result is
   * never replaced by one rebuilt from the row. A Work that ended while the app was gone has
   * no result yet, and still gets one. */
  if (entry.hydrated) {
    const written = repo.resultFor(db, workId);
    if (written) return written;
  }
  const { result, problems } = resultBuilder.buildChecked({
    state: { ...entry.state, outcome: work.outcome },
    changes: changes(db, workId, project, store),
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
  return repo.saveResult(db, workId, result);
}

/**
 * WBS-17 · WBS-27 — the patch, per file, at the fixed `-U3`. Stored so the change reader can
 * be opened later from History without the session or the live map still existing.
 */
function saveDiffs(db, workId, project, store) {
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
  repo.pruneDiffs(db, workId, files.map((f) => f.path));

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
      ...g,
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
function snapshot(db, workId) {
  const work = repo.getWork(db, workId);
  if (!work) return null;
  const entry = entryFor(db, workId) ?? { state: initial() };
  const s = entry.state;
  return {
    work,
    steps: repo.stepsFor(db, workId),
    status: work.status,
    outcome: work.outcome,
    lastObserved: s.lastObserved,
    toolsUsed: s.toolsUsed,
    /* `scopable` travels with the denial so the screen can decide BEFORE it draws a button:
     * offering `허용하고 다시 해 보기` and then explaining that no button can be offered is a
     * control that contradicts itself. */
    openPermissions: openPermissions(s).map((d) => withScope(d, entry.cwd)),
    permission: openPermission(s) ? withScope(openPermission(s), entry.cwd) : null,
    finish: s.finish,
    /* WBS-15 · `15` names two quiet states and both are about the ABSENCE of a signal, so they
     * are the one place a clock is legitimate — and it measures how long since the last
     * OBSERVED fact, never how far along anything is. */
    liveness: livenessOf(s, work),
    inputRequest: s.inputRequest ?? null,
    /* WBS-16 · we asked it to stop and have not seen it stop. Red, because claiming the stop
     * would be the lie (`07` §8.1: a cancelled child exits 0). */
    cancelUnconfirmed: work.status === 'cancel_requested' && sinceMs(s.cancelRequestedAt) > CANCEL_CONFIRM_MS,
    signalCount: repo.nextSeq(db, workId),
    evidence: { before: Boolean(repo.basisFor(db, workId, 'before')), after: Boolean(repo.basisFor(db, workId, 'after')) },
    result: work.status === 'ended' ? repo.resultFor(db, workId) : null,
  };
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

  const spec = session.allowSpec(denial, entry.cwd);
  /* Nothing we can scope narrowly means no grant at all — never a grant of the whole tool. */
  if (!spec) return { ok: false, reason: 'cannot-scope' };

  retrying.add(workId);
  try {
    return await runRetry(db, workId, entry, denial, spec, opts);
  } finally {
    retrying.delete(workId);
  }
}

async function runRetry(db, workId, entry, denial, spec, opts) {
  const granted = session.grantedSignal(denial, spec);
  writeSignal(db, workId, { source: 'juqode', kind: KIND.PERMISSION_GRANTED, payload: granted.payload });
  apply(db, workId, granted, opts.onUpdate ?? (() => {}));

  /* Same Work, same session. `--resume` needs the request restated on CLI 2.1.266, and the
   * grant is what bounds the retry — measured in docs/dev-evidence/mvp-run/BATCH-03.md. */
  const work = repo.getWork(db, workId);
  await session.run({
    cwd: entry.cwd, sessionId: entry.sessionId, resume: true, allowedTools: [spec],
    prompt: work.intent, bin: entry.bin,
    onChild: (c) => { entry.child = c; },
    onSignal: (sig, raw, line) => {
      writeSignal(db, workId, { source: 'claude', kind: sig.kind, payload: line });
      apply(db, workId, sig, opts.onUpdate ?? (() => {}));
    },
  });

  /* The retry is when the change actually lands, so the after-basis is taken again. An earlier
   * one recorded a project that had not been edited yet. */
  /* After EVERY retry turn, ended or not — a retry that lands in a second denial still moved
   * files, and the old basis would report them as no change at all. */
  captureAfter(db, workId, opts.project ?? { path: entry.cwd }, entry.useGit, entry.store, { replace: true });
  finishResult(db, workId, opts.project ?? { path: entry.cwd }, entry.store);
  release(db, workId);
  (opts.onUpdate ?? (() => {}))(snapshot(db, workId));
  return { ok: true, scope: spec };
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

  writeSignal(db, workId, { source: 'user', kind: KIND.ANSWER, payload: text });
  apply(db, workId, { kind: KIND.ANSWER, payload: { text } }, opts.onUpdate ?? (() => {}));

  await session.run({
    cwd: entry.cwd, sessionId: entry.sessionId, resume: true, prompt: text, bin: entry.bin,
    onChild: (c) => { entry.child = c; },
    onSignal: (sig, raw, line) => {
      writeSignal(db, workId, { source: 'claude', kind: sig.kind, payload: line });
      apply(db, workId, sig, opts.onUpdate ?? (() => {}));
    },
  });
  return { ok: true };
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
  const gone = !child || child.exitCode !== null || child.signalCode !== null;
  if (child && !gone) {
    session.stop(child);
    child.once('exit', () => confirmCancel(db, workId, onUpdate));
  } else {
    confirmCancel(db, workId, onUpdate);
  }
  return { ok: true };
}

/** The stop, observed. Only called when the process is actually gone. */
function confirmCancel(db, workId, onUpdate) {
  const work = repo.getWork(db, workId);
  if (!work || work.status === 'ended') return;
  writeSignal(db, workId, { source: 'juqode', kind: KIND.CANCEL_CONFIRMED, payload: null });
  apply(db, workId, { kind: KIND.CANCEL_CONFIRMED, payload: null }, onUpdate);
  const entry = live.get(workId);
  /* A cancelled Work has a result too — `15` gives it two of the five outcome cards. */
  finishResult(db, workId, { path: entry?.cwd }, entry?.store);
  release(db, workId);
  onUpdate(snapshot(db, workId));
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
                   QUIET_MS, CANCEL_CONFIRM_MS };
