// Prime dispatch — deterministic evaluation fixtures + oracles.
//
// Source of truth: fusion-dispatch-research.md §"Evaluation Fixtures" (amended
// 2026-07-09: cost control removed from the harness — no profiles, no price/
// no-spend policy; the provider gate is isAutomatedDispatchProvider only). These
// are dispatcher/POLICY fixtures over canned mock outputs; they do NOT test model
// quality. Each fixture's `expect` block is the oracle: expected route, panel
// resolution (resolvePanel(route, requestedCount)), per-candidate envelope
// validity, provider-gate refusals, judge blinding, and public-safe run-record
// shape. All content is synthetic.

import { makeEnvelope } from "./sample.mjs";

function baseRecord(overrides) {
  return {
    timestamp: "2026-07-05T00:00:00Z",
    provider_ids: ["mock"],
    model_ids: ["mock-model"],
    // Tokens are capacity telemetry only — Prime does no cost accounting.
    usage_rollup: { input_tokens: 30, output_tokens: 40 },
    iteration_count: 1,
    warning_codes: [],
    judge: null,
    input_refs: [{ kind: "local-ref", value: "local-ref:input/fx", algorithm: null }],
    claims_ref: "local-ref:claims/fx",
    evidence_ref: "local-ref:evidence/fx",
    run_target: { repo: "self" },
    ...overrides,
  };
}

/** 1. Candidates disagree on a roadmap checkbox; the conflict must be preserved. */
const roadmapReconciliation = {
  id: "roadmap-reconciliation",
  description: "Candidates disagree on a roadmap checkbox; the run preserves the conflict and requires evidence-backed resolution.",
  task: { class_hint: "roadmap-reconciliation", signals: [], confident: true, mode: "tui" },
  candidates: [
    { envelope: makeEnvelope({ role: "planner", recommendation: "mark-checkbox-done", open_questions: ["needs-evidence"] }), expect_valid: true },
    { envelope: makeEnvelope({ role: "reviewer", recommendation: "keep-checkbox-open", risks: ["contradicts-candidate-A"] }), expect_valid: true },
  ],
  judge: { seed: 5, permutation: [1, 0], rubric_id: "roadmap-recon-rubric-v1" },
  run_record: baseRecord({
    run_id: "fx-roadmap-recon", task_class: "roadmap-reconciliation", route_id: "roadmap-reconciliation",
    role_ids: ["planner", "reviewer", "judge", "synthesizer"],
    exit_status: "blocked",
    gate: { command_names: ["roadmap-consistency-check"], kind: "objective", result: "fail", source: "deterministic-checker" },
    warning_codes: ["contradiction-preserved"],
    judge: { seed: 5, permutation: [1, 0], blinding: true, rubric_id: "roadmap-recon-rubric-v1", label_reveal_events: [], judge_in_panel: false },
    branch: "stage3/dispatch-policy-core", gate_file_paths: ["ROADMAP.md"],
  }),
  expect: {
    task_class: "roadmap-reconciliation", route_id: "roadmap-reconciliation", classify_warnings_include: [],
    panel: { launched: 2, required_successes: 2, fail_closed: false, warnings_include: [] },
    judge: { keys: ["A", "B"], blinding: true },
    run_record: { exit_status: "blocked", warning_codes_include: ["contradiction-preserved"], gate_source: "deterministic-checker" },
  },
};

/** 2. One candidate misses a security regression; the objective gate stays final. */
const codeReview = {
  id: "code-review",
  description: "One candidate misses a security regression; the objective gate (exit status), not the model, decides.",
  task: { class_hint: "routine-code", signals: [], confident: true, mode: "tui" },
  candidates: [
    { envelope: makeEnvelope({ role: "builder", recommendation: "ship", risks: [] }), expect_valid: true },
    { envelope: makeEnvelope({ role: "reviewer", recommendation: "block", risks: ["missed-security-regression"] }), expect_valid: true },
  ],
  run_record: baseRecord({
    run_id: "fx-code-review", task_class: "routine-code", route_id: "routine-code",
    role_ids: ["builder", "reviewer"],
    exit_status: "ok",
    gate: { command_names: ["npm-test", "npm-run-check-resources"], kind: "objective", result: "pass", source: "exit-status" },
    branch: "stage3/dispatch-policy-core", gate_file_paths: ["tests/dispatch-role-envelope.test.mjs"],
  }),
  expect: {
    task_class: "routine-code", route_id: "routine-code", classify_warnings_include: [],
    panel: { launched: 2, required_successes: 2, fail_closed: false, warnings_include: [] },
    run_record: { exit_status: "ok", warning_codes_include: [], gate_source: "exit-status" },
  },
};

