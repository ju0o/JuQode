#!/usr/bin/env bash
# A1 실험 2b — 실험 2가 드러낸 두 구멍 (일회용)
#  구멍 1: 스냅샷 이후 새로 생긴 파일은 복원해도 사라지지 않는다 → "그때 그대로"가 거짓이 된다
#  구멍 2: Git 저장소가 아예 없는 프로젝트
set -u
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
GC="git -c user.name=t -c user.email=t@t"

echo "════ 구멍 1 · 복원 = 동일 상태 로 만들기 ════"
R=/tmp/juqode-a1-exp2b; rm -rf $R; mkdir -p $R; cd $R
git init -q -b main; $GC commit -q --allow-empty -m base
echo v1 > keep.txt; echo "node_modules/" > .gitignore; mkdir -p node_modules; echo x > node_modules/junk
$GC add -A; $GC commit -q -m v1

snap () {  # 사용자 상태를 건드리지 않고 스냅샷 하나
  local msg="$1"
  export GIT_INDEX_FILE=$R/.git/jq-idx; rm -f "$GIT_INDEX_FILE"
  git read-tree HEAD; git add -A
  local c=$($GC commit-tree $(git write-tree) -p HEAD -m "$msg")
  unset GIT_INDEX_FILE; echo "$c"
}
S=$(snap "pre-qode"); echo "스냅샷 $S · 담긴 것: $(git ls-tree -r --name-only $S | tr '\n' ' ')"

echo "-- Agent 가 파일을 더하고 지운다 --"
echo v2 > keep.txt; echo new > agent_added.txt; mkdir -p src; echo deep > src/deep.txt
echo "   지금: $(ls | tr '\n' ' ')"

echo "-- 나이브 복원 (checkout -- .) --"
cp -r $R /tmp/jq-naive >/dev/null 2>&1
git checkout -q $S -- .
echo "   결과: $(ls | tr '\n' ' ')   ← agent_added.txt 가 남는다 = 거짓 복원"

echo "-- 정확 복원 (스냅샷 이후 추가된 것을 diff 로 찾아 지운다) --"
# 스냅샷에 없고 지금 있는 추적/신규 파일을 정확히 열거한다
export GIT_INDEX_FILE=$R/.git/jq-idx2; rm -f "$GIT_INDEX_FILE"
git read-tree HEAD; git add -A; NOWTREE=$(git write-tree); unset GIT_INDEX_FILE
ADDED=$(git diff --name-only --diff-filter=A $S $NOWTREE)
echo "   스냅샷 이후 새로 생긴 것: $(echo $ADDED | tr '\n' ' ')"
for f in $ADDED; do rm -f "$f"; done
git checkout -q $S -- .
find . -type d -empty -not -path './.git/*' -delete 2>/dev/null
echo "   결과: $(ls | tr '\n' ' ')   ← 스냅샷과 동일"
echo "   무시대상 살아있나(건드리면 안 됨): node_modules/junk = $([ -f node_modules/junk ] && echo 있음 || echo '사라짐 ✘')"

echo
echo "════ 구멍 2 · Git 저장소가 없는 프로젝트 ════"
P=/tmp/juqode-a1-exp2b-nogit; rm -rf $P; mkdir -p $P/src; cd $P
echo "hello" > src/app.js; echo "readme" > README.md
echo "   .git 있음? $([ -d .git ] && echo y || echo n)"

# 방법: 프로젝트 안을 더럽히지 않는 별도 저장소(그림자)를 둔다
SH=/tmp/juqode-a1-shadow; rm -rf $SH; mkdir -p $SH
git --git-dir=$SH --work-tree=$P init -q -b main 2>/dev/null || git init -q --separate-git-dir=$SH $P >/dev/null 2>&1
export GIT_DIR=$SH GIT_WORK_TREE=$P
git add -A 2>/dev/null
SNAP=$($GC commit-tree $(git write-tree) -m "shadow snapshot" 2>/dev/null)
git update-ref refs/juqode/safety/nogit $SNAP
echo "   그림자 저장소 스냅샷: $SNAP"
echo "   담긴 것: $(git ls-tree -r --name-only $SNAP | tr '\n' ' ')"
echo "   프로젝트 폴더에 .git 이 생겼나? $([ -d $P/.git ] && echo '생김 ✘' || echo '안 생김 ✔')"
echo "   프로젝트 폴더 내용: $(ls -A $P | tr '\n' ' ')"
unset GIT_DIR GIT_WORK_TREE
