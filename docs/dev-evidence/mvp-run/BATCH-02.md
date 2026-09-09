# BATCH 02 — WBS-03 · WBS-06 · WBS-07

| | |
|---|---|
| Branch | `dev/mvp-autonomous-v01` |
| Previous checkpoint | batch 01 (`fcece15`) |
| Host | Ubuntu 26.04.1 LTS · x86_64 · not WSL, not Windows |

## What was selected and why

Eligible after batch 01, read mechanically from `21` §1 `Deps`:
WBS-03 (02) · WBS-06 (02) · WBS-07 (21) · WBS-08 (00, 21) · WBS-10 (09, 21) · WBS-25 (00, 01).

Taken: **WBS-03 · WBS-06 · WBS-07**. WBS-08 and WBS-10 are the Work chain and belong together
with WBS-11 in the next batch — splitting them would leave a half-Work. WBS-25 needs a pty; that
is a native-module decision (`19` §C6) and gets its own batch rather than being rushed here.

## WBS-03 · Project interpretation, facts layer — IMPLEMENTED, LINUX-VALIDATED

`19` §C1 ① splits interpretation in two: a deterministic facts layer, and a Claude narrative
layer (WBS-04). Only the facts layer can produce **확인됨**, and `20` refuses that confidence
without a `source_ref` — so this half is where the Brief's honesty actually lives.

What it reads: manifests (`package.json` · `pyproject.toml` · `requirements.txt` · `Cargo.toml`
· `go.mod` · `pom.xml` · `build.gradle` · `Gemfile` · `composer.json`), the README's first
section, the top-level tree to depth 3, declared scripts, and lockfile presence. Tested against
a per-ecosystem fixture matrix (`21` WBS-03 Tests: "unit per ecosystem fixture").

What it answers, and what it refuses to answer:

| # | Question | Today |
|---|---|---|
| ① | 하는 일 | **확인 못함** — nothing deterministic establishes what a project is *for*. A README states an intention; it does not prove one. WBS-04. |
| ② | 주요 기능 | **확인 못함** — same. WBS-04. |
| ③ | 쓰인 기술 | **확인됨** when a manifest proves it, `source_ref` = that manifest (+ lockfile). No manifest → 확인 못함, not a guess from file extensions. |
| ④ | 폴더가 하는 일 | **확인됨** that these folders exist, `source_ref` = `tree:1` — and the card says on its face that what each folder is *for* has not been read. See CANON_FINDINGS CF-7. |
| ⑤ | 실행 방법 | **확인됨** from scripts the project declares, `source_ref` = the manifest. No scripts → 확인 못함. A way to run a project is never invented. |
| ⑥ | 확인 못한 것 | **확인됨**, `source_ref` = `scan` — it is a statement about this scan, and it names the unanswered questions plus whatever the budget skipped. |

Secrets are excluded **by name, before anything opens them** (`19` §C1 ④): `.env` · `.env.*` ·
`*.pem` · `*.key` · `id_rsa` · `id_dsa` · `*.p12` · `*.pfx`. The list is JuQode's own and does
not consult `.gitignore`. A test builds a project full of secret files carrying a synthetic
marker and fails if the marker, or any of those paths, reaches the scan result.

Budget (`19` §C1 ③): 2,000 files. What the cap cut off is reported in 확인 못한 것 with the
count, never dropped silently. Generated and vendored directories (`node_modules` · `dist` ·
`.git` · `build` · `target` · `.next` · `.venv` …) are skipped and the skip is reported.

Stale (`19` §C1 ⑤): a `source_hash` over the manifests, the declared scripts, the lockfiles and
the depth-capped tree. Tested three ways — the same project hashes the same twice, rewriting
prose does **not** age the Brief, and a new dependency or a new top-level folder does. The
UI for stale is WBS-05; this batch only establishes the signal.

A failed scan is a read-failure band inside the Brief card. `11` F-C1-02:
"해석 실패가 제품 전체의 정지가 아니다" — the rest of SC-02 stays usable.

## WBS-06 · Intent routing — ENGINE IMPLEMENTED, UI DEFERRED

`15` SC-02 and D-134: the main request field has exactly **one** outgoing route, a Claude Code
Work. A technical execution request is not run and is not an error — the field says the
terminal is where that lives.

