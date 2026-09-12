/* SC-02 · Brief — the six answers (`11` F-C1-02, `15` SC-02 ①).
 *
 * WBS-03 built the facts layer, so three of the six can be 확인됨 today. The other three say
 * 확인 못함 and say why. `11`: "부분 해석은 실패가 아니다 — 답한 것과 답하지 못한 것을 구별해
 * 보여준다", so nothing here fills a gap it cannot back.
 *
 * The main process sends STRUCTURE. Every Korean word is chosen here, from `copy.js`, which
 * is why `18` can stay the single source even though a Brief answer is generated content.
 */
import { C } from '../copy.js';
import { el, btn } from '../dom.js';

const CHIP = { confirmed: ['ok', C.brief.chips.ok], expected: ['part', C.brief.chips.exp], unconfirmed: ['unk', C.brief.chips.no] };

/* `15` SC-02 Failure State asks for the reason, and `11` F-C1-01 says the technical fact is
 * translated, not erased. The scan returns the errno; this is the only place it becomes words. */
const FAIL = { EACCES: C.gap.briefFailNoAccess, EPERM: C.gap.briefFailNoAccess, ENOENT: C.gap.briefFailGone };

/**
 * `18` brief.stale is written with an EXAMPLE number in it — "3일 전에 읽은 내용이에요." — and
 * `19` §C1 ⑤ asks for that STYLE with the real number ("`3일 전 내용` 식 사실 표기"). So the
 * approved sentence is kept verbatim and its number is substituted, the same way
 * `reader.evidenceGapPaths` substitutes Canon's own `{paths}`. See CANON_FINDINGS CF-16.
 */
function staleLine(days) {
  if (!Number.isFinite(days)) return C.brief.stale;
  /* Canon's sentence presumes a read a day or more old. A hash can move minutes after the read,
   * and `0일 전에 읽은 내용이에요` is not a sentence — so the same-day case says the fact plainly. */
  if (days < 1) return C.gap.briefStaleToday;
  /* Only the DIGIT is replaced, so no Korean is written here — the sentence on screen is
   * Canon's, character for character, with its example number swapped for the real one. */
  return C.brief.stale.replace('3', String(days));
}

/**
 * @param {HTMLElement} card
 * @param {object|null} interp
 * @param {object} [opts]
 * @param {{changed:boolean, days:number|null}|null} [opts.stale]  WBS-05's verdict, never a re-read
 * @param {boolean} [opts.folded]      D-132: a reopened project starts folded
 * @param {() => void} [opts.onFold]
 * @param {() => void} [opts.onReread]
 * @param {string|null} [opts.refreshFailed]  a refresh that could not read the folder
 */
