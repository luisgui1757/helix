import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowFromTemplate } from "../dispatch/lib/workflows.mjs";
import { createPiAgentAdapter } from "../dispatch/lib/pi-agent-adapter.mjs";
import { normalizeWorkflowDefinition, stableWorkflowStringify, WORKFLOW_LIMITS } from "../dispatch/workflow/schema.mjs";
import { agent, checkpoint, decision, map, objectiveGate, parallel, pipeline, reduce, subworkflow, terminal, workflow } from "../dispatch/workflow/builder.mjs";
import { executeNamedWorkflow, resumeNamedWorkflow } from "../extensions/lib/helix-execution.mjs";
import { executeHelixCommand } from "../extensions/lib/helix-command-core.mjs";
import { saveUserWorkflow, saveUserWorkflowV4 } from "../extensions/lib/helix-workflows.mjs";
import { smokeTestWorkflowRuntime } from "../extensions/lib/helix-workflow-test.mjs";

const packageRoot = new URL("..", import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const chains = readJson("../dispatch/config/chains.json");
const runs = readJson("../dispatch/config/run-configs.json");

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "helix-workflow-exec-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Workflow Test"], { cwd });
  writeFileSync(join(cwd, "README.md"), "# Empty workflow fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

function installWorkflow(stateRoot, id = "user-loop", template = "implement-review") {
  const created = createWorkflowFromTemplate({ id, template, gate_contains: "DONE" });
  assert.equal(created.ok, true);
  assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);
}

test("every stock workflow template runs end-to-end with a mock cast in an empty committed repository", async () => {
  for (const template of ["implement-review", "plan-implement", "tdd-fix"]) {
    const stateRoot = mkdtempSync(join(tmpdir(), `helix-workflow-template-${template}-`));
    const cwd = repo();
    const id = `template-${template}`;
    installWorkflow(stateRoot, id, template);
    const result = await executeNamedWorkflow({
      workflow_id: id,
      task: `Exercise ${template}`,
      run_id: `run-${template}`,
      cwd,
      state_root: stateRoot,
      package_root: packageRoot,
      chain_registry: chains,
      run_registry: runs,
      expected_binding_ref: executionBinding(stateRoot, id),
      now: 1_751_731_200,
    });
    assert.equal(result.ok, true, `${template}: ${JSON.stringify(result)}`);
    assert.equal(result.converged, true, template);
  }
});

test("runtime smoke testing exercises the real v4 kernel and removes its detached worktree", async () => {
  const cwd = repo();
  const created = createWorkflowFromTemplate({ id: "smoke-flow", template: "plan-implement" });
  assert.equal(created.ok, true);
  created.workflow.deployment.default_assignment = {
    kind: "model", provider: "openrouter", model: "cohere/north-mini-code:free", effort: "low",
  };
  const before = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  const outcome = await smokeTestWorkflowRuntime({ workflow: created.workflow, cwd, package_root: packageRoot });
  assert.deepEqual(outcome, {
    ok: true,
    runner: "workflow-kernel-v4",
    provider_calls: 0,
    objective_check: "simulated",
    nodes_exercised: 6,
    effects_exercised: 5,
    transitions_exercised: 5,
    objective_gate_exercised: true,
  });
  const after = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  assert.equal(after, before);
});

