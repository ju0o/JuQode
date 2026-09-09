/* SC-01 · Project Open — the only screen WBS-01 builds.
 * 15 SC-01: one product statement, one primary action, an optional recent list.
 * Explicitly NOT included (15): project creation · templates · clone · remote ·
 * workspace management · login · settings. */
import { C } from '../copy.js';
import { mountThemeToggle } from '../design/theme.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function renderSC01(root, api) {
  root.innerHTML = '';

  const shell = el('div', 'shell');

  const bar = el('div', 'topbar');
  bar.appendChild(el('span', 'brand', C.app.name));
  bar.appendChild(el('span', 'grow'));
  mountThemeToggle(bar, C.theme);
  shell.appendChild(bar);

  const main = el('main', 'sc01 fade-in');
  main.setAttribute('data-screen', 'SC-01');

  const hero = el('div', 'hero');
  hero.appendChild(el('h1', 'h1', C.sc01.title));
  hero.appendChild(el('p', 'lead', C.sc01.lead));

  const actions = el('div', 'actions');
  const openBtn = el('button', 'btn pri', C.sc01.open);
  openBtn.type = 'button';
  openBtn.setAttribute('data-act', 'open-project');
  actions.appendChild(openBtn);
  actions.appendChild(el('span', 'xs mut', C.sc01.openHint));
  hero.appendChild(actions);
  main.appendChild(hero);

  /* Recent list — A-8 (Founder-pending, removable). Empty state is the honest default:
   * WBS-01 has no persistence yet, so there is nothing to remember. 15 SC-01 Empty State. */
  const recent = el('section', 'recent');
  recent.setAttribute('data-el', 'recent');
  recent.appendChild(el('h2', null, C.sc01.recent));
  recent.appendChild(el('div', 'empty', C.sc01.noHistory));
  recent.appendChild(el('span', 'footnote', C.sc01.recentNote));
  main.appendChild(recent);

  shell.appendChild(main);
  root.appendChild(shell);

  /* Opening a folder is WBS-02, not WBS-01. The button exists because the screen is
   * defined by it, but it must not pretend to work. It reports the truth instead. */
  openBtn.addEventListener('click', async () => {
    openBtn.disabled = true;
    const prev = openBtn.textContent;
    openBtn.textContent = C.sc01.opening;
    try {
      const res = await api.openProject();
      if (!res || res.ok !== true) showNotYet(main, res);
    } finally {
      openBtn.disabled = false;
      openBtn.textContent = prev;
    }
  });

  return { shell, main, openBtn };
}

/* Not a failure card — folder-open is not implemented yet, and saying "실패" would be a lie.
 * Neutral grey, the 지금 안 됨 · 실패 아님 grammar (12 §16). */
function showNotYet(main, res) {
  let n = main.querySelector('[data-el="notyet"]');
  if (!n) {
    n = el('div', 'card');
    n.setAttribute('data-el', 'notyet');
    n.style.cssText = 'max-width:560px;width:100%;padding:14px 16px;background:var(--grey);display:flex;flex-direction:column;gap:6px';
    main.appendChild(n);
  }
  n.innerHTML = '';
  const head = el('div', null);
  head.style.cssText = 'display:flex;align-items:center;gap:8px';
  head.appendChild(el('span', 'sm', (res && res.reason) || '아직 폴더를 열 수 없어요'));
  head.appendChild(el('span', 'chip unavail', '지금 안 됨 · 실패 아님'));
  n.appendChild(head);
  n.appendChild(el('span', 'xs mut', '프로젝트 열기는 다음 단계(WBS-02)에서 만들어요.'));
}
