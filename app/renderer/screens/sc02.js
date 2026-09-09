/* SC-02 · Workbench (작업대) — the board this project is worked from.
 *
 * Built here: the shared top bar (`15` §0), the board grid (`16` §4 — 6 columns),
 * and the Work Stream / History empty states, which are TRUE of a project with no Works.
 *
 * NOT built here, and NOT drawn: the Brief (WBS-03/04/05), the Intent field and routing
 * (WBS-06), the guard card (WBS-07), Agent Presence (WBS-35), the terminal drawer (WBS-25),
 * and the Claude Code 사용 불가 card (WBS-09's UI half).
 *
 * Two of those were drawn in the first cut of this file and were wrong to draw:
 *   - The Brief slot rendered `지금 안 됨 · 실패 아님`. That chip means a capability that
 *     EXISTS and is blocked right now (12 §16). The interpretation engine does not exist.
 *     Borrowing the chip for something never built is the exact lie the chip prevents.
 *   - The 사용 불가 card fired on screen entry. `12` UF-CLAUDE-UNAVAILABLE triggers on
 *     시작 시도, and `15` fixes four recovery buttons on it that belong to WBS-04, 22, 25
 *     and 06. None exist, so the card would be a dead end dressed as an exit
 *     (UF-CLAUDE-ALT: 막다른 길로 끝나지 않는다). Detection itself is built and tested;
 *     the card lands with its trigger. See docs/dev-evidence/mvp-run/CANON_FINDINGS.md CF-3.
 *
 * An absent surface is honest. A surface that explains its own absence in borrowed words is not.
 */
import { C } from '../copy.js';
import { el, btn } from '../dom.js';
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

