'use strict';
/* Quick Command runs whose Stop left something that MIGHT still be writing (stopper.js `stop.uncertain`).
 *
 * The run's own status stays `unknown` (an existing qc_status): it is not `failed` and not `stopped`. What this adds
 * is only the Writer gate's memory: while an entry is here, a new Work and a file-changing Quick Command are refused
 * (reason `prior-run-unknown`, approved copy), because the product cannot say that nothing it started is still running.
 *
 * An entry leaves only when a LATER process snapshot shows every recorded member gone (pid AND creation time). A
 * snapshot that cannot be read, or an entry with no recorded members, keeps the gate shut -- the safe direction.
 * Memory only: after a restart the stranded-run reconciliation owns the story (it cannot see these processes either). */
function createUncertain({ probe, retryMs = 2000, maxTries = 30, schedule = setTimeout } = {}) {
  const held = new Map();                  // runId -> { projectId, members: [{pid, created}] | null, tries }

  async function recheck(runId) {
    const e = held.get(runId);
    if (!e || e.checking) return;
    if (!Array.isArray(e.members) || !e.members.length || !probe) return;          // nothing to look for: stays held
    e.checking = true;
    let alive = null;
    try { alive = await probe(e.members); } catch { alive = null; }
    e.checking = false;
    if (!held.has(runId)) return;
    if (Array.isArray(alive) && alive.length === 0) { held.delete(runId); return; }
    e.tries += 1;
    if (Array.isArray(alive)) e.members = alive;                                    // only the ones still there matter
    if (e.tries < maxTries) { const t = schedule(() => recheck(runId), retryMs); t?.unref?.(); }
  }

  return {
    add(runId, projectId, members) {
      held.set(runId, { projectId, members: Array.isArray(members) ? members : null, tries: 0, checking: false });
      const t = schedule(() => recheck(runId), 0); t?.unref?.();
    },
    /** The run id that holds the gate for this project, or null. */
    blocks(projectId) {
      for (const [runId, e] of held) if (e.projectId === projectId) return runId;
      return null;
    },
    /** Look again now (a user opening the list is a reason to). */
    refresh(projectId) { for (const [runId, e] of held) if (e.projectId === projectId) { e.tries = 0; recheck(runId); } },
    size: () => held.size,
    recheck,
  };
}

module.exports = { createUncertain };
