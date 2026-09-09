'use strict';
/* JuQode desktop shell.
 *
 * WBS-01 boot · one window · SC-01. WBS-21 persistence. WBS-02 project open.
 * WBS-09 Claude Code detection. Nothing beyond that is implemented here, and
 * nothing pretends to be.
 */
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createWindow } = require('./window');
const { enforceLocalOnly } = require('./security');
const { openDb } = require('./db/db');
const project = require('./project');
const claude = require('./claude-detect');
const { scan } = require('./interpret/scan');
const { answers, statusOf } = require('./interpret/answers');
const repo = require('./db/repo');

/* One instance. A second launch focuses the existing window rather than opening a second one. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let readExternalAttempts = () => [];

  /* Structured boot log. JUQODE_TRACE=1 makes it machine-readable for the e2e test. */
  const t0 = Date.now();
  const trace = (ev, extra) => {
    if (!process.env.JUQODE_TRACE) return;
    process.stdout.write(JSON.stringify({ ev, ms: Date.now() - t0, ...extra }) + '\n');
  };

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  const versions = () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  });

  /* WBS-21 · one local SQLite file per user. Opened once, at boot.
   * A DB we cannot understand is REFUSED, not replaced (`21` WBS-21). The app still boots:
   * losing the store is not a reason to show the user nothing. */
  let db = null;
  let dbFault = null;
  function openStore() {
    const file = process.env.JUQODE_DB || path.join(app.getPath('userData'), 'juqode.db');
    try {
      db = openDb(file);
    } catch (e) {
      dbFault = e.code || 'db-unreadable';
      trace('db.refused', { reason: dbFault });
    }
  }

  /* Every path the renderer can name. `openPath` is deliberately NOT "open any folder":
   * it accepts a folder we already gave the renderer — a recent row, or the last pick being
   * retried — so a compromised renderer cannot use it to walk the disk. */
  let lastPick = null;

  const needDb = () => (db ? null : { ok: false, reason: 'no-store', detail: dbFault });

  /* A handler that THROWS rejects the invoke, and the renderer's boot is a top-level await —
   * one rejection there leaves a blank window with no message and no way out. Every handler
   * therefore answers, always, even when the answer is that something went wrong. */
  const handle = (channel, fn) => ipcMain.handle(channel, async (e, ...args) => {
    /* Defence in depth: there are no frames and navigation is locked, but a handler should
     * still refuse a sender that is not the window we made. */
    if (e.senderFrame && e.senderFrame.parent) return { ok: false, reason: 'bad-sender' };
    try {
      return await fn(e, ...args);
    } catch (err) {
      trace('ipc.failed', { channel, code: err?.code || null });
      return { ok: false, reason: 'internal', detail: err?.code || null };
    }
  });

  handle('juqode:versions', versions);

  handle('juqode:boot', () => ({
    store: db ? { ok: true } : { ok: false, reason: dbFault },
    recent: db ? project.recent(db) : [],
  }));

  handle('juqode:open-project', async (e) => {
    const gate = needDb();
    if (gate) return gate;
    const win = BrowserWindow.fromWebContents(e.sender);
    return project.pick(db, win, (p) => { lastPick = p; });
  });

  handle('juqode:open-path', (_e, target) => {
    const gate = needDb();
    if (gate) return gate;
    /* `lastPick` starts as null, so `target === lastPick` used to admit `openPath(null)` —
     * and `realpathSync` coerces a non-string, so `null` resolved to a "null" folder under
     * cwd and was opened as a project the user never chose. The type check is the gate's
     * first clause now, not an assumption about what a renderer would send. */
    if (typeof target !== 'string' || target === '') return { ok: false, reason: 'not-offered' };
    const known = target === lastPick || project.recent(db).some((p) => p.path === target);
    if (!known) return { ok: false, reason: 'not-offered' };
    return project.openPath(db, target);
  });

  /* WBS-03 — the deterministic facts layer. Runs only when the renderer asks, so SC-02 can
   * show 해석 중 first; `11` F-C1-01 says a project that is already interpreted is NOT
   * re-interpreted on reopen, which is why `open` hands back whatever is already stored and
   * this is a separate call the renderer makes only when there is nothing. */
  handle('juqode:interpret', async (_e, projectId) => {
    /* Test affordance, in the same spirit as JUQODE_EXIT_AFTER_LOAD: the facts scan finishes
     * in milliseconds, so 해석 중 cannot be photographed without holding it. Off unless asked
     * for; never set in a shipped build. It delays the ANSWER, it does not fake one. */
    const hold = Number(process.env.JUQODE_INTERPRET_DELAY_MS) || 0;
    if (hold) await new Promise((r) => setTimeout(r, hold));
    const gate = needDb();
    if (gate) return gate;
    const row = db.prepare('select * from project where id = ?').get(projectId);
    if (!row) return { ok: false, reason: 'no-project' };

    const scanned = scan(row.path);
    const list = answers(scanned);
    const note = scanned.skipped ? JSON.stringify(scanned.skipped) : null;
    const saved = repo.saveInterpretation(db, projectId, {
      status: statusOf(scanned, list),
      sourceHash: scanned.sourceHash,
      skippedNote: note,
      answers: list,
      readFiles: scanned.readFiles,
    });
    /* The errno travels with the result. `15` SC-02 Failure State asks for the REASON, and a
     * fixed sentence in the renderer would state a cause that may not be the cause. */
    return { ok: true, interpretation: { ...saved, failedCode: scanned.failed ?? null } };
  });

  /* One probe at a time. Each call spawns up to two `claude` processes held for up to 8 s;
   * without this, anything that calls it in a loop spawns them without bound. */
  let detecting = null;
  handle('juqode:claude-detect', () => {
    if (!detecting) detecting = claude.detect().finally(() => { detecting = null; });
    return detecting;
  });

  app.whenReady().then(() => {
    readExternalAttempts = enforceLocalOnly(session.defaultSession);
    openStore();
    trace('app.ready', { versions: process.versions.electron });

    const win = createWindow({
      onShown: (via) => {
        trace('window.shown', { via, windows: BrowserWindow.getAllWindows().length });
        /* Test affordance: close only AFTER the window has actually been shown, so the smoke
         * test exercises the whole boot→show→quit path and then frees the single-instance
         * lock for the next run. Off unless asked for; never set in a shipped build. */
        if (process.env.JUQODE_EXIT_AFTER_LOAD) win.close();
      },
    });

    win.webContents.on('did-finish-load', () => {
      trace('did-finish-load', {
        windows: BrowserWindow.getAllWindows().length,
        externalRequests: readExternalAttempts().length,
      });

    });

    /* macOS convention; harmless elsewhere and keeps the one-window rule. */
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    trace('window-all-closed', { externalRequests: readExternalAttempts().length });
    /* Windows-first target (D-125): quitting on last window is the expected behaviour there. */
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('quit', (_e, exitCode) => {
    trace('quit', { exitCode });
    try { db?.close(); } catch { /* closing a store we are about to lose anyway */ }
  });
}
