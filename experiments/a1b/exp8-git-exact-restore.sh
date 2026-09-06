#!/usr/bin/env bash
# A1b 실험 3 — Qode 이전/이후의 '정확한' 사용자 상태 복원 (DISPOSABLE)
#
# PM 지적: A1a 의 실험은 복원 시 `git read-tree HEAD` 를 했다.
#          그것은 사용자의 스테이징(인덱스)을 파괴한다. 아래에서 그 지적을 확인하고 고친다.
#
# 핵심 아이디어: 스냅샷은 트리 '하나'가 아니라 '둘'이어야 한다.
#   INDEX_TREE = 사용자의 인덱스(스테이징) 그대로
#   WORK_TREE  = 워킹트리(미추적 포함) 그대로
set -u
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
GC="git -c user.name=t -c user.email=t@t"
R=/tmp/juqode-a1b-git; rm -rf $R; mkdir -p $R; cd $R
git init -q -b main .

# ── 초기 상태: 열 가지 경우를 전부 만든다 ────────────────────────────────
echo "clean"            > clean.txt
echo "dirty original"   > dirty.txt
echo "staged original"  > staged.txt
echo "partial original" > partial.txt
echo "to be deleted"    > deleted.txt
echo "old name"         > renamed_from.txt
echo "secret=REAL"      > .env
echo ".env"             > .gitignore
ln -s clean.txt          link.txt
mkdir -p nested && (cd nested && git init -q -b main . && echo inner > inner.txt && $GC add -A && $GC commit -q -m inner)
$GC add -A >/dev/null 2>&1; $GC commit -q -m base

echo "dirty MODIFIED"          > dirty.txt                       # 추적 중 · 미스테이징 수정
echo "staged MODIFIED"         > staged.txt && git add staged.txt # 스테이징됨
echo "partial STAGED"          > partial.txt && git add partial.txt
echo "partial WORKTREE"        > partial.txt                     # 부분 스테이징: 인덱스≠워킹트리
rm deleted.txt                                                    # 삭제됨(미스테이징)
git mv renamed_from.txt renamed_to.txt                            # 이름 변경(스테이징됨)
echo "untracked"               > untracked.txt                    # 미추적
echo "secret=REAL"             > .env                             # 무시 대상(비밀)

snapshot_status () { git status --porcelain=v2 --untracked-files=all --ignored=matching | sort; }
hashes () { for f in clean.txt dirty.txt staged.txt partial.txt renamed_to.txt untracked.txt .env; do
              [ -e "$f" ] && printf '%s %s\n' "$(sha256sum "$f" 2>/dev/null | cut -c1-12)" "$f"; done
            printf 'symlink->%s\n' "$(readlink link.txt 2>/dev/null || echo MISSING)"; }

B_HEAD=$(git rev-parse HEAD); B_STATUS=$(snapshot_status); B_HASH=$(hashes)
B_INDEX=$(git write-tree)          # 사용자의 인덱스를 '읽기만' 한다. 바꾸지 않는다
echo "── Qode 이전 ──"; echo "$B_STATUS" | sed 's/^/   /'
echo "   인덱스 트리 = $B_INDEX"

# ── JuQode 안전 스냅샷: 트리 둘 ──────────────────────────────────────────
IDX=$R/.git/jq-idx
export GIT_INDEX_FILE=$IDX; rm -f "$IDX"; git read-tree HEAD; git add -A
W_TREE=$(git write-tree); unset GIT_INDEX_FILE
SNAP=$($GC commit-tree $W_TREE -p $B_HEAD -m "juqode pre-qode worktree")
ISNAP=$($GC commit-tree $B_INDEX -p $B_HEAD -m "juqode pre-qode index")
git update-ref refs/juqode/safety/work  $SNAP
git update-ref refs/juqode/safety/index $ISNAP
echo "   스냅샷: work=$(echo $SNAP|cut -c1-8) index=$(echo $ISNAP|cut -c1-8)"
[ "$B_STATUS" = "$(snapshot_status)" ] && echo "   스냅샷이 사용자 상태를 건드렸는가: 아니오 ✔" || echo "   ✘ 상태가 변했다"

# ── Agent 가 일한다 ──────────────────────────────────────────────────────
echo "AGENT overwrote"  > dirty.txt
echo "agent new"        > agent_added.txt
mkdir -p src && echo deep > src/agent_deep.txt
rm -f untracked.txt
echo "secret=STOLEN"    > .env          # 무시된 비밀을 조용히 고친다
echo "-- Agent 변경 후: $(ls | tr '\n' ' ')"

