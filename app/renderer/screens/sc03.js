/* SC-03 · Work (작업) — one Claude Code Work in full.
 *
 * Everything on this screen is something that was OBSERVED. `15` SC-03 and F-C3-05 forbid the
 * alternatives by name: no spinner, no pulse, no percent, no ETA, no `관측 중` indicator. The
 * liveness line's timestamp is the only statement that the Work is alive, and it says what was
 * last seen rather than what is presumably happening.
 *
 * The permission panel is contract B and only contract B (D-133). The tool is ALREADY denied
 * when the card appears, so nothing here calls it 대기 중 — `15` is explicit about that, and
 * `18` marks contract A's copy as not to be used.
 */
import { C } from '../copy.js';
import { el, btn } from '../dom.js';
import { mountThemeToggle } from '../design/theme.js';
import { presenceCard, modeFor } from '../presence.js';
import { nextActions } from '../nextaction.js';

/* The schema's outcome codes → the class that paints them and `18`'s own title key.
 * `cancelled_nochange` is a NEUTRAL chip (`15`): the 사용 불가 grey means "지금 안 됨 · 실패
 * 아님" (12 §16), which is a different statement from "the user stopped it". */
const OUTCOME = {
  complete:           { cls: 'ok',   key: 'complete' },
  partial:            { cls: 'part', key: 'partial' },
  failed:             { cls: 'fail', key: 'failed' },
  cancelled_partial:  { cls: 'part', key: 'cancelled_partial' },
  cancelled_nochange: { cls: '',     key: 'cancelled_none' },
  ended_unknown:      { cls: 'unk',  key: null },
};
const outcomeTitle = (outcome) => C.work.resultTitle[OUTCOME[outcome]?.key] ?? C.work.unknownTitle;

export function renderSC03(root, api, nav, state) {
  root.innerHTML = '';
  const snap = state.workSnapshot;
  const p = state.project;

  const shell = el('div', 'shell');
  const bar = el('div', 'topbar');
  bar.appendChild(el('span', 'brand', C.app.name));
  const id = el('span', 'projid');
  id.appendChild(el('span', 'nm', p.name));
  id.appendChild(el('span', 'xs mut path', p.path));
  id.title = p.path;
  bar.appendChild(id);
  bar.appendChild(el('span', 'grow'));
  bar.appendChild(btn('btn sm ghost nodrag', C.work.toBench, () => nav.toWorkbench(p, state.interpretation)));
  /* `15` §0 · TD-01: the terminal toggle is on every screen's top bar. The drawer itself lives
   * outside `#root`, so this only flips a flag the router owns. */
  bar.appendChild(btn('btn sm ghost nodrag', C.term.title, () => window.__toggleDrawer?.()));
  mountThemeToggle(bar, C.theme);
  shell.appendChild(bar);

  const board = el('main', 'sc03 board fade-in');
  board.setAttribute('data-screen', 'SC-03');

  if (!snap) {
    board.appendChild(el('div', 'card c-wide', C.pending.label));
    shell.appendChild(board);
    root.appendChild(shell);
    return { shell, board };
  }

  board.appendChild(workCard(snap, api, nav, state));
  /* WBS-35 · `15` SC-03 board: Presence is S and sits beside the Work card. Its mode is a
   * pure function of the snapshot the screen is already drawing, so it can never disagree
   * with the chip and the panels above it. */
  board.appendChild(presenceCard(modeFor(snap)));
  board.appendChild(stepsCard(snap));
  board.appendChild(aboutCard(snap, api));
  if (snap.status === 'ended') board.appendChild(resultCard(snap, api, nav, state));

  shell.appendChild(board);
  root.appendChild(shell);
  return { shell, board };
}

