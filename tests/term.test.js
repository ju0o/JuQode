/* WBS-25 · TD-01 의 셸 명령줄 — DV-11 판정(파이프 셸 · PM 2026-09-10) 뒤의 구현 검사.
 *
 * DV-11-PIPE-SHELL-SPIKE.md 는 스파이크 스크립트로 잰 것이고, 이 파일은 **제품 코드**가 같은
 * 것을 하는지 본다. 스파이크가 잰 값 중 이 구현이 지켜야 하는 것은 둘이다:
 *
 *   · `cd` 가 다음 줄로 **이어진다** (스파이크의 `LOST` 는 줄마다 새 셸일 때의 값이다).
 *     동반 조건 ④ 이고, 셸이 하나라는 사실이 그것을 만든다.
 *   · 종료 코드가 **코드로** 보고된다 — `19` §C4: 종료 코드·stderr 숨기지 않음.
 *
 * 그리고 이 파일이 지키는 계약 하나: **이 줄은 사용자가 사용자로 실행하는 것이고, 제품은
 * 걸러내는 척하지 않는다**(`19` §C4). 그래서 "위험한 명령을 막았다" 는 단언은 여기 없다.
 * 있으면 안 된다 — 그것을 주장하는 순간 막지 못한 것이 안전하다고 가르치게 된다.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const term = require(path.join(R, 'app/main/term/session.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

/** 한 줄을 보내고 그 줄이 끝날 때까지 기다린다 — 끝은 종료 코드가 도착하는 것이다. */
function line(s, text, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`the line never ended: ${text}`)), timeout);
    let last = null;
    const off = s.watch((u) => {
      last = u;
      if (u.code === null || u.code === undefined) return;
      clearTimeout(t); off(); resolve(u);
    });
    const started = s.write(text);
    if (!started.ok) { clearTimeout(t); off(); resolve({ refused: started.reason, ...(last ?? {}) }); }
  });
}

/** `open()` with a listener that can be swapped per line. */
function session(cwd) {
  const listeners = new Set();
  const s = term.open({ cwd, onUpdate: (u) => { for (const fn of [...listeners]) fn(u); } });
  s.watch = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  return s;
}

test('한 셸이므로 cd 가 다음 줄로 이어진다 — 스파이크의 LOST 를 뒤집는 조건 ④', async () => {
  const root = tempDir('juqode-term-cd');
  fs.mkdirSync(path.join(root, 'sub'));
  const s = session(root);
  try {
    const a = await line(s, 'pwd');
    assert.strictEqual(a.code, 0, `pwd exited ${a.code}`);
    assert.ok(a.output.includes(fs.realpathSync(root)), `pwd said ${a.output}`);
    await line(s, 'cd sub');
    const b = await line(s, 'pwd');
    assert.ok(b.output.includes(path.join(fs.realpathSync(root), 'sub')),
      `cd did not carry to the next line: ${b.output}`);
  } finally { s.stop(); }
});

test('종료 코드는 코드로 보고된다 — 0 도 0 이 아닌 것도', async () => {
  const s = session(tempDir('juqode-term-code'));
  try {
    assert.strictEqual((await line(s, 'true')).code, 0);
    /* 서브셸이다: `exit 3` 을 그냥 치면 세션 자체가 끝난다 — 사용자가 그렇게 칠 수도 있고,
     * 그때 세션이 끝나는 것은 셸의 정상 동작이다. 여기서 보려는 것은 코드 전달이다. */
    const bad = await line(s, '(exit 3)');
    assert.strictEqual(bad.code, 3, `the exit code was reported as ${bad.code}`);
  } finally { s.stop(); }
});

