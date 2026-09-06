/* A1b 벤치 하니스 v2 — 일회용. 제품 코드가 아니다.
 *
 * prototype/ 을 건드리지 않는다. 동결 렌더러가 이미 노출하는 window.JQ_DEV 를 구동한다.
 *
 * v1 의 방법론 오류를 고쳤다:
 *   ① v1 은 스스로 rAF 루프를 돌렸다 → 앱이 고요한지 알 수 없었고 항상 60fps 로 보였다
 *      → rAF 를 감싸서 "앱이 요청한 프레임"만 센다
 *   ② rAF 간격은 vsync 에 물려 항상 16.7ms 다 → 여유(headroom)를 못 본다
 *      → 콜백 안에서 실제로 쓴 시간(draw cost)을 잰다. 이것이 엔진 비교값이다  */
(function () {
  'use strict';
  var rec = { on: false, cb: [], gaps: [], last: 0, count: 0 };
  var rawRAF = window.requestAnimationFrame.bind(window);

  window.requestAnimationFrame = function (fn) {
    return rawRAF(function (ts) {
      if (!rec.on) return fn(ts);
      rec.count++;
      if (rec.last) rec.gaps.push(ts - rec.last);
      rec.last = ts;
      var a = performance.now();
      try { return fn(ts); } finally { rec.cb.push(performance.now() - a); }
    });
  };

  function pct(a, p) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(2);
  }
  function start() { rec.on = true; rec.cb = []; rec.gaps = []; rec.last = 0; rec.count = 0; }
  function stop(ms) {
    rec.on = false;
    var cb = rec.cb, gaps = rec.gaps;
    var late = gaps.filter(function (g) { return g > 25; }).length;  // vsync 1.5배 초과 = 진짜 끊김
    return {
      app_requested_frames: rec.count,
      app_fps: +(rec.count / (ms / 1000)).toFixed(1),
      draw_ms_p50: pct(cb, 50), draw_ms_p95: pct(cb, 95), draw_ms_p99: pct(cb, 99),
      draw_ms_max: cb.length ? +Math.max.apply(null, cb).toFixed(2) : null,
      headroom_pct_p95: cb.length ? +(100 * (1 - pct(cb, 95) / 16.7)).toFixed(1) : null,
      frame_gap_p50: pct(gaps, 50), frame_gap_p99: pct(gaps, 99),
      late_frames_over_25ms: late,
      late_pct: gaps.length ? +(100 * late / gaps.length).toFixed(1) : 0,
      window_ms: ms
    };
  }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ── TRUE IDLE ──────────────────────────────────────────────────────────
     A1b 의 오류: open() 뒤 1500ms 만 기다리고 잰 뒤 "유휴"라고 불렀다.
     스프링 감쇠가 그보다 오래 살아 있으면 그 프레임이 유휴로 잘못 집계된다.

     TRUE IDLE = 정당한 전이/가라앉음이 전부 끝났고 새 제품 사건이 없는 상태.
     그래서 시간을 정해놓고 재지 않고 '정지할 때까지 기다린 뒤' 잰다.        */
  function waitQuiet(quietMs, timeoutMs) {
    return new Promise(function (res) {
      var t0 = performance.now(), lastFrame = performance.now(), n = 0, seen = 0;
      rec.on = true; rec.cb = []; rec.gaps = []; rec.last = 0; rec.count = 0;
      var iv = setInterval(function () {
        if (rec.count !== n) { n = rec.count; seen = n; lastFrame = performance.now(); }
        var quietFor = performance.now() - lastFrame;
        var elapsed  = performance.now() - t0;
        if (quietFor >= quietMs) {
          clearInterval(iv); rec.on = false;
          res({ reached: true, time_to_idle_ms: Math.round(elapsed - quietFor),
                frames_while_settling: seen, quiet_window_ms: quietMs });
        } else if (elapsed > timeoutMs) {
          clearInterval(iv); rec.on = false;
          res({ reached: false, gave_up_after_ms: Math.round(elapsed),
                frames_while_settling: seen, quiet_window_ms: quietMs });
        }
      }, 50);
    });
  }

  function measure(ms, poke) {
    start();
    var t0 = performance.now(), iv = null;
    if (poke) iv = setInterval(function () { poke(performance.now() - t0); }, 600);
    return wait(ms).then(function () { if (iv) clearInterval(iv); return stop(ms); });
  }

  window.__A1B_RUN = function (runtimeName, seconds) {
    var OUT = { runtime: runtimeName, states: {} };
    var W = (seconds || 3) * 1000;
    var D = window.JQ_DEV;
    if (!D) return Promise.resolve({ error: 'JQ_DEV 없음' });

    return Promise.resolve()
      .then(function () { D.open('order'); return wait(1500); })
      .then(function () {
        // World 캔버스 = 실제로 보이는 것 중 가장 큰 것. 런처 썸네일이 아니다
        var all = [], big = null;
        [].forEach.call(document.querySelectorAll('canvas'), function (c) {
          var r = c.getBoundingClientRect();
          all.push({ id: c.id || null, css_w: Math.round(r.width), css_h: Math.round(r.height),
                     buf_w: c.width, buf_h: c.height });
          if (r.width > 1 && r.height > 1 && (!big || r.width * r.height > big.w * big.h))
            big = { el: c, w: r.width, h: r.height };
        });
        OUT.viewport = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio };
        OUT.all_canvases = all;
        OUT.world_canvas = big ? { css_w: Math.round(big.w), css_h: Math.round(big.h),
                                   buf_w: big.el.width, buf_h: big.el.height,
                                   painted_px: big.el.width * big.el.height } : null;
        OUT.ua = navigator.userAgent;
      })

      /* ① TRUE IDLE — 고정 대기가 아니라 '정지할 때까지' 기다린 뒤 길게 잰다 */
      .then(function () { return waitQuiet(1000, 30000); })
      .then(function (q) { OUT.true_idle_settle = q; })
      .then(function () { return measure(W * 3); })   // 충분히 긴 창
      .then(function (s) { OUT.states.idle = s;
        s.definition = 'TRUE IDLE — 연속 1000ms 무프레임을 확인한 뒤 잰 창';
        s.canon_check = s.app_requested_frames === 0
          ? '✔ 실제 사건이 없으면 렌더링이 정지한다'
          : '⚠ 유휴에 ' + s.app_requested_frames + ' 프레임을 요청했다 — 프로토타입 회귀'; })

      /* ② FOCUS TRANSITION */
      .then(function () { var i = 0, ids = ['pay','store','session','auth','intake'];
        return measure(W, function () { D.focus(ids[i++ % ids.length]); }); })
      .then(function (s) { OUT.states.focus_transition = s; })

      /* ③ WORKING / DISTURBED — 그 자리만 진동 (m.breath) */
      .then(function () { D.focus('pay'); D.say('이거 고쳐줘'); D.qode(); return wait(200); })
      .then(function () { return measure(W); })
      .then(function (s) { OUT.states.working_disturbed = s; })

      /* ④ SETTLING → SETTLED */
      .then(function () { return measure(W); })
      .then(function (s) { OUT.states.settling = s; })

      /* ⑤ DEEP VIEW */
      .then(function () { D.focus('session'); D.deep(); return wait(300);
      }).then(function () { var i = 0;
        return measure(W, function () { D.focus(['session','store'][i++ % 2]); }); })
      .then(function (s) { OUT.states.deep_view = s; D.deep(); })

      /* ⑥ RUN = 관측 */
      .then(function () { D.run(); return wait(150); })
      .then(function () { return measure(W); })
      .then(function (s) { OUT.states.running_observe = s; try { D.run(); } catch (e) {} })

      /* ⑦ 참고 — render() 는 DOM 껍데기만 갱신한다. 캔버스 페인트는 rAF 안의 draw() 다.
            따라서 엔진 비교의 기준값은 위의 draw_ms(rAF 콜백 실측)이지 이 값이 아니다 */
      .then(function () { D.focus('store'); return wait(300); })
      /* ⑦ 진단 — A1b 의 방법(고정 1500ms 대기)을 그대로 재현해서 96 프레임의 원인을 확인한다.
            전이를 일으킨 직후 1500ms 만 기다리고 '유휴'라고 부르면 무슨 일이 생기는가 */
      .then(function () { D.focus('auth'); return wait(1500); })   // A1b 와 같은 대기
      .then(function () { return measure(W); })
      .then(function (s) { OUT.states.idle_a1b_method = s;
        s.definition = 'A1b 재현 — 전이 직후 고정 1500ms 대기 후 잰 창 (진짜 유휴가 아니다)';
        s.verdict = s.app_requested_frames > 0
          ? '⚠ ' + s.app_requested_frames + ' 프레임 — 가라앉는 중인데 유휴로 집계됐다'
          : '0 프레임 — 이번엔 1500ms 안에 가라앉았다'; })

      /* ⑧ 두 번째 TRUE IDLE — Qode 가 끝나고 판이 가라앉은 뒤에도 정지하는가 */
      .then(function () { return waitQuiet(1000, 30000); })
      .then(function (q) { OUT.true_idle_after_settled = q; })
      .then(function () { return measure(W * 2); })
      .then(function (s) { OUT.states.idle_after_settled = s;
        s.canon_check = s.app_requested_frames === 0
          ? '✔ 결과 이후에도 렌더링이 정지한다'
          : '⚠ 결과 이후 유휴에 ' + s.app_requested_frames + ' 프레임'; })

      .then(function () {
        var N = 200, t = [];
        for (var i = 0; i < N; i++) { var a = performance.now(); D.render(); t.push(performance.now() - a); }
        OUT.chrome_only_render = { n: N, p50: pct(t, 50), p95: pct(t, 95),
          note: 'DOM 껍데기만. 캔버스 비용 아님 — 엔진 비교에 쓰지 말 것' };
        if (performance.memory) OUT.js_heap_mb = +(performance.memory.usedJSHeapSize / 1048576).toFixed(1);
        return OUT;
      });
  };
})();
