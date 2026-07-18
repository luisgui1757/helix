// Pure programmatic WorkflowDefinition v4 builder. The returned document is
// ordinary JSON data and still passes through the same closed validator as UI
// or imported definitions. Helix never executes the program that constructed it.

import {
  WORKFLOW_DEFAULTS,
  WORKFLOW_LIMITS,
  WORKFLOW_SCHEMA_VERSION,
  validateWorkflowDefinition,
} from "./schema.mjs";

function options(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function agent(value = {}) {
  const { role, stage_id, prompt = "tracked-step-v1", output_schema = "semantic-v2", tools, mutation, timeout_ms, retry, next, max_visits, artifact, label } = options(value);
  return {
    kind: "agent",
    role,
    stage_id,
    prompt,
    output_schema: { id: output_schema },
    tools: tools ?? (mutation === "read-only" ? ["read", "grep", "find", "ls"] : ["read", "grep", "find", "ls", "bash", "edit", "write"]),
    mutation: mutation ?? "read-only",
    timeout_ms: timeout_ms ?? WORKFLOW_DEFAULTS.max_call_ms,
    retry: retry ?? { max_attempts: 1, backoff_ms: 0 },
    ...(next ? { next } : {}),
    ...(max_visits != null ? { max_visits } : {}),
    ...(artifact ? { artifact } : {}),
    ...(label ? { label } : {}),
  };
}

export function pipeline(stages, next, value = {}) {
  const { label, max_visits = WORKFLOW_DEFAULTS.max_visits, artifact } = options(value);
  return { kind: "pipeline", stages, next, max_visits, ...(label ? { label } : {}), ...(artifact ? { artifact } : {}) };
}

export function parallel(branches, next, value = {}) {
  const { label, max_concurrency = WORKFLOW_DEFAULTS.max_concurrency, failure = "abort", allow_failure_codes } = options(value);
  return { kind: "parallel", branches, next, max_concurrency, failure, ...(allow_failure_codes ? { allow_failure_codes } : {}), ...(label ? { label } : {}) };
}

export function map(items_path, body, next, value = {}) {
  const { label, max_items = WORKFLOW_DEFAULTS.max_map_items, failure = "abort", allow_failure_codes } = options(value);
  return { kind: "map", items_path, body, next, max_items, failure, ...(allow_failure_codes ? { allow_failure_codes } : {}), ...(label ? { label } : {}) };
}

export function reduce(items_path, strategy, next, value = {}) {
  const { label, separator } = options(value);
  return { kind: "reduce", items_path, strategy, next, ...(label ? { label } : {}), ...(separator != null ? { separator } : {}) };
}

export function decision(transitions, fallback, value = {}) {
  const { label, loops_off, default_loop = false } = options(value);
  return { kind: "decision", transitions, default: { target: fallback, ...(default_loop ? { loop: true } : {}) }, ...(label ? { label } : {}), ...(loops_off ? { loops_off } : {}) };
}

export function gate(objective, on_pass, on_fail, value = {}) {
  const { label, loops_off } = options(value);
  return { kind: "gate", gate: objective, on_pass, on_fail, ...(label ? { label } : {}), ...(loops_off ? { loops_off } : {}) };
}

export function objectiveGate(on_pass, on_fail, value = {}) {
  const { label, loops_off } = options(value);
  return { kind: "gate", on_pass, on_fail, final: true, ...(label ? { label } : {}), ...(loops_off ? { loops_off } : {}) };
}

export function checkpoint(reason, next, value = {}) {
  const { label } = options(value);
  return { kind: "checkpoint", reason, next, ...(label ? { label } : {}) };
}

export function subworkflow(workflow_id, version, next, value = {}) {
  const { label } = options(value);
  return { kind: "subworkflow", workflow_id, version, next, ...(label ? { label } : {}) };
}

export function terminal(status, code = null, value = {}) {
  const { label } = options(value);
  return { kind: "terminal", status, ...(code ? { code } : {}), ...(label ? { label } : {}) };
}

export function workflow(value = {}) {
  const { id, name, description, version = 1, source = "user", inputs, start, nodes, limits = {}, provider_policy, workspace_policy, objective_gate } = options(value);
  const safeLimits = options(limits);
  const definition = {
    schema_version: WORKFLOW_SCHEMA_VERSION,
    id,
    name,
    description,
    version,
    source,
    inputs: inputs ?? {
      type: "object", additionalProperties: false, required: ["task"],
      properties: { task: { type: "string", minLength: 1, maxLength: WORKFLOW_LIMITS.max_input_string_length } },
    },
    start,
    nodes,
    limits: {
      max_total_effects: safeLimits.max_total_effects ?? WORKFLOW_DEFAULTS.max_total_effects,
      max_concurrency: safeLimits.max_concurrency ?? WORKFLOW_DEFAULTS.max_concurrency,
      max_map_items: safeLimits.max_map_items ?? WORKFLOW_DEFAULTS.max_map_items,
      max_run_ms: safeLimits.max_run_ms ?? WORKFLOW_DEFAULTS.max_run_ms,
      max_call_ms: safeLimits.max_call_ms ?? WORKFLOW_DEFAULTS.max_call_ms,
      structured_repair_attempts: safeLimits.structured_repair_attempts ?? WORKFLOW_DEFAULTS.structured_repair_attempts,
    },
    provider_policy: provider_policy ?? {
      exact: true, assignments: {}, default_assignment: { kind: "composite", preset: "daily" }, require_live_certification: false,
    },
    workspace_policy: workspace_policy ?? { mode: "canonical-worktree", proposal_cleanup: "unchanged", transcripts: "off" },
    objective_gate,
  };
  const valid = validateWorkflowDefinition(definition);
  return valid.valid ? { ok: true, definition } : { ok: false, code: "invalid-workflow-v4", errors: valid.errors };
}
