'use strict';
/* V1-412 slice A · local patch evidence, pure computation (no DB, no schema, no wiring).
 *
 * Input is TWO SIDES of one Task Run: the Run's own `before` snapshot and its `after` snapshot.
 * Because `before` is the Run's own basis, a file that was already dirty before the Run and was
 * not touched during it has the same bytes on both sides and comes out `unchanged` — it is never
 * attributed to this Run. Only before -> after changes can become a patch.
 *
 * A side is `{ files: [{ path, size?, sha256? }], read(path) -> Buffer | null }`. A non-Git side
 * is `sideFromManifest(manifest.capture(...), read)`; any other source supplies its own
 * `files` and `read`. `read` returning null means "absent"; throwing means "cannot be read".
 *
 * `unchanged` by equal digests (step 3) trusts digests captured by JuQode itself (manifest.capture,
 * with size compared too). A caller feeding digests it did not compute is vouching for them.
 * `too_large` also means "too expensive to diff": a file whose differing middle exceeds the LCS
 * table (about 2000 fully rewritten lines per side) or 20000 lines is reported by digest only.
 * An empty file added/deleted is a header-only git-style patch ("new file mode"/"deleted file
 * mode"), because a hunkless ---/+++ pair is not applicable.
 *
 * Order of judgement, for each path, matters:
 *   1. unsafe path (absolute, `..`, NUL)        -> unavailable   (nothing is read)
 *   2. sensitive name, judged by exclude.js      -> sensitive_excluded (nothing is read, and no
 *      digest is recorded: a digest of a secret is still information about the secret)
 *   3. equal known digests                        -> unchanged     (nothing is read)
 *   4. otherwise bytes are read, hashed, and classified: too_large / binary / stored.
 * `binary` and `too_large` keep digests only — never a fake or truncated diff.
 *
 * Nothing is written here. Content-addressed blobs (sha256 of the bytes, of `stored` files only)
 * are RETURNED, and handed to `opts.sink.put(digest, buffer)` if the caller supplies one. The
 * default is no sink, so nothing ever lands in the project folder.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isExcludedPath } = require('./exclude');
const { SKIP_DIRS } = require('./manifest');
const gitMod = require('./git');

const PATCH_STATES = Object.freeze(['stored', 'unchanged', 'binary', 'too_large', 'sensitive_excluded', 'unavailable']);
const MAX_SIDE_BYTES = 1024 * 1024;        // per file, per side (planned G2 ceiling)
const MAX_PATCH_BYTES = 8 * 1024 * 1024;   // all patch bodies of one Run
const MAX_LINES = 20000;                   // per side
const MAX_DIFF_CELLS = 4000000;            // LCS table size, see lcs()
const CONTEXT = 3;

/* A row from before this feature has no patch evidence. It is `unavailable`, never inferred and
 * never backfilled; this is the one answer every reader should give for such a row. */
const stateOfRow = (row) => (row && PATCH_STATES.includes(row.patch_state) ? row.patch_state : 'unavailable');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);   // not localeCompare: must not vary by locale

/* Control characters (NUL, \n, \r, ...) are refused: a newline in a path would forge extra lines
 * in the `--- a/<path>` header of a stored patch. */
const safePath = (p) => typeof p === 'string' && p !== '' && !/[\x00-\x1f\x7f]/.test(p) && !p.includes('\\') &&
  !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').some((s) => s === '..' || s === '');

/** Non-Git side: the manifest lists paths/size/sha256, `read` supplies the bytes of that snapshot. */
const sideFromManifest = (manifest, read) => ({ files: manifest.files, read });

/* A reader may return, instead of a Buffer, `{ oversize: true, size, sha256 }`: the file is over
 * `maxBytes` and was NOT loaded. sha256 is computed by streaming (bounded memory) for the live
 * directory and for Git blobs (git.blobDigestAt). computePatch reports it
 * as too_large with that digest and never diffs it. */
const oversize = (size, sha256v) => ({ oversize: true, size, sha256: sha256v });

/* Hashes exactly `size` bytes (the fstat size) in bounded chunks. A file that grew is read only up
 * to `size`; a file that shrank (fewer bytes than fstat promised) throws `changed-during-read` ->
 * unavailable, so the reported size and digest always describe the same bytes. */
