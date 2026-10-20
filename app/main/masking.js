'use strict';
/* V1-409 · the scanners shared by the two maskers (qc/run.js `mask` for display / egress, work/context.js
 * `safeSnapshot` for what is stored). No requires, so neither file can form a cycle through it.
 *
 * Everything here is LINEAR in the length of the text, on purpose: it runs on text a child process wrote, on the main
 * thread. Where a regex would need an unbounded prefix or lazy span (private-key block, URL scheme, JWT segments, JSON
 * key with escaped quotes) the structure is checked with indexOf / character loops instead, each region of the text is
 * visited a bounded number of times, and a field that is longer than any bound is masked WHOLE rather than passed.
 *
 * Every scanner is `(text, rep) => text` and replaces what it finds with `rep`. */

const code = (c) => c.charCodeAt(0);
const isUpper = (c) => c >= 65 && c <= 90;
const isAlpha = (c) => isUpper(c) || (c >= 97 && c <= 122);
const isDigit = (c) => c >= 48 && c <= 57;
const isWord = (c) => isAlpha(c) || isDigit(c) || c === 95;
const isB64u = (c) => isAlpha(c) || isDigit(c) || c === 45 || c === 95;
const isB64 = (c) => isAlpha(c) || isDigit(c) || c === 43 || c === 47 || c === 61;
const isScheme = (c) => isAlpha(c) || isDigit(c) || c === 43 || c === 46 || c === 45;
const isSpace = (c) => c === 32 || (c >= 9 && c <= 13);

/** A leading `\b` that also holds after a JSON escape: in a stored stream line `a\nghp_…` the `n` is a word
 * character, so a plain `\b` never saw the token start. */
const escB = (re) => (re.source.startsWith('\\b') ? new RegExp(`(?:\\b|(?<=\\\\[nrt]|%[0-9A-Fa-f]{2}))${re.source.slice(2)}`, re.flags) : re);

/* One keyword list for both maskers' `name = value` rules (the env-var rule of qc/run.js is upper-case on purpose). */
const KEYWORDS = 'api[\\s_-]?key|access[\\s_-]?token|refresh[\\s_-]?token|auth(?:orization)?[\\s_-]?(?:token)?(?!\\b\\s*[:=]\\s*["\']?(?:basic|bearer|digest|negotiate|token)\\b)|proxy[\\s_-]?authorization(?!\\b\\s*[:=]\\s*["\']?(?:basic|bearer|digest|negotiate|token)\\b)|cookie|set[\\s_-]?cookie|credential|token|password|passwd|secret(?:[\\s_-]?access[\\s_-]?key)?|private[\\s_-]?key|client[\\s_-]?secret';
const VALUE = '\\s*[:=]\\s*["\']?[^\\s"\',;]{4,}["\']?';
/* …with a name prefix of at most 64 characters (a longer prefix would make the scan quadratic) … */
const ASSIGNMENT = new RegExp(`\\b(?:[\\w.-]{0,64}(?:${KEYWORDS}))\\b${VALUE}`, 'gi');
/* …and the same without any prefix, so a name whose prefix is longer still has its keyword and value masked. */
const ASSIGNMENT_LONG_NAME = new RegExp(`(?:${KEYWORDS})\\b${VALUE}`, 'gi');

