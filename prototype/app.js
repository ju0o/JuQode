/* JuQode v0.1 — Functional Prototype
 *
 * 핵심 원칙 (LOVABLE_HANDOFF_V01.md §6):
 *   들어가는 것은 라우팅이 아니다. 하나의 DOM 트리에서 컨테이너가 커진다.
 *   지나온 단계는 언마운트되지 않고 테두리로 남는다.
 *
 * 그래서 이 파일에는 router가 없다. depth가 바뀌면 좌표만 다시 계산한다. */

/* data.js 가 먼저 로드되어 전역에 있다 (index.html 의 script 순서) */

window.addEventListener('error', (e) => {
  document.title = 'JQ_ERR ' + e.message + ' @ ' + (e.lineno || '?');
});
const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const ctx = $('#ctx');
const ctxIn = $('#ctxIn');
const ask = $('#ask');
const go = $('#go');
const prep = $('#prep');
const back = $('#back');
const agent = $('#agent');
const agentText = $('#agentText');

/* ── state ───────────────────────────────────────────── */
const S = {
  depth: 'world',          // world | service | feature
  selected: null,          // feature id
  qode: 'idle',            // idle | working | done
  events: [],
  changed: false,          // 30초 기다리기가 구조에 들어갔는가
};
let timers = [];
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

