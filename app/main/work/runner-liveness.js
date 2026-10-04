'use strict';
const { windowsRunnerTreeMayBeAlive } = require('../claude/session');
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

module.exports = { runnerMayBeAlive, unknownTaskRunWithLiveRunner, unresolvedLegacyUnknownWorks };
