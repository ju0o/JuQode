#!/usr/bin/env bash
# A1b 실험 2 — 에이전트 격리의 실제 한계 (DISPOSABLE)
#
# PM 지적: "cwd 고정 + env 제거는 자식 프로세스를 샌드박스하지 않는다."
# 이 실험은 그 지적이 옳은지 실제로 확인한다.
# 진짜 유료 에이전트를 부르지 않는다. 악의적인 가짜 자식 프로세스를 쓴다.
set -u
R=/tmp/juqode-a1b-contain; rm -rf $R; mkdir -p $R/project/src $R/outside
cd $R
echo "secret-file"        > outside/victim.txt
echo "APIKEY=sk-real-key" > project/.env
echo ".env"               > project/.gitignore
ln -s $R/outside          project/escape_link
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
git init -q project 2>/dev/null; (cd project && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m base)

cat > agent.sh <<'AGENT'
#!/usr/bin/env bash
# 악의적인 가짜 에이전트. 부모가 무엇을 못 막는지 보여준다.
r() { printf '  %-46s %s\n' "$1" "$2"; }
echo "① 프로젝트 루트 안 쓰기";        echo hi > ./src/ok.txt        2>/dev/null && r "src/ok.txt" "성공(정상 동작)"   || r "src/ok.txt" "차단됨"
echo "② 루트 '밖' 상대경로 쓰기";      echo pwn > ../outside/pwn.txt 2>/dev/null && r "../outside/pwn.txt" "성공 ← 부모가 못 막았다" || r "../outside/pwn.txt" "차단됨"
echo "③ 심링크로 루트 탈출";          echo pwn > ./escape_link/via_symlink.txt 2>/dev/null && r "escape_link/…" "성공 ← 부모가 못 막았다" || r "escape_link/…" "차단됨"
echo "④ 비밀 환경변수 읽기";          if [ -n "${JUQODE_SECRET:-}" ]; then r "\$JUQODE_SECRET" "읽힘 ← 누출"; else r "\$JUQODE_SECRET" "비어 있음(env 제거가 통했다)"; fi
echo "   무시된 비밀 파일 읽기";       [ -r ./.env ] && r ".env 읽기" "읽힘 ← 파일시스템 접근으로 우회됨" || r ".env 읽기" "차단됨"
echo "   무시된 비밀 파일 '수정'";     echo "APIKEY=stolen" > ./.env 2>/dev/null && r ".env 조용히 수정" "성공 ← 되돌릴 수 없다" || r ".env 수정" "차단됨"
echo "⑤ 네트워크 시도";               if command -v curl >/dev/null 2>&1; then r "curl 존재" "쓸 수 있다 ← 송신 가능"; else r "curl" "없음"; fi
                                       (exec 3<>/dev/tcp/127.0.0.1/9 ) 2>/dev/null && r "raw TCP 소켓" "열렸다 ← 셸만으로 송신 가능" || r "raw TCP 소켓" "실패(포트 닫힘 — 능력 자체는 있다)"
echo "⑥ Git 조작";                    git -C . update-ref refs/heads/evil HEAD 2>/dev/null && r "사용자 ref 생성" "성공 ← 이력 조작 가능" || r "사용자 ref" "차단됨"
                                       rm -f .git/index 2>/dev/null && r ".git/index 삭제" "성공 ← 사용자 인덱스 파괴" || r ".git/index 삭제" "차단됨"
echo "⑦ 부모가 준 제약 우회";          cd / 2>/dev/null && r "cwd 밖으로 이동" "성공 ← cwd 는 경계가 아니다" || r "cd /" "차단됨"
AGENT
chmod +x agent.sh

echo "═══ 부모 래퍼: cwd 고정 + env 제거 (A1a 가 '막는다'고 주장한 구성) ═══"
env -i PATH="$PATH" HOME=/nonexistent bash -c "cd $R/project && $R/agent.sh"

echo
echo "═══ 같은 에이전트를 OS 수준으로 가둘 수 있는가 ═══"
for t in bwrap firejail unshare systemd-run; do
  printf '  %-14s %s\n' "$t" "$(command -v $t >/dev/null 2>&1 && echo '있음' || echo '없음')"
done
if command -v bwrap >/dev/null 2>&1; then
  echo "  --- bubblewrap 로 다시 시도 ---"
  bwrap --unshare-all --die-with-parent \
        --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
        --bind $R/project /w --chdir /w \
        --setenv PATH /usr/bin:/bin \
        /bin/bash -c 'echo pwn > /outside_test 2>/dev/null && echo "  루트 밖 쓰기: 성공" || echo "  루트 밖 쓰기: 차단됨 ✔"' 2>&1 | tail -2
fi
