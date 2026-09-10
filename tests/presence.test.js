/* WBS-35 · Agent Presence — `21` WBS-35's acceptance, checked.
 *
 * The acceptance is four claims and this file is organised as four sections, one each:
 *
 *   1. mode changes only on signals / user actions
 *   2. NO MODE IS REACHABLE BY A TIMER ALONE
 *   3. a static frame per mode with motion off
 *   4. no face / mascot
 *
 * …plus the named failure cases from `21` §2: liveness disagreeing with the presence mode, and
 * anything that could be read as progress.
 *
 * `modeFor` is loaded through a dynamic import because the renderer is ESM and this suite is
 * CJS. That is also the point of putting the mapping in a pure function: it can be checked
 * without a DOM, and a mapping that needed a canvas to answer could not be checked at all.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const R = path.resolve(__dirname, '..');
const { code: srcOf, text: rawOf } = require(path.join(__dirname, 'src.js'));

/* Comments stripped — `tests/src.js`. This file's own first draft was fooled by the doc
 * comment it had just written. */
const SRC = srcOf('app/renderer/presence.js');
const load = () => import(pathToFileURL(path.join(R, 'app/renderer/presence.js')).href);

/** The nine, from `15` §42 and `16` §9. Written out, not read from the module under test. */
const NINE = ['idle', 'activity', 'input', 'permission', 'nosignal', 'unknown', 'complete',
              'cancelled', 'failure'];

const work = { id: 'w1', intent: '결제 화면 문구 바꿔줘', started_at: '2026-01-01T00:00:00.000Z' };
const snap = (o) => ({ work, status: 'running', outcome: null, liveness: 'live', permission: null,
                       inputRequest: null, cancelUnconfirmed: false, ...o });

/* ───────── the mode set ───────── */

test('there are exactly nine modes and they are the nine Canon names', async () => {
  const { MODES, MODE_NAMES } = await load();
  assert.deepStrictEqual(MODE_NAMES, NINE);
  assert.strictEqual(Object.keys(MODES).length, 9);
});

test('every mode has a label, and no two modes share one', async () => {
  /* `16` §9: `label always present`. A mode with no words is a shape the user has to decode,
   * and two modes with the same words are two states the screen cannot tell apart.
   *
   * Read from the object, not from the source: two of the nine are wired to the `18` keys that
   * already carry those strings, so a source scan would report seven and call it a gap. */
  const { C } = await import(pathToFileURL(path.join(R, 'app/renderer/copy.js')).href);
  const labels = C.gap.presenceLabel;
  assert.deepStrictEqual(Object.keys(labels).sort(), [...NINE].sort());
  for (const m of NINE) assert.ok(labels[m] && labels[m].trim(), `${m} has no label`);
  assert.strictEqual(new Set(Object.values(labels)).size, 9, 'two modes carry the same label');
  /* The two that come from `18`'s own keys are the SAME string, not a copy of it. */
  assert.strictEqual(labels.cancelled, C.qc.stopped);
  assert.strictEqual(labels.failure, C.work.resultTitle.failed);
});

/* ───────── 1 · the mapping, and nothing but signals in it ───────── */

test('every mode the mapping can return is one of the nine', async () => {
  const { modeFor } = await load();
  const statuses = ['running', 'permission_waiting', 'input_waiting', 'cancel_requested', 'ended', 'nonsense'];
  const outcomes = [null, 'complete', 'partial', 'failed', 'cancelled_partial', 'cancelled_nochange',
                    'ended_unknown', 'something_new'];
  const livenesses = ['live', 'quiet', 'unknown', undefined];
  for (const status of statuses) {
    for (const outcome of outcomes) {
      for (const liveness of livenesses) {
        for (const permission of [null, { toolUseId: 't1' }]) {
          const m = modeFor(snap({ status, outcome, liveness, permission }));
          assert.ok(NINE.includes(m), `${status}/${outcome}/${liveness} produced ${m}`);
        }
      }
    }
  }
});

