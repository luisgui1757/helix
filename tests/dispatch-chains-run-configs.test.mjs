import { chmodSync, mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveChain,
  validateChainRegistry,
} from "../dispatch/lib/chains.mjs";
import {
  resolveRunConfig,
  validateRunConfigRegistry,
} from "../dispatch/lib/run-configs.mjs";
import {
  createNoLiveMockAdapter,
  runTaskLoop,
  preflightTaskLoopConfig,
  decideTaskLoopTransition,
  makeCommandExitZeroGate,
  preflightObjectiveGate,
} from "../dispatch/lib/task-loop.mjs";
import { MAX_ITERATIONS, MAX_PANEL_MEMBERS } from "../dispatch/lib/limits.mjs";

const root = new URL("..", import.meta.url);
const NOW = 1_751_731_200;

test("task-loop mode uses canonical workflow retry and loops-off degeneration", () => {
  assert.deepEqual(decideTaskLoopTransition(true), { action: "retry", code: null });
  assert.deepEqual(decideTaskLoopTransition(false), {
    action: "advance",
    code: null,
    warning: "loops-off-transition-ignored:task-loop:retry",
  });
});

test("command objective gates resolve an executable and use argv without a shell", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "helix-command-gate-"));
  const passing = {
    type: "command-exit-zero",
    command: "node",
    args: ["-e", "process.exit(0)"],
    timeout_ms: 5_000,
  };
  assert.equal(preflightObjectiveGate(cwd, passing).ok, true);
  if (process.platform !== "win32") {
    const local = join(cwd, "helix-local-check");
    writeFileSync(local, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(local, 0o755);
    assert.equal(preflightObjectiveGate(cwd, { ...passing, command: "helix-local-check" }, {
      env: { PATH: "" },
    }).ok, true, "an empty PATH segment resolves against the run cwd");
  }
  assert.deepEqual(await makeCommandExitZeroGate(cwd, passing)(), {
    command_names: ["command-exit-zero:node"], result: "pass", source: "deterministic-checker",
  });
  const failing = { ...passing, args: ["-e", "process.exit(7)"] };
  assert.equal((await makeCommandExitZeroGate(cwd, failing)()).result, "fail");

  const controller = new AbortController();
  controller.abort();
  let spawns = 0;
  const aborted = await makeCommandExitZeroGate(cwd, passing, {
    signal: controller.signal,
    spawnEffect() { spawns += 1; },
  })();
  assert.equal(aborted.result, "fail");
  assert.equal(spawns, 0, "a pre-aborted gate must not create a process");
});

function readJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, root), "utf8"));
}

function chainRegistry() {
  return readJson("dispatch/config/chains.json");
}

function runRegistry() {
  return readJson("dispatch/config/run-configs.json");
}

function roleMatrix() {
  return readJson("dispatch/config/role-matrix-defaults.json");
}

function agentTeam() {
  return readJson("dispatch/config/agent-team-defaults.json");
}

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "helix-loop-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Test"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial proposal\n", "utf8");
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

function tempRepoWithSymlinkedProposal(marker = "HELIX_LOOP_PASS\n") {
  const outside = mkdtempSync(join(tmpdir(), "helix-loop-outside-"));
  const outsidePath = join(outside, "outside.txt");
  writeFileSync(outsidePath, marker, "utf8");

  const cwd = mkdtempSync(join(tmpdir(), "helix-loop-symlink-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Test"], { cwd });
  symlinkSync(outsidePath, join(cwd, "proposal.txt"));
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return { cwd, outsidePath };
}

test("default chain registry is valid and resolves named chains", () => {
  const registry = chainRegistry();
  const { valid, errors } = validateChainRegistry(registry);
  assert.equal(valid, true, JSON.stringify(errors));
  assert.equal(resolveChain(registry, "full-cycle").ok, true);
  assert.equal(resolveChain(registry, "tdd-fix").ok, true);
  assert.equal(resolveChain(registry, "scout").chain.task_class, "architecture");
  assert.equal(resolveChain(registry, "research").ok, true);
  assert.equal(resolveChain(registry, "ship-pre-pr").chain.task_class, "pr-preflight");
  assert.equal(resolveChain(registry, "missing").code, "unknown-chain");
});

test("malformed chain registry fails closed, including recursive-looking steps", () => {
  const registry = chainRegistry();
  const malformed = {
    ...registry,
    chains: [
      {
        ...registry.chains[0],
        stages: [
          {
            id: "one",
            steps: [
              { id: "implement", kind: "role", role: "builder", chain: "scout" },
            ],
          },
        ],
      },
    ],
  };
  const result = resolveChain(malformed, "full-cycle");
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid-chain-registry");
});