/* ── the Work itself: what was asked, what is known, and the single cancel ── */
function workCard(snap, api, nav, state) {
  const card = el('div', 'card c-l');
  card.setAttribute('data-card', 'work');

  const head = el('div', 'chead');
  head.appendChild(el('span', 'actor', C.actor.claude));
  head.appendChild(el('span', 'grow'));
  head.appendChild(stateChip(snap));
  card.appendChild(head);

  card.appendChild(el('div', 'h1 wname', snap.work.intent));

  /* `15` SC-03 header: started / ended time. Wall-clock facts, not a relative count that
   * keeps moving on its own. */
  const times = el('div', 'times');
  times.appendChild(field(C.work.started, clock(snap.work.started_at)));
  if (snap.work.ended_at) times.appendChild(field(C.work.ended, clock(snap.work.ended_at)));
  card.appendChild(times);

  /* `15`: a persistent header FACT, not a timed toast. The evidence really was established —
   * a Work cannot exist without it, which is what makes the 확인됨 chip true. */
  const route = el('div', 'routeline');
  route.appendChild(el('span', 'sm', C.work.route));
  route.appendChild(el('span', 'chip ok', C.brief.chips.ok));
  card.appendChild(route);

  card.appendChild(liveness(snap));

  /* Only while the Work is actually waiting on the user. An ended Work kept a live
   * `허용하고 다시 해 보기` next to its own 취소했어요 result — pressing it edited files on a
   * Work the screen had already declared finished. */
  if (snap.permission && snap.status === 'permission_waiting') {
    card.appendChild(permissionPanel(snap, api, state));
  }
  if (snap.status === 'input_waiting') card.appendChild(inputPanel(snap, api));
  if (snap.status !== 'ended' && snap.liveness === 'quiet') card.appendChild(quietPanel(snap));
  if (snap.status !== 'ended' && snap.liveness === 'unknown') card.appendChild(unknownPanel(snap));
  if (snap.cancelUnconfirmed) card.appendChild(cancelUnconfirmedPanel(snap));

  /* The one cancel on the screen (`15` DS §1), ink-outlined, with its fixed sub-line. */
  if (snap.status !== 'ended') {
    const cancel = el('div', 'cancelrow');
    cancel.appendChild(btn('btn sm cancel', C.work.cancel, async () => {
      await api.workCancel(snap.work.id);
    }));
    cancel.appendChild(el('div', 'xs mut2', C.work.cancelSub));
    card.appendChild(cancel);
  }

  if (snap.status === 'cancel_requested') {
    const band = el('div', 'panel unk');
    band.appendChild(el('div', 'sm t', C.work.cancelReq));
    band.appendChild(el('div', 'xs mut', C.work.cancelReqBody));
    card.appendChild(band);
  }
  return card;
}

/* A chip is a LABEL. `18` writes the panel titles as sentences and gives them a UI context of
 * "카드 제목"; repeating one in the chip says the same thing twice on one surface (§0.8). */
function stateChip(snap) {
  if (snap.status === 'ended') {
    return el('span', `chip ${OUTCOME[snap.outcome]?.cls ?? 'unk'}`, outcomeTitle(snap.outcome));
  }
  if (snap.status === 'permission_waiting') return el('span', 'chip perm', C.gap.chipPermission);
  if (snap.status === 'input_waiting') return el('span', 'chip perm', C.gap.chipInput);
  if (snap.status === 'cancel_requested') return el('span', 'chip unk', C.work.cancelReq);
  return el('span', 'chip', C.gap.chipRunning);
}

/**
 * The liveness line. It states the LAST OBSERVED fact and when — never a judgement about what
 * is happening now. `18` §0.2 bans 생각 중 · 거의 다 · 곧, and `15` bans the spinner outright.
 */
