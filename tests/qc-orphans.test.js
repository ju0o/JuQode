'use strict';
/* Descendants outside the recorded snapshot. What the survivor check CAN see (a recorded member, a late child of a recorded parent, a reused id told apart by
 * creation time) keeps the Writer gate shut; what it structurally cannot see (a process whose parent died before the snapshot) is the LIMITED contract below. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { survivorsIn } = require(path.join(R, 'app/main/qc/stopper.js'));
const { createUncertain } = require(path.join(R, 'app/main/qc/uncertain.js'));

const T = (s) => `2026-10-16T10:00:${String(s).padStart(2, '0')}.000Z`;
const P = (pid, ppid, s) => ({ pid, ppid, created: T(s) });
const ROOT = { pid: 100, created: T(1) };
const kid = { pid: 101, created: T(2) };
const pids = (a) => a.map((p) => p.pid);

test('root gone, a recorded descendant alive: still alive; both gone: nothing', () => {
  assert.deepStrictEqual(pids(survivorsIn([P(101, 100, 2)], [kid], [ROOT])), [101]);
  assert.deepStrictEqual(survivorsIn([P(4, 0, 0)], [kid], [ROOT]), []);
});
test('a child started AFTER the snapshot is found, also under a root that is already dead and under a descendant, transitively', () => {
  assert.deepStrictEqual(pids(survivorsIn([P(200, 100, 5)], [kid], [ROOT])), [200], 'late child of the dead root');
  assert.deepStrictEqual(pids(survivorsIn([P(101, 100, 2), P(201, 101, 6), P(202, 201, 7)], [kid], [ROOT])), [101, 201, 202]);
});
test('a reused parent id is told apart by creation time: its children are not ours, and a reused member id is not the member', () => {
  assert.deepStrictEqual(survivorsIn([P(100, 4, 30), P(300, 100, 31)], [kid], [ROOT]), [], 'children of an unrelated process that reuses the root pid');
  assert.deepStrictEqual(survivorsIn([P(101, 4, 40)], [kid], [ROOT]), [], 'another process now has the member pid');
});
test('LIMITED: a descendant whose parent died before the snapshot has no recorded link -- the check cannot see it (documented limit; such a Stop needs the user, see README)', () => {
  assert.deepStrictEqual(survivorsIn([P(900, 777, 3)], [kid], [ROOT]), [], 'if this ever finds it, the contract in the README can change');
});

const settle = () => new Promise((r) => setTimeout(r, 40));
test('the gate opens only on a SUCCESSFUL snapshot that shows every identified member gone; a failed one, a throw, a bare pid and a restart do not', async () => {
  let ans = null; let seen = null;
  const reg = createUncertain({ probe: async (m, parents) => { seen = { m, parents }; if (ans instanceof Error) throw ans; return ans; }, retryMs: 5, maxTries: 2 });
  reg.add('r1', 'p', [kid], { parents: [ROOT] });
  await settle();
  assert.ok(reg.blocks('p'), 'snapshot could not be read');
  assert.deepStrictEqual(seen.parents, [ROOT], 'the dead root was not handed to the check (a late child would be missed)');
  ans = new Error('boom'); reg.refresh('p'); await settle(); assert.ok(reg.blocks('p'), 'a throwing probe opened the gate');
  ans = [kid]; reg.refresh('p'); await settle(); assert.ok(reg.blocks('p'));
  ans = []; reg.refresh('p'); await settle(); assert.strictEqual(reg.blocks('p'), null);

  const bare = createUncertain({ probe: async () => [], retryMs: 5 });
  bare.add('r2', 'p', [{ pid: 5, created: null }], {});
  await settle();
  assert.ok(bare.blocks('p'), 'a bare pid that is "gone" opened the gate');
  assert.strictEqual(bare.heldFor('p')[0].needsAck, true);
  for (const m of [[], null, [{ pid: 5 }], [{ pid: 5, created: '' }]]) {
    const r = createUncertain({ probe: async () => [], retryMs: 5 });
    r.add('r3', 'p', m, {}); await settle();
    assert.ok(r.blocks('p'), `members ${JSON.stringify(m)} opened the gate`);
  }
});
