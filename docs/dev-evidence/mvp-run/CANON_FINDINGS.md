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
