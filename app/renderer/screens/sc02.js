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
import { proposeDraft, compareRuns } from '../draft.mjs';
import { columnFor, tileTone } from '../board-column.mjs';
import { contextFacts } from '../human-read.mjs';
import { renderBrief, when } from './brief.js';
import { mountThemeToggle } from '../design/theme.js';
import { presenceBody, setPresenceMode, modeFor } from '../presence.js';
import { stateChip } from './sc03.js';

export function renderSC02(root, api, nav, state) {
  root.innerHTML = '';
  const p = state.project;
  if (state.taskProjectId !== p.id) {
    state.taskProjectId = p.id;
    state.selectedTaskId = null;
  }

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
  bar.appendChild(btn('btn sm ghost nodrag term-toggle', C.term.title, () => window.__toggleDrawer?.()));
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
  const colRail = el('div', 'sc02-col sc02-rail');
  const colMain = el('div', 'sc02-col sc02-main');
  const colInspect = el('div', 'sc02-col sc02-inspect');
  colRail.setAttribute('data-region', 'rail');
  colMain.setAttribute('data-region', 'stage');
  colInspect.setAttribute('data-region', 'inspector');
  const navHead = el('div', 'nav-head');
  navHead.appendChild(el('div', 'nav-brand', C.app.name));
  navHead.appendChild(btn('nav-new', C.gap.board.newWork, () => {
    state.composerOpen = true;
    syncShell();
    document.querySelector('[data-el="intent"]')?.focus();
  }));
  navHead.appendChild(el('div', 'nav-label', C.gap.board.projects));
  const projList = el('div', 'nav-projects');
  for (const item of (state.recent ?? []).slice(0, 6)) {
    const current = item.path === p.path;
    const itemBtn = btn(`nav-item${current ? ' is-current' : ''}`, item.name, async () => {
      if (current) return;
      const res = await api.openPath(item.path);
      if (res?.ok) nav.toWorkbench(res.project, res.interpretation ?? null, { empty: res.empty === true });
    });
    itemBtn.type = 'button';
    projList.appendChild(itemBtn);
  }
  if (!projList.childNodes.length) projList.appendChild(el('div', 'nav-item is-current', p.name));
  navHead.appendChild(projList);
  navHead.appendChild(el('div', 'nav-label', C.gap.board.filterWork));
  const filters = el('div', 'nav-filters');
  for (const [key, label] of [['all', C.gap.board.filterAll], ['needs', C.gap.board.needs], ['done', C.gap.task.completeState]]) {
    const filterBtn = btn(`nav-item${(state.boardFilter || 'all') === key ? ' is-current' : ''}`, label, () => {
      state.boardFilter = key;
      for (const node of filters.children) node.classList.toggle('is-current', node.textContent === label);
      paintTaskList();
    });
    filterBtn.type = 'button';
    filters.appendChild(filterBtn);
  }
  navHead.appendChild(filters);
  colRail.appendChild(navHead);
  /* Stage is first in the DOM so the subject is the first card. Visual columns put the
   * rail on the left; see sc02.css `order`. */
  board.append(colMain, colRail, colInspect);
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
    /* The rail keeps its identity above the Brief. The stage keeps the request first.
     * Re-inserting a node before itself throws, so the early return compares the neighbour
     * that should stay put, not the Brief. */
    if (wanted === colRail) {
      if (brief.parentNode === colRail && brief.previousSibling === navHead) return;
      colRail.insertBefore(brief, navHead.nextSibling);
      return;
    }
    const intentCard = colMain.querySelector(':scope > [data-card="intent"]');
    if (brief.parentNode === colMain && brief.nextSibling === intentCard) return;
    colMain.insertBefore(brief, intentCard);
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
      state.composerOpen = true;
      syncShell();
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
  const intent = card('wide2', 'intent');
  const legacyUnknownNotice = el('div', 'task-legacy-unknown');
  legacyUnknownNotice.setAttribute('data-el', 'legacy-unknown');
  colInspect.appendChild(legacyUnknownNotice);
  const taskRows = el('div', 'kanban');
  taskRows.setAttribute('data-el', 'task-list');

  const createTask = el('details', 'task-create');
  const createSummary = el('summary', 'sm', C.gap.task.create);
  createTask.appendChild(createSummary);
  const taskGoal = el('textarea', 'intentfield task-input');
  taskGoal.rows = 2;
  taskGoal.placeholder = C.gap.task.goalPlaceholder;
  taskGoal.setAttribute('aria-label', C.gap.task.goal);
  const taskAcceptance = el('textarea', 'intentfield task-input');
  taskAcceptance.rows = 3;
  taskAcceptance.placeholder = C.gap.task.acceptancePlaceholder;
  taskAcceptance.setAttribute('aria-label', C.gap.task.acceptance);
  const dependencies = el('div', 'task-dependencies');
  const createNote = el('div', 'xs mut2 task-create-note');
  const createButton = btn('btn sm', C.gap.task.createSubmit, async () => {
    const criteria = taskAcceptance.value.split('\n').map((text) => text.trim()).filter(Boolean);
    if (!criteria.length) { createNote.textContent = C.gap.task.createNeedsCriterion; return; }
    createButton.disabled = true;
    const selectedDependencies = [...dependencies.querySelectorAll('input:checked')].map((input) => input.value);
    const created = await api.taskCreate(p.id, {
      goal: taskGoal.value,
      dependencies: selectedDependencies,
      acceptanceCriteria: criteria,
    });
    createButton.disabled = false;
    if (!created?.ok) {
      createNote.textContent = created?.reason === 'invalid-task' ? C.gap.task.draftFailed : (created?.detail ?? C.gap.task.createNeedsCriterion);
      return;
    }
    state.selectedTaskId = created.task.id;
    taskGoal.value = '';
    taskAcceptance.value = '';
    createTask.open = false;
    await refreshTasks();
  });
  createTask.append(el('label', 'xs mut2', C.gap.task.goal), taskGoal,
    el('label', 'xs mut2', C.gap.task.acceptance), taskAcceptance,
    dependencies, createNote, createButton);
  colInspect.appendChild(createTask);

  const selectedTask = el('section', 'task-selected');
  selectedTask.setAttribute('data-el', 'selected-task');
  const detailHead = el('div', 'detail-kicker');
  detailHead.appendChild(el('span', '', C.gap.board.detail));
  detailHead.appendChild(btn('btn sm ghost', C.term.close, () => {
    state.selectedTaskId = null;
    syncShell();
    paintTaskList();
    paintSelectedTask();
  }));
  colInspect.appendChild(detailHead);
  colInspect.appendChild(selectedTask);
  const requestLabel = el('div', 'sm task-request-label', C.gap.stage.ask);
  intent.appendChild(requestLabel);
  intent.appendChild(el('div', 'xs mut2 task-intro', C.gap.task.intro));
  const field = el('textarea', 'intentfield');
  field.setAttribute('data-el', 'intent');
  field.placeholder = C.gap.stage.askPlaceholder;
  field.rows = 2;
  /* WBS-19 · a correction arrives with the request already written. It is NOT sent — `12` treats
   * 보내기 as consent to change files, so the sentence sits here for the user to send, edit, or
   * delete. Consumed once, so a later return to the workbench is not haunted by it. */
  if (state.prefill) { field.value = state.prefill; state.prefill = null; }
  intent.appendChild(field);

  const draft = el('div', 'composer-draft');
  draft.setAttribute('data-el', 'composer-draft');
  draft.hidden = true;
  const criteriaBox = el('textarea', 'intentfield task-input');
  criteriaBox.rows = 2;
  criteriaBox.setAttribute('aria-label', C.gap.task.draftCriterion);
  const draftNote = el('div', 'xs mut2');
  let criteriaDirty = false;
  criteriaBox.addEventListener('input', () => { criteriaDirty = true; });
  const commit = btn('btn pri', C.gap.task.commitNew, () => commitNewTask());
  commit.setAttribute('data-act', 'commit-task');
  draft.title = `${C.gap.task.draftHandoff}\n${C.gap.task.contextScope}`;
  draft.append(
    el('div', 'sm', C.gap.task.draftLead),
    el('label', 'xs mut2', C.gap.task.draftCriterion),
    criteriaBox,
    draftNote,
    commit,
  );
  intent.appendChild(draft);
  const paintDraft = () => {
    const proposal = proposeDraft(field.value);
    if (!proposal) {
      draft.hidden = true;
      criteriaDirty = false;
      criteriaBox.value = '';
      draftNote.textContent = '';
      return;
    }
    draft.hidden = false;
    if (!criteriaDirty) criteriaBox.value = proposal.criteria.join('\n');
  };
  paintDraft();

  const consequence = el('div', 'consequence');
  consequence.setAttribute('data-el', 'consequence');
  intent.appendChild(consequence);
  const syncShell = () => {
    board.classList.toggle('is-inspect', Boolean(state.selectedTaskId));
    board.classList.toggle('composer-open', Boolean(state.composerOpen) || consequence.childNodes.length > 0 || draft.hidden === false);
  };
  new MutationObserver(syncShell).observe(consequence, { childList: true });
  field.addEventListener('input', () => { paintDraft(); syncShell(); });
  syncShell();

  const submit = btn('btn pri', C.intent.submit, () => send());
  submit.setAttribute('data-act', 'submit-intent');
  const row = el('div', 'row-acts');
  row.appendChild(submit);
  row.appendChild(el('span', 'xs mut', C.intent.helper));
  intent.appendChild(row);
  intent.appendChild(el('div', 'xs mut2 task-request-note', C.intent.examples));
  intent.appendChild(el('div', 'xs mut2 task-request-note', C.intent.approvalNote));
  colMain.appendChild(intent);
  colMain.appendChild(taskRows);

  let taskLoadSequence = 0;
  let currentTasks = [];
  const paintLegacyUnknown = (runs) => {
    legacyUnknownNotice.innerHTML = '';
    const work = runs[0];
    if (!work) return;
    const panel = el('div', 'panel wait');
    panel.appendChild(el('div', 'sm t', C.gap.task.legacyUnknownTitle));
    panel.appendChild(el('div', 'xs mut', C.gap.task.legacyUnknownBody));
    if (runs.length > 1) panel.appendChild(el('div', 'xs mut2', C.gap.task.legacyUnknownManyRuns(runs.length)));
    const check = el('input');
    check.type = 'checkbox';
    const label = el('label', 'xs mut2 task-legacy-confirm');
    label.append(check, document.createTextNode(` ${C.gap.task.legacyUnknownCheck}`));
    const note = el('div', 'xs mut2');
    const acknowledge = btn('btn sm', C.gap.task.legacyUnknownResolve, async () => {
      if (!check.checked) return;
      acknowledge.disabled = true;
      const result = await api.legacyUnknownAck(p.id, work.id, true);
      if (result?.ok) await refreshTasks();
      else { note.textContent = C.gap.task.retryFailed; acknowledge.disabled = false; }
    });
    acknowledge.disabled = true;
    check.addEventListener('change', () => { acknowledge.disabled = !check.checked; });
    panel.append(label, note, acknowledge);
    legacyUnknownNotice.appendChild(panel);
  };
  const paintTaskList = () => {
    taskRows.innerHTML = '';
    const tools = el('div', 'boardbar');
    tools.appendChild(el('span', 'board-title', C.gap.task.title));
    const viewBoard = btn('btn sm', C.gap.board.viewBoard, () => {
      state.boardView = 'board';
      paintTaskList();
    });
    const viewList = btn('btn sm', C.gap.board.viewList, () => {
      state.boardView = 'list';
      paintTaskList();
    });
    if (state.boardView === 'list') viewList.classList.add('is-current');
    else viewBoard.classList.add('is-current');
    const views = el('div', 'board-views');
    views.append(viewBoard, viewList);
    tools.appendChild(views);
    taskRows.appendChild(tools);
    if (!currentTasks.length) taskRows.appendChild(el('div', 'sm mut board-empty', C.gap.task.noTasks));

    const columns = [
      ['queued', C.gap.board.queued],
      ['doing', C.gap.historyRunning],
      ['needs', C.gap.board.needs],
      ['review', C.gap.board.review],
      ['done', C.gap.task.completeState],
    ];
    const cols = el('div', `board-cols${state.boardView === 'list' ? ' is-list' : ''}`);
    let liveMarked = false;
    const filter = state.boardFilter || 'all';
    for (const [key, label] of columns) {
      if (filter === 'needs' && key !== 'needs') continue;
      if (filter === 'done' && key !== 'done') continue;
      const items = currentTasks.filter((task) => columnFor(task, task._run) === key);
      const column = el('section', 'board-col');
      column.setAttribute('data-column', key);
      const headRow = el('div', 'col-head');
      headRow.appendChild(el('span', 'col-title', label));
      headRow.appendChild(el('span', 'col-count', String(items.length)));
      column.appendChild(headRow);
      if (key === 'doing' && items.length) column.appendChild(el('div', 'xs mut2 col-note', C.gap.board.oneRun));
      if (!items.length && !currentTasks.length && key === 'queued') {
        column.appendChild(el('div', 'xs mut2 col-empty', C.gap.board.empty));
      }
      for (const task of items) {
        const executing = key === 'doing' && !liveMarked;
        if (executing) liveMarked = true;
        column.appendChild(taskTile(task, executing));
      }
      cols.appendChild(column);
    }
    taskRows.appendChild(cols);

    dependencies.innerHTML = '';
    if (currentTasks.length) {
      dependencies.appendChild(el('div', 'xs mut2', C.gap.task.dependencies));
      for (const task of currentTasks) {
        const label = el('label', 'task-dependency');
        const check = el('input');
        check.type = 'checkbox'; check.value = task.id;
        label.append(check, el('span', 'xs', task.goal));
        dependencies.appendChild(label);
      }
    }
  };

  const taskTile = (task, executing) => {
    const tone = tileTone(task, task._run);
    const selected = task.id === state.selectedTaskId;
    const row = btn(`task-pick tile tone-${tone}${selected ? ' selected' : ''}${executing ? ' is-live' : ''}`, '', () => {
      state.selectedTaskId = task.id;
      syncShell();
      paintTaskList();
      paintSelectedTask();
    });
    row.setAttribute('data-task-id', task.id);
    row.setAttribute('data-tone', tone);
    row.setAttribute('aria-pressed', String(selected));
    row.appendChild(el('span', 'tile-title', task.goal));
    row.appendChild(el('span', `tile-status tone-${tone}`, tileStatus(task, task._run, executing)));
    const meta = el('span', 'tile-meta');
    if (task._run?.attempt) meta.appendChild(el('span', '', `${C.gap.task.run} ${task._run.attempt}`));
    if (task._run?.at) meta.appendChild(el('span', '', shortWhen(task._run.at)));
    if (task._run?.evidence > 0) meta.appendChild(el('span', '', C.gap.board.seen(task._run.evidence)));
    if (meta.childNodes.length) row.appendChild(meta);
    return row;
  };

  const paintSelectedTask = async () => {
    const sequence = ++taskLoadSequence;
    const taskId = state.selectedTaskId;
    selectedTask.innerHTML = '';
    if (!taskId) {
      requestLabel.textContent = C.gap.stage.ask;
      selectedTask.appendChild(el('p', 'sm mut', C.gap.stage.noTask));
      return;
    }
    const result = await api.taskDetail(taskId);
    if (sequence !== taskLoadSequence || state.selectedTaskId !== taskId) return;
    if (!result?.ok) { selectedTask.appendChild(el('div', 'xs mut2', result?.detail ?? C.gap.task.noTasks)); return; }
    const task = result.task;
    requestLabel.textContent = C.gap.task.runRequest;
    const goal = el('div', 'task-goal');
    goal.append(el('div', 'xs mut2', C.gap.task.selected), el('div', 'sm', task.goal));
    const lifecycleLabel = task.status === 'complete' ? C.gap.task.completeState
      : task.status === 'blocked' ? C.gap.task.blocked
        : task.status === 'in_progress' ? C.gap.task.inProgress : C.gap.task.open;
    const lifecycle = el('div', 'xs mut2', `${C.gap.task.stateLabel}: ${lifecycleLabel}`);
    const statusLabel = task.verdict === 'pass' ? C.gap.task.pass : task.verdict === 'fail' ? C.gap.task.fail : C.gap.task.unverified;
    const verdict = el('div', `task-verdict ${task.verdict}`, `${C.gap.task.status}: ${statusLabel}`);
    const acceptance = el('ul', 'task-criteria');
    for (const criterion of task.acceptance_criteria) acceptance.appendChild(el('li', 'sm', criterion.text));
    const deps = el('div', 'xs mut2 task-dep-line', task.dependencies.length
      ? `${C.gap.task.dependencies}: ${task.dependencies.map((id) => currentTasks.find((item) => item.id === id)?.goal ?? id).join(' · ')}`
      : `${C.gap.task.dependencies}: —`);
    selectedTask.append(goal, lifecycle, verdict, deps, el('div', 'xs mut2', C.gap.task.acceptance), acceptance);
    if (result.runs.length) selectedTask.appendChild(renderRunReview(task, result, refreshTasks, nav));
    else selectedTask.appendChild(el('div', 'xs mut2', C.gap.task.noRuns));
    submit.disabled = task.verdict === 'pass';
  };

  async function refreshTasks() {
    const sequence = ++taskLoadSequence;
    const listed = await api.taskList(p.id);
    if (sequence !== taskLoadSequence || state.project.id !== p.id) return;
    if (!listed?.ok) { taskRows.textContent = listed?.detail ?? C.gap.task.noTasks; return; }
    const details = await Promise.all((listed.tasks ?? []).map((task) => api.taskDetail(task.id)));
    if (sequence !== taskLoadSequence || state.project.id !== p.id) return;
    currentTasks = (listed.tasks ?? []).map((task, index) => {
      const detail = details[index]?.ok ? details[index] : null;
      const snap = detail?.runs?.[0] ?? null;
      return {
        ...task,
        _run: snap ? {
          status: snap.work?.status ?? null,
          outcome: snap.work?.outcome ?? null,
          attempt: snap.work?.attempt ?? null,
          at: snap.work?.ended_at || snap.work?.started_at || null,
          evidence: (snap.runEvidence ?? []).length,
        } : null,
      };
    });
    paintLegacyUnknown(listed.legacyUnknownRuns ?? []);
    if (state.selectedTaskId && !currentTasks.some((task) => task.id === state.selectedTaskId)) {
      state.selectedTaskId = null;
    }
    syncShell();
    paintTaskList();
    await paintSelectedTask();
  }
  refreshTasks();

  /* Enter submits, Shift+Enter is a newline (`15` SC-02 Inputs). */
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  async function commitNewTask() {
    const text = field.value;
    const criteria = criteriaBox.value.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!text.trim()) { draftNote.textContent = C.gap.task.draftNeed; return; }
    if (!criteria.length) { draftNote.textContent = C.gap.task.draftNeedCriterion; return; }
    commit.disabled = true;
    commit.textContent = C.gap.task.commitWorking;
    draftNote.textContent = '';
    try {
      const routed = await api.routeIntent(text);
      const route = routed?.route?.route ?? 'work';
      if (route !== 'work') { await send(); return; }
      const created = await api.taskCreate(p.id, { goal: text.trim(), acceptanceCriteria: criteria });
      if (!created?.ok) { draftNote.textContent = C.gap.task.draftFailed; return; }
      state.selectedTaskId = created.task.id;
      criteriaDirty = false;
      await refreshTasks();
      await startWork(text, created.task.id, window.crypto.randomUUID());
    } finally {
      commit.disabled = false;
      commit.textContent = C.gap.task.commitNew;
    }
  }

  async function send() {
    const text = field.value;
    if (!text.trim()) return;
    /* The route can wait for the user. Freeze the Task at submit time so changing selection
     * while that choice is open cannot attach this request to a different Task. */
    const submittedTaskId = state.selectedTaskId ?? null;
    const idempotencyKey = submittedTaskId ? window.crypto.randomUUID() : null;
    consequence.innerHTML = '';
    submit.disabled = true;
    try {
      const routed = await api.routeIntent(text);
      const route = routed?.route?.route ?? 'work';

      /* Not a failure and not red — a place, not a refusal (D-134). */
      if (route === 'terminal') { consequence.appendChild(terminalCard(text, () => startWork(text, submittedTaskId, idempotencyKey))); return; }
      if (route === 'ambiguous') {
        consequence.appendChild(ambiguousCard({ ...routed.route, phrase: text }, () => startWork(text, submittedTaskId, idempotencyKey)));
        return;
      }
      if (route === 'unrecognized') { consequence.appendChild(line(C.intent.routeUnrec)); return; }
      await startWork(text, submittedTaskId, idempotencyKey);
    } finally { submit.disabled = false; }
  }

  async function startWork(text, taskId = null, idempotencyKey = null) {
    consequence.appendChild(line(C.intent.routeWork));
    const pend = el('div', 'sm mut');
    pend.setAttribute('data-el', 'pending');
    pend.textContent = C.pending.label;              // a place-holder card, NOT a progress bar
    consequence.appendChild(pend);

    const r = await api.workStart(p.id, text, taskId, idempotencyKey);
    pend.remove();
    if (r?.ok) { field.value = ''; return nav.toWork(r.work); }

    /* `15` SC-02 keeps the submitted text in the field for every one of these — it is never
     * queued and never thrown away (UF-RULE-NOQUEUE). */
    consequence.appendChild(refusalCard(r, api, nav, state, p, {
      phrase: text, resubmit: () => startWork(text, taskId, idempotencyKey),
    }));
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
  stream.title = C.presence.hint;
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

function shortWhen(iso) {
  const time = new Date(iso);
  if (!Number.isFinite(time.getTime())) return '';
  return time.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function tileStatus(task, run, executing) {
  if (run?.status === 'permission_waiting') return C.gap.presenceLabel.permission;
  if (run?.status === 'input_waiting') return C.gap.presenceLabel.input;
  if (run?.status === 'cancel_requested') return C.work.cancelReq;
  if (run?.outcome === 'ended_unknown') return C.gap.task.unknownOutcome;
  if (task?.status === 'blocked') return C.gap.task.blocked;
  if (run?.status && run.status !== 'ended') return executing ? C.gap.board.live : C.gap.board.notEnded;
  if (task?.verdict === 'pass' || task?.status === 'complete') return C.gap.task.pass;
  if (task?.verdict === 'fail' || run?.outcome === 'failed') return C.gap.task.fail;
  if (run?.outcome === 'partial' || run?.outcome === 'cancelled_partial') return C.work.resultTitle.partial;
  if (run?.outcome === 'cancelled_nochange') return C.work.resultTitle.cancelled_none;
  if (run?.outcome === 'complete') return C.gap.board.look;
  if (run) return C.gap.board.look;
  return C.gap.board.notStarted;
}

function runTime(value) {
  if (!value) return '—';
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return String(value);
  return time.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function outcomeKorean(outcome) {
  if (!outcome) return null;
  if (outcome === 'cancelled_nochange') return C.work.resultTitle.cancelled_none;
  if (outcome === 'ended_unknown') return C.gap.task.unknownOutcome;
  return C.work.resultTitle[outcome] ?? null;
}

function runFacts(snap) {
  const changed = (snap.runEvidence ?? []).find((item) => item.kind === 'changed_files');
  return {
    contextDigest: snap.contextBundle?.content_digest ?? null,
    filesObserved: Boolean(changed),
    changedFiles: changed?.details?.files ?? [],
    outcome: snap.work?.outcome ?? null,
  };
}

function voice(label, text) {
  const block = el('div', 'task-voice');
  block.append(el('div', 'xs mut2', label), el('div', 'sm', text));
  return block;
}

function renderHumanRead(task, latest) {
  const block = el('div', 'task-human');
  block.setAttribute('data-el', 'human-read');
  block.appendChild(el('div', 'sm', C.gap.task.humanTitle));
  block.appendChild(voice(C.gap.task.humanAsked, task.goal));
  const ended = latest.work.status === 'ended';
  const known = outcomeKorean(latest.work.outcome);
  if (known) block.appendChild(voice(C.gap.task.humanOutcome, known));
  else if (latest.work.outcome) {
    const raw = el('details');
    raw.appendChild(el('summary', 'xs mut', C.gap.task.outcomeRaw));
    raw.appendChild(el('div', 'xs mono mut', latest.work.outcome));
    block.appendChild(raw);
  }
  const report = latest.result?.claims?.find((claim) => claim.kind === 'agent-report');
  if (report?.data?.text) block.appendChild(voice(C.gap.task.humanAgent, report.data.text));
  else block.appendChild(voice(C.gap.task.humanAgent, ended ? C.gap.task.humanAgentNone : C.gap.task.humanAgentPending));
  const changed = (latest.runEvidence ?? []).find((item) => item.kind === 'changed_files');
  if (changed) {
    const files = changed.details.files ?? [];
    block.appendChild(voice(C.gap.task.humanObserved, files.length ? files.join('\n') : C.gap.task.noChanges));
  } else {
    block.appendChild(voice(C.gap.task.humanObserved, ended ? C.gap.task.humanObservedMissing : C.gap.task.humanObservedPending));
  }
  const tests = (latest.runEvidence ?? []).filter((item) => item.kind === 'test_command');
  if (tests.length) {
    const lines = tests.map((item) => `${item.summary} · ${testStateLabel(item)}`);
    block.appendChild(voice(C.gap.task.humanTest, lines.join('\n')));
  } else {
    block.appendChild(voice(C.gap.task.humanTest, ended ? C.gap.task.humanTestNone : C.gap.task.humanTestPending));
  }
  if (ended) block.appendChild(el('div', 'sm', C.gap.task.observedCount((latest.runEvidence ?? []).length)));
  if (latest.contextBundle?.bundle) block.appendChild(contextBlock(latest.contextBundle.bundle));
  block.appendChild(voice(C.gap.task.humanConfirm, C.gap.task.humanConfirmHint));
  return block;
}

function testStateLabel(item) {
  if (item.details?.result_state === 'error') return C.gap.task.evidenceError;
  if (item.details?.result_state === 'returned') {
    return item.details.exit_code == null ? C.gap.task.evidenceReturnedNoExit : C.gap.task.evidenceReturned;
  }
  return C.gap.task.evidenceUnknown;
}

/* The frozen facts of one attempt. Ids and digests stay behind 자세히 보기. */
function contextBlock(bundle) {
  const block = el('div', 'context-human');
  block.setAttribute('data-el', 'context-human');
  block.appendChild(el('div', 'sm', C.gap.task.contextShown));
  const label = {
    goal: C.gap.task.goal,
    criterion: C.gap.task.draftCriterion,
    request: C.gap.task.humanAsked,
  };
  for (const fact of contextFacts(bundle)) {
    const row = el('div', 'context-line');
    if (label[fact.key]) row.appendChild(el('div', 'xs mut2', label[fact.key]));
    row.appendChild(el('div', 'sm', fact.text));
    block.appendChild(row);
  }
  block.appendChild(el('div', 'xs mut2', C.gap.task.contextScope));
  return block;
}

function attemptLine(work) {
  const spoken = outcomeKorean(work.outcome);
  const line = el('div', 'task-attempt');
  line.appendChild(el('div', 'sm', spoken
    ? `${C.gap.task.run} ${work.attempt ?? 1} · ${spoken}`
    : `${C.gap.task.run} ${work.attempt ?? 1}`));
  if (!spoken && (work.outcome || work.status)) {
    const raw = el('details');
    raw.appendChild(el('summary', 'xs mut', C.gap.task.outcomeRaw));
    raw.appendChild(el('div', 'xs mono mut', work.outcome ?? work.status));
    line.appendChild(raw);
  }
  return line;
}

function renderRunCompare(newer, older) {
  const compared = compareRuns(runFacts(newer), runFacts(older));
  if (!compared) return el('div');
  const block = el('div', 'task-compare');
  block.setAttribute('data-el', 'run-compare');
  block.appendChild(el('div', 'xs mut2', C.gap.task.compareTitle));
  const context = compared.context === 'same' ? C.gap.task.compareContextSame
    : compared.context === 'different' ? C.gap.task.compareContextDiff
      : C.gap.task.compareContextUnknown;
  const files = compared.files === 'same' ? C.gap.task.compareFilesSame
    : compared.files === 'different' ? C.gap.task.compareFilesDiff
      : C.gap.task.compareFilesUnknown;
  block.append(el('div', 'sm', context), el('div', 'sm', files));
  if (compared.addedFiles.length) block.appendChild(voice(C.gap.task.compareAdded, compared.addedFiles.join('\n')));
  if (compared.removedFiles.length) block.appendChild(voice(C.gap.task.compareRemoved, compared.removedFiles.join('\n')));
  return block;
}

function renderRunReview(task, detail, refresh, nav) {
  const latest = detail.runs[0];
  const section = el('div', 'task-run-review');
  section.appendChild(renderHumanRead(task, latest));
  if (detail.runs.length > 1) section.appendChild(renderRunCompare(detail.runs[0], detail.runs[1]));
  const reviews = new Map();
  for (const review of detail.reviews) {
    if (review.work_id === latest.work.id) reviews.set(review.criterion_id, review);
  }
  section.appendChild(attemptLine(latest.work));

  const criteria = el('div', 'task-review-criteria');
  for (const criterion of task.acceptance_criteria) {
    const row = el('div', 'task-review-criterion');
    const previous = reviews.get(criterion.id);
    const matchingReview = latest.taskSpecCurrent && previous &&
      previous.task_spec_digest === latest.contextBundle?.bundle?.task_spec_digest;
    const line = el('div', 'task-criterion-line');
    line.appendChild(el('span', `task-mark${matchingReview?.verdict === 'pass' ? ' pass' : ''}`,
      matchingReview?.verdict === 'pass' ? '✓' : '·'));
    line.appendChild(el('div', 'sm', criterion.text));
    row.appendChild(line);
    if (matchingReview) {
      row.appendChild(el('div', `xs mut2 review-${previous.verdict}`,
        `${C.gap.task.status}: ${previous.verdict === 'pass' ? C.gap.task.pass : C.gap.task.fail}`));
    }
    const unsupportedCheck = /\b(?:lint|type[\s-]?check(?:ing)?|static analysis|static check(?:s)?)\b/i.test(criterion.text);
    const evidence = latest.runEvidence ?? [];
    if (!matchingReview && latest.taskSpecCurrent && latest.work.status === 'ended' && !unsupportedCheck) {
      if (evidence.length === 1) {
        const shortcut = el('div', 'row-acts task-review-acts');
        const record = async (verdict, button) => {
          button.disabled = true;
          const result = await window.juqode.taskReviewCriterion(task.id, latest.work.id, criterion.id,
            verdict, [evidence[0].id]);
          if (result?.ok) await refresh();
          else {
            row.appendChild(el('div', 'xs mut2', result?.detail ?? C.gap.task.noEvidence));
            button.disabled = false;
          }
        };
        const pass = btn('btn sm pri', C.gap.task.reviewThisPass, () => record('pass', pass));
        const fail = btn('btn sm ghost', C.gap.task.reviewThisFail, () => record('fail', fail));
        pass.disabled = latest.work.outcome !== 'complete';
        shortcut.append(pass, fail);
        row.appendChild(shortcut);
      } else if (evidence.length > 1) {
        row.appendChild(el('div', 'xs mut2', C.gap.task.reviewPick));
      }
    }
    const review = el('details', 'task-review');
    review.appendChild(el('summary', 'xs mut', C.gap.task.review));
    if (unsupportedCheck) review.appendChild(el('div', 'xs mut2', C.gap.task.unsupportedEvidence));
    if (!latest.taskSpecCurrent || latest.work.status !== 'ended') {
      review.appendChild(el('div', 'xs mut2', C.gap.task.noEvidence));
    } else if (!evidence.length) {
      review.appendChild(el('div', 'xs mut2', C.gap.task.noEvidence));
    } else {
      const chosen = new Set();
      for (const item of evidence) {
        const label = el('label', 'task-evidence-choice');
        const check = el('input', 'task-evidence-check');
        check.type = 'checkbox'; check.value = item.id;
        check.addEventListener('change', () => check.checked ? chosen.add(item.id) : chosen.delete(item.id));
        const text = el('span', 'xs task-evidence-text');
        text.appendChild(el('span', '', item.kind === 'test_command' ? `${C.gap.task.testEvidence}: ${item.summary}` : C.gap.task.changedFiles));
        const evidenceRef = el('span', 'xs mut2 mono', `Evidence ${item.id.slice(0, 8)}`);
        evidenceRef.title = item.id;
        text.appendChild(evidenceRef);
        if (item.kind === 'test_command') {
          const state = item.details.result_state === 'error' ? C.gap.task.evidenceError
            : item.details.result_state === 'returned'
              ? (item.details.exit_code == null ? C.gap.task.evidenceReturnedNoExit : C.gap.task.evidenceReturned)
              : C.gap.task.evidenceUnknown;
          text.appendChild(el('span', 'mut2', state));
          if (item.details.exit_code != null) text.appendChild(el('span', 'mono mut2', `Exit code: ${item.details.exit_code}`));
          if (item.details.output_excerpt) text.appendChild(el('span', 'mut2', item.details.output_excerpt));
          if (item.details.command_redacted || item.details.output_redacted) {
            text.appendChild(el('span', 'mut2', C.gap.task.redactedContent));
          }
        } else {
          const files = item.details.files ?? [];
          text.appendChild(el('span', 'mut2', files.length ? files.join(' · ') : C.gap.task.noChanges));
        }
        label.append(check, text);
        review.appendChild(label);
      }
      const acts = el('div', 'row-acts task-review-acts');
      const pass = btn('btn sm pri', C.gap.task.reviewPass, async () => {
        if (!chosen.size) return;
        pass.disabled = true;
        const result = await window.juqode.taskReviewCriterion(task.id, latest.work.id, criterion.id,
          'pass', [...chosen]);
        if (result?.ok) await refresh(); else {
          const message = result?.reason === 'unsupported-verification'
            ? C.gap.task.unsupportedEvidence : result?.detail ?? C.gap.task.noEvidence;
          review.appendChild(el('div', 'xs mut2', message)); pass.disabled = false;
        }
      });
      pass.disabled = latest.work.outcome !== 'complete' || unsupportedCheck;
      const fail = btn('btn sm ghost', C.gap.task.reviewFail, async () => {
        if (!chosen.size) return;
        fail.disabled = true;
        const result = await window.juqode.taskReviewCriterion(task.id, latest.work.id, criterion.id,
          'fail', [...chosen]);
        if (result?.ok) await refresh(); else { review.appendChild(el('div', 'xs mut2', result?.detail ?? C.gap.task.noEvidence)); fail.disabled = false; }
      });
      acts.append(pass, fail);
      review.appendChild(acts);
    }
    row.appendChild(review);
    criteria.appendChild(row);
  }
  section.appendChild(criteria);

  if (latest.work.status === 'ended' && task.verdict !== 'pass') {
    const retry = el('details', 'task-retry');
    retry.appendChild(el('summary', 'xs mut', C.gap.task.retryRun));
    const reason = el('textarea', 'intentfield task-input');
    reason.rows = 2;
    reason.placeholder = C.gap.task.retryPlaceholder;
    reason.setAttribute('aria-label', C.gap.task.retryReason);
    const note = el('div', 'xs mut2');
    const confirmUnknown = latest.work.outcome === 'ended_unknown' ? el('label', 'xs mut2') : null;
    const confirmCheck = confirmUnknown ? el('input') : null;
    if (confirmUnknown) {
      confirmCheck.type = 'checkbox';
      confirmUnknown.append(confirmCheck, document.createTextNode(` ${C.gap.task.retryUnknownConfirm}`));
    }
    const start = btn('btn sm pri', C.gap.task.retrySubmit, async () => {
      if (!reason.value.trim()) { note.textContent = C.gap.task.retryNeedsReason; return; }
      if (confirmCheck && !confirmCheck.checked) { note.textContent = C.gap.task.retryUnknownRequired; return; }
      start.disabled = true;
      note.textContent = '';
      const result = await window.juqode.taskRetry(task.id, latest.work.id, reason.value.trim(),
        window.crypto.randomUUID(), Boolean(confirmCheck?.checked));
      if (result?.ok) nav.toWork(result.work);
      else {
        note.textContent = result?.reason === 'prior-process-may-still-live'
          ? C.gap.task.retryProcessStillLive : result?.detail ?? C.gap.task.retryFailed;
        start.disabled = false;
      }
    });
    retry.append(el('label', 'xs mut2', C.gap.task.retryReason), reason);
    if (confirmUnknown) retry.appendChild(confirmUnknown);
    retry.append(note, start);
    section.appendChild(retry);
  }

  const history = el('details', 'task-runs');
  history.appendChild(el('summary', 'sm', `${C.gap.task.runHistory} · ${detail.runs.length}`));
  for (const snap of detail.runs) {
    const run = el('details', 'task-run');
    const attempt = snap.work.attempt ?? 1;
    const agent = snap.work.agent_code === 'claude_code' ? C.actor.claude : '—';
    const spoken = outcomeKorean(snap.work.outcome);
    run.appendChild(el('summary', 'xs task-run-summary', spoken
      ? `#${attempt} · ${C.gap.task.agent} ${agent} · ${spoken}`
      : `#${attempt} · ${C.gap.task.agent} ${agent}`));
    if (!spoken && (snap.work.outcome || snap.work.status)) {
      const raw = el('details');
      raw.appendChild(el('summary', 'xs mut', C.gap.task.outcomeRaw));
      raw.appendChild(el('div', 'xs mono mut', snap.work.outcome ?? snap.work.status));
      run.appendChild(raw);
    }
    const times = el('div', 'xs mut2 task-run-times', `${C.work.started}: ${runTime(snap.work.started_at)}${snap.work.ended_at ? ` · ${C.gap.task.ended}: ${runTime(snap.work.ended_at)}` : ''}`);
    run.appendChild(times);
    if (snap.work.retry_reason) run.appendChild(factBlock(C.gap.task.retryReason, snap.work.retry_reason));
    if (snap.contextBundle?.bundle) {
      run.appendChild(contextBlock(snap.contextBundle.bundle));
      const context = el('details', 'task-context');
      const bundle = snap.contextBundle.bundle;
      context.appendChild(el('summary', 'xs mut', C.gap.task.contextDetail));
      context.appendChild(el('div', 'xs mono mut', `${C.gap.task.prompt} · v${bundle.bundle_schema_version} · ${snap.contextBundle.content_digest.slice(0, 12)}`));
      context.appendChild(el('pre', 'task-prompt', bundle.prompt_snapshot ?? ''));
      if (bundle.prompt_snapshot_redacted) context.appendChild(el('div', 'xs mut2', C.gap.task.redactedSnapshot));
      run.appendChild(context);
    }
    const report = snap.result?.claims?.find((claim) => claim.kind === 'agent-report');
    if (report?.data?.text) {
      run.appendChild(factBlock(C.gap.task.result, report.data.text));
      if (report.data.redacted) run.appendChild(el('div', 'xs mut2', C.gap.task.redactedContent));
    }
    const changed = (snap.runEvidence ?? []).find((item) => item.kind === 'changed_files');
    if (changed) {
      const files = changed.details.files ?? [];
      const changedLabel = factBlock(`${C.gap.task.changedFiles} · Evidence ${changed.id.slice(0, 8)}`,
        files.length ? files.join('\n') : C.gap.task.noChanges);
      changedLabel.title = changed.id;
      run.appendChild(changedLabel);
    }
    const tests = (snap.runEvidence ?? []).filter((item) => item.kind === 'test_command');
    if (tests.length) {
      const block = el('div', 'task-run-fact');
      block.appendChild(el('div', 'xs mut2', C.gap.task.testEvidence));
      for (const item of tests) {
        const state = item.details.result_state === 'error' ? C.gap.task.evidenceError
          : item.details.result_state === 'returned'
            ? (item.details.exit_code == null ? C.gap.task.evidenceReturnedNoExit : C.gap.task.evidenceReturned)
            : C.gap.task.evidenceUnknown;
        const evidence = el('div', 'xs', `${item.summary} · ${state}${item.details.exit_code == null ? '' : ` · Exit code ${item.details.exit_code}`} · Evidence ${item.id.slice(0, 8)}`);
        evidence.title = item.id;
        block.appendChild(evidence);
        if (item.details.command_redacted || item.details.output_redacted) {
          block.appendChild(el('div', 'xs mut2', C.gap.task.redactedContent));
        }
      }
      run.appendChild(block);
    }
    if (snap.work.failure_reason) run.appendChild(factBlock(C.gap.task.failure, snap.work.failure_reason));
    if (snap.work.id !== latest.work.id || !snap.taskSpecCurrent) {
      const savedReviews = detail.reviews.filter((review) => review.work_id === snap.work.id);
      if (savedReviews.length) {
        const saved = el('div', 'task-run-fact');
        saved.appendChild(el('div', 'xs mut2', C.gap.task.savedReviews));
        for (const review of savedReviews) {
          const item = snap.contextBundle?.bundle?.items?.find((contextItem) =>
            contextItem.source_ref === `task:${task.id}:acceptance:${review.criterion_id}`);
          const text = item?.safe_content ?? `Criterion ${review.criterion_id}`;
          const references = (review.evidence_ids ?? []).map((id) => `Evidence ${id.slice(0, 8)}`).join(' · ');
          const line = el('div', 'xs', `${text} · ${review.verdict === 'pass' ? C.gap.task.pass : C.gap.task.fail}${references ? ` · ${references}` : ''}`);
          line.title = (review.evidence_ids ?? []).join('\n');
          saved.appendChild(line);
        }
        run.appendChild(saved);
      }
    }
    history.appendChild(run);
  }
  section.appendChild(history);
  return section;
}

function factBlock(label, value) {
  const block = el('div', 'task-run-fact');
  block.appendChild(el('div', 'xs mut2', label));
  block.appendChild(el('pre', 'task-run-value', value));
  return block;
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
   * key was never a duplicate of `guard.open`, it was a button no screen had built.
   * Permission is the decision, so that sentence sits with the button rather than only as a
   * presence caption. The label stays `work.open` — the test and the canon key are that word. */
  if (snap.status === 'permission_waiting') {
    body.appendChild(el('div', 'sm', C.gap.stage.permit));
  }
  const acts = el('div', 'row-acts');
  acts.appendChild(btn('btn sm pri', C.work.open, () => nav.toWork(snap)));
  body.appendChild(acts);
  body.appendChild(el('div', 'xs mut2', C.gap.board.oneRun));
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
  const orient = el('p', 'sm mut hist-orient', C.orient[r.orientation] ?? C.orient.idle);
  if ((r.orientation ?? 'idle') === 'idle') orient.classList.add('is-idle');
  rows.appendChild(orient);
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

  if (reason === 'task-run-retry-required') {
    const n = el('div', 'panel grey');
    n.setAttribute('data-el', 'task-retry-required');
    n.appendChild(el('div', 'sm t', C.gap.task.retryRequired));
    const retry = document.querySelector('.task-retry');
    if (retry) { retry.open = true; retry.scrollIntoView({ block: 'nearest' }); }
    return n;
  }

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
