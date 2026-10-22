import { C } from './copy.js';
import { el, btn } from './dom.js';

/* Show unresolved runs and their recorded reasons. Refresh reads state only; no user statement
 * can prove escaped descendants stopped or release a Writer hold. */
export function holdPanel(api, projectId, listing, onDone = () => {}) {
  const held = listing?.held ?? [];
  const failure = listing?.restoreFailure ?? null;
  if (!held.length && !failure) return null;
  const panel = el('div', 'panel unk qc-hold');
  panel.setAttribute('data-el', 'qc-hold');

  if (failure) {
    panel.appendChild(el('div', 'sm t', C.gap.qcHold.restoreTitle));
    panel.appendChild(el('div', 'xs mut', C.gap.qcHold.restoreBody(failure.reason)));
    panel.appendChild(btn('btn sm', C.gap.qcHold.restoreRetry, async () => { onDone(await api.qcList(projectId)); }));
    return panel;
  }

  panel.appendChild(el('div', 'sm t', C.gap.qcHold.title));
  panel.appendChild(el('div', 'xs mut', C.gap.qcHold.body));
  for (const h of held) {
    const row = el('div', 'xs qc-hold-row', h.command ?? '');
    const why = el('div', 'xs mut2 qc-hold-why', C.gap.qcHold.reason[h.why] ?? '');
    panel.append(row, why);
  }
  panel.appendChild(btn('btn sm', C.gap.qcHold.restoreRetry, async () => { onDone(await api.qcList(projectId)); }));
  return panel;
}
