// Helix dispatch — structural loop event stream.
//
// The runner emits an append-only stream of STRUCTURAL events; every renderer
// (TUI widget, plain lines, JSONL file) consumes the SAME stream. Events carry
// ids, stable codes, counts, executor refs, and relative timings — never raw
// prompts, model responses, provider payloads, private paths, or transcripts.
// Each event is public-safety-scanned at emit time and the emitter fails
// closed (throws) rather than let a leaking event into the stream.
//
// Timing uses an injected MONOTONIC clock (milliseconds since an arbitrary
// origin); events store t_rel_ms relative to run-start. No wall-clock policy
// exists (owner decision) — the run record's single timestamp is the only
// calendar time anywhere.

import { join } from "node:path";
import { assertPublicSafe, stableStringify } from "./run-record.mjs";
import { appendText } from "./persistence.mjs";
import {
  PUBLIC_CODE_PATTERN,
  isExecutorRef,
  isPublicCode,
  isPublicRef,
} from "./public-values.mjs";
import { decideStageTransition } from "./stage-machine.mjs";

export const EVENT_KINDS = Object.freeze([
  "run-start",
  "stage-start",
  "pass-start",
  "prompt",
  "pressure",
  "verdict",
  "jump-back",
  "gate",
  "revision",
  "blocked",
  "warning",
  "stage-end",
  "run-end",
]);

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
// Stable codes/refs only, never prose. Spaces are DISALLOWED so a single line of
// model-authored text (which would pass a space-permitting pattern and the
// leak-pattern scan) cannot masquerade as a stable field — every legitimate
// event string field is a kebab/colon token (executor refs, codes, verdicts).
export const CODE_PATTERN = PUBLIC_CODE_PATTERN;

const EVENT_FIELDS = Object.freeze({
  "run-start": {
    required: ["chain_id", "config_id", "max_iterations"],
    fields: { chain_id: "code", config_id: "code", max_iterations: "positive-int", warning: "code" },
  },
  "stage-start": {
    required: ["stage_id", "executor_ref"],
    fields: { stage_id: "code", executor_ref: "executor-ref" },
  },
  "pass-start": {
    required: ["stage_id", "pass", "of", "attempt", "executor_ref"],
    fields: { stage_id: "code", pass: "positive-int", of: "positive-int", attempt: "positive-int", executor_ref: "executor-ref" },
  },
  prompt: {
    required: ["stage_id", "role", "template_id", "template_hash", "brief_ref"],
    fields: { stage_id: "code", role: "code", template_id: "code", template_hash: "ref", brief_ref: "ref" },
  },
  pressure: {
    required: ["stage_id", "status"],
    fields: { stage_id: "code", tokens: "nonnegative-int", status: "pressure-status" },
  },
  verdict: {
    required: ["stage_id", "verdict"],
    fields: { stage_id: "code", verdict: "verdict" },
  },
  "jump-back": {
    required: ["stage_id", "code"],
    fields: { stage_id: "code", code: "code" },
  },
  gate: {
    required: ["stage_id", "phase", "result"],
    fields: { stage_id: "code", phase: "code", result: "gate-result" },
  },
  revision: {
    required: ["stage_id", "code"],
    fields: { stage_id: "code", code: "code", revision_ref: "ref" },
  },
  blocked: {
    required: ["code", "next_action"],
    fields: { stage_id: "code", code: "code", next_action: "code" },
  },
  warning: {
    required: ["code"],
    fields: { code: "code" },
  },
  "stage-end": {
    required: ["stage_id"],
    fields: { stage_id: "code", artifact_ref: "ref" },
  },
  "run-end": {
    required: ["converged", "stop_reason", "open_disagreements"],
    fields: { converged: "boolean", stop_reason: "code", open_disagreements: "nonnegative-int", code: "code" },
  },
});

function validTypedField(type, value) {
  if (type === "code") return isPublicCode(value);
  if (type === "executor-ref") return isExecutorRef(value);
  if (type === "ref") return isPublicRef(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "positive-int") return Number.isSafeInteger(value) && value >= 1;
  if (type === "nonnegative-int") return Number.isSafeInteger(value) && value >= 0;
  if (type === "pressure-status") return value === "measured" || value === "unavailable";
  if (type === "verdict") return ["approve", "revise", "revise-jump", "missing"].includes(value);
  if (type === "gate-result") return value === "pass" || value === "fail" || value === "not-run";
  return false;
}

