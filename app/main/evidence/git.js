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

function git(args, { cwd, env, maxBuffer = 256 * 1024 * 1024, raw = false } = {}) {
  const out = execFileSync('git', [
    '--no-optional-locks',
    /* `GIT_INDEX_FILE` redirects the index, but a split index writes its SHARED half into the
     * user's `$GIT_DIR` — measured: every capture left a new `sharedindex.*` file behind. That
     * is a write into the user's repository, which `07` §1 forbids without qualification. */
    '-c', 'core.splitIndex=false',
    ...args,
  ], {
    cwd, env: { ...baseEnv(), ...env }, encoding: 'utf8', maxBuffer,
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
  const userIndex = path.join(gitDir(root), 'index');
  /* An unborn repository has no index file yet; starting from an empty one is correct. */
  if (fs.existsSync(userIndex)) fs.copyFileSync(userIndex, index);
  else if (fs.existsSync(index)) fs.rmSync(index);

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
   * to prevent. Suppressing the advice does not clear the status either (measured). So the
   * status is not trusted in EITHER direction — the ARTIFACT is checked instead, below, and
   * the failure is kept so a genuinely broken add is still visible. */
  let addFailed = null;
  try {
    git(['add', '-A', '--', '.', ...pathspec(), ...nestedSpec], { cwd: root, env });
  } catch (e) {
    addFailed = String(e?.stderr ?? e?.message ?? e);
  }

  /* (2) …and nothing excluded SURVIVES from the copied index either.
   *
   * `-z` is required. Without it git C-quotes any path that is not plain ASCII, so a Korean
   * secret filename came back as `"\355\202\244.pem"` — basename ends in a quote, the name
   * check missed it, and the blob stayed in the basis tree. For a Korean-market product that
   * is the ordinary filename, not the exotic one. */
  const staged = git(['ls-files', '-z'], { cwd: root, env, raw: true }).split('\0').filter(Boolean);
  /* The artifact check the status is not trusted for: an `add` that reported a problem AND
   * produced an empty index really did fail, and a basis of nothing is not a basis. */
  if (addFailed && !staged.length) {
    const err = new Error(`git add produced no index: ${addFailed}`);
    err.code = 'add-failed';
    throw err;
  }
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
  return { kind: 'git_tree', ref, excluded: ledger(root, extra), droppedFromIndex: dropped, head,
           nestedRepos: nested };
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
  const out = git(['diff-tree', '-r', '-z', '--name-only', '--no-color', beforeRef, afterRef],
                  { cwd: root, env, raw: true });
  /* `diff-tree` leads with the commit id line when given commits; `-z` makes that line
   * NUL-terminated too. Drop any entry that is a bare 40-hex id. */
  return out.split('\0').filter((p) => p && !/^[0-9a-f]{40}$/.test(p));
}

/** The paths in a basis tree — used by the tests to prove no secret is in it. */
const treePaths = (root, store, ref) => git(['ls-tree', '-r', '--name-only', ref], {
  cwd: root,
  env: {
    GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  },
}).split('\n').filter(Boolean);

module.exports = { capture, diff, changedPaths, fileAt, refusal, treePaths, isGitRepo, nestedRepos, ignoredPaths, REFUSE, DEFAULT_MAX_BYTES };
