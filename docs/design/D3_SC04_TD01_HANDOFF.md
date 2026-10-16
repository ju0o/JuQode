# D3 hand-off — SC-04 and TD-01 design (document only; nothing here is implemented)

Status: **proposal for PM review.** No code for SC-04 or TD-01 changed in the SC-03 D2 batch. Reuse, do not re-invent:
`path-view.mjs` (names first, `raw` untouched, token masking), `file-summary.js` (chips + "전체 경로 보기" + copy of the stored path),
Typography tokens from `design/tokens.css` (`--fs-caption` 12px minimum, body 15px, no positive tracking on Korean), the **fold pattern** used on
SC-02/SC-03 (`details.result-fold`: present, one click away, never the first reading), and the *one emphasised next action* rule (≤ 1 `.btn.pri`).

## What SC-03 D2 settled (carry over)
1. Reading order: **result → what changed (names, count) → one next action → folded record.**
2. Anything that is *a state the user must act on or must not miss* (permission waiting, input waiting, failed, unknown / cannot confirm stop) is **never folded**.
3. Raw provider keys (`signals:tool_result`, `claude:result`) and exact stored paths stay stored and reachable, but only inside a fold (the key two folds deep).
4. A test is never called passing unless an exit code was **observed**; "returned without exit code" is stated as such.
5. Names never imply meaning (no "config"/"source" labels from a file name).

## SC-04 — 변경 읽기: 변경 요약 → 파일 목록 → 코드 → Raw Diff
Today (`sc04.js`): header, `groupColumn` (change groups), `blockColumn` (explained blocks), `rawColumn` (raw diff) are three equal columns, so the Raw Diff competes with the explanation.

| Layer | Content | Visible by default |
|---|---|---|
| 1. 변경 요약 | One sentence of what was observed + counts (files, groups, +/- lines if known). Evidence-gap card (`hasEvidenceGap`) stays here, unfolded. | yes |
| 2. 파일 목록 | `presentFiles()` chips; selecting a file/group selects it in layer 3. Collision hints from `path-view`. "전체 경로 보기" + copy exact path. | yes |
| 3. 코드 | The selected group's explained blocks (existing `blockColumn`). | yes, for the selected group only |
| 4. Raw Diff | Existing `rawColumn`, byte-for-byte. | **folded** ("Raw Diff 보기"), opens beside (≥ 1200) or below (< 1200) |

Rules: keep the 6-column-free layout of D1.1 (880 → single column, group list becomes a select-style list above the code); selection survives fold/unfold and
reader ↔ board navigation; `원하던 결과가 아니에요` (`unwantedPanel`, `readMore:false`) stays reachable without scrolling; no summary sentence is generated from file names.

Acceptance (CDP, real Electron, H3 WSLg): 880/1024/1200/1440 × light/dark; overflowX = 0; text ≥ 12px; Raw Diff text absent from visible text until opened; selected group keeps focus after fold toggle; Esc closes the Raw Diff fold when focus is inside it.

## TD-01 — 터미널 드로어: 명령 입력 → 실행 결과 → 안전 안내 → 세부 출력
Today (`td01.js`): `qcRegion` (Quick Command input + route/run/discover cards) and `termRegion` (shell line, limits banner, run card) stack inside one drawer; the limits banner and details compete with the result.

| Layer | Content | Visible by default |
|---|---|---|
| 1. 명령 입력 | One input (Quick Command) with the shell line as the secondary mode; focus stays here after a run. | yes |
| 2. 실행 결과 | State (ok / failed / stopped / **unknown**) + exit code *as observed* + the last lines. `unknown` ("끝났는지 확인할 수 없어요") is never folded and never rewritten as failed/stopped. | yes |
| 3. 안전 안내 | Why a command is unavailable / what the shell line cannot do (`term-limits`); the non-closable banner remains, but compact (one line, link to the full text). | compact |
| 4. 세부 출력 | Full masked output, stop evidence (`qc-stop/<run>.json`: taskkill status, snapshot, descendants, observed exit), command argv. | **folded** |

Rules: Stop is a request, not a result — the card says "멈추기를 요청했어요" until a stop is *observed*; an uncertain Stop shows the Writer-gate sentence (`prior-run-unknown`) next to the
unavailable file-changing commands; paths in output are masked for display only (`maskForDisplay`), the copy action copies the stored text.

Acceptance: drawer at 880 / 1024 / 1440 (light/dark) — result visible without scrolling after a run; 세부 출력 closed by default and keyboard-openable; no horizontal scroll with a 200-char output line; focus returns to the input after Esc.

## Suggested order
1. SC-04 (reuses `file-summary.js` and the fold CSS directly) → 2. TD-01 → 3. SC-01/brief density pass. Each as its own Batch with a Before/After from the same matrix helper (`sc03Matrix` in `tests/e2e/visual.mjs`, generalise to `screenMatrix(tag, selector)`).

---

# Addendum (D2.1) — SC-04 implementation scope, confirmed against the current code

Status: **proposal for PM; nothing below is implemented.** TD-01 stays a separate later Batch.

## What exists (`app/renderer/screens/sc04.js`, 438 lines; `sc04.css`, 131)
Header (Work name + outcome chip) → orientation line → **three equal columns** `groupColumn` (one card per Change Group: title, confidence chip, 왜/무엇/… fields, `Raw Diff 보기`, a `파일 N · a · b · c` mono line) | `blockColumn` (per file: mono path, Code Blocks as buttons, `Raw Diff 보기`) | `rawColumn` (patches in `<pre>`, copy, scope note) → evidence-gap card (`.sc04-gap`, mono `a · b · c`) → next actions (`이해했어요`, `원하던 결과가 아니에요` → `unwantedPanel`, which owns 되돌리기).
Empty/unknown/refused states: `reader.none`, `readerUnknown` (+ `readerUnknownFiles(join(' · '))`), `readerUnavailable`.

