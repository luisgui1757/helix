// Helix dispatch — staged chain registry.
//
// A chain is an ordered list of STAGES; each stage is a mini-loop. A reviewer
// VERDICT may route control (stay in the stage, advance, or jump back to a
// named earlier stage), but only the objective gate can conclude the run — a
// gateless verdict can never produce success. Every stage pass and backward
// jump consumes the global max_iterations budget; per-stage max_passes must be
// finite, so termination is guaranteed.
//
// Chains are named configuration defaults, not slash commands. Unknown or
// malformed chain ids fail closed; the step schema is closed so no chain can
// recursively reference another chain. A single-stage chain with no advance
// block is a plain linear pipeline (the ship-pre-pr gauntlet).
//
// Catalog rule (loop sprawl): a new chain must embody a NEW CONVERGENCE SHAPE;
// casts and panel sizes are configuration, not new chains.

import { validate, SchemaError } from "./schema.mjs";
import { ROLES, STAGE_ROLES } from "./role-envelope.mjs";
import { MAX_ITERATIONS } from "./limits.mjs";
import { isPublicCode } from "./public-values.mjs";
import { stageStepSchedule } from "./stage-schedule.mjs";
import { isSafeWorktreeFilePath } from "./persistence.mjs";

const CHAIN_ID_PATTERN = "^[a-z0-9][a-z0-9._:-]*$";
const STAGE_ID_PATTERN = "^[a-z][a-z0-9-]*$";
const STEP_ID_PATTERN = "^[a-z][a-z0-9-]*$";
const SAFE_REL_PATH_PATTERN = "^[A-Za-z0-9._/-]+$";

const TASK_CLASSES = Object.freeze([
  "trivial",
  "routine-code",
  "architecture",
  "security",
  "roadmap-reconciliation",
  "pr-preflight",
  "risky-change",
  "ui-quality",
]);

const STEP_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id", "kind"],
  properties: {
    id: { type: "string", pattern: STEP_ID_PATTERN },
    kind: { type: "string", enum: ["role", "local-check", "handoff"] },
    role: { type: "string", enum: ROLES },
    note: { type: "string", minLength: 1 },
  },
});

const CONDITION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    type: { type: "string", enum: ["always", "verdict", "gate"] },
    role: { type: "string", enum: ROLES },
    is: { type: "string", enum: ["approve", "revise", "revise-jump", "pass", "fail"] },
  },
});

const TRANSITION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["when", "action"],
  properties: {
    when: CONDITION_SCHEMA,
    action: { type: "string", enum: ["advance", "retry", "back", "stop"] },
    target: { type: "string", pattern: STAGE_ID_PATTERN },
    reason: { type: "string", minLength: 1 },
  },
});

const STAGE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id", "steps"],
  properties: {
    id: { type: "string", pattern: STAGE_ID_PATTERN },
    steps: { type: "array", minItems: 1, items: STEP_SCHEMA },
    max_passes: { type: "integer", minimum: 1 },
    transitions: { type: "array", minItems: 1, items: TRANSITION_SCHEMA },
    // The stage mini-loop. Absent ⇒ single pass, auto-advance (no verdict).
    advance: {
      type: "object",
      additionalProperties: false,
      required: ["verdict_role", "max_passes"],
      properties: {
        // Which role's verdict routes this stage (must appear in steps).
        verdict_role: { type: "string", enum: ROLES },
        // Finite per-stage pass ceiling (under the global max_iterations rail).
        max_passes: { type: "integer", minimum: 1 },
        // The ONE earlier stage this stage's verdict may jump back to
        // (e.g. code review flagging "plan-flawed"). Absent ⇒ no back-jumps.
        allow_jump_to: { type: "string", pattern: STAGE_ID_PATTERN },
      },
    },
    // Gate-shaped stage criterion (tdd-fix): the stage advances only when the
    // objective gate reports this result. "fail" = red-first reproduction.
    gate_expectation: { type: "string", enum: ["pass", "fail"] },
    // Declared worktree artifact the stage produces/reviews (e.g. PLAN.md).
    // Reviewed as a FILE; only its hash ever enters records.
    artifact: {
      type: "object",
      additionalProperties: false,
      required: ["path", "kind"],
      properties: {
        path: { type: "string", pattern: SAFE_REL_PATH_PATTERN },
        kind: { type: "string", enum: ["plan", "brief", "notes"] },
      },
    },
  },
});

