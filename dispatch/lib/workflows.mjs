// Helix workflows — canonical user-facing workflow building blocks.
//
// A workflow owns its ordered stages, explicit transition conditions, bounded
// stopping criteria, and deployment defaults. WorkflowDefinition v4 and HWK are
// the product runtime; `workflowToExecution` projects deployment/cast inputs
// only. Legacy tracked chains are accepted as import material and normalized
// before named execution.

import { validateRunConfig } from "./run-configs.mjs";
import { MAX_ITERATIONS } from "./limits.mjs";
import { isPublicCode } from "./public-values.mjs";
import { ROLES, STAGE_ROLES } from "./role-envelope.mjs";
import { hashRef, stableStringify } from "./run-record.mjs";
import { stageStepSchedule } from "./stage-schedule.mjs";
import { isSafeWorktreeFilePath } from "./persistence.mjs";
import {
  WORKFLOW_SCHEMA_VERSION,
  validateWorkflowDefinition,
  workflowDefinitionHash,
} from "../workflow/schema.mjs";
import { plannedWorkflowGraph } from "../workflow/visualize.mjs";

const ID = /^[a-z0-9][a-z0-9._-]*$/;
const STAGE_ID = /^[a-z][a-z0-9-]*$/;
const STEP_ID = /^[a-z][a-z0-9-]*$/;
const VERDICTS = Object.freeze(["approve", "revise", "revise-jump"]);
const ACTIONS = Object.freeze(["advance", "retry", "back", "stop"]);
const DEPLOYMENT_FIELDS = Object.freeze([
  "chain_id", "call_timeout_ms", "role_matrix", "assignments", "default_assignment", "parallel", "run_target",
  "input_refs", "claims_ref", "evidence_ref",
]);
const TASK_CLASSES = Object.freeze([
  "trivial", "routine-code", "architecture", "security",
  "roadmap-reconciliation", "pr-preflight", "risky-change", "ui-quality",
]);
const MAX_RUNTIME_MS = 60 * 60 * 1000;
const MAX_WORKFLOW_BYTES = 64 * 1024;
const MAX_WORKFLOW_ID_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 512;
const MAX_STAGE_ID_LENGTH = 64;
const MAX_STEP_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 128;
const MAX_NOTE_LENGTH = 512;
const MAX_STOP_REASON_LENGTH = 128;
const MAX_STAGES = 16;
const MAX_STEPS_PER_STAGE = 16;
const MAX_TRANSITIONS_PER_STAGE = 8;

export const WORKFLOW_ROLE_BLOCKS = Object.freeze([
  "scout", "planner", "builder", "reviewer", "redteam", "verifier",
]);
export const WORKFLOW_MUTATING_ROLES = Object.freeze(["planner", "builder"]);

export const WORKFLOW_TEMPLATES = Object.freeze([
  Object.freeze({ id: "implement-review", label: "Implement and review", description: "Build, review, and retry until approved." }),
  Object.freeze({ id: "plan-implement", label: "Plan, implement, review", description: "Review the plan, implement it, and send flawed work back to planning." }),
  Object.freeze({ id: "tdd-fix", label: "Reproduce, fix, review", description: "Prove the bug first, then iterate until the objective gate passes." }),
]);

