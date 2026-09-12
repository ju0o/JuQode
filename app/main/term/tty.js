'use strict';
/* WBS-25b · 이 줄이 **답할 수 없는 질문**을 할 가능성이 있는가.
 *
 * ── 이 파일이 별도로 있는 이유 ──
 *
 * `./session.js` 에는 프로그램 이름 목록이 있어서는 안 되고, `tests/term.test.js` 가 그것을
 * 검사한다. 그 검사는 옳다: 셸을 실행하는 파일 안의 이름 목록은 언젠가 **차단 목록**이 되고,
 * 차단 목록이 생기는 순간 제품은 "위험한 것은 막았다" 고 말하게 된다 — `19` §C4 가 금지하는
 * 바로 그 가장(假裝)이다.
 *
 * 여기 있는 것은 차단 목록이 아니다. 두 가지가 구조적으로 다르다:
 *   1. 이 파일은 **불리언 하나**만 돌려준다. 거절할 수 있는 반환값이 없다.
 *   2. 호출부(`session.js` 의 `write`)는 이 답을 보기 **전에** 이미 줄을 셸에 썼다. 일치한
 *      줄도 일치하지 않은 줄과 똑같이 실행된다 — `tests/term.test.js` 가 그것을 측정한다.
 *
 * 그리고 이것은 위험 탐지도 아니다. `../qc/rules.js` 가 블록리스트를 거부하는 이유 — 탐지하는
 * 척하면 걸리지 않은 것이 안전하다고 가르친다 — 는 여기에도 적용되므로, 목록의 뜻은
 * "위험한 명령" 이 아니라 **제어 터미널이 없어서 이 구현이 대답해 줄 수 없는 질문을 하는
 * 프로그램**이다. 빠진 것이 있어도 그것은 안전하다는 뜻이 아니고, 화면 문구(`termNoTtyNow`)가
 * 완전하다고 말하지 않는다.
 *
 * 사실의 출처는 추측이 아니라 실측이다 — `DV-11-PIPE-SHELL-SPIKE.md`: 제어 터미널이 없어
 * `/dev/tty` 를 직접 여는 프로그램은 **묻지도 못하고 실패한다.** 조용한 실패이고, 그 침묵에
 * 이름을 붙이는 것이 이 파일의 전부다.
 */

/** 첫 낱말 하나로 판단되는 것들. */
const ASKERS = new Set(['sudo', 'su', 'doas', 'ssh', 'scp', 'sftp', 'passwd', 'ssh-add']);

/** `<프로그램> <하위명령>` 일 때만 묻는 것들. 첫 낱말만 보면 `git status` 까지 걸린다. */
const ASKER_PAIRS = new Set([
  'git push', 'git pull', 'git fetch', 'git clone',
  'npm login', 'npm publish', 'gh auth', 'docker login', 'vercel login', 'netlify login',
]);

/**
 * @returns {boolean} 아무것도 막지 않는다. 화면이 한 줄 더 말할지만 정한다.
 */
function needsTty(line) {
  /* 파이프·`;`·`&&` 로 나뉜 **모든** 조각을 본다: `echo x | sudo tee /etc/hosts` 의 물음은
   * 두 번째 조각에서 온다. */
  for (const seg of String(line ?? '').split(/\||;|&&|\|\||&/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    /* `FOO=bar sudo ...` — 앞의 환경변수 대입은 프로그램이 아니다. */
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    if (!words.length) continue;
    const head = words[0].split('/').pop();          // `/usr/bin/sudo` 도 같은 프로그램이다
    if (ASKERS.has(head)) return true;
    if (words[1] && ASKER_PAIRS.has(`${head} ${words[1]}`)) return true;
  }
  return false;
}

module.exports = { needsTty, ASKERS, ASKER_PAIRS };
