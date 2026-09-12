'use strict';
/* WBS-22 · Quick Command availability — `19` §C4's `project_condition`, D-106.
 *
 * A rule is available only when the project can actually satisfy it, and when it cannot the
 * answer is `지금 안 됨` WITH A REASON — never a failure, and never silence (12 §16: 사용 불가
 * ≠ 실패). The reason is a KEY, not a sentence: the Korean is composed in the renderer so `18`
 * stays the single copy source (CANON_FINDINGS CF-6).
 *
 * The command a rule runs comes from ONE of two places and nowhere else:
 *   · the project's own `package.json` scripts — `{pm} run dev|build|test`
 *   · a fixed action — `git status --porcelain=v1 --branch`, a signal to a pid JuQode started,
 *     or opening the drawer
 *
 * Nothing here builds a command out of anything the user typed. If a script is missing, the
 * answer is 사용 불가 with the reason — `19` §C4: 빌드 방법을 지어내지 않는다.
 */
const fs = require('node:fs');
const path = require('node:path');
/* D-126a's list, reused rather than restated. `저장` must not commit what the evidence basis
 * refuses to record — a non-developer with no `.gitignore` would otherwise have JuQode put
 * their `.env` into a permanent commit on the first press of the button. */
const { pathspec } = require('../evidence/exclude');
/* The git capability is contained to ONE module (`tests/unit.test.js`). This file asks it
 * questions; it never spawns git itself. */
const { worktreeDirty, hasIdentity } = require('../evidence/git');

/** npm's own placeholder. A `test` script that is this one runs no tests (`19` §C4). */
const PLACEHOLDER_TEST = /no test specified/i;

/* Lockfile → package manager. Checked in a fixed order so the same project always resolves to
 * the same manager; `19` §C4 leaves detection UNVALIDATED, and `20` records the choice with the
 * run so a wrong guess is visible afterwards rather than silent. */
const LOCKFILES = [
  ['bun.lockb', 'bun'], ['bun.lock', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

function packageManager(root) {
  for (const [file, pm] of LOCKFILES) {
    if (fs.existsSync(path.join(root, file))) return pm;
  }
  return 'npm';                       // no lockfile: npm is the one every Node install has
}

/** The project's `package.json`, or null. A malformed one is NOT a package.json we can use. */
function readPackage(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); }
  catch { return null; }
}

/**
 * Can this rule run right now, and if not, why not?
 *
 * @param {string} ruleId
 * @param {object} ctx
 * @param {string} ctx.root                  the project root — the cwd every command would use
 * @param {{pid:number, startedAt:string, command:string}|null} [ctx.devServer]
 *   the dev server JuQode ITSELF started. A server the user started in their own terminal is
 *   not here and is never signalled — `19` §C4 says so and the copy says so.
 * @returns {{available:boolean, reason:string|null, data:object}}
 *   `reason` is a key from `19` §C4's table: no_script · no_package_json · already_running ·
 *   not_running · placeholder_script · not_git.
 */
/**
 * `npm run <script>` ALSO runs `pre<script>` and `post<script>` — verified against npm 9.2.0.
 * So the body of the named script is a strict SUBSET of what a confirmation actually confirms,
 * and `19` §C4's reason for showing it ("a user whose `start` does something else entirely needs
 * to see that before it runs") is defeated unless the hooks are shown too. JuQode's own Work path
 * lets Claude Code write `package.json`, which makes this the one real bridge from a sentence to
 * arbitrary shell — and the card is where it has to be disclosed.
 */
function hooksFor(scripts, name) {
  const out = [];
  for (const [prefix, hook] of [['pre', `pre${name}`], ['post', `post${name}`]]) {
    const body = scripts[hook];
    if (typeof body === 'string' && body.trim()) out.push({ when: prefix, script: hook, body });
  }
  return out;
}

/* ── helpers for `qc.git.commit` ──────────────────────────────────────────────────────
 * The two that need git live in `../evidence/git.js`, which is the one module allowed to spawn
 * it; what is left here is filesystem work and a clock. */

/** A folder with no `.git` yet: `git init` + `add -A` saves something only if a file exists. */
function hasContent(root) {
  try { return fs.readdirSync(root).some((n) => n !== '.git'); } catch { return null; }
}

/** The commit message is a CLOCK, never the user's words — `19` §C4 keeps typed text out of
 *  the argv, and that has to stay true of the one rule that writes. */
