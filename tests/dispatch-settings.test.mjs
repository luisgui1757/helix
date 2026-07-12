// M2 — feature-toggle settings substrate: defaults, persistence, refusal codes,
// record embedding, and the first degeneration hook (loops off ⇒ single pass).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  HELIX_TOGGLES,
  SETTINGS_CODES,
  SETTINGS_SCHEMA_VERSION,
  defaultSettings,
  loadSettings,
  saveSettings,
  requireToggle,
  toggleVector,
  validateSettings,
} from "../dispatch/lib/settings.mjs";
import { buildRunRecord } from "../dispatch/lib/run-record.mjs";
import { runDispatch } from "../dispatch/lib/orchestrate.mjs";
import { runTaskLoop } from "../dispatch/lib/task-loop.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";

const NOW = 1_751_731_200;

function tmpFile(name = "settings.json") {
  const dir = mkdtempSync(join(tmpdir(), "helix-settings-"));
  return { dir, path: join(dir, "local", name) };
}

test("default settings turn every toggle ON and validate", () => {
  const settings = defaultSettings();
  assert.equal(settings.schema_version, SETTINGS_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(settings.toggles), [...HELIX_TOGGLES]);
  assert.ok(HELIX_TOGGLES.every((t) => settings.toggles[t] === true));
  assert.equal(validateSettings(settings).valid, true);
});