test('the mapping table, written down', async () => {
  const { modeFor } = await load();
  /* A derived expectation would track whatever the code does and could not fail. These are the
   * answers, stated. */
  assert.strictEqual(modeFor(null), 'idle', 'no Work is 대기 중');
  assert.strictEqual(modeFor({}), 'idle', 'a snapshot with no work row is no Work');

  assert.strictEqual(modeFor(snap({})), 'activity');
  assert.strictEqual(modeFor(snap({ liveness: 'quiet' })), 'nosignal');
  assert.strictEqual(modeFor(snap({ liveness: 'unknown' })), 'unknown');

  assert.strictEqual(modeFor(snap({ status: 'permission_waiting', permission: { toolUseId: 't1' } })), 'permission');
  assert.strictEqual(modeFor(snap({ status: 'input_waiting' })), 'input');

  assert.strictEqual(modeFor(snap({ status: 'ended', outcome: 'complete' })), 'complete');
  assert.strictEqual(modeFor(snap({ status: 'ended', outcome: 'partial' })), 'complete');
  assert.strictEqual(modeFor(snap({ status: 'ended', outcome: 'failed' })), 'failure');
  assert.strictEqual(modeFor(snap({ status: 'ended', outcome: 'cancelled_partial' })), 'cancelled');
  assert.strictEqual(modeFor(snap({ status: 'ended', outcome: 'cancelled_nochange' })), 'cancelled');
  assert.strictEqual(modeFor(snap({ status: 'ended', outcome: 'ended_unknown' })), 'unknown');
});

test('an ended Work with an outcome nobody wrote down is 확인 불가, never 끝남', async () => {
  const { modeFor } = await load();
  /* `complete` is a CLAIM and this is the shape of bug that makes it a false one: a new outcome
   * code lands in the schema, this table does not know it, and the product announces 작업이
   * 끝났어요 for a Work whose end it cannot describe. */
  for (const outcome of [null, undefined, '', 'reconciled', 'ended_orphan', 0]) {
    assert.strictEqual(modeFor(snap({ status: 'ended', outcome })), 'unknown',
      `outcome ${JSON.stringify(outcome)} was described as a known ending`);
  }
});

test('활동 is claimed only on a positive liveness verdict', async () => {
  const { modeFor } = await load();
  /* MEASURED as a mutation survivor: SC-02 passed a HISTORY ROW to this function instead of the
   * snapshot. A row carries `status` and `outcome` and nothing about liveness, so it fell
   * through to `activity` — the product announcing 최근 활동이 보여요 for a Work that was
   * actually stopped waiting for the user to answer a question.
   *
   * `activity` is the only mode that asserts the agent is doing something. It is therefore the
   * only one that needs the word `live`; everything else is 확인할 수 없어요. */
  for (const liveness of [undefined, null, '', 'running', true, 'alive', 0]) {
    assert.strictEqual(modeFor(snap({ liveness })), 'unknown',
      `liveness ${JSON.stringify(liveness)} was read as 활동`);
  }
  /* A History row, exactly as `juqode:history` returns one. */
  assert.strictEqual(modeFor({ work, id: 'w1', intent: 'x', status: 'running', outcome: null,
                               startedAt: null, endedAt: null, changes: null }), 'unknown');
  assert.strictEqual(modeFor(snap({ liveness: 'live' })), 'activity');
});

test('a cancel that was only REQUESTED does not say 멈췄어요', async () => {
  const { modeFor } = await load();
  /* `07` §8.1 measured a cancelled child exiting 0. Until the stop is confirmed, the Work has
   * not stopped, and `cancelled` is `18`'s 멈췄어요 — a fact nobody has observed yet. */
  assert.strictEqual(modeFor(snap({ status: 'cancel_requested' })), 'activity');
  assert.strictEqual(modeFor(snap({ status: 'cancel_requested', cancelUnconfirmed: true })), 'activity');
  assert.strictEqual(modeFor(snap({ status: 'cancel_requested', liveness: 'quiet' })), 'nosignal');
});

test('permission_waiting with no open denial is not a permission mode', async () => {
  const { modeFor } = await load();
  /* SC-03 draws the permission panel on `snap.permission && status === permission_waiting`.
   * A presence that read only the status would show 허용을 기다리고 있어요 next to a card with
   * no permission on it — the liveness/presence disagreement `21` §2 names. */
  assert.strictEqual(modeFor(snap({ status: 'permission_waiting', permission: null })), 'activity');
});

