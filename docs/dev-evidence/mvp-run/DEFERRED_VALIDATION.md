# DEFERRED VALIDATION — TARGET WINDOWS

**This file is the standing debt ledger for the autonomous MVP run.**

Run state model (three values, no fourth):

| State | Meaning |
|---|---|
| `PASS` | implemented **and** validated on the target platform |
| `IMPLEMENTED_PENDING_VALIDATION` | implemented, tested on Linux, **target-OS evidence does not exist yet** |
| `BLOCKED` | cannot be implemented — architecture, contract, or dependency |

`IMPLEMENTED_PENDING_VALIDATION` is **not** `BLOCKED`. Nothing in this file stops
implementation work. Every entry is closed by one command on a Windows host —
`scripts/verify-windows.ps1` (see `docs/dev-evidence/wbs-01/WINDOWS-REQUIRED.md`).

Host this run executes on:

```
Linux ju0o 7.0.0-31-generic · Ubuntu 26.04.1 LTS · x86_64
no /proc/version microsoft · no /mnt/c · no wine   → not WSL, not Windows
```

Nothing below has been inferred from a Linux result. Where a Linux measurement
exists it is recorded as a Linux measurement and is **not** carried across.

## Entries

| # | Item | WBS | Canon reference | State | Closed by |
|---|---|---|---|---|---|
| DV-1 | Boot on Windows 10 (1809+) and Windows 11 | WBS-01 | `21` WBS-01 Acceptance · D-125 | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → boot ×5 |
| DV-2 | Measured startup time on the target OS (no invented budget) | WBS-01 · WBS-00 | `21` WBS-01 Acceptance | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → boot timings |
| DV-3 | NSIS installer installs and first run reaches SC-01 | WBS-33 | `21` WBS-33 Risks | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → packaging step |
| DV-4 | Packaged `.exe` actually launches (PE produced ≠ runs) | WBS-01 · WBS-33 | `19` §V packaging NOT VALIDATED | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → launch packaged exe |
| DV-5 | Code signing judged from the PE certificate table | WBS-33 | `19` §V signing NOT VALIDATED | IMPLEMENTED_PENDING_VALIDATION | `Get-AuthenticodeSignature` in the harness |
| DV-6 | ConPTY: create · output · resize · exit · cleanup | WBS-00 · WBS-25 | `19` §C6 PTY NOT VALIDATED | IMPLEMENTED_PENDING_VALIDATION | `scripts/windows-spikes.mjs` (refuses to run off win32) |
| DV-7 | Windows process spawn · cancel · process tree · orphans | WBS-00 · WBS-23 · WBS-24 | `19` §C4 | IMPLEMENTED_PENDING_VALIDATION | `scripts/windows-spikes.mjs` + `taskkill /T` 가 claude 트리를 실제로 끝내는지 (배치 31) |
| DV-12 | `claude-detect.js` 의 Windows 실행 파일 해석 — `PATHEXT` · `COMSPEC` · `.cmd`/`.bat` 래퍼 | WBS-09 | `19` §D1 | IMPLEMENTED_PENDING_VALIDATION | 아래 |
| DV-8 | Theme contrast, all six OS-preference × toggle combinations, on Windows | WBS-36 | `16` §2.1 · D-135 | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → theme matrix |
| DV-9 | Claude Code resolved from PATH on Windows (`claude.cmd`, PATHEXT, `cmd.exe` routing) | WBS-09 | `21` WBS-09 · D-125 | IMPLEMENTED_PENDING_VALIDATION | run the app on Windows with an npm-global Claude Code and confirm 설치되지 않음 is NOT reported |
| DV-10 | `fs.realpathSync.native` canonicalises CASE on NTFS, so one folder is one `project` row | WBS-02 · WBS-21 | `20` `project.path` unique | IMPLEMENTED_PENDING_VALIDATION | open the same folder twice on Windows with different casing; expect one row |
| DV-13 | e2e 3종이 Windows 에서 통과하는가 — `launch.mjs` 의 `cmd.exe` 경로 · `taskkill` 정리 · 프로세스 집계 | WBS-01 · WBS-33 | D-125 | IMPLEMENTED_PENDING_VALIDATION | `npm run test:e2e` on Windows (배치 31 에서 리눅스만 측정) |
| DV-14 | 패키징된 exe 의 로딩 실패가 단일 인스턴스 잠금 때문이었는지 — 누수를 없앤 뒤 재실행 | WBS-33 | `19` §V | UNRESOLVED_NEEDS_RERUN | `verify-windows.ps1` 재실행 (배치 31 이 진단만, 확정 못함) |
| DV-15 | `windows-spikes.mjs` 가 왜 JSON 없이 죽었는가 | WBS-00 | `19` §C4 · §C6 | UNRESOLVED_NEEDS_RERUN | 하네스가 이제 종료 코드와 마지막 6줄을 보고한다 (배치 31) |
| DV-16 | 패키징된 빌드에서 `app.getPath('exe')` 가 실제 JuQode.exe 를 가리키고 PE 인증서 테이블이 읽히는가 | WBS-33 | `21` WBS-33 · 원칙 2 | IMPLEMENTED_PENDING_VALIDATION | Windows 에서 설치본 실행 → SC-01 에 서명 고지가 뜨는지 (배치 32 는 합성 PE 로만 측정) |

