/* A1 실험 3 — Agent 프로세스 경계 (일회용)
 * 묻는 것: 코딩 에이전트 CLI 를 자식 프로세스로 띄우고
 *          구조화된 Event 를 스트리밍으로 받아 저장할 수 있는가?
 *          (No Fake Motion = Event 없이는 화면이 움직이지 않는다 의 전제)
 * 버릴 것: 이 파일. 제품 코드가 아니다. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/* 코딩 에이전트 흉내 — 줄 단위 JSON 을 내보내고, 하나는 일부러 깨뜨린다 */
const FAKE_AGENT = `
import sys, json, time
for e in [
  {"type":"agent.started","qode":"q1"},
  {"type":"file.read","path":"src/payments/gateway.ts"},
  {"type":"file.edited","path":"src/payments/gateway.ts","added":12,"removed":3},
  {"type":"command.run","cmd":"npm test"},
]:
    print(json.dumps(e), flush=True); time.sleep(0.02)
print("이건 JSON 이 아니다 — 에이전트는 사람 말도 섞어 뱉는다", flush=True)
print(json.dumps({"type":"agent.finished","ok":True}), flush=True)
sys.stderr.write("warn: something on stderr\\n")
`;

const child = spawn('python3', ['-c', FAKE_AGENT], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: '/tmp',                       // 작업 디렉터리를 강제한다
  env: { PATH: process.env.PATH },   // 환경을 물려주지 않는다 (비밀 누출 차단)
});

const events = [], unparsed = [], stderr = [];
const t0 = Date.now();
createInterface({ input: child.stdout }).on('line', (line) => {
  if (!line.trim()) return;
  try { events.push({ at: Date.now() - t0, ...JSON.parse(line) }); }
  catch { unparsed.push(line); }        // 버리지 않는다 — Raw 는 삭제하지 않는다(D-010)
});
createInterface({ input: child.stderr }).on('line', (l) => stderr.push(l));

child.on('close', (code) => {
  console.log(JSON.stringify({
    exit_code: code,
    structured_events: events.length,
    unparsed_lines: unparsed.length,
    stderr_lines: stderr.length,
    env_leak_test: '자식이 받은 env 키 수 = PATH 하나만 넘겼다',
    first_event: events[0],
    last_event: events[events.length - 1],
    unparsed_sample: unparsed[0],
  }, null, 2));
});
