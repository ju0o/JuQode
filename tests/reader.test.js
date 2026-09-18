/* SC-04 · the rules the Change Reader applies, as pure functions.
 *
 * The visual e2e can only reach the states its fixture produces, and every Work it reads with
 * changes also touches the excluded `.env`. So the ABSENT half of D-126a — a Work with no
 * excluded-path change draws NO card — has no reachable state there. Two mutations survived on
 * exactly that half. A rule whose false case cannot be reached from the e2e belongs in a pure
 * function, where both cases are one line each.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const R = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(R, 'app/renderer/screens/sc04.js')).href);

test('the excluded-path card is drawn when, and only when, there is a change to report', async () => {
  const { hasEvidenceGap } = await load();

  assert.strictEqual(hasEvidenceGap({ known: true, paths: [{ path: '.env' }] }), true);
  assert.strictEqual(hasEvidenceGap({ known: true, paths: [{ path: '.env' }, { path: 'k.pem' }] }), true);

  /* Compared, and nothing changed. Saying 증거에 담기지 않은 변경이 있어요 here would announce
   * a change that did not happen. */
  assert.strictEqual(hasEvidenceGap({ known: true, paths: [] }), false);

  /* NOT compared. This is the case D-126a is most careful about: the product may not say the
   * excluded files did not change, and it may not say they did either. It says nothing. */
  assert.strictEqual(hasEvidenceGap({ known: false, paths: [{ path: '.env' }] }), false);
  assert.strictEqual(hasEvidenceGap({ known: false, paths: [] }), false);

  /* No ledger at all, from a Work recorded before the ledger existed. */
  assert.strictEqual(hasEvidenceGap(undefined), false);
  assert.strictEqual(hasEvidenceGap(null), false);
  assert.strictEqual(hasEvidenceGap({}), false);
});

test('the answer is a boolean — a truthy object would draw a card for every Work', async () => {
  /* FOUND BY MUTATION: `return null` became `return {}` and survived. The caller only asks
   * whether there is something to draw, so anything truthy is a card. */
  const { hasEvidenceGap } = await load();
  for (const g of [undefined, null, {}, { known: true, paths: [] }, { known: false, paths: [1] }]) {
    assert.strictEqual(typeof hasEvidenceGap(g), 'boolean', `not a boolean for ${JSON.stringify(g)}`);
    assert.strictEqual(hasEvidenceGap(g), false);
  }
});

test('the ledger is metadata only — nothing here can carry a secret', async () => {
  /* D-126a: the contents of an excluded file are never read, so the decision must rest on the
   * COUNT and nothing inside a path entry. Passing entries with no readable content at all
   * still answers, which is the property that keeps a secret out of this path. */
  const { hasEvidenceGap } = await load();
  assert.strictEqual(hasEvidenceGap({ known: true, paths: [{}] }), true);
  assert.strictEqual(hasEvidenceGap({ known: true, paths: [null] }), true);
});
