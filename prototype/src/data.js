"use strict";
/* ══════════════════════════════════════════════════════════════════════════
   JuQode Phase 4A — 하나의 시연 Software
   여기에 있는 것은 전부 목(mock)이다. 실행도, 파일도, 결과도.
   목이 아닌 것은 사용자의 상호작용 하나다.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 자리 = 의미. 좌표·질량·방향은 동결 설계와 같은 값이다 ─────────────── */
var PLACES = [
  {id:'intake', name:'요청 받기',  x:250,y:168, rx:152,ry:60, rot: 0.10, amp:0.55, mass:0.30, dir:  0},
  {id:'auth',   name:'로그인',     x:418,y:246, rx:150,ry:84, rot:-0.10, amp:0.92, mass:0.55, dir: 34},
  {id:'session',name:'세션 유지',  x:596,y:306, rx:128,ry:62, rot: 0.16, amp:0.60, mass:0.50, dir: 20},
  {id:'pay',    name:'결제 요청',  x:576,y:172, rx:106,ry:54, rot:-0.24, amp:0.42, mass:0.25, dir: 50},
  {id:'store',  name:'사용자 저장',x:262,y:334, rx:178,ry:74, rot: 0.05, amp:1.06, mass:0.95, dir:-44}
];
var VOIDS = [{x:520,y:190,rx:40,ry:27,depth:0.90}];

/* ── 문제 = 그 자리의 결이 어긋나거나 끊긴 상태 ──────────────────────────
   misalign : 이어져 있으나 주위와 안 맞는다
   break    : 양쪽 결이 만나지 못한다 (더 센 실패)                        */
var PROBLEM_DEFS = {
  pay: {
    place:'pay', title:'결제 요청', human:'응답이 늦어요 · 3번 중 2번',
    kind:'misalign',
    seam:{x:576,y:174,rx:112,ry:64,off:0.130,res:0.52,tint:2},
    amp:0.42,
    context:['결제 요청','외부 결제 호출','최근 실행 기록 3건'],
    working:'외부 호출에 재시도와 대기 시간을 넣는 중',
    result:{
      title:'결제 요청이 달라졌어요.',
      body:'외부 결제 호출에 재시도와 대기 시간을 넣었습니다.',
      measure:'같은 요청 20회 · 모두 3초 이내 · 실패 0',
      changed:'src/payments/gateway.ts · 재시도 3회 · 대기 2초'
    },
    settledAmp:0.54
  },
  store: {
    place:'store', title:'사용자 저장', human:'가끔 목록이 비어요',
    kind:'misalign',
    seam:{x:262,y:332,rx:150,ry:66,off:0.110,res:0.52,tint:2},
    amp:1.06,
    context:['사용자 저장','목록 읽기','최근 실행 기록 2건'],
    working:'목록을 읽는 순서를 저장이 끝난 뒤로 옮기는 중',
    result:{
      title:'사용자 저장이 달라졌어요.',
      body:'저장이 끝난 것을 확인한 뒤에 목록을 읽도록 했습니다.',
      measure:'목록 20회 · 모두 채워짐 · 빈 목록 0',
      changed:'src/users/list.query.ts · 저장 완료 대기'
    },
    settledAmp:1.00
  },
  session: {
    place:'session', title:'세션 유지', human:'실행 중 연결이 끊겨요 · 로그인 후 4초',
    kind:'break',
    seam:{x:594,y:304,rx:128,ry:76,off:0.170,res:0.52,tint:2,brk:1},
    amp:0.74,
    context:['세션 유지','로그인','방금 실행 기록 1건'],
    working:'로그인 후 토큰 갱신 시점을 앞으로 옮기는 중',
    result:{
      title:'세션 유지가 달라졌어요.',
      body:'로그인 직후 토큰을 미리 갱신하도록 했습니다.',
      measure:'로그인 20회 · 연결 유지 20회 · 끊김 0',
      changed:'src/auth/refresh.ts · 갱신 시점 -30초'
    },
    settledAmp:0.60
  }
};

/* ── 깊은 기술적 사실 — 전부 선택된 자리에 매여 있다 ─────────────────────
   이 자리 밖의 파일은 여기 없다. 그것이 이 화면의 논지다.                */
var ANATOMY = {
  session:{
    files:[['src/auth/session.ts','로그인과 공유'],['src/auth/refresh.ts',''],
           ['src/api/session.route.ts',''],['supabase/migrations/0009_session.sql','',1]],
    rel:[['POST /session/refresh',''],['sessions','테이블'],['Supabase Auth','',1]],
    ev:[['로그인 후 4초 · 연결 종료','×3'],['tests/session.spec.ts','실패 1'],['직전 평형 · 3일 전','',1]]
  },
  pay:{
    files:[['src/payments/request.ts','결제 시작'],['src/payments/gateway.ts',''],
           ['src/api/pay.route.ts',''],['src/config/timeout.ts','',1]],
    rel:[['POST /pay/authorize',''],['외부 결제사 API',''],['payments','테이블',1]],
    ev:[['응답 3회 중 2회 5초 초과',''],['tests/pay.spec.ts','실패 1'],['직전 평형 · 12분 전','',1]]
  },
  store:{
    files:[['src/users/store.ts','저장'],['src/users/list.query.ts',''],
           ['src/api/users.route.ts',''],['supabase/migrations/0007_users.sql','',1]],
    rel:[['GET /users',''],['users','테이블'],['캐시 계층','',1]],
    ev:[['목록 20회 중 3회 비어 있음',''],['tests/users.spec.ts','실패 1'],['직전 평형 · 어제','',1]]
  },
  auth:{
    files:[['src/auth/login.ts','세션과 공유'],['src/auth/password.ts',''],
           ['src/api/login.route.ts',''],['supabase/migrations/0004_auth.sql','',1]],
    rel:[['POST /login',''],['users','테이블'],['Supabase Auth','',1]],
    ev:[['로그인 200회 · 실패 0',''],['tests/login.spec.ts','통과'],['직전 평형 · 3일 전','',1]]
  },
  intake:{
    files:[['src/http/router.ts','들어오는 문'],['src/http/validate.ts',''],
           ['src/api/index.ts',''],['src/http/rate.ts','',1]],
    rel:[['GET /health',''],['모든 경로의 입구',''],['프록시 설정','',1]],
    ev:[['요청 1만 건 · 거절 0',''],['tests/router.spec.ts','통과'],['직전 평형 · 3일 전','',1]]
  }
};

/* ── 런처 — 최근 Software. 4A에서 열리는 것은 하나다 ─────────────────── */
var RECENT = [
  {id:'order', name:'주문 서비스', human:'결제 응답이 늦고, 저장한 목록이 가끔 비어요',
   when:'12분 전', open:true},
  {id:'dash',  name:'사내 대시보드', human:'지난번에 고친 뒤로 조용해요',
   when:'어제', open:false},
  {id:'pipe',  name:'문서 파이프라인', human:'정리됐어요 · 아직 JuQode가 모르는 곳 1',
   when:'3일 전', open:false}
];

/* ── 실행 = 관측. 무엇을 보게 되는가 ──────────────────────────────────── */
var RUN_OBSERVE = {
  finds:'session',                       /* 아직 모르는 문제 하나를 실제로 들여온다 */
  watching:'실제 동작을 지켜보는 중 · 로그인 → 주문 → 결제',
  known:'이미 아는 문제만 다시 보였어요',
  clean:'새로 발견한 문제가 없어요'
};
