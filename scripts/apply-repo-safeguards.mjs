#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertRepositoryPolicy } from "../tools/repository-policy-check.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "luisgui1757/helix";
const OWNER_ID = 139752288;
const SNAPSHOT_SCHEMA = "helix-repository-safeguards-v1";
const RULESET_FILES = new Map([
  ["Protect main: integrity", ".github/rulesets/main-integrity.json"],
  ["Protect main: review", ".github/rulesets/main-review.json"],
  ["Protect main: owner updates", ".github/rulesets/main-owner-updates.json"],
]);

function fail(message) {
  throw new Error(message);
}

function run(command, args, { input, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    fail(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function git(...args) {
  return run("git", args).stdout.trim();
}

function ghApi(apiPath, { method = "GET", input, allow404 = false } = {}) {
  const args = ["api"];
  if (method !== "GET") args.push("-X", method);
  args.push(apiPath);
  if (input !== undefined) args.push("--input", "-");
  const result = run("gh", args, {
    input: input === undefined ? undefined : `${JSON.stringify(input)}\n`,
    allowFailure: allow404,
  });
  if (result.status !== 0) {
    if (allow404 && /(?:HTTP 404|Not Found|Branch not protected)/i.test(result.stderr || result.stdout)) return null;
    fail(`gh api ${apiPath} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  const output = result.stdout.trim();
  return output === "" ? undefined : JSON.parse(output);
}

function endpointEnabled(apiPath) {
  return ghApi(apiPath, { allow404: true }) !== null;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} has an unexpected shape`);
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be boolean`);
}

function canonicalRuleset(payload) {
  if (!payload) return null;
  return {
    name: payload.name,
    target: payload.target,
    enforcement: payload.enforcement,
    bypass_actors: [...(payload.bypass_actors ?? [])]
      .map(({ actor_id, actor_type, bypass_mode }) => ({ actor_id, actor_type, bypass_mode }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    conditions: payload.conditions,
    rules: [...payload.rules].map((rule) => {
      if (rule.type === "pull_request") {
        const parameters = rule.parameters;
        return {
          type: rule.type,
          parameters: {
            required_approving_review_count: parameters.required_approving_review_count,
            dismiss_stale_reviews_on_push: parameters.dismiss_stale_reviews_on_push,
            required_reviewers: parameters.required_reviewers ?? [],
            require_code_owner_review: parameters.require_code_owner_review,
            require_last_push_approval: parameters.require_last_push_approval,
            required_review_thread_resolution: parameters.required_review_thread_resolution,
            allowed_merge_methods: [...parameters.allowed_merge_methods].sort(),
          },
        };
      }
      if (rule.type === "required_status_checks") {
        return {
          type: rule.type,
          parameters: {
            strict_required_status_checks_policy: rule.parameters.strict_required_status_checks_policy,
            do_not_enforce_on_create: rule.parameters.do_not_enforce_on_create,
            required_status_checks: [...rule.parameters.required_status_checks]
              .map(({ context, integration_id }) => ({ context, integration_id }))
              .sort((left, right) => left.context.localeCompare(right.context)),
          },
        };
      }
      if (rule.type === "code_scanning") {
        return {
          type: rule.type,
          parameters: {
            code_scanning_tools: [...rule.parameters.code_scanning_tools]
              .map(({ tool, alerts_threshold, security_alerts_threshold }) => ({
                tool,
                alerts_threshold,
                security_alerts_threshold,
              }))
              .sort((left, right) => left.tool.localeCompare(right.tool)),
          },
        };
      }
      return { type: rule.type };
    }).sort((left, right) => left.type.localeCompare(right.type)),
  };
}

function desiredRulesets(ownerId) {
  return [...RULESET_FILES].map(([name, relativePath]) => {
    const payload = JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
    payload.bypass_actors = payload.bypass_actors.map((actor) => (
      actor.actor_type === "User" ? { ...actor, actor_id: ownerId } : actor
    ));
    return { name, payload: canonicalRuleset(payload) };
  });
}

function legacyRulesets(ownerId) {
  const legacy = desiredRulesets(ownerId);
  legacy[0] = {
    ...legacy[0],
    payload: {
      ...legacy[0].payload,
      rules: legacy[0].payload.rules.filter((rule) => !["code_scanning", "pull_request"].includes(rule.type)),
    },
  };
  legacy[1] = {
    ...legacy[1],
    payload: {
      ...legacy[1].payload,
      rules: legacy[1].payload.rules.map((rule) => ({
        ...rule,
        parameters: { ...rule.parameters, require_code_owner_review: false },
      })),
    },
  };
  legacy[2] = { ...legacy[2], payload: null };
  return legacy;
}

function rulesetIdByName(name) {
  const matches = ghApi(`repos/${REPOSITORY}/rulesets?includes_parents=false`)
    .filter((ruleset) => ruleset.name === name);
  if (matches.length > 1) fail(`live ruleset name is duplicated: ${name}`);
  return matches[0]?.id ?? null;
}

function readLiveRulesets() {
  return [...RULESET_FILES.keys()].map((name) => {
    const id = rulesetIdByName(name);
    return { name, payload: id === null ? null : canonicalRuleset(ghApi(`repos/${REPOSITORY}/rulesets/${id}`)) };
  });
}

function repositorySettings(repository) {
  return {
    description: repository.description,
    homepage: repository.homepage,
    allow_merge_commit: repository.allow_merge_commit,
    allow_squash_merge: repository.allow_squash_merge,
    allow_rebase_merge: repository.allow_rebase_merge,
    allow_auto_merge: repository.allow_auto_merge,
    delete_branch_on_merge: repository.delete_branch_on_merge,
    secret_scanning: repository.security_and_analysis?.secret_scanning?.status,
    secret_scanning_push_protection: repository.security_and_analysis?.secret_scanning_push_protection?.status,
  };
}

function captureState() {
  const repository = ghApi(`repos/${REPOSITORY}`);
  const actions = ghApi(`repos/${REPOSITORY}/actions/permissions`);
  const selectedActions = actions.allowed_actions === "selected"
    ? ghApi(`repos/${REPOSITORY}/actions/permissions/selected-actions`)
    : null;
  return {
    repositorySettings: repositorySettings(repository),
    actions: {
      enabled: actions.enabled,
      allowed_actions: actions.allowed_actions,
      sha_pinning_required: actions.sha_pinning_required,
    },
    selectedActions: selectedActions === null ? null : {
      github_owned_allowed: selectedActions.github_owned_allowed,
      verified_allowed: selectedActions.verified_allowed,
      patterns_allowed: selectedActions.patterns_allowed,
    },
    workflowPermissions: ghApi(`repos/${REPOSITORY}/actions/permissions/workflow`),
    immutableReleases: ghApi(`repos/${REPOSITORY}/immutable-releases`).enabled,
    privateVulnerabilityReporting: ghApi(`repos/${REPOSITORY}/private-vulnerability-reporting`).enabled,
    vulnerabilityAlerts: endpointEnabled(`repos/${REPOSITORY}/vulnerability-alerts`),
    automatedSecurityFixes: ghApi(`repos/${REPOSITORY}/automated-security-fixes`).enabled,
    rulesets: readLiveRulesets(),
  };
}

export function desiredState(ownerId = OWNER_ID) {
  return {
    repositorySettings: {
      description: "Native multi-model team workflows for the Pi coding agent.",
      homepage: "https://github.com/luisgui1757/helix#readme",
      allow_merge_commit: false,
      allow_squash_merge: true,
      allow_rebase_merge: false,
      allow_auto_merge: false,
      delete_branch_on_merge: true,
      secret_scanning: "enabled",
      secret_scanning_push_protection: "enabled",
    },
    actions: { enabled: true, allowed_actions: "selected", sha_pinning_required: true },
    selectedActions: { github_owned_allowed: true, verified_allowed: false, patterns_allowed: [] },
    workflowPermissions: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false },
    immutableReleases: true,
    privateVulnerabilityReporting: true,
    vulnerabilityAlerts: true,
    automatedSecurityFixes: true,
    rulesets: desiredRulesets(ownerId),
  };
}

function assertSafePreApplyState(state, ownerId) {
  const desired = desiredState(ownerId);
  for (const key of [
    "actions",
    "selectedActions",
    "workflowPermissions",
    "immutableReleases",
    "privateVulnerabilityReporting",
    "vulnerabilityAlerts",
    "automatedSecurityFixes",
  ]) assertSame(state[key], desired[key], `safe pre-apply ${key}`);

  const actualRepository = { ...state.repositorySettings };
  const expectedRepository = { ...desired.repositorySettings };
  delete actualRepository.allow_auto_merge;
  delete expectedRepository.allow_auto_merge;
  assertSame(actualRepository, expectedRepository, "safe pre-apply repository settings");
  requireBoolean(state.repositorySettings.allow_auto_merge, "safe pre-apply auto-merge setting");

  const legacy = legacyRulesets(ownerId);
  state.rulesets.forEach((entry, index) => {
    const isLegacy = JSON.stringify(entry) === JSON.stringify(legacy[index]);
    const isDesired = JSON.stringify(entry) === JSON.stringify(desired.rulesets[index]);
    if (!isLegacy && !isDesired) fail(`live ${entry.name} is neither the reviewed legacy nor canonical policy`);
  });
}

function validateRulesetSnapshot(entry, expectedName) {
  exactKeys(entry, ["name", "payload"], `ruleset snapshot ${expectedName}`);
  if (entry.name !== expectedName) fail(`ruleset snapshot name must be ${expectedName}`);
  if (entry.payload === null) return;
  exactKeys(entry.payload, ["name", "target", "enforcement", "bypass_actors", "conditions", "rules"], `${expectedName} payload`);
  if (entry.payload.name !== expectedName || entry.payload.target !== "branch") fail(`${expectedName} snapshot targets the wrong resource`);
  if (!Array.isArray(entry.payload.bypass_actors) || !Array.isArray(entry.payload.rules)) fail(`${expectedName} snapshot arrays are malformed`);
}

export function validateSnapshotDocument(snapshot) {
  exactKeys(snapshot, ["schema", "repository", "head", "capturedAt", "state"], "snapshot");
  if (snapshot.schema !== SNAPSHOT_SCHEMA) fail("unsupported snapshot schema");
  if (snapshot.repository !== REPOSITORY) fail(`snapshot is for ${snapshot.repository}, not ${REPOSITORY}`);
  if (!/^[0-9a-f]{40}$/.test(snapshot.head)) fail("snapshot head must be a full commit SHA");
  if (Number.isNaN(Date.parse(snapshot.capturedAt))) fail("snapshot timestamp is invalid");

  const state = snapshot.state;
  exactKeys(state, [
    "repositorySettings",
    "actions",
    "selectedActions",
    "workflowPermissions",
    "immutableReleases",
    "privateVulnerabilityReporting",
    "vulnerabilityAlerts",
    "automatedSecurityFixes",
    "rulesets",
  ], "snapshot state");
  exactKeys(state.repositorySettings, [
    "description",
    "homepage",
    "allow_merge_commit",
    "allow_squash_merge",
    "allow_rebase_merge",
    "allow_auto_merge",
    "delete_branch_on_merge",
    "secret_scanning",
    "secret_scanning_push_protection",
  ], "snapshot repository settings");
  if (state.repositorySettings.description !== null && typeof state.repositorySettings.description !== "string") fail("snapshot description is invalid");
  if (state.repositorySettings.homepage !== null && typeof state.repositorySettings.homepage !== "string") fail("snapshot homepage is invalid");
  for (const key of ["allow_merge_commit", "allow_squash_merge", "allow_rebase_merge", "allow_auto_merge", "delete_branch_on_merge"]) {
    requireBoolean(state.repositorySettings[key], `snapshot ${key}`);
  }
  for (const key of ["secret_scanning", "secret_scanning_push_protection"]) {
    if (!["enabled", "disabled"].includes(state.repositorySettings[key])) fail(`snapshot ${key} is invalid`);
  }
  exactKeys(state.actions, ["enabled", "allowed_actions", "sha_pinning_required"], "snapshot Actions policy");
  requireBoolean(state.actions.enabled, "snapshot Actions enabled");
  requireBoolean(state.actions.sha_pinning_required, "snapshot Actions SHA policy");
  if (!["all", "local_only", "selected"].includes(state.actions.allowed_actions)) fail("snapshot allowed_actions is invalid");
  if (state.selectedActions !== null) {
    exactKeys(state.selectedActions, ["github_owned_allowed", "verified_allowed", "patterns_allowed"], "snapshot selected Actions");
    requireBoolean(state.selectedActions.github_owned_allowed, "snapshot GitHub-owned Actions policy");
    requireBoolean(state.selectedActions.verified_allowed, "snapshot verified Actions policy");
    if (!Array.isArray(state.selectedActions.patterns_allowed) || !state.selectedActions.patterns_allowed.every((value) => typeof value === "string")) {
      fail("snapshot selected Action patterns are invalid");
    }
  }
  if ((state.actions.allowed_actions === "selected") !== (state.selectedActions !== null)) {
    fail("snapshot selected Actions state is inconsistent with allowed_actions");
  }
  exactKeys(state.workflowPermissions, ["default_workflow_permissions", "can_approve_pull_request_reviews"], "snapshot workflow permissions");
  if (!["read", "write"].includes(state.workflowPermissions.default_workflow_permissions)) fail("snapshot workflow permission is invalid");
  requireBoolean(state.workflowPermissions.can_approve_pull_request_reviews, "snapshot workflow review permission");
  for (const key of ["immutableReleases", "privateVulnerabilityReporting", "vulnerabilityAlerts", "automatedSecurityFixes"]) {
    requireBoolean(state[key], `snapshot ${key}`);
  }
  if (!Array.isArray(state.rulesets) || state.rulesets.length !== RULESET_FILES.size) fail("snapshot ruleset set is incomplete");
  [...RULESET_FILES.keys()].forEach((name, index) => validateRulesetSnapshot(state.rulesets[index], name));
  assertSafePreApplyState(state, OWNER_ID);
  return snapshot;
}

function snapshotDirectory() {
  const common = git("rev-parse", "--git-common-dir");
  const commonDirectory = isAbsolute(common) ? common : resolve(ROOT, common);
  return join(commonDirectory, "helix-safeguards");
}

function writeSnapshot(head, state) {
  const directory = snapshotDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const snapshotPath = join(directory, `${stamp}-${head.slice(0, 12)}.json`);
  const document = `${JSON.stringify({ schema: SNAPSHOT_SCHEMA, repository: REPOSITORY, head, capturedAt: new Date().toISOString(), state }, null, 2)}\n`;
  const digest = createHash("sha256").update(document).digest("hex");
  writeFileSync(snapshotPath, document, { encoding: "utf8", flag: "wx", mode: 0o600 });
  writeFileSync(`${snapshotPath}.sha256`, `${digest}  ${basename(snapshotPath)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  chmodSync(snapshotPath, 0o400);
  chmodSync(`${snapshotPath}.sha256`, 0o400);
  return snapshotPath;
}

function readValidatedSnapshot(snapshotPath) {
  const expectedDirectory = realpathSync(snapshotDirectory());
  const requested = resolve(snapshotPath);
  const requestedStat = lstatSync(requested);
  if (!requestedStat.isFile() || requestedStat.isSymbolicLink()) fail("snapshot path must name a regular file directly");
  const absolute = realpathSync(snapshotPath);
  if (dirname(absolute) !== expectedDirectory) fail("snapshot must remain inside the private Helix safeguards directory");
  for (const candidate of [absolute, `${absolute}.sha256`]) {
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail(`unsafe snapshot file: ${candidate}`);
  }
  const document = readFileSync(absolute, "utf8");
  const digest = createHash("sha256").update(document).digest("hex");
  if (readFileSync(`${absolute}.sha256`, "utf8") !== `${digest}  ${basename(absolute)}\n`) fail("snapshot digest does not match");
  return validateSnapshotDocument(JSON.parse(document));
}

function assertSame(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} differs from the canonical policy`);
}

function preflight() {
  assertRepositoryPolicy(ROOT);
  if (git("branch", "--show-current") !== "main") fail("run safeguards from main");
  if (git("status", "--porcelain=v1", "--untracked-files=all") !== "") fail("main worktree must be clean");
  const resolvedRepository = JSON.parse(run("gh", ["repo", "view", "--json", "nameWithOwner"], {}).stdout).nameWithOwner;
  if (resolvedRepository !== REPOSITORY) fail(`origin resolves to ${resolvedRepository}, not ${REPOSITORY}`);
  const localHead = git("rev-parse", "HEAD");
  const repository = ghApi(`repos/${REPOSITORY}`);
  const liveHead = ghApi(`repos/${REPOSITORY}/commits/main`).sha;
  if (repository.visibility !== "public" || repository.default_branch !== "main") fail("Helix must be public with main as its default branch");
  if (localHead !== liveHead) fail(`local main ${localHead} is not live main ${liveHead}`);
  if (ghApi(`repos/${REPOSITORY}/branches/main/protection`, { allow404: true }) !== null) fail("classic branch protection overlaps the ruleset source of truth");

  const liveRulesets = ghApi(`repos/${REPOSITORY}/rulesets?includes_parents=false`);
  const allowedNames = new Set(RULESET_FILES.keys());
  if (liveRulesets.some((ruleset) => !allowedNames.has(ruleset.name))) fail("an unexpected live ruleset overlaps the checked-in policy");
  for (const name of allowedNames) {
    if (liveRulesets.filter((ruleset) => ruleset.name === name).length > 1) fail(`live ruleset name is duplicated: ${name}`);
  }

  const defaultSetup = ghApi(`repos/${REPOSITORY}/code-scanning/default-setup`);
  if (defaultSetup.state !== "configured") fail("CodeQL default setup is not configured");
  const analyses = ghApi(`repos/${REPOSITORY}/code-scanning/analyses?ref=refs/heads/main&tool_name=CodeQL&per_page=100`);
  if (!analyses.some((analysis) => analysis.commit_sha === liveHead && analysis.error === "")) {
    fail(`CodeQL has no successful analysis for exact main ${liveHead}`);
  }
  const checks = ghApi(`repos/${REPOSITORY}/commits/${liveHead}/check-runs?per_page=100`);
  if (!checks.check_runs.some((check) => check.name === "test" && check.app?.slug === "github-actions" && check.conclusion === "success")) {
    fail(`exact main ${liveHead} has no successful GitHub Actions test objective`);
  }
  assertSafePreApplyState(captureState(), repository.owner.id);
  return { head: liveHead, ownerId: repository.owner.id };
}

function setToggle(apiPath, enabled) {
  ghApi(apiPath, { method: enabled ? "PUT" : "DELETE" });
}

function upsertRuleset(entry) {
  const id = rulesetIdByName(entry.name);
  ghApi(id === null ? `repos/${REPOSITORY}/rulesets` : `repos/${REPOSITORY}/rulesets/${id}`, {
    method: id === null ? "POST" : "PUT",
    input: entry.payload,
  });
}

function applyState(state) {
  const repository = state.repositorySettings;
  ghApi(`repos/${REPOSITORY}`, {
    method: "PATCH",
    input: {
      description: repository.description,
      homepage: repository.homepage,
      allow_merge_commit: repository.allow_merge_commit,
      allow_squash_merge: repository.allow_squash_merge,
      allow_rebase_merge: repository.allow_rebase_merge,
      allow_auto_merge: repository.allow_auto_merge,
      delete_branch_on_merge: repository.delete_branch_on_merge,
      security_and_analysis: {
        secret_scanning: { status: repository.secret_scanning },
        secret_scanning_push_protection: { status: repository.secret_scanning_push_protection },
      },
    },
  });
  ghApi(`repos/${REPOSITORY}/actions/permissions`, { method: "PUT", input: state.actions });
  if (state.selectedActions !== null) {
    ghApi(`repos/${REPOSITORY}/actions/permissions/selected-actions`, { method: "PUT", input: state.selectedActions });
  }
  ghApi(`repos/${REPOSITORY}/actions/permissions/workflow`, { method: "PUT", input: state.workflowPermissions });
  setToggle(`repos/${REPOSITORY}/immutable-releases`, state.immutableReleases);
  setToggle(`repos/${REPOSITORY}/vulnerability-alerts`, state.vulnerabilityAlerts);
  setToggle(`repos/${REPOSITORY}/automated-security-fixes`, state.automatedSecurityFixes);
  setToggle(`repos/${REPOSITORY}/private-vulnerability-reporting`, state.privateVulnerabilityReporting);

  for (const entry of state.rulesets) {
    const id = rulesetIdByName(entry.name);
    if (entry.payload === null) {
      if (id !== null) ghApi(`repos/${REPOSITORY}/rulesets/${id}`, { method: "DELETE" });
    } else {
      upsertRuleset(entry);
    }
  }
}

function verifyState(expected, label) {
  assertSame(captureState(), expected, label);
}

function restoreSnapshot(snapshot, { requireExactHead = true } = {}) {
  const liveHead = ghApi(`repos/${REPOSITORY}/commits/main`).sha;
  if (requireExactHead && liveHead !== snapshot.head) fail(`snapshot head ${snapshot.head} is not current live main ${liveHead}`);
  applyState(snapshot.state);
  verifyState(snapshot.state, "restored live state");
}

function assertManualRestoreBoundary(snapshot) {
  if (git("branch", "--show-current") !== "main") fail("manual recovery must run from main");
  if (git("status", "--porcelain=v1", "--untracked-files=all") !== "") fail("manual recovery requires a clean worktree");
  if (git("rev-parse", "HEAD") !== snapshot.head) fail("manual recovery checkout does not match the snapshot head");
  const resolvedRepository = JSON.parse(run("gh", ["repo", "view", "--json", "nameWithOwner"], {}).stdout).nameWithOwner;
  if (resolvedRepository !== REPOSITORY) fail(`origin resolves to ${resolvedRepository}, not ${REPOSITORY}`);
}

function usage() {
  console.log(`Usage:
  scripts/apply-repo-safeguards.mjs --preflight-only
  scripts/apply-repo-safeguards.mjs
  scripts/apply-repo-safeguards.mjs --restore /absolute/path/to/snapshot.json`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) return usage();
  run("gh", ["auth", "status"]);

  if (args[0] === "--restore") {
    if (args.length !== 2 || !existsSync(args[1])) fail("--restore requires one existing snapshot path");
    const snapshot = readValidatedSnapshot(args[1]);
    assertManualRestoreBoundary(snapshot);
    restoreSnapshot(snapshot);
    console.log(`Repository safeguards restored and verified from ${realpathSync(args[1])}`);
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== "--preflight-only")) fail("unknown arguments; use --help");

  const { head, ownerId } = preflight();
  if (args[0] === "--preflight-only") {
    console.log(`Safeguard preflight passed for exact live main ${head}; no state changed.`);
    return;
  }

  const before = captureState();
  const snapshotPath = writeSnapshot(head, before);
  console.log(`Recovery snapshot: ${snapshotPath}`);
  const frozen = readValidatedSnapshot(snapshotPath);
  if (ghApi(`repos/${REPOSITORY}/commits/main`).sha !== head) fail("main moved after preflight; no mutation was attempted");
  verifyState(before, "live state immediately before mutation");

  try {
    const desired = desiredState(ownerId);
    applyState(desired);
    verifyState(desired, "post-apply live state");
    if (ghApi(`repos/${REPOSITORY}/commits/main`).sha !== head) fail("main moved during safeguard apply");
    console.log(`Repository safeguards applied and verified for exact main ${head}.`);
    console.log(`Recovery snapshot retained at ${snapshotPath}`);
  } catch (applyError) {
    console.error(`Safeguard apply failed: ${applyError.message}`);
    try {
      restoreSnapshot(frozen, { requireExactHead: false });
      console.error(`Previous live state restored and verified. Snapshot retained at ${snapshotPath}`);
    } catch (rollbackError) {
      console.error(`ROLLBACK FAILED: ${rollbackError.message}`);
      console.error(`Recover with: scripts/apply-repo-safeguards.mjs --restore ${snapshotPath}`);
    }
    throw applyError;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`apply-repo-safeguards: FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
