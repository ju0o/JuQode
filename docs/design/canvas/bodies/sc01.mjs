import { sheet, grid, spec, card, chip, btn, acts, topbar } from '../ui.mjs';

const hero = (extra = '') => `
  <div class="card" style="padding:22px 24px; display:flex; flex-direction:column; gap:12px; max-width:560px;">
    <div class="h1">프로젝트 열기</div>
    <div class="lead">내 컴퓨터에 있는 프로젝트 폴더를 열면, JuQode가 먼저 이 프로젝트가 무엇인지 읽어 드려요.</div>
    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
      <button class="btn pri" type="button">프로젝트 폴더 열기</button>
      <span class="xs mut2">이미 있는 폴더를 고르면 돼요. 새로 만들지는 않아요.</span>
    </div>
    ${extra}
  </div>`;

const firstRun = `
  <div style="display:flex; flex-direction:column; gap:6px; margin-top:10px;">
    <div class="t sm">처음이시라면, 이렇게 시작해요</div>
    <ol class="sm" style="margin:0; padding-left:20px; display:flex; flex-direction:column; gap:4px;">
      <li>내 컴퓨터에서 폴더를 하나 고르세요. 빈 폴더여도 괜찮아요.</li>
      <li>JuQode가 그 폴더가 무엇인지 먼저 읽어서 설명해 드려요.</li>
      <li>하고 싶은 일을 말로 적어서 보내면, Claude Code가 그 일을 해요.</li>
    </ol>
    <div class="xs mut">폴더를 새로 만들어 드리지는 않아요 — 이미 만들어 둔 폴더를 골라 주세요.</div>
  </div>`;

const failCard = (reason, detail) => card(`
  <div class="panel fail">
    <div class="t">이 폴더는 열 수 없어요</div>
    <div class="sm">${reason}</div>
  </div>
  ${acts(btn('▸ 같은 폴더 다시 시도', 'rec'), btn('▸ 다른 폴더 고르기', 'rec'))}
  <div class="xs mut2 mono">자세한 내용 보기 · ${detail}</div>`);

const storeCard = (title, body, detail) => card(`
  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
    <span class="t">${title}</span>${chip('unavail', '지금 안 됨 · 실패 아님')}
  </div>
  <div class="sm">${body}</div>
  <div class="xs mut2 mono">자세한 내용 보기 · ${detail}</div>`);

