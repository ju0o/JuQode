# BATCH 04 — the Work loop becomes real

| | |
|---|---|
| Branch | `dev/mvp-autonomous-v01` |
| Previous checkpoint | batch 03 QA corrections (`6d4a718`) |
| Packages | WBS-12 · WBS-13 · WBS-14 · WBS-15 · WBS-16 · WBS-17, and the UI halves of WBS-06 · WBS-07 · WBS-09 |

Three earlier batches deferred a card each — WBS-06's field, WBS-07's guard, WBS-09's
사용 불가 — for the same stated reason: a card whose actions lead nowhere is a dead end
dressed as an exit (`12` UF-CLAUDE-ALT). This is the batch that gives each of them somewhere
to lead, so all three land here with the triggers Canon specifies for them.

**WBS-17 makes six packages rather than the batch ceiling of five.** It is two functions on top
of WBS-08's existing `capture`/`diff`, and without it `15` SC-03's result card cannot say
`변경 n개` from measurement — it would have to claim it. Taking it here was the smaller lie.

## The order a Work starts in, and why each step can refuse

`12` and `15` SC-02 fix the sequence. Each step can stop the Work, and each stops it with a
different card, because they are different facts:

| | Refusal | Card |
|---|---|---|
| 1 | Claude Code is not usable | 사용 불가 — neutral grey, `지금 안 됨 · 실패 아님`, the reason |
| 2 | another Work is running | guard — amber, names the running Work, **text stays in the field** |
| 3 | no honest before-basis | 확립 불가 — the one red here; the Work does **not** start (D-121) |
| 4 | the session never spoke | 시작 실패 — a card, and **no `work` row at all** |

Only after all four does a row exist, because `20` says History is Works that started. The
signals are buffered until then and replayed once the row is written — a Work that never
started leaves no trace in History, which is the promise, and no lost evidence either.

## WBS-14 · the permission cycle, on screen

D-133 contract B, and only contract B. Contract A's copy (`work.permTitle`, `work.permGloss`,
`work.allow`, `work.deny`) is deliberately **absent from `copy.js`** — `18` marks it as not to
be used, and a string that is not in the file cannot be rendered by accident.

The tool is already denied when the card appears, so nothing on it calls the request 대기 중.
The card names the tool and its target verbatim, offers `허용하고 다시 해 보기` and `그만두기`,
and the grant is computed from the denial's own `tool_input` — one tool, one target. An action
with nothing to scope to gets **no grant at all**, and says so, rather than a wider one.

Allowing writes a `permission_granted` signal with `source = 'juqode'`. That is what makes
D-116 — JuQode never approves on the user's behalf — answerable by a query rather than by
reading a payload: a grant exists only because a person pressed the button.

## WBS-12 · Steps and the NEXT slot

Only what Claude Code actually declared (D-107). The NEXT slot is **always rendered**, and
empty is the correct answer when nothing declared a next step — filling it would be the
invention D-107 exists to stop. `15`'s No-Step state is the one every Work starts in.

## WBS-15 · liveness

The line states the last observed fact and the wall-clock time it was seen. Not a relative
"3분 전" that keeps moving on its own, not a spinner, not a percentage, and not a judgement
about whether the Work is progressing. The signal kinds are machine words, so each has a plain
Korean one; an event kind we have no word for still shows, as 그 밖의 신호, because hiding it
would be hiding an observation.

## WBS-16 · cancel

The request is recorded as a `user` signal and the status becomes `취소 요청됨` — a distinct
state from 취소됨, because `07` §8.1 measured that a cancelled child exits 0 and
`result.is_error` is equally blind to it. The stop is claimed only when it is observed.
Cancel is ink-outlined wherever it appears, never recovery-green and never red, and it carries
its fixed sub-line every time.

## WBS-17 · the after-basis

Captured when the turn ends, whatever the outcome — a cancelled or failed Work has changes
too. Re-captured after an allowed retry, because the retry is when the change actually lands.
With no after-basis the answer is `남은 변경을 다 확인하지 못했어요`, which is not
"nothing changed".

## D-124 · a Work whose process is gone

Startup reconciliation closes it as `ended_unknown`, resets any step that was `running` to
`not_executed`, and writes a `reconciled` signal. Without it a lost process pins D-117's single
slot forever. A test asserts the slot is free again afterwards.

## Review

Three reviewers ran against the batch. They returned **3 BLOCKERs, 24 HIGH**, and the worst
mutation score of the run. All of it is fixed; the notable parts:

### BLOCKER

**1 · WBS-13 and WBS-15 were in this batch's declared scope and were not built.**
The copy was transcribed, the reducer reached the states, and the screen rendered neither: an
input-waiting Work had no question, no field and no `답 보내기` — literally unanswerable — and
the two quiet states had no panel at all. Declaring a package in scope and shipping its engine
without its surface is the same error as an unreachable card, in the other direction.
*Fixed:* both states are built, plus WBS-16's 취소 확인 불가, and `answer()` resumes the SAME
session so an answer continues the Work rather than starting one.

**2 · Cancel could never end a Work, so D-117's slot stayed pinned until the app restarted.**
Nothing emitted `cancel_confirmed`, and a killed CLI emits no `result`, so a cancelled Work sat
in 취소 요청됨 forever — and the guard card's own escape was the same no-op. Every later submit
in that project got the guard.
*Fixed:* the stop is observed two ways — the process is already gone, or the child's exit is
seen — and either closes the Work. If neither happens it stays 취소 요청됨 and the screen says
확인할 수 없어요, which is the honest answer rather than a stuck one.

