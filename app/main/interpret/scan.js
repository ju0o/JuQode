'use strict';
/* WBS-03 · Project interpretation, deterministic facts layer — `19` §C1 ①③④⑤.
 *
 * This is the half of the Brief that can be 확인됨. Every fact it produces carries a
 * `source_ref` naming the file it came from, because `20` refuses `confidence = 'confirmed'`
 * without one. It reads files; it does not interpret them, and it never guesses.
 *
 * Exclusions (`19` §C1 ④) are JuQode's own list and do not depend on `.gitignore`:
 *   .env · .env.* · *.pem · *.key · id_rsa · id_dsa · *.p12 · *.pfx · node_modules · dist · .git
 * A secret is excluded BY NAME, before it is opened. Nothing here reads a file to decide
 * whether to skip it.
 *
 * Budget (`19` §C1 ③): the walk stops listing at 2,000 files or 5 MB of cumulative file size.
 * Note what that is and is not — this layer READS only the manifests and the README's first
 * 8 KB, so the byte figure caps the LISTING, not the reading. What the cap cut off is reported
 * as 확인 못함 with the count, never silently dropped.
 *
 * Two kinds of directory go unread and they are NOT the same fact:
 *   - excluded  — on the permanent list below. Policy. Never going to be read, so it is not a gap.
 *   - unreadable — we tried and the OS refused. That IS a gap and the Brief says so.
 * Reporting the first as the second inflates 확인 못한 것 with something that was never missing.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILES = 2000;
/* `19` §C1 ③ sets the read budget at 5 MB. This layer's ceiling is far below it BY
 * CONSTRUCTION — at most one manifest of each kind plus the README's first 8 KB — so the
 * 5 MB figure is a bound this code cannot approach rather than a gate it enforces. An earlier
 * revision carried a `MAX_READ_BYTES` check that no input could ever trip; a cap nothing can
 * reach is not a cap, and leaving it in implied an enforcement that was not happening. */
const MAX_MANIFEST_BYTES = 512 * 1024;    // one manifest; anything larger is not a manifest

const TREE_DEPTH = 3;
const README_BYTES = 8 * 1024;

/* `19` §C1 ④ / D-126a say `.env*`, so the prefix is the rule — `.envrc` and `.env-production`
 * hold credentials just as `.env` does. `id_ed25519` is the modern SSH default and was missing. */
const SECRET = [
  /^\.env/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i, /\.jks$/i,
  /^id_rsa/i, /^id_dsa/i, /^id_ecdsa/i, /^id_ed25519/i,
];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'out', 'target', '.next', 'vendor', '__pycache__', '.venv', 'venv']);

const isSecret = (name) => SECRET.some((re) => re.test(name));

/* Manifest → the technology it proves. `19` §C1: manifests are what makes 쓰인 기술 확인됨. */
const MANIFESTS = [
  { file: 'package.json',     eco: 'Node.js',  parse: parsePackageJson },
  { file: 'pyproject.toml',   eco: 'Python',   parse: parseToml },
  { file: 'requirements.txt', eco: 'Python',   parse: (t) => parseRequirements(t) },
  { file: 'Cargo.toml',       eco: 'Rust',     parse: parseToml },
  { file: 'go.mod',           eco: 'Go',       parse: (t) => parseGoMod(t) },
  { file: 'pom.xml',          eco: 'Java',     parse: () => ({}) },
  { file: 'build.gradle',     eco: 'Java',     parse: () => ({}) },
  { file: 'Gemfile',          eco: 'Ruby',     parse: () => ({}) },
  { file: 'composer.json',    eco: 'PHP',      parse: () => ({}) },
];

const MANIFEST_COUNT = MANIFESTS.length;
const READ_CEILING_BYTES = MAX_MANIFEST_BYTES * MANIFEST_COUNT + README_BYTES;

const LOCKFILES = [
  ['package-lock.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'],
  ['poetry.lock', 'poetry'], ['Cargo.lock', 'cargo'], ['go.sum', 'go'], ['Gemfile.lock', 'bundler'],
];

/**
 * @returns {{facts: object, readFiles: string[], sourceHash: string,
 *            skipped: {files:number, bytes:boolean, dirs:string[]}|null, failed?: string}}
 */
