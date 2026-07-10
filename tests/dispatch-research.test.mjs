// M7 — autoresearch machinery: the mandatory shape, all four stop reasons,
// attendance, toggles, and the structural record.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runResearch,
  RESEARCH_CODES,
  RESEARCH_STOP_REASONS,
  parseStrictNumberToken,
} from "../dispatch/lib/research.mjs";
import { toggleVector, defaultSettings } from "../dispatch/lib/settings.mjs";
import { MAX_ITERATIONS } from "../dispatch/lib/limits.mjs";

const ON = toggleVector(defaultSettings());

function spec(overrides = {}) {
  return {
    run_id: "research-test",
    question: "does the cache help",
    hypothesis: "the cache halves latency",
    experiment: "run the benchmark with the cache enabled",
    metric: { name: "latency-ms", comparator: "<=", target: 100 },
    stop: { max_iterations: 5, diminishing_returns_after: 2 },
    ...overrides,
  };
}

function measurements(values, extras = {}) {
  return async (i) => ({ measurement: values[i - 1], ...(extras[i] ?? {}) });
}

test("strict numeric tokens accept complete decimal/scientific forms only", () => {
  assert.deepEqual(parseStrictNumberToken("1e3"), { ok: true, value: 1000 });
  assert.deepEqual(parseStrictNumberToken("-2.5E-2"), { ok: true, value: -0.025 });
  for (const token of ["", " 1", "1 ", "1e", "1e3oops", "score=1", "Infinity", "NaN"]) {
    assert.deepEqual(parseStrictNumberToken(token), { ok: false, value: null }, token);
  }
});

test("research refuses to start without a metric or stop condition", async () => {
  const base = spec();
  const noMetric = { ...base };
  delete noMetric.metric;
  const noStop = { ...base };
  delete noStop.stop;
  const deps = { attended: true, toggles: ON, runExperiment: measurements([1]) };
  assert.equal((await runResearch(noMetric, deps)).code, RESEARCH_CODES.MISSING_METRIC);
  assert.equal((await runResearch(noStop, deps)).code, RESEARCH_CODES.MISSING_STOP);
  const badComparator = spec({ metric: { name: "x", comparator: "~=", target: 1 } });
  assert.equal((await runResearch(badComparator, deps)).code, RESEARCH_CODES.INVALID_SPEC);
});

test("research is attended-only and the autoresearch toggle is an explicit conflict", async () => {
  const unattended = await runResearch(spec(), { attended: false, runExperiment: measurements([1]) });
  assert.equal(unattended.code, RESEARCH_CODES.REQUIRES_ATTENDED);
  const off = { ...ON, autoresearch: false };
  const disabled = await runResearch(spec(), { attended: true, toggles: off, runExperiment: measurements([1]) });
  assert.equal(disabled.code, "toggle-disabled:autoresearch");
});

