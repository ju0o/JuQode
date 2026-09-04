/* JuQode v0.1 — Functional Prototype · static data
 * 출처: JuQode-Private/docs/handoffs/LOVABLE_HANDOFF_V01.md §7
 * 이 파일은 Mock이다. Repository 파싱 · Backend · Git 없음. */

const WORLD = [
  {
    id: 'blog', name: 'Blog', featureCount: 2, note: '아직 없는 것 1',
    // 관계 구조 — 이것이 그 소프트웨어의 형태다 (A 문법)
    layers: [1, 1], edges: [[0, 1]], absent: [1], attention: [],
  },
  {
    id: 'store', name: 'Store', featureCount: 3, note: '확인 필요 1',
    layers: [1, 1, 1], edges: [[0, 1], [1, 2]], absent: [], attention: [2],
  },
  {
    id: 'juguard', name: 'JuGuard', featureCount: 5, note: '정상',
    layers: [1, 2, 2], edges: [[0, 1], [0, 2], [1, 3], [2, 4]], absent: [], attention: [],
  },
  {
    id: 'myservice', name: 'My Service', featureCount: 8,
    note: '확인 필요 2 · 아직 없는 것 1', current: true,
    layers: [2, 2, 3, 1],
    edges: [[0, 2], [1, 3], [1, 6], [2, 4], [3, 5], [5, 7]],
    absent: [6], attention: [3, 7],
  },
];

/* My Service — Feature. layer = 관계 깊이. 크기는 동작 수에서 나온다 (임의 아님) */
const FEATURES = [
  { id: 'signup',  name: '회원가입', layer: 0,
    behaviors: ['정보 입력', '중복 확인', '계정 만들기', '환영 메일'] },
  { id: 'search',  name: '검색',     layer: 0,
    behaviors: ['검색어 입력', '결과 찾기', '조건 좁히기', '정렬', '최근 검색 저장'] },
  { id: 'login',   name: '로그인',   layer: 1, state: '정상 작동',
    related: ['프로필', '세션'], lastChange: '로그인 실패 메시지 수정',
    behaviors: ['사용자 입력', '사용자 확인', '인증', '세션 생성', '홈 이동', '로그인 실패'] },
  { id: 'payment', name: '결제',     layer: 1, attention: true,
    behaviors: ['결제수단 확인', '금액 계산', '쿠폰 적용', '결제 요청', '결제 성공', '결제 실패', '주문 생성'] },
  { id: 'profile', name: '프로필',   layer: 2,
    behaviors: ['정보 보기', '정보 고치기', '사진 바꾸기', '비밀번호 바꾸기'] },
  { id: 'order',   name: '주문',     layer: 2,
    behaviors: ['주문 확인', '배송지 입력', '주문 접수', '상태 바꾸기', '주문 취소'] },
  { id: 'reco',    name: 'AI 추천',  layer: 2, absent: true,
    behaviors: ['사용자 관심 파악', '추천 보여주기'] },
  { id: 'notify',  name: '알림',     layer: 3, attention: true,
    behaviors: ['알림 만들기', '보내기', '읽음 처리'] },
];

const FEATURE_EDGES = [
  ['signup', 'login'], ['login', 'profile'], ['search', 'payment'],
  ['payment', 'order'], ['order', 'notify'], ['search', 'reco'],
];

/* 로그인 Behavior 구조 — 성공/실패 분기 */
const LOGIN_BEHAVIORS = [
  { id: 'input',   idx: '01', name: '사용자 입력', note: '로그인 화면',      layer: 0, row: 0 },
  { id: 'check',   idx: '02', name: '사용자 확인', note: '입력이 맞는지',    layer: 1, row: 0 },
  { id: 'auth',    idx: '03', name: '인증',        note: '비밀번호 확인',    layer: 2, row: 0 },
  { id: 'session', idx: '04', name: '세션 생성',   note: '로그인 상태 유지', layer: 3, row: -1 },
  { id: 'home',    idx: '05', name: '홈 이동',     note: '첫 화면으로',      layer: 4, row: -1 },
  { id: 'fail',    idx: '실패', name: '로그인 실패', note: '다시 시도해야 한다', layer: 3, row: 1, fail: true },
];

/* Qode 완료 시 구조에 삽입되는 동작 — 결과는 Software에 반영된다 */
const NEW_BEHAVIOR = {
  id: 'wait', idx: '새 동작', name: '30초 기다리기', note: '세 번 실패한 뒤',
  layer: 4, row: 1, made: true,
};

const LOGIN_EDGES_BEFORE = [
  ['input', 'check'], ['check', 'auth'],
  ['auth', 'session', '성공'], ['auth', 'fail', '실패'],
  ['session', 'home'],
];
const RETURN_EDGE_BEFORE = { from: 'fail', to: 'input', label: '다시 입력으로' };

const LOGIN_EDGES_AFTER = [
  ...LOGIN_EDGES_BEFORE, ['fail', 'wait'],
];
const RETURN_EDGE_AFTER = { from: 'wait', to: 'input', label: '다시 입력으로' };

/* Qode — 자동 준비된 것. 사용자가 고르지 않는다 */
const QODE = {
  ask: '로그인에 세 번 실패하면 30초 뒤에 다시 시도할 수 있게 해줘.',
  agent: 'Claude Code',
  contextCount: 4,
  skillCount: 1,
  context: ['로그인 규칙', '세션 정책', '실패 처리 기준', '한국어'],
  skill: '동작 추가',
  working: '로그인 실패 후 30초 대기 기능을 만드는 중',
  // 실제로 일어난 일. 진행률이 아니다 — 사건이다
  events: [
    { at: 400,  text: '요청 이해' },
    { at: 1500, text: '관련 로그인 동작 확인' },
    { at: 2900, text: '실패 흐름 수정' },
    { at: 4200, text: '동작 확인 중', pending: true },
  ],
  completeAt: 5600,
  result: {
    outcome: '로그인 실패 후 30초 뒤 다시 시도할 수 있게 됐습니다.',
    impact: '로그인',
    verified: 3,
    attention: 1,
    attentionText: '실제 사용자가 30초를 기다릴지',
    structural: '동작 1개 · 30초 기다리기',
  },
};
