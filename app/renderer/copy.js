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
    /* WBS-05 · every one of these is a USER action. `19` §C1 ⑤ and D-132 forbid an automatic
     * re-read, so `reread` is the only thing that starts one and `stale` only ANNOUNCES.
     *
     * `stale` carries an example number — `18` writes "3일" — and `19` §C1 ⑤ asks for that
     * style with the real number. `brief.js` substitutes the digit and leaves every character
     * of the approved sentence alone. See CANON_FINDINGS CF-16. */
    reread:    '다시 읽기',
    fold:      '접기',
    unfold:    '펼치기',
    stale:     '3일 전에 읽은 내용이에요. 그 뒤로 프로젝트가 바뀌었을 수 있어요.',
    staleKeep: '이대로 계속',
    failTitle: '프로젝트를 읽지 못했어요',
    failNote:  '요청과 Quick Command, 터미널은 그대로 쓸 수 있어요.',
    partial:  "여섯 가지 중 일부는 확인하지 못했어요. 나머지는 '확인 못함'으로 남겨 두었어요.",
    failTitle: '프로젝트를 읽지 못했어요',
    failNote:  '요청과 Quick Command, 터미널은 그대로 쓸 수 있어요.',
    q: ['하는 일', '주요 기능', '쓰인 기술', '폴더가 하는 일', '실행 방법', '확인 못한 것'],
    chips: { ok: '확인됨', exp: '예상됨', no: '확인 못함' },
  },
  history: {
    title:   '기록',
    more:    '개 더',
    empty:   '아직 끝난 작업이 없어요. 첫 작업을 보내면 여기에 남아요.',
    note:    '끝난 작업은 사라지지 않아요. 실패하거나 멈춘 작업도 남아요.',
    result:  '결과 보기',
    changes: '변경 보기',
    collapse: '접기',
  },

  /* `18` orient.* — SC-02's one orientation sentence. `unknown` is reserved for a Work whose
   * process could not be found after reconciliation; it never stands in for "not looked yet". */
  orient: {
    idle:     '진행 중인 작업은 없어요. 지난 작업은 기록에 있어요.',
    running:  '진행 중인 작업이 있어요.',
    finished: '마지막 작업이 끝났어요.',
    unknown:  '이전 작업이 지금 어떤 상태인지 확인할 수 없어요.',
  },
  intent: {
    label:   '요청 · 프로젝트를 바꾸는 요청',
    ph:      '이 프로젝트에서 바꾸고 싶은 것을 말로 적어요',
    submit:  '보내기',
    helper:  '여기는 프로젝트를 바꾸는 요청만 받아요.',
    examples: '예: "로그인 오류 고쳐줘" · "회원가입 화면을 추가해줘" · "이 버튼을 왼쪽으로 옮겨줘"',
    toTermHint: '개발 서버 · 테스트 · 빌드 · git 같은 기술 명령은 터미널의 Quick Command에서 해요.',
    openTerm: '터미널 열기',
    approvalNote: '작업을 보내면 파일을 바꾸는 데 동의한 것으로 봐요. Claude Code가 따로 허용을 물으면 그대로 전달해요.',
    routeWork:  'Claude Code에게 작업으로 보내요.',
    routeQc:    '기술 명령이에요. 터미널의 Quick Command에서 실행해요.',
    routeUnrec: '프로젝트를 바꾸는 요청으로 읽히지 않아요.',
    ambiguousTitle: '두 가지로 읽혀요',
    ambiguousBody:  '어느 쪽인지 골라 주세요. JuQode가 대신 정하지 않아요.',
    rephrase: '▸ 다시 적기',
    toWork:   'Claude Code 작업으로 보내기',
  },
  pending: { label: '요청 보냄' },
  guard: {
    title:  '지금 진행 중인 작업이 있어요',
    body:   '한 프로젝트에서는 한 번에 하나의 작업만 해요. 끝나거나 취소된 뒤에 다시 보낼 수 있어요. 적은 내용은 아래 칸에 그대로 두었어요.',
    open:   '열기',
    answer: '답하기',
    cancel: '이 작업 취소',
    wait:   '기다리기',
    rule:   '요청을 줄 세우거나 동시에 돌리지 않아요.',
  },
  evidence: {
    title:  '이 프로젝트에서는 변경 작업을 시작하지 않아요',
    body:   '무엇이 바뀌었는지 정확히 확인할 방법이 없어서요. 확인할 수 없는 변경은 만들지 않아요.',
    remain: '지금 할 수 있는 것',
    paths:  ['▸ 프로젝트 설명 읽기', '▸ Quick Command 쓰기', '▸ 터미널로 직접 확인'],
  },
  startFail: {
    title: '작업을 시작하지 못했어요',
    body:  'Claude Code가 시작하자마자 꺼졌어요. 프로젝트 파일은 바뀌지 않았어요. 시작되지 않은 작업은 기록에 남지 않아요.',
    resubmit: '▸ 다시 보내기',
    raw:   '▸ 자세한 출력 보기',
  },
  work: {
    now:       '지금 하는 일',
    empty:     '아직 요청한 작업이 없어요.',
    open:      '열기',
    toBench:   '작업대로 돌아가기',
    cancel:    '이 작업 취소',
    cancelSub: '취소하면 다음 실행을 멈춰요. 이미 바뀐 파일은 그대로 남아요.',
    route:     'Claude Code 작업 · 시작 전 상태를 기록해 두었어요',
    requested: '요청한 말',
    started:   '시작',
    ended:     '끝',
    stepsTitle:'Step — Claude Code가 실제로 알린 것만',
    noSteps:   '아직 Step이 없어요. Claude Code가 알려 주면 여기에 보여요.',
    observed:  '마지막 활동',
    lastSeen:  '마지막 활동',
    ago:       '전',
    nextEmpty: 'Claude Code가 아직 다음 단계를 보내지 않았어요.',
    nosignalTitle: '2분 동안 새 활동이 보이지 않아요',
    nosignalBody:  '멈춘 건지 일하는 중인지 JuQode는 판단하지 않아요. 보인 것만 알려 드려요.',
    unknownTitle:  '지금은 작업 상태를 확인할 수 없어요',
    unknownBody:   '실패한 건 아니에요. 지금 상태를 모르는 거예요.',
    wait:      '▸ 기다리기',
    terminal:  '▸ 터미널로 직접 확인',
    cancelReq:     '취소를 요청했어요',
    cancelReqBody: '실제로 멈추는지 확인하고 있어요. 멈춘 것이 확인되면 결과를 보여 드려요.',
    cancelUnconfTitle: '멈췄는지 확인할 수 없어요',
    cancelUnconfBody:  '취소를 요청한 뒤 90초가 지났지만 멈춘 것을 확인하지 못했어요. 아직 실행 중일 수 있어요.',
    keepWaiting: '▸ 계속 기다리기',
    verify:      '▸ 보인 것 확인하기',
    legend:      '끝남 · 진행 중 · 다음',
    notRun:      '실행되지 않았어요',
    nextDeclared:'다음',
    sessionStart:'시작',
    inputTitle: 'Claude Code가 물어요',
    inputHint:  '답하면 같은 작업이 이어져요. 새 작업이 되지 않아요.',
    inputPh:    '답을 적어요',
    answer:     '답 보내기',
    rawQ:       '원문 보기',
    /* 계약 B — the MVP path. `work.permTitle`/`permGloss`/`allow`/`deny` belong to contract A,
     * which `15` says is NOT built, so they are deliberately absent from this file. */
    permTitleB: 'Claude Code가 이 동작을 하지 못했어요',
    permGlossB: '허용하면 이 동작만 다시 해 볼게요. 허용하지 않으면 여기서 멈춰요.',
    permRetry:  '허용하고 다시 해 보기',   // `permStop` is in `gap:` — `18` has no key for it
    /* Key names follow `18`'s own: `cancelled_none`, not the schema's `cancelled_nochange`.
     * The mapping from one to the other belongs in the renderer, where it is visible. */
    resultTitle: {
      complete:          '끝났어요',
      partial:           '일부만 끝났어요',
      failed:            '끝내지 못했어요',
      cancelled_partial: '취소했어요 · 바뀐 곳이 남아 있어요',
      cancelled_none:    '취소했어요 · 바뀐 것은 없어요',
    },
    /* `15` WBS-18: a 부분 완료 result needs BOTH lists, and these are their labels. They were
     * named by `sc03.js` and never declared, so the result card drew two empty headings over
     * the two lists that are the whole point of the 부분 state. */
    done:        '한 것',
    notDone:     '못 한 것',
    readChanges: '변경 읽기',
    noChanges:   '바뀐 파일이 없어요',
    unwanted:    '원하던 결과가 아니에요',
    /* WBS-19 · `15` SC-03 Unwanted result. D-115: there is NO undo button, and the body says so
     * before offering the only thing that exists — a new Work. It also refuses to promise that
     * the new Work restores anything, because nothing can promise that. */
    unwantedTitle: '원하던 결과가 아니라면',
    unwantedBody:  '되돌리기 버튼은 없어요. 방금 읽은 변경 설명을 바탕으로 새 작업을 요청할 수 있어요. 원래 그대로 돌아간다고 약속하진 못해요.',
    correction:    '고치는 작업 요청',
    readMore:      '먼저 변경 더 읽기',
    raw:         '자세한 출력 보기',
    resubmit:    '▸ 다시 보내기',
    remainTitle: '남은 변경을 다 확인하지 못했어요',
  },
  rules: {
    noFake:     '진행률이나 남은 시간은 짐작해서 보여 드리지 않아요.',
    noRollback: '멈춤은 되돌리기가 아니에요 · 되돌리기 버튼은 없어요',
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
  next: {
    label:     '다음 행동',
    gloss:     'JuQode가 드리는 선택 — Claude Code가 알린 일이 아니에요',
    stepLabel: 'NEXT · Claude Code가 알린 다음 Step',
    stepEmpty: 'NEXT 없음',
  },
  /* SC-04 · Change Reader. Every key below is `18` §SC-04 VERBATIM, including the key names.
   * An earlier draft transcribed `15`'s prose instead — `15` describes the screen, `18` is the
   * copy, and where they differ `18` wins. The strings the dictionary has no key for are in
   * `gap:` with the rest, not invented here where they would look approved. */
  reader: {
    title:        '변경 읽기',
    flow:         '뜻 → 코드 → 원문',
    groups:       '무엇이 바뀌었나요',
    blocks:       '어떤 코드가 바뀌었나요',
    raw:          'Raw Diff — 실제로 바뀐 글자',
    what:         '무엇',
    why:          '왜',
    affects:      '어떤 동작에',
    openRaw:      'Raw Diff 보기',
    copy:         '원문 복사',
    back:         '작업으로 돌아가기',
    understood:   '이해했어요 · 다음 요청으로',

    /* 설명 못함. The body says out loud that no reason will be invented — the sentence IS the
     * guarantee, so it is not paraphrased and not shortened. */
    unexplained:     '이 변경은 말로 설명하지 못했어요',
    unexplainedBody: '그럴듯한 이유를 지어내지 않아요. 아래에서 코드로 직접 볼 수 있어요.',
    toBlocks:        '▸ 코드로 보기',
    toRaw:           '▸ 원문으로 보기',

    unblocked:    '이 파일은 단위로 나누지 못했어요',
    binary:       '이미지 파일이어서 여기서는 보여 드릴 수 없어요',
    scoped:       '이 작업이 바꾼 부분만 보여요.',
    none:         '이 작업은 프로젝트 파일을 바꾸지 않았어요.',
    cancelledNote: '취소한 작업이 남긴 변경이에요. 마무리되지 않았을 수 있어요.',
    remainNote:   '남은 변경을 다 확인하지는 못했어요. 아래는 확인된 부분이에요.',

    /* 증거 공백 — `19` §E. Paths only. The `why` line says these are files the project itself
     * asked to ignore, which is a fact; nothing here says what changed inside them. */
    evidenceGap:      '증거에 담기지 않은 변경이 있어요',
    /* Canon's own placeholder is `{paths}`. Keeping it in the literal and substituting is what
     * makes this string checkable as `18` verbatim — a template literal quietly rewrites the
     * approved text into something the dictionary does not contain. */
    evidenceGapPaths: (paths) => '담기지 않은 경로: {paths}'.replace('{paths}', paths),
    evidenceGapWhy:   '이 파일들은 프로젝트가 무시하도록 설정해 둔 파일이에요.',
    evidenceGapAlt:   '▸ 터미널로 직접 확인',

    kinds: { add: '추가', modify: '수정', delete: '삭제', rename: '이름 변경', unblocked: '나누지 못함' },
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
    /* SC-04 states `18` has no key for. Each one is a state the SCREEN has and the dictionary
     * does not, so it is marked rather than dressed up as approved copy. */
    readerRawClose:   'Raw Diff 닫기',
    readerExplain:    '이 변경 설명 받기',
    readerExplaining: '설명을 받는 중…',
    readerFiles:      (n) => `파일 ${n}개`,
    /* The head-limit note. `18` has no truncation string; `20` bounds the head at 256 KB and
     * the whole patch is kept in a blob, so the sentence states both halves (D-129). */
    readerTruncated:  '변경이 너무 커서 여기에는 앞부분만 실었어요. 원문 전체는 그대로 남아 있어요.',
    /* `18` has `reader.unexplained` for a pass that FAILED and nothing for a pass that has not
     * run. Using the failure sentence for it made the product announce its own failure for work
     * it never attempted, so this states the actual state instead. */
    readerNotAsked:   '아직 이 변경을 말로 설명하지 않았어요.',
    /* …and `18` has no key for "we could not tell what changed" on SC-04 either. `reader.none`
     * is a 확인됨 claim and must not be used when the answer is unknown. */
    readerUnknown:    '이 작업이 무엇을 바꿨는지 여기서 확인하지 못했어요.',
    readerUnknownFiles: (files) => `바뀐 것으로 확인된 파일: ${files}`,
    /* `15` SC-04 Empty State names `▸ 결과 설명으로` · `▸ 다음 의도로`; `18` carries neither. */
    readerToResult:   '▸ 결과 설명으로',
    readerToIntent:   '▸ 다음 의도로',
    readerToGroups:   '▸ 설명으로',
    /* WBS-04 · the files a narrative answer cited. `18` has `brief.q[*]` and the chips, and no
     * key for the evidence line under an answer — the facts layer's rows carry `source_ref` in
     * the schema instead of on screen. These are files the SCAN read, so the reader can open
     * them; that is the whole difference between 예상됨 and 확인 못함 here. */
    briefCites:       '근거로 읽은 파일',
    /* WBS-05 · a refresh that could not read the folder. `18` has `brief.failTitle` and
     * `brief.failNote` for a project that never read, and nothing for the case where an OLD
     * Brief is still on screen underneath — which is the whole point of the state. */
    briefRefreshKept: '아래는 지난번에 읽은 내용이에요. 그대로 남겨 두었어요.',
    /* `18` brief.stale is written as `3일 전에 읽은 내용이에요…` — it presumes the read is a day
     * or more old. Staleness is really about the HASH, not the age, so a project can change
     * minutes after it was read; "0일 전에 읽은 내용이에요" is not Korean anyone writes. This
     * states the same fact for that case. CANON_FINDINGS CF-16. */
    briefStaleToday:  '읽은 뒤로 프로젝트가 바뀌었어요.',
    /* `18` has `reader.copy` for the button; it has no key for what the button says afterwards. */
    readerCopied:     '복사했어요',
    readerCopyFailed: '복사하지 못했어요',
    /* `18` has `history.changes` for the BUTTON and no key for the count on a row. `15` writes
     * it as `변경 3개`, which is what SC-03's result card already says. */
    historyChanged:   (n) => `변경 ${n}개`,
    historyRunning:   '진행 중',
    /* The prefilled correction intent. `15` writes it as `"○○ 변경을 다시 수정해줘"`; `18` has
     * no key for the sentence itself, only for the button that produces it. The user's OWN words
     * are what is quoted — JuQode does not paraphrase the request it is about to resend. */
    correctionIntent: (intent) => `${intent} — 이 작업의 결과가 원하던 것이 아니에요. 다시 고쳐 주세요.`,
    /* A read the main process refused. `18` has SC-01's 저장소 copy and nothing for this — the
     * screen still has to SAY it rather than going blank (12 §16). */
    readerUnavailable: '이 변경을 지금 불러오지 못했어요.',
    /* The copy button's own feedback. `18` carries the label (`reader.copy`) and not the
     * result, and the result is a fact about what just happened on this machine. */
    readerCopied:     '복사했어요',
    readerCopyFailed: '복사하지 못했어요',
    /* `18` has `history.changes` for the BUTTON and no key for the count on a row. `15` writes
     * it as `변경 3개`, which is what SC-03's result card already says. */
    historyChanged:   (n) => `변경 ${n}개`,
    historyRunning:   '진행 중',
    /* The prefilled correction intent. `15` writes it as `"○○ 변경을 다시 수정해줘"`; `18` has
     * no key for the sentence itself, only for the button that produces it. The user's OWN words
     * are what is quoted — JuQode does not paraphrase the request it is about to resend. */
    correctionIntent: (intent) => `${intent} — 이 작업의 결과가 원하던 것이 아니에요. 다시 고쳐 주세요.`,

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
    /* SC-03 states `18` has no key for. Written in the `18` §0 voice; filed as CF-8. */
    workChangeCount:'바뀐 파일',
    workUnknownChanges:'무엇이 바뀌었는지 아직 확인하지 못했어요.',
    workDenialTool: '하려던 동작',
    workNoScope:    '이 동작은 좁게 허용할 방법이 없어서 허용 버튼을 드리지 않아요.',
    /* Short labels for the header chip. `18`'s panel TITLES are sentences and belong in the
     * panel; a chip that repeats a 17-word sentence says the same thing twice (`18` §0.8). */
    chipRunning:    '진행 중',
    chipPermission: '허용 필요',
    chipInput:      '답 필요',
    /* Where a destination is not built yet, the fact is a SENTENCE. A control that cannot act
     * is a dead end with extra steps (`12` 원칙 4 · UF-CLAUDE-ALT). */
    notBuiltTerminal: '터미널은 아직 없어요. 지금은 컴퓨터의 터미널에서 직접 하실 수 있어요.',
    notBuiltPaths:    '여기서 이어서 할 수 있는 것은 아직 만드는 중이에요.',
    workElapsed:      '지난 시간',
    workAbout:        '이 작업에 대해',
    workActor:        '실행자',
    workBasis:        '변경 기준',
    workBasisOk:      '확립됨',
    workStepsNote:    'Step은 Claude Code가 알린 것만 보여요.',
    /* Result claim bodies — generated from what was measured, so `18` cannot carry them (CF-6). */
    claimChanged:     '바뀐 파일',
    claimUnknown:     '무엇이 바뀌었는지 확인하지 못했어요.',
    claimTools:       'JuQode가 지켜본 도구 실행',
    claimReport:      'Claude Code가 한 말이에요.',
    claimNotDone:     '허용되지 않아서 하지 못한 것',
    failedWhat:       '끝난 이유',
    /* `15` SC-03 contract B names this button; `18` carries the other three of the four. */
    permStop:       '그만두기',
    claudeUnknown:  'Claude Code를 쓸 수 없는 이유를 확인하지 못했어요.',
    workRefused:    '작업을 시작하지 않았어요.',
    /* The liveness line names WHAT was last seen. The signal kinds are machine words and
     * `18` §0.7 keeps those out of user sentences, so each gets a plain one. They are
     * observations, not judgements — none of them says whether the Work is progressing. */
    signal: {
      session_start:      '세션 시작',
      status:             '상태 알림',
      step:               '단계 알림',
      file_change:        '파일 변경',
      tool_use:           '도구 사용',
      tool_result:        '도구 결과',
      input_request:      '질문',
      answer:             '답 보냄',
      permission_denied:  '허용되지 않은 동작',
      permission_granted: '허용함',
      cancel_request:     '취소 요청',
      cancel_confirmed:   '멈춘 것 확인',
      rate_limit:         '사용량 안내',
      finish:             '응답 끝',
      reconciled:         '상태 확인 불가',
      evidence_gap:       '증거 빈틈',
      raw:                '그 밖의 신호',
    },

    failMissing:   '폴더가 없어요',
    failNotFolder: '폴더가 아니에요',
    failUnknown:   '이 폴더를 읽지 못했어요',
    claudeMissing: 'Claude Code가 설치되어 있지 않아요',
    claudeNoResp:  'Claude Code가 응답하지 않아요',
    storeTitle:    '저장소를 열지 못했어요',
    storeBody:     '기존 파일을 그대로 두었어요. 지운 것은 없어요. 프로젝트를 열려면 이 문제를 먼저 해결해야 해요.',
  }
};
