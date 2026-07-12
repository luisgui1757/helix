import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "tools", "research", "helix-research.mjs");
const runsRoot = join(root, "dispatch", "runs");

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function parseJsonOutput(output) {
  const start = output.indexOf("{");
  assert.notEqual(start, -1, output);
  return JSON.parse(output.slice(start));
}

function validArgs(runId, measureCmd) {
  return [
    "--run-id", runId,
    "--question", "scientific notation",
    "--metric", "score", "<=", "10",
    "--max", "1",
    "--measure-cmd", measureCmd,
    "--attended",
  ];
}

test("research CLI parses a complete final scientific-notation token", () => {
  const runId = `research-scientific-${process.pid}`;
  const runDir = join(runsRoot, runId);
  assert.equal(existsSync(runDir), false, `unexpected pre-existing test run ${runId}`);
  try {
    const result = runCli(validArgs(runId, "printf '1e3\\n'"));
    const output = parseJsonOutput(result.stdout);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(output.stop_reason, "max-iterations");
    const record = JSON.parse(readFileSync(join(runDir, `${runId}.research.json`), "utf8"));
    assert.equal(record.iterations[0].measurement, 1000);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("research CLI rejects a malformed final numeric token instead of partially parsing it", () => {
  const runId = `research-ambiguous-${process.pid}`;
  const runDir = join(runsRoot, runId);
  assert.equal(existsSync(runDir), false, `unexpected pre-existing test run ${runId}`);
  try {
    const result = runCli(validArgs(runId, "printf '1e3oops\\n'"));
    const output = parseJsonOutput(result.stdout);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(output.code, "research-measurement-invalid");
    assert.equal(output.iterations, 0);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("research CLI validates before run-directory preparation and refuses existing ids", () => {
  const invalidId = `research-invalid-${process.pid}`;
  const invalidDir = join(runsRoot, invalidId);
  const existingId = `research-existing-${process.pid}`;
  const existingDir = join(runsRoot, existingId);
  mkdirSync(invalidDir, { recursive: true });
  mkdirSync(existingDir, { recursive: true });
  writeFileSync(join(invalidDir, "marker"), "keep-invalid\n", "utf8");
  writeFileSync(join(existingDir, "marker"), "keep-existing\n", "utf8");
  try {
    const invalid = runCli([
      "--run-id", invalidId,
      "--question", "missing metric",
      "--max", "1",
      "--measure-cmd", "printf '1\\n'",
      "--attended",
    ]);
    const invalidOutput = parseJsonOutput(invalid.stderr);
    assert.equal(invalid.status, 1);
    assert.equal(invalidOutput.code, "research-missing-metric");
    assert.equal(readFileSync(join(invalidDir, "marker"), "utf8"), "keep-invalid\n");

    const existing = runCli(validArgs(existingId, "printf '1\\n'"));
    const existingOutput = parseJsonOutput(existing.stderr);
    assert.equal(existing.status, 1);
    assert.equal(existingOutput.code, "run-directory-exists");
    assert.equal(readFileSync(join(existingDir, "marker"), "utf8"), "keep-existing\n");
  } finally {
    rmSync(invalidDir, { recursive: true, force: true });
    rmSync(existingDir, { recursive: true, force: true });
  }
});

test("research CLI rejects coercive numeric flag forms", () => {
  const runId = `research-coercive-${process.pid}`;
  const runDir = join(runsRoot, runId);
  assert.equal(existsSync(runDir), false, `unexpected pre-existing test run ${runId}`);
  try {
    const result = runCli([
      "--run-id", runId,
      "--question", "strict flags",
      "--metric", "score", ">=", "0x10",
      "--max", "1",
      "--measure-cmd", "printf '16\\n'",
      "--attended",
    ]);
    const output = parseJsonOutput(result.stderr);
    assert.equal(result.status, 1);
    assert.equal(output.code, "research-invalid-spec");
    assert.equal(existsSync(runDir), false, "invalid flags must not reserve or clean a run directory");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
