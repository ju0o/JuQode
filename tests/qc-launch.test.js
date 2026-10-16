'use strict';
/* Quick Command launch resolution (`app/main/qc/launch.js`) -- the Windows `npm` ENOENT fix.
 *
 * Two kinds of case:
 *   - RESOLUTION: the Windows branch is driven on any host by passing `platform: 'win32'` plus a
 *     throwaway directory laid out like a Node install (a real node behind `node.exe`, npm's
 *     `node_modules/npm/{package.json,bin/npm-cli.js}`, an `npm.cmd`). What it proves is the
 *     decision logic; it is NOT a Windows run.
 *   - EXECUTION: the real `run.start` runs a real `npm run <name>` with hostile script names. On H1
 *     this goes through node.exe + npm-cli.js, on POSIX through the plain argv; the assertions are the
 *     same on both: the name stays one argument, nothing else runs.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const { resolveLaunch } = require(path.join(R, 'app/main/qc/launch.js'));
const run = require(path.join(R, 'app/main/qc/run.js'));
const WIN = process.platform === 'win32';

const dirs = [];
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* busy or gone */ } } });

/** A directory laid out like `C:\Program Files\nodejs`, simulated on any host. */
function nodeInstall({ electron = false, npm = true, npmName = 'npm', shimDir = null } = {}) {
  const home = tmp('juqode-qcl-');
  const node = path.join(home, 'node.exe');
  if (electron) fs.writeFileSync(node, '#!/bin/sh\necho \'["node","v99.0.0",true]\'\n', { mode: 0o755 });   // an Electron-as-node
  else fs.symlinkSync(process.execPath, node);
  if (npm) {
    const root = path.join(shimDir ?? home, 'node_modules', 'npm');
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'bin', 'npm-cli.js'), '// stand-in\n');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: npmName, version: '10.9.9' }));
  }
  fs.writeFileSync(path.join(shimDir ?? home, 'npm.cmd'), '@echo off\r\n');
  return home;
}
const win = (home, extra = {}) => ({ platform: 'win32', delimiter: ':', env: { PATH: [].concat(home).join(':') }, ...extra });

test('POSIX: the argv is passed through untouched', () => {
  const r = resolveLaunch(['npm', 'run', 'build'], { platform: 'linux' });
  assert.deepStrictEqual(r, { ok: true, argv: ['npm', 'run', 'build'], identity: null });
});

test('Windows: npm becomes <verified node absolute> <npm-cli.js absolute> run <script>, shell-free', () => {
  const home = nodeInstall();
  const r = resolveLaunch(['npm', 'run', 'build'], win(home));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(r.argv, [fs.realpathSync(process.execPath), fs.realpathSync(path.join(home, 'node_modules', 'npm', 'bin', 'npm-cli.js')), 'run', 'build']);
  assert.ok(r.argv.slice(0, 2).every((p) => path.isAbsolute(p)));
  assert.strictEqual(r.identity.npm.version, '10.9.9');
  assert.match(r.identity.node.version, /^v\d+/);
});

test('Windows: a node.exe that is Electron (or not Node at all) is refused -- process.execPath is never assumed to be Node', () => {
  const home = nodeInstall({ electron: true });
  const r = resolveLaunch(['npm', 'run', 'build'], win(home));
  assert.deepStrictEqual([r.ok, r.reason], [false, 'node-unverified']);
  assert.deepStrictEqual(resolveLaunch(['npm', 'run', 'build'], win(tmp('juqode-empty-'))).reason, 'node-not-found');
});

test('Windows: npm-cli.js must exist and belong to a package named npm', () => {
  assert.strictEqual(resolveLaunch(['npm', 'run', 'build'], win(nodeInstall({ npm: false }))).reason, 'npm-cli-not-found');
  assert.strictEqual(resolveLaunch(['npm', 'run', 'build'], win(nodeInstall({ npmName: 'not-npm' }))).reason, 'npm-cli-not-found');
});