The matcher is the validated one (`19` §C4, `../evidence/planning/q02-q03-quick-command-validation.md`,
corpus 87/87): NFC → trim → tail punctuation and laughter → lowercase latin → strip spaces →
remove fillers, then exact form → object+verb composition → verb-only → dual-meaning verb →
synonym pass → unrecognized. No morphology, no typo correction, no similarity score, no LLM.

The safety property is `residue === 0`: a rule matches only when its declared objects and verbs
consume the **whole** input. It is an allowlist with a leftovers check, not a blocklist, so
`서버 켜줘 && rm -rf /`, `sudo npm run dev`, `git push --force`, `개발 서버 켜줘 (5173 포트로)`
and unforeseen phrasings fail to match without anyone having to predict them. A test drives
thirteen dangerous strings and fails if any reaches a rule.

One ordering detail worth writing down: the change-verb check runs **after** rule matching, not
before. `수정된 파일 확인해줘` is a `qc.git.status` match whose *object* contains 수정, and
checking change verbs first misreads it as a request to modify something. The Canon evidence
names that exact case; the test carries it.

**The UI is deferred.** Submitting a change request has to start a Work, which needs WBS-08
(evidence basis) and WBS-10 (Claude session). A field whose primary route ends in nothing is
the same mistake as batch 01's Brief placeholder. It lands with WBS-10.

## WBS-07 · Single active Work guard — ENGINE IMPLEMENTED, CARD DEFERRED

D-117 is enforced by `work_one_active_per_project`, a partial unique index in the Canon schema.
`beginWork` turns the engine's refusal into a **guard state the screen can render** rather than
an exception, and reads the blocking Work back from the database so the card can talk about the
Work that is actually running. The refused request is not queued (UF-RULE-NOQUEUE).

Tested: a second Work is refused and no second row is written · the guard is per project ·
it lifts when the Work ends · and **every** non-ended status holds it, not just `running`.

**The card is deferred** for the same reason as WBS-06's field: its four actions (`열기` ·
`답하기` · `이 작업 취소` · `기다리기`) all need a Work to exist.

## Review

Three independent reviewers ran against this batch. They returned **2 BLOCKERs, 12 HIGH** and
a mutation score that was worse than batch 01's. Everything below is fixed and re-tested.

### BLOCKER

**1 · A symlinked manifest read outside the project and stored the bytes.**
`walk()` refuses symlinks — but the manifest and README readers never used the walk's output.
They read from a raw entry-name set that was filled *before* any type or secret check, and
`readFileSync` follows links. So:

```
project/requirements.txt -> ~/.ssh/id_rsa
```

was opened, parsed, written to `interpretation_answer.text`, and rendered in the Brief under a
**확인됨** chip. The file header said, in as many words, "Never follows a symlink out of the
project." Same route via `README.md -> <anything>`, which captured 8 KB.

*Fixed structurally:* the walk now produces one list — entries it verified are regular files
(`lstat`, so a symlink stays a symlink), are not on the secret list, and are small enough to be
a manifest — and that is the only list anything reads from. A related hole closed with it:
`/^readme/i` matches `readme.key`, so a secret-named file was being opened as a README.

**2 · 폴더가 하는 일 was marked 확인됨 while the card admitted it had not read the roles.**
One chip certified two claims of opposite confidence, and the one the label names was the one
nothing established. `19` §C1 ① does list this question among the three the facts layer grounds
— filed as CF-7 — but filing an ambiguity and then shipping the flattering reading of it is the
wrong resolution: the user reads "what the folders do: confirmed".
*Fixed:* q4 is 확인 못함, the folder list stays as context, and 확인 못한 것 now names the roles.

### HIGH

