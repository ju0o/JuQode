/* V1-409 · one synthetic secret set through every place JuQode masks.
 *
 * Six paths mask or exclude: Quick Command run, Work Context, Run Evidence, Terminal,
 * Supervisor (stream persistence) and Git Evidence. They were written at different times with
 * two different pattern lists; this file pins what they have IN COMMON and states, as tests,
 * where they deliberately differ. All values are synthetic - no real credential, no auth file.
 *
 * `19` §C4 still holds: the display masking is a reduction, never a guarantee. These tests
 * prove the shapes below are covered; they do not prove a secret can not leak.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const { mask, start: qcStart } = require(path.join(R, 'app/main/qc/run.js'));
const { safeSnapshot, safeStructuredSnapshot } = require(path.join(R, 'app/main/work/context.js'));
const { testEvidenceFromSignals } = require(path.join(R, 'app/main/work/run-evidence.js'));
const { isExcludedPath } = require(path.join(R, 'app/main/evidence/exclude.js'));
const term = require(path.join(R, 'app/main/term/session.js'));
const guard = require(path.join(R, 'app/main/ipc-guard.js'));
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const A = 'A1b2C3d4E5f6G7h8I9j0';
/* name -> a value, and the substring that must never survive */
const COMMON = {
  github_classic: [`ghp_${A}${A}`, A],
  github_pat: [`github_pat_${A}${A}`, A],
  slack: ['xoxb-1234567890-abcdefghijkl', 'abcdefghijkl'],
  aws_key: ['AKIAABCDEFGHIJKLMNOP', 'ABCDEFGHIJKLMNOP'],
  openai_style: [`sk-${A}${A}`, A],
  anthropic_style: [`sk-ant-${A}${A}`, A],
  jwt: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuv', 'abcdefghijklmnopqrstuv'],
  bearer: ['Bearer abcdefghijklmnopqrstuvwx', 'abcdefghijklmnopqrstuvwx'],
  basic: ['Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng==', 'dXNlcjpwYXNzd29yZDEyMzQ1Ng'],
  url_password: ['https://bob:hunter22secret@example.com/x', 'hunter22secret'],
  env_assignment: ['API_TOKEN=abcd1234efgh5678', 'abcd1234efgh5678'],
  env_password: ['DB_PASSWORD: s3cr3tpassw0rd', 's3cr3tpassw0rd'],
  pem: ['-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'],
};
const around = (v) => `before ${v} after`;

for (const [name, [value, core]] of Object.entries(COMMON)) {
  test(`common set - ${name}: QC mask, Work Context, structured stream, Run Evidence and the IPC scrub all remove it`, () => {
    assert.ok(!mask(around(value)).includes(core), 'QC / Terminal display mask');
    assert.ok(!safeSnapshot(around(value)).safe.includes(core), 'Work Context / Task / Run persistence');
    assert.ok(!JSON.stringify(safeStructuredSnapshot({ text: around(value), nested: [{ out: around(value) }] })).includes(core), 'Supervisor stream persistence');
    const ev = testEvidenceFromSignals([
      { kind: 'tool_use', seq: 1, observed_at: 't1', payload: JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'npm test' } }] } }) },
      { kind: 'tool_result', seq: 2, observed_at: 't2', payload: JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: 'c', content: around(value), is_error: true }] } }) },
    ]);
    assert.ok(!JSON.stringify(ev).includes(core), 'Run Evidence');
    assert.ok(!guard.scrubString(around(value)).includes(core), 'text leaving for the renderer');
  });
}

test('the real Quick Command runner masks child output end to end (screen + the stored result)', async () => {
  const dir = tempDir('juqode-mask-qc');
  const secrets = Object.values(COMMON).filter(([v]) => !v.includes('\n'));
  const script = `process.stdout.write(${JSON.stringify(secrets.map(([v]) => v).join('\n'))})`;
  const seen = [];
  const out = await qcStart({ argv: [process.execPath, '-e', script], cwd: dir, onUpdate: (u) => seen.push(u) }).done;
  for (const [name, [, core]] of Object.entries(COMMON)) {
    if (COMMON[name][0].includes('\n')) continue;
    assert.ok(!out.output.includes(core), `result leaked ${name}`);
    assert.ok(!JSON.stringify(seen).includes(core), `live tail leaked ${name}`);
  }
});

test('the real Terminal masks output but runs and shows the line EXACTLY as typed (the documented exception)', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX shell protocol; Windows is a separate H1 case (not run)');
  const dir = tempDir('juqode-mask-term');
  const updates = [];
  const s = term.open({ cwd: dir, onUpdate: (u) => updates.push(u) });
  try {
    const [ghp, core] = COMMON.github_classic;
    const typed = `echo ${ghp}`;
    const r = s.write(typed);
    assert.strictEqual(r.ok, true);
    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (updates.some((u) => u.code !== null && u.code !== undefined)) { clearInterval(iv); resolve(); }
        else if (Date.now() - t0 > 10000) { clearInterval(iv); reject(new Error('line never ended')); }
      }, 20);
    });
    const done = updates.find((u) => u.code !== null && u.code !== undefined);
    assert.ok(!done.output.includes(core), 'output is masked');
    assert.strictEqual(done.line, typed, 'EXCEPTION: the command line is the user\'s own text and is not rewritten (19 C4)');
  } finally { s.stop(); }
});

test('Task text is masked where it is STORED (goal and criteria), not only where it is shown', () => {
  const db = openDb(':memory:');
  const p = repo.openProject(db, tempDir('juqode-mask-task'), 'm');
  const [ghp, core] = COMMON.github_classic;
  const t = repo.createTask(db, p.id, { goal: `use ${ghp}`, acceptanceCriteria: [`never print ${ghp}`] });
  assert.ok(!JSON.stringify(repo.getTask(db, t.id)).includes(core));
  const u = repo.updateTask(db, t.id, { goal: `again ${ghp}` });
  assert.ok(!JSON.stringify(u).includes(core));
});

test('Git Evidence excludes secret FILES by name before opening them (it does not mask file contents)', () => {
  for (const f of ['.env', '.env.local', 'config/.env.production', 'id_rsa', 'deploy/server.pem', 'creds/secret.key', 'x/id_ed25519.pub']) {
    assert.strictEqual(isExcludedPath(f), true, f);
  }
  assert.strictEqual(isExcludedPath('src/app.js'), false);
  // FINDING (PM decision, D-126a is the list): these usually hold credentials and are NOT on it.
  for (const f of ['.npmrc', '.netrc', '.pypirc', 'credentials.json', 'service-account.json', 'release.keystore']) {
    assert.strictEqual(isExcludedPath(f), false, `${f}: if this starts failing, D-126a was widened - update the contract`);
  }
});

/* ── where the paths differ, stated so a future change has to touch this file ── */
test('KNOWN DIFFERENCES between the display mask and the persistence mask', () => {
  // The display mask only takes UPPER-CASE env-var-shaped names: a compiler message such as
  // "Unexpected token: '}'" must survive (measured, see qc/run.js). Persistence takes any case.
  assert.ok(mask('password=hunter2hunter2').includes('hunter2hunter2'), 'display: lower-case assignment is left alone on purpose');
  assert.ok(!safeSnapshot('password=hunter2hunter2').safe.includes('hunter2hunter2'), 'persisted text: masked');
  assert.ok(mask("SyntaxError: Unexpected token: '}' at line 12").includes("Unexpected token: '}'"));
  // The Terminal / Quick Command mask is DISPLAY-only (19 C4): the user's own terminal still has the original.
});
