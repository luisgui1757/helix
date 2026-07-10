import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRunRecord,
  writeRunRecord,
  validateRunRecord,
  stableStringify,
  hashRef,
} from "../dispatch/lib/run-record.mjs";

function makeInput(overrides = {}) {
  return {
    run_id: "run-1",
    timestamp: "2026-07-05T00:00:00Z",
    task_class: "routine-code",
    route_id: "routine-code",
    role_ids: ["builder", "reviewer"],
    provider_ids: ["mock"],
    model_ids: ["mock-model"],
    usage_rollup: { input_tokens: 30, output_tokens: 40 },
    iteration_count: 1,
    exit_status: "ok",
    gate: { command_names: ["npm-test"], kind: "objective", result: "pass", source: "exit-status" },
    warning_codes: [],
    judge: null,
    input_refs: [{ kind: "local-ref", value: "local-ref:input/x", algorithm: null }],
    claims_ref: "local-ref:claims/x",
    evidence_ref: "local-ref:evidence/x",
    run_target: { repo: "self" },
    branch: "stage3/dispatch-policy-core",
    gate_file_paths: ["tools/ship/pr-gate.sh"],
    ...overrides,
  };
}

test("a valid self-target record keeps branch and gate paths in the clear", () => {
  const rec = buildRunRecord(makeInput());
  assert.equal(rec.schema_version, 2);
  assert.equal(rec.branch, "stage3/dispatch-policy-core");
  assert.deepEqual(rec.gate_file_paths, ["tools/ship/pr-gate.sh"]);
  assert.equal(validateRunRecord(rec).valid, true);
});

test("an other-repo target hashes the branch and gate paths", () => {
  const rec = buildRunRecord(makeInput({
    run_target: { repo: "other" },
    branch: "feature/secret-thing",
    gate_file_paths: ["private/path/to/gate.sh"],
  }));
  assert.match(rec.branch, /^sha256:[0-9a-f]{64}$/);
  assert.equal(rec.branch, hashRef("feature/secret-thing"));
  for (const p of rec.gate_file_paths) assert.match(p, /^sha256:[0-9a-f]{64}$/);
});

test("raw text in an input_ref value is rejected (inputs enter only as refs/hashes)", () => {
  assert.throws(
    () => buildRunRecord(makeInput({ input_refs: [{ kind: "sha256", value: "raw private prompt contents here", algorithm: "sha256" }] })),
    /ref\/hash, not free text/,
  );
});

test("input_ref value must match its declared kind", () => {
  // local-ref kind with a non-ref value:
  assert.throws(
    () => buildRunRecord(makeInput({ input_refs: [{ kind: "local-ref", value: "just some words", algorithm: null }] })),
    /ref\/hash, not free text/,
  );
  // a well-formed sha256 hash is accepted:
  const hex = "a".repeat(64);
  const rec = buildRunRecord(makeInput({ input_refs: [{ kind: "sha256", value: `sha256:${hex}`, algorithm: "sha256" }] }));
  assert.equal(rec.input_refs[0].value, `sha256:${hex}`);
});

test("local and redacted refs must be opaque or relative, never root-shaped", () => {
  for (const value of ["local-ref:/root", "local-ref:../escape", "redacted-id:/root"]) {
    assert.throws(
      () => buildRunRecord(makeInput({
        input_refs: [{ kind: value.startsWith("local-ref") ? "local-ref" : "redacted-id", value, algorithm: null }],
      })),
      /ref\/hash|validation error|public-safety/,
      value,
    );
  }
  assert.throws(() => buildRunRecord(makeInput({ claims_ref: "local-ref:/root" })), /ref\/hash/);
  assert.throws(() => buildRunRecord(makeInput({ evidence_ref: "redacted-id:../escape" })), /ref\/hash/);
});

test("a sha256 input ref must record algorithm 'sha256', not null", () => {
  const hex = "b".repeat(64);
  assert.throws(
    () => buildRunRecord(makeInput({ input_refs: [{ kind: "sha256", value: `sha256:${hex}`, algorithm: null }] })),
    /algorithm.*must be "sha256"/,
  );
  // and a non-hash ref must record null, not "sha256":
  assert.throws(
    () => buildRunRecord(makeInput({ input_refs: [{ kind: "local-ref", value: "local-ref:input/x", algorithm: "sha256" }] })),
    /algorithm.*must be null/,
  );
});

test("free-text claims/evidence refs are rejected", () => {
  assert.throws(() => buildRunRecord(makeInput({ claims_ref: "we found three problems in the auth flow" })), /ref\/hash/);
  assert.throws(() => buildRunRecord(makeInput({ evidence_ref: "see the transcript" })), /ref\/hash/);
});

test("negative token rollups are rejected", () => {
  for (const field of ["input_tokens", "output_tokens"]) {
    assert.throws(
      () => buildRunRecord(makeInput({ usage_rollup: { input_tokens: 1, output_tokens: 1, [field]: -1 } })),
      /validation error/,
      field,
    );
  }
});

test("a legacy cost-accounting usage_rollup fails closed (schema_version 2 is tokens-only)", () => {
  for (const field of ["cost_estimate_usd", "cost_actual_usd", "usd_spent"]) {
    assert.throws(
      () => buildRunRecord(makeInput({ usage_rollup: { input_tokens: 1, output_tokens: 1, [field]: 0 } })),
      new RegExp(`usage_rollup\\.${field}.*not an allowed property`),
      field,
    );
  }
});

