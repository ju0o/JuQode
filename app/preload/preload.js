'use strict';
/* The ENTIRE renderer-visible API surface.
 *
 * Narrow by construction: named channels only, no generic invoke, no ipcRenderer exposure,
 * no shell access. 19 §S — the renderer must not be able to run arbitrary code.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('juqode', {
  /** App/runtime facts, for the About surface and for tests. */
  versions: () => ipcRenderer.invoke('juqode:versions'),

  /** Store state + the recent list, read once when the renderer starts (WBS-21). */
  boot: () => ipcRenderer.invoke('juqode:boot'),

  /** WBS-02 — native folder pick. Cancelling is not a failure. */
  openProject: () => ipcRenderer.invoke('juqode:open-project'),

  /** WBS-02 — reopen a folder we already offered: a recent row, or a retry of the last pick. */
  openPath: (p) => ipcRenderer.invoke('juqode:open-path', p),

  /** WBS-03 — read the project's deterministic facts. Only called when nothing is stored. */
  interpret: (projectId) => ipcRenderer.invoke('juqode:interpret', projectId),

  /** WBS-09 — is Claude Code usable right now, and if not, why. Never carries credentials. */
  claudeStatus: () => ipcRenderer.invoke('juqode:claude-detect'),

  /** WBS-06 — which of the four routes this request reads as. Classifies; runs nothing. */
  routeIntent: (text) => ipcRenderer.invoke('juqode:route-intent', text),

  /* WBS-10 ~ 17 — the Work loop. Each is a named channel; none takes a channel name. */
  workStart: (projectId, intent) => ipcRenderer.invoke('juqode:work-start', projectId, intent),
  workGet: (workId) => ipcRenderer.invoke('juqode:work-get', workId),
  workAllow: (workId, toolUseId) => ipcRenderer.invoke('juqode:work-allow', workId, toolUseId),
  workAnswer: (workId, text) => ipcRenderer.invoke('juqode:work-answer', workId, text),
  workCancel: (workId) => ipcRenderer.invoke('juqode:work-cancel', workId),
  workChanges: (workId) => ipcRenderer.invoke('juqode:work-changes', workId),
  workSignals: (workId) => ipcRenderer.invoke('juqode:work-signals', workId),

  /**
   * A running session pushes here. The renderer gets the VALUE, never the event object —
   * an IpcRendererEvent carries `sender`, which would hand the renderer the bridge itself.
   * Returns its own unsubscribe; there is no way to remove a listener it did not add.
   */
  onWorkUpdate: (fn) => {
    if (typeof fn !== 'function') return () => {};
    const handler = (_event, snapshot) => fn(snapshot);
    ipcRenderer.on('juqode:work-update', handler);
    return () => ipcRenderer.removeListener('juqode:work-update', handler);
  },
});
