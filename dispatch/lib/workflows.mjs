// Helix workflows — canonical user-facing workflow building blocks.
//
// A workflow owns its ordered stages, explicit transition conditions, bounded
// stopping criteria, and deployment defaults. The staged runner remains the
// hardened effect boundary; `workflowToExecution` is the only compatibility
// adapter from these blocks to its chain/config inputs. Legacy tracked chains
// are accepted only as import material and are normalized immediately.

import { validateRunConfig } from "./run-configs.mjs";
import { MAX_ITERATIONS } from "./limits.mjs";
import { isPublicCode } from "./public-values.mjs";
import { ROLES, STAGE_ROLES } from "./role-envelope.mjs";
import { hashRef, stableStringify } from "./run-record.mjs";
import { stageStepSchedule } from "./stage-schedule.mjs";
import { isSafeWorktreeFilePath } from "./persistence.mjs";

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
  const objectiveGate = structuredClone(config?.objective_gate ?? {
    type: "file-contains", path: "proposal.txt", contains: "HELIX_WORKFLOW_PASS",
  });
  const stages = (chain?.stages ?? []).map(normalizeWorkflowStage).map((stage) => ({
    ...stage,
    artifact: stage.artifact ?? { path: objectiveGate.path, kind: "notes" },
  }));
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
  const errors = [];
  if (!keysAre(workflow, ["schema_version", "id", "description", "task_class", "source", "stages", "stop", "deployment"])) {
    errors.push(issue("$", "must be a workflow object with no unknown fields"));
    return { valid: false, errors };
  }
  if (workflow.schema_version !== 1) errors.push(issue("$.schema_version", "must equal 1"));
  if (!ID.test(String(workflow.id ?? ""))) errors.push(issue("$.id", "must be a safe workflow id"));
  if (typeof workflow.description !== "string" || workflow.description.trim() === "") {
    errors.push(issue("$.description", "must be non-empty"));
  }
  if (!TASK_CLASSES.includes(workflow.task_class)) errors.push(issue("$.task_class", "must be a known task class"));
  if (!["built-in", "user"].includes(workflow.source)) errors.push(issue("$.source", "must be built-in or user"));
  if (!Array.isArray(workflow.stages) || workflow.stages.length === 0) {
    errors.push(issue("$.stages", "must contain at least one stage"));
  }

  const priorStageIds = [];
  for (let index = 0; index < (workflow.stages ?? []).length; index += 1) {
    const stage = workflow.stages[index];
    const path = `$.stages[${index}]`;
    if (!keysAre(stage, ["id", "label", "steps", "max_passes", "transitions", "artifact"])) {
      errors.push(issue(path, "must contain only stage fields"));
      continue;
    }
    if (!STAGE_ID.test(String(stage.id ?? ""))) errors.push(issue(`${path}.id`, "must be a stage id"));
    if (priorStageIds.includes(stage.id)) errors.push(issue(`${path}.id`, `duplicate stage '${stage.id}'`));
    if (stage.label != null && (typeof stage.label !== "string" || stage.label.trim() === "")) {
      errors.push(issue(`${path}.label`, "must be non-empty"));
    }
    if (!Number.isSafeInteger(stage.max_passes) || stage.max_passes < 1 || stage.max_passes > MAX_ITERATIONS) {
      errors.push(issue(`${path}.max_passes`, `must be between 1 and ${MAX_ITERATIONS}`));
    }
    const stepIds = new Set();
    const roleSteps = [];
    if (!Array.isArray(stage.steps) || stage.steps.length === 0) errors.push(issue(`${path}.steps`, "must not be empty"));
    for (let stepIndex = 0; stepIndex < (stage.steps ?? []).length; stepIndex += 1) {
      const step = stage.steps[stepIndex];
      const stepPath = `${path}.steps[${stepIndex}]`;
      if (!keysAre(step, ["id", "kind", "role", "note"]) || !STEP_ID.test(String(step.id ?? ""))
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
      if (step.kind !== "role" && (typeof step.note !== "string" || step.note.trim() === "")) {
        errors.push(issue(`${stepPath}.note`, "non-role step needs a note"));
      }
      if (step.kind === "role" && step.note != null) errors.push(issue(`${stepPath}.note`, "role step must not declare a note"));
      if (step.kind === "role" && ROLES.includes(step.role)) {
        if (roleSteps.includes(step.role)) errors.push(issue(`${stepPath}.role`, `duplicate stage role '${step.role}'`));
        roleSteps.push(step.role);
      }
    }
    if (Array.isArray(stage.steps) && stage.steps.length > 0 && stageStepSchedule(stage) == null) {
      errors.push(issue(`${path}.steps`, "must use executable candidate/check/verifier/handoff ordering"));
    }
    if (!roleSteps.some((role) => WORKFLOW_MUTATING_ROLES.includes(role))) {
      errors.push(issue(`${path}.steps`, "every stage must include a planner or builder that can produce its durable output"));
    }
    if (!Array.isArray(stage.transitions) || stage.transitions.length === 0) {
      errors.push(issue(`${path}.transitions`, "must not be empty"));
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
      if (transition.action === "stop" && !isPublicCode(transition.reason)) {
        errors.push(issue(`${transitionPath}.reason`, "stop transition needs a stable public code"));
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
    if (!keysAre(stage.artifact, ["path", "kind"])
      || !isSafeWorkflowPath(stage.artifact?.path) || !["plan", "brief", "notes"].includes(stage.artifact?.kind)) {
      errors.push(issue(`${path}.artifact`, "is required and must be a contained plan, brief, or notes output"));
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
    if (!keysAre(gate, ["type", "path", "contains"]) || gate.type !== "file-contains"
      || !isSafeWorkflowPath(gate.path) || typeof gate.contains !== "string" || gate.contains.length === 0) {
      errors.push(issue("$.stop.objective_gate", "must be a valid file-contains gate"));
    } else if (!(workflow.stages ?? []).some((stage) => stage.artifact?.path === gate.path)) {
      errors.push(issue("$.stop.objective_gate.path", "must match at least one declared stage output"));
    }
  }
  if (!hasExactlyKeys(workflow.deployment, DEPLOYMENT_FIELDS)) {
    errors.push(issue("$.deployment", "must contain every deployment field and no unknown fields"));
  }
  if (isPlainObject(workflow.deployment)) {
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
  return { valid: errors.length === 0, errors };
}

/** Bind every mutable source that can change the confirmed workflow execution. */
export function workflowExecutionBindingRef({ workflow, profile = null, toggles, presets } = {}) {
  if (!isPlainObject(workflow) || !isPlainObject(toggles) || !(presets instanceof Map)) return null;
  const presetEntries = [...presets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, preset]) => [id, preset]);
  return hashRef(stableStringify({ workflow, profile, toggles, presets: presetEntries }));
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

/** Host effects required beyond role execution; the Pi workflow runner injects none. */
export function workflowRequiredHostEffects(workflow) {
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

/** Exercise every transition and ceiling, then prove the end-to-end success path. */
export function testWorkflow(workflow) {
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
    artifacts_tested: workflow.stages.length, deployment_tested: true,
    actions_tested: [...actionsTested].sort(), simulation,
  };
}

/** Deterministic, provider-free workflow test. Signals are consumed in order. */
export function simulateWorkflow(workflow, signals = [], { final_gate = "pass", loops = true } = {}) {
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
  gate_path = "proposal.txt", gate_contains = "HELIX_WORKFLOW_PASS", max_iterations = 6,
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
      objective_gate: { type: "file-contains", path: gate_path, contains: gate_contains },
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
