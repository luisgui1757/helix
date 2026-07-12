// Helix dispatch — bounded task-loop entrypoint (Stage 3M/N).
//
// This is the code-level entrypoint for daily-use loop configs. It composes the
// existing Stage 3 primitives instead of adding new authority:
//   run config -> chain -> route -> role matrix -> runDebate
// with a real git diff-stability checker, a real model-backed revision effect,
// and a deterministic no-live adapter for all-mock casts. This build has no
// live task-loop transport, so every real-provider cast refuses before any
// injected adapter/revision effect. Objective gates are deterministic checkers;
// model/judge/verifier output never decides convergence.

import { readFileSync, statSync, realpathSync, lstatSync } from "node:fs";
import { join, dirname, isAbsolute, sep } from "node:path";
import { validateRunConfig } from "./run-configs.mjs";
import { resolveChain } from "./chains.mjs";
import { expandRoleMatrix } from "./role-matrix.mjs";
import { routeForClass } from "./routes.mjs";
import { runDebate } from "./debate.mjs";
import { makeGitDiffStability } from "./git-diff-surface.mjs";
import { makeModelRevision } from "./revision-effect.mjs";

export const TASK_LOOP_CODES = Object.freeze({
  UNSAFE_GATE_PATH: "unsafe-gate-path",
  CHAIN_NOT_LOOP_RUNNABLE: "chain-not-loop-runnable",
});

function failClosed(code, detail = null, extra = {}) {
  return { ok: false, status: "fail-closed", code, detail, ...extra };
}

function errorsToDetail(errors) {
  return errors.map((error) => `${error.path} ${error.message}`).join("; ");
}

function resolveMatrix(matrixConfig, id) {
  if (matrixConfig?.matrix_id === id) return { ok: true, matrix: matrixConfig };
  return { ok: false, code: "unknown-role-matrix", detail: id };
}

function safeRelativePath(rel) {
  return typeof rel === "string"
    && rel.length > 0
    && !rel.includes("\0")
    && !isAbsolute(rel)
    && !rel.includes("..");
}

function inTree(realPath, realRoot) {
  return realPath === realRoot || realPath.startsWith(realRoot + sep);
}

function resolveContainedPath(cwd, rel) {
  const fail = () => ({ ok: false, code: TASK_LOOP_CODES.UNSAFE_GATE_PATH });
  if (!safeRelativePath(rel)) return fail();
  let root;
  let parent;
  let stat;
  let real;
  try {
    root = realpathSync(cwd);
    const full = join(cwd, rel);
    stat = lstatSync(full);
    if (stat.isSymbolicLink() || !stat.isFile()) return fail();
    parent = realpathSync(dirname(full));
    real = realpathSync(full);
  } catch {
    return fail();
  }
  if (!inTree(parent, root) || !inTree(real, root)) return fail();
  return { ok: true, path: real };
}

export function makeFileContainsGate(cwd, gate) {
  return () => {
    const resolved = resolveContainedPath(cwd, gate.path);
    if (!resolved.ok) {
      return { command_names: [`file-contains:${gate.path}`, resolved.code], result: "fail", source: "deterministic-checker" };
    }
    let text = "";
    try {
      text = readFileSync(resolved.path, "utf8");
    } catch {
      text = "";
    }
    return {
      command_names: [`file-contains:${gate.path}`],
      result: text.includes(gate.contains) ? "pass" : "fail",
      source: "deterministic-checker",
    };
  };
}

function structuralEnvelope({ run_id, role, provider, model, stage = "candidate", status = "ok", recommendation = "ok", open_questions = [] }) {
  return {
    schema_version: 2,
    run_id,
    stage,
    role,
    provider,
    model,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
    },
    attempt: 1,
    iteration: 1,
    input_ref: { kind: "local-ref", value: `local-ref:input/${run_id}`, algorithm: null },
    claims_ref: `local-ref:claims/${run_id}`,
    evidence_ref: `local-ref:evidence/${run_id}`,
    uncertainty: [],
    risks: [],
    recommendation,
    proposed_actions: [],
    open_questions,
    status,
  };
}

function stageConfig(spec, rubricId) {
  return { provider: spec.provider, model: spec.model, rubric_id: rubricId };
}

function builderConfig(spec) {
  const out = { provider: spec.provider, model: spec.model };
  if (spec.effort) out.effort = spec.effort;
  return out;
}

export function createNoLiveMockAdapter() {
  const calls = { candidates: 0, judges: 0, synthesis: 0, verifiers: 0, revisions: 0 };
  return {
    calls,
    dispatchAdapter: {
      runCandidate(spec, ctx) {
        calls.candidates += 1;
        return structuralEnvelope({
          run_id: ctx.run_id,
          role: spec.role,
          provider: spec.provider,
          model: spec.model,
          recommendation: `${spec.role}-ok`,
        });
      },
      runJudge(input, ctx) {
        calls.judges += 1;
        return structuralEnvelope({
          run_id: ctx.run_id,
          stage: "judge",
          role: "judge",
          provider: "mock",
          model: "mock-judge",
          recommendation: input.rubric_id,
        });
      },
      runSynthesis(input, ctx) {
        calls.synthesis += 1;
        return structuralEnvelope({
          run_id: ctx.run_id,
          stage: "synthesis",
          role: "synthesizer",
          provider: "mock",
          model: "mock-synthesizer",
          recommendation: input.rubric_id ?? "synthesized",
          open_questions: input.contradictions ?? [],
        });
      },
      runVerifier(_input, ctx) {
        calls.verifiers += 1;
        return structuralEnvelope({
          run_id: ctx.run_id,
          stage: "verification",
          role: "verifier",
          provider: "mock",
          model: "mock-verifier",
          recommendation: "proof summarized",
        });
      },
    },
    revisionAdapter(contentByPath) {
      return {
        runRevision() {
          calls.revisions += 1;
          return { edits: Object.entries(contentByPath).map(([path, content]) => ({ path, content })) };
        },
      };
    },
  };
}

