// Prime dispatch — judge-bias mitigations (blinding projection + judge selection).
//
// Source of truth: fusion-dispatch-research.md §"Judge-Bias Mitigations". The
// judge sees a PROJECTION of each candidate: identifying fields (provider, model,
// usage, attempt, iteration, input_ref, run_id) are stripped and
// candidates are re-keyed A/B/C in a recorded (seed-reproducible) permutation.
// Label reveals are allowed only by config/TUI approval and are recorded.

/** Fields never shown to the judge (identity/cost — bias sources). */
const STRIPPED_FIELDS = Object.freeze([
  "run_id", "provider", "model", "usage", "attempt", "iteration", "input_ref",
]);

/** Substantive fields the judge compares (kept in the projection). */
const KEPT_FIELDS = Object.freeze([
  "stage", "role", "recommendation", "risks", "uncertainty",
  "proposed_actions", "open_questions", "claims_ref", "evidence_ref", "status",
]);

function keyFor(index) {
  return String.fromCharCode(65 + index); // 0→A, 1→B, ...
}

/** Validate that `permutation` is a permutation of 0..n-1 (else fail closed). */
function assertPermutation(permutation, n) {
  if (!Array.isArray(permutation) || permutation.length !== n) {
    throw new Error(`judge projection: permutation must have length ${n}`);
  }
  const seen = new Set(permutation);
  if (seen.size !== n) throw new Error("judge projection: permutation has duplicates");
  for (const i of permutation) {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`judge projection: bad permutation index ${i}`);
  }
}

/**
 * Build the blinded judge input from candidate envelopes.
 *
 * @param {object[]} candidates role envelopes (candidate stage)
 * @param {{ seed:number, permutation?:number[], reveals?:Array<{index:number, field:string, reason:string}> }} opts
 *   seed is recorded so a fixture can reproduce the order; permutation defaults to
 *   identity order; reveals are explicit label reveals (config/TUI approved).
 * @returns {{ seed:number, permutation:number[], blinding:boolean,
 *            label_reveal_events:Array<{key:string, field:string, reason:string}>,
 *            projections:Array<object> }}
 */
export function projectCandidatesForJudge(candidates, opts) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("judge projection: at least one candidate is required");
  }
  const n = candidates.length;
  const permutation = opts?.permutation ?? candidates.map((_, i) => i);
  assertPermutation(permutation, n);

  const revealByIndex = new Map();
  for (const r of Array.isArray(opts?.reveals) ? opts.reveals : []) {
    revealByIndex.set(r.index, r);
  }

  const label_reveal_events = [];
  const projections = permutation.map((originalIndex, position) => {
    const src = candidates[originalIndex] ?? {};
    const key = keyFor(position);
    const projection = { key };
    for (const field of KEPT_FIELDS) {
      if (field in src) projection[field] = src[field];
    }
    // Confirm identity fields never leak into the projection.
    for (const field of STRIPPED_FIELDS) {
      if (field in projection) delete projection[field];
    }
    const reveal = revealByIndex.get(originalIndex);
    if (reveal) {
      projection[`revealed_${reveal.field}`] = src[reveal.field];
      label_reveal_events.push({ key, field: reveal.field, reason: reveal.reason });
    }
    return projection;
  });

  return {
    seed: opts?.seed ?? 0,
    permutation,
    blinding: label_reveal_events.length === 0,
    label_reveal_events,
    projections,
  };
}

/**
 * Choose whether the judge model sits inside the candidate panel. The judge must
 * not be a candidate model when an eligible alternative exists; otherwise the run
 * records a `judge_in_panel` degradation warning.
 *
 * @param {string} judgeModel
 * @param {string[]} candidateModels
 * @param {string[]} eligibleAlternatives judge-eligible models outside the panel
 * @returns {{ judge_in_panel:boolean, warning:string|null }}
 */
export function evaluateJudgeSelection(judgeModel, candidateModels, eligibleAlternatives) {
  const inPanel = Array.isArray(candidateModels) && candidateModels.includes(judgeModel);
  if (!inPanel) return { judge_in_panel: false, warning: null };
  const hasAlt = Array.isArray(eligibleAlternatives) && eligibleAlternatives.some((m) => !candidateModels.includes(m));
  // If an eligible out-of-panel judge exists, using an in-panel judge is a policy
  // error the caller must fix; we still surface it as a warning to record.
  return { judge_in_panel: true, warning: hasAlt ? "judge_in_panel_avoidable" : "judge_in_panel" };
}
