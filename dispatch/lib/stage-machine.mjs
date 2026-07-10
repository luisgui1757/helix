// Prime dispatch — staged chain state machine (M3, owner interview 2026-07-09).
//
// Executes a staged chain: each stage is a mini-loop routed by a reviewer
// VERDICT (approve = advance, revise = stay, revise-jump = jump back to the
// one declared earlier stage) or by a GATE EXPECTATION (tdd-fix's red-first
// reproduce stage advances only when the objective gate FAILS). Models may
// route; ONLY the objective gate can conclude the run: after the last stage
// advances, the final gate decides success, and a failing final gate re-enters
// the last stage (the fix loop) while budget remains.
//
// Termination is guaranteed by two rails: the global max_iterations budget
// (every stage pass consumes one unit, including passes that trigger jumps)
// and each verdict stage's finite max_passes ceiling (pass counts are NEVER
// reset by re-entry, so a plan↔implement ping-pong cannot cycle forever even
// inside the global budget).
//
// The `loops` toggle OFF degenerates the machine to a single walk: every stage
// runs at most once, verdicts and unmet gate expectations are recorded as
// warnings instead of looping, and the final gate still runs and reports.
// Degeneration, never an error.
//
// This module is PURE orchestration over injected effects:
//   deps.runStage(stage, ctx)  → { verdict?, refs? }   (the stage's panel work)
//   deps.runGate(ctx)          → { result: "pass"|"fail", ... }  (deterministic)
// It never touches the filesystem, network, or clock, and its returned flow
// summary is structural (stage ids, pass numbers, actions, stable codes) —
// no model narrative ever enters it.

import { MAX_ITERATIONS } from "./limits.mjs";

export const STAGE_VERDICTS = Object.freeze(["approve", "revise", "revise-jump"]);

export const STAGE_MACHINE_CODES = Object.freeze({
  INVALID_CHAIN: "stage-machine-invalid-chain",
  MISSING_RUN_STAGE: "stage-machine-missing-run-stage",
  MISSING_RUN_GATE: "stage-machine-missing-run-gate",
  MISSING_MAX_ITERATIONS: "missing-max-iterations",
  UNBOUNDED_MAX_ITERATIONS: "unbounded-max-iterations",
  STAGE_FAILED: "stage-effect-failed",
  VERDICT_INVALID: "stage-verdict-invalid",
  VERDICT_MISSING: "stage-verdict-missing",
  JUMP_NOT_ALLOWED: "stage-jump-not-allowed",
  MAX_PASSES: "stage-max-passes-exhausted",
  GATE_FAILED_EFFECT: "gate-execution-failure",
  CHECKPOINT_FAILED: "checkpoint-persistence-failed",
  NOT_CONVERGED: "not-converged-within-max-iterations",
});

/**
 * Pure per-pass routing decision. Exhaustively unit-testable without effects.
 *
 * @param {object} stage a CHAIN_SCHEMA stage
 * @param {number} passCount how many passes this stage has consumed INCLUDING
 *   the one being decided (1-based)
 * @param {object} outcome { verdict? } for verdict stages;
 *   { gate_result? } for gate_expectation stages; {} for plain stages
 * @param {boolean} loopsEnabled the loops toggle
 * @returns {{ action:"advance"|"stay"|"jump"|"refuse", target?:string,
 *            code:string|null, warning?:string }}
 */
