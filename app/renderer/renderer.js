import { renderSC01 } from './screens/sc01.js';

/* window.juqode is the entire renderer-visible surface (see app/preload/preload.js).
 * If the preload failed, fail loudly rather than silently degrading. */
const api = window.juqode;
if (!api) throw new Error('preload bridge missing — renderer has no API surface');

renderSC01(document.getElementById('root'), api);

/* Test hooks. Read-only: they expose state, they never mutate it. */
window.__screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null;
window.__theme  = () => document.documentElement.getAttribute('data-theme');
window.__ready  = true;
