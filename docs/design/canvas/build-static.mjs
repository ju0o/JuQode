/* 계정도 로그인도 필요 없는 한 장짜리 HTML 을 만든다.
 *
 * 왜: 캔버스는 claude.ai 아티팩트라 공유 설정이 조직 정책에 걸릴 수 있고, 외부 디자이너는
 * 그 계정이 없다. 이 파일은 **파일 하나**다 — 메일에 붙이든 드라이브에 올리든 열린다.
 * 아트보드 본문은 캔버스와 같은 bodies/ 에서 오므로 둘이 갈라지지 않는다.
 */
import { writeFileSync } from 'node:fs';
import { TOKENS, BASE } from './shell.mjs';
import tokens from './bodies/tokens.mjs';
import sc01 from './bodies/sc01.mjs';
import sc02 from './bodies/sc02.mjs';
import sc03 from './bodies/sc03.mjs';
import sc04 from './bodies/sc04.mjs';
import td01 from './bodies/td01.mjs';

const PAGES = [
  ['토큰', tokens], ['SC-01 프로젝트 열기', sc01], ['SC-02 작업대', sc02],
  ['SC-03 Work', sc03], ['SC-04 변경 읽기', sc04], ['TD-01 터미널 서랍', td01],
];

const boards = [];
const sections = PAGES.map(([page, items]) => `
  <section class="pg" id="${encodeURIComponent(page)}">
    <h2 class="pgname">${page}</h2>
    ${items.map((a) => {
      boards.push({ name: a.name, page });
      return `
      <figure class="ab" id="${a.name}">
        <figcaption>${a.name}<span class="dim"> · ${a.w}×${a.h}</span></figcaption>
        <div class="frame" style="width:${a.w}px;">
          <div class="jq" style="width:${a.w}px; min-height:${a.h}px;">${a.body}</div>
        </div>
      </figure>`;
    }).join('')}
  </section>`).join('');

const css = (PAGES.flatMap(([, items]) => items).map((a) => a.css ?? '').join('\n'));

const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JuQode ScreenSpec</title>
<style>
${TOKENS}
${BASE}
${css}
html { color-scheme: light dark; }
body { margin:0; background:#20242b; color:#e9ecf2;
  font:13px/19px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", "Malgun Gothic", Roboto, sans-serif; }
header { position:sticky; top:0; z-index:9; display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  padding:12px 20px; background:#171a20; border-bottom:1px solid #2a303a; }
header b { letter-spacing:.02em; }
header .sub { color:#8a94a1; font-size:12px; }
nav { display:flex; gap:10px; flex-wrap:wrap; margin-left:auto; }
nav a { color:#63cfdc; text-decoration:none; font-size:12px; }
nav a:hover { text-decoration:underline; }
button.tt { font:inherit; font-size:12px; color:#e9ecf2; background:#242932; border:1px solid #39414e;
  border-radius:8px; padding:5px 11px; cursor:pointer; }
button.tt:hover { background:#2b313b; }
main { padding:20px; display:flex; flex-direction:column; gap:36px; }
.pg { display:flex; flex-direction:column; gap:22px; }
.pgname { margin:0; font-size:15px; letter-spacing:.04em; color:#8a94a1; text-transform:uppercase; }
.ab { margin:0; display:flex; flex-direction:column; gap:7px; }
.ab figcaption { font-size:12px; color:#ccd3dd; font-weight:600; }
.ab .dim { color:#79838f; font-weight:400; }
.frame { max-width:100%; overflow:auto; border:1px solid #39414e; border-radius:10px; }
@media print {
  body { background:#fff; }
  header { display:none; }
  main { padding:0; gap:0; }
  .ab { break-inside:avoid; page-break-inside:avoid; padding:8px 0; }
  .frame { overflow:visible; border-color:#c9cfd8; }
  .pgname { color:#4c545f; }
}
</style>
</head><body>
<header>
  <b>JuQode ScreenSpec</b>
  <span class="sub">아트보드 ${boards.length}장 · 값은 앱 소스에서 그대로</span>
  <button class="tt" id="t" type="button">다크로 보기</button>
  <nav>${PAGES.map(([p]) => `<a href="#${encodeURIComponent(p)}">${p}</a>`).join('')}</nav>
</header>
<main>${sections}</main>
<script>
/* 테마는 토큰 클래스 하나만 뒤집는다 — 앱의 :root[data-theme] 와 같은 값이 .jq.dark 에 있다. */
const btn = document.getElementById('t');
btn.addEventListener('click', () => {
  const on = document.querySelector('.jq').classList.contains('dark');
  for (const n of document.querySelectorAll('.jq')) n.classList.toggle('dark', !on);
  btn.textContent = on ? '다크로 보기' : '라이트로 보기';
});
</script>
</body></html>`;

writeFileSync('screenspec.html', html);
console.log(`screenspec.html — 아트보드 ${boards.length}장 · ${(html.length / 1024).toFixed(0)} KB · 한 파일, 계정 불필요`);
