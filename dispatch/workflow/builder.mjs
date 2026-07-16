// Pure programmatic WorkflowDefinition v4 builder. The returned document is
// ordinary JSON data and still passes through the same closed validator as UI
// or imported definitions. Helix never executes the program that constructed it.

import {
  WORKFLOW_DEFAULTS,
  WORKFLOW_SCHEMA_VERSION,
  validateWorkflowDefinition,
} from "./schema.mjs";

export function agent({ role, stage_id, prompt = "tracked-step-v1", output_schema = "semantic-v2", tools, mutation, timeout_ms, retry, next, max_visits, artifact, label } = {}) {
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

export function pipeline(stages, next, { label, max_visits = WORKFLOW_DEFAULTS.max_visits, artifact } = {}) {
  return { kind: "pipeline", stages, next, max_visits, ...(label ? { label } : {}), ...(artifact ? { artifact } : {}) };
}

export function parallel(branches, next, { label, max_concurrency = WORKFLOW_DEFAULTS.max_concurrency, failure = "abort", allow_failure_codes } = {}) {
  return { kind: "parallel", branches, next, max_concurrency, failure, ...(allow_failure_codes ? { allow_failure_codes } : {}), ...(label ? { label } : {}) };
}

export function map(items_path, body, next, { label, max_items = WORKFLOW_DEFAULTS.max_map_items, failure = "abort", allow_failure_codes } = {}) {
  return { kind: "map", items_path, body, next, max_items, failure, ...(allow_failure_codes ? { allow_failure_codes } : {}), ...(label ? { label } : {}) };
}

export function reduce(items_path, strategy, next, { label, separator } = {}) {
  return { kind: "reduce", items_path, strategy, next, ...(label ? { label } : {}), ...(separator != null ? { separator } : {}) };
}

export function decision(transitions, fallback, { label, loops_off } = {}) {
  return { kind: "decision", transitions, default: fallback, ...(label ? { label } : {}), ...(loops_off ? { loops_off } : {}) };
}

export function gate(objective, on_pass, on_fail, { label, final = false, loops_off } = {}) {
  return { kind: "gate", gate: objective, on_pass, on_fail, final, ...(label ? { label } : {}), ...(loops_off ? { loops_off } : {}) };
}

export function checkpoint(reason, next, { label } = {}) {
  return { kind: "checkpoint", reason, next, ...(label ? { label } : {}) };
}

export function subworkflow(workflow_id, version, next, { label } = {}) {
  return { kind: "subworkflow", workflow_id, version, next, ...(label ? { label } : {}) };
}

export function terminal(status, code = null, { label } = {}) {
  return { kind: "terminal", status, ...(code ? { code } : {}), ...(label ? { label } : {}) };
}

export function workflow({ id, name, description, version = 1, source = "user", inputs, start, nodes, limits = {}, provider_policy, workspace_policy, objective_gate } = {}) {
  const definition = {
    schema_version: WORKFLOW_SCHEMA_VERSION,
    id,
    name,
    description,
    version,
    source,
    inputs: inputs ?? {
      type: "object", additionalProperties: false, required: ["task"],
      properties: { task: { type: "string", minLength: 1, maxLength: 65_536 } },
    },
    start,
    nodes,
    limits: {
      max_total_effects: limits.max_total_effects ?? WORKFLOW_DEFAULTS.max_total_effects,
      max_concurrency: limits.max_concurrency ?? WORKFLOW_DEFAULTS.max_concurrency,
      max_map_items: limits.max_map_items ?? WORKFLOW_DEFAULTS.max_map_items,
      max_run_ms: limits.max_run_ms ?? WORKFLOW_DEFAULTS.max_run_ms,
      max_call_ms: limits.max_call_ms ?? WORKFLOW_DEFAULTS.max_call_ms,
      structured_repair_attempts: limits.structured_repair_attempts ?? WORKFLOW_DEFAULTS.structured_repair_attempts,
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
