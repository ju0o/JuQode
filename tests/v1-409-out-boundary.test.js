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

/* ---- final round: hostile-input time bounds, JSON-escaped payloads, stage-1 coverage, walker survivors ---- */
const GENERATORS = { 'eyJ-': 'eyJ-', 'a-': 'a-', 'a.': 'a.', 'a:': 'a:', '=': '=', AKIA: 'AKIA', begin: '-----BEGIN PRIVATE KEY-----', begin2: '-----BEGIN ',
  'sk-': 'sk-', 'sk-ant-': 'sk-ant-', 'Bearer ': 'Bearer ', 'Basic ': 'Basic ', space: ' ', newline: '\n', 'token ': 'token ', 'API_TOKEN ': 'API_TOKEN ',
  'ghp_': 'ghp_', 'xox-': 'xox-', 'http://a:': 'http://a:', 'api_key=': 'api_key=', 'json key': '"API_TOKEN":', AIza: 'AIza', 'eyJ.': 'eyJaaaaaaaaaa.',
  'eyJ.a.': 'eyJaaaaaaaaaa.aaaaaaaaaa!', 'Authorization: ': 'Authorization: ', 'a\\n': 'a\\n', '\\"': '\\"', korean: '개발 서버 ', path: '/tmp/a-b/' };
for (const n of [80000, 160000]) {
  test(`hostile input ${n} chars: every generator is masked in < 3 s (a load-proof bound; the real figure is < 0.3 s) by each masker`, () => {
    const slow = [];
    for (const [name, unit] of Object.entries(GENERATORS)) {
      const s = unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
      let t = Date.now(); mask(s); const a = Date.now() - t;
      t = Date.now(); safeSnapshot(s); const b = Date.now() - t;
      if (a > 3000 || b > 3000) slow.push(`${JSON.stringify(name)} mask=${a}ms snapshot=${b}ms`);
    }
    assert.deepStrictEqual(slow, []);
  });
}

test('a long field is masked WHOLE, never passed through: 5000-char eyJ run, unclosed PRIVATE KEY block, 100-char prefix before token=', () => {
  /* a JWT whose JOSE header is huge is masked whole; a header-less long `eyJ…` run is DATA (base64 JSON blob), see F3a below */
  const longJwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', pad: 'a'.repeat(4000) })).toString('base64url')}`;
  assert.ok(longJwt.startsWith('eyJ') && longJwt.length > 1024);
  assert.strictEqual(mask(`x ${longJwt} y`), 'x *** y');
  assert.ok(!safeSnapshot(`x ${longJwt}.${'B'.repeat(20)}.${'C'.repeat(20)} y`).safe.includes('BBBBBBBBBB'));
  const pem = `-----BEGIN PRIVATE KEY-----\n${'QUJD'.repeat(500)}\n(no end line)`;
  assert.ok(!safeSnapshot(pem).safe.includes('QUJDQUJD'));
  assert.ok(!mask(pem).includes('QUJDQUJD'));
  const longName = `${'a'.repeat(100)}token=${'v1v2v3v4'}`;
  assert.ok(!safeSnapshot(longName).safe.includes('v1v2v3v4'));
  assert.ok(!safeSnapshot(`${'a-'.repeat(60)}token=v1v2v3v4`).safe.includes('v1v2v3v4'));
  /* a closed block still leaves what follows it */
  assert.strictEqual(safeSnapshot('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\nafter').safe, '[redacted]\nafter');
});

test('JSON-escaped stream payloads: escaped quotes, \\n before a token, AIza, ghp_, key=value in a real JSON.stringify line', () => {
  const g = `ghp_${'A1b2C3d4E5'.repeat(4).slice(0, 36)}`, aiza = `AIza${'aB3_-'.repeat(7)}`;
  const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `{"API_TOKEN": "zzzz1234yyyy5678", "x": 1}\n${aiza}\n${g}\n${AKIA}` }] } });
  assert.ok(line.includes('\\"API_TOKEN\\"') && line.includes('\\nAIza') && line.includes('\\nghp_'), 'precondition: the line is escaped');
  for (const [name, f] of [['mask', mask], ['safeSnapshot', (x) => safeSnapshot(x).safe]]) {
    const out = f(line);
    for (const c of ['zzzz1234yyyy5678', aiza.slice(4), g.slice(4), AKIA.slice(4)]) assert.ok(!out.includes(c), `${name}: ${c}`);
    JSON.parse(out);                                  // still one valid JSON document
  }
  const twice = JSON.stringify(line);                  // escaped twice (a JSON string inside a JSON string)
  assert.ok(!mask(twice).includes('zzzz1234yyyy5678'));
});

test('Authorization header residue: any case, short payload, dotted payload are redacted whole at write time; prose stays', () => {
  for (const h of ['authorization: basic YTpi', 'Authorization: Basic dXNlcjpwYXNz.d29yZA', 'AUTHORIZATION=BASIC abc.def-ghi', 'Proxy-Authorization: Digest username="a", realm="b"', 'Authorization: Bearer abc.def'])
    assert.strictEqual(safeSnapshot(`curl -H "${h}" x`).safe.includes(h.split(/\s+/).pop()), false, h);   // (Digest realm WITHOUT key=value is prose: see F3c)
  assert.ok(!safeSnapshot('authorization: basic YTpi').safe.includes('YTpi'));
  assert.strictEqual(safeSnapshot('Support Basic authentication-based-access in the proxy').safe, 'Support Basic authentication-based-access in the proxy');
});

