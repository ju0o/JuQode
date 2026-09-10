# CANON FINDINGS FROM IMPLEMENTATION

Raised by the autonomous MVP run. **Nothing here has been adopted into Canon.**
Copy and screen-scope decisions belong to the PM; this file states what implementation hit,
with the evidence, so the decision can be made on facts.

## CF-1 · `18` has no key for five states the built screens actually reach — COPY GAP

| State | Reached by | What `15` says | What `18` has |
|---|---|---|---|
| chosen folder does not exist | WBS-02 | `폴더가 존재하지 않습니다` (SC-01 Failure State) | — |
| chosen target is a file, not a folder | WBS-02 | — | — |
| Claude Code is not installed | WBS-09 | names the reason `설치되지 않음` | — |
| Claude Code does not answer | WBS-09 | names the reason `응답 없음` | — |
| the local store cannot be opened | WBS-21 | not reached by any planning document | — |

`15`'s own header says `18` wins where they differ, and `18` §0.1 requires the `-요` ending.
`18` demonstrably applied that rewrite to the sibling reason in the same `15` cell —
`15` `읽기 권한이 없습니다` became `18` `sc01.failReason` = `읽기 권한이 없어요`. So transcribing
`15`'s un-rewritten wording is not a safe fallback: it reintroduces the voice `18` rejected.

Implementation state: these five live in `app/renderer/copy.js` under an explicit `gap:`
block, written in the `18` §0 voice, and a test fails if a string is put there that `18`
**does** carry. They are marked, not smuggled.

## CF-2 · `18` `work.empty` is scoped to SC-03 but is an SC-02 string — SCOPE QUESTION

`18` gives `work.empty` = `아직 요청한 작업이 없어요.` with 화면 = SC-03. SC-03 is one Work, so
it has no "no Work has been requested" state; SC-02's Work Stream does, and `15` SC-02
Default State asks for exactly that sentence (`아직 요청한 Work 가 없습니다.`). The `18` entry
reads like the `-요` rewrite of the `15` SC-02 line with the screen column left behind.
Implementation uses it on SC-02. Confirm or give SC-02 its own key.

## CF-3 · `15` SC-02 Unavailable State cannot be delivered before the paths it offers exist — SEQUENCING

`15` fixes four recovery buttons on the Claude-Code-unavailable card:
`▸ 프로젝트 설명 읽기` (WBS-04) · `▸ Quick Command 쓰기` (WBS-22) · `▸ 터미널로 직접 확인`
(WBS-25) · `▸ 해결한 뒤 다시 보내기` (needs a submission, WBS-06). Every one belongs to a
different package. `12` UF-CLAUDE-ALT says the card `막다른 길로 끝나지 않는다`, so a version
with four inert buttons is worse than no card — it is a dead end dressed as an exit.
`12` UF-CLAUDE-UNAVAILABLE also triggers on **시작 시도**, which does not exist until WBS-06.

