'use strict';
/* How a Quick Command's argv becomes a process on THIS host (WBS-23, `19` §C4: no shell).
 *
 * POSIX: the argv is spawned as given -- `npm` is an executable file there.
 *
 * Windows: `npm`, `pnpm` and `yarn` are `.cmd` shims, and Node refuses to spawn a `.cmd` without a
 * shell (CVE-2024-27980); `spawn('npm')` is ENOENT (measured on H1). Going through `cmd.exe /c`
 * would put an interpreter back between the rule and the OS. So instead the program that really
 * runs is resolved to ABSOLUTE paths and spawned with `shell:false`:
 *
 *     <node.exe> <npm-cli.js> run <script>
 *
 *   - node.exe is found on PATH and PROVED to be Node (`process.release.name === 'node'`, no
 *     `versions.electron`). `process.execPath` is NOT assumed to be Node: in the packaged app it is
 *     the Electron binary.
 *   - npm-cli.js is where npm's own shim looks for it: `<dir of the first npm.cmd on PATH>\node_modules\npm`
 *     then `<dir of the node.exe found on PATH>\node_modules\npm` (the PATH entry, as the shim sees it -- not the realpath). Its `package.json` must say `name: "npm"`, and the
 *     version is recorded.
 *   - the script name stays ONE argv element. It is never joined into a string, so `& | ^ % ! "` and
 *     spaces are characters, not syntax. A name that npm would read as an option (leading `-`) or
 *     that cannot be an argument at all (NUL) is refused.
 *   - pnpm, yarn and bun are accepted only as a native `<name>.exe` on PATH. A shim or script is not
 *     a launcher we can verify, so it is REFUSED -- never replaced by npm.
 * Anything unverifiable is a typed refusal, not a guess. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NODE_PROBE = "JSON.stringify([process.release.name, process.version, Boolean(process.versions.electron)])";

const fileOk = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/* The PATH of THIS environment object. A plain copy of process.env on Windows loses the case-
 * insensitivity of the real thing, where the variable is usually spelled `Path`. */
function pathDirs(env, delimiter) {
  const key = Object.keys(env).find((k) => k === 'PATH') ?? Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return String(key ? env[key] : '').split(delimiter).filter(Boolean);
}

/** First `<name><ext>` on PATH that is a file. Windows resolves extensions in PATHEXT order. */
function findOnPath(names, { env, delimiter, exts }) {
  for (const dir of pathDirs(env, delimiter)) {
    for (const name of names) {
      for (const ext of exts) {
        const candidate = path.join(dir, `${name}${ext}`);
        if (fileOk(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** Run the candidate and ask it what it is. Electron-as-node answers `electron: true` or not at all. */
function probeNode(file, env) {
  const clean = { ...env };
  delete clean.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(file, ['-p', NODE_PROBE], { encoding: 'utf8', timeout: 8000, windowsHide: true, env: clean });
  if (r.error || r.status !== 0) return null;
  try {
    const [name, version, electron] = JSON.parse(String(r.stdout).trim());
    return name === 'node' && electron === false ? { version } : null;
  } catch { return null; }
}

function readNpmIdentity(root) {
  const cli = path.join(root, 'bin', 'npm-cli.js');
  if (!fileOk(cli)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return pkg.name === 'npm' && typeof pkg.version === 'string' ? { cli: fs.realpathSync(cli), version: pkg.version } : null;
  } catch { return null; }
}

const refuse = (reason, detail) => ({ ok: false, reason, detail });

/**
 * @param {string[]} argv the program and arguments from `availability()`
 * @param {object} [o]  injectable for tests: platform, env, delimiter, exts
 * @returns {{ok:true, argv:string[], identity:object|null} | {ok:false, reason:string, detail?:string}}
 */
function resolveLaunch(argv, { platform = process.platform, env = process.env,
  delimiter = platform === 'win32' ? ';' : path.delimiter,
  exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', '.com'] : [''] } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string')) return refuse('bad-argv');
  if (argv.some((a) => a.includes('\0'))) return refuse('unsafe-argument', 'NUL in an argument');
  /* `<pm> run <name>`: the name must never be read as an option, on any host. */
  if (argv[1] === 'run' && typeof argv[2] === 'string' && (argv[2] === '' || argv[2].startsWith('-'))) {
    return refuse('unsafe-script-name', argv[2]);
  }
  if (platform !== 'win32') return { ok: true, argv, identity: null };

  const program = argv[0];
  const rest = argv.slice(1);
  const base = program.toLowerCase();

  if (base === 'npm') {
    const nodeFile = findOnPath(['node'], { env, delimiter, exts: ['.exe'] });
    if (!nodeFile) return refuse('node-not-found', 'no node.exe on PATH');
    const node = probeNode(nodeFile, env);
    if (!node) return refuse('node-unverified', nodeFile);
    const nodeReal = fs.realpathSync(nodeFile);

    const shim = findOnPath(['npm'], { env, delimiter, exts: ['.cmd'] });
    const roots = [shim && path.join(path.dirname(shim), 'node_modules', 'npm'),
                   path.join(path.dirname(nodeFile), 'node_modules', 'npm')].filter(Boolean);
    for (const root of roots) {
      const npm = readNpmIdentity(root);
      if (npm) {
        return { ok: true, argv: [nodeReal, npm.cli, ...rest],
                 identity: { node: { path: nodeReal, version: node.version }, npm: { cli: npm.cli, version: npm.version } } };
      }
    }
    return refuse('npm-cli-not-found', roots.join(' | '));
  }

  if (base === 'pnpm' || base === 'yarn' || base === 'bun') {
    const exe = findOnPath([base], { env, delimiter, exts: ['.exe'] });
    if (!exe) return refuse('unverified-launcher', `${base}: only a native ${base}.exe is accepted on Windows`);
    return { ok: true, argv: [fs.realpathSync(exe), ...rest], identity: { native: fs.realpathSync(exe) } };
  }

  /* git and any other fixed vector: a real executable, resolved by the OS as before. */
  return { ok: true, argv, identity: null };
}

module.exports = { resolveLaunch };
