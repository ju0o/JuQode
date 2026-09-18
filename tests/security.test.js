/* WBS-30 · Security boundaries — `19` §S, `07` §2, D-126a.
 *
 * `21` WBS-30's acceptance is two sentences, and both are measurable:
 *
 *   ① 저장소 전체 문자열 검사에서 sandbox·격리·containment 주장이 0건
 *   ② `19` §C4 의 제외 목록(`.env*` · `*.pem` · `*.key`)에 있는 파일이 해석·설명 프롬프트·증거에
 *      포함되지 않는다
 *
 * The first one is about what the product SAYS. This product's entire thesis is that it does not
 * claim what it cannot show, and a false containment claim is the most dangerous kind: a user who
 * believes JuQode isolates will hand it a project they would not otherwise.
 *
 * The second is about what it READS. It is checked here END TO END — through the interpretation,
 * through BOTH read-only model prompts, and through the evidence basis — rather than in each
 * module separately, because the exclusion is only worth anything if it holds on every path at
 * once. A file excluded from the scan and then embedded in a prompt is not excluded.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const juqodeTempDirs = [];
const tempDir = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  juqodeTempDirs.push(d);
  return d;
};
process.on('exit', () => {
  for (const d of juqodeTempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
});

const { code: read, text: raw } = require(path.join(__dirname, 'src.js'));

/* ─────────────── ① the product does not claim containment ─────────────── */

