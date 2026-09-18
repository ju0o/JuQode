/* The e2e fixture: one seeded store, three projects, and a fake `claude` CLI.
 *
 * This was 280 lines at the top of `visual.mjs`. It moved here when a second driver needed the
 * same world — `scripts/record-demo.mjs`, which records the app being used. Copying it would
 * have meant two fixtures drifting apart, and the fixture is where every screen state this
 * product can reach is actually MADE: the permission denial, the failing session, the session
 * that ignores SIGTERM, the unsigned build. A second copy of that is a second product.
 *
 * Importing this module CREATES the world (temp dirs, files, a seeded database). That is what
 * it is for — there is no setup function to forget to call.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { ROOT } from './launch.mjs';

const require = createRequire(import.meta.url);

/* The app under test gets its OWN store, seeded with one project. Two reasons:
 *   1. a test must never touch the user's real juqode.db
 *   2. SC-02 is reachable without a native folder dialog, which cannot be driven headlessly */
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-e2e-'));
const DB = path.join(DB_DIR, 'juqode.db');
/* The app's WHOLE data directory, relocated for the test run.
 *
 * `JUQODE_DB` moved the store; the evidence stores are derived from `userData` and were not,
 * so every run left a bare git repository per project in the developer's own
 * `~/.config/juqode/evidence` — 201 of them had piled up before anyone counted. One variable
 * moves all of it, including the Chromium profile, so nothing this test does touches the real
 * application data. */
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-userdata-'));
const SEED = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-seed-')));

/* A small but REAL project, so the Brief has something it can actually confirm. It also
 * carries a `.env` and a `node_modules`, which must never be read: the exclusion list is
 * JuQode's own and does not depend on .gitignore (19 §C1 ④). */
fs.writeFileSync(path.join(SEED, 'package.json'), JSON.stringify({
  name: 'seed-app', main: 'src/index.js',
  /* `dev` STAYS UP. It was `vite`, which is not installed here and dies the instant it is
   * spawned, so 계속 실행 중 · 이미 켜져 있음 — two of TD-01's states — were unreachable and
   * nine td01 mutants survived in the branches that draw them. `build` is still `vite build`,
   * and it is what produces the FAILED state, so the fixture keeps both kinds of ending. */
  scripts: { dev: 'node -e "setInterval(() => {}, 1000)"', build: 'vite build', test: 'node --test' },
  dependencies: { vite: '^5.0.0' },
}, null, 2));
fs.writeFileSync(path.join(SEED, 'package-lock.json'), '{"lockfileVersion":3}');
fs.writeFileSync(path.join(SEED, 'README.md'), '# seed-app\n\n작은 예제 프로젝트예요.\n\n## 설치\n\nnpm i\n');
fs.writeFileSync(path.join(SEED, '.env'), 'SECRET_TOKEN=juqode-synthetic-fixture-marker\n');
for (const d of ['src', 'lib', 'node_modules']) fs.mkdirSync(path.join(SEED, d));
fs.writeFileSync(path.join(SEED, 'src', 'index.js'), 'export const hi = 1;\n');
fs.writeFileSync(path.join(SEED, 'node_modules', 'huge.js'), 'x'.repeat(1000));
/* A real git repo, because that is what a real project is — and it is the ONLY basis kind that
 * produces a diff (`git_tree`; the non-Git manifest basis compares hashes and has no patch to
 * read). Without this SC-04 could only ever be exercised in its 변경 없음 state. */
{
  const g = (...a) => execFileSync('git', a, { cwd: SEED, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'fixture@example.test');
  g('config', 'user.name', 'fixture');
  fs.writeFileSync(path.join(SEED, '.gitignore'), 'node_modules/\n.env\n');
  g('add', '-A');
  g('commit', '-qm', 'seed');
}

/* A fixture CLI, not the host's. Without this the WBS-09 assertions test a different code
 * path on every machine — and on a host with no Claude Code they pass carrying no information. */
/* WBS-33 · two synthetic PE files, so the unsigned-build notice can be photographed.
 *
 * A source run is never `app.isPackaged`, so the notice is unreachable here without pointing
 * the main process at a file. It reads the certificate table of whatever it is given, so these
 * fixtures exercise the real parser — the screenshot below is of bytes being read, not of a
 * hard-coded string. Structure only: a DOS stub, a PE signature, a PE32+ optional header, and
 * data directory entry 4, whose SIZE field is the whole question. */
function fixturePe(certSize) {
  const b = Buffer.alloc(0x400);
  b.write('MZ', 0);
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x00004550, 0x80);          // 'PE\0\0'
  b.writeUInt16LE(0x20b, 0x80 + 24);          // PE32+
  const dir4 = 0x80 + 24 + 112 + 4 * 8;
  b.writeUInt32LE(0x9000, dir4);              // RVA
  b.writeUInt32LE(certSize, dir4 + 4);        // SIZE — 0 means no signature at all
  return b;
}
const PE_UNSIGNED = path.join(DB_DIR, 'unsigned.exe');
const PE_SIGNED   = path.join(DB_DIR, 'has-cert.exe');
fs.writeFileSync(PE_UNSIGNED, fixturePe(0));
fs.writeFileSync(PE_SIGNED, fixturePe(0x1a20));

