'use strict';
/* What a Quick Command's Stop actually proved (WBS-23, `19` §C4; `07` §8.1, §8.5).
 *
 * A stop is three different facts and the old code collapsed them into "we asked, and it ended":
 *
 *   requested  we sent a termination request
 *   observed   something proved the ROOT was ended by it (not merely that it ended)
 *   descendants  whether the processes it had started are gone, still alive, or unknown
 *
 * Result states stay inside the existing `qc_status` set (`ok`/`failed`/`stopped`, and `unknown` --
 * whose card text, "끝났는지 확인할 수 없어요", is already approved copy). Nothing here adds a state; the
 * detail goes in `stop` evidence, which `ipc.js` stores next to the run.
 *
 * POSIX keeps its rule: `stopped` only from a signal (a cancelled child can still exit 0).
 * Windows has no signal, so the proof is different:
 *   - `taskkill /PID <pid> /T /F` exit 0 means taskkill terminated that process; 128 means it was
 *     not there (it ended by itself first -- NOT a stop); anything else is a failure and is never
 *     reported as a stop. A failed taskkill falls back to the owned handle's kill(), whose signal Node
 *     reports.
 *   - while the ChildProcess handle is open Windows cannot hand its pid to another process, and
 *     `spawnSync` keeps the event loop from closing it, so taskkill addresses OUR process.
 *   - descendants are judged against a snapshot taken just before the kill, matched by pid AND creation
 *     time, with a child required to be younger than its parent (a recycled parent id cannot adopt it).
 *     The snapshot is what was observed, not a promise about processes started after it.
 *   - Nothing here blocks the Electron main process: the snapshot and taskkill are asynchronous (a PowerShell
 *     snapshot took 0.5 s idle and ~2 s under load on H1, and up to its 15 s timeout when stuck). Because the
 *     owned handle can now close while the snapshot is read, the pid is re-checked against the handle
 *     IMMEDIATELY before taskkill: a process that ended in the meantime is never addressed (a pid is reusable).
 *   - A Stop that was requested and whose cause of ending cannot be shown (taskkill failed, no signal from the
 *     fallback) is `unknown` -- never `failed` and never `stopped`. `stop.uncertain` + `stop.members` say which
 *     processes might still be alive, so the Writer gate can hold until a later snapshot shows them gone. */
const { execFile } = require('node:child_process');

const PS_SNAPSHOT = "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToString('o') }";
const SNAPSHOT_TIMEOUT_MS = 15000;
const TASKKILL_TIMEOUT_MS = 15000;
/** The longest a Windows Stop can take before it has said what it knows: snapshot + taskkill + the survivors snapshot, each bounded. */
const STOP_WORST_CASE_MS = 2 * SNAPSHOT_TIMEOUT_MS + TASKKILL_TIMEOUT_MS;

function parseSnapshot(stdout) {
  const rows = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /^(\d+)\|(\d+)\|(.+)$/.exec(line.trim());
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), created: m[3] });
  }
  return rows.length ? rows : null;
}

/** `[{pid, ppid, created}]` for every process, or null if it could not be read. Asynchronous: the event loop keeps running. */
function snapshotAll(exec = execFile) {
  return new Promise((resolve) => {
    try {
      exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_SNAPSHOT],
        { encoding: 'utf8', windowsHide: true, timeout: SNAPSHOT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => resolve(err ? null : parseSnapshot(stdout)));
    } catch { resolve(null); }
  });
}

/** The root and its descendants as they are now: `{ root, descendants:[{pid, created}] }` or null. */
function treeOf(pid, all) {
  if (!all) return null;
  const root = all.find((p) => p.pid === pid);
  if (!root) return null;
  const out = [];
  const seen = new Set([pid]);
  const stack = [root];
  while (stack.length) {
    const parent = stack.pop();
    for (const p of all) {
      if (seen.has(p.pid) || p.ppid !== parent.pid) continue;
      if (!(p.created > parent.created)) continue;               // ISO-8601 strings of one zone sort by time
      seen.add(p.pid); out.push({ pid: p.pid, created: p.created }); stack.push(p);
    }
  }
  return { root: { pid: root.pid, created: root.created }, descendants: out };
}

