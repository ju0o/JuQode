Synthetic minimal fixtures reduced from the Founder-approved H3 Live Probe (Claude Code 2.1.283, Evidence `44ca8a4`, `g1-claude-h3-live-2026-10-17/events/`).
Kept: event order, ids, tool names/inputs, permission/denial events, result fields. Dropped/redacted: scratch paths (`/scratch`), plugin and socket paths, hook output text, usage and rate-limit details.
call1 new --session-id (cwd dirA) · call2 --resume from another cwd (dirB) · call3 Edit(hello.txt) allowed, Write(hello.txt) ran · call4 Write(other.txt) denied (result still `success`, exit 0).
call1/call2 `--tools ""` (call1 without strict MCP: 19 connector tools exposed; call2 with `--strict-mcp-config`: none). Requested model alias `sonnet`; actual init model `claude-sonnet-5`.