test('stage-1 (write-time) masking covers sk_live_, short ghp/xox, npm_, AIza, Slack hook, JSON values; the intent corpus and Korean/paths/diff survive', () => {
  const secrets = ['sk_live_' + 'aB3dE5fG7hI9jK1l', 'ghp_' + 'aB3dE5fG7hI9jK1lM', 'xoxb-12345678', `npm_${'aB3'.repeat(12)}`, `AIza${'aB3_-'.repeat(7)}`,
    'https://hooks.slack.com/services/T0000000/B0000000/XXXXXXXXXXXXXXXXXXXXXXXX', '{"API_TOKEN":"zzzz1234yyyy5678"}'];
  for (const sct of secrets) {
    const out = safeSnapshot(`use ${sct} now`).safe;
    assert.notStrictEqual(out, `use ${sct} now`, sct);
  }
  assert.ok(JSON.parse(safeSnapshot('{"API_TOKEN":"zzzz1234yyyy5678","n":1}').safe.replace(/\[redacted\]/, 'R')).n === 1);
  const keep = [...MASKER_LOOKALIKES, 'Raise TOKEN_LIMIT to 4096', 'Read SECRET_FILE from the vault folder', "SyntaxError: Unexpected token: '}' at line 12", 'Send the Bearer token in the header',
    '개발 서버를 켜고 로그인 토큰 만료를 확인해 주세요', '/home/u/proj/src/app.ts:14:2', '+const MAX_TOKENS = 4096;', 'git commit -m "fix: token refresh"', 'https://example.com/a?b=c'];
  for (const t of keep) {
    const out = safeSnapshot(t).safe;
    /* the pre-existing stage-1 rules are the baseline; this round must not ADD an erasure */
    assert.strictEqual(out, safeSnapshotBase(t), t);
  }
});
function safeSnapshotBase(t) {   // the write-time rules that existed at 9408025, for the "no new erasure" comparison
  return [[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g], [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi],
    [/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|sk-ant-[A-Za-z0-9_-]{20,})\b/g], [/\bsk-[A-Za-z0-9_-]{20,}\b/g], [/\bAKIA[0-9A-Z]{16}\b/g],
    [/\bBasic\s+[A-Za-z0-9+/=]{16,}/g],
    [/\b(?:[\w.-]*(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|auth(?:orization)?[\s_-]?(?:token)?|proxy[\s_-]?authorization|cookie|set[\s_-]?cookie|credential|token|password|passwd|secret(?:[\s_-]?access[\s_-]?key)?|private[\s_-]?key|client[\s_-]?secret))\b\s*[:=]\s*["']?[^\s"',;]{4,}["']?/gi],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g], [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi]]
    .reduce((s, [re]) => s.replace(re, '[redacted]'), t);
}

test('walker: colliding keys are linear and a 3rd/4th collision gets its own suffix; __proto__ stays a data key', () => {
  const o = {}; for (let i = 0; i < 4000; i++) o[`K_TOKEN=abcd1234efgh5678#${i}`] = i;
  const t = Date.now(); const m = guard.maskOut(o); const ms = Date.now() - t;
  assert.ok(ms < 500, `${ms} ms`);
  assert.strictEqual(Object.keys(m).length, 4000);
  assert.deepStrictEqual(Object.values(m).sort((a, b) => a - b).slice(0, 5), [0, 1, 2, 3, 4]);
  const three = guard.walk({ a1: 1, a2: 2, a3: 3, a4: 4 }, (k) => (/^a/.test(k) ? 'a' : k));
  assert.deepStrictEqual(Object.keys(three), ['a', 'a~2', 'a~3', 'a~4']);
  const real = guard.walk({ x1: 1, 'x~2': 2, x3: 3 }, (k) => (/^x\d/.test(k) ? 'x' : k));
  assert.strictEqual(Object.keys(real).length, 3);
  const proto = guard.maskOut(JSON.parse('{"__proto__":{"p":1},"ok":2}'));
  assert.deepStrictEqual(Object.keys(proto), ['__proto__', 'ok']);
  assert.strictEqual(Object.getPrototypeOf(proto), Object.prototype);
});

test('survivor power: root is kept, task channels are exempt, depth cap marks a canary at depth 30, short values are not masked', () => {
  assert.strictEqual(guard.publicOut('juqode:x', { root: '/tmp/sk_render_pipeline_configuration_value' }).root, '/tmp/sk_render_pipeline_configuration_value');
  for (const ch of ['juqode:task-list', 'juqode:task-detail', 'juqode:task-create', 'juqode:task-update'])
    assert.strictEqual(guard.publicOut(ch, { goal: `use ${GH}` }).goal, `use ${GH}`, ch);
  let deep = { canary: GH }; for (let i = 0; i < 30; i++) deep = { n: deep };
  const out = guard.maskOut(deep);
  assert.ok(!JSON.stringify(out).includes(GH.slice(4)));
  assert.ok(JSON.stringify(out).includes('[truncated]'));
  assert.strictEqual(mask('https://hooks.slack.com/services/T1'), 'https://hooks.slack.com/services/T1');
  assert.strictEqual(mask('{"API_TOKEN":"short"}'), '{"API_TOKEN":"short"}');
  assert.strictEqual(mask('api_key=abc123'), 'api_key=abc123');
  assert.strictEqual(mask('http://' + 'a'.repeat(40) + ':b@h').includes('a'.repeat(40)), false);
  assert.ok(Date.now() > 0);
});

test('ordinary UI text, paths, raw diff and copy survive the boundary untouched (Korean, folders, SC-04 raw diff, qc output lines)', () => {
  const ui = { ok: true, copy: '개발 서버를 켜는 중이에요. 잠시만 기다려 주세요.', path: '/home/사용자/내 프로젝트/src/app.ts', lines: ['npm run build', 'src/app.ts:14:2 error TS2304', '  at foo (/x/y.js:1:2)'], sha: 'ba1cb02f1e0b6a8c7d5e4f3a2b1c0d9e8f7a6b5c' };
  assert.deepStrictEqual(guard.publicOut('juqode:qc-list', ui), ui);
  const diff = { ok: true, groups: [{ files: [{ patch: '+const MAX_TOKENS = 4096;\n+api_key = process.env.X', blocks: [{ lines: ['+const MAX_TOKENS = 4096;'] }] }] }] };
  for (const ch of ['juqode:work-reader', 'juqode:work-changes', 'juqode:work-explain']) assert.deepStrictEqual(guard.publicOut(ch, diff), diff, ch);
});

/* ---- QA round 3: shared scanners (app/main/masking.js), no new holes from the linearisation, no new erasures ---- */
const { src } = { src: require(path.join(__dirname, 'src.js')) };
const PW = 'Zq9xKp2Lm8Vn4Rt6';
const ss = (t) => safeSnapshot(t).safe;
const both = (t) => [['safeSnapshot', ss(t)], ['mask', mask(t)]];

test('F1: a name with a prefix of 63 / 64 / 65 / 100 / 2000 characters still has its value masked for every keyword at write time', () => {
  const seps = ['_cookie=', '_credential=', '_auth=', '_authorization: ', '_token=', '_api_key=', '_private_key=', '_client_secret=', '_access_token=', '_refresh_token=', '_password=', '_secret=', '_set-cookie='];
  for (const n of [63, 64, 65, 100, 2000]) for (const k of seps) assert.ok(!ss('x'.repeat(n) + k + PW).includes(PW), `${n}${k}`);
});

test('F1/F4: the two maskers share ONE keyword list and the same scanner functions', () => {
  const M = require(path.join(R, 'app/main/masking.js'));
  const ctx = src.code('app/main/work/context.js');
  const run = src.code('app/main/qc/run.js');
  for (const f of ['maskPrivateKeys', 'maskUrlCredentials', 'maskJwt', 'maskAuthHeaders', 'maskJsonCredentials']) {
    assert.ok(ctx.includes(`M.${f}`) && run.includes(`M.${f}`), f);
    assert.strictEqual(typeof M[f], 'function');
  }
  assert.ok(M.KEYWORDS.includes('cookie') && M.KEYWORDS.includes('credential') && M.KEYWORDS.includes('authorization'));
});

