import { sheet, grid, chip, card } from '../ui.mjs';

const COLORS = [
  ['surface', [['--board', '#eef0f4', '#0c0e12'], ['--card', '#ffffff', '#161a20'], ['--card2', '#f7f8fa', '#1d222a']]],
  ['text', [['--ink', '#14171c', '#e9ecf2'], ['--ink2', '#2a2f38', '#ccd3dd'], ['--mut', '#4c545f', '#99a3b2'], ['--mut2', '#646d7a', '#8a94a1']]],
  ['line', [['--line', '#d6dbe3', '#2a303a'], ['--line2', '#c9cfd8', '#39414e'], ['--line3', '#bcc4d0', '#4b5462']]],
  ['state · 확인됨/끝남', [['--rec', '#245c3a', '#5cc98d'], ['--recbg', '#eef6f0', '#10241a'], ['--recline', '#a9c9b3', '#2f5c43']]],
  ['state · 부분(FILL) · 대기(OUTLINE)', [['--part', '#ad4f08', '#eab35c'], ['--partbg', '#fff6ea', '#2a1f0d'], ['--partline', '#e7b98a', '#6d4d1c'], ['--wait', '#ad4f08', '#eab35c']]],
  ['state · 실패 — 유일한 빨강', [['--fail', '#9b2c2c', '#f08b8b'], ['--failbg', '#fdf1f1', '#2c1415'], ['--failline', '#d9a3a3', '#6e3030']]],
  ['state · 알 수 없음 — 항상 점선', [['--unk', '#37445c', '#a9b5c9'], ['--unkbg', '#e6ebf3', '#1b2029']]],
  ['state · 지금 안 됨(실패 아님)', [['--grey', '#f1f1ee', '#23262c']]],
  ['actor · Claude Code', [['--claude', '#4c3d8f', '#b5a6f2'], ['--claudebg', '#eeeafa', '#211c37'], ['--claude2', '#8a7bd1', '#8a7bd1'], ['--claudeline', '#cfc6ee', '#443a70']]],
  ['actor · JuQode', [['--juq', '#0f5f6b', '#63cfdc'], ['--juqbg', '#e6f3f5', '#0d292e'], ['--juqline', '#8ec4cc', '#2c5f68']]],
];

const swatch = (hex) =>
  `<span style="width:22px; height:22px; border-radius:5px; background:${hex}; border:1px solid rgba(128,128,128,.35); flex:0 0 auto;"></span>`;

const rows = COLORS.map(([group, items]) => `
  <div style="display:flex; flex-direction:column; gap:6px;">
    <div class="speclabel">${group}</div>
    ${items.map(([name, l, d]) => `
      <div style="display:flex; align-items:center; gap:10px;">
        ${swatch(l)}${swatch(d)}
        <span class="sm mono" style="flex:1;">${name}</span>
        <span class="xs mut2 mono">${l}</span>
        <span class="xs mut2 mono">${d}</span>
      </div>`).join('')}
  </div>`).join('');

