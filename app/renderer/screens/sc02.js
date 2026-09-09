/* SC-02 · Workbench (작업대) — the board this project is worked from.
 *
 * Built here: the shared top bar (`15` §0), the board grid (`16` §4 — 6 columns), the Brief
 * (WBS-03's facts half), and the Work Stream / History empty states, which are TRUE of a
 * project with no Works.
 *
 * The Intent field and every card it can produce now live here: the Work route, the guard, the
 * evidence refusal, the 사용 불가 card, the ambiguity card, and the terminal-guidance card —
 * each of which now leads somewhere, which is why they were held back until this batch.
 *
 * NOT built here, and NOT drawn: the Brief's narrative half and fold/stale/refresh (WBS-04,
 * WBS-05), Agent Presence (WBS-35), the terminal drawer itself (WBS-25).
 *
 * Three of those were drawn in the first cut of this file and were wrong to draw. The Brief
 * slot rendered `지금 안 됨 · 실패 아님` — a chip that means a capability which EXISTS and is
 * blocked right now (12 §16) — for an engine that had not been built. The 사용 불가 card fired
 * on screen entry, while `12` UF-CLAUDE-UNAVAILABLE triggers on 시작 시도 and `15` fixes four
 * recovery buttons on it that belong to four other packages; four inert buttons are a dead end
 * dressed as an exit (UF-CLAUDE-ALT). Both were removed and both land with their trigger.
 *
 * An absent surface is honest. A surface that explains its own absence in borrowed words is not.
 */
import { C } from '../copy.js';
import { el, btn } from '../dom.js';
import { renderBrief, when } from './brief.js';
import { mountThemeToggle } from '../design/theme.js';

