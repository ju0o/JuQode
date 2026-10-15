# HOST_TOPOLOGY — V1-111 사실 표

**상태:** `FACTUAL_MATRIX / NOT_A_HOST_CERTIFICATION / NOT_A_GATE_PASS`
**기획:** `1ea0a7d` 의 H1 Windows 11 x64 native, H2 Ubuntu 24.04 LTS x64 native, H3 WSL2/WSLg Ubuntu 26.04.1 LTS x64. Windows GUI 에서 `wsl.exe` 로 Linux CLI 를 부르는 경로는 V1 범위 밖이다.
**실측:** `ju0o/JuQode-Private` `8c03f53ba5b529cf5d6bd38e138f3e85a58c245c`. 원래 G1 묶음 `8be58ab` 은 수정하지 않았다.

이 표는 호스트 합격이 아니다. 측정한 것과 계획만 있는 것을 구분한다. 비어 있는 칸은 UNKNOWN 이고, 호스트가 없으면 BLOCKED 다.

| 면 | 계획 | 이번에 확인한 사실 | 아직 아닌 것 |
| --- | --- | --- | --- |
| H1 | Windows 11 native Electron 과 Windows CLI, NTFS | `DESKTOP-UU9DD3I`, Windows 10.0.26200.9711. Claude `2.1.288` 은 `loggedIn false`, `authMethod none`. Docker CLI 29.6.2 는 있고 엔진 파이프는 없다. | Electron 실행, Codex, OpenCode 를 이번 묶음에서 다시 실행하지 않았다. 인증이 끝나기 전에는 Claude 셀이 BLOCKED 다. |
| H2 | Ubuntu 24.04 LTS x64 native Electron 과 Linux CLI | 그 OS 가 없다. ASUS 는 26.04.1 native 다. WSL Ubuntu 는 26.04.1 이다. multipass, qemu, libvirt, podman, VirtualBox 는 ASUS 에 없다. Docker Desktop 엔진은 멈춰 있고, 컨테이너는 native H2 가 아니다. | C4, C5, C6 은 BLOCKED. 이미지를 받거나 가상 머신을 만들지 않았다. |
| H3 | 같은 WSL distro 안의 Linux Electron 과 Linux CLI. `/home` 과 `/mnt/c` 는 별도. | Ubuntu 26.04.1, virt `wsl`, kernel `6.18.54.1-microsoft-standard-WSL2`, Claude `/usr/bin/claude` `2.1.283`. `Edit(hello.txt)` 허용에서 측정된 도구는 `Write` 였다. `--resume` 의 init cwd 는 호출한 디렉터리였다. 거절된 `other.txt` 는 생기지 않았다. | 이번 묶음은 H3 Electron 을 켜지 않았다. `/mnt/c` 쓰기는 다시 하지 않았다. WSLg 디스플레이 인증이 아니다. |
| 범위 밖 | Windows GUI `wsl.exe` 브리지 | 실행하지 않았다. | 지원으로 적지 않는다. |
| 비인증 작업 머신 | 표에 없음 | `ju0o`, Ubuntu 26.04.1 native, virt none, kernel `7.0.0-38-generic`. Codex 0.160.0 과 OpenCode 1.19.0 격리 실측만 했다. | H2 나 H3 의 대체 측정이 아니다. |

절대 경로로 확인한 바이너리와 cwd 는 위 실측 파일에 있다. PATH 그림자, PATHEXT, H1 Codex 의 PATH 밖 설치는 원래 C2 의 사실이고 이번 묶음이 다시 측정하지 않았다. 그 항목은 UNKNOWN 이 아니라 원래 증거에 남긴다.
