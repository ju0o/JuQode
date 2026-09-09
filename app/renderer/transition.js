/* WBS-37 · screen transitions — D-136 · `17` §화면 구성 차별화와 전환.
 *
 * `17` names three navigations and says what each one has to SHOW:
 *
 *   SC-02 → SC-03  보드의 Work 카드가 공유 요소로 모프해 SC-03 의 Work 가 된다.
 *                  **같은 것이라는 사실이 움직임으로 보인다.**
 *   SC-03 → SC-04  결과 영역이 읽기면으로 넓어진다 (높이·폭 보간)
 *   SC-04 → SC-02  읽기면이 접히며 History 로 착지한다
 *
 * All three are the same mechanism — FLIP: measure the element the user is leaving, render the
 * new screen, then start the new element at the old rect and let it settle into its own. The
 * point is the first sentence: the morph is a STATEMENT that the two cards are one thing. It
 * is not decoration, and it must not be able to say anything else.
 *
 * So there are three hard limits, and each is a line in this file:
 *
 *   1. **It never invents progress** (`17`, D-120). The animation is a transform between two
 *      measured rectangles. It has no duration the user is meant to read, no bar, no fill, and
 *      it is over in 360 ms. Nothing here can be told how far along something is, because
 *      nothing here is given anything but two rectangles.
 *   2. **`prefers-reduced-motion: reduce` turns it off entirely** — `17`: 전환은 전부 꺼진다.
 *      상태는 즉시 바뀌고, 어떤 정보도 움직임에만 실려 있지 않다. The guard is on the CAPTURE,
 *      not only on the playback: with no rect there is nothing an animation could be built from.
 *      (CSS `animation: none !important` does NOT stop a Web Animations call, so a guard that
 *      lived only in the stylesheet would be no guard at all.)
 *   3. **The screen is already correct before it moves.** `render()` runs first and the new
 *      screen is complete and readable; the transform is applied afterwards to something that
 *      is already right. A transition that has to finish before the screen makes sense would be
 *      carrying information in movement, which is the thing `17` forbids.
 */
const REDUCED = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  || document.documentElement.classList.contains('reduced');

/** `17` M-03 · M-04 · M-13: 360 ms, spring. `16`'s own tokens, in the units WAAPI wants. */
const DURATION = 360;
const SPRING = 'cubic-bezier(.3,1.25,.4,1)';

const rectOf = (node) => {
  if (!node || REDUCED()) return null;
  const r = node.getBoundingClientRect();
  /* A zero-sized or off-screen element is not a shared element; morphing from it would fling
   * the new card in from nowhere, which reads as an effect rather than as a continuation. */
  return r.width > 0 && r.height > 0 ? r : null;
};

/**
 * Measure a NAMED element on the outgoing screen.
 * @param {string} selector
 * @returns {DOMRect|null} null when motion is off, or when there is nothing to morph from
 */
export const capture = (selector) => rectOf(document.querySelector(selector));

/* The card or panel the user last acted from.
 *
 * This is what makes the morph honest rather than decorative. `17` describes the SC-02 → SC-03
 * transition as 보드의 Work 카드가 공유 요소로 모프 — but the board's representative of a Work
 * is not one fixed element: it is the pending placeholder during a submit, the guard panel when
 * a second request was refused, and a History row when the user opened a finished Work. A
 * hard-coded selector would pick the FIRST match in document order, which for a list of History
 * rows means morphing from a row that is a DIFFERENT Work — the animation would be saying two
 * Works are one thing.
 *
 * So the source is the thing that was pressed. A capture-phase listener records it before any
 * handler can navigate; the statement the morph makes is then exactly "this became that", which
 * is true by construction. */
let acted = null;
let tracking = false;

/** Install the listener. Idempotent — calling it twice does not add a second one. */
export function trackSource() {
  if (tracking) return;
  tracking = true;
  document.addEventListener('click', (e) => {
    acted = e.target instanceof Element
      ? e.target.closest('.card, .panel, .histrow, .nextacts')
      : null;
  }, true);
}

/**
 * The rect of the card or panel the user last acted from, if it is still on screen.
 * @returns {DOMRect|null}
 */
export function actedFrom() {
  const node = acted;
  acted = null;
  /* Already gone — the screen was rebuilt between the click and the navigation, so there is
   * nothing on screen for the new card to have come out of. */
  return node?.isConnected ? rectOf(node) : null;
}

/**
 * Start the incoming element at the captured rect and let it settle into its own.
 * @param {DOMRect|null} from   from `capture()` on the previous screen
 * @param {string} selector     the shared element on the INCOMING screen
 */
export function morph(from, selector) {
  if (!from || REDUCED()) return;
  const node = document.querySelector(selector);
  if (!node) return;
  const to = node.getBoundingClientRect();
  if (!to.width || !to.height) return;

  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  /* Already in the same place at the same size — there is nothing to say, so nothing moves. */
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;

  node.animate([
    { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    { transformOrigin: 'top left', transform: 'none' },
  ], { duration: DURATION, easing: SPRING });
}

export const MOTION = { DURATION, SPRING };
