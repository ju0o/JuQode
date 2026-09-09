'use strict';
/* WBS-09 · Claude Code detection & unavailability.
 *
 * `21` WBS-09: "no credential handling; reasons verbatim from CLI".
 *
 * `claude auth status --json` prints an object that also carries the account email, org id,
 * org name and plan. **Only `loggedIn` is read.** Nothing else from that command is returned,
 * logged or persisted — not even inside a `detail` field, and not on the non-zero-exit path.
 * An earlier revision of this file put `a.stdout` into `detail` when the command exited
 * non-zero, which is the normal shape for a logged-out CLI: that shipped the whole identity
 * object across IPC and into the DOM, while the comment here claimed it could not happen.
 * The rule is now structural rather than careful: the auth call's output never leaves this
 * function. Only `claude --version` may contribute `detail`, and it prints a version string.
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/* Tunable so a test can exercise the timeout paths without a 16-second suite. Production
 * never sets it; the default is the value the product actually ships with. */
const TIMEOUT_MS = Number(process.env.JUQODE_CLAUDE_TIMEOUT_MS) || 8000;
/* Hard ceiling for the whole probe. `execFile`'s timeout sends ONE SIGTERM; a child that
 * ignores it keeps the promise pending forever — and "응답 없음" is precisely the case that
 * must still be reportable. Measured: a `trap "" TERM` child never settled without this. */
const DEADLINE_MS = TIMEOUT_MS * 2 + Math.max(500, TIMEOUT_MS / 4);

/**
 * Where the CLI actually is. On Windows `CreateProcess` resolves PATH but appends only `.exe`,
 * while an npm-global Claude Code installs `claude.cmd` — so a plain spawn returns ENOENT and
 * an installed CLI would be reported as 설치되지 않음. PATHEXT is walked explicitly instead.
 * NOT VALIDATED on Windows (this run has no Windows host) — see DEFERRED_VALIDATION DV-9.
 */
function resolveBin() {
  const override = process.env.JUQODE_CLAUDE_BIN;
  if (override) return override;
  if (process.platform !== 'win32') return 'claude';

  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of ['.EXE', ...exts, '']) {
      const cand = path.join(dir, `claude${ext}`);
      try { fs.accessSync(cand, fs.constants.R_OK); return cand; } catch { /* next */ }
    }
  }
  return 'claude';   // let the spawn produce the honest ENOENT
}

function run(args) {
  return new Promise((resolve) => {
    /* Nested invocation: Claude Code refuses to run inside its own session unless these are
     * cleared. Harmless when they are absent. */
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const bin = resolveBin();
    /* Since Node's CVE-2024-27980 mitigation a `.cmd`/`.bat` cannot be spawned directly.
     * Our arguments are compile-time constants, so routing them through cmd.exe carries no
     * quoting hazard — there is no user input on this path at all. */
    const viaCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
    const file = viaCmd ? process.env.COMSPEC || 'cmd.exe' : bin;
    const argv = viaCmd ? ['/d', '/s', '/c', bin, ...args] : args;

    execFile(file, argv, {
      timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL',      // one SIGTERM is not a timeout if the child ignores it
      env,
      windowsHide: true,
    }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

/**
 * @returns {Promise<{available: boolean, version?: string|null,
 *   reason?: 'not-installed'|'no-response'|'logged-out'|'unreadable-auth'|'error', detail?: string}>}
 *   `detail` can only ever come from `claude --version`. It is shown behind a disclosure,
 *   never as the headline, and the renderer must map every `reason` explicitly — an unmapped
 *   reason must NOT fall through to another reason's sentence.
 */
async function detect() {
  return Promise.race([
    probe(),
    new Promise((r) => setTimeout(() => r({ available: false, reason: 'no-response' }), DEADLINE_MS)),
  ]);
}

async function probe() {
  const v = await run(['--version']);
  if (v.err) {
    if (v.err.code === 'ENOENT') return { available: false, reason: 'not-installed' };
    if (v.err.killed || v.err.signal) return { available: false, reason: 'no-response' };
    return { available: false, reason: 'error', detail: cap(v.stderr || v.err.message) };
  }
  const version = v.stdout.trim().split(/\s+/)[0] || null;

  const a = await run(['auth', 'status', '--json']);
  /* From here on, `a.stdout` / `a.stderr` are treated as radioactive: they may contain the
   * account identity. They are parsed for ONE boolean and never surface in a return value. */
  if (a.err && (a.err.killed || a.err.signal)) return { available: false, version, reason: 'no-response' };

  let parsed;
  try {
    parsed = JSON.parse(a.stdout);
  } catch {
    /* Includes the maxBuffer-overflow case, where stdout is a truncated fragment. Reporting
     * "logged out" from unparseable output would be a claim with no evidence behind it. */
    return { available: false, version, reason: 'unreadable-auth' };
  }
  if (typeof parsed?.loggedIn !== 'boolean') return { available: false, version, reason: 'unreadable-auth' };
  return parsed.loggedIn ? { available: true, version } : { available: false, version, reason: 'logged-out' };
}

const cap = (s) => String(s).trim().slice(0, 400);

module.exports = { detect, resolveBin };