function issue(path, message) {
  return { path, message };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keysAre(value, allowed) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function hasExactlyKeys(value, expected) {
  return keysAre(value, expected) && expected.every((key) => Object.hasOwn(value, key));
}

function runConfigFromWorkflow(workflow) {
  return {
    id: workflow.id,
    description: workflow.description,
    chain: workflow.deployment?.chain_id,
    role_matrix: workflow.deployment?.role_matrix,
    assignments: workflow.deployment?.assignments,
    default_assignment: workflow.deployment?.default_assignment,
    max_iterations: workflow.stop?.max_iterations,
    objective_gate: workflow.stop?.objective_gate,
    parallel: workflow.deployment?.parallel,
    run_target: workflow.deployment?.run_target,
    input_refs: workflow.deployment?.input_refs,
    claims_ref: workflow.deployment?.claims_ref,
    evidence_ref: workflow.deployment?.evidence_ref,
  };
}

export function objectiveGateSummary(gate) {
  if (gate?.type === "command-exit-zero") {
    return `command-exit-zero argv=${JSON.stringify([gate.command, ...(gate.args ?? [])])}`;
  }
  if (gate?.type === "file-contains") {
    return `file-contains:${gate.path} contains ${JSON.stringify(gate.contains)}`;
  }
  return "invalid-objective-gate";
}

export function isSafeWorkflowPath(path) {
  return isSafeWorktreeFilePath(path);
}

function verdictTransitions(role, backTarget = null) {
  return [
    { when: { type: "verdict", role, is: "approve" }, action: "advance" },
    { when: { type: "verdict", role, is: "revise" }, action: "retry" },
    backTarget
      ? { when: { type: "verdict", role, is: "revise-jump" }, action: "back", target: backTarget }
      : { when: { type: "verdict", role, is: "revise-jump" }, action: "retry" },
  ];
}

/** Normalize a v2 chain stage into the explicit transition-block shape. */
export function normalizeWorkflowStage(stage) {
  if (Array.isArray(stage?.transitions)) {
    return structuredClone(stage);
  }
  let transitions;
  let maxPasses = 1;
  if (stage?.advance) {
    transitions = verdictTransitions(stage.advance.verdict_role, stage.advance.allow_jump_to ?? null);
    maxPasses = stage.advance.max_passes;
  } else if (stage?.gate_expectation) {
    const opposite = stage.gate_expectation === "pass" ? "fail" : "pass";
    transitions = [
      { when: { type: "gate", is: stage.gate_expectation }, action: "advance" },
      { when: { type: "gate", is: opposite }, action: "retry" },
    ];
    maxPasses = MAX_ITERATIONS;
  } else {
    transitions = [{ when: { type: "always" }, action: "advance" }];
  }
  return {
    id: stage?.id,
    ...(stage?.label ? { label: stage.label } : {}),
    steps: structuredClone(stage?.steps ?? []),
    max_passes: maxPasses,
    transitions,
    ...(stage?.artifact ? { artifact: structuredClone(stage.artifact) } : {}),
  };
}

/** Turn a tracked chain + run config into the same document saved for users. */
export function workflowFromExecution(chain, config, { source = "built-in" } = {}) {
  const objectiveGate = structuredClone(config?.objective_gate);
  const stages = (chain?.stages ?? []).map(normalizeWorkflowStage);
  return {
    schema_version: 1,
    id: config?.id ?? chain?.id,
    description: config?.description ?? chain?.description,
    task_class: chain?.task_class,
    source,
    stages,
    stop: {
      max_iterations: config?.max_iterations ?? chain?.default_max_iterations,
      max_runtime_ms: 10 * 60 * 1000,
      objective_gate: objectiveGate,
    },
    deployment: {
      chain_id: config?.chain ?? chain?.id ?? config?.id,
      call_timeout_ms: 2 * 60 * 1000,
      role_matrix: config?.role_matrix ?? "mock-core-loop",
      assignments: structuredClone(config?.assignments ?? {}),
      default_assignment: structuredClone(config?.default_assignment ?? {
        kind: "composite", preset: "daily",
      }),
      parallel: structuredClone(config?.parallel ?? { max_concurrency: 2 }),
      run_target: structuredClone(config?.run_target ?? { repo: "self" }),
      input_refs: structuredClone(config?.input_refs ?? []),
      claims_ref: config?.claims_ref ?? `local-ref:claims/${config?.id ?? chain?.id}`,
      evidence_ref: config?.evidence_ref ?? `local-ref:evidence/${config?.id ?? chain?.id}`,
    },
  };
}

function validateCondition(condition, path, roleSteps, errors) {
  if (!isPlainObject(condition) || typeof condition.type !== "string") {
    errors.push(issue(path, "must be a condition block"));
    return;
  }
  if (condition.type === "always") {
    if (!keysAre(condition, ["type"])) errors.push(issue(path, "always accepts only type"));
    return;
  }
  if (condition.type === "gate") {
    if (!keysAre(condition, ["type", "is"]) || !["pass", "fail"].includes(condition.is)) {
      errors.push(issue(path, "gate condition requires is=pass|fail"));
    }
    return;
  }
  if (condition.type === "verdict") {
    if (!keysAre(condition, ["type", "role", "is"]) || !ROLES.includes(condition.role)
      || !VERDICTS.includes(condition.is)) {
      errors.push(issue(path, "verdict condition requires a known role and verdict"));
    } else if (!roleSteps.includes(condition.role) || !STAGE_ROLES.candidate.includes(condition.role)) {
      errors.push(issue(`${path}.role`, `role '${condition.role}' must be a candidate role step in this stage`));
    }
    return;
  }
  errors.push(issue(`${path}.type`, "must be always, gate, or verdict"));
}

export function validateWorkflow(workflow) {
  if (workflow?.schema_version === WORKFLOW_SCHEMA_VERSION) return validateWorkflowDefinition(workflow);
  const errors = [];
  if (!keysAre(workflow, ["schema_version", "id", "description", "task_class", "source", "stages", "stop", "deployment"])) {
    errors.push(issue("$", "must be a workflow object with no unknown fields"));
    return { valid: false, errors };
  }
  if (workflow.schema_version !== 1) errors.push(issue("$.schema_version", "must equal 1"));
  if (!ID.test(String(workflow.id ?? "")) || String(workflow.id ?? "").length > MAX_WORKFLOW_ID_LENGTH) {
    errors.push(issue("$.id", `must be a safe workflow id of at most ${MAX_WORKFLOW_ID_LENGTH} characters`));
  }
  if (typeof workflow.description !== "string" || workflow.description.trim() === ""
    || workflow.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(issue("$.description", `must be non-empty and at most ${MAX_DESCRIPTION_LENGTH} characters`));
  }
  if (!TASK_CLASSES.includes(workflow.task_class)) errors.push(issue("$.task_class", "must be a known task class"));
  if (!["built-in", "user"].includes(workflow.source)) errors.push(issue("$.source", "must be built-in or user"));
  if (!Array.isArray(workflow.stages) || workflow.stages.length === 0) {
    errors.push(issue("$.stages", "must contain at least one stage"));
  } else if (workflow.stages.length > MAX_STAGES) {
    errors.push(issue("$.stages", `must contain at most ${MAX_STAGES} stages`));
  }

  const priorStageIds = [];
  for (let index = 0; index < (workflow.stages ?? []).length; index += 1) {
    const stage = workflow.stages[index];
    const path = `$.stages[${index}]`;
    if (!keysAre(stage, ["id", "label", "steps", "max_passes", "transitions", "artifact"])) {
      errors.push(issue(path, "must contain only stage fields"));
      continue;
    }
    if (!STAGE_ID.test(String(stage.id ?? "")) || String(stage.id ?? "").length > MAX_STAGE_ID_LENGTH) {
      errors.push(issue(`${path}.id`, `must be a stage id of at most ${MAX_STAGE_ID_LENGTH} characters`));
    }
    if (priorStageIds.includes(stage.id)) errors.push(issue(`${path}.id`, `duplicate stage '${stage.id}'`));
    if (stage.label != null && (typeof stage.label !== "string" || stage.label.trim() === ""
      || stage.label.length > MAX_LABEL_LENGTH)) {
      errors.push(issue(`${path}.label`, `must be non-empty and at most ${MAX_LABEL_LENGTH} characters`));
    }
    if (!Number.isSafeInteger(stage.max_passes) || stage.max_passes < 1 || stage.max_passes > MAX_ITERATIONS) {
      errors.push(issue(`${path}.max_passes`, `must be between 1 and ${MAX_ITERATIONS}`));
    }
    const stepIds = new Set();
    const roleSteps = [];
    if (!Array.isArray(stage.steps) || stage.steps.length === 0) errors.push(issue(`${path}.steps`, "must not be empty"));
    else if (stage.steps.length > MAX_STEPS_PER_STAGE) errors.push(issue(`${path}.steps`, `must contain at most ${MAX_STEPS_PER_STAGE} steps`));
    for (let stepIndex = 0; stepIndex < (stage.steps ?? []).length; stepIndex += 1) {
      const step = stage.steps[stepIndex];
      const stepPath = `${path}.steps[${stepIndex}]`;
      if (!keysAre(step, ["id", "kind", "role", "note"]) || !STEP_ID.test(String(step.id ?? ""))
        || String(step.id ?? "").length > MAX_STEP_ID_LENGTH
        || !["role", "local-check", "handoff"].includes(step.kind)) {
        errors.push(issue(stepPath, "must be a valid workflow step"));
        continue;
      }
      if (stepIds.has(step.id)) errors.push(issue(`${stepPath}.id`, `duplicate step '${step.id}'`));
      stepIds.add(step.id);
      if (step.kind === "role" && !ROLES.includes(step.role)) errors.push(issue(`${stepPath}.role`, "role step needs a known role"));
      if (step.kind === "role" && ROLES.includes(step.role) && !WORKFLOW_ROLE_BLOCKS.includes(step.role)) {
        errors.push(issue(`${stepPath}.role`, `role '${step.role}' is not an executable workflow block`));
      }
      if (step.kind !== "role" && step.role != null) errors.push(issue(`${stepPath}.role`, "non-role step must not declare a role"));
      if (step.kind !== "role" && (typeof step.note !== "string" || step.note.trim() === ""
        || step.note.length > MAX_NOTE_LENGTH)) {
        errors.push(issue(`${stepPath}.note`, `non-role step needs a note of at most ${MAX_NOTE_LENGTH} characters`));
      }
      if (step.kind === "role" && step.note != null) errors.push(issue(`${stepPath}.note`, "role step must not declare a note"));
      if (step.kind === "role" && ROLES.includes(step.role)) {
        if (roleSteps.includes(step.role)) errors.push(issue(`${stepPath}.role`, `duplicate stage role '${step.role}'`));
        roleSteps.push(step.role);
      }
      if (workflow.source === "user" && step.kind !== "role") {
        errors.push(issue(`${stepPath}.kind`, "user workflows allow role blocks only; host effects are not deployable"));
      }
    }
    if (Array.isArray(stage.steps) && stage.steps.length > 0 && stageStepSchedule(stage) == null) {
      errors.push(issue(`${path}.steps`, "must use executable candidate/check/verifier/handoff ordering"));
    }
    if (!Array.isArray(stage.transitions) || stage.transitions.length === 0) {
      errors.push(issue(`${path}.transitions`, "must not be empty"));
    } else if (stage.transitions.length > MAX_TRANSITIONS_PER_STAGE) {
      errors.push(issue(`${path}.transitions`, `must contain at most ${MAX_TRANSITIONS_PER_STAGE} transitions`));
    }
    const seenConditions = new Set();
    let alwaysSeen = false;
    let verdictRole = null;
    for (let transitionIndex = 0; transitionIndex < (stage.transitions ?? []).length; transitionIndex += 1) {
      const transition = stage.transitions[transitionIndex];
      const transitionPath = `${path}.transitions[${transitionIndex}]`;
      if (!keysAre(transition, ["when", "action", "target", "reason"]) || !ACTIONS.includes(transition?.action)) {
        errors.push(issue(transitionPath, "must be an advance, retry, back, or stop transition"));
        continue;
      }
      validateCondition(transition.when, `${transitionPath}.when`, roleSteps, errors);
      if (transition.when?.type === "verdict" && ROLES.includes(transition.when.role)) {
        if (verdictRole == null) verdictRole = transition.when.role;
        else if (transition.when.role !== verdictRole) {
          errors.push(issue(`${transitionPath}.when.role`, `all verdict transitions must use role '${verdictRole}'`));
        }
      }
      const conditionKey = JSON.stringify(transition.when);
      if (seenConditions.has(conditionKey)) errors.push(issue(`${transitionPath}.when`, "duplicates an earlier condition"));
      seenConditions.add(conditionKey);
      if (alwaysSeen) errors.push(issue(transitionPath, "is unreachable after an always condition"));
      if (transition.when?.type === "always") alwaysSeen = true;
      if (transition.action === "back") {
        if (!priorStageIds.includes(transition.target)) {
          errors.push(issue(`${transitionPath}.target`, "back target must be a named earlier stage"));
        }
      } else if (transition.target != null) {
        errors.push(issue(`${transitionPath}.target`, "is allowed only for back transitions"));
      }
      if (transition.action === "stop" && (!isPublicCode(transition.reason)
        || transition.reason.length > MAX_STOP_REASON_LENGTH)) {
        errors.push(issue(`${transitionPath}.reason`, `stop transition needs a stable public code of at most ${MAX_STOP_REASON_LENGTH} characters`));
      }
      if (transition.action !== "stop" && transition.reason != null) {
        errors.push(issue(`${transitionPath}.reason`, "is allowed only for stop transitions"));
      }
    }
    const verdicts = new Set(stage.transitions?.filter((entry) => entry.when?.type === "verdict").map((entry) => entry.when.is));
    const gates = new Set(stage.transitions?.filter((entry) => entry.when?.type === "gate").map((entry) => entry.when.is));
    if (verdicts.size > 0 && gates.size > 0) {
      errors.push(issue(`${path}.transitions`, "must use verdict or gate conditions in one stage, not both"));
    }
    if (!alwaysSeen) {
      if (verdicts.size > 0 && VERDICTS.some((value) => !verdicts.has(value))) {
        errors.push(issue(`${path}.transitions`, "verdict routing must cover approve, revise, and revise-jump or end with always"));
      }
      if (gates.size > 0 && ["pass", "fail"].some((value) => !gates.has(value))) {
        errors.push(issue(`${path}.transitions`, "gate routing must cover pass and fail or end with always"));
      }
    }
    if (stage.artifact == null && workflow.source === "user") {
      errors.push(issue(`${path}.artifact`, "is required for user workflows"));
    } else if (stage.artifact != null && (!keysAre(stage.artifact, ["path", "kind"])
      || !isSafeWorkflowPath(stage.artifact?.path) || stage.artifact.path.length > 256
      || !["plan", "brief", "notes"].includes(stage.artifact?.kind))) {
      errors.push(issue(`${path}.artifact`, "must be a contained plan, brief, or notes output with a path of at most 256 characters"));
    }
    priorStageIds.push(stage.id);
  }

  if (!hasExactlyKeys(workflow.stop, ["max_iterations", "max_runtime_ms", "objective_gate"])) {
    errors.push(issue("$.stop", "must contain max_iterations, max_runtime_ms, and objective_gate"));
  } else {
    if (!Number.isSafeInteger(workflow.stop.max_iterations) || workflow.stop.max_iterations < 1
      || workflow.stop.max_iterations > MAX_ITERATIONS) {
      errors.push(issue("$.stop.max_iterations", `must be between 1 and ${MAX_ITERATIONS}`));
    }
    if (!Number.isSafeInteger(workflow.stop.max_runtime_ms) || workflow.stop.max_runtime_ms < 1_000
      || workflow.stop.max_runtime_ms > MAX_RUNTIME_MS) {
      errors.push(issue("$.stop.max_runtime_ms", `must be between 1000 and ${MAX_RUNTIME_MS}`));
    }
    const gate = workflow.stop.objective_gate;
    if (gate?.type === "file-contains") {
      if (!keysAre(gate, ["type", "path", "contains"]) || !isSafeWorkflowPath(gate.path)
        || gate.path.length > 256 || typeof gate.contains !== "string"
        || gate.contains.length === 0 || gate.contains.length > 256) {
        errors.push(issue("$.stop.objective_gate", "must be a valid bounded file-contains gate"));
      } else if (workflow.source === "user"
        && !(workflow.stages ?? []).some((stage) => stage.artifact?.path === gate.path)) {
        errors.push(issue("$.stop.objective_gate.path", "must match at least one declared stage output"));
      }
    } else if (gate?.type === "command-exit-zero") {
      const args = gate.args;
      const commandSafe = typeof gate.command === "string"
        && gate.command.length <= 128
        && (/^[A-Za-z0-9][A-Za-z0-9._@+-]*$/.test(gate.command)
          || (/^\.\/[A-Za-z0-9._@+/-]+$/.test(gate.command) && isSafeWorkflowPath(gate.command.slice(2))));
      if (!keysAre(gate, ["type", "command", "args", "timeout_ms"]) || !commandSafe
        || !Array.isArray(args) || args.length > 32
        || args.some((arg) => typeof arg !== "string" || arg.length > 256 || arg.includes("\0"))
        || !Number.isSafeInteger(gate.timeout_ms) || gate.timeout_ms < 1_000 || gate.timeout_ms > 10 * 60 * 1_000) {
        errors.push(issue("$.stop.objective_gate", "must be a bounded argv-style command-exit-zero gate"));
      } else if (gate.timeout_ms > workflow.stop.max_runtime_ms) {
        errors.push(issue("$.stop.objective_gate.timeout_ms", "must not exceed max_runtime_ms"));
      }
    } else {
      errors.push(issue("$.stop.objective_gate", "must be file-contains or command-exit-zero"));
    }
  }
  if (!hasExactlyKeys(workflow.deployment, DEPLOYMENT_FIELDS)) {
    errors.push(issue("$.deployment", "must contain every deployment field and no unknown fields"));
  }
  if (isPlainObject(workflow.deployment)) {
    if (workflow.deployment.role_matrix !== "mock-core-loop") {
      errors.push(issue("$.deployment.role_matrix", "must equal the supported compatibility matrix mock-core-loop"));
    }
    const deployValidation = validateRunConfig(runConfigFromWorkflow(workflow));
    for (const error of deployValidation.errors) {
      const match = /^\$\.configs\[0\]\.([a-z_]+)/.exec(error.path);
      if (match && DEPLOYMENT_FIELDS.includes(match[1])) {
        errors.push(issue(error.path.replace(/^\$\.configs\[0\]/, "$.deployment"), error.message));
      }
    }
    if (!Number.isSafeInteger(workflow.deployment.call_timeout_ms)
      || workflow.deployment.call_timeout_ms < 1_000
      || workflow.deployment.call_timeout_ms > workflow.stop?.max_runtime_ms) {
      errors.push(issue("$.deployment.call_timeout_ms", "must be at least 1000 and no greater than max_runtime_ms"));
    }
    if (workflow.deployment.run_target?.repo !== "self" || workflow.deployment.run_target?.ref != null) {
      errors.push(issue("$.deployment.run_target", "named workflows currently run only in the confirmed current repository"));
    }
  }
  if (workflow.stop?.objective_gate?.type === "command-exit-zero"
    && workflow.source === "built-in" && (workflow.stages ?? []).some((stage) => stage.artifact == null)) {
    errors.push(issue("$.stages", "built-in command-gated stages require explicit artifacts for durable handoff"));
  }
  try {
    if (Buffer.byteLength(stableStringify(workflow), "utf8") > MAX_WORKFLOW_BYTES) {
      errors.push(issue("$", `serialized workflow must not exceed ${MAX_WORKFLOW_BYTES} bytes`));
    }
  } catch {
    errors.push(issue("$", "must be serializable"));
  }
  return { valid: errors.length === 0, errors };
}

/** Bind every mutable source that can change the confirmed workflow execution. */
export function workflowExecutionBindingRef({ workflow, profile = null, toggles, presets, subworkflows = [] } = {}) {
  if (!isPlainObject(workflow) || !isPlainObject(toggles) || !(presets instanceof Map)
    || !Array.isArray(subworkflows) || subworkflows.some((entry) => !isPlainObject(entry))) return null;
  const presetEntries = [...presets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, preset]) => [id, preset]);
  const childEntries = [...subworkflows].sort((left, right) =>
    `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`));
  return hashRef(stableStringify({ workflow, profile, toggles, presets: presetEntries, subworkflows: childEntries }));
}