function liveness(snap) {
  const row = el('div', 'liveness');
  row.setAttribute('data-el', 'liveness');
  const seen = snap.lastObserved;
  if (!seen) {
    row.appendChild(el('span', 'sm mut', C.work.noSteps));
    return row;
  }
  row.appendChild(el('span', 'xs mut2', C.work.lastSeen));
  /* In words, not the machine's name for the event (`18` §0.7). An event kind we have no word
   * for still shows — as 그 밖의 신호 — because hiding it would be hiding an observation. */
  row.appendChild(el('span', 'sm', C.gap.signal[seen.kind] ?? C.gap.signal.raw));
  if (seen.at) row.appendChild(el('span', 'xs mut mono', clock(seen.at)));
  return row;
}

/* ── contract B (D-133): the action was refused, and the user decides ── */
function permissionPanel(snap, api, state) {
  const d = snap.permission;
  const panel = el('div', 'panel wait');
  panel.setAttribute('data-el', 'permission');
  panel.appendChild(el('div', 'sm t', C.work.permTitleB));

  /* Verbatim: which tool, and on WHAT. A Bash denial used to show only "Bash" while pressing
   * 허용 granted `Bash(<the whole command>:*)` — the scope was narrow, but the card describing
   * what was being approved was not. Whatever the grant is built from is what is shown. */
  const target = d.input?.file_path ?? d.input?.path ?? d.input?.notebook_path
    ?? d.input?.command ?? d.input?.url ?? null;
  const what = el('div', 'xs mono mut');
  what.textContent = `${C.gap.workDenialTool}: ${d.tool ?? '—'}${target ? ` · ${target}` : ''}`;
  panel.appendChild(what);
  if (d.message) {
    const raw = el('details');
    raw.appendChild(el('summary', 'xs mut', C.work.rawQ));
    raw.appendChild(el('div', 'xs mono mut', d.message));
    panel.appendChild(raw);
  }

  panel.appendChild(el('div', 'sm', C.work.permGlossB));

  const acts = el('div', 'row-acts');
  /* Decided BEFORE the button is drawn. Offering `허용하고 다시 해 보기` and then explaining
   * that no button can be offered is a control that contradicts itself. */
  if (d.scopable === false) {
    panel.appendChild(el('div', 'xs mut', C.gap.workNoScope));
  } else {
    const retry = btn('btn sm pri', C.work.permRetry, async () => {
      retry.disabled = true;
      const r = await api.workAllow(snap.work.id, d.toolUseId ?? null);
      if (!r?.ok && r?.reason === 'cannot-scope') panel.appendChild(el('div', 'xs mut', C.gap.workNoScope));
      retry.disabled = false;
    });
    acts.appendChild(retry);
  }
  acts.appendChild(btn('btn sm cancel', C.gap.permStop, () => api.workCancel(snap.work.id)));
  panel.appendChild(acts);
  return panel;
}

/**
 * WBS-13 · 입력 대기. `15`: the question in plain words, the raw question behind `원문 보기`,
 * a field, and `답 보내기`. Answering continues the SAME Work — never a new one.
 *
 * Reachability note: no event the headless CLI currently emits maps to `input_request`
 * (`19` §C3-L lists the ones that do, and none of them is a question). The panel exists
 * because `15` specifies the state and the reducer reaches it from the signal; if the CLI
 * never sends one, the state simply never occurs — which is different from not building it.
 */
function inputPanel(snap, api) {
  const q = snap.inputRequest ?? {};
  const panel = el('div', 'panel perm');
  panel.setAttribute('data-el', 'input');
  panel.appendChild(el('div', 'sm t', C.work.inputTitle));
  if (q.text) panel.appendChild(el('div', 'sm', q.text));
  if (q.raw) {
    const d = el('details');
    d.appendChild(el('summary', 'xs mut', C.work.rawQ));
    d.appendChild(el('div', 'xs mono mut', q.raw));
    panel.appendChild(d);
  }
  const box = el('textarea', 'answerfield');
  box.setAttribute('data-el', 'answer');
  box.placeholder = C.work.inputPh;
  box.rows = 2;
  panel.appendChild(box);
  const acts = el('div', 'row-acts');
  acts.appendChild(btn('btn sm pri', C.work.answer, () => api.workAnswer(snap.work.id, box.value)));
  acts.appendChild(el('span', 'xs mut', C.work.inputHint));
  panel.appendChild(acts);
  return panel;
}