test('F2a/b: a CLOSED private key with a 20 KB body is masked whole (secret line and END included); an UNCLOSED one to the end of the field', () => {
  const body = 'QUJD'.repeat(5000);
  const closed = `before\n-----BEGIN PRIVATE KEY-----\n${body}\nSECRETLASTLINE\n-----END PRIVATE KEY-----\nafter`;
  assert.strictEqual(ss(closed), 'before\n[redacted]\nafter');
  assert.strictEqual(mask(closed), 'before\n***\nafter');
  const unclosed = `before -----BEGIN RSA PRIVATE KEY-----\n${body}\nSECRETLASTLINE`;
  assert.strictEqual(ss(unclosed), 'before [redacted]');
  assert.strictEqual(mask(unclosed), 'before ***');
  const two = `-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\nmid\n-----BEGIN EC PRIVATE KEY-----\nBBBB\n-----END EC PRIVATE KEY-----\n`;
  assert.strictEqual(ss(two), '[redacted]\nmid\n[redacted]\n');
});

test('F2c: a 40-character URL scheme with credentials is masked by both maskers (was masked on 9408025, leaked at the {0,31} cap)', () => {
  for (const [, out] of both(`${'ab'.repeat(20)}://user:SECRET@h/p`)) assert.ok(!out.includes('SECRET') && out.endsWith('h/p'), out);
  for (const [, out] of both(`${'ab'.repeat(200)}://user:SECRET@h/p`)) assert.ok(!out.includes('SECRET'), out);   // past the 255 back-scan: the userinfo is still masked
  for (const [, out] of both('see https://example.com/a?b=c and git@github.com:org/r.git and http://host:8080/x')) assert.ok(out.includes('example.com/a?b=c') && out.includes('git@github.com') && out.includes('host:8080/x'), out);
  for (const [, out] of both('x \\nhttps://u:SECRET@h/p')) assert.ok(!out.includes('SECRET') && out.includes('x \\'), out);
});

test('F3a: a long base64 JSON blob starting eyJ is DATA (kept); a JWT is masked whole whatever its segment lengths', () => {
  const blob = Buffer.from(JSON.stringify({ rows: 'x'.repeat(30000) })).toString('base64url');
  const blob64 = Buffer.from(JSON.stringify({ rows: 'x'.repeat(30000), p: '+/' })).toString('base64');
  assert.ok(blob.startsWith('eyJ'));
  for (const t of [`payload=${blob}`, `data:application/json;base64,${blob64}`, blob]) for (const [, out] of both(t)) assert.ok(out.includes(blob.slice(0, 200)) || out.includes(blob64.slice(0, 200)), 'a base64 data run was erased');
  const jwt = (seg) => `eyJhbGciOiJIUzI1NiJ9.${seg}.${'S'.repeat(43)}`;
  for (const seg of ['e'.repeat(12), 'e'.repeat(30000)]) for (const [, out] of both(`t ${jwt(seg)} z`)) assert.strictEqual(out.replace(/\[redacted\]|\*\*\*/, 'M'), 't M z');
  const bigHeader = Buffer.from(JSON.stringify({ alg: 'HS256', pad: 'p'.repeat(3000) })).toString('base64url');
  for (const [, out] of both(`t ${bigHeader}.${'e'.repeat(20)}.${'S'.repeat(20)} z`)) assert.ok(!out.includes(bigHeader.slice(0, 40)) && out.endsWith(' z'), out);
  for (const [, out] of both(`t ${bigHeader} z`)) assert.ok(!out.includes(bigHeader.slice(0, 40)), out);                   // header-only JOSE run
  assert.ok(mask(`a\\r${jwt('e'.repeat(12))}`).includes('\\r***'));                                                          // escB: \r before the token start
  assert.ok(mask(`a\\t${jwt('e'.repeat(12))}`).includes('\\t***'));
});

test('F3b: a MENTION of a private-key marker erases nothing; real key material does', () => {
  const code = 'const x = 1; // filler\n'.repeat(1000);
  for (const t of ['-----BEGIN PRIVATE KEY----- appears in docs', `Use -----BEGIN PRIVATE KEY----- headers in tests.\n${code}`, `Look for "-----BEGIN RSA PRIVATE KEY-----" in the file.\n${code}`])
    for (const [, out] of both(t)) assert.strictEqual(out, t);
  const pem = (mid) => `-----BEGIN PRIVATE KEY-----${mid}`;
  for (const mid of [`\n${'MIIEvAIBADANBgkqhkiG9w0BAQEFAASC'.repeat(3)}`, '\r\nProc-Type: 4,ENCRYPTED\r\nDEK-Info: AES-128-CBC,AB\r\n\r\nxx', `\\n${'MIIEvAIBADANBgkqhkiG9w0BAQEFAASC'.repeat(3)}`])
    for (const [, out] of both(`k ${pem(mid)}`)) assert.strictEqual(out.replace(/\[redacted\]|\*\*\*/, 'M'), 'k M', out);
  assert.strictEqual(safeSnapshot('x').safe, 'x');
  const sec = fs.readFileSync(path.join(R, 'tests/security.test.js'), 'utf8');
  for (const [, out] of both(sec)) assert.strictEqual(out.length >= sec.length - 200, true, `tests/security.test.js lost ${sec.length - out.length} bytes`);
});

test('F3c: ordinary prose after "Authorization:" is kept; credentials are masked (Bearer / Token / Basic / Digest / Negotiate)', () => {
  const prose = ['Add an Authorization: Bearer header to every request', 'Authorization: Token refresh the thing', 'Authorization: Basic authentication flow', 'Authorization: Basic authentication-based-access',
    '로그인 Authorization: Bearer 헤더를 추가해줘', 'Proxy-Authorization: Digest realm', 'send authorization: negotiate negotiation'];
  for (const t of prose) assert.strictEqual(ss(t), t, `stage-1 ${t}`);
  for (const t of prose.filter((x) => !/Basic authentication-based/.test(x))) assert.strictEqual(mask(t), t, `mask ${t}`);
  const creds = [['authorization: basic YTpi', 'YTpi'], ['Authorization: Basic dXNlcjpwYXNz.d29yZA', 'dXNlcjpwYXNz'], ['Authorization: Bearer abc123', 'abc123'], ['Authorization: Bearer abc.def', 'abc.def'],
    ['Authorization: Token ghx9f8e7d6c5b4a3', 'ghx9f8e7d6c5b4a3'], ['Proxy-Authorization: Digest username="a", realm="b", response="c"', 'response'], ['Authorization: Negotiate YIIBsgYGKwYBBQUCoIIB0AQE', 'YIIBsgYG'], ['Authorization: Bearer ' + 'abcdefghijklmnopqrstuvwxyz', 'abcdefghijkl']];
  for (const [t, secret] of creds) for (const [name, out] of both(t)) assert.ok(!out.includes(secret), `${name}: ${t} -> ${out}`);
  /* the scheme and header name stay, only the payload is replaced (JSON stays valid) */
  const j = JSON.stringify({ headers: { Authorization: 'Basic dXNlcjpwYXNzd29yZA==' }, ok: 1 });
  for (const [, out] of both(j)) { assert.ok(!out.includes('dXNlcjpwYXNzd29yZA')); JSON.parse(out); }
  /* the documented residual: a Basic payload that is one lower-case word looks like prose and stays */
  assert.strictEqual(ss('Authorization: Basic secret'), 'Authorization: Basic secret');
});

