#!/usr/bin/env node
// helix-research.mjs — attended autoresearch CLI (M7/M8).
//
// Runs the mandatory research shape: hypothesis → experiment → measure →
// compare → iterate, stopping on target-met | max-iterations |
// diminishing-returns | dead-end. The measurement comes from YOUR command
// (--measure-cmd): each iteration runs it and reads the LAST numeric token on
// stdout as the measurement — the objective source, never a model opinion.
//
//   node tools/research/helix-research.mjs \
//     --question "does the cache help" \
//     --metric latency-ms "<=" 100 --max 5 [--plateau 2] \
//     --measure-cmd "node bench.mjs"
//
// Attended only (a TTY, or --attended for test harnesses). Records are
// structural (hashes + measurements) under dispatch/runs/<run-id>/.

import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseStrictNumberToken,
  preflightResearch,
  runResearch,
} from "../../dispatch/lib/research.mjs";
import { loadSettings, toggleVector, DEFAULT_SETTINGS_REL_PATH } from "../../dispatch/lib/settings.mjs";
import { validateRunId, prepareRunDirectory } from "../../dispatch/lib/run-manager.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

const args = process.argv.slice(2);
const flags = { plateau: null, runId: null, attended: null };
const numericFlag = (token) => {
  const parsed = parseStrictNumberToken(token);
  return parsed.ok ? parsed.value : NaN;
};
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--question") flags.question = args[++i];
  else if (arg === "--hypothesis") flags.hypothesis = args[++i];
  else if (arg === "--metric") { flags.metric = { name: args[++i], comparator: args[++i], target: numericFlag(args[++i]) }; }
  else if (arg === "--max") flags.max = numericFlag(args[++i]);
  else if (arg === "--plateau") flags.plateau = numericFlag(args[++i]);
  else if (arg === "--measure-cmd") flags.measureCmd = args[++i];
  else if (arg === "--run-id") flags.runId = args[++i];
  else if (arg === "--attended") flags.attended = true;
  else {
    console.error(`helix-research: unknown arg ${arg}`);
    process.exit(2);
  }
}

const runId = flags.runId ?? "research-run";
const runIdValid = validateRunId(runId);
if (!runIdValid.ok) {
  console.error(JSON.stringify({ status: "fail-closed", code: runIdValid.code, detail: runIdValid.detail }));
  process.exit(1);
}

const settingsResult = loadSettings(join(root, DEFAULT_SETTINGS_REL_PATH));
if (!settingsResult.ok) {
  console.error(JSON.stringify({ status: "fail-closed", code: settingsResult.code, detail: settingsResult.detail }));
  process.exit(1);
}

if (typeof flags.measureCmd !== "string" || flags.measureCmd.length === 0) {
  console.error(JSON.stringify({ status: "fail-closed", code: "research-missing-measure-cmd", detail: null }));
  process.exit(1);
}

const spec = {
  run_id: runId,
  question: flags.question ?? "",
  hypothesis: flags.hypothesis ?? flags.question ?? "",
  experiment: flags.measureCmd,
  ...(flags.metric ? { metric: flags.metric } : {}),
  ...(flags.max !== undefined
    ? { stop: { max_iterations: flags.max, ...(flags.plateau != null ? { diminishing_returns_after: flags.plateau } : {}) } }
    : {}),
};

function lastNumber(text) {
  const match = String(text).match(/(?:^|\s)(\S+)\s*$/);
  if (!match) return NaN;
  const parsed = parseStrictNumberToken(match[1]);
  return parsed.ok ? parsed.value : NaN;
}

const attended = flags.attended ?? Boolean(process.stdout.isTTY);
const toggles = toggleVector(settingsResult.settings);
const runExperiment = async (iteration) => {
  const stdout = execSync(flags.measureCmd, { encoding: "utf8", env: { ...process.env, HELIX_RESEARCH_ITERATION: String(iteration) } });
  return { measurement: lastNumber(stdout) };
};

const preflight = preflightResearch(spec, { attended, toggles, runExperiment });
if (!preflight.ok) {
  console.error(JSON.stringify({ status: "fail-closed", code: preflight.code, detail: preflight.detail }));
  process.exit(1);
}

const runDir = prepareRunDirectory(join(root, "dispatch", "runs"), runId);
if (!runDir.ok) {
  console.error(JSON.stringify({ status: "fail-closed", code: runDir.code, detail: runDir.detail }));
  process.exit(1);
}

const result = await runResearch(spec, {
  attended,
  toggles,
  record_dir: runDir.path,
  onEvent: (event) => console.log(`[iter ${event.iteration}] ${event.measurement} (${event.verdict})`),
  runExperiment,
});

console.log(JSON.stringify({
  status: result.ok ? "ok" : "stopped",
  code: result.code ?? null,
  stop_reason: result.stop_reason ?? null,
  iterations: result.iterations.length,
  record_path: result.record_path ? result.record_path.replace(root, "") : null,
  warnings: result.warnings,
}, null, 2));
process.exit(result.ok ? 0 : 1);