### Why DV-9 and DV-10 exist

Both were found by review, not by a test, and both are Windows-only by nature:

- **DV-9** — `execFile('claude', …)` spawns without a shell, and Windows `CreateProcess`
  appends only `.exe` while an npm-global Claude Code installs `claude.cmd`. The plain spawn
  would return `ENOENT`, which this code maps to `not-installed` — so an installed CLI would
  be reported as 설치되지 않음. `claude-detect.js` now walks `PATHEXT` explicitly and routes a
  `.cmd`/`.bat` through `cmd.exe` (Node refuses to spawn those directly since the
  CVE-2024-27980 mitigation). Every argument on that path is a compile-time constant, so
  there is no quoting hazard. **None of it has run on Windows.**
- **DV-10** — `fs.realpathSync` is Node's JS implementation and preserves the caller's case
  for non-link segments; only `fs.realpathSync.native` canonicalises. On NTFS
  `C:\Users\Bob\Proj` and `c:\users\bob\proj` are one folder but two strings, which would
  be two rows past `project.path`'s unique key. The code now calls `.native`. On Linux the
  two are genuinely different folders, so no test here can tell the difference.

## Rule this run follows

A WBS package whose only outstanding item is a DV entry is recorded
`IMPLEMENTED_PENDING_VALIDATION` and **the run continues**. A package is
`BLOCKED` only when the work itself cannot be done here — and that is stated with
the specific reason, never with "Windows".


## DV-11 · TD-01 의 셸 명령줄 — **판정됨: 파이프 셸 GO** (PM · 2026-09-10)

**판정:** 파이프 셸. `DV-11-DECISION.md` §4 의 동반 조건 네 개를 전부 승인받았다 —
① 한계를 화면에서 말한다 ② 그 실패를 빨강으로 그리지 않는다 ③ 색 없음·순서 근사도 고지한다
④ 줄 사이 셸 상태를 유지한다(장수 셸 하나). 조건이 빠진 GO 는 원칙 위반이므로 구현의 일부다.

**여전히 재지 않은 것 — 판정이 바꾸지 않는다:** Windows(ConPTY 도, Windows 의 파이프 셸도),
Electron 메인 프로세스 안에서의 같은 실측. 아래 본문은 판정 이전의 재료로 그대로 남긴다.