export function renderSC02(root, api, nav, state) {
  root.innerHTML = '';
  const p = state.project;

  const shell = el('div', 'shell');

  const bar = el('div', 'topbar');
  bar.appendChild(el('span', 'brand', C.app.name));
  const id = el('span', 'projid');
  id.appendChild(el('span', 'nm', p.name));
  id.appendChild(el('span', 'xs mut path', p.path));   /* truncation is CSS, so the title stays whole */
  id.title = p.path;
  bar.appendChild(id);
  bar.appendChild(el('span', 'grow'));
  bar.appendChild(btn('btn sm ghost nodrag', C.nav.otherProject, () => nav.toPicker()));
  mountThemeToggle(bar, C.theme);
  shell.appendChild(bar);

  const board = el('main', 'sc02 board fade-in');
  /* TWO COLUMN STACKS, not a row grid.
   *
   * `17` asks for a module board of differently sized cards, and the first implementation used a
   * six-column grid with `grid-auto-flow: dense` and auto rows. MEASURED: once History had rows,
   * the Brief was drawn straight OVER the card below it — an auto row sized to 449 px while the
   * card in it was 591 px tall, and dense flow then packed another card into the space the Brief
   * was already painting on. `align-self: stretch` only moved the failure: the card then clipped
   * its own content at exactly two rows, which `16` §4 forbids outright.
   *
   * A stack cannot overlap. Each column is a flex column, so a card is exactly as tall as its
   * content and the next card starts below it — no row arithmetic to get wrong. */
  const colL = el('div', 'sc02-col');
  const colR = el('div', 'sc02-col');
  board.appendChild(colL);
  board.appendChild(colR);
  board.setAttribute('data-screen', 'SC-02');

  /* ① Brief — WIDE. Real now: three of the six answers come from files this project actually
   * contains, and the other three say 확인 못함 (`11`: 부분 해석은 실패가 아니다). */
  const brief = card('wide2', 'brief');
  colL.appendChild(brief);
  renderBrief(brief, state.interpretation);
  if (!state.interpretation) {
    api.interpret(p.id).then((r) => {
      /* `r.ok === false` means the REQUEST failed (no store, unknown project, a handler that
       * threw). That is not "we could not read the folder", and painting it as one would put
       * a cause on screen that did not happen. The scan's own errno rides on `failedCode`. */
      state.interpretation = r?.ok
        ? r.interpretation
        : { status: 'failed', failedCode: null, answers: [], readFiles: [] };
      renderBrief(brief, state.interpretation);
    });
  }

  /* ② Intent — WIDE. `15` SC-02 and D-134: this field has exactly ONE outgoing route, a
   * Claude Code Work. A technical execution request is NOT run; the field says where that
   * lives. Nothing is routed as the user types — the route is disclosed after submit only
   * (D-106), because a live guess is a guess. */
  const intent = card('wide', 'intent');
  intent.appendChild(head(C.intent.label));
  const field = el('textarea', 'intentfield');
  field.setAttribute('data-el', 'intent');
  field.placeholder = C.intent.ph;
  field.rows = 2;
  intent.appendChild(field);

  const consequence = el('div', 'consequence');
  consequence.setAttribute('data-el', 'consequence');
  intent.appendChild(consequence);

  const submit = btn('btn pri', C.intent.submit, () => send());
  submit.setAttribute('data-act', 'submit-intent');
  const row = el('div', 'row-acts');
  row.appendChild(submit);
  row.appendChild(el('span', 'xs mut', C.intent.helper));
  intent.appendChild(row);
  intent.appendChild(el('div', 'xs mut2', C.intent.examples));
  intent.appendChild(el('div', 'xs mut2', C.intent.approvalNote));
  colR.appendChild(intent);

  /* Enter submits, Shift+Enter is a newline (`15` SC-02 Inputs). */
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  async function send() {
    const text = field.value;
    if (!text.trim()) return;
    consequence.innerHTML = '';
    submit.disabled = true;
    try {
      const routed = await api.routeIntent(text);
      const route = routed?.route?.route ?? 'work';

      /* Not a failure and not red — a place, not a refusal (D-134). */
      if (route === 'terminal') { consequence.appendChild(terminalCard()); return; }
      if (route === 'ambiguous') { consequence.appendChild(ambiguousCard(routed.route, () => startWork(text))); return; }
      if (route === 'unrecognized') { consequence.appendChild(line(C.intent.routeUnrec)); return; }
      await startWork(text);
    } finally { submit.disabled = false; }
  }

  async function startWork(text) {
    consequence.appendChild(line(C.intent.routeWork));
    const pend = el('div', 'sm mut');
    pend.setAttribute('data-el', 'pending');
    pend.textContent = C.pending.label;              // a place-holder card, NOT a progress bar
    consequence.appendChild(pend);

    const r = await api.workStart(p.id, text);
    pend.remove();
    if (r?.ok) { field.value = ''; return nav.toWork(r.work); }

    /* `15` SC-02 keeps the submitted text in the field for every one of these — it is never
     * queued and never thrown away (UF-RULE-NOQUEUE). */
    consequence.appendChild(refusalCard(r, api, nav, state, p));
  }

  /* Work Stream — WIDE. Genuinely empty: this project has no Works, and none can be started
   * until WBS-10. No heading and no actor badge: `18` has no key for this region, and `15` §0
   * scopes the actor badge to a Work / QC CARD, of which there is none. The empty sentence is
   * the whole card, and it is true. (`18` files that string under SC-03 — see CANON_FINDINGS
   * CF-2; SC-03 is one Work and cannot have a "nothing requested yet" state.) */
  const stream = card('wide', 'stream');
  stream.appendChild(el('div', 'sm mut', C.work.empty));
  colL.appendChild(stream);

  /* History — M (cols 5–6). WBS-20: every Work this project started, newest first. `12`
   * F-C2-04 — it never disappears, and a failed or cancelled Work stays in it. */
  const hist = card('m', 'history');
  hist.appendChild(head(C.history.title));
  const rows = el('div', 'histrows');
  hist.appendChild(rows);
  hist.appendChild(el('div', 'xs mut2 foot', C.history.note));
  colR.appendChild(hist);

  /* The list is filled from the store, which is a read the screen does not have synchronously.
   * Until it answers, the card shows nothing rather than a wrong empty state — `아직 끝난
   * 작업이 없어요` is a CLAIM about this project, and it is not made before it is known. */
  fillHistory(rows, api, nav, state);

  shell.appendChild(board);
  root.appendChild(shell);

  return { shell, board, field };
}

/**
 * WBS-20 · the History list and the one orientation sentence above it.
 *
 * Each row is name · outcome chip · 변경 n개 · time, and it leads to the two places `15` names:
 * the Work's result (SC-03) and its changes (SC-04). Nothing here is derived from a clock —
 * every field is a column the store already holds.
 */