function streamDigest(fd, size) {
  const h = crypto.createHash('sha256');
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let got = 0;
  while (got < size) {
    const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - got), got);
    if (n <= 0) break;
    h.update(chunk.subarray(0, n)); got += n;
  }
  if (got !== size) throw new Error('changed-during-read');
  return h.digest('hex');
}

/** A live-directory reader. Refuses anything whose real path leaves `root` (symlink escape),
 *  lands in a manifest SKIP_DIR, is a hardlinked file, or is not a regular file.
 *  Hardlink policy: a regular file with st_nlink > 1 is `unavailable`. The name rule judges
 *  spellings, and a hardlink can give a secret a harmless name (`ln .env notes.txt`) that a
 *  realpath check cannot see; JuQode cannot tell which name is the "real" one, so it declines.
 *  Cost: a legitimately hardlinked file gets no patch (digest-less, truthful `unavailable`).
 *  Size policy: fstat on the OPEN fd decides before any read; > maxBytes streams a digest only. */
function fsReader(root) {
  const real = fs.realpathSync(root);
  return (rel, maxBytes = MAX_SIDE_BYTES) => {
    if (!safePath(rel)) throw new Error('unsafe-path');
    const abs = path.join(real, rel);
    let r;
    try { r = fs.realpathSync(abs); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    if (!r.startsWith(real + path.sep)) throw new Error('escapes-root');
    const realRel = path.relative(real, r).split(path.sep).join('/');
    /* The sensitive-name rule applies to where the path REALLY lands, not only to its spelling:
     * `link.txt -> .env` (or a symlinked directory holding one) must not read the secret. This
     * is decided from the real path alone — nothing has been opened yet. */
    if (isExcludedPath(realRel)) {
      throw Object.assign(new Error('sensitive-target'), { code: 'SENSITIVE' });
    }
    /* A link into .git / node_modules / build output etc. is not the user's file. */
    /* judged on the path RELATIVE to the project root, so a project that lives under /…/build/ is fine */
    if (realRel.split('/').some((s) => SKIP_DIRS.has(s))) throw new Error('skip-dir-target');
    const fd = fs.openSync(r, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile()) throw new Error('not-a-file');
      if (st.nlink > 1) throw new Error('hardlink');
      if (st.size > maxBytes) return oversize(st.size, streamDigest(fd, st.size));
      const buf = fs.readFileSync(fd);
      return buf.length > maxBytes ? oversize(buf.length, sha256(buf)) : buf;
    } finally { fs.closeSync(fd); }
  };
}

/** Git side over two refs produced by git.capture (JuQode-owned object dir, never the user's index).
 *  `paths` null = every path in the tree. Sensitive names ARE listed (so they surface as
 *  sensitive_excluded rows) but `read` throws SENSITIVE for them before any git call, so
 *  bytesAt/sizeAt/blobDigestAt are never called for them. Symlink (120000) and
 *  gitlink/submodule (160000) entries are listed but unavailable: their blob is not file content. */
function sideFromGit(root, store, ref, paths = null, { maxBytes = MAX_SIDE_BYTES } = {}) {
  const modes = gitMod.treeModes(root, store, ref);
  const want = paths === null ? [...modes.keys()] : paths.filter((p) => modes.has(p));
  const files = want.map((p) => ({ path: p }));
  const read = (p, max = maxBytes) => {
    if (!safePath(p)) throw new Error('unsafe-path');
    if (isExcludedPath(p)) throw Object.assign(new Error('sensitive-name'), { code: 'SENSITIVE' });
    if (!modes.has(p)) return null;
    if (modes.special.has(p)) throw new Error('special-mode');
    const size = gitMod.sizeAt(root, store, ref, p);
    if (size === null) throw new Error('unreadable');
    if (size > max) {
      const d = gitMod.blobDigestAt(root, store, ref, p);   // streamed, body never held in memory
      if (!d || d.bytes !== size) throw new Error('unreadable');
      return oversize(size, d.sha256);
    }
    const buf = gitMod.bytesAt(root, store, ref, p);
    if (buf === null) throw new Error('unreadable');   // listed in the tree but unreadable: never "absent"
    return buf;
  };
  return { files, read };
}

