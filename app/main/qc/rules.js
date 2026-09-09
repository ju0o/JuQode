'use strict';
/* WBS-22 · Quick Command recognition — `19` §C4, D-106, D-134, validated in
 * `../evidence/planning/q02-q03-quick-command-validation.md`.
 *
 * Rules, never an LLM. The same input always produces the same answer, and the answer is one of
 * exactly four things: a rule, an ambiguity with its readings named, 사용 불가 with a reason, or
 * 미인식 — which is a BRANCH to the Work path, not an error (F-C4-01).
 *
 * ── The safety argument, which is the whole point of this file ──
 *
 * There is no code path from a free-text sentence to a shell. A recognised phrase yields a rule
 * id; the command comes from the project's own `package.json` scripts or from a fixed action.
 * Recognition works by REMOVING known object words and known verbs from the input and requiring
 * that NOTHING IS LEFT — the residue-zero rule. `고쳐 · 수정 · 추가 · 지워 · 삭제`, `rm -rf`,
 * `&&`, `sudo`, a port number, a second clause: any of these leaves characters behind, and the
 * phrase matches no rule at all.
 *
 * That is an allowlist residue check, NOT a blocklist. `19` §C4 is explicit about why the
 * difference matters: a product that says it DETECTS dangerous phrases teaches the user that
 * anything it did not flag is safe. This file detects nothing. It recognises six things and
 * declines everything else (q02 §5.7).
 *
 * ── What is NOT reproduced from Canon ──
 *
 * The validated artefacts (`rules.json`, `corpus.json`, `match.js`) live in a planning
 * scratchpad outside both repositories. `19` §C4 elides the verb lists (`… (+12)`) and the
 * corpus document names roughly forty of its eighty-seven cases. The ALGORITHM below is Canon's
 * exactly; the word lists are reconstructed from the cases Canon writes down, and
 * `tests/qc.test.js` states per case where it came from. See CANON_FINDINGS CF-12.
 */

/* ── normalization (§2) — deterministic string work only.
 * No morphological analysis, no spell correction, no similarity score, no model call. */

/* `19` §C4's list, and ONLY it: 좀 · 제발 · 빨리 · 한번 · 지금 · 그냥.
 *
 * Seven more were added here (얼른 · 일단 · 우선 · 잠깐 · 혹시 · 부탁 · 좀만) and each one WIDENS
 * the path to a spawn: `서버 얼른 켜줘` ran, where Canon's list leaves it 미인식 and sends it to
 * a Work. Canon's stance is 정밀도 우선 and its corpus is 87/87 against these six. The rest of
 * this file reconstructs lists Canon elides; this one Canon writes out in full, so there is
 * nothing to reconstruct. */