test('F4: the display masker covers Cookie / Set-Cookie / X-Auth-Token / curl -u / Digest / Negotiate / case variants; the write-time masker the same', () => {
  const cases = [['Cookie: sid=abc123; theme=dark', 'abc123'], ['Set-Cookie: session=Zq9xKp2Lm8Vn; Path=/', 'Zq9xKp2Lm8Vn'], ['X-Auth-Token: abcd1234efgh', 'abcd1234efgh'],
    ['curl -u admin:hunter22 https://x.example/api', 'hunter22'], ['curl -s --user admin:hunter22 https://x', 'hunter22'], ['AUTHORIZATION: BEARER abc123def', 'abc123def']];
  for (const [t, secret] of cases) for (const [name, out] of both(t)) assert.ok(!out.includes(secret), `${name}: ${t} -> ${out}`);
  assert.strictEqual(mask('Cookie: consent banner text only'), 'Cookie: consent banner text only');   // (write-time `cookie: word` stays masked by the pre-existing generic rule)
  for (const t of ['cookie settings are in the footer', 'ssh -u user host', 'curl https://example.com/a -o out.txt']) for (const [name, out] of both(t)) assert.strictEqual(out, t, name);
});

test('F5: private-key shaped input is linear - growth 80k -> 160k below 3.5x, absolute < 3 s, at 1M still < 5 s', () => {
  for (const unit of ['-----BEGIN PRIVATE KEY-----', '-----BEGIN ', '-----END PRIVATE KEY-----\n-----BEGIN PRIVATE KEY-----']) {
    const time = (n) => { const s = unit.repeat(Math.ceil(n / unit.length)).slice(0, n); const t = process.hrtime.bigint(); ss(s); mask(s); return Number(process.hrtime.bigint() - t) / 1e6; };
    const best = (n) => Math.min(time(n), time(n), time(n));   // best of 3: a loaded machine adds noise, never speed
    const a = Math.max(best(80000), 5); const b = best(160000);
    assert.ok(b < 3000, `${JSON.stringify(unit)} 160k ${b} ms`);
    assert.ok(b / a < 3.5 || b < 200, `${JSON.stringify(unit)} not linear: ${a} -> ${b} ms`);
  }
  const t = Date.now(); ss('-----BEGIN PRIVATE KEY-----'.repeat(40000)); assert.ok(Date.now() - t < 5000);
});

test('F6: JSON credentials at any escape depth, long env-style keys, keys over the cap; escB for \\r and \\t', () => {
  let j = JSON.stringify({ API_TOKEN: 'zzzz1234yyyy5678', note: 'n' });
  for (let d = 1; d <= 9; d++) { for (const [name, out] of both(j)) assert.ok(!out.includes('zzzz1234yyyy5678'), `${name} depth ${d}`); j = JSON.stringify(j); }
  const pre = 'A'.repeat(40), suf = 'B'.repeat(40);
  for (const [name, out] of both(`{"${pre}_TOKEN${suf}":"zzzz1234yyyy5678","other":"keep-this-value-please"}`)) { assert.ok(!out.includes('zzzz1234yyyy5678'), name); assert.ok(out.includes('keep-this-value-please')); JSON.parse(out); }
  for (const [name, out] of both(`{"${'A'.repeat(600)}":"zzzz1234yyyy5678"}`)) assert.ok(!out.includes('zzzz1234yyyy5678'), name);
  for (const [, out] of both('{"AUTHOR_NAME":"somebody-with-long-name","COOKIE_POLICY":"short"}')) assert.ok(out.includes('somebody-with-long-name'));
  for (const [, out] of both('{"X_AUTH":"zzzz1234yyyy5678"}')) assert.ok(!out.includes('zzzz1234yyyy5678'));
  for (const esc of ['\\r', '\\t', '\\n']) for (const [name, out] of both(`a${esc}${GH}`)) assert.ok(!out.includes(GH.slice(4)), `${name} ${esc}`);
  /* an ASSIGNMENT (`=` straight after the name) may carry a 255-character name; a declaration `NAME: type;` keeps the 32-character window and is untouched */
  assert.ok(!mask(`${'A'.repeat(100)}_TOKEN=abc12345`).includes('abc12345'), 'env-var name with a 100-char prefix');
  assert.ok(!mask(`TOKEN${'B'.repeat(100)}=abc12345`).includes('abc12345'), 'env-var name with a 100-char suffix');
  assert.ok(!mask('MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=abc12345XYZ').includes('abc12345XYZ'));
  assert.ok(!mask('HTTP_COOKIE=sid=abc12345XYZ').includes('abc12345XYZ'));
  assert.strictEqual(mask('const HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS: string;'), 'const HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS: string;');
});

test('walker: 1M small strings are truncated by the leaf cap (not walked for seconds); ordinary results are not', () => {
  const input = { rows: Array.from({ length: 1000000 }, (_, i) => `r${i}`) };
  const t = Date.now();
  const big = guard.maskOut(input);
  assert.ok(Date.now() - t < 6000, `${Date.now() - t} ms (1M strings were 2.4 s of mask calls before the leaf cap, the cap bounds it to 200k)`);
  assert.ok(big.rows.includes('[truncated]') && big.rows.length === 1000000);
  const ok = guard.maskOut({ rows: Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, a: 'x', b: 'y', c: 1, d: true })) });
  assert.ok(!JSON.stringify(ok).includes('[truncated]'));
});

test('second (prefix-less) credential rule: every keyword it carries masks its value behind a 100-char name', () => {
  for (const k of ['api_key', 'api key', 'access_token', 'refresh-token', 'client_secret', 'secret_access_key', 'private_key', 'token', 'password', 'passwd', 'secret'])
    assert.ok(!ss(`${'n'.repeat(100)}${k}=${PW}`).includes(PW), k);
});

