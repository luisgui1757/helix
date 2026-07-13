// Helix dispatch — verification stage (objective proof summary; never the gate).
//
// The verifier summarizes objective/deterministic proof but never determines the
// recorded gate result. Gate outcomes enter the run record only from process exit
// status or a deterministic checker result.
//
// The verifier input is a PURELY STRUCTURAL, public-safe proof summary — the gate
// outcome (command names / kind / result / source), the run's exit status so far,
// the stable warning codes, and the claims/evidence refs. It carries NO model
// narrative, provider payloads, or raw output. Unlike the synthesis projection
// (which forwards substantive role text to a downstream model), everything here
// is already record-safe: ids, stable codes, and refs/hashes only.

/** REF_PATTERN-shaped refs the verifier may receive (never free text). */
const REF_FIELDS = Object.freeze(["claims_ref", "evidence_ref"]);

/**
 * Build the structural proof summary the verifier summarizes. The verifier may
 * report on these facts but can never change them: the recorded gate result is
 * the objective/deterministic outcome, full stop.
 *
 * @param {object} context
 * @param {"ok"|"blocked"} context.exit_status the gate-derived exit status so far
 * @param {{command_names:string[], kind:string, result:string, source:string}|null} context.gate
 * @param {string[]} context.warning_codes stable warning codes accumulated so far
 * @param {string} context.claims_ref ref/hash (never free text)
 * @param {string} context.evidence_ref ref/hash (never free text)
 * @returns {{ exit_status:string, gate:object|null,
 *            warning_codes:string[], claims_ref:string, evidence_ref:string }}
 */
export function projectForVerification(context = {}) {
  const gate = context.gate;
  const out = {
    exit_status: context.exit_status,
    gate: gate
      ? { command_names: [...gate.command_names], kind: gate.kind, result: gate.result, source: gate.source }
      : null,
    warning_codes: [...(context.warning_codes ?? [])],
  };
  for (const field of REF_FIELDS) out[field] = context[field];
  return out;
}
