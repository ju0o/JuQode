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
/** length of a line break at i - real, or JSON-escaped at ANY depth (`\n`, `\\n`, `\\\\n`, also `\r` `\t`) - else 0 */
function breakAt(text, i) {
  const c = text[i];
  if (c === '\n' || c === '\r') return 1;
  if (c !== '\\') return 0;
  let j = i;
  while (text[j] === '\\') j++;
  return text[j] === 'n' || text[j] === 'r' || text[j] === 't' ? j - i + 1 : 0;
}

/** End of the logical line starting at `from` (at most `lim`): a real newline / CR, or a JSON-escaped break at ANY depth. A backslash run is
 * crossed ONCE (never rescanned per position - a run of n backslashes must cost O(n), not O(n^2)); `stopAt(c)` ends the scan at a character. */
function scanLine(text, from, lim, stopAt, tabBreaks = true) {
  let end = from;
  while (end < lim) {
    const c = text[end];
    if (c === '\n' || c === '\r') break;
    if (c === '\\') {
      let j = end;
      while (text[j] === '\\') j++;
      const f = text[j];
      if (f === 'n' || f === 'r' || (tabBreaks && f === 't')) break;
      end = j;
      continue;
    }
    if (stopAt && stopAt(c)) break;
    end++;
  }
  return end;
}

/** A leading `\b` that also holds after a JSON escape: in a stored stream line `a\nghp_…` the `n` is a word
 * character, so a plain `\b` never saw the token start. */
const escB = (re) => (re.source.startsWith('\\b') ? new RegExp(`(?:\\b|(?<=\\\\[nrt]|%[0-9A-Fa-f]{2}))${re.source.slice(2)}`, re.flags) : re);

/* One keyword list for both maskers' `name = value` rules (the env-var rule of qc/run.js is upper-case on purpose). */
const KEYWORDS = 'api[\\s_-]?key|access[\\s_-]?token|refresh[\\s_-]?token|auth(?:orization)?[\\s_-]?(?:token)?(?!\\b\\s*[:=]\\s*["\']?(?:basic|bearer|digest|negotiate|token)\\b)|proxy[\\s_-]?authorization(?!\\b\\s*[:=]\\s*["\']?(?:basic|bearer|digest|negotiate|token)\\b)|cookie|set[\\s_-]?cookie|credential|token|password|passwd|secret(?:[\\s_-]?access[\\s_-]?key)?|private[\\s_-]?key|client[\\s_-]?secret';
const VALUE = '\\s*[:=]\\s*["\']?(?!(?:string|number|boolean|any|unknown|void|never|object|bigint|symbol|undefined|null)\\b)[^\\s"\',;]{4,}["\']?';   // `HTTP2_HEADER_COOKIE: string;` is a declaration, not an assignment
/* …with a name prefix of at most 64 characters (a longer prefix would make the scan quadratic) … */
const ASSIGNMENT = new RegExp(`\\b(?:[\\w.-]{0,64}(?:${KEYWORDS}))\\b${VALUE}`, 'gi');
/* …and the same without any prefix, so a name whose prefix is longer still has its keyword and value masked. */
const ASSIGNMENT_LONG_NAME = new RegExp(`(?:${KEYWORDS})\\b${VALUE}`, 'gi');

/* Long env-style names (up to 255 characters). Structure decides, not the name: `NAME=value` with nothing around the `=` is a shell / dotenv
 * assignment and is masked; `const NAME = "x"`, `process.env.NAME = v`, `NAME: string;` and `NAME: {` are code and are kept UNLESS the value itself
 * looks like a credential (12+ / 16+ characters mixing letters and digits, no '.' or '-' separated words, not followed by `;` or a type bracket).
 * A quoted value is masked WITH both quotes, so no stray quote is left behind. */
