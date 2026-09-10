# AUTONOMOUS MVP RUN — CHECKPOINT LOG

Branch: `dev/mvp-autonomous-v01`, cut from PR #3 head `d03a21f`.
Working Canon: JuQode-Private `canon/wbs00-implementation-findings` (PR #13, `956a8c3`) —
a TYPE-1 technical correction of `270ee4e` main. Verified as such before adoption:
6 files, docs only, no product-scope change.

A checkpoint records that a batch is done. It is not a stopping point.

| # | Batch | Packages | State | Commit |
|---|---|---|---|---|
| 01 | WBS-21 · WBS-02 · WBS-09 | persistence (local SQLite, Canon schema) · project open · Claude Code detection | 21 IMPLEMENTED_PENDING_VALIDATION · 02 IMPLEMENTED_PENDING_VALIDATION · 09 PARTIAL (card deferred with its trigger) | see below |

## Batch 01

Report: `BATCH-01.md`. Canon proposals raised: `CANON_FINDINGS.md` (CF-1 … CF-5).
Deferred target-OS items added: DV-9 (Windows CLI resolution), DV-10 (NTFS case canonicalisation).

45 unit tests, 3 e2e files, all passing from a clean checkout with no orphan processes.
Three independent reviewers returned 3 BLOCKER + 9 HIGH; all fixed and re-tested.
Mutation testing: 9 of 21 mutants survived the first suite; after the fixes, 12 of 12 killed.

Next eligible set, read from `21` §1 `Deps`: WBS-03 (deps 02) · WBS-06 (deps 02) ·
WBS-07 (deps 21) · WBS-25 (deps 00, 01) · WBS-20 (deps 21, 05 — blocked on 05).

## Batch 02

Report: `BATCH-02.md`. Canon proposals added: CF-6, CF-7. Measured findings filed to the
Private repo as `07` §9 (branch `canon/mvp-run-implementation-findings`, `393472e`).

| Package | State |
|---|---|
| WBS-03 interpretation facts layer | IMPLEMENTED_PENDING_VALIDATION — the SC-02 Brief is real |
| WBS-06 intent routing | ENGINE IMPLEMENTED · UI deferred to the batch where a Work can start |
| WBS-07 single active Work guard | ENGINE IMPLEMENTED · card deferred with the same trigger |

124 unit tests, 3 e2e files, all passing from a clean checkout with no orphan processes.
Three reviewers returned 2 BLOCKER + 12 HIGH; all fixed and re-tested. Mutation testing found
21 killed / 25 survived — including **every** secret-exclusion mutant, because the test guarding
that property could not fail. After the fixes, 21 of 21 killed.

Next eligible: WBS-08 (deps 00, 21) · WBS-10 (deps 09, 21) · WBS-25 (deps 00, 01) ·
WBS-04 (deps 03, 10) · WBS-05 (deps 03, 04, 21). The Work chain — 08 · 10 · 11 — is next,
and it is what lets WBS-06's field, WBS-07's card and WBS-09's 사용 불가 card land with the
triggers Canon specifies for them.

## Batch 03

Report: `BATCH-03.md`. The Work chain's engines: evidence basis, session launch, reducer.

| Package | State |
|---|---|
| WBS-08 evidence basis | IMPLEMENTED_PENDING_VALIDATION — corrected D-126a contract in production |
| WBS-10 session launch | IMPLEMENTED_PENDING_VALIDATION — validated against the real CLI 2.1.266 |
| WBS-11 stream → state | IMPLEMENTED — pure, driven by a real recorded stream |

146 unit tests, 3 e2e files, all passing, no orphan processes.

Two corrections came out of building it. The excluded-path ledger had been recording
`"undefined"` for every mtime — `fs.statSync` has no `mtimeNs` without `{ bigint: true }` — so
it could only detect a size change, and **the WBS-00 spike that validated the contract carried
the same defect**. And D-133's resume mechanics have changed since the CLI version that
validated them: `--allowedTools` is variadic and was swallowing the prompt, and `--resume`
alone no longer reconstructs the blocked call. The safety property — that the grant bounds what
the retry may touch — was re-measured and holds.

Next: SC-03 and the surfaces these engines feed. Every deferred card now has a working engine
underneath it.

## Batch 04

Report: `BATCH-04.md`. The Work loop becomes real: SC-03, the Intent field, and every card a
submit can produce.

| Package | State |
|---|---|
| WBS-12 Steps · NEXT | IMPLEMENTED |
| WBS-13 input request · answer | IMPLEMENTED — the panel is built; no headless CLI event maps to `input_request` today, so the state is reachable from the signal and not yet from the CLI |
| WBS-14 permission pass-through | IMPLEMENTED — D-133 contract B, end to end through the real app |
| WBS-15 liveness · no-signal · unknown | IMPLEMENTED |
| WBS-16 cancel · cancel-unconfirmed | IMPLEMENTED |
| WBS-17 after-snapshot · diff capture | IMPLEMENTED |
| WBS-06 · WBS-07 · WBS-09 UI halves | LANDED — each now has a destination |

`npm test` runs unit **and** e2e: 199 tests plus three e2e files. The packaged Linux binary
ships the new modules and boots.

Three reviewers returned 3 BLOCKER + 24 HIGH. Two BLOCKERs shared one root cause — `apply()`
invented a `running` state for any Work not in the live map, so cancel could never end a Work
(D-117's slot pinned until restart) and cancelling an ended Work erased its outcome.

The structural test findings mattered more than the mutation score: `main.js` had **zero**
executed coverage, both Canon thresholds were untestable because the test built its offset from
the constant under test, the progress check exempted the newest screen by construction, and
`npm test` never ran the e2e at all.

Next eligible, from `21` §1 `Deps`: WBS-04 (03, 10) · WBS-18 (11, 17) · WBS-19 (06, 07, 08) ·
WBS-22 (06) · WBS-25 (00, 01) · WBS-26 (17, 18) · WBS-27 (17) · WBS-29 (11) · WBS-34 (21, 11).

## Batch 05

Report: `BATCH-05.md`. Canon findings raised: CF-8 · CF-9 · CF-10 · CF-11.

| Package | State |
|---|---|
| WBS-18 Work finish & result | IMPLEMENTED |
| WBS-27 Code Blocks | IMPLEMENTED — blocks derived on demand until WBS-26 gives them a group |

230 unit tests and three e2e files. `typescript` is now a production dependency (D-127's S1
path); the packaged binary resolves it from inside the asar and reports `segmenter: "semantic"`.

Next eligible: WBS-26 (17, 18) · WBS-28 (26, 27) · WBS-19 (06, 07, 08) · WBS-22 (06) ·
WBS-25 (00, 01) · WBS-29 (11) · WBS-04 (03, 10) · WBS-05 (03, 04, 21) · WBS-20 (21, 05).
The change reader — WBS-26 then WBS-28 (SC-04) — is the next surface.

## Batch 05 QA

Report: `BATCH-05-QA.md`. 2 BLOCKER · 8 HIGH · 5 MEDIUM · 6 false comments, all fixed.

Both BLOCKERs were one root cause — two regexes parsing one patch, neither able to read git's
C-quoted paths. The 확인됨 claim named the wrong file for a Work that edited `결제.js`. The
changed-file list now comes from `diff-tree -r -z --name-only`, and `changes()` and `saveDiffs()`
share it. 19 mutants, 19 killed.

## Batch 06

Report: `BATCH-06.md`.

| Package | State |
|---|---|
| WBS-26 Change Groups | IMPLEMENTED |
| WBS-28 SC-04 Change Reader | IMPLEMENTED |

285 unit tests, three e2e files, SC-04 screenshots in both themes.

Adding SC-04 to the e2e required a fixture that really edits files, which required a real git
repo — and that immediately exposed a defect no unit test could see: `git add` exits 1 whenever
the pathspec carries any `:(exclude)` element and the project gitignores a file, so JuQode could
not take a basis for most REAL projects. Fixed by checking the artifact rather than the status.

Next eligible: WBS-19 (06, 07, 08) · WBS-22 (06) · WBS-25 (00, 01) · WBS-29 (11) · WBS-04 (03, 10) ·
WBS-05 (03, 04, 21) · WBS-20 (21, 05) · WBS-34 (21, 11).

## Batch 06 QA

Report: `BATCH-06-QA.md`. Three independent audits — product, technical/security, test adversary.
Two of them found the same BLOCKER: the explanation pass documented as "no tools at all" ran with
the CLI's entire default tool set, because `allowedTools: []` adds no argument. `--tools ""` is
the flag that empties the built-in set, measured on a disposable scratch directory.

The adversary's headline: 20 of 29 mutants survived, including `pre.innerHTML = f.patch` (passed
unit AND e2e) and `renderSC04` returning nothing at all. Its incidental finding was the biggest
one — the suite leaked temp directories until the tmpfs quota broke it, producing a 50% flake
that made every previous "N tests pass" claim unreliable. Chasing that flake turned up CF-14.

Also landed here: **WBS-22 Quick Command rules & availability** — `app/main/qc/rules.js` and
`app/main/qc/availability.js`, the deterministic half of the package. The UI card and the
executor belong to TD-01 (WBS-25) and are not built. Canon's validated corpus is not in either
repository (CF-12), so the recognition layer is IMPLEMENTED_PENDING_VALIDATION.

334 tests, three e2e files, flake 0/10.

Next eligible: WBS-25 (00, 01 — TD-01, and WBS-22's card depends on it) · WBS-19 (06, 07, 08) ·
WBS-20 (21, 05) · WBS-34 (21, 11) · WBS-04 (03, 10) · WBS-05 (03, 04, 21) · WBS-29 (11).
Unfinished inside SC-04: per-block Raw selection, 원문 복사, the evidence-gap card.

## Batch 07

Report: `BATCH-07.md`.

| Package | State |
|---|---|
| WBS-20 History & re-entry orientation | IMPLEMENTED |

SC-02's History had only an empty state, so Canon's `변경 보기` entry into SC-04 did not exist.
It now lists every Work newest-first with a measured `변경 n개` (or nothing, when the evidence
pair could not tell), and both destinations `15` names are reached by the e2e for a Work that is
no longer on screen.

Visual QA found the History card drawing on top of the Brief the moment History had rows — a
591 px card in a 449 px auto row, with `grid-auto-flow: dense` packing another card into the
space it was already painting. SC-02 is now two column stacks, which cannot overlap. The existing
overlap check ran while SC-03 was on screen, so its `.sc02 .card` half matched nothing and could
never have caught it.

341 tests, three e2e files.

Next eligible: WBS-25 (00, 01 — TD-01, which WBS-22's card needs) · WBS-19 (06, 07, 08) ·
WBS-34 (21, 11) · WBS-04 (03, 10) · WBS-05 (03, 04, 21) · WBS-29 (11).

## Batch 07 QA — WBS-19 문구 누락

`sc03.js` 의 `원하던 결과가 아니에요` 패널(WBS-19)과 `sc04.js` 의 사용 불가 · 원문 복사가
**`copy.js` 에 없는 키를 참조한 채 커밋돼 있었다.** 화면이 그 자리에 닿는 순간 `undefined` 를
그린다. 유닛 스위트가 이것을 못 잡는 이유는 렌더러 문구 검사가 *존재하는* 문자열의 출처만
확인하고, *참조되는데 없는* 키는 보지 않기 때문이다.

WBS-19 은 이로써 IMPLEMENTED — 되돌리기 버튼은 없고(D-115), 본문이 그 사실을 먼저 말하고,
프리필된 문장은 사용자 본인의 말을 인용하며 **제출하지 않는다**(제출은 `12` 에서 파일 변경에
대한 동의다).

| Package | State |
|---|---|
| WBS-19 Unwanted result → correction Work | IMPLEMENTED |

341 tests · e2e 3종. 뮤턴트 13/13 killed(배치 06 QA 수정분 재검증).

Next eligible: WBS-25 (00, 01 — TD-01, which WBS-22's card needs) · WBS-34 (21, 11) ·
WBS-04 (03, 10) · WBS-05 (03, 04, 21) · WBS-29 (11).

## Batch 08

Report: `BATCH-08.md`.

| Package | State |
|---|---|
| WBS-19 Unwanted result → correction Work | IMPLEMENTED |
| WBS-34 Startup reconciliation | IMPLEMENTED (no QC rows to reconcile — WBS-22 has no executor) |

D-115's "no undo button" is stated by the panel before it offers the only thing that exists, and
the correction is prefilled but NOT sent — sending is the user's act, because `12` treats it as
consent to change files. WBS-34 gained the half it was missing: an interpretation the app died
inside becomes 실패, keeping whatever answers it had and inventing none.

`orient.unknown` reads the LATEST Work, not any Work ever — `some()` would have made one
reconciled Work say 확인할 수 없어요 for the rest of the project's life. That in turn requires
History's order to be deterministic, so `worksFor` breaks millisecond ties on `rowid`.

352 tests, three e2e files. 8 mutants, 8 killed.

Next eligible: WBS-25 (TD-01 terminal drawer — WBS-22's card and `qc.terminal.open` need it) ·
WBS-04 (03, 10) · WBS-05 (03, 04, 21) · WBS-29 (11).

### 동시 작업 — 이 브랜치에 두 세션이 붙어 있었다

배치 07~08 구간에서 `dev/mvp-autonomous-v01` 에 **두 개의 에이전트 세션이 동시에** 커밋했다.
`1ad31c4` · `92f5149` · `f24bfac` 는 다른 세션의 것이고, `2e5bceb` · `38da688` 는 이쪽이다.

관측된 결과:

- **같은 패키지를 두 번 구현했다.** 둘 다 WBS-34 를 했다. 최종 트리에는 구현이 하나만 남았고
  중복 정의도 중복 테스트 이름도 없다(확인함). 낭비지 손상은 아니다.
- **`git add -A` 로 남의 작업을 내 커밋에 쓸어 담았다.** `38da688` 에 들어간
  `app/main/interpret/narrate.js` (181줄, WBS-04) 는 이쪽 세션이 쓴 것이 아니다. 되돌리지
  않았다 — 커밋된 상태가 작업 중인 파일을 지우는 것보다 안전하다.
- **남의 증거 문서를 덮어썼다.** `BATCH-08.md` 가 그것이다. `f24bfac` 에서 복원해 두 절을
  합쳤다.
- 이쪽이 계속 겪은 "파일이 내가 읽은 것과 다르다" 는 현상의 정체가 이것이었다 —
  `git.js` 의 인덱스 블록, `sc04.js` 의 `when`/`OUTCOME`, `ipc.js` 의 `orientationOf`,
  `repo.js` 의 `rowid` 동률 처리. 전부 다른 세션의 편집이었다.

**한 브랜치에 두 자율 세션을 붙이면 안 된다.** 붙일 거라면 `git add -A` 대신 경로를 지정해
커밋하고, 매 커밋 전에 `git log` 로 새 커밋이 들어왔는지 확인해야 한다. 이 런의 남은 구간은
그렇게 한다.

## Batch 09

Report: `BATCH-09.md`.

| Package | State |
|---|---|
| WBS-04 Project interpretation — narrative layer | IMPLEMENTED |

`19` §C1's second layer. Same shape as WBS-26 and for the same reason: a pure `merge()` holds
every rule, so the rules are testable without a CLI or a model. A narrative answer can never be
확인됨 — only the facts layer's own output can be, and for these three questions it measured
nothing. A citation the scan really read makes it 예상됨; anything else is 확인 못함 with the
sentence still shown.

Visual QA caught the Brief contradicting itself: 하는 일 shown with an answer while 확인 못한 것
still listed it as unanswered. The narrative layer now re-states that row.

379 tests, three e2e files, 18/18 mutants killed.

Next eligible: WBS-05 (03, 04, 21 — now open) · WBS-25 (00, 01 — TD-01, which WBS-22's card
needs) · WBS-29 (11).

## Batch 10

Report: `BATCH-10.md`. Canon findings raised: CF-16 · CF-17.

| Package | State |
|---|---|
| WBS-05 Project brief · fold · stale · refresh | IMPLEMENTED |

Both acceptance rows are about what the product must NOT do on its own: `juqode:brief` is
read-only (it re-runs the deterministic scan, compares `source_hash`, asks no model and writes
nothing), and a refresh that cannot read the folder keeps the interpretation the user can still
read instead of replacing it with a card saying nothing was read.

A new test — "every copy key the renderer NAMES actually exists" — immediately found two more
places where the product drew blank text: the Brief's failure band had no title, and the result
card's 한 것 / 못 한 것 headings were empty over the two lists that ARE the 부분 state. The
existing copy test checks the provenance of strings that exist; it cannot see a missing one.

389 tests, three e2e files, 8/8 mutants killed.

Next eligible: WBS-25 (00, 01 — TD-01, which WBS-22's card needs) · WBS-29 (11).

## Batch 11

Report: `BATCH-11.md`.

| Package | State |
|---|---|
| WBS-29 Error model & state color grammar | IMPLEMENTED |

`21` asks for "visual regression against the VD frames". Pixel-comparing rendered app output to
design artefacts fails on legitimate differences, so the six state chips are rendered and their
computed styles MEASURED instead — in both themes, against the properties `16` §2.1 names.

It found 실패 and 사용 불가 separated by hue alone: neither carried a mark, and their light-theme
backgrounds measured luminance 244 and 241. That is the one pair `12` §16 turns into a product
promise (사용 불가 ≠ 실패), and only the words were keeping them apart. Both now carry a mark.

389 tests, three e2e files, 5/5 mutants killed.

Next eligible: WBS-25 (00, 01 — TD-01, which WBS-22's card needs).

## Batch 12

Report: `BATCH-12.md`. Canon findings raised: CF-18. Deferred: DV-11.

| Package | State |
|---|---|
| WBS-22 Quick Command rules & explanation | IMPLEMENTED |
| WBS-25 Terminal drawer | PARTIAL — the drawer and Quick Command are in; the SHELL LINE is not |

`19` §C6 marks the pty unvalidated, and this repository's own capability-containment test bans
`node-pty` outright. But REC-010 says long-running Quick Commands run in their OWN child
processes rather than the drawer pty — so everything except the user-typed shell line ships
without one. That line, and the decision behind it, is DV-11.

"No shell" now holds all the way to the spawn: `availability()` yields an argv, `spawn` is
called with a program and arguments, and the test passes `&& touch CANARY` and `$(id)` as
arguments and measures that neither happens.

414 tests, three e2e files, 20/20 mutants killed.

Next eligible: an independent QA pass over batches 07–12 · the SC-04 evidence-gap and
per-block work listed in BATCH-06 · DV-11's decision.

## Batch 12 QA + WBS-23 · WBS-24 · WBS-30 · WBS-31

Reports: `BATCH-12-QA.md`. Canon findings raised: CF-18. Deferred: DV-11.

| Package | State |
|---|---|
| WBS-23 Quick Command execution & result | IMPLEMENTED |
| WBS-24 Long-running Quick Command | IMPLEMENTED |
| WBS-30 Security boundaries | IMPLEMENTED |
| WBS-31 Testing harness | IMPLEMENTED |

Two independent QA passes (product, technical/security) ran over batches 10–12.

**The central safety claim was attacked and held.** The security review traced `phrase` end to
end (three destinations, none of them the spawn), COUNTED the reachable argv space (13), and
threw zero-width characters, RTL marks, homoglyphs, NFC/NFD variants, negations and multi-clause
sentences at the matcher. Nothing with dangerous content reached residue zero. It also verified
that no state, reason key or error path can produce a drawer panel without the `19` §S banner.

What it found instead: a card confirmed in one project could RUN in another (the drawer lives
outside `#root`, so navigation did not clear it, and `실행` reads the project at click time);
output truncation deleted the MIDDLE of a log and spliced the ends; the mask deleted the file
and line from build errors; a dev server outlived the app while `reconcileQcRuns` was written,
tested and called nowhere; and two of the six rules dead-ended because their action is FIXED
rather than a script — the product explained `터미널 열어줘` and then said it was not one of its
commands.

The product review found the D-134 card still saying the terminal did not exist, and that the
batch-11 grammar measurement examined synthetic chips rather than the surfaces the app renders —
the 오래됨 band was plain card furniture while every chip assertion passed.

444 tests, three e2e files. A Quick Command is now actually EXECUTED in the e2e, so the run-card
states have rendered evidence for the first time.

Next eligible: WBS-35 (Agent Presence) · WBS-36/37/38 (theme, screen differentiation, 다음 행동)
· DV-11's pty decision · WBS-32/33 (need humans and Windows).

## Batch 13 · WBS-35

Report: `BATCH-13.md`. Canon findings raised: CF-19 (and the duplicated CF-18 entry removed).

| Package | State |
|---|---|
| WBS-35 Agent Presence component | IMPLEMENTED |

469 tests, three e2e files. The Presence card is on SC-02 and SC-03 and appears in the
light/dark screenshots for both.

The acceptance's hard half — **no mode reachable by a timer alone** — is held structurally:
there is no timer in the component at all, `setMode` is the only writer of the mode, and the two
quiet modes arrive already decided from `livenessOf()`, which `17` exempts by name. The
precedence (waiting-on-the-user before liveness) exists for the same reason: a Work waiting for
a permission is supposed to be silent, so letting `quiet` win would move the mode on elapsed
time and nothing else.

Two things were found by measurement rather than by reading. The prototype's point count painted
the sphere SOLID at 56 px, hiding both rings — which made `input` and `permission` the same
still frame, the exact thing the second ring exists to prevent; the cloud was thinned and the
screenshots re-checked. And a mutation showed SC-02 could map a HISTORY ROW straight to a mode,
announcing 최근 활동이 보여요 for a Work that was stopped waiting for the user; `activity` now
requires a positive liveness verdict, and the e2e measures SC-02's mode while a Work is actually
`permission_waiting`.

Next eligible: WBS-36 (light/dark theme completeness) · WBS-37 (screen differentiation ·
transitions) · WBS-38 (다음 행동 ≠ NEXT) · DV-11's pty decision · WBS-32/33 (need humans and
Windows).

## Batch 14 · WBS-36 · WBS-38

Report: `BATCH-14.md`. No new Canon findings.

| Package | State |
|---|---|
| WBS-36 Light / Dark theme | IMPLEMENTED |
| WBS-38 다음 행동 강조 (≠ NEXT) | IMPLEMENTED |

485 tests, three e2e files.

WBS-36's named unit test — 토큰 대비비 — did not exist, and writing it found that the LIGHT
theme was failing WCAG AA: `--mut2` was 3.11:1 on a card and 2.72:1 on the board, for a rank
that carries real sentences (the presence card's 진행 정도를 뜻하지 않아요 among them). The
amber pair was 4.40:1 on the board, and dark's `--mut2` failed on two surfaces. Fixing `--mut2`
squeezed it toward `--mut`, so `--mut` moved too — the test asserts AA AND four separated ranks
so neither can be paid for the other.

WBS-38's copy keys (`next.label`, `next.gloss`) were in `18` and used by nothing: JuQode's
choices were unlabelled button rows a user had no way to tell from something the agent had
announced. They now go through one block that carries JuQode's teal against the NEXT slot's
Claude purple, is buttons against the slot's text, and says the difference in words. The e2e
measures both blocks' computed styles in both themes, and measures `17`'s second table row —
an empty NEXT with the offer still standing.

Next eligible: WBS-37 (screen differentiation · transition motion) · DV-11's pty decision ·
WBS-32/33 (need humans and Windows).

## Batch 15 · WBS-37

Report: `BATCH-15.md`. No new Canon findings.

| Package | State |
|---|---|
| WBS-37 화면 구성 차별화 · 전환 모션 | IMPLEMENTED |

493 tests, three e2e files. **All 39 MVP WBS packages are now IMPLEMENTED except WBS-32
(dogfood with real people) and WBS-33 (packaging · signing), which need humans and Windows,
and WBS-25's shell command line, which is DV-11.**

The five surfaces' compositions are now measured as geometry — card count, distinct card
SIZES (SC-02 is two equal columns on purpose, so width says nothing), the widest card's share,
density, and which card is the biggest. Each surface is checked against its own sentence from
`17` rather than against a ranking, and no two signatures may match: 텍스트만 바뀐 같은
페이지로 읽히면 실패다, measured.

The three named transitions are one FLIP. The first implementation used a hard-coded source
selector and the e2e showed the SC-02 → SC-03 morph never fired — SC-02 does not draw a Work
card, and what was on screen was the guard panel. Widening the selector would have been worse:
for a History list `querySelector` picks the FIRST row, so the morph would have been asserting
that two different Works are the same thing. The source is now the card the user actually
pressed, recorded in the capture phase, which makes the morph's statement true by construction.

The reduced-motion guard is in JavaScript because it has to be: `animation: none !important`
does not reach a Web Animations call. The e2e sails the same two navigations twice and counts
1/1 with motion on and 0/0 with it off, plus zero horizontal overflow while a FLIP is scaled
past its own box.

A mutation showed the geometry check could not tell `15`'s Work-card size from a smaller one —
the card's content keeps it dominant either way. "Is it dominant" and "is it the size `15` says"
are two claims; only the first was being made. Both are now.

Next eligible: DV-11's pty decision · an independent QA pass over batches 13–15 · WBS-32/33
(need humans and Windows).

## Batch 16 QA · batches 13–15

Report: `BATCH-16-QA.md`. Canon findings raised: **CF-20**.

3 HIGH · 2 MEDIUM · 0 BLOCKER. 493 tests, three e2e files.

The worst of them was a comment that was not true: `presence.js` said "There is no timer in
this file. Not one." while using `performance.now()` and `requestAnimationFrame`, and the test's
banned-word list had been shaped to let that through. The claim is now stated precisely — there
IS a clock, and what there is not is a clock that can reach a MODE — and the test asserts the
clock's presence before checking that nothing schedules a callback and that `setMode` has
exactly three callers, none of them the loop.

Two false claims of the same family: SC-02 reported 대기 중 when the store refused to answer at
all (the sibling of a bug already fixed for a missing snapshot), and `15` SC-04's
`원하던 결과가 아니에요` had never been built on SC-04 — a user who had just been shown why a
change happened could not say it was not what they wanted from the screen that showed them.

CF-20: `16` §2.1 states 보조 텍스트 대비 ≥ 4.5:1 on the same line as values that measure
3.11:1 and 2.72:1. The requirement wins over the draft hex, and `tokens.css` now says so rather
than continuing to describe itself as a pure transcription.

Two mutants in this run have now passed the unit suite and been killed only by the e2e, both
because the check was reading source text. Recorded: a claim about the SCREEN is the e2e's;
a source check earns its place only when it shows the structure makes the claim impossible.

Next eligible: DV-11's pty decision · WBS-32/33 (need humans and Windows).

## Batch 17 · WBS ledger + traceability tags

Report: `WBS-LEDGER.md`. No new Canon findings.

All 39 packages accounted for in one table, with the code and the tests for each. Building it
surfaced a traceability gap `22` cares about: **WBS-23, 24, 25, 29 and 30 could not be found by
number** — their implementations carried no `WBS-NN` tag, so a reader following `21` §1 to the
code hit nothing. Tagged: `qc/run.js` (23 · 24), `td01.js`/`td01.css` (25 · 23 · 24),
`tokens.css`/`base.css` (29), `security.js`/`exclude.js` (30), and the corresponding test files.

The ledger's state column means one thing and says so: the acceptance is in the code and a test
exists that can actually fail on it. Windows behaviour, real users' understanding and a signed
build's first run stay in `DEFERRED_VALIDATION.md`.

**Three packages are not finished, and each for a reason that is not a scheduling one:**
WBS-25's shell command line (DV-11 — a product decision between node-pty, a TTY-less pipe shell,
and the mock `18` already has copy for), WBS-32 (needs people), WBS-33 (needs Windows and a
signing certificate).

## Batch 18 QA · Work loop core (WBS-18 · D-114)

Report: `BATCH-18-QA.md`. No new Canon findings. 2 HIGH · 0 BLOCKER. 496 tests.

Both findings are `확인됨` chips that were not earning them.

The observed-tools count on the result card was derived from `signals.filter(...).length` — so
it counted MESSAGES, not blocks (one `user` message can carry several parallel `tool_result`
blocks, which the reducer's own `toolsUsed` had already been fixed for), and it was read through
a 500-row cap, which made a long Work's count depend on how much of its own history had been
read. `build()` no longer takes the signal list at all: the count is the caller's measurement,
and when nobody measured, no claim is made.

**The first fix was wrong and the unit test could not tell.** `countToolResults` read the
reducer's `all` shape, but the supervisor persists the RAW CLI LINE, where the blocks live in
`message.content[]` — the unit test was putting in a shape it had invented and reading it back.
The e2e cross-check against the app's own recorded signals caught it, and then that check turned
out to have made the same mistake. Both now read the raw line, the recording carries a real
parallel call, and the check asserts it CAN tell the bug from the fix before it asserts anything
else.

Second: a 부분 완료 card drew only 안 된 것 when the evidence pair could not tell what changed,
which reads as "nothing was done". `verify()` had been reporting that all along and
`buildChecked` could only write it to the record. The heading is now always drawn for a 부분
outcome and says 확인 못함 when there is nothing measured to put under it.

Next eligible: DV-11's pty decision · WBS-32/33 (need humans and Windows).

## Batch 19 · DV-11 judgement material (WBS-00 spike)

Report: `DV-11-PIPE-SHELL-SPIKE.md`. Script: `scripts/spikes/pipe-shell.mjs`.

DV-11 is a product decision and stays one. What was missing was its cost, so the one option
that needs no native module — a TTY-less pipe shell — was MEASURED on Linux instead of guessed
at. `19` §C6 REC-010 marks itself unvalidated and asks for exactly this.

The measurement that would change a decision: a pipe shell has no `/dev/tty`, so `sudo`, `ssh`
and git credential prompts **cannot ask at all** — they fail, and to the user the command simply
did not work. And a closed stdin is not a stall: `read` returns an empty value and the program
carries on, so a wrong answer is delivered silently with nothing visibly wrong on screen.

Against that: stopping already works (group signal — the mechanism WBS-23 measured), a program
that reads stdin CAN be answered if the drawer's input line is wired to it, and batch-mode
programs run. Colour is gone and stdout/stderr order becomes an approximation, which `19` §C4's
"stderr is not hidden and not separated" can only meet approximately.

**Windows was not measured and the document says so on every axis.** Neither was Electron's own
main process, nor node-pty itself (the capability-containment test forbids it).

Next eligible: WBS-32/33 (need humans and Windows) · the DV-11 decision itself.

## Batch 20 · WBS-33's two testable release rules

No separate report — the change is three tests in `tests/security.test.js`. 499 tests.

`21` WBS-33 depends on WBS-32 and needs Windows and a signing certificate, so it stays NOT
STARTED. But two of its four named failure cases need neither, and both were untested:

- **텔레메트리·크래시 리포팅 코드가 빌드에 들어감.** `02` §2 puts cloud dependency outside the
  MVP — a rule the WBS explicitly says it did not invent for itself. Now checked in two places:
  no declared dependency whose name carries a telemetry vendor, and no code that uses Electron's
  `crashReporter`, `net.request`, `fetch`, `XMLHttpRequest`, `WebSocket` or `node:http(s)`.
- **the CSP the renderer ships with.** The offline e2e boots with no network and counts zero
  external requests — that measures the app as it is today. The code and CSP scans catch a new
  outbound call when it is WRITTEN, which is the only moment it is cheap.

Four mutants, all killed: a `@sentry/electron` devDependency, a `fetch(` in `ipc.js`, a
`crashReporter` require in `main.js`, and `connect-src https:` in the CSP.

Next eligible: WBS-32/33 proper (need humans, Windows and a certificate) · the DV-11 decision.

## Batch 21 QA · `15` conformance sweep — dead copy and missing elements

Report: `BATCH-21-QA.md`. No new Canon findings. 2 HIGH · 5 MEDIUM. 500 tests.

One question: does `18` give copy that no screen draws? Twenty-one keys, and two of them had
become FALSE — the product was telling the user that recovery paths did not exist after WBS-04,
22 and 25 shipped them. `15` asks for those as 세 개 / 네 개의 복구 버튼, and they are now
buttons that go to three different places. The Claude-unavailable state — `12` §16's flagship
사용 불가 ≠ 실패 — had no rendered evidence at all; the fixture CLI can now be flipped
logged-out by a marker file, so the e2e reaches it through the real detection path and measures
the card, the chip, zero reds, exactly four buttons, the kept text, and the drawer carrying the
user's own sentence.

Copy rots more quietly than code: an unreferenced key raises nothing while the world changes
underneath it. `tests/unit.test.js` now checks every leaf key is referenced by a screen, with
two traps closed — dynamically indexed parents count as used, and a key named only in a COMMENT
does not (that one made `history.more` look alive). Seven keys that could not be rendered yet
are listed with reasons, and the list is itself checked for staleness, so it cannot quietly
become permanent.

Rendered in passing: the Steps legend and state words (`16` §2.1 — a glyph alone never carries
a state), History's 더 보기 / 접기 (`15` §0 Board M → L), the ambiguity card's ▸ 다시 적기, the
drawer banner's 안전 안내 label, and TD-01's empty Quick Command state. Seven keys were deleted
instead, each with its reason in the report.

Next eligible: the PENDING list · WBS-32/33 · the DV-11 decision.

## Batch 22 · emptying the PENDING list

Report: `BATCH-22.md`. No new Canon findings. 501 tests.

Batch 21's PENDING list — `18` copy with no screen behind it — went from seven to four, and the
four that remain are states the product **cannot enter** until DV-11 is decided (`15` TD-01's
지금 안 됨 is a SHELL that failed to start, and there is no shell yet).

Drawn: `15` SC-01 · UF-RETURN's last-Work summary on each recent row (last by `started_at`, so a
running Work is the one shown; a running Work gets the waiting chip, never one of the five
terminal titles; a project with no Work draws nothing rather than an empty summary), and `15`
SC-03's Remaining-unknown panel — dashed and neutral, with `15`'s three ways out. That state had
the CLAIM but not the STATE: a user whose cancel left an unconfirmed remainder was told so and
offered nothing.

Deliberately NOT drawn: `work.ago`. A relative time is only true while it keeps refreshing, and
the only push that could refresh it is a 15 s tick — so `12초 전` would stand while it had been
27. A per-second redraw with no signal behind it is what this product refuses everywhere else,
and it would buy a fact the wall clock already states exactly and never gets wrong. The duration
IS on screen where it carries a decision: 2분 동안 새 활동이 보이지 않아요, refreshed by the tick
that judges it. The PENDING note now records that decision rather than a to-do.

The Remaining-unknown panel has no rendered evidence: the e2e's project is a git repo whose
evidence pair always answers, so the flow cannot reach it. Source-level checks plus two mutants
cover it, and the gap is stated rather than papered over.

Next eligible: WBS-32/33 · the DV-11 decision.

## Batch 23 QA · the tests were writing into the user's real application data

Report: `BATCH-23-QA.md`. 1 HIGH. 502 tests.

`JUQODE_DB` relocated the store; `evidenceStore` derives from `app.getPath('userData')` and did
not. So every e2e run left a bare git repository per project in the developer's own
`~/.config/juqode/evidence` — **201 had accumulated**, unbounded, with nothing to clean them up.
That is directly against this run's own constraint that tests use disposable scratch storage,
and the failure is invisible: the suite passes either way and the only symptom is a directory
quietly growing in someone's home.

Fixed by relocating `userData` itself rather than adding a variable per path — the store, the
evidence and the Chromium profile all follow one `JUQODE_USER_DATA`, set before
`app.whenReady()`. Three checks, each looking at something different: the e2e OBSERVES that its
own temp directory received a written evidence store; a unit test checks the relocation happens
before anything reads a path; and it checks each harness relocates as many times as it launches
the app, because one missed spawn would pass everything else.

The existing 201 directories were left alone — there is no way to tell this run's test residue
from the user's own app runs, and deleting under their home is their call. `BATCH-23-QA.md`
records where they are and that removing the `evidence` directory is safe.

Third time this run a string scan was fooled by a file DESCRIBING what it does not do (this
one's own comment named `app.getPath('userData')`). Recorded as a rule: strip comments first.

Next eligible: WBS-32/33 · the DV-11 decision.

## Batch 24 · source scans that read prose instead of code

Report: `BATCH-24.md`. No new Canon findings. 503 tests.

Four times this run a check was fooled by a file DESCRIBING what it does not do — `presence.js`
naming `setInterval` in the comment that says it has none, `nextaction.js` explaining what a
declared Step is, `main.js`'s comment naming `app.getPath('userData')` inside the check that the
relocation comes first — and once in the other direction, where `history.more` looked used
because another file's prose contained the word.

`tests/src.js` now has `code()` (comments stripped) and `text()` (raw, for the checks whose
subject IS what the file says), and `tests/unit.test.js` makes going around it a failure: no
test may read `app/` as text directly. Byte-for-byte comparisons are exempt and stay undecoded.

The stripper is a small lexer rather than a regex, because the regex version creates its own
false passes: `'http://x//y'` in a string, `/a\/\/b/` in a regex literal, and a `/* … */` inside
a template literal all survive it. The meta-test also checks the helper is real — `text()` finds
`setInterval` in `presence.js` and `code()` does not — since a `code()` that did not strip would
satisfy every other line while changing nothing.

Migrating turned up one more of the same: `presence.test.js`'s no-face check proved the points
were evenly distributed by finding the word `fibonacci`, which appears only in a comment. It now
checks the golden-angle constant, which is the distribution.

Next eligible: WBS-32/33 · the DV-11 decision.

## Batch 25 QA · systematic mutation sweep (not hand-picked)

Report: `BATCH-25-QA.md`. No new Canon findings. 515 tests, three e2e files.

Every mutation in this run so far was one I CHOSE — aimed at what I had just changed, so code
nobody was looking at was never checked. This sweep generated them mechanically over five core
files (comparison and logical operators and return constants, on comment-stripped code only),
79 + 62 mutants: **12 real gaps and 3 equivalents.**

The evidence layer held three of them. `measure()`'s `.git` skip could be inverted so it measured
`.git` ALONE and the whole suite passed — `19` §E's size ceiling would have stopped firing on
every real project, silently. `firstUnreadable` answers `rel || '.'` and the root's `rel` is the
empty string, so without the fallback a project whose root cannot be listed at all is allowed to
start a Work and the basis gets built by `add -A`, which only WARNS about what it cannot read.
And the nested-repo ledger's `.git` skip was only ever exercised by a file at the nested repo's
root, where it cannot matter.

Two more were claims nothing could check: `toSignal`'s `system/status` branch had no coverage at
all (the recorded fixture carries no such event, and the recording was the only place that
mapping was exercised), and the permission GRANT matcher was only ever asked to resolve the
FIRST outstanding refusal — so a matcher that ignored the id entirely passed everything, which
makes D-116's record a guess. Both now have written-down tables.

Two were code that could not be reached: `buildChecked`'s 확인됨 downgrade (extracted as
`downgrade()` so a test can hand it the shape `build()` cannot produce) and a per-block `isError`
that nothing read (deleted — the raw line still carries it).

The sweep also found the suite could HANG: `node --test` has no default per-test deadline, so a
mutant that never settled a promise produced a CI job that never reports. `--test-timeout=60000`,
and a test that checks it is set.

Its load then shook the e2e twice, both times by sampling after a fixed sleep rather than waiting
for the outcome — focus read as `BODY`, and a second Electron's renderer read as
`window.__screen is not a function`, which looks like a product failure and is not one. Both now
poll to a bounded deadline and fail in the words of what actually did not happen.

Next eligible: finish the sweep over the remaining main-process files · WBS-32/33 · DV-11.
