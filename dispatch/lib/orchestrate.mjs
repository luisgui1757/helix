// Helix dispatch — thin one-cycle orchestrator over the policy core.
//
// Spend is bounded by the backend control instance, never by this harness.
// Scope: ONE dispatch cycle — classify → resolve route/panel → launch candidates
// through an injected adapter → validate every envelope at the boundary →
// blinded judge projection (advisory) → objective gate from exit status /
// deterministic checker → build a structural public-safe run record.
//
// The module is pure orchestration: no network, no credentials, no UI, no
// ambient clock or randomness (now/seed are injected), no retries/iterations,
// and recursion depth is exactly one — a dispatch can never start a dispatch.
// Fail-closed applies to STRUCTURE (malformed request/envelope/config); what
// models may do is unrestricted (Pi-default YOLO, by owner decision).

import { validate } from "./schema.mjs";
import { MODEL_ID_PATTERN } from "./public-values.mjs";
import { classify } from "./classify.mjs";
import { routeForClass, resolvePanel, validateRouteConfig, EFFORTS } from "./routes.mjs";
import { PROVIDER_ID_PATTERN, providerFamily, isAutomatedDispatchProvider } from "./providers.mjs";
import { ROLES, isRoleValidForStage, validateRoleEnvelope } from "./role-envelope.mjs";
import { projectCandidatesForJudge, evaluateJudgeSelection } from "./judge.mjs";
import { detectContradictions, contradictionsDropped, projectForSynthesis } from "./synthesis.mjs";
import { projectForVerification } from "./verification.mjs";
import { mapWithConcurrency } from "./parallel.mjs";
import { buildRunRecord, writeRunRecord, REF_PATTERN, PUBLIC_CODE_PATTERN } from "./run-record.mjs";
import { MAX_PANEL_MEMBERS } from "./limits.mjs";

/** One candidate to launch: which role/provider/model the adapter should run. */
const CANDIDATE_SPEC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["role", "provider", "model"],
  properties: {
    role: { type: "string", enum: ROLES },
    provider: { type: "string", pattern: PROVIDER_ID_PATTERN },
    model: { type: "string", pattern: MODEL_ID_PATTERN },
    effort: { type: "string", enum: EFFORTS },
  },
});

/** Judge configuration: rubric-first, provider/model policed like a candidate. */
const JUDGE_SPEC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["provider", "model", "rubric_id"],
  properties: {
    provider: { type: "string", pattern: PROVIDER_ID_PATTERN },
    model: { type: "string", pattern: MODEL_ID_PATTERN },
    effort: { type: "string", enum: EFFORTS },
    rubric_id: { type: "string", minLength: 1 },
    eligible_alternatives: { type: "array", items: { type: "string", minLength: 1 } },
    // Explicit permutation override (fixtures/tests); defaults to a
    // seed-derived permutation. Validated by projectCandidatesForJudge.
    permutation: { type: "array", items: { type: "integer", minimum: 0 } },
    reveals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "field", "reason"],
        properties: {
          index: { type: "integer", minimum: 0 },
          field: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
        },
      },
    },
  },
});

/** Synthesis configuration: provider/model policed like a candidate; rubric optional. */
const SYNTHESIS_SPEC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["provider", "model"],
  properties: {
    provider: { type: "string", pattern: PROVIDER_ID_PATTERN },
    model: { type: "string", pattern: MODEL_ID_PATTERN },
    effort: { type: "string", enum: EFFORTS },
    rubric_id: { type: "string", minLength: 1 },
  },
});

/** Verification configuration: provider/model policed like a candidate; rubric optional. */
const VERIFICATION_SPEC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["provider", "model"],
  properties: {
    provider: { type: "string", pattern: PROVIDER_ID_PATTERN },
    model: { type: "string", pattern: MODEL_ID_PATTERN },
    effort: { type: "string", enum: EFFORTS },
    rubric_id: { type: "string", minLength: 1 },
  },
});