export function decideStageTransition(stage, passCount, outcome, loopsEnabled = true) {
  // Plain stage: one pass, auto-advance.
  if (!stage.advance && !stage.gate_expectation) {
    return { action: "advance", code: null };
  }

  // Gate-shaped criterion (red-first): advance only when the gate reports the
  // expected result; otherwise retry under the global budget.
  if (stage.gate_expectation) {
    const met = outcome?.gate_result === stage.gate_expectation;
    if (met) return { action: "advance", code: null };
    if (!loopsEnabled) {
      return { action: "advance", code: null, warning: `loops-off-gate-expectation-unmet:${stage.id}` };
    }
    return { action: "stay", code: `stage-gate-expectation-unmet:${stage.id}` };
  }

  // Verdict-routed stage.
  const verdict = outcome?.verdict;
  if (verdict == null) return { action: "refuse", code: STAGE_MACHINE_CODES.VERDICT_MISSING };
  if (!STAGE_VERDICTS.includes(verdict)) return { action: "refuse", code: STAGE_MACHINE_CODES.VERDICT_INVALID };

  if (verdict === "approve") return { action: "advance", code: null };

  if (!loopsEnabled) {
    // Single-pass degeneration: a non-approve verdict is recorded, never looped.
    return { action: "advance", code: null, warning: `loops-off-verdict-ignored:${stage.id}:${verdict}` };
  }

  if (verdict === "revise-jump") {
    const target = stage.advance.allow_jump_to;
    if (!target) return { action: "refuse", code: `${STAGE_MACHINE_CODES.JUMP_NOT_ALLOWED}:${stage.id}` };
    return { action: "jump", target, code: `stage-jump:${stage.id}:${target}` };
  }

  // "revise": stay while this stage's finite ceiling allows.
  if (passCount >= stage.advance.max_passes) {
    return { action: "refuse", code: `${STAGE_MACHINE_CODES.MAX_PASSES}:${stage.id}` };
  }
  return { action: "stay", code: `stage-revise:${stage.id}` };
}

function flowEntry(stage, pass, action, code, warning) {
  return {
    stage_id: stage.id,
    pass,
    action,
    code: code ?? null,
    ...(warning ? { warning } : {}),
  };
}

/** Closed structural validation for a durable machine checkpoint. */
export function validateMachineResume(chain, maxIterations, toggles, resume) {
  if (!resume || typeof resume !== "object" || Array.isArray(resume)) return false;
  const allowed = new Set(["phase", "stage_index", "pass_counts", "total_passes"]);
  if (Object.keys(resume).some((key) => !allowed.has(key))) return false;
  const stages = chain?.stages;
  if (!Array.isArray(stages) || stages.length === 0
    || !Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) return false;
  const loopsEnabled = !toggles || toggles.loops !== false;
  const validIndex = Number.isSafeInteger(resume.stage_index)
    && resume.stage_index >= 0 && resume.stage_index < stages.length;
  const validTotal = Number.isSafeInteger(resume.total_passes)
    && resume.total_passes >= 0 && resume.total_passes <= maxIterations;
  const counts = resume.pass_counts;
  const countKeys = counts != null && typeof counts === "object" && !Array.isArray(counts)
    ? Object.keys(counts)
    : [];
  const validCounts = countKeys.length === stages.length
    && stages.every((stage) => Object.hasOwn(counts, stage.id)
      && Number.isSafeInteger(counts[stage.id]) && counts[stage.id] >= 0
      && (!stage.advance || counts[stage.id] <= stage.advance.max_passes));
  const countSum = validCounts ? countKeys.reduce((sum, id) => sum + counts[id], 0) : -1;
  const validPhase = resume.phase === "stage" || resume.phase === "conclusion";
  const phasePositionValid = validIndex && validPhase
    && (resume.phase !== "conclusion"
      || (resume.stage_index === stages.length - 1 && counts?.[stages.at(-1).id] > 0));
  const reachedPosition = validIndex
    && (resume.stage_index === 0
      || stages.slice(0, resume.stage_index).every((stage) => counts?.[stage.id] > 0));
  // A later stage can be non-zero while the machine points at an earlier stage
  // only after a back-jump. Such a jump necessarily consumed every preceding
  // stage at least once; a sparse suffix is therefore impossible history.
  const reachedCountsValid = validCounts && stages.every((stage, index) =>
    counts[stage.id] === 0 || stages.slice(0, index).every((prior) => counts[prior.id] > 0));
  const loopsPositionValid = loopsEnabled
    || (validCounts && Object.values(counts).every((count) => count <= 1));
  const emptyPositionValid = resume.total_passes !== 0
    || (resume.stage_index === 0 && resume.phase === "stage" && countSum === 0);
  return validIndex && validTotal && validCounts && Number.isSafeInteger(countSum)
    && countSum === resume.total_passes && phasePositionValid && reachedPosition
    && reachedCountsValid && loopsPositionValid && emptyPositionValid;
}

