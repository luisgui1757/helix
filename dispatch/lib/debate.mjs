// Helix dispatch — bounded iterating multi-team / adversarial debate loop.
//
// Adversarial/multi-team debate is first-class for meaningful work. Convergence
// is diff-stability plus objective-gate-pass; max iterations is the mandatory
// runaway rail. One iteration is exactly one
// dispatch cycle (candidate panel → optional judge → optional synthesis →
// objective/advisory gate → optional verifier), and the loop repeats that cycle
// only when the route calls for adversarial iteration and the gate has not
// converged.
//
// This layer is PURE orchestration OVER the dispatch substrate — it composes
// `runDispatch` and adds no policy of its own. Dependencies flow inward: the
// debate layer calls `runDispatch`; the dispatch core does NOT import this module
// (a dispatch can never start a debate, and the recursion fence in runDispatch
// still caps depth at one per cycle).
//
// Convergence is EXACTLY diff-stability + objective-gate-pass. Model consensus,
// judge approval, verifier approval, and synthesis confidence are never final
// authority: the only convergence signals are (a) an OBJECTIVE gate result of
// "pass" (from process exit status or a deterministic checker — never a model
// narrative), captured in the run record, and (b) a deterministic, injected
// diff-stability checker. Both are deterministic checkers, not models.
//
// `max_iterations` is the ONE mandatory rail (a time/runaway control) and fails
// closed BEFORE any iteration starts: a missing, unsafe, or over-limit value
// refuses the debate. There is no cost control here — spend is bounded by the backend
// control instance (owner decision, 2026-07-09). The loop preserves every
// fail-closed structural/public-safety behavior of the cycle (a hard fail-closed
// inside an iteration stops the debate; it is never retried), and it is
// deterministic under mock adapters: a fixed seed/input yields stable
// per-iteration records and a stable final debate summary.
//
// The loop connects to real local signals through two injected boundary
// effects, keeping this core pure: `diffStability` can be the real git working-tree
// surface (`makeGitDiffStability`, dispatch/lib/git-diff-surface.mjs), and an
// optional `revise` effect produces the next proposal in the worktree between
// non-converged iterations (the only thing allowed to mutate it). Revision state
// threads as refs/hashes only; a failed revision stops fail-closed and preserves
// the iteration evidence already produced. Default-on adversarial policy for
// meaningful work (and the `/adversarial off` opt-out code) comes from the pure
// `adversarial-policy.mjs` surface. All worktree/git side effects stay in the
// injected effects — the debate core still adds no policy of its own.

import { join } from "node:path";
import { validate, SchemaError } from "./schema.mjs";
import { runDispatch } from "./orchestrate.mjs";
import { routeForClass } from "./routes.mjs";
import { resolveAdversarialPolicy } from "./adversarial-policy.mjs";
import { validateRunRecord, assertPublicSafe, stableStringify, REF_PATTERN } from "./run-record.mjs";
import { MAX_ITERATIONS } from "./limits.mjs";
import { writeTextAtomic } from "./persistence.mjs";

/** run_id / debate_id token shape (same as the dispatch request boundary). */
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Structural stable-code token for an injected diff-stability `code`: lowercase
 * stable-code characters only. This keeps the diff code a MARKER (like a gate
 * command name), never prose — a free-form/human-readable code is refused before
 * it can reach the public debate summary, independent of any leak-pattern scan.
 */
const DIFF_CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
const SUMMARY_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

const DEBATE_ITERATION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "iteration", "run_id", "task_class", "route_id", "exit_status",
    "gate_kind", "gate_result", "gate_source", "gate_pass", "diff_result",
    "diff_code", "converged", "tokens_used", "cumulative_tokens", "warning_codes",
  ],
  properties: {
    iteration: { type: "integer", minimum: 1, maximum: MAX_ITERATIONS },
    run_id: { type: "string", pattern: RUN_ID_PATTERN },
    task_class: { type: "string", pattern: SUMMARY_CODE_PATTERN },
    route_id: { type: "string", pattern: SUMMARY_CODE_PATTERN },
    exit_status: { type: "string", enum: ["ok", "blocked", "fail-closed"] },
    gate_kind: { type: "string", enum: ["objective", "advisory"] },
    gate_result: { type: "string", enum: ["pass", "fail", "not-run"] },
    gate_source: { type: "string", enum: ["exit-status", "deterministic-checker", "advisory"] },
    gate_pass: { type: "boolean" },
    diff_result: { type: "string", enum: ["stable", "unstable", "not-run"] },
    diff_code: { type: "string", pattern: DIFF_CODE_PATTERN },
    converged: { type: "boolean" },
    tokens_used: { type: "integer", minimum: 0 },
    cumulative_tokens: { type: "integer", minimum: 0 },
    warning_codes: { type: "array", items: { type: "string", pattern: SUMMARY_CODE_PATTERN } },
  },
});

