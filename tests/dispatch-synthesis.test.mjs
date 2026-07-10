import { test } from "node:test";
import assert from "node:assert/strict";
import { runDispatch } from "../dispatch/lib/orchestrate.mjs";
import { detectContradictions, contradictionsDropped, projectForSynthesis } from "../dispatch/lib/synthesis.mjs";
import { validateRunRecord } from "../dispatch/lib/run-record.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";

const NOW = 1_751_731_200; // fixed epoch seconds
const RUN_ID = "run-syn";
const CONTRADICTION = "contradicts-planner-recommendation";

function passGate() {
  return { command_names: ["mock-objective-gate"], result: "pass", source: "deterministic-checker" };
}

// roadmap-reconciliation route: planner+reviewer panel, judge, synthesizer.
function synthesisRequest(overrides = {}) {
  return {
    run_id: RUN_ID,
    task: { class_hint: "roadmap-reconciliation", confident: true },
    candidates: [
      { role: "planner", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
    judge: { provider: "mock", model: "mock-judge", rubric_id: "recon-rubric-v1" },
    synthesis: { provider: "mock", model: "mock-synth", rubric_id: "recon-rubric-v1" },
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/syn", algorithm: null }],
    claims_ref: "local-ref:claims/syn",
    evidence_ref: "local-ref:evidence/syn",
    ...overrides,
  };
}

function synthAdapter({ candidate, synthesis } = {}) {
  const calls = { candidates: 0, judges: 0, synthesis: 0 };
  return {
    calls,
    runCandidate(spec) {
      calls.candidates += 1;
      return makeEnvelope({ run_id: RUN_ID, role: spec.role, provider: spec.provider, model: spec.model, ...(candidate?.(spec) ?? {}) });
    },
    runJudge() {
      calls.judges += 1;
      return makeEnvelope({ run_id: RUN_ID, stage: "judge", role: "judge", provider: "mock", model: "mock-judge" });
    },
    runSynthesis(input) {
      calls.synthesis += 1;
      return makeEnvelope({ run_id: RUN_ID, stage: "synthesis", role: "synthesizer", provider: "mock", model: "mock-synth", ...(synthesis?.(input) ?? {}) });
    },
  };
}

function synthDeps(overrides = {}) {
  return { adapter: synthAdapter(), runGate: passGate, now: NOW, seed: 7, mode: "tui", ...overrides };
}

test("synthesis success path: the synthesizer runs after the judge and the record is valid", async () => {
  const adapter = synthAdapter();
  const result = await runDispatch(synthesisRequest(), synthDeps({ adapter }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(adapter.calls.synthesis, 1, "synthesis adapter is called exactly once");
  assert.equal(result.synthesis.envelope.stage, "synthesis");
  assert.equal(result.synthesis.envelope.role, "synthesizer");
  assert.equal(result.synthesis.contradiction_count, 0);
  assert.equal(validateRunRecord(result.record).valid, true);
  assert.ok(result.record.provider_ids.includes("mock"));
  assert.ok(result.record.model_ids.includes("mock-synth"));
});

test("a malformed synthesis envelope fails closed before it can affect the record", async () => {
  const adapter = synthAdapter();
  adapter.runSynthesis = () => ({ not: "an-envelope" });
  const result = await runDispatch(synthesisRequest(), synthDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "synthesis-envelope-invalid");
  assert.equal(result.record.exit_status, "fail-closed");
});

test("a synthesis envelope that does not match the vetted spec fails closed", async () => {
  const adapter = synthAdapter();
  adapter.runSynthesis = () => makeEnvelope({ run_id: RUN_ID, stage: "synthesis", role: "synthesizer", provider: "openrouter", model: "vendor/x:free" });
  const result = await runDispatch(synthesisRequest(), synthDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "synthesis-envelope-invalid");
  assert.match(result.detail, /provider/);
});

test("a synthesizer route with no runSynthesis hook fails closed", async () => {
  const adapter = synthAdapter();
  delete adapter.runSynthesis;
  const result = await runDispatch(synthesisRequest(), synthDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "adapter-missing-run-synthesis");
});

test("a synthesizer route with no synthesis config fails closed", async () => {
  const request = synthesisRequest();
  delete request.synthesis;
  const result = await runDispatch(request, synthDeps());
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "missing-synthesis-config");
});

test("synthesis preserves an unresolved candidate contradiction structurally", async () => {
  const adapter = synthAdapter({
    candidate: (spec) => (spec.role === "reviewer" ? { risks: [CONTRADICTION] } : {}),
    synthesis: () => ({ open_questions: [CONTRADICTION], recommendation: "hold-pending-evidence" }),
  });
  const result = await runDispatch(synthesisRequest(), synthDeps({ adapter }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(result.synthesis.contradiction_count, 1);
  assert.equal(result.synthesis.contradictions_preserved, true);
  assert.ok(result.record.warning_codes.includes("contradiction-preserved"));
});

test("synthesis that averages away a contradiction fails closed", async () => {
  const adapter = synthAdapter({
    candidate: (spec) => (spec.role === "reviewer" ? { risks: [CONTRADICTION] } : {}),
    synthesis: () => ({ recommendation: "merge-both-views", risks: [], open_questions: [] }),
  });
  const result = await runDispatch(synthesisRequest(), synthDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "synthesis-dropped-contradiction");
  assert.ok(result.warnings.includes("synthesis-dropped-contradiction"));
});

test("judge and synthesis stay advisory: a failed objective gate still blocks", async () => {
  const failing = synthDeps({ runGate: () => ({ command_names: ["roadmap-consistency-check"], result: "fail", source: "deterministic-checker" }) });
  const result = await runDispatch(synthesisRequest(), failing);
  assert.equal(result.status, "blocked");
  assert.equal(result.ok, false);
  assert.equal(result.record.exit_status, "blocked");
  assert.equal(result.record.gate.result, "fail");
  // synthesis still ran and is reported, but it did not decide success.
  assert.ok(result.synthesis);
});

test("a route without a synthesizer role does not run synthesis", async () => {
  const request = synthesisRequest({
    task: { class_hint: "routine-code", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
  });
  delete request.judge; // routine-code has neither judge nor synthesizer
  const adapter = synthAdapter();
  const result = await runDispatch(request, synthDeps({ adapter }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(adapter.calls.synthesis, 0);
  assert.equal(result.synthesis, null);
  assert.ok(result.warnings.includes("synthesis-config-ignored-no-synthesizer-role"));
});

test("no candidate/judge/synthesis narrative text enters the public run record", async () => {
  const adapter = synthAdapter({
    candidate: () => ({ recommendation: "CANDIDATE-NARRATIVE-XYZ", risks: ["risk-narrative-abc"] }),
    synthesis: () => ({ recommendation: "SYNTH-NARRATIVE-XYZ" }),
  });
  const result = await runDispatch(synthesisRequest(), synthDeps({ adapter }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  const blob = JSON.stringify(result.record);
  assert.ok(!blob.includes("CANDIDATE-NARRATIVE-XYZ"), "candidate recommendation text must not enter the record");
  assert.ok(!blob.includes("SYNTH-NARRATIVE-XYZ"), "synthesis recommendation text must not enter the record");
  assert.ok(!blob.includes("risk-narrative-abc"), "candidate risk text must not enter the record");
});

// --- pre-launch singleton provider gate (structural, not cost) -----------------
// The only provider gate left is isAutomatedDispatchProvider: claude-local stays
// excluded from automated dispatch. A doomed judge/synthesis spec must stop the
// run before ANY adapter call — candidates included.

function codexReconRequest(overrides = {}) {
  return {
    run_id: RUN_ID,
    task: { class_hint: "roadmap-reconciliation", confident: true },
    candidates: [
      { role: "planner", provider: "openai-codex", model: "codex-model" },
      { role: "reviewer", provider: "openai-codex", model: "codex-model" },
      { role: "reviewer", provider: "openai-codex", model: "codex-model" },
    ],
    judge: { provider: "openai-codex", model: "codex-judge", rubric_id: "recon-rubric-v1" },
    synthesis: { provider: "openai-codex", model: "codex-synth", rubric_id: "recon-rubric-v1" },
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/syn", algorithm: null }],
    claims_ref: "local-ref:claims/syn",
    evidence_ref: "local-ref:evidence/syn",
    ...overrides,
  };
}

function codexAdapter(request) {
  const j = request.judge, s = request.synthesis;
  const calls = { candidates: 0, judges: 0, synthesis: 0 };
  return {
    calls,
    runCandidate(spec) { calls.candidates += 1; return makeEnvelope({ run_id: RUN_ID, role: spec.role, provider: spec.provider, model: spec.model }); },
    runJudge() { calls.judges += 1; return makeEnvelope({ run_id: RUN_ID, stage: "judge", role: "judge", provider: j.provider, model: j.model }); },
    runSynthesis() { calls.synthesis += 1; return makeEnvelope({ run_id: RUN_ID, stage: "synthesis", role: "synthesizer", provider: s.provider, model: s.model }); },
  };
}

test("a claude-local judge fails closed before any adapter call", async () => {
  const request = codexReconRequest({ judge: { provider: "claude-local", model: "local-judge", rubric_id: "recon-rubric-v1" } });
  const adapter = codexAdapter(request);
  const result = await runDispatch(request, synthDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "judge-not-eligible");
  assert.ok(result.warnings.includes("provider-not-automated:claude-local"));
  assert.equal(adapter.calls.candidates, 0, "no candidate launches when the judge provider is not automatable");
  assert.equal(adapter.calls.judges, 0);
  assert.equal(adapter.calls.synthesis, 0);
});

test("a claude-local synthesizer fails closed before any adapter call", async () => {
  const request = codexReconRequest({ synthesis: { provider: "claude-local", model: "local-synth", rubric_id: "recon-rubric-v1" } });
  const adapter = codexAdapter(request);
  const result = await runDispatch(request, synthDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "synthesis-not-eligible");
  assert.ok(result.warnings.includes("provider-not-automated:claude-local"));
  assert.equal(adapter.calls.candidates, 0);
  assert.equal(adapter.calls.judges, 0);
  assert.equal(adapter.calls.synthesis, 0);
});

test("automated (non-mock) judge + synthesis providers pass the structural gate and launch", async () => {
  const request = codexReconRequest();
  const adapter = codexAdapter(request);
  const result = await runDispatch(request, synthDeps({ adapter }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(adapter.calls.candidates, 3);
  assert.equal(adapter.calls.judges, 1);
  assert.equal(adapter.calls.synthesis, 1);
});

// --- synthesis.mjs substrate units -------------------------------------------

test("detectContradictions collects flagged markers in order, de-duplicated", () => {
  const envs = [
    makeEnvelope({ role: "planner", open_questions: ["needs-evidence"] }),
    makeEnvelope({ role: "reviewer", risks: ["contradicts-A", "unrelated"], uncertainty: ["contradicts-A"] }),
  ];
  assert.deepEqual(detectContradictions(envs), ["contradicts-A"]);
  assert.deepEqual(detectContradictions([]), []);
});

test("contradictionsDropped reports markers the synthesis output failed to carry", () => {
  const synth = makeEnvelope({ stage: "synthesis", role: "synthesizer", open_questions: ["contradicts-A"] });
  assert.deepEqual(contradictionsDropped(["contradicts-A", "contradicts-B"], synth), ["contradicts-B"]);
  assert.deepEqual(contradictionsDropped(["contradicts-A"], synth), []);
});

test("projectForSynthesis strips identity/cost and keeps substantive fields", () => {
  const candidates = [makeEnvelope({ role: "planner", provider: "openrouter", model: "vendor/y:free", recommendation: "plan-A" })];
  const judge = makeEnvelope({ stage: "judge", role: "judge", provider: "mock", model: "mock-judge", recommendation: "A-stronger" });
  const input = projectForSynthesis(candidates, judge, { rubric_id: "r1", contradictions: ["contradicts-A"] });
  assert.equal(input.rubric_id, "r1");
  assert.deepEqual(input.contradictions, ["contradicts-A"]);
  const summary = input.candidate_summaries[0];
  assert.equal(summary.recommendation, "plan-A");
  assert.ok(!("provider" in summary) && !("model" in summary) && !("usage" in summary) && !("cost_class" in summary));
  assert.equal(input.judge_summary.recommendation, "A-stronger");
  assert.ok(!("provider" in input.judge_summary));
  // no candidates → fail closed
  assert.throws(() => projectForSynthesis([], null, {}));
});

test("projectForSynthesis judge_summary is null when no judge ran", () => {
  const input = projectForSynthesis([makeEnvelope({ role: "builder" })], null, {});
  assert.equal(input.judge_summary, null);
});
