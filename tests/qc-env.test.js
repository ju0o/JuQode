'use strict';
/* ONE effective environment for a Quick Command: the PATH that picks node/npm (or pnpm/yarn/bun) is the
 * PATH the child runs with. `process.env` is only the default when no `env` is given.
 *
 * Resolution cases drive the Windows branch on any host (decision logic, not a Windows run); the
 * execution cases run the real run.start with a throwaway "install" placed first on the child's PATH
 * and a decoy install on process.env.PATH that must NEVER run. */
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
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* busy */ } } });

/** A directory that behaves like a Node install; the fake npm-cli records what it was started with. */
function install(tag, { copyNode = false } = {}) {
  const home = tmp(`juqode-env-${tag}-`);
  const node = path.join(home, 'node.exe');
  if (copyNode) fs.copyFileSync(process.execPath, node); else fs.symlinkSync(process.execPath, node);
  const root = path.join(home, 'node_modules', 'npm');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'npm', version: `0.0.${tag.length}` }));
  fs.writeFileSync(path.join(root, 'bin', 'npm-cli.js'), `require('fs').writeFileSync(${JSON.stringify(path.join(home, 'RAN.json'))}, JSON.stringify({ tag: ${JSON.stringify(tag)}, argv: process.argv.slice(2), execPath: process.execPath, path: process.env.PATH ?? process.env.Path, probe: process.env.JUQODE_PROBE ?? null }));\n`);
  fs.writeFileSync(path.join(home, 'npm.cmd'), '@echo off\r\n');
  return home;
}
const win = (env) => ({ platform: 'win32', delimiter: ':', env });

test('two different environments select two different node/npm; process.env is not consulted when env is given', () => {
  const a = install('a'); const b = install('bb'); const decoy = install('decoy');
  const saved = process.env.PATH;
  try {
    process.env.PATH = `${decoy}:${saved}`;                                        // would win if process.env leaked in
    const ra = resolveLaunch(['npm', 'run', 'x'], win({ PATH: a }));
    const rb = resolveLaunch(['npm', 'run', 'x'], win({ PATH: b }));
    assert.strictEqual(ra.ok && rb.ok, true, JSON.stringify([ra, rb]));
    assert.ok(ra.argv[1].startsWith(fs.realpathSync(a)), ra.argv[1]);
    assert.ok(rb.argv[1].startsWith(fs.realpathSync(b)), rb.argv[1]);
    assert.notStrictEqual(ra.argv[1], rb.argv[1]);
    assert.ok(!ra.argv.concat(rb.argv).some((p) => p.includes('decoy')), 'process.env.PATH leaked into a lookup that was given its own env');
    assert.strictEqual(ra.identity.npm.version, '0.0.1');
    assert.strictEqual(rb.identity.npm.version, '0.0.2');
  } finally { process.env.PATH = saved; }
});

test('the Windows spelling `Path` is the same variable; a relative / empty PATH entry resolves nothing', () => {
  const a = install('a');
  const viaPath = resolveLaunch(['npm', 'run', 'x'], win({ Path: a }));
  assert.strictEqual(viaPath.ok, true, JSON.stringify(viaPath));
  assert.deepStrictEqual(resolveLaunch(['npm', 'run', 'x'], win({ PATH: '' })).reason, 'node-not-found');
  assert.deepStrictEqual(resolveLaunch(['npm', 'run', 'x'], win({})).reason, 'node-not-found');
  // a PATH that only names a shadow directory without node.exe cannot borrow the real one from process.env
  assert.deepStrictEqual(resolveLaunch(['npm', 'run', 'x'], win({ PATH: tmp('juqode-env-empty-') })).reason, 'node-not-found');
});

test('pnpm/yarn/bun are looked up in the SAME environment and a shim there is still refused (never npm)', () => {
  const a = install('a');
  fs.writeFileSync(path.join(a, 'pnpm.cmd'), '@echo off\r\n');
  const withShim = resolveLaunch(['pnpm', 'run', 'x'], win({ PATH: a }));
  assert.deepStrictEqual([withShim.ok, withShim.reason], [false, 'unverified-launcher']);
  const other = tmp('juqode-env-other-'); fs.writeFileSync(path.join(other, 'pnpm.exe'), 'MZ');
  const native = resolveLaunch(['pnpm', 'run', 'x'], win({ PATH: other }));
  assert.strictEqual(native.ok, true);
  assert.ok(native.argv[0].startsWith(fs.realpathSync(other)), 'pnpm.exe was taken from another environment');
});

