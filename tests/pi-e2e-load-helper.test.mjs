import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RUNTIME_RPC_TIMEOUT_MS,
  EXPECTED_HELIX_COMMANDS,
  resolvePiBinary,
  runPiE2ELoad,
} from "../tools/smoke/pi-e2e-load.mjs";

const extensionPaths = [
  "./extensions/helix-fence.ts",
  "./extensions/helix-answer.ts",
  "./extensions/helix-command.ts",
];
const required = [
  "README.md",
  "NOTICE",
  "SECURITY.md",
  "docs/architecture.md",
  "docs/manual.md",
  "docs/providers.md",
  "docs/workflows.md",
  "extensions/helix-fence.ts",
  "extensions/helix-answer.ts",
  "extensions/helix-command.ts",
  "extensions/lib/helix-command-core.mjs",
  "extensions/lib/helix-onboarding.mjs",
  "extensions/lib/helix-execution.mjs",
  "extensions/lib/helix-workflow-test.mjs",
  "extensions/lib/helix-workflows.mjs",
  "dispatch/config/run-configs.json",
  "dispatch/lib/pi-agent-adapter.mjs",
  "dispatch/lib/runner.mjs",
  "dispatch/lib/stage-schedule.mjs",
  "dispatch/lib/workflows.mjs",
  "dispatch/kernel/scheduler.mjs",
  "dispatch/kernel/state.mjs",
  "dispatch/runtime/contract.mjs",
  "dispatch/runtime/openrouter-audit-proxy.mjs",
  "dispatch/runtime/openrouter-runtime.mjs",
  "dispatch/workflow/schema.mjs",
  "tools/loop/helix-task-loop.mjs",
];

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "helix-load-helper-"));
  for (const rel of required) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), rel.endsWith(".json") ? "{}\n" : "\n", "utf8");
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ pi: { extensions: extensionPaths } }), "utf8");
  return root;
}

test("static Pi load helper separates load, discoverability, and live proof", () => {
  const root = fixtureRoot();
  try {
    const result = runPiE2ELoad({ root });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "static-no-live");
    assert.equal(result.gates.find((gate) => gate.id === "package-resource-loadability").status, "pass");
    const discovery = result.gates.find((gate) => gate.id === "pi-discoverability");
    assert.equal(discovery.status, "not-run");
    assert.deepEqual(discovery.missing_commands, EXPECTED_HELIX_COMMANDS);
    assert.equal(result.gates.find((gate) => gate.id === "live-provider-proof").status, "skipped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("static Pi load helper rejects skill drift and missing runtime files", () => {
  const root = fixtureRoot();
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ pi: { extensions: [], skills: ["./skill"] } }), "utf8");
    rmSync(join(root, "dispatch/lib/runner.mjs"));
    const result = runPiE2ELoad({ root });
    assert.equal(result.ok, false);
    const load = result.gates.find((gate) => gate.id === "package-resource-loadability");
    assert.equal(load.status, "fail");
    assert.match(load.detail, /package-extension-surface/);
    assert.match(load.detail, /unexpected-skill-surface/);
    assert.match(load.detail, /missing:dispatch\/lib\/runner\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime RPC helper allows a cold Pi startup", () => {
  assert.equal(DEFAULT_RUNTIME_RPC_TIMEOUT_MS, 60_000);
  assert.equal(resolvePiBinary("/workspace", "node_modules/.bin/pi"), "/workspace/node_modules/.bin/pi");
  assert.equal(resolvePiBinary("/workspace", "pi"), "pi");
  assert.throws(() => resolvePiBinary("/workspace", ""), /pi-bin-invalid/);
});