function conditionMatches(condition, signal) {
  if (condition.type === "always") return true;
  if (condition.type === "gate") return signal?.gate_result === condition.is;
  if (condition.type === "verdict") return signal?.verdict === condition.is
    && (signal?.role == null || signal.role === condition.role);
  return false;
}

export function decideWorkflowTransition(stage, pass, signal, { loops = true } = {}) {
  const transition = stage.transitions.find((candidate) => conditionMatches(candidate.when, signal));
  if (!transition) return { action: "refuse", code: `workflow-no-transition:${stage.id}` };
  if (!loops && ["retry", "back"].includes(transition.action)) {
    return { action: "advance", code: null, warning: `loops-off-transition-ignored:${stage.id}:${transition.action}` };
  }
  if (transition.action === "retry" && pass >= stage.max_passes) {
    return { action: "refuse", code: `workflow-stage-max-passes:${stage.id}` };
  }
  return {
    action: transition.action,
    code: transition.action === "stop" ? transition.reason : null,
    ...(transition.target ? { target: transition.target } : {}),
  };
}

export function workflowVerdictRole(stage) {
  return stage?.transitions?.find((transition) => transition.when?.type === "verdict")?.when?.role ?? null;
}

export function workflowStageUsesGate(stage) {
  return stage?.transitions?.some((transition) => transition.when?.type === "gate") === true;
}

