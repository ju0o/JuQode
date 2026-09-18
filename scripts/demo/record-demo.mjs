/* 실사용 영상 녹화 — 진짜 앱을, 사람이 쓰는 속도로.
 *
 * 스크린샷은 이미 `tests/e2e/visual.mjs` 가 25장 찍는다. 그림 스물다섯 장으로는 답하지 못하는
 * 질문이 하나 남는다: **쓰는 동안 무슨 일이 일어나는가.** 해석이 도는 2.5초, 권한이 거절된
 * 뒤의 카드, 같은 세션이 재개되는 순간 — 전부 시간 위에만 있다.
 *
 * 그래서 이것은 시연용 화면을 새로 그리지 않는다. e2e 와 **같은 fixture**(`tests/e2e/fixture.mjs`)
 * 를 쓰고 같은 Electron 을 띄우고 같은 CDP 로 몬다. 영상에 나오는 카드는 전부 제품이 그린 것이고,
 * 자막만 이쪽이 얹는다 — 화면 아래 띠 하나로, 제품 UI 인 척하지 않는다.
 *
 *   node scripts/demo/record-demo.mjs [--out <파일>] [--keep]
 *
 * 필요한 것: Xvfb · ffmpeg (둘 다 e2e 가 이미 쓰는 것과 같은 계열의 호스트 도구다).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ELECTRON, killTree } from '../../tests/e2e/launch.mjs';
import { sweepDisplays } from '../../tests/e2e/xvfb.mjs';
import { DB, USER_DATA, SEED, FAKE_CLI, PE_UNSIGNED } from '../../tests/e2e/fixture.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'dev-evidence', 'demo', 'juqode-usage.mp4')));
/* 1280x800: GitHub 은 README 안에서 이것을 그대로 재생한다. 더 키우면 파일이 저장소에 들어가기에
 * 커지고, 더 줄이면 카드 안의 글씨를 못 읽는다. */
const W = 1280, H = 800, FPS = 24;
const DISPLAY = `:${120 + (process.pid % 40)}`;
const PORT = 9411;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
sweepDisplays();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => process.stdout.write(`· ${s}\n`);
const dying = [];
const stopAll = () => { for (const f of dying.splice(0)) { try { f(); } catch { /* 이미 죽었다 */ } } };
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAll(); process.exit(1); });

/* ── 1. 화면 ──────────────────────────────────────────────────────────────────────────── */
say(`Xvfb ${DISPLAY} (${W}x${H})`);
const xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', `${W}x${H}x24`, '-nolisten', 'tcp'], { detached: true, stdio: 'ignore' });
dying.push(() => killTree(xvfb.pid));
await sleep(1200);

/* ── 2. 앱 ────────────────────────────────────────────────────────────────────────────── */
/* e2e 와 같은 환경변수다. 다른 것은 둘뿐: 해석 지연을 4초로 늘려 「해석 중」이 영상에서 보이게
 * 하고, 창을 화면 크기에 맞춘다. 침묵 임계값은 제품 기본값 그대로 둔다 — 영상은 제품이
 * 실제로 기다리는 시간을 보여야 한다. */
say('Electron');
const app = spawn(ELECTRON, ['.', '--no-sandbox', `--remote-debugging-port=${PORT}`], {
  cwd: ROOT, detached: true,
  env: { ...process.env, DISPLAY, JUQODE_TRACE: '1', JUQODE_DB: DB, JUQODE_USER_DATA: USER_DATA,
    JUQODE_CLAUDE_BIN: FAKE_CLI, JUQODE_INTERPRET_DELAY_MS: '4000',
    JUQODE_SIGNATURE_EXE: PE_UNSIGNED },
});
dying.push(() => killTree(app.pid));
app.on('error', (e) => { throw new Error(`앱을 시작하지 못했다: ${e.message}`); });

async function pageTarget() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* 아직 안 떴다 */ }
    await sleep(700);
  }
  throw new Error(`${PORT} 에 page 대상이 없다 — 앱이 뜨지 않았다`);
}
const page = await pageTarget();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
dying.push(() => ws.close());
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  const t = setTimeout(() => { pending.delete(n); rej(new Error(`CDP timeout: ${method}`)); }, 20000);
  pending.set(n, (msg) => { clearTimeout(t); res(msg); });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