/* Header-ish shapes the generic rules miss. Bounded quantifiers only. */
const EXTRA_RE = [
  /(?<=(?:\b|(?<=\\[nrt]))x-(?:auth-token|api-key|access-token|csrf-token)["']?[ \t]{0,4}:[ \t]{0,4}["']?)[^\s"',;]{4,}/gi,   // only the value: the name and a JSON document stay intact
].map((r) => (r.source.startsWith('\\b') ? escB(r) : r));

/* ── Cookie / Set-Cookie headers ───────────────────────────────────────────────────────────────── */
const COOKIE_NAME = /(^|[\s"'`{(,;]|\\[nrt])((?:set-)?cookie)(["']?)[ \t]{0,4}:[ \t]{0,4}/gim;
const isCookieTokenChar = (c) => isAlpha(c) || isDigit(c) || '!#$%&\'*+.^_`|~-'.includes(String.fromCharCode(c));
/** Only a real HEADER is masked: the name stands alone (line start, whitespace or a quote before it - `COOKIE_EXCHANGE: number`
 * and `HTTP2_HEADER_COOKIE: string` are identifiers) and its value starts like a cookie pair (`name=`). The value runs to the end of
 * the line or the closing quote. Each match is looked at once, so the scan is linear however many `Cookie:` the text repeats. */
function maskCookieHeaders(text, rep) {
  if (!/cookie/i.test(text)) return text;
  const re = new RegExp(COOKIE_NAME.source, COOKIE_NAME.flags);
  const n = text.length;
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    let start = m.index + m[0].length;
    if (text[start] === '"' || text[start] === "'") start++;       // JSON / quoted: "Cookie": "a=b"
    let k = start;
    const lim = Math.min(n, start + 128);
    while (k < lim && isCookieTokenChar(text.charCodeAt(k))) k++;
    if (k > start && text[k] === '=') {
      let end = k;
      while (end < n) { const c = text[end]; if (c === '\n' || c === '\r' || c === '"' || c === "'" || c === '`') break; end++; }
      out += text.slice(pos, start) + rep; pos = end; re.lastIndex = Math.max(end, re.lastIndex);
    } else re.lastIndex = Math.max(start, re.lastIndex);
  }
  return out + text.slice(pos);
}
/* `curl … -u user:secret`: the option is found first (linear), then `curl` must stand on the same line within the 512 characters before it. */
function maskCurlUser(text, rep) {
  if (!text.includes('curl')) return text;
  const re = /\s(?:-u|--user)(?:[ =]|\s+)["']?[^\s:'"]+:[^\s'"]+/g;
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const from = Math.max(pos, m.index - 512);
    const win = text.slice(from, m.index);
    const nl = Math.max(win.lastIndexOf('\n'), win.lastIndexOf('\r')) + 1;
    const at = win.slice(nl).search(/\bcurl\b/);
    if (at >= 0) { out += text.slice(pos, from + nl + at) + rep; pos = m.index + m[0].length; }
  }
  return out + text.slice(pos);
}
const EXTRA = [maskCookieHeaders, ...EXTRA_RE.map((r) => (t, rep) => t.replace(r, rep)), maskCurlUser];

/* ── private keys ──────────────────────────────────────────────────────────────────────────────── */
const BEGIN = '-----BEGIN ';
const END = '-----END ';
const KEY_LABEL = 'PRIVATE KEY-----';
/** index just after `[WORD ]PRIVATE KEY-----` starting at i, or -1 */
function pemLabelEnd(text, i) {
  if (text.startsWith(KEY_LABEL, i)) return i + KEY_LABEL.length;
  let k = i;
  while (k < text.length && isUpper(text.charCodeAt(k))) k++;
  if (k > i && text[k] === ' ' && text.startsWith(KEY_LABEL, k + 1)) return k + 1 + KEY_LABEL.length;
  return -1;
}
/** An UNCLOSED `-----BEGIN … PRIVATE KEY-----` is a key only if what follows looks like key material: 40+ base64
 * characters (line breaks, real or JSON-escaped, allowed between) or a Proc-Type / DEK-Info header. A MENTION of the
 * marker in prose or code is not a key and masks nothing. */
function keyBodyFollows(text, h) {
  /** length of a line break at i (real, or JSON-escaped at ANY depth: `\n`, `\\n`, `\\\\n`…), 0 if none */
  const brk = (i) => {
    const c = text[i];
    if (c === '\n' || c === '\r') return 1;
    if (c !== '\\') return 0;
    let j = i;
    while (text[j] === '\\') j++;
    return text[j] === 'n' || text[j] === 'r' || text[j] === 't' ? j - i + 1 : 0;
  };
  let i = h;
  for (;;) {
    const b = brk(i);
    if (b) i += b; else if (isSpace(text.charCodeAt(i))) i++; else break;
  }
  if (text.startsWith('Proc-Type:', i) || text.startsWith('DEK-Info:', i)) return true;
  let n = 0;
  const stop = Math.min(text.length, i + 400);
  while (i < stop) {
    const c = text.charCodeAt(i);
    const b = brk(i);
    if (b) i += b;
    else if (isB64(c)) { n++; i++; } else break;
    if (n >= 40) return true;
  }
  return false;
}
function maskPrivateKeys(text, rep) {
  let from = text.indexOf(BEGIN);
  if (from < 0) return text;
  let out = '';
  let pos = 0;
  let noEnd = false;          // once no END exists after some position, none exists after any later one
  let endStart = -1;
  let endStop = -1;           // the first valid END at or after the last search start (reused while it is still ahead)
  while (from >= 0) {
    const h = pemLabelEnd(text, from + BEGIN.length);
    if (h < 0) { from = text.indexOf(BEGIN, from + 1); continue; }
    let stop = -1;
    if (!noEnd) {
      if (endStart >= h) stop = endStop;
      else {
        let e = text.indexOf(END, h);
        while (e >= 0) {
          const s = pemLabelEnd(text, e + END.length);
          if (s >= 0) { endStart = e; endStop = s; stop = s; break; }
          e = text.indexOf(END, e + 1);
        }
        if (stop < 0) noEnd = true;
      }
    }
    if (stop >= 0) { out += text.slice(pos, from) + rep; pos = stop; from = text.indexOf(BEGIN, stop); continue; }
    if (keyBodyFollows(text, h)) { out += text.slice(pos, from) + rep; pos = text.length; break; }   // unclosed: to the end of the field
    from = text.indexOf(BEGIN, h);
  }
  return out + text.slice(pos);
}

/* ── scheme://user:password@host ───────────────────────────────────────────────────────────────── */
function maskUrlCredentials(text, rep) {
  let i = text.indexOf('://');
  if (i < 0) return text;
  const n = text.length;
  let out = '';
  let pos = 0;
  while (i >= 0) {
    let s = i;
    const lim = Math.max(pos, i - 255);                       // the scheme is looked for at most 255 characters back
    while (s > lim && isScheme(text.charCodeAt(s - 1))) s--;
    while (s < i && !isAlpha(text.charCodeAt(s))) s++;
    if (s > 0 && text[s - 1] === '\\' && s + 1 < i && 'nrt'.includes(text[s])) s++;   // `\nhttp://…` in a JSON string
    if (s < i) {
      let j = i + 3;
      const u0 = j;
      while (j < n) { const c = text.charCodeAt(j); if (isSpace(c) || c === 47 || c === 64 || c === 58) break; j++; }
      if (j > u0 && text[j] === ':') {
        j++;
        const p0 = j;
        while (j < n) { const c = text.charCodeAt(j); if (isSpace(c) || c === 47 || c === 64) break; j++; }
        if (j > p0 && text[j] === '@') { out += text.slice(pos, s) + rep; pos = j + 1; i = text.indexOf('://', pos); continue; }
      }
    }
    i = text.indexOf('://', i + 3);
  }
  return out + text.slice(pos);
}

/* ── JWT ───────────────────────────────────────────────────────────────────────────────────────── */
function jwtHeaderLooksReal(text, i) {
  const head = Buffer.from(text.slice(i, i + 64), 'base64url').toString('latin1');
  return /"(?:alg|typ)"/.test(head);
}
/** Three base64url segments (header starting `eyJ`) are a JWT whatever their length. A long run starting `eyJ` WITHOUT
 * that shape is data (a base64 JSON blob, a source map) unless its first bytes decode to a JOSE header (`alg` / `typ`),
 * in which case the run and up to two following segments are masked whole. */
function maskJwt(text, rep) {
  let i = text.indexOf('eyJ');
  if (i < 0) return text;
  const n = text.length;
  let out = '';
  let pos = 0;
  while (i >= 0) {
    const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
    const ok = i === 0 || !isWord(prev) || ('nrt'.includes(text[i - 1]) && text[i - 2] === '\\') || (i >= 3 && text[i - 3] === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i - 2, i)));
    if (!ok) { i = text.indexOf('eyJ', i + 3); continue; }
    let e = i + 3;
    while (e < n && isB64u(text.charCodeAt(e))) e++;
    let end = -1;
    if (e - i - 3 >= 10 && text[e] === '.') {
      let f = e + 1;
      while (f < n && isB64u(text.charCodeAt(f))) f++;
      if (f - e - 1 >= 10 && text[f] === '.') {
        let g = f + 1;
        while (g < n && isB64u(text.charCodeAt(g))) g++;
        if (g - f - 1 >= 10) end = g;
      }
    }
    if (end < 0 && e - i >= 1024 && jwtHeaderLooksReal(text, i)) {
      end = e;
      for (let k = 0; k < 2 && text[end] === '.'; k++) { let g = end + 1; while (g < n && isB64u(text.charCodeAt(g))) g++; end = g; }
    }
    if (end >= 0) { out += text.slice(pos, i) + rep; pos = end; i = text.indexOf('eyJ', end); } else i = text.indexOf('eyJ', e);
  }
  return out + text.slice(pos);
}

