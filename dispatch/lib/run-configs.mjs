// Helix dispatch — named run config registry.
//
// Run configs are the daily-use entrypoint defaults: a named chain, a role
// matrix, the one iteration rail, a deterministic objective gate, and optional
// bounded parallelism. They are data, not slash commands. There is no cost
// control and no live flag: a config naming real providers is live as-is
// (presence = live; spend is the backend control instance's job).

import { validate, SchemaError } from "./schema.mjs";
import { ASSIGNMENT_SCHEMA, validateAssignment } from "./presets.mjs";
import { MAX_ITERATIONS, MAX_PANEL_MEMBERS } from "./limits.mjs";
import { INPUT_REF_VALUE_PATTERNS, REF_PATTERN } from "./public-values.mjs";
import { isSafeWorktreeFilePath } from "./persistence.mjs";

const CONFIG_ID_PATTERN = "^[a-z0-9][a-z0-9._:-]*$";
const SAFE_REL_PATH_PATTERN = "^[A-Za-z0-9._/-]+$";

const FILE_CONTAINS_GATE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["type", "path", "contains"],
  properties: {
    type: { const: "file-contains" },
    path: { type: "string", pattern: SAFE_REL_PATH_PATTERN, maxLength: 256 },
    contains: { type: "string", minLength: 1, maxLength: 256 },
  },
});

const COMMAND_GATE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["type", "command", "args", "timeout_ms"],
  properties: {
    type: { const: "command-exit-zero" },
    command: { type: "string", minLength: 1, maxLength: 128 },
    args: {
      type: "array",
      maxItems: 32,
      items: { type: "string", maxLength: 256 },
    },
    timeout_ms: { type: "integer", minimum: 1_000, maximum: 10 * 60 * 1_000 },
  },
});

export const OBJECTIVE_GATE_SCHEMA = Object.freeze({
  anyOf: [FILE_CONTAINS_GATE_SCHEMA, COMMAND_GATE_SCHEMA],
});

export const RUN_CONFIG_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "description",
    "chain",
    "role_matrix",
    "max_iterations",
    "objective_gate",
    "run_target",
    "claims_ref",
    "evidence_ref",
  ],
  properties: {
    id: { type: "string", pattern: CONFIG_ID_PATTERN, maxLength: 64 },
    description: { type: "string", minLength: 1, maxLength: 512 },
    chain: { type: "string", pattern: CONFIG_ID_PATTERN, maxLength: 64 },
    role_matrix: { type: "string", pattern: CONFIG_ID_PATTERN, maxLength: 64 },
    max_iterations: { type: "integer", minimum: 1, maximum: MAX_ITERATIONS },
    // Per-stage casts: stage-id → composite or plain model. Keys and
    // values are validated semantically below (the dependency-free validator
    // has no schema-valued additionalProperties).
    assignments: { type: "object" },
    // Fallback executor for unassigned stages.
    default_assignment: { type: "object" },
    objective_gate: OBJECTIVE_GATE_SCHEMA,
    parallel: {
      type: "object",
      additionalProperties: false,
      required: ["max_concurrency"],
      properties: {
        max_concurrency: { type: "integer", minimum: 1, maximum: MAX_PANEL_MEMBERS },
      },
    },
    run_target: {
      type: "object",
      additionalProperties: false,
      required: ["repo"],
      properties: {
        repo: { type: "string", enum: ["self", "other"] },
        ref: { type: "string", minLength: 1, maxLength: 256 },
      },
    },
    input_refs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "value", "algorithm"],
        properties: {
          kind: { type: "string", enum: ["sha256", "redacted-id", "local-ref"] },
          value: { type: "string", minLength: 1, maxLength: 512 },
          algorithm: { anyOf: [{ type: "string", enum: ["sha256"] }, { type: "null" }] },
        },
      },
    },
    claims_ref: { type: "string", pattern: REF_PATTERN, maxLength: 512 },
    evidence_ref: { type: "string", pattern: REF_PATTERN, maxLength: 512 },
  },
});

