# DG-04 — Green baseline QA

Date: 2026-10-04
Status: PASS on ju0o Linux x86_64
Scope: first approved Builder batch; JuQode only. Dios and GitHub untouched.

## Root causes and fixes

1. Renderer exposed openExternal through preload and IPC. This was the only caller for the SC-01 Claude install advisory. The PM ruling excludes external navigation from first dogfood. Removed the capability/handler and advisory card; the existing SC-02 Claude-unavailable path remains available after a submission attempt. No replacement install feature was added.
2. SC-02 sent unrecognized requests through an unapproved passthrough card. Local Canon provides intent.routeUnrec. The screen now displays that Canon line, retains the request for editing, and starts no Work. Removed non-Canon passthrough strings and their card.
3. intent.routeUnrec was a declared but unused copy key. The canonical branch now uses it. Other stale keys for removed surfaces were deleted; intent.rephrase stays because the ambiguity card uses it.
4. Visual E2E assumed a free default CDP port. Added a test-only port-block allocator that finds three consecutive available ports. This run skipped the busy default block and used 9225-9227. No golden files were updated.

## Files changed

- app/main/ipc.js
- app/preload/preload.js
- app/renderer/copy.js
- app/renderer/screens/sc01.js
- app/renderer/screens/sc02.js
- tests/e2e/visual.mjs
- tests/e2e/port-block.mjs
- tests/visual-ports.test.js

## Fresh verification

| Command | Result |
|---|---|
| npm run test:unit | PASS, exit 0; 599/599; TAP 20.468s; ERD 49 tables / 49 relations / MVP 26-table comparison pass |
| node tests/e2e/boot.test.mjs | PASS, exit 0; 3 runs; 1 window each; external requests 0; load 370/376/379ms |
| node tests/e2e/visual.mjs | PASS, exit 0; used CDP ports 9225-9227; unrecognized-request assertion passed; screenshots only in ignored tmp-visual |
| node tests/e2e/offline-shutdown.mjs | PASS, exit 0; external requests 0; graceful shutdown left 0 processes |
| checkout Electron process count | 0 after visual and offline shutdown |
| node --test tests/visual-ports.test.js | PASS, 2/2; blocked-port simulation and real occupied-port probe |
| git diff --check | PASS |

## Adversarial checks

Source guards were challenged in disposable copies outside the repository:
- injected forbidden openExternal capability: capability-containment test failed as expected.
- injected non-Canon Korean copy: Canon provenance test failed as expected.
- injected unused copy key: dead-copy test failed as expected.
- occupied preferred CDP port: allocator selected another full block; both allocator tests passed.

The visual E2E also verifies an unrecognized npm install phrase stays in the input, creates no Work/history entry, renders the Canon line, and offers no send button.

## Remaining boundary

This is Linux evidence only. Windows process/build and real Claude dogfood remain unverified. The optional SC-01 install link was removed; missing Claude is still reported through the existing SC-02 unavailable flow after a request is attempted.
