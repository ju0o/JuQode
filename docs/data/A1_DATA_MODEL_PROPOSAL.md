# A1 · Logical Data Model (ER) — PROPOSED

> ## ⚠️ PROPOSED — 결정이 아니다
>
> | | |
> |---|---|
> | **Status** | **PROPOSED** |
> | **Architecture Frozen** | **NO** |
> | **Implementation Authorized** | **NO** |
> | **Phase** | A1a — Architecture Decision Packet |
> | **Product Version** | v0.1 MVP |
> | **Product SSOT** | `JuQode-Private/docs/current/00_MASTER_INDEX.md` |
> | **판정 대장** | `JuQode-Private/docs/current/14_A1_ARCHITECTURE_DECISION_PACKET.md` |
> | **확인일** | 2026-09-06 (A1a) |
>
> **이 문서는 초안이다.** 여기 있는 어떤 문장도 Canon 이 아니고, 구현 지시가 아니다.
> 선택지 · 비용 · 반대 근거는 위의 판정 대장에 있다. **결정은 PM 과 Founder 가 한다.**

> **마이그레이션을 만들지 않았다.** 이것은 **논리 모델**이다. 실행되는 스키마가 아니다.

---

## 1. 관계도

```
Project ──1:N── SoftwareBoundary ──1:N── SemanticPlace
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     │                        │                        │
              SemanticSourceMapping   SemanticRelation           PlaceNaming
              (N:N 파일↔자리)          (자리↔자리)                (이름 · 출처)
                                              │
Project ──1:N── ContextBlock ──1:N── ContextVersion              Problem ──N:1── SemanticPlace
                     │                                              ▲
                     │                                              │ 1:N
                     └──── N:N (usage) ──── Qode                Observation
                                              │                     ▲
                                              │ 1:N                 │
                                          Execution ────1:N─────────┘
                                              │
                     ┌────────────────────────┼───────────────┬──────────────┐
                     │                        │               │              │
                 AgentEvent               Evidence      SafetyRecord   SoftwareTimePoint
                                              │               │
                                          Artifact ◄──────────┘
Skill ──N:N── Qode
```

---

## 2. 엔티티별 명세

### Project
| | |
|---|---|
| **왜 존재하는가** | 사용자가 여는 것의 단위. Launcher 의 행 하나 |
| **진실의 출처** | **파일시스템** (폴더) |
| **수명** | 사용자가 제거할 때까지 |
| **관계** | 1:N SoftwareBoundary · 1:N ContextBlock |
| **버전** | 없음 |
| **어디에** | **DB** (경로 · 이름 · 마지막 열람). **코드는 아니다** |
| **주의** | 경로가 아니라 **안정된 서명**으로 동일성을 잡는다 — 폴더를 옮겨도 살아남아야 한다 |

### SoftwareBoundary
| | |
|---|---|
| **왜** | *"이것이 하나의 Software 다"* = **되돌릴 수 있음의 경계** (E1) |
| **진실** | **Repository** — 추론된다 |
| **수명** | 재분석마다 갱신 |
| **관계** | N:1 Project · 1:N SemanticPlace |
| **어디에** | DB |
| **v0.1** | **한 번에 하나만.** 모노레포 다중 경계는 v0.1 밖 |

### SemanticPlace
| | |
|---|---|
| **왜** | Qode 의 대상 · Problem 의 앵커 · Deep View 의 축 |
| **진실** | **추론 + 사람 정정.** Repository 에서 파생되나 Repository 에 없다 |
| **수명** | 매핑 서명이 유지되는 동안 |
| **관계** | N:N Source (겹침) · N:N Place (관계) · 1:N Problem · 1:N Naming |
| **버전** | 모델 스냅샷 단위 |
| **어디에** | DB |
| **⚠ 규칙** | **id 는 내부에만 존재한다.** 사용자에게 개체로 노출되지 않는다 — 만들 수도 지울 수도 옮길 수도 없고 목록으로 열거되지 않는다 |

### SemanticSourceMapping
| | |
|---|---|
| **왜** | 자리 ↔ 파일. **재스캔에도 정정이 살아남게 하는 서명의 원천** |
| **진실** | Repository + 추론 |
| **관계** | **N:N** — 한 파일이 두 자리에 속할 수 있다. **분할이 아니다** |
| **어디에** | DB |

### SemanticRelation
| | |
|---|---|
| **왜** | 인과(L2) — 어디서 와서 어디로 가는가. 전파 깊이 1(v0.1) |
| **진실** | 의존 그래프 (로컬 · 결정적) |
| **어디에** | DB |

### PlaceNaming
| | |
|---|---|
| **왜** | 이름 정정이 **휘발되면 사용자는 두 번 고치지 않는다** |
| **진실** | `USER > AI > LOCAL_FALLBACK` |
| **수명** | **자리보다 오래 산다** — 매핑 서명에 묶여 재스캔을 견딘다 |
| **관계** | N:1 Place. **한 자리가 이름 여럿을 갖는다**(겹침) |
| **어디에** | DB |

### ContextBlock / ContextVersion
| | |
|---|---|
| **왜** | Core Product Primitive. 사용자가 시간을 들여 쌓는 **자산** |
| **진실** | **사용자** |
| **수명** | 영구. 삭제는 사용자만 |
| **필수 5필드** | `id · version · scope · origin · portable` — 없으면 나중에 Cloud/History/승인 UX 를 못 붙인다 |
| **버전** | **ContextVersion 으로 분리** — History/Restore 의 전제 |
| **어디에** | DB + **사람이 읽는 Export 파일** (D-024) |

