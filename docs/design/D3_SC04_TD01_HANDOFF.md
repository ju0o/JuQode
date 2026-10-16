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
