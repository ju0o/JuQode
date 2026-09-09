/* TD-01 · Terminal Drawer (터미널) — `15` TD-01, `19` §C4 · §S, D-134.
 *
 * The drawer is the home of technical execution. Two things live in it, and `15` requires them
 * to be VISUALLY DISTINCT: a natural-language Quick Command field, and (later) the shell line.
 * Quick Command is Korean; the shell is commands.
 *
 * Three properties hold this file together:
 *
 *   1. **The banner cannot be closed.** `19` §S and Q-03: this is not isolation, and the product
 *      says so on screen rather than implying otherwise. It is drawn first, always, in every
 *      state — including 사용 불가 — and nothing removes it.
 *   2. **Explain, then confirm, then run.** `19` §C4. Typing routes; it never executes. The card
 *      shows 이해한 것 · 실행할 명령 · 하는 일 and waits for `실행`. That is two IPC round trips
 *      by construction, not by discipline — and the two must address the SAME project, which is
 *      why `renderer.js` clears this state when the project changes. A card explaining project
 *      A's `pnpm run build` was once still on screen after switching to project B, and `실행`
 *      reads the project at CLICK time.
 *   3. **미인식 is a branch, not an error.** `15` paints it neutral — the phrase goes to a Work
 *      instead. `19` §C4 is explicit that the product does not DETECT danger: it recognises six
 *      things and declines everything else, and saying "detected" would teach the user that
 *      whatever was not flagged is safe.
 *
 * The drawer lives OUTSIDE `#root`. Every screen render clears `#root`, and `15` says closing
 * the drawer preserves the screen beneath — so it cannot be a child of the thing being redrawn.
 */
import { C } from '../copy.js';
import { el, btn } from '../dom.js';

/* `15` TD-01: the drawer covers the bottom 40% of the current screen. */
export function mountDrawer(api, state, onChange) {
  const host = el('div', 'td01-host');
  host.setAttribute('data-el', 'drawer');
  document.body.appendChild(host);

  const paint = () => renderDrawer(host, api, state, () => { paint(); onChange?.(); });
  paint();
  return { host, paint };
}

function renderDrawer(host, api, state, repaint) {
  host.innerHTML = '';
  host.classList.toggle('open', Boolean(state.drawerOpen));
  host.setAttribute('data-open', state.drawerOpen ? 'true' : 'false');
  if (!state.drawerOpen) return;

  const panel = el('section', 'td01');
  panel.setAttribute('data-screen-overlay', 'TD-01');

  /* ── the head, and the one line that can never go ── */
  const head = el('div', 'td01-head');
  head.appendChild(el('span', 'td01-title', C.term.title));
  head.appendChild(el('span', 'xs mut', C.term.hint));
  head.appendChild(el('span', 'grow'));
  head.appendChild(btn('btn sm ghost', C.term.close, () => { state.drawerOpen = false; repaint(); }));
  panel.appendChild(head);

  /* `19` §S · Q-03. Not a warning, not dismissible, not conditional on anything. If this line
   * ever stops being drawn, the product is hiding the fact that it does not isolate. */
  const banner = el('div', 'td01-banner');
  banner.setAttribute('data-el', 'banner');
  banner.textContent = C.term.banner;
  panel.appendChild(banner);

  panel.appendChild(qcRegion(api, state, repaint));
  host.appendChild(panel);
}

