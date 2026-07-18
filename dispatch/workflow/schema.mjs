// WorkflowDefinition v4 — the closed, provider-neutral workflow IR.
//
// The v4 document is the only user-deployable runtime definition. Existing
// schema-v1 workflow documents are accepted as migration input and normalized
// into this shape before validation, hashing, consent, persistence, or run.
// Runtime code never evaluates user JavaScript or expressions.

import { createHash } from "node:crypto";
import { isSafeWorktreeFilePath } from "../lib/persistence.mjs";
import { isPublicCode } from "../lib/public-values.mjs";
import { ROLES } from "../lib/role-envelope.mjs";

const ID = /^[a-z0-9][a-z0-9._-]*$/;
const NODE_ID = /^[a-z][a-z0-9-]*$/;
export const WORKFLOW_LIMITS = Object.freeze({
  max_id_length: 64,
  max_name_length: 128,
  max_description_length: 1_024,
  max_version: 1_000_000,
  max_workflow_bytes: 256 * 1024,
  max_nodes: 256,
  max_inline_stages: 16,
  max_transitions: 16,
  max_condition_depth: 32,
  max_condition_width: 8,
  max_pointer_length: 512,
  max_pointer_segment_length: 128,
  max_input_depth: 4,
  max_input_bytes: 1024 * 1024,
  max_input_fields: 32,
  max_input_description_length: 256,
  max_input_string_length: 65_536,
  max_prompt_length: 16_384,
  max_agent_tools: 16,
  max_retry_attempts: 3,
  max_retry_backoff_ms: 60_000,
  max_total_effects: 1_000,
  max_concurrency: 16,
  max_map_items: 256,
  max_run_ms: 8 * 60 * 60 * 1000,
  max_call_ms: 60 * 60 * 1000,
  max_parallel_branches: 64,
  max_failure_codes: 16,
  max_node_visits: 32,
  max_implicit_node_visits: 1_256,
  max_reduce_separator_length: 32,
  max_checkpoint_reason_length: 128,
  max_gate_marker_length: 256,
  max_gate_command_length: 128,
  max_gate_args: 32,
  max_gate_arg_length: 256,
  max_gate_timeout_ms: 10 * 60 * 1000,
  max_structured_repair_attempts: 2,
  max_canonical_depth: 64,
  max_canonical_bytes: 2 * 1024 * 1024,
});
const {
  max_workflow_bytes: MAX_WORKFLOW_BYTES,
  max_nodes: MAX_NODES,
  max_inline_stages: MAX_INLINE_STAGES,
  max_transitions: MAX_TRANSITIONS,
  max_condition_depth: MAX_CONDITION_DEPTH,
  max_input_depth: MAX_INPUT_DEPTH,
  max_input_bytes: MAX_INPUT_BYTES,
  max_total_effects: MAX_TOTAL_EFFECTS,
  max_concurrency: MAX_CONCURRENCY,
  max_map_items: MAX_MAP_ITEMS,
  max_run_ms: MAX_RUN_MS,
  max_call_ms: MAX_CALL_MS,
} = WORKFLOW_LIMITS;

export const WORKFLOW_SCHEMA_VERSION = 4;
export const WORKFLOW_DEFAULTS = Object.freeze({
  max_total_effects: 32,
  max_concurrency: 4,
  max_map_items: 16,
  max_run_ms: 30 * 60 * 1000,
  max_call_ms: 10 * 60 * 1000,
  max_visits: 3,
  structured_repair_attempts: 2,
});

export const WORKFLOW_NODE_KINDS = Object.freeze([
  "agent", "parallel", "map", "pipeline", "reduce",
  "decision", "gate", "checkpoint", "subworkflow", "terminal",
]);

const MUTATING_ROLES = new Set(["planner", "builder", "documenter"]);
const isSafeWorkflowPath = isSafeWorktreeFilePath;

function issue(path, message) {
  return { path, message };
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  if (!plain(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function safeId(value, pattern = ID, max = WORKFLOW_LIMITS.max_id_length) {
  return typeof value === "string" && value.length <= max && pattern.test(value);
}

function safeInteger(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function stable(value) {
  const output = [];
  let bytes = 0;
  const append = (text) => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > WORKFLOW_LIMITS.max_canonical_bytes) return false;
    output.push(text);
    return true;
  };
  const stack = [{ kind: "value", value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.kind === "text") {
      if (!append(current.value)) return null;
      continue;
    }
    if (current.depth > WORKFLOW_LIMITS.max_canonical_depth) return null;
    if (current.value === null || typeof current.value === "string" || typeof current.value === "boolean"
      || (typeof current.value === "number" && Number.isFinite(current.value))) {
      if (!append(JSON.stringify(current.value))) return null;
      continue;
    }
    if (Array.isArray(current.value)) {
      stack.push({ kind: "text", value: "]" });
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ kind: "value", value: Object.hasOwn(current.value, index) ? current.value[index] : null, depth: current.depth + 1 });
        if (index > 0) stack.push({ kind: "text", value: "," });
      }
      stack.push({ kind: "text", value: "[" });
      continue;
    }
    if (plain(current.value)) {
      const keys = Object.keys(current.value).sort();
      stack.push({ kind: "text", value: "}" });
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        stack.push({ kind: "value", value: current.value[key], depth: current.depth + 1 });
        stack.push({ kind: "text", value: ":" });
        stack.push({ kind: "text", value: JSON.stringify(key) });
        if (index > 0) stack.push({ kind: "text", value: "," });
      }
      stack.push({ kind: "text", value: "{" });
      continue;
    }
    return null;
  }
  return output.join("");
}

