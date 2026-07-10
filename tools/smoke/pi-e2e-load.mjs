#!/usr/bin/env node
// Prime no-auth/no-live Pi load helper.
//
// Separates four proof types that earlier handoffs were prone to collapse:
// package/resource loadability, Pi command/skill discoverability, no-live
// behavior, and live-provider proof. Default mode is static and CI-safe. Runtime
// RPC mode sends only `get_commands` to Pi with isolated HOME/agent dirs; it does
// not prompt a model, read the user's Pi credential files, or make a provider
// call.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(new URL("../..", import.meta.url).pathname);
export const DEFAULT_RUNTIME_RPC_TIMEOUT_MS = 60_000;
const EXPECTED = Object.freeze({
  skill: "./skills/prime-ui",
  themes: "./themes",
  extensions: [
    "./extensions/prime-fence.ts",
    "./extensions/prime-answer.ts",
    "./extensions/prime-command.ts",
  ],
  settingsSkill: "../skills/prime-ui",
  settingsThemes: "../themes",
  settingsExtensions: [
    "../extensions/prime-fence.ts",
    "../extensions/prime-answer.ts",
    "../extensions/prime-command.ts",
  ],
  command: "prime",
  skillCommand: "skill:prime-ui",
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameArray(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function gate(id, proofType, status, detail, extra = {}) {
  return { id, proof_type: proofType, status, detail, ...extra };
}

function staticLoadability(root) {
  const failures = [];
  const pkg = readJson(join(root, "package.json"));
  const settings = readJson(join(root, ".pi/settings.json"));
  if (!sameArray(pkg.pi?.skills, [EXPECTED.skill])) failures.push("package-skill-surface");
  if (!sameArray(pkg.pi?.themes, [EXPECTED.themes])) failures.push("package-theme-surface");
  if (!sameArray(pkg.pi?.extensions, EXPECTED.extensions)) failures.push("package-extension-surface");
  if (!sameArray(settings.skills, [EXPECTED.settingsSkill])) failures.push("settings-skill-surface");
  if (!sameArray(settings.themes, [EXPECTED.settingsThemes])) failures.push("settings-theme-surface");
  if (!sameArray(settings.extensions, EXPECTED.settingsExtensions)) failures.push("settings-extension-surface");

  for (const rel of ["skills/prime-ui/SKILL.md", "themes", "extensions/prime-fence.ts", "extensions/prime-answer.ts", "extensions/prime-command.ts"]) {
    if (!existsSync(join(root, rel))) failures.push(`missing:${rel}`);
  }

  return gate(
    "package-resource-loadability",
    "package/resource loadability",
    failures.length === 0 ? "pass" : "fail",
    failures.length === 0
      ? "static package manifest, project settings, and referenced resource files are present"
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
  const temp = mkdtempSync(join(tmpdir(), "prime-pi-load-"));
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
      ["--offline", "--approve", "--mode", "rpc", "--no-session"],
      {
        cwd: root,
        input: JSON.stringify({ id: "prime-load", type: "get_commands" }) + "\n",
        encoding: "utf8",
        env,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      },
    );
    if (proc.error) {
      return { ok: false, code: "rpc-spawn-failed", detail: proc.error.code ?? proc.error.message };
    }
    const lines = String(proc.stdout ?? "").trim().split("\n").filter(Boolean);
    const response = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).find((line) => line?.id === "prime-load" && line?.command === "get_commands");
    if (!response?.success) {
      return { ok: false, code: "rpc-get-commands-failed", detail: response?.error ?? `exit=${proc.status}` };
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
      "command/tool/skill discoverability",
      "not-run",
      "runtime Pi RPC inventory not requested; static loadability is not a discoverability proof",
      { commands: [] },
    );
  }
  const inventory = runRpcInventory(root, options);
  if (!inventory.ok) {
    return gate("pi-discoverability", "command/tool/skill discoverability", "fail", `${inventory.code}:${inventory.detail}`, { commands: [] });
  }
  const names = inventory.commands.map((command) => command.name);
  const commandFound = names.includes(EXPECTED.command);
  const skillFound = names.includes(EXPECTED.skillCommand);
  const status = commandFound ? "pass" : "fail";
  return gate(
    "pi-discoverability",
    "command/tool/skill discoverability",
    status,
    skillFound
      ? "runtime RPC inventory found Prime command and Prime skill command"
      : "runtime RPC inventory found Prime command; project skill command remains a known Pi 0.80.3 headless limitation",
    {
      command_found: commandFound,
      skill_command_found: skillFound,
      commands: inventory.commands,
    },
  );
}

function noLiveGate(options) {
  return gate(
    "no-live-behavior",
    "no-live behavior",
    "pass",
    options.runtimeRpc
      ? "runtime mode sends only RPC get_commands with offline env and isolated config dirs; no prompt/provider call"
      : "static mode reads repository metadata only; no network, credentials, prompt, or provider call",
  );
}

function liveProofGate() {
  return gate(
    "live-provider-proof",
    "live-provider proof",
    "skipped",
    "requires explicit maintainer approval per proof; not run by this helper",
  );
}

export function runPiE2ELoad({ root = DEFAULT_ROOT, runtimeRpc = false, piBin = "pi", timeoutMs = DEFAULT_RUNTIME_RPC_TIMEOUT_MS } = {}) {
  const gates = [
    staticLoadability(root),
    discoverability(root, { runtimeRpc, piBin, timeoutMs }),
    noLiveGate({ runtimeRpc }),
    liveProofGate(),
  ];
  return {
    ok: gates.every((entry) => entry.status !== "fail"),
    mode: runtimeRpc ? "runtime-rpc-no-live" : "static-no-live",
    gates,
  };
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, runtimeRpc: false, piBin: "pi", timeoutMs: DEFAULT_RUNTIME_RPC_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--runtime-rpc") options.runtimeRpc = true;
    else if (arg === "--root") options.root = resolve(argv[++i]);
    else if (arg === "--pi-bin") options.piBin = argv[++i];
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "-h" || arg === "--help") {
      console.log(`usage: node tools/smoke/pi-e2e-load.mjs [--runtime-rpc] [--root DIR] [--pi-bin pi] [--timeout-ms N]\n\nDefault runtime RPC timeout: ${DEFAULT_RUNTIME_RPC_TIMEOUT_MS} ms.`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
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
