'use strict';
/* WBS-10 · one Work = one headless Claude Code session (`19` §C3-L, D-105).
 *
 * `claude -p --output-format stream-json --verbose --session-id <uuid>` in the project folder.
 * Every line the CLI emits is persisted as a raw signal before anything interprets it — that is
 * what `기술 출력 보기` shows, and it is why a stream we do not understand still leaves a record.
 *
 * Measured facts this file is built on (`07` §8, `../evidence/planning/q04b-*`):
 *   - The child is spawned DETACHED, into its own process group. Killing a group that contains
 *     JuQode kills JuQode (measured: the driver exited 143).
 *   - A run whose tool was denied still exits 0 and reports `is_error: false`. A denial is
 *     detected from the `permission_denied` EVENT, never from the exit code.
 *   - Headless mode never pauses to ask. It denies and the turn ends (D-133). The retry path is
 *     `--resume <id> --allowedTools "<tool>(<that input only>)"`, and the scope matters: a bare
 *     `--allowedTools Edit` was measured changing a second, unapproved file.
 */
const { spawn, spawnSync } = require('node:child_process');
const { preflightLaunch, createIdentityCache, EXECUTION_MODES, normaliseMode } = require('../provider/claude-contract');

/* sha256 per file fingerprint; the version is taken from the process's own `init` event (a `--version` spawn per launch would also pollute fixtures and cost time) */
const identityCache = createIdentityCache();
const envMode = () => process.env.JUQODE_EXECUTION_MODE ?? EXECUTION_MODES.DEV_COMPAT;
const path = require('node:path');
const fs = require('node:fs');
const { resolveBin, launchArgv } = require('../claude-detect');
const { toSignal } = require('../work/reducer');

/** A Work that never produced a first event is not a Work — `20`: no row, no History entry. */
const START_WINDOW_MS = 30_000;

/* `detached` puts the child in its own PROCESS GROUP, which is what keeps a group signal from
 * reaching JuQode — a POSIX concern. On Windows it only means DETACHED_PROCESS (no console), and
 * MEASURED on H1 (Windows 11 26200, Node 24): a `cmd.exe /c <npm shim>.cmd` child started that way
 * delivers NOTHING on stdout (0 bytes, exit 0), while node.exe and a native claude.exe are fine.
 * Every Work through an npm-installed `claude.cmd` would have looked like a session that never
 * said anything. Windows has no group to protect against, so it is simply not detached there. */
const WINDOWS = process.platform === 'win32';

/* Windows starts Claude's npm `.cmd` shim under cmd.exe. After a restart, the wrapper may be
 * gone while a descendant still owns the Project. This fixed, read-only PowerShell query runs
 * through the existing process capability owner; errors are uncertainty, never proof of death.
 */
function windowsRunnerTreeMayBeAlive(pid, spawnSyncImpl = spawnSync) {
  const script = `$ErrorActionPreference = 'Stop'; $root = ${Number(pid)}; try { $all = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId) } catch { [Console]::Error.WriteLine('process-query-failed'); exit 3 }; $seen = [System.Collections.Generic.HashSet[int]]::new(); [void]$seen.Add($root); do { $changed = $false; foreach ($p in $all) { if ($seen.Contains([int]$p.ParentProcessId) -and $seen.Add([int]$p.ProcessId)) { $changed = $true } } } while ($changed); if ($seen.Count -gt 1) { 'alive' } else { 'gone' }`;
  try {
    const result = spawnSyncImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) return true;
    return String(result.stdout ?? '').trim() !== 'gone';
  } catch {
    return true;
  }
}

/* Canonical form of a directory, or null. A path that cannot be resolved is NOT validated —
 * there is deliberately no fallback to path.resolve, which attests nothing. */
function canonicalDir(p) {
  if (typeof p !== 'string' || !p) return null;
  try {
    const real = fs.realpathSync.native(p);
    return fs.statSync(real).isDirectory() ? real : null;
  } catch { return null; }
}

function sameDir(a, b) {
  const ca = canonicalDir(a), cb = canonicalDir(b);
  return ca !== null && ca === cb;
}

