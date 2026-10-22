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
const { code } = require('./src');
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

test('SC-04 terminal recovery actions are buttons and request an open drawer without resetting it', () => {
  const sc04 = code('app/renderer/screens/sc04.js');
  const recoveryStart = sc04.indexOf('function terminalRecoveryButton(');
  const recoveryEnd = sc04.indexOf('\n}', recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'the shared recovery button helper is present');
  const recovery = sc04.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /btn\('btn sm ghost rec sc04-terminal-recovery', label, \(\) => window\.__toggleDrawer\?\.\(true\)\)/,
    'the recovery helper renders a native button and requests the drawer open');
  assert.match(recovery, /setAttribute\('data-act', 'reader-open-terminal'\)/);

  const cardStart = sc04.indexOf('function evidenceGapCard(');
  const cardEnd = sc04.indexOf('\n}\n', cardStart);
  assert.ok(cardStart >= 0 && cardEnd > cardStart, 'evidenceGapCard source is present');
  const card = sc04.slice(cardStart, cardEnd);
  assert.match(card, /terminalRecoveryButton\(C\.reader\.evidenceGapAlt\)/,
    'the evidence-gap recovery uses the shared button');
  assert.match(sc04, /if \(!g\.pending\) acts\.appendChild\(terminalRecoveryButton\(\)\)/,
    'only a failed explanation exposes the unexplained-group terminal action');
  assert.match(sc04, /acts\.appendChild\(terminalRecoveryButton\(\)\);\s*card\.appendChild\(acts\);/,
    'an undisplayable block offers terminal recovery');
  assert.match(sc04, /if \(!f\.displayable\) \{[\s\S]*?acts\.appendChild\(terminalRecoveryButton\(\)\)/,
    'an undisplayable raw card offers terminal recovery');

  const renderer = code('app/renderer/renderer.js');
  const toggleStart = renderer.indexOf('window.__toggleDrawer = (open) => {');
  const toggleEnd = renderer.indexOf('\n};', toggleStart);
  assert.ok(toggleStart >= 0 && toggleEnd > toggleStart, 'the shared drawer toggle is present');
  const toggle = renderer.slice(toggleStart, toggleEnd);
  assert.match(toggle, /const shouldOpen = typeof open === 'boolean' \? open : !state\.drawerOpen/,
    'the no-argument drawer toggle remains a toggle');
  assert.match(toggle, /if \(shouldOpen && !state\.drawerOpen\) state\.drawerOpener = document\.activeElement/,
    'opening stores the control that invoked the drawer');
  assert.match(toggle, /if \(shouldOpen\) focusDrawerInput\(\)/,
    'opening hands keyboard focus to TD-01');
  assert.doesNotMatch(toggle, /qcPhrase\s*=|qcCard\s*=|qcRun\s*=/,
    'opening does not clear or replace the existing Quick Command');

  const td01 = code('app/renderer/screens/td01.js');
  assert.match(td01, /if \(!state\.drawerOpen\) \{\s*const opener = state\.drawerOpener;\s*state\.drawerOpener = null;\s*if \(opener\?\.isConnected\) opener\.focus\?\.\(\);/,
    'closing TD-01 restores focus to its connected opener');
});
