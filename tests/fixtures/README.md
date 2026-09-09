# Recorded Claude Code streams

`stream-permission-denied.ndjson` is a REAL `claude -p --output-format stream-json --verbose`
run, recorded 2026-09-09 against CLI 2.1.266 in a disposable scratch git repository created
under `/tmp` for the purpose. The project repository was never involved.

The only edit is the working directory, rewritten to `/fixture/proj` so the fixture does not
depend on the machine that recorded it. Nothing else is changed — the point of a recording is
that it is what the CLI actually emitted.

It is the D-133 evidence in stream form: a `system/permission_denied` for `Edit`, the
`tool_result` carrying `is_error: true`, and a `result` that reports `is_error: false` while
listing the denial in `permission_denials[]` **with the `tool_input` that was refused**. That
last field is what makes a narrowly-scoped retry possible, and it is why a denial can never be
detected from the exit code.
