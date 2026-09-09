/* WBS-35 · Agent Presence — `16` §9 · `17` P-00..P-06 · `15` §42 · F-C3-05 · D-120.
 *
 * An abstract point cloud that says which of NINE modes the agent is in, and nothing else. It
 * is not a progress indicator, it is not a spinner, and it has no face. `21` WBS-35's acceptance
 * is four claims, and each one is answered by a specific decision here:
 *
 *   1. **모드는 신호·사용자 행동으로만 바뀐다.** `setMode` is the ONLY writer of `this.mode`, and
 *      the only caller of `setMode` is a render driven by a snapshot. The draw loop reads the
 *      mode and never writes it.
 *   2. **타이머만으로 도달하는 모드가 없다.** There is no timer in this file. Not one. The two
 *      quiet modes (`nosignal`, `unknown`) come in already decided, from `livenessOf()` in the
 *      supervisor — which `17` exempts by name because it judges *process alive + last-signal
 *      timestamp*, not elapsed time on its own. A clock here would be a second, unaccountable
 *      one, and the acceptance is written to forbid exactly that.
 *   3. **모션 끔에서 모드별 정적 프레임.** `prefers-reduced-motion: reduce` draws one still frame
 *      per mode — the transition is jumped rather than eased, and rotation, breathing, jitter and
 *      flicker are all zero. The label is present in every mode, reduced or not, so the mode is
 *      legible without any motion at all.
 *   4. **얼굴·마스코트 없음.** The primitives are a halo, a fibonacci sphere of dots, a full
 *      circle and one centre dot. Nothing is bilaterally paired and nothing is placed where an
 *      eye or a mouth would be.
 *
 * The nine modes are the product's; the seven motion tokens P-00..P-06 are `17`'s, and one does
 * not replace the other (`17`): P-02 covers `input` and `permission` with the same held posture,
 * P-06 covers `cancelled` and `failure` with the same decay. The screen still has to tell them
 * apart, and it does it the way `16` says — colour, ring and label, never motion.
 */
import { C } from './copy.js';
import { el } from './dom.js';

/* Per-mode motion, transcribed from `16` §9's table.
 *
 * `tint` is a TOKEN NAME, not a colour. `16` §2.1: the mode grammar is fixed and only the value
 * changes with the theme, so naming the token is the only way to state that once. (The visual
 * prototype hard-codes a light and a dark triple per mode; those triples ARE these tokens'
 * values, and duplicating them here would be a second copy to drift.)
 *
 * `cancelled` uses `--ink2` in both themes: dark's #ccd3dd is the prototype's own value, and in
 * light it is a hair softer than `--ink`. That is the right direction — 취소 is not a failure. */
export const MODES = {
  //            rot  breathe jitter alpha ring flicker  token        scale still
  idle:       { rot: .10, breathe: .035, jit: 0,   alpha: .42, ring: .10, flick: 0,  tint: '--claude', scale: .96,  still: false },
  activity:   { rot: .55, breathe: .05,  jit: .35, alpha: 1,   ring: .45, flick: 0,  tint: '--claude', scale: 1.04, still: false },
  input:      { rot: 0,   breathe: .012, jit: 0,   alpha: .8,  ring: .9,  flick: 0,  tint: '--wait',   scale: 1,    still: false },
  permission: { rot: 0,   breathe: .012, jit: 0,   alpha: .8,  ring: 1,   flick: 0,  tint: '--wait',   scale: 1,    still: false, ringDash: true, ring2: true },
  nosignal:   { rot: .06, breathe: .015, jit: 0,   alpha: .38, ring: .12, flick: 0,  tint: '--mut',    scale: .96,  still: false },
  unknown:    { rot: .02, breathe: 0,    jit: 0,   alpha: .45, ring: .25, flick: .5, tint: '--unk',    scale: .96,  still: true,  ringDash: true },
  complete:   { rot: .05, breathe: 0,    jit: 0,   alpha: .7,  ring: .3,  flick: 0,  tint: '--rec',    scale: 1,    still: true,  settle: true },
  cancelled:  { rot: 0,   breathe: 0,    jit: 0,   alpha: .6,  ring: 0,   flick: 0,  tint: '--ink2',   scale: .9,   still: true },
  failure:    { rot: 0,   breathe: 0,    jit: 0,   alpha: .35, ring: 0,   flick: 0,  tint: '--fail',   scale: .95,  still: true,  core: true },
};

