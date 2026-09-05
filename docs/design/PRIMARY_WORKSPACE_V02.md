# JuQode — Primary Workspace V02
## Adaptive Software Representation · FINAL DESIGN SPEC

> **Status:** Phase 3R.1 산출물. 단일 후보. A/B/C 없음.
> **Supersedes:** Phase 3 Functional Prototype(`prototype/`)의 *표상 모델*.
> 그 프로토타입은 인터랙션/전이 레퍼런스로 **보존**한다. 표상 모델로는 채택하지 않는다.
> **Visual tone:** D-054 v0.1 Visual Tone — 동결. 이 문서에서 토큰을 새로 만들지 않는다.
> **Lovable credits spent by this document:** 0.
>
> ### ⚠ 3R.2 / 3R.3 소급 정정 적용됨
> 상위 SSOT는 [`SOFTWARE_PHYSICS_CANON.md`](SOFTWARE_PHYSICS_CANON.md)(3R.2)이고,
> 시각 문법은 [`SOFTWARE_PHYSICS_VISUAL_GRAMMAR.md`](SOFTWARE_PHYSICS_VISUAL_GRAMMAR.md)(3R.3)이다.
> 충돌하면 그 두 문서가 이긴다. **§3.3은 폐기되었다** — 아래 배너 참조.

---

## 1. Core Visual Thesis

### 1.1 한 문장

> **Software는 카드의 집합이 아니라, 표면과 내부와 깊이를 가진 하나의 몸이다.**

JuQode의 Primary Object는 Feature도 File도 Node도 아니다. **Software 자체**다.
사용자는 목록을 읽지 않는다. **형태를 본다.**

### 1.2 공간을 지배하는 단 하나의 축 — DEPTH

JuQode 캔버스의 세로축은 스크롤이 아니다. **사람으로부터의 거리**다.

```
      ↑  사람이 만지는 곳          SURFACE
      │
      │  결정되고 변형되는 곳       LOGIC
      │
      ↓  가라앉아 남는 곳          DATA

   ←  바깥 세계와 닿는 곳  →       PORT (경계선 위)
```

이 축 하나가 여섯 가지 소프트웨어 유형을 **같은 문법으로** 설명한다.

| 유형 | 실루엣 |
|---|---|
| Empty | 몸이 아직 없다. 경계와 원점만 있다 |
| Frontend-heavy | 위가 넓고 아래가 얇다 |
| Backend-only | 위가 **선(線)으로 붕괴**한다. 가운데가 두껍다 |
| Agent | 가운데가 지배하고, 밖으로 강하게 뻗고, 경로가 되돌아온다 |
| Data | 아래가 지배한다 |
| Full-stack | 세 층이 모두 두께를 가진 하나의 몸 |

**유형을 판별하는 UI는 없다.** 유형은 형태에서 저절로 읽힌다.

### 1.3 표상 원칙 (LOCKED)

```
STRUCTURE  →  RELATIONSHIP  →  STATE  →  LABEL  →  DETAIL ON DEMAND
```

Text는 구조를 **설명**한다. Text가 구조**이면 안 된다**.

### 1.4 CONSTANT INK RULE (이 설계의 핵심 규칙)

> **화면 위의 잉크 총량은 Zoom 단계가 바뀌어도 거의 일정하다.
> 바뀌는 것은 그 잉크의 *의미 해상도*다.**

FAR에서 하나의 톤(tone)이던 것이 MID에서 12개의 표식이 되고,
그 표식 하나가 NEAR에서 4단계 경로가 된다.
**어느 단계에서도 잉크가 누적되지 않는다.**

이전 프로토타입이 실패한 지점이 정확히 여기다 — Zoom이 라벨을 *더했다*.

---

## 2. Workspace Anatomy

### 2.1 4영역. 그중 상시는 2개.

```
┌────────────────────────────────────────────────────────┐  44px
│ JuQode      [← 밖으로]                    ● Agent 상태  │  Chrome
├──────────────────────────────────────────┬─────────────┤
│                                          │             │
│                                          │  Contextual │
│              SOFTWARE SPACE              │  Surface    │  340px
│              (Primary · 상시)            │  (선택 시만) │
│                                          │             │
│                                          │             │
├──────────────────────────────────────────┴─────────────┤
│ 대상 · 로그인 흐름                                       │  26px (조건부)
│ 원하는 걸 말해보세요.                        [Qode 실행] │  74px
└────────────────────────────────────────────────────────┘
```

| 영역 | 높이/폭 | 상시? | 내용 |
|---|---|---|---|
| Chrome | 44px | 상시 | wordmark · 밖으로(조건부) · Agent 상태 |
| **Software Space** | flex | **상시** | Software 몸체. 이 제품의 전부 |
| Contextual Surface | 340px | **조건부** | 선택 / Working / Result / Evidence |
| Qode Composer | 74px (+26) | **상시** | 입력 한 줄. Chat 로그 없음 |

### 2.2 Chrome에서 제거한 것

이전 프로토타입의 Chrome에는 `C:\Desktop\MyService` 파일 경로가 있었다. **삭제한다.**
JuQode는 파일 탐색기가 아니다. Software 이름은 경계선의 notch에 붙는다.

### 2.3 금지 (HARD)

상시 파일 트리 · 상시 인스펙터 · 터미널 · 로그 레일 · 통계 대시보드 ·
큰 툴바 · 다중 패널 · 탭 · 사이드 내비게이션 · Chat 히스토리.

### 2.4 Software 몸체의 배치

```
boundary.w = clamp(720, stage.w − 360, 1120)
boundary.h = boundary.w × 0.625            // 8:5 고정
boundary   = stage 중앙, 세로는 중앙에서 4% 위
```
Contextual Surface가 열리면 Software 몸체는 **사라지지 않고 좌측으로 이동·축소**한다
(520ms · `cubic-bezier(.22,.61,.36,1)`). 공간 연속성이 끊기면 안 된다.