export default [
  {
    name: 'SC01-Main', w: 1200, h: 820,
    body: `${topbar('SC-01 · 프로젝트 열기')}
      <div class="stack" style="align-items:center;">
        ${hero(firstRun)}
        <div class="card" style="padding:18px 20px; width:560px; display:flex; flex-direction:column; gap:10px;">
          <div class="ct">최근에 연 프로젝트</div>
          <div class="sm mut">아직 기록이 없어요 — 처음 열기</div>
          <div class="xs mut2">최근에 연 폴더만 보여요.</div>
        </div>
        <div style="width:560px; border-left:3px solid var(--juq); padding-left:10px;">
          <div class="sm t" style="color:var(--juq);">서명되지 않은 빌드예요</div>
          <div class="xs mut">Windows 가 이 앱을 처음 열 때 경고를 보여 줄 수 있어요. 앱이 하는 일은 달라지지 않아요.</div>
        </div>
      </div>`,
  },
  {
    name: 'SC01-States', w: 1200, h: 700,
    body: sheet('SC-01 · 상태', '기본 화면 말고 나머지 전부. 하나뿐인 Primary Action 은 어느 상태에서도 늘어나지 않는다.', `
      ${grid(`
        ${spec('최근 있음', '저장소에 프로젝트가 하나 이상 있을 때. 행을 누르면 바로 열린다.', card(`
          <div class="ct">최근에 연 프로젝트</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="border-top:1px solid var(--line); padding-top:8px;">
              <div class="t sm">my-shop</div>
              <div class="xs mut2 mono">/home/me/projects/my-shop</div>
              <div class="xs mut" style="margin-top:4px;">마지막 작업 · 로그인 오류 고쳐줘 ${chip('ok', '끝남')}</div>
            </div>
            <div style="border-top:1px solid var(--line); padding-top:8px;">
              <div class="t sm">portfolio</div>
              <div class="xs mut2 mono">/home/me/projects/portfolio</div>
            </div>
          </div>`))}
        ${spec('열기 실패 · 권한 없음', 'EACCES · EPERM. 폴더는 있는데 읽을 수 없다.', failCard('읽기 권한이 없어요', 'EACCES /home/me/locked'))}
        ${spec('열기 실패 · 폴더 없음', 'ENOENT 하나만. 다른 errno 를 이 문장으로 말하지 않는다.', failCard('그 폴더를 찾지 못했어요', 'ENOENT /home/me/gone'))}
        ${spec('열기 실패 · 폴더가 아님', 'ENOTDIR. 파일을 고른 경우.', failCard('폴더가 아니에요', 'ENOTDIR /home/me/notes.txt'))}
        ${spec('열기 실패 · 알 수 없음', 'ELOOP · EIO · EMFILE 등. 아는 척하지 않는다.', failCard('폴더를 열 수 없었어요', 'ELOOP /home/me/loop'))}
        ${spec('여는 중', '최근 행을 눌렀을 때만. 네이티브 대화상자가 뜨는 동안에는 이 문장을 쓰지 않는다 — 아직 고르지 않은 폴더에 대한 주장이 된다.', card(`
          <div style="display:flex; align-items:center; gap:10px;">
            <button class="btn pri" type="button" disabled>폴더를 읽고 있어요…</button>
          </div>`))}
      `, 3, 20)}`),
  },
  {
    name: 'SC01-Store', w: 1200, h: 620,
    body: sheet('SC-01 · 저장소 거절과 빌드 서명',
      '저장소를 이해하지 못하면 프로젝트를 열 수 없다. 지우지도 덮어쓰지도 않는다 — 기존 파일은 그대로 둔다.', `
      ${grid(`
        ${spec('db-corrupt', '이 제품의 저장소가 아니거나, 26개 테이블이 다 있지 않다.',
          storeCard('저장소를 열지 못했어요', '기존 파일을 그대로 두었어요. 지운 것은 없어요. 프로젝트를 열려면 이 문제를 먼저 해결해야 해요.', 'db-corrupt'))}
        ${spec('db-newer', '더 새 빌드가 쓴 저장소. 앞으로만 간다 — 되돌리지 않는다.',
          storeCard('저장소를 열지 못했어요', '기존 파일을 그대로 두었어요. 지운 것은 없어요. 프로젝트를 열려면 이 문제를 먼저 해결해야 해요.', 'db-newer'))}
        ${spec('db-unreadable', '파일 자체를 열 수 없다.',
          storeCard('저장소를 열지 못했어요', '기존 파일을 그대로 두었어요. 지운 것은 없어요. 프로젝트를 열려면 이 문제를 먼저 해결해야 해요.', 'db-unreadable'))}
      `, 3, 20)}
      ${grid(`
        ${spec('서명 · 없음 (확인됨)', 'PE 인증서 표가 비어 있다. 이것은 확인된 사실이다.', `
          <div style="border-left:3px solid var(--juq); padding-left:10px;">
            <div class="sm t" style="color:var(--juq);">서명되지 않은 빌드예요</div>
            <div class="xs mut">Windows 가 이 앱을 처음 열 때 경고를 보여 줄 수 있어요. 앱이 하는 일은 달라지지 않아요.</div>
          </div>`)}
        ${spec('서명 · 확인 못함', '인증서 표를 판단할 수 없었다. 없다고 말하면 안 한 검사를 했다고 주장하는 것이다.', `
          <div style="border-left:3px dashed var(--unk); padding-left:10px;">
            <div class="sm t" style="color:var(--unk);">이 빌드가 서명되었는지 확인하지 못했어요.</div>
          </div>`)}
        ${spec('서명 · 해당 없음', '소스 실행. 배포된 빌드가 아니므로 밝힐 사실이 아직 없다 — 아무것도 그리지 않는다.',
          `<div class="specnote" style="padding:10px 0;">(표시 없음)</div>`)}
      `, 3, 20)}`),
  },
];