const ENV_KW = 'TOKEN|SECRET|PASSWORD|APIKEY|API_KEY|PRIVATE_KEY|CREDENTIALS?|COOKIE';
/* a name whose LAST word says it is configuration, not a secret (COOKIE_SECURE, COOKIE_DOMAIN, TOKEN_TTL, SESSION_COOKIE_NAME, SECRET_..._CSV) */
const ENV_BENIGN = 'SECURE|DOMAIN|TTL|NAME|PATH|FILE|URL|ID|MODE|ENABLED|TIMEOUT|AGE|CSV|DIR|HOST|PORT|EXPIRES|VERSION|LENGTH|SIZE|COUNT|LIMIT|TYPE|ALGORITHM|HEADER|PREFIX|SUFFIX';
const ENV_NAME_ANY = `\\b[A-Z0-9_]{0,255}(?:${ENV_KW})[A-Z0-9_]{0,255}`;
const ENV_NAME_ANY_BOUNDARY = escB(new RegExp(ENV_NAME_ANY)).source;
const ENV_NAME = `\\b[A-Z0-9_]{0,255}(?:${ENV_KW})(?![A-Z0-9_]{0,255}_(?:${ENV_BENIGN})(?![A-Z0-9_]))[A-Z0-9_]{0,255}`;   // (a configuration name: only a benign VALUE is exempt, see ENV_LONG)
const SP = '(?:[ \\t]|\\\\+t)';                      // a space, a tab, or a JSON-escaped tab
const Q = '(?:\\\\*["\'])';                          // a quote, also backslash-escaped at any depth
const ENV_SPACED_EQUALS = `${ENV_NAME_ANY_BOUNDARY}${SP}+=${SP}+`;
/* `NAME=value`: the value is a whole quoted string (spaces allowed) or a token that ends at whitespace, a quote, ; ) , or a backslash - never a
 * bare \S+ that swallows the code after it. Booleans, numbers, paths and dotted domains are configuration, not secrets. */
const ENV_VALUE = `(?!(?:true|false|null|undefined|\\d+)(?![A-Za-z0-9_])|\\.{0,2}/|~|\\.[A-Za-z])(?:"[^"\\r\\n]{0,4096}"|'[^'\\r\\n]{0,4096}'|(\\\\{1,1023})"(?:(?!\\1")[^\\r\\n]){0,4096}\\1"|[^\\s"'\`;),\\\\]+)`;
/* Capture each candidate value once, then inspect its characters in one pass. Bounded look-aheads missed credentials
 * whose first digit appeared after 512 characters; unbounded look-aheads would rescan long values quadratically. */