---

## 3. Common Primitives

### 3.1 MVP 원시요소는 4개다

| # | 이름 | 의미 | 구현 |
|---|---|---|---|
| 1 | **BOUNDARY** | 이것이 하나의 Software다 **· 그리고 되돌릴 수 있음의 한계다**(E1) | 2px `--ink` 사각. 미완성이면 1px `--ink4` dashed |
| 2 | **REGION** | 깊이 층(band) × 관심사(lane). 질량을 가진다 | 배치 계산 + **PARTITION**(정정됨) |
| 3 | **PATH** | 의미 있는 이동·의존·핸드오프 | 직교 폴리라인. bezier 금지 |
| 4 | **PORT** | 경계 위의 바깥 접촉 | 경계선 위 굵은 마디 + 12px 바깥 stub |

**JUNCTION과 LOOP는 새 원시요소가 아니다. PATH의 위상(topology)이다.**

- Junction = 두 Path가 한 점을 공유한다
- Loop = 한 Path의 끝이 자기 앞쪽 점으로 되돌아온다 (`returns: true`)

**DENSITY는 REGION의 속성**이고, **STATE는 네 원시요소 모두에 걸리는 수식자**다.

이렇게 해서 §5의 8개 시각 어휘가 **4개 구현 대상**으로 압축된다.

### 3.2 MASS LAYOUT — 이 설계의 배치 엔진

> 형태를 결정하는 것은 좌표가 아니라 **질량**이다.

```
bands  = 세로 분할  (SURFACE / LOGIC / DATA)
lanes  = 가로 분할  (band 내부의 관심사)

w_i = FLOOR + (1 − FLOOR) × (mass_i / Σmass)      FLOOR = 0.06
h_i = H × w_i / Σw
```

**FLOOR = 0.06이 이 설계의 결정적 장치다.**
질량이 0인 band는 사라지지 않고 **얇은 선으로 붕괴**한다.
Backend-only에서 SURFACE band는 10px 선이 되고, 그 선은 곧 "요청이 들어오는 가장자리"로 읽힌다.
없는 것을 없다고 그리지 않고, **없음 자체를 형태로** 그린다.

Lane도 같은 공식을 가로로 적용한다. 지능(Intelligence)은 별도 band가 아니라 **LOGIC band의 lane**이고,
데이터 도메인은 **DATA band의 lane**이다. 규칙 하나가 여섯 실루엣을 전부 만든다.

### 3.3 ~~DENSITY FIELD~~ — **폐기 (3R.3)**

> **⛔ 이 절은 폐기되었다.**
> Founder 판정: **"점들이 쫙 나열된 느낌"**. 표식을 뿌리는 것은 밀도를 *세는 것*이지
> *보는 것*이 아니었고, 결과는 소프트웨어가 아니라 **산점도**였다.
>
> **대체:** 밀도는 표식을 더해서가 아니라 **연속 공간을 나눠서**(subdivision) 만든다.
> 규격은 [`SOFTWARE_PHYSICS_VISUAL_GRAMMAR.md`](SOFTWARE_PHYSICS_VISUAL_GRAMMAR.md) §2.3.
> 아래 표는 **역사적 기록으로만** 남긴다. 구현하지 않는다.

Region의 질량은 ~~작은 정사각 표식의 밭으로 그린다~~ (폐기).

| 의미 객체 수 n | 표식 크기 | 표시 수 | 읽히는 것 |
|---|---|---|---|
| 0 | — | 0 | 비어 있음 |
| 1 | 9px | 1 | 원점 |
| 2–4 | 7px | n | 셀 수 있음 |
| 5–12 | 6px | n | 셀 수 있음 |
| 13–28 | 5px | n | 밭 |
| 29–48 | 4px | n | 밭 |
| 49+ | 4px | **48 (cap)** | **포화(saturated)** |

`cap = 48`. **cap을 넘어도 표식 크기와 불투명도를 줄이지 않는다.**
줄이면 100개가 40개보다 옅게 보이는 역전이 일어난다 — 실제로 겪은 오류다.
대신 밭이 **포화**한다: 48과 300을 구분하지 못하게 되고, 그것이 정직하다.
**그 구분은 FAR의 사실이 아니기 때문이다.** 숫자(`+312`)는 MID에서만 mono로 나타난다.

배치는 lane 안쪽 12px 여백의 격자에 ±1.5px 지터를 준다.
지터는 장식이 아니다 — 격자로 보이면 **표(table)로 오독**되기 때문이다.

### 3.4 PATH 규격

- 직교(orthogonal) 폴리라인. **bezier 금지** (프로토타입에서 이미 동결된 규칙)
- 선: 1.5px `--ink2`. Path가 Density Field 위를 지날 때는 **paper색 halo(5px)를 먼저 깔고** 그 위에 그린다
- **화살촉(arrowhead) 금지.** 방향은 경로당 최대 1개의 5px 채운 삼각형으로만 표시한다
- Path 라벨은 mono 9px. **FAR에서는 라벨 없음**
- Loop는 닫힌 직교 회로. 별도 색을 쓰지 않는다

### 3.5 PORT 규격

Port는 떠 있는 "연동 카드"가 아니다. **경계선 자체가 두꺼워지는 마디**다.

```
경계선 위 길이 = 18 + 10 × weight      (weight 1–3)
바깥 stub      = 12px
라벨           = stub 바깥, sans 9.5px --ink3
```
라벨은 sans다. **사람이 아는 이름(브라우저 · 결제 · 메일)은 mono를 쓰지 않는다.**

### 3.6 STATE 수식자 — **3R.2 6상태 모델로 정합 (정정됨)**