const DEBATE_REVISION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["after_iteration", "run_id", "revision_ref"],
  properties: {
    after_iteration: { type: "integer", minimum: 1, maximum: MAX_ITERATIONS },
    run_id: { type: "string", pattern: RUN_ID_PATTERN },
    revision_ref: { type: "string", pattern: REF_PATTERN },
  },
});

export const DEBATE_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version", "run_id", "timestamp", "kind", "adversarial", "converged",
    "stop_reason", "iterations_run", "max_iterations", "total_tokens",
    "iterations", "warning_codes",
  ],
  properties: {
    schema_version: { const: 2 },
    run_id: { type: "string", pattern: RUN_ID_PATTERN },
    timestamp: { type: "integer", minimum: 0 },
    kind: { const: "adversarial-debate" },
    adversarial: { type: "boolean" },
    converged: { type: "boolean" },
    stop_reason: { type: "string", pattern: DIFF_CODE_PATTERN },
    iterations_run: { type: "integer", minimum: 1, maximum: MAX_ITERATIONS },
    max_iterations: { type: "integer", minimum: 1, maximum: MAX_ITERATIONS },
    total_tokens: { type: "integer", minimum: 0 },
    iterations: { type: "array", minItems: 1, items: DEBATE_ITERATION_SCHEMA },
    revisions: { type: "array", items: DEBATE_REVISION_SCHEMA },
    warning_codes: { type: "array", items: { type: "string", pattern: SUMMARY_CODE_PATTERN } },
  },
});

function summaryError(path, message) {
  return { path, message };
}

/** Closed validation for persisted debate summaries and run-manager reads. */
export function validateDebateSummary(summary) {
  const structural = validate(DEBATE_SUMMARY_SCHEMA, summary, "$");
  const errors = [...structural.errors];
  if (structural.valid) {
    if (summary.iterations_run !== summary.iterations.length) {
      errors.push(summaryError("$.iterations_run", "must equal $.iterations.length"));
    }
    if (summary.iterations_run > summary.max_iterations) {
      errors.push(summaryError("$.iterations_run", "must be <= $.max_iterations"));
    }

    let cumulative = 0;
    summary.iterations.forEach((iteration, index) => {
      const ordinal = index + 1;
      if (iteration.iteration !== ordinal) {
        errors.push(summaryError(`$.iterations[${index}].iteration`, `must equal ${ordinal}`));
      }
      if (iteration.run_id !== `${summary.run_id}-iter${ordinal}`) {
        errors.push(summaryError(`$.iterations[${index}].run_id`, "must match the parent run and iteration"));
      }
      const gatePass = iteration.gate_kind === "objective"
        && iteration.gate_result === "pass"
        && (iteration.gate_source === "exit-status" || iteration.gate_source === "deterministic-checker");
      if (iteration.gate_pass !== gatePass) {
        errors.push(summaryError(`$.iterations[${index}].gate_pass`, "must agree with the structural gate fields"));
      }
      if (iteration.converged !== (gatePass && iteration.diff_result === "stable")) {
        errors.push(summaryError(`$.iterations[${index}].converged`, "must equal objective-gate-pass and stable diff"));
      }
      cumulative += iteration.tokens_used;
      if (!Number.isSafeInteger(cumulative)) {
        errors.push(summaryError(`$.iterations[${index}].cumulative_tokens`, "cumulative token total is not a safe integer"));
      } else if (iteration.cumulative_tokens !== cumulative) {
        errors.push(summaryError(`$.iterations[${index}].cumulative_tokens`, "must equal the cumulative tokens used"));
      }
    });
    if (Number.isSafeInteger(cumulative) && summary.total_tokens !== cumulative) {
      errors.push(summaryError("$.total_tokens", "must equal the final cumulative token count"));
    }

    const convergedIterations = summary.iterations.filter((iteration) => iteration.converged);
    if (summary.converged) {
      if (summary.stop_reason !== "converged" || convergedIterations.length !== 1
          || summary.iterations.at(-1)?.converged !== true) {
        errors.push(summaryError("$.converged", "must agree with the final iteration and converged stop reason"));
      }
    } else if (convergedIterations.length > 0 || summary.stop_reason === "converged") {
      errors.push(summaryError("$.converged", "false summaries must not contain a converged iteration or stop reason"));
    }

    let previousRevision = 0;
    for (let index = 0; index < (summary.revisions ?? []).length; index += 1) {
      const revision = summary.revisions[index];
      if (revision.after_iteration <= previousRevision || revision.after_iteration > summary.iterations_run) {
        errors.push(summaryError(
          `$.revisions[${index}].after_iteration`,
          "must be unique, increasing, and reference a completed iteration",
        ));
      }
      if (revision.run_id !== `${summary.run_id}-iter${revision.after_iteration}`) {
        errors.push(summaryError(`$.revisions[${index}].run_id`, "must match the referenced iteration"));
      }
      previousRevision = revision.after_iteration;
    }
  }
  try {
    assertPublicSafe(summary);
  } catch {
    errors.push(summaryError("$", "public-safety scan failed"));
  }
  return { valid: errors.length === 0, errors };
}

