'use strict';
const { windowsRunnerTreeMayBeAlive } = require('../claude/session');
const fs = require('node:fs');

/* A Run which became ended_unknown after cancellation/restart may still have a detached Claude
 * process writing to the Project. An absent root PID cannot prove detached descendants are gone.
 * The probe is informational only; an ended_unknown Work keeps the Project Writer hold even when
 * every recorded PID now appears absent or a previous version stored a user acknowledgement. */
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
const SKEW_AFTER_SIGNAL_MS = 45_000;                      // a juqodeProcess signal is written after the first event (<= 30 s start window)
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
    if (root.pgrp === pid && d >= -SKEW_BEFORE_MS && d <= (work.identity_from_signal ? SKEW_AFTER_SIGNAL_MS : SKEW_AFTER_MS)) return verdict('LIVE_CONFIRMED', 'root-identity-matches', evidence);
    return verdict('NOT_OBSERVED_WITH_EVIDENCE', 'root-pid-reused-so-old-group-is-empty', evidence);
  }
  if (members.length) return verdict('LIVE_CONFIRMED', 'group-or-session-members-alive', evidence);
  return verdict('NOT_OBSERVED_WITH_EVIDENCE', 'root-and-group-absent', evidence);
}

/* Every runner a Work is known to have left behind: the columns (first child, spawn time) plus every `juqodeProcess` signal (the
 * first child's, written after its first event, and each resume child's). Judged ALL together: one live runner is LIVE_CONFIRMED
 * however the others ended; a Work that must have more runners than were recorded (one per permission grant / answer, plus the
 * first) is UNKNOWN unless a live one is found. Nothing is invented for a runner that left no identity. */
function runnersOf(db, work) {
  const list = [];
  if (Number.isInteger(work.runner_pid) && work.runner_started_at) list.push({ runner_pid: work.runner_pid, runner_started_at: work.runner_started_at });
  for (const row of db.prepare(`select payload from work_signal where work_id = ? and source = 'juqode' and kind = 'raw' order by seq`).all(work.id)) {
    try {
      const p = JSON.parse(row.payload ?? '')?.juqodeProcess;
      if (Number.isInteger(p?.pid) && p.startedAt && !list.some((r) => r.runner_pid === p.pid)) {
        list.push({ runner_pid: p.pid, runner_started_at: p.startedAt, identity_from_signal: true });
      }
    } catch { /* not that kind of signal */ }
  }
  return list;
}

function observeWork(work, db, opts) {
  const runners = runnersOf(db, work);
  const resumes = db.prepare(`select count(*) n from work_signal where work_id = ? and ((source = 'juqode' and kind = 'permission_granted') or (source = 'user' and kind = 'answer'))`).get(work.id).n;
  const expected = 1 + resumes;
  if (!runners.length) return { verdict: 'UNKNOWN', reason: 'no-runner-identity', evidence: { expected }, limits: LIMITS };
  const seen = runners.map((r) => observeRunner(r, opts));
  const evidence = { expected, recorded: runners.length, runners: seen.map((o, n) => ({ pid: runners[n].runner_pid, verdict: o.verdict, reason: o.reason })) };
  const live = seen.find((o) => o.verdict === 'LIVE_CONFIRMED');
  if (live) return { ...live, evidence };
  const unknown = seen.find((o) => o.verdict === 'UNKNOWN');
  if (unknown) return { ...unknown, evidence };
  if (runners.length < expected) return { verdict: 'UNKNOWN', reason: 'runner-identities-incomplete', evidence, limits: LIMITS };
  return { verdict: 'NOT_OBSERVED_WITH_EVIDENCE', reason: seen.length > 1 ? 'all-recorded-runners-absent' : seen[0].reason, evidence, limits: LIMITS };
}

/* No current producer proves termination of descendants that escaped their recorded session.
 * Historic ACKs and process absence remain inspectable records, never authority to free a Writer. */
function holdReleased() { return false; }

/* Compatibility endpoint: a user statement and an informational observation cannot prove termination.
 * Keep prior records untouched and append no acknowledgement, including when an old ACK exists. */
function acknowledgeAfterObservation(db, projectId, workId, observe = observeWork) {
  const work = db.prepare('select * from work where id = ?').get(workId);
  if (!work || work.project_id !== projectId || work.status !== 'ended' || work.outcome !== 'ended_unknown') {
    return { ok: false, reason: 'not-unknown-work' };
  }
  let obs;
  try { obs = observe(work, db); } catch { obs = verdictFailed(); }
  return { ok: false, reason: 'prior-process-may-still-live',
    detail: { observation: ['LIVE_CONFIRMED', 'NOT_OBSERVED_WITH_EVIDENCE'].includes(obs?.verdict) ? obs.verdict : 'UNKNOWN',
      why: obs?.reason ?? 'no-verdict', termination: 'not-proven' } };
}
const verdictFailed = () => ({ verdict: 'UNKNOWN', reason: 'observer-failed' });

function unknownTaskRunWithLiveRunner(db, projectId) {
  const unknown = db.prepare(`select * from work
    where project_id = ? and status = 'ended' and outcome = 'ended_unknown'
    order by started_at desc, rowid desc`).all(projectId);
  return unknown.find((row) => !holdReleased(db, row)) ?? null;
}

function unresolvedLegacyUnknownWorks(db, projectId) {
  return db.prepare(`select * from work where project_id = ? and task_id is null
    and status = 'ended' and outcome = 'ended_unknown' order by started_at desc, rowid desc`)
    .all(projectId)
    .filter((row) => !holdReleased(db, row))
    .map((row) => ({ id: row.id, started_at: row.started_at }));
}

module.exports = { observeRunner, observeWork, holdReleased, acknowledgeAfterObservation, runnerMayBeAlive, unknownTaskRunWithLiveRunner, unresolvedLegacyUnknownWorks };