/* 렌더러가 다 뜬 뒤에 묻는다 — e2e 와 같은 이유로. */
const loaded = await js(`(async () => { for (let i = 0; i < 200; i++) {
  if (typeof window.__screen === 'function') return true; await new Promise(r => setTimeout(r, 50)); } return false; })()`);
if (!loaded) throw new Error('렌더러가 끝까지 뜨지 않았다');

/* ── 3. 자막 ──────────────────────────────────────────────────────────────────────────── */
/* 제품 UI 가 아니라는 것이 보여야 한다: #root 바깥, 화면 아래 띠, 클릭을 먹지 않는다. */
await js(`(() => {
  const bar = document.createElement('div');
  bar.id = '__cap';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;pointer-events:none;'
    + 'font:600 17px/1.5 system-ui,sans-serif;color:#fff;background:rgba(12,14,18,.88);'
    + 'padding:14px 26px;letter-spacing:-.01em;transition:opacity .25s;opacity:0';
  document.body.appendChild(bar);
  window.__cap = (t) => { bar.textContent = t; bar.style.opacity = t ? '1' : '0'; };
})()`);
const cap = (t) => js(`window.__cap(${JSON.stringify(t)})`);
/* 이 호스트의 Xvfb 에는 시스템 테마가 없어 앱이 어둡게 뜬다. 영상은 밝은 테마로 시작해서
 * 끝에서 어두운 테마로 넘어간다 — 그래야 '테마가 둘' 이라는 장면이 실제로 둘을 보여준다.
 *
 * 속성을 직접 꽂지 않고 상단바의 버튼을 누른다. 처음엔 꽂았는데, 앱의 테마 컨트롤러가 다음
 * 화면에서 자기 상태로 되돌려 영상 중간부터 다시 어두워졌다 — 제품이 이기는 게 맞다. */