test('sc02 find(): a main-side "[truncated]" element is not taken for a live Work', () => {
  const code = src.code('app/renderer/screens/sc02.js');
  const m = /const live = (r\.works\.find\(\(w\) => [^;]+\));/.exec(code);
  assert.ok(m, 'the live-Work lookup moved');
  const find = new Function('r', `return ${m[1]};`);
  assert.strictEqual(find({ works: ['[truncated]'] }), undefined);
  assert.strictEqual(find({ works: ['[truncated]', null, { status: 'ended' }] }), undefined);
  assert.deepStrictEqual(find({ works: ['[truncated]', { status: 'running', id: 1 }] }), { status: 'running', id: 1 });
});

/* ---- QA round 4: single-pass scanners, PEM at any escape depth, Cookie only as a header, tight growth bounds, threshold boundaries ---- */
const nest = (v, d) => { let x = v; for (let i = 0; i < d; i++) x = JSON.stringify(x); return x; };
const CANARY = 'ZQ9XKP2LM8VN4RT6ABCDEFGH';

test('F2 (round 4): a private key inside JSON strings of ANY nesting depth 1..9 is masked, closed and unclosed, by both maskers', () => {
  const body = `MIIEvQIBADANBgkqhkiG9w0BAQEFAASC${CANARY}`;
  const shapes = {
    open: `-----BEGIN PRIVATE KEY-----\n${body}\ntail`,
    openCR: `-----BEGIN RSA PRIVATE KEY-----\r\n${body}\r\ntail`,
    closed: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\ntail`,
    closed2: `x -----BEGIN EC PRIVATE KEY-----\n${'AAAA'.repeat(10)}${body}\n-----END EC PRIVATE KEY-----`,
    openTab: `-----BEGIN PRIVATE KEY-----\t\n${body}`,
  };
  for (const [shape, plain] of Object.entries(shapes)) for (let d = 1; d <= 9; d++) {
    const wrapped = nest({ line: plain }, d);
    for (const [name, out] of both(wrapped)) assert.ok(!out.includes(CANARY), `${shape} depth ${d} ${name}`);
  }
  /* a mention at any depth still erases nothing */
  for (let d = 1; d <= 5; d++) { const t = nest({ line: `see -----BEGIN PRIVATE KEY----- in docs ${'x'.repeat(300)}` }, d); for (const [, out] of both(t)) assert.strictEqual(out, t); }
});

test('F1 (round 4): a repeated "Authorization: Digest " is linear in every surface (mask, safeSnapshot, scrubString, scrubDetail, publicOut)', () => {
  for (const unit of ['Authorization: Digest ', 'Proxy-Authorization: Digest ', 'Authorization: Digest x,']) {
    const s = unit.repeat(Math.ceil(160000 / unit.length));
    const t = Date.now(); mask(s); ss(s); guard.scrubString(s); guard.scrubDetail({ a: s, b: [s] }); guard.publicOut('juqode:x', { a: { b: [s] } });
    assert.ok(Date.now() - t < 2500, `${JSON.stringify(unit)} ${Date.now() - t} ms`);
  }
  assert.strictEqual(mask('Authorization: Digest username="a", realm="b"\nnext'), 'Authorization: Digest ***\nnext');
  assert.strictEqual(mask('Authorization: Digest realm only\nnext'), 'Authorization: Digest realm only\nnext');
  /* the first token is looked at for at most 4096 characters: key=value inside it is masked, beyond it the line is prose */
  assert.ok(!mask(`Authorization: Digest ${'k'.repeat(4000)}=v\nz`).includes('=v'));
});

test('F3/F4 (round 4): Cookie / Set-Cookie are masked only as HEADERS; identifiers, declarations and object keys are untouched', () => {
  const keep = ['const SSL_OP_COOKIE_EXCHANGE: number;', 'const HTTP2_HEADER_COOKIE: string;', 'const HTTP2_HEADER_SET_COOKIE: string;', "'set-cookie': ['foo=bar', 'a=b']",
    "headers.get('set-cookie')", 'Parses the `Cookie` header and returns a list', '## `Cookie` interface', 'Cookie: consent banner'.replace('Cookie: ', 'the Cookie '), 'cookie_policy = true'];
  for (const t of keep) assert.strictEqual(mask(t), t, t);
  const hit = [['Cookie: sid=abc123; theme=dark', 'abc123'], ['Set-Cookie: session=Zq9xKp2Lm8Vn; Path=/', 'Zq9xKp2Lm8Vn'], ['curl -H "Cookie: a=Zq9xKp2Lm8Vn" x', 'Zq9xKp2Lm8Vn'], ['{"Cookie":"a=Zq9xKp2Lm8Vn"}', 'Zq9xKp2Lm8Vn'],
    ["  cookie: 'get=Zq9xKp2Lm8Vn; and=b'", 'Zq9xKp2Lm8Vn'], ['a\\nSet-Cookie: s=Zq9xKp2Lm8Vn', 'Zq9xKp2Lm8Vn']];
  for (const [t, secret] of hit) for (const [name, out] of both(t)) assert.ok(!out.includes(secret), `${name}: ${t} -> ${out}`);
  assert.strictEqual(mask("  cookie: 'get=cookies; and=attributes'"), "  cookie: '***'");
  /* boundary of the pair-name look: 128 token characters then '=' is a header, 129 is not */
  /* round 5 widened the pair-name window from 128 to 512 characters */
  assert.ok(!mask(`Cookie: ${'n'.repeat(512)}=v1`).includes('=v1'));
  assert.ok(mask(`Cookie: ${'n'.repeat(513)}=v1`).includes('=v1'));
});

test('F5 (round 4): the leaf cap truncates STRINGS only - numbers, booleans and null keep their truth value after it', () => {
  const out = guard.maskOut({ rows: Array.from({ length: 250000 }, (_, i) => `r${i}`), ok: false, count: 5, flag: true, none: null, status: 'ended' });
  assert.strictEqual(out.ok, false); assert.strictEqual(out.count, 5); assert.strictEqual(out.flag, true); assert.strictEqual(out.none, null);
  assert.strictEqual(out.rows.filter((x) => x === '[truncated]').length, 50000);
  assert.strictEqual(out.status, '[truncated]');           // a string after the cap: marked, never passed
  const nums = guard.maskOut({ rows: Array.from({ length: 250000 }, (_, i) => i), last: 7 });
  assert.strictEqual(nums.rows[249999], 249999); assert.strictEqual(nums.last, 7);
});

/* tight growth-based bounds, best of 5, for every hostile generator, on every surface */
const HOSTILE = ['Authorization: Digest ', 'Proxy-Authorization: Digest ', 'Cookie: ', 'Cookie: aaaa ', 'Set-Cookie: ', 'Authorization: Basic ', 'Authorization: Bearer ', 'Authorization: Token ', 'Authorization: Negotiate ',
  'curl -u ', 'curl -s --user ', 'a\\ncurl -u ', 'curl -u a:b\\n', 'Cookie: a=b\\n', 'Cookie: a="b ', '>Cookie: ', 'Authorization: Token x\\n', 'Authorization: Negotiate Ab1\\n', 'HTTP_COOKIE=', 'A_TOKEN=', 'X-Api-Key: ', 'eyJ-', 'eyJaaaaaaaaaa.', 'a-', 'a.', 'a://', 'a://u:', '-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\nAAAA\n', '-----BEGIN ', 'token=', 'API_TOKEN=', '"API_TOKEN":', '\\"', 'a\\n', '%20', 'AKIA', 'sk-', 'ghp_', 'Bearer ', 'Basic ', '\n', ' '];
const GUARD_UNITS = ['Authorization: Digest ', 'Cookie: ', 'Cookie: aaaa ', 'Authorization: Bearer ', 'curl -u ', 'eyJ-', 'a-', 'a://u:', '-----BEGIN PRIVATE KEY-----', '"API_TOKEN":', 'a\\n', '%20'];
const SURFACES = {
  mask: (s) => mask(s), safeSnapshot: (s) => safeSnapshot(s),
  scrubString: (s) => guard.scrubString(s), scrubDetail: (s) => guard.scrubDetail({ a: s, b: [s] }),
  publicOut: (s) => guard.publicOut('juqode:x', { ok: true, a: { b: [s] }, detail: { x: s } }),
};
test('hostile input: for every generator and surface time(160k)/time(80k) < 3 and time(160k) < 1 s (best of 5)', () => {
  const bad = [];
  for (const unit of HOSTILE) for (const [sn, f] of Object.entries(SURFACES)) {
    if ((sn === 'scrubString' || sn === 'scrubDetail' || sn === 'publicOut') && !GUARD_UNITS.includes(unit)) continue;   // the scrub path runs both maskers + path rewrites: a representative subset keeps the file fast
    const best = (n) => { const s = unit.repeat(Math.ceil(n / unit.length)).slice(0, n); let m = Infinity; for (let i = 0; i < 5; i++) { const t = process.hrtime.bigint(); f(s); m = Math.min(m, Number(process.hrtime.bigint() - t) / 1e6); } return m; };
    const a = best(80000), b = best(160000);
    if (b >= 1000 || (b / Math.max(a, 1) >= 3 && b > 250)) bad.push(`${JSON.stringify(unit)} ${sn}: ${a.toFixed(0)} -> ${b.toFixed(0)} ms`);
  }
  assert.deepStrictEqual(bad, []);
});

test('threshold boundaries (min-1 / min / min+1) are pinned', () => {
  const seg = (n) => 'a'.repeat(n);
  /* JWT: every segment needs 10+ characters (the header counts after eyJ) */
  for (const [h, p, sg, masked] of [[9, 10, 10, false], [10, 10, 10, true], [11, 10, 10, true], [10, 9, 10, false], [10, 10, 9, false], [10, 11, 11, true]])
    for (const [name, out] of both(`x eyJ${seg(h)}.${seg(p)}.${seg(sg)} y`)) assert.strictEqual(out !== `x eyJ${seg(h)}.${seg(p)}.${seg(sg)} y`, masked, `${name} ${h}.${p}.${sg}`);
  /* a header-less 1023 vs 1024 character JOSE-looking run, no dots: data below the threshold, masked from it */
  const josePad = (n) => { const b = Buffer.from(JSON.stringify({ alg: 'HS256', p: 'x'.repeat(4000) })).toString('base64url'); return b.slice(0, n); };
  for (const [n, masked] of [[1023, false], [1024, true], [1025, true]]) for (const [name, out] of both(`t ${josePad(n)} z`)) assert.strictEqual(out.includes(josePad(n).slice(0, 30)), !masked, `${name} run ${n}`);
  /* trailing segments after a long JOSE header: 0, 1, 2 are all masked, a 3rd is not part of it */
  const H = josePad(1500);
  for (const [name, out] of both(`t ${H}.AAAA1111.BBBB2222.CCCC3333 z`)) assert.ok(!out.includes('AAAA1111') && !out.includes('BBBB2222') && out.includes('CCCC3333'), `${name} ${out}`);
  /* JSON key words: COOKIE alone is enough, AUTHOR is not */
  for (const [name, out] of both('{"SESSION_COOKIE":"zzzz1234yyyy5678"}')) assert.ok(!out.includes('zzzz1234yyyy5678'), name);
  for (const [name, out] of both('{"AUTHOR_NAME":"zzzz1234yyyy5678"}')) assert.ok(out.includes('zzzz1234yyyy5678'), name);
  /* JSON value 11 vs 12 characters */
  for (const [name, a] of both('{"API_TOKEN":"abcdefghijk"}')) assert.ok(a.includes('abcdefghijk'), name);
  for (const [name, a] of both('{"API_TOKEN":"abcdefghijkl"}')) assert.ok(!a.includes('abcdefghijkl'), name);
  /* Authorization payloads: Bearer 5 vs 6, Basic 3 vs 4, Negotiate 15 vs 16 (digits keep them off the prose list) */
  assert.strictEqual(ss('Authorization: Bearer ab123'), 'Authorization: Bearer ab123');
  assert.strictEqual(ss('Authorization: Bearer ab1234'), 'Authorization: Bearer [redacted]');
  assert.strictEqual(ss('Authorization: Basic Yt1'), 'Authorization: Basic Yt1');
  assert.strictEqual(ss('Authorization: Basic Yt12'), 'Authorization: Basic [redacted]');
  assert.strictEqual(ss(`Authorization: Negotiate ${'Ab1'.repeat(5)}`), `Authorization: Negotiate ${'Ab1'.repeat(5)}`);
  assert.strictEqual(ss(`Authorization: Negotiate ${'Ab1'.repeat(5)}x`), 'Authorization: Negotiate [redacted]');
  assert.strictEqual(ss(`Authorization: Token ${'a'.repeat(23)}`), `Authorization: Token ${'a'.repeat(23)}`);   // 23 plain letters: a word
  assert.strictEqual(ss(`Authorization: Token ${'a'.repeat(23)}1`), 'Authorization: Token [redacted]');
  /* name prefix before a keyword: 30 is inside the 64-character cap and is replaced WITH the prefix, 70 only keyword and value */
  assert.strictEqual(ss(`${'x'.repeat(30)}_token=abcd1234`), '[redacted]');
  assert.strictEqual(ss(`${'x'.repeat(70)}_token=abcd1234`), `${'x'.repeat(70)}_[redacted]`);
  /* curl -u far from `curl` (200 characters) and past the 512 span */
  assert.ok(!mask(`curl ${'x '.repeat(100)}-u user:hunter22`).includes('hunter22'));
  assert.ok(mask(`curl ${'x '.repeat(300)}-u user:hunter22`).includes('hunter22'));
  /* mixed-case JSON header keys, raw token without a scheme */
  for (const [name, out] of both('{"Authorization":"rawtoken1234567890","Cookie":"a=b","author":"somebodylongname12345"}')) { assert.ok(!out.includes('rawtoken1234567890'), name); assert.ok(out.includes('somebodylongname12345'), name); JSON.parse(out); }
});

/* ---- QA round 5: boundaries, escaped breaks, cookie prefixes, survivors ---- */
test('round 5: curl after an escaped break / %XX is found; "mycurl" is not curl', () => {
  for (const pre of ['a\\n', 'a\\r', 'a\\t', 'a\\\\n', 'a\\\\\\\\n', 'a%0A', '%41']) for (const [name, out] of both(`${pre}curl -u admin:${PW} https://x`)) assert.ok(!out.includes(PW), `${name} ${pre}`);
  for (const [name, out] of both(`mycurl -u admin:${PW} x`)) assert.ok(out.includes(PW), `${name}: \\b before curl`);
  for (const [name, out] of both(`curl\n-u admin:${PW}`)) assert.ok(out.includes(PW), `${name}: a different line`);
});

test('round 5: Cookie headers after any non-identifier character; identifiers and declarations untouched', () => {
  const secret = 'CanaryCookieValue9';
  for (const pre of ['>', '[', '=', '|', '/', '<', '*', '-', '\\', '\u{1F600}', '\0', '%41', 'a\\n', 'a\\t', '(', '{', ',', ';', '"', "'"]) for (const [name, out] of both(`${pre}Cookie: sid=${secret}`)) assert.ok(!out.includes(secret), `${name} prefix ${JSON.stringify(pre)}`);
  for (const t of [`Cookie:        sid=${secret}`, `Cookie: a[0]@=${secret}`, `Cookie: sid =${secret}`, `Cookie: sid="${secret}"`, `Cookie: a=b; c="x ${secret}"`, `Cookie: ${'n'.repeat(300)}=${secret}`])
    for (const [name, out] of both(t)) assert.ok(!out.includes(secret), `${name} ${t.slice(0, 40)}`);
  for (const t of ['SSL_OP_COOKIE_EXCHANGE: number;', 'HTTP2_HEADER_COOKIE: string;', 'xCookie: a=b', "'set-cookie': ['foo=bar']", '_Cookie: a=b', '9Cookie: a=b'])
    assert.strictEqual(mask(t), t, t);
  assert.ok(mask('Cookie: 123=abc9').endsWith('***'));                               // a digit may start the cookie name
  assert.strictEqual(mask('x\\tCookie: sid=v1'), 'x\\tCookie: ***');
  assert.strictEqual(ss('const HTTP2_HEADER_COOKIE: string;'), 'const HTTP2_HEADER_COOKIE: string;');   // a declaration is not stored as `const [redacted];`
  assert.strictEqual(ss('password: string'), 'password: string');
  assert.ok(!ss('password: strings9x').includes('strings9x'));                         // only the bare type words are exempt
});

test('round 5: a scheme token ends at an escaped break or any backslash; Digest lines end at escaped breaks and CRLF', () => {
  for (const sch of ['Negotiate', 'Token', 'Bearer', 'Basic']) for (const brk of ['\\n', '\\r', '\\t', '\\\\n', '\\\\\\"']) {
    const tok = sch === 'Basic' ? 'Q2FuYXJ5VmFsdWU5eA==' : 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8';
    for (const [name, out] of both(`Authorization: ${sch} ${tok}${brk}end`)) assert.ok(!out.includes(tok) && (name === 'safeSnapshot' || out.endsWith(`${brk}end`)), `${name} ${sch} ${brk} -> ${out}`);   // (write-time Bearer is also caught by the older bearer rule, which may swallow the rest)
  }
  assert.strictEqual(mask('Authorization: Digest a="b"\r\nnext'), 'Authorization: Digest ***\r\nnext');
  assert.strictEqual(mask('Authorization: Digest a="b"\\nnext'), 'Authorization: Digest ***\\nnext');
  assert.ok(mask(`Authorization: Digest ${'k'.repeat(5000)}=v\nz`).includes('=v'), 'a token longer than 4096 characters is prose');
});

test('round 5: boundary pins (%XX before a token, PEM body size, scan windows, detail cap)', () => {
  const g = `ghp_${'A1b2C3d4E5'.repeat(4).slice(0, 36)}`;
  for (const pre of ['%0A', '%41', '%2F']) for (const [name, out] of both(`x${pre}${g}`)) assert.ok(!out.includes(g.slice(4)), `${name} ${pre}`);
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl';
  for (const pre of ['%0A', '%41']) for (const [name, out] of both(`x${pre}${jwt}`)) assert.ok(!out.includes('c2lnbmF0'), `${name} ${pre}`);
  /* unclosed PEM: 30 base64 characters is a mention, 40 is key material */
  for (const [n, masked] of [[30, false], [39, false], [40, true]]) for (const [name, out] of both(`-----BEGIN PRIVATE KEY-----\n${'A'.repeat(n)}`)) assert.strictEqual(!out.includes('A'.repeat(n)), masked, `${name} body ${n}`);
  /* the 40 characters may be spread over a long stretch of line breaks (window 400) */
  for (const [name, out] of both(`-----BEGIN PRIVATE KEY-----\n${'A\n\n\n\n\n'.repeat(40)}`)) assert.ok(!out.includes('A\n'), `${name} spread body`);
  for (const [name, out] of both(`-----BEGIN PRIVATE KEY-----\n  \n\t\n${'A'.repeat(40)}`)) assert.ok(!out.includes('A'.repeat(40)), `${name} whitespace before the body`);
  assert.strictEqual(guard.scrubString('x'.repeat(600)).length, 501);
  /* header-style JSON key names */
  for (const k of ['x-api-key', 'X-Auth-Token', 'x-access-token', 'x-csrf-token', 'Proxy-Authorization', 'Set-Cookie']) for (const [name, out] of both(`{"${k}":"CanaryHeaderVal12345"}`)) assert.ok(!out.includes('CanaryHeaderVal12345'), `${name} ${k}`);
  assert.ok(mask('{"x-trace-id":"CanaryHeaderVal12345"}').includes('CanaryHeaderVal12345'));
});

/* ---- QA round 7 ---- */
const BS_PREFIXES = ['Cookie: a=b', 'Set-Cookie: a=b', '{"Cookie":"a=b', 'Cookie: a=b;', '>Cookie: a=b', 'Cookie: ', 'Authorization: Digest a=b', 'Authorization: Digest ', 'Proxy-Authorization: Digest a=b', 'Authorization: Negotiate Ab1',
  'Authorization: Token Ab12', 'Authorization: Basic Yt12', 'Authorization: Bearer Ab12', 'curl -u a:b', 'x-api-key: ', '-----BEGIN PRIVATE KEY-----\\n', '-----BEGIN PRIVATE KEY-----\n', 'https://u:p', 'a'.repeat(20) + '://u:p',
  'eyJhbGciOiJIUzI1NiJ9.', 'API_TOKEN=', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=', 'password: string', '"API_TOKEN":"'];
const BS_UNITS = ['\\', '\\\\n', '\\x', '\\\\\\\\', '\\n\\', '\\"', ' \\ '];
test('backslash-run adversarial suffixes: every prefix class x every suffix unit is linear (time(120k)/time(60k) < 3, < 1 s at 120k)', () => {
  const bad = [];
  const best = (f, s) => { let m = Infinity; for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); f(s); m = Math.min(m, Number(process.hrtime.bigint() - t) / 1e6); } return m; };
  for (const pre of BS_PREFIXES) for (const unit of BS_UNITS) {
    const mk = (n) => pre + unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    for (const [sn, f] of [['mask', mask], ['safeSnapshot', safeSnapshot]]) {
      const a = best(f, mk(60000)), b = best(f, mk(120000));
      if (b >= 1000 || (b / Math.max(a, 1) >= 3 && b > 250)) bad.push(`${JSON.stringify(pre)} x ${JSON.stringify(unit)} ${sn}: ${a.toFixed(0)} -> ${b.toFixed(0)} ms`);
    }
  }
  for (const pre of ['Cookie: a=b', 'Authorization: Digest a=b', 'Authorization: Token Ab12', '"API_TOKEN":"']) for (const unit of ['\\', '\\\\n', '\\"']) {
    const s = pre + unit.repeat(Math.ceil(120000 / unit.length)).slice(0, 120000);
    for (const [sn, f] of [['scrubString', guard.scrubString], ['scrubDetail', (x) => guard.scrubDetail({ a: x })], ['publicOut', (x) => guard.publicOut('juqode:x', { a: { b: [x] } })]]) {
      const b = best(f, s);
      if (b >= 1500) bad.push(`${JSON.stringify(pre)} x ${JSON.stringify(unit)} ${sn}: ${b.toFixed(0)} ms @120k`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('round 7 F3: "=>" / "==" / prose around "=" are not cookie pairs', () => {
  for (const t of ['cb: (err: Error | null, cookie: unknown) => void) & x', 'Cookie: please = accept', 'set cookie: yes => no', 'cookie: a == b', 'cookie: a <= b', '쿠키: 이름 = 값 으로 설정', 'Cookie: =x'])
    for (const [name, out] of both(t)) if (name === 'mask') assert.strictEqual(out, t, t);
  assert.ok(!mask('Cookie: sid =Zq9x').includes('Zq9x'));          // a gap before '=' is fine when no gap follows
  assert.ok(!mask('Cookie: sid    =Zq9x').includes('Zq9x'));      // 4 spaces
  assert.ok(mask('Cookie: sid     =Zq9x').includes('Zq9x'));      // 5 spaces: prose
  assert.strictEqual(mask('Cookie: a:b'), 'Cookie: a:b');         // ':' is not a pair separator
});

test('round 7 F4/F1: long names - structure decides (dotenv NAME=value, credential-looking values), not the name', () => {
  const keep = ['export const METRIC_GEN_AI_SERVER_TIME_PER_OUTPUT_TOKEN = "gen_ai.server.time";', 'const SESSION_COOKIE = "sid";', 'const DEEP_HEADER_SET_COOKIE = {', 'process.env.X_COOKIE = value;',
    '쿠키 COOKIE_MAX_AGE = 3600 으로 변경', 'export const MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: string;', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: Record<string, X>;',
    'const MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: Uint8Array;', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: {', 'HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS: string;'];
  for (const t of keep) assert.strictEqual(mask(t), t, t);
  for (const t of ['MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=abc12345XYZ', 'HTTP_COOKIE=sid=abc12345XYZ', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: Zq7abc1234567xyz',
    'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN = "Zq7abc1234567xyzQQ"', `${'A'.repeat(100)}_TOKEN=abc12345`]) assert.ok(!/abc12345|Zq7abc/.test(mask(t)), t);
  assert.ok(!mask('MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: Zq7abc123456').includes('Zq7abc'));
  assert.strictEqual(mask('MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: Zq7abc123456;'), 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: Zq7abc123456;');   // followed by ';': typing context
});

test('round 7 F2: JSON Set-Cookie arrays, escaped cookie JSON, 100 spaces after the colon, inner quotes', () => {
  for (const t of ['{"Set-Cookie":["sid=Zq9xKp2L"]}', '{"cookie": "a=1; sid=Zq9xKp2L"}', `Cookie:${' '.repeat(100)}sid=Zq9xKp2L`, 'x"Cookie: sid="Zq9xKp2L""', 'curl -H "Cookie: sid="Zq9xKp2L"" x', nest({ cookie: 'a=1; sid=Zq9xKp2L' }, 1), nest({ cookie: 'a=1; sid=Zq9xKp2L' }, 3)])
    for (const [name, out] of both(t)) assert.ok(!out.includes('Zq9xKp2L'), `${name} ${t}`);
  assert.strictEqual(mask("'set-cookie': ['foo=bar', 'a=b']"), "'set-cookie': ['foo=bar', 'a=b']");   // a JS array of single-quoted strings is code
});

test('round 7 mutation survivors', () => {
  assert.strictEqual(mask('Cookie: a=b\\nnext'), 'Cookie: ***\\nnext');                         // value ends at an escaped break
  assert.strictEqual(mask('Cookie: a=b\\tnext'), 'Cookie: ***\\tnext');
  assert.strictEqual(mask("'Cookie: a=b' tail"), "'Cookie: ***' tail");                          // quote before the name ends the value
  assert.strictEqual(mask('"Cookie: a=b" tail'), '"Cookie: ***" tail');
  assert.ok(!ss('password: stringsXX9').includes('stringsXX9'), 'only a BARE type word is exempt');
  assert.strictEqual(ss('password: string;'), 'password: string;');
  for (const [name, out] of both(`-----BEGIN PRIVATE KEY-----\\t${'A'.repeat(40)}`)) assert.ok(!out.includes('AAAAAAAAAA'), `${name} escaped tab before the key body`);
  assert.strictEqual(mask(`curlx -u user:${PW} x`).includes(PW), true);                         // \b after curl
  assert.strictEqual(mask('Cookie: a=b=c'), 'Cookie: ***');
});
