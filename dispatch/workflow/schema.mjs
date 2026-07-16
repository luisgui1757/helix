// WorkflowDefinition v4 — the closed, provider-neutral workflow IR.
//
// The v4 document is the only user-deployable runtime definition. Existing
// schema-v1 workflow documents are accepted as migration input and normalized
// into this shape before validation, hashing, consent, persistence, or run.
// Runtime code never evaluates user JavaScript or expressions.

import { createHash } from "node:crypto";
import { isSafeWorktreeFilePath } from "../lib/persistence.mjs";
import { isPublicCode } from "../lib/public-values.mjs";
import { ROLES } from "../lib/role-envelope.mjs";

const ID = /^[a-z0-9][a-z0-9._-]*$/;
const NODE_ID = /^[a-z][a-z0-9-]*$/;
const MAX_WORKFLOW_BYTES = 256 * 1024;
const MAX_NODES = 256;
const MAX_INLINE_STAGES = 16;
const MAX_TRANSITIONS = 16;
const MAX_TOTAL_EFFECTS = 1_000;
const MAX_CONCURRENCY = 16;
const MAX_MAP_ITEMS = 256;
const MAX_RUN_MS = 8 * 60 * 60 * 1000;
const MAX_CALL_MS = 60 * 60 * 1000;

export const WORKFLOW_SCHEMA_VERSION = 4;
export const WORKFLOW_DEFAULTS = Object.freeze({
  max_total_effects: 32,
  max_concurrency: 4,
  max_map_items: 16,
  max_run_ms: 30 * 60 * 1000,
  max_call_ms: 10 * 60 * 1000,
  max_visits: 3,
  structured_repair_attempts: 2,
});

export const WORKFLOW_NODE_KINDS = Object.freeze([
  "agent", "parallel", "map", "pipeline", "reduce",
  "decision", "gate", "checkpoint", "subworkflow", "terminal",
]);

const MUTATING_ROLES = new Set(["planner", "builder", "documenter"]);
const isSafeWorkflowPath = isSafeWorktreeFilePath;

