/* WBS-37 · screen transitions — D-136 · `17` §화면 구성 차별화와 전환.
 *
 * `21` WBS-37's Tests column names a reduced-motion UNIT test, and this is it. The rest of the
 * package is geometry and playback, which only a browser can answer — those live in
 * `tests/e2e/visual.mjs`, which measures the five surfaces' compositions, watches each of the
 * three named transitions actually run, and watches them all disappear under
 * `prefers-reduced-motion: reduce`.
 *
 * What is checkable here is the SHAPE of the guard, and it matters more than it looks: the
 * stylesheet's `animation: none !important` stops CSS animations and does NOTHING to a Web
 * Animations call. A transition built with `element.animate()` and guarded only by CSS would
 * keep running for every user who asked for less motion.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const { code: read, text: raw } = require(path.join(__dirname, 'src.js'));
const SRC = read('app/renderer/transition.js');
const ROUTER = read('app/renderer/renderer.js');

test('reduced motion is checked before anything is measured, not only before it plays', () => {
  /* The guard is on the CAPTURE. With no rect there is nothing an animation could be built
   * from, so the reduced-motion path cannot animate even if a future caller forgets. */
  assert.ok(/const REDUCED = \(\) => window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)/.test(SRC),
    'the module does not read prefers-reduced-motion');
  assert.ok(/const rectOf = \(node\) => \{\s*\n\s*if \(!node \|\| REDUCED\(\)\) return null;/.test(SRC),
    'measuring does not check reduced motion');
  /* …and again at playback, because `capture()` is not the only way a rect can arrive. */
  assert.ok(/export function morph\(from, selector\) \{\s*\n\s*if \(!from \|\| REDUCED\(\)\) return;/.test(SRC),
    'playing does not check reduced motion');
});

test('the CSS reduced-motion rule cannot reach a Web Animations call — so the JS guard is it', () => {
  /* This is the reason the test above exists, stated as the thing it is protecting. If a
   * future refactor moves the transition to a CSS class, this stops being load-bearing — but
   * while `animate(` is here, the stylesheet is not the guard. */
  assert.ok(SRC.includes('.animate('), 'the transition is no longer a Web Animations call');
  const base = read('app/renderer/design/base.css');
  assert.match(base, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}animation:\s*none\s*!important/);
});

test('nothing in a transition can express an amount', () => {
  /* `17` · D-120: 모션이 Agent 의 진행을 지어내지 않는다. The module is handed two rectangles
   * and nothing else — there is no parameter a fraction could arrive through, and no word for
   * one in the code. */
  const code = SRC;
  for (const banned of ['percent', 'progress', 'eta', 'remaining', 'ratio', 'step']) {
    assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(code), `transition.js speaks of ${banned}`);
  }
  /* One duration, and it is `17` M-03's 360 ms. A transition long enough to read as waiting is
   * a progress indicator with no bar. */
  assert.ok(/const DURATION = 360;/.test(SRC));
  const durations = [...code.matchAll(/duration:\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(durations, ['DURATION'], 'a transition has its own duration');
});

test('the morph is not game-like: one spring, no overshoot beyond 17\'s own token', () => {
  /* `17`: 게임 같은 모션은 쓰지 않는다, and its Anti-patterns ban `bounce > 1.25 overshoot`.
   * The easing is `16`'s `--ease-spring` value, transcribed — the 1.25 in it IS that ceiling. */
  const tokens = read('app/renderer/design/tokens.css');
  const spring = /--ease-spring:\s*(cubic-bezier\([^)]*\))/.exec(tokens);
  assert.ok(spring, 'tokens.css has no --ease-spring');
  assert.ok(SRC.includes(spring[1]), `the morph easing is not --ease-spring (${spring[1]})`);
});

test('the screen is complete before it moves', () => {
  /* `17`: 어떤 정보도 움직임에만 실려 있지 않다. Every navigation renders FIRST and morphs
   * afterwards, so a user with the animation disabled — or one who blinks — sees the same,
   * finished screen. A morph called before the render would be animating the old screen. */
  for (const [nav, render, target] of [
    ['toWork', 'renderSC03', '.sc03 [data-card="work"]'],
    ['toReader', 'renderSC04', '.sc04'],
    ['toWorkbench', 'renderSC02', '.sc02 [data-card="history"]'],
  ]) {
    const i = ROUTER.indexOf(`${render}(root, api, nav, state);`);
    assert.ok(i > -1, `${nav} no longer renders through ${render}`);
    const j = ROUTER.indexOf(`morph(from, '${target}');`);
    assert.ok(j > i, `${nav} morphs before it renders`);
  }
});