/* THE BINARY. `claude` on PATH is a name, not an identity: resolving it again at resume time can
 * land on a different file (a shadowing directory earlier on PATH, a replaced install). So the
 * resolved absolute path and the file's identity are recorded when the Work starts, the child is
 * always spawned from that absolute path, and resume runs only while the identity still matches.
 * POSIX: realpath + dev/ino/size/mtime/ctime (hashing a ~200 MB binary on every resume is not
 * worth it; a replaced file changes ino or ctime). Windows: the `.cmd` launcher and, when the npm
 * shim's package can be found next to it, the real target are identified SEPARATELY; a launcher
 * whose target cannot be found is bound on the launcher alone and says so (`targetResolved:false`).
 * NOT VALIDATED on Windows (DV-12). */
function fileIdentity(file) {
  try {
    const realPath = fs.realpathSync.native(file);
    const st = fs.statSync(realPath);
    if (!st.isFile()) return null;
    if (process.platform !== 'win32') fs.accessSync(realPath, fs.constants.X_OK);
    return { realPath, dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs };
  } catch { return null; }
}

function findOnPath(name) {
  const win = process.platform === 'win32';
  const exts = win ? ['.EXE', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean), ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const cand = path.join(dir, `${name}${ext}`);
      if (fileIdentity(cand)) return cand;
    }
  }
  return null;
}

function binaryIdentity(bin) {
  if (typeof bin !== 'string' || !bin) return null;
  const launchPath = /[\\/]/.test(bin) ? path.resolve(bin) : findOnPath(bin);
  const launcher = launchPath && fileIdentity(launchPath);
  if (!launcher) return null;
  const id = { launchPath, ...launcher, launcher: null, target: null, targetResolved: true };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(launchPath)) {
    const base = path.dirname(launchPath);
    const pkg = path.join(base, 'node_modules', '@anthropic-ai', 'claude-code');
    const target = ['bin/claude.exe', 'claude.exe', 'cli.js'].map((f) => fileIdentity(path.join(pkg, f))).find(Boolean);
    id.launcher = launcher; id.target = target ?? null; id.targetResolved = Boolean(target);
  }
  return id;
}

const sameIdentity = (a, b) => Boolean(a && b) && JSON.stringify(a) === JSON.stringify(b);

/* PRE-RESUME BINDING (fail closed). The init-cwd check below runs after the child has started,
 * so it is detection, not an atomic filesystem barrier. What can be enforced BEFORE spawning is
 * that the session is resumed only into the exact folder, session and binary it was started
 * with. Claude Code offers no provider-side sandbox for headless `--allowedTools`, so when this
 * binding cannot be verified the resume is refused rather than run unbounded.
 *
 * `reportedSessionId` is what the CLI's own init event said. A requested id the CLI never
 * confirmed (no init, a different id, a tampered one) is UNKNOWN and gets no binding. */
function bindSession({ cwd, sessionId, reportedSessionId, bin }) {
  const canonicalCwd = canonicalDir(cwd);
  const identity = binaryIdentity(bin);
  if (!canonicalCwd || !identity || !sessionId) return null;
  if (typeof reportedSessionId !== 'string' || reportedSessionId !== sessionId) return null;
  return Object.freeze({ sessionId, canonicalCwd, identity });
}

function verifyResume(binding, { cwd, sessionId, bin, projectPath }) {
  if (!binding) return { ok: false, reason: 'no-binding' };
  if (binding.sessionId !== sessionId) return { ok: false, reason: 'session-changed' };
  if (canonicalDir(cwd) !== binding.canonicalCwd) return { ok: false, reason: 'cwd-changed' };
  if (canonicalDir(projectPath) !== binding.canonicalCwd) return { ok: false, reason: 'project-moved' };
  if (bin !== binding.identity.launchPath) return { ok: false, reason: 'binary-changed' };
  /* A Windows npm shim whose package target could not be found is pinned by its launcher alone.
   * That is not an attestation of the executable that would act, so a scoped-write resume is
   * refused until the target is measurable (DV-12). */
  if (binding.identity.targetResolved === false) return { ok: false, reason: 'target-unresolved' };
  const now = binaryIdentity(bin);
  if (!now) return { ok: false, reason: 'binary-missing' };
  if (!sameIdentity(now, binding.identity)) return { ok: false, reason: 'binary-changed' };
  return { ok: true };
}