test("default run config registry is valid and resolves mock-core-loop", () => {
  const registry = runRegistry();
  const { valid, errors } = validateRunConfigRegistry(registry);
  assert.equal(valid, true, JSON.stringify(errors));
  const resolved = resolveRunConfig(registry, "mock-core-loop");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.config.max_iterations, 5);
  assert.equal(resolved.config.parallel.max_concurrency, 2);
  assert.equal(resolveRunConfig(registry, "missing").code, "unknown-run-config");
});

test("run config fails closed on unsafe gate paths, duplicate ids, and removed cost-control fields", () => {
  const registry = runRegistry();
  const badGate = {
    ...registry,
    configs: [
      {
        ...registry.configs[0],
        objective_gate: { ...registry.configs[0].objective_gate, path: "../outside.txt" },
      },
    ],
  };
  assert.equal(resolveRunConfig(badGate, "mock-core-loop").code, "invalid-run-config-registry");

  const duplicate = {
    ...registry,
    configs: [registry.configs[0], { ...registry.configs[0] }],
  };
  assert.equal(resolveRunConfig(duplicate, "mock-core-loop").code, "invalid-run-config-registry");

  // Cost control left the harness: its config fields are unknown properties now.
  for (const removed of [
    { profile: "no-spend-test" },
    { token_budget: 1_000_000 },
    { write_allowlist: ["proposal.txt"] },
    { live: { enabled: false } },
  ]) {
    const withRemoved = {
      ...registry,
      configs: [{ ...registry.configs[0], ...removed }],
    };
    assert.equal(
      resolveRunConfig(withRemoved, "mock-core-loop").code,
      "invalid-run-config-registry",
      JSON.stringify(removed),
    );
  }
});

test("run config iteration and concurrency rails have practical maxima", () => {
  const registry = runRegistry();
  const atLimits = {
    ...registry,
    configs: [{
      ...registry.configs[0],
      max_iterations: MAX_ITERATIONS,
      parallel: { max_concurrency: MAX_PANEL_MEMBERS },
    }],
  };
  assert.equal(validateRunConfigRegistry(atLimits).valid, true);
  for (const override of [
    { max_iterations: MAX_ITERATIONS + 1 },
    { max_iterations: Number.MAX_SAFE_INTEGER + 1 },
    { parallel: { max_concurrency: MAX_PANEL_MEMBERS + 1 } },
  ]) {
    const invalid = {
      ...registry,
      configs: [{ ...registry.configs[0], ...override }],
    };
    assert.equal(validateRunConfigRegistry(invalid).valid, false, JSON.stringify(override));
  }
});

test("bounded task loop converges over a real temp repo with no-live mock adapters", async () => {
  const cwd = tempRepo();
  const recordDir = mkdtempSync(join(tmpdir(), "helix-loop-records-"));
  const config = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
    record_dir: recordDir,
    run_id: "task-loop-test",
  });

  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.debate?.detail }));
  assert.equal(result.debate.converged, true);
  assert.equal(result.debate.iterations_run, 3);
  assert.equal(result.calls.candidates, 9);
  assert.equal(result.calls.revisions, 2);
  assert.equal(readFileSync(join(cwd, "proposal.txt"), "utf8").includes("HELIX_LOOP_PASS"), true);
  assert.ok(existsSync(join(recordDir, "task-loop-test.debate.json")));
});

test("an injected dispatch adapter without a revision adapter fails closed instead of throwing", async () => {
  const cwd = tempRepo();
  const config = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const injected = createNoLiveMockAdapter();
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
    run_id: "missing-revision-adapter",
    adapter: injected.dispatchAdapter,
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "revision-failed");
  assert.match(result.debate.detail, /revision-subcode:revision-missing-adapter/);
});

test("task loop refuses a symlinked objective gate before accepting outside evidence", async () => {
  const { cwd, outsidePath } = tempRepoWithSymlinkedProposal();
  const recordDir = mkdtempSync(join(tmpdir(), "helix-loop-records-"));
  const config = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
    record_dir: recordDir,
    run_id: "loop-symlink-gate",
  });

  assert.equal(readFileSync(outsidePath, "utf8").includes(config.objective_gate.contains), true);
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "revision-failed");
  assert.equal(result.debate.iterations_run, 1);
  assert.equal(result.debate.iterations[0].gate_result, "fail");
  assert.equal(result.debate.iterations[0].gate_pass, false);
  assert.match(result.debate.detail, /revision-subcode:revision-unsafe-path/);

  const firstRecord = JSON.parse(readFileSync(join(recordDir, "loop-symlink-gate-iter1.json"), "utf8"));
  assert.deepEqual(firstRecord.gate.command_names, ["file-contains:proposal.txt", "unsafe-gate-path"]);
  assert.equal(firstRecord.gate.result, "fail");
});

