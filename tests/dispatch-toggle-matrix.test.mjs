// Toggle combination matrix: Helix must operate nominally under every
// combination — all-on, all-off, each only-X-on singleton, and the owner's
// three named scenarios. OFF degenerates; only explicit conflicts refuse.
// Plus: every chain in the five-loop catalog executes end to end (mock, no-live).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runStagedTaskLoop, makeGitWorktreeEffect, createStagedMockAdapter } from "../dispatch/lib/runner.mjs";
import { runResearch } from "../dispatch/lib/research.mjs";
import { loadPresetRegistry } from "../dispatch/lib/presets.mjs";
import { HELIX_TOGGLES } from "../dispatch/lib/settings.mjs";

const NOW = 1_751_731_200;
const presets = loadPresetRegistry(new URL("../dispatch/config/matrices/", import.meta.url).pathname).presets;
const chainRegistry = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
const baseConfig = JSON.parse(readFileSync(new URL("../dispatch/config/run-configs.json", import.meta.url), "utf8")).configs[0];

function vector(overrides = {}) {
  return Object.fromEntries(HELIX_TOGGLES.map((t) => [t, overrides[t] ?? true]));
}

function onlyOn(name) {
  return Object.fromEntries(HELIX_TOGGLES.map((t) => [t, t === name]));
}

