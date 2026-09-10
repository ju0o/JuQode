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

  /** WBS-05 — the Brief as it stands, and whether it has aged. Reads; never re-reads. */
  brief: (projectId) => ipcRenderer.invoke('juqode:brief', projectId),

  /* WBS-22 · TD-01 — Quick Commands. `19` §C4: 항상 설명 후 확인, so recognising and running are
   * two separate calls and nothing can be started by typing. */
  qcRoute: (projectId, phrase) => ipcRenderer.invoke('juqode:qc-route', projectId, phrase),
  qcList:  (projectId) => ipcRenderer.invoke('juqode:qc-list', projectId),
  qcRun:   (projectId, ruleId, phrase) => ipcRenderer.invoke('juqode:qc-run', projectId, ruleId, phrase),
  qcStop:  (projectId) => ipcRenderer.invoke('juqode:qc-stop', projectId),
  qcRuns:  (projectId) => ipcRenderer.invoke('juqode:qc-runs', projectId),

  /* WBS-25 · TD-01 의 셸 명령줄 (DV-11: 파이프 셸). `19` §C4: 사용자가 사용자로 실행한다 —
   * 채널은 이름이 정해진 셋이고, 그 어느 것도 채널 이름을 인자로 받지 않는다. 셸이 있다는 것과
   * 렌더러가 임의의 코드를 부를 수 있다는 것은 다른 말이다. */
  termOpen:  (projectId) => ipcRenderer.invoke('juqode:term-open', projectId),
  termWrite: (projectId, line) => ipcRenderer.invoke('juqode:term-write', projectId, line),
  /** 작업 제어가 없어 명령 하나만 끊을 수 없다 — 이것은 세션을 끝낸다. */
  termStop:  (projectId) => ipcRenderer.invoke('juqode:term-stop', projectId),

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

  /** WBS-20 — every Work this project started, newest first, with its orientation sentence. */
  history: (projectId) => ipcRenderer.invoke('juqode:history', projectId),

  /** WBS-28 — SC-04's whole read: groups, the diffs they cite, and the blocks already cut. */
  workReader: (workId) => ipcRenderer.invoke('juqode:work-reader', workId),
  /** WBS-26 — the explanation pass, only when the user asks. It spawns a child process. */
  workExplain: (workId) => ipcRenderer.invoke('juqode:work-explain', workId),

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
  /** WBS-22 — a Quick Command's live tail. Same shape: the listener owns its own removal, and
   * the raw IpcRendererEvent never reaches the renderer (it carries `sender`). */
  onQcUpdate: (fn) => {
    const handler = (_e, update) => fn(update);
    ipcRenderer.on('juqode:qc-update', handler);
    return () => ipcRenderer.removeListener('juqode:qc-update', handler);
  },
  /** WBS-25 — the shell line's output, as it arrives. Same shape, its own channel. */
  onTermUpdate: (fn) => {
    const handler = (_e, update) => fn(update);
    ipcRenderer.on('juqode:term-update', handler);
    return () => ipcRenderer.removeListener('juqode:term-update', handler);
  },

});
