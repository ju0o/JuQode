/* JuQode ScreenSpec 캔버스 — 아트보드 공용 셸.
 *
 * 색·치수·글꼴은 전부 app/renderer/design/tokens.css 와 base.css 에서 그대로 옮겼다.
 * 값을 여기서 고치지 않는다 — 앱이 원본이고 이 파일은 사본이다.
 */
export const TOKENS = `
.jq { --board:#eef0f4; --card:#fff; --card2:#f7f8fa;
  --ink:#14171c; --ink2:#2a2f38; --mut:#4c545f; --mut2:#646d7a;
  --line:#d6dbe3; --line2:#c9cfd8; --line3:#bcc4d0;
  --rec:#245c3a; --recbg:#eef6f0; --recline:#a9c9b3;
  --part:#ad4f08; --partbg:#fff6ea; --partline:#e7b98a; --wait:#ad4f08;
  --fail:#9b2c2c; --failbg:#fdf1f1; --failline:#d9a3a3;
  --unk:#37445c; --unkbg:#e6ebf3; --grey:#f1f1ee;
  --claude:#4c3d8f; --claudebg:#eeeafa; --claude2:#8a7bd1; --claudeline:#cfc6ee;
  --juq:#0f5f6b; --juqbg:#e6f3f5; --juqline:#8ec4cc;
  --r-card:12px; --r-inner:8px; --r-chip:999px; --r-badge:4px;
  --sh-rest:0 1px 0 rgba(20,23,28,.04);
}
.jq.dark { --board:#0c0e12; --card:#161a20; --card2:#1d222a;
  --ink:#e9ecf2; --ink2:#ccd3dd; --mut:#99a3b2; --mut2:#8a94a1;
  --line:#2a303a; --line2:#39414e; --line3:#4b5462;
  --rec:#5cc98d; --recbg:#10241a; --recline:#2f5c43;
  --part:#eab35c; --partbg:#2a1f0d; --partline:#6d4d1c; --wait:#eab35c;
  --fail:#f08b8b; --failbg:#2c1415; --failline:#6e3030;
  --unk:#a9b5c9; --unkbg:#1b2029; --grey:#23262c;
  --claude:#b5a6f2; --claudebg:#211c37; --claude2:#8a7bd1; --claudeline:#443a70;
  --juq:#63cfdc; --juqbg:#0d292e; --juqline:#2c5f68;
  --sh-rest:0 1px 0 rgba(0,0,0,.35);
}`;