/* ── Quick Command: the natural-language field and whatever card it produced ── */
function qcRegion(api, state, repaint) {
  const region = el('div', 'td01-qc');

  const label = el('div', 'td01-qclabel');
  label.appendChild(el('span', 'kicker', C.term.qcTitle));
  /* `18` term.qcHint says what the engine is; qc.notClaude says who is acting. Both, because
   * D-134 separates this field from SC-02's and the difference has to be readable. */
  label.appendChild(el('span', 'xs mut', C.term.qcHint));
  label.appendChild(el('span', 'xs mut', C.qc.notClaude));
  region.appendChild(label);

  const row = el('div', 'td01-qcrow');
  const field = el('input', 'td01-qcinput');
  field.type = 'text';
  field.setAttribute('data-el', 'qc-input');
  field.value = state.qcPhrase ?? '';
  /* `18` term.qcPh — examples drawn ONLY from the six rules. SC-02's placeholder invited the
   * change requests this engine is built to refuse. */
  field.placeholder = C.term.qcPh;
  /* Enter ROUTES. It does not run — `19` §C4's explain-then-confirm is the whole contract. */
  const route = async () => {
    const phrase = field.value;
    state.qcPhrase = phrase;
    if (!phrase.trim()) return;
    state.qcCard = await api.qcRoute(state.project.id, phrase);
    state.qcRun = null;
    repaint();
  };
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); route(); } });
  row.appendChild(field);
  row.appendChild(btn('btn sm pri', C.term.qcSend, route));
  region.appendChild(row);

  if (state.qcRun) region.appendChild(runCard(api, state, repaint));
  else if (state.qcCard) region.appendChild(routeCard(api, state, repaint));
  if (state.qcDiscover) region.appendChild(discoverCard(state, repaint));
  else region.appendChild(btn('btn sm ghost rec td01-discover', C.qc.discover, async () => {
    state.qcDiscover = await api.qcList(state.project.id);
    repaint();
  }));

  return region;
}

/* ── what the phrase meant ── */
function routeCard(api, state, repaint) {
  const r = state.qcCard;
  const card = el('article', 'card td01-card');
  card.setAttribute('data-el', 'qc-card');
  /* `15` §0: EVERY card that carries a claim names who acts — including 미인식 and 모호함, which
   * are JuQode's own judgements about the phrase and not Claude Code's. */
  card.appendChild(el('span', 'chip juq td01-actor', 'JUQODE'));

  if (!r?.ok || r.route?.kind === 'unrecognized') {
    /* 미인식 — NEUTRAL, never red. `15` TD-01 and `19` §C4: not recognising is a branch to the
     * Work path, and the product does not claim it detected anything. */
    card.setAttribute('data-kind', 'unrecognized');
    card.appendChild(el('div', 'ct', C.qc.unrec));
    card.appendChild(el('p', 'sm', C.qc.unrecBody));
    card.appendChild(routes([
      [C.qc.discover, async () => { state.qcDiscover = await api.qcList(state.project.id); repaint(); }],
      [C.gap.qcAsWork, () => { state.toWork = state.qcPhrase; repaint(); }],
    ]));
    return card;
  }

  if (r.route.kind === 'ambiguous') {
    /* 모호함 — two readings, named, and NOTHING runs. `19` §C4 §3: 조용히 고르지 않는다. */
    card.setAttribute('data-kind', 'ambiguous');
    card.appendChild(el('div', 'ct', C.gap.qcAmbiguous));
    const list = el('div', 'td01-readings');
    for (const id of r.route.readings) {
      if (id === 'work') {
        list.appendChild(btn('btn sm ghost', C.gap.qcAsWork, () => { state.toWork = state.qcPhrase; repaint(); }));
        continue;
      }
      list.appendChild(btn('btn sm', C.gap.qcUnderstood[id] ?? id, async () => {
        state.qcCard = await api.qcRoute(state.project.id, state.qcPhrase);
        /* Picking a reading is still only an EXPLANATION — the card that follows asks again. */
        state.qcCard = { ...state.qcCard, route: { kind: 'qc', id }, forced: id };
        const one = await api.qcList(state.project.id);
        const found = one.rules?.find((x) => x.id === id);
        if (found) Object.assign(state.qcCard, { rule: { id }, available: found.available,
                                                 reason: found.reason, data: found.data });
        repaint();
      }));
    }
    card.appendChild(list);
    return card;
  }

  const id = r.route.id;
  card.setAttribute('data-kind', r.available ? 'explained' : 'unavailable');

  if (!r.available) {
    /* 사용 불가 — grey, with the reason. `12` §16: 지금 안 됨 · 실패 아님, and it is neither. */
    const chip = el('span', 'chip unavail', `${C.qc.unavailable} · ${C.qc.notFail}`);
    card.appendChild(chip);
    card.appendChild(el('p', 'sm', C.gap.qcWhy[r.reason] ?? C.gap.qcWhy.unknown_rule));
    if (r.reason === 'already_running' && r.data?.pid) {
      card.appendChild(el('p', 'xs mut mono', `pid ${r.data.pid}`));
    }
    card.appendChild(routes([[C.qc.discover, async () => {
      state.qcDiscover = await api.qcList(state.project.id); repaint();
    }]]));
    return card;
  }

  /* 인식됨 — 이해한 것 · 실행할 명령 · 하는 일, then 실행 · 취소. `19` §C4: 항상 설명 후 확인. */
  card.appendChild(field3(C.qc.understood, C.gap.qcUnderstood[id]));
  if (r.data?.command) {
    card.appendChild(field3(C.qc.action, r.data.command, 'mono'));
    /* The script's OWN body, because `19` §C4 says which script was chosen is reported — a user
     * whose `start` does something else entirely needs to see that before it runs. */
    if (r.data.scriptBody) card.appendChild(el('p', 'xs mut mono td01-body', r.data.scriptBody));
    /* `npm run <script>` also runs `pre<script>` and `post<script>`. Showing only the named
     * script made the card display a strict SUBSET of what pressing 실행 would execute. */
    if (r.data.hooks?.length) {
      card.appendChild(el('p', 'xs mut', C.gap.qcAlsoRuns));
      for (const h of r.data.hooks) {
        card.appendChild(el('p', 'xs mut mono td01-body', `${h.script}: ${h.body}`));
      }
    }
  }
  card.appendChild(field3(C.qc.meaning, C.gap.qcMeaning[id]));
  if (r.rule?.kind === 'long_running') card.appendChild(el('p', 'xs mut', C.qc.longNote));

  const acts = el('div', 'row-acts');
  acts.appendChild(btn('btn sm pri', C.qc.run, async () => {
    const started = await api.qcRun(state.project.id, id, state.qcPhrase);
    if (!started.ok) {
      /* The handler's reason, not a fall-through. `19` §C4 requires the card to say WHY, and
       * saying "정해진 Quick Command 가 아니에요" about a rule it just explained is worse than
       * saying nothing. */
      state.qcCard = { ...r, available: false, reason: started.detail ?? started.reason };
      repaint();
      return;
    }
    /* `19` §C4 names three kinds of action. Two of them spawn nothing. */
    if (started.action === 'open-drawer') {
      /* Already here — the drawer IS open, since this card is in it. Clearing the card is the
       * honest acknowledgement: the thing asked for is the thing on screen. */
      state.qcCard = null;
      repaint();
      return;
    }
    if (started.action === 'stop') {
      /* `15` TD-01: 멈춤 요청됨 → 멈춤, never 완료. The card tracks the run being STOPPED. */
      state.qcCard = null;
      state.qcRun = { runId: started.stoppingRunId, ruleId: 'qc.dev.start',
                      command: started.command, state: 'stopped-requested', tail: [] };
      repaint();
      return;
    }
    state.qcRun = { ...started, ruleId: id, state: 'running', tail: [] };
    repaint();
  }));
  acts.appendChild(btn('btn sm', C.qc.cancel, () => { state.qcCard = null; repaint(); }));
  card.appendChild(acts);
  card.appendChild(el('div', 'xs mut2 foot', C.qc.rule));
  return card;
}

