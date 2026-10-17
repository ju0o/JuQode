'use strict';
/* Claude Code launch contract + run-event normalisation (V1-201 inputs; no adapter, no model call).
 * Source of every rule below: the H3 Live Probe (Claude Code 2.1.283, Evidence 44ca8a4) -- fixtures in tests/fixtures/claude-h3-live.
 *
 * What can and cannot be known BEFORE the process starts:
 *   - known: the argv we build, the binary identity, that restricted built-in tools come with `--strict-mcp-config`.
 *   - NOT known: the user's SessionStart hooks and effective permissions. Hooks ran BEFORE the `init` event in every probe call, so nothing read from
 *     `init` can stop them. `containment().attested` is therefore always false and says so; it is never a safety certificate. */
const path = require('node:path');
const fs = require('node:fs');
const { permissiveArgs, guardLaunch } = require('./identity');

/* the CLI itself requires a UUID for --session-id; here only what could be read as ANOTHER option or split into several arguments is refused */
const SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** tools that write files; `Edit(path)` is the permission RULE that Claude Code applied to a `Write` call (measured) -- covered only per exact path */
const FILE_WRITERS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const GRANT = /^([A-Za-z][A-Za-z0-9_]*)\((.+)\)$/;

/** @returns {{ok:true,args:string[],containment:object}|{ok:false,reason:string}} -- same argv order the session code always used */
function buildArgs({ sessionId, resume = false, allowedTools = [], tools = null } = {}) {
  if (typeof sessionId !== 'string' || !SESSION_TOKEN.test(sessionId)) return { ok: false, reason: 'bad-session-id' };
  const args = resume ? ['--resume', sessionId, '-p', '--output-format', 'stream-json', '--verbose']
                      : ['-p', '--output-format', 'stream-json', '--verbose', '--session-id', sessionId];
  for (const g of allowedTools) {
    const m = GRANT.exec(String(g));
    /* a grant is ONE tool and ONE scoped input: no bare tool, no list, no wildcard-only spec */
    if (!m || /[,\n\r\0]/.test(g) || /^[*?]+$/.test(m[2].trim())) return { ok: false, reason: 'unscoped-grant' };
  }
  if (allowedTools.length) args.push('--allowedTools', ...allowedTools);
  if (tools !== null) {
    if (typeof tools !== 'string') return { ok: false, reason: 'bad-tools' };
    /* a run that says "restricted tools" must not still expose connector (MCP) tools: `--tools ""` alone left 19 (H3 measured) */
    args.push('--tools', tools, '--strict-mcp-config');
  }
  const bad = permissiveArgs(args);
  if (bad.length) return { ok: false, reason: `permissive-arg:${bad[0]}` };
  return { ok: true, args, containment: containment({ tools }) };
}

/** What a launch may CLAIM. hooks/permissions are never verified before launch, so `attested` is always false. */
function containment({ tools = null } = {}) {
  return Object.freeze({
    builtinTools: tools === null ? 'default-set' : 'restricted-by-flag',
    mcp: tools === null ? 'not-restricted' : 'closed-by-flag',
    hooks: 'UNKNOWN',            // user SessionStart hooks start before `init`; they are not inspected and not disabled
    permissions: 'UNKNOWN',      // effective user/project/managed rules are not resolved before launch
    attested: false,
  });
}
/** Refuse a privileged (write-capable) launch when the caller demands attestation -- which this build can never give. */
const privilegedAllowed = (c, { requireAttestation = false, privileged = false } = {}) => !(privileged && requireAttestation && !c.attested);

