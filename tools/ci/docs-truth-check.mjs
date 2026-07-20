#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE_COPY_LIMITS } from "../../dispatch/kernel/limits.mjs";
import { WORKFLOW_LIMITS } from "../../dispatch/workflow/schema.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const MAX_README_LINES = 120;
export const HELIX_COMMANDS = Object.freeze([
  "/helix",
  "/helix-help",
  "/helix-onboarding",
  "/helix-run",
  "/helix-runs",
  "/helix-run-status",
  "/helix-run-watch",
  "/helix-run-resume",
  "/helix-run-prune",
  "/helix-models",
  "/helix-chains",
  "/helix-workflows",
  "/helix-workflow-create",
  "/helix-workflow-edit",
  "/helix-workflow-clone",
  "/helix-workflow-delete",
  "/helix-settings",
  "/helix-profiles",
  "/helix-setup",
  "/helix-research",
]);
const count = (value) => value.toLocaleString("en-US");
export const DOCS_WORKFLOW_LIMIT_ROWS = Object.freeze([
  `| Workflow identifiers / names / descriptions | — | ${count(WORKFLOW_LIMITS.max_id_length)} / ${count(WORKFLOW_LIMITS.max_name_length)} / ${count(WORKFLOW_LIMITS.max_description_length)} characters |`,
  `| Workflow version | 1 | ${count(WORKFLOW_LIMITS.max_version)} |`,
  `| Workflow nodes | — | ${count(WORKFLOW_LIMITS.max_nodes)} |`,
  `| Serialized workflow definition | — | ${WORKFLOW_LIMITS.max_workflow_bytes / 1024} KiB |`,
  `| Workflow JSON read envelope | — | ${WORKFLOW_LIMITS.max_workflow_read_bytes / 1024} KiB |`,
  `| Canonical public-helper serialization | — | ${WORKFLOW_LIMITS.max_canonical_bytes / 1024 / 1024} MiB, depth ${count(WORKFLOW_LIMITS.max_canonical_depth)} |`,
  `| Input schema depth / object fields | — | ${count(WORKFLOW_LIMITS.max_input_depth)} / ${count(WORKFLOW_LIMITS.max_input_fields)} |`,
  `| Serialized runtime input | — | ${WORKFLOW_LIMITS.max_input_bytes / 1024 / 1024} MiB |`,
  `| Input descriptions / string values | — | ${count(WORKFLOW_LIMITS.max_input_description_length)} / ${count(WORKFLOW_LIMITS.max_input_string_length)} characters |`,
  `| JSON pointer / one pointer segment | — | ${count(WORKFLOW_LIMITS.max_pointer_length)} / ${count(WORKFLOW_LIMITS.max_pointer_segment_length)} characters |`,
  `| Agent prompt / tools | tracked prompt / role tools | ${count(WORKFLOW_LIMITS.max_prompt_length)} characters / ${count(WORKFLOW_LIMITS.max_agent_tools)} tools |`,
  `| Agent effects | 32 | ${count(WORKFLOW_LIMITS.max_total_effects)} |`,
  `| Concurrency | 4 | ${count(WORKFLOW_LIMITS.max_concurrency)} |`,
  `| Parallel branches / pipeline agents | — | ${count(WORKFLOW_LIMITS.max_parallel_branches)} / ${count(WORKFLOW_LIMITS.max_inline_stages)} |`,
  `| Map and input-array items | 16 | ${count(WORKFLOW_LIMITS.max_map_items)} |`,
  `| Decision transitions | — | ${count(WORKFLOW_LIMITS.max_transitions)} |`,
  `| Condition depth / boolean width | — | ${count(WORKFLOW_LIMITS.max_condition_depth)} / ${count(WORKFLOW_LIMITS.max_condition_width)} |`,
  `| Allowed failure codes | — | ${count(WORKFLOW_LIMITS.max_failure_codes)} |`,
  `| Explicit node visits | 3 in builders | ${count(WORKFLOW_LIMITS.max_node_visits)} |`,
  `| Implicit node visits | — | min(effects + nodes, ${count(WORKFLOW_LIMITS.max_implicit_node_visits)}) |`,
  `| Explicit attempts / retry backoff | 1 / 0 | ${count(WORKFLOW_LIMITS.max_retry_attempts)} / ${WORKFLOW_LIMITS.max_retry_backoff_ms / 1000} seconds |`,
  `| Whole run, cumulative across continuations | 30 minutes | ${WORKFLOW_LIMITS.max_run_ms / 60 / 60 / 1000} hours |`,
  `| One model call | 10 minutes | ${WORKFLOW_LIMITS.max_call_ms / 60 / 60 / 1000} hour |`,
  `| Gate marker / command / arguments | — | ${count(WORKFLOW_LIMITS.max_gate_marker_length)} chars / ${count(WORKFLOW_LIMITS.max_gate_command_length)} chars / ${count(WORKFLOW_LIMITS.max_gate_args)} × ${count(WORKFLOW_LIMITS.max_gate_arg_length)} chars |`,
  `| Gate timeout | — | ${WORKFLOW_LIMITS.max_gate_timeout_ms / 60 / 1000} minutes |`,
  `| Reduce separator / checkpoint reason | — | ${count(WORKFLOW_LIMITS.max_reduce_separator_length)} / ${count(WORKFLOW_LIMITS.max_checkpoint_reason_length)} characters |`,
  `| Structured repair | 2 declared | ${count(WORKFLOW_LIMITS.max_structured_repair_attempts)} |`,
]);
export const DOCS_WORKSPACE_LIMIT_SNIPPETS = Object.freeze([
  `${count(WORKSPACE_COPY_LIMITS.max_files)} regular files`,
  `${WORKSPACE_COPY_LIMITS.max_file_bytes / 1024 / 1024} MiB per`,
  `${WORKSPACE_COPY_LIMITS.max_total_bytes / 1024 / 1024} MiB total`,
  "Workspace proposal copies use those same exported constants.",
]);