test('끝난 줄도 자기가 어느 명령이었는지 말한다', async () => {
  /* 마지막 업데이트는 `running` 이 이미 비워진 뒤에 나간다. 그때 줄 이름을 잃으면 카드가
   * **읽을 것이 생긴 바로 그 순간** `$ …` 머리를 잃는다. */
  const s = session(tempDir('juqode-term-line'));
  try {
    const r = await line(s, 'echo hi');
    assert.strictEqual(r.line, 'echo hi', `the finished update names ${r.line}`);
  } finally { s.stop(); }
});

test('stderr 는 숨기지도 분리하지도 않는다', async () => {
  const s = session(tempDir('juqode-term-stderr'));
  try {
    const r = await line(s, 'echo out; echo err 1>&2');
    assert.ok(r.output.includes('err'), `stderr is missing: ${r.output}`);
    assert.ok(r.output.includes('out'), `stdout is missing: ${r.output}`);
  } finally { s.stop(); }
});

test('마커는 프로토콜이지 출력이 아니다 — 화면에 나가지 않는다', async () => {
  const s = session(tempDir('juqode-term-mark'));
  try {
    const r = await line(s, 'echo hello');
    assert.ok(r.output.includes('hello'));
    assert.ok(!/__JUQODE_TERM_/.test(r.output), `the marker reached the screen: ${r.output}`);
  } finally { s.stop(); }
});

test('토큰처럼 보이는 값은 화면에서 가려진다 — 가려질 뿐이고, 그렇다고만 말한다', async () => {
  const s = session(tempDir('juqode-term-mask'));
  try {
    /* 합성 값이다. 실제 자격증명이 아니다. */
    const r = await line(s, 'echo ghp_synthetic0123456789abcdefghijklmno');
    assert.ok(r.output.includes('***'), `the token-shaped run was printed as-is: ${r.output}`);
    assert.ok(!r.output.includes('ghp_synthetic0123456789abcdefghijklmno'));
  } finally { s.stop(); }
});

test('한 번에 한 줄 — 앞 줄이 도는 동안의 줄은 거절하고 이유를 말한다', async () => {
  const s = session(tempDir('juqode-term-busy'));
  try {
    s.write('sleep 1');
    const second = s.write('echo late');
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.reason, 'busy');
    assert.strictEqual(s.busy(), true);
  } finally { s.stop(); }
});

test('빈 줄은 셸에 가지 않는다', () => {
  const s = session(tempDir('juqode-term-empty'));
  try {
    assert.strictEqual(s.write('   ').ok, false);
    assert.strictEqual(s.write('   ').reason, 'empty');
  } finally { s.stop(); }
});

test('stop() 은 세션을 끝낸다 — 작업 제어가 없으니 이것이 정직한 범위다', async () => {
  const s = session(tempDir('juqode-term-stop'));
  s.write('sleep 30');
  s.stop();
  const end = await s.done;
  assert.strictEqual(end.ended, true);
  assert.ok(/signalled|exit:/.test(end.why), `the session ended as ${end.why}`);
  assert.strictEqual(s.write('echo after').ok, false, 'a closed session still accepted a line');
});

test('한계는 지어낸 문장이 아니라 이 구현이 실제로 가진 것이다 (동반 조건 ①②③)', () => {
  const s = session(tempDir('juqode-term-limits'));
  try {
    const l = s.limits;
    /* 스파이크가 잰 그대로: TTY 없음 · 색 없음 · 순서 근사 · 작업 제어 없음. 화면이 이 네
     * 가지를 말할 수 있으려면 먼저 코드가 그것을 사실로 들고 있어야 한다. */
    assert.strictEqual(l.tty, false);
    assert.strictEqual(l.colour, false);
    assert.strictEqual(l.orderApproximate, true);
    assert.strictEqual(l.jobControl, false);
    assert.ok(l.shell, 'the card cannot say WHICH shell it is');
  } finally { s.stop(); }
});

