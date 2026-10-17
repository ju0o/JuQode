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