test("a model-narrative gate source is not schema-allowed (gate ⇐ exit status only)", () => {
  assert.throws(() => buildRunRecord(makeInput({
    gate: { command_names: ["npm-test"], kind: "objective", result: "pass", source: "model" },
  })));
});

test("generic prose is rejected from every persisted identifier/code surface", () => {
  const cases = [
    { task_class: "ordinary task prose" },
    { route_id: "ordinary route prose" },
    { model_ids: ["ordinary model response"] },
    { warning_codes: ["ordinary warning prose"] },
    { gate: { command_names: ["npm test"], kind: "objective", result: "pass", source: "exit-status" } },
  ];
  for (const overrides of cases) {
    assert.throws(() => buildRunRecord(makeInput(overrides)), /validation error/, JSON.stringify(overrides));
  }
});

// These two synthetic leak samples are assembled from split literals so the
// repository's own public-safety scanners (tools/ship/pr-gate.sh,
// tools/check-prime-resources.mjs) don't false-positive on a test fixture; the
// scanner under test still receives the fully-formed value at runtime.
test("the public-safety scan fails closed on a home path", () => {
  const paths = [
    "/Us" + "ers/someone/topsecret",
    "/ho" + "me/someone/topsecret",
    "C:" + "\\Us" + "ers\\someone\\topsecret",
  ];
  for (const homePath of paths) {
    assert.throws(() => buildRunRecord(makeInput({ branch: homePath })), /public-safety scan failed/, homePath);
  }
});

test("the public-safety scan fails closed on a session URL", () => {
  const sessionUrl = "https://claude" + ".ai/code/abc";
  assert.throws(() => buildRunRecord(makeInput({ model_ids: [sessionUrl] })), /public-safety scan failed/);
});

test("model fields reject arbitrary web URLs, not only known session hosts", () => {
  const webModel = "https:" + "//example.com/shared/session";
  assert.throws(() => buildRunRecord(makeInput({ model_ids: [webModel] })), /public-safety|validation error/);
  const domainPath = "example" + ".com/shared/session";
  assert.throws(() => buildRunRecord(makeInput({ model_ids: [domainPath] })), /public-safety|validation error/);
});

test("the public-safety scan catches hyphen-prefixed provider keys (sk-proj-/sk-live-)", () => {
  // Split literals so the repo's own scanners don't self-match these test samples.
  const body = "0123456789abcdefghij0123";
  for (const key of ["sk-" + "proj-" + body, "sk-" + "live-" + body, "sk-" + "ant-api03-" + body]) {
    assert.throws(() => buildRunRecord(makeInput({ model_ids: [key] })), /public-safety scan failed/, key);
  }
});

test("serialization is deterministic (sorted keys)", () => {
  const a = stableStringify(buildRunRecord(makeInput()));
  const b = stableStringify(buildRunRecord(makeInput()));
  assert.equal(a, b);
  assert.equal(a, stableStringify(JSON.parse(a)));
});

test("judge blinding fields round-trip through the record", () => {
  const rec = buildRunRecord(makeInput({
    judge: {
      seed: 7,
      permutation: [1, 0],
      blinding: true,
      rubric_id: "code-review-rubric-v1",
      label_reveal_events: [],
      judge_in_panel: false,
    },
  }));
  assert.equal(rec.judge.rubric_id, "code-review-rubric-v1");
  assert.deepEqual(rec.judge.permutation, [1, 0]);
});

test("built records are detached and recursively frozen", () => {
  const input = makeInput({
    judge: {
      seed: 7,
      permutation: [1, 0],
      blinding: true,
      rubric_id: "code-review-rubric-v1",
      label_reveal_events: [{ key: "candidate-a", field: "provider", reason: "conflict-check" }],
      judge_in_panel: false,
    },
  });
  const rec = buildRunRecord(input);
  for (const value of [
    rec,
    rec.usage_rollup,
    rec.gate,
    rec.gate.command_names,
    rec.judge,
    rec.judge.permutation,
    rec.judge.label_reveal_events,
    rec.judge.label_reveal_events[0],
    rec.input_refs,
    rec.input_refs[0],
    rec.run_target,
    rec.gate_file_paths,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }

  input.gate.command_names[0] = "mutated-source";
  input.input_refs[0].value = "local-ref:input/mutated";
  assert.deepEqual(rec.gate.command_names, ["npm-test"]);
  assert.equal(rec.input_refs[0].value, "local-ref:input/x");
  assert.throws(() => rec.gate.command_names.push("another-command"), TypeError);
});

test("writeRunRecord persists a deterministic file named by run_id", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-runrec-"));
  const rec = buildRunRecord(makeInput());
  const path = writeRunRecord(rec, dir);
  assert.equal(path, join(dir, "run-1.json"));
  const onDisk = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(onDisk.run_id, "run-1");
  assert.equal(validateRunRecord(onDisk).valid, true);
});

test("writeRunRecord refuses an unsafe run_id filename", () => {
  const rec = buildRunRecord(makeInput());
  const unsafe = { ...rec, run_id: "../escape" };
  assert.throws(() => writeRunRecord(unsafe, tmpdir()), /safe filename/);
});

test("writeRunRecord revalidates a caller-supplied clone before persistence", () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-runrec-revalidate-"));
  const invalid = JSON.parse(JSON.stringify(buildRunRecord(makeInput())));
  invalid.warning_codes = ["ordinary model prose"];
  assert.throws(() => writeRunRecord(invalid, dir), /validation error/);
  assert.equal(existsSync(join(dir, "run-1.json")), false);
});
