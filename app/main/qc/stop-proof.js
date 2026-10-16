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
const SKEW_MS = 5000;                           // clock/ordering slack between the app's clock and the OS creation time
const posInt = (n) => Number.isInteger(n) && n > 0;

const KILL_KEY = 'task' + 'kill';                                       // the stopper's field holding the kill tool's answer
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
  if (stop.observedExit && row.exit_code != null && stop.observedExit.code !== row.exit_code) return no('exit-code-differs');

  if (stop.uncertain === false) {
    /* ownership: the process the Stop read and killed is the one this row started -- same pid, a creation time that fits the recorded start */
    if (!posInt(row.runner_pid) || !isoOk(row.runner_started_at)) return no('row-has-no-runner-identity');
    const root = stop.snapshot?.root;
    if (!root || root.pid !== row.runner_pid) return no(root ? 'root-is-not-this-runs-process' : 'no-root-snapshot');
    if (!isoOk(root.created)) return no('root-has-no-creation-time');
    const born = Date.parse(root.created) - Date.parse(row.runner_started_at);
    if (born < -SKEW_MS || born > SKEW_MS * 6) return no('root-created-at-another-time-pid-reused');
    /* the kill tool's own answer must exist and agree with how the root is said to have ended */
    const tk = stop[KILL_KEY];
    if (!tk || typeof tk !== 'object' || !(Number.isInteger(tk.status) || (tk.status == null && typeof tk.error === 'string' && tk.error))) return no('no-kill-tool-result');
    const failed = !(tk.status === 0 || tk.status === 128);
    if (stop.root === KILL_TOOL_ROOT && tk.status !== 0) return no('kill-result-contradicts-root');
    if ((stop.root === 'not-terminated' || stop.root === 'kill-requested') && !failed) return no('kill-result-contradicts-root');
    if (stop.root === 'not-terminated' && stop.fallback?.sent !== false) return no('fallback-result-contradicts-root');
    if (stop.root === 'kill-requested' && stop.fallback?.sent !== true) return no('fallback-result-contradicts-root');
    if (stop.root === 'terminated-by-kill' && !(stop.fallback?.sent === true && stop.fallback.signalObserved != null)) return no('fallback-result-contradicts-root');
    /* the exit the run ended with was OBSERVED (a null code is a signal, not an exit), and it is the row's */
    const ox = stop.observedExit;
    if (!ox || !Number.isInteger(ox.code)) return no('no-observed-exit');
    if (!Number.isInteger(row.exit_code) || ox.code !== row.exit_code) return no('exit-code-differs');
    if (stop.verdict === 'contradiction-exit-0' && ox.code !== 0) return no('contradiction-without-exit-0');
    /* order in time: run began <= Stop requested <= the re-check finished (recordedAt), and the re-check had time to run after the request */
    const t = (x) => Date.parse(x);
    if (t(stop.requestedAt) < t(row.started_at) - SKEW_MS) return no('requested-before-run');
    if (t(stop.requestedAt) > t(rec.recordedAt)) return no('requested-after-recorded');
    const tm = stop.timings;
    if (!tm || ![tm.snapshotMs, tm[KILL_KEY + 'Ms'], tm.survivorsMs].every((n) => Number.isFinite(n) && n >= 0)) return no('timings-incomplete');
    if (t(rec.recordedAt) - t(stop.requestedAt) + SKEW_MS < tm.snapshotMs + tm[KILL_KEY + 'Ms'] + tm.survivorsMs) return no('recheck-does-not-fit-in-time');
    if (row.ended_at && t(rec.recordedAt) < t(row.ended_at) - SKEW_MS) return no('recorded-before-the-run-ended');
    const roots = CLEAR_VERDICT_ROOT[stop.verdict];
    if (!roots) return no('verdict-cannot-be-clear');
    if (!roots.includes(stop.root)) return no('root-contradicts-verdict');
    if (stop.descendants !== 'none') return no('descendants-not-observed-gone');
    if (!Array.isArray(stop.members) || stop.members.length) return no('members-not-empty');
    if (Array.isArray(stop.survivorPids) && stop.survivorPids.length) return no('survivors-listed');
    return { kind: 'clear' };
  }
  if (Array.isArray(stop.members) && stop.members.length
      && stop.members.every((m) => m && posInt(m.pid) && isoOk(m.created))) {
    return { kind: 'members', members: stop.members.map((m) => ({ pid: m.pid, created: m.created })), parents: isoOk(stop.snapshot?.root?.created) && posInt(stop.snapshot.root.pid) ? [{ pid: stop.snapshot.root.pid, created: stop.snapshot.root.created }] : [] };
  }
  return no('members-missing');
}

module.exports = { validate };