function pointerSegments(pointer) {
  if (pointer === "") return [];
  if (typeof pointer !== "string" || !pointer.startsWith("/") || pointer.length > WORKFLOW_LIMITS.max_pointer_length) return null;
  const parts = pointer.slice(1).split("/");
  if (parts.some((part) => part === "" || part.length > WORKFLOW_LIMITS.max_pointer_segment_length || /~(?![01])/.test(part))) return null;
  return parts.map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function validateInputSchema(schema, path, errors, depth = 0, { root = false } = {}) {
  if (!plain(schema) || depth > MAX_INPUT_DEPTH || typeof schema.type !== "string") {
    errors.push(issue(path, depth > MAX_INPUT_DEPTH ? "exceeds maximum input schema depth 4" : "must be a supported input schema"));
    return;
  }
  const common = ["type", "description", "default"];
  if (schema.description != null && (typeof schema.description !== "string"
    || schema.description.length > WORKFLOW_LIMITS.max_input_description_length)) {
    errors.push(issue(`${path}.description`, "must be a bounded string"));
  }
  if (schema.type === "object") {
    if (!exactKeys(schema, ["type", "additionalProperties", "required", "properties"], ["description", "default"])
      || schema.additionalProperties !== false || !plain(schema.properties)
      || Object.keys(schema.properties).length > WORKFLOW_LIMITS.max_input_fields || !Array.isArray(schema.required)
      || new Set(schema.required).size !== schema.required.length
      || schema.required.some((key) => !safeId(key, ID, WORKFLOW_LIMITS.max_id_length) || !Object.hasOwn(schema.properties, key))) {
      errors.push(issue(path, "must be a closed object schema with unique declared required fields"));
      return;
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!safeId(key, ID, WORKFLOW_LIMITS.max_id_length)) errors.push(issue(`${path}.properties.${key}`, "property name must be safe"));
      validateInputSchema(child, `${path}.properties.${key}`, errors, depth + 1);
    }
    if (root && (!schema.required.includes("task") || schema.properties.task?.type !== "string"
      || (schema.properties.task.minLength ?? 0) < 1)) {
      errors.push(issue(path, "root input schema must require a non-empty string task field"));
    }
  } else if (schema.type === "string") {
    if (!exactKeys(schema, ["type"], [...common.slice(1), "minLength", "maxLength"])
      || (schema.minLength != null && !safeInteger(schema.minLength, 0, WORKFLOW_LIMITS.max_input_string_length))
      || (schema.maxLength != null && !safeInteger(schema.maxLength, 1, WORKFLOW_LIMITS.max_input_string_length))
      || (schema.minLength ?? 0) > (schema.maxLength ?? WORKFLOW_LIMITS.max_input_string_length)) {
      errors.push(issue(path, "must be a bounded string schema"));
    }
  } else if (["number", "integer"].includes(schema.type)) {
    if (!exactKeys(schema, ["type"], [...common.slice(1), "minimum", "maximum"])
      || (schema.minimum != null && !Number.isFinite(schema.minimum))
      || (schema.maximum != null && !Number.isFinite(schema.maximum))
      || (schema.minimum ?? Number.NEGATIVE_INFINITY) > (schema.maximum ?? Number.POSITIVE_INFINITY)) {
      errors.push(issue(path, "must be a bounded numeric schema"));
    }
  } else if (schema.type === "boolean") {
    if (!exactKeys(schema, ["type"], common.slice(1))) errors.push(issue(path, "must be a boolean schema"));
  } else if (schema.type === "array") {
    if (!exactKeys(schema, ["type", "items"], [...common.slice(1), "minItems", "maxItems"])
      || (schema.minItems != null && !safeInteger(schema.minItems, 0, MAX_MAP_ITEMS))
      || (schema.maxItems != null && !safeInteger(schema.maxItems, 0, MAX_MAP_ITEMS))
      || (schema.minItems ?? 0) > (schema.maxItems ?? MAX_MAP_ITEMS)) {
      errors.push(issue(path, "must be a bounded array schema"));
      return;
    }
    validateInputSchema(schema.items, `${path}.items`, errors, depth + 1);
  } else {
    errors.push(issue(`${path}.type`, "must be object, array, string, number, integer, or boolean"));
  }
  if (Object.hasOwn(schema, "default")) {
    const checked = validateInputValue(schema, schema.default, path, depth);
    errors.push(...checked);
  }
}

function validateInputValue(schema, value, path = "$", depth = 0) {
  const errors = [];
  if (!plain(schema) || depth > MAX_INPUT_DEPTH) return [issue(path, "does not match the declared input schema")];
  if (schema.type === "object") {
    if (!plain(value)) return [issue(path, "must be an object")];
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(issue(`${path}.${key}`, "is required"));
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(issue(`${path}.${key}`, "is not an allowed input"));
      else errors.push(...validateInputValue(schema.properties[key], value[key], `${path}.${key}`, depth + 1));
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? WORKFLOW_LIMITS.max_input_string_length)) {
      errors.push(issue(path, "must be a string within declared length bounds"));
    }
  } else if (schema.type === "number") {
    if (!Number.isFinite(value) || value < (schema.minimum ?? Number.NEGATIVE_INFINITY)
      || value > (schema.maximum ?? Number.POSITIVE_INFINITY)) errors.push(issue(path, "must be a finite number within declared bounds"));
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? Number.MIN_SAFE_INTEGER)
      || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)) errors.push(issue(path, "must be a safe integer within declared bounds"));
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") errors.push(issue(path, "must be boolean"));
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? MAX_MAP_ITEMS)) {
      errors.push(issue(path, "must be an array within declared cardinality bounds"));
    } else value.forEach((entry, index) => errors.push(...validateInputValue(schema.items, entry, `${path}[${index}]`, depth + 1)));
  } else {
    errors.push(issue(path, "uses an unsupported input type"));
  }
  return errors;
}

export function validateWorkflowInput(schema, input) {
  const errors = validateInputValue(schema, input);
  try {
    if (Buffer.byteLength(stable(input), "utf8") > MAX_INPUT_BYTES) errors.push(issue("$", "serialized input exceeds 1 MiB"));
  } catch {
    errors.push(issue("$", "must be serializable"));
  }
  return { valid: errors.length === 0, errors };
}