/* base.css 의 프리미티브만. 화면별 CSS 는 각 아트보드가 인라인으로 갖는다. */
export const BASE = `
body { margin:0; }
.jq { font:13px/19px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", "Malgun Gothic", Roboto, sans-serif;
  background:var(--board); color:var(--ink); min-height:100%; box-sizing:border-box; }
.jq *, .jq *::before, .jq *::after { box-sizing:border-box; }
a { color:#0f5f6b; } a:hover { color:#14171c; }
.h1 { font-size:20px; line-height:26px; font-weight:700; letter-spacing:-.01em; margin:0; }
.lead { font-size:13px; line-height:19px; color:var(--ink2); margin:0; }
.sm { font-size:12px; line-height:17px; }
.xs { font-size:11px; line-height:15px; }
.mut { color:var(--mut); } .mut2 { color:var(--mut2); }
.mono { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:.92em; }
.bad { color:var(--fail); }
.card { background:var(--card); border:1px solid var(--line); border-radius:var(--r-card); box-shadow:var(--sh-rest); }
.ct { font-size:12px; font-weight:600; letter-spacing:.03em; color:var(--mut); }
.t { font-weight:600; }
.btn { font:inherit; font-size:13px; color:var(--ink); background:var(--card);
  border:1px solid var(--line2); border-radius:var(--r-inner); padding:7px 13px; cursor:default; }
.btn.pri { background:var(--juq); border-color:var(--juq); color:#fff; }
.btn.sm { font-size:12px; padding:5px 10px; }
.btn.ghost { background:transparent; }
.btn.rec { color:var(--rec); border-color:var(--recline); }
.btn.cancel { border-color:var(--ink); color:var(--ink); background:transparent; }
/* base.css 의 칩. 표식(::before)까지 원본 그대로 — 색만으로 읽지 않게 하는 것이 표식의 일이다.
   클래스가 없는 맨 칩이 중립이고, 앱은 '멈췄어요' 에 그것을 쓴다(td01.js: ['', C.qc.stopped]). */
.chip { display:inline-flex; align-items:center; gap:4px; height:20px; padding:0 8px;
  border:1px solid var(--line2); border-radius:var(--r-chip);
  background:var(--card); color:var(--mut); font-size:11px; line-height:1; white-space:nowrap; }
.chip.ok   { border-color:var(--rec); color:var(--rec); background:var(--recbg); }
.chip.ok::before { content:"✓"; font-size:10px; }
.chip.part { border-color:var(--part); color:var(--part); background:var(--partbg); }
.chip.part::before { content:"◧"; font-size:10px; opacity:.85; }
.chip.fail { border-color:var(--fail); color:var(--fail); background:var(--failbg); }
.chip.fail::before { content:"×"; font-size:11px; }
.chip.wait { border:1px solid var(--wait); border-left-width:3px; color:var(--wait); background:var(--card); }
.chip.wait::before { content:"◔"; font-size:10px; opacity:.85; }
.chip.unk  { border:1px dashed var(--unk); color:var(--unk); background:var(--unkbg); }
.chip.unk::before { content:"?"; font-size:10px; }
.chip.unavail { border-color:var(--line2); color:var(--mut); background:var(--grey); }
.chip.unavail::before { content:"○"; font-size:10px; opacity:.8; }
.actor { font-size:10px; letter-spacing:.06em; font-weight:600; text-transform:uppercase;
  padding:2px 7px; border-radius:var(--r-badge); }
.actor.juq { color:var(--juq); background:var(--juqbg); }
.actor.claude { color:var(--claude); background:var(--claudebg); }
.panel { border-radius:var(--r-inner); padding:10px 12px; display:flex; flex-direction:column; gap:6px; }
.panel.rec { border:1px solid var(--recline); border-left-width:3px; background:var(--recbg); }
.panel.wait { border:1px solid var(--wait); border-left-width:3px; background:transparent; }
.panel.unk { border:1px dashed var(--unk); background:var(--unkbg); }
.panel.fail { border:1px solid var(--failline); border-left-width:3px; background:var(--failbg); }
.panel.juq { border:1px solid var(--juqline); border-left-width:3px; background:var(--juqbg); }
.topbar { display:flex; align-items:center; gap:10px; padding:9px 16px;
  background:var(--card); border-bottom:1px solid var(--line); }
.brand { font-weight:700; letter-spacing:.02em; color:var(--juq); }
.grow { flex:1; }
.row { display:flex; gap:10px; }
.col { display:flex; flex-direction:column; gap:10px; }
.wrap { display:flex; flex-wrap:wrap; gap:10px; }
.speclabel { font-size:10px; letter-spacing:.08em; text-transform:uppercase; font-weight:700; color:var(--juq); }
.specnote { font-size:11px; line-height:16px; color:var(--mut2); }
.stack { display:flex; flex-direction:column; gap:14px; padding:20px; }
.field { display:flex; gap:10px; align-items:baseline; }
.field .k { flex:0 0 auto; min-width:5.5em; color:var(--mut2); font-size:12px; }
.field .v { min-width:0; overflow-wrap:anywhere; font-size:12px; }
.inputbox { border:1px solid var(--line2); border-radius:var(--r-inner);
  background:var(--card2); padding:9px 12px; color:var(--mut2); font-size:13px; }
`;

/** 하나의 아트보드 파일을 만든다. body 는 `.jq` 안에 들어갈 조각이다. */
export function artboard({ body, css = '', w, h, scroll = false }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${TOKENS}
${BASE}
${css}</style>
</helmet>
<div class="jq {{themeClass}}" style="width:${w}px;${scroll ? '' : `min-height:${h}px;`}">
${body}
</div>
</x-dc>
<script data-dc-script data-props='{"theme":{"editor":"enum","options":["light","dark"],"default":"light","section":"Theme"},"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
  renderVals() {
    return { themeClass: (this.props.theme ?? 'light') === 'dark' ? 'dark' : 'light' };
  }
}
</script>
</body>
</html>
`;
}