export const DISPATCH_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["run_id", "task", "candidates", "claims_ref", "evidence_ref", "run_target"],
  properties: {
    run_id: { type: "string", pattern: "^[A-Za-z0-9._-]+$" },
    task: {
      type: "object",
      additionalProperties: false,
      properties: {
        class_hint: { type: "string" },
        signals: { type: "array", items: { type: "string" } },
        confident: { type: "boolean" },
        override: {
          type: "object",
          additionalProperties: false,
          properties: {
            task_class: { type: "string" },
            disable_adversarial: { type: "boolean" },
          },
        },
      },
    },
    candidates: { type: "array", minItems: 1, items: CANDIDATE_SPEC_SCHEMA },
    judge: JUDGE_SPEC_SCHEMA,
    synthesis: SYNTHESIS_SPEC_SCHEMA,
    verification: VERIFICATION_SPEC_SCHEMA,
    run_target: {
      type: "object",
      additionalProperties: false,
      required: ["repo"],
      properties: {
        repo: { type: "string", enum: ["self", "other"] },
        ref: { type: "string", minLength: 1 },
      },
    },
    branch: { type: "string", minLength: 1 },
    gate_file_paths: { type: "array", items: { type: "string", minLength: 1 } },
    input_refs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "value", "algorithm"],
        properties: {
          kind: { type: "string", enum: ["sha256", "redacted-id", "local-ref"] },
          value: { type: "string", minLength: 1 },
          algorithm: { anyOf: [{ type: "string", enum: ["sha256"] }, { type: "null" }] },
        },
      },
    },
    // Refs/hashes only — free text is rejected at this boundary (and again by
    // buildRunRecord).
    claims_ref: { type: "string", pattern: REF_PATTERN },
    evidence_ref: { type: "string", pattern: REF_PATTERN },
  },
});

/** Objective gates come from process exit status or a deterministic checker — never a model narrative. */
const OBJECTIVE_GATE_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["command_names", "result", "source"],
  properties: {
    command_names: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    result: { type: "string", enum: ["pass", "fail"] },
    source: { type: "string", enum: ["exit-status", "deterministic-checker"] },
    evidence_ref: { type: "string", pattern: REF_PATTERN },
  },
});

/** Advisory gates may also report not-run/advisory; they never decide success. */
const ADVISORY_GATE_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["command_names", "result", "source"],
  properties: {
    command_names: { type: "array", items: { type: "string", minLength: 1 } },
    result: { type: "string", enum: ["pass", "fail", "not-run"] },
    source: { type: "string", enum: ["exit-status", "deterministic-checker", "advisory"] },
    evidence_ref: { type: "string", pattern: REF_PATTERN },
  },
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic permutation of 0..n-1 from an integer seed (Fisher–Yates over a
 * mulberry32 stream). Same (n, seed) always yields the same order, so a judge
 * blinding permutation is reproducible from the recorded seed.
 */
export function seededPermutation(n, seed) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`seededPermutation: bad length ${n}`);
  if (!Number.isInteger(seed)) throw new Error("seededPermutation: seed must be an integer");
  const rand = mulberry32(seed);
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

const SAFE_FAILURE_DETAIL = Object.freeze({
  "run-record-write-failed": "run record write failed",
  "adapter-error": "adapter failed",
  "judge-adapter-failure": "judge adapter failed",
  "synthesis-adapter-failure": "synthesis adapter failed",
  "verifier-adapter-failure": "verifier adapter failed",
  "gate-execution-failure": "gate execution failed",
});

function summarizeErrors(errors) {
  return errors.map((e) => `${e.path} ${e.message}`).join("; ");
}

function uniqueInOrder(values) {
  return [...new Set(values)];
}

/**
 * Run ONE dispatch cycle. Pure policy sequencing over injected effects.
 *
 * @param {object} request see DISPATCH_REQUEST_SCHEMA.
 * @param {object} deps injected effects:
 *   adapter: { runCandidate(spec, ctx) → envelope, runJudge?({rubric_id, projections}, ctx) → envelope,
 *              runSynthesis?({rubric_id, candidate_summaries, judge_summary, contradictions}, ctx) → envelope,
 *              runVerifier?({exit_status, gate, warning_codes, claims_ref, evidence_ref}, ctx) → envelope }
 *     (may be async; called sequentially for determinism)
 *   runGate?: (route, ctx) → { command_names, result, source } — required for
 *     objective-gate routes; outcome must come from exit status or a
 *     deterministic checker, never a model narrative
 *   now: epoch seconds (required — staleness/no-spend need a trusted clock)
 *   seed: integer (required for judge routes; recorded for reproducibility)
 *   mode?: dispatch mode ("tui" is the only interactive mode; default "print",
 *     the fail-closed direction)
 *   depth?: recursion depth (internal; adapters receive depth+1 in ctx)
 *   parallel?: { max_concurrency:int>=1 } — opt-in bounded
 *     parallel candidate launch. Absent ⇒ sequential (unchanged);
 *     present ⇒ candidates launch with <= max_concurrency in flight and a bounded
 *     per-run token budget (an invalid cap or an unbounded budget fails closed).
 *     Output order is candidate-index deterministic regardless of completion order.
 *   record_dir?: directory to persist the run record into (omit to skip writing)
 * @returns {Promise<object>} structured result:
 *   { ok, status: "ok"|"blocked"|"fail-closed"|"escalate", code?, detail?,
 *     decision?, panel?, candidates?, judge?, synthesis?, verification?, record, record_path?, warnings }
 *   A run record is built (and written when record_dir is set) for every outcome
 *   from panel resolution onward; earlier stops return record: null.
 */
