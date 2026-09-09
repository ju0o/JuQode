/* Korean UX copy.
 *
 * SOURCE OF TRUTH: JuQode-Private docs/current/18_KOREAN_UX_COPY.md.
 * Every string below is TRANSCRIBED from that dictionary by key. Do not edit here —
 * edit 18 first. Keys not yet needed by a built screen are deliberately absent.
 */
export const C = {
  app: {
    name: 'JuQode',
  },
  actor: {
    claude: 'Claude Code',
    juq:    'JuQode',
  },
  nav: {
    /* `18` §0 rule 10 adopts this exact label for the change-project action. */
    otherProject: '다른 프로젝트 열기',
  },
  sc01: {
    title:      '프로젝트 열기',
    lead:       '내 컴퓨터에 있는 프로젝트 폴더를 열면, JuQode가 먼저 이 프로젝트가 무엇인지 읽어 드려요.',
    open:       '프로젝트 폴더 열기',
    openHint:   '이미 있는 폴더를 고르면 돼요. 새로 만들지는 않아요.',
    opening:    '폴더를 읽고 있어요…',
    recent:     '최근에 연 프로젝트',
    recentNote: '최근에 연 폴더만 보여요.',
    noHistory:  '아직 기록이 없어요 — 처음 열기',
    failTitle:  '이 폴더는 열 수 없어요',
    failReason: '읽기 권한이 없어요',
    retry:      '▸ 같은 폴더 다시 시도',
    other:      '▸ 다른 폴더 고르기',
    tech:       '자세한 내용 보기',
    lastWork:   '마지막 작업',
  },
  brief: {
    title: '이 프로젝트가 하는 일',
    at:    '읽은 시점',
    interpreting: '프로젝트를 읽고 있어요',
    interpretingHint: '읽는 동안에도 요청할 수 있어요.',
    readFiles:    '지금 읽는 파일',
    partial:  "여섯 가지 중 일부는 확인하지 못했어요. 나머지는 '확인 못함'으로 남겨 두었어요.",
    failTitle: '프로젝트를 읽지 못했어요',
    failNote:  '요청과 Quick Command, 터미널은 그대로 쓸 수 있어요.',
    q: ['하는 일', '주요 기능', '쓰인 기술', '폴더가 하는 일', '실행 방법', '확인 못한 것'],
    chips: { ok: '확인됨', exp: '예상됨', no: '확인 못함' },
  },
  history: {
    title: '기록',
    more:  '개 더',
    empty: '아직 끝난 작업이 없어요. 첫 작업을 보내면 여기에 남아요.',
    note:  '끝난 작업은 사라지지 않아요. 실패하거나 멈춘 작업도 남아요.',
  },
  work: {
    empty: '아직 요청한 작업이 없어요.',
  },
  /* SC-02 · Claude Code 지금 안 됨 (`18` §1). 사용 불가 ≠ 실패 (12 §16). */
  unavailable: {
    title:    '지금은 Claude Code를 쓸 수 없어요',
    chip:     '지금 안 됨 · 실패 아님',
    body:     '실패한 게 아니에요. 해결되면 같은 요청을 다시 보낼 수 있어요.',
    reason:   'Claude Code에 로그인이 필요해요',
    paths:    ['▸ 프로젝트 설명 읽기', '▸ Quick Command 쓰기', '▸ 터미널로 직접 확인'],
    resubmit: '▸ 해결한 뒤 다시 보내기',
  },
  theme: {
    label:  '테마',
    light:  '밝게',
    dark:   '어둡게',
    system: '시스템',
  },

  /* ── CANON GAP ─────────────────────────────────────────────────────────────
   * `18` is the single copy source and it does NOT carry a string for these states.
   * The words below are taken from `15` (SCREEN SPEC) where `15` states them, and are
   * marked so they cannot be mistaken for dictionary entries. Filed back to Canon as a
   * copy gap; when `18` adopts keys for them these move up into the blocks above.
   *   gap.failMissing    — `15` SC-01 Failure State says `폴더가 존재하지 않습니다`, but `15`'s
   *                        own header gives `18` precedence and `18` §0.1 requires `-요`.
   *                        `18` already applied that rewrite to the sibling reason in the same
   *                        `15` cell (`읽기 권한이 없습니다` → `읽기 권한이 없어요`), so `15`'s
   *                        un-rewritten wording is not a safe fallback. Written in the `18` voice.
   *   gap.failNotFolder  — neither `15` nor `18` states it. Written in the `18` §0 voice.
   *   gap.storeTitle/Body— DB refusal is a runtime state no planning document reaches.
   *   gap.claudeMissing  — `15` SC-02 names 설치되지 않음 · 응답 없음 as reasons; `18`
   *                        supplies only the 로그인 필요 sentence.
   */
  gap: {
    /* Brief ANSWER bodies. `18` is a dictionary of fixed UI strings; a Brief answer is
     * generated from what the scan found, so `18` cannot carry it and does not try. These are
     * the smallest sentences that state a fact without adding a judgement. CF-6. */
    briefTech:      '프로젝트예요.',
    /* FIELD LABELS, not sentences — the same shape as Canon's own `brief.at` (읽은 시점) and
     * `brief.readFiles` (지금 읽는 파일). `18` §0.1's `-요` rule governs sentences; a label
     * that introduces a value is a label in Canon too.
     * NOT the earlier wording: the dependency list is the first twelve ALPHABETICALLY, so
     * calling it a 주요 list is a judgement the scan cannot support (`18` §0.2). */
    briefPm:        '패키지 매니저',
    briefDeps:      '의존성',
    briefFolders:   '이 폴더들이 있어요.',
    briefFolderRole:'각 폴더가 무슨 일을 하는지는 아직 읽지 않았어요.',
    briefRun:       '이 프로젝트가 스스로 적어 둔 실행 방법이에요.',
    briefNoManifest:'어떤 기술을 쓰는지 알려 주는 파일을 찾지 못했어요.',
    briefNoFolders: '하위 폴더가 없어요.',
    briefNoScripts: '실행 방법이 프로젝트에 적혀 있지 않아요.',
    /* NOT "아직 읽지 않았어요" — the card's own disclosure says it read two files. What is
     * missing is the reading that turns files into an explanation, not the reading itself. */
    briefNarrative: '파일만으로는 답할 수 없는 질문이에요.',
    briefUnknownQ:  '아직 답하지 못한 것',
    briefSkipped:   '상한을 넘겨서 읽지 못한 파일',
    briefUnreadDirs:'읽을 수 없던 폴더',
    briefDeepDirs:  '더 깊이 들어가지 않은 폴더',
    briefRoles:     '폴더가 각각 무슨 일을 하는지',
    briefTechMeaning:'그 기술이 이 프로젝트에서 무슨 뜻인지',
    briefFailNoAccess:'폴더를 읽을 권한이 없어요.',
    briefFailGone:  '폴더가 없어졌어요.',
    briefFailOther: '폴더를 읽는 중에 막혔어요.',

    failMissing:   '폴더가 없어요',
    failNotFolder: '폴더가 아니에요',
    failUnknown:   '이 폴더를 읽지 못했어요',
    claudeMissing: 'Claude Code가 설치되어 있지 않아요',
    claudeNoResp:  'Claude Code가 응답하지 않아요',
    storeTitle:    '저장소를 열지 못했어요',
    storeBody:     '기존 파일을 그대로 두었어요. 지운 것은 없어요. 프로젝트를 열려면 이 문제를 먼저 해결해야 해요.',
  }
};