# ══ 방법 A — A1a 가 했던 것 (PM 이 지적한 그 방법) ═══════════════════════
cp -a $R /tmp/juqode-a1b-git-A; ( cd /tmp/juqode-a1b-git-A
  git checkout -q $SNAP -- . ; git read-tree HEAD          # ← 사용자 인덱스를 HEAD 로 리셋
  echo; echo "══ 방법 A (A1a 방식) 결과 ══"
  A=$(git status --porcelain=v2 --untracked-files=all --ignored=matching | sort)
  [ "$A" = "$B_STATUS" ] && echo "   사용자 상태 동일: 예" || { echo "   사용자 상태 동일: ✘ 아니오 — 스테이징이 파괴되었다"; diff <(echo "$B_STATUS") <(echo "$A") | head -8 | sed 's/^/     /'; }
)

# ══ 방법 B — 인덱스를 건드리지 않는 복원 ═════════════════════════════════
echo; echo "══ 방법 B (인덱스 보존 복원) ══"
# ① 스냅샷 이후 새로 생긴 파일만 정확히 지운다
export GIT_INDEX_FILE=$R/.git/jq-idx2; rm -f "$GIT_INDEX_FILE"; git read-tree HEAD; git add -A
NOW=$(git write-tree); unset GIT_INDEX_FILE
ADDED=$(git diff --name-only --diff-filter=A $W_TREE $NOW)
echo "   스냅샷 이후 생긴 것: $(echo $ADDED | tr '\n' ' ')"
for f in $ADDED; do rm -f "$f"; done
# ② 워킹트리를 스냅샷으로 — 별도 인덱스로 checkout-index. 사용자 인덱스를 안 쓴다
export GIT_INDEX_FILE=$R/.git/jq-restore; rm -f "$GIT_INDEX_FILE"
git read-tree $W_TREE; git checkout-index -a -f; unset GIT_INDEX_FILE
# ③ 사용자 인덱스를 '원래 인덱스 트리'로 되돌린다 — HEAD 가 아니다
git read-tree $B_INDEX; git update-index --refresh >/dev/null 2>&1 || true
find . -type d -empty -not -path './.git/*' -not -path './nested/*' -delete 2>/dev/null || true

A_HEAD=$(git rev-parse HEAD); A_STATUS=$(snapshot_status); A_HASH=$(hashes)
p () { printf '   %-34s %s\n' "$1" "$2"; }
[ "$B_HEAD" = "$A_HEAD" ]       && p "HEAD 불변" "✔" || p "HEAD 불변" "✘"
[ "$B_STATUS" = "$A_STATUS" ]   && p "사용자 상태(스테이징 포함) 동일" "✔" || { p "사용자 상태 동일" "✘"; diff <(echo "$B_STATUS") <(echo "$A_STATUS") | head -10 | sed 's/^/     /'; }
[ "$B_HASH" = "$A_HASH" ]       && p "파일 내용 해시 동일" "✔" || { p "파일 내용 해시 동일" "✘"; diff <(echo "$B_HASH") <(echo "$A_HASH") | sed 's/^/     /'; }
[ -f untracked.txt ]            && p "미추적 파일 복원" "✔" || p "미추적 파일 복원" "✘"
[ ! -f agent_added.txt ]        && p "Agent 생성 파일 제거" "✔" || p "Agent 생성 파일 제거" "✘"
[ ! -f src/agent_deep.txt ]     && p "Agent 생성 하위 파일 제거" "✔" || p "Agent 생성 하위 파일 제거" "✘"
[ -d nested/.git ]              && p "중첩 저장소 보존" "✔" || p "중첩 저장소 보존" "✘"
[ -L link.txt ]                 && p "심링크 유지" "✔" || p "심링크 유지" "✘"
grep -q STOLEN .env 2>/dev/null && p "무시된 .env" "✘ 도둑맞은 채 남았다 — 스냅샷 밖이다" || p "무시된 .env" "복원됨"

echo; echo "══ 되돌리기의 되돌리기 ══"
git update-ref refs/juqode/discarded/r1 $NOW
export GIT_INDEX_FILE=$R/.git/jq-r; rm -f "$GIT_INDEX_FILE"; git read-tree $NOW; git checkout-index -a -f; unset GIT_INDEX_FILE
[ -f agent_added.txt ] && p "Agent 상태 재복원" "✔" || p "Agent 상태 재복원" "✘"
echo "   보관된 참조:"; git for-each-ref --format='     %(refname) %(objectname:short)' refs/juqode/