test('no user-visible string claims isolation, sandboxing or protection', () => {
  /* `19` §S · `07` §2: JuQode runs Claude Code and Quick Commands as the user, in the user's own
   * environment. It is NOT a sandbox. `15` TD-01 makes the product say so out loud, and the one
   * thing it may never do is say the opposite.
   *
   * Only `copy.js` is scanned, because that is everything the user reads. A comment explaining
   * why the product does not isolate is documentation; a SENTENCE ON SCREEN saying it does is
   * the claim. */
  const copy = read('app/renderer/copy.js');
  const strings = [...copy.matchAll(/['"`]([^'"`\n]{2,})['"`]/g)].map((m) => m[1]);
  assert.ok(strings.length > 100, `expected the copy dictionary, found ${strings.length} strings`);

  /* Words that would assert a boundary this product does not have. */
  const CLAIMS = ['격리', '샌드박스', 'sandbox', '안전하게', '보호돼', '보호해', '차단해', '차단돼',
                  '막아드려', '막아줘요', 'containment', 'isolated'];
  const offenders = [];
  for (const s of strings) {
    for (const w of CLAIMS) if (s.includes(w)) offenders.push(`${w} :: ${s}`);
  }
  assert.deepStrictEqual(offenders, [], `a user-visible string claims a boundary the product does not have:\n  ${offenders.join('\n  ')}`);
});

test('the one line that states the truth is present and cannot be conditional', () => {
  /* `19` §S · Q-03 · `15` TD-01: 드로어 상단에 상시 표시되는 한 줄(닫을 수 없다). The inverse of
   * the test above — the product must not merely avoid the false claim, it must make the true
   * statement. */
  const copy = read('app/renderer/copy.js');
  assert.ok(copy.includes('여기서 치는 명령은 내 컴퓨터에서 내 권한으로 바로 실행돼요.'),
    'the banner text is gone from the dictionary');

  const body = read('app/renderer/screens/td01.js');
  assert.ok(body.includes('C.term.banner'), 'the drawer no longer draws the banner');
  /* It is drawn unconditionally, before any state branch. A banner inside an `if` is a banner
   * that some state can remove. */
  const drawn = body.indexOf('C.term.banner');
  const firstBranch = body.indexOf('function qcRegion');
  assert.ok(drawn < firstBranch, 'the banner is drawn after the state branches — a state could skip it');
});

test('masking is never described as a guarantee', () => {
  /* q02 §5.6: 가림의 효과는 측정되지 않았다. A product that calls it protection teaches the user
   * that whatever appeared unmasked is safe to share. */
  /* `raw`, not `code`: the SUBJECT of this test is what the file SAYS. The admission lives in a
   * comment, and so would a claim in the other direction — stripping them would make both
   * halves of this test unable to see the thing they are about. */
  const src = raw('app/main/qc/run.js');
  /* Canon's OWN words, not any of several phrasings: `19` §C4 says 가림의 효과는 측정되지
   * 않았다. Accepting a family of near-synonyms let a mutant replace the admission with the
   * claim "the masking keeps secrets off the screen" while a different disclaimer elsewhere in
   * the file kept the test happy. */
  assert.ok(/not measured/i.test(src), 'run.js no longer says the masking is NOT MEASURED');
  assert.ok(/never a guarantee|NOT a guarantee/i.test(src),
    'run.js no longer says the masking is not a guarantee');

  /* …and it makes no claim in the other direction. A comment that says masking KEEPS secrets
   * off the screen is exactly the belief the admission exists to prevent. */
  const claims = [/mask\w*[^.\n]{0,40}(keeps|prevents|ensures|guarantees)/i,
                  /(keeps|prevents|stops)[^.\n]{0,30}secrets?[^.\n]{0,30}(off|from|leaking)/i];
  for (const re of claims) {
    assert.ok(!re.test(src), `run.js claims the masking protects something: ${re}`);
  }
  const copy = read('app/renderer/copy.js');
  assert.ok(!/가려드려요|가려집니다|안 보이게 해드/.test(copy),
    'a user-visible string promises that secrets are hidden');
});

/* ─────────────── ② excluded files reach nothing ─────────────── */

/** A project carrying one of every excluded category, plus ordinary files. */
function projectWithSecrets() {
  const dir = tempDir('juqode-sec-');
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  /* Every value below is a SYNTHETIC FIXTURE MARKER — it is not a credential, and the point of
   * the test is that none of these strings reaches anything. */
  const MARK = 'juqode-synthetic-fixture-marker';
  w('package.json', JSON.stringify({ name: 'sec', scripts: { dev: 'vite' }, dependencies: { vite: '^5' } }, null, 2));
  w('package-lock.json', '{"lockfileVersion":3}');
  w('README.md', '# sec\n\n작은 프로젝트예요.\n');
  w('src/index.js', 'export const hi = 1;\n');
  w('.env', `SECRET_TOKEN=${MARK}\n`);
  w('.env.local', `LOCAL_SECRET=${MARK}\n`);
  w('.env.production', `PROD_SECRET=${MARK}\n`);
  w('certs/server.pem', `-----BEGIN CERTIFICATE-----\n${MARK}\n`);
  w('certs/server.key', `-----BEGIN PRIVATE KEY-----\n${MARK}\n`);
  w('id_rsa', `-----BEGIN OPENSSH PRIVATE KEY-----\n${MARK}\n`);
  w('keystore.p12', MARK);
  w('결제.key', MARK);                       // non-ASCII name — the ordinary case here
  return { dir, MARK };
}

test('no excluded file reaches the interpretation, either prompt, or the evidence basis', () => {
  const { dir, MARK } = projectWithSecrets();
  const { scan } = require(path.join(R, 'app/main/interpret/scan.js'));
  const { answers } = require(path.join(R, 'app/main/interpret/answers.js'));
  const narrate = require(path.join(R, 'app/main/interpret/narrate.js'));
  const explain = require(path.join(R, 'app/main/change/explain.js'));
  const G = require(path.join(R, 'app/main/evidence/git.js'));

  const scanned = scan(dir);
  const deterministic = answers(scanned);

  /* ── the interpretation ── */
  const interp = JSON.stringify({ scanned, deterministic });
  assert.ok(!interp.includes(MARK), 'a secret VALUE reached the interpretation');
  for (const f of scanned.readFiles) {
    assert.ok(!/\.env|\.pem$|\.key$|\.p12$|id_rsa/.test(f), `the scan read an excluded file: ${f}`);
  }

  /* ── the narrative prompt (WBS-04) ── */
  const narrPrompt = narrate.promptFor({ deterministic, readFiles: scanned.readFiles, facts: scanned.facts });
  assert.ok(!narrPrompt.includes(MARK), 'a secret VALUE reached the narrative prompt');
  for (const bad of ['.env', '.pem', '.key', 'id_rsa', 'p12']) {
    assert.ok(!narrPrompt.includes(bad), `an excluded PATH reached the narrative prompt: ${bad}`);
  }

  /* ── the evidence basis (WBS-08 · D-126a) ── */
  const store = tempDir('juqode-store-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('add', '-A', '.'); g('commit', '-qm', 'baseline');

  const basis = G.capture(dir, store, 'before');
  const tree = G.treePaths(dir, store, basis.ref);
  for (const f of tree) {
    assert.ok(!/\.env|\.pem$|\.key$|\.p12$|id_rsa/.test(f), `an excluded file is IN the basis tree: ${f}`);
  }
  /* …and the ledger names them as PATHS, with no content — D-126a's whole point. */
  assert.ok(!JSON.stringify(basis).includes(MARK), 'a secret VALUE reached the basis record');
  const ledgerPaths = basis.excluded.map((e) => e.path);
  assert.ok(ledgerPaths.some((p) => p.includes('.env')), 'the excluded set is not even reported as paths');

  /* ── the change-explanation prompt (WBS-26) ── */
  fs.writeFileSync(path.join(dir, 'src/index.js'), 'export const hi = 2;\n');
  fs.writeFileSync(path.join(dir, '.env'), `SECRET_TOKEN=${MARK}-changed\n`);
  const after = G.capture(dir, store, 'after');
  const names = G.changedPaths(dir, store, basis.ref, after.ref);
  for (const f of names) {
    assert.ok(!/\.env|\.pem$|\.key$|id_rsa/.test(f), `an excluded file is reported as changed: ${f}`);
  }
  const patch = G.diff(dir, store, basis.ref, after.ref);
  assert.ok(!patch.includes(MARK), 'a secret VALUE is in the diff the explanation prompt carries');

  const diffs = names.map((f, i) => ({ id: `d${i}`, file: f, patch, displayable: true }));
  const explPrompt = explain.promptFor(diffs);
  assert.ok(!explPrompt.includes(MARK), 'a secret VALUE reached the change-explanation prompt');
  for (const bad of ['.env', '.pem', 'id_rsa']) {
    assert.ok(!explPrompt.includes(bad), `an excluded PATH reached the change-explanation prompt: ${bad}`);
  }
});

test('the exclusion is by NAME, at every depth, and case-insensitively', () => {
  /* `19` §C1 ④ / D-126a. A secret in a subdirectory, or named `.ENV`, is still a secret. */
  const { isExcludedPath, isSecretName } = require(path.join(R, 'app/main/evidence/exclude.js'));
  for (const p of ['.env', '.env.local', '.ENV', 'deep/nested/.env.production',
                   'certs/server.pem', 'a/b/c/server.KEY', 'id_rsa', 'sub/id_ed25519',
                   'keystore.p12', '결제.key', 'node_modules/pkg/.env']) {
    assert.ok(isExcludedPath(p), `not excluded: ${p}`);
  }
  /* …and ordinary files are not swept up with them. */
  for (const p of ['src/index.js', 'README.md', 'package.json', 'envelope.js', 'keyboard.ts',
                   'src/environment.ts']) {
    assert.ok(!isExcludedPath(p), `wrongly excluded: ${p}`);
  }
  assert.strictEqual(typeof isSecretName, 'function');
});

/* ─────────────── no credential storage ─────────────── */

test('the schema has nowhere to put a credential', () => {
  /* `21` WBS-30: no credential storage. The strongest form of that is a schema with no column
   * for one — a product that cannot store a secret cannot leak one from its own store. */
  const schema = read('app/main/db/schema.sql').toLowerCase();
  for (const word of ['password', 'token', 'secret', 'credential', 'api_key', 'apikey',
                      'access_key', 'refresh_token', 'session_key']) {
    assert.ok(!new RegExp(`^\\s*${word}\\b`, 'm').test(schema), `the schema declares a ${word} column`);
  }
  /* …and `20` says so itself, in the deliberately-absent list. */
  assert.ok(read('app/main/db/schema.sql').includes('deliberately absent'),
    'the schema no longer states what it deliberately does not hold');
});

test('nothing in the app reads the user\'s shell or git credentials', () => {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(R, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs|cjs)$/.test(e.name)) files.push(rel);
    }
  })('app');

  const FORBIDDEN = ['.netrc', 'credential.helper', 'git-credential', '.aws/credentials',
                     'id_rsa', '.ssh/', 'keychain', 'libsecret'];
  for (const f of files) {
    const src = read(f);
    /* Two modules name some of these BECAUSE they exclude them, which is the opposite of
     * reading them. They are the ONLY two, and naming them here is what keeps the exemption
     * from quietly widening: a third file that starts matching on `id_rsa` fails this test. */
    if (f.endsWith('evidence/exclude.js') || f.endsWith('interpret/scan.js')) continue;
    for (const bad of FORBIDDEN) {
      assert.ok(!src.includes(bad), `${f} names ${bad}`);
    }
  }
});

/* ── WBS-33 · the two release rules that do not need Windows ───────────────────────────────
 *
 * `21` WBS-33's failure list names 텔레메트리·크래시 리포팅 코드가 빌드에 들어감, and its
 * acceptance says the product does not add telemetry or crash reporting — because `02` §2 puts
 * cloud dependency outside the MVP, not because a WBS decided it. The rest of WBS-33 needs
 * Windows and a signing certificate; these two are testable here and now, and they are the ones
 * that catch a regression BEFORE a build exists rather than after.
 */

test('no telemetry or crash-reporting dependency is declared', () => {
  const pkg = JSON.parse(read('package.json'));
  const declared = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}),
                                 ...(pkg.optionalDependencies ?? {}) });
  const TELEMETRY = ['sentry', 'bugsnag', 'rollbar', 'mixpanel', 'amplitude', 'posthog',
                     'segment', 'datadog', 'newrelic', 'appcenter', 'analytics', 'telemetry'];
  for (const d of declared) {
    for (const t of TELEMETRY) {
      assert.ok(!d.toLowerCase().includes(t),
        `${d} is a telemetry or crash-reporting dependency — \`02\` §2 puts cloud dependency outside the MVP`);
    }
  }
  /* …and the check can see what it claims to: a name from the list would be caught. */
  assert.ok(TELEMETRY.some((t) => '@sentry/electron'.includes(t)));
});

