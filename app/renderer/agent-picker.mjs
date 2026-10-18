/* V1-304 · the Agent picker, as a FIXTURE-EVIDENCED prototype on the real Renderer.
 *
 * Four separate things, and only the last one starts anything (`08` §3-§5):
 *   ① the request and the proposed done-conditions (the composer)
 *   ② which AI            ← this module: a choice, nothing more
 *   ③ which model/profile ← this module: read-only facts + an OPTIONAL "seen" mark; nothing more
 *   ④ the explicit approval ← the existing start button; it is the only control that creates a Work
 *
 * Two views, ONE state (`state.agent`): a short SUMMARY in the composer (name, limits, model unconfirmed, a way in) and the
 * full PANEL in the Inspector (`08` §3: "Inspector 선택 자리"). Both are painted from the same object, so they cannot disagree.
 *
 * What is NOT here, on purpose: a model list (the app cannot read one - `04` Codex model flags are UNKNOWN before G1), a CLI
 * identity for Codex / OpenCode (never measured), and any "fall back to another AI". The selection is not sent to main:
 * there is exactly one Provider connection today (Claude Code, dev-compat), so the screen says what runs and does not
 * pretend to route. Pure `agentRows` is separate from the DOM so each state is testable without a window. */
import { C } from './copy.js';
import { el } from './dom.js';

/** @param {object|null} status  the answer of `claudeStatus` (null = not asked yet)
 *  @param {string|null} seen    the version this session first saw (null = none yet)
 *  @returns {{id:string,name:string,state:string,tags:string[],reason:string,selectable:boolean,limited:boolean,from?:string,to?:string}[]} */
export function agentRows(status, seen = null) {
  const claude = { id: 'claude', name: C.gap.agent.names.claude, limited: true, selectable: false, tags: [], reason: '', state: 'checking' };
  if (!status) { claude.tags = [C.gap.agent.tag.checking]; claude.reason = C.gap.agent.reason.checking; }
  else if (status.available && !status.version) { claude.state = 'version-unknown'; claude.tags = [C.gap.agent.tag.versionUnknown]; claude.reason = C.gap.agent.reason.versionUnknown; }
  else if (status.available && seen && seen !== status.version) {
    claude.state = 'version-changed'; claude.tags = [C.gap.agent.tag.versionChanged]; claude.reason = C.gap.agent.reason.versionChanged; claude.from = seen; claude.to = status.version;
  } else if (status.available) { claude.state = 'ready'; claude.selectable = true; claude.tags = [C.gap.agent.tag.installed, C.gap.agent.tag.signedIn]; claude.reason = C.gap.agent.reason.ready; }
  else if (status.reason === 'not-installed') { claude.state = 'missing'; claude.tags = [C.gap.agent.tag.missing]; claude.reason = C.gap.agent.reason.missing; }
  else if (status.reason === 'logged-out') { claude.state = 'auth'; claude.tags = [C.gap.agent.tag.installed, C.gap.agent.tag.auth]; claude.reason = C.gap.agent.reason.auth; }
  else { claude.state = 'blocked'; claude.tags = [C.gap.agent.tag.blocked]; claude.reason = C.gap.agent.reason.blocked; }
  const unmeasured = (id) => ({ id, name: C.gap.agent.names[id], state: 'unmeasured', tags: [C.gap.agent.tag.unmeasured, C.gap.agent.tag.blocked], reason: C.gap.agent.reason.unmeasured, selectable: false, limited: false });
  return [claude, unmeasured('codex'), unmeasured('opencode')];
}

/* the instance on screen: a newer mount replaces it, so a late status answer paints only what is still there */
let current = null;
const keyOf = (s) => `${s.selected}|${s.status?.available}|${s.status?.version ?? ''}|${s.status?.reason ?? ''}|${s.seen ?? ''}`;

