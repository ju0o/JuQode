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

`npm test` — 146 tests. `npm run test:e2e` — three files. All passing, no orphan processes.

The evidence tests build throwaway git repositories under the OS temp directory; the D-133
cycle ran in a disposable scratch repo. **No real user project was involved at any point, and
every secret in every fixture is a clearly-labelled synthetic marker.**

## State

| Package | State |
|---|---|
| WBS-08 | IMPLEMENTED_PENDING_VALIDATION — Linux/git validated; `21` lists q19 §7's unvalidated set (racy-git, `assume-unchanged`, sparse-checkout, worktrees, submodules, symlinks, case-insensitive FS, non-Linux, durability after the user's `git gc`, concurrent edits, multi-GB repositories) as standing risk, and this run does not change that |
| WBS-10 | IMPLEMENTED_PENDING_VALIDATION — validated against the real CLI on Linux; Windows process/spawn behaviour is DV-7 |
| WBS-11 | IMPLEMENTED — pure, and driven by a real recording |

Next: SC-03 and the surfaces these engines feed — the intent field's submit (WBS-06's UI), the
guard card (WBS-07's), the 사용 불가 card (WBS-09's), the permission card (D-133 contract B),
and the Work screen itself.
