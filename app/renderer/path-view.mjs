/* How a file PATH is shown to a person -- and what is never touched.
 *
 * Stored evidence keeps the exact path string. This module only decides what the human summary prints:
 * the file NAME first, a short folder hint only when two names collide, and the full path on request.
 * It never invents a meaning for a file from its name (no "config", "docs", "source" labels), never
 * rewrites separators in what it hands back as `raw`, and masks token-shaped text in anything it
 * displays. Works for POSIX, Windows (drive letters, backslashes, UNC), Unicode (Hangul) and long names. */

const SEP = /[\\/]+/;

/** Split without altering: `raw` is returned exactly as given. */
export function splitPath(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const parts = text.split(SEP).filter((part) => part !== '');
  const name = parts.length ? parts[parts.length - 1] : text;
  return { raw: text, parts, name, dir: parts.slice(0, -1) };
}

/* Token-shaped text is masked for DISPLAY. The same families `qc/run.js` masks for command output. */
const TOKENISH = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}/g,
  /\bsk[-_](?:live|test)?[-_]?[A-Za-z0-9_-]{16,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
export function maskForDisplay(text) {
  let out = String(text ?? '');
  for (const re of TOKENISH) out = out.replace(re, '***');
  return out;
}

/** Keep both ends of a long NAME (extension and the start survive); never used on `raw`. */
export function middleEllipsis(text, max = 28) {
  const chars = Array.from(String(text));
  if (chars.length <= max) return String(text);
  const keep = max - 1;
  const tail = Math.min(Math.ceil(keep / 2), 12);
  return `${chars.slice(0, keep - tail).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

/**
 * The human-readable list of changed files.
 * @param {string[]} paths exact paths as stored
 * @returns {{count:number, items:{raw:string, name:string, hint:string|null, label:string, shown:string}[]}}
 *   `label` is what disambiguates two same-named files (`name` alone, or `folder/name` just long
 *   enough to be unique); `shown` is `label` masked and shortened for the chip; `raw` is untouched.
 */
export function presentFiles(paths) {
  const list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p !== '') : [];
  const seen = new Set();
  const unique = list.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  const split = unique.map(splitPath);
  const byName = new Map();
  for (const item of split) byName.set(item.name, (byName.get(item.name) ?? 0) + 1);
  const items = split.map((item) => {
    let depth = 0;
    let label = item.name;
    if ((byName.get(item.name) ?? 0) > 1) {
      // add parent folders until no OTHER path with the same name shares this suffix
      const rivals = split.filter((o) => o !== item && o.name === item.name);
      depth = 1;
      const suffix = (o, d) => o.parts.slice(Math.max(0, o.parts.length - 1 - d)).join('/');
      while (depth <= item.parts.length && rivals.some((o) => suffix(o, depth) === suffix(item, depth))) depth += 1;
      label = suffix(item, Math.min(depth, item.parts.length - 1));
    }
    const hint = label === item.name ? null : label.slice(0, label.length - item.name.length - 1);
    return { raw: item.raw, name: item.name, hint, label, shown: middleEllipsis(maskForDisplay(label)) };
  });
  return { count: items.length, items };
}
