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

  /** WBS-09 — is Claude Code usable right now, and if not, why. Never carries credentials. */
  claudeStatus: () => ipcRenderer.invoke('juqode:claude-detect'),
});