/** @returns {{summary: HTMLElement, panel: HTMLElement, refresh: () => Promise<void>, usable: () => boolean, checking: () => boolean, onPaint: (fn: () => void) => void}} */
export function mountAgentPicker(api, state, { onOpen = () => {} } = {}) {
  const s = (state.agent ??= { selected: 'claude', userPicked: false, seen: null, status: null, ack: false, ackKey: null, busy: false });
  let painted = () => {};

  /* ── composer summary: what runs, with what limits, what is unconfirmed, and the way into the choice ── */
  const summary = el('div', 'agent-summary-card');
  summary.setAttribute('data-el', 'agent-summary');
  const l1 = el('div', 'sm agent-l1');
  const l2 = el('div', 'xs mut agent-l2');
  const l3 = el('div', 'xs mut2 agent-l3', C.gap.agent.unlinked);
  const open = el('button', 'btn sm ghost', C.gap.agent.open);
  open.type = 'button'; open.setAttribute('data-act', 'agent-open');
  open.addEventListener('click', () => onOpen());
  summary.append(l1, l2, l3, open);

  /* ── Inspector panel ── */
  const root = el('section', 'agent-panel');
  root.setAttribute('data-el', 'agent-panel');
  root.setAttribute('aria-label', C.gap.agent.pickTitle);
  root.appendChild(el('div', 'xs mut2 agent-steps', C.gap.agent.steps));
  const group = el('fieldset', 'agent-group');
  group.setAttribute('data-el', 'agent-list');
  group.appendChild(el('legend', 'sm t', C.gap.agent.pickTitle));
  const rowsEl = new Map();
  for (const id of ['claude', 'codex', 'opencode']) {
    const label = el('label', 'agent-row');
    label.setAttribute('data-agent', id);
    const input = el('input');
    input.type = 'radio'; input.name = 'agent'; input.value = id;
    const text = el('span', 'agent-text');
    const name = el('span', 'sm agent-name');
    const tags = el('span', 'agent-tags');
    const why = el('span', 'xs mut agent-why');
    why.id = `agent-why-${id}`;
    input.setAttribute('aria-describedby', why.id);
    text.append(name, tags, why);
    label.append(input, text);
    group.appendChild(label);
    rowsEl.set(id, { label, input, name, tags, why });
    input.addEventListener('change', () => { if (input.checked) { s.selected = id; s.userPicked = true; paint(); } });
  }
  const tools = el('div', 'row-acts agent-tools');
  const recheck = el('button', 'btn sm ghost', C.gap.agent.recheck);
  recheck.type = 'button'; recheck.setAttribute('data-act', 'agent-recheck');
  const accept = el('button', 'btn sm', C.gap.agent.acceptVersion);
  accept.type = 'button'; accept.setAttribute('data-act', 'agent-accept-version');
  tools.append(recheck, accept);
  group.appendChild(tools);
  root.appendChild(group);

  const model = el('div', 'agent-model');
  model.setAttribute('data-el', 'agent-model');
  const modelFacts = el('div', 'xs agent-facts');
  const ackLabel = el('label', 'xs agent-ack');
  const ack = el('input'); ack.type = 'checkbox'; ack.setAttribute('data-act', 'agent-ack');
  ackLabel.append(ack, el('span', '', C.gap.agent.ack));
  model.append(el('div', 'sm t', C.gap.agent.modelTitle), modelFacts, ackLabel);
  root.appendChild(model);
  ack.addEventListener('change', () => { s.ack = ack.checked; s.ackKey = keyOf(s); paint(); });

  /* ④ — text only: this module never owns a control that starts a Work */
  const approve = el('div', 'agent-approve');
  approve.setAttribute('data-el', 'agent-approve');
  const approveLine = el('div', 'xs', '');
  approve.append(el('div', 'sm t', C.gap.agent.approveTitle), approveLine, el('div', 'xs mut', C.gap.agent.approveNote));
  root.appendChild(approve);
  root.appendChild(el('div', 'xs mut2 agent-unlinked', C.gap.agent.unlinked));
  const live = el('div', 'xs mut2 agent-live');
  live.setAttribute('role', 'status');
  root.appendChild(live);

  const rows = () => agentRows(s.status, s.seen);
  const picked = () => rows().find((r) => r.id === s.selected);
  const usable = () => Boolean(picked()?.selectable);
  const checking = () => picked()?.state === 'checking';

  function paint() {
    /* a version / login / selection change makes the earlier "seen" mark mean nothing */
    if (s.ack && s.ackKey !== keyOf(s)) s.ack = false;
    const all = rows();
    const p = all.find((r) => r.id === s.selected);
    for (const r of all) {
      const x = rowsEl.get(r.id);
      x.input.disabled = !r.selectable;
      x.input.checked = s.selected === r.id;
      x.name.textContent = r.name;
      x.tags.textContent = r.tags.join(' · ');
      x.label.setAttribute('data-state', r.state);
      x.label.classList.toggle('is-off', !r.selectable);
      x.why.textContent = r.id === 'claude' && r.limited && r.selectable ? `${r.reason} ${C.gap.agent.limitedNote}` : r.reason;
      if (r.state === 'version-changed') x.why.textContent = `${r.reason} (${r.from} → ${r.to})`;
    }
    const ok = Boolean(p?.selectable);
    accept.hidden = p?.state !== 'version-changed';
    recheck.setAttribute('aria-disabled', String(s.busy));   // never `disabled`: a disabled button drops the focus the person put on it
    recheck.textContent = s.busy ? C.gap.agent.rechecking : C.gap.agent.recheck;
    model.hidden = !ok;
    ack.checked = s.ack;
    modelFacts.textContent = '';
    if (ok) {
      for (const [k, v] of [[C.gap.agent.fact.ai, `${p.name} · ${C.gap.agent.fact.limited}`], [C.gap.agent.fact.model, C.gap.agent.fact.modelValue], [C.gap.agent.fact.profile, C.gap.agent.fact.profileValue]]) {
        const line = el('div', 'agent-fact');
        line.append(el('span', 'mut2', `${k}: `), el('span', '', v));
        modelFacts.appendChild(line);
      }
    }
    approve.hidden = !ok;
    approveLine.textContent = ok ? (s.ack ? C.gap.agent.approveSeen(p.name) : C.gap.agent.approveNotSeen) : '';
    root.setAttribute('data-usable', String(ok));
    /* summary */
    const name = p?.name ?? C.gap.agent.names.claude;
    if (ok) {
      l1.textContent = C.gap.agent.one(name, s.userPicked);
      l2.textContent = s.ack ? C.gap.agent.modelSeen : C.gap.agent.modelUnconfirmed;
    } else {
      l1.textContent = C.gap.agent.oneBlocked(name, p?.tags.join(' · ') ?? '');
      l2.textContent = checking() ? '' : C.gap.agent.invalid;
    }
    summary.setAttribute('data-usable', String(ok));
    summary.setAttribute('data-checking', String(checking()));
    open.setAttribute('aria-expanded', String(Boolean(state.agentSheet)));
    painted();
  }

  async function refresh({ force = false } = {}) {
    if (s.busy || (s.status && !force)) { paint(); return; }
    s.busy = true; paint();
    try { s.status = await api.claudeStatus(); } catch { s.status = { available: false, reason: 'error' }; }
    if (s.status?.available && s.status.version && !s.seen) s.seen = s.status.version;
    s.busy = false;
    current?.repaint();
    live.textContent = C.gap.agent.checked;
  }
  recheck.addEventListener('click', () => refresh({ force: true }));
  accept.addEventListener('click', () => { if (s.status?.version) { s.seen = s.status.version; paint(); } });
  /* Not relevant while a live attempt of the selected Task needs the person's action (set by the Inspector). */
  const setRelevant = (v) => { root.hidden = !v; root.setAttribute('data-relevant', String(Boolean(v))); };
  const inst = { summary, panel: root, refresh, usable, checking, repaint: paint, setRelevant, onPaint: (fn) => { painted = fn; } };
  current = inst;
  paint();
  return inst;
}