export const CHAIN_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "description",
    "task_class",
    "stages",
    "requires_objective_gate",
    "default_max_iterations",
  ],
  properties: {
    id: { type: "string", pattern: CHAIN_ID_PATTERN },
    description: { type: "string", minLength: 1 },
    task_class: { type: "string", enum: TASK_CLASSES },
    stages: { type: "array", minItems: 1, items: STAGE_SCHEMA },
    requires_objective_gate: { const: true },
    default_max_iterations: { type: "integer", minimum: 1 },
  },
});

export const CHAIN_REGISTRY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "chains"],
  properties: {
    schema_version: { type: "integer", enum: [2, 3] },
    chains: { type: "array", minItems: 1, items: CHAIN_SCHEMA },
  },
});

function semanticError(path, message) {
  return { path, message };
}

function errorsToDetail(errors) {
  return errors.map((error) => `${error.path} ${error.message}`).join("; ");
}

export function validateChainRegistry(registry) {
  const structural = validate(CHAIN_REGISTRY_SCHEMA, registry, "$");
  const errors = [...structural.errors];
  if (!structural.valid) return { valid: false, errors };

  const seenChains = new Set();
  registry.chains.forEach((chain, chainIndex) => {
    const path = `$.chains[${chainIndex}]`;
    if (seenChains.has(chain.id)) errors.push(semanticError(`${path}.id`, `duplicate chain id '${chain.id}'`));
    seenChains.add(chain.id);
    if (!Number.isSafeInteger(chain.default_max_iterations)
      || chain.default_max_iterations > MAX_ITERATIONS) {
      errors.push(semanticError(`${path}.default_max_iterations`,
        `must be a safe integer no greater than ${MAX_ITERATIONS}`));
    }

    const stageIds = [];
    chain.stages.forEach((stage, stageIndex) => {
      const stagePath = `${path}.stages[${stageIndex}]`;
      if (stageIds.includes(stage.id)) {
        errors.push(semanticError(`${stagePath}.id`, `duplicate stage id '${stage.id}'`));
      }

      const roleSteps = [];
      const stepIds = new Set();
      stage.steps.forEach((step, stepIndex) => {
        const stepPath = `${stagePath}.steps[${stepIndex}]`;
        if (stepIds.has(step.id)) {
          errors.push(semanticError(`${stepPath}.id`, `duplicate step id '${step.id}'`));
        }
        stepIds.add(step.id);
        if (step.kind === "role" && !step.role) {
          errors.push(semanticError(`${stepPath}.role`, "role steps must declare a role"));
        }
        if (step.kind !== "role" && step.role) {
          errors.push(semanticError(`${stepPath}.role`, "non-role steps must not declare a role"));
        }
        if (step.kind === "role" && step.note != null) {
          errors.push(semanticError(`${stepPath}.note`, "role steps must not declare a note"));
        }
        if (step.kind !== "role" && !step.note) {
          errors.push(semanticError(`${stepPath}.note`, "non-role steps must declare a note"));
        }
        if (step.kind === "role" && step.role) {
          if (roleSteps.includes(step.role)) errors.push(semanticError(`${stepPath}.role`, `duplicate stage role '${step.role}'`));
          roleSteps.push(step.role);
        }
      });
      if (stageStepSchedule(stage) == null) {
        errors.push(semanticError(`${stagePath}.steps`, "must use executable candidate/check/verifier/handoff ordering"));
      }

      if (stage.advance) {
        if (!Number.isSafeInteger(stage.advance.max_passes)
          || stage.advance.max_passes > MAX_ITERATIONS) {
          errors.push(semanticError(`${stagePath}.advance.max_passes`,
            `must be a safe integer no greater than ${MAX_ITERATIONS}`));
        }
        // The verdict role must actually participate in the stage.
        if (!roleSteps.includes(stage.advance.verdict_role)) {
          errors.push(semanticError(`${stagePath}.advance.verdict_role`,
            `verdict role '${stage.advance.verdict_role}' is not a role step of stage '${stage.id}'`));
        }
        // Back-jumps may only target an EARLIER stage (termination guarantee:
        // no forward/self jump cycles beyond the budgets).
        const target = stage.advance.allow_jump_to;
        if (target != null && !stageIds.includes(target)) {
          errors.push(semanticError(`${stagePath}.advance.allow_jump_to`,
            `jump target '${target}' is not an earlier stage of chain '${chain.id}'`));
        }
      }
      if (registry.schema_version === 3) {
        if (stage.advance || stage.gate_expectation) {
          errors.push(semanticError(stagePath, "schema v3 stages use transitions, not legacy advance/gate_expectation"));
        }
        if (!Number.isSafeInteger(stage.max_passes) || stage.max_passes < 1 || stage.max_passes > MAX_ITERATIONS) {
          errors.push(semanticError(`${stagePath}.max_passes`, `must be between 1 and ${MAX_ITERATIONS}`));
        }
        if (!Array.isArray(stage.transitions) || stage.transitions.length === 0) {
          errors.push(semanticError(`${stagePath}.transitions`, "must not be empty"));
        }
        let alwaysSeen = false;
        let verdictRole = null;
        const seenConditions = new Set();
        for (let transitionIndex = 0; transitionIndex < (stage.transitions ?? []).length; transitionIndex += 1) {
          const transition = stage.transitions[transitionIndex];
          const transitionPath = `${stagePath}.transitions[${transitionIndex}]`;
          const condition = transition.when;
          if (alwaysSeen) errors.push(semanticError(transitionPath, "is unreachable after an always condition"));
          if (condition.type === "always") {
            alwaysSeen = true;
            if (condition.role != null || condition.is != null) errors.push(semanticError(`${transitionPath}.when`, "always has no role or value"));
          } else if (condition.type === "verdict") {
            if (!roleSteps.includes(condition.role) || !STAGE_ROLES.candidate.includes(condition.role)
              || !["approve", "revise", "revise-jump"].includes(condition.is)) {
              errors.push(semanticError(`${transitionPath}.when`, "verdict requires a participating role and verdict value"));
            }
            if (ROLES.includes(condition.role)) {
              if (verdictRole == null) verdictRole = condition.role;
              else if (condition.role !== verdictRole) {
                errors.push(semanticError(`${transitionPath}.when.role`, `all verdict transitions must use role '${verdictRole}'`));
              }
            }
          } else if (condition.type === "gate") {
            if (condition.role != null || !["pass", "fail"].includes(condition.is)) {
              errors.push(semanticError(`${transitionPath}.when`, "gate requires is=pass|fail and no role"));
            }
          }
          const conditionKey = JSON.stringify(condition);
          if (seenConditions.has(conditionKey)) errors.push(semanticError(`${transitionPath}.when`, "duplicates an earlier condition"));
          seenConditions.add(conditionKey);
          if (transition.action === "back") {
            if (!stageIds.includes(transition.target)) errors.push(semanticError(`${transitionPath}.target`, "must name an earlier stage"));
          } else if (transition.target != null) {
            errors.push(semanticError(`${transitionPath}.target`, "is allowed only for back"));
          }
          if (transition.action === "stop") {
            if (!isPublicCode(transition.reason)) errors.push(semanticError(`${transitionPath}.reason`, "must be a stable public code"));
          } else if (transition.reason != null) {
            errors.push(semanticError(`${transitionPath}.reason`, "is allowed only for stop"));
          }
        }
        const verdicts = new Set((stage.transitions ?? []).filter((entry) => entry.when.type === "verdict").map((entry) => entry.when.is));
        const gates = new Set((stage.transitions ?? []).filter((entry) => entry.when.type === "gate").map((entry) => entry.when.is));
        if (verdicts.size > 0 && gates.size > 0) {
          errors.push(semanticError(`${stagePath}.transitions`, "must use one condition family per stage"));
        }
        if (!alwaysSeen) {
          if (verdicts.size > 0 && ["approve", "revise", "revise-jump"].some((value) => !verdicts.has(value))) {
            errors.push(semanticError(`${stagePath}.transitions`, "must cover every verdict or end with always"));
          }
          if (gates.size > 0 && ["pass", "fail"].some((value) => !gates.has(value))) {
            errors.push(semanticError(`${stagePath}.transitions`, "must cover both gate results or end with always"));
          }
        }
      } else if (stage.transitions || stage.max_passes) {
        errors.push(semanticError(stagePath, "schema v2 stages cannot use workflow transitions"));
      }
      if (stage.advance && stage.gate_expectation) {
        errors.push(semanticError(`${stagePath}`,
          "a stage advances by verdict OR by gate_expectation, not both"));
      }
      if (stage.artifact && !isSafeWorktreeFilePath(stage.artifact.path)) {
        errors.push(semanticError(`${stagePath}.artifact.path`, "must be a contained repo-relative path"));
      }

      stageIds.push(stage.id);
    });
  });

  return { valid: errors.length === 0, errors };
}

