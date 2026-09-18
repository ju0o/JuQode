/* WBS-00 spike · DV-11 — what a TTY-less pipe shell actually does.
 *
 * `15` TD-01 asks for a shell command line the user types into. `19` §C6 REC-010 proposes one
 * pty per project and marks itself UNVALIDATED: **"Real T1 must validate: pty libraries per
 * runtime; Windows ConPTY"**. The decision between the three options is a product decision
 * (DEFERRED_VALIDATION DV-11), and this script exists to make it with numbers instead of
 * intuition. It measures option (b) — `spawn` a shell with PIPES and no pty — because that is
 * the only option that needs no native module, and therefore the only one that could ship on a
 * platform this run cannot validate.
 *
 * It does NOT decide anything. It reports what a user would experience.
 *
 * Everything runs in a disposable temp directory. Nothing here touches a real project, and no
 * command it runs writes outside that directory.
 *
 *   node scripts/spikes/pipe-shell.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-pipeshell-'));
fs.writeFileSync(path.join(DIR, 'a.txt'), 'one\ntwo\n');

const results = [];
const record = (name, question, observed, matters) =>
  results.push({ name, question, observed, matters });

/** Run one line through a fresh non-interactive pipe shell and collect everything. */
function run(line, { stdin = null, timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', line], {
      cwd: DIR,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    if (stdin != null) child.stdin.end(stdin);
    else child.stdin.end();
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ out: out.trim(), err: err.trim(), code, signal, timedOut });
    });
  });
}

const main = async () => {
  /* 1 · does the shell know it is not a terminal? Everything else follows from this. */
  const tty = await run('[ -t 1 ] && echo TTY || echo NOT_A_TTY');
  record('isatty', 'does stdout look like a terminal to the program?', tty.out,
    'every program that branches on isatty branches the other way — colour, progress, prompts');

  /* 2 · colour. Most tools disable it without a tty, which is the visible half of (1). */
  const colour = await run('ls --color=auto a.txt | cat -v');
  record('colour', 'does a colouring tool emit escapes?',
    /\^\[\[/.test(colour.out) ? 'escapes present' : 'no escapes — plain text',
    'the drawer would show plain output; that is a fidelity loss, not a failure');

  /* 3 · a program that asks a question. This is the one that decides the option. */
  const prompt = await run('printf "name? "; read x; echo "got:$x"', { stdin: 'juqode\n' });
  record('prompt-with-piped-stdin', 'can a program that reads stdin be answered?',
    `${prompt.out} (code ${prompt.code})`,
    'a Quick Command never needs this; a user typing `git commit` without -m does');

  /* 4 · …and the same program with NO stdin, which is the drawer with no input wired. */
  const prompt2 = await run('printf "name? "; read x; echo "got:[$x]"');
  record('prompt-with-empty-stdin', 'what does a question do when nobody can answer?',
    `${prompt2.out} (code ${prompt2.code}${prompt2.timedOut ? ', TIMED OUT' : ''})`,
    'a closed stdin is EOF, not a hang: the program gets an empty answer and carries on, which '
    + 'is a WRONG answer delivered silently rather than a stall the user can see');

  /* 5 · a full-screen program. `19` §C6's real reason for wanting a pty. */
  const fullscreen = await run('command -v top >/dev/null && top -b -n 1 >/dev/null 2>&1 && echo BATCH_OK || echo NO_BATCH_MODE');
  record('fullscreen-batch', 'can a curses program run at all?', fullscreen.out,
    'only in batch mode, and only if it HAS one — `vim`, `less`, `htop` have no equivalent');

  /* 6 · job control. Stated as what was actually measured: `set -m` being ACCEPTED is not the
   * same as usable job control, and reporting it as such would be the kind of claim this
   * product exists not to make. What decides it is whether the shell has a controlling
   * terminal, so that is what is asked. */
  const jobs = await run('set -m 2>/dev/null && echo MONITOR_ACCEPTED || echo MONITOR_REFUSED');
  const ctty = await run('ps -o tty= -p $$ 2>/dev/null | tr -d " " || echo unknown');
  record('job-control', 'is `set -m` accepted, and is there a controlling terminal?',
    `${jobs.out}; controlling tty = ${ctty.out || '(none reported)'}`,
    'without a controlling terminal `fg`/`bg` and Ctrl-C have nothing to act on — stopping a '
    + 'command means signalling the process group, which is what WBS-23 already does');

  /* 6b · a program that bypasses stdin and talks to the terminal directly. `sudo`, `ssh` and
   * `git` credential prompts all open /dev/tty rather than reading stdin, so a pipe on stdin
   * does not reach them. This is the sharpest question in the file: it is the difference
   * between "degraded" and "cannot be used for this at all".
   *
   * `setsid` drops the controlling terminal so the measurement is about the SHELL, not about
   * the terminal this script happens to be run from. */
  const devtty = await run(
    'command -v setsid >/dev/null && setsid /bin/sh -c \'printf pw: > /dev/tty 2>/dev/null && echo TTY_REACHABLE || echo NO_DEV_TTY\' </dev/null || echo NO_SETSID');
  record('dev-tty', 'can a program reach the terminal directly (sudo/ssh/git credentials)?',
    devtty.out,
    'NO_DEV_TTY means such a program cannot prompt at all — it fails rather than asking, and '
    + 'the drawer has to say that rather than appearing to hang');

  /* 7 · signals. The user pressing 멈추기 has to actually stop what is running. */
  const sig = await new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', 'sleep 30'], { cwd: DIR, stdio: 'ignore', detached: true });
    setTimeout(() => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }, 150);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  record('signal-stop', 'does signalling the group stop a running command?',
    `signal=${sig.signal} code=${sig.code}`,
    'this is the same mechanism WBS-23 already uses and already measured');

  /* 8 · does the shell keep state between lines? A pipe shell per line does not. */
  const a = await run('cd /; pwd');
  const b = await run('pwd');
  record('state-between-lines', 'does `cd` in one line affect the next?',
    `line1=${a.out} line2=${b.out} ${a.out === b.out ? '(kept)' : '(LOST)'}`,
    'a per-line shell is not a session; a persistent one needs its own lifetime and cleanup');

  /* 9 · interleaving. `19` §C4 says stderr is not hidden and not separated. */
  const inter = await run('echo out1; echo err1 1>&2; echo out2');
  record('stream-order', 'do stdout and stderr arrive in order?',
    `stdout=[${inter.out.replace(/\n/g, '|')}] stderr=[${inter.err.replace(/\n/g, '|')}]`,
    'two pipes cannot be interleaved reliably; a pty gives one stream in real order');

  console.log(JSON.stringify({ platform: `${os.platform()} ${os.release()}`, node: process.version,
                               dir: DIR, results }, null, 2));
  fs.rmSync(DIR, { recursive: true, force: true });
};

main();
