// Regression coverage for the loop CLI, including fresh runs, resume, and guards.
// These exercise it as a child process against the real repo config.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultSettings, saveSettings } from "../dispatch/lib/settings.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(root, "tools", "loop", "helix-task-loop.mjs");
const stateRoot = mkdtempSync(join(tmpdir(), "helix-cli-state-"));
const runsRoot = join(stateRoot, "runs");

after(() => rmSync(stateRoot, { recursive: true, force: true }));

function runCli(args) {
  const res = spawnSync("node", [CLI, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HELIX_STATE_DIR: stateRoot },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "helix-cli-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "helix@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Helix CLI"], { cwd });
  writeFileSync(join(cwd, "proposal.txt"), "initial\n", "utf8");
  writeFileSync(join(cwd, "PLAN.md"), "Real plan fixture for the staged contract.\n", "utf8");
  execFileSync("git", ["add", "proposal.txt", "PLAN.md"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
  return cwd;
}

test("a fresh CLI run over a synthetic repo converges and writes structural artifacts", () => {
  const runId = `cli-fresh-${process.pid}`;
  try {
    const out = runCli(["--run-id", runId, "--summary"]);
    assert.equal(out.status, 0, out.stderr);
    // Event lines carry no braces; the only JSON is the trailing result object.
    const parsed = JSON.parse(out.stdout.slice(out.stdout.indexOf("{")));
    assert.equal(parsed.converged, true);
    assert.deepEqual(parsed.cast.map((c) => c.executor_ref), ["composite:overlord", "composite:daily"]);
    assert.match(parsed.worktree_branch, /^helix\/run-[0-9a-f]{24}$/);
    assert.match(parsed.events_path, /\.events\.jsonl$/);
  } finally {
    rmSync(join(runsRoot, runId), { recursive: true, force: true });
  }
});

test("--resume without --repo fails closed (the per-run worktree lives under the original repo)", () => {
  const runId = `cli-resume-norepo-${process.pid}`;
  const runDir = join(runsRoot, runId);
  const repo = tempRepo();
  try {
    const fresh = runCli(["--run-id", runId, "--repo", repo, "--summary"]);
    assert.equal(fresh.status, 0, fresh.stderr);
    const out = runCli(["--resume", runId]);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /resume-requires-repo/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a fresh run refuses to clobber an interrupted, still-resumable run's state", () => {
  const runId = `cli-clobber-${process.pid}`;
  const runDir = join(runsRoot, runId);
  try {
    mkdirSync(runDir, { recursive: true });
    const statePath = join(runDir, `${runId}.state.json`);
    writeFileSync(statePath, JSON.stringify({
      schema_version: 1, run_id: runId, config_id: "mock-core-loop", chain_id: "full-cycle",
      completed: false, machine: { stage_index: 1, pass_counts: { plan: 1, implement: 0 }, total_passes: 1 },
    }), "utf8");
    const marker = join(runDir, "keepme.txt");
    writeFileSync(marker, "history", "utf8");

    const out = runCli(["--run-id", runId]); // FRESH run, same id
    assert.equal(out.status, 1);
    assert.match(out.stderr, /fresh-run-id-exists/);
    // The interrupted run's state and history are intact — not cleaned.
    assert.equal(existsSync(statePath), true, "resumable state must survive a refused fresh run");
    assert.equal(existsSync(marker), true, "run history must survive a refused fresh run");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("--resume with an explicit --config that disagrees fails closed", () => {
  const runId = `cli-resume-mismatch-${process.pid}`;
  const runDir = join(runsRoot, runId);
  const repo = tempRepo();
  try {
    const fresh = runCli(["--run-id", runId, "--repo", repo, "--summary"]);
    assert.equal(fresh.status, 0, fresh.stderr);
    const out = runCli(["--resume", runId, "--repo", repo, "--config", "some-other-config"]);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /resume-config-mismatch/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--resume rejects an unsafe id before filesystem access or rendering it", () => {
  const unsafe = "/Us" + "ers/private/.ssh/session-secret";
  const out = runCli(["--resume", unsafe]);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /unsafe-run-id/);
  assert.doesNotMatch(out.stderr, /Users|session-secret/);
});

test("visual-cues OFF renders every persisted event as a plain line unless --summary is explicit", () => {
  const runId = `cli-visual-off-${process.pid}`;
  const runDir = join(runsRoot, runId);
  const settingsPath = join(stateRoot, "settings.json");
  const repo = tempRepo();
  try {
    const settings = {
      ...defaultSettings(),
      toggles: { ...defaultSettings().toggles, "visual-cues": false },
    };
    assert.equal(saveSettings(settings, settingsPath).ok, true);
    const out = runCli(["--run-id", runId, "--repo", repo]);
    assert.equal(out.status, 0, out.stderr);
    const persisted = readFileSync(join(runDir, `${runId}.events.jsonl`), "utf8").trim().split("\n");
    const rendered = out.stdout.split("\n").filter((line) => /^\[\s*\d+ms\]/.test(line));
    assert.equal(rendered.length, persisted.length);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(settingsPath, { force: true });
  }
});