const canon = (p, cwd, realpath, ci) => {
  let abs = path.resolve(cwd, String(p));
  if (realpath) { try { abs = realpath(abs); } catch { /* not there yet: keep the lexical path */ } }
  return ci ? abs.toLowerCase() : abs;
};
/** Does a grant like `Edit(hello.txt)` / `Edit(//abs/path)` name exactly this file? Tool-name equality is NOT assumed: the caller decides what a Write under an Edit rule means. */
function grantPath(grant, cwd, { realpath = null, caseInsensitive = false } = {}) {
  const m = GRANT.exec(String(grant));
  if (!m) return null;
  const spec = m[2].trim();
  if (/[*?[\]{}(),]/.test(spec)) return null;
  return { rule: m[1], file: canon(spec.startsWith('//') ? spec.slice(1) : spec, cwd, realpath, caseInsensitive) };
}
function coveredByGrant(grants, toolUse, cwd, opts = {}) {
  const file = toolUse?.input?.file_path ?? toolUse?.input?.path;
  if (!FILE_WRITERS.has(toolUse?.name) || typeof file !== 'string') return { covered: false, why: 'not-a-file-write' };
  const target = canon(file, cwd, opts.realpath, opts.caseInsensitive);
  for (const g of grants ?? []) {
    const gp = grantPath(g, cwd, opts);
    if (gp && gp.rule === 'Edit' && gp.file === target) return { covered: true, why: 'same-file', rule: g, toolName: toolUse.name };
  }
  return { covered: false, why: 'no-grant-for-this-file' };
}

/**
 * Everything knowable before the process exists, in one verdict. `bin` is the path that WILL be executed; `recorded` the identity stored for it
 * (path + sha256 + version). A mismatch of any kind -- another file, other bytes, another version -- refuses; so does an unsafe argv.
 * `ok:true` means "launchable with these claims" -- never "safe": hooks and effective permissions stay UNKNOWN (see containment()).
 */
function preflight({ recorded, bin, run, build, requireAttestation = false, privileged = false } = {}) {
  const built = buildArgs(build);
  if (!built.ok) return { ok: false, reason: built.reason };
  let real = null;
  try { real = fs.realpathSync(bin); } catch { return { ok: false, reason: 'binary-not-found' }; }
  if (!recorded || real !== recorded.path) return { ok: false, reason: 'not-the-recorded-binary' };
  const g = guardLaunch(recorded, run);
  if (!g.ok) return { ok: false, reason: g.reason };
  if (!privilegedAllowed(built.containment, { requireAttestation, privileged })) return { ok: false, reason: 'safety-unattested' };
  return { ok: true, args: built.args, containment: built.containment };
}

const parse = (lines) => lines.map((l) => (typeof l === 'string' ? (() => { try { return JSON.parse(l); } catch { return null; } })() : l)).filter(Boolean);

/** Files before/after as {name: sha256} maps; null on either side = nothing was observed, which is NOT "nothing changed". */
function fileEffect(before, after) {
  if (!before || !after) return { state: 'unobservable', changed: [] };
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...names].filter((n) => before[n] !== after[n]).sort();
  return { state: changed.length ? 'changed' : 'unchanged', changed };
}

/**
 * Normalise one run's stream-json events into facts. Judging (`problems`) is separate from reporting.
 * @param {object[]|string[]} events
 * @param {object} ctx { requestedSessionId, resume, callCwd, requestedModelAlias, claimsRestrictedTools, claimedTools, grants, exitCode, files:{before,after}, realpath }
 */
