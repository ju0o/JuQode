/* WBS-18 result & claims · WBS-27 code blocks.
 *
 * D-127's rules are about EVIDENCE, not wording: a block is the innermost named declaration
 * containing a changed line, a rename is claimed only when it is derivable, and a parse we
 * cannot trust sends the whole file to hunks rather than inventing units.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const { code: srcOf, text: rawOf } = require(path.join(__dirname, 'src.js'));


/* One helper for the whole suite — see tests/tmp.js. Eight private copies each cleaned up
 * only in `process.on('exit')`, which a killed run never reaches; the leftovers filled the
 * tmpfs and made the suite flaky in a different place every run. */
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const B = require(path.join(R, 'app/main/change/blocks.js'));
const result = require(path.join(R, 'app/main/work/result.js'));
const { KIND } = require(path.join(R, 'app/main/work/reducer.js'));

/**
 * A REAL unified diff at the fixed `-U3` the app itself uses (D-127: S2 block identity depends
 * on the context width, so the width cannot be left to whoever produced the patch).
 *
 * A hand-built whole-file hunk was the first attempt and it made every line "changed", so an
 * untouched sibling declaration looked touched — the fixture, not the code, was wrong.
 */
function diffOf(file, before, after) {
  const dir = tempDir('juqode-diff-');
  const A = path.join(dir, 'a'); const Bd = path.join(dir, 'b');
  fs.mkdirSync(path.join(A, path.dirname(file)), { recursive: true });
  fs.mkdirSync(path.join(Bd, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(A, file), before);
  fs.writeFileSync(path.join(Bd, file), after);
  let out = '';
  try {
    execFileSync('git', ['diff', '--no-index', '-U3', '--no-color', '--', path.join(A, file), path.join(Bd, file)],
      { encoding: 'utf8' });
  } catch (e) { out = e.stdout ?? ''; }        // git exits 1 when there IS a difference
  /* Rewrite the temp paths to the logical one so the fixture does not depend on where it ran. */
  return out.split('\n').map((l) => l.replace(new RegExp(`(a|b)${A.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${A.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${Bd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), ''))
    .map((l) => (l.startsWith('diff --git') ? `diff --git a/${file} b/${file}` : l))
    .join('\n');
}

const only = (blocks, change) => blocks.filter((x) => x.change === change).map((x) => x.name).filter(Boolean).sort();

/* ───────────────────────── WBS-27 · segmentation ───────────────────────── */

test('a block is the innermost NAMED declaration containing a changed line', () => {
  const before = `export class Service {
  read() {
    return 1;
  }
  write() {
    return 2;
  }
}
`;
  const after = `export class Service {
  read() {
    return 99;
  }
  write() {
    return 2;
  }
}
`;
  const file = B.splitDiff(diffOf('src/s.ts', before, after))[0];
  const r = B.blocksFor(file, { before, after });
  assert.strictEqual(r.strategy, 'S1');
  const touched = r.blocks.filter((x) => x.name && x.afterLines.length).map((x) => x.name);
  assert.ok(touched.includes('read'), `the changed method was not found: ${touched}`);
  assert.ok(!touched.includes('write'), 'an untouched sibling became a block');
});

test('every declaration kind Canon names becomes a block', () => {
  const before = 'const keep = 1;\n';
  const after = `const keep = 1;

export function fn() {
  return 1;
}

export class Cls {
  m() {
    return 1;
  }
}

export const arrow = () => 1;

export interface Iface {
  a: number;
}

export type Alias = string;

export enum E {
  A,
}
`;
  const file = B.splitDiff(diffOf('src/k.ts', before, after))[0];
  const names = B.blocksFor(file, { before, after }).blocks.map((x) => x.name).filter(Boolean);
  for (const want of ['fn', 'Cls', 'arrow', 'Iface', 'Alias', 'E']) {
    assert.ok(names.includes(want), `${want} did not become a block: ${names}`);
  }
});

test('an added declaration is 추가, a removed one is 삭제', () => {
  const before = 'export function gone() { return 1; }\n';
  const after = 'export function fresh() { return 2; }\n';
  const file = B.splitDiff(diffOf('src/x.ts', before, after))[0];
  const blocks = B.blocksFor(file, { before, after }).blocks;
  assert.deepStrictEqual(only(blocks, 'add'), ['fresh']);
  assert.deepStrictEqual(only(blocks, 'delete'), ['gone']);
});

test('a rename REPLACES the add and delete it was derived from', () => {
  /* FOUND while writing the multi-declaration test above. `renames()` was CONCATENATED onto the
   * blocks it was derived from, so one edit produced three:
   *
   *     newName 추가 · oldName 삭제 · newName 이름변경
   *
   * That tells the reader three things happened when one did, and `19` §C5-B counts one unit,
   * not three. The pair is not additional evidence for the rename — it is the same fact, stated
   * before it was understood. */
  const before = 'export function oldName(a) {\n  return a + 1;\n}\n';
  const after = 'export function newName(a) {\n  return a + 1;\n}\n';
  const file = B.splitDiff(diffOf('src/rrep.ts', before, after))[0];
  const blocks = B.blocksFor(file, { before, after }).blocks;

  assert.deepStrictEqual(blocks.map((b) => [b.name, b.change]), [['newName', 'rename']],
    `one rename produced ${JSON.stringify(blocks.map((b) => [b.name, b.change]))}`);
  /* The rename carries BOTH sides' lines, so nothing the pair knew is lost. */
  assert.ok(blocks[0].afterLines.length, 'the rename lost the added lines');
  assert.ok(blocks[0].beforeLines.length, 'the rename lost the removed lines');
});

test('one deletion cannot be renamed into two things', () => {
  /* Two added declarations with the SAME body as one removed one. Without a claim, both matched
   * it and the card showed the same deletion becoming two different functions. */
  const before = 'export function gone(a) {\n  return a + 1;\n}\n';
  const after = [
    'export function alpha(a) {',
    '  return a + 1;',
    '}',
    '',
    'export function beta(a) {',
    '  return a + 1;',
    '}',
    '',
  ].join('\n');
  const file = B.splitDiff(diffOf('src/rtwo.ts', before, after))[0];
  const blocks = B.blocksFor(file, { before, after }).blocks;
  const claimed = blocks.filter((b) => b.change === 'rename');
  assert.ok(claimed.length <= 1, `${claimed.length} renames claim the same deletion`);
  /* …and whichever was not the rename is still reported — an addition does not vanish. */
  const names = new Set(blocks.map((b) => b.name));
  assert.ok(names.has('alpha') && names.has('beta'),
    `an added declaration disappeared: ${JSON.stringify([...names])}`);
});

test('a rename is claimed ONLY when it is derivable (A-14)', () => {
  /* Same body once the name token is removed, same kind, old name absent from the other side. */
  const before = 'export function oldName(a) {\n  return a + 1;\n}\n';
  const after = 'export function newName(a) {\n  return a + 1;\n}\n';
  const file = B.splitDiff(diffOf('src/r.ts', before, after))[0];
  const renamed = B.blocksFor(file, { before, after }).blocks.find((x) => x.change === 'rename');
  assert.ok(renamed, 'a pure rename was not detected');
  assert.strictEqual(renamed.from, 'oldName');
  assert.strictEqual(renamed.name, 'newName');
});

test('a rename is found among SEVERAL declarations, not just in a file of one', () => {
  /* FOUND BY MUTATION: `after.find((d) => d.name === a.name && d.kind === a.kind)` could become
   * `||` and every rename test passed — each of them has exactly ONE declaration per side, so
   * `find` returns the same node whichever predicate it uses.
   *
   * A real file has several. Matching on name OR kind picks whichever function comes first,
   * whose body is different, and the rename is silently not claimed — the card then says a
   * function was DELETED and another ADDED, which is a different (and wrong) story about what
   * the user's change did. */
  const before = [
    'export function keepMe(a) {',
    '  return a * 2;',
    '}',
    '',
    'export function oldName(a) {',
    '  return a + 1;',
    '}',
    '',
    'export function alsoKeep(b) {',
    '  return b - 3;',
    '}',
    '',
  ].join('\n');
  const after = before.replace('oldName', 'newName');
  const file = B.splitDiff(diffOf('src/rmulti.ts', before, after))[0];
  const blocks = B.blocksFor(file, { before, after }).blocks;

  const renamed = blocks.find((x) => x.change === 'rename');
  assert.ok(renamed, `no rename among ${blocks.length} blocks: ${JSON.stringify(blocks.map((b) => [b.name, b.change]))}`);
  assert.strictEqual(renamed.from, 'oldName');
  assert.strictEqual(renamed.name, 'newName');
  /* …and the declarations that did not move are not reported as anything. */
  assert.deepStrictEqual(blocks.filter((x) => x.change !== 'rename').map((x) => x.name), [],
    'an untouched declaration was reported as changed');
});

test('a bare local const is not a unit; an exported one is', () => {
  /* FOUND BY MUTATION: `isExported` could be made to answer `true` for everything, and both of
   * its guards could be loosened, with the suite passing throughout.
   *
   * `19` §C5-B puts `export const` on the list in its own right — an exported config object is
   * something a person points at. A private local const is not, and treating every local as a
   * block would bury the declaration that actually changed under a list of temporaries. */
  const withLocal = (decl) => [
    'export function run() {',
    `  ${decl}`,
    '  return 1;',
    '}',
    '',
  ].join('\n');
  const before = withLocal('const helper = 1;');
  const after = withLocal('const helper = 2;');
  const file = B.splitDiff(diffOf('src/loc.ts', before, after))[0];
  const names = B.blocksFor(file, { before, after }).blocks.map((b) => b.name);
  assert.deepStrictEqual(names, ['run'],
    `a local const became its own block: ${JSON.stringify(names)}`);

  /* …and an exported const at module level IS one. */
  const b2 = 'export const CONFIG = { retries: 1 };\n';
  const a2 = 'export const CONFIG = { retries: 2 };\n';
  const f2 = B.splitDiff(diffOf('src/cfg.ts', b2, a2))[0];
  assert.deepStrictEqual(B.blocksFor(f2, { before: b2, after: a2 }).blocks.map((b) => b.name), ['CONFIG'],
    'an exported const is a unit `19` §C5-B names by itself');
});

test('the old name still existing means it is an add, not a rename', () => {
  const before = 'export function oldName(a) {\n  return a + 1;\n}\n';
  const after = 'export function oldName(a) {\n  return a + 1;\n}\n\nexport function newName(a) {\n  return a + 1;\n}\n';
  const file = B.splitDiff(diffOf('src/r3.ts', before, after))[0];
  const blocks = B.blocksFor(file, { before, after }).blocks;
  assert.ok(!blocks.some((x) => x.change === 'rename'),
    'the old name is still there, so nothing was renamed — a copy is not a rename');
  assert.deepStrictEqual(only(blocks, 'add'), ['newName']);
});

test('a rename is not claimed across different declaration kinds', () => {
  const before = 'export function thing(a) {\n  return a;\n}\n';
  const after = 'export const thing2 = (a) => {\n  return a;\n};\n';
  const file = B.splitDiff(diffOf('src/r4.ts', before, after))[0];
  assert.ok(!B.blocksFor(file, { before, after }).blocks.some((x) => x.change === 'rename'),
    'a function became an arrow constant — same body is not enough to call that a rename');
});

test('a rename is never claimed when only one side could be parsed', () => {
  const before = 'export function oldName(a) {\n  return a + 1;\n}\n';
  const after = 'export function newName(a) {\n  return a + 1;\n}\n';
  const file = B.splitDiff(diffOf('src/r5.ts', before, after))[0];
  /* with no before source there is nothing to have been renamed FROM */
  const oneSided = B.blocksFor(file, { after });
  assert.ok(!oneSided.blocks.some((x) => x.change === 'rename'),
    'a rename was claimed with only one side of the comparison');
});

test('a rename whose BODY also changed falls back to 삭제 + 추가', () => {
  const before = 'export function oldName(a) {\n  return a + 1;\n}\n';
  const after = 'export function newName(a) {\n  return a + 999;\n}\n';
  const file = B.splitDiff(diffOf('src/r2.ts', before, after))[0];
  const blocks = B.blocksFor(file, { before, after }).blocks;
  assert.ok(!blocks.some((x) => x.change === 'rename'),
    'the body moved too, so calling it a rename would be a guess');
  assert.deepStrictEqual(only(blocks, 'add'), ['newName']);
  assert.deepStrictEqual(only(blocks, 'delete'), ['oldName']);
});

test('a hunk block carries ONLY the lines no declaration claimed', () => {
  /* The bug this replaces emitted a hunk block per hunk whenever ANY line fell outside a
   * declaration, duplicating lines a declaration already owned. The buggy version also set the
   * `outsideDeclaration` flag, so asserting the flag proved nothing — the LINES are the fix. */
  const before = "import a from 'a';\n\nexport function fn() {\n  return 1;\n}\n";
  const after = "import a from 'a';\nimport b from 'b';\n\nexport function fn() {\n  return 99;\n}\n";
  const file = B.splitDiff(diffOf('src/i.ts', before, after))[0];
  const blocks = B.blocksFor(file, { before, after }).blocks;

  const hunks = blocks.filter((x) => x.kind === 'hunk');
  const fn = blocks.find((x) => x.name === 'fn');
  assert.ok(hunks.length > 0, 'a module-level change produced no block at all');
  assert.ok(fn, 'the changed function produced no block');
  assert.ok(hunks.every((h) => h.outsideDeclaration));

  const hunkLines = new Set(hunks.flatMap((h) => h.afterLines));
  assert.ok(hunkLines.size > 0, 'the hunk block carries no lines at all');
  for (const l of fn.afterLines) {
    assert.ok(!hunkLines.has(l), `line ${l} is claimed by both fn and a hunk block`);
  }
});

test('before- and after-side line numbers are kept APART', () => {
  /* Pooling them put a deleted line from the old file into the same list as an added line from
   * the new one, so a block reported lines that do not both exist in any single version. The
   * fixture inserts a line ABOVE the declaration so the two sides genuinely differ. */
  const before = 'export function fn() {\n  return 1;\n}\n';
  const after = "import x from 'x';\n\nexport function fn() {\n  return 2;\n}\n";
  const file = B.splitDiff(diffOf('src/pool.ts', before, after))[0];
  const fn = B.blocksFor(file, { before, after }).blocks.find((b) => b.name === 'fn');

  assert.deepStrictEqual(fn.afterLines, [4], 'the after-side line the change landed on');
  assert.deepStrictEqual(fn.beforeLines, [2], 'the before-side line it replaced');
  assert.ok(!fn.afterLines.some((l) => fn.beforeLines.includes(l)),
    'the two sides were pooled — the block reports lines from two different files as one list');
});

test('a file we cannot parse goes to hunks WHOLE — no invented units', () => {
  const before = 'export function fn() { return 1; }\n';
  const after = 'export function fn( { return 1;\n';           // deliberately broken
  const file = B.splitDiff(diffOf('src/b.ts', before, after))[0];
  const r = B.blocksFor(file, { before, after });
  assert.strictEqual(r.strategy, 'S2');
  assert.strictEqual(r.note, 'parse-failed');
  assert.ok(r.blocks.every((x) => x.kind === 'hunk'),
    'a block was derived from a parse we could not trust');
});

test('structured formats are honestly 단위로 나누지 못함, not fake units', () => {
  for (const file of ['package.json', 'config.yaml', 'notes.md', 'Cargo.toml', '.env.example', 'data.csv']) {
    const f = B.splitDiff(diffOf(file, 'a: 1\n', 'a: 2\n'))[0];
    const r = B.blocksFor(f, { before: 'a: 1\n', after: 'a: 2\n' });
    assert.strictEqual(r.strategy, 'S2', file);
    assert.strictEqual(r.note, 'unblocked', `${file} pretended to have units`);
  }
});

test('a dotfile variant is caught too — extname alone misses every one of them', () => {
  /* `path.extname('.env.example')` is `.example`, and `.env.local` is `.local`. */
  for (const f of ['.env', '.env.local', '.env.example', '.env.production', 'Dockerfile', 'Makefile', '.gitignore']) {
    assert.strictEqual(B.isUnblocked(f, path.extname(f)), true, `${f} was not treated as 단위로 나누지 못함`);
  }
  for (const f of ['src/env.ts', 'environment.js', 'src/a.tsx']) {
    assert.strictEqual(B.isUnblocked(f, path.extname(f)), false, `${f} was wrongly sent straight to Raw`);
  }
});

test('a parse failure on EITHER side sends the whole file to hunks', () => {
  /* A block whose two sides came from a trusted parse and an untrusted one is a unit built
   * half from evidence and half from a guess. */
  const ok = 'export function fn() {\n  return 1;\n}\n';
  const broken = 'export function fn( {\n  return 1;\n';
  for (const [before, after] of [[ok, broken], [broken, ok]]) {
    const f = B.splitDiff(diffOf('src/p.ts', before, after))[0];
    const r = B.blocksFor(f, { before, after });
    assert.strictEqual(r.strategy, 'S2');
    assert.strictEqual(r.note, 'parse-failed');
  }
});

test('binary and oversized files are undisplayable, and say so', () => {
  const bin = B.splitDiff('diff --git a/i.png b/i.png\nGIT binary patch\nliteral 10\n')[0];
  assert.strictEqual(B.blocksFor(bin, {}).note, 'undisplayable');

  /* Pinned to Canon's literal number, not to the constant under test — a fixture sized from
   * the constant passes for any value it is given. */
  assert.strictEqual(B.MAX_DISPLAY_BYTES, 1024 * 1024, '`19` §C5-B: Raw-only above 1 MiB');
  const big = 'x'.repeat(1024 * 1024 + 1);
  const f = B.splitDiff(diffOf('src/huge.ts', 'a\n', 'b\n'))[0];
  assert.strictEqual(B.blocksFor(f, { before: big, after: big }).note, 'too-large');
  /* Either side being oversized is enough — the pair has to be readable, not just one of them. */
  assert.strictEqual(B.blocksFor(f, { before: big, after: 'a\n' }).note, 'too-large');
  assert.strictEqual(B.blocksFor(f, { before: 'a\n', after: big }).note, 'too-large');
});

test('the segmenter never asks anything — it only reads the diff', () => {
  /* `19` §C5-B: an LLM may EXPLAIN a block and must never DEFINE one. The unit has to be
   * derivable from the file, or the user cannot check it. */
  const src = srcOf('app/main/change/blocks.js');
  for (const forbidden of ['claude', 'session.run', 'spawn(', 'fetch(', 'execFile']) {
    assert.ok(!src.includes(forbidden), `the segmenter reaches for ${forbidden} — a unit must be derived, not asked for`);
  }
});

test('a name list that does not match the patch is DROPPED, never zipped by index', () => {
  /* FOUND BY MUTATION in `supervisor.saveDiffs`: `zipped.length === names.length` could be
   * inverted, so the authoritative name list would be used exactly when it does NOT describe
   * the same patch — and every file's diff would be filed under another file's name.
   *
   * The two git calls (`diff` and `diff-tree --name-only`) exist to agree; `19` §C5-B and the
   * batch-06 review are about what happens when two parsers read one patch differently. If
   * they ever disagree on how many files there are, zipping BY INDEX is the one thing that must
   * not happen — a card would then attribute a change to a file that did not change. */
  const patch = [
    'diff --git a/one.ts b/one.ts', '@@ -1 +1 @@', '-a', '+b',
    'diff --git a/two.ts b/two.ts', '@@ -1 +1 @@', '-c', '+d',
  ].join('\n');

  /* Agreeing: the names win, which is what makes exotic paths right. */
  const agreed = B.splitDiff(patch, ['첫.ts', '둘.ts']);
  assert.deepStrictEqual(agreed.map((f) => f.path), ['첫.ts', '둘.ts']);

  /* Disagreeing — the supervisor's guard is `zipped.length === names.length`, and this is the
   * shape it is guarding against. Zipped by index, `two.ts`'s diff would be labelled `첫.ts`. */
  const short = B.splitDiff(patch, ['첫.ts']);
  assert.strictEqual(short.length, 2, 'the patch still has two files whatever the name list says');
  assert.notStrictEqual(short.length, ['첫.ts'].length,
    'the length check the supervisor makes must be able to see this disagreement');
  /* …and the fallback — no names at all — reads each header, which is right about WHICH file
   * even when it is wrong about an exotic name. */
  assert.deepStrictEqual(B.splitDiff(patch).map((f) => f.path), ['one.ts', 'two.ts']);
});

test('a path that itself contains " b/" is still read correctly', () => {
  /* FOUND BY MUTATION: the equal-halves arithmetic in `headerPath` — the branch that exists
   * BECAUSE `lastIndexOf(' b/')` gets a path wrong — had no test of its own. Both of its `&&`
   * clauses could be loosened to `||` and everything passed.
   *
   * `diff --git a/x b/y b/x b/y` is one file whose name is `x b/y`. Reading it with the last
   * ` b/` gives `y`, and the card would then attribute a change to a file that does not exist
   * while the file that DID change goes unmentioned. `19` §C5-B: the unit has to be derivable
   * from the diff, and a path is the first thing derived. */
  const odd = 'x b/y.ts';
  const f = B.splitDiff([`diff --git a/${odd} b/${odd}`, '@@ -1 +1 @@', '-a', '+b'].join('\n'))[0];
  assert.strictEqual(f.path, odd, `a path containing " b/" was read as ${JSON.stringify(f.path)}`);

  /* The same halves-equal shortcut must NOT fire for a genuine rename, where the halves differ
   * — that is what the length check and the comparison are for. */
  const renamed = B.splitDiff(['diff --git a/one.ts b/two.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n'))[0];
  assert.strictEqual(renamed.path, 'two.ts', 'a rename must be attributed to the AFTER name');

  /* …and a rename where the two names are the same LENGTH, which is where a check on length
   * alone would break. */
  const sameLen = B.splitDiff(['diff --git a/aaa.ts b/bbb.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n'))[0];
  assert.strictEqual(sameLen.path, 'bbb.ts');

  /* A quoted (C-escaped) Korean path, which is the ordinary case for this product. */
  const ko = B.splitDiff(['diff --git "a/\\355\\225\\234.ts" "b/\\355\\225\\234.ts"', '@@ -1 +1 @@', '-a', '+b'].join('\n'))[0];
  assert.strictEqual(ko.path, '한.ts', `a quoted Korean path was read as ${JSON.stringify(ko.path)}`);
});

test('a hunk header is read exactly as git wrote it', () => {
  /* The arithmetic is exported and was only ever exercised transitively, so an off-by-one on
   * the deleted side, a swapped before/after start, or a path taken from the `a/` side were
   * all invisible. This reads a literal hunk and states every number. */
  const f = B.splitDiff([
    'diff --git a/old.ts b/new.ts',
    '@@ -10,4 +20,5 @@',
    ' ctx',
    '-old',
    '+new',
    '+extra',
    ' ctx',
    '\\ No newline at end of file',
  ].join('\n'))[0];

  assert.strictEqual(f.path, 'new.ts', 'a block belongs to the AFTER path — a rename would attribute it wrongly');
  assert.strictEqual(f.hunks[0].beforeStart, 10);
  assert.strictEqual(f.hunks[0].afterStart, 20);
  assert.deepStrictEqual(B.changedLines(f.hunks[0]), [21, 22], 'after-side line numbers');
  assert.deepStrictEqual(B.deletedLines(f.hunks[0]), [11], 'before-side line numbers');
  assert.ok(!B.changedLines(f.hunks[0]).includes(24), '"\\ No newline at end of file" is not a line');
});

test('a hunk with no count, and one that is a pure addition or deletion', () => {
  const one = B.splitDiff('diff --git a/x.ts b/x.ts\n@@ -1 +1 @@\n-a\n+b\n')[0];
  assert.strictEqual(one.hunks[0].beforeCount, 1, '`@@ -1 +1 @@` means one line, not zero');
  assert.deepStrictEqual(B.changedLines(one.hunks[0]), [1]);
  assert.deepStrictEqual(B.deletedLines(one.hunks[0]), [1]);

  const added = B.splitDiff('diff --git a/x.ts b/x.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n')[0];
  assert.deepStrictEqual(B.changedLines(added.hunks[0]), [1, 2]);
  assert.deepStrictEqual(B.deletedLines(added.hunks[0]), []);

  const removed = B.splitDiff('diff --git a/x.ts b/x.ts\n@@ -5,2 +4,0 @@\n-five\n-six\n')[0];
  assert.deepStrictEqual(B.changedLines(removed.hunks[0]), []);
  assert.deepStrictEqual(B.deletedLines(removed.hunks[0]), [5, 6]);
});

test('line lists are deduplicated and in order', () => {
  const before = 'export function fn() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}\n';
  const after = 'export function fn() {\n  const a = 9;\n  const b = 8;\n  return a + b;\n}\n';
  const f = B.splitDiff(diffOf('src/o.ts', before, after))[0];
  const fn = B.blocksFor(f, { before, after }).blocks.find((b) => b.name === 'fn');
  assert.deepStrictEqual(fn.afterLines, [...new Set(fn.afterLines)].sort((x, y) => x - y),
    'the line list is unsorted or has duplicates');
  assert.ok(fn.afterLines.length >= 2);
});

/* ───────────────────────── WBS-18 · the result ───────────────────────── */

const finished = (over = {}) => ({
  outcome: 'complete', denials: [], finish: { text: '했어요', subtype: 'success' }, ...over,
});

test('only a measured fact can be 확인됨, and it names what it rests on', () => {
  const r = result.build({
    state: finished(),
    changes: { known: true, files: ['a.ts', 'b.ts'] },
    toolResults: 2,
  });
  const confirmed = r.claims.filter((c) => c.confidence === 'confirmed');
  assert.ok(confirmed.length >= 2);
  for (const c of confirmed) assert.ok(c.sourceRef, `a 확인됨 claim with no source: ${c.kind}`);
  assert.deepStrictEqual(result.verify(r), []);
});

test("Claude Code's own report is 예상됨 — nothing measured it", () => {
  const r = result.build({ state: finished(), changes: { known: true, files: [] } });
  const report = r.claims.find((c) => c.kind === 'agent-report');
  assert.strictEqual(report.confidence, 'expected',
    'the model said it, so D-114 says 예상됨 — 확인됨 would be a claim about evidence that does not exist');
  assert.strictEqual(report.data.text, '했어요', "the model's own words must be carried, not paraphrased");
});

test('a basis we could not compare is 확인 못함, never "nothing changed"', () => {
  const r = result.build({ state: finished(), changes: { known: false, files: [] } });
  const c = r.claims.find((x) => x.kind === 'changes-unknown');
  assert.ok(c, 'an uncomparable basis produced no claim at all');
  assert.strictEqual(c.confidence, 'unconfirmed');
  assert.ok(!r.claims.some((x) => x.kind === 'changed-files'),
    'a file list was reported for a comparison that never happened');
});

test('a 부분 result carries BOTH lists — 된 것 and 안 된 것', () => {
  const r = result.build({
    state: finished({ outcome: 'partial', denials: [{ tool: 'Edit', resolved: false, input: { file_path: 'x.ts' } }] }),
    changes: { known: true, files: ['a.ts'] },
  });
  assert.deepStrictEqual(result.verify(r), [], '`21` WBS-18: a partial result must have both lists');
  assert.ok(r.items.some((i) => i.kind === 'done'));
  const notDone = r.items.find((i) => i.kind === 'not_done');
  assert.strictEqual(notDone.data.tool, 'Edit');
  assert.strictEqual(notDone.data.target, 'x.ts', 'the refusal must say what it was about');
});

test('each acceptance rule is checked on its own, not only all at once', () => {
  /* A check that reports only when everything is wrong cannot tell you which rule broke —
   * and deleting any ONE of the three used to pass the whole suite. */
  const noDone = result.build({
    state: finished({ outcome: 'partial', denials: [{ tool: 'Edit', resolved: false, input: {} }] }),
    changes: { known: true, files: [] },
  });
  assert.deepStrictEqual(result.verify(noDone), ['partial result has no 된 것 list']);

  const noNotDone = result.build({
    state: finished({ outcome: 'partial', denials: [] }),
    changes: { known: true, files: ['a.ts'] },
  });
  assert.deepStrictEqual(result.verify(noNotDone), ['partial result has no 안 된 것 list']);

  assert.deepStrictEqual(
    result.verify({ claims: [{ kind: 'x', confidence: 'confirmed', sourceRef: null }], items: [], outcome: 'complete' }),
    ['claim x is 확인됨 with no source']);
});

test('a claim that cannot name its evidence is DOWNGRADED, not shipped as 확인됨', () => {
  /* `verify` was called only by the tests, so it guarded nothing in the product: an
   * unsupported 확인됨 would have reached the screen, and the chip is a promise. */
  const { result: out, problems } = result.buildChecked({
    state: finished(), changes: { known: true, files: ['a.ts'] },
  });
  assert.deepStrictEqual(problems, [], 'the ordinary path must not report a problem');

  const broken = result.buildChecked({
    state: finished(), changes: { known: true, files: ['a.ts'] },
  });
  broken.result.claims.push({ kind: 'invented', confidence: 'confirmed', sourceRef: null, data: null });
  const rechecked = result.verify(broken.result);
  assert.ok(rechecked.length > 0, 'an unsupported 확인됨 was not detected');
  assert.ok(out.claims.every((c) => c.confidence !== 'confirmed' || c.sourceRef));
});

test('a failure says which terminal signal it was, and invents nothing else', () => {
  const r = result.build({
    state: finished({ outcome: 'failed', finish: { subtype: 'error_max_turns', isError: false, terminalReason: null } }),
    changes: { known: true, files: [] },
  });
  assert.strictEqual(r.whatFailed.subtype, 'error_max_turns');
  assert.strictEqual(r.outcome, 'failed');
});

test('the observed-tools count is the caller\'s measurement, never derived from a capped read', () => {
  /* MEASURED wrong twice, and both times it wore a 확인됨 chip:
   *
   *   · one `user` message can carry SEVERAL `tool_result` blocks (parallel calls) and becomes
   *     ONE signal. Counting signals counted messages.
   *   · `repo.signalsFor` reads at most 500 rows, so a long Work's count was capped by how much
   *     of its own history was read.
   *
   * The claim is now made only from a number the caller measured over the whole history. A
   * confirmed number that undercounts is worse than no number — the chip invites checking. */
  const tools = (r) => r.claims.find((c) => c.kind === 'tools-observed');
  assert.strictEqual(tools(result.build({ state: finished(), changes: { known: true, files: [] } })), undefined,
    'a tool count was invented when nobody measured one');
  assert.strictEqual(tools(result.build({ state: finished(), changes: { known: true, files: [] }, toolResults: 0 })), undefined,
    'zero tools produced a claim');
  const r = result.build({ state: finished(), changes: { known: true, files: [] }, toolResults: 7 });
  assert.strictEqual(tools(r).data.count, 7);
  assert.strictEqual(tools(r).confidence, 'confirmed');
  assert.ok(tools(r).sourceRef, 'the count is 확인됨 with no source');
  /* …and `build` has no way to derive one for itself any more: the signal list is not a
   * parameter, so there is nothing capped or bundled for it to miscount. (`sourceRef` still
   * NAMES `signals:tool_result` — that is where the number came from, and saying so is the
   * point of a source ref.) */
  const src = srcOf('app/main/work/result.js');
  const sig = /function build\(\{([^}]*)\}\)/.exec(src);
  assert.ok(sig, 'build is gone');
  assert.ok(!/signals/.test(sig[1]), `build still takes the signal list: ${sig[1].trim()}`);
  const code = src;
  assert.ok(!/signals\s*\./.test(code) && !/signals\.filter/.test(code),
    'result.js still reads a signal list');
});

test('a 확인됨 claim that cannot name its evidence is DOWNGRADED, never shown', () => {
  /* FOUND BY MUTATION: the downgrade lived inside `buildChecked`, where nothing could reach it
   * — `build()` sets a `sourceRef` on every confirmed claim it makes — so every mutation of
   * those three lines survived the whole suite. The guard is for a FUTURE `build()`, and a
   * guard nobody can exercise is a guard nobody can check.
   *
   * `18` §0.9 · D-114: the 확인됨 chip is an invitation to check the evidence. A chip with no
   * evidence behind it is the one thing the vocabulary exists to prevent. */
  const withSource = { kind: 'changed-files', data: null, confidence: 'confirmed', sourceRef: 'evidence:before→after' };
  const without = { kind: 'invented', data: null, confidence: 'confirmed', sourceRef: null };
  const expected = { kind: 'agent-report', data: null, confidence: 'expected', sourceRef: null };
  const out = result.downgrade({ claims: [withSource, without, expected], items: [], outcome: 'complete' });

  assert.strictEqual(out.claims[0].confidence, 'confirmed', 'a claim WITH a source was downgraded');
  assert.strictEqual(out.claims[1].confidence, 'unconfirmed', 'a 확인됨 claim with no source survived');
  assert.strictEqual(out.claims[2].confidence, 'expected', '예상됨 was touched');
  /* Downgraded, not deleted: what was measured is still said, at the confidence it earns. */
  assert.strictEqual(out.claims.length, 3);
  assert.strictEqual(out.claims[1].kind, 'invented');
  /* …and the input is left alone — the caller may still be holding it. */
  assert.strictEqual(without.confidence, 'confirmed', 'downgrade mutated its argument');

  /* `verify` is what decides there is a problem at all, and it must SEE this one. */
  assert.deepStrictEqual(result.verify({ claims: [without], items: [], outcome: 'complete' }),
    ['claim invented is 확인됨 with no source']);

  /* …and `buildChecked` still applies it — the wiring is the half that matters in production. */
  const src = srcOf('app/main/work/result.js');
  assert.ok(/problems\.length \? downgrade\(result\) : result/.test(src),
    'buildChecked no longer downgrades');
});

test('`15` SC-03 남은 변경 확인 불가 is a STATE, not just a claim row', () => {
  /* UF-REMAIN-UNKNOWN. The result already carried a `changes-unknown` CLAIM — the fact that the
   * evidence pair could not tell. `15` builds a dashed panel on top of it with three ways out,
   * and that panel did not exist: a user whose cancel left an unknown remainder was told so and
   * given nothing to do about it.
   *
   * NOTE: this state has no RENDERED evidence yet — the e2e's project is a git repo whose
   * evidence pair always answers, so the flow cannot reach it. Recorded in BATCH-22. */
  const src = srcOf('app/renderer/screens/sc03.js');
  assert.ok(/if \(\(snap\.result\?\.claims \?\? \[\]\)\.some\(\(c\) => c\.kind === 'changes-unknown'\)\) \{/.test(src),
    'the panel is not driven by the claim the builder actually produces');
  const panel = /function remainPanel\(snap, nav, state\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(panel, 'remainPanel is gone');
  /* Dashed and NEUTRAL. `12` §16: not knowing is not failing, and `16` §2.1 keeps red for
   * failure alone. */
  assert.ok(/el\('div', 'panel unk'\)/.test(panel[1]), 'the panel is not the dashed unknown one');
  assert.ok(!/fail/.test(panel[1]), 'the panel is painted as a failure');
  /* `15` names three ways out and `18` carries all three. */
  for (const key of ['C.work.remainRead', 'C.work.terminal', 'C.work.remainNew']) {
    assert.ok(panel[1].includes(key), `the panel does not offer ${key}`);
  }
  /* …and the new Work goes through the intent field, NOT submitted — `12` treats sending as
   * consent to change files, and D-115 says a correction is a new Work like any other. */
  assert.ok(panel[1].includes('nav.toWorkbench'), '정리 요청 does not go through the request field');
  assert.ok(!panel[1].includes('workStart'), '정리 요청 starts a Work without the user sending it');
});

test('a 부분 result draws BOTH lists, and the unmeasurable one says 확인 못함', () => {
  /* `15` 부분 완료 needs 된 것 AND 안 된 것. The 된 것 list came only from the evidence pair,
   * and the renderer drew it only when both lists had content — so when the pair could not tell
   * what changed, the card showed 안 된 것 alone. That reads as "nothing was done", which is a
   * claim nobody made; D-114 says silence is 확인 못함, never a fact.
   *
   * `verify()` had been reporting this all along and `buildChecked` could only write it to the
   * record — the screen went on drawing one list. */
  const src = srcOf('app/renderer/screens/sc03.js');
  assert.ok(/const isPartial = snap\.outcome === 'partial' \|\| snap\.outcome === 'cancelled_partial';/.test(src),
    'the result card does not know what a 부분 outcome is');
  assert.ok(/if \(done\.length \|\| \(isPartial && notDone\.length\)\) \{/.test(src),
    'the 된 것 heading is still conditional on the other list having content');
  assert.ok(/box\.appendChild\(el\('span', 'chip unk', C\.brief\.chips\.no\)\);/.test(src),
    'the empty 된 것 list does not say 확인 못함');

  /* …and the builder still reports it, so the record carries the fact that the pair could not
   * answer even though the screen now says so too. */
  const r = result.build({
    state: finished({ outcome: 'partial', denials: [{ tool: 'Edit', resolved: false, input: { file_path: 'x.ts' } }] }),
    changes: { known: false, files: [] },
  });
  assert.deepStrictEqual(result.verify(r), ['partial result has no 된 것 list']);
  assert.ok(r.claims.some((c) => c.kind === 'changes-unknown' && c.confidence === 'unconfirmed'),
    'the result does not record that the evidence pair could not tell');
});

test('a resolved refusal is not carried into 안 된 것', () => {
  const r = result.build({
    state: finished({ denials: [{ tool: 'Edit', resolved: true, input: { file_path: 'x.ts' } }] }),
    changes: { known: true, files: ['x.ts'] },
  });
  assert.ok(!r.items.some((i) => i.kind === 'not_done'),
    'a refusal the user allowed was reported as something that was not done');
});
