/* SC-04 · Change Reader (변경 읽기) — WBS-28.
 *
 * `15` SC-04: 의미 → 코드 → 원문. Three columns, and the order is the product's whole argument:
 * a non-developer reads what changed and why before they ever see syntax, and the syntax is
 * always one click away rather than hidden behind an explanation they have to trust.
 *
 * D-118's skip is the reason `Raw Diff 보기` sits on the GROUP as well as on each block: a
 * reader who does not want the explanation must be able to reach the raw text without passing
 * through a Code Block. `21` WBS-28 states that as an acceptance row — Code Block 없음(단위화
 * 불가) → Raw 로만 도달 가능해야 함 — and this file is where it is either true or not.
 *
 * Four states here are FAILURES OF THIS PRODUCT, not of the user's code, and each one has a
 * fixed sentence in `18` that says so without inventing a cause:
 *   설명 불가   the pass could not explain the change   — and no `왜` line is drawn at all
 *   단위화 불가 the file has no meaningful units         — raw is shown directly
 *   표시 불가   binary or image                          — no red, this is not a failure
 *   증거 공백   .gitignore'd paths, metadata only        — paths, never contents
 */
import { C } from '../copy.js';
import { el, btn } from '../dom.js';
import { mountThemeToggle } from '../design/theme.js';

/* `16` §2.1: 부분 amber FILL · 실패 red (the only red) · 알 수 없음 dashed. A change that
 * could not be explained is 알 수 없음 — dashed — and never red: nothing failed. */
/* `16` §2.1: 부분 amber FILL · 실패 red (the only red) · 알 수 없음 dashed. A change that could
 * not be explained is 알 수 없음 — dashed — and never red: nothing failed.
 *
 * The three words come from `18` brief.chips, which is the ONE place D-114's vocabulary lives.
 * A second copy of 확인됨/예상됨/확인 못함 would be a second place for them to drift. */
const CONF = {
  confirmed:   { cls: 'ok',  key: 'ok' },
  expected:    { cls: '',    key: 'exp' },
  unconfirmed: { cls: 'unk', key: 'no' },
};

export function renderSC04(root, api, nav, state) {
  root.innerHTML = '';
  const p = state.project;
  const snap = state.workSnapshot;
  const reader = state.reader;

  const shell = el('div', 'shell');
  const bar = el('div', 'topbar');
  bar.appendChild(el('span', 'brand', C.app.name));
  const id = el('span', 'projid');
  id.appendChild(el('span', 'nm', p.name));
  id.appendChild(el('span', 'xs mut path', p.path));
  id.title = p.path;
  bar.appendChild(id);
  bar.appendChild(el('span', 'grow'));
  bar.appendChild(btn('btn sm ghost nodrag', C.reader.back, () => nav.toWork(snap)));
  bar.appendChild(btn('btn sm ghost nodrag', C.reader.understood, () => nav.toWorkbench(p, state.interpretation)));
  mountThemeToggle(bar, C.theme);
  shell.appendChild(bar);

  const board = el('main', 'sc04 board fade-in');
  board.setAttribute('data-screen', 'SC-04');

  board.appendChild(header(snap));

  /* 변경 없음. `15` gives this its own state with two routes down, and the sentence carries
   * (확인됨) because the evidence pair MEASURED it — it is not "we saw nothing". */
  if (!reader || !reader.groups.length) {
    const empty = el('section', 'card c-wide sc04-empty');
    empty.appendChild(el('p', 'lead', C.reader.none));
    const acts = el('div', 'row-acts');
    acts.appendChild(btn('btn sm ghost rec', C.reader.toBlocks, () => nav.toWork(snap)));
    acts.appendChild(btn('btn sm ghost rec', C.reader.toRaw, () => nav.toWorkbench(p, state.interpretation)));
    empty.appendChild(acts);
    board.appendChild(empty);
    shell.appendChild(board);
    root.appendChild(shell);
    return { shell, board };
  }

  const selected = Math.min(state.readerGroup ?? 0, reader.groups.length - 1);
  const group = reader.groups[selected];

  const cols = el('div', 'sc04-cols');
  cols.appendChild(groupColumn(reader, selected, api, nav, state));
  cols.appendChild(blockColumn(group, state, nav));
  cols.appendChild(rawColumn(group, state, nav));
  board.appendChild(cols);

  shell.appendChild(board);
  root.appendChild(shell);
  return { shell, board };
}

