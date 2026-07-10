import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listRuns,
  prepareRunDirectory,
  pruneRun,
  statusRun,
} from "../dispatch/lib/run-manager.mjs";
import { resolveRunConfig } from "../dispatch/lib/run-configs.mjs";
import { runTaskLoop } from "../dispatch/lib/task-loop.mjs";

const root = new URL("..", import.meta.url);
const NOW = 1_751_731_200;

function readJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, root), "utf8"));
}

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "prime-run-manager-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "prime@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Prime Test"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial proposal\n", "utf8");
  execFileSync("git", ["add", "proposal.txt"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

function debateSummary(runId = "flat-smoke") {
  return {
    schema_version: 2,
    run_id: runId,
    timestamp: NOW,
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
      task_class: "risky-change",
      route_id: "risky-change",
      exit_status: "ok",
      gate_kind: "objective",
      gate_result: "pass",
      gate_source: "deterministic-checker",
      gate_pass: true,
      diff_result: "stable",
      diff_code: "diff-stable",
      converged: true,
      tokens_used: 0,
      cumulative_tokens: 0,
      warning_codes: [],
    }],
    warning_codes: [],
  };
}

function reserveInChild(rootDir, runId) {
  const moduleUrl = new URL("../dispatch/lib/run-manager.mjs", import.meta.url).href;
  const source = [
    `import { prepareRunDirectory } from ${JSON.stringify(moduleUrl)};`,
    `console.log(JSON.stringify(prepareRunDirectory(${JSON.stringify(rootDir)}, ${JSON.stringify(runId)})));`,
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `reservation child exited ${code}`));
      else resolve(JSON.parse(stdout));
    });
  });
}

test("prepareRunDirectory reserves ids and never cleans existing evidence", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "prime-runs-root-"));
  const first = prepareRunDirectory(rootDir, "loop-safe", { clean: false });
  assert.equal(first.ok, true);
  writeFileSync(join(first.path, "old.json"), "{}", "utf8");
  const existing = prepareRunDirectory(rootDir, "loop-safe", { clean: false });
  assert.equal(existing.code, "run-directory-exists");
  assert.equal(existing.detail, "run-id-already-exists");
  const cleanAttempt = prepareRunDirectory(rootDir, "loop-safe", { clean: true });
  assert.equal(cleanAttempt.code, "run-directory-clean-forbidden");
  assert.equal(cleanAttempt.detail, "use-confirmed-prune");
  assert.equal(existsSync(join(first.path, "old.json")), true);
  const escape = prepareRunDirectory(rootDir, "../escape", { clean: true });
  assert.equal(escape.code, "unsafe-run-id");
  assert.equal(escape.detail, "run-id-pattern");
});

test("prepareRunDirectory atomically grants one concurrent reservation", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "prime-runs-atomic-"));
  const results = await Promise.all([
    reserveInChild(rootDir, "atomic-run"),
    reserveInChild(rootDir, "atomic-run"),
  ]);
  assert.equal(results.filter((result) => result.ok === true).length, 1, JSON.stringify(results));
  assert.equal(results.filter((result) => result.code === "run-directory-exists").length, 1, JSON.stringify(results));
});

test("run manager refuses run ids that resolve to the runs root", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "prime-runs-root-"));
  const sentinel = join(rootDir, "sentinel.json");
  writeFileSync(sentinel, "{}", "utf8");

  const dot = prepareRunDirectory(rootDir, ".", { clean: true });
  assert.equal(dot.code, "unsafe-run-id");
  assert.equal(dot.detail, "run-id-dot-segment");
  assert.equal(existsSync(sentinel), true);
  const pruneDot = pruneRun(rootDir, ".");
  assert.equal(pruneDot.code, "unsafe-run-id");
  assert.equal(pruneDot.detail, "run-id-dot-segment");
  assert.equal(existsSync(sentinel), true);
  const statusDot = statusRun(rootDir, ".");
  assert.equal(statusDot.code, "unsafe-run-id");
  assert.equal(statusDot.detail, "run-id-dot-segment");

  const dotted = prepareRunDirectory(rootDir, "run.1");
  assert.equal(dotted.ok, true);
  assert.equal(pruneRun(rootDir, "run.1").ok, true);
});

test("run manager lists, statuses, and prunes structural task-loop records", async () => {
  const recordsRoot = mkdtempSync(join(tmpdir(), "prime-runs-list-"));
  const runDir = prepareRunDirectory(recordsRoot, "loop-manager");
  assert.equal(runDir.ok, true);
  const config = resolveRunConfig(readJson("dispatch/config/run-configs.json"), "mock-core-loop").config;
  const result = await runTaskLoop(config, {
    chainRegistry: readJson("dispatch/config/chains.json"),
    roleMatrix: readJson("dispatch/config/role-matrix-defaults.json"),
    agentTeam: readJson("dispatch/config/agent-team-defaults.json"),
  }, {
    cwd: tempRepo(),
    now: NOW,
    seed: 7,
    record_dir: runDir.path,
    run_id: "loop-manager",
  });
  assert.equal(result.status, "ok", JSON.stringify(result));

  const listed = listRuns(recordsRoot);
  assert.ok(listed.some((entry) => entry.kind === "debate" && entry.run_id === "loop-manager" && entry.prunable === true));
  assert.ok(listed.some((entry) => entry.kind === "dispatch" && entry.run_id === "loop-manager-iter1" && entry.prunable === true));

  // Dispatch total_tokens is derived from the tokens-only usage_rollup
  // (input + output) — capacity telemetry, not cost accounting.
  const iter1 = listed.find((entry) => entry.kind === "dispatch" && entry.run_id === "loop-manager-iter1");
  const iter1Record = JSON.parse(readFileSync(join(runDir.path, "loop-manager-iter1.json"), "utf8"));
  assert.equal(iter1Record.schema_version, 2);
  assert.equal(
    iter1.total_tokens,
    iter1Record.usage_rollup.input_tokens + iter1Record.usage_rollup.output_tokens,
  );
  assert.ok(iter1.total_tokens > 0);

  const status = statusRun(recordsRoot, "loop-manager");
  assert.equal(status.ok, true);
  assert.ok(status.entries.length >= 4);

  assert.equal(pruneRun(recordsRoot, "loop-manager").ok, true);
  const missing = statusRun(recordsRoot, "loop-manager");
  assert.equal(missing.code, "run-not-found");
  assert.equal(missing.detail, "run-id-not-found");
});