The detection capability (WBS-09's substance) is built and tested. The card is deferred to
the batch that carries WBS-06 and at least one working recovery path. `21` may want to record
that WBS-09's card half depends on 06 / 22 / 25, which its `Deps` column (`01`) does not say.

## CF-4 · `claude auth status --json` answers the login question without starting a session — MEASURED

Measured against CLI 2.1.266: `claude auth status --json` exits 0 and prints
`{"loggedIn": …}` plus **account email, org id and org name**. This makes `15` SC-02's
`로그인 필요` reason detectable before any session starts, which `19` §C3 did not assume.

The same measurement is a standing hazard: the payload is account identity. Implementation
reads one boolean and discards the object — never persisted, never logged, never sent to the
renderer — and two tests enforce it. If Canon adopts this probe it should carry that
constraint with it.

## CF-5 · the local embedded DB (D-129) needs no native module — MEASURED

`node:sqlite` ships inside the Electron 44.3.0 Node 24.20.0 runtime: measured
`{"ok":true,"node":"24.20.0","electron":"44.3.0","sqlite":"3.53.4"}` in the Electron main
process, and the **packaged** Linux binary creates a 26-table store from the Canon schema on
first run. `19` §D1's native-module and ABI risk therefore does not apply to persistence.
Windows packaging remains DV-3 / DV-4 in `DEFERRED_VALIDATION.md`.

## CF-6 · A Brief answer is generated content, so `20`'s `text` column and `18`'s dictionary both need a word about it — DESIGN QUESTION

`20` gives `interpretation_answer.text` as the answer, with "null = 확인 못함 with no text",
which reads as prose. But the facts layer does not produce prose — it produces facts:
*this manifest, these folders, these scripts, this source file*. A sentence is composed from
them, and the composition has to happen where `18` lives, or the main process starts shipping
Korean and `18` stops being the single source of copy.

Implementation therefore stores the **structured payload as JSON** in that column and composes
the Korean in the renderer. Two consequences Canon should confirm or overrule:

1. `20`'s `text` column holds a payload, not a sentence, for facts-layer answers. The narrative
   layer (WBS-04) will produce actual prose from Claude Code, so the column will hold both
   shapes unless it is split.
2. The composed sentences (`이 폴더들이 있어요.`, `이 프로젝트가 스스로 적어 둔 실행 방법이에요.`
   and so on) are product copy that `18` does not carry, and cannot carry, because they wrap
   values. They live in `copy.js` under the `gap:` block, marked, and a test fails if a string
   is put there that `18` **does** carry.

## CF-7 · `19` §C1's facts layer grounds 폴더가 하는 일, but the deterministic pass cannot answer it — SCOPE

`19` §C1 ① lists `폴더가 하는 일` among the three questions the facts layer grounds. What the
scan can actually establish is that the folders **exist** and what they are **named**. What
`src/` is FOR is inference — exactly the kind of claim `확인됨` is supposed to exclude (D-114).

Implementation confirms only what it measured (the folder list, with `tree:1` as the source
ref) and says on the same card that the roles have not been read. The role sentence arrives
with WBS-04 and will be 예상됨 when it does. If Canon intended the facts layer to name roles
from a heuristic (`src` → 소스 코드, `tests` → 테스트), that heuristic needs to be written down
and its answers must be **예상됨**, not 확인됨.

## CF-8 · `18` has no key for the SC-03 states this run reached — COPY GAP

`15` SC-03 names the buttons and panels; `18` carries most of them but not all. Missing keys:
`그만두기` (the second button of D-133 contract B — `18` has the other three), the header's
elapsed/started field labels, the right rail's own labels (`이 작업에 대해` · `실행자` ·
`변경 기준`), the liveness line's plain words for each signal kind, and the result card's claim
bodies. They live in `copy.js` under the marked `gap:` block.

The signal-kind words are the clearest case: `18` §0.7 keeps developer terms out of user
sentences, and `tool_use` · `permission_denied` · `finish` are exactly that. Each has a plain
Korean word now, and an event kind with no word still shows — as 그 밖의 신호 — because hiding
an observation is worse than naming it roughly.

## CF-9 · a non-Git basis has nowhere to keep the list it must be compared against — SCHEMA GAP

`20` gives `evidence_basis` a single `ref`. For the Git mechanism that is enough: the ref IS a
tree object, and two refs can be diffed later by anything that can read the object store.

A `hash_manifest` basis has no such object. Its `ref` is a digest OF a file list, and the list
itself has nowhere to live — so a non-Git Work that outlives the process cannot report what it
changed. Implementation keeps the list in memory, which is honest about its own limit
(`known: false` after a restart) but is not a fix.

`19` §E also specifies the non-Git basis as "sha256 manifest **+ 텍스트 blob 저장소**(프로젝트
밖)", and the blob store is not built either — so on the non-Git path a change can be NAMED but
no Raw Diff or Code Block is derivable from it (D-127). Both need a decision: a column for the
manifest, and whether the MVP ships the blob store or states the non-Git limit on screen.

## CF-10 · `21` gives WBS-27 `Deps: 17`, but `20` makes a Code Block impossible without WBS-26

`code_block.change_group_id` is `not null references change_group(id)`. A change group is
WBS-26's, and WBS-26 depends on 17 **and 18**. So WBS-27 cannot persist a single row until
WBS-26 has run, which the dependency column does not say.

Implementation stores `raw_diff` (which WBS-17/27 can own outright) and derives the blocks on
demand from the stored patch — deterministic, and it costs nothing. When WBS-26 lands, the
blocks get their groups and can be persisted. `21`'s `Deps` for WBS-27 should say `17, 26`, or
`20` should let a block exist without a group.

