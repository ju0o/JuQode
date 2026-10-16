'use strict';
/* The four different answers about changed files, never folded into "no changes" (SC-03 D2.1). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = path.resolve(__dirname, '..');

test('changedFilesState tells missing / unknown / zero / files apart', async () => {
  const { changedFilesState } = await import(require('node:url').pathToFileURL(path.join(R, 'app/renderer/human-read.mjs')).href);
  const row = (details) => ({ id: 'e1', kind: 'changed_files', details });
  assert.strictEqual(changedFilesState(undefined).state, 'missing');
  assert.strictEqual(changedFilesState([{ kind: 'test_command', details: {} }]).state, 'missing', 'a test row is not a changed-files answer');
  assert.strictEqual(changedFilesState([row({ known: false, files: [] })]).state, 'unknown', 'known=false must not read as zero');
  assert.strictEqual(changedFilesState([row({ files: [] })]).state, 'unknown', 'a row without `known` is not a measurement');
  assert.strictEqual(changedFilesState([row({ known: 'yes', files: [] })]).state, 'unknown', 'only known === true counts');
  assert.deepStrictEqual(changedFilesState([row({ known: true, files: [] })]), { state: 'zero', files: [], id: 'e1' });
  assert.deepStrictEqual(changedFilesState([row({ known: true, files: ['a.js', '한글/b.md'] })]).files, ['a.js', '한글/b.md']);
  assert.strictEqual(changedFilesState([row({ known: false, files: ['stale.js'] })]).files.length, 0, 'files of an unmeasured row are not shown as changes');
});

test('every screen that prints changed files goes through that helper (no `changed ? 없음` shortcut left)', () => {
  for (const f of ['app/renderer/screens/sc02.js', 'app/renderer/screens/sc03.js']) {
    const src = fs.readFileSync(path.join(R, f), 'utf8');
    assert.ok(src.includes('changedFilesState'), `${f} does not use changedFilesState`);
    assert.ok(!/changed \? C\.gap\.task\.noChanges/.test(src), `${f} still maps "a row exists" to "no changes"`);
    assert.ok(!/files\.length \? files\.join\([^)]*\) : C\.gap\.task\.noChanges/.test(src), `${f} still maps an empty list to "no changes" without checking known`);
  }
});
