# 배치 05 — 기술/보안 QA 반영

리뷰가 지적한 2 BLOCKER · 8 HIGH · 5 MEDIUM 을 반영했다. 전부 **측정된** 잘못된 동작이고,
아래 테스트는 모두 수정 전 코드에서 실패한다. 새 테스트 23개, 총 261 PASS.

## BLOCKER — 하나의 뿌리, 두 개의 파서

패치 하나를 서로 다른 정규식 둘이 읽고 있었다.

| # | 자리 | 측정된 잘못된 동작 |
|---|------|--------------------|
| B1 | `change/blocks.js` `splitDiff` | `/^diff --git a\/(.+?) b\/(.+)$/` 가 git 의 C-quoted 헤더에 안 맞아서 `결제.js` 의 hunk 가 앞 파일에 붙었다. `ok.js` 와 `결제.js` 를 같이 고쳤을 때 결과: 파일 1개(`ok.js`), hunk 2개. |
| B2 | `work/supervisor.js` `changes()` | `/^diff --git a\/(\S+)/gm` — 첫 공백에서 잘리고, **before** 쪽 경로를 집고, 따옴표 경로는 통째로 빠졌다. 이게 유일하게 `확인됨` 이 허용된 주장을 먹인다. `결제.js` 를 고친 Work 가 "변경 1개 · ok.js ✓ 확인됨" 으로 떴다. |

**수정:** 변경 파일 목록을 패치 헤더가 아니라 git plumbing 에서 받는다 —
`evidence/git.js` 에 `changedPaths()` (`diff-tree -r -z --name-only`). `changes()` 와
`saveDiffs()` 가 같은 목록을 쓴다. `splitDiff(patch, names)` 는 헤더를 **경계**로만 읽는다.
이름 목록이 없을 때만 헤더로 되돌아가고, 그때도 따옴표를 풀고 좌우가 같은 길이라는 사실로
가른다 — `a b/c.js` 처럼 ` b/` 를 품은 경로 때문. (`evidence/git.js:176` 이 `ls-files` 에
`-z` 를 쓰는 이유와 같은 실패다. diff 쪽에만 그 대응이 없었다.)

## HIGH

| # | 수정 |
|---|------|
| H1 | `\ No newline at end of file` 을 줄로 셌다 → 이후 번호가 전부 1씩 밀렸다. 이제 건너뛴다. |
| H2 | 공백만 바뀐 곳이 블록을 만들었다. D-127 이 명시적으로 금지한다("공백 줄만 바뀐 곳은 블록을 만들지 않는다"). 줄은 카운터를 **전진시키되** 블록을 주장하지 않는다. |
| H3 | `bodyText` 가 부분 문자열 치환이라 이름이 `f` 이면 `function` 이 부서졌다 → 관계없는 한 글자 함수 둘이 같은 해시가 되어 없던 rename 을 주장했다. 이제 AST 의 **식별자 토큰** 으로 치환한다. 단어 경계 정규식은 대안이 못 된다 — `\b` 는 ASCII 전용이고 한글 식별자가 여기선 평범한 경우다. |
| H4 | 서로 배타적인 rename 주장 — H3 의 같은 뿌리. |
| H5 | getter · setter · constructor · `export const` 가 선언이 아니었다 → 모듈 수준 hunk 블록으로 떨어졌다. `19` §C5-B 의 목록대로 넣었다. 지역 `const` 는 여전히 아니다. |
| H6 | 256 KB 를 넘는 패치의 꼬리를 **파괴**했다. D-129 의 `unified_ref` 는 blob 참조 자리다. 이제 전문을 `<store>/diffs/<sha256>.patch` 로 쓰고 참조를 남긴다. store 가 없으면 `truncated` 라고 **인정**한다. |
| H7 | 잘린 head 에서 블록을 잘라놓고 아무 표시가 없었다 → 변경이 거기서 끝난 것처럼 보였다. `note: 'truncated'` + `ref`. |
| H8 | **취소 경로가 자기 결과를 지웠다.** `confirmCancel` 이 live state 로 결과를 쓰고 `release()` 한 뒤, 아이의 exit 이 `finishResult` 를 다시 불렀다 — entry 가 없으니 `entryFor` 가 빈 state 를 재구성하고, `saveResult` 는 delete-then-insert 라 좋은 결과가 사라졌다. `work.outcome` 은 여전히 `partial` 이므로 SC-03 이 **된 것도 안 된 것도 없는** 부분 완료 카드를 그렸다 — WBS-18 인수 조건이 금지하는 바로 그 모양. 이제 이미 있는 결과는 행에서 재구성한 것으로 대체되지 않는다(재시작 후 결과가 아직 없는 Work 는 그대로 받는다). |