### Skill
| | |
|---|---|
| **왜** | Evidence 수집 계획의 엔진 — *"Skill 이 없으면 무엇을 검증할지 알 수 없다"* |
| **진실** | **JuQode** (v0.1 은 BUILTIN 만) |
| **어디에** | DB (또는 코드 내 상수) |

### Qode
| | |
|---|---|
| **왜** | 주 작업 단위 = 의도 + 대상 + 준비된 맥락 |
| **진실** | **사용자의 의도** |
| **관계** | N:1 Place · N:N Context · N:N Skill · **1:N Execution** |
| **어디에** | DB |
| **⚠** | **RUN 은 Qode 를 만들지 않는다** |

### Execution
| | |
|---|---|
| **왜** | 한 번의 시도. **RUN 이 앉을 자리**이고 스냅샷이 붙는 곳 |
| **진실** | 실제 프로세스 실행 |
| **관계** | N:1 Qode (**RUN 은 NULL**) · 1:N AgentEvent · 1:N Evidence · 1:N Observation · 1:1 SafetyRecord |
| **어디에** | DB |
| **`kind`** | `QODE` \| `RUN` |

### AgentEvent
| | |
|---|---|
| **왜** | **No Fake Motion 의 데이터 원천.** Visual 은 이것의 렌더링일 뿐이다 |
| **진실** | 에이전트 프로세스 stdout |
| **수명** | 영구 (D-010 — 삭제하지 않는다) |
| **어디에** | **봉투는 DB · 원본 스트림은 파일시스템** |
| **⚠** | **파싱 실패한 줄도 버리지 않는다** — 에이전트는 사람 말도 섞어 뱉는다 |

### Observation
| | |
|---|---|
| **왜** | 기계가 본 것. 여섯 출처가 여기로 들어온다. **사람에게 안 보인다** |
| **진실** | 실행 · 테스트 · 빌드 · 정적분석 · 에이전트 · 사용자 |
| **관계** | N:1 Execution · N:1 Problem |
| **어디에** | DB (+ 원본은 Artifact) |

### Problem
| | |
|---|---|
| **왜** | World 의 읽히는 지표. **사람 말 한 줄** |
| **진실** | Observation 에서 파생 |
| **관계** | N:1 Place · **1:N Observation (필수 — 없으면 존재 불가)** |
| **어디에** | DB |
| **센다** | `occurrences · first_seen · last_seen` → 화면의 **`3번 중 2번`** |

### Evidence
| | |
|---|---|
| **왜** | *"제대로 됐나"* 에 답한다. `SETTLING → SETTLED` 의 유일한 통로 |
| **진실** | **실행 결과.** 에이전트의 주장이 아니다 |
| **관계** | N:1 Execution · N:1 Artifact |
| **어디에** | 메타는 DB · 원본은 파일시스템 |
| **⚠ 제약** | `UNKNOWN` 이면 `what_would_verify` 필수 · `AGENT_CLAIM` 은 `SETTLED` 를 만들 수 없다 |

### Artifact
| | |
|---|---|
| **왜** | Raw 원본 — Agent Log · Diff · 스크린샷 · 테스트 출력 |
| **진실** | 자기 자신 |
| **수명** | **영구. 삭제하지 않는다** (D-010) |
| **어디에** | **파일시스템** (내용 해시 이름). DB 에는 **참조만** |
| **왜 DB 가 아닌가** | 삭제하지 않는 원본을 DB 에 넣으면 DB 는 반드시 커진다 |

### SoftwareTimePoint
| | |
|---|---|
| **왜** | *"소프트웨어가 이런 상태였다"*. **커밋이 아니라 평형** |
| **진실** | **Git** — `refs/juqode/equilibrium/*` |
| **관계** | N:1 Execution |
| **어디에** | **Git 객체 + DB 의 메타(사람 말 한 줄)** |
| **⚠** | **확인된 평형만 점이 된다.** 밖에서 일어난 변경은 점을 만들지 않는다 |

### SafetyRecord
| | |
|---|---|
| **왜** | 되돌리기 · 되돌리기의 되돌리기 · 보관 |
| **진실** | **Git 객체** — `refs/juqode/safety/*` · `refs/juqode/discarded/*` |
| **수명** | 영구 — *"보관됨 · 없어지지 않았습니다"* 가 참이어야 한다 |
| **어디에** | **Git + DB 참조** |
| **⚠** | 약속 목록과 보관 내용이 **같은 객체에서 나온다** → 구조적으로 일치한다 |

---

## 3. 무엇이 어디에 사는가 — 한 장

| 어디 | 무엇 | 왜 |
|---|---|---|
| **Repository** | 사용자 코드 · 파일 | Machine Truth |
| **Git** | 이전 평형 · 버려진 상태 · 시간축의 점 | 변경/안전 Truth |
| **DB** | 자리 · 문제 · Qode · 실행 · Context · Evidence **메타** | 관계 질의가 필요하다 |
| **파일시스템** | Agent Log 원본 · Diff · 스크린샷 · 테스트 출력 | D-010 · DB 를 부풀리지 않는다 |
| **OS 자격증명 저장소** | 비밀 | 평문 DB 금지 |
| **사람이 읽는 파일** | Context Export | D-024 Free Floor |
