# P0-1 · 확정 화면 ↔ 구현 대조표 (SCREEN_MATRIX)

- 일자: 2026-09-24 · 근거: `tmp-visual/` 스크린샷 36종 + `results.json` (e2e 실측)
- Canon `15` 상태 목록 대비. 각 행에 스크린샷 파일명 또는 "미구현" 기재 (완료 기준 충족).

## SC-01 (진입)

| 상태 | 스크린샷 | 비고 |
|---|---|---|
| 기본 light/dark | sc01-light.png · sc01-dark.png | ✅ |
| 실패 카드 | sc01-fail-light.png · sc01-fail-dark.png | ✅ (서명 미확인 문구 포함) |
| 복귀 | sc01-return-light.png · sc01-return-dark.png | ✅ |
| 거부 저장소 부팅 | (results: refused-store boot PASS) | 증거 있음, 캡처 없음 |

## SC-02 (브리핑)

| 상태 | 스크린샷 | 비고 |
|---|---|---|
| 기본 | sc02-light.png · sc02-dark.png | ✅ |
| 해석중 | sc02-interpreting-light.png | ✅ (dark 미촬영) |
| 실행중 | sc02-running-light/dark · sc02-running-1024.png | ✅ |
| stale | sc02-stale-light.png · sc02-stale-dark.png | ✅ (stale-only dark 미촬영) |
| reduced-motion | sc02-reduced-motion.png | ✅ |

## SC-03 (작업)

| 상태 | 스크린샷 | 비고 |
|---|---|---|
| 취소 | sc03-cancel-light/dark.png | ✅ |
| 실패 | sc03-failed-light/dark.png | ✅ |
| 부분 | sc03-partial-light/dark.png | ✅ |
| 권한 | sc03-permission-light/dark.png | ✅ |
| quiet | sc03-quiet-light/dark.png | ✅ |
| 결과 | sc03-result-light/dark.png | ✅ |

## SC-04 (리더)

| 상태 | 스크린샷 | 비고 |
|---|---|---|
| 설명 | sc04-explained-light/dark.png | ✅ |
| 리더 | sc04-reader-light/dark.png | ✅ |
| 빈 리더 | (results: emptyReader PASS) | 증거 있음, 캡처 없음 |

## TD-01 (터미널)

| 상태 | 스크린샷 | 비고 |
|---|---|---|
| 기본 | td01-light.png · td01-dark.png | ✅ |
| shell | td01-shell-light/dark.png | ✅ |
| 최소 880x600 | td01-min-880x600.png | ✅ |

## 신규 표면 4건 (P0-1 추가분)

| 표면 | 상태 |
|---|---|
| 되돌리기 확인 박스 | ✅ 구현 (results: revertConfirm·revertCancelled, sc03Rollback) — 전용 캡처 없음 |
| 빈 폴더 카드 | ❌ 미구현 (emptyReader는 리더-빈 상태로 별개) |
| 첫 실행 3줄 | ❌ 미구현 (온보딩 증거 없음) |
| 배포 경고 줄 | ❌ 미구현 (배포 관련 증거 없음) |

## 결론

- 기존 5화면×상태: 구현 확인 (캡처 36종 + results.json).
- 신규 4건 중 1건 구현·3건 미구현 → P0-2·P2-4/P2-6 문구 작업 시 3건이 선행 과제.
