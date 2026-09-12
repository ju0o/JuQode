'use strict';
/* WBS-08 · change-evidence basis, Git mechanism — the CORRECTED contract (D-126a, `19` §E).
 *
 * The rule that governs every line here (`07` §1): JuQode never writes to the user's index or
 * worktree. Not `stash`, not `checkout`, not `reset`, not `read-tree`. It works on a COPY of
 * the index, writes objects into a directory it owns, and reads the user's object store only
 * as an alternate.
 *
 * Two exclusion steps, and BOTH are required — measured, not assumed:
 *   1. an `:(exclude,glob)` pathspec on `add -A`, so nothing excluded is newly staged;
 *   2. `rm --cached` on the COPIED index, because a pathspec only filters what `add`
 *      considers. A secret the user had already committed is already in that index, and
 *      `write-tree` would keep referencing its blob. The spike proved this: with the pathspec
 *      alone, six already-committed secret paths were still in the basis tree.
 *
 * `--no-optional-locks` on every call, because without it `git status` rewrites `.git/index`.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathspec, isExcludedPath, ledger } = require('./exclude');

/** Refusal reasons. `15` SC-02 turns these into 확립 불가 with the reason. */
const REFUSE = {
  NOT_GIT: 'not-a-git-repo',
  MID_MERGE: 'mid-merge',
  UNREADABLE: 'unreadable-path',
  TOO_LARGE: 'too-large',
  GIT_MISSING: 'git-unavailable',
};

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;   // q19 tested a byte cap; 2 GiB is its default

/* An inherited GIT_* variable silently redirects a command at another repository — measured:
 * `rev-parse HEAD` returned an unrelated repo's commit. The environment is built, not spread. */
const GIT_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
                  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR'];

function baseEnv() {
  const env = { ...process.env };
  for (const v of GIT_VARS) delete env[v];
  return env;
}

function git(args, { cwd, env, maxBuffer = 256 * 1024 * 1024, raw = false, encoding = 'utf8' } = {}) {
  const out = execFileSync('git', [
    '--no-optional-locks',
    /* `GIT_INDEX_FILE` redirects the index, but a split index writes its SHARED half into the
     * user's `$GIT_DIR` — measured: every capture left a new `sharedindex.*` file behind. That
     * is a write into the user's repository, which `07` §1 forbids without qualification. */
    '-c', 'core.splitIndex=false',
    ...args,
  ], {
    cwd, env: { ...baseEnv(), ...env }, encoding, maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return raw ? out : out.trim();
}

const isGitRepo = (root) => fs.existsSync(path.join(root, '.git'));

/** Everything that makes a change Work impossible to evidence. Checked BEFORE anything runs. */
function refusal(root, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  try { git(['--version'], { cwd: root }); } catch { return { reason: REFUSE.GIT_MISSING }; }
  if (!isGitRepo(root)) return { reason: REFUSE.NOT_GIT };

  const dir = gitDir(root);
  /* A merge or rebase in progress means the worktree is already a half-state that is not the
   * user's intent. Capturing it as "before" would make every later diff wrong. */
  for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) {
    if (fs.existsSync(path.join(dir, marker))) return { reason: REFUSE.MID_MERGE, detail: marker };
  }

  /* `add -A` only WARNS about a path it cannot read, so an unreadable path would silently
   * shrink the basis. Files and directories are both checked, at every depth. */
  const unreadable = firstUnreadable(root);
  if (unreadable) return { reason: REFUSE.UNREADABLE, detail: unreadable };

  const size = measure(root, maxBytes);
  if (size.over) return { reason: REFUSE.TOO_LARGE, detail: `${size.bytes}` };
  return null;
}

function gitDir(root) {
  const p = path.join(root, '.git');
  if (fs.statSync(p).isDirectory()) return p;
  /* a worktree or submodule: `.git` is a file pointing elsewhere */
  const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(p, 'utf8'));
  return m ? path.resolve(root, m[1].trim()) : p;
}

/**
 * The first path `add -A` would fail to read. FILES are checked as well as directories: an
 * unreadable file made `capture()` throw an uncaught error instead of producing the refusal
 * card, and `node_modules` was skipped entirely — an unreadable directory under it passed the
 * check and the basis silently shrank, which is the exact failure `add -A`'s warn-only
 * behaviour makes possible.
 */
