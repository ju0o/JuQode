'use strict';
/* V1-409 slice B · what leaves the main process is masked RECURSIVELY with the one masker the Quick Command output
 * already uses (qc/run `mask`); what is STORED for execution or EXECUTED is not touched. Synthetic canaries only. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const guard = require(path.join(R, 'app/main/ipc-guard.js'));
const { trustedSender } = require(path.join(R, 'app/main/security.js'));
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const GH = `ghp_${'A1b2C3d4E5'.repeat(4).slice(0, 36)}`;
const ANT = 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKE12345';
const AKIA = 'AKIAFAKEFAKEFAKE1234';
const ENVV = 'API_TOKEN=abcd1234efgh5678';
const CANARIES = [GH.slice(4), ANT.slice(7), AKIA.slice(4), 'abcd1234efgh5678'];
const leaks = (v) => { const s = JSON.stringify(v); return CANARIES.filter((c) => s.includes(c)); };

test('maskOut: nested objects, arrays, Errors, cycles and depth are masked/bounded; shape of ordinary fields is kept', () => {
  const cyc = { note: GH }; cyc.self = cyc;
  const deep = {}; let p = deep; for (let i = 0; i < 40; i++) { p.n = {}; p = p.n; } p.leaf = ANT;
  const input = { ok: true, n: 3, ids: ['a1', 'b2'], nested: { list: [{ x: `x ${AKIA}` }, ENVV], err: new Error(`boom ${GH}`) }, cyc, deep, when: new Date(0) };
  const out = guard.maskOut(input);
  assert.deepStrictEqual(leaks(out), [], JSON.stringify(out));
  assert.strictEqual(out.ok, true); assert.strictEqual(out.n, 3); assert.deepStrictEqual(out.ids, ['a1', 'b2']);
  assert.strictEqual(out.nested.err.name, 'Error'); assert.ok(!('stack' in out.nested.err));
  assert.strictEqual(out.cyc.self, '[truncated]');
  assert.ok(out.when instanceof Date);
});

test('maskOut: ordinary non-secret text is not corrupted (hashes, long identifiers, URLs without credentials, paths)', () => {
  const ok = {
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', git: 'ba1cb02f1e0b6a8c7d5e4f3a2b1c0d9e8f7a6b5c',
    ident: 'getUserAccountPreferencesForOrganizationMembership', url: 'https://example.com/a/b?c=d#e', ssh: 'git@github.com:org/repo.git',
    cmd: 'npm run build', sentence: 'the password: field is optional', unexpected: "SyntaxError: Unexpected token: '}' at line 12", ps: 'tokenizer.ts',
    korean: '개발 서버를 켭니다', path: '/home/u/proj/src/app.ts:14:2', uuid: '123e4567-e89b-12d3-a456-426614174000',
  };
  assert.deepStrictEqual(guard.maskOut(ok), ok);
});

test('publicOut: nested detail (object, array, Error), non-detail nested strings and bare strings are scrubbed; exempt channels keep their text', () => {
  const r = { ok: false, reason: 'x', detail: { a: [GH, { b: new Error(ANT) }], c: ENVV }, narrative: { detail: `stderr ${AKIA}` }, data: { list: [ENVV] } };
  assert.deepStrictEqual(leaks(guard.publicOut('juqode:qc-run', r)), []);
  assert.deepStrictEqual(leaks(guard.publicOut('juqode:interpret', r)), []);
  assert.deepStrictEqual(leaks(guard.publicOut('juqode:whatever', GH)), []);
  assert.strictEqual(guard.publicOut('juqode:open-project', { ok: true, detail: { path: '/x' }, folder: GH }).folder, GH);   // the user's own pick
  const t = guard.publicOut('juqode:task-detail', { ok: true, task: { goal: `use ${GH}` } });
  assert.ok(t.task.goal.includes(GH), 'a Task goal the user typed must round-trip for editing');
  assert.deepStrictEqual(leaks(guard.publicOut('juqode:task-update', { ok: false, detail: GH })), []);
  assert.deepStrictEqual(guard.publicPush({ runId: 'r', tail: [`x ${GH}`] }).tail, ['x ***']);
});

test('publicPush: work-update / qc-update / term-update payloads carry no canary', () => {
  assert.deepStrictEqual(leaks(guard.publicPush({ runId: 'r', ended: true, output: ENVV, stop: { err: new Error(GH) }, lines: [AKIA] })), []);
});

function projectWith(scripts) {
  const dir = tempDir('juqode-ob409-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(dir, 'write.js'), "require('fs').writeFileSync('ran.txt', process.argv.slice(2).join(' ') + '|' + (process.env.API_TOKEN || ''))");
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, 'p');
  const pushed = [];
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => tempDir('juqode-ob409-ev-'), push() {}, pushQc: (u) => pushed.push(u) });
  const call = async (ch, ...a) => guard.publicOut(ch, await h[ch](null, ...a));   // main.js handle() wraps exactly like this
  return { dir, db, project, h, call, pushed };
}

test('package.json script text: qc-list / qc-route / qc-run / interpret / brief carry no canary; executed argv and script text are unchanged', async () => {
  const body = `API_TOKEN=abcd1234efgh5678 node write.js ${GH} ${ANT}`;
  const { dir, project, db, call, pushed } = projectWith({ build: body, prebuild: `echo ${AKIA}`, test: `node write.js ${GH}`, dev: `echo ${ENVV}` });
  const list = await call('juqode:qc-list', project.id);
  assert.deepStrictEqual(leaks(list), [], 'qc-list');
  const build = list.rules.find((r) => r.id === 'qc.build');
  assert.deepStrictEqual(build.data.argv, ['npm', 'run', 'build'], 'argv (what runs) must not change');
  assert.ok(build.data.scriptBody.includes('***') && build.data.scriptBody.includes('node write.js'), build.data.scriptBody);
  assert.deepStrictEqual(leaks(await call('juqode:qc-route', project.id, '빌드해줘')), [], 'qc-route');
  const interp = await call('juqode:interpret', project.id);
  assert.strictEqual(interp.ok, true);
  assert.deepStrictEqual(leaks(interp), [], 'interpret');
  assert.deepStrictEqual(leaks(db.prepare('select * from interpretation_answer').all()), [], 'stored interpretation rows');
  assert.deepStrictEqual(leaks(await call('juqode:brief', project.id)), [], 'brief');

  const run = await call('juqode:qc-run', project.id, 'qc.build');
  assert.strictEqual(run.ok, true, JSON.stringify(run));
  for (let i = 0; i < 100 && !pushed.some((u) => u.ended); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(pushed.some((u) => u.ended), 'run did not end');
  assert.deepStrictEqual(leaks(run), [], 'qc-run');
  assert.deepStrictEqual(leaks(pushed.map((u) => guard.publicPush(u))), [], 'qc-update push');
  /* the REAL script ran: the child saw the real token text and the real env value */
  const ran = fs.readFileSync(path.join(dir, 'ran.txt'), 'utf8');
  assert.strictEqual(ran, `${GH} ${ANT}|abcd1234efgh5678`);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts.build, body, 'package.json untouched');
  const unavailable = await call('juqode:qc-list', project.id);
  assert.deepStrictEqual(leaks(unavailable), []);
});

