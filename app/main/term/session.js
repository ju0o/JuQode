'use strict';
/* WBS-25 · TD-01 의 셸 명령줄 — DV-11 판정: **파이프 셸** (PM · 2026-09-10).
 *
 * `15` TD-01 의 Primary Action 은 "type a command" 이고, `19` §C4 가 그 범위를 못박는다:
 * **사용자가 사용자로 실행한다. 걸러내는 척하지 않는다.** 이 파일은 그 줄을 실행하는 곳이고,
 * 따라서 이 저장소에서 유일하게 셸이 있는 자리다. Quick Command(`../qc/run.js`)는 정반대의
 * 계약을 지킨다 — argv 고정, 셸 없음. 둘을 한 파일에 두지 않는 이유가 그것이다.
 *
 * ── 파이프 셸이 무엇이 아닌지 (DV-11-PIPE-SHELL-SPIKE.md 실측) ──
 *
 * 제어 터미널이 없다. 그래서:
 *   · `sudo` · `ssh` · git 자격증명 프롬프트는 `/dev/tty` 를 직접 여는데 그것이 없다 —
 *     **물어보지도 못하고 실패한다.** 정지가 아니라 조용한 실패다.
 *   · 색이 없고(`isatty` 가 거짓), stdout/stderr 는 파이프 둘이라 **실제 순서로 합쳐지지
 *     않는다.** 아래 `take()` 가 도착 순서로 잇는다 — 근사치이고, 근사치라고 말해야 한다.
 *   · 작업 제어가 없다. 포그라운드 자식은 셸과 같은 프로세스 그룹에 있으므로 **명령 하나만
 *     끊을 수 없다.** `stop()` 은 세션을 끝낸다 — 화면이 그렇게 말해야 한다.
 *
 * 이 네 가지는 결함이 아니라 선택의 값이고, DV-11 판정의 동반 조건 ①②③ 이 "제품이 화면에서
 * 말한다" 를 요구한다. 여기서 하는 일은 그 사실들을 **호출자가 말할 수 있는 형태로** 내보내는
 * 것이다: `limits` 가 그것이고, 지어낸 문장이 아니라 이 구현이 실제로 가진 한계다.
 *
 * ── 동반 조건 ④ · 줄 사이 상태 ──
 *
 * 줄마다 프로세스를 띄우면 `cd` 가 사라진다(실측 `LOST`). 그래서 셸은 **하나**이고 줄이 그
 * stdin 으로 흘러 들어간다. `19` §C6 REC-010 의 "서랍을 닫아도 살아 있어 맥락이 보존됨" 과
 * 같은 요구다 — 세션의 수명은 프로젝트의 것이지 서랍의 것이 아니다.
 */
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mask, OUTPUT_LIMIT, DRAIN_MS, stopGroup } = require('../qc/run.js');

/* 마커 프로토콜 — 한 줄이 어디서 끝났고 무엇을 반환했는지 아는 유일한 방법.
 *
 * 파이프 셸에는 프롬프트가 없다(TTY 가 없으니 셸이 프롬프트를 쓰지 않는다). 그래서 명령마다
 * 뒤에 `printf` 한 줄을 붙여 종료 코드를 받아 온다.
 *
 * 알려진 천장: 사용자의 명령이 이 마커 문자열을 **스스로 출력하면** 끝난 것으로 읽는다.
 * 마커에 세션마다 다른 난수를 넣는 이유가 그것이고(추측해서 맞출 수 없다), 그래도 `env` 처럼
 * 자기 환경을 통째로 찍는 명령은 마커를 그대로 내보낼 수 있다. 이것을 막는 방법은 별도의
 * 파일 서술자뿐이고 그건 셸마다 다르다 — MVP 는 이 천장을 안고 가고, 대신 숨기지 않는다. */
const MARK = () => `__JUQODE_TERM_${randomUUID().replace(/-/g, '')}__`;