const theme = (label) => js(`[...document.querySelectorAll('.topbar button')]
  .find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
await theme('밝게');

/* 한 글자씩 — 값을 통째로 꽂으면 영상에서 글이 순간이동한다. */
async function type(sel, text, ms = 55) {
  await js(`document.querySelector(${JSON.stringify(sel)})?.focus()`);
  for (let i = 1; i <= text.length; i += 1) {
    await js(`(() => { const f = document.querySelector(${JSON.stringify(sel)}); if (!f) return;
      f.value = ${JSON.stringify(text)}.slice(0, ${i});
      f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(ms);
  }
}
const clickText = (scope, needle) => js(`[...document.querySelectorAll(${JSON.stringify(scope)})]
  .find(b => b.textContent.includes(${JSON.stringify(needle)}))?.click()`);

/* ── 4. 녹화 시작 ─────────────────────────────────────────────────────────────────────── */
say(`ffmpeg → ${OUT}`);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-video_size', `${W}x${H}`,
  '-framerate', String(FPS), '-i', DISPLAY,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', OUT], { stdio: ['pipe', 'ignore', 'inherit'] });
dying.push(() => { try { ff.kill('SIGKILL'); } catch { /* 이미 끝났다 */ } });
await sleep(1500);

/* ── 5. 장면 ──────────────────────────────────────────────────────────────────────────── */
const scene = async (text, hold = 2200) => { await cap(text); await sleep(hold); };

await scene('JuQode — Developers Code. Vibe Coders Qode.', 2600);
await scene('비개발자가 Claude Code 에게 일을 시키고, 그 결과를 읽는 데스크톱 워크벤치예요.', 3000);

await scene('① 프로젝트를 고릅니다.', 2200);
await js(`[...document.querySelectorAll('[data-el="recent-row"]')]
  .find(r => r.innerText.includes(${JSON.stringify(path.basename(SEED))}))?.click()`);
await scene('열자마자 프로젝트를 읽습니다 — 사람이 시키지 않아도.', 3200);
await scene('② 여섯 가지 질문에 대한 답. 각 답에는 확인됨 / 예상됨 / 확인 못함 이 붙습니다.', 3000);
await clickText('[data-card="brief"] button', '펼치기');
await scene('확인됨 인 답은 근거가 된 파일을 반드시 지목합니다. 지목하지 못하면 확인됨 이 아닙니다.', 4200);

await scene('③ 자연어로 작업을 요청합니다.', 2000);
await cap('');
await type('[data-el="intent"]', 'README.md 의 첫 줄을 바꿔줘');
await sleep(600);
await scene('보낸 말이 곧 작업의 이름이 됩니다.', 1800);
await js(`document.querySelector('[data-act="submit-intent"]')?.click()`);
await scene('④ Claude Code 가 붙고, 한 일이 카드로 쌓입니다.', 3600);
await scene('권한이 필요한 동작은 거절된 채로 도착합니다 — JuQode 가 대신 허용하지 않아요.', 4000);
await clickText('.sc03 button', '허용하고');
await scene('허용하면 같은 세션이 그 자리에서 재개됩니다.', 4000);

await scene('⑤ 끝난 작업은 raw diff 가 아니라 의미 단위로 읽습니다.', 2600);
await clickText('.sc03 button', '변경 읽기');
await scene('처음에는 아직 아무것도 설명되지 않았다고 말합니다 — 없는 설명을 지어내지 않아요.', 3600);
await js(`document.querySelector('.sc04-explain')?.click()`);
await scene('설명을 요청하면 그때 읽습니다.', 3400);
await scene('무엇을 · 왜 · 어떤 동작에 — 그 다음에 코드가 옵니다.', 3600);
await js(`document.querySelectorAll('.sc04-group')[1]?.click()`);
await sleep(1200);
await js(`document.querySelectorAll('.sc04-group')[1]?.querySelector('.sc04-rawbtn')?.click()`);
await scene('원문이 필요하면 언제든 raw diff 로 내려갈 수 있습니다.', 3200);

await scene('⑥ 터미널은 필요할 때만 열립니다.', 2200);
await clickText('.topbar button', '터미널');
await sleep(700);
await cap('');
await type('[data-el="qc-input"]', '테스트 돌려줘');
await sleep(500);
await clickText('.td01 button', '보내기');
await scene('규칙으로 알아듣고, 무엇을 실행할지 먼저 설명합니다. 아직 아무것도 돌지 않았어요.', 4200);
await cap('');
await type('[data-el="qc-input"]', '깃상태');
await sleep(400);
await clickText('.td01 button', '보내기');
await sleep(900);
await js(`[...document.querySelectorAll('.td01 button')].find(b => b.textContent.trim() === '실행')?.click()`);
await scene('확인한 뒤에야 실제로 돕니다. 출력은 서랍 안에 그대로 남아요.', 4200);
await cap('');
await type('[data-el="qc-input"]', 'rm -rf 해줘');
await sleep(400);
await clickText('.td01 button', '보내기');
await scene('알아듣지 못하는 말은 짐작해서 실행하지 않습니다. 목록은 6개 + 2개로 닫혀 있어요.', 4200);

await clickText('.td01 button', '닫기');
await sleep(600);
await theme('어둡게');
await scene('어두운 테마도 같은 화면입니다 — 색이 다르고 대비는 지켜집니다.', 3400);
await scene('JuQode · MVP v0.1 — github.com/ju0o/JuQode', 3200);
await cap('');
await sleep(800);

/* ── 6. 끝 ────────────────────────────────────────────────────────────────────────────── */
say('정지');
ff.stdin.write('q');                       // SIGKILL 로 끊으면 moov 없는 mp4 가 남는다
await new Promise((r) => { ff.on('exit', r); setTimeout(r, 8000); });
stopAll();
const size = fs.statSync(OUT).size;
const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT], { encoding: 'utf8' }).stdout.trim();
console.log(`\n${OUT}\n  ${(size / 1e6).toFixed(1)} MB · ${Number(dur).toFixed(1)}s · ${W}x${H} @${FPS}`);
process.exit(0);
