#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_ID = 139752288;
const OWNER_LOGIN = "luisgui1757";

function read(root, relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(read(root, relativePath));
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function repositoryPolicyFailures(root = DEFAULT_ROOT) {
  const failures = [];
  const fail = (message) => failures.push(message);

  for (const relativePath of [
    ".github/CODEOWNERS",
    ".github/pull_request_template.md",
    ".github/settings.yml",
    ".github/rulesets/main-integrity.json",
    ".github/rulesets/main-review.json",
    ".github/rulesets/main-owner-updates.json",
    ".github/workflows/ci.yml",
    ".gitleaks.toml",
    "renovate.json",
  ]) {
    if (!existsSync(join(root, relativePath))) fail(`missing ${relativePath}`);
  }
  if (failures.length > 0) return failures;

  if (existsSync(join(root, ".github/dependabot.yml")) || existsSync(join(root, ".github/dependabot.yaml"))) {
    fail("routine version updates must have one owner; remove the Dependabot update configuration");
  }

  const gitleaks = read(root, ".gitleaks.toml");
  for (const required of [
    "useDefault = true",
    'condition = "AND"',
    'targetRules = ["generic-api-key"]',
    "^09da52ad509e2c18e7b9540db3b98c2214c280aa$",
    "^ROADMAP_SOL\\.md$",
  ]) {
    if (!gitleaks.includes(required)) fail(`Gitleaks policy is missing the narrow historical-roadmap exception component ${required}`);
  }

  if (read(root, ".github/CODEOWNERS").trim() !== `* @${OWNER_LOGIN}`) {
    fail("CODEOWNERS must assign the complete repository to its owner");
  }

  const template = read(root, ".github/pull_request_template.md");
  for (const required of ["## Summary", "## Verification", "## Risk", "Updated related markdown"]) {
    if (!template.includes(required)) fail(`pull request template is missing ${required}`);
  }

  const settings = read(root, ".github/settings.yml");
  if (/^branches:\s*$/m.test(settings)) fail("settings.yml must not duplicate rulesets with classic branch protection");
  for (const required of [
    "allow_merge_commit: false",
    "allow_squash_merge: true",
    "allow_rebase_merge: false",
    "allow_auto_merge: false",
    "delete_branch_on_merge: true",
    "enable_automated_security_fixes: true",
    "enable_vulnerability_alerts: true",
  ]) {
    if (!settings.includes(required)) fail(`settings.yml is missing ${required}`);
  }

  const workflowsDir = join(root, ".github/workflows");
  const workflowFiles = readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => join(workflowsDir, name));
  for (const workflowFile of workflowFiles) {
    const workflow = readFileSync(workflowFile, "utf8");
    if (/^\s*pull_request_target\s*:/m.test(workflow)) fail(`${workflowFile} uses pull_request_target`);
    if (/^\s+[a-z-]+:\s+write\s*$/m.test(workflow) || /^\s*permissions:\s+write-all\s*$/m.test(workflow)) {
      fail(`${workflowFile} grants write permissions`);
    }
    for (const match of workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+).*$/gm)) {
      const action = match[1];
      if (action.startsWith("./")) continue;
      if (!/^actions\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(action)) {
        fail(`${workflowFile} uses an unapproved or non-SHA-pinned action: ${action}`);
      }
    }
  }

  const ci = read(root, ".github/workflows/ci.yml");
  for (const required of [
    "branches:\n      - main",
    "permissions:\n  contents: read",
    "concurrency:",
    "cancel-in-progress: true",
    "dependency_review:",
    "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
    "needs: [test_matrix, dependency_review]",
    "DEPENDENCY_REVIEW_RESULT",
  ]) {
    if (!ci.includes(required)) fail(`CI is missing ${required}`);
  }

  const renovate = readJson(root, "renovate.json");
  if (!renovate.extends?.includes("config:best-practices")) fail("Renovate must extend config:best-practices");
  if (!sameJson(renovate.enabledManagers, ["npm", "github-actions", "custom.regex"])) {
    fail("Renovate managers must cover npm, GitHub Actions, and the Pi matrix custom manager");
  }
  if (renovate.automerge !== false || renovate.rebaseWhen !== "behind-base-branch") {
    fail("Renovate must keep automerge off and rebase behind-base branches");
  }
  if (renovate.vulnerabilityAlerts?.enabled !== false) {
    fail("Renovate must defer vulnerability alerts to GitHub-native Dependabot");
  }
  if (renovate.lockFileMaintenance?.enabled !== true) fail("Renovate lock-file maintenance must be enabled");
  const actionsRule = renovate.packageRules?.find((rule) => rule.matchManagers?.includes("github-actions"));
  if (!actionsRule || actionsRule.pinDigests !== true || actionsRule.separateMajorMinor !== false) {
    fail("Renovate must digest-pin and consolidate GitHub Actions updates");
  }
  const piManager = renovate.customManagers?.find((manager) => manager.depNameTemplate === "@earendil-works/pi-coding-agent");
  if (!piManager || piManager.datasourceTemplate !== "npm") fail("Renovate must track the newest compatible Pi matrix release");
  else {
    const match = new RegExp(piManager.matchStrings[0], "g").exec(ci);
    const piVersions = [...ci.matchAll(/^\s+- (0\.80\.\d+)$/gm)].map((entry) => entry[1]);
    if (piVersions.length !== 2 || piVersions[0] !== "0.80.7" || match?.groups?.currentValue !== piVersions[1]) {
      fail("Renovate's Pi custom manager must update only the compatibility-ceiling test and preserve the 0.80.7 floor");
    }
  }

  const integrity = readJson(root, ".github/rulesets/main-integrity.json");
  const review = readJson(root, ".github/rulesets/main-review.json");
  const ownerUpdates = readJson(root, ".github/rulesets/main-owner-updates.json");
  if (!sameJson(integrity.bypass_actors, [])) fail("integrity ruleset must be unbypassable");
  if (!sameJson(integrity.rules.map((rule) => rule.type), [
    "pull_request",
    "required_status_checks",
    "code_scanning",
    "deletion",
    "non_fast_forward",
    "required_linear_history",
  ])) fail("integrity ruleset does not contain the canonical fail-closed rules");

  const statusChecks = integrity.rules.find((rule) => rule.type === "required_status_checks")?.parameters;
  if (statusChecks?.strict_required_status_checks_policy !== true || !sameJson(statusChecks.required_status_checks, [{
    context: "test",
    integration_id: 15368,
  }])) fail("integrity ruleset must strictly require the GitHub Actions test objective");

  const codeScanning = integrity.rules.find((rule) => rule.type === "code_scanning")?.parameters;
  if (!sameJson(codeScanning?.code_scanning_tools, [{
    tool: "CodeQL",
    alerts_threshold: "errors",
    security_alerts_threshold: "high_or_higher",
  }])) fail("integrity ruleset must enforce the canonical CodeQL thresholds");

  const ownerBypass = [{ actor_id: OWNER_ID, actor_type: "User", bypass_mode: "pull_request" }];
  if (!sameJson(review.bypass_actors, ownerBypass) || !sameJson(ownerUpdates.bypass_actors, ownerBypass)) {
    fail("review and update bypass must be owner-only and pull-request-only");
  }
  const reviewRule = review.rules.find((rule) => rule.type === "pull_request")?.parameters;
  if (reviewRule?.required_approving_review_count !== 1
      || reviewRule.require_code_owner_review !== true
      || reviewRule.dismiss_stale_reviews_on_push !== true
      || reviewRule.require_last_push_approval !== true
      || reviewRule.required_review_thread_resolution !== true
      || !sameJson(reviewRule.allowed_merge_methods, ["squash"])) {
    fail("review ruleset must require fresh code-owner review, resolved threads, and squash merge");
  }
  if (!sameJson(ownerUpdates.rules, [{ type: "update" }])) {
    fail("owner update ruleset must restrict default-branch updates");
  }

  return failures;
}

export function assertRepositoryPolicy(root = DEFAULT_ROOT) {
  const failures = repositoryPolicyFailures(root);
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const failures = repositoryPolicyFailures();
  if (failures.length > 0) {
    for (const failure of failures) console.error(`repository-policy-check: FAIL: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("repository-policy-check: ok: checked-in governance is canonical and fail closed");
  }
}