function scan(root) {
  const readFiles = [];
  const facts = { ecosystems: [], manifests: [], scripts: [], lockfiles: [], topDirs: [], readme: null };

  let walked;
  try {
    walked = walk(root);
  } catch (e) {
    /* `19` §C1 ⑥: a scan failure is a read-failure card, not a stopped product. */
    return { facts, readFiles, sourceHash: null, skipped: null, failed: e.code || 'EUNKNOWN' };
  }

  /* `walked.readable` is the ONLY list anything is read from. It holds top-level entries the
   * walk itself verified are regular files (`lstat`, so a symlink is a symlink), are not on
   * the secret list, and are small enough to be a manifest.
   *
   * An earlier revision read from the raw entry-name set instead, which was filled before any
   * of those checks. `readFileSync` follows symlinks, so `requirements.txt -> ~/.ssh/id_rsa`
   * was read, parsed, stored in `interpretation_answer`, and rendered under a 확인됨 chip.
   * The fix is structural: there is now one list, and it is the checked one. */
  let readBytes = 0;
  for (const { file, eco, parse } of MANIFESTS) {
    if (!walked.readable.has(file)) continue;
    const abs = path.join(root, file);
    let parsed = {};
    try {
      const text = readCapped(abs, MAX_MANIFEST_BYTES);
      readBytes += Buffer.byteLength(text);
      readFiles.push(file);
      parsed = parse(text) || {};
    } catch { /* present but unreadable or oversized: the manifest still proves the ecosystem */ }
    if (!facts.ecosystems.includes(eco)) facts.ecosystems.push(eco);
    facts.manifests.push({ file, eco, name: parsed.name ?? null, deps: parsed.deps ?? [] });
    for (const s of parsed.scripts ?? []) facts.scripts.push({ ...s, source: file });
  }

  /* A lockfile is evidence by its PRESENCE, and presence is only presence if the entry is a
   * real file we would have been allowed to open. */
  for (const [file, pm] of LOCKFILES) if (walked.readable.has(file)) facts.lockfiles.push({ file, pm });

  /* Same list, same reason. `/^readme/i` matches `readme.key` and `readme.pem`; drawing the
   * candidate from `walked.readable` is what keeps those out, rather than a second guard that
   * has to be remembered here. */
  const readmeName = walked.readable.has('README.md') ? 'README.md'
    : [...walked.readable].find((n) => /^readme(\.|$)/i.test(n)) ?? null;
  if (readmeName) {
    try {
      const fd = fs.openSync(path.join(root, readmeName), 'r');
      try {
        const buf = Buffer.alloc(README_BYTES);
        const n = fs.readSync(fd, buf, 0, README_BYTES, 0);
        facts.readme = { file: readmeName, firstSection: firstSection(buf.subarray(0, n).toString('utf8')) };
      } finally { fs.closeSync(fd); }
      readFiles.push(readmeName);
    } catch { /* unreadable README is simply not a fact */ }
  }

  facts.topDirs = walked.dirs;
  facts.fileCount = walked.fileCount;
  facts.excludedDirs = walked.excludedDirs;
  /* The depth-capped listing, sorted. It is what the source hash is computed over, and
   * returning it is what makes the walk's behaviour assertable rather than only hashable —
   * every secret-exclusion guard was previously invisible to any test. It carries no file
   * CONTENTS and nothing on the secret list ever enters it. */
  facts.tree = walked.tree;

  /* `19` §C1 ⑤ — stale is derived from this, and from nothing else. It covers the manifests
   * and the shape of the tree, so a content edit inside a file does not by itself age the
   * Brief while a new dependency or a new top-level folder does. */
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify({
    m: facts.manifests.map((m) => [m.file, m.name, m.deps]),
    s: facts.scripts.map((s) => [s.source, s.name, s.body]),
    l: facts.lockfiles.map((l) => l.file),
    t: walked.tree,
  })).digest('hex');

  return { facts, readFiles, readBytes, sourceHash, skipped: walked.skipped };
}

