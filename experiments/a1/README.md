# `experiments/a1/` — 버리는 코드

> ## 📜 HISTORICAL ARCHITECTURE EVIDENCE — 아직 지우지 않는다
>
> **A1c 아키텍처 동결의 근거다. PM 이 동결을 확인할 때까지 보관한다.**
> 확인 후 삭제/이동할 수 있다. **제품 코드가 아니다.**
>
> | | |
> |---|---|
> | **Status** | **DISPOSABLE** — A1a 아키텍처 비교를 위한 일회용 검증 |
> | **Architecture Frozen** | **NO** |
> | **Implementation Authorized** | **NO** |
> | **수명** | **PM 이 A1c 동결을 확인한 뒤** 삭제/이동 가능 |

여기 있는 것은 **아키텍처 선택지를 비교하기 위해서만** 존재한다.
제품이 되지 않는다. 여기서 잘 동작한 코드를 그대로 제품에 옮기지 않는다.

**이 실험들은 `prototype/` 을 한 글자도 건드리지 않았다.** 산출물은 전부 `/tmp` 에 만들고 버린다.

| 파일 | 무엇을 물었는가 | 어떤 A1 질문에 답하는가 |
|---|---|---|
| `exp1-sqlite.mjs` | 네이티브 모듈 설치 없이 SQLite 가 되는가 · WAL / JSON1 / 생성컬럼 인덱스 / FTS5 / 무결성 검사 | **A1-8** · A1-9 |
| `exp2-git-safety.sh` | 사용자의 작업 상태를 **건드리지 않고** 되돌릴 지점을 만들 수 있는가 | **A1-15** · A1-7 · A1-12 |
| `exp2b-git-gaps.sh` | 실험 2가 드러낸 구멍 둘 — 거짓 복원 · Git 없는 프로젝트 | **A1-15** · A1-13 |
| `exp3-agent-spawn.mjs` | 에이전트 CLI 를 자식 프로세스로 띄우고 구조화 Event 를 스트리밍할 수 있는가 | **A1-9** · A1-10 · A1-14 |
| `exp4-credentials.sh` | "비밀은 평문 DB 에 넣지 않는다"가 이 플랫폼에서 실제로 가능한가 | **A1-14** · 보안 |
| `exp5-local-scan.mjs` | AI 없이 로컬에서만 얼마나 빨리 무엇을 알 수 있는가 | **A1-1** · **A1-2** · A1-5 |
| `exp6-engine-cost.mjs` | 동결된 물리 엔진의 프레임당 계산 비용 | **A1-14** |

## 실행

```bash
node experiments/a1/exp1-sqlite.mjs
bash experiments/a1/exp2-git-safety.sh
bash experiments/a1/exp2b-git-gaps.sh
node experiments/a1/exp3-agent-spawn.mjs
bash experiments/a1/exp4-credentials.sh
node experiments/a1/exp5-local-scan.mjs <프로젝트경로>
node experiments/a1/exp6-engine-cost.mjs
```

측정된 결과와 그 해석은 `JuQode-Private/docs/current/14_A1_ARCHITECTURE_DECISION_PACKET.md` 에 있다.
**여기 있는 숫자를 결정으로 읽지 마라.** 결정은 PM 과 Founder 가 한다.
