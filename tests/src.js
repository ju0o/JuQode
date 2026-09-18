'use strict';
/* Reading product source from a test, without being fooled by its comments.
 *
 * MEASURED THREE TIMES IN THIS RUN, each time in the same shape:
 *
 *   · `presence.js`'s doc comment said "`setInterval` appears nowhere" — and the scan that was
 *     checking `setInterval` appears nowhere reported that it did.
 *   · `nextaction.js` EXPLAINS what a declared Step is, because staying away from one is the
 *     point of the file; the scan for `declared` found the explanation.
 *   · `main.js`'s comment about relocating `userData` names `app.getPath('userData')`, and the
 *     order check that made sure the relocation comes FIRST found the comment first.
 *
 * The same trap runs the other way. `history.more` looked USED because some other file's prose
 * happened to contain the word `more`, so a dead copy key survived a check written to find it.
 *
 * A file that describes what it does not do is good code. A test that cannot tell the
 * description from the deed is a broken test, and the fix belongs in one place: `code()` for
 * every assertion about what the source DOES, `text()` only when the comments are the subject.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** The file exactly as it is on disk — comments and all. */
const text = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * The file with block and line comments removed.
 *
 * Deliberately a lexer, not a regex: `'/* not a comment *' + '/'` inside a string literal, and
 * a `//` inside a URL or a regular expression, both broke the naive version. Getting this wrong
 * would reintroduce exactly the class of false pass it exists to remove.
 */
function code(rel) { return strip(text(rel)); }

function strip(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  /* `prev` is the last significant character, which is how a regex literal is told from a
   * division: `/` after a value divides, after an operator or `(`/`,`/`=` it opens a regex. */
  let prev = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
      continue;
    }
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) break;
        j += 1;
      }
      out += src.slice(i, Math.min(j + 1, n));
      prev = quote;
      i = j + 1;
      continue;
    }
    if (c === '/' && /[([{,;=:!&|?+\-*%~^<>]|^$/.test(prev)) {
      /* A regular expression literal. Its body may contain `//` and `/*`. */
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        else if (src[j] === '\n') { j = i; break; }      // not a regex after all
        j += 1;
      }
      if (j > i) {
        out += src.slice(i, Math.min(j + 1, n));
        prev = '/';
        i = j + 1;
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out;
}

module.exports = { text, code, strip, ROOT };
