// M4 — composite presets + per-stage casts: skeleton registry, fail-closed
// degradation naming the member, effort vocabularies, multi-model-off
// conflicts vs solo collapse, and chain cast resolution.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRESET_CODES,
  validatePreset,
  loadPresetRegistry,
  assertPresetAvailable,
  resolveStageExecutor,
  resolveChainCast,
} from "../dispatch/lib/presets.mjs";
import { resolveChain } from "../dispatch/lib/chains.mjs";
import { validateRunConfigRegistry } from "../dispatch/lib/run-configs.mjs";
import { toggleVector, defaultSettings } from "../dispatch/lib/settings.mjs";
import { MAX_PANEL_MEMBERS } from "../dispatch/lib/limits.mjs";

const matricesDir = new URL("../dispatch/config/matrices/", import.meta.url).pathname;
const registry = loadPresetRegistry(matricesDir);
const chainRegistry = JSON.parse(readFileSync(new URL("../dispatch/config/chains.json", import.meta.url), "utf8"));
const fullCycle = resolveChain(chainRegistry, "full-cycle").chain;

const ON = toggleVector(defaultSettings());
const MULTI_OFF = { ...ON, "multi-model": false };

test("the shipped overlord/daily skeletons load, validate, and stay mock-only", () => {
  assert.equal(registry.ok, true, JSON.stringify(registry));
  assert.deepEqual([...registry.presets.keys()], ["daily", "overlord"]);
  const overlord = registry.presets.get("overlord");
  assert.equal(overlord.degradation, "fail-closed");
  assert.equal(overlord.roles.reviewer.length, 2, "overlord carries two independent reviewers");
  for (const preset of registry.presets.values()) {
    for (const members of Object.values(preset.roles)) {
      for (const member of members) {
        assert.equal(member.provider, "mock", "tracked skeletons never commit a personal lineup");
        assert.ok(member.effort_vocab.includes(member.effort));
      }
    }
  }
});

test("preset validation refuses out-of-vocab efforts and non-automated providers", () => {
  const base = registry.presets.get("daily");
  const badEffort = {
    ...base,
    roles: { builder: [{ provider: "mock", model: "m", effort: "max", instances: 1, effort_vocab: ["low"] }] },
  };
  assert.equal(validatePreset(badEffort).valid, false);
  const claudeLocal = {
    ...base,
    roles: { builder: [{ provider: "claude-local", model: "m", effort: "high", instances: 1 }] },
  };
  assert.equal(validatePreset(claudeLocal).valid, false);
  const proseModel = {
    ...base,
    roles: { builder: [{ provider: "mock", model: "raw model prose", effort: "default", instances: 1 }] },
  };
  assert.equal(validatePreset(proseModel).valid, false);
  const locatorModel = {
    ...base,
    roles: { builder: [{ provider: "mock", model: "https:" + "/example.test/model", effort: "default", instances: 1 }] },
  };
  assert.equal(validatePreset(locatorModel).valid, false);
});

