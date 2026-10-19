'use strict';
const { windowsRunnerTreeMayBeAlive } = require('../claude/session');
const fs = require('node:fs');
const repo = require('../db/repo');

/* A Run which became ended_unknown after cancellation/restart may still have a detached Claude
 * process writing to the Project. An absent root PID cannot prove detached descendants are gone.
 * The probe is informational only; an unknown Task Run blocks the Project until explicit user
 * acknowledgement even when the original PID now appears absent. */
function runnerMayBeAlive(work) {
  /* No durable identity means there is no sound basis for saying the detached child is gone. */
  if (!Number.isInteger(work?.runner_pid) || work.runner_pid < 1) return true;
  const targets = process.platform === 'win32' ? [work.runner_pid] : [-work.runner_pid, work.runner_pid];
  for (const pid of targets) {
    try { process.kill(pid, 0); return true; }
    catch (error) {
      if (error?.code !== 'ESRCH') return true;
    }
  }
  if (process.platform === 'win32') {
    return windowsRunnerTreeMayBeAlive(work.runner_pid);
  }
  return false;
}

/* ── Observing the stored runner (Linux only) ────────────────────────────────────────────────
 * runner_pid is the CHILD'S pid, spawned `detached` (setsid), so on Linux that pid is also the
 * runner's process-group id AND session id. The kernel never hands out a pid that is still in use as
 * a pgid/sid, so while any process has pgrp==pid or sid==pid, that pid cannot have been reused: such a
 * process IS a member of the runner's own group/session, root alive or not. runner_started_at is
 * JuQode's clock when the child was spawned; the root only counts as the same process when its OS
 * start time (/proc starttime) agrees with it (a pid alone is reusable). A root pid present with another
 * identity means the old group/session is already empty.
 *
 * Verdicts (never "stopped", never "safe"):
 *   LIVE_CONFIRMED             a live process of that group/session (or the identified root) was observed
 *   NOT_OBSERVED_WITH_EVIDENCE a complete scan found no live member and no root with the recorded identity;
 *                              descendants that left the session (setsid/daemonize) cannot be seen, so this is
 *                              an absence of observation, reported with that limit
 *   UNKNOWN                    anything else: non-Linux, identity missing, /proc unreadable or not credible */
const SKEW_BEFORE_MS = 2000, SKEW_AFTER_MS = 10_000;     // recorded start minus OS start of the root
const CLK_TCK = 100;                                      // USER_HZ is 100 on Linux
const LIMITS = ['descendants-that-left-the-session-are-not-observable'];

