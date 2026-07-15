// Helix dispatch — bounded task-loop entrypoint.
//
// This is the code-level entrypoint for daily-use loop configs. It composes the
// existing dispatch primitives and canonical workflow transitions instead of
// adding new authority:
//   run config -> chain -> route -> role matrix -> runDebate
// with a real git diff-stability checker, a real model-backed revision effect,
// and a deterministic no-live adapter for all-mock casts. This legacy engine is
// intentionally not the Pi-native provider path, so every real-provider cast
// refuses before any injected adapter/revision effect. Objective gates are deterministic checkers;
// model/judge/verifier output never decides convergence.

import { accessSync, constants, existsSync, readFileSync, statSync, realpathSync, lstatSync } from "node:fs";
import { spawn } from "node:child_process";
import { delimiter, join, dirname, isAbsolute, resolve, sep } from "node:path";
import { validateRunConfig } from "./run-configs.mjs";
import { resolveChain } from "./chains.mjs";
import { expandRoleMatrix } from "./role-matrix.mjs";
import { routeForClass } from "./routes.mjs";
import { runDebate } from "./debate.mjs";
import { makeGitDiffStability } from "./git-diff-surface.mjs";
import { makeModelRevision } from "./revision-effect.mjs";
import { decideWorkflowTransition } from "./workflows.mjs";

export const TASK_LOOP_CODES = Object.freeze({
  UNSAFE_GATE_PATH: "unsafe-gate-path",
  CHAIN_NOT_LOOP_RUNNABLE: "chain-not-loop-runnable",
});

/** Resolve multi-pass versus one-shot execution through the workflow loop rule. */
export function decideTaskLoopTransition(loopsEnabled) {
  return decideWorkflowTransition({
    id: "task-loop",
    max_passes: 1,
    transitions: [{ when: { type: "always" }, action: "retry" }],
  }, 0, {}, { loops: loopsEnabled });
}

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

function executableCandidates(cwd, command, env = process.env) {
  if (command.startsWith("./")) return [resolve(cwd, command)];
  const extensions = process.platform === "win32"
    ? String(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  return String(env.PATH ?? "").split(delimiter)
    .flatMap((directory) => {
      const base = directory === "" ? cwd : isAbsolute(directory) ? directory : resolve(cwd, directory);
      return extensions.map((extension) => join(base, `${command}${extension}`));
    });
}

export function preflightObjectiveGate(cwd, gate, { env = process.env } = {}) {
  if (gate?.type === "file-contains") return { ok: true, gate_kind: gate.type };
  if (gate?.type !== "command-exit-zero") return { ok: false, code: "objective-gate-invalid" };
  const candidates = executableCandidates(cwd, gate.command, env);
  const executable = candidates.find((candidate) => {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) return false;
      accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  return executable
    ? { ok: true, gate_kind: gate.type, executable }
    : { ok: false, code: "objective-gate-command-unavailable" };
}

export function makeCommandExitZeroGate(cwd, gate, { signal = null, spawnEffect = spawn } = {}) {
  return () => new Promise((resolveOutcome) => {
    const command = gate.command.startsWith("./") ? resolve(cwd, gate.command) : gate.command;
    const name = `command-exit-zero:${gate.command}`;
    let settled = false;
    let timer = null;
    let child = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      resolveOutcome({ command_names: [name], result, source: "deterministic-checker" });
    };
    const abort = () => {
      try {
        if (process.platform !== "win32" && Number.isSafeInteger(child?.pid)) process.kill(-child.pid, "SIGKILL");
        else child?.kill?.("SIGKILL");
      } catch {
        child?.kill?.("SIGKILL");
      }
      finish("fail");
    };
    if (signal?.aborted) return finish("fail");
    try {
      child = spawnEffect(command, gate.args, {
        cwd,
        shell: false,
        stdio: "ignore",
        detached: process.platform !== "win32",
      });
    } catch {
      return finish("fail");
    }
    child.once("error", () => finish("fail"));
    child.once("close", (code) => finish(code === 0 ? "pass" : "fail"));
    signal?.addEventListener?.("abort", abort, { once: true });
    timer = setTimeout(abort, gate.timeout_ms);
    if (signal?.aborted) abort();
  });
}

export function makeObjectiveGate(cwd, gate, options = {}) {
  if (gate?.type === "file-contains") return makeFileContainsGate(cwd, gate);
  if (gate?.type === "command-exit-zero") return makeCommandExitZeroGate(cwd, gate, options);
  return async () => ({ command_names: ["objective-gate-invalid"], result: "fail", source: "deterministic-checker" });
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
  return {
    provider: spec.provider,
    model: spec.model,
    ...(spec.effort ? { effort: spec.effort } : {}),
    rubric_id: rubricId,
  };
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
  const revisionContent = config.objective_gate.type === "file-contains"
    ? { [config.objective_gate.path]: `Helix synthetic proposal\n${config.objective_gate.contains}\n` }
    : {};
  const revisionModelAdapter = deps.revisionAdapter ?? mock?.revisionAdapter(revisionContent) ?? null;

  const revise = makeModelRevision({
    cwd: deps.cwd,
    builder: builderConfig(builder),
  }, { modelAdapter: revisionModelAdapter });

  // With loops OFF, execution degenerates to a single pass: every stage
  // runs at most once — max_iterations is forced to 1, gates still run and
  // report. This is degeneration, never an error.
  const toggles = deps.toggles ?? null;
  const loopsEnabled = !toggles || toggles.loops !== false;
  const loopTransition = decideTaskLoopTransition(loopsEnabled);
  const effectiveMaxIterations = loopTransition.action === "retry" ? config.max_iterations : 1;

  const debate = await runDebate({
    run_id: runId,
    base_request: request,
    max_iterations: effectiveMaxIterations,
  }, {
    adapter: dispatchAdapter,
    runGate: makeObjectiveGate(deps.cwd, config.objective_gate),
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
