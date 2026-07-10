import { test } from "node:test";
import assert from "node:assert/strict";
import { runDispatch } from "../dispatch/lib/orchestrate.mjs";
import { mapWithConcurrency } from "../dispatch/lib/parallel.mjs";
import { validateRunRecord, stableStringify } from "../dispatch/lib/run-record.mjs";
import { makeEnvelope } from "../dispatch/fixtures/sample.mjs";
import { MAX_PANEL_MEMBERS } from "../dispatch/lib/limits.mjs";

const NOW = 1_751_731_200; // fixed epoch seconds
const RUN_ID = "run-par";

function passGate() {
  return { command_names: ["relevant-tests", "risk-gate"], result: "pass", source: "deterministic-checker" };
}

// risky-change: builder + reviewer + redteam candidate panel, objective gate, no judge/synth.
function riskyRequest(overrides = {}) {
  return {
    run_id: RUN_ID,
    task: { class_hint: "risky-change", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
      { role: "redteam", provider: "mock", model: "mock-model" },
    ],
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/par", algorithm: null }],
    claims_ref: "local-ref:claims/par",
    evidence_ref: "local-ref:evidence/par",
    ...overrides,
  };
}

// Async adapter that records concurrency (max in-flight) so the cap is observable.
function parAdapter(perRole = {}) {
  const calls = { candidates: 0, inFlight: 0, maxInFlight: 0 };
  return {
    calls,
    async runCandidate(spec) {
      calls.candidates += 1;
      calls.inFlight += 1;
      calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
      try {
        await Promise.resolve(); // yield so multiple launches can overlap
        const override = perRole[spec.role];
        if (typeof override === "function") return override(spec);
        return makeEnvelope({ run_id: RUN_ID, role: spec.role, provider: spec.provider, model: spec.model, ...(override ?? {}) });
      } finally {
        calls.inFlight -= 1;
      }
    },
  };
}

function parDeps(overrides = {}) {
  return { adapter: parAdapter(), runGate: passGate, now: NOW, mode: "tui", ...overrides };
}

test("parallel launch is deterministic and does not reorder relative to sequential", async () => {
  const cfg = { max_concurrency: 2 };
  const a = await runDispatch(riskyRequest(), parDeps({ parallel: cfg }));
  const b = await runDispatch(riskyRequest(), parDeps({ parallel: cfg }));
  assert.equal(a.status, "ok", JSON.stringify({ code: a.code, detail: a.detail }));
  // Two parallel runs of the SAME config give byte-identical records — completion
  // order never changes the structural output.
  assert.equal(stableStringify(a.record), stableStringify(b.record));
  // Candidate outcomes stay in candidate-index order.
  assert.deepEqual(a.candidates.map((c) => [c.index, c.role]), [[0, "builder"], [1, "reviewer"], [2, "redteam"]]);
  assert.equal(validateRunRecord(a.record).valid, true);
  // Token telemetry sums all three candidate envelopes, deterministically.
  assert.deepEqual(a.record.usage_rollup, { input_tokens: 30, output_tokens: 60 });

  // Parallel produces the SAME record and candidate outcomes as sequential —
  // there is no per-mode field left to differ (cost caps are gone).
  const seq = await runDispatch(riskyRequest(), parDeps());
  assert.deepEqual(a.candidates, seq.candidates);
  assert.equal(stableStringify(a.record), stableStringify(seq.record));
});

test("the concurrency cap bounds in-flight launches", async () => {
  const a1 = parAdapter();
  await runDispatch(riskyRequest(), parDeps({ adapter: a1, parallel: { max_concurrency: 1 } }));
  assert.equal(a1.calls.candidates, 3);
  assert.equal(a1.calls.maxInFlight, 1, "cap 1 launches strictly one at a time");

  const a2 = parAdapter();
  await runDispatch(riskyRequest(), parDeps({ adapter: a2, parallel: { max_concurrency: 2 } }));
  assert.equal(a2.calls.maxInFlight, 2, "cap 2 runs at most two in flight over a 3-candidate panel");
});