상태는 임의의 수식자가 아니라 **평형 상태 기계(L3)** 의 표현이다.

| 평형 상태 | 표현 |
|---|---|
| `SETTLED` | 톤 없음 · 실선 · `--ink2`. 고요함 |
| `DISTURBED` | **영향 영역만** `--sunk` 톤. 전역 스피너 없음 |
| `SETTLING` | `--sunk` 톤 + **파선** + `--attention`. 세 채널이 동시에 다르다 |
| `SETTLED′` | 톤 소멸 · 실선 복귀 · 질량 반영 |
| `UNSETTLED` | `--failure #8C2B20` + dashed. 이전 평형이 참조로 남는다 |
| `UNKNOWN` | 윤곽만 · 만나지 않는 선 (`--ink4` dashed). **Empty와 다르다** |

| 그 밖의 수식자 | 표현 |
|---|---|
| 선택됨 | 해당 요소만 `--ink` 3px. 회색 처리 금지 |
| 과거 | `--past #5B6B84` (비교 뷰 전용) |

전체 규격: [`SOFTWARE_PHYSICS_VISUAL_GRAMMAR.md`](SOFTWARE_PHYSICS_VISUAL_GRAMMAR.md) §5.

**동시에 화면에 존재할 수 있는 attention 요소는 최대 3개다.**

---

## 4. Empty Software

가장 중요한 케이스. 여기서 무너지면 전체가 무너진다.

### 4.1 그리는 것

```
1px --ink4 dashed 경계          "아직 하중을 받지 않는 몸"
0.28 opacity hairline 3개        depth 축의 예고. 라벨 없음
10px 채운 --ink 정사각 (중앙)     원점(origin)
넓은 여백
Qode Composer                    유일하게 밝은 행동
```

### 4.2 그리지 않는 것 (HARD)

빈 카드 그리드 · "No features" · 온보딩 체크리스트 · 제안 카드 6개 ·
가짜 스타터 모듈 · 일러스트 · 화살표 안내 · 툴팁 투어.

### 4.3 왜 이것이 강한 화면인가

- 경계가 있으므로 **"내 Software"라는 대상이 이미 존재**한다
- 원점이 있으므로 **시작점이 어디인지** 안다
- 세 개의 희미한 선이 있으므로 **자랄 방향**이 암시된다
- 그리고 아무 라벨도 없으므로 **읽을 것이 없다**

Empty는 "콘텐츠가 없는 상태"가 아니라 **질량이 0인 Software**다.
같은 문법, 같은 렌더러. 특별 케이스 코드 없음.

### 4.4 첫 Qode 이후

`로그인부터 만들어줘.`

| 변화 | 형태 |
|---|---|
| 경계 | 1px dashed `--ink4` → **2px solid `--ink`** (몸이 하중을 받기 시작) |
| SURFACE band | 질량 획득 → 두께가 생긴다 |
| 표식 | 원점이 SURFACE로 올라가고, LOGIC에 표식 2개 생성 |
| Path | SURFACE → LOGIC → DATA 로 내려가는 줄기 1개 |
| Port | 상단 경계에 `브라우저` 마디 1개 |

**카드 하나가 추가된 것이 아니라, 실루엣이 바뀐다.**

---

## 5. Frontend-heavy Software

### 5.1 실루엣

질량 SURFACE 6 · LOGIC 2 · DATA 1 → 높이 **110 / 43 / 26** (보드 기준 H=180. 값은 공식에서 계산된다)

위가 압도적으로 넓다. 그것만으로 "사람이 만지는 제품"이 읽힌다.

### 5.2 FAR

- SURFACE band를 2–3개 lane으로 나눈다 (예: 둘러보기 · 사는 흐름 · 내 정보)
- lane마다 density field. **lane 라벨은 최대 2개만** 표시
- 상단 경계에 `브라우저` port (weight 3 — 가장 굵음)
- 우측 LOGIC 위치에 `결제` port
- Path: 상단 port → SURFACE 가로 이동 2개 → LOGIC으로 내려가는 줄기 1개 → DATA

### 5.3 금지

사이트맵 · 화면 카드 · 컴포넌트 트리 · 라우트 목록 · 와이어프레임 썸네일.

### 5.4 MID / NEAR

- MID: 하나의 lane이 확대. 표식이 **사람의 행동**으로 해상된다 (담다 · 결제하다 · 돌아오다)
- NEAR: 선택한 행동의 지역 경로. 무엇이 들어오고, 무엇이 나가는가

---

## 6. Backend-only Software

**이 케이스가 전체 설계의 시험대다. Feature가 없어도 성립해야 한다.**

### 6.1 실루엣

질량 SURFACE 0 · LOGIC 9 · DATA 5 → 높이 **10 / 107 / 64**

SURFACE는 **선으로 붕괴**한다. 그 선이 곧 **유입 가장자리**다.

### 6.2 공간적 인상 (라벨보다 먼저 읽혀야 하는 것)

```
무언가 들어온다        상단 선 위의 port 마디
     ↓
처리된다 · 갈라진다     LOGIC의 두꺼운 덩어리 + junction
     ↓        ↘
쌓인다      밖으로 나간다   DATA 덩어리 / 우측 port
```

### 6.3 금지

`API` `SERVICE` `QUEUE` `DATABASE` 라벨 박스 4개.
기술 이름은 DEEP에서만 나온다. FAR에서 읽혀야 하는 것은 **처리 시스템이라는 사실**이다.

### 6.4 구성

- LOGIC band를 2 lane으로: 왼쪽(들어온 것을 다루는 곳) · 오른쪽(밖으로 내보내는 곳)
- Path 줄기 1개가 상단 port에서 DATA까지 내려간다
- LOGIC 안에 junction 1개 → 우측 port(`결제사`)로 분기
- LOGIC 안에 **재시도 loop 1개**
- Port: 상단 `요청` (w3) · 우측 `결제사` (w2) · 우측 `메일` (w1)
- FAR 텍스트: Software 이름 1 + band 라벨 2 + port 라벨 3 = **6**