/** 3. Panel proposes different Pi-extension shapes; synthesis picks the API-fit one. */
const extensionImplementationPlan = {
  id: "extension-implementation-plan",
  description: "Panel proposes different Pi-extension shapes; blinded judge compares before synthesis selects the API-matching shape.",
  task: { class_hint: "architecture", signals: [], confident: true, mode: "tui" },
  candidates: [
    { envelope: makeEnvelope({ role: "scout", provider: "openai-api", model: "gpt-x", recommendation: "shape-tool-only" }), expect_valid: true },
    { envelope: makeEnvelope({ role: "planner", provider: "openrouter", model: "vendor/y:free", recommendation: "shape-slash-command" }), expect_valid: true },
    { envelope: makeEnvelope({ role: "planner", provider: "mock", model: "mock-model", recommendation: "shape-renderer" }), expect_valid: true },
  ],
  judge: { seed: 11, permutation: [2, 0, 1], rubric_id: "ext-impl-rubric-v1" },
  run_record: baseRecord({
    run_id: "fx-ext-impl", task_class: "architecture", route_id: "architecture",
    role_ids: ["scout", "planner", "judge", "synthesizer"],
    provider_ids: ["openai-api", "openrouter", "mock"], model_ids: ["gpt-x", "vendor/y:free", "mock-model"],
    exit_status: "ok",
    gate: { command_names: ["spec-checklist", "second-provider-review"], kind: "objective", result: "pass", source: "deterministic-checker" },
    judge: { seed: 11, permutation: [2, 0, 1], blinding: true, rubric_id: "ext-impl-rubric-v1", label_reveal_events: [], judge_in_panel: false },
    branch: "stage3/dispatch-policy-core", gate_file_paths: ["docs/architecture/fusion-dispatch-research.md"],
  }),
  expect: {
    task_class: "architecture", route_id: "architecture", classify_warnings_include: [],
    panel: { launched: 3, required_successes: 3, fail_closed: false, warnings_include: [] },
    judge: { keys: ["A", "B", "C"], blinding: true },
    run_record: { exit_status: "ok", warning_codes_include: [], gate_source: "deterministic-checker" },
  },
};

/** 4. Redteam flags a hidden egress leak; the provider gate refuses a non-automated
 *  candidate (claude-local); gate blocks success. */
const securityPosture = {
  id: "security-posture",
  description: "Redteam flags a hidden egress/provenance leak; the provider gate refuses a non-automated claude-local candidate; success is withheld until the public-safety gate passes.",
  task: { class_hint: "routine-code", signals: ["egress", "public-safety"], confident: true, mode: "tui" },
  candidates: [
    // Requested claude-local candidate — refused by the automated-dispatch
    // provider gate, so never launched (no envelope).
    {
      envelope: null,
      expect_valid: null,
      provider_gate: { provider: "claude-local", model: "claude-cli" },
      expect_refusal: "provider-not-automated:claude-local",
    },
    { envelope: makeEnvelope({ role: "redteam", recommendation: "block", risks: ["hidden-egress-endpoint"] }), expect_valid: true },
  ],
  run_record: baseRecord({
    run_id: "fx-security-posture", task_class: "security", route_id: "security",
    role_ids: ["redteam", "judge", "synthesizer"],
    exit_status: "fail-closed",
    gate: { command_names: ["public-safety"], kind: "objective", result: "fail", source: "deterministic-checker" },
    warning_codes: ["floor-raised-classification", "provider-not-automated:claude-local"],
    branch: "stage3/dispatch-policy-core", gate_file_paths: ["tools/check-prime-resources.mjs"],
  }),
  expect: {
    task_class: "security", route_id: "security", classify_warnings_include: ["floor-raised-classification"],
    panel: { launched: 2, required_successes: 2, fail_closed: false, warnings_include: [] },
    run_record: { exit_status: "fail-closed", warning_codes_include: ["provider-not-automated:claude-local"], gate_source: "deterministic-checker" },
  },
};

/** 5. prime-ui path recommends a design; verifier keeps a11y/perf checks objective. */
const uiQuality = {
  id: "ui-quality",
  description: "prime-ui path produces a design recommendation; the verifier keeps accessibility/performance checks objective, separate from model taste.",
  task: { class_hint: "ui-quality", signals: [], confident: true, mode: "tui" },
  candidates: [
    { envelope: makeEnvelope({ role: "builder", recommendation: "layout-A" }), expect_valid: true },
    { envelope: makeEnvelope({ role: "reviewer", recommendation: "prefer-layout-A-with-contrast-fix" }), expect_valid: true },
  ],
  run_record: baseRecord({
    run_id: "fx-ui-quality", task_class: "ui-quality", route_id: "ui-quality",
    role_ids: ["builder", "reviewer"],
    exit_status: "ok",
    gate: { command_names: ["visual-check", "a11y-check", "perf-check"], kind: "objective", result: "pass", source: "deterministic-checker" },
    branch: "stage3/dispatch-policy-core", gate_file_paths: ["skills/prime-ui/SKILL.md"],
  }),
  expect: {
    task_class: "ui-quality", route_id: "ui-quality", classify_warnings_include: [],
    panel: { launched: 2, required_successes: 2, fail_closed: false, warnings_include: [] },
    run_record: { exit_status: "ok", warning_codes_include: [], gate_source: "deterministic-checker" },
  },
};

export const FIXTURES = Object.freeze([
  roadmapReconciliation,
  codeReview,
  extensionImplementationPlan,
  securityPosture,
  uiQuality,
]);
