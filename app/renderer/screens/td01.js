/* TD-01 · Terminal Drawer (터미널) — WBS-25 · WBS-23 · WBS-24 · `15` TD-01, `19` §C4 · §S, D-134.
 *
 * WBS-25 is the drawer itself (PARTIAL — the shell command line is DV-11); WBS-23 is the Quick
 * Command result cards; WBS-24 is 계속 실행 중, which is the same run reported without ever
 * being called done.
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
import { when } from './brief.js';

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
  /* 서랍은 업데이트마다 통째로 다시 그려진다. 셸 줄은 **명령이 도는 동안** 출력이 오고, 그
   * 조각마다 포커스가 사라지면 사용자는 다음 줄을 칠 수 없다 — 어느 칸에 있었는지 기억했다가
   * 돌려준다. Quick Command 칸도 같은 이유로 같은 이득을 본다. */
  const focused = document.activeElement?.getAttribute?.('data-el') ?? null;
  const caret = document.activeElement?.selectionStart ?? null;
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
  /* `18` `term.safetyTag` labels the banner. A sentence with no label reads as a note; `19` §S
   * wants this read as the safety contract it is, and the label is what says which it is. */
  banner.appendChild(el('span', 'xs td01-safetytag', C.term.safetyTag));
  banner.appendChild(el('span', '', C.term.banner));
  panel.appendChild(banner);

  panel.appendChild(qcRegion(api, state, repaint));
  /* `15` TD-01 Inputs 는 **둘**이다: Quick Command 자연어 칸 · 셸 명령줄. 그리고 둘은 보이기에
   * 달라야 한다 — 하나는 말이고 하나는 명령이며, 무엇이 실행되는지가 다르다. */
  panel.appendChild(termRegion(api, state, repaint));
  host.appendChild(panel);
  if (focused) {
    const back = panel.querySelector(`[data-el="${focused}"]`);
    back?.focus?.();
    /* The caret, when there is one. Two guards used to stand in front of this and the try/catch
     * behind it did the same work — and a widened `&&` reached `back.value` with `back` null,
     * which throws out of the drawer's render and takes the whole drawer with it. That is
     * reachable: type into the shell line, have the shell fail to open, and the field this was
     * restoring focus to is gone from the card that replaced it. One guard, one catch. */
    if (back) {
      try {
        const at = Math.min(caret ?? 0, back.value?.length ?? 0);
        back.setSelectionRange(at, at);
      } catch { /* not a text input */ }
    }
  }
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
  /* `15` TD-01: nothing run yet is a STATE, and it says what to do — `18` `term.qcEmpty`.
   * An empty region says nothing, and a drawer that opens on nothing looks broken. */
  else region.appendChild(el('p', 'sm mut', C.term.qcEmpty));
  if (state.qcDiscover) region.appendChild(discoverCard(state, repaint));
  else region.appendChild(btn('btn sm ghost rec td01-discover', C.qc.discover, async () => {
    state.qcDiscover = await api.qcList(state.project.id);
    repaint();
  }));

  return region;
}

/* ── 셸 명령줄 (WBS-25 · DV-11: 파이프 셸) ──────────────────────────────────────────────
 *
 * `19` §C4: **사용자가 사용자로 실행한다.** 이 칸은 검사하지 않고 고치지 않고 막지 않는다.
 * 대신 무엇이 안 되는지 말한다 — DV-11 GO 의 동반 조건 ①②③ 이 그것이고, 문장은 지어낸 것이
 * 아니라 `term/session.js` 가 `limits` 로 들고 있는 사실을 옮긴 것이다.
 *
 * `15`: Quick Command 칸과 **보이기에 달라야 한다.** 위 칸은 문장을 쓰는 곳이고 이 칸은 명령을
 * 치는 곳이다 — 등폭 글꼴과 `$` 프롬프트가 그 차이를 말한다.
 */
