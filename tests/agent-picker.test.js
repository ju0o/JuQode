'use strict';
/* V1-304 · the Agent picker's state table, and the rule that the picker itself starts nothing. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const src = require(path.join(__dirname, 'src.js'));

test('each Claude state maps to its own tags, selectability and reason; Codex / OpenCode are never selectable', async () => {
  const { agentRows } = await import(path.join(R, 'app/renderer/agent-picker.mjs'));
  const claude = (status, seen) => agentRows(status, seen)[0];
  const cases = [
    [null, null, 'checking', false],
    [{ available: true, version: '2.1.0' }, null, 'ready', true],
    [{ available: true, version: '2.1.0' }, '2.1.0', 'ready', true],
    [{ available: true, version: '2.2.0' }, '2.1.0', 'version-changed', false],
    [{ available: true, version: null }, null, 'version-unknown', false],
    [{ available: false, reason: 'not-installed' }, null, 'missing', false],
    [{ available: false, version: '2.1.0', reason: 'logged-out' }, null, 'auth', false],
    [{ available: false, reason: 'no-response' }, null, 'blocked', false],
    [{ available: false, version: '2.1.0', reason: 'unreadable-auth' }, null, 'blocked', false],
    [{ available: false, reason: 'error' }, null, 'blocked', false],
    [{ available: false, reason: 'something-new' }, null, 'blocked', false],        // an unmapped reason is not another reason's sentence
  ];
  for (const [status, seen, state, selectable] of cases) {
    const r = claude(status, seen);
    assert.strictEqual(r.state, state, JSON.stringify(status));
    assert.strictEqual(r.selectable, selectable);
    assert.ok(r.reason && r.tags.length);
    assert.strictEqual(r.limited, true, 'Claude Code is always marked LIMITED (dev-compat)');
  }
  const seen = new Set(cases.map(([s, v]) => claude(s, v).reason));
  assert.ok(seen.size === 7, 'the 7 distinct states each have their own sentence');
  for (const status of [null, { available: true, version: '2.1.0' }, { available: false, reason: 'not-installed' }]) {
    const [, codex, opencode] = agentRows(status, null);
    for (const r of [codex, opencode]) {
      assert.deepStrictEqual([r.state, r.selectable, r.limited], ['unmeasured', false, false]);
      assert.ok(r.tags.includes('미실측') && r.tags.includes('현재 실행 불가'));
      assert.ok(!('version' in r) && !('models' in r), 'no invented CLI identity or model list');
    }
  }
});

test('the picker never calls a Work-creating API, never sends the selection, and offers no model list', () => {
  const code = src.code('app/renderer/agent-picker.mjs');
  assert.ok(!/workStart|taskRetry|taskCreate|createTask|routeIntent|\.invoke\(/.test(code));
  assert.ok(/api\.claudeStatus\(\)/.test(code));
  assert.ok(!/<option|\.models\b|modelList|--model/.test(code));
});

test('SC-02 mounts the picker without letting it gate or replace the start buttons', () => {
  const code = src.code('app/renderer/screens/sc02.js');
  assert.ok(/mountAgentPicker\(api, state\)/.test(code));
  assert.ok(!/agentPicker\.[a-z]+\([^)]*workStart/.test(code));
});
