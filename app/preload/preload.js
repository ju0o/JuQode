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

  /**
   * Open a project folder. WBS-02 implements this; WBS-01 answers truthfully that it
   * is not built yet rather than showing a dialog that goes nowhere.
   */
  openProject: () => ipcRenderer.invoke('juqode:open-project'),
});