/* ── what it did ── */
function runCard(api, state, repaint) {
  const r = state.qcRun;
  const card = el('article', 'card td01-card');
  card.setAttribute('data-el', 'qc-run');
  card.setAttribute('data-state', r.state);

  const RESULT = {
    running: ['', C.gap.qcRunningFor(r.command ?? '')],
    /* `15` TD-01: chips 멈춤 요청됨 → 멈춤, never 완료 — and never 확인 불가 either. The state
     * IS known here: the signal was sent and the child has not exited yet. Falling through to
     * `unknown` said the product could not tell, about the one thing it had just done. */
    'stopped-requested': ['wait', C.qc.stopReq],
    long_running: ['', C.qc.running],
    ok: ['ok', C.qc.ok],
    failed: ['fail', C.qc.failed],
    stopped: ['', C.qc.stopped],
    unknown: ['unk', C.qc.unknownEnd],
  };
  const [cls, title] = RESULT[r.state] ?? RESULT.unknown;
  const head = el('div', 'td01-runhead');
  head.appendChild(el('span', 'ct', title));
  if (cls) head.appendChild(el('span', `chip ${cls}`, title));
  card.appendChild(head);

  if (r.command) card.appendChild(el('p', 'xs mut mono', r.command));

  /* `19` §C4: 종료 코드·stderr 숨기지 않음. The code is shown as the code, including when it is
   * null because the program never started. */
  if (r.ended && r.code != null) card.appendChild(el('p', 'xs mut', `${C.qc.exit} ${r.code}`));

  const lines = r.ended ? (r.output ?? '').split('\n').filter(Boolean) : (r.tail ?? []);
  if (lines.length) {
    const pre = el('pre', 'td01-output');
    /* TEXT. The output is arbitrary content from the user's own machine and is never markup. */
    pre.textContent = state.qcOutputOpen ? lines.join('\n') : lines.slice(-3).join('\n');
    card.appendChild(pre);
    card.appendChild(btn('btn sm ghost', state.qcOutputOpen ? C.qc.fold : C.qc.output,
                         () => { state.qcOutputOpen = !state.qcOutputOpen; repaint(); }));
    /* `19` §C4 requires the PRODUCT to state that the masking is incomplete — a `***` with no
     * note reads as protection. It sits with the output, which is the only place it means
     * anything, and only when something was actually masked. */
    if (lines.some((l) => l.includes('***'))) card.appendChild(el('p', 'xs mut', C.gap.qcMaskNote));
  }
  if (r.truncated) card.appendChild(el('p', 'xs mut', C.gap.readerTruncated));

  const acts = el('div', 'row-acts');
  if (!r.ended) {
    /* `15` TD-01: 멈추기 is ink-outlined, never recovery-green and never red. */
    acts.appendChild(btn('btn sm', C.qc.stop, async () => {
      await api.qcStop(state.project.id);
      state.qcRun = { ...state.qcRun, state: 'stopped-requested' };
      repaint();
    }));
    if (r.kind === 'long_running') {
      acts.appendChild(btn('btn sm ghost', C.qc.leave, () => { state.drawerOpen = false; repaint(); }));
    }
  } else {
    if (r.state === 'failed') {
      /* `15` TD-01 실패: ▸ 다시 실행 AND ▸ Work 로 요청. A failed build with only a re-run
       * button leaves the user with nothing but the same button. */
      acts.appendChild(btn('btn sm ghost rec', C.qc.toWork, () => { state.toWork = state.qcPhrase; repaint(); }));
    }
    acts.appendChild(btn(`btn sm ghost${r.state === 'failed' ? ' rec' : ''}`, C.qc.rerun, async () => {
      const again = await api.qcRun(state.project.id, r.ruleId, state.qcPhrase);
      state.qcRun = again.ok ? { ...again, ruleId: r.ruleId, state: 'running', tail: [] } : null;
      repaint();
    }));
    acts.appendChild(btn('btn sm ghost', C.qc.cancel, () => { state.qcRun = null; state.qcCard = null; repaint(); }));
  }
  card.appendChild(acts);
  return card;
}

