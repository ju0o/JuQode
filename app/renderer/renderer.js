import { renderSC01 } from './screens/sc01.js';
import { renderSC02 } from './screens/sc02.js';
import { renderSC03 } from './screens/sc03.js';
import { renderSC04 } from './screens/sc04.js';

/* window.juqode is the entire renderer-visible surface (see app/preload/preload.js).
 * If the preload failed, fail loudly rather than silently degrading. */
const api = window.juqode;
if (!api) throw new Error('preload bridge missing — renderer has no API surface');

const root = document.getElementById('root');

/* Two surfaces exist so far. Navigation is a re-render, not a framework: there is no
 * back stack in the MVP — `15` gives every screen an explicit entry action instead. */
const state = { project: null, interpretation: null, recent: [], store: { ok: false }, claude: null,
                workSnapshot: null, screen: 'SC-01',
                /* SC-04's own selection. It lives here rather than in the screen because the
                 * screen is re-rendered on every click — a re-render is the navigation. */
                reader: null, readerGroup: 0, readerRaw: false, readerBlock: null,
                /* A request the product composed for the user to send, or edit, or discard. */
                prefill: null,
                /* WBS-05 · the Brief's own state. `briefFolded` is set by `toWorkbench` when a
                 * project is REOPENED with an interpretation already there — D-132: 다시 열기 →
                 * Brief 접힌 채로. */
                stale: null, briefFolded: false, refreshFailed: null, narrative: null };

const nav = {
  /* `opts.intent` prefills the request field — WBS-19's correction path arrives that way. It is
   * NOT submitted: `12` treats sending as consent to change files, so the user presses 보내기. */
  toWorkbench(project, interpretation = null, opts = {}) {
    state.project = project;
    state.interpretation = interpretation;
    /* D-132: opening a project that already HAS an interpretation shows the Brief folded — the
     * user has read it before, and the screen's subject is the next request. A first open has
     * no interpretation yet, so it stays large. */
    state.briefFolded = Boolean(interpretation);
    state.stale = null;
    state.refreshFailed = null;
    state.workSnapshot = null;
    state.reader = null; state.readerGroup = 0; state.readerRaw = false;
    state.prefill = opts.intent ?? null;
    state.screen = 'SC-02';
    renderSC02(root, api, nav, state);
  },
  toWork(snapshot) {
    state.workSnapshot = snapshot;
    state.reader = null; state.readerGroup = 0; state.readerRaw = false;
    state.screen = 'SC-03';
    renderSC03(root, api, nav, state);
  },
  /* SC-04. The read model is fetched HERE, once, rather than inside the screen: a screen that
   * fetches on render would re-fetch on every group click. */
  async toReader(snapshot, reader = null) {
    state.workSnapshot = snapshot;
    state.reader = reader ?? await api.workReader(snapshot.work.id);
    state.screen = 'SC-04';
    renderSC04(root, api, nav, state);
  },
  async toPicker() {
    state.project = null;
    state.interpretation = null;
    state.workSnapshot = null;
    state.screen = 'SC-01';
    /* Re-read: the recent list changed the moment a project was opened. */
    const b = await api.boot();
    state.store = b.store;
    state.recent = b.recent;
    renderSC01(root, api, nav, state);
  },
};

await nav.toPicker();

/* A running session pushes its state here. The screen follows the SIGNALS — it never polls,
 * because a poll would put a clock where `15` allows only observed facts. */
api.onWorkUpdate?.((snapshot) => {
  if (!snapshot?.work) return;
  /* SC-04 reads a change that has ALREADY happened, so a live update must not redraw it out
   * from under the reader. It refreshes when they navigate, which is when it can be right. */
  if (state.screen !== 'SC-03' || state.workSnapshot?.work?.id !== snapshot.work.id) {
    state.workSnapshot = state.workSnapshot?.work?.id === snapshot.work.id ? snapshot : state.workSnapshot;
    return;
  }
  state.workSnapshot = snapshot;
  renderSC03(root, api, nav, state);
});

/* Test hooks. Read-only: they expose state, they never mutate it. */
window.__screen  = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null;
window.__theme   = () => document.documentElement.getAttribute('data-theme');
window.__project = () => (state.project ? { name: state.project.name, path: state.project.path } : null);
window.__interp  = () => (state.interpretation
  ? { status: state.interpretation.status,
      answers: state.interpretation.answers.map((a) => ({ q: a.q, kind: a.kind, confidence: a.confidence, sourceRef: a.sourceRef })),
      readFiles: state.interpretation.readFiles }
  : null);
window.__claude  = () => state.claude;
window.__work    = () => (state.workSnapshot
  ? { id: state.workSnapshot.work.id, intent: state.workSnapshot.work.intent,
      status: state.workSnapshot.status, outcome: state.workSnapshot.outcome,
      steps: state.workSnapshot.steps.length,
      permission: state.workSnapshot.permission?.tool ?? null,
      signals: state.workSnapshot.signalCount }
  : null);
window.__narrative = () => state.narrative ?? null;
window.__brief = () => ({ folded: state.briefFolded, stale: state.stale,
                          refreshFailed: state.refreshFailed });
window.__reader  = () => (state.reader
  ? { groups: state.reader.groups.map((g) => ({ title: g.title, explainable: g.explainable,
        confidence: g.confidence, files: g.files.map((f) => f.file),
        blocks: g.files.flatMap((f) => f.blocks.map((b) => b.name ?? b.kind)),
        notes: g.files.map((f) => f.note) })),
      selected: state.readerGroup, raw: state.readerRaw, block: state.readerBlock }
  : null);
window.__ready   = true;
