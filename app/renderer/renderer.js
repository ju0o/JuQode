import { renderSC01 } from './screens/sc01.js';
import { renderSC02 } from './screens/sc02.js';
import { renderSC03 } from './screens/sc03.js';
import { renderSC04 } from './screens/sc04.js';
import { mountDrawer } from './screens/td01.js';
import { capture, morph, actedFrom, trackSource } from './transition.js';

/* window.juqode is the entire renderer-visible surface (see app/preload/preload.js).
 * If the preload failed, fail loudly rather than silently degrading. */
const api = window.juqode;
if (!api) throw new Error('preload bridge missing — renderer has no API surface');

const root = document.getElementById('root');

/* Two surfaces exist so far. Navigation is a re-render, not a framework: there is no
 * back stack in the MVP — `15` gives every screen an explicit entry action instead. */
const state = { project: null, interpretation: null, recent: [], store: { ok: false }, claude: null,
                /* WBS-33 · what boot said about THIS build's signature. */
                signature: null,
                workSnapshot: null, screen: 'SC-01',
                /* SC-04's own selection. It lives here rather than in the screen because the
                 * screen is re-rendered on every click — a re-render is the navigation. */
                reader: null, readerGroup: 0, readerRaw: false, readerBlock: null,
                /* A request the product composed for the user to send, or edit, or discard. */
                prefill: null,
                /* WBS-05 · the Brief's own state. `briefFolded` is set by `toWorkbench` when a
                 * project is REOPENED with an interpretation already there — D-132: 다시 열기 →
                 * Brief 접힌 채로. */
                stale: null, briefFolded: false, refreshFailed: null, narrative: null,
                rereading: false,
                /* TD-01 · the drawer and its Quick Command card. It lives OUTSIDE `#root`, so
                 * its state survives every screen render — `15`: 닫으면 화면 상태가 보존된다. */
                drawerOpen: false, qcPhrase: '', qcCard: null, qcRun: null,
                qcDiscover: null, qcOutputOpen: false, toWork: null, drawerProject: null };

/* The drawer lives OUTSIDE `#root`, so navigation does not redraw it — which means its state
 * survives a project switch unless something clears it. A Quick Command card explains a command
 * built from ONE project's package.json, and `실행` reads `state.project.id` at CLICK time: a
 * card confirmed in project A would run project A's command string against project B's scripts.
 * `19` §C4's whole mechanism is 항상 설명 후 확인, and that is only worth anything if the thing
 * confirmed is the thing that runs. */
/* Assigned below, after the first render. `nav.toPicker()` runs before the drawer is mounted,
 * so this is a `let` rather than a const the router closes over too early. */
let drawer = null;

function clearDrawerState() {
  state.qcPhrase = '';
  state.qcCard = null;
  state.qcRun = null;
  state.qcDiscover = null;
  state.qcOutputOpen = false;
  state.toWork = null;
  /* …and the drawer closes with the project, because a drawer left open over SC-01 has no cwd
   * to act in and every control in it would fail on a null project. */
  state.drawerOpen = false;
}

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
    /* `15` §0 Board: History opens folded (M) and the user expands it (L). Reset on arrival —
     * an expansion belongs to the visit that made it, not to the project. */
    state.historyExpanded = false;
    state.stale = null;
    state.refreshFailed = null;
    /* A different project means a different set of scripts — see `clearDrawerState`. */
    if (state.drawerProject && state.drawerProject !== project?.id) clearDrawerState();
    state.drawerProject = project?.id ?? null;
    state.workSnapshot = null;
    state.reader = null; state.readerGroup = 0; state.readerRaw = false;
    state.prefill = opts.intent ?? null;
    /* `15` §Keyboard: focus returns to the request field after `이해했어요 · 다음 요청으로`.
     * Only then — an automatic focus on every arrival would steal it from the Brief, which is
     * SC-02's subject on a first open. */
    const focusIntent = opts.focusIntent === true;
    /* `17`: 읽기면이 접히며 History 로 착지한다 — only from SC-04, which is the only screen the
     * sentence is about. Coming from anywhere else there is no reading surface to fold. */
    const from = state.screen === 'SC-04' ? capture('.sc04') : null;
    state.screen = 'SC-02';
    const { field } = renderSC02(root, api, nav, state);
    morph(from, '.sc02 [data-card="history"]');
    if (focusIntent) field?.focus();
  },
  toWork(snapshot) {
    /* WBS-37 · `17`: 보드의 Work 카드가 공유 요소로 모프해 SC-03 의 Work 가 된다.
     *
     * On the way from a submit the shared element is the pending placeholder (M-04: pending →
     * Work card); arriving from the guard's 열기 or an orientation line it is whatever card
     * stands for that Work on the board. Measured BEFORE the render, because the render clears
     * `#root` and the rect goes with it. */
    const from = actedFrom() ?? capture('[data-el="pending"]');
    state.workSnapshot = snapshot;
    state.reader = null; state.readerGroup = 0; state.readerRaw = false;
    state.screen = 'SC-03';
    renderSC03(root, api, nav, state);
    morph(from, '.sc03 [data-card="work"]');
  },
  /* SC-04. The read model is fetched HERE, once, rather than inside the screen: a screen that
   * fetches on render would re-fetch on every group click. */
  async toReader(snapshot, reader = null) {
    /* `17`: 결과 영역이 읽기면으로 넓어진다. The result card is the thing that widens, so it is
     * the thing measured — and it is measured BEFORE the await, because a slow read would
     * otherwise capture a screen the user has already scrolled. */
    const from = actedFrom() ?? capture('.sc03 [data-card="result"]');
    state.workSnapshot = snapshot;
    state.reader = reader ?? await api.workReader(snapshot.work.id);
    state.screen = 'SC-04';
    renderSC04(root, api, nav, state);
    morph(from, '.sc04');
  },
  async toPicker() {
    state.project = null;
    clearDrawerState();
    state.drawerProject = null;
    drawer?.paint();
    state.interpretation = null;
    state.workSnapshot = null;
    state.screen = 'SC-01';
    /* Re-read: the recent list changed the moment a project was opened. */
    const b = await api.boot();
    state.store = b.store;
    state.recent = b.recent;
    state.signature = b.signature ?? null;
    renderSC01(root, api, nav, state);
  },
};