| | Finding | Fix |
|---|---|---|
| H-1 | `parseToml`'s `/^\s*name\s*=…/m` is O(lines × bytes) — **44.9 s** measured on a 450 KB manifest, with the window dead throughout because `scan()` is synchronous inside the interpret handler | one-pass line scanner; manifest reads capped at 512 KB |
| H-2 | The byte budget counted the size of files it only LISTED. One 6 MB asset exhausted it, and `source_hash` then stopped responding to the project at all — WBS-05 staleness dead on any project with a large file | the listing is capped by file count; the read ceiling is now a fact about the design (9 manifests + 8 KB README), stated rather than pretended |
| H-3 | The depth cap dropped files with no report, while the header said "never silently dropped" — 3 of 4 files vanished in the measurement | content below the cap is reported and reaches 확인 못한 것 |
| H-4 | An answer's KIND was erased by the store whenever its data was null, so every unanswered row rendered the narrative excuse instead of its real reason (`no-manifest` read as "파일만으로는 답할 수 없는 질문이에요"). `saveInterpretation` returns the read-back row, so this was the FIRST render | kind is always stored |
| H-5 | `만들어` was a `qc.build` verb AND a change verb, so `빌드 만들어줘` — write me a build script — ran the build | dual-meaning treatment, like `정리해` on `qc.dev.stop` |
| H-6 | `해석 시점` timestamp missing (`15` SC-02 ① requires it) | rendered |
| H-7 | 해석 실패 hardcoded its reason, painted IPC failures as scan failures, and persisted as current so a project that failed once was stuck on the failure band forever | the real errno travels and becomes words; an IPC failure is a different fact; a stored failure is kept as history and not handed back as the current answer |
| H-8 | `실행 방법` rendered `npm run dev` under a 확인됨 chip whose source was `package.json` — which proves the script, never the runner. `19` §C4 lists package-manager detection as 미검증 | the runner comes from a lockfile or is not claimed; the lockfile is named in the source line |
| H-9 | `gap.briefNarrative` said "아직 읽지 않았어요" on a card whose own disclosure said it read two files | says what is actually missing |
| H-10 | The router's `''` verb on `qc.git.status` made `verbForms('')` the entire endings table, so `요`, `주세요`, `줘` each became a verb of that rule | bare objects moved to exact forms |
| H-11 | `수정된 파일` and siblings routed to **work** — read-only requests handed to the code-changing route — because change STEMS were matched by substring and the git.status object contains 수정 | change verbs are full forms, so a stem inside a noun is not a verb |
| H-12 | `beginWork` reported any insert failure as the D-117 guard: a NOT NULL violation came back as `active-work` | the error must name the uniqueness the guard index creates |

Also fixed: the secret list now covers `.env*` as Canon writes it (`.envrc`, `.env-production`)
plus `id_ed25519` / `id_ecdsa`; a **directory** named `.env` is excluded (the type branch used
to run first); `부분 해석` is amber (`16` §2) instead of grey; claim chips carry their ✓ / ?
marks; `주요 의존성` is just 의존성, because the list is the first twelve alphabetically and
calling that 주요 is a judgement the scan cannot make; a verb with no object always keeps the
Work reading; and classification is bounded so a pasted wall of text cannot stall the field.

### The test suite was the real finding

Mutation testing: **21 killed, 25 survived, 1 hang.** The worst of it:

> **Every single secret-exclusion mutant survived** — including deleting the exclusion list
> outright. The test asserted that a marker string and a `.env` path were absent from the scan
> result, but `scan()` returned no per-file listing at all, so both assertions were incapable of
> failing. The most important security property in this layer was guarded by nothing.

Also: `MAX_FILES = Infinity` **hung** the suite instead of failing it, because the fixture was
sized from the constant under test. Two chmod-based tests skip silently as root — the CI default
— and took five more mutants with them, including the entire scan-failure path. The determinism
assertion compared `normalize(s)` to `normalize(s)`. The manifest parsers, the read budget,
`TREE_DEPTH`, symlink handling and `source_ref` provenance had no assertion anywhere.

What changed: the scan now returns its depth-capped file listing, so the walk's behaviour is
observable instead of only hashable — the secret test asserts the listing and the identity hash
are byte-identical with fifteen secret files present, at every depth and in both cases. Budgets
are pinned to Canon's literal numbers. The failure path has an unconditional test that cannot
skip. A `source_ref` must name a file the scan actually touched. Routing is swept exhaustively
over the table's own vocabulary — every declared object × verb × ending, several thousand
phrasings — and the rule table is checked structurally so no shell-shaped or change-verb token
can be added to it unnoticed. Two dead branches found by the mutants (an unreachable read
budget, a `statusOf` exemption that never changed an answer) were deleted rather than tested.

**After the fixes: 21 of 21 killed**, including the two that needed a synthetic rule or
migration pushed onto the exported table to reach them at all.

## Tests

`npm test` — 124 tests, all passing. `npm run test:e2e` — three files, all passing, no orphan
processes. The packaged Linux binary ships the new modules inside `app.asar` and boots.

The e2e now opens a **real fixture project** (manifest, lockfile, README, `src/`, `lib/`) and
asserts the Brief renders all six questions, that every 확인됨 answer names its source file, and
that exactly ①② are 확인 못함. The fixture also carries a `.env` and a `node_modules`, and the
run fails if either is read.
