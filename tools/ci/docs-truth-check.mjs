#!/usr/bin/env node
// Keep high-drift documentation claims tied to tracked repo facts.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TRUTH_BEGIN = "<!-- PRIME-DOCS-TRUTH:BEGIN -->";
const TRUTH_END = "<!-- PRIME-DOCS-TRUTH:END -->";

function readText(root, rel) {
  return readFileSync(join(root, rel), "utf8");
}

function readJson(root, rel) {
  return JSON.parse(readText(root, rel));
}

function walk(root, rel, predicate, found = []) {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const child = join(rel, entry.name);
    if (entry.isDirectory()) {
      walk(root, child, predicate, found);
    } else if (predicate(child)) {
      found.push(child);
    }
  }
  return found;
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

export function countNodeTestDeclarations(root) {
  return walk(root, "tests", (path) => path.endsWith(".mjs"))
    .reduce((sum, rel) => sum + countMatches(readText(root, rel), /^\s*test\(/gm), 0);
}

export function countExtensionSlashCommands(root, pkg) {
  return (pkg.pi?.extensions ?? []).reduce((sum, extensionPath) => {
    const rel = extensionPath.replace(/^\.\//, "");
    return sum + countMatches(readText(root, rel), /\.registerCommand\(/g);
  }, 0);
}

export function collectDocsTruthFacts(root = ROOT) {
  const pkg = readJson(root, "package.json");
  return {
    node_test_declarations: countNodeTestDeclarations(root),
    package_resources: {
      skill_entries: pkg.pi?.skills?.length ?? 0,
      theme_entries: pkg.pi?.themes?.length ?? 0,
      theme_files: walk(root, "themes", (path) => path.endsWith(".json")).length,
      extension_entries: pkg.pi?.extensions?.length ?? 0,
    },
    extension_slash_commands: countExtensionSlashCommands(root, pkg),
    prime_command_surface: "one /prime command with verbs",
    roadmap_status_snippet: "Stage 3P whole-repo gap closure",
  };
}

export function parseReadmeTruthBlock(readmeText) {
  const begin = readmeText.indexOf(TRUTH_BEGIN);
  const end = readmeText.indexOf(TRUTH_END);
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error("README.md is missing PRIME-DOCS-TRUTH block");
  }
  const body = readmeText.slice(begin + TRUTH_BEGIN.length, end);
  const match = body.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error("README.md PRIME-DOCS-TRUTH block must contain a json fence");
  return JSON.parse(match[1]);
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function requireSnippet(errors, root, rel, snippet) {
  if (!readText(root, rel).includes(snippet)) {
    errors.push(`${rel}: missing docs-truth snippet ${JSON.stringify(snippet)}`);
  }
}

export function checkDocsTruth(root = ROOT) {
  const errors = [];
  const facts = collectDocsTruthFacts(root);
  let locked;
  try {
    locked = parseReadmeTruthBlock(readText(root, "README.md"));
  } catch (error) {
    errors.push(error.message);
    locked = null;
  }
  if (locked && !sameJson(locked, facts)) {
    errors.push(`README.md PRIME-DOCS-TRUTH drifted: expected ${JSON.stringify(facts)} got ${JSON.stringify(locked)}`);
  }
  requireSnippet(errors, root, "ROADMAP.md", facts.roadmap_status_snippet);
  requireSnippet(errors, root, "ROADMAP_SUMMARY.html", facts.roadmap_status_snippet);
  requireSnippet(errors, root, "docs/resources/README.md", "/prime help");
  requireSnippet(errors, root, "docs/manual.md", "/prime help");
  requireSnippet(errors, root, "docs/stage3/design-contracts.md", "Fail closed on structure, YOLO on behavior");
  return { ok: errors.length === 0, errors, facts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = checkDocsTruth(process.cwd());
  if (result.ok) {
    console.log(`docs-truth-check: PASS ${JSON.stringify(result.facts)}`);
    process.exit(0);
  }
  for (const error of result.errors) console.error(`docs-truth-check: ${error}`);
  process.exit(1);
}
