'use strict';
/* WBS-23 · Quick Command execution & result · WBS-24 · long-running — `19` §C4's safety
 * contract (Q-03), D-106. The rules and the explanation those results belong to are WBS-22
 * (`rules.js`, `availability.js`).
 *
 * The contract, in the order it matters:
 *
 *   1. The command is an ARGV, and it comes from `availability()` — `<pm> run <script>` where
 *      the script name is from a closed list, or a fixed vector. Nothing the user typed reaches
 *      it. There is NO shell: `spawn` is called with a program and arguments, so `&&`, `|`,
 *      `$(…)` and a stray quote are argument text at worst and usually not even that.
 *   2. `cwd` is the project root and `env` is the user's own, unchanged. `19` §C4 and `07` §2:
 *      this is NOT isolation and the product says so rather than implying otherwise.
 *   3. The exit code and stderr are not hidden. `07` §8.1 measured a cancelled child exiting 0,
 *      so "it exited" is never read as "it worked" — the code is reported as the code.
 *   4. A process handle `{pid, startedAt}` is kept, because a long-running command has to be
 *      stoppable and a pid alone is reusable (`07` §8.5).
 *   5. The display layer masks token-shaped text before it reaches a card. It cannot promise
 *      that env VALUES never appear: with no shell wrapper JuQode does not control what a
 *      script prints, so masking is the only mechanism available and `19` §C4 is explicit that
 *      its effect is UNMEASURED. The product says so on screen, not only here — see `mask()`.
 */
const { spawn, spawnSync } = require('node:child_process');

/** `20` `quick_command_run.output_head`: the bounded head that goes on screen, in BYTES.
 *  (`output_ref` is the blob reference for the full output. Nothing writes one yet — see the
 *  note on `truncated` in `take()`: what is kept is a genuine PREFIX, and the rest is gone.) */
const OUTPUT_LIMIT = 64 * 1024;

/** `15` TD-01: the running card shows a live tail of the last three lines. */
const TAIL_LINES = 3;

/* Token-shaped text, masked in the DISPLAY layer only.
 *
 * `19` §C4 says this plainly and the product must repeat it: **the masking is not measured.**
 * It is a regular-expression draft whose false positives and false negatives were never
 * counted (q02 §5.6). It reduces what appears on screen; it is NOT a guarantee that nothing
 * leaks, and the original text is still in the user's own terminal and log. Anything that
 * treats this as a containment boundary is wrong. */
const TOKENISH = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}/g,
  /\bsk[-_](?:live|test)?[-_]?[A-Za-z0-9_-]{16,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@/g,          // scheme://user:password@host
  /* An ENV-VAR-SHAPED name and its value, on ONE line.
   *
   * MEASURED before this was narrowed: case-insensitive matching plus `\s*` after the separator
   * turned `SyntaxError: Unexpected token: '}' at line 12` into `Unexpected *** at line 12`,
   * and — because `\s*` crosses newlines — deleted the `src/app.ts:14:2` line that FOLLOWED an
   * `Unexpected token:`. `qc.build` and `qc.test` exist to show a user why something failed, and
   * this was removing the file and line from the failure.
   *
   * So: the NAME must look like an environment variable (upper-case, digits, underscores — it
   * is one), and the value must be on the same line. `password:` in an English sentence is not
   * an environment variable and is left alone. */
  /\b[A-Z0-9_]{0,32}(?:TOKEN|SECRET|PASSWORD|APIKEY|API_KEY|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]{0,32}[ \t]*[=:][ \t]*\S+/g,
];

/** Replace token-shaped runs. See TOKENISH: this is a reduction, never a guarantee. */
function mask(text) {
  let out = String(text ?? '');
  for (const re of TOKENISH) out = out.replace(re, '***');
  return out;
}

/** The last few lines, for the running card's live tail. */
const tail = (text, n = TAIL_LINES) => String(text ?? '').split('\n').filter(Boolean).slice(-n);

