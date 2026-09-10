/* WBS-33 · the build's own signature, read from the PE certificate table.
 *
 * Synthetic PE headers, built here byte by byte. Using a real signed binary would make the
 * test depend on whatever happens to be installed on the machine running it, and there is no
 * signed PE in this repository to point at — `19` §V lists signing as NOT VALIDATED.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildSignature, certificateTable } = require('../app/main/signing.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-pe-'));
const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };

/** A minimal but structurally real PE. `certSize` is the certificate table's SIZE field. */
function pe({ plus = true, certSize = 0, bytes = 0x400, peAt = 0x80 } = {}) {
  const b = Buffer.alloc(bytes);
  b.write('MZ', 0);
  b.writeUInt32LE(peAt, 0x3c);
  b.writeUInt32LE(0x00004550, peAt);               // 'PE\0\0'
  const opt = peAt + 24;                            // after signature (4) + COFF header (20)
  b.writeUInt16LE(plus ? 0x20b : 0x10b, opt);
  const dir4 = opt + (plus ? 112 : 96) + 4 * 8;     // data directory entry 4
  b.writeUInt32LE(0x9000, dir4);                    // RVA — deliberately non-zero
  b.writeUInt32LE(certSize, dir4 + 4);              // SIZE — the field that decides
  return b;
}

test('a PE with an empty certificate table is UNSIGNED, and that is a determined fact', () => {
  for (const plus of [true, false]) {
    const r = buildSignature({ packaged: true, platform: 'win32', exePath: write(`u${plus}.exe`, pe({ plus })) });
    assert.strictEqual(r.state, 'unsigned', `PE32${plus ? '+' : ''} read wrong`);
    assert.strictEqual(r.reason, 'no-certificate-table');
    assert.ok(r.source_ref, 'a 확인됨 claim needs a source_ref (D-114)');
  }
});

test('a PE that HAS a certificate table is 확인 못함 — never 서명됨', () => {
  /* Bytes in the table are not a valid, trusted, unexpired signature. Judging that needs the
   * certificate chain and the OS trust store, which this does not read. Claiming 서명됨 from
   * a non-zero size would be the product asserting something it did not check. */
  const r = buildSignature({ packaged: true, platform: 'win32', exePath: write('s.exe', pe({ certSize: 0x1a20 })) });
  assert.strictEqual(r.state, 'unknown');
  assert.strictEqual(r.reason, 'signature-present-but-unverified');
});

test('only the SIZE field decides — a non-zero RVA with size 0 is still unsigned', () => {
  /* The two fields sit next to each other and reading the wrong one inverts every answer. */
  const b = pe({ certSize: 0 });
  const r = buildSignature({ packaged: true, platform: 'win32', exePath: write('rva.exe', b) });
  assert.strictEqual(r.state, 'unsigned');
});

test('a file that stops before the certificate table is 확인 못함, NOT unsigned', () => {
  /* The read buffer is zero-filled, so a truncated header has the same bytes as an empty
   * certificate table. Answering 서명 없음 there would be a confident wrong answer. */
  const full = pe();
  const r = buildSignature({ packaged: true, platform: 'win32', exePath: write('cut.exe', full.subarray(0, 0x100)) });
  assert.strictEqual(r.state, 'unknown');
  assert.strictEqual(r.reason, 'truncated-header');
});

test('a non-PE file, an unknown magic, and a missing file are each 확인 못함', () => {
  /* Two different shapes of "not a PE": one too short to even hold a DOS header, one long
   * enough but without the 'MZ' magic. Both are 확인 못함, and neither may reach the size field. */
  assert.strictEqual(certificateTable(write('tiny.txt', Buffer.from('nope'))).error, 'too-short');
  assert.strictEqual(certificateTable(write('t.txt', Buffer.alloc(0x400, 0x41))).error, 'not-a-pe');

  const weird = pe(); weird.writeUInt16LE(0x1234, 0x80 + 24);
  assert.strictEqual(certificateTable(write('w.exe', weird)).error, 'unknown-pe-magic');

  assert.strictEqual(buildSignature({ packaged: true, platform: 'win32', exePath: path.join(dir, 'nope') }).reason, 'ENOENT');
});