async function fillHistory(rows, api, nav, state) {
  const r = await api.history(state.project.id);
  rows.innerHTML = '';
  if (!r?.ok) return;

  /* `18` orient.* — where the user is, in one sentence. `확인 불가` is reserved for a Work whose
   * process could not be found; it is never a stand-in for "we have not looked". */
  rows.appendChild(el('p', 'sm mut hist-orient', C.orient[r.orientation] ?? C.orient.idle));
  rows.previousSibling?.setAttribute?.('data-orient', r.orientation);

  if (!r.works.length) {
    rows.appendChild(el('div', 'sm mut', C.history.empty));
    return;
  }

  for (const w of r.works) {
    const row = el('div', 'histrow');
    row.setAttribute('data-el', 'history-row');

    const top = el('div', 'histtop');
    top.appendChild(el('span', 'sm histname', w.intent));
    const o = HIST_OUTCOME[w.outcome];
    if (w.status !== 'ended') {
      top.appendChild(el('span', 'chip wait', C.gap.historyRunning));
    } else if (o) {
      top.appendChild(el('span', `chip ${o.cls}`, C.work.resultTitle[o.key] ?? C.work.unknownTitle));
    }
    row.appendChild(top);

    const facts = el('div', 'xs mut histfacts');
    /* 변경 n개 only when the evidence pair actually answered. `null` means it could not tell,
     * and a zero printed in its place would be a measurement nobody made. */
    if (w.changes != null) facts.appendChild(el('span', '', C.gap.historyChanged(w.changes)));
    facts.appendChild(el('span', '', when(w.endedAt ?? w.startedAt)));
    row.appendChild(facts);

    const acts = el('div', 'row-acts');
    acts.appendChild(btn('btn sm ghost', C.history.result, async () => {
      const got = await api.workGet(w.id);
      if (got?.ok) nav.toWork(got.work);
    }));
    /* `15` SC-02: History row → SC-03 (result) or `변경 보기` → SC-04. The change reader is
     * reachable from History and not only from a Work that just ended. */
    acts.appendChild(btn('btn sm ghost', C.history.changes, async () => {
      const got = await api.workGet(w.id);
      if (got?.ok) nav.toReader(got.work);
    }));
    row.appendChild(acts);

    rows.appendChild(row);
  }
}

/* The schema's outcome codes → the class that paints them and `18`'s own title key. Same table
 * as SC-03's; `cancelled_nochange` is NEUTRAL, not grey-unavailable — the user stopped it, which
 * is a different statement from 지금 안 됨. */
const HIST_OUTCOME = {
  complete:           { cls: 'ok',   key: 'complete' },
  partial:            { cls: 'part', key: 'partial' },
  failed:             { cls: 'fail', key: 'failed' },
  cancelled_partial:  { cls: 'part', key: 'cancelled_partial' },
  cancelled_nochange: { cls: '',     key: 'cancelled_none' },
  ended_unknown:      { cls: 'unk',  key: null },
};

const line = (t) => el('div', 'sm routeline', t);

/* D-134: a technical execution request is not run and is not an error. Neutral, never red.
 *
 * The drawer this would open is WBS-25. Until it exists the card says so in a sentence rather
 * than offering a disabled `터미널 열기` — `12` 원칙 4 asks every node for a next action, and a
 * control that cannot act is a dead end with extra steps, not an action. */
function terminalCard() {
  const n = el('div', 'panel grey');
  n.setAttribute('data-el', 'to-terminal');
  n.appendChild(el('div', 'sm t', C.intent.routeQc));
  n.appendChild(el('div', 'xs mut', C.intent.toTermHint));
  n.appendChild(el('div', 'xs mut2', C.gap.notBuiltTerminal));
  return n;
}

/* Two readings, both shown. JuQode picks neither (q02 §3). */
function ambiguousCard(routed, toWork) {
  const n = el('div', 'panel wait');
  n.setAttribute('data-el', 'ambiguous');
  n.appendChild(el('div', 'sm t', C.intent.ambiguousTitle));
  n.appendChild(el('div', 'xs mut', C.intent.ambiguousBody));
  const acts = el('div', 'row-acts');
  let offeredWork = false;
  for (const opt of routed.options ?? []) {
    if (opt === 'work') { acts.appendChild(btn('btn sm', C.intent.toWork, toWork)); offeredWork = true; }
  }
  /* Both readings are named in words even where only one is choosable yet — the copy promises
   * "어느 쪽인지 골라 주세요. JuQode가 대신 정하지 않아요", and a disabled control on one side
   * would mean JuQode had in fact chosen. */
  const other = (routed.options ?? []).filter((o) => o !== 'work');
  if (other.length) n.appendChild(el('div', 'xs mut2', `${C.intent.toTermHint} ${C.gap.notBuiltTerminal}`));
  if (!offeredWork) acts.appendChild(btn('btn sm', C.intent.toWork, toWork));
  n.appendChild(acts);
  return n;
}

