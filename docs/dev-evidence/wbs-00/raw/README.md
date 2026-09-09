# WBS-00 원시 증거

## 이 폴더가 존재하는 이유

첫 제출에서 스파이크 원시 로그는 `/tmp` 에만 있었다. 독립 감사가 그것을 지적했고(M-3),
**그 사이에 실제로 사라졌다** — 세션 스크래치가 정리되면서 전부 없어졌다.

그래서 죽은 로그를 커밋하는 대신 **재생성 가능하게** 만들었다. 스크립트가 저장소에 있고,
아래 JSON 은 그 스크립트를 이 호스트에서 돌린 **실제 출력**이다.

## 정직한 한계

여기 있는 JSON 은 **2026-09-09 재실행분**이다. 원래 스파이크의 로그는 복구할 수 없다.
`WBS-00-REPORT.md` 의 수치 중 이 폴더에 대응 파일이 없는 것(스파이크 A 의 부팅 타이밍·패키징,
스파이크 D 의 10k 픽스처 성능표)은 **당시 전사(transcription)이며 원시 로그가 남아 있지 않다.**
스파이크 A 의 측정값은 WBS-01 이 같은 것을 더 나은 조건에서 다시 재고 있으므로
(`docs/dev-evidence/wbs-01/`) 그쪽이 더 신뢰할 만한 증거다.

## 파일

| 파일 | 스크립트 | 무엇을 증명하는가 |
|---|---|---|
| `spike-c.json` | `scripts/spikes/process-lifecycle.mjs` | 프로세스 수명주기 · 취소 · 고아 (POSIX) |
| `spike-d-evidence-contract.json` | `scripts/spikes/evidence-contract.mjs` | **정정된** 증거 계약 — 비밀 제외와 제외-경로 원장 |

## 재현

```bash
node scripts/spikes/process-lifecycle.mjs  > docs/dev-evidence/wbs-00/raw/spike-c.json
node scripts/spikes/evidence-contract.mjs  > docs/dev-evidence/wbs-00/raw/spike-d-evidence-contract.json
```

두 스크립트 모두 harmless 명령만 쓰고, 자기 픽스처를 `/var/tmp` 에 만들었다가 지우며,
**사용자 프로젝트를 건드리지 않는다.**

## 비밀 취급

`spike-d-evidence-contract.json` 에는 `JUQODE_SYNTHETIC_SECRET` 이라는 **합성 마커**가 나온다.
이것은 픽스처가 만든 가짜 문자열이고 **실제 자격증명이 아니다.** 그 마커의 등장 횟수가
0인지를 세는 것이 이 실험의 판정 기준이다.
