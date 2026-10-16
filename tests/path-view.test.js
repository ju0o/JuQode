const test = require('node:test');
const assert = require('node:assert/strict');

let P;
test.before(async () => { P = await import('../app/renderer/path-view.mjs'); });

test('a path is split without being altered, on every separator style', () => {
  assert.deepEqual(P.splitPath('src/index.js'), { raw: 'src/index.js', parts: ['src', 'index.js'], name: 'index.js', dir: ['src'] });
  const win = P.splitPath('C:\\Users\\kim\\프로젝트\\보고서.md');
  assert.equal(win.raw, 'C:\\Users\\kim\\프로젝트\\보고서.md', 'the raw string must come back exactly');
  assert.equal(win.name, '보고서.md');
  assert.deepEqual(win.dir, ['C:', 'Users', 'kim', '프로젝트']);
  assert.equal(P.splitPath('\\\\server\\share\\a.txt').name, 'a.txt');
  assert.equal(P.splitPath('README.md').name, 'README.md');
  assert.equal(P.splitPath('dir/').name, 'dir', 'a trailing separator does not make an empty name');
  assert.deepEqual(P.splitPath(''), { raw: '', parts: [], name: '', dir: [] });
  assert.equal(P.splitPath(undefined).raw, '');
});

test('names are shown alone when they are unique, and the exact paths stay on the items', () => {
  const r = P.presentFiles(['README.md', 'src/index.js', 'docs/설명서.md']);
  assert.equal(r.count, 3);
  assert.deepEqual(r.items.map((i) => i.label), ['README.md', 'index.js', '설명서.md']);
  assert.deepEqual(r.items.map((i) => i.raw), ['README.md', 'src/index.js', 'docs/설명서.md'], 'raw paths are never rewritten');
  assert.ok(r.items.every((i) => i.hint === null));
});

test('same-named files get just enough of their folder to be told apart (and nothing is invented about them)', () => {
  const r = P.presentFiles(['src/index.js', 'tests/index.js', 'src/app/index.js', 'package.json']);
  const label = (raw) => r.items.find((i) => i.raw === raw).label;
  assert.equal(label('package.json'), 'package.json');
  assert.equal(label('tests/index.js'), 'tests/index.js');
  assert.equal(label('src/index.js'), 'src/index.js');
  assert.equal(label('src/app/index.js'), 'app/index.js');
  assert.equal(new Set(r.items.map((i) => i.label)).size, 4, 'every label is unique');
  const win = P.presentFiles(['C:\\a\\x\\index.js', 'C:\\b\\x\\index.js']);
  assert.deepEqual(win.items.map((i) => i.label), ['a/x/index.js', 'b/x/index.js']);
  const json = JSON.stringify(r);
  assert.ok(!/config|source|docs? file|설정 파일|문서/.test(JSON.stringify(P.presentFiles(['a/config.json']).items[0].hint)), 'no meaning is derived from a name');
  assert.ok(json.length > 0);
});

test('exact duplicates collapse, non-strings and empties are ignored, the count is of distinct paths', () => {
  const r = P.presentFiles(['a.txt', 'a.txt', '', null, 5, 'b.txt']);
  assert.deepEqual(r.items.map((i) => i.raw), ['a.txt', 'b.txt']);
  assert.equal(r.count, 2);
  assert.deepEqual(P.presentFiles(null), { count: 0, items: [] });
});

test('long names are shortened in the middle for the chip only; Hangul and emoji are not cut in half', () => {
  const name = `${'아주긴한글이름'.repeat(6)}.md`;
  const e = P.middleEllipsis(name, 24);
  assert.equal(Array.from(e).length, 24);
  assert.ok(e.includes('…') && e.endsWith('.md'));
  assert.ok(!/\uFFFD/.test(e));
  assert.equal(P.middleEllipsis('short.js', 24), 'short.js');
  const r = P.presentFiles([`deep/${name}`]);
  assert.equal(r.items[0].raw, `deep/${name}`);
  assert.ok(Array.from(r.items[0].shown).length <= 28);
  assert.equal(Array.from(P.middleEllipsis('😀'.repeat(40), 10)).length, 10);
});

test('token-shaped text is masked in what is displayed, never in the stored raw', () => {
  const secret = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';
  const r = P.presentFiles([`keys/${secret}.txt`, 'a/AKIA0123456789ABCDEF.json']);
  for (const i of r.items) {
    assert.ok(!i.shown.includes('ghp_0123') && !i.shown.includes('AKIA0123'), `unmasked: ${i.shown}`);
    assert.ok(i.shown.includes('***'));
  }
  assert.ok(r.items[0].raw.includes(secret), 'stored evidence is not edited');
  assert.equal(P.maskForDisplay('plain-name.js'), 'plain-name.js');
});
