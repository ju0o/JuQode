# Recorded Claude Code streams

`stream-permission-denied.ndjson` is a REAL `claude -p --output-format stream-json --verbose`
run, recorded 2026-09-09 against CLI 2.1.266 in a disposable scratch git repository created
under `/tmp` for the purpose. The project repository was never involved.

Three fields are rewritten so the fixture does not depend on — or publish — the machine that
recorded it. Nothing else is changed; the point of a recording is that it is what the CLI
actually emitted.

| field | rewritten to | why |
|---|---|---|
| `system/init` `cwd` | `/fixture/proj` | the recording repo was a throwaway under `/tmp` |
| `system/init` `plugins[].path` | `/fixture/plugins/<name>/<version>` | carried the recorder's home directory |
| `system/init` `memory_paths.auto` | `/fixture/memory/` | same |

The last two were found by `tests/harness.test.js`, which asserts that no fixture contains a
real home directory — and this note used to say the cwd was the only edit, which was not true.
None of the three fields is read by the reducer (`session_id`, `cwd` and `claude_code_version`
are), so the replayed state sequence is byte-identical before and after; that was measured
rather than assumed.

It is the D-133 evidence in stream form: a `system/permission_denied` for `Edit`, the
`tool_result` carrying `is_error: true`, and a `result` that reports `is_error: false` while
listing the denial in `permission_denials[]` **with the `tool_input` that was refused**. That
last field is what makes a narrowly-scoped retry possible, and it is why a denial can never be
detected from the exit code.
