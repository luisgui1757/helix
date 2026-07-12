// Helix dispatch — default-on adversarial policy for meaningful work (Stage 3H).
//
// Source of truth: fusion-dispatch-research.md §"Multi-agent orchestration"
// (adversarial/multi-team debate) and ROADMAP §7-Theme B / §9-Q2:
// "default-on for meaningful work — plans, reviews, risky changes, security,
// architecture, and PR preflight ... `/adversarial off` per-task ... Explicit
// every-task or heavier 3+ model runs remain user opt-in."
//
// This is a PURE policy surface: no UI, no slash command, no side effects. The
// opt-out is exposed through the EXISTING structural channel
// (`task.override.disable_adversarial`, already validated by the classifier and
// the dispatch request schema) — this keeps the `/` command budget legible; no new
// extension/command is added. The user opt-out is recorded as a stable warning
// code so a debate summary shows the override structurally, never as free text.

/**
 * Roles that make a route "meaningful work" for adversarial iteration: a critic /
 * arbiter of disagreement (`redteam`) or a blind-compare / synthesis arbiter
 * (`judge` / `synthesizer`). A route with none of these is single-pass.
 */
export const ADVERSARIAL_ROLES = Object.freeze(["redteam", "judge", "synthesizer"]);

/**
 * The task classes that are "meaningful work" — adversarial/multi-team debate is
 * default-on for these (spec / ROADMAP §9-Q2). This list is kept in lockstep with
 * "the route carries an adversarial role" (asserted in tests); it is the human-
 * readable statement of the same policy, not a second source of truth.
 */
export const MEANINGFUL_WORK_CLASSES = Object.freeze([
  "architecture",
  "security",
  "risky-change",
  "roadmap-reconciliation",
  "pr-preflight",
]);

/** Whether a route carries at least one adversarial role. */
export function routeHasAdversarialRole(route) {
  return !!route && Array.isArray(route.roles) && route.roles.some((r) => ADVERSARIAL_ROLES.includes(r));
}

/**
 * Resolve the effective adversarial posture for a route + request.
 *
 * `default_on` is true for meaningful work (a route with an adversarial role) —
 * adversarial/multi-team debate runs by default, no opt-in required. The user may
 * opt out per task via `task.override.disable_adversarial` (equivalent to
 * `/adversarial off`); doing so on a default-on route is recorded structurally as
 * `adversarial-opt-out`. A non-adversarial (single-pass) posture records
 * `single-pass-route`.
 *
 * Heavier work (every-task, or a 3+ model panel beyond a route's default) is NOT
 * enabled here: this function never widens a panel — it only decides whether the
 * default route iterates adversarially. Widening stays explicit request/profile
 * config (candidate list + profile caps), i.e. opt-in.
 *
 * @param {object|null} route a ROUTE_CONFIG_SCHEMA-shaped route (or null)
 * @param {object} request the dispatch request (reads task.override only)
 * @returns {{ default_on:boolean, opted_out:boolean, effective_on:boolean, warnings:string[] }}
 */
export function resolveAdversarialPolicy(route, request) {
  const default_on = routeHasAdversarialRole(route);
  const opted_out = request?.task?.override?.disable_adversarial === true;
  const effective_on = default_on && !opted_out;
  const warnings = [];
  if (default_on && opted_out) warnings.push("adversarial-opt-out");
  if (!effective_on) warnings.push("single-pass-route");
  return { default_on, opted_out, effective_on, warnings };
}