function stamp(d = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function availability(ruleId, { root, devServer = null } = {}) {
  const no = (reason, data = {}) => ({ available: false, reason, data });
  const yes = (data = {}) => ({ available: true, reason: null, data });

  if (ruleId === 'qc.terminal.open') {
    /* No condition at all. The drawer does not need a package.json, a git repo, or anything
     * else — `19` §C4: 터미널은 package.json 없어도 가능. */
    return yes({ cwd: root });
  }

  if (ruleId === 'qc.git.status') {
    /* A directory OR a file: a worktree and a submodule both use a `.git` file. */
    if (!fs.existsSync(path.join(root, '.git'))) return no('not_git');
    /* `argv`, not a string to be split later. The display string and the executed argument
     * vector are built from the SAME closed data and nothing ever parses one back into the
     * other — which is what makes "no code path from a free-text sentence to a shell" hold all
     * the way to the spawn, and not just as far as recognition. */
    return yes({ command: 'git status --porcelain=v1 --branch',
                 argv: ['git', 'status', '--porcelain=v1', '--branch'],
                 cwd: root, readOnly: true });
  }

  if (ruleId === 'qc.git.commit') {
    /* WBS-22b · 저장 — the FIRST rule that writes. `19` §C4's safety contract is kept whole:
     * the argv is fixed here, the message is composed here from a clock, and nothing the user
     * typed reaches either. There is still no code path from a sentence to a shell.
     *
     * `07` §1 forbids writing to the user's index and git directory WITHOUT THEIR INSTRUCTION;
     * this is the instruction, given on a card that names the command first. */
    const isRepo = fs.existsSync(path.join(root, '.git'));
    const dirty = isRepo ? worktreeDirty(root, pathspec()) : hasContent(root);
    if (dirty === null) return no('git_unavailable');
    /* Nothing to save is not a failure and not an error — it is the ordinary answer to
     * "저장해줘" right after a save. `12` §16: 사용 불가 ≠ 실패. */
    if (!dirty) return no('no_changes');

    const message = `JuQode 저장 · ${stamp()}`;
    /* An unset `user.email` makes `git commit` fail with "Please tell me who you are", which is
     * unactionable for the person this product is for. A fallback identity is injected ONLY
     * when there is none — a user who has configured git keeps their own name on their own
     * commits, which is the whole point of the config. */
    const who = hasIdentity(root) ? [] : ['-c', 'user.name=JuQode', '-c', 'user.email=juqode@localhost'];
    return yes({
      command: `${isRepo ? '' : 'git init · '}git add -A · git commit -m "${message}"`,
      argv: ['git', ...who, 'commit', '-m', message],
      /* Run before the command the card named, in order, each one fatal. Staging cannot be part
       * of the commit argv — there is no shell to chain them — and a `git commit -a` would miss
       * every file the Work CREATED, which for this product is the common case. */
      prepare: [
        ...(isRepo ? [] : [['git', 'init', '-q']]),
        ['git', 'add', '-A', '--', '.', ...pathspec()],
      ],
      init: !isRepo, message, excluded: true, cwd: root,
    });
  }

  if (ruleId === 'qc.dev.stop') {
    if (!devServer) return no('not_running');
    return yes({ pid: devServer.pid, startedAt: devServer.startedAt, commandStarted: devServer.command });
  }

  const pkg = readPackage(root);
  if (!pkg) return no('no_package_json');
  const scripts = (pkg.scripts && typeof pkg.scripts === 'object') ? pkg.scripts : {};
  const pm = packageManager(root);

  if (ruleId === 'qc.dev.start') {
    /* `19` §C4: dev, then start, then serve — and WHICH ONE was chosen is reported, because a
     * user whose `start` script does something else entirely needs to see that before running. */
    const script = ['dev', 'start', 'serve'].find((s) => typeof scripts[s] === 'string' && scripts[s].trim());
    if (!script) return no('no_script');
    /* Availability is checked BEFORE the running state so a project with no dev script says the
     * useful thing. A server already running is otherwise the first answer forever. */
    if (devServer) return no('already_running', { pid: devServer.pid, startedAt: devServer.startedAt });
    return yes({ command: `${pm} run ${script}`, argv: [pm, 'run', script],
                 script, scriptBody: scripts[script], hooks: hooksFor(scripts, script), cwd: root, pm });
  }

  if (ruleId === 'qc.build') {
    if (typeof scripts.build !== 'string' || !scripts.build.trim()) return no('no_script');
    return yes({ command: `${pm} run build`, argv: [pm, 'run', 'build'],
                 script: 'build', scriptBody: scripts.build, hooks: hooksFor(scripts, 'build'),
                 cwd: root, pm });
  }

  if (ruleId === 'qc.test') {
    if (typeof scripts.test !== 'string' || !scripts.test.trim()) return no('no_script');
    /* The placeholder is not a test command. Running it produces only an error, so the honest
     * answer is 사용 불가 with the reason — and the reason carries the script body, because the
     * user is entitled to see what is actually in their file. */
    if (PLACEHOLDER_TEST.test(scripts.test)) return no('placeholder_script', { scriptBody: scripts.test });
    return yes({ command: `${pm} run test`, argv: [pm, 'run', 'test'],
                 script: 'test', scriptBody: scripts.test, hooks: hooksFor(scripts, 'test'),
                 cwd: root, pm });
  }

  if (ruleId === 'qc.deploy') {
    /* WBS-22c · 배포. Exactly `qc.build`'s shape, and deliberately so: `19` §C4's 빌드 방법을
     * 지어내지 않는다 is the rule, and inventing a deploy target would publish a
     * non-developer's work somewhere they never chose. No `deploy` script, no rule. */
    if (typeof scripts.deploy !== 'string' || !scripts.deploy.trim()) return no('no_script');
    return yes({ command: `${pm} run deploy`, argv: [pm, 'run', 'deploy'],
                 script: 'deploy', scriptBody: scripts.deploy, hooks: hooksFor(scripts, 'deploy'),
                 cwd: root, pm });
  }

  /* An id that is not one of the six. The rule set is CLOSED (`20`.quick_command_rule), so this
   * is a programming error rather than a user-facing state — but it must not be `available`. */
  return no('unknown_rule');
}

module.exports = { availability, packageManager, readPackage, stamp, PLACEHOLDER_TEST, LOCKFILES };
