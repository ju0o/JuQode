/* WBS-38 · 다음 행동 ≠ NEXT — D-136 · D-107 · `17` §다음 행동 ≠ NEXT.
 *
 * `21` WBS-38's Tests column asks for a NEGATIVE test: 다음 행동이 NEXT 로 렌더되면 실패.
 * A negative test is only worth anything if the thing it forbids is reachable, so this file
 * checks the structure that makes it unreachable rather than asserting a happy path:
 *
 *   · `nextActions()` cannot be handed a declared Step — it takes buttons and nothing else.
 *   · The NEXT slot is built in one place, from `state === 'declared_next'` and nothing else.
 *   · The two carry different actor colours, and neither one's colour is the other's.
 *
 * The rendered halves — computed styles, and a NEXT slot with no control in it — are measured
 * on the real cascade in `tests/e2e/visual.mjs`.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const R = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const NA = read('app/renderer/nextaction.js');
const SC03 = read('app/renderer/screens/sc03.js');
const SC04 = read('app/renderer/screens/sc04.js');

test('`18` gives both a name and says which is which', async () => {
  const { C } = await import(pathToFileURL(path.join(R, 'app/renderer/copy.js')).href);
  assert.strictEqual(C.next.label, '다음 행동');
  assert.ok(C.next.stepLabel.startsWith('NEXT'), 'the NEXT slot label does not say NEXT');
  /* D-136: JuQode 의 권유가 Agent 가 선언한 작업처럼 보이면 안 된다. The gloss is the sentence
   * that says so, and it names both actors so the reader is not left to infer it. */
  assert.ok(C.next.gloss.includes('JuQode') && C.next.gloss.includes('Claude Code'),
    'the gloss does not name both actors');
  assert.ok(C.next.stepLabel.includes('Claude Code'), 'the NEXT label does not say who declared it');
});

test('nextActions cannot be handed a declared Step', () => {
  /* The failure `21` WBS-38 names is 다음 행동이 NEXT 슬롯에 렌더됨. The block takes DOM buttons
   * the caller already built; there is no `step`, `declared` or `title` parameter for one to
   * arrive through. Structure, not discipline. */
  const sig = /export function nextActions\(([^)]*)\)/.exec(NA);
  assert.ok(sig, 'nextActions is not exported');
  assert.strictEqual(sig[1].trim(), 'buttons');
  /* Comments stripped: the file EXPLAINS what a declared Step is, and must, since that is the
   * thing it exists to stay away from. What matters is that no code path carries one. */
  const code = NA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  for (const banned of ['declared', 'step', 'Step', 'snap.']) {
    assert.ok(!code.includes(banned), `nextaction.js takes a ${banned}`);
  }
});

test('the NEXT slot is built from declared_next and from nothing else', () => {
  /* D-107: 신호가 없으면 비어 있고 지어내지 않는다. One producer, one source. */
  const slots = [...SC03.matchAll(/setAttribute\('data-el', 'next'\)/g)];
  assert.strictEqual(slots.length, 1,
    `the NEXT slot is built in ${slots.length} places, not one`);
  assert.ok(/const declared = snap\.steps\.find\(\(s\) => s\.state === 'declared_next'\);/.test(SC03),
    'the NEXT slot no longer reads declared_next');
  /* …and its empty state is a sentence, not a borrowed 다음 행동. */
  assert.ok(/declared \? declared\.title : C\.work\.nextEmpty/.test(SC03));
});

test('no screen puts a next-action button inside the NEXT slot', () => {
  /* The slot is assembled in a handful of lines; a `btn(` among them would be exactly the
   * banned thing. Read the block itself rather than the whole file. */
  const i = SC03.indexOf("const next = el('div', 'nextslot');");
  assert.ok(i > -1, 'the NEXT slot is gone');
  const block = SC03.slice(i, SC03.indexOf('card.appendChild(next);', i));
  assert.ok(!block.includes('btn('), 'the NEXT slot contains a control');
  assert.ok(!block.includes('nextActions'), '다음 행동 is rendered into the NEXT slot');
});

test('every 다음 행동 row on SC-03 and SC-04 goes through the one block', () => {
  /* A bare `row-acts` of navigation buttons is the old, unlabelled shape — the one a user
   * cannot tell from something the agent announced. The rows that remain bare are the ones
   * that are NOT JuQode offers: answering Claude's question, allowing a refused tool, and the
   * recovery rows, which `16` gives their own grammar. */
  assert.ok(SC03.includes("import { nextActions } from '../nextaction.js';"));
  assert.ok(SC04.includes("import { nextActions } from '../nextaction.js';"));
  /* The result card and the unwanted panel are D-136's own examples. */
  assert.ok(/nextActions\(\[[\s\S]{0,400}C\.work\.readChanges/.test(SC03),
    '변경 읽기 is not inside a 다음 행동 block');
  assert.ok(/nextActions\(\[[\s\S]{0,400}C\.work\.correction/.test(SC03),
    '고치는 작업 요청 is not inside a 다음 행동 block');
  assert.ok(/nextActions\(\[[\s\S]{0,400}C\.gap\.readerToIntent/.test(SC04),
    '다음 의도로 is not inside a 다음 행동 block');
});

test('the two blocks carry different actor colours, and each carries the right one', () => {
  /* `16`'s actor colours already mean this: JuQode is teal, Claude Code is purple. Using them
   * is what makes the distinction a rule of the design system rather than a one-off style. */
  const base = read('app/renderer/design/base.css');
  const sc03css = read('app/renderer/screens/sc03.css');
  assert.match(base, /\.nextacts\s*\{[^}]*border-left:\s*3px solid var\(--juq\)/,
    '다음 행동 does not carry JuQode\'s colour');
  assert.match(base, /\.nextacts \.nalabel\s*\{[^}]*color:\s*var\(--juq\)/);
  assert.match(sc03css, /\.sc03 \.nextslot\s*\{[^}]*border-left:\s*3px solid var\(--claude\)/,
    'the NEXT slot does not carry Claude\'s colour');
  /* Neither may wear the other's. */
  const nextacts = /\.nextacts\s*\{[^}]*\}/.exec(base)[0];
  assert.ok(!nextacts.includes('--claude'), '다음 행동 is painted in Claude\'s colour');
  const slot = /\.sc03 \.nextslot\s*\{[^}]*\}/.exec(sc03css)[0];
  assert.ok(!slot.includes('--juq'), 'the NEXT slot is painted in JuQode\'s colour');
  /* …and neither is recovery green or failure red: these are navigation, not a recovery and
   * not a failure (`16` §2.1 — green ▸ is recovery only). */
  for (const [name, css] of [['다음 행동', nextacts], ['NEXT', slot]]) {
    for (const t of ['--rec', '--fail']) {
      assert.ok(!css.includes(t), `${name} uses ${t}`);
    }
  }
});
