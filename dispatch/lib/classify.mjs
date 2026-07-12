// Helix dispatch — deterministic task classifier + classification floors.
//
// Source of truth: fusion-dispatch-research.md §"Routing Policy" (Rules:
// classification floors, uncertain-routes-upward, user overrides) and
// §"Failure Behavior" (non-TTY escalation is a fail-closed stop).
//
// The classifier is deterministic and testable. It never routes a floor-triggering
// task below its required risk class; when it cannot classify at all it routes
// upward, and in a non-TTY mode any required escalation is a fail-closed stop.

import { ROUTES, routeForClass } from "./routes.mjs";

/** Task classes, ordered by risk (ascending). The canonical bump ladder. */
export const CLASS_RISK = Object.freeze({
  trivial: 0,
  "routine-code": 1,
  "ui-quality": 1,
  "roadmap-reconciliation": 2,
  architecture: 3,
  "risky-change": 4,
  "pr-preflight": 5,
  security: 6,
});

/** Canonical rungs (one class per distinct risk) for "route upward". */
const BUMP_LADDER = Object.freeze([
  "trivial", "routine-code", "roadmap-reconciliation", "architecture",
  "risky-change", "pr-preflight", "security",
]);

/**
 * Mandatory classification floors: a task touching any of these can never route
 * below the mapped class (spec §"Routing Policy" Rules).
 */
export const FLOOR_SIGNALS = Object.freeze({
  auth: "security",
  credentials: "security",
  "provider-config": "security",
  egress: "security",
  telemetry: "security",
  sandboxing: "security",
  "public-safety": "security",
  "persisted-shape": "risky-change",
  "branch-protection": "risky-change",
  "release-gates": "risky-change",
  "risky-change": "risky-change",
  "pr-preflight": "pr-preflight",
});

const TTY_MODE = "tui";

function riskOf(cls) {
  return Object.prototype.hasOwnProperty.call(CLASS_RISK, cls) ? CLASS_RISK[cls] : -1;
}

function isKnownClass(cls) {
  return Object.prototype.hasOwnProperty.call(ROUTES, cls);
}

/** The highest-risk class strictly above `cls` on the bump ladder (ceiling: security). */
function bumpUp(cls) {
  const r = riskOf(cls);
  for (const rung of BUMP_LADDER) {
    if (riskOf(rung) > r) return rung;
  }
  return "security";
}

/** Highest-risk floor class triggered by the given signals (null if none). */
function floorFromSignals(signals, warnings) {
  let floorClass = null;
  const applied = [];
  for (const signal of Array.isArray(signals) ? signals : []) {
    const cls = FLOOR_SIGNALS[signal];
    if (!cls) {
      // Stable code only — the raw signal is user-controlled free text and must
      // never reach a persisted public-safe run record (spec §"Public-Safe Logging").
      warnings.push("unknown-floor-signal");
      continue;
    }
    applied.push({ signal, class: cls });
    if (floorClass === null || riskOf(cls) > riskOf(floorClass)) floorClass = cls;
  }
  return { floorClass, applied };
}

/**
 * Classify a task into a task class + route, applying floors and fail-closed
 * escalation. Pure and deterministic.
 *
 * @param {{ class_hint?:string, signals?:string[], confident?:boolean,
 *           override?:{ task_class?:string, disable_adversarial?:boolean } }} task
 * @param {{ mode?:string }} ctx dispatch mode ("tui" is the only interactive mode)
 * @returns {object} classification decision (see fields below)
 */
export function classify(task, ctx) {
  const warnings = [];
  const overrides_applied = [];
  const mode = ctx?.mode ?? "print";

  // Base class from an explicit hint (deterministic). Unknown hint is ignored.
  let base = null;
  if (task?.class_hint != null) {
    if (isKnownClass(task.class_hint)) base = task.class_hint;
    else warnings.push("unknown-class-hint"); // stable code only; hint is user free text
  }
  const confident = base !== null && (task?.confident ?? true);

  // Floors from signals.
  const { floorClass, applied: floors_applied } = floorFromSignals(task?.signals, warnings);

  // Effective = the higher-risk of base and floor (floor can only raise).
  let effective = base;
  if (floorClass && riskOf(floorClass) > riskOf(effective)) {
    effective = floorClass;
    if (base !== null) warnings.push("floor-raised-classification");
  }

  const decision = {
    task_class: null,
    route_id: null,
    base_class: base,
    floor_class: floorClass,
    floors_applied,
    confident,
    escalation: null,
    fail_closed: false,
    warnings,
    overrides_applied,
    reason: null,
  };

  // Uncertain: no confident hint. Route upward from a known point, else escalate.
  if (!confident) {
    if (effective !== null) {
      const bumped = bumpUp(effective);
      if (riskOf(bumped) > riskOf(effective)) {
        warnings.push("uncertain-routed-upward");
        effective = bumped;
      }
    } else {
      // Nothing to route from → must escalate to the user.
      if (mode === TTY_MODE) {
        decision.escalation = "tui-user";
        decision.reason = "uncertain-classification-tui-escalate";
      } else {
        decision.escalation = "non-tty-stop";
        decision.fail_closed = true;
        decision.reason = "uncertain-classification-non-tty-fail-closed";
      }
      return decision;
    }
  }

  // User overrides: may only RAISE risk or explicitly disable adversarial review.
  if (task?.override) {
    if (task.override.task_class != null) {
      const ov = task.override.task_class;
      if (!isKnownClass(ov)) {
        // Stable codes only — the override class is user-controlled free text.
        warnings.push("unknown-override-class");
      } else if (riskOf(ov) > riskOf(effective)) {
        effective = ov;
        overrides_applied.push(`raise:${ov}`); // ov is a known class here (bounded vocabulary)
      } else {
        warnings.push("override-rejected-not-raising");
      }
    }
    if (task.override.disable_adversarial === true) {
      overrides_applied.push("disable-adversarial");
    }
  }

  const routeObj = routeForClass(effective);
  if (!routeObj) {
    // Effective class has no route → fail closed (never dispatch an unrouted class).
    decision.fail_closed = true;
    decision.reason = `no-route-for-class:${effective}`;
    return decision;
  }

  decision.task_class = effective;
  decision.route_id = routeObj.id;
  return decision;
}
