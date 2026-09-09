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
    /* A message can carry SEVERAL tool_use blocks (parallel calls). Reporting only the first
     * undercounted the tools used and lost whichever call was batched with it. */
    const uses = blocks(event).filter((b) => b.type === 'tool_use');
    if (uses.length) {
      const all = uses.map((u) => ({ tool: u.name, toolUseId: u.id, input: u.input }));
      return { kind: KIND.TOOL_USE, payload: { ...all[0], all } };
    }
    return { kind: KIND.RAW, payload: { text: text(event) } };
  }

  if (t === 'user') {
    const results = blocks(event).filter((b) => b.type === 'tool_result');
    if (results.length) {
      const all = results.map((r) => ({ toolUseId: r.tool_use_id ?? null, isError: r.is_error === true }));
      return { kind: KIND.TOOL_RESULT, payload: { ...all[0], all } };
    }
    return { kind: KIND.RAW, payload: null };
  }

  if (t === 'result') {
    return {
      kind: KIND.FINISH,
      payload: {
        subtype: st ?? null,
        /* `19` §C3-L: the three signals are read TOGETHER — `is_error`, the terminal reason,
         * and the exit code. Carrying only `is_error` meant `error_max_turns` reported 완료. */
        terminalReason: event.terminal_reason ?? event.stop_reason ?? null,
        apiErrorStatus: event.api_error_status ?? null,
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
  denials: [],                    // D-133 contract B: observed denials; unresolved ones need a card
  toolsUsed: 0,
  finish: null,
});

let denialSeq = 0;

function reduce(state, signal, at = null) {
  const s = { ...state };
  s.lastObserved = { kind: signal.kind, at };

  /* An ended Work is ended. A late or stray signal must not reopen it — measured: a stray
   * grant moved a completed Work back to `running` while keeping `outcome: 'complete'`, which
   * both contradicts itself and re-occupies the D-117 slot. Only reconciliation may speak
   * about a Work that has already ended, and it only ever confirms it. */
  if (state.status === 'ended' && signal.kind !== KIND.RECONCILED) return s;

  switch (signal.kind) {
    case KIND.SESSION_START:
      s.status = 'running';
      break;

    case KIND.TOOL_USE:
      s.toolsUsed += (signal.payload?.all?.length ?? 1);
      break;

    case KIND.PERMISSION_DENIED:
      /* The tool is ALREADY DENIED — nothing is pending on Claude Code's side (D-133). What
       * the Work waits for is the USER's decision, and that is what this status names. The
       * product must never describe the request itself as 대기 중 (`15` SC-03 contract B).
       *
       * Denials are a LIST, not one slot. q04b experiment D measured two in a single turn, and
       * keeping only the most recent one meant the earlier refusal lost its card entirely —
       * the user could not answer a question they were never shown. */
      s.denials = [...s.denials, { ...signal.payload, resolved: false, id: `d${denialSeq++}` }];
      s.status = 'permission_waiting';
      break;

    case KIND.PERMISSION_GRANTED: {
      /* Resolve the ONE denial the user answered. A grant carrying no id used to resolve every
       * outstanding refusal, so a single click could report a Work as 완료 while refusals the
       * user never saw went unmentioned — a D-116 break. With no id, resolve the oldest
       * unresolved denial for that tool, and nothing else. */
      const want = signal.payload ?? {};
      let matched = false;
      s.denials = s.denials.map((d) => {
        if (matched || d.resolved) return d;
        const byId = want.toolUseId && d.toolUseId === want.toolUseId;
        const byTool = !want.toolUseId && want.tool && d.tool === want.tool;
        if (!byId && !byTool) return d;
        matched = true;
        return { ...d, resolved: true };
      });
      s.status = s.denials.some((d) => !d.resolved) ? 'permission_waiting' : 'running';
      break;
    }

    case KIND.INPUT_REQUEST:
      s.status = 'input_waiting';
      break;

    case KIND.ANSWER:
      if (s.status === 'input_waiting') s.status = 'running';
      break;

    case KIND.CANCEL_REQUEST:
      s.status = 'cancel_requested';
      s.cancelRequested = true;
      break;

    case KIND.CANCEL_CONFIRMED:
      s.status = 'ended';
      s.outcome = s.toolsUsed > 0 ? 'cancelled_partial' : 'cancelled_nochange';
      break;

    case KIND.FINISH: {
      s.finish = signal.payload;
      const denials = signal.payload?.denials ?? [];
      if (denials.length) s.denials = mergeDenials(s.denials, denials);

      /* An unresolved refusal keeps the Work OPEN. The turn ended, but under contract B the
       * user can still allow and the SAME Work resumes in the SAME session — so ending it here
       * would throw away the thing the card is for. */
      if (s.denials.some((d) => !d.resolved)) {
        /* …unless the user asked to stop. Then the refusal is moot and the Work ends. */
        if (!s.cancelRequested) { s.status = 'permission_waiting'; break; }
      }

      /* A cancelled Work does not become 완료 because the turn happened to report success.
       * `07` §8.1: a cancelled child exits 0 and `result.is_error` is just as blind to it. */
      if (s.cancelRequested) {
        s.status = 'ended';
        s.outcome = s.toolsUsed > 0 ? 'cancelled_partial' : 'cancelled_nochange';
        break;
      }

      s.status = 'ended';
      /* `19` §C3-L reads three things together, not `is_error` alone: a turn that ran out of
       * turns reports `is_error: false` with `subtype: 'error_max_turns'`, and calling that
       * 완료 is exactly the invented success the grammar exists to prevent. */
      const p = signal.payload ?? {};
      const failed = p.isError === true
        || (typeof p.subtype === 'string' && p.subtype.startsWith('error'))
        || Boolean(p.apiErrorStatus)
        || (p.terminalReason && p.terminalReason !== 'end_turn' && p.terminalReason !== 'stop_sequence');
      /* `partial` only for a refusal that was never resolved: something was asked for and not
       * done. The full 된 것 / 안 된 것 judgement is WBS-18's. */
      s.outcome = failed ? 'failed' : (s.denials.some((d) => !d.resolved) ? 'partial' : 'complete');
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

/* A denial with no `tool_use_id` must not be deduplicated against another one that also has
 * none — the result's entry is the ONLY source of `tool_input`, which is what the allow card
 * and the scoped grant are built from, so dropping it loses the card's target. */
function mergeDenials(existing, incoming) {
  const seen = new Set(existing.map((d) => d.toolUseId).filter(Boolean));
  const out = [...existing];
  for (const d of incoming) {
    const known = d.toolUseId && seen.has(d.toolUseId);
    if (known) {
      /* the same refusal, now carrying its input: enrich rather than duplicate */
      const i = out.findIndex((x) => x.toolUseId === d.toolUseId);
      out[i] = { ...out[i], ...d, resolved: out[i].resolved };
      continue;
    }
    out.push({ ...d, resolved: false, id: `d${denialSeq++}` });
    if (d.toolUseId) seen.add(d.toolUseId);
  }
  return out;
}

/** Refusals the user has not answered yet. Contract B renders one card per entry. */
const openPermissions = (state) => (state.denials ?? []).filter((d) => !d.resolved);
/** The one the card shows first — the oldest unanswered. */
const openPermission = (state) => openPermissions(state)[0] ?? null;

/** Replay a whole stream. Used by the fixture tests and by startup recovery. */
function replay(signals) {
  let s = initial();
  for (const sig of signals) s = reduce(s, sig, sig.observedAt ?? null);
  return s;
}

module.exports = { toSignal, reduce, replay, initial, openPermission, openPermissions, KIND };