/**
 * WBS-15 · 새 신호 없음. Neutral grey, and it says what it does NOT know: whether the Work is
 * stopped or working. `15` and F-C3-05 forbid the judgement, so the panel makes the refusal
 * to judge the message.
 */
function quietPanel(snap) {
  const panel = el('div', 'panel grey');
  panel.setAttribute('data-el', 'quiet');
  panel.appendChild(el('div', 'sm t', C.work.nosignalTitle));
  panel.appendChild(el('div', 'xs mut', C.work.nosignalBody));
  if (snap.lastObserved) {
    panel.appendChild(field(C.work.lastSeen,
      `${C.gap.signal[snap.lastObserved.kind] ?? C.gap.signal.raw} · ${clock(snap.lastObserved.at)}`));
  }
  /* `15`: 기다리기 is the recovery, and there is NO cancel inside this panel — the header
   * cancel is the single cancel on the screen (DS §1). */
  panel.appendChild(el('div', 'xs mut', C.work.wait));
  return panel;
}

/** WBS-15 · 런타임 상태 확인 불가. Dashed: not a failure, and not progress either. */
function unknownPanel(snap) {
  const panel = el('div', 'panel unk');
  panel.setAttribute('data-el', 'unknown');
  panel.appendChild(el('div', 'sm t', C.work.unknownTitle));
  panel.appendChild(el('div', 'xs mut', C.work.unknownBody));
  panel.appendChild(el('div', 'xs mut', C.work.wait));
  return panel;
}

/**
 * WBS-16 · 취소 확인 불가. The one place SC-03 goes red while running: we asked it to stop,
 * the time passed, and we did not see it stop. `15` says this state is red because claiming
 * the stop would be the lie.
 */
function cancelUnconfirmedPanel(snap) {
  const panel = el('div', 'panel failband');
  panel.setAttribute('data-el', 'cancel-unconfirmed');
  panel.appendChild(el('div', 'sm t', C.work.cancelUnconfTitle));
  panel.appendChild(el('div', 'xs', C.work.cancelUnconfBody));
  panel.appendChild(el('div', 'xs mut', `${C.work.verify} · ${C.work.keepWaiting}`));
  return panel;
}

const field = (k, v) => {
  const row = el('div', 'xs fieldrow');
  row.appendChild(el('span', 'k mut2', k));
  row.appendChild(el('span', 'v', v));
  return row;
};

/* ── Steps: only what Claude Code actually declared (D-107) ── */
function stepsCard(snap) {
  const card = el('div', 'card c-m');
  card.setAttribute('data-card', 'steps');
  card.appendChild(head(C.work.stepsTitle));

  if (!snap.steps.length) {
    card.appendChild(el('div', 'sm mut', C.work.noSteps));
  } else {
    /* `15` SC-03: Steps list (✓ 완료 · ● 진행 중 · ○ 선언된 다음). `18` `work.legend` is that
     * sentence, and it exists because a mark alone is a glyph the user has to decode — `16`
     * §2.1's rule that a state is never carried by shape or colour alone applies to these too. */
    card.appendChild(el('div', 'xs mut2 steplegend', C.work.legend));
    const list = el('div', 'steps');
    /* The word for each state, beside the mark. `not_executed` is the one that most needs it:
     * a `·` next to a step reads as "not started", and `18` says 실행되지 않았어요 — a Work that
     * ENDED without reaching it (`20`: reconciliation rewrites running/declared_next to this). */
    const WORD = { declared_next: C.work.nextDeclared, not_executed: C.work.notRun };
    for (const st of snap.steps) {
      const row = el('div', `step ${st.state}`);
      row.appendChild(el('span', 'mark', { done: '✓', running: '●', declared_next: '○', not_executed: '·' }[st.state] ?? '·'));
      row.appendChild(el('span', 'sm', st.title));
      if (WORD[st.state]) row.appendChild(el('span', 'xs mut2 stepword', WORD[st.state]));
      list.appendChild(row);
    }
    card.appendChild(list);
  }

  /* The NEXT slot is ALWAYS rendered, and empty is the correct answer when nothing declared
   * one. Filling it would be the invention D-107 exists to stop. */
  const next = el('div', 'nextslot');
  next.setAttribute('data-el', 'next');
  const declared = snap.steps.find((s) => s.state === 'declared_next');
  next.appendChild(el('span', 'xs nlabel', C.next.stepLabel));
  next.appendChild(el('div', 'sm' + (declared ? '' : ' mut'), declared ? declared.title : C.work.nextEmpty));
  card.appendChild(next);

  card.appendChild(el('div', 'xs mut2 foot', C.rules.noFake));
  return card;
}

