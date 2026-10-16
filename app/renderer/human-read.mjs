/* What a ContextBundle actually contained, as facts a screen can say.
 *
 * The bundle also carries ids, digests, source refs and schema versions. Those stay out of
 * this list on purpose: a sentence about what Claude was shown is not a record inspector.
 * Unknown item types are kept as text with no invented label. An empty or missing bundle
 * is an empty list, never a claim that nothing was shared. */

export function contextFacts(bundle) {
  const items = Array.isArray(bundle?.items) ? bundle.items : [];
  const facts = [];
  for (const item of items) {
    const text = typeof item?.safe_content === 'string' ? item.safe_content.trim() : '';
    if (!text) continue;
    const key = item.source_type === 'task_goal' ? 'goal'
      : item.source_type === 'acceptance_criterion' ? 'criterion'
        : item.source_type === 'user_request' ? 'request'
          : 'other';
    facts.push({ key, text });
  }
  return facts;
}

/**
 * What the run evidence says about changed files -- FOUR different answers, never folded into "none":
 *   'missing'  no changed_files row at all (nothing was recorded)
 *   'unknown'  a row exists but `details.known` is not true (the measurement could not be made)
 *   'zero'     known and empty (a measured "nothing changed")
 *   'files'    known and listed
 * A file name is a name, not a meaning; this says nothing about what a change was for.
 * @returns {{state:'missing'|'unknown'|'zero'|'files', files:string[], id:string|null}}
 */
export function changedFilesState(runEvidence) {
  const row = (Array.isArray(runEvidence) ? runEvidence : []).find((item) => item?.kind === 'changed_files');
  if (!row) return { state: 'missing', files: [], id: null };
  if (row.details?.known !== true) return { state: 'unknown', files: [], id: row.id ?? null };
  const files = Array.isArray(row.details.files) ? row.details.files : [];
  return { state: files.length ? 'files' : 'zero', files, id: row.id ?? null };
}
