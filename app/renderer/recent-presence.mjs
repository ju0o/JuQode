/* SC-01 recent row: is the folder still there?
 *
 * `project.recent` attaches a machine `presence`. This file decides the one line the row may
 * show, and whether the last-Work chip is still honest. The sentences stay in `copy.js`.
 * A folder that is still there, including an empty one, is not a failure. */

export function recentPresenceLine(presence, lines) {
  if (!presence || presence.ok === true) return null;
  const line = lines && (lines[presence.reason] || lines.unknown);
  return typeof line === 'string' && line !== '' ? line : null;
}

/* A finished chip on a folder we cannot open reads as ready. Hide it. A row from an older
 * payload with no presence keeps the chip, because there is no new fact to contradict it. */
export function recentShowsLastWork(presence) {
  return !presence || presence.ok === true;
}
