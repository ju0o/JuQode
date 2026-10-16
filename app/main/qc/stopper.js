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
 *     The snapshot is what was observed, not a promise about processes started after it. */
const { spawnSync } = require('node:child_process');

const PS_SNAPSHOT = "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToString('o') }";

/** `[{pid, ppid, created}]` for every process, or null if it could not be read. */
function snapshotAll(run = spawnSync) {
  const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_SNAPSHOT], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (!r || r.error || r.status !== 0) return null;
  const rows = [];
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const m = /^(\d+)\|(\d+)\|(.+)$/.exec(line.trim());
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), created: m[3] });
  }
  return rows.length ? rows : null;
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

const windowsTools = {
  tree: (pid) => treeOf(pid, snapshotAll()),
  /** `{status, error}` -- 0 terminated, 128 not found, other = failed */
  taskkill: (pid) => {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 15000 });
    return { status: r.status, error: r.error ? String(r.error.code ?? r.error.message) : null };
  },
  /** Which of `members` ([{pid, created}]) are still the SAME process. null = could not be read. */
  survivors: (members) => {
    const all = snapshotAll();
    if (!all) return null;
    return members.filter((m) => all.some((p) => p.pid === m.pid && p.created === m.created));
  },
};

/** Pure: the end state a finished run is reported with. */
function classifyEnd({ windows, code, signal, stop }) {
  const natural = code === 0 ? 'ok' : 'failed';
  if (!windows) {
    return { state: signal != null ? 'stopped' : natural, stop: { ...stop, observed: signal != null ? 'signal' : null, verdict: !stop.requested ? 'not-requested' : (signal != null ? 'stopped-by-signal' : 'requested-not-observed') } };
  }
  if (!stop.requested) return { state: natural, stop: { ...stop, verdict: 'not-requested' } };
  const rootConfirmed = stop.root === 'terminated-by-taskkill' || stop.root === 'terminated-by-kill';
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
  // the request failed or was never confirmed: report the process's own end, never a stop
  return { state: natural, stop: { ...stop, verdict: 'stop-unconfirmed' } };
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
  const exited = () => child.exitCode !== null || child.signalCode !== null;

  function request(posixStop) {
    if (['terminated-by-taskkill', 'terminated-by-kill', 'signalled'].includes(stop.root)) return false;   // duplicate Stop: nothing new to say
    if (stop.requested && stop.root === 'in-flight') return false;
    if (!stop.requested) { stop.requested = true; stop.requestedAt = now(); }
    stop.attempts += 1;
    if (exited()) { stop.root = stop.root ?? 'exited-before-request'; return false; }
    if (!windows) { stop.root = 'signalled'; posixStop(child); return true; }

    stop.root = 'in-flight';
    try { tree = tools.tree(child.pid); } catch { tree = null; }
    stop.snapshot = tree ? { root: tree.root, descendants: tree.descendants.length } : null;
    let r;
    try { r = tools.taskkill(child.pid); } catch (e) { r = { status: null, error: String(e?.message ?? e) }; }
    stop.taskkill = r;
    if (r.status === 0) stop.root = 'terminated-by-taskkill';
    else if (r.status === 128) stop.root = 'not-found';
    else {
      let sent = false;
      try { sent = child.kill(); } catch { sent = false; }
      stop.fallback = { used: true, sent };
      stop.root = sent ? 'terminated-by-kill' : 'not-terminated';
    }
    return true;
  }

  /** Called once the run has ended: look at the descendants, then classify. */
  function finalize({ code, signal }) {
    if (windows && stop.requested && (stop.root === 'terminated-by-taskkill' || stop.root === 'terminated-by-kill')) {
      if (!tree) stop.descendants = 'unverified';
      else if (tree.descendants.length === 0) stop.descendants = 'none';
      else {
        let alive = null;
        try { alive = tools.survivors(tree.descendants); } catch { alive = null; }
        stop.descendants = alive === null ? 'unverified' : (alive.length ? 'survivors' : 'none');
        if (alive && alive.length) stop.survivorPids = alive.map((p) => p.pid);
      }
    }
    return classifyEnd({ windows, code, signal, stop });
  }

  return { request, finalize, evidence: () => ({ ...stop }) };
}

module.exports = { createStopper, classifyEnd, treeOf, windowsTools };