export const RUN_CONFIG_REGISTRY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "configs"],
  properties: {
    schema_version: { const: 2 },
    configs: { type: "array", minItems: 1, items: RUN_CONFIG_SCHEMA },
  },
});

function semanticError(path, message) {
  return { path, message };
}

function errorsToDetail(errors) {
  return errors.map((error) => `${error.path} ${error.message}`).join("; ");
}

export function validateRunConfigRegistry(registry) {
  const structural = validate(RUN_CONFIG_REGISTRY_SCHEMA, registry, "$");
  const errors = [...structural.errors];
  if (!structural.valid) return { valid: false, errors };

  const STAGE_KEY = /^[a-z][a-z0-9-]*$/;
  const seen = new Set();
  registry.configs.forEach((config, index) => {
    const path = `$.configs[${index}]`;
    if (seen.has(config.id)) errors.push(semanticError(`${path}.id`, `duplicate run config id '${config.id}'`));
    seen.add(config.id);

    if (config.objective_gate.type === "file-contains" && !isSafeWorktreeFilePath(config.objective_gate.path)) {
      errors.push(semanticError(`${path}.objective_gate.path`, "must be a safe repo-relative path"));
    }
    if (config.objective_gate.type === "command-exit-zero") {
      const command = config.objective_gate.command;
      const commandSafe = typeof command === "string" && !command.includes("\0")
        && (/^[A-Za-z0-9][A-Za-z0-9._@+-]*$/.test(command)
          || (/^\.\/[A-Za-z0-9._@+/-]+$/.test(command) && isSafeWorktreeFilePath(command.slice(2))));
      if (!commandSafe) {
        errors.push(semanticError(`${path}.objective_gate.command`, "must be an executable name or safe ./repo-relative path"));
      }
      if (config.objective_gate.args.some((arg) => arg.includes("\0"))) {
        errors.push(semanticError(`${path}.objective_gate.args`, "must not contain NUL bytes"));
      }
    }

    if (config.assignments != null) {
      for (const [stageId, assignment] of Object.entries(config.assignments)) {
        if (!STAGE_KEY.test(stageId) || stageId.length > 64) {
          errors.push(semanticError(`${path}.assignments.${stageId}`, "assignment keys must be stage ids"));
        }
        const shape = validateAssignment(assignment);
        if (!shape.valid) {
          errors.push(semanticError(`${path}.assignments.${stageId}`, "must be a composite or plain-model assignment"));
        }
      }
    }
    if (config.default_assignment != null && !validateAssignment(config.default_assignment).valid) {
      errors.push(semanticError(`${path}.default_assignment`, "must be a composite or plain-model assignment"));
    }
    for (let inputIndex = 0; inputIndex < (config.input_refs ?? []).length; inputIndex += 1) {
      const ref = config.input_refs[inputIndex];
      const pattern = INPUT_REF_VALUE_PATTERNS[ref.kind];
      const expectedAlgorithm = ref.kind === "sha256" ? "sha256" : null;
      if (!pattern?.test(ref.value) || ref.algorithm !== expectedAlgorithm) {
        errors.push(semanticError(`${path}.input_refs[${inputIndex}]`, "must be a field-specific ref/hash"));
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

export function validateRunConfig(config) {
  return validateRunConfigRegistry({ schema_version: 2, configs: [config] });
}

export function assertRunConfigRegistry(registry, label = "run-config-registry") {
  const { valid, errors } = validateRunConfigRegistry(registry);
  if (!valid) throw new SchemaError(label, errors);
  return registry;
}

export function resolveRunConfig(registry, id) {
  const valid = validateRunConfigRegistry(registry);
  if (!valid.valid) {
    return { ok: false, code: "invalid-run-config-registry", detail: errorsToDetail(valid.errors), config: null };
  }
  const config = registry.configs.find((entry) => entry.id === id);
  if (!config) return { ok: false, code: "unknown-run-config", detail: "config-id-not-found", config: null };
  return { ok: true, config: Object.freeze({ ...config }) };
}