test('waiting on the user outranks silence — otherwise the mode moves on a clock', async () => {
  const { modeFor } = await load();
  /* This is claim 2 in disguise, and it is the reason the precedence is written the way it is.
   * A Work waiting for the user is SUPPOSED to be silent. If `quiet` won, the permission card's
   * presence would flip to 잠시 새 활동이 보이지 않아요 two minutes after the card appeared —
   * a mode change caused by elapsed time and by nothing else. */
  for (const liveness of ['quiet', 'unknown']) {
    assert.strictEqual(modeFor(snap({ status: 'permission_waiting', permission: { toolUseId: 't' }, liveness })),
      'permission', `silence overrode an observed denial (${liveness})`);
    assert.strictEqual(modeFor(snap({ status: 'input_waiting', liveness })), 'input',
      `silence overrode an observed question (${liveness})`);
  }
});

test('the mapping is pure: same snapshot, same mode, no clock', async () => {
  const { modeFor } = await load();
  const s = snap({ status: 'running', liveness: 'quiet' });
  const first = modeFor(s);
  const frozen = JSON.stringify(s);
  for (let i = 0; i < 50; i++) assert.strictEqual(modeFor(s), first);
  assert.strictEqual(JSON.stringify(s), frozen, 'modeFor mutated the snapshot it was given');
});

/* ───────── 2 · no mode is reachable by a timer alone ───────── */

test('no clock in this file can reach a mode', () => {
  /* The acceptance's hardest half, and the one it is easiest to write a test that cannot fail
   * for. The file DOES read a clock — the breath and the settle are time-based, and the loop is
   * `requestAnimationFrame`. A banned-word list that quietly left those two out would be shaped
   * to let the claim through, so this states them and then checks the thing that actually
   * matters: no clock reading can end up as a MODE.
   *
   * `livenessOf()` in the supervisor is the ONE clock allowed to reach a mode (`17` exempts it
   * by name: process alive + last-signal timestamp), and it hands its verdict in through the
   * snapshot. A second clock here would be one nothing accounts for. */
  assert.ok(SRC.includes('performance.now()'), 'the breath and the settle are no longer time-based');
  assert.ok(SRC.includes('requestAnimationFrame'), 'there is no draw loop any more');

  /* Nothing SCHEDULES anything: a callback that fires later is the only way a clock could get
   * from here to `setMode` without the draw loop. */
  /* Comments stripped — the file NAMES the things it does not do, and must, or the claim is
   * unreadable. (This bit the first draft: the doc comment saying `setInterval appears nowhere`
   * made the scan report a setInterval.) */
  const code = SRC;
  for (const banned of ['setInterval', 'setTimeout', 'setImmediate', 'queueMicrotask',
                        'Date.now', 'new Date']) {
    assert.ok(!code.includes(banned), `presence.js contains ${banned} — a mode could move on a clock`);
  }

  /* …and `setMode` is called from exactly the three places that are a construction, a render
   * and a render-driven correction. None of them is the loop. */
  const calls = [...SRC.matchAll(/\.setMode\(/g)];
  assert.strictEqual(calls.length, 3, `setMode is called from ${calls.length} places`);
  for (const fn of ['constructor', 'presenceCard', 'setPresenceMode']) {
    assert.ok(new RegExp(`${fn}[\\s\\S]{0,900}?\\.setMode\\(`).test(SRC),
      `${fn} does not set the mode — one of the three callers has moved`);
  }
});

test('setMode is the only writer of the mode', () => {
  /* Grep, deliberately: this is a claim about the whole file, and a claim about the whole file
   * cannot be made by calling one function. Every assignment to `this.mode` must be inside
   * `setMode`, so the draw loop — the only thing that runs on its own — cannot move it. */
  const writes = [...SRC.matchAll(/this\.mode\s*=/g)];
  assert.strictEqual(writes.length, 1, `this.mode is assigned in ${writes.length} places`);
  const body = /setMode\(m\)\s*\{([\s\S]*?)\n  \}/.exec(SRC);
  assert.ok(body, 'setMode(m) not found');
  assert.ok(body[1].includes('this.mode = m'), 'the one assignment is not the one in setMode');

  /* …and the draw loop never calls it. `draw` is what `requestAnimationFrame` runs. */
  const draw = /\n  draw\(t, forceStatic\) \{([\s\S]*?)\n  \}\n\}/.exec(SRC);
  assert.ok(draw, 'draw() not found');
  assert.ok(!draw[1].includes('setMode'), 'the animation loop changes the mode');
});

