#!/usr/bin/env node
// prime-runs.mjs — list/status/prune structural Prime run records.

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { listRuns, pruneRun, statusRun } from "../../dispatch/lib/run-manager.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const runsRoot = join(root, "dispatch", "runs");

function usage(exitCode = 0) {
  console.log(`Usage:
  node tools/runs/prime-runs.mjs list
  node tools/runs/prime-runs.mjs status <run-id>
  node tools/runs/prime-runs.mjs prune <run-id>

Reads only structural JSON under dispatch/runs/.`);
  process.exit(exitCode);
}

const [cmd, runId] = process.argv.slice(2);
if (cmd === "list") {
  console.log(JSON.stringify({ runs: listRuns(runsRoot) }, null, 2));
  process.exit(0);
}
if (cmd === "status") {
  if (!runId) usage(2);
  const result = statusRun(runsRoot, runId);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
if (cmd === "prune") {
  if (!runId) usage(2);
  const result = pruneRun(runsRoot, runId);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
if (cmd === "-h" || cmd === "--help" || !cmd) usage(0);
console.error(`prime-runs: unknown command ${cmd}`);
usage(2);