export async function runDispatch(request, deps = {}) {
  const warnings = [];
  const failClosed = (code, detail, extra = {}) =>
    ({ ok: false, status: "fail-closed", code, detail: detail ?? null, warnings: uniqueInOrder(warnings), record: null, ...extra });

  // --- recursion fence: depth is exactly one --------------------------------
  const depth = deps.depth ?? 0;
  if (depth >= 1) {
    return failClosed("refused-recursion-depth", "a dispatch cannot invoke another dispatch");
  }

  // --- injected effects -------------------------------------------------------
  if (typeof deps.now !== "number" || !Number.isFinite(deps.now)) {
    return failClosed("missing-clock", "deps.now (epoch seconds) is required");
  }
  const now = deps.now;
  if (!deps.adapter || typeof deps.adapter.runCandidate !== "function") {
    return failClosed("missing-adapter", "deps.adapter.runCandidate is required");
  }
  const mode = deps.mode ?? "print";

  // --- request boundary -------------------------------------------------------
  const shape = validate(DISPATCH_REQUEST_SCHEMA, request, "$");
  if (!shape.valid) {
    return failClosed("invalid-request", summarizeErrors(shape.errors));
  }

  // --- classification (floors, overrides, fail-closed escalation) -------------
  const decision = classify(request.task, { mode });
  warnings.push(...decision.warnings);
  if (decision.escalation === "tui-user") {
    return {
      ok: false, status: "escalate", escalation: "tui-user", code: decision.reason,
      decision, warnings: uniqueInOrder(warnings), record: null,
    };
  }
  if (decision.fail_closed) {
    return failClosed(decision.reason ?? "classification-fail-closed", null, { decision });
  }
  // Route resolution. The staged runner injects a per-stage synthetic
  // route (stage roles as the panel); it must still be a valid route shape —
  // an invalid override fails closed rather than half-applying.
  let route;
  if (deps.route != null) {
    const routeShape = validateRouteConfig(deps.route);
    if (!routeShape.valid) {
      return failClosed("invalid-route-override", summarizeErrors(routeShape.errors), { decision });
    }
    route = deps.route;
  } else {
    route = routeForClass(decision.task_class);
  }
  if (!route) return failClosed(`no-route-for-class:${decision.task_class}`, null, { decision });

  // --- panel resolution (route-owned bounds) -------------------------------------
  const panel = resolvePanel(route, request.candidates.length);
  warnings.push(...panel.warnings);

  // Everything from here on has enough structure for a public-safe run record.
  const launched = []; // { spec, envelope }
  const outcomes = [];
  let judgeMeta = null;
  let judgeEnvelope = null;
  let synthesisMeta = null;
  let synthesisEnvelope = null;
  let verifierMeta = null;
  let verifierEnvelope = null;

  const ctx = Object.freeze({ run_id: request.run_id, depth: depth + 1, now, mode });

  const finish = (exitStatus, code = null, detail = null, gateRecord = null) => {
    const extraEnvelopes = [
      ...(judgeEnvelope ? [judgeEnvelope] : []),
      ...(synthesisEnvelope ? [synthesisEnvelope] : []),
      ...(verifierEnvelope ? [verifierEnvelope] : []),
    ];
    const envelopes = [...launched.map((l) => l.envelope), ...extraEnvelopes];
    const specs = [
      ...launched.map((l) => l.spec),
      ...(judgeEnvelope ? [request.judge] : []),
      ...(synthesisEnvelope ? [request.synthesis] : []),
      ...(verifierEnvelope ? [request.verification] : []),
    ];
    // Token counts are capacity telemetry only (context-pressure cues) — Helix
    // performs no cost accounting; spend is the backend control instance's job.
    const usage_rollup = {
      input_tokens: envelopes.reduce((sum, e) => sum + e.usage.input_tokens, 0),
      output_tokens: envelopes.reduce((sum, e) => sum + e.usage.output_tokens, 0),
    };
    const fields = {
      run_id: request.run_id,
      timestamp: now,
      task_class: decision.task_class,
      route_id: route.id,
      role_ids: [...route.roles],
      provider_ids: uniqueInOrder(specs.map((s) => s.provider)),
      model_ids: uniqueInOrder(specs.map((s) => s.model)),
      usage_rollup,
      iteration_count: 1,
      exit_status: exitStatus,
      gate: gateRecord ?? { command_names: [], kind: route.gate_kind, result: "not-run", source: "advisory" },
      warning_codes: uniqueInOrder(warnings),
      judge: judgeMeta,
      input_refs: request.input_refs ?? [],
      claims_ref: request.claims_ref,
      evidence_ref: request.evidence_ref,
      run_target: request.run_target,
    };
    if (request.branch != null) fields.branch = request.branch;
    if (request.gate_file_paths != null) fields.gate_file_paths = request.gate_file_paths;
    // The resolved feature-toggle vector is embedded so the record is
    // reproducible against the settings it ran under. Validated by the record
    // schema; absent for pre-toggle callers.
    if (deps.toggles != null) fields.toggles = deps.toggles;

    let record;
    try {
      record = buildRunRecord(fields);
    } catch (error) {
      // "Public-safe logging cannot be guaranteed" ⇒ stop without persisting.
      const leak = /public-safety scan failed/.test(error.message ?? "");
      return failClosed(leak ? "public-safety-violation" : "run-record-invalid", error.message, { decision, panel });
    }
    let record_path = null;
    if (typeof deps.record_dir === "string") {
      try {
        record_path = writeRunRecord(record, deps.record_dir);
      } catch (error) {
        return failClosed("run-record-write-failed", SAFE_FAILURE_DETAIL["run-record-write-failed"], { decision, panel });
      }
    }
    return {
      ok: exitStatus === "ok",
      status: exitStatus === "ok" ? "ok" : exitStatus === "blocked" ? "blocked" : "fail-closed",
      code,
      detail,
      decision,
      panel,
      candidates: outcomes,
      judge: judgeMeta ? { ...judgeMeta, envelope: judgeEnvelope } : null,
      synthesis: synthesisMeta ? { ...synthesisMeta, envelope: synthesisEnvelope } : null,
      // Structural stable metadata only ({ rubric_id, status }). The verifier
      // envelope stays INTERNAL (validation / cap re-check / run-record rollups) —
      // its narrative is never exposed in the returned result.
      verification: verifierMeta,
      record,
      record_path,
      warnings: uniqueInOrder(warnings),
    };
  };

  if (panel.fail_closed) {
    warnings.push(`panel-fail-closed:${panel.reason}`);
    return finish("fail-closed", panel.reason);
  }

  // --- candidate plan: membership, truncation-with-warning, pre-launch policy ---
  const specs = request.candidates;
  if (specs.length < route.panel.min) {
    warnings.push("candidates-below-route-min");
    return finish("fail-closed", "candidates-below-route-min",
      `route '${route.id}' needs at least ${route.panel.min} candidate(s), got ${specs.length}`);
  }
  const planned = specs.slice(0, panel.launched);
  if (planned.length < specs.length) {
    // Profile caps are maxima; a reduction is recorded, never silent (N3).
    warnings.push("requested-candidates-truncated");
    for (let i = planned.length; i < specs.length; i++) {
      const spec = specs[i];
      outcomes.push({ index: i, role: spec.role, provider: spec.provider, model: spec.model, disposition: "truncated" });
    }
  }

  // Structural provider check only: the provider must be a known Helix provider
  // eligible for automated dispatch (claude-local stays excluded by roadmap gate).
  // No cost/price projection exists — presence = live.
  const providerPolicyRefusal = (provider) =>
    (isAutomatedDispatchProvider(provider) ? null : `provider-not-automated:${provider}`);

  const prevalidateRequiredSingletons = () => {
    if (route.roles.includes("judge")) {
      if (!request.judge) return finish("fail-closed", "missing-judge-config", `route '${route.id}' requires a judge (rubric-first)`);
      if (!Number.isInteger(deps.seed)) return finish("fail-closed", "missing-judge-seed", "deps.seed (integer) is required for judge blinding");
      if (typeof deps.adapter?.runJudge !== "function") {
        return finish("fail-closed", "adapter-missing-run-judge", `route '${route.id}' requires adapter.runJudge`);
      }
      const refusal = providerPolicyRefusal(request.judge.provider);
      if (refusal) {
        warnings.push(refusal);
        return finish("fail-closed", "judge-not-eligible", refusal);
      }
    }
    if (route.roles.includes("synthesizer")) {
      if (!request.synthesis) return finish("fail-closed", "missing-synthesis-config", `route '${route.id}' requires a synthesizer`);
      if (typeof deps.adapter?.runSynthesis !== "function") {
        return finish("fail-closed", "adapter-missing-run-synthesis", `route '${route.id}' requires adapter.runSynthesis`);
      }
      const refusal = providerPolicyRefusal(request.synthesis.provider);
      if (refusal) {
        warnings.push(refusal);
        return finish("fail-closed", "synthesis-not-eligible", refusal);
      }
    }
    if (route.roles.includes("verifier")) {
      if (!request.verification) return finish("fail-closed", "missing-verification-config", `route '${route.id}' requires a verifier`);
      if (typeof deps.adapter?.runVerifier !== "function") {
        return finish("fail-closed", "adapter-missing-run-verifier", `route '${route.id}' requires adapter.runVerifier`);
      }
      const refusal = providerPolicyRefusal(request.verification.provider);
      if (refusal) {
        warnings.push(refusal);
        return finish("fail-closed", "verifier-not-eligible", refusal);
      }
    }
    return null;
  };

  const singletonRefusal = prevalidateRequiredSingletons();
  if (singletonRefusal) return singletonRefusal;

  const launchable = [];
  for (const [index, spec] of planned.entries()) {
    let refusal = null;
    if (!route.roles.includes(spec.role)) refusal = `candidate-role-not-in-route:${spec.role}`;
    else if (!isRoleValidForStage("candidate", spec.role)) refusal = `role-not-candidate-stage:${spec.role}`;
    else refusal = providerPolicyRefusal(spec.provider);
    if (refusal) {
      warnings.push(refusal);
      outcomes.push({ index, role: spec.role, provider: spec.provider, model: spec.model, disposition: "refused-policy", code: refusal });
    } else {
      launchable.push({ index, spec });
    }
  }

  // Spend-safety: refusals are known before launch; if the panel can no longer
  // meet its required successes, stop BEFORE any adapter call.
  if (launchable.length < panel.required_successes) {
    return finish("fail-closed", "insufficient-eligible-candidates",
      `${launchable.length} eligible candidate(s) < ${panel.required_successes} required successes`);
  }

  // --- parallel-launch config (opt-in; sequential is the default, unchanged) ------
  // The concurrency cap is a resource bound (bounded worker pool), not cost
  // control. An invalid cap fails closed (never spawn unbounded workers).
  let parallelLaunch = null;
  if (deps.parallel != null) {
    const mc = deps.parallel.max_concurrency;
    if (!Number.isSafeInteger(mc) || mc < 1 || mc > MAX_PANEL_MEMBERS) {
      return finish(
        "fail-closed",
        "invalid-concurrency-cap",
        `deps.parallel.max_concurrency must be a safe integer from 1 through ${MAX_PANEL_MEMBERS}`,
      );
    }
    parallelLaunch = { max_concurrency: mc };
  }

  // --- launch: sequential (default) or bounded-parallel. Either way results are
  //     PROCESSED in candidate-index order, so completion order never changes the
  //     outcomes/launched/warnings/record (deterministic output). -----------------
  const runOne = async ({ index, spec }) => {
    try {
      return { index, spec, ok: true, envelope: await deps.adapter.runCandidate(spec, ctx) };
    } catch (error) {
      return { index, spec, ok: false, error };
    }
  };
  const processResult = ({ index, spec, ok, envelope, error }) => {
    if (!ok) {
      warnings.push(`adapter-failure:${spec.role}`);
      outcomes.push({ index, role: spec.role, provider: spec.provider, model: spec.model, disposition: "adapter-error", code: SAFE_FAILURE_DETAIL["adapter-error"] });
      return;
    }
    const validity = validateRoleEnvelope(envelope);
    if (!validity.valid) {
      warnings.push(`envelope-invalid:${spec.role}`);
      outcomes.push({ index, role: spec.role, provider: spec.provider, model: spec.model, disposition: "invalid-envelope", code: summarizeErrors(validity.errors) });
      return;
    }
    const mismatch = envelopeMismatch(envelope, { stage: "candidate", role: spec.role, provider: spec.provider, model: spec.model, run_id: request.run_id });
    if (mismatch) {
      warnings.push(`envelope-mismatch:${spec.role}`);
      outcomes.push({ index, role: spec.role, provider: spec.provider, model: spec.model, disposition: "mismatched-envelope", code: mismatch });
      return;
    }
    if (envelope.status !== "ok") warnings.push(`candidate-status:${spec.role}:${envelope.status}`);
    outcomes.push({ index, role: spec.role, provider: spec.provider, model: spec.model, disposition: "launched", status: envelope.status, envelope });
    launched.push({ spec, envelope });
  };

  if (parallelLaunch) {
    const results = await mapWithConcurrency(launchable, parallelLaunch.max_concurrency, runOne);
    for (const result of results) processResult(result);
  } else {
    for (const item of launchable) processResult(await runOne(item));
  }

  const successes = launched.filter((l) => l.envelope.status === "ok");
  if (successes.length < panel.required_successes) {
    return finish("fail-closed", "min-successes-not-met",
      `${successes.length} successful candidate(s) < ${panel.required_successes} required`);
  }

  // --- multi-team: cross-family advisory (warning only, never a blocker; an
  //     all-mock panel is a single family and warns, per spec). --------------------
  if (route.requires_cross_family) {
    const families = new Set(launched.map((l) => providerFamily(l.spec.provider)));
    if (families.size < 2) warnings.push("cross-family-not-satisfied");
  }

  // --- judge stage (blinded projection; output stays advisory) ------------------
  if (route.roles.includes("judge")) {
    // Judge config, hook, seed, and provider/price policy were prevalidated before candidate launch.

    const candidateEnvelopes = launched.map((l) => l.envelope);
    let projection;
    try {
      projection = projectCandidatesForJudge(candidateEnvelopes, {
        seed: deps.seed,
        permutation: request.judge.permutation ?? seededPermutation(candidateEnvelopes.length, deps.seed),
        reveals: request.judge.reveals,
      });
    } catch (error) {
      return finish("fail-closed", "judge-projection-invalid", String(error?.message ?? error));
    }
    const selection = evaluateJudgeSelection(
      request.judge.model,
      launched.map((l) => l.spec.model),
      request.judge.eligible_alternatives ?? [],
    );
    if (selection.warning) warnings.push(selection.warning);
    judgeMeta = {
      seed: projection.seed,
      permutation: projection.permutation,
      blinding: projection.blinding,
      rubric_id: request.judge.rubric_id,
      label_reveal_events: projection.label_reveal_events,
      judge_in_panel: selection.judge_in_panel,
    };

    let envelope;
    try {
      // The judge sees only the rubric and the blinded projections — never the
      // seed or permutation (they would unblind the candidate order).
      envelope = await deps.adapter.runJudge({ rubric_id: request.judge.rubric_id, projections: projection.projections }, ctx);
    } catch (error) {
      return finish("fail-closed", "judge-adapter-failure", SAFE_FAILURE_DETAIL["judge-adapter-failure"]);
    }
    const validity = validateRoleEnvelope(envelope);
    const mismatch = validity.valid
      ? envelopeMismatch(envelope, { stage: "judge", role: "judge", provider: request.judge.provider, model: request.judge.model, run_id: request.run_id })
      : summarizeErrors(validity.errors);
    if (mismatch) {
      return finish("fail-closed", "judge-envelope-invalid", mismatch);
    }
    judgeEnvelope = envelope;
  } else if (request.judge) {
    warnings.push("judge-config-ignored-no-judge-role");
  }

  // --- synthesis stage (final recommendation; preserves contradictions) ---------
  if (route.roles.includes("synthesizer")) {
    // Synthesis config, hook, and provider/price policy were prevalidated before candidate launch.

    const candidateEnvelopes = launched.map((l) => l.envelope);
    // Contradictions the candidates flagged; the synthesizer must quote every one.
    const contradictions = detectContradictions(candidateEnvelopes);
    let synthesisInput;
    try {
      synthesisInput = projectForSynthesis(candidateEnvelopes, judgeEnvelope, {
        rubric_id: request.synthesis.rubric_id,
        contradictions,
      });
    } catch (error) {
      return finish("fail-closed", "synthesis-projection-invalid", String(error?.message ?? error));
    }

    let envelope;
    try {
      // The synthesizer sees an identity/cost-stripped role-output projection —
      // never raw envelopes, provider/model, or cost fields. The projection still
      // carries substantive role text (it is a provider-bound adapter input, not a
      // public-safe record); the run record persists none of it.
      envelope = await deps.adapter.runSynthesis(synthesisInput, ctx);
    } catch (error) {
      return finish("fail-closed", "synthesis-adapter-failure", SAFE_FAILURE_DETAIL["synthesis-adapter-failure"]);
    }
    const validity = validateRoleEnvelope(envelope);
    const mismatch = validity.valid
      ? envelopeMismatch(envelope, { stage: "synthesis", role: "synthesizer", provider: request.synthesis.provider, model: request.synthesis.model, run_id: request.run_id })
      : summarizeErrors(validity.errors);
    if (mismatch) return finish("fail-closed", "synthesis-envelope-invalid", mismatch);

    // Preserve unresolved contradictions: a dropped marker means the synthesizer
    // averaged a disagreement away, which the spec forbids — fail closed.
    const dropped = contradictionsDropped(contradictions, envelope);
    if (dropped.length > 0) {
      warnings.push("synthesis-dropped-contradiction");
      return finish("fail-closed", "synthesis-dropped-contradiction",
        `synthesis omitted ${dropped.length} unresolved contradiction(s)`);
    }
    if (contradictions.length > 0) warnings.push("contradiction-preserved");
    synthesisMeta = {
      rubric_id: request.synthesis.rubric_id ?? null,
      contradiction_count: contradictions.length,
      contradictions_preserved: contradictions.length > 0,
    };
    synthesisEnvelope = envelope;
  } else if (request.synthesis) {
    warnings.push("synthesis-config-ignored-no-synthesizer-role");
  }

  // Ordered staged-chain hook: local proof checks that sit between the
  // reviewer/red-team panel and the verifier execute here. The hook receives
  // no model text and must return an explicit structural success.
  let beforeVerificationProof = null;
  if (typeof deps.beforeVerification === "function") {
    let checked;
    try {
      checked = await deps.beforeVerification();
    } catch {
      checked = null;
    }
    if (checked?.ok !== true) {
      const code = typeof checked?.code === "string" && PUBLIC_CODE_PATTERN.test(checked.code)
        ? checked.code
        : "before-verification-check-failed";
      return finish("fail-closed", code, SAFE_FAILURE_DETAIL["adapter-error"]);
    }
    const proof = checked.proof ?? [];
    if (!Array.isArray(proof) || proof.some((entry) => {
      const keys = entry && typeof entry === "object" && !Array.isArray(entry) ? Object.keys(entry) : [];
      return keys.length < 2 || keys.length > 3
        || !keys.includes("step_id") || !keys.includes("status")
        || typeof entry.step_id !== "string" || !PUBLIC_CODE_PATTERN.test(entry.step_id)
        || entry.status !== "pass"
        || (entry.proof_ref !== undefined && !REF_PATTERN.test(entry.proof_ref));
    })) {
      return finish("fail-closed", "before-verification-proof-invalid", SAFE_FAILURE_DETAIL["adapter-error"]);
    }
    beforeVerificationProof = proof.map((entry) => ({ ...entry }));
  }

  // --- objective/advisory gate: capture the result. The verifier (below) can
  //     summarize it but NEVER changes it — the recorded gate is the objective /
  //     deterministic outcome (spec §"Failure Behavior"). -----------------------
  let gateRecord;
  let gateExit = "ok"; // gate-derived exit status: "ok" | "blocked"
  let gateCode = null;
  if (route.gate_kind === "objective") {
    if (typeof deps.runGate !== "function") {
      return finish("fail-closed", "missing-objective-gate", `route '${route.id}' has an objective gate (${route.objective_gate}) but no deps.runGate`);
    }
    let outcome;
    try {
      outcome = await deps.runGate(route, ctx);
    } catch (error) {
      return finish("fail-closed", "gate-execution-failure", SAFE_FAILURE_DETAIL["gate-execution-failure"]);
    }
    if (outcome?.result === "error" && typeof outcome.code === "string"
      && PUBLIC_CODE_PATTERN.test(outcome.code) && outcome.code.length <= 160) {
      return finish("fail-closed", outcome.code, SAFE_FAILURE_DETAIL["gate-execution-failure"]);
    }
    const gateShape = validate(OBJECTIVE_GATE_OUTCOME_SCHEMA, outcome, "$");
    if (!gateShape.valid) {
      return finish("fail-closed", "invalid-gate-outcome", summarizeErrors(gateShape.errors));
    }
    gateRecord = { command_names: [...outcome.command_names], kind: "objective", result: outcome.result, source: outcome.source };
    if (outcome.result === "fail") { gateExit = "blocked"; gateCode = "objective-gate-failed"; }
  } else {
    // Advisory route: a gate may run and is recorded, but the human stays final.
    if (typeof deps.runGate === "function") {
      let outcome;
      try {
        outcome = await deps.runGate(route, ctx);
      } catch (error) {
        return finish("fail-closed", "gate-execution-failure", SAFE_FAILURE_DETAIL["gate-execution-failure"]);
      }
      if (outcome?.result === "error" && typeof outcome.code === "string"
        && PUBLIC_CODE_PATTERN.test(outcome.code) && outcome.code.length <= 160) {
        return finish("fail-closed", outcome.code, SAFE_FAILURE_DETAIL["gate-execution-failure"]);
      }
      const gateShape = validate(ADVISORY_GATE_OUTCOME_SCHEMA, outcome, "$");
      if (!gateShape.valid) {
        return finish("fail-closed", "invalid-gate-outcome", summarizeErrors(gateShape.errors));
      }
      if (outcome.result === "fail") warnings.push("advisory-gate-fail");
      gateRecord = { command_names: [...outcome.command_names], kind: "advisory", result: outcome.result, source: outcome.source };
    } else {
      gateRecord = { command_names: [], kind: "advisory", result: "not-run", source: "advisory" };
    }
  }

  // --- verification stage (advisory proof summary; NEVER changes the gate) --------
  if (route.roles.includes("verifier")) {
    // Verifier config, hook, and provider/price policy were prevalidated before candidate launch.

    // Structural, public-safe proof summary — gate outcome, exit status, warning
    // codes, refs. No model narrative or provider payloads reach the verifier.
    const verifierInput = projectForVerification({
      exit_status: gateExit,
      gate: gateRecord,
      warning_codes: uniqueInOrder(warnings),
      claims_ref: request.claims_ref,
      evidence_ref: request.evidence_ref,
    });
    let envelope;
    try {
      envelope = await deps.adapter.runVerifier(verifierInput, {
        ...ctx,
        before_verification: beforeVerificationProof,
      });
    } catch (error) {
      return finish("fail-closed", "verifier-adapter-failure", SAFE_FAILURE_DETAIL["verifier-adapter-failure"]);
    }
    const validity = validateRoleEnvelope(envelope);
    const mismatch = validity.valid
      ? envelopeMismatch(envelope, { stage: "verification", role: "verifier", provider: request.verification.provider, model: request.verification.model, run_id: request.run_id })
      : summarizeErrors(validity.errors);
    if (mismatch) return finish("fail-closed", "verification-envelope-invalid", mismatch);

    // The verifier's content is ADVISORY: it summarizes proof but can never change
    // the gate result or the run's exit status. Only its stable status enum is kept
    // (in the returned result, not the record) — never its narrative.
    verifierMeta = { rubric_id: request.verification.rubric_id ?? null, status: envelope.status };
    verifierEnvelope = envelope;
  } else if (request.verification) {
    warnings.push("verification-config-ignored-no-verifier-role");
  }

  return finish(gateExit, gateCode, null, gateRecord);
}

/** First mismatching identity field between an envelope and what policy vetted, or null. */
function envelopeMismatch(envelope, expected) {
  for (const field of ["stage", "role", "provider", "model", "run_id"]) {
    if (envelope[field] !== expected[field]) {
      return `envelope ${field} '${envelope[field]}' does not match vetted '${expected[field]}'`;
    }
  }
  return null;
}
