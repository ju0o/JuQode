import { sheet, grid, spec, card, chip, btn, acts, nextacts, topbar } from '../ui.mjs';

const step = (state, title) => {
  const mark = { done: '✓', running: '·', declared_next: '▸', not_executed: '×' }[state];
  const col = { done: 'var(--rec)', running: 'var(--claude)', declared_next: 'var(--mut)', not_executed: 'var(--mut2)' }[state];
  return `<div style="display:flex; align-items:baseline; gap:8px;">
    <span class="xs" style="width:12px; color:${col};">${mark}</span>
    <span class="sm" style="${state === 'not_executed' ? 'color:var(--mut2);' : ''}">${title}</span>
  </div>`;
};

const presenceDot = (tint, dash, still) => `
  <span style="width:44px; height:44px; border-radius:50%; flex:0 0 auto;
    border:${dash ? '2px dashed' : '2px solid'} var(${tint});
    background:color-mix(in srgb, var(${tint}) 18%, transparent);
    opacity:${still ? '.75' : '1'};"></span>`;

const MODES = [
  ['idle', '--claude', '대기 중', 'Work 가 없거나 아직 시작 전'],
  ['activity', '--claude', '최근 활동이 보여요', '신호가 계속 오는 중'],
  ['input', '--wait', '답을 기다리고 있어요', 'Claude Code 가 물었다'],
  ['permission', '--wait', '허용을 기다리고 있어요', '도구가 거부됐다 · 두 겹 점선 고리'],
  ['nosignal', '--mut', '잠시 새 활동이 보이지 않아요', '2분 침묵 — 판단이 아니라 관찰'],
  ['unknown', '--unk', '지금은 상태를 확인할 수 없어요', '점선 · 깜빡임'],
  ['complete', '--rec', '작업이 끝났어요', '가라앉는 모션 한 번'],
  ['cancelled', '--ink2', '멈췄어요', '취소는 실패가 아니다'],
  ['failure', '--fail', '끝내지 못했어요', '멈춘 채 · 가운데 코어'],
];

const workCard = (chipHtml, extra = '') => card(`
  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
    <span class="actor claude">CLAUDE CODE</span>${chipHtml}
  </div>
  <div class="t">로그인 오류 고쳐줘</div>
  <div class="xs mut2">Claude Code 작업 · 시작 전 상태를 기록해 두었어요</div>
  ${extra}`);