function applyInputDefaults(schema, value, depth = 0) {
  if (depth > MAX_INPUT_DEPTH) throw new Error("workflow-input-depth");
  if (schema.type === "object" && plain(value)) {
    const output = {};
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) output[key] = applyInputDefaults(child, value[key], depth + 1);
      else if (Object.hasOwn(child, "default")) output[key] = applyInputDefaults(child, child.default, depth + 1);
    }
    for (const key of Object.keys(value)) if (!Object.hasOwn(output, key)) output[key] = structuredClone(value[key]);
    return output;
  }
  if (schema.type === "array" && Array.isArray(value)) {
    return value.map((entry) => applyInputDefaults(schema.items, entry, depth + 1));
  }
  return structuredClone(value);
}

export function normalizeWorkflowInput(schema, input) {
  let normalized;
  try { normalized = applyInputDefaults(schema, input); }
  catch { return { valid: false, input: null, errors: [issue("$", "must be serializable within the declared input depth")] }; }
  const checked = validateWorkflowInput(schema, normalized);
  return { ...checked, input: checked.valid ? normalized : null };
}

function validateGate(gate, path, errors) {
  if (!plain(gate)) {
    errors.push(issue(path, "must be an objective gate"));
    return;
  }
  if (gate.type === "file-contains") {
    if (!exactKeys(gate, ["type", "path", "contains"])
      || !isSafeWorkflowPath(gate.path) || typeof gate.contains !== "string"
      || gate.contains.length < 1 || gate.contains.length > WORKFLOW_LIMITS.max_gate_marker_length) {
      errors.push(issue(path, "must be a bounded contained file-contains gate"));
    }
    return;
  }
  if (gate.type === "command-exit-zero") {
    if (!exactKeys(gate, ["type", "command", "args", "timeout_ms"])
      || typeof gate.command !== "string" || gate.command.length > WORKFLOW_LIMITS.max_gate_command_length
      || !Array.isArray(gate.args) || gate.args.length > WORKFLOW_LIMITS.max_gate_args
      || gate.args.some((arg) => typeof arg !== "string" || arg.length > WORKFLOW_LIMITS.max_gate_arg_length || arg.includes("\0"))
      || !safeInteger(gate.timeout_ms, 1_000, WORKFLOW_LIMITS.max_gate_timeout_ms)) {
      errors.push(issue(path, "must be a bounded argv-only command-exit-zero gate"));
    }
    return;
  }
  errors.push(issue(`${path}.type`, "must be file-contains or command-exit-zero"));
}

function validateRetry(retry, path, errors) {
  if (!exactKeys(retry, ["max_attempts", "backoff_ms"])
    || !safeInteger(retry.max_attempts, 1, WORKFLOW_LIMITS.max_retry_attempts)
    || !safeInteger(retry.backoff_ms, 0, WORKFLOW_LIMITS.max_retry_backoff_ms)) {
    errors.push(issue(path, "must contain max_attempts 1..3 and backoff_ms 0..60000"));
  }
}

function validateAgent(node, path, errors, { inline = false } = {}) {
  const required = ["kind", "role", "stage_id", "prompt", "output_schema", "tools", "mutation", "timeout_ms", "retry"];
  const optional = inline ? ["label"] : ["label", "next", "max_visits", "artifact"];
  if (!exactKeys(node, required, optional)) {
    errors.push(issue(path, "must contain only agent fields"));
    return;
  }
  if (!ROLES.includes(node.role)) errors.push(issue(`${path}.role`, "must be a known Helix role"));
  if (!safeId(node.stage_id, NODE_ID)) errors.push(issue(`${path}.stage_id`, "must be a safe stage id"));
  if (typeof node.prompt !== "string" || node.prompt.length < 1 || node.prompt.length > WORKFLOW_LIMITS.max_prompt_length) {
    errors.push(issue(`${path}.prompt`, "must be a non-empty bounded prompt template id"));
  }
  if (!plain(node.output_schema) || typeof node.output_schema.id !== "string"
    || !["semantic-v2", "verdict-v1", "freeform-v1"].includes(node.output_schema.id)
    || Object.keys(node.output_schema).some((key) => key !== "id")) {
    errors.push(issue(`${path}.output_schema`, "must name a supported closed output schema"));
  }
  const toolsValid = Array.isArray(node.tools) && node.tools.length <= WORKFLOW_LIMITS.max_agent_tools
    && new Set(node.tools).size === node.tools.length
    && node.tools.every((tool) => ["read", "grep", "find", "ls", "bash", "edit", "write"].includes(tool));
  if (!toolsValid) {
    errors.push(issue(`${path}.tools`, "must be a unique bounded tool allowlist"));
  }
  const expectedMutation = MUTATING_ROLES.has(node.role) ? "shared-serialized" : "read-only";
  if (!["read-only", "shared-serialized", "isolated-proposal"].includes(node.mutation)) {
    errors.push(issue(`${path}.mutation`, "must be read-only, shared-serialized, or isolated-proposal"));
  } else if (toolsValid && node.mutation === "read-only" && node.tools.some((tool) => ["bash", "edit", "write"].includes(tool))) {
    errors.push(issue(`${path}.tools`, "read-only agents cannot receive mutation tools"));
  } else if (expectedMutation === "read-only" && node.mutation !== "read-only") {
    errors.push(issue(`${path}.mutation`, `role '${node.role}' is not a mutating workflow role`));
  }
  if (!safeInteger(node.timeout_ms, 1_000, MAX_CALL_MS)) errors.push(issue(`${path}.timeout_ms`, "must be 1000..3600000"));
  validateRetry(node.retry, `${path}.retry`, errors);
  if (!inline && node.max_visits != null && !safeInteger(node.max_visits, 1, WORKFLOW_LIMITS.max_node_visits)) {
    errors.push(issue(`${path}.max_visits`, "must be 1..32"));
  }
  if (!inline && node.artifact != null && (!exactKeys(node.artifact, ["path", "kind"])
    || !isSafeWorkflowPath(node.artifact.path) || !["plan", "brief", "notes"].includes(node.artifact.kind))) {
    errors.push(issue(`${path}.artifact`, "must be a contained plan, brief, or notes artifact"));
  }
}