/* ── world-level 관계 도형 (A 문법) ──────────────────── */
function figureSVG(sw, w, h) {
  const { layers, edges, absent, attention } = sw;
  const cols = layers.length, cw = w / cols;
  const pos = []; let i = 0;
  layers.forEach((count, c) => {
    const step = h / (count + 1);
    for (let r = 0; r < count; r++) pos[i++] = { x: cw * c + cw / 2, y: step * (r + 1) };
  });
  const lines = edges.map(([a, b]) => {
    const p = pos[a], q = pos[b]; if (!p || !q) return '';
    const mx = (p.x + q.x) / 2;
    return `<path d="M ${p.x} ${p.y} L ${mx} ${p.y} L ${mx} ${q.y} L ${q.x} ${q.y}" fill="none" stroke="#4A4641" stroke-width="1"/>`;
  }).join('');
  const sz = 12;
  const nodes = pos.map((p, n) => {
    const off = absent.includes(n), at = attention.includes(n);
    const fill = off ? '#F7F5F2' : at ? '#9A5B12' : '#0D0C0B';
    const extra = off ? ' stroke="#B5AEA5" stroke-width="1" stroke-dasharray="2 2"' : '';
    return `<rect x="${(p.x - sz / 2).toFixed(1)}" y="${(p.y - sz / 2).toFixed(1)}" width="${sz}" height="${sz}" fill="${fill}"${extra}/>`;
  }).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${lines}${nodes}</svg>`;
}

/* ── DOM 최초 구성. 이후 다시 만들지 않는다 ──────────── */
const el = {};

function build() {
  stage.innerHTML = `
    <div class="frame" id="worldFrame">
      <span class="notch" id="worldNotch">이 컴퓨터</span>
      <span class="nstat" id="worldStat">소프트웨어 4 · 기능 18</span>
      <span class="memo" id="worldMemo">각 도형은 그 소프트웨어의 기능과 관계다 — 자라면 구조가 자란다</span>
    </div>`;
  el.worldFrame = $('#worldFrame');
  el.worldNotch = $('#worldNotch');
  el.worldStat = $('#worldStat');
  el.worldMemo = $('#worldMemo');

  el.sw = {};
  for (const sw of WORLD) {
    const d = document.createElement('div');
    d.className = 'sw' + (sw.current ? ' current' : '');
    d.dataset.id = sw.id;
    d.innerHTML = `
      <div class="swName">${sw.name}</div>
      <div class="swMeta">기능 ${sw.featureCount} · ${sw.note}${sw.current ? ' · 지금 여기' : ''}</div>
      <div class="swFig"></div>
      ${sw.current ? '<div class="swHint">이 도형이 My Service의 구조다 — 채운 칸은 되어 있는 것, 주황은 확인 필요, 점선은 아직 없는 것</div>' : ''}
      ${sw.current ? `<span class="notch" style="opacity:0" data-role="svcNotch">MY SERVICE</span>
        <span class="nstat" style="opacity:0" data-role="svcStat">기능 8 · 확인 필요 2 · 아직 없는 것 1</span>
        <div class="inner" data-role="svcInner"><svg class="edges" data-role="ftEdges"></svg></div>` : ''}`;
    d.addEventListener('click', () => onSoftwareClick(sw.id));
    stage.appendChild(d);
    el.sw[sw.id] = d;
  }

  const ms = el.sw.myservice;
  el.svcNotch = ms.querySelector('[data-role=svcNotch]');
  el.svcStat = ms.querySelector('[data-role=svcStat]');
  el.svcInner = ms.querySelector('[data-role=svcInner]');
  el.ftEdges = ms.querySelector('[data-role=ftEdges]');

  el.ft = {};
  for (const f of FEATURES) {
    const d = document.createElement('div');
    d.className = 'ft' + (f.attention ? ' attention' : '') + (f.absent ? ' absent' : '');
    d.dataset.id = f.id;
    d.innerHTML = `
      <div class="ftName">${f.name}${f.attention ? '<span class="mk a"></span>' : ''}</div>
      <div class="ftMeta">동작 ${f.behaviors.length}${f.absent ? ' · 아직 없음' : f.attention ? ' · 확인 필요' : ''}</div>
      <div class="ftList">${f.behaviors.join('<br>')}</div>
      ${f.id === 'login' ? `<span class="notch" style="opacity:0" data-role="lgNotch">로그인</span>
        <span class="nstat" style="opacity:0" data-role="lgStat">동작 6 · 정상 작동</span>
        <div class="inner" data-role="lgInner"><svg class="edges" data-role="bhEdges"></svg></div>` : ''}`;
    d.addEventListener('click', (e) => { e.stopPropagation(); onFeatureClick(f.id); });
    el.svcInner.appendChild(d);
    el.ft[f.id] = d;
  }

  const lg = el.ft.login;
  el.lgNotch = lg.querySelector('[data-role=lgNotch]');
  el.lgStat = lg.querySelector('[data-role=lgStat]');
  el.lgInner = lg.querySelector('[data-role=lgInner]');
  el.bhEdges = lg.querySelector('[data-role=bhEdges]');

  el.bh = {};
  for (const b of [...LOGIN_BEHAVIORS, NEW_BEHAVIOR]) {
    const d = document.createElement('div');
    d.className = 'bh' + (b.fail ? ' fail' : '') + (b.made ? ' made appearing' : '');
    d.dataset.id = b.id;
    d.innerHTML = `<div class="bIdx">${b.idx}</div><div class="bName">${b.name}</div>
      <div class="bNote">${b.note}</div>${b.made ? '<span class="bTag">새로 생김</span>' : ''}`;
    if (b.made) d.style.display = 'none';
    el.lgInner.appendChild(d);
    el.bh[b.id] = d;
  }
}

/* ── 직교 관계선 ─────────────────────────────────────── */
const MARKERS = `<defs>
  <marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#0D0C0B"/></marker>
  <marker id="af" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#8C2B20"/></marker>
</defs>`;

function orthPath(a, b, stub) {
  if (Math.abs(a.y - b.y) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const mx = a.x + stub;
  return `M ${a.x} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`;
}

function drawEdges(svg, host, pairs, boxes, opts = {}) {
  const paths = pairs.map(([from, to]) => {
    const A = boxes[from], B = boxes[to];
    if (!A || !B) return '';
    const a = { x: A.x + A.w, y: A.y + A.h / 2 };
    const b = { x: B.x, y: B.y + B.h / 2 };
    return `<path d="${orthPath(a, b, opts.stub || 24)}" fill="none" stroke="#0D0C0B" stroke-width="1" marker-end="url(#ah)"/>`;
  }).join('');
  let extra = '';
  if (opts.ret) {
    const A = boxes[opts.ret.from], B = boxes[opts.ret.to];
    if (A && B) {
      const y = Math.min(A.y + A.h + (opts.retLane || 58), (opts.bottom || 1e9) - 14);
      extra = `<path d="M ${A.x + A.w / 2} ${A.y + A.h} L ${A.x + A.w / 2} ${y} L ${B.x + B.w / 2} ${y} L ${B.x + B.w / 2} ${B.y + B.h}" fill="none" stroke="#8C2B20" stroke-width="1" stroke-dasharray="6 4" marker-end="url(#af)"/>`;
    }
  }
  svg.innerHTML = MARKERS + paths + extra;
  // 분기 라벨은 DOM으로 (배경으로 선을 덮어야 읽힌다)
  host.querySelectorAll('.eLabel').forEach((n) => n.remove());
  (opts.labels || []).forEach(({ from, to, text, fail }) => {
    const A = boxes[from], B = boxes[to]; if (!A || !B) return;
    const s = document.createElement('span');
    s.className = 'eLabel' + (fail ? ' f' : '');
    s.textContent = text;
    s.style.left = `${A.x + A.w + (opts.stub || 24) + 6}px`;
    s.style.top = `${(A.y + A.h / 2 + B.y + B.h / 2) / 2 - 8}px`;
    host.appendChild(s);
  });
}

/* ── 레이아웃 ────────────────────────────────────────── */
const WORLD_POS = {
  myservice: [0.04, 0.30, 0.47, 0.62],
  juguard:   [0.55, 0.07, 0.33, 0.35],
  store:     [0.60, 0.53, 0.29, 0.31],
  blog:      [0.11, 0.07, 0.23, 0.18],
};

/* 레이아웃은 애니메이션 중인 실측값이 아니라 목표 좌표에서 계산한다.
 * (실측을 쓰면 전이 도중에 계산되어 음수 좌표가 나온다 — 실제로 겪은 버그) */
function ctxVisible() {
  return S.qode === 'working' || S.qode === 'done' || !!S.selected;
}
function stageBox() {
  const b = document.querySelector('.body');
  const W = b.clientWidth - (ctxVisible() ? 342 : 0);
  return { W, H: b.clientHeight };
}

function layout() {
  const { W, H } = stageBox();
  if (!W || !H) return;
  const inService = S.depth === 'service' || S.depth === 'feature';
  const inFeature = S.depth === 'feature';

  /* 세계 테두리 — 사라지지 않는다. 얇아진다 */
  const wi = S.depth === 'world' ? 14 : inFeature ? 8 : 12;
  Object.assign(el.worldFrame.style, { left: `${wi}px`, top: `${wi}px`, right: `${wi}px`, bottom: `${wi}px` });
  el.worldNotch.textContent = S.depth === 'world' ? '이 컴퓨터' : '이 컴퓨터 ›';
  el.worldStat.style.opacity = S.depth === 'world' ? '1' : '0';
  el.worldMemo.style.opacity = S.depth === 'world' ? '1' : '0';

  /* 소프트웨어 */
  for (const sw of WORLD) {
    const d = el.sw[sw.id];
    if (sw.id === 'myservice' && inService) {
      const inset = inFeature ? 24 : 34;
      Object.assign(d.style, { left: `${inset}px`, top: `${inset}px`,
        width: `${W - inset * 2}px`, height: `${H - inset * 2}px`, transform: 'none' });
      d.classList.add('entered'); d.classList.remove('receded');
    } else if (inService) {
      const [x, y, w, h] = WORLD_POS[sw.id];
      // 바깥으로 물러난다 — 사라지는 게 아니라 밀려난다
      const dx = (x + w / 2 - 0.5) * 760, dy = (y + h / 2 - 0.5) * 560;
      Object.assign(d.style, { left: `${x * W}px`, top: `${y * H}px`,
        width: `${w * W}px`, height: `${h * H}px`,
        transform: `translate(${dx}px,${dy}px) scale(.9)` });
      d.classList.add('receded'); d.classList.remove('entered');
    } else {
      const [x, y, w, h] = WORLD_POS[sw.id];
      Object.assign(d.style, { left: `${x * W}px`, top: `${y * H}px`,
        width: `${w * W}px`, height: `${h * H}px`, transform: 'none' });
      d.classList.remove('receded', 'entered');
      const fig = d.querySelector('.swFig');
      const fw = Math.round(w * W) - 40, fh = Math.max(46, Math.round(h * H) - 118);
      const key = `${fw}x${fh}`;
      if (fig.dataset.key !== key) { fig.dataset.key = key; fig.innerHTML = figureSVG(sw, fw, fh); }
    }
  }

  el.svcInner.classList.toggle('on', inService);
  el.svcNotch.style.opacity = inService ? '1' : '0';
  el.svcNotch.textContent = inFeature ? 'MY SERVICE ›' : 'MY SERVICE';
  el.svcStat.style.opacity = inService && !inFeature ? '1' : '0';
  if (!inService) return;

  /* Feature 층 배치 — 격자가 아니라 관계 방향. 목표 좌표로 계산한다 */
  const svcInset = inFeature ? 24 : 34;
  const aw = (W - svcInset * 2) - 4;
  const ah = (H - svcInset * 2) - 4 - 30;
  const LAYERS = 4;
  let GAP = 40;
  const colW = Math.round((aw - GAP * (LAYERS - 1)) / LAYERS);
  const raw = (f) => 74 + f.behaviors.length * 24;             // DESIGN.md §E — 면적이 곧 내용
  const byLayer = [0, 1, 2, 3].map((L) => FEATURES.filter((f) => f.layer === L));
  // 가장 빡빡한 층이 넘치면 비례를 유지한 채 함께 줄인다
  let scale = 1;
  for (const list of byLayer) {
    if (!list.length) continue;
    const need = list.reduce((a, f) => a + raw(f), 0) + GAP * (list.length - 1);
    if (need > ah) scale = Math.min(scale, (ah - GAP * (list.length - 1)) / (need - GAP * (list.length - 1)));
  }
  scale = Math.max(0.62, scale);
  const hOf = (f) => Math.round(raw(f) * scale);
  const boxes = {};
  byLayer.forEach((list, L) => {
    const total = list.reduce((a, f) => a + hOf(f), 0) + GAP * (list.length - 1);
    let y = Math.max(0, Math.round((ah - total) / 2));
    for (const f of list) {
      boxes[f.id] = { x: L * (colW + GAP), y, w: colW, h: hOf(f) };
      y += hOf(f) + GAP;
    }
  });

  for (const f of FEATURES) {
    const d = el.ft[f.id], b = boxes[f.id];
    if (f.id === 'login' && inFeature) {
      Object.assign(d.style, { left: '26px', top: '26px', width: `${aw - 52}px`, height: `${ah - 52}px` });
      d.classList.add('entered'); d.classList.remove('receded', 'selected');
    } else if (inFeature) {
      Object.assign(d.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      d.classList.add('receded'); d.classList.remove('entered', 'selected');
    } else {
      Object.assign(d.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      d.classList.remove('receded', 'entered');
      d.classList.toggle('selected', S.selected === f.id);
    }
  }
  drawEdges(el.ftEdges, el.svcInner, FEATURE_EDGES, boxes, { stub: 26 });
  el.ftEdges.style.opacity = inFeature ? '0' : '1';
  el.svcInner.querySelectorAll('.eLabel').forEach((n) => { n.style.opacity = inFeature ? '0' : '1'; });

  el.lgInner.classList.toggle('on', inFeature);
  el.lgNotch.style.opacity = inFeature ? '1' : '0';
  el.lgStat.style.opacity = inFeature ? '1' : '0';
  el.lgStat.textContent = S.changed ? '동작 7 · 방금 1개 늘었다' : '동작 6 · 정상 작동';
  if (!inFeature) return;

  /* Behavior 배치 — 성공/실패 분기. 목표 좌표로 계산한다 */
  const bw = aw - 52 - 4;
  const bh = ah - 52 - 4 - 30;
  const NG = 34;
  const NW = Math.min(212, Math.round((bw - 4 * NG) / 5));
  const NH = Math.max(104, Math.min(132, Math.round((bh - 150) / 3)));
  // 세 줄(성공 / 본류 / 실패) + 되돌아가는 점선이 지나갈 차선까지 계산해 가운데 둔다
  const upGap = Math.round(NH * 1.2), loGap = Math.round(NH * 1.35), RET_LANE = 62;
  const span = upGap + NH + loGap + RET_LANE;
  const top0 = Math.max(0, Math.round((bh - span) / 2));
  const midY = top0 + upGap;
  const rowY = { '-1': top0, 0: midY, 1: midY + loGap };
  const list = S.changed ? [...LOGIN_BEHAVIORS, NEW_BEHAVIOR] : LOGIN_BEHAVIORS;
  const bboxes = {};
  for (const b of list) {
    bboxes[b.id] = { x: b.layer * (NW + NG), y: rowY[String(b.row)], w: NW, h: NH };
    const d = el.bh[b.id];
    d.style.display = '';
    Object.assign(d.style, { left: `${bboxes[b.id].x}px`, top: `${bboxes[b.id].y}px`,
      width: `${NW}px`, height: `${NH}px` });
  }
  if (!S.changed) el.bh.wait.style.display = 'none';

  const pairs = (S.changed ? LOGIN_EDGES_AFTER : LOGIN_EDGES_BEFORE).map(([a, b]) => [a, b]);
  const ret = S.changed ? RETURN_EDGE_AFTER : RETURN_EDGE_BEFORE;
  drawEdges(el.bhEdges, el.lgInner, pairs, bboxes, {
    stub: 17, ret, retLane: 34, bottom: bh,
    labels: [
      { from: 'auth', to: 'session', text: '성공' },
      { from: 'auth', to: 'fail', text: '실패', fail: true },
    ],
  });
}

/* ── Contextual Work Surface ────────────────────────── */
function renderCtx() {
  let html = '';
  if (S.qode === 'working') {
    html = `
      <div class="ctxKind">이번 QODE</div>
      <div class="ctxH2">${QODE.working}</div>
      <div class="blk"><div class="blkLabel">AGENT</div><div class="blkVal">${QODE.agent}</div></div>
      <div class="blk"><div class="blkLabel">자동 준비됨</div>
        <div class="list">${QODE.context.map((c) => `<span>${c}</span>`).join('')}
          <span class="a">SKILL · ${QODE.skill}</span></div></div>
      <div class="blk"><div class="blkLabel">실제로 일어난 일</div>
        <div class="events">${S.events.map((e) => `<span class="${e.pending ? 'now' : ''}"><b>${e.pending ? '지금' : '됨'}</b>${e.text}</span>`).join('')}</div></div>
      <div class="ctxNote">진행률은 없습니다.<br>실제로 일어난 것만 적습니다.</div>`;
  } else if (S.qode === 'done') {
    const r = QODE.result;
    html = `
      <div class="ctxKind">변경 결과</div>
      <div class="ctxH2">${r.outcome}</div>
      <div class="blk"><div class="blkLabel">영향</div>
        <div class="chips"><span class="strong">${r.impact}</span></div></div>
      <div class="blk"><div class="blkLabel">검증</div>
        <div class="nums">
          <div><span class="n">${r.verified}</span><span class="l">확인됨</span></div>
          <div><span class="n a">${r.attention}</span><span class="l">확인 필요</span></div>
        </div></div>
      <div class="blk"><div class="blkLabel">확인 필요</div>
        <div class="list"><span class="a">${r.attentionText}</span></div></div>
      <div class="blk"><div class="blkLabel">구조에 생긴 것</div><div class="blkVal">${r.structural}</div></div>
      <div class="ctxNote">화면이 보고서로 바뀌지 않았습니다.<br>결과는 Software 안에 들어 있습니다.</div>
      <div class="rawEntry"><span>원본 그대로</span><span>LEVEL 5</span></div>`;
  } else if (S.selected) {
    const f = FEATURES.find((x) => x.id === S.selected);
    html = `
      <div class="ctxKind">기능</div>
      <div class="ctxH1">${f.name}</div>
      <div class="blk"><div class="blkLabel">현재 상태</div>
        <div class="blkVal${f.attention ? ' a' : ''}">${f.absent ? '아직 없음' : f.attention ? '확인 필요' : f.state || '정상 작동'}</div></div>
      <div class="blk"><div class="blkLabel">동작 ${f.behaviors.length}가지</div>
        <div class="list">${f.behaviors.map((b) => `<span class="${b.includes('실패') ? 'f' : ''}">${b}</span>`).join('')}</div></div>
      ${f.related ? `<div class="blk"><div class="blkLabel">연관</div>
        <div class="chips">${f.related.map((r) => `<span>${r}</span>`).join('')}</div></div>` : ''}
      ${f.lastChange ? `<div class="blk"><div class="blkLabel">최근 변경</div>
        <div class="blkVal">${f.lastChange}</div></div>` : ''}
      ${f.id === 'login' ? '<div class="blk" style="border-bottom:0"><button class="go" id="enterBtn" style="border:2px solid var(--ink);padding:10px 16px;font-family:var(--mono);font-size:11px;letter-spacing:.12em">안으로 들어가기 →</button></div>' : ''}
      <div class="ctxNote">이 면은 고정되어 있지 않습니다.<br>선택을 풀면 사라집니다.</div>`;
  }
  ctxIn.innerHTML = html;
  ctx.classList.toggle('on', !!html);
  const b = $('#enterBtn');
  if (b) b.addEventListener('click', (e) => { e.stopPropagation(); enterFeature('login'); });
  requestAnimationFrame(() => requestAnimationFrame(layout));   // ctx 폭 변화 후 재배치
}

/* ── Qode Composer 보조 표시 ────────────────────────── */
function renderPrep() {
  if (S.qode === 'working') {
    prep.innerHTML = `자동 준비됨 · <b>CONTEXT ${QODE.contextCount}</b> · <b>SKILL ${QODE.skillCount}</b> · <span class="a">${QODE.agent.toUpperCase()} 작업 중</span>`;
  } else if (S.depth === 'world') {
    prep.innerHTML = '<span class="hint" style="margin:0">소프트웨어를 골라 안으로 들어가세요</span>';
  } else {
    prep.innerHTML = `자동 준비됨 · <b>CONTEXT ${QODE.contextCount}</b> · <b>SKILL ${QODE.skillCount}</b> · ${QODE.agent} — 직접 준비하지 않았습니다`;
  }
  const armed = S.depth === 'feature' && S.qode === 'idle' && ask.value.trim().length > 0;
  go.classList.toggle('armed', armed);
  go.disabled = S.depth !== 'feature' || S.qode !== 'idle';
  ask.disabled = S.depth !== 'feature' || S.qode !== 'idle';
  ask.placeholder = S.depth === 'feature' ? '원하는 걸 말해보세요.'
    : S.depth === 'service' ? '기능을 고르고 안으로 들어가면 말할 수 있습니다.'
    : '원하는 걸 말해보세요.';
}

function render() {
  back.classList.toggle('on', S.depth !== 'world');
  agent.classList.toggle('busy', S.qode === 'working');
  agentText.textContent = S.qode === 'working' ? `${QODE.agent} · 작업 중` : `${QODE.agent} · 연결됨`;
  renderCtx();
  renderPrep();
  layout();
}

/* ── 전이 ───────────────────────────────────────────── */
function onSoftwareClick(id) {
  if (S.depth !== 'world') return;
  if (id !== 'myservice') return;          // 이 프로토타입은 My Service 하나만 들어간다
  S.depth = 'service'; S.selected = null;
  render();
}
function onFeatureClick(id) {
  if (S.depth === 'feature') return;
  if (S.depth !== 'service') return;
  if (S.selected === id && id === 'login') return enterFeature('login');
  S.selected = S.selected === id ? null : id;
  render();
}
function enterFeature(id) {
  if (id !== 'login') return;
  S.depth = 'feature'; S.selected = 'login';
  ask.value = QODE.ask;
  render();
  setTimeout(() => ask.focus(), 560);
}
function goBack() {
  clearTimers();
  if (S.depth === 'feature') {
    S.depth = 'service'; S.selected = 'login'; S.qode = 'idle'; S.events = [];
    ask.value = '';
  } else if (S.depth === 'service') {
    S.depth = 'world'; S.selected = null;
  }
  render();
}

/* ── Qode 실행 (시뮬레이션) ─────────────────────────── */
function runQode() {
  if (S.depth !== 'feature' || S.qode !== 'idle' || !ask.value.trim()) return;
  S.qode = 'working'; S.events = [];
  render();
  for (const e of QODE.events) {
    timers.push(setTimeout(() => {
      S.events.forEach((x) => { x.pending = false; });
      S.events.push({ ...e });
      renderCtx();
    }, e.at));
  }
  timers.push(setTimeout(() => {
    S.qode = 'done';
    S.changed = true;                    // 결과는 Software 구조에 반영된다
    S.events.forEach((x) => { x.pending = false; });
    render();
    // 새 동작이 자기 자리에서 나타난다
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.bh.wait.classList.remove('appearing');
    }));
  }, QODE.completeAt));
}

/* ── 이벤트 ─────────────────────────────────────────── */
back.addEventListener('click', goBack);
go.addEventListener('click', runQode);
ask.addEventListener('input', renderPrep);
ask.addEventListener('keydown', (e) => { if (e.key === 'Enter') runQode(); });
stage.addEventListener('click', (e) => {
  if (e.target === stage && S.depth === 'service' && S.selected) { S.selected = null; render(); }
});
window.addEventListener('resize', layout);
stage.addEventListener('transitionend', (e) => {
  if (e.propertyName === 'width' || e.propertyName === 'height') layout();
});
ctx.addEventListener('transitionend', (e) => { if (e.propertyName === 'width') layout(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') goBack(); });

build();
render();
setTimeout(layout, 60);

/* ── 검수용 자동 클릭 (?drive=…) — 실제 click 이벤트를 쏜다 ── */
const params = new URLSearchParams(location.search);
if (params.get('still')) document.documentElement.classList.add('still');
const drive = params.get('drive');
if (drive) {
  const click = (n) => n && n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const seq = [];
  if (['service', 'feature', 'selected', 'working', 'done'].includes(drive)) {
    seq.push([100, () => click(el.sw.myservice)]);
  }
  if (['selected'].includes(drive)) seq.push([700, () => click(el.ft.login)]);
  if (['feature', 'working', 'done'].includes(drive)) {
    seq.push([700, () => click(el.ft.login)]);
    seq.push([1300, () => click($('#enterBtn'))]);
  }
  if (['working', 'done'].includes(drive)) seq.push([2100, () => click(go)]);
  if (drive === 'working') seq.push([5000, () => {}]);
  if (drive === 'done') seq.push([8200, () => {}]);
  for (const [at, fn] of seq) setTimeout(fn, at);
}