---

## 7. Agent Software

### 7.1 정의 구조는 카드가 아니라 회로다

```
환경 → 관찰 → 추론 → 행동 → 결과 ↘
                 ↑              기억
                 └───────────────┘
```

### 7.2 실루엣

질량 SURFACE 1 · LOGIC 10 · DATA 3 → 높이 **20 / 118 / 42**

가운데가 지배한다. 밖으로 강하게 뻗는다. 경로가 닫힌다.

### 7.3 구성

- LOGIC을 2 lane으로: **관찰/행동 lane**(왼쪽, 질량 4) · **추론 lane**(오른쪽, 질량 6, 밀도 높음)
- **Loop:** SURFACE → 관찰 lane → 추론 lane → 우측 port(행동) → 다시 관찰 lane. `returns: true`
- **Memory:** DATA band. 추론 lane에서 DATA로 짧은 Path 1개, DATA에서 추론으로 되돌아가는 Path 1개
- **Reach:** 우측 경계에 port 3개 (`웹` `파일` `모델`). 다른 어떤 케이스보다 port가 많다
- 실행 중일 때: **활성 구간 하나만** dash-offset이 흐른다. 전체 애니메이션 금지

### 7.4 금지

`[Prompt] [Memory] [Tool] [Model]` 카드 4개.
Memory는 카드가 아니라 **되돌아오는 Path를 가진 아래쪽 덩어리**다.
Tool은 카드가 아니라 **경계 위의 port**다.

---

## 8. Data / Database Software

### 8.1 실루엣

질량 SURFACE 1 · LOGIC 3 · DATA 12 → 높이 **19 / 38 / 123**

아래가 지배한다.

### 8.2 구성

- DATA band를 3–4 lane으로 나눈다 = **사람이 아는 개념**(사람 · 주문 · 기록)
- lane 사이 hairline. **관계 강도는 lane 경계를 가로지르는 짧은 Path의 굵기**(1px/1.5px/2.5px)로 표현
- lane마다 density field가 다르다 — 어디에 데이터가 몰려 있는지가 먼저 보인다
- FAR 라벨: 도메인 3개 + Software 이름 1개 = **4**

### 8.3 금지 (HARD)

ERD 금지. 테이블 · 컬럼 · 인덱스 · 제약 · FK 표기는 **DEEP에서만** 나온다.
FAR에서 `users(id, email, created_at)` 같은 것이 보이면 이 설계는 실패다.

### 8.4 Zoom

| 단계 | 보이는 것 |
|---|---|
| FAR | 도메인 3개 · 밀도 · 관계 강도 · 유입 방향 |
| MID | 도메인 안의 사람이 아는 개념들 · 중요한 관계 |
| NEAR | 선택한 데이터의 **생애**(생성 → 변경 → 보관 → 삭제) |
| DEEP | 스키마 · 컬럼 · 마이그레이션 (Contextual Surface에서만) |

---

## 9. Full-stack Software

### 9.1 여섯 개의 대시보드가 아니다. **하나의 몸**이다.

질량 SURFACE 6 · LOGIC 8 · DATA 6 → 높이 **55 / 70 / 55**

세 층이 모두 두께를 가진다. **경계는 하나다.**

### 9.2 구성

- SURFACE: 2 lane
- LOGIC: 2 lane — 왼쪽(처리) · 오른쪽(지능, 밀도 높음)
- DATA: 2 lane
- Path 줄기 1개가 SURFACE에서 DATA까지 **끊기지 않고 관통**한다 ← 하나의 몸이라는 증거
- Port: 상단 `브라우저`(w3) · 우측 `결제`(w2) · 우측 `모델`(w2) · 하단우 `백업`(w1)

### 9.3 사용자가 라벨 없이 읽어야 하는 것

> "위쪽은 내가 쓰는 부분이고, 안쪽에서 뭔가 처리되고,
>  아래쪽에 정보가 쌓이고, 밖의 서비스랑 연결돼 있구나."

이 문장이 **UI에 적혀 있으면 안 된다.** 공간이 그 문장을 대신한다.

### 9.4 금지

`EXPERIENCE` `LOGIC` `DATA` `INTELLIGENCE` `EXTERNAL` 를 다섯 개의 박스에 인쇄하는 것.

---

## 10. Semantic Zoom

### 10.1 Zoom은 배율이 아니라 **의미 해상도**다

| 단계 | 보이는 것 | Text 예산 | 잉크 총량 |
|---|---|---|---|
| **FAR** | 몸 전체 · band · 밀도 · reach · port · 현재 상태 | **3–7** | 기준 |
| **MID** | 한 region 안의 의미 객체 · 사람의 행동 · 주요 흐름 | **≤14** | 기준 (±10%) |
| **NEAR** | 선택 대상의 지역 경로 · 관계 · 영향 · 짧은 상태 | **≤22** | 기준 (±10%) |
| **DEEP** | 파일 · API 이름 · 스키마 · diff · 로그 | 제한 없음 | **캔버스 아님** |

### 10.2 전이 규칙

- **DOM은 언마운트하지 않는다.** 질량 값을 바꾸고 좌표를 재계산한다 (프로토타입에서 검증된 방식)
- **MID 진입 = 대상 region의 질량에 ×8 배율.** 형제 band는 FLOOR로 붕괴해 얇은 띠로 남는다
  → 사라지지 않으므로 **깊이 방향 감각이 유지**되고 breadcrumb이 필요 없다
- **NEAR 진입 = 대상 lane 안의 표식 하나가 Path로 해상**된다 (표식 1개 → 3–5 단계 경로)
- **DEEP은 Zoom이 아니다.** Contextual Surface가 담당한다. 캔버스는 절대 파일을 그리지 않는다