function firstUnreadable(root) {
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel || '.'), { withFileTypes: true }); }
    catch { return rel || '.'; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === '.git') continue;
      if (e.isDirectory()) { stack.push(child); continue; }
      if (!e.isFile()) continue;
      if (isExcludedPath(child)) continue;      // never opened by anything, so never a blocker
      try { fs.accessSync(path.join(root, child), fs.constants.R_OK); }
      catch { return child; }
    }
  }
  return null;
}

function measure(root, maxBytes) {
  let bytes = 0;
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel || '.'), { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (e.name !== '.git') stack.push(child); continue; }
      if (!e.isFile()) continue;
      try { bytes += fs.statSync(path.join(root, child)).size; } catch { /* raced */ }
      if (bytes > maxBytes) return { bytes, over: true };
    }
  }
  return { bytes, over: false };
}

/**
 * Capture one basis. `store` is a JuQode-owned directory.
 *
 * The user's repository is not written to, and the test around this hashes `.git/index` FIRST
 * — before any git command runs — because a `git status` inside the check refreshes the index
 * and would normalise away the very damage it is looking for. What is NOT covered: `.git/objects`
 * is excluded from that hash (the alternate makes new objects there impossible, not merely
 * unobserved), and no platform other than Linux has been measured at all.
 *
 * @returns {{kind:'git_tree', ref:string, excluded:object[], droppedFromIndex:string[], head:string|null}}
 */
