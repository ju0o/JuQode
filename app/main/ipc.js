'use strict';
/* Every IPC handler, as plain functions over injected dependencies.
 *
 * They lived inside `main.js`'s Electron closure, which meant no test could ever CALL one —
 * the suite could only read the file as text and regex it, so a mutation that deleted the
 * intent validation, the store gate, or the sub-frame check passed every test while the
 * behaviour was gone. String-shape assertions hold while behaviour disappears.
 *
 * `deps` is what the handlers need from the outside: the store, the project's evidence
 * directory, a way to push updates, and the dialog's owning window.
 */
const fs = require('node:fs');
const path = require('node:path');
const repo = require('./db/repo');
const project = require('./project');
const claude = require('./claude-detect');
const supervisor = require('./work/supervisor');
const explain = require('./change/explain');
const narrate = require('./interpret/narrate');
const qcRules = require('./qc/rules');
const qcAvail = require('./qc/availability');
const qcRun = require('./qc/run');
const { createUncertain, restore: restoreHolds } = require('./qc/uncertain');
const qcAck = require('./qc/ack');
const { windowsTools } = require('./qc/stopper');
const term = require('./term/session');
const { classify } = require('./router/intent');
const { scan } = require('./interpret/scan');
const { answers, statusOf } = require('./interpret/answers');
const guard = require('./ipc-guard');
const { unknownTaskRunWithLiveRunner, unresolvedLegacyUnknownWorks } = require('./work/runner-liveness');

/**
 * @param {object} deps
 * @param {() => object|null} deps.db            the store, or null when it was refused
 * @param {() => string|null} deps.dbFault       why, if it was
 * @param {(projectId:string) => string} deps.evidenceStore
 * @param {(snapshot:object) => void} deps.push  send a Work update to the window
 * @param {(e:object) => object} [deps.windowFor]
 * @param {() => object} [deps.versions]
 * @param {() => object} [deps.signature]  WBS-33 · whether THIS build is signed
 */
/**
 * `18` orient.* — ONE sentence about where the user is, and it must be true.
 *
 * `확인 불가` is reserved: `21` WBS-20 allows it only for a Work that is not ended and whose
 * process could not be found after reconciliation (WBS-34 writes `ended_unknown` for those).
 * Anything that ended states its outcome, however it ended.
 */
