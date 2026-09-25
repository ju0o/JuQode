# JuQode

> **Developers code. Vibe coders Qode.**

JuQode is a desktop workspace for people who build software with Claude Code but do not want to understand every task through raw terminal output and diffs.

It reads a project, lets you ask for changes in natural language, follows the work as cards, and explains the resulting code changes at a more understandable level.

**[Try the browser demo →](https://ju0o.github.io/JuQode/)**  
No installation, Claude Code account, or Windows setup is required for the clickable demo.

## What JuQode does

### Understand the project
JuQode inspects the selected project and surfaces evidence-backed answers about what it is, how it is structured, and where important behavior lives.

### Ask for work naturally
Describe the change you want instead of manually building an agent command sequence.

### Follow work as cards
See the current task, completed steps, blocked actions, and what happens next without reading the full agent transcript.

### Keep permission decisions with the user
JuQode does not silently approve Claude Code permissions. A blocked permission arrives as a visible state and the user decides whether to continue.

### Read changes before raw diffs
Code changes are grouped into meaningful blocks with explanation first and raw diff still available when needed.

### Run bounded quick commands
A small rule-based natural-language command layer handles supported actions using an explain → confirm flow rather than guessing unknown commands.

## Download

### Windows demo build

**[JuQode 0.1.0 x64](https://github.com/ju0o/JuQode/releases/download/demo-v0.1/JuQode-0.1.0-x64.exe)**

A SHA-256 checksum is available with the release artifact.

> The demo build is unsigned, so Windows SmartScreen may display a warning.

### Requirement

JuQode currently acts as a layer on top of an existing **Claude Code CLI** installation. Install and sign in to Claude Code before using the desktop build.

## Demo video

[![JuQode demo](docs/dev-evidence/demo/preview.gif)](https://youtu.be/0wTQGH99Hxs)

**[Watch the full 1m 22s demo →](https://youtu.be/0wTQGH99Hxs)**

The demo shows the actual Electron UI driven by the same fixture used by the end-to-end test path.

## MVP capabilities

| Capability | Purpose |
|---|---|
| **Project Interpretation** | Explain the project using evidence from real files. |
| **Work Stream + History** | Follow past, current, and next work as cards. |
| **Claude Code integration** | Run one supported coding-agent runtime with visible permission boundaries. |
| **Natural-language Quick Commands** | Execute a bounded set of deterministic commands after confirmation. |
| **Code Change Reader** | Explain meaningful changed blocks before exposing the raw diff. |
| **Minimal Terminal** | Keep a terminal available without making it the primary interface. |

## Run from source

```bash
git clone https://github.com/ju0o/JuQode.git
cd JuQode
npm ci
npm start
```

Run the test suite:

```bash
npm test
```

Re-record the demo fixture:

```bash
npm run demo
```

## Project structure

```text
app/main/          Electron main process and core features
app/renderer/      desktop UI
docs/design/       public design and architecture material
docs/dev-evidence/ QA evidence and screenshots
scripts/demo/      reproducible demo recorder
tests/             unit and end-to-end tests
```

## Product principles

- Do not silently approve permissions.
- Do not invent answers when evidence is missing.
- Do not guess unsupported quick commands.
- Keep raw technical detail available without making it the default interface.
- Treat verification separately from an agent saying that work is complete.

## Status

**Public preview / active development.**

JuQode has a working desktop build and browser demo, but the project is still being hardened through Windows validation, real-user dogfooding, packaging, and usability testing before a stable V1 release.

## Platform

Current product focus: **Windows + Claude Code**.

Broader runtime and platform support should be treated as future work unless explicitly documented in a release.

## License

License information will be finalized before the first stable public release.
