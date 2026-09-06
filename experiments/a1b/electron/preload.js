/* A1b — 일회용. 권한 경계 실측용 preload.
 * 렌더러에 Node 를 주지 않는다. 좁은 동사 목록만 노출한다. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('__bridge', {
  ping: (payload) => ipcRenderer.invoke('bench:ping', payload),
  probe: () => ipcRenderer.invoke('bench:probe'),
  report: (data) => ipcRenderer.invoke('bench:report', data),
  // 렌더러가 Node 에 닿는지 확인하는 검사값
  leak: () => ({
    process: typeof process,
    require: typeof require,
    module: typeof module,
    Buffer: typeof Buffer,
  }),
});
