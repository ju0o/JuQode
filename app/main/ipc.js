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
function makeHandlers(deps) {
  const db = () => deps.db();
  const needDb = () => (db() ? null : { ok: false, reason: 'no-store', detail: deps.dbFault?.() ?? null });

  /* A workId is a name the renderer supplies, so every channel that takes one checks the Work
   * exists before acting on it. `19` §S: the bridge is narrow by construction, and "any id in
   * the store" is wider than any screen ever needs. */
  const workOr = (workId) => (typeof workId === 'string' && workId ? repo.getWork(db(), workId) : null);

  let lastPick = null;
  let detecting = null;

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
      const row = db().prepare('select * from project where id = ?').get(w.project_id);
      const out = await explain.explain(db(), workId, { cwd: row.path, bin: deps.claudeBin?.() });
      return { ok: true, reason: out.reason,
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
