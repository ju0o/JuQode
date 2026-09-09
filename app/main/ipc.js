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
const path = require('node:path');
const repo = require('./db/repo');
const project = require('./project');
const claude = require('./claude-detect');
const supervisor = require('./work/supervisor');
const explain = require('./change/explain');
const { classify } = require('./router/intent');
const { scan } = require('./interpret/scan');
const { answers, statusOf } = require('./interpret/answers');

/**
 * @param {object} deps
 * @param {() => object|null} deps.db            the store, or null when it was refused
 * @param {() => string|null} deps.dbFault       why, if it was
 * @param {(projectId:string) => string} deps.evidenceStore
 * @param {(snapshot:object) => void} deps.push  send a Work update to the window
 * @param {(e:object) => object} [deps.windowFor]
 * @param {() => object} [deps.versions]
 */
/**
 * `18` orient.* — ONE sentence about where the user is, and it must be true.
 *
 * `확인 불가` is reserved: `21` WBS-20 allows it only for a Work that is not ended and whose
 * process could not be found after reconciliation (WBS-34 writes `ended_unknown` for those).
 * Anything that ended states its outcome, however it ended.
 */
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
  const needDb = () => (db() ? null : { ok: false, reason: 'no-store', detail: deps.dbFault?.() ?? null });

  /* A workId is a name the renderer supplies, so every channel that takes one checks the Work
   * exists before acting on it. `19` §S: the bridge is narrow by construction, and "any id in
   * the store" is wider than any screen ever needs. */
  const workOr = (workId) => (typeof workId === 'string' && workId ? repo.getWork(db(), workId) : null);

  let lastPick = null;
  let detecting = null;
  /* Projects with an explanation pass in flight — see `juqode:work-explain`. */
  const explaining = new Set();

  return {
    'juqode:versions': () => deps.versions?.() ?? {},

    'juqode:boot': () => ({
      store: db() ? { ok: true } : { ok: false, reason: deps.dbFault?.() ?? null },
      recent: db() ? project.recent(db()) : [],
    }),

    'juqode:open-project': async (e) => {
      const gate = needDb();
      if (gate) return gate;
      return project.pick(db(), deps.windowFor?.(e) ?? null, (p) => { lastPick = p; });
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
      return project.openPath(db(), target);
    },

    'juqode:interpret': async (_e, projectId) => {
      const gate = needDb();
      if (gate) return gate;
      const hold = Number(process.env.JUQODE_INTERPRET_DELAY_MS) || 0;
      if (hold) await new Promise((r) => setTimeout(r, hold));

      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };

      const scanned = scan(row.path);
      const list = answers(scanned);
      const saved = repo.saveInterpretation(db(), projectId, {
        status: statusOf(scanned, list),
        sourceHash: scanned.sourceHash,
        skippedNote: scanned.skipped ? JSON.stringify(scanned.skipped) : null,
        answers: list,
        readFiles: scanned.readFiles,
      });
      /* The errno travels with the result: `15` SC-02 Failure State asks for the REASON, and a
       * fixed sentence in the renderer would state a cause that may not be the cause. */
      return { ok: true, interpretation: { ...saved, failedCode: scanned.failed ?? null } };
    },

    /* One probe at a time. Each call spawns up to two `claude` processes held for up to 8 s. */
    'juqode:claude-detect': () => {
      if (!detecting) detecting = claude.detect().finally(() => { detecting = null; });
      return detecting;
    },

    'juqode:route-intent': (_e, text) => ({ ok: true, route: classify(String(text ?? '')) }),

    'juqode:work-start': async (_e, projectId, intent) => {
      const gate = needDb();
      if (gate) return gate;
      const row = db().prepare('select * from project where id = ?').get(projectId);
      if (!row) return { ok: false, reason: 'no-project' };
      if (typeof intent !== 'string' || !intent.trim()) return { ok: false, reason: 'empty-intent' };

      const r = await supervisor.start(db(), row, intent, {
        evidenceStore: deps.evidenceStore(projectId),
        onUpdate: deps.push,
      });
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
      if (toolUseId != null && typeof toolUseId !== 'string') return { ok: false, reason: 'bad-permission-id' };
      return supervisor.allow(db(), workId, toolUseId ?? null, { onUpdate: deps.push });
    },

    'juqode:work-answer': async (_e, workId, text) => {
      const gate = needDb();
      if (gate) return gate;
      if (!workOr(workId)) return { ok: false, reason: 'no-work' };
      return supervisor.answer(db(), workId, String(text ?? ''), { onUpdate: deps.push });
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
}

module.exports = { makeHandlers };
