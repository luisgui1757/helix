// Prime dispatch — synthesis stage (final recommendation; preserves contradictions).
//
// Source of truth: fusion-dispatch-research.md §"Roles" (the `synthesizer`
// produces the final recommendation/action plan from the judge analysis and the
// PRESERVED disagreements) and §"Judge-Bias Mitigations" ("The synthesizer must
// quote unresolved contradictions into the final output instead of averaging
// them away").
//
// The synthesis input is an IDENTITY/COST-STRIPPED, PROVIDER-BOUND role-output
// projection — NOT a public-safe record artifact. It strips provider/model/cost
// identity (like the judge projection), but it deliberately carries the
// candidates' and judge's substantive role output (recommendation, risks,
// uncertainty, open questions) so the synthesizer can actually synthesize. That
// text is model output governed by the run's profile/input/provider policy and is
// passed only between injected in-process adapters. The public-safe guarantee
// lives in the run record (run-record.mjs), which persists none of this text —
// only ids, refs/hashes, rollups, and stable codes.

/**
 * Substantive fields carried into a synthesis summary. Identity/cost fields
 * (run_id, provider, model, usage, attempt, iteration, input_ref)
 * are intentionally excluded, mirroring the judge projection's stripping.
 */
const SUMMARY_FIELDS = Object.freeze([
  "stage", "role", "recommendation", "risks", "uncertainty",
  "proposed_actions", "open_questions", "claims_ref", "evidence_ref", "status",
]);

/** Envelope array fields scanned for / checked against contradiction markers. */
const MARKER_FIELDS = Object.freeze(["risks", "open_questions", "uncertainty"]);

/** Case-insensitive sentinel for an explicitly flagged contradiction in role output. */
const CONTRADICTION_RE = /contradict/i;

/** Identity/cost-stripped role-output summary (keeps substantive model text). */
function summarize(envelope) {
  const out = {};
  for (const field of SUMMARY_FIELDS) {
    if (envelope && field in envelope) out[field] = envelope[field];
  }
  return out;
}

/** Every string entry across an envelope's marker fields. */
function markerStrings(envelope) {
  const out = [];
  for (const field of MARKER_FIELDS) {
    const values = Array.isArray(envelope?.[field]) ? envelope[field] : [];
    for (const item of values) if (typeof item === "string") out.push(item);
  }
  return out;
}

/**
 * Unresolved contradiction markers surfaced by the candidate panel: the risk /
 * open-question / uncertainty entries the candidates themselves flagged as
 * contradictions. Deterministic, insertion-ordered, de-duplicated.
 * @param {object[]} candidateEnvelopes
 * @returns {string[]}
 */
export function detectContradictions(candidateEnvelopes) {
  const markers = [];
  for (const envelope of Array.isArray(candidateEnvelopes) ? candidateEnvelopes : []) {
    for (const item of markerStrings(envelope)) {
      if (CONTRADICTION_RE.test(item) && !markers.includes(item)) markers.push(item);
    }
  }
  return markers;
}

/**
 * Which contradiction markers the synthesis envelope failed to carry forward.
 * The synthesizer must quote EVERY unresolved contradiction (spec) into its own
 * risks/open_questions/uncertainty; a dropped marker means it averaged one away.
 * @param {string[]} markers from detectContradictions
 * @param {object} synthesisEnvelope
 * @returns {string[]} markers not present in the synthesis output
 */
export function contradictionsDropped(markers, synthesisEnvelope) {
  const carried = new Set(markerStrings(synthesisEnvelope));
  return (Array.isArray(markers) ? markers : []).filter((m) => !carried.has(m));
}

/**
 * Build the synthesis input: identity/cost-stripped role-output summaries of the
 * candidates and the judge, the rubric id, and the unresolved contradictions the
 * synthesizer must preserve. Provider/model/cost identity is stripped, but the
 * summaries DO carry substantive model text (recommendation/risks/etc.) — this is
 * a provider-bound adapter input, not a public-safe record artifact (see the
 * module header). Nothing here is persisted; the run record stays refs-only.
 *
 * @param {object[]} candidateEnvelopes candidate-stage role envelopes
 * @param {object|null} judgeEnvelope the judge envelope (null if no judge ran)
 * @param {{ rubric_id?:string, contradictions?:string[] }} [opts]
 * @returns {{ rubric_id:string|null, candidate_summaries:object[],
 *            judge_summary:object|null, contradictions:string[] }}
 */
export function projectForSynthesis(candidateEnvelopes, judgeEnvelope, opts = {}) {
  if (!Array.isArray(candidateEnvelopes) || candidateEnvelopes.length === 0) {
    throw new Error("synthesis projection: at least one candidate is required");
  }
  return {
    rubric_id: opts.rubric_id ?? null,
    candidate_summaries: candidateEnvelopes.map(summarize),
    judge_summary: judgeEnvelope ? summarize(judgeEnvelope) : null,
    contradictions: Array.isArray(opts.contradictions) ? [...opts.contradictions] : [],
  };
}