test('no code enables crash reporting or calls out to a network', () => {
  /* The offline e2e already boots the app with no network and counts zero external requests.
   * That measures the app as it is TODAY; this measures the code, so a newly added call is
   * caught when it is written rather than when someone happens to run the offline boot.
   *
   * `net.request`, `fetch`, `XMLHttpRequest` and Electron's `crashReporter` are the four ways
   * out. The renderer's CSP already sets `connect-src 'none'`, which stops the middle two in
   * the renderer — but not in the main process, which has no CSP. */
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(R, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs|cjs)$/.test(e.name)) files.push(rel);
    }
  })('app');
  assert.ok(files.length >= 20, `expected the app tree, found ${files.length} files`);

  const OUT = [
    [/\bcrashReporter\b/, 'Electron crashReporter'],
    [/\bnet\.request\s*\(/, 'electron net.request'],
    [/\bfetch\s*\(/, 'fetch'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bnew WebSocket\s*\(/, 'WebSocket'],
    [/require\(['"]https?['"]\)/, "require('http(s)')"],
    [/from ['"]node:https?['"]/, "import node:http(s)"],
  ];
  for (const f of files) {
    const src = read(f);
    for (const [re, name] of OUT) {
      assert.ok(!re.test(src), `${f} uses ${name} — the product makes no network calls`);
    }
  }
});

test('the CSP the renderer ships with forbids every outbound direction', () => {
  /* The other half of the same rule, on the surface that loads content. If this weakens, the
   * code scan above is the only thing left, and a scan cannot see what a page pulls in. */
  const html = read('app/renderer/index.html');
  const csp = /content="([^"]*)"/.exec(html.slice(html.indexOf('Content-Security-Policy')));
  assert.ok(csp, 'index.html has no CSP');
  for (const rule of ["default-src 'none'", "connect-src 'none'", "base-uri 'none'",
                      "form-action 'none'", "script-src 'self'", "style-src 'self'"]) {
    assert.ok(csp[1].includes(rule), `the CSP lost ${rule}`);
  }
});

test('a test run cannot write into the real application data directory', () => {
  /* MEASURED: `JUQODE_DB` relocated the store, but `evidenceStore` is derived from
   * `app.getPath('userData')` and was not relocated — so every e2e run left a bare git
   * repository per project in the developer's own `~/.config/juqode/evidence`. 201 of them had
   * accumulated, unbounded, with nothing to clean them up.
   *
   * One variable moves ALL of it. This checks the mechanism exists and that every harness uses
   * it, because the failure is invisible: the tests pass either way, and the only symptom is a
   * directory growing in someone's home. */
  /* USER_DATA 를 **만드는** 곳은 이제 하나다. 나머지는 가져다 쓴다. */
  assert.match(read('tests/e2e/fixture.mjs'), /const USER_DATA = fs\.mkdtempSync\(/,
    'the shared fixture points userData somewhere that is not a fresh temp directory');
  const main = read('app/main/main.js');
  assert.match(main, /if \(process\.env\.JUQODE_USER_DATA\) app\.setPath\('userData', process\.env\.JUQODE_USER_DATA\);/,
    'main.js cannot relocate userData');
  /* ORDER, on the code — the comment above the fix names `app.getPath('userData')` while
   * explaining it, which is the third time in this run that a scan has been fooled by a file
   * describing the thing it does not do. */
  const code = main;
  /* Before anything reads a path from it — `app.setPath` after `whenReady` is too late. */
  assert.ok(code.indexOf('JUQODE_USER_DATA') < code.indexOf('requestSingleInstanceLock'),
    'userData is relocated after the app has already started');
  assert.ok(code.indexOf('JUQODE_USER_DATA') < code.indexOf("app.getPath('userData')"),
    'a path is read from userData before it is relocated');

  /* 이 목록은 **앱을 띄우는 모든 파일**이다. 하나를 빠뜨리면 그 파일만 조용히 개발자의 진짜
   * `~/.config/juqode` 에 쓴다 — 이 검사가 있는 이유 그대로다. `record-demo.mjs` 는 영상을
   * 찍기 위해 앱을 띄우므로 같은 규칙 아래 있다. */
  for (const f of ['tests/e2e/visual.mjs', 'tests/e2e/boot.test.mjs', 'tests/e2e/offline-shutdown.mjs',
                   'scripts/demo/record-demo.mjs']) {
    const src = read(f);
    assert.ok(/JUQODE_USER_DATA: USER_DATA/.test(src), `${f} does not relocate userData`);
    /* 새 임시 디렉터리를 **직접 만들거나**, 그것을 만드는 fixture 에서 **가져오거나**. 둘 중
     * 하나여야 한다. 원래는 앞의 것만 봤고, fixture 를 visual.mjs 밖으로 뺀 순간 빨개졌다 —
     * 규칙이 깨진 것이 아니라 규칙이 한 파일 이름에 묶여 있었다. */
    assert.ok(/const USER_DATA = fs\.mkdtempSync\(/.test(src)
              || /USER_DATA[^\n]*from '[^']*fixture\.mjs'/.test(src),
      `${f} points userData somewhere that is not a fresh temp directory`);
    /* Every spawn in the file must carry it — one that does not is one that writes to the
     * real directory, and it would pass every other assertion in the suite. */
    const spawns = [...src.matchAll(/JUQODE_DB: [A-Za-z]+/g)].length;
    const relocs = [...src.matchAll(/JUQODE_USER_DATA: USER_DATA/g)].length;
    assert.strictEqual(relocs, spawns,
      `${f} launches the app ${spawns} times but relocates userData ${relocs} times`);
  }
});

/* ── `enforceLocalOnly`, driven rather than read ──────────────────────────────────────────── */

test('the offline guard blocks what leaves and passes what does not', () => {
  /* FOUND BY MUTATION: every `||` in the local-scheme list could be flipped to `&&` — making
   * the guard cancel EVERY request, including the app's own `file:` load — and the unit suite
   * passed. Nothing here ever called the handler; the tests read the source and the e2e only
   * ever counted requests that were blocked.
   *
   * A guard that is too strict is not "safe": it is an app that does not start, and it would
   * have shipped as one. Spike A finding O-1 is why this exists at the session layer at all —
   * `--proxy-server` blocks the renderer and not main-process `net.fetch`. */
  const { enforceLocalOnly } = require(path.join(R, 'app/main/security.js'));

  /* A session double: the real one is Electron's, and the only thing this needs from it is the
   * one registration call. Driving the handler is the point — a mock that returned a canned
   * answer would be testing the mock. */
  let handler = null;
  const session = { webRequest: { onBeforeRequest: (fn) => { handler = fn; } } };
  const read = enforceLocalOnly(session);
  assert.strictEqual(typeof handler, 'function', 'the guard registered nothing');

  const ask = (url) => {
    let got = null;
    handler({ url }, (r) => { got = r; });
    assert.ok(got, `the guard never answered for ${url}`);
    return got.cancel;
  };

  /* The app's OWN loads must go through. This is the half the mutation showed nobody checked. */
  for (const url of ['file:///app/renderer/index.html', 'devtools://devtools/bundled/x.js',
                     'data:text/css,body{}', 'blob:file:///abc', 'about:blank']) {
    assert.strictEqual(ask(url), false, `the guard cancelled the app's own ${url}`);
  }

  /* …and everything else is cancelled, whatever it dresses itself as. */
  for (const url of ['https://example.test/x', 'http://127.0.0.1:9/x', 'ws://example.test',
                     'wss://example.test', 'ftp://example.test', 'chrome-extension://abc/x',
                     'FILE:///not-lowercase', ' file:///leading-space', 'xfile:///prefix']) {
    assert.strictEqual(ask(url), true, `the guard let ${url} out`);
  }

  /* A request with no URL at all is not local. `details.url || ''` makes it the empty string,
   * which starts with none of the schemes — the safe answer, and worth pinning. */
  let none = null;
  handler({}, (r) => { none = r; });
  assert.strictEqual(none.cancel, true, 'a request with no URL was allowed');

  /* What it recorded, which is what the e2e asserts a zero of. */
  assert.strictEqual(read.count(), 10, `the guard counted ${read.count()} blocks`);
  assert.ok(read().includes('https://example.test/x'));
  /* Bounded: a renderer can drive this, and an unbounded array in the main process is an
   * allocation it controls. The COUNT keeps going; the list stops. */
  for (let i = 0; i < 200; i++) ask(`https://example.test/${i}`);
  assert.strictEqual(read().length, 100, 'the attempt list is unbounded');
  assert.strictEqual(read.count(), 210, 'the count stopped when the list did');
});