test("a failed parallel candidate does not corrupt others and still respects min_successes", async () => {
  const adapter = parAdapter({ reviewer: () => { throw new Error("boom"); } });
  const result = await runDispatch(riskyRequest(), parDeps({ adapter, parallel: { max_concurrency: 3 } }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "min-successes-not-met"); // 2 ok < 3 required
  // Outcomes stay in index order; only the reviewer is the adapter-error.
  assert.deepEqual(result.candidates.map((c) => c.disposition), ["launched", "adapter-error", "launched"]);
  assert.ok(result.warnings.includes("adapter-failure:reviewer"));
  assert.equal(result.record.exit_status, "fail-closed");
});

test("a malformed envelope under parallel launch still fails closed at the boundary", async () => {
  const adapter = parAdapter({ reviewer: () => ({ nope: true }) });
  const result = await runDispatch(riskyRequest(), parDeps({ adapter, parallel: { max_concurrency: 3 } }));
  assert.equal(result.status, "fail-closed");
  assert.equal(result.code, "min-successes-not-met");
  assert.ok(result.warnings.includes("envelope-invalid:reviewer"));
  assert.deepEqual(result.candidates.map((c) => c.disposition), ["launched", "invalid-envelope", "launched"]);
});

test("parallel with an invalid concurrency cap fails closed before any launch", async () => {
  for (const mc of [
    0,
    -1,
    2.5,
    "2",
    null,
    undefined,
    Number.MAX_SAFE_INTEGER + 1,
    MAX_PANEL_MEMBERS + 1,
  ]) {
    const adapter = parAdapter();
    const result = await runDispatch(riskyRequest(), parDeps({ adapter, parallel: { max_concurrency: mc } }));
    assert.equal(result.code, "invalid-concurrency-cap", `mc=${JSON.stringify(mc)}`);
    assert.equal(adapter.calls.candidates, 0);
  }

  const adapter = parAdapter();
  const atLimit = await runDispatch(riskyRequest(), parDeps({
    adapter,
    parallel: { max_concurrency: MAX_PANEL_MEMBERS },
  }));
  assert.equal(atLimit.status, "ok");
  assert.equal(adapter.calls.candidates, 3);
});

test("no candidate narrative leaks into the record under parallel launch", async () => {
  const adapter = parAdapter({
    builder: (s) => makeEnvelope({ run_id: RUN_ID, role: s.role, provider: s.provider, model: s.model, recommendation: "PAR-CAND-NARRATIVE-ZZZ", risks: ["par-risk-zzz"] }),
  });
  const result = await runDispatch(riskyRequest(), parDeps({ adapter, parallel: { max_concurrency: 3 } }));
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  const blob = JSON.stringify(result.record);
  assert.ok(!blob.includes("PAR-CAND-NARRATIVE-ZZZ"));
  assert.ok(!blob.includes("par-risk-zzz"));
});

// --- multi-team: cross-family advisory (warning only, never a blocker) ----------

test("a cross-family route with an all-mock panel records the cross-family advisory (not a blocker)", async () => {
  // security: redteam panel + judge + synthesizer, requires_cross_family. All mock
  // → a single family → warn, but the run still succeeds.
  const request = {
    run_id: RUN_ID,
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
  const adapter = {
    runCandidate: (s) => makeEnvelope({ run_id: RUN_ID, role: s.role, provider: s.provider, model: s.model }),
    runJudge: () => makeEnvelope({ run_id: RUN_ID, stage: "judge", role: "judge", provider: "mock", model: "mock-judge" }),
    runSynthesis: () => makeEnvelope({ run_id: RUN_ID, stage: "synthesis", role: "synthesizer", provider: "mock", model: "mock-synth" }),
  };
  const result = await runDispatch(request, { adapter, runGate: () => ({ command_names: ["public-safety"], result: "pass", source: "deterministic-checker" }), now: NOW, seed: 7, mode: "tui" });
  assert.equal(result.status, "ok", JSON.stringify({ code: result.code, detail: result.detail }));
  assert.ok(result.warnings.includes("cross-family-not-satisfied"));
  assert.ok(result.record.warning_codes.includes("cross-family-not-satisfied"));
});

// --- parallel.mjs substrate units -----------------------------------------------

test("mapWithConcurrency returns input order and never exceeds the concurrency limit", async () => {
  let inFlight = 0, maxInFlight = 0;
  const items = [0, 1, 2, 3, 4, 5, 6];
  const out = await mapWithConcurrency(items, 3, async (x) => {
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return x * 10;
  });
  assert.deepEqual(out, [0, 10, 20, 30, 40, 50, 60], "results in input order regardless of completion");
  assert.ok(maxInFlight <= 3, `max in-flight ${maxInFlight} must not exceed the limit`);
  assert.deepEqual(await mapWithConcurrency([], 4, async (x) => x), []);
});