/** The nine, in `15` §42's order. Anything not in here is not a mode. */
export const MODE_NAMES = Object.keys(MODES);

/**
 * A Work snapshot → the ONE mode to show. Pure: no clock, no DOM, no I/O — the same snapshot
 * always gives the same mode, which is what makes the acceptance checkable at all.
 *
 * The precedence is `15` SC-03's own, the one `stateChip()` already uses: ended, then the two
 * waiting-on-the-user states, then liveness. That order is not cosmetic. Liveness is a
 * threshold on silence, and a Work that is waiting for a permission or an answer is SUPPOSED to
 * be silent — letting `quiet` win would flip the permission card's presence to 잠시 새 활동이
 * 보이지 않아요 two minutes after the card appeared, which is a mode reached by a timer and by
 * nothing else. Reading the waiting states first is what makes claim 2 above hold end to end.
 *
 * @param {object|null} snap  the supervisor snapshot, or null when no Work is open
 * @returns {keyof MODES}
 */
export function modeFor(snap) {
  if (!snap || !snap.work) return 'idle';

  if (snap.status === 'ended') {
    switch (snap.outcome) {
      case 'failed': return 'failure';
      case 'cancelled_partial': case 'cancelled_nochange': return 'cancelled';
      case 'complete': case 'partial': return 'complete';
      /* `ended_unknown` — and anything else. An ended Work with an outcome this table does not
       * know is a Work whose end we cannot describe, and `complete` is a CLAIM. */
      default: return 'unknown';
    }
  }
  /* Observed facts about the user's turn, before any judgement about silence. */
  if (snap.status === 'permission_waiting' && snap.permission) return 'permission';
  if (snap.status === 'input_waiting') return 'input';

  /* Still ours: `running` and `cancel_requested`. A cancel that has been REQUESTED is not a
   * cancel that happened — `07` §8.1 measured a cancelled child exiting 0 — so it must not
   * show `cancelled`, which says 멈췄어요. It shows whatever liveness can actually see.
   *
   * `activity` is the ONLY mode that asserts the agent is doing something, so it is the only
   * one that requires a positive verdict. `livenessOf()` always answers one of three words; a
   * caller that hands over something else — a History row, say, which carries `status` and
   * `outcome` and NOTHING about liveness — has not established that anything is happening, and
   * the honest answer to that is 확인할 수 없어요, not 최근 활동이 보여요. */
  if (snap.liveness === 'quiet') return 'nosignal';
  return snap.liveness === 'live' ? 'activity' : 'unknown';
}

/* ── rendering ────────────────────────────────────────────────────────────────────────────── */

const REDUCED = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  || document.documentElement.classList.contains('reduced');

/* `16` §2.1's tokens resolve to a hex string. Resolving one costs a style recalculation, so the
 * answer is cached and the cache key is the theme — the only thing that can change it. */
let tintCache = { key: null, v: {} };
function tint(token) {
  const key = `${document.documentElement.getAttribute('data-theme')}|${
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true}`;
  if (tintCache.key !== key) tintCache = { key, v: {} };
  if (tintCache.v[token]) return tintCache.v[token];
  const hex = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  /* A token that does not resolve is a bug, not a colour to guess at — but a canvas that throws
   * takes the whole screen with it, so it falls back to the muted ink and stays visible. */
  const rgb = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).join(',') : '93,102,114';
  tintCache.v[token] = rgb;
  return rgb;
}

/** A fibonacci sphere: even coverage with no seam, no pole cluster, and no bilateral pairing. */
function points(n) {
  const out = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r]);
  }
  return out;
}

const lerp = (a, b, k) => a + (b - a) * k;