export function renderBrief(card, interp, opts = {}) {
  card.innerHTML = '';
  const head = el('div', 'chead');
  head.appendChild(el('span', 'ct', C.brief.title));
  head.appendChild(el('span', 'grow'));
  /* `15` SC-02 ① requires the 해석 시점 timestamp. It is what tells a cached Brief from a
   * fresh one; the stale JUDGEMENT is WBS-05, the timestamp is not. */
  if (interp?.created_at) {
    head.appendChild(el('span', 'xs mut2', `${C.brief.at} ${when(interp.created_at)}`));
  }
  /* WBS-05 · 다시 읽기 and 접기/펼치기. Both are USER actions — `19` §C1 ⑤ and D-132 forbid an
   * automatic re-read, so this button is the only thing that starts one. */
  /* …but not twice. When the 오래됨 band is up it carries 다시 읽기 as its own call to action,
   * and two identical buttons in one card make the reader choose between the same thing. */
  if (interp && opts.rereading) {
    /* `15` SC-02 갱신 중: the OLD interpretation stays visible (F-C1-03) and the header says a
     * re-read is under way. Nothing moved on screen for the seconds the narrative pass takes,
     * and the button stayed pressable — so it could be pressed again and again. */
    head.appendChild(el('span', 'xs mut2 rereading', C.gap.briefRereading));
  } else if (interp && opts.onReread && !opts.stale?.changed) {
    head.appendChild(btn('btn sm ghost', C.brief.reread, opts.onReread));
  }
  if (interp && opts.onFold) {
    head.appendChild(btn('btn sm ghost', opts.folded ? C.brief.unfold : C.brief.fold, opts.onFold));
  }
  card.appendChild(head);

  /* WBS-02b · 빈 폴더.
   *
   * This branch comes BEFORE the interpreting/failed/answers ladder on purpose: for an empty
   * folder every one of those states is technically correct and useless. 해석 중 is a promise
   * about files that are not there; the six answers come back 확인 못함 six times, which reads
   * as breakage. The honest answer is that there is nothing here yet — and the useful thing is
   * the sentence that makes there be something.
   *
   * `15` SC-01 rules out project creation, templates and clone, and this is none of them:
   * nothing is scaffolded, nothing is fetched. It puts a request in the field and the USER
   * presses 보내기 — the same consent every other change goes through (`12`). CF-23. */
  if (opts.empty) {
    card.appendChild(el('div', 't', C.gap.briefEmptyTitle));
    card.appendChild(el('p', 'sm', C.gap.briefEmptyBody));
    if (opts.onStart) {
      const acts = el('div', 'row-acts');
      acts.appendChild(btn('btn sm pri', C.gap.briefEmptyStart, opts.onStart));
      card.appendChild(acts);
    }
    return;
  }

  if (!interp) {                                     /* 해석 중 — facts only, no percent (원칙 6) */
    card.appendChild(el('div', 'sm mut', C.brief.interpreting));
    /* `15` SC-02 Loading State: the intent field stays ENABLED and the Brief says so. `18` has
     * the sentence and nothing was drawing it, so the screen looked like it was blocking. */
    card.appendChild(el('div', 'xs mut2', C.brief.interpretingHint));
    return;
  }
  if (interp.status === 'failed') {
    const band = el('div', 'failband');
    band.appendChild(el('div', 't', C.brief.failTitle));
    /* The reason is the one the scan actually returned. A fixed sentence here would state a
     * cause that may not be the cause — the same evidence-free claim the chips exist to stop. */
    band.appendChild(el('div', 'sm', FAIL[interp.failedCode] ?? C.gap.briefFailOther));
    band.appendChild(el('div', 'xs mut', C.brief.failNote));
    card.appendChild(band);
    return;
  }

  /* WBS-05 · 오래됨. A STATEMENT OF FACT, not a warning and not a failure: `19` §C1 ⑤ says the
   * hash changed, so the project moved since this was read. Nothing re-reads on its own — the
   * card says what it knows and offers the two things the user can do (D-132). */
  if (opts.stale?.changed) {
    const band = el('div', 'staleband');
    band.appendChild(el('div', 'sm', staleLine(opts.stale.days)));
    const acts = el('div', 'row-acts');
    if (opts.rereading) acts.appendChild(el('span', 'xs mut', C.gap.briefRereading));
    else if (opts.onReread) acts.appendChild(btn('btn sm', C.brief.reread, opts.onReread));
    /* Dismissing the notice must not take 다시 읽기 with it. `band.remove()` left the state set,
     * so the header kept suppressing its own button and SC-02 had no 다시 읽기 control at all
     * until the user left the screen and came back. `15` lists it unconditionally. */
    acts.appendChild(btn('btn sm ghost', C.brief.staleKeep, () => {
      if (opts.onKeepStale) opts.onKeepStale();
      else band.remove();
    }));
    band.appendChild(acts);
    card.appendChild(band);
  }

  /* A refresh that could not read the folder. The Brief below it is the OLD one, still true as
   * of when it was read — `21` WBS-05: 갱신 실패 시 이전 해석이 살아남는다. */
  if (opts.refreshFailed) {
    const band = el('div', 'failband soft');
    band.appendChild(el('div', 't', C.brief.failTitle));
    band.appendChild(el('div', 'sm', FAIL[opts.refreshFailed] ?? C.gap.briefFailOther));
    band.appendChild(el('div', 'xs mut', C.gap.briefRefreshKept));
    card.appendChild(band);
  }

  if (opts.folded) return;                 // D-132: folded shows the header and nothing more

  /* 부분 해석 — amber, because `16` §2 assigns amber to 부분 and this is the state the user
   * is always in until the narrative layer exists. Grey would put it in no state at all. */
  if (interp.status === 'partial') card.appendChild(el('div', 'xs partial-line', C.brief.partial));

  const list = el('div', 'answers');
  for (const a of interp.answers) {
    const row = el('div', 'ans');
    row.setAttribute('data-q', String(a.q));

    const label = el('div', 'label');
    label.appendChild(el('span', 'qn', C.brief.q[a.q - 1]));
    const [cls, text] = CHIP[a.confidence] ?? CHIP.unconfirmed;
    label.appendChild(el('span', `chip ${cls}`, text));
    row.appendChild(label);

    const body = el('div', 'body');
    body.append(...answerBody(a));
    row.appendChild(body);

    /* D-114: a 확인됨 chip is a promise, so the file it rests on is named right there. */
    if (a.confidence === 'confirmed' && a.sourceRef) {
      row.appendChild(el('div', 'xs mut2 src', a.sourceRef));
    }
    list.appendChild(row);
  }
  card.appendChild(list);

  if (interp.readFiles?.length) {
    const d = el('details', 'readfiles');
    d.appendChild(el('summary', 'xs mut', `${C.brief.readFiles} ${interp.readFiles.length}`));
    d.appendChild(el('div', 'xs mono mut', interp.readFiles.join(' · ')));
    card.appendChild(d);
  }
}

