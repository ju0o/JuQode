'use strict';
/* V1-407 slice A · Provider-NEUTRAL failure classifier. Pure: no spawn, no fs, no network, no model call, no auth read. NEVER throws.
 *
 * Input is a NORMALISED observation; output says what class of trouble it is and which USER action (never an automatic one) is the recovery.
 *   source   detect | preflight | exit | stream | version
 * Consumed shapes are ONLY those already recorded for Claude Code (claude-detect.js reasons, claude-contract.js / identity.js preflight reasons,
 * session.js exit {code, signal}, stream event types). Everything else -> class 'unknown'. Only OWN data properties of the observation and of an
 * event are read (no inherited values, no getters); an observation that cannot be read safely is 'bad-observation'.
 *
 * Deliberately NOT interpreted (shape unmeasured -> fail closed):
 *   - `stderrTail` (free text: localized, may carry secrets; never read, never echoed)
 *   - `apiErrorStatus` values (only `null` is recorded in fixtures; 401/429/offline mappings would be guesses)
 *   - any observation naming a provider other than Claude (Codex/OpenCode: no measured error shape before the Founder-gated Live probe)
 * So `offline` and `rate-limited` are in CLASSES but unreachable today; they need a measured, recorded shape first.
 *
 * Meaning of the fields (read before wiring):
 *   - D-116: `autoFallback` is the constant false. Nothing here names, suggests or selects another Agent/model/profile; `retryable` means a
 *     person MAY press the same action again, never that anything retries by itself.
 *   - `retryable` / recovery 'retry-same' NEVER means "the Writer Hold / the run slot is free" and never says the process is gone: a signal or a
 *     nonzero exit does not prove that descendants stopped. Releasing a slot stays with the supervisor's own proof (ended_unknown + acknowledgement).
 *   - A retry after a Work already changed files may DOUBLE-APPLY those changes. Whether to offer retry-same at all is the caller's concern.
 *   - `stoppedByProduct` (true, or 'cancel'|'timeout'|'mismatch') marks an exit the product itself caused; any other non-empty value counts as
 *     stopped too (fail closed). Such an exit is class 'unknown', recovery 'none': the classifier cannot say what state the Work is in.
 *   - `binary-changed`: the file at the recorded path is not the recorded one (sha256 / path differ, or the recorded binary can no longer be read).
 *     Re-approval of a changed binary is a product decision that is NOT modelled here; recovery is 'none', never 'recheck' (a re-check must not
 *     imply re-trust). `version-drift` (same file identity, other version string) stays recheck.
 *   - `auth-expired` from detect `logged-out` only means "a login is required": expired and never-signed-in are indistinguishable (reasonCode says so).
 *   - A classification is never a success claim. */

const CLASSES = Object.freeze(['cli-missing', 'cli-broken', 'cli-interrupted', 'auth-expired', 'offline', 'rate-limited', 'version-drift', 'binary-changed', 'protocol-drift', 'unknown']);
const RECOVERIES = Object.freeze(['recheck', 'retry-same', 'reauth-in-cli', 'install-or-fix-path', 'none']);

const out = (cls, retryable, recovery, reasonCode) => Object.freeze({ class: cls, retryable, recovery, autoFallback: false, reasonCode });
const unknown = (reasonCode, recovery = 'recheck') => out('unknown', false, recovery, reasonCode);

/* own DATA property only: no prototype chain, no getter, no Proxy trap result beyond a plain descriptor */
const own = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && Object.hasOwn(d, 'value') ? d.value : undefined; };
const has = (table, k) => typeof k === 'string' && Object.hasOwn(table, k);
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* claude-detect.js `reason` */
const DETECT = {
  'not-installed':   () => out('cli-missing', false, 'install-or-fix-path', 'detect-not-installed'),
  'no-response':     () => out('cli-interrupted', true, 'recheck', 'detect-no-response'),
  'logged-out':      () => out('auth-expired', false, 'reauth-in-cli', 'detect-login-required'),   // cannot tell "expired" from "never signed in"
  'unreadable-auth': () => unknown('detect-unreadable-auth'),                                       // never reported as logged out
  'error':           () => out('cli-broken', false, 'recheck', 'detect-error'),
};

/* claude-contract.js / identity.js preflight `reason` -> [class, recovery] */
const PREFLIGHT = {
  'binary-not-found': ['cli-missing', 'install-or-fix-path'], 'not-found': ['cli-missing', 'install-or-fix-path'],
  'script-shim-not-a-binary': ['cli-broken', 'install-or-fix-path'], 'not-a-file': ['cli-broken', 'install-or-fix-path'],
  'binary-unreadable': ['cli-broken', 'recheck'], 'version-unreadable': ['cli-broken', 'recheck'],
  'changed-while-hashing': ['cli-broken', 'recheck'], 'no-recorded-identity': ['version-drift', 'recheck'],
  'version-changed': ['version-drift', 'recheck'],
  'binary-changed': ['binary-changed', 'none'], 'not-the-recorded-binary': ['binary-changed', 'none'], 'path-changed': ['binary-changed', 'none'],
};
/* the product's own argv / grant / mode stops: intentional, nothing to retry or re-check */
const SAFETY_STOPS = new Set(['bad-session-id', 'bad-tools', 'unscoped-grant', 'safety-unattested']);