/** Validate a parsed event before either persistence or rendering. */
export function validateEvent(event) {
  const errors = [];
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { valid: false, errors: ["event-not-object"] };
  }
  const shape = EVENT_FIELDS[event.kind];
  if (!shape) errors.push("unknown-event-kind");
  if (typeof event.run_id !== "string" || !RUN_ID_PATTERN.test(event.run_id)) errors.push("invalid-run-id");
  if (!Number.isSafeInteger(event.seq) || event.seq < 1) errors.push("invalid-seq");
  if (!Number.isSafeInteger(event.t_rel_ms) || event.t_rel_ms < 0) errors.push("invalid-relative-time");
  if (shape) {
    const allowed = new Set(["run_id", "seq", "t_rel_ms", "kind", ...Object.keys(shape.fields)]);
    for (const key of Object.keys(event)) {
      if (!allowed.has(key)) errors.push(`unexpected-field:${key}`);
    }
    for (const key of shape.required) {
      if (!Object.prototype.hasOwnProperty.call(event, key)) errors.push(`missing-field:${key}`);
    }
    for (const [key, value] of Object.entries(event)) {
      if (shape.fields[key] && !validTypedField(shape.fields[key], value)) errors.push(`invalid-field:${key}`);
    }
    if (event.kind === "pressure") {
      if (event.status === "measured" && !Number.isSafeInteger(event.tokens)) errors.push("measured-pressure-missing-tokens");
      if (event.status === "unavailable" && Object.prototype.hasOwnProperty.call(event, "tokens")) errors.push("unavailable-pressure-has-tokens");
    }
    if (event.kind === "pass-start" && Number.isSafeInteger(event.pass) && Number.isSafeInteger(event.of) && event.pass > event.of) {
      errors.push("pass-exceeds-rail");
    }
  }
  try {
    assertPublicSafe(event);
  } catch {
    errors.push("public-safety-scan-failed");
  }
  return { valid: errors.length === 0, errors };
}

export function assertEvent(event) {
  const checked = validateEvent(event);
  if (!checked.valid) throw new Error(`invalid-event:${checked.errors.join(",")}`);
  return event;
}

