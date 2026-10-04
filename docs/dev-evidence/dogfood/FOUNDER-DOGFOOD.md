# Founder Dogfood — Project → Task → Run

Status: ready for Founder validation after Claude Code is signed in on the target machine. Builder verification does not count as Founder acceptance.

## Run checklist

1. Launch JuQode and open or create one disposable Project.
2. Create one Task with a concrete goal and at least one observable acceptance criterion; select it.
3. Start the Task Run through the existing Claude Code path.
4. Confirm the Run appears before execution finishes, then observe Claude's activity and final state.
5. Open Run History. Inspect the exact prompt/Context snapshot and its version; note that Claude has project-folder-wide filesystem access.
6. Inspect the Agent report, observed outcome, changed files, and test/evidence entries separately.
7. Review each acceptance criterion against its linked Evidence. If any criterion lacks evidence, confirm the Task remains UNVERIFIED rather than PASS.
8. Cause or choose a safe failed/insufficient attempt in the disposable Project. Record a retry reason and start another Run for the same Task.
9. Confirm Run #1 and Run #2 have distinct IDs, prompts/Context snapshots, results, and evidence; Run #1 did not change.
10. Restart JuQode, reopen the Project, and confirm Task and Run History persist without an automatic extra Run.
11. Confirm cancellation is reported as cancellation without implying file rollback. Confirm an interrupted/unknown Run is never restarted automatically; retry it only after the previous process is known absent and by explicit user action.

## Acceptance report

Report the Project and Task used, both Run IDs, whether each Run completed/failed/cancelled/unknown, what Context each received, changed files, observed test evidence, the criterion-by-criterion verdict, and whether history survived restart. Do not paste credentials, `.env` values, API keys, or private project content into the report.

Founder verdict: **pending**.