/**
 * `15` SC-03 right rail — `이 Work 에 대해`: who is acting, that the basis was established,
 * that Steps are only what was declared, and the raw output behind a collapsed disclosure.
 * `기술 출력 보기` belongs here rather than only on the result: A-11 lists it as a secondary
 * action of the SCREEN, and a running Work is exactly when someone wants it.
 */
function aboutCard(snap, api) {
  const card = el('div', 'card c-m');
  card.setAttribute('data-card', 'about');
  card.appendChild(head(C.gap.workAbout));
  card.appendChild(field(C.gap.workActor, C.actor.claude));
  card.appendChild(field(C.gap.workBasis, snap.evidence?.before ? C.gap.workBasisOk : C.brief.chips.no));
  card.appendChild(el('div', 'xs mut2', C.gap.workStepsNote));
  card.appendChild(rawOutput(snap, api));
  return card;
}

/** The lines as they arrived. Nothing is summarised here — that is the point of it. */
function rawOutput(snap, api) {
  const d = el('details', 'rawbox');
  d.setAttribute('data-el', 'raw');
  d.appendChild(el('summary', 'xs mut', C.work.raw));
  const box = el('pre', 'rawout');
  d.appendChild(box);
  d.addEventListener('toggle', async () => {
    if (!d.open || box.textContent) return;
    const r = await api.workSignals(snap.work.id);
    if (r?.ok) box.textContent = r.signals.map((s) => `${s.seq} ${s.source}/${s.kind} ${s.payload ?? ''}`).join('\n');
  });
  return d;
}

/**
 * One claim, one chip. The chip's meaning and its label move together — an earlier revision
 * always rendered 확인됨, so a failed Work showed a red chip reading 확인됨.
 */
function claimRow(c) {
  const row = el('div', 'claim');
  row.setAttribute('data-claim', c.kind ?? 'unknown');
  const [cls, label] = { confirmed: ['ok', C.brief.chips.ok], expected: ['part', C.brief.chips.exp] }[c.confidence]
    ?? ['unk', C.brief.chips.no];
  row.appendChild(el('span', `chip ${cls}`, label));

  const body = el('div', 'body');
  body.appendChild(el('div', 'sm', claimText(c)));
  /* A 확인됨 chip is a promise, so what it rests on is named right there. */
  if (c.confidence === 'confirmed' && c.sourceRef) body.appendChild(el('div', 'xs mut2 src', c.sourceRef));
  row.appendChild(body);
  return row;
}

function claimText(c) {
  const d = c.data ?? {};
  switch (c.kind) {
    case 'changed-files':
      return d.files?.length ? `${C.gap.claimChanged} ${d.files.length} · ${d.files.join(' · ')}` : C.work.noChanges;
    case 'changes-unknown': return C.gap.claimUnknown;
    case 'tools-observed':  return `${C.gap.claimTools} ${d.count}`;
    case 'agent-report':    return d.text ?? '';
    default:                return C.brief.chips.no;
  }
}

