import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("CI exposes one stable test check after the complete Node and Pi matrix", () => {
  const workflow = readFileSync(`${ROOT}/.github/workflows/ci.yml`, "utf8");

  assert.match(workflow, /^  test_matrix:\n    name: test \(\$\{\{ matrix\.node-version \}\}, Pi \$\{\{ matrix\.pi-version \}\}\)$/m);
  assert.match(workflow, /^        node-version:\n          - 22\.19\.0\n          - 26\n        pi-version:\n          - 0\.80\.7\n          - 0\.80\.9$/m);
  assert.match(workflow, /^      - run: npm install --ignore-scripts --no-save @earendil-works\/pi-coding-agent@\$\{\{ matrix\.pi-version \}\}$/m);
  assert.match(workflow, /^  test:\n    name: test\n    if: \$\{\{ always\(\) \}\}\n    needs: test_matrix$/m);
  assert.match(workflow, /^          MATRIX_RESULT: \$\{\{ needs\.test_matrix\.result \}\}$/m);
  assert.match(workflow, /^        run: test "\$MATRIX_RESULT" = success$/m);
  assert.match(workflow, /^      - run: npm run check:package -- --pi-bin node_modules\/\.bin\/pi$/m);
});

test("Protect main keeps integrity unbypassable and review bypass owner-only", () => {
  const integrity = JSON.parse(readFileSync(`${ROOT}/.github/rulesets/main-integrity.json`, "utf8"));
  const review = JSON.parse(readFileSync(`${ROOT}/.github/rulesets/main-review.json`, "utf8"));
  const statusChecks = integrity.rules.find((rule) => rule.type === "required_status_checks");
  const pullRequest = review.rules.find((rule) => rule.type === "pull_request");

  assert.deepEqual(integrity.bypass_actors, []);
  assert.deepEqual(review.bypass_actors, [{
    actor_id: 139752288,
    actor_type: "User",
    bypass_mode: "pull_request",
  }]);
  assert.deepEqual(integrity.conditions.ref_name, { exclude: [], include: ["~DEFAULT_BRANCH"] });
  assert.deepEqual(review.conditions.ref_name, { exclude: [], include: ["~DEFAULT_BRANCH"] });
  assert.deepEqual(integrity.rules.map((rule) => rule.type), [
    "deletion",
    "non_fast_forward",
    "required_linear_history",
    "required_status_checks",
  ]);
  assert.deepEqual(review.rules.map((rule) => rule.type), ["pull_request"]);
  assert.equal(pullRequest.parameters.required_approving_review_count, 1);
  assert.equal(pullRequest.parameters.require_last_push_approval, true);
  assert.equal(pullRequest.parameters.required_review_thread_resolution, true);
  assert.deepEqual(pullRequest.parameters.allowed_merge_methods, ["squash"]);
  assert.equal(statusChecks.parameters.strict_required_status_checks_policy, true);
  assert.deepEqual(statusChecks.parameters.required_status_checks, [{
    context: "test",
    integration_id: 15368,
  }]);
});