export default [
  {
    name: 'Main', w: 1200, h: 1180,
    body: sheet('디자인 토큰 · 색',
      'app/renderer/design/tokens.css 에서 그대로. Canon 16 §2.1 이 원본이고 이 시트는 사본이다. 왼쪽 칸이 Light, 오른쪽 칸이 Dark.',
      `<div class="card" style="padding:18px 20px;">${grid(rows, 3, 22)}</div>
       <div class="panel unk">
         <div class="t sm">CF-20 · 네 값은 초안 hex 와 다르다, 의도적으로</div>
         <div class="xs">light --mut #5d6672 → #4c545f · light --mut2 #8a93a0 → #646d7a · light --part/--wait #b45309 → #ad4f08 · dark --mut2 #79838f → #8a94a1.
         16 §2.1 이 요구하는 보조 텍스트 대비 4.5:1 을 초안 값이 지키지 못한다. 요구가 hex 를 이긴다. tests/theme.test.js 가 모든 글자 토큰을 모든 표면에 대해 잰다.</div>
       </div>`),
  },
  {
    name: 'TokensSystem', w: 1200, h: 900,
    body: sheet('디자인 토큰 · 상태 문법과 치수',
      '색이 무엇을 뜻하는지는 고정이고, 테마마다 값만 바뀐다.',
      `${grid(`
        <div class="card" style="padding:16px;">
          <div class="speclabel">칩 — D-114 의 세 확신도</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
            ${chip('ok', '확인됨')}${chip('part', '예상됨')}${chip('unk', '확인 못함')}
          </div>
          <div class="specnote" style="margin-top:10px;">확인됨은 근거를 지목한 주장에만 붙는다.</div>
        </div>
        <div class="card" style="padding:16px;">
          <div class="speclabel">칩 — 결과와 상태</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
            ${chip('ok', '끝남')}${chip('part', '일부')}${chip('fail', '실패')}${chip('wait', '대기')}${chip('unavail', '지금 안 됨')}${chip('', '멈췄어요')}
          </div>
          <div class="specnote" style="margin-top:10px;">빨강은 실패 하나뿐이다. 지금 안 됨은 회색이고 실패가 아니다.
          맨 오른쪽은 클래스가 없는 <b>중립 칩</b>이다 — 앱은 멈춤에 이것을 쓴다. 멈춤은 실패도 아니고 사용 불가도 아니라서 어느 색도 빌리지 않는다.</div>
        </div>
        <div class="card" style="padding:16px;">
          <div class="speclabel">행위자 배지</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
            <span class="actor juq">JUQODE</span><span class="actor claude">CLAUDE CODE</span>
          </div>
          <div class="specnote" style="margin-top:10px;">누가 한 일인지 먼저 말한다. 청록은 JuQode, 보라는 Claude Code.</div>
        </div>`, 3)}
      ${grid(`
        <div class="card" style="padding:16px; display:flex; flex-direction:column; gap:10px;">
          <div class="speclabel">패널 — 왼쪽 선이 뜻을 나른다</div>
          <div class="panel rec"><span class="sm t">복구할 수 있어요</span></div>
          <div class="panel wait"><span class="sm t">기다리는 중이에요</span></div>
          <div class="panel unk"><span class="sm t">지금은 확인할 수 없어요</span></div>
          <div class="panel fail"><span class="sm t">실패했어요</span></div>
          <div class="panel juq"><span class="sm t">JuQode 가 정한 것</span></div>
        </div>
        <div class="card" style="padding:16px; display:flex; flex-direction:column; gap:8px;">
          <div class="speclabel">타입 램프</div>
          <div class="h1">20 / 26 · 700 — 화면 제목</div>
          <div class="lead">13 / 19 — 리드</div>
          <div>13 / 19 — 본문</div>
          <div class="sm">12 / 17 — 보조</div>
          <div class="xs mut">11 / 15 — 각주</div>
          <div class="sm mono">12 — 등폭 (경로 · 명령 · 코드)</div>
          <div class="specnote">system-ui 스택. Noto Sans KR · Malgun Gothic 이 한국어를 받는다.</div>
        </div>
        <div class="card" style="padding:16px; display:flex; flex-direction:column; gap:10px;">
          <div class="speclabel">모서리 · 그리드 · 모션</div>
          <div class="sm mono">--r-card 12 · --r-inner 8 · --r-chip 999 · --r-badge 4</div>
          <div class="sm mono">--u 216 · --row 148 · --gap 16</div>
          <div class="sm mono">--d-fast 140ms · --d-base 220ms · --d-slow 360ms · --d-settle 520ms</div>
          <div class="sm mono">--ease cubic-bezier(.2,.8,.2,1)</div>
          <div class="specnote">prefers-reduced-motion 에서 전부 꺼진다.</div>
        </div>`, 3)}`),
  },
];