/* ── header: the Work this change belongs to ── */
function header(snap) {
  const h = el('header', 'sc04-head');
  h.appendChild(el('h1', 'h1', C.reader.title));
  if (snap?.work?.intent) h.appendChild(el('p', 'lead', snap.work.intent));

  /* 취소된 Work 의 부분 변경 — an amber note, and the SAME reading path below it. `15` is
   * explicit that cancellation gets no surface of its own. */
  if (snap?.outcome === 'cancelled_partial') {
    h.appendChild(el('p', 'sm sc04-cancelled', C.reader.cancelledNote));
  }
  return h;
}

/* ── left: 변경 묶음 ── */
function groupColumn(reader, selected, api, nav, state) {
  const col = el('section', 'sc04-col sc04-groups');
  col.appendChild(el('h2', 'xs mut sc04-collabel', C.reader.groups));

  reader.groups.forEach((g, i) => {
    const card = el('article', `card c-m sc04-group${i === selected ? ' on' : ''}`);
    card.setAttribute('data-group', String(i));
    if (!g.explainable) card.classList.add('unexplained');

    const head = el('div', 'sc04-grouphead');
    head.appendChild(el('span', 'sc04-grouptitle', g.title));
    if (g.confidence) {
      const c = CONF[g.confidence];
      if (c) head.appendChild(el('span', `chip ${c.cls}`, C.brief.chips[c.key]));
    }
    card.appendChild(head);

    if (g.explainable) {
      /* JuQode wrote this, not Claude Code — `15` §0 requires the actor to be named on every
       * card that carries a claim, and the explanation pass is JuQode's own. */
      card.appendChild(el('span', 'chip juq sc04-actor', 'JUQODE'));
      for (const [key, value] of [['what', g.what], ['why', g.why], ['affects', g.affects]]) {
        if (!value) continue;
        const row = el('p', 'sm sc04-field');
        row.appendChild(el('span', 'xs mut sc04-fieldlabel', C.reader[key]));
        row.appendChild(el('span', '', value));
        card.appendChild(row);
      }
    } else {
      /* 설명 불가. One sentence, then routes DOWN. There is no `왜` on this card — inventing a
       * reason for a failure to explain is the overclaim the whole layer exists to prevent. */
      card.appendChild(el('p', 'sm', C.reader.unexplained));
      card.appendChild(el('p', 'sm mut', C.reader.unexplainedBody));
      const acts = el('div', 'row-acts');
      acts.appendChild(btn('btn sm ghost rec', C.reader.toBlocks, () => select(i, false)));
      acts.appendChild(btn('btn sm ghost rec', C.reader.toRaw, () => select(i, true)));
      /* WBS-26's pass, and it runs only because the user pressed this. It spawns a Claude Code
       * child, so it is never a side effect of arriving on the screen. */
      const ask = btn('btn sm sc04-explain', C.gap.readerExplain, async () => {
        ask.disabled = true;
        ask.textContent = C.gap.readerExplaining;
        const r = await api.workExplain(state.workSnapshot.work.id);
        if (r?.ok) { state.reader = r; state.readerGroup = 0; nav.toReader(state.workSnapshot, r); }
        else { ask.disabled = false; ask.textContent = C.gap.readerExplain; }
      });
      acts.appendChild(ask);
      card.appendChild(acts);
    }

    /* D-118: the group-level raw skip. This button is the path that does not pass through a
     * Code Block, and `21` WBS-28 requires it to exist even when blocks do. It sits with the
     * other routes — below the file list it read as a stray line of text rather than an action. */
    card.appendChild(btn('btn sm sc04-rawbtn',
                         state.readerRaw && selected === i ? C.gap.readerRawClose : C.reader.openRaw,
                         () => select(i, !(state.readerRaw && selected === i))));

    card.appendChild(el('p', 'xs mut sc04-files', `${C.gap.readerFiles(g.files.length)} · ${g.files.map((f) => f.file).join(' · ')}`));

    card.addEventListener('click', (e) => { if (e.target === card) select(i, state.readerRaw); });
    col.appendChild(card);
  });

  function select(i, raw) {
    state.readerGroup = i;
    state.readerRaw = raw;
    state.readerBlock = null;
    nav.toReader(state.workSnapshot, state.reader);
  }

  return col;
}