## CF-11 · D-127's S1 path needs a runtime dependency `19` §D1 does not account for — DECISION TAKEN

`19` §C5-B decides the TypeScript compiler API for TS/JS segmentation. That is a ~20 MB runtime
dependency in a product whose packaging risk register (`19` §D1) assumes none.

Implementation adds `typescript` as a production dependency and reports which strategy is live
at boot (`segmenter: "semantic" | "hunks-only"`), because its absence is an honest degradation —
every file falls back to hunk blocks — but it IS a capability loss and should not be discovered
from a screen full of 단위로 나누지 못함. Measured: the packaged Linux binary resolves it from
inside the asar and reports `semantic`; the asar grew from 1.9 MB to 20 MB.

## CF-12 · WBS-22 의 검증된 산출물이 두 저장소 어디에도 없다 — 재현 불가

`19` §C4 는 Quick Command 규칙을 "검증됨 — 코퍼스 87/87 PASS" 로 못박고, 근거로
`../evidence/planning/q02-q03-quick-command-validation.md` 를 든다. 그런데 그 문서 §0 이
산출물의 위치를 이렇게 적는다:

> **산출물 (스크래치, 저장소 밖)** `scratchpad/final/q02/` — `rules.json` · `match.js` ·
> `corpus.json` (87 케이스) · `test.js`

**규칙표도 코퍼스도 매처도 두 저장소 어디에도 없다.** 문서는 알고리즘을 완전하게 적어 두었지만
동사 목록은 `… (+12)` 로 줄여 놓았고, 87 케이스 중 명시적으로 이름이 적힌 것은 마흔 개쯤이다.

구현은 **알고리즘을 그대로** 옮기고, 단어 목록은 문서가 적어 둔 케이스에서 역산했다.
`tests/qc.test.js` 의 코퍼스는 문서가 실제로 적어 둔 케이스만 담는다 — 87 을 채우려고 케이스를
지어내면 그건 Canon 의 코퍼스에 대해 아무것도 증명하지 않는다.

**결과: "87/87 PASS" 는 이 저장소에서 재현할 수 없다.** `rules.json` 과 `corpus.json` 이 Canon
증거로 들어와야 그 숫자가 검증 가능한 주장이 된다. 그 전까지 WBS-22 의 인식 계층은
IMPLEMENTED_PENDING_VALIDATION 이다.

## CF-13 · `change_group` 에 `source_ref` 자리가 없다 — D-114 를 지킬 수 없다

D-114 는 `확인됨` 이 근거를 대야 한다고 말하고, `20` 은 `interpretation_answer` 에 대해서는
CHECK 로 강제한다:

```sql
check (confidence <> 'confirmed' or source_ref is not null)
```

`change_group` 에는 `confidence` 는 있는데 `source_ref` 열이 없다. `19` §C5-X 는 change group 의
`확인됨` 을 "관측된 실행 결과" 에 묶으라고 요구하므로, 근거를 **저장할 곳이 없으면 그 요구를
지킬 수 없다** — 계산해 놓고 버리게 된다. 실제로 그렇게 되어 있었고, 저장소에서 다시 읽은
묶음은 아무것도 인용하지 않는 ✓확인됨 칩을 달고 있었다.

구현은 마이그레이션 2 로 `change_group.source_ref` 를 추가했다. SQLite 는 기존 테이블에 CHECK 를
ADD 할 수 없으므로 제약은 저장 계층에 있고(근거 없는 `확인됨` 은 `예상됨` 으로 내린다),
`tests/explain.test.js` 가 그것을 붙잡는다. `20` 이 이 열과 CHECK 를 정본으로 받아야 한다.

## CF-14 · D-126a 의 "복사한 인덱스" 가 변경을 놓친다 — 측정됨

D-126a 는 증거 기준의 메커니즘을 **복사한 `GIT_INDEX_FILE`** + JuQode 소유 오브젝트 디렉터리 +
`:(exclude,glob,icase)` pathspec + 복사본에 대한 `rm --cached` 로 정한다.

복사본은 사용자 인덱스의 **stat 캐시** 를 함께 물려받는다. `git add -A` 는 그 캐시를 믿는다 —
크기와 타임스탬프가 그대로면 파일을 다시 읽지 않는다. 그래서 **크기가 같은 편집이 기준과 같은
타임스탬프 구간에 떨어지면 보이지 않는다.** after 트리가 before 트리와 바이트 단위로 같아지고,
제품은 방금 고친 파일에 대해 `바뀐 파일이 없어요 ✓확인됨` 이라고 말한다.