export function workflowLifecycleSnapshot(workflow) {
  if (workflow?.schema_version === WORKFLOW_SCHEMA_VERSION) {
    const graph = plannedWorkflowGraph(workflow);
    if (!graph.ok) return null;
    return {
      schema_version: 2,
      workflow_id: workflow.id,
      workflow_version: workflow.version,
      definition_ref: workflowDefinitionHash(workflow),
      start: workflow.start,
      nodes: graph.nodes.map((node) => ({ id: node.id, kind: node.kind, targets: node.targets })),
      limits: structuredClone(workflow.limits),
    };
  }
  const execution = workflowToExecution(workflow);
  if (!execution.ok) return null;
  return {
    schema_version: 1,
    workflow_id: workflow.id,
    chain_id: execution.chain.id,
    max_iterations: workflow.stop.max_iterations,
    stages: execution.chain.stages.map((stage) => ({
      id: stage.id,
      max_passes: stage.max_passes,
      roles: stage.steps.filter((step) => step.kind === "role").map((step) => step.role),
      transitions: structuredClone(stage.transitions),
    })),
  };
}

export function validateWorkflowLifecycleSnapshot(snapshot) {
  if (snapshot?.schema_version === 2) {
    return hasExactlyKeys(snapshot, ["schema_version", "workflow_id", "workflow_version", "definition_ref", "start", "nodes", "limits"])
      && ID.test(String(snapshot.workflow_id ?? ""))
      && Number.isSafeInteger(snapshot.workflow_version) && snapshot.workflow_version >= 1
      && /^sha256:[0-9a-f]{64}$/.test(snapshot.definition_ref ?? "")
      && STAGE_ID.test(String(snapshot.start ?? ""))
      && Array.isArray(snapshot.nodes) && snapshot.nodes.length >= 1 && snapshot.nodes.length <= 256
      && snapshot.nodes.every((node) => hasExactlyKeys(node, ["id", "kind", "targets"])
        && STAGE_ID.test(String(node.id ?? "")) && typeof node.kind === "string"
        && Array.isArray(node.targets) && node.targets.every((target) => STAGE_ID.test(String(target))))
      && isPlainObject(snapshot.limits);
  }
  if (!hasExactlyKeys(snapshot, ["schema_version", "workflow_id", "chain_id", "max_iterations", "stages"])
    || snapshot.schema_version !== 1 || !ID.test(String(snapshot.workflow_id ?? ""))
    || snapshot.workflow_id.length > MAX_WORKFLOW_ID_LENGTH
    || !isPublicCode(snapshot.chain_id) || snapshot.chain_id.length > MAX_STAGE_ID_LENGTH
    || !Number.isSafeInteger(snapshot.max_iterations)
    || snapshot.max_iterations < 1 || snapshot.max_iterations > MAX_ITERATIONS
    || !Array.isArray(snapshot.stages) || snapshot.stages.length < 1 || snapshot.stages.length > MAX_STAGES) {
    return false;
  }
  const seen = new Set();
  for (const stage of snapshot.stages) {
    if (!hasExactlyKeys(stage, ["id", "max_passes", "roles", "transitions"])
      || !STAGE_ID.test(String(stage.id ?? "")) || stage.id.length > MAX_STAGE_ID_LENGTH || seen.has(stage.id)
      || !Number.isSafeInteger(stage.max_passes) || stage.max_passes < 1 || stage.max_passes > MAX_ITERATIONS
      || !Array.isArray(stage.roles) || stage.roles.length < 1 || stage.roles.length > MAX_STEPS_PER_STAGE
      || new Set(stage.roles).size !== stage.roles.length
      || !stage.roles.some((role) => role !== "verifier")
      || stage.roles.some((role) => !WORKFLOW_ROLE_BLOCKS.includes(role))
      || !Array.isArray(stage.transitions) || stage.transitions.length < 1 || stage.transitions.length > MAX_TRANSITIONS_PER_STAGE) {
      return false;
    }
    const schedule = stageStepSchedule({
      steps: stage.roles.map((role, index) => ({ id: `role-${index}`, kind: "role", role })),
    });
    if (schedule == null) return false;
    const definitionStage = { id: stage.id, max_passes: stage.max_passes, transitions: stage.transitions };
    const conditions = new Set();
    const verdicts = new Set();
    const gates = new Set();
    let verdictRole = null;
    let alwaysSeen = false;
    for (const transition of stage.transitions) {
      if (!keysAre(transition, ["when", "action", "target", "reason"]) || !ACTIONS.includes(transition.action)) return false;
      const conditionErrors = [];
      validateCondition(transition.when, "$.when", stage.roles, conditionErrors);
      if (conditionErrors.length > 0 || alwaysSeen) return false;
      const conditionKey = JSON.stringify(transition.when);
      if (conditions.has(conditionKey)) return false;
      conditions.add(conditionKey);
      if (transition.when.type === "always") alwaysSeen = true;
      if (transition.when.type === "verdict") {
        verdicts.add(transition.when.is);
        verdictRole ??= transition.when.role;
        if (transition.when.role !== verdictRole) return false;
      }
      if (transition.when.type === "gate") gates.add(transition.when.is);
      if (transition.action === "back") {
        if (!seen.has(transition.target) || transition.reason != null) return false;
      } else if (transition.target != null) return false;
      if (transition.action === "stop") {
        if (!isPublicCode(transition.reason) || transition.reason.length > MAX_STOP_REASON_LENGTH) return false;
      } else if (transition.reason != null) return false;
      let decision;
      try {
        decision = decideWorkflowTransition(definitionStage, 0, signalForCondition(transition.when));
      } catch {
        return false;
      }
      if (decision.action !== transition.action || (decision.target ?? null) !== (transition.target ?? null)
        || (transition.action === "stop" && decision.code !== transition.reason)
        || (transition.action === "back" && !seen.has(transition.target))) return false;
    }
    if (verdicts.size > 0 && gates.size > 0) return false;
    if (!alwaysSeen && (verdicts.size > 0 && VERDICTS.some((value) => !verdicts.has(value)))) return false;
    if (!alwaysSeen && (gates.size > 0 && ["pass", "fail"].some((value) => !gates.has(value)))) return false;
    seen.add(stage.id);
  }
  return true;
}

