'use strict';

const { createHash, randomUUID } = require('node:crypto');

const BUILDER_VERSION = 'juqode-context-v1';
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

const SECRET_RULES = [
  ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['bearer_token', /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi],
  ['provider_token', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|sk-ant-[A-Za-z0-9_-]{20,})\b/g],
  ['openai_key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['credential_assignment', /\b(?:[\w.-]*(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|auth(?:orization)?[\s_-]?(?:token)?|proxy[\s_-]?authorization|cookie|set[\s_-]?cookie|credential|token|password|passwd|secret(?:[\s_-]?access[\s_-]?key)?|private[\s_-]?key|client[\s_-]?secret))\b\s*[:=]\s*["']?[^\s"',;]{4,}["']?/gi],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['basic_auth', /\bBasic\s+[A-Za-z0-9+/=]{16,}/g],
  ['url_credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi],
];
const SECRET_FIELD_NAME = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|proxy[_-]?authorization|set[_-]?cookie|cookie|credential|client[_-]?secret|token|password|passwd|secret|private[_-]?key)/i;

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

/* A Task Run keeps structured signal shape for later observation, but every persisted string
 * crosses the same redaction boundary. The in-memory event still reaches the reducer unchanged. */
function safeStructuredSnapshot(value) {
  if (typeof value === 'string') return safeSnapshot(value).safe;
  if (Array.isArray(value)) return value.map(safeStructuredSnapshot);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item], index) => {
      const keySnapshot = safeSnapshot(key);
      const redactKey = keySnapshot.redacted;
      return [redactKey ? `[redacted-key:${index}]` : key,
        SECRET_FIELD_NAME.test(key) ? '[redacted]' : safeStructuredSnapshot(item)];
    }));
  }
  return value;
}

function redactionRules(value) {
  const rules = new Set();
  const visit = (item) => {
    if (typeof item === 'string') {
      for (const rule of safeSnapshot(item).rules) rules.add(rule);
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (SECRET_FIELD_NAME.test(key)) rules.add('secret_field_name');
        for (const rule of safeSnapshot(key).rules) rules.add(`object_key_${rule}`);
        visit(child);
      }
    }
  };
  visit(value);
  return [...rules];
}

/* Paths identify which persisted event fields were redacted without ever recording their
 * contents. Downstream evidence can carry an honest redaction notice for the relevant field. */
function redactionLocations(value, path = []) {
  if (typeof value === 'string') {
    const snapshot = safeSnapshot(value);
    return snapshot.redacted ? [{ path, rules: snapshot.rules }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => redactionLocations(item, [...path, index]));
  }
  if (value && typeof value === 'object') {
    const locations = [];
    for (const [key, item, index] of Object.entries(value).map(([k, v], i) => [k, v, i])) {
      const keySnapshot = safeSnapshot(key);
      const secretField = SECRET_FIELD_NAME.test(key);
      const safeKey = keySnapshot.redacted ? `[redacted-key:${index}]` : key;
      if (secretField || keySnapshot.redacted) {
        locations.push({ path: [...path, safeKey], rules: [
          ...(secretField ? ['secret_field_name'] : []),
          ...keySnapshot.rules.map((rule) => `object_key_${rule}`),
        ] });
      }
      if (!secretField) locations.push(...redactionLocations(item, [...path, safeKey]));
    }
    return locations;
  }
  return [];
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
    const priorRedaction = value.content.includes('[redacted]');
    return {
      context_item_id: randomUUID(),
      source_type: value.source_type,
      source_ref: value.source_ref,
      content_digest: sha256(value.content),
      safe_content: snapshot.safe,
      selected_at: at,
      exclusion_metadata: snapshot.redacted || priorRedaction
        ? [{ kind: 'secret_redaction', rules: [...snapshot.rules, ...(priorRedaction ? ['upstream_secret_redaction'] : [])] }]
        : [],
      human_note: null,
    };
  });
  const safePrompt = safeSnapshot(agentPrompt);
  const priorRedaction = agentPrompt.includes('[redacted]');
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
    prompt_snapshot_redacted: safePrompt.redacted || priorRedaction,
    workspace_capability: {
      source_type: 'project_workspace',
      source_ref: `project:${project.id}:root`,
      scope: 'project-root-cwd',
      filesystem_access: 'cwd-wide; normal OS permissions apply',
      selected_file_isolation: false,
    },
    selected_resources: [],
    exclusions: safePrompt.redacted || priorRedaction
      ? [{ kind: 'secret_redaction', rules: [...safePrompt.rules, ...(priorRedaction ? ['upstream_secret_redaction'] : [])] }]
      : [],
    human_notes: [],
    items,
  };
  return { bundle, agentPrompt, contentDigest: sha256(JSON.stringify(bundle)) };
}

module.exports = { BUILDER_VERSION, buildContextBundle, safeSnapshot, safeStructuredSnapshot,
  redactionRules, redactionLocations, sha256 };
