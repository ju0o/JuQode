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
