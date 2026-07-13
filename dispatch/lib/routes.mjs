// Helix dispatch — task-class routes + panel resolution.
//
// Panel bounds come from the route alone: a route's min_successes applies
// to the LAUNCHED candidates, and a panel is never silently shrunk — any
// reduction is recorded as a warning. Helix performs no cost control; spend is
// bounded by the backend control instance (billing ceiling), not the harness.

import { validate } from "./schema.mjs";
import { HELIX_PROVIDERS } from "./providers.mjs";
import { ROLES } from "./role-envelope.mjs";
import { MODEL_ID_PATTERN } from "./public-values.mjs";

export const EFFORTS = Object.freeze([
  "default", "low", "medium", "high", "xhigh", "max", "provider-managed",
]);

/** One reserved per-role matrix entry: role → [{ provider, model, effort, instances }]. */
export const ROLE_MATRIX_ENTRY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["provider", "model", "effort", "instances"],
  properties: {
    provider: { type: "string", enum: HELIX_PROVIDERS },
    model: { type: "string", pattern: MODEL_ID_PATTERN },
    effort: { type: "string", enum: EFFORTS },
    instances: { type: "integer", minimum: 1 },
  },
});

/** Schema for a route config. */
export const ROUTE_CONFIG_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "id", "task_class", "roles", "panel", "min_successes",
    "judge_synthesis_rule", "objective_gate", "gate_kind", "requires_cross_family", "role_matrix",
  ],
  properties: {
    id: { type: "string", minLength: 1 },
    task_class: { type: "string", minLength: 1 },
    roles: { type: "array", items: { type: "string", enum: ROLES }, minItems: 1 },
    panel: {
      type: "object",
      additionalProperties: false,
      required: ["min", "max"],
      properties: { min: { type: "integer", minimum: 1 }, max: { type: "integer", minimum: 1 } },
    },
    // number, or the literal "panel" meaning "= the launched panel size".
    min_successes: { anyOf: [{ type: "integer", minimum: 1 }, { type: "string", enum: ["panel"] }] },
    judge_synthesis_rule: { type: "string", minLength: 1 },
    // Objective gate command family. null → no objective gate → advisory only.
    objective_gate: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    gate_kind: { type: "string", enum: ["objective", "advisory"] },
    requires_cross_family: { type: "boolean" },
    // Reserved role→candidates matrix. Defaults are empty; callers supply the
    // §"Routing Policy" effort/instances reservation); shape is stable now.
    role_matrix: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(ROLES.map((r) => [r, { type: "array", items: ROLE_MATRIX_ENTRY_SCHEMA }])),
    },
  },
});

function route(def) {
  return Object.freeze({ role_matrix: {}, ...def });
}

/** The built-in Helix routes, one per task class (spec §"Routing Policy" table). */
export const ROUTES = Object.freeze({
  trivial: route({
    id: "trivial", task_class: "trivial", roles: ["builder"],
    panel: { min: 1, max: 1 }, min_successes: 1,
    judge_synthesis_rule: "no judge", objective_gate: null, gate_kind: "advisory",
    requires_cross_family: false,
  }),
  "routine-code": route({
    id: "routine-code", task_class: "routine-code", roles: ["builder", "reviewer"],
    panel: { min: 2, max: 2 }, min_successes: 2,
    judge_synthesis_rule: "synthesize only if reviewer disagrees",
    objective_gate: "tests/lint/typecheck/pr-gate", gate_kind: "objective",
    requires_cross_family: false,
  }),
  architecture: route({
    id: "architecture", task_class: "architecture", roles: ["scout", "planner", "judge", "synthesizer"],
    panel: { min: 2, max: 3 }, min_successes: "panel",
    judge_synthesis_rule: "blind compare; preserve disagreements",
    objective_gate: "spec-checklist+review", gate_kind: "objective",
    requires_cross_family: true,
  }),
  security: route({
    id: "security", task_class: "security", roles: ["redteam", "judge", "synthesizer"],
    panel: { min: 2, max: 3 }, min_successes: "panel",
    judge_synthesis_rule: "cross-family required when providers available",
    objective_gate: "public-safety/security-gates", gate_kind: "objective",
    requires_cross_family: true,
  }),
  "roadmap-reconciliation": route({
    id: "roadmap-reconciliation", task_class: "roadmap-reconciliation",
    roles: ["planner", "reviewer", "judge", "synthesizer"],
    panel: { min: 2, max: 3 }, min_successes: "panel",
    judge_synthesis_rule: "contradiction ledger required",
    objective_gate: "roadmap-consistency-check", gate_kind: "objective",
    requires_cross_family: false,
  }),
  "pr-preflight": route({
    id: "pr-preflight", task_class: "pr-preflight", roles: ["reviewer", "redteam", "verifier"],
    panel: { min: 2, max: 3 }, min_successes: "panel",
    judge_synthesis_rule: "preserve blockers; no synthesis success without gates",
    objective_gate: "pr-gate/checklist", gate_kind: "objective",
    requires_cross_family: false,
  }),
  "risky-change": route({
    id: "risky-change", task_class: "risky-change", roles: ["builder", "reviewer", "redteam"],
    panel: { min: 2, max: 3 }, min_successes: "panel",
    judge_synthesis_rule: "synthesize only after reviewer/redteam pass",
    objective_gate: "relevant-tests+risk-gate", gate_kind: "objective",
    requires_cross_family: false,
  }),
  "ui-quality": route({
    id: "ui-quality", task_class: "ui-quality", roles: ["builder", "reviewer"],
    panel: { min: 1, max: 2 }, min_successes: "panel",
    judge_synthesis_rule: "synthesize only material alternatives",
    objective_gate: "visual/accessibility/perf-checks", gate_kind: "objective",
    requires_cross_family: false,
  }),
});

/** Validate an arbitrary route config; returns {valid, errors}. */
export function validateRouteConfig(config) {
  return validate(ROUTE_CONFIG_SCHEMA, config, "$");
}

/** Route for a task class, or null if unknown (caller fails closed). */
export function routeForClass(taskClass) {
  return Object.prototype.hasOwnProperty.call(ROUTES, taskClass) ? ROUTES[taskClass] : null;
}

/**
 * Resolve the launched panel for a route. The route's panel.max bounds the
 * launched candidates from above and the requested count bounds them from
 * below; min_successes ("panel" = all launched) governs how many must succeed.
 * Required successes above the launched count is a structural config error and
 * fails closed.
 *
 * @param {object} route a ROUTE_CONFIG_SCHEMA-shaped route
 * @param {number} requested how many candidates the request supplies
 * @returns {{ launched:number, required_successes:number, min_panel:number,
 *            fail_closed:boolean, reason:string|null, warnings:string[] }}
 */
export function resolvePanel(route, requested = route.panel.max) {
  const launched = Math.min(route.panel.max, requested);
  const required = route.min_successes === "panel" ? launched : route.min_successes;

  const warnings = [];
  let fail_closed = false;
  let reason = null;

  if (required > launched) {
    fail_closed = true;
    reason = "required-successes-exceeds-launched";
    warnings.push("required-successes-unmeetable");
  }

  return { launched, required_successes: required, min_panel: route.panel.min, fail_closed, reason, warnings };
}