/** Closed lifecycle validation for a parsed per-run JSONL event stream. */
export function validateEventHistory(events, { run_id: expectedRunId, allow_empty = false } = {}) {
  const errors = [];
  if (!Array.isArray(events)) return { valid: false, errors: ["history-not-array"] };
  if (events.length === 0) {
    return { valid: allow_empty, errors: allow_empty ? [] : ["history-empty"] };
  }
  const runId = expectedRunId ?? events[0]?.run_id;
  const attempts = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!validateEvent(event).valid) errors.push(`invalid-event:${index}`);
    if (event?.run_id !== runId) errors.push(`run-id-mismatch:${index}`);
    if (event?.seq !== index + 1) errors.push(`noncontiguous-seq:${index}`);
    if (index > 0 && event?.t_rel_ms < events[index - 1]?.t_rel_ms) errors.push(`time-regressed:${index}`);
    if (event?.kind === "pass-start" && Number.isSafeInteger(event.attempt)) {
      const key = `${event.stage_id}:${event.pass}`;
      const expectedAttempt = (attempts.get(key) ?? 0) + 1;
      if (event.attempt !== expectedAttempt) errors.push(`attempt-noncontiguous:${index}`);
      attempts.set(key, event.attempt);
    }
  }
  if (events[0]?.kind !== "run-start") errors.push("run-start-not-first");
  if (events.filter((event) => event?.kind === "run-start").length !== 1) errors.push("run-start-count");
  const runEnds = events.flatMap((event, index) => event?.kind === "run-end" ? [index] : []);
  if (runEnds.length > 1) errors.push("run-end-count");
  if (runEnds.length === 1 && runEnds[0] !== events.length - 1) errors.push("event-after-run-end");
  if (runEnds.length === 1) {
    const terminal = events[runEnds[0]];
    if (terminal.converged === true) {
      if (terminal.stop_reason !== "converged") errors.push("converged-stop-reason-mismatch");
      const conclusion = events[runEnds[0] - 1];
      if (conclusion?.kind !== "gate" || conclusion.phase !== "conclusion" || conclusion.result !== "pass") {
        errors.push("converged-without-objective-gate");
      }
    } else if (terminal.stop_reason === "converged") {
      errors.push("nonconverged-stop-reason-mismatch");
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Reduce one event stream through the declared chain in order. This is the
 * lifecycle source of truth shared by runner recovery and `/helix`: counts alone
 * cannot prove that a later stage was reached by a valid advance or back-jump.
 */
export function reduceEventLifecycle(events, {
  chain,
  max_iterations,
  toggles = null,
  run_id,
  allow_empty = false,
} = {}) {
  const invalid = (code) => ({ valid: false, errors: [code], machine: null, terminal: null });
  if (!Array.isArray(chain?.stages) || chain.stages.length === 0
    || !Number.isSafeInteger(max_iterations) || max_iterations < 1) return invalid("lifecycle-config-invalid");
  const structural = validateEventHistory(events, { run_id, allow_empty });
  if (!structural.valid) return invalid(`lifecycle-structure:${structural.errors[0] ?? "invalid"}`);

  const stages = chain.stages;
  const stageIndexById = new Map(stages.map((stage, index) => [stage.id, index]));
  const counts = Object.fromEntries(stages.map((stage) => [stage.id, 0]));
  const loopsEnabled = !toggles || toggles.loops !== false;
  const seenStages = new Set();
  let stageIndex = 0;
  let phase = "stage";
  let totalPasses = 0;
  let active = null;
  let retryable = null;
  let terminal = null;

  const snapshot = () => ({
    stageIndex,
    phase,
    totalPasses,
    counts: { ...counts },
  });
  const restore = (state) => {
    stageIndex = state.stageIndex;
    phase = state.phase;
    totalPasses = state.totalPasses;
    for (const stage of stages) counts[stage.id] = state.counts[stage.id];
  };
  const sameAttempt = (candidate, event) => candidate
    && candidate.stage_id === event.stage_id && candidate.pass === event.pass
    && event.attempt === candidate.attempt + 1;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.kind === "run-start" || event.kind === "warning") continue;
    if (terminal) return invalid(`lifecycle-event-after-terminal:${index}`);

    if (event.kind === "stage-start") {
      if (phase !== "stage" || active || retryable || event.stage_id !== stages[stageIndex]?.id
        || seenStages.has(event.stage_id)) return invalid(`lifecycle-stage-start:${index}`);
      seenStages.add(event.stage_id);
      continue;
    }

    if (event.kind === "pass-start") {
      const repeated = sameAttempt(active, event) ? active : (sameAttempt(retryable, event) ? retryable : null);
      if (repeated) {
        restore(repeated.base);
        active = null;
        retryable = null;
      } else if (active) {
        return invalid(`lifecycle-pass-before-decision:${index}`);
      } else {
        retryable = null;
      }
      const stage = stages[stageIndex];
      if (phase !== "stage" || event.stage_id !== stage?.id || !seenStages.has(event.stage_id)
        || event.pass !== counts[event.stage_id] + 1 || event.of !== max_iterations
        || totalPasses >= max_iterations
        || (loopsEnabled && stage.advance && event.pass > stage.advance.max_passes)
        || (!loopsEnabled && event.pass > 1)) return invalid(`lifecycle-pass-order:${index}`);
      const base = snapshot();
      counts[event.stage_id] += 1;
      totalPasses += 1;
      active = { stage_id: event.stage_id, pass: event.pass, attempt: event.attempt, base, decision: null };
      continue;
    }

    if (event.kind === "prompt" || event.kind === "pressure" || event.kind === "revision") {
      if (!active || event.stage_id !== active.stage_id) return invalid(`lifecycle-pass-field:${index}`);
      continue;
    }

    if (event.kind === "verdict") {
      const stage = stages[stageIndex];
      if (!active || event.stage_id !== active.stage_id || !stage?.advance || active.decision) {
        return invalid(`lifecycle-verdict:${index}`);
      }
      active.decision = decideStageTransition(stage, active.pass, { verdict: event.verdict }, loopsEnabled);
      if (active.decision.action === "stay" || active.decision.action === "refuse") {
        retryable = active;
        active = null;
      }
      continue;
    }

    if (event.kind === "gate") {
      if (event.phase === "stage-expectation") {
        const stage = stages[stageIndex];
        if (!active || event.stage_id !== active.stage_id || !stage?.gate_expectation || active.decision) {
          return invalid(`lifecycle-stage-gate:${index}`);
        }
        active.decision = decideStageTransition(stage, active.pass, { gate_result: event.result }, loopsEnabled);
        if (active.decision.action === "stay") {
          retryable = active;
          active = null;
        }
        continue;
      }
      if (event.phase !== "conclusion" || phase !== "conclusion" || active
        || event.stage_id !== stages.at(-1).id) return invalid(`lifecycle-conclusion-gate:${index}`);
      retryable = null;
      if (event.result === "fail" && loopsEnabled) {
        phase = "stage";
        stageIndex = stages.length - 1;
      }
      continue;
    }

    if (event.kind === "stage-end") {
      const stage = stages[stageIndex];
      const plainAdvance = active && !stage.advance && !stage.gate_expectation;
      if (!active || event.stage_id !== active.stage_id
        || (!plainAdvance && active.decision?.action !== "advance")) {
        return invalid(`lifecycle-stage-end:${index}`);
      }
      active = null;
      retryable = null;
      if (stageIndex + 1 < stages.length) stageIndex += 1;
      else phase = "conclusion";
      continue;
    }

    if (event.kind === "jump-back") {
      const target = active?.decision?.target;
      if (!active || event.stage_id !== active.stage_id || active.decision?.action !== "jump"
        || !stageIndexById.has(target)) return invalid(`lifecycle-jump:${index}`);
      stageIndex = stageIndexById.get(target);
      phase = "stage";
      active = null;
      retryable = null;
      continue;
    }

    if (event.kind === "blocked") {
      if (event.stage_id !== undefined && event.stage_id !== (active?.stage_id ?? stages[stageIndex]?.id)) {
        return invalid(`lifecycle-blocked-stage:${index}`);
      }
      continue;
    }

    if (event.kind === "run-end") {
      if (event.converged === true) {
        const gate = events[index - 1];
        if (phase !== "conclusion" || gate?.kind !== "gate" || gate.phase !== "conclusion" || gate.result !== "pass") {
          return invalid(`lifecycle-terminal-convergence:${index}`);
        }
      }
      active = null;
      retryable = null;
      terminal = event;
      continue;
    }
  }

  return {
    valid: true,
    errors: [],
    machine: {
      phase,
      stage_index: stageIndex,
      pass_counts: counts,
      total_passes: totalPasses,
    },
    terminal,
  };
}

