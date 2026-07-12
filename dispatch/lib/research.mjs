// Helix dispatch — autoresearch machinery (M7, owner interview 2026-07-09).
//
// Research is an EXPLICIT verb, never auto-triggered. What is mandatory is the
// SHAPE: a run refuses to start without a declared metric {name, comparator,
// target} and stop condition. The loop is hypothesis → experiment → measure →
// compare → iterate, with exactly four stop reasons:
//   target-met            the declared measurement met the declared target
//   max-iterations        the iteration rail exhausted
//   diminishing-returns   no improvement across N consecutive iterations
//   dead-end              the hypothesis was refuted with no successor —
//                         reported as a VALUABLE RESULT, not a failure
//
// Attended only (deps.attended !== true refuses). autoresearch toggle OFF is
// an explicit conflict (toggle-disabled:autoresearch). loops toggle OFF
// degenerates to ONE-SHOT research: one experiment, one measurement, report.
//
// Research records are structural: hypothesis/experiment/question hashes, the
// metric, per-iteration measurements and verdicts, the stop reason. The text
// of hypotheses and experiments stays worktree-local — never persisted here.

import { join } from "node:path";
import { validate } from "./schema.mjs";
import { hashRef, assertPublicSafe, stableStringify } from "./run-record.mjs";
import {
  requireToggle,
  validateSettings,
  SETTINGS_SCHEMA_VERSION,
} from "./settings.mjs";
import { MAX_ITERATIONS } from "./limits.mjs";
import { writeTextAtomic } from "./persistence.mjs";

export const RESEARCH_CODES = Object.freeze({
  INVALID_SPEC: "research-invalid-spec",
  MISSING_METRIC: "research-missing-metric",
  MISSING_STOP: "research-missing-stop",
  REQUIRES_ATTENDED: "research-requires-attended",
  EXPERIMENT_FAILED: "research-experiment-failed",
  MEASUREMENT_INVALID: "research-measurement-invalid",
  INVALID_TOGGLES: "research-invalid-toggles",
});

export const RESEARCH_STOP_REASONS = Object.freeze([
  "target-met",
  "max-iterations",
  "diminishing-returns",
  "dead-end",
]);

const COMPARATORS = Object.freeze([">=", "<=", ">", "<", "=="]);
const STRICT_NUMBER_TOKEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parse one complete finite decimal/scientific token without coercion. */
export function parseStrictNumberToken(token) {
  if (typeof token !== "string" || !STRICT_NUMBER_TOKEN.test(token)) {
    return { ok: false, value: null };
  }
  const value = Number(token);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: null };
}

export const RESEARCH_SPEC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["run_id", "question", "hypothesis", "experiment", "metric", "stop"],
  properties: {
    run_id: { type: "string", pattern: "^[A-Za-z0-9._-]+$" },
    question: { type: "string", minLength: 1 },
    hypothesis: { type: "string", minLength: 1 },
    experiment: { type: "string", minLength: 1 },
    metric: {
      type: "object",
      additionalProperties: false,
      required: ["name", "comparator", "target"],
      properties: {
        name: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._-]*$" },
        comparator: { type: "string", enum: COMPARATORS },
        target: { type: "number" },
      },
    },
    stop: {
      type: "object",
      additionalProperties: false,
      required: ["max_iterations"],
      properties: {
        max_iterations: { type: "integer", minimum: 1, maximum: MAX_ITERATIONS },
        diminishing_returns_after: { type: "integer", minimum: 1, maximum: MAX_ITERATIONS },
      },
    },
  },
});

function researchFailure(code, detail = null, warnings = []) {
  return { ok: false, code, detail, iterations: [], warnings: [...warnings] };
}

/**
 * Validate every research boundary without starting an experiment or touching
 * the record directory. The CLI uses this before reserving a run id; the engine
 * uses the same result so the two surfaces cannot drift.
 */
export function preflightResearch(spec, deps = {}) {
  if (deps.toggles != null) {
    const toggleShape = validateSettings({
      schema_version: SETTINGS_SCHEMA_VERSION,
      toggles: deps.toggles,
    });
    if (!toggleShape.valid) {
      return researchFailure(
        RESEARCH_CODES.INVALID_TOGGLES,
        toggleShape.errors.map((error) => `${error.path} ${error.message}`).join("; "),
      );
    }
    const gate = requireToggle({ toggles: deps.toggles }, "autoresearch");
    if (!gate.ok) return researchFailure(gate.code);
  }
  if (deps.attended !== true) return researchFailure(RESEARCH_CODES.REQUIRES_ATTENDED);

  if (spec == null || typeof spec !== "object") return researchFailure(RESEARCH_CODES.INVALID_SPEC);
  if (spec.metric == null) return researchFailure(RESEARCH_CODES.MISSING_METRIC);
  if (spec.stop == null) return researchFailure(RESEARCH_CODES.MISSING_STOP);
  const shape = validate(RESEARCH_SPEC_SCHEMA, spec, "$");
  if (!shape.valid) {
    return researchFailure(
      RESEARCH_CODES.INVALID_SPEC,
      shape.errors.map((error) => `${error.path} ${error.message}`).join("; "),
    );
  }
  if (spec.stop.diminishing_returns_after > spec.stop.max_iterations) {
    return researchFailure(
      RESEARCH_CODES.INVALID_SPEC,
      "$.stop.diminishing_returns_after must be <= $.stop.max_iterations",
    );
  }
  if (typeof deps.runExperiment !== "function") {
    return researchFailure(RESEARCH_CODES.EXPERIMENT_FAILED, "missing-run-experiment");
  }

  const loopsEnabled = !deps.toggles || deps.toggles.loops !== false;
  const warnings = loopsEnabled ? [] : ["loops-off-one-shot-research"];
  return {
    ok: true,
    loops_enabled: loopsEnabled,
    max_iterations: loopsEnabled ? spec.stop.max_iterations : 1,
    plateau_after: spec.stop.diminishing_returns_after ?? null,
    warnings,
  };
}

