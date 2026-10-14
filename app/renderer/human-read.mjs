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
