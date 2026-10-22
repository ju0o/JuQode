# Writer Hold S0 contract

2026-10-22 · implementation candidate from `c48310c145b47e545efaa652fbbcd8f94c6bba25`.

## Safety rule

A Work whose result is `ended_unknown`, or an unresolved Quick Command that is not provably read-only, keeps that project's automated Writer gate closed. The current runtime has no producer that proves termination of descendants which left the recorded process group/session/tree. An absent root PID, empty group/session, reused PID, complete snapshot, old user statement, old every-runner ACK, or user checkbox is not such proof.

There is no current user action or flag that releases this hold. `runner-liveness.holdReleased()` and the QC registry's compatibility `release()` return false. Existing Work ACK rows and QC ACK files remain readable and unchanged, but no longer authorize release. `acknowledgeAfterObservation` and `qc-ack-stopped` validate their existing bounded inputs and refuse without adding ACK evidence, a Run, a permission grant, an answer, or a process. No replacement attestation option or migration was added.

## Protected execution paths

| Entry point | Gate before side effects |
| --- | --- |
| Work start, with or without Task; direct `supervisor.start` | `supervisor.preflight` → unresolved Work lookup; legacy `allowUnknownWorkId` is ignored |
| Same-Task retry | old unknown source cannot be acknowledged; shared QC Writer gate remains required |
| Permission grant / input answer | `resumeRefusal` checks unresolved Work before session verification; IPC checks the same QC gate as start/retry before supervisor can record grant/answer |
| File-changing Quick Command (build/test/dev/deploy/commit) | `fileQcBlock` checks active Work, unresolved Work and QC holds before `beginQcRun` or spawn |
| App restart / QC restore | unresolved rows rebuild holds regardless of any historical ACK file; read errors remain fail-closed |
| Historical confirmation APIs | bounded validation remains; no record writer or release is called |

Normally ended Work results and QC results retain their existing behavior. A QC whose Stop already established the normal `stopped` result does not become an unknown hold. Live preview server handling and read-only fixed `qc.git.status` retain their existing rules. The change does not reclassify an unknown result as failed, stopped or complete.

## What a user can do now

The Work/Task hold panels and QC hold panel state that whole-tree termination is unproven and there is no supported release in the current version. The ineffective stop-confirmation checkboxes and unknown-Run retry form are absent. QC **기록 다시 읽기** reads the current record only. Task details, recorded evidence, Change Reader and read-only commands stay available; independent safe projects retain their ordinary execution paths.

This is an application gate for JuQode's automated Writer entry points. It is not filesystem isolation: the existing unrestricted manual terminal remains unrestricted, and an escaped process can act outside the application's attributed project. No claim is made that every manual write or shared underlying directory is contained.

## Evidence and limits

- `tests/writer-s0-regression.test.js`: deterministic fake `/proc` contains a descendant outside the original pgrp/sid; the observer returns `NOT_OBSERVED_WITH_EVIDENCE`, while the confirmation must refuse. Historic Work ACKs, legacy source-id bypasses, direct start, permission/input, restart, no-new-row invariants, and an independently safe project's normal preflight are covered.
- `tests/writer-s0-qc-regression.test.js`: byte-preserved historic QC ACK, `observed-gone` followed by attempted registry release, and confirmation followed by Work/QC/permission/input denial with no new ACK or signal.
- Existing runner-liveness, writer-hold-paths, Task, QC, Stop-proof, restore, loop and permission suites retain their positive controls. Prior tests expecting user confirmation to release an unknown writer now assert the fail-closed contract instead of being skipped.
- Linux owned-process liveness/restart fixtures and deterministic process data are used. Windows-native/H1/H3 execution, Live Provider, auth/Hook, install, product migration, deployment and release are outside this validation.

The process observer remains informational and still reports its escaped-descendant limitation. Closing this limitation in a future version needs a real production ownership/termination mechanism and a new reviewed contract; a caller-supplied boolean or ACK is insufficient.

## First-candidate QA boundary

The existing QC Stop classifier can still classify a signalled POSIX root or an empty Windows descendant snapshot as `stopped`. Whether an escaped descendant can survive while that status avoids the unknown hold remains **NOT_PROVEN** and is a required independent-QA check. Historical `stopped` rows are not covered by the unknown-only lookup in this first candidate. This candidate must not be reported as integration-safe until that boundary is resolved.

The tracked Visual harness now checks that unknown confirmation refuses and moves subsequent scenarios into newly seeded synthetic Projects. Its `freshProject` setup was assert-checked for distinct Project IDs, no inherited Runs and unchanged historical unknown rows. Only syntax/setup checks were run by the Worker; the complete Electron Visual sequence remains **NOT_PROVEN** on this candidate.
