import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDispatch, seededPermutation } from "../dispatch/lib/orchestrate.mjs";
import { validateRunRecord, stableStringify } from "../dispatch/lib/run-record.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";
import { ROUTES } from "../dispatch/lib/routes.mjs";

const NOW = 1_751_731_200; // fixed epoch seconds
const RUN_ID = "run-orc";

function mockAdapter(perRole = {}) {
  const calls = { candidates: 0, judges: 0, synthesis: 0, verifiers: 0 };
  return {
    calls,
    runCandidate(spec) {
      calls.candidates += 1;
      const override = perRole[spec.role];
      if (typeof override === "function") return override(spec);
      return makeEnvelope({ run_id: RUN_ID, role: spec.role, provider: spec.provider, model: spec.model, ...(override ?? {}) });
    },
    runJudge() {
      calls.judges += 1;
      return makeEnvelope({ run_id: RUN_ID, stage: "judge", role: "judge", provider: "mock", model: "mock-judge" });
    },
    runSynthesis() {
      calls.synthesis += 1;
      return makeEnvelope({ run_id: RUN_ID, stage: "synthesis", role: "synthesizer", provider: "mock", model: "mock-synth" });
    },
    runVerifier() {
      calls.verifiers += 1;
      return makeEnvelope({ run_id: RUN_ID, stage: "verification", role: "verifier", provider: "mock", model: "mock-verifier" });
    },
  };
}

function passGate() {
  return { command_names: ["mock-objective-gate"], result: "pass", source: "deterministic-checker" };
}

