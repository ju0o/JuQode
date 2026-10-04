'use strict';

const { createHash, randomUUID } = require('node:crypto');

const BUILDER_VERSION = 'juqode-context-v1';
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const SECRET_RULES = [
  ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['bearer_token', /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi],
  ['openai_key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['credential_assignment', /\b(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|password|secret)\s*[:=]\s*["']?[^\s"',;]{8,}["']?/gi],
];

function safeSnapshot(value) {
  let safe = String(value ?? '');
  const rules = [];
  for (const [name, pattern] of SECRET_RULES) {
    pattern.lastIndex = 0;
    if (pattern.test(safe)) {
      rules.push(name);
      pattern.lastIndex = 0;
      safe = safe.replace(pattern, '[redacted]');
    }
  }
  return { safe, redacted: rules.length > 0, rules };
}

function buildContextBundle({ project, task, userPrompt, now = () => new Date().toISOString() }) {
  if (!project?.id || !task?.id || task.project_id !== project.id) {
    throw new TypeError('ContextBundle requires a Task in the selected Project');
  }
  if (typeof userPrompt !== 'string' || !userPrompt.trim()) {
    throw new TypeError('ContextBundle requires the submitted request');
  }
  const criteria = Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria : [];
  const at = now();
  const criteriaText = criteria.map((item) => `- ${item.text}`).join('\n') || '- (none supplied)';
  const agentPrompt = [
    `Task goal:\n${task.goal}`,
    `Acceptance criteria:\n${criteriaText}`,
    `User request:\n${userPrompt.trim()}`,
  ].join('\n\n');
  const values = [
    { source_type: 'task_goal', source_ref: `task:${task.id}:goal`, content: task.goal },
    ...criteria.map((item) => ({
      source_type: 'acceptance_criterion',
      source_ref: `task:${task.id}:acceptance:${item.id}`,
      content: item.text,
    })),
    { source_type: 'user_request', source_ref: 'submission:user-request', content: userPrompt.trim() },
  ];
  const items = values.map((value) => {
    const snapshot = safeSnapshot(value.content);
    return {
      context_item_id: randomUUID(),
      source_type: value.source_type,
      source_ref: value.source_ref,
      content_digest: sha256(value.content),
      safe_content: snapshot.safe,
      selected_at: at,
      exclusion_metadata: snapshot.redacted ? [{ kind: 'secret_redaction', rules: snapshot.rules }] : [],
      human_note: null,
    };
  });
  const safePrompt = safeSnapshot(agentPrompt);
  const id = randomUUID();
  const bundle = {
    bundle_id: id,
    bundle_schema_version: 1,
    created_at: at,
    builder_version: BUILDER_VERSION,
    project_ref: project.id,
    task_ref: task.id,
    task_spec_digest: sha256(JSON.stringify({
      goal: task.goal,
      dependencies: task.dependencies ?? [],
      acceptanceCriteria: criteria,
    })),
    prompt_digest: sha256(agentPrompt),
    prompt_snapshot: safePrompt.safe,
    prompt_snapshot_redacted: safePrompt.redacted,
    workspace_capability: {
      source_type: 'project_workspace',
      source_ref: `project:${project.id}:root`,
      scope: 'project-root-cwd',
      filesystem_access: 'cwd-wide; normal OS permissions apply',
      selected_file_isolation: false,
    },
    selected_resources: [],
    exclusions: safePrompt.redacted
      ? [{ kind: 'secret_redaction', rules: safePrompt.rules }]
      : [],
    human_notes: [],
    items,
  };
  return { bundle, agentPrompt, contentDigest: sha256(JSON.stringify(bundle)) };
}

module.exports = { BUILDER_VERSION, buildContextBundle, safeSnapshot, sha256 };