/** Whole days between an ISO stamp and now. Floor, so "1일 전" means at least a day. */
function daysSince(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function orientationOf(works) {
  if (!works.length) return 'idle';
  if (works.some((w) => w.status !== 'ended')) return 'running';
  /* The LATEST Work, not any Work ever. `some` meant that one reconciled Work — a laptop closed
   * mid-run, once — made SC-02 say `이전 작업이 지금 어떤 상태인지 확인할 수 없어요` for the
   * rest of the project's life, with a dozen completed Works sitting under the sentence. `18`
   * writes it in the singular because it is about the one the user just left. */
  return works[0].outcome === 'ended_unknown' ? 'unknown' : 'finished';
}

function makeHandlers(deps) {
  const db = () => deps.db();
  /* What a Stop proved goes beside the run as evidence, NOT into the output and NOT into a new
   * column or status: `quick_command_run.output_ref` is the schema's "blob ref for the evidence".
   * Only runs that were asked to stop have one. A failed write loses the detail, never the run. */
  const saveStopEvidence = (projectId, runId, stop) => {
    if (!stop?.requested) return null;
    try {
      const rel = path.join('qc-stop', `${runId}.json`);
      const file = path.join(deps.evidenceStore(projectId), rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ runId, recordedAt: new Date().toISOString(), stop }, null, 2));
      return `evidence:${rel.split(path.sep).join('/')}`;
    } catch { return null; }
  };
  /* The dev server JuQode ITSELF started, or null. `19` §C4: a server the user started in their
   * own terminal has no handle here and is never signalled. */
  const devServerOf = (projectId) => {
    const live = [...qcLive.values()].find((e) => e.projectId === projectId && e.ruleId === 'qc.dev.start');
    if (!live) return null;
    return { pid: live.handle.pid, startedAt: live.handle.startedAt, command: live.command };
  };
  const needDb = () => (db() ? null : { ok: false, reason: 'no-store', detail: deps.dbFault?.() ?? null });

  /* A workId is a name the renderer supplies, so every channel that takes one checks the Work
   * exists before acting on it. `19` §S: the bridge is narrow by construction, and "any id in
   * the store" is wider than any screen ever needs. */
  const workOr = (workId) => (guard.shortId(workId) ? repo.getWork(db(), workId) : null);

  let lastPick = null;
  let detecting = null;
  /* Projects with an explanation pass in flight — see `juqode:work-explain`. */
  const explaining = new Set();
  /* WBS-22 · live Quick Command handles, keyed by RUN. `19` §C4 keeps {pid, started_at} because
   * a long-running command has to be stoppable, and `07` §8.5 makes a pid alone insufficient.
   *
   * Keyed by run, not by project, because `19` §C6 REC-010 says long-running Quick Commands run
   * in their OWN child processes **so the drawer stays usable** — a dev server must not stop the
   * user from asking for `git status`. What is refused is a second run of the SAME rule. */
  const qcLive = new Map();
  /* WBS-25 · `19` §C6 REC-010: 프로젝트당 셸 하나 · 첫 열기에 게으르게 · 서랍을 닫아도 살아
   * 있고 · 프로젝트가 바뀌면 종료. 그래서 이것은 Map 이 아니라 **하나**다 — 두 개가 동시에
   * 있을 수 있는 자료구조를 두면 "프로젝트가 바뀌면 종료" 가 규칙이 아니라 습관이 된다. */
  let termLive = null;                    // { projectId, session } | null
  const termClose = () => {
    if (!termLive) return;
    try { termLive.session.stop(); } catch { /* already gone */ }
    termLive = null;
  };
  /* 프로젝트가 바뀌면 종료 — 한 군데서. 셸을 여는 순간에만 검사하면 "바뀌면 종료" 가 아니라
   * "다음에 열 때 종료" 가 된다: 사용자가 A 를 떠난 뒤에도 A 의 디렉터리에서 도는 셸이 계속
   * 살아 있고, 화면에는 그것을 끌 방법이 없다. 프로젝트를 여는 모든 경로가 이걸 부른다. */
  const termCloseIfOther = (projectId) => {
    if (termLive && termLive.projectId !== projectId) termClose();
  };
  /* Quick Command runs whose Stop left something that might still be writing. The run stays `unknown`; this only
   * holds the Writer gate (a new Work, a file-changing Quick Command) until a later snapshot shows them gone. */
  const qcUncertain = deps.qcUncertain ?? createUncertain({ probe: windowsTools.survivors });
  /* A restart forgot nothing it should not: the holds are rebuilt once per project from the run rows and their Stop evidence
   * (the first time anything asks), so the gate does not depend on this process having seen the Stop. */
  const restoredHolds = new Set();
  /* FAIL CLOSED. A project counts as restored only after the WHOLE pass finished. Any error (the store, the evidence, a bad row)
   * records a restore failure -- the Writer gate stays shut with that reason -- and the next question simply tries again. */
  const ensureHolds = (projectId) => {
    if (restoredHolds.has(projectId)) return true;
    try {
      if (!db()) throw new Error('no-store');
      const rows = (deps.qcUnresolvedRuns ?? repo.qcUnresolvedRuns)(db(), projectId, [...qcLive.keys()]);
      restoreHolds({ rows, root: deps.evidenceStore(projectId), registry: qcUncertain });
      qcUncertain.clearRestoreFailure(projectId);
      restoredHolds.add(projectId);
      return true;
    } catch (e) {
      qcUncertain.failRestore(projectId, e?.code ?? e?.message ?? e);
      return false;
    }
  };
  /* why the gate is shut for QUICK COMMAND reasons, as the approved reason key (or null) */
  const qcHoldReason = (projectId) => {
    ensureHolds(projectId);
    const b = qcUncertain.blocks(projectId);
    return b === 'restore-failed' ? 'qc-restore-failed' : (b ? 'prior-run-unknown' : null);
  };
  /* A Work between "the gate said yes" and "the Work row exists" (supervisor.start awaits the CLI probe first): a file-changing
   * Quick Command must not slip into that gap. */
  const workStarting = new Set();
  /* A Quick Command that changes files and is running NOW: a new Work must not write beside it (the other direction of
   * `fileQcBlock`). A dev server is long-running and is how the user watches the Work, so it does not count. */
  const writerQcLive = (projectId) => liveFor(projectId).find((e) => qcRules.mutatesProjectFiles(e.ruleId) && e.kind !== 'long_running') ?? null;
  const liveFor = (projectId) => [...qcLive.values()].filter((e) => e.projectId === projectId);
  /* Re-read at the moment of use. A card built earlier is a snapshot and must not be the
   * gate: a Work can start, or an ended attempt can become unresolved, after the list
   * was drawn. Read-only: this does not probe a PID and does not record an acknowledgement.
   * `unknownTaskRunWithLiveRunner` is the same lookup Work start uses. */
  const fileQcBlock = (projectId, ruleId) => {
    if (!qcRules.mutatesProjectFiles(ruleId)) return null;
    if (repo.activeWork(db(), projectId)) return 'active-run';
    if (unknownTaskRunWithLiveRunner(db(), projectId)) return 'prior-run-unknown';
    if (workStarting.has(projectId)) return 'active-run';
    return qcHoldReason(projectId);
  };
  const withFileQcBlock = (projectId, ruleId, avail) => {
    if (!avail.available) return avail;
    const reason = fileQcBlock(projectId, ruleId);
    if (!reason) return avail;
    return { ...avail, available: false, reason };
  };
  /* …and with a narrative pass in flight (`19` §C1 ⑦). Both spawn a Claude Code child. */
  const narrating = new Set();

  const handlers = {
    'juqode:versions': () => deps.versions?.() ?? {},

    'juqode:boot': () => ({
      store: db() ? { ok: true } : { ok: false, reason: deps.dbFault?.() ?? null },
      recent: db() ? project.recent(db()) : [],
      /* WBS-33 · 원칙 2 — a build that is not signed says so, on the first screen the user
       * sees. It rides on boot because SC-01 already awaits boot: a second round trip would
       * let the screen paint once without the notice and then move, which is worse than
       * either answer. `null` is not a state — the shape always arrives. */
      signature: deps.signature?.() ?? { state: 'unknown', reason: 'not-reported' },
    }),

    'juqode:open-project': async (e) => {
      const gate = needDb();
      if (gate) return gate;
      const picked = await project.pick(db(), deps.windowFor?.(e) ?? null, (p) => { lastPick = p; });
      /* WBS-25 · `19` §C6 REC-010. Cancelling is not a project change, so only a real one closes
       * the shell. */
      if (picked?.ok && picked.project) termCloseIfOther(picked.project.id);
      return picked;
    },

    'juqode:open-path': (_e, target) => {
      const gate = needDb();
      if (gate) return gate;
      /* `lastPick` starts as null, so `target === lastPick` used to admit `openPath(null)` —
       * and realpath coerces a non-string, so `null` resolved to a "null" folder under cwd and
       * was opened as a project the user never chose. The type check is the gate's first
       * clause now, not an assumption about what a renderer would send. */
      if (typeof target !== 'string' || target === '') return { ok: false, reason: 'not-offered' };
      const known = target === lastPick || project.recent(db()).some((p) => p.path === target);
      if (!known) return { ok: false, reason: 'not-offered' };
      const opened = project.openPath(db(), target);
      if (opened?.ok && opened.project) termCloseIfOther(opened.project.id);
      return opened;
    },

    'juqode:interpret': async (_e, projectId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      const hold = Number(process.env.JUQODE_INTERPRET_DELAY_MS) || 0;
      if (hold) await new Promise((r) => setTimeout(r, hold));

      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };

      const scanned = scan(row.path);
      let list = answers(scanned);

      /* WBS-04 · the narrative layer. `19` §C1 ⑥ makes its failure a 부분 Brief rather than a
       * failed one, so it is written as an ENRICHMENT of the deterministic answers: whatever
       * comes back, `list` is still the facts layer's six rows or better.
       *
       * ⑦ the narrative session does not overlap an active Work — D-117's spirit, and the same
       * rule the change-explanation pass obeys. A Work is what the user asked for; the Brief is
       * not, so the Brief is the one that waits. The scan already happened either way, so the
       * facts are on screen regardless. */
      let narrated = null;
      if (!scanned.failed && !repo.activeWork(db(), projectId) && !narrating.has(projectId)) {
        narrating.add(projectId);
        try {
          narrated = await narrate.narrate({
            deterministic: list, readFiles: scanned.readFiles, facts: scanned.facts,
            cwd: row.path, bin: deps.claudeBin?.(),
          });
          list = narrated.answers;
        } catch { /* `19` §C1 ⑥ — the facts stand on their own */ }
        finally { narrating.delete(projectId); }
      }

      /* `21` WBS-05: 갱신 실패 시 이전 해석이 살아남는다. `saveInterpretation` retires the
       * current row and inserts a new one, so writing a failed scan over a good Brief would
       * REPLACE six answers the user could still read with a card saying nothing was read.
       * A refresh that could not read the folder is a failed REFRESH, not a failed project. */
      const existing = repo.currentInterpretation(db(), projectId);
      if (scanned.failed && existing) {
        return { ok: true,
                 interpretation: { ...existing, failedCode: null },
                 refreshFailed: scanned.failed,
                 narrative: { skipped: true } };
      }

      const saved = repo.saveInterpretation(db(), projectId, {
        status: statusOf(scanned, list),
        sourceHash: scanned.sourceHash,
        skippedNote: scanned.skipped ? JSON.stringify(scanned.skipped) : null,
        answers: list,
        readFiles: scanned.readFiles,
      });
      /* The errno travels with the result: `15` SC-02 Failure State asks for the REASON, and a
       * fixed sentence in the renderer would state a cause that may not be the cause. */
      return { ok: true,
               interpretation: { ...saved, failedCode: scanned.failed ?? null },
               /* Why the Brief looks the way it does, for the run log — not for the screen. */
               narrative: narrated ? { filled: narrated.filled, grounded: narrated.grounded,
                                       reason: narrated.reason, detail: narrated.detail ?? null }
                                   : { skipped: true } };
    },

    /* WBS-05 · the Brief as it stands, plus whether it has AGED — and neither is a write.
     *
     * `19` §C1 ⑤: staleness is derived from `source_hash`, which covers the manifests and the
     * shape of the tree, and from nothing else. The check re-runs the DETERMINISTIC scan only:
     * it is bounded (`19` §C1 ③) and asks no model, which is what makes it cheap enough to do
     * on every open. There is NO auto re-read — the verdict is announced and the user decides
     * (D-132). */
    'juqode:brief': (_e, projectId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };

      const current = repo.currentInterpretation(db(), projectId);
      if (!current) return { ok: true, interpretation: null, stale: null };

      const now = scan(row.path);
      /* A scan that cannot read the folder says nothing about whether the Brief has aged. */
      /* `currentInterpretation` returns the ROW, so these are the column names `20` uses. */
      const changed = !now.failed && Boolean(current.source_hash) && now.sourceHash !== current.source_hash;
      return { ok: true,
               interpretation: current,
               stale: { changed, days: daysSince(current.created_at), at: current.created_at } };
    },

    /* WBS-22 · what a phrase MEANS, and whether it could run. Recognises and explains; runs
     * NOTHING. `19` §C4: 항상 설명 후 확인 — the explanation is a separate round trip from the
     * execution, so nothing can be started by typing. */
    'juqode:qc-route': (_e, projectId, phrase) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      const bad = guard.text(phrase, guard.LIMITS.qcPhrase, { allowEmpty: true });   // before the matcher runs
      if (bad) return bad;
      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };

      const match = qcRules.match(String(phrase ?? ''));
      if (match.kind !== 'qc') {
        /* 미인식 and 모호함 are CARDS, not rows (`20` F-12). Neither is an error: `15` TD-01
         * paints 미인식 neutral, and an ambiguity names its readings and runs nothing. */
        return { ok: true, route: match, phrase: String(phrase ?? '') };
      }

      const rule = qcRules.ruleById(match.id);
      const avail = withFileQcBlock(projectId, match.id,
        qcAvail.availability(match.id, { root: row.path, devServer: devServerOf(projectId) }));
      return { ok: true, route: match, phrase: String(phrase ?? ''),
               rule: { id: rule.id, kind: rule.kind, risk: rule.risk, stopRule: rule.stopRule ?? null },
               available: avail.available, reason: avail.reason, data: avail.data };
    },

    /* WBS-22 · everything the drawer can offer, with why each one can or cannot run right now.
     * `15` TD-01 지원 동작 알아보기: 전부 사용 불가여도 이유와 함께 나열한다. */
    'juqode:qc-list': (_e, projectId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };
      ensureHolds(projectId);                          // a failed restore is tried again every time the list is opened
      qcUncertain.refresh(projectId);                  // opening the list is a reason to look again
      const dev = devServerOf(projectId);
      return { ok: true, held: qcUncertain.heldFor(projectId), restoreFailure: qcUncertain.restoreFailure(projectId), rules: qcRules.RULES.map((r) => {
        const a = withFileQcBlock(projectId, r.id,
          qcAvail.availability(r.id, { root: row.path, devServer: dev }));
        return { id: r.id, kind: r.kind, risk: r.risk,
                 available: a.available, reason: a.reason, data: a.data };
      }) };
    },

    /* WBS-22 · run it. The caller has seen the explanation and confirmed — `19` §C4 requires
     * both, and this handler is the only thing that spawns. */
    'juqode:qc-run': async (_e, projectId, ruleId, phrase) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      if (!guard.shortId(ruleId)) return { ok: false, reason: 'unknown-rule' };
      if (phrase != null) { const bad = guard.text(phrase, guard.LIMITS.qcPhrase, { allowEmpty: true }); if (bad) return bad; }
      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };
      /* The id must be one of the SIX. A renderer that could name any string could ask for a
       * rule the table does not have, and `20`'s foreign key would be the only thing left. */
      if (!qcRules.ruleById(ruleId)) return { ok: false, reason: 'unknown-rule' };
      /* The SAME rule twice is refused; two DIFFERENT rules are not. `19` §C6 REC-010. */
      if (liveFor(projectId).some((e) => e.ruleId === ruleId)) {
        return { ok: false, reason: 'already-running' };
      }

      const rule = qcRules.ruleById(ruleId);
      const avail = qcAvail.availability(ruleId, { root: row.path, devServer: devServerOf(projectId) });
      /* Availability is re-checked HERE, not trusted from the card: the project can change
       * between the explanation and the confirmation, and the card is a snapshot. */
      if (!avail.available) return { ok: false, reason: 'unavailable', detail: avail.reason, data: avail.data };

      /* `19` §C4 names THREE kinds of action, not one: a package.json script, and two FIXED
       * actions that spawn nothing — opening the drawer, and SIGTERM→5 s→SIGKILL to a pid
       * JuQode started. Treating "no argv" as "not executable" made the product explain
       * `터미널 열어줘` and `개발 서버 꺼줘` as commands it understood and then refuse them as
       * commands it did not have. Two of the six rules dead-ended. */
      if (ruleId === 'qc.terminal.open') {
        /* JuQode's own action. Nothing is spawned, so `20` F-12 gives it no row — the same rule
         * a Work that never started obeys. */
        return { ok: true, action: 'open-drawer', kind: rule.kind };
      }

      if (ruleId === 'qc.dev.stop') {
        /* The stop signal goes to the handle JuQode is holding. `19` §C4: a server started
         * outside JuQode has no handle here and is never signalled — `availability()` already
         * refused with `not_running` if there is none. */
        const live = liveFor(projectId).find((e) => e.ruleId === 'qc.dev.start');
        if (!live) return { ok: false, reason: 'unavailable', detail: 'not_running', data: {} };
        live.handle.stop();
        return { ok: true, action: 'stop', stoppingRunId: live.runId, pid: live.handle.pid,
                 command: live.command, kind: rule.kind };
      }

      if (!avail.data.argv) return { ok: false, reason: 'not-executable' };

      /* The gate is this read, not the card. It sits in the same synchronous turn as the
       * spawn: Electron runs another IPC handler only at an await, and there is none between
       * here and `qcRun.start`. `start` itself may `git add` before it spawns, so the check
       * is before `beginQcRun` as well — a refused command leaves no row. An unacknowledged
       * ended_unknown attempt is not an active Work, and it is not a confirmed stop. */
      const fileGuard = fileQcBlock(projectId, ruleId);
      if (fileGuard) return { ok: false, reason: fileGuard };

      const status = rule.kind === 'long_running' ? 'long_running' : 'running';
      const runId = repo.beginQcRun(db(), projectId, {
        phrase: String(phrase ?? ''), ruleId, command: avail.data.command, status,
      });

      const handle = qcRun.start({
        argv: avail.data.argv, cwd: row.path, kind: rule.kind, prepare: avail.data.prepare ?? [],
        onUpdate: (u) => deps.pushQc?.({ runId, projectId, ruleId, ...u }),
      });
      qcLive.set(runId, { runId, projectId, ruleId, handle, command: avail.data.command, kind: rule.kind });
      try { repo.setQcRunner(db(), runId, { sessionId: deps.appSessionId?.() ?? null, pid: handle.pid, startedAt: handle.startedAt }); } catch { /* the run still runs; only the restart memory is lost */ }

      handle.done.then((res) => {
        qcLive.delete(runId);
        repo.endQcRun(db(), runId, {
          /* `20` `qc_status`: success · failed · stopped · unknown. `07` §8.1 — a signalled
           * child is `stopped`, never `success`, whatever code it carried. */
          status: res.state === 'ok' ? 'success' : res.state,
          exitCode: res.code, outputHead: res.output ?? null,
          endedAt: res.endedAt, stoppedAt: res.state === 'stopped' ? res.endedAt : null,
          outputRef: saveStopEvidence(projectId, runId, res.stop),
        });
        if (res.state === 'unknown' && !qcRules.isReadOnlyRun({ rule_id: ruleId, command: avail.data.command, started_at: handle.startedAt })) qcUncertain.add(runId, projectId, res.stop?.members, { parents: res.stop?.snapshot?.root ? [res.stop.snapshot.root] : [], command: avail.data.command, startedAt: handle.startedAt, why: res.stop?.uncertain ? 'stop-uncertain' : 'ownership-unproven' });
        deps.pushQc?.({ runId, projectId, ruleId, ...res, ended: true });
      /* The store can be closed before a child settles (quit races the last exit), and an
       * unhandled rejection in the main process is a crash. The row is left un-ended, which
       * boot reconciliation turns into `확인 불가` — the honest outcome for a run nobody saw
       * finish. */
      }).catch(() => { qcLive.delete(runId); });

      return { ok: true, runId, pid: handle.pid, startedAt: handle.startedAt,
               command: avail.data.command, kind: rule.kind };
    },

    /* The user says the previous Quick Command's processes are gone. Recorded append-only in the evidence store; the runs stay
     * `unknown`. Releases every hold of this project (the statement is about "the earlier processes", not about one pid). */
    'juqode:qc-ack-stopped': (_e, projectId, runIds, confirmedStopped) => {
      const gate = needDb();
      if (gate) return gate;
      if (confirmedStopped !== true) return { ok: false, reason: 'confirmation-required' };
      const bad = (!guard.shortId(projectId) ? { ok: false, reason: 'bad-input' } : null) ?? guard.idList(runIds);
      if (bad) return bad;
      if (!db().prepare('select id from project where id = ?').get(projectId)) return { ok: false, reason: 'no-project' };
      if (!ensureHolds(projectId)) return { ok: false, reason: 'qc-restore-failed', detail: qcUncertain.restoreFailure(projectId)?.reason ?? null };
      const root = deps.evidenceStore(projectId);
      const heldNow = new Map(qcUncertain.heldFor(projectId).map((h) => [h.runId, h]));
      const acked = []; const skipped = [];
      for (const runId of new Set(runIds)) {
        const h = heldNow.get(runId);
        const row = repo.qcRun(db(), runId);
        /* only a run THIS project holds right now, and only the ones the user was shown and named */
        if (!h || !row || row.project_id !== projectId) { skipped.push({ runId, reason: 'not-held-by-this-project' }); continue; }
        const w = qcAck.writeAck(root, { ...row, heldBecause: h.why });
        if (!w.ok) { skipped.push({ runId, reason: w.reason, detail: w.detail ?? null }); continue; }   // nothing is released without a verified record
        qcUncertain.release(runId);
        acked.push({ runId, ref: w.ref, existing: w.existing });
      }
      return { ok: acked.length > 0, acked, skipped, stillHeld: qcUncertain.heldFor(projectId).map((x) => x.runId) };
    },

    /* WBS-22 · stop the one JuQode started. `19` §C4: JuQode 밖에서 켠 서버는 끄지 않는다 —
     * there is no handle for one, so there is nothing here that could. */
    'juqode:qc-stop': (_e, projectId, runId = null) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      if (runId != null && !guard.shortId(runId)) return { ok: false, reason: 'not-running' };
      const running = liveFor(projectId);
      /* A named run, else the dev server, else the only thing going. `19` §C4: only a process
       * JuQode itself started can be signalled, and every entry here is one. */
      const live = (runId && qcLive.get(runId)?.projectId === projectId ? qcLive.get(runId) : null)
        ?? running.find((e) => e.ruleId === 'qc.dev.start')
        ?? (running.length === 1 ? running[0] : null);
      if (!live) return { ok: false, reason: 'not-running' };
      live.handle.stop();
      return { ok: true, runId: live.runId };
    },

    /* ── WBS-25 · TD-01 의 셸 명령줄 (DV-11: 파이프 셸 · PM 2026-09-10) ──────────────────
     *
     * `19` §C4: 이 줄은 **사용자가 사용자로 실행한다.** 여기에 검사·차단·정정이 없는 것은
     * 빠뜨린 것이 아니라 계약이다 — 걸러내는 척하는 제품은 걸러내지 못한 것을 안전하다고
     * 가르친다. 대신 제품은 닫을 수 없는 배너와 `limits` 로 무엇이 안 되는지 말한다.
     *
     * Quick Command 와 같은 채널에 두지 않는다: 저쪽은 argv 고정에 셸이 없고, 이쪽은 셸이다.
     * 채널이 하나면 그 차이가 사라진다. */
    'juqode:term-open': (_e, projectId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };
      /* 프로젝트가 바뀌면 앞의 세션은 끝난다 — REC-010. 사용자가 A 에서 `cd` 해 둔 셸에
       * B 의 명령을 치게 두는 것은 Quick Command 카드가 프로젝트를 건너가던 것과 같은 결함이다
       * (배치 12 HIGH). */
      termCloseIfOther(projectId);
      /* 게으르게: 이미 있으면 그것을 돌려준다. 서랍을 닫았다 여는 것으로 맥락이 사라지지 않는다. */
      if (!termLive) {
        const session = term.open({
          cwd: row.path,
          onUpdate: (u) => deps.pushTerm?.({ projectId, ...u }),
        });
        termLive = { projectId, session };
        /* 셸이 스스로 끝나는 것(사용자의 `exit`, 크래시)도 상태다. 붙들고 있으면 다음 열기가
         * 죽은 셸을 돌려준다. */
        session.done.then(() => { if (termLive?.session === session) termLive = null; })
          .catch(() => { if (termLive?.session === session) termLive = null; });
      }
      const s = termLive.session;
      /* A shell that did not start is not a session. `15` TD-01 Unavailable State: 열 수 없어요
       * with a reason — never a handle that accepts lines and drops them. */
      if (s.pid == null) { termClose(); return { ok: false, reason: 'spawn-failed' }; }
      return { ok: true, id: s.id, cwd: s.cwd, pid: s.pid, limits: s.limits, busy: s.busy() };
    },

    'juqode:term-write': (_e, projectId, line) => {
      /* 저장소가 거절된 상태에서는 어떤 채널도 행동하지 않는다 — 세션은 프로젝트를 연 뒤에만
       * 존재할 수 있고, 프로젝트를 여는 것 자체가 저장소를 필요로 한다. */
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      if (!termLive || termLive.projectId !== projectId) return { ok: false, reason: 'not-open' };
      /* A resource limit, not a command filter: `19` §C4 runs the line exactly as typed. */
      const bad = guard.shellLine(line);
      if (bad) return bad;
      return termLive.session.write(line);
    },

    /* 작업 제어가 없으므로 이것은 명령 하나가 아니라 **세션을 끝낸다**(실측: 제어 터미널 없음).
     * 화면이 그렇게 말해야 하고, 이 이름이 `term-interrupt` 가 아닌 이유가 그것이다. */
    'juqode:term-stop': (_e, projectId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      if (!termLive || termLive.projectId !== projectId) return { ok: false, reason: 'not-open' };
      termClose();
      return { ok: true };
    },

    /* WBS-22 · this project's Quick Command history. */
    'juqode:qc-runs': (_e, projectId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      return { ok: true, runs: repo.qcRunsFor(db(), projectId) };
    },

    /* One probe at a time. Each call spawns up to two `claude` processes held for up to 8 s. */
    'juqode:claude-detect': () => {
      if (!detecting) detecting = claude.detect().finally(() => { detecting = null; });
      return detecting;
    },

    'juqode:route-intent': (_e, text) => {
      const bad = guard.text(text, guard.LIMITS.text, { allowEmpty: true });   // before the classifier runs
      return bad ?? { ok: true, route: classify(text) };
    },

    'juqode:task-list': (_e, projectId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      if (!db().prepare('select id from project where id = ?').get(projectId)) return { ok: false, reason: 'no-project' };
      return { ok: true, tasks: repo.tasksForProject(db(), projectId),
        legacyUnknownRuns: unresolvedLegacyUnknownWorks(db(), projectId) };
    },

    'juqode:legacy-unknown-ack': (_e, projectId, workId, confirmedStopped) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      if (confirmedStopped !== true) return { ok: false, reason: 'confirmation-required' };
      const work = workOr(workId);
      if (!work || work.project_id !== projectId || work.task_id != null) {
        return { ok: false, reason: 'not-legacy-work' };
      }
      return repo.acknowledgeUnknownProcessStopped(db(), projectId, workId);
    },

    'juqode:task-create': (_e, projectId, input) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      const bad = guard.taskInput(input);
      if (bad) return bad;
      if (!db().prepare('select id from project where id = ?').get(projectId)) return { ok: false, reason: 'no-project' };
      try { return { ok: true, task: repo.createTask(db(), projectId, input ?? {}) }; }
      catch (error) { return { ok: false, reason: 'invalid-task', detail: guard.taskErrorCode(error) }; }
    },

    'juqode:task-update': (_e, taskId, patch) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(taskId)) return { ok: false, reason: 'no-task' };
      const bad = guard.taskInput(patch ?? {}, { patch: true });
      if (bad) return bad;
      try { return { ok: true, task: repo.updateTask(db(), taskId, patch) }; }
      catch (error) { return { ok: false, reason: 'invalid-task', detail: guard.taskErrorCode(error) }; }
    },

    'juqode:task-detail': (_e, taskId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(taskId)) return { ok: false, reason: 'no-task' };
      const task = repo.getTask(db(), taskId);
      if (!task) return { ok: false, reason: 'no-task' };
      return { ok: true, task, reviews: repo.taskCriterionReviewsFor(db(), task.id),
        runs: repo.worksForTask(db(), task.id, 100).map((run) => ({
          ...supervisor.snapshot(db(), run.id),
          taskSpecCurrent: repo.runMatchesTaskSpec(db(), task, run.id),
        })) };
    },

    'juqode:task-review-criterion': (_e, taskId, workId, criterionId, verdict, evidenceIds) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(taskId)) return { ok: false, reason: 'no-task' };
      if (![taskId, workId, criterionId].every(guard.shortId) || typeof verdict !== 'string' ||
          !Array.isArray(evidenceIds) || evidenceIds.length > guard.LIMITS.criteria * 4 || !evidenceIds.every(guard.shortId)) {
        return { ok: false, reason: 'bad-input' };
      }
      try { return { ok: true, ...repo.reviewTaskCriterion(db(), taskId, workId, criterionId, verdict, evidenceIds) }; }
      catch (error) { return { ok: false, reason: error.code === 'unsupported-verification' ? error.code : 'invalid-review',
        detail: error.code === 'unsupported-verification' ? null : guard.taskErrorCode(error, guard.REVIEW_ERRORS) }; }
    },

    'juqode:task-retry': async (_e, taskId, priorWorkId, retryReason, idempotencyKey, confirmPriorStopped = false) => {
      const gate = needDb();
      if (gate) return gate;
      if (typeof taskId !== 'string' || typeof priorWorkId !== 'string' ||
          typeof retryReason !== 'string' || !retryReason.trim()) {
        return { ok: false, reason: 'bad-retry-request' };
      }
      if (!guard.shortId(taskId) || !guard.shortId(priorWorkId)) return { ok: false, reason: 'bad-retry-request' };
      { const bad = guard.text(retryReason); if (bad) return bad; }
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || !guard.shortId(idempotencyKey)) {
        return { ok: false, reason: 'bad-idempotency-key' };
      }
      if (typeof confirmPriorStopped !== 'boolean') return { ok: false, reason: 'bad-retry-confirmation' };
      const task = repo.getTask(db(), taskId);
      if (!task) return { ok: false, reason: 'no-task' };
      const prior = repo.getWork(db(), priorWorkId);
      if (!prior || prior.task_id !== task.id || prior.project_id !== task.project_id) {
        return { ok: false, reason: 'bad-retry-source' };
      }
      const successor = repo.workForRetrySource(db(), prior.id);
      if (successor) return { ok: true, work: supervisor.snapshot(db(), successor.id), existing: true };
      if (prior.status !== 'ended') return { ok: false, reason: 'retry-run-not-ended' };
      if (prior.outcome === 'ended_unknown' && !confirmPriorStopped) {
        return { ok: false, reason: 'prior-process-may-still-live' };
      }
      if (prior.outcome === 'ended_unknown' && confirmPriorStopped) {
        const acknowledged = repo.acknowledgeUnknownProcessStopped(db(), task.project_id, prior.id);
        if (!acknowledged.ok) return acknowledged;
      }
      const holdWhy = qcHoldReason(task.project_id);
      if (holdWhy) return { ok: false, reason: 'prior-process-may-still-live', detail: { qcRunId: qcUncertain.blocks(task.project_id), restoreFailed: holdWhy === 'qc-restore-failed' } };
      const qcWriter = writerQcLive(task.project_id);
      if (qcWriter) return { ok: false, reason: 'qc-writer-running', detail: { qcRunId: qcWriter.runId, command: qcWriter.command } };
      const latest = repo.worksForTask(db(), task.id, 1)[0];
      if (!latest || latest.id !== prior.id) return { ok: false, reason: 'retry-source-not-latest' };
      const taskRefusal = repo.taskRunRefusal(db(), task.project_id, task.id, { retryOfWorkId: prior.id });
      if (taskRefusal) return { ok: false, reason: taskRefusal };
      const duplicate = repo.workForIdempotency(db(), task.project_id, idempotencyKey);
      if (duplicate) return duplicate.task_id === task.id
        ? { ok: true, work: supervisor.snapshot(db(), duplicate.id), existing: true }
        : { ok: false, reason: 'idempotency-key-conflict' };

      const reason = retryReason.trim();
      workStarting.add(task.project_id);
      let result;
      try { result = await supervisor.start(db(),
        db().prepare('select * from project where id = ?').get(task.project_id), reason, {
          evidenceStore: deps.evidenceStore(task.project_id),
          onUpdate: deps.push,
          taskId: task.id,
          idempotencyKey,
          attempt: (prior.attempt ?? 1) + 1,
          retryOfWorkId: prior.id,
          retryReason: reason,
          appSessionId: deps.appSessionId?.() ?? null,
          allowUnknownWorkId: prior.outcome === 'ended_unknown' && confirmPriorStopped ? prior.id : null,
        }); } finally { workStarting.delete(task.project_id); }
      return result.ok ? { ok: true, work: supervisor.snapshot(db(), result.workId), existing: Boolean(result.existing) } : result;
    },

    'juqode:work-start': async (_e, projectId, intent, taskId = null, idempotencyKey = null) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };
      if (typeof intent !== 'string' || !intent.trim()) return { ok: false, reason: 'empty-intent' };
      { const bad = guard.text(intent); if (bad) return bad; }        // before any DB write or Work
      /* size only: a wrong TYPE of taskId keeps its existing, more specific refusal below */
      if ((typeof taskId === 'string' && taskId.length > guard.LIMITS.id) ||
          (idempotencyKey != null && !guard.shortId(idempotencyKey))) {
        return { ok: false, reason: 'bad-input' };
      }
      if (taskId != null && (typeof idempotencyKey !== 'string' || !idempotencyKey.trim())) {
        return { ok: false, reason: 'bad-idempotency-key' };
      }
      if (idempotencyKey) {
        const existing = repo.workForIdempotency(db(), projectId, idempotencyKey);
        if (existing) return existing.task_id === (taskId ?? null)
          ? { ok: true, work: supervisor.snapshot(db(), existing.id), existing: true }
          : { ok: false, reason: 'idempotency-key-conflict' };
      }
      /* a Quick Command Stop that left something possibly alive: no new Writer, task or not */
      const holdWhy = qcHoldReason(projectId);
      if (holdWhy) return { ok: false, reason: 'prior-process-may-still-live', detail: { qcRunId: qcUncertain.blocks(projectId), restoreFailed: holdWhy === 'qc-restore-failed' } };
      const qcWriter = writerQcLive(projectId);
      if (qcWriter) return { ok: false, reason: 'qc-writer-running', detail: { qcRunId: qcWriter.runId, command: qcWriter.command } };
      if (taskId != null) {
        const uncertain = unknownTaskRunWithLiveRunner(db(), projectId);
        if (uncertain) return { ok: false, reason: 'prior-process-may-still-live', detail: { workId: uncertain.id } };
        const taskRefusal = repo.taskRunRefusal(db(), projectId, taskId);
        if (taskRefusal) return { ok: false, reason: taskRefusal };
      }

      workStarting.add(projectId);
      let r;
      try {
        r = await supervisor.start(db(), row, intent, {
          evidenceStore: deps.evidenceStore(projectId),
          onUpdate: deps.push,
          taskId,
          idempotencyKey,
          appSessionId: deps.appSessionId?.() ?? null,
        });
      } finally { workStarting.delete(projectId); }
      return r.ok ? { ok: true, work: supervisor.snapshot(db(), r.workId) } : r;
    },

    'juqode:work-get': (_e, workId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!workOr(workId)) return { ok: false, reason: 'no-work' };
      const snap = supervisor.snapshot(db(), workId);
      return snap ? { ok: true, work: snap } : { ok: false, reason: 'no-work' };
    },

    'juqode:work-allow': async (_e, workId, toolUseId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!workOr(workId)) return { ok: false, reason: 'no-work' };
      if (toolUseId != null && !guard.shortId(toolUseId)) return { ok: false, reason: 'bad-permission-id' };
      return supervisor.allow(db(), workId, toolUseId ?? null, { onUpdate: deps.push });
    },

    'juqode:work-answer': async (_e, workId, text) => {
      const gate = needDb();
      if (gate) return gate;
      if (!workOr(workId)) return { ok: false, reason: 'no-work' };
      const bad = guard.text(text, guard.LIMITS.text, { allowEmpty: true });
      if (bad) return bad;
      return supervisor.answer(db(), workId, text, { onUpdate: deps.push });
    },

    'juqode:work-cancel': (_e, workId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!workOr(workId)) return { ok: false, reason: 'no-work' };
      return supervisor.cancel(db(), workId, { onUpdate: deps.push });
    },

    /* WBS-20 · History. Every Work this project ever started, newest first, with the one fact
     * each row needs beyond its own outcome: how many files it changed. `12` F-C2-04 — History
     * never disappears, and a failed or cancelled Work stays in it. */
    'juqode:history': (_e, projectId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!guard.shortId(projectId)) return { ok: false, reason: 'no-project' };
      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };

      const store = deps.evidenceStore(projectId);
      const works = repo.worksFor(db(), projectId).map((w) => {
        /* `변경 n개` is a MEASURED number or it is not shown. `changes()` answers `known:false`
         * when the evidence pair cannot tell, and that is carried through rather than flattened
         * to zero — `12` has a state for "we could not tell". */
        const changed = w.status === 'ended' ? supervisor.changes(db(), w.id, row, store) : null;
        return {
          id: w.id, intent: w.intent, status: w.status, outcome: w.outcome,
          startedAt: w.started_at, endedAt: w.ended_at,
          changes: changed && changed.known ? changed.files.length : null,
        };
      });
      return { ok: true, works, orientation: orientationOf(works) };
    },

    'juqode:work-changes': (_e, workId) => {
      const gate = needDb();
      if (gate) return gate;
      const w = workOr(workId);
      if (!w) return { ok: false, reason: 'no-work' };
      const row = db().prepare('select * from project where id = ?').get(w.project_id);
      return { ok: true, ...supervisor.changes(db(), workId, row, deps.evidenceStore(w.project_id)) };
    },

    /* WBS-19b · 되돌리기 — the ONE place JuQode writes to the user's worktree, and it happens
     * only because the user pressed a button that said so.
     *
     * Three gates before any byte moves, and each one is a race that would corrupt the result:
     *   · the Work must have ENDED — a live session is still writing the files we would revert;
     *   · no other Work may be running in this project (D-117's reason, applied here);
     *   · no explanation pass may be in flight — it spawns a child in the same repository.
     */
    'juqode:work-revert': (_e, workId) => {
      const gate = needDb();
      if (gate) return gate;
      const w = workOr(workId);
      if (!w) return { ok: false, reason: 'no-work' };
      if (w.status !== 'ended') return { ok: false, reason: 'still-running' };
      if (repo.activeWork(db(), w.project_id)) return { ok: false, reason: 'work-running' };
      if (explaining.has(w.project_id)) return { ok: false, reason: 'already-explaining' };
      const row = db().prepare('select * from project where id = ?').get(w.project_id);
      return supervisor.revert(db(), workId, row, deps.evidenceStore(w.project_id));
    },

    /* WBS-28 · SC-04. One read: the groups, the diffs they cite, and the blocks already cut.
     * All of it is derived from rows this Work wrote — nothing here asks a model anything. */
    'juqode:work-reader': (_e, workId) => {
      const gate = needDb();
      if (gate) return gate;
      const w = workOr(workId);
      if (!w) return { ok: false, reason: 'no-work' };
      const row = db().prepare('select * from project where id = ?').get(w.project_id);
      return { ok: true, ...supervisor.readerFor(db(), workId, row, deps.evidenceStore(w.project_id)) };
    },

    /* WBS-26 · the explanation pass, run when the USER asks for it. It spawns a Claude Code
     * child, so it is never a side effect of opening a screen — and a Work that is still
     * running is not explained, because the change it would describe is not final. */
    'juqode:work-explain': async (_e, workId) => {
      const gate = needDb();
      if (gate) return gate;
      const w = workOr(workId);
      if (!w) return { ok: false, reason: 'no-work' };
      if (w.status !== 'ended') return { ok: false, reason: 'still-running' };

      /* One pass at a time, and never while a Work is running in the same PROJECT. The pass
       * spawns a Claude Code child in the project directory, so two of them — or one of them
       * alongside a Work — is two sessions in one repository, which is the thing D-117's single
       * active Work exists to prevent. The Work check above is per-Work and cannot see this. */
      if (explaining.has(w.project_id)) return { ok: false, reason: 'already-explaining' };
      if (repo.activeWork(db(), w.project_id)) return { ok: false, reason: 'work-running' };

      const row = db().prepare('select * from project where id = ?').get(w.project_id);
      explaining.add(w.project_id);
      let out;
      try {
        /* No `bin` — `session.run` resolves it through `claude-detect.resolveBin()`, which is
         * the one place `JUQODE_CLAUDE_BIN` is honoured. Passing `deps.claudeBin?.()` looked
         * like a dependency and was always undefined. */
        out = await explain.explain(db(), workId, { cwd: row.path });
      } finally {
        explaining.delete(w.project_id);
      }
      return { ok: out.ok, reason: out.reason, kept: out.kept ?? false,
               ...supervisor.readerFor(db(), workId, row, deps.evidenceStore(w.project_id)) };
    },

    /* `기술 출력 보기` — the raw lines, as they arrived and in the order they arrived. */
    'juqode:work-signals': (_e, workId) => {
      const gate = needDb();
      if (gate) return gate;
      if (!workOr(workId)) return { ok: false, reason: 'no-work' };
      return { ok: true, signals: repo.signalsFor(db(), workId)
        .map((s) => ({ seq: s.seq, source: s.source, kind: s.kind, payload: s.payload, at: s.observed_at })) };
    },
  };

  /* Everything JuQode started, stopped. Called from `before-quit` — NOT an IPC channel, so it
   * is defined off the enumerable surface: the preload/main channel lists must match exactly,
   * and an internal hook in that map would be a channel the renderer could name.
   *
   * A Quick Command child is detached and MEASURABLY outlives its parent, so quitting without
   * this leaves a dev server holding a port the next launch cannot free — the handle goes with
   * the process that held it. */
  /* Every answer leaves through the same scrub of `detail` (V1-409). Sync stays sync. */
  for (const [channel, fn] of Object.entries(handlers)) {
    handlers[channel] = (...args) => {
      const r = fn(...args);
      return r && typeof r.then === 'function' ? r.then((v) => guard.publicOut(channel, v)) : guard.publicOut(channel, r);
    };
  }

  Object.defineProperty(handlers, '__stopAllQc', {
    enumerable: false,
    value: () => {
      const n = qcLive.size;
      for (const entry of qcLive.values()) {
        /* quitting: `stopNow` is the synchronous path (an awaited process snapshot would never finish) */
        try { (entry.handle.stopNow ?? entry.handle.stop)(); } catch { /* already gone */ }
      }
      return n;
    },
  });

  /* …and the shell. It is detached and holds the user's own environment; a JuQode that quits
   * without stopping it leaves a shell running in their project directory with nothing on
   * screen that could ever stop it again. */
  Object.defineProperty(handlers, '__stopAllTerm', {
    enumerable: false,
    value: () => { const n = termLive ? 1 : 0; termClose(); return n; },
  });

  return handlers;
}

module.exports = { makeHandlers };