test('the settle is a one-shot reaction, not a loop that ends anywhere', () => {
  /* `16` §9: complete settles once over 520 ms then is still. A settle that re-armed itself
   * would be a loop, and a loop that changed the target would be a timer reaching a mode. */
  assert.ok(/if \(MODES\[m\]\.settle\) this\.settleAt = performance\.now\(\);/.test(SRC));
  assert.strictEqual([...SRC.matchAll(/this\.settleAt\s*=/g)].length, 2,
    'settleAt is written somewhere other than the constructor and setMode');
});

/* ───────── 3 · a static frame per mode with motion off ───────── */

test('reduced motion lands on the mode instead of easing toward it', () => {
  /* The lerp factor is the whole mechanism: at `k = 1` the frame is a function of the mode
   * alone, so the same mode is always the same picture. At .06 it is a function of whatever
   * frame came before, which is not a static frame per mode. */
  assert.ok(/const k = reduced \? 1 : \.06;/.test(SRC), 'reduced motion still eases');
  /* …and every source of movement is switched off by the same flag. */
  for (const guard of ['if (!reduced) this.rotY', 'const breathe = reduced ? 0', 'if (this.settleAt && !reduced)',
                       'if (!reduced && this.cur.jit > 0)']) {
    assert.ok(SRC.includes(guard), `reduced motion does not stop: ${guard}`);
  }
});

test('the flicker mode still has a still frame, and the same one every time', () => {
  /* `unknown` flickers. A still frame cannot, so it drops a FIXED subset — and `this.rand` is
   * rolled once per instance, never per draw, or the "static" frame would change each paint. */
  assert.ok(/reduced \? this\.rand\[i\] < this\.cur\.flick \* \.6/.test(SRC));
  assert.strictEqual([...SRC.matchAll(/this\.rand\s*=/g)].length, 1,
    'the point randomness is re-rolled — the static frame is not static');
});

test('setMode paints immediately when motion is off', () => {
  /* With no rAF-driven easing to carry it there, a reduced-motion mode change has to draw its
   * own frame or the canvas keeps showing the previous mode. */
  assert.ok(/if \(REDUCED\(\)\) this\.draw\(performance\.now\(\), true\);/.test(SRC));
});

/* ───────── 4 · no face, no mascot, no progress ───────── */

test('nothing in the presence encodes an amount', () => {
  /* D-120 · `21` WBS-35's named failure: `reading it as progress`. Every arc is a full circle.
   * An arc drawn to a fraction of 2π is a progress ring, which is the one thing this component
   * must never be. */
  const arcs = [...SRC.matchAll(/\.arc\([^)]*\)/g)].map((m) => m[0]);
  assert.ok(arcs.length >= 4, `expected the halo, points, ring and core arcs, found ${arcs.length}`);
  for (const a of arcs) {
    assert.ok(a.includes('0, Math.PI * 2'), `not a full circle: ${a}`);
  }
  for (const banned of ['%', 'percent', 'progress', 'eta', 'remaining']) {
    assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(SRC),
      `presence.js speaks of ${banned}`);
  }
});