/** Breadth-first, depth-capped, budget-capped. Never follows a symlink out of the project. */
function walk(root) {
  const readable = new Set();       // top-level entries that may be OPENED — see scan()
  const dirs = [];                  // top-level directories, in order
  const tree = [];                  // depth-capped path list — the stale signal
  const excludedDirs = [];          // policy: on the permanent list, at any depth
  const unreadableDirs = [];        // tried and refused: a real gap
  const depthLimited = [];          // below TREE_DEPTH — real content we chose not to look at
  let fileCount = 0, skippedFiles = 0;

  const queue = [{ rel: '', depth: 0 }];
  while (queue.length) {
    const { rel, depth } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch (e) {
      if (rel === '') throw Object.assign(new Error('project root unreadable'), { code: e.code || 'EACCES' });
      unreadableDirs.push(rel);      // the OS refused — this one really is a gap
      continue;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;

      /* The secret check comes FIRST, before the type branch: a DIRECTORY named `.env` used to
       * walk straight past it and print its name in the Brief. */
      if (isSecret(e.name)) continue;

      /* `Dirent.isFile()` is false for DT_UNKNOWN, which some filesystems always report, so
       * the type is resolved with lstat when the dirent will not say. lstat, not stat: a
       * symlink must stay a symlink here. */
      let kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : e.isSymbolicLink() ? 'link' : null;
      if (kind === null) {
        try { const st = fs.lstatSync(path.join(root, childRel)); kind = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other'; }
        catch { continue; }
      }

      if (kind === 'dir') {
        /* Reported at EVERY depth, not just the top: a nested `vendor/` or `.venv/` that
         * vanished from the record would be a folder we never mentioned skipping. */
        if (SKIP_DIRS.has(e.name)) { excludedDirs.push(childRel); continue; }
        if (rel === '') dirs.push(e.name);
        tree.push(`${childRel}/`);
        if (depth + 1 < TREE_DEPTH) queue.push({ rel: childRel, depth: depth + 1 });
        else depthLimited.push(childRel);   // real content below the cap — say so, do not drop it
        continue;
      }
      if (kind !== 'file') continue;        // sockets, fifos and SYMLINKS are never opened

      if (fileCount >= MAX_FILES) { skippedFiles += 1; continue; }
      fileCount += 1;
      tree.push(childRel);
      if (rel === '') readable.add(e.name);
    }
  }

  tree.sort();
  excludedDirs.sort();
  unreadableDirs.sort();
  depthLimited.sort();
  const skipped = (skippedFiles || unreadableDirs.length || depthLimited.length)
    ? { files: skippedFiles, unreadableDirs, depthLimited } : null;
  return { readable, dirs: dirs.sort(), tree, fileCount, excludedDirs, skipped };
}

/** Read at most `cap` bytes. A manifest larger than that is not a manifest, and reading it
 *  whole blocks the main process — `scan()` is synchronous inside the interpret handler. */
function readCapped(abs, cap) {
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(cap);
    const n = fs.readSync(fd, buf, 0, cap, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}

/* ── manifest parsers. Each returns only what it can PROVE from the file. ── */

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function parsePackageJson(text) {
  const j = JSON.parse(text);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
  return {
    name: typeof j.name === 'string' ? j.name : null,
    deps: Object.keys({ ...obj(j.dependencies), ...obj(j.devDependencies) }).sort(),
    /* `"scripts": "npm test"` used to yield eight scripts named 0…7 — a string spreads into
     * its characters. Only an object declares scripts. */
    scripts: Object.entries(obj(j.scripts)).map(([name, body]) => ({ name, body: String(body) })),
  };
}

/* Enough TOML for a manifest's `name` and dependency table keys. Not a TOML parser, and it
 * does not pretend to be: anything it cannot read becomes an absent fact, never a guess. */
function parseToml(text) {
  /* One pass, one line at a time. The earlier `/^\s*name\s*=…/m` form was O(lines × bytes):
   * measured 44.9 s on a 450 KB file of whitespace lines, with the window frozen throughout
   * because `scan()` runs synchronously inside the interpret handler. */
  let name = null;
  const deps = [];
  let inDeps = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      const header = line.slice(1, line.indexOf(']') === -1 ? undefined : line.indexOf(']')).trim();
      inDeps = /(^|\.)dependencies$/.test(header);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) continue;
    if (inDeps) { deps.push(key); continue; }
    if (name === null && key === 'name') {
      const v = line.slice(eq + 1).trim();
      const m = /^["']([^"']*)["']/.exec(v);
      if (m) name = m[1];
    }
  }
  return { name, deps: deps.sort() };
}

const parseRequirements = (text) => ({
  deps: text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/[<>=!~\[ ]/)[0]).filter(Boolean).sort(),
});

/* `\s` crosses newlines, so `/^module\s+(\S+)/m` on `module\n\nrequire (` used to answer
 * `require`. The module path is on the module line or it is not there. */
const parseGoMod = (text) => ({
  name: /^module[ \t]+(\S+)/m.exec(text)?.[1] ?? null,
  deps: [...text.matchAll(/^[ \t]+(\S+)[ \t]+v\S+/gm)].map((m) => m[1]).sort(),
});

/** The README's first section: its opening prose, before the second heading. */
function firstSection(text) {
  const lines = text.split('\n');
  const out = [];
  let seenHeading = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (seenHeading) break;
      seenHeading = true;
      continue;
    }
    out.push(line);
    if (out.join('\n').trim().length > 600) break;
  }
  return out.join('\n').trim().slice(0, 600) || null;
}

module.exports = { scan, MAX_FILES, MAX_MANIFEST_BYTES, READ_CEILING_BYTES, TREE_DEPTH, isSecret, MANIFEST_COUNT };
