const test = require('node:test');
const assert = require('node:assert/strict');

let proposeDraft;
let compareRuns;

test.before(async () => {
  ({ proposeDraft, compareRuns } = await import('../app/renderer/draft.mjs'));
});

test('a blank sentence is not a task', () => {
  assert.equal(proposeDraft(''), null);
  assert.equal(proposeDraft('   \n\t  '), null);
  assert.equal(proposeDraft(null), null);
  assert.equal(proposeDraft(undefined), null);
  assert.equal(proposeDraft(12), null);
});

test('a request becomes one proposed check, not a claim that it already happened', () => {
  const draft = proposeDraft('  로그인 버튼을 눌러도   아무 반응이 없는데 고쳐 주세요  ');
  assert.deepEqual(draft, {
    goal: '로그인 버튼을 눌러도 아무 반응이 없는데 고쳐 주세요',
    criteria: ['「로그인 버튼을 눌러도 아무 반응이 없는데 고쳐 주세요」가 실제로 된다'],
    proposal: true,
  });
  assert.equal(JSON.stringify(draft).includes('통과'), false);
  assert.equal(JSON.stringify(draft).includes('테스트'), false);
});

test('a sentence that is already a check is not wrapped again', () => {
  const draft = proposeDraft('로그인 버튼을 누르면 대시보드로 이동한다');
  assert.deepEqual(draft.criteria, ['로그인 버튼을 누르면 대시보드로 이동한다']);
});

test('missing file evidence is unknown, not the same empty change', () => {
  const compared = compareRuns(
    { contextDigest: 'aaa', filesObserved: false, changedFiles: [], outcome: 'complete' },
    { contextDigest: 'aaa', filesObserved: false, changedFiles: [], outcome: 'failed' },
  );
  assert.equal(compared.context, 'same');
  assert.equal(compared.files, 'unknown');
  assert.deepEqual(compared.addedFiles, []);
  assert.deepEqual(compared.removedFiles, []);
});

test('two observed empty file lists are the same observation', () => {
  const compared = compareRuns(
    { contextDigest: 'aaa', filesObserved: true, changedFiles: [], outcome: 'complete' },
    { contextDigest: 'bbb', filesObserved: true, changedFiles: [], outcome: 'complete' },
  );
  assert.equal(compared.context, 'different');
  assert.equal(compared.files, 'same');
});

test('file comparison names only paths that actually differ and does not mutate the runs', () => {
  const newer = { contextDigest: 'new', filesObserved: true, changedFiles: ['b.js', 'a.js', 'a.js'], outcome: 'complete' };
  const older = { contextDigest: null, filesObserved: true, changedFiles: ['a.js', 'c.js'], outcome: 'failed' };
  const before = JSON.stringify([newer, older]);
  const compared = compareRuns(newer, older);
  assert.equal(compared.context, 'unknown');
  assert.equal(compared.files, 'different');
  assert.deepEqual(compared.addedFiles, ['b.js']);
  assert.deepEqual(compared.removedFiles, ['c.js']);
  assert.equal(JSON.stringify([newer, older]), before);
});

test('a run is not compared with itself', () => {
  const run = { contextDigest: 'aaa', filesObserved: true, changedFiles: ['a.js'], outcome: 'complete' };
  assert.equal(compareRuns(run, run), null);
  assert.equal(compareRuns(null, run), null);
});
