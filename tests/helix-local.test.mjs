// M10 regression: profile substrate fail-closed paths (helix-local.mjs) had
// zero coverage, and the "profiles override casts, never chain/gate" boundary
// was only asserted vacuously. These exercise both directly.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROFILE_CODES,
  validateProfile,
  listProfiles,
  loadProfile,
  saveProfile,
  activeProfileId,
  switchProfile,
  resolveActiveProfile,
  applyProfileToConfig,
  applyProfileToPresets,
  profilesDir,
} from "../extensions/lib/helix-local.mjs";
import { loadPresetRegistry } from "../dispatch/lib/presets.mjs";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "helix-local-"));
}

test("a valid profile round-trips; the active pointer switches", () => {
  const root = tempRoot();
  try {
    const profile = {
      schema_version: 1, profile_id: "deep-work",
      overrides: { assignments: { plan: { kind: "composite", preset: "overlord" } } },
    };
    assert.equal(validateProfile(profile).valid, true);
    assert.equal(saveProfile(root, profile).ok, true);
    assert.equal(loadProfile(root, "deep-work").ok, true);
    assert.equal(activeProfileId(root).profile_id, null);
    assert.equal(switchProfile(root, "deep-work").ok, true);
    assert.equal(activeProfileId(root).profile_id, "deep-work");
    assert.deepEqual(listProfiles(root).profiles.map((p) => p.profile_id), ["deep-work"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("profiles CANNOT carry chain/gate/run_target overrides (the boundary is schema-enforced)", () => {
  // The overrides object has no such keys; additionalProperties:false rejects them.
  for (const smuggle of [
    { chain: "ship-pre-pr" },
    { objective_gate: { type: "file-contains", path: "x", contains: "y" } },
    { run_target: { repo: "other" } },
    { max_iterations: 999 },
  ]) {
    const profile = { schema_version: 1, profile_id: "sneaky", overrides: smuggle };
    assert.equal(validateProfile(profile).valid, false, JSON.stringify(smuggle));
  }
});

test("save/load fail closed on invalid assignments, unknown ids, and version drift", () => {
  const root = tempRoot();
  try {
    const badAssign = {
      schema_version: 1, profile_id: "bad",
      overrides: { assignments: { plan: { kind: "composite" } } }, // missing preset
    };
    assert.equal(validateProfile(badAssign).valid, false);
    assert.equal(saveProfile(root, badAssign).code, PROFILE_CODES.INVALID);

    const toxicModel = "claude.ai/" + "share/abcdefgh";
    const unsafeProfile = {
      schema_version: 1, profile_id: "unsafe",
      overrides: { assignments: { plan: { kind: "model", provider: "mock", model: toxicModel } } },
    };
    assert.equal(validateProfile(unsafeProfile).valid, false);
    assert.equal(saveProfile(root, unsafeProfile).code, PROFILE_CODES.INVALID);
    assert.equal(existsSync(join(profilesDir(root), "unsafe.json")), false, "unsafe profile is refused before persistence");

    const otherWebModel = "https:" + "//example.com/shared/session";
    const otherUnsafeProfile = {
      schema_version: 1, profile_id: "unsafe-web",
      overrides: { assignments: { plan: { kind: "model", provider: "mock", model: otherWebModel } } },
    };
    assert.equal(validateProfile(otherUnsafeProfile).valid, false);
    assert.equal(saveProfile(root, otherUnsafeProfile).code, PROFILE_CODES.INVALID);
    assert.equal(existsSync(join(profilesDir(root), "unsafe-web.json")), false);

    assert.equal(loadProfile(root, "nope").code, PROFILE_CODES.UNKNOWN);
    assert.equal(loadProfile(root, "BAD ID").code, PROFILE_CODES.UNKNOWN);
    assert.equal(switchProfile(root, "nope").code, PROFILE_CODES.UNKNOWN);

    // A version-drifted profile on disk fails closed on list/load.
    mkdirSync(profilesDir(root), { recursive: true });
    writeFileSync(join(profilesDir(root), "future.json"),
      JSON.stringify({ schema_version: 99, profile_id: "future", overrides: {} }), "utf8");
    assert.equal(listProfiles(root).code, PROFILE_CODES.VERSION_MISMATCH);

    // A corrupt JSON file fails closed as unreadable.
    writeFileSync(join(profilesDir(root), "future.json"), "{not json", "utf8");
    assert.equal(listProfiles(root).code, PROFILE_CODES.UNREADABLE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("profile persistence never follows a planted pending-file symlink", () => {
  const root = tempRoot();
  try {
    const dir = profilesDir(root);
    mkdirSync(dir, { recursive: true });
    const victim = join(root, "outside-victim.json");
    writeFileSync(victim, "outside stays unchanged\n", "utf8");
    symlinkSync(victim, join(dir, "safe.json.pending"));
    const saved = saveProfile(root, { schema_version: 1, profile_id: "safe", overrides: {} });
    assert.equal(saved.ok, false, JSON.stringify(saved));
    assert.equal(saved.code, PROFILE_CODES.WRITE_FAILED);
    assert.equal(readFileSync(victim, "utf8"), "outside stays unchanged\n");
    assert.equal(existsSync(join(dir, "safe.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyProfileToConfig merges only casts and leaves the run's semantics intact", () => {
  const config = {
    id: "c", chain: "full-cycle",
    objective_gate: { type: "file-contains", path: "p", contains: "Z" },
    run_target: { repo: "self" }, max_iterations: 5,
    assignments: { plan: { kind: "composite", preset: "overlord" }, implement: { kind: "composite", preset: "daily" } },
  };
  const profile = {
    schema_version: 1, profile_id: "p",
    overrides: { assignments: { plan: { kind: "model", provider: "mock", model: "solo" } }, default_assignment: { kind: "composite", preset: "daily" } },
  };
  const { config: next, overridden } = applyProfileToConfig(config, profile);
  assert.deepEqual(overridden.sort(), ["assignments", "default_assignment"]);
  assert.deepEqual(next.assignments.plan, { kind: "model", provider: "mock", model: "solo" }); // overridden
  assert.deepEqual(next.assignments.implement, { kind: "composite", preset: "daily" }); // untouched tracked
  // Semantics are byte-identical to the tracked config.
  assert.deepEqual(next.chain, config.chain);
  assert.deepEqual(next.objective_gate, config.objective_gate);
  assert.deepEqual(next.run_target, config.run_target);
  assert.equal(next.max_iterations, config.max_iterations);
});

test("profile writes refuse collisions and active pointers fail closed on malformed/dangling state", () => {
  const root = tempRoot();
  try {
    const profile = { schema_version: 1, profile_id: "stable", overrides: {} };
    assert.equal(saveProfile(root, profile).ok, true);
    assert.equal(saveProfile(root, { ...profile, overrides: { default_run_config: "other" } }).code, PROFILE_CODES.EXISTS);
    assert.deepEqual(loadProfile(root, "stable").profile.overrides, {}, "collision did not overwrite the profile");

    mkdirSync(profilesDir(root), { recursive: true });
    writeFileSync(join(profilesDir(root), "active.json"), JSON.stringify({ profile_id: null }), "utf8");
    assert.equal(activeProfileId(root).code, PROFILE_CODES.ACTIVE_INVALID);
    assert.equal(resolveActiveProfile(root).code, PROFILE_CODES.ACTIVE_INVALID);

    writeFileSync(join(profilesDir(root), "active.json"), JSON.stringify({ schema_version: 1, profile_id: "missing" }), "utf8");
    assert.equal(resolveActiveProfile(root).code, PROFILE_CODES.UNKNOWN);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("complete profile preset overlays replace tracked members without changing preset semantics", () => {
  const presets = loadPresetRegistry(new URL("../dispatch/config/matrices/", import.meta.url).pathname).presets;
  const daily = presets.get("daily");
  const roles = Object.fromEntries(Object.entries(daily.roles).map(([role, members]) => [
    role,
    members.map((member) => ({ ...member })),
  ]));
  roles.builder = [{
    provider: "openai-codex", model: "gpt-5x", effort: "high", instances: 1, effort_vocab: ["high"],
  }];
  const profile = { schema_version: 1, profile_id: "real", overrides: { presets: { daily: { roles } } } };
  assert.equal(validateProfile(profile).valid, true);
  const applied = applyProfileToPresets(presets, profile);
  assert.equal(applied.ok, true);
  assert.equal(applied.presets.get("daily").roles.builder[0].provider, "openai-codex");
  assert.equal(applied.presets.get("daily").degradation, daily.degradation);

  const incomplete = { schema_version: 1, profile_id: "partial", overrides: { presets: { daily: { roles: { builder: roles.builder } } } } };
  assert.equal(validateProfile(incomplete).valid, true, "partial local editing shape can be saved");
  assert.equal(applyProfileToPresets(presets, incomplete).code, PROFILE_CODES.INVALID, "execution refuses incomplete lineup");
});

test("profile filenames must match their declared ids", () => {
  const root = tempRoot();
  try {
    mkdirSync(profilesDir(root), { recursive: true });
    writeFileSync(join(profilesDir(root), "alias.json"), JSON.stringify({
      schema_version: 1, profile_id: "different", overrides: {},
    }), "utf8");
    assert.equal(listProfiles(root).code, PROFILE_CODES.INVALID);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