test('real run: the child runs with the SAME PATH that chose the launcher, and the exact argv reaches npm', async () => {
  const project = tmp('juqode-env-proj-');
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'p', scripts: { 'a b&c': 'node -e 0' } }));
  const decoy = install('decoy', { copyNode: WIN });
  const shadow = install('shadow', { copyNode: WIN });
  const name = 'a b&c';
  const saved = process.env.PATH;
  try {
    process.env.PATH = `${decoy}${path.delimiter}${saved}`;                          // the app's own PATH has a decoy first
    let env;
    if (WIN) {
      env = { ...process.env, PATH: `${shadow}${path.delimiter}${saved}`, JUQODE_PROBE: 'effective' };
    } else {
      // POSIX has no launcher rewrite: the shadow dir carries an `npm` that records itself
      const npm = path.join(shadow, 'npm');
      fs.writeFileSync(npm, `#!/bin/sh\nnode -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ tag: 'shadow', argv: process.argv.slice(2), path: process.env.PATH, probe: process.env.JUQODE_PROBE }))" ${JSON.stringify(path.join(shadow, 'RAN.json'))} "$@"\n`, { mode: 0o755 });
      env = { ...process.env, PATH: `${shadow}${path.delimiter}${saved}`, JUQODE_PROBE: 'effective' };
    }
    const out = await run.start({ argv: ['npm', 'run', name], cwd: project, env }).done;
    assert.strictEqual(out.state, 'ok', `${out.spawnError ?? ''} ${String(out.output).slice(0, 300)}`);
    const ran = JSON.parse(fs.readFileSync(path.join(shadow, 'RAN.json'), 'utf8'));
    assert.strictEqual(ran.tag, 'shadow');
    assert.deepStrictEqual(ran.argv, ['run', name], 'npm did not receive the exact argv (the name as ONE argument)');
    assert.strictEqual(ran.probe, 'effective', 'the child did not run with the env that was given');
    assert.ok(String(ran.path).startsWith(shadow), 'the child PATH is not the one that chose the launcher');
    if (WIN) assert.strictEqual(fs.realpathSync(ran.execPath).toLowerCase(), fs.realpathSync(path.join(shadow, 'node.exe')).toLowerCase(), 'npm ran under a different node than the one the env selected');
    assert.ok(!fs.existsSync(path.join(decoy, 'RAN.json')), 'the decoy install on process.env.PATH ran');
  } finally { process.env.PATH = saved; }
});

test('prepare steps and the main argv share one environment', async () => {
  const project = tmp('juqode-env-prep-');
  const marker = path.join(project, 'prep.txt');
  const out = await run.start({
    argv: [process.execPath, '-e', 'process.exit(0)'], cwd: project,
    prepare: [[process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, process.env.JUQODE_PROBE ?? 'missing')`]],
    env: { ...process.env, JUQODE_PROBE: 'same-env' },
  }).done;
  assert.strictEqual(out.state, 'ok');
  assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'same-env');
});

test('shell-injection canaries survive an env-selected launcher: metacharacters stay argument text', async () => {
  const project = tmp('juqode-env-inj-');
  const names = ['a&b', 'a|b', 'a^b', 'a%PATH%b', 'a!b', 'a"b', 'a b', 'a;b'];
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'p', scripts: Object.fromEntries(names.map((n, i) => [n, `node -e "require('fs').writeFileSync('ok-${i}.txt','1')"`])) }));
  for (const [i, name] of names.entries()) {
    const out = await run.start({ argv: ['npm', 'run', name], cwd: project, env: { ...process.env } }).done;
    assert.strictEqual(out.state, 'ok', `${JSON.stringify(name)}: ${out.spawnError ?? ''} ${String(out.output).slice(0, 200)}`);
    assert.ok(fs.existsSync(path.join(project, `ok-${i}.txt`)), `${JSON.stringify(name)} did not run its own script`);
  }
  assert.deepStrictEqual(fs.readdirSync(project).filter((f) => !/^ok-\d+\.txt$|^package\.json$/.test(f)), [], 'something else was created');
});

test('every launch resolution in qc/run.js receives the env the child will run with (POSIX cannot observe the difference, so it is pinned in the source)', () => {
  const src = fs.readFileSync(path.join(R, 'app/main/qc/run.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const calls = src.match(/resolveLaunch\([^)]*\)/g) ?? [];
  assert.ok(calls.length >= 2, `expected the prepare and main resolution, found ${calls.length}`);
  for (const c of calls) assert.match(c, /\{\s*env\s*\}/, `${c} resolves with a different environment than it spawns with`);
});
