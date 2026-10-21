/* V1-409 · what the user reads when main refuses an input before running anything.
 * Main answers a CODE (`input-too-long` + limit + unit, `bad-input`, or a Task `detail` code);
 * the sentence is written here. Nothing is cut: the text stays in its field. */
import { C } from './copy.js';

const T = C.gap.input;

/** A sentence for a refused-input answer, or null when `res` is not one. */
export function inputProblem(res) {
  if (!res || res.ok) return null;
  if (res.reason === 'input-too-long') return T.tooLong[res.unit]?.(res.limit) ?? T.tooLong.chars(res.limit);
  if (res.reason === 'bad-input') return T.bad;
  return null;
}

/** A Task create/update refusal -> a sentence. Unknown or `internal` codes get the generic one. */
export function taskProblem(res) {
  return inputProblem(res) ?? (res?.reason === 'invalid-task' ? (T.task[res.detail] ?? C.gap.task.draftFailed) : null);
}

/** A refused allow/answer (any `ok:false` with a code that is not an input-size problem) -> the EXISTING refusal sentence plus the raw code, so a refusal is never silent.
 *  No new copy: `C.gap.workRefused` is what the start-refusal card already shows above its code. Null for success or a non-answer. */
export function refusalNote(res) {
  const p = inputProblem(res);
  if (p) return p;
  if (!res || res.ok || typeof res.reason !== 'string') return null;
  const d = typeof res.detail === 'string' ? res.detail : res.detail?.reason;
  return `${C.gap.workRefused} ${res.reason}${typeof d === 'string' && d ? `:${d}` : ''}`;
}