/** Host effects required beyond role execution; the Pi workflow runner injects none. */
export function workflowRequiredHostEffects(workflow) {
  if (workflow?.schema_version === WORKFLOW_SCHEMA_VERSION) {
    return [];
  }
  return [...new Set((workflow?.stages ?? []).flatMap((stage) =>
    (stage.steps ?? []).filter((step) => step.kind !== "role").map((step) => step.kind)))].sort();
}

function signalForCondition(condition) {
  if (condition.type === "verdict") return { role: condition.role, verdict: condition.is };
  if (condition.type === "gate") return { gate_result: condition.is };
  return {};
}

function ceilingReached(stage, passCount, loops = true) {
  return loops && passCount >= stage.max_passes;
}

function successSignals(workflow) {
  return workflow.stages.map((stage) => {
    const advance = stage.transitions.find((transition) => transition.action === "advance");
    return advance ? signalForCondition(advance.when) : {};
  });
}

/** Validate and simulate the definition. This performs no deployment or artifact effects. */
export function testWorkflow(workflow) {
  if (workflow?.schema_version === WORKFLOW_SCHEMA_VERSION) {
    const valid = validateWorkflowDefinition(workflow);
    if (!valid.valid) return { ok: false, code: "invalid-workflow-v4", errors: valid.errors };
    const graph = plannedWorkflowGraph(workflow);
    return {
      ok: true,
      workflow_id: workflow.id,
      transitions_total: graph.nodes.reduce((sum, node) => sum + node.targets.length, 0),
      transitions_tested: graph.nodes.reduce((sum, node) => sum + node.targets.length, 0),
      ceilings_tested: graph.nodes.filter((node) => node.max_visits != null || node.max_items != null).length,
      exhaustions_tested: graph.nodes.filter((node) => node.max_visits != null || node.max_items != null).length,
      artifacts_declared: Object.values(workflow.nodes).filter((node) => node.artifact != null).length,
      simulation: { ok: true, stop_reason: "structural-v4-simulation", nodes: graph.nodes.length },
    };
  }
  const valid = validateWorkflow(workflow);
  const totalTransitions = (workflow?.stages ?? []).reduce((sum, stage) => sum + (stage.transitions?.length ?? 0), 0);
  if (!valid.valid) {
    return { ok: false, code: "invalid-workflow", errors: valid.errors, transitions_tested: 0, transitions_total: totalTransitions };
  }
  const deployment = workflowToExecution(workflow);
  if (!deployment.ok) {
    return {
      ok: false, code: deployment.code ?? "workflow-deployment-test-failed", errors: deployment.errors ?? [],
      transitions_tested: 0, transitions_total: totalTransitions,
    };
  }
  let transitionsTested = 0;
  const actionsTested = new Set();
  let exhaustionsTested = 0;
  for (const stage of workflow.stages) {
    for (const transition of stage.transitions) {
      const decision = decideWorkflowTransition(stage, 0, signalForCondition(transition.when));
      if (decision.action !== transition.action
        || (decision.target ?? null) !== (transition.target ?? null)
        || (transition.action === "stop" && decision.code !== transition.reason)) {
        return {
          ok: false, code: `workflow-transition-test-failed:${stage.id}`,
          transitions_tested: transitionsTested, transitions_total: totalTransitions,
        };
      }
      transitionsTested += 1;
      actionsTested.add(transition.action);
      if (transition.action === "retry") {
        const exhausted = decideWorkflowTransition(stage, stage.max_passes, signalForCondition(transition.when));
        if (exhausted.action !== "refuse" || exhausted.code !== `workflow-stage-max-passes:${stage.id}`) {
          return {
            ok: false, code: `workflow-ceiling-test-failed:${stage.id}`,
            transitions_tested: transitionsTested, transitions_total: totalTransitions,
          };
        }
        exhaustionsTested += 1;
      }
    }
    if (!ceilingReached(stage, stage.max_passes) || ceilingReached(stage, stage.max_passes - 1)) {
      return {
        ok: false, code: `workflow-ceiling-test-failed:${stage.id}`,
        transitions_tested: transitionsTested, transitions_total: totalTransitions,
      };
    }
  }
  const simulation = simulateWorkflow(workflow, successSignals(workflow));
  if (!simulation.ok || !simulation.converged) {
    return {
      ok: false, code: simulation.code ?? "workflow-success-path-failed", simulation,
      transitions_tested: transitionsTested, transitions_total: totalTransitions,
    };
  }
  return {
    ok: true, transitions_tested: transitionsTested, transitions_total: totalTransitions,
    ceilings_tested: workflow.stages.length, exhaustions_tested: exhaustionsTested,
    artifacts_declared: workflow.stages.filter((stage) => stage.artifact != null).length,
    definition_tested: true, deployment_projected: true, runtime_tested: false,
    actions_tested: [...actionsTested].sort(), simulation,
  };
}