function capture(root, store, phase) {
  fs.mkdirSync(store, { recursive: true });
  const objects = path.join(store, 'objects');
  fs.mkdirSync(objects, { recursive: true });

  const index = path.join(store, `index.${phase}`);

  /* The basis starts from an EMPTY index, not from a copy of the user's.
   *
   * A copied index carries the user's STAT CACHE, and git then trusts it: an entry whose
   * recorded size and mtime still match the file is not re-read. Git's own guard is the
   * "racily clean" rule — an entry whose mtime is not older than the INDEX FILE's mtime gets a
   * content check — but `copyFileSync` stamps the copy with the time of the copy, which is
   * newer than every entry, so no entry is ever racy and the cache is believed completely.
   *
   * MEASURED, and it is the evidence-integrity class: a same-size edit made in the same second
   * as the last `git add` came back as NO CHANGE. The after-basis was byte-identical to the
   * before-basis while the file on disk held the new content, `git status` against the copied
   * index reported nothing, and the product said 바뀐 파일이 없어요 ✓확인됨 about a file the
   * Work had just rewritten. Dating the copy to the epoch is not the fix and measured worse —
   * git skips racy handling altogether when the index timestamp is zero.
   *
   * Starting empty removes the cache instead of trying to outwit it: every file is hashed from
   * its CONTENT on every capture. It costs a full re-hash, bounded by the size refusal, and it
   * is what makes a basis evidence rather than a report of what git last happened to notice.
   *
   * It also makes D-126a's second exclusion step cheap rather than load-bearing: nothing
   * carries over from the user's index, so a secret they had already committed cannot arrive
   * that way at all. The `rm --cached` below stays as the belt to that braces.
   */
  if (fs.existsSync(index)) fs.rmSync(index);

  const env = {
    GIT_INDEX_FILE: index,
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  };

  /* (1) nothing excluded is newly staged.
   *
   * Nested repositories are excluded here as well as reported: `add -A` records one as a
   * gitlink whose commit lives in neither object store, and a nested repo with NO commit makes
   * `add` fail outright ("does not have a commit checked out") — a basis that cannot be taken
   * at all. D-126 asks for exactly this: exclude, and report. */
  const nested = nestedRepos(root);
  const nestedSpec = nested.flatMap((r) => [`:(exclude)${r}`, `:(exclude,glob)${r}/**`]);

  /* MEASURED (git 2.53.0): the moment ANY `:(exclude)` element is present, `git add` treats an
   * ignored file as EXPLICITLY named and exits 1 — "다음 경로는 .gitignore 파일 중 하나 때문에
   * 무시합니다: .env" — even though the index it wrote is exactly right. `git add -A -- .`
   * without excludes exits 0 on the same tree. A project that gitignores its own `.env` is the
   * ordinary case, so throwing here meant JuQode could not take a basis for most real repos.
   *
   * `-f` is NOT the fix: it would stage the ignored file, which is the one thing D-126a exists
   * to prevent. Suppressing the advice does not clear the status either (measured).
   *
   * So a failure is not accepted on the strength of the exit code, and NOT on the strength of a
   * non-empty index either: the index here is a COPY of the user's, so it holds their tracked
   * files whether or not this `add` wrote anything. Measured — a file `add` cannot read makes
   * git exit 128 and abort WITHOUT writing the index, and the copy then still describes the
   * state before the Work; `capture` returned the before-tree as the after-tree, `changedPaths`
   * was empty, and the product said 바뀐 파일이 없어요 ✓확인됨 about a file it had just changed.
   * That is the evidence-integrity class, and it is worse than the throw it replaced.
   *
   * The benign cause has exactly one shape — ignored files, which git names as "explicitly
   * given" only because an exclude element is present. The harmful causes all come down to a
   * path git could not read, and `firstUnreadable` is the direct detector for that. So on a
   * failure we look for the harmful cause and refuse when we find it. Reading the message is
   * not an option: this machine prints it in Korean. */
  let addFailed = null;
  try {
    git(['add', '-A', '--', '.', ...pathspec(), ...nestedSpec], { cwd: root, env });
  } catch (e) {
    addFailed = String(e?.stderr ?? e?.message ?? e);
    const unreadable = firstUnreadable(root);
    if (unreadable) {
      const err = new Error(`git add could not read ${unreadable}`);
      err.code = REFUSE.UNREADABLE;
      err.detail = unreadable;
      throw err;
    }
  }

  /* (2) …and nothing excluded SURVIVES from the copied index either.
   *
   * `-z` is required. Without it git C-quotes any path that is not plain ASCII, so a Korean
   * secret filename came back as `"\355\202\244.pem"` — basename ends in a quote, the name
   * check missed it, and the blob stayed in the basis tree. For a Korean-market product that
   * is the ordinary filename, not the exotic one. */
  const staged = git(['ls-files', '-z'], { cwd: root, env, raw: true }).split('\0').filter(Boolean);
  const dropped = staged.filter((f) => isExcludedPath(f));
  if (dropped.length) git(['rm', '--cached', '--quiet', '--', ...dropped], { cwd: root, env });

  const ref = git(['write-tree'], { cwd: root, env });
  let head = null;
  try { head = git(['rev-parse', 'HEAD'], { cwd: root }); } catch { /* unborn */ }

  /* D-126a: the ledger covers the excluded set — the secret list **and the ignored files**.
   * Recording only the secret list left every `.gitignore`d path outside both the tree diff
   * and the ledger, so a change to one was invisible in every channel. That silence is what
   * D-126a replaced the old `--ignored=matching` comparison to eliminate; carrying only half
   * the set reintroduced it.
   *
   * The paths are obtained from git; the CONTENTS are never opened, so nothing leaks. */
  const extra = [...ignoredPaths(root), ...nestedRepoFiles(root)];
  /* `addWarning` travels with the basis rather than being dropped on the floor: the add
   * succeeded well enough to keep, and the caller is entitled to know it complained. */
  return { kind: 'git_tree', ref, excluded: ledger(root, extra), droppedFromIndex: dropped, head,
           nestedRepos: nested, addWarning: addFailed };
}

/** Paths git is ignoring. Names only — no file is opened to obtain them. */
function ignoredPaths(root) {
  try {
    return git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard'],
      { cwd: root, raw: true }).split('\0').filter(Boolean);
  } catch { return []; }
}

/**
 * A nested repository is recorded by `add -A` as a gitlink, so none of its files reach the
 * basis and a change inside one is invisible in the diff. D-126 requires it excluded **and
 * reported**; the files go into the ledger so a change to them can still be stated.
 */
function nestedRepos(root) {
  const found = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel || '.'), { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === '.git') { if (rel) found.push(rel); continue; }
      if (e.name === 'node_modules') continue;
      stack.push(child);
    }
  }
  return found.sort();
}

