'use strict';

const { createHash } = require('node:crypto');
const { safeSnapshot } = require('./context.js');

const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const testCommand = /(?:^|[;&|\s])(?:npm\s+(?:run\s+)?(?:test(?::[\w:-]+)?|check|lint|typecheck)|node\s+--test|pytest|python\s+-m\s+pytest|cargo\s+test|go\s+test)(?:\s|$)/i;

function parsePayload(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return null; }
}

function resultBlocks(event) {
  return (Array.isArray(event?.message?.content) ? event.message.content : [])
    .filter((block) => block?.type === 'tool_result' && block.tool_use_id);
}

function outputOf(event, block) {
  const result = event?.tool_use_result;
  const pieces = [];
  if (typeof result === 'string') pieces.push(result);
  else if (result && typeof result === 'object') {
    for (const key of ['stdout', 'stderr', 'content']) {
      if (typeof result[key] === 'string') pieces.push(result[key]);
    }
  }
  if (!pieces.length && typeof block?.content === 'string') pieces.push(block.content);
  else if (!pieces.length && Array.isArray(block?.content)) pieces.push(...block.content.map((item) => item?.text ?? ''));
  return [...new Set(pieces.filter(Boolean))].join('\n');
}

function testEvidenceFromSignals(signals) {
  const pending = new Map();
  const evidence = [];
  for (const signal of signals) {
    const event = parsePayload(signal.payload);
    if (!event || typeof event !== 'object') continue;
    const blocks = Array.isArray(event?.message?.content) ? event.message.content : [];
    for (const block of blocks) {
      if (block?.type !== 'tool_use' || block.name !== 'Bash' ||
          typeof block.id !== 'string' || typeof block.input?.command !== 'string' ||
          !testCommand.test(block.input.command)) continue;
      const command = safeSnapshot(block.input.command);
      pending.set(block.id, { command: command.safe.slice(0, 800), commandRedacted: command.redacted });
    }
    for (const block of resultBlocks(event)) {
      const call = pending.get(block.tool_use_id);
      if (!call) continue;
      pending.delete(block.tool_use_id);
      const rawOutput = outputOf(event, block);
      const output = safeSnapshot(rawOutput);
      const state = block.is_error === true ? 'error' : block.is_error === false ? 'returned' : 'unknown';
      const exitMatch = rawOutput.match(/(?:^|\n)\s*Exit code:\s*(\d+)\s*(?:\n|$)/i);
      const exitCode = Number.isInteger(event?.tool_use_result?.exitCode)
        ? event.tool_use_result.exitCode : (exitMatch ? Number(exitMatch[1]) : null);
      const outputDigest = digest(output.safe);
      evidence.push({
        kind: 'test_command',
        source_ref: block.tool_use_id,
        observed_at: signal.observed_at,
        summary: call.command,
        content_digest: digest(JSON.stringify({ command: call.command, outputDigest, state, exitCode })),
        details: {
          command: call.command,
          command_redacted: call.commandRedacted,
          result_state: state,
          exit_code: exitCode,
          output_digest: outputDigest,
          output_excerpt: output.safe.slice(0, 1200),
          output_truncated: output.safe.length > 1200,
          output_redacted: output.redacted,
          output_redaction_rules: output.rules,
          test_pass_claimed: false,
        },
      });
    }
  }
  return evidence;
}

module.exports = { testEvidenceFromSignals };
