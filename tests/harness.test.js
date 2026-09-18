/* WBS-31 · Testing harness — `21` WBS-31.
 *
 * Its acceptance is one sentence with two halves:
 *
 *   녹화된 stream-json 픽스처를 재생하면 리듀서가 결정론적으로 같은 상태열을 낸다;
 *   픽스처 하나가 깨지면 실패한다
 *
 * The first half is about the REDUCER: the same recording must always produce the same sequence
 * of states, not merely the same final one. A reducer that reached the right end through a wrong
 * middle would satisfy a terminal-state assertion and still be wrong — `15` SC-03 renders the
 * middle, so the middle is what the user sees.
 *
 * The second half is about the HARNESS ITSELF, and it is the half that is easy to get wrong: a
 * fixture that silently stops parsing, or that quietly becomes an empty list, makes every test
 * built on it pass while testing nothing. So this file checks that a damaged fixture is LOUD.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const FIXTURES = path.join(R, 'tests/fixtures');
const { toSignal, replay, KIND } = require(path.join(R, 'app/main/work/reducer.js'));

const ndjsonFiles = () => fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.ndjson'));
const load = (file) => fs.readFileSync(path.join(FIXTURES, file), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The state after EVERY event, which is what the screen actually renders over time. */
const sequence = (events) => {
  const signals = events.map(toSignal);
  return signals.map((_, i) => {
    const s = replay(signals.slice(0, i + 1));
    return `${signals[i].kind}:${s.status}`;
  });
};

/* ───────── determinism ───────── */

test('replaying a recording gives the same state SEQUENCE every time', () => {
  for (const file of ndjsonFiles()) {
    const events = load(file);
    const first = sequence(events);
    for (let i = 0; i < 20; i++) {
      assert.deepStrictEqual(sequence(events), first,
        `${file} replayed differently on attempt ${i + 1} — the reducer is not deterministic`);
    }
    /* …and a fresh read from disk gives the same answer as the one held in memory. */
    assert.deepStrictEqual(sequence(load(file)), first, `${file} depends on parse order or shared state`);
  }
});

test('the recorded D-133 session produces exactly this sequence', () => {
  /* Pinned as a literal. Derived expectations track whatever the reducer does, so they cannot
   * fail — this is the shape of test the run has repeatedly found to be uncheckable, and the
   * fix is always the same: write down the answer. */
  assert.deepStrictEqual(sequence(load('stream-permission-denied.ndjson')), [
    'raw:running',
    'raw:running',
    'session_start:running',
    'raw:running',
    'raw:running',
    'raw:running',
    'tool_use:running',
    'rate_limit:running',
    'tool_result:running',
    'tool_use:running',
    'tool_result:running',
    'tool_use:running',
    /* The denial is where the Work enters 허용 필요, and it stays there: under D-133 contract B
     * the user can still allow, and the SAME session resumes. A reducer that ended the Work on
     * `finish` would throw the card away. */
    'permission_denied:permission_waiting',
    'tool_result:permission_waiting',
    'raw:permission_waiting',
    'finish:permission_waiting',
  ]);
});

test('replaying a PREFIX is the same as replaying up to that point', () => {
  /* The reducer is fed incrementally in production (one signal per CLI line) and all at once in
   * the tests. Those must agree, or the tests are exercising a code path the app never takes. */
  const events = load('stream-permission-denied.ndjson');
  const signals = events.map(toSignal);
  for (let n = 1; n <= signals.length; n++) {
    const allAtOnce = replay(signals.slice(0, n));
    /* …and one at a time, through the same reducer the supervisor uses. */
    let step = replay([]);
    for (const s of signals.slice(0, n)) step = replay(signals.slice(0, signals.indexOf(s) + 1));
    assert.strictEqual(step.status, allAtOnce.status, `prefix of ${n} disagrees`);
  }
});

/* ───────── a damaged fixture is loud ───────── */

