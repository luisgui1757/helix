import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  executeHelixCommand,
  getHelixArgumentCompletions,
  isHelixMutationRequest,
  isHelixPruneRequest,
  renderHelixRunCompletion,
  renderWorkflowRuntimeTest,
} from "../extensions/lib/helix-command-core.mjs";
import { preflightTaskLoopConfig } from "../dispatch/lib/task-loop.mjs";
import { PUBLIC_SAFETY_PATTERNS } from "../tools/ci/public-safety-diff-scan.mjs";
import { createWorkflowFromTemplate } from "../dispatch/lib/workflows.mjs";
import { saveUserWorkflow } from "../extensions/lib/helix-workflows.mjs";
import { saveProfile, switchProfile } from "../extensions/lib/helix-local.mjs";
import { agent, objectiveGate, pipeline, terminal, workflow } from "../dispatch/workflow/builder.mjs";

const root = new URL("..", import.meta.url);
const testStateRoot = mkdtempSync(join(tmpdir(), "helix-command-state-"));
const originalStateRoot = process.env.HELIX_STATE_DIR;
process.env.HELIX_STATE_DIR = testStateRoot;

after(() => {
  if (originalStateRoot === undefined) delete process.env.HELIX_STATE_DIR;
  else process.env.HELIX_STATE_DIR = originalStateRoot;
  rmSync(testStateRoot, { recursive: true, force: true });
});

function readJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, root), "utf8"));
}

function tempRunsRoot() {
  return mkdtempSync(join(tmpdir(), "helix-command-runs-"));
}

