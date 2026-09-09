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
