# Quick Command Stop proof — automatic release contract (LIMITED)

Scope: Windows hosts (H1). A Quick Command run that ended `unknown` holds the Writer gate (`prior-run-unknown`) until it is released.

## Releases (only these)
1. **Complete Stop record** (`qc/stop-proof.js::validate` → `clear`). Every item must hold, else the hold stays and the user confirms per Run:
   run id · recorded time ≥ run start · a requested Windows Stop · row has `runner_pid` + `runner_started_at` · snapshot root pid = `runner_pid`
   and its creation time within a few seconds of `runner_started_at` (a reused pid fails) · kill-tool result present and consistent with
   the root state/fallback · observed integer exit code equal to the row's (`contradiction-exit-0` requires code 0) · `requestedAt` between run start
   and `recordedAt`, and the re-check timings fit in that span · verdict/root pair · `descendants:'none'`, `members:[]`, no survivor pids.
2. **Later snapshot** (`qc/uncertain.js::recheck`): only for members that carry pid **and** creation time, only from a snapshot that was read,
   and only when none of them (nor a late child of a recorded parent, including the dead root) exists.
3. **The user's per-Run confirmation** (`qc/ack.js`), matched against the run row.

Bare pids, empty member lists, unreadable snapshots, thrown probes, and any record that is old-format, incomplete or contradictory never release.

## Structural limit (LIMITED, measured on H1 by `tests/qc-orphans-real.test.js`)
Windows keeps no job/ownership link for a process whose parent already exited. A grandchild orphaned **before** the Stop's snapshot has a dead parent
pid and is not found by pid/creation-time/parent matching. Releases 1 and 2 therefore mean "everything the Stop could observe is gone", not
"no process of this run exists". Complete ownership needs a Windows Job Object, which Node cannot create without a native addon (not installed; PM decision).
Nothing signals a process the snapshot did not attribute to the run. A host/user who needs certainty for such a Run confirms it (release 3).
