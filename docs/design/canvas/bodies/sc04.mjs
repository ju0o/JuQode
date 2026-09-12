import { sheet, grid, spec, card, chip, btn, acts, nextacts, topbar } from '../ui.mjs';

const diff = `<pre class="mono" style="margin:0; font-size:11px; line-height:16px; white-space:pre; overflow-x:auto;
  background:var(--card2); border:1px solid var(--line); border-radius:var(--r-inner); padding:8px 10px;">@@ -12,7 +12,9 @@
 export function refreshToken(t) {
-  if (t.exp &lt; Date.now()) return null;
+  if (!t || !t.exp) return null;
+  if (t.exp &lt; Date.now() - SKEW) return null;
   return sign(t);
 }</pre>`;

const block = (kind, name, col) => `
  <div style="display:flex; align-items:baseline; gap:8px;">
    <span class="chip" style="color:${col}; border-color:${col};">${kind}</span>
    <span class="sm mono" style="min-width:0; overflow-wrap:anywhere;">${name}</span>
  </div>`;

export default [
  {
    name: 'SC04-Main', w: 1300, h: 820,
    body: `${topbar('SC-04 · 변경 읽기')}
      <div style="padding:20px; display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <span class="h1">변경 읽기</span><span class="lead">뜻 → 코드 → 원문</span>
        </div>
        <div style="display:grid; grid-template-columns:minmax(0,4fr) minmax(0,4fr) minmax(0,5fr); gap:14px;">
          ${card(`
            <div class="ct">무엇이 바뀌었나요</div>
            <div class="t">토큰 만료 판단을 고쳤어요 ${chip('ok', '확인됨')}</div>
            <div style="display:flex; gap:10px;"><span class="xs mut2" style="flex:0 0 3.5em;">무엇</span><span class="sm">만료 시각이 없는 토큰도 거절해요.</span></div>
            <div style="display:flex; gap:10px;"><span class="xs mut2" style="flex:0 0 3.5em;">왜</span><span class="sm">만료 직전 토큰이 통과하던 문제가 있었어요.</span></div>
            <div style="display:flex; gap:10px;"><span class="xs mut2" style="flex:0 0 3.5em;">어떤 동작에</span><span class="sm">로그인 유지</span></div>
            <div class="xs mut2 mono">근거 · signal:s41</div>
            <div class="xs mut2">파일 2개</div>`)}
          ${card(`
            <div class="ct">어떤 코드가 바뀌었나요</div>
            ${block('수정', '함수 refreshToken()', 'var(--part)')}
            <div class="sm">만료 시각이 없는 토큰을 먼저 거르도록 조건을 하나 더 뒀어요.</div>
            ${block('추가', '상수 SKEW', 'var(--rec)')}
            <div class="sm">시계 차이를 허용하는 여유 값이에요.</div>`)}
          ${card(`
            <div class="ct">Raw Diff — 실제로 바뀐 글자</div>
            <div class="xs mut2 mono">src/auth/token.ts</div>
            ${diff}
            ${acts(btn('원문 복사', 'ghost'), btn('Raw Diff 닫기', 'ghost'))}`)}
        </div>
        <div class="xs mut2">기준에서 제외한 경로 2개는 이 읽기에 들어 있지 않아요 · .env · node_modules/</div>
        ${card(nextacts('다음 행동', btn('이해했어요 · 다음 요청으로', 'pri'), btn('원하던 결과가 아니에요'), btn('작업으로 돌아가기')))}
      </div>`,
  },
  {
    name: 'SC04-States', w: 1200, h: 760,
    body: sheet('SC-04 · 상태', '설명은 사람이 요청할 때만 돈다. 그럴듯한 이유를 지어내지 않는다.', `
      ${grid(`
        ${spec('아직 설명하지 않음', '기본. 실패한 적이 없는데 실패 문장을 쓰면, 하지도 않은 일에 대해 실패를 알리는 것이 된다.', card(`
          <div class="ct">무엇이 바뀌었나요</div>
          <div class="sm mut">아직 이 변경을 말로 설명하지 않았어요.</div>
          ${acts(btn('이 변경 설명 받기', 'pri'))}`))}
        ${spec('설명 받는 중', '자식 프로세스가 돈다. 화면을 여는 것만으로는 절대 시작되지 않는다.', card(`
          <div class="ct">무엇이 바뀌었나요</div>
          <div class="sm mut">설명을 받는 중…</div>`))}
        ${spec('설명 불가', '모델이 이 변경을 말로 만들지 못했다. 코드는 그대로 볼 수 있다.', card(`
          <div class="panel unk">
            <div class="t sm">이 변경은 말로 설명하지 못했어요</div>
            <div class="sm">그럴듯한 이유를 지어내지 않아요. 아래에서 코드로 직접 볼 수 있어요.</div>
            ${acts(btn('▸ 코드로 보기', 'rec'))}
          </div>`))}
      `, 3, 20)}
      ${grid(`
        ${spec('바뀐 파일 없음', '기준 둘을 비교했고 차이가 0 이다 — 확인된 0.', card(`
          <div class="sm">바뀐 파일이 없어요 ${chip('ok', '확인됨')}</div>
          ${nextacts('다음 행동', btn('이해했어요 · 다음 요청으로', 'pri'))}`))}
        ${spec('확인 못함', '기준을 못 만들었거나 비교하지 못했다. 0 이라고 말하면 안 한 확인을 했다고 주장하는 것이다.', card(`
          <div class="panel unk">
            <div class="sm">이 작업이 무엇을 바꿨는지 여기서 확인하지 못했어요.</div>
            <div class="xs mut2">바뀐 것으로 확인된 파일: src/auth/token.ts</div>
          </div>`))}
        ${spec('잘림', '원문이 상한(256 KB)을 넘었다. 앞부분만 싣고, 원문 전체는 그대로 남는다.', card(`
          ${diff}
          <div class="xs mut2">변경이 너무 커서 여기에는 앞부분만 실었어요. 원문 전체는 그대로 남아 있어요.</div>`))}
      `, 3, 20)}`),
  },
  {
    name: 'SC04-Blocks', w: 1200, h: 480,
    body: sheet('SC-04 · 코드 블록 다섯 종류',
      'D-127 — 블록은 바뀐 줄을 품은 가장 안쪽의 이름 있는 선언이다. 믿을 수 없는 파싱은 통째로 hunk 로 내린다 — 단위를 지어내지 않는다.', `
      ${grid(`
        ${spec('추가', '이전 기준에 없던 선언.', card(block('추가', '상수 SKEW', 'var(--rec)') + `<div class="sm">시계 차이를 허용하는 여유 값이에요.</div>`))}
        ${spec('수정', '양쪽에 있고 안쪽 줄이 바뀌었다.', card(block('수정', '함수 refreshToken()', 'var(--part)') + `<div class="sm">만료 시각이 없는 토큰을 먼저 걸러요.</div>`))}
        ${spec('삭제', '이후 기준에서 사라졌다.', card(block('삭제', '함수 legacyVerify()', 'var(--fail)') + `<div class="sm">쓰이지 않던 옛 검증 경로예요.</div>`))}
      `, 3, 20)}
      ${grid(`
        ${spec('이름 변경', '유도할 수 있을 때만 주장한다. 짐작으로 붙이지 않는다.', card(block('이름 변경', 'verify() → verifyToken()', 'var(--claude)')))}
        ${spec('나누지 못함', 'TypeScript 컴파일러를 쓸 수 없거나 파싱을 믿을 수 없을 때. 파일 전체가 hunk 단위로 내려간다.', card(block('나누지 못함', 'src/legacy/auth.js · hunk 3개', 'var(--unk)') + `<div class="specnote">이것은 실패가 아니라 정직한 성능 저하다. 부팅 때 segmenter 가 hunks-only 로 보고된다.</div>`))}
        ${spec('표시 불가', '바이너리 등. 원문을 글자로 보여 줄 수 없다.', card(block('표시 불가', 'public/logo.png', 'var(--mut2)')))}
      `, 3, 20)}`),
  },
];
