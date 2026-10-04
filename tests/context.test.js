'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const { buildContextBundle } = require(path.join(R, 'app/main/work/context.js'));
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

test('ContextBundle digest describes the exact Task/request prompt sent, and scope is honest', () => {
  const project = { id: 'project-1', path: '/private/project' };
  const task = {
    id: 'task-1', project_id: 'project-1', goal: 'Fix the greeting',
    acceptance_criteria: [{ id: 'criterion-1', text: 'The greeting appears' }],
  };
  const built = buildContextBundle({ project, task, userPrompt: 'Use the existing component', now: () => 't1' });
  assert.match(built.agentPrompt, /Task goal:\nFix the greeting/);
  assert.match(built.agentPrompt, /Acceptance criteria:\n- The greeting appears/);
  assert.match(built.agentPrompt, /User request:\nUse the existing component/);
  assert.strictEqual(built.bundle.prompt_snapshot, built.agentPrompt);
  assert.strictEqual(built.bundle.workspace_capability.scope, 'project-root-cwd');
  assert.strictEqual(built.bundle.workspace_capability.filesystem_access,
    'cwd-wide; normal OS permissions apply');
  assert.strictEqual(built.bundle.workspace_capability.selected_file_isolation, false);
  assert.strictEqual(built.bundle.items.length, 3);
  assert.strictEqual(built.bundle.items[0].source_ref, 'task:task-1:goal');
  assert.strictEqual(built.bundle.items[1].source_ref, 'task:task-1:acceptance:criterion-1');
  assert.strictEqual(built.bundle.items[2].source_ref, 'submission:user-request');
  assert.ok(built.bundle.items.every((item) => item.context_item_id && item.content_digest && item.selected_at));
  assert.ok(!JSON.stringify(built.bundle).includes('/private/project'),
    'absolute project paths are not copied into a ContextBundle');
});

test('ContextBundle keeps a digest but redacts secret-like content from snapshots', () => {
  const project = { id: 'project-2' };
  const task = { id: 'task-2', project_id: 'project-2', goal: 'Use API key: sk-123456789012345678901234', acceptance_criteria: [] };
  const built = buildContextBundle({ project, task, userPrompt: 'Run the focused check', now: () => 't2' });
  const json = JSON.stringify(built.bundle);
  assert.ok(built.bundle.prompt_digest);
  assert.ok(built.bundle.prompt_snapshot_redacted);
  assert.ok(!json.includes('sk-123456789012345678901234'));
  assert.ok(json.includes('[redacted]'));
  assert.ok(built.bundle.exclusions.some((entry) => entry.kind === 'secret_redaction'));
});

test('Run ContextBundle is durable, linked once, and immutable in SQLite', () => {
  const db = openDb(':memory:');
  try {
    const project = repo.openProject(db, tempDir('juqode-context-'), 'Context test');
    const task = repo.createTask(db, project.id, {
      goal: 'Keep the context this Run received', acceptanceCriteria: ['The snapshot is readable'],
    });
    const work = repo.beginWork(db, project.id, 'Inspect context', { taskId: task.id }).work;
    const built = buildContextBundle({ project, task, userPrompt: 'Inspect context' });
    const saved = repo.saveRunContextBundle(db, work.id, built);
    assert.strictEqual(saved.id, built.bundle.bundle_id);
    assert.strictEqual(saved.work_id, work.id);
    assert.deepStrictEqual(saved.bundle, built.bundle);
    assert.deepStrictEqual(repo.saveRunContextBundle(db, work.id, built), saved,
      'replaying the same insert is idempotent');
    assert.throws(() => repo.saveRunContextBundle(db, work.id, {
      ...built, bundle: { ...built.bundle, bundle_id: 'a-different-bundle' },
    }), /already frozen/);
    assert.throws(() => db.prepare('update run_context_bundle set bundle_json = ? where id = ?')
      .run('{}', saved.id), /immutable/);
    assert.throws(() => db.prepare('delete from run_context_bundle where id = ?').run(saved.id), /immutable/);
  } finally { db.close(); }
});
