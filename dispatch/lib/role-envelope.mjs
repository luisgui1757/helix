// Prime dispatch — role envelope schema + fail-closed runtime validation.
//
// Source of truth: fusion-dispatch-research.md §"Role Schema". Every role output
// (candidate, judge, synthesis, verification) MUST conform to this envelope, and
// malformed provider/model output MUST be rejected here — before it can reach
// judge or synthesis. The schema descriptor is JSON-Schema shaped (portable to
// TypeBox); see schema.mjs for why the validator is dependency-free.

import { validate, assertValid, SchemaError } from "./schema.mjs";
import { PRIME_PROVIDERS } from "./providers.mjs";
import { INPUT_REF_VALUE_PATTERNS, MODEL_ID_PATTERN, REF_PATTERN, isModelId } from "./public-values.mjs";

/** Canonical roles (stable log/test identifiers, never cosmetic callsigns). */
export const ROLES = Object.freeze([
  "scout",
  "planner",
  "builder",
  "reviewer",
  "redteam",
  "judge",
  "synthesizer",
  "verifier",
  "documenter",
]);

/** Pipeline stages. */
export const STAGES = Object.freeze(["candidate", "judge", "synthesis", "verification"]);

/** Which roles are valid in which stage (spec §"Role/stage validity"). */
export const STAGE_ROLES = Object.freeze({
  candidate: Object.freeze(["scout", "planner", "builder", "reviewer", "redteam", "documenter"]),
  judge: Object.freeze(["judge"]),
  synthesis: Object.freeze(["synthesizer"]),
  verification: Object.freeze(["verifier", "documenter"]),
});

const STATUSES = ["ok", "blocked", "failed", "refused", "timeout"];
const INPUT_REF_KINDS = ["sha256", "redacted-id", "local-ref"];

const stringArray = { type: "array", items: { type: "string" } };

/**
 * The role envelope schema, in JSON-Schema shape (drop-in for TypeBox
 * `Type.Object`). additionalProperties:false makes the envelope fail closed on
 * unexpected fields from a malformed provider payload.
 */
export const ROLE_ENVELOPE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version", "run_id", "stage", "role", "provider", "model",
    "usage", "attempt", "iteration", "input_ref", "claims_ref", "evidence_ref",
    "uncertainty", "risks", "recommendation", "proposed_actions", "open_questions", "status",
  ],
  properties: {
    schema_version: { const: 2 },
    run_id: { type: "string", minLength: 1 },
    stage: { type: "string", enum: STAGES },
    role: { type: "string", enum: ROLES },
    provider: { type: "string", enum: PRIME_PROVIDERS },
    model: { type: "string", pattern: MODEL_ID_PATTERN },
    // Token counts are CAPACITY telemetry (context-pressure cues), not spend
    // accounting — Prime performs no cost control (backend billing owns spend).
    usage: {
      type: "object",
      additionalProperties: false,
      required: ["input_tokens", "output_tokens"],
      properties: {
        input_tokens: { type: "integer", minimum: 0 },
        output_tokens: { type: "integer", minimum: 0 },
      },
    },
    attempt: { type: "integer", minimum: 1 },
    iteration: { type: "integer", minimum: 1 },
    input_ref: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value", "algorithm"],
      properties: {
        kind: { type: "string", enum: INPUT_REF_KINDS },
        value: { type: "string", minLength: 1 },
        algorithm: { anyOf: [{ type: "string", enum: ["sha256"] }, { type: "null" }] },
      },
    },
    claims_ref: { type: "string", pattern: REF_PATTERN },
    evidence_ref: { type: "string", pattern: REF_PATTERN },
    uncertainty: stringArray,
    risks: stringArray,
    recommendation: { type: "string" },
    proposed_actions: stringArray,
    open_questions: stringArray,
    status: { type: "string", enum: STATUSES },
  },
});

/** Whether `role` is valid in `stage`. */
export function isRoleValidForStage(stage, role) {
  const allowed = STAGE_ROLES[stage];
  return Array.isArray(allowed) && allowed.includes(role);
}

/**
 * Validate a role envelope: structural schema first, then role/stage validity.
 * Both checks must pass. Returns a structured result (never throws).
 * @param {unknown} value
 * @returns {{ valid: boolean, errors: Array<{path:string,message:string}>, envelope: object|null }}
 */
export function validateRoleEnvelope(value) {
  const structural = validate(ROLE_ENVELOPE_SCHEMA, value, "$");
  const errors = [...structural.errors];
  // Role/stage cross-check only runs once the fields are structurally present.
  if (structural.valid && !isRoleValidForStage(value.stage, value.role)) {
    errors.push({
      path: "$.role",
      message: `role '${value.role}' is not allowed in stage '${value.stage}'`,
    });
  }
  if (structural.valid && !isModelId(value.model)) {
    errors.push({ path: "$.model", message: "must be a model id, not a URI or path" });
  }
  if (structural.valid) {
    const pattern = INPUT_REF_VALUE_PATTERNS[value.input_ref.kind];
    const expectedAlgorithm = value.input_ref.kind === "sha256" ? "sha256" : null;
    if (!pattern?.test(value.input_ref.value) || value.input_ref.algorithm !== expectedAlgorithm) {
      errors.push({ path: "$.input_ref", message: "must be a field-specific ref/hash" });
    }
  }
  return { valid: errors.length === 0, errors, envelope: errors.length === 0 ? value : null };
}

/**
 * Fail-closed assertion used before judge/synthesis: throws SchemaError when the
 * envelope is malformed or the role/stage pairing is invalid.
 * @param {unknown} value
 * @param {string} [label]
 * @returns {object} the validated envelope
 */
export function assertRoleEnvelope(value, label = "role-envelope") {
  const { valid, errors } = validateRoleEnvelope(value);
  if (!valid) throw new SchemaError(label, errors);
  return value;
}

export { assertValid };