/** Bind the ordered lifecycle, resolved executors, checkpoint, and terminal truth. */
export function validateCheckpointEventBinding(events, state, {
  max_iterations,
  chain,
  toggles = null,
} = {}) {
  if (!Array.isArray(events) || !state || typeof state !== "object" || Array.isArray(state)
    || !Number.isSafeInteger(state.event_count) || state.event_count < 0
    || state.event_count > events.length || !Array.isArray(state.resolved_cast)) return false;
  if (events.length > 0) {
    const runStart = events[0];
    if (runStart?.kind !== "run-start" || runStart.chain_id !== state.chain_id
      || runStart.config_id !== state.config_id || runStart.max_iterations !== max_iterations) return false;
  }

  const executorByStage = new Map();
  for (const entry of state.resolved_cast) {
    if (!entry || typeof entry.stage_id !== "string" || typeof entry.executor_ref !== "string"
      || executorByStage.has(entry.stage_id)) return false;
    executorByStage.set(entry.stage_id, entry.executor_ref);
  }
  for (const event of events) {
    if (event?.kind !== "pass-start" && event?.kind !== "stage-start") continue;
    if (executorByStage.get(event.stage_id) !== event.executor_ref) return false;
  }

  const full = reduceEventLifecycle(events, {
    chain, max_iterations, toggles, run_id: state.run_id, allow_empty: state.initializing === true,
  });
  if (!full.valid) return false;

  const committed = events.slice(0, state.event_count);
  if (state.pending_event) {
    const existing = events[state.event_count];
    if (existing) {
      const projected = { kind: existing.kind };
      for (const key of Object.keys(state.pending_event.fields)) projected[key] = existing[key];
      if (stableStringify(projected) !== stableStringify({
        kind: state.pending_event.kind,
        ...state.pending_event.fields,
      })) return false;
      committed.push(existing);
    } else {
      committed.push({
        run_id: state.run_id,
        seq: committed.length + 1,
        t_rel_ms: committed.at(-1)?.t_rel_ms ?? 0,
        kind: state.pending_event.kind,
        ...state.pending_event.fields,
      });
    }
  }
  const reduced = reduceEventLifecycle(committed, {
    chain, max_iterations, toggles, run_id: state.run_id, allow_empty: state.initializing === true,
  });
  if (!reduced.valid || stableStringify(reduced.machine) !== stableStringify(state.machine)) return false;
  if (state.completed === true) {
    if (!reduced.terminal || reduced.terminal.stop_reason !== state.stop_reason
      || reduced.terminal.converged !== (state.stop_reason === "converged")) return false;
  } else if (reduced.terminal) {
    return false;
  }
  return true;
}

