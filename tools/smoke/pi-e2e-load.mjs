#!/usr/bin/env node
// No-auth proof that Pi loads Helix as a package and discovers every native command.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(new URL("../..", import.meta.url).pathname);
export const DEFAULT_RUNTIME_RPC_TIMEOUT_MS = 60_000;
export const EXPECTED_HELIX_COMMANDS = Object.freeze([
  "helix",
  "helix-help",
  "helix-onboarding",
  "helix-run",
  "helix-runs",
  "helix-run-status",
  "helix-run-watch",
  "helix-run-resume",
  "helix-run-prune",
  "helix-models",
  "helix-chains",
  "helix-workflows",
  "helix-workflow-create",
  "helix-workflow-edit",
  "helix-workflow-clone",
  "helix-workflow-delete",
  "helix-settings",
  "helix-profiles",
  "helix-setup",
  "helix-research",
]);
const EXPECTED_EXTENSIONS = Object.freeze([
  "./extensions/helix-fence.ts",
  "./extensions/helix-answer.ts",
  "./extensions/helix-command.ts",
]);
const REQUIRED_PACKAGE_FILES = Object.freeze([
  "README.md",
  "docs/manual.md",
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
  "tools/loop/helix-task-loop.mjs",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function gate(id, proofType, status, detail, extra = {}) {
  return { id, proof_type: proofType, status, detail, ...extra };
}

function staticLoadability(root) {
  const failures = [];
  const pkg = readJson(join(root, "package.json"));
  if (!sameArray(pkg.pi?.extensions, EXPECTED_EXTENSIONS)) failures.push("package-extension-surface");
  if (pkg.pi?.skills !== undefined) failures.push("unexpected-skill-surface");
  if (pkg.pi?.themes !== undefined) failures.push("unexpected-theme-surface");
  for (const rel of REQUIRED_PACKAGE_FILES) {
    if (!existsSync(join(root, rel))) failures.push(`missing:${rel}`);
  }
  return gate(
    "package-resource-loadability",
    "package/resource loadability",
    failures.length === 0 ? "pass" : "fail",
    failures.length === 0
      ? "package manifest and native extension runtime files are present"
      : failures.join(","),
  );
}

function sanitizeCommand(command) {
  return {
    name: command?.name,
    source: command?.source,
    location: command?.location ?? command?.sourceInfo?.scope ?? null,
  };
}

function runRpcInventory(root, { piBin = "pi", timeoutMs = DEFAULT_RUNTIME_RPC_TIMEOUT_MS } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "helix-pi-load-"));
  try {
    const env = {
      ...process.env,
      HOME: join(temp, "home"),
      PI_CODING_AGENT_DIR: join(temp, "agent"),
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
      PI_SKIP_VERSION_CHECK: "1",
    };
    const proc = spawnSync(
      piBin,
      ["--offline", "--approve", "-e", root, "--mode", "rpc", "--no-session"],
      {
        cwd: temp,
        input: JSON.stringify({ id: "helix-load", type: "get_commands" }) + "\n",
        encoding: "utf8",
        env,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      },
    );
    if (proc.error) return { ok: false, code: "rpc-spawn-failed", detail: proc.error.code ?? proc.error.message };
    const response = String(proc.stdout ?? "").trim().split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).find((line) => line?.id === "helix-load" && line?.command === "get_commands");
    if (!response?.success) {
      const stderr = String(proc.stderr ?? "").trim().split("\n").at(-1) ?? "";
      return { ok: false, code: "rpc-get-commands-failed", detail: response?.error ?? stderr ?? `exit=${proc.status}` };
    }
    return { ok: true, commands: response.data?.commands?.map(sanitizeCommand) ?? [] };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function discoverability(root, options) {
  if (!options.runtimeRpc) {
    return gate(
      "pi-discoverability",
      "native command discoverability",
      "not-run",
      "runtime Pi RPC inventory was not requested",
      { commands: [], missing_commands: [...EXPECTED_HELIX_COMMANDS] },
    );
  }
  const inventory = runRpcInventory(root, options);
  if (!inventory.ok) {
    return gate("pi-discoverability", "native command discoverability", "fail", `${inventory.code}:${inventory.detail}`, {
      commands: [], missing_commands: [...EXPECTED_HELIX_COMMANDS],
    });
  }
  const names = new Set(inventory.commands.map((command) => command.name));
  const missing = EXPECTED_HELIX_COMMANDS.filter((name) => !names.has(name));
  return gate(
    "pi-discoverability",
    "native command discoverability",
    missing.length === 0 ? "pass" : "fail",
    missing.length === 0 ? "runtime Pi inventory found every Helix command" : `missing:${missing.join(",")}`,
    { commands: inventory.commands, missing_commands: missing },
  );
}

export function runPiE2ELoad({ root = DEFAULT_ROOT, runtimeRpc = false, piBin = "pi", timeoutMs = DEFAULT_RUNTIME_RPC_TIMEOUT_MS } = {}) {
  const gates = [
    staticLoadability(root),
    discoverability(root, { runtimeRpc, piBin, timeoutMs }),
    gate(
      "no-live-behavior",
      "no-live behavior",
      "pass",
      runtimeRpc
        ? "Pi received only offline get_commands RPC with isolated config directories"
        : "static mode read local package metadata only",
    ),
    gate("live-provider-proof", "live-provider proof", "skipped", "requires explicit out-of-band live-provider approval"),
  ];
  return { ok: gates.every((entry) => entry.status !== "fail"), mode: runtimeRpc ? "runtime-rpc-no-live" : "static-no-live", gates };
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, runtimeRpc: false, piBin: "pi", timeoutMs: DEFAULT_RUNTIME_RPC_TIMEOUT_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--runtime-rpc") options.runtimeRpc = true;
    else if (arg === "--root") options.root = resolve(argv[++index]);
    else if (arg === "--pi-bin") options.piBin = argv[++index];
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "-h" || arg === "--help") {
      console.log("usage: node tools/smoke/pi-e2e-load.mjs [--runtime-rpc] [--root DIR] [--pi-bin pi] [--timeout-ms N]");
      process.exit(0);
    } else throw new Error(`unknown arg: ${arg}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runPiE2ELoad(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`pi-e2e-load: ${error.message}`);
    process.exit(2);
  }
}