/**
 * Run a staged chain to conclusion. See the module header for semantics.
 *
 * @param {object} request { chain, max_iterations, toggles?, resume? } where
 *   resume = { phase, stage_index, pass_counts: {stage_id: n}, total_passes } is a
 *   previously persisted machine state (interrupt-safe resume, M5). Resume
 *   state is validated structurally; an inconsistent state fails closed.
 * @param {object} deps { runStage, runGate, onPass?, onCheckpoint? } —
 *   onPass(entry, state)
 *   is called after EVERY pass with the resumable machine state so the runner
 *   can persist it (a kill between passes loses at most the in-flight pass).
 *   onCheckpoint(state) persists a gate-fail re-entry that has no stage pass.
 * @returns {Promise<object>} structural result:
 *   { ok, converged, stop_reason, code, total_passes, max_iterations,
 *     final_gate: {result}|null, flow: [flowEntry], warnings: string[] }
 */
export async function runStagedChain(request, deps = {}) {
  const warnings = [];
  const flow = [];
  const finish = (ok, converged, stopReason, code, totalPasses, finalGate) => ({
    ok,
    converged,
    stop_reason: stopReason,
    code: code ?? null,
    total_passes: totalPasses,
    max_iterations: request?.max_iterations ?? null,
    final_gate: finalGate ?? null,
    flow,
    warnings: [...new Set(warnings)],
  });
  const refuse = (code, totalPasses = 0) => finish(false, false, code, code, totalPasses, null);

  const chain = request?.chain;
  if (!chain || !Array.isArray(chain.stages) || chain.stages.length === 0) {
    return refuse(STAGE_MACHINE_CODES.INVALID_CHAIN);
  }
  if (typeof deps.runStage !== "function") return refuse(STAGE_MACHINE_CODES.MISSING_RUN_STAGE);
  if (typeof deps.runGate !== "function") return refuse(STAGE_MACHINE_CODES.MISSING_RUN_GATE);
  const maxIterations = request.max_iterations;
  if (maxIterations == null) return refuse(STAGE_MACHINE_CODES.MISSING_MAX_ITERATIONS);
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
    return refuse(STAGE_MACHINE_CODES.UNBOUNDED_MAX_ITERATIONS);
  }

  const toggles = request.toggles ?? null;
  const loopsEnabled = !toggles || toggles.loops !== false;
  if (!loopsEnabled) warnings.push("loops-off-single-pass");

  const stageIndexById = new Map(chain.stages.map((stage, index) => [stage.id, index]));
  const passCounts = new Map(chain.stages.map((stage) => [stage.id, 0])); // never reset

  let stageIndex = 0;
  let totalPasses = 0;
  let finalGate = null;
  let phase = "stage";

  const machineState = (nextStageIndex = stageIndex, nextPhase = phase) => ({
    phase: nextPhase,
    stage_index: nextStageIndex,
    pass_counts: Object.fromEntries(passCounts),
    total_passes: totalPasses,
  });

  const checkpoint = (hook, ...args) => {
    if (typeof hook !== "function") return true;
    try {
      hook(...args);
      return true;
    } catch {
      return false;
    }
  };

  // --- interrupt-safe resume (M5): restore a persisted machine state --------
  if (request.resume != null) {
    const resume = request.resume;
    if (!validateMachineResume(chain, maxIterations, toggles, resume)) {
      return refuse("invalid-resume-state");
    }
    stageIndex = resume.stage_index;
    totalPasses = resume.total_passes;
    phase = resume.phase;
    for (const [id, n] of Object.entries(resume.pass_counts)) passCounts.set(id, n);
    warnings.push(`resumed-at-pass:${totalPasses}`);
  }

  const runConclusionGate = async () => {
    const stage = chain.stages.at(-1);
    const pass = passCounts.get(stage.id);
    let gate;
    try {
      gate = await deps.runGate({ stage_id: stage.id, pass, phase: "conclusion" });
    } catch {
      return { result: refuse(STAGE_MACHINE_CODES.GATE_FAILED_EFFECT, totalPasses) };
    }
    finalGate = { result: gate?.result === "pass" ? "pass" : "fail" };
    if (finalGate.result === "pass") {
      return { result: finish(true, true, "converged", null, totalPasses, finalGate) };
    }
    if (!loopsEnabled) {
      return { result: finish(false, false, "gate-failed-single-pass", "objective-gate-failed", totalPasses, finalGate) };
    }
    warnings.push("final-gate-failed-reentering-last-stage");
    phase = "stage";
    if (!checkpoint(deps.onCheckpoint, machineState(stageIndex, phase))) {
      return { result: refuse(STAGE_MACHINE_CODES.CHECKPOINT_FAILED, totalPasses) };
    }
    return { result: null };
  };

  // A final-stage pass is durably checkpointed BEFORE its conclusion gate is
  // exposed. Resume therefore runs only the pending deterministic gate; it
  // never replays the completed model/worktree pass.
  if (phase === "conclusion") {
    const concluded = await runConclusionGate();
    if (concluded.result) return concluded.result;
  }

  while (totalPasses < maxIterations) {
    const stage = chain.stages[stageIndex];
    if (loopsEnabled && stage.advance && passCounts.get(stage.id) >= stage.advance.max_passes) {
      return refuse(`${STAGE_MACHINE_CODES.MAX_PASSES}:${stage.id}`, totalPasses);
    }
    const pass = passCounts.get(stage.id) + 1;
    passCounts.set(stage.id, pass);
    totalPasses += 1;

    // --- the stage's panel work (injected effect) ---------------------------
    let outcome;
    try {
      outcome = await deps.runStage(stage, { stage_id: stage.id, pass, total_passes: totalPasses });
    } catch {
      // A thrown effect may carry model text / paths — never surfaced.
      flow.push(flowEntry(stage, pass, "refuse", STAGE_MACHINE_CODES.STAGE_FAILED));
      return refuse(STAGE_MACHINE_CODES.STAGE_FAILED, totalPasses);
    }

    // --- gate-shaped stage criterion needs the gate's CURRENT result --------
    let stageGateResult = null;
    if (stage.gate_expectation) {
      let gate;
      try {
        gate = await deps.runGate({ stage_id: stage.id, pass, phase: "stage-expectation" });
      } catch {
        flow.push(flowEntry(stage, pass, "refuse", STAGE_MACHINE_CODES.GATE_FAILED_EFFECT));
        return refuse(STAGE_MACHINE_CODES.GATE_FAILED_EFFECT, totalPasses);
      }
      stageGateResult = gate?.result === "pass" ? "pass" : "fail";
    }

    const decision = decideStageTransition(
      stage,
      pass,
      { verdict: outcome?.verdict, gate_result: stageGateResult },
      loopsEnabled,
    );
    if (decision.warning) warnings.push(decision.warning);
    const entry = flowEntry(stage, pass, decision.action, decision.code, decision.warning);
    flow.push(entry);

    // The RESUMABLE state is POST-transition: where the machine would re-enter
    // if killed right after this point. A pre-transition state (bug: onPass once
    // fired before the jump/advance applied) made resume replay the completed
    // pass and diverge. "refuse" is terminal, so its state is never resumed.
    const finalStageAdvance = decision.action === "advance" && stageIndex + 1 === chain.stages.length;
    const nextStageIndex = decision.action === "jump"
      ? stageIndexById.get(decision.target)
      : decision.action === "advance" && stageIndex + 1 < chain.stages.length
        ? stageIndex + 1
        : stageIndex; // stay, or final-stage advance (gate concludes / re-enters)
    const nextPhase = finalStageAdvance ? "conclusion" : "stage";
    if (decision.action !== "refuse"
      && !checkpoint(deps.onPass, entry, machineState(nextStageIndex, nextPhase))) {
      return refuse(STAGE_MACHINE_CODES.CHECKPOINT_FAILED, totalPasses);
    }

    if (decision.action === "refuse") {
      return refuse(decision.code, totalPasses);
    }
    if (decision.action === "jump") {
      stageIndex = nextStageIndex;
      phase = nextPhase;
      continue;
    }
    if (decision.action === "stay") {
      continue;
    }

    // --- advance -------------------------------------------------------------
    if (stageIndex + 1 < chain.stages.length) {
      stageIndex += 1;
      phase = nextPhase;
      continue;
    }

    // Last stage advanced: ONLY the objective gate concludes the run.
    phase = nextPhase;
    const concluded = await runConclusionGate();
    if (concluded.result) return concluded.result;
  }

  return finish(false, false, STAGE_MACHINE_CODES.NOT_CONVERGED, STAGE_MACHINE_CODES.NOT_CONVERGED, totalPasses, finalGate);
}
