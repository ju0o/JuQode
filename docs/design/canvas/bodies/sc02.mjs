import { sheet, grid, spec, card, chip, btn, acts, nextacts, topbar } from '../ui.mjs';

const Q = ['하는 일', '주요 기능', '쓰인 기술', '폴더가 하는 일', '실행 방법', '확인 못한 것'];

const answer = (i, txt, kind, chipTxt) => `
  <div style="display:flex; gap:10px; align-items:baseline;">
    <span class="xs mut2" style="flex:0 0 5.5em;">${Q[i]}</span>
    <span style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;">
      <span class="sm">${txt}</span>
      <span>${chip(kind, chipTxt)}</span>
    </span>
  </div>`;

const briefBody = `
  ${answer(0, '온라인 상점의 주문을 받는 웹 앱이에요.', 'ok', '확인됨')}
  ${answer(1, '상품 목록 · 장바구니 · 결제', 'part', '예상됨')}
  ${answer(2, 'React · Vite · TypeScript', 'ok', '확인됨')}
  ${answer(3, 'src/ 에 화면, api/ 에 서버 코드가 있어요.', 'ok', '확인됨')}
  ${answer(4, 'npm run dev 로 실행해요.', 'ok', '확인됨')}
  ${answer(5, '테스트가 어떻게 도는지는 확인 못했어요.', 'unk', '확인 못함')}`;

const briefCard = (head, body, foot = '') => card(`
  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
    <span class="ct">이 프로젝트가 하는 일</span><span class="grow"></span>${head}
  </div>
  ${body}${foot}`);

const intent = card(`
  <div class="ct">요청 · 프로젝트를 바꾸는 요청</div>
  <div class="inputbox">이 프로젝트에서 바꾸고 싶은 것을 말로 적어요</div>
  <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
    <button class="btn pri" type="button">보내기</button>
    <span class="xs mut2">작업을 보내면 파일을 바꾸는 데 동의한 것으로 봐요.</span>
  </div>
  <div class="xs mut2">예: "로그인 오류 고쳐줘" · "회원가입 화면을 추가해줘" · "이 버튼을 왼쪽으로 옮겨줘"</div>
  <div class="xs mut2">개발 서버 · 테스트 · 빌드 · git 같은 기술 명령은 터미널의 Quick Command에서 해요.</div>`);