function writeDebateRecord(root, runId = "safe-run") {
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${runId}.debate.json`), JSON.stringify({
    schema_version: 2,
    run_id: runId,
    timestamp: 0,
    kind: "adversarial-debate",
    adversarial: true,
    converged: true,
    stop_reason: "converged",
    iterations_run: 1,
    max_iterations: 1,
    total_tokens: 0,
    iterations: [{
      iteration: 1,
      run_id: `${runId}-iter1`,
      task_class: "routine-code",
      route_id: "routine-code",
      exit_status: "ok",
      gate_kind: "objective",
      gate_result: "pass",
      gate_source: "exit-status",
      gate_pass: true,
      diff_result: "stable",
      diff_code: "stable",
      converged: true,
      tokens_used: 0,
      cumulative_tokens: 0,
      warning_codes: [],
    }],
    warning_codes: [],
  }, null, 2), "utf8");
  return dir;
}

function malformedConfigRoot() {
  const malformedRoot = mkdtempSync(join(tmpdir(), "helix-command-malformed-"));
  mkdirSync(join(malformedRoot, "dispatch", "config"), { recursive: true });
  writeFileSync(join(malformedRoot, "dispatch", "config", "run-configs.json"), "{", "utf8");
  return malformedRoot;
}

function assertNoPublicSafetySignature(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const pattern of PUBLIC_SAFETY_PATTERNS) {
    assert.equal(pattern.re.test(text), false, pattern.code);
  }
}

test("helix dashboard renders active default config without provider calls", () => {
  const runsRoot = tempRunsRoot();
  const out = executeHelixCommand("", { mode: "print" }, { runsRoot });
  assert.equal(out.ok, true);
  assert.equal(out.details.default_config_id, "mock-core-loop");
  assert.equal(out.details.live_status, "no-live (mock providers only)");
  assert.equal(out.details.preflight.ok, true);
  // Preflight now mirrors the staged runner: it shows the resolved per-stage
  // cast, not the legacy role-matrix independence warning.
  assert.deepEqual(out.details.preflight.warnings, []);
  assert.deepEqual(out.details.preflight.cast.map((c) => c.executor_ref), ["composite:overlord", "composite:daily"]);
  assert.equal(out.text.includes("Live: no-live (mock providers only)"), true);
  assert.equal(out.text.includes("Rail: max_iterations=5"), true);
  assert.equal(out.text.includes("provider payload"), false);
  const rendered = JSON.stringify(out.details);
  assert.equal(rendered.includes("profile"), false);
  assert.equal(rendered.includes("write_allowlist"), false);
  assert.equal(rendered.includes("token_budget"), false);
});

test("helix run preflight renders the resolved installed-package workflow", () => {
  const out = executeHelixCommand("run mock-core-loop", { mode: "print" }, { runsRoot: tempRunsRoot() });
  assert.equal(out.ok, true);
  assert.equal(out.details.launches_loop, false);
  assert.equal(out.details.config_id, "mock-core-loop");
  assert.equal(out.details.cli_invocation, undefined);
  assert.equal(out.text.includes("Providers: mock"), true);
  assert.equal(out.text.includes("Live: no-live (mock providers only)"), true);
  assert.equal(out.text.includes("Rail: max_iterations=5"), true);
  assert.equal(out.text.includes("Parallel: max_concurrency=2"), true);
  assert.deepEqual(out.details.providers, ["mock"]);
  assert.equal(out.details.live_status, "no-live (mock providers only)");
  assert.deepEqual(out.details.rail, { max_iterations: 5, parallel: { max_concurrency: 2 } });
  assert.deepEqual(out.details.runtime_limits, { max_runtime_ms: 600_000, call_timeout_ms: 120_000 });
  assert.match(out.details.execution_binding_ref, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(out.details.cast[0].roles.planner[0], {
    provider: "mock", model: "mock-overlord-planner", effort: "max", instances: 1,
  });
  assert.match(out.text, /Exact cast:\n  plan \[composite:overlord\]/);
  assert.match(out.text, /planner: mock\/mock-overlord-planner:max x1/);
  const rendered = JSON.stringify(out.details);
  assert.equal(rendered.includes("profile"), false);
  assert.equal(rendered.includes("write_allowlist"), false);
  assert.equal(rendered.includes("token_budget"), false);
});

test("named workflows ignore irrelevant global profile stages visibly instead of failing cast resolution", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-cross-workflow-profile-"));
  const created = createWorkflowFromTemplate({ id: "tdd-user", template: "tdd-fix" });
  assert.equal(created.ok, true);
  assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);
  assert.equal(saveProfile(stateRoot, {
    schema_version: 1,
    profile_id: "full-cycle-cast",
    overrides: {
      assignments: {
        plan: { kind: "composite", preset: "overlord" },
        implement: { kind: "composite", preset: "daily" },
      },
    },
  }).ok, true);
  assert.equal(switchProfile(stateRoot, "full-cycle-cast").ok, true);

  const out = executeHelixCommand("run tdd-user", { mode: "print" }, {
    stateRoot, runsRoot: join(stateRoot, "runs"),
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.details.warnings, ["profile-stage-overrides-ignored:implement+plan"]);
  assert.match(out.text, /profile-stage-overrides-ignored:implement\+plan/);
});

test("user workflows with unavailable host effects are rejected before persistence", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-host-effects-"));
  const created = createWorkflowFromTemplate({ id: "host-flow" });
  assert.equal(created.ok, true);
  created.workflow.stages[0].steps.unshift({
    id: "check", kind: "local-check", note: "typed host check",
  });
  assert.equal(saveUserWorkflow(stateRoot, created.workflow).code, "invalid-workflow");
  assert.equal(existsSync(join(stateRoot, "workflows", "host-flow.json")), false);
});

test("workflow test fails deployment checks for an unknown preset instead of returning false green", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-preset-check-"));
  const created = createWorkflowFromTemplate({ id: "unknown-preset-flow" });
  assert.equal(created.ok, true);
  created.workflow.deployment.default_assignment = { kind: "composite", preset: "does-not-exist" };
  assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);

  const tested = executeHelixCommand("workflows test unknown-preset-flow", { mode: "print" }, { stateRoot });
  assert.equal(tested.ok, false);
  assert.equal(tested.code, "unknown-preset:does-not-exist");
});

test("workflow test refuses a missing objective-check executable", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-command-check-"));
  const created = createWorkflowFromTemplate({
    id: "missing-check-flow",
    objective_gate: {
      type: "command-exit-zero",
      command: "helix-definitely-missing-checker",
      args: [],
      timeout_ms: 10_000,
    },
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);
  const tested = executeHelixCommand("workflows test missing-check-flow", { mode: "print" }, { stateRoot });
  assert.equal(tested.code, "objective-gate-command-unavailable");
});

test("workflow deployment testing requires live model inventory for real casts", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-workflow-inventory-check-"));
  const created = createWorkflowFromTemplate({ id: "real-cast-flow" });
  assert.equal(created.ok, true);
  created.workflow.deployment.default_assignment = {
    kind: "model", provider: "openrouter", model: "cohere/north-mini-code:free", effort: "low",
  };
  assert.equal(saveUserWorkflow(stateRoot, created.workflow).ok, true);

  const unknown = executeHelixCommand("workflows test real-cast-flow", { mode: "print" }, { stateRoot });
  assert.equal(unknown.code, "helix-model-inventory-unavailable");

  const available = executeHelixCommand("workflows test real-cast-flow", { mode: "print" }, {
    stateRoot,
    modelInventory: [{
      provider: "openrouter",
      model: "cohere/north-mini-code:free",
      reasoning: true,
      supported_efforts: ["default", "provider-managed", "low", "medium", "high"],
    }],
  });
  assert.equal(available.ok, true, JSON.stringify(available));
});

test("workflow creation refuses unsafe durable-output and gate paths", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-unsafe-workflow-create-"));
  for (const [index, path] of [".", "dir/", "a//b", ".git"].entries()) {
    const out = executeHelixCommand(
      `workflows create unsafe-${index} implement-review ${path} MARKER 6`,
      { mode: "tui", confirm: true },
      { stateRoot },
    );
    assert.equal(out.code, "invalid-workflow", path);
  }
  assert.equal(existsSync(join(stateRoot, "workflows")), false);
});

test("native run completion renders only stable structural fields", () => {
  const complete = renderHelixRunCompletion({
    runId: "native-mock-run",
    configId: "mock-core-loop",
    exitCode: 0,
    converged: true,
    stopReason: "converged",
  });
  assert.equal(complete.ok, true);
  assert.match(complete.text, /Inspect: \/helix-run-status native-mock-run/);

  const failed = renderHelixRunCompletion({
    runId: "native-mock-run",
    configId: "mock-core-loop",
    exitCode: 1,
    stopReason: "/private/raw-error",
  });
  assert.equal(failed.code, "helix-runner-failed");
  assert.equal(failed.text.includes("Users"), false);
  assert.equal(failed.details.stop_reason, "unknown");

  const incomplete = renderHelixRunCompletion({
    runId: "native-mock-run",
    configId: "mock-core-loop",
    exitCode: 0,
  });
  assert.equal(incomplete.code, "helix-runner-result-invalid");
});

test("workflow runtime test renderer accepts only the proved smoke contract", () => {
  const complete = renderWorkflowRuntimeTest({
    workflowId: "my-flow",
    outcome: {
      ok: true,
      runner: "workflow-kernel-v4",
      provider_calls: 0,
      objective_check: "simulated",
      nodes_exercised: 4,
      effects_exercised: 2,
      transitions_exercised: 3,
      objective_gate_exercised: true,
    },
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.details.provider_calls, 0);

  for (const outcome of [
    { ok: true, runner: "staged-v1", provider_calls: 0, objective_check: "simulated", nodes_exercised: 4, effects_exercised: 2, transitions_exercised: 3, objective_gate_exercised: true },
    { ok: true, runner: "workflow-kernel-v4", provider_calls: 1, objective_check: "simulated", nodes_exercised: 4, effects_exercised: 2, transitions_exercised: 3, objective_gate_exercised: true },
    { ok: true, runner: "workflow-kernel-v4", provider_calls: 0, objective_check: "real", nodes_exercised: 4, effects_exercised: 2, transitions_exercised: 3, objective_gate_exercised: true },
    { ok: true, runner: "workflow-kernel-v4", provider_calls: 0, objective_check: "simulated", nodes_exercised: 0, effects_exercised: 2, transitions_exercised: 3, objective_gate_exercised: true },
    { ok: true, runner: "workflow-kernel-v4", provider_calls: 0, objective_check: "simulated", nodes_exercised: 4, effects_exercised: 2, transitions_exercised: Number.NaN, objective_gate_exercised: true },
    { ok: true, runner: "workflow-kernel-v4", provider_calls: 0, objective_check: "simulated", nodes_exercised: 4, effects_exercised: 2, transitions_exercised: 3, objective_gate_exercised: false },
  ]) {
    assert.equal(renderWorkflowRuntimeTest({ workflowId: "my-flow", outcome }).code, "workflow-runtime-smoke-invalid");
  }
});

test("helix run unknown config fails with stable error", () => {
  const out = executeHelixCommand("run missing-config", { mode: "print" }, { runsRoot: tempRunsRoot() });
  assert.equal(out.ok, false);
  assert.equal(out.status, "fail-closed");
  assert.equal(out.code, "unknown-run-config");
  assert.equal(out.details.detail, "config-id-not-found");
});

test("helix run unknown config does not echo private-path-shaped ids", () => {
  const out = executeHelixCommand("run /ho" + "me/someone/private", { mode: "print" }, { runsRoot: tempRunsRoot() });
  assert.equal(out.ok, false);
  assert.equal(out.code, "unknown-run-config");
  assert.equal(out.details.detail, "config-id-not-found");
  assertNoPublicSafetySignature(out.text);
  assertNoPublicSafetySignature(out.details);
});

test("helix execution returns stable fail-closed output when registry JSON is malformed", () => {
  const malformedRoot = malformedConfigRoot();
  for (const args of ["", "runs list", "runs prune safe-run"]) {
    assert.doesNotThrow(() => executeHelixCommand(args, { mode: "tui", confirm: true }, {
      root: malformedRoot,
      runsRoot: tempRunsRoot(),
    }));
    const out = executeHelixCommand(args, { mode: "tui", confirm: true }, {
      root: malformedRoot,
      runsRoot: tempRunsRoot(),
    });
    assert.equal(out.ok, false);
    assert.equal(out.status, "fail-closed");
    assert.equal(out.code, "helix-config-unreadable");
    assert.equal(out.details.detail, "run-configs.json");
    assert.equal(out.text.includes("SyntaxError"), false);
    assert.equal(out.text.includes(malformedRoot), false);
  }
});

test("helix help is view-only and does not require config loading", () => {
  const malformedRoot = malformedConfigRoot();
  const out = executeHelixCommand("help", { mode: "print" }, {
    root: malformedRoot,
    runsRoot: tempRunsRoot(),
  });
  assert.equal(out.ok, true);
  assert.equal(out.details.view_only, true);
  assert.equal(out.details.public_safe, true);
  assert.equal(out.details.launches_loop, false);
  assert.equal(out.details.live_calls, false);
  assert.equal(out.text.includes("docs/manual.md"), true);
});

test("helix prune is not called when config loading fails", () => {
  const malformedRoot = malformedConfigRoot();
  const runsRoot = tempRunsRoot();
  const dir = writeDebateRecord(runsRoot);
  const out = executeHelixCommand("runs prune safe-run", { mode: "tui", confirm: true }, {
    root: malformedRoot,
    runsRoot,
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "helix-config-unreadable");
  assert.equal(out.details.mutating, false);
  assert.equal(existsSync(dir), true);
});

test("helix models and chains are view-only; profiles serves overlay casts", () => {
  const options = { runsRoot: tempRunsRoot() };
  const models = executeHelixCommand("models", { mode: "print" }, options);
  const chains = executeHelixCommand("chains", { mode: "print" }, options);
  assert.equal(models.details.view_only, true);
  assert.equal(chains.details.view_only, true);
  assert.equal(models.details.roles.builder.models[0].provider, "mock");
  assert.equal(chains.details.chains.find((chain) => chain.id === "full-cycle").loop_runnable, true);
  assert.equal(chains.details.chains.find((chain) => chain.id === "full-cycle").stages[0].artifact.path, "PLAN.md");
  assert.equal(chains.details.chains.find((chain) => chain.id === "scout").loop_status, "chain-not-loop-runnable:scout");

  // The profiles verb now serves OVERLAY profiles (saved casts) — the old
  // cost-profile browser stays gone.
  const profiles = executeHelixCommand("profiles", { mode: "print" }, options);
  assert.equal(profiles.ok, true);
  assert.equal(profiles.title, "Helix profiles");
  assert.ok(Array.isArray(profiles.details.profiles));
  assert.ok(!JSON.stringify(profiles.details).includes("price"), "no cost-profile content survives");
});

test("helix hashes or omits every schema-valid registry prose field before rendering", () => {
  const localRoot = mkdtempSync(join(tmpdir(), "helix-command-prose-boundary-"));
  const matricesDir = join(localRoot, "matrices");
  mkdirSync(matricesDir, { recursive: true });
  const canary = "RAW MODEL RESPONSE CANARY";
  const body = "UNREDACTED RESPONSE BODY";
  const runRegistry = structuredClone(readJson("dispatch/config/run-configs.json"));
  runRegistry.configs[0].description = canary;
  runRegistry.configs[0].objective_gate.contains = body;
  const chainRegistry = structuredClone(readJson("dispatch/config/chains.json"));
  for (const chain of chainRegistry.chains) {
    chain.description = canary;
    for (const stage of chain.stages) {
      for (const step of stage.steps) if (step.kind !== "role") step.note = body;
    }
  }
  for (const id of ["daily", "overlord"]) {
    const preset = readJson(`dispatch/config/matrices/${id}.json`);
    preset.display_name = canary;
    preset.description = body;
    writeFileSync(join(matricesDir, `${id}.json`), JSON.stringify(preset), "utf8");
  }
  const packageJson = structuredClone(readJson("package.json"));
  packageJson.pi.extensions.push(`./extensions/${canary}`);
  const options = {
    root: localRoot,
    runsRoot: tempRunsRoot(),
    settingsPath: join(localRoot, "settings.json"),
    matricesDir,
    runRegistry,
    chainRegistry,
    roleMatrix: readJson("dispatch/config/role-matrix-defaults.json"),
    agentTeam: readJson("dispatch/config/agent-team-defaults.json"),
    packageJson,
  };

  try {
    for (const args of ["", "run mock-core-loop", "models", "chains", "setup"]) {
      const out = executeHelixCommand(args, { mode: "print" }, options);
      assert.equal(out.ok, true, `${args}: ${JSON.stringify(out)}`);
      const rendered = JSON.stringify(out);
      assert.equal(rendered.includes(canary), false, args);
      assert.equal(rendered.includes(body), false, args);
    }
    const completions = getHelixArgumentCompletions("run ", { runRegistry });
    assert.equal(JSON.stringify(completions).includes(canary), false);
  } finally {
    rmSync(localRoot, { recursive: true, force: true });
  }
});

test("helix chains derives loop-runnable status from the task route", () => {
  const registry = readJson("dispatch/config/chains.json");
  const builderStepArchitecture = {
    ...registry.chains[0],
    id: "builder-step-architecture",
    task_class: "architecture",
  };
  const out = executeHelixCommand("chains", { mode: "print" }, {
    runsRoot: tempRunsRoot(),
    chainRegistry: { ...registry, chains: [builderStepArchitecture] },
  });

  assert.equal(out.ok, true);
  assert.equal(out.details.chains[0].route_id, "architecture");
  assert.equal(out.details.chains[0].loop_runnable, false);
  assert.equal(out.details.chains[0].loop_status, "chain-not-loop-runnable:builder-step-architecture");
});

test("helix run preflight fails closed on legacy cost-control fields in a run config", () => {
  const runRegistry = readJson("dispatch/config/run-configs.json");
  const chainRegistry = readJson("dispatch/config/chains.json");
  const roleMatrix = readJson("dispatch/config/role-matrix-defaults.json");
  const agentTeam = readJson("dispatch/config/agent-team-defaults.json");
  const legacy = {
    ...runRegistry.configs[0],
    id: "legacy-cost-control",
    profile: { id: "no-spend-test" },
    token_budget: 1_000_000,
    write_allowlist: ["proposal.txt"],
  };
  const shared = preflightTaskLoopConfig(legacy, { chainRegistry, roleMatrix, agentTeam });
  const out = executeHelixCommand("run legacy-cost-control", { mode: "print" }, {
    runsRoot: tempRunsRoot(),
    runRegistry: { ...runRegistry, configs: [legacy] },
    chainRegistry,
    roleMatrix,
    agentTeam,
  });

  assert.equal(shared.ok, false);
  assert.equal(shared.code, "invalid-run-config");
  assert.match(shared.detail, /profile is not an allowed property/);
  assert.equal(out.ok, false);
  assert.equal(out.status, "fail-closed");
  assert.equal(out.code, "invalid-run-config-registry");
});

test("helix runs list and status use structural run-manager data only", () => {
  const runsRoot = tempRunsRoot();
  writeDebateRecord(runsRoot);

  const list = executeHelixCommand("runs list", { mode: "print" }, { runsRoot });
  assert.equal(list.ok, true);
  assert.equal(list.details.runs.length, 1);
  assert.deepEqual(Object.keys(list.details.runs[0]).sort(), [
    "iterations_run",
    "kind",
    "path",
    "prunable",
    "run_id",
    "status",
    "stop_reason",
    "total_tokens",
  ]);

  const status = executeHelixCommand("runs status safe-run", { mode: "print" }, { runsRoot });
  assert.equal(status.ok, true);
  assert.equal(status.details.entries[0].run_id, "safe-run");
  assert.equal(status.details.entries[0].prunable, true);
  assert.equal(JSON.stringify(status.details).includes("raw"), false);
  assert.equal(JSON.stringify(status.details).includes("transcript"), false);
});

test("helix run status refuses unsafe run ids through run-manager validation", () => {
  const out = executeHelixCommand("runs status ../escape", { mode: "print" }, { runsRoot: tempRunsRoot() });
  assert.equal(out.ok, false);
  assert.equal(out.code, "unsafe-run-id");
  assert.equal(out.details.detail, "run-id-pattern");
});

test("helix run refusals do not echo private-path-shaped run ids", () => {
  const runIds = [
    "/Us" + "ers/someone/private",
    "/ho" + "me/someone/private",
    "C:" + "\\Us" + "ers\\someone\\private",
  ];
  for (const runId of runIds) {
    const cases = [
      { args: `runs status ${runId}`, ctx: { mode: "tui", confirm: true } },
      { args: `runs prune ${runId}`, ctx: { mode: "tui", confirm: true } },
      { args: `runs prune ${runId}`, ctx: { mode: "tui" } },
    ];
    for (const { args, ctx } of cases) {
      const out = executeHelixCommand(args, ctx, { runsRoot: tempRunsRoot() });
      assert.equal(out.ok, false, args);
      assert.equal(out.code, "unsafe-run-id", args);
      assert.equal(out.details.detail, "run-id-pattern", args);
      assertNoPublicSafetySignature(out.text);
      assertNoPublicSafetySignature(out.details);
    }
  }
});

test("helix prune requires TUI mode and explicit confirm", () => {
  const runsRoot = tempRunsRoot();
  const dir = writeDebateRecord(runsRoot);

  const nonTui = executeHelixCommand("runs prune safe-run", { mode: "json", confirm: true }, { runsRoot });
  assert.equal(nonTui.ok, false);
  assert.equal(nonTui.code, "helix-mutation-requires-tui-confirm");
  assert.equal(nonTui.details.detail, "mode-not-tui");
  assert.equal(existsSync(dir), true);

  const missingConfirm = executeHelixCommand("runs prune safe-run", { mode: "tui" }, { runsRoot });
  assert.equal(missingConfirm.status, "cancelled");
  assert.equal(missingConfirm.code, "helix-mutation-cancelled");
  assert.equal(existsSync(dir), true);

  const falseConfirm = executeHelixCommand("runs prune safe-run", { mode: "tui", confirm: false }, { runsRoot });
  assert.equal(falseConfirm.status, "cancelled");
  assert.equal(existsSync(dir), true);

  const confirmed = executeHelixCommand("runs prune safe-run", { mode: "tui", confirm: true }, { runsRoot });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.details.mutating, true);
  assert.equal(existsSync(dir), false);
});

test("helix prune refuses root-resolving run ids even with TUI confirmation", () => {
  const runsRoot = tempRunsRoot();
  const sentinel = join(runsRoot, "sentinel.json");
  writeFileSync(sentinel, "{}", "utf8");
  const out = executeHelixCommand("runs prune .", { mode: "tui", confirm: true }, { runsRoot });

  assert.equal(out.ok, false);
  assert.equal(out.code, "unsafe-run-id");
  assert.equal(out.details.detail, "run-id-dot-segment");
  assert.equal(existsSync(sentinel), true);
});

test("helix completions expose only the single-command verb set", () => {
  assert.deepEqual(getHelixArgumentCompletions("").map((item) => item.label), [
    "help",
    "run",
    "runs",
    "models",
    "chains",
    "workflows",
    "settings",
    "profiles",
    "setup",
    "research",
  ]);
  assert.equal(isHelixPruneRequest("runs prune safe-run"), true);
  assert.equal(isHelixPruneRequest("run mock-core-loop"), false);
  for (const args of [
    "runs prune safe-run",
    "settings set loops off",
    "profiles create work",
    "profiles switch work",
    "setup work plan=daily",
    "workflows create my-flow implement-review",
    "workflows import flow.json",
  ]) assert.equal(isHelixMutationRequest(args), true, args);
  assert.equal(isHelixMutationRequest("research why --metric x >= 1 --max 1"), false);
});

test("v4 import is attended, validated, atomic, and immediately graphable", () => {
  const cwd = mkdtempSync(join(tmpdir(), "helix-v4-import-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-v4-import-state-"));
  const objective = { type: "file-contains", path: "result.md", contains: "PASS" };
  const built = workflow({
    id: "imported-v4", name: "Imported v4", description: "Imported test workflow.", start: "work",
    nodes: {
      work: pipeline([agent({ role: "reviewer", stage_id: "work", mutation: "read-only", timeout_ms: 1_000 })], "objective", { max_visits: 1 }),
      objective: objectiveGate("success", "failed"),
      success: terminal("succeeded"),
      failed: terminal("failed", "objective-failed"),
    },
    objective_gate: objective,
  });
  assert.equal(built.ok, true);
  writeFileSync(join(cwd, "flow.json"), JSON.stringify(built.definition));
  const options = { stateRoot, cwd };
  const refused = executeHelixCommand("workflows import flow.json", { mode: "print" }, options);
  assert.equal(refused.code, "helix-mutation-requires-tui-confirm");
  const imported = executeHelixCommand("workflows import flow.json", { mode: "tui", confirm: true }, options);
  assert.equal(imported.ok, true, JSON.stringify(imported));
  const saved = JSON.parse(readFileSync(join(stateRoot, "workflows", "imported-v4.json"), "utf8"));
  assert.equal(saved.schema_version, 4);
  const shown = executeHelixCommand("workflows show imported-v4", { mode: "print" }, options);
  assert.equal(shown.ok, true, JSON.stringify(shown));
  assert.match(shown.text, /objective \(gate\)/);
});

test("malformed v4 import returns a stable boundary refusal and writes nothing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "helix-v4-malformed-cwd-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "helix-v4-malformed-state-"));
  writeFileSync(join(cwd, "malformed.json"), JSON.stringify({
    schema_version: 4,
    id: "malformed",
    name: "Malformed",
    description: "Malformed workflow.",
    version: 1,
    source: "user",
    inputs: {},
    start: "work",
    nodes: null,
    limits: {},
    provider_policy: {},
    workspace_policy: {},
    objective_gate: {},
  }));
  const imported = executeHelixCommand("workflows import malformed.json", { mode: "tui", confirm: true }, { stateRoot, cwd });
  assert.equal(imported.ok, false);
  assert.equal(imported.code, "invalid-workflow-v4");
  assert.equal(existsSync(join(stateRoot, "workflows", "malformed.json")), false);
});

test("helix completions fail closed when run config completion input is malformed", () => {
  const malformedRoot = malformedConfigRoot();

  assert.deepEqual(getHelixArgumentCompletions("").map((item) => item.label), [
    "help",
    "run",
    "runs",
    "models",
    "chains",
    "workflows",
    "settings",
    "profiles",
    "setup",
    "research",
  ]);
  assert.equal(getHelixArgumentCompletions("run ", { root: malformedRoot }), null);
  assert.deepEqual(getHelixArgumentCompletions("runs ", { root: malformedRoot }).map((item) => item.label), [
    "list",
    "status",
    "watch",
    "resume",
    "prune",
  ]);
});