/** Before/after sides for a Git Run: only paths that differ between the two trees. */
function gitSides(root, store, beforeRef, afterRef, opts) {
  const changed = gitMod.changedPaths(root, store, beforeRef, afterRef);
  return { before: sideFromGit(root, store, beforeRef, changed, opts), after: sideFromGit(root, store, afterRef, changed, opts) };
}

/* Lines keep an end-of-line flag, so "a" and "a\n" are different lines (git's "\ No newline"). */
function toLines(text) {
  const parts = text.split('\n');
  const last = parts.pop();
  const lines = parts.map((s) => ({ s, eol: true }));
  if (last !== '') lines.push({ s: last, eol: false });
  return lines;
}
const key = (l) => (l.eol ? `${l.s}\n` : l.s);

/* Edit script by LCS after trimming the common head and tail. Time and memory are
 * O(n*m) of the DIFFERING middle only; above MAX_DIFF_CELLS this returns null and the caller
 * reports too_large instead of hanging. (Myers O(ND) would lift the ceiling; not needed at the
 * 1 MiB / 20000-line caps.) */
function lcs(a, b) {
  let h = 0;
  while (h < a.length && h < b.length && key(a[h]) === key(b[h])) h++;
  let t = 0;
  while (t < a.length - h && t < b.length - h && key(a[a.length - 1 - t]) === key(b[b.length - 1 - t])) t++;
  const n = a.length - h - t;
  const m = b.length - h - t;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return null;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = key(a[h + i]) === key(b[h + j]) ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops = [];
  for (let i = 0; i < h; i++) ops.push([' ', a[i]]);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && key(a[h + i]) === key(b[h + j])) { ops.push([' ', a[h + i]]); i++; j++; }
    else if (j >= m || (i < n && dp[(i + 1) * w + j] >= dp[i * w + j + 1])) { ops.push(['-', a[h + i]]); i++; }
    else { ops.push(['+', b[h + j]]); j++; }
  }
  for (let k = 0; k < t; k++) ops.push([' ', a[a.length - t + k]]);
  return ops;
}

function unified(p, aText, bText, hasA, hasB) {
  const ops = lcs(toLines(aText), toLines(bText));
  if (!ops) return null;
  /* An empty file added or deleted has no hunk, and a bare ---/+++ pair with no hunk is rejected
   * by `git apply`. The git-style extended header is the form that carries it. */
  if (!ops.length && hasA !== hasB) {
    return `diff --git a/${p} b/${p}\n${hasB ? 'new' : 'deleted'} file mode 100644\n`;
  }
  let out = `--- ${hasA ? `a/${p}` : '/dev/null'}\n+++ ${hasB ? `b/${p}` : '/dev/null'}\n`;
  const near = ops.map(() => false);
  ops.forEach(([c], i) => {
    if (c === ' ') return;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) near[k] = true;
  });
  const aNo = [];
  const bNo = [];
  let ca = 1;
  let cb = 1;
  ops.forEach(([c]) => { aNo.push(ca); bNo.push(cb); if (c !== '+') ca++; if (c !== '-') cb++; });
  for (let i = 0; i < ops.length;) {
    if (!near[i]) { i++; continue; }
    let e = i;
    while (e < ops.length && near[e]) e++;
    const seg = ops.slice(i, e);
    const na = seg.filter(([c]) => c !== '+').length;
    const nb = seg.filter(([c]) => c !== '-').length;
    out += `@@ -${na ? aNo[i] : aNo[i] - 1},${na} +${nb ? bNo[i] : bNo[i] - 1},${nb} @@\n`;
    for (const [c, l] of seg) out += `${c}${l.s}\n${l.eol ? '' : '\\ No newline at end of file\n'}`;
    i = e;
  }
  return out;
}

/* ignoreBOM: the BOM is kept as U+FEFF in the text, so a BOM-only change is a visible diff line
 * rather than a hunkless "stored" patch. */
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const decode = (buf) => { try { return utf8.decode(buf); } catch { return null; } };

