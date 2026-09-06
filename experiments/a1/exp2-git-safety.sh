#!/usr/bin/env bash
# A1 실험 2 — Qode 이전 안전 스냅샷 (일회용)
# 묻는 것: 사용자의 작업 상태(더러운 워킹트리 · 추적 안 된 파일 · 스테이징)를
#          "건드리지 않고" 되돌릴 수 있는 지점을 만들 수 있는가?
# 버릴 것: /tmp 의 저장소. 제품 코드가 아니다.
set -u
R=/tmp/juqode-a1-exp2; rm -rf $R; mkdir -p $R; cd $R
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
git init -q -b main
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m base
echo "tracked v1" > tracked.txt
git add tracked.txt
git -c user.name=t -c user.email=t@t commit -q -m v1

# ── 사용자가 Qode 전에 남겨둔 진짜 상태 ──────────────────────────────
echo "tracked v2 (사용자가 저장 안 한 편집)" > tracked.txt   # 워킹트리 수정
echo "staged"      > staged.txt   && git add staged.txt      # 스테이징만 된 것
echo "untracked"   > untracked.txt                           # 추적 안 됨
mkdir -p node_modules && echo x > node_modules/junk          # 무시 대상
echo "node_modules/" > .gitignore

echo "── 스냅샷 전 상태 ──"
git status --porcelain=v1 | sed 's/^/   /'
BEFORE_STATUS=$(git status --porcelain=v1)
BEFORE_HEAD=$(git rev-parse HEAD)

# ── 방법 A: git stash create (HEAD·인덱스·워킹트리 불변) ─────────────
A=$(git -c user.name=t -c user.email=t@t stash create "juqode pre-qode" 2>/dev/null)
echo
echo "방법 A · stash create → ${A:-<빈값>}"
if [ -n "$A" ]; then
  echo "   담긴 파일: $(git ls-tree -r --name-only $A | tr '\n' ' ')"
  echo "   untracked 포함? $(git ls-tree -r --name-only $A | grep -c untracked.txt)"
fi

# ── 방법 B: 별도 인덱스 + commit-tree (untracked 까지, HEAD 불변) ────
export GIT_INDEX_FILE=$R/.git/juqode-index
rm -f "$GIT_INDEX_FILE"
git read-tree HEAD
git add -A                                   # .gitignore 는 그대로 존중된다
T=$(git write-tree)
B=$(git -c user.name=t -c user.email=t@t commit-tree $T -p HEAD -m "juqode pre-qode snapshot")
unset GIT_INDEX_FILE
git update-ref refs/juqode/safety/exp2 $B    # 참조를 붙여 GC 로부터 지킨다
echo
echo "방법 B · commit-tree → $B"
echo "   담긴 파일: $(git ls-tree -r --name-only $B | tr '\n' ' ')"
echo "   untracked 포함? $(git ls-tree -r --name-only $B | grep -c untracked.txt)"
echo "   무시대상 제외?  $(git ls-tree -r --name-only $B | grep -c node_modules || true)"

# ── 스냅샷이 사용자 상태를 건드렸는가 ────────────────────────────────
echo
echo "── 스냅샷 후 상태가 그대로인가 ──"
[ "$BEFORE_HEAD" = "$(git rev-parse HEAD)" ] && echo "   HEAD 불변 ✔" || echo "   HEAD 이동 ✘"
[ "$BEFORE_STATUS" = "$(git status --porcelain=v1)" ] && echo "   워킹트리·인덱스 불변 ✔" || echo "   상태 변함 ✘"
echo "   tracked.txt 내용: $(cat tracked.txt)"

# ── 되돌리기: Agent 가 망친 뒤 B 로 복원 ─────────────────────────────
echo
echo "── Agent 가 변경한 뒤 되돌리기 ──"
echo "AGENT 가 덮어씀" > tracked.txt; echo "agent new" > agent_new.txt; rm -f untracked.txt
echo "   되돌리기 전: tracked=$(cat tracked.txt) · untracked.txt 존재=$([ -f untracked.txt ] && echo y || echo n) · agent_new=$([ -f agent_new.txt ] && echo y || echo n)"

# 되돌리기 자체를 되돌릴 수 있도록 "지금"도 먼저 보관한다
export GIT_INDEX_FILE=$R/.git/juqode-index; rm -f "$GIT_INDEX_FILE"; git read-tree HEAD; git add -A
NOW=$(git -c user.name=t -c user.email=t@t commit-tree $(git write-tree) -p HEAD -m "juqode pre-rollback")
unset GIT_INDEX_FILE; git update-ref refs/juqode/discarded/exp2 $NOW
echo "   버려질 상태 보관 → $NOW"

git checkout -q $B -- .            # 워킹트리를 스냅샷으로
git read-tree HEAD                 # 인덱스는 HEAD 기준으로 되돌린다
echo "   되돌린 후: tracked=$(cat tracked.txt) · untracked.txt 복원=$([ -f untracked.txt ] && echo y || echo n) · agent_new 남음=$([ -f agent_new.txt ] && echo y || echo n)"

echo
echo "── 되돌리기의 되돌리기 ──"
git checkout -q $NOW -- .
echo "   재복원: tracked=$(cat tracked.txt) · agent_new=$([ -f agent_new.txt ] && echo y || echo n)"

echo
echo "── 보관된 것이 살아 있는가 (약속한 수 = 보관한 수) ──"
git for-each-ref --format='   %(refname) → %(objectname:short)' refs/juqode/
