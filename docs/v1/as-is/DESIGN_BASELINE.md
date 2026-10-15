# DESIGN_BASELINE — f905858 시각 동결 (V1-301)

**WBS:** V1-301
**상태:** `SNAPSHOT / RESULT_RECEIVED / NOT_A_GATE_PASS`
**소스:** `ju0o/JuQode` `f905858d3f0dc403155f1fa6082efbca207558b6`
**기획 선행:** `ju0o/JuQode-Private@1ea0a7d`의 V1-003 PRD와 V1-004 `08_V1_FEATURE_SCREEN_SPEC.md`. 그 파일을 수정하지 않는다.
**이 커밋의 동작:** CSS, 화면 문구, 레이아웃 코드를 바꾸지 않는다. 잠긴 보드를 유지한다고 적는다.

G4 소스 디자인 검수 PASS가 아니다. 설치형 시각 회귀 PASS가 아니다.

## 유지하는 네 가지

### 1. 컴팩트한 5열 보드

칸은 다섯이다. `app/renderer/screens/sc02.js`의 `columns`:

| 키 | 문구 |
|---|---|
| `queued` | 시작 전 |
| `doing` | 진행 중 |
| `needs` | 확인 필요 |
| `review` | 검토 |
| `done` | 완료 |

배치는 `app/renderer/board-column.mjs`의 `columnFor`다. 열 의미는 V1-101 지도와 같다. 이 파일은 그 함수를 다시 정의하지 않는다.

열 크기는 `app/renderer/screens/sc02.css`의 `.board-col`이다. `flex: 1 1 0`, `min-width: 108px`, 배경 투명, 테두리 없음. 빈 열을 상자로 만들지 않는다. 제목은 12px이다.

### 2. 선택한 일의 인스펙터

`sc02.css` 파일 머리말: 보드가 제품이고, 레일은 이동이며, 인스펙터는 선택한 일에만 열린다. 진행 중 시도는 열 위의 짧은 줄이지 두 번째 페이지가 아니다.

`.sc02-inspect`는 기본 `display: none`이고, `.sc02.is-inspect`일 때만 보인다. 그때 그리드는 `216px minmax(0, 1fr) minmax(260px, 320px)`이다. 1099px 이하에서는 인스펙터가 220px로 줄고, 보드는 다섯 제목이 들어갈 너비를 유지한다. 1023px 이하에서는 스테이지, 레일, 인스펙터 순으로 쌓인다.

보조 Run 화면의 진입 문구는 `시도 자세히 보기`다. 인스펙터를 그 화면으로 바꾸지 않는다.

### 3. 얇은 경계

보드 열 자체는 `border: none`이다. 보이는 선은 1px이다.

- 열 머리: `border-bottom: 1px solid var(--line)`
- 타일: `border: 1px solid var(--line)`, `border-radius: 8px`
- 레일: `border-right: 1px solid var(--line)`
- 인스펙터: `border-left: 1px solid var(--line)`

라이트 `--line`은 `#d6dbe3`다. 두꺼운 외곽선이나 열 상자 테두리를 추가하지 않는다.

### 4. 라이트 뉴트럴

기본 팔레트는 `:root`에 있다. `app/renderer/design/tokens.css`.

- 보드 `--board: #eef0f4`
- 카드 `--card: #ffffff`
- 글자 `--ink: #14171c`
- 실패만 `--fail: #9b2c2c`

다크 토큰은 같은 파일의 `prefers-color-scheme`와 `[data-theme="dark"]`에 있다. 이 동결은 다크 모드를 지우지 않는다. 기본 화면은 라이트 뉴트럴이다.

토큰 주석은 값을 JuQode-Private `docs/current/16_VISUAL_DESIGN_SPEC.md`에서 옮겼다고 적고, 대비 때문에 네 값이 Canon 초안과 다르다고 적는다 (CF-20). 이 커밋은 그 값을 다시 맞추거나 되돌리지 않는다.

## 이 배치에서 본 화면 증거

같은 작업 트리에서, CSS를 바꾸기 전에 실행한 `npm run test:e2e`의 `visual.mjs`가 `visual+behaviour: PASS`였다. fixture UI이고 live CLI가 아니다. Linux 측정이다. G4가 아니다.

그 출력이 기록한 라이트 표면:

- `lightBg` `rgb(238, 240, 244)` — `#eef0f4`와 같다
- `lightInk` `rgb(20, 23, 28)` — `#14171c`와 같다
- `lightPriContrast` 15.74

스크린샷은 `tmp-visual`에만 있고 커밋하지 않았다.

## 테스트

CSS를 바꾸지 않았다.

`node --test --test-timeout=60000 tests/theme.test.js`
exit 0. tests 9, pass 9, fail 0, duration_ms 137.
라이트·다크 텍스트 대비, 실패 색이 하나의 빨강인 것, 테마 토글이 OS보다 우선하는 것을 잠근다. 화면 골든 교체는 없다.

## 이 기준이 허용하지 않는 것

- 5열 이름, 순서, `columnFor` 규칙을 시각 작업으로 바꾸기
- 인스펙터를 항상 열거나, 진행 중 작업을 별도 기본 화면으로 빼기
- 열에 상자 테두리를 넣거나 1px보다 두꺼운 구분선을 기본값으로 두기
- 기본 배경을 라이트 뉴트럴이 아닌 색으로 바꾸기
- 이 문서로 G4, G5, G7을 통과시키기
