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

## Update (scoped retry + launch preflight wired)
**Scoped retry (`work/supervisor.js::allow/runRetry`)** — the argv that reaches the process, e.g. `--resume <id> -p --output-format stream-json --verbose --allowedTools Edit(a.txt) --tools Read,Edit --strict-mcp-config`.
`--allowedTools` only pre-approves; it does not remove tools. The retry's whole surface is the denied tool plus `Read`; all other built-ins and all connector (MCP) tools are off. A denied tool that cannot be confined (a connector tool, `WebFetch`, …) is not retried (`cannot-scope-tool-surface`).
**Launch checks (`session.run` → `preflightLaunch`)**, no process on refusal, adjacent to the spawn: argv rules · absolute real binary · sha256 against the identity recorded when the Work started (cached per file fingerprint) · version the process reports in `init` against the start (checked after the fact) · mode.
Callers that record state (`allow`) run `session.preflightRun` first, so a refused launch records no grant and does not move the Work.
**Recorded identity**: kept in the live Work entry (like the existing stat binding) and the per-retry `juqodeRetryAudit` signal. The Work table has no binary columns; a durable identity needs schema 15 — not done.
**Audit after the run** (`juqodeRetryAudit` signal; detection, never prevention): exposed connector tool · built-in tool beyond the retry surface · file write that ran outside the granted canonical file (symlink redirection and unresolvable paths do not count as covered) · init version differing from the start → the Work ends `ended_unknown` (`retry-surface-violation`).

| Mode | Privileged launch (granted write, or the default tool set) | Label |
| --- | --- | --- |
| `dev-compat` (default; env `JUQODE_EXECUTION_MODE` or `executionMode`) | allowed | `dev-compat-unattested` — never shown as safe |
| `v1-protected`, and any other value | **refused** `safety-unattested`; read-only tool sets (`--tools Read`) pass | `v1-protected-unprivileged` |

**Why attestation cannot be satisfied with this CLI (2.1.283)**: (1) hooks come from user/project/local/managed settings and plugins and start before `init`; `claude --help` offers no way to list the effective set before launch; (2) effective allow/deny/ask rules merge from the same sources — no query command; (3) `--setting-sources` narrows user/project/local only, cannot cover managed policy or plugin hooks, and its effect on hooks is unmeasured (needs a model call); (4) `--bare` skips hooks but never reads OAuth/keychain — it breaks the subscription login path (API key only).
Limits that remain: Node cannot exec by file descriptor, so a swap between the hash check and the exec is not excluded (checked immediately before, adjacent statements; the reported version is compared afterwards). `answer()` (user text, default tool set) is a resume with no tool restriction: it is `dev-compat` only.