export function assertChainRegistry(registry, label = "chain-registry") {
  const { valid, errors } = validateChainRegistry(registry);
  if (!valid) throw new SchemaError(label, errors);
  return registry;
}

export function resolveChain(registry, id) {
  const valid = validateChainRegistry(registry);
  if (!valid.valid) {
    return { ok: false, code: "invalid-chain-registry", detail: errorsToDetail(valid.errors), chain: null };
  }
  const chain = registry.chains.find((entry) => entry.id === id);
  if (!chain) return { ok: false, code: "unknown-chain", detail: id, chain: null };
  return {
    ok: true,
    chain: Object.freeze({
      ...chain,
      stages: chain.stages.map((stage) => Object.freeze({
        ...stage,
        steps: stage.steps.map((step) => Object.freeze({ ...step })),
        ...(stage.transitions?.some((transition) => transition.when.type === "verdict") ? {
          // Read-only v2 projection for old callers. V3 transitions remain the
          // authored/runtime authority and are evaluated first by the machine.
          advance: Object.freeze({
            verdict_role: stage.transitions.find((transition) => transition.when.type === "verdict").when.role,
            max_passes: stage.max_passes,
            ...(stage.transitions.find((transition) => transition.action === "back")?.target
              ? { allow_jump_to: stage.transitions.find((transition) => transition.action === "back").target }
              : {}),
          }),
        } : {}),
        ...(stage.transitions?.find((transition) => transition.when.type === "gate" && transition.action === "advance") ? {
          gate_expectation: stage.transitions.find((transition) => transition.when.type === "gate" && transition.action === "advance").when.is,
        } : {}),
        ...(stage.advance ? { advance: Object.freeze({ ...stage.advance }) } : {}),
        ...(stage.transitions ? { transitions: Object.freeze(stage.transitions.map((transition) => Object.freeze({
          ...transition,
          when: Object.freeze({ ...transition.when }),
        }))) } : {}),
        ...(stage.artifact ? { artifact: Object.freeze({ ...stage.artifact }) } : {}),
      })),
    }),
  };
}

/** Every role that appears in any stage of the chain (deduped, in order). */
export function chainRoles(chain) {
  const roles = [];
  for (const stage of chain?.stages ?? []) {
    for (const step of stage.steps) {
      if (step.kind === "role" && step.role && !roles.includes(step.role)) roles.push(step.role);
    }
  }
  return roles;
}
