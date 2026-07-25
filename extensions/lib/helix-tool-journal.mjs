import { createHash } from "node:crypto";
import { stableWorkflowStringify } from "../../dispatch/workflow/schema.mjs";

const TOOL_NAME = /^(?:answer|helix_[a-z0-9_]{1,63})$/;
const TOOL_CALL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PI_JOURNALS = new WeakMap();

export const TOOL_TURN_LIMITS = Object.freeze({
  max_calls: 4096,
});

function ref(value) {
  const text = stableWorkflowStringify(value);
  return typeof text === "string"
    ? `sha256:${createHash("sha256").update(text).digest("hex")}`
    : null;
}

export function createToolTurnJournal({ append } = {}) {
  const inflight = new Map();
  const seen = new Set();
  let sequence = 0;
  const persist = (entry) => {
    try { append?.(structuredClone(entry)); } catch { return false; }
    return true;
  };
  return Object.freeze({
    start({ tool_call_id, tool, args }) {
      if (!TOOL_CALL_ID.test(tool_call_id ?? "") || !TOOL_NAME.test(tool) || seen.has(tool_call_id)) {
        return { ok: false, code: "tool-turn-intent-invalid" };
      }
      if (seen.size >= TOOL_TURN_LIMITS.max_calls) {
        return { ok: false, code: "tool-turn-capacity-exceeded" };
      }
      const inputRef = ref(args);
      if (inputRef == null) return { ok: false, code: "tool-turn-input-invalid" };
      const entry = {
        schema_version: 1,
        kind: "intent",
        tool_call_id,
        tool,
        input_ref: inputRef,
      };
      sequence += 1;
      if (!persist(entry)) {
        sequence -= 1;
        return { ok: false, code: "tool-turn-journal-write-failed" };
      }
      const intentToken = Symbol("helix-tool-turn-intent");
      seen.add(tool_call_id);
      inflight.set(tool_call_id, { tool, input_ref: inputRef, intent_token: intentToken });
      return { ok: true, entry, intent_token: intentToken };
    },
    settle({ tool_call_id, tool, intent_token, result, status = "ok" }) {
      const intent = inflight.get(tool_call_id);
      if (!intent || intent.tool !== tool || intent.intent_token !== intent_token
        || !["ok", "refused", "failed"].includes(status)) {
        return { ok: false, code: "tool-turn-result-invalid" };
      }
      const resultRef = ref(result);
      const entry = {
        schema_version: 1,
        kind: "result",
        tool_call_id,
        tool,
        input_ref: intent.input_ref,
        result_ref: resultRef ?? ref({ code: "tool-turn-result-unhashable" }),
        status: resultRef == null ? "refused" : status,
      };
      sequence += 1;
      if (!persist(entry)) {
        sequence -= 1;
        return { ok: false, code: "tool-turn-journal-write-failed" };
      }
      inflight.delete(tool_call_id);
      return { ok: true, entry };
    },
    snapshot() {
      return { sequence, inflight: [...inflight.keys()] };
    },
  });
}

export function piToolTurnJournal(pi) {
  if (pi === null || (typeof pi !== "object" && typeof pi !== "function")
    || typeof pi.appendEntry !== "function") {
    throw new Error("tool-turn-journal-api-invalid");
  }
  let state = PI_JOURNALS.get(pi);
  if (state) return state.facade;
  state = {
    journal: createToolTurnJournal({
      append(entry) { pi.appendEntry("helix-tool-turn", entry); },
    }),
    facade: null,
  };
  state.facade = Object.freeze({
    start(options) { return state.journal.start(options); },
    settle(options) { return state.journal.settle(options); },
    snapshot() { return state.journal.snapshot(); },
  });
  PI_JOURNALS.set(pi, state);
  return state.facade;
}

export function resetPiToolTurnJournal(pi) {
  if (pi === null || (typeof pi !== "object" && typeof pi !== "function")
    || typeof pi.appendEntry !== "function") return false;
  const state = PI_JOURNALS.get(pi);
  if (!state) {
    piToolTurnJournal(pi);
    return true;
  }
  state.journal = createToolTurnJournal({
    append(entry) { pi.appendEntry("helix-tool-turn", entry); },
  });
  return true;
}
