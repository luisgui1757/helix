import test from "node:test";
import assert from "node:assert/strict";
import {
  humanChoice,
  objectiveGate,
  terminal,
  workflow,
} from "../dispatch/workflow/builder.mjs";
import { runWorkflowKernel } from "../dispatch/kernel/scheduler.mjs";
import { journalRef } from "../dispatch/kernel/journal.mjs";
import { observedWorkflowGraph } from "../dispatch/workflow/visualize.mjs";
import {
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
} from "../dispatch/workflow/schema.mjs";

const objective = { type: "file-contains", path: "proposal.txt", contains: "PASS" };

function choiceDefinition() {
  const built = workflow({
    id: "human-routing",
    name: "Human routing",
    description: "Pause for one durable human route.",
    start: "route",
    nodes: {
      route: humanChoice("Which route?", [
        { id: "fast", label: "Fast route", target: "objective" },
        { id: "safe", label: "Safe route", target: "objective" },
      ], { allow_custom: true, custom_target: "objective" }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.definition;
}

function deps(runId, mode, checkpoints) {
  return {
    run_id: runId,
    execution_mode: mode,
    task_ref: journalRef(`${runId}:task`),
    runtime_ref: journalRef(`${runId}:runtime`),
    workspace: {
      currentRef: () => journalRef(`${runId}:workspace`),
      verifyRef: () => true,
    },
    async executeAgent() { throw new Error("no agent"); },
    async runGate() { return { result: "pass" }; },
    async onCheckpoint(state) {
      checkpoints.push(structuredClone(state));
      return { ok: true };
    },
  };
}

test("WorkflowDefinition v5 adds human choice without changing direct v4 admission", () => {
  const definition = choiceDefinition();
  assert.equal(definition.schema_version, 5);
  assert.equal(validateWorkflowDefinition(definition).valid, true);
  const v4 = structuredClone(definition);
  v4.schema_version = 4;
  assert.equal(validateWorkflowDefinition(v4).valid, false);
  delete v4.nodes.route;
  v4.start = "objective";
  assert.equal(normalizeWorkflowDefinition(v4).ok, true);
  assert.equal(normalizeWorkflowDefinition(v4).migrated, false);
});

for (const executionMode of ["original-mode", "graph-mode"]) {
  test(`human choice pauses durably and resumes once in ${executionMode}`, async () => {
    const definition = choiceDefinition();
    const checkpoints = [];
    const base = deps(`human-${executionMode}`, executionMode, checkpoints);
    const paused = await runWorkflowKernel(definition, { task: "choose" }, base);
    assert.equal(paused.status, "paused");
    assert.equal(paused.code, "kernel-human-choice-required");
    const checkpoint = checkpoints.at(-1);
    assert.deepEqual(checkpoint.active.boundary.status, "inflight");
    assert.equal(paused.events.some((event) => event.kind === "human-choice"), false);

    const resumedCheckpoints = [];
    const resumed = await runWorkflowKernel(definition, { task: "choose" }, {
      ...deps(`human-${executionMode}`, executionMode, resumedCheckpoints),
      resume: checkpoint,
      resume_events: paused.events,
      human_choice: {
        run_id: `human-${executionMode}`,
        node_id: "route",
        visit: 1,
        kind: "option",
        option_id: "safe",
      },
    });
    assert.equal(resumed.status, "succeeded");
    assert.deepEqual(resumed.outputs.route, { kind: "option", option_id: "safe" });
    const events = [...paused.events, ...resumed.events];
    const graph = observedWorkflowGraph(definition, events, { execution_mode: executionMode });
    assert.equal(graph.ok, true, graph.code);
    const transition = resumed.events.find((event) => event.kind === "transition" && event.node_id === "route");
    assert.equal(transition.target, "objective");
    if (executionMode === "graph-mode") {
      assert.equal(transition.edge_id, "route:choice:safe");
      assert.equal(transition.edge_kind, "choice");
    }
  });
}

test("human choice refuses an unbound or oversized response without advancing", async () => {
  const definition = choiceDefinition();
  const checkpoints = [];
  const base = deps("human-invalid", "original-mode", checkpoints);
  const paused = await runWorkflowKernel(definition, { task: "choose" }, base);
  const resumed = await runWorkflowKernel(definition, { task: "choose" }, {
    ...deps("human-invalid", "original-mode", []),
    resume: checkpoints.at(-1),
    resume_events: paused.events,
    human_choice: {
      run_id: "other-run",
      node_id: "route",
      visit: 1,
      kind: "custom",
      text: "x".repeat(4_097),
    },
  });
  assert.equal(resumed.status, "paused");
  assert.equal(resumed.code, "kernel-human-choice-required");
  assert.equal(resumed.events.some((event) => event.kind === "transition"), false);
});

test("human choice keeps custom text private while preserving an exact structural route", async () => {
  const definition = choiceDefinition();
  const checkpoints = [];
  const paused = await runWorkflowKernel(
    definition,
    { task: "choose" },
    deps("human-custom", "graph-mode", checkpoints),
  );
  const text = "Use the private migration context";
  const resumed = await runWorkflowKernel(definition, { task: "choose" }, {
    ...deps("human-custom", "graph-mode", []),
    resume: checkpoints.at(-1),
    resume_events: paused.events,
    human_choice: {
      run_id: "human-custom",
      node_id: "route",
      visit: 1,
      kind: "custom",
      text,
    },
  });
  assert.equal(resumed.status, "succeeded");
  assert.deepEqual(resumed.outputs.route, { kind: "custom", text });
  assert.equal(JSON.stringify(resumed.events).includes(text), false);
  const event = resumed.events.find((candidate) => candidate.kind === "human-choice");
  assert.deepEqual(event.selection, "custom");
  const transition = resumed.events.find(
    (candidate) => candidate.kind === "transition" && candidate.node_id === "route",
  );
  assert.equal(transition.edge_id, "route:custom");
});

test("human choice refuses a forged settled checkpoint before emitting an event", async () => {
  const definition = choiceDefinition();
  const checkpoints = [];
  const paused = await runWorkflowKernel(
    definition,
    { task: "choose" },
    deps("human-forged", "original-mode", checkpoints),
  );
  const forged = structuredClone(checkpoints.at(-1));
  forged.active.boundary = {
    ...forged.active.boundary,
    status: "settled",
    result: { kind: "option", option_id: "unbound" },
  };
  const resumed = await runWorkflowKernel(definition, { task: "choose" }, {
    ...deps("human-forged", "original-mode", []),
    resume: forged,
    resume_events: paused.events,
  });
  assert.equal(resumed.status, "refused");
  assert.equal(resumed.code, "kernel-checkpoint-boundary-invalid");
  assert.deepEqual(resumed.events ?? [], []);
});

test("cancellation during either human-choice checkpoint wins before pause or routing", async () => {
  const definition = choiceDefinition();
  const openingController = new AbortController();
  const opening = await runWorkflowKernel(definition, { task: "choose" }, {
    ...deps("human-cancel-opening", "original-mode", []),
    signal: openingController.signal,
    async onCheckpoint(state) {
      if (state.active?.boundary?.kind === "human-choice") openingController.abort();
      return { ok: true };
    },
  });
  assert.equal(opening.status, "cancelled");
  assert.equal(opening.code, "kernel-run-cancelled");

  const checkpoints = [];
  const paused = await runWorkflowKernel(
    definition,
    { task: "choose" },
    deps("human-cancel-settled", "graph-mode", checkpoints),
  );
  const settledController = new AbortController();
  const resumed = await runWorkflowKernel(definition, { task: "choose" }, {
    ...deps("human-cancel-settled", "graph-mode", []),
    signal: settledController.signal,
    resume: checkpoints.at(-1),
    resume_events: paused.events,
    human_choice: {
      run_id: "human-cancel-settled",
      node_id: "route",
      visit: 1,
      kind: "option",
      option_id: "safe",
    },
    async onCheckpoint(state) {
      if (state.active?.boundary?.status === "settled") settledController.abort();
      return { ok: true };
    },
  });
  assert.equal(resumed.status, "cancelled");
  assert.equal(resumed.code, "kernel-run-cancelled");
  assert.equal(resumed.events.some((event) => event.kind === "human-choice"), false);
});