function validateCondition(condition, path, errors, depth = 0) {
  if (depth > MAX_CONDITION_DEPTH) {
    errors.push(issue(path, "exceeds maximum condition depth 32"));
    return;
  }
  if (!plain(condition) || typeof condition.op !== "string") {
    errors.push(issue(path, "must be a condition"));
    return;
  }
  if (condition.op === "always") {
    if (!exactKeys(condition, ["op"])) errors.push(issue(path, "always accepts no other fields"));
    return;
  }
  if (["eq", "neq", "lt", "lte", "gt", "gte", "contains"].includes(condition.op)) {
    if (!exactKeys(condition, ["op", "path", "value"]) || pointerSegments(condition.path) == null
      || !["string", "number", "boolean"].includes(typeof condition.value)) {
      errors.push(issue(path, "comparison requires a safe JSON pointer and scalar value"));
    }
    return;
  }
  if (["and", "or"].includes(condition.op)) {
    if (!exactKeys(condition, ["op", "conditions"]) || !Array.isArray(condition.conditions)
      || condition.conditions.length < 1 || condition.conditions.length > WORKFLOW_LIMITS.max_condition_width) {
      errors.push(issue(path, "boolean condition requires 1..8 child conditions"));
    } else condition.conditions.forEach((child, index) => validateCondition(child, `${path}.conditions[${index}]`, errors, depth + 1));
    return;
  }
  if (condition.op === "not") {
    if (!exactKeys(condition, ["op", "condition"])) errors.push(issue(path, "not requires one condition"));
    else validateCondition(condition.condition, `${path}.condition`, errors, depth + 1);
    return;
  }
  errors.push(issue(`${path}.op`, "is not a supported closed condition operator"));
}

function validateInlineAgent(agent, path, errors) {
  if (agent?.kind !== "agent") errors.push(issue(`${path}.kind`, "inline stage must be an agent"));
  else validateAgent(agent, path, errors, { inline: true });
}