const FAKE_CLI = path.join(DB_DIR, 'claude');
/* The same fixture also serves the Work loop: asked to run a session it emits a stream that
 * ends in a permission REFUSAL, which is the D-133 state the screen has to render. */
const FAKE_CLI_JS = path.join(DB_DIR, 'claude-session.js');
fs.writeFileSync(FAKE_CLI_JS, `
const fs = require('fs');
/* On the RESUME the grant exists, so the Edit goes through and the Work ends — which is what
 * D-133's contract B describes and what gives SC-04 a finished Work to read. A fixture that
 * denied forever could only ever exercise the refusal card. */
const ARGV_LOG = ${JSON.stringify(path.join(DB_DIR, 'ARGV.log'))};
try {
  fs.mkdirSync(require('path').dirname(ARGV_LOG), { recursive: true });
  fs.appendFileSync(ARGV_LOG, process.argv.slice(2).join(' ') + '\\n');
} catch { /* the log is evidence for the test, never a reason for the fixture to die */ }
const resumed = process.argv.includes('--resume');
/* The EXPLANATION pass (WBS-26) is distinguishable from a Work turn by the tool restriction it
 * carries: \`--tools ""\` empties the built-in tool set. Answering it with real groups is what
 * gives SC-04's explained state — the JUQODE chip, 무엇/왜/어떤 동작에, the confidence chip and
 * \`readerFor\`'s persisted-groups branch — its first execution anywhere in the suite. */
const restricted = process.argv.includes('--tools');
/* TWO read-only passes now carry that flag — WBS-26's change explanation and WBS-04's Brief
 * narrative — so the fixture tells them apart by what they ASK, which is the only thing that
 * actually differs. Reading the prompt is also how a real CLI would decide. */
/* stdin is a PIPE, and a sync read of a pipe can raise EAGAIN before the parent has written —
 * measured as a silent empty read, which sent the narrative pass down the explanation branch
 * and made the whole WBS-04 e2e assert nothing. Loop until EOF instead. */
function readPrompt() {
  const buf = Buffer.alloc(65536);
  let out = '';
  for (let tries = 0; tries < 2000; tries++) {
    let n = 0;
    try { n = fs.readSync(0, buf, 0, buf.length, null); }
    catch (e) {
      if (e.code === 'EAGAIN') { try { fs.writeSync(2, ''); } catch {} continue; }
      if (e.code === 'EOF') break;
      break;
    }
    if (n === 0) break;
    out += buf.slice(0, n).toString('utf8');
  }
  return out;
}
let ask = '';
try { ask = readPrompt(); } catch { /* no stdin: not a pass */ }

if (restricted && ask.includes('q=1')) {
  /* The narrative pass (WBS-04). Canon 19 C1: it may cite only files the scan actually read, so
   * the fixture cites the README — which the scan does read — and one path nobody read. The
   * second one must be filtered out, and its answer must land on 확인 못함 rather than 예상됨. */
  const six = [
    { q: 1, text: '할 일을 적는 작은 앱이에요', cites: ['README.md'] },
    { q: 2, text: '추가 · 삭제 · 목록 보기', cites: ['README.md'] },
    { q: 4, text: 'src 에 소스가 있어요', cites: ['nobody-read-this.ts'] },
  ];
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'n', cwd: '/p' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
    permission_denials: [], result: JSON.stringify(six) }) + '\\n');
  process.exit(0);
}

if (restricted) {
  /* TWO groups, one file each. SC-04 is a screen for CHOOSING a group — selecting one, opening
   * its raw, scoping to a block — and with a single group none of that could ever run: every
   * multi-group branch sat behind a length check and three mutants lived there because the
   * branch was never entered. A reader with one group cannot test a reader.
   * (No backticks in here: this comment lives inside a template literal.) */
  const groups = [{ title: '실행 안내를 README 에 넣었어요',
                    what: 'README 에 실행 방법을 적었어요',
                    why: '프로젝트를 처음 여는 사람이 실행 방법을 찾을 수 있게',
                    affects: '문서',
                    confidence: 'confirmed',
                    files: ['README.md'] },
                  { title: '인사말 함수를 추가했어요',
                    what: 'src/index.js 에 greet 함수를 넣었어요',
                    why: '이름을 받아 인사말을 만드는 자리가 필요해서',
                    affects: '인사말 함수',
                    confidence: 'confirmed',
                    files: ['src/index.js'] }];
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x', cwd: '/p' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
    permission_denials: [], result: JSON.stringify(groups) }) + '\\n');
  process.exit(0);
}
/* The fixture EDITS the project on the GRANTED turn — the Edit it was denied is the Edit it
 * then performs. A Work that changed nothing could only ever show SC-04's 변경 없음 state.
 * One .js file (S1 — real declarations) and one .md file (S2 — \`19\` §C5-B sends structured
 * formats straight to Raw), so both strategies get rendered evidence. */
if (resumed) {
  fs.writeFileSync(${JSON.stringify(path.join(SEED, 'src', 'index.js'))},
    'export const hi = 1;\\n\\nexport function greet(name) {\\n  return "hi " + name;\\n}\\n');
  fs.writeFileSync(${JSON.stringify(path.join(SEED, 'README.md'))},
    '# seed-app\\n\\n작은 예제 프로젝트예요.\\n\\n## 설치\\n\\nnpm i\\n\\n## 실행\\n\\nnpm run dev\\n');
  /* …and it touches the gitignored, JuQode-excluded .env. Canon 19 SS-E: that change is NOT in
   * the diff by design, and the product still has to SAY it happened — from the ledger, as a
   * path and nothing more. This gives the evidence-gap card its first rendered evidence. */
  /* ONCE, on the first granted turn only. The card must also be ABSENT for a Work that touched
   * no excluded path, and while every Work in the run wrote this file there was no such Work to
   * look at — so the absent half of D-126a could not be checked at all. */
  const envOnce = ${JSON.stringify(path.join(SEED, '.env-touched'))};
  if (!fs.existsSync(envOnce)) {
    fs.writeFileSync(${JSON.stringify(path.join(SEED, '.env'))},
      'SECRET_TOKEN=juqode-synthetic-fixture-marker-CHANGED\\n');
    fs.writeFileSync(envOnce, '1');
  } else {
    /* a NORMAL edit, so this Work still has changes to read — just no excluded one */
    fs.writeFileSync(${JSON.stringify(path.join(SEED, 'src', 'later.js'))},
      'export const later = true;\\n');
  }
}
const out = resumed ? [
  { type: 'system', subtype: 'init', session_id: 's', cwd: '/p', claude_code_version: '9.9.9' },
  /* TWO tool_use blocks in ONE message, and two tool_results in one reply — a parallel call,
   * which is what the real CLI emits when it edits two files at once. This is the shape that
   * made the 확인됨 tool count report 1 for 2 (batch 18 QA); without it in the recording the
   * cross-check below cannot tell the bug from the fix. */
  { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'tu_2', name: 'Edit', input: { file_path: 'README.md' } },
    { type: 'tool_use', id: 'tu_3', name: 'Edit', input: { file_path: 'src/index.js' } }] } },
  { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'tu_2', is_error: false },
    { type: 'tool_result', tool_use_id: 'tu_3', is_error: false }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'README.md 와 src/index.js 를 고쳤어요', permission_denials: [] },
] : [
  { type: 'system', subtype: 'init', session_id: 's', cwd: '/p', claude_code_version: '9.9.9' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_a', name: 'Read', input: { file_path: 'README.md' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_a', is_error: false }] } },
  { type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 'tu_1',
    message: 'Claude requested permissions to write to README.md, but you have not granted it yet.' },
  { type: 'result', subtype: 'success', is_error: false, result: '권한이 없어 바꾸지 못했어요',
    permission_denials: [{ tool_name: 'Edit', tool_use_id: 'tu_1', tool_input: { file_path: 'README.md' } }] },
];
for (const e of out) process.stdout.write(JSON.stringify(e) + '\\n');
`);
fs.writeFileSync(FAKE_CLI, [
  '#!/bin/sh',
  "if [ \"$1\" = \"--version\" ]; then echo '9.9.9-fixture (Claude Code)'; exit 0; fi",
  /* A marker file flips the fixture to logged-out, so the e2e can reach `15`'s
   * Claude-unavailable state — the one `12` §16 calls 사용 불가 ≠ 실패 — with the real
   * detection code path rather than a stub. `detect()` runs on every preflight, no cache. */
  `if [ \"$1\" = \"auth\" ]; then if [ -f ${JSON.stringify(path.join(DB_DIR, 'logged-out'))} ]; then echo '{\"loggedIn\":false}'; else echo '{\"loggedIn\":true,\"email\":\"fixture@example.test\",\"orgId\":\"org-fixture\"}'; fi; exit 0; fi`,
  /* A second marker makes the fixture a session that STARTS and then goes quiet, ignoring
   * SIGTERM — the shape `15` SC-03's 취소 요청했어요 and `07` §8.1's "a cancelled child can
   * still exit 0" are both about. Without it the run could only ever photograph a Work that
   * finished on its own. */
  /* A third marker makes the session FAIL — `error_max_turns`, which `19` §C3-L names and
   * which `07` §8.1 is about: the exit code is 0 and `is_error` is false, so the failure can
   * only be read from the terminal reason. It is also the ONLY red on SC-03, and the colour
   * grammar had no rendered evidence for it. */
  `if [ -f ${JSON.stringify(path.join(DB_DIR, 'failing'))} ]; then`,
  `  echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p","claude_code_version":"9.9.9"}'`,
  `  echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_f","name":"Read","input":{"file_path":"README.md"}}]}}'`,
  `  echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_f","is_error":false}]}}'`,
  `  echo '{"type":"result","subtype":"error_max_turns","is_error":false,"terminal_reason":"max_turns","result":"더 진행하지 못했어요","permission_denials":[]}'`,
  '  exit 0',
  'fi',
  /* A fourth marker: the CLI **dies before saying anything**. `15` SC-02 시작 실패 is the state
   * where no Work row exists at all — the supervisor never got an event to open one — and it
   * had never been rendered. stderr and a non-zero code, which is what a broken install looks
   * like. */
  `if [ -f ${JSON.stringify(path.join(DB_DIR, 'startfail'))} ]; then`,
  `  echo 'juqode-fixture: exited before emitting anything' 1>&2`,
  '  exit 9',
  'fi',
  `if [ -f ${JSON.stringify(path.join(DB_DIR, 'stubborn'))} ]; then`,
  '  trap "" TERM',
  `  echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p","claude_code_version":"9.9.9"}'`,
  '  sleep 60',
  '  exit 0',
  'fi',
  /* "$@" — the fixture has to SEE `--resume`, or it cannot behave like a session that was
   * granted something. Without it every turn replayed the same denial. */
  `exec ${process.execPath} ${FAKE_CLI_JS} "$@"`,
].join('\n') + '\n', { mode: 0o755 });
/* TWO projects, SEED opened first so SEED2 is the newer one. That makes "did the recent list
 * get re-read?" answerable: the list starts SEED2-first, the run opens SEED, and on return
 * SEED must be on top. A count alone cannot tell a re-read from a stale DOM. */
