#!/usr/bin/env node
// dispatch-smoke.mjs — deterministic dispatch smokes over the thin orchestrator.
// Mock adapters only: NO network, NO credentials.
//
// Four dispatch scenarios then one Stage 3G iterating-debate scenario run in sequence:
//   1. routine-code — panel + objective gate (no judge/synthesis).
//   2. roadmap-reconciliation — panel + blinded judge + synthesis that PRESERVES
//      a candidate contradiction, then the objective gate.
//   3. pr-preflight — panel + objective gate + an advisory verifier that
//      summarizes the objective proof (never decides the gate).
//   4. risky-change (PARALLEL) — a 3-candidate panel launched with a bounded
//      concurrency cap; output order stays deterministic.
//   5. risky-change (DEBATE, Stage 3G) — a bounded iterating/adversarial loop over
//      the cycle above: an unstable diff that stabilizes on iteration 2, then a
//      passing objective gate ⇒ convergence (diff-stability + objective-gate-pass),
//      capped by max_iterations (the one rail).
// Everything is fixed (clock, seed, run ids, canned envelopes, canned gates,
// deterministic diff checker), so repeated runs produce byte-identical structural
// run records + debate summary in the gitignored dispatch/runs/ directory. Output is
// structural-only: ids, codes, and counts — never prompts, model responses, or
// provider payloads.
//
// Usage: node tools/smoke/dispatch-smoke.mjs
// Exit:  0 all scenarios reached "ok" · 1 a scenario failed closed / blocked.

import { runDispatch } from "../../dispatch/lib/orchestrate.mjs";
import { runDebate } from "../../dispatch/lib/debate.mjs";
import { DEFAULT_RUN_RECORD_DIR } from "../../dispatch/lib/run-record.mjs";
import { makeEnvelope } from "../../dispatch/fixtures/sample.mjs";

const NOW = 1_751_731_200; // fixed epoch seconds — determinism over wall clock
const SEED = 7;

// Canned deterministic gates: these smokes prove orchestration, not the checks.
const passGate = (command) => () => ({ command_names: [command], result: "pass", source: "deterministic-checker" });