### 10.3 이전 구현과의 차이 (명시)

| | 이전 | V02 |
|---|---|---|
| Zoom 결과 | 라벨이 늘어남 | 해상도가 바뀜 |
| 형제 요소 | 사라지거나 테두리로 남음 | **질량이 붕괴해 띠로 남음** |
| 깊이 인지 | notch 라벨(텍스트) | **band 두께(형태)** |
| 잉크 | 누적 | **일정** |

### 10.4 조작

| 입력 | 동작 |
|---|---|
| region / lane 클릭 | MID 진입 |
| 표식 / Path 클릭 | 선택 (Contextual Surface 열림) |
| 선택 상태에서 다시 클릭 | NEAR 진입 |
| `Esc` / `← 밖으로` | 한 단계 밖으로 |
| 스크롤 | **Zoom 아님.** 사용하지 않는다 (오작동 방지) |

---

## 11. Qode Selection Model

### 11.1 세 가지 진입

| | 상황 | Context 결정 |
|---|---|---|
| **A** | 아무것도 선택하지 않음 | JuQode가 대상을 판단한다 |
| **B** | 구조를 선택함 (region · path · 표식 · port) | 선택한 것이 Context |
| **C** | 의미적 위치에 들어와 있음 | **현재 Zoom 위치가 자동으로 Context** |

### 11.2 사용자는 Context를 설정하지 않는다 (HARD)

Context 설정 패널 · 파일 첨부 버튼 · `@` 멘션 · 범위 선택 다이얼로그 — **전부 금지.**

Composer 위 26px 한 줄이 현재 Context를 **알려줄 뿐**이다:

```
대상 · 로그인 흐름                                    (A: 대상 · 자동 판단)
```
mono 9.5px `--ink3`. 클릭 가능하지만 필수가 아니다.

### 11.3 선택 가능한 것

Region(band/lane) · Path(구간 단위) · 표식(의미 객체) · Port. **파일은 선택 대상이 아니다.**

---

## 12. Working State

### 12.1 원칙 — 정직

프로토타입에서 이미 동결된 규칙을 유지한다:
**진행률 바 없음 · 퍼센트 없음 · 스피너 없음 · 가짜 토큰 스트림 없음 · Agent 아바타 없음.**

### 12.2 표현

| 요소 | 상태 |
|---|---|
| Chrome 상태 점 | `--ink` → `--attention` |
| 영향 받는 region | **안정성을 잃는다** — `--sunk` 지반 톤이 그 영역에만 든다 (L3) |
| 활성 Path 구간 | **그 구간 하나만** dash-offset이 흐른다 (1.2s linear) |
| 나머지 캔버스 | **변하지 않는다** |
| Contextual Surface | 실제로 일어난 이벤트만 mono 목록으로 append |

**실제 이벤트가 들어오지 않으면 아무것도 움직이지 않는다.** 이것이 Build World / No Fake Motion이다.

---

## 13. Result State

### 13.1 순서가 중요하다

```
1. Software가 먼저 바뀐다        520ms · cubic-bezier(.22,.61,.36,1)
2. 바뀐 부분이 SETTLING 이 된다   파선 + attention + 지반 톤 — 아직 확인 안 됨
3. 증거가 도착하면 SETTLED′ 로 굳는다   실선 + 톤 소멸 (380ms)
4. 그다음 Contextual Surface가 한 문장을 말한다
```

> **결과는 "변경"이 아니라 "변경 + 확인 여부"다.** (정정됨 · L3 · E2)
> 에이전트의 "완료" 주장은 2번까지만 만든다. 3번을 만드는 것은 **증거뿐이다.**

Modal · Toast · 성공 카드 · 컨페티 — **금지.** 그것들은 결과가 아니라 결과의 *알림*이다.

### 13.2 한 문장

```
로그인 실패 후 30초 기다렸다가 다시 시도하도록 바꿨어요.
```
sans 15px. **한 문장.** 문단 금지. 근거는 그 아래 Evidence 블록에.

### 13.3 attention은 언제 사라지는가

사용자가 그 요소를 선택하거나, Zoom 단계를 바꾸거나, 다음 Qode를 실행할 때.
**시간 경과로 자동 소멸시키지 않는다.** 사용자가 못 본 변경이 조용히 사라지면 안 된다.

---

## 14. Growth Model

### 14.1 HARD RULE

> **Software가 자란다 = 사각형이 하나 더 생긴다 — 는 금지.**

### 14.2 자람이 바꿀 수 있는 것

| 축 | 변화 |
|---|---|
| **질량** | region의 mass ↑ → **band/lane 두께가 바뀐다 → 실루엣이 바뀐다** |
| **밀도** | 표식 수 ↑ → 밭이 짙어진다 |
| **경로** | Path에 구간이 삽입된다 / 분기가 생긴다 |
| **회로** | Path가 닫힌다 (loop 발생) |
| **reach** | port가 생기거나 weight가 커진다 |
| **깊이** | 새 lane이 열린다 |
| **경계** | dashed `--ink4` → solid `--ink` (Empty → 실재) |
| **새 region** | **드물다.** 진짜로 새로운 관심사가 생겼을 때만 |

### 14.3 기준 예시 — 재시도 (Lovable 필수 구현 대상)

```
BEFORE   요청 → 로그인 → 실패 → 되돌아감
AFTER    요청 → 로그인 → 실패 → 대기 → 재시도 ⟲ 로그인
```

시각적으로 일어나는 일:
1. Path에 구간 2개가 삽입되어 **경로가 길어진다**
2. `재시도` 끝이 `로그인` 앞으로 되돌아가 **닫힌 회로가 생긴다** ← 형태의 질적 변화
3. LOGIC band의 질량이 +2 → **band가 미세하게 두꺼워진다**
4. 새 구간 2개에 `--attention`