/* ── Authorization: <scheme> <credential> ──────────────────────────────────────────────────────── */
const AUTH_NAME = escB(/\b(?:proxy[\s_-]?)?authorization["']?\s{0,8}[:=]\s{0,8}["']?(basic|bearer|digest|negotiate|token)\s{1,8}/gi);
const PROSE_WORD = /^[A-Za-z-]+$/;                      // letters (and hyphens): a word, not a credential
/** Does `token` (the text after the scheme) look like a credential rather than the next word of a sentence? */
function looksLikeCredential(scheme, token) {
  const len = token.length;
  if (scheme === 'digest') return token.includes('=');
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(token)) return false;      // not credential characters: the next word of a sentence
  if (scheme === 'basic') {
    if (len < 4) return false;
    return /[0-9+/=._]/.test(token) || (/^[A-Za-z]+$/.test(token) && /[A-Z]/.test(token.slice(1)) && /[a-z]/.test(token));
  }
  if (PROSE_WORD.test(token) && len < 24) return false;          // a word (bearer / token / negotiate)
  if (scheme === 'negotiate') return len >= 16 && !PROSE_WORD.test(token);
  return (len >= 6 && /[0-9._~+/=]/.test(token)) || (len >= 24 && !PROSE_WORD.test(token));
}
const DIGEST_LOOK = 4096;
function maskAuthHeaders(text, rep) {
  if (!/authorization/i.test(text)) return text;
  const re = new RegExp(AUTH_NAME.source, AUTH_NAME.flags);
  const n = text.length;
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const scheme = m[1].toLowerCase();
    const start = m.index + m[0].length;
    let end = start;
    let credential = false;
    if (scheme === 'digest') {
      /* the first token (at most DIGEST_LOOK characters) must hold `key=value`; only then is the rest of the line the credential.
       * The token scan stops at the first space, so repeated `Authorization: Digest ` costs a few characters each. */
      const lim = Math.min(n, start + DIGEST_LOOK);
      while (end < lim && !isSpace(text.charCodeAt(end)) && text[end] !== ',') end++;
      credential = end > start && text.slice(start, end).includes('=');
      if (credential) { end = text.indexOf('\n', end); if (end < 0) end = n; else if (text[end - 1] === '\r') end--; }
    } else {
      while (end < n) { const c = text[end]; if (isSpace(c.charCodeAt(0)) || c === '"' || c === "'" || c === ',' || c === ';') break; end++; }
      credential = end > start && looksLikeCredential(scheme, text.slice(start, end));
    }
    if (credential) { out += text.slice(pos, start) + rep; pos = end; re.lastIndex = Math.max(end, re.lastIndex); }
    else re.lastIndex = Math.max(start, re.lastIndex);
  }
  return out + text.slice(pos);
}