// --- scenario 1: routine-code (panel + objective gate) -----------------------
const routine = {
  run_id: "smoke-dispatch-mock",
  request: {
    run_id: "smoke-dispatch-mock",
    task: { class_hint: "routine-code", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/dispatch-smoke", algorithm: null }],
    claims_ref: "local-ref:claims/dispatch-smoke",
    evidence_ref: "local-ref:evidence/dispatch-smoke",
  },
  adapter: {
    runCandidate: (spec) => makeEnvelope({
      run_id: "smoke-dispatch-mock",
      role: spec.role,
      provider: spec.provider,
      model: spec.model,
      recommendation: spec.role === "reviewer" ? "approve" : "ship",
    }),
  },
  runGate: passGate("mock-objective-gate"),
};

// --- scenario 2: roadmap-reconciliation (panel + judge + synthesis) ----------
const CONTRADICTION = "contradicts-planner-recommendation";
const SYN_RUN_ID = "smoke-dispatch-synthesis";
const synthesis = {
  run_id: SYN_RUN_ID,
  request: {
    run_id: SYN_RUN_ID,
    task: { class_hint: "roadmap-reconciliation", confident: true },
    candidates: [
      { role: "planner", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
    ],
    judge: { provider: "mock", model: "mock-judge", rubric_id: "recon-rubric-v1" },
    synthesis: { provider: "mock", model: "mock-synth", rubric_id: "recon-rubric-v1" },
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/dispatch-synthesis-smoke", algorithm: null }],
    claims_ref: "local-ref:claims/dispatch-synthesis-smoke",
    evidence_ref: "local-ref:evidence/dispatch-synthesis-smoke",
  },
  adapter: {
    runCandidate: (spec) => makeEnvelope({
      run_id: SYN_RUN_ID,
      role: spec.role,
      provider: spec.provider,
      model: spec.model,
      recommendation: spec.role === "reviewer" ? "keep-checkbox-open" : "mark-checkbox-done",
      risks: spec.role === "reviewer" ? [CONTRADICTION] : [],
    }),
    runJudge: () => makeEnvelope({ run_id: SYN_RUN_ID, stage: "judge", role: "judge", provider: "mock", model: "mock-judge" }),
    // The synthesizer quotes the unresolved contradiction instead of averaging it away.
    runSynthesis: () => makeEnvelope({ run_id: SYN_RUN_ID, stage: "synthesis", role: "synthesizer", provider: "mock", model: "mock-synth", open_questions: [CONTRADICTION] }),
  },
  runGate: passGate("roadmap-consistency-check"),
};

// --- scenario 3: pr-preflight (panel + objective gate + verifier proof summary) --
const VER_RUN_ID = "smoke-dispatch-verification";
const verification = {
  run_id: VER_RUN_ID,
  request: {
    run_id: VER_RUN_ID,
    task: { class_hint: "pr-preflight", confident: true },
    candidates: [
      { role: "reviewer", provider: "mock", model: "mock-model" },
      { role: "redteam", provider: "mock", model: "mock-model" },
    ],
    verification: { provider: "mock", model: "mock-verifier", rubric_id: "preflight-rubric-v1" },
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/dispatch-verification-smoke", algorithm: null }],
    claims_ref: "local-ref:claims/dispatch-verification-smoke",
    evidence_ref: "local-ref:evidence/dispatch-verification-smoke",
  },
  adapter: {
    runCandidate: (spec) => makeEnvelope({
      run_id: VER_RUN_ID, role: spec.role, provider: spec.provider, model: spec.model,
      recommendation: spec.role === "redteam" ? "no-blockers" : "approve",
    }),
    // The verifier summarizes the objective proof; it never decides the gate.
    runVerifier: () => makeEnvelope({ run_id: VER_RUN_ID, stage: "verification", role: "verifier", provider: "mock", model: "mock-verifier" }),
  },
  runGate: passGate("pr-gate/checklist"),
};

// --- scenario 4: risky-change (bounded parallel candidate launch) ----------------
const PAR_RUN_ID = "smoke-dispatch-parallel";
const parallel = {
  run_id: PAR_RUN_ID,
  request: {
    run_id: PAR_RUN_ID,
    task: { class_hint: "risky-change", confident: true },
    candidates: [
      { role: "builder", provider: "mock", model: "mock-model" },
      { role: "reviewer", provider: "mock", model: "mock-model" },
      { role: "redteam", provider: "mock", model: "mock-model" },
    ],
    run_target: { repo: "self" },
    input_refs: [{ kind: "local-ref", value: "local-ref:input/dispatch-parallel-smoke", algorithm: null }],
    claims_ref: "local-ref:claims/dispatch-parallel-smoke",
    evidence_ref: "local-ref:evidence/dispatch-parallel-smoke",
  },
  adapter: {
    runCandidate: (spec) => makeEnvelope({
      run_id: PAR_RUN_ID, role: spec.role, provider: spec.provider, model: spec.model,
      recommendation: spec.role === "redteam" ? "no-blockers" : "proceed",
    }),
  },
  runGate: passGate("relevant-tests-risk-gate"),
  // Bounded fan-out: <=2 candidate launches in flight (resource bound, not cost control).
  parallel: { max_concurrency: 2 },
};

let failures = 0;
for (const scenario of [routine, synthesis, verification, parallel]) {
  const result = await runDispatch(scenario.request, {
    adapter: scenario.adapter,
    runGate: scenario.runGate,
    now: NOW,
    seed: SEED,
    mode: "print",
    record_dir: DEFAULT_RUN_RECORD_DIR,
    ...(scenario.parallel ? { parallel: scenario.parallel } : {}),
  });

  console.log(`# dispatch smoke: ${scenario.run_id} (mock, no network)`);
  console.log(`  status:     ${result.status}${result.code ? ` (${result.code})` : ""}`);
  console.log(`  route:      ${result.decision?.route_id ?? "-"}`);
  console.log(`  launched:   ${result.candidates?.filter((c) => c.disposition === "launched").length ?? 0}`);
  console.log(`  parallel:   ${scenario.parallel ? `max_concurrency=${scenario.parallel.max_concurrency}` : "(sequential)"}`);
  console.log(`  synthesis:  ${result.synthesis ? `preserved=${result.synthesis.contradictions_preserved} (${result.synthesis.contradiction_count})` : "(none)"}`);
  console.log(`  verifier:   ${result.verification ? `ran (status=${result.verification.status}, advisory)` : "(none)"}`);
  console.log(`  gate:       ${result.record ? `${result.record.gate.result} (${result.record.gate.source})` : "-"}`);
  console.log(`  warnings:   ${result.warnings.length ? result.warnings.join(", ") : "(none)"}`);
  console.log(`  record:     ${result.record_path ?? "(not written)"}`);

  if (!result.ok) {
    console.error(`dispatch-smoke: scenario ${scenario.run_id} did not reach 'ok' — fail closed.`);
    failures += 1;
  }
}

// --- scenario 5: risky-change DEBATE (Stage 3G iterating / adversarial loop) ------
// One iteration is the risky-change dispatch cycle. A deterministic diff checker
// reports the proposed change unstable on iteration 1 and stable from iteration 2;
// the objective gate passes each iteration. Convergence = diff-stability +
// objective-gate-pass ⇒ the loop stops on iteration 2. Bounded by max_iterations
// (the one rail); mock adapters only, no network.
const DEBATE_RUN_ID = "smoke-dispatch-debate";
const debateBase = {
  run_id: DEBATE_RUN_ID, // overridden per iteration (`${run_id}-iterN`)
  task: { class_hint: "risky-change", confident: true },
  candidates: [
    { role: "builder", provider: "mock", model: "mock-model" },
    { role: "reviewer", provider: "mock", model: "mock-model" },
    { role: "redteam", provider: "mock", model: "mock-model" },
  ],
  run_target: { repo: "self" },
  input_refs: [{ kind: "local-ref", value: "local-ref:input/dispatch-debate-smoke", algorithm: null }],
  claims_ref: "local-ref:claims/dispatch-debate-smoke",
  evidence_ref: "local-ref:evidence/dispatch-debate-smoke",
};
// Deterministic diff-stability checker: unstable until iteration 2, then stable.
const debateDiff = (_prev, _curr, ctx) => ({
  stable: ctx.iteration >= 2,
  code: ctx.iteration >= 2 ? "diff-stable" : "diff-changing",
});
const debate = await runDebate(
  { run_id: DEBATE_RUN_ID, base_request: debateBase, max_iterations: 5 },
  {
    adapter: {
      runCandidate: (spec, ctx) => makeEnvelope({
        run_id: ctx.run_id, role: spec.role, provider: spec.provider, model: spec.model,
        recommendation: spec.role === "redteam" ? "no-blockers" : "proceed",
      }),
    },
    runGate: passGate("relevant-tests-risk-gate"),
    now: NOW,
    seed: SEED,
    mode: "print",
    record_dir: DEFAULT_RUN_RECORD_DIR,
    diffStability: debateDiff,
  },
);
console.log(`# dispatch smoke: ${DEBATE_RUN_ID} (DEBATE, mock, no network)`);
console.log(`  status:     ${debate.status}${debate.code ? ` (${debate.code})` : ""}`);
console.log(`  converged:  ${debate.converged} (${debate.stop_reason})`);
console.log(`  iterations: ${debate.iterations_run}/${debate.max_iterations}`);
console.log(`  diffs:      ${debate.iterations.map((it) => `${it.iteration}:${it.diff_result}`).join(", ")}`);
console.log(`  gates:      ${debate.iterations.map((it) => `${it.iteration}:${it.gate_result}`).join(", ")}`);
console.log(`  tokens:     ${debate.total_tokens}`);
console.log(`  summary:    ${debate.summary_path ?? "(not written)"}`);
if (!debate.ok) {
  console.error(`dispatch-smoke: debate scenario ${DEBATE_RUN_ID} did not converge — fail closed.`);
  failures += 1;
}

if (failures > 0) process.exit(1);
console.log("RESULT: PASS (deterministic mock dispatch cycles + iterating debate; structural records written).");
process.exit(0);