function validateNode(node, id, path, errors) {
  if (!plain(node) || !WORKFLOW_NODE_KINDS.includes(node.kind)) {
    errors.push(issue(path, "must be a supported workflow node"));
    return;
  }
  if (node.kind === "agent") {
    validateAgent(node, path, errors);
    return;
  }
  if (node.kind === "pipeline") {
    if (!exactKeys(node, ["kind", "stages", "next", "max_visits"], ["label", "artifact"])
      || !Array.isArray(node.stages) || node.stages.length < 1 || node.stages.length > MAX_INLINE_STAGES) {
      errors.push(issue(path, "pipeline requires 1..16 inline agent stages, next, and max_visits"));
      return;
    }
    node.stages.forEach((stage, index) => validateInlineAgent(stage, `${path}.stages[${index}]`, errors));
    if (!safeInteger(node.max_visits, 1, WORKFLOW_LIMITS.max_node_visits)) errors.push(issue(`${path}.max_visits`, "must be 1..32"));
    if (node.artifact != null && (!exactKeys(node.artifact, ["path", "kind"])
      || !isSafeWorkflowPath(node.artifact.path) || !["plan", "brief", "notes"].includes(node.artifact.kind))) {
      errors.push(issue(`${path}.artifact`, "must be a contained plan, brief, or notes artifact"));
    }
    return;
  }
  if (node.kind === "parallel") {
    if (!exactKeys(node, ["kind", "branches", "max_concurrency", "failure", "next"], ["label", "allow_failure_codes"])
      || !Array.isArray(node.branches) || node.branches.length < 1 || node.branches.length > WORKFLOW_LIMITS.max_parallel_branches
      || !safeInteger(node.max_concurrency, 1, MAX_CONCURRENCY)
      || !["abort", "settle"].includes(node.failure)) {
      errors.push(issue(path, "parallel requires bounded agent branches, concurrency, failure, and next"));
      return;
    }
    if ((node.failure === "settle" && (!Array.isArray(node.allow_failure_codes)
      || node.allow_failure_codes.length < 1 || node.allow_failure_codes.length > WORKFLOW_LIMITS.max_failure_codes
      || new Set(node.allow_failure_codes).size !== node.allow_failure_codes.length
      || node.allow_failure_codes.some((code) => !isPublicCode(code))))
      || (node.failure === "abort" && node.allow_failure_codes != null)) {
      errors.push(issue(`${path}.allow_failure_codes`, "settle requires 1..16 unique stable allowed-failure codes; abort accepts none"));
    }
    node.branches.forEach((branch, index) => validateInlineAgent(branch, `${path}.branches[${index}]`, errors));
    return;
  }
  if (node.kind === "map") {
    if (!exactKeys(node, ["kind", "items_path", "max_items", "body", "failure", "next"], ["label", "allow_failure_codes"])
      || pointerSegments(node.items_path) == null || !safeInteger(node.max_items, 0, MAX_MAP_ITEMS)
      || !["abort", "settle"].includes(node.failure)) {
      errors.push(issue(path, "map requires a safe items_path, bounded max_items, failure, body, and next"));
      return;
    }
    if ((node.failure === "settle" && (!Array.isArray(node.allow_failure_codes)
      || node.allow_failure_codes.length < 1 || node.allow_failure_codes.length > WORKFLOW_LIMITS.max_failure_codes
      || new Set(node.allow_failure_codes).size !== node.allow_failure_codes.length
      || node.allow_failure_codes.some((code) => !isPublicCode(code))))
      || (node.failure === "abort" && node.allow_failure_codes != null)) {
      errors.push(issue(`${path}.allow_failure_codes`, "settle requires 1..16 unique stable allowed-failure codes; abort accepts none"));
    }
    validateInlineAgent(node.body, `${path}.body`, errors);
    return;
  }
  if (node.kind === "reduce") {
    if (!exactKeys(node, ["kind", "items_path", "strategy", "next"], ["separator", "label"])
      || pointerSegments(node.items_path) == null || !["collect", "count", "concat"].includes(node.strategy)
      || (node.strategy === "concat" && (typeof node.separator !== "string"
        || node.separator.length > WORKFLOW_LIMITS.max_reduce_separator_length))
      || (node.strategy !== "concat" && node.separator != null)) {
      errors.push(issue(path, "reduce requires a safe items_path and collect, count, or concat strategy"));
    }
    return;
  }
  if (node.kind === "decision") {
    if (!exactKeys(node, ["kind", "transitions", "default"], ["label", "loops_off"])
      || !Array.isArray(node.transitions) || node.transitions.length > MAX_TRANSITIONS) {
      errors.push(issue(path, "decision requires bounded transitions and default target"));
      return;
    }
    if (!exactKeys(node.default, ["target"], ["loop"])
      || (node.default.loop != null && typeof node.default.loop !== "boolean")) {
      errors.push(issue(`${path}.default`, "must contain target and optional loop"));
    }
    node.transitions.forEach((transition, index) => {
      if (!exactKeys(transition, ["when", "target"], ["loop"])) {
        errors.push(issue(`${path}.transitions[${index}]`, "must contain when, target, and optional loop"));
      } else {
        validateCondition(transition.when, `${path}.transitions[${index}].when`, errors);
        if (transition.loop != null && typeof transition.loop !== "boolean") errors.push(issue(`${path}.transitions[${index}].loop`, "must be boolean"));
      }
    });
    return;
  }
  if (node.kind === "gate") {
    if (node.final === true) {
      if (!exactKeys(node, ["kind", "on_pass", "on_fail", "final"], ["label", "loops_off"])) {
        errors.push(issue(path, "final gate requires on_pass and on_fail and cannot redefine the workflow objective gate"));
      }
      return;
    }
    if (!exactKeys(node, ["kind", "gate", "on_pass", "on_fail"], ["label", "loops_off"])) {
      errors.push(issue(path, "non-final gate requires gate, on_pass, and on_fail"));
      return;
    }
    validateGate(node.gate, `${path}.gate`, errors);
    return;
  }
  if (node.kind === "checkpoint") {
    if (!exactKeys(node, ["kind", "reason", "next"], ["label"])
      || !isPublicCode(node.reason)
      || node.reason.length > WORKFLOW_LIMITS.max_checkpoint_reason_length) errors.push(issue(path, "checkpoint requires a stable reason and next"));
    return;
  }
  if (node.kind === "subworkflow") {
    if (!exactKeys(node, ["kind", "workflow_id", "version", "next"], ["label"])
      || !safeId(node.workflow_id) || !safeInteger(node.version, 1, WORKFLOW_LIMITS.max_version)) {
      errors.push(issue(path, "subworkflow requires a safe id, pinned version, and next"));
    }
    return;
  }
  if (!exactKeys(node, ["kind", "status"], ["code", "label"])
    || !["succeeded", "failed", "refused", "cancelled"].includes(node.status)
    || (node.status !== "succeeded" && !isPublicCode(node.code))
    || (node.status === "succeeded" && node.code != null)) {
    errors.push(issue(path, "terminal must declare a valid status and failure code"));
  }
}

function nodeEdges(node) {
  if (!plain(node)) return [];
  if (["agent", "parallel", "map", "pipeline", "reduce", "checkpoint", "subworkflow"].includes(node.kind)) {
    return [{ field: "next", target: node.next }];
  }
  if (node.kind === "decision") {
    return [
      ...(Array.isArray(node.transitions)
        ? node.transitions.map((entry, index) => ({ field: `transitions[${index}].target`, target: entry?.target }))
        : []),
      { field: "default.target", target: node.default?.target },
      ...(node.loops_off == null ? [] : [{ field: "loops_off", target: node.loops_off }]),
    ];
  }
  if (node.kind === "gate") {
    return [
      { field: "on_pass", target: node.on_pass },
      { field: "on_fail", target: node.on_fail },
      ...(node.loops_off == null ? [] : [{ field: "loops_off", target: node.loops_off }]),
    ];
  }
  return [];
}

function runtimeEdges(node) {
  return nodeEdges(node).filter((edge) => edge.field !== "loops_off");
}

function reverseReachable(nodes, target) {
  const seen = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, node] of Object.entries(nodes)) {
      if (!seen.has(id) && nodeEdges(node).some((edge) => seen.has(edge.target))) {
        seen.add(id);
        changed = true;
      }
    }
  }
  return seen;
}