/* POSIX 셸만. `$?` 와 `printf` 는 POSIX 가 보장하지만 fish · nu 는 둘 다 다르게 쓴다 —
 * 사용자의 `SHELL` 을 그대로 믿으면 마커 프로토콜이 조용히 깨진다. 아는 셸이면 그것을 쓰고,
 * 모르면 `/bin/sh` 로 내려간다. 어느 쪽인지는 `limits.shell` 로 화면에 나간다. */
const POSIX = /(?:^|\/)(?:sh|bash|dash|ksh|zsh)$/;
function shellFor(env = process.env) {
  if (process.platform === 'win32') {
    /* Windows 는 이 런에서 DEFERRED_VALIDATION 이다. 여기에 cmd.exe 를 적는 것은 측정이
     * 아니라 자리표시이고, `$?`/`printf` 마커는 cmd 에서 그대로 돌지 않는다. */
    return { path: env.COMSPEC || 'cmd.exe', posix: false };
  }
  const s = env.SHELL || '';
  return POSIX.test(s) ? { path: s, posix: true } : { path: '/bin/sh', posix: true };
}

/**
 * 프로젝트 하나의 셸 세션을 연다. 게으르게(첫 열기에) 부르는 것은 호출자의 몫이다.
 *
 * @param {object} spec
 * @param {string} spec.cwd                    프로젝트 루트 — `19` §C6 REC-010
 * @param {(update:object) => void} [spec.onUpdate]
 * @returns {{id:string, pid:number|null, cwd:string, limits:object,
 *            write:(line:string)=>object, stop:()=>void, busy:()=>boolean, done:Promise<object>}}
 */