const ENV_CREDENTIAL_CANDIDATES = [
  [new RegExp(`(${ENV_NAME_ANY_BOUNDARY}=)(${Q}?)([A-Za-z0-9+/=_-]{16,})(${Q}?)`, 'g'), true],
  [new RegExp(`(${ENV_SPACED_EQUALS})(${Q}?)([A-Za-z0-9+/=_]{16,})(${Q}?)`, 'g'), true],
  [new RegExp(`(${ENV_NAME_ANY_BOUNDARY}${SP}*:${SP}*)(${Q}?)([^\\s"';<>()\\[\\]\\\\,]{12,})(?=[\\s"',\\\\]|$)(${Q}?)`, 'g'), false],
];
function looksLikeMixedCredential(value) {
  let letter = false;
  let digit = false;
  for (let i = 0; i < value.length && !(letter && digit); i++) {
    const c = code(value[i]);
    letter ||= isAlpha(c);
    digit ||= isDigit(c);
  }
  return letter && digit;
}
function containsDigit(value) {
  for (let i = 0; i < value.length; i++) if (isDigit(code(value[i]))) return true;
  return false;
}
function maskEnvCredentialLooking(text, rep) {
  for (const [pattern, skipFileExtension] of ENV_CREDENTIAL_CANDIDATES) {
    text = text.replace(pattern, (whole, prefix, openingQuote, value, closingQuote, offset, source) => {
      if (!looksLikeMixedCredential(value)) return whole;
      if (skipFileExtension) {
        const suffix = offset + prefix.length + openingQuote.length + value.length;
        if (source[suffix] === '.' && isAlpha(code(source[suffix + 1] || ''))) return whole;
      }
      return rep;
    });
  }
  return text;
}
const API_KEY_CREDENTIAL = /\bapi_key[ \t]*=[ \t]*["']?([A-Za-z0-9_-]{16,})/g;
function maskApiKeyCredential(text, rep) {
  return text.replace(API_KEY_CREDENTIAL, (whole, value) => containsDigit(value) ? rep : whole);
}
const ENV_LONG = [
  new RegExp(`${ENV_NAME}=${ENV_VALUE}`, 'g'),                                  // a: dotenv, configuration names exempt for a benign value
];

/* Header-ish shapes the generic rules miss. Bounded quantifiers only. */
const EXTRA_RE = [
  /(?<=(?:\b|(?<=\\[nrt]|%[0-9A-Fa-f]{2}))x-(?:auth-token|api-key|access-token|csrf-token)["']?[ \t]{0,4}:[ \t]{0,4}["']?)[^\s"',;]{4,}/gi,   // only the value: the name and a JSON document stay intact
].map((r) => (r.source.startsWith('\\b') ? escB(r) : r));

/* ── Cookie / Set-Cookie headers ───────────────────────────────────────────────────────────────── */
/* The header name is a header only when the character before it does not continue an identifier (`SSL_OP_COOKIE_EXCHANGE`,
 * `HTTP2_HEADER_COOKIE`); an escaped break (`\\n`, `\\r`, `\\t`) or a `%XX` before it counts as a boundary. The separator is `:` (HTTP header),
 * `=` (`Cookie=sid=x`) or `,` (`setHeader('Cookie', 'sid=x')`, `.append("Cookie", "...")`), the name may be quoted, even escaped. */
const COOKIE_NAME = /(?:(?<![A-Za-z0-9_])|(?<=\\[nrt]|%[0-9A-Fa-f]{2}))((?:set-)?cookie)(?:(\\*["'])[ \t]*[:=,]|[ \t]*:|=|[ \t]*(,))[ \t]*/gi;
const COMPARE_OP = /^(?:=>|==|===|<=|>=|!=|!==)$/;
/** end of the operator when the `=` at `eq` is part of a SPACED comparison / arrow (` => `, ` == `, ` <= `…), else 0 */
function spacedOperatorEnd(text, eq) {
  let s = eq;
  while (s > 0 && eq - s < 2 && '<>!='.includes(text[s - 1])) s--;
  let e = eq + 1;
  while (e < text.length && e - eq < 3 && '=>'.includes(text[e])) e++;
  return COMPARE_OP.test(text.slice(s, e)) && text[s - 1] === ' ' && text[e] === ' ' ? e : 0;
}
/** The `=` at `eq` is NOT a cookie-pair separator when it is a spaced comparison / arrow, or a spaced assignment of a plain default literal
 * (`cookie: str = ""`, `maxAge = 7`, `= undefined`, `= {}`): code and prose, not a credential. */
const DEFAULT_LITERAL = /^(?:""|''|``|\{\}|\[\]|(?:undefined|null|true|false)(?![A-Za-z0-9_])|\d{1,3}(?![A-Za-z0-9_]))/;
function benignEq(text, eq) {
  if (spacedOperatorEnd(text, eq)) return true;
  return text[eq - 1] === ' ' && text[eq + 1] === ' ' && DEFAULT_LITERAL.test(text.slice(eq + 2, eq + 14));
}
/** Once the header NAME is recognised the WHOLE value is masked - no cookie pair has to be parsed, so `sid = x`, `a=>b; sid=x`,
 * `=x; sid=x`, `sid==x` and a `\t` inside the value all go. What keeps ordinary code and prose safe is only this: the value must contain an
 * `=` that is not a spaced comparison / arrow (` => `, ` == `, ` <= `…). So `cookie: unknown) => void`, `cookie: string;` and
 * `Cookie: please accept the terms` stay; `Cookie: please = accept` is masked (a documented trade-off). The value ends at the end of the
 * line (real, or a JSON-escaped \n / \r - NOT \t, which is value content) or, inside a quoted context, at the closing quote (an escaped
 * quote does not close it). Per-line and per-quote end positions and the next `=` are memoized, so the scan is linear in the text however
 * many `Cookie:` it repeats. */
function maskCookieHeaders(text, rep) {
  if (!/cookie/i.test(text)) return text;
  const re = new RegExp(COOKIE_NAME.source, COOKIE_NAME.flags);
  const n = text.length;
  const endCache = new Map();                 // key -> [from, end]: the first terminator at or after any start in [from, end]
  let eqFrom = -1;
  let eqAt = -1;
  const nextEq = (i) => { if (eqFrom >= 0 && i >= eqFrom && (eqAt < 0 || eqAt >= i)) return eqAt; eqFrom = i; eqAt = text.indexOf('=', i); return eqAt; };
  /* first `=` at or after i that satisfies pred, computed once per scan (the answer for a later start inside the scanned range is the same) */
  const memoNext = (pred) => {
    let from = -1;
    let at = -1;
    return (i) => {
      if (from >= 0 && i >= from && (at < 0 || at >= i)) return at;
      from = i;
      let e = text.indexOf('=', i);
      while (e >= 0 && !pred(e)) e = text.indexOf('=', e + 1);
      at = e;
      return e;
    };
  };
  const nextCredEq = memoNext((e) => !benignEq(text, e));                                              // a pair separator
  const nextPairEq = memoNext((e) => !benignEq(text, e) && e > 0 && !isSpace(text.charCodeAt(e - 1)) && !isSpace(text.charCodeAt(e + 1)));   // ... written `name=value`, no spaces
  let naFrom = -1;
  let naAt = -1;
  const NON_ASCII = /[^\x00-\x7f]/g;
  const nextNonAscii = (i) => {
    if (naFrom >= 0 && i >= naFrom && (naAt < 0 || naAt >= i)) return naAt;
    naFrom = i; NON_ASCII.lastIndex = i;
    const r = NON_ASCII.exec(text);
    naAt = r ? r.index : -1;
    return naAt;
  };
  const valueEnd = (start, term, escTerm) => {
    const key = `${term || ''}${escTerm ? 'e' : ''}`;
    const c = endCache.get(key);
    if (c && start >= c[0] && start <= c[1]) return c[1];
    let end = start;
    while (end < n) {
      const ch = text[end];
      if (ch === '\n' || ch === '\r') break;
      if (ch === '\\') {
        let j = end;
        while (text[j] === '\\') j++;
        const f = text[j];
        if (f === 'n' || f === 'r') break;
        if (term && f === term) { if (escTerm) break; end = j + 1; continue; }
        end = j;
        continue;
      }
      if (term && ch === term) break;
      end++;
    }
    endCache.set(key, [start, end]);
    return end;
  };
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = m.index > 0 ? text[m.index - 1] : '';
    let vs = m.index + m[0].length;
    let term = before === '"' || before === "'" || before === '`' ? before : null;
    let escTerm = false;
    const sepChar = m[0].trimEnd().slice(-1);
    if (text[vs] === '[' && (text[vs + 1] === '"' || text[vs + 1] === '\\' || (sepChar === ',' && text[vs + 1] === "'"))) vs++;       // JSON {"Set-Cookie": ["sid=x"]}; a JS array of single-quoted strings is code
    const q0 = vs;
    while (text[vs] === '\\') vs++;
    if (text[vs] === '"' || text[vs] === "'") { term = text[vs]; escTerm = vs > q0; vs++; }   // quoted value, escaped or not
    else vs = q0;
    let end = valueEnd(vs, term, escTerm);
    if (term && end > vs && text[end - 1] === '=' && text[end] === term) end = valueEnd(vs, null, false);
    else if (term && vs > q0) {            // `Cookie: "sid"=x` (also escaped): the quote belonged to the NAME - the value is what follows its closing quote
      let j = end;
      while (text[j] === '\\') j++;
      const e0 = nextEq(vs);
      if (text[j] === term && text[j + 1] === '=' && (e0 < 0 || e0 >= end)) { term = null; vs = q0; end = valueEnd(vs, null, false); }
    }
    /* credential-like: a pair-separator `=` with no prose (non-ASCII words) before it, OR a `name=value` pair written without spaces anywhere in the
     * value (prose before it does not protect it: `Cookie: 한글 sid=x`). A spaced `=` after prose (`Cookie: 만료 = 7일`) stays prose. */
    const eq = nextCredEq(vs);
    const na = nextNonAscii(vs);
    const pe = nextPairEq(vs);
    let credential = (eq >= 0 && eq < end && !(na >= 0 && na < eq)) || (pe >= 0 && pe < end);
    /* an UNQUOTED header name before a comma (`fn(Cookie, "sid=x")`, `Cookie, sid=x`) only counts when a pair (not `secure = false`) follows */
    if (credential && m[3] === ',' && !/^["'\\]*[^\s"'=,;]+=[^\s=]/.test(text.slice(vs, vs + 600))) credential = false;
    if (credential && end > vs) { out += text.slice(pos, vs) + rep; pos = end; re.lastIndex = Math.max(end, re.lastIndex); }
    else re.lastIndex = Math.max(vs, re.lastIndex);
  }
  return out + text.slice(pos);
}
/* `curl … -u user:secret`: the option is found first (linear), then `curl` must stand on the same line within the 512 characters before it. */
function maskCurlUser(text, rep) {
  if (!text.includes('curl')) return text;
  /* `-u user:pass` / `--user user:pass`, and the cookie options `-b "sid=…"` / `--cookie "sid=…"` (a value holding an `=`) */
  const re = /[ \t](?:-u|--user)(?:[ =]|[ \t]+)["']?[^\s:'"]+:[^\s'"]+|[ \t](?:-b|--cookie)(?:[ =]|[ \t]+)(?:"(?=[^"\r\n]{0,4096}=)[^"\r\n]{0,4096}"|'(?=[^'\r\n]{0,4096}=)[^'\r\n]{0,4096}'|(\\{1,1023})"(?=[^\r\n]{0,4096}=)(?:(?!\1")[^\r\n]){0,4096}\1"|[^\s'"=]*=[^\s'"]*)/g;   // the quoted argument is consumed to its closing quote (escaped quotes too)
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const from = Math.max(pos, m.index - 512);
    const win = text.slice(from, m.index);
    const nl = Math.max(win.lastIndexOf('\n'), win.lastIndexOf('\r')) + 1;
    const at = win.slice(nl).search(/(?:\b|(?<=\\[nrt]|%[0-9A-Fa-f]{2}))curl\b/);
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
  const brk = (i) => breakAt(text, i);
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
  let eqFrom = -1;
  let eqAt = -1;
  const nextEq = (i) => { if (eqFrom >= 0 && i >= eqFrom && (eqAt < 0 || eqAt >= i)) return eqAt; eqFrom = i; eqAt = text.indexOf('=', i); return eqAt; };
  let leFrom = -1;
  let leAt = -1;
  const lineEndFrom = (i) => { if (leFrom >= 0 && i >= leFrom && i <= leAt) return leAt; leFrom = i; leAt = scanLine(text, i, n, null, false); return leAt; };
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const scheme = m[1].toLowerCase();
    const start = m.index + m[0].length;
    let end = start;
    let credential = false;
    if (scheme === 'digest') {
      /* `key=value` anywhere in the (at most DIGEST_LOOK long) rest of the line makes it a credential; `Digest realm only` is prose.
       * The next `=` and the end of the line are memoized, so repeated `Authorization: Digest ` costs a few characters each. */
      const eq = nextEq(start);
      end = lineEndFrom(start);
      credential = eq >= 0 && eq < end && eq - start < DIGEST_LOOK;
      if (!credential) end = start;
    } else {
      while (end < n) { const c = text[end]; if (isSpace(c.charCodeAt(0)) || c === '"' || c === "'" || c === ',' || c === ';' || c === '\\') break; end++; }   // a backslash (escape, at any JSON depth) never belongs to a credential
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

module.exports = { ENV_LONG, escB, KEYWORDS, ASSIGNMENT, ASSIGNMENT_LONG_NAME, EXTRA, maskPrivateKeys, maskUrlCredentials, maskJwt, maskAuthHeaders, maskJsonCredentials, maskEnvCredentialLooking, maskApiKeyCredential, looksLikeCredential };
