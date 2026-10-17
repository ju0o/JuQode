# Claude Code launch contract (V1-201 input) — what is known before launch, what is not

Source: H3 Live Probe, Claude Code 2.1.283 (Evidence `g1-claude-h3-live-2026-10-17`, `44ca8a4`). Code: `app/main/provider/claude-contract.js`, `identity.js`; wired in `claude/session.js::run`.
Status: pre-launch checks and fixtures only. This is **not** V1-207 (Adapter) and not a safety certificate.

| Topic | Rule | Basis |
| --- | --- | --- |
| argv | built in one place (`buildArgs`): same shape as before; unscoped grants (`Edit`, `Edit(*)`, comma lists), option-looking session ids and permission-removing options (`--sandbox danger-full-access`, `-a never`, `--permission-mode bypassPermissions\|acceptEdits\|auto`, `-c approval_policy=never`, `--*dangerously*`) are refused before a process exists | measured grant injection; split-argument forms |
| restricted tools | `--tools X` always goes with `--strict-mcp-config` | `--tools ""` alone left 19 claude.ai connector tools exposed; with strict MCP `init.tools` was `[]` |
| binary | the executed path must be the recorded one; sha256 and version are re-read immediately before launch (`preflight`) | no drift observed (2.1.283, same sha) |
| hooks | **UNKNOWN before launch.** User SessionStart hooks started before the `init` event in every call; reading `init` cannot stop them. JuQode neither disables nor edits them | probe events: `hook_started` precede `init` |
| effective permissions | **UNKNOWN before launch** (user/project/managed rules are not resolved) | — |
| claim | `containment().attested` is always `false`. A caller that demands attestation for a privileged launch is refused (`safety-unattested`); the default keeps the user-approved scoped-grant flow unchanged | PM decision: refuse vs keep — see report |
| `--bare` | not used: documented to skip OAuth/keychain | `claude --help` |
| result | outcome comes from events + file hashes: a denial (`permission_denied`, `tool_result.is_error`, `result.permission_denials`, joined by `tool_use_id`) is `denied` even when `exit 0` and `subtype=success`; file effect `unobservable` ≠ `unchanged` | call 4 |
| edit rule | `Edit(path)` covers a `Write` only for the **same canonical file** and only as observed (`coveredByGrant`); no blanket Write≡Edit | call 3 vs call 4 |
| cwd | `init.cwd` follows the **caller's** cwd on `--resume`; the session's creation dir is not assumed | call 2 |
| model | requested alias (`sonnet`) is not the actual model (`init.model`) | init |
Fixtures: `tests/fixtures/claude-h3-live/` (reduced, redacted). Tests: `tests/claude-contract.test.js`.
