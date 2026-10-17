'use strict';
/* V1-409 · the renderer is untrusted input. Everything here runs BEFORE the classifier, the DB,
 * a Work, a Quick Command or the shell sees a value, and none of it ever shortens a value:
 * too long means refused, not truncated and run.
 *
 * Limits are RESOURCE protection (a synchronous regex over 5M characters measured 0.9–2.1 s on
 * the main process), not a filter of dangerous content. The shell limit is bytes of UTF-8; the
 * rest are Unicode code points, so a Korean sentence and an emoji count one each. */

const LIMITS = Object.freeze({
  text: 20000,          // request, answer, retry reason, Task goal, one acceptance criterion
  qcPhrase: 4096,       // a Quick Command sentence
  shellBytes: 64 * 1024,
  criteria: 50,         // acceptance criteria per Task
  dependencies: 100,    // Task ids per Task
  id: 128,              // any id / key the renderer names
});

/* UTF-16 length bounds the code-point count: points <= length <= 2*points. Only the band in
 * between needs a real count, so a 5M-character value is refused without scanning it. */
function overPoints(s, max) {
  if (s.length > max * 2) return true;
  if (s.length <= max) return false;
  let n = 0;
  for (const _ of s) if (++n > max) return true;   // eslint-disable-line no-unused-vars
  return false;
}
const overBytes = (s, max) => (s.length > max ? true : Buffer.byteLength(s, 'utf8') > max);

const tooLong = (limit, unit) => ({ ok: false, reason: 'input-too-long', limit, unit });
const badInput = () => ({ ok: false, reason: 'bad-input' });

/** A string within `max` code points. Anything else (array, object, null, number) is refused:
 * `String(x)` on an array is how a 5M-character payload used to slip past a length check. */
function text(value, max = LIMITS.text, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') return badInput();
  if (overPoints(value, max)) return tooLong(max, 'chars');
  if (!allowEmpty && !value.trim()) return { ok: false, reason: 'empty-input' };
  return null;
}

function shellLine(value) {
  if (typeof value !== 'string') return badInput();
  if (overBytes(value, LIMITS.shellBytes)) return tooLong(LIMITS.shellBytes, 'bytes');
  return null;
}

const shortId = (v) => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.id;

/** The Task input / patch the renderer sends. Shape and size only; meaning stays in `repo`. */
function taskInput(input, { patch = false } = {}) {
  if (input == null && !patch) return null;                       // createTask treats it as {}
  if (typeof input !== 'object' || Array.isArray(input)) return badInput();
  if (Object.hasOwn(input, 'goal')) {
    const r = text(input.goal, LIMITS.text, { allowEmpty: true });
    if (r) return r;
  }
  if (Object.hasOwn(input, 'dependencies')) {
    const d = input.dependencies;
    if (!Array.isArray(d)) return badInput();
    if (d.length > LIMITS.dependencies) return tooLong(LIMITS.dependencies, 'items');
    if (d.some((id) => typeof id !== 'string' || id.length > LIMITS.id)) return badInput();
  }
  if (Object.hasOwn(input, 'acceptanceCriteria')) {
    const c = input.acceptanceCriteria;
    if (!Array.isArray(c)) return badInput();
    if (c.length > LIMITS.criteria) return tooLong(LIMITS.criteria, 'items');
    for (const item of c) {
      const t = typeof item === 'string' ? item : item?.text;
      if (typeof item !== 'string' && (item == null || typeof item !== 'object' || Array.isArray(item))) return badInput();
      if (typeof t !== 'string') return badInput();
      if (overPoints(t, LIMITS.text)) return tooLong(LIMITS.text, 'chars');
      if (typeof item === 'object' && item.id != null && (typeof item.id !== 'string' || item.id.length > LIMITS.id)) return badInput();
    }
  }
  return null;
}

/* The only `detail` a Task channel may send: a code from this closed list, never a message.
 * Keys are the exact TypeError texts `db/repo.js` throws for a renderer mistake; anything not
 * listed — SQLite text, a path, a stack, a future message — becomes `internal`. */