## MEDIUM

| # | 수정 |
|---|------|
| M1 | 깊게 중첩된 **유효한** 파일이 `RangeError` 로 IPC 경계까지 새어 나가 파일 하나 때문에 변경 리더 전체가 죽었다. 파서와 walk 둘 다 재귀라 둘 다 감쌌다(측정: 괄호 20 000 중첩). |
| M2 | typescript 부재를 `parse-failed` 로 보고했다 — 설치 문제를 사용자 코드 결함으로 돌린다. `no-parser` 로 분리. 소스가 아예 없는 경우도 `no-source` 로 분리. |
| M3 | `resultFor` 가 `outcome` 을 안 돌려줘서 `verify()` 의 양쪽 목록 규칙이 저장된 결과에는 한 번도 안 돌았다 · `cancelled_partial` 이 `verify` 를 통째로 비껴갔다 · `result_item.confidence` 가 쓰기에서 버려졌다. 셋 다 수정. |
| M4 | `MAX_DISPLAY_BYTES` 가 UTF-16 code unit 을 셌다 → 1 MiB 한글 파일이 ~350 K 로 측정되어 S1 로 갔다. `Buffer.byteLength`. |
| M5 | 객체 속성의 화살표 함수가 모듈 수준으로 보고됐다. `PropertyAssignment` 를 선언으로. |

## 거짓 주석

코드가 갖지 않은 성질을 주장하던 주석을 고쳤다. 이번 배치에서 6개 — 다섯 배치 연속으로
나오는 패턴이다.

- `declarations()` 의 "innermost first" — walk 는 pre-order 라 **바깥이 먼저**다. 순서에
  기대는 것은 아무것도 없고, 담는 선언을 고르는 건 `innermost()` 다.
- `build()` 의 `@returns` 가 `claims:{text:string}` / `items:{text:string}` 이라고 했다.
  실제로는 `kind` + 구조화된 `data` 이고 한국어는 렌더러가 짓는다(CF-6).
- `changes()` 의 "store 경로는 live map 에서 읽지 않는다" — 코드는 `store ?? live.get(...)`
  로 **fallback 으로 읽는다**.
- `finishResult` 의 "live state 로 쓴 결과는 대체되지 않는다" — 가드가 실제로 보장하는 건
  "**이미 있는** 결과는 행에서 재구성한 것으로 대체되지 않는다" 다.
- 같은 함수의 "주장은 이미 확인 못함으로 내려갔다" — `problems` 에는 내려갈 수 없는
  목록 누락도 들어간다.
- `changedLines` 의 "바뀐 줄(추가되거나 변경 주변 문맥)" — context 는 반환하지 않는다.

## 뮤테이션

수정 19개에 뮤턴트 19개, **19 killed / 0 survived**.

첫 회차에 `m2-noparser` 가 살아남았다: typescript 가 설치돼 있으니 `no-parser` 가지는
테스트 중 한 번도 실행되지 않았다 — 리뷰가 다섯 배치 내내 지적한 "실패할 수 없는 테스트"
그 자체. `require('typescript')` 가 진짜로 throw 하는 자식 프로세스에서 돌리는 테스트를
추가하니 죽었다.

## 남은 것

- 리뷰의 LOW 3건은 아직 안 봤다.
- `renames()` 는 여전히 `-M` 없이 돈다. 파일 안 rename 만 잡는다는 D-127 의 한계 그대로.