export function validateWorkflowDefinition(definition) {
  const errors = [];
  const required = [
    "schema_version", "id", "name", "description", "version", "source", "inputs", "start", "nodes",
    "limits", "provider_policy", "workspace_policy", "objective_gate",
  ];
  if (!exactKeys(definition, required)) {
    return { valid: false, errors: [issue("$", "must contain every WorkflowDefinition v4 field and no unknown fields")] };
  }
  if (definition.schema_version !== WORKFLOW_SCHEMA_VERSION) errors.push(issue("$.schema_version", "must equal 4"));
  if (!safeId(definition.id)) errors.push(issue("$.id", "must be a safe workflow id"));
  if (typeof definition.name !== "string" || definition.name.trim() === ""
    || definition.name.length > WORKFLOW_LIMITS.max_name_length) errors.push(issue("$.name", "must be non-empty and at most 128 characters"));
  if (typeof definition.description !== "string" || definition.description.trim() === ""
    || definition.description.length > WORKFLOW_LIMITS.max_description_length) errors.push(issue("$.description", "must be non-empty and at most 1024 characters"));
  if (!safeInteger(definition.version, 1, WORKFLOW_LIMITS.max_version)) errors.push(issue("$.version", "must be a positive safe version"));
  if (!["built-in", "user"].includes(definition.source)) errors.push(issue("$.source", "must be built-in or user"));
  validateInputSchema(definition.inputs, "$.inputs", errors, 0, { root: true });
  if (!safeId(definition.start, NODE_ID)) errors.push(issue("$.start", "must be a safe node id"));
  if (!plain(definition.nodes) || Object.keys(definition.nodes).length < 1 || Object.keys(definition.nodes).length > MAX_NODES) {
    errors.push(issue("$.nodes", "must contain 1..256 nodes"));
  }
  const nodes = plain(definition.nodes) ? definition.nodes : {};
  const nodeIds = Object.keys(nodes);
  for (const id of nodeIds) {
    if (!safeId(id, NODE_ID)) errors.push(issue(`$.nodes.${id}`, "node id is unsafe"));
    validateNode(nodes[id], id, `$.nodes.${id}`, errors);
  }
  if (!Object.hasOwn(nodes, definition.start)) errors.push(issue("$.start", "must reference an existing node"));
  for (const [id, node] of Object.entries(nodes)) {
    for (const edge of nodeEdges(node)) {
      if (!safeId(edge.target, NODE_ID) || !Object.hasOwn(nodes, edge.target)) {
        errors.push(issue(`$.nodes.${id}.${edge.field}`, `references unknown target '${String(edge.target)}'`));
      }
    }
  }
  const reachable = new Set();
  const queue = Object.hasOwn(nodes, definition.start) ? [definition.start] : [];
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const { target } of nodeEdges(nodes[id])) {
      if (Object.hasOwn(nodes, target) && !reachable.has(target)) queue.push(target);
    }
  }
  for (const id of nodeIds) if (!reachable.has(id)) errors.push(issue(`$.nodes.${id}`, "is unreachable from start"));
  const distanceFromStart = new Map();
  const distanceQueue = Object.hasOwn(nodes, definition.start) ? [definition.start] : [];
  if (distanceQueue.length > 0) distanceFromStart.set(definition.start, 0);
  while (distanceQueue.length > 0) {
    const id = distanceQueue.shift();
    for (const { target } of runtimeEdges(nodes[id])) {
      if (Object.hasOwn(nodes, target) && !distanceFromStart.has(target)) {
        distanceFromStart.set(target, distanceFromStart.get(id) + 1);
        distanceQueue.push(target);
      }
    }
  }
  const reaches = (start, target) => {
    const seen = new Set();
    const pending = [start];
    while (pending.length) {
      const current = pending.pop();
      if (current === target) return true;
      if (seen.has(current) || !Object.hasOwn(nodes, current)) continue;
      seen.add(current);
      pending.push(...runtimeEdges(nodes[current]).map((edge) => edge.target));
    }
    return false;
  };
  for (const [id, node] of Object.entries(nodes)) {
    if (node.kind !== "decision" || !Array.isArray(node.transitions) || !plain(node.default)) continue;
    const edges = [
      ...node.transitions.map((edge, index) => ({ edge, path: `$.nodes.${id}.transitions[${index}]`, isDefault: false })),
      { edge: node.default, path: `$.nodes.${id}.default`, isDefault: true },
    ];
    for (const { edge, path, isDefault } of edges) {
      if (!safeId(edge?.target, NODE_ID)) continue;
      const participatesInCycle = reaches(edge.target, id);
      const cyclic = participatesInCycle && (isDefault
        || (distanceFromStart.get(edge.target) ?? Number.POSITIVE_INFINITY) <= (distanceFromStart.get(id) ?? -1));
      if (cyclic && (edge.loop !== true || !safeId(node.loops_off, NODE_ID))) {
        errors.push(issue(path, "a cyclic decision edge requires loop:true and a loops_off target"));
      } else if (!cyclic && edge.loop === true) {
        errors.push(issue(`${path}.loop`, "loop:true is valid only on a cyclic decision edge"));
      }
    }
  }
  const successIds = nodeIds.filter((id) => nodes[id]?.kind === "terminal" && nodes[id].status === "succeeded");
  const finalGates = nodeIds.filter((id) => nodes[id]?.kind === "gate" && nodes[id].final === true);
  if (finalGates.length !== 1) errors.push(issue("$.nodes", "must contain exactly one final objective gate"));
  if (successIds.length !== 1) errors.push(issue("$.nodes", "must contain exactly one succeeded terminal"));
  else {
    const successId = successIds[0];
    const finalGateId = finalGates.length === 1 ? finalGates[0] : null;
    if (finalGateId && nodes[finalGateId].on_pass !== successId) {
      errors.push(issue(`$.nodes.${finalGateId}.on_pass`, "final objective gate must pass directly to the succeeded terminal"));
    }
    for (const [id, node] of Object.entries(nodes)) {
      for (const edge of nodeEdges(node)) {
        if (edge.target === successId && !(id === finalGateId && edge.field === "on_pass")) {
          errors.push(issue(`$.nodes.${id}.${edge.field}`, "succeeded terminal is reachable only from the final objective gate on_pass edge"));
        }
      }
    }
    const canReachSuccess = reverseReachable(nodes, successId);
    for (const id of nodeIds) {
      const node = nodes[id];
      if (node.kind !== "terminal" && !canReachSuccess.has(id) && reachable.has(id)) {
        errors.push(issue(`$.nodes.${id}`, "cannot reach the successful objective-gated terminal"));
      }
    }
  }
  if (!exactKeys(definition.limits, [
    "max_total_effects", "max_concurrency", "max_map_items", "max_run_ms", "max_call_ms", "structured_repair_attempts",
  ]) || !safeInteger(definition.limits.max_total_effects, 1, MAX_TOTAL_EFFECTS)
    || !safeInteger(definition.limits.max_concurrency, 1, MAX_CONCURRENCY)
    || !safeInteger(definition.limits.max_map_items, 0, MAX_MAP_ITEMS)
    || !safeInteger(definition.limits.max_run_ms, 1_000, MAX_RUN_MS)
    || !safeInteger(definition.limits.max_call_ms, 1_000, MAX_CALL_MS)
    || !safeInteger(definition.limits.structured_repair_attempts, 0, WORKFLOW_LIMITS.max_structured_repair_attempts)) {
    errors.push(issue("$.limits", "contains invalid hard workflow limits"));
  }
  if (!exactKeys(definition.provider_policy, ["exact", "assignments", "default_assignment", "require_live_certification"])
    || definition.provider_policy.exact !== true || !plain(definition.provider_policy.assignments)
    || !plain(definition.provider_policy.default_assignment)
    || typeof definition.provider_policy.require_live_certification !== "boolean") {
    errors.push(issue("$.provider_policy", "must require exact binding and closed assignments"));
  }
  if (!exactKeys(definition.workspace_policy, ["mode", "proposal_cleanup", "transcripts"])
    || definition.workspace_policy.mode !== "canonical-worktree"
    || !["unchanged", "explicit"].includes(definition.workspace_policy.proposal_cleanup)
    || !["off", "private"].includes(definition.workspace_policy.transcripts)) {
    errors.push(issue("$.workspace_policy", "must declare canonical-worktree mode, cleanup, and transcript policy"));
  }
  validateGate(definition.objective_gate, "$.objective_gate", errors);
  try {
    if (Buffer.byteLength(stable(definition), "utf8") > MAX_WORKFLOW_BYTES) errors.push(issue("$", "serialized definition exceeds 256 KiB"));
  } catch {
    errors.push(issue("$", "must be serializable"));
  }
  return { valid: errors.length === 0, errors };
}