class Presence {
  constructor(canvas, { size = 56, points: n = 80, label = null } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = size;
    this.c.width = size * 2; this.c.height = size * 2;      // 2× for hidpi
    this.c.style.width = `${size}px`; this.c.style.height = `${size}px`;
    this.pts = points(n);
    this.rand = this.pts.map(() => Math.random());
    /* `this.mode` is deliberately NOT set here: `setMode` below is the only writer of it, and
     * the whole acceptance rests on that being literally true rather than nearly true. */
    this.cur = { ...MODES.idle };
    this.target = MODES.idle;
    this.rotY = 0; this.rotX = .35;
    this.t0 = performance.now();
    this.settleAt = 0;
    this.label = label;
    this.running = false;
    this.setMode('idle');
    this.start();
  }

  /** The ONLY writer of `this.mode`. Called from a render, never from the loop. */
  setMode(m) {
    if (!MODES[m]) return;
    this.mode = m;
    this.target = MODES[m];
    /* `16` §9: one 520 ms settle when the Work completes, then still. It is a one-shot reaction
     * to a signal, not a loop, and it changes no mode. */
    if (MODES[m].settle) this.settleAt = performance.now();
    if (this.label) this.label.textContent = C.gap.presenceLabel[m];
    this.c.setAttribute('data-mode', m);
    this.c.setAttribute('aria-label', C.gap.presenceAria(C.gap.presenceLabel[m]));
    if (REDUCED()) this.draw(performance.now(), true);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (t) => { if (!this.running) return; this.draw(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  draw(t, forceStatic) {
    /* SC-01 clears the root, which detaches this canvas. The loop keeps ticking — that is what
     * lets it resume the moment a screen mounts it again — but it must not paint into a node
     * nobody can see. Painting is the whole cost; the tick is nothing. */
    if (!this.c.isConnected) return;
    const reduced = forceStatic || REDUCED();
    /* Reduced motion does not EASE to the new mode, it lands on it: `k = 1` makes the frame a
     * function of the mode alone, so the same mode is always the same picture. */
    const k = reduced ? 1 : .06;
    for (const key of ['rot', 'breathe', 'jit', 'alpha', 'ring', 'flick', 'scale']) {
      this.cur[key] = lerp(this.cur[key], this.target[key], k);
    }
    const rgb = tint(this.target.tint);
    const S = this.size;
    const R = S * .34 * this.cur.scale;
    const ctx = this.ctx;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    const sec = (t - this.t0) / 1000;

    if (!reduced) this.rotY += this.cur.rot * .016;
    const breathe = reduced ? 0 : Math.sin(sec * 1.1) * this.cur.breathe;
    let settle = 0;
    if (this.settleAt && !reduced) {
      const p = (t - this.settleAt) / 520;
      if (p < 1) settle = Math.sin(p * Math.PI) * .06;
    }
    const rad = R * (1 + breathe + settle);

    const halo = ctx.createRadialGradient(cx, cy, rad * .2, cx, cy, rad * 1.6);
    halo.addColorStop(0, `rgba(${rgb},${.10 * this.cur.alpha})`);
    halo.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, rad * 1.6, 0, Math.PI * 2); ctx.fill();

    const cosY = Math.cos(this.rotY), sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX), sinX = Math.sin(this.rotX);
    for (let i = 0; i < this.pts.length; i++) {
      const [x, y, z] = this.pts[i];
      let x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;
      let y1 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;
      if (!reduced && this.cur.jit > 0) {
        const j = this.cur.jit * .03;
        x1 += Math.sin(sec * 3 + i) * j;
        y1 += Math.cos(sec * 2.3 + i * .7) * j;
      }
      if (this.cur.flick > 0) {
        /* Still frames cannot flicker, so `unknown` drops a FIXED subset instead — the same
         * dots every time, because `this.rand` is per-instance and never re-rolled. */
        const f = Math.sin(sec * .9 + this.rand[i] * 20);
        if (reduced ? this.rand[i] < this.cur.flick * .6 : f < -1 + this.cur.flick * 1.2) continue;
      }
      const depth = (z2 + 1) / 2;
      ctx.fillStyle = `rgba(${rgb},${(.18 + depth * .82) * this.cur.alpha})`;
      ctx.beginPath();
      ctx.arc(cx + x1 * rad, cy + y1 * rad, .45 + depth * 1.05, 0, Math.PI * 2);
      ctx.fill();
    }

    /* The held posture's ring. `16` §9 gives `input` a solid ring and `permission` a dashed one;
     * as 56 px still frames that difference alone was not readable, so permission also gets a
     * second, tighter ring. Both are full 0 → 2π circles: nothing here is an arc, and nothing
     * encodes an amount (D-120).
     *
     * MEASURED, and the reason the cloud is 80 points of ≤1.5 px rather than the prototype's
     * 130 of ≤2.3: at the larger numbers the sphere painted solid at 56 px and BOTH rings were
     * invisible — permission and input were the same picture, which is exactly what the second
     * ring exists to prevent. Sparser dots put the rings in clear space. */
    if (this.cur.ring > .02) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, Math.abs(Math.sin(this.rotX)) * .55 + .12);
      ctx.strokeStyle = `rgba(${rgb},${.7 * this.cur.ring})`;
      ctx.lineWidth = 1.2;
      if (this.target.ringDash) ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(0, 0, rad * 1.18, 0, Math.PI * 2); ctx.stroke();
      if (this.target.ring2) {
        ctx.setLineDash([]); ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(${rgb},${.85 * this.cur.ring})`;
        ctx.beginPath(); ctx.arc(0, 0, rad * .82, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    if (this.target.core) {
      ctx.fillStyle = `rgba(${rgb},.9)`;
      ctx.beginPath(); ctx.arc(cx, cy, 3.2, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* ONE instance for the whole app.
 *
 * SC-02 and SC-03 both clear and rebuild their board on every render, and the router redraws
 * SC-03 on every work signal. A per-render instance would leave an orphaned rAF loop behind on
 * each of those — and would restart the breath from zero, which reads as a reaction to a signal
 * that did not happen. Moving the SAME canvas node into the new card keeps the loop, keeps the
 * rotation, and leaves nothing running behind it. */
let node = null;
let instance = null;

/**
 * The Agent Presence card — S, canvas 56 px + label (`16` §125, `15` §42).
 * @param {keyof MODES} mode
 */
export function presenceCard(mode) {
  const card = el('div', 'card c-s presence');
  card.setAttribute('data-card', 'presence');

  const head = el('div', 'chead');
  head.appendChild(el('span', 'actor', C.presence.kicker));
  card.appendChild(head);

  if (!node) {
    node = document.createElement('canvas');
    instance = new Presence(node, { size: 56, points: 80 });
  }
  const body = el('div', 'pbody');
  body.appendChild(node);
  const label = el('div', 'plabel');
  body.appendChild(label);
  card.appendChild(body);

  /* The label element is rebuilt with the card, so the instance is re-pointed at it and the
   * mode re-applied — the text is written by `setMode` and by nothing else. */
  instance.label = label;
  instance.setMode(MODES[mode] ? mode : 'idle');

  /* `18` `presence.hint`: the shape is a state, not an amount. Said on the card, every time,
   * because "reading it as progress" is this package's named failure case (`21` WBS-35). */
  card.appendChild(el('div', 'xs mut2 foot', C.presence.hint));
  return card;
}

/**
 * Change the mode of the card that is already on screen.
 *
 * SC-02 does not hold a Work snapshot — it has to ask the store for one — so its presence is
 * drawn `idle` and corrected when the answer arrives. That is a SIGNAL (the store answered),
 * not a clock, which is why it is allowed to move the mode at all. The caller checks that the
 * screen it drew for is still the screen on show.
 */
export function setPresenceMode(mode) {
  if (instance && MODES[mode]) instance.setMode(mode);
}

/** Test seam: what the mounted presence currently shows. Read-only. */
export const presenceMode = () => instance?.mode ?? null;
