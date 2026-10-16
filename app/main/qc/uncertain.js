'use strict';
/* Quick Command runs that MIGHT still have processes writing (stopper.js `stop.uncertain`, or a run nobody saw finish).
 *
 * The run's own status stays `unknown` (an existing qc_status): not `failed`, not `stopped`, and a user's confirmation
 * never rewrites it. What this holds is the Writer gate: while an entry is here, a new Work and a file-changing Quick
 * Command are refused (`prior-run-unknown`, approved copy).
 *
 * Two kinds of entry:
 *   - members known (pid + creation time from the Stop snapshot): leaves when a LATER snapshot shows every member gone.
 *   - needsAck (the tree was never recorded: a restart found a run that never finished, or the Stop could not read it):
 *     an absent root cannot prove that detached descendants are gone, so ONLY the user's recorded confirmation leaves.
 * A snapshot that cannot be read keeps the gate shut. Entries are rebuilt after a restart (`restore`) from the run rows
 * and their Stop evidence, so a restart alone never opens it. */
const fs = require('node:fs');
const path = require('node:path');
const { hasAck } = require('./ack');

function createUncertain({ probe, retryMs = 2000, maxTries = 30, schedule = setTimeout } = {}) {
  const held = new Map();                  // runId -> entry
  const done = new Set();                  // runIds that were held and left this session (never re-added by a restore)

  async function recheck(runId) {
    const e = held.get(runId);
    if (!e || e.checking || e.needsAck) return;
    if (!Array.isArray(e.members) || !e.members.length || !probe) return;
    e.checking = true;
    let alive = null;
    try { alive = await probe(e.members); } catch { alive = null; }
    e.checking = false;
    if (!held.has(runId)) return;
    if (Array.isArray(alive) && alive.length === 0) { held.delete(runId); done.add(runId); return; }
    e.tries += 1;
    if (Array.isArray(alive)) e.members = alive;
    if (e.tries < maxTries) { const t = schedule(() => recheck(runId), retryMs); t?.unref?.(); }
  }

  const api = {
    add(runId, projectId, members, info = {}) {
      if (held.has(runId) || done.has(runId)) return;
      held.set(runId, { runId, projectId, members: Array.isArray(members) ? members : null, needsAck: Boolean(info.needsAck),
                        command: info.command ?? null, startedAt: info.startedAt ?? null, why: info.why ?? null, tries: 0, checking: false });
      const t = schedule(() => recheck(runId), 0); t?.unref?.();
    },
    has: (runId) => held.has(runId) || done.has(runId),
    blocks(projectId) {
      for (const [runId, e] of held) if (e.projectId === projectId) return runId;
      return null;
    },
    heldFor: (projectId) => [...held.values()].filter((e) => e.projectId === projectId)
      .map(({ runId, command, startedAt, needsAck, why }) => ({ runId, command, startedAt, needsAck, why })),
    /** The user's recorded confirmation ended it (the caller wrote the audit record). */
    release(runId) { if (held.delete(runId)) done.add(runId); },
    refresh(projectId) { for (const [runId, e] of held) if (e.projectId === projectId) { e.tries = 0; recheck(runId); } },
    size: () => held.size,
    recheck,
  };
  return api;
}

/**
 * Rebuild the holds a restart would otherwise forget.
 * @param {object} o
 * @param {object[]} o.rows        quick_command_run rows of ONE project (any status)
 * @param {string}   o.root        that project's evidence store
 * @param {object}   o.registry    createUncertain()
 * @returns {string[]} run ids now held
 */
function restore({ rows, root, registry }) {
  const out = [];
  for (const r of rows) {
    if (r.status !== 'unknown' || registry.has(r.id) || hasAck(root, r.id)) continue;
    let stop = null;
    if (r.output_ref) {
      try { stop = JSON.parse(fs.readFileSync(path.join(root, String(r.output_ref).replace(/^evidence:/, '')), 'utf8'))?.stop ?? null; } catch { stop = null; }
    }
    /* The Stop looked again after the kill and found nothing alive: nothing to hold. */
    if (stop && stop.uncertain === false) continue;
    const info = { command: r.command, startedAt: r.started_at };
    if (stop && stop.uncertain === true && Array.isArray(stop.members) && stop.members.length) {
      registry.add(r.id, r.project_id, stop.members, { ...info, why: 'stop-uncertain' });
    } else {
      /* never finished (crash/quit) or evidence without a verdict on survivors: only the user's confirmation lifts it */
      registry.add(r.id, r.project_id, [{ pid: r.runner_pid ?? null, created: null }].filter((m) => m.pid), {
        ...info, needsAck: true, why: stop ? 'stop-unverified' : 'never-finished' });
    }
    out.push(r.id);
  }
  return out;
}

module.exports = { createUncertain, restore };
