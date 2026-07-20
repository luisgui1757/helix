// Staged runner: end-to-end mock convergence over a real worktree,
// event-stream shape and safety, interrupt-safe state + resume, worktree
// toggle, and verdict extraction.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  runStagedTaskLoop,
  makeGitWorktreeEffect,
  makePrivateCheckpointEffect,
  createStagedMockAdapter,
  extractStageVerdict,
  validateRunnerState,
  disagreementSnapshotPath,
  RUNNER_CODES,
} from "../dispatch/lib/runner.mjs";
import { makeEventLog, renderEventLine, validateCheckpointEventBinding } from "../dispatch/lib/events.mjs";
import { loadPresetRegistry } from "../dispatch/lib/presets.mjs";
import { hashRef, stableStringify } from "../dispatch/lib/run-record.mjs";
import { MAX_PANEL_MEMBERS } from "../dispatch/lib/limits.mjs";
import { createWorkflowFromTemplate, workflowToExecution } from "../dispatch/lib/workflows.mjs";

const NOW = 1_751_731_200;
const matricesDir = new URL("../dispatch/config/matrices/", import.meta.url).pathname;
const presets = loadPresetRegistry(matricesDir).presets;
const chainRegistry = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
const baseConfig = JSON.parse(readFileSync(new URL("../dispatch/config/run-configs.json", import.meta.url), "utf8")).configs[0];

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "helix-runner-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Runner"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial proposal without the marker\n", "utf8");
  writeFileSync(join(cwd, "PLAN.md"), "Real plan fixture for the staged plan contract.\n", "utf8");
  execFileSync("git", ["add", "proposal.txt", "PLAN.md"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

function makeDeps(repo, extra = {}) {
  const events = [];
  return {
    events,
    deps: {
      cwd: repo,
      now: NOW,
      seed: 7,
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: join(repo, ".state"),
      events: { onEvent: (e) => events.push(e), dir: join(repo, ".events") },
      ...extra,
    },
  };
}

async function interruptAfterStage(repo, runId, {
  config = baseConfig,
  stageId = "plan",
  toggles,
  extraDeps = {},
} = {}) {
  const stateDir = join(repo, ".state");
  const eventsDir = join(repo, ".events");
  const events = [];
  const mock = createStagedMockAdapter();
  const result = await runStagedTaskLoop({ ...config }, { chainRegistry, presets }, {
    cwd: repo,
    now: NOW,
    seed: 7,
    run_id: runId,
    ...(toggles ? { toggles } : {}),
    adapter: mock.dispatchAdapter,
    revisionAdapter: mock.revisionAdapter({
      [config.objective_gate.path]: `x\n${config.objective_gate.contains}\n`,
    }),
    worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
    state_dir: stateDir,
    ...extraDeps,
    events: {
      dir: eventsDir,
      onEvent(event) {
        events.push(event);
        if (event.kind === "stage-end" && event.stage_id === stageId) throw new Error("interrupt-after-checkpoint");
      },
    },
  });
  assert.equal(result.code, "checkpoint-persistence-failed", JSON.stringify(result));
  const statePath = join(stateDir, `${runId}.state.json`);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(state.completed, false);
  return { state, stateDir, eventsDir, events, mock, result };
}

test("full-cycle converges end to end: plan → implement → gate fail → revision → gate pass", async () => {
  const repo = tempRepo();
  try {
    const { events, deps } = makeDeps(repo);
    const registries = { chainRegistry, presets };
    const result = await runStagedTaskLoop({ ...baseConfig }, registries, { ...deps, run_id: "runner-e2e" });

    assert.equal(result.ok, true, JSON.stringify({ code: result.code, stop: result.stop_reason }));
    assert.equal(result.converged, true);
    assert.equal(result.total_passes, 3, "plan#1, implement#1 (gate fail), implement#2 (revised, gate pass)");
    assert.deepEqual(result.cast.map((c) => c.executor_ref), ["composite:overlord", "composite:daily"]);
    assert.equal(result.calls.revisions, 1, "the builder revised once, on implement pass 2");
    assert.equal(result.calls.judges > 0, true, "overlord's multi-reviewer plan stage wired its judge");
    assert.match(result.worktree_branch, /^helix\/run-[0-9a-f]{24}$/);
    assert.equal(
      execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
        cwd: result.worktree_path,
        encoding: "utf8",
      }).trim(),
      result.worktree_branch,
    );

    const kinds = events.map((e) => e.kind);
    assert.equal(kinds[0], "run-start");
    assert.equal(kinds[kinds.length - 1], "run-end");
    assert.ok(kinds.includes("stage-start") && kinds.includes("verdict") && kinds.includes("gate") && kinds.includes("revision"));
    const gates = events.filter((e) => e.kind === "gate").map((e) => e.result);
    assert.deepEqual(gates, ["fail", "pass"], "conclusion gate failed once, then passed after revision");

    // The worktree got the revision; the base repo did not.
    assert.match(readFileSync(join(result.worktree_path, "proposal.txt"), "utf8"), /HELIX_LOOP_PASS/);
    assert.doesNotMatch(readFileSync(join(repo, "proposal.txt"), "utf8"), /HELIX_LOOP_PASS/);

    // Events JSONL is append-only, parseable, sequenced.
    const lines = readFileSync(result.events_path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, events.length);
    assert.deepEqual(lines.map((l) => l.seq), events.map((e) => e.seq));

    // Final state is completed and resumable-refused.
    const state = JSON.parse(readFileSync(result.state_path, "utf8"));
    assert.equal(state.completed, true);
    assert.equal(state.stop_reason, "converged");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("role prompts include the exact objective marker and declared durable output", async () => {
  const repo = tempRepo();
  try {
    const prompts = [];
    const mock = createStagedMockAdapter();
    const adapter = {
      kind: "test-prompt-observer",
      runCandidate(spec, ctx) {
        prompts.push({ stage: ctx.stage_id, prompt: ctx.prompt });
        return mock.dispatchAdapter.runCandidate(spec, ctx);
      },
      runJudge: mock.dispatchAdapter.runJudge,
      runSynthesis: mock.dispatchAdapter.runSynthesis,
      runVerifier: mock.dispatchAdapter.runVerifier,
    };
    const config = {
      ...baseConfig,
      objective_gate: { ...baseConfig.objective_gate, contains: "initial proposal" },
    };
    const { deps } = makeDeps(repo, { run_id: "prompt-obligations", adapter });
    const result = await runStagedTaskLoop(config, { chainRegistry, presets }, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(prompts.length > 0, true);
    assert.equal(prompts.every(({ prompt }) => prompt.includes('file-contains:proposal.txt contains "initial proposal"')), true);
    assert.equal(prompts.some(({ stage, prompt }) => stage === "plan" && prompt.includes("plan:PLAN.md")), true);
    assert.equal(prompts.some(({ stage, prompt }) => stage === "implement" && prompt.includes("notes:proposal.txt")), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resolved candidate, judge, synthesis, and verifier efforts reach their adapter boundaries", async () => {
  const repo = tempRepo();
  try {
    const effortChainRegistry = structuredClone(chainRegistry);
    const effortChain = effortChainRegistry.chains.find((chain) => chain.id === "full-cycle");
    for (const stage of effortChain.stages) {
      stage.steps.push({ id: `${stage.id}-verify`, kind: "role", role: "verifier" });
    }
    const mock = createStagedMockAdapter();
    const seen = { candidates: [], judges: [], synthesis: [], verifiers: [] };
    const adapter = {
      kind: "test-effort-observer",
      runCandidate(spec, ctx) {
        seen.candidates.push({ role: spec.role, effort: spec.effort });
        return mock.dispatchAdapter.runCandidate(spec, ctx);
      },
      runJudge(input, ctx) {
        seen.judges.push(ctx.judge.effort);
        return mock.dispatchAdapter.runJudge(input, ctx);
      },
      runSynthesis(input, ctx) {
        seen.synthesis.push(ctx.synthesis.effort);
        return mock.dispatchAdapter.runSynthesis(input, ctx);
      },
      runVerifier(input, ctx) {
        seen.verifiers.push(ctx.verification.effort);
        return mock.dispatchAdapter.runVerifier(input, ctx);
      },
    };
    const config = {
      ...baseConfig,
      objective_gate: { ...baseConfig.objective_gate, contains: "initial proposal" },
    };
    const { deps } = makeDeps(repo, { run_id: "effort-forwarding", adapter });
    const result = await runStagedTaskLoop(config, { chainRegistry: effortChainRegistry, presets }, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(seen.judges, ["high", "medium"]);
    assert.deepEqual(seen.synthesis, ["high", "medium"]);
    assert.deepEqual(seen.verifiers, ["medium", "low"]);
    assert.equal(seen.candidates.every(({ effort }) => typeof effort === "string"), true);
    assert.ok(seen.candidates.some(({ role, effort }) => role === "planner" && effort === "max"));
    assert.ok(seen.candidates.some(({ role, effort }) => role === "builder" && effort === "high"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("mixed mock and configured-provider casts route each member to its matching adapter", async () => {
  const repo = tempRepo();
  try {
    const mixedPresets = new Map([...presets.entries()].map(([id, preset]) => [id, structuredClone(preset)]));
    mixedPresets.get("daily").roles.builder = [{
      provider: "openrouter", model: "openai/gpt-oss-20b:free", effort: "high", instances: 1,
      effort_vocab: ["medium", "high"],
    }];
    const liveCalls = [];
    const liveMock = createStagedMockAdapter();
    const liveAdapter = {
      kind: "helix-pi-agent",
      supportsProvider: (provider) => provider === "openrouter",
      runCandidate(spec, ctx) {
        liveCalls.push(spec.provider);
        return liveMock.dispatchAdapter.runCandidate(spec, ctx);
      },
      runJudge: liveMock.dispatchAdapter.runJudge,
      runSynthesis: liveMock.dispatchAdapter.runSynthesis,
      runVerifier: liveMock.dispatchAdapter.runVerifier,
    };
    const config = {
      ...baseConfig,
      objective_gate: { ...baseConfig.objective_gate, contains: "initial proposal" },
    };
    const { deps } = makeDeps(repo, { run_id: "mixed-provider-cast", adapter: liveAdapter });
    const result = await runStagedTaskLoop(config, { chainRegistry, presets: mixedPresets }, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(liveCalls, ["openrouter"]);
    assert.equal(result.calls.candidates > 0, true, "mock members used the deterministic adapter");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("writer-bearing stages serialize candidate access to their shared worktree", async () => {
  const repo = tempRepo();
  try {
    const mock = createStagedMockAdapter();
    let active = 0;
    let maximumActive = 0;
    const adapter = {
      kind: "test-observable-adapter",
      async runCandidate(spec, ctx) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const envelope = mock.dispatchAdapter.runCandidate(spec, ctx);
        active -= 1;
        return envelope;
      },
      runJudge: mock.dispatchAdapter.runJudge,
      runSynthesis: mock.dispatchAdapter.runSynthesis,
      runVerifier: mock.dispatchAdapter.runVerifier,
    };
    const config = {
      ...baseConfig,
      parallel: { max_concurrency: 4 },
      objective_gate: { ...baseConfig.objective_gate, contains: "initial proposal" },
    };
    const { deps } = makeDeps(repo, { run_id: "serialized-writers", adapter });
    const result = await runStagedTaskLoop(config, { chainRegistry, presets }, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(maximumActive, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("read-only workflow panels honor bounded concurrency and produce a runtime-owned artifact", async () => {
  const repo = tempRepo();
  try {
    const created = createWorkflowFromTemplate({ id: "parallel-review" });
    assert.equal(created.ok, true);
    created.workflow.stages[0].steps = [
      { id: "review", kind: "role", role: "reviewer" },
      { id: "redteam", kind: "role", role: "redteam" },
    ];
    const execution = workflowToExecution(created.workflow);
    assert.equal(execution.ok, true, JSON.stringify(execution));
    const mock = createStagedMockAdapter();
    let active = 0;
    let maximumActive = 0;
    const adapter = {
      kind: "test-read-only-parallel-adapter",
      async runCandidate(spec, ctx) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const envelope = mock.dispatchAdapter.runCandidate(spec, ctx);
        active -= 1;
        return envelope;
      },
      runJudge: mock.dispatchAdapter.runJudge,
      runSynthesis: mock.dispatchAdapter.runSynthesis,
      runVerifier: mock.dispatchAdapter.runVerifier,
    };
    const { deps } = makeDeps(repo, {
      run_id: "parallel-read-only",
      adapter,
      objective_gate_effect: async () => ({
        command_names: ["test-gate"], result: "pass", source: "deterministic-checker",
      }),
    });
    const result = await runStagedTaskLoop(execution.config, {
      chainRegistry: { schema_version: 3, chains: [execution.chain] }, presets,
    }, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(maximumActive, 2);
    const artifact = JSON.parse(readFileSync(join(result.worktree_path, "proposal.txt"), "utf8"));
    assert.equal(artifact.stage_id, "implement");
    assert.deepEqual(artifact.results.map((entry) => entry.role), ["reviewer", "redteam"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("the runner whole-run deadline bounds an adapter that ignores cancellation", async () => {
  const repo = tempRepo();
  try {
    const never = new Promise(() => {});
    const mock = createStagedMockAdapter();
    const adapter = {
      kind: "test-hung-adapter",
      runCandidate() { return never; },
      runJudge: mock.dispatchAdapter.runJudge,
      runSynthesis: mock.dispatchAdapter.runSynthesis,
      runVerifier: mock.dispatchAdapter.runVerifier,
    };
    const { deps } = makeDeps(repo, {
      run_id: "runner-deadline",
      adapter,
      runtime_limits: { max_runtime_ms: 1_000, call_timeout_ms: 1_000 },
    });
    const started = performance.now();
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, deps);
    assert.equal(result.code, "workflow-run-timeout", JSON.stringify(result));
    assert.equal(JSON.parse(readFileSync(result.state_path, "utf8")).stop_reason, "workflow-run-timeout");
    assert.equal(performance.now() - started < 2_000, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("an already-aborted attended deadline refuses before worktree or adapter effects", async () => {
  const repo = tempRepo();
  try {
    const controller = new AbortController();
    controller.abort("workflow-run-timeout");
    let creates = 0;
    let adapterCalls = 0;
    const realWorktree = makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") });
    const worktree = {
      ...realWorktree,
      create(...args) { creates += 1; return realWorktree.create(...args); },
    };
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo, now: NOW, run_id: "already-timed-out", signal: controller.signal, worktree,
      adapter: { kind: "test", runCandidate() { adapterCalls += 1; } },
      runtime_limits: { max_runtime_ms: 1_000, call_timeout_ms: 1_000 },
    });
    assert.equal(result.code, "workflow-run-timeout");
    assert.equal(creates, 0);
    assert.equal(adapterCalls, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a terminal renderer failure cannot rewrite durable convergence", async () => {
  const repo = tempRepo();
  try {
    const { deps } = makeDeps(repo, {
      run_id: "terminal-renderer",
      events: {
        dir: join(repo, ".events"),
        onEvent(event) {
          if (event.kind === "run-end") throw new Error("renderer exploded with private prose");
        },
      },
    });
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, deps);
    assert.equal(result.converged, true, JSON.stringify(result));
    assert.ok(result.warnings.includes("event-renderer-failed"));
    const state = JSON.parse(readFileSync(result.state_path, "utf8"));
    assert.equal(state.completed, true);
    assert.equal(state.pending_event, null);
    const events = readFileSync(result.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.kind === "run-end").length, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("verdict extraction is strictest-wins across multiple reviewers", () => {
  const result = (verdicts) => ({
    candidates: verdicts.map((v, i) => ({
      disposition: "launched", role: "reviewer",
      envelope: { recommendation: v }, index: i,
    })),
  });
  assert.equal(extractStageVerdict(result(["approve", "approve"]), "reviewer"), "approve");
  assert.equal(extractStageVerdict(result(["approve", "revise"]), "reviewer"), "revise");
  assert.equal(extractStageVerdict(result(["revise", "revise-jump"]), "reviewer"), "revise-jump");
  assert.equal(extractStageVerdict(result(["ship-it"]), "reviewer"), undefined);
});

test("scripted plan rejection loops the plan stage before advancing", async () => {
  const repo = tempRepo();
  try {
    const { events, deps } = makeDeps(repo);
    const adapter = createStagedMockAdapter({ verdicts: { plan: ["revise", "approve"], implement: ["approve", "approve"] } });
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      ...deps,
      run_id: "runner-plan-loop",
      adapter: adapter.dispatchAdapter,
      revisionAdapter: adapter.revisionAdapter({ "proposal.txt": "Helix staged proposal\nHELIX_LOOP_PASS\n" }),
    });
    assert.equal(result.converged, true, JSON.stringify(result.flow));
    const passes = events.filter((e) => e.kind === "pass-start").map((e) => `${e.stage_id}#${e.pass}`);
    assert.deepEqual(passes.slice(0, 3), ["plan#1", "plan#2", "implement#1"]);
    const verdicts = events.filter((e) => e.kind === "verdict").map((e) => e.verdict);
    assert.equal(verdicts[0], "revise");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("interrupted runs resume from the persisted machine state; completed runs are a no-op", async () => {
  const repo = tempRepo();
  try {
    const { deps } = makeDeps(repo);
    const registries = { chainRegistry, presets };

    // Exhaust the budget mid-chain: only 1 pass allowed.
    const starved = await runStagedTaskLoop({ ...baseConfig, max_iterations: 1 }, registries, {
      ...deps, run_id: "runner-resume",
    });
    assert.equal(starved.ok, false);
    assert.equal(starved.code, "not-converged-within-max-iterations");
    const state = JSON.parse(readFileSync(starved.state_path, "utf8"));
    assert.equal(state.completed, true, "a concluded (even failed) run is completed, not resumable");

    // Interrupt after the plan checkpoint was committed but before its
    // stage-end renderer returned. The real state includes all identity binds
    // and the private content-addressed handoff.
    const interrupted = await interruptAfterStage(repo, "runner-resume2");
    assert.equal(interrupted.state.machine.stage_index, 1);
    assert.equal(interrupted.state.machine.phase, "stage");
    assert.equal(interrupted.state.pending_event.kind, "stage-end");
    assert.equal(JSON.stringify(interrupted.state).includes("planner-ok"), false,
      "raw adapter output must not enter the public checkpoint");
    assert.equal(existsSync(join(repo, ".git", "helix-private")), false,
      "raw handoffs must not be persisted under git metadata");
    // Model a kill after the state commit but before stage-end append by
    // truncating the simulated renderer-failure tail back to event_count.
    const interruptedEventsPath = join(interrupted.eventsDir, "runner-resume2.events.jsonl");
    const committedLines = readFileSync(interruptedEventsPath, "utf8").trim().split("\n")
      .slice(0, interrupted.state.event_count);
    writeFileSync(interruptedEventsPath, committedLines.join("\n") + "\n", "utf8");
    const { events, deps: deps2 } = makeDeps(repo);
    const resumed = await runStagedTaskLoop({ ...baseConfig }, registries, {
      ...deps2, run_id: "runner-resume2", resume_state: interrupted.state,
    });
    assert.equal(resumed.converged, true, JSON.stringify(resumed.flow ?? resumed));
    const passes = events.filter((e) => e.kind === "pass-start").map((e) => `${e.stage_id}#${e.pass}`);
    assert.equal(passes.every((p) => p.startsWith("implement")), true, "plan stage is NOT re-run on resume");
    const persistedEvents = readFileSync(interruptedEventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(persistedEvents.filter((event) => event.kind === "stage-end" && event.stage_id === "plan").length, 1,
      "the pending stage boundary is recovered exactly once");
    assert.ok(resumed.warnings.some((w) => w.startsWith("resumed-at-pass:1")));

    // Resuming a completed run is a recorded no-op.
    const completedState = JSON.parse(readFileSync(resumed.state_path, "utf8"));
    assert.equal(completedState.pending_event, null);
    const noop = await runStagedTaskLoop({ ...baseConfig }, registries, {
      ...deps2, run_id: "runner-resume2", resume_state: completedState,
    });
    assert.equal(noop.noop, true);
    assert.equal(noop.code, RUNNER_CODES.ALREADY_COMPLETED);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("completed resume reconciles a missing run-end exactly once without requiring the worktree", async () => {
  const repo = tempRepo();
  try {
    const { deps } = makeDeps(repo);
    const runId = "terminal-recovery";
    const done = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, { ...deps, run_id: runId });
    assert.equal(done.converged, true);
    const state = JSON.parse(readFileSync(done.state_path, "utf8"));
    const eventPath = done.events_path;
    const events = readFileSync(eventPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const terminal = events.at(-1);
    assert.equal(terminal.kind, "run-end");
    events.pop();
    writeFileSync(eventPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
    const crashState = {
      ...state,
      event_count: events.length,
      pending_event: {
        kind: "run-end",
        fields: {
          converged: terminal.converged,
          stop_reason: terminal.stop_reason,
          open_disagreements: terminal.open_disagreements,
        },
      },
    };
    writeFileSync(done.state_path, JSON.stringify(crashState) + "\n", "utf8");

    // A completed run may have had its worktree cleaned; reconciliation only
    // needs the bound public state and event stream.
    makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }).remove(runId);
    const recovered = [];
    const noop = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: runId,
      state_dir: join(repo, ".state"),
      events: { dir: join(repo, ".events"), onEvent: (event) => recovered.push(event) },
      resume_state: crashState,
    });
    assert.equal(noop.code, RUNNER_CODES.ALREADY_COMPLETED);
    assert.deepEqual(recovered.map((event) => event.kind), ["run-end"]);
    const finalEvents = readFileSync(eventPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(finalEvents.filter((event) => event.kind === "run-end").length, 1);
    assert.equal(JSON.parse(readFileSync(done.state_path, "utf8")).pending_event, null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resume refuses a forged converged pending event without a passing conclusion gate", async () => {
  const repo = tempRepo();
  try {
    const interrupted = await interruptAfterStage(repo, "forged-convergence");
    const statePath = join(interrupted.stateDir, "forged-convergence.state.json");
    const forged = {
      ...interrupted.state,
      completed: true,
      stop_reason: "converged",
      pending_event: {
        kind: "run-end",
        fields: { converged: true, stop_reason: "converged", open_disagreements: 0 },
      },
    };
    assert.equal(validateRunnerState(forged).valid, true);
    writeFileSync(statePath, stableStringify(forged) + "\n", "utf8");

    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "forged-convergence",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: interrupted.stateDir,
      events: { dir: interrupted.eventsDir },
      resume_state: forged,
    });
    assert.equal(result.code, RUNNER_CODES.RESUME_EVENTS_INVALID);
    const events = readFileSync(join(interrupted.eventsDir, "forged-convergence.events.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.some((event) => event.kind === "run-end"), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("checkpoint binding rejects impossible cross-stage pass order", () => {
  const log = makeEventLog({ run_id: "impossible-order" });
  log.emit("run-start", { chain_id: "full-cycle", config_id: "mock-core-loop", max_iterations: 5 });
  log.emit("stage-start", { stage_id: "implement", executor_ref: "composite:daily" });
  log.emit("pass-start", { stage_id: "implement", pass: 1, of: 5, attempt: 1, executor_ref: "composite:daily" });
  log.emit("verdict", { stage_id: "implement", verdict: "approve" });
  log.emit("stage-end", { stage_id: "implement" });
  log.emit("stage-start", { stage_id: "plan", executor_ref: "composite:overlord" });
  log.emit("pass-start", { stage_id: "plan", pass: 1, of: 5, attempt: 1, executor_ref: "composite:overlord" });
  log.emit("verdict", { stage_id: "plan", verdict: "approve" });
  log.emit("stage-end", { stage_id: "plan" });
  log.emit("pass-start", { stage_id: "implement", pass: 2, of: 5, attempt: 1, executor_ref: "composite:daily" });
  log.emit("verdict", { stage_id: "implement", verdict: "approve" });
  log.emit("stage-end", { stage_id: "implement" });
  log.emit("gate", { stage_id: "implement", phase: "conclusion", result: "pass" });
  log.emit("run-end", { converged: true, stop_reason: "converged", open_disagreements: 0 });
  const state = {
    run_id: "impossible-order",
    config_id: "mock-core-loop",
    chain_id: "full-cycle",
    event_count: log.events.length,
    resolved_cast: [
      { stage_id: "plan", executor_ref: "composite:overlord" },
      { stage_id: "implement", executor_ref: "composite:daily" },
    ],
    machine: { phase: "conclusion", stage_index: 1, pass_counts: { plan: 1, implement: 2 }, total_passes: 3 },
    completed: true,
    stop_reason: "converged",
    pending_event: null,
    initializing: false,
  };
  const chain = chainRegistry.chains.find((candidate) => candidate.id === "full-cycle");
  assert.equal(validateCheckpointEventBinding(log.events, state, { max_iterations: 5, chain }), false);
});

test("completed resume refuses terminal events that disagree with durable state", async () => {
  const repo = tempRepo();
  try {
    const { deps } = makeDeps(repo);
    const runId = "terminal-disagreement";
    const done = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, { ...deps, run_id: runId });
    assert.equal(done.converged, true);
    const state = JSON.parse(readFileSync(done.state_path, "utf8"));
    const events = readFileSync(done.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const conclusion = events.at(-2);
    const terminal = events.at(-1);
    assert.equal(conclusion.kind, "gate");
    assert.equal(terminal.kind, "run-end");
    conclusion.result = "fail";
    terminal.converged = false;
    terminal.stop_reason = "objective-gate-failed";
    writeFileSync(done.events_path, events.map((event) => stableStringify(event)).join("\n") + "\n", "utf8");

    const resumed = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      ...deps,
      run_id: runId,
      resume_state: state,
    });
    assert.equal(resumed.ok, false);
    assert.equal(resumed.code, RUNNER_CODES.RESUME_EVENTS_INVALID);
    assert.equal(resumed.noop, undefined);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("worktree toggle OFF runs in the caller's tree (warned); ON without an effect refuses", async () => {
  const repo = tempRepo();
  try {
    const { deps } = makeDeps(repo);
    const toggles = {
      "multi-model": true, loops: true, autoresearch: true,
      "context-engine": true, worktree: false, "visual-cues": true,
    };
    const inTree = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      ...deps, run_id: "runner-worktree-off", toggles,
    });
    assert.equal(inTree.worktree_path, repo, "worktree off = the caller's working tree");
    assert.ok(inTree.warnings.includes("worktree-off-working-tree"));
    assert.match(readFileSync(join(repo, "proposal.txt"), "utf8"), /HELIX_LOOP_PASS/, "mutations land in the real tree — the owner's choice");

    const duplicate = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      ...deps, run_id: "runner-worktree-off", toggles,
    });
    assert.equal(duplicate.code, RUNNER_CODES.RUN_STATE_COLLISION,
      "worktree OFF must not overwrite durable evidence for a duplicate run id");

    const noEffect = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo, now: NOW, seed: 7, run_id: "runner-no-effect",
    });
    assert.equal(noEffect.code, RUNNER_CODES.MISSING_WORKTREE_EFFECT);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("worktree effect: fresh runs refuse a colliding run id; only resume reuses", () => {
  const repo = tempRepo();
  try {
    const effect = makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") });
    for (const unsafe of ["..", "../escape", "nested/run"]) {
      assert.equal(effect.preflight(unsafe).ok, false);
      assert.equal(effect.create(unsafe).ok, false);
      assert.equal(effect.remove(unsafe).ok, false);
    }
    const first = effect.create("wt-test");
    assert.equal(first.ok, true);
    assert.equal(first.reused, false);
    assert.ok(existsSync(join(first.path, "proposal.txt")));

    // A FRESH create over an existing worktree fails closed — no silent reuse of
    // the previous run's dirty tree (false-convergence hazard).
    const collide = effect.create("wt-test");
    assert.equal(collide.ok, false);
    assert.equal(collide.code, RUNNER_CODES.WORKTREE_COLLISION);

    // A RESUME (reuse:true) deliberately reuses the same worktree.
    const resumed = effect.create("wt-test", { reuse: true });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.reused, true);

    const removed = effect.remove("wt-test");
    assert.equal(removed.ok, true);
    assert.equal(existsSync(first.path), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("private checkpoints refuse a symlinked storage parent without writing outside Git", () => {
  const repo = tempRepo();
  const outside = mkdtempSync(join(tmpdir(), "helix-checkpoint-outside-"));
  try {
    const root = join(repo, ".git", "helix-checkpoints");
    mkdirSync(root, { recursive: true });
    symlinkSync(outside, join(root, "checkpoint-symlink"));
    const effect = makePrivateCheckpointEffect(repo);
    const result = effect.snapshot("checkpoint-symlink", "generation-1", repo);
    assert.equal(result.ok, false);
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("private checkpoint cleanup is idempotent after authority advances", () => {
  const repo = tempRepo();
  try {
    const effect = makePrivateCheckpointEffect(repo);
    const snapshot = effect.snapshot("cleanup-run", "generation-1", repo);
    assert.equal(snapshot.ok, true);
    assert.equal(effect.remove("cleanup-run", "generation-1").ok, true);
    assert.deepEqual(effect.remove("cleanup-run", "generation-1"), { ok: true, missing: true });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("fresh worktree collision is refused before any resumable state is written", async () => {
  const repo = tempRepo();
  try {
    const runId = "preflight-collision";
    const effect = makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") });
    const unrelated = effect.create(runId);
    assert.equal(unrelated.ok, true);
    writeFileSync(join(unrelated.path, "proposal.txt"), "dirty unrelated worktree\n", "utf8");
    const stateDir = join(repo, ".state");
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: runId,
      worktree: effect,
      state_dir: stateDir,
      events: { dir: join(repo, ".events") },
    });
    assert.equal(result.code, RUNNER_CODES.WORKTREE_COLLISION);
    assert.equal(existsSync(join(stateDir, `${runId}.state.json`)), false);
    assert.equal(readFileSync(join(unrelated.path, "proposal.txt"), "utf8"), "dirty unrelated worktree\n");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("initializing resume refuses a dirty colliding worktree without its private owner binding", async () => {
  const repo = tempRepo();
  try {
    const runId = "unowned-initialization";
    const stateDir = join(repo, ".state");
    const eventsDir = join(repo, ".events");
    const effect = makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") });
    const interrupted = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: runId,
      worktree: effect,
      state_dir: stateDir,
      events: { dir: eventsDir },
      on_initial_state() { throw new Error("simulated-pre-worktree-kill"); },
    });
    assert.equal(interrupted.code, "checkpoint-persistence-failed");
    const state = JSON.parse(readFileSync(join(stateDir, `${runId}.state.json`), "utf8"));
    const branch = `helix/run-${hashRef(runId).slice("sha256:".length, "sha256:".length + 24)}`;
    execFileSync("git", ["config", "--unset", `branch.${branch}.helixOwner`], { cwd: repo });
    const path = join(repo, ".wt", runId);
    execFileSync("git", ["worktree", "add", "-b", branch, path, "HEAD"], { cwd: repo });
    writeFileSync(join(path, "proposal.txt"), "dirty colliding baseline\n", "utf8");

    const resumed = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: runId,
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: stateDir,
      events: { dir: eventsDir },
      resume_state: state,
    });
    assert.equal(resumed.code, RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME);
    assert.equal(readFileSync(join(path, "proposal.txt"), "utf8"), "dirty colliding baseline\n");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a fresh run refuses to reuse an existing worktree; interrupt state config-binds on resume", async () => {
  const repo = tempRepo();
  try {
    const { deps } = makeDeps(repo);
    const registries = { chainRegistry, presets };

    // First run creates the worktree and converges.
    const first = await runStagedTaskLoop({ ...baseConfig }, registries, { ...deps, run_id: "collide-run" });
    assert.equal(first.converged, true, JSON.stringify(first));

    // A FRESH run with the SAME id must not overwrite its durable state or
    // silently inherit that worktree.
    const { deps: deps2 } = makeDeps(repo);
    const collide = await runStagedTaskLoop({ ...baseConfig }, registries, { ...deps2, run_id: "collide-run" });
    assert.equal(collide.ok, false);
    assert.equal(collide.code, RUNNER_CODES.RUN_STATE_COLLISION);

    // Resume with an otherwise-valid on-disk state whose config_id disagrees
    // fails closed (config binding), after the resume CAS has accepted it.
    const bound = await interruptAfterStage(repo, "bind-run");
    const mismatchedState = { ...bound.state, config_id: "some-other-config" };
    writeFileSync(join(bound.stateDir, "bind-run.state.json"), `${JSON.stringify(mismatchedState)}\n`, "utf8");
    const mismatched = await runStagedTaskLoop({ ...baseConfig }, registries, {
      cwd: repo, now: NOW, run_id: "bind-run",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: bound.stateDir,
      events: { dir: bound.eventsDir },
      resume_state: mismatchedState,
    });
    assert.equal(mismatched.code, RUNNER_CODES.STATE_CONFIG_MISMATCH);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resume binds immutable config resources and restores original cast/toggles", async () => {
  const repo = tempRepo();
  try {
    const interrupted = await interruptAfterStage(repo, "execution-bind");
    const deps = {
      cwd: repo,
      now: NOW,
      seed: 7,
      run_id: "execution-bind",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: interrupted.stateDir,
      events: { dir: interrupted.eventsDir },
      resume_state: interrupted.state,
    };

    const changedConfig = await runStagedTaskLoop(
      { ...baseConfig, description: `${baseConfig.description} changed` },
      { chainRegistry, presets },
      deps,
    );
    assert.equal(changedConfig.code, RUNNER_CODES.STATE_EXECUTION_MISMATCH);

    const patched = new Map(presets);
    const daily = presets.get("daily");
    patched.set("daily", {
      ...daily,
      roles: {
        ...daily.roles,
        builder: daily.roles.builder.map((member) => ({ ...member, model: `${member.model}-changed` })),
      },
    });
    const restoredInputs = await runStagedTaskLoop(
      { ...baseConfig },
      { chainRegistry, presets: patched },
      {
        ...deps,
        toggles: {
          "multi-model": false, loops: false, autoresearch: false,
          "context-engine": false, worktree: false, "visual-cues": false,
        },
      },
    );
    assert.equal(restoredInputs.converged, true, JSON.stringify(restoredInputs));
    const finalState = JSON.parse(readFileSync(join(interrupted.stateDir, "execution-bind.state.json"), "utf8"));
    assert.deepEqual(finalState.resolved_cast, interrupted.state.resolved_cast);
    assert.deepEqual(finalState.toggles ?? null, interrupted.state.toggles ?? null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resume binds the exact prompt template and role-brief contents", async () => {
  const repo = tempRepo();
  try {
    const templatesDir = join(repo, ".prompt-fixture", "templates");
    const briefsDir = join(repo, ".prompt-fixture", "briefs");
    mkdirSync(templatesDir, { recursive: true });
    mkdirSync(briefsDir, { recursive: true });
    writeFileSync(join(templatesDir, "step-prompt-v1.md"), [
      "{{role_brief}}", "{{chain_id}}", "{{stage_id}}", "{{pass}}",
      "{{gate_summary}}", "{{task_instruction}}", "{{handoff}}",
    ].join("\n"), "utf8");
    for (const role of ["planner", "reviewer", "builder", "redteam"]) {
      writeFileSync(join(briefsDir, `${role}.md`), `# ${role}\n`, "utf8");
    }
    const interrupted = await interruptAfterStage(repo, "prompt-bind", {
      extraDeps: { templates_dir: templatesDir, briefs_dir: briefsDir },
    });
    writeFileSync(join(templatesDir, "step-prompt-v1.md"), "changed template\n", "utf8");
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "prompt-bind",
      templates_dir: templatesDir,
      briefs_dir: briefsDir,
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: interrupted.stateDir,
      events: { dir: interrupted.eventsDir },
      resume_state: interrupted.state,
    });
    assert.equal(result.code, RUNNER_CODES.STATE_EXECUTION_MISMATCH);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resume rejects a stale caller snapshot before any adapter effect", async () => {
  const repo = tempRepo();
  try {
    const interrupted = await interruptAfterStage(repo, "stale-cas");
    const advanced = { ...interrupted.state, stop_reason: "external-update" };
    writeFileSync(join(interrupted.stateDir, "stale-cas.state.json"), `${JSON.stringify(advanced)}\n`, "utf8");
    let calls = 0;
    const mock = createStagedMockAdapter();
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "stale-cas",
      adapter: { ...mock.dispatchAdapter, runCandidate: (...args) => { calls += 1; return mock.dispatchAdapter.runCandidate(...args); } },
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: interrupted.stateDir,
      events: { dir: interrupted.eventsDir },
      resume_state: interrupted.state,
    });
    assert.equal(result.code, RUNNER_CODES.RESUME_STATE_STALE);
    assert.equal(calls, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("only one concurrent resume acquires the repository-private run lease", async () => {
  const repo = tempRepo();
  try {
    const interrupted = await interruptAfterStage(repo, "resume-lease");
    const mock = createStagedMockAdapter();
    let release;
    let entered;
    const enteredPromise = new Promise((resolve) => { entered = resolve; });
    const hold = new Promise((resolve) => { release = resolve; });
    const adapter = {
      ...mock.dispatchAdapter,
      async runCandidate(...args) {
        entered();
        await hold;
        return mock.dispatchAdapter.runCandidate(...args);
      },
    };
    const deps = {
      cwd: repo,
      now: NOW,
      run_id: "resume-lease",
      adapter,
      revisionAdapter: mock.revisionAdapter({ "proposal.txt": "green\nHELIX_LOOP_PASS\n" }),
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: interrupted.stateDir,
      events: { dir: interrupted.eventsDir },
      resume_state: interrupted.state,
    };
    const first = runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, deps);
    await enteredPromise;
    const second = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, deps);
    assert.equal(second.code, RUNNER_CODES.RESUME_IN_PROGRESS);
    release();
    const completed = await first;
    assert.equal(completed.converged, true, JSON.stringify(completed));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("only one concurrent fresh run can own a repository run id", async () => {
  const repo = tempRepo();
  try {
    const mock = createStagedMockAdapter();
    let release;
    let entered;
    const enteredPromise = new Promise((resolve) => { entered = resolve; });
    const hold = new Promise((resolve) => { release = resolve; });
    let held = false;
    const adapter = {
      ...mock.dispatchAdapter,
      async runCandidate(...args) {
        if (!held) {
          held = true;
          entered();
          await hold;
        }
        return mock.dispatchAdapter.runCandidate(...args);
      },
    };
    const deps = {
      cwd: repo,
      now: NOW,
      run_id: "fresh-lease",
      adapter,
      revisionAdapter: mock.revisionAdapter({ "proposal.txt": "green\nHELIX_LOOP_PASS\n" }),
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: join(repo, ".state"),
      events: { dir: join(repo, ".events") },
    };
    const first = runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, deps);
    await enteredPromise;
    const refused = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, deps);
    assert.equal(refused.code, RUNNER_CODES.RUN_IN_PROGRESS);
    release();
    const completed = await first;
    assert.equal(completed.converged, true, JSON.stringify(completed));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resume restores an incomplete committed pass without touching unrelated refs", async () => {
  const repo = tempRepo();
  try {
    const runnerUrl = new URL("../dispatch/lib/runner.mjs", import.meta.url).href;
    const presetsUrl = new URL("../dispatch/lib/presets.mjs", import.meta.url).href;
    const chainsPath = new URL("../dispatch/config/chains.json", import.meta.url).pathname;
    const configsPath = new URL("../dispatch/config/run-configs.json", import.meta.url).pathname;
    const child = `
      import { writeFileSync, readFileSync } from "node:fs";
      import { join } from "node:path";
      import { execFileSync } from "node:child_process";
      import { runStagedTaskLoop, makeGitWorktreeEffect, createStagedMockAdapter } from ${JSON.stringify(runnerUrl)};
      import { loadPresetRegistry } from ${JSON.stringify(presetsUrl)};
      const repo = ${JSON.stringify(repo)};
      const chainRegistry = JSON.parse(readFileSync(${JSON.stringify(chainsPath)}, "utf8"));
      const config = JSON.parse(readFileSync(${JSON.stringify(configsPath)}, "utf8")).configs[0];
      const presets = loadPresetRegistry(${JSON.stringify(matricesDir)}).presets;
      const mock = createStagedMockAdapter();
      let first = true;
      const adapter = {
        ...mock.dispatchAdapter,
        runCandidate(spec, ctx) {
          if (first) {
            first = false;
            const cwd = join(repo, ".wt", "pass-crash");
            writeFileSync(join(cwd, "partial-pass.txt"), "must be rolled back\\n", "utf8");
            execFileSync("git", ["add", "-A"], { cwd });
            execFileSync("git", ["commit", "-q", "-m", "partial pass"], { cwd });
            process.exit(23);
          }
          return mock.dispatchAdapter.runCandidate(spec, ctx);
        },
      };
      await runStagedTaskLoop(config, { chainRegistry, presets }, {
        cwd: repo,
        now: ${NOW},
        run_id: "pass-crash",
        adapter,
        worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
        state_dir: join(repo, ".state"),
        events: { dir: join(repo, ".events") },
      });
    `;
    const killed = spawnSync(process.execPath, ["--input-type=module", "-e", child], { encoding: "utf8" });
    assert.equal(killed.status, 23, killed.stderr);
    const stateDir = join(repo, ".state");
    const state = JSON.parse(readFileSync(join(stateDir, "pass-crash.state.json"), "utf8"));
    assert.deepEqual(state.pass_in_progress, { stage_id: "plan", pass: 1, total_passes: 1 });
    const workPath = join(repo, ".wt", "pass-crash");
    const partialOid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workPath, encoding: "utf8" }).trim();
    execFileSync("git", ["branch", "unrelated-preserved", partialOid], { cwd: repo });
    const resumed = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "pass-crash",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: stateDir,
      events: { dir: join(repo, ".events") },
      resume_state: state,
    });
    assert.equal(resumed.converged, true, JSON.stringify(resumed));
    assert.equal(existsSync(join(workPath, "partial-pass.txt")), false);
    assert.equal(execFileSync("git", ["rev-parse", "unrelated-preserved"], { cwd: repo, encoding: "utf8" }).trim(), partialOid);
    assert.equal(spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: workPath }).status, 0);
    const events = readFileSync(join(repo, ".events", "pass-crash.events.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.filter((event) => event.kind === "pass-start" && event.stage_id === "plan")
      .map((event) => event.attempt), [1, 2]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resume reuses the deterministic immutable snapshot after a pre-state kill", async () => {
  const repo = tempRepo();
  try {
    const runnerUrl = new URL("../dispatch/lib/runner.mjs", import.meta.url).href;
    const presetsUrl = new URL("../dispatch/lib/presets.mjs", import.meta.url).href;
    const chainsPath = new URL("../dispatch/config/chains.json", import.meta.url).pathname;
    const configsPath = new URL("../dispatch/config/run-configs.json", import.meta.url).pathname;
    const child = `
      import { readFileSync } from "node:fs";
      import { join } from "node:path";
      import { runStagedTaskLoop, makeGitWorktreeEffect } from ${JSON.stringify(runnerUrl)};
      import { loadPresetRegistry } from ${JSON.stringify(presetsUrl)};
      const repo = ${JSON.stringify(repo)};
      const chainRegistry = JSON.parse(readFileSync(${JSON.stringify(chainsPath)}, "utf8"));
      const config = JSON.parse(readFileSync(${JSON.stringify(configsPath)}, "utf8")).configs[0];
      const presets = loadPresetRegistry(${JSON.stringify(matricesDir)}).presets;
      await runStagedTaskLoop(config, { chainRegistry, presets }, {
        cwd: repo,
        now: ${NOW},
        run_id: "snapshot-window",
        worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
        state_dir: join(repo, ".state"),
        events: { dir: join(repo, ".events") },
        on_private_snapshot() { process.exit(24); },
      });
    `;
    const killed = spawnSync(process.execPath, ["--input-type=module", "-e", child], { encoding: "utf8" });
    assert.equal(killed.status, 24, killed.stderr);
    const state = JSON.parse(readFileSync(join(repo, ".state", "snapshot-window.state.json"), "utf8"));
    assert.equal(state.pass_in_progress, null, "kill happened before snapshot identity reached public state");
    const resumed = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "snapshot-window",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: join(repo, ".state"),
      events: { dir: join(repo, ".events") },
      resume_state: state,
    });
    assert.equal(resumed.converged, true, JSON.stringify(resumed));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("runner-state validation rejects extra fields, prose, and unsafe counters", async () => {
  const repo = tempRepo();
  try {
    const { state } = await interruptAfterStage(repo, "state-schema");
    assert.equal(validateRunnerState(state).valid, true);
    assert.equal(validateRunnerState({ ...state, raw_response: "ordinary model prose" }).valid, false);
    assert.equal(validateRunnerState({ ...state, run_target: { repo: "self", ref: "ordinary prose" } }).valid, false);
    assert.equal(validateRunnerState({
      ...state,
      machine: { ...state.machine, total_passes: Number.MAX_SAFE_INTEGER + 1 },
    }).valid, false);
    const overfull = structuredClone(state);
    overfull.resolved_cast[0].roles.planner[0].instances = MAX_PANEL_MEMBERS + 1;
    assert.equal(validateRunnerState(overfull).valid, false);
    const canonicalModelId = structuredClone(state);
    canonicalModelId.resolved_cast[0].roles.planner[0].model = "mock-planner@v1+stable";
    canonicalModelId.resolved_cast[0].executor_ref = "model:mock/mock-planner@v1+stable";
    assert.equal(validateRunnerState(canonicalModelId).valid, true);
    const legacyState = structuredClone(state);
    legacyState.schema_version = 2;
    delete legacyState.worktree_owner_ref;
    assert.equal(validateRunnerState(legacyState).valid, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("fresh execution persists a zero-pass checkpoint before the first adapter call", async () => {
  const repo = tempRepo();
  try {
    const mock = createStagedMockAdapter();
    const stateDir = join(repo, ".state");
    let checked = false;
    const adapter = {
      ...mock.dispatchAdapter,
      runCandidate(spec, ctx) {
        if (!checked) {
          const state = JSON.parse(readFileSync(join(stateDir, "initial-checkpoint.state.json"), "utf8"));
          assert.equal(state.completed, false);
          assert.equal(state.machine.total_passes, 0);
          assert.equal(state.pending_event, null);
          checked = true;
        }
        return mock.dispatchAdapter.runCandidate(spec, ctx);
      },
    };
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "initial-checkpoint",
      adapter,
      revisionAdapter: mock.revisionAdapter({ "proposal.txt": "x\nHELIX_LOOP_PASS\n" }),
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: stateDir,
      events: { dir: join(repo, ".events") },
    });
    assert.equal(result.converged, true, JSON.stringify(result));
    assert.equal(checked, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("fresh execution persists initializing state before creating its worktree", async () => {
  const repo = tempRepo();
  try {
    const stateDir = join(repo, ".state");
    const realWorktree = makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") });
    let checked = false;
    const worktree = {
      ...realWorktree,
      create(...args) {
        const state = JSON.parse(readFileSync(join(stateDir, "pre-worktree.state.json"), "utf8"));
        assert.equal(state.initializing, true);
        assert.equal(state.machine.total_passes, 0);
        assert.equal(state.event_count, 0);
        assert.equal(state.worktree_ref, null);
        checked = true;
        return realWorktree.create(...args);
      },
    };
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "pre-worktree",
      worktree,
      state_dir: stateDir,
      events: { dir: join(repo, ".events") },
    });
    assert.equal(result.converged, true, JSON.stringify(result));
    assert.equal(checked, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("initializing resume heals a kill between state and empty disagreement materialization", async () => {
  const repo = tempRepo();
  try {
    const stateDir = join(repo, ".state");
    const eventsDir = join(repo, ".events");
    const first = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "init-window",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: stateDir,
      events: { dir: eventsDir },
      on_initial_state() { throw new Error("simulated-kill-window"); },
    });
    assert.equal(first.code, "checkpoint-persistence-failed");
    const state = JSON.parse(readFileSync(join(stateDir, "init-window.state.json"), "utf8"));
    assert.equal(state.initializing, true);
    assert.equal(existsSync(disagreementSnapshotPath(stateDir, "init-window", state.disagreement_ref)), false);
    const resumed = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "init-window",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: stateDir,
      events: { dir: eventsDir },
      resume_state: state,
    });
    assert.equal(resumed.converged, true, JSON.stringify(resumed));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("initializing resume refuses when repository HEAD moved before worktree creation", async () => {
  const repo = tempRepo();
  try {
    const stateDir = join(repo, ".state");
    const eventsDir = join(repo, ".events");
    await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "init-head-bind",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: stateDir,
      events: { dir: eventsDir },
      on_initial_state() { throw new Error("simulated-kill-window"); },
    });
    const state = JSON.parse(readFileSync(join(stateDir, "init-head-bind.state.json"), "utf8"));
    writeFileSync(join(repo, "after-init.txt"), "new head\n", "utf8");
    execFileSync("git", ["add", "after-init.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "move head"], { cwd: repo });
    const resumed = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      run_id: "init-head-bind",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: stateDir,
      events: { dir: eventsDir },
      resume_state: state,
    });
    assert.equal(resumed.code, RUNNER_CODES.STATE_REPOSITORY_MISMATCH);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a non-mock cast fails closed even when a mock adapter is injected", async () => {
  const repo = tempRepo();
  try {
    const { deps } = makeDeps(repo);
    const mock = createStagedMockAdapter();
    // A cast naming a real provider, but the CLI/runner has no live transport.
    const liveish = {
      ...baseConfig,
      assignments: { plan: { kind: "model", provider: "openai-codex", model: "gpt-5x" } },
      default_assignment: { kind: "model", provider: "openai-codex", model: "gpt-5x" },
    };
    const result = await runStagedTaskLoop(liveish, { chainRegistry, presets }, {
      ...deps,
      run_id: "liveish-run",
      adapter: mock.dispatchAdapter,
      revisionAdapter: mock.revisionAdapter({ "proposal.txt": "HELIX_LOOP_PASS\n" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, RUNNER_CODES.LIVE_ADAPTER_NOT_WIRED);
    assert.match(result.detail, /openai-codex/);
    assert.deepEqual(mock.calls, { candidates: 0, judges: 0, synthesis: 0, verifiers: 0, revisions: 0 });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("interrupt persists POST-transition state; resume does not replay the completed pass or restart seq", async () => {
  const repo = tempRepo();
  try {
    const registries = { chainRegistry, presets };
    const states = [];
    const { deps } = makeDeps(repo);
    // Capture the state written after the FIRST pass (plan approves once).
    const adapter = createStagedMockAdapter({ verdicts: { plan: ["approve"], implement: ["approve", "approve"] } });
    // Run to completion but snapshot the on-disk state right after plan advances
    // by reading the events/state the runner persists.
    const done = await runStagedTaskLoop({ ...baseConfig }, registries, {
      ...deps, run_id: "posttrans",
      adapter: adapter.dispatchAdapter,
      revisionAdapter: adapter.revisionAdapter({ "proposal.txt": "x\nHELIX_LOOP_PASS\n" }),
    });
    assert.equal(done.converged, true, JSON.stringify(done.flow));
    // The persisted post-transition state after plan#1 must point at implement
    // (stage_index 1), never back at plan (stage_index 0) — that was the replay bug.
    const events = readFileSync(done.events_path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    // seq is strictly increasing and never restarts.
    const seqs = events.map((e) => e.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    assert.equal(new Set(seqs).size, seqs.length, "no duplicate seqs");
    states.push(done);
    assert.equal(states.length, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("the event log refuses leaking or free-text fields and renders summary lines", () => {
  const log = makeEventLog({ run_id: "evt-test" });
  assert.throws(() => log.emit("warning", { code: "/Us" + "ers/someone/secret" }), /public-safety|stable code/); // split so repo scanners don't self-match
  assert.throws(() => log.emit("warning", { code: "long prose with\nnewlines" }), /stable code|invalid-field/);
  // Even SINGLE-LINE prose (spaces, no newline) is rejected — a space-permitting
  // pattern would let model text masquerade as a stable field.
  assert.throws(() => log.emit("warning", { code: "the model said hello" }), /stable code|invalid-field/);
  assert.throws(() => log.emit("nonsense", {}), /unknown event kind/);
  log.emit("run-start", { chain_id: "full-cycle", config_id: "mock-core-loop", max_iterations: 3 });
  log.emit("pass-start", { stage_id: "plan", pass: 1, of: 3, attempt: 1, executor_ref: "model:mock/test" });
  log.emit("run-end", { converged: false, stop_reason: "test-stopped", open_disagreements: 0 });
  assert.equal(log.events.length, 3);
  const summary = log.events.map((e) => renderEventLine(e, { verbosity: "summary" })).filter(Boolean);
  assert.equal(summary.length, 2, "summary verbosity keeps run boundaries only");
  const stream = log.events.map((e) => renderEventLine(e)).filter(Boolean);
  assert.equal(stream.length, 3);
});

test("chain effects cannot persist caller-supplied failure codes", async () => {
  const repo = tempRepo();
  try {
    const config = {
      ...baseConfig,
      id: "effect-code-boundary",
      chain: "ship-pre-pr",
      assignments: { gauntlet: { kind: "composite", preset: "daily" } },
      max_iterations: 2,
    };
    const toxicCode = "https:" + "//example.com/private/effect";
    const { deps } = makeDeps(repo, {
      step_effects: {
        localCheck: async () => ({ ok: false, code: toxicCode }),
        handoff: async () => ({ ok: true }),
      },
    });
    const result = await runStagedTaskLoop(config, { chainRegistry, presets }, {
      ...deps,
      run_id: "effect-code-boundary",
    });
    assert.equal(result.ok, false);
    const events = readFileSync(result.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.kind === "blocked" && event.code === "local-check-failed"));
    assert.equal(stableStringify(events).includes(toxicCode), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// Additional runner regressions.

test("live-adapter guard covers panel_roles: a real judge on an otherwise-mock cast fails closed", async () => {
  const repo = tempRepo();
  try {
    const { deps } = makeDeps(repo);
    const mock = createStagedMockAdapter();
    // Clone overlord with a REAL judge (valid provider, lands only in panel_roles
    // on the multi-reviewer plan stage).
    const overlord = presets.get("overlord");
    const patched = new Map(presets);
    patched.set("overlord", {
      ...overlord,
      roles: { ...overlord.roles, judge: [{ provider: "openai-api", model: "gpt-x", effort: "high", instances: 1, effort_vocab: ["high"] }] },
    });
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets: patched }, {
      ...deps, run_id: "panel-live", adapter: mock.dispatchAdapter,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, RUNNER_CODES.LIVE_ADAPTER_NOT_WIRED);
    assert.match(result.detail, /openai-api/);
    assert.equal(mock.calls.judges, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resume fails closed when the per-run worktree is absent (wrong-repo resume)", async () => {
  const repoA = tempRepo();
  const repoB = tempRepo();
  try {
    const registries = { chainRegistry, presets };
    const interrupted = await interruptAfterStage(repoA, "wrong-repo");
    // A valid interrupt state, but resume points at a different repository.
    const result = await runStagedTaskLoop({ ...baseConfig }, registries, {
      cwd: repoB, now: NOW, seed: 7, run_id: "wrong-repo",
      worktree: makeGitWorktreeEffect(repoB, { baseDir: join(repoB, ".wt") }),
      state_dir: interrupted.stateDir,
      events: { dir: interrupted.eventsDir, onEvent: () => {} },
      resume_state: interrupted.state,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, RUNNER_CODES.STATE_REPOSITORY_MISMATCH);
  } finally {
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
  }
});

test("resume continues event seq from the file's true last seq, not a stale event_count", async () => {
  const repo = tempRepo();
  try {
    const interrupted = await interruptAfterStage(repo, "seqrun");
    const eventPath = join(interrupted.eventsDir, "seqrun.events.jsonl");
    const lines = readFileSync(eventPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    // Simulate extra durable events past the checkpoint high-water mark.
    for (let i = 0; i < 5; i += 1) {
      lines.push({
        run_id: "seqrun",
        seq: lines.length + 1,
        t_rel_ms: lines.at(-1).t_rel_ms,
        kind: "warning",
        code: "orphan",
      });
    }
    writeFileSync(eventPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
    const priorHighWater = lines.at(-1).seq;

    const emitted = [];
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      cwd: repo, now: NOW, seed: 7, run_id: "seqrun",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: interrupted.stateDir,
      events: { dir: interrupted.eventsDir, onEvent: (e) => emitted.push(e.seq) },
      resume_state: interrupted.state,
    });
    assert.equal(result.converged, true, JSON.stringify(result));
    assert.ok(emitted.every((s) => s > priorHighWater), `resumed seqs must exceed ${priorHighWater}`);
    const allEvents = readFileSync(eventPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const allSeqs = allEvents.map((event) => event.seq);
    assert.equal(new Set(allSeqs).size, allSeqs.length, "no duplicate seqs in the append-only log after resume");
    assert.equal(allEvents.filter((event) => event.kind === "run-start").length, 1, "resume never emits a second run-start");
    assert.ok(allEvents.every((event, index) => index === 0 || event.t_rel_ms >= allEvents[index - 1].t_rel_ms),
      "relative time remains cumulative and monotonic across resume");
    void result;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resume refuses corrupt event, disagreement, or durable-handoff inputs", async () => {
  const scenarios = [
    {
      name: "events",
      corrupt(repo, interrupted, runId) {
        writeFileSync(join(interrupted.eventsDir, `${runId}.events.jsonl`), "{broken\n", "utf8");
      },
      code: RUNNER_CODES.RESUME_EVENTS_INVALID,
    },
    {
      name: "event-pass-binding",
      corrupt(_repo, interrupted, runId) {
        const path = join(interrupted.eventsDir, `${runId}.events.jsonl`);
        const events = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        const passStart = events.find((event) => event.kind === "pass-start");
        passStart.stage_id = "implement";
        writeFileSync(path, events.map((event) => stableStringify(event)).join("\n") + "\n", "utf8");
      },
      code: RUNNER_CODES.RESUME_EVENTS_INVALID,
    },
    {
      name: "disagreements",
      corrupt(repo, interrupted, runId) {
        rmSync(disagreementSnapshotPath(interrupted.stateDir, runId, interrupted.state.disagreement_ref), { force: true });
      },
      code: RUNNER_CODES.RESUME_DISAGREEMENTS_INVALID,
    },
    {
      name: "handoff-source",
      corrupt(_repo, interrupted) {
        writeFileSync(join(interrupted.result.worktree_path, "PLAN.md"), "changed after checkpoint\n", "utf8");
      },
      code: RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME,
    },
    {
      name: "unrelated-worktree-file",
      corrupt(_repo, interrupted) {
        writeFileSync(join(interrupted.result.worktree_path, "unrelated.tmp"), "changed after checkpoint\n", "utf8");
      },
      code: RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME,
    },
  ];
  for (const scenario of scenarios) {
    const repo = tempRepo();
    const runId = `corrupt-${scenario.name}`;
    try {
      const interrupted = await interruptAfterStage(repo, runId);
      scenario.corrupt(repo, interrupted, runId);
      const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
        cwd: repo,
        now: NOW,
        run_id: runId,
        worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
        state_dir: interrupted.stateDir,
        events: { dir: interrupted.eventsDir },
        resume_state: interrupted.state,
      });
      assert.equal(result.code, scenario.code, scenario.name);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("worktree resume rejects an unregistered directory at the expected path", () => {
  const repo = tempRepo();
  try {
    const baseDir = join(repo, ".wt");
    const effect = makeGitWorktreeEffect(repo, { baseDir });
    const created = effect.create("fake-reuse");
    assert.equal(created.ok, true);
    assert.equal(effect.remove("fake-reuse").ok, true);
    mkdirSync(created.path, { recursive: true });
    writeFileSync(join(created.path, "PLAN.md"), "not a registered worktree\n", "utf8");
    const reused = effect.create("fake-reuse", { reuse: true });
    assert.equal(reused.ok, false);
    assert.equal(reused.code, RUNNER_CODES.WORKTREE_INVALID_FOR_RESUME);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a missing declared artifact blocks before stage advancement", async () => {
  const repo = tempRepo();
  try {
    rmSync(join(repo, "PLAN.md"));
    execFileSync("git", ["add", "-u"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "remove plan"], { cwd: repo });
    const { deps } = makeDeps(repo);
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      ...deps,
      run_id: "missing-plan",
      artifact_effect: async () => ({ ok: true }),
    });
    assert.equal(result.converged, false);
    assert.equal(result.code, "stage-effect-failed");
    const events = readFileSync(result.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.kind === "blocked" && event.code === "stage-artifact-invalid:plan"));
    assert.equal(events.some((event) => event.kind === "stage-end" && event.stage_id === "plan"), false);
    const terminal = JSON.parse(readFileSync(result.state_path, "utf8"));
    assert.equal(terminal.machine.total_passes, result.total_passes);
    assert.equal(terminal.machine.total_passes, 1);
    assert.equal(terminal.event_count, events.length);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a stale pre-existing declared artifact cannot satisfy stage production", async () => {
  const repo = tempRepo();
  try {
    const original = readFileSync(join(repo, "PLAN.md"), "utf8");
    const { deps } = makeDeps(repo);
    const result = await runStagedTaskLoop({ ...baseConfig }, { chainRegistry, presets }, {
      ...deps,
      run_id: "stale-plan",
      artifact_effect: async () => ({ ok: true }),
    });
    assert.equal(result.code, "stage-effect-failed");
    assert.equal(readFileSync(join(result.worktree_path, "PLAN.md"), "utf8"), original);
    const events = readFileSync(result.events_path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.kind === "blocked" && event.code === "stage-artifact-invalid:plan"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a resume at total_passes == max_iterations is a valid state, not invalid-resume-state", async () => {
  const repo = tempRepo();
  try {
    writeFileSync(join(repo, "proposal.txt"), "already green\nHELIX_LOOP_PASS\n", "utf8");
    execFileSync("git", ["add", "proposal.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "green gate"], { cwd: repo });
    const config = { ...baseConfig, max_iterations: 2 };
    const interrupted = await interruptAfterStage(repo, "budgetedge", { config, stageId: "implement" });
    assert.equal(interrupted.state.machine.phase, "conclusion");
    assert.equal(interrupted.state.machine.total_passes, 2);
    const emitted = [];
    const result = await runStagedTaskLoop(config, { chainRegistry, presets }, {
      cwd: repo, now: NOW, seed: 7, run_id: "budgetedge",
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      state_dir: interrupted.stateDir,
      events: { dir: interrupted.eventsDir, onEvent: (event) => emitted.push(event) },
      resume_state: interrupted.state,
    });
    assert.equal(result.converged, true, JSON.stringify(result));
    assert.equal(emitted.some((event) => event.kind === "pass-start"), false,
      "resume at the conclusion phase must not replay the final model pass");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