test('아는 POSIX 셸이면 그것을, 모르면 /bin/sh — 마커가 조용히 깨지지 않게', () => {
  assert.deepStrictEqual(term.shellFor({ SHELL: '/bin/bash' }), { path: '/bin/bash', posix: true });
  assert.deepStrictEqual(term.shellFor({ SHELL: '/usr/bin/zsh' }), { path: '/usr/bin/zsh', posix: true });
  /* fish 와 nu 는 `$?` 도 `printf` 도 다르게 쓴다. 사용자의 SHELL 을 그대로 믿으면 종료 코드가
   * 영영 도착하지 않는다 — 조용히 멈춘 것처럼 보인다. */
  assert.deepStrictEqual(term.shellFor({ SHELL: '/usr/bin/fish' }), { path: '/bin/sh', posix: true });
  assert.deepStrictEqual(term.shellFor({}), { path: '/bin/sh', posix: true });
});

test('프로젝트가 바뀌면 셸은 끝난다 — 다음에 열 때가 아니라 바뀔 때 (`19` §C6 REC-010)', async () => {
  /* A 에서 `cd` 해 둔 셸이 B 의 명령을 받으면, 사용자가 보고 있는 프로젝트와 명령이 도는
   * 디렉터리가 다르다. 배치 12 의 Quick Command 카드와 같은 결함이고, 뒤에 셸이 있다.
   * 그리고 "셸을 다시 열 때 검사" 로는 부족하다 — 그 사이 A 의 셸은 계속 살아 있고 화면에는
   * 그것을 끌 방법이 없다. */
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const { openDb } = require(path.join(R, 'app/main/db/db.js'));
  const repo = require(path.join(R, 'app/main/db/repo.js'));
  const db = openDb(':memory:');
  const a = repo.openProject(db, tempDir('juqode-term-a'), 'a');
  const b = repo.openProject(db, tempDir('juqode-term-b'), 'b');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x', push: () => {} });
  try {
    const opened = await h['juqode:term-open'](null, a.id);
    assert.strictEqual(opened.ok, true, `the shell did not open: ${opened.reason}`);
    /* 같은 프로젝트를 다시 열면 **같은 세션**이다 — 서랍을 닫았다 여는 것으로 맥락이 사라지지
     * 않는다는 것이 REC-010 의 다른 절반이다. */
    assert.strictEqual((await h['juqode:term-open'](null, a.id)).id, opened.id,
      'reopening the drawer started a second shell');
    /* 프로젝트를 여는 것만으로 끝난다 — 셸을 다시 열어 달라고 하지 않았는데도. */
    const moved = h['juqode:open-path'](null, db.prepare('select path from project where id = ?').get(b.id).path);
    assert.strictEqual(moved.ok, true, `opening the other project failed: ${moved.reason}`);
    assert.strictEqual((await h['juqode:term-write'](null, a.id, 'echo x')).reason, 'not-open',
      "project A's shell outlived the switch");
  } finally {
    h.__stopAllTerm?.();
    db.close();
  }
});

test('사용자가 친 줄은 그대로 간다 — 걸러내는 척하지 않는다 (`19` §C4)', () => {
  /* CODE, not the comments: this file EXPLAINS that sudo cannot be answered here, and a
   * substring check over the raw text would read its own explanation as a filter. */
  const src = require(path.join(__dirname, 'src.js')).code('app/main/term/session.js');
  /* 이 검사는 무엇이 있는지가 아니라 **무엇이 없어야 하는지**를 본다. 차단 목록이 생기는 순간
   * 제품은 "위험한 것은 막았다" 고 말하게 되고, `19` §C4 가 금지하는 것이 정확히 그것이다.
   * 필요한 것은 필터가 아니라 배너다 — 그것은 이미 닫을 수 없는 한 줄로 있다. */
  for (const forbidden of ['rm -rf', 'sudo', 'BLOCKLIST', 'DANGEROUS', 'denylist']) {
    assert.ok(!src.includes(forbidden),
      `the terminal line has grown a filter (${forbidden}) — 19 §C4 forbids the pretence`);
  }
});