function stableCode(value, fallback) {
  return typeof value === "string" && DIFF_CODE_PATTERN.test(value) ? value : fallback;
}

/** The debate loop request: a per-iteration dispatch request plus the one mandatory rail. */
export const DEBATE_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["run_id", "base_request"],
  properties: {
    run_id: { type: "string", pattern: "^[A-Za-z0-9._-]+$" },
    // The dispatch request run through each iteration. Its own run_id is a
    // placeholder — the loop overrides it with a deterministic per-iteration id
    // (`${run_id}-iter${N}`). Fully validated by runDispatch's request boundary.
    base_request: { type: "object" },
    // The one mandatory rail. Presence/bounds are checked explicitly below (not
    // as a schema constraint) so missing vs unbounded gets its own stable code.
    max_iterations: {},
  },
});

/**
 * Whether a route calls for adversarial iteration: it is meaningful work (has an
 * adversarial role) AND the request did not opt out (`disable_adversarial`).
 * Delegates to the shared default-on policy surface so the debate loop and the
 * policy module agree on exactly one definition.
 *
 * @param {object|null} route a ROUTE_CONFIG_SCHEMA-shaped route (or null)
 * @param {object} baseRequest the per-iteration dispatch request
 * @returns {boolean}
 */
export function routeCallsForAdversarialIteration(route, baseRequest) {
  return resolveAdversarialPolicy(route, baseRequest).effective_on;
}

/** Total tokens an iteration consumed (capacity telemetry, never enforcement). */
function iterationTokens(record) {
  const u = record?.usage_rollup;
  const total = (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0);
  return Number.isFinite(total) ? total : 0;
}

/** An objective-gate PASS is the only gate signal that counts toward convergence. */
function objectiveGatePass(record) {
  const gate = record?.gate;
  return !!gate
    && gate.kind === "objective"
    && gate.result === "pass"
    && (gate.source === "exit-status" || gate.source === "deterministic-checker");
}

/**
 * Build one structural iteration summary from a run record. Used by BOTH the normal
 * convergence path and the fail-closed path, so a hard-failed iteration that still
 * produced a valid record keeps its usage/warning evidence (never discarded).
 * `cumulative` is the running token total AFTER this iteration's tokens are added
 * (capacity telemetry for the loop-cue history strip — never enforcement).
 */
function buildIterationSummary(record, i, iterationRunId, cumulative, { gatePass, diffResult, diffCode, converged }) {
  return {
    iteration: i + 1,
    run_id: iterationRunId,
    task_class: record.task_class,
    route_id: record.route_id,
    exit_status: record.exit_status,
    gate_kind: record.gate.kind,
    gate_result: record.gate.result,
    gate_source: record.gate.source,
    gate_pass: gatePass,
    diff_result: diffResult,
    diff_code: diffCode,
    converged,
    tokens_used: iterationTokens(record),
    cumulative_tokens: cumulative,
    warning_codes: [...record.warning_codes],
  };
}

