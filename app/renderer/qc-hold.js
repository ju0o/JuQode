import { C } from './copy.js';
import { el, btn } from './dom.js';

/* The earlier Quick Command processes may still be alive: say so, name the run(s), and let the USER record that they ended
 * (checkbox + button; the run keeps its 확인 불가 result). Returns null when nothing is held. */
export function holdPanel(api, projectId, held, onDone = () => {}) {
  if (!held?.length) return null;
  const panel = el('div', 'panel unk qc-hold');
  panel.setAttribute('data-el', 'qc-hold');
  panel.appendChild(el('div', 'sm t', C.gap.qcHold.title));
  panel.appendChild(el('div', 'xs mut', C.gap.qcHold.body));
  for (const h of held) {
    panel.appendChild(el('div', 'xs mut2', `${h.command ?? ''} · ${C.gap.qcHold.reason[h.why] ?? ''}`));
  }
  const check = el('input');
  check.type = 'checkbox';
  const label = el('label', 'xs mut2');
  label.append(check, document.createTextNode(` ${C.gap.qcHold.check}`));
  const note = el('div', 'xs mut2');
  const go = btn('btn sm', C.gap.qcHold.resolve, async () => {
    if (!check.checked) return;
    go.disabled = true;
    const r = await api.qcAckStopped(projectId, true);
    if (r?.ok) onDone(r); else { note.textContent = C.gap.qcHold.failed; go.disabled = false; }
  });
  go.disabled = true;
  check.addEventListener('change', () => { go.disabled = !check.checked; });
  panel.append(label, note, go);
  return panel;
}
