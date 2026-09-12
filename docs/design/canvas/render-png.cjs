/* 아트보드마다 PNG 한 장. Figma 로 끌어다 놓기 위한 것이다.
 *
 * Figma 는 HTML 을 읽지 못한다. PNG 는 프레임으로 들어가고 링크 공유가 된다 — Starter
 * 플랜에서도. 레이어로 편집되지는 않지만 검토와 공유에는 충분하다.
 *
 * 저장소가 이미 갖고 있는 Electron 을 쓴다. 창은 **하나만** 만들어 재사용한다:
 * 아트보드마다 창을 새로 띄우고 부수면 두 번째 로드부터 ERR_FAILED 가 났다(실측).
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, 'png');
const SCALE = 2;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE));

app.whenReady().then(async () => {
  const { TOKENS, BASE } = await import('./shell.mjs');
  const pages = [
    ['1-토큰', (await import('./bodies/tokens.mjs')).default],
    ['2-SC01', (await import('./bodies/sc01.mjs')).default],
    ['3-SC02', (await import('./bodies/sc02.mjs')).default],
    ['4-SC03', (await import('./bodies/sc03.mjs')).default],
    ['5-SC04', (await import('./bodies/sc04.mjs')).default],
    ['6-TD01', (await import('./bodies/td01.mjs')).default],
  ];

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-png-'));

  const page = (a, theme) => `<!doctype html><html><head><meta charset="utf-8"><style>
${TOKENS}
${BASE}
${a.css ?? ''}
html, body { margin:0; background:var(--board); }
</style></head><body><div class="jq ${theme}" style="width:${a.w}px; min-height:${a.h}px;">${a.body}</div></body></html>`;

  const win = new BrowserWindow({
    show: false, width: 1400, height: 900, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });

  const made = [];
  for (const [prefix, items] of pages) {
    for (const a of items) {
      for (const theme of ['light', 'dark']) {
        const file = path.join(TMP, `${a.name}-${theme}.html`);
        fs.writeFileSync(file, page(a, theme));
        win.setContentSize(a.w, a.h);
        await win.loadFile(file);
        await win.webContents.executeJavaScript(
          'new Promise(r => (document.fonts ? document.fonts.ready.then(r) : r()))');
        await settle(180);

        /* 선언 높이보다 내용이 길면 그만큼 늘려 찍는다 — 잘린 그림을 넘기지 않는다. */
        const { w, h } = JSON.parse(await win.webContents.executeJavaScript(
          'JSON.stringify({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })'));
        const W = Math.max(w, a.w), H = Math.max(h, a.h);
        if (W !== a.w || H !== a.h) { win.setContentSize(W, H); await settle(180); }

        const img = await win.webContents.capturePage();
        const name = `${prefix}-${a.name}${theme === 'dark' ? '-dark' : ''}.png`;
        fs.writeFileSync(path.join(OUT, name), img.toPNG());
        made.push({ name, w: W, h: H, grew: H > a.h, theme });
      }
    }
  }
  win.destroy();
  fs.rmSync(TMP, { recursive: true, force: true });

  const grew = made.filter((m) => m.grew && m.theme === 'light');
  console.log(`png/ — ${made.length}장 (라이트 ${made.length / 2} · 다크 ${made.length / 2}) · ${SCALE}x`);
  if (grew.length) console.log('선언보다 길어 늘려 찍음:', grew.map((g) => `${g.name.replace(/^\d-/, '')} → ${g.h}px`).join(' · '));
  app.quit();
}).catch((e) => { console.error('실패:', e?.stack ?? e); app.exit(1); });
