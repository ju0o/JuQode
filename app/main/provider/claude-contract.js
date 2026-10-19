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
const crypto = require('node:crypto');

/* the CLI itself requires a UUID for --session-id; here only what could be read as ANOTHER option or split into several arguments is refused */
const SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** tools that write files; `Edit(path)` is the permission RULE that Claude Code applied to a `Write` call (measured) -- covered only per exact path */
const FILE_WRITERS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const GRANT = /^([A-Za-z][A-Za-z0-9_]*)\((.+)\)$/;

/** A file-tool spec that names a pattern/anywhere rather than one file: wildcard-only (double star, star-slash-star, slash-double-star, dot-slash-star-star, tilde variants), or reaching out of the project (`//abs`, `~`, `..`).
 *  ONE predicate for the launch grant gate and for the project's allow rules. A directory-limited pattern (`src/**`) is not judged here (OPEN: scope semantics unmeasured). */
const fileSpecWide = (spec) => /^[*?/\\.~]+$/.test(spec) || /^(\/\/|~)/.test(spec) || spec.split(/[\\/]/).includes('..');

/** Why a grant is NOT one tool and one narrow input, or null. A grant that is wider than, or reads differently from, what a card could show is refused here too (the
 *  authoritative gate), not only where the model's path is first turned into a spec. File-ish specs: no wildcard, no `..`, no `~` (Claude expands it to the home folder),
 *  no absolute path, no backslash, no invisible/control character, no edge whitespace. Bash: one non-wildcard prefix (`cmd:*`) or one exact command. */
function grantRefusal(g) {
  const m = GRANT.exec(String(g));
  if (!m || typeof g !== 'string' || /[,\n\r\0]/.test(g)) return 'unscoped-grant';
  const spec = m[2];
  if (spec !== spec.trim() || !spec || /[\p{Cc}\p{Cf}]/u.test(spec) || /^[*?]+$/.test(spec)) return 'unscoped-grant';
  if (m[1] === 'Bash') { const cmd = spec.replace(/:\*$/, ''); return /^[^*?]+(:\*)?$/.test(spec) && spec !== ':*' && cmd === cmd.trim() ? null : 'unscoped-grant'; }
  if (/[*?[\]{}!\\]/.test(spec) || /^[~/]/.test(spec) || fileSpecWide(spec)) return 'unscoped-grant';
  return null;
}

/** @returns {{ok:true,args:string[],containment:object}|{ok:false,reason:string}} -- same argv order the session code always used */
function buildArgs({ sessionId, resume = false, allowedTools = [], tools = null } = {}) {
  if (typeof sessionId !== 'string' || !SESSION_TOKEN.test(sessionId)) return { ok: false, reason: 'bad-session-id' };
  const args = resume ? ['--resume', sessionId, '-p', '--output-format', 'stream-json', '--verbose']
                      : ['-p', '--output-format', 'stream-json', '--verbose', '--session-id', sessionId];
  if (!Array.isArray(allowedTools)) return { ok: false, reason: 'unscoped-grant' };
  for (const g of allowedTools) if (grantRefusal(g)) return { ok: false, reason: 'unscoped-grant' };
  if (allowedTools.length) args.push('--allowedTools', ...allowedTools);
  if (tools !== null) {
    /* a tool LIST of plain names only: `default` (= every built-in tool), `*`, `Bash(*)` or a flag-looking token would widen what the caller said */
    if (typeof tools !== 'string' || (tools !== '' && !tools.split(',').every((t) => /^[A-Za-z][A-Za-z0-9_]*$/.test(t) && t !== 'default'))) return { ok: false, reason: 'bad-tools' };
    /* a run that says "restricted tools" must not still expose connector (MCP) tools: `--tools ""` alone left 19 (H3 measured) */
    args.push('--tools', tools, '--strict-mcp-config');
  }
  const bad = permissiveArgs(args);
  if (bad.length) return { ok: false, reason: `permissive-arg:${bad[0]}` };
  return { ok: true, args, containment: containment({ tools }) };
}

