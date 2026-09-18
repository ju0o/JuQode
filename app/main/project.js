'use strict';
/* WBS-02 · Project open — pick a folder, make it the work context.
 *
 * `15` SC-01: the only inputs are a native folder pick and (A-8) a recent row. There is no
 * project creation, no template, no clone. A folder we cannot read is a FAILURE (the one red
 * on SC-01) and it names the reason.
 *
 * This module returns machine reasons only. The renderer chooses the approved Korean words —
 * main never ships a user-facing sentence, so `18` stays the single copy source.
 */
const { dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { openProject, recentProjects, currentInterpretation } = require('./db/repo');

/* Only ENOENT means the folder is not there. ELOOP, ENAMETOOLONG, EIO, EMFILE and friends
 * are different facts, and reporting them as `폴더가 없어요` about a folder that plainly
 * exists is a false statement — `unknown` says what is true: we could not find out. */
function errnoReason(e) {
  switch (e.code) {
    case 'ENOENT':  return 'missing';
    case 'ENOTDIR': return 'not-a-folder';
    case 'EACCES':
    case 'EPERM':   return 'unreadable';
    default:        return 'unknown';
  }
}

/** Turn a chosen folder into an openable project, or say exactly why not. */
function inspect(target) {
  /* A path the renderer names is data, not a path. Everything downstream is fs work. */
  if (typeof target !== 'string' || target === '') {
    return { ok: false, reason: 'unknown', detail: `invalid target: ${typeof target}` };
  }

  let real;
  try {
    /* `.native` (uv → GetFinalPathNameByHandleW), NOT the JS implementation: only the native
     * one canonicalises CASE. On NTFS `C:\Users\Bob\Proj` and `c:\users\bob\proj` are the
     * same folder, and the JS version would hand back two strings — two rows past
     * `project.path`'s unique key. "One folder, one row" is only true with this call. */
    real = fs.realpathSync.native(target);
  } catch (e) {
    return { ok: false, reason: errnoReason(e), detail: `${e.code} ${target}` };
  }

  let st;
  try {
    st = fs.statSync(real);
  } catch (e) {
    return { ok: false, reason: errnoReason(e), detail: `${e.code} ${real}` };
  }
  if (!st.isDirectory()) return { ok: false, reason: 'not-a-folder', detail: real };

  let entries;
  try {
    /* The read itself is the test. `fs.accessSync(R_OK | X_OK)` used to run first, but on
     * Windows `X_OK` is documented as behaving like `F_OK` and `access` reflects only the
     * read-only attribute — it answers nothing on the target OS. One call, one behaviour. */
    entries = fs.readdirSync(real);
  } catch (e) {
    return { ok: false, reason: errnoReason(e), detail: `${e.code} ${real}` };
  }

  /* WBS-02b · an EMPTY folder is a state, not a failure.
   *
   * `15` SC-01 assumes the user has a project folder, which a developer does. The person this
   * product is for does not: they make a folder and have nothing to put in it. The interpreter
   * then answers 확인 못함 six times, which reads as "this thing is broken" and is a dead end
   * on the first screen they ever see.
   *
   * It costs NO extra work to know — the readdir above is already the permission test. Dot
   * files are not content for this purpose: a folder holding only `.git` or `.DS_Store` has
   * nothing in it to explain. */
  const empty = entries.filter((n) => !n.startsWith('.')).length === 0;
  return { ok: true, path: real, name: path.basename(real) || real, empty };
}

/** Open a folder the user already named (recent row, or a retry of the same folder). */
function openPath(db, target) {
  const seen = inspect(target);
  /* Carry the folder back on failure too. `15` SC-01 gives the failure card TWO recovery
   * actions, and `▸ 같은 폴더 다시 시도` has nothing to retry without it. */
  if (!seen.ok) return { ...seen, path: target };
  const row = openProject(db, seen.path, seen.name);
  /* `11` F-C1-01: reopening an already-interpreted project does NOT re-interpret it. Handing
   * the stored interpretation back with the project is what makes that true by construction.
   *
   * A stored FAILURE is the exception. `다시 읽기` is WBS-05, so returning a failed row here
   * would strand the project on the failure band permanently, with no route out — and a scan
   * fails for reasons that pass (a folder locked by another process, a full disk). It is kept
   * in the store as history and simply not handed back as the current answer. */
  const current = currentInterpretation(db, row.id);
  return { ok: true, project: row, empty: seen.empty,
           interpretation: current?.status === 'failed' ? null : current };
}

/** Native folder pick → project. Cancelling is not a failure and shows no card. */
async function pick(db, win, remember = () => {}) {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || r.filePaths.length === 0) return { ok: false, reason: 'cancelled' };
  const chosen = r.filePaths[0];
  /* Remember it even when it fails to open: `▸ 같은 폴더 다시 시도` needs the folder the user
   * actually chose, and that retry must not become a way to name an arbitrary path. */
  remember(chosen);
  return openPath(db, chosen);
}

/* `15` SC-01 · UF-RETURN. The store hands back the join's columns; the screen gets an object or
 * `null`, so a project with no Work cannot render a summary made of undefineds. */
const recent = (db) => recentProjects(db).map((p) => ({
  ...p,
  lastWork: p.last_work_intent == null ? null : {
    intent: p.last_work_intent, status: p.last_work_status, outcome: p.last_work_outcome,
  },
}));

module.exports = { inspect, openPath, pick, recent };
