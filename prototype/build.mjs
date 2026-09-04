/* prototype/build.mjs
 *
 * src/ 를 하나의 자기완결 index.html 로 합친다.
 *
 * 왜 합치는가: 형제 파일(app.css / data.js / app.js)에 의존하면
 * index.html 하나만 전달되는 경로(브라우저 저장 · 파일 복사 · 잘못된 branch)에서
 * file:// 로 열 때 ERR_FILE_NOT_FOUND 로 조용히 깨진다. 실제로 그렇게 깨졌다.
 * 결과물은 외부 요청이 0건이므로 어디에 두어도 열린다.
 *
 * 실행:  node build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, 'src', f), 'utf8');

const css = src('app.css');
const data = src('data.js');
const app = src('app.js');
let html = src('index.template.html');

// </script> 가 인라인 스크립트를 조기 종료하는 것을 막는다
const safe = (s) => s.replace(/<\/script>/gi, '<\\/script>');

html = html.replace('/*{{CSS}}*/', () => '\n' + css + '\n');
html = html.replace('/*{{JS}}*/', () => '\n'
  + '/* ── src/data.js ─────────────────────────────────── */\n' + safe(data)
  + '\n/* ── src/app.js ──────────────────────────────────── */\n' + safe(app) + '\n');

if (html.includes('{{CSS}}') || html.includes('{{JS}}')) {
  throw new Error('플레이스홀더가 남았다 — 템플릿을 확인하라');
}
for (const bad of ['src="app.js"', 'src="data.js"', 'href="app.css"', 'type="module"']) {
  if (html.includes(bad)) throw new Error(`외부 참조가 남았다: ${bad}`);
}

writeFileSync(join(here, 'index.html'), html);
const ext = (html.match(/<(?:script|link|img)\b[^>]*\b(?:src|href)\s*=/gi) || []).length;
console.log(`index.html 생성 · ${(html.length / 1024).toFixed(1)} KB · 외부 요청 ${ext}건`);
if (ext !== 0) { console.error('실패: 외부 요청이 0이어야 한다'); process.exit(1); }