/**
 * Create an append-only event log for one run.
 *
 * @param {object} opts
 * @param {string} opts.run_id
 * @param {() => number} [opts.monotonic] injected monotonic ms clock
 * @param {(event:object) => void} [opts.onEvent] live renderer hook (TUI/lines)
 * @param {string} [opts.dir] when set, each event is appended (JSONL) to
 *   `${dir}/${run_id}.events.jsonl` as it is emitted — interrupt-safe by
 *   construction: a killed run keeps every event up to the kill.
 * @param {number} [opts.start_seq] resume continuation: the next emitted seq is
 *   start_seq+1, so a resumed run's appended events keep the per-run log
 *   strictly monotonic (a fresh 1 would corrupt the append-only stream).
 */
export function makeEventLog({ run_id, monotonic, onEvent, dir, start_seq, start_t_rel_ms } = {}) {
  if (typeof run_id !== "string" || !RUN_ID_PATTERN.test(run_id)) {
    throw new Error("event-log: run_id is not a safe token");
  }
  const clock = typeof monotonic === "function" ? monotonic : () => 0;
  const origin = clock();
  const events = [];
  if (start_seq !== undefined && (!Number.isSafeInteger(start_seq) || start_seq < 0)) {
    throw new Error("event-log: start_seq must be a non-negative safe integer");
  }
  if (start_t_rel_ms !== undefined
    && (!Number.isSafeInteger(start_t_rel_ms) || start_t_rel_ms < 0)) {
    throw new Error("event-log: start_t_rel_ms must be a non-negative safe integer");
  }
  let seq = start_seq ?? 0;
  const timeOffset = start_t_rel_ms ?? 0;
  const path = typeof dir === "string" ? join(dir, `${run_id}.events.jsonl`) : null;

  function emit(kind, fields = {}) {
    if (!EVENT_KINDS.includes(kind)) throw new Error(`event-log: unknown event kind '${kind}'`);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("event-log: fields must be an object");
    for (const reserved of ["run_id", "seq", "t_rel_ms", "kind"]) {
      if (Object.prototype.hasOwnProperty.call(fields, reserved)) throw new Error(`event-log: reserved field '${reserved}'`);
    }
    if (!Number.isSafeInteger(seq + 1)) throw new Error("event-log: sequence exhausted");
    const elapsed = timeOffset + Math.max(0, Math.round(clock() - origin));
    const event = Object.freeze({
      run_id,
      seq: (seq += 1),
      t_rel_ms: elapsed,
      kind,
      ...fields,
    });
    assertEvent(event); // fail closed before the event exists anywhere
    events.push(event);
    if (path) {
      appendText(dir, `${run_id}.events.jsonl`, stableStringify(event) + "\n");
    }
    if (typeof onEvent === "function") {
      try {
        onEvent(event);
      } catch {
        const error = new Error("event-renderer-failed");
        error.code = "event-renderer-failed";
        throw error;
      }
    }
    return event;
  }

  return { emit, events, path };
}

/**
 * Plain line renderer — the degraded/off-TTY view every environment gets.
 * One structural line per event; no model text can exist in the stream, so
 * the renderer cannot leak. `verbosity: "summary"` (the explicit CLI flag)
 * prints only run/stage boundaries, blocked states, and the final gate.
 */
export function renderEventLine(event, { verbosity = "stream" } = {}) {
  assertEvent(event);
  const summaryKinds = ["run-start", "stage-start", "blocked", "gate", "run-end"];
  if (verbosity === "summary" && !summaryKinds.includes(event.kind)) return null;
  const parts = [`[${String(event.t_rel_ms).padStart(6)}ms]`, event.kind];
  for (const key of ["stage_id", "executor_ref", "pass", "of", "verdict", "result", "code", "next_action", "stop_reason"]) {
    if (event[key] !== undefined) parts.push(`${key}=${event[key]}`);
  }
  return parts.join(" ");
}
