# V1-102 차이 — PM 계약 v0 와 실측

**상태:** `DISCREPANCY / NOT_ACCEPT / NOT_A_GATE_PASS`
**PM 입력:** https://github.com/ju0o/JuQode-Private/issues/15#issuecomment-6185785121
**기획:** `ju0o/JuQode-Private` `planning/v1-release-20261015` `1ea0a7d`, `02_ARCHITECTURE_V1_REVIEWED.md` 의 H1/H2/H3 와 최소 인터페이스.
**원래 G1:** `8be58abec2a8e6db451780fa10a755bc6c6f2518`
**이번 실측:** `8c03f53ba5b529cf5d6bd38e138f3e85a58c245c` 의 `docs/evidence/g1-recheck-2026-10-15/`. 원래 증거 파일은 바꾸지 않았다.

이 문서는 PM 계약을 대체하지 않는다. 어댑터 코드를 추가하지 않는다. V1-207, V1-208, V1-209 는 시작하지 않았다.

| PM v0 | 실측과의 차이 |
| --- | --- |
| `detect` 가 설치, 인증 만료, PATH, 버전 드리프트, UNKNOWN 을 구분한다. | 버전과 경로는 읽혔다. H1 Claude 2.1.288 은 `loggedIn false`. H3 Claude 2.1.283 은 로그인되어 있다. ASUS Claude 2.1.289 는 로그아웃이고 H1 결과가 아니다. Codex JSONL 에는 model 키가 없었다. 설정 기본값으로 실제 모델을 단정하지 않는다. |
| 선택만으로는 Run 이 생기지 않고, 실행 승인만 한 Run 을 만든다. 불일치는 fail closed. | 제품 코드의 그 규칙은 이번 실측이 다시 증명하지 않는다. UNKNOWN 으로 남긴다. |
| 유효 권한이 자동 쓰기, `--auto`, 위험 생략이면 시작 전에 막는다. 전역 설정을 조용히 바꾸지 않는다. | Codex 사용자 프로필은 `approval_policy=never`, `sandbox_mode=danger-full-access` 다. 격리한 `on-request` 와 `workspace-write` 도 승인 없이 파일을 썼다. `--ignore-user-config` 가 스크래치 경로를 trusted 로 기록했다. 그 한 절은 되돌렸다. OpenCode 스크래치 `ask` 는 headless 에서 자동 거절되어 파일을 쓰지 않았다. `--auto` 는 쓰지 않았다. |
| 종료 코드와 조수 성공 문장은 Task PASS, 허가, 파일 증거가 아니다. | H3 에서 `Write` 거절 뒤에도 종료 코드 0, `subtype=success`, `is_error=false` 였다. |
| `respondToRequest` 는 관측된 요청에만 있고, 제공자마다 SUPPORTED/LIMITED/UNSUPPORTED/UNKNOWN 이다. Claude resume 은 Claude 전용이다. | Claude 거절 뒤 재개는 새 `--resume` 호출이었다. 멈춘 질문 이벤트는 이 쌍에서 보지 못했다. Codex `decline` 은 app-server 스키마에만 있고, exec 가 승인 요청을 만들지 않아 보내지 못했다. OpenCode headless 는 질문에 답하기 전에 자동 거절했다. |
| 취소와 reconcile 은 소유 프로세스에만, 추측으로 슬롯을 비우지 않는다. | 이번 묶음에서 취소와 crash reconcile 은 다시 실행하지 않았다. 이전 셀의 UNKNOWN 을 유지한다. |
| 시도마다 provider/model/version/profile/host 스냅샷. schema 14, 다음 migration 은 15. | 제품 schema 는 그대로다. 이번 커밋은 migration 을 추가하지 않는다. Codex 이벤트는 model 을 남기지 않았다. |
| H1/H2/H3 토폴로지. H2 가 없으면 H2 PASS 없음. Win EXE `wsl.exe` 브리지는 범위 밖. | H2 는 BLOCKED. ASUS 26.04 native 를 H2 나 H3 로 적지 않는다. 브리지는 실행하지 않았다. |
| 측정하지 않은 F07/F09/F10 은 그 측정면에서 UNKNOWN/LIMITED/UNSUPPORTED 로 남긴다. | 아래 표가 그 경계다. 전역 미지원으로 올리지 않는다. |
| V1-102 는 명세이고 어댑터 코드가 아니다. | 지킨다. |

이번 실측만의 판정. 다른 호스트로 확대하지 않는다.

| 표면 | 판정 |
| --- | --- |
| ASUS Codex 0.160.0, `--ignore-user-config` + `approval_policy=on-request` + `--sandbox workspace-write` | UNSUPPORTED. 승인 이벤트 없이 bash 가 `hello.txt` 를 썼다. `decline` 과 좁은 재개는 UNKNOWN. |
| ASUS OpenCode 1.19.0, 스크래치 `permission ask`, `--auto` 없음 | LIMITED. 파일은 안 생겼다. 기계가 응답할 질문 이벤트는 UNSUPPORTED. 재개는 UNKNOWN. |
| H3 Claude 2.1.283, `--allowedTools Edit(hello.txt)` | LIMITED. 측정된 쓰기 도구는 `Write` 다. 다른 경로 `Write` 는 거절됐다. resume cwd 는 호출자 디렉터리로 바뀌었다. |
| H1 Claude 2.1.288 | BLOCKED. `loggedIn false`. |
| H2 세 제공자 | BLOCKED. 호스트 없음. |