**"카드 하나가 추가됐다"가 아니라 "흐름이 되돌아오게 됐다"가 보인다.**

---

## 15. Contextual Surface

### 15.1 언제 나타나는가

선택 · Working · Result · Evidence 요청. **그 외에는 존재하지 않는다.**
폭 340px. `width` 전이 520ms. 닫힐 때 흔적을 남기지 않는다.

### 15.2 내용 규격

| 블록 | 형식 |
|---|---|
| 종류 | mono 10px `--ink3` (`선택` `작업 중` `결과` `근거`) |
| 이름 | sans 20–32px 700. **mono 금지** |
| 사실 블록 | 라벨 mono 9.5px / 값 sans 15px. hairline 구분 |
| 이벤트 | mono 타임스탬프 + sans 문장 |
| Evidence 진입 | 하단 고정. mono. `원본 보기 →` |

### 15.3 금지

Chat 히스토리 · 코드 뷰어(Evidence 안에서만) · 탭 · 아코디언 3단 이상 · 설정 폼.

---

## 16. Text Budget (HARD CONSTRAINT)

### 16.1 상한

| 단계 | 캔버스 위 텍스트 요소 최대 |
|---|---|
| FAR | **7** |
| MID | **14** |
| NEAR | **22** |
| DEEP | 캔버스 아님 (Contextual Surface) |

FAR의 7개 구성 예: Software 이름 1 + band 라벨 2 + port 라벨 3 + 상태 태그 1.

### 16.2 규칙

1. **캔버스에 문단 금지.** 설명은 Contextual Surface로
2. **한 단어는 화면에 한 번만.** 이름 / notch / 표식 / 인스펙터 / breadcrumb 중복 금지
3. **사람 이름은 sans, 기술 표기는 mono.** 섞지 않는다
4. band 라벨은 질량 상위 2개만. 나머지는 형태로 읽는다
5. 밀도 숫자(`+312`)는 FAR에 없다. MID에서만
6. 라벨이 겹치면 **라벨을 줄이지 말고 표시를 포기**한다 (말줄임 금지)

### 16.3 자동 검증

렌더 후 캔버스 SVG의 `<text>` 노드 수를 센다. 상한 초과 시 개발 모드에서 콘솔 경고.
이 카운터를 **테스트에 넣는다.** 텍스트 예산은 의견이 아니라 통과 조건이다.

---

## 17. Large-Project Degradation

### 17.1 가장 먼저 고정할 정의

> **파일은 의미 객체가 아니다.**
> 1,000개의 파일이 40개의 의미 객체일 수 있다.
> 파일 이름은 **DEEP에서만** 존재한다. 캔버스에는 영원히 올라오지 않는다.
>
> **그리고 (정정됨 · L5): 관측하지 않은 것은 계산하지 않는다.**
> JuQode는 저장소 전체를 미리 파싱하지 않는다. FAR에서는 FAR에 필요한 만큼만 안다.
> 그래서 첫 화면이 빠르고, **`UNKNOWN`이 정직한 기본값**이 된다.

### 17.2 규모별 동작

| 의미 객체 | FAR | MID | NEAR |
|---|---|---|---|
| **0** | 경계 + 원점만 | — | — |
| **1** | 표식 1개(9px) | 표식 + 라벨 1 | 그 경로 |
| **10** | 표식 10개, **라벨 0** | 표식 10 + 라벨 ≤6 | 선택 1개 |
| **100** | **밴드별 포화.** band 라벨만 | region 해상: 라벨 상위 ≤10 + 나머지는 톤 | 선택 1개 |
| **1,000 파일** | 영향 없음 | 영향 없음 | 영향 없음 |

### 17.3 100개에서 무엇이 보이는가

라벨이 아니라 **분포**가 보인다.
"이 소프트웨어는 SURFACE가 얇고 LOGIC 오른쪽 lane이 유난히 짙고 DATA는 두 도메인에 몰려 있다."
→ **어디를 Qode해야 하는지가 라벨 없이 결정된다.** 이것이 이 설계가 하는 일이다.

### 17.4 성능 상한

| | |
|---|---|
| SVG 노드 상한 | 표식 48 × lane 8 = 384 + 경로/포트 ≈ **500 미만** |
| 재계산 | 질량 변경 시에만. 매 프레임 아님 |
| 애니메이션 | `left/top/width/height` 전이 (프로토타입에서 검증) |
| 레이아웃 좌표 | **목표 좌표에서 계산한다. 전이 중 `clientHeight`를 읽지 않는다** (실제로 겪은 버그) |

---

## 18. Responsive / Minimum Desktop

| | |
|---|---|
| 최소 폭 | **1280px** |
| 최소 높이 | **760px** |
| 그 미만 | 캔버스를 그리지 않고 한 문장: `JuQode는 데스크톱에서 동작합니다.` |
| 모바일 | **지원하지 않는다.** 반응형 축소판을 만들지 않는다 |
| 1280–1600 | Contextual Surface 열리면 몸체 폭 720px 하한 |
| 1600+ | 몸체 폭 상한 1120px. 그 이상 커지지 않고 여백이 커진다 |
| band 최소 두께 | 8px. 그 미만이면 hairline 1px로 대체 |
| 다크 모드 | **v0.1 없음.** paper 단일 테마 |

---

## 19. Lovable Implementation Instructions

### 19.1 구현 순서 (이 순서를 지킨다)

1. `massSplit()` — 질량 → 좌표. **가장 먼저. 순수 함수. 테스트 가능**
2. `renderBoundary` / `renderBands` / `renderLanes`
3. `renderDensity()` — §3.3 표 그대로
4. `renderPaths()` — 직교 + halo
5. `renderPorts()`
6. 6개 샘플 데이터로 **정지 화면 6개를 먼저 통과**시킨다
7. 그다음 선택 / Contextual Surface
8. 그다음 Qode → Working → Result 전이
9. **Semantic Zoom은 마지막.** 질량 배율 변경만으로 구현

