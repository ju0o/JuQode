/* A1b Electron 벤치 셸 — DISPOSABLE. 제품이 아니다.
 * 동결된 Phase 4A 렌더러를 그대로 로드해서 실제 GUI 프레임 시간을 잰다. */
const { app, BrowserWindow, ipcMain } = require('electron');
// 벤치 공정성: 화면 배율을 고정한다. DPR 이 다르면 칠하는 픽셀 수가 달라져 비교가 무의미해진다
app.commandLine.appendSwitch('force-device-scale-factor',
  process.env.BENCH_DPR || '2');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');           // 저장소 루트
const FROZEN = path.join(ROOT, 'prototype', 'index.html');        // 건드리지 않는다
const HARNESS = path.join(__dirname, '..', 'bench', 'harness.js');
const OUTDIR = path.join(__dirname, '..', 'results');
const SECONDS = Number(process.env.BENCH_SECONDS || 3);

const t_app0 = Date.now();
let t_ready = 0, t_loaded = 0;

/* ── main 프로세스에서만 되는 것들을 실제로 재본다 ─────────────────────── */
ipcMain.handle('bench:ping', (_e, payload) => ({ echo: payload, at: Date.now() }));

ipcMain.handle('bench:probe', () => {
  const out = {};
  out.versions = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    modules: process.versions.modules,
  };
  // node:sqlite 가 experimental 경고를 내는지 실제로 잡는다
  const warnings = [];
  process.on('warning', (w) => warnings.push(`${w.name}: ${w.message}`));

  // ① PM 지시: Electron 이 번들한 Node 안에서 node:sqlite 를 직접 확인한다
  //    (Worker 머신의 시스템 Node 결과를 그대로 옮기지 않는다)
  try {
    const { DatabaseSync } = require('node:sqlite');
    const p = path.join(require('node:os').tmpdir(), 'juqode-a1b-electron.db');
    try { fs.rmSync(p, { force: true }); } catch {}
    const db = new DatabaseSync(p);
    const g = (s) => db.prepare(s).get();
    out.node_sqlite = {
      available: true,
      version: g('SELECT sqlite_version() AS v').v,
      wal: db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,
      json1: g(`SELECT json_extract('{"a":1}','$.a') AS v`).v,
    };
    try {
      db.exec(`CREATE TABLE t(id INTEGER PRIMARY KEY, p TEXT,
                k TEXT GENERATED ALWAYS AS (json_extract(p,'$.k')) VIRTUAL);
               CREATE INDEX ti ON t(k);`);
      db.prepare('INSERT INTO t(p) VALUES(?)').run('{"k":"ok"}');
      out.node_sqlite.generated_column_index = g('SELECT k AS v FROM t').v;
    } catch (e) { out.node_sqlite.generated_column_index = 'FAIL: ' + e.message; }
    try {
      db.exec('CREATE VIRTUAL TABLE f USING fts5(b)');
      db.prepare('INSERT INTO f(b) VALUES(?)').run('Supabase Auth 콜백은 /auth/cb 이다');
      out.node_sqlite.fts5 = g(`SELECT count(*) AS v FROM f WHERE f MATCH 'Supabase'`).v === 1;
    } catch (e) { out.node_sqlite.fts5 = 'FAIL: ' + e.message; }
    try {
      db.exec('PRAGMA user_version=1');
      out.node_sqlite.user_version = g('PRAGMA user_version').user_version;
      out.node_sqlite.integrity_check = g('PRAGMA integrity_check').integrity_check;
    } catch (e) { out.node_sqlite.integrity = 'FAIL: ' + e.message; }
    db.close();
    out.node_sqlite.warnings = warnings.slice();
    out.node_sqlite.experimental_warning =
      warnings.some(w => /experimental/i.test(w)) ? warnings.find(w => /experimental/i.test(w)) : null;
  } catch (e) {
    out.node_sqlite = { available: false, error: String(e && e.message || e) };
  }

  // ② 신뢰 경계를 통한 로컬 파일 접근
  const t0 = process.hrtime.bigint();
  let bytes = 0;
  try { bytes = fs.readFileSync(FROZEN).length; } catch (e) { bytes = -1; }
  out.fs_read = { bytes, ms: +(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(2) };

  // ③ 자식 프로세스 실행 경계
  const t1 = process.hrtime.bigint();
  const r = spawnSync('node', ['-e', 'process.stdout.write("spawned")'],
    { encoding: 'utf8', env: { PATH: process.env.PATH } });
  out.child_spawn = {
    ok: r.stdout === 'spawned',
    ms: +(Number(process.hrtime.bigint() - t1) / 1e6).toFixed(2),
  };

  out.rss_mb = +(process.memoryUsage().rss / 1048576).toFixed(1);
  out.startup = { app_ready_ms: t_ready - t_app0, page_loaded_ms: t_loaded - t_app0 };
  return out;
});

ipcMain.handle('bench:report', (_e, data) => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  data.process_rss_mb = +(process.memoryUsage().rss / 1048576).toFixed(1);
  data.startup = { app_ready_ms: t_ready - t_app0, page_loaded_ms: t_loaded - t_app0 };
  fs.writeFileSync(path.join(OUTDIR, 'electron.json'), JSON.stringify(data, null, 2));
  console.log('[A1B-RESULT]', JSON.stringify(data));
  setTimeout(() => app.quit(), 100);
  return true;
});

app.whenReady().then(() => {
  t_ready = Date.now();
  const win = new BrowserWindow({
    width: 1440, height: 900, show: true, alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,     // 렌더러는 Node 에 닿지 못한다
      nodeIntegration: false,
      sandbox: false,             // preload 에서 require 를 쓰기 위해서만
      // 창이 가려지면 Chromium 이 rAF 를 통째로 억제한다 → 측정이 전부 0 이 된다.
      // 벤치의 유효성을 위해서만 끈다. 제품 설정이 아니다
      backgroundThrottling: false,
    },
  });
  win.loadFile(FROZEN);           // 동결본을 그대로 연다. 복사도 수정도 하지 않는다
  win.webContents.on('did-finish-load', async () => {
    t_loaded = Date.now();
    try {
      await win.webContents.executeJavaScript(fs.readFileSync(HARNESS, 'utf8'));
      const res = await win.webContents.executeJavaScript(
        `__A1B_RUN(${JSON.stringify('electron ' + process.versions.electron +
          ' / chromium ' + process.versions.chrome)}, ${SECONDS})`);
      // 렌더러 '메인 월드'에서 직접 확인한다. preload 문맥에서 재면 거짓 양성이 나온다
      res.renderer_world_leak = await win.webContents.executeJavaScript(
        '({process: typeof process, require: typeof require, module: typeof module,' +
        '  Buffer: typeof Buffer, bridge: typeof window.__bridge})');
      res.preload_world_leak = await win.webContents.executeJavaScript('window.__bridge.leak()');
      const t0 = Date.now();
      for (let i = 0; i < 200; i++) await win.webContents.executeJavaScript('window.__bridge.ping(1)');
      res.ipc_roundtrip_ms_avg = +((Date.now() - t0) / 200).toFixed(3);
      res.probe = await win.webContents.executeJavaScript('window.__bridge.probe()');
      await win.webContents.executeJavaScript(`window.__bridge.report(${JSON.stringify(res)})`);
    } catch (e) {
      console.error('[A1B-ERROR]', e && e.message || e);
      app.quit();
    }
  });
});
app.on('window-all-closed', () => app.quit());
