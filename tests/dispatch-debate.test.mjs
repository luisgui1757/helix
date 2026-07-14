import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, devNull } from "node:os";
import { join } from "node:path";
import {
  runDebate,
  routeCallsForAdversarialIteration,
  validateDebateSummary,
  writeDebateSummary,
  decideDebateLoopTransition,
} from "../dispatch/lib/debate.mjs";
import { routeForClass } from "../dispatch/lib/routes.mjs";
import { stableStringify, hashRef } from "../dispatch/lib/run-record.mjs";
import { makeGitDiffStability } from "../dispatch/lib/git-diff-surface.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";
import { MAX_ITERATIONS } from "../dispatch/lib/limits.mjs";

const NOW = 1_751_731_200; // fixed epoch seconds
const SEED = 7;

test("debate routes convergence, one-shot stop, retry, and ceiling through workflow actions", () => {
  const base = { iteration: 1, max_iterations: 3 };
  assert.deepEqual(decideDebateLoopTransition({ ...base, converged: true, adversarial: true }), {
    action: "stop", code: "converged",
  });
  assert.deepEqual(decideDebateLoopTransition({ ...base, converged: false, adversarial: false }), {
    action: "stop", code: "single-pass-not-converged",
  });
  assert.deepEqual(decideDebateLoopTransition({ ...base, converged: false, adversarial: true }), {
    action: "retry", code: null,
  });
  assert.deepEqual(decideDebateLoopTransition({
    ...base, iteration: 3, converged: false, adversarial: true,
  }), { action: "refuse", code: "workflow-stage-max-passes:debate-iteration" });
});

// --- deterministic diff-stability checkers (boundary effects, like runGate) -----
// Always report the diff as already stable.
const alwaysStable = () => ({ stable: true, code: "diff-stable" });
// Report unstable until iteration >= n, then stable (drives unstable→stable).
const stableFrom = (n) => (_prev, _curr, ctx) => ({
  stable: ctx.iteration >= n,
  code: ctx.iteration >= n ? "diff-stable" : "diff-changing",
});

// risky-change base request (builder + reviewer + redteam; objective gate; no judge/synth).
function riskyBase(overrides = {}) {
  return {
    run_id: "base-placeholder",
    task: { class_hint: "risky-change", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
      { role: "redteam", provider: "mock", model: "mock-model" },
    ],
    run_target: { repo: "self" },
    claims_ref: "local-ref:claims/debate",
    evidence_ref: "local-ref:evidence/debate",
    ...overrides,
  };
}

// An adapter that builds envelopes with the per-iteration ctx.run_id (so the vetted
// identity match holds across iterations). `perRole` overrides an envelope's fields.
function debateAdapter(perRole = {}) {
  const calls = { candidates: 0 };
  return {
    calls,
    runCandidate(spec, ctx) {
      calls.candidates += 1;
      const extra = perRole[spec.role] ?? {};
      return makeEnvelope({ run_id: ctx.run_id, role: spec.role, provider: spec.provider, model: spec.model, recommendation: "ok", ...extra });
    },
  };
}

function gate(result) {
  return () => ({ command_names: ["relevant-tests", "risk-gate"], result, source: "deterministic-checker" });
}

function debateDeps(overrides = {}) {
  return {
    adapter: debateAdapter(),
    runGate: gate("pass"),
    now: NOW,
    seed: SEED,
    mode: "tui",
    diffStability: alwaysStable,
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Convergence = diff-stability + objective-gate-pass
// ----------------------------------------------------------------------------

test("an already-stable first pass with a passing gate converges in one iteration", async () => {
  const result = await runDebate(
    { run_id: "d-stable", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: alwaysStable }),
  );
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(result.converged, true);
  assert.equal(result.iterations_run, 1, "converged immediately — no extra iterations");
  assert.equal(result.stop_reason, "converged");
  assert.equal(result.iterations[0].gate_pass, true);
  assert.equal(result.iterations[0].diff_result, "stable");
  assert.equal(result.summary.converged, true);
  assert.equal(validateDebateSummary(result.summary).valid, true);
});

test("debate summary validation is closed and enforces counters, tokens, and refs", async () => {
  const result = await runDebate(
    { run_id: "d-summary-shape", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: alwaysStable }),
  );
  assert.equal(validateDebateSummary(result.summary).valid, true);

  const cases = [
    { ...result.summary, extra: "field" },
    { ...result.summary, iterations_run: 2 },
    { ...result.summary, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
    {
      ...result.summary,
      iterations: [{ ...result.summary.iterations[0], warning_codes: ["raw prose is not a code"] }],
    },
    {
      ...result.summary,
      iterations: [{ ...result.summary.iterations[0], gate_pass: false }],
    },
    {
      ...result.summary,
      revisions: [{
        after_iteration: 1,
        run_id: "d-summary-shape-iter1",
        revision_ref: "raw revision text",
      }],
    },
  ];
  for (const summary of cases) {
    assert.equal(validateDebateSummary(summary).valid, false);
  }
});

test("an unstable diff that later stabilizes converges after multiple iterations", async () => {
  const result = await runDebate(
    { run_id: "d-ramp", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: stableFrom(3) }),
  );
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(result.converged, true);
  assert.equal(result.iterations_run, 3, "iterates until the diff stabilizes");
  assert.deepEqual(result.iterations.map((it) => it.diff_result), ["unstable", "unstable", "stable"]);
  // The gate passed every iteration; convergence waited on diff-stability.
  assert.deepEqual(result.iterations.map((it) => it.gate_pass), [true, true, true]);
  assert.deepEqual(result.iterations.map((it) => it.iteration), [1, 2, 3]);
});