function baseArgs(sessionId) {
  return ['-p', '--output-format', 'stream-json', '--verbose', '--session-id', sessionId];
}

/**
 * `--allowedTools` scoped to ONE tool and ONE input. `Edit(/abs/path)` with a single leading
 * slash is read as a cwd-relative glob and silently denies, so an absolute path takes `//`.
 */
/* A grant is a sentence in `--allowedTools`' own grammar, and `tool_input` is chosen by the
 * MODEL — so a repository file can influence it. Two measured consequences:
 *   - `file_path: '<cwd>/*'` produced the grant `Edit(*)`, which is the bare-tool grant D-133
 *     bans outright, while the approval card would have shown a single path;
 *   - `file_path: '<cwd>/a),Bash(rm -rf ~'` produced `Edit(a),Bash(rm -rf ~)`, and the flag
 *     accepts comma-separated specs, so the second half became an independent grant.
 * Anything that could mean more than one thing is refused. Not granting is always safe. */
const UNSAFE_TARGET = /[(),*?[\]{}!\n\r\0]|^\s*$/;
/* A FILE spec is also refused when it would READ differently from the card: `~` (Claude expands it to the home folder, so `Edit(~/x)` is not the project file `~/x`),
 * a backslash (an escape in the rule grammar, a separator only on Windows - where the path is already normalised), invisible or control characters, edge whitespace. */
const UNSAFE_FILE_SPEC = /^~|\\|[\p{Cc}\p{Cf}]|^\s|\s$/u;

function allowSpec(denial, cwd) {
  const r = scopeOf(denial, cwd);
  return r.spec ?? null;
}

/** Where a file the model names REALLY is: symlinks resolved, and for a file that does not exist yet, the real path of its nearest
 * existing ancestor plus the remaining names. `null` = ambiguous (dangling link, a non-directory in the way, unreadable) and
 * ambiguity is a refusal, never a guess. */
function realTarget(abs) {
  const rest = [];
  let p = abs;
  for (;;) {
    let exists = true;
    try { fs.lstatSync(p); } catch (e) { if (e.code !== 'ENOENT') return null; exists = false; }
    if (exists) {
      /* it is there (file, directory or link). A DANGLING link is there too, and realpath refuses it: ambiguous, not "free". */
      try { return path.join(fs.realpathSync(p), ...rest); } catch { return null; }
    }
    const parent = path.dirname(p);
    if (parent === p) return null;
    rest.unshift(path.basename(p));
    p = parent;
  }
}

/**
 * What allowing a refused action would grant, or why nothing is offered.
 *
 * A file grant is only ever offered for a file INSIDE the project, checked on the real filesystem (V1-004 §7.7): a relative or
 * absolute path that leaves the project, a symlink that leads out, and anything ambiguous are refused here - before a grant is
 * recorded and before any process exists. `Bash` keeps its own contract (the command is the grant); this is not a path check.
 * @returns {{spec: string}|{refusal: 'outside-project'|'cannot-scope'}}
 */
function scopeOf(denial, cwd) {
  /* Claude Code's file permission rule is `Edit`, including calls emitted by its `Write` tool.
   * Use that rule name while keeping the grant scoped to the denied file. */
  const tool = denial?.tool === 'Write' ? 'Edit' : denial?.tool;
  if (!tool || !/^[A-Za-z][A-Za-z0-9_]*$/.test(tool)) return { refusal: 'cannot-scope' };
  const input = denial.input ?? {};
  /* `Bash(<path>)` is a COMMAND rule, never a file: a Bash denial is scoped by its command only. */
  const file = tool === 'Bash' ? null : (input.file_path ?? input.path ?? input.notebook_path ?? null);
  /* no project folder given = nothing to be "inside" of; `cwd ?? '/'` used to make the whole filesystem the project */
  if (typeof cwd !== 'string' || !cwd) return { refusal: 'cannot-scope' };

  if (typeof file === 'string' && file) {
    /* Resolve against the PROJECT, not against JuQode's own working directory — measured:
     * a relative `../../../etc/shadow` resolved into an unrelated tree, so the card and the
     * grant named different files. */
    const root = cwd;
    const abs = path.resolve(root, file);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const lexicallyInside = Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (!lexicallyInside) return { refusal: 'outside-project' };
    if (UNSAFE_TARGET.test(rel) || UNSAFE_FILE_SPEC.test(rel)) return { refusal: 'cannot-scope' };
    let realRoot; let real;
    try { realRoot = fs.realpathSync(root); } catch { return { refusal: 'cannot-scope' }; }
    real = realTarget(abs);
    if (real === null) return { refusal: 'cannot-scope' };
    const rr = path.relative(realRoot, real);
    if (!rr || rr.startsWith('..') || path.isAbsolute(rr)) return { refusal: 'outside-project' };
    return { spec: `${tool}(${rel})` };
  }

  if (typeof input.command === 'string' && input.command.trim()) {
    if (UNSAFE_TARGET.test(input.command)) return { refusal: 'cannot-scope' };
    return { spec: `${tool}(${input.command}:*)` };
  }
  return { refusal: 'cannot-scope' };      // nothing we can scope narrowly → do not widen it instead
}

