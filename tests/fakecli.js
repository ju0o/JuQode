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

/* TEARDOWN BY OWNERSHIP. A test that cancels a Work leaves, by the product's own design, the
 * descendants of the fixture CLI alive (the end is `ended_unknown`, never "all gone"), and a live
 * child handle keeps the test process -- and the whole runner -- from exiting. Cleaning that up must
 * not become the thing the product refuses to do: signal a number that is no longer ours.
 *
 * Order of authority:
 *   1. a ChildProcess HANDLE this process holds -- `handle.kill()`, no pid involved;
 *   2. a process DISCOVERED by its command line naming a temp directory this test file created
 *      (discovery is not authorization). It is signalled only if, immediately before, its identity is
 *      read again and is unchanged: POSIX -- /proc start time + command line; Windows -- the
 *      process CreationDate + command line from CIM. A pid that exited, was recycled by another
 *      program, or no longer names our directory is skipped. Where identity cannot be read (no /proc,
 *      no CIM) nothing is signalled.
 * Single positive pids only: never a group, never this process or its parent, never a pattern kill. */
const { spawnSync } = require('node:child_process');

function procStartPosix(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;       // field 22 = starttime
  } catch { return null; }
}

/** `{ start, cmd }` as the OS reports it NOW, or null (gone / unreadable). */
function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 4) return null;
  if (!WIN) {
    const start = procStartPosix(pid);
    if (start === null) return null;
    try { return { start, cmd: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ') }; } catch { return null; }
  }
  const ps = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { $p.CreationDate.ToString('o') + '|' + $p.CommandLine }`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  const line = String(r.stdout || '').trim();
  const i = line.indexOf('|');
  return i < 0 ? null : { start: line.slice(0, i), cmd: line.slice(i + 1) };
}

/** Every process whose command line names one of `roots`: `[{ pid, start, cmd }]`. Discovery only. */
function discoverUnder(roots) {
  const out = [];
  if (!WIN) {
    let names = [];
    try { names = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch { return out; }
    for (const n of names) {
      const id = processIdentity(Number(n));
      if (id && roots.some((d) => id.cmd.includes(d))) out.push({ pid: Number(n), ...id });
    }
    return out;
  }
  const list = roots.map((r) => `'${r.replace(/'/g, "''")}'`).join(',');
  const ps = `$d=@(${list}); Get-CimInstance Win32_Process | Where-Object { $c=$_.CommandLine; $c -and ($d | Where-Object { $c.Contains($_) }) } | ForEach-Object { "$($_.ProcessId)|$($_.CreationDate.ToString('o'))|$($_.CommandLine)" }`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const m = /^(\d+)\|([^|]*)\|(.*)$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), start: m[2], cmd: m[3] });
  }
  return out;
}

/** Stop what this file's tests left running. Returns `{ handles: n, pids: [..] }` -- what it actually signalled. */
function reapProcessesUnder(dirs, { handles = [], kill = process.kill, discover = discoverUnder, identityOf = processIdentity } = {}) {
  const roots = [...new Set((dirs || []).filter((d) => typeof d === 'string' && d.length > 8))];
  const result = { handles: 0, pids: [] };
  for (const h of handles) {
    if (h && typeof h.kill === 'function' && h.exitCode === null && h.signalCode === null) {
      try { h.kill('SIGKILL'); result.handles += 1; } catch { /* gone */ }
    }
  }
  if (!roots.length) return result;
  const self = new Set([process.pid, process.ppid]);
  for (const found of discover(roots)) {
    if (self.has(found.pid) || !(found.pid > 4)) continue;
    const now = identityOf(found.pid);                                    // re-read at the moment of the signal
    if (!now || now.start !== found.start) continue;                       // exited, or the number belongs to someone else now
    if (!roots.some((d) => now.cmd.includes(d))) continue;                 // no longer a process of ours
    try { kill(found.pid, 'SIGKILL'); result.pids.push(found.pid); } catch { /* gone */ }
  }
  return result;
}

module.exports = { WIN, PRELUDE, launcher, scriptBin, reapProcessesUnder, processIdentity };