/**
 * Every way a Work can fail to start, each with the reason and the way out `15` names.
 * The submitted text stays in the field throughout — it is never queued (UF-RULE-NOQUEUE).
 */
function refusalCard(r, api, nav, state, project) {
  const reason = r?.reason;

  if (reason === 'active-work') {
    const n = el('div', 'panel wait');
    n.setAttribute('data-el', 'guard');
    n.appendChild(el('div', 'sm t', C.guard.title));
    n.appendChild(el('div', 'xs mut', C.guard.body));
    const acts = el('div', 'row-acts');
    acts.appendChild(btn('btn sm', C.guard.open, async () => {
      const got = await api.workGet(r.detail.id);
      if (got?.ok) nav.toWork(got.work);
    }));
    acts.appendChild(btn('btn sm cancel', C.guard.cancel, () => api.workCancel(r.detail.id)));
    n.appendChild(acts);
    /* `기다리기` is not a control — waiting is what happens when nothing is pressed, and the
     * text is already kept in the field. A button that does nothing is not an action. */
    n.appendChild(el('div', 'xs mut2', C.guard.rule));
    return n;
  }

  if (reason === 'claude-unavailable') {
    /* 사용 불가 ≠ 실패 (12 §16): neutral grey, the 지금 안 됨 chip, and the reason. */
    const n = el('div', 'panel grey');
    n.setAttribute('data-el', 'unavailable');
    const h = el('div', 'chead');
    h.appendChild(el('span', 'sm t', C.unavailable.title));
    h.appendChild(el('span', 'grow'));
    h.appendChild(el('span', 'chip unavail', C.unavailable.chip));
    n.appendChild(h);
    n.appendChild(el('div', 'sm', CLAUDE_REASON[r.detail?.reason] ?? C.gap.claudeUnknown));
    n.appendChild(el('div', 'xs mut', C.unavailable.body));
    /* `15` fixes four recovery paths here; three of them belong to WBS-04, 22 and 25. The one
     * that is real needs no button — the text is still in the field, so 다시 보내기 IS the
     * submit button that is already on screen. Naming a button that does nothing would be
     * worse than naming the fact. */
    n.appendChild(el('div', 'xs mut2', C.gap.notBuiltPaths));
    return n;
  }

  if (reason === 'evidence-blocked') {
    /* The one red on this path: `15` says the Work does NOT start, and says why (D-121). */
    const n = el('div', 'panel failband');
    n.setAttribute('data-el', 'evidence-blocked');
    n.appendChild(el('div', 'sm t', C.evidence.title));
    n.appendChild(el('div', 'xs', C.evidence.body));
    /* The machine reason is technical output and goes behind the disclosure, not into the
     * card's sentences (`18` §0.7). */
    const d = el('details');
    d.appendChild(el('summary', 'xs mut', C.sc01.tech));
    d.appendChild(el('div', 'xs mono mut', String(r.detail?.reason ?? '')));
    n.appendChild(d);
    n.appendChild(el('div', 'xs mut2', C.gap.notBuiltPaths));
    return n;
  }

  if (reason === 'start-failed') {
    const n = el('div', 'panel failband');
    n.setAttribute('data-el', 'start-failed');
    n.appendChild(el('div', 'sm t', C.startFail.title));
    n.appendChild(el('div', 'xs', C.startFail.body));
    if (r.detail?.stderr) {
      const d = el('details');
      d.appendChild(el('summary', 'xs mut', C.startFail.raw));
      d.appendChild(el('div', 'xs mono mut', r.detail.stderr));
      n.appendChild(d);
    }
    return n;
  }

  const n = el('div', 'panel grey');
  n.setAttribute('data-el', 'refused');
  n.appendChild(el('div', 'sm', C.gap.workRefused));
  n.appendChild(el('div', 'xs mono mut', String(reason ?? '')));
  return n;
}

const CLAUDE_REASON = {
  'not-installed': C.gap.claudeMissing,
  'no-response':   C.gap.claudeNoResp,
  'logged-out':    C.unavailable.reason,
};
function card(size, name) {
  const n = el('div', `card c-${size}`);
  n.setAttribute('data-card', name);
  return n;
}

function head(title, right) {
  const h = el('div', 'chead');
  h.appendChild(el('span', 'ct', title));
  h.appendChild(el('span', 'grow'));
  if (right) h.appendChild(right);
  return h;
}

