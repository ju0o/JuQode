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

/* Fixture directories, removed when the file finishes — the suite once filled a 7.5 GB tmpfs. */
const juqodeTempDirs = [];
const tempDir = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  juqodeTempDirs.push(d);
  return d;
};
process.on('exit', () => {
  for (const d of juqodeTempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
});
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

test('a change outside every declaration is a hunk block, and does not vanish', () => {
  const before = "import a from 'a';\nexport function fn() { return 1; }\n";
  const after = "import a from 'a';\nimport b from 'b';\nexport function fn() { return 1; }\n";
  const file = B.splitDiff(diffOf('src/i.ts', before, after))[0];
  const blocks = B.blocksFor(file, { before, after }).blocks;
  const hunks = blocks.filter((x) => x.kind === 'hunk');
  assert.ok(hunks.length > 0, 'a module-level change produced no block at all');
  assert.ok(hunks.every((h) => h.outsideDeclaration), 'a hunk block claimed lines a declaration owns');
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

  const big = 'x'.repeat(B.MAX_DISPLAY_BYTES + 1);
  const f = B.splitDiff(diffOf('src/huge.ts', 'a\n', 'b\n'))[0];
  assert.strictEqual(B.blocksFor(f, { before: big, after: big }).note, 'too-large');
});

test('the segmenter never asks anything — it only reads the diff', () => {
  /* `19` §C5-B: an LLM may EXPLAIN a block and must never DEFINE one. The unit has to be
   * derivable from the file, or the user cannot check it. */
  const src = require('node:fs').readFileSync(path.join(R, 'app/main/change/blocks.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['claude', 'session.run', 'spawn(', 'fetch(', 'execFile']) {
    assert.ok(!src.includes(forbidden), `the segmenter reaches for ${forbidden} — a unit must be derived, not asked for`);
  }
});

/* ───────────────────────── WBS-18 · the result ───────────────────────── */

const finished = (over = {}) => ({
  outcome: 'complete', denials: [], finish: { text: '했어요', subtype: 'success' }, ...over,
});

test('only a measured fact can be 확인됨, and it names what it rests on', () => {
  const r = result.build({
    state: finished(),
    changes: { known: true, files: ['a.ts', 'b.ts'] },
    signals: [{ kind: KIND.TOOL_RESULT }, { kind: KIND.TOOL_RESULT }],
  });
  const confirmed = r.claims.filter((c) => c.confidence === 'confirmed');
  assert.ok(confirmed.length >= 2);
  for (const c of confirmed) assert.ok(c.sourceRef, `a 확인됨 claim with no source: ${c.kind}`);
  assert.deepStrictEqual(result.verify(r), []);
});

test("Claude Code's own report is 예상됨 — nothing measured it", () => {
  const r = result.build({ state: finished(), changes: { known: true, files: [] }, signals: [] });
  const report = r.claims.find((c) => c.kind === 'agent-report');
  assert.strictEqual(report.confidence, 'expected',
    'the model said it, so D-114 says 예상됨 — 확인됨 would be a claim about evidence that does not exist');
  assert.strictEqual(report.data.text, '했어요', "the model's own words must be carried, not paraphrased");
});

test('a basis we could not compare is 확인 못함, never "nothing changed"', () => {
  const r = result.build({ state: finished(), changes: { known: false, files: [] }, signals: [] });
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
    signals: [],
  });
  assert.deepStrictEqual(result.verify(r), [], '`21` WBS-18: a partial result must have both lists');
  assert.ok(r.items.some((i) => i.kind === 'done'));
  const notDone = r.items.find((i) => i.kind === 'not_done');
  assert.strictEqual(notDone.data.tool, 'Edit');
  assert.strictEqual(notDone.data.target, 'x.ts', 'the refusal must say what it was about');
});

test('a partial result missing a list is caught, not shipped', () => {
  const r = result.build({
    state: finished({ outcome: 'partial', denials: [] }),
    changes: { known: true, files: [] },
    signals: [],
  });
  assert.ok(result.verify(r).length > 0, 'a partial result with neither list passed verification');
});

test('a failure says which terminal signal it was, and invents nothing else', () => {
  const r = result.build({
    state: finished({ outcome: 'failed', finish: { subtype: 'error_max_turns', isError: false, terminalReason: null } }),
    changes: { known: true, files: [] },
    signals: [],
  });
  assert.strictEqual(r.whatFailed.subtype, 'error_max_turns');
  assert.strictEqual(r.outcome, 'failed');
});

test('a resolved refusal is not carried into 안 된 것', () => {
  const r = result.build({
    state: finished({ denials: [{ tool: 'Edit', resolved: true, input: { file_path: 'x.ts' } }] }),
    changes: { known: true, files: ['x.ts'] },
    signals: [],
  });
  assert.ok(!r.items.some((i) => i.kind === 'not_done'),
    'a refusal the user allowed was reported as something that was not done');
});