function termRegion(api, state, repaint) {
  const region = el('div', 'td01-term');
  region.setAttribute('data-el', 'term');

  const label = el('div', 'td01-qclabel');
  label.appendChild(el('span', 'kicker', C.gap.termTitle));
  label.appendChild(el('span', 'xs mut', C.gap.termHint));
  region.appendChild(label);

  /* 열지 못했다 — `15` TD-01 Unavailable State. 제목 · 이유 · 대체 경로 둘, 그리고 빨강이
   * 아니다: 셸이 시작되지 않은 것은 사용자의 실패가 아니다(`12` §16). */
  if (state.termFailed) {
    const card = el('article', 'card td01-card');
    card.setAttribute('data-el', 'term-fail');
    card.setAttribute('data-kind', 'unavailable');
    card.appendChild(el('span', 'chip unavail', `${C.qc.unavailable} · ${C.qc.notFail}`));
    card.appendChild(el('div', 'ct', C.term.unavailable));
    card.appendChild(el('p', 'sm', C.term.unavailableBody));
    card.appendChild(routes([
      [C.term.altQc, () => { state.termFailed = null; repaint(); }],
      [C.term.altRaw, () => { state.toWork = state.termLine ?? ''; repaint(); }],
    ]));
    region.appendChild(card);
    return region;
  }

  const t = state.term;
  /* 어디서 도는 셸인가. `15` Displayed Information: shell in project cwd — 그리고 어느 셸인지도
   * 말한다. 사용자의 `SHELL` 이 fish 라면 이 줄은 `/bin/sh` 이고, 그것을 모른 채 치면 왜 자기
   * 별칭이 없는지 알 수 없다. 제목 줄에 얹는다: 서랍은 40vh 이고 여기서 한 줄은 비싸다. */
  if (t) label.appendChild(el('span', 'xs mut mono', C.gap.termWhere(t.cwd, t.limits?.shell ?? '')));

  /* 동반 조건 ①③ — 치기 전에, 화면에서. 접히지 않고, 닫히지 않는다. 두 문장을 한 줄에 두는
   * 것은 줄여서가 아니라 자리 때문이다 — 내용은 하나도 빼지 않는다. */
  const limits = el('p', 'xs mut td01-termlimits', `${C.gap.termNoTty} ${C.gap.termNoColour}`);
  limits.setAttribute('data-el', 'term-limits');
  region.appendChild(limits);

  /* 출력은 프롬프트 **위**에 쌓인다. 터미널은 그렇게 읽히고, 그래야 입력 줄이 서랍 바닥에
   * 고정된다 — `15` 의 Primary Action 이 스크롤 아래로 밀려나면 Primary Action 이 아니다. */
  /* `18` `term.out` — the output pane's own name, over the pane and not over the column.
   * `gap.termTitle` above names the INPUT ("셸 명령줄"); this names what is stacked above it.
   * Human Gate ② (2026-09-11): the approved prototype's drawer carries exactly this label in
   * exactly this place, and no screen was drawing it. */
  region.appendChild(el('div', 'xs mut2 td01-outlabel', C.term.out));
  const outBox = el('div', 'td01-termout');
  region.appendChild(outBox);

  const row = el('div', 'td01-termrow');
  row.appendChild(el('span', 'td01-prompt', '$'));
  const field = el('input', 'td01-terminput');
  field.type = 'text';
  field.setAttribute('data-el', 'term-input');
  field.setAttribute('spellcheck', 'false');
  field.setAttribute('autocapitalize', 'off');
  field.setAttribute('autocomplete', 'off');
  field.value = state.termLine ?? '';
  field.placeholder = C.gap.termPh;
  const send = async () => {
    const line = field.value;
    state.termLine = line;
    if (!line.trim()) return;
    /* 게으르게: 아직 셸이 없으면 여기서 연다. 서랍을 여는 것만으로 사용자의 컴퓨터에 프로세스를
     * 하나 띄우지는 않는다 — 첫 명령이 그 동의다. */
    if (!state.term) {
      const opened = await api.termOpen(state.project.id);
      if (!opened?.ok) { state.termFailed = opened?.reason ?? 'unknown'; repaint(); return; }
      state.term = opened;
    }
    const r = await api.termWrite(state.project.id, line);
    /* 세션이 끝나 있었다 — 사용자의 `exit`, 크래시, 프로젝트 전환. **두 이름으로 온다:** 셸이
     * 죽었지만 핸들이 남아 있으면 `closed`, 메인이 이미 핸들을 놓았으면 `not-open`. 앞의 것만
     * 보고 있었고, 그래서 MEASURED: `exit` 를 친 다음 줄은 **아무 일도 일어나지 않았다** —
     * 거절 이유가 화면에 나오지도 않는다(그 문구는 busy 에만 있다). 사용자에게는 터미널이
     * 그냥 죽은 것으로 보인다. 세션이 없다는 두 답은 같은 상황이므로 같이 처리한다. */
    if (!r.ok && (r.reason === 'closed' || r.reason === 'not-open')) {
      /* 새로 열고 한 번만 다시 보낸다 — 사용자가 같은 줄을 두 번 치게 하지 않는다. */
      state.term = null;
      const again = await api.termOpen(state.project.id);
      if (!again?.ok) { state.termFailed = again?.reason ?? 'unknown'; repaint(); return; }
      state.term = again;
      state.termRun = null;
      await api.termWrite(state.project.id, line);
    } else if (!r.ok) {
      state.termNote = r.reason;
      repaint();
      return;
    }
    state.termNote = null;
    state.termLine = '';
    repaint();
  };
  /* 타이핑을 상태에 흘려 둔다. 실행 중인 명령의 출력이 도착하면 서랍이 다시 그려지는데,
   * 그때 이 칸이 상태에서 값을 다시 읽는다 — 흘려 두지 않으면 **사용자가 치고 있던 줄이
   * 출력 한 조각마다 사라진다.** repaint 는 하지 않는다: 글자마다 다시 그릴 이유가 없다. */
  field.addEventListener('input', () => { state.termLine = field.value; });
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  row.appendChild(field);
  row.appendChild(btn('btn sm', C.qc.run, send));
  region.appendChild(row);

  if (state.termNote === 'busy') region.appendChild(el('p', 'xs mut', C.gap.termBusy));

  const run = state.termRun;
  if (!run) { outBox.appendChild(el('p', 'sm mut', C.gap.termEmpty)); return region; }

  const card = el('article', 'card td01-card');
  card.setAttribute('data-el', 'term-run');
  card.setAttribute('data-state', run.ended ? 'ended' : (run.code == null ? 'running' : 'done'));
  const head = el('div', 'td01-runhead');
  /* 실행 중에는 종료 코드가 없다. `19` §C4: 종료 코드는 코드로 말하고, 없을 때는 없다고 한다. */
  if (run.ended) head.appendChild(el('span', 'chip unavail', C.gap.termEnded));
  else if (run.code == null) head.appendChild(el('span', 'chip', C.gap.termRunning));
  else head.appendChild(el('span', `chip ${run.code === 0 ? 'ok' : 'fail'}`, `${C.qc.exit} ${run.code}`));
  card.appendChild(head);
  if (run.line) card.appendChild(el('p', 'xs mut mono td01-body', `$ ${run.line}`));

  const lines = String(run.output ?? '').split('\n');
  if (lines.some((l) => l.trim())) {
    const pre = el('pre', 'td01-output');
    /* TEXT. 사용자의 컴퓨터에서 온 임의의 내용이고, 마크업이 아니다. */
    pre.textContent = lines.join('\n').replace(/^\n+|\n+$/g, '');
    card.appendChild(pre);
    /* `19` §C4 가 제품이 직접 말하라고 한 것: 가림은 완전하지 않다. 실제로 가린 때만 말한다. */
    if (lines.some((l) => l.includes('***'))) card.appendChild(el('p', 'xs mut', C.gap.qcMaskNote));
  }
  if (run.truncated) card.appendChild(el('p', 'xs mut', C.gap.readerTruncated));

  /* 돌고 있는 동안에만. 끝난 명령 아래의 `멈추기` 는 그 명령을 멈춘다는 뜻으로 읽히는데,
   * 그 명령은 이미 끝났다 — 그리고 이 버튼이 실제로 멈추는 것은 세션이다. */
  if (!run.ended && run.code == null) {
    const acts = el('div', 'row-acts');
    acts.appendChild(btn('btn sm ghost', C.qc.stop, async () => {
      await api.termStop(state.project.id);
      state.term = null;
      repaint();
    }));
    card.appendChild(acts);
    /* 누르기 전에. 작업 제어가 없어 이 버튼은 명령이 아니라 세션을 끝낸다(동반 조건 ①). */
    card.appendChild(el('p', 'xs mut', C.gap.termStopNote));
  }
  outBox.appendChild(card);
  return region;
}