test('a development run has no build to be signed, and a non-Windows build cannot be read', () => {
  /* 'not-applicable' is not 'unsigned' hidden under another name: `npm start` produces no
   * distributed artifact, so there is nothing yet for the disclosure to be about. */
  assert.strictEqual(buildSignature({ packaged: false, platform: 'win32', exePath: 'x' }).state, 'not-applicable');
  assert.strictEqual(buildSignature({ packaged: true, platform: 'darwin', exePath: 'x' }).state, 'unknown');
});

test('the signature is never reported as signed by any input this function accepts', () => {
  /* The one claim the product must not make without proof. Nothing below may produce it. */
  const cases = [
    { packaged: false, platform: 'win32', exePath: 'x' },
    { packaged: true, platform: 'linux', exePath: 'x' },
    { packaged: true, platform: 'win32', exePath: write('a.exe', pe({ certSize: 0 })) },
    { packaged: true, platform: 'win32', exePath: write('b.exe', pe({ certSize: 99 })) },
    { packaged: true, platform: 'win32', exePath: write('c.txt', Buffer.alloc(4)) },
    { packaged: true, platform: 'win32', exePath: write('d.exe', pe().subarray(0, 0x100)) },
  ];
  for (const c of cases) {
    assert.notStrictEqual(buildSignature(c).state, 'signed', `claimed signed for ${JSON.stringify(c)}`);
  }
});

/* ---------------------------------------------------------------- the surface it reaches */

const { makeHandlers } = require('../app/main/ipc.js');
const { code: srcOf } = require('./src.js');

test('boot always carries a signature shape — a missing producer is 확인 못함, never absent', () => {
  /* If the field could be absent the screen would have three cases to handle and would get the
   * third one wrong. `juqode:boot` is where SC-01 already looks, so it is the one producer. */
  const withNone = makeHandlers({ db: () => null })['juqode:boot']();
  assert.strictEqual(withNone.signature.state, 'unknown');
  assert.strictEqual(withNone.signature.reason, 'not-reported');

  const stated = { state: 'unsigned', reason: 'no-certificate-table', source_ref: 'C:\\a\\JuQode.exe' };
  const withOne = makeHandlers({ db: () => null, signature: () => stated })['juqode:boot']();
  assert.deepStrictEqual(withOne.signature, stated, 'boot must pass the state through unchanged');
});

test('the notice is never red — `16` §2.1 keeps the one red on this screen for the folder failure', () => {
  /* A source check because the rule is about which token the rule-breaking edit would reach
   * for, and the CSS is where that edit would land. Comments are stripped, so the prose above
   * the block explaining why it is NOT red cannot satisfy this. */
  const css = srcOf('app/renderer/screens/sc01.css');
  const block = css.slice(css.indexOf('.sc01 .buildnote'));
  assert.ok(block.length > 0, 'the build notice has no styling at all');
  for (const banned of ['--fail', '--part', '--wait', '--rec']) {
    assert.ok(!block.includes(banned),
      `the unsigned-build notice uses ${banned}; that token already means something else (16 §2.1)`);
  }
  assert.ok(block.includes('--juq'), 'a fact JuQode states about itself wears JuQode\'s own colour');
  assert.ok(/\.buildnote\.unk[\s\S]*dashed/.test(block), '확인 못함 must be the dashed unknown');
});

test('a development run shows nothing, and every other state shows something', () => {
  /* `not-applicable` is the ONLY silence. Silence for `unknown` would be the product hiding
   * the fact that it does not know, which is the same failure as hiding the fact itself. */
  const js = srcOf('app/renderer/screens/sc01.js');
  const fn = js.slice(js.indexOf('function buildNotice'));
  assert.ok(/return null/.test(fn.slice(0, 260)), 'buildNotice must have an early return');
  assert.ok(fn.includes("'not-applicable'"), 'the silent case must be named, not implied');
  assert.ok(fn.includes('unsignedUnknown'), 'the unknown state must still render a sentence');
});