/* The project's OWN Claude settings (`<project>/.claude/settings.json`, `settings.local.json`) are read by the CLI whatever we pass, and a few keys widen what the run may do beyond
 * what any JuQode screen shows: a permission mode that stops asking, an unscoped allow rule (bare tool / wildcard-only), extra directories. Those are refused BEFORE a start or a
 * resume. A file that exists but cannot be read or parsed is UNKNOWN, and unknown is refused. Scoped allow rules are NOT judged here (product decision, see OPEN). The user's
 * and managed settings are never read by JuQode: they stay UNKNOWN (containment().permissions). */
const PERMISSIVE_MODES = new Set(['bypasspermissions', 'acceptedits', 'auto']);
/* bare tool names that only READ the project: a bare allow rule for them does not widen what a run may WRITE or execute. Anything else bare (Edit, Write, Bash, NotebookEdit,
 * WebFetch, WebSearch, mcp__*) is refused; WebSearch / mcp__* are refused only because their risk is not measured (OPEN). */
const READ_ONLY_BARE = new Set(['Read', 'Glob', 'Grep', 'LS']);
function allowRuleWidens(rule) {
  const m = typeof rule === 'string' ? /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\(([\s\S]*)\))?\s*$/.exec(rule) : null;
  if (!m) return true;
  const [, tool, inner] = m;
  if (inner === undefined) return !READ_ONLY_BARE.has(tool);
  const spec = inner.trim();
  if (/^[*?:\s]*$/.test(spec)) return true;                 // `Bash()`, `Bash(*)`, `Bash(:*)`
  return FILE_WRITERS.has(tool) && fileSpecWide(spec);       
}
function projectSettingsRefusal(projectPath) {
  /* an unknown project folder is not "no settings" */
  if (typeof projectPath !== 'string' || !projectPath) return { reason: 'project-path-unknown', source: null };
  for (const name of ['settings.json', 'settings.local.json']) {
    const file = path.join(String(projectPath), '.claude', name);
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) continue;
      return { reason: 'project-settings-unreadable', source: name };
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { reason: 'project-settings-unreadable', source: name };
    const perm = doc.permissions;
    if (perm == null) continue;
    if (typeof perm !== 'object' || Array.isArray(perm)) return { reason: 'project-settings-unreadable', source: name };
    if (perm.defaultMode != null && (typeof perm.defaultMode !== 'string' || PERMISSIVE_MODES.has(perm.defaultMode.trim().toLowerCase()))) return { reason: 'project-settings-permissive-mode', source: name };
    if (perm.additionalDirectories != null && (!Array.isArray(perm.additionalDirectories) || perm.additionalDirectories.length)) return { reason: 'project-settings-additional-directories', source: name };
    if (perm.allow != null && (!Array.isArray(perm.allow) || perm.allow.some(allowRuleWidens))) return { reason: 'project-settings-unscoped-allow', source: name };
  }
  return null;
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

/* A path as the filesystem sees it. Without a `realpath` function only the lexical path is known (`verified:false`, nothing is claimed). With one, a file that does not
 * exist yet is resolved through its directory; if even that fails the path is UNVERIFIABLE. `moved` = a symlink took the write somewhere other than the named path. */