function issue(path, message) {
  return { path, message };
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  if (!plain(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function safeId(value, pattern = ID, max = 64) {
  return typeof value === "string" && value.length <= max && pattern.test(value);
}

function safeInteger(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function pointerSegments(pointer) {
  if (pointer === "") return [];
  if (typeof pointer !== "string" || !pointer.startsWith("/") || pointer.length > 512) return null;
  const parts = pointer.slice(1).split("/");
  if (parts.some((part) => part === "" || part.length > 128 || /~(?![01])/.test(part))) return null;
  return parts.map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function validateJsonSchema(schema, path, errors) {
  if (!plain(schema) || schema.type !== "object" || schema.additionalProperties !== false
    || !plain(schema.properties) || !Array.isArray(schema.required)
    || schema.required.some((key) => typeof key !== "string" || !Object.hasOwn(schema.properties, key))) {
    errors.push(issue(path, "must be a closed object JSON schema"));
  }
}

function validateGate(gate, path, errors) {
  if (!plain(gate)) {
    errors.push(issue(path, "must be an objective gate"));
    return;
  }
  if (gate.type === "file-contains") {
    if (!exactKeys(gate, ["type", "path", "contains"])
      || !isSafeWorkflowPath(gate.path) || typeof gate.contains !== "string"
      || gate.contains.length < 1 || gate.contains.length > 256) {
      errors.push(issue(path, "must be a bounded contained file-contains gate"));
    }
    return;
  }
  if (gate.type === "command-exit-zero") {
    if (!exactKeys(gate, ["type", "command", "args", "timeout_ms"])
      || typeof gate.command !== "string" || gate.command.length > 128
      || !Array.isArray(gate.args) || gate.args.length > 32
      || gate.args.some((arg) => typeof arg !== "string" || arg.length > 256 || arg.includes("\0"))
      || !safeInteger(gate.timeout_ms, 1_000, 10 * 60 * 1000)) {
      errors.push(issue(path, "must be a bounded argv-only command-exit-zero gate"));
    }
    return;
  }
  errors.push(issue(`${path}.type`, "must be file-contains or command-exit-zero"));
}

function validateRetry(retry, path, errors) {
  if (!exactKeys(retry, ["max_attempts", "backoff_ms"])
    || !safeInteger(retry.max_attempts, 1, 3)
    || !safeInteger(retry.backoff_ms, 0, 60_000)) {
    errors.push(issue(path, "must contain max_attempts 1..3 and backoff_ms 0..60000"));
  }
}

function validateAgent(node, path, errors, { inline = false } = {}) {
  const required = ["kind", "role", "stage_id", "prompt", "output_schema", "tools", "mutation", "timeout_ms", "retry"];
  const optional = inline ? ["label"] : ["label", "next", "max_visits", "artifact"];
  if (!exactKeys(node, required, optional)) {
    errors.push(issue(path, "must contain only agent fields"));
    return;
  }
  if (!ROLES.includes(node.role)) errors.push(issue(`${path}.role`, "must be a known Helix role"));
  if (!safeId(node.stage_id, NODE_ID)) errors.push(issue(`${path}.stage_id`, "must be a safe stage id"));
  if (typeof node.prompt !== "string" || node.prompt.length < 1 || node.prompt.length > 16_384) {
    errors.push(issue(`${path}.prompt`, "must be a non-empty bounded prompt template id"));
  }
  if (!plain(node.output_schema) || typeof node.output_schema.id !== "string"
    || !["semantic-v2", "verdict-v1", "freeform-v1"].includes(node.output_schema.id)
    || Object.keys(node.output_schema).some((key) => key !== "id")) {
    errors.push(issue(`${path}.output_schema`, "must name a supported closed output schema"));
  }
  if (!Array.isArray(node.tools) || node.tools.length > 16
    || new Set(node.tools).size !== node.tools.length
    || node.tools.some((tool) => !["read", "grep", "find", "ls", "bash", "edit", "write"].includes(tool))) {
    errors.push(issue(`${path}.tools`, "must be a unique bounded tool allowlist"));
  }
  const expectedMutation = MUTATING_ROLES.has(node.role) ? "shared-serialized" : "read-only";
  if (!["read-only", "shared-serialized", "isolated-proposal"].includes(node.mutation)) {
    errors.push(issue(`${path}.mutation`, "must be read-only, shared-serialized, or isolated-proposal"));
  } else if (node.mutation === "read-only" && node.tools.some((tool) => ["bash", "edit", "write"].includes(tool))) {
    errors.push(issue(`${path}.tools`, "read-only agents cannot receive mutation tools"));
  } else if (expectedMutation === "read-only" && node.mutation !== "read-only") {
    errors.push(issue(`${path}.mutation`, `role '${node.role}' is not a mutating workflow role`));
  }
  if (!safeInteger(node.timeout_ms, 1_000, MAX_CALL_MS)) errors.push(issue(`${path}.timeout_ms`, "must be 1000..3600000"));
  validateRetry(node.retry, `${path}.retry`, errors);
  if (!inline && node.max_visits != null && !safeInteger(node.max_visits, 1, 32)) {
    errors.push(issue(`${path}.max_visits`, "must be 1..32"));
  }
  if (!inline && node.artifact != null && (!exactKeys(node.artifact, ["path", "kind"])
    || !isSafeWorkflowPath(node.artifact.path) || !["plan", "brief", "notes"].includes(node.artifact.kind))) {
    errors.push(issue(`${path}.artifact`, "must be a contained plan, brief, or notes artifact"));
  }
}

function validateCondition(condition, path, errors) {
  if (!plain(condition) || typeof condition.op !== "string") {
    errors.push(issue(path, "must be a condition"));
    return;
  }
  if (condition.op === "always") {
    if (!exactKeys(condition, ["op"])) errors.push(issue(path, "always accepts no other fields"));
    return;
  }
  if (["eq", "neq", "lt", "lte", "gt", "gte", "contains"].includes(condition.op)) {
    if (!exactKeys(condition, ["op", "path", "value"]) || pointerSegments(condition.path) == null
      || !["string", "number", "boolean"].includes(typeof condition.value)) {
      errors.push(issue(path, "comparison requires a safe JSON pointer and scalar value"));
    }
    return;
  }
  if (["and", "or"].includes(condition.op)) {
    if (!exactKeys(condition, ["op", "conditions"]) || !Array.isArray(condition.conditions)
      || condition.conditions.length < 1 || condition.conditions.length > 8) {
      errors.push(issue(path, "boolean condition requires 1..8 child conditions"));
    } else condition.conditions.forEach((child, index) => validateCondition(child, `${path}.conditions[${index}]`, errors));
    return;
  }
  if (condition.op === "not") {
    if (!exactKeys(condition, ["op", "condition"])) errors.push(issue(path, "not requires one condition"));
    else validateCondition(condition.condition, `${path}.condition`, errors);
    return;
  }
  errors.push(issue(`${path}.op`, "is not a supported closed condition operator"));
}

function validateInlineAgent(agent, path, errors) {
  if (agent?.kind !== "agent") errors.push(issue(`${path}.kind`, "inline stage must be an agent"));
  else validateAgent(agent, path, errors, { inline: true });
}

function validateNode(node, id, path, errors) {
  if (!plain(node) || !WORKFLOW_NODE_KINDS.includes(node.kind)) {
    errors.push(issue(path, "must be a supported workflow node"));
    return;
  }
  if (node.kind === "agent") {
    validateAgent(node, path, errors);
    return;
  }
  if (node.kind === "pipeline") {
    if (!exactKeys(node, ["kind", "stages", "next", "max_visits"], ["label", "artifact"])
      || !Array.isArray(node.stages) || node.stages.length < 1 || node.stages.length > MAX_INLINE_STAGES) {
      errors.push(issue(path, "pipeline requires 1..16 inline agent stages, next, and max_visits"));
      return;
    }
    node.stages.forEach((stage, index) => validateInlineAgent(stage, `${path}.stages[${index}]`, errors));
    if (!safeInteger(node.max_visits, 1, 32)) errors.push(issue(`${path}.max_visits`, "must be 1..32"));
    if (node.artifact != null && (!exactKeys(node.artifact, ["path", "kind"])
      || !isSafeWorkflowPath(node.artifact.path) || !["plan", "brief", "notes"].includes(node.artifact.kind))) {
      errors.push(issue(`${path}.artifact`, "must be a contained plan, brief, or notes artifact"));
    }
    return;
  }
  if (node.kind === "parallel") {
    if (!exactKeys(node, ["kind", "branches", "max_concurrency", "failure", "next"], ["label", "allow_failure_codes"])
      || !Array.isArray(node.branches) || node.branches.length < 1 || node.branches.length > 64
      || !safeInteger(node.max_concurrency, 1, MAX_CONCURRENCY)
      || !["abort", "settle"].includes(node.failure)) {
      errors.push(issue(path, "parallel requires bounded agent branches, concurrency, failure, and next"));
      return;
    }
    if ((node.failure === "settle" && (!Array.isArray(node.allow_failure_codes)
      || node.allow_failure_codes.length < 1 || node.allow_failure_codes.length > 16
      || new Set(node.allow_failure_codes).size !== node.allow_failure_codes.length
      || node.allow_failure_codes.some((code) => !isPublicCode(code))))
      || (node.failure === "abort" && node.allow_failure_codes != null)) {
      errors.push(issue(`${path}.allow_failure_codes`, "settle requires 1..16 unique stable allowed-failure codes; abort accepts none"));
    }
    node.branches.forEach((branch, index) => validateInlineAgent(branch, `${path}.branches[${index}]`, errors));
    return;
  }
  if (node.kind === "map") {
    if (!exactKeys(node, ["kind", "items_path", "max_items", "body", "failure", "next"], ["label", "allow_failure_codes"])
      || pointerSegments(node.items_path) == null || !safeInteger(node.max_items, 0, MAX_MAP_ITEMS)
      || !["abort", "settle"].includes(node.failure)) {
      errors.push(issue(path, "map requires a safe items_path, bounded max_items, failure, body, and next"));
      return;
    }
    if ((node.failure === "settle" && (!Array.isArray(node.allow_failure_codes)
      || node.allow_failure_codes.length < 1 || node.allow_failure_codes.length > 16
      || new Set(node.allow_failure_codes).size !== node.allow_failure_codes.length
      || node.allow_failure_codes.some((code) => !isPublicCode(code))))
      || (node.failure === "abort" && node.allow_failure_codes != null)) {
      errors.push(issue(`${path}.allow_failure_codes`, "settle requires 1..16 unique stable allowed-failure codes; abort accepts none"));
    }
    validateInlineAgent(node.body, `${path}.body`, errors);
    return;
  }
  if (node.kind === "reduce") {
    if (!exactKeys(node, ["kind", "items_path", "strategy", "next"], ["separator", "label"])
      || pointerSegments(node.items_path) == null || !["collect", "count", "concat"].includes(node.strategy)
      || (node.strategy === "concat" && (typeof node.separator !== "string" || node.separator.length > 32))
      || (node.strategy !== "concat" && node.separator != null)) {
      errors.push(issue(path, "reduce requires a safe items_path and collect, count, or concat strategy"));
    }
    return;
  }
  if (node.kind === "decision") {
    if (!exactKeys(node, ["kind", "transitions", "default"], ["label", "loops_off"])
      || !Array.isArray(node.transitions) || node.transitions.length > MAX_TRANSITIONS) {
      errors.push(issue(path, "decision requires bounded transitions and default target"));
      return;
    }
    node.transitions.forEach((transition, index) => {
      if (!exactKeys(transition, ["when", "target"], ["loop"])) {
        errors.push(issue(`${path}.transitions[${index}]`, "must contain when, target, and optional loop"));
      } else {
        validateCondition(transition.when, `${path}.transitions[${index}].when`, errors);
        if (transition.loop != null && typeof transition.loop !== "boolean") errors.push(issue(`${path}.transitions[${index}].loop`, "must be boolean"));
      }
    });
    return;
  }
  if (node.kind === "gate") {
    if (!exactKeys(node, ["kind", "gate", "on_pass", "on_fail"], ["label", "final", "loops_off"])) {
      errors.push(issue(path, "gate requires gate, on_pass, and on_fail"));
      return;
    }
    validateGate(node.gate, `${path}.gate`, errors);
    if (node.final != null && typeof node.final !== "boolean") errors.push(issue(`${path}.final`, "must be boolean"));
    return;
  }
  if (node.kind === "checkpoint") {
    if (!exactKeys(node, ["kind", "reason", "next"], ["label"])
      || !isPublicCode(node.reason) || node.reason.length > 128) errors.push(issue(path, "checkpoint requires a stable reason and next"));
    return;
  }
  if (node.kind === "subworkflow") {
    if (!exactKeys(node, ["kind", "workflow_id", "version", "next"], ["label"])
      || !safeId(node.workflow_id) || !safeInteger(node.version, 1, 1_000_000)) {
      errors.push(issue(path, "subworkflow requires a safe id, pinned version, and next"));
    }
    return;
  }
  if (!exactKeys(node, ["kind", "status"], ["code", "label"])
    || !["succeeded", "failed", "refused", "cancelled"].includes(node.status)
    || (node.status !== "succeeded" && !isPublicCode(node.code))
    || (node.status === "succeeded" && node.code != null)) {
    errors.push(issue(path, "terminal must declare a valid status and failure code"));
  }
}

function nodeTargets(node) {
  if (["agent", "parallel", "map", "pipeline", "reduce", "checkpoint", "subworkflow"].includes(node.kind)) return [node.next];
  if (node.kind === "decision") return [...node.transitions.map((entry) => entry.target), node.default, ...(node.loops_off ? [node.loops_off] : [])];
  if (node.kind === "gate") return [node.on_pass, node.on_fail, ...(node.loops_off ? [node.loops_off] : [])];
  return [];
}

function reverseReachable(nodes, target) {
  const seen = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, node] of Object.entries(nodes)) {
      if (!seen.has(id) && nodeTargets(node).some((next) => seen.has(next))) {
        seen.add(id);
        changed = true;
      }
    }
  }
  return seen;
}

export function validateWorkflowDefinition(definition) {
  const errors = [];
  const required = [
    "schema_version", "id", "name", "description", "version", "source", "inputs", "start", "nodes",
    "limits", "provider_policy", "workspace_policy", "objective_gate",
  ];
  if (!exactKeys(definition, required)) {
    return { valid: false, errors: [issue("$", "must contain every WorkflowDefinition v4 field and no unknown fields")] };
  }
  if (definition.schema_version !== WORKFLOW_SCHEMA_VERSION) errors.push(issue("$.schema_version", "must equal 4"));
  if (!safeId(definition.id)) errors.push(issue("$.id", "must be a safe workflow id"));
  if (typeof definition.name !== "string" || definition.name.trim() === "" || definition.name.length > 128) errors.push(issue("$.name", "must be non-empty and at most 128 characters"));
  if (typeof definition.description !== "string" || definition.description.trim() === "" || definition.description.length > 1024) errors.push(issue("$.description", "must be non-empty and at most 1024 characters"));
  if (!safeInteger(definition.version, 1, 1_000_000)) errors.push(issue("$.version", "must be a positive safe version"));
  if (!["built-in", "user"].includes(definition.source)) errors.push(issue("$.source", "must be built-in or user"));
  validateJsonSchema(definition.inputs, "$.inputs", errors);
  if (!safeId(definition.start, NODE_ID)) errors.push(issue("$.start", "must be a safe node id"));
  if (!plain(definition.nodes) || Object.keys(definition.nodes).length < 1 || Object.keys(definition.nodes).length > MAX_NODES) {
    errors.push(issue("$.nodes", "must contain 1..256 nodes"));
  }
  const nodeIds = Object.keys(definition.nodes ?? {});
  for (const id of nodeIds) {
    if (!safeId(id, NODE_ID)) errors.push(issue(`$.nodes.${id}`, "node id is unsafe"));
    validateNode(definition.nodes[id], id, `$.nodes.${id}`, errors);
  }
  if (!Object.hasOwn(definition.nodes, definition.start)) errors.push(issue("$.start", "must reference an existing node"));
  for (const [id, node] of Object.entries(definition.nodes ?? {})) {
    for (const target of nodeTargets(node)) {
      if (!safeId(target, NODE_ID) || !Object.hasOwn(definition.nodes, target)) errors.push(issue(`$.nodes.${id}`, `references unknown target '${target}'`));
    }
  }
  const reachable = new Set();
  const queue = Object.hasOwn(definition.nodes ?? {}, definition.start) ? [definition.start] : [];
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const target of nodeTargets(definition.nodes[id])) if (!reachable.has(target)) queue.push(target);
  }
  for (const id of nodeIds) if (!reachable.has(id)) errors.push(issue(`$.nodes.${id}`, "is unreachable from start"));
  const successIds = nodeIds.filter((id) => definition.nodes[id]?.kind === "terminal" && definition.nodes[id].status === "succeeded");
  if (successIds.length !== 1) errors.push(issue("$.nodes", "must contain exactly one succeeded terminal"));
  else {
    const finalGates = nodeIds.filter((id) => definition.nodes[id]?.kind === "gate" && definition.nodes[id].final === true
      && definition.nodes[id].on_pass === successIds[0]);
    if (finalGates.length !== 1) errors.push(issue("$.nodes", "successful terminal must be reached by exactly one final objective gate"));
    const canReachSuccess = reverseReachable(definition.nodes, successIds[0]);
    for (const id of nodeIds) {
      const node = definition.nodes[id];
      if (node.kind !== "terminal" && !canReachSuccess.has(id) && reachable.has(id)) {
        errors.push(issue(`$.nodes.${id}`, "cannot reach the successful objective-gated terminal"));
      }
    }
  }
  if (!exactKeys(definition.limits, [
    "max_total_effects", "max_concurrency", "max_map_items", "max_run_ms", "max_call_ms", "structured_repair_attempts",
  ]) || !safeInteger(definition.limits.max_total_effects, 1, MAX_TOTAL_EFFECTS)
    || !safeInteger(definition.limits.max_concurrency, 1, MAX_CONCURRENCY)
    || !safeInteger(definition.limits.max_map_items, 0, MAX_MAP_ITEMS)
    || !safeInteger(definition.limits.max_run_ms, 1_000, MAX_RUN_MS)
    || !safeInteger(definition.limits.max_call_ms, 1_000, MAX_CALL_MS)
    || !safeInteger(definition.limits.structured_repair_attempts, 0, 2)) {
    errors.push(issue("$.limits", "contains invalid hard workflow limits"));
  }
  if (!exactKeys(definition.provider_policy, ["exact", "assignments", "default_assignment", "require_live_certification"])
    || definition.provider_policy.exact !== true || !plain(definition.provider_policy.assignments)
    || !plain(definition.provider_policy.default_assignment)
    || typeof definition.provider_policy.require_live_certification !== "boolean") {
    errors.push(issue("$.provider_policy", "must require exact binding and closed assignments"));
  }
  if (!exactKeys(definition.workspace_policy, ["mode", "proposal_cleanup", "transcripts"])
    || !["canonical-worktree", "current-worktree"].includes(definition.workspace_policy.mode)
    || !["unchanged", "explicit"].includes(definition.workspace_policy.proposal_cleanup)
    || !["off", "private"].includes(definition.workspace_policy.transcripts)) {
    errors.push(issue("$.workspace_policy", "must declare canonical/current workspace, cleanup, and transcript policy"));
  }
  validateGate(definition.objective_gate, "$.objective_gate", errors);
  try {
    if (Buffer.byteLength(stable(definition), "utf8") > MAX_WORKFLOW_BYTES) errors.push(issue("$", "serialized definition exceeds 256 KiB"));
  } catch {
    errors.push(issue("$", "must be serializable"));
  }
  return { valid: errors.length === 0, errors };
}

