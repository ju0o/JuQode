'use strict';
/* The user's own statement that a previous Quick Command's processes are gone.
 *
 * Append-only files in the project's evidence store: `qc-ack/<runId>.json` (and `<runId>.2.json`, ... when an earlier file of that
 * name is unusable -- it is never overwritten or deleted). A file only COUNTS when it verifies, field by field, against the run row
 * it claims to release:
 *   - a regular file inside the project's evidence root (no symlink, no escape; the directory too)
 *   - complete JSON of schema 1 whose digest matches its own content (a half-written file cannot pass)
 *   - runId and projectId equal the row's, confirmedBy 'user', a real timestamp, and `before.status` equal to the row's `unknown`
 * An empty, broken, foreign or tampered file is simply not an acknowledgement. The run row and its Stop evidence are never written. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = 'qc-ack';
const SCHEMA = 1;

const digestOf = (rec) => { const { digest, ...rest } = rec; return crypto.createHash('sha256').update(JSON.stringify(rest), 'utf8').digest('hex'); };
const inside = (root, p) => { const r = path.relative(root, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

/** The ack directory, only if it is a real directory inside the real evidence root. */
function safeDir(root, { create = false } = {}) {
  const realRoot = fs.realpathSync(root);
  const dir = path.join(realRoot, DIR);
  let st = null;
  try { st = fs.lstatSync(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!st) { if (!create) return null; fs.mkdirSync(dir); st = fs.lstatSync(dir); }
  if (st.isSymbolicLink() || !st.isDirectory()) throw Object.assign(new Error('qc-ack is not a plain directory'), { code: 'EACKDIR' });
  if (!inside(realRoot, fs.realpathSync(dir))) throw Object.assign(new Error('qc-ack escapes the evidence root'), { code: 'EACKDIR' });
  return dir;
}

/** @returns {{ok:true, record:object, file:string}|{ok:false, reason:string}} */
function verifyFile(file, run) {
  let st;
  try { st = fs.lstatSync(file); } catch { return { ok: false, reason: 'missing' }; }
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false, reason: 'not-a-regular-file' };
  let rec;
  try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { ok: false, reason: 'unreadable-or-broken' }; }
  if (!rec || typeof rec !== 'object') return { ok: false, reason: 'not-an-object' };
  if (rec.schema !== SCHEMA) return { ok: false, reason: 'schema' };
  if (rec.runId !== run.id) return { ok: false, reason: 'other-run' };
  if (rec.projectId !== run.project_id) return { ok: false, reason: 'other-project' };
  if (rec.confirmedBy !== 'user') return { ok: false, reason: 'not-user' };
  if (typeof rec.confirmedAt !== 'string' || Number.isNaN(Date.parse(rec.confirmedAt))) return { ok: false, reason: 'timestamp' };
  if (rec.before?.status !== 'unknown') return { ok: false, reason: 'before-status' };
  if (typeof rec.digest !== 'string' || rec.digest !== digestOf(rec)) return { ok: false, reason: 'digest' };
  return { ok: true, record: rec, file };
}

/** Does a VALID acknowledgement of this run exist? Any trouble reading the store means "no" (the hold stays). */
function hasAck(root, run) {
  try {
    const dir = safeDir(root);
    if (!dir) return false;
    return fs.readdirSync(dir).filter((n) => n === `${run.id}.json` || n.startsWith(`${run.id}.`) && n.endsWith('.json'))
      .some((n) => verifyFile(path.join(dir, n), run).ok);
  } catch { return false; }
}

/** @returns {{ok:true, existing:boolean, ref:string}|{ok:false, reason:string, detail?:string}} */
function writeAck(root, run, { now = new Date().toISOString() } = {}) {
  try {
    const dir = safeDir(root, { create: true });
    if (hasAck(root, run)) {
      const n = fs.readdirSync(dir).find((x) => (x === `${run.id}.json` || x.startsWith(`${run.id}.`)) && verifyFile(path.join(dir, x), run).ok);
      return { ok: true, existing: true, ref: `evidence:${DIR}/${n}` };
    }
    const rec = {
      schema: SCHEMA, runId: run.id, projectId: run.project_id, confirmedAt: now, confirmedBy: 'user',
      statement: 'the user confirmed that every process this Quick Command started has ended',
      before: { status: run.status, exitCode: run.exit_code ?? null, stopEvidenceRef: run.output_ref ?? null,
                runnerPid: run.runner_pid ?? null, runnerStartedAt: run.runner_started_at ?? null, command: run.command },
      heldBecause: run.heldBecause ?? null,
    };
    rec.digest = digestOf(rec);
    /* the first name that is free: an unusable earlier file is left exactly as it is */
    for (let i = 1; i < 50; i += 1) {
      const name = i === 1 ? `${run.id}.json` : `${run.id}.${i}.json`;
      const final = path.join(dir, name);
      const tmp = path.join(dir, `.${name}.${crypto.randomBytes(6).toString('hex')}.tmp`);
      const fd = fs.openSync(tmp, 'wx');
      try { fs.writeSync(fd, JSON.stringify(rec, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try { fs.linkSync(tmp, final); }                              // atomic and refuses to replace anything
      catch (e) { fs.unlinkSync(tmp); if (e.code === 'EEXIST') continue; throw e; }
      fs.unlinkSync(tmp);
      if (!verifyFile(final, run).ok) return { ok: false, reason: 'ack-not-verified' };    // what was written must read back as valid
      return { ok: true, existing: false, ref: `evidence:${DIR}/${name}` };
    }
    return { ok: false, reason: 'ack-not-recorded', detail: 'no free name' };
  } catch (e) { return { ok: false, reason: 'ack-not-recorded', detail: String(e?.code ?? e?.message ?? e) }; }
}

module.exports = { hasAck, writeAck, verifyFile, safeDir, digestOf };