function tempRepo(files = { "proposal.txt": "initial\n" }) {
  const cwd = mkdtempSync(join(tmpdir(), "helix-matrix-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Matrix"], { cwd });
  const fixture = { "PLAN.md": "Real plan fixture for staged execution.\n", ...files };
  for (const [name, content] of Object.entries(fixture)) writeFileSync(join(cwd, name), content, "utf8");
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

// A cast that stays legal under multi-model OFF (plain models only).
const SOLO_ASSIGNMENTS = {
  assignments: {
    plan: { kind: "model", provider: "mock", model: "solo-model", effort: "high" },
    implement: { kind: "model", provider: "mock", model: "solo-model", effort: "high" },
  },
  default_assignment: { kind: "model", provider: "mock", model: "solo-model" },
};

async function runCombo({ toggles, config = baseConfig, runId }) {
  const repo = tempRepo();
  try {
    const mock = createStagedMockAdapter();
    const result = await runStagedTaskLoop({ ...config }, { chainRegistry, presets }, {
      cwd: repo,
      now: NOW,
      seed: 7,
      run_id: runId,
      toggles,
      adapter: mock.dispatchAdapter,
      revisionAdapter: mock.revisionAdapter({ [config.objective_gate.path]: `x\n${config.objective_gate.contains}\n` }),
      worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
    });
    return { result, mock };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("all toggles ON: the flagship composite run converges (the baseline)", async () => {
  const { result } = await runCombo({ toggles: vector(), runId: "combo-all-on" });
  assert.equal(result.converged, true, JSON.stringify({ code: result.code, stop: result.stop_reason }));
});

test("all toggles OFF: a solo plain-model config still operates nominally (single pass, gate reports)", async () => {
  const toggles = Object.fromEntries(HELIX_TOGGLES.map((t) => [t, false]));
  const { result } = await runCombo({
    toggles,
    config: { ...baseConfig, ...SOLO_ASSIGNMENTS },
    runId: "combo-all-off",
  });
  // Single walk, gate honestly reports fail (no marker written on pass 1),
  // never a crash: degeneration, not error.
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "objective-gate-failed");
  assert.equal(result.stop_reason, "gate-failed-single-pass");
  assert.ok(result.warnings.includes("worktree-off-working-tree"));
  assert.ok(result.warnings.includes("context-engine-off-transcript"));
  assert.ok(result.warnings.includes("loops-off-single-pass"));
});

test("all toggles OFF but a composite cast: the explicit conflict refuses by toggle name", async () => {
  const toggles = Object.fromEntries(HELIX_TOGGLES.map((t) => [t, false]));
  const { result } = await runCombo({ toggles, runId: "combo-all-off-composite" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "toggle-disabled:multi-model");
});

for (const only of HELIX_TOGGLES) {
  test(`singleton: only '${only}' on — nominal operation or a clean structural refusal`, async () => {
    const toggles = onlyOn(only);
    const config = only === "multi-model" ? baseConfig : { ...baseConfig, ...SOLO_ASSIGNMENTS };
    const { result } = await runCombo({ toggles, config, runId: `combo-only-${only}` });
    if (only === "loops") {
      // Loops on, everything else off: solo model iterates to convergence.
      assert.equal(result.converged, true, JSON.stringify({ code: result.code }));
    } else if (only === "multi-model") {
      // Composites legal but single-pass: gate reports fail, structurally.
      assert.equal(result.code, "objective-gate-failed");
      assert.equal(result.stop_reason, "gate-failed-single-pass");
    } else {
      // Every other singleton runs the solo single-pass shape.
      assert.equal(result.code, "objective-gate-failed");
      assert.equal(result.stop_reason, "gate-failed-single-pass");
    }
    assert.ok(!String(result.code ?? "").includes("crash"), "no combination may crash");
  });
}

test("owner scenario: multi-model WITHOUT loops = arbitrated single pass (leader + judged panel, once)", async () => {
  const toggles = vector({ loops: false });
  const { result, mock } = await runCombo({ toggles, runId: "combo-arbitrated" });
  // One pass per stage; overlord's plan panel still ran its blind judge —
  // EVERYTHING gets arbitrated exactly once; the gate reports and stops.
  assert.equal(result.total_passes, 2);
  assert.ok(mock.calls.judges > 0, "the arbiter (judge) ran");
  assert.equal(result.stop_reason, "gate-failed-single-pass");
});

test("owner scenario: loops with a single model = self-review iteration to green", async () => {
  const toggles = vector({ "multi-model": false });
  const { result } = await runCombo({
    toggles,
    config: { ...baseConfig, ...SOLO_ASSIGNMENTS },
    runId: "combo-solo-loops",
  });
  assert.equal(result.converged, true, JSON.stringify({ code: result.code }));
  assert.ok(result.cast.every((c) => c.executor_ref === "model:mock/solo-model"));
});

test("owner scenario: autoresearch with multi-model on vs off both operate", async () => {
  const run = (toggles) => runResearch({
    run_id: "combo-research",
    question: "q", hypothesis: "h", experiment: "e",
    metric: { name: "m", comparator: ">=", target: 10 },
    stop: { max_iterations: 3 },
  }, { attended: true, toggles, runExperiment: async (i) => ({ measurement: i * 5 }) });

  const multiOn = await run(vector());
  assert.equal(multiOn.stop_reason, "target-met");
  const multiOff = await run(vector({ "multi-model": false }));
  assert.equal(multiOff.stop_reason, "target-met", "research is cast-agnostic; multi-model only shapes executors");
  const loopsOff = await run(vector({ loops: false }));
  assert.equal(loopsOff.ok, false, "one-shot mode must not turn a missed objective into success");
  assert.equal(loopsOff.stop_reason, "max-iterations");
  assert.ok(loopsOff.warnings.includes("loops-off-one-shot-research"));
});

// ---------------------------------------------------------------------------
// The five-loop catalog executes end to end (mock adapters, no-live).
// ---------------------------------------------------------------------------

function chainConfig(chainId, gate, extra = {}) {
  return {
    ...baseConfig,
    id: `${chainId}-e2e`,
    chain: chainId,
    objective_gate: gate,
    default_assignment: { kind: "composite", preset: "daily" },
    assignments: {},
    ...extra,
  };
}

test("tdd-fix executes red-first end to end: gate must FAIL before the fix loop turns it green", async () => {
  const repo = tempRepo({ "regress.txt": "no marker yet\n" });
  try {
    const mock = createStagedMockAdapter();
    const result = await runStagedTaskLoop(
      chainConfig("tdd-fix", { type: "file-contains", path: "regress.txt", contains: "FIXED" }),
      { chainRegistry, presets },
      {
        cwd: repo, now: NOW, seed: 7, run_id: "tdd-e2e", toggles: vector(),
        adapter: mock.dispatchAdapter,
        revisionAdapter: mock.revisionAdapter({ "regress.txt": "reproduced then\nFIXED\n" }),
        worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      },
    );
    assert.equal(result.converged, true, JSON.stringify({ code: result.code, flow: result.flow }));
    const reproduce = result.flow.find((f) => f.stage_id === "reproduce");
    assert.equal(reproduce.action, "advance", "red first: the failing gate ADVANCES the reproduce stage");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("scout and research chains execute as bounded recon over a pre-satisfied gate", async () => {
  for (const [chainId, artifact] of [["scout", "BRIEF.md"], ["research", "RESEARCH.md"]]) {
    const repo = tempRepo({ [artifact]: "seeded artifact\nDONE\n" });
    try {
      const mock = createStagedMockAdapter();
      const result = await runStagedTaskLoop(
        chainConfig(chainId, { type: "file-contains", path: artifact, contains: "DONE" }),
        { chainRegistry, presets },
        {
          cwd: repo, now: NOW, seed: 7, run_id: `${chainId}-e2e`, toggles: vector(),
          adapter: mock.dispatchAdapter,
          revisionAdapter: mock.revisionAdapter({ [artifact]: "seeded artifact\nDONE\n" }),
          worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
        },
      );
      assert.equal(result.converged, true, `${chainId}: ${JSON.stringify({ code: result.code, flow: result.flow })}`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("ship-pre-pr executes its gauntlet stage (reviewer, red-team, verifier) once", async () => {
  const repo = tempRepo({ "checklist.txt": "all checks recorded\nSHIP\n" });
  try {
    const mock = createStagedMockAdapter();
    const executed = [];
    const order = [];
    let handoffContext = null;
    const adapter = {
      ...mock.dispatchAdapter,
      runCandidate(spec, ctx) {
        order.push(spec.role);
        return mock.dispatchAdapter.runCandidate(spec, ctx);
      },
      runVerifier(input, ctx) {
        order.push("verifier");
        return mock.dispatchAdapter.runVerifier(input, ctx);
      },
    };
    const result = await runStagedTaskLoop(
      chainConfig("ship-pre-pr", { type: "file-contains", path: "checklist.txt", contains: "SHIP" }),
      { chainRegistry, presets },
      {
        cwd: repo, now: NOW, seed: 7, run_id: "ship-e2e", toggles: vector(),
        adapter,
        revisionAdapter: mock.revisionAdapter({ "checklist.txt": "all checks recorded\nSHIP\n" }),
        worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
        events: { onEvent(event) { if (event.kind === "gate" && event.phase === "conclusion") order.push("objective-gate"); } },
        step_effects: {
          localCheck: async (step) => { executed.push(step.id); order.push(step.id); return { ok: true }; },
          handoff: async (step, ctx) => {
            handoffContext = ctx;
            executed.push(step.id);
            order.push(step.id);
            return { ok: true };
          },
        },
      },
    );
    assert.equal(result.converged, true, JSON.stringify({ code: result.code, flow: result.flow }));
    assert.ok(mock.calls.verifiers > 0, "the gauntlet's verifier role ran");
    assert.deepEqual(executed, ["intent", "rebase", "tests", "docs", "lint", "public-safety", "pr-handoff"]);
    assert.deepEqual(order, [
      "intent", "rebase", "reviewer", "redteam",
      "tests", "docs", "lint", "public-safety", "verifier", "objective-gate", "pr-handoff",
    ]);
    assert.equal(handoffContext.idempotency_key, "ship-e2e:ship-pre-pr:gauntlet:pr-handoff");
    assert.equal(result.total_passes, 1, "a gauntlet is one pass, not a loop");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("ship-pre-pr refuses before dispatch when declared check/handoff effects are absent", async () => {
  const repo = tempRepo({ "checklist.txt": "SHIP\n" });
  try {
    const mock = createStagedMockAdapter();
    const result = await runStagedTaskLoop(
      chainConfig("ship-pre-pr", { type: "file-contains", path: "checklist.txt", contains: "SHIP" }),
      { chainRegistry, presets },
      {
        cwd: repo,
        now: NOW,
        run_id: "ship-missing-effects",
        toggles: vector(),
        adapter: mock.dispatchAdapter,
        worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
      },
    );
    assert.equal(result.code, "missing-chain-step-effect:local-check");
    assert.equal(mock.calls.candidates, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("ship-pre-pr never runs the outward handoff before a passing objective gate", async () => {
  const repo = tempRepo({ "checklist.txt": "local checks only\n" });
  try {
    const mock = createStagedMockAdapter();
    let handedOff = false;
    const result = await runStagedTaskLoop(
      chainConfig("ship-pre-pr", { type: "file-contains", path: "checklist.txt", contains: "SHIP" }),
      { chainRegistry, presets },
      {
        cwd: repo,
        now: NOW,
        run_id: "ship-no-source",
        toggles: vector(),
        adapter: mock.dispatchAdapter,
        worktree: makeGitWorktreeEffect(repo, { baseDir: join(repo, ".wt") }),
        step_effects: {
          localCheck: async () => ({ ok: true }),
          handoff: async () => { handedOff = true; return { ok: true }; },
        },
      },
    );
    assert.equal(result.converged, false);
    assert.equal(handedOff, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
