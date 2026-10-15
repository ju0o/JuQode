# V1-310 화면 증거 — 확인하지 못한 이전 시도

**상태:** `EVIDENCE / NOT_A_GATE_PASS`
**부모 구현:** `1b851a9feef4a5db4b74d4a15ad311863a511a05`
**무엇의 증거가 아닌가:** Visual SSOT가 아니다. `docs/v1/as-is/DESIGN_BASELINE.md`와 `docs/v1/as-is/ARCH_AS_IS.md`는 f905858 스냅샷으로 그대로다. tracked golden을 바꾸지 않았다. G1, G2, G4, G5 PASS가 아니다.

호스트는 이 작업 머신의 Linux다. H1, H2, H3가 아니다. e2e Claude는 fixture다. 프로젝트 이름은 임시 시드 `juqode-seed-*`다. 집 경로와 비밀값은 넣지 않았다.

| 파일 | 화면 |
| --- | --- |
| `td01-active-run-light.png` | 밝은 테마. 끝나지 않은 작업 중 `빌드해줘`. 회색 칩 `지금 안 됨 · 실패 아님`. 문장은 작업이 진행 중이라고 말한다. |
| `td01-active-run-dark.png` | 같은 상태의 어두운 테마. |
| `td01-active-run-short-light.png` | 내용 높이 600px. 같은 문장과 셸 입력줄이 창 안에 있다. |
| `td01-prior-unknown-light.png` | 확인하지 않은 `ended_unknown` 시도. 문장은 이전 시도가 멈췄는지 아직 확인하지 못했다고 말한다. 진행 중이라고 쓰지 않는다. |
| `td01-prior-unknown-dark.png` | 같은 상태의 어두운 테마. |
| `td01-prior-unknown-short-light.png` | 내용 높이 600px. 같은 문장과 셸 입력줄이 창 안에 있다. |

캡처 명령은 `npm test` 안의 `tests/e2e/visual.mjs`다. 출력 원본은 gitignore된 `tmp-visual/`이고, 이 디렉터리의 파일은 그 실행에서 복사한 것이다.
