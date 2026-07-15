// Native Helix surface: settings, profiles, setup casts, research
// preflight, run watch/resume, preset views, dashboard lines. All fake-Pi:
// options-injected registries + temp roots; no Pi runtime, no live calls.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeHelixCommand, getHelixArgumentCompletions } from "../extensions/lib/helix-command-core.mjs";
import { makeEventLog } from "../dispatch/lib/events.mjs";
import { hashRef, stableStringify } from "../dispatch/lib/run-record.mjs";
import { disagreementSnapshotPath, RUNNER_STATE_SCHEMA_VERSION } from "../dispatch/lib/runner.mjs";
import { resolveChain } from "../dispatch/lib/chains.mjs";
import { loadPresetRegistry, resolveChainCast } from "../dispatch/lib/presets.mjs";

const repoRoot = new URL("../", import.meta.url).pathname;

function readJson(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const registries = {
  runRegistry: readJson("dispatch/config/run-configs.json"),
  chainRegistry: readJson("dispatch/config/chains.json"),
  roleMatrix: readJson("dispatch/config/role-matrix-defaults.json"),
  agentTeam: readJson("dispatch/config/agent-team-defaults.json"),
  packageJson: readJson("package.json"),
};

function tempOptions() {
  const root = mkdtempSync(join(tmpdir(), "helix-surface-"));
  return {
    root,
    options: {
      root,
      stateRoot: root,
      ...registries,
      matricesDir: join(repoRoot, "dispatch", "config", "matrices"),
      settingsPath: join(root, "settings.json"),
      runsRoot: join(root, "runs"),
    },
  };
}

function writeResumeBundle(options, runId, { completed = false, stopReason = null } = {}) {
  const runDir = join(options.runsRoot, runId);
  mkdirSync(runDir, { recursive: true });
  const log = makeEventLog({ run_id: runId, dir: runDir });
  log.emit("run-start", { chain_id: "full-cycle", config_id: "mock-core-loop", max_iterations: 5 });
  log.emit("stage-start", { stage_id: "plan", executor_ref: "composite:overlord" });
  log.emit("pass-start", { stage_id: "plan", pass: 1, of: 5, attempt: 1, executor_ref: "composite:overlord" });
  log.emit("verdict", { stage_id: "plan", verdict: "approve" });
  log.emit("stage-end", { stage_id: "plan" });
  if (completed) {
    log.emit("stage-start", { stage_id: "implement", executor_ref: "composite:daily" });
    log.emit("pass-start", { stage_id: "implement", pass: 1, of: 5, attempt: 1, executor_ref: "composite:daily" });
    log.emit("verdict", { stage_id: "implement", verdict: "approve" });
    log.emit("stage-end", { stage_id: "implement" });
    log.emit("gate", { stage_id: "implement", phase: "conclusion", result: "pass" });
    log.emit("run-end", { converged: true, stop_reason: stopReason ?? "converged", open_disagreements: 0 });
  }
  const disagreements = { schema_version: 1, run_id: runId, entries: [] };
  writeFileSync(join(runDir, `${runId}.disagreements.json`), stableStringify(disagreements) + "\n", "utf8");
  const disagreementRef = hashRef(stableStringify(disagreements));
  writeFileSync(disagreementSnapshotPath(runDir, runId, disagreementRef), stableStringify(disagreements) + "\n", "utf8");
  const ref = (value) => hashRef(`${runId}:${value}`);
  const config = registries.runRegistry.configs.find((candidate) => candidate.id === "mock-core-loop");
  const chain = resolveChain(registries.chainRegistry, "full-cycle").chain;
  const presets = loadPresetRegistry(join(repoRoot, "dispatch", "config", "matrices")).presets;
  const cast = resolveChainCast({
    chain,
    assignments: config.assignments,
    defaults: config.default_assignment,
    presets,
  }).cast;
  const state = {
    schema_version: RUNNER_STATE_SCHEMA_VERSION,
    run_id: runId,
    config_id: "mock-core-loop",
    chain_id: "full-cycle",
    run_target: { repo: "self" },
    completed,
    ...(completed ? { stop_reason: stopReason ?? "converged" } : {}),
    machine: completed
      ? { phase: "conclusion", stage_index: 1, pass_counts: { plan: 1, implement: 1 }, total_passes: 2 }
      : { phase: "stage", stage_index: 1, pass_counts: { plan: 1, implement: 0 }, total_passes: 1 },
    event_count: log.events.length,
    execution_ref: ref("execution"),
    repository_ref: ref("repository"),
    checkout_ref: ref("checkout"),
    worktree_enabled: true,
    worktree_ref: ref("worktree"),
    worktree_owner_ref: ref("worktree-owner"),
    handoff_source: completed ? null : { stage_id: "plan", kind: "stage-artifact", content_ref: ref("plan") },
    disagreement_ref: disagreementRef,
    pending_event: null,
    resolved_cast: cast,
    prompt_resources_ref: ref("prompt-resources"),
    initializing: false,
    baseline_ref: ref("baseline"),
    checkpoint_tree_ref: null,
    checkpoint_generation: null,
    pass_in_progress: null,
    run_generation: `r-${runId}`,
    checkout_state_ref: ref("checkout-state"),
  };
  writeFileSync(join(runDir, `${runId}.state.json`), stableStringify(state) + "\n", "utf8");
  return state;
}

test("settings view shows the six checkboxes and set round-trips a toggle", () => {
  const { root, options } = tempOptions();
  try {
    const view = executeHelixCommand("settings", { mode: "tui" }, options);
    assert.equal(view.ok, true);
    assert.match(view.text, /\[x\] multi-model/);
    assert.equal(view.details.source, "defaults");

    const off = executeHelixCommand("settings set autoresearch off", { mode: "tui", confirm: true }, options);
    assert.equal(off.ok, true);
    assert.equal(off.details.toggles.autoresearch, false);

    const view2 = executeHelixCommand("settings", { mode: "tui" }, options);
    assert.equal(view2.details.source, "file");
    assert.match(view2.text, /\[ \] autoresearch/);

    const bad = executeHelixCommand("settings set warp-drive on", { mode: "tui", confirm: true }, options);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "unknown-toggle:warp-drive");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("profiles: create, setup a cast, show, switch, list — and typos refuse", () => {
  const { root, options } = tempOptions();
  try {
    const created = executeHelixCommand("profiles create deep-work", { mode: "tui", confirm: true }, options);
    assert.equal(created.ok, true, JSON.stringify(created.details));

    const setup = executeHelixCommand(
      "setup deep-work plan=overlord implement=openai-codex/gpt-5x:high",
      { mode: "tui", confirm: true },
      { ...options, modelInventory: [{
        provider: "openai-codex", model: "gpt-5x", reasoning: true,
        supported_efforts: ["default", "provider-managed", "low", "medium", "high"],
      }] },
    );
    assert.equal(setup.ok, true, JSON.stringify(setup.details));
    assert.equal(setup.details.assignments.plan.preset, "overlord");
    assert.deepEqual(setup.details.assignments.implement, {
      kind: "model", provider: "openai-codex", model: "gpt-5x", effort: "high",
    });

    const show = executeHelixCommand("profiles show deep-work", { mode: "tui" }, options);
    assert.match(show.text, /plan -> composite:overlord/);
    assert.match(show.text, /implement -> model:openai-codex\/gpt-5x:high/);

    const list = executeHelixCommand("profiles", { mode: "tui" }, options);
    assert.match(list.text, /deep-work \(active\)/, "setup activates the profile");

    const unknownPreset = executeHelixCommand("setup deep-work plan=warlord", { mode: "tui", confirm: true }, options);
    assert.equal(unknownPreset.code, "unknown-preset:warlord");

    const unknownSwitch = executeHelixCommand("profiles switch nope", { mode: "tui", confirm: true }, options);
    assert.equal(unknownSwitch.code, "unknown-profile");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the ACTIVE profile's cast overlays run preflight (never chain/gate)", () => {
  const { root, options } = tempOptions();
  try {
    executeHelixCommand("profiles create deep-work", { mode: "tui", confirm: true }, options);
    executeHelixCommand("setup deep-work plan=daily", { mode: "tui", confirm: true }, options);
    const preflight = executeHelixCommand("run mock-core-loop", { mode: "tui" }, options);
    assert.equal(preflight.ok, true, JSON.stringify(preflight.details));
    assert.match(preflight.text, /Cast source: profile deep-work \(assignments\)/);
    assert.match(preflight.text, /plan=composite:daily/, "profile overrode the tracked overlord plan cast");
    assert.match(preflight.text, /implement=composite:daily/, "untouched tracked assignment survives");
    assert.equal(preflight.details.chain.id, "full-cycle", "chain is tracked-config territory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every /helix mutation requires attended TUI confirmation", () => {
  const { root, options } = tempOptions();
  try {
    const settingsPath = options.settingsPath;
    const rpc = executeHelixCommand("settings set loops off", { mode: "rpc", confirm: true }, options);
    assert.equal(rpc.code, "helix-mutation-requires-tui-confirm");
    assert.equal(existsSync(settingsPath), false);

    const cancelled = executeHelixCommand("profiles create guarded", { mode: "tui", confirm: false }, options);
    assert.equal(cancelled.code, "helix-mutation-cancelled");
    assert.equal(existsSync(join(root, "profiles", "guarded.json")), false);

    const created = executeHelixCommand("profiles create guarded", { mode: "tui", confirm: true }, options);
    assert.equal(created.ok, true);
    const duplicate = executeHelixCommand("profiles create guarded", { mode: "tui", confirm: true }, options);
    assert.equal(duplicate.code, "helix-profile-exists");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup stores inventory-validated real composite members and run preflight uses Pi transport", () => {
  const { root, options } = tempOptions();
  const withInventory = {
    ...options,
    modelInventory: [{
      provider: "openai-codex", model: "gpt-5x", reasoning: true,
      supported_efforts: ["default", "provider-managed", "low", "medium", "high"],
    }],
  };
  try {
    assert.equal(executeHelixCommand("profiles create live", { mode: "tui", confirm: true }, options).ok, true);
    const setup = executeHelixCommand(
      "setup live daily.builder=openai-codex/gpt-5x:high daily.reviewer=openai-codex/gpt-5x:medium*2",
      { mode: "tui", confirm: true },
      withInventory,
    );
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const profile = JSON.parse(readFileSync(join(root, "profiles", "live.json"), "utf8"));
    assert.equal(profile.overrides.presets.daily.roles.builder[0].provider, "openai-codex");
    assert.equal(profile.overrides.presets.daily.roles.reviewer[0].instances, 2);

    const models = executeHelixCommand("models", { mode: "tui" }, withInventory);
    assert.match(models.text, /openai-codex\/gpt-5x:high x1/);
    const preflight = executeHelixCommand("run mock-core-loop", { mode: "tui" }, withInventory);
    assert.equal(preflight.ok, true, JSON.stringify(preflight));
    assert.match(preflight.text, /live via Pi configured providers/);

    assert.equal(executeHelixCommand("profiles create absent", { mode: "tui", confirm: true }, options).ok, true);
    const unavailable = executeHelixCommand(
      "setup absent daily.builder=openai-codex/not-there:high",
      { mode: "tui", confirm: true },
      withInventory,
    );
    assert.equal(unavailable.code, "preset-member-unavailable");
    const absent = JSON.parse(readFileSync(join(root, "profiles", "absent.json"), "utf8"));
    assert.deepEqual(absent.overrides, {}, "a refused setup must not mutate the existing profile");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup restores the prior profile when active-pointer persistence fails", () => {
  const { root, options } = tempOptions();
  try {
    assert.equal(executeHelixCommand("profiles create victim", { mode: "tui", confirm: true }, options).ok, true);
    assert.equal(executeHelixCommand("setup victim plan=overlord", { mode: "tui", confirm: true }, options).ok, true);
    const dir = join(root, "profiles");
    mkdirSync(join(dir, "active.json.pending"));

    const refused = executeHelixCommand("setup victim plan=daily", { mode: "tui", confirm: true }, options);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "helix-profile-write-failed");
    const profile = JSON.parse(readFileSync(join(dir, "victim.json"), "utf8"));
    assert.equal(profile.overrides.assignments.plan.preset, "overlord");
    assert.equal(JSON.parse(readFileSync(join(dir, "active.json"), "utf8")).profile_id, "victim");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed or dangling active profile pointers fail closed on rendered surfaces", () => {
  const { root, options } = tempOptions();
  try {
    const dir = join(root, "profiles");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "active.json"), JSON.stringify({ profile_id: null }), "utf8");
    for (const args of ["", "run mock-core-loop", "profiles", "models"]) {
      const out = executeHelixCommand(args, { mode: "print" }, options);
      assert.equal(out.ok, false, args);
      assert.equal(out.code, "helix-active-profile-invalid", args);
    }

    writeFileSync(join(dir, "active.json"), JSON.stringify({ schema_version: 1, profile_id: "missing" }), "utf8");
    const dangling = executeHelixCommand("run mock-core-loop", { mode: "print" }, options);
    assert.equal(dangling.code, "unknown-profile");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup with no arguments is the guided view: presets, stages, inventory, and transport truth", () => {
  const { root, options } = tempOptions();
  try {
    const view = executeHelixCommand("setup", { mode: "tui" }, options);
    assert.equal(view.ok, true);
    assert.deepEqual(view.details.presets, ["daily", "overlord"]);
    assert.deepEqual(view.details.chains["full-cycle"], ["plan", "implement"]);
    assert.match(view.text, /Real-provider casts run through Pi's configured ModelRegistry/);
    assert.match(view.text, /available-model inventory: unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research preflight enforces the mandatory shape, attendance, and the toggle", () => {
  const { root, options } = tempOptions();
  try {
    const ok = executeHelixCommand("research does caching help --metric latency-ms <= 100 --max 5 --plateau 2", { mode: "tui" }, options);
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.match(ok.details.cli_invocation, /helix-research\.mjs/);
    assert.match(ok.details.question_ref, /^sha256:/);
    assert.doesNotMatch(JSON.stringify(ok), /does caching help/);
    assert.match(ok.details.cli_invocation, /<private-question>/);
    assert.equal(ok.details.launches_loop, false);

    const noMetric = executeHelixCommand("research why --max 3", { mode: "tui" }, options);
    assert.equal(noMetric.code, "research-missing-metric");
    const noStop = executeHelixCommand("research why --metric m >= 1", { mode: "tui" }, options);
    assert.equal(noStop.code, "research-missing-stop");

    const unattended = executeHelixCommand("research why --metric m >= 1 --max 2", { mode: "rpc" }, options);
    assert.equal(unattended.code, "research-requires-attended");

    executeHelixCommand("settings set autoresearch off", { mode: "tui", confirm: true }, options);
    const disabled = executeHelixCommand("research why --metric m >= 1 --max 2", { mode: "tui" }, options);
    assert.equal(disabled.code, "toggle-disabled:autoresearch");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs watch renders the loop widget from a real event stream", () => {
  const { root, options } = tempOptions();
  try {
    const runDir = join(options.runsRoot, "watch-me");
    mkdirSync(runDir, { recursive: true });
    const log = makeEventLog({ run_id: "watch-me", dir: runDir });
    log.emit("run-start", { chain_id: "full-cycle", config_id: "mock-core-loop", max_iterations: 5 });
    log.emit("stage-start", { stage_id: "plan", executor_ref: "composite:overlord" });
    log.emit("pass-start", { stage_id: "plan", pass: 1, of: 5, attempt: 1, executor_ref: "composite:overlord" });
    log.emit("verdict", { stage_id: "plan", verdict: "approve" });
    log.emit("stage-end", { stage_id: "plan" });
    log.emit("stage-start", { stage_id: "implement", executor_ref: "composite:daily" });
    log.emit("pass-start", { stage_id: "implement", pass: 1, of: 5, attempt: 1, executor_ref: "composite:daily" });
    log.emit("verdict", { stage_id: "implement", verdict: "approve" });
    log.emit("stage-end", { stage_id: "implement" });
    log.emit("gate", { stage_id: "implement", phase: "conclusion", result: "fail" });
    log.emit("pass-start", { stage_id: "implement", pass: 2, of: 5, attempt: 1, executor_ref: "composite:daily" });
    log.emit("pressure", { stage_id: "implement", tokens: 45, status: "measured" });
    log.emit("verdict", { stage_id: "implement", verdict: "revise" });
    log.emit("blocked", { code: "stage-max-passes-exhausted:implement", next_action: "revise-cast-or-raise-stage-ceiling-then-resume" });

    const watch = executeHelixCommand("runs watch watch-me", { mode: "print" }, options);
    assert.equal(watch.ok, true, JSON.stringify(watch.details));
    assert.match(watch.text, /implement pass 2\/5/);
    assert.match(watch.text, /cast composite:daily/);
    assert.match(watch.text, /Gate: fail \(conclusion\)/);
    assert.match(watch.text, /Verdict: revise/);
    assert.match(watch.text, /Pressure: 45 tokens/);
    assert.match(watch.text, /Blocked: stage-max-passes-exhausted:implement/);
    assert.equal(watch.details.finished, false);

    const missing = executeHelixCommand("runs watch nothing-here", { mode: "print" }, options);
    assert.equal(missing.code, "run-not-found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs watch/resume scan disk content read-time: a leak-shaped file fails closed", () => {
  const { root, options } = tempOptions();
  try {
    // A doctored events file the guarded emitter could never have written
    // (home path in a field) — the renderer must refuse, not display it.
    const evDir = join(options.runsRoot, "tainted");
    mkdirSync(evDir, { recursive: true });
    const leak = "/Us" + "ers/someone/secret"; // split so the repo scanner doesn't self-match
    writeFileSync(join(evDir, "tainted.events.jsonl"),
      JSON.stringify({ run_id: "tainted", seq: 1, t_rel_ms: 0, kind: "run-end", stop_reason: leak }) + "\n", "utf8");
    const watch = executeHelixCommand("runs watch tainted", { mode: "print" }, options);
    assert.equal(watch.ok, false);
    assert.equal(watch.code, "run-record-invalid-or-unsafe");
    assert.ok(!JSON.stringify(watch).includes("secret"), "the leak never reaches rendered output");

    const stDir = join(options.runsRoot, "tainted-state");
    mkdirSync(stDir, { recursive: true });
    writeFileSync(join(stDir, "tainted-state.state.json"),
      JSON.stringify({ schema_version: 1, run_id: "tainted-state", completed: false, machine: { note: leak } }), "utf8");
    const resume = executeHelixCommand("runs resume tainted-state", { mode: "print" }, options);
    assert.equal(resume.ok, false);
    assert.equal(resume.code, "run-record-invalid-or-unsafe");

    // Malformed (non-JSON) files fail closed distinctly, not by crashing.
    const badDir = join(options.runsRoot, "malformed");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "malformed.events.jsonl"), "{not json\n", "utf8");
    const bad = executeHelixCommand("runs watch malformed", { mode: "print" }, options);
    assert.equal(bad.code, "helix-config-unreadable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs watch refuses a symlinked event stream before reading its target", () => {
  const { root, options } = tempOptions();
  const outside = mkdtempSync(join(tmpdir(), "helix-events-outside-"));
  try {
    const runDir = join(options.runsRoot, "linked-events");
    mkdirSync(runDir, { recursive: true });
    const target = join(outside, "events.jsonl");
    writeFileSync(target, "private target must never be parsed\n", "utf8");
    symlinkSync(target, join(runDir, "linked-events.events.jsonl"));
    const watch = executeHelixCommand("runs watch linked-events", { mode: "print" }, options);
    assert.equal(watch.code, "run-record-invalid-or-unsafe");
    assert.equal(JSON.stringify(watch).includes("private target"), false);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("resume CLI carries the run's config binding, not the default", () => {
  const { root, options } = tempOptions();
  try {
    writeResumeBundle(options, "bound-run");
    const resume = executeHelixCommand("runs resume bound-run", { mode: "print" }, options);
    assert.equal(resume.ok, true);
    assert.match(resume.details.cli_invocation, /--resume bound-run --config mock-core-loop --repo '<original-repository>'/);
    assert.equal(resume.details.config_id, "mock-core-loop");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs resume distinguishes resumable, completed, and missing runs", () => {
  const { root, options } = tempOptions();
  try {
    writeResumeBundle(options, "resumable");
    const resumable = executeHelixCommand("runs resume resumable", { mode: "print" }, options);
    assert.equal(resumable.ok, true);
    assert.match(resumable.details.cli_invocation, /--resume resumable/);

    writeResumeBundle(options, "done-run", { completed: true });
    const done = executeHelixCommand("runs resume done-run", { mode: "print" }, options);
    assert.equal(done.ok, true);
    assert.match(done.text, /already completed/);

    const missing = executeHelixCommand("runs resume ghost", { mode: "print" }, options);
    assert.equal(missing.code, "run-not-found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs resume accepts the pre-event initializing checkpoint", () => {
  const { root, options } = tempOptions();
  try {
    const state = writeResumeBundle(options, "initializing-run");
    const runDir = join(options.runsRoot, "initializing-run");
    const initializing = {
      ...state,
      machine: { phase: "stage", stage_index: 0, pass_counts: { plan: 0, implement: 0 }, total_passes: 0 },
      event_count: 0,
      worktree_ref: null,
      handoff_source: null,
      initializing: true,
      checkout_state_ref: null,
    };
    writeFileSync(join(runDir, "initializing-run.state.json"), stableStringify(initializing) + "\n", "utf8");
    rmSync(join(runDir, "initializing-run.events.jsonl"), { force: true });
    rmSync(disagreementSnapshotPath(runDir, "initializing-run", state.disagreement_ref), { force: true });
    const resume = executeHelixCommand("runs resume initializing-run", { mode: "print" }, options);
    assert.equal(resume.ok, true, JSON.stringify(resume));
    assert.match(resume.text, /resumable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs resume refuses a structurally valid machine state impossible for its bound chain", () => {
  const { root, options } = tempOptions();
  try {
    const state = writeResumeBundle(options, "impossible-machine");
    const impossible = {
      ...state,
      machine: { phase: "stage", stage_index: 1, pass_counts: { plan: 0, implement: 1 }, total_passes: 1 },
      handoff_source: { stage_id: "implement", kind: "objective-gate", content_ref: hashRef("impossible") },
    };
    writeFileSync(
      join(options.runsRoot, "impossible-machine", "impossible-machine.state.json"),
      stableStringify(impossible) + "\n",
      "utf8",
    );
    const resume = executeHelixCommand("runs resume impossible-machine", { mode: "print" }, options);
    assert.equal(resume.ok, false);
    assert.equal(resume.code, "invalid-resume-state");
    assert.equal(resume.details.detail, "machine-config-binding");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs resume refuses missing or malformed companion events/disagreements", () => {
  const { root, options } = tempOptions();
  try {
    writeResumeBundle(options, "bad-events");
    writeFileSync(join(options.runsRoot, "bad-events", "bad-events.events.jsonl"), JSON.stringify({
      run_id: "bad-events", seq: 1, t_rel_ms: 0, kind: "warning", code: { prose: "raw model response" },
    }) + "\n", "utf8");
    assert.equal(executeHelixCommand("runs resume bad-events", { mode: "print" }, options).code, "resume-events-invalid");

    writeResumeBundle(options, "mismatched-pass");
    const mismatchedPath = join(options.runsRoot, "mismatched-pass", "mismatched-pass.events.jsonl");
    const mismatchedEvents = readFileSync(mismatchedPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    mismatchedEvents.find((event) => event.kind === "pass-start").stage_id = "implement";
    writeFileSync(
      mismatchedPath,
      mismatchedEvents.map((event) => stableStringify(event)).join("\n") + "\n",
      "utf8",
    );
    assert.equal(
      executeHelixCommand("runs resume mismatched-pass", { mode: "print" }, options).code,
      "resume-events-invalid",
    );

    writeResumeBundle(options, "bad-disagreements");
    const badState = JSON.parse(readFileSync(join(options.runsRoot, "bad-disagreements", "bad-disagreements.state.json"), "utf8"));
    writeFileSync(disagreementSnapshotPath(
      join(options.runsRoot, "bad-disagreements"),
      "bad-disagreements",
      badState.disagreement_ref,
    ), JSON.stringify({
      schema_version: 1, run_id: "bad-disagreements", entries: [{ id: "raw prose", stage_id: "plan", status: "open" }],
    }), "utf8");
    assert.equal(
      executeHelixCommand("runs resume bad-disagreements", { mode: "print" }, options).code,
      "resume-disagreements-invalid",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs watch/resume refuse events after the single terminal run-end", () => {
  const { root, options } = tempOptions();
  try {
    writeResumeBundle(options, "terminal-tail", { completed: true });
    const path = join(options.runsRoot, "terminal-tail", "terminal-tail.events.jsonl");
    const events = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    events.push({
      run_id: "terminal-tail",
      seq: events.length + 1,
      t_rel_ms: events.at(-1).t_rel_ms,
      kind: "warning",
      code: "after-terminal",
    });
    writeFileSync(path, events.map((event) => stableStringify(event)).join("\n") + "\n", "utf8");
    assert.equal(executeHelixCommand("runs watch terminal-tail", { mode: "print" }, options).code,
      "run-record-invalid-or-unsafe");
    assert.equal(executeHelixCommand("runs resume terminal-tail", { mode: "print" }, options).code,
      "resume-events-invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs watch refuses claimed convergence without an objective-gate pass", () => {
  const { root, options } = tempOptions();
  try {
    const runDir = join(options.runsRoot, "false-convergence");
    mkdirSync(runDir, { recursive: true });
    const log = makeEventLog({ run_id: "false-convergence", dir: runDir });
    log.emit("run-start", { chain_id: "full-cycle", config_id: "mock-core-loop", max_iterations: 5 });
    log.emit("run-end", { converged: true, stop_reason: "converged", open_disagreements: 0 });
    const watch = executeHelixCommand("runs watch false-convergence", { mode: "print" }, options);
    assert.equal(watch.code, "run-record-invalid-or-unsafe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("models shows both presets with members; dashboard shows toggles and profile", () => {
  const { root, options } = tempOptions();
  try {
    const models = executeHelixCommand("models", { mode: "print" }, options);
    assert.equal(models.ok, true);
    assert.match(models.text, /overlord \(degradation=fail-closed\)/);
    assert.doesNotMatch(models.text, /Overlord/);
    assert.match(models.text, /reviewer: mock\/mock-overlord-reviewer-a:high x1, mock\/mock-overlord-reviewer-b:high x1/);

    const dash = executeHelixCommand("", { mode: "print" }, options);
    assert.equal(dash.ok, true);
    assert.match(dash.text, /Toggles: multi-model, loops, autoresearch, context-engine, worktree, visual-cues/);
    assert.match(dash.text, /Profile: \(none\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("new verbs appear in completions; rendered surfaces stay public-safe", () => {
  const verbs = getHelixArgumentCompletions("").map((c) => c.value);
  assert.deepEqual(verbs, ["help", "run", "runs", "models", "chains", "workflows", "settings", "profiles", "setup", "research"]);
  const runsVerbs = getHelixArgumentCompletions("runs ").map((c) => c.value.trim());
  assert.deepEqual(runsVerbs, ["runs list", "runs status", "runs watch", "runs resume", "runs prune"]);

  const { root, options } = tempOptions();
  try {
    for (const args of ["", "help", "models", "chains", "settings", "setup", "profiles"]) {
      const out = executeHelixCommand(args, { mode: "print" }, options);
      const rendered = JSON.stringify(out);
      assert.ok(!/\/Users\/[a-z]/i.test(rendered), `${args || "dashboard"}: no home paths in rendered output`);
      assert.ok(!/sk-[a-z0-9-]{20,}/i.test(rendered), `${args || "dashboard"}: no key shapes`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
