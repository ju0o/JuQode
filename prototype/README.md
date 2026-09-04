# JuQode — Functional Prototype (Phase 3)

**인터랙션 검증용 프론트엔드 프로토타입.** 제품 전체가 아니다.

## 열기

```
index.html 을 더블클릭한다.  끝.
```

**`index.html` 하나로 완결되어 있다.** 외부 요청 **0건** —
CSS · JS · 데이터가 모두 그 파일 안에 들어 있다.
그래서 `file://` 로 열어도, 다른 폴더로 옮겨도, 그 파일만 전달해도 동작한다.

| 필요 없는 것 | |
|---|---|
| npm install · 빌드 | 없음 |
| localhost · Python 서버 | 없음 |
| 확장 프로그램 · 브라우저 보안 플래그 | 없음 |
| 인터넷 | 없음 (웹폰트도 불러오지 않는다 — 시스템 폰트로 대체) |

> **이전에 깨진 이유:** `index.html` 이 `app.css` · `data.js` · `app.js` 세 형제 파일을
> 상대 경로로 불러왔다. 그 파일들이 함께 오지 않는 전달 경로(브라우저에서 파일만 저장,
> 파일 하나만 복사, 프로토타입이 없는 branch)에서는 `file://` 로 열 때
> **ERR_FILE_NOT_FOUND** 가 나고 화면이 기본 HTML 스타일로만 보였다.
> 지금은 그 실패가 구조적으로 불가능하다.

> **화면이 안 뜨면** — `이 화면이 아직 뜨지 않았습니다` 라는 문장이 보인다.
> 조용히 빈 화면이 되지 않게 부팅 확인 블록을 넣어 두었다.

## 무엇을 증명하는가

```
Software World → My Service → 로그인 → Qode → Working → Result
                                                          ↓
                                        구조에 "30초 기다리기" 가 나타난다
```

**가장 중요한 결과는 요약이 아니라 Software 구조가 바뀌는 것이다.**

## 근거 문서

| | |
|---|---|
| 제품 결정 | `JuQode-Private/docs/26_DECISIONS.md` — **D-053** (C+A Hybrid LOCKED) |
| 시각 기준 | `JuQode-Private/docs/design/DESIGN.md` — v0.1 Visual Tone (FROZEN) |
| 구현 계약 | `JuQode-Private/docs/handoffs/LOVABLE_HANDOFF_V01.md` |

**이 프로토타입에서 토큰을 새로 만들지 않았다.** 모든 색·굵기·간격은 DESIGN.md에서 왔다.

## 파일

| | |
|---|---|
| **`index.html`** | **산출물. 자기완결.** 이것만 열면 된다 (생성된 파일) |
| `build.mjs` | `src/` 를 `index.html` 하나로 합친다 |
| `src/index.template.html` | 4영역 골격 (Chrome / Primary / Contextual / Qode) |
| `src/app.css` | DESIGN.md 토큰 + 상태 스타일 |
| `src/data.js` | Mock 데이터 (소프트웨어 · 기능 · 동작 · 관계) |
| `src/app.js` | 레이아웃 엔진 + 상태 기계 + Semantic Zoom |

**고칠 때는 `src/` 를 고치고 `node build.mjs` 를 돌린다.**
`index.html` 을 직접 고치면 다음 빌드에서 덮어써진다.
빌드는 외부 참조가 0건인지 검사하고, 하나라도 남으면 실패한다.

## Semantic Zoom 구현 방식

**라우터가 없다.** DOM은 한 번만 만들고 언마운트하지 않는다.
`depth`가 바뀌면 **좌표만 다시 계산**하고 CSS 전이가 공간 연속성을 만든다.

```
World      My Service 판이 필드 안 자기 자리에 있다
Service    같은 판이 확대되어 Workspace가 된다 · World는 얇은 테두리로 남는다
Feature    로그인 판이 확대된다 · World + My Service 두 테두리가 남는다
```

지나온 단계는 **테두리 + notch label**로 남는다 — 그래서 breadcrumb이 없다.

> **레이아웃은 실측값이 아니라 목표 좌표에서 계산한다.**
> 전이 도중의 `clientHeight`를 읽으면 음수 좌표가 나온다 (실제로 겪은 버그).

## 조작

| | |
|---|---|
| My Service 클릭 | 안으로 들어간다 |
| 기능 클릭 | 선택 (오른쪽 면이 나타난다) |
| 로그인 다시 클릭 / `안으로 들어가기` | 동작 구조로 들어간다 |
| `Qode 실행` / Enter | 시뮬레이션 시작 |
| `← 밖으로` / `Esc` | 한 단계 나간다 |

## 검수용 파라미터 (제품 기능 아님)

```
?drive=service|selected|feature|working|done   실제 click 이벤트로 그 상태까지 자동 진행
?still=1                                        전이를 즉시 끝낸다 (스크린샷용)
```

## 없는 것 (의도적)

```
Backend · Database · 인증 · Repository 파싱 · Git · 실제 Coding Agent
실제 Context 검색 · 실제 검증 · 배포 · 라우터 · 빌드 도구 · 외부 의존성
```

`Working`과 `Result`는 **시뮬레이션**이다. 다만 정직하게 만들었다 —
진행률 바 · 퍼센트 · 스피너 · 가짜 토큰 스트림 · Agent 아바타가 없고,
**실제로 일어난 일**만 이벤트로 적는다.

## 나중을 위해 자리만 남긴 것

Context 검사/정정 · Skill · Change Story · Evidence · UNKNOWN/FAIL ·
Software Time · 비교 · 안전한 되돌리기 — **구현하지 않았고, 막지도 않았다.**

## 어느 branch에 있는가

이 프로토타입은 **`docs/public-foundation`** branch에 있다.
`main` 은 아직 비어 있다 (PR #1 미merge).

```
git clone -b docs/public-foundation https://github.com/ju0o/JuQode.git
```

또는 GitHub에서 `prototype/index.html` → **Raw** → 저장.
**단일 파일이므로 그것만으로 충분하다.**