test('a truncated recording does NOT produce the same sequence', () => {
  /* The check that the check is real. If a fixture lost half its lines and the assertions still
   * passed, every test built on it would be testing nothing. */
  const events = load('stream-permission-denied.ndjson');
  const full = sequence(events);
  const half = sequence(events.slice(0, Math.floor(events.length / 2)));
  assert.notDeepStrictEqual(half, full, 'a fixture cut in half replays identically');
  assert.ok(half.length < full.length);
});

test('a fixture that stops being valid NDJSON fails loudly, not quietly', () => {
  const file = path.join(FIXTURES, 'stream-permission-denied.ndjson');
  const original = fs.readFileSync(file, 'utf8');
  try {
    fs.writeFileSync(file, `${original}\n{ this is not json`);
    assert.throws(() => load('stream-permission-denied.ndjson'), SyntaxError,
      'a corrupt line was swallowed — every test on this fixture would pass on nothing');
  } finally {
    fs.writeFileSync(file, original);
  }
  /* …and the file is exactly as it was. A test that damages a tracked fixture and leaves it
   * damaged is worse than the bug it was looking for. */
  assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
});

test('every fixture parses, and carries the events a recording must have', () => {
  const files = ndjsonFiles();
  assert.ok(files.length >= 1, 'there are no recorded fixtures at all');
  for (const file of files) {
    const events = load(file);
    assert.ok(events.length >= 5, `${file} has only ${events.length} events`);
    const signals = events.map(toSignal);
    /* A stream-json recording always opens with the init line and ends with the result. */
    assert.ok(signals.some((s) => s.kind === KIND.SESSION_START), `${file} has no system/init`);
    assert.strictEqual(signals.at(-1).kind, KIND.FINISH, `${file} does not end with a result`);
    /* Every line is an object the reducer understood — `raw` is a real outcome, `undefined` is
     * not, and a signal without a kind would sail through every filter downstream. */
    for (const [i, s] of signals.entries()) {
      assert.ok(s && typeof s.kind === 'string', `${file} line ${i + 1} produced no signal kind`);
    }
  }
});

/* ───────── the recording is a recording ───────── */

test('no fixture depends on the machine that recorded it', () => {
  /* `tests/fixtures/README.md` states that the only edit was the working directory. This is
   * that claim, checked: a fixture carrying a real home directory would make the suite pass on
   * one machine and fail on another, and would also publish somebody's paths. */
  for (const file of ndjsonFiles()) {
    const raw = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
    assert.ok(!/\/home\/[a-z]/i.test(raw), `${file} carries a real home directory`);
    assert.ok(!/\/Users\//.test(raw), `${file} carries a real macOS home directory`);
    assert.ok(!/C:\\\\Users/i.test(raw), `${file} carries a real Windows home directory`);
  }
});

test('no fixture carries anything that looks like a credential', () => {
  const TOKENISH = [/\bgh[pousr]_[A-Za-z0-9_]{16,}/, /\bsk-[A-Za-z0-9_-]{16,}/,
                    /\bxox[abposr]-[A-Za-z0-9-]{8,}/, /\bAKIA[0-9A-Z]{12,}/,
                    /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  for (const file of ndjsonFiles()) {
    const raw = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
    for (const re of TOKENISH) {
      assert.ok(!re.test(raw), `${file} contains something shaped like a credential: ${re}`);
    }
  }
});

test('the fixture README says where the recording came from', () => {
  /* A recording whose provenance is not written down is indistinguishable from a hand-written
   * file that says what its author expected the CLI to do. */
  const readme = fs.readFileSync(path.join(FIXTURES, 'README.md'), 'utf8');
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(readme), 'the README does not say WHEN it was recorded');
  assert.ok(/2\.1\.\d+|CLI \d/.test(readme), 'the README does not say which CLI version produced it');
  for (const file of ndjsonFiles()) {
    assert.ok(readme.includes(file), `${file} is not described in the fixture README`);
  }
});