**측정 (실제 supervisor 경로, 같은 크기 편집, Work 300회):**

| 인덱스 | 놓친 횟수 |
|---|---|
| 빈 인덱스에서 시작 | **0 / 300** |
| 복사한 인덱스 + mtime 을 epoch 로 (재읽기 강제 시도) | 4 / 300, 그리고 다른 픽스처에서는 **옛 내용**을 트리에 썼다 |

간헐적이라 더 나쁘다 — 테스트에서 무작위로 다른 자리가 깨지는 것으로 나타났고, 원인을
찾는 데 뮤테이션 런이 필요했다.

구현은 **빈 인덱스에서 시작한다.** 사용자의 `.git/index` 를 건드리지 않는다는 D-126a 의 목적은
그대로다(이 인덱스는 JuQode 저장소 안에 있다). 캐시가 없으면 틀릴 캐시도 없고, 내용이 판단한다.
비용은 캡처마다 트리 재해시이며 트리 크기는 이미 `refusal()` 이 제한한다.

부작용 두 가지를 숨기지 않고 적는다:
- **tracked 이면서 gitignore 된 파일**은 이제 기준에서 빠진다. 복사한 인덱스라면 남았다.
  기준이 워크트리를 서술하게 되는데, 그게 Work 가 실제로 바꾼 것이다.
- `rm --cached` 단계는 **지금은 잡을 것이 없다.** pathspec 이 유일하게 작동하는 방벽이 됐다.
  코드는 남겨 뒀다(인덱스가 다시 채워지는 순간 닫힌다). 테스트는 어느 단계가 돌았는지가 아니라
  **사후 조건**(JuQode 인덱스에 제외 경로가 하나도 없다)을 검사한다.

`20`/D-126a 가 메커니즘을 "복사한 인덱스" 로 고정한 문장을 고쳐야 한다.

## CF-16 · `18` `brief.stale` 에 예시 숫자가 박혀 있다 — 그리고 오래됨은 나이가 아니다

`18` 은 이 문장을 확정한다:

> `brief.stale` | 3일 전에 읽은 내용이에요. 그 뒤로 프로젝트가 바뀌었을 수 있어요.

`19` §C1 ⑤ 는 그 *형식*을 요구한다 — "`3일 전 내용` 식 사실 표기". 즉 숫자는 변수인데
사전에는 상수로 적혀 있다. 구현은 승인된 문장을 그대로 두고 **숫자 문자만** 치환한다
(`reader.evidenceGapPaths` 가 Canon 자신의 `{paths}` 를 치환하는 것과 같은 방식).
한국어를 새로 쓰지 않으므로 문구 출처 검사도 그대로 통과한다.

두 번째, 더 큰 것: **오래됨은 나이의 문제가 아니라 해시의 문제다.** `source_hash` 는 읽은 지
몇 분 만에도 움직일 수 있고, 그러면 이 문장은 `0일 전에 읽은 내용이에요` 가 된다 — 아무도
쓰지 않는 한국어다. 같은 날 바뀐 경우를 위한 문장이 `18` 에 없어서 gap 으로 표시해 두었다
(`briefStaleToday`: `읽은 뒤로 프로젝트가 바뀌었어요.`).

`18` 이 고쳐야 할 것: `brief.stale` 의 숫자를 자리표시자로 바꾸고, 같은 날 경우의 문장을 준다.

## CF-17 · 렌더러가 부르는 문구 키가 있는지 아무도 검사하지 않았다

문구 출처 검사(`unit.test.js`)는 렌더러에 **있는 한국어 문자열**이 전부 `18` 에서 왔는지 본다.
반대 방향은 보지 않는다 — 화면이 `copy.js` 에 **없는** 키를 부르면 `undefined` 가 그려지고,
버튼이면 아무도 누를 수 없는 빈 라벨이 된다. **문자열 검사는 없는 문자열을 볼 수 없다.**

이 런에서 같은 결함이 세 번 커밋됐다:

