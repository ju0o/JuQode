import { sheet, grid, spec, card, chip, btn, acts } from '../ui.mjs';

/* [이름, 대표 문구, 지금 되는가, 위험 등급, 안 되는 이유, 스크립트가 없어서인가] */
const RULES = [
  ['개발 서버를 켠다', '개발 서버 켜줘', true, 'run'],
  ['JuQode 가 켠 개발 서버를 끈다', '개발 서버 꺼줘', false, 'run',
    'JuQode 가 켠 개발 서버가 지금 없어요. JuQode 밖에서 켠 서버는 JuQode 가 끄지 않아요.', false],
  ['프로젝트를 빌드한다', '빌드해줘', true, 'run'],
  ['테스트를 실행한다', '테스트 돌려줘', true, 'run'],
  ['Git 작업 상태를 읽어서 보여준다', '변경사항 보여줘', true, 'read'],
  ['터미널 드로어를 연다', '터미널 열어줘', true, 'read'],
  ['지금 상태를 Git 저장점으로 남긴다', '커밋해줘', true, 'write'],
  ['프로젝트를 배포한다', '배포해줘', false, 'deploy',
    '이 프로젝트 package.json 에 그 스크립트가 없어서 정해진 방법을 몰라요. 방법을 지어내지 않아요.', true],
];
/* 등급은 누른 뒤 무엇이 남는지를 말한다. 저장과 배포는 PM 판정 2026-09-12 로 열렸다. */
const RISK = { read: ['읽기', 'var(--mut)'], run: ['실행', 'var(--claude)'],
               write: ['쓰기', 'var(--part)'], deploy: ['바깥으로', 'var(--fail)'] };

const WHY = [
  ['no_script', '이 프로젝트 package.json 에 그 스크립트가 없어서 정해진 방법을 몰라요. 방법을 지어내지 않아요.'],
  ['no_package_json', '프로젝트 루트에 package.json 이 없어요. 지금 Quick Command 는 Node 프로젝트만 지원해요.'],
  ['already_running', '개발 서버가 이미 돌고 있어요. 다시 켜려면 먼저 꺼 주세요.'],
  ['not_running', 'JuQode 가 켠 개발 서버가 지금 없어요. JuQode 밖에서 켠 서버는 JuQode 가 끄지 않아요.'],
  ['placeholder_script', 'package.json 의 test 스크립트가 npm 기본 자리표시자예요 — 실제 테스트가 없어요.'],
  ['not_git', '이 프로젝트 폴더는 Git 저장소가 아니에요.'],
  ['no_changes  (NEW)', '마지막 저장 이후 바뀐 게 없어요. 남길 것이 없어요.'],
  ['git_unavailable  (NEW)', '이 컴퓨터에서 git 을 실행하지 못했어요. 설치돼 있는지 확인해 주세요.'],
  ['unknown_rule', '정해진 Quick Command 가 아니에요.'],
  ['already-running', '이 동작은 지금 돌고 있어요. 끝나면 다시 할 수 있어요.'],
  ['not-executable', '이 동작을 실행할 방법을 찾지 못했어요.'],
  ['no-project', '열려 있는 프로젝트가 없어요.'],
];

const drawerChrome = (inner) => `
  <div style="background:var(--card); border:1px solid var(--line); border-radius:var(--r-card); overflow:hidden;">
    <div style="display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid var(--line);">
      <span style="font-weight:700; letter-spacing:.02em;">터미널</span>
      <span class="xs mut2">보조 도구 · 어떤 흐름에도 꼭 필요하지는 않아요</span>
      <span style="flex:1;"></span>${btn('닫기', 'ghost')}
    </div>
    <div style="padding:8px 16px; background:var(--grey); border-bottom:1px solid var(--line); font-size:12px; line-height:17px; color:var(--ink2);">
      <span style="font-weight:600; letter-spacing:.04em; text-transform:uppercase; margin-right:8px; opacity:.85;">안전 안내</span>여기서 치는 명령은 내 컴퓨터에서 내 권한으로 바로 실행돼요.
    </div>
    ${inner}
  </div>`;

