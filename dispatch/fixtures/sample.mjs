// Helix dispatch — deterministic sample builders for tests and fixtures.
//
// These produce structurally valid role envelopes over synthetic content only
// (no private code, no secrets). Overrides are merged shallowly; `usage` and
// `input_ref` merge one level deep so a test can tweak a single sub-field.

/** A valid baseline role envelope (candidate/builder/mock). */
export function makeEnvelope(overrides = {}) {
  const base = {
    schema_version: 2,
    run_id: "run-fixture",
    stage: "candidate",
    role: "builder",
    provider: "mock",
    model: "mock-model",
    usage: {
      input_tokens: 10,
      output_tokens: 20,
    },
    attempt: 1,
    iteration: 1,
    input_ref: { kind: "local-ref", value: "local-ref:input/fixture", algorithm: null },
    claims_ref: "local-ref:claims/fixture",
    evidence_ref: "local-ref:evidence/fixture",
    uncertainty: [],
    risks: [],
    recommendation: "",
    proposed_actions: [],
    open_questions: [],
    status: "ok",
  };
  const merged = { ...base, ...overrides };
  if (overrides.usage) merged.usage = { ...base.usage, ...overrides.usage };
  if (overrides.input_ref) merged.input_ref = { ...base.input_ref, ...overrides.input_ref };
  return merged;
}