function toolsForRole(role) {
  return MUTATING_ROLES.has(role)
    ? ["read", "grep", "find", "ls", "bash", "edit", "write"]
    : ["read", "grep", "find", "ls"];
}

function inlineAgent(step, stage, timeoutMs) {
  return {
    kind: "agent",
    role: step.role,
    stage_id: stage.id,
    prompt: "tracked-step-v1",
    output_schema: { id: step.role === "reviewer" ? "verdict-v1" : "semantic-v2" },
    tools: toolsForRole(step.role),
    mutation: MUTATING_ROLES.has(step.role) ? "shared-serialized" : "read-only",
    timeout_ms: timeoutMs,
    retry: { max_attempts: 1, backoff_ms: 0 },
  };
}

function decisionCondition(pipelineId, role, verdict) {
  return { op: "eq", path: `/outputs/${pipelineId}/by_role/${role}/recommendation`, value: verdict };
}

function actionTarget(action, { stageId, previousStage, nextStage, finalGate, stopTerminal }) {
  if (action.action === "advance") return nextStage ?? finalGate;
  if (action.action === "retry") return stageId;
  if (action.action === "back") return action.target ?? previousStage ?? stageId;
  return stopTerminal;
}

function migrateWorkflowV1Checked(workflow) {
  if (workflow.stages.some((stage) => stage.steps.some((step) => step.kind !== "role"))) {
    return { ok: false, code: "workflow-migration-host-effects-unsupported" };
  }
  const nodes = {};
  const stopTerminal = "stopped";
  const hasStop = workflow.stages.some((stage) => stage.transitions.some((entry) => entry.action === "stop"));
  const successTerminal = "succeeded";
  const failedTerminal = "failed";
  const finalGate = "objective-gate";
  for (let index = 0; index < workflow.stages.length; index += 1) {
    const stage = workflow.stages[index];
    const pipelineId = stage.id;
    const decisionId = `${stage.id}-decision`;
    const nextStage = workflow.stages[index + 1]?.id ?? null;
    const previousStage = workflow.stages[index - 1]?.id ?? null;
    const roleSteps = stage.steps.filter((step) => step.kind === "role");
    nodes[pipelineId] = {
      kind: "pipeline",
      label: stage.label ?? stage.id,
      stages: roleSteps.map((step) => inlineAgent(step, stage, workflow.deployment.call_timeout_ms)),
      next: decisionId,
      max_visits: stage.max_passes,
      ...(stage.artifact ? { artifact: structuredClone(stage.artifact) } : {}),
    };
    const verdictTransition = stage.transitions.find((entry) => entry.when.type === "verdict");
    const gateTransition = stage.transitions.find((entry) => entry.when.type === "gate");
    if (verdictTransition) {
      const role = verdictTransition.when.role;
      nodes[decisionId] = {
        kind: "decision",
        transitions: stage.transitions
          .filter((entry) => entry.when.type === "verdict")
          .map((entry) => ({
            when: decisionCondition(pipelineId, role, entry.when.is),
            target: actionTarget(entry, { stageId: pipelineId, previousStage, nextStage, finalGate, stopTerminal }),
            loop: ["retry", "back"].includes(entry.action),
          })),
        default: { target: failedTerminal },
        loops_off: nextStage ?? finalGate,
      };
    } else if (gateTransition) {
      const pass = stage.transitions.find((entry) => entry.when.type === "gate" && entry.when.is === "pass");
      const fail = stage.transitions.find((entry) => entry.when.type === "gate" && entry.when.is === "fail");
      nodes[decisionId] = {
        kind: "gate",
        gate: structuredClone(workflow.stop.objective_gate),
        on_pass: actionTarget(pass, { stageId: pipelineId, previousStage, nextStage, finalGate, stopTerminal }),
        on_fail: actionTarget(fail, { stageId: pipelineId, previousStage, nextStage, finalGate, stopTerminal }),
        loops_off: nextStage ?? finalGate,
      };
    } else {
      const always = stage.transitions.find((entry) => entry.when.type === "always");
      nodes[decisionId] = {
        kind: "decision",
        transitions: [{ when: { op: "always" }, target: actionTarget(always, { stageId: pipelineId, previousStage, nextStage, finalGate, stopTerminal }) }],
        default: { target: failedTerminal },
      };
    }
  }
  const lastStage = workflow.stages.at(-1)?.id ?? failedTerminal;
  nodes[finalGate] = {
    kind: "gate",
    on_pass: successTerminal,
    on_fail: lastStage,
    final: true,
    loops_off: failedTerminal,
  };
  nodes[successTerminal] = { kind: "terminal", status: "succeeded" };
  nodes[failedTerminal] = { kind: "terminal", status: "failed", code: "workflow-condition-unmatched" };
  if (hasStop) nodes[stopTerminal] = { kind: "terminal", status: "refused", code: "workflow-stopped" };
  const definition = {
    schema_version: WORKFLOW_SCHEMA_VERSION,
    id: workflow.id,
    name: workflow.description.split(/[.!?]/, 1)[0].slice(0, WORKFLOW_LIMITS.max_name_length) || workflow.id,
    description: workflow.description,
    version: 1,
    source: workflow.source,
    inputs: {
      type: "object",
      additionalProperties: false,
      required: ["task"],
      properties: { task: { type: "string", minLength: 1, maxLength: WORKFLOW_LIMITS.max_input_string_length } },
    },
    start: workflow.stages[0]?.id ?? failedTerminal,
    nodes,
    limits: {
      max_total_effects: Math.min(MAX_TOTAL_EFFECTS, Math.max(
        WORKFLOW_DEFAULTS.max_total_effects,
        workflow.stop.max_iterations * Math.max(1, ...workflow.stages.map((stage) => stage.steps.filter((step) => step.kind === "role").length)),
      )),
      max_concurrency: Math.min(MAX_CONCURRENCY, workflow.deployment.parallel.max_concurrency),
      max_map_items: WORKFLOW_DEFAULTS.max_map_items,
      max_run_ms: workflow.stop.max_runtime_ms,
      max_call_ms: workflow.deployment.call_timeout_ms,
      structured_repair_attempts: WORKFLOW_DEFAULTS.structured_repair_attempts,
    },
    provider_policy: {
      exact: true,
      assignments: structuredClone(workflow.deployment.assignments),
      default_assignment: structuredClone(workflow.deployment.default_assignment),
      require_live_certification: false,
    },
    workspace_policy: {
      mode: "canonical-worktree",
      proposal_cleanup: "unchanged",
      transcripts: "off",
    },
    objective_gate: structuredClone(workflow.stop.objective_gate),
  };
  const valid = validateWorkflowDefinition(definition);
  return valid.valid ? { ok: true, definition } : { ok: false, code: "workflow-migration-invalid", errors: valid.errors };
}