/** Pure. pid AND creation time identify a process (created:null = pid only). Late children of a member are included, transitively. */
function survivorsIn(all, members, parentsExtra = []) {
  const same = (m, p) => p.pid === m.pid && (m.created == null || p.created === m.created);
  const alive = members.filter((m) => all.some((p) => same(m, p)))
    .map((m) => (m.created == null ? { pid: m.pid, created: all.find((p) => p.pid === m.pid).created } : m));
  const known = new Set(members.map((m) => m.pid));
  const late = [];
  const parents = [...members, ...parentsExtra];   // a parent need not be alive: its child keeps the recorded parent pid
  for (let i = 0; i < parents.length; i += 1) {
    const par = parents[i];
    for (const p of all) {
      if (known.has(p.pid) || p.ppid !== par.pid) continue;
      if (par.created != null && !(p.created > par.created)) continue;     // an older process cannot be its child (reused parent id)
      known.add(p.pid); late.push({ pid: p.pid, created: p.created, late: true }); parents.push({ pid: p.pid, created: p.created });
    }
  }
  return [...alive, ...late];
}

const windowsTools = {
  tree: async (pid) => treeOf(pid, await snapshotAll()),
  /** `{status, error}` -- 0 terminated, 128 not found, other = failed (255 and a timeout are "failed", not "gone") */
  taskkill: (pid) => new Promise((resolve) => {
    try {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS }, (err) => {
        if (!err) return resolve({ status: 0, error: null });
        if (typeof err.code === 'number') return resolve({ status: err.code, error: null });
        resolve({ status: null, error: String(err.killed ? 'ETIMEDOUT' : (err.code ?? err.message)) });
      });
    } catch (e) { resolve({ status: null, error: String(e?.code ?? e?.message ?? e) }); }
  }),
  /** Which of `members` ([{pid, created|null}]) are still the SAME process -- plus processes that appeared UNDER a member after the
   *  snapshot (a late child the first read could not know): same parent pid, created after that parent. null = could not be read. */
  survivors: async (members, parentsExtra = []) => {
    const all = await snapshotAll();
    return all ? survivorsIn(all, members, parentsExtra) : null;
  },
};

/** Pure: the end state a finished run is reported with. */
function classifyEnd({ windows, code, signal, stop }) {
  const natural = code === 0 ? 'ok' : 'failed';
  if (!windows) {
    return { state: signal != null ? 'stopped' : natural, stop: { ...stop, observed: signal != null ? 'signal' : null, verdict: !stop.requested ? 'not-requested' : (signal != null ? 'stopped-by-signal' : 'requested-not-observed') } };
  }
  if (!stop.requested) return { state: natural, stop: { ...stop, verdict: 'not-requested' } };
  const rootConfirmed = stop.root === 'terminated-by-taskkill' || stop.root === 'terminated-by-kill';   // the latter ONLY with an observed signal, see finalize
  if (rootConfirmed) {
    if (code === 0 && signal == null) {
      // taskkill says it terminated the process, the process says it finished cleanly: both cannot be the whole story
      return { state: 'unknown', stop: { ...stop, verdict: 'contradiction-exit-0' } };
    }
    if (stop.descendants === 'none') return { state: 'stopped', stop: { ...stop, verdict: 'stopped-tree-observed' } };
    return { state: 'unknown', stop: { ...stop, verdict: stop.descendants === 'survivors' ? 'root-stopped-descendants-alive' : 'root-stopped-descendants-unverified' } };
  }
  if (stop.root === 'not-found' || stop.root === 'exited-before-request') {
    return { state: natural, stop: { ...stop, verdict: 'ended-before-stop-took-effect' } };
  }
  if (stop.root === 'kill-requested') {
    /* Node's `child.kill()` returning true says a signal was DELIVERED to the handle, not that the signal ended the process. With no
     * signal reported at exit the process ended some other way (or at the same moment), and the exit code is its own. */
    return { state: 'unknown', stop: { ...stop, verdict: 'kill-unconfirmed', observedExit: { code, signal } } };
  }
  /* The request failed or was never confirmed and the process has ended anyway. WHY it ended is not shown: not by
   * our kill (no proof), and not "by itself" either (taskkill did not say it was gone). So it is neither `failed`
   * nor `stopped` -- the exit code is kept as an observation, the state is `unknown`. */
  return { state: 'unknown', stop: { ...stop, verdict: 'stop-unconfirmed', observedExit: { code, signal } } };
}

/**
 * One stopper per run. `child` is the owned ChildProcess handle.
 * @param {object} o
 * @param {import('node:child_process').ChildProcess} o.child
 * @param {boolean} o.windows
 * @param {object} [o.tools]   injectable Windows tools (tests)
 * @param {() => string} [o.now]
 */
