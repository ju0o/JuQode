const test = require('node:test');
const assert = require('node:assert/strict');

let columnFor;
let tileTone;

test.before(async () => {
  ({ columnFor, tileTone } = await import('../app/renderer/board-column.mjs'));
});

test('a task with no run is waiting to start', () => {
  assert.equal(columnFor({ status: 'open', verdict: 'unverified' }, null), 'queued');
  assert.equal(columnFor(null, null), 'queued');
});

test('permission, a question, and an unknown stop need the founder', () => {
  const task = { status: 'in_progress', verdict: 'unverified' };
  assert.equal(columnFor(task, { status: 'permission_waiting' }), 'needs');
  assert.equal(columnFor(task, { status: 'input_waiting' }), 'needs');
  assert.equal(columnFor(task, { status: 'cancel_requested' }), 'needs');
  assert.equal(columnFor({ status: 'complete', verdict: 'pass' }, { status: 'ended', outcome: 'ended_unknown' }), 'needs');
  assert.equal(columnFor({ status: 'blocked', verdict: 'unverified' }, null), 'needs');
});

test('only a run that has not ended is in progress', () => {
  assert.equal(columnFor({ status: 'in_progress', verdict: 'unverified' }, { status: 'running' }), 'doing');
  assert.equal(columnFor({ status: 'in_progress', verdict: 'unverified' }, { status: 'ended', outcome: 'complete' }), 'review');
});

test('agent completion does not finish the task', () => {
  const task = { status: 'in_progress', verdict: 'unverified' };
  assert.equal(columnFor(task, { status: 'ended', outcome: 'complete' }), 'review');
  assert.equal(columnFor({ status: 'complete', verdict: 'pass' }, { status: 'ended', outcome: 'complete' }), 'done');
  assert.equal(columnFor({ status: 'open', verdict: 'pass' }, null), 'done');
});

test('failure and partial stay in review and do not look finished', () => {
  assert.equal(columnFor({ status: 'open', verdict: 'fail' }, { status: 'ended', outcome: 'failed' }), 'review');
  assert.equal(columnFor({ status: 'open', verdict: 'unverified' }, { status: 'ended', outcome: 'partial' }), 'review');
  assert.equal(columnFor({ status: 'open', verdict: 'unverified' }, { status: 'ended', outcome: 'cancelled_nochange' }), 'review');
});

test('tone keeps failure red and unknown apart from done', () => {
  assert.equal(tileTone({ verdict: 'fail' }, { outcome: 'failed', status: 'ended' }), 'fail');
  assert.equal(tileTone({ verdict: 'pass', status: 'complete' }, { outcome: 'ended_unknown', status: 'ended' }), 'unknown');
  assert.equal(tileTone({ verdict: 'unverified' }, { status: 'permission_waiting' }), 'needs');
  assert.equal(tileTone({ verdict: 'unverified' }, { status: 'running' }), 'doing');
  assert.equal(tileTone({ verdict: 'pass', status: 'complete' }, { status: 'ended', outcome: 'complete' }), 'done');
  assert.equal(tileTone({ verdict: 'unverified' }, { status: 'ended', outcome: 'partial' }), 'partial');
  assert.equal(tileTone({ verdict: 'unverified', status: 'open' }, null), 'quiet');
});
