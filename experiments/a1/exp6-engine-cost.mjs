/* A1 실험 6 — 물리 엔진의 계산 비용 (일회용)
 * 묻는 것: World 렌더 루프가 얼마나 무거운가?
 *          무거우면 데스크톱 런타임의 웹뷰 엔진 선택(Chromium vs WebKitGTK)이 실제로 중요해진다.
 *          가벼우면 그 논거는 사라지고 다른 기준으로 골라야 한다.
 * 버릴 것: 이 파일. */
import { readFileSync } from 'node:fs';
// Path2D 는 브라우저 API 다. 세그먼트 수를 세는 최소 대역을 세워 계산량만 측정한다.
let SEG = 0;
globalThis.Path2D = class { moveTo(){ SEG++; } lineTo(){ SEG++; } quadraticCurveTo(){ SEG++; }
  bezierCurveTo(){ SEG++; } arc(){ SEG++; } closePath(){} addPath(){} };
const src = readFileSync(new URL('../../prototype/src/world.js', import.meta.url), 'utf8');
const JQ = (0, eval)(src + '; JQ');   // 동결 엔진을 그대로 평가한다

const m = JQ.newModel();
JQ.add(m, JQ.mkPlace({id:'base',semantic:false,x:410,y:268,rx:336,ry:156,rot:-0.05,amp:0.40,mass:0.9}));
const P=[['intake',250,168,152,60,0.10,0.55,0.30,0],['auth',418,246,150,84,-0.10,0.92,0.55,34],
         ['session',596,306,128,62,0.16,0.60,0.50,20],['pay',576,172,106,54,-0.24,0.42,0.25,50],
         ['store',262,334,178,74,0.05,1.06,0.95,-44]];
for (const [id,x,y,rx,ry,rot,amp,mass,dir] of P)
  JQ.add(m, JQ.mkPlace({id,names:[id],x,y,rx,ry,rot,amp,mass,dir}));
m.voids.push({x:520,y:190,rx:40,ry:27,depth:0.90});

const gr = JQ.newGrid();
const paths = JQ.newPaths ? JQ.newPaths() : null;

// 한 프레임 = compute + tessellate/streams. 실제 루프가 매 프레임 하는 일.
function frame(now, attn){
  JQ.compute(gr, m, now, attn, null);
  if (JQ.streams && paths) JQ.streams(gr, paths, attn, 0);
}
frame(0, null);                                    // 워밍업

const N = 120;
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) frame(i * 16.7, { x: 418, y: 246, r: 1 });
const t1 = process.hrtime.bigint();
const perFrame = Number(t1 - t0) / 1e6 / N;

console.log(JSON.stringify({
  exported: Object.keys(JQ).length,
  path_segments_per_frame: Math.round(SEG / (N + 1)),
  frames: N,
  ms_per_frame_cpu: +perFrame.toFixed(2),
  implied_fps_cpu_only: Math.round(1000 / perFrame),
  budget_60fps_ms: 16.7,
  verdict: perFrame < 8 ? '여유 있음 — 웹뷰 엔진 성능이 결정 요인이 아니다'
         : perFrame < 16.7 ? '빠듯함 — 느린 웹뷰에서 위험'
         : '초과 — 웹뷰 엔진 성능이 결정 요인이다',
  note: '이것은 CPU 계산만이다. 실제 Canvas 2D 스트로크 비용은 여기에 더해진다.',
}, null, 2));
