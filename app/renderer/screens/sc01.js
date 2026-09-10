/* SC-01 · Project Open — WBS-02.
 * 15 SC-01: one product statement, one primary action, an optional recent list (A-8).
 * Explicitly NOT included (15): project creation · templates · clone · remote ·
 * workspace management · login · settings. */
import { C } from '../copy.js';
import { el, btn } from '../dom.js';
import { mountThemeToggle } from '../design/theme.js';

/* Machine reason → approved words. Main never sends a sentence; this is the only place
 * a reason becomes Korean, so `18` stays the single copy source. */
const REASON = {
  unreadable:    C.sc01.failReason,
  missing:       C.gap.failMissing,
  'not-a-folder': C.gap.failNotFolder,
};

export function renderSC01(root, api, nav, state) {
  root.innerHTML = '';

  const shell = el('div', 'shell');
  const bar = el('div', 'topbar');
  bar.appendChild(el('span', 'brand', C.app.name));
  bar.appendChild(el('span', 'grow'));
  mountThemeToggle(bar, C.theme);
  shell.appendChild(bar);

  const main = el('main', 'sc01 fade-in');
  main.setAttribute('data-screen', 'SC-01');

  const hero = el('div', 'card hero');   /* 16 §1: everything is a card */
  hero.appendChild(el('h1', 'h1', C.sc01.title));
  hero.appendChild(el('p', 'lead', C.sc01.lead));

  const actions = el('div', 'actions');
  const openBtn = btn('btn pri', C.sc01.open, () => run(() => api.openProject(), false));
  openBtn.setAttribute('data-act', 'open-project');
  actions.appendChild(openBtn);
  actions.appendChild(el('span', 'xs mut', C.sc01.openHint));
  hero.appendChild(actions);
  main.appendChild(hero);

  /* The store is what remembers projects. If it was refused we say so instead of
   * offering a button whose result cannot be kept. 21 WBS-21: refuse, never replace. */
  if (!state.store?.ok) {
    openBtn.disabled = true;
    main.appendChild(storeCard(state.store?.reason));
  }

  /* WBS-33 · 원칙 2 — the build says whether it is signed, on the first screen after install.
   * CF-21: no screen spec hosts this; SC-01 is chosen because it is the only screen with no
   * project context and the moment a SmartScreen warning is still fresh. */
  const sig = buildNotice(state.signature);
  if (sig) main.appendChild(sig);

  /* Recent list — A-8 (Founder-pending, removable). SC-01 is complete without it. */
  const recent = el('section', 'recent');
  recent.setAttribute('data-el', 'recent');
  recent.appendChild(el('h2', null, C.sc01.recent));
  if (state.recent.length === 0) {
    recent.appendChild(el('div', 'empty', C.sc01.noHistory));
  } else {
    const list = el('div', 'rows');
    for (const p of state.recent) list.appendChild(recentRow(p, () => run(() => api.openPath(p.path))));
    recent.appendChild(list);
  }
  recent.appendChild(el('span', 'footnote', C.sc01.recentNote));
  main.appendChild(recent);

  shell.appendChild(main);
  root.appendChild(shell);

  /* `reading` says whether a folder is actually being read. The folder BUTTON opens a native
   * dialog first and blocks until the user picks or cancels — saying `폴더를 읽고 있어요…`
   * during that would be a claim about a folder that has not been chosen. A recent row names
   * its folder up front, so there the sentence is true. */
  async function run(call, reading = true) {
    openBtn.disabled = true;
    const label = openBtn.textContent;
    if (reading) openBtn.textContent = C.sc01.opening;
    let res;
    try {
      res = await call();
    } finally {
      openBtn.disabled = !state.store?.ok;
      openBtn.textContent = label;
    }
    main.querySelector('[data-el="fail"]')?.remove();
    if (res?.ok) return nav.toWorkbench(res.project, res.interpretation ?? null);
    if (res?.reason === 'cancelled') return;            // 15: cancelling shows nothing
    main.appendChild(failCard(res, () => run(() => api.openPath(res.path)), () => run(() => api.openProject(), false)));
  }

  return { shell, main, openBtn };
}

/* The build's own signature (WBS-33).
 *
 * `16` §2.1 rules out almost everything here: red is the ONE red on this screen and belongs to
 * a folder that could not be opened, amber fill means 부분 and amber outline means 대기, green ▸
 * means a recovery action the user can take. An unsigned build is none of those — it is JuQode
 * stating a fact about itself, so it wears JuQode's own teal. When the signature could not be
 * judged at all it wears the dashed unknown instead, which is the same distinction D-114 draws.
 *
 * A development run returns nothing: `npm start` produces no distributed build, so there is no
 * fact yet to disclose. That is the one case where silence is not hiding. */