| 자리 | 증상 |
|---|---|
| `sc03.js` 원하던 결과가 아니에요 패널(WBS-19) | 패널 전체가 빈 글자 (배치 07 QA 에서 손으로 발견) |
| `sc04.js` 사용 불가 · 원문 복사 | 같은 모양 |
| `brief.js` `failTitle` · `failNote` | `프로젝트를 읽지 못했어요` 띠가 **제목 없이** |
| `sc03.js` `work.done` · `work.notDone` | 결과 카드의 `한 것`/`못 한 것` 머리글이 빈 채로 — **부분 완료 상태의 핵심인 두 목록 위에** |

마지막 둘은 새로 넣은 테스트가 찾았다. 이건 Canon 의 결함이 아니라 **검사의 빈틈**이라
여기 적어 두는 것이고, 검사는 배치 10 에서 들어갔다.

## CF-18 · `18` 에 Quick Command 여섯 규칙의 설명 문장이 없다

`19` §C4 는 실행 전에 카드가 **이해한 것 · 실행할 명령 · 하는 일**을 보이라고 요구하고, `18` 은
그 **라벨 셋**(`qc.understood` · `qc.action` · `qc.meaning`)만 준다. 여섯 규칙 각각의 **문장**은
`18` 에 없고, Canon 자신의 기획 증거
(`../evidence/planning/q02-q03-quick-command-validation.md` §1)의 표에 있다.

구현은 그 표에서 그대로 옮겨 `gap:` 에 두었다 — 승인된 문구인 척하지 않는다. `18` 이 받아야 할
것은 스무 문장이다: understood 6 · meaning 6 · 사용 불가 이유 6 · **고정 동작 둘의 실행할 명령
문장 2**(`qc.dev.stop` 의 SIGTERM→5초→SIGKILL 문장, `qc.terminal.open` 의 서랍 문장). 뒤의 둘이
없으면 그 두 카드는 **빈 줄을 확인하라고 요구한다** — 스크립트가 아니라 고정 동작이라 보여줄
명령 문자열이 없기 때문이다.

작은 것 하나 더: `15` TD-01 은 지원 동작 목록을 `실행 · 빌드/테스트 · 확인 · 터미널` 로 묶으라고
한다. 그런데 `실행` 은 `18` 에서 **실행 버튼**(`qc.run`)이다 — 같은 문자열이 두 가지를 뜻한다.
목록은 평평하게 낸다. 제목을 위해 Canon 문구를 복제하지 않는다.

## CF-19 · `18` 에 Agent Presence 아홉 모드의 라벨이 없다

`16` §9 는 Agent Presence 의 모든 모드에 **라벨이 항상 있어야 한다**(`label always present`)고
적고, `15` §42 와 `21` WBS-35 는 그 모드가 **아홉 개**라고 적는다. 그런데 `18` 이 주는
`presence.*` 키는 셋뿐이다 — `title` · `kicker` · `hint`. 아홉 모드 중 **어느 하나의 라벨도**
`18` 에 없다.

그 문구들이 없는 것은 아니다. Canon 자신의 시각 프로토타입
(`../JuQode-Private/docs/visual/visual-design.html` 의 `JQPresenceLabel`)에 아홉 개가 다 적혀
있고, `16` §9 가 그 파일의 `presence.js` MODES 표를 이름으로 인용한다. 구현은 거기서 그대로
옮겨 `gap.presenceLabel` 에 두었다 — 승인된 사전 항목인 척하지 않는다.

**그 아홉 중 둘은 `18` 이 이미 다른 키로 들고 있다.**

| 모드 | 문구 | `18` 의 키 |
|---|---|---|
| `cancelled` | 멈췄어요 | `qc.stopped` (TD-01 · Quick Command 가 멈춤) |
| `failure` | 끝내지 못했어요 | `work.resultTitle.failed` (SC-03 · 결과 카드 제목) |

그래서 이 둘은 `gap:` 에 **문자열을 다시 적지 않고** 그 키를 가리킨다
(`C.gap.presenceLabel.cancelled = C.qc.stopped`). 승인된 문구가 이 파일 안에 두 번 존재하면
한쪽만 고쳐지고 다른 쪽이 틀리게 된다. `tests/unit.test.js` 의 "모든 한국어 문자열은 `18` 그대로
이거나 표시된 gap" 검사가 이걸 실제로 잡아냈다 — 처음 구현은 아홉 개를 전부 `gap:` 에 적었고,
검사가 `멈췄어요` 를 `18` 항목이라고 거부했다.