export function preflightTaskLoopConfig(config, registries) {
  const configValid = validateRunConfig(config);
  if (!configValid.valid) return failClosed("invalid-run-config", errorsToDetail(configValid.errors));

  const chainResult = resolveChain(registries?.chainRegistry, config.chain);
  if (!chainResult.ok) return failClosed(chainResult.code, chainResult.detail);
  const chain = chainResult.chain;
  if (!chain.requires_objective_gate) return failClosed("chain-missing-objective-gate");

  const route = routeForClass(chain.task_class);
  if (!route) return failClosed("chain-route-unknown", chain.task_class);
  if (!route.roles.includes("builder")) {
    return failClosed(`${TASK_LOOP_CODES.CHAIN_NOT_LOOP_RUNNABLE}:${chain.id}`, chain.task_class);
  }

  const matrixResult = resolveMatrix(registries?.roleMatrix, config.role_matrix);
  if (!matrixResult.ok) return failClosed(matrixResult.code, matrixResult.detail);
  const expanded = expandRoleMatrix({
    matrix: matrixResult.matrix,
    route,
    agent_team: registries?.agentTeam,
  });
  if (!expanded.ok) return failClosed(expanded.code, expanded.detail, { warnings: expanded.warnings });

  const builder = expanded.candidates.find((spec) => spec.role === "builder");
  if (!builder) return failClosed("matrix-missing-role:builder");

  return {
    ok: true,
    status: "ok",
    config,
    chain,
    route,
    matrix: matrixResult.matrix,
    expanded,
    builder,
    warnings: expanded.warnings,
  };
}

/**
 * Run a bounded task loop from a validated run config.
 *
 * @param {object} config RUN_CONFIG_SCHEMA-shaped config.
 * @param {object} registries { chainRegistry, roleMatrix, agentTeam? }.
 * @param {object} deps { cwd, now, seed, mode?, record_dir?, adapter?, revisionAdapter? }.
 */
export async function runTaskLoop(config, registries, deps = {}) {
  const fail = failClosed;

  const preflight = preflightTaskLoopConfig(config, registries);
  if (!preflight.ok) return preflight;
  if (typeof deps.now !== "number" || !Number.isFinite(deps.now)) return fail("missing-clock");
  if (typeof deps.cwd !== "string") return fail("missing-worktree");
  try {
    if (!statSync(deps.cwd).isDirectory()) return fail("missing-worktree");
  } catch {
    return fail("missing-worktree");
  }

  const { chain, route, matrix, expanded, builder } = preflight;

  const effectiveProviders = [
    ...expanded.candidates,
    expanded.judge,
    expanded.synthesis,
    expanded.verification,
  ].filter(Boolean).map((spec) => spec.provider);
  if (effectiveProviders.some((provider) => provider !== "mock")) {
    return fail("live-adapter-not-wired");
  }

  const runId = deps.run_id ?? config.id;
  const request = {
    run_id: runId,
    task: { class_hint: chain.task_class, confident: true },
    candidates: expanded.candidates,
    ...(expanded.judge ? { judge: stageConfig(expanded.judge, `${chain.id}-rubric-v1`) } : {}),
    ...(expanded.synthesis ? { synthesis: stageConfig(expanded.synthesis, `${chain.id}-rubric-v1`) } : {}),
    ...(expanded.verification ? { verification: stageConfig(expanded.verification, `${chain.id}-rubric-v1`) } : {}),
    run_target: config.run_target,
    input_refs: config.input_refs ?? [],
    claims_ref: config.claims_ref,
    evidence_ref: config.evidence_ref,
  };

  const mock = deps.adapter ? null : createNoLiveMockAdapter();
  const dispatchAdapter = deps.adapter ?? mock.dispatchAdapter;
  const revisionModelAdapter = deps.revisionAdapter ?? mock?.revisionAdapter({
    [config.objective_gate.path]: `Helix synthetic proposal\n${config.objective_gate.contains}\n`,
  }) ?? null;

  const revise = makeModelRevision({
    cwd: deps.cwd,
    builder: builderConfig(builder),
  }, { modelAdapter: revisionModelAdapter });

  // Feature toggles (M2). loops OFF degenerates to a single pass: every stage
  // runs at most once — max_iterations is forced to 1, gates still run and
  // report. This is degeneration, never an error.
  const toggles = deps.toggles ?? null;
  const loopsEnabled = !toggles || toggles.loops !== false;
  const effectiveMaxIterations = loopsEnabled ? config.max_iterations : 1;

  const debate = await runDebate({
    run_id: runId,
    base_request: request,
    max_iterations: effectiveMaxIterations,
  }, {
    adapter: dispatchAdapter,
    runGate: makeFileContainsGate(deps.cwd, config.objective_gate),
    now: deps.now,
    seed: deps.seed ?? 7,
    mode: deps.mode ?? "print",
    record_dir: deps.record_dir,
    parallel: config.parallel,
    diffStability: makeGitDiffStability({ cwd: deps.cwd }),
    revise,
    ...(toggles != null ? { toggles } : {}),
  });

  return {
    ok: debate.ok,
    status: debate.status,
    code: debate.code,
    chain_id: chain.id,
    route_id: route.id,
    matrix_id: matrix.matrix_id,
    warnings: [...expanded.warnings, ...debate.warnings],
    debate,
    calls: mock?.calls ?? null,
  };
}
