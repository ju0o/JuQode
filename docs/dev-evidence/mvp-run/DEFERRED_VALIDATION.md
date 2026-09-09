# DEFERRED VALIDATION — TARGET WINDOWS

**This file is the standing debt ledger for the autonomous MVP run.**

Run state model (three values, no fourth):

| State | Meaning |
|---|---|
| `PASS` | implemented **and** validated on the target platform |
| `IMPLEMENTED_PENDING_VALIDATION` | implemented, tested on Linux, **target-OS evidence does not exist yet** |
| `BLOCKED` | cannot be implemented — architecture, contract, or dependency |

`IMPLEMENTED_PENDING_VALIDATION` is **not** `BLOCKED`. Nothing in this file stops
implementation work. Every entry is closed by one command on a Windows host —
`scripts/verify-windows.ps1` (see `docs/dev-evidence/wbs-01/WINDOWS-REQUIRED.md`).

Host this run executes on:

```
Linux ju0o 7.0.0-31-generic · Ubuntu 26.04.1 LTS · x86_64
no /proc/version microsoft · no /mnt/c · no wine   → not WSL, not Windows
```

Nothing below has been inferred from a Linux result. Where a Linux measurement
exists it is recorded as a Linux measurement and is **not** carried across.

## Entries

| # | Item | WBS | Canon reference | State | Closed by |
|---|---|---|---|---|---|
| DV-1 | Boot on Windows 10 (1809+) and Windows 11 | WBS-01 | `21` WBS-01 Acceptance · D-125 | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → boot ×5 |
| DV-2 | Measured startup time on the target OS (no invented budget) | WBS-01 · WBS-00 | `21` WBS-01 Acceptance | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → boot timings |
| DV-3 | NSIS installer installs and first run reaches SC-01 | WBS-33 | `21` WBS-33 Risks | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → packaging step |
| DV-4 | Packaged `.exe` actually launches (PE produced ≠ runs) | WBS-01 · WBS-33 | `19` §V packaging NOT VALIDATED | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → launch packaged exe |
| DV-5 | Code signing judged from the PE certificate table | WBS-33 | `19` §V signing NOT VALIDATED | IMPLEMENTED_PENDING_VALIDATION | `Get-AuthenticodeSignature` in the harness |
| DV-6 | ConPTY: create · output · resize · exit · cleanup | WBS-00 · WBS-25 | `19` §C6 PTY NOT VALIDATED | IMPLEMENTED_PENDING_VALIDATION | `scripts/windows-spikes.mjs` (refuses to run off win32) |
| DV-7 | Windows process spawn · cancel · process tree · orphans | WBS-00 · WBS-23 · WBS-24 | `19` §C4 | IMPLEMENTED_PENDING_VALIDATION | `scripts/windows-spikes.mjs` |
| DV-8 | Theme contrast, all six OS-preference × toggle combinations, on Windows | WBS-36 | `16` §2.1 · D-135 | IMPLEMENTED_PENDING_VALIDATION | `verify-windows.ps1` → theme matrix |
| DV-9 | Claude Code resolved from PATH on Windows (`claude.cmd`, PATHEXT, `cmd.exe` routing) | WBS-09 | `21` WBS-09 · D-125 | IMPLEMENTED_PENDING_VALIDATION | run the app on Windows with an npm-global Claude Code and confirm 설치되지 않음 is NOT reported |
| DV-10 | `fs.realpathSync.native` canonicalises CASE on NTFS, so one folder is one `project` row | WBS-02 · WBS-21 | `20` `project.path` unique | IMPLEMENTED_PENDING_VALIDATION | open the same folder twice on Windows with different casing; expect one row |

### Why DV-9 and DV-10 exist

Both were found by review, not by a test, and both are Windows-only by nature:

- **DV-9** — `execFile('claude', …)` spawns without a shell, and Windows `CreateProcess`
  appends only `.exe` while an npm-global Claude Code installs `claude.cmd`. The plain spawn
  would return `ENOENT`, which this code maps to `not-installed` — so an installed CLI would
  be reported as 설치되지 않음. `claude-detect.js` now walks `PATHEXT` explicitly and routes a
  `.cmd`/`.bat` through `cmd.exe` (Node refuses to spawn those directly since the
  CVE-2024-27980 mitigation). Every argument on that path is a compile-time constant, so
  there is no quoting hazard. **None of it has run on Windows.**
- **DV-10** — `fs.realpathSync` is Node's JS implementation and preserves the caller's case
  for non-link segments; only `fs.realpathSync.native` canonicalises. On NTFS
  `C:\Users\Bob\Proj` and `c:\users\bob\proj` are one folder but two strings, which would
  be two rows past `project.path`'s unique key. The code now calls `.native`. On Linux the
  two are genuinely different folders, so no test here can tell the difference.

## Rule this run follows

A WBS package whose only outstanding item is a DV entry is recorded
`IMPLEMENTED_PENDING_VALIDATION` and **the run continues**. A package is
`BLOCKED` only when the work itself cannot be done here — and that is stated with
the specific reason, never with "Windows".
