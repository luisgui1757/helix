import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { workflowFromExecution } from "../dispatch/lib/workflows.mjs";
import {
  evaluateCondition,
  migrateWorkflowV1,
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
  workflowDefinitionHash,
} from "../dispatch/workflow/schema.mjs";
import { agent, decision, gate, pipeline, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { observedWorkflowGraph, plannedWorkflowGraph } from "../dispatch/workflow/visualize.mjs";

function currentWorkflow() {
  const chains = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
  const configs = JSON.parse(readFileSync(new URL("../dispatch/config/run-configs.json", import.meta.url), "utf8"));
  return workflowFromExecution(chains.chains[0], configs.configs[0], { source: "built-in" });
}

test("every shipped chain normalizes losslessly into a closed v4 graph", () => {
  const chains = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
  const base = JSON.parse(readFileSync(new URL("../dispatch/config/run-configs.json", import.meta.url), "utf8")).configs[0];
  for (const chain of chains.chains) {
    const config = { ...base, id: chain.id, chain: chain.id, max_iterations: chain.default_max_iterations };
    const migrated = migrateWorkflowV1(workflowFromExecution(chain, config, { source: "built-in" }));
    assert.equal(migrated.ok, true, `${chain.id}: ${JSON.stringify(migrated.errors)}`);
    assert.equal(validateWorkflowDefinition(migrated.definition).valid, true);
    assert.match(workflowDefinitionHash(migrated.definition), /^sha256:[0-9a-f]{64}$/);
  }
});

test("normalization is byte-stable and never mutates its source", () => {
  const source = currentWorkflow();
  const before = JSON.stringify(source);
  const first = normalizeWorkflowDefinition(source);
  const second = normalizeWorkflowDefinition(source);
  assert.equal(first.ok, true);
  assert.deepEqual(first.definition, second.definition);
  assert.equal(JSON.stringify(source), before);
  const normalizedAgain = normalizeWorkflowDefinition(first.definition);
  assert.equal(normalizedAgain.migrated, false);
  assert.deepEqual(normalizedAgain.definition, first.definition);
});

test("v4 rejects unknown fields, unreachable nodes, unbounded cycles, and success without a final gate", () => {
  const base = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const cases = [
    { ...base, extra: true },
    { ...base, nodes: { ...base.nodes, orphan: { kind: "terminal", status: "failed", code: "orphan" } } },
    { ...base, nodes: { ...base.nodes, plan: { ...base.nodes.plan, max_visits: undefined } } },
    { ...base, nodes: { ...base.nodes, "objective-gate": { ...base.nodes["objective-gate"], final: false } } },
  ];
  for (const candidate of cases) assert.equal(validateWorkflowDefinition(candidate).valid, false);
});

test("pure builder creates the same closed definition contract", () => {
  const build = agent({ role: "builder", stage_id: "build", mutation: "shared-serialized" });
  const review = agent({ role: "reviewer", stage_id: "build", output_schema: "verdict-v1", mutation: "read-only" });
  const objective = { type: "file-contains", path: "proposal.txt", contains: "PASS" };
  const built = workflow({
    id: "builder-example",
    name: "Builder example",
    description: "A bounded build and review workflow.",
    start: "build",
    nodes: {
      build: pipeline([build, review], "route", { max_visits: 3, artifact: { path: "proposal.txt", kind: "notes" } }),
      route: decision([
        { when: { op: "eq", path: "/outputs/build/by_role/reviewer/recommendation", value: "approve" }, target: "objective" },
        { when: { op: "eq", path: "/outputs/build/by_role/reviewer/recommendation", value: "revise" }, target: "build", loop: true },
      ], "failed", { label: "Review decision" }),
      objective: gate(objective, "success", "build", { final: true }),
      success: terminal("succeeded"),
      failed: terminal("failed", "review-verdict-invalid"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
});

test("conditions use safe JSON pointers and missing values are false", () => {
  const context = { outputs: { review: { recommendation: "approve", risks: ["r1"] } } };
  assert.equal(evaluateCondition({ op: "eq", path: "/outputs/review/recommendation", value: "approve" }, context), true);
  assert.equal(evaluateCondition({ op: "contains", path: "/outputs/review/risks", value: "r1" }, context), true);
  assert.equal(evaluateCondition({ op: "eq", path: "/outputs/missing", value: "approve" }, context), false);
});

test("planned and observed graphs share stable ids without prompt content", () => {
  const definition = normalizeWorkflowDefinition(currentWorkflow()).definition;
  const planned = plannedWorkflowGraph(definition);
  assert.equal(planned.ok, true);
  assert.equal(JSON.stringify(planned).includes("tracked-step-v1"), false);
  const observed = observedWorkflowGraph(definition, [
    { kind: "node-start", node_id: definition.start },
    { kind: "effect-end", node_id: definition.start },
    { kind: "node-end", node_id: definition.start, status: "ok" },
  ]);
  assert.equal(observed.nodes.find((node) => node.id === definition.start).visits, 1);
  assert.equal(observed.nodes.find((node) => node.id === definition.start).effects, 1);
});
