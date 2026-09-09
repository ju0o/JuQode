/* WBS-36 · Light / Dark theme — `21` WBS-36 · D-135 · `16` §2 · §2.1.
 *
 * D-135's sentence is the whole acceptance: 두 테마 각각에 완전한 토큰 집합을 정의하고 … 양쪽에서
 * 읽히고 의미를 유지해야 한다. 색 문법이 어두운 테마에서 무너지면 그 테마는 실패다.
 *
 * Two halves, and this file is the FIRST one:
 *
 *   · READABLE — every text colour clears WCAG AA against every surface it can land on, in
 *     both themes. That is a property of the TOKEN FILE, so it is checked here, exhaustively,
 *     rather than one sampled button at a time in the browser.
 *   · MEANING KEPT — the five state vocabularies stay apart, including the amber pair that
 *     shares a hue on purpose. That one needs a real cascade and lives in `tests/e2e/visual.mjs`.
 *
 * Why AA and not "it looks fine": `21` WBS-36 asks for a 토큰 대비비 단위 테스트 by name, and a
 * contrast test with no threshold is a test that cannot fail. 4.5 : 1 is WCAG 1.4.3 for normal
 * text, which is what all of this is — the smallest type in the product is 10 px.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.resolve(__dirname, '..', 'app/renderer/design/tokens.css'), 'utf8');

/** The declarations of one rule block, by selector. */
function block(sel) {
  const i = CSS.indexOf(`\n${sel}`);
  assert.ok(i > -1, `rule ${sel} not found in tokens.css`);
  const open = CSS.indexOf('{', i);
  const body = CSS.slice(open, CSS.indexOf('\n}', open));
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const LIGHT = block(':root {');
const DARK = block(':root[data-theme="dark"] {');

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `${hex} is not a six-digit hex — the contrast of a token cannot be computed`);
  const ch = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const AA = 4.5;

/* Where each colour can actually land.
 *
 * The neutral surfaces are the four a card, a sub-panel, the board itself and the 지금 안 됨
 * panel paint; every text token can appear on any of them. Each state colour additionally has
 * its own tinted background. Pairs that cannot co-occur (recovery green on the failure tint)
 * are not asserted — a test that constrains combinations the product never renders would be
 * dictating a palette rather than measuring one. */
const NEUTRAL = ['--card', '--card2', '--board', '--grey'];
const TEXT = ['--ink', '--ink2', '--mut', '--mut2'];
const STATE = [['--fail', '--failbg'], ['--part', '--partbg'], ['--wait', null],
               ['--unk', '--unkbg'], ['--rec', '--recbg'],
               ['--claude', '--claudebg'], ['--juq', '--juqbg']];

for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
  test(`${name}: every text colour clears AA on every surface it can land on`, () => {
    const failures = [];
    const check = (fg, bg) => {
      const r = contrast(T[fg], T[bg]);
      if (r < AA) failures.push(`${fg} on ${bg} = ${r.toFixed(2)}:1`);
    };
    for (const fg of TEXT) for (const bg of NEUTRAL) check(fg, bg);
    for (const [fg, own] of STATE) {
      for (const bg of NEUTRAL) check(fg, bg);
      if (own) check(fg, own);
    }
    assert.deepStrictEqual(failures, [],
      `${name} theme is below WCAG AA (${AA}:1):\n  ${failures.join('\n  ')}`);
  });

  test(`${name}: the four text ranks are actually four`, () => {
    /* MEASURED and fixed in this package: light `--mut2` was #8a93a0, which is 3.11 : 1 on a
     * card and 2.72 : 1 on the board — below even the 3 : 1 floor for large text, for a rank
     * that carries real sentences (the presence card's 진행 정도를 뜻하지 않아요 among them).
     * Raising it to AA squeezed it toward `--mut`, so `--mut` moved down as well; without that
     * the two would have collapsed into one rank and the fix would have traded a readability
     * failure for a hierarchy failure. Both are asserted, so neither can be paid for the other. */
    const ranks = TEXT.map((t) => ({ t, l: luminance(T[t]) }));
    for (let i = 1; i < ranks.length; i++) {
      const step = contrast(T[ranks[i - 1].t], T[ranks[i].t]);
      assert.ok(step >= 1.15,
        `${ranks[i - 1].t} and ${ranks[i].t} are ${step.toFixed(2)}:1 apart — the same rank twice`);
    }
    /* …and they are ordered: each rank is quieter against the page than the one above it. */
    const away = TEXT.map((t) => contrast(T[t], T['--card']));
    for (let i = 1; i < away.length; i++) {
      assert.ok(away[i] < away[i - 1], `${TEXT[i]} is not quieter than ${TEXT[i - 1]}`);
    }
  });
}