test("preset validation rejects unsafe or oversized expanded panels", () => {
  const base = registry.presets.get("daily");
  const unsafe = {
    ...base,
    roles: {
      ...base.roles,
      builder: [{ ...base.roles.builder[0], instances: Number.MAX_SAFE_INTEGER + 1 }],
    },
  };
  assert.equal(validatePreset(unsafe).valid, false);

  const oversized = {
    ...base,
    preset_id: "oversized",
    roles: {
      builder: Array.from({ length: MAX_PANEL_MEMBERS + 1 }, (_, index) => ({
        provider: "mock",
        model: `builder-${index}`,
        effort: "default",
        instances: 1,
      })),
    },
  };
  assert.equal(validatePreset(oversized).valid, false);
  const resolved = resolveStageExecutor({
    assignment: { kind: "composite", preset: "oversized" },
    stageRoles: ["builder"],
    presets: new Map([["oversized", oversized]]),
    toggles: ON,
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, PRESET_CODES.INVALID);

  const combined = {
    ...base,
    preset_id: "combined-oversized",
    roles: {
      builder: [{ provider: "mock", model: "builder", effort: "default", instances: 33 }],
      reviewer: [{ provider: "mock", model: "reviewer", effort: "default", instances: 32 }],
    },
  };
  assert.equal(validatePreset(combined).valid, true, "each individual role remains within the limit");
  const combinedResolved = resolveStageExecutor({
    assignment: { kind: "composite", preset: "combined-oversized" },
    stageRoles: ["builder", "reviewer"],
    presets: new Map([["combined-oversized", combined]]),
    toggles: ON,
  });
  assert.equal(combinedResolved.ok, false);
  assert.equal(combinedResolved.code, PRESET_CODES.INVALID);
});

test("the registry loader fails closed on malformed files and duplicate ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "helix-presets-"));
  try {
    writeFileSync(join(dir, "broken.json"), "{nope", "utf8");
    assert.equal(loadPresetRegistry(dir).code, PRESET_CODES.UNREADABLE);
    rmSync(join(dir, "broken.json"));

    const daily = JSON.parse(readFileSync(join(matricesDir, "daily.json"), "utf8"));
    writeFileSync(join(dir, "a.json"), JSON.stringify(daily), "utf8");
    writeFileSync(join(dir, "b.json"), JSON.stringify(daily), "utf8");
    assert.equal(loadPresetRegistry(dir).code, PRESET_CODES.DUPLICATE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("degradation fails closed NAMING the unavailable member — no substitution", () => {
  const overlord = registry.presets.get("overlord");
  const availability = (member) => member.model !== "mock-overlord-reviewer-b";
  const result = assertPresetAvailable(overlord, availability);
  assert.equal(result.ok, false);
  assert.equal(result.code, "preset-member-unavailable:overlord:mock/mock-overlord-reviewer-b");
});

test("a composite fills exactly the stage's roles; a missing role refuses by name", () => {
  const executor = resolveStageExecutor({
    assignment: { kind: "composite", preset: "overlord" },
    stageRoles: ["planner", "reviewer"],
    presets: registry.presets,
    toggles: ON,
  });
  assert.equal(executor.ok, true, JSON.stringify(executor));
  assert.equal(executor.executor_ref, "composite:overlord");
  assert.deepEqual(Object.keys(executor.roles), ["planner", "reviewer"]);
  assert.equal(executor.roles.reviewer.length, 2);

  const gutted = new Map(registry.presets);
  const noRedteam = { ...registry.presets.get("daily"), preset_id: "no-redteam", roles: { builder: registry.presets.get("daily").roles.builder } };
  gutted.set("no-redteam", noRedteam);
  const missing = resolveStageExecutor({
    assignment: { kind: "composite", preset: "no-redteam" },
    stageRoles: ["builder", "redteam"],
    presets: gutted,
    toggles: ON,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "preset-member-unavailable:no-redteam:role/redteam");
});

test("multi-model OFF: a composite is an explicit conflict; a plain model is the solo path", () => {
  const composite = resolveStageExecutor({
    assignment: { kind: "composite", preset: "overlord" },
    stageRoles: ["builder"],
    presets: registry.presets,
    toggles: MULTI_OFF,
  });
  assert.equal(composite.ok, false);
  assert.equal(composite.code, "toggle-disabled:multi-model");

  const solo = resolveStageExecutor({
    assignment: { kind: "model", provider: "openai-api", model: "gpt-x", effort: "high" },
    stageRoles: ["builder", "reviewer", "redteam"],
    presets: registry.presets,
    toggles: MULTI_OFF,
  });
  assert.equal(solo.ok, true);
  assert.equal(solo.executor_ref, "model:openai-api/gpt-x");
  // One model plays every role (self-review): panels of one, same identity.
  for (const role of ["builder", "reviewer", "redteam"]) {
    assert.deepEqual(solo.roles[role], [{ provider: "openai-api", model: "gpt-x", effort: "high", instances: 1 }]);
  }
});

test("plain-model assignments refuse non-automated providers and unknown presets refuse by id", () => {
  const claudeLocal = resolveStageExecutor({
    assignment: { kind: "model", provider: "claude-local", model: "m" },
    stageRoles: ["builder"],
    presets: registry.presets,
  });
  assert.equal(claudeLocal.code, "preset-provider-not-automated:claude-local");

  const unknown = resolveStageExecutor({
    assignment: { kind: "composite", preset: "warlord" },
    stageRoles: ["builder"],
    presets: registry.presets,
    toggles: ON,
  });
  assert.equal(unknown.code, "unknown-preset:warlord");

  const proseModel = resolveStageExecutor({
    assignment: { kind: "model", provider: "mock", model: "raw model prose" },
    stageRoles: ["builder"],
    presets: registry.presets,
  });
  assert.equal(proseModel.code, PRESET_CODES.INVALID_ASSIGNMENT);
});

test("plain real-model assignments honor inventory availability while mock stays available", () => {
  const unavailable = resolveStageExecutor({
    assignment: { kind: "model", provider: "openai-api", model: "gpt-x" },
    stageRoles: ["builder"],
    presets: registry.presets,
    availability: () => false,
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, "preset-member-unavailable:openai-api/gpt-x");

  const mock = resolveStageExecutor({
    assignment: { kind: "model", provider: "mock", model: "fixture" },
    stageRoles: ["builder"],
    presets: registry.presets,
    availability: () => false,
  });
  assert.equal(mock.ok, true);
});

test("the flagship cast: plan → overlord, implement → plain model, defaults fill the rest", () => {
  const result = resolveChainCast({
    chain: fullCycle,
    assignments: {
      plan: { kind: "composite", preset: "overlord" },
      implement: { kind: "model", provider: "openai-codex", model: "gpt-5x", effort: "high" },
    },
    presets: registry.presets,
    toggles: ON,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.cast.map((c) => c.executor_ref), ["composite:overlord", "model:openai-codex/gpt-5x"]);
  assert.deepEqual(Object.keys(result.cast[0].roles), ["planner", "reviewer"]);
  assert.deepEqual(Object.keys(result.cast[1].roles), ["builder", "reviewer", "redteam"]);
});

test("cast resolution refuses unknown stage keys and unassigned stages without a default", () => {
  const typo = resolveChainCast({
    chain: fullCycle,
    assignments: { plna: { kind: "composite", preset: "daily" } },
    presets: registry.presets,
    toggles: ON,
  });
  assert.equal(typo.code, "assignment-unknown-stage:plna");

  const unassigned = resolveChainCast({
    chain: fullCycle,
    assignments: { plan: { kind: "composite", preset: "daily" } },
    presets: registry.presets,
    toggles: ON,
  });
  assert.equal(unassigned.ok, false);
  assert.equal(unassigned.code, "invalid-assignment");

  const withDefault = resolveChainCast({
    chain: fullCycle,
    assignments: { plan: { kind: "composite", preset: "overlord" } },
    defaults: { kind: "composite", preset: "daily" },
    presets: registry.presets,
    toggles: ON,
  });
  assert.equal(withDefault.ok, true);
  assert.equal(withDefault.cast[1].executor_ref, "composite:daily");
});

test("run configs validate assignments semantically (keys, shapes, default)", () => {
  const shipped = JSON.parse(readFileSync(new URL("../dispatch/config/run-configs.json", import.meta.url), "utf8"));
  assert.deepEqual(validateRunConfigRegistry(shipped).errors, []);
  const config = shipped.configs[0];
  assert.equal(config.assignments.plan.preset, "overlord");

  const bad = JSON.parse(JSON.stringify(shipped));
  bad.configs[0].assignments["BAD KEY"] = { kind: "composite", preset: "daily" };
  bad.configs[0].assignments.plan = { kind: "composite" };
  bad.configs[0].default_assignment = { kind: "model", provider: "not-a-provider", model: "x" };
  const errors = validateRunConfigRegistry(bad).errors.map((e) => e.path);
  assert.ok(errors.some((p) => p.includes("BAD KEY")));
  assert.ok(errors.some((p) => p.endsWith("assignments.plan")));
  assert.ok(errors.some((p) => p.endsWith("default_assignment")));
});
