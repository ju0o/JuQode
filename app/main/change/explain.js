'use strict';
/* WBS-26 · Change Groups — D-128 / REC-013, `19` §C5-X.
 *
 * A Change Group is an LLM-authored explanation of a diff JuQode already measured. `19` §C5-B
 * is explicit that an LLM may EXPLAIN a change and must never DEFINE one, so the split here is
 * deliberate and load-bearing:
 *
 *   `groupsFrom()`  a PURE function. It takes whatever the model said and the facts JuQode
 *                   holds, and returns groups that cannot contradict those facts. Every
 *                   acceptance row of WBS-26 is enforced here, where a test can reach it
 *                   without a CLI, a network, or a model.
 *   `explain()`     runs the read-only pass and persists what `groupsFrom` allowed.
 *
 * The three rules, from `21` WBS-26:
 *   ① 모든 change_group 이 실제 raw_diff 를 인용한다 — a group that cites a file this Work did
 *     not change cites nothing, and is not a group.
 *   ② `확인됨` 은 관측된 실행 결과가 있을 때만 — D-114. Without an observed `tool_result` in
 *     `work_signal`, NOTHING here can be 확인됨, whatever the model claimed.
 *   ③ 설명 실패 시 `설명 못함` 상태가 된다 — and no reason is invented for it.
 */
const { randomUUID } = require('node:crypto');
const repo = require('../db/repo.js');
const { KIND } = require('../work/reducer.js');
const session = require('../claude/session.js');

/* The explanation pass reads a diff we already hold. It is given no tools at all — it never
 * touches the project, so it cannot change what it is explaining and cannot trip a permission
 * prompt in the middle of a Work that has already ended. */
const NO_TOOLS = [];

/** How much patch text goes into one prompt. The head is already bounded at 256 KB per file. */
const PROMPT_BUDGET = 120 * 1024;

/* ─────────────────────────────── the pure part ─────────────────────────────── */

/**
 * Did this Work observe a run finish? `19` §C5-X ties 확인됨 to an observed test/run result in
 * `work_signal` — not to the model saying a test passed, and not to the exit code, which `07`
 * §8.1 measured as blind to both cancellation and refusal.
 *
 * @returns {{observed:boolean, sourceRef:string|null}}
 */
function observedRun(signals = []) {
  const results = signals.filter((s) => s.kind === KIND.TOOL_RESULT);
  if (!results.length) return { observed: false, sourceRef: null };
  return { observed: true, sourceRef: `signal:${results[results.length - 1].id ?? results.length}` };
}

/** The model may say anything; only these three words mean anything here (D-114). */
const CONFIDENCE = new Set(['confirmed', 'expected', 'unconfirmed']);

/**
 * Turn a model response into groups that cannot contradict the evidence.
 *
 * @param {unknown} response     the model's text, or already-parsed value
 * @param {object}  facts
 * @param {{id:string, file:string}[]} facts.diffs    the raw_diff rows this Work actually has
 * @param {object[]} facts.signals                    every persisted signal, in order
 * @returns {{groups:object[], downgraded:number, dropped:string[]}}
 */
function groupsFrom(response, { diffs = [], signals = [] } = {}) {
  const byFile = new Map(diffs.map((d) => [d.file, d.id]));
  const { observed, sourceRef } = observedRun(signals);

  const parsed = parse(response);
  const groups = [];
  const claimed = new Set();
  const dropped = [];
  let downgraded = 0;

  for (const raw of Array.isArray(parsed) ? parsed : []) {
    if (!raw || typeof raw !== 'object') continue;

    /* ① A group cites raw_diff rows. A cited file this Work did not change is not evidence —
     * it is the model naming something that is not there, so it is removed. And a file already
     * owned by an earlier group stays with that group: `20` gives a diff exactly one owner
     * (D-121, `code_block.raw_diff_id on delete restrict`). */
    const files = [];
    for (const f of Array.isArray(raw.files) ? raw.files : []) {
      const id = byFile.get(String(f));
      if (!id) { dropped.push(String(f)); continue; }
      if (claimed.has(id)) continue;
      files.push(id);
    }
    if (!files.length) continue;                    // cites nothing → not a group
    for (const id of files) claimed.add(id);

    /* ② 확인됨 survives ONLY with an observed run behind it. This is the whole point of the
     * module: the model is the one party here with no way to check itself. */
    let confidence = CONFIDENCE.has(raw.confidence) ? raw.confidence : 'expected';
    if (confidence === 'confirmed' && !observed) { confidence = 'expected'; downgraded += 1; }

    groups.push({
      ord: groups.length,
      title: text(raw.title) ?? fileTitle(files, diffs),
      what: text(raw.what),
      why: text(raw.why),
      affects: text(raw.affects),
      confidence,
      sourceRef: confidence === 'confirmed' ? sourceRef : null,
      explainable: true,
      files,
    });
  }

  /* ③ Everything the pass did not explain — because it refused, failed, returned nothing, or
   * simply skipped a file. `설명 못함` is a STATE, and it carries no `why`: a reason invented
   * for a failure to explain is the same overclaim the confidence rule exists to stop. */
  const unexplained = diffs.filter((d) => !claimed.has(d.id));
  if (unexplained.length) {
    groups.push({
      ord: groups.length,
      title: fileTitle(unexplained.map((d) => d.id), diffs),
      what: null, why: null, affects: null,
      confidence: null,
      sourceRef: null,
      explainable: false,
      files: unexplained.map((d) => d.id),
    });
  }

  return { groups, downgraded, dropped };
}