/** Losslessly normalize the current saved workflow shape into v4. */
export function migrateWorkflowV1(workflow) {
  if (!plain(workflow) || workflow.schema_version !== 1 || !Array.isArray(workflow.stages)) {
    return { ok: false, code: "workflow-migration-input-invalid" };
  }
  try {
    return migrateWorkflowV1Checked(workflow);
  } catch {
    return { ok: false, code: "workflow-migration-input-invalid" };
  }
}

export function normalizeWorkflowDefinition(workflow) {
  try {
    if (workflow?.schema_version === WORKFLOW_SCHEMA_VERSION) {
      const valid = validateWorkflowDefinition(workflow);
      return valid.valid
        ? { ok: true, definition: structuredClone(workflow), migrated: false }
        : { ok: false, code: "invalid-workflow-v4", errors: valid.errors };
    }
    const migrated = migrateWorkflowV1(workflow);
    return migrated.ok ? { ...migrated, migrated: true } : migrated;
  } catch {
    return { ok: false, code: workflow?.schema_version === WORKFLOW_SCHEMA_VERSION
      ? "invalid-workflow-v4"
      : "workflow-migration-input-invalid" };
  }
}

export function workflowDefinitionHash(definition) {
  const valid = validateWorkflowDefinition(definition);
  if (!valid.valid) return null;
  return `sha256:${createHash("sha256").update(stable(definition)).digest("hex")}`;
}

export function resolveJsonPointer(value, pointer) {
  const segments = pointerSegments(pointer);
  if (segments == null) return { found: false, value: undefined };
  let current = value;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

export function evaluateCondition(condition, context, depth = 0) {
  if (depth > MAX_CONDITION_DEPTH || !plain(condition)) return false;
  if (condition.op === "always") return true;
  if (condition.op === "and") return Array.isArray(condition.conditions)
    && condition.conditions.every((entry) => evaluateCondition(entry, context, depth + 1));
  if (condition.op === "or") return Array.isArray(condition.conditions)
    && condition.conditions.some((entry) => evaluateCondition(entry, context, depth + 1));
  if (condition.op === "not") return !evaluateCondition(condition.condition, context, depth + 1);
  const resolved = resolveJsonPointer(context, condition.path);
  if (!resolved.found) return false;
  if (condition.op === "eq") return resolved.value === condition.value;
  if (condition.op === "neq") return resolved.value !== condition.value;
  if (condition.op === "lt") return resolved.value < condition.value;
  if (condition.op === "lte") return resolved.value <= condition.value;
  if (condition.op === "gt") return resolved.value > condition.value;
  if (condition.op === "gte") return resolved.value >= condition.value;
  if (condition.op === "contains") return Array.isArray(resolved.value)
    ? resolved.value.includes(condition.value)
    : typeof resolved.value === "string" && resolved.value.includes(String(condition.value));
  return false;
}

export function stableWorkflowStringify(value) {
  return stable(value);
}
