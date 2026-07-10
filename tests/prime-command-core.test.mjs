import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executePrimeCommand,
  getPrimeArgumentCompletions,
  isPrimeMutationRequest,
  isPrimePruneRequest,
} from "../extensions/lib/prime-command-core.mjs";
import { preflightTaskLoopConfig } from "../dispatch/lib/task-loop.mjs";
import { PUBLIC_SAFETY_PATTERNS } from "../tools/ci/public-safety-diff-scan.mjs";

const root = new URL("..", import.meta.url);

function readJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, root), "utf8"));
}

function tempRunsRoot() {
  return mkdtempSync(join(tmpdir(), "prime-command-runs-"));
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
  const malformedRoot = mkdtempSync(join(tmpdir(), "prime-command-malformed-"));
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

test("prime dashboard renders active default config without provider calls", () => {
  const runsRoot = tempRunsRoot();
  const out = executePrimeCommand("", { mode: "print" }, { runsRoot });
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

test("prime run preflight renders resolved config and exact CLI command", () => {
  const out = executePrimeCommand("run mock-core-loop", { mode: "print" }, { runsRoot: tempRunsRoot() });
  assert.equal(out.ok, true);
  assert.equal(out.details.launches_loop, false);
  assert.equal(out.details.config_id, "mock-core-loop");
  assert.equal(out.details.cli_invocation, "node tools/loop/prime-task-loop.mjs --config mock-core-loop --run-id mock-core-loop-manual");
  assert.equal(out.text.includes("Providers: mock"), true);
  assert.equal(out.text.includes("Live: no-live (mock providers only)"), true);
  assert.equal(out.text.includes("Rail: max_iterations=5"), true);
  assert.equal(out.text.includes("Parallel: max_concurrency=2"), true);
  assert.deepEqual(out.details.providers, ["mock"]);
  assert.equal(out.details.live_status, "no-live (mock providers only)");
  assert.deepEqual(out.details.rail, { max_iterations: 5, parallel: { max_concurrency: 2 } });
  const rendered = JSON.stringify(out.details);
  assert.equal(rendered.includes("profile"), false);
  assert.equal(rendered.includes("write_allowlist"), false);
  assert.equal(rendered.includes("token_budget"), false);
});

test("prime run unknown config fails with stable error", () => {
  const out = executePrimeCommand("run missing-config", { mode: "print" }, { runsRoot: tempRunsRoot() });
  assert.equal(out.ok, false);
  assert.equal(out.status, "fail-closed");
  assert.equal(out.code, "unknown-run-config");
  assert.equal(out.details.detail, "config-id-not-found");
});

test("prime run unknown config does not echo private-path-shaped ids", () => {
  const out = executePrimeCommand("run /ho" + "me/someone/private", { mode: "print" }, { runsRoot: tempRunsRoot() });
  assert.equal(out.ok, false);
  assert.equal(out.code, "unknown-run-config");
  assert.equal(out.details.detail, "config-id-not-found");
  assertNoPublicSafetySignature(out.text);
  assertNoPublicSafetySignature(out.details);
});

test("prime execution returns stable fail-closed output when registry JSON is malformed", () => {
  const malformedRoot = malformedConfigRoot();
  for (const args of ["", "runs list", "runs prune safe-run"]) {
    assert.doesNotThrow(() => executePrimeCommand(args, { mode: "tui", confirm: true }, {
      root: malformedRoot,
      runsRoot: tempRunsRoot(),
    }));
    const out = executePrimeCommand(args, { mode: "tui", confirm: true }, {
      root: malformedRoot,
      runsRoot: tempRunsRoot(),
    });
    assert.equal(out.ok, false);
    assert.equal(out.status, "fail-closed");
    assert.equal(out.code, "prime-config-unreadable");
    assert.equal(out.details.detail, "run-configs.json");
    assert.equal(out.text.includes("SyntaxError"), false);
    assert.equal(out.text.includes(malformedRoot), false);
  }
});

test("prime help is view-only and does not require config loading", () => {
  const malformedRoot = malformedConfigRoot();
  const out = executePrimeCommand("help", { mode: "print" }, {
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

test("prime prune is not called when config loading fails", () => {
  const malformedRoot = malformedConfigRoot();
  const runsRoot = tempRunsRoot();
  const dir = writeDebateRecord(runsRoot);
  const out = executePrimeCommand("runs prune safe-run", { mode: "tui", confirm: true }, {
    root: malformedRoot,
    runsRoot,
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "prime-config-unreadable");
  assert.equal(out.details.mutating, false);
  assert.equal(existsSync(dir), true);
});

test("prime models and chains are view-only; profiles serves overlay casts", () => {
  const options = { runsRoot: tempRunsRoot() };
  const models = executePrimeCommand("models", { mode: "print" }, options);
  const chains = executePrimeCommand("chains", { mode: "print" }, options);
  assert.equal(models.details.view_only, true);
  assert.equal(chains.details.view_only, true);
  assert.equal(models.details.roles.builder.models[0].provider, "mock");
  assert.equal(chains.details.chains.find((chain) => chain.id === "full-cycle").loop_runnable, true);
  assert.equal(chains.details.chains.find((chain) => chain.id === "full-cycle").stages[0].artifact.path, "PLAN.md");
  assert.equal(chains.details.chains.find((chain) => chain.id === "scout").loop_status, "chain-not-loop-runnable:scout");

  // The profiles verb now serves OVERLAY profiles (saved casts) — the old
  // cost-profile browser stays gone.
  const profiles = executePrimeCommand("profiles", { mode: "print" }, options);
  assert.equal(profiles.ok, true);
  assert.equal(profiles.title, "Prime profiles");
  assert.ok(Array.isArray(profiles.details.profiles));
  assert.ok(!JSON.stringify(profiles.details).includes("price"), "no cost-profile content survives");
});

test("prime hashes or omits every schema-valid registry prose field before rendering", () => {
  const localRoot = mkdtempSync(join(tmpdir(), "prime-command-prose-boundary-"));
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
      for (const step of stage.steps) step.note = body;
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
  const projectSettings = structuredClone(readJson(".pi/settings.json"));
  projectSettings.extensions.push(`../extensions/${body}`);
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
    settings: projectSettings,
  };

  try {
    for (const args of ["", "run mock-core-loop", "models", "chains", "setup"]) {
      const out = executePrimeCommand(args, { mode: "print" }, options);
      assert.equal(out.ok, true, `${args}: ${JSON.stringify(out)}`);
      const rendered = JSON.stringify(out);
      assert.equal(rendered.includes(canary), false, args);
      assert.equal(rendered.includes(body), false, args);
    }
    const completions = getPrimeArgumentCompletions("run ", { runRegistry });
    assert.equal(JSON.stringify(completions).includes(canary), false);
  } finally {
    rmSync(localRoot, { recursive: true, force: true });
  }
});

test("prime chains derives loop-runnable status from the task route", () => {
  const registry = readJson("dispatch/config/chains.json");
  const builderStepArchitecture = {
    ...registry.chains[0],
    id: "builder-step-architecture",
    task_class: "architecture",
  };
  const out = executePrimeCommand("chains", { mode: "print" }, {
    runsRoot: tempRunsRoot(),
    chainRegistry: { ...registry, chains: [builderStepArchitecture] },
  });

  assert.equal(out.ok, true);
  assert.equal(out.details.chains[0].route_id, "architecture");
  assert.equal(out.details.chains[0].loop_runnable, false);
  assert.equal(out.details.chains[0].loop_status, "chain-not-loop-runnable:builder-step-architecture");
});

test("prime run preflight fails closed on legacy cost-control fields in a run config", () => {
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
  const out = executePrimeCommand("run legacy-cost-control", { mode: "print" }, {
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

test("prime runs list and status use structural run-manager data only", () => {
  const runsRoot = tempRunsRoot();
  writeDebateRecord(runsRoot);

  const list = executePrimeCommand("runs list", { mode: "print" }, { runsRoot });
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

  const status = executePrimeCommand("runs status safe-run", { mode: "print" }, { runsRoot });
  assert.equal(status.ok, true);
  assert.equal(status.details.entries[0].run_id, "safe-run");
  assert.equal(status.details.entries[0].prunable, true);
  assert.equal(JSON.stringify(status.details).includes("raw"), false);
  assert.equal(JSON.stringify(status.details).includes("transcript"), false);
});

test("prime run status refuses unsafe run ids through run-manager validation", () => {
  const out = executePrimeCommand("runs status ../escape", { mode: "print" }, { runsRoot: tempRunsRoot() });
  assert.equal(out.ok, false);
  assert.equal(out.code, "unsafe-run-id");
  assert.equal(out.details.detail, "run-id-pattern");
});

test("prime run refusals do not echo private-path-shaped run ids", () => {
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
      const out = executePrimeCommand(args, ctx, { runsRoot: tempRunsRoot() });
      assert.equal(out.ok, false, args);
      assert.equal(out.code, "unsafe-run-id", args);
      assert.equal(out.details.detail, "run-id-pattern", args);
      assertNoPublicSafetySignature(out.text);
      assertNoPublicSafetySignature(out.details);
    }
  }
});

test("prime prune requires TUI mode and explicit confirm", () => {
  const runsRoot = tempRunsRoot();
  const dir = writeDebateRecord(runsRoot);

  const nonTui = executePrimeCommand("runs prune safe-run", { mode: "json", confirm: true }, { runsRoot });
  assert.equal(nonTui.ok, false);
  assert.equal(nonTui.code, "prime-mutation-requires-tui-confirm");
  assert.equal(nonTui.details.detail, "mode-not-tui");
  assert.equal(existsSync(dir), true);

  const missingConfirm = executePrimeCommand("runs prune safe-run", { mode: "tui" }, { runsRoot });
  assert.equal(missingConfirm.status, "cancelled");
  assert.equal(missingConfirm.code, "prime-mutation-cancelled");
  assert.equal(existsSync(dir), true);

  const falseConfirm = executePrimeCommand("runs prune safe-run", { mode: "tui", confirm: false }, { runsRoot });
  assert.equal(falseConfirm.status, "cancelled");
  assert.equal(existsSync(dir), true);

  const confirmed = executePrimeCommand("runs prune safe-run", { mode: "tui", confirm: true }, { runsRoot });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.details.mutating, true);
  assert.equal(existsSync(dir), false);
});

test("prime prune refuses root-resolving run ids even with TUI confirmation", () => {
  const runsRoot = tempRunsRoot();
  const sentinel = join(runsRoot, "sentinel.json");
  writeFileSync(sentinel, "{}", "utf8");
  const out = executePrimeCommand("runs prune .", { mode: "tui", confirm: true }, { runsRoot });

  assert.equal(out.ok, false);
  assert.equal(out.code, "unsafe-run-id");
  assert.equal(out.details.detail, "run-id-dot-segment");
  assert.equal(existsSync(sentinel), true);
});

test("prime completions expose only the single-command verb set", () => {
  assert.deepEqual(getPrimeArgumentCompletions("").map((item) => item.label), [
    "help",
    "run",
    "runs",
    "models",
    "chains",
    "settings",
    "profiles",
    "setup",
    "research",
  ]);
  assert.equal(isPrimePruneRequest("runs prune safe-run"), true);
  assert.equal(isPrimePruneRequest("run mock-core-loop"), false);
  for (const args of [
    "runs prune safe-run",
    "settings set loops off",
    "profiles create work",
    "profiles switch work",
    "setup work plan=daily",
  ]) assert.equal(isPrimeMutationRequest(args), true, args);
  assert.equal(isPrimeMutationRequest("research why --metric x >= 1 --max 1"), false);
});

test("prime completions fail closed when run config completion input is malformed", () => {
  const malformedRoot = malformedConfigRoot();

  assert.deepEqual(getPrimeArgumentCompletions("").map((item) => item.label), [
    "help",
    "run",
    "runs",
    "models",
    "chains",
    "settings",
    "profiles",
    "setup",
    "research",
  ]);
  assert.equal(getPrimeArgumentCompletions("run ", { root: malformedRoot }), null);
  assert.deepEqual(getPrimeArgumentCompletions("runs ", { root: malformedRoot }).map((item) => item.label), [
    "list",
    "status",
    "watch",
    "resume",
    "prune",
  ]);
});