function open({ cwd, onUpdate = () => {}, env = process.env }) {
  const shell = shellFor(env);
  const id = randomUUID();
  const mark = MARK();
  const startedAt = new Date().toISOString();

  /* `19` §C4 · `07` §2: 사용자의 환경 그대로. 격리가 아니고, 격리인 척하지 않는다. */
  const child = spawn(shell.path, [], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe'],
    /* 자기 프로세스 그룹. 정지가 JuQode 자신에게 번지지 않는다(`07` §8.2). */
    detached: true,
  });

  let out = '';
  let bytes = 0;
  let truncated = false;
  let running = null;              // { line, startedAt } while a line is in flight
  let pending = null;              // the exit code, held for DRAIN_MS while the pipes catch up
  let drain = null;

  const flush = (ended, code = null) => {
    const update = { id, ended: Boolean(ended), code,
                     output: mask(out), truncated, line: running?.line ?? null };
    onUpdate(update);
    return update;
  };

  const take = (chunk) => {
    let s = String(chunk);
    /* 마커 줄은 프로토콜이지 출력이 아니다 — 화면에서 뺀다. 종료 코드는 카드가 따로 말한다. */
    const hit = new RegExp(`^${mark} (\\d+)$`, 'm').exec(s);
    if (hit) s = s.replace(hit[0], '');
    /* 경계를 자른다. `19` §C4 는 stderr 를 숨기지도 분리하지도 않는다고 말하지만, 파이프가
     * 둘이면 합치는 순서는 도착 순서일 뿐이다 — 실제 순서가 아니라는 사실은 화면이 말한다. */
    const size = Buffer.byteLength(s, 'utf8');
    if (bytes + size > OUTPUT_LIMIT) {
      const room = OUTPUT_LIMIT - bytes;
      if (room > 0) {
        out += Buffer.from(s, 'utf8').subarray(0, room).toString('utf8').replace(/�$/, '');
        bytes = OUTPUT_LIMIT;
      }
      truncated = true;
    } else {
      bytes += size;
      out += s;
    }
    if (hit) {
      /* 코드는 왔지만 **출력은 아직 다 오지 않았다.** stdout 과 stderr 는 파이프 둘이고,
       * 마커는 stdout 으로 온다 — MEASURED: `echo out; echo err 1>&2` 가 `out` 만 보였다.
       * 종료 코드를 받자마자 줄을 끝내면 stderr 가 다음 줄의 칸으로 밀리거나 사라진다.
       * `../qc/run.js` 가 자식의 `exit` 뒤에 두는 것과 같은 유예다(DRAIN_MS). */
      pending = Number(hit[1]);
      if (drain) clearTimeout(drain);
      drain = setTimeout(() => {
        drain = null;
        const code = pending;
        pending = null;
        running = null;
        flush(false, code);
      }, DRAIN_MS);
      drain.unref?.();
    }
    flush(false);
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  /* stdin 이 닫힌 채 질문하는 프로그램은 멈추지 않고 **빈 답을 받는다**(실측). 그래서 stdin 은
   * 세션이 끝날 때까지 열어 둔다 — 사용자가 답할 수 있는 유일한 경로다. */
  child.stdin.on('error', () => { /* 셸이 먼저 죽으면 EPIPE. 아래 done 이 말한다. */ });

  const done = new Promise((resolve) => {
    const settle = (why) => {
      running = null;
      resolve({ id, ended: true, why, endedAt: new Date().toISOString() });
      flush(true, null);
    };
    child.on('error', () => settle('spawn-failed'));
    child.on('exit', (code, signal) => settle(signal != null ? 'signalled' : `exit:${code}`));
  });

  return {
    id,
    pid: child.pid ?? null,
    cwd,
    startedAt,
    /* 화면이 말해야 하는 것들. 문장이 아니라 사실이다 — 문구는 `18`/렌더러의 것이고, 어떤
     * 한계가 실제로 있는지는 이 구현만 안다(DV-11 동반 조건 ①②③). */
    limits: {
      tty: false,            // /dev/tty 없음 → sudo · ssh · 자격증명 프롬프트는 물어보지 못한다
      colour: false,         // isatty 거짓
      orderApproximate: true,// stdout/stderr 두 파이프, 도착 순서로 합침
      jobControl: false,     // 명령 하나만 끊을 수 없다 — stop() 은 세션을 끝낸다
      shell: shell.path,
      posix: shell.posix,
    },
    busy: () => running !== null,
    /**
     * 한 줄을 보낸다. 사용자가 친 그대로 — 검사하지 않고, 고치지 않고, 막지 않는다.
     * `19` §C4: 걸러내는 척하지 않는다. 막는 척하는 것이 막지 않는 것보다 나쁘다.
     */
    write(line) {
      const text = String(line ?? '');
      if (!text.trim()) return { ok: false, reason: 'empty' };
      /* 한 번에 한 줄. 앞 줄이 아직 돌고 있으면 마커가 뒤섞여 어느 코드가 어느 줄의 것인지
       * 말할 수 없게 된다 — 그럴 바에는 거절하고 이유를 말한다. */
      if (running) return { ok: false, reason: 'busy' };
      if (child.exitCode !== null || child.signalCode !== null) return { ok: false, reason: 'closed' };
      running = { line: text, startedAt: new Date().toISOString() };
      out = '';                                    // 화면의 한 칸은 한 줄의 것
      bytes = 0;
      truncated = false;
      /* 줄 끝의 `printf` 는 사용자의 줄과 **다른 줄**에 있어야 한다: `cmd &` 나 주석 `#` 으로
       * 끝나는 줄에 이어 붙이면 마커가 그 줄의 일부가 되어 영영 오지 않는다. */
      child.stdin.write(`${text}\nprintf '\\n%s %s\\n' ${JSON.stringify(mark)} "$?"\n`);
      flush(false);
      return { ok: true, id, line: text };
    },
    /* 작업 제어가 없으니 이것은 **세션을 끝낸다.** `../qc/run.js` 의 SIGTERM→5초→SIGKILL 을
     * 그대로 쓴다 — 같은 계약을 두 번 구현하지 않는다. */
    stop() { stopGroup(child); },
    done,
  };
}

module.exports = { open, shellFor, POSIX };
