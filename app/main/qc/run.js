'use strict';
/* WBS-22 · Quick Command execution — `19` §C4's safety contract (Q-03), D-106.
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
 *   5. env VALUES are never printed. The display layer masks token-shaped text, and `19` §C4 is
 *      explicit that the masking is UNMEASURED — see `mask()`.
 */
const { spawn } = require('node:child_process');

/** `20` `quick_command_run.output_ref`: the head that goes on screen, in BYTES. */
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
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|APIKEY|API_KEY|PRIVATE_KEY)[A-Za-z0-9_]*\s*[=:]\s*\S+/gi,
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
function start({ argv, cwd, kind = 'oneshot', onUpdate = () => {}, env = process.env }) {
  const startedAt = new Date().toISOString();
  let out = '';
  let bytes = 0;
  let truncated = false;

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
    /* Bounded, and the BOUND IS SAID. `20` keeps a head and the rest goes to the log — silently
     * dropping the tail would make "출력 보기" show a complete-looking output that is not. */
    const s = String(chunk);
    const size = Buffer.byteLength(s, 'utf8');
    if (bytes + size > OUTPUT_LIMIT) { truncated = true; return; }
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
  const signal = (sig) => {
    try { process.kill(-pid, sig); }              // the group
    catch { try { child.kill(sig); } catch { /* already gone */ } }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => {
    /* Still there after the grace period. `07` §8.5: a pid is reusable, so this only fires
     * while the handle we started is still the process we are holding. */
    if (child.exitCode === null && child.signalCode === null) signal('SIGKILL');
  }, STOP_GRACE_MS);
  /* Never hold the app open just to wait for a kill that may not be needed. */
  timer.unref?.();
  child.once('exit', () => clearTimeout(timer));
}

module.exports = { start, mask, tail, OUTPUT_LIMIT, TAIL_LINES, STOP_GRACE_MS, DRAIN_MS, TOKENISH };
