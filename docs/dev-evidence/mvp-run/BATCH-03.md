# BATCH 03 — WBS-08 · WBS-10 · WBS-11 (the Work chain, engines)

| | |
|---|---|
| Branch | `dev/mvp-autonomous-v01` |
| Previous checkpoint | batch 02 (`443264b`) |
| Host | Ubuntu 26.04.1 LTS · Claude Code CLI **2.1.266** · git 2.x |

`21` calls this the critical path: "session → reducer → result, fed by evidence → diff".
All three are built and validated against the real CLI and real git repositories. The screens
they feed (SC-03, the intent field's submit, the guard card, the permission card) are the next
batch — every one of them now has a working engine underneath it.

## WBS-08 · Evidence basis — IMPLEMENTED, LINUX-VALIDATED

The corrected contract (D-126a, `19` §E) is now production code, not a spike.

The rule the whole module keeps (`07` §1): **JuQode never writes to the user's index or
worktree.** Not `stash`, not `checkout`, not `reset`, not `read-tree`. It works on a *copy* of
the index, writes objects into a directory it owns, and reads the user's object store only as
an alternate. A test fingerprints the repository — tracked contents, the staged diff, porcelain
status, and a sha256 of every file — and fails if a capture changes one byte of it.

Both exclusion steps are implemented, and a test states why both are needed:

1. an `:(exclude,glob)` pathspec on `add -A`, so nothing excluded is newly staged;
2. `rm --cached` on the **copied** index — because a pathspec only filters what `add`
   considers, so a secret the user already committed stays in that index and `write-tree`
   keeps referencing its blob.

Measured on a fixture whose `.gitignore` deliberately does **not** list the secrets: four
already-committed secret paths dropped from the copied index, **zero** secret paths in the
basis tree, and **zero** of the objects JuQode wrote contain the synthetic marker.

Refusals are checked before anything runs, because `add -A` only *warns* about a path it cannot
read — a basis that silently shrank would be worse than no basis: not a git repository ·
mid-merge / rebase / cherry-pick · an unreadable directory · over the size cap · git missing.

Non-Git projects get a sha256 manifest basis with the same exclusions applied by name before
any file is opened, stored outside the project.

### A defect in this run's own WBS-00 evidence

The excluded-path ledger records `(path, size, mtime_ns)` and never opens a file. Writing it
into production surfaced that **`fs.statSync` has no `mtimeNs` at all** unless called with
`{ bigint: true }` — so the ledger had been recording the string `"undefined"` for every entry
and could only ever detect a **size** change. A same-size edit — the ordinary shape of a
rotated credential — was invisible.

**The WBS-00 spike that validated this contract had the identical defect**, and its result
stood only because that fixture's file also grew. Both are fixed, the spike was re-run, and its
raw evidence regenerated; a test now writes a same-size edit and fails if it goes unnoticed.
This is exactly the silence D-126a replaced the old `--ignored=matching` mechanism to avoid, so
it would have reintroduced the defect the correction was written for.

## WBS-10 · Claude session launch — IMPLEMENTED, VALIDATED AGAINST THE REAL CLI

`claude -p --output-format stream-json --verbose --session-id <uuid>`, spawned **detached** into
its own process group (`07` §8.2: killing a group that contains JuQode kills JuQode — measured,
exit 143). Every line is handed over as a raw signal *before* anything interprets it, parsed or
not, because `기술 출력 보기` has to show what actually arrived.

A session that produced **no event at all** did not start: it gets a card and no `work` row
(`20` — History is Works that started). The exit code is consulted for nothing else, because a
denied run exits 0.

### D-133 re-validated end to end — and its mechanics have changed

A full contract-B cycle was run against a disposable scratch repository:

| | |
|---|---|
| turn 1 | `system/permission_denied` for `Edit`; the file is **unchanged**; the Work stays open |
| grant | scope computed from the denial's own `tool_input` → `Edit(note.txt)` — one tool, one file |
| turn 2 | `--resume <id> --allowedTools "Edit(note.txt)"` → `note.txt` becomes `hi` |
| scope held | `other.txt`, which the user never approved, is **byte-identical** |

Two corrections to what was previously recorded as validated (CLI 2.1.263 → 2.1.266):

- **`--allowedTools <tools...>` is variadic.** A prompt passed as a positional argument after it
  is swallowed as a second tool grant. The retry silently never ran and the CLI reported
  "No deferred tool marker found in the resumed session". The prompt now goes on **stdin**,
  which also removes every quoting question about a multi-line request.
- **`--resume` alone no longer reconstructs the blocked call.** The earlier note that Claude
  resumes "without being retold" does not hold on 2.1.266; the resumed turn needs its prompt.
  What still holds — and is the actual safety property — is that `--allowedTools` bounds what
  the retry may touch.

`Edit(/abs/path)` with a single leading slash is read as a cwd-relative glob and silently
denies, so an out-of-project target takes the `//` form. With nothing to scope to, the answer is
**no grant** — never a grant of the whole tool.

## WBS-11 · Activity stream → Work state — IMPLEMENTED

Pure: state + one signal → next state. No I/O, no clock, no process handles, so every transition
can be driven from a recording. `tests/fixtures/stream-permission-denied.ndjson` is a **real**
recorded run (CLI 2.1.266), edited only to replace the recording machine's temp path.

The rule the file keeps: **no state is set that no signal justifies.** An unrecognised event
becomes a raw signal and changes nothing — a test drives five such events and fails if any of
them moves the Work. Absence of a signal is never read as progress, and elapsed time is never
read as a state.

Two judgements worth stating:

- **An unresolved refusal keeps the Work open.** The turn ends, but under contract B the user
  can still allow and the same Work resumes in the same session — closing it would throw away
  what the card exists for. `permission_waiting` names what the WORK waits for (the user's
  decision); the copy must still never call the request 대기 중, because it is already denied.
- **A refusal the user then allowed is resolved**, so the Work ends `complete`. Reporting
  부분 완료 because something was refused once and then done describes something the user did
  not see happen. An *unanswered* refusal is what makes it `partial`.

## Tests

`npm test` — 169 tests. `npm run test:e2e` — three files. All passing, no orphan processes.

The evidence tests build throwaway git repositories under the OS temp directory; the D-133
cycle ran in a disposable scratch repo. **No real user project was involved at any point, and
every secret in every fixture is a clearly-labelled synthetic marker.**

## Review

Two independent reviewers ran against the committed batch. They returned **4 BLOCKERs and
14 HIGH**, and two of the BLOCKERs were live secret disclosures I reproduced before fixing.
Everything is fixed and re-tested; the fixes are in the follow-up commit.

### BLOCKER

**1 · A secret filename git has to quote reached the basis tree in plaintext.**
`git ls-files` was read without `-z`, so git C-quoted any path that is not plain ASCII: `키.pem`
came back as `"\355\202\244.pem"`, its basename ended in a quote, the name check missed it,
and `write-tree` kept referencing its blob. **For a Korean-market product that is the ordinary
filename, not the exotic one.** The same shape swallowed a *directory* named `.env`: `.env/config`
has the basename `config`, and a git glob pathspec does not cross `/`, so neither mechanism
matched it. Both reproduced with the marker read back out of the tree.
*Fixed:* `ls-files -z`, matching on **every path segment** rather than the basename, and
directory forms (`x/**`) in the pathspec.

**2 · A case-variant untracked secret was hashed into JuQode's own object store.**
The name check is case-insensitive; a git pathspec is case-**sensitive**. So an untracked
`.ENV` passed the pathspec, git hashed it and wrote the plaintext blob into
`GIT_OBJECT_DIRECTORY`, and only then did the drop step clean the tree. The tree was innocent;
the store held the secret, and that store is never garbage-collected. Reproduced.
*Fixed:* `:(exclude,glob,icase)`.

**3 · A capture wrote into the user's `.git` on any repo with `core.splitIndex`.**
`GIT_INDEX_FILE` redirects the index, but the *shared* half is written to `$GIT_DIR` — every
capture left a new `sharedindex.*` behind. Split index is the standard advice for large repos,
which is JuQode's stated target. This is `07` §1's absolute rule.
*Fixed:* `-c core.splitIndex=false` on every call.

**4 · An orphan that left the process group pinned the Work forever.**
Resolution hung off `close`, which waits for every inherited pipe; `07` §8.7 had already
measured the orphan class that defeats it — a `setsid` grandchild holds stdout open. The
promise never settled, so the Work stayed `running` and **D-117's single active slot was never
released**. Measured: hung indefinitely; now settles in 2.3 s.
*Fixed:* resolve on `exit` with a once-guard, and release the pipes after answering.

### HIGH

| | Finding | Fix |
|---|---|---|
| H-1 | The ledger covered only the secret list, so a change to a **gitignored** file was invisible in the diff AND in the ledger — the exact silence D-126a replaced the old mechanism to end | the ledger takes the whole excluded set: secrets, ignored paths, nested-repo files |
| H-2 | A nested repository swallowed its whole subtree from evidence and ledger both; with no commit in it, `add -A` failed outright and no basis could be taken at all | excluded by pathspec **and reported**, its files ledgered (D-126 asks for exactly this) |
| H-3 | `manifest.diff()` compared only sha256, and an unreadable file has `null` on both sides — a file that went from 10 to 29 bytes read as unchanged | size compared too; an unreadable file reports `unknown`, never "unchanged" |
| H-5 | `firstUnreadable` checked directories only and skipped `node_modules`, so an unreadable **file** made capture throw instead of refusing, and an unreadable directory under `node_modules` let the basis silently shrink | files and directories, at every depth |
| H-6 | The NDJSON reader concatenated Buffers as strings, so a Korean character split across a pipe chunk became U+FFFD — and `unparsed` stayed 0, because corrupted text is still valid JSON | `setEncoding('utf8')` |
| H-7 | `allowSpec` emitted glob grants: `file_path: '<cwd>/*'` produced `Edit(*)` — the bare-tool grant D-133 bans outright — while the approval card showed one path | any target that could mean more than one thing is refused |
| H-8 | A crafted `tool_input` injected a second grant: `a),Bash(rm -rf ~` produced `Edit(a),Bash(rm -rf ~)`, and the flag accepts comma-separated specs | same |
| H-9 | A relative `file_path` resolved against **JuQode's** cwd, so the card and the grant named different files | resolved against the project |
| H-10 | Only the most recent denial was held, so granting one discarded the card for another the user never answered — q04b measured two denials in one turn | denials are a list; each unanswered one keeps its card |
| H-11 | A stray grant moved an **ended** Work back to `running` while keeping `outcome: complete`, re-taking the D-117 slot | an ended Work is ended; only reconciliation may speak about it |
| H-12 | A cancelled Work reported 완료, because `result.is_error` is as blind to cancellation as the exit code (`07` §8.1) | a cancel request survives the finish |
| H-13 | `error_max_turns` reports `is_error: false`, so it read as a success. `19` §C3-L says the three signals are read **together** | terminal reason and API error status carried and read |
| H-14 | **Eight comments asserting properties the code did not have** — including the byte-identical claim on a fingerprint that could not see index rewrites | each rewritten to say what is true, and what is not covered |

Also: a grant with no id resolved *every* outstanding refusal (one click could report 완료 with
refusals the user never saw); `mergeDenials` dropped the result's entry — the only source of
`tool_input`, which the card needs — when both ids were null; only the first of several parallel
tool calls was counted; an inherited `GIT_DIR` redirected the basis at another repository; and
`stop()` escalated to SIGKILL without re-checking, which `07` §8.5 warns can hit a recycled pid.

### The test that could not fail, again

The single test guarding `07` §1 — "a capture leaves the user repository byte-identical" — ran
`git status` **inside its own fingerprint**, which stat-refreshes and rewrites `.git/index`, and
only then hashed the tree. Both sides came back normalised to the same post-refresh bytes, so an
index rewrite was invisible to it. Two mutants survived on exactly that. The fingerprint now
hashes `.git/index` first, before any git command runs, and every git call in it carries
`--no-optional-locks` so the measurement cannot cause the damage it is looking for.

Mutation testing scored **41 killed / 32 survived (56%)** — the worst of the run. Five survivors
applied together left the suite fully green. Beyond the fixes above, the suite gained: the
untracked-secret case (the pathspec's only real job, and every fixture secret had been
pre-committed, so nothing tested it), nanosecond mtime asserted directly rather than after a
deliberate millisecond wait, diff direction, `failed` / `input_waiting` / cancellation outcomes
that no recording happens to contain, the process-group property `07` §8.2 calls the 3am bug,
and the constant CLI flags without which a retry could never resume.

## State

| Package | State |
|---|---|
| WBS-08 | IMPLEMENTED_PENDING_VALIDATION — Linux/git validated; `21` lists q19 §7's unvalidated set (racy-git, `assume-unchanged`, sparse-checkout, worktrees, submodules, symlinks, case-insensitive FS, non-Linux, durability after the user's `git gc`, concurrent edits, multi-GB repositories) as standing risk, and this run does not change that |
| WBS-10 | IMPLEMENTED_PENDING_VALIDATION — validated against the real CLI on Linux; Windows process/spawn behaviour is DV-7 |
| WBS-11 | IMPLEMENTED — pure, and driven by a real recording |

Next: SC-03 and the surfaces these engines feed — the intent field's submit (WBS-06's UI), the
guard card (WBS-07's), the 사용 불가 card (WBS-09's), the permission card (D-133 contract B),
and the Work screen itself.
