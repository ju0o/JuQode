'use strict';
/* WBS-06 · Intent routing — deterministic, D-106.
 *
 * `15` SC-02 and D-134: the main request field has exactly ONE outgoing route — a Claude Code
 * Work. A technical EXECUTION request is not run and is not an error; the field says the
 * terminal is where that lives. So this module answers one question — which of four —
 * and nothing else. It never builds a command and never touches the filesystem.
 *
 *   work         → send it to Claude Code as a Work
 *   terminal     → a technical execution request; offer the drawer, run nothing (D-134)
 *   ambiguous    → two readings, both shown, JuQode picks neither (q02 §3)
 *   unrecognized → not readable as a project-change request. A branch, not a failure.
 *
 * The safety property is `residue === 0`, from the validated contract: a rule matches only
 * when the objects and verbs it declares consume the WHOLE input. It is an allowlist with a
 * leftovers check, not a blocklist — so `서버 켜줘 && rm -rf /`, `sudo npm run dev`,
 * `git push --force` and every unforeseen dangerous phrasing fail to match without anyone
 * having to predict them. Corpus evidence: q02 §4, negative.danger 8/8.
 */
const { RULES, ENDINGS, FILLERS, SYNONYMS, CHANGE_FORMS } = require('./rules');
/* The drawer's table — the one that decides whether a phrase is one of the six (D-134). */
const { match: qcMatch } = require('../qc/rules');

/* The matcher is O(input) per rule per pass, and the tail-stripping loop rescans what is left.
 * A pasted wall of text is a realistic input for a request field, so the string the MATCHER
 * sees is bounded. The user's words are carried through untouched — only the classification
 * looks at a prefix, and a request longer than this is a Work by any reading. */
const MAX_MATCH_CHARS = 400;

/** q02 §2 — NFC → trim → tail punctuation/laughter → lowercase latin → strip spaces → fillers. */
function normalize(input) {
  let s = String(input ?? '').slice(0, MAX_MATCH_CHARS).normalize('NFC').trim().replace(/\s+/g, ' ');
  const tail = () => {
    let prev;
    do {
      prev = s;
      s = s.replace(/[.!?~…,;:'"”’)\]]+$/u, '');
      s = s.replace(/(?:ㅋ+|ㅎ+|ㅠ+|ㅜ+)$/u, '');
    } while (s !== prev);
  };
  tail();
  s = s.replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
  s = s.replace(/\s+/g, '');
  for (const f of FILLERS) s = s.split(f).join('');
  return s;
}

const byLength = (a, b) => b.length - a.length;

/** Remove ONE occurrence of the longest matching token; returns null when none matched. */
function strip(s, tokens) {
  for (const t of [...tokens].sort(byLength)) {
    if (!t) continue;
    const i = s.indexOf(t);
    if (i !== -1) return s.slice(0, i) + s.slice(i + t.length);
  }
  return null;
}

const verbForms = (verbs) => {
  const out = [];
  for (const v of verbs) for (const e of ENDINGS) out.push(v + e);
  return out;
};

/**
 * Does this rule consume the whole string?
 * @returns 'full' (object + verb, nothing left) · 'ambiguous-verb' · 'verb-only' · null
 */
function consume(compact, rule) {
  const verbs = verbForms(rule.verbs);
  const ambVerbs = rule.ambiguousVerbs ? verbForms(rule.ambiguousVerbs) : [];

  for (const [kind, vs] of [['full', verbs], ['ambiguous-verb', ambVerbs]]) {
    if (!vs.length) continue;
    let s = strip(compact, rule.objects);
    if (s === null) continue;
    const after = strip(s, vs);
    if (after === '') return kind;
  }

  /* 대상어 없는 동사 하나 — `돌려줘` · `켜줘`. Always ambiguous: never silently picked. */
  if (verbs.includes(compact)) return 'verb-only';
  return null;
}

function match(compact) {
  const full = [];
  const dual = [];
  const bare = [];
  for (const r of RULES) {
    const v = consume(compact, r);
    if (v === 'full') full.push(r.id);
    else if (v === 'ambiguous-verb') dual.push(r.id);
    else if (v === 'verb-only') bare.push(r.id);
  }
  return { full, dual, bare };
}

/**
 * @param {string} input the user's words, unchanged
 * @returns {{route:'work'|'terminal'|'ambiguous'|'unrecognized', text:string,
 *            rule?:string, options?:string[], tier:string}}
 */
function classify(input) {
  const text = String(input ?? '');
  const raw = normalize(text);
  if (!raw) return { route: 'unrecognized', text, tier: text.trim() ? 'filler-only' : 'empty' };

  for (const pass of ['direct', 'synonym']) {
    const compact = pass === 'direct' ? raw : applySynonyms(raw);
    if (pass === 'synonym' && compact === raw) break;
    const tier = pass === 'direct' ? 'pattern' : 'synonym+pattern';

    /* Exact form first (q02 T1), then the object+verb composition (T2). */
    for (const r of RULES) {
      if (r.exact && r.exact.includes(compact)) return { route: 'terminal', rule: r.id, text, tier: `${tier}:exact` };
    }

    const { full, dual, bare } = match(compact);
    if (full.length === 1) return { route: 'terminal', rule: full[0], text, tier };
    if (full.length > 1) return { route: 'ambiguous', options: full, text, tier };
    if (dual.length) return { route: 'ambiguous', options: [...dual, 'work'], text, tier: `${tier}:dual-verb` };
    if (bare.length) {
      /* `work` is ALWAYS one of the readings. A verb with no object could be a request to
       * change the project as easily as to run something, and dropping that option when two
       * rules happened to match left `켜줘` with no way out to a Work while `꺼줘` had one. */
      return { route: 'ambiguous', options: [...bare, 'work'], text, tier: `${tier}:verb-only` };
    }
  }
  /* Nothing in THIS table consumed it — so ask the one that actually owns the question.
   *
   * D-134 makes the drawer the place technical execution lives, and `qc/rules.js` is the table
   * that decides whether a phrase is one of the six. Two tables answering "is this technical?"
   * could differ, and did: `dev 서버` was a Quick Command in the drawer and 미인식 here, so the
   * request field would have sent it to a Work while the drawer would have run it. This module
   * keeps its own logic for the `work` split, which the drawer has no opinion about. */
  const qc = qcMatch(text);
  if (qc.kind === 'qc') return { route: 'terminal', rule: qc.id, text, tier: `qc:${qc.tier}` };
  if (qc.kind === 'ambiguous') {
    /* The drawer's readings, unchanged. (This used to `.map()` each reading through
     * `r === 'work' ? 'work' : r`, which returns `r` either way — an identity dressed as a
     * rule. Found by mutation: inverting the comparison turned every reading into `work`, and
     * nothing failed, because nothing was checking a no-op.) */
    return { route: 'ambiguous', options: [...qc.readings], text, tier: `qc:${qc.tier}` };
  }

  /* Now — and only now — a change verb decides between the two remaining answers. The order matters: `수정된 파일 확인해줘` is a git.status
   * match whose OBJECT contains 수정, and checking change verbs first would misread it as a
   * request to modify something (q02 §4 names this exact case). */
  const compact = applySynonyms(raw);
  if (CHANGE_FORMS.some((v) => raw.includes(v) || compact.includes(v))) {
    return { route: 'work', text, tier: 'change-verb' };
  }
  return { route: 'unrecognized', text, tier: 'no-match' };
}

function applySynonyms(s) {
  let out = s;
  for (const [from, to] of [...SYNONYMS].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(from).join(to);
  }
  return out;
}

module.exports = { classify, normalize };
