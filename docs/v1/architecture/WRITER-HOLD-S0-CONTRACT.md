# Writer Hold S0 contract

2026-10-22 · implementation candidate from `c48310c145b47e545efaa652fbbcd8f94c6bba25`.

## Safety rule

A Work whose result is `ended_unknown`, or a Quick Command that was cancelled, forcibly signalled, historically labelled stopped, or otherwise unresolved and is not provably read-only, keeps that project's automated Writer gate closed. The current runtime has no producer that proves termination of descendants which left the recorded process group/session/tree. An absent root PID, empty group/session, reused PID, complete snapshot, old user statement, old every-runner ACK, or user checkbox is not such proof.

There is no current user action or flag that releases this hold. `runner-liveness.holdReleased()` and the QC registry's compatibility `release()` return false. Existing Work ACK rows and QC ACK files remain readable and unchanged, but no longer authorize release. `acknowledgeAfterObservation` and `qc-ack-stopped` validate their existing bounded inputs and refuse without adding ACK evidence, a Run, a permission grant, an answer, or a process. No replacement attestation option or migration was added.

## Protected execution paths

| Entry point | Gate before side effects |
| --- | --- |
| Work start, with or without Task; direct `supervisor.start` | `supervisor.preflight` → unresolved Work lookup; legacy `allowUnknownWorkId` is ignored |
| Same-Task retry | old unknown source cannot be acknowledged; shared QC Writer gate remains required |
| Permission grant / input answer | `resumeRefusal` checks unresolved Work before session verification; IPC checks the same QC gate as start/retry before supervisor can record grant/answer |
| File-changing Quick Command (build/test/dev/deploy/commit) | `fileQcBlock` checks active Work, unresolved Work and QC holds before `beginQcRun` or spawn |
| App restart / QC restore | unknown and historical stopped rows rebuild holds regardless of any historical ACK file; rows/evidence remain unchanged and read errors remain fail-closed |
| Historical confirmation APIs | bounded validation remains; no record writer or release is called |

Naturally ended Work results and no-Stop QC success/failure retain their existing behavior. A Stop request or forced signal now yields unknown even when the root exits 0, Windows reports not-found, or an observed snapshot is empty. A handle already finished before any Stop was requested retains its natural result; a Stop which races the exit does not. Historical non-readonly stopped rows remain stopped in History but rebuild a Writer hold because their earlier classification did not prove whole-tree termination. Live preview server handling before Stop and fixed read-only qc.git.status retain their existing rules.

## What a user can do now

The Work/Task hold panels and QC hold panel state that whole-tree termination is unproven and there is no supported release in the current version. The ineffective stop-confirmation checkboxes and unknown-Run retry form are absent. QC **기록 다시 읽기** reads the current record only. Task details, recorded evidence, Change Reader and read-only commands stay available; independent safe projects retain their ordinary execution paths.

This is an application gate for JuQode's automated Writer entry points. It is not filesystem isolation: the existing unrestricted manual terminal remains unrestricted, and an escaped process can act outside the application's attributed project. No claim is made that every manual write or shared underlying directory is contained.

## Evidence and limits

- `tests/writer-s0-regression.test.js`: deterministic fake `/proc` contains a descendant outside the original pgrp/sid; the observer returns `NOT_OBSERVED_WITH_EVIDENCE`, while the confirmation must refuse. Historic Work ACKs, legacy source-id bypasses, direct start, permission/input, restart, no-new-row invariants, and an independently safe project's normal preflight are covered.
- `tests/writer-s0-qc-regression.test.js`: byte-preserved historic QC ACK, `observed-gone` followed by attempted registry release, and confirmation followed by Work/QC/permission/input denial with no new ACK or signal.
- Existing runner-liveness, writer-hold-paths, Task, QC, Stop-proof, restore, loop and permission suites retain their positive controls. Prior tests expecting user confirmation to release an unknown writer now assert the fail-closed contract instead of being skipped.
- Linux owned-process liveness/restart fixtures and deterministic process data are used. Windows-native/H1/H3 execution, Live Provider, auth/Hook, install, product migration, deployment and release are outside this validation.

The process observer remains informational and still reports its escaped-descendant limitation. Closing this limitation in a future version needs a real production ownership/termination mechanism and a new reviewed contract; a caller-supplied boolean or ACK is insufficient.

## Independent QA follow-up

The first candidate `3058ab533ccd0603ab5ff169f50c82c4b34d22a0` failed independent QA: a real Linux setsid descendant survived SIGTERM while QC was labelled stopped, and a following build created another Run/child. Historical stopped rows were also omitted by the safety query. The follow-up changes `stopper.classifyEnd`, the unresolved-row query and restore without rewriting historical rows/evidence. `tests/writer-s0-stop-regression.test.js` records six cancellation/signal/race cases plus natural no-Stop positive controls and unchanged historical stopped/read-only restoration. It was RED 1/8 on 3058 and GREEN 8/8 after the fix. Exact final-SHA independent QA is still required.

The tracked Visual harness checks that Work and QC confirmations refuse, retains their held records, and moves later execution scenarios into newly seeded synthetic Projects. Its `freshProject` setup was assert-checked for distinct Project IDs, no inherited Runs and unchanged historical unknown rows. Only syntax/setup checks were run by the Worker; the complete Electron Visual sequence remains NOT_PROVEN on this candidate.