function toolsForRole(role) {
  return MUTATING_ROLES.has(role)
    ? ["read", "grep", "find", "ls", "bash", "edit", "write"]
    : ["read", "grep", "find", "ls"];
}

function inlineAgent(step, stage, timeoutMs) {
  return {
    kind: "agent",
    role: step.role,
    stage_id: stage.id,
    prompt: "tracked-step-v1",
    output_schema: { id: step.role === "reviewer" ? "verdict-v1" : "semantic-v2" },
    tools: toolsForRole(step.role),
    mutation: MUTATING_ROLES.has(step.role) ? "shared-serialized" : "read-only",
    timeout_ms: timeoutMs,
    retry: { max_attempts: 1, backoff_ms: 0 },
  };
}

function decisionCondition(pipelineId, role, verdict) {
  return { op: "eq", path: `/outputs/${pipelineId}/by_role/${role}/recommendation`, value: verdict };
}

function actionTarget(action, { stageId, previousStage, nextStage, finalGate, stopTerminal }) {
  if (action.action === "advance") return nextStage ?? finalGate;
  if (action.action === "retry") return stageId;
  if (action.action === "back") return action.target ?? previousStage ?? stageId;
  return stopTerminal;
}

/** Losslessly normalize the current saved workflow shape into v4. */
export function migrateWorkflowV1(workflow) {
  if (!plain(workflow) || workflow.schema_version !== 1 || !Array.isArray(workflow.stages)) {
    return { ok: false, code: "workflow-migration-input-invalid" };
  }
  const nodes = {};
  const stopTerminal = "stopped";
  const hasStop = workflow.stages.some((stage) => stage.transitions.some((entry) => entry.action === "stop"));
  const successTerminal = "succeeded";
  const failedTerminal = "failed";
  const finalGate = "objective-gate";
  for (let index = 0; index < workflow.stages.length; index += 1) {
    const stage = workflow.stages[index];
    const pipelineId = stage.id;
    const decisionId = `${stage.id}-decision`;
    const nextStage = workflow.stages[index + 1]?.id ?? null;
    const previousStage = workflow.stages[index - 1]?.id ?? null;
    const roleSteps = stage.steps.filter((step) => step.kind === "role");
    nodes[pipelineId] = {
      kind: "pipeline",
      label: stage.label ?? stage.id,
      stages: roleSteps.map((step) => inlineAgent(step, stage, workflow.deployment.call_timeout_ms)),
      next: decisionId,
      max_visits: stage.max_passes,
      ...(stage.artifact ? { artifact: structuredClone(stage.artifact) } : {}),
    };
    const verdictTransition = stage.transitions.find((entry) => entry.when.type === "verdict");
    const gateTransition = stage.transitions.find((entry) => entry.when.type === "gate");
    if (verdictTransition) {
      const role = verdictTransition.when.role;
      nodes[decisionId] = {
        kind: "decision",
        transitions: stage.transitions
          .filter((entry) => entry.when.type === "verdict")
          .map((entry) => ({
            when: decisionCondition(pipelineId, role, entry.when.is),
            target: actionTarget(entry, { stageId: pipelineId, previousStage, nextStage, finalGate, stopTerminal }),
            loop: ["retry", "back"].includes(entry.action),
          })),
        default: failedTerminal,
        loops_off: nextStage ?? finalGate,
      };
    } else if (gateTransition) {
      const pass = stage.transitions.find((entry) => entry.when.type === "gate" && entry.when.is === "pass");
      const fail = stage.transitions.find((entry) => entry.when.type === "gate" && entry.when.is === "fail");
      nodes[decisionId] = {
        kind: "gate",
        gate: structuredClone(workflow.stop.objective_gate),
        on_pass: actionTarget(pass, { stageId: pipelineId, previousStage, nextStage, finalGate, stopTerminal }),
        on_fail: actionTarget(fail, { stageId: pipelineId, previousStage, nextStage, finalGate, stopTerminal }),
        loops_off: nextStage ?? finalGate,
      };
    } else {
      const always = stage.transitions.find((entry) => entry.when.type === "always");
      nodes[decisionId] = {
        kind: "decision",
        transitions: [{ when: { op: "always" }, target: actionTarget(always, { stageId: pipelineId, previousStage, nextStage, finalGate, stopTerminal }) }],
        default: failedTerminal,
      };
    }
  }
  const lastStage = workflow.stages.at(-1)?.id ?? failedTerminal;
  nodes[finalGate] = {
    kind: "gate",
    gate: structuredClone(workflow.stop.objective_gate),
    on_pass: successTerminal,
    on_fail: lastStage,
    final: true,
    loops_off: failedTerminal,
  };
  nodes[successTerminal] = { kind: "terminal", status: "succeeded" };
  nodes[failedTerminal] = { kind: "terminal", status: "failed", code: "workflow-condition-unmatched" };
  if (hasStop) nodes[stopTerminal] = { kind: "terminal", status: "refused", code: "workflow-stopped" };
  const definition = {
    schema_version: WORKFLOW_SCHEMA_VERSION,
    id: workflow.id,
    name: workflow.description.split(/[.!?]/, 1)[0].slice(0, 128) || workflow.id,
    description: workflow.description,
    version: 1,
    source: workflow.source,
    inputs: {
      type: "object",
      additionalProperties: false,
      required: ["task"],
      properties: { task: { type: "string", minLength: 1, maxLength: 65_536 } },
    },
    start: workflow.stages[0]?.id ?? failedTerminal,
    nodes,
    limits: {
      max_total_effects: Math.min(MAX_TOTAL_EFFECTS, Math.max(
        WORKFLOW_DEFAULTS.max_total_effects,
        workflow.stop.max_iterations * Math.max(1, ...workflow.stages.map((stage) => stage.steps.filter((step) => step.kind === "role").length)),
      )),
      max_concurrency: Math.min(MAX_CONCURRENCY, workflow.deployment.parallel.max_concurrency),
      max_map_items: WORKFLOW_DEFAULTS.max_map_items,
      max_run_ms: workflow.stop.max_runtime_ms,
      max_call_ms: workflow.deployment.call_timeout_ms,
      structured_repair_attempts: WORKFLOW_DEFAULTS.structured_repair_attempts,
    },
    provider_policy: {
      exact: true,
      assignments: structuredClone(workflow.deployment.assignments),
      default_assignment: structuredClone(workflow.deployment.default_assignment),
      require_live_certification: false,
    },
    workspace_policy: {
      mode: "canonical-worktree",
      proposal_cleanup: "unchanged",
      transcripts: "off",
    },
    objective_gate: structuredClone(workflow.stop.objective_gate),
  };
  const valid = validateWorkflowDefinition(definition);
  return valid.valid ? { ok: true, definition } : { ok: false, code: "workflow-migration-invalid", errors: valid.errors };
}