/**
 * Run one turn. Resolves when the process exits.
 *
 * @param {object} o
 * @param {string} o.cwd project root
 * @param {string} o.sessionId uuid
 * @param {string} [o.prompt] the user's words (omitted on a resume)
 * @param {string[]} [o.allowedTools] narrowly-scoped grants for a retry
 * @param {boolean} [o.resume]
 * @param {(sig:object, raw:object, line:string)=>void} o.onSignal called for EVERY line
 * @param {(child:import('node:child_process').ChildProcess)=>void} [o.onChild] the live handle,
 *        so a caller can stop it. Cancellation cannot work without it.
 * @returns {Promise<{code:number|null, signal:string|null, sawEvent:boolean, stderr:string,
 *                    startFailed:boolean, unparsed:number}>}
 */
function run({ cwd, sessionId, prompt, allowedTools = [], tools = null, resume = false, onSignal, onChild, onLaunch, bin, timeoutMs = 0, mode, recorded = null }) {
  /* Everything knowable before the process exists is judged in ONE place (provider/claude-contract.js): the argv (unscoped grants, a bad id or a
   * permission-removing option are refused), the binary (absolute path, sha256 against the recorded identity), and -- in `v1-protected` mode -- the
   * attestation a privileged launch would need and this CLI cannot give. A run that restricts built-in tools always carries `--strict-mcp-config`
   * (H3 measured: `--tools ""` alone left 19 connector tools exposed). The prompt goes on stdin: `--allowedTools <tools...>` is variadic. */
  const exe = bin || resolveBin();
  const pf = preflightLaunch({ bin: exe, recorded, build: { sessionId, resume, allowedTools, tools }, mode: mode ?? envMode(), cache: identityCache });
  if (!pf.ok) return Promise.resolve({ code: null, signal: null, sawEvent: false, stderr: `preflight-refused:${pf.reason}`, startFailed: true, unparsed: 0, seq: 0, preflight: pf.reason });
  const { args, containment } = pf;

  const env = { ...process.env };
  /* Nested invocation: Claude Code refuses to run inside its own session unless these go. */
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return new Promise((resolve) => {
    let child;
    try {
      /* The SAME launch rule detection uses. On Windows `claude` is a `.cmd` (the npm shim)
       * and Node cannot spawn one directly since the CVE-2024-27980 mitigation — detection
       * wrapped it through cmd.exe and this did not, so on a real Windows machine the app
       * reported Claude Code as available and then failed to start every single Work. */
      /* no await between the preflight above and this spawn: the check and the exec are adjacent (a swap in between cannot be excluded by Node) */
      const launch = launchArgv(exe, args);
      child = spawn(launch.file, launch.argv,
                    { cwd, env, detached: !WINDOWS, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      /* The user's words, unmodified, and nothing else. A child that exits without reading
       * makes this EPIPE, which is its choice and not an error on our side. */
      child.stdin.on('error', () => {});
      child.stdin.end(prompt ?? '');
      onLaunch?.({ identity: pf.identity, identityVerified: pf.identityVerified, containment, safety: pf.safety, mode: pf.mode, privileged: pf.privileged });
      onChild?.(child);
    } catch (e) {
      return resolve({ code: null, signal: null, sawEvent: false, stderr: String(e?.message ?? e), startFailed: true, unparsed: 0, seq: 0 });
    }

    let seq = 0, unparsed = 0, sawEvent = false, stderr = '', buf = '';
    let killer = null, settled = false, mismatch = null, initVersion = null;

    /* A multi-byte character split across chunk boundaries becomes U+FFFD if each Buffer is
     * stringified on its own — measured on 7-byte chunks, Korean text came back as replacement
     * characters and `unparsed` stayed 0, because a corrupted string is still valid JSON. The
     * line persisted for 기술 출력 보기 would not have been what the CLI emitted. */
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const line = (text) => {
      if (!text.trim() || mismatch) return;     // after a mismatch nothing more is recorded or acted on
      let raw = null;
      try { raw = JSON.parse(text); } catch { unparsed += 1; }
      sawEvent = true;
      /* The line is handed over whether or not it parsed. An event shape we do not recognise
       * must still reach `기술 출력 보기`; only the interpretation is optional. The stream is
       * decoded as UTF-8 by the stream itself, so a character split across two chunks stays
       * one character — concatenating Buffers as strings turned Korean text into replacement
       * characters while `unparsed` stayed 0, because corrupted text is still valid JSON. */
      const sig = raw ? toSignal(raw) : { kind: 'raw', payload: { unparsed: true } };
      onSignal?.({ ...sig, seq: seq++ }, raw, text);
      /* DETECTION, not prevention: the child is already running and may have written before
       * this line. The init line is recorded as emitted, then the child is stopped. */
      if (raw?.type === 'system' && raw.subtype === 'init' && initVersion === null) initVersion = raw.claude_code_version ?? '';
      if (resume && raw?.type === 'system' && raw.subtype === 'init') {
        if (!sameDir(raw.cwd, cwd)) mismatch = { kind: 'cwd', expected: cwd, actual: raw.cwd ?? null };
        else if (raw.session_id !== sessionId) mismatch = { kind: 'session', expected: sessionId, actual: raw.session_id ?? null };
        if (mismatch) stop(child);
      }
    };

    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { stderr += String(e?.message ?? e); });

    if (timeoutMs > 0) killer = setTimeout(() => stop(child), timeoutMs);

    /* `close` waits for every inherited pipe to close, and `07` §8.7 measured the orphan class
     * that defeats it: a grandchild that leaves the process group with `setsid` holds stdout
     * open forever. The promise never settled, so the Work stayed `running` and the D-117 slot
     * was never released. `exit` fires on process death regardless of stdio; a short grace
     * gives `close` its chance to flush first, and whichever arrives first wins once. */
    const finish = (code, sig) => {
      if (settled) return;
      settled = true;
      if (killer) clearTimeout(killer);
      if (buf.trim()) line(buf);
      /* An orphan that left the process group still holds these pipes, and a held pipe keeps
       * the whole runtime alive. The answer is already recorded, so let them go. */
      for (const st of [child.stdout, child.stderr, child.stdin]) { try { st?.destroy(); } catch { /* gone */ } }
      resolve({
        code, signal: sig, sawEvent, stderr: stderr.slice(0, 4000), unparsed, seq,
        /* `19` §C3-L / `15` SC-02: a session that produced NO event before dying did not
         * start. It gets a card and no `work` row. Note the exit code is not consulted for
         * anything else — a denied run exits 0. */
        startFailed: !sawEvent, mismatch,
        /* what this launch may CLAIM; hooks and effective permissions are UNKNOWN before launch, `attested` is false */
        containment, identity: pf.identity, identityVerified: pf.identityVerified, safety: pf.safety, initVersion,
      });
    };

    child.on('close', finish);
    child.on('exit', (code, sig) => { setTimeout(() => finish(code, sig), 250).unref?.(); });
  });
}

/**
 * Which signal to send through the owned ChildProcess handle, as data for tests.
 *
 * A numeric process-group signal can outlive the original root and hit a recycled group ID.
 * Signal the ChildProcess handle we own. If its descendants survive root termination, liveness
 * reconciliation reports `ended_unknown` and blocks another Run until explicit acknowledgment.
 * The detached group remains useful for safe liveness observation without signaling JuQode.
 */
function killPlan(_platform, _pid, force) {
  return { kind: 'child', signal: force ? 'SIGKILL' : 'SIGTERM' };
}

function processGroupMayBeAlive(pid, kill = process.kill) {
  try { kill(-pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

function processTreeMayBeAlive(pid, { platform = process.platform, probe = windowsRunnerTreeMayBeAlive,
  groupProbe = processGroupMayBeAlive } = {}) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  if (platform === 'win32') return probe(pid);
  return groupProbe(pid);
}

/** Stop the owned ChildProcess and escalate if its root ignores SIGTERM.
 *
 * A root `exit` is not proof that every descendant exited: on POSIX a descendant can call
 * `setsid()`, and after the root exits its lineage is lost to the portable probes here. Therefore
 * this adapter never certifies `cancelled`; it marks the attempt ended_unknown and requires an
 * explicit user acknowledgement before another Task Run. Signal only through the owned handle,
 * never through a numeric PID or process-group id that may have been reused.
 */
function stop(child, { graceMs = 5000, confirmMs = 3000,
  onUnconfirmed = () => {}, platform = process.platform } = {}) {
  if (!child || !Number.isInteger(child.pid) || child.pid < 1 || typeof child.kill !== 'function') return false;
  let settled = false;
  let hard = null;
  const rootAlive = () => child.exitCode === null && child.signalCode === null;
  const finishUnknown = () => {
    if (settled) return;
    settled = true;
    if (hard) clearTimeout(hard);
    if (confirm) clearTimeout(confirm);
    onUnconfirmed();
  };
  const send = (force) => {
    /* Never signal after the ChildProcess reports root exit. child.kill() targets the direct
     * child handle rather than a reusable numeric process-group ID; a surviving descendant is
     * observed below and remains unknown/blocked instead of risking an unrelated process. */
    if (!rootAlive()) return;
    const plan = killPlan(platform, child.pid, force);
    try { child.kill(plan.signal); } catch { /* already gone */ }
  };
  let confirm = null;
  child.once('exit', finishUnknown);
  if (!rootAlive()) { finishUnknown(); return true; }
  send(false);
  hard = setTimeout(() => {
    /* Escalate only through the original ChildProcess handle while its root is still live. */
    if (!rootAlive()) { finishUnknown(); return; }
    send(true);
    confirm = setTimeout(finishUnknown, confirmMs);
  }, graceMs);
  return true;
}

/**
 * The signal JuQode writes when the USER allows. It is `source: 'juqode'` in `20` — the record
 * that a person approved, which is what makes D-116 ("JuQode 가 대신 승인하지 않는다")
 * queryable without parsing any payload.
 */
const grantedSignal = (denial, spec) => ({
  kind: 'permission_granted',
  payload: { tool: denial?.tool ?? null, toolUseId: denial?.toolUseId ?? null, scope: spec },
});

/** Dry run of the launch checks: no process, no side effect. Callers use it to refuse BEFORE they record anything. */
const preflightRun = ({ sessionId, resume = false, allowedTools = [], tools = null, bin, mode, recorded = null }) =>
  preflightLaunch({ bin: bin || resolveBin(), recorded, build: { sessionId, resume, allowedTools, tools }, mode: mode ?? envMode(), cache: identityCache });

/** Hash the binary off the hot path so the adjacent-sync check in run() is a cache hit. Best effort: a failure here only means run() hashes itself. */
const prewarmIdentity = (bin) => identityCache.prewarm(bin || resolveBin()).catch(() => ({ ok: false }));

/** The mode a launch with this `mode` argument really runs under (anything but exactly 'dev-compat' is protected). */
const effectiveMode = (mode) => normaliseMode(mode ?? envMode());

module.exports = { scopeOf, effectiveMode, prewarmIdentity, preflightRun, run, stop, sameDir, canonicalDir, binaryIdentity, bindSession, verifyResume, killPlan, allowSpec, grantedSignal, baseArgs, START_WINDOW_MS,
  windowsRunnerTreeMayBeAlive, processTreeMayBeAlive };
