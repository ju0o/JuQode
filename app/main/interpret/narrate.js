'use strict';
/* WBS-04 · the Brief's narrative layer — `19` §C1 ②, REC-008, D-114.
 *
 * The facts layer (WBS-03, `./answers.js`) answers three of the six questions from things it
 * MEASURED, and leaves ① 하는 일, ② 주요 기능 and ④ 폴더가 하는 일 at 확인 못함, because nothing
 * deterministic establishes what a project is FOR. This module asks Claude Code, once, read-only.
 *
 * The split is the same one `../change/explain.js` uses, for the same reason:
 *
 *   `merge()`    a PURE function. It takes the model's answers and the facts JuQode already
 *                holds, and returns six rows that cannot contradict them.
 *   `narrate()`  runs the pass and hands the merged rows back to the caller to persist.
 *
 * Three rules, and all three are about what the narrative layer may NOT do:
 *
 *   ① It may not overwrite a measured answer. `20` requires `source_ref` on every 확인됨 row and
 *      the facts layer supplies it; a model sentence has no business replacing a manifest.
 *   ② It may not BE 확인됨. `19` §C1 ① is explicit that only the facts layer's own output can
 *      be — and for the three questions this module answers, the facts layer measured nothing.
 *      An answer that cites a file the scan actually read is 예상됨; one that cites nothing, or
 *      cites a file nobody read, is 확인 못함.
 *   ③ Its failure is not the Brief's failure. `19` §C1 ⑥: 서술 실패 → 사실 층만으로 Brief(부분).
 *      A refusal, a crash, a timeout and silence all leave the facts exactly as they were.
 */
const { randomUUID } = require('node:crypto');
const session = require('../claude/session.js');
const { KIND } = require('../work/reducer.js');

/* The pass READS — and it is given the facts and the file list rather than the filesystem, so
 * `19` §C1 ④'s exclusions (`.env*`, `*.pem`, `*.key`, `node_modules`, `dist`, `.git`) hold by
 * construction instead of by hoping the model respects a sentence in a prompt. */
const NO_TOOLS = '';

/** `19` §C1 ③'s budget is the scan's; this bounds what the ANSWER may cost to ask about. */
const PROMPT_BUDGET = 60 * 1024;

/* The three the facts layer cannot answer. The others are measured, and stay measured. */
const NARRATIVE_Q = new Set([1, 2, 4]);

/**
 * Merge a model response into the deterministic answers.
 *
 * @param {unknown} response       the model's text, or an already-parsed value
 * @param {object}  facts
 * @param {object[]} facts.deterministic  the facts layer's six rows, in q order
 * @param {string[]} facts.readFiles      the files the scan actually opened
 * @returns {{answers:object[], filled:number, refused:string[], grounded:number}}
 */
function merge(response, { deterministic = [], readFiles = [] } = {}) {
  const read = new Set(readFiles);
  const said = new Map();
  for (const a of Array.isArray(parse(response)) ? parse(response) : []) {
    if (!a || typeof a !== 'object') continue;
    const q = Number(a.q);
    if (!Number.isInteger(q)) continue;
    if (!said.has(q)) said.set(q, a);          // first answer wins; a second is not more true
  }

  const refused = [];
  let filled = 0;
  let grounded = 0;

  const answers = deterministic.map((row) => {
    const a = said.get(row.q);
    if (!a) return row;

    /* ① A measured answer is never replaced. */
    if (row.confidence === 'confirmed') { refused.push(`q${row.q}:measured`); return row; }
    /* …and the narrative layer only speaks to the questions the facts layer left open. */
    if (!NARRATIVE_Q.has(row.q)) { refused.push(`q${row.q}:not-narrative`); return row; }

    const text = str(a.text);
    if (!text) { refused.push(`q${row.q}:empty`); return row; }

    /* ② A cited file the scan actually read makes it 예상됨. Anything else is 확인 못함 — and
     * the sentence is still carried, because "we think this, and we cannot show you why" is a
     * real state the reader is entitled to see under the right chip. */
    const cites = (Array.isArray(a.cites) ? a.cites : []).map(String).filter((f) => read.has(f));
    if (cites.length) grounded += 1;
    filled += 1;

    return {
      ...row,
      kind: 'narrative',
      data: { text, cites },
      /* NEVER 'confirmed'. `19` §C1 ①: only the facts layer's own output can be. */
      confidence: cites.length ? 'expected' : 'unconfirmed',
      sourceRef: null,
    };
  });

  /* ⑥ 확인 못한 것 is a statement about the WHOLE interpretation, so it has to be re-stated once
   * the narrative layer has answered some of what it lists. Leaving it alone made the card
   * contradict itself on its own face: 하는 일 shown with an answer and an 예상됨 chip, and
   * three rows below, 하는 일 listed among the things still unanswered. */
  const answeredKeys = new Set();
  for (const row of answers) {
    if (row.kind !== 'narrative') continue;
    for (const k of Q_KEYS[row.q] ?? []) answeredKeys.add(k);
  }
  if (answeredKeys.size) {
    const i = answers.findIndex((r) => r.kind === 'unknown');
    if (i !== -1 && Array.isArray(answers[i].data?.questions)) {
      answers[i] = { ...answers[i],
                     data: { ...answers[i].data,
                             questions: answers[i].data.questions.filter((k) => !answeredKeys.has(k)) } };
    }
  }

  return { answers, filled, refused, grounded };
}