/* ── what the phrase meant ── */
function routeCard(api, state, repaint) {
  const r = state.qcCard;
  const card = el('article', 'card td01-card');
  card.setAttribute('data-el', 'qc-card');
  /* `15` §0: EVERY card that carries a claim names who acts — including 미인식 and 모호함, which
   * are JuQode's own judgements about the phrase and not Claude Code's. */
  const cardHead = el('div', 'td01-cardhead');
  cardHead.appendChild(el('span', 'chip juq td01-actor', C.actor.juq));
  /* `18` `qc.kicker` — which ENGINE produced this card, on the card itself.
   *
   * Human Gate ② (2026-09-11): this was filed as a duplicate of `term.qcTitle`. It is not.
   * `term.qcTitle` names the drawer PANEL; this names one CARD inside it, and the approved
   * prototype renders both at once on the same drawer. A card that outlives its panel's
   * heading — scrolled, or read on its own — otherwise says who acted but not under which
   * rule set, and the deterministic rule set is the whole claim this product makes here. */
  cardHead.appendChild(el('span', 'kicker', C.qc.kicker));
  card.appendChild(cardHead);

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
  /* The two rules whose action is FIXED have no command string — `19` §C4 names them as fixed
   * actions, not scripts — so their 실행할 명령 line is the action itself. Without this the
   * stop card asked the user to confirm a blank. */
  if (id === 'qc.dev.stop' && r.data?.pid) {
    card.appendChild(field3(C.qc.action, C.gap.qcAction['qc.dev.stop'](r.data.pid, r.data.commandStarted)));
  } else if (id === 'qc.terminal.open') {
    card.appendChild(field3(C.qc.action, C.gap.qcAction['qc.terminal.open'](r.data?.cwd ?? '')));
  }
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
  /* ONE chip, carrying the state as TEXT (`15` §F) — not a heading and a chip saying the same
   * sentence twice, and not a state with no chip at all, which is what 실행 중 had. */
  head.appendChild(el('span', `chip ${cls || 'unavail'}`, title));
  card.appendChild(head);
  /* `15` TD-01: 계속 실행 중 — 개발 서버 · 시작 4분 전. The start time is what makes a
   * long-running card readable; `run.js` keeps it and the card never showed it. */
  if (r.startedAt && !r.ended) card.appendChild(el('p', 'xs mut', when(r.startedAt)));

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
    /* `15` TD-01 · F-C4-05: 멈추기 is ink-outlined, and it OPENS THE EXPLAIN CARD for the
     * stopping Quick Command — 이해한 것 · 수행할 동작 · 뜻 — and only `진행` stops it. Stopping
     * is a Quick Command like any other, so it goes through the same Intent→Explain→Confirm
     * path rather than acting on the first click. */
    acts.appendChild(btn('btn sm', C.qc.stop, async () => {
      const listed = await api.qcList(state.project.id);
      const stop = listed.rules?.find((x) => x.id === 'qc.dev.stop');
      if (!stop) return;
      state.qcCard = { ok: true, route: { kind: 'qc', id: 'qc.dev.stop' },
                       rule: { id: 'qc.dev.stop', kind: stop.kind },
                       available: stop.available, reason: stop.reason, data: stop.data };
      /* The run card steps aside while the confirmation is up — one card at a time, and the
       * one on screen is the one being decided. */
      state.qcRun = null;
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