const SEED2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-seed2-')));
/* A third project whose History FITS. The fixture comment below says the control and its
 * absence are both rules — only the first was ever built, and `hidden > 0` could be widened to
 * `hidden >= 0` with nothing noticing. Every project in this run ends up with four or more
 * Works, so the short list has to be seeded on purpose. */
const SEED3 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-seed3-')));
{
  const { openDb } = require(path.join(ROOT, 'app/main/db/db.js'));
  const repo = require(path.join(ROOT, 'app/main/db/repo.js'));
  const db = openDb(DB);
  /* SEED3 FIRST, so it sits at the BOTTOM of the last-opened list and the order the rest of
   * this run reads is exactly what it was before this project existed. */
  const p3 = repo.openProject(db, SEED3, path.basename(SEED3));
  {
    const t0 = Date.now(); while (Date.now() === t0) { /* distinct millisecond */ }
  }
  repo.openProject(db, SEED, path.basename(SEED));
  const t = Date.now(); while (Date.now() === t) { /* distinct millisecond */ }
  const p2 = repo.openProject(db, SEED2, path.basename(SEED2));
  /* Four ended Works in the OTHER project, so `15` §0 Board's History fold (M → L, `N개 더`)
   * has something to fold. The run's own Works all land in SEED and there are never enough of
   * them; the control and its absence are both rules, and only a longer list exercises the
   * first one. Ended, so nothing here is a live Work competing for the D-117 slot. */
  for (const intent of ['첫 번째 요청', '두 번째 요청', '세 번째 요청', '네 번째 요청']) {
    const w = repo.beginWork(db, p2.id, intent).work;
    repo.setWorkState(db, w.id, { status: 'ended', outcome: 'complete' });
  }
  /* TWO Works — fewer than the head of three, so this project's History has nothing hidden and
   * the `N개 더` control must not be drawn at all. */
  for (const intent of ['짧은 요청 하나', '짧은 요청 둘']) {
    const w = repo.beginWork(db, p3.id, intent).work;
    repo.setWorkState(db, w.id, { status: 'ended', outcome: 'complete' });
  }
  db.close();
}

export { DB_DIR, DB, USER_DATA, SEED, SEED2, SEED3, PE_UNSIGNED, PE_SIGNED, FAKE_CLI };
