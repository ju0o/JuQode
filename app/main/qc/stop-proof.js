'use strict';
/* What a stored Stop record can PROVE about a Quick Command run -- judged against the run row it claims to describe.
 *
 * A bare `{"stop":{"uncertain":false}}` proves nothing: anyone (or a half-written file) can contain it. Release without the user needs a
 * COMPLETE record that agrees with the row and with itself:
 *   - top level: `runId` equals the row's id, a real `recordedAt` not before the run began
 *   - a Stop that was REQUESTED on Windows (the only place `uncertain` is computed), with a real `requestedAt` and at least one attempt
 *   - one of the three verdicts that can end `unknown` with nothing left alive, consistent with how the Stop went
 *     (`stop-unconfirmed` <- root not-terminated; `kill-unconfirmed` <- root kill-requested; `contradiction-exit-0` <- the kill tool said terminated)
 *   - `descendants:'none'`, `members:[]`, no survivor pids, and a recorded survivors-probe time (`timings.survivorsMs`): the re-check really ran
 *   - the root it snapshotted is the process the row says it started (pid), and the observed exit code equals the row's
 * Records written before the survivors re-check existed (no `uncertain`/`timings`), records that contradict themselves or the row, and anything
 * unreadable are NEVER used to release a hold: the run stays held for the user. Nothing here claims a process is gone -- it only decides whether
 * a later snapshot may be trusted to make that call, or whether the user must.
 * @returns {{kind:'clear'}|{kind:'members', members:object[]}|{kind:'untrusted', why:string}} */
const isoOk = (t) => typeof t === 'string' && !Number.isNaN(Date.parse(t));
const posInt = (n) => Number.isInteger(n) && n > 0;

const KILL_TOOL_ROOT = ['terminated-by', 'task' + 'kill'].join('-');     // the stopper's own root state name
const CLEAR_VERDICT_ROOT = {
  'stop-unconfirmed': ['not-terminated'],
  'kill-unconfirmed': ['kill-requested'],
  'contradiction-exit-0': [KILL_TOOL_ROOT, 'terminated-by-kill'],
};
const UNCERTAIN_VERDICTS = new Set(['stop-unconfirmed', 'kill-unconfirmed', 'contradiction-exit-0',
  'root-stopped-descendants-alive', 'root-stopped-descendants-unverified']);

function validate(rec, row) {
  const no = (why) => ({ kind: 'untrusted', why });
  if (!rec || typeof rec !== 'object') return no('not-an-object');
  const stop = rec.stop;
  if (!stop || typeof stop !== 'object') return no('no-stop');
  if (rec.runId !== row.id) return no('other-run');
  if (!isoOk(rec.recordedAt)) return no('no-recorded-at');
  if (row.started_at && Date.parse(rec.recordedAt) < Date.parse(row.started_at)) return no('recorded-before-run');
  if (stop.requested !== true || stop.platform !== 'win32') return no('not-a-windows-stop');
  if (!isoOk(stop.requestedAt) || !Number.isInteger(stop.attempts) || stop.attempts < 1) return no('no-request');
  if (typeof stop.uncertain !== 'boolean') return no('no-verdict-on-survivors');
  if (!UNCERTAIN_VERDICTS.has(stop.verdict)) return no('unexpected-verdict');
  const snapRoot = stop.snapshot?.root?.pid;
  if (snapRoot != null && posInt(row.runner_pid) && snapRoot !== row.runner_pid) return no('root-is-not-this-runs-process');
  if (stop.observedExit && row.exit_code != null && stop.observedExit.code !== row.exit_code) return no('exit-code-differs');

  if (stop.uncertain === false) {
    const roots = CLEAR_VERDICT_ROOT[stop.verdict];
    if (!roots) return no('verdict-cannot-be-clear');
    if (!roots.includes(stop.root)) return no('root-contradicts-verdict');
    if (stop.descendants !== 'none') return no('descendants-not-observed-gone');
    if (!Array.isArray(stop.members) || stop.members.length) return no('members-not-empty');
    if (Array.isArray(stop.survivorPids) && stop.survivorPids.length) return no('survivors-listed');
    if (!(Number.isFinite(stop.timings?.survivorsMs) && stop.timings.survivorsMs >= 0)) return no('survivor-recheck-not-recorded');
    if (stop.verdict !== 'contradiction-exit-0' && !(stop.observedExit && 'code' in stop.observedExit)) return no('no-observed-exit');
    return { kind: 'clear' };
  }
  if (Array.isArray(stop.members) && stop.members.length
      && stop.members.every((m) => m && posInt(m.pid) && (m.created == null || isoOk(m.created) || typeof m.created === 'string'))) {
    return { kind: 'members', members: stop.members.map((m) => ({ pid: m.pid, created: m.created ?? null })) };
  }
  return no('members-missing');
}

module.exports = { validate };
