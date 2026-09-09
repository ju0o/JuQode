/* SC-02 · Workbench (작업대) — the board this project is worked from.
 *
 * Built here: the shared top bar (`15` §0), the board grid (`16` §4 — 6 columns), the Brief
 * (WBS-03's facts half), and the Work Stream / History empty states, which are TRUE of a
 * project with no Works.
 *
 * NOT built here, and NOT drawn: the Brief's narrative half and fold/stale/refresh (WBS-04,
 * WBS-05), the Intent field (WBS-06's UI), the guard card (WBS-07's UI), Agent Presence
 * (WBS-35), the terminal drawer (WBS-25), the Claude Code 사용 불가 card (WBS-09's UI half).
 *
 * Three of those were drawn in the first cut of this file and were wrong to draw. The Brief
 * slot rendered `지금 안 됨 · 실패 아님` — a chip that means a capability which EXISTS and is
 * blocked right now (12 §16) — for an engine that had not been built. The 사용 불가 card fired
 * on screen entry, while `12` UF-CLAUDE-UNAVAILABLE triggers on 시작 시도 and `15` fixes four
 * recovery buttons on it that belong to four other packages; four inert buttons are a dead end
 * dressed as an exit (UF-CLAUDE-ALT). Both were removed and both land with their trigger.
 *
 * An absent surface is honest. A surface that explains its own absence in borrowed words is not.
 */
import { C } from '../copy.js';
import { el, btn } from '../dom.js';
import { renderBrief } from './brief.js';
import { mountThemeToggle } from '../design/theme.js';

export function renderSC02(root, api, nav, state) {
  root.innerHTML = '';
  const p = state.project;

  const shell = el('div', 'shell');

  const bar = el('div', 'topbar');
  bar.appendChild(el('span', 'brand', C.app.name));
  const id = el('span', 'projid');
  id.appendChild(el('span', 'nm', p.name));
  id.appendChild(el('span', 'xs mut path', p.path));   /* truncation is CSS, so the title stays whole */
  id.title = p.path;
  bar.appendChild(id);
  bar.appendChild(el('span', 'grow'));
  bar.appendChild(btn('btn sm ghost nodrag', C.nav.otherProject, () => nav.toPicker()));
  mountThemeToggle(bar, C.theme);
  shell.appendChild(bar);

  const board = el('main', 'sc02 board fade-in');
  board.setAttribute('data-screen', 'SC-02');

  /* ① Brief — WIDE. Real now: three of the six answers come from files this project actually
   * contains, and the other three say 확인 못함 (`11`: 부분 해석은 실패가 아니다). */
  const brief = card('wide2', 'brief');
  board.appendChild(brief);
  renderBrief(brief, state.interpretation);
  if (!state.interpretation) {
    api.interpret(p.id).then((r) => {
      /* `r.ok === false` means the REQUEST failed (no store, unknown project, a handler that
       * threw). That is not "we could not read the folder", and painting it as one would put
       * a cause on screen that did not happen. The scan's own errno rides on `failedCode`. */
      state.interpretation = r?.ok
        ? r.interpretation
        : { status: 'failed', failedCode: null, answers: [], readFiles: [] };
      renderBrief(brief, state.interpretation);
    });
  }

  /* Work Stream — WIDE. Genuinely empty: this project has no Works, and none can be started
   * until WBS-10. No heading and no actor badge: `18` has no key for this region, and `15` §0
   * scopes the actor badge to a Work / QC CARD, of which there is none. The empty sentence is
   * the whole card, and it is true. (`18` files that string under SC-03 — see CANON_FINDINGS
   * CF-2; SC-03 is one Work and cannot have a "nothing requested yet" state.) */
  const stream = card('wide', 'stream');
  stream.appendChild(el('div', 'sm mut', C.work.empty));
  board.appendChild(stream);

  /* History — M (cols 5–6). Also genuinely empty. */
  const hist = card('m', 'history');
  hist.appendChild(head(C.history.title));
  hist.appendChild(el('div', 'sm mut', C.history.empty));
  hist.appendChild(el('div', 'xs mut2 foot', C.history.note));
  board.appendChild(hist);

  shell.appendChild(board);
  root.appendChild(shell);

  return { shell, board };
}

function card(size, name) {
  const n = el('div', `card c-${size}`);
  n.setAttribute('data-card', name);
  return n;
}

function head(title, right) {
  const h = el('div', 'chead');
  h.appendChild(el('span', 'ct', title));
  h.appendChild(el('span', 'grow'));
  if (right) h.appendChild(right);
  return h;
}