const TASK_ERRORS = new Map([
  ['Task goal must not be empty', 'goal-empty'],
  ['Project not found', 'project-not-found'],
  ['Task not found', 'task-not-found'],
  ['Task patch must be an object', 'bad-input'],
  ['acceptanceCriteria must be an array', 'criteria-invalid'],
  ['each acceptance criterion must have non-empty text', 'criterion-empty'],
  ['acceptance criterion ids must be non-empty and unique', 'criteria-invalid'],
  ['dependencies must be an array of Task ids', 'dependencies-invalid'],
  ['dependencies must not contain duplicates', 'dependencies-invalid'],
  ['a Task cannot depend on itself', 'dependencies-invalid'],
  ['every dependency must be an existing Task in the same Project', 'dependencies-invalid'],
  ['Task dependencies must not create a cycle', 'dependencies-invalid'],
  ['invalid Task status', 'status-invalid'],
]);
const REVIEW_ERRORS = new Map([
  ['criterion verdict must be pass or fail', 'review-invalid'],
  ['criterion review requires distinct Run evidence ids', 'review-evidence'],
  ['Task not found', 'task-not-found'],
  ['acceptance criterion not found', 'review-invalid'],
  ['review Run must be an ended Run of this Task', 'review-run'],
  ['a PASS review requires a successful Run outcome', 'review-run'],
  ['Run Context does not contain this current acceptance criterion', 'review-run'],
  ['criterion review evidence must belong to the selected Run', 'review-evidence'],
  ['test evidence for PASS must show a returned command with exit code 0 and at least one passing test', 'review-evidence'],
  ['changed-file evidence for PASS must be measured', 'review-evidence'],
  ['this criterion requires its latest scoped test command(s) to return with exit code 0', 'review-evidence'],
]);
const TASK_CODES = new Set([...TASK_ERRORS.values(), ...REVIEW_ERRORS.values(), 'internal']);

function taskErrorCode(error, table = TASK_ERRORS) {
  if (error instanceof TypeError) {
    const hit = table.get(error.message);
    if (hit) return hit;
    if (/^unsupported Task field: /.test(error.message)) return 'bad-input';   // key echoed nowhere
  }
  return 'internal';
}

/** A short code-ish string from outside (errno, sqlite code) or null. */
const safeCode = (c) => (typeof c === 'string' && /^[A-Za-z0-9_.-]{1,48}$/.test(c) ? c : null);

/* A `detail` that leaves for the renderer: stack frames dropped, home/user directories shown as
 * `~`, secret-shaped text masked by BOTH maskers, then capped. It is for text a CHILD process
 * wrote (stderr); internal exception messages never get here - Task channels send codes. */
const os = require('node:os');
const { safeSnapshot } = require('./work/context');
const { mask } = require('./qc/run');
const DETAIL_CAP = 500;
function scrubString(value) {
  let t = String(value);
  const home = os.homedir();
  if (home && home.length > 1) t = t.split(home).join('~');
  t = t.replace(/(?:[A-Za-z]:\\Users\\|\/home\/|\/Users\/)[^/\\\s]+/g, '~')
    .replace(/^[ \t]+at .*$/gm, '').replace(/\n{2,}/g, '\n');
  t = mask(safeSnapshot(t).safe).trim();
  return t.length > DETAIL_CAP ? `${t.slice(0, DETAIL_CAP)}…` : t;
}
function scrubDetail(value, depth = 0) {
  if (typeof value === 'string') return scrubString(value);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 3) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubDetail(v, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDetail(v, depth + 1)]));
  return null;
}
/* `open-project` / `open-path` echo the folder the USER picked (SC-01's technical disclosure);
 * everything else passes through the scrub. */
const DETAIL_EXEMPT = new Set(['juqode:open-project', 'juqode:open-path']);
const publicOut = (channel, r) => (r && typeof r === 'object' && r.detail != null && !DETAIL_EXEMPT.has(channel)
  ? { ...r, detail: scrubDetail(r.detail) } : r);

module.exports = { scrubString, scrubDetail, publicOut, DETAIL_EXEMPT, LIMITS, text, shellLine, taskInput, shortId, taskErrorCode, TASK_ERRORS, REVIEW_ERRORS, TASK_CODES, safeCode,
  overPoints, overBytes };