function baseRequest(overrides = {}) {
  return {
    run_id: RUN_ID,
    task: { class_hint: "routine-code", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/orc", algorithm: null }],
    claims_ref: "local-ref:claims/orc",
    evidence_ref: "local-ref:evidence/orc",
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  return { adapter: mockAdapter(), runGate: passGate, now: NOW, seed: 7, mode: "tui", ...overrides };
}

function judgeRequest(overrides = {}) {
  return baseRequest({
    task: { class_hint: "roadmap-reconciliation", confident: true },
    candidates: [
      { role: "planner", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
    judge: { provider: "mock", model: "mock-judge", rubric_id: "recon-rubric-v1" },
    synthesis: { provider: "mock", model: "mock-synth", rubric_id: "recon-rubric-v1" },
    ...overrides,
  });
}

function verifierRequest(overrides = {}) {
  return baseRequest({
    task: { class_hint: "pr-preflight", confident: true },
    candidates: [
      { role: "reviewer", provider: "mock", model: "mock-model" },
      { role: "redteam", provider: "mock", model: "mock-model" },
    ],
    verification: { provider: "mock", model: "mock-verifier", rubric_id: "pr-proof-v1" },
    ...overrides,
  });
}

test("success path: routine mock dispatch writes a valid structural run record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "helix-orc-"));
  const result = await runDispatch(baseRequest(), baseDeps({ record_dir: dir }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(result.ok, true);
  assert.equal(validateRunRecord(result.record).valid, true);
  assert.equal(result.record.exit_status, "ok");
  assert.deepEqual(result.record.provider_ids, ["mock"]);
  assert.deepEqual(result.record.role_ids, ["builder", "reviewer"]);
  assert.equal(result.record.gate.source, "deterministic-checker");
  // Tokens are capacity telemetry only: exactly the two candidate envelopes, summed.
  assert.deepEqual(result.record.usage_rollup, { input_tokens: 20, output_tokens: 40 });
  assert.equal(result.record_path, join(dir, `${RUN_ID}.json`));
  assert.ok(existsSync(result.record_path));
  const onDisk = JSON.parse(readFileSync(result.record_path, "utf8"));
  assert.equal(validateRunRecord(onDisk).valid, true);
});

test("an injected staged route is recorded as the route actually executed", async () => {
  const route = {
    ...ROUTES["routine-code"],
    id: "stage:full-cycle:plan",
  };
  const result = await runDispatch(baseRequest(), baseDeps({ route }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(result.record.route_id, route.id);
  assert.equal(result.decision.route_id, "routine-code", "classification remains separately inspectable");
});

test("judge route: blinded projection metadata lands in the record; judge output stays advisory", async () => {
  const result = await runDispatch(judgeRequest(), baseDeps());
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(result.record.judge.rubric_id, "recon-rubric-v1");
  assert.equal(result.record.judge.seed, 7);
  assert.equal(result.record.judge.blinding, true);
  assert.equal(result.record.judge.judge_in_panel, false);
  assert.equal(result.record.judge.permutation.length, 2);
  // The judge envelope is returned locally but no judge verdict field exists in
  // the record — the gate, not the judge, decided the exit status.
  assert.equal(result.judge.envelope.role, "judge");
  assert.equal(result.record.gate.source, "deterministic-checker");
});

test("valid downstream routes launch candidates and singleton stages normally", async () => {
  const judgeAdapter = mockAdapter();
  const judged = await runDispatch(judgeRequest(), baseDeps({ adapter: judgeAdapter }));
  assert.equal(judged.status, "ok", JSON.stringify({ code: judged.code, detail: judged.detail }));
  assert.equal(judgeAdapter.calls.candidates, 2);
  assert.equal(judgeAdapter.calls.judges, 1);
  assert.equal(judgeAdapter.calls.synthesis, 1);

  const verifierAdapter = mockAdapter();
  const verified = await runDispatch(verifierRequest(), baseDeps({ adapter: verifierAdapter }));
  assert.equal(verified.status, "ok", JSON.stringify({ code: verified.code, detail: verified.detail }));
  assert.equal(verifierAdapter.calls.candidates, 2);
  assert.equal(verifierAdapter.calls.verifiers, 1);
});

test("determinism: same seed and input give identical permutation and record", async () => {
  const a = await runDispatch(judgeRequest(), baseDeps());
  const b = await runDispatch(judgeRequest(), baseDeps());
  assert.deepEqual(a.record.judge.permutation, b.record.judge.permutation);
  assert.equal(stableStringify(a.record), stableStringify(b.record));
});

test("seededPermutation is deterministic per seed and varies across seeds", () => {
  assert.deepEqual(seededPermutation(8, 42), seededPermutation(8, 42));
  const distinct = new Set([7, 42, 1234].map((s) => JSON.stringify(seededPermutation(8, s))));
  assert.ok(distinct.size > 1, "different seeds should not all collapse to one order");
  assert.deepEqual([...seededPermutation(8, 7)].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("unsafe provider id in the request fails closed at the boundary", async () => {
  const request = baseRequest({
    candidates: [{ role: "builder", provider: "provider/with/path", model: "m" }, { role: "reviewer", provider: "mock", model: "mock-model" }],
  });
  const result = await runDispatch(request, baseDeps());
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "invalid-request");
  assert.equal(result.record, null);
});

test("removed cost-control request fields are rejected as invalid-request", async () => {
  // profile and input_class no longer exist on the request schema
  // (additionalProperties:false — cost control left the harness entirely).
  for (const overrides of [{ profile: "no-spend-test" }, { input_class: "synthetic" }]) {
    const result = await runDispatch(baseRequest(overrides), baseDeps());
    assert.equal(result.status, "fail-closed", JSON.stringify(overrides));
    assert.equal(result.code, "invalid-request");
    assert.equal(result.record, null);
  }
  // price is gone from candidate specs too.
  const priced = baseRequest({
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model", price: { status: "verified" } },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
  });
  const result = await runDispatch(priced, baseDeps());
  assert.equal(result.code, "invalid-request");
});

test("a non-automated provider (claude-local) is refused before any launch", async () => {
  const adapter = mockAdapter();
  // claude-local is excluded from automated dispatch until the roadmap gate lands.
  const request = baseRequest({
    candidates: [
      { role: "builder", provider: "claude-local", model: "m" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
  });
  const result = await runDispatch(request, baseDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "insufficient-eligible-candidates");
  assert.ok(result.warnings.includes("provider-not-automated:claude-local"));
  assert.equal(adapter.calls.candidates, 0, "no adapter call after pre-launch refusals");
  assert.equal(result.record.exit_status, "fail-closed");
});

test("a malformed role envelope fails closed before judge/synthesis", async () => {
  const adapter = mockAdapter({ builder: () => ({ nope: true }) });
  const result = await runDispatch(baseRequest(), baseDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "min-successes-not-met");
  assert.ok(result.warnings.includes("envelope-invalid:builder"));
  assert.equal(result.record.exit_status, "fail-closed");
});

test("an envelope that does not match the vetted spec fails closed", async () => {
  const adapter = mockAdapter({
    builder: (spec) => makeEnvelope({ run_id: RUN_ID, role: spec.role, provider: "openrouter", model: "vendor/other:free" }),
  });
  const result = await runDispatch(baseRequest(), baseDeps({ adapter }));
  assert.equal(result.code, "min-successes-not-met");
  assert.ok(result.warnings.includes("envelope-mismatch:builder"));
});

test("an adapter failure drops the candidate and fails closed below min successes", async () => {
  const adapter = mockAdapter({ builder: () => { throw new Error("adapter exploded with /private/path"); } });
  const result = await runDispatch(baseRequest(), baseDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "min-successes-not-met");
  assert.ok(result.warnings.includes("adapter-failure:builder"));
  assert.equal(stableStringify(result).includes("adapter exploded"), false);
  assert.equal(result.candidates.find((c) => c.role === "builder").code, "adapter failed");
});

test("negative token usage is rejected at the envelope boundary and never enters the rollup", async () => {
  const adapter = mockAdapter({ builder: { usage: { output_tokens: -5 } } });
  const result = await runDispatch(baseRequest(), baseDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "min-successes-not-met");
  assert.ok(result.warnings.includes("envelope-invalid:builder"));
  assert.equal(stableStringify(result.record).includes("-5"), false);
  // Only the valid reviewer envelope contributes telemetry.
  assert.deepEqual(result.record.usage_rollup, { input_tokens: 10, output_tokens: 20 });
});

test("judge-in-panel degradation is recorded as a warning", async () => {
  // Judge model is one of the candidate models and no alternative exists.
  const inPanel = judgeRequest({ judge: { provider: "mock", model: "mock-model", rubric_id: "r1" } });
  const adapter = mockAdapter();
  adapter.runJudge = () => makeEnvelope({ run_id: RUN_ID, stage: "judge", role: "judge", provider: "mock", model: "mock-model" });
  const result = await runDispatch(inPanel, baseDeps({ adapter }));
  assert.equal(result.status, "ok");
  assert.equal(result.record.judge.judge_in_panel, true);
  assert.ok(result.record.warning_codes.includes("judge_in_panel"));

  // With an eligible out-of-panel alternative the stronger warning is recorded.
  const avoidable = judgeRequest({
    judge: { provider: "mock", model: "mock-model", rubric_id: "r1", eligible_alternatives: ["mock-judge"] },
  });
  const result2 = await runDispatch(avoidable, baseDeps({ adapter }));
  assert.ok(result2.record.warning_codes.includes("judge_in_panel_avoidable"));
});

test("a judge route without judge config or runJudge fails closed", async () => {
  const withoutJudge = judgeRequest();
  delete withoutJudge.judge;
  const noConfigAdapter = mockAdapter();
  const noConfig = await runDispatch(withoutJudge, baseDeps({ adapter: noConfigAdapter }));
  assert.equal(noConfig.code, "missing-judge-config");
  assert.equal(noConfig.record.judge, null);
  assert.equal(noConfigAdapter.calls.candidates, 0);

  const adapter = mockAdapter();
  delete adapter.runJudge;
  const noHook = await runDispatch(judgeRequest(), baseDeps({ adapter }));
  assert.equal(noHook.code, "adapter-missing-run-judge");
  assert.equal(adapter.calls.candidates, 0);
});

test("a synthesis route without synthesis config or runSynthesis fails closed before candidates launch", async () => {
  const withoutSynthesis = judgeRequest();
  delete withoutSynthesis.synthesis;
  const noConfigAdapter = mockAdapter();
  const noConfig = await runDispatch(withoutSynthesis, baseDeps({ adapter: noConfigAdapter }));
  assert.equal(noConfig.code, "missing-synthesis-config");
  assert.equal(noConfigAdapter.calls.candidates, 0);

  const adapter = mockAdapter();
  delete adapter.runSynthesis;
  const noHook = await runDispatch(judgeRequest(), baseDeps({ adapter }));
  assert.equal(noHook.code, "adapter-missing-run-synthesis");
  assert.equal(adapter.calls.candidates, 0);
  assert.equal(adapter.calls.judges, 0);
});

test("a verifier route without verification config or runVerifier fails closed before candidates launch", async () => {
  const withoutVerifier = verifierRequest();
  delete withoutVerifier.verification;
  const noConfigAdapter = mockAdapter();
  const noConfig = await runDispatch(withoutVerifier, baseDeps({ adapter: noConfigAdapter }));
  assert.equal(noConfig.code, "missing-verification-config");
  assert.equal(noConfigAdapter.calls.candidates, 0);

  const adapter = mockAdapter();
  delete adapter.runVerifier;
  const noHook = await runDispatch(verifierRequest(), baseDeps({ adapter }));
  assert.equal(noHook.code, "adapter-missing-run-verifier");
  assert.equal(adapter.calls.candidates, 0);
});

test("a claude-local judge is refused before any adapter call (provider-not-automated)", async () => {
  const adapter = mockAdapter();
  const request = judgeRequest({ judge: { provider: "claude-local", model: "local-judge", rubric_id: "recon-rubric-v1" } });
  const result = await runDispatch(request, baseDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "judge-not-eligible");
  assert.ok(result.warnings.includes("provider-not-automated:claude-local"));
  assert.equal(adapter.calls.candidates, 0, "no candidate launches when the judge is doomed");
  assert.equal(adapter.calls.judges, 0);
});

test("a malformed judge envelope fails closed", async () => {
  const adapter = mockAdapter();
  adapter.runJudge = () => ({ verdict: "A wins" });
  const result = await runDispatch(judgeRequest(), baseDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "judge-envelope-invalid");
});

test("uncertain classification fails closed in non-TTY and escalates in TUI", async () => {
  const nonTty = await runDispatch(baseRequest({ task: {} }), baseDeps({ mode: "print" }));
  assert.equal(nonTty.status, "fail-closed");
  assert.equal(nonTty.code, "uncertain-classification-non-tty-fail-closed");
  assert.equal(nonTty.record, null);

  const tui = await runDispatch(baseRequest({ task: {} }), baseDeps({ mode: "tui" }));
  assert.equal(tui.status, "escalate");
  assert.equal(tui.escalation, "tui-user");
});

test("an objective route without an injected gate fails closed", async () => {
  const result = await runDispatch(baseRequest(), baseDeps({ runGate: undefined }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "missing-objective-gate");
  assert.equal(result.record.gate.result, "not-run");
});

test("a failed objective gate blocks; a model-narrative gate source fails closed", async () => {
  const failed = await runDispatch(baseRequest(), baseDeps({
    runGate: () => ({ command_names: ["mock-objective-gate"], result: "fail", source: "exit-status" }),
  }));
  assert.equal(failed.status, "blocked");
  assert.equal(failed.ok, false);
  assert.equal(failed.record.exit_status, "blocked");
  assert.equal(failed.record.gate.result, "fail");

  const narrative = await runDispatch(baseRequest(), baseDeps({
    runGate: () => ({ command_names: ["vibes"], result: "pass", source: "model" }),
  }));
  assert.equal(narrative.status, "fail-closed");
  assert.equal(narrative.code, "invalid-gate-outcome");

  const throwing = await runDispatch(baseRequest(), baseDeps({
    runGate: () => { throw new Error("gate runner crashed with /private/path"); },
  }));
  assert.equal(throwing.code, "gate-execution-failure");
  assert.equal(throwing.detail, "gate execution failed");
  assert.equal(stableStringify(throwing).includes("gate runner crashed"), false);
});

test("judge synthesis verifier adapter failures expose stable details only", async () => {
  const judgeAdapter = mockAdapter();
  judgeAdapter.runJudge = () => { throw new Error("judge private /path"); };
  const judge = await runDispatch(judgeRequest(), baseDeps({ adapter: judgeAdapter }));
  assert.equal(judge.code, "judge-adapter-failure");
  assert.equal(judge.detail, "judge adapter failed");
  assert.equal(stableStringify(judge).includes("judge private"), false);

  const synthAdapter = mockAdapter();
  synthAdapter.runSynthesis = () => { throw new Error("synthesis private /path"); };
  const synthesis = await runDispatch(judgeRequest(), baseDeps({ adapter: synthAdapter }));
  assert.equal(synthesis.code, "synthesis-adapter-failure");
  assert.equal(synthesis.detail, "synthesis adapter failed");
  assert.equal(stableStringify(synthesis).includes("synthesis private"), false);

  const verifierAdapter = mockAdapter();
  verifierAdapter.runVerifier = () => { throw new Error("verifier private /path"); };
  const verifier = await runDispatch(verifierRequest(), baseDeps({ adapter: verifierAdapter }));
  assert.equal(verifier.code, "verifier-adapter-failure");
  assert.equal(verifier.detail, "verifier adapter failed");
  assert.equal(stableStringify(verifier).includes("verifier private"), false);
});

test("run-record write failures expose a stable detail only", async () => {
  const fileAsDir = join(mkdtempSync(join(tmpdir(), "helix-record-fail-")), "records-file");
  writeFileSync(fileAsDir, "not a directory", "utf8");
  const result = await runDispatch(baseRequest(), baseDeps({ record_dir: fileAsDir }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "run-record-write-failed");
  assert.equal(result.detail, "run record write failed");
  assert.equal(stableStringify(result).includes(fileAsDir), false);
});

test("requests beyond the launched panel are truncated with a recorded warning", async () => {
  const adapter = mockAdapter();
  const request = baseRequest({
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
  });
  const result = await runDispatch(request, baseDeps({ adapter }));
  assert.equal(result.status, "ok");
  assert.ok(result.warnings.includes("requested-candidates-truncated"));
  assert.equal(adapter.calls.candidates, 2);
  assert.ok(result.candidates.some((c) => c.disposition === "truncated"));
});

test("free-text claims/evidence refs are rejected at the request boundary", async () => {
  const freeText = await runDispatch(baseRequest({ claims_ref: "we found three problems in the auth flow" }), baseDeps());
  assert.equal(freeText.code, "invalid-request");
  assert.equal(freeText.record, null);
  const evidence = await runDispatch(baseRequest({ evidence_ref: "see the transcript" }), baseDeps());
  assert.equal(evidence.code, "invalid-request");
});

test("user-controlled signal text is recorded as a stable code, never as free text", async () => {
  // An unrecognized signal is user-controlled input; it must surface as a stable
  // code in the public-safe record, not carry the raw text into it.
  const request = baseRequest({
    task: { class_hint: "routine-code", confident: true, signals: ["totally-made-up-signal"] },
  });
  const result = await runDispatch(request, baseDeps());
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.ok(result.record.warning_codes.includes("unknown-floor-signal"));
  assert.ok(
    !result.record.warning_codes.some((c) => c.includes("totally-made-up-signal")),
    "user-supplied signal text must not enter the public run record",
  );
});

test("a public-safety violation in the assembled record refuses to persist", async () => {
  const homePath = "/Us" + "ers/someone/laptop"; // split so repo scanners don't self-match
  const result = await runDispatch(baseRequest({ branch: homePath }), baseDeps());
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "public-safety-violation");
  assert.equal(result.record, null);
});

test("recursion depth is exactly one: a nested dispatch refuses", async () => {
  const inner = [];
  const deps = baseDeps();
  deps.adapter = {
    calls: { candidates: 0 },
    async runCandidate(spec, ctx) {
      if (inner.length === 0) {
        inner.push(await runDispatch(baseRequest({ run_id: "run-orc-nested" }), { ...deps, depth: ctx.depth }));
      }
      return makeEnvelope({ run_id: RUN_ID, role: spec.role, provider: spec.provider, model: spec.model });
    },
  };
  const outer = await runDispatch(baseRequest(), deps);
  assert.equal(inner.length, 1);
  assert.equal(inner[0].status, "fail-closed");
  assert.equal(inner[0].code, "refused-recursion-depth");
  assert.equal(inner[0].record, null);
  assert.equal(outer.status, "ok", "the outer dispatch is unaffected by the refused nested attempt");
});

test("panel resolution failure is recorded, not silently shrunk", async () => {
  // routine-code requires 2 successes but only 1 candidate is requested →
  // launched = min(max, requested) = 1 < required 2 → resolvePanel fails closed
  // before any launch.
  const request = baseRequest({
    candidates: [{ role: "builder", provider: "mock", model: "mock-model" }],
  });
  const adapter = mockAdapter();
  const result = await runDispatch(request, baseDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "required-successes-exceeds-launched");
  assert.equal(adapter.calls.candidates, 0);
  assert.equal(result.record.exit_status, "fail-closed");
  assert.ok(result.record.warning_codes.includes("panel-fail-closed:required-successes-exceeds-launched"));
});

test("missing clock or adapter fails closed before anything runs", async () => {
  const noClock = await runDispatch(baseRequest(), { adapter: mockAdapter(), seed: 7 });
  assert.equal(noClock.code, "missing-clock");
  const noAdapter = await runDispatch(baseRequest(), { now: NOW, seed: 7 });
  assert.equal(noAdapter.code, "missing-adapter");
});
