#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "helix-package-check-"));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command}-failed:${String(result.stderr).trim().split("\n").at(-1) ?? result.status}`);
  return result.stdout;
}

try {
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
    "dispatch/workflow/schema.mjs", "docs/providers.md", "extensions/lib/helix-execution.mjs",
  ]) readFileSync(join(packageRoot, required));
  const schema = await import(pathToFileURL(join(packageRoot, "dispatch/workflow/schema.mjs")));
  if (schema.WORKFLOW_SCHEMA_VERSION !== 4) throw new Error("package-runtime-schema-invalid");
  const core = await import(pathToFileURL(join(packageRoot, "extensions/lib/helix-command-core.mjs")));
  const help = core.executeHelixCommand("help", { mode: "print" });
  if (!help.ok || !help.text.includes("/helix-run-resume")) throw new Error("package-runtime-rpc-invalid");
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (pkg.peerDependencies?.["@earendil-works/pi-coding-agent"] !== ">=0.80.7 <0.81.0") {
    throw new Error("package-pi-range-invalid");
  }
  console.log(JSON.stringify({ ok: true, files: files.length, package: packed[0].filename }));
} catch (error) {
  console.error(`package-check: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(resolve(temp), { recursive: true, force: true });
}
