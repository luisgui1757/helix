import { test } from "node:test";
import assert from "node:assert/strict";
import { runDispatch } from "../dispatch/lib/orchestrate.mjs";
import { projectForVerification } from "../dispatch/lib/verification.mjs";
import { validateRunRecord } from "../dispatch/lib/run-record.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";

const NOW = 1_751_731_200; // fixed epoch seconds
const RUN_ID = "run-ver";

function passGate() {
  return { command_names: ["pr-gate", "checklist"], result: "pass", source: "deterministic-checker" };
}

// pr-preflight route: reviewer + redteam candidate panel + verifier (no judge/synth).
function preflightRequest(overrides = {}) {
  return {
    run_id: RUN_ID,
    task: { class_hint: "pr-preflight", confident: true },
    candidates: [
      { role: "reviewer", provider: "mock", model: "mock-model" },
      { role: "redteam", provider: "mock", model: "mock-model" },
    ],
    verification: { provider: "mock", model: "mock-verifier", rubric_id: "preflight-rubric-v1" },
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/ver", algorithm: null }],
    claims_ref: "local-ref:claims/ver",
    evidence_ref: "local-ref:evidence/ver",
    ...overrides,
  };
}

function verifierAdapter({ candidate, verifier } = {}) {
  const calls = { candidates: 0, verifiers: 0 };
  return {
    calls,
    runCandidate(spec) {
      calls.candidates += 1;
      return makeEnvelope({ run_id: RUN_ID, role: spec.role, provider: spec.provider, model: spec.model, ...(candidate?.(spec) ?? {}) });
    },
    runVerifier(input) {
      calls.verifiers += 1;
      return makeEnvelope({ run_id: RUN_ID, stage: "verification", role: "verifier", provider: "mock", model: "mock-verifier", ...(verifier?.(input) ?? {}) });
    },
  };
}

function verifierDeps(overrides = {}) {
  return { adapter: verifierAdapter(), runGate: passGate, now: NOW, mode: "tui", ...overrides };
}

