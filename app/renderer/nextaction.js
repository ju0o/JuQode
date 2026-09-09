/* WBS-38 · 다음 행동 ≠ NEXT — D-136 · D-107 · `17` §다음 행동 ≠ NEXT.
 *
 * Two things sit near each other on SC-03 and SC-04 and mean opposite things:
 *
 *   NEXT       Claude Code declared this. If it declared nothing the slot is EMPTY and stays
 *              empty (D-107) — a Step list tile and a slot, no buttons, nothing to press.
 *   다음 행동   JuQode is offering the user a choice. It comes from the SCREEN's state, so it
 *              is there whether or not the agent said anything.
 *
 * `17`'s absolute rule: **JuQode 의 권유가 Agent 가 선언한 작업처럼 보이면 안 된다. 두 요소는
 * 같은 시각 처리를 쓰지 않고, 다음 행동이 NEXT 슬롯을 채우지 않는다.**
 *
 * So the two are separated three ways, and each one is measured:
 *   1. **Voice.** The heading is JuQode's teal (`--juq`); the NEXT slot is Claude's purple
 *      (`--claude`). `16`'s actor colours already mean exactly this, so nothing new is invented.
 *   2. **Shape.** 다음 행동 is buttons. NEXT is text, and it can never be a button — a control
 *      in the NEXT slot would be the user pressing something Claude "said".
 *   3. **Words.** The block says so out loud: `18` `next.gloss` — JuQode가 드리는 선택 —
 *      Claude Code가 알린 일이 아니에요.
 *
 * There is deliberately no way to pass this function a "declared step". It renders buttons the
 * caller built; it cannot be handed the NEXT slot's content by mistake.
 */
import { C } from './copy.js';
import { el } from './dom.js';

/**
 * The 다음 행동 block.
 * @param {HTMLElement[]} buttons  JuQode's choices, already built by the caller
 * @returns {HTMLElement}
 */
export function nextActions(buttons) {
  const box = el('div', 'nextacts');
  box.setAttribute('data-el', 'next-actions');

  const head = el('div', 'nahead');
  head.appendChild(el('span', 'nalabel', C.next.label));
  /* Not a tooltip and not a hover: the sentence that keeps the two apart is the one a confused
   * user most needs, so it is on the screen. */
  head.appendChild(el('span', 'xs mut2 nagloss', C.next.gloss));
  box.appendChild(head);

  const row = el('div', 'row-acts');
  for (const b of buttons) row.appendChild(b);
  box.appendChild(row);
  return box;
}