function canonInfo(p, cwd, realpath, ci) {
  const lexical = path.resolve(cwd, String(p));
  const fold = (x) => (ci ? x.toLowerCase() : x);
  if (!realpath) return { file: fold(lexical), lexical, verified: false, moved: false };
  let real = null;
  try { real = realpath(lexical); } catch { try { real = path.join(realpath(path.dirname(lexical)), path.basename(lexical)); } catch { real = null; } }
  if (real === null) return { file: fold(lexical), lexical, verified: false, moved: false };
  return { file: fold(real), lexical, verified: true, moved: real !== lexical };
}
/** Does a grant like `Edit(hello.txt)` / `Edit(//abs/path)` name exactly one file? Tool-name equality is NOT assumed: the caller decides what a Write under an Edit rule means. */
function grantPath(grant, cwd, { realpath = null, caseInsensitive = false } = {}) {
  const m = GRANT.exec(String(grant));
  if (!m) return null;
  const spec = m[2].trim();
  if (/[*?[\]{}(),]/.test(spec)) return null;
  const info = canonInfo(spec.startsWith('//') ? spec.slice(1) : spec, cwd, realpath, caseInsensitive);
  return { rule: m[1], ...info };
}
function coveredByGrant(grants, toolUse, cwd, opts = {}) {
  const file = toolUse?.input?.file_path ?? toolUse?.input?.path;
  if (!FILE_WRITERS.has(toolUse?.name) || typeof file !== 'string') return { covered: false, why: 'not-a-file-write' };
  const target = canonInfo(file, cwd, opts.realpath, opts.caseInsensitive);
  for (const g of grants ?? []) {
    const gp = grantPath(g, cwd, opts);
    if (!gp || gp.rule !== 'Edit' || gp.file !== target.file) continue;
    /* a symlink between the name and the bytes: the write did not land where the grant says */
    if (opts.realpath && (target.moved || gp.moved)) return { covered: false, why: 'symlink-redirect', rule: g };
    if (opts.realpath && (!target.verified || !gp.verified)) return { covered: false, why: 'path-unverifiable', rule: g };
    return { covered: true, why: 'same-file', rule: g, toolName: toolUse.name };
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

/* ── execution modes ───────────────────────────────────────────────────────────────────────────────────────────────────────
 * dev-compat   : today's behaviour. A privileged (granted-write) launch is allowed, but it is only ever labelled `dev-compat-unattested`.
 * v1-protected : a launch that claims protected file writes must be ATTESTED beforehand. No Claude CLI flag lets us attest hooks or the
 *                effective permission rules before the process starts, so every privileged launch in this mode is refused (`safety-unattested`).
 *                Any value that is not exactly 'dev-compat' is treated as protected: an unknown mode never opens a door. */
const EXECUTION_MODES = Object.freeze({ DEV_COMPAT: 'dev-compat', V1_PROTECTED: 'v1-protected' });
const normaliseMode = (m) => (m === EXECUTION_MODES.DEV_COMPAT ? m : EXECUTION_MODES.V1_PROTECTED);
const WRITE_TOOLS = new Set([...FILE_WRITERS, 'Bash']);
/** A launch that can change files: a granted rule, or a built-in set that contains a writing tool (or the whole default set). */
const isPrivileged = ({ allowedTools = [], tools = null } = {}) =>
  allowedTools.length > 0 || tools === null || String(tools).split(',').some((t) => WRITE_TOOLS.has(t.trim()));
/** Tool surface of a ONE-action retry: the denied tool plus Read (Claude must read a file before it edits it). Anything else cannot be scoped -> null.
 *  MEASURED (H3 live, 44ca8a4): an `Edit(file)` rule let the `Write` tool run on that file -- the rule is "Edit" for every file writer. A file-write denial
 *  therefore needs Edit AND Write on the surface, or a model that picks Write is told the tool does not exist. The GRANT stays one file; the surface is wider. */
const FILE_WRITE_SURFACE = 'Read,Edit,Write';
function scopedRetryTools(denial) {
  const t = denial?.tool;
  if (typeof t !== 'string' || !WRITE_TOOLS.has(t)) return null;
  return t === 'Edit' || t === 'Write' || t === 'MultiEdit' ? FILE_WRITE_SURFACE : `Read,${t}`;
}
/** Does `Bash(prefix:*)` / `Bash(exact)` pre-approve this command? Only a plain prefix match with no shell chaining; anything else is not "covered". */
const SHELL_META = /[;&|`$()<>\n\r\\]/;
function bashCovered(grants, command) {
  if (typeof command !== 'string' || !command.trim() || SHELL_META.test(command)) return false;
  return (grants ?? []).some((g) => {
    const m = GRANT.exec(String(g));
    if (!m || m[1] !== 'Bash') return false;
    const spec = m[2].trim();
    if (spec.endsWith(':*')) { const pre = spec.slice(0, -2); return pre !== '' && (command === pre || command.startsWith(`${pre} `)); }
    return spec === command;
  });
}

/* ── binary identity, cached by file fingerprint ───────────────────────────────────────────────────────────────────────────
 * Hashing a ~200 MB binary on every resume is wasteful, so the sha256 is reused while (realpath, dev, ino, size, mtime, ctime) are unchanged and
 * recomputed otherwise. LIMIT: Node cannot exec by file descriptor, so a swap between this check and the exec cannot be excluded; the check and the
 * spawn are adjacent synchronous statements (no await), and the version the process reports in `init` is compared afterwards. */
function sha256Sync(file) {
  const h = crypto.createHash('sha256'); const fd = fs.openSync(file, 'r'); const buf = Buffer.allocUnsafe(1 << 20);
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function createIdentityCache({ run = null } = {}) {
  const known = new Map();
  return {
    /* ponytail: the sha256 of a ~280 MB binary blocks the event loop ~0.2 s when cold (measured); `prewarm` does the same hash in the background so the
     * adjacent-sync check in `get` is a cache hit. Without a prewarm the first launch pays the block once; the cache key changes only when the file does. */
    async prewarm(bin) {
      const loc = locate(bin);
      if (!loc.ok || known.has(loc.key)) return { ok: loc.ok, cached: loc.ok };
      const h = crypto.createHash('sha256');
      try { for await (const chunk of fs.createReadStream(loc.real)) h.update(chunk); } catch { return { ok: false, reason: 'binary-unreadable' }; }
      let after; try { after = fs.statSync(loc.real); } catch { return { ok: false, reason: 'binary-not-found' }; }
      if (fingerprint(loc.real, after) !== loc.key) return { ok: false, reason: 'changed-while-hashing' };   // never cache bytes of a file that moved under us
      known.set(loc.key, Object.freeze({ path: loc.real, sha256: h.digest('hex'), version: run ? versionOf(loc.real) : null }));
      return { ok: true, cached: false };
    },
    get(bin) {
      const loc = locate(bin);
      if (!loc.ok) return loc;
      const { real, key } = loc;
      const hit = known.get(key);
      if (hit) return { ok: true, id: hit, cached: true };
      let sha; try { sha = sha256Sync(real); } catch { return { ok: false, reason: 'binary-unreadable' }; }
      const id = Object.freeze({ path: real, sha256: sha, version: run ? versionOf(real) : null });
      known.set(key, id);
      return { ok: true, id, cached: false };
    },
  };
  function fingerprint(real, st) { return [real, st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs].join('|'); }
  function versionOf(real) { try { return String(run(real, ['--version']) ?? '').trim().split(/\r?\n/)[0] || null; } catch { return null; } }
  function locate(bin) {
    {
      let real; let st;
      try { real = fs.realpathSync(bin); st = fs.statSync(real); if (!st.isFile()) return { ok: false, reason: 'not-a-file' }; } catch { return { ok: false, reason: 'binary-not-found' }; }
      /* An npm shim (`.cmd`) is a launcher, not the program: its identity is the package target next to it (same lookup the stat binding uses). Without a
       * resolvable target there is nothing to identify. LIMIT: the interpreter that runs a `cli.js` target (node) is not covered by this hash. */
      if (/\.(cmd|bat|ps1)$/i.test(real)) {
        const pkg = path.join(path.dirname(real), 'node_modules', '@anthropic-ai', 'claude-code');
        const target = ['bin/claude.exe', 'claude.exe', 'cli.js'].map((f) => path.join(pkg, f)).find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
        if (!target) return { ok: false, reason: 'script-shim-not-a-binary' };
        try { real = fs.realpathSync(target); st = fs.statSync(real); } catch { return { ok: false, reason: 'binary-not-found' }; }
      }
      return { ok: true, real, key: fingerprint(real, st) };
    }
  }
}

/**
 * Everything knowable before THIS launch, as one verdict, with no process created. Used by `session.run` (authoritative) and by callers that
 * must refuse before they write anything (a dry run).
 * @param {object} o { bin, recorded:{path,sha256,version|null}|null, build:{sessionId,resume,allowedTools,tools}, mode, cache }
 * @returns {{ok:true,args,containment,identity,identityVerified:boolean,mode,safety}|{ok:false,reason}}
 */
function preflightLaunch({ bin, recorded = null, build, mode, cache } = {}) {
  const m = normaliseMode(mode);
  const built = buildArgs(build);
  if (!built.ok) return { ok: false, reason: built.reason };
  const idr = (cache ?? createIdentityCache()).get(bin);
  let identityVerified = false; let identity = null;
  if (idr.ok) {
    identity = idr.id; identityVerified = true;
    if (recorded) {
      if (recorded.path !== identity.path) return { ok: false, reason: 'not-the-recorded-binary' };
      if (recorded.sha256 !== identity.sha256) return { ok: false, reason: 'binary-changed' };
      if (recorded.version && identity.version && recorded.version !== identity.version) return { ok: false, reason: 'version-changed' };
    }
  } else {
    /* an identity that cannot be read is tolerated only for a first launch in dev-compat; a recorded identity that can no longer be read is a change */
    if (recorded || m === EXECUTION_MODES.V1_PROTECTED) return { ok: false, reason: recorded ? 'binary-changed' : `identity-unverifiable:${idr.reason}` };
  }
  const privileged = isPrivileged(build);
  if (privileged && m === EXECUTION_MODES.V1_PROTECTED && !privilegedAllowed(built.containment, { requireAttestation: true, privileged })) return { ok: false, reason: 'safety-unattested' };
  return { ok: true, args: built.args, containment: built.containment, identity, identityVerified, mode: m, privileged,
    safety: m === EXECUTION_MODES.V1_PROTECTED ? 'v1-protected-unprivileged' : 'dev-compat-unattested' };
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
  /* Bash: what the grant pre-approved is a command PREFIX; what the tool can run is anything the effective rules (unknown) allow */
  const bash = toolUses.filter((t) => t.name === 'Bash').map((t) => {
    const r = results.get(t.id); const denied = denials.some((d) => d.toolUseId === t.id);
    return { id: t.id, command: t.input.command ?? null, ran: Boolean(r) && !r.isError && !denied, denied, covered: bashCovered(ctx.grants, t.input.command) };
  });
  const model = { requestedAlias: ctx.requestedModelAlias ?? null, actual: init?.model ?? null };
  const isError = result ? result.is_error === true : null;
  const outcome = denials.length ? 'denied' : (!result ? 'unknown' : (isError || ctx.exitCode > 0 ? 'failed' : 'completed'));
  const s = {
    session: { requested: ctx.requestedSessionId ?? null, init: init?.session_id ?? null, result: result?.session_id ?? null },
    cwd: { call: ctx.callCwd ?? null, init: init?.cwd ?? null },
    model: { ...model, aliasIsNotActual: Boolean(model.requestedAlias && model.actual && model.requestedAlias !== model.actual) },
    tools: { exposed: tools, builtin: tools.filter((t) => !t.startsWith('mcp__')), mcp: mcpTools },
    hooksBeforeInit, toolUses, writes, bash, denials,
    result: result ? { subtype: result.subtype, isError, terminalReason: result.terminal_reason ?? null, cost: result.total_cost_usd ?? null } : null,
    exitCode: ctx.exitCode ?? null, outcome, fileEffect: fileEffect(ctx.files?.before, ctx.files?.after),
  };
  /* a result that names no session says nothing (not a mismatch); one that names ANOTHER session is */
  s.session.match = s.session.init !== null && (s.session.result === null || s.session.init === s.session.result) && (s.session.requested === null || s.session.requested === s.session.init);
  s.cwd.followsCaller = s.cwd.init !== null && s.cwd.call !== null && path.resolve(s.cwd.init) === path.resolve(s.cwd.call);
  s.problems = problems(s, ctx);
  s.notes = [];                      // facts a reader must not mistake for success/failure
  if (s.outcome === 'denied' && s.exitCode === 0 && s.result?.subtype === 'success') s.notes.push('denied-despite-success-exit');
  if (s.tools.builtin.includes('Bash')) s.notes.push('bash-effect-unbounded');
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
  for (const b of s.bash) if (b.ran && !b.covered) p.push(`bash-ran-outside-grant:${b.command}`);
  for (const d of s.denials) if (!d.linked) p.push(`denial-not-linked:${d.toolUseId}`);
  return p;
}

module.exports = { projectSettingsRefusal, grantRefusal, allowRuleWidens, EXECUTION_MODES, normaliseMode, isPrivileged, scopedRetryTools, bashCovered, createIdentityCache, preflightLaunch, preflight, buildArgs, containment, privilegedAllowed, grantPath, coveredByGrant, fileEffect, summarizeRun, FILE_WRITERS };
