'use strict';
/* V1-407 slice A · Provider-NEUTRAL failure classifier. Pure: no spawn, no fs, no network, no model call, no auth read.
 *
 * Input is a NORMALISED observation; output says what class of trouble it is and which USER action (never an automatic one) is the recovery.
 *   source   detect | preflight | exit | stream | version
 * Consumed shapes are ONLY those already recorded for Claude Code (claude-detect.js reasons, claude-contract.js preflight reasons,
 * session.js exit {code, signal}, recorded stream event types). Everything else -> class 'unknown'.
 *
 * Deliberately NOT interpreted (shape unmeasured -> fail closed, recovery 'recheck'):
 *   - `stderrTail` (free text: localized, may carry secrets; never read, never echoed)
 *   - `apiErrorStatus` values (only `null` is recorded in fixtures; 401/429/offline mappings would be guesses)
 *   - any observation naming a provider other than Claude (Codex/OpenCode: no measured error shape before the Founder-gated Live probe)
 * So `offline` and `rate-limited` are in CLASSES but unreachable today; they need a measured, recorded shape first.
 *
 * D-116: `autoFallback` is the constant false. Nothing here names, suggests or selects another Agent/model/profile; `retryable` means a
 * person MAY press the same action again, never that anything retries by itself. A classification is never a success claim. */

const CLASSES = Object.freeze(['cli-missing', 'cli-broken', 'cli-interrupted', 'auth-expired', 'offline', 'rate-limited', 'version-drift', 'protocol-drift', 'unknown']);
const RECOVERIES = Object.freeze(['recheck', 'retry-same', 'reauth-in-cli', 'install-or-fix-path', 'none']);

const out = (cls, retryable, recovery, reasonCode) => Object.freeze({ class: cls, retryable, recovery, autoFallback: false, reasonCode });
const unknown = (reasonCode, recovery = 'recheck') => out('unknown', false, recovery, reasonCode);

/* claude-detect.js `reason` */
const DETECT = {
  'not-installed':   () => out('cli-missing', false, 'install-or-fix-path', 'detect-not-installed'),
  'no-response':     () => out('cli-interrupted', true, 'recheck', 'detect-no-response'),
  'logged-out':      () => out('auth-expired', false, 'reauth-in-cli', 'detect-logged-out'),   // cannot tell "expired" from "never signed in"
  'unreadable-auth': () => unknown('detect-unreadable-auth'),                                    // never reported as logged out
  'error':           () => out('cli-broken', false, 'recheck', 'detect-error'),
};

/* claude-contract.js / identity.js preflight `reason` (launch-safety refusals are not CLI failures: nothing to retry or recheck) */
const PREFLIGHT = {
  'binary-not-found': ['cli-missing', 'install-or-fix-path'], 'not-found': ['cli-missing', 'install-or-fix-path'],
  'script-shim-not-a-binary': ['cli-broken', 'install-or-fix-path'], 'not-a-file': ['cli-broken', 'install-or-fix-path'],
  'binary-unreadable': ['cli-broken', 'recheck'], 'version-unreadable': ['cli-broken', 'recheck'],
  'changed-while-hashing': ['cli-broken', 'recheck'], 'no-recorded-identity': ['version-drift', 'recheck'],
  'version-changed': ['version-drift', 'recheck'], 'binary-changed': ['version-drift', 'recheck'],
  'not-the-recorded-binary': ['version-drift', 'recheck'], 'path-changed': ['version-drift', 'recheck'],
};
const PREFLIGHT_PREFIX = { 'identity-unverifiable': ['cli-broken', 'recheck'] };   // `identity-unverifiable:<why>`

/* event types seen in tests/fixtures (stream-permission-denied.ndjson + claude-h3-live); subtypes only where recorded */
const KNOWN_EVENTS = Object.freeze({
  system: ['init', 'status', 'permission_denied', 'hook_started', 'hook_response', 'thinking_tokens'],
  assistant: null, user: null, result: null, rate_limit_event: null,
});
const isKnownClaudeEvent = (e) => {
  const t = e?.type;
  if (typeof t !== 'string' || !Object.hasOwn(KNOWN_EVENTS, t)) return false;
  const subs = KNOWN_EVENTS[t];
  return subs === null || subs.includes(e.subtype);
};

const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);

function classify(obs) {
  if (obs === null || typeof obs !== 'object' || Array.isArray(obs)) return unknown('bad-observation', 'none');
  if (obs.provider !== undefined && obs.provider !== 'claude') return unknown('provider-unmeasured', 'none');
  switch (obs.source) {
    case 'detect': { const f = typeof obs.code === 'string' && Object.hasOwn(DETECT, obs.code) ? DETECT[obs.code] : null; return f ? f() : unknown('detect-unrecognized'); }
    case 'preflight': {
      const code = str(obs.code);
      if (code === null) return unknown('preflight-unrecognized');
      const hit = (Object.hasOwn(PREFLIGHT, code) && PREFLIGHT[code]) || (Object.hasOwn(PREFLIGHT_PREFIX, code.split(':')[0]) && PREFLIGHT_PREFIX[code.split(':')[0]]);
      if (hit) return out(hit[0], false, hit[1], `preflight-${hit[0]}`);
      /* argv/grant/mode refusals (bad-session-id, unscoped-grant, permissive-arg:*, safety-unattested) are the product's own safety stops */
      return unknown('preflight-refused', 'none');
    }
    case 'exit': {
      if (str(obs.signal)) return out('cli-interrupted', true, 'retry-same', 'exit-signal');
      if (Number.isInteger(obs.exitCode) && obs.exitCode !== 0) return out('cli-broken', true, 'retry-same', 'exit-nonzero');
      return unknown('exit-no-failure-evidence', 'none');      // exit 0 is not a verdict either way (a denied run exits 0)
    }
    case 'stream': {
      if (obs.unknownEvent !== undefined && obs.unknownEvent !== null) {
        if (typeof obs.unknownEvent !== 'object' || Array.isArray(obs.unknownEvent)) return unknown('stream-bad-event');
        return isKnownClaudeEvent(obs.unknownEvent) ? unknown('stream-event-is-known', 'none') : out('protocol-drift', false, 'recheck', 'stream-unknown-event');
      }
      if (obs.apiErrorStatus !== undefined && obs.apiErrorStatus !== null) return unknown('api-error-status-unmeasured');
      return unknown('stream-no-failure-evidence', 'none');
    }
    case 'version': {
      const a = str(obs.expectedVersion), b = str(obs.actualVersion);
      if (!b) return unknown('version-unreadable');
      if (!a) return unknown('version-not-recorded');
      return a === b ? unknown('version-same', 'none') : out('version-drift', false, 'recheck', 'version-changed');
    }
    default: return unknown('unknown-source', 'none');
  }
}

module.exports = { classify, isKnownClaudeEvent, CLASSES, RECOVERIES };
