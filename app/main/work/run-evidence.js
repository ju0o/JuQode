'use strict';

const { createHash } = require('node:crypto');
const { safeSnapshot } = require('./context.js');

const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
/* Accept one direct test command only. Lint/check/typecheck are useful evidence, but they do
 * not prove a criterion that says tests passed. Chained commands, pipelines, shell text, and
 * `echo 'npm test'` cannot establish a child test process's exit status. */
const testCommand = /^[ \t]*(?:npm[ \t]+(?:test|run[ \t]+test(?::[\w:-]+)?)|node[ \t]+--test|pytest|python[ \t]+-m[ \t]+pytest|cargo[ \t]+test|go[ \t]+test)(?:[ \t]+(?:[A-Za-z0-9_./:=,@+\\-]+|--?\[redacted\]))*[ \t]*$/i;
const directRunnerCommand = /^[ \t]*(?:node[ \t]+--test|pytest|python[ \t]+-m[ \t]+pytest|cargo[ \t]+test|go[ \t]+test)(?:[ \t]+(?:[A-Za-z0-9_./:=,@+\\-]+|--?\[redacted\]))*[ \t]*$/i;

function isTestCommand(command) {
  return typeof command === 'string' && testCommand.test(command);
}

function isDirectTestRunner(command) {
  if (typeof command !== 'string' || !directRunnerCommand.test(command)) return false;
  const tokens = command.trim().split(/\s+/);
  const args = tokens[0] === 'python' ? tokens.slice(3)
    : tokens[0] === 'node' ? tokens.slice(2)
      : tokens[0] === 'pytest' ? tokens.slice(1) : tokens.slice(2);
  /* A parsed count cannot prove a suite passed if the invocation selected only some cases.
   * Keep evidence to direct commands with positional paths only. This rejects Node's
   * --test-name-pattern, pytest's -k/-m/-s, Cargo's --skip/filter options and Go's -run. */
  return args.every((arg) => !arg.startsWith('-') &&
    !arg.split(/[\\/]+/).includes('..'));
}

function parsePayload(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return null; }
}

function resultBlocks(event) {
  return (Array.isArray(event?.message?.content) ? event.message.content : [])
    .flatMap((block, index) => block?.type === 'tool_result' && block.tool_use_id ? [{ block, index }] : []);
}

function redactedUnder(event, prefix) {
  const marker = event?.juqodeRedaction;
  if (marker?.applied !== true) return false;
  /* Signals saved by the immediately preceding schema version have the general marker only.
   * Treat their location as unknown rather than losing the disclosure on reconciliation. */
  if (!Array.isArray(marker.paths)) return true;
  return marker.paths.some((path) => Array.isArray(path) && prefix.every((part, index) => path[index] === part));
}

function testScopesForCriterion(criterion) {
  const text = String(criterion ?? '').toLowerCase();
  const scopes = [];
  if (/\bunit\b|단위|유닛/.test(text)) scopes.push('unit');
  if (/\bintegration\b|통합/.test(text)) scopes.push('integration');
  if (/\be2e\b|\bvisual\b|\bboot\b|\brestart\b|화면|시각/.test(text)) scopes.push('e2e');
  if (/\b(?:ui|screen|render|responsive|layout)\b/.test(text)) scopes.push('e2e');
  if (/\b(?:lint|type[\s-]?check(?:ing)?|static analysis|static check(?:s)?)\b/.test(text)) scopes.push('unsupported-check');
  const hasTestCriterion = /\b(?:test|tests|testing|persist(?:s|ence)?)\b|\uD14C\uC2A4\uD2B8/i.test(text);
  const wantsAll = /\b(?:all|every|full|entire)\b.*\b(?:test|tests|testing|suite)\b|\b(?:test|tests|testing|suite)\b.*\b(?:all|every|full|entire)\b|모든.*테스트|전체.*테스트|전부.*테스트/i.test(text);
  const namesSpecificTestScope = scopes.some((scope) => ['unit', 'integration', 'e2e'].includes(scope));
  /* "All unit tests" means the whole unit suite. It does not also demand a separate aggregate
   * test command; an unqualified "All tests" still requires the repository's full-suite command. */
  if (wantsAll && namesSpecificTestScope) {
    const named = scopes.filter((scope) => ['unit', 'integration', 'e2e'].includes(scope));
    scopes.splice(0, scopes.length, ...scopes.filter((scope) => !['unit', 'integration', 'e2e'].includes(scope)),
      ...named.map((scope) => `${scope}-all`));
  } else if (wantsAll) scopes.push('all');
  else if (!scopes.length && hasTestCriterion) scopes.push(wantsAll ? 'all' : 'any');
  if (/\b(?:restart|persistence|persist(?:s|ence)?)\b|\bafter\s+(?:an?\s+)?restart\b|재시작|재부팅|다시\s*켜|상태.{0,8}유지|저장.{0,8}유지|보존|영속/.test(text)) {
    scopes.push('e2e');
  }
  if (!scopes.length && /\b(?:app|application)\b.*\bboot\b|\bboot\b.*\b(?:app|application)\b/.test(text)) scopes.push('e2e');
  return [...new Set(scopes)];
}

