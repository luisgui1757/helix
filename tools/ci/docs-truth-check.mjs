#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const MAX_README_LINES = 120;
export const HELIX_COMMANDS = Object.freeze([
  "/helix",
  "/helix-help",
  "/helix-run",
  "/helix-runs",
  "/helix-run-status",
  "/helix-run-watch",
  "/helix-run-resume",
  "/helix-run-prune",
  "/helix-models",
  "/helix-chains",
  "/helix-settings",
  "/helix-profiles",
  "/helix-setup",
  "/helix-research",
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
  for (const rel of ["README.md", "docs/manual.md", "docs/architecture.md", "package.json"]) {
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
    "/helix-settings",
    "~/.pi/agent/helix",
  ]) requireSnippet(errors, readme, "README.md", snippet);

  for (const command of HELIX_COMMANDS) requireCommand(errors, manual, command);

  for (const [rel, text] of [["README.md", readme], ["docs/manual.md", manual]]) {
    for (const stale of ["Stage 1", "Stage 2", "Stage 3", "ROADMAP", "reviews/", "/skill:helix", "helix-rose-pine"]) {
      rejectSnippet(errors, text, rel, stale);
    }
  }

  if (pkg.pi?.skills !== undefined || pkg.pi?.themes !== undefined) {
    errors.push("package.json: docs contract requires an extension-only Pi package");
  }
  if ((pkg.pi?.extensions ?? []).length !== 3) {
    errors.push("package.json: docs contract requires exactly three Pi extensions");
  }
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