function nestedRepoFiles(root) {
  const out = [];
  for (const repoRel of nestedRepos(root)) {
    const stack = [repoRel];
    while (stack.length) {
      const rel = stack.pop();
      let entries;
      try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
        const child = `${rel}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '.git') stack.push(child); continue; }
        if (e.isFile()) out.push(child);
      }
    }
  }
  return out;
}

/** One file's content at a basis, or null. Feeds the segmenter's before/after parse. */
function fileAt(root, store, ref, filePath) {
  const env = {
    GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  };
  try { return git(['show', `${ref}:${filePath}`], { cwd: root, env, raw: true }); }
  catch { return null; }                     // absent on that side — an add or a delete
}

/** `diff-tree -p before after`, read through the JuQode object store.
 *  The context width is FIXED at 3 (D-127): S2 block identity depends on it, so it cannot be
 *  left to whoever produced the patch. */
function diff(root, store, beforeRef, afterRef) {
  const env = {
    GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  };
  return git(['diff-tree', '-p', '-U3', '--no-color', beforeRef, afterRef], { cwd: root, env, raw: true });
}

/**
 * The paths that differ between two bases, from git plumbing rather than from the patch text.
 *
 * `diff --git a/… b/…` is NOT parseable: a directory named `a b` puts a second ` b/` in the
 * line, and a non-ASCII path — the ordinary case for this product — is C-quoted and matches no
 * bare `a/` at all. `-z` gives NUL-separated raw bytes, exactly as `ls-files` does above.
 * Order matches `diff-tree -p`, so the two can be zipped.
 */
function changedPaths(root, store, beforeRef, afterRef) {
  const env = {
    GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  };
  /* The list is FILENAMES, and nothing here tries to recognise an object id by its shape.
   *
   * An earlier revision filtered out any bare 40-hex entry, to drop a leading commit-id line.
   * `diff-tree` prints that line only for the single-commit form, which this never uses, so the
   * filter's only live effect was deleting real filenames that happen to be 40 hex characters —
   * content-addressed caches, sha1 fixtures, object dumps. `splitDiff` zips this list with the
   * patch BY INDEX, so one dropped name shifted every later file and filed one file's diff
   * under another's name. `--no-commit-id` says the intent out loud; it is belt to that braces,
   * not the thing doing the work. */
  const out = git(['diff-tree', '-r', '-z', '--no-commit-id', '--name-only', '--no-color',
                   beforeRef, afterRef], { cwd: root, env, raw: true });
  return out.split('\0').filter(Boolean);
}

/** The paths in a basis tree — used by the tests to prove no secret is in it. */
const treePaths = (root, store, ref) => git(['ls-tree', '-r', '--name-only', ref], {
  cwd: root,
  env: {
    GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  },
}).split('\n').filter(Boolean);

/* ── WBS-22b · what `저장` has to ask git before it can offer itself ────────────────────
 *
 * These live HERE, not in `qc/availability.js`, because the git capability is contained to one
 * module by design (`tests/unit.test.js` · capability containment): a second file that can
 * spawn git is a second file that has to be read to know what JuQode can do to a repository.
 *
 * Each one answers `null` when it could not ask at all. A question we could not put becomes
 * `git_unavailable` on screen, never a confident "no".
 */
function ask(root, args) {
  try { return git(args, { cwd: root, raw: true }); }
  catch { return null; }
}

/**
 * Is there anything to save? `null` when git could not be asked.
 *
 * The caller passes the SAME pathspec the staging step will use. Without it the two questions
 * differ: a worktree dirty only because of a `.env` reads as "there is something to save", the
 * excluded staging then stages nothing, and `git commit` fails with `nothing to commit` — an
 * English error, painted red, about a 저장 that was never possible. One question, asked once.
 */
function worktreeDirty(root, pathspec = []) {
  const out = ask(root, ['status', '--porcelain=v1', '--', '.', ...pathspec]);
  return out === null ? null : out.trim() !== '';
}

/** Does this machine have a committer identity? Without one `git commit` fails with
 *  "Please tell me who you are", which is not a sentence this product's user can act on. */
function hasIdentity(root) {
  const email = ask(root, ['config', '--get', 'user.email']);
  const name = ask(root, ['config', '--get', 'user.name']);
  return Boolean(email && email.trim() && name && name.trim());
}

/* ── WBS-19b · 되돌리기 ─────────────────────────────────────────────────────────────
 *
 * D-115 says there is no undo button, and about a GLOBAL undo it is right: nothing can promise
 * a machine returns to a previous moment. What follows makes a much narrower claim, and it is
 * one the evidence already in the store can actually carry — **the files this Work changed, put
 * back to the bytes the before-basis recorded.**
 *
 * Three limits are structural and the copy has to say all three, because none of them can be
 * fixed here:
 *   1. Only files IN the basis. `exclude.js` keeps `.env*`, `*.pem`, `node_modules` and nested
 *      repositories out of every basis (D-126a), so they are not restored — the basis never
 *      held them.
 *   2. Only file CONTENT. A command the Work ran (an install, a migration, a write to a
 *      database) left effects outside the worktree and nothing here reaches them.
 *   3. Edits the USER made after the Work ended are overwritten. The before-basis is the only
 *      thing this knows about; it has no record of anything that happened afterwards.
 *
 * `07` §1 forbids writing to the user's INDEX or GIT DIRECTORY, and nothing here does: this
 * writes to the worktree, which is the user's own files, on the user's explicit instruction.
 * That is the one write JuQode makes and it is the point of the feature.
 */

/** One file's BYTES at a basis, or null when it is absent on that side (an add or a delete).
 *  `fileAt` decodes as UTF-8, which silently corrupts anything that is not text. */
function bytesAt(root, store, ref, filePath) {
  const env = {
    GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  };
  try { return git(['show', `${ref}:${filePath}`], { cwd: root, env, raw: true, encoding: 'buffer' }); }
  catch { return null; }
}

/** `path → mode` for one tree. `-z` because a path with a non-ASCII name — the ordinary case
 *  for this product — is C-quoted by the default output and would not match the worktree. */
function treeModes(root, store, ref) {
  const env = {
    GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  };
  const out = git(['ls-tree', '-r', '-z', ref], { cwd: root, env, raw: true });
  const modes = new Map();
  for (const entry of out.split('\0')) {
    /* `<mode> SP <type> SP <object> TAB <path>` */
    const m = /^(\d{6}) \w+ [0-9a-f]+\t([\s\S]*)$/.exec(entry);
    if (m) modes.set(m[2], parseInt(m[1].slice(-4), 8));
  }
  return modes;
}

/**
 * Put every file this Work changed back to its before-basis content.
 *
 * @returns {{path:string, action:'restored'|'removed'|'failed'}[]} one entry per file, in the
 *   order the basis names them. A `failed` entry is REPORTED, never swallowed: a partial
 *   restore that claimed success would be the worst possible outcome of this feature.
 */
function restore(root, store, beforeRef, afterRef) {
  const paths = changedPaths(root, store, beforeRef, afterRef);
  const modes = treeModes(root, store, beforeRef);
  const done = [];

  for (const rel of paths) {
    const abs = path.resolve(root, rel);
    /* The list comes from our own tree, so this should never fire — which is exactly why it is
     * here. It makes "nothing outside the project is written" a property of the code rather
     * than a property of the data. */
    if (abs !== root && !abs.startsWith(root + path.sep)) { done.push({ path: rel, action: 'failed' }); continue; }

    const bytes = bytesAt(root, store, beforeRef, rel);
    if (bytes === null) {
      /* Absent in the before tree: the Work created this file, so removing it IS the restore.
       * `force` so an already-deleted path is not an error — the end state is what matters. */
      try { fs.rmSync(abs, { force: true }); done.push({ path: rel, action: 'removed' }); }
      catch { done.push({ path: rel, action: 'failed' }); }
      continue;
    }

    try {
      const existed = fs.existsSync(abs);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
      /* A file the Work DELETED is being recreated, and a new file gets the umask's mode — an
       * executable script would come back without its `+x` and fail at the next run with a
       * permission error that names nothing. An existing file keeps the mode it has. */
      if (!existed && modes.has(rel)) { try { fs.chmodSync(abs, modes.get(rel)); } catch { /* best effort */ } }
      done.push({ path: rel, action: 'restored' });
    } catch { done.push({ path: rel, action: 'failed' }); }
  }
  return done;
}

module.exports = { capture, diff, changedPaths, fileAt, bytesAt, restore, worktreeDirty, hasIdentity, refusal, treePaths, isGitRepo, nestedRepos, ignoredPaths, REFUSE, DEFAULT_MAX_BYTES };
