const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { code } = require('./src');

let C, columnFor, tileTone;
test.before(async () => {
  ({ C } = await import('../app/renderer/copy.js'));
  ({ columnFor, tileTone } = await import('../app/renderer/board-column.mjs'));
});

// A small DOM surface exercises the real board renderers without launching Electron.
class Node {
  constructor(tag, cls = '', text = '') {
    this.tagName = tag; this.className = cls; this.textContent = text;
    this.children = []; this.attrs = {}; this.events = {};
    this.classList = { toggle: () => {} };
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  get childNodes() { return this.children; }
  set innerHTML(value) { this.children = []; this.textContent = value; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key]; }
}
const el = (tag, cls, text) => new Node(tag, cls, text);
const btn = (cls, text, click) => { const node = el('button', cls, text); node.events.click = click; return node; };
const find = (root, check) => [root, ...root.children.flatMap((node) => find(node, check))].filter(check);

function board(tasks, options = {}) {
  const columns = [['queued', C.gap.board.queued], ['doing', C.gap.historyRunning], ['needs', C.gap.board.needs],
    ['review', C.gap.board.review], ['done', C.gap.task.completeState]];
  const context = {
    C, columnFor, tileTone, el, btn, columns, currentTasks: tasks,
    state: { project: { id: 'project' }, boardView: 'list', ...options }, p: { id: 'project' },
    tasksLoaded: true, tasksLoading: false, tasksFailed: false, taskRefreshSequence: 0, taskLoadSequence: 0,
    taskRows: el('div'), viewBoard: btn(), viewList: btn(), filters: el('div'), overview: el('section'),
    overviewStatus: el('div'), overviewCounts: el('div'), completion: el('div'), dependencies: el('div'), colInspect: el('div'),
    countButtons: columns.map(([key]) => ({ key, count: el('strong'), button: btn() })),
    openComposer: () => {}, syncShell: () => {}, paintSelectedTask: async () => {}, paintLegacyUnknown: () => {},
    tileBits: () => ({ mark: '', status: 'state', reason: '' }), fillTile: () => {},
    outcomeKorean: (value) => value === 'complete' ? C.work.resultTitle.complete : null,
    shortWhen: (value) => value, runFace: (snap) => snap?.work ?? null,
    unlinkedTile: () => el('aside', 'unlinked'),
  };
  for (const key of ['all', 'needs', 'done']) {
    const filter = btn(); filter.setAttribute('data-filter', key); context.filters.appendChild(filter);
  }
  const source = code('app/renderer/screens/sc02.js');
  const draw = source.slice(source.indexOf('  const drawTaskList ='), source.indexOf('  const paintTaskList ='));
  const tile = source.slice(source.indexOf('  const taskTile ='), source.indexOf('  const unlinkedTile ='));
  const refresh = source.slice(source.indexOf('  async function refreshTasks()'), source.indexOf('  refreshTasks();'));
  vm.createContext(context);
  Object.assign(context, vm.runInContext(`${draw}\n${tile}\n${refresh}\n({ drawTaskList, refreshTasks })`, context));
  context.paintTaskList = () => context.drawTaskList();
  context.drawTaskList();
  return context;
}
const task = (id, status, run, verdict = 'unverified') => ({ id, goal: id, status, verdict, _run: run });
const tasks = () => [
  task('queued', 'open', null), task('live', 'in_progress', { status: 'running' }),
  task('permission', 'in_progress', { status: 'permission_waiting' }),
  task('unknown', 'complete', { status: 'ended', outcome: 'ended_unknown' }, 'pass'),
  task('agent-complete', 'in_progress', { status: 'ended', outcome: 'complete' }),
  task('confirmed', 'complete', { status: 'ended', outcome: 'complete' }, 'pass'),
];

