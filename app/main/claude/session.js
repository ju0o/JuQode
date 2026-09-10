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
const path = require('node:path');
const { resolveBin, launchArgv } = require('../claude-detect');
const { toSignal } = require('../work/reducer');

/** A Work that never produced a first event is not a Work — `20`: no row, no History entry. */
const START_WINDOW_MS = 30_000;

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

function allowSpec(denial, cwd) {
  const tool = denial?.tool;
  if (!tool || !/^[A-Za-z][A-Za-z0-9_]*$/.test(tool)) return null;
  const input = denial.input ?? {};
  const file = input.file_path ?? input.path ?? input.notebook_path ?? null;

  if (typeof file === 'string' && file) {
    /* Resolve against the PROJECT, not against JuQode's own working directory — measured:
     * a relative `../../../etc/shadow` resolved into an unrelated tree, so the card and the
     * grant named different files. */
    const abs = path.resolve(cwd, file);
    const rel = path.relative(cwd, abs);
    const target = rel && !rel.startsWith('..') ? rel : `/${abs}`;
    if (UNSAFE_TARGET.test(target)) return null;
    return `${tool}(${target})`;
  }

  if (typeof input.command === 'string' && input.command.trim()) {
    if (UNSAFE_TARGET.test(input.command)) return null;
    return `${tool}(${input.command}:*)`;
  }
  return null;                       // nothing we can scope narrowly → do not widen it instead
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
function run({ cwd, sessionId, prompt, allowedTools = [], tools = null, resume = false, onSignal, onChild, bin, timeoutMs = 0 }) {
  const args = resume
    ? ['--resume', sessionId, '-p', '--output-format', 'stream-json', '--verbose']
    : baseArgs(sessionId);
  /* `--allowedTools <tools...>` is VARIADIC. A prompt passed as a positional argument after it
   * is swallowed as a second tool grant — measured: the retry never ran and the CLI reported a
   * missing deferred-tool marker. The prompt goes on stdin, which also handles a multi-line
   * request without any quoting question. */
  if (allowedTools.length) args.push('--allowedTools', ...allowedTools);

  /* `--tools` selects from the BUILT-IN set, and `--tools ""` disables all of them. It is not
   * the same knob as `--allowedTools`, which only pre-grants permission for tools the session
   * already has — passing an empty ALLOW list adds no flag at all and leaves the default set
   * intact, which is how a pass documented as "no tools" ran with all of them.
   *
   * MEASURED (Claude Code 2.1.266, disposable scratch dir, never a real project): asked to edit
   * a file with `--tools ""`, the CLI produced a text-only turn — "Read (No such file or
   * directory)" — `permission_denials: []`, one turn, and the target file was byte-identical
   * afterwards. That is the containment claim, and it is the only one made. */
  if (tools !== null) args.push('--tools', tools);

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
      const launch = launchArgv(bin || resolveBin(), args);
      child = spawn(launch.file, launch.argv,
                    { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      /* The user's words, unmodified, and nothing else. A child that exits without reading
       * makes this EPIPE, which is its choice and not an error on our side. */
      child.stdin.on('error', () => {});
      child.stdin.end(prompt ?? '');
      onChild?.(child);
    } catch (e) {
      return resolve({ code: null, signal: null, sawEvent: false, stderr: String(e?.message ?? e), startFailed: true, unparsed: 0, seq: 0 });
    }

    let seq = 0, unparsed = 0, sawEvent = false, stderr = '', buf = '';
    let killer = null, settled = false;

    /* A multi-byte character split across chunk boundaries becomes U+FFFD if each Buffer is
     * stringified on its own — measured on 7-byte chunks, Korean text came back as replacement
     * characters and `unparsed` stayed 0, because a corrupted string is still valid JSON. The
     * line persisted for 기술 출력 보기 would not have been what the CLI emitted. */
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const line = (text) => {
      if (!text.trim()) return;
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
        startFailed: !sawEvent,
      });
    };

    child.on('close', finish);
    child.on('exit', (code, sig) => { setTimeout(() => finish(code, sig), 250).unref?.(); });
  });
}

/**
 * How to stop the child's whole tree on a given platform, as data so both answers are testable
 * from either OS.
 *
 * POSIX: the child is `detached`, so it owns its process group and a negative pid reaches the
 * group without ever reaching JuQode. Windows has no process groups at all — `kill(-pid)`
 * throws there (WBS-00 spike C), and the pid we hold is the `cmd.exe` wrapper, so killing it
 * alone strands `claude.cmd` and the node process under it. `taskkill /T` is the documented
 * tree analogue. Without `/F` it only asks a window to close, which a console child ignores,
 * so on Windows the graceful tier is a courtesy and the escalation is the tier that lands.
 */
function killPlan(platform, pid, force) {
  return platform === 'win32'
    ? { kind: 'taskkill', argv: ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])] }
    : { kind: 'group', pid: -pid, signal: force ? 'SIGKILL' : 'SIGTERM' };
}

/** Graceful stop of the child's tree, escalating to a forced one after `graceMs`. */
function stop(child, { graceMs = 5000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const send = (force) => {
    const plan = killPlan(process.platform, child.pid, force);
    try {
      if (plan.kind === 'taskkill') spawnSync('taskkill', plan.argv, { stdio: 'ignore', windowsHide: true });
      else process.kill(plan.pid, plan.signal);
    } catch { /* already gone */ }
  };
  send(false);
  const hard = setTimeout(() => {
    /* Re-check before escalating: `07` §8.5 warns that a pid is reusable, and a forced kill of
     * a recycled group or tree would take an unrelated process with it. */
    if (child.exitCode !== null || child.signalCode !== null) return;
    send(true);
  }, graceMs);
  hard.unref?.();
  child.once('exit', () => clearTimeout(hard));
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

module.exports = { run, stop, killPlan, allowSpec, grantedSignal, baseArgs, START_WINDOW_MS };