## Scope for the SC-04 Batch (in this order)
1. **관측된 변경 요약** (new top card, no new data): counts from `reader` (files, groups) + the outcome already in the header; `changedFilesState()` semantics apply (zero / unknown / missing stay different sentences; the unknown-remainder card stays unfolded and dashed). No sentence derived from file names.
2. **변경된 파일 목록**: `presentFiles()` chips (same-name folder hint, masked display, exact stored path on "전체 경로 보기" + copy) replace the three `join(' · ')` mono lines (group card, `readerUnknownFiles`, evidence-gap `paths`). The group list becomes the selector; selection state `state.readerGroup` is kept.
3. **선택한 변경의 코드**: `blockColumn` for the selected group only, as the main column. D-118 stays true: a group/file with no Code Block (단위화 불가, 설명 불가, binary) must still reach Raw in one step — when a file has no blocks its Raw is shown directly (existing behaviour, keep + test).
4. **Raw Diff, on request**: `rawColumn` becomes a fold (`details.result-fold` pattern) closed by default; `Raw Diff 보기` on a group/block opens it and scrolls it into view (existing `state.readerRaw` flag). Patch text, truncation notice (`readerTruncated`), copy-of-stored-text and the `scoped` note unchanged.
Layout: ≥ 1200 summary + list left, code right, Raw below the code (full width); < 1200 one column in that order. Fonts ≥ 12 px; chips wrap (D2.1 rule).

## Must be preserved (acceptance, not options)
- Original evidence: `raw_diff`, change groups, `sourceRef`s are read-only inputs; **no migration, no rewrite**; no data is dropped from the Raw view.
- Unmeasured remainder (`changes-unknown`, evidence gap, `reader.unknown`): never folded, never green, never "변경 없음".
- 되돌리기/`원하던 결과가 아니에요`: `unwantedPanel(..., {readMore:false})` stays on the page without scrolling past Raw; its two-step confirm and `revertLimits` text untouched.
- Exit/Back: `작업으로 돌아가기`, `이해했어요` (focus returns to the request field), terminal toggle.

## Tests the Batch must bring
Unit: source scan that SC-04 prints files via `presentFiles` only; a Raw-only path exists for each of 단위화 불가 / 설명 불가 / binary.
Real screen (`screenMatrix`, generalised from `sc03Matrix`): 880/1024/1200/1440 × light/dark × {explained group, 단위화 불가, binary, unknown remainder, evidence gap}: overflow 0, text ≥ 12 px, Raw text absent from the visible text until opened, selected group keeps focus after fold toggle, Tab order summary → list → code → Raw → actions; H3 WSLg visible run + ASUS Xvfb; Before/After in a new Private evidence directory.

---

# Addendum (D3 / SC-04 done) — TD-01 implementation scope, confirmed against `td01.js` (643 lines)

Status: **proposal; not implemented.** SC-04 shipped in `d32c1ca` (summary → names → selected code → Raw on request); this is the next Batch.

## What exists
`mountDrawer` → `renderDrawer`: a non-closable banner, then two stacked regions. `qcRegion`: label + hint, the Quick Command input, then ONE of `routeCard` (what the phrase meant, before running), `runCard` (state chip + command + exit code + last 3 output lines + 더 보기), `discoverCard` (every rule with its reason). `termRegion`: label, `term-limits` line (no TTY / no colour), output box, `$` input.
Facts already true and to keep: `unknown` is shown as 확인 불가 and is never rewritten; Stop is a request (`stopped-requested` chip) until observed; masked output; the shell line is the one place that runs what the user typed.

## Scope (in this order)
1. **명령 입력** — the two inputs stay put and focus returns to the one just used after a run / Esc. The Quick Command input is primary; the shell line is secondary (collapsed to one row until focused).
2. **실행 결과** — `runCard` leads with the state chip, the observed exit code (never inferred), a one-line "what ran" (rule name; the argv is detail) and the last lines of output. `unknown` / uncertain-Stop and the restore-failure / hold panel (`qc-hold`, per-run confirmation) are never folded and stay dashed, never red/green.
3. **안전 안내** — the limits banner and `term-limits` become ONE compact line (full text on demand); the Writer-gate sentences (`prior-run-unknown`, `qc-restore-failed`, `qc-writer-running`) sit next to the commands they block.
4. **세부 출력** — full masked output, the argv, Stop evidence (taskkill status, snapshot, survivors, timings) and `이 Run의 확인 기록` folded behind one control (`details`), closed by default, keyboard-openable; paths in output masked for display only.

## Must be preserved
Output text is bytes the program wrote (masked only for tokens); copy copies the stored text; no new outcome enum; Stop semantics and the hold/ack records of the P0 work; the terminal toggle on every screen; the drawer's per-project lifetime.

## Tests the Batch must bring
`screenMatrix` on the real drawer (synthetic runs through the real renderer, as SC-04 D3 did): 880/1024/1200/1440 × light/dark × {ok, failed, stopped-requested, stopped, unknown, running dev server, unavailable rule, hold panel, restore failure}: no sideways scroll, text ≥ 12 px, 150 % zoom, real Tab order input → result → safety → details, Esc/focus return, long Korean command and 200-char output line; H3 WSLg visible run + ASUS Xvfb; Before/After in a new Private evidence directory.