/* ── 무엇을 말할 수 있나요? ── */
function discoverCard(state, repaint) {
  const card = el('article', 'card td01-card');
  card.setAttribute('data-el', 'qc-discover');
  card.appendChild(el('div', 'ct', C.qc.discoverTitle));

  for (const rule of state.qcDiscover.rules ?? []) {
    const row = el('div', 'td01-rule');
    row.appendChild(el('span', 'sm', C.gap.qcUnderstood[rule.id] ?? rule.id));
    row.appendChild(el('span', 'grow'));
    /* `15` TD-01: 전부 사용 불가여도 이유와 함께 나열한다. */
    row.appendChild(el('span', `chip ${rule.available ? 'ok' : 'unavail'}`,
                       rule.available ? C.qc.available : C.qc.notAvailable));
    card.appendChild(row);
    if (!rule.available) card.appendChild(el('p', 'xs mut td01-why', C.gap.qcWhy[rule.reason] ?? ''));
  }
  card.appendChild(btn('btn sm ghost', C.qc.cancel, () => { state.qcDiscover = null; repaint(); }));
  return card;
}

function field3(label, value, cls = '') {
  const row = el('div', 'td01-field');
  row.appendChild(el('span', 'xs mut k', label));
  row.appendChild(el('span', `sm v ${cls}`, value ?? ''));
  return row;
}

function routes(pairs) {
  const acts = el('div', 'row-acts');
  for (const [text, fn] of pairs) acts.appendChild(btn('btn sm ghost rec', text, fn));
  return acts;
}