function metricMet(comparator, measurement, target) {
  switch (comparator) {
    case ">=": return measurement >= target;
    case "<=": return measurement <= target;
    case ">": return measurement > target;
    case "<": return measurement < target;
    case "==": return measurement === target;
    default: return false;
  }
}

/** Whether `next` improves on `prev` in the target's direction. */
function improved(comparator, prev, next, target) {
  if (prev == null) return true; // the first measurement is always progress
  if (comparator === ">=" || comparator === ">") return next > prev;
  if (comparator === "<=" || comparator === "<") return next < prev;
  // Equality improves only by moving closer to the declared target. Treating
  // every change as progress lets arbitrarily worse oscillations evade the
  // diminishing-returns stop until the global rail.
  return Math.abs(next - target) < Math.abs(prev - target);
}

/**
 * Run the research loop.
 *
 * @param {object} spec see RESEARCH_SPEC_SCHEMA — refuses without metric+stop.
 * @param {object} deps {
 *   attended: boolean (must be true — research is attended only),
 *   toggles?: the six-boolean vector,
 *   runExperiment: async (iteration, ctx) => {
 *     measurement: number, refuted?: boolean, has_successor?: boolean },
 *   record_dir?: directory for the structural research record,
 *   onEvent?: (event) => void  structural progress hook,
 * }
 * @returns {Promise<object>} { ok, code?, stop_reason?, iterations, record?,
 *   record_path?, warnings }
 */
export async function runResearch(spec, deps = {}) {
  const preflight = preflightResearch(spec, deps);
  if (!preflight.ok) return preflight;
  const warnings = [...preflight.warnings];
  const fail = (code, detail = null) => researchFailure(code, detail, warnings);

  const maxIterations = preflight.max_iterations;
  const plateauAfter = preflight.plateau_after;

  const iterations = [];
  let best = null;
  let plateau = 0;
  let stopReason = null;

  for (let i = 1; i <= maxIterations; i += 1) {
    let outcome;
    try {
      outcome = await deps.runExperiment(i, { run_id: spec.run_id, iteration: i, metric: spec.metric });
    } catch {
      return fail(RESEARCH_CODES.EXPERIMENT_FAILED, `iteration-${i}`);
    }
    const measurement = outcome?.measurement;
    if (typeof measurement !== "number" || !Number.isFinite(measurement)) {
      return fail(RESEARCH_CODES.MEASUREMENT_INVALID, `iteration-${i}`);
    }

    let verdict;
    if (metricMet(spec.metric.comparator, measurement, spec.metric.target)) {
      verdict = "target-met";
      stopReason = "target-met";
    } else if (outcome.refuted === true && outcome.has_successor !== true) {
      verdict = "refuted";
      stopReason = "dead-end";
    } else {
      const gain = improved(spec.metric.comparator, best, measurement, spec.metric.target);
      verdict = gain ? "improved" : "no-improvement";
      plateau = gain ? 0 : plateau + 1;
      if (gain) best = measurement;
      else if (best == null) best = measurement;
      if (plateauAfter != null && plateau >= plateauAfter) stopReason = "diminishing-returns";
    }

    iterations.push({ iteration: i, measurement, verdict });
    if (typeof deps.onEvent === "function") {
      deps.onEvent({ kind: "research-iteration", run_id: spec.run_id, iteration: i, measurement, verdict });
    }
    if (stopReason) break;
  }

  if (!stopReason) stopReason = "max-iterations";

  // --- structural record ---------------------------------------------------------
  const record = {
    schema_version: 1,
    run_id: spec.run_id,
    question_ref: hashRef(spec.question),
    hypothesis_ref: hashRef(spec.hypothesis),
    experiment_ref: hashRef(spec.experiment),
    metric: { ...spec.metric },
    iterations,
    stop_reason: stopReason,
    warnings: [...warnings],
  };
  assertPublicSafe(record);
  let record_path = null;
  if (typeof deps.record_dir === "string") {
    record_path = join(deps.record_dir, `${spec.run_id}.research.json`);
    writeTextAtomic(deps.record_dir, `${spec.run_id}.research.json`, stableStringify(record) + "\n");
  }

  // A dead-end is a VALUABLE RESULT: the run is ok — the knowledge converged
  // on "this hypothesis is false". Only rail exhaustion is not-ok.
  const ok = stopReason === "target-met" || stopReason === "dead-end";
  return { ok, stop_reason: stopReason, iterations, record, record_path, warnings };
}