test("the verifier runs after the objective gate and the record is valid", async () => {
  const adapter = verifierAdapter();
  const result = await runDispatch(preflightRequest(), verifierDeps({ adapter }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(adapter.calls.verifiers, 1, "verifier is called exactly once");
  // Only structural stable metadata is surfaced — never the verifier envelope.
  assert.deepEqual(result.verification, { rubric_id: "preflight-rubric-v1", status: "ok" });
  assert.ok(!("envelope" in result.verification), "verifier envelope must stay internal");
  assert.equal(result.record.gate.source, "deterministic-checker");
  assert.equal(validateRunRecord(result.record).valid, true);
  assert.ok(result.record.role_ids.includes("verifier"));
  assert.ok(result.record.model_ids.includes("mock-verifier"));
});

test("the verifier cannot turn a failed objective gate into success", async () => {
  // The verifier "approves" (positive content) but the objective gate failed.
  const adapter = verifierAdapter({ verifier: () => ({ status: "ok", recommendation: "approve-anyway" }) });
  const failingGate = () => ({ command_names: ["pr-gate"], result: "fail", source: "exit-status" });
  const result = await runDispatch(preflightRequest(), verifierDeps({ adapter, runGate: failingGate }));
  assert.equal(result.status, "blocked");
  assert.equal(result.ok, false);
  assert.equal(result.record.exit_status, "blocked");
  assert.equal(result.record.gate.result, "fail");
  assert.equal(adapter.calls.verifiers, 1, "verifier still ran and summarized the failed proof");
});

test("the verifier cannot turn a passed objective gate into failure", async () => {
  // The verifier "rejects" (status blocked) but the objective gate passed.
  const adapter = verifierAdapter({ verifier: () => ({ status: "blocked", recommendation: "reject" }) });
  const result = await runDispatch(preflightRequest(), verifierDeps({ adapter }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(result.record.exit_status, "ok");
  assert.equal(result.record.gate.result, "pass");
  // The verifier's advisory dissent is visible in the result but did NOT change the run.
  assert.equal(result.verification.status, "blocked");
});

test("a verifier route with no verification config fails closed", async () => {
  const request = preflightRequest();
  delete request.verification;
  const result = await runDispatch(request, verifierDeps());
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "missing-verification-config");
});

test("a verifier route with no runVerifier hook fails closed", async () => {
  const adapter = verifierAdapter();
  delete adapter.runVerifier;
  const result = await runDispatch(preflightRequest(), verifierDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "adapter-missing-run-verifier");
});

test("a claude-local verifier is refused before any adapter call (provider-not-automated)", async () => {
  const request = preflightRequest({ verification: { provider: "claude-local", model: "local-verifier", rubric_id: "preflight-rubric-v1" } });
  const adapter = verifierAdapter();
  const result = await runDispatch(request, verifierDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "verifier-not-eligible");
  assert.ok(result.warnings.includes("provider-not-automated:claude-local"));
  assert.equal(adapter.calls.candidates, 0, "no candidate launches when the verifier provider is not automatable");
  assert.equal(adapter.calls.verifiers, 0);
});

test("a malformed verifier envelope fails closed", async () => {
  const adapter = verifierAdapter();
  adapter.runVerifier = () => ({ not: "an-envelope" });
  const result = await runDispatch(preflightRequest(), verifierDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "verification-envelope-invalid");
});

test("a verifier envelope that does not match the vetted spec fails closed", async () => {
  const adapter = verifierAdapter();
  adapter.runVerifier = () => makeEnvelope({ run_id: RUN_ID, stage: "verification", role: "verifier", provider: "openrouter", model: "vendor/x:free" });
  const result = await runDispatch(preflightRequest(), verifierDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "verification-envelope-invalid");
  assert.match(result.detail, /provider/);
});

test("no verifier (or candidate) narrative text enters the run record OR the returned result", async () => {
  const adapter = verifierAdapter({
    candidate: () => ({ recommendation: "CAND-NARRATIVE-ZZZ" }),
    verifier: () => ({ recommendation: "VERIFIER-NARRATIVE-ZZZ", risks: ["verifier-risk-zzz"], open_questions: ["verifier-oq-zzz"] }),
  });
  const result = await runDispatch(preflightRequest(), verifierDeps({ adapter }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  const recordBlob = JSON.stringify(result.record);
  assert.ok(!recordBlob.includes("VERIFIER-NARRATIVE-ZZZ"), "verifier recommendation must not enter the record");
  assert.ok(!recordBlob.includes("verifier-risk-zzz"), "verifier risk text must not enter the record");
  assert.ok(!recordBlob.includes("CAND-NARRATIVE-ZZZ"), "candidate narrative must not enter the record");
  // The returned result.verification must expose only structural stable metadata —
  // no verifier envelope, recommendation, risks, or open questions.
  const verBlob = JSON.stringify(result.verification);
  assert.deepEqual(Object.keys(result.verification).sort(), ["rubric_id", "status"]);
  assert.ok(!verBlob.includes("VERIFIER-NARRATIVE-ZZZ"), "verifier recommendation must not appear in result.verification");
  assert.ok(!verBlob.includes("verifier-risk-zzz"), "verifier risk text must not appear in result.verification");
  assert.ok(!verBlob.includes("verifier-oq-zzz"), "verifier open-question text must not appear in result.verification");
});

test("the recorded gate source stays deterministic — the verifier cannot set it", async () => {
  // The verifier's narrative claims a 'model' verdict; the recorded gate source
  // comes only from the objective gate outcome.
  const adapter = verifierAdapter({ verifier: () => ({ recommendation: "source: model, verdict: pass" }) });
  const result = await runDispatch(preflightRequest(), verifierDeps({ adapter }));
  assert.equal(result.record.gate.source, "deterministic-checker");
  assert.ok(["exit-status", "deterministic-checker", "advisory"].includes(result.record.gate.source));
});

test("a route without a verifier role does not run verification", async () => {
  const request = preflightRequest({
    task: { class_hint: "routine-code", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
  });
  const adapter = verifierAdapter();
  const result = await runDispatch(request, verifierDeps({ adapter }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(adapter.calls.verifiers, 0);
  assert.equal(result.verification, null);
  assert.ok(result.warnings.includes("verification-config-ignored-no-verifier-role"));
});

// --- verification.mjs substrate unit -----------------------------------------

test("projectForVerification builds a structural proof summary with no narrative or cap fields", () => {
  const gate = { command_names: ["pr-gate"], kind: "objective", result: "pass", source: "deterministic-checker" };
  const input = projectForVerification({
    exit_status: "ok", gate, warning_codes: ["w1"],
    claims_ref: "local-ref:c", evidence_ref: "local-ref:e",
  });
  assert.equal(input.exit_status, "ok");
  assert.deepEqual(input.gate.command_names, ["pr-gate"]);
  assert.equal(input.gate.source, "deterministic-checker");
  assert.deepEqual(input.warning_codes, ["w1"]);
  assert.equal(input.claims_ref, "local-ref:c");
  assert.equal(input.evidence_ref, "local-ref:e");
  // structural only — no role-output narrative keys, no removed cap projection
  assert.ok(!("recommendation" in input) && !("risks" in input));
  assert.ok(!("cap_status" in input), "cap_status left the harness with cost control");
  // null gate handled
  assert.equal(projectForVerification({ exit_status: "ok", gate: null }).gate, null);
});

// --- the verifier proof input in a live dispatch stays structural ---------------

test("the verifier proof input carries exactly gate/exit/warnings/refs (parallel launch included)", async () => {
  let capturedInput;
  const adapter = verifierAdapter({ verifier: (input) => { capturedInput = input; return {}; } });
  const result = await runDispatch(preflightRequest(), verifierDeps({ adapter, parallel: { max_concurrency: 2 } }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.deepEqual(
    Object.keys(capturedInput).sort(),
    ["claims_ref", "evidence_ref", "exit_status", "gate", "warning_codes"],
    "no cap/cost projection reaches the verifier",
  );
  assert.equal(capturedInput.exit_status, "ok");
  assert.equal(capturedInput.gate.result, "pass");
  assert.equal(capturedInput.claims_ref, "local-ref:claims/ver");
  assert.equal(capturedInput.evidence_ref, "local-ref:evidence/ver");
});