/**
 * Evaluate the injected diff-stability checker for one iteration and enforce that
 * it is a deterministic checker with a structural result. Returns
 * `{ stable, code }` or throws a stable code string for the loop to fail closed on.
 *
 * The checker is a BOUNDARY EFFECT, like `runGate`: it decides whether the
 * proposed change has stopped changing across iterations. It must be deterministic
 * (probed by calling it twice with the same input and requiring an identical
 * result) and structural: `{ stable: boolean, code: string }` where `code` matches
 * `DIFF_CODE_PATTERN` — a lowercase stable-code MARKER (like a gate command name),
 * not prose. Free-form/human-readable codes are refused here as `diff-checker-invalid`
 * before they can reach the public debate summary, independent of the leak scan.
 */
function evaluateDiffStability(checker, prevRecord, currRecord, ctx) {
  if (typeof checker !== "function") throw "diff-checker-unavailable";
  const first = checker(prevRecord, currRecord, ctx);
  const second = checker(prevRecord, currRecord, ctx);
  const shapeOk = (v) => v && typeof v === "object"
    && typeof v.stable === "boolean"
    && typeof v.code === "string" && DIFF_CODE_PATTERN.test(v.code);
  if (!shapeOk(first)) throw "diff-checker-invalid";
  // Determinism probe: a checker keyed on ambient randomness/clock (or on hidden
  // mutable state) is refused — the loop's determinism guarantee depends on it.
  if (stableStringify(first) !== stableStringify(second)) throw "non-deterministic-diff-checker";
  return { stable: first.stable, code: first.code };
}

function uniqueInOrder(values) {
  return [...new Set(values)];
}

/**
 * Run a bounded iterating multi-team / adversarial debate. Each iteration is one
 * `runDispatch` cycle; the loop repeats only for adversarial routes that have not
 * converged, and only within the mandatory hard caps.
 *
 * @param {object} request see DEBATE_REQUEST_SCHEMA:
 *   { run_id, base_request, max_iterations }
 * @param {object} deps injected effects:
 *   adapter / runGate / now / seed / mode / record_dir / parallel — passed straight
 *     through to runDispatch (same contract, unchanged).
 *   diffStability: (prevRecord|null, currRecord, ctx) → { stable, code } — the
 *     deterministic, injected diff-stability checker (required; unavailable or
 *     non-deterministic fails closed). Wire the REAL git surface via
 *     `makeGitDiffStability` (dispatch/lib/git-diff-surface.mjs).
 *   revise?: (revisionState|null, ctx) → { ok, revision_ref, code? } — OPTIONAL
 *     revision boundary. When present, it runs between non-converged
 *     adversarial iterations to produce the next proposal in the worktree; the
 *     debate core stays pure (all mutation is inside this injected effect). It must
 *     return a structural ref/hash (`revision_ref`), never free text; `ok !== true`,
 *     a thrown error, or a non-ref result fails the debate closed
 *     (`revision-failed` / `revision-invalid`) while preserving prior iteration
 *     evidence. Absent means no revision step.
 * @returns {Promise<object>} structured debate result:
 *   { ok, status: "ok"|"fail-closed", converged, code?, detail?, run_id,
 *     iterations_run, max_iterations, total_tokens, stop_reason,
 *     iterations, revisions, warnings, summary, summary_path? }
 *   A structural, public-safe debate summary is built (and written when record_dir
 *   is set) for every outcome that ran at least one iteration; pre-iteration stops
 *   (invalid request, missing/unbounded caps, unavailable checker) return
 *   summary: null.
 */
