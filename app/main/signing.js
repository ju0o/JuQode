/* WBS-33 · Is THIS build signed?
 *
 * `21` WBS-33 and `22` §95 require the product to say so when it is not — 숨기지 않는다
 * (원칙 2). No screen spec gives that sentence a home; the placement decision and its reasons
 * are CANON_FINDINGS CF-21.
 *
 * The answer is read from the PE certificate table itself, which is what the verification
 * harness reads too (`Get-AuthenticodeSignature`, never the builder log). A builder log says
 * what the build intended; the file says what it is.
 *
 * No spawn. The certificate table is one 8-byte entry in the PE Optional Header's data
 * directory, so `fs.read` of a few dozen bytes answers it. Adding a PowerShell child process
 * at boot to learn a fact that is sitting in our own file would be the expensive way to be
 * less certain.
 *
 * What this DOES NOT do: judge whether an existing signature is valid, trusted, or unexpired.
 * That needs the certificate chain and the OS trust store. So a table that is present is
 * reported as 확인 못함, never as 서명됨 — D-114 lets us claim 확인됨 only for a deterministic
 * fact, and "there are bytes here" is not "this signature is good".
 */
const fs = require('node:fs');

/** Windows PE: 'MZ' at 0, the PE header offset at 0x3C, 'PE\0\0' there. */
const PE_OFFSET_AT = 0x3c;
/** Optional Header magic: PE32 vs PE32+ changes where the data directory starts. */
const PE32 = 0x10b, PE32_PLUS = 0x20b;
/** The certificate table is data directory entry 4 — 8 bytes: RVA, then SIZE. */
const CERT_DIR_INDEX = 4;

/**
 * Does this PE file carry a certificate table?
 * @returns {{ present: boolean } | { error: string }}
 */
function certificateTable(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(0x40);
    if (fs.readSync(fd, head, 0, head.length, 0) < head.length) return { error: 'too-short' };
    if (head.readUInt16LE(0) !== 0x5a4d) return { error: 'not-a-pe' };      // 'MZ'

    const peAt = head.readUInt32LE(PE_OFFSET_AT);
    /* The COFF header is 20 bytes after the 4-byte signature; the optional header follows it.
     * Read enough to cover the largest data directory offset we need. */
    const buf = Buffer.alloc(0x100);
    const got = fs.readSync(fd, buf, 0, buf.length, peAt);
    if (got < 0x1a) return { error: 'not-a-pe' };                          // signature + COFF + magic
    if (buf.readUInt32LE(0) !== 0x00004550) return { error: 'not-a-pe' };   // 'PE\0\0'

    const optAt = 24;                                   // within `buf`, after signature + COFF
    const magic = buf.readUInt16LE(optAt);
    /* PE32 has an extra 4-byte BaseOfData field before the windows-specific fields, so the
     * data directory starts 16 bytes later in PE32+ than the naive count suggests. */
    const dirAt = optAt + (magic === PE32_PLUS ? 112 : magic === PE32 ? 96 : -1);
    if (dirAt < optAt) return { error: 'unknown-pe-magic' };

    const entryAt = dirAt + CERT_DIR_INDEX * 8;
    /* `buf` is zero-filled, so a file that STOPS before the certificate table would read as a
     * size of 0 — which is exactly the byte pattern of an unsigned build. Reporting a truncated
     * header as 확인됨 서명 없음 is the one wrong answer this function must never give. */
    if (got < entryAt + 8) return { error: 'truncated-header' };
    return { present: buf.readUInt32LE(entryAt + 4) > 0 };   // SIZE, not RVA
  } catch (e) {
    return { error: e.code || 'unreadable' };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* nothing to do */ }
  }
}

/**
 * The state to SHOW, in D-114's vocabulary.
 *
 *   'not-applicable' — a development run. There is no distributed build to be signed, so the
 *                      fact does not exist yet. That is not hiding it.
 *   'unsigned'       — 확인됨. A PE with an empty certificate table carries no signature at all.
 *   'unknown'        — 확인 못함. A signature is present but unjudged, or the file could not be
 *                      read, or this is not a PE at all (a packaged build on another OS).
 *
 * `packaged` and `platform` are passed in rather than read from `electron`, so the decision is
 * testable without launching an app.
 */
function buildSignature({ packaged, platform, exePath }) {
  if (!packaged) return { state: 'not-applicable', reason: 'development-run' };
  if (platform !== 'win32') return { state: 'unknown', reason: 'not-a-windows-build' };

  const r = certificateTable(exePath);
  if (r.error) return { state: 'unknown', reason: r.error, source_ref: exePath };
  return r.present
    ? { state: 'unknown', reason: 'signature-present-but-unverified', source_ref: exePath }
    : { state: 'unsigned', reason: 'no-certificate-table', source_ref: exePath };
}

module.exports = { buildSignature, certificateTable };