test("flat smoke records are listed and statused as non-prunable", () => {
  const recordsRoot = mkdtempSync(join(tmpdir(), "prime-runs-flat-"));
  writeFileSync(join(recordsRoot, "flat-smoke.debate.json"), JSON.stringify(debateSummary()), "utf8");

  const listed = listRuns(recordsRoot);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].run_id, "flat-smoke");
  assert.equal(listed[0].prunable, false);

  const status = statusRun(recordsRoot, "flat-smoke");
  assert.equal(status.ok, true);
  assert.equal(status.entries[0].prunable, false);
  const flatPrune = pruneRun(recordsRoot, "flat-smoke");
  assert.equal(flatPrune.code, "run-not-found");
  assert.equal(flatPrune.detail, "run-id-not-found");
  assert.equal(existsSync(join(recordsRoot, "flat-smoke.debate.json")), true);
});

test("run manager rejects malformed debate summaries and filename/run-id mismatches", () => {
  const recordsRoot = mkdtempSync(join(tmpdir(), "prime-runs-invalid-debate-"));
  writeFileSync(join(recordsRoot, "malformed.debate.json"), JSON.stringify({
    ...debateSummary("malformed"),
    warning_codes: ["ordinary model prose"],
  }), "utf8");
  writeFileSync(
    join(recordsRoot, "wrong-name.debate.json"),
    JSON.stringify(debateSummary("different-id")),
    "utf8",
  );

  const listed = listRuns(recordsRoot);
  assert.equal(listed.length, 2);
  assert.ok(listed.every((entry) => entry.kind === "invalid"));
  assert.ok(listed.every((entry) => entry.stop_reason === "record-invalid-or-unsafe"));
});

test("run manager does not misreport valid staged and research companions as corrupt records", () => {
  const recordsRoot = mkdtempSync(join(tmpdir(), "prime-runs-companions-"));
  const runDir = prepareRunDirectory(recordsRoot, "staged-run");
  assert.equal(runDir.ok, true);
  writeFileSync(join(runDir.path, "staged-run.state.json"), JSON.stringify({ schema_version: 2 }), "utf8");
  writeFileSync(join(runDir.path, "staged-run.disagreements.json"), JSON.stringify({ schema_version: 1 }), "utf8");
  writeFileSync(join(runDir.path, `staged-run.disagreements.${"a".repeat(64)}.json`), JSON.stringify({ schema_version: 1 }), "utf8");
  writeFileSync(join(runDir.path, "staged-run.research.json"), JSON.stringify({ schema_version: 1 }), "utf8");
  writeFileSync(join(runDir.path, "unexpected.json"), "{}", "utf8");

  const listed = listRuns(recordsRoot);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].kind, "invalid");
  assert.equal(listed[0].run_id, "unexpected");
});

test("status matches only exact numeric iteration and staged-pass suffixes", () => {
  const recordsRoot = mkdtempSync(join(tmpdir(), "prime-runs-status-suffix-"));
  for (const id of ["alpha", "alpha-iter1", "alpha-p2", "alpha-iteration", "alpha-pwn"]) {
    writeFileSync(join(recordsRoot, `${id}.debate.json`), JSON.stringify(debateSummary(id)), "utf8");
  }

  const status = statusRun(recordsRoot, "alpha");
  assert.equal(status.ok, true);
  assert.deepEqual(status.entries.map((entry) => entry.run_id).sort(), ["alpha", "alpha-iter1", "alpha-p2"]);
});

test("run manager redacts unsafe filenames and refuses symlinked record files", () => {
  const recordsRoot = mkdtempSync(join(tmpdir(), "prime-runs-paths-"));
  const outside = mkdtempSync(join(tmpdir(), "prime-runs-outside-"));
  writeFileSync(
    join(recordsRoot, "ordinary prose.debate.json"),
    JSON.stringify(debateSummary("safe-inside")),
    "utf8",
  );
  writeFileSync(join(outside, "linked.json"), JSON.stringify(debateSummary("linked")), "utf8");
  symlinkSync(join(outside, "linked.json"), join(recordsRoot, "linked.debate.json"));
  mkdirSync(join(recordsRoot, "private path"));
  writeFileSync(
    join(recordsRoot, "private path", "nested.debate.json"),
    JSON.stringify(debateSummary("nested")),
    "utf8",
  );

  const listed = listRuns(recordsRoot);
  const unsafeName = listed.find((entry) => entry.run_id !== "linked" && entry.run_id !== "nested");
  assert.equal(unsafeName.kind, "invalid");
  assert.match(unsafeName.path, /^redacted-id:/);
  assert.equal(JSON.stringify(unsafeName).includes("ordinary prose"), false);

  const linked = listed.find((entry) => entry.run_id === "linked");
  assert.equal(linked, undefined, "record discovery must not follow symlinked files");

  const nested = listed.find((entry) => entry.run_id === "nested");
  assert.match(nested.path, /^redacted-id:/);
  assert.equal(JSON.stringify(nested).includes("private path"), false);
});
