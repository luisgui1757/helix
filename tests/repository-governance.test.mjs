import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { repositoryPolicyFailures } from "../tools/repository-policy-check.mjs";
import { desiredState, validateSnapshotDocument } from "../scripts/apply-repo-safeguards.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("CI is least-privilege, deduplicated, dependency-reviewed, and exposes one stable objective", () => {
  const workflow = readFileSync(`${ROOT}/.github/workflows/ci.yml`, "utf8");
  const actionRefs = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+).*$/gm)].map((match) => match[1]);

  assert.deepEqual(actionRefs, [
    "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
  ]);
  assert.match(workflow, /^  push:\n    branches:\n      - main\n  pull_request:$/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /^concurrency:\n  group: .+\n  cancel-in-progress: true$/m);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /^  test_matrix:\n    name: test \(\$\{\{ matrix\.node-version \}\}, Pi \$\{\{ matrix\.pi-version \}\}\)$/m);
  assert.match(workflow, /^        node-version:\n          - 22\.19\.0\n          - 26\n        pi-version:\n          - 0\.80\.7\n          # renovate: .+\n          - 0\.80\.\d+$/m);
  assert.match(workflow, /^      - run: npm install --ignore-scripts --no-save @earendil-works\/pi-coding-agent@\$\{\{ matrix\.pi-version \}\}$/m);
  assert.match(workflow, /^  dependency_review:\n    name: dependency-review$/m);
  assert.match(workflow, /^  test:\n    name: test\n    if: \$\{\{ always\(\) \}\}\n    needs: \[test_matrix, dependency_review\]$/m);
  assert.match(workflow, /^          MATRIX_RESULT: \$\{\{ needs\.test_matrix\.result \}\}$/m);
  assert.match(workflow, /^          DEPENDENCY_REVIEW_RESULT: \$\{\{ needs\.dependency_review\.result \}\}$/m);
  assert.match(workflow, /^      - run: npm run check:package -- --pi-bin node_modules\/\.bin\/pi$/m);
});

test("Protect main keeps integrity unbypassable and all owner bypasses PR-only", () => {
  const integrity = JSON.parse(readFileSync(`${ROOT}/.github/rulesets/main-integrity.json`, "utf8"));
  const review = JSON.parse(readFileSync(`${ROOT}/.github/rulesets/main-review.json`, "utf8"));
  const ownerUpdates = JSON.parse(readFileSync(`${ROOT}/.github/rulesets/main-owner-updates.json`, "utf8"));
  const statusChecks = integrity.rules.find((rule) => rule.type === "required_status_checks");
  const codeScanning = integrity.rules.find((rule) => rule.type === "code_scanning");
  const pullRequest = review.rules.find((rule) => rule.type === "pull_request");

  assert.deepEqual(integrity.bypass_actors, []);
  assert.deepEqual(review.bypass_actors, [{
    actor_id: 139752288,
    actor_type: "User",
    bypass_mode: "pull_request",
  }]);
  assert.deepEqual(ownerUpdates.bypass_actors, review.bypass_actors);
  assert.deepEqual(integrity.conditions.ref_name, { exclude: [], include: ["~DEFAULT_BRANCH"] });
  assert.deepEqual(review.conditions.ref_name, { exclude: [], include: ["~DEFAULT_BRANCH"] });
  assert.deepEqual(integrity.rules.map((rule) => rule.type), [
    "pull_request",
    "required_status_checks",
    "code_scanning",
    "deletion",
    "non_fast_forward",
    "required_linear_history",
  ]);
  assert.deepEqual(review.rules.map((rule) => rule.type), ["pull_request"]);
  assert.equal(pullRequest.parameters.required_approving_review_count, 1);
  assert.equal(pullRequest.parameters.require_code_owner_review, true);
  assert.equal(pullRequest.parameters.require_last_push_approval, true);
  assert.equal(pullRequest.parameters.required_review_thread_resolution, true);
  assert.deepEqual(pullRequest.parameters.allowed_merge_methods, ["squash"]);
  assert.equal(statusChecks.parameters.strict_required_status_checks_policy, true);
  assert.deepEqual(statusChecks.parameters.required_status_checks, [{
    context: "test",
    integration_id: 15368,
  }]);
  assert.deepEqual(codeScanning.parameters.code_scanning_tools, [{
    tool: "CodeQL",
    alerts_threshold: "errors",
    security_alerts_threshold: "high_or_higher",
  }]);
  assert.deepEqual(ownerUpdates.rules, [{ type: "update" }]);
});

test("repository policy checker accepts the complete checked-in policy", () => {
  assert.deepEqual(repositoryPolicyFailures(ROOT), []);
});

test("manual safeguard recovery rejects malformed material before any live operation", () => {
  assert.throws(() => validateSnapshotDocument({
    schema: "helix-repository-safeguards-v1",
    repository: "luisgui1757/helix",
    head: "0".repeat(40),
    capturedAt: new Date(0).toISOString(),
    state: {},
    injected: true,
  }), /snapshot has an unexpected shape/);
});

test("manual safeguard recovery accepts only the reviewed legacy or canonical state", () => {
  const canonical = {
    schema: "helix-repository-safeguards-v1",
    repository: "luisgui1757/helix",
    head: "0".repeat(40),
    capturedAt: new Date(0).toISOString(),
    state: desiredState(),
  };
  assert.equal(validateSnapshotDocument(canonical), canonical);

  const legacy = structuredClone(canonical);
  legacy.state.repositorySettings.allow_auto_merge = true;
  legacy.state.rulesets[0].payload.rules = legacy.state.rulesets[0].payload.rules
    .filter((rule) => !["code_scanning", "pull_request"].includes(rule.type));
  legacy.state.rulesets[1].payload.rules[0].parameters.require_code_owner_review = false;
  legacy.state.rulesets[2].payload = null;
  assert.equal(validateSnapshotDocument(legacy), legacy);

  const weakened = structuredClone(canonical);
  weakened.state.actions.sha_pinning_required = false;
  assert.throws(() => validateSnapshotDocument(weakened), /safe pre-apply actions differs/);
});
