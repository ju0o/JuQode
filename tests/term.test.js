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

test('출력 상한은 상한을 넘을 때만 잘렸다고 말한다 — 딱 맞게 찬 출력은 잘린 것이 아니다', async () => {
  /* `20` 이 화면에 실을 출력을 64 KB 로 묶고, 남는 것은 잘렸다고 말한다. 그 경계에서 한 칸을
   * 잘못 잡으면 제품이 **잃은 것이 없는데 잃었다고 말한다** — `19` 가 금지하는 과잉주장의
   * 축소판이다.
   *
   * FOUND BY MUTATION: `bytes + size > OUTPUT_LIMIT` 를 `>=` 로 넓히면 정확히 가득 찬 출력이
   * `truncated` 로 표시된다. 스위트에 절단 검사가 **하나도 없었다** — 넘친 쪽도, 딱 맞는 쪽도.
   *
   * 마커 줄은 측정 전에 지워지지만 그 앞뒤 줄바꿈 둘은 남는다. 그래서 내용은 상한에서 2 를
   * 뺀 만큼 찍고, 합이 정확히 상한이 되게 한다. */
  const { OUTPUT_LIMIT } = require(path.join(R, 'app/main/qc/run.js'));
  const s = session(tempDir('juqode-term-bound'));
  try {
    const exact = await line(s, `head -c ${OUTPUT_LIMIT - 2} /dev/zero | tr '\\0' x`, 20000);
    assert.strictEqual(Buffer.byteLength(exact.output, 'utf8'), OUTPUT_LIMIT,
      'the fixture did not fill the head exactly — the boundary is not being tested');
    assert.strictEqual(exact.truncated, false,
      'an output that fits exactly was reported as cut — nothing was lost');

    const over = await line(s, `head -c ${OUTPUT_LIMIT} /dev/zero | tr '\\0' x`, 20000);
    assert.strictEqual(over.truncated, true, 'an output past the head was not reported as cut');
    /* 남는 것은 진짜 앞부분이다 — `qc/run.js` 의 같은 규칙. */
    assert.strictEqual(Buffer.byteLength(over.output, 'utf8'), OUTPUT_LIMIT,
      'the kept head is not exactly the bound');
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

test('없는 셸은 세션이 아니다 — pid 없이 열렸다고 하지 않는다', async () => {
  /* `15` TD-01 Unavailable State 는 **셸이 시작되지 않은** 상태다. 그 상태가 카드로만 존재하고
   * 도달할 수 없으면, 그 카드가 옳은지 아무도 모른다. `JUQODE_TERM_SHELL` 이 그리로 가는
   * 유일한 길이다 — 이 앱이 도는 기계에는 셸이 있기 때문이다.
   *
   * 없는 프로그램의 spawn 실패는 `error` 이벤트로 **비동기**로 오지만, pid 가 없다는 것은
   * 그 자리에서 안다. 그래서 호출자가 "열지 못했어요" 라고 답할 수 있다 — 치는 줄마다 조용히
   * 삼키는 죽은 세션을 돌려주는 대신에. */
  const s = term.open({ cwd: tempDir('juqode-term-noshell'),
                        env: { ...process.env, JUQODE_TERM_SHELL: '/nonexistent/juqode-shell' } });
  assert.strictEqual(s.pid, null, 'a shell that does not exist reported a pid');
  const end = await s.done;
  assert.strictEqual(end.why, 'spawn-failed', `the session ended as ${end.why}`);
});

test('열지 못한 셸은 `열렸다`로 답하지 않는다 (ipc)', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const { openDb } = require(path.join(R, 'app/main/db/db.js'));
  const repo = require(path.join(R, 'app/main/db/repo.js'));
  const db = openDb(':memory:');
  const p = repo.openProject(db, tempDir('juqode-term-fail'), 'f');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x', push: () => {} });
  const saved = process.env.JUQODE_TERM_SHELL;
  process.env.JUQODE_TERM_SHELL = '/nonexistent/juqode-shell';
  try {
    const r = await h['juqode:term-open'](null, p.id);
    assert.strictEqual(r.ok, false, 'a shell that never started was reported as open');
    assert.strictEqual(r.reason, 'spawn-failed', `the reason is ${r.reason}`);
    /* …그리고 붙들고 있지 않는다: 다음 열기가 죽은 세션을 돌려받으면 안 된다. */
    assert.strictEqual((await h['juqode:term-write'](null, p.id, 'echo x')).reason, 'not-open',
      'the failed session is still being held');
  } finally {
    if (saved === undefined) delete process.env.JUQODE_TERM_SHELL; else process.env.JUQODE_TERM_SHELL = saved;
    h.__stopAllTerm?.();
    db.close();
  }
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

test('WBS-25b · 경고는 경고일 뿐 — 일치한 줄도 글자 하나 안 바뀌고 그대로 실행된다', async () => {
  /* `./tty.js` 는 프로그램 이름 목록을 갖고 있고, 그 목록이 언젠가 차단 목록이 되는 것이
   * 위 검사가 막으려는 것이다. 위 검사는 그 이름들이 셸 파일에 없다는 것만 볼 수 있으므로,
   * 아무것도 막히지 않는다는 것은 **행동으로** 측정한다: 일치하는 줄을 보내고, 셸이 실제로
   * 그 줄을 실행했는지 본다. 이것이 깨지면 제품은 걸러내기 시작한 것이다. */
  const { needsTty } = require(path.join(R, 'app/main/term/tty.js'));
  /* 이 줄은 `needsTty` 가 참이라고 답하는 모양이면서, 실제로는 TTY 를 쓰지 않는다 —
   * 목록에 든 프로그램을 정말로 부르면 검사가 환경에 따라 달라진다. */
  const line = 'git push --help-does-not-exist 2>/dev/null; echo RAN_ANYWAY';
  assert.strictEqual(needsTty(line), true, '이 줄이 경고 대상이 아니면 검사가 아무것도 안 한다');

  const s = session(tempDir('juqode-term-warn'));
  try {
    const w = s.write(line);
    assert.strictEqual(w.ok, true, '경고 대상인 줄이 거절되었다 — 그것은 차단이다');
    assert.strictEqual(w.line, line, '보낸 줄이 바뀌었다 — 그것은 필터다');
    assert.strictEqual(w.warn, 'no-tty', '경고가 붙지 않았다');
    /* 그리고 셸이 그 줄을 정말로 실행했는지 — 반환값만 보면 쓰는 시늉도 통과한다. */
    const ran = await new Promise((resolve) => {
      const off = s.watch((u) => { if (u.code != null) { off(); resolve(u); } });
    });
    assert.match(ran.output ?? '', /RAN_ANYWAY/, '줄이 셸에서 실제로 실행되지 않았다');
  } finally { s.stop(); }
});

test('WBS-25b · 목록에 없는 줄에는 경고가 붙지 않는다', () => {
  const s = session(tempDir('juqode-term-nowarn'));
  try { assert.strictEqual(s.write('echo hi').warn, null); } finally { s.stop(); }
});