/**
 * @param {{before:object, after:object}} sides  see the header for a side
 * @param {{maxSideBytes?:number, maxPatchBytes?:number, sink?:{put(digest:string, buf:Buffer):void}}} [opts]
 * @returns {{files:{path,change,patch_state,before_digest,after_digest,patch_text,bytes}[], blobs:{digest,bytes}[], patch_bytes:number}}
 */
function computePatch({ before, after }, opts = {}) {
  const maxSide = opts.maxSideBytes ?? MAX_SIDE_BYTES;
  const maxTotal = opts.maxPatchBytes ?? MAX_PATCH_BYTES;
  const meta = (side) => new Map((side.files || []).map((f) => [f.path, f]));
  const mb = meta(before);
  const ma = meta(after);
  const paths = [...new Set([...mb.keys(), ...ma.keys()])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const files = [];
  const blobs = new Map();
  let total = 0;

  for (const p of paths) {
    const fb = mb.get(p);
    const fa = ma.get(p);
    const change = !fb ? 'added' : !fa ? 'removed' : 'modified';
    const row = (patch_state, bd = null, ad = null, patch_text = null) =>
      ({ path: p, change, patch_state, before_digest: bd, after_digest: ad, patch_text,
         bytes: patch_text === null ? 0 : Buffer.byteLength(patch_text) });

    if (!safePath(p)) { files.push(row('unavailable')); continue; }
    if (isExcludedPath(p)) { files.push(row('sensitive_excluded')); continue; }
    if (fb && fa && fb.sha256 && fb.sha256 === fa.sha256 && fb.size === fa.size) {
      files.push(row('unchanged', fb.sha256, fa.sha256)); continue;
    }
    let bb = null;
    let ab = null;
    try {
      if (fb) bb = before.read(p, maxSide);
      if (fa) ab = after.read(p, maxSide);
    } catch (e) {
      if (e && e.code === 'SENSITIVE') files.push(row('sensitive_excluded'));
      else files.push(row('unavailable', fb?.sha256 ?? null, fa?.sha256 ?? null));
      continue;
    }
    if ((fb && !bb) || (fa && !ab)) { files.push(row('unavailable', fb?.sha256 ?? null, fa?.sha256 ?? null)); continue; }
    const dg = (x) => (x ? (x.oversize ? x.sha256 : sha256(x)) : null);
    const bd = dg(bb);
    const ad = dg(ab);
    if (bd !== null && bd === ad) { files.push(row('unchanged', bd, ad)); continue; }
    if ((bb && bb.oversize) || (ab && ab.oversize)) { files.push(row('too_large', bd, ad)); continue; }
    if ((bb && bb.length > maxSide) || (ab && ab.length > maxSide)) { files.push(row('too_large', bd, ad)); continue; }
    const bt = bb ? decode(bb) : '';
    const at = ab ? decode(ab) : '';
    if (bt === null || at === null || (bb && bb.includes(0)) || (ab && ab.includes(0))) {
      files.push(row('binary', bd, ad)); continue;
    }
    if (toLines(bt).length > MAX_LINES || toLines(at).length > MAX_LINES) { files.push(row('too_large', bd, ad)); continue; }
    const text = unified(p, bt, at, !!bb, !!ab);
    if (text === null || total + Buffer.byteLength(text) > maxTotal) { files.push(row('too_large', bd, ad)); continue; }
    total += Buffer.byteLength(text);
    if (bb) blobs.set(bd, bb);
    if (ab) blobs.set(ad, ab);
    files.push(row('stored', bd, ad, text));
  }

  const blobList = [...blobs].map(([digest, bytes]) => ({ digest, bytes })).sort((x, y) => (x.digest < y.digest ? -1 : 1));
  if (opts.sink) for (const b of blobList) opts.sink.put(b.digest, b.bytes);
  return { files: files.sort(byPath), blobs: blobList, patch_bytes: total };
}

module.exports = { computePatch, sideFromManifest, fsReader, sideFromGit, gitSides, stateOfRow, PATCH_STATES,
                   MAX_SIDE_BYTES, MAX_PATCH_BYTES };