test('Windows: the npm beside the first npm.cmd on PATH wins, like the shim does; the node directory is the fallback', () => {
  const nodeHome = nodeInstall();
  const globalDir = tmp('juqode-qcl-global-');
  const global = nodeInstall({ shimDir: globalDir });                              // its own node_modules\\npm
  fs.rmSync(path.join(global, 'node.exe'));                                        // only the shim dir matters here
  const r = resolveLaunch(['npm', 'run', 'x'], win([globalDir, nodeHome]));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(r.argv[1].startsWith(fs.realpathSync(globalDir)), `used ${r.argv[1]}`);
  const only = resolveLaunch(['npm', 'run', 'x'], win([nodeHome]));
  assert.ok(only.argv[1].startsWith(fs.realpathSync(nodeHome)));
});

test('Windows: pnpm, yarn and bun run only as a native .exe -- a shim is refused and NEVER replaced by npm', () => {
  const home = nodeInstall();                                                      // a perfectly good npm is available
  for (const pm of ['pnpm', 'yarn', 'bun']) {
    fs.writeFileSync(path.join(home, `${pm}.cmd`), '@echo off\r\n');
    const refused = resolveLaunch([pm, 'run', 'build'], win(home));
    assert.deepStrictEqual([refused.ok, refused.reason], [false, 'unverified-launcher'], pm);
    assert.ok(!JSON.stringify(refused).includes('npm-cli'), `${pm} fell back to npm`);
    fs.writeFileSync(path.join(home, `${pm}.exe`), 'MZ');
    const ok = resolveLaunch([pm, 'run', 'build'], win(home));
    assert.strictEqual(ok.ok, true, pm);
    assert.deepStrictEqual(ok.argv.slice(1), ['run', 'build'], pm);
    assert.ok(path.basename(ok.argv[0]).toLowerCase() === `${pm}.exe`, ok.argv[0]);
  }
});

test('an argument npm would read as an option, an empty name, or a NUL is refused on every host', () => {
  for (const platform of ['linux', 'win32']) {
    const opts = platform === 'win32' ? win(nodeInstall()) : { platform };
    for (const bad of ['-x', '--prefix=/etc', '--', '']) {
      assert.strictEqual(resolveLaunch(['npm', 'run', bad], opts).reason, 'unsafe-script-name', `${platform}: ${JSON.stringify(bad)}`);
    }
    assert.strictEqual(resolveLaunch(['npm', 'run', 'a\0b'], opts).reason, 'unsafe-argument', platform);
  }
  assert.strictEqual(resolveLaunch([], { platform: 'linux' }).reason, 'bad-argv');
  assert.strictEqual(resolveLaunch(['npm', 3], { platform: 'linux' }).reason, 'bad-argv');
});

/* ───────────── EXECUTION: the real run.start ───────────── */

function project(scripts) {
  const dir = tmp('juqode-qcx-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', scripts }));
  return dir;
}
const writer = (file, body = 'x') => `node -e "require('fs').writeFileSync('${file}','${body}')"`;

const HOSTILE = ['a&b', 'a|b', 'a^b', 'a%PATH%b', 'a!b', 'a"b', "a'b", 'a b', 'a;b', 'a$(x)', 'a`x`', 'a>b', 'a<b', 'a\tb', 'a,b', 'a(b)', 'a#b', 'ü한글'];

test('a hostile script name stays ONE argument: its own script runs, nothing it contains is executed', async () => {
  for (const [i, name] of HOSTILE.entries()) {
    const marker = `ran-${i}.txt`;
    const dir = project({ [name]: writer(marker) });
    const out = await run.start({ argv: ['npm', 'run', name], cwd: dir }).done;
    assert.strictEqual(out.state, 'ok', `${JSON.stringify(name)}: ${out.state} ${out.spawnError ?? ''} ${String(out.output).slice(0, 200)}`);
    assert.ok(fs.existsSync(path.join(dir, marker)), `${JSON.stringify(name)}: its own script did not run`);
  }
});

