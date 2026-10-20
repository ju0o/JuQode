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
/** A path that leaves the project on ANY platform: `//abs`, `~`, `..`, a drive letter (`C:`), a URL (`file:///`), UNC (`\\\\host`), `//?/`. */
const reachesOut = (spec) => /^(\/\/|~|\\\\|[A-Za-z]:|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(spec) || spec.split(/[\\/]/).includes('..');
const fileSpecWide = (spec) => /^[*?/\\.~]+$/.test(spec) || reachesOut(spec);

/* ── the project's CONTROL files: what later runs read as configuration or execute as hooks. One list, used by scopeOf (no one-file grant) and by the settings gate (an allow rule for them
 * is a self-widening rule). `package.json` runs code through its scripts but is an ordinary edit target, so it is judged only by the gate (OPEN: PM). */
const CONTROL = /^(\.claude(\/|$)|\.mcp\.json$|\.git(\/|$)|\.husky(\/|$)|\.envrc$|\.vscode\/tasks\.json$|\.github\/workflows(\/|$))/i;
const CONTROL_ROOTS = ['.claude', '.mcp.json', '.git', '.husky', '.envrc', '.vscode/tasks.json', '.github/workflows'];
const GATE_ONLY_CONTROL = /^package\.json$/i;
const posix = (x) => x.split(path.sep).join('/');
/** Where a file the model/settings names REALLY is: symlinks resolved; a not-yet-existing file resolves through its deepest existing ancestor. null = ambiguous (dangling link, a file in the way, unreadable). */
function realTarget(abs) {
  const rest = [];
  let p = abs;
  for (;;) {
    let exists = true;
    try { fs.lstatSync(p); } catch (e) { if (e.code !== 'ENOENT') return null; exists = false; }
    if (exists) { try { return path.join(fs.realpathSync(p), ...rest); } catch { return null; } }
    const parent = path.dirname(p);
    if (parent === p) return null;
    rest.unshift(path.basename(p));
    p = parent;
  }
}
/** Is this REAL target one of the control files (by its own name, or because a symlinked `.claude`/`.git`/... leads there)? */
function isControlTarget(realRoot, rel, real) {
  if (CONTROL.test(rel)) return true;
  const rr = posix(path.relative(realRoot, real));
  if (CONTROL.test(rr)) return true;
  const lc = (x) => x.toLowerCase();
  return CONTROL_ROOTS.some((c) => { const pr = realTarget(path.join(realRoot, c)); return pr !== null && (lc(real) === lc(pr) || lc(real).startsWith(lc(pr) + path.sep)); });
}
/** Judge a named file against the project on the real filesystem. @returns {'ok'|'outside'|'ambiguous'|'control'|'file-kind'} */
function projectFileVerdict(projectPath, spec) {
  let realRoot;
  try { realRoot = fs.realpathSync(projectPath); } catch { return 'ambiguous'; }
  const abs = path.resolve(projectPath, spec);
  const rel = posix(path.relative(path.resolve(projectPath), abs));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return 'outside';
  const real = realTarget(abs);
  if (real === null) return 'ambiguous';
  const rr = path.relative(realRoot, real);
  if (!rr || rr.startsWith('..') || path.isAbsolute(rr)) return 'outside';
  if (isControlTarget(realRoot, rel, real) || GATE_ONLY_CONTROL.test(rel) || GATE_ONLY_CONTROL.test(posix(rr))) return 'control';
  try { if (!fs.statSync(real).isFile()) return 'file-kind'; } catch { /* not there yet: a file to be created */ }
  return 'ok';
}

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
const SAFE_MODES = new Set(['default', 'plan', 'dontAsk']);      // ask / read-only planning / deny-unless-allowed: none of them removes a check
/* ── allow-rule classes. A rule is attested ONLY when it is NARROW; JuQode's screens say nothing about project settings, so a rule whose authority is not proven by a measurement
 * is never "probably fine" because its text looks scoped:
 *   narrow     bare Read/Glob/Grep/LS and Read-family specs that stay inside the project (they cannot change anything); an exact-file write rule (no glob, not a directory); an exact Bash command.
 *   wide       bare write/exec/network tool, wildcard-only or glob-everywhere write rule, anything reaching out of the project, WebFetch(domain:*), Bash with an empty or wildcard-only prefix.
 *   unmeasured a directory/glob write rule (`Edit(src)`, `Edit(src/**)`), `Bash(prefix:*)` (any arguments; the card shows only the prefix), `WebFetch(domain:x)`, WebSearch, mcp__*, Task, TodoWrite.
 *   unknown    a tool name, shape or type this table does not contain.
 * Everything but `narrow` is refused. Evidence per class: tests/prestart-permission.test.js (table test). */
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
const BAD_CHARS = /[\p{Cc}\p{Cf}]/u;
function classifyAllowRule(rule, projectPath = null) {
  if (typeof rule !== 'string' || !rule || rule !== rule.trim() || BAD_CHARS.test(rule)) return 'unknown';
  const m = /^([A-Za-z][A-Za-z0-9_]*)(?:\(([\s\S]*)\))?$/.exec(rule);
  if (!m) return 'unknown';
  const [, tool, inner] = m;
  const spec = inner === undefined ? undefined : inner.trim();
  if (spec !== undefined && (spec !== inner || !spec)) return /^[*?:\s]*$/.test(inner) && tool !== 'WebSearch' ? 'wide' : 'unknown';
  const cwd = typeof projectPath === 'string' && path.isAbsolute(projectPath) ? projectPath : null;
  const lexicalControl = (x) => CONTROL.test(x.replace(/^\.\//, '')) || GATE_ONLY_CONTROL.test(x.replace(/^\.\//, ''));
  if (READ_TOOLS.has(tool)) {
    if (spec === undefined) return 'narrow';
    if (/^[*?:]*$/.test(spec) || reachesOut(spec) || spec.includes('\\')) return 'wide';
    if (!/[*?[\]{}!]/.test(spec) && cwd) { const v = projectFileVerdict(cwd, spec); if (v === 'outside') return 'wide'; if (v === 'ambiguous') return 'unmeasured'; }
    return 'narrow';
  }
  if (FILE_WRITERS.has(tool)) {
    if (spec === undefined || fileSpecWide(spec) || /[[\]{}!]/.test(spec) || /^\*/.test(spec)) return 'wide';
    if (/[*?:]/.test(spec) || spec.includes('\\') || spec.startsWith('/') || spec.endsWith('/')) return 'unmeasured';
    if (lexicalControl(spec)) return 'unmeasured';
    if (cwd) { const v = projectFileVerdict(cwd, spec); return v === 'ok' ? 'narrow' : (v === 'outside' ? 'wide' : 'unmeasured'); }
    return 'narrow';
  }
  if (tool === 'Bash') {
    if (spec === undefined || /^[*?:]*$/.test(spec)) return 'wide';
    if (/^[^*?]+:\*$/.test(spec)) return spec.startsWith(':') ? 'wide' : 'unmeasured';
    return /[*?]/.test(spec) ? 'unmeasured' : 'narrow';
  }
  if (tool === 'WebFetch') return spec === undefined || /domain:\s*[*?]*$|domain:\s*\*/.test(spec) || /^[*?:]*$/.test(spec) ? 'wide' : 'unmeasured';
  if (tool === 'WebSearch' || tool.startsWith('mcp__') || tool === 'Task' || tool === 'TodoWrite') return 'unmeasured';
  return 'unknown';
}
const allowRuleWidens = (rule, projectPath = null) => classifyAllowRule(rule, projectPath) !== 'narrow';
const REASONS = Object.freeze(['project-path-unknown', 'project-settings-unreadable', 'project-settings-symlink', 'project-settings-permissive-mode', 'project-settings-unknown-mode',
  'project-settings-additional-directories', 'project-settings-unscoped-allow', 'project-settings-unmeasured-allow', 'project-settings-unknown-rule', 'project-settings-unknown-key']);
/* A top-level key that LOOKS permission-related but is not in this table is refused, and so is a permission-like env name: a new key is not "harmless" by being new. */
/* Key names are judged by WORDS (camelCase / snake / kebab split), not by substring: `defaultModel` is a model name, `autoUpdates` is not a permission. A top-level key that carries a permission word
 * is refused unless this table knows it. The word list is a denylist - an allowlist of harmless keys would refuse many ordinary files (OPEN: trade-off). */
const KEY_WORDS = new Set(['permission', 'permissions', 'perm', 'perms', 'permit', 'allow', 'allowed', 'deny', 'denied', 'bypass', 'dangerous', 'dangerously', 'sandbox', 'approval', 'approvals', 'approve', 'trust', 'trusted',
  'mcp', 'yolo', 'grant', 'grants', 'tools', 'unrestricted', 'unsafe', 'accept', 'ask']);
const words = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function permissionLikeKey(k) {
  const w = words(k);
  if (w.some((x) => KEY_WORDS.has(x))) return true;
  return w.includes('mode') && w.some((x) => ['default', 'auto', 'permission', 'plan', 'accept', 'bypass'].includes(x));
}
/* env: only names that change permission behaviour or WHERE settings come from; `PERMISSIONS_URL`, `SANDBOX_URL`, `DISABLE_AUTOUPDATER`, `AUTOMATION_LEVEL` are not. */
const ENV_PERMISSION_NAME = /(^|_)(PERMISSION_MODE|SKIP_PERMISSIONS?(_PROMPT)?|BYPASS|BYPASS_PERMISSIONS?|DANGEROUS(LY)?(_[A-Z_]+)?|YOLO|APPROVAL_POLICY|SANDBOX_MODE|DEFAULT_MODE|AUTO_APPROVE|AUTO_ACCEPT(_EDITS)?|CONFIG_DIR)(_|$)/;
const PERMISSION_LIKE = { test: permissionLikeKey };
const ENV_PERMISSION_LIKE = { test: (k) => ENV_PERMISSION_NAME.test(String(k).toUpperCase()) };
const KNOWN_PERMISSION_KEYS = new Set(['allow', 'deny', 'ask', 'defaultMode', 'additionalDirectories', 'disableBypassPermissionsMode']);

/** The verdict on ONE parsed settings document. Pure and total: any value, never throws. @returns {{reason:string}|null} */
function settingsVerdict(doc, projectPath = null) {
  try {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { reason: 'project-settings-unreadable' };
    for (const k of Object.keys(doc)) {
      if (k === 'permissions' || k === 'env') continue;
      if (PERMISSION_LIKE.test(k)) return { reason: 'project-settings-unknown-key', key: k };
    }
    if (doc.env != null) {
      if (typeof doc.env !== 'object' || Array.isArray(doc.env)) return { reason: 'project-settings-unknown-key', key: 'env' };
      for (const k of Object.keys(doc.env)) if (ENV_PERMISSION_LIKE.test(k)) return { reason: 'project-settings-unknown-key', key: `env.${k}` };
    }
    const perm = doc.permissions;
    if (perm == null) return null;
    if (typeof perm !== 'object' || Array.isArray(perm)) return { reason: 'project-settings-unreadable' };
    for (const k of Object.keys(perm)) if (!KNOWN_PERMISSION_KEYS.has(k)) return { reason: 'project-settings-unknown-key', key: `permissions.${k}` };
    const dm = perm.defaultMode;
    if (dm != null) {
      if (typeof dm !== 'string' || PERMISSIVE_MODES.has(dm.trim().toLowerCase())) return { reason: 'project-settings-permissive-mode' };
      if (!SAFE_MODES.has(dm)) return { reason: 'project-settings-unknown-mode' };
    }
    if (perm.additionalDirectories != null && (!Array.isArray(perm.additionalDirectories) || perm.additionalDirectories.length)) return { reason: 'project-settings-additional-directories' };
    for (const k of ['deny', 'ask']) if (perm[k] != null && (!Array.isArray(perm[k]) || perm[k].some((r) => typeof r !== 'string'))) return { reason: 'project-settings-unknown-rule', key: k };
    if (perm.disableBypassPermissionsMode != null && perm.disableBypassPermissionsMode !== 'disable') return { reason: 'project-settings-unknown-key', key: 'permissions.disableBypassPermissionsMode' };
    if (perm.allow != null) {
      if (!Array.isArray(perm.allow)) return { reason: 'project-settings-unknown-rule', key: 'allow' };
      for (const r of perm.allow) {
        const c = classifyAllowRule(r, projectPath);
        if (c === 'wide') return { reason: 'project-settings-unscoped-allow' };
        if (c === 'unmeasured') return { reason: 'project-settings-unmeasured-allow' };
        if (c !== 'narrow') return { reason: 'project-settings-unknown-rule' };
      }
    }
    return null;
  } catch { return { reason: 'project-settings-unreadable' }; }
}

function projectSettingsRefusal(projectPath) {
  /* an unknown project folder is not "no settings" */
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) return { reason: 'project-path-unknown', source: null };
  let realRoot = null;
  try { realRoot = fs.realpathSync(projectPath); } catch { /* judged below as unreadable only if a settings file exists */ }
  for (const name of ['settings.json', 'settings.local.json']) {
    const file = path.join(String(projectPath), '.claude', name);
    let doc;
    try {
      /* a settings source that resolves OUTSIDE the project is a source JuQode did not scope: refused, not followed */
      const real = fs.realpathSync(file);
      if (!realRoot || (real !== realRoot && !real.startsWith(realRoot + path.sep))) return { reason: 'project-settings-symlink', source: name };
      doc = JSON.parse(fs.readFileSync(real, 'utf8'));
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) continue;
      return { reason: 'project-settings-unreadable', source: name };
    }
    const v = settingsVerdict(doc, projectPath);
    if (v) return { ...v, source: name };
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

module.exports = { controlPath: (rel) => CONTROL.test(String(rel).replace(/^\.\//, '')), isControlTarget, realTarget, projectSettingsRefusal, settingsVerdict, classifyAllowRule, SETTINGS_REASONS: REASONS, grantRefusal, allowRuleWidens, EXECUTION_MODES, normaliseMode, isPrivileged, scopedRetryTools, bashCovered, createIdentityCache, preflightLaunch, preflight, buildArgs, containment, privilegedAllowed, grantPath, coveredByGrant, fileEffect, summarizeRun, FILE_WRITERS };