export async function runDebate(request, deps = {}) {
  // A malformed non-object request fails closed WITHOUT dereferencing request
  // fields (which would throw on null/undefined) — return a well-formed result.
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    return {
      ok: false, status: "fail-closed", converged: false,
      code: "invalid-debate-request", detail: "debate request must be an object",
      run_id: null, iterations_run: 0, max_iterations: null,
      total_tokens: 0, stop_reason: "invalid-debate-request",
      iterations: [], revisions: [], warnings: [], summary: null, summary_path: null,
    };
  }
  const warnings = [];
  const iterations = [];
  // Structural revision evidence (refs/counts only; empty ⇒ no revision effect ran,
  // preserving the no-revision summary shape). Populated by the revision boundary.
  const revisions = [];
  // Mutable loop state referenced by the summary builder (declared up front so the
  // summary builder's closure never touches it before initialization).
  const state = { adversarial: false };

  // Terminal-result builders. The debate summary is assembled/persisted only once
  // an iteration has run (an empty debate has nothing structural to summarize).
  const buildSummary = (converged, stopReason, totalTokens) => ({
    schema_version: 2,
    run_id: request.run_id,
    timestamp: deps.now,
    kind: "adversarial-debate",
    adversarial: state.adversarial,
    converged,
    stop_reason: stopReason,
    iterations_run: iterations.length,
    max_iterations: request.max_iterations,
    total_tokens: totalTokens,
    iterations: iterations.map((it) => ({ ...it, warning_codes: [...it.warning_codes] })),
    // Structural revision evidence, included only when a revision effect ran so a
    // pure no-revision debate summary stays byte-identical.
    ...(revisions.length ? { revisions: revisions.map((r) => ({ ...r })) } : {}),
    warning_codes: uniqueInOrder(warnings),
  });

  const finish = (ok, converged, stopReason, code, detail, totalTokens) => {
    let summary = null;
    let summary_path = null;
    if (iterations.length > 0) {
      summary = buildSummary(converged, stopReason, totalTokens);
      const summaryValid = validateDebateSummary(summary);
      if (!summaryValid.valid) {
        const publicUnsafe = summaryValid.errors.some((error) => error.message === "public-safety scan failed");
        return {
          ok: false,
          status: "fail-closed",
          converged: false,
          code: publicUnsafe ? "public-safety-violation" : "debate-summary-invalid",
          detail: publicUnsafe ? "debate summary failed the public-safety scan" : "debate summary failed structural validation",
          run_id: request.run_id, iterations_run: iterations.length,
          max_iterations: request.max_iterations,
          total_tokens: totalTokens,
          stop_reason: publicUnsafe ? "public-safety-violation" : "debate-summary-invalid",
          iterations, revisions, warnings: uniqueInOrder(warnings), summary: null,
        };
      }
      if (typeof deps.record_dir === "string") {
        try {
          summary_path = writeDebateSummary(summary, deps.record_dir);
        } catch (error) {
          return {
            ok: false, status: "fail-closed", converged: false, code: "debate-summary-write-failed",
            detail: "debate summary write failed",
            run_id: request.run_id, iterations_run: iterations.length,
            max_iterations: request.max_iterations,
            total_tokens: totalTokens, stop_reason: "debate-summary-write-failed",
            iterations, revisions, warnings: uniqueInOrder(warnings), summary,
          };
        }
      }
    }
    return {
      ok, status: ok ? "ok" : "fail-closed", converged,
      code: code ?? null, detail: detail ?? null,
      run_id: request.run_id, iterations_run: iterations.length,
      max_iterations: request.max_iterations,
      total_tokens: totalTokens, stop_reason: stopReason,
      iterations, revisions, warnings: uniqueInOrder(warnings), summary, summary_path,
    };
  };

  const failClosed = (code, detail, totalTokens = 0) =>
    finish(false, false, code, code, detail, totalTokens);

  // First-iteration adversarial-policy resolution: default-on for meaningful work,
  // recording a structural opt-out code when the user disabled adversarial review.
  const applyAdversarialPolicy = (record) => {
    const policy = resolveAdversarialPolicy(routeForClass(record.task_class), request.base_request);
    state.adversarial = policy.effective_on;
    for (const w of policy.warnings) warnings.push(w);
  };

  // --- request boundary -------------------------------------------------------
  const shape = validate(DEBATE_REQUEST_SCHEMA, request, "$");
  if (!shape.valid) {
    return failClosed("invalid-debate-request", shape.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  }

  // --- the one mandatory rail (fail closed BEFORE any iteration) ---------------
  // A missing or unbounded max_iterations refuses the debate — an iterating,
  // gate-seeking loop must never run without a concrete finite ceiling.
  if (!("max_iterations" in request) || request.max_iterations == null) {
    return failClosed("missing-max-iterations", "deps request must set a finite max_iterations >= 1");
  }
  if (!Number.isSafeInteger(request.max_iterations)
      || request.max_iterations < 1
      || request.max_iterations > MAX_ITERATIONS) {
    return failClosed(
      "unbounded-max-iterations",
      `max_iterations must be a safe integer from 1 through ${MAX_ITERATIONS}, got ${JSON.stringify(request.max_iterations)}`,
    );
  }

  // --- diff-stability checker availability (fail closed before iterating) ------
  if (typeof deps.diffStability !== "function") {
    return failClosed("diff-checker-unavailable", "deps.diffStability (deterministic diff-stability checker) is required");
  }

  // --- revision boundary availability (optional but validated) ----------------
  // The revision effect is optional. If supplied it
  // must be a function; a present-but-malformed effect fails closed rather than
  // being silently ignored.
  if (deps.revise != null && typeof deps.revise !== "function") {
    return failClosed("invalid-revision-effect", "deps.revise, when present, must be a function");
  }

  // Pass-through dispatch deps (the debate layer adds no policy of its own).
  const dispatchDeps = {
    adapter: deps.adapter,
    runGate: deps.runGate,
    now: deps.now,
    seed: deps.seed,
    mode: deps.mode,
    record_dir: deps.record_dir,
    ...(deps.parallel != null ? { parallel: deps.parallel } : {}),
    ...(deps.toggles != null ? { toggles: deps.toggles } : {}),
  };

  let cumulativeTokens = 0;
  let prevRecord = null;
  // Threaded structural revision state (refs/hashes only, never free text).
  let revisionState = null;

  for (let i = 0; i < request.max_iterations; i++) {
    const iterationRunId = `${request.run_id}-iter${i + 1}`;
    const iterationRequest = { ...request.base_request, run_id: iterationRunId };

    const result = await runDispatch(iterationRequest, dispatchDeps);

    // A TUI escalation cannot be resolved inside the loop (no UI here).
    if (result.status === "escalate") {
      return failClosed("iteration-escalation-unresolved", `iteration ${i + 1}: ${result.code ?? "escalation"}`, cumulativeTokens);
    }
    // A hard fail-closed (adapter error, cap, envelope, missing config, public
    // safety, …) is a REFUSAL, not a non-convergence — stop and propagate. It is
    // never retried: the substrate refused, the proposal did not merely need
    // another round. But its usage/cap evidence is NOT discarded: a cycle that
    // launched candidates and then tripped a per-cycle cap still returns a valid
    // structural record, which is appended as an iteration summary before stopping.
    if (result.status === "fail-closed") {
      const innerCode = result.code ?? "unknown";
      warnings.push(`iteration-fail-closed:${innerCode}`);
      if (result.record && validateRunRecord(result.record).valid) {
        const record = result.record;
        if (i === 0) applyAdversarialPolicy(record);
        cumulativeTokens += iterationTokens(record);
        iterations.push(buildIterationSummary(record, i, iterationRunId, cumulativeTokens, {
          gatePass: objectiveGatePass(record),
          diffResult: "not-run", // the diff checker never ran on a refused iteration
          diffCode: "iteration-fail-closed",
          converged: false,
        }));
        for (const w of record.warning_codes) warnings.push(w);
        return failClosed("iteration-fail-closed", `iteration ${i + 1}: ${innerCode}${result.detail ? ` (${result.detail})` : ""}`, cumulativeTokens);
      }
      // A fail-closed with NO valid record is a pre-panel stop (malformed request,
      // unusable/unknown profile, classification stop, missing clock/adapter) — there
      // is no structural evidence to append; fail closed with a documented code.
      return failClosed("iteration-fail-closed-no-record", `iteration ${i + 1}: fail-closed (${innerCode}) produced no valid run record`, cumulativeTokens);
    }
    // Only status "ok" (objective gate pass / advisory success) or "blocked"
    // (objective gate fail) remain. Either must carry a valid structural record.
    if (!result.record || !validateRunRecord(result.record).valid) {
      return failClosed("invalid-iteration-output", `iteration ${i + 1}: missing or invalid run record`, cumulativeTokens);
    }
    const record = result.record;

    // Determine adversarial posture from the resolved route (first iteration):
    // default-on for meaningful work, recording a structural opt-out code.
    if (i === 0) applyAdversarialPolicy(record);

    // Convergence signals: objective-gate-pass + deterministic diff-stability.
    const gatePass = objectiveGatePass(record);
    let diff;
    try {
      diff = evaluateDiffStability(deps.diffStability, prevRecord, record, {
        iteration: i + 1,
        run_id: iterationRunId,
        previous_run_id: prevRecord ? prevRecord.run_id : null,
      });
    } catch (code) {
      return failClosed(stableCode(code, "diff-checker-invalid"), `iteration ${i + 1}: diff-stability checker`, cumulativeTokens);
    }
    const converged = gatePass && diff.stable;

    cumulativeTokens += iterationTokens(record);
    iterations.push(buildIterationSummary(record, i, iterationRunId, cumulativeTokens, {
      gatePass,
      diffResult: diff.stable ? "stable" : "unstable",
      diffCode: diff.code,
      converged,
    }));
    for (const w of record.warning_codes) warnings.push(w);

    if (converged) {
      return finish(true, true, "converged", null, null, cumulativeTokens);
    }
    // Non-adversarial routes are single-pass: run once, never repeat. If the one
    // pass did not converge, fail closed (a gateless/advisory route can never
    // objective-gate-pass, so it correctly cannot converge).
    if (!state.adversarial) {
      return failClosed("single-pass-not-converged", `single-pass route did not converge (gate ${record.gate.result}/${record.gate.kind}, diff ${diff.stable ? "stable" : "unstable"})`, cumulativeTokens);
    }

    // --- revision boundary -----------------------------------------------------
    // Another adversarial iteration WILL run, so produce the next proposal through
    // the injected revision effect (the only thing allowed to mutate the worktree).
    // The debate core stays pure; a failed revision stops fail-closed with a stable
    // code and preserves the iteration evidence already appended above. Skipped on
    // the final iteration (no successor iteration would observe it).
    if (typeof deps.revise === "function" && i + 1 < request.max_iterations) {
      const reviseCtx = { iteration: i + 1, run_id: iterationRunId, previous_run_id: prevRecord ? prevRecord.run_id : null };
      let rev;
      try {
        rev = await deps.revise(revisionState, reviseCtx);
      } catch {
        // A thrown revision effect can carry a private path / raw diff / model text
        // in its message — NEVER surface it (in detail, warnings, or the summary).
        // Only a fixed structural code is returned.
        warnings.push("revision-failed");
        return failClosed("revision-failed", `iteration ${i + 1}: revision effect failed`, cumulativeTokens);
      }
      if (!rev || typeof rev !== "object" || rev.ok !== true) {
        warnings.push("revision-failed");
        // A failure subcode is surfaced ONLY if it is a stable-code marker (a
        // free-form `rev.code` — a private path, raw failure reason, model text — is
        // dropped, never interpolated into detail).
        const sub = rev && typeof rev.code === "string" && DIFF_CODE_PATTERN.test(rev.code)
          ? ` (revision-subcode:${rev.code})` : "";
        return failClosed("revision-failed", `iteration ${i + 1}: revision effect failed${sub}`, cumulativeTokens);
      }
      // Revision state threads as a ref/hash only — never free text (public-safe).
      if (typeof rev.revision_ref !== "string" || !REF_PATTERN.test(rev.revision_ref)) {
        warnings.push("revision-invalid");
        return failClosed("revision-invalid", `iteration ${i + 1}: revision_ref must be a ref/hash, not free text`, cumulativeTokens);
      }
      revisionState = { revision_ref: rev.revision_ref, iteration: i + 1 };
      revisions.push({ after_iteration: i + 1, run_id: iterationRunId, revision_ref: rev.revision_ref });
    }

    prevRecord = record;
  }

  // Ran the full iteration budget without converging (gate never passed and/or the
  // diff never stabilized). This is the mandated fail-closed on objective-gate
  // failure after max_iterations — never a silent success.
  const last = iterations[iterations.length - 1];
  return failClosed(
    "not-converged-within-max-iterations",
    `${request.max_iterations} iteration(s) without convergence (last gate ${last.gate_result}/${last.gate_kind}, diff ${last.diff_result})`,
    cumulativeTokens,
  );
}

/**
 * Persist a debate summary to `${dir}/${run_id}.debate.json` (deterministic
 * filename, distinct from per-iteration `${run_id}-iterN.json` records). The
 * summary is re-scanned for public safety before writing. Returns the path.
 *
 * @param {object} summary a summary from runDebate
 * @param {string} dir output directory (the caller's gitignored records dir)
 */
export function writeDebateSummary(summary, dir) {
  if (!RUN_ID_PATTERN.test(summary?.run_id ?? "")) {
    throw new Error("debate-summary: run_id is not a safe filename token");
  }
  const valid = validateDebateSummary(summary);
  if (!valid.valid) throw new SchemaError("debate-summary", valid.errors);
  const path = join(dir, `${summary.run_id}.debate.json`);
  writeTextAtomic(dir, `${summary.run_id}.debate.json`, stableStringify(summary) + "\n");
  return path;
}
