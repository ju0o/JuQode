#!/usr/bin/env python3
"""A1b — WebKitGTK 벤치 호스트. DISPOSABLE. 제품이 아니다.

Tauri v2 는 Linux 에서 webkit2gtk-4.1 웹뷰를 쓴다.
이 호스트는 **같은 엔진**을 직접 띄워 동결 렌더러의 실제 GUI 프레임 비용을 잰다.

측정하는 것   : WebKitGTK 4.1 의 Canvas 2D 렌더 비용 (Tauri 가 쓰는 바로 그 엔진)
측정 못 하는 것: Tauri 자체의 IPC/번들/권한 계층 — 그것은 별도이며 여기 값에 포함되지 않는다
"""
import gi, json, os, sys, time
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FROZEN = os.path.join(ROOT, "prototype", "index.html")          # 건드리지 않는다
HARNESS = os.path.join(os.path.dirname(__file__), "..", "bench", "harness.js")
OUT = os.path.join(os.path.dirname(__file__), "..", "results", "webkitgtk.json")
SECONDS = int(os.environ.get("BENCH_SECONDS", "3"))

t0 = time.time()
win = Gtk.Window(title="A1b bench · WebKitGTK")
win.set_default_size(1440, 900)
view = WebKit2.WebView()
s = view.get_settings()
s.set_enable_developer_extras(True)
s.set_enable_write_console_messages_to_stdout(True)
win.add(view); win.show_all()

state = {"loaded": None, "done": False}

def js(code, cb=None):
    def _done(v, res, _):
        try:
            r = v.run_javascript_finish(res)
            val = r.get_js_value() if hasattr(r, "get_js_value") else None
            if cb: cb(val.to_string() if val else None)
        except Exception as e:
            print("[JS-ERR]", e, file=sys.stderr)
            if cb: cb(None)
    view.run_javascript(code, None, _done, None)

def on_load(v, ev):
    if ev != WebKit2.LoadEvent.FINISHED or state["loaded"]:
        return
    state["loaded"] = time.time()
    harness = open(HARNESS, encoding="utf-8").read()
    def after_inject(_):
        rt = "tauri-equivalent webkitgtk %s.%s.%s" % (
            WebKit2.get_major_version(), WebKit2.get_minor_version(), WebKit2.get_micro_version())
        # 결과를 문자열로 받아 파이썬에서 저장한다
        code = ("__A1B_RUN(%s, %d).then(function(r){"
                "  r.startup = {page_loaded_ms: %d};"
                "  window.__A1B_OUT = JSON.stringify(r); });") % (
                json.dumps(rt), SECONDS, int((state["loaded"] - t0) * 1000))
        js(code)
        GLib.timeout_add(1000, poll)
    js(harness, after_inject)

def poll():
    def got(val):
        if val and val != "undefined" and val != "null":
            data = json.loads(val)
            data["host_note"] = ("WebKitGTK 를 직접 띄워 잰 값이다. Tauri 가 Linux 에서 쓰는 "
                                 "바로 그 엔진이지만, Tauri 의 IPC/권한/번들 계층은 포함되지 않는다.")
            try:
                with open("/proc/self/status") as f:
                    for line in f:
                        if line.startswith("VmRSS"):
                            data["process_rss_mb"] = round(int(line.split()[1]) / 1024, 1)
            except Exception:
                pass
            os.makedirs(os.path.dirname(OUT), exist_ok=True)
            with open(OUT, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print("[A1B-RESULT]", json.dumps(data, ensure_ascii=False))
            state["done"] = True
            Gtk.main_quit()
    if state["done"]:
        return False
    js("window.__A1B_OUT || null", got)
    return True

view.connect("load-changed", on_load)
view.load_uri("file://" + FROZEN)
GLib.timeout_add_seconds(180, lambda: (Gtk.main_quit(), False)[1])
Gtk.main()
if not state["done"]:
    print("[A1B-ERROR] 시간 초과 — 결과 없음", file=sys.stderr); sys.exit(1)