test('the amber pair shares its hue in BOTH themes — the distinction is fill vs outline', () => {
  /* `16` §2.1: amber FILL is 부분, amber OUTLINE is 대기. They are the SAME colour on purpose,
   * and `21` WBS-36's named failure is the two becoming indistinguishable in dark. Making them
   * different hues would "fix" that by breaking the grammar, so the token file must keep them
   * equal and the separation is carried by fill/outline — measured on the real cascade in
   * `tests/e2e/visual.mjs`, which is the only place a border style exists. */
  assert.strictEqual(LIGHT['--part'], LIGHT['--wait']);
  assert.strictEqual(DARK['--part'], DARK['--wait']);
});

test('red is one token family and it is the failure family', () => {
  /* `16` §2.1: 붉은색은 실패 하나뿐. A second red-ish token is how that rule dies quietly.
   *
   * By HUE, not by "r is the largest channel" — amber is r-dominant too, and a first draft of
   * this test reported `--part` and `--wait` as reds. That is exactly the confusion `16` §2.1
   * is guarding against, so the test has to be able to tell them apart: red sits within 15° of
   * 0° on the wheel, amber lands around 25–35°. Greys are excluded by chroma, not by hue —
   * a near-neutral has a hue and it means nothing. */
  const hsv = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return { h: 0, chroma: 0 };
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return { h, chroma: d };
  };
  for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
    const reds = Object.entries(T)
      .filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v))
      .filter(([, v]) => { const { h, chroma } = hsv(v); return chroma > 0.12 && (h < 15 || h > 345); })
      .map(([k]) => k);
    /* Every chromatic red belongs to the failure family. Naming the exact members would pin the
     * count of tints instead of the rule; what `16` §2.1 forbids is a red that means something
     * ELSE. (`--failbg` sits below the chroma floor in both themes — it is a tint, which is the
     * point of it.) */
    assert.ok(reds.length >= 1, `${name}: nothing is red at all — the failure colour is missing`);
    for (const t of reds) {
      assert.ok(t.startsWith('--fail'), `${name}: ${t} is red and is not the failure colour`);
    }
  }
  /* …and the amber pair is amber, not red: the check above is only meaningful if it can see
   * the difference it claims to see. */
  for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
    const { h } = hsv(T['--part']);
    assert.ok(h > 15 && h < 60, `${name}: --part is at ${Math.round(h)}°, which is not amber`);
  }
});

test('the presence tints are readable on a card in both themes', () => {
  /* D-135 names Agent Presence in its list of things that must keep working in both themes.
   * The cloud is drawn at partial alpha, so this is the ceiling rather than what is painted —
   * but a tint that cannot clear AA at full strength has no chance at .42. */
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'app/renderer/presence.js'), 'utf8');
  const tints = [...src.matchAll(/tint: '(--[a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.strictEqual(new Set(tints).size >= 6, true, `only ${new Set(tints).size} distinct tints`);
  for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
    for (const t of new Set(tints)) {
      assert.ok(T[t], `${name}: presence uses ${t}, which this theme does not define`);
      const r = contrast(T[t], T['--card']);
      assert.ok(r >= AA, `${name}: presence tint ${t} is ${r.toFixed(2)}:1 on a card`);
    }
  }
});

test('D-135 · there is no settings screen — the theme control is one toggle', () => {
  /* `21` WBS-36's named scope violation: 설정 화면이 생김 → 범위 위반. The toggle is three
   * buttons in the top bar and there is no route, screen or panel behind it. */
  const theme = fs.readFileSync(path.resolve(__dirname, '..', 'app/renderer/design/theme.js'), 'utf8');
  assert.ok(/light/.test(theme) && /dark/.test(theme) && /system/.test(theme),
    'the toggle does not offer all three of light / dark / system');
  const renderer = fs.readFileSync(path.resolve(__dirname, '..', 'app/renderer/renderer.js'), 'utf8');
  for (const banned of ['SC-05', 'settings', 'Settings', '설정']) {
    assert.ok(!renderer.includes(banned), `the renderer has a ${banned} route — D-135 forbids one`);
  }
  const screens = fs.readdirSync(path.resolve(__dirname, '..', 'app/renderer/screens'));
  assert.deepStrictEqual(screens.filter((f) => /setting/i.test(f)), []);
});

test('the toggle wins over the OS in both directions', () => {
  /* The regression this codebase already shipped once: a token redefined in the
   * prefers-color-scheme block but not in [data-theme="dark"] is correct only while the OS
   * already prefers dark. Windows defaults to light, so that is the shipping path.
   *
   * `tests/unit.test.js` checks the two dark blocks agree. The other direction is this one:
   * an OS that prefers dark must be overridable back to light, which only works because the
   * media block is guarded by :root:not([data-theme="light"]). */
  assert.match(CSS, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  /* …and the light palette is on BARE :root, so `data-theme="light"` has something to fall
   * back to. A light palette defined only under a media query would leave the override empty. */
  const i = CSS.indexOf('\n:root {');
  assert.ok(i > -1 && i < CSS.indexOf('@media'), 'the light palette is not on bare :root');
});