/** Deterministic, provider-free workflow test. Signals are consumed in order. */
export function simulateWorkflow(workflow, signals = [], { final_gate = "pass", loops = true } = {}) {
  if (workflow?.schema_version === WORKFLOW_SCHEMA_VERSION) {
    const valid = validateWorkflowDefinition(workflow);
    if (!valid.valid) return { ok: false, code: "invalid-workflow-v4", errors: valid.errors };
    return {
      ok: true,
      converged: final_gate === "pass",
      stop_reason: final_gate === "pass" ? "structural-v4-simulation" : "objective-gate-failed",
      code: final_gate === "pass" ? null : "objective-gate-failed",
      trace: plannedWorkflowGraph(workflow).nodes.map((node) => ({ node_id: node.id, kind: node.kind })),
      total_passes: 0,
      final_gate: { result: final_gate },
      loops,
      signals_consumed: signals.length,
    };
  }
  const valid = validateWorkflow(workflow);
  if (!valid.valid) return { ok: false, code: "invalid-workflow", errors: valid.errors, trace: [] };
  const passCounts = Object.fromEntries(workflow.stages.map((stage) => [stage.id, 0]));
  const trace = [];
  let index = 0;
  let cursor = 0;
  let total = 0;
  while (total < workflow.stop.max_iterations) {
    const stage = workflow.stages[index];
    if (ceilingReached(stage, passCounts[stage.id], loops)) {
      const code = `stage-max-passes-exhausted:${stage.id}`;
      return { ok: false, converged: false, stop_reason: code, code, trace, total_passes: total, final_gate: null };
    }
    total += 1;
    passCounts[stage.id] += 1;
    const signal = signals[cursor++] ?? {};
    const decision = decideWorkflowTransition(stage, passCounts[stage.id], signal, { loops });
    trace.push({ stage_id: stage.id, pass: passCounts[stage.id], action: decision.action, ...(decision.target ? { target: decision.target } : {}) });
    if (decision.action === "refuse") {
      const code = decision.code === `workflow-stage-max-passes:${stage.id}`
        ? `stage-max-passes-exhausted:${stage.id}`
        : decision.code;
      return { ok: false, converged: false, stop_reason: code, code, trace, total_passes: total, final_gate: null };
    }
    if (decision.action === "stop") {
      return { ok: true, converged: false, stop_reason: decision.code, code: null, trace, total_passes: total, final_gate: null };
    }
    if (decision.action === "retry") continue;
    if (decision.action === "back") {
      index = workflow.stages.findIndex((candidate) => candidate.id === decision.target);
      continue;
    }
    if (index < workflow.stages.length - 1) {
      index += 1;
      continue;
    }
    if (final_gate === "pass") {
      return { ok: true, converged: true, stop_reason: "converged", code: null, trace, total_passes: total, final_gate: { result: "pass" } };
    }
    if (!loops) {
      return {
        ok: false, converged: false, stop_reason: "gate-failed-single-pass", code: "objective-gate-failed",
        trace, total_passes: total, final_gate: { result: "fail" },
      };
    }
  }
  return {
    ok: false, converged: false, stop_reason: "not-converged-within-max-iterations",
    code: "not-converged-within-max-iterations", trace, total_passes: total,
    final_gate: final_gate === "fail" ? { result: "fail" } : null,
  };
}

