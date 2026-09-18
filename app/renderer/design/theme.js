/* Theme toggle — D-135: light / dark / system, one control, NO settings screen.
 * The choice is per-machine UI state, so localStorage is right; it is not product data.
 * Every access is guarded: a packaged app can run where storage throws. */
const KEY = 'juqode.theme';
const MODES = ['', 'light', 'dark'];   // '' = follow the OS

function read() {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v) ? v : '';
  } catch { return ''; }
}

function write(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable — session only */ }
}

export function currentTheme() { return read(); }

export function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  write(mode);
}

/** Mounts the toggle. Returns the element so tests can drive it. */
export function mountThemeToggle(host, labels) {
  applyTheme(read());
  const wrap = document.createElement('div');
  wrap.className = 'themetog';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', labels.label);

  const opts = [['', labels.system], ['light', labels.light], ['dark', labels.dark]];
  for (const [mode, text] of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm ghost';
    b.dataset.theme = mode;
    b.textContent = text;
    b.addEventListener('click', () => { applyTheme(mode); sync(); });
    wrap.appendChild(b);
  }

  function sync() {
    const cur = read();
    for (const b of wrap.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.theme === cur));
    }
  }
  sync();
  host.appendChild(wrap);
  return wrap;
}
