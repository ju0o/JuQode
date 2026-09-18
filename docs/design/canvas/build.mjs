/* 아트보드 파일과 canvas.json 을 만든다. 본문은 bodies/*.mjs, 공용 셸은 shell.mjs. */
import { writeFileSync } from 'node:fs';
import { artboard } from './shell.mjs';
import tokens from './bodies/tokens.mjs';
import sc01 from './bodies/sc01.mjs';
import sc02 from './bodies/sc02.mjs';
import sc03 from './bodies/sc03.mjs';
import sc04 from './bodies/sc04.mjs';
import td01 from './bodies/td01.mjs';

const PAGES = [
  { id: 'page-1', name: '토큰', items: tokens },
  { id: 'page-2', name: 'SC-01 프로젝트 열기', items: sc01 },
  { id: 'page-3', name: 'SC-02 작업대', items: sc02 },
  { id: 'page-4', name: 'SC-03 Work', items: sc03 },
  { id: 'page-5', name: 'SC-04 변경 읽기', items: sc04 },
  { id: 'page-6', name: 'TD-01 터미널 서랍', items: td01 },
];

const GAP_X = 120, GAP_Y = 160, ROW_MAX = 2600;
const artboards = [];

for (const page of PAGES) {
  let x = 0, y = 0, rowH = 0;
  for (const a of page.items) {
    if (x > 0 && x + a.w > ROW_MAX) { x = 0; y += rowH + GAP_Y; rowH = 0; }
    writeFileSync(`${a.name}.dc.html`, artboard(a));
    artboards.push({ file: `${a.name}.dc.html`, x, y, w: a.w, h: a.h, page: page.id, expand: 'fit' });
    x += a.w + GAP_X;
    rowH = Math.max(rowH, a.h);
  }
}

const canvas = {
  artboards,
  pages: PAGES.map((p) => ({ id: p.id, name: p.name })),
  annotations: [
    { id: 'what-this-is', x: 0, y: -150, w: 760, page: 'page-1',
      text: 'JuQode v0.2 ScreenSpec — 화면의 모든 상태.\n색·글꼴·치수는 app/renderer/design/tokens.css 와 base.css 에서 그대로 옮겼습니다. 문구는 렌더러의 승인된 사전에서 그대로입니다.\n아트보드마다 Theme 칩으로 라이트/다크를 바꿀 수 있습니다.' },
    { id: 'new-in-v02', x: 0, y: -150, w: 760, page: 'page-6',
      text: '(NEW) 표시는 2026-09-12 에 들어온 것입니다 — 저장·배포 규칙, 목록에서 고르기, 고정된 입력칸, TTY 경고.\n저장과 배포는 Canon 19 §C4 가 닫아 둔 것을 PM 판정으로 연 것이고, Canon 은 아직 갱신되지 않았습니다.' },
  ],
  launch: { view: 'canvas', page: 'page-1' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
console.log(`아트보드 ${artboards.length}장 · 페이지 ${PAGES.length}개`);
console.log(artboards.map((a) => `${a.page} ${a.file} ${a.w}x${a.h} @${a.x},${a.y}`).join('\n'));