test('the shared element is the thing the user pressed', () => {
  /* A hard-coded selector picks the FIRST match in document order. For a History list that is
   * a row belonging to a DIFFERENT Work, and the morph would then be saying two Works are one
   * thing — the animation asserting something false. The source is recorded by a
   * capture-phase listener, before any handler can navigate. */
  assert.ok(/document\.addEventListener\('click',[\s\S]{0,240}\}, true\);/.test(SRC),
    'the source is not recorded in the capture phase');
  assert.ok(SRC.includes(".closest('.card, .panel, .histrow, .nextacts')"),
    'the recorded source is not the card or panel that was pressed');
  /* …and a source that has already left the DOM is not a source. */
  assert.ok(/node\?\.isConnected \? rectOf\(node\) : null/.test(SRC),
    'a detached element can still be morphed from');
  assert.ok(ROUTER.includes('trackSource();'), 'the listener is never installed');
});

test('`15` Board: each surface builds the card sizes its row names', () => {
  /* MEASURED as a mutation survivor: dropping SC-03's Work card from L to M left the e2e
   * geometry check passing, because the card's CONTENT is tall enough to stay the biggest
   * thing on the screen either way. "Is it dominant" and "is it the size `15` says" are two
   * different claims, and only the first one was being made.
   *
   * `15` §0 Board — SC-03: Work L · Presence S · request/state cards M · technical output S ·
   * Result WIDE · folded Brief WIDE. */
  const sc03 = read('app/renderer/screens/sc03.js');
  const cardClass = (name) => {
    const i = sc03.indexOf(`card.setAttribute('data-card', '${name}');`);
    assert.ok(i > -1, `SC-03 has no ${name} card`);
    const decl = sc03.slice(0, i).lastIndexOf("el('div', 'card ");
    return /el\('div', 'card ([a-z0-9 -]+)'\)/.exec(sc03.slice(decl))[1];
  };
  assert.strictEqual(cardClass('work'), 'c-l', 'SC-03 the Work card is not L — `15` Board says L');
  assert.strictEqual(cardClass('steps'), 'c-m');
  assert.strictEqual(cardClass('about'), 'c-m');
  /* Presence is S on both screens it appears on (`16` §125 · `15` §42). */
  const presence = read('app/renderer/presence.js');
  assert.ok(/el\('div', 'card c-s presence'\)/.test(presence), 'the Presence card is not S');
});

test('a morph that would say nothing does not run', () => {
  /* Same place, same size — there is no "this became that" to show, so showing something would
   * be motion for its own sake. `17` bans exactly that. */
  assert.ok(/if \(Math\.abs\(dx\) < 1 && Math\.abs\(dy\) < 1 && Math\.abs\(sx - 1\) < 0\.01 && Math\.abs\(sy - 1\) < 0\.01\) return;/.test(SRC));
  /* …and neither does one from a zero-sized element. */
  assert.ok(/r\.width > 0 && r\.height > 0 \? r : null/.test(SRC));
});

/* ── a push for another Work never lands on the screen you are looking at ─────────────────── */

test('an off-screen snapshot is replaced only for the Work being held', () => {
  /* FOUND BY MUTATION: `state.workSnapshot?.work?.id === snapshot.work.id ? snapshot : …`
   * could be inverted, so a push for a DIFFERENT Work would overwrite the one being held and
   * the matching one would be thrown away.
   *
   * SC-04 reads a change that has ALREADY happened, and the router deliberately does not redraw
   * it out from under the reader. Swapping the snapshot underneath would put another Work's
   * changes on a screen the user opened for this one — and it would do it silently, because
   * the screen does not re-render. */
  const src = read('app/renderer/renderer.js');
  assert.ok(/if \(state\.workSnapshot\?\.work\?\.id === snapshot\.work\.id\) state\.workSnapshot = snapshot;/.test(src),
    'the held snapshot is replaced without checking which Work the push is about');
  /* …and only when the screen is NOT the one showing it — the SC-03 path redraws instead. */
  const guard = /if \(state\.screen !== 'SC-03' \|\| state\.workSnapshot\?\.work\?\.id !== snapshot\.work\.id\) \{/;
  assert.ok(guard.test(src), 'the live-update guard no longer distinguishes the screen in view');
});
