'use strict';
/* WBS-11 · activity stream → Work state (`19` §C3-L, `20` `signal_kind` / `work_status`).
 *
 * Pure. It takes the state it was given and one signal, and returns the next state. No I/O, no
 * clock, no process handles — so every transition in `12` can be driven from a recorded stream.
 *
 * The rule the whole file obeys: **no state is set that no signal justifies.** An event this
 * reducer does not recognise becomes a raw signal and changes nothing. Absence of a signal is
 * never read as progress, and elapsed time is never read as a state.
 */

/** `20` `signal_kind` — the vocabulary. Anything else is `raw`. */
const KIND = {
  SESSION_START: 'session_start', STATUS: 'status', STEP: 'step', FILE_CHANGE: 'file_change',
  TOOL_USE: 'tool_use', TOOL_RESULT: 'tool_result', INPUT_REQUEST: 'input_request',
  ANSWER: 'answer', PERMISSION_DENIED: 'permission_denied', PERMISSION_GRANTED: 'permission_granted',
  CANCEL_REQUEST: 'cancel_request', CANCEL_CONFIRMED: 'cancel_confirmed', RATE_LIMIT: 'rate_limit',
  FINISH: 'finish', RECONCILED: 'reconciled', EVIDENCE_GAP: 'evidence_gap',
  ORPHAN_PROCESS: 'orphan_process', RAW: 'raw',
};

/**
 * One CLI event → one signal. Derived from a recorded stream, not from documentation:
 * `tests/fixtures/stream-permission-denied.ndjson`.
 */
function toSignal(event) {
  const t = event?.type;
  const st = event?.subtype;

  if (t === 'system' && st === 'init') return { kind: KIND.SESSION_START, payload: { sessionId: event.session_id, cwd: event.cwd, version: event.claude_code_version } };
  if (t === 'system' && st === 'status') return { kind: KIND.STATUS, payload: { text: event.message ?? null } };
  if (t === 'system' && st === 'permission_denied') {
    return {
      kind: KIND.PERMISSION_DENIED,
      payload: { tool: event.tool_name ?? null, toolUseId: event.tool_use_id ?? null, message: event.message ?? null },
    };
  }
  if (t === 'rate_limit_event') return { kind: KIND.RATE_LIMIT, payload: event.rate_limit_info ?? null };

  if (t === 'assistant') {
    const uses = blocks(event).filter((b) => b.type === 'tool_use');
    if (uses.length) {
      const u = uses[0];
      return { kind: KIND.TOOL_USE, payload: { tool: u.name, toolUseId: u.id, input: u.input } };
    }
    return { kind: KIND.RAW, payload: { text: text(event) } };
  }

  if (t === 'user') {
    const results = blocks(event).filter((b) => b.type === 'tool_result');
    if (results.length) {
      const r = results[0];
      return { kind: KIND.TOOL_RESULT, payload: { toolUseId: r.tool_use_id ?? null, isError: r.is_error === true } };
    }
    return { kind: KIND.RAW, payload: null };
  }

  if (t === 'result') {
    return {
      kind: KIND.FINISH,
      payload: {
        subtype: st ?? null,
        /* MEASURED: a run whose tool was denied still reports `is_error: false`. A denial can
         * never be detected from this field, or from the process exit code. */
        isError: event.is_error === true,
        denials: (event.permission_denials ?? []).map((d) => ({
          tool: d.tool_name, toolUseId: d.tool_use_id, input: d.tool_input,
        })),
        text: typeof event.result === 'string' ? event.result : null,
      },
    };
  }

  return { kind: KIND.RAW, payload: { type: t ?? null, subtype: st ?? null } };
}

const blocks = (e) => (Array.isArray(e?.message?.content) ? e.message.content : []);
const text = (e) => blocks(e).filter((b) => b.type === 'text').map((b) => b.text).join('') || null;