const FILLERS = ['좀', '제발', '빨리', '한번', '지금', '그냥'];
const TAIL_PUNCT = /[.!?~…,;:'"”’)\]】」』]+$/u;
const TAIL_EMOTE = /(?:ㅋ+|ㅎ+|ㅠ+|ㅜ+)+$/u;

/**
 * `19` §C4's six steps, in order. Returns the compact form everything else matches against.
 *
 * Step 5 removes ALL whitespace, which is what makes `켜줘` and `켜 줘`, `개발서버` and
 * `개발 서버` one thing. Step 6 removes fillers from the compact string as substrings — a
 * non-developer's sentence is full of them and none of them changes what was asked for.
 */
function normalize(input) {
  let s = String(input ?? '').normalize('NFC');
  s = s.trim().replace(/\s+/g, ' ');
  /* Punctuation, then the emote tail, then punctuation again — `켜줘!ㅋㅋ` needs both passes. */
  s = s.replace(TAIL_PUNCT, '').replace(TAIL_EMOTE, '').replace(TAIL_PUNCT, '');
  /* Latin only. Lowercasing Korean is a no-op, but doing it explicitly keeps the step honest. */
  s = s.replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
  s = s.replace(/\s+/g, '');
  for (const f of FILLERS) s = s.split(f).join('');
  return s;
}

/* ── the rule table (§1) — six rules, and the set is CLOSED.
 * `20`'s `quick_command_rule` holds the same six ids as a foreign key, so a seventh rule cannot
 * be added here alone; the schema has to agree. */

/* Endings, longest first — they are stripped after a verb stem. `19` §C4 counts 26. */
const ENDINGS = [
  '주시겠어요', '주시겠어', '주십시오', '주십쇼', '주세요', '주실래요', '줄래요',
  '해주세요', '해줘', '주라', '줄래', '줘요', '줘', '봐요', '봐', '요', '라', '자',
  '어요', '어', '야', '지', '기', '',
];

/* Common to several rules — "run it" means different things depending on the object. */
const RUN_VERBS = ['돌려봐', '돌려', '실행시켜', '실행해', '실행', '해봐', '해', '시작해', '시작'];

const RULES = [
  {
    id: 'qc.dev.start',
    understood: '개발 서버를 켠다',
    /* §2 T1 — WHOLE utterances, matched before anything is decomposed. `patterns` is a field of
     * its own in REC-009 and is NOT the object list: `개발서버` alone reads as "start it", but
     * `서버` is an object BOTH the start and the stop rule own, and matching bare objects made
     * every one of them ambiguous. Only the phrases Canon actually documents are here. */
    patterns: ['개발서버', '데브서버', '로컬서버', 'devserver', 'npmrundev', 'pnpmrundev',
               'yarndev', 'bunrundev', 'npmstart'],
    objects: ['개발서버', '로컬서버', '데브서버', '프리뷰', '미리보기', '데브', '서버'],
    verbs: ['켜봐', '켜', '띄워봐', '띄워', '올려봐', '올려', '기동해', ...RUN_VERBS],
    kind: 'long_running',
    risk: 'run',
    stopRule: 'qc.dev.stop',
  },
  {
    id: 'qc.dev.stop',
    understood: 'JuQode 가 켠 개발 서버를 끈다',
    patterns: [],
    objects: ['개발서버', '로컬서버', '데브서버', '프리뷰', '미리보기', '데브', '서버'],
    verbs: ['꺼봐', '꺼', '끄기', '끄', '멈춰봐', '멈춰', '멈추게해', '멈춰주', '중지시켜', '중지해', '중지',
            '종료시켜', '종료해', '종료', '내려', '닫아', '스톱'],
    /* §3 case C. These are NOT this rule's proper verbs. "서버를 정리한다" reads two ways —
     * stop the running server, or tidy the server CODE, which is a file change and therefore a
     * Work. So it is never executed; both readings are shown and the user picks. */
    ambiguousVerbs: ['정리하기', '정리해', '정리', '치워', '처리해', '정돈해', '손봐'],
    kind: 'oneshot',
    risk: 'run',
  },
  {
    id: 'qc.build',
    understood: '프로젝트를 빌드한다',
    patterns: ['빌드', 'npmrunbuild', 'pnpmrunbuild', 'yarnbuild'],
    objects: ['빌드'],
    verbs: RUN_VERBS,
    kind: 'oneshot',
    risk: 'run',
  },
  {
    id: 'qc.test',
    understood: '테스트를 실행한다',
    /* Canon documents `빌드` alone as a build case and does NOT document `테스트` alone. The
     * asymmetry is Canon's, and it is not corrected here — inventing the missing case is how a
     * rule table stops being the validated one. */
    patterns: ['npmtest', 'npmruntest', 'pnpmtest', 'yarntest'],
    objects: ['유닛테스트', '단위테스트', '테스트코드', '테스트'],
    verbs: RUN_VERBS,
    kind: 'oneshot',
    risk: 'run',
  },
  {
    id: 'qc.git.status',
    understood: 'Git 작업 상태(변경된 파일 목록)를 읽어서 보여준다',
    patterns: ['깃상태', '깃스테이터스', 'gitstatus', '변경사항', '변경내역',
               '뭐가바뀌었어', '뭐가바뀌었나', '뭐바뀌었어', '뭐가달라졌어'],
    objects: ['커밋안된파일', '커밋안한파일', '깃변경사항', 'git변경사항', '수정된파일', '수정한파일',
              '고친파일', '변경된파일', '변경사항', '변경내역', '변경파일', '변경된거', '바뀐파일',
              '바뀐거', '바뀐것', '깃상태', 'git상태', 'gitstatus', '깃스테이터스'],
    verbs: ['보여줘요', '보여', '봐', '알려', '확인해', '확인', '체크해', '체크', '보기', '뭐야', '뭐있어'],
    kind: 'oneshot',
    risk: 'read',
  },
  {
    id: 'qc.terminal.open',
    understood: '터미널 드로어를 연다',
    patterns: ['openterminal'],
    objects: ['터미널드로어', '터미널창', '커맨드창', '명령창', '터미널', '콘솔', '셸', '쉘'],
    verbs: ['열어봐', '열어', '열', '켜', '띄워', '보여', '오픈해', '오픈'],
    kind: 'oneshot',
    risk: 'read',
  },
];

/* §2 T3. Applied longest-key-first, then the whole ladder is retried. A synonym table is not a
 * similarity score: `dev` becomes `개발` and nothing becomes anything it merely resembles. */
const SYNONYMS = [
  ['devserver', '개발서버'], ['dev서버', '개발서버'], ['데브서버', '개발서버'],
  ['로컬서버', '개발서버'], ['dev', '개발'], ['데브', '개발'],
  ['build', '빌드'], ['test', '테스트'], ['git', '깃'], ['status', '상태'],
  ['stop', '중지'], ['start', '시작'], ['open', '열어'], ['run', '실행'],
  ['server', '서버'], ['terminal', '터미널'], ['console', '콘솔'], ['shell', '셸'],
];

/** Every `stem + ending`, longest first — a longer form must be stripped before a shorter one. */
function verbForms(stems) {
  const out = new Set();
  for (const stem of stems) for (const e of ENDINGS) out.add(stem + e);
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Try to consume the whole input with one rule's words.
 *
 * @returns {{object:boolean, verb:boolean, ambiguousVerb:boolean, residue:string}}
 *   `residue` is what NOTHING in the rule accounted for. Only `residue === ''` is a match, and
 *   that single condition is what keeps `서버 켜줘 && rm -rf /` out of every rule.
 */
function consume(compact, rule) {
  let s = compact;
  let object = false, verb = false, ambiguousVerb = false;

  const eat = (words) => {
    let hit = false;
    for (const w of words) {
      if (!w) continue;
      while (s.includes(w)) { s = s.replace(w, ''); hit = true; }
    }
    return hit;
  };

  /* Objects first, longest first: `개발서버` must go before `서버`, or `개발` is left behind. */
  object = eat([...rule.objects].sort((a, b) => b.length - a.length));
  verb = eat(verbForms(rule.verbs));
  if (rule.ambiguousVerbs) ambiguousVerb = eat(verbForms(rule.ambiguousVerbs));

  return { object, verb, ambiguousVerb, residue: s };
}

/**
 * Recognise one phrase.
 *
 * @returns {{tier:string, kind:'qc'|'ambiguous'|'unrecognized', id?:string, readings?:string[]}}
 *   `unrecognized` is a BRANCH, not a failure — the phrase goes to the Work path (F-C4-01).
 *   `ambiguous` names its readings and runs NOTHING; `19` §C4 forbids choosing quietly.
 */
function match(phrase) {
  const compact = normalize(phrase);
  if (!compact) return { tier: 'empty', kind: 'unrecognized' };

  const first = attempt(compact, '');
  if (first.kind !== 'unrecognized') return first;

  /* T3 — substitute synonyms, then run the whole ladder again. */
  let sub = compact;
  for (const [from, to] of [...SYNONYMS].sort((a, b) => b[0].length - a[0].length)) {
    sub = sub.split(from).join(to);
  }
  if (sub === compact) return first;
  return attempt(sub, 'synonym+');
}

function attempt(compact, prefix) {
  const tier = (t) => `${prefix}${t}`;

  /* T1 exact — the compact form IS one rule's whole pattern. */
  const exact = RULES.filter((r) => r.patterns.includes(compact));
  if (exact.length === 1) return { tier: tier('T1'), kind: 'qc', id: exact[0].id };
  if (exact.length > 1) {
    return { tier: tier('T1'), kind: 'ambiguous', readings: exact.map((r) => r.id) };
  }

  /* T2 — object AND verb consumed, and nothing left over. */
  const hits = [];
  const dual = [];
  for (const rule of RULES) {
    const c = consume(compact, rule);
    if (c.residue !== '') continue;
    if (c.object && c.verb) { hits.push(rule.id); continue; }
    /* T2c — the object is a Quick Command object but the verb is one of the two-meaning ones. */
    if (c.object && c.ambiguousVerb && !c.verb) dual.push(rule.id);
  }
  if (hits.length === 1) return { tier: tier('T2'), kind: 'qc', id: hits[0] };
  if (hits.length > 1) return { tier: tier('T2'), kind: 'ambiguous', readings: hits };
  if (dual.length) return { tier: tier('T2c'), kind: 'ambiguous', readings: [dual[0], 'work'] };

  /* T2b verb-only — the whole input is one rule's verb, with no object at all. ALWAYS
   * ambiguous: "돌려줘" could be the build or the tests, and "켜줘" could be the dev server or
   * the terminal. One candidate still means `[id, work]` — a bare verb is not a request that
   * names its target, so the product asks instead of guessing. */
  const verbOnly = RULES.filter((r) => verbForms(r.verbs).includes(compact)).map((r) => r.id);
  if (verbOnly.length === 1) return { tier: tier('T2b'), kind: 'ambiguous', readings: [verbOnly[0], 'work'] };
  if (verbOnly.length > 1) return { tier: tier('T2b'), kind: 'ambiguous', readings: verbOnly };

  return { tier: tier('T3'), kind: 'unrecognized' };
}

const ruleById = (id) => RULES.find((r) => r.id === id) ?? null;

module.exports = { match, normalize, RULES, ruleById, FILLERS, ENDINGS, SYNONYMS };