test("task loop refuses non-automated providers before dispatch or revision adapters run", async () => {
  const cwd = tempRepo();
  const config = {
    ...resolveRunConfig(runRegistry(), "mock-core-loop").config,
    role_matrix: "claude-local-matrix",
  };
  const badMatrix = {
    schema_version: 1,
    matrix_id: "claude-local-matrix",
    roles: {
      builder: [{ provider: "claude-local", model: "claude-cli", effort: "default", instances: 1 }],
      reviewer: [{ provider: "openai-codex", model: "codex-review", effort: "default", instances: 1 }],
      redteam: [{ provider: "openai-codex", model: "codex-redteam", effort: "default", instances: 1 }],
    },
  };
  const adapterCalls = { candidates: 0 };
  const revisionCalls = { revisions: 0 };
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: badMatrix,
  }, {
    cwd,
    now: NOW,
    seed: 7,
    adapter: {
      runCandidate() {
        adapterCalls.candidates += 1;
        throw new Error("should not launch");
      },
    },
    revisionAdapter: {
      runRevision() {
        revisionCalls.revisions += 1;
        throw new Error("should not revise");
      },
    },
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "matrix-provider-not-automated:claude-local");
  assert.equal(adapterCalls.candidates, 0);
  assert.equal(revisionCalls.revisions, 0);
});

test("task loop refuses a real-provider cast before any injected adapter or revision effect", async () => {
  const cwd = tempRepo();
  const config = {
    ...resolveRunConfig(runRegistry(), "mock-core-loop").config,
    role_matrix: "live-matrix",
  };
  const liveMatrix = {
    schema_version: 1,
    matrix_id: "live-matrix",
    roles: {
      builder: [{ provider: "openrouter", model: "vendor/builder", effort: "default", instances: 1 }],
      reviewer: [{ provider: "openai-codex", model: "codex-review", effort: "default", instances: 1 }],
      redteam: [{ provider: "github-copilot", model: "copilot-redteam", effort: "default", instances: 1 }],
    },
  };
  const injected = createNoLiveMockAdapter();
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: liveMatrix,
  }, {
    cwd,
    now: NOW,
    seed: 7,
    adapter: injected.dispatchAdapter,
    revisionAdapter: injected.revisionAdapter({ "proposal.txt": "HELIX_LOOP_PASS\n" }),
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "live-adapter-not-wired");
  assert.deepEqual(injected.calls, { candidates: 0, judges: 0, synthesis: 0, verifiers: 0, revisions: 0 });
  assert.equal(readFileSync(join(cwd, "proposal.txt"), "utf8"), "initial proposal\n");
});

test("task loop reports non-builder chains as not loop-runnable", async () => {
  const cwd = tempRepo();
  const config = {
    ...resolveRunConfig(runRegistry(), "mock-core-loop").config,
    chain: "scout",
  };
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "chain-not-loop-runnable:scout");
});

test("task loop refuses configs carrying removed cost-control fields before adapters run", async () => {
  const cwd = tempRepo();
  const base = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const config = { ...base, token_budget: 1_000_000 };
  const adapterCalls = { candidates: 0 };
  const result = await runTaskLoop(config, {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  }, {
    cwd,
    now: NOW,
    seed: 7,
    adapter: {
      runCandidate() {
        adapterCalls.candidates += 1;
        throw new Error("should not launch");
      },
    },
  });

  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "invalid-run-config");
  assert.equal(adapterCalls.candidates, 0);
});

test("preflight carries no profile and the loop still requires an injected clock", async () => {
  const config = resolveRunConfig(runRegistry(), "mock-core-loop").config;
  const registries = {
    chainRegistry: chainRegistry(),
    roleMatrix: roleMatrix(),
    agentTeam: agentTeam(),
  };
  const pre = preflightTaskLoopConfig(config, registries);
  assert.equal(pre.ok, true, JSON.stringify({ code: pre.code, detail: pre.detail }));
  assert.equal("profile" in pre, false);

  // runTaskLoop still needs deps.now for record timestamps (fail closed, no ambient clock).
  const cwd = tempRepo();
  const result = await runTaskLoop(config, registries, { cwd, seed: 7 });
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "missing-clock");
});
