'use strict';
/* WBS-27 · Code Blocks — D-127, validated in `../evidence/planning/q01-code-block-validation.md`.
 *
 * A Code Block is **the innermost NAMED declaration containing a changed line**. Several hunks
 * inside one declaration become one block; a change outside any declaration is a hunk block.
 *
 * Two strategies, and which one a file gets is decided by the file, never by the model:
 *   S1  TS/JS/TSX/JSX/MJS/CJS — real declarations, from the TypeScript compiler API. If the
 *       parser reports syntax errors the WHOLE file falls back to S2, because a block derived
 *       from a broken parse is a unit nobody can trust.
 *   S2  everything else — hunk blocks, marked `unblocked` for the structured formats where
 *       "단위로 나누지 못함" is the honest answer and Raw is the way to read it.
 *
 * `19` §C5-B is explicit that an LLM may EXPLAIN a block and must never DEFINE one. Nothing in
 * this file asks anything; it reads the diff the app itself generated at a fixed `-U3`.
 */
const path = require('node:path');

/* S2 by policy: a structured format has no declarations to find, and pretending otherwise
 * would invent units. `19` §C5-B names these and sends them straight to Raw. */
const UNBLOCKED_EXT = new Set(['.json', '.yaml', '.yml', '.toml', '.md', '.ini', '.env', '.lock', '.xml', '.csv']);
/* `path.extname('.env.example')` is `.example`, and `.env.local` is `.local` — an extension
 * test alone misses every dotfile variant, which is most of the ones that matter here. */
const UNBLOCKED_PREFIX = ['.env', 'dockerfile', 'makefile', '.gitignore', '.npmrc', '.editorconfig'];
const S1_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

const MAX_DISPLAY_BYTES = 1024 * 1024;   // `19` §C5-B: > 1 MiB is Raw-only

/** The compiler API, if it is there. Its absence degrades S1 to S2 — it never fails a diff. */
function ts() {
  try { return require('typescript'); } catch { return null; }
}

/**
 * Git C-quotes a path that is not plain ASCII, and wraps it in quotes: `"a/\352\262\260..."`.
 * A Korean filename is the ordinary case for this product, not the exotic one.
 */
function unquotePath(raw) {
  if (!raw.startsWith('"')) return raw;
  const inner = raw.slice(1, raw.endsWith('"') ? -1 : undefined);
  const bytes = [];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== '\\') { bytes.push(inner.charCodeAt(i)); continue; }
    const oct = /^[0-7]{3}/.exec(inner.slice(i + 1));
    if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3; continue; }
    const esc = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 }[inner[i + 1]];
    bytes.push(esc ?? inner.charCodeAt(i + 1)); i += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Split a unified diff into per-file entries with their hunks.
 *
 * The header is parsed only for the FILE BOUNDARY. Which path a hunk belongs to comes from the
 * caller's own file list where one is given (`--name-only -z` from git plumbing) — because
 * `diff --git a/… b/…` cannot be split reliably: a directory named `a b` puts a second ` b/`
 * in the line, and a non-ASCII path is quoted and does not match a bare `a/` at all. When the
 * header IS the only source, it is unquoted and split from the right.
 *
 * The app generates the diff itself at a fixed `-U3` (D-127: S2 block identity depends on the
 * context width, so the width cannot be left to whoever produced the patch).
 *
 * @param {string} patch
 * @param {string[]} [names] the file paths, in patch order, from `diff-tree --name-only -z`
 */
function splitDiff(patch, names = null) {
  const files = [];
  let current = null;
  let seen = 0;
  for (const line of String(patch ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: names?.[seen] ?? headerPath(line), hunks: [], binary: false, lines: [] };
      seen += 1;
      files.push(current);
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (/^(GIT binary patch|Binary files )/.test(line)) { current.binary = true; continue; }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      current.hunks.push({
        beforeStart: Number(hunk[1]), beforeCount: Number(hunk[2] ?? 1),
        afterStart: Number(hunk[3]), afterCount: Number(hunk[4] ?? 1),
        lines: [],
      });
      continue;
    }
    const h = current.hunks.at(-1);
    if (h && /^[-+ \\]/.test(line)) h.lines.push(line);
  }
  return files;
}

