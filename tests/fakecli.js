'use strict';
/* A fake CLI that launches on EVERY host the product supports.
 *
 * POSIX:   <dir>/<name>                an executable `#!/bin/sh` that execs node on the script.
 * Windows: <dir>/w-<name>/<name>.cmd   the shape of a real npm shim — `@"node" "<target>" %*` — with the
 *          script installed as `node_modules/@anthropic-ai/claude-code/cli.js` next to it, so the
 *          product's launcher + target identity check (`binaryIdentity`) sees a fully resolvable
 *          shim instead of a bare launcher. `launchArgv` runs it through `cmd.exe /d /s /c`, the
 *          same contract the product ships.
 * The script is plain Node on both, so argv, cwd, session ids, stdin and exit codes are the real
 * thing. Nothing here reduces what a test asserts; what Windows cannot express (ignoring SIGTERM)
 * stays in POSIX-only tests with their own Windows expectation.
 */
const fs = require('node:fs');
const path = require('node:path');

const WIN = process.platform === 'win32';

/** Shared helpers every scripted fixture can use. */
const PRELUDE = `
const A = process.argv;
const SID = (() => { const i = Math.max(A.indexOf('--session-id'), A.indexOf('--resume')); return A[i + 1]; })();
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const init = (o = {}) => emit({ type: 'system', subtype: 'init', session_id: SID, cwd: process.cwd(), ...o });
const result = (o = {}) => emit({ type: 'result', subtype: 'success', is_error: false, permission_denials: [], ...o });
`;

/** Wrap an existing script file in a launcher; returns the path the product should be given. */
function launcher(dir, name, scriptPath) {
  fs.mkdirSync(dir, { recursive: true });
  if (!WIN) {
    const bin = path.join(dir, name);
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, { mode: 0o755 });
    return bin;
  }
  const home = path.join(dir, `w-${name}`);
  const pkg = path.join(home, 'node_modules', '@anthropic-ai', 'claude-code');
  fs.mkdirSync(pkg, { recursive: true });
  fs.copyFileSync(scriptPath, path.join(pkg, 'cli.js'));
  const bin = path.join(home, `${name}.cmd`);
  fs.writeFileSync(bin, `@echo off\r\n"${process.execPath}" "%~dp0node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n`);
  return bin;
}

/** Write JS `source` (with PRELUDE in scope) and return its launcher. */
function scriptBin(dir, name, source) {
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, `${name}.js`);
  fs.writeFileSync(script, `${PRELUDE}\n${source}\n`);
  return launcher(dir, name, script);
}

module.exports = { WIN, PRELUDE, launcher, scriptBin };
