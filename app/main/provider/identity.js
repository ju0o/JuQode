'use strict';
/* Provider CLI identity + pre-launch guard (V1-102 contract input; no adapter, no model call, nothing spawned except `--version` by the caller's injected `run`).
 *
 * Why: the same name `opencode` resolved to v2.0.29 / v1.18.35 shim / v1.19.0 depending on the shell (H3, measured), and Codex/OpenCode move versions under a fixed path.
 * A launch therefore uses an ABSOLUTE path whose bytes and version were recorded, and is refused the moment either differs. Unknown is never "fine". */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STATES = ['SUPPORTED', 'LIMITED', 'UNSUPPORTED', 'UNKNOWN'];
/** flags/values that make a provider write or run without asking: never passed, whatever the caller says */
const PERMISSIVE = [/^--auto$/, /^--yolo$/, /^--(allow-)?dangerously-/, /^--ask-for-approval=never$/, /^--sandbox=danger-full-access$/,
  /^--permission-mode=(bypassPermissions|acceptEdits|auto)$/, /^approval_policy\s*=\s*"?never"?$/, /^sandbox_mode\s*=\s*"?danger-full-access"?$/];
/** option and value as SEPARATE arguments (`--sandbox danger-full-access`, `-a never`, `-c approval_policy=never`) */
const PERMISSIVE_PAIRS = [[/^(--sandbox|-s)$/, /^danger-full-access$/], [/^(--ask-for-approval|-a)$/, /^never$/],
  [/^--permission-mode$/, /^(bypassPermissions|acceptEdits|auto)$/], [/^(-c|--config)$/, /^(approval_policy|sandbox_mode)\s*=\s*"?(never|danger-full-access)"?$/]];

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** @returns {{ok:true, id:{path:string, sha256:string, version:string}}|{ok:false, reason:string}} -- `run(file, ['--version'])` -> string, injected so tests spawn nothing */
function identify(file, run) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return { ok: false, reason: 'not-an-absolute-path' };
  if (/\.(cmd|bat|ps1)$/i.test(file)) return { ok: false, reason: 'script-shim-not-a-binary' };      // needs a shell: not an identity of the program
  let real;
  try { real = fs.realpathSync(file); if (!fs.statSync(real).isFile()) return { ok: false, reason: 'not-a-file' }; } catch { return { ok: false, reason: 'not-found' }; }
  let version;
  try { version = String(run(real, ['--version']) ?? '').trim().split(/\r?\n/)[0]; } catch { return { ok: false, reason: 'version-unreadable' }; }
  if (!version) return { ok: false, reason: 'version-unreadable' };
  return { ok: true, id: { path: real, sha256: sha256(real), version } };
}

/** The recorded identity must still be what is at that path -- checked IMMEDIATELY before a launch. */
function guardLaunch(recorded, run) {
  if (!recorded || !recorded.path || !recorded.sha256 || !recorded.version) return { ok: false, reason: 'no-recorded-identity' };
  const now = identify(recorded.path, run);
  if (!now.ok) return { ok: false, reason: now.reason };
  if (now.id.path !== recorded.path) return { ok: false, reason: 'path-changed' };
  if (now.id.sha256 !== recorded.sha256) return { ok: false, reason: 'binary-changed' };
  if (now.id.version !== recorded.version) return { ok: false, reason: 'version-changed' };
  return { ok: true };
}

/** argv/config values that remove the provider's own permission checks, joined with their option when the value is a separate argument. */
function permissiveArgs(args) {
  const list = (Array.isArray(args) ? args : []).map((a) => String(a).trim());
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (PERMISSIVE_PAIRS.some(([opt, val]) => opt.test(a) && i + 1 < list.length && val.test(list[i + 1]))) { out.push(`${a} ${list[i + 1]}`); i += 1; }
    else if (PERMISSIVE.some((re) => re.test(a))) out.push(a);
  }
  return out;
}

/** A capability record. Anything not measured is UNKNOWN; the state set is closed. */
function capability(provider, host, state, evidence) {
  return Object.freeze({ provider, host, state: STATES.includes(state) ? state : 'UNKNOWN', evidence: String(evidence ?? '') });
}
/** May this (host, provider) be launched for a user task? Only SUPPORTED/LIMITED, never UNKNOWN/UNSUPPORTED. */
const launchable = (cap) => Boolean(cap) && (cap.state === 'SUPPORTED' || cap.state === 'LIMITED');

module.exports = { STATES, identify, guardLaunch, permissiveArgs, capability, launchable };
