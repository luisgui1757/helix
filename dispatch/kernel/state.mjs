// Closed private scheduler checkpoint. It deliberately stores no raw task;
// resume must present the original task and re-prove its hash.

import { createHash } from "node:crypto";
import { stableWorkflowStringify } from "../workflow/schema.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export const KERNEL_CHECKPOINT_LIMITS = Object.freeze({
  max_document_bytes: 16 * 1024 * 1024,
  max_scheduler_bytes: 15 * 1024 * 1024,
  min_failure_headroom_bytes: 16 * 1024,
});
const RECOVERABLE_FAILURES = new Set([
  "kernel-checkpoint-snapshot-failed",
  "kernel-checkpoint-workspace-invalid",
  "kernel-checkpoint-write-failed",
  "kernel-boundary-outcome-unknown",
  "kernel-effect-outcome-unknown",
  "kernel-event-write-failed",
  "kernel-journal-write-failed",
  "kernel-workspace-begin-failed",
  "kernel-workspace-commit-failed",
  "kernel-workspace-finalize-failed",
  "kernel-workspace-fingerprint-failed",
  "kernel-workspace-ref-invalid",
  "kernel-workspace-snapshot-cleanup-failed",
  "kernel-workspace-snapshot-failed",
  "objective-gate-sandbox-cleanup-failed",
  "objective-gate-termination-unconfirmed",
  "objective-gate-workspace-drift",
  "objective-gate-workspace-invalid",
  "objective-gate-workspace-restore-failed",
]);

export function isRecoverableKernelFailure(code) {
  return RECOVERABLE_FAILURES.has(code);
}