/* ── centre: 코드 단위 ── */
function blockColumn(group, state, nav) {
  const col = el('section', 'sc04-col sc04-blocks');
  col.appendChild(el('h2', 'xs mut sc04-collabel', C.reader.blocks));

  for (const f of group.files) {
    const card = el('article', 'card c-m sc04-file');
    card.appendChild(el('p', 'sm mono sc04-filename', f.file));

    /* 표시 불가 — binary or image. `15` gives it routes down and NO red: this is a statement
     * about the file's kind, not about anything having gone wrong. */
    if (!f.displayable || f.note === 'undisplayable') {
      card.appendChild(el('p', 'sm sc04-undisplayable', C.reader.binary));
      col.appendChild(card);
      continue;
    }

    /* 단위화 불가 — `19` §C5-B's structured formats, a parse we could not trust, and a file we
     * had no text for. Raw is shown DIRECTLY, so the reader is never left with nothing. */
    if (!f.blocks.length || f.note === 'unblocked' || f.note === 'too-large') {
      /* `18`'s sentence takes no file name, so the name stays on its own line above — the
       * copy is not reworded to carry it. */
      card.appendChild(el('p', 'sm sc04-unblocked', C.reader.unblocked));
      /* `15` SC-04 Failure State (blocks): "+ Raw Diff shown directly". A card that says a file
       * has no units and then offers no way to read it leaves the reader with nothing. */
      if (!state.readerRaw) {
        const acts = el('div', 'row-acts');
        acts.appendChild(btn('btn sm ghost rec', C.reader.toRaw, () => { state.readerRaw = true; nav.toReader(state.workSnapshot, state.reader); }));
        card.appendChild(acts);
      }
      col.appendChild(card);
      continue;
    }

    for (const b of f.blocks) {
      const row = el('div', 'sc04-block');
      row.appendChild(el('span', `chip sc04-kind k-${b.change}`, C.reader.kinds[b.change] ?? C.reader.kinds.modify));
      row.appendChild(el('span', 'sm mono sc04-blockname', b.name ?? f.file));
      const lines = b.afterLines?.length ? b.afterLines : b.beforeLines ?? [];
      if (lines.length) row.appendChild(el('span', 'xs mut', lineRange(lines)));
      card.appendChild(row);
    }

    if (f.truncated) card.appendChild(el('p', 'xs mut sc04-truncated', C.gap.readerTruncated));
    col.appendChild(card);
  }

  return col;
}

/** `12` `18` — a range, not a count. The numbers are after-side and they are facts. */
function lineRange(lines) {
  const first = lines[0];
  const last = lines[lines.length - 1];
  return first === last ? `${first}` : `${first}–${last}`;
}

/* ── right: 원문 diff ── */
function rawColumn(group, state, nav) {
  const col = el('section', 'sc04-col sc04-raw');
  col.appendChild(el('h2', 'xs mut sc04-collabel', C.reader.raw));

  if (!state.readerRaw) {
    col.classList.add('closed');
    return col;
  }

  for (const f of group.files) {
    const card = el('article', 'card c-wide2 sc04-rawcard');
    card.appendChild(el('p', 'sm mono sc04-filename', f.file));
    if (!f.displayable) {
      card.appendChild(el('p', 'sm sc04-undisplayable', C.reader.binary));
    } else {
      const pre = el('pre', 'sc04-patch');
      /* The patch is TEXT. It is set through textContent, never parsed as markup — it is
       * arbitrary content from the user's own repository. */
      pre.textContent = f.patch;
      card.appendChild(pre);
      if (f.truncated) card.appendChild(el('p', 'xs mut sc04-truncated', C.gap.readerTruncated));
    }
    col.appendChild(card);
  }

  /* UF-RULE-CHANGE-SCOPED — the footer states the rule the panel obeys. */
  col.appendChild(el('p', 'xs mut sc04-scoped', C.reader.scoped));
  return col;
}
