#!/usr/bin/env node
// Static CI guard for Prime no-live/no-secret checks.
//
// This is not a packet-level egress proof. The Docker lockdown smoke remains the
// enforcing local proof. Semantics (2026-07-09, presence = live): run configs
// carry no live flag — a config naming real providers IS live. CI safety
// therefore rests on (a) CI wiring no provider credentials, (b) CI exercising
// only mock-provider configs, and (c) removed cost-control identifiers never
// reappearing in the dispatch layer (the removal lint).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(new URL("../..", import.meta.url).pathname);

const FORBIDDEN_WORKFLOW_PATTERNS = Object.freeze([
  { code: "workflow-secret-reference", re: /\$\{\{\s*secrets\./i },
  { code: "provider-env-openai", re: /\bOPENAI_API_KEY\b/ },
  { code: "provider-env-anthropic", re: /\bANTHROPIC_(API_KEY|OAUTH_TOKEN)\b/ },
  { code: "provider-env-openrouter", re: /\bOPENROUTER_API_KEY\b/ },
  { code: "provider-env-github-token", re: /\b(GH_TOKEN|GITHUB_TOKEN)\b.*\bpi\b/i },
  { code: "live-openrouter-smoke", re: /openrouter-free-(smoke|revision-smoke|multimodel-revision-smoke)\.(sh|mjs)\b/ },
  { code: "direct-provider-call", re: /\bpi\b[^\n]*(--provider|--api-key)\b/ },
]);

const FORBIDDEN_SCRIPT_PATTERNS = Object.freeze([
  { code: "live-smoke-script", re: /openrouter-free-(smoke|revision-smoke|multimodel-revision-smoke)\.(sh|mjs)\b/ },
  { code: "direct-provider-script", re: /\bpi\b[^\n]*(--provider|--api-key)\b/ },
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function scanText(label, text, patterns, findings) {
  for (const pattern of patterns) {
    if (pattern.re.test(text)) findings.push({ label, code: pattern.code });
  }
}

// CI exercises `mock-core-loop` through both the legacy matrix path and the
// staged assignment/preset path. Check both actual signals: a mock legacy
// matrix cannot mask a real provider in an effective composite preset.
function checkCiConfigsMockOnly(root, findings) {
  const registry = readJson(join(root, "dispatch/config/run-configs.json"));
  const matrix = readJson(join(root, "dispatch/config/role-matrix-defaults.json"));
  const ciConfig = (registry.configs ?? []).find((config) => config?.id === "mock-core-loop");
  if (!ciConfig) {
    findings.push({ label: "run-config:mock-core-loop", code: "ci-config-missing" });
    return;
  }
  if (ciConfig.role_matrix !== matrix?.matrix_id) {
    findings.push({ label: `run-config:${ciConfig.id}`, code: "ci-config-matrix-unresolved" });
    return;
  }
  for (const [role, entries] of Object.entries(matrix.roles ?? {})) {
    for (const entry of entries ?? []) {
      if (entry?.provider !== "mock") {
        findings.push({ label: `role-matrix:${matrix.matrix_id}:${role}`, code: "ci-matrix-provider-not-mock" });
      }
    }
  }

  const assignments = [
    ...Object.values(ciConfig.assignments ?? {}),
    ...(ciConfig.default_assignment ? [ciConfig.default_assignment] : []),
  ];
  const checkedPresets = new Set();
  for (const assignment of assignments) {
    if (assignment?.kind === "model") {
      if (assignment.provider !== "mock") {
        findings.push({ label: `run-config:${ciConfig.id}`, code: "ci-effective-provider-not-mock" });
      }
      continue;
    }
    if (assignment?.kind !== "composite" || typeof assignment.preset !== "string") {
      findings.push({ label: `run-config:${ciConfig.id}`, code: "ci-effective-assignment-invalid" });
      continue;
    }
    if (checkedPresets.has(assignment.preset)) continue;
    checkedPresets.add(assignment.preset);
    const presetPath = join(root, "dispatch/config/matrices", `${assignment.preset}.json`);
    if (!existsSync(presetPath)) {
      findings.push({ label: `preset:${assignment.preset}`, code: "ci-effective-preset-unresolved" });
      continue;
    }
    let preset;
    try {
      preset = readJson(presetPath);
    } catch {
      findings.push({ label: `preset:${assignment.preset}`, code: "ci-effective-preset-unreadable" });
      continue;
    }
    for (const [role, members] of Object.entries(preset.roles ?? {})) {
      for (const member of members ?? []) {
        if (member?.provider !== "mock") {
          findings.push({ label: `preset:${assignment.preset}:${role}`, code: "ci-effective-provider-not-mock" });
        }
      }
    }
  }
}

// Removal lint: cost control left the harness on 2026-07-09 (backend billing
// owns spend). None of its identifiers may reappear in the dispatch layer.
const REMOVED_COST_IDENTIFIERS = Object.freeze([
  "usd_metered_cap",
  "confirm_threshold_usd",
  "token_budget",
  "price_ttl_seconds",
  "requires_free_verified",
  "write_allowlist",
  "cost_class",
  "price_status",
  "cost_basis",
  "evaluateNoSpend",
  "evaluateCostProjection",
  "projectProviderPolicy",
  "clampPriceToProfile",
  "evaluateCopilotPin",
  "copilot_pins",
  "nospend-preflight",
]);

function checkRemovedCostControl(root, findings) {
  const targets = listFiles(join(root, "dispatch")).filter((file) =>
    /\.(?:c?js|mjs|json|md|ts|ya?ml)$/.test(file)
    && !file.includes(`${join(root, "dispatch", "runs")}/`)
    && !file.includes(`${join(root, "dispatch", "local")}/`));
  for (const path of targets) {
    const text = readFileSync(path, "utf8");
    for (const identifier of REMOVED_COST_IDENTIFIERS) {
      if (text.includes(identifier)) {
        findings.push({ label: path.replace(root + "/", ""), code: `removed-cost-identifier:${identifier}` });
      }
    }
  }
}

function checkPackageScripts(root, findings) {
  const pkg = readJson(join(root, "package.json"));
  for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
    scanText(`package-script:${name}`, String(script), FORBIDDEN_SCRIPT_PATTERNS, findings);
  }
}

function checkWorkflows(root, findings) {
  const workflowDir = join(root, ".github/workflows");
  for (const path of listFiles(workflowDir).filter((file) => /\.(ya?ml)$/.test(file))) {
    scanText(path.replace(root + "/", ""), readFileSync(path, "utf8"), FORBIDDEN_WORKFLOW_PATTERNS, findings);
  }
}

export function checkNoLiveEgress({ root = DEFAULT_ROOT } = {}) {
  const findings = [];
  checkCiConfigsMockOnly(root, findings);
  checkRemovedCostControl(root, findings);
  checkPackageScripts(root, findings);
  checkWorkflows(root, findings);
  return {
    ok: findings.length === 0,
    findings,
    limitation: "static CI guard only; packet-level denial is tools/lockdown/no-egress-smoke.sh",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkNoLiveEgress({ root: process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