const qcHead = `
  <div style="padding:14px 16px 0; display:flex; flex-direction:column; gap:10px;">
    <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
      <span class="xs" style="font-weight:700; letter-spacing:.08em; color:var(--juq);">QUICK COMMAND</span>
      <span class="xs mut">말로 적으면 정해진 규칙에 있는 명령만 실행해요</span>
      <span class="xs mut">Claude Code 작업이 아니에요 — JuQode가 정해진 규칙대로 실행해요</span>
    </div>
    <div style="display:flex; gap:8px;">
      <div class="inputbox" style="flex:1;">예: "개발 서버 켜줘" · "테스트 돌려줘" · "빌드해줘" · "Git 상태 보여줘"</div>
      <button class="btn pri" type="button">보내기</button>
    </div>
  </div>`;

const shellLine = (extra = '') => `
  <div style="border-top:1px solid var(--line); padding:12px 16px 14px; display:flex; flex-direction:column; gap:8px; background:var(--card2);">
    <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
      <span class="xs" style="font-weight:700; letter-spacing:.08em; color:var(--juq);">셸 명령줄</span>
      <span class="xs mut">내가 직접 치는 명령이에요 — JuQode가 고르지 않아요</span>
    </div>
    <div class="xs mut2">sudo · ssh · 비밀번호를 묻는 명령은 여기서 답할 수 없어요 — 묻지도 못한 채 끝나요. 색은 나오지 않고, 나오는 순서가 실제 순서와 다를 수 있어요.</div>
    ${extra}
    <div style="display:flex; gap:8px;">
      <span class="mono" style="display:flex; align-items:center; padding:0 2px; font-weight:700; color:var(--ink2);">$</span>
      <div class="inputbox mono" style="flex:1; font-size:12.5px;">예: git status · ls -al · npm ls</div>
      <button class="btn" type="button">실행</button>
    </div>
  </div>`;