trackSource();
await nav.toPicker();

/* TD-01 · mounted ONCE, over whatever screen is up. `15`: the drawer covers the bottom of the
 * current screen and closing it preserves what is underneath — so it cannot be a child of
 * `#root`, which every screen render clears. */
drawer = mountDrawer(api, state, () => {
  /* A card can hand a phrase back to the Work path (미인식 · 모호함 → Claude Code 작업). That
   * is a NAVIGATION, and it belongs to the router rather than to the drawer. */
  if (state.toWork && state.project) {
    const intent = state.toWork;
    state.toWork = null;
    state.drawerOpen = false;
    drawer.paint();
    nav.toWorkbench(state.project, state.interpretation, { intent });
  }
});

/* A Quick Command's live tail. Its own channel — a QC update is not a Work update. */
api.onQcUpdate?.((u) => {
  if (!u || !state.qcRun || u.runId !== state.qcRun.runId) return;
  state.qcRun = { ...state.qcRun, ...u };
  drawer.paint();
});

/* `15` §0: the terminal toggle is on every screen's top bar, and `` Ctrl+` `` opens it. */
window.addEventListener('keydown', (e) => {
  if (e.key !== '`' || !(e.ctrlKey || e.metaKey)) return;
  if (!state.project) return;                 // there is no project cwd to open it in yet
  e.preventDefault();
  state.drawerOpen = !state.drawerOpen;
  drawer.paint();
});

/* `15` §Keyboard: `Esc` closes TD-01 / the discover panel — and **never cancels a Work.**
 *
 * That last clause is the reason this handler is written as a closed list rather than as "undo
 * whatever is open": cancelling a Work is a decision with consequences on disk, and `15` DS §1
 * gives it one ink-outlined button on SC-03 with a sub-line explaining what it does and does
 * not do. A key that could reach it is a key that could take that decision by accident.
 *
 * Innermost first: the panel inside the drawer, then the drawer. Pressing Esc twice closes
 * both, and pressing it with neither open does nothing at all. */
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.qcDiscover) {
    e.preventDefault();
    state.qcDiscover = null;
    drawer.paint();
    return;
  }
  if (state.drawerOpen) {
    e.preventDefault();
    state.drawerOpen = false;
    drawer.paint();
  }
});

/* The top-bar toggle each screen draws calls this. */
/* D-134 · `15` SC-02: opening the drawer FROM the request field carries the user's sentence into
 * the Quick Command box, so they do not retype what they already said. */
window.__openDrawerWith = (phrase) => {
  if (!state.project) return;
  state.qcPhrase = String(phrase ?? '');
  state.qcCard = null;
  state.qcRun = null;
  state.drawerOpen = true;
  drawer.paint();
};

window.__toggleDrawer = () => {
  if (!state.project) return;
  state.drawerOpen = !state.drawerOpen;
  drawer.paint();
};

/* A running session pushes its state here. The screen follows the SIGNALS — it never polls,
 * because a poll would put a clock where `15` allows only observed facts. */
api.onWorkUpdate?.((snapshot) => {
  if (!snapshot?.work) return;
  /* SC-04 reads a change that has ALREADY happened, so a live update must not redraw it out
   * from under the reader. It refreshes when they navigate, which is when it can be right. */
  if (state.screen !== 'SC-03' || state.workSnapshot?.work?.id !== snapshot.work.id) {
    /* Only the Work this screen is HOLDING. A push for a different Work must not overwrite it:
     * SC-04 reads a change that has already happened, and swapping the snapshot under it would
     * put another Work's changes on a screen the user opened for this one. */
    if (state.workSnapshot?.work?.id === snapshot.work.id) state.workSnapshot = snapshot;
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
window.__drawer = () => ({ open: state.drawerOpen, phrase: state.qcPhrase,
                           discover: Boolean(state.qcDiscover),
                           card: state.qcCard ? { kind: state.qcCard.route?.kind ?? null,
                                                  id: state.qcCard.route?.id ?? null,
                                                  available: state.qcCard.available ?? null,
                                                  reason: state.qcCard.reason ?? null } : null,
                           run: state.qcRun ? { state: state.qcRun.state, code: state.qcRun.code ?? null,
                                                ended: Boolean(state.qcRun.ended) } : null });
window.__reader  = () => (state.reader
  ? { groups: state.reader.groups.map((g) => ({ title: g.title, explainable: g.explainable,
        confidence: g.confidence, files: g.files.map((f) => f.file),
        blocks: g.files.flatMap((f) => f.blocks.map((b) => b.name ?? b.kind)),
        notes: g.files.map((f) => f.note) })),
      selected: state.readerGroup, raw: state.readerRaw, block: state.readerBlock }
  : null);
window.__ready   = true;
