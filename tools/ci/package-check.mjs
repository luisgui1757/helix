#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { resolvePiBinary, runPiE2ELoad } from "../smoke/pi-e2e-load.mjs";
import { runOpenRouterDefaultFactoryCheck } from "./openrouter-default-factory-check.mjs";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "helix-package-check-"));
const piIndex = process.argv.indexOf("--pi-bin");
const piBin = piIndex >= 0 ? process.argv[piIndex + 1] : null;

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command}-failed:${String(result.stderr).trim().split("\n").at(-1) ?? result.status}`);
  return result.stdout;
}

function piPackageRoot(binary) {
  let current = dirname(realpathSync(binary));
  for (let depth = 0; depth < 6; depth += 1) {
    const manifest = join(current, "package.json");
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.name === "@earendil-works/pi-coding-agent") return current;
    }
    current = dirname(current);
  }
  throw new Error("package-check-pi-root-unavailable");
}

try {
  if (piIndex >= 0 && (!piBin || process.argv.length !== piIndex + 2)) throw new Error("package-check-pi-bin-invalid");
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temp]));
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0].filename !== "string") {
    throw new Error("npm-pack-result-invalid");
  }
  const tarball = join(temp, packed[0].filename);
  run("tar", ["-xzf", tarball, "-C", temp], temp);
  const packageRoot = join(temp, "package");
  const files = String(run("tar", ["-tzf", tarball], temp)).trim().split("\n").filter(Boolean);
  const allowed = [
    "package/package.json", "package/README.md", "package/LICENSE", "package/NOTICE", "package/SECURITY.md",
    "package/extensions/", "package/dispatch/config/", "package/dispatch/kernel/", "package/dispatch/lib/",
    "package/dispatch/runtime/", "package/dispatch/workflow/", "package/docs/", "package/tools/loop/", "package/tools/research/",
  ];
  const unexpected = files.filter((file) => !allowed.some((prefix) => file === prefix || file.startsWith(prefix)));
  if (unexpected.length) throw new Error(`package-unexpected-files:${unexpected.join(",")}`);
  for (const required of [
    "NOTICE", "SECURITY.md", "dispatch/kernel/scheduler.mjs", "dispatch/runtime/openrouter-audit-proxy.mjs",
    "dispatch/runtime/openrouter-runtime.mjs",
    "dispatch/lib/objective-gate-sandbox.mjs",
    "dispatch/workflow/schema.mjs", "dispatch/workflow/graph.mjs", "dispatch/workflow/builder.mjs",
    "dispatch/workflow/visualize.mjs", "docs/providers.md", "extensions/lib/helix-execution.mjs",
  ]) readFileSync(join(packageRoot, required));
  const schema = await import(pathToFileURL(join(packageRoot, "dispatch/workflow/schema.mjs")));
  if (schema.WORKFLOW_SCHEMA_VERSION !== 4) throw new Error("package-runtime-schema-invalid");
  const graph = await import(pathToFileURL(join(packageRoot, "dispatch/workflow/graph.mjs")));
  if (graph.DEFAULT_WORKFLOW_EXECUTION_MODE !== "original-mode"
    || !graph.WORKFLOW_EXECUTION_MODES.includes("graph-mode")) throw new Error("package-runtime-graph-invalid");
  const core = await import(pathToFileURL(join(packageRoot, "extensions/lib/helix-command-core.mjs")));
  const help = core.executeHelixCommand("help", { mode: "print" });
  if (!help.ok || !help.text.includes("/helix-run-resume")) throw new Error("package-runtime-rpc-invalid");
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (pkg.peerDependencies?.["@earendil-works/pi-coding-agent"] !== ">=0.80.7 <0.81.0") {
    throw new Error("package-pi-range-invalid");
  }
  let piRpc = "not-requested";
  let piDefaultFactory = "not-requested";
  if (piBin) {
    const resolvedPi = resolvePiBinary(root, piBin);
    const proof = runPiE2ELoad({ root: packageRoot, runtimeRpc: true, piBin: resolvedPi });
    if (!proof.ok || proof.gates.find((gate) => gate.id === "pi-discoverability")?.status !== "pass") {
      throw new Error("package-extracted-pi-rpc-failed");
    }
    piRpc = "pass";
    const scope = join(packageRoot, "node_modules", "@earendil-works");
    mkdirSync(scope, { recursive: true });
    symlinkSync(piPackageRoot(resolvedPi), join(scope, "pi-coding-agent"), "dir");
    const defaultFactory = await runOpenRouterDefaultFactoryCheck({ packageRoot });
    if (!defaultFactory.ok || defaultFactory.provider_turns !== 1 || defaultFactory.retry_failure_attempts !== 1) {
      throw new Error("package-extracted-default-factory-failed");
    }
    piDefaultFactory = "pass";
  }
  console.log(JSON.stringify({
    ok: true,
    files: files.length,
    package: packed[0].filename,
    pi_rpc: piRpc,
    pi_default_factory: piDefaultFactory,
  }));
} catch (error) {
  console.error(`package-check: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(resolve(temp), { recursive: true, force: true });
}
