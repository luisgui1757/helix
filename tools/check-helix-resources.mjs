#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const root = process.cwd();
const errors = [];
const expectedExtensions = [
  "./extensions/helix-fence.ts",
  "./extensions/helix-answer.ts",
  "./extensions/helix-command.ts",
];
const expectedPackageFiles = [
  "README.md",
  "LICENSE",
  "extensions",
  "dispatch/config",
  "dispatch/lib",
  "docs/manual.md",
  "tools/loop/helix-task-loop.mjs",
  "tools/research/helix-research.mjs",
];
const forbiddenShippingArtifacts = [
  ".pi/settings.json",
  "reviews",
  "skills",
  "themes",
  "ROADMAP.md",
  "ROADMAP_SUMMARY.html",
  "docs/m0a",
  "docs/stage1-2",
  "docs/stage3",
];

function fail(message) {
  errors.push(message);
}

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), "utf8"));
  } catch (error) {
    fail(`${rel}: ${error.message}`);
    return null;
  }
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function walk(rel, predicate, found = []) {
  const full = join(root, rel);
  if (!existsSync(full)) return found;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const child = join(rel, entry.name);
    if (entry.isDirectory()) walk(child, predicate, found);
    else if (predicate(child)) found.push(child);
  }
  return found;
}

function checkPackage() {
  const pkg = readJson("package.json");
  if (!pkg) return;
  if (pkg.name !== "pi-helix") fail("package.json: name must be pi-helix");
  if (pkg.private === true) fail("package.json: package must be installable, not private");
  if (pkg.type !== "module") fail("package.json: type must be module");
  if (pkg.engines?.node !== ">=22.19.0") fail("package.json: Node engine must match Pi's supported floor");
  if (!sameArray(pkg.pi?.extensions, expectedExtensions)) {
    fail("package.json: pi.extensions drifted from the three Helix extensions");
  }
  if (pkg.pi?.skills !== undefined || pkg.pi?.themes !== undefined) {
    fail("package.json: Helix must ship as native extensions, not as a skill or theme");
  }
  if (!sameArray(pkg.files, expectedPackageFiles)) fail("package.json: npm files allowlist drifted");
  if (!sameArray(pkg.keywords, ["pi-package", "pi-extension", "multi-agent", "coding-agent"])) {
    fail("package.json: package discovery keywords drifted");
  }
  if (pkg.peerDependencies?.["@earendil-works/pi-coding-agent"] !== "*") {
    fail("package.json: Pi must be declared as an unbundled peer dependency");
  }
  for (const key of ["dependencies", "optionalDependencies"]) {
    if (pkg[key] && Object.keys(pkg[key]).length > 0) fail(`package.json: ${key} must stay empty`);
  }
}

function checkSurface() {
  const tsFiles = walk("extensions", (rel) => rel.endsWith(".ts")).sort();
  const expected = expectedExtensions.map((rel) => rel.slice(2)).sort();
  if (!sameArray(tsFiles, expected)) {
    fail(`extensions: expected ${expected.join(", ")}; got ${tsFiles.join(", ") || "(none)"}`);
  }
  for (const rel of forbiddenShippingArtifacts) {
    const full = join(root, rel);
    if (!existsSync(full)) continue;
    if (!statSync(full).isDirectory() || walk(rel, () => true).length > 0) {
      fail(`${rel}: non-shipping artifact must not contain tracked files`);
    }
  }
  const team = readJson("dispatch/config/agent-team-defaults.json");
  for (const agent of Object.values(team?.agents ?? {})) {
    if (typeof agent?.brief_path !== "string" || !existsSync(join(root, agent.brief_path))) {
      fail(`dispatch/config/agent-team-defaults.json: missing role brief for ${agent?.role ?? "unknown"}`);
    }
  }
}

function isPackaged(rel) {
  const normalized = normalize(rel);
  return expectedPackageFiles.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
}

function checkImportClosure() {
  const codeFiles = [
    ...walk("extensions", (rel) => /\.(?:mjs|ts)$/.test(rel)),
    ...walk("dispatch/lib", (rel) => rel.endsWith(".mjs")),
    "tools/loop/helix-task-loop.mjs",
    "tools/research/helix-research.mjs",
  ];
  const importPattern = /(?:from\s+|import\s*\()["'](\.{1,2}\/[^"']+)["']/g;
  for (const rel of codeFiles) {
    const text = readFileSync(join(root, rel), "utf8");
    for (const match of text.matchAll(importPattern)) {
      const target = relative(root, resolve(root, dirname(rel), match[1]));
      if (!existsSync(join(root, target))) fail(`${rel}: missing relative import ${match[1]}`);
      else if (!isPackaged(target)) fail(`${rel}: relative import is excluded from npm package: ${target}`);
    }
  }
}

function checkPublicSafety() {
  const roots = ["README.md", "package.json", "extensions", "dispatch/config", "docs/manual.md", "docs/architecture.md"];
  const patterns = [
    /api[_-]?key\s*[:=]/i,
    /secret\s*[:=]/i,
    /auth\.json/i,
    /claude\.ai\/(?:code|share)/i,
    /Co-Authored-By:/i,
    /noreply@anthropic/i,
  ];
  const files = [];
  for (const rel of roots) {
    const full = join(root, rel);
    if (!existsSync(full)) {
      fail(`${rel}: required public surface is missing`);
      continue;
    }
    if (statSync(full).isDirectory()) files.push(...walk(rel, () => true));
    else files.push(rel);
  }
  for (const rel of files) {
    const text = readFileSync(join(root, rel), "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) fail(`${rel}: public-safety pattern matched ${pattern}`);
    }
  }
}

checkPackage();
checkSurface();
checkImportClosure();
checkPublicSafety();

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exit(1);
}

console.log("Helix package resource checks passed.");
