'use strict';
/* V1-409 · claude-detect.detect(): the deadline timer is cleared once the probe settles (it used to keep the process alive ~16 s), and the
 * answer is exactly what the probe returned (a `return` inside the `finally` would replace it). Fake binaries only. */
process.env.JUQODE_CLAUDE_TIMEOUT_MS = '300';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require(path.join(__dirname, 'tmp.js'));
const R = path.resolve(__dirname, '..');
const detect = () => require(path.join(R, 'app/main/claude-detect.js')).detect();
const fake = (script) => { const f = path.join(tempDir('juqode-detect-'), 'claude'); fs.writeFileSync(f, `#!/bin/sh\n${script}\n`, { mode: 0o755 }); return f; };
const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;

test('a logged-in CLI: the value is the probe\'s, and no deadline timer is left behind', async () => {
  process.env.JUQODE_CLAUDE_BIN = fake('if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi\necho \'{"loggedIn":true}\'');
  const before = timers();
  const r = await detect();
  assert.deepStrictEqual(r, { available: true, version: '9.9.9' });
  assert.strictEqual(timers(), before, 'a Timeout is still pending after detect() settled');
});

test('logged out, not installed and a hung CLI: same values as before, no timer left behind', async () => {
  const before = timers();
  process.env.JUQODE_CLAUDE_BIN = fake('if [ "$1" = "--version" ]; then echo "1.0.0"; exit 0; fi\necho \'{"loggedIn":false}\'');
  assert.deepStrictEqual(await detect(), { available: false, version: '1.0.0', reason: 'logged-out' });
  process.env.JUQODE_CLAUDE_BIN = '/nonexistent/claude-for-test';
  assert.deepStrictEqual(await detect(), { available: false, reason: 'not-installed' });
  process.env.JUQODE_CLAUDE_BIN = fake('sleep 5');
  const t0 = Date.now();
  assert.deepStrictEqual(await detect(), { available: false, reason: 'no-response' });
  assert.ok(Date.now() - t0 < 2500, `a hung CLI took ${Date.now() - t0} ms`);
  assert.strictEqual(timers(), before);
});