/**
 * Last resort when no name list was given — the caller's `diff-tree -z` list is the real
 * authority (see `splitDiff`).
 *
 * Splitting on the LAST ` b/` is wrong for the same reason splitting on the first one is: a
 * path like `a b/c.js` puts ` b/` INSIDE both halves, and `diff --git a/a b/c.js b/a b/c.js`
 * then yields `c.js`. What is actually true of the header is that the two halves are IDENTICAL
 * whenever the change is not a rename — and this app's diff runs without `-M`, so it never is.
 * Split by that arithmetic first; only fall back to a search when the halves really differ.
 */
function headerPath(line) {
  const rest = line.slice('diff --git '.length);
  if (rest.startsWith('"')) {
    /* `"a/x" "b/x"` — two quoted halves */
    const close = rest.indexOf('" "');
    if (close !== -1) return unquotePath(rest.slice(close + 2)).replace(/^b\//, '');
  }
  if (rest.startsWith('a/')) {
    const n = (rest.length - 5) / 2;              // 'a/' + P + ' b/' + P
    if (Number.isInteger(n) && n > 0
        && rest.slice(2 + n, 5 + n) === ' b/' && rest.slice(2, 2 + n) === rest.slice(5 + n)) {
      return rest.slice(5 + n);
    }
  }
  const cut = rest.lastIndexOf(' b/');
  if (cut === -1) return rest.replace(/^a\//, '');
  return unquotePath(rest.slice(cut + 1)).replace(/^b\//, '');
}

/** The after-side line numbers a hunk ADDED. Context advances the counter and nothing more. */
function changedLines(hunk) {
  const out = [];
  let afterLine = hunk.afterStart;
  for (const l of hunk.lines) {
    /* `\ No newline at end of file` is a NOTE about the previous line, not a line. Counting it
     * put every later number one too high — a block then claimed a line the file does not have,
     * and the line that really changed was claimed by nobody. Files without a trailing newline
     * are ordinary. */
    if (l.startsWith('\\')) continue;
    /* D-127: 공백 줄만 바뀐 곳은 블록을 만들지 않는다. The line still ADVANCES the counter —
     * it exists in the file — it just does not claim a block. Reformatting a file otherwise
     * produced a block for every declaration it touched and nothing to read inside them. */
    if (l.startsWith('+')) { if (l.slice(1).trim() !== '') out.push(afterLine); afterLine += 1; continue; }
    if (l.startsWith('-')) continue;                 // no after-side line
    afterLine += 1;
  }
  return out;
}

/** …and the before-side ones, which is what a pure deletion changed. */
function deletedLines(hunk) {
  const out = [];
  let beforeLine = hunk.beforeStart;
  for (const l of hunk.lines) {
    if (l.startsWith('\\')) continue;                // see changedLines
    if (l.startsWith('-')) { if (l.slice(1).trim() !== '') out.push(beforeLine); beforeLine += 1; continue; }
    if (l.startsWith('+')) continue;
    beforeLine += 1;
  }
  return out;
}

/**
 * Every named declaration in a source file, with its line range and nesting depth.
 *
 * The order is the PARSE order — outermost first, since the walk is pre-order. It is not
 * innermost-first, and nothing here may rely on the order: `innermost()` is what picks the
 * containing declaration, and it does so by depth and span.
 *
 * @returns {{name:string, kind:string, start:number, end:number, depth:number, body:string}[]|null}
 *   null when the file cannot be parsed, or cannot be walked — the caller then uses S2 whole.
 */
function declarations(source, fileName) {
  const T = ts();
  if (!T) return null;
  /* Both the parse and the walk below are recursive, so a VALID file nested deeply enough
   * throws `RangeError: Maximum call stack size exceeded` — measured at 20 000 nested parens,
   * inside `createSourceFile` itself. Uncaught, that escaped to the IPC boundary and took the
   * whole change reader down for one file. S2-whole is what an unparseable file gets too. */
  let sf;
  try { sf = T.createSourceFile(fileName, source, T.ScriptTarget.Latest, true); }
  catch { return null; }
  /* `parseDiagnostics` is not public API but it is what tells us the parse was clean. A block
   * derived from a broken parse is a unit nobody can trust, so the file goes to S2 whole. */
  if (sf.parseDiagnostics?.length) return null;

  const out = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const walk = (node, depth) => {
    const name = declaredName(T, node);
    if (name) {
      out.push({
        name, kind: T.SyntaxKind[node.kind],
        start: lineOf(node.getStart(sf)), end: lineOf(node.getEnd()),
        depth,
        body: bodyText(T, sf, node, name),
      });
      depth += 1;
    }
    node.forEachChild((child) => walk(child, depth));
  };
  try { sf.forEachChild((child) => walk(child, 0)); } catch { return null; }
  return out;
}

/* `19` §C5-B's list: function · class · method · arrow-function const · interface · type ·
 * export const. Anonymous and computed names are deliberately NOT blocks — a unit needs a name
 * a person can point at. */
function declaredName(T, node) {
  const named = (n) => (n && T.isIdentifier(n) ? n.text : null);
  if (T.isFunctionDeclaration(node) || T.isClassDeclaration(node)) return named(node.name);
  if (T.isMethodDeclaration(node) || T.isPropertyDeclaration(node)) return named(node.name);
  /* 메서드 also means the accessor pair and the constructor. A getter is where a class's
   * behaviour most often changes, and it was landing in the module-level hunk block. */
  if (T.isGetAccessorDeclaration(node) || T.isSetAccessorDeclaration(node)) return named(node.name);
  if (T.isConstructorDeclaration(node)) return 'constructor';
  if (T.isInterfaceDeclaration(node) || T.isTypeAliasDeclaration(node) || T.isEnumDeclaration(node)) return named(node.name);
  /* `const handler = { onSave: () => {...} }` — the arrow IS the unit a person points at, and
   * `19` §C5-B's 화살표 함수 상수 does not stop at the module level. Without this the change
   * was attributed to whatever contained the object, or to no declaration at all. */
  if (T.isPropertyAssignment(node) && isFunctionLike(T, node.initializer)) return named(node.name);
  if (T.isVariableDeclaration(node)) {
    if (isFunctionLike(T, node.initializer)) return named(node.name);
    /* `export const` is on `19` §C5-B's list in its own right — the exported config object is
     * a unit whether or not it holds a function. A private local const is not. */
    if (isExported(T, node)) return named(node.name);
  }
  return null;
}

const isFunctionLike = (T, n) => Boolean(n) &&
  (T.isArrowFunction(n) || T.isFunctionExpression(n) || T.isClassExpression(n));

/** `export const x = …` — the modifier sits on the VariableStatement, two levels up. */
function isExported(T, decl) {
  const stmt = decl.parent?.parent;
  if (!stmt || !T.isVariableStatement(stmt)) return false;
  return Boolean(stmt.modifiers?.some((m) => m.kind === T.SyntaxKind.ExportKeyword));
}

/**
 * The declaration's text with its NAME removed — the hash a rename is derived from (A-14).
 *
 * Replacement is by IDENTIFIER TOKEN, from the AST, not by substring. `text.split(name)` tore
 * `function` apart when the declaration was named `f`, so two unrelated one-letter functions
 * hashed alike and the reader claimed a rename that never happened. A word-boundary regex is
 * no better: `\b` is ASCII-only, and a Korean identifier is the ordinary case here.
 */
function bodyText(T, sf, node, name) {
  const start = node.getStart(sf);
  const spans = [];
  const scan = (n) => {
    if (T.isIdentifier(n) && n.text === name) spans.push([n.getStart(sf) - start, n.getEnd() - start]);
    n.forEachChild(scan);
  };
  try { scan(node); } catch { /* same depth ceiling as the walk — fall back to the raw text */ }

  let text = sf.text.slice(start, node.getEnd());
  for (const [a, b] of spans.sort((x, y) => y[0] - x[0])) {
    text = text.slice(0, a) + '\u0000NAME\u0000' + text.slice(b);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Code blocks for one file's diff.
 *
 * @param {object} file        one entry from `splitDiff`
 * @param {object} sources     `{ before, after }` file contents, or nulls
 * @returns {{strategy:'S1'|'S2', blocks:object[], note:string|null}}
 */
function blocksFor(file, sources = {}) {
  const ext = path.extname(file.path).toLowerCase();

  if (file.binary) return { strategy: 'S2', blocks: [], note: 'undisplayable' };
  /* BYTES. `String.length` counts UTF-16 code units, so a 1 MiB Korean file measured ~350 K
   * and went to S1; `19` §C5-B's threshold is a size on disk. */
  const bytes = (t) => (t == null ? 0 : Buffer.byteLength(t, 'utf8'));
  const size = Math.max(bytes(sources.after), bytes(sources.before));
  if (size > MAX_DISPLAY_BYTES) return { strategy: 'S2', blocks: [], note: 'too-large' };

  if (S1_EXT.has(ext)) {
    /* No file content to parse is not a parse failure either — a non-Git basis cannot produce
     * before/after text at all, and calling that `parse-failed` blamed the user's file. */
    if (sources.after == null && sources.before == null) {
      return { strategy: 'S2', blocks: hunkBlocks(file), note: 'no-source' };
    }
    const semantic = semanticBlocks(file, sources);
    if (semantic) return { strategy: 'S1', blocks: semantic, note: null };
    /* A parse we cannot trust is not a reason to invent units — the file goes to S2 whole.
     * `no-parser` is a DIFFERENT fact from `parse-failed`: one says this file has a syntax
     * error, the other says JuQode shipped without the compiler. Reporting the install problem
     * as a defect in the user's code sends them to debug the wrong thing. */
    return { strategy: 'S2', blocks: hunkBlocks(file), note: ts() ? 'parse-failed' : 'no-parser' };
  }

  return {
    strategy: 'S2',
    blocks: hunkBlocks(file),
    note: isUnblocked(file.path, ext) ? 'unblocked' : null,
  };
}

function semanticBlocks(file, sources) {
  const after = sources.after == null ? null : declarations(sources.after, file.path);
  const before = sources.before == null ? null : declarations(sources.before, file.path);
  /* D-127: `parseDiagnostics` 가 있으면 파일 전체를 S2 로. EITHER side failing is enough — a
   * block whose two sides were derived from a trusted parse and an untrusted one is a unit
   * built half from evidence and half from a guess. */
  if (sources.after != null && after === null) return null;
  if (sources.before != null && before === null) return null;
  if (after === null && before === null) return null;

  const byName = new Map();
  /* Before- and after-side line numbers are kept APART. Pooling them put a deleted line from
   * the old file into the same list as an added line from the new one, so a block reported
   * lines that do not both exist in any single version of the file. */
  const touch = (decl, side, line) => {
    if (!decl) return;
    const key = `${decl.name}#${decl.kind}`;
    const found = byName.get(key) ?? { name: decl.name, kind: decl.kind, afterLines: [], beforeLines: [] };
    (side === 'after' ? found.afterLines : found.beforeLines).push(line);
    byName.set(key, found);
  };

  /* Which hunks had a change that fell OUTSIDE every declaration. Only those become hunk
   * blocks — emitting one per hunk duplicated lines a declaration had already claimed. */
  const outsideHunks = new Map();
  const outside = (hunk, side, line) => {
    const found = outsideHunks.get(hunk) ?? { hunk, afterLines: [], beforeLines: [] };
    (side === 'after' ? found.afterLines : found.beforeLines).push(line);
    outsideHunks.set(hunk, found);
  };

  for (const hunk of file.hunks) {
    for (const line of changedLines(hunk)) {
      const d = innermost(after, line);
      if (d) touch(d, 'after', line); else outside(hunk, 'after', line);
    }
    for (const line of deletedLines(hunk)) {
      const d = innermost(before, line);
      if (d) touch(d, 'before', line); else outside(hunk, 'before', line);
    }
  }

  const afterNames = new Set((after ?? []).map((d) => `${d.name}#${d.kind}`));
  const beforeNames = new Set((before ?? []).map((d) => `${d.name}#${d.kind}`));

  const sorted = (xs) => [...new Set(xs)].sort((x, y) => x - y);
  const blocks = [...byName.entries()].map(([key, b]) => ({
    name: b.name,
    kind: b.kind,
    change: !beforeNames.has(key) ? 'add' : !afterNames.has(key) ? 'delete' : 'modify',
    afterLines: sorted(b.afterLines),
    beforeLines: sorted(b.beforeLines),
  }));

  /* Changes outside every declaration — imports, module-level statements — are hunk blocks,
   * exactly as `19` §C5-B says. They are real changes and must not vanish, and they carry only
   * the lines no declaration claimed. */
  for (const [hunk, o] of outsideHunks) {
    blocks.push({
      name: null, kind: 'hunk', change: 'modify', outsideDeclaration: true,
      afterLines: sorted(o.afterLines), beforeLines: sorted(o.beforeLines),
      beforeStart: hunk.beforeStart, afterStart: hunk.afterStart,
    });
  }

  /* A rename REPLACES the add and the delete it was derived from.
   *
   * They used to be concatenated, so one edit produced three blocks — `newName 추가`,
   * `oldName 삭제` and `newName 이름변경` — telling the reader three things happened when one
   * did, and counting three units where `19` §C5-B has one. The pair is not additional
   * evidence for the rename; it is the same fact, stated before it was understood. */
  const renamed = renames(before, after, blocks);
  const consumed = new Set();
  for (const r of renamed) {
    consumed.add(`add#${r.name}#${r.kind}`);
    consumed.add(`delete#${r.from}#${r.kind}`);
  }
  return blocks.filter((b) => !consumed.has(`${b.change}#${b.name}#${b.kind}`)).concat(renamed);
}

/**
 * A rename is claimed ONLY when it is derivable (A-14): same file, identical body once the name
 * token is removed, same SyntaxKind, and the name is absent from the other side. If the body
 * also changed it is a delete plus an add, and saying "renamed" would be a guess.
 */
function renames(before, after, blocks) {
  if (!before || !after) return [];
  const added = blocks.filter((b) => b.change === 'add');
  const removed = blocks.filter((b) => b.change === 'delete');
  const out = [];
  const claimed = new Set();
  for (const a of added) {
    const aDecl = after.find((d) => d.name === a.name && d.kind === a.kind);
    for (const r of removed) {
      /* One removed declaration can only have been renamed into ONE thing. Without this, two
       * added declarations with the same body both claimed the same deletion. */
      if (claimed.has(r.name)) continue;
      const rDecl = before.find((d) => d.name === r.name && d.kind === r.kind);
      if (!aDecl || !rDecl) continue;
      if (aDecl.kind !== rDecl.kind) continue;
      if (aDecl.body !== rDecl.body) continue;                  // the body moved too → not a rename
      if (after.some((d) => d.name === rDecl.name)) continue;    // the old name still exists
      out.push({ name: a.name, kind: a.kind, change: 'rename', from: r.name,
                 afterLines: a.afterLines, beforeLines: r.beforeLines });
      claimed.add(r.name);
      break;                                   // this addition is accounted for
    }
  }
  return out;
}

function isUnblocked(filePath, ext) {
  if (UNBLOCKED_EXT.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  return UNBLOCKED_PREFIX.some((p) => base === p || base.startsWith(`${p}.`));
}

const innermost = (decls, line) => {
  if (!decls) return null;
  let best = null;
  for (const d of decls) {
    if (line < d.start || line > d.end) continue;
    if (!best || d.depth > best.depth || (d.end - d.start) < (best.end - best.start)) best = d;
  }
  return best;
};

const hunkBlocks = (file) => file.hunks
  .map((h, i) => ({
    name: null, kind: 'hunk', change: 'modify', ord: i,
    afterLines: changedLines(h), beforeLines: deletedLines(h),
    beforeStart: h.beforeStart, afterStart: h.afterStart,
  }))
  /* Same D-127 rule one level up: a hunk left with no claiming line changed only whitespace. */
  .filter((b) => b.afterLines.length || b.beforeLines.length);

module.exports = { splitDiff, blocksFor, declarations, changedLines, deletedLines, isUnblocked,
                   MAX_DISPLAY_BYTES, UNBLOCKED_EXT, S1_EXT };