// ----------------------------------------------------------------------------
// Fail-closed: gate never converges within the max_iterations rail
// ----------------------------------------------------------------------------

test("a gate that never passes before max_iterations fails closed", async () => {
  const result = await runDebate(
    { run_id: "d-gatefail", base_request: riskyBase(), max_iterations: 3 },
    debateDeps({ runGate: gate("fail"), diffStability: alwaysStable }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.converged, false);
  assert.equal(result.code, "not-converged-within-max-iterations");
  assert.equal(result.iterations_run, 3, "ran the full iteration budget");
  assert.ok(result.iterations.every((it) => it.gate_pass === false));
  assert.ok(result.iterations.every((it) => it.gate_result === "fail"));
});

test("a stable diff that never gate-passes still fails closed (gate is required)", async () => {
  // Diff is stable from the first pass, but the objective gate fails — convergence
  // requires BOTH, so a stable-but-failing debate never converges.
  const result = await runDebate(
    { run_id: "d-stable-nopass", base_request: riskyBase(), max_iterations: 2 },
    debateDeps({ runGate: gate("fail"), diffStability: alwaysStable }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "not-converged-within-max-iterations");
  assert.ok(result.iterations.every((it) => it.diff_result === "stable" && it.gate_pass === false));
});

// ----------------------------------------------------------------------------
// Tokens are capacity telemetry (usage rollups), never enforcement
// ----------------------------------------------------------------------------

test("iteration summaries carry token telemetry from usage_rollup without any cap fields", async () => {
  const result = await runDebate(
    { run_id: "d-telemetry", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: stableFrom(3) }),
  );
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  // 3 mock candidates × (10 input + 20 output) tokens per iteration.
  assert.deepEqual(result.iterations.map((it) => it.tokens_used), [90, 90, 90]);
  assert.deepEqual(result.iterations.map((it) => it.cumulative_tokens), [90, 180, 270]);
  assert.equal(result.total_tokens, 270);
  // Telemetry, not accounting: no cap/budget fields exist anywhere in the result —
  // including the PERSISTED summary's iteration copies (regression: buildSummary
  // once re-spread a stray empty cap_status into them).
  assert.ok(result.iterations.every((it) => !("cap_status" in it)), "iteration summaries carry no cap_status");
  assert.ok(result.summary.iterations.every((it) => !("cap_status" in it)), "summary iterations carry no cap_status");
  assert.equal(result.summary.schema_version, 2);
  assert.ok(!("token_budget" in result.summary), "the debate summary has no token_budget field");
  assert.equal(result.summary.total_tokens, 270);
});

// ----------------------------------------------------------------------------
// The verifier (and every model role) is never final authority
// ----------------------------------------------------------------------------

// pr-preflight: reviewer + redteam candidates + an advisory verifier; objective gate.
function preflightBase(overrides = {}) {
  return {
    run_id: "base-placeholder",
    task: { class_hint: "pr-preflight", confident: true },
    candidates: [
      { role: "reviewer", provider: "mock", model: "mock-model" },
      { role: "redteam", provider: "mock", model: "mock-model" },
    ],
    verification: { provider: "mock", model: "mock-verifier", rubric_id: "preflight-rubric-v1" },
    run_target: { repo: "self" },
    claims_ref: "local-ref:claims/pf",
    evidence_ref: "local-ref:evidence/pf",
    ...overrides,
  };
}

function preflightAdapter(verifierStatus, verifierReco) {
  return {
    runCandidate: (s, ctx) => makeEnvelope({ run_id: ctx.run_id, role: s.role, provider: s.provider, model: s.model, recommendation: s.role === "redteam" ? "no-blockers" : "approve" }),
    runVerifier: (_input, ctx) => makeEnvelope({ run_id: ctx.run_id, stage: "verification", role: "verifier", provider: "mock", model: "mock-verifier", status: verifierStatus, recommendation: verifierReco }),
  };
}

test("a positive verifier cannot rescue a debate whose objective gate never passes", async () => {
  // Verifier approves every iteration, but the objective gate fails — the debate
  // never converges. Verifier approval is not final authority.
  const result = await runDebate(
    { run_id: "d-ver-rescue", base_request: preflightBase(), max_iterations: 3 },
    debateDeps({ adapter: preflightAdapter("ok", "approve"), runGate: gate("fail"), diffStability: alwaysStable }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "not-converged-within-max-iterations");
  assert.ok(result.iterations.every((it) => it.gate_pass === false));
});

test("a negative verifier cannot block a debate whose objective gate passes", async () => {
  // Verifier rejects, but the objective gate passes and the diff is stable — the
  // debate converges anyway. Verifier disapproval is not final authority.
  const result = await runDebate(
    { run_id: "d-ver-block", base_request: preflightBase(), max_iterations: 3 },
    debateDeps({ adapter: preflightAdapter("blocked", "reject"), runGate: gate("pass"), diffStability: alwaysStable }),
  );
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.equal(result.converged, true);
  assert.equal(result.iterations_run, 1);
});

// ----------------------------------------------------------------------------
// No model narrative enters the public debate summary
// ----------------------------------------------------------------------------

// security: 2 redteam candidates + judge + synthesizer; objective gate; adversarial.
function securityBase() {
  return {
    run_id: "base-placeholder",
    task: { class_hint: "security", confident: true },
    candidates: [
      { role: "redteam", provider: "mock", model: "mock-model" },
      { role: "redteam", provider: "mock", model: "mock-model" },
    ],
    judge: { provider: "mock", model: "mock-judge", rubric_id: "sec-rubric-v1" },
    synthesis: { provider: "mock", model: "mock-synth", rubric_id: "sec-rubric-v1" },
    run_target: { repo: "self" },
    claims_ref: "local-ref:claims/sec",
    evidence_ref: "local-ref:evidence/sec",
  };
}

test("no candidate/judge/synthesis narrative leaks into the debate summary", async () => {
  const adapter = {
    runCandidate: (s, ctx) => makeEnvelope({ run_id: ctx.run_id, role: s.role, provider: s.provider, model: s.model, recommendation: "CAND-NARRATIVE-ZZZ", risks: ["risk-narrative-zzz"] }),
    runJudge: (_i, ctx) => makeEnvelope({ run_id: ctx.run_id, stage: "judge", role: "judge", provider: "mock", model: "mock-judge", recommendation: "JUDGE-NARRATIVE-ZZZ" }),
    runSynthesis: (_i, ctx) => makeEnvelope({ run_id: ctx.run_id, stage: "synthesis", role: "synthesizer", provider: "mock", model: "mock-synth", recommendation: "SYNTH-NARRATIVE-ZZZ" }),
  };
  const result = await runDebate(
    { run_id: "d-noleak", base_request: securityBase(), max_iterations: 2 },
    debateDeps({ adapter, runGate: () => ({ command_names: ["security-gate"], result: "pass", source: "deterministic-checker" }), diffStability: alwaysStable }),
  );
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  const blob = stableStringify(result.summary);
  for (const needle of ["CAND-NARRATIVE-ZZZ", "risk-narrative-zzz", "JUDGE-NARRATIVE-ZZZ", "SYNTH-NARRATIVE-ZZZ"]) {
    assert.ok(!blob.includes(needle), `summary must not contain '${needle}'`);
  }
  // The cross-family advisory (all-mock, single family) is preserved structurally.
  assert.ok(result.iterations[0].warning_codes.includes("cross-family-not-satisfied"));
});

test("a prose diff-stability code is rejected as invalid before it reaches the summary", async () => {
  // A free-text code (spaces / uppercase) is rejected structurally as
  // diff-checker-invalid EVEN THOUGH it matches no public-safety leak regex — the diff
  // code is a stable marker, not prose. This is the structural guard, not the leak scan.
  const prose = () => ({ stable: true, code: "confidential client alpha narrative" });
  const result = await runDebate(
    { run_id: "d-prose", base_request: riskyBase(), max_iterations: 2 },
    debateDeps({ diffStability: prose }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "diff-checker-invalid");
  assert.equal(result.summary, null);
});

test("a thrown prose diff-stability code is rejected as a safe fallback", async () => {
  const privateText = () => { throw "client narrative with /private/path"; };
  const result = await runDebate(
    { run_id: "d-throw-prose", base_request: riskyBase(), max_iterations: 2 },
    debateDeps({ diffStability: privateText }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "diff-checker-invalid");
  assert.equal(result.stop_reason, "diff-checker-invalid");
  assert.equal(result.detail.includes("client narrative"), false);
  assert.equal(result.summary, null);
});

test("a structurally-valid diff code that still matches a leak pattern fails the summary closed", async () => {
  // Defense in depth: a code that satisfies the structural token pattern but matches a
  // provider-key leak signature still trips the summary public-safety scan. The literal
  // is assembled at runtime so repo-wide secret scanners do not self-match this source.
  const leakyKey = () => ({ stable: true, code: "sk-" + "a".repeat(24) });
  const result = await runDebate(
    { run_id: "d-leakkey", base_request: riskyBase(), max_iterations: 2 },
    debateDeps({ diffStability: leakyKey }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "public-safety-violation");
  assert.equal(result.summary, null, "a leaky summary is never returned or persisted");
});

test("writeDebateSummary fails closed on a provenance leak in the summary", () => {
  // The provenance-pattern public-safety guard on the persisted summary. The
  // The fixture phrase is assembled so broad provenance scans do not self-match here.
  const dir = mkdtempSync(join(tmpdir(), "helix-debate-"));
  const provenance = "auto " + "Gener" + "ated with a tool";
  const summary = { run_id: "d-prov", timestamp: 0, kind: "adversarial-debate", iterations: [{ note: provenance }] };
  assert.throws(() => writeDebateSummary(summary, dir), /public-safety scan failed/);
});

// ----------------------------------------------------------------------------
// The one mandatory rail (max_iterations) fails closed before iteration starts
// ----------------------------------------------------------------------------

test("a missing or unbounded max_iterations fails closed before iterating", async () => {
  const cases = [
    { max_iterations: undefined, code: "missing-max-iterations" },
    { max_iterations: null, code: "missing-max-iterations" },
    { max_iterations: 0, code: "unbounded-max-iterations" },
    { max_iterations: -1, code: "unbounded-max-iterations" },
    { max_iterations: 2.5, code: "unbounded-max-iterations" },
    { max_iterations: Infinity, code: "unbounded-max-iterations" },
    { max_iterations: NaN, code: "unbounded-max-iterations" },
    { max_iterations: "5", code: "unbounded-max-iterations" },
    { max_iterations: Number.MAX_SAFE_INTEGER + 1, code: "unbounded-max-iterations" },
    { max_iterations: MAX_ITERATIONS + 1, code: "unbounded-max-iterations" },
  ];
  for (const { max_iterations, code } of cases) {
    const adapter = debateAdapter();
    const req = { run_id: "d-cap", base_request: riskyBase() };
    if (max_iterations !== undefined) req.max_iterations = max_iterations;
    const result = await runDebate(req, debateDeps({ adapter }));
    assert.equal(result.code, code, `max_iterations=${JSON.stringify(max_iterations)}`);
    assert.equal(result.status, "fail-closed");
    assert.equal(adapter.calls.candidates, 0, "no iteration ran");
    assert.equal(result.summary, null);
  }
});

test("a request still carrying the removed token_budget field fails closed before iterating", async () => {
  // token_budget was demolished with the cost controls; the debate request schema
  // (additionalProperties: false) now rejects it structurally, never ignores it.
  const adapter = debateAdapter();
  const result = await runDebate(
    { run_id: "d-legacy", base_request: riskyBase(), max_iterations: 3, token_budget: 1_000_000 },
    debateDeps({ adapter }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "invalid-debate-request");
  assert.equal(adapter.calls.candidates, 0, "no iteration ran");
  assert.equal(result.summary, null);
});

test("an invalid debate request fails closed", async () => {
  const adapter = debateAdapter();
  const result = await runDebate({ run_id: "bad id!", base_request: riskyBase(), max_iterations: 3 }, debateDeps({ adapter }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "invalid-debate-request");
  assert.equal(adapter.calls.candidates, 0);
});

test("a null or undefined debate request fails closed without throwing", async () => {
  for (const bad of [null, undefined]) {
    const result = await runDebate(bad, debateDeps());
    assert.equal(result.status, "fail-closed", String(bad));
    assert.equal(result.code, "invalid-debate-request", String(bad));
    assert.equal(result.iterations_run, 0);
    assert.equal(result.summary, null);
  }
});

// ----------------------------------------------------------------------------
// The diff-stability checker must be available and deterministic
// ----------------------------------------------------------------------------

test("an unavailable diff-stability checker fails closed before iterating", async () => {
  const adapter = debateAdapter();
  const result = await runDebate(
    { run_id: "d-nochecker", base_request: riskyBase(), max_iterations: 3 },
    { adapter, runGate: gate("pass"), now: NOW, seed: SEED, mode: "tui", diffStability: undefined },
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "diff-checker-unavailable");
  assert.equal(adapter.calls.candidates, 0);
});

test("a non-deterministic diff-stability checker fails closed", async () => {
  let flip = 0;
  const nondeterministic = () => ({ stable: flip++ % 2 === 0, code: "x" });
  const result = await runDebate(
    { run_id: "d-nondet", base_request: riskyBase(), max_iterations: 3 },
    debateDeps({ diffStability: nondeterministic }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "non-deterministic-diff-checker");
});

test("an invalid diff-stability checker output shape fails closed", async () => {
  for (const bad of [null, {}, { stable: "yes", code: "x" }, { stable: true }, { stable: true, code: "" }, { stable: true, code: 5 }]) {
    const result = await runDebate(
      { run_id: "d-badout", base_request: riskyBase(), max_iterations: 2 },
      debateDeps({ diffStability: () => bad }),
    );
    assert.equal(result.status, "fail-closed", JSON.stringify(bad));
    assert.equal(result.code, "diff-checker-invalid", JSON.stringify(bad));
  }
});

// ----------------------------------------------------------------------------
// A hard fail-closed inside an iteration stops the debate (never retried)
// ----------------------------------------------------------------------------

test("a min-success fail-closed iteration preserves its record evidence and is never retried", async () => {
  // Every candidate adapter throws → the cycle fails closed (min-successes-not-met) but
  // still returns a VALID structural record. The debate appends it (evidence not
  // discarded) and does NOT retry across iterations.
  const adapter = { calls: { candidates: 0 }, runCandidate() { this.calls.candidates += 1; throw new Error("boom"); } };
  const result = await runDebate(
    { run_id: "d-hardfail", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ adapter }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "iteration-fail-closed");
  assert.match(result.detail, /min-successes-not-met/);
  assert.equal(result.iterations_run, 1, "the failed cycle's record is appended, not discarded");
  assert.ok(result.summary, "a structural summary is built from the failed iteration");
  const it = result.iterations[0];
  assert.equal(it.exit_status, "fail-closed");
  assert.equal(it.diff_result, "not-run");
  assert.equal(it.diff_code, "iteration-fail-closed");
  assert.ok(it.warning_codes.includes("adapter-failure:builder"), JSON.stringify(it.warning_codes));
  assert.ok(result.warnings.includes("iteration-fail-closed:min-successes-not-met"));
  assert.equal(adapter.calls.candidates, 3, "one iteration's candidates only — never retried");
});

test("a fail-closed iteration with no valid run record fails closed as no-record", async () => {
  // A base_request still carrying the REMOVED profile/input_class fields is rejected
  // at runDispatch's request boundary (additionalProperties: false) BEFORE panel
  // resolution, so it returns record:null — there is no structural evidence to append.
  const result = await runDebate(
    { run_id: "d-norecord", base_request: riskyBase({ profile: "no-spend-test", input_class: "synthetic" }), max_iterations: 3 },
    debateDeps(),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "iteration-fail-closed-no-record");
  assert.equal(result.iterations_run, 0);
  assert.equal(result.summary, null);
  assert.ok(result.warnings.includes("iteration-fail-closed:invalid-request"), JSON.stringify(result.warnings));
});

// ----------------------------------------------------------------------------
// Single-pass (non-adversarial) routes run exactly once
// ----------------------------------------------------------------------------

// routine-code: builder + reviewer, objective gate, NO adversarial role.
function routineBase() {
  return {
    run_id: "base-placeholder",
    task: { class_hint: "routine-code", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
    run_target: { repo: "self" },
    claims_ref: "local-ref:claims/rc",
    evidence_ref: "local-ref:evidence/rc",
  };
}

test("a non-adversarial route runs exactly one iteration (single-pass)", async () => {
  const converged = await runDebate(
    { run_id: "d-single-ok", base_request: routineBase(), max_iterations: 5 },
    debateDeps({ adapter: { runCandidate: (s, ctx) => makeEnvelope({ run_id: ctx.run_id, role: s.role, provider: s.provider, model: s.model, recommendation: s.role === "reviewer" ? "approve" : "ship" }) }, runGate: gate("pass"), diffStability: alwaysStable }),
  );
  assert.equal(converged.status, "ok", JSON.stringify({ code: converged.code, detail: converged.detail }));
  assert.equal(converged.iterations_run, 1);
  assert.ok(converged.warnings.includes("single-pass-route"));

  // A single pass that does not converge fails closed without a second iteration.
  const notConverged = await runDebate(
    { run_id: "d-single-fail", base_request: routineBase(), max_iterations: 5 },
    debateDeps({ adapter: { runCandidate: (s, ctx) => makeEnvelope({ run_id: ctx.run_id, role: s.role, provider: s.provider, model: s.model, recommendation: s.role === "reviewer" ? "approve" : "ship" }) }, runGate: gate("fail"), diffStability: alwaysStable }),
  );
  assert.equal(notConverged.status, "fail-closed");
  assert.equal(notConverged.code, "single-pass-not-converged");
  assert.equal(notConverged.iterations_run, 1, "single-pass route never loops");
});

test("disable_adversarial forces an adversarial route to single-pass", async () => {
  const result = await runDebate(
    { run_id: "d-disable", base_request: riskyBase({ task: { class_hint: "risky-change", confident: true, override: { disable_adversarial: true } } }), max_iterations: 5 },
    debateDeps({ runGate: gate("fail"), diffStability: stableFrom(3) }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "single-pass-not-converged");
  assert.equal(result.iterations_run, 1);
  assert.ok(result.warnings.includes("single-pass-route"));
});

// ----------------------------------------------------------------------------
// Determinism + persistence
// ----------------------------------------------------------------------------

test("a fixed seed/input yields a byte-identical debate summary", async () => {
  const req = () => ({ run_id: "d-det", base_request: riskyBase(), max_iterations: 5 });
  const a = await runDebate(req(), debateDeps({ diffStability: stableFrom(3) }));
  const b = await runDebate(req(), debateDeps({ diffStability: stableFrom(3) }));
  assert.equal(a.status, "ok");
  assert.equal(stableStringify(a.summary), stableStringify(b.summary), "same seed/input ⇒ byte-identical summary");
  assert.deepEqual(a.iterations, b.iterations);
});

test("iteration records and the debate summary are written to the records dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "helix-debate-"));
  const result = await runDebate(
    { run_id: "d-persist", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ record_dir: dir, diffStability: stableFrom(2) }),
  );
  assert.equal(result.status, "ok");
  assert.equal(result.iterations_run, 2);
  // Per-iteration records use distinct filenames; the summary is a distinct file.
  assert.ok(existsSync(join(dir, "d-persist-iter1.json")), "iteration 1 record written");
  assert.ok(existsSync(join(dir, "d-persist-iter2.json")), "iteration 2 record written");
  assert.equal(result.summary_path, join(dir, "d-persist.debate.json"));
  const written = JSON.parse(readFileSync(result.summary_path, "utf8"));
  assert.equal(written.run_id, "d-persist");
  assert.equal(written.converged, true);
  assert.equal(written.iterations.length, 2);
});

// ----------------------------------------------------------------------------
// Units
// ----------------------------------------------------------------------------

test("routeCallsForAdversarialIteration keys off critic/arbiter roles and disable_adversarial", () => {
  const risky = routeForClass("risky-change"); // has redteam
  const routine = routeForClass("routine-code"); // builder + reviewer only
  assert.equal(routeCallsForAdversarialIteration(risky, {}), true);
  assert.equal(routeCallsForAdversarialIteration(routine, {}), false);
  assert.equal(routeCallsForAdversarialIteration(routeForClass("security"), {}), true);
  assert.equal(routeCallsForAdversarialIteration(risky, { task: { override: { disable_adversarial: true } } }), false);
  assert.equal(routeCallsForAdversarialIteration(null, {}), false);
});

test("writeDebateSummary refuses an unsafe run_id filename", () => {
  const dir = mkdtempSync(join(tmpdir(), "helix-debate-"));
  assert.throws(() => writeDebateSummary({ run_id: "../escape", iterations: [] }, dir), /safe filename token/);
});

// ----------------------------------------------------------------------------
// Real working-tree diff surface + real revision boundary
// ----------------------------------------------------------------------------

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "helix-test",
  GIT_AUTHOR_EMAIL: "helix@test.invalid",
  GIT_COMMITTER_NAME: "helix-test",
  GIT_COMMITTER_EMAIL: "helix@test.invalid",
  LC_ALL: "C",
  TZ: "UTC",
};

function gitCmd(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
}

/** A temp repo with a committed `proposal.txt` and a clean tree. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "helix-debate-git-"));
  gitCmd(dir, ["init", "-q"]);
  writeFileSync(join(dir, "proposal.txt"), "base\n");
  gitCmd(dir, ["add", "proposal.txt"]);
  gitCmd(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "base"]);
  return dir;
}

test("a real git diff surface + local revision boundary converge across iterations", async () => {
  const repo = makeRepo();
  const records = mkdtempSync(join(tmpdir(), "helix-debate-rec-")); // kept OUT of the repo tree
  try {
    // The revision effect is the ONLY thing that mutates the worktree. It writes a
    // constant proposal, so the first revision changes the tree and the second is a
    // no-op — the real diff surface then reports diff-stable and the debate converges.
    const revise = (_state, _ctx) => {
      writeFileSync(join(repo, "proposal.txt"), "base\nrevised-proposal\n");
      return { ok: true, revision_ref: hashRef("base\nrevised-proposal\n"), code: "revision-applied" };
    };
    const result = await runDebate(
      { run_id: "d-realdiff", base_request: riskyBase(), max_iterations: 5 },
      debateDeps({ record_dir: records, diffStability: makeGitDiffStability({ cwd: repo }), revise }),
    );
    assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
    assert.equal(result.converged, true);
    assert.equal(result.iterations_run, 3, "baseline → changing → stable");
    assert.deepEqual(result.iterations.map((it) => it.diff_result), ["unstable", "unstable", "stable"]);
    assert.deepEqual(result.iterations.map((it) => it.diff_code), ["diff-baseline", "diff-changing", "diff-stable"]);
    // Revision ran after iterations 1 and 2 (not after the converged iteration 3),
    // threaded structurally as sha256 refs — never free text.
    assert.equal(result.revisions.length, 2);
    assert.deepEqual(result.revisions.map((r) => r.after_iteration), [1, 2]);
    for (const r of result.revisions) assert.match(r.revision_ref, /^sha256:[0-9a-f]{64}$/);
    // The structural revision evidence is in the persisted, public-safe summary.
    assert.ok(result.summary.revisions, "summary carries revision evidence when a revision ran");
    assert.equal(result.summary.revisions.length, 2);
    assert.ok(existsSync(result.summary_path));
    const written = JSON.parse(readFileSync(result.summary_path, "utf8"));
    assert.equal(written.revisions.length, 2);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(records, { recursive: true, force: true });
  }
});

test("a revision changing SAME-SIZE untracked proposal content does not falsely converge", async () => {
  // Review regression: a same-size content edit to an untracked proposal file
  // (content-hashed by default — no allowlist exists anymore) must be visible as
  // diff-changing — it must NOT converge as diff-stable at iteration 2 (the
  // metadata-only bug), only once content stabilizes.
  const repo = makeRepo(); // committed proposal.txt (clean); we churn an UNTRACKED draft.txt
  const records = mkdtempSync(join(tmpdir(), "helix-debate-samesize-")); // kept OUT of the repo
  try {
    writeFileSync(join(repo, "draft.txt"), "AAAA"); // untracked proposal content, size 4
    // revise: AAAA -> BBBB on iteration 1 (same size, new content), then BBBB (no-op).
    const revise = () => {
      writeFileSync(join(repo, "draft.txt"), "BBBB");
      return { ok: true, revision_ref: hashRef("BBBB") };
    };
    const result = await runDebate(
      { run_id: "d-samesize", base_request: riskyBase(), max_iterations: 5 },
      debateDeps({
        record_dir: records,
        diffStability: makeGitDiffStability({ cwd: repo }),
        revise,
      }),
    );
    assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
    assert.equal(result.iterations_run, 3, "same-size content change is visible ⇒ no premature convergence");
    assert.deepEqual(result.iterations.map((it) => it.diff_code), ["diff-baseline", "diff-changing", "diff-stable"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(records, { recursive: true, force: true });
  }
});

test("a failed revision stops fail-closed and preserves prior iteration evidence", async () => {
  // The diff never stabilizes (stableFrom(9) with max 5), so the loop keeps
  // revising. The revision succeeds once, then refuses — the debate fails closed
  // with a stable code while keeping the evidence from the iterations already run.
  let calls = 0;
  const revise = () =>
    calls++ === 0 ? { ok: true, revision_ref: hashRef("r1") } : { ok: false, code: "builder-refused" };
  const result = await runDebate(
    { run_id: "d-revfail", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: stableFrom(9), revise }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "revision-failed");
  assert.match(result.detail, /builder-refused/);
  assert.equal(result.iterations_run, 2, "the iterations before the failed revision are preserved");
  assert.ok(result.summary, "a structural summary is built from the preserved evidence");
  assert.equal(result.revisions.length, 1, "only the first (successful) revision is recorded");
  assert.ok(result.warnings.includes("revision-failed"));
});

test("a revision returning free text instead of a ref fails closed (revision-invalid)", async () => {
  const revise = () => ({ ok: true, revision_ref: "just some free text, not a ref" });
  const result = await runDebate(
    { run_id: "d-revtext", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: stableFrom(9), revise }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "revision-invalid");
  assert.ok(result.warnings.includes("revision-invalid"));
});

test("a revision effect that throws fails closed as revision-failed", async () => {
  const revise = () => { throw new Error("worktree mutation exploded"); };
  const result = await runDebate(
    { run_id: "d-revthrow", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: stableFrom(9), revise }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "revision-failed");
});

// The synthetic home-path marker is assembled at runtime (split literal) so the
// repo-wide public-safety scanners do not self-match this source file.
const HOME_MARK = "/Us" + "ers/";

test("a thrown revision error never leaks its message into detail/summary/warnings", async () => {
  // The thrown message carries a private-looking path; it must appear in none of the
  // returned detail, the returned/persisted summary, or the warnings (review Finding 2).
  const HOMEISH = HOME_MARK + "alice/private-project/secret.diff";
  const dir = mkdtempSync(join(tmpdir(), "helix-revleak-"));
  const revise = () => { throw new Error(HOMEISH); };
  try {
    const result = await runDebate(
      { run_id: "d-revleak", base_request: riskyBase(), max_iterations: 5 },
      debateDeps({ record_dir: dir, diffStability: stableFrom(9), revise }),
    );
    assert.equal(result.status, "fail-closed");
    assert.equal(result.code, "revision-failed");
    const persisted = existsSync(result.summary_path) ? readFileSync(result.summary_path, "utf8") : "";
    const blobs = [result.detail, stableStringify(result.summary ?? {}), JSON.stringify(result.warnings), persisted];
    for (const b of blobs) {
      assert.ok(!b.includes(HOMEISH) && !b.includes(HOME_MARK) && !b.includes("secret.diff"), `leaked into: ${b}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a free-form revision failure code is dropped; only a stable-code subcode surfaces", async () => {
  const FREE = "client alpha raw failure reason " + HOME_MARK + "bob/x";
  const leaky = await runDebate(
    { run_id: "d-revcode", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: stableFrom(9), revise: () => ({ ok: false, code: FREE }) }),
  );
  assert.equal(leaky.code, "revision-failed");
  for (const b of [leaky.detail, stableStringify(leaky.summary ?? {}), JSON.stringify(leaky.warnings)]) {
    assert.ok(!b.includes("client alpha") && !b.includes(HOME_MARK), `leaked into: ${b}`);
  }
  // A well-formed stable-code subcode IS surfaced (structural, safe).
  const structural = await runDebate(
    { run_id: "d-revcode2", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: stableFrom(9), revise: () => ({ ok: false, code: "builder-refused" }) }),
  );
  assert.equal(structural.code, "revision-failed");
  assert.match(structural.detail, /revision-subcode:builder-refused/);
});

test("a present-but-non-function revision effect fails closed before iterating", async () => {
  const adapter = debateAdapter();
  const result = await runDebate(
    { run_id: "d-revbad", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ adapter, revise: "not a function" }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "invalid-revision-effect");
  assert.equal(adapter.calls.candidates, 0, "no iteration ran");
});

test("an opted-out adversarial route records the structural adversarial-opt-out code", async () => {
  const result = await runDebate(
    {
      run_id: "d-optout",
      base_request: riskyBase({ task: { class_hint: "risky-change", confident: true, override: { disable_adversarial: true } } }),
      max_iterations: 5,
    },
    debateDeps({ runGate: gate("fail"), diffStability: alwaysStable }),
  );
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "single-pass-not-converged");
  assert.ok(result.warnings.includes("adversarial-opt-out"), JSON.stringify(result.warnings));
  assert.ok(result.warnings.includes("single-pass-route"));
});

test("without a revision effect the debate keeps the legacy no-revision shape", async () => {
  // Backward-compatibility: a debate with no injected revision effect never adds a
  // `revisions` key to the summary, so a no-revision summary stays byte-identical.
  const result = await runDebate(
    { run_id: "d-norevise", base_request: riskyBase(), max_iterations: 5 },
    debateDeps({ diffStability: stableFrom(3) }),
  );
  assert.equal(result.status, "ok");
  assert.equal(result.revisions.length, 0);
  assert.ok(!("revisions" in result.summary), "no revision effect ⇒ no revisions key in the summary");
});