### 19.2 데이터 모델 (그대로 사용)

```ts
type Band = 'surface' | 'logic' | 'data'

interface Software {
  name: string
  state: 'empty' | 'live'
  bands: Region[]        // 항상 3개. 질량 0이어도 존재한다
  paths: Path[]
  ports: Port[]
}

interface Region {
  id: Band
  label?: string         // 질량 상위 2개만 렌더
  lanes: Lane[]          // 최소 1개
}

interface Lane {
  id: string
  mass: number           // 0 가능
  label?: string
  objects: number        // 의미 객체 수 → density field
  state?: State
}

type Anchor = [bandId: Band, fx: number, fy: number]   // fx, fy = 0..1

interface Path {
  id: string
  points: Anchor[]       // 직교로 이어진다
  returns?: boolean      // true면 마지막 점이 points[0..n]로 되돌아감 = loop
  mark?: number          // 0..1, 방향 삼각형 위치. 경로당 최대 1개
  label?: string         // MID 이상에서만
  state?: State
}

interface Port {
  id: string
  edge: 'top' | 'right' | 'bottom' | 'left'
  at: number             // 0..1
  weight: 1 | 2 | 3
  label: string
  state?: State
}

type State = 'selected' | 'changed' | 'failed' | 'absent' | 'past'
```

**band의 질량 = 그 band의 lane 질량 합.** 별도 필드를 두지 않는다.

### 19.3 렌더 대상

**SVG 하나.** Canvas 아님. DOM 요소를 좌표로 절대배치하는 방식도 아님.
이유: Path halo · 정밀 hairline · 선택 히트영역 · 접근성.

### 19.4 애니메이션

| | |
|---|---|
| duration | `520ms` |
| easing | `cubic-bezier(.22,.61,.36,1)` |
| 대상 | band/lane 좌표 · 표식 위치 · path `d` |
| 금지 | 등장 bounce · fade-in 지연 연출 · stagger · 파티클 |

### 19.5 기술 제약

- 라우터 없음. 상태 기계 하나
- 외부 차트/그래프/노드 에디터 라이브러리 **금지** (React Flow · D3 force · Cytoscape · Mermaid)
- shadcn Card / Badge / Progress / Skeleton **사용 금지** — 이 제품에 카드는 없다
- Tailwind는 레이아웃과 chrome에만. **SVG 내부는 토큰 상수로 직접**
- 웹폰트 실패 시 시스템 폰트로 정상 동작해야 한다

---

## 20. Acceptance Gates

`docs/design/primary-workspace-v02.html` 보드와 아래 표로 검수한다.

| # | 게이트 | 판정 방법 |
|---|---|---|
| 1 | Empty가 의미 있는 시각적 존재를 가진다 | 빈 화면에 경계 + 원점 + 깊이 예고가 있다. 카드 0개 |
| 2 | Backend-only가 Feature 없이 성립한다 | SURFACE band가 10px 선으로 붕괴하고 그 위에 port가 있다 |
| 3 | Agent가 Memory/Tool 카드 없이 이해된다 | 닫힌 회로 1개 + 우측 port 3개 + DATA 왕복 Path |
| 4 | Data가 ERD가 되지 않는다 | FAR에 테이블/컬럼/FK 표기 0개. 도메인 lane 3개 |
| 5 | Full-stack이 하나의 Software로 보인다 | 경계 1개. 관통 Path 1개 |
| 6 | FAR가 텍스트 없이 이해된다 | 라벨을 전부 가려도 6개 유형이 구분된다 |
| 7 | Zoom이 정보 해상도를 바꾼다 | FAR/MID/NEAR의 `<text>` 수가 7/14/22 이하이고 잉크 총량이 ±10% |
| 8 | 자람이 형태를 바꾼다 | 재시도 Qode 후 실루엣과 회로가 달라진다 |
| 9 | 어디를 Qode할지 알 수 있다 | 밀도가 짙은 곳 / attention이 붙은 곳이 즉시 보인다 |
| 10 | 100개가 라벨 과부하를 만들지 않는다 | 100 객체 FAR의 `<text>` ≤ 7 |
| 11 | Qode 결과가 Software를 바꾼다 | Modal이 아니라 캔버스가 먼저 변한다 |
| 12 | 전문 제품으로 보인다 | 그라디언트 0 · 이모지 0 · radius 0 · 그림자는 떠 있는 층에만 |
| 13 | VS Code / React Flow / 다이어그램 도구를 닮지 않았다 | 파일 트리 0 · 노드 핸들 0 · 화살촉 0 · 미니맵 0 |

---

# LOVABLE BUILD CONTRACT

> 다음 Lovable Agent 호출은 **설계 결정을 하지 않는다.** 아래를 그대로 만든다.

## BUILD — 무엇을 만드는가

**JuQode Primary Workspace. 단일 화면. 라우터 없음.**

### 화면 구조 (고정)

```
Chrome 44px  →  Software Space (flex)  +  Contextual Surface 340px (조건부)  →  Qode Composer 74px(+26px)
```

### 시각 원시요소 4개만 구현한다

`BOUNDARY` · `REGION(band × lane + density field)` · `PATH` · `PORT`
Junction과 Loop는 Path의 위상으로 구현한다. **새 컴포넌트를 만들지 않는다.**

### 배치 엔진

```
w_i = 0.06 + 0.94 × (mass_i / Σmass)
h_i = H × w_i / Σw
```
세로(band)와 가로(lane)에 같은 함수를 쓴다. 순수 함수로 분리한다.

### Density Field

