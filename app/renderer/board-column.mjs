/* Where a Task sits on the board.
 * The column comes from the Task and its latest Run. It does not invent progress,
 * and a Run that stopped unknown is never treated as finished. */

export function columnFor(task, run) {
  const status = run?.status ?? null;
  const outcome = run?.outcome ?? null;
  if (status === 'permission_waiting' || status === 'input_waiting' || status === 'cancel_requested') return 'needs';
  if (outcome === 'ended_unknown') return 'needs';
  if (task?.status === 'blocked') return 'needs';
  if (status && status !== 'ended') return 'doing';
  if (task?.verdict === 'pass' || task?.status === 'complete') return 'done';
  if (outcome === 'failed' || task?.verdict === 'fail' || outcome || status === 'ended') return 'review';
  return 'queued';
}

/* How the tile is coloured. Failure is the only red. Unknown is not success. */
export function tileTone(task, run) {
  const outcome = run?.outcome ?? null;
  if (outcome === 'ended_unknown') return 'unknown';
  if (outcome === 'failed' || task?.verdict === 'fail') return 'fail';
  const column = columnFor(task, run);
  if (column === 'needs') return 'needs';
  if (column === 'doing') return 'doing';
  if (column === 'done') return 'done';
  if (outcome === 'partial' || outcome === 'cancelled_partial') return 'partial';
  return 'quiet';
}
