"""Mutation sweep for the RENDERER.

    W=2 python3 scripts/mutate/sweep-renderer.py app/renderer/screens/sc02.js …

Each mutant is judged by the unit suite AND the visual e2e. Five defects in this runner itself
were found the hard way during the run; every one of them is a comment below, because each
reported a wrong answer rather than an error.
"""
import json, os, subprocess, sys, threading
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
S = os.environ.get('SWEEP_DIR') or os.path.join(REPO, '.mutate-work')
WORKERS = int(os.environ.get('W', '2'))
FILES = sys.argv[1:]

def sites(rel):
    out = subprocess.run([sys.executable, os.path.join(REPO, 'scripts/mutate/gen.py'), rel],
                         capture_output=True, text=True)
    return json.loads(out.stdout or '[]')

def worker_dir(i):
    d = os.path.join(S, f'w{i}')
    if os.path.isdir(d):
        return d
    os.makedirs(d, exist_ok=True)
    # --exclude=dist is not tidiness: the packaged Electron build is ~815 MB and four copies
    # filled the 7.5 GB tmpfs, which makes the suite fail intermittently and unreadably.
    subprocess.run(f"cd {REPO} && tar --exclude=node_modules --exclude=.git --exclude=tmp-visual "
                   f"--exclude=dist --exclude=.mutate-work -cf - . | tar -xf - -C {d}",
                   shell=True, check=True)
    os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(d, 'node_modules'))
    return d

DIRS = [worker_dir(i) for i in range(WORKERS)]
LOCKS = [threading.Lock() for _ in range(WORKERS)]

def run_one(pair):
    n, site = pair
    w = n % WORKERS
    with LOCKS[w]:
        d = DIRS[w]
        p = os.path.join(d, site['rel'])
        # The baseline is re-read from the REPO every time, so DO NOT edit a file under sweep
        # while this is running — the assert below is what tells you that you did.
        orig = open(os.path.join(REPO, site['rel']), encoding='utf-8').read()
        ctx = site['ctx']
        assert orig.count(ctx) == 1, f"{site['rel']}: context no longer unique (edited mid-sweep?)"
        at = site['at']
        newctx = ctx[:at] + site['new'] + ctx[at + len(site['old']):]
        open(p, 'w', encoding='utf-8').write(orig.replace(ctx, newctx, 1))
        try:
            # The UNIT suite first — it is fast, and several renderer claims are checked there
            # (a source assertion about a guard, a copy key, a card size). Judging renderer
            # mutants by the e2e alone under-reports kills; the first pass did exactly that.
            unit = subprocess.run(['node', '--test', '--test-timeout=60000']
                                  + [f'tests/{f}' for f in sorted(os.listdir(os.path.join(d, 'tests')))
                                     if f.endswith('.test.js')],
                                  cwd=d, capture_output=True, text=True, timeout=180)
            # Judge by the EXIT CODE. A file that times out prints `not ok 1 - tests/x.test.js`
            # AND `# fail 0`, so a summary-only check reports a killed mutant as a survivor.
            if unit.returncode != 0 or '\n# fail 0\n' not in unit.stdout:
                return {'rel': site['rel'], 'old': site['old'], 'new': site['new'],
                        'ctx': ' '.join(ctx.split())[:110], 'killed': True, 'by': 'unit'}
            # A CDP port per worker: two copies of the e2e on 9223 fail EACH OTHER, which turns
            # a survivor into a "kill" with no mutation involved.
            env = {**os.environ, 'JUQODE_E2E_PORT': str(9300 + w * 10)}
            proc = subprocess.Popen(['node', 'tests/e2e/visual.mjs'], cwd=d, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, start_new_session=True)
            try:
                out, _ = proc.communicate(timeout=420)
                killed = proc.returncode != 0 or 'visual+behaviour: PASS' not in out
            except subprocess.TimeoutExpired:
                # start_new_session + killpg, or per-file `node tests/*.test.js` children
                # survive as orphans — twelve of them ran for 38 minutes once.
                os.killpg(proc.pid, 9)
                proc.communicate()
                killed = True
        finally:
            open(p, 'w', encoding='utf-8').write(orig)
    return {'rel': site['rel'], 'old': site['old'], 'new': site['new'],
            'ctx': ' '.join(ctx.split())[:110], 'killed': killed, 'by': 'e2e' if killed else None}

allsites = []
for f in FILES:
    allsites += sites(f)
print(f'{len(allsites)} renderer mutants across {len(FILES)} files, {WORKERS} workers', flush=True)

results = []
with ThreadPoolExecutor(max_workers=WORKERS) as ex:
    for i, res in enumerate(ex.map(run_one, list(enumerate(allsites)))):
        results.append(res)
        if not res['killed']:
            print(f"SURVIVED  {res['rel']}  {res['old']!r} -> {res['new']!r}\n          {res['ctx']}", flush=True)
        if (i + 1) % 10 == 0:
            print(f'  … {i+1}/{len(allsites)}', flush=True)

surv = [r for r in results if not r['killed']]
json.dump(results, open(os.path.join(S, 'results.json'), 'w'), indent=1)
print(f"\n=== {len(results)} mutants · {len(results)-len(surv)} killed · {len(surv)} SURVIVED ===")