`18` 이 받아야 할 것은 **일곱 문장**이다(나머지 둘은 이미 있다): idle · activity · input ·
permission · nosignal · unknown · complete.

작은 것 하나 더: `18` 에는 캔버스의 접근성 이름도 없다. 캔버스에는 텍스트가 없어서, 이름이
없으면 `16` §9 가 요구하는 "항상 있는 라벨" 이 스크린 리더에게는 **없는** 것이 된다.
`gap.presenceAria` 로 두었다.

## CF-20 · `16` §2.1 이 요구하는 대비를 `16` §2 의 값이 만족하지 못한다

`16` §2.1 의 테마 표는 mut / mut2 행에 요구 조건을 직접 적어 둔다:

> | mut / mut2 | `#5d6672` / `#8a93a0` | `#99a3b2` / `#79838f` | **보조 텍스트 대비 ≥ 4.5:1** |

같은 줄에 있는 값이 그 조건을 만족하지 못한다. `16` §2 자신의 표면 값(`--card #ffffff` ·
`--card2 #f7f8fa` · `--board #eef0f4` · `--grey #f1f1ee`)에 대고 잰 결과다:

| 토큰 | card | card2 | board | grey |
|---|---|---|---|---|
| light `--mut2` `#8a93a0` | **3.11** | **2.92** | **2.72** | **2.74** |
| dark `--mut2` `#79838f` | 4.54 | **4.15** | — | **3.94** |

밝은 테마의 2.72 : 1 은 WCAG 의 **큰 글자** 기준(3 : 1)에도 미치지 못한다. 그리고 `--mut2` 는
장식이 아니다 — Agent Presence 카드의 `모양은 지금 상태만 나타내요. 진행 정도를 뜻하지
않아요.`, 취소 버튼의 `취소하면 다음 실행을 멈춰요`, 기록 카드의 `끝난 작업은 사라지지
않아요` 가 그 등급으로 그려진다. `18` 이 승인한 문장들이고, 제품은 사용자가 그것을 읽기를
바란다.

amber 쌍도 두 표면에서 미달이다:

| 토큰 | board | grey | partbg |
|---|---|---|---|
| light `--part` · `--wait` `#b45309` | **4.40** | **4.44** | 4.69 |

### 구현의 판단

**요구 조건이 이긴다.** `16` §2.1 은 값을 적으면서 동시에 그 값이 만족해야 할 것을 적었고,
둘이 어긋날 때 의도는 뒤쪽이다 — 16진수는 초안이고 `≥ 4.5:1` 은 판정 기준이다. `21` WBS-36 의
Tests 열도 **토큰 대비비 단위 테스트**를 요구하는데, Canon 값을 그대로 두면 그 테스트는 처음
돌자마자 실패한다.

| | `16` | 구현 | card 대비 |
|---|---|---|---|
| light `--mut` | `#5d6672` | `#4c545f` | 5.82 → 7.66 |
| light `--mut2` | `#8a93a0` | `#646d7a` | 3.11 → 5.24 |
| light `--part` · `--wait` | `#b45309` | `#ad4f08` | 5.02 → 5.39 |
| dark `--mut2` | `#79838f` | `#8a94a1` | 4.54 → 5.68 |

`--mut` 도 함께 옮긴 이유: `--mut2` 만 올리면 `--mut` 쪽으로 밀려 두 등급이 하나가 된다.
**가독성 실패를 위계 실패로 바꾸는 것**뿐이라, 테스트가 둘 다 검사한다 — 모든 표면에서
4.5 : 1 이고 동시에 네 등급이 서로 떨어져 있고 순서대로다.

색상(hue)은 건드리지 않았다. amber 는 여전히 amber 이고(25° 부근), `--part` 와 `--wait` 는
여전히 **같은 값**이다 — `16` §2.1 의 채움 vs 외곽선 문법이 그것을 요구한다.

### `16` 이 받아야 할 것

§2 의 토큰 표와 §2.1 의 테마 표에서 네 값. 그리고 `--mut2` 가 실제로 어떤 표면 위에 놓이는지
— `16` 은 `--card` 만 암시하는데 SC-01 의 각주는 `--board` 위에 있다.