test("an absent settings file loads the defaults (not an error)", () => {
  const { dir, path } = tmpFile();
  try {
    const result = loadSettings(path);
    assert.equal(result.ok, true);
    assert.equal(result.source, "defaults");
    assert.deepEqual(result.settings, defaultSettings());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save/load round-trips a modified vector", () => {
  const { dir, path } = tmpFile();
  try {
    const settings = {
      schema_version: SETTINGS_SCHEMA_VERSION,
      toggles: { ...defaultSettings().toggles, autoresearch: false, "visual-cues": false },
    };
    const saved = saveSettings(settings, path);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const loaded = loadSettings(path);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, "file");
    assert.equal(loaded.settings.toggles.autoresearch, false);
    assert.equal(loaded.settings.toggles["visual-cues"], false);
    assert.equal(loaded.settings.toggles.loops, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed JSON fails closed as unreadable (never silently defaults)", () => {
  const { dir, path } = tmpFile();
  try {
    saveSettings(defaultSettings(), path); // creates parent dir
    writeFileSync(path, "{not json", "utf8");
    const result = loadSettings(path);
    assert.equal(result.ok, false);
    assert.equal(result.code, SETTINGS_CODES.UNREADABLE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a future schema_version fails closed with a version code", () => {
  const { dir, path } = tmpFile();
  try {
    saveSettings(defaultSettings(), path);
    writeFileSync(path, JSON.stringify({ schema_version: 99, toggles: defaultSettings().toggles }), "utf8");
    const result = loadSettings(path);
    assert.equal(result.ok, false);
    assert.equal(result.code, SETTINGS_CODES.VERSION_MISMATCH);
    assert.match(result.detail, /99/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save refuses an unsupported schema version before persistence", () => {
  const { dir, path } = tmpFile();
  try {
    const future = { schema_version: SETTINGS_SCHEMA_VERSION + 1, toggles: { ...defaultSettings().toggles } };
    const saved = saveSettings(future, path);
    assert.equal(saved.ok, false);
    assert.equal(saved.code, SETTINGS_CODES.VERSION_MISMATCH);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save refuses a final-path symlink without overwriting its target", () => {
  const { dir, path } = tmpFile();
  try {
    mkdirSync(join(dir, "local"), { recursive: true });
    const victim = join(dir, "outside-victim.json");
    writeFileSync(victim, "outside stays unchanged\n", "utf8");
    symlinkSync(victim, path);
    const saved = saveSettings(defaultSettings(), path);
    assert.equal(saved.ok, false);
    assert.equal(saved.code, SETTINGS_CODES.WRITE_FAILED);
    assert.equal(readFileSync(victim, "utf8"), "outside stays unchanged\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown, missing, or non-boolean toggles fail closed as invalid", () => {
  const { dir, path } = tmpFile();
  try {
    const base = defaultSettings();
    const cases = [
      { ...base, toggles: { ...base.toggles, "mystery-toggle": true } },
      { ...base, toggles: (({ loops: _drop, ...rest }) => rest)(base.toggles) },
      { ...base, toggles: { ...base.toggles, loops: "yes" } },
    ];
    for (const settings of cases) {
      saveSettings(defaultSettings(), path);
      writeFileSync(path, JSON.stringify(settings), "utf8");
      const result = loadSettings(path);
      assert.equal(result.ok, false, JSON.stringify(settings));
      assert.equal(result.code, SETTINGS_CODES.INVALID);
      // And save refuses the same shapes before writing anything.
      const saved = saveSettings(settings, join(dir, "never.json"));
      assert.equal(saved.ok, false);
      assert.equal(existsSync(join(dir, "never.json")), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("requireToggle refuses only explicit conflicts, with the toggle named", () => {
  const on = defaultSettings();
  const off = { ...on, toggles: { ...on.toggles, autoresearch: false } };
  assert.deepEqual(requireToggle(on, "autoresearch"), { ok: true });
  assert.deepEqual(requireToggle(off, "autoresearch"), { ok: false, code: "toggle-disabled:autoresearch" });
  assert.deepEqual(requireToggle(on, "warp-drive"), { ok: false, code: "unknown-toggle:warp-drive" });
});

test("toggleVector is exactly the six booleans (missing reads as false)", () => {
  const vector = toggleVector({ toggles: { loops: true } });
  assert.deepEqual(Object.keys(vector), [...HELIX_TOGGLES]);
  assert.equal(vector.loops, true);
  assert.equal(vector["multi-model"], false);
  assert.ok(Object.isFrozen(vector));
});

test("run records embed a valid toggle vector and refuse a malformed one", () => {
  const base = {
    run_id: "settings-record",
    timestamp: NOW,
    task_class: "routine-code",
    route_id: "routine-code",
    role_ids: ["builder"],
    provider_ids: ["mock"],
    model_ids: ["mock-model"],
    usage_rollup: { input_tokens: 1, output_tokens: 1 },
    iteration_count: 1,
    exit_status: "ok",
    gate: { command_names: ["x"], kind: "objective", result: "pass", source: "exit-status" },
    warning_codes: [],
    judge: null,
    input_refs: [],
    claims_ref: "local-ref:claims/x",
    evidence_ref: "local-ref:evidence/x",
    run_target: { repo: "self" },
  };
  const withToggles = buildRunRecord({ ...base, toggles: toggleVector(defaultSettings()) });
  assert.deepEqual(Object.keys(withToggles.toggles), [...HELIX_TOGGLES]);
  const without = buildRunRecord(base);
  assert.ok(!("toggles" in without), "toggles stays optional for pre-toggle callers");
  assert.throws(
    () => buildRunRecord({ ...base, toggles: { loops: true } }),
    /run-record/,
    "a partial vector is refused by the record schema",
  );
});

test("runDispatch threads deps.toggles into the public-safe record", async () => {
  const result = await runDispatch({
    run_id: "settings-dispatch",
    task: { class_hint: "routine-code", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
    run_target: { repo: "self" },
    claims_ref: "local-ref:claims/settings-dispatch",
    evidence_ref: "local-ref:evidence/settings-dispatch",
  }, {
    adapter: {
      runCandidate: (spec, ctx) => makeEnvelope({ run_id: ctx.run_id, role: spec.role, provider: spec.provider, model: spec.model }),
    },
    runGate: () => ({ command_names: ["gate"], result: "pass", source: "deterministic-checker" }),
    now: NOW,
    seed: 7,
    toggles: toggleVector(defaultSettings()),
  });
  assert.equal(result.ok, true, JSON.stringify({ code: result.code, detail: result.detail }));
  assert.deepEqual(Object.keys(result.record.toggles), [...HELIX_TOGGLES]);
  assert.equal(result.record.toggles.loops, true);
});

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "helix-settings-loop-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix Settings"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial proposal\n", "utf8");
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

function readJson(rel) {
  return JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
}

test("loops OFF degenerates the task loop to a single pass (never an error)", async () => {
  const cwd = tempRepo();
  try {
    const registries = {
      chainRegistry: readJson("dispatch/config/chains.json"),
      roleMatrix: readJson("dispatch/config/role-matrix-defaults.json"),
      agentTeam: readJson("dispatch/config/agent-team-defaults.json"),
    };
    const config = readJson("dispatch/config/run-configs.json").configs[0];
    const toggles = { ...toggleVector(defaultSettings()), loops: false };

    const result = await runTaskLoop(config, registries, {
      cwd, now: NOW, seed: 7, run_id: "settings-single-pass", toggles,
    });
    // Debate convergence needs two diff observations, so a single pass cannot
    // converge under the current loop semantics — but it must run EXACTLY one
    // iteration (max_iterations forced to 1) and stay structural, not crash.
    assert.equal(result.debate.max_iterations, 1);
    assert.equal(result.debate.iterations_run, 1);
    assert.equal(result.debate.iterations[0].gate_result, "fail");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
