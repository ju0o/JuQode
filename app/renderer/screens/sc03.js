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
    const list = el('div', 'steps');
    for (const s of snap.steps) {
      const row = el('div', `step ${s.state}`);
      row.appendChild(el('span', 'mark', { done: '✓', running: '●', declared_next: '○', not_executed: '·' }[s.state] ?? '·'));
      row.appendChild(el('span', 'sm', s.title));
      list.appendChild(row);
    }
    card.appendChild(list);
  }

  /* The NEXT slot is ALWAYS rendered, and empty is the correct answer when nothing declared
   * one. Filling it would be the invention D-107 exists to stop. */
  const next = el('div', 'nextslot');
  next.setAttribute('data-el', 'next');
  const declared = snap.steps.find((s) => s.state === 'declared_next');
  next.appendChild(el('span', 'xs mut2', C.next.stepLabel));
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

/* ── the result, once the Work has actually ended ── */
function resultCard(snap, api, nav, state) {
  const card = el('div', 'card c-wide');
  card.setAttribute('data-card', 'result');
  /* The chip carries the OUTCOME, not a confirmation. An earlier revision always rendered the
   * label 확인됨 — so a failed Work showed a red chip reading 확인됨, which is exactly the
   * decoupling of chip and meaning that D-114's vocabulary exists to prevent. */
  card.appendChild(head(outcomeTitle(snap.outcome),
    el('span', `chip ${OUTCOME[snap.outcome]?.cls ?? 'unk'}`, outcomeTitle(snap.outcome))));

  /* Claude Code's own words about what it did. Nothing verified them, so they are 예상됨 —
   * D-114 is explicit that a report not backed by a fact is not 확인됨. The full 된 것 /
   * 안 된 것 claim list is WBS-18's. */
  if (snap.finish?.text) {
    const claim = el('div', 'claim');
    claim.appendChild(el('span', 'chip part', C.brief.chips.exp));
    claim.appendChild(el('span', 'sm', snap.finish.text));
    card.appendChild(claim);
  }

  const count = el('div', 'xs mut');
  count.setAttribute('data-el', 'changes');
  count.textContent = C.gap.workUnknownChanges;
  card.appendChild(count);
  api.workChanges(snap.work.id).then((r) => {
    if (!r?.ok) return;
    /* No after-basis means we could not tell — which is not the same as nothing changed, and
     * `15` 남은 변경 확인 불가 is the state for it. */
    count.textContent = r.known
      ? (r.files.length ? `${C.gap.workChangeCount} ${r.files.length}` : C.work.noChanges)
      : C.work.remainTitle;
    count.className = r.known ? 'xs mut' : 'xs mut2 unknownline';
  });

  const acts = el('div', 'row-acts');
  acts.appendChild(btn('btn sm', C.work.toBench, () => nav.toWorkbench(state.project, state.interpretation)));
  card.appendChild(acts);

  card.appendChild(el('div', 'xs mut2 foot', C.rules.noRollback));
  return card;
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
