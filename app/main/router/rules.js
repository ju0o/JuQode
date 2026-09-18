'use strict';
/* The Quick Command rule table — `19` §C4, validated in
 * `../evidence/planning/q02-q03-quick-command-validation.md` (corpus 87/87).
 *
 * This file is DATA. The matcher in `intent.js` is the only thing that reads it, and it does
 * string operations only: no morphological analysis, no typo correction, no similarity score,
 * no LLM. The same input always produces the same result.
 *
 * WBS-06 uses this to decide a ROUTE. It never builds a command from it — `command_template`
 * is carried so WBS-22/23 can explain and run, and is not touched here.
 */

/* Verb endings, longest first. `''` is the bare stem (`실행`, `확인`). */
const ENDINGS = [
  '어주십시오', '아주십시오', '어주세요', '아주세요', '주십시오', '해주세요', '주시겠어요',
  '어주실래요', '주실래요', '어주라', '아주라', '주세요', '주실래', '주십쇼', '해줄래',
  '어줘요', '아줘요', '줄래요', '해줘', '줘요', '줄래', '봐줘', '어봐', '아봐',
  '어요', '아요', '줘', '라', '요', '봐', '자', '기', '',
];

/* Fillers removed from the compacted string (q02 §2 step 6). */
/* ONE list, shared with `qc/rules.js`.
 *
 * SC-02 decides that a phrase is technical and hands it to the drawer (D-134), and the drawer
 * then decides whether it is one of the six. Two filler lists meant those two answers could
 * disagree: `서버 얼른 켜줘` routed to the terminal here and came back 미인식 there, so the
 * product told the user where to go and then said it did not understand.
 *
 * `19` §C4 writes the six out in full, so the list is Canon's and there is nothing to
 * reconstruct — see the note in `qc/rules.js`. */
const { FILLERS } = require('../qc/rules');

/* Longest key first at substitution time. */
const SYNONYMS = [
  ['devserver', '개발서버'], ['dev서버', '개발서버'], ['dev', '개발서버'], ['데브서버', '개발서버'],
  ['로컬서버', '개발서버'], ['프리뷰', '개발서버'], ['미리보기', '개발서버'],
  ['npmrundev', '개발서버켜'], ['npmrunbuild', '빌드해'], ['npmtest', '테스트해'], ['npmruntest', '테스트해'],
  ['build', '빌드'], ['test', '테스트'], ['git', '깃'], ['status', '상태'],
  ['stop', '중지'], ['start', '시작'], ['open', '열어'], ['terminal', '터미널'],
  ['console', '콘솔'], ['shell', '셸'],
];

/* Change VERBS — full forms, not bare stems. A bare stem is matched by substring, and
 * `수정된 파일` (a declared git.status object) contains `수정`, so the bare-stem list read a
 * read-only request as a request to modify something. A verb needs its verb ending. */
const CHANGE_FORMS = [
  '고쳐', '고치', '고칠',
  '수정해', '수정하', '수정할', '수정시켜',
  '추가해', '추가하', '추가할', '추가시켜',
  '바꿔', '바꾸', '바꿀',
  '지워', '지울', '지우',
  '삭제해', '삭제하', '삭제할',
  '만들어', '만들', '만들자',
  '없애', '없앨',
  '리팩터', '리팩토',
];

const RULES = [
  {
    id: 'qc.dev.start',
    objects: ['개발서버', '서버'],
    verbs: ['켜', '실행해', '실행시켜', '실행', '돌려', '시작해', '시작', '띄워', '올려', '구동해', '가동해'],
    kind: 'long_running',
  },
  {
    id: 'qc.dev.stop',
    objects: ['개발서버', '서버'],
    verbs: ['꺼', '끄', '끄기', '멈춰', '멈추게해', '중지해', '중지시켜', '중지', '종료해', '종료', '내려', '죽여', '스톱'],
    /* 이중 의미 — 서버를 "정리한다" 는 (1) 끈다 (2) 서버 코드를 정리한다(파일 변경 = Work).
     * 실행하지 않고 두 해석을 보여 준다 (q02 §3 경우 C). */
    ambiguousVerbs: ['정리해', '정리하기', '정리', '치워', '처리해', '처리', '정돈해', '정돈', '손봐'],
    kind: 'oneshot',
  },
  {
    id: 'qc.build',
    /* q02 §4: `빌드` 단독 is in the passing build group, so the bare object is an exact form
     * (tier T1). Bare objects are NOT generally verbs — `테스트` alone stays unmatched, since
     * "the tests" is as likely to be the subject of a change request as of a run request. */
    exact: ['빌드'],
    objects: ['빌드'],
    verbs: ['해', '돌려', '실행해', '실행시켜', '실행', '시작해', '시작'],
    /* `빌드 만들어줘` has two readings — run the build, or write me a build script — and q02 §2
     * names 만들어 as a change verb. It gets the dual-meaning treatment 정리해 gets on
     * qc.dev.stop rather than quietly running a build. */
    ambiguousVerbs: ['만들어', '만들'],
    kind: 'oneshot',
  },
  {
    id: 'qc.test',
    objects: ['테스트', '테스트코드', '유닛테스트', '단위테스트'],
    verbs: ['돌려', '해', '실행해', '실행시켜', '실행', '시작해', '시작'],
    kind: 'oneshot',
  },
  {
    id: 'qc.git.status',
    /* Bare objects and the interrogative forms, which have no separable verb to compose with
     * (`뭐가 바뀌었어?` is one phrase, not object + verb). Listing them here is what let the
     * bare `''` verb be removed — that entry made every polite ending a verb of this rule. */
    exact: ['깃상태', '변경사항', '변경내역', '깃변경사항', '변경된파일', '바뀐파일',
            '뭐가바뀌었어', '뭐가바뀌었지', '뭐가바뀌었나', '무엇이바뀌었어', '뭐바뀌었어',
            '뭐가바뀌었', '무엇이바뀌었'],
    objects: ['깃상태', '깃스테이터스', '변경된파일', '바뀐파일', '변경사항', '변경내역', '변경된거',
              '바뀐거', '수정된파일', '수정한파일', '고친파일', '바뀐것', '변경파일',
              '커밋안된파일', '커밋안한파일', '깃변경사항', '뭐가바뀌었', '무엇이바뀌었'],
    /* No bare `''` verb. With it, `verbForms('')` was the entire endings table, so `요`,
     * `자`, `줘`, `주세요` each became a verb of this rule and every polite ending routed
     * ambiguous. Bare objects are handled by `exact` above instead. */
    verbs: ['보여', '봐', '알려', '확인해', '확인', '체크해', '체크', '보기', '보자'],
    kind: 'oneshot',
  },
  {
    id: 'qc.terminal.open',
    objects: ['터미널', '콘솔', '셸', '명령창', '커맨드창', '터미널창', '터미널드로어'],
    verbs: ['열어', '열', '켜', '띄워', '보여', '오픈해', '오픈'],
    kind: 'oneshot',
  },
];

module.exports = { RULES, ENDINGS, FILLERS, SYNONYMS, CHANGE_FORMS };
