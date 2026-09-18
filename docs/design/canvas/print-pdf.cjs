/* screenspec.html 을 PDF 한 부로 찍는다. 저장소가 이미 갖고 있는 Electron 을 쓴다 —
 * 브라우저를 새로 깔지 않는다. 아트보드가 1300 px 까지 넓어서 A4 세로로는 잘리므로
 * 가로로 찍고, CSS 의 @media print 가 아트보드마다 페이지를 끊는다. */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, 'JuQode-ScreenSpec.pdf');
const SRC = path.join(__dirname, 'screenspec.html');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1500, height: 1000,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
  await win.loadFile(SRC);
  /* 폰트와 레이아웃이 자리를 잡을 시간. 고정 대기는 부하 아래서 거짓말을 하므로 문서
   * 자신의 신호를 기다린다. */
  await win.webContents.executeJavaScript(
    'new Promise(r => (document.fonts ? document.fonts.ready.then(r) : r()))');
  await new Promise((r) => setTimeout(r, 600));

  const pdf = await win.webContents.printToPDF({
    landscape: true,
    printBackground: true,
    pageSize: 'A3',
    margins: { marginType: 'custom', top: 0.2, bottom: 0.2, left: 0.2, right: 0.2 },
  });
  fs.writeFileSync(OUT, pdf);
  console.log(`${path.basename(OUT)} — ${(pdf.length / 1024 / 1024).toFixed(1)} MB`);
  win.destroy();
  app.quit();
}).catch((e) => { console.error('실패:', e?.message ?? e); app.exit(1); });
