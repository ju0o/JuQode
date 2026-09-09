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
const { pathspec, isSecretName, ledger } = require('./exclude');

/** Refusal reasons. `15` SC-02 turns these into 확립 불가 with the reason. */
const REFUSE = {
  NOT_GIT: 'not-a-git-repo',
  MID_MERGE: 'mid-merge',
  UNREADABLE: 'unreadable-path',
  TOO_LARGE: 'too-large',
  GIT_MISSING: 'git-unavailable',
};

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;   // q19 tested a byte cap; 2 GiB is its default

function git(args, { cwd, env, maxBuffer = 32 * 1024 * 1024 } = {}) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
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

  /* `add -A` only WARNS about a path it cannot read, so an unreadable directory would silently
   * shrink the basis. It has to be found first. */
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

function firstUnreadable(root) {
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel || '.'), { withFileTypes: true }); }
    catch { return rel || '.'; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === '.git' || e.name === 'node_modules') continue;
      stack.push(rel ? `${rel}/${e.name}` : e.name);
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
 * Capture one basis. `store` is a JuQode-owned directory; the user's repository is never
 * written to and is verified byte-identical by the tests around this.
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

  // (1) nothing excluded is newly staged
  git(['add', '-A', '--', '.', ...pathspec()], { cwd: root, env });

  // (2) …and nothing excluded SURVIVES from the copied index either
  const staged = git(['ls-files'], { cwd: root, env }).split('\n').filter(Boolean);
  const dropped = staged.filter((f) => isSecretName(path.basename(f)));
  if (dropped.length) git(['rm', '--cached', '--quiet', '--', ...dropped], { cwd: root, env });

  const ref = git(['write-tree'], { cwd: root, env });
  let head = null;
  try { head = git(['rev-parse', 'HEAD'], { cwd: root }); } catch { /* unborn */ }

  return { kind: 'git_tree', ref, excluded: ledger(root), droppedFromIndex: dropped, head };
}

/** `diff-tree -p before after`, read through the JuQode object store. */
function diff(root, store, beforeRef, afterRef) {
  const env = {
    GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  };
  return git(['diff-tree', '-p', '--no-color', beforeRef, afterRef], { cwd: root, env });
}

/** The paths in a basis tree — used by the tests to prove no secret is in it. */
const treePaths = (root, store, ref) => git(['ls-tree', '-r', '--name-only', ref], {
  cwd: root,
  env: {
    GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitDir(root), 'objects'),
  },
}).split('\n').filter(Boolean);

module.exports = { capture, diff, refusal, treePaths, isGitRepo, REFUSE, DEFAULT_MAX_BYTES };