test("stop reason: target-met (the measurement satisfies the declared comparator)", async () => {
  const result = await runResearch(spec(), {
    attended: true, toggles: ON,
    runExperiment: measurements([180, 140, 95]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.stop_reason, "target-met");
  assert.equal(result.iterations.length, 3);
  assert.deepEqual(result.iterations.map((i) => i.verdict), ["improved", "improved", "target-met"]);
});

test("stop reason: dead-end (refuted, no successor) is a VALUABLE result — ok:true", async () => {
  const result = await runResearch(spec(), {
    attended: true, toggles: ON,
    runExperiment: measurements([180, 175], { 2: { refuted: true } }),
  });
  assert.equal(result.ok, true, "a refutation is knowledge, not failure");
  assert.equal(result.stop_reason, "dead-end");
  assert.equal(result.iterations[1].verdict, "refuted");
});

test("a refutation WITH a successor hypothesis keeps iterating", async () => {
  const result = await runResearch(spec(), {
    attended: true, toggles: ON,
    runExperiment: measurements([180, 175, 90], { 2: { refuted: true, has_successor: true } }),
  });
  assert.equal(result.stop_reason, "target-met");
  assert.equal(result.iterations.length, 3);
});

test("stop reason: diminishing-returns after N consecutive non-improvements", async () => {
  const result = await runResearch(spec(), {
    attended: true, toggles: ON,
    runExperiment: measurements([150, 150, 151, 149]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.stop_reason, "diminishing-returns");
  assert.equal(result.iterations.length, 3, "two consecutive plateaus after the first measurement");
});

test("equality metrics improve only when they move closer to the target", async () => {
  const result = await runResearch(spec({
    metric: { name: "score", comparator: "==", target: 10 },
    stop: { max_iterations: 4, diminishing_returns_after: 1 },
  }), {
    attended: true,
    toggles: ON,
    runExperiment: measurements([0, 100, 0, 100]),
  });

  assert.equal(result.stop_reason, "diminishing-returns");
  assert.deepEqual(result.iterations.map((iteration) => iteration.verdict), ["improved", "no-improvement"]);
});

test("stop reason: max-iterations when nothing else stops the loop", async () => {
  const result = await runResearch(spec({ stop: { max_iterations: 3 } }), {
    attended: true, toggles: ON,
    runExperiment: measurements([150, 140, 130]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.stop_reason, "max-iterations");
  assert.equal(result.iterations.length, 3);
});

test("loops OFF runs one experiment but retains a canonical objective stop reason", async () => {
  const off = { ...ON, loops: false };
  const result = await runResearch(spec(), {
    attended: true, toggles: off,
    runExperiment: measurements([150]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.stop_reason, "max-iterations");
  assert.equal(result.iterations.length, 1);
  assert.ok(result.warnings.includes("loops-off-one-shot-research"));
  assert.deepEqual(RESEARCH_STOP_REASONS, [
    "target-met",
    "max-iterations",
    "diminishing-returns",
    "dead-end",
  ]);
});

test("research rejects unsafe or impractical iteration rails and malformed toggle vectors", async () => {
  let calls = 0;
  const runExperiment = async () => {
    calls += 1;
    return { measurement: 1 };
  };
  for (const max_iterations of [MAX_ITERATIONS + 1, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await runResearch(spec({ stop: { max_iterations } }), {
      attended: true,
      toggles: ON,
      runExperiment,
    });
    assert.equal(result.code, RESEARCH_CODES.INVALID_SPEC);
  }
  const malformedToggles = await runResearch(spec(), {
    attended: true,
    toggles: { autoresearch: true, loops: false },
    runExperiment,
  });
  assert.equal(malformedToggles.code, RESEARCH_CODES.INVALID_TOGGLES);
  assert.equal(calls, 0);

  const atLimit = await runResearch(spec({ stop: { max_iterations: MAX_ITERATIONS } }), {
    attended: true,
    toggles: ON,
    runExperiment: async () => ({ measurement: 100 }),
  });
  assert.equal(atLimit.ok, true);
  assert.equal(atLimit.stop_reason, "target-met");
});

test("the research record is structural: hashes and measurements, never the text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prime-research-"));
  try {
    const result = await runResearch(spec(), {
      attended: true, toggles: ON,
      runExperiment: measurements([95]),
      record_dir: dir,
    });
    assert.equal(result.stop_reason, "target-met");
    const record = JSON.parse(readFileSync(result.record_path, "utf8"));
    assert.match(record.hypothesis_ref, /^sha256:/);
    assert.match(record.experiment_ref, /^sha256:/);
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes("cache") && !serialized.includes("benchmark"),
      "hypothesis/experiment text never enters the record");
    assert.deepEqual(record.metric, { name: "latency-ms", comparator: "<=", target: 100 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("experiment failures and non-numeric measurements fail closed without leaking", async () => {
  const thrown = await runResearch(spec(), {
    attended: true, toggles: ON,
    runExperiment: () => { throw new Error("SECRET path " + "/Us" + "ers/nobody"); }, // split so repo scanners don't self-match
  });
  assert.equal(thrown.code, RESEARCH_CODES.EXPERIMENT_FAILED);
  assert.ok(!JSON.stringify(thrown).includes("SECRET"));

  const bad = await runResearch(spec(), {
    attended: true, toggles: ON,
    runExperiment: async () => ({ measurement: "fast" }),
  });
  assert.equal(bad.code, RESEARCH_CODES.MEASUREMENT_INVALID);
});