export default [
  {
    name: 'TD01-Main', w: 1000, h: 800,
    body: `<div class="stack">
      <div style="display:flex; flex-direction:column; gap:2px;">
        <div class="h1">TD-01 · 터미널 서랍</div>
        <div class="lead">어느 화면에서나 열린다. 서랍 안에 Input 이 둘이고, 누른 다음 벌어지는 일이 서로 다르다.</div>
      </div>
      ${drawerChrome(`
        ${qcHead}
        <div style="padding:10px 16px 16px; display:flex; flex-direction:column; gap:10px;">
          ${card(`
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="actor juq">JUQODE</span>
              <span class="xs" style="color:var(--juq); font-weight:600;">Quick Command</span>
            </div>
            <div style="display:flex; gap:10px;"><span class="xs mut2" style="flex:0 0 5.5em;">이해한 것</span><span class="sm">테스트를 돌려 달라는 요청으로 이해했어요.</span></div>
            <div style="display:flex; gap:10px;"><span class="xs mut2" style="flex:0 0 5.5em;">실행할 명령</span><span class="sm mono">npm run test</span></div>
            <div style="display:flex; gap:10px;"><span class="xs mut2" style="flex:0 0 5.5em;">하는 일</span><span class="sm">프로젝트에 적힌 자동 검사들을 실행해서 통과/실패를 확인해요. 소스 파일은 바뀌지 않아요.</span></div>
            ${acts(btn('실행', 'pri'), btn('취소', 'ghost'))}
            <div class="xs mut2">명령은 정해진 규칙에서만 나와요 — AI가 명령을 지어내지 않아요</div>`)}
          ${btn('▸ 할 수 있는 것 보기', 'rec ghost')}
        </div>
        ${shellLine()}
      `)}
      <div class="panel juq">
        <div class="t sm">WBS-22d — 머리는 고정, 본문만 스크롤</div>
        <div class="xs">라벨과 입력칸은 결과가 길어져도 제자리에 있는다. 전에는 셋이 한 스크롤 영역이라 카드가 길어지면 입력칸이 위로 사라졌고, 바로 아래 셸 칸은 고정이었다 — 같은 서랍의 두 Input 이 서로 다르게 행동했다.</div>
      </div>
    </div>`,
  },
  {
    name: 'TD01-Route', w: 1200, h: 480,
    body: sheet('TD-01 · 말이 읽히는 네 갈래',
      '19 §C4 — 규칙이지 모델이 아니다. 같은 입력은 언제나 같은 답을 낸다. 알아내는 방식은 아는 낱말을 빼고 남는 것이 없어야 한다는 것뿐이다(잔여 0).', `
      ${grid(`
        ${spec('인식됨', '대상어와 동사가 다 소모되고 남은 글자가 없다.', card(`
          <span class="actor juq">JUQODE</span>
          <div class="sm">빌드해줘 → 프로젝트를 빌드해 달라는 요청으로 이해했어요.</div>
          <div class="sm mono">npm run build</div>
          ${acts(btn('실행', 'pri'), btn('취소', 'ghost'))}`))}
        ${spec('미인식 — 오류가 아니라 분기', '"rm -rf 해줘" · "서버 켜고 빌드도 해줘" 처럼 글자가 남는 모든 것. 중립색으로 그린다.', card(`
          <div class="t">바로 할 수 있는 동작은 아니에요</div>
          <div class="sm">정해진 Quick Command 에 없어요. 짐작해서 실행하지는 않아요.</div>
          ${acts(btn('▸ Claude Code 작업으로 보내기', 'rec'), btn('▸ 할 수 있는 것 보기', 'rec'))}`, 'border-color:var(--line2);'))}
        ${spec('모호함 — 둘로 읽힌다', '대상어는 맞는데 동사가 두 뜻이거나, 동사만 있고 대상이 없다. 실행하지 않는다.', card(`
          <div class="t">두 가지로 읽을 수 있어서 실행하지 않았어요. 어느 쪽인지 골라 주세요.</div>
          ${acts(btn('개발 서버를 끈다'), btn('Claude Code 작업으로'))}`, 'border:1px dashed var(--line3);'))}
      `, 3, 20)}
      <div class="panel unk">
        <div class="t sm">이것은 탐지가 아니다</div>
        <div class="xs">위험한 말을 알아보는 목록이 아니다. 여덟 가지를 알아보고 나머지를 전부 사양한다 — 위험을 탐지한다고 말하는 순간, 걸리지 않은 것은 안전하다고 가르치게 된다.</div>
      </div>`),
  },
  {
    name: 'TD01-Rules', w: 1100, h: 700,
    body: sheet('TD-01 · 할 수 있는 것 여덟  (NEW · 눌러서 고른다)',
      'F-17 은 여섯으로 닫혀 있었다. 저장과 배포는 PM 판정 2026-09-12 로 열렸고, Canon 19 §C4 · 20 은 아직 갱신되지 않았다.', `
      ${card(`
        <div class="ct">무엇을 말할 수 있나요?</div>
        <div class="xs mut">지금 할 수 있는 것을 누르면 그 말이 위 칸에 적혀요. 다음엔 직접 적으셔도 돼요.</div>
        <div style="display:flex; flex-direction:column; gap:2px;">
          ${RULES.map(([name, ex, ok, risk, why, noScript]) => `
            <div style="display:flex; align-items:center; gap:8px; padding:5px 6px; border-radius:var(--r-inner);
                        ${ok ? 'background:var(--card2);' : ''}">
              <span class="xs" style="flex:0 0 4.5em; color:${RISK[risk][1]};">${RISK[risk][0]}</span>
              <span class="sm" style="flex:1; min-width:0;">${name}</span>
              ${ok ? `<span class="xs mut mono">"${ex}"</span>` : ''}
              <span class="chip ${ok ? 'ok' : 'unavail'}">${ok ? '가능' : '지금은 안 돼요'}</span>
            </div>
            ${ok ? '' : `<div style="padding:0 6px 6px; display:flex; flex-direction:column; gap:6px;">
              <div class="xs mut">${why}</div>
              ${noScript ? `<div>${btn('▸ 방법을 만들어 달라고 요청', 'rec ghost')}</div>` : ''}
            </div>`}`).join('')}
        </div>
        ${acts(btn('취소', 'ghost'))}`)}
      ${grid(`
        <div class="panel juq">
          <div class="t sm">누르면 실행되지 않는다</div>
          <div class="xs">그 말이 입력칸에 적히고 설명 카드가 뜬다. 확인은 그대로 사람이 한다 — 19 §C4 의 설명 후 확인은 목록에서 골랐다고 건너뛰지 않는다.</div>
        </div>
        <div class="panel wait">
          <div class="t sm">배포 카드에만 붙는 줄</div>
          <div class="xs">배포는 이 컴퓨터 밖으로 나가는 동작이에요. JuQode 의 되돌리기로는 되돌릴 수 없어요.</div>
        </div>
        <div class="panel rec">
          <div class="t sm">막다른 길에서 나가는 길  (NEW)</div>
          <div class="xs">사용 불가 이유가 <span class="mono">no_script</span> 인 줄에만 「방법을 만들어 달라고 요청」이 붙는다 — 위에서는 배포가 그 경우다. 서버가 안 켜져 있어서 못 끄는 것은 스크립트 문제가 아니므로 붙지 않는다. 스크립트를 쓰는 것은 파일 변경이라 Work 가 할 수 있다.</div>
        </div>`, 3, 16)}`),
  },
  {
    name: 'TD01-Unavailable', w: 1200, h: 560,
    body: sheet('TD-01 · 사용 불가 열두 가지 이유',
      '12 §16 — 사용 불가는 실패가 아니다. 어느 것도 빨강을 쓰지 않고, 어느 것도 침묵하지 않는다. 이유는 키이고, 한국어는 렌더러 한 곳에서만 만들어진다.', `
      ${grid(WHY.map(([key, txt]) => `
        <div class="card" style="padding:12px 14px; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="speclabel mono" style="text-transform:none;">${key}</span>
            ${chip('unavail', '지금 안 됨')}
          </div>
          <div class="sm">${txt}</div>
        </div>`).join(''), 3, 14)}`),
  },
  {
    name: 'TD01-Run', w: 1200, h: 700,
    body: sheet('TD-01 · 실행 카드 일곱 상태',
      '07 §8.1 — 취소된 자식도 0 으로 끝날 수 있다. 그래서 끝났다는 것이 잘 됐다로 읽히는 일은 없다: 종료 코드와 신호를 함께 보고 셋 중 하나를 고른다.', `
      ${grid(`
        ${spec('실행 중', '마지막 세 줄이 살아 움직인다.', card(`
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">${chip('wait', '실행 중')}<span class="xs mut mono">npm run test</span></div>
          <pre class="mono" style="margin:0; font-size:11px; background:var(--card2); border:1px solid var(--line); border-radius:var(--r-inner); padding:8px 10px;">PASS  src/auth/token.test.ts
PASS  src/cart/total.test.ts</pre>
          ${acts(btn('멈추기', 'cancel'))}`))}
        ${spec('계속 실행 중', '개발 서버처럼 끌 때까지 도는 것. 서랍을 닫아도 계속 돈다.', card(`
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">${chip('wait', '계속 실행 중')}<span class="xs mut mono">npm run dev</span></div>
          <div class="xs mut2">끄기 전까지 계속 켜져 있는 동작이에요.</div>
          ${acts(btn('멈추기', 'cancel'), btn('켜 둔 채로 다음 요청', 'ghost'))}`))}
        ${spec('끝났어요', '종료 코드 0 이고 신호가 없다.', card(`
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">${chip('ok', '끝났어요')}<span class="xs mut2">종료 코드 0</span></div>
          ${acts(btn('출력 보기', 'ghost'), btn('▸ 다시 실행', 'ghost'), btn('취소', 'ghost'))}`))}
      `, 3, 20)}
      ${grid(`
        ${spec('실행이 실패했어요  (NEW · 출력이 요청으로 간다)', '종료 코드가 0 이 아니다. 사용자는 오류를 읽을 수 없으므로, 출력이 다음 요청의 초안으로 따라간다.', card(`
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">${chip('fail', '실행이 실패했어요')}<span class="xs mut2">종료 코드 1</span></div>
          <pre class="mono" style="margin:0; font-size:11px; background:var(--card2); border:1px solid var(--failline); border-radius:var(--r-inner); padding:8px 10px;">FAIL  src/auth/token.test.ts
  expected null, received object</pre>
          ${acts(btn('▸ Claude Code 작업으로 요청', 'rec'), btn('▸ 다시 실행', 'rec'))}
          <div class="xs mut2">토큰처럼 보이는 값은 화면에서만 가려요. 전부 걸러내지는 못하고, 원래 내용은 터미널과 로그에 그대로 있어요.</div>`))}
        ${spec('멈춤 요청함 → 멈췄어요', '신호를 보냈다. 멈춘 것을 본 뒤에야 멈췄다고 말한다.', card(`
          <div style="display:flex; gap:8px; flex-wrap:wrap;">${chip('wait', '멈춤 요청함')}${chip('', '멈췄어요')}</div>
          <div class="xs mut2">멈추면 이 터미널 세션이 끝나요. 명령 하나만 멈출 수는 없어요.</div>`))}
        ${spec('끝났는지 확인할 수 없어요', '이 프로세스가 시작하지 않은 실행이거나 관찰자가 사라졌다. 종료 코드는 비어 있다 — 아무도 보지 못했으니까.', card(`
          <div style="display:flex; align-items:center; gap:8px;">${chip('unk', '끝났는지 확인할 수 없어요')}</div>
          <div class="xs mut2">종료 코드 없음</div>`))}
      `, 3, 20)}`),
  },
  {
    name: 'TD01-Shell', w: 1200, h: 680,
    body: sheet('TD-01 · 셸 명령줄 네 상태  (DV-11: 파이프 셸)',
      '19 §C4 — 사용자가 사용자로 실행한다. 걸러내는 척하지 않는다. 아래 한계는 지어낸 것이 아니라 이 구현이 실제로 가진 것이고, 화면이 그것을 말한다.', `
      ${grid(`
        ${spec('아직 친 명령 없음', '서랍을 여는 것만으로는 프로세스를 띄우지 않는다. 첫 명령이 그 동의다.',
          card(`<div class="xs mut2">셸 없음</div><div class="sm mut">아직 친 명령이 없어요.</div>`))}
        ${spec('실행 중', '앞 명령이 끝나기 전에는 다음 줄을 받지 않는다 — 작업 제어가 없다.',
          card(`<div style="display:flex; gap:8px; align-items:center;">${chip('wait', '실행 중')}<span class="sm mono">npm ls</span></div>
            <div class="xs mut2">앞 명령이 아직 돌고 있어요.</div>`))}
        ${spec('끝남', '마커 프로토콜이 종료 코드를 물어 온다. 프롬프트가 없는 셸에서 줄의 끝을 아는 유일한 방법이다.',
          card(`<div style="display:flex; gap:8px; align-items:center;">${chip('ok', '종료 코드 0')}<span class="sm mono">ls -al</span></div>`))}
      `, 3, 20)}
      ${grid(`
        ${spec('세션이 끝났어요', '사용자의 exit · 크래시 · 프로젝트 전환. 다음 명령을 치면 새로 시작한다.',
          card(`<div class="sm mut">세션이 끝났어요. 다음 명령을 치면 새로 시작해요.</div>`))}
        ${spec('터미널을 열 수 없어요', '셸을 띄우지 못했다. 같은 내용을 볼 수 있는 다른 길을 준다.',
          card(`<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="t">터미널을 열 수 없어요</span>${chip('unavail', '지금 안 됨 · 실패 아님')}</div>
            <div class="sm">터미널을 시작하지 못했어요. 같은 내용은 다른 곳에서도 볼 수 있어요.</div>
            ${acts(btn('▸ Quick Command 출력으로 확인', 'rec'), btn('▸ Raw Diff로 확인', 'rec'))}`))}
        ${spec('답할 수 없는 명령  (NEW)', 'sudo · ssh · git push 같은 명령을 친 그 순간. 막지 않는다 — 줄은 이미 셸에 들어갔고, 화면이 한 줄 더 말할 뿐이다.',
          `<div class="panel wait">
            <div class="sm">이 명령은 비밀번호나 확인을 물어볼 수 있어요. 여기서는 물음에 답할 수 없어서, 아무 말 없이 끝날 수 있어요. 이럴 땐 내 컴퓨터의 터미널 앱에서 직접 실행해 주세요.</div>
          </div>`)}
      `, 3, 20)}
      <div class="panel unk">
        <div class="t sm">이 목록은 완전하지 않고, 그렇게 말한다</div>
        <div class="xs">위험 탐지가 아니라 이 구현이 대답해 줄 수 없는 질문을 하는 프로그램의 목록이다. 빠진 것이 있어도 그것은 안전하다는 뜻이 아니다.</div>
      </div>`),
  },
];