export function kernelResultIsComplete({ status, code } = {}, { has_checkpoint = false } = {}) {
  return !["paused", "running"].includes(status)
    && !(has_checkpoint && isRecoverableKernelFailure(code));
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validGateBoundary(boundary) {
  if (!plain(boundary) || boundary.kind !== "gate" || !HASH.test(boundary.identity ?? "")
    || !["inflight", "settled"].includes(boundary.status)) return false;
  if (boundary.status === "inflight") return exact(boundary, ["kind", "identity", "status"]);
  if (!exact(boundary, ["kind", "identity", "status", "result"]) || !plain(boundary.result)) return false;
  const resultKeys = ["result", ...(boundary.result.result === "error" ? ["code"] : []),
    ...(Object.hasOwn(boundary.result, "evidence_ref") ? ["evidence_ref"] : [])];
  return exact(boundary.result, resultKeys)
    && ["pass", "fail", "error"].includes(boundary.result.result)
    && (boundary.result.result !== "error"
      || (typeof boundary.result.code === "string" && boundary.result.code.length <= 160 && CODE.test(boundary.result.code)))
    && (boundary.result.evidence_ref == null || HASH.test(boundary.result.evidence_ref));
}

function eventHash(value) {
  const serialized = stableWorkflowStringify(value);
  return typeof serialized === "string"
    ? `sha256:${createHash("sha256").update(serialized).digest("hex")}`
    : null;
}

export const EMPTY_KERNEL_EVENT_PREFIX_REF = eventHash({
  schema_version: 1,
  kind: "kernel-event-prefix-root",
});

export function extendKernelEventPrefixRef(priorRef, event) {
  if (!HASH.test(priorRef ?? "") || !plain(event)) return null;
  return eventHash({ schema_version: 1, prior_ref: priorRef, event });
}

export function kernelEventPrefixRef(events, priorRef = EMPTY_KERNEL_EVENT_PREFIX_REF) {
  if (!Array.isArray(events) || !HASH.test(priorRef ?? "")) return null;
  let ref = priorRef;
  for (const event of events) {
    ref = extendKernelEventPrefixRef(ref, event);
    if (ref == null) return null;
  }
  return ref;
}

const CHILD_EVENT_FIELDS = Object.freeze([
  "definition_ref", "execution_mode", "target", "edge_id", "edge_kind", "visit", "instance_id",
  "effect_ref", "slot_count", "result", "final", "evidence_ref", "repair_attempt", "attempt", "next_attempt",
  "prior_instance_id", "status", "code", "failure_class",
]);

export function kernelChildEventPrefix(parentEvents, childRunId, childEventSeq) {
  if (!Array.isArray(parentEvents) || typeof childRunId !== "string" || childRunId.length === 0
    || !Number.isSafeInteger(childEventSeq) || childEventSeq < 0) return null;
  const wrappers = parentEvents.filter((event) => event?.kind === "subworkflow-event"
    && event.child_run_id === childRunId && event.child_seq <= childEventSeq);
  if (wrappers.length !== childEventSeq) return null;
  const events = [];
  for (let index = 0; index < wrappers.length; index += 1) {
    const wrapper = wrappers[index];
    if (wrapper.child_seq !== index + 1 || typeof wrapper.child_kind !== "string"
      || typeof wrapper.child_node_id !== "string") return null;
    const event = {
      schema_version: 1,
      seq: wrapper.child_seq,
      run_id: wrapper.child_run_id,
      kind: wrapper.child_kind,
      node_id: wrapper.child_node_id,
    };
    for (const field of CHILD_EVENT_FIELDS) {
      const childField = `child_${field}`;
      if (Object.hasOwn(wrapper, childField)) event[field] = wrapper[childField];
    }
    events.push(event);
  }
  return events;
}

export function validateKernelCheckpointEventPrefix(checkpoint, eventPrefix) {
  if (!plain(checkpoint) || ![4, 5].includes(checkpoint.schema_version)
    || !Array.isArray(eventPrefix) || eventPrefix.length !== checkpoint.event_seq
    || kernelEventPrefixRef(eventPrefix) !== checkpoint.event_ref) return false;
  if (!plain(checkpoint.active) || !Object.hasOwn(checkpoint.active, "child")) return true;
  const child = checkpoint.active.child;
  const childPrefix = kernelChildEventPrefix(eventPrefix, child.run_id, child.scheduler?.event_seq);
  return childPrefix != null && validateKernelCheckpointEventPrefix(child.scheduler, childPrefix);
}

export function validateKernelCheckpoint(checkpoint, {
  run_id, definition_ref, runtime_ref, task_ref, node_ids, execution_mode = "original-mode", event_prefix,
} = {}) {
  const baseKeys = [
    "schema_version", "run_id", "definition_ref", "runtime_ref", "task_ref", "current",
    "outputs", "visits", "active", "event_seq", "journal_entries", "budget", "workspace_ref",
  ];
  const elapsedCheckpoint = [2, 3, 4, 5].includes(checkpoint?.schema_version);
  const boundEventCheckpoint = [4, 5].includes(checkpoint?.schema_version);
  const modeCheckpoint = [3, 5].includes(checkpoint?.schema_version);
  const keys = elapsedCheckpoint
    ? [...baseKeys, "elapsed_ms", ...(boundEventCheckpoint ? ["event_ref"] : []),
      ...(modeCheckpoint ? ["execution_mode"] : []),
      ...(Object.hasOwn(checkpoint ?? {}, "terminal_result") ? ["terminal_result"] : [])]
    : baseKeys;
  if (!exact(checkpoint, keys) || ![1, 2, 3, 4, 5].includes(checkpoint.schema_version)
    || !["original-mode", "graph-mode"].includes(execution_mode)
    || (modeCheckpoint
      ? checkpoint.execution_mode !== "graph-mode" || execution_mode !== "graph-mode"
      : execution_mode !== "original-mode")
    || checkpoint.run_id !== run_id || checkpoint.definition_ref !== definition_ref
    || checkpoint.runtime_ref !== runtime_ref || checkpoint.task_ref !== task_ref
    || !HASH.test(checkpoint.definition_ref ?? "") || !HASH.test(checkpoint.runtime_ref ?? "")
    || !HASH.test(checkpoint.task_ref ?? "") || !HASH.test(checkpoint.workspace_ref ?? "")
    || !(node_ids instanceof Set) || !node_ids.has(checkpoint.current)
    || !plain(checkpoint.outputs) || !plain(checkpoint.visits)
    || Object.keys(checkpoint.visits).length !== node_ids.size
    || [...node_ids].some((id) => !Number.isSafeInteger(checkpoint.visits[id]) || checkpoint.visits[id] < 0)
    || !Number.isSafeInteger(checkpoint.event_seq) || checkpoint.event_seq < 0
    || (boundEventCheckpoint && !HASH.test(checkpoint.event_ref ?? ""))
    || !Number.isSafeInteger(checkpoint.journal_entries) || checkpoint.journal_entries < 0
    || (elapsedCheckpoint && (!Number.isSafeInteger(checkpoint.elapsed_ms) || checkpoint.elapsed_ms < 0))
    || !exact(checkpoint.budget, ["effects", "tokens", "cost_micros", "max_effects", "max_tokens", "max_cost_micros", "reserved"])
    || ![checkpoint.budget.effects, checkpoint.budget.tokens, checkpoint.budget.cost_micros]
      .every((value) => Number.isSafeInteger(value) && value >= 0)
    || !Number.isSafeInteger(checkpoint.budget.max_effects) || checkpoint.budget.max_effects < 1
    || checkpoint.budget.effects > checkpoint.budget.max_effects
    || ![checkpoint.budget.max_tokens, checkpoint.budget.max_cost_micros]
      .every((value) => value === null || (Number.isSafeInteger(value) && value >= 0))
    || !Number.isSafeInteger(checkpoint.budget.reserved) || checkpoint.budget.reserved < 0
    || !Number.isSafeInteger(checkpoint.budget.effects + checkpoint.budget.reserved)
    || checkpoint.budget.effects + checkpoint.budget.reserved > checkpoint.budget.max_effects) {
    return { valid: false, code: "kernel-checkpoint-invalid" };
  }
  if (Object.hasOwn(checkpoint, "terminal_result")
    && (!exact(checkpoint.terminal_result, ["status", "code"])
      || !["succeeded", "failed", "refused", "cancelled"].includes(checkpoint.terminal_result.status)
      || (checkpoint.terminal_result.code !== null
        && (typeof checkpoint.terminal_result.code !== "string"
          || checkpoint.terminal_result.code.length > 160
          || !CODE.test(checkpoint.terminal_result.code)))
      || checkpoint.active !== null || checkpoint.budget.reserved !== 0
      || checkpoint.visits[checkpoint.current] < 1)) {
    return { valid: false, code: "kernel-checkpoint-terminal-invalid" };
  }
  if (boundEventCheckpoint && !validateKernelCheckpointEventPrefix(checkpoint, event_prefix)) {
    return { valid: false, code: "kernel-checkpoint-events-invalid" };
  }
  if (checkpoint.active !== null) {
    const activeKeys = ["node_id", "visit", "completed"];
    if (elapsedCheckpoint) activeKeys.push("inflight");
    if (Object.hasOwn(checkpoint.active, "child")) activeKeys.push("child");
    if (Object.hasOwn(checkpoint.active, "boundary")) activeKeys.push("boundary");
    if (!exact(checkpoint.active, activeKeys)
      || checkpoint.active.node_id !== checkpoint.current
      || !Number.isSafeInteger(checkpoint.active.visit) || checkpoint.active.visit < 1
      || checkpoint.active.visit !== checkpoint.visits[checkpoint.active.node_id]
      || !plain(checkpoint.active.completed)
      || Object.entries(checkpoint.active.completed).some(([id, result]) => typeof id !== "string" || id.length > 256
        || !plain(result) || !["ok", "failed", "refused", "cancelled"].includes(result.status))) {
      return { valid: false, code: "kernel-checkpoint-active-invalid" };
    }
    if (Object.hasOwn(checkpoint.active, "boundary") && !validGateBoundary(checkpoint.active.boundary)) {
      return { valid: false, code: "kernel-checkpoint-boundary-invalid" };
    }
    if (elapsedCheckpoint
      && (!plain(checkpoint.active.inflight)
        || Object.entries(checkpoint.active.inflight).some(([id, intent]) => typeof id !== "string" || id.length > 256
          || !exact(intent, ["identity", "base_identity", "mutating"])
          || !HASH.test(intent.identity ?? "") || !HASH.test(intent.base_identity ?? "")
          || typeof intent.mutating !== "boolean"))) {
      return { valid: false, code: "kernel-checkpoint-inflight-invalid" };
    }
    if (Object.hasOwn(checkpoint.active, "child")
      && (!exact(checkpoint.active.child, ["workflow_id", "version", "run_id", "scheduler"])
        || typeof checkpoint.active.child.workflow_id !== "string"
        || !Number.isSafeInteger(checkpoint.active.child.version) || checkpoint.active.child.version < 1
        || typeof checkpoint.active.child.run_id !== "string" || !plain(checkpoint.active.child.scheduler))) {
      return { valid: false, code: "kernel-checkpoint-child-invalid" };
    }
    if (Object.hasOwn(checkpoint.active, "child")) {
      const child = checkpoint.active.child.scheduler;
      const childEventPrefix = boundEventCheckpoint
        ? kernelChildEventPrefix(event_prefix, checkpoint.active.child.run_id, child.event_seq)
        : null;
      const childChecked = validateKernelCheckpoint(child, {
        run_id: child.run_id,
        definition_ref: child.definition_ref,
        runtime_ref,
        task_ref,
        node_ids: new Set(plain(child.visits) ? Object.keys(child.visits) : []),
        execution_mode,
        event_prefix: childEventPrefix,
      });
      const childBudgetExceedsParent = ["effects", "tokens", "cost_micros", "reserved"]
        .some((field) => child.budget?.[field] > checkpoint.budget[field]);
      const childEventPrefixUnbound = boundEventCheckpoint && ![4, 5].includes(child.schema_version);
      if (!childChecked.valid || childEventPrefixUnbound || (boundEventCheckpoint && childEventPrefix == null)
        || checkpoint.active.child.run_id !== child.run_id || childBudgetExceedsParent) {
        return { valid: false, code: "kernel-checkpoint-child-invalid" };
      }
    }
  }
  try {
    if (Buffer.byteLength(JSON.stringify(checkpoint), "utf8") > KERNEL_CHECKPOINT_LIMITS.max_document_bytes) {
      return { valid: false, code: "kernel-checkpoint-too-large" };
    }
  } catch {
    return { valid: false, code: "kernel-checkpoint-invalid" };
  }
  return { valid: true };
}
