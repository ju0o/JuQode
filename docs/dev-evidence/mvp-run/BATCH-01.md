# BATCH 01 — WBS-21 · WBS-02 · WBS-09

| | |
|---|---|
| Branch | `dev/mvp-autonomous-v01` (from PR #3 head `d03a21f`) |
| Working Canon | JuQode-Private `canon/wbs00-implementation-findings` (`956a8c3`, PR #13) |
| Host | Ubuntu 26.04.1 LTS · x86_64 · not WSL, not Windows |
| Runtime | Electron 44.3.0 · Chromium 152 · Node 24.20.0 · SQLite 3.53.4 (`node:sqlite`) |

## What was selected and why

Eligible set after WBS-00 / WBS-01 (deps read mechanically from `21` §1 `Deps`):
WBS-21 (deps 01) · WBS-09 (deps 01) · WBS-25 (deps 00, 01).
WBS-25 (terminal drawer / pty) was deferred to a later batch: its acceptance is ConPTY,
which is a target-Windows item (DV-6). WBS-02 (deps 01, 21) became eligible the moment
WBS-21 landed and is in this batch, which is what makes the batch a usable journey rather
than three disconnected modules.

## WBS-21 · Persistence — IMPLEMENTED, LINUX-VALIDATED

Engine: `node:sqlite`, the SQLite that ships **inside** the Electron 44 Node 24 runtime.
No native module, no `electron-rebuild`, no ABI coupling — measured in Electron itself
before the choice was made: `{"ok":true,"node":"24.20.0","electron":"44.3.0","sqlite":"3.53.4"}`.
`19` §D1's packaging risk therefore does not extend to the database.

`app/main/db/schema.sql` is a **byte-identical copy** of Canon `docs/data/schema.sql`
(26 tables, 28 FKs). A test fails if it drifts, and fails loudly rather than skipping when
the Canon file is unreachable.

Acceptance from `21` WBS-21, each with the measurement:

| Acceptance clause | Result |
|---|---|
| D-117 partial unique index rejects a second active Work | ENFORCED BY THE ENGINE — `work_one_active_per_project`; app code does not guard it. Ending the first Work frees the slot. |
| migrations apply forward only on an existing DB | A store at a version this build does not know is refused (`db-newer`), never downgraded. Reopening at the current version re-inserts nothing. |
| a corrupt file is refused, not recreated | Three shapes tested — non-database bytes, 4 KiB of filler, a truncated real store. All three raise `db-corrupt`, and the test asserts the file is **byte-identical afterwards**. |

Packaged-build check (the failure mode that unit tests cannot see): `schema.sql` is inside
`app.asar` and the **packaged Linux binary** creates a 26-table store at schema version 1 on
first run. Windows packaging remains DV-3 / DV-4.

## WBS-02 · Project open — IMPLEMENTED, LINUX-VALIDATED

- Native folder pick → `project` row → SC-02. Cancelling shows nothing (it is not a failure).
- `realpathSync` canonicalises, so a folder and a symlink to it are **one** project row, and
  reopening never re-keys the project.
- Failure names its reason: `missing` · `not-a-folder` · `unreadable`, each with the
  technical text behind the `자세한 내용 보기` disclosure, plus two recovery actions
  (`▸ 같은 폴더 다시 시도` · `▸ 다른 폴더 고르기`) per `15` SC-01 Failure State.
- Main returns **machine reasons only**. A test fails if Korean appears in `app/main/`,
  which keeps `18` the single copy source.
- `juqode:open-path` accepts only a folder main already offered (a recent row, or the last
  pick being retried). A renderer cannot use it to name an arbitrary directory.
- Not re-interpreting on reopen is currently free: interpretation is WBS-03/04 and does not
  exist. It is written down here so it is checked when it does.

## WBS-09 · Claude Code detection — IMPLEMENTED, LINUX-VALIDATED

`claude --version` then `claude auth status --json`. The auth object carries account email,
org id and org name; **one boolean is read from it and the object is discarded**. It is never
persisted, never logged, never sent to the renderer. Two tests enforce that: one feeds a fake
CLI an auth payload full of identity fields and asserts the return value has exactly
`{available, version}`; the e2e asserts none of those keys reach the renderer.

Measured against fake CLIs (`21` WBS-09 asks for exactly this): missing binary →
`not-installed` · logged in → available with the version it printed · logged out →
`logged-out` · unparseable auth output → `unreadable-auth`, never guessed as logged in.

Available is **silent** — `15` SC-02 has no "Claude Code is fine" state and inventing one
would be a claim to keep true.

## Tests

`npm test` — 33 tests, 33 pass, from a clean checkout.
`npm run test:e2e` — boot smoke, visual+behaviour, offline+reduced-motion+shutdown: all pass.

The e2e drives the **real** Electron app over CDP with its own temporary store, seeded with
one project, and walks SC-01 → recent row → SC-02 → `다른 프로젝트 열기` → SC-01.
Theme matrix (OS preference × toggle, six combinations): primary-button contrast
**15.74 : 1 (light) / 16.32 : 1 (dark)**. SC-02: no horizontal overflow, no card clipping its own content, and
**zero red** on a screen where nothing has failed.

A second launch, with a deliberately unusable store, proves the other half of the WBS-21
promise: the app still **boots**, lands on SC-01, reports the refusal with the
`지금 안 됨 · 실패 아님` grammar (not red), disables project-open because nothing could
remember the result, and leaves the unusable file byte-identical.

### A correction to this report

An earlier revision of this file cited **11.78–12.81 : 1** for the primary button. Those
numbers were wrong: the harness sampled the colour while the button's own CSS transition was
still running, so it measured an intermediate value. The token pair `--board` on `--ink` works
out to 15.7 : 1 in light and 16.3 : 1 in dark, and that is what the harness reports now that
it disables motion before measuring. Nothing about the button changed — only the measurement.

## Defects found and fixed inside this batch

| | |
|---|---|
| The e2e harness leaked Electron | `app.kill('SIGTERM')` killed `xvfb-run`, not the Electron tree. The script finished its work and then never exited, holding six orphan processes — so `test:e2e`'s `&&` chain could not reach the later files. Fixed by spawning detached and killing the process group; a CDP call now also times out instead of hanging silently. |
| The top bar rendered paths wrongly | The `direction: rtl` trick that keeps a path's tail visible moved the leading separator to the end: `/tmp/x` rendered as `tmp/x/`. Reverted to plain truncation; the whole path stays in the `title`. |
| A Korean sentence in `app/main/` | `claude-detect.js` returned a Korean `detail`. Replaced with the machine reason `unreadable-auth`; the rule is now a test. |
| `db.js` diagnostics were Korean | They are developer text that is never shown. Made English, so the "no Korean in main" test means what it says. |

## Review

Three independent read-only reviewers ran against this batch: product/Canon conformance,
adversarial technical, and a test adversary doing mutation testing. They returned **three
BLOCKERs and nine HIGH findings**, several of them against comments in this code that
asserted properties the code did not have. Every one is listed; nothing was set aside.

### BLOCKER

**1 · Account identity was sent to the renderer and painted on screen.**
`claude-detect.js` put the auth command's stdout into a `detail` field whenever the command
exited non-zero — which is the ordinary shape for a logged-out CLI. That is the whole object:
email, org id, org name, plan. It crossed IPC and rendered inside the `자세한 내용 보기`
disclosure, and would have landed in the committed screenshot goldens. The file header said,
in as many words, that this could not happen.
*Fixed structurally rather than carefully:* the auth command's output never leaves the
function. Only `claude --version` may contribute `detail`, and it prints a version string.
The test that was supposed to catch this only ever ran the exit-0 branch — the helper had an
`authExit` knob that no test passed. It is now driven on both paths.

**2 · A valid SQLite file that is not our store was adopted, and then blanked the window.**
The store check verified an integrity check, the presence of `schema_version`, and a version
ceiling. It never verified that the schema's own tables were there. The realistic trigger is
not an attacker: `exec()` autocommits per statement, so a first run killed partway through
`schema.sql` left `schema_version` seeded and `project` missing — an adoptable half-store.
The consequence chain was total: `boot` throws → the invoke rejects → the renderer's
top-level `await` dies → **white window, forever, no message**, with the store-refusal card
that exists for exactly this case unreachable, because the store had been accepted.
*Fixed:* the first run is one transaction (all 26 tables or none); adoption requires the
schema's tables to be present, read from `schema.sql` itself so it cannot drift; a version
below the seed is refused too; and **every IPC handler now answers rather than throwing**, so
no single failure can blank the window again.

**3 · The Brief slot shipped unapproved copy under a comment saying it never would.**
The SC-02 Brief card rendered a `dev:` string with the Canon `지금 안 됨 · 실패 아님` chip.
That chip means a capability that EXISTS and is blocked right now (`12` §16). The
interpretation engine does not exist. Borrowing the chip for something never built is the
exact lie the chip was invented to prevent.
*Fixed:* the Brief card is gone until WBS-03/04 build it, the `dev:` block is deleted, and a
test now **forbids** a `dev:` block in `copy.js` outright.

### HIGH

| | Finding | Fix |
|---|---|---|
| H-1 | `openPath(null)` defeated the "already offered" gate: `lastPick` starts as `null`, and `realpathSync` coerces a non-string, so `null` resolved to a `null` folder under cwd, was written as a project row, and navigated to SC-02 for a folder the user never chose. The test asserted only that the string `not-offered` appears in `main.js`. | Type check is now the gate's first clause; the gate is exercised **through the bridge** with `/etc`, `''`, `null` and `42`. |
| H-2 | A CLI that ignores SIGTERM made detection never resolve — and 응답 없음 is precisely the case that has to stay reportable. `execFile`'s timeout sends one SIGTERM. | `killSignal: 'SIGKILL'` plus a deadline the child cannot influence. Tested with a `trap "" TERM` fixture. |
| H-3 | On Windows an installed Claude Code would be reported as 설치되지 않음: `CreateProcess` appends only `.exe`, npm installs `claude.cmd`. | Explicit `PATHEXT` walk, `cmd.exe` routing for `.cmd`/`.bat`. **Not runnable here — DV-9.** |
| H-4 | `unreadable-auth` and `error` fell through the renderer's reason map to `Claude Code에 로그인이 필요해요` — stating an authentication fact from no evidence. | The card is deferred with its trigger (CF-3), and the reason contract now says an unmapped reason must never borrow another reason's sentence. |
| H-5 | More than 1 MB of CLI output (`maxBuffer`) was reported as 로그인 필요 plus 400 characters of garbage. | Unparseable auth output is `unreadable-auth`, never guessed. |
| H-6 | `▸ 해결한 뒤 다시 보내기` resent nothing and `location.reload()`ed, dropping the user back to SC-01 with the project gone. | Card removed with its trigger. |
| H-7 | The primary button said `폴더를 읽고 있어요…` while the native picker was still open — a claim about a folder not yet chosen. | The loading sentence is now only used on the path where a folder is already named. |
| H-8 | `gap.failMissing` transcribed `15`'s `폴더가 존재하지 않습니다`, but `18` had already rewritten the sibling reason in that same `15` cell into the `-요` voice. | `폴더가 없어요`. |
| H-9 | Opening a **recent row** that had become unopenable lost `▸ 같은 폴더 다시 시도`: the failure carried no path. `21` WBS-02 requires two recovery actions. | The failure carries the folder; the e2e now deletes a project's folder and asserts both actions render. |

### MEDIUM, all fixed

`realpathSync` → `.native` (case canonicalisation on NTFS — DV-10) · five errno classes
(`ELOOP`, `ENAMETOOLONG`, `EIO`, …) no longer all claim `폴더가 없어요`; an unknown cause says
so · `accessSync(X_OK)` removed (documented as a no-op on Windows; the `readdirSync` was the
only real check) · `integrity_check` → `quick_check` at boot, since the store is designed to
grow · migration rollback wrapped so it cannot mask the real error · `openProject` is one
`on conflict` upsert instead of read-then-write · `claude-detect` is single-flight, so nothing
can spawn CLI processes without bound · `lockNavigation` gets a real `pathToFileURL` (the old
`file://${path}` could never match what the browser reports, so the allowlist had degraded to
deny-all) · the blocked-request log is bounded · handlers reject a sender that is not our
window.

### The test suite was weaker than it looked

Mutation testing found **9 survivors out of 21**. The worst was not a mutant at all:

> `sc02Reds` compared `getPropertyValue('--fail')` — a hex — against
> `getComputedStyle(x).color` — an `rgb()` string. **Those can never be equal.** The check
> reported 0 on a screen with an element deliberately painted red, and this report cited it
> as evidence that red is failure only. It was evidence of nothing.

The token is now resolved through a probe element so both sides are `rgb()`, and the run
additionally **proves the counter can see red** before trusting a zero from it. Re-running the
mutants after the fixes: **12 of 12 killed**, including the red check, the open-path gate,
`raw: ipcRenderer.invoke.bind(...)` on the preload surface, the credential leak on the
logged-out path, and the store guards.

Other holes closed: the migration loop was unreachable from any test (`LATEST` was computed at
module load, so a test could never add a migration — it is a getter now, and both a successful
and a failing migration are driven) · `recentProjects` order and limit were untested · the
unreadable-folder test skipped silently as root, so the suite could go green having tested
nothing — it now says so · `lockNavigation` had no test at all · the reduced-motion e2e
asserted only that the app exited, and now asserts that nothing is animating · "was the recent
list re-read?" compared a count against itself and is now a reorder that a stale DOM cannot
fake · the e2e ran against **whatever `claude` was on the host's PATH**, so it tested a
different code path per machine and passed carrying no information on a machine without it —
it now runs against a fixture CLI and asserts the fixture's version.

The harness itself had two defects: it leaked six orphan Electron processes and never exited
(so `test:e2e`'s `&&` chain could not reach the later files), and a failed boot discarded the
Electron stderr it had collected. Both fixed.

## Canon gap filed

`18_KOREAN_UX_COPY.md` carries no string for four states this batch reaches:
folder missing · target is not a folder · Claude Code not installed · Claude Code not
responding · the store being refused. `15` states the first one verbatim and names the
Claude reasons without giving sentences. Those strings live in `copy.js` under an explicit
`gap:` block, and a test fails if a string is put there that Canon **does** carry.
This is filed back to Canon rather than silently adopted.

## State

| Package | State |
|---|---|
| WBS-21 | IMPLEMENTED_PENDING_VALIDATION (Linux validated; DV-3/DV-4 cover the Windows packaged store) |
| WBS-02 | IMPLEMENTED_PENDING_VALIDATION (Windows path semantics unverified — DV-1) |
| WBS-09 | **PARTIAL** — detection built, measured and tested; the 사용 불가 CARD is deferred. `15` fixes four recovery buttons on it that belong to WBS-04, 22, 25 and 06, and `12` UF-CLAUDE-UNAVAILABLE triggers it on 시작 시도, which does not exist until WBS-06. Four inert buttons would be a dead end dressed as an exit (UF-CLAUDE-ALT). Also DV-9. |
