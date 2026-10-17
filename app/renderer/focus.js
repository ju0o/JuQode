/* A screen that redraws itself from scratch must give the person back what the redraw took.
 *
 * SC-03 is rebuilt (`root.innerHTML = ''`) on every pushed snapshot, and while Claude Code waits on the person a
 * push arrives every few seconds. Without this a keyboard user is thrown to the page top in the middle of the card
 * that needs them, the caret leaves the answer they are typing, and — worse — the answer itself is gone.
 *
 * It is restored by MEANING, not by position alone: the card the control lives in, its `data-act`/`data-el`, its
 * label and words, and which of several identical ones it was. A control that no longer exists (or is now disabled)
 * is NOT replaced by a guess at a neighbouring button — a wrong guess would put focus on something the person never
 * chose — focus goes to the card that held it, which activates nothing and keeps the next Tab where they were. */
const FOCUSABLE = 'button:not([disabled]), summary, a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELD = 'textarea:not([disabled]), input:not([disabled]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])';
const cardOf = (n) => n.closest('[data-card]');
const text = (n) => (n.textContent || '').trim().slice(0, 60);
const keyOf = (n) => [cardOf(n)?.getAttribute('data-card') ?? '', n.tagName, n.getAttribute('data-task-id') ?? n.getAttribute('data-act') ?? n.getAttribute('data-el') ?? '',
  n.getAttribute('aria-label') ?? '', n.matches(FIELD) ? (n.placeholder || '') : text(n)].join('|');
const sameKey = (root, selector, key) => [...root.querySelectorAll(selector)].filter((n) => keyOf(n) === key);

export function rememberFocus(root) {
  const fields = [...root.querySelectorAll(FIELD)].filter((n) => n.value)
    .map((n) => ({ key: keyOf(n), ordinal: sameKey(root, FIELD, keyOf(n)).indexOf(n), value: n.value }));
  const a = document.activeElement;
  if (!a || a === document.body || !root.contains(a)) return fields.length ? { focus: null, fields } : null;
  const key = keyOf(a);
  const focus = { key, ordinal: sameKey(root, FOCUSABLE, key).indexOf(a), card: cardOf(a)?.getAttribute('data-card') ?? null };
  if (a.matches(FIELD)) Object.assign(focus, { start: a.selectionStart, end: a.selectionEnd, dir: a.selectionDirection, top: a.scrollTop });
  return { focus, fields };
}

export function restoreFocus(root, mem) {
  if (!mem) return;
  /* What was typed comes back first, but only into a field that is empty — never over something newer. */
  for (const f of mem.fields) {
    const n = sameKey(root, FIELD, f.key)[f.ordinal];
    if (n && !n.value) n.value = f.value;
  }
  const f = mem.focus;
  if (!f) return;
  const target = sameKey(root, FOCUSABLE, f.key)[f.ordinal];
  if (target) {
    target.focus({ preventScroll: true });
    if (f.start != null && target.setSelectionRange) {
      try { target.setSelectionRange(f.start, f.end, f.dir ?? 'none'); target.scrollTop = f.top ?? 0; } catch { /* a field type with no selection */ }
    }
    return;
  }
  const card = f.card && root.querySelector(`[data-card="${f.card}"]`);
  if (card) { card.setAttribute('tabindex', '-1'); card.focus({ preventScroll: true }); }
}