function templateStages(template, gatePath) {
  if (template === "implement-review") return [{
    id: "implement", label: "Implement and review", max_passes: 3,
    steps: [
      { id: "implement", kind: "role", role: "builder" },
      { id: "review", kind: "role", role: "reviewer" },
    ],
    transitions: verdictTransitions("reviewer"),
    artifact: { path: gatePath, kind: "notes" },
  }];
  if (template === "plan-implement") return [
    {
      id: "plan", label: "Plan and review", max_passes: 3,
      steps: [
        { id: "plan", kind: "role", role: "planner" },
        { id: "plan-review", kind: "role", role: "reviewer" },
      ],
      transitions: verdictTransitions("reviewer"),
      artifact: { path: "PLAN.md", kind: "plan" },
    },
    {
      id: "implement", label: "Implement and review", max_passes: 3,
      steps: [
        { id: "implement", kind: "role", role: "builder" },
        { id: "review", kind: "role", role: "reviewer" },
        { id: "redteam", kind: "role", role: "redteam" },
      ],
      transitions: verdictTransitions("reviewer", "plan"),
      artifact: { path: gatePath, kind: "notes" },
    },
  ];
  if (template === "tdd-fix") return [
    {
      id: "reproduce", label: "Reproduce the bug", max_passes: 2,
      steps: [{ id: "reproduce", kind: "role", role: "builder" }],
      transitions: [
        { when: { type: "gate", is: "fail" }, action: "advance" },
        { when: { type: "gate", is: "pass" }, action: "retry" },
      ],
      artifact: { path: "REPRODUCTION.md", kind: "notes" },
    },
    {
      id: "fix", label: "Fix and review", max_passes: 3,
      steps: [
        { id: "fix", kind: "role", role: "builder" },
        { id: "review", kind: "role", role: "reviewer" },
      ],
      transitions: verdictTransitions("reviewer"),
      artifact: { path: gatePath, kind: "notes" },
    },
  ];
  return null;
}