function readText(root, rel) {
  return readFileSync(join(root, rel), "utf8");
}

function requireSnippet(errors, text, rel, snippet) {
  if (!text.includes(snippet)) errors.push(`${rel}: missing ${JSON.stringify(snippet)}`);
}

function rejectSnippet(errors, text, rel, snippet) {
  if (text.includes(snippet)) errors.push(`${rel}: stale shipping content ${JSON.stringify(snippet)}`);
}

function requireCommand(errors, manual, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(?:^|[\\s\`])${escaped}(?=[\\s\`]|$)`, "m").test(manual)) {
    errors.push(`docs/manual.md: missing ${JSON.stringify(command)}`);
  }
}

export function checkDocsTruth(root = ROOT) {
  const errors = [];
  for (const rel of [
    "README.md", "SECURITY.md", "NOTICE", "docs/manual.md", "docs/workflows.md",
    "docs/architecture.md", "docs/providers.md", "package.json",
  ]) {
    if (!existsSync(join(root, rel))) errors.push(`${rel}: required documentation surface is missing`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const readme = readText(root, "README.md");
  const manual = readText(root, "docs/manual.md");
  const pkg = JSON.parse(readText(root, "package.json"));
  const lineCount = readme.trimEnd().split(/\r?\n/).length;
  if (lineCount > MAX_README_LINES) errors.push(`README.md: ${lineCount} lines exceeds ${MAX_README_LINES}`);

  for (const snippet of [
    "npm install -g @earendil-works/pi-coding-agent",
    "pi install git:github.com/luisgui1757/helix",
    "/helix-help",
    "/helix-onboarding",
    "/helix-settings",
    "~/.pi/agent/helix",
    "WorkflowDefinition v4",
    "/helix-run-resume",
  ]) requireSnippet(errors, readme, "README.md", snippet);

  for (const command of HELIX_COMMANDS) requireCommand(errors, manual, command);

  for (const [rel, text] of [["README.md", readme], ["docs/manual.md", manual]]) {
    for (const stale of [
      "Stage 1", "Stage 2", "Stage 3", "ROADMAP", "reviews/", "/skill:helix", "helix-rose-pine",
      "Task-bound resume is unsupported", "workflow-resume-unsupported",
    ]) {
      rejectSnippet(errors, text, rel, stale);
    }
  }

  if (pkg.pi?.skills !== undefined || pkg.pi?.themes !== undefined) {
    errors.push("package.json: docs contract requires an extension-only Pi package");
  }
  if ((pkg.pi?.extensions ?? []).length !== 3) {
    errors.push("package.json: docs contract requires exactly three Pi extensions");
  }
  if (pkg.peerDependencies?.["@earendil-works/pi-coding-agent"] !== ">=0.80.7 <0.81.0") {
    errors.push("package.json: documented Pi runtime range drifted");
  }
  const architecture = readText(root, "docs/architecture.md");
  const providers = readText(root, "docs/providers.md");
  const workflows = readText(root, "docs/workflows.md");
  for (const snippet of ["one product workflow engine", "private checkpoint", "CapabilityAttestation"]) {
    requireSnippet(errors, architecture, "docs/architecture.md", snippet);
  }
  for (const snippet of ["allow_fallbacks", "uncertified-disabled", "CLIProxyAPI"]) {
    requireSnippet(errors, providers, "docs/providers.md", snippet);
  }
  for (const row of DOCS_WORKFLOW_LIMIT_ROWS) requireSnippet(errors, workflows, "docs/workflows.md", row);
  for (const snippet of DOCS_WORKSPACE_LIMIT_SNIPPETS) requireSnippet(errors, manual, "docs/manual.md", snippet);
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = checkDocsTruth(process.cwd());
  if (result.ok) {
    console.log("docs-truth-check: PASS");
    process.exit(0);
  }
  for (const error of result.errors) console.error(`docs-truth-check: ${error}`);
  process.exit(1);
}