export default [
  {
    name: 'SC03-Main', w: 1300, h: 860,
    body: `${topbar('SC-03 · Work')}
      <div style="padding:20px; display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:16px; align-content:start;">
        <div style="grid-column:span 2; grid-row:span 2;">${workCard(chip('wait', '진행 중'), `
          <div style="display:flex; align-items:center; gap:12px; margin-top:6px;">
            ${presenceDot('--claude', false, false)}
            <div style="display:flex; flex-direction:column; gap:2px;">
              <span class="xs" style="color:var(--claude); font-weight:600; letter-spacing:.03em;">AGENT</span>
              <span class="sm">최근 활동이 보여요</span>
            </div>
          </div>
          <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:6px;">
            <span class="xs mut2">시작 14:03:02</span><span class="xs mut2">마지막 활동 14:03:41</span>
          </div>
          <div style="margin-top:auto; display:flex; flex-direction:column; gap:4px;">
            <button class="btn cancel" type="button">이 작업 취소</button>
            <span class="xs mut2">취소하면 다음 실행을 멈춰요. 이미 바뀐 파일은 그대로 남아요.</span>
          </div>`)}</div>
        <div style="grid-column:span 2;">${card(`
          <div class="ct">Step — Claude Code가 실제로 알린 것만</div>
          ${step('done', 'src/auth/login.ts 를 읽었어요')}
          ${step('done', '토큰 만료 처리를 고쳤어요')}
          ${step('running', '테스트를 돌리고 있어요')}
          <div class="xs mut2">끝남 · 진행 중 · 다음</div>`)}</div>
        <div style="grid-column:span 2;">${card(`
          <div class="ct" style="color:var(--claude);">다음</div>
          <div class="sm">바뀐 곳을 정리해서 알려 드릴게요</div>`, 'border-left:3px solid var(--claude);')}</div>
        <div style="grid-column:span 3;">${card(`
          <div class="ct">기술 출력 보기</div>
          <div class="sm mut">원문 신호 41줄 · 도착한 순서 그대로</div>
          <div class="xs mut2">진행률이나 남은 시간은 짐작해서 보여 드리지 않아요.</div>`)}</div>
        <div style="grid-column:span 3;">${card(nextacts('다음 행동',
          btn('변경 읽기', 'pri'), btn('원하던 결과가 아니에요'), btn('작업대로 돌아가기')))}</div>
      </div>`,
  },
  {
    name: 'SC03-Status', w: 1200, h: 820,
    body: sheet('SC-03 · Work 상태 다섯', '20 의 work_status 그대로. 전부 신호에서 나온다 — 타이머가 정하는 상태는 하나도 없다.', `
      ${grid(`
        ${spec('running', '세션이 살아 있고 신호가 온다.', workCard(chip('wait', '진행 중')))}
        ${spec('input_waiting', 'Claude Code 가 물었다. 답하면 같은 작업이 이어진다 — 새 작업이 되지 않는다.',
          workCard(chip('wait', '답 기다림'), `
            <div class="panel wait" style="margin-top:8px;">
              <div class="t sm">Claude Code가 물어요</div>
              <div class="sm">어느 파일의 로그인을 말씀하시는 건가요?</div>
              <div class="inputbox">답을 적어요</div>
              ${acts(btn('답 보내기', 'pri'), btn('원문 보기', 'ghost'))}
              <div class="xs mut2">답하면 같은 작업이 이어져요. 새 작업이 되지 않아요.</div>
            </div>`))}
        ${spec('permission_waiting', 'D-133 · 헤드리스는 멈춰서 묻지 않는다. 거부된 뒤 사람이 허용하면 그 동작 하나만 다시 한다.',
          workCard(chip('wait', '허용 기다림'), `
            <div class="panel wait" style="margin-top:8px;">
              <div class="t sm">Claude Code가 이 동작을 하지 못했어요</div>
              <div class="sm mono">Edit(src/auth/login.ts)</div>
              <div class="xs mut2">허용하면 이 동작만 다시 해 볼게요. 허용하지 않으면 여기서 멈춰요.</div>
              ${acts(btn('허용하고 다시 해 보기', 'pri'))}
            </div>`))}
      `, 3, 20)}
      ${grid(`
        ${spec('cancel_requested', '멈추라고 했고 아직 멈춘 것을 보지 못했다.',
          workCard(chip('wait', '취소 요청함'), `
            <div class="panel wait" style="margin-top:8px;">
              <div class="t sm">취소를 요청했어요</div>
              <div class="sm">실제로 멈추는지 확인하고 있어요. 멈춘 것이 확인되면 결과를 보여 드려요.</div>
            </div>`))}
        ${spec('ended', 'outcome 이 반드시 함께 있다. 스키마의 CHECK 가 그것을 강제한다.',
          workCard(chip('ok', '끝남'), `
            <div class="panel rec" style="margin-top:8px;">
              <div class="t sm">끝났어요</div>
              <div class="sm">로그인 토큰 만료 처리를 고치고 테스트를 통과시켰어요.</div>
            </div>`))}
        ${spec('멈춤은 되돌리기가 아니다', '취소 카드 옆에 늘 붙는 문장. 16 §2.1 은 취소를 실패로 칠하지 않는다.',
          `<div class="panel unk"><div class="sm">멈춤은 되돌리기가 아니에요 · 되돌리기 버튼은 없어요</div>
           <div class="xs mut2">CF-22 — 작업 단위 되돌리기가 생긴 뒤 이 문장은 재판정 대상이다.</div></div>`)}
      `, 3, 20)}`),
  },
  {
    name: 'SC03-Outcome', w: 1200, h: 620,
    body: sheet('SC-03 · 끝난 방식 다섯과 결과 카드', 'D-114 — 주장마다 확신도가 붙고, 확인됨은 근거를 지목한다.', `
      ${grid(`
        ${spec('complete', '다 했다.', card(`<div class="panel rec"><div class="t sm">끝났어요</div>
          <div class="ct" style="margin-top:6px;">한 것</div><div class="sm">토큰 만료 처리를 고쳤어요 ${chip('ok', '확인됨')}</div></div>`))}
        ${spec('partial', '일부만 했다. 못 한 것을 따로 적는다.', card(`<div class="panel" style="border:1px solid var(--partline); border-left-width:3px; background:var(--partbg);">
          <div class="t sm">일부만 끝났어요</div>
          <div class="ct" style="margin-top:6px;">한 것</div><div class="sm">토큰 만료 처리를 고쳤어요 ${chip('ok', '확인됨')}</div>
          <div class="ct" style="margin-top:6px;">못 한 것</div><div class="sm">테스트는 통과시키지 못했어요</div></div>`))}
        ${spec('failed', '끝내지 못했다. 유일한 빨강.', card(`<div class="panel fail"><div class="t sm">끝내지 못했어요</div>
          <div class="sm">필요한 파일을 찾지 못했어요.</div></div>
          ${acts(btn('▸ 다시 보내기', 'rec'))}`))}
      `, 3, 20)}
      ${grid(`
        ${spec('cancelled_nochange', '멈췄고 바뀐 것이 없다.', card(`<div class="panel unk"><div class="t sm">취소했어요 · 바뀐 것은 없어요</div></div>`))}
        ${spec('cancelled_partial', '멈췄는데 바뀐 곳이 남아 있다.', card(`<div class="panel unk"><div class="t sm">취소했어요 · 바뀐 곳이 남아 있어요</div>
          ${acts(btn('변경 읽기'))}</div>`))}
        ${spec('ended_unknown', 'D-124 — 프로세스가 사라져 판단할 수 없다. 저장되는 여섯 번째 결과이고, 화면의 여섯 번째 칩은 아니다.',
          card(`<div class="panel unk"><div class="t sm">지금은 작업 상태를 확인할 수 없어요</div>
          <div class="sm">실패한 건 아니에요. 지금 상태를 모르는 거예요.</div></div>`))}
      `, 3, 20)}`),
  },
  {
    name: 'SC03-Quiet', w: 1200, h: 520,
    body: sheet('SC-03 · 조용한 상태 셋', '15 SC-03 이 정한 두 숫자 — 새 신호 없음 2분, 취소 확인 불가 90초. 관찰된 침묵에 대한 문턱이지 작업에 대한 판단이 아니다.', `
      ${grid(`
        ${spec('새 신호 없음 · 2분', '멈춘 건지 일하는 중인지 말하지 않는다.', card(`
          <div class="panel wait">
            <div class="t sm">2분 동안 새 활동이 보이지 않아요</div>
            <div class="sm">멈춘 건지 일하는 중인지 JuQode는 판단하지 않아요. 보인 것만 알려 드려요.</div>
            ${acts(btn('▸ 기다리기', 'rec'), btn('▸ 터미널로 직접 확인', 'rec'))}
          </div>`))}
        ${spec('취소 확인 불가 · 90초', '취소를 요청했지만 멈춘 것을 못 봤다. 07 §8.1 — 취소된 자식도 0으로 끝날 수 있다.', card(`
          <div class="panel fail">
            <div class="t sm">멈췄는지 확인할 수 없어요</div>
            <div class="sm">취소를 요청한 뒤 90초가 지났지만 멈춘 것을 확인하지 못했어요. 아직 실행 중일 수 있어요.</div>
            ${acts(btn('▸ 계속 기다리기', 'rec'), btn('▸ 보인 것 확인하기', 'rec'))}
          </div>`))}
        ${spec('남은 변경 미확인', '취소할 때 일부 파일 상태를 읽지 못했다. 0 이 아니라 모름이다.', card(`
          <div class="panel unk">
            <div class="t sm">남은 변경을 다 확인하지 못했어요</div>
            <div class="sm">취소할 때 일부 파일 상태를 읽지 못했어요. 확인된 부분만 아래에서 읽을 수 있어요.</div>
            ${acts(btn('▸ 확인된 변경 읽기', 'rec'), btn('▸ 새 작업으로 정리 요청', 'rec'))}
          </div>`))}
      `, 3, 20)}`),
  },
  {
    name: 'SC03-Revert', w: 1200, h: 840,
    body: sheet('SC-03 · 되돌리기 세 단계  (NEW)',
      'D-115 는 전역 undo 를 금지했고 그것은 그대로 유효하다. 이것은 증거가 실제로 감당하는 좁은 주장이다 — 이 작업이 바꾼 파일을 before 기준의 바이트로. 두 번 눌러야 쓴다.', `
      ${grid(`
        ${spec('① 제안', '원하던 결과가 아니에요 를 눌러 패널이 열렸을 때. 기준 둘이 다 있을 때만 되돌리기가 보인다.', card(`
          <div class="t">이 작업 전으로 되돌릴 수 있어요</div>
          <div class="sm">이 작업이 바꾼 파일을 작업 전 내용으로 되돌려요. 원하시면 대신 새 작업을 요청할 수도 있어요.</div>
          ${nextacts('다음 행동', btn('고치는 작업 요청', 'pri'), btn('이 작업 전으로 되돌리기', 'ghost'), btn('먼저 변경 더 읽기', 'rec'))}`))}
        ${spec('② 경고 — 첫 누름은 아무것도 쓰지 않는다', '19 §C4 의 설명 후 확인을, 파일을 쓰는 유일한 컨트롤에 적용한다.', card(`
          <div class="t">이 작업 전으로 되돌릴 수 있어요</div>
          <div class="card" style="padding:10px 12px; margin-top:8px; display:flex; flex-direction:column; gap:8px;">
            <div class="ct">되돌리기 전에 알아 두실 것</div>
            <ul class="sm" style="margin:0; padding-left:18px; display:flex; flex-direction:column; gap:4px;">
              <li>기준에 기록하지 않은 파일은 되돌아가지 않아요 — <span class="mono">.env</span> 로 시작하는 파일, 키 파일(.pem · .key 등), 중첩된 Git 폴더, 그리고 <span class="mono">.gitignore</span> 가 무시하는 파일이에요.</li>
              <li>작업이 실행한 명령의 결과(설치된 패키지 · 바뀐 데이터)는 되돌아가지 않아요. 파일 내용만 되돌려요.</li>
              <li>이 작업이 끝난 뒤 직접 고치신 내용이 있다면 그것도 함께 덮어써져요.</li>
            </ul>
            ${acts(btn('되돌리기 진행', 'pri'), btn('취소', 'ghost'))}
          </div>`))}
      `, 2, 20)}
      ${grid(`
        ${spec('③ 결과 · 되돌림', '되돌린 파일과 지운 파일을 수로 말한다. 지운 것은 작업이 만든 파일이다.', card(`
          <div class="sm">되돌렸어요 · 되돌린 파일 3개 · 지운 파일 1개</div>
          <div class="sm bad">이 작업 중에 바뀌었지만 되돌리지 못한 파일이 1개 있어요 — <span class="mono">.env</span>. 비밀이 담기기 쉬운 파일이라 기준에 기록해 두지 않았어요. 이 파일들은 직접 확인해 주세요.</div>
          ${nextacts('다음 행동', btn('고치는 작업 요청', 'pri'), btn('먼저 변경 더 읽기', 'rec'))}`))}
        ${spec('③ 결과 · 되돌릴 수 없음', 'Git 저장소가 아닌 프로젝트. 실패가 아니라 프로젝트에 대한 사실이다.', card(`
          <div class="sm">이 폴더는 Git 저장소가 아니어서 파일 내용을 기록해 두지 못했어요. 되돌릴 내용이 없어요.</div>
          ${nextacts('다음 행동', btn('고치는 작업 요청', 'pri'), btn('먼저 변경 더 읽기', 'rec'))}`))}
        ${spec('③ 결과 · 되돌릴 것이 없음', '기준에 든 파일을 아무것도 바꾸지 않은 작업.', card(`
          <div class="sm">되돌릴 파일이 없었어요. 이 작업은 기준에 든 파일을 바꾸지 않았어요.</div>`))}
      `, 3, 20)}`),
  },
  {
    name: 'SC03-Presence', w: 1200, h: 660,
    body: sheet('SC-03 · Agent Presence 아홉 모드',
      '15 §42 의 순서 그대로. 모드는 스냅샷 하나에서 순수하게 계산된다 — 같은 스냅샷은 언제나 같은 모드다. 16 §9 는 어느 모드에서나 이름이 함께 있기를 요구한다.', `
      ${grid(MODES.map(([id, tint, label, when]) => `
        <div class="card" style="padding:14px 16px; display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; align-items:center; gap:12px;">
            ${presenceDot(tint, id === 'permission' || id === 'unknown', id === 'complete' || id === 'cancelled' || id === 'failure' || id === 'unknown')}
            <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
              <span class="speclabel">${id}</span>
              <span class="sm">${label}</span>
            </div>
          </div>
          <div class="specnote">${when}</div>
          <div class="xs mut2 mono">tint ${tint}</div>
        </div>`).join(''), 3, 16)}
      <div class="panel juq">
        <div class="t sm">우선순위는 장식이 아니다</div>
        <div class="xs">끝남 → 답/허용 기다림 → 활동성. 기다리는 중인 작업은 조용한 것이 정상이다. 침묵 문턱이 먼저 이기면, 허용 카드가 뜬 2분 뒤에 모드가 <b>nosignal</b> 로 뒤집힌다 — 타이머만으로 도달하는 모드가 되는 것이고, 그래서 순서가 장식이 아니다.</div>
      </div>`),
  },
];