/* label · value, the shape Canon uses for `읽은 시점`. The label never ends in a particle,
 * so it cannot read as half a sentence. */
function field(label, value) {
  const row = el('div', 'xs mut fieldrow');
  row.appendChild(el('span', 'k', label));
  row.appendChild(el('span', 'v', value));
  return row;
}

function answerBody(a) {
  const p = (cls, t) => el('div', cls, t);
  const d = a.data ?? {};
  switch (a.kind) {
    case 'tech': {
      const out = [p('sm', `${d.ecosystems.join(' · ')} ${C.gap.briefTech}`)];
      if (d.packageManager) out.push(field(C.gap.briefPm, d.packageManager));
      if (d.deps?.length) {
        const more = d.depCount > d.deps.length ? ` · +${d.depCount - d.deps.length}${C.history.more}` : '';
        out.push(field(C.gap.briefDeps, d.deps.join(' · ') + more));
      }
      return out;
    }
    case 'folders-listed':
      /* The list is context under a 확인 못함 chip, not the answer. The answer is the role,
       * and nothing has established it — the second line says exactly that. */
      return [p('sm mono', d.dirs.join(' · ')), p('xs mut', C.gap.briefFolders),
              p('xs mut2', C.gap.briefFolderRole)];
    case 'run':
      /* Without a lockfile the runner is unknown, so only the script name is stated. */
      return [...d.scripts.map((s) => p('sm mono', s.command ?? s.name)), p('xs mut', C.gap.briefRun)];
    case 'unknown': {
      const out = [];
      if (d.questions?.length) {
        out.push(p('sm', `${C.gap.briefUnknownQ}: ${d.questions.map(qName).join(' · ')}`));
      }
      if (d.skippedFiles) out.push(field(C.gap.briefSkipped, String(d.skippedFiles)));
      /* Only directories we FAILED to read. A folder on the permanent exclusion list
       * (node_modules, dist, .git …) is policy, not a gap, and listing it here would inflate
       * 확인 못한 것 with something that was never going to be read. */
      if (d.unreadableDirs?.length) out.push(field(C.gap.briefUnreadDirs, d.unreadableDirs.join(' · ')));
      if (d.depthLimited?.length) out.push(field(C.gap.briefDeepDirs, d.depthLimited.join(' · ')));
      return out.length ? out : [p('sm mut', '—')];
    }
    case 'narrative':
      /* WBS-04. The model's own sentence, and the files it cited — which are files the SCAN
       * actually read, filtered in `narrate.merge`, so the line under the answer is a list the
       * reader can go and open. An answer with nothing under it carries a 확인 못함 chip and
       * says so by having no evidence line at all, rather than by being hidden. */
      return [p('sm', d.text),
              ...(d.cites?.length ? [field(C.gap.briefCites, d.cites.join(' · '))] : [])];
    case 'no-manifest': return [p('sm mut', C.gap.briefNoManifest)];
    case 'no-folders':  return [p('sm mut', C.gap.briefNoFolders)];
    case 'no-scripts':  return [p('sm mut', C.gap.briefNoScripts)];
    default:            return [p('sm mut', C.gap.briefNarrative)];
  }
}

/* The machine names for what the facts layer could not answer. Sub-claims are in here too —
 * `확인 못한 것` has to list everything unanswered, not only the questions that produced no
 * data at all, or the card contradicts itself on its own face. */
const qName = (k) => ({
  what: C.brief.q[0], features: C.brief.q[1], tech: C.brief.q[2],
  folders: C.brief.q[3], run: C.brief.q[4],
  'folder-roles': C.gap.briefRoles, 'tech-meaning': C.gap.briefTechMeaning,
}[k] ?? k);

/* A timestamp, stated as a fact. No "3일 전" arithmetic — that judgement is WBS-05's.
 * Exported because SC-04's header states the Work's time too, and a second copy is a second
 * thing to drift. */
export function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
