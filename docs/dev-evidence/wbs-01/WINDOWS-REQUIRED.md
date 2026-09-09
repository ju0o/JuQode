# WINDOWS HOST REQUIRED

**WBS-01 인수 조건 첫 줄은 이 기계에서 만족될 수 없다.**

`21` WBS-01 Acceptance: **Windows 10 (1809+) · Windows 11 에서 부팅한다** (D-125).

이 Run 이 돌아간 기계:

```
Linux ju0o 7.0.0-31-generic  ·  Ubuntu 26.04.1 LTS  ·  x86_64
/proc/version 에 microsoft 없음 (WSL 아님)  ·  /mnt/c 없음  ·  wine 없음
```

Windows 부팅 · 시작 시간 · 설치 프로그램 · 서명 · ConPTY · Windows 프로세스 트리는
**전부 NOT TESTED** 다. 유추하지 않았고, 리눅스 결과를 Windows 결과로 옮겨 적지 않았다.

---

## Founder 가 실행할 명령 — 하나면 된다

Windows 10 (1809+) 또는 Windows 11 **클라이언트** 기계에서, 저장소를 클론한 뒤
**일반(관리자 아님) PowerShell** 에서:

```powershell
git clone -b dev/mvp-wbs00-wbs01 https://github.com/ju0o/JuQode.git; cd JuQode; pwsh -ExecutionPolicy Bypass -File scripts\verify-windows.ps1
```

Node 18+ 와 npm 이 PATH 에 있어야 하고, 창이 실제로 뜨므로 데스크톱 세션이어야 한다.
관리자 권한도, 서명 인증서도, `npm ci` 이후의 네트워크도 필요 없다.

두 대(10 과 11) 모두 있으면 **양쪽에서** 돌린다. 한 대만 있으면 다른 쪽은 NOT TESTED 로 남는다.

## 하네스가 수집하는 것

| | |
|---|---|
| 호스트 | 정확한 에디션 · DisplayVersion · 빌드.UBR · 아키텍처 · **서버 SKU 여부** |
| 도구 | Node · npm · 경로 |
| 설치 | clean `npm ci` **+ 명시적 Electron 바이너리 페치** (42+ 는 `postinstall` 이 없다) |
| 테스트 | 단위 · e2e 전부 |
| 부팅 | 5회 · 창 1개 · **외부 요청 0** · 시작 시간 · exit code |
| SC-01 | 렌더 · 문구 · 브리지 표면 · 넘침 · 중심 편차 |
| 테마 | **OS 선호 × 토글 여섯 조합 전부**의 대비 |
| 패키징 | 빌드 **그리고 실제 실행** — PE 생성만으로는 판정하지 않는다 |
| 서명 | **PE 인증서 테이블**로 판정. electron-builder 로그를 믿지 않는다 |
| WBS-00 | ConPTY 생성·출력·resize·종료·정리 · 자식 스폰·취소·프로세스 트리·고아 |
| 종료 | 잔존 JuQode/electron 프로세스 수 |
| 증거 | `docs\dev-evidence\wbs-01\windows\<edition>-<build>\` 에 report.json · report.md · 스크린샷 · raw 로그 |

## 안전장치

- **서버 SKU 를 감지하면 `supplementalOnly` 로 표시하고**, Windows 10/11 클라이언트 검증으로
  보고하지 않는다. GitHub 호스티드 러너는 Windows Server 이므로 보조 회귀 증거일 뿐이다.
- `scripts\windows-spikes.mjs` 는 `process.platform !== 'win32'` 면 **실행을 거부한다** —
  리눅스 결과가 Windows 증거 파일로 기록될 수 없다.
- 실패한 단계는 `verdict.failedSteps` 에 남고 종료 코드가 1 이 된다. 조용히 통과하지 않는다.

## 이것이 열어 주는 것

한 번의 실행으로 함께 닫힌다:

- WBS-01 인수의 대상 OS 조항
- WBS-00 의 ConPTY · Windows 프로세스 수명주기 스파이크
- `19` §V 의 패키징 · PTY(ConPTY) · 서명 **NOT VALIDATED** 행
- 대상 OS 실측 시작 시간 (현재는 리눅스 바닥값뿐이고, 그것을 예산으로 삼지 않았다)
