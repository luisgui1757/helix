#!/usr/bin/env node
// helix-runs.mjs — list/status/prune structural Helix run records.

import { join } from "node:path";
import { listRuns, pruneRun, statusRun } from "../../dispatch/lib/run-manager.mjs";
import { helixStateRoot } from "../../extensions/lib/helix-paths.mjs";

const runsRoot = join(helixStateRoot(), "runs");

function usage(exitCode = 0) {
  console.log(`Usage:
  node tools/runs/helix-runs.mjs list
  node tools/runs/helix-runs.mjs status <run-id>
  node tools/runs/helix-runs.mjs prune <run-id>

Reads only structural JSON from Helix's Pi user-state directory.`);
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
console.error(`helix-runs: unknown command ${cmd}`);
usage(2);
