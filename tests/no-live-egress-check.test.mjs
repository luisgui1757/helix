import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNoLiveEgress } from "../tools/ci/no-live-egress-check.mjs";

function fixtureRoot({
  workflow = "name: CI\njobs:\n  test:\n    steps:\n      - run: npm test\n",
  script = "node --test tests/*.test.mjs",
  configId = "mock-core-loop",
  configMatrixId = "mock-core-loop",
  matrixProvider = "mock",
  presetProvider = "mock",
  dispatchLibFiles = {},
  dispatchFiles = {},
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "prime-egress-check-"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, "dispatch/config"), { recursive: true });
  mkdirSync(join(root, "dispatch/config/matrices"), { recursive: true });
  mkdirSync(join(root, "dispatch/lib"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: script } }), "utf8");
  writeFileSync(join(root, ".github/workflows/ci.yml"), workflow, "utf8");
  writeFileSync(join(root, "dispatch/config/run-configs.json"), JSON.stringify({
    schema_version: 2,
    configs: [{
      id: configId,
      role_matrix: configMatrixId,
      assignments: { plan: { kind: "composite", preset: "daily" } },
      default_assignment: { kind: "composite", preset: "daily" },
    }],
  }), "utf8");
  writeFileSync(join(root, "dispatch/config/role-matrix-defaults.json"), JSON.stringify({
    schema_version: 1,
    matrix_id: "mock-core-loop",
    roles: {
      builder: [{ provider: matrixProvider, model: "mock-builder", effort: "default", instances: 1 }],
      reviewer: [{ provider: "mock", model: "mock-reviewer", effort: "default", instances: 1 }],
    },
  }), "utf8");
  writeFileSync(join(root, "dispatch/config/matrices/daily.json"), JSON.stringify({
    schema_version: 1,
    preset_id: "daily",
    roles: {
      builder: [{ provider: presetProvider, model: "daily-builder", effort: "default", instances: 1 }],
      reviewer: [{ provider: "mock", model: "daily-reviewer", effort: "default", instances: 1 }],
    },
  }), "utf8");
  for (const [rel, text] of Object.entries(dispatchLibFiles)) {
    const path = join(root, "dispatch/lib", rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  }
  for (const [rel, text] of Object.entries(dispatchFiles)) {
    const path = join(root, "dispatch", rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  }
  return root;
}

function withFixture(options, fn) {
  const root = fixtureRoot(options);
  try {
    fn(checkNoLiveEgress({ root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("no-live egress check passes CI-safe scripts and an all-mock CI config", () => {
  withFixture({}, (result) => {
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(result.findings, []);
  });
});

test("no-live egress check fails when the CI-exercised mock config is missing", () => {
  withFixture({ configId: "some-other-config" }, (result) => {
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) => finding.code === "ci-config-missing"));
  });
});

test("no-live egress check fails when the CI config role matrix does not resolve", () => {
  withFixture({ configMatrixId: "unresolved-matrix" }, (result) => {
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) => finding.code === "ci-config-matrix-unresolved"));
  });
});

test("no-live egress check fails when a real provider enters the CI role matrix", () => {
  withFixture({ matrixProvider: "openrouter" }, (result) => {
    assert.equal(result.ok, false);
    const finding = result.findings.find((entry) => entry.code === "ci-matrix-provider-not-mock");
    assert.ok(finding);
    assert.equal(finding.label, "role-matrix:mock-core-loop:builder");
  });
});

test("no-live egress check resolves staged presets and rejects their real providers", () => {
  withFixture({ presetProvider: "openrouter" }, (result) => {
    assert.equal(result.ok, false);
    const finding = result.findings.find((entry) => entry.code === "ci-effective-provider-not-mock");
    assert.ok(finding);
    assert.equal(finding.label, "preset:daily:builder");
  });
});

test("no-live egress check fails when removed cost-control identifiers reappear in dispatch", () => {
  withFixture({
    dispatchLibFiles: {
      "legacy.mjs": "export const config = { token_budget: 1000, write_allowlist: ['proposal.txt'] };\n",
    },
  }, (result) => {
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) =>
      finding.code === "removed-cost-identifier:token_budget" && finding.label === "dispatch/lib/legacy.mjs"));
    assert.ok(result.findings.some((finding) => finding.code === "removed-cost-identifier:write_allowlist"));
  });
});

test("removed cost-control identifiers are scanned across dispatch, not only dispatch/lib", () => {
  withFixture({
    dispatchFiles: {
      "config/nested/legacy.yaml": "policy:\n  confirm_threshold_usd: 1\n",
      "docs/legacy.md": "The removed price_ttl_seconds field must not return.\n",
    },
  }, (result) => {
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) =>
      finding.code === "removed-cost-identifier:confirm_threshold_usd"
      && finding.label === "dispatch/config/nested/legacy.yaml"));
    assert.ok(result.findings.some((finding) =>
      finding.code === "removed-cost-identifier:price_ttl_seconds"
      && finding.label === "dispatch/docs/legacy.md"));
  });
});

test("no-live egress check rejects workflow provider env and live smoke scripts", () => {
  withFixture({
    workflow: "name: CI\njobs:\n  test:\n    steps:\n      - run: OPENROUTER_API_KEY=x tools/smoke/openrouter-free-smoke.sh\n",
    script: "tools/smoke/openrouter-free-revision-smoke.mjs",
  }, (result) => {
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) => finding.code === "provider-env-openrouter"));
    assert.ok(result.findings.some((finding) => finding.code === "live-openrouter-smoke"));
    assert.ok(result.findings.some((finding) => finding.code === "live-smoke-script"));
  });
});

test("no-live egress check rejects every workflow secret reference", () => {
  const secretReference = "$" + "{{ secrets.PRIME_PROVIDER_TOKEN }}";
  withFixture({
    workflow: `name: CI\njobs:\n  test:\n    steps:\n      - run: echo ${secretReference}\n`,
  }, (result) => {
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) => finding.code === "workflow-secret-reference"));
  });
});