/**
 * The model's text is not JSON just because we asked for JSON. A fenced block, a preamble and a
 * flat refusal all arrive here, and none of them is an error — they are all `설명 못함`.
 */
function parse(response) {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object') return response.groups ?? null;
  const s = String(response ?? '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

const text = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

/** A title made of the file names is a FACT. A title invented for a file is not. */
function fileTitle(ids, diffs) {
  const names = ids.map((id) => diffs.find((d) => d.id === id)?.file).filter(Boolean);
  if (names.length <= 2) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} 외 ${names.length - 2}개`;
}

/* ─────────────────────────────── the impure part ─────────────────────────────── */

/**
 * `19` §C5-X's prompt. It hands over the diff JuQode itself generated at a fixed `-U3` rather
 * than letting the pass read the project: the Work has ended, and a reader that can edit what
 * it is describing is not a reader.
 */
function promptFor(diffs) {
  const parts = [];
  let used = 0;
  for (const d of diffs) {
    const body = d.displayable ? d.patch : '(표시할 수 없는 변경)';
    const chunk = `--- ${d.file}\n${body}\n`;
    if (used + chunk.length > PROMPT_BUDGET) { parts.push(`--- ${d.file}\n(생략됨)\n`); continue; }
    used += chunk.length;
    parts.push(chunk);
  }
  return [
    '아래는 이미 끝난 작업이 만든 변경입니다. 읽고 설명만 하세요. 파일을 고치지 마세요.',
    '',
    '변경을 의미 단위로 묶어서 JSON 배열 하나로만 답하세요. 다른 말은 쓰지 마세요.',
    '각 항목: {"title","what","why","affects","confidence","files"}',
    '  files      — 아래 파일 경로 중에서만 고르세요. 목록에 없는 경로는 쓰지 마세요.',
    '  confidence — "confirmed" 는 이 작업에서 실제로 실행된 테스트/명령의 결과로 확인된 것만.',
    '               그 외에는 전부 "expected". 확신이 없으면 "expected".',
    '설명할 수 없으면 그 파일을 빼세요. 이유를 지어내지 마세요.',
    '',
    ...parts,
  ].join('\n');
}

/**
 * Run the explanation pass and persist what survived validation.
 *
 * The pass failing is not an error condition — `21` WBS-26 says an unexplainable group becomes
 * `설명 못함` with routes down, so a refusal, a crash and a timeout all land in the same place
 * as a model that simply skipped a file.
 *
 * @returns {{ok:boolean, groups:object[], downgraded:number, dropped:string[], reason:string|null}}
 */
async function explain(db, workId, { bin, cwd, timeoutMs = 120000 } = {}) {
  const diffs = repo.diffsFor(db, workId).map((d) => ({ ...d, id: d.id }));
  if (!diffs.length) return { ok: true, groups: [], downgraded: 0, dropped: [], reason: 'no-changes' };

  const signals = repo.signalsFor(db, workId);

  let answer = null;
  let reason = null;
  try {
    const r = await session.run({
      cwd, bin, prompt: promptFor(diffs), allowedTools: NO_TOOLS, timeoutMs,
      sessionId: randomUUID(),
      onSignal: (sig) => {
        if (sig.kind === KIND.FINISH) answer = sig.payload?.text ?? answer;
      },
    });
    if (!r.sawEvent) reason = 'no-response';
  } catch (e) {
    reason = 'pass-failed';
  }

  /* `groupsFrom` is called with whatever came back — including nothing. That is what makes
   * 설명 못함 a normal outcome of this function rather than an exception nobody handles. */
  const { groups, downgraded, dropped } = groupsFrom(answer, { diffs, signals });
  repo.saveChangeGroups(db, workId, groups);
  return { ok: true, groups, downgraded, dropped, reason };
}

module.exports = { explain, groupsFrom, observedRun, promptFor, PROMPT_BUDGET };