/**
 * Start one Quick Command.
 *
 * The caller has already resolved the rule and checked availability; this runs the argv it was
 * given and nothing else. It does not decide WHETHER to run — `19` §C4 requires an explanation
 * and a confirmation first, and that lives in the card.
 *
 * @param {object} spec
 * @param {string[]} spec.argv       program and arguments, from `availability()`
 * @param {string}   spec.cwd        the project root
 * @param {'oneshot'|'long_running'} spec.kind
 * @param {(update:object) => void} [spec.onUpdate]
 * @returns {{pid:number|null, startedAt:string, done:Promise<object>, stop:() => void}}
 */
function start({ argv, cwd, kind = 'oneshot', onUpdate = () => {}, env = process.env, prepare = [] }) {
  const startedAt = new Date().toISOString();
  let out = '';
  let bytes = 0;
  let truncated = false;

  /* `prepare` — argvs that must succeed BEFORE the one the card named.
   *
   * It exists for `qc.git.commit`, which cannot be one argv: there is no shell to chain
   * `add` to `commit`, and `commit -a` would miss every file the Work CREATED — which for a
   * non-developer's project is the ordinary case, not the corner one.
   *
   * Each is the same closed kind of vector as `argv` itself (from `availability()`, never from
   * anything typed), each is synchronous because they are index operations that finish in
   * milliseconds, and the FIRST failure stops the sequence with its own output attached. A
   * prepare step that failed quietly would leave a commit of the wrong thing. */
  for (const pre of prepare) {
    const r = spawnSync(pre[0], pre.slice(1), {
      cwd, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    });
    if (r.error || r.status !== 0) {
      const why = [r.stdout, r.stderr, r.error ? String(r.error.code ?? r.error.message) : '']
        .filter(Boolean).join('\n');
      const failed = { state: 'failed', code: r.status ?? null, signal: r.signal ?? null, startedAt,
                       /* Masked like every other output path. A `git` failure prints the
                        * remote URL, and a URL can carry credentials. */
                       endedAt: new Date().toISOString(), output: mask(why),
                       spawnError: r.error ? String(r.error.code ?? r.error.message) : null };
      onUpdate(failed);
      return { pid: null, startedAt, done: Promise.resolve(failed), stop: () => {} };
    }
    /* Its output is kept: `git init` says where it made the repository, and that is the one
     * line telling a user their folder is now a Git project. */
    if (r.stdout) out += r.stdout;
  }

  let child;
  try {
    /* No shell. `spawn(program, args)` with `shell: false` (the default) means the OS execs the
     * program directly — there is no interpreter to interpret anything. */
    child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,                        // the user's environment, unchanged (`19` §C4)
      stdio: ['ignore', 'pipe', 'pipe'],
      /* Its own process group, so stopping it cannot reach JuQode (`07` §8.2). */
      detached: true,
    });
  } catch (e) {
    const failed = { state: 'failed', code: null, signal: null, startedAt,
                     endedAt: new Date().toISOString(), output: '', spawnError: String(e?.code ?? e?.message ?? e) };
    onUpdate(failed);
    return { pid: null, startedAt, done: Promise.resolve(failed), stop: () => {} };
  }

  const take = (chunk) => {
    /* Bounded, and the BOUND IS SAID.
     *
     * MEASURED before this: an oversized chunk was skipped and LATER, smaller chunks were still
     * appended — so the middle of the log vanished and the two ends were spliced together with
     * nothing to say so. A build that printed 60 KB of warnings, then a 20 KB error block, then
     * `Build failed with 1 error` showed the warnings and the final line, reading as a complete
     * log with exactly the error missing.
     *
     * Once the head is full it is FULL: the cut sets `bytes` to the limit, so every later chunk
     * takes the branch below and appends nothing. What is on screen is a genuine PREFIX of what
     * the command printed, and `truncated` says there is more. */
    const s = String(chunk);
    const size = Buffer.byteLength(s, 'utf8');
    if (bytes + size > OUTPUT_LIMIT) {
      /* Keep the part that fits, so the cut lands mid-stream rather than discarding a whole
       * chunk that might be the only interesting one. */
      const room = OUTPUT_LIMIT - bytes;
      if (room > 0) {
        out += Buffer.from(s, 'utf8').subarray(0, room).toString('utf8').replace(/\uFFFD$/, '');
        bytes = OUTPUT_LIMIT;
      }
      truncated = true;
      onUpdate({ state: 'running', pid: child.pid, startedAt, tail: tail(mask(out)), truncated });
      return;
    }
    bytes += size;
    out += s;
    onUpdate({ state: 'running', pid: child.pid, startedAt, tail: tail(mask(out)) });
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  /* stderr is NOT hidden and NOT separated: `19` §C4 says the product does not hide it, and a
   * build's errors interleaved with its output are how the user reads what happened. */
  child.stdout.on('data', take);
  child.stderr.on('data', take);

  onUpdate({ state: 'running', pid: child.pid, startedAt, tail: [] });

  const done = new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      onUpdate(result);
      resolve(result);
    };
    child.on('error', (e) => settle({
      state: 'failed', code: null, signal: null, pid: child.pid, startedAt,
      endedAt: new Date().toISOString(), output: mask(out), truncated,
      spawnError: String(e?.code ?? e?.message ?? e),
    }));
    /* `exit` carries the code; `close` says the pipes are drained. Settling on `exit` alone
     * LOSES OUTPUT — measured: `pwd` and `echo "$VAR"` both returned an empty string, because a
     * fast child exits before its final `data` events are delivered. The card would then show a
     * command that ran and printed nothing.
     *
     * A grandchild holding stdout open can delay `close` indefinitely (a dev server started by
     * a package manager is exactly that), so the drain is bounded: the code is already known,
     * and after the grace whatever arrived is what there is. */
    let ended = null;
    const finish = () => {
      if (!ended) return;
      const { code, signal } = ended;
      /* `07` §8.1: a child that was cancelled can still exit 0, so "ended" is never read as
       * "worked". The three outcomes are named from the code AND the signal together. */
      settle({
        state: signal != null ? 'stopped' : (code === 0 ? 'ok' : 'failed'),
        code, signal, pid: child.pid, startedAt,
        endedAt: new Date().toISOString(),
        output: mask(out), truncated, kind,
      });
    };
    child.on('exit', (code, signal) => {
      ended = { code, signal };
      const grace = setTimeout(finish, DRAIN_MS);
      grace.unref?.();
    });
    child.on('close', finish);
  });

  return {
    pid: child.pid ?? null,
    startedAt,
    done,
    /* `19` §C4: SIGTERM, then SIGKILL after five seconds. The whole GROUP, because a package
     * manager runs the real process as a child of itself and signalling only the parent leaves
     * the server running (`07` §8.2). */
    stop: () => stopGroup(child),
  };
}