function observedPassedTestCount(output) {
  const text = String(output ?? '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
  /* Accept structured runner summaries, not arbitrary prose such as "3 tests passed". When
   * TAP gives both totals and failures, a swallowed nonzero runner exit cannot hide failures. */
  const tap = (label) => [...text.matchAll(new RegExp(`(?:^|\\n)\\s*${label}\\s+(\\d+)\\s*(?:\\n|$)`, 'gi'))]
    .map((match) => match[1]);
  const totals = tap('(?:#|ℹ)\\s*tests');
  const passes = tap('(?:#|ℹ)\\s*pass');
  const failures = tap('(?:#|ℹ)\\s*fail');
  const skipped = tap('(?:#|ℹ)\\s*skipped');
  const cancelled = tap('(?:#|ℹ)\\s*cancelled');
  const todo = tap('(?:#|ℹ)\\s*todo');
  /* A child test file can write runner-shaped output before Node emits its own final summary.
   * Duplicate summary fields are ambiguous and never count as verification. */
  const total = totals.length === 1 ? totals[0] : null;
  const passed = passes.length === 1 ? passes[0] : null;
  const failed = failures.length === 1 ? failures[0] : null;
  if (total != null && passed != null && failed != null) {
    if (Number(failed) > 0) return 0;
    const noUnrunTests = [skipped, cancelled, todo].every((values) => values.length <= 1 && Number(values[0] ?? 0) === 0);
    return noUnrunTests && Number(passed) === Number(total) ? Number(passed) : null;
  }
  const jest = /^\s*Tests:\s*(?:(\d+)\s+failed,\s*)?(\d+)\s+passed,\s*(\d+)\s+total\s*$/mi.exec(text);
  if (jest) return Number(jest[1] ?? 0) === 0 ? Number(jest[2]) : 0;
  const mocha = /(?:^|\n)\s*(\d+) passing\s+\([^)]+\)\s*(?:\n|$)/i.exec(text);
  if (mocha) {
    const failing = /(?:^|\n)\s*(\d+) failing\s*(?:\n|$)/i.exec(text);
    return failing && Number(failing[1]) > 0 ? 0 : Number(mocha[1]);
  }
  const pytestSummaryLines = [...text.matchAll(/^=+[^=\n]*(?:failed|passed|skipped|deselected|xfailed|xpassed)[^=\n]*=+\s*$/gmi)];
  if (pytestSummaryLines.length) {
    /* Project-controlled pytest hooks can print a summary-shaped line. `-s` is rejected above,
     * and multiple summaries are ambiguous even when the final one reports no passing tests. */
    if (pytestSummaryLines.length !== 1) return null;
    const pytest = /^=+\s*(?:(\d+) failed,\s*)?(\d+) passed((?:,\s*\d+ (?:skipped|warnings?|deselected|xfailed|xpassed))*)\s+in\s+[\d.]+s\s*=+\s*$/i.exec(pytestSummaryLines[0][0]);
    const unrun = pytest && [...pytest[3].matchAll(/,\s*(\d+) (skipped|deselected|xfailed|xpassed)/gi)];
    if (pytest && Number(pytest[1] ?? 0) > 0) return 0;
    return pytest && unrun.every((match) => Number(match[1]) === 0) ? Number(pytest[2]) : null;
  }
  const cargoSummaries = [...text.matchAll(/^test result:\s*ok\.\s*(\d+) passed;\s*0 failed;[^\n]*$/gmi)];
  if (cargoSummaries.length) return cargoSummaries.length === 1 ? Number(cargoSummaries[0][1]) : null;
  /* `--- PASS` lines can be printed by package tests and do not prove which lines came from the
   * Go runner itself. Wait for an independently structured aggregate source before counting. */
  return null;
}