/* ── the result, once the Work has actually ended ── */
function resultCard(snap, api, nav, state) {
  const card = el('div', 'card c-wide');
  card.setAttribute('data-card', 'result');
  /* The chip carries the OUTCOME, not a confirmation. An earlier revision always rendered the
   * label 확인됨 — so a failed Work showed a red chip reading 확인됨, which is exactly the
   * decoupling of chip and meaning that D-114's vocabulary exists to prevent. */
  card.appendChild(head(outcomeTitle(snap.outcome),
    el('span', `chip ${OUTCOME[snap.outcome]?.cls ?? 'unk'}`, outcomeTitle(snap.outcome))));

  /* WBS-18 · every claim carries its own chip, and a 확인됨 one names the evidence it rests
   * on (D-114, `18` §0.9). The chip is per CLAIM, never per card — a single chip over a mixed
   * list would be asserting one confidence for several different things. */
  for (const c of snap.result?.claims ?? []) card.appendChild(claimRow(c));

  /* 부분 완료 needs both lists (`15`): what was done, and what was not. */
  const done = (snap.result?.items ?? []).filter((i) => i.kind === 'done');
  const notDone = (snap.result?.items ?? []).filter((i) => i.kind === 'not_done');
  if (notDone.length) {
    const box = el('div', 'itemlist');
    box.setAttribute('data-el', 'not-done');
    box.appendChild(el('div', 'xs mut2', C.work.notDone));
    for (const i of notDone) {
      box.appendChild(el('div', 'sm', `${C.gap.claimNotDone}: ${i.data?.tool ?? ''}${i.data?.target ? ` · ${i.data.target}` : ''}`));
    }
    card.appendChild(box);
  }
  /* `15` 부분 완료 needs BOTH lists, and this is where that used to quietly become one.
   *
   * The 된 것 list came only from the evidence pair. When the pair could not tell, the heading
   * was dropped — and a 부분 완료 card showing only 안 된 것 reads as "nothing was done", which
   * is a claim nobody made. D-114: silence is 확인 못함, never a fact.
   *
   * So the heading is drawn whenever the outcome is a 부분 one, and when there is nothing
   * measured to put under it, it says so in `18`'s own word. */
  const isPartial = snap.outcome === 'partial' || snap.outcome === 'cancelled_partial';
  if (done.length || (isPartial && notDone.length)) {
    const box = el('div', 'itemlist');
    box.setAttribute('data-el', 'done');
    box.appendChild(el('div', 'xs mut2', C.work.done));
    if (done.length) {
      box.appendChild(el('div', 'sm mono', (done[0].data?.files ?? []).join(' · ')));
    } else {
      box.appendChild(el('span', 'chip unk', C.brief.chips.no));
    }
    card.appendChild(box);
  }

  /* `15` SC-03 Remaining-unknown (UF-REMAIN-UNKNOWN) — dashed, never red.
   *
   * The result already carries a `changes-unknown` CLAIM, which says the evidence pair could
   * not tell. That is the fact; this is the STATE `15` builds on it, and it is a different
   * thing: a claim row explains, a state offers the three ways out. Without it a user whose
   * cancel left an unknown remainder was told so and given nothing to do about it. */
  if ((snap.result?.claims ?? []).some((c) => c.kind === 'changes-unknown')) {
    card.appendChild(remainPanel(snap, nav, state));
  }

  /* WBS-38 · these are D-136's own examples of 다음 행동 — 변경 내용 보기 · 프로젝트로 돌아가기.
   * They are JuQode's offer, and the block says so; Claude's NEXT lives on the Steps card and
   * is text, not buttons. */
  const acts = nextActions([
    /* `15` SC-04 entry: SC-03 `변경 읽기`. It is the PRIMARY action here — a finished Work's next
     * question is what it actually changed, and reading that is the product's whole argument. */
    btn('btn sm pri', C.work.readChanges, () => nav.toReader(snap)),
    btn('btn sm', C.work.unwanted, () => {
      /* Open the panel in place rather than navigating: `15` puts the Unwanted-result state on
       * SC-03, and a user who is not sure yet must be able to go on reading. */
      if (card.querySelector('[data-el="unwanted"]')) return;
      card.insertBefore(unwantedPanel(snap, nav, state), acts);
    }),
    btn('btn sm', C.work.toBench, () => nav.toWorkbench(state.project, state.interpretation)),
  ]);
  card.appendChild(acts);

  card.appendChild(el('div', 'xs mut2 foot', C.rules.noRollback));
  return card;
}