test("native v4 runtime smoke follows a real kernel decision and reports only observed work", async () => {
  const cwd = repo();
  const objective = { type: "file-contains", path: "result.md", contains: "PASS" };
  const built = workflow({
    id: "native-smoke", name: "Native smoke", description: "Native v4 smoke workflow.", start: "review",
    nodes: {
      review: pipeline([agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 })], "route", { max_visits: 1 }),
      route: decision([{ when: { op: "eq", path: "/outputs/review/by_role/reviewer/recommendation", value: "approve" }, target: "objective" }], "failed"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "review-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const observed = [];
  const outcome = await smokeTestWorkflowRuntime({
    workflow: built.definition,
    cwd,
    onEvent(event) { observed.push(event); },
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.deepEqual(observed.filter((event) => event.kind === "node-start").map((event) => event.node_id), [
    "review", "route", "objective", "success",
  ]);
  assert.equal(outcome.nodes_exercised, 4);
  assert.equal(outcome.effects_exercised, 1);
  assert.equal(outcome.transitions_exercised, 3);
});

test("a valid zero-agent workflow deploys through the product boundary", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-zero-agent-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "zero-agent", name: "Zero agent", description: "A deterministic gate-only workflow.", start: "objective",
    nodes: { objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed") },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "zero-agent");
  const result = await executeNamedWorkflow({
    workflow_id: "zero-agent", task: "run deterministic gate", run_id: "zero-agent-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.converged, true);
  assert.deepEqual(result.cast, []);
});

test("an exact-limit persisted definition can be watched and resumed", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-definition-limit-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const stages = Array.from({ length: WORKFLOW_LIMITS.max_inline_stages }, (_, index) => agent({
    role: "reviewer", stage_id: `review-${index}`, mutation: "read-only", timeout_ms: 1_000,
  }));
  const built = workflow({
    id: "definition-limit", name: "Definition limit", description: "Exact byte-limit workflow.", start: "approval",
    nodes: {
      approval: checkpoint("limit-approval", "route"),
      route: decision([{ when: { op: "eq", path: "/inputs/task", value: "" }, target: "work" }], "work"),
      work: pipeline(stages, "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: stages.length }, objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  let remaining = WORKFLOW_LIMITS.max_workflow_bytes - Buffer.byteLength(stableWorkflowStringify(built.definition));
  built.definition.nodes.route.transitions[0].when.value = "p".repeat(remaining);
  assert.ok(remaining > 0);
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "definition-limit");
  const paused = await executeNamedWorkflow({
    workflow_id: "definition-limit", task: "exercise exact definition", run_id: "definition-limit-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  const privateCheckpoint = JSON.parse(readFileSync(join(
    stateRoot, "private", "runs", "definition-limit-run", "kernel-checkpoint.json",
  ), "utf8"));
  assert.equal(privateCheckpoint.snapshot_generation.endsWith(privateCheckpoint.snapshot_ref.slice(7, 23)), true);
  const watched = executeHelixCommand("runs watch definition-limit-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(watched.ok, true, JSON.stringify(watched));
  const resumed = await resumeNamedWorkflow({
    run_id: "definition-limit-run", task: "exercise exact definition", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
});

function executionBinding(stateRoot, id, modelInventory = null) {
  const preflight = executeHelixCommand(`run ${id}`, { mode: "print" }, {
    stateRoot,
    chainRegistry: chains,
    runRegistry: runs,
    ...(modelInventory ? { modelInventory } : {}),
  });
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  assert.match(preflight.details.execution_binding_ref, /^sha256:[0-9a-f]{64}$/);
  return preflight.details.execution_binding_ref;
}

function exactEnvelope(spec, ctx, overrides = {}) {
  return {
    schema_version: 2, run_id: ctx.run_id, stage: "candidate", role: spec.role,
    provider: spec.provider, model: spec.model,
    requested: { provider: spec.provider, model: spec.model, effort: spec.effort },
    effective: {
      provider: spec.provider, model: spec.model, effort: spec.effort,
      evidence: { provider: "verified-response", model: "verified-response", effort: "verified-session" },
    },
    attestation_ref: `sha256:${"a".repeat(64)}`,
    usage: { input_tokens: 2, output_tokens: 1 }, attempt: ctx.attempt, iteration: ctx.pass,
    input_ref: { kind: "local-ref", value: "local-ref:input/workflow-contract", algorithm: null },
    claims_ref: "local-ref:claims/workflow-contract", evidence_ref: "local-ref:evidence/workflow-contract",
    uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [], status: "ok",
    ...overrides,
  };
}

test("named user workflow executes canonical blocks and never persists the raw task", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-state-"));
  const cwd = repo();
  installWorkflow(stateRoot);
  const task = "Implement a private-shaped request without persisting this sentence";
  const result = await executeNamedWorkflow({
    workflow_id: "user-loop",
    task,
    run_id: "user-loop-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "user-loop"),
    now: 1_751_731_200,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.converged, true);
  assert.equal(existsSync(join(stateRoot, "private", "tasks", "user-loop-run.txt")), false);
  const publicDir = join(stateRoot, "runs", "user-loop-run");
  for (const name of readdirSync(publicDir)) {
    const path = join(publicDir, name);
    if (statSync(path).isFile()) assert.equal(readFileSync(path, "utf8").includes(task), false, name);
  }
  const state = JSON.parse(readFileSync(join(publicDir, "user-loop-run.state.json"), "utf8"));
  assert.equal(state.schema_version, 4);
  assert.equal(state.workflow_id, "user-loop");
  assert.equal(state.completed, true);
  assert.match(state.task_ref, /^sha256:[0-9a-f]{64}$/);
  const lifecycle = JSON.parse(readFileSync(join(publicDir, "user-loop-run.workflow.json"), "utf8"));
  assert.equal(lifecycle.workflow_id, "user-loop");
  assert.equal(lifecycle.schema_version, 2);
  const listed = executeHelixCommand("runs list", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(listed.ok, true);
  assert.match(listed.text, /user-loop-run: workflow-kernel succeeded/);
  assert.equal(listed.text.includes("invalid"), false);

  const workflowPath = join(stateRoot, "workflows", "user-loop.json");
  const edited = JSON.parse(readFileSync(workflowPath, "utf8"));
  edited.stop.max_iterations = 1;
  writeFileSync(workflowPath, JSON.stringify(edited), "utf8");
  const watched = executeHelixCommand("runs watch user-loop-run", { mode: "print" }, {
    stateRoot,
    runsRoot: join(stateRoot, "runs"),
    chainRegistry: chains,
    runRegistry: runs,
  });
  assert.equal(watched.ok, true, JSON.stringify(watched));
  assert.match(watched.text, /Flow:/);
  assert.match(watched.text, /✓ implement/);
  lifecycle.workflow_version += 1;
  writeFileSync(join(publicDir, "user-loop-run.workflow.json"), JSON.stringify(lifecycle), "utf8");
  const tampered = executeHelixCommand("runs watch user-loop-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(tampered.code, "run-record-invalid-or-unsafe");
});

test("typed named-workflow inputs validate before run creation and drive map nodes", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-typed-input-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "typed-map", name: "Typed map", description: "Typed map workflow.", start: "items",
    inputs: {
      type: "object", additionalProperties: false, required: ["task", "items"],
      properties: {
        task: { type: "string", minLength: 1, maxLength: 65_536 },
        items: { type: "array", description: "Items to review", items: { type: "string", minLength: 2, maxLength: 32 }, minItems: 1, maxItems: 3 },
      },
    },
    nodes: {
      items: map("/inputs/items", agent({ role: "reviewer", stage_id: "items", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 }), "count", { max_items: 3 }),
      count: reduce("/outputs/items", "count", "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const smoke = await smokeTestWorkflowRuntime({ workflow: built.definition, cwd });
  assert.equal(smoke.ok, true, JSON.stringify(smoke));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "typed-map");
  const refused = await executeNamedWorkflow({
    workflow_id: "typed-map", input: { task: "review" }, run_id: "typed-missing", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(refused.code, "workflow-input-invalid");
  assert.equal(existsSync(join(stateRoot, "runs", "typed-missing")), false);
  const completed = await executeNamedWorkflow({
    workflow_id: "typed-map", input: { task: "review", items: ["aa", "bb"] }, run_id: "typed-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(completed.converged, true);
});

test("product panels enforce invocation-level effect limits before the first model call", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-panel-budget-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "panel-budget", name: "Panel budget", description: "Panel budget workflow.", start: "review",
    nodes: {
      review: pipeline([agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 })], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: 1 },
    provider_policy: { exact: true, assignments: {}, default_assignment: { kind: "composite", preset: "overlord" }, require_live_certification: false },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const result = await executeNamedWorkflow({
    workflow_id: "panel-budget", task: "respect the panel budget", run_id: "panel-budget-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "panel-budget"),
  });
  assert.equal(result.code, "kernel-budget-exhausted");
  assert.equal(result.calls.candidates, 0);
});

test("adapter and envelope failures are structurally non-maskable in product settlement", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-envelope-integrity-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const integrityCode = "kernel-agent-envelope-invalid";
  const adapterCode = "kernel-agent-adapter-failed";
  const built = workflow({
    id: "envelope-integrity", name: "Envelope integrity", description: "Envelope failures cannot be settled.", start: "review",
    nodes: {
      review: parallel([
        agent({ role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 }),
      ], "objective", { failure: "settle", allow_failure_codes: [integrityCode, adapterCode], max_concurrency: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    provider_policy: {
      exact: true,
      assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/integrity:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/integrity:free", reasoning: true, supported_efforts: ["high"] }];
  const exactRef = `sha256:${"8".repeat(64)}`;
  let malformed = true;
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true,
    async preflightExact() { return { ok: true, bindings: [], binding_ref: exactRef }; },
    attests: () => true,
    async runCandidate() {
      if (malformed) return {};
      throw new Error("synthetic adapter failure");
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "envelope-integrity", task: "must not converge", run_id: "envelope-integrity-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "envelope-integrity", inventory),
    expected_exact_ref: exactRef,
    adapter,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, integrityCode);
  assert.equal(result.converged, false);
  malformed = false;
  const adapterFailure = await executeNamedWorkflow({
    workflow_id: "envelope-integrity", task: "must not converge", run_id: "adapter-integrity-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "envelope-integrity", inventory),
    expected_exact_ref: exactRef,
    adapter,
  });
  assert.equal(adapterFailure.ok, false);
  assert.equal(adapterFailure.code, adapterCode);
  assert.equal(adapterFailure.converged, false);
});

test("mixed casts route mock members locally and real members through the exact adapter", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-mixed-cast-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "mixed-cast", name: "Mixed cast", description: "Mock and exact members share one workflow.", start: "review",
    nodes: {
      review: parallel([
        agent({ role: "reviewer", stage_id: "mock-stage", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 }),
        agent({ role: "reviewer", stage_id: "real-stage", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 }),
      ], "objective", { max_concurrency: 2 }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    provider_policy: {
      exact: true,
      assignments: {
        "real-stage": { kind: "model", provider: "openrouter", model: "vendor/mixed:free", effort: "high" },
      },
      default_assignment: { kind: "model", provider: "mock", model: "mock-model", effort: "medium" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/mixed:free", reasoning: true, supported_efforts: ["high"] }];
  const exactRef = `sha256:${"9".repeat(64)}`;
  let adapterCalls = 0;
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true,
    async preflightExact() { return { ok: true, bindings: [{ provider: "openrouter" }], binding_ref: exactRef }; },
    attests: () => true,
    async runCandidate(spec, ctx) {
      adapterCalls += 1;
      return {
        schema_version: 2, run_id: ctx.run_id, stage: "candidate", role: spec.role,
        provider: spec.provider, model: spec.model,
        requested: { provider: spec.provider, model: spec.model, effort: spec.effort },
        effective: {
          provider: spec.provider, model: spec.model, effort: spec.effort,
          evidence: { provider: "verified-response", model: "verified-response", effort: "verified-session" },
        },
        attestation_ref: `sha256:${"7".repeat(64)}`,
        usage: { input_tokens: 1, output_tokens: 1 }, attempt: 1, iteration: 1,
        input_ref: { kind: "local-ref", value: "local-ref:input/mixed", algorithm: null },
        claims_ref: "local-ref:claims/mixed", evidence_ref: "local-ref:evidence/mixed",
        uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [], status: "ok",
      };
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "mixed-cast", task: "route each member exactly once", run_id: "mixed-cast-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "mixed-cast", inventory), expected_exact_ref: exactRef, adapter,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(adapterCalls, 1);
});

test("product agents receive exact declared tools, mutation, output, artifact, and visit context", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-agent-contract-"));
  const cwd = repo();
  const objective = { type: "file-contains", path: "result.md", contains: "READY" };
  const built = workflow({
    id: "agent-contract", name: "Agent contract", description: "Exercise the exact v4 agent contract.", start: "work",
    nodes: {
      work: { ...agent({
        role: "builder", stage_id: "work", output_schema: "semantic-v2",
        tools: ["read", "write"], mutation: "shared-serialized", timeout_ms: 1_000,
        artifact: { path: "result.md", kind: "notes" },
      }), next: "objective", max_visits: 2 },
      objective: { ...objectiveGate("success", "work"), loops_off: "failed" },
      success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: 2, structured_repair_attempts: 0 },
    provider_policy: {
      exact: true, assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/contract:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/contract:free", reasoning: true, supported_efforts: ["high"] }];
  const exactRef = `sha256:${"b".repeat(64)}`;
  const contexts = [];
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true,
    async preflightExact() { return { ok: true, bindings: [{ provider: "openrouter" }], binding_ref: exactRef }; },
    attests: () => true,
    async runCandidate(spec, ctx) {
      contexts.push({
        run_id: ctx.run_id, pass: ctx.pass, attempt: ctx.attempt, tools: structuredClone(ctx.tools),
        mutation: ctx.mutation, output_schema: structuredClone(ctx.output_schema), prompt: ctx.prompt, cwd: ctx.cwd,
      });
      writeFileSync(join(ctx.cwd, "result.md"), ctx.pass === 1 ? "draft\n" : "READY\n", "utf8");
      return exactEnvelope(spec, ctx, { recommendation: "built" });
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "agent-contract", task: "build the declared result", run_id: "agent-contract-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "agent-contract", inventory), expected_exact_ref: exactRef, adapter,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.total_passes, 2);
  assert.deepEqual(contexts.map(({ run_id, pass, attempt, tools, mutation, output_schema }) => ({
    run_id, pass, attempt, tools, mutation, output_schema,
  })), [
    {
      run_id: "agent-contract-run:work:1:member-0:attempt-1", pass: 1, attempt: 1,
      tools: ["read", "write"], mutation: "shared-serialized", output_schema: { id: "semantic-v2" },
    },
    {
      run_id: "agent-contract-run:work:2:member-0:attempt-1", pass: 2, attempt: 1,
      tools: ["read", "write"], mutation: "shared-serialized", output_schema: { id: "semantic-v2" },
    },
  ]);
  assert.match(contexts[0].prompt, /Stage: work · Pass: 1/);
  assert.match(contexts[0].prompt, /\{"kind":"notes","path":"result.md"\}/);
  assert.match(contexts[1].prompt, /Stage: work · Pass: 2/);
  assert.match(contexts[1].prompt, /"revision":\{"prior_node_output":/);
  assert.equal(readFileSync(join(result.worktree_path, "result.md"), "utf8"), "READY\n");
});

test("non-ok envelopes and output-schema violations cannot reach the objective gate", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-agent-result-contract-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "agent-result-contract", name: "Agent result contract", description: "Refuse unusable agent envelopes.", start: "review",
    nodes: {
      review: pipeline([agent({
        role: "reviewer", stage_id: "review", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000,
      })], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: 2, structured_repair_attempts: 1 },
    provider_policy: {
      exact: true, assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/result:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/result:free", reasoning: true, supported_efforts: ["high"] }];
  const exactRef = `sha256:${"c".repeat(64)}`;
  let outcome = {};
  let repairMode = false;
  let repairCalls = 0;
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true,
    async preflightExact() { return { ok: true, bindings: [{ provider: "openrouter" }], binding_ref: exactRef }; },
    attests: () => true,
    async runCandidate(spec, ctx) {
      if (repairMode) {
        repairCalls += 1;
        if (repairCalls === 1) {
          const error = new Error("pi-agent-semantic-output-invalid");
          error.usage = { input_tokens: 2, output_tokens: 1 };
          throw error;
        }
      }
      return exactEnvelope(spec, ctx, outcome);
    },
  };
  const binding = executionBinding(stateRoot, "agent-result-contract", inventory);
  for (const status of ["blocked", "failed", "refused", "timeout"]) {
    outcome = { status };
    const result = await executeNamedWorkflow({
      workflow_id: "agent-result-contract", task: "must not converge", run_id: `agent-status-${status}`, cwd,
      state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
      expected_binding_ref: binding, expected_exact_ref: exactRef, adapter,
    });
    assert.equal(result.code, `pi-agent-status-${status}`);
    assert.equal(result.converged, false);
  }
  outcome = { recommendation: "looks-good" };
  const invalidOutput = await executeNamedWorkflow({
    workflow_id: "agent-result-contract", task: "must not converge", run_id: "agent-output-invalid", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding, expected_exact_ref: exactRef, adapter,
  });
  assert.equal(invalidOutput.code, "kernel-agent-output-invalid");
  assert.equal(invalidOutput.converged, false);

  outcome = {};
  repairMode = true;
  const repaired = await executeNamedWorkflow({
    workflow_id: "agent-result-contract", task: "repair the closed output", run_id: "agent-output-repaired", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding, expected_exact_ref: exactRef, adapter,
  });
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  assert.equal(repairCalls, 2);
  const repairedCheckpoint = JSON.parse(readFileSync(
    join(stateRoot, "private", "runs", "agent-output-repaired", "kernel-checkpoint.json"), "utf8"));
  assert.equal(repairedCheckpoint.scheduler.budget.tokens, 6);
  const repairEvents = readFileSync(repaired.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(repairEvents.filter((event) => event.kind === "effect-repair").length, 1);
});

test("mock artifact mutation is one counted candidate effect, not a verifier or gate side effect", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-counted-mock-effect-"));
  const cwd = repo();
  const objective = { type: "file-contains", path: "mock-result.md", contains: "DONE" };
  const built = workflow({
    id: "counted-mock-effect", name: "Counted mock effect", description: "Mock mutations stay in the agent boundary.", start: "work",
    nodes: {
      work: { ...agent({
        role: "builder", stage_id: "work", mutation: "shared-serialized", timeout_ms: 1_000,
        artifact: { path: "mock-result.md", kind: "notes" },
      }), next: "objective", max_visits: 1 },
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "objective-failed"),
    },
    limits: { max_total_effects: 1 },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const result = await executeNamedWorkflow({
    workflow_id: "counted-mock-effect", task: "produce the mock artifact", run_id: "counted-mock-effect-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "counted-mock-effect"),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.calls.candidates, 1);
  const events = readFileSync(result.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === "effect-start").length, 1);
  assert.equal(events.filter((event) => event.kind === "effect-end").length, 1);
  assert.match(readFileSync(join(result.worktree_path, "mock-result.md"), "utf8"), /DONE/);
});

test("run-directory collisions refuse without creating a raw task artifact", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-collision-"));
  const cwd = repo();
  installWorkflow(stateRoot);
  mkdirSync(join(stateRoot, "runs", "collision-run"), { recursive: true });
  const expectedBinding = executionBinding(stateRoot, "user-loop");
  const result = await executeNamedWorkflow({
    workflow_id: "user-loop", task: "new task", run_id: "collision-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: expectedBinding,
  });
  assert.equal(result.code, "fresh-run-id-exists");
  assert.equal(existsSync(join(stateRoot, "private")), false);
});

test("execution validates required task and roots before filesystem effects", async () => {
  const missingTask = await executeNamedWorkflow({ run_id: "safe-run", task: "", cwd: "/tmp", state_root: "/tmp", package_root: "/tmp" });
  assert.equal(missingTask.code, "workflow-task-required");
  const missingRoot = await executeNamedWorkflow({ run_id: "safe-run", task: "x", cwd: "", state_root: "/tmp", package_root: "/tmp" });
  assert.equal(missingRoot.code, "workflow-execution-path-invalid");
});

test("execution refuses persisted workflows with unsafe outputs before reserving a run or worktree", async () => {
  for (const [index, path] of [".", "dir/", "a//b", ".git"].entries()) {
    const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-unsafe-output-"));
    const cwd = repo();
    const id = `unsafe-output-${index}`;
    const created = createWorkflowFromTemplate({ id, template: "implement-review" });
    assert.equal(created.ok, true);
    created.workflow.stages[0].artifact.path = path;
    created.workflow.stop.objective_gate.path = path;
    mkdirSync(join(stateRoot, "workflows"), { recursive: true });
    writeFileSync(join(stateRoot, "workflows", `${id}.json`), JSON.stringify(created.workflow), "utf8");
    const result = await executeNamedWorkflow({
      workflow_id: id, task: "must not run", run_id: `unsafe-run-${index}`, cwd,
      state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
      expected_binding_ref: `sha256:${"0".repeat(64)}`,
    });
    assert.equal(result.code, "invalid-workflow", path);
    assert.equal(existsSync(join(stateRoot, "runs")), false, path);
    assert.equal(existsSync(join(cwd, ".git")), true, path);
  }
});

test("completed failed user workflow resume is a structural no-op and never prints the legacy CLI", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-resume-"));
  const cwd = repo();
  installWorkflow(stateRoot);
  const controller = new AbortController();
  controller.abort("synthetic-terminal-cancel");
  const failed = await executeNamedWorkflow({
    workflow_id: "user-loop",
    task: "task that will be interrupted",
    run_id: "user-resume-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "user-loop"),
    signal: controller.signal,
    now: 1_751_731_200,
  });
  assert.equal(failed.ok, false);
  const resume = executeHelixCommand("runs resume user-resume-run", { mode: "print" }, {
    stateRoot,
    runsRoot: join(stateRoot, "runs"),
    chainRegistry: chains,
    runRegistry: runs,
  });
  assert.equal(resume.ok, true);
  assert.equal(resume.details.completed, true);
  assert.equal(resume.text.includes("helix-task-loop.mjs"), false);
  assert.equal(resume.details.cli_invocation, undefined);
});

test("built-in workflow keeps pinned workflow identity and completed resume never prints a broken CLI", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-built-in-resume-"));
  const cwd = repo();
  const controller = new AbortController();
  controller.abort("synthetic-terminal-cancel");
  const failed = await executeNamedWorkflow({
    workflow_id: "mock-core-loop",
    task: "exact built-in workflow task",
    run_id: "built-in-task-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "mock-core-loop"),
    signal: controller.signal,
    now: 1_751_731_200,
  });
  assert.equal(failed.ok, false);
  const state = JSON.parse(readFileSync(join(stateRoot, "runs", "built-in-task-run", "built-in-task-run.state.json"), "utf8"));
  assert.equal(state.workflow_id, "mock-core-loop");
  assert.equal(state.schema_version, 4);
  assert.equal(state.completed, true);

  const resume = executeHelixCommand("runs resume built-in-task-run", { mode: "print" }, {
    stateRoot,
    runsRoot: join(stateRoot, "runs"),
    chainRegistry: chains,
    runRegistry: runs,
  });
  assert.equal(resume.ok, true);
  assert.equal(resume.details.completed, true);
  assert.equal(resume.details.cli_invocation, undefined);
  assert.equal(resume.text.includes("helix-task-loop.mjs"), false);
});

test("built-in workflow projection preserves the tracked loop's pass, gate, and revision behavior", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-built-in-parity-"));
  const cwd = repo();
  writeFileSync(join(cwd, "proposal.txt"), "initial proposal\n", "utf8");
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "add tracked gate fixture"], { cwd });
  const result = await executeNamedWorkflow({
    workflow_id: "mock-core-loop",
    task: "exercise the tracked compatibility loop",
    run_id: "built-in-parity-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "mock-core-loop"),
    now: 1_751_731_200,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.total_passes, 3, "plan, implement gate failure, implement revision");
  assert.equal(result.calls.revisions, 1);
  const events = readFileSync(join(stateRoot, "runs", "built-in-parity-run", "built-in-parity-run.kernel.events.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.filter((event) => event.kind === "gate").map((event) => event.result), ["fail", "pass"]);
});

test("interrupted product workflow resumes from its private effect checkpoint without repeating committed work", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-kernel-resume-"));
  const cwd = repo();
  installWorkflow(stateRoot, "resume-loop");
  const binding = executionBinding(stateRoot, "resume-loop");
  const interrupted = await executeNamedWorkflow({
    workflow_id: "resume-loop",
    task: "resume this exact task",
    run_id: "kernel-resume-run",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: binding,
    onEvent(event) {
      if (event.kind === "effect-end") throw new Error("synthetic-process-boundary-stop");
    },
  });
  assert.equal(interrupted.ok, false);
  assert.equal(interrupted.code, "kernel-event-write-failed");
  assert.equal(interrupted.resumable, true);
  const statePath = join(stateRoot, "runs", "kernel-resume-run", "kernel-resume-run.state.json");
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).completed, false);
  const ready = executeHelixCommand("runs resume kernel-resume-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(ready.ok, true, JSON.stringify(ready));
  assert.equal(ready.details.in_process_resume, true);
  const resumed = await resumeNamedWorkflow({
    run_id: "kernel-resume-run",
    task: "resume this exact task",
    cwd,
    state_root: stateRoot,
    package_root: packageRoot,
    chain_registry: chains,
    run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.converged, true);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).completed, true);
});

test("post-publication snapshot cleanup failure remains durable maintenance debt", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-checkpoint-maintenance-"));
  const cwd = repo();
  installWorkflow(stateRoot, "checkpoint-maintenance");
  const runId = "checkpoint-maintenance-run";
  const outside = mkdtempSync(join(tmpdir(), "helix-checkpoint-symlink-"));
  let obstructed = null;
  const result = await executeNamedWorkflow({
    workflow_id: "checkpoint-maintenance", task: "retain cleanup debt", run_id: runId, cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "checkpoint-maintenance"),
    onEvent(event) {
      if (obstructed != null || event.kind !== "effect-start") return;
      const root = join(cwd, ".git", "helix-checkpoints", runId);
      const generation = readdirSync(root).find((entry) => entry.startsWith("kernel-"));
      assert.ok(generation);
      obstructed = generation;
      rmSync(join(root, generation), { recursive: true, force: true });
      symlinkSync(outside, join(root, generation), "dir");
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const document = JSON.parse(readFileSync(join(stateRoot, "private", "runs", runId, "kernel-checkpoint.json"), "utf8"));
  assert.equal(document.schema_version, 2);
  assert.equal(document.maintenance.cleanup_generations.includes(obstructed), true, JSON.stringify({ obstructed, maintenance: document.maintenance }));
  assert.equal(JSON.parse(readFileSync(join(stateRoot, "runs", runId, `${runId}.state.json`), "utf8")).completed, true);
  rmSync(stateRoot, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("product execution pins and runs a depth-one named subworkflow through the same kernel", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-product-subworkflow-"));
  const cwd = repo();
  const childGate = { type: "file-contains", path: "child.md", contains: "CHILD_PASS" };
  const child = workflow({
    id: "child-v4", name: "Child", description: "Child workflow.", start: "child-work",
    nodes: {
      "child-work": pipeline([agent({ role: "builder", stage_id: "child-work", mutation: "shared-serialized", timeout_ms: 1_000 })], "child-objective", { max_visits: 1, artifact: { path: "child.md", kind: "notes" } }),
      "child-objective": objectiveGate("child-success", "child-failed"),
      "child-success": terminal("succeeded"),
      "child-failed": terminal("failed", "child-gate-failed"),
    },
    objective_gate: childGate,
  });
  const parentGate = { type: "file-contains", path: "parent.md", contains: "PARENT_PASS" };
  const parent = workflow({
    id: "parent-v4", name: "Parent", description: "Parent workflow.", start: "parent-work",
    nodes: {
      "parent-work": pipeline([agent({ role: "builder", stage_id: "parent-work", mutation: "shared-serialized", timeout_ms: 1_000 })], "child", { max_visits: 1, artifact: { path: "parent.md", kind: "notes" } }),
      child: subworkflow("child-v4", 1, "parent-objective"),
      "parent-objective": objectiveGate("parent-success", "parent-failed"),
      "parent-success": terminal("succeeded"),
      "parent-failed": terminal("failed", "parent-gate-failed"),
    },
    objective_gate: parentGate,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const smoke = await smokeTestWorkflowRuntime({ workflow: parent.definition, subworkflows: [child.definition], cwd });
  assert.equal(smoke.ok, true, JSON.stringify(smoke));
  assert.equal(smoke.nodes_exercised, 7);
  assert.equal(smoke.effects_exercised, 2);
  assert.equal(smoke.transitions_exercised, 5);
  const result = await executeNamedWorkflow({
    workflow_id: "parent-v4", task: "run parent and child", run_id: "subworkflow-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "parent-v4"),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const events = readFileSync(join(stateRoot, "runs", "subworkflow-run", "subworkflow-run.kernel.events.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.kind === "subworkflow-event" && event.child_kind === "run-end"), true);
  const watch = executeHelixCommand("runs watch subworkflow-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(watch.ok, true, JSON.stringify(watch));
});

test("parent preflight includes every pinned child cast and runtime requirement", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-cast-preflight-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-real-cast", name: "Child real cast", description: "Child with a non-mock assignment.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "work", mutation: "read-only", timeout_ms: 1_000 })], "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "child-failed"),
    },
    provider_policy: {
      exact: true, assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/child:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: objective,
  });
  const parent = workflow({
    id: "parent-mock-cast", name: "Parent mock cast", description: "Parent whose child owns the real assignment.", start: "parent-work",
    nodes: {
      "parent-work": pipeline([agent({ role: "reviewer", stage_id: "parent-work", mutation: "read-only", timeout_ms: 1_000 })], "child"),
      child: subworkflow("child-real-cast", 1, "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/child:free", reasoning: true, supported_efforts: ["high"] }];
  const preflight = executeHelixCommand("run parent-mock-cast", { mode: "print" }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, modelInventory: inventory, cwd,
  });
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  assert.deepEqual(preflight.details.providers.sort(), ["mock", "openrouter"]);
  assert.equal(preflight.details.cast.some((stage) => stage.stage_id === "child-real-cast/work"), true);
  const result = await executeNamedWorkflow({
    workflow_id: "parent-mock-cast", task: "must preflight the child", run_id: "child-cast-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: preflight.details.execution_binding_ref,
  });
  assert.equal(result.code, "provider-exact-adapter-required");
  assert.equal(existsSync(join(stateRoot, "runs", "child-cast-run")), false);
});

test("child-only workflows deploy and compile agent prompts from the child objective", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-only-"));
  const cwd = repo();
  const childObjective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)", "child-objective-marker"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-only-work", name: "Child only work", description: "The child owns all model work.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "child-stage", mutation: "read-only", timeout_ms: 1_000 })], "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "child-failed"),
    },
    provider_policy: {
      exact: true, assignments: {},
      default_assignment: { kind: "model", provider: "openrouter", model: "vendor/child-only:free", effort: "high" },
      require_live_certification: false,
    },
    objective_gate: childObjective,
  });
  const parent = workflow({
    id: "parent-child-only", name: "Parent child only", description: "The parent has no local agent.", start: "child",
    nodes: {
      child: subworkflow("child-only-work", 1, "objective"),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
    },
    objective_gate: { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)", "parent-objective-marker"], timeout_ms: 1_000 },
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const inventory = [{ provider: "openrouter", model: "vendor/child-only:free", reasoning: true, supported_efforts: ["high"] }];
  const preflight = executeHelixCommand("run parent-child-only", { mode: "print" }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, modelInventory: inventory, cwd,
  });
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  const exactRef = `sha256:${"8".repeat(64)}`;
  let prompt = null;
  const adapter = {
    kind: "helix-pi-agent", exactMode: true, supportsProvider: () => true, attests: () => true,
    async preflightExact() { return { ok: true, bindings: [{ provider: "openrouter" }], binding_ref: exactRef }; },
    async runCandidate(spec, ctx) {
      prompt = ctx.prompt;
      return {
        schema_version: 2, run_id: ctx.run_id, stage: "candidate", role: spec.role,
        provider: spec.provider, model: spec.model,
        requested: { provider: spec.provider, model: spec.model, effort: spec.effort },
        effective: { provider: spec.provider, model: spec.model, effort: spec.effort,
          evidence: { provider: "verified-response", model: "verified-response", effort: "verified-session" } },
        attestation_ref: `sha256:${"7".repeat(64)}`, usage: { input_tokens: 1, output_tokens: 1 }, attempt: 1, iteration: 1,
        input_ref: { kind: "local-ref", value: "local-ref:input/child-only", algorithm: null },
        claims_ref: "local-ref:claims/child-only", evidence_ref: "local-ref:evidence/child-only",
        uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [], status: "ok",
      };
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "parent-child-only", task: "execute the child", run_id: "child-only-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: preflight.details.execution_binding_ref, expected_exact_ref: exactRef, adapter,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(prompt, /child-only-work/);
  assert.match(prompt, /child-objective-marker/);
  assert.doesNotMatch(prompt, /parent-objective-marker/);
});

test("parent and child input incompatibility refuses during deployment preflight", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-input-binding-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-input-closed", name: "Child input closed", description: "Child accepts only task.", start: "objective",
    nodes: { objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "child-failed") },
    objective_gate: objective,
  });
  const parent = workflow({
    id: "parent-input-extra", name: "Parent input extra", description: "Parent adds an input field.", start: "child",
    inputs: {
      type: "object", additionalProperties: false, required: ["task"],
      properties: { task: { type: "string", minLength: 1 }, mode: { type: "string", default: "safe" } },
    },
    nodes: {
      child: subworkflow("child-input-closed", 1, "objective"), objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const preflight = executeHelixCommand("run parent-input-extra", { mode: "print" }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, cwd,
  });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.code, "kernel-subworkflow-binding-invalid");
});

test("checkpoint resume consent is consumed by exactly one recorded visit", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-checkpoint-once-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const built = workflow({
    id: "checkpoint-once", name: "Checkpoint once", description: "Every visit requires fresh consent.", start: "approval",
    nodes: {
      approval: checkpoint("operator-approval", "route"),
      route: decision([{ when: { op: "always" }, target: "approval", loop: true }], "failed", { loops_off: "objective" }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "checkpoint-once");
  const paused = await executeNamedWorkflow({
    workflow_id: "checkpoint-once", task: "approve one visit", run_id: "checkpoint-once-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  const resumed = await resumeNamedWorkflow({
    run_id: "checkpoint-once-run", task: "approve one visit", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.stop_reason, "paused");
  const privateState = JSON.parse(readFileSync(join(stateRoot, "private", "runs", "checkpoint-once-run", "kernel-checkpoint.json"), "utf8"));
  assert.equal(privateState.scheduler.current, "approval");
  assert.equal(privateState.scheduler.active.visit, 2);
});

test("child checkpoint consent cannot auto-approve a fresh child execution", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-checkpoint-once-"));
  const cwd = repo();
  const objective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-checkpoint-once", name: "Child checkpoint once", description: "Child consent is visit-bound.", start: "approval",
    nodes: {
      approval: checkpoint("child-approval", "objective"), objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"), failed: terminal("failed", "child-failed"),
    },
    objective_gate: objective,
  });
  const parent = workflow({
    id: "parent-child-checkpoint-once", name: "Parent child checkpoint once", description: "A fresh child pauses again.", start: "child",
    nodes: {
      child: subworkflow("child-checkpoint-once", 1, "route"),
      route: decision([{ when: { op: "always" }, target: "child", loop: true }], "failed", { loops_off: "objective" }),
      objective: objectiveGate("success", "failed"), success: terminal("succeeded"), failed: terminal("failed", "parent-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const binding = executionBinding(stateRoot, "parent-child-checkpoint-once");
  const paused = await executeNamedWorkflow({
    workflow_id: "parent-child-checkpoint-once", task: "approve one child", run_id: "child-checkpoint-once-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  const resumed = await resumeNamedWorkflow({
    run_id: "child-checkpoint-once-run", task: "approve one child", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.stop_reason, "paused");
  const privateState = JSON.parse(readFileSync(
    join(stateRoot, "private", "runs", "child-checkpoint-once-run", "kernel-checkpoint.json"), "utf8",
  ));
  assert.equal(privateState.scheduler.current, "child");
  assert.equal(privateState.scheduler.active.child.scheduler.current, "approval");
  assert.equal(privateState.scheduler.active.child.scheduler.active.visit, 1);
});

test("a child checkpoint resumes through its namespaced parent state", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-child-checkpoint-"));
  const cwd = repo();
  const childObjective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const child = workflow({
    id: "child-pause", name: "Child pause", description: "Child pause workflow.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "work", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 })], "approval", { max_visits: 1 }),
      approval: checkpoint("child-approval", "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "child-failed"),
    },
    objective_gate: childObjective,
  });
  const parentObjective = { type: "command-exit-zero", command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1_000 };
  const parent = workflow({
    id: "parent-pause", name: "Parent pause", description: "Parent pause workflow.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "work", output_schema: "verdict-v1", mutation: "read-only", timeout_ms: 1_000 })], "child", { max_visits: 1 }),
      child: subworkflow("child-pause", 1, "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "parent-failed"),
    },
    objective_gate: parentObjective,
  });
  assert.equal(child.ok, true, JSON.stringify(child.errors));
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, child.definition).ok, true);
  assert.equal(saveUserWorkflowV4(stateRoot, parent.definition).ok, true);
  const binding = executionBinding(stateRoot, "parent-pause");
  const paused = await executeNamedWorkflow({
    workflow_id: "parent-pause", task: "pause child", run_id: "child-pause-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  const resumed = await resumeNamedWorkflow({
    run_id: "child-pause-run", task: "pause child", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.converged, true);
});

test("checkpoint node pauses durably and attended resume is its explicit continue action", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-product-checkpoint-"));
  const cwd = repo();
  const objective = { type: "file-contains", path: "checkpoint.md", contains: "PASS" };
  const built = workflow({
    id: "checkpoint-v4", name: "Checkpoint", description: "Checkpoint workflow.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "builder", stage_id: "work", mutation: "shared-serialized", timeout_ms: 1_000 })], "approval", { max_visits: 1, artifact: { path: "checkpoint.md", kind: "notes" } }),
      approval: checkpoint("operator-approval", "objective"),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.equal(saveUserWorkflowV4(stateRoot, built.definition).ok, true);
  const binding = executionBinding(stateRoot, "checkpoint-v4");
  const paused = await executeNamedWorkflow({
    workflow_id: "checkpoint-v4", task: "pause and continue", run_id: "checkpoint-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  });
  assert.equal(paused.stop_reason, "paused");
  assert.equal(JSON.parse(readFileSync(join(stateRoot, "runs", "checkpoint-run", "checkpoint-run.state.json"), "utf8")).completed, false);
  const watched = executeHelixCommand("runs watch checkpoint-run", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"), chainRegistry: chains, runRegistry: runs,
  });
  assert.equal(watched.ok, true, JSON.stringify(watched));
  assert.match(watched.text, /\(paused; resume required\)/);
  assert.match(watched.text, /Node: approval \(checkpoint, running\)/);
  const resumeOptions = {
    run_id: "checkpoint-run", task: "pause and continue", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: binding,
  };
  const attempts = await Promise.all([resumeNamedWorkflow(resumeOptions), resumeNamedWorkflow(resumeOptions)]);
  const resumed = attempts.find((entry) => entry.ok);
  const concurrent = attempts.find((entry) => entry.code === "resume-in-progress");
  assert.ok(resumed, JSON.stringify(attempts));
  assert.ok(concurrent, JSON.stringify(attempts));
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.converged, true);
});

test("execution refuses confirmation-source drift before reserving a run or calling an adapter", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-drift-"));
  const cwd = repo();
  installWorkflow(stateRoot);
  const expectedBinding = executionBinding(stateRoot, "user-loop");
  const workflowPath = join(stateRoot, "workflows", "user-loop.json");
  const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
  workflow.stop.max_iterations -= 1;
  writeFileSync(workflowPath, JSON.stringify(workflow), "utf8");
  let calls = 0;
  const result = await executeNamedWorkflow({
    workflow_id: "user-loop", task: "must not execute", run_id: "drift-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: expectedBinding,
    adapter: { runCandidate() { calls += 1; } },
  });
  assert.equal(result.code, "workflow-preflight-drift");
  assert.equal(calls, 0);
  assert.equal(existsSync(join(stateRoot, "runs", "drift-run")), false);
});

test("named v4 workflows refuse worktree-off before consent or run creation", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-worktree-required-"));
  const cwd = repo();
  installWorkflow(stateRoot, "worktree-required");
  const changed = executeHelixCommand("settings set worktree off", { mode: "tui", confirm: true }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, cwd,
  });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  const preflight = executeHelixCommand("run worktree-required", { mode: "tui" }, {
    stateRoot, chainRegistry: chains, runRegistry: runs, cwd,
  });
  assert.equal(preflight.code, "workflow-canonical-worktree-required");
  assert.equal(existsSync(join(stateRoot, "runs")), false);
});

test("real product execution requires an exact adapter before reserving a run", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-exact-adapter-"));
  const cwd = repo();
  const created = createWorkflowFromTemplate({ id: "real-exact-flow", template: "implement-review" });
  assert.equal(created.ok, true);
  created.workflow.deployment.default_assignment = {
    kind: "model", provider: "openrouter", model: "vendor/exact:free", effort: "high",
  };
  assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);
  const inventory = [{
    provider: "openrouter", model: "vendor/exact:free", reasoning: true,
    supported_efforts: ["high"],
  }];
  const adapter = {
    kind: "helix-pi-agent", exactMode: false,
    supportsProvider: () => true,
    async preflightExact() { throw new Error("must not accept non-exact adapter"); },
    runCandidate() { throw new Error("must not execute"); },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "real-exact-flow", task: "must not leave preflight", run_id: "exact-adapter-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "real-exact-flow", inventory), adapter,
  });
  assert.equal(result.code, "provider-exact-adapter-required");
  assert.equal(existsSync(join(stateRoot, "runs", "exact-adapter-run")), false);

  const singleTurnAdapter = createPiAgentAdapter({
    modelRegistry: {
      authStorage: { async getApiKey() { throw new Error("must not inspect credentials"); } },
      find: () => ({ provider: "openrouter", id: "vendor/exact:free" }),
      hasConfiguredAuth: () => true,
    },
    exactMode: true,
  });
  const toolBearing = await executeNamedWorkflow({
    workflow_id: "real-exact-flow", task: "must refuse before provider preflight", run_id: "exact-tools-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "real-exact-flow", inventory), adapter: singleTurnAdapter,
  });
  assert.equal(toolBearing.code, "provider-exact-multi-turn-disabled");
  assert.equal(existsSync(join(stateRoot, "runs", "exact-tools-run")), false);

  const exactAdapter = {
    kind: "helix-pi-agent", exactMode: true,
    supportsProvider: () => true,
    async preflightExact() {
      return {
        ok: true,
        bindings: [{
          provider: "openrouter", model: "vendor/exact:free", effort: "high",
          route: "ExactRoute", account_ref: `sha256:${"1".repeat(64)}`,
        }],
        binding_ref: `sha256:${"2".repeat(64)}`,
      };
    },
    attests: () => true,
    runCandidate() { throw new Error("must not execute after consent drift"); },
  };
  const drift = await executeNamedWorkflow({
    workflow_id: "real-exact-flow", task: "must not leave exact consent", run_id: "exact-consent-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "real-exact-flow", inventory),
    expected_exact_ref: `sha256:${"3".repeat(64)}`,
    adapter: exactAdapter,
  });
  assert.equal(drift.code, "provider-exact-consent-drift");
  assert.equal(existsSync(join(stateRoot, "runs", "exact-consent-run")), false);

  const mismatchAdapter = {
    ...exactAdapter,
    async runCandidate(spec, ctx) {
      return {
        schema_version: 2, run_id: ctx.run_id, stage: "candidate", role: spec.role,
        provider: spec.provider, model: spec.model,
        requested: { provider: spec.provider, model: spec.model, effort: spec.effort },
        effective: {
          provider: spec.provider, model: spec.model, effort: "low",
          evidence: { provider: "verified-response", model: "verified-response", effort: "verified-session" },
        },
        attestation_ref: `sha256:${"4".repeat(64)}`,
        usage: { input_tokens: 1, output_tokens: 1 }, attempt: 1, iteration: 1,
        input_ref: { kind: "local-ref", value: "local-ref:input/exact", algorithm: null },
        claims_ref: "local-ref:claims/exact", evidence_ref: "local-ref:evidence/exact",
        uncertainty: [], risks: [], recommendation: "approve", proposed_actions: [], open_questions: [], status: "ok",
      };
    },
  };
  const mismatch = await executeNamedWorkflow({
    workflow_id: "real-exact-flow", task: "refuse effective effort mismatch", run_id: "exact-mismatch-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "real-exact-flow", inventory),
    expected_exact_ref: `sha256:${"2".repeat(64)}`,
    adapter: mismatchAdapter,
  });
  assert.equal(mismatch.code, "provider-identity-unverified");
});

test("live-certification policy refuses before provider preflight when the adapter cannot prove it", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-live-cert-"));
  const cwd = repo();
  const created = createWorkflowFromTemplate({ id: "live-cert-flow", template: "implement-review" });
  assert.equal(created.ok, true);
  created.workflow.deployment.default_assignment = {
    kind: "model", provider: "openrouter", model: "vendor/exact:free", effort: "high",
  };
  const normalized = normalizeWorkflowDefinition(created.workflow);
  assert.equal(normalized.ok, true);
  normalized.definition.provider_policy.require_live_certification = true;
  assert.equal(saveUserWorkflowV4(stateRoot, normalized.definition).ok, true);
  const inventory = [{
    provider: "openrouter", model: "vendor/exact:free", reasoning: true,
    supported_efforts: ["high"],
  }];
  let preflightCalls = 0;
  const adapter = {
    kind: "helix-pi-agent",
    exactMode: true,
    liveCertification: false,
    supportsProvider: () => true,
    attests: () => true,
    async preflightExact() {
      preflightCalls += 1;
      return { ok: true, bindings: [] };
    },
  };
  const result = await executeNamedWorkflow({
    workflow_id: "live-cert-flow", task: "must refuse before provider egress", run_id: "live-cert-run", cwd,
    state_root: stateRoot, package_root: packageRoot, chain_registry: chains, run_registry: runs,
    expected_binding_ref: executionBinding(stateRoot, "live-cert-flow", inventory), adapter,
  });
  assert.equal(result.code, "provider-live-certification-required");
  assert.equal(preflightCalls, 0);
  assert.equal(existsSync(join(stateRoot, "runs", "live-cert-run")), false);
});