function testCommandMatchesScope(scope, evidence) {
  const command = String(evidence?.details?.command ?? evidence?.summary ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!isDirectTestRunner(command)) return false;
  if (scope === 'unit') return /(?:^|\s)(?:tests?|specs?)\/(?:unit(?:\/|\.|\s)|[^\s]*\.unit\.)/.test(command);
  if (scope === 'integration') return /(?:^|\s)(?:tests?|specs?)\/(?:integration(?:\/|\.|\s)|[^\s]*\.integration\.)/.test(command);
  if (scope === 'e2e') return /(?:^|\s)(?:tests?|specs?)\/(?:e2e|visual|boot)(?:\/|\.|\s)/.test(command);
  if (scope.endsWith('-all')) {
    /* The current safe aggregate contract is Node's built-in runner. Pytest discovery can be
     * narrowed by project config (`addopts=--ignore=...`) without reporting deselected tests.
     * Positional suite directories are also unsafe as proof: an exact-looking `tests/unit/`
     * could be a symlink to another suite. Only default Node discovery with no positional args
     * proves the full repository test set under this contract. */
    return command === 'node --test';
  }
  if (scope === 'all') return command === 'node --test';
  if (scope === 'unsupported-check') return false;
  return scope === 'any' && isDirectTestRunner(command);
}

function testScopeMatches(criterion, evidence) {
  return testScopesForCriterion(criterion).some((scope) => testCommandMatchesScope(scope, evidence));
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
    for (const [index, block] of blocks.entries()) {
      if (block?.type !== 'tool_use' || block.name !== 'Bash' ||
          typeof block.id !== 'string' || typeof block.input?.command !== 'string' ||
          !testCommand.test(block.input.command)) continue;
      const command = safeSnapshot(block.input.command);
      const commandPath = ['message', 'content', index, 'input', 'command'];
      pending.set(block.id, { command: command.safe.slice(0, 800),
        commandRedacted: command.redacted || redactedUnder(event, commandPath),
        directRunner: isDirectTestRunner(block.input.command) });
    }
    for (const { block, index } of resultBlocks(event)) {
      const call = pending.get(block.tool_use_id);
      if (!call) continue;
      pending.delete(block.tool_use_id);
      const rawOutput = outputOf(event, block);
      const output = safeSnapshot(rawOutput);
      const passedTestCount = call.directRunner ? observedPassedTestCount(rawOutput) : null;
      const outputPrefixes = [
        ['tool_use_result'],
        ['tool_use_result', 'stdout'], ['tool_use_result', 'stderr'], ['tool_use_result', 'content'],
        ['message', 'content', index, 'content'],
      ];
      const persistedOutputRedacted = outputPrefixes.some((prefix) => redactedUnder(event, prefix));
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
          tests_passed_count: passedTestCount,
          runner_invocation: call.directRunner ? 'direct' : 'project_script_or_wrapped',
          output_redacted: output.redacted || persistedOutputRedacted,
          output_redaction_rules: [...new Set([...output.rules,
            ...(persistedOutputRedacted ? event.juqodeRedaction.rules ?? [] : [])])],
          test_pass_claimed: false,
        },
      });
    }
  }
  return evidence;
}

module.exports = { isTestCommand, isDirectTestRunner, observedPassedTestCount, testCommandMatchesScope, testEvidenceFromSignals,
  testScopeMatches, testScopesForCriterion };