/** The state a Work is in, as far as observed signals justify. */
const initial = () => ({
  status: 'running',              // a `work` row exists only once the session started (`20`)
  outcome: null,
  lastObserved: null,             // the last thing actually SEEN — the liveness line's content
  pendingPermission: null,        // D-133 contract B: observed denial, not yet resolved
  denials: [],
  toolsUsed: 0,
  finish: null,
});

function reduce(state, signal, at = null) {
  const s = { ...state };
  s.lastObserved = { kind: signal.kind, at };

  switch (signal.kind) {
    case KIND.SESSION_START:
      s.status = 'running';
      break;

    case KIND.TOOL_USE:
      s.toolsUsed += 1;
      break;

    case KIND.PERMISSION_DENIED:
      /* The tool is ALREADY DENIED — nothing is pending on Claude Code's side (D-133). What
       * the Work waits for is the USER's decision, and that is what this status names. The
       * product must never describe the request itself as 대기 중 (`15` SC-03 contract B). */
      s.pendingPermission = { ...signal.payload, resolved: false };
      s.status = 'permission_waiting';
      s.denials = [...s.denials, signal.payload];
      break;

    case KIND.PERMISSION_GRANTED:
      /* A denial the user then allowed is RESOLVED. Leaving it counted would report a Work as
       * 부분 완료 because something was refused once and then done — which is not what the
       * user saw happen. */
      s.denials = s.denials.map((d) =>
        (!signal.payload?.toolUseId || d.toolUseId === signal.payload.toolUseId) ? { ...d, resolved: true } : d);
      s.pendingPermission = null;
      s.status = 'running';
      break;

    case KIND.INPUT_REQUEST:
      s.status = 'input_waiting';
      break;

    case KIND.ANSWER:
      if (s.status === 'input_waiting') s.status = 'running';
      break;

    case KIND.CANCEL_REQUEST:
      s.status = 'cancel_requested';
      break;

    case KIND.CANCEL_CONFIRMED:
      s.status = 'ended';
      s.outcome = s.toolsUsed > 0 ? 'cancelled_partial' : 'cancelled_nochange';
      break;

    case KIND.FINISH: {
      s.finish = signal.payload;
      const denials = signal.payload?.denials ?? [];
      if (denials.length) s.denials = mergeDenials(s.denials, denials);

      /* An unresolved permission keeps the Work OPEN. The turn ended, but under contract B the
       * user can still allow and the SAME Work resumes in the SAME session — so ending it here
       * would throw away the thing the card is for. */
      if (s.pendingPermission && !s.pendingPermission.resolved) {
        s.status = 'permission_waiting';
        break;
      }
      s.status = 'ended';
      /* `partial` when a tool was refused and the Work still finished: something was done and
       * something was not. The full 된 것 / 안 된 것 judgement is WBS-18's. */
      /* `partial` only for a refusal that was never resolved: something was asked for and not
       * done. The full 된 것 / 안 된 것 judgement is WBS-18's. */
      s.outcome = signal.payload?.isError ? 'failed'
        : (s.denials.some((d) => !d.resolved) ? 'partial' : 'complete');
      break;
    }

    case KIND.RECONCILED:
      /* Startup reconciliation (`20`): the process is gone and we cannot say how it ended. */
      s.status = 'ended';
      s.outcome = 'ended_unknown';
      break;

    default:
      break;                       // observed, recorded, and it justifies no state change
  }
  return s;
}

function mergeDenials(existing, incoming) {
  const seen = new Set(existing.map((d) => d.toolUseId));
  return [...existing, ...incoming.filter((d) => !seen.has(d.toolUseId))];
}

/** Is there a refusal the user has not answered yet? Contract B's card hangs on this. */
const openPermission = (state) => state.pendingPermission && !state.pendingPermission.resolved
  ? state.pendingPermission : null;

/** Replay a whole stream. Used by the fixture tests and by startup recovery. */
function replay(signals) {
  let s = initial();
  for (const sig of signals) s = reduce(s, sig, sig.observedAt ?? null);
  return s;
}

module.exports = { toSignal, reduce, replay, initial, openPermission, KIND };
