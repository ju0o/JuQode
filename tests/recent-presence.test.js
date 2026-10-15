const test = require('node:test');
const assert = require('node:assert/strict');

const { text } = require('./src.js');

let recentPresenceLine;
let recentShowsLastWork;

const LINES = {
  missing: '이 폴더는 지금 없어요',
  unreadable: '이 폴더를 읽을 수 없어요',
  'not-a-folder': '지금은 폴더가 아니에요',
  unknown: '이 폴더를 확인하지 못했어요',
};

test.before(async () => {
  ({ recentPresenceLine, recentShowsLastWork } = await import('../app/renderer/recent-presence.mjs'));
});

test('a folder that is still there keeps the last Work, empty or not', () => {
  for (const presence of [{ ok: true, empty: false }, { ok: true, empty: true }, null, undefined]) {
    assert.equal(recentPresenceLine(presence, LINES), null);
    assert.equal(recentShowsLastWork(presence), true);
  }
});

test('a folder that cannot be opened hides the finished chip and names the reason', () => {
  const cases = ['missing', 'unreadable', 'not-a-folder', 'unknown'];
  for (const reason of cases) {
    const presence = { ok: false, reason };
    assert.equal(recentPresenceLine(presence, LINES), LINES[reason]);
    assert.equal(recentShowsLastWork(presence), false);
  }
});

test('an unrecognised reason uses the unknown line and still hides the chip', () => {
  const presence = { ok: false, reason: 'eio' };
  assert.equal(recentPresenceLine(presence, LINES), LINES.unknown);
  assert.equal(recentShowsLastWork(presence), false);
});

test('the recent-row note is muted and is not the failure red', () => {
  const css = text('app/renderer/screens/sc01.css');
  const at = css.indexOf('.sc01 .recentabsent');
  assert.ok(at !== -1, 'SC-01 has no style for a recent folder that is gone');
  const rule = css.slice(at, css.indexOf('}', at) + 1);
  assert.match(rule, /color:\s*var\(--mut\)/);
  assert.doesNotMatch(rule, /--fail|#[0-9a-fA-F]{3,8}|rgb\(/);
  const screen = text('app/renderer/screens/sc01.js');
  assert.match(screen, /data-el', 'recent-absent'/);
  assert.match(screen, /recentShowsLastWork\(p\.presence\) && p\.lastWork/);
});
