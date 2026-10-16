import { C } from './copy.js';
import { el, btn } from './dom.js';

/* The earlier Quick Command processes may still be alive. Say so, list EACH run (command, when, why), and let the USER record -- run by
 * run -- that the ones they checked have ended. The run keeps its 확인 불가 result. A hold the product could not even rebuild is shown
 * with its exact reason and a retry; nothing can be confirmed against holds nobody could read. Returns null when nothing is held. */
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
  panel.appendChild(el('div', 'xs mut2', C.gap.qcHold.pick));
  const picks = [];
  for (const h of held) {
    const row = el('label', 'xs qc-hold-row');
    const box = el('input'); box.type = 'checkbox'; box.value = h.runId;
    row.append(box, document.createTextNode(` ${C.gap.qcHold.check(h.command ?? '')}`));
    const why = el('div', 'xs mut2 qc-hold-why', `${C.gap.qcHold.reason[h.why] ?? ''}`);
    panel.append(row, why);
    picks.push(box);
  }
  panel.appendChild(el('div', 'xs mut2', C.gap.qcHold.pastResult));
  const note = el('div', 'xs mut2');
  note.setAttribute('role', 'status');
  const go = btn('btn sm', C.gap.qcHold.resolve(0), async () => {
    const ids = picks.filter((p) => p.checked).map((p) => p.value);
    if (!ids.length) return;
    go.disabled = true;
    const r = await api.qcAckStopped(projectId, ids, true);
    if (r?.acked?.length) {
      note.textContent = `${C.gap.qcHold.recorded(r.acked.length)}${r.stillHeld?.length ? ` ${C.gap.qcHold.stillHeld(r.stillHeld.length)}` : ''}${r.skipped?.length ? ` ${C.gap.qcHold.skippedNote}` : ''}`;
      onDone(r);
    } else { note.textContent = C.gap.qcHold.failed; go.disabled = false; }
  });
  go.disabled = true;
  const sync = () => { const n = picks.filter((p) => p.checked).length; go.textContent = C.gap.qcHold.resolve(n); go.disabled = n === 0; };
  for (const p of picks) p.addEventListener('change', sync);
  panel.append(note, go);
  return panel;
}
