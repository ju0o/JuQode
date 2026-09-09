'use strict';
/* JuQode desktop shell — WBS-01.
 *
 * Scope: boot, one window, SC-01 project-less state, light/dark foundation.
 * Nothing from WBS-02+ is implemented here, and nothing pretends to be.
 */
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createWindow } = require('./window');
const { enforceLocalOnly } = require('./security');

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

  ipcMain.handle('juqode:versions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }));

  /* WBS-02 owns this. Saying "not built yet" is the honest answer; a fake dialog is not. */
  ipcMain.handle('juqode:open-project', () => ({
    ok: false,
    reason: '아직 폴더를 열 수 없어요',
    detail: 'WBS-02',
  }));

  app.whenReady().then(() => {
    readExternalAttempts = enforceLocalOnly(session.defaultSession);
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

  app.on('quit', (_e, exitCode) => trace('quit', { exitCode }));
}