function summarizeRun(events, ctx = {}) {
  const ev = parse(events);
  const idx = (f) => ev.findIndex(f);
  const initAt = idx((e) => e.type === 'system' && e.subtype === 'init');
  const init = initAt >= 0 ? ev[initAt] : null;
  const result = ev.find((e) => e.type === 'result') ?? null;
  const hooksBeforeInit = initAt >= 0 && ev.slice(0, initAt).some((e) => e.type === 'system' && /^hook_/.test(e.subtype));
  const tools = init?.tools ?? [];
  const mcpTools = tools.filter((t) => t.startsWith('mcp__'));
  const toolUses = []; const results = new Map();
  for (const e of ev) {
    for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (e.type === 'assistant' && c.type === 'tool_use') toolUses.push({ id: c.id, name: c.name, input: c.input ?? {} });
      if (e.type === 'user' && c.type === 'tool_result') results.set(c.tool_use_id, { isError: c.is_error === true, content: String(c.content ?? '') });
    }
  }
  const denialEvents = ev.filter((e) => e.type === 'system' && e.subtype === 'permission_denied');
  const resultDenials = result?.permission_denials ?? [];
  const cwd = init?.cwd ?? ctx.callCwd;
  const denials = [...new Set([...denialEvents.map((d) => d.tool_use_id), ...resultDenials.map((d) => d.tool_use_id)])].map((id) => {
    const use = toolUses.find((t) => t.id === id); const r = results.get(id);
    return { toolUseId: id, tool: use?.name ?? denialEvents.find((d) => d.tool_use_id === id)?.tool_name ?? null, path: use?.input?.file_path ?? null,
      eventSeen: denialEvents.some((d) => d.tool_use_id === id), resultListed: resultDenials.some((d) => d.tool_use_id === id),
      toolResultError: Boolean(r?.isError), linked: Boolean(use) && Boolean(r?.isError) };
  });
  const writes = toolUses.filter((t) => FILE_WRITERS.has(t.name)).map((t) => {
    const r = results.get(t.id); const denied = denials.some((d) => d.toolUseId === t.id);
    return { id: t.id, tool: t.name, path: t.input.file_path ?? null, ran: Boolean(r) && !r.isError && !denied, denied,
      grant: coveredByGrant(ctx.grants, t, cwd, { realpath: ctx.realpath }) };
  });
  const model = { requestedAlias: ctx.requestedModelAlias ?? null, actual: init?.model ?? null };
  const isError = result ? result.is_error === true : null;
  const outcome = denials.length ? 'denied' : (!result ? 'unknown' : (isError || ctx.exitCode > 0 ? 'failed' : 'completed'));
  const s = {
    session: { requested: ctx.requestedSessionId ?? null, init: init?.session_id ?? null, result: result?.session_id ?? null },
    cwd: { call: ctx.callCwd ?? null, init: init?.cwd ?? null },
    model: { ...model, aliasIsNotActual: Boolean(model.requestedAlias && model.actual && model.requestedAlias !== model.actual) },
    tools: { exposed: tools, builtin: tools.filter((t) => !t.startsWith('mcp__')), mcp: mcpTools },
    hooksBeforeInit, toolUses, writes, denials,
    result: result ? { subtype: result.subtype, isError, terminalReason: result.terminal_reason ?? null, cost: result.total_cost_usd ?? null } : null,
    exitCode: ctx.exitCode ?? null, outcome, fileEffect: fileEffect(ctx.files?.before, ctx.files?.after),
  };
  s.session.match = s.session.init !== null && s.session.init === s.session.result && (s.session.requested === null || s.session.requested === s.session.init);
  s.cwd.followsCaller = s.cwd.init !== null && s.cwd.call !== null && path.resolve(s.cwd.init) === path.resolve(s.cwd.call);
  s.problems = problems(s, ctx);
  s.notes = [];                      // facts a reader must not mistake for success/failure
  if (s.outcome === 'denied' && s.exitCode === 0 && s.result?.subtype === 'success') s.notes.push('denied-despite-success-exit');
  if (s.fileEffect.state === 'unobservable') s.notes.push('file-effect-unobservable');
  return s;
}

function problems(s, ctx) {
  const p = [];
  if (!s.session.init) p.push('no-init');
  else if (!s.session.match) p.push('session-id-mismatch');
  if (s.session.init && !s.cwd.followsCaller && ctx.callCwd) p.push('init-cwd-differs-from-call');
  if (ctx.claimsRestrictedTools) {
    if (s.tools.mcp.length) p.push('mcp-exposed');
    if (ctx.claimedTools && s.tools.builtin.some((t) => !ctx.claimedTools.includes(t))) p.push('builtin-tools-beyond-claim');
  }
  for (const w of s.writes) if (w.ran && !w.grant.covered) p.push(`write-ran-without-grant:${w.path}`);
  for (const d of s.denials) if (!d.linked) p.push(`denial-not-linked:${d.toolUseId}`);
  return p;
}

module.exports = { preflight, buildArgs, containment, privilegedAllowed, grantPath, coveredByGrant, fileEffect, summarizeRun, FILE_WRITERS };