**3 · Cancelling an ENDED Work resurrected it and erased its outcome.**
Same root cause: `apply()` invented `initial()` — which says `running` — for any Work not in
the live map, so the reducer's own "an ended Work is ended" guard never saw the real state. A
completed Work lost its outcome and the project was soft-locked. The file header said the DB was
authoritative; this is what makes that true.

### HIGH

| | Finding | Fix |
|---|---|---|
| The result chip always read **확인됨** | a failed Work showed a red chip labelled 확인됨 — the exact decoupling of chip from meaning that D-114's vocabulary exists to prevent | the chip carries the outcome |
| Model prose rendered as the result **with no chip** | `18` §0.9: every claim carries one. Claude's own report is not fact-backed | chipped 예상됨; the 된 것/안 된 것 list is WBS-18's |
| `✓ 확인됨` on a non-Git project that could never be compared | `changes()` only ever compared git trees, so the manifest basis was a confirmation of nothing | the manifest path compares too |
| A seq collision threw inside a stdout handler | in the main process that is an uncaught exception and a dead window | one seq authority, and a boundary around the write |
| Two submits raced past preflight and spawned **two sessions in one repository** | the loser's process was untracked, unstoppable, and its writes were folded into the winner's after-basis | the slot is held from preflight, and a lost race stops its own child |
| A bogus `toolUseId` granted the **first** open refusal | the D-116 record then named a refusal the caller never asked about | an id that names nothing is refused |
| A stale after-basis reported 바뀐 파일이 없어요 | about a change the user had personally approved | re-captured after every retry turn |
| A Bash denial showed only "Bash" while granting the whole command | the scope was narrow; the card describing it was not | whatever the grant is built from is shown |
| Reconciliation closed Works whose process was alive | a detached child outlives its parent — measured — so the next launch freed the slot while the CLI was still writing | it asks, using a persisted `{pid, startedAt}`; and quitting stops what we started |
| Four dead-end buttons | disabled or handler-less controls where the destination is a later package | the fact is a sentence; `12` 원칙 4 asks for a next action, and a control that cannot act is not one |
| The allow button stayed live on an ended Work | pressing it edited files on a Work the screen had declared finished | rendered only while the Work is waiting |
| Seven comments asserting properties the code did not have | 3 · 2 · 8 · 7 across four batches | each rewritten to say what is true, and what is not covered |

Also fixed: the two quiet states could never appear because they are defined by the ABSENCE of
a signal and the screen was push-only — the one place a clock is legitimate; a grant with no id
resolved every outstanding refusal; concurrent allows ran two `--resume` sessions on one session
id; `live` was never cleaned; and every Work channel now refuses an id it was never given.

### What the suite could not see

Mutation testing scored **34/29**, and the structural findings mattered more than the score.
Re-run after the fixes: **24 of 24 killed**, eight of which needed a new test rather than a
code change — including the process-group rule (`07` §8.2), which no test could see because
killing the shell alone also makes the shell exit, so only a fixture with a HELPER in the same
group can tell the two apart.

One of those eight was a test I believed I had written: an edit anchor did not match and the
replacement failed silently, so two mutants survived a test that did not exist. Anchored edits
now get an explicit assertion.

The structural findings:

- **`main.js` had zero executed coverage.** No test ever `require`d it — the suite read it as
  text and regexed it, so every IPC mutation passed while the behaviour was gone: the intent
  validation, the store gate, the unknown-project rejection, and the sub-frame check could each
  be deleted with a green board. The handlers now live in `app/main/ipc.js` as plain functions
  over injected dependencies, and the tests **call** them.
- **Both Canon thresholds were untestable.** The tests built their clock offset out of the
  constant under test, so `QUIET_MS = 1e15` stayed green and `15`'s 2분 / 90초 were asserted by
  nothing. Pinned to the literals now.
- **The progress-fabrication check exempted the newest screen by construction** — a hand-written
  file list that did not include `sc03.js`, the one place a spinner or an ETA would ever appear.
  It enumerates the renderer tree now, as does the Korean-copy check.
- **`npm test` never ran the e2e**, so a green unit run proved nothing about SC-03 as a screen
  or about any IPC handler. `test` is now unit + e2e.
- **"Same Work, same session" was claimed by two test titles and asserted by neither** —
  `resume: false` and an empty grant both survived. The fake CLI records its argv, so what
  reached the process is what is asserted.
- **The D-117 guard test could not tell preflight from the DB index**: with the preflight guard
  removed a second session ran a full turn in the project while the row count stayed 1. The
  fixture is silent before its first event now, which is the window the index cannot cover.
- A trailing `// …` comment carried Korean past the copy check, because the stripper only
  removed comments at line start.
- The suite leaked a fixture directory per case and **filled a 7.5 GB tmpfs mid-run**, after
  which unrelated failures looked like product bugs. It cleans up after itself.

## Tests

`npm test` now runs **both**: 199 unit tests and the three e2e files. All passing, no orphan
processes. `npm run test:unit` remains for the fast loop.

`tests/loop.test.js` drives the whole loop through the supervisor with a scripted CLI, so every
branch is reachable and none of it depends on what a real model happens to do. The git
repository, the evidence store and the database are all real and all disposable.

The e2e drives it through the **real Electron app**: submit on SC-02 → route disclosure →
SC-03 with a refusal card → back to the workbench → a second submit refused as a guard with
the text still in the field. It asserts the refusal card never says 대기, that SC-03 renders
no red for a refusal, that the NEXT slot is present and empty, and that five signals reached
the store.