`15` TD-01 은 서랍 안에 **셸 명령줄**을 요구하고(사용자가 직접 명령을 친다), `19` §C6 REC-010 은
프로젝트당 pty 하나를 말한다. 같은 절이 **"Real T1 must validate: pty libraries per runtime;
Windows ConPTY"** 라고 적어 두었다 — Canon 스스로 미검증이다.

이 런에서 넣지 않은 이유는 두 가지고, 둘 다 이 저장소가 이미 내린 결정이다.

1. `tests/unit.test.js` 의 능력 격리 검사가 `node-pty` 를 **어디에도 없어야 하는 것** 목록에
   두었다. 네이티브 모듈은 Electron 버전마다 재빌드가 필요하고, DB 가 `node:sqlite` 를 고른
   이유가 바로 그것이다(CF-5).
2. 대상 OS 는 Windows 이고 이 런에서 DEFERRED_VALIDATION 이다. **검증할 수 없는 OS 에서
   네이티브 모듈을 새로 들이는 것은 검증된 진척이 아니다.**

**들어간 것:** 서랍 전체 · 상시 배너 · Quick Command 카드 전부 · 실행기(자기 자식 프로세스,
셸 없음). REC-010 자신이 긴 Quick Command 는 서랍 pty 가 아니라 자기 프로세스에서 돈다고
적어 두었으므로, QC 는 pty 없이 온전히 동작한다.

**남은 것:** 사용자가 직접 치는 셸 줄 하나. 그리고 그것을 위한 결정 — node-pty 를 들일지,
파이프 셸(TTY 없음)로 정직하게 갈지, `18` `term.mock` 이 이미 자리를 마련해 둔 mock 으로 갈지.
셋 다 제품 결정이고 구현 결정이 아니다.

**판정 재료는 만들어 두었다 — `DV-11-PIPE-SHELL-SPIKE.md`** (`scripts/spikes/pipe-shell.mjs`,
Linux 실측). 결정을 바꿀 만한 수치 하나: 파이프 셸에는 `/dev/tty` 가 없어서 `sudo` · `ssh` ·
git 자격증명 프롬프트가 **물어보지도 못하고 실패한다.** 그리고 닫힌 stdin 은 정지가 아니라
**조용한 빈 답**이다 — 화면에 아무 이상이 안 보인다. 반대로 정지(그룹 시그널)와 stdin 으로
답하기는 이미 된다. **Windows 는 재지 않았고 이 재료는 Windows 에 대해 아무 말도 하지 않는다.**

## DV-12 · Windows 실행 파일 해석은 Linux 에서 도달할 수 없다

배치 26 의 돌연변이 스윕이 `claude-detect.js` 에서 살아남은 것 여섯 중 **넷**을 이렇게 표시했다.
전부 `process.platform === 'win32'` 뒤에 있다:

- `resolveBin()` 의 `if (process.platform !== 'win32') return 'claude';` — Linux 는 여기서 끝난다
- `PATHEXT || '.COM;.EXE;.BAT;.CMD'` 의 기본값
- `PATH || ''` 의 기본값
- `.cmd`/`.bat` 을 `COMSPEC || 'cmd.exe'` 로 감싸 실행하는 경로

**Linux 에서는 실행되지 않으므로 Linux 테스트로 죽일 수 없다.** 죽이려고 `process.platform` 을
가짜로 바꾸면 검사하는 것은 그 가짜지 Windows 가 아니다 — DV-6 · DV-7 과 같은 이유로, 이 런은
**측정할 수 없는 것을 측정했다고 말하지 않는다.**

Windows 에서 확인해야 할 것: `claude.cmd` 가 `PATH` 에 있을 때 탐지가 그것을 찾는가 ·
`PATHEXT` 가 비표준일 때도 찾는가 · `.cmd` 래퍼가 `cmd.exe` 를 통해 실제로 실행되는가 ·
`COMSPEC` 이 비어 있을 때 기본값이 동작하는가. `scripts/windows-spikes.mjs` 가 붙을 자리다.
