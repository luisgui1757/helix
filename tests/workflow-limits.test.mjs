import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WORKSPACE_COPY_LIMITS } from "../dispatch/kernel/limits.mjs";
import { PRIVATE_CHECKPOINT_LIMITS } from "../dispatch/lib/runner.mjs";
import {
  WORKFLOW_LIMITS,
  stableWorkflowStringify,
  validateWorkflowDefinition,
  validateWorkflowInput,
} from "../dispatch/workflow/schema.mjs";
import { agent, checkpoint, decision, objectiveGate, parallel, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { listUserWorkflows, saveUserWorkflowV4 } from "../extensions/lib/helix-workflows.mjs";

const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
const reviewer = (prompt = "tracked-step-v1") => agent({
  role: "reviewer", stage_id: "review", prompt, output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000,
});

function linearDefinition(count) {
  const nodes = {};
  for (let index = 0; index < count; index += 1) {
    nodes[`step-${index}`] = checkpoint(`step-${index}`, index + 1 < count ? `step-${index + 1}` : "objective");
  }
  nodes.objective = objectiveGate("success", "failed");
  nodes.success = terminal("succeeded");
  nodes.failed = terminal("failed", "objective-failed");
  return workflow({
    id: "node-boundary", name: "Node boundary", description: "Exact workflow node boundary.",
    start: "step-0", nodes, objective_gate: objective,
  });
}

test("workflow node and serialized-definition ceilings accept exact and reject one-over", () => {
  const exactNodes = linearDefinition(WORKFLOW_LIMITS.max_nodes - 3);
  assert.equal(exactNodes.ok, true, JSON.stringify(exactNodes.errors));
  assert.equal(Object.keys(exactNodes.definition.nodes).length, WORKFLOW_LIMITS.max_nodes);
  const excessNodes = linearDefinition(WORKFLOW_LIMITS.max_nodes - 2);
  assert.equal(excessNodes.ok, false);
  assert.equal(excessNodes.errors.some((entry) => entry.message.includes("1..256 nodes")), true);

  const branches = Array.from({ length: WORKFLOW_LIMITS.max_parallel_branches }, () => reviewer("p"));
  const built = workflow({
    id: "byte-boundary", name: "Byte boundary", description: "Exact serialized workflow boundary.", start: "work",
    nodes: {
      work: parallel(branches, "objective", { max_concurrency: WORKFLOW_LIMITS.max_concurrency }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: WORKFLOW_LIMITS.max_parallel_branches },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const excessBranches = structuredClone(built.definition);
  excessBranches.nodes.work.branches.push(reviewer("p"));
  assert.equal(validateWorkflowDefinition(excessBranches).valid, false);
  let remaining = WORKFLOW_LIMITS.max_workflow_bytes - Buffer.byteLength(stableWorkflowStringify(built.definition));
  for (const branch of built.definition.nodes.work.branches) {
    const available = 16_384 - branch.prompt.length;
    const added = Math.min(available, remaining);
    branch.prompt += "p".repeat(added);
    remaining -= added;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(stableWorkflowStringify(built.definition)), WORKFLOW_LIMITS.max_workflow_bytes);
  assert.equal(validateWorkflowDefinition(built.definition).valid, true);
  const root = mkdtempSync(join(tmpdir(), "helix-workflow-byte-boundary-"));
  try {
    assert.equal(saveUserWorkflowV4(root, built.definition).ok, true);
    const savedPath = join(root, "workflows", `${built.definition.id}.json`);
    assert.equal(statSync(savedPath).size, WORKFLOW_LIMITS.max_workflow_bytes + 1);
    assert.equal(listUserWorkflows(root).ok, true);
    assert.equal(stableWorkflowStringify(JSON.parse(readFileSync(savedPath, "utf8"))), stableWorkflowStringify(built.definition));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const excessBytes = structuredClone(built.definition);
  const branch = excessBytes.nodes.work.branches.find((entry) => entry.prompt.length < 16_384);
  assert.ok(branch);
  branch.prompt += "p";
  assert.equal(validateWorkflowDefinition(excessBytes).errors.some((entry) => entry.message.includes("256 KiB")), true);
});

test("condition, transition, and input-shape widths accept exact and reject one-over", () => {
  const conditionAt = (depth) => {
    let condition = { op: "always" };
    for (let index = 0; index < depth; index += 1) condition = { op: "not", condition };
    return condition;
  };
  const transitions = Array.from({ length: WORKFLOW_LIMITS.max_transitions }, () => ({
    when: conditionAt(WORKFLOW_LIMITS.max_condition_depth), target: "objective",
  }));
  const built = workflow({
    id: "shape-boundary", name: "Shape boundary", description: "Exact graph-shape boundaries.", start: "route",
    nodes: {
      route: decision(transitions, "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const excessDepth = structuredClone(built.definition);
  excessDepth.nodes.route.transitions[0].when = conditionAt(WORKFLOW_LIMITS.max_condition_depth + 1);
  assert.equal(validateWorkflowDefinition(excessDepth).valid, false);
  const excessTransitions = structuredClone(built.definition);
  excessTransitions.nodes.route.transitions.push({ when: { op: "always" }, target: "objective" });
  assert.equal(validateWorkflowDefinition(excessTransitions).valid, false);

  const properties = Object.fromEntries(Array.from({ length: WORKFLOW_LIMITS.max_input_fields }, (_, index) => [
    index === 0 ? "task" : `field-${index}`,
    { type: "string", minLength: index === 0 ? 1 : 0, maxLength: 1 },
  ]));
  const schema = { type: "object", additionalProperties: false, required: ["task"], properties };
  assert.equal(validateWorkflowInput(schema, { task: "t" }).valid, true);
  const definitionWithFields = structuredClone(built.definition);
  definitionWithFields.inputs = schema;
  assert.equal(validateWorkflowDefinition(definitionWithFields).valid, true);
  definitionWithFields.inputs.properties.overflow = { type: "string", maxLength: 1 };
  assert.equal(validateWorkflowDefinition(definitionWithFields).valid, false);

  let nested = { type: "string", maxLength: 1 };
  for (let depth = WORKFLOW_LIMITS.max_input_depth - 2; depth >= 0; depth -= 1) {
    nested = { type: "object", additionalProperties: false, required: [], properties: { [`level-${depth}`]: nested } };
  }
  const exactDepth = structuredClone(built.definition);
  exactDepth.inputs.properties.nested = nested;
  assert.equal(validateWorkflowDefinition(exactDepth).valid, true);
  const excessInputDepth = structuredClone(exactDepth);
  let cursor = excessInputDepth.inputs.properties.nested;
  while (cursor.type === "object") cursor = cursor.properties[Object.keys(cursor.properties)[0]];
  Object.assign(cursor, { type: "object", additionalProperties: false, required: [], properties: { overflow: { type: "string" } } });
  assert.equal(validateWorkflowDefinition(excessInputDepth).valid, false);
});

test("runtime input byte ceiling accepts exact and rejects one-over", () => {
  const schema = {
    type: "object", additionalProperties: false, required: ["task", "items"],
    properties: {
      task: { type: "string", minLength: 1, maxLength: WORKFLOW_LIMITS.max_input_string_length },
      items: {
        type: "array", minItems: 16, maxItems: 16,
        items: { type: "string", minLength: 0, maxLength: WORKFLOW_LIMITS.max_input_string_length },
      },
    },
  };
  const input = { task: "t", items: Array.from({ length: 15 }, () => "x".repeat(WORKFLOW_LIMITS.max_input_string_length)).concat("") };
  const remaining = WORKFLOW_LIMITS.max_input_bytes - Buffer.byteLength(stableWorkflowStringify(input));
  assert.ok(remaining > 0 && remaining < WORKFLOW_LIMITS.max_input_string_length);
  input.items[15] = "x".repeat(remaining);
  assert.equal(Buffer.byteLength(stableWorkflowStringify(input)), WORKFLOW_LIMITS.max_input_bytes);
  assert.equal(validateWorkflowInput(schema, input).valid, true);
  input.items[15] += "x";
  assert.equal(validateWorkflowInput(schema, input).errors.some((entry) => entry.message.includes("1 MiB")), true);
});

test("workspace copies and private checkpoints use the same exported limits", () => {
  assert.equal(PRIVATE_CHECKPOINT_LIMITS, WORKSPACE_COPY_LIMITS);
  assert.deepEqual(PRIVATE_CHECKPOINT_LIMITS, {
    max_files: 16_384,
    max_file_bytes: 16 * 1024 * 1024,
    max_total_bytes: 64 * 1024 * 1024,
  });
});
