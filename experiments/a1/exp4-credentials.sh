#!/usr/bin/env bash
# A1 실험 4 — OS 자격증명 저장소 실재 확인 (일회용)
# 묻는 것: "비밀은 평문 DB 에 넣지 않는다"(D-058)가 이 플랫폼에서 실제로 가능한가?
echo "── Linux (이 개발 머신) ──"
echo "secret-tool 존재:  $(command -v secret-tool || echo '없음')"
echo "libsecret pkg:     $(pkg-config --exists libsecret-1 && pkg-config --modversion libsecret-1 || echo '없음')"
echo "DBus 세션 버스:     ${DBUS_SESSION_BUS_ADDRESS:-없음}"
echo -n "Secret Service 응답: "
if command -v busctl >/dev/null 2>&1; then
  busctl --user list 2>/dev/null | grep -q "org.freedesktop.secrets" && echo "있음" || echo "없음 (헤드리스/키링 미실행)"
else echo "busctl 없음"; fi
echo "gnome-keyring 프로세스: $(pgrep -c gnome-keyring 2>/dev/null || echo 0)"
echo
echo "판정: Secret Service 가 없으면(헤드리스·일부 배포판) 저장 경로가 사라진다."
echo "      → 대체 경로가 반드시 설계되어야 한다. 이것이 A1 결정 사항이다."
