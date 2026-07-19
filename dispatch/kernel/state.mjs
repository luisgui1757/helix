// Closed private scheduler checkpoint. It deliberately stores no raw task;
// resume must present the original task and re-prove its hash.

const HASH = /^sha256:[0-9a-f]{64}$/;
export const KERNEL_CHECKPOINT_LIMITS = Object.freeze({ max_document_bytes: 16 * 1024 * 1024 });
const RECOVERABLE_FAILURES = new Set([
  "kernel-checkpoint-snapshot-failed",
  "kernel-checkpoint-workspace-invalid",
  "kernel-checkpoint-write-failed",
  "kernel-journal-write-failed",
  "kernel-workspace-begin-failed",
  "kernel-workspace-commit-failed",
  "kernel-workspace-finalize-failed",
  "kernel-workspace-fingerprint-failed",
  "kernel-workspace-ref-invalid",
  "kernel-workspace-snapshot-cleanup-failed",
  "kernel-workspace-snapshot-failed",
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

export function validateKernelCheckpoint(checkpoint, { run_id, definition_ref, runtime_ref, task_ref, node_ids } = {}) {
  const baseKeys = [
    "schema_version", "run_id", "definition_ref", "runtime_ref", "task_ref", "current",
    "outputs", "visits", "active", "event_seq", "journal_entries", "budget", "workspace_ref",
  ];
  const keys = checkpoint?.schema_version === 2 ? [...baseKeys, "elapsed_ms"] : baseKeys;
  if (!exact(checkpoint, keys) || ![1, 2].includes(checkpoint.schema_version)
    || checkpoint.run_id !== run_id || checkpoint.definition_ref !== definition_ref
    || checkpoint.runtime_ref !== runtime_ref || checkpoint.task_ref !== task_ref
    || !HASH.test(checkpoint.definition_ref ?? "") || !HASH.test(checkpoint.runtime_ref ?? "")
    || !HASH.test(checkpoint.task_ref ?? "") || !HASH.test(checkpoint.workspace_ref ?? "")
    || !(node_ids instanceof Set) || !node_ids.has(checkpoint.current)
    || !plain(checkpoint.outputs) || !plain(checkpoint.visits)
    || Object.keys(checkpoint.visits).length !== node_ids.size
    || [...node_ids].some((id) => !Number.isSafeInteger(checkpoint.visits[id]) || checkpoint.visits[id] < 0)
    || !Number.isSafeInteger(checkpoint.event_seq) || checkpoint.event_seq < 0
    || !Number.isSafeInteger(checkpoint.journal_entries) || checkpoint.journal_entries < 0
    || (checkpoint.schema_version === 2 && (!Number.isSafeInteger(checkpoint.elapsed_ms) || checkpoint.elapsed_ms < 0))
    || !exact(checkpoint.budget, ["effects", "tokens", "cost_micros", "max_effects", "max_tokens", "max_cost_micros", "reserved"])
    || ![checkpoint.budget.effects, checkpoint.budget.tokens, checkpoint.budget.cost_micros]
      .every((value) => Number.isSafeInteger(value) && value >= 0)
    || !Number.isSafeInteger(checkpoint.budget.reserved) || checkpoint.budget.reserved < 0) {
    return { valid: false, code: "kernel-checkpoint-invalid" };
  }
  if (checkpoint.active !== null) {
    const activeKeys = ["node_id", "visit", "completed"];
    if (checkpoint.schema_version === 2) activeKeys.push("inflight");
    if (Object.hasOwn(checkpoint.active, "child")) activeKeys.push("child");
    if (!exact(checkpoint.active, activeKeys)
      || checkpoint.active.node_id !== checkpoint.current
      || !Number.isSafeInteger(checkpoint.active.visit) || checkpoint.active.visit < 1
      || !plain(checkpoint.active.completed)
      || Object.entries(checkpoint.active.completed).some(([id, result]) => typeof id !== "string" || id.length > 256
        || !plain(result) || !["ok", "failed", "refused", "cancelled"].includes(result.status))) {
      return { valid: false, code: "kernel-checkpoint-active-invalid" };
    }
    if (checkpoint.schema_version === 2
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
