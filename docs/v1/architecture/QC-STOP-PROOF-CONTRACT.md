# Quick Command Stop proof — automatic release contract (LIMITED)

Scope: Windows hosts (H1). A Quick Command run that ended `unknown` holds the Writer gate (`prior-run-unknown`) until it is released.

## Policy (PM decision, issue #15): the user releases; no snapshot ever does
An `unknown` Quick Command run that is not provably read-only (only the fixed `qc.git.status` with a recorded start) holds the Writer gate until the
user confirms **that Run** (`qc/ack.js`: audit record matched against the run row; the digest is integrity, not authorship).
- `qc/stop-proof.js::validate` only classifies the Stop record (complete and agreeing with the row, or not). A complete record is held as `ownership-unproven`;
  an incomplete/contradictory/unreadable one as `evidence-incomplete`/`evidence-unreadable`; a run that never finished as `never-finished`. None releases.
- `qc/uncertain.js::recheck` still takes snapshots (identified members + dead root as parent) but only **records** `observed-gone`/`observed-alive` for the user to read.
- A Stop that ended `stopped` (kill tool succeeded, observed tree gone, exit not 0-contradicting) is a different result and is not an `unknown` hold.
- The Stop result and the user's confirmation are separate records (`qc-stop/<run>.json` vs `qc-ack/<run>.json`); neither rewrites the run row or its evidence.

## Structural limit (LIMITED, measured on H1 by `tests/qc-orphans-real.test.js`)
Windows keeps no job/ownership link for a process whose parent already exited. A grandchild orphaned **before** the Stop's snapshot has a dead parent
pid and is not found by pid/creation-time/parent matching. An observation of "everything the Stop could see is gone" is therefore never taken as "no process of this run exists". Complete ownership needs a Windows Job Object, which Node cannot create without a native addon (not installed; PM decision).
Nothing signals a process the snapshot did not attribute to the run. The user confirms such a Run.