const STOP_GRACE_MS = 5000;

/** How long to wait after `exit` for the pipes to drain before reporting what arrived. */
const DRAIN_MS = 250;

function stopGroup(child) {
  const pid = child?.pid;
  if (!pid) return;
  /* `07` §8.5: a pid is REUSABLE. Both signals are guarded, not only the SIGKILL — the SIGTERM
   * used to fire unconditionally, and pressing 멈추기 in the window between a child's exit and
   * its handle being dropped signalled a process group id that no longer belonged to us. */
  const gone = () => child.exitCode !== null || child.signalCode !== null;
  if (gone()) return;
  const signal = (sig) => {
    if (gone()) return;
    try { process.kill(-pid, sig); }              // the group
    catch { try { child.kill(sig); } catch { /* already gone */ } }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => {
    /* Still there after the grace period. `07` §8.5: a pid is reusable, so this only fires
     * while the handle we started is still the process we are holding. */
    signal('SIGKILL');
  }, STOP_GRACE_MS);
  /* Never hold the app open just to wait for a kill that may not be needed. */
  timer.unref?.();
  child.once('exit', () => clearTimeout(timer));
}

/* `stopGroup` is exported for `../term/session.js`: the terminal line's 멈추기 is the SAME
 * contract (SIGTERM → 5 s → SIGKILL, guarded against a reused pid), and a second copy of it
 * would be a second thing to get wrong. */
module.exports = { start, mask, tail, stopGroup, OUTPUT_LIMIT, TAIL_LINES, STOP_GRACE_MS, DRAIN_MS, TOKENISH };
