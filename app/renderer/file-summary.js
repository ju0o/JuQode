import { C } from './copy.js';
import { el, btn } from './dom.js';
import { presentFiles, maskForDisplay } from './path-view.mjs';

/* Human summary of the changed files: the NAMES first (a folder hint only where two names collide),
 * a "외 n개" instead of a long list, and the exact stored paths one click away. Nothing here says what
 * a file is for -- a name is not evidence of meaning. The Raw Diff stays behind `변경 읽기`. */
export function fileSummary(files) {
  const view = presentFiles(files);
  const wrap = el('div', 'inspect-files');
  wrap.setAttribute('data-el', 'inspect-files');
  wrap.appendChild(el('div', 'xs mut2', C.gap.task.changedFiles));
  const chips = el('div', 'file-chips');
  const LIMIT = 4;
  for (const item of view.items.slice(0, LIMIT)) {
    const chip = el('span', 'file-chip', item.shown);
    chip.title = maskForDisplay(item.raw);
    chips.appendChild(chip);
  }
  if (view.count > LIMIT) chips.appendChild(el('span', 'file-more', C.gap.paths.more(view.count - LIMIT)));
  wrap.appendChild(chips);
  const all = el('details', 'file-all');
  all.appendChild(el('summary', 'xs mut', C.gap.paths.showAll));
  const list = el('div', 'file-paths');
  for (const item of view.items) {
    const row = el('div', 'file-path-row');
    row.appendChild(el('span', 'file-path', maskForDisplay(item.raw)));
    const copy = btn('btn sm ghost file-copy', C.gap.paths.copy, async () => {
      try { await navigator.clipboard.writeText(item.raw); copy.textContent = C.gap.paths.copied; } catch { /* clipboard unavailable */ }
    });
    row.appendChild(copy);
    list.appendChild(row);
  }
  list.appendChild(el('div', 'xs mut2', C.gap.paths.exactNote));
  all.appendChild(list);
  wrap.appendChild(all);
  return wrap;
}