test('summary counts all saved Tasks independent of filter and excludes an unlinked Run', () => {
  const screen = board(tasks(), { boardFilter: 'review', unlinkedLive: { status: 'running' } });
  assert.equal(screen.completion.textContent, C.gap.board.completion(1, 6));
  assert.deepEqual(screen.countButtons.map(({ count }) => count.textContent), ['1', '1', '2', '1', '1']);
  const table = find(screen.taskRows, (node) => node.tagName === 'table')[0];
  assert.equal(find(table, (node) => node.tagName === 'th' && node.scope === 'col').length, 4);
  assert.deepEqual(find(table, (node) => !!node.attrs['data-task-id']).map((node) => node.attrs['data-task-id']), ['agent-complete']);
  screen.state.boardFilter = 'needs'; screen.drawTaskList();
  assert.deepEqual(find(screen.taskRows, (node) => !!node.attrs['data-task-id']).map((node) => node.attrs['data-task-id']), ['permission', 'unknown']);
  assert.equal(screen.filters.children[1].attrs['aria-pressed'], 'true');
  screen.state.boardFilter = 'all'; screen.drawTaskList();
  assert.equal(screen.filters.children[0].attrs['aria-pressed'], 'true');
  assert.equal(screen.countButtons.some(({ button }) => button.attrs['aria-pressed'] === 'true'), false);
});

test('the semantic table uses the same Task selection and Inspector action', () => {
  const screen = board(tasks());
  const pick = find(screen.taskRows, (node) => node.attrs['data-task-id'] === 'agent-complete')[0];
  pick.events.click();
  assert.equal(screen.state.selectedTaskId, 'agent-complete');
  assert.equal(screen.state.inspectDismissed, false);
  assert.equal(screen.colInspect.scrollTop, 0);
  assert.equal(find(screen.taskRows, (node) => node.attrs['data-task-id'] === 'agent-complete')[0].attrs['aria-pressed'], 'true');
});

test('a filtered empty list does not tell a project with saved Tasks to create its first Task', () => {
  const screen = board([tasks()[0]], { boardFilter: 'done' });
  assert.equal(screen.completion.textContent, C.gap.board.completion(0, 1));
  assert.equal(find(screen.taskRows, (node) => node.attrs['data-el'] === 'board-start').length, 0);
  assert.equal(find(screen.taskRows, (node) => node.colSpan === 4)[0].textContent, C.gap.board.noMatching);
  const empty = board([]);
  assert.equal(empty.completion.textContent, C.gap.board.completion(0, 0));
  assert.equal(find(empty.taskRows, (node) => node.attrs['data-el'] === 'board-start').length, 1);
});

test('initial loading and failed Task detail reads never show invented zeroes or queued Tasks', async () => {
  const screen = board(tasks());
  screen.tasksLoaded = false; screen.tasksLoading = true; screen.drawTaskList();
  assert.equal(screen.overviewCounts.hidden, true);
  assert.equal(screen.completion.textContent, '');
  assert.equal(screen.overviewStatus.textContent, C.gap.board.loading);
  screen.api = { taskList: async () => ({ ok: true, tasks: [tasks()[0]] }), taskDetail: async () => ({ ok: false }) };
  await screen.refreshTasks();
  assert.equal(screen.overviewCounts.hidden, true);
  assert.equal(screen.overviewStatus.textContent, C.gap.board.loadFailed);
  assert.equal(find(screen.taskRows, (node) => node.tagName === 'table').length, 0);
  assert.equal(screen.taskRows.children[0].textContent, C.gap.board.reload);
});

test('selecting an Inspector while a Task refresh is in flight does not cancel the list read', async () => {
  const screen = board([]);
  let listReady;
  screen.api = { taskList: () => new Promise((resolve) => { listReady = resolve; }),
    taskDetail: async () => ({ ok: true, runs: [] }) };
  const pending = screen.refreshTasks();
  screen.taskLoadSequence += 1;
  listReady({ ok: true, tasks: [tasks()[0]] });
  await pending;
  assert.equal(screen.tasksLoading, false);
  assert.equal(screen.tasksFailed, false);
  assert.equal(screen.completion.textContent, C.gap.board.completion(0, 1));
});
