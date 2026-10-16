'use strict';
/* The user's own statement that a previous Quick Command's processes are gone.
 *
 * Append-only files in the project's evidence store (`qc-ack/<runId>.json`), written with the `wx` flag so an
 * existing record is never overwritten. The run row is NOT touched: a past `unknown` stays `unknown`, and the
 * stored Stop evidence (`qc-stop/<runId>.json`) is not rewritten. Nothing here says the processes ARE gone -- it
 * records that the user said so, when, and what the product knew at that moment. */
const fs = require('node:fs');
const path = require('node:path');

const rel = (runId) => path.join('qc-ack', `${runId}.json`);
const file = (root, runId) => path.join(root, rel(runId));

const hasAck = (root, runId) => { try { return fs.statSync(file(root, runId)).isFile(); } catch { return false; } };

/** @returns {{ok:true, existing:boolean, ref:string}|{ok:false, reason:string}} */
function writeAck(root, run, { now = new Date().toISOString() } = {}) {
  try {
    const f = file(root, run.id);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const record = {
      runId: run.id, projectId: run.project_id, confirmedAt: now, confirmedBy: 'user',
      statement: 'the user confirmed that every process this Quick Command started has ended',
      before: { status: run.status, exitCode: run.exit_code, stopEvidenceRef: run.output_ref ?? null,
                runnerPid: run.runner_pid ?? null, runnerStartedAt: run.runner_started_at ?? null, command: run.command },
      heldBecause: run.heldBecause ?? null,
    };
    try { fs.writeFileSync(f, JSON.stringify(record, null, 2), { flag: 'wx' }); }
    catch (e) { if (e.code === 'EEXIST') return { ok: true, existing: true, ref: `evidence:${rel(run.id).split(path.sep).join('/')}` }; throw e; }
    return { ok: true, existing: false, ref: `evidence:${rel(run.id).split(path.sep).join('/')}` };
  } catch (e) { return { ok: false, reason: 'ack-not-recorded', detail: String(e?.code ?? e?.message ?? e) }; }
}

module.exports = { hasAck, writeAck };
