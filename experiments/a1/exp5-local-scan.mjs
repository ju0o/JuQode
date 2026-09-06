/* A1 실험 5 — 결정적 로컬 스캔의 비용과 수확 (일회용)
 * 묻는 것: AI 없이 로컬에서만, 얼마나 빨리, 무엇을 확실히 알 수 있는가?
 *          (A1-2 로컬/AI 경계는 이 수확량이 정한다)
 * 버릴 것: 이 파일. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = process.argv[2] || '.';
const SKIP = new Set(['node_modules','.git','dist','build','.next','target','venv','__pycache__','.venv']);
const t0 = Date.now();
let files = 0, bytes = 0, skippedDirs = 0;
const byExt = {}, entryHints = [], routeHints = [], deps = {};

function walk(dir, depth) {
  if (depth > 12) return;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.isSymbolicLink()) continue;                 // 심링크는 따라가지 않는다
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) { skippedDirs++; continue; }
      walk(p, depth + 1); continue;
    }
    if (!e.isFile()) continue;
    files++;
    let sz = 0; try { sz = statSync(p).size; } catch {}
    bytes += sz;
    const x = extname(e.name) || '(none)';
    byExt[x] = (byExt[x] || 0) + 1;

    const rel = p.slice(root.length + 1);
    if (/^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|requirements\.txt|Dockerfile|docker-compose\.ya?ml)$/.test(e.name))
      entryHints.push(rel);
    if (/(^|\/)(routes?|api|pages|app|controllers|handlers)(\/|$)/i.test(rel)) routeHints.push(rel);
    if (e.name === 'package.json' && sz < 400000) {
      try { const j = JSON.parse(readFileSync(p, 'utf8'));
        Object.assign(deps, j.dependencies || {}); } catch {}
    }
  }
}
walk(root, 0);
const ms = Date.now() - t0;
const top = Object.entries(byExt).sort((a,b)=>b[1]-a[1]).slice(0,8);
console.log(JSON.stringify({
  root, elapsed_ms: ms, files, mb: +(bytes/1048576).toFixed(1), skipped_dirs: skippedDirs,
  files_per_sec: Math.round(files / (ms/1000 || 1)),
  top_extensions: Object.fromEntries(top),
  manifest_files: entryHints.slice(0,6),
  route_like_paths: routeHints.length,
  declared_deps: Object.keys(deps).length,
  dep_sample: Object.keys(deps).slice(0,8),
}, null, 2));