/* ── JSON "…_TOKEN": "value" (also inside a JSON string: \"…\", \\\"…\\\", any depth) ───────────────── */
const JSON_KEY_WORD = /TOKEN|SECRET|PASSWORD|API_?KEY|COOKIE|CREDENTIAL|AUTHORIZATION|(?:^|_)AUTH(?:_|$)/;
const KEY_CAP = 512;
const isKeyChar = (c) => isUpper(c) || isDigit(c) || c === 95;
/* Header-style JSON keys written in their usual mixed case: "Authorization", "Proxy-Authorization", "Cookie", "X-Api-Key"… */
const HEADER_KEY = /^(?:proxy-)?authorization$|^(?:set-)?cookie$|^x-(?:api-key|auth-token|access-token|csrf-token)$/i;
/** Masks only the VALUE (so the document stays valid). A key longer than KEY_CAP is treated as sensitive. */
function maskJsonCredentials(text, rep) {
  let q = text.indexOf('"');
  if (q < 0) return text;
  const n = text.length;
  let out = '';
  let pos = 0;
  while (q >= 0) {
    let b = 0;
    while (q - b - 1 >= 0 && text.charCodeAt(q - b - 1) === 92) b++;
    let k = q + 1;
    while (k < n && isKeyChar(text.charCodeAt(k))) k++;
    let sensitive = k - q - 1 > 0 && (k - q - 1 > KEY_CAP || JSON_KEY_WORD.test(text.slice(q + 1, k)));
    if (!sensitive) {           // a mixed-case header name: letters, digits, `_` and `-` up to 40 characters, exact names only
      let e = q + 1;
      const lim = Math.min(n, q + 41);
      while (e < lim && (isAlpha(text.charCodeAt(e)) || text.charCodeAt(e) === 45)) e++;
      if (e > q + 1 && e < lim && HEADER_KEY.test(text.slice(q + 1, e))) { sensitive = true; k = e; }
    }
    if (sensitive) {
      let c = k;
      let ok = true;
      for (let t = 0; t < b && ok; t++) { if (text[c] === '\\') c++; else ok = false; }
      if (ok && text[c] === '"') {
        c++;
        for (let t = 0; t < 4 && isSpace(text.charCodeAt(c)); t++) c++;
        if (text[c] === ':') {
          c++;
          for (let t = 0; t < 4 && isSpace(text.charCodeAt(c)); t++) c++;
          for (let t = 0; t < b && ok; t++) { if (text[c] === '\\') c++; else ok = false; }
          if (ok && text[c] === '"') {
            c++;
            const v0 = c;
            while (c < n) { const ch = text.charCodeAt(c); if (ch === 34 || ch === 92 || isSpace(ch)) break; c++; }
            let tail = c;
            let ok2 = c - v0 >= 12;
            for (let t = 0; t < b && ok2; t++) { if (text[tail] === '\\') tail++; else ok2 = false; }
            if (ok2 && text[tail] === '"') { out += text.slice(pos, v0) + rep; pos = c; q = text.indexOf('"', c); continue; }
          }
        }
      }
    }
    q = text.indexOf('"', q + 1);
  }
  return out + text.slice(pos);
}

module.exports = { escB, KEYWORDS, ASSIGNMENT, ASSIGNMENT_LONG_NAME, EXTRA, maskPrivateKeys, maskUrlCredentials, maskJwt, maskAuthHeaders, maskJsonCredentials, looksLikeCredential };
