import { renderSC01 } from './screens/sc01.js';
import { renderSC02 } from './screens/sc02.js';

/* window.juqode is the entire renderer-visible surface (see app/preload/preload.js).
 * If the preload failed, fail loudly rather than silently degrading. */
const api = window.juqode;
if (!api) throw new Error('preload bridge missing — renderer has no API surface');

const root = document.getElementById('root');

/* Two surfaces exist so far. Navigation is a re-render, not a framework: there is no
 * back stack in the MVP — `15` gives every screen an explicit entry action instead. */
const state = { project: null, interpretation: null, recent: [], store: { ok: false }, claude: null };

const nav = {
  toWorkbench(project, interpretation = null) {
    state.project = project;
    state.interpretation = interpretation;
    renderSC02(root, api, nav, state);
  },
  async toPicker() {
    state.project = null;
    state.interpretation = null;
    /* Re-read: the recent list changed the moment a project was opened. */
    const b = await api.boot();
    state.store = b.store;
    state.recent = b.recent;
    renderSC01(root, api, nav, state);
  },
};

await nav.toPicker();

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
window.__ready   = true;