export function normalizeWorkflowDefinition(workflow) {
  if (workflow?.schema_version === WORKFLOW_SCHEMA_VERSION) {
    const valid = validateWorkflowDefinition(workflow);
    return valid.valid
      ? { ok: true, definition: structuredClone(workflow), migrated: false }
      : { ok: false, code: "invalid-workflow-v4", errors: valid.errors };
  }
  const migrated = migrateWorkflowV1(workflow);
  return migrated.ok ? { ...migrated, migrated: true } : migrated;
}

export function workflowDefinitionHash(definition) {
  const valid = validateWorkflowDefinition(definition);
  if (!valid.valid) return null;
  return `sha256:${createHash("sha256").update(stable(definition)).digest("hex")}`;
}

export function resolveJsonPointer(value, pointer) {
  const segments = pointerSegments(pointer);
  if (segments == null) return { found: false, value: undefined };
  let current = value;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

export function evaluateCondition(condition, context) {
  if (condition.op === "always") return true;
  if (condition.op === "and") return condition.conditions.every((entry) => evaluateCondition(entry, context));
  if (condition.op === "or") return condition.conditions.some((entry) => evaluateCondition(entry, context));
  if (condition.op === "not") return !evaluateCondition(condition.condition, context);
  const resolved = resolveJsonPointer(context, condition.path);
  if (!resolved.found) return false;
  if (condition.op === "eq") return resolved.value === condition.value;
  if (condition.op === "neq") return resolved.value !== condition.value;
  if (condition.op === "lt") return resolved.value < condition.value;
  if (condition.op === "lte") return resolved.value <= condition.value;
  if (condition.op === "gt") return resolved.value > condition.value;
  if (condition.op === "gte") return resolved.value >= condition.value;
  if (condition.op === "contains") return Array.isArray(resolved.value)
    ? resolved.value.includes(condition.value)
    : typeof resolved.value === "string" && resolved.value.includes(String(condition.value));
  return false;
}

export function stableWorkflowStringify(value) {
  return stable(value);
}