test('no face: nothing is drawn as a pair, and no primitive is an eye or a mouth', () => {
  /* The point cloud is a fibonacci sphere — evenly spaced by construction, with no pole cluster
   * and no bilateral pairing that could read as two eyes. The only non-cloud marks are one
   * centred dot and centred rings. */
  /* Checked on the CODE, not on the word. The first version asserted the file CONTAINED
   * "fibonacci" — which it does, in a comment — so the check was reading the description of
   * the distribution rather than the distribution. The golden angle is the distribution. */
  assert.ok(/Math\.PI \* \(3 - Math\.sqrt\(5\)\)/.test(SRC),
    'the points are not placed at the golden angle — the cloud can cluster and pair');
  for (const banned of ['eye', 'mouth', 'face', 'blink', 'smile', 'mascot']) {
    assert.ok(!new RegExp(banned, 'i').test(SRC),
      `presence.js draws a ${banned}`);
  }
  /* Every filled shape is centred on the canvas centre or on a cloud point. A hard-coded offset
   * from centre is how a face gets drawn, so there must not be one. */
  const centred = [...SRC.matchAll(/\.arc\((cx|0)[,\s]/g)].length;
  const pointArc = SRC.includes('ctx.arc(cx + x1 * rad, cy + y1 * rad,');
  assert.ok(pointArc, 'the cloud points are not drawn from the centre + their own offset');
  assert.ok(centred >= 3, 'a shape is drawn at a fixed offset from the centre');
});

/* ───────── the colour grammar ───────── */

test('every mode takes its colour from a token, and red is only failure', async () => {
  const { MODES } = await load();
  const tokens = rawOf('app/renderer/design/tokens.css');
  for (const [name, m] of Object.entries(MODES)) {
    assert.ok(m.tint.startsWith('--'), `${name} does not use a token`);
    assert.ok(tokens.includes(`${m.tint}:`), `${name} uses ${m.tint}, which tokens.css does not define`);
  }
  /* `16` §2.1: red is failure and nothing else. */
  const red = Object.entries(MODES).filter(([, m]) => m.tint === '--fail').map(([n]) => n);
  assert.deepStrictEqual(red, ['failure'], `--fail is used by ${red.join(', ')}`);
  /* …and recovery green is the completed Work only. */
  const green = Object.entries(MODES).filter(([, m]) => m.tint === '--rec').map(([n]) => n);
  assert.deepStrictEqual(green, ['complete']);
  /* `19`/`15`: unknown is always dashed, and 지금 안 됨 grey is never a failure colour. */
  assert.strictEqual(MODES.unknown.ringDash, true, 'unknown is not dashed');
  assert.strictEqual(MODES.nosignal.tint, '--mut');
});

test('input and permission share P-02 but are not the same picture', async () => {
  const { MODES } = await load();
  /* `17`: one motion token covers both, and `16` says the distinction is carried by colour,
   * ring and label — not by motion. So their motion fields must match and their rings must not. */
  for (const k of ['rot', 'breathe', 'jit', 'alpha', 'scale', 'flick']) {
    assert.strictEqual(MODES.input[k], MODES.permission[k], `input and permission differ in ${k}`);
  }
  assert.notStrictEqual(Boolean(MODES.input.ring2), Boolean(MODES.permission.ring2),
    'as still frames the two held modes are the same picture');
});

test('cancelled and failure share P-06 but only failure is red', async () => {
  const { MODES } = await load();
  for (const k of ['rot', 'breathe', 'jit', 'ring', 'flick']) {
    assert.strictEqual(MODES.cancelled[k], MODES.failure[k], `cancelled and failure differ in ${k}`);
  }
  assert.notStrictEqual(MODES.cancelled.tint, MODES.failure.tint);
  assert.notStrictEqual(MODES.cancelled.tint, '--fail', '취소 is painted as a failure');
});

/* ───────── the screens agree with it ───────── */

test('SC-02 never guesses a mode from a History row', () => {
  const src = srcOf('app/renderer/screens/sc02.js');
  /* A History row has `status` and `outcome` and nothing else. Deriving the mode from it would
   * announce 활동 for a Work that is actually waiting for the user to answer a question. */
  assert.ok(/modeFor\(snap\)/.test(src), 'SC-02 does not map from a snapshot');
  assert.ok(!/modeFor\(\s*(live|w)\b/.test(src), 'SC-02 maps a History row straight to a mode');
  /* …and a live Work whose snapshot could not be read is not called 대기 중. */
  assert.ok(/mode = snap \? modeFor\(snap\) : 'unknown'/.test(src),
    'a live Work with no snapshot is reported as idle');
  /* …nor is a History read that FAILED. `idle` is `대기 중`, a claim that nothing is happening;
   * the store refusing to answer is not evidence for it. */
  assert.ok(/if \(!r\?\.ok\) \{[^}]*setPresenceMode\('unknown'\)/.test(src),
    'a failed History read is reported as 대기 중');
});

test('SC-03 draws the presence from the very snapshot it is already drawing', () => {
  const src = srcOf('app/renderer/screens/sc03.js');
  assert.ok(/presenceCard\(modeFor\(snap\)\)/.test(src),
    'SC-03 could show a mode that disagrees with its own chip');
});

test('there is exactly one presence instance, and the canvas is moved rather than rebuilt', () => {
  /* SC-03 re-renders on EVERY work signal. One instance per render would leave an orphaned
   * requestAnimationFrame loop behind on each of them, and would restart the breath from zero —
   * which reads as a reaction to a signal that did not happen. */
  assert.ok(/let instance = null;/.test(SRC));
  assert.strictEqual([...SRC.matchAll(/new Presence\(/g)].length, 1);
  assert.ok(/if \(!node\) \{/.test(SRC), 'the canvas node is rebuilt on every render');
});

test('a detached presence paints nothing', () => {
  /* SC-01 clears `#root` and the canvas goes with it. The loop is deliberately left running so
   * the next screen can re-mount the same node, which means the guard is the only thing between
   * that and 60 pointless repaints a second for as long as the user sits on the picker. */
  assert.ok(/if \(!this\.c\.isConnected\) return;/.test(SRC),
    'the draw loop paints into a detached canvas');
  const draw = /\n  draw\(t, forceStatic\) \{([\s\S]*?)\n  \}\n\}/.exec(SRC);
  assert.ok(draw[1].indexOf('isConnected') < draw[1].indexOf('clearRect'),
    'the guard runs after the canvas has already been touched');
});

test('the hint that this is not progress is on the card every time', () => {
  /* `18` `presence.hint`, and `21` WBS-35's named failure case is exactly the misreading it
   * prevents. It is unconditional — there is no branch that can drop it. */
  const card = /export function presenceCard\(mode\) \{([\s\S]*?)\n\}/.exec(SRC);
  assert.ok(card, 'presenceCard not found');
  assert.ok(card[1].includes('C.presence.hint'), 'the card can be drawn without the hint');
  assert.ok(!/if[\s\S]{0,80}C\.presence\.hint/.test(card[1]), 'the hint is behind a condition');
});

/* ───────── the answer belongs to the screen that asked for it ───────── */

test('the presence is written only when the screen and the project are still the ones that asked', async () => {
  /* `fillPresence` awaits twice — the History read, then the snapshot — and the user can leave
   * inside that window. Writing the mode afterwards paints a claim about a project they are no
   * longer looking at, or about SC-02 while they are on SC-03.
   *
   * This lives in a pure function because the state cannot be produced from the e2e: it needs
   * a store that answers AFTER a navigation, which means stubbing the bridge. Two mutation
   * sites sat in this condition and survived the batch-33 sweep for exactly that reason. */
  const { presenceIsStill } = await import(
    pathToFileURL(path.join(R, 'app/renderer/screens/sc02.js')).href);

  const project = { id: 'p1' };
  const other = { id: 'p2' };

  assert.strictEqual(presenceIsStill({ screen: 'SC-02', project }, project), true);

  /* The user moved to another project. The answer is about `project`, and the screen is not. */
  assert.strictEqual(presenceIsStill({ screen: 'SC-02', project: other }, project), false);
  /* …and the SAME PATH is not the same object: a re-open makes a new project object, and the
   * answer in flight belongs to the old one. */
  assert.strictEqual(presenceIsStill({ screen: 'SC-02', project: { id: 'p1' } }, project), false);

  /* The user left SC-02. SC-03 draws its own presence from the snapshot it is holding; a write
   * from here would overwrite it with a mode derived from a History read. */
  assert.strictEqual(presenceIsStill({ screen: 'SC-03', project }, project), false);
  assert.strictEqual(presenceIsStill({ screen: 'SC-01', project: null }, project), false);

  /* Both halves are the rule — neither alone is enough. */
  assert.strictEqual(presenceIsStill({ screen: 'SC-03', project: other }, project), false);
});
