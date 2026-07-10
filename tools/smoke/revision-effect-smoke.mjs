#!/usr/bin/env node
// revision-effect-smoke.mjs — deterministic model-backed revision smoke (Stage 3I).
//
// Drives a real iterating/adversarial debate over a REAL temp git repo where the
// next proposal is produced by the real `makeModelRevision` effect through an
// INJECTED, deterministic model adapter (NO network, NO credentials). The
// effect really mutates the worktree; the real git diff surface observes it; the
// debate converges only on diff-stability + objective-gate-pass (the objective gate
// stays final authority). Output is structural only — ids, stable codes, counts —
// never prompts, model responses, provider payloads, or raw diff text.
//
// This is NOT a live model proof. The model adapter is a deterministic in-process
// boundary. Run under `--network none` if desired.
//
// Usage: node tools/smoke/revision-effect-smoke.mjs
// Exit:  0 the debate converged via a real worktree revision · 1 it did not.

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, devNull } from "node:os";
import { join } from "node:path";
import { runDebate } from "../../dispatch/lib/debate.mjs";
import { makeModelRevision } from "../../dispatch/lib/revision-effect.mjs";
import { makeGitDiffStability } from "../../dispatch/lib/git-diff-surface.mjs";
import { makeEnvelope } from "../../dispatch/fixtures/sample.mjs";

const NOW = 1_751_731_200; // fixed epoch seconds — determinism over wall clock
const SEED = 7;

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "prime-smoke",
  GIT_AUTHOR_EMAIL: "prime@smoke.invalid",
  GIT_COMMITTER_NAME: "prime-smoke",
  GIT_COMMITTER_EMAIL: "prime@smoke.invalid",
  LC_ALL: "C",
  TZ: "UTC",
};

function git(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

// A temp repo with a committed proposal.txt on a clean tree.
const repo = mkdtempSync(join(tmpdir(), "prime-rev-smoke-"));
const records = mkdtempSync(join(tmpdir(), "prime-rev-smoke-rec-")); // OUT of the diffed tree
git(repo, ["init", "-q"]);
writeFileSync(join(repo, "proposal.txt"), "base\n");
git(repo, ["add", "proposal.txt"]);
git(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "base"]);

// risky-change panel (adversarial: has redteam) + objective gate.
const base = {
  run_id: "rev-smoke",
  task: { class_hint: "risky-change", confident: true },
  candidates: [
    { role: "builder", provider: "mock", model: "mock-model" },
    { role: "reviewer", provider: "mock", model: "mock-model" },
    { role: "redteam", provider: "mock", model: "mock-model" },
  ],
  run_target: { repo: "self" },
  input_refs: [{ kind: "local-ref", value: "local-ref:input/rev-smoke", algorithm: null }],
  claims_ref: "local-ref:claims/rev-smoke",
  evidence_ref: "local-ref:evidence/rev-smoke",
};

// The model returns a CONSTANT proposal: iteration 1's revision changes the tree,
// iteration 2's is a no-op → the real diff surface stabilizes → convergence.
const modelAdapter = {
  calls: 0,
  runRevision() {
    this.calls += 1;
    return { edits: [{ path: "proposal.txt", content: "base\nrevised-by-model\n" }] };
  },
};

const revise = makeModelRevision(
  { cwd: repo, builder: { provider: "mock", model: "mock-model" } },
  { modelAdapter },
);

let failed = false;
try {
  const debate = await runDebate(
    { run_id: "rev-smoke", base_request: base, max_iterations: 5 },
    {
      adapter: { runCandidate: (spec, ctx) => makeEnvelope({ run_id: ctx.run_id, role: spec.role, provider: spec.provider, model: spec.model, recommendation: spec.role === "redteam" ? "no-blockers" : "proceed" }) },
      runGate: () => ({ command_names: ["relevant-tests", "risk-gate"], result: "pass", source: "deterministic-checker" }),
      now: NOW, seed: SEED, mode: "print", record_dir: records,
      diffStability: makeGitDiffStability({ cwd: repo }),
      revise,
    },
  );

  const worktree = readFileSync(join(repo, "proposal.txt"), "utf8");
  console.log("# revision-effect smoke (real temp repo, mock model adapter, no network)");
  console.log(`  status:       ${debate.status}${debate.code ? ` (${debate.code})` : ""}`);
  console.log(`  converged:    ${debate.converged} (${debate.stop_reason})`);
  console.log(`  iterations:   ${debate.iterations_run}/${debate.max_iterations}`);
  console.log(`  diffs:        ${debate.iterations.map((it) => `${it.iteration}:${it.diff_code}`).join(", ")}`);
  console.log(`  gates:        ${debate.iterations.map((it) => `${it.iteration}:${it.gate_result}`).join(", ")}`);
  console.log(`  revisions:    ${debate.revisions.length} (after iterations ${debate.revisions.map((r) => r.after_iteration).join(", ") || "-"})`);
  console.log(`  model calls:  ${modelAdapter.calls}`);
  console.log(`  worktree:     proposal.txt is ${worktree.includes("revised-by-model") ? "revised by the model" : "UNCHANGED"}`);
  console.log(`  summary:      ${debate.summary_path ?? "(not written)"}`);

  // Success is a REAL convergence via a REAL worktree mutation — not a canned value.
  const ok = debate.ok
    && debate.converged
    && debate.iterations_run === 3
    && debate.revisions.length === 2
    && modelAdapter.calls === 2
    && worktree.includes("revised-by-model");
  if (!ok) {
    console.error("revision-effect-smoke: did not converge via a real revision — fail closed.");
    failed = true;
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(records, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log("RESULT: PASS (real model-backed revision mutated the worktree; debate converged on diff-stability + gate-pass).");
process.exit(0);
