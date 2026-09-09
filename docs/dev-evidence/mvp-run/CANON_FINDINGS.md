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