| n | 크기 | 표시 수 |
|---|---|---|
| 1 | 9px | 1 |
| 2–4 | 7px | n |
| 5–12 | 6px | n |
| 13–28 | 5px | n |
| 29–48 | 4px | n |
| 49+ | 4px | 48 (포화. 크기·불투명도를 줄이지 않는다) |

### 필수 샘플 프로젝트

**Full-stack 하나 (`내 서비스`)** + **Empty 하나 (`새 프로젝트`)**. 두 개만.
Chrome에 전환 수단을 두지 않는다. `?sample=empty` 쿼리로 전환한다 (검수용).

Full-stack 질량: SURFACE 6 (lane 2) · LOGIC 8 (lane 2: 처리 5 / 지능 3) · DATA 6 (lane 2)
Port: 상단 `브라우저`(3) · 우측 `결제`(2) · 우측 `모델`(2) · 하단 `백업`(1)
Path: 관통 줄기 1개 + SURFACE 가로 2개 + LOGIC→우측 port 1개 + DATA 왕복 1개

### 필수 인터랙션 (5개. 그 이상 만들지 않는다)

1. **lane 클릭 → MID** (해당 lane 질량 ×8, 형제는 FLOOR로 붕괴, 표식이 라벨을 얻는다)
2. **표식/Path 클릭 → 선택** (Contextual Surface 열림)
3. **`Esc` / `← 밖으로` → 한 단계 밖으로**
4. **Composer 입력 + Enter → Working → Result**
5. **`?sample=empty` → Empty Software 렌더**

### 필수 Qode 변환 (정확히 이것)

입력: `로그인 실패하면 다시 시도하게 해줘`

```
BEFORE   요청 → 로그인 → 실패 → 되돌아감
AFTER    요청 → 로그인 → 실패 → 대기 → 재시도 ⟲ 로그인   (닫힌 회로)
```

1. Working: 활성 Path 구간 **하나만** dash 흐름. Chrome 점 `--attention`
2. Result: **캔버스가 먼저** 520ms 변형 → LOGIC 질량 8→10 (band가 두꺼워진다) → 새 구간 2개 `--attention`
3. 그다음 Contextual Surface: `로그인 실패 후 30초 기다렸다가 다시 시도하도록 바꿨어요.`

## DO NOT BUILD — 절대 만들지 않는 것

```
파일 트리 · 코드 에디터 · 터미널 · 로그 패널 · 미니맵 · 탭 · 사이드바 내비게이션
Chat 히스토리 · 메시지 버블 · Agent 아바타 · 타이핑 애니메이션 · 토큰 스트림
진행률 바 · 퍼센트 · 스피너 · Skeleton · Toast · Modal · 성공 카드 · 컨페티
Card / Badge / Progress / Avatar / Accordion(3단 이상) shadcn 컴포넌트
노드 에디터 핸들 · 드래그 연결 · 화살촉 · bezier 곡선 · 그리드 배경 · 스냅 가이드
ERD · 테이블 뷰 · 스키마 트리 · 사이트맵 · 컴포넌트 트리
다크 모드 · 모바일 레이아웃 · 온보딩 투어 · 빈 상태 일러스트 · 이모지
설정 화면 · Context 설정 패널 · 파일 첨부 · @ 멘션
React Flow · D3 · Cytoscape · Mermaid · 차트 라이브러리
```

## VISUAL TOKENS — 새로 만들지 않는다

```
paper #F7F5F2   surface #FFFFFF   sunk #EDEAE5
ink #0D0C0B   ink2 #4A4641   ink3 #857F77   ink4 #B5AEA5   hair #D8D3CC
attention #9A5B12   failure #8C2B20   past #5B6B84

font-sans  "Archivo","Noto Sans KR",sans-serif
font-mono  "IBM Plex Mono",ui-monospace,monospace   ← 사람 이름에 절대 쓰지 않는다
radius 0 · hairline 1px · 구조선 2px · 그림자는 떠 있는 층에만 · 그라디언트 0
transition 520ms cubic-bezier(.22,.61,.36,1)
min-width 1280px · min-height 760px
```

## ACCEPTANCE CRITERIA — 이것이 통과 조건이다

| # | 조건 |
|---|---|
| 1 | Full-stack FAR에서 캔버스 `<text>` 노드가 **7개 이하** |
| 2 | 라벨을 전부 숨겨도 Full-stack과 Empty가 형태로 구분된다 |
| 3 | `?sample=empty` 화면에 카드/목록/버튼 그리드가 **0개** |
| 4 | lane 클릭 시 형제 band가 **사라지지 않고 띠로 남는다** |
| 5 | MID의 `<text>` 노드가 **14개 이하** |
| 6 | Qode 후 **캔버스가 먼저 변하고** 그다음 Contextual Surface가 열린다 |
| 7 | Qode 후 LOGIC band가 **눈에 띄게 두꺼워진다** |
| 8 | Qode 후 경로에 **닫힌 회로**가 생긴다 |
| 9 | Working 중 화면에서 움직이는 것은 **Path 구간 하나 + Chrome 점**뿐 |
| 10 | 화살촉 · bezier · 카드 · 그라디언트 · 이모지가 **0개** |
| 11 | 1280×760에서 스크롤바 없이 전부 보인다 |
| 12 | 웹폰트 없이도 레이아웃이 깨지지 않는다 |

## 이 문서가 이미 결정한 것 (Lovable이 다시 정하지 않는다)

원시요소 개수 · 배치 공식 · FLOOR 값 · density cap · 텍스트 예산 · 색 · 폰트 ·
전이 시간과 easing · 화면 구조 · 인터랙션 개수 · 샘플 프로젝트 · Qode 변환 내용 ·
최소 해상도 · 금지 목록.

**Lovable에게 남은 일은 구현뿐이다.**