export function createWorkflowFromTemplate({
  id, template = "implement-review", description = "User-created Helix workflow",
  gate_path = "proposal.txt", gate_contains = "HELIX_WORKFLOW_PASS", objective_gate = null, max_iterations = 6,
} = {}) {
  const stages = templateStages(template, gate_path);
  if (!stages) return { ok: false, code: "unknown-workflow-template", detail: template };
  const workflow = {
    schema_version: 1,
    id,
    description,
    task_class: template === "plan-implement" ? "risky-change" : "routine-code",
    source: "user",
    stages,
    stop: {
      max_iterations,
      max_runtime_ms: 10 * 60 * 1000,
      objective_gate: structuredClone(objective_gate ?? { type: "file-contains", path: gate_path, contains: gate_contains }),
    },
    deployment: {
      chain_id: id,
      call_timeout_ms: 2 * 60 * 1000,
      role_matrix: "mock-core-loop",
      assignments: {},
      default_assignment: { kind: "composite", preset: "daily" },
      parallel: { max_concurrency: 2 },
      run_target: { repo: "self" },
      input_refs: [],
      claims_ref: `local-ref:claims/${id}`,
      evidence_ref: `local-ref:evidence/${id}`,
    },
  };
  const valid = validateWorkflow(workflow);
  return valid.valid ? { ok: true, workflow } : { ok: false, code: "invalid-workflow", errors: valid.errors };
}

/** Convert canonical blocks to the existing hardened staged-runner boundary. */
export function workflowToExecution(workflow) {
  if (workflow?.schema_version === WORKFLOW_SCHEMA_VERSION) {
    const valid = validateWorkflowDefinition(workflow);
    if (!valid.valid) return { ok: false, code: "invalid-workflow-v4", errors: valid.errors };
    const stages = [];
    const byStage = new Map();
    const collect = (agent, maxPasses = 1) => {
      if (!byStage.has(agent.stage_id)) {
        const stage = { id: agent.stage_id, steps: [], max_passes: maxPasses, transitions: [{ when: { type: "always" }, action: "advance" }] };
        byStage.set(agent.stage_id, stage);
        stages.push(stage);
      }
      const stage = byStage.get(agent.stage_id);
      if (!stage.steps.some((step) => step.role === agent.role)) {
        stage.steps.push({ id: `${agent.stage_id}-${agent.role}`, kind: "role", role: agent.role });
      }
      stage.max_passes = Math.max(stage.max_passes, maxPasses);
    };
    for (const node of Object.values(workflow.nodes)) {
      if (node.kind === "agent") collect(node, node.max_visits ?? 1);
      if (node.kind === "pipeline") node.stages.forEach((agent) => collect(agent, node.max_visits));
      if (node.kind === "parallel") node.branches.forEach((agent) => collect(agent));
      if (node.kind === "map") collect(node.body);
    }
    const chain = {
      id: workflow.id,
      description: workflow.description,
      task_class: "risky-change",
      stages,
      requires_objective_gate: true,
      default_max_iterations: workflow.limits.max_total_effects,
    };
    const config = {
      id: workflow.id,
      description: workflow.description,
      chain: workflow.id,
      role_matrix: "mock-core-loop",
      assignments: structuredClone(workflow.provider_policy.assignments),
      default_assignment: structuredClone(workflow.provider_policy.default_assignment),
      max_iterations: Math.min(MAX_ITERATIONS, workflow.limits.max_total_effects),
      objective_gate: structuredClone(workflow.objective_gate),
      parallel: { max_concurrency: workflow.limits.max_concurrency },
      run_target: { repo: "self" },
      input_refs: [],
      claims_ref: `local-ref:claims/${workflow.id}`,
      evidence_ref: `local-ref:evidence/${workflow.id}`,
    };
    const runValid = stages.length > 0 ? validateRunConfig(config) : { valid: false, errors: [issue("$.nodes", "must contain an agent effect")] };
    return runValid.valid ? { ok: true, chain, config, definition: structuredClone(workflow) }
      : { ok: false, code: "workflow-deployment-invalid", errors: runValid.errors };
  }
  const valid = validateWorkflow(workflow);
  if (!valid.valid) return { ok: false, code: "invalid-workflow", errors: valid.errors };
  const stages = [];
  for (const stage of workflow.stages) {
    const executable = {
      id: stage.id,
      steps: structuredClone(stage.steps),
      max_passes: stage.max_passes,
      transitions: structuredClone(stage.transitions),
      ...(stage.artifact ? { artifact: structuredClone(stage.artifact) } : {}),
    };
    stages.push(executable);
  }
  const chain = {
    id: workflow.deployment.chain_id,
    description: workflow.description,
    task_class: workflow.task_class,
    stages,
    requires_objective_gate: true,
    default_max_iterations: workflow.stop.max_iterations,
  };
  const config = structuredClone(runConfigFromWorkflow(workflow));
  const runValid = validateRunConfig(config);
  return runValid.valid
    ? { ok: true, chain, config }
    : { ok: false, code: "workflow-deployment-invalid", errors: runValid.errors };
}