function readProc(procDir) {
  const rows = [];
  for (const n of fs.readdirSync(procDir).filter((x) => /^[1-9][0-9]*$/.test(x))) {
    let raw;
    try { raw = fs.readFileSync(`${procDir}/${n}/stat`, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT' || e.code === 'ESRCH') continue; throw e; }   // exited mid-scan is normal
    const close = raw.lastIndexOf(')');                    // comm may hold spaces and parentheses
    const f = raw.slice(close + 2).split(' ');             // f[0]=state f[2]=pgrp f[3]=session f[19]=starttime
    if (close < 0 || f.length < 20) throw new Error('unparsable-stat');
    rows.push({ pid: Number(n), state: f[0], pgrp: Number(f[2]), sid: Number(f[3]), startTicks: Number(f[19]) });
  }
  return rows;
}

function observeRunner(work, { procDir = '/proc', platform = process.platform, nowMs = Date.now() } = {}) {
  const verdict = (v, reason, evidence = {}) => ({ verdict: v, reason, evidence, limits: LIMITS });
  if (platform !== 'linux') return verdict('UNKNOWN', 'platform-not-measured');
  const pid = work?.runner_pid, started = Date.parse(work?.runner_started_at ?? '');
  if (!Number.isInteger(pid) || pid < 2 || Number.isNaN(started)) return verdict('UNKNOWN', 'no-runner-identity');
  let rows, btimeMs;
  try {
    rows = readProc(procDir);
    const btime = fs.readFileSync(`${procDir}/stat`, 'utf8').match(/^btime (\d+)$/m);
    if (!btime) return verdict('UNKNOWN', 'no-boot-time');
    btimeMs = Number(btime[1]) * 1000;
  } catch { return verdict('UNKNOWN', 'process-query-failed'); }
  const osStart = (r) => btimeMs + (r.startTicks * 1000) / CLK_TCK;
  /* credibility: the scan must see this very process, with a start time that fits our own uptime */
  const me = rows.find((r) => r.pid === process.pid);
  if (!me) return verdict('UNKNOWN', 'scan-does-not-see-this-process');
  if (Math.abs(osStart(me) - (nowMs - process.uptime() * 1000)) > 5000) return verdict('UNKNOWN', 'process-clock-not-credible');

  const alive = rows.filter((r) => r.state !== 'Z' && r.state !== 'X' && r.pid !== process.pid);
  const root = alive.find((r) => r.pid === pid);
  const members = alive.filter((r) => r.pgrp === pid || r.sid === pid);
  const evidence = { scanned: rows.length, members: members.map((m) => m.pid), rootPidPresent: Boolean(root) };
  if (root) {
    const d = started - osStart(root);
    if (root.pgrp === pid && d >= -SKEW_BEFORE_MS && d <= SKEW_AFTER_MS) return verdict('LIVE_CONFIRMED', 'root-identity-matches', evidence);
    return verdict('NOT_OBSERVED_WITH_EVIDENCE', 'root-pid-reused-so-old-group-is-empty', evidence);
  }
  if (members.length) return verdict('LIVE_CONFIRMED', 'group-or-session-members-alive', evidence);
  return verdict('NOT_OBSERVED_WITH_EVIDENCE', 'root-and-group-absent', evidence);
}

/* The ONE way a stopped-by-the-user acknowledgement is recorded. The user's confirmation is necessary and never
 * enough: a live runner, or one that cannot be observed, appends nothing. An acknowledgement that already exists
 * is returned as it is (no second record, no second probe). */
function acknowledgeAfterObservation(db, projectId, workId, observe = observeRunner) {
  const work = db.prepare('select * from work where id = ?').get(workId);
  if (!work || work.project_id !== projectId || work.status !== 'ended' || work.outcome !== 'ended_unknown') {
    return { ok: false, reason: 'not-unknown-work' };
  }
  if (repo.hasStoppedProcessAcknowledgement(db, workId)) return { ok: true, existing: true };
  let obs;
  try { obs = observe(work); } catch { obs = verdictFailed(); }
  if (obs?.verdict !== 'NOT_OBSERVED_WITH_EVIDENCE') {
    return { ok: false, reason: 'prior-process-may-still-live',
      detail: { observation: obs?.verdict === 'LIVE_CONFIRMED' ? 'LIVE_CONFIRMED' : 'UNKNOWN', why: obs?.reason ?? 'no-verdict' } };
  }
  return repo.acknowledgeUnknownProcessStopped(db, projectId, workId, { verdict: obs.verdict, reason: obs.reason, limits: obs.limits });
}
const verdictFailed = () => ({ verdict: 'UNKNOWN', reason: 'observer-failed' });

function unknownTaskRunWithLiveRunner(db, projectId, acknowledgedWorkId = null) {
  const unknown = db.prepare(`select * from work
    where project_id = ? and status = 'ended' and outcome = 'ended_unknown'
    order by started_at desc, rowid desc`).all(projectId);
  return unknown.find((row) => row.id !== acknowledgedWorkId &&
    !repo.hasStoppedProcessAcknowledgement(db, row.id)) ?? null;
}

function unresolvedLegacyUnknownWorks(db, projectId) {
  return db.prepare(`select * from work where project_id = ? and task_id is null
    and status = 'ended' and outcome = 'ended_unknown' order by started_at desc, rowid desc`)
    .all(projectId)
    .filter((row) => !repo.hasStoppedProcessAcknowledgement(db, row.id))
    .map((row) => ({ id: row.id, started_at: row.started_at }));
}

module.exports = { observeRunner, acknowledgeAfterObservation, runnerMayBeAlive, unknownTaskRunWithLiveRunner, unresolvedLegacyUnknownWorks };
