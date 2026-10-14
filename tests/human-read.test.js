const test = require('node:test');
const assert = require('node:assert/strict');

let contextFacts;

test.before(async () => {
  ({ contextFacts } = await import('../app/renderer/human-read.mjs'));
});

test('a context bundle becomes the three things Claude was shown', () => {
  const facts = contextFacts({
    bundle_id: 'should-not-leak',
    items: [
      { source_type: 'task_goal', source_ref: 'task:1:goal', content_digest: 'aaa', safe_content: '  로그인 버튼을 고친다  ' },
      { source_type: 'acceptance_criterion', source_ref: 'task:1:acceptance:c', safe_content: '버튼이 동작한다' },
      { source_type: 'user_request', source_ref: 'submission:user-request', safe_content: '고쳐 주세요' },
    ],
  });
  assert.deepEqual(facts, [
    { key: 'goal', text: '로그인 버튼을 고친다' },
    { key: 'criterion', text: '버튼이 동작한다' },
    { key: 'request', text: '고쳐 주세요' },
  ]);
  assert.equal(JSON.stringify(facts).includes('should-not-leak'), false);
  assert.equal(JSON.stringify(facts).includes('source_ref'), false);
  assert.equal(JSON.stringify(facts).includes('digest'), false);
});

test('a missing bundle is silence, not a claim that Claude saw nothing', () => {
  assert.deepEqual(contextFacts(null), []);
  assert.deepEqual(contextFacts({}), []);
  assert.deepEqual(contextFacts({ items: [{ source_type: 'task_goal', safe_content: '   ' }] }), []);
});

test('an item type the screen does not name stays text without a made-up label', () => {
  assert.deepEqual(contextFacts({
    items: [{ source_type: 'runbook', safe_content: '배포 전에 읽기' }],
  }), [{ key: 'other', text: '배포 전에 읽기' }]);
});