test('placeholder / unavailable qc-run: data and reason carry no canary', async () => {
  const { project, call } = projectWith({ test: `echo "Error: no test specified" && exit 1 # ${GH}` });
  assert.deepStrictEqual(leaks(await call('juqode:qc-run', project.id, 'qc.test')), []);
});

test('claude-detect: a CLI that prints canaries as version / error text leaks none', async () => {
  const bin = path.join(tempDir('juqode-ob409-cli-'), 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${GH}"; echo "${ENVV} ${ANT}" >&2; exit 3; fi\nexit 1\n`, { mode: 0o755 });
  process.env.JUQODE_CLAUDE_BIN = bin;
  try {
    const { detect } = require(path.join(R, 'app/main/claude-detect.js'));
    const r = await detect();
    assert.deepStrictEqual(leaks(r), [], JSON.stringify(r));
    const bin2 = path.join(path.dirname(bin), 'claude2');
    fs.writeFileSync(bin2, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${GH}"; exit 0; fi\necho '{"loggedIn":true}'\n`, { mode: 0o755 });
    process.env.JUQODE_CLAUDE_BIN = bin2;
    assert.deepStrictEqual(leaks(await detect()), []);
  } finally { delete process.env.JUQODE_CLAUDE_BIN; }
});

test('narrative prompt: a token pasted in the README does not ride into the model prompt', () => {
  const { promptFor } = require(path.join(R, 'app/main/interpret/narrate.js'));
  const out = promptFor({ deterministic: [], readFiles: [], facts: { readme: { head: `key ${GH} ${ENVV}` } } });
  assert.deepStrictEqual(leaks(out), []);
});

test('IPC sender: only the top frame of OUR page is trusted (a sub-frame, devtools:// or another file:// page is refused)', () => {
  const app = 'file:///opt/juqode/app/renderer/index.html';
  assert.strictEqual(trustedSender({ senderFrame: { url: app, parent: null } }, app), true);
  assert.strictEqual(trustedSender({ senderFrame: { url: `${app}#x`, parent: null } }, app), true);
  assert.strictEqual(trustedSender({ senderFrame: { url: app, parent: {} } }, app), false);
  assert.strictEqual(trustedSender({ senderFrame: { url: 'devtools://devtools/bundled/x.html', parent: null } }, app), false);
  assert.strictEqual(trustedSender({ senderFrame: { url: 'file:///tmp/evil.html', parent: null } }, app), false);
  assert.strictEqual(trustedSender({ senderFrame: { url: 'https://evil.example/', parent: null } }, app), false);
  assert.strictEqual(trustedSender({ senderFrame: null }, app), true);          // destroyed frame: unchanged behaviour
  assert.strictEqual(trustedSender({ senderFrame: { url: '', parent: null } }, app), true);
});

test('SC-04 raw diff text stays raw on the diff channels; their detail is still scrubbed', () => {
  const r = guard.publicOut('juqode:work-reader', { ok: true, patch: `+${GH}`, detail: GH });
  assert.strictEqual(r.patch, `+${GH}`);
  assert.deepStrictEqual(leaks(r.detail), []);
});

/* ---- QA round: regressions of the whole-return masker, and the walker / masker limits ---- */
const { mask } = require(path.join(R, 'app/main/qc/run.js'));
const { safeSnapshot } = require(path.join(R, 'app/main/work/context.js'));
const MASKER_LOOKALIKES = ['Rename MAX_TOKENS = 4096 to MAX_CONTEXT', 'Set PASSWORD_MIN_LENGTH = 8 in the form',
  'Support Basic authentication-based-access in the proxy', 'Add sk_render_pipeline_configuration_value to docs'];

test('F1: folders the renderer echoes back (recent[].path, data.cwd, term cwd, readFiles) are not masked, even when the name looks like a token', () => {
  const dir = '/tmp/x/sk_render_pipeline_configuration_value';
  assert.ok(mask(dir) !== dir, 'precondition: the masker does match this folder name');
  const boot = guard.publicOut('juqode:boot', { ok: true, recent: [{ id: 'p', path: dir }] });
  assert.strictEqual(boot.recent[0].path, dir);
  assert.strictEqual(guard.publicOut('juqode:qc-list', { rules: [{ data: { cwd: dir } }] }).rules[0].data.cwd, dir);
  assert.strictEqual(guard.publicOut('juqode:term-open', { ok: true, cwd: dir }).cwd, dir);
  assert.deepStrictEqual(guard.publicOut('juqode:brief', { interpretation: { readFiles: [`${dir}/a.js`] } }).interpretation.readFiles, [`${dir}/a.js`]);
  assert.deepStrictEqual(leaks(guard.publicOut('juqode:term-open', { cwd: dir, detail: GH })), []);
});

test('F2: a Work intent round-trips through work-get / history / work-update untouched (it was masked at write time already)', () => {
  for (const intent of MASKER_LOOKALIKES) {
    assert.strictEqual(guard.publicOut('juqode:work-get', { ok: true, work: { id: 'w', intent } }).work.intent, intent);
    assert.strictEqual(guard.publicOut('juqode:history', { ok: true, works: [{ id: 'w', intent }] }).works[0].intent, intent);
    assert.strictEqual(guard.publicPush({ work: { id: 'w', intent } }).work.intent, intent);
  }
  assert.strictEqual(guard.publicOut('juqode:qc-route', { phrase: MASKER_LOOKALIKES[0] }).phrase, MASKER_LOOKALIKES[0]);
});

test('F3: work-explain returns the reader payload raw like work-reader; detail is still scrubbed', () => {
  const diff = ['+const MAX_TOKENS = 4096;', '+-----BEGIN PRIVATE KEY-----', '+x', '+-----END PRIVATE KEY-----', '+ok'];
  for (const ch of ['juqode:work-reader', 'juqode:work-explain', 'juqode:work-changes']) {
    const r = guard.publicOut(ch, { ok: true, groups: [{ files: [{ patch: diff.join('\n'), blocks: [{ offset: 3, lines: diff }] }] }], detail: GH });
    assert.deepStrictEqual(r.groups[0].files[0].blocks[0].lines, diff, ch);
    assert.deepStrictEqual(leaks(r.detail), [], ch);
  }
});

test('F6: the shared masker is linear (URL-credentials scheme scan was quadratic) and still masks after a long run', () => {
  const t0 = Date.now();
  mask('a-'.repeat(80000)); mask(`http://${'a:'.repeat(80000)}`); mask('A'.repeat(200000)); mask('-----BEGIN PRIVATE KEY-----'.repeat(2000));
  assert.ok(Date.now() - t0 < 1500, `masker too slow: ${Date.now() - t0} ms`);
  assert.strictEqual(mask(`${'a-'.repeat(80000)} https://user:pw1234@host/x`).endsWith('***host/x'), true);
  assert.strictEqual(mask('postgres://user:pw1234@db/x'), '***db/x');
});

test('F7: walker caps leave an explicit marker (a string, never a null a renderer would dereference); key collisions and Error.code survive', () => {
  const many = guard.walk(Array.from({ length: 25000 }, (_, i) => ({ id: i })), (s) => s);
  assert.ok(many.length === 25000 && many.filter((x) => x === '[truncated]').length === 5001 && many.every((x) => x === '[truncated]' || typeof x.id === 'number'));
  assert.strictEqual(many.some((x) => x === null), false);
  assert.strictEqual(guard.walk({ a: { b: { c: { d: 1 } } } }, (s) => s, { depth: 3, nodes: 99, array: 99 }).a.b.c, '[truncated]');
  assert.deepStrictEqual(guard.walk([1, 2, 3, 4], (s) => s, { depth: 3, nodes: 99, array: 2 }), [1, 2, '[truncated]']);
  const keys = guard.maskOut({ 'A_TOKEN=abcd1234efgh5678': 1, 'B_TOKEN=abcd1234efgh5678': 2 });
  assert.deepStrictEqual(Object.values(keys).sort(), [1, 2], 'two keys that mask to one must both survive');
  assert.deepStrictEqual(leaks(keys), []);
  const e = Object.assign(new Error('x'), { code: 'ENOENT', extra: GH });
  assert.deepStrictEqual(guard.maskOut({ e }).e, { name: 'Error', code: 'ENOENT', message: 'x' });
  const d = guard.scrubDetail(Array.from({ length: 80 }, () => 'x'));
  assert.strictEqual(d.length, 51); assert.strictEqual(d[50], '[truncated]');
  assert.strictEqual(guard.scrubDetail({ a: { b: { c: { d: GH } } } }).a.b.c, '[truncated]');
});

test('F5: Authorization: Basic <payload> is fully redacted in what is stored (payload no longer left behind)', () => {
  const payload = 'dXNlcjpwYXNzd29yZDEyMw==';
  assert.ok(!safeSnapshot(`Authorization: Basic ${payload}`).safe.includes(payload));
  assert.ok(!safeSnapshot(`curl -H "Authorization: Basic ${payload}"`).safe.includes(payload));
  for (const t of MASKER_LOOKALIKES.slice(2, 3)) assert.strictEqual(safeSnapshot(t).safe, t);
});

test('F4: added patterns mask their class, JSON stays valid, and the QA corpus of ordinary text is unchanged', () => {
  const npm = `npm_${'aB3'.repeat(12)}`, aiza = `AIza${'aB3_-'.repeat(7)}`, hook = 'https://hooks.slack.com/services/T0000000/B0000000/XXXXXXXXXXXXXXXXXXXXXXXX';
  const j = mask('{"API_TOKEN":"zzzz1234yyyy5678","password": "hunter2hunter2","MAX_TOKENS":4096,"name":"abc"}');
  assert.strictEqual(JSON.parse(j).API_TOKEN, '***');
  assert.strictEqual(JSON.parse(j).MAX_TOKENS, 4096);
  assert.strictEqual(mask(`k ${npm} ${aiza} ${hook} api_key=zzzz1234yyyy5678xxxx`), 'k *** *** https://*** ***');
  const ordinary = ['"MAX_TOKENS": 4096', '"token_count": "twelve-or-more-characters"', '"name": "a-long-package-name-here"', 'api_key=process.env.API_KEY_VALUE', 'api_key=ABCDEFGHIJKLMNOPQRS',
    'npm_config_cache=/home/u/.npm', 'AIzaSy is a prefix', 'hooks.slack.com docs'];   // EXISTING over-matches, left OPEN: 'sk_<long identifier>', 'Basic authentication-based-access'; 'MAX_TOKENS = 4096' and 'PASSWORD_MIN_LENGTH = 8' are masked by the EXISTING env pattern (OPEN, not widened here)
  for (const t of ordinary) assert.strictEqual(mask(t), t, t);
});

test('sender check: only OUR page, top frame; about:blank / data: / devtools / other file:// are refused', () => {
  const app = 'file:///opt/juqode/app/renderer/index.html';
  for (const url of ['about:blank', 'data:text/html,<p>x</p>', 'devtools://devtools/bundled/devtools_app.html', 'file:///opt/juqode/app/renderer/other.html', 'file:///tmp/index.html', `${app}.evil/x`, 'chrome-error://chromewebdata/'])
    assert.strictEqual(trustedSender({ senderFrame: { url, parent: null } }, app), false, url);
});

test('main.js wires every push channel through publicPush and every handler through trustedSender (source assertion)', () => {
  const code = require(path.join(__dirname, 'src.js')).code('app/main/main.js');
  for (const ch of ['work-update', 'qc-update', 'term-update']) assert.match(code, new RegExp(`send\\('juqode:${ch}', guard\\.publicPush\\(`), ch);
  assert.match(code, /trustedSender\(e, APP_URL\)/);
  assert.match(code, /APP_URL = pathToFileURL\(RENDERER\)\.href/);
});
