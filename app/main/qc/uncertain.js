'use strict';
/* An unresolved Quick Command keeps the Project Writer gate closed. Current process snapshots
 * cannot exclude descendants that escaped the recorded tree. Historic user ACKs are records only;
 * neither an ACK nor absence of observed members releases the hold, including after restart. */
const fs = require('node:fs');
const path = require('node:path');
const { validate: validateStop } = require('./stop-proof');
const { isReadOnlyRun } = require('./rules');

const inside = (root, p) => { const r = path.relative(root, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

function createUncertain({ probe, retryMs = 2000, maxTries = 30, schedule = setTimeout } = {}) {
  const held = new Map();                  // runId -> entry
  const failures = new Map();              // projectId -> { reason, at }: the holds could not be rebuilt, so NOTHING is known to be safe

  async function recheck(runId) {
    const e = held.get(runId);
    if (!e || e.checking || !e.identified) return;
    if (!Array.isArray(e.members) || !e.members.length || !probe) return;
    e.checking = true;
    let alive = null;
    try { alive = await probe(e.members, e.parents); } catch { alive = null; }
    e.checking = false;
    if (!held.has(runId)) return;
    /* A snapshot is informational: it cannot prove escaped descendants stopped. */
    if (Array.isArray(alive)) { e.observed = alive.length ? 'observed-alive' : 'observed-gone'; if (!alive.length) return; }
    e.tries += 1;
    if (Array.isArray(alive)) e.members = alive;
    if (e.tries < maxTries) { const t = schedule(() => recheck(runId), retryMs); t?.unref?.(); }
  }

  const api = {
    add(runId, projectId, members, info = {}) {
      if (held.has(runId)) return;
      /* a member with no creation time is a bare pid: "that pid is gone" proves nothing about its tree (or a reused pid), so it cannot authorize release */
      const identified = Array.isArray(members) && members.length > 0 && members.every((m) => m && Number.isInteger(m.pid) && typeof m.created === 'string' && m.created);
      held.set(runId, { runId, projectId, members: Array.isArray(members) ? members : null, needsAck: false, observed: null,   // no user confirmation can prove whole-tree termination
                        identified,
                        parents: Array.isArray(info.parents) ? info.parents : [],
                        command: info.command ?? null, startedAt: info.startedAt ?? null, why: info.why ?? null, tries: 0, checking: false });
      const t = schedule(() => recheck(runId), 0); t?.unref?.();
    },
    has: (runId) => held.has(runId),
    blocks(projectId) {
      for (const [runId, e] of held) if (e.projectId === projectId) return runId;
      return failures.has(projectId) ? 'restore-failed' : null;
    },
    /** The restore for this project did not complete: fail closed until a later attempt completes. */
    failRestore(projectId, reason) { failures.set(projectId, { reason: String(reason ?? 'unknown'), at: new Date().toISOString() }); },
    clearRestoreFailure(projectId) { failures.delete(projectId); },
    restoreFailure: (projectId) => failures.get(projectId) ?? null,
    heldFor: (projectId) => [...held.values()].filter((e) => e.projectId === projectId)
      .map(({ runId, command, startedAt, needsAck, why, observed }) => ({ runId, command, startedAt, needsAck, why, observed })),
    /** No current termination proof covers escaped descendants; compatibility callers cannot release a hold. */
    release() { return false; },
    refresh(projectId) { for (const [runId, e] of held) if (e.projectId === projectId) { e.tries = 0; recheck(runId); } },
    size: () => held.size,
    recheck,
  };
  return api;
}

/** The Stop evidence of a row, read only from a regular file inside the evidence root. {ok:true, stop|null} | {ok:false} */
function readStop(root, ref) {
  if (!ref) return { ok: true, rec: null };
  try {
    const realRoot = fs.realpathSync(root);
    const file = path.join(realRoot, String(ref).replace(/^evidence:/, ''));
    if (!inside(realRoot, file)) return { ok: false, why: 'outside-store' };
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || !inside(realRoot, fs.realpathSync(file))) return { ok: false, why: 'not-a-plain-file' };
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    return rec && typeof rec === 'object' ? { ok: true, rec } : { ok: false, why: 'no-record' };
  } catch (e) { return { ok: false, why: String(e?.code ?? e?.message ?? e) }; }
}

/**
 * Rebuild the holds a restart would otherwise forget. FAIL CLOSED: a row whose evidence cannot be read is held,
 * and any error that stops the pass is thrown so the caller records a restore failure instead of "restored".
 * @param {object} o
 * @param {object[]} o.rows        EVERY unresolved quick_command_run row of ONE project (no LIMIT; the safety query)
 * @param {string}   o.root        that project's evidence store
 * @param {object}   o.registry    createUncertain()
 * @returns {string[]} run ids now held
 */
function restore({ rows, root, registry }) {
  const out = [];
  for (const r of rows) {
    /* a read-only run (the fixed `git status`) cannot have changed a file; everything else, and anything not provably that, can */
    if (registry.has(r.id) || isReadOnlyRun(r)) continue;
    const read = readStop(root, r.output_ref);
    const info = { command: r.command, startedAt: r.started_at };
    const proof = read.ok && read.rec ? validateStop(read.rec, r) : { kind: 'untrusted', why: read.ok ? 'no-stop-record' : read.why };
    /* The Stop looked again after the kill and found nothing alive -- and the record is complete and agrees with the row. Only then. */
    if (proof.kind === 'clear' && r.status === 'unknown') {
      /* a complete, agreeing record is still only what the Stop observed: orphans outside its snapshot cannot be excluded (QC-STOP-PROOF-CONTRACT) */
      registry.add(r.id, r.project_id, [], { ...info, why: 'ownership-unproven' });
    } else if (proof.kind === 'members') {
      registry.add(r.id, r.project_id, proof.members, { ...info, parents: proof.parents, why: 'stop-uncertain' });
    } else {
      /* never finished, no record, or a record that is incomplete/contradictory: nothing may be inferred; the Writer hold stays closed */
      registry.add(r.id, r.project_id, [{ pid: r.runner_pid ?? null, created: null }].filter((m) => m.pid), {
        ...info, why: !read.ok ? 'evidence-unreadable' : (read.rec ? 'evidence-incomplete' : 'never-finished') });
    }
    out.push(r.id);
  }
  return out;
}

module.exports = { createUncertain, restore, readStop };