test('a name that carries a payload is only a name: it is looked up, not interpreted', async () => {
  const payloads = ['x&node -e "require(\'fs\').writeFileSync(\'INJECTED.txt\',\'1\')"', 'x|node -e "1"', 'x^&echo hi', 'x%COMSPEC%', 'x" & echo hi & "', 'x\nnode -e "1"'];
  for (const name of payloads) {
    const dir = project({ other: writer('other.txt') });                                // the payload name is NOT a script
    const out = await run.start({ argv: ['npm', 'run', name], cwd: dir }).done;
    assert.notStrictEqual(out.state, 'ok', `${JSON.stringify(name)} "ran" something`);
    assert.ok(!fs.existsSync(path.join(dir, 'INJECTED.txt')), `${JSON.stringify(name)} executed its payload`);
    assert.ok(!fs.existsSync(path.join(dir, 'other.txt')), `${JSON.stringify(name)} ran a different script`);
  }
  // …and when such a name IS a script, only its body runs
  const name = 'x&node -e "require(\'fs\').writeFileSync(\'INJECTED.txt\',\'1\')"';
  const dir = project({ [name]: writer('body-ran.txt') });
  const out = await run.start({ argv: ['npm', 'run', name], cwd: dir }).done;
  assert.strictEqual(out.state, 'ok', `${out.spawnError ?? ''} ${String(out.output).slice(0, 200)}`);
  assert.ok(fs.existsSync(path.join(dir, 'body-ran.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'INJECTED.txt')), 'the part of the name after & ran as a command');
});

test('pre/post scripts, cwd, output and the exit code survive the launcher', async () => {
  const log = 'order.txt';
  const step = (tag) => `node -e "const fs=require('fs');fs.appendFileSync('${log}','${tag}@'+(process.cwd()===require('fs').realpathSync('.')?'cwd-ok':'cwd-bad')+'\\n');console.log('say-${tag}')"`;
  const dir = project({ prebuild: step('pre'), build: step('main'), postbuild: step('post'), fails: 'node -e "console.error(\'boom-err\');process.exit(3)"' });
  const ok = await run.start({ argv: ['npm', 'run', 'build'], cwd: dir }).done;
  assert.strictEqual(ok.state, 'ok');
  assert.deepStrictEqual(fs.readFileSync(path.join(dir, log), 'utf8').trim().split(/\r?\n/), ['pre@cwd-ok', 'main@cwd-ok', 'post@cwd-ok'], 'pre/main/post did not run in order in the project');
  assert.ok(/say-pre/.test(ok.output) && /say-main/.test(ok.output) && /say-post/.test(ok.output), 'script output was lost');
  const bad = await run.start({ argv: ['npm', 'run', 'fails'], cwd: dir }).done;
  assert.strictEqual(bad.state, 'failed');
  assert.strictEqual(bad.code, 3, 'the script\'s own exit code must be reported as the code (npm passes it through)');
  assert.ok(/boom-err/.test(bad.output), 'stderr was hidden');
});

test('a refused launch is a failed run that never started, with the reason spelled out', async () => {
  const dir = project({ build: writer('x.txt') });
  const out = await run.start({ argv: ['npm', 'run', '--prefix=/etc'], cwd: dir }).done;
  assert.strictEqual(out.state, 'failed');
  assert.match(out.spawnError, /^unsafe-script-name/);
  assert.ok(!fs.existsSync(path.join(dir, 'x.txt')));
});

test('Windows: a pnpm/yarn project with no verifiable native launcher is refused, not run with npm', { skip: !WIN && 'Windows-only resolution' }, async () => {
  const dir = project({ build: writer('should-not-exist.txt') });
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  const out = await run.start({ argv: ['yarn', 'run', 'build'], cwd: dir }).done;
  // yarn may legitimately be installed as a native exe on a developer machine; only a refusal is asserted when it is not
  if (out.state === 'failed' && /unverified-launcher/.test(out.spawnError ?? '')) {
    assert.ok(!fs.existsSync(path.join(dir, 'should-not-exist.txt')), 'a refused yarn run still ran the script (via npm?)');
  }
});