function preflight(code) {
  if (has(PREFLIGHT, code)) { const [c, r] = PREFLIGHT[code]; return out(c, false, r, `preflight-${c}`); }
  if (SAFETY_STOPS.has(code) || code.startsWith('permissive-arg:')) return unknown('preflight-safety-stop', 'none');
  if (code === 'not-an-absolute-path') return unknown('preflight-config-error', 'none');          // caller / configuration error, not a CLI failure
  if (code.startsWith('identity-unverifiable:')) {
    const why = code.slice('identity-unverifiable:'.length);
    const hit = has(PREFLIGHT, why) && PREFLIGHT[why][0] !== 'version-drift' && PREFLIGHT[why][0] !== 'binary-changed' ? PREFLIGHT[why] : null;
    if (why === 'not-an-absolute-path') return unknown('preflight-config-error', 'none');
    return hit ? out(hit[0], false, hit[1], `preflight-${hit[0]}`) : out('cli-broken', false, 'recheck', 'preflight-cli-broken');
  }
  return unknown('preflight-unrecognized');
}

/* RECORDED: seen in tests/fixtures (stream-permission-denied.ndjson, claude-h3-live/call1..4).
 * REDUCER_ONLY: the work reducer handles it but NO recorded stream contains it (synthetic tests only). Subtypes `null` = any. */
const RECORDED_EVENTS = Object.freeze({
  system: Object.freeze(['init', 'permission_denied', 'hook_started', 'hook_response', 'thinking_tokens']),
  assistant: null, user: null, result: null, rate_limit_event: null,
});
const REDUCER_ONLY_EVENTS = Object.freeze({ system: Object.freeze(['status']) });
const inTable = (t, type, sub) => has(t, type) && (t[type] === null || (typeof sub === 'string' && t[type].includes(sub)));
/** 'recorded' | 'reducer-only' | null */
function eventKind(e) {
  try {
    if (!isObj(e)) return null;
    const type = own(e, 'type'), sub = own(e, 'subtype');
    if (inTable(RECORDED_EVENTS, type, sub)) return 'recorded';
    return inTable(REDUCER_ONLY_EVENTS, type, sub) ? 'reducer-only' : null;
  } catch { return null; }
}
const isKnownClaudeEvent = (e) => eventKind(e) !== null;
const resultFailed = (e) => own(e, 'type') === 'result' && (own(e, 'is_error') === true || (typeof own(e, 'subtype') === 'string' && own(e, 'subtype').startsWith('error')));
const present = (v) => v !== undefined && v !== null;

function stream(obs) {
  const ev = own(obs, 'unknownEvent');
  const status = own(obs, 'apiErrorStatus');
  let evStatus;
  if (present(ev)) {
    if (!isObj(ev)) return unknown('stream-bad-event');
    own(ev, 'type');                       // an event that cannot be read at all throws here -> classify() answers bad-observation
    const kind = eventKind(ev);
    if (kind === null) return out('protocol-drift', false, 'recheck', 'stream-unknown-event');
    evStatus = own(ev, 'api_error_status');
    if (!present(status) && !present(evStatus)) {
      if (resultFailed(ev)) return unknown('stream-result-failed', 'none');
      return unknown(kind === 'recorded' ? 'stream-event-recorded' : 'stream-event-reducer-only', 'none');
    }
  }
  if (present(status) || present(evStatus)) return unknown('api-error-status-unmeasured');       // a known event never masks this
  return unknown('stream-no-failure-evidence', 'none');
}

function exit(obs) {
  const stopped = own(obs, 'stoppedByProduct');
  if (stopped !== undefined && stopped !== null && stopped !== false) return unknown('exit-stopped-by-product', 'none');
  const sig = own(obs, 'signal'), code = own(obs, 'exitCode');
  if (typeof sig === 'string' && /^SIG[A-Z0-9]+$/.test(sig)) return out('cli-interrupted', true, 'retry-same', 'exit-signal');
  if (Number.isInteger(code) && code !== 0) return out('cli-broken', true, 'retry-same', 'exit-nonzero');
  return unknown('exit-no-failure-evidence', 'none');      // exit 0 is not a verdict either way (a denied run exits 0)
}

function classifyUnsafe(obs) {
  if (!isObj(obs)) return unknown('bad-observation', 'none');
  const provider = own(obs, 'provider');
  if (provider !== undefined && provider !== 'claude') return unknown('provider-unmeasured', 'none');
  const code = own(obs, 'code');
  switch (own(obs, 'source')) {
    case 'detect': return has(DETECT, code) ? DETECT[code]() : unknown('detect-unrecognized');
    case 'preflight': return str(code) === null ? unknown('preflight-unrecognized') : preflight(code);
    case 'exit': return exit(obs);
    case 'stream': return stream(obs);
    case 'version': {
      const a = str(own(obs, 'expectedVersion')), b = str(own(obs, 'actualVersion'));
      if (!b) return unknown('version-unreadable');
      if (!a) return unknown('version-not-recorded');
      return a === b ? unknown('version-same', 'none') : out('version-drift', false, 'recheck', 'version-changed');
    }
    default: return unknown('unknown-source', 'none');
  }
}

function classify(obs) {
  try { return classifyUnsafe(obs); } catch { return unknown('bad-observation', 'none'); }     // throwing getter, revoked Proxy ...
}

module.exports = { classify, isKnownClaudeEvent, eventKind, RECORDED_EVENTS, REDUCER_ONLY_EVENTS, CLASSES, RECOVERIES };