/* The names `answers.js` uses when it lists a question as unanswered. `folder-roles` is what it
 * pushes when the folders EXIST but their roles are unknown, `folders` when there are none —
 * and the narrative layer answers the roles, so both are cleared by an answer to q4. */
const Q_KEYS = { 1: ['what'], 2: ['features'], 4: ['folder-roles', 'folders'] };

/** The model's text is not JSON just because we asked for JSON — same tolerance as `explain`. */
function parse(response) {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object') return response.answers ?? null;
  const s = String(response ?? '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

const str = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

/**
 * The prompt carries the FACTS and the file list — not the filesystem.
 *
 * `19` §C1 ④ excludes `.env*`, key files, `node_modules`, `dist` and `.git` from the read. The
 * scan already applied that, so handing over its output is what makes the exclusion hold: a
 * pass with no tools cannot go and look at what it was not given.
 */
function promptFor({ deterministic, readFiles, facts }) {
  const measured = deterministic
    .filter((r) => r.confidence === 'confirmed')
    .map((r) => `- q${r.q} (${r.kind}): ${JSON.stringify(r.data)}`)
    .join('\n');

  const files = readFiles.slice(0, 200);
  const readme = str(facts?.readme?.head) ?? '';

  const body = [
    '아래는 한 프로젝트에서 JuQode 가 직접 읽어서 확인한 사실입니다. 이 사실만 근거로 삼으세요.',
    '',
    '## 측정된 사실',
    measured || '(측정된 사실이 없어요)',
    '',
    '## 읽은 파일',
    files.join('\n'),
    readme ? `\n## README 첫 절\n${readme}` : '',
    '',
    '세 가지만 답하세요. JSON 배열 하나로만 답하고 다른 말은 쓰지 마세요.',
    '  q=1  이 프로젝트가 하는 일',
    '  q=2  주요 기능',
    '  q=4  각 폴더가 하는 일',
    '항목: {"q", "text", "cites"}  — `cites` 는 위 "읽은 파일" 목록에 있는 경로만.',
    '',
    '모르는 것은 그 항목을 빼세요. 지어내지 마세요. 위 목록에 없는 파일을 인용하지 마세요.',
  ].join('\n');

  return body.length > PROMPT_BUDGET ? `${body.slice(0, PROMPT_BUDGET)}\n(생략됨)` : body;
}

/**
 * Run the narrative pass.
 *
 * `19` §C1 ⑥ is the whole error policy: a failure here produces a facts-only Brief, which is
 * 부분, not 실패. So this function has no error path that loses the deterministic answers —
 * every way the pass can go wrong lands on `merge(null, …)`, which returns them unchanged.
 *
 * @returns {{answers:object[], filled:number, grounded:number, refused:string[], reason:string|null}}
 */
async function narrate({ deterministic, readFiles, facts, cwd, bin, timeoutMs = 120000 }) {
  let answer = null;
  let reason = null;
  let detail = null;
  try {
    const r = await session.run({
      cwd, bin, tools: NO_TOOLS, timeoutMs,
      sessionId: randomUUID(),
      prompt: promptFor({ deterministic, readFiles, facts }),
      onSignal: (sig) => { if (sig.kind === KIND.FINISH) answer = sig.payload?.text ?? answer; },
    });
    /* One reason, and the child's own stderr with it. `session.run`'s `startFailed` does NOT
     * mean the spawn failed — it means no first event arrived inside the start window — so
     * splitting on it would have produced two names for one fact. What actually distinguishes
     * the causes is the stderr, and carrying it is what identified a broken fixture as a broken
     * fixture rather than as a model that declined to answer. `19` §C1 ⑥ makes every one of
     * them the same 부분 Brief on screen, so this line is the only place the difference lives. */
    if (!r.sawEvent) {
      reason = 'no-response';
      detail = String(r.stderr ?? '').trim().slice(0, 200) || null;
    }
  } catch {
    reason = 'pass-failed';
  }

  const merged = merge(answer, { deterministic, readFiles });
  if (!merged.filled && !reason) reason = 'nothing-answered';
  return { ...merged, reason, detail };
}

module.exports = { narrate, merge, promptFor, NARRATIVE_Q, PROMPT_BUDGET };
