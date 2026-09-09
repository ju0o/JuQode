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
const repo = require('./db/repo');
const supervisor = require('./work/supervisor');
const { makeHandlers } = require('./ipc');

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

  /* A handler that THROWS rejects the invoke, and the renderer's boot is a top-level await —
   * one rejection there leaves a blank window with no message and no way out. Every handler
   * therefore answers, always, even when the answer is that something went wrong. */
  const handle = (channel, fn) => ipcMain.handle(channel, async (e, ...args) => {
    /* Defence in depth: there are no frames and navigation is locked, but a handler should
     * still refuse a SUB-FRAME. It does not establish that the sender is our window — a
     * destroyed frame reports null and reads as trusted here — so it is one layer, not the
     * boundary. The boundary is the preload surface and the locked navigation. */
    if (e.senderFrame && e.senderFrame.parent) return { ok: false, reason: 'bad-sender' };
    try {
      return await fn(e, ...args);
    } catch (err) {
      trace('ipc.failed', { channel, code: err?.code || null });
      return { ok: false, reason: 'internal', detail: err?.code || null };
    }
  });

  /* Every handler lives in `./ipc`, as a plain function over injected dependencies, so the
   * suite can CALL it. While they lived inside this closure a test could only read the file as
   * text — and a mutation that deleted the intent validation, the store gate or the sub-frame
   * check passed everything, because a string-shape assertion holds while behaviour goes. */
  const evidenceRoot = () => path.join(app.getPath('userData'), 'evidence');
  const pushUpdate = (snap) => {
    if (!snap) return;
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('juqode:work-update', snap);
  };

  const handlers = makeHandlers({
    db: () => db,
    dbFault: () => dbFault,
    evidenceStore: (projectId) => path.join(evidenceRoot(), projectId),
    push: pushUpdate,
    windowFor: (e) => BrowserWindow.fromWebContents(e.sender),
    versions: () => ({
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }),
  });
  for (const [channel, fn] of Object.entries(handlers)) handle(channel, fn);

  app.whenReady().then(() => {
    readExternalAttempts = enforceLocalOnly(session.defaultSession);
    openStore();
    /* D-124 · `20`: a Work whose process is gone cannot be judged, and a Work left `running`
     * pins D-117's single slot forever.
     *
     * A JuQode child is spawned detached and CAN outlive its parent, so this ASKS rather than
     * assuming. `07` §8.5: a pid is reusable, so a pid that answers is only believed when the
     * process also started before the Work's own start time was recorded. A Work we cannot
     * decide about is left alone — closing a live session would let a second one start in the
     * same repository, which is the thing D-117 exists to prevent. */
    if (db) {
      const lost = repo.reconcileLostWorks(db, (_work, proc) => {
        if (!proc?.pid) return false;                     // no marker: we cannot ask, so it is gone
        try { process.kill(proc.pid, 0); return true; }   // answers → still there
        catch (e) { return e.code === 'EPERM'; }          // EPERM: alive and not ours
      });
      if (lost.length) trace('work.reconciled', { count: lost.length });
    }

    /* Anything we started is ours to stop. Without this, quitting mid-Work leaves the CLI
     * running and editing while the next launch frees the D-117 slot. */
    app.on('before-quit', () => {
      for (const [, entry] of supervisor.live) {
        if (entry.child) { try { require('./claude/session').stop(entry.child); } catch { /* gone */ } }
      }
    });

    /* The quiet states are defined by the absence of a signal, so only a clock can deliver
     * them (`15` 새 신호 없음 · 취소 확인 불가). */
    supervisor.watchQuiet(db, pushUpdate);
    /* D-127's S1 path needs the TypeScript compiler API. Its absence is an honest degradation
     * — every file falls back to hunk blocks — but it IS a capability loss, so it is reported
     * at boot rather than discovered later from a screen full of 단위로 나누지 못함. */
    let segmenter = 'hunks-only';
    try { require('typescript'); segmenter = 'semantic'; } catch { /* S2 everywhere */ }
    trace('app.ready', { versions: process.versions.electron, segmenter });

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