function buildNotice(sig) {
  if (!sig || sig.state === 'not-applicable') return null;

  const known = sig.state === 'unsigned';
  const n = el('div', known ? 'buildnote' : 'buildnote unk');
  n.setAttribute('data-el', 'build-signature');
  n.setAttribute('data-state', sig.state);
  n.appendChild(el('div', 't', known ? C.gap.unsignedTitle : C.gap.unsignedUnknown));
  if (known) n.appendChild(el('div', 'sm', C.gap.unsignedBody));
  return n;
}

/* 열 수 없음 — the one red on this screen (15 SC-01 Failure State):
 * title + reason in plain words + 2 recovery actions + technical detail behind a disclosure. */
function failCard(res, onRetry, onOther) {
  const n = el('div', 'failcard');
  n.setAttribute('data-el', 'fail');
  n.appendChild(el('div', 't', C.sc01.failTitle));
  n.appendChild(el('div', 'sm', REASON[res?.reason] ?? C.gap.failUnknown));

  /* `16` §2.1: 초록 ▸ 는 복구 동작이다 — 그리고 이 카드의 두 버튼이 정확히 그것이다(사용자가
   * 고르지 않은 상태에서 빠져나오는 길). 위 주석이 이 화면의 색 문법으로 그렇게 적어 두고도
   * 표시가 붙어 있지 않아, 빨간 카드 안에서 나가는 길만 회색이었다. */
  const acts = el('div', 'row-acts');
  if (res?.path) acts.appendChild(btn('btn sm rec', C.sc01.retry, onRetry));
  acts.appendChild(btn('btn sm rec', C.sc01.other, onOther));
  n.appendChild(acts);

  if (res?.detail) {
    const d = el('details');
    d.appendChild(el('summary', 'xs mut', C.sc01.tech));
    d.appendChild(el('div', 'xs mono mut', res.detail));
    n.appendChild(d);
  }
  return n;
}

/* Store refusal is not a folder failure — neutral grey, the 지금 안 됨 grammar (12 §16).
 * It says the existing file was left alone, because that is what actually happened. */
function storeCard(reason) {
  const n = el('div', 'card storecard');
  n.setAttribute('data-el', 'store');
  const head = el('div', 'head');
  head.appendChild(el('span', 'sm', C.gap.storeTitle));
  head.appendChild(el('span', 'chip unavail', C.unavailable.chip));
  n.appendChild(head);
  n.appendChild(el('div', 'sm mut', C.gap.storeBody));
  /* The machine reason is technical output, so it goes behind the same disclosure the
   * folder failure uses — never loose on the card as if it were a sentence. */
  if (reason) {
    const d = el('details');
    d.appendChild(el('summary', 'xs mut', C.sc01.tech));
    d.appendChild(el('div', 'xs mono mut', reason));
    n.appendChild(d);
  }
  return n;
}

/* The schema's outcome codes → `18`'s own title keys. Same table as SC-02's History and
 * SC-03's result; `cancelled_nochange` is NEUTRAL — the user stopped it, which is not 지금 안 됨. */
const LAST_OUTCOME = {
  complete:           { cls: 'ok',   key: 'complete' },
  partial:            { cls: 'part', key: 'partial' },
  failed:             { cls: 'fail', key: 'failed' },
  cancelled_partial:  { cls: 'part', key: 'cancelled_partial' },
  cancelled_nochange: { cls: '',     key: 'cancelled_none' },
  ended_unknown:      { cls: 'unk',  key: null },
};

function recentRow(p, onOpen) {
  const row = el('button', 'recentrow');
  row.type = 'button';
  row.setAttribute('data-el', 'recent-row');
  row.addEventListener('click', onOpen);
  row.appendChild(el('span', 'nm', p.name));
  row.appendChild(el('span', 'xs mut path', p.path));
  /* `15` SC-01 · UF-RETURN: the row says what was last DONE here, so a returning user
   * recognises the project by its work rather than by its folder name. Drawn only when there
   * IS a last Work — an empty summary would be a row saying nothing at greater length. */
  if (p.lastWork) {
    const last = el('div', 'xs mut recentlast');
    last.appendChild(el('span', 'lbl', C.sc01.lastWork));
    last.appendChild(el('span', 'val', p.lastWork.intent));
    const o = LAST_OUTCOME[p.lastWork.outcome];
    /* Running is not an outcome. A Work that has not ended gets the waiting chip, never one of
     * the five terminal titles. */
    if (p.lastWork.status !== 'ended') last.appendChild(el('span', 'chip wait', C.gap.historyRunning));
    else if (o) last.appendChild(el('span', `chip ${o.cls}`, C.work.resultTitle[o.key] ?? C.work.unknownTitle));
    row.appendChild(last);
  }
  return row;
}