function createStopper({ child, windows, tools = windowsTools, now = () => new Date().toISOString() }) {
  const stop = { requested: false, requestedAt: null, attempts: 0, root: null, taskkill: null, fallback: null, snapshot: null, descendants: null, platform: windows ? 'win32' : 'posix' };
  let tree = null;
  let inflight = null;                    // the Windows attempt that is reading the snapshot / waiting for taskkill
  const exited = () => child.exitCode !== null || child.signalCode !== null;

  const timings = {};
  stop.timings = timings;
  async function attempt() {
    let t0 = Date.now();
    try { tree = await tools.tree(child.pid); } catch { tree = null; }
    timings.snapshotMs = Date.now() - t0;
    stop.snapshot = tree ? { root: tree.root, descendants: tree.descendants.length } : null;
    /* The handle may have closed while the snapshot was read. Its pid could be reused from now on, so a process
     * that ended is never addressed: its own result stands. No await sits between this check and the spawn. */
    if (exited()) { stop.root = 'exited-before-request'; return; }
    let r;
    t0 = Date.now();
    try { r = await tools.taskkill(child.pid); } catch (e) { r = { status: null, error: String(e?.message ?? e) }; }
    timings.taskkillMs = Date.now() - t0;
    stop.taskkill = r;
    if (r.status === 0) stop.root = 'terminated-by-taskkill';
    else if (r.status === 128) stop.root = 'not-found';
    else {
      let sent = false;
      if (!exited()) { try { sent = child.kill(); } catch { sent = false; } }
      stop.fallback = { used: true, sent };              // `sent` = the signal was handed over; whether it ended the process is decided at exit
      stop.root = sent ? 'kill-requested' : 'not-terminated';
    }
  }

  /** @returns {boolean} whether a NEW attempt started (a duplicate while one is in flight, or after a proven stop, is not) */
  function request(posixStop) {
    if (['terminated-by-taskkill', 'terminated-by-kill', 'kill-requested', 'signalled'].includes(stop.root)) return false;   // duplicate Stop: nothing new to say
    if (stop.requested && stop.root === 'in-flight') return false;
    if (!stop.requested) { stop.requested = true; stop.requestedAt = now(); }
    stop.attempts += 1;
    if (exited()) { stop.root = stop.root ?? 'exited-before-request'; return false; }
    if (!windows) { stop.root = 'signalled'; posixStop(child); return true; }

    stop.root = 'in-flight';
    inflight = attempt().catch(() => { stop.root = 'not-terminated'; });
    return true;
  }

  /** Called once the run has ended: wait for an attempt still in flight, look at what may be alive, then classify. */
  async function finalize({ code, signal }) {
    if (inflight) await inflight;
    /* The fallback's signal counts as the cause only when the exit reports that very signal (libuv reports `signal` for a kill it issued). */
    if (stop.root === 'kill-requested' && signal != null) { stop.root = 'terminated-by-kill'; stop.fallback = { ...stop.fallback, signalObserved: signal }; }
    const proven = stop.root === 'terminated-by-taskkill' || stop.root === 'terminated-by-kill';
    if (windows && stop.requested && (proven || stop.root === 'not-terminated' || stop.root === 'kill-requested')) {
      /* After a proven kill the root is gone and only its descendants are checked. When nothing proved the kill, the
       * root itself is also a process that might still be there. A tree that was never read leaves the members
       * unknown: only the root pid (without a creation time) is known, and the answer is "unverified". */
      const members = tree ? (proven ? tree.descendants : [tree.root, ...tree.descendants])
                           : (proven ? null : [{ pid: child.pid, created: null }]);
      if (!members) stop.descendants = 'unverified';
      else {
        /* even a root with no recorded child is looked at again: something it started AFTER the snapshot is a late child */
        let alive = null;
        const t1 = Date.now();
        try { alive = await tools.survivors(members, proven && tree ? [tree.root] : []); } catch { alive = null; }
        timings.survivorsMs = Date.now() - t1;
        stop.descendants = alive === null ? 'unverified' : (alive.length ? 'survivors' : 'none');
        if (alive && alive.length) stop.survivorPids = alive.map((p) => p.pid);
        stop.members = alive === null ? members : alive;
      }
    }
    const end = classifyEnd({ windows, code, signal, stop });
    /* The Writer gate holds while this is true: something this Stop touched might still be running. */
    if (end.state === 'unknown' && windows && stop.requested) {
      end.stop.uncertain = stop.descendants !== 'none';
      end.stop.members = end.stop.uncertain ? (stop.members ?? null) : [];
    }
    return end;
  }

  return { request, finalize, whenIdle: () => inflight ?? Promise.resolve(), evidence: () => ({ ...stop }) };
}

module.exports = { STOP_WORST_CASE_MS, survivorsIn, createStopper, classifyEnd, treeOf, windowsTools, parseSnapshot };