export default [
  {
    name: 'SC02-Main', w: 1300, h: 860,
    body: `${topbar('SC-02 · 작업대')}
      <div style="padding:20px; display:grid; grid-template-columns:minmax(0,1.62fr) minmax(0,1fr); gap:16px;">
        <div style="display:flex; flex-direction:column; gap:16px;">
          ${briefCard(`<span class="xs mut2">읽은 시점 14:02:11</span>${btn('다시 읽기', 'ghost')}${btn('접기', 'ghost')}`, briefBody)}
          ${intent}
        </div>
        <div style="display:flex; flex-direction:column; gap:16px;">
          ${card(`
            <div class="ct">기록</div>
            <div class="sm mut">진행 중인 작업은 없어요. 지난 작업은 기록에 있어요.</div>
            <div style="display:flex; flex-direction:column; gap:10px;">
              <div style="border-top:1px solid var(--line); padding-top:8px; display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span class="t sm">로그인 오류 고쳐줘</span>${chip('ok', '끝남')}
                </div>
                <div class="xs mut2">변경 4개</div>
                ${acts(btn('결과 보기', 'ghost'), btn('변경 보기', 'ghost'))}
              </div>
              <div style="border-top:1px solid var(--line); padding-top:8px; display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span class="t sm">장바구니 수량 버튼 추가해줘</span>${chip('part', '일부')}
                </div>
                ${acts(btn('결과 보기', 'ghost'), btn('변경 보기', 'ghost'))}
              </div>
            </div>
            <div class="xs mut2">끝난 작업은 사라지지 않아요. 실패하거나 멈춘 작업도 남아요.</div>`)}
        </div>
      </div>`,
  },
  {
    name: 'SC02-Brief', w: 1200, h: 1120,
    body: sheet('SC-02 · Brief 상태', 'D-132 · 19 §C1 ⑤ — 다시 읽기는 사람만 시작한다. 자동 재해석은 없다.', `
      ${grid(`
        ${spec('해석 중', '처음 연 프로젝트. 진행률을 지어내지 않는다 — 읽은 파일만 말한다.',
          briefCard('', `<div class="sm mut">프로젝트를 읽고 있어요</div>
            <div class="xs mut2">읽는 동안에도 요청할 수 있어요.</div>
            <div class="xs mut2 mono">지금 읽는 파일 · package.json</div>`))}
        ${spec('해석됨', '여섯 답이 다 있다. 확인됨은 근거를 지목한 답에만 붙는다.',
          briefCard(`<span class="xs mut2">읽은 시점 14:02:11</span>`, briefBody))}
        ${spec('부분', '상한(2,000 파일 / 5 MB)에 걸려 일부를 못 읽었다.',
          briefCard('', `${briefBody}
            <div class="xs" style="color:var(--part);">여섯 가지 중 일부는 확인하지 못했어요. 나머지는 '확인 못함'으로 남겨 두었어요.</div>`))}
      `, 3, 20)}
      ${grid(`
        ${spec('실패', '폴더를 읽지 못했다. 요청·Quick Command·터미널은 그대로 쓸 수 있다.',
          briefCard('', `<div class="panel fail">
            <div class="t">프로젝트를 읽지 못했어요</div>
            <div class="sm">요청과 Quick Command, 터미널은 그대로 쓸 수 있어요.</div>
          </div>${acts(btn('다시 읽기'))}`))}
        ${spec('오래됨', '트리 해시가 달라졌다. 알릴 뿐, 저절로 다시 읽지 않는다.',
          briefCard('', `<div class="panel wait">
            <div class="sm">3일 전에 읽은 내용이에요. 그 뒤로 프로젝트가 바뀌었을 수 있어요.</div>
            ${acts(btn('다시 읽기'), btn('이대로 계속', 'ghost'))}
          </div>${briefBody}`))}
        ${spec('갱신 중 · 갱신 실패', '지난 내용이 화면에 남아 있는 채로 다시 읽는다(F-C1-03). 실패하면 남긴 것을 그대로 둔다.',
          briefCard(`<span class="xs mut2">다시 읽는 중…</span>`, `
            <div class="panel unk"><div class="sm">아래는 지난번에 읽은 내용이에요. 그대로 남겨 두었어요.</div></div>
            ${briefBody}`))}
      `, 3, 20)}`),
  },
  {
    name: 'SC02-Empty', w: 820, h: 520,
    body: sheet('SC-02 · 빈 폴더  (NEW)', '열 때의 readdir 하나가 근거다. 추가로 디스크를 보지 않는다. Work 가 하나라도 생기면 이 상태는 끝난다.', `
      ${spec('빈 폴더', '점(.) 으로 시작하지 않는 파일이 하나도 없는 폴더를 열었을 때. Brief 자리를 대신한다.',
        card(`
          <div class="ct">이 프로젝트가 하는 일</div>
          <div class="t">이 폴더는 아직 비어 있어요</div>
          <div class="sm">읽을 파일이 없어서 설명해 드릴 것도 아직 없어요. 무엇을 만들고 싶은지 적어 주시면 Claude Code가 첫 파일부터 만들어요.</div>
          ${nextacts('다음 행동', btn('무엇을 만들지 적어 보기', 'pri'))}`), 740)}
      <div class="panel juq" style="width:740px;">
        <div class="t sm">누르면 일어나는 일</div>
        <div class="xs">요청 칸에 <span class="mono">만들고 싶은 것:</span> 까지가 적히고 커서가 그 뒤에 선다. <b>보내지 않는다</b> — 12 는 보내기를 파일 변경의 동의로 본다.</div>
      </div>`),
  },
  {
    name: 'SC02-Refusals', w: 1200, h: 700,
    body: sheet('SC-02 · 시작하지 못하는 네 가지', '전부 실패가 아니라 이유다. 어느 것도 Work 행을 만들지 않는다 — 20: 기록은 시작된 작업이다.', `
      ${grid(`
        ${spec('가드 · D-117', '같은 프로젝트에서 다른 Work 가 진행 중. 적은 말은 칸에 그대로 남는다.', card(`
          <div class="t">지금 진행 중인 작업이 있어요</div>
          <div class="sm">한 프로젝트에서는 한 번에 하나의 작업만 해요. 끝나거나 취소된 뒤에 다시 보낼 수 있어요. 적은 내용은 아래 칸에 그대로 두었어요.</div>
          ${acts(btn('열기'), btn('답하기', 'ghost'), btn('이 작업 취소', 'cancel'), btn('기다리기', 'ghost'))}
          <div class="xs mut2">요청을 줄 세우거나 동시에 돌리지 않아요.</div>`))}
        ${spec('증거 기준 확립 불가', 'Git 저장소가 아니거나 머지 중이거나 읽을 수 없는 경로가 있다.', card(`
          <div class="t">이 프로젝트에서는 변경 작업을 시작하지 않아요</div>
          <div class="sm">무엇이 바뀌었는지 정확히 확인할 방법이 없어서요. 확인할 수 없는 변경은 만들지 않아요.</div>
          <div class="ct">지금 할 수 있는 것</div>
          ${acts(btn('▸ 프로젝트 설명 읽기', 'rec'), btn('▸ Quick Command 쓰기', 'rec'), btn('▸ 터미널로 직접 확인', 'rec'))}`))}
      `, 2, 20)}
      ${grid(`
        ${spec('시작 실패', '세션이 한 줄도 말하지 못하고 꺼졌다. 기록에 남지 않는다.', card(`
          <div class="t">작업을 시작하지 못했어요</div>
          <div class="sm">Claude Code가 시작하자마자 꺼졌어요. 프로젝트 파일은 바뀌지 않았어요. 시작되지 않은 작업은 기록에 남지 않아요.</div>
          ${acts(btn('▸ 다시 보내기', 'rec'), btn('▸ 자세한 출력 보기', 'ghost'))}`))}
        ${spec('Claude Code 사용 불가', '설치되지 않았거나 로그인이 필요하거나 응답이 없다. 실패가 아니다.', card(`
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="t">지금은 Claude Code를 쓸 수 없어요</span>${chip('unavail', '지금 안 됨 · 실패 아님')}
          </div>
          <div class="sm">실패한 게 아니에요. 해결되면 같은 요청을 다시 보낼 수 있어요.</div>
          <div class="sm t">Claude Code에 로그인이 필요해요</div>
          ${acts(btn('▸ 프로젝트 설명 읽기', 'rec'), btn('▸ Quick Command 쓰기', 'rec'), btn('▸ 해결한 뒤 다시 보내기', 'rec'))}`))}
      `, 2, 20)}`),
  },
  {
    name: 'SC02-Routing', w: 1200, h: 520,
    body: sheet('SC-02 · 요청이 읽히는 세 갈래', 'F-C4-01 — 미인식은 오류가 아니라 분기다. JuQode 가 대신 고르지 않는다.', `
      ${grid(`
        ${spec('Claude Code 작업', '프로젝트를 바꾸는 요청으로 읽힌다. 기본 경로.', card(`
          <span class="actor claude">CLAUDE CODE</span>
          <div class="sm">Claude Code에게 작업으로 보내요.</div>
          <div class="sm mono">"로그인 오류 고쳐줘"</div>`))}
        ${spec('기술 명령 (터미널로)', '여덟 규칙 중 하나로 인식된다. 여기서 실행하지 않고 서랍으로 보낸다.', card(`
          <span class="actor juq">JUQODE</span>
          <div class="sm">기술 명령이에요. 터미널의 Quick Command에서 실행해요.</div>
          <div class="sm mono">"테스트 돌려줘"</div>
          ${acts(btn('터미널 열기'))}`))}
        ${spec('두 가지로 읽힘', '대상어는 맞는데 동사가 두 뜻이다. 실행하지 않고 묻는다.', card(`
          <div class="t">두 가지로 읽혀요</div>
          <div class="sm">어느 쪽인지 골라 주세요. JuQode가 대신 정하지 않아요.</div>
          ${acts(btn('개발 서버 끄기'), btn('Claude Code 작업으로 보내기'), btn('▸ 다시 적기', 'ghost'))}`))}
      `, 3, 20)}`),
  },
];
