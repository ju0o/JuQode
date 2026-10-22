# Quick Command Stop proof and Writer Hold

2026-10-22 · current candidate policy. See [Writer Hold S0 contract](WRITER-HOLD-S0-CONTRACT.md) for all automated execution paths.

An unresolved Quick Command that is not provably read-only (only fixed `qc.git.status` with its recorded start) keeps the project's Writer gate closed. Current process snapshots cannot exclude descendants that escaped the recorded tree. Neither a complete snapshot, observed absence, a user's statement, an old ACK file nor the registry's compatibility `release()` authorizes release.

`qc/stop-proof.js::validate` classifies the recorded Stop evidence; it does not establish whole-tree ownership. Complete-but-unproven records remain `ownership-unproven`, incomplete or unreadable records remain held, and a run nobody saw finish remains `never-finished`. `qc/uncertain.js::recheck` records `observed-gone` / `observed-alive` as information only. Restore ignores historical ACKs as release authority while preserving their bytes. `qc-ack-stopped` preserves its input validation and appends no ACK or release. The QC panel offers record refresh, not a confirmation checkbox.

A Stop request, forced signal or Stop/exit race now remains unknown: a root signal, exit 0, not-found response or empty snapshot cannot prove all escaped descendants stopped. Natural no-Stop success/failure remains unchanged. Historical non-readonly stopped rows retain their original status/evidence but are included in hold restoration; their old classification is not trusted as ownership proof. Past Run rows and Stop evidence are never rewritten by this change. Existing low-level ACK verification/storage helpers remain for historical compatibility tests, with no product path that uses them to release a hold.

Windows can lose ownership links when parents exit before a snapshot; Linux descendants can leave the original group/session using setsid/daemonization. The current runtime has no complete ownership mechanism for either case. Windows-native execution was not performed in this cycle. No new native dependency, install, job/cgroup mechanism or attestation flag is introduced.