/**
 * `15` SC-03 Remaining-unknown. Dashed and neutral — `12` §16: not knowing is not failing.
 *
 * Three ways out, and each goes somewhere real. `▸ 터미널` is the third in `15`'s list and is
 * the shared top-bar control, so it is offered here as the same action rather than as a second
 * one that does something slightly different.
 */
function remainPanel(snap, nav, state) {
  const panel = el('div', 'panel unk');
  panel.setAttribute('data-el', 'remain-unknown');
  panel.appendChild(el('div', 'sm t', C.work.remainTitle));
  panel.appendChild(el('div', 'xs mut', C.work.remainBody));
  const acts = el('div', 'row-acts');
  acts.appendChild(btn('btn sm ghost rec', C.work.remainRead, () => nav.toReader(snap)));
  acts.appendChild(btn('btn sm ghost rec', C.work.terminal, () => window.__toggleDrawer?.()));
  acts.appendChild(btn('btn sm ghost rec', C.work.remainNew, () => {
    /* A NEW Work, through the intent field — like every correction (D-115). The sentence is
     * prefilled and NOT submitted: `12` treats sending as consent to change files. */
    nav.toWorkbench(state.project, state.interpretation,
                    { intent: C.gap.correctionIntent(snap.work.intent) });
  }));
  panel.appendChild(acts);
  return panel;
}

/**
 * WBS-19 · 원하던 결과가 아니라면.
 *
 * D-115: there is no undo button, and the panel SAYS SO before offering anything. What it
 * offers is a new Work — which goes through the intent field, the D-117 guard and the evidence
 * basis again, exactly like any other request. `21` WBS-19's acceptance is explicit that a
 * correction is a NEW Work and that this screen has no rollback control.
 *
 * The prefilled sentence quotes the user's OWN words. JuQode does not paraphrase the request it
 * is about to resend, and it does not promise the change will be restored — nothing can.
 */
export function unwantedPanel(snap, nav, state, { readMore = true } = {}) {
  const panel = el('div', 'card c-wide unwanted');
  panel.setAttribute('data-el', 'unwanted');
  panel.appendChild(el('div', 'ct', C.work.unwantedTitle));
  panel.appendChild(el('p', 'sm', C.work.unwantedBody));

  panel.appendChild(nextActions([
    btn('btn sm pri', C.work.correction, () => {
      /* Straight to the intent field with the sentence already in it — and NOT submitted. The
       * user sends it, because `12` treats submitting as consent to change files. */
      nav.toWorkbench(state.project, state.interpretation,
                      { intent: C.gap.correctionIntent(snap.work.intent) });
    }),
    /* `먼저 변경 더 읽기` goes to SC-04. On SC-04 itself that is a button that does nothing,
     * and `15` DS §1 treats a control with no effect as not an action at all. */
    ...(readMore ? [btn('btn sm ghost rec', C.work.readMore, () => nav.toReader(snap))] : []),
  ]));
  return panel;
}

function head(title, right) {
  const h = el('div', 'chead');
  h.appendChild(el('span', 'ct', title));
  h.appendChild(el('span', 'grow'));
  if (right) h.appendChild(right);
  return h;
}

/** A wall-clock time, stated as a fact. No "3분 전" arithmetic that keeps moving on its own. */
function clock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
