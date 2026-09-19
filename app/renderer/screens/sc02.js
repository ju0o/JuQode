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
import { presenceBody, setPresenceMode, modeFor } from '../presence.js';
import { stateChip } from './sc03.js';

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
  /* `15` §0 · TD-01: the terminal toggle is on every screen's top bar. The drawer itself lives
   * outside `#root`, so this only flips a flag the router owns. */
  bar.appendChild(btn('btn sm ghost nodrag', C.term.title, () => window.__toggleDrawer?.()));
  mountThemeToggle(bar, C.theme);
  shell.appendChild(bar);

  const board = el('main', 'sc02 board fade-in');
  /* D-138 · TWO STACKS, and they are no longer peers: a MAIN column that holds the subject of
   * whatever state the screen is in, and a narrower RAIL that holds supporting context.
   *
   * Before the amendment both columns were `1fr` and the Brief opened in the left one, so the
   * biggest object on the screen was the project description — MEASURED: `compSC02.largest`
   * was `brief` and board density was 0.765 (`tmp-visual/results.json`, batch 35). A
   * non-developer's first scan landed on a card that answers a question they did not ask.
   *
   * A stack still cannot overlap, which is why this is two flex columns and not a row grid —
   * see the measured failure recorded below. */
  const colMain = el('div', 'sc02-col sc02-main');
  const colRail = el('div', 'sc02-col sc02-rail');
  board.appendChild(colMain);
  board.appendChild(colRail);
  board.setAttribute('data-screen', 'SC-02');

  /* ① Brief — D-138 §4: supporting project context, NOT the user's permanent primary task.
   *
   * While the project is still being READ it is the subject and sits in the main column — the
   * user is waiting on it and there is nothing else to look at. The moment the interpretation
   * exists it moves to the rail, where a returning open finds it already folded (D-132) and a
   * first open finds it open but out of the primary scan path. The capability is untouched
   * (`11` F-C1-02); only its claim on attention is. */
  const brief = card('wide2', 'brief');
  const placeBrief = () => {
    const wanted = state.interpretation ? colRail : colMain;
    /* Only ever a MOVE, and only when the column is actually wrong — re-appending a node that
     * is already in place would restart the card's fade for no reason. */
    if (brief.parentNode !== wanted) wanted.insertBefore(brief, wanted.firstChild);
  };
  placeBrief();

  /* WBS-05 · the Brief's own controls. Re-rendering IS the interaction — the same pattern the
   * other screens use — so every one of these hands state back and redraws. */
  const paint = () => { placeBrief(); renderBrief(brief, state.interpretation, {
    /* WBS-02b · the folder had nothing in it when it was opened, and nothing has been asked for
     * yet. `projectEmpty` is cleared the moment a Work opens (see `nav.toWork`), so this is not
     * a second look at the disk taken at a different time — it is the one measurement the open
     * already made, held until it stops being the situation. */
    empty: state.projectEmpty,
    onStart: () => {
      /* The sentence goes into the field and is NOT sent. `12` treats 보내기 as consent to
       * change files, so the person presses it — with their own words in place of the stub. */
      if (!field) return;
      field.value = C.gap.briefEmptyIntent;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    },
    stale: state.stale,
    folded: state.briefFolded,
    refreshFailed: state.refreshFailed,
    onFold: () => { state.briefFolded = !state.briefFolded; paint(); },
    /* 이대로 계속 dismisses the ANNOUNCEMENT. Clearing the verdict is what brings 다시 읽기 back
     * to the header, so the user is never left on SC-02 with no way to re-read. */
    onKeepStale: () => { state.stale = null; paint(); },
    rereading: state.rereading,
    onReread: () => {
      /* `19` §C1 ⑤ · D-132: the ONLY thing that starts a re-read. It is not automatic, and the
       * old Brief stays on screen while the new one is being taken (`15` 갱신 중, F-C1-03). */
      if (state.rereading) return;                 // pressing it again starts nothing
      state.refreshFailed = null;
      state.rereading = true;
      paint();
      api.interpret(p.id).then((r) => {
        state.rereading = false;
        if (r?.ok) {
          state.interpretation = r.interpretation;
          state.narrative = r.narrative ?? null;
          state.refreshFailed = r.refreshFailed ?? null;
          /* A re-read that SUCCEEDED is not stale by definition. One that FAILED did not read
           * anything, so the hash it was stale against has not moved and the verdict still
           * stands — dropping it there stopped the product saying what it still knew. */
          if (!state.refreshFailed) state.stale = null;
          state.briefFolded = false;
        }
        paint();
      });
    },
  });
  };
  /* Every redraw re-places the card, so the interpretation ARRIVING is also when the Brief
   * stops being the subject — the move and the content change land in the same frame instead
   * of as two separate jumps. */
  paint();

  if (state.interpretation) {
    /* WBS-05 · has it AGED? A read-only check — it re-runs the deterministic scan and compares
     * `source_hash`, and asks no model. `19` §C1 ⑤: announced, never acted on. */
    api.brief(p.id).then((r) => {
      if (!r?.ok || !r.stale?.changed) return;
      state.stale = r.stale;
      paint();
    });
  }

  if (!state.interpretation) {
    api.interpret(p.id).then((r) => {
      /* `r.ok === false` means the REQUEST failed (no store, unknown project, a handler that
       * threw). That is not "we could not read the folder", and painting it as one would put
       * a cause on screen that did not happen. The scan's own errno rides on `failedCode`. */
      state.interpretation = r?.ok
        ? r.interpretation
        : { status: 'failed', failedCode: null, answers: [], readFiles: [] };
      /* D-138 §4 · the Brief is visibly presented WHILE the project is being understood, and
       * collapses into a compact secondary affordance once it HAS been. This is that moment.
       *
       * MEASURED before this line existed: with the Brief left open on a first read it was
       * still the largest object on SC-02 (`compSC02.largest === 'brief'`, density 0.676) even
       * after it had been moved to the rail — a non-developer's first scan kept landing on the
       * project description. Nothing is lost: the header keeps `펼치기` and D-132 already folds
       * it on every later open. A FAILED read is left open — its band is the whole message,
       * and folding it would hide the reason. A re-read the user ASKED for re-opens itself
       * (see `onReread`), because they asked to see the result. */
      if (r?.ok) state.briefFolded = true;
      /* WBS-04's own report — how many answers the narrative pass filled, and why it did not.
       * It is not drawn: the Brief shows the ANSWERS and their chips, which is what the reader
       * needs. This is for the run log and the e2e, the way `__work` carries counts. */
      state.narrative = r?.narrative ?? null;
      paint();
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
  /* WBS-19 · a correction arrives with the request already written. It is NOT sent — `12` treats
   * 보내기 as consent to change files, so the sentence sits here for the user to send, edit, or
   * delete. Consumed once, so a later return to the workbench is not haunted by it. */
  if (state.prefill) { field.value = state.prefill; state.prefill = null; }
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
  colMain.appendChild(intent);

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
      if (route === 'terminal') { consequence.appendChild(terminalCard(text, () => startWork(text))); return; }
      if (route === 'ambiguous') {
        consequence.appendChild(ambiguousCard({ ...routed.route, phrase: text }, () => startWork(text)));
        return;
      }
      if (route === 'unrecognized') { consequence.appendChild(passthroughCard(text, () => startWork(text), () => { consequence.innerHTML = ''; field.focus(); })); return; }
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
    consequence.appendChild(refusalCard(r, api, nav, state, p, { phrase: text, resubmit: () => startWork(text) }));
  }

  /* ② Work Stream — D-138 §3 · §5, and `15` SC-02 ③.
   *
   * This region is the screen's subject WHILE A WORK IS RUNNING: the first thing in the primary
   * column, answering "무엇이 지금 일어나고 있나". Before the amendment SC-02 had no current-Work
   * surface at all — the card below unconditionally said `아직 요청한 작업이 없어요` even with a
   * Work running, which is a sentence the product had no evidence for. The running Work was
   * visible only as a `진행 중` chip on a History row.
   *
   * Agent Presence is INSIDE this card rather than beside it (D-138 §5). Same canvas, same nine
   * modes, same correction path — and `presence.hint` is still said out loud here, because the
   * sentence belongs to the presence and not to the card that used to frame it.
   *
   * `18` `work.now` names the region; Human Gate ② (2026-09-11) settled that the label is this
   * key's copy and not `15`'s table shorthand `지금`. */
  const stream = card('wide2', 'stream');
  stream.appendChild(head(C.work.now));
  const streamBody = el('div', 'streambody');
  streamBody.setAttribute('data-el', 'stream-body');
  stream.appendChild(streamBody);
  stream.appendChild(presenceBody('idle'));
  stream.appendChild(el('div', 'xs mut2 foot', C.presence.hint));
  colMain.appendChild(stream);
  fillStream(streamBody, stream, api, nav, state);

  /* History — the rail. WBS-20: every Work this project started, newest first. `12`
   * F-C2-04 — it never disappears, and a failed or cancelled Work stays in it.
   * D-138 §5: findable, compact until the user expands it, never competing with the subject. */
  const hist = card('m', 'history');
  hist.appendChild(head(C.history.title));
  const rows = el('div', 'histrows');
  hist.appendChild(rows);
  hist.appendChild(el('div', 'xs mut2 foot', C.history.note));
  colRail.appendChild(hist);

  /* The list is filled from the store, which is a read the screen does not have synchronously.
   * Until it answers, the card shows nothing rather than a wrong empty state — `아직 끝난
   * 작업이 없어요` is a CLAIM about this project, and it is not made before it is known. */
  fillHistory(rows, api, nav, state);

  shell.appendChild(board);
  root.appendChild(shell);

  return { shell, board, field };
}

/**
 * WBS-35 · SC-02's presence mode.
 *
 * The one live Work, asked for by id. A History row carries `status` and `outcome` and nothing
 * about liveness, permissions or a pending question — so a mode derived from the row would be
 * claiming `활동` for a Work that is actually waiting for the user to answer. The snapshot is
 * the only thing that knows, so the row is used for nothing but the id.
 */
/**
 * Is the answer still ABOUT the screen that asked for it?
 *
 * `fillStream` awaits twice, and in that time the user can leave — for another project, or
 * off SC-02 entirely. Writing the presence then paints a mode for something they are no
 * longer looking at, and `19` is about the product only saying what it observed OF WHAT IS
 * ON SCREEN.
 *
 * A pure function, because the state that makes it false — a slow store answering after a
 * navigation — cannot be produced from the e2e without stubbing the bridge, and a rule that
 * cannot be reached from the outside is pinned from the inside instead (the `hasEvidenceGap`
 * pattern). BOTH halves are the rule: neither a different screen nor a different project may
 * be written to, and either alone is not enough. `tests/presence.test.js` fixes all four.
 */
export function presenceIsStill(state, project) {
  return state.screen === 'SC-02' && state.project === project;
}

/**
 * D-138 · the Work Stream's content, and the presence mode, from ONE read.
 *
 * `15` SC-02 ③ / Running State (compact): name · state · last observed fact · ✓ ● ○ counts ·
 * `열기`. Every field is a column the store already holds or a fact the snapshot observed —
 * nothing here is derived from a clock and nothing is a progress reading.
 *
 * The card MOVES to the top of the primary column when a Work is live, and stays under the
 * request field when there is none. That is D-138 §7: the same screen composes differently by
 * state instead of changing only its text. It is done here rather than at build time because
 * whether a Work is running is not known synchronously — and an idle screen therefore never
 * moves at all.
 */
async function fillStream(body, stream, api, nav, state) {
  const project = state.project;
  const r = await api.history(project.id);
  /* The answer describes the project this started for. If the user has moved on, it is about
   * something they are no longer looking at. */
  if (!presenceIsStill(state, project)) return;

  /* A read that FAILED says nothing about whether there is a Work. `idle` is `대기 중` — a
   * claim that nothing is happening — and the store refusing to answer is not evidence for it. */
  if (!r?.ok) { setPresenceMode('unknown'); return; }

  const live = r.works.find((w) => w.status !== 'ended');
  if (!live) {
    /* TRUE, and now only said when it is: this project has no Work that has not ended. */
    body.appendChild(el('div', 'sm mut', C.work.empty));
    setPresenceMode('idle');
    return;
  }

  /* A History row carries `status` and `outcome` and nothing about liveness, permissions or a
   * pending question — so a mode derived from the row would be claiming `활동` for a Work that
   * is actually waiting for the user to answer. The snapshot is the only thing that knows, so
   * the row is used for nothing but the id. */
  const snap = (await api.workGet(live.id))?.work;
  if (!presenceIsStill(state, project)) return;
  if (!snap) {
    /* A live Work whose snapshot could not be fetched is NOT 대기 중. `idle` says nothing is
     * happening, and something is — we just cannot see what. */
    body.appendChild(el('div', 'sm mut', C.orient.unknown));
    setPresenceMode('unknown');
    return;
  }
  setPresenceMode(modeFor(snap));

  /* D-138 §3: with a Work running, this is what the first scan must land on. */
  stream.parentNode?.insertBefore(stream, stream.parentNode.firstChild);
  stream.setAttribute('data-live', 'work');

  const top = el('div', 'streamtop');
  top.appendChild(el('span', 'sm histname', snap.work.intent));
  top.appendChild(stateChip(snap));
  body.appendChild(top);

  /* The last observed fact — the same two branches as SC-03's liveness line, in the same words
   * (`18` `work.observed` + `work.sessionStart` before any signal, `work.lastSeen` + what was
   * seen after one). A compact card may not invent a third way of saying it. */
  const seen = snap.lastObserved;
  const live_ = el('div', 'xs mut streamlive');
  if (seen) {
    live_.appendChild(el('span', 'mut2', C.work.lastSeen));
    live_.appendChild(el('span', '', C.gap.signal[seen.kind] ?? C.gap.signal.raw));
    if (seen.at) live_.appendChild(el('span', 'mono', when(seen.at)));
  } else {
    live_.appendChild(el('span', 'mut2', C.work.observed));
    live_.appendChild(el('span', '', C.work.sessionStart));
    if (snap.work.started_at) live_.appendChild(el('span', 'mono', when(snap.work.started_at)));
  }
  body.appendChild(live_);

  /* `15`'s `✓2 ●1 ○1`. Counts of DECLARED steps only (D-107) — a zero here means Claude Code
   * declared none of that kind, not that none happened, which is why the legend that names the
   * three marks travels with them. The row is omitted entirely when nothing has been declared:
   * `✓0 ●0 ○0` is three zeros pretending to be a measurement. */
  const counts = { done: 0, running: 0, declared_next: 0 };
  for (const st of snap.steps ?? []) if (st.state in counts) counts[st.state] += 1;
  if (counts.done || counts.running || counts.declared_next) {
    const row = el('div', 'xs mut2 streamcounts');
    row.appendChild(el('span', '', `✓ ${counts.done}`));
    row.appendChild(el('span', '', `● ${counts.running}`));
    row.appendChild(el('span', '', `○ ${counts.declared_next}`));
    row.appendChild(el('span', '', C.work.legend));
    body.appendChild(row);
  }

  /* `18` `work.open` · `15` SC-02 ③ — the way into the Work. Human Gate ② (2026-09-11): this
   * key was never a duplicate of `guard.open`, it was a button no screen had built. */
  const acts = el('div', 'row-acts');
  acts.appendChild(btn('btn sm', C.work.open, () => nav.toWork(snap)));
  body.appendChild(acts);
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

  /* `15` §0 Board: History is M and grows to L when expanded — so it does not show everything
   * at once. `18` gives both controls (`history.more` · `history.collapse`), and the count in
   * `더 보기` is the REAL number of rows still hidden, not a page size. */
  const HEAD = 3;
  const expanded = state.historyExpanded === true;
  const shown = expanded ? r.works : r.works.slice(0, HEAD);
  for (const w of shown) {
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

  /* The control only exists when there is something behind it. A `더 보기` over a complete list
   * is a control that does nothing, and `15` DS §1 does not count that as an action. */
  const hidden = r.works.length - shown.length;
  if (hidden > 0 || expanded) {
    const more = el('div', 'row-acts');
    more.appendChild(btn('btn sm ghost', expanded ? C.history.collapse : `${hidden}${C.history.more}`,
      () => { state.historyExpanded = !expanded; fillHistory(rows, api, nav, state); }));
    rows.appendChild(more);
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
 * `15` SC-02 · D-134: the card says the terminal is where that lives AND opens the drawer with
 * the user's own sentence already in the Quick Command field. It used to end on a line saying
 * the terminal did not exist yet — true when it was written, and false from the moment TD-01
 * shipped, with the 터미널 button visible in the same top bar. */
function terminalCard(phrase, toWork) {
  const n = el('div', 'panel grey');
  n.setAttribute('data-el', 'to-terminal');
  n.appendChild(el('div', 'sm t', C.intent.routeQc));
  n.appendChild(el('div', 'xs mut', C.intent.toTermHint));
  const acts = el('div', 'row-acts');
  acts.appendChild(btn('btn sm', C.intent.openTerm, () => window.__openDrawerWith?.(phrase)));
  acts.appendChild(btn('btn sm ghost', C.intent.toWork, toWork));
  n.appendChild(acts);
  return n;
}

/* Two readings, both shown. JuQode picks neither (q02 §3). */
function ambiguousCard(routed, toWork) {
  const n = el('div', 'panel wait');
  n.setAttribute('data-el', 'ambiguous');
  n.appendChild(el('div', 'sm t', C.intent.ambiguousTitle));
  n.appendChild(el('div', 'xs mut', C.intent.ambiguousBody));
  const acts = el('div', 'row-acts');
  const options = routed.options ?? [];

  /* Every reading gets a control — the copy promises "어느 쪽인지 골라 주세요. JuQode가 대신
   * 정하지 않아요", and a named reading with no control behind it would mean JuQode had in
   * fact chosen. There are exactly two destinations, so there are exactly two controls.
   *
   * ONE terminal control, however many Quick Command rules matched. `실행해줘` routes to
   * `['qc.dev.start','qc.build','qc.test','work']` (`19` §C4 — a verb with no object), and a
   * button per option drew 터미널 열기 THREE times, all opening the same drawer with the same
   * phrase. That is not three readings named; it is one control drawn three times, while the
   * card's own sentence says the user is choosing between readings. Found by mutation: five
   * flips across the two loops this replaces all survived, because no test had ever rendered
   * this card at all.
   *
   * Work is always offered: the router omits it when two full rules match (`19` §C4 line 122),
   * and a card with no way out to a Work would leave the user with only the reading JuQode
   * happened to match. */
  acts.appendChild(btn('btn sm', C.intent.toWork, toWork));
  if (options.some((o) => o === 'terminal' || String(o).startsWith('qc'))) {
    acts.appendChild(btn('btn sm', C.intent.openTerm, () => window.__openDrawerWith?.(routed.phrase ?? '')));
  }
  /* `15` UF-INTENT-REPHRASE: the third way out is to say it differently. The text is already in
   * the field (nothing is ever queued or thrown away), so this dismisses the card and puts the
   * cursor back where the user can edit — `18` `intent.rephrase`. */
  acts.appendChild(btn('btn sm ghost rec', C.intent.rephrase, () => {
    n.remove();
    const f = document.querySelector('[data-el="intent"]');
    if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }));
  n.appendChild(acts);
  return n;
}

/* Unrecognized phrase — offer to send it straight to Claude Code instead of silent rejection.
 * `toWork` and `toRephrase` are caller-supplied so the card does not need to reach for the DOM. */
function passthroughCard(phrase, toWork, toRephrase) {
  const n = el('div', 'panel grey');
  n.setAttribute('data-el', 'passthrough');
  n.appendChild(el('div', 'sm t', C.intent.passthroughTitle));
  n.appendChild(el('div', 'xs mut', C.intent.passthroughBody));
  const acts = el('div', 'row-acts');
  acts.appendChild(btn('btn sm', C.intent.toWork, toWork));
  acts.appendChild(btn('btn sm ghost', C.intent.rephrase, toRephrase));
  n.appendChild(acts);
  return n;
}

/**
 * Every way a Work can fail to start, each with the reason and the way out `15` names.
 * The submitted text stays in the field throughout — it is never queued (UF-RULE-NOQUEUE).
 */
/**
 * `15`'s recovery buttons for the two cards that have them — the evidence refusal and the
 * Claude-unavailable card. Both lists are `18`'s, in `18`'s order, and every entry is a real
 * control that goes somewhere that exists.
 *
 * The three destinations are genuinely different, which is why three buttons rather than one:
 *   · 프로젝트 설명 읽기 — unfolds the Brief, which is on this same screen (WBS-05)
 *   · Quick Command 쓰기 — opens the drawer CARRYING the sentence the user already typed
 *     (D-134 · `__openDrawerWith`), so they do not retype it
 *   · 터미널로 직접 확인 — opens the drawer plain
 *
 * `16` §2.1: green ▸ is recovery, and every one of these IS a recovery action — a way out of a
 * state the user did not choose. Not navigation, which never gets the green.
 */
function recoveryPaths(labels, phrase, state, nav, project) {
  const row = el('div', 'row-acts');
  const go = [
    () => { state.briefFolded = false; nav.toWorkbench(project, state.interpretation); },
    () => window.__openDrawerWith?.(phrase ?? ''),
    () => window.__toggleDrawer?.(),
  ];
  labels.forEach((label, i) => {
    const act = go[i];
    /* A label with no destination is not rendered at all. `15` DS §1: a control that does
     * nothing is not an action, and this list is exactly where that used to be tolerated. */
    if (act) row.appendChild(btn('btn sm ghost rec', label, act));
  });
  return row;
}

function refusalCard(r, api, nav, state, project, { phrase = '', resubmit = null } = {}) {
  const reason = r?.reason;

  if (reason === 'active-work') {
    const n = el('div', 'panel wait');
    n.setAttribute('data-el', 'guard');
    n.appendChild(el('div', 'sm t', C.guard.title));
    n.appendChild(el('div', 'xs mut', C.guard.body));
    /* `15` SC-02 Guard State names FOUR actions IN THIS ORDER, and Human Gate ② (2026-09-11)
     * confirmed all four against the approved prototype's own guard card:
     *   열기 (UF-GUARD-VIEW) · 답하기 (UF-GUARD-ANSWER) · 이 작업 취소 (UF-GUARD-CANCEL) ·
     *   기다리기 (UF-GUARD-WAIT).
     * Terminal is deliberately NOT among them (M-06). */
    const open = async () => {
      const got = await api.workGet(r.detail.id);
      if (got?.ok) nav.toWork(got.work);
    };
    const acts = el('div', 'row-acts');
    acts.appendChild(btn('btn sm', C.guard.open, open));

    /* `답하기` is rendered ONLY while the active Work is 입력 대기 — `15` says so, and the
     * prototype gates it the same way. It goes to the same place as 열기 because that is where
     * the answer field is: SC-03 owns the input panel, and a second field here would be a
     * second way to answer the same question. The row status cannot tell — 입력 대기 is a
     * SNAPSHOT state, not a column — so the button is added when the snapshot says so and
     * never appears otherwise. */
    api.workGet(r.detail.id).then((got) => {
      if (got?.ok && got.work?.status === 'input_waiting') {
        acts.insertBefore(btn('btn sm', C.guard.answer, open), acts.children[1] ?? null);
      }
    });

    acts.appendChild(btn('btn sm cancel', C.guard.cancel, () => api.workCancel(r.detail.id)));

    /* `기다리기` (UF-GUARD-WAIT) DISMISSES THIS NOTICE and starts nothing. An earlier revision
     * left it out, reasoning that waiting is what happens when nothing is pressed — but `15`
     * lists it as a guard action and the approved prototype's own handler is `S.guard=false`,
     * i.e. close the card. The two are not the same thing: with no way to dismiss it, the
     * notice sits over the request the user is still holding. The text stays in the field
     * either way (UF-RULE-NOQUEUE) — that is what makes closing it safe. */
    acts.appendChild(btn('btn sm ghost', C.guard.wait, () => n.remove()));
    n.appendChild(acts);
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
    /* `15` names FOUR recovery buttons here and means buttons — 네 개의 복구 버튼.
     *
     * They used to be a sentence saying they were not built, because WBS-04, 22 and 25 had not
     * shipped. All three have. A product that goes on saying a path does not exist after it
     * does is telling the user something false, which is the one thing this product is for. */
    n.appendChild(recoveryPaths(C.unavailable.paths, phrase, state, nav, project));
    if (resubmit) {
      /* The fourth. The text is still in the field, so this is genuinely the same action as
       * pressing 보내기 — but `15` asks for it here, next to the reason, and a user who has
       * just read 로그인이 필요해요 should not have to find their way back up the card. */
      const row = el('div', 'row-acts');
      row.appendChild(btn('btn sm ghost rec', C.unavailable.resubmit, resubmit));
      n.appendChild(row);
    }
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
    /* `15`: 세 개의 복구 버튼. `18` `evidence.remain` labels them — 지금 할 수 있는 것. */
    n.appendChild(el('div', 'xs mut2', C.evidence.remain));
    n.appendChild(recoveryPaths(C.evidence.paths, phrase, state, nav, project));
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
    /* …and a way forward. `15` gives every refusal a recovery path and `18` has carried
     * `startFail.resubmit` all along — the card rendered a title, a reason and a disclosure and
     * then stopped, leaving the user with nothing to press. Nothing started, so re-sending is
     * the whole recovery: `19` §C4's 시작되지 않은 작업은 기록에 남지 않는다 means there is no
     * state to undo first. */
    if (resubmit) {
      const row = el('div', 'row-acts');
      row.appendChild(btn('btn sm ghost rec', C.startFail.resubmit, resubmit));
      n.appendChild(row);
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

