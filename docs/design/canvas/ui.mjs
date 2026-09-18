/* 아트보드 본문을 짓는 조각들. 마크업은 앱의 구조를 그대로 따라간다. */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 스펙 시트의 한 칸: 상태 이름 · 언제 나오는가 · 그 상태의 실제 화면 조각.
 *
 * 폭은 기본적으로 **그리드 트랙이 정한다.** 전에는 360px 고정이었는데, 1100 폭 보드의
 * 3칼럼 트랙은 340px 이라 칸이 트랙을 넘어 열 사이 간격을 먹고 마지막 열이 프레임 밖으로
 * 밀려났다. `w` 는 그리드 밖에 홀로 놓는 칸에만 준다.
 */
export const spec = (label, when, inner, w = null) => `
  <div style="display:flex; flex-direction:column; gap:6px; ${w ? `width:${w}px;` : 'width:100%; min-width:0;'}">
    <div class="speclabel">${label}</div>
    <div class="specnote">${when}</div>
    ${inner}
  </div>`;

export const card = (inner, extra = '') =>
  `<div class="card" style="padding:14px 16px; display:flex; flex-direction:column; gap:10px; ${extra}">${inner}</div>`;

/** kind 를 비우면 중립 칩이다 — 앱이 '멈췄어요' 에 쓰는 것과 같은 모양. */
export const chip = (kind, txt) => `<span class="chip${kind ? ' ' + kind : ''}">${txt}</span>`;
export const btn = (txt, cls = '') => `<button class="btn sm ${cls}" type="button">${txt}</button>`;
export const acts = (...bs) => `<div style="display:flex; gap:8px; flex-wrap:wrap;">${bs.join('')}</div>`;

/** `16` §2.1 의 다음 행동 블록 — JuQode 의 청록 왼쪽 선. */
export const nextacts = (label, ...bs) => `
  <div style="border-left:3px solid var(--juq); padding-left:10px; display:flex; flex-direction:column; gap:6px;">
    <div class="xs" style="color:var(--juq); font-weight:600; letter-spacing:.03em;">${label}</div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">${bs.join('')}</div>
  </div>`;

export const topbar = (title) => `
  <div class="topbar">
    <span class="brand">JuQode</span>
    <span style="display:flex; align-items:baseline; gap:8px; min-width:0;">
      <span style="font-weight:600;">my-shop</span>
      <span class="xs mut2 mono" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:42ch;">/home/me/projects/my-shop</span>
    </span>
    <span class="grow"></span>
    <span class="xs mut2">${title}</span>
  </div>`;

/** 화면 스펙 머리 — 어느 화면의 어떤 묶음인지. */
export const sheet = (title, sub, inner) => `
  <div class="stack">
    <div style="display:flex; flex-direction:column; gap:2px;">
      <div class="h1">${title}</div>
      <div class="lead">${sub}</div>
    </div>
    ${inner}
  </div>`;

export const grid = (inner, cols = 3, gap = 18) =>
  `<div style="display:grid; grid-template-columns:repeat(${cols}, minmax(0, 1fr)); gap:${gap}px;">${inner}</div>`;