**`app/renderer/design/tokens.css` 의 머리말이 "TRANSCRIBED from the approved Canon, not
invented here" 라고 적혀 있었다.** 이제 네 값은 그렇지 않으므로 그 파일에 이 발견을 명시했다 —
파일이 자기에 대해 거짓말하게 두지 않는다.

## CF-21 · WBS-33 이 요구하는 "서명되지 않은 빌드" 표시에 화면이 없다

`21_WBS.md` WBS-33 의 위험 열과 `22_MASTER_TRACEABILITY.md` §95 는 같은 것을 요구한다:

> 서명 인증서가 없으면 **서명되지 않은 빌드임을 표시한다** — 숨기지 않는다는 제품 원칙의
> 배포 측면. (`19` §D1 · 원칙 2 · `13` §8 절대 규칙)

요구는 명확하다. **그런데 그 문장을 놓을 화면이 어디에도 지정되어 있지 않다.**

- `15_SCREEN_SPEC.md` SC-01 의 `Displayed Information` 은 한 문장(제품 소개)과 최근 프로젝트
  목록뿐이다. 빌드에 대한 사실은 없다. `Explicit Not Included` 도 그것을 배제하지 않는다 —
  **포함도 배제도 되어 있지 않다.**
- `14_SCREEN_ARCHITECTURE.md` 의 Top bar 는 프로젝트 범위다(프로젝트 이름 · 경로 ·
  다른 프로젝트 열기 · Brief · 터미널). 게다가 SC-02/03/04 에만 있다. 빌드 사실은 프로젝트가
  아니므로 여기 놓으면 층이 틀린다.
- `18_KOREAN_UX_COPY.md` 에 `서명` 이 들어간 키가 **하나도 없다**.

### 색도 정해져 있지 않다 — 그리고 문법상 쉬운 답이 없다

`16` §2.1 의 색 문법에서 이 상태에 쓸 수 있는 토큰을 하나씩 지워 보면:

| 토큰 | 뜻 | 쓸 수 있나 |
|---|---|---|
| `--fail` 빨강 | **화면에서 유일한 빨강**, 실패 전용 | **아니오.** 서명되지 않은 빌드는 실패가 아니다 |
| `--part` 앰버 채움 | 부분 완료 | 아니오. 완료의 정도가 아니다 |
| `--wait` 앰버 외곽선 | 대기 | 아니오. 무언가를 기다리는 상태가 아니다 |
| `--rec` 초록 ▸ | 복구 행동 | 아니오. 사용자가 할 행동이 없다 |
| `--unk` 파선 | 확인 못함 | **서명 여부를 판정하지 못했을 때만** |
| `--juq` 청록 | JuQode 자신의 목소리 | **예 — 판정했을 때** |

즉 이 표시는 **한 가지가 아니라 두 가지 상태**다. 판정된 사실(서명 안 됨)과 판정하지 못한
경우(확인 못함)는 D-114 어휘에서 다른 것이고, `16` 의 문법에서도 다른 색이다. 어느 쪽도
빨강이 아니다 — 빨강을 쓰면 그 자체가 `16` §2.1 위반이다.

### 이 런의 처리

Canon 을 고치지 않는다. 요구는 두 문서가 분명히 하고 있으므로 **구현하고**, 화면 배치와
문구는 다음과 같이 정하고 그 근거를 여기에 남긴다.

- **호스트: SC-01.** 설치 직후 사용자가 처음 보는 화면이고, 프로젝트 문맥이 없는 유일한
  화면이다. 서명 경고(SmartScreen)를 막 지나온 직후가 이 사실이 의미를 갖는 시점이다.
  Top bar 는 프로젝트 층이라 맞지 않는다.
- **표시 조건: 패키징된 빌드일 때만.** 개발 실행에는 서명될 "빌드" 자체가 없다. 이것은
  숨기는 것이 아니라 해당 사실이 성립하지 않는 것이다.
- **문구: `gap.` 으로 표시한다.** `18` 에 키가 없으므로 승인된 사전 항목인 척하지 않는다.

`18` 이 받아야 할 것: 서명되지 않은 빌드 문장 하나와, 판정하지 못했을 때의 문장 하나.
`15` 가 받아야 할 것: SC-01 `Displayed Information` 에 빌드 고지 한 줄.
