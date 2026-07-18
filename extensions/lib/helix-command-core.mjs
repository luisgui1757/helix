// Pi-runtime-free command core for Helix's native slash-command surface.
//
// This module is Pi-runtime-free: it renders resolved Helix control-surface
// views and delegates policy to the existing dispatch validators/resolvers. The
// Mutating verbs (settings set, profile create/switch, setup, and structural
// prune) are gated by ctx.mode + explicit confirmation before any writer runs.

import { readFileSync, existsSync, lstatSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../../dispatch/lib/schema.mjs";
import { reduceEventLifecycle, validateCheckpointEventBinding, validateEventHistory } from "../../dispatch/lib/events.mjs";
import { EFFORTS, routeForClass } from "../../dispatch/lib/routes.mjs";
import { PI_EFFORT_CODES } from "../../dispatch/lib/pi-effort.mjs";
import { resolveRunConfig, validateRunConfigRegistry } from "../../dispatch/lib/run-configs.mjs";
import { listRuns, pruneRun, statusRun, validateRunId } from "../../dispatch/lib/run-manager.mjs";
import { assertPublicSafe, hashRef, stableStringify } from "../../dispatch/lib/run-record.mjs";
import { isModelId, isPublicCode } from "../../dispatch/lib/public-values.mjs";
import { validateDisagreementDocument } from "../../dispatch/lib/handoff.mjs";
import { resolveChain, validateChainRegistry } from "../../dispatch/lib/chains.mjs";
import {
  WORKFLOW_TEMPLATES,
  createWorkflowFromTemplate,
  isSafeWorkflowPath,
  testWorkflow,
  workflowExecutionBindingRef,
  workflowLifecycleSnapshot,
  validateWorkflowLifecycleSnapshot,
  workflowRequiredHostEffects,
  workflowToExecution,
} from "../../dispatch/lib/workflows.mjs";
import { normalizeWorkflowDefinition } from "../../dispatch/workflow/schema.mjs";
import { observedWorkflowGraph, plannedWorkflowGraph } from "../../dispatch/workflow/visualize.mjs";
import { preflightObjectiveGate } from "../../dispatch/lib/task-loop.mjs";
import { resolveChainCast } from "../../dispatch/lib/presets.mjs";
import { validateRoleMatrixConfig } from "../../dispatch/lib/role-matrix.mjs";
import { validateMachineResume } from "../../dispatch/lib/stage-machine.mjs";
import {
  allCastProviders,
  disagreementSnapshotPath,
  validateRunnerState,
} from "../../dispatch/lib/runner.mjs";

// The event/state files on disk are written by the guarded emitter, but the
// display verbs must not TRUST that — a doctored or worktree-OFF-written file
// could carry raw text. Scan parsed content read-time, exactly as listRuns/
// statusRun re-scan every record; a violation fails closed rather than
// rendering. Returns the parsed value or a refusal result.
function scanOrRefuse(parsed, title) {
  try {
    assertPublicSafe(parsed);
  } catch {
    return { leak: fail("run-record-invalid-or-unsafe", "read-time-public-safety", title) };
  }
  return { value: parsed };
}
import {
  HELIX_TOGGLES,
  DEFAULT_SETTINGS_REL_PATH,
  loadSettings,
  saveSettings,
  toggleVector,
  requireToggle,
} from "../../dispatch/lib/settings.mjs";
import { loadPresetRegistry } from "../../dispatch/lib/presets.mjs";
import { RESEARCH_SPEC_SCHEMA, parseStrictNumberToken } from "../../dispatch/lib/research.mjs";
import {
  listProfiles,
  loadProfile,
  saveProfile,
  resolveActiveProfile,
  saveAndActivateProfile,
  switchProfile,
  applyProfileToConfig,
  applyProfileToPresets,
} from "./helix-local.mjs";
import { helixStateRoot as defaultHelixStateRoot } from "./helix-paths.mjs";
import {
  builtInWorkflows,
  resolveWorkflow,
  saveUserWorkflow,
  saveUserWorkflowV4,
  workflowCatalog,
} from "./helix-workflows.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const HELIX_USAGE = `Usage:
  /helix
  /helix-help
  /helix-onboarding
  /helix-run [workflow-id] [-- <task>]
  /helix-runs
  /helix-run-status <run-id>
  /helix-run-watch <run-id>
  /helix-run-resume <run-id>
  /helix-run-prune <run-id>
  /helix-models
  /helix-chains
  /helix-workflows [list | show <id> | test <id>]
  /helix-workflows import <repository-relative-v4.json>
  /helix-workflow-create <id> [implement-review|plan-implement|tdd-fix]
  /helix-workflow-edit [id]
  /helix-workflow-clone [id]
  /helix-workflow-delete [id]
  /helix-settings [<toggle> on|off]
  /helix-profiles [show <id> | switch <id> | create <id>]
  /helix-setup [<existing-profile-id> <stage>=<preset | provider/model[:effort]> ...]
               [<preset>.<role>=<provider/model[:effort][*instances]>[, ...] ...]
  /helix-research <question> --metric <name> <cmp> <target> --max <n> [--plateau <n>]

Most commands are preflight/view/state operations. In Pi's TUI, /helix-run
executes a named workflow in-process after an attended confirmation. Mock casts
stay deterministic; real casts use the exact providers and models already
configured and available in Pi. Helix never configures provider credentials.`;

const TOP_LEVEL_COMPLETIONS = Object.freeze([
  { value: "help", label: "help", description: "Show the public-safe Helix cheat sheet" },
  { value: "run", label: "run", description: "Preflight a run config; do not launch" },
  { value: "runs", label: "runs", description: "List, inspect, or prune structural run records" },
  { value: "models", label: "models", description: "View composite presets and the default role matrix" },
  { value: "chains", label: "chains", description: "View the staged chain catalog" },
  { value: "workflows", label: "workflows", description: "Create, inspect, and simulate named workflows" },
  { value: "settings", label: "settings", description: "View or toggle the six Helix feature switches" },
  { value: "profiles", label: "profiles", description: "List, inspect, switch, or create saved casts" },
  { value: "setup", label: "setup", description: "Assemble a profile's per-stage cast" },
  { value: "research", label: "research", description: "Validate a research spec (metric + stop) and print its CLI" },
]);

const RUNS_COMPLETIONS = Object.freeze([
  { value: "runs list", label: "list", description: "List structural run records" },
  { value: "runs status ", label: "status", description: "Inspect one structural run record" },
  { value: "runs watch ", label: "watch", description: "Render the loop widget from a run's event stream" },
  { value: "runs resume ", label: "resume", description: "Print the resume CLI for an interrupted run" },
  { value: "runs prune ", label: "prune", description: "Delete one structural run directory; TUI confirm required" },
]);

const SAFE_BASENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const REFUSAL_GUIDANCE = Object.freeze({
  "helix-config-unreadable": {
    reason: "Helix could not read a committed local registry/config file.",
    next: "Run npm run check:resources and restore or fix the named JSON file.",
  },
  "unknown-run-config": {
    reason: "The requested run config is not in the Helix run registry.",
    next: "Use /helix-run with no argument to see the default config, or inspect /helix-chains.",
  },
  "missing-run-id": {
    reason: "This verb needs a structural run id.",
    next: "Run /helix-runs and copy a listed run id.",
  },
  "unsafe-run-id": {
    reason: "The run id is not a safe structural record token.",
    next: "Use an exact run id from /helix-runs; path traversal and root-resolving ids are refused.",
  },
  "run-not-found": {
    reason: "No structural run record matched that run id.",
    next: "Run /helix-runs and choose an existing run id.",
  },
  "helix-settings-unreadable": {
    reason: "The user-local settings file exists but cannot be read or parsed.",
    next: "Fix or delete the Helix settings.json under Pi's agent directory (absent = all toggles on).",
  },
  "research-requires-attended": {
    reason: "Research is attended-only by owner decision.",
    next: "Run /helix-research from an interactive TUI session and stay at the terminal.",
  },
  "toggle-disabled:autoresearch": {
    reason: "The autoresearch toggle is off - invoking the verb is an explicit conflict.",
    next: "Run /helix-settings and enable Autoresearch, then retry.",
  },
  "toggle-disabled:multi-model": {
    reason: "A composite cast needs the multi-model toggle.",
    next: "Run /helix-settings and enable Multi-model, or assign a plain provider/model instead.",
  },
  "helix-prune-requires-tui-confirm": {
    reason: "Prune requires an attended TUI confirmation.",
    next: "Open Pi in TUI mode and retry, or leave the record in place.",
  },
  "helix-mutation-requires-tui-confirm": {
    reason: "This state mutation requires an attended TUI confirmation.",
    next: "Open Pi in TUI mode, retry the mutation, and confirm the prompt.",
  },
  "helix-mutation-cancelled": {
    reason: "The attended mutation was not confirmed.",
    next: "Retry and confirm only if the displayed mutation is intended.",
  },
  "live-adapter-not-wired": {
    reason: "This real cast was started outside the Pi-native configured-provider adapter.",
    next: "Start it with /helix-run in an attended Pi TUI, or use the standalone mock config for local proof.",
  },
  "helix-model-inventory-unavailable": {
    reason: "Pi's available-model inventory was unavailable, so Helix cannot validate a real member.",
    next: "Retry from an attended Pi TUI after provider login, or use a mock member.",
  },
  "preset-member-unavailable": {
    reason: "A requested provider/model is not in Pi's currently available inventory.",
    next: "Log in to that provider or choose an exact model shown by /helix-setup.",
  },
  "pi-effort-capability-unavailable": {
    reason: "Pi did not expose enough model capability metadata to prove an explicit effort before launch.",
    next: "Refresh Pi's model inventory or choose default/provider-managed effort, then retry.",
  },
  "pi-effort-unsupported": {
    reason: "At least one resolved model does not support its requested explicit effort.",
    next: "Inspect the exact cast and choose an effort supported by that model, then retry.",
  },
  "helix-runner-result-invalid": {
    reason: "The packaged runner returned an incomplete or unsafe structural result.",
    next: "Inspect the run with /helix-runs; Helix did not render raw runner output.",
  },
  "unknown-workflow": {
    reason: "The requested named workflow does not exist.",
    next: "Run /helix-workflows, or create one with /helix-workflow-create.",
  },
  "invalid-workflow": {
    reason: "The workflow does not satisfy the bounded workflow schema.",
    next: "Inspect /helix-workflows show <id>, then fix the named stage or transition.",
  },
  "workflow-resume-unsupported": {
    reason: "This run is bound to an exact in-memory workflow task, but task-aware in-process resume is not shipped yet.",
    next: "Inspect the interrupted run, then start a fresh attended run with the same workflow and task.",
  },
  "workflow-host-effects-unavailable": {
    reason: "This workflow needs typed host effects that the Pi workflow runner does not provide.",
    next: "Inspect /helix-workflows show <id>; use a runnable workflow until those effects are wired.",
  },
  "objective-gate-command-unavailable": {
    reason: "The workflow's objective-check executable is not available in this repository environment.",
    next: "Install the checker or edit the workflow to use an available argv-style command.",
  },
});

class HelixConfigLoadError extends Error {
  constructor(rel) {
    super("helix-config-unreadable");
    this.code = "helix-config-unreadable";
    const name = basename(rel);
    this.detail = SAFE_BASENAME_PATTERN.test(name) ? name : null;
  }
}

function readJson(root, rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), "utf8"));
  } catch {
    throw new HelixConfigLoadError(rel);
  }
}

function dependencies(options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const stateRoot = options.stateRoot ?? defaultHelixStateRoot();
  const load = (key, rel) => options[key] ?? readJson(root, rel);
  return {
    root,
    stateRoot,
    runRegistry: load("runRegistry", "dispatch/config/run-configs.json"),
    chainRegistry: load("chainRegistry", "dispatch/config/chains.json"),
    roleMatrix: load("roleMatrix", "dispatch/config/role-matrix-defaults.json"),
    agentTeam: load("agentTeam", "dispatch/config/agent-team-defaults.json"),
    packageJson: load("packageJson", "package.json"),
    runsRoot: options.runsRoot ?? join(stateRoot, "runs"),
    settingsPath: options.settingsPath ?? join(stateRoot, DEFAULT_SETTINGS_REL_PATH),
    matricesDir: options.matricesDir ?? join(root, "dispatch", "config", "matrices"),
    cwd: options.cwd ?? process.cwd(),
    modelInventory: Array.isArray(options.modelInventory) ? options.modelInventory : null,
    toggles: options.toggles ?? null,
  };
}

function loadUserSettings(deps) {
  return loadSettings(deps.settingsPath);
}

function loadPresets(deps) {
  return loadPresetRegistry(deps.matricesDir);
}

function splitArgs(args) {
  if (typeof args !== "string") return [];
  return args.trim().split(/\s+/).filter(Boolean);
}

function result({ ok = true, status = "ok", code = null, title, lines, details = {}, mutating = false }) {
  const out = {
    ok,
    status,
    code,
    title,
    text: lines.join("\n"),
    details: { ...details, mutating },
  };
  try {
    assertPublicSafe(out);
    return out;
  } catch {
    return {
      ok: false,
      status: "fail-closed",
      code: "helix-render-public-safety-refusal",
      title: "Helix command refused",
      text: "Helix refusal: helix-render-public-safety-refusal\nReason: rendered output did not pass the public-safety boundary.\nNext safe action: inspect the structural source file without rendering it through /helix.",
      details: { code: "helix-render-public-safety-refusal", mutating: false },
    };
  }
}

function publicCode(value, fallback = "helix-input-invalid") {
  if (!isPublicCode(value)) return fallback;
  try {
    assertPublicSafe({ value });
    return value;
  } catch {
    return fallback;
  }
}

function publicDetail(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]*$/.test(value)) {
    try {
      assertPublicSafe({ value });
      return value;
    } catch {
      // Fall through to a content hash.
    }
  }
  return hashRef(typeof value === "string" ? value : JSON.stringify(value));
}

function fail(code, detail, title = "Helix command refused") {
  const renderedCode = publicCode(code);
  const renderedDetail = publicDetail(detail);
  const guidance = REFUSAL_GUIDANCE[renderedCode] ?? {
    reason: "Helix refused before doing unsafe or unsupported work.",
    next: "Run /helix-help, then retry with a supported command.",
  };
  return result({
    ok: false,
    status: "fail-closed",
    code: renderedCode,
    title,
    lines: [
      `Helix refusal: ${renderedCode}`,
      `Reason: ${guidance.reason}`,
      `Next safe action: ${guidance.next}`,
      renderedDetail ? `Detail: ${renderedDetail}` : "Detail: none",
      "",
      HELIX_USAGE,
    ],
    details: { code: renderedCode, detail: renderedDetail, reason: guidance.reason, next_safe_action: guidance.next },
  });
}

function configLoadFail(error) {
  if (error?.code === "helix-config-unreadable") {
    return fail("helix-config-unreadable", error.detail, "Helix config unreadable");
  }
  return fail("helix-config-unreadable", null, "Helix config unreadable");
}

function usage(verb = null) {
  const renderedVerb = verb ? publicDetail(verb) : null;
  return result({
    ok: false,
    status: "usage",
    code: "helix-usage",
    title: "Helix usage",
    lines: [
      renderedVerb ? `Unknown or incomplete /helix verb: ${renderedVerb}` : "Helix command usage",
      "",
      HELIX_USAGE,
    ],
    details: { verb: renderedVerb },
  });
}

function renderHelp() {
  return result({
    title: "Helix help",
    lines: [
      "Helix help",
      "Mode: view-only",
      "Install: follow the package command in README.md, then restart Pi.",
      "Start: first configure or sync providers in Pi; Helix uses Pi's available inventory and does not select providers.",
      "Tour: /helix-onboarding reruns the keyboard-first getting-started guide.",
      "Dashboard: /helix shows status; /helix-settings opens the interactive feature list.",
      "Run: /helix-run [workflow-id] shows the cast, rails, repository, and task, then starts after confirmation.",
      "Build: /helix-workflow-create starts from a template; /helix-workflow-edit, -clone, and -delete manage personal workflows.",
      "Runs: /helix-runs, /helix-run-status, /helix-run-watch, /helix-run-resume, /helix-run-prune.",
      "Views: /helix-models, /helix-chains, /helix-profiles.",
      "Casts: /helix-setup saves stage assignments and composite member lineups from Pi's available-model inventory.",
      "Research: /helix-research validates the mandatory metric and stop condition, then prints the packaged research invocation.",
      "Attendance: run launch and profile/setup/prune changes are confirmed; settings toggles save immediately because they are reversible.",
      "Providers: configure/login in Pi first. Helix consumes the exact available provider/model ids and never owns credentials.",
      "Refusals: every refusal shows a stable code, reason, and next safe action.",
      "Manual: docs/manual.md.",
    ],
    details: {
      view_only: true,
      public_safe: true,
      launches_loop: false,
      live_calls: false,
      provider_calls: false,
      manual: "docs/manual.md",
    },
  });
}

function summarizeMatrix(matrix) {
  const roles = matrix?.roles ?? {};
  return Object.fromEntries(Object.entries(roles).map(([role, entries]) => [
    role,
    {
      entries: entries.length,
      instances: entries.reduce((sum, entry) => sum + entry.instances, 0),
      providers: [...new Set(entries.map((entry) => entry.provider))],
      models: entries.map((entry) => ({
        provider: entry.provider,
        model: entry.model,
        effort: entry.effort,
        instances: entry.instances,
      })),
    },
  ]));
}

function summarizeChain(chain) {
  const route = routeForClass(chain.task_class);
  const loopRunnable = Boolean(route?.roles.includes("builder"));
  return {
    id: chain.id,
    description_ref: hashRef(chain.description),
    task_class: chain.task_class,
    route_id: route?.id ?? null,
    loop_runnable: loopRunnable,
    loop_status: loopRunnable ? "loop-runnable" : `chain-not-loop-runnable:${chain.id}`,
    requires_objective_gate: chain.requires_objective_gate,
    default_max_iterations: chain.default_max_iterations,
    stages: chain.stages.map((stage) => ({
      id: stage.id,
      steps: stage.steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        role: step.role ?? null,
        note_ref: step.note == null ? null : hashRef(step.note),
      })),
      advance: stage.advance
        ? {
          verdict_role: stage.advance.verdict_role,
          max_passes: stage.advance.max_passes,
          allow_jump_to: stage.advance.allow_jump_to ?? null,
        }
        : null,
      gate_expectation: stage.gate_expectation ?? null,
      max_passes: stage.max_passes ?? stage.advance?.max_passes ?? 1,
      transitions: (stage.transitions ?? []).map((transition) => ({
        when: { ...transition.when },
        action: transition.action,
        target: transition.target ?? null,
        reason: transition.reason ?? null,
      })),
      artifact: stage.artifact ? { ...stage.artifact } : null,
    })),
  };
}

function resourceStatus(pkg) {
  const pkgExtensions = Array.isArray(pkg?.pi?.extensions) ? pkg.pi.extensions : [];
  const safeName = (entry) => {
    if (typeof entry === "string") {
      const name = basename(entry);
      if (SAFE_BASENAME_PATTERN.test(name)) {
        try {
          assertPublicSafe({ name });
          return name;
        } catch {
          // Hash below.
        }
      }
    }
    return hashRef(String(entry ?? ""));
  };
  return {
    extensions: pkgExtensions.length,
    package_extensions: pkgExtensions.map(safeName),
    helix_command_pinned: pkgExtensions.includes("./extensions/helix-command.ts"),
  };
}

function structuralObjectiveGate(gate) {
  if (gate.type === "command-exit-zero") {
    return {
      type: gate.type,
      command: gate.command,
      args_ref: hashRef(stableStringify(gate.args)),
      arg_count: gate.args.length,
      timeout_ms: gate.timeout_ms,
    };
  }
  return {
    type: gate.type,
    path: gate.path,
    contains_ref: hashRef(gate.contains),
  };
}

function structuralPreset(preset) {
  return {
    preset_id: preset.preset_id,
    degradation: preset.degradation,
    roles: Object.fromEntries(Object.entries(preset.roles).map(([role, members]) => [
      role,
      members.map((member) => ({
        provider: member.provider,
        model: member.model,
        effort: member.effort,
        instances: member.instances,
        effort_vocab: [...member.effort_vocab],
      })),
    ])),
  };
}

/** Providers named by a resolved staged cast (the SIGNAL the runner acts on) —
 * includes panel_roles judge/synthesizer, matching the runner's live guard. */
function castProviders(cast) {
  return allCastProviders(cast);
}

function castLiveStatus(cast) {
  const providers = castProviders(cast);
  const allMock = providers.length > 0 && providers.every((p) => p === "mock");
  return allMock ? "no-live (mock providers only)" : "live via Pi configured providers";
}

function structuralCastMember(member) {
  return {
    provider: member.provider,
    model: member.model,
    effort: member.effort,
    instances: member.instances,
  };
}

function structuralCast(cast) {
  return cast.map((stage) => ({
    stage_id: stage.stage_id,
    executor_ref: stage.executor_ref,
    roles: Object.fromEntries(Object.entries(stage.roles ?? {}).map(([role, members]) => [
      role,
      members.map(structuralCastMember),
    ])),
    panel_roles: Object.fromEntries(Object.entries(stage.panel_roles ?? {}).map(([role, member]) => [
      role,
      structuralCastMember(member),
    ])),
  }));
}

function structuralCastLines(cast) {
  return structuralCast(cast).flatMap((stage) => {
    const lines = [`  ${stage.stage_id} [${stage.executor_ref}]`];
    for (const [role, members] of Object.entries(stage.roles)) {
      for (const member of members) {
        lines.push(`    ${role}: ${member.provider}/${member.model}:${member.effort} x${member.instances}`);
      }
    }
    for (const [role, member] of Object.entries(stage.panel_roles)) {
      lines.push(`    ${role} (panel): ${member.provider}/${member.model}:${member.effort} x${member.instances}`);
    }
    return lines;
  });
}

function castMembers(cast) {
  return cast.flatMap((stage) => [
    ...Object.values(stage.roles ?? {}).flat(),
    ...Object.values(stage.panel_roles ?? {}),
  ]);
}

function inventoryAvailability(deps) {
  if (!Array.isArray(deps.modelInventory)) return null;
  const available = new Set(deps.modelInventory
    .filter((model) => model && typeof model.provider === "string" && typeof model.model === "string")
    .map((model) => `${model.provider}/${model.model}`));
  return (member) => member?.provider === "mock" || available.has(`${member?.provider}/${member?.model}`);
}

function publicModelInventory(deps) {
  if (!Array.isArray(deps.modelInventory)) return null;
  return deps.modelInventory.filter((model) => {
    if (!model || !isPublicCode(model.provider) || !isModelId(model.model)) return false;
    try {
      assertPublicSafe(model);
      return true;
    } catch {
      return false;
    }
  }).map((model) => {
    const supportedEfforts = Array.isArray(model.supported_efforts)
      ? [...new Set(model.supported_efforts.filter((effort) => EFFORTS.includes(effort)))]
      : null;
    return {
      provider: model.provider,
      model: model.model,
      reasoning: model.reasoning === true,
      ...(supportedEfforts === null ? {} : { supported_efforts: supportedEfforts }),
    };
  });
}

function preflightCastEfforts(cast, deps) {
  const realMembers = castMembers(cast).filter((member) => member.provider !== "mock");
  if (realMembers.length === 0) return { ok: true };
  const inventory = publicModelInventory(deps);
  if (inventory === null) return { ok: false, code: "helix-model-inventory-unavailable", detail: "resolved-cast" };
  const byIdentity = new Map(inventory.map((model) => [`${model.provider}/${model.model}`, model]));
  for (const member of realMembers) {
    if (member.effort === "default" || member.effort === "provider-managed") continue;
    const identity = `${member.provider}/${member.model}`;
    const available = byIdentity.get(identity);
    if (!available) return { ok: false, code: "preset-member-unavailable", detail: identity };
    if (!Array.isArray(available.supported_efforts)) {
      return { ok: false, code: PI_EFFORT_CODES.CAPABILITY_UNAVAILABLE, detail: `${identity}:${member.effort}` };
    }
    if (!available.supported_efforts.includes(member.effort)) {
      return { ok: false, code: PI_EFFORT_CODES.UNSUPPORTED, detail: `${identity}:${member.effort}` };
    }
  }
  return { ok: true };
}

function workflowBindingChildren(workflow, deps) {
  if (workflow?.schema_version !== 4) return { ok: true, definitions: [] };
  const definitions = [];
  const seen = new Set();
  for (const node of Object.values(workflow.nodes)) {
    if (node.kind !== "subworkflow") continue;
    const key = `${node.workflow_id}@${node.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = resolveWorkflow(deps.stateRoot, node.workflow_id, deps.chainRegistry, deps.runRegistry);
    if (!resolved.ok) return { ok: false, code: resolved.code, detail: node.workflow_id };
    const normalized = normalizeWorkflowDefinition(resolved.workflow);
    if (!normalized.ok || normalized.definition.version !== node.version
      || Object.values(normalized.definition.nodes).some((child) => child.kind === "subworkflow")) {
      return { ok: false, code: "kernel-subworkflow-binding-invalid", detail: node.workflow_id };
    }
    definitions.push(normalized.definition);
  }
  return { ok: true, definitions };
}

function buildPreflight(configId, deps) {
  let resolved = resolveRunConfig(deps.runRegistry, configId);
  let workflow = null;
  let workflowChain = null;
  if (!resolved.ok && resolved.code !== "unknown-run-config") return resolved;
  if (resolved.ok) {
    workflow = builtInWorkflows(deps.chainRegistry, deps.runRegistry)
      .find((candidate) => candidate.id === configId) ?? null;
    if (workflow) {
      const execution = workflowToExecution(workflow);
      if (!execution.ok) return { ok: false, code: execution.code, detail: execution.detail };
      workflowChain = execution.chain;
      resolved = { ok: true, config: execution.config };
    }
  } else {
    const named = resolveWorkflow(deps.stateRoot, configId, deps.chainRegistry, deps.runRegistry);
    if (!named.ok) return resolved;
    const execution = workflowToExecution(named.workflow);
    if (!execution.ok) return { ok: false, code: execution.code, detail: execution.detail };
    workflow = named.workflow;
    workflowChain = execution.chain;
    resolved = { ok: true, config: execution.config };
  }

  // The ACTIVE profile's saved cast overlays the tracked config (assignments and
  // default assignment only - never chain/gate/run_target, by schema).
  let config = resolved.config;
  let profileApplied = null;
  const warnings = [];
  const active = resolveActiveProfile(deps.stateRoot);
  if (!active.ok) return { ok: false, code: active.code, detail: active.detail };
  if (active.profile) {
    const applied = applyProfileToConfig(config, active.profile, workflowChain ? {
      stageIds: workflowChain.stages.map((stage) => stage.id),
    } : {});
    config = applied.config;
    if (applied.overridden.length) profileApplied = { profile_id: active.profile_id, overridden: [...applied.overridden] };
    if (applied.ignored_assignments.length > 0) {
      warnings.push(`profile-stage-overrides-ignored:${applied.ignored_assignments.join("+")}`);
    }
  }

  // Preflight mirrors the STAGED runner (the engine that actually executes),
  // not the legacy task-loop: resolve the chain and the per-stage cast so the
  // Live signal, providers, and staged-runnability reflect what will run.
  const chainResult = workflowChain
    ? { ok: true, chain: workflowChain }
    : resolveChain(deps.chainRegistry, config.chain);
  if (!chainResult.ok) return { ok: false, code: chainResult.code, detail: chainResult.detail, config, profile_applied: profileApplied };
  const chain = chainResult.chain;
  const hostEffects = workflowRequiredHostEffects(workflow ?? { stages: chain.stages });
  if (hostEffects.length > 0) {
    return {
      ok: false, code: "workflow-host-effects-unavailable", detail: hostEffects.join("+"),
      config, chain, profile_applied: profileApplied,
    };
  }
  const presetsResult = loadPresets(deps);
  if (!presetsResult.ok) return { ok: false, code: presetsResult.code, detail: presetsResult.detail, config, profile_applied: profileApplied };
  const profiledPresets = applyProfileToPresets(presetsResult.presets, active.profile);
  if (!profiledPresets.ok) return { ok: false, code: profiledPresets.code, detail: profiledPresets.detail, config, profile_applied: profileApplied };
  if (profiledPresets.overridden.length) {
    profileApplied = profileApplied ?? { profile_id: active.profile_id, overridden: [] };
    profileApplied.overridden.push("presets");
  }
  const loadedSettings = loadUserSettings(deps);
  if (!loadedSettings.ok) return { ok: false, code: loadedSettings.code, detail: loadedSettings.detail, config, profile_applied: profileApplied };
  const effectiveToggles = deps.toggles ?? loadedSettings.settings.toggles;
  const castResult = resolveChainCast({
    chain,
    assignments: config.assignments ?? {},
    defaults: config.default_assignment ?? null,
    presets: profiledPresets.presets,
    toggles: effectiveToggles,
    availability: inventoryAvailability(deps),
  });
  if (!castResult.ok) return { ok: false, code: castResult.code, detail: castResult.detail, config, profile_applied: profileApplied };
  const effortPreflight = preflightCastEfforts(castResult.cast, deps);
  if (!effortPreflight.ok) {
    return {
      ...effortPreflight,
      config,
      chain,
      profile_applied: profileApplied,
    };
  }

  const providers = castProviders(castResult.cast);
  const gatePreflight = preflightObjectiveGate(deps.cwd, config.objective_gate);
  if (!gatePreflight.ok) {
    return { ok: false, code: gatePreflight.code, detail: config.objective_gate.type, config, chain, profile_applied: profileApplied };
  }
  const bindingChildren = workflow ? workflowBindingChildren(workflow, deps) : { ok: true, definitions: [] };
  if (!bindingChildren.ok) return bindingChildren;
  const executionBindingRef = workflow
    ? workflowExecutionBindingRef({
      workflow,
      profile: active.profile,
      toggles: effectiveToggles,
      presets: profiledPresets.presets,
      subworkflows: bindingChildren.definitions,
    })
    : null;
  if (workflow && !executionBindingRef) {
    return { ok: false, code: "workflow-execution-binding-failed", detail: "confirmed-sources-invalid" };
  }

  return {
    ok: true,
    config,
    chain,
    cast: castResult.cast,
    cast_providers: providers,
    live_status: castLiveStatus(castResult.cast),
    warnings,
    profile_applied: profileApplied,
    workflow,
    execution_binding_ref: executionBindingRef,
    runtime_limits: workflow
      ? workflow.schema_version === 4
        ? { max_runtime_ms: workflow.limits.max_run_ms, call_timeout_ms: workflow.limits.max_call_ms }
        : { max_runtime_ms: workflow.stop.max_runtime_ms, call_timeout_ms: workflow.deployment.call_timeout_ms }
      : { max_runtime_ms: 10 * 60 * 1000, call_timeout_ms: 2 * 60 * 1000 },
    toggles: effectiveToggles,
  };
}

function renderPreflight(preflight, requestedId) {
  if (!preflight.ok) {
    return fail(preflight.code, preflight.detail, "Helix run preflight refused");
  }
  const { config, chain, cast, warnings } = preflight;
  const stageCast = cast.map((c) => `${c.stage_id}=${c.executor_ref}`).join(" ");
  const exactCast = structuralCast(cast);
  return result({
    title: "Helix run preflight",
    lines: [
      `Config: ${config.id}`,
      `Chain: ${chain.id} (${chain.task_class}, ${chain.stages.length} stage(s))`,
      `Cast source: ${preflight.profile_applied ? `profile ${preflight.profile_applied.profile_id} (${preflight.profile_applied.overridden.join("+")})` : "tracked config"}`,
      `Cast: ${stageCast}`,
      "Exact cast:",
      ...structuralCastLines(cast),
      `Assignments: ${config.assignments && Object.keys(config.assignments).length ? Object.entries(config.assignments).map(([stage, a]) => `${stage}=${assignmentLabel(a)}`).join(" ") : "(defaults)"}`,
      `Providers: ${preflight.cast_providers.join(", ")}`,
      `Live: ${preflight.live_status}`,
      `Objective gate: ${config.objective_gate.type === "command-exit-zero"
        ? `${config.objective_gate.command} (${config.objective_gate.args.length} argument(s))`
        : `${config.objective_gate.type}:${config.objective_gate.path}`}`,
      `Rail: max_iterations=${config.max_iterations}`,
      `Runtime: ${preflight.runtime_limits.max_runtime_ms}ms total; ${preflight.runtime_limits.call_timeout_ms}ms per provider call`,
      config.parallel
        ? `Parallel: max_concurrency=${config.parallel.max_concurrency}`
        : "Parallel: none",
      `Warnings: ${warnings.length ? warnings.join(", ") : "none"}`,
      "",
      "In Pi's TUI, confirm this preflight and the exact task to start the workflow.",
    ],
    details: {
      requested_config_id: requestedId,
      config_id: config.id,
      chain: summarizeChain(chain),
      cast: exactCast,
      providers: preflight.cast_providers,
      objective_gate: structuralObjectiveGate(config.objective_gate),
      rail: {
        max_iterations: config.max_iterations,
        parallel: config.parallel ? { ...config.parallel } : null,
      },
      runtime_limits: { ...preflight.runtime_limits },
      execution_binding_ref: preflight.execution_binding_ref,
      require_live_certification: preflight.workflow?.schema_version === 4
        && preflight.workflow.provider_policy.require_live_certification === true,
      live_status: preflight.live_status,
      warnings,
      worktree_enabled: preflight.toggles.worktree !== false,
      launches_loop: false,
    },
  });
}

export function renderHelixRunCompletion({ runId, configId, exitCode, converged = false, stopReason = null, failureCode = null }) {
  if (!validateRunId(runId).ok
    || !isPublicCode(configId)
    || !Number.isSafeInteger(exitCode)
    || exitCode < 0
    || exitCode > 255
    || typeof converged !== "boolean"
    || (failureCode != null && !isPublicCode(failureCode))
    || (exitCode === 0 && !isPublicCode(stopReason))) {
    return fail("helix-runner-result-invalid", null, "Helix run result refused");
  }
  const safeStopReason = isPublicCode(stopReason) ? stopReason : "unknown";
  if (exitCode !== 0) {
    const safeFailure = failureCode ?? "helix-runner-failed";
    return result({
      ok: false,
      status: "fail-closed",
      code: safeFailure,
      title: "Helix run failed",
      lines: [
        `Helix refusal: ${safeFailure}`,
        "Reason: workflow execution stopped at a stable fail-closed boundary.",
        `Run: ${runId}`,
        `Next safe action: inspect /helix-run-watch ${runId}; no raw runner output was rendered.`,
      ],
      details: { run_id: runId, config_id: configId, exit_code: exitCode, converged: false, stop_reason: safeStopReason },
    });
  }
  return result({
    title: "Helix run complete",
    lines: [
      `Run: ${runId}`,
      `Config: ${configId}`,
      `Result: ${converged ? "converged" : "complete"} (${safeStopReason})`,
      `Inspect: /helix-run-status ${runId}`,
      `Visual flow: /helix-run-watch ${runId}`,
    ],
    details: { run_id: runId, config_id: configId, exit_code: exitCode, converged, stop_reason: safeStopReason },
  });
}

export function renderWorkflowRuntimeTest({ workflowId, outcome }) {
  if (!isPublicCode(workflowId) || !outcome || typeof outcome !== "object") {
    return fail("workflow-runtime-smoke-invalid", null, "Helix workflow runtime test failed");
  }
  if (outcome.ok !== true) {
    return fail(isPublicCode(outcome.code) ? outcome.code : "workflow-runtime-smoke-failed", workflowId,
      "Helix workflow runtime test failed");
  }
  if (outcome.runner !== "workflow-kernel-v4"
    || outcome.provider_calls !== 0
    || outcome.objective_check !== "simulated"
    || !Number.isSafeInteger(outcome.nodes_exercised)
    || outcome.nodes_exercised < 1
    || !Number.isSafeInteger(outcome.effects_exercised)
    || outcome.effects_exercised < 0
    || !Number.isSafeInteger(outcome.transitions_exercised)
    || outcome.transitions_exercised < 1
    || outcome.objective_gate_exercised !== true) {
    return fail("workflow-runtime-smoke-invalid", workflowId, "Helix workflow runtime test failed");
  }
  return result({
    title: "Helix workflow runtime test passed",
    lines: [
      `Workflow: ${workflowId}`,
      "Runner: real Workflow Kernel v4 execution in a temporary detached Git worktree",
      "Providers: 0 calls (deterministic agent boundary)",
      "Objective check: simulated; this proves kernel routing, not the task-specific objective",
      `Nodes exercised: ${outcome.nodes_exercised}`,
      `Agent effects exercised: ${outcome.effects_exercised}`,
      `Transitions exercised: ${outcome.transitions_exercised}`,
      "Final objective-gate route: exercised",
      "Cleanup: temporary worktree removed",
    ],
    details: {
      workflow_id: workflowId,
      runtime_tested: true,
      runner: outcome.runner,
      provider_calls: outcome.provider_calls,
      objective_check_simulated: true,
      nodes_exercised: outcome.nodes_exercised,
      effects_exercised: outcome.effects_exercised,
      transitions_exercised: outcome.transitions_exercised,
      objective_gate_exercised: true,
      cleanup: "complete",
      view_only: true,
    },
  });
}

function resolveDefaultConfigId(deps) {
  const active = resolveActiveProfile(deps.stateRoot);
  if (!active.ok) return active;
  const configId = active.profile?.overrides?.default_run_config ?? deps.runRegistry?.configs?.[0]?.id;
  if (typeof configId !== "string") return { ok: false, code: "missing-default-run-config", detail: null };
  const resolved = resolveRunConfig(deps.runRegistry, configId);
  if (!resolved.ok) return resolved;
  return { ok: true, config_id: configId, active };
}

function renderDashboard(deps) {
  const selected = resolveDefaultConfigId(deps);
  if (!selected.ok) return fail(selected.code, selected.detail, "Helix dashboard refused");
  const defaultConfig = deps.runRegistry?.configs?.find((config) => config?.id === selected.config_id);
  if (!defaultConfig) return fail("unknown-run-config", "profile-default-config", "Helix dashboard refused");
  const preflight = buildPreflight(defaultConfig.id, deps);
  const runs = listRuns(deps.runsRoot);
  const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;
  const userSettings = loadUserSettings(deps);
  const active = selected.active;
  const lines = [
    "Helix control surface",
    `Active/default config: ${defaultConfig.id}`,
    `Description ref: ${hashRef(defaultConfig.description)}`,
    userSettings.ok
      ? `Toggles: ${HELIX_TOGGLES.filter((t) => userSettings.settings.toggles[t]).join(", ") || "(all off)"}${HELIX_TOGGLES.some((t) => !userSettings.settings.toggles[t]) ? ` | off: ${HELIX_TOGGLES.filter((t) => !userSettings.settings.toggles[t]).join(", ")}` : ""}`
      : `Toggles: unreadable (${userSettings.code})`,
    `Profile: ${active.profile_id ?? "(none)"}`,
  ];

  if (preflight.ok) {
    lines.push(
      `Live: ${preflight.live_status}`,
      `Chain: ${preflight.chain.id} (${preflight.chain.task_class})`,
      `Cast: ${preflight.cast.map((c) => `${c.stage_id}=${c.executor_ref}`).join(" ")}`,
      `Rail: max_iterations=${preflight.config.max_iterations}`,
      `Warnings/refusals: ${preflight.warnings.length ? preflight.warnings.join(", ") : "none"}`,
    );
  } else {
    lines.push(`Warnings/refusals: ${preflight.code}${preflight.detail ? ` (${preflight.detail})` : ""}`);
  }

  lines.push(
    lastRun ? `Last run: ${lastRun.run_id} ${lastRun.status}` : "Last run: none",
    `Package/resources: extensions=${resourceStatus(deps.packageJson).extensions}`,
  );

  return result({
    title: "Helix dashboard",
    lines,
    details: {
      default_config_id: defaultConfig.id,
      live_status: preflight.ok ? preflight.live_status : null,
      preflight: preflight.ok
        ? {
          ok: true,
          chain: summarizeChain(preflight.chain),
          cast: preflight.cast.map((c) => ({ stage_id: c.stage_id, executor_ref: c.executor_ref })),
          providers: preflight.cast_providers,
          warnings: preflight.warnings,
        }
        : {
          ok: false,
          code: preflight.code,
          detail: preflight.detail,
        },
      last_run: lastRun,
      resource_status: resourceStatus(deps.packageJson),
    },
  });
}

function renderModels(deps) {
  const matrix = deps.roleMatrix;
  const matrixShape = validateRoleMatrixConfig(matrix);
  if (!matrixShape.valid) return fail("invalid-role-matrix", "role-matrix-defaults", "Helix models refused");
  const presetsResult = loadPresets(deps);
  if (!presetsResult.ok) return fail(presetsResult.code, presetsResult.detail, "Helix models refused");
  const active = resolveActiveProfile(deps.stateRoot);
  if (!active.ok) return fail(active.code, active.detail, "Helix models refused");
  const profiled = applyProfileToPresets(presetsResult.presets, active.profile);
  if (!profiled.ok) return fail(profiled.code, profiled.detail, "Helix models refused");
  const inventory = publicModelInventory(deps);
  const structuralPresets = [...profiled.presets.values()].map(structuralPreset);
  const presetLines = structuralPresets.flatMap((preset) => [
    `${preset.preset_id} (degradation=${preset.degradation}):`,
    ...Object.entries(preset.roles).map(([role, members]) =>
      `  ${role}: ${members.map((m) => `${m.provider}/${m.model}:${m.effort} x${m.instances}`).join(", ")}`),
  ]);
  return result({
    title: "Helix models",
    lines: [
      "Mode: view-only",
      `Composite presets (${active.profile ? `effective profile ${active.profile_id}` : "tracked mock skeletons"}):`,
      ...presetLines,
      "",
      inventory === null ? "Pi available-model inventory: unavailable outside the extension TUI" : `Pi available-model inventory: ${inventory.length}`,
      ...(inventory ?? []).map((model) => `  ${model.provider}/${model.model}${model.reasoning ? " (reasoning)" : ""}`),
      "",
      `Legacy role matrix: ${matrix.matrix_id}`,
      ...Object.entries(summarizeMatrix(matrix)).map(([role, summary]) =>
        `${role}: ${summary.models.map((model) => `${model.provider}/${model.model} effort=${model.effort} instances=${model.instances}`).join(", ")}`),
    ],
    details: {
      view_only: true,
      presets: structuralPresets,
      active_profile: active.profile_id,
      available_models: inventory,
      matrix_id: matrix.matrix_id,
      roles: summarizeMatrix(matrix),
    },
  });
}

function renderChains(deps) {
  const shape = validateChainRegistry(deps.chainRegistry);
  if (!shape.valid) return fail("invalid-chain-registry", "chains.json", "Helix chains refused");
  const chains = deps.chainRegistry.chains.map(summarizeChain);
  return result({
    title: "Helix chains",
    lines: [
      "Mode: view-only",
      ...chains.map((chain) =>
        `${chain.id}: ${chain.task_class}, ${chain.loop_status}, stages=${chain.stages.map((stage) => `${stage.id}(${stage.steps.map((step) => step.id).join(">")})`).join(" -> ")}`),
    ],
    details: {
      view_only: true,
      chains,
    },
  });
}

function workflowLines(workflow) {
  if (workflow.schema_version === 4) {
    const graph = plannedWorkflowGraph(workflow);
    if (!graph.ok) return ["Invalid WorkflowDefinition v4"];
    return graph.nodes.flatMap((node, index) => [
      `${index + 1}. ${node.id} (${node.kind})`,
      `   ${node.targets.length ? `next: ${node.targets.join(" | ")}` : `terminal: ${node.status}`}`,
      ...(node.role ? [`   role: ${node.role}; mutation: ${node.mutation}`] : []),
      ...(node.roles ? [`   roles: ${node.roles.join(" -> ")}`] : []),
    ]);
  }
  return workflow.stages.flatMap((stage, index) => [
    `${index + 1}. ${stage.id} (max ${stage.max_passes} pass${stage.max_passes === 1 ? "" : "es"})`,
    `   roles: ${stage.steps.filter((step) => step.kind === "role").map((step) => step.role).join(" -> ") || "none"}`,
    `   output: ${stage.artifact ? `${stage.artifact.path} (${stage.artifact.kind})` : "not declared (legacy built-in stage)"}`,
    ...stage.transitions.map((transition) => {
      const condition = transition.when.type === "always"
        ? "always"
        : transition.when.type === "gate"
          ? `gate is ${transition.when.is}`
          : `${transition.when.role} says ${transition.when.is}`;
      return `   ${condition} -> ${transition.action}${transition.target ? ` ${transition.target}` : ""}`;
    }),
  ]);
}

function workflowGraphLines(workflow, events = []) {
  if (workflow.schema_version === 4) {
    const graph = observedWorkflowGraph(workflow, events);
    if (!graph.ok) return ["Flow: invalid WorkflowDefinition v4"];
    return ["Flow:", ...graph.nodes.map((node) => {
      const marker = node.status === "running" ? "●" : node.status === "pending" ? "○" : node.status === "ok" || node.status === "succeeded" ? "✓" : "!";
      const visits = node.visits > 0 ? ` · ${node.visits} visit${node.visits === 1 ? "" : "s"}` : "";
      const targets = node.targets.length ? ` -> ${node.targets.join(" | ")}` : ` [${node.status}]`;
      return `  ${marker} ${node.id} (${node.kind})${visits}${targets}`;
    })];
  }
  const passCounts = Object.fromEntries(workflow.stages.map((stage) => [stage.id, 0]));
  const completed = new Set();
  let current = null;
  for (const event of events) {
    if (event.kind === "pass-start" && Object.hasOwn(passCounts, event.stage_id)) {
      passCounts[event.stage_id] = Math.max(passCounts[event.stage_id], event.pass);
      current = event.stage_id;
    }
    if (event.kind === "stage-end") completed.add(event.stage_id);
    if (event.kind === "run-end") current = null;
  }
  return ["Flow:", ...workflow.stages.flatMap((stage, index) => {
    const marker = current === stage.id ? "●" : completed.has(stage.id) ? "✓" : "○";
    const count = passCounts[stage.id] > 0 ? ` · ${passCounts[stage.id]} pass${passCounts[stage.id] === 1 ? "" : "es"}` : "";
    const next = workflow.stages[index + 1]?.id ?? "complete";
    return [
      `  ${marker} ${stage.id}${count}`,
      ...stage.transitions.map((transition) => {
        const condition = transition.when.type === "always"
          ? "always"
          : transition.when.type === "gate"
            ? `gate=${transition.when.is}`
            : `${transition.when.role}=${transition.when.is}`;
        const target = transition.action === "advance" ? next
          : transition.action === "retry" ? stage.id
            : transition.target ?? transition.reason;
        const glyph = transition.action === "back" ? "↩" : transition.action === "retry" ? "↻" : "→";
        return `      ${condition} ${glyph} ${target}`;
      }),
    ];
  })];
}

function structuralWorkflow(workflow) {
  const requiredHostEffects = workflowRequiredHostEffects(workflow);
  if (workflow.schema_version === 4) {
    const graph = plannedWorkflowGraph(workflow);
    return {
      schema_version: 4,
      id: workflow.id,
      name: workflow.name,
      source: workflow.source,
      version: workflow.version,
      description_ref: hashRef(workflow.description),
      runnable: requiredHostEffects.length === 0,
      required_host_effects: requiredHostEffects,
      start: workflow.start,
      limits: structuredClone(workflow.limits),
      provider_policy: {
        exact: workflow.provider_policy.exact,
        require_live_certification: workflow.provider_policy.require_live_certification,
      },
      graph: graph.ok ? graph.nodes : [],
    };
  }
  return {
    id: workflow.id,
    source: workflow.source,
    description_ref: hashRef(workflow.description),
    task_class: workflow.task_class,
    runnable: requiredHostEffects.length === 0,
    required_host_effects: requiredHostEffects,
    stop: {
      max_iterations: workflow.stop.max_iterations,
      max_runtime_ms: workflow.stop.max_runtime_ms,
      objective_gate: structuralObjectiveGate(workflow.stop.objective_gate),
    },
    deployment: { call_timeout_ms: workflow.deployment.call_timeout_ms },
    stages: workflow.stages.map((stage) => ({
      id: stage.id,
      max_passes: stage.max_passes,
      artifact: stage.artifact ? { ...stage.artifact } : null,
      roles: stage.steps.filter((step) => step.kind === "role").map((step) => step.role),
      transitions: stage.transitions.map((transition) => ({
        when: { ...transition.when },
        action: transition.action,
        target: transition.target ?? null,
        reason: transition.reason ?? null,
      })),
    })),
  };
}

function workflowSummary(workflow) {
  if (workflow.schema_version === 4) {
    const graph = plannedWorkflowGraph(workflow);
    return `${workflow.id} [${workflow.source}] v${workflow.version}: ${graph.ok ? `${graph.nodes.length} nodes from ${graph.start}` : "invalid graph"} · max ${workflow.limits.max_total_effects} effects`;
  }
  return `${workflow.id} [${workflow.source}]: ${workflow.stages.map((stage) => stage.id).join(" -> ")} · max ${workflow.stop.max_iterations}`;
}

function workflowStopLines(workflow) {
  if (workflow.schema_version === 4) {
    return [
      `Stop: objective gate passes or max ${workflow.limits.max_total_effects} effects / ${workflow.limits.max_run_ms}ms`,
      `Provider call timeout: ${workflow.limits.max_call_ms}ms`,
    ];
  }
  return [
    `Stop: objective gate passes, max_iterations=${workflow.stop.max_iterations}, or ${workflow.stop.max_runtime_ms}ms`,
    `Provider call timeout: ${workflow.deployment.call_timeout_ms}ms`,
  ];
}

function renderWorkflows(deps, tokens) {
  const sub = tokens[1] ?? "list";
  if (sub === "import") {
    const relativePath = tokens[2];
    if (tokens.length !== 3 || !isSafeWorkflowPath(relativePath)) return usage(tokens.join(" "));
    let definition;
    try {
      const path = join(deps.cwd, relativePath);
      const entry = lstatSync(path);
      if (entry.isSymbolicLink() || !entry.isFile() || entry.size < 1 || entry.size > 256 * 1024) throw new Error("file");
      definition = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return fail("invalid-workflow-v4", "import-file", "Helix workflow import refused");
    }
    let normalized;
    try {
      normalized = normalizeWorkflowDefinition(definition);
    } catch {
      return fail("invalid-workflow-v4", "import-definition", "Helix workflow import refused");
    }
    if (!normalized.ok || normalized.migrated || normalized.definition.source !== "user") {
      return fail(normalized.code ?? "invalid-workflow-v4", "import-definition", "Helix workflow import refused");
    }
    const tested = testWorkflow(normalized.definition);
    if (!tested.ok) return fail(tested.code, normalized.definition.id, "Helix workflow import refused");
    const gate = preflightObjectiveGate(deps.cwd, normalized.definition.objective_gate);
    if (!gate.ok) return fail(gate.code, normalized.definition.id, "Helix workflow import refused");
    const saved = saveUserWorkflowV4(deps.stateRoot, normalized.definition, {
      builtInIds: builtInWorkflows(deps.chainRegistry, deps.runRegistry).map((workflow) => workflow.id),
    });
    if (!saved.ok) return fail(saved.code, saved.detail, "Helix workflow import refused");
    return result({
      title: "Helix workflow imported",
      lines: [
        `Workflow: ${normalized.definition.id} v${normalized.definition.version}`,
        ...workflowGraphLines(normalized.definition),
        `Definition transitions validated: ${tested.transitions_validated}/${tested.transitions_total}`,
        `Run: /helix-run ${normalized.definition.id}`,
      ],
      details: { workflow: structuralWorkflow(normalized.definition), mutating: true },
      mutating: true,
    });
  }
  if (sub === "create") {
    const id = tokens[2];
    const template = tokens[3] ?? "implement-review";
    const gatePath = tokens[4] ?? "proposal.txt";
    const gateContains = tokens[5] ?? "HELIX_WORKFLOW_PASS";
    const maxIterations = tokens[6] == null ? 6 : Number(tokens[6]);
    if (!id || tokens.length > 7 || !Number.isSafeInteger(maxIterations)) return usage(tokens.join(" "));
    const created = createWorkflowFromTemplate({
      id, template, gate_path: gatePath, gate_contains: gateContains, max_iterations: maxIterations,
    });
    if (!created.ok) return fail(created.code, created.detail, "Helix workflow create refused");
    const builtInIds = builtInWorkflows(deps.chainRegistry, deps.runRegistry).map((workflow) => workflow.id);
    const saved = saveUserWorkflow(deps.stateRoot, created.workflow, { builtInIds });
    if (!saved.ok) return fail(saved.code, saved.detail, "Helix workflow create refused");
    return result({
      title: "Helix workflow created",
      lines: [
        `Workflow: ${id}`,
        `Template: ${template}`,
        ...workflowLines(created.workflow),
        `Stop: objective gate passes, max_iterations=${created.workflow.stop.max_iterations}, or ${created.workflow.stop.max_runtime_ms}ms`,
        "Test: /helix-workflows test " + id,
        "Run: /helix-run " + id,
      ],
      details: { workflow: structuralWorkflow(created.workflow), mutating: true },
      mutating: true,
    });
  }
  const catalog = workflowCatalog(deps.stateRoot, deps.chainRegistry, deps.runRegistry);
  if (!catalog.ok) return fail(catalog.code, catalog.detail, "Helix workflows refused");
  if (sub === "list") {
    return result({
      title: "Helix workflows",
      lines: [
        "Named workflows:",
        ...catalog.workflows.map((workflow) =>
          `  ${workflowSummary(workflow)} · ${workflowRequiredHostEffects(workflow).length ? `requires host effects: ${workflowRequiredHostEffects(workflow).join(", ")}` : "ready to run"}`),
        "",
        "Create: /helix-workflow-create",
        "Manage personal workflows: /helix-workflow-edit · /helix-workflow-clone · /helix-workflow-delete",
        "Inspect: /helix-workflows show <id>",
        "Test definition, deployment, and isolated mock runtime: /helix-workflows test <id>",
      ],
      details: { workflows: catalog.workflows.map(structuralWorkflow), view_only: true },
    });
  }
  const id = tokens[2];
  const resolved = resolveWorkflow(deps.stateRoot, id, deps.chainRegistry, deps.runRegistry);
  if (!resolved.ok) return fail(resolved.code, resolved.detail, "Helix workflows refused");
  if (sub === "show") {
    return result({
      title: "Helix workflow",
      lines: [
        `Workflow: ${resolved.workflow.id} [${resolved.workflow.source}]`,
        ...workflowGraphLines(resolved.workflow),
        "",
        ...workflowLines(resolved.workflow),
        ...workflowStopLines(resolved.workflow),
        workflowRequiredHostEffects(resolved.workflow).length
          ? `Deployability: requires host effects (${workflowRequiredHostEffects(resolved.workflow).join(", ")})`
          : "Deployability: ready to run",
      ],
      details: { workflow: structuralWorkflow(resolved.workflow), view_only: true },
    });
  }
  if (sub === "test") {
    const tested = testWorkflow(resolved.workflow);
    if (!tested.ok) return fail(tested.code, id, "Helix workflow test failed");
    const deployable = buildPreflight(id, deps);
    if (!deployable.ok) return fail(deployable.code, deployable.detail, "Helix workflow deployment check failed");
    if (deployable.cast_providers.some((provider) => provider !== "mock") && !Array.isArray(deps.modelInventory)) {
      return fail("helix-model-inventory-unavailable", id, "Helix workflow deployment check failed");
    }
    const simulated = tested.simulation;
    const nativeV4 = resolved.workflow.schema_version === 4;
    return result({
      title: "Helix workflow checks passed",
      lines: [
        `Workflow: ${id}`,
        "Definition: valid closed schema",
        "Deployment: cast, providers, objective-check executable, and environment resolved",
        "Runtime effects: not executed (run the workflow for task-specific proof)",
        "Provider calls: 0",
        nativeV4
          ? `Transitions structurally validated: ${tested.transitions_validated}/${tested.transitions_total}`
          : `Transitions behavior-tested: ${tested.transitions_tested}/${tested.transitions_total}`,
        nativeV4
          ? `Node ceilings structurally validated: ${tested.ceilings_validated}`
          : `Stage ceilings behavior-tested: ${tested.ceilings_tested}`,
        `Durable outputs declared: ${tested.artifacts_declared}`,
        ...(simulated.trace ?? []).map((entry) => entry.node_id
          ? `${entry.node_id} (${entry.kind})`
          : `${entry.stage_id} pass ${entry.pass} -> ${entry.action}${entry.target ? ` ${entry.target}` : ""}`),
        `Stop: ${simulated.stop_reason}`,
      ],
      details: {
        workflow_id: id,
        provider_calls: 0,
        ...(nativeV4
          ? { transitions_validated: tested.transitions_validated, ceilings_validated: tested.ceilings_validated }
          : { transitions_tested: tested.transitions_tested, ceilings_tested: tested.ceilings_tested }),
        transitions_total: tested.transitions_total,
        artifacts_declared: tested.artifacts_declared,
        definition_tested: true,
        deployment_checked: true,
        runtime_tested: false,
        converged: simulated.converged,
        stop_reason: simulated.stop_reason,
        trace: simulated.trace,
        view_only: true,
      },
    });
  }
  return usage(tokens.join(" "));
}

function renderSettings(deps, tokens) {
  const loaded = loadUserSettings(deps);
  if (!loaded.ok) return fail(loaded.code, loaded.detail, "Helix settings refused");
  if (tokens[1] === "set") {
    const toggle = tokens[2];
    const value = tokens[3];
    if (!HELIX_TOGGLES.includes(toggle)) return fail(`unknown-toggle:${String(toggle)}`, null, "Helix settings refused");
    if (value !== "on" && value !== "off") return usage(tokens.join(" "));
    const next = {
      schema_version: loaded.settings.schema_version,
      toggles: { ...loaded.settings.toggles, [toggle]: value === "on" },
    };
    const saved = saveSettings(next, deps.settingsPath);
    if (!saved.ok) return fail(saved.code, saved.detail, "Helix settings refused");
    return result({
      title: "Helix settings updated",
      lines: [`${toggle} -> ${value}`, "", ...renderToggleLines(next)],
      details: { toggles: toggleVector(next), changed: toggle, mutating: true },
      mutating: true,
    });
  }
  return result({
    title: "Helix settings",
    lines: [
      `Source: ${loaded.source === "file" ? "user-local settings" : "defaults (no settings file)"}`,
      "OFF never errors - features degenerate; only explicit conflicts refuse.",
      ...renderToggleLines(loaded.settings),
      "",
      "Change: /helix-settings <toggle> on|off",
    ],
    details: { toggles: toggleVector(loaded.settings), source: loaded.source },
  });
}

function renderToggleLines(settings) {
  return HELIX_TOGGLES.map((toggle) => `[${settings.toggles[toggle] ? "x" : " "}] ${toggle}`);
}

function renderProfiles(deps, tokens) {
  const sub = tokens[1];
  const id = tokens[2];
  if (sub === "switch") {
    const switched = switchProfile(deps.stateRoot, id);
    if (!switched.ok) return fail(switched.code, switched.detail, "Helix profile switch refused");
    return result({
      title: "Helix profile switched",
      lines: [`Active profile: ${id}`],
      details: { active_profile: id, mutating: true },
      mutating: true,
    });
  }
  if (sub === "create") {
    if (typeof id !== "string" || id.length === 0) return usage(tokens.join(" "));
    const created = saveProfile(deps.stateRoot, { schema_version: 1, profile_id: id, overrides: {} });
    if (!created.ok) return fail(created.code, created.detail, "Helix profile create refused");
    return result({
      title: "Helix profile created",
      lines: [`Created empty profile '${id}'. Assemble its cast with /helix setup ${id} ...`],
      details: { profile_id: id, mutating: true },
      mutating: true,
    });
  }
  if (sub === "show") {
    const loaded = loadProfile(deps.stateRoot, id);
    if (!loaded.ok) return fail(loaded.code, loaded.detail, "Helix profile show refused");
    const overrides = loaded.profile.overrides;
    return result({
      title: "Helix profile",
      lines: [
        `Profile: ${loaded.profile.profile_id}`,
        `Default run config: ${overrides.default_run_config ?? "(tracked default)"}`,
        `Default assignment: ${overrides.default_assignment ? assignmentLabel(overrides.default_assignment) : "(tracked default)"}`,
        "Assignments:",
        ...Object.entries(overrides.assignments ?? {}).map(([stage, a]) => `  ${stage} -> ${assignmentLabel(a)}`),
        `Composite member overlays: ${Object.keys(overrides.presets ?? {}).join(", ") || "(tracked mock skeletons)"}`,
      ],
      details: { profile: loaded.profile },
    });
  }
  const listed = listProfiles(deps.stateRoot);
  if (!listed.ok) return fail(listed.code, listed.detail, "Helix profiles refused");
  const active = resolveActiveProfile(deps.stateRoot);
  if (!active.ok) return fail(active.code, active.detail, "Helix profiles refused");
  return result({
    title: "Helix profiles",
    lines: [
      `Active: ${active.profile_id ?? "(none - tracked defaults)"}`,
      listed.profiles.length ? "Profiles:" : "Profiles: none (create one with /helix-profiles create <id>)",
      ...listed.profiles.map((profile) =>
        `  ${profile.profile_id}${profile.profile_id === active.profile_id ? " (active)" : ""}: ${Object.keys(profile.overrides.assignments ?? {}).length} assignment(s)`),
    ],
    details: { active_profile: active.profile_id, profiles: listed.profiles.map((p) => p.profile_id) },
  });
}

function assignmentLabel(assignment) {
  return assignment.kind === "composite"
    ? `composite:${assignment.preset}`
    : `model:${assignment.provider}/${assignment.model}${assignment.effort ? `:${assignment.effort}` : ""}`;
}

function parseAssignmentToken(token, presets) {
  if (presets.has(token)) return { kind: "composite", preset: token };
  if (token.startsWith("composite:")) return { kind: "composite", preset: token.slice("composite:".length) };
  const model = token.startsWith("model:") ? token.slice("model:".length) : token;
  const slash = model.indexOf("/");
  // A bare token with no provider/model slash reads as an INTENDED preset id,
  // so a typo refuses as unknown-preset:<token>, not as a malformed model.
  if (slash < 1 && !token.startsWith("model:")) return { kind: "composite", preset: token };
  if (slash < 1) return null;
  const provider = model.slice(0, slash);
  let rest = model.slice(slash + 1);
  let effort = null;
  const colon = rest.lastIndexOf(":");
  if (colon > 0 && !rest.slice(colon + 1).includes("/")) {
    const candidate = rest.slice(colon + 1);
    if (["default", "low", "medium", "high", "xhigh", "max", "provider-managed"].includes(candidate)) {
      effort = candidate;
      rest = rest.slice(0, colon);
    }
  }
  return { kind: "model", provider, model: rest, ...(effort ? { effort } : {}) };
}

function parseMemberToken(token) {
  if (typeof token !== "string" || token.length === 0) return null;
  let source = token;
  let instances = 1;
  const star = source.lastIndexOf("*");
  if (star > 0) {
    const count = source.slice(star + 1);
    if (!/^\d+$/.test(count)) return null;
    instances = Number(count);
    source = source.slice(0, star);
  }
  const assignment = parseAssignmentToken(`model:${source}`, new Map());
  if (!assignment || assignment.kind !== "model" || !Number.isSafeInteger(instances) || instances < 1) return null;
  const effort = assignment.effort ?? "default";
  return {
    provider: assignment.provider,
    model: assignment.model,
    effort,
    instances,
    effort_vocab: [effort],
  };
}

function assertSetupMemberAvailable(member, deps) {
  if (member.provider === "mock") return { ok: true };
  const availability = inventoryAvailability(deps);
  if (!availability) return { ok: false, code: "helix-model-inventory-unavailable", detail: member.provider };
  if (!availability(member)) return { ok: false, code: "preset-member-unavailable", detail: `${member.provider}/${member.model}` };
  return { ok: true };
}

function renderSetup(deps, tokens) {
  const chainShape = validateChainRegistry(deps.chainRegistry);
  if (!chainShape.valid) return fail("invalid-chain-registry", "chains.json", "Helix setup refused");
  const presetsResult = loadPresets(deps);
  if (!presetsResult.ok) return fail(presetsResult.code, presetsResult.detail, "Helix setup refused");
  const presets = presetsResult.presets;

  if (tokens.length === 1) {
    const chains = deps.chainRegistry.chains;
    const inventory = publicModelInventory(deps);
    return result({
      title: "Helix setup",
      lines: [
        "Create a profile first, then assemble its cast: /helix-profiles create <id>; /helix-setup <id> <stage>=<executor> ...",
        "Replace composite members: <preset>.<role>=<provider/model[:effort][*instances]>[, ...].",
        "",
        "Presets:",
        ...[...presets.values()].map((preset) =>
          `  ${preset.preset_id}: ${Object.entries(preset.roles).map(([role, members]) => `${role} x${members.length}`).join(", ")}`),
        "",
        "Stages per chain:",
        ...chains.map((chain) => `  ${chain.id}: ${chain.stages.map((stage) => stage.id).join(", ")}`),
        "",
        inventory === null ? "Pi available-model inventory: unavailable outside the extension TUI" : `Pi available-model inventory: ${inventory.length}`,
        ...(inventory ?? []).map((model) => `  ${model.provider}/${model.model}${model.reasoning ? " (reasoning)" : ""}`),
        "Real-provider casts run through Pi's configured ModelRegistry after the attended /helix-run preflight.",
      ],
      details: {
        presets: [...presets.keys()],
        chains: Object.fromEntries(chains.map((chain) => [chain.id, chain.stages.map((stage) => stage.id)])),
        available_models: inventory,
      },
    });
  }

  const profileId = tokens[1];
  const pairs = tokens.slice(2);
  if (pairs.length === 0) return usage(tokens.join(" "));
  const active = resolveActiveProfile(deps.stateRoot);
  if (!active.ok) return fail(active.code, active.detail, "Helix setup refused");
  const existing = loadProfile(deps.stateRoot, profileId);
  if (!existing.ok) return fail(existing.code, existing.detail, "Helix setup refused");
  const base = existing.profile;
  const assignments = {};
  const knownStages = new Set((deps.chainRegistry?.chains ?? []).flatMap((chain) => (chain.stages ?? []).map((stage) => stage.id)));
  const presetOverlays = Object.fromEntries(Object.entries(base.overrides.presets ?? {}).map(([presetId, overlay]) => [
    presetId,
    { roles: Object.fromEntries(Object.entries(overlay.roles).map(([role, members]) => [role, members.map((member) => ({ ...member }))])) },
  ]));
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 1) return fail("invalid-assignment", pair.includes("/") ? null : pair, "Helix setup refused");
    const target = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const dot = target.indexOf(".");
    if (dot > 0) {
      const presetId = target.slice(0, dot);
      const role = target.slice(dot + 1);
      const tracked = presets.get(presetId);
      if (!tracked) return fail(`unknown-preset:${presetId}`, role, "Helix setup refused");
      if (!Object.prototype.hasOwnProperty.call(tracked.roles, role)) return fail("invalid-assignment", role, "Helix setup refused");
      const members = value.split(",").map(parseMemberToken);
      if (members.length === 0 || members.some((member) => member === null)) return fail("invalid-assignment", role, "Helix setup refused");
      for (const member of members) {
        const available = assertSetupMemberAvailable(member, deps);
        if (!available.ok) return fail(available.code, available.detail, "Helix setup refused");
      }
      const roles = presetOverlays[presetId]?.roles
        ?? Object.fromEntries(Object.entries(tracked.roles).map(([baseRole, baseMembers]) => [baseRole, baseMembers.map((member) => ({ ...member }))]));
      roles[role] = members;
      presetOverlays[presetId] = { roles };
      continue;
    }
    const stage = target;
    if (!knownStages.has(stage)) return fail("assignment-unknown-stage", stage, "Helix setup refused");
    const parsed = parseAssignmentToken(value, presets);
    if (!parsed) return fail("invalid-assignment", stage, "Helix setup refused");
    if (parsed.kind === "composite" && !presets.has(parsed.preset)) {
      return fail(`unknown-preset:${parsed.preset}`, stage, "Helix setup refused");
    }
    if (parsed.kind === "model") {
      const available = assertSetupMemberAvailable(parsed, deps);
      if (!available.ok) return fail(available.code, available.detail, "Helix setup refused");
    }
    assignments[stage] = parsed;
  }
  const profile = {
    ...base,
    overrides: {
      ...base.overrides,
      assignments: { ...(base.overrides.assignments ?? {}), ...assignments },
      ...(Object.keys(presetOverlays).length ? { presets: presetOverlays } : {}),
    },
  };
  const activated = saveAndActivateProfile(deps.stateRoot, profile);
  if (!activated.ok) return fail(activated.code, activated.detail, "Helix setup refused");
  return result({
    title: "Helix setup saved",
    lines: [
      `Profile '${profileId}' saved and activated.`,
      ...Object.entries(assignments).map(([stage, a]) => `  ${stage} -> ${assignmentLabel(a)}`),
      ...Object.entries(presetOverlays).map(([presetId, overlay]) => `  ${presetId}: ${Object.keys(overlay.roles).length} role lineup(s)`),
      "",
      "Preflight it: /helix-run",
    ],
    details: { profile_id: profileId, assignments, preset_overlays: Object.keys(presetOverlays), mutating: true },
    mutating: true,
  });
}

function renderResearch(deps, tokens, ctx) {
  const loaded = loadUserSettings(deps);
  if (!loaded.ok) return fail(loaded.code, loaded.detail, "Helix research refused");
  const gate = requireToggle(loaded.settings, "autoresearch");
  if (!gate.ok) return fail(gate.code, null, "Helix research refused");
  if (ctx.mode !== "tui") {
    return fail("research-requires-attended", `mode-${ctx.mode ?? "unknown"}`, "Helix research refused");
  }

  const words = [];
  const flags = {};
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--metric") {
      const parsed = parseStrictNumberToken(tokens[i + 3]);
      if (!parsed.ok) return fail("research-invalid-spec", "metric-target", "Helix research refused");
      flags.metric = { name: tokens[i + 1], comparator: tokens[i + 2], target: parsed.value };
      i += 3;
    } else if (token === "--max") {
      const parsed = parseStrictNumberToken(tokens[i + 1]);
      if (!parsed.ok) return fail("research-invalid-spec", "max-iterations", "Helix research refused");
      flags.max = parsed.value;
      i += 1;
    } else if (token === "--plateau") {
      const parsed = parseStrictNumberToken(tokens[i + 1]);
      if (!parsed.ok) return fail("research-invalid-spec", "diminishing-returns", "Helix research refused");
      flags.plateau = parsed.value;
      i += 1;
    } else {
      words.push(token);
    }
  }
  const question = words.join(" ");
  const spec = {
    run_id: "research-preflight",
    question: question || "",
    hypothesis: question || "",
    experiment: "declared-at-launch",
    ...(flags.metric ? { metric: flags.metric } : {}),
    ...(Number.isFinite(flags.max)
      ? { stop: { max_iterations: flags.max, ...(Number.isFinite(flags.plateau) ? { diminishing_returns_after: flags.plateau } : {}) } }
      : {}),
  };
  if (!spec.metric) return fail("research-missing-metric", null, "Helix research refused");
  if (!spec.stop) return fail("research-missing-stop", null, "Helix research refused");
  const shape = validate(RESEARCH_SPEC_SCHEMA, spec, "$");
  if (!shape.valid) {
    return fail("research-invalid-spec", shape.errors.map((e) => e.path).join(","), "Helix research refused");
  }
  const questionRef = hashRef(question);
  const cli = `node tools/research/helix-research.mjs --question '<private-question>' --metric ${spec.metric.name} ${JSON.stringify(spec.metric.comparator)} ${spec.metric.target} --max ${spec.stop.max_iterations}${spec.stop.diminishing_returns_after ? ` --plateau ${spec.stop.diminishing_returns_after}` : ""} --measure-cmd '<your measurement command>'`;
  return result({
    title: "Helix research preflight",
    lines: [
      `Question ref: ${questionRef}`,
      `Metric: ${spec.metric.name} ${spec.metric.comparator} ${spec.metric.target}`,
      `Stop: max ${spec.stop.max_iterations} iteration(s)${spec.stop.diminishing_returns_after ? `, plateau after ${spec.stop.diminishing_returns_after}` : ""}`,
      "Stop reasons: target-met | max-iterations | diminishing-returns | dead-end (a refutation is a result).",
      "Attended only - stay at the terminal.",
      `CLI: ${cli}`,
    ],
    details: { question_ref: questionRef, metric: spec.metric, stop: spec.stop, cli_invocation: cli, launches_loop: false },
  });
}

function renderRunsWatch(runId, deps) {
  if (!runId) return fail("missing-run-id", null, "Helix run watch refused");
  const valid = validateRunId(runId);
  if (!valid.ok) return fail(valid.code, valid.detail, "Helix run watch refused");
  const kernelStatePath = join(deps.runsRoot, runId, `${runId}.state.json`);
  if (existsSync(kernelStatePath)) {
    try {
      const stateEntry = lstatSync(kernelStatePath);
      if (stateEntry.isSymbolicLink() || !stateEntry.isFile() || stateEntry.size > 64 * 1024) throw new Error("state-file");
      const state = JSON.parse(readFileSync(kernelStatePath, "utf8"));
      if (state?.schema_version === 4) return renderKernelRunWatch(runId, deps, state);
    } catch {
      return fail("run-record-invalid-or-unsafe", "kernel-state", "Helix run watch refused");
    }
  }
  const eventsPath = join(deps.runsRoot, runId, `${runId}.events.jsonl`);
  if (!existsSync(eventsPath)) return fail("run-not-found", "run-events-not-found", "Helix run watch refused");
  let events;
  try {
    const entry = lstatSync(eventsPath);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size === 0 || entry.size > 64 * 1024 * 1024) {
      return fail("run-record-invalid-or-unsafe", "event-stream-file", "Helix run watch refused");
    }
    events = readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  } catch {
    return fail("helix-config-unreadable", "events-jsonl", "Helix run watch refused");
  }
  const scanned = scanOrRefuse(events, "Helix run watch refused");
  if (scanned.leak) return scanned.leak;
  if (!validateEventHistory(events, { run_id: runId }).valid) {
    return fail("run-record-invalid-or-unsafe", "event-stream-structure", "Helix run watch refused");
  }
  const runStart = events[0];
  let resolvedConfig = resolveRunConfig(deps.runRegistry, runStart?.config_id);
  let resolvedChain = resolveChain(deps.chainRegistry, runStart?.chain_id);
  let workflow = null;
  if (runStart?.workflow_ref) {
    const definitionPath = join(deps.runsRoot, runId, `${runId}.workflow.json`);
    try {
      if (!existsSync(definitionPath)) throw new Error("missing");
      const entry = lstatSync(definitionPath);
      if (entry.isSymbolicLink() || !entry.isFile() || entry.size > 64 * 1024) throw new Error("invalid-file");
      const definition = JSON.parse(readFileSync(definitionPath, "utf8"));
      const definitionText = stableStringify(definition);
      if (hashRef(definitionText) !== runStart.workflow_ref
        || !validateWorkflowLifecycleSnapshot(definition)
        || definition.workflow_id !== runStart.config_id || definition.chain_id !== runStart.chain_id) {
        throw new Error("invalid");
      }
      resolvedConfig = { ok: true, config: { id: definition.workflow_id, chain: definition.chain_id, max_iterations: definition.max_iterations } };
      resolvedChain = { ok: true, chain: { id: definition.chain_id, stages: definition.stages } };
      workflow = { id: definition.workflow_id, source: "run-snapshot", stages: definition.stages };
    } catch {
      return fail("run-record-invalid-or-unsafe", "workflow-snapshot", "Helix run watch refused");
    }
  } else if (!resolvedConfig.ok) {
    const named = resolveWorkflow(deps.stateRoot, runStart?.config_id, deps.chainRegistry, deps.runRegistry);
    const execution = named.ok ? workflowToExecution(named.workflow) : null;
    if (execution?.ok && execution.chain.id === runStart?.chain_id) {
      resolvedConfig = { ok: true, config: execution.config };
      resolvedChain = { ok: true, chain: execution.chain };
      workflow = named.workflow;
    }
  }
  if (!workflow && resolvedConfig.ok && resolvedChain.ok) {
    workflow = builtInWorkflows(deps.chainRegistry, deps.runRegistry)
      .find((candidate) => candidate.id === runStart.config_id) ?? null;
  }
  const lifecycleValid = resolvedConfig.ok && resolvedChain.ok
    && [true, false].some((loops) => reduceEventLifecycle(events, {
      chain: resolvedChain.chain,
      max_iterations: resolvedConfig.config.max_iterations,
      toggles: { loops },
      run_id: runId,
    }).valid);
  if (!resolvedConfig.ok || !resolvedChain.ok || resolvedConfig.config.chain !== runStart.chain_id
    || !lifecycleValid) {
    return fail("run-record-invalid-or-unsafe", "event-lifecycle", "Helix run watch refused");
  }
  const last = (kind) => [...events].reverse().find((event) => event.kind === kind);
  const runEnd = last("run-end");
  const passStart = last("pass-start");
  const gate = last("gate");
  const verdict = last("verdict");
  const blocked = last("blocked");
  const pressure = last("pressure");
  const elapsed = events.length ? events[events.length - 1].t_rel_ms : 0;
  const lines = [
    `Run: ${runId} ${runEnd ? `(finished: ${runEnd.stop_reason})` : "(in progress or interrupted)"}`,
    `Stage: ${passStart ? `${passStart.stage_id} pass ${passStart.pass}/${passStart.of}` : "-"} ${passStart?.executor_ref ? `cast ${passStart.executor_ref}` : ""}`,
    `Gate: ${gate ? `${gate.result} (${gate.phase})` : "not run yet"}`,
    `Verdict: ${verdict ? verdict.verdict : "-"}`,
    `Pressure: ${pressure ? (pressure.status === "measured" ? `${pressure.tokens} tokens` : "unavailable") : "-"}`,
    blocked ? `Blocked: ${blocked.code} -> next: ${blocked.next_action ?? "-"}` : "Blocked: no",
    `Elapsed: ${elapsed}ms across ${events.length} event(s)`,
    ...(runEnd && runEnd.open_disagreements != null ? [`Open disagreements: ${runEnd.open_disagreements}`] : []),
    ...(workflow ? ["", ...workflowGraphLines(workflow, events)] : []),
  ];
  return result({
    title: "Helix run watch",
    lines,
    details: {
      run_id: runId,
      finished: Boolean(runEnd),
      stop_reason: runEnd?.stop_reason ?? null,
      stage_id: passStart?.stage_id ?? null,
      pass: passStart?.pass ?? null,
      gate_result: gate?.result ?? null,
      verdict: verdict?.verdict ?? null,
      blocked_code: blocked?.code ?? null,
      events: events.length,
      flow: workflow ? workflowGraphLines(workflow, events).slice(1) : [],
    },
  });
}

function renderKernelRunWatch(runId, deps, state) {
  const scannedState = scanOrRefuse(state, "Helix run watch refused");
  if (scannedState.leak) return scannedState.leak;
  if (state.run_id !== runId || state.workflow_id == null
    || !/^sha256:[0-9a-f]{64}$/.test(state.definition_ref ?? "")
    || !Number.isSafeInteger(state.event_count) || state.event_count < 0
    || typeof state.completed !== "boolean") {
    return fail("run-record-invalid-or-unsafe", "kernel-state-structure", "Helix run watch refused");
  }
  const definitionPath = join(deps.runsRoot, runId, `${runId}.definition.json`);
  const lifecyclePath = join(deps.runsRoot, runId, `${runId}.workflow.json`);
  const eventsPath = join(deps.runsRoot, runId, `${runId}.kernel.events.jsonl`);
  let definition;
  let events = [];
  try {
    const definitionEntry = lstatSync(definitionPath);
    if (definitionEntry.isSymbolicLink() || !definitionEntry.isFile() || definitionEntry.size > 256 * 1024) throw new Error("definition-file");
    definition = JSON.parse(readFileSync(definitionPath, "utf8"));
    const normalized = normalizeWorkflowDefinition(definition);
    if (!normalized.ok || normalized.migrated || normalized.definition.id !== state.workflow_id) throw new Error("definition-shape");
    const lifecycle = workflowLifecycleSnapshot(normalized.definition);
    if (!lifecycle || lifecycle.definition_ref !== state.definition_ref) throw new Error("definition-binding");
    const lifecycleEntry = lstatSync(lifecyclePath);
    if (lifecycleEntry.isSymbolicLink() || !lifecycleEntry.isFile() || lifecycleEntry.size > 64 * 1024) throw new Error("lifecycle-file");
    const persistedLifecycle = JSON.parse(readFileSync(lifecyclePath, "utf8"));
    if (!validateWorkflowLifecycleSnapshot(persistedLifecycle)
      || stableStringify(persistedLifecycle) !== stableStringify(lifecycle)) throw new Error("lifecycle-binding");
    definition = normalized.definition;
    if (existsSync(eventsPath)) {
      const eventEntry = lstatSync(eventsPath);
      if (eventEntry.isSymbolicLink() || !eventEntry.isFile() || eventEntry.size > 64 * 1024 * 1024) throw new Error("event-file");
      const text = readFileSync(eventsPath, "utf8");
      if (text !== "" && !text.endsWith("\n")) throw new Error("partial-events");
      events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    }
    const nodeIds = new Set(Object.keys(definition.nodes));
    if (events.some((event, index) => event?.schema_version !== 1 || event.seq !== index + 1
      || event.run_id !== runId || typeof event.kind !== "string"
      || (event.node_id != null && !nodeIds.has(event.node_id)))) throw new Error("event-structure");
    if (state.completed && state.event_count !== events.length) throw new Error("event-count");
    if (!state.completed && state.event_count > events.length) throw new Error("event-count");
    const scannedEvents = scanOrRefuse(events, "Helix run watch refused");
    if (scannedEvents.leak) return scannedEvents.leak;
  } catch (error) {
    const stableReasons = new Set([
      "definition-file", "definition-shape", "definition-binding", "lifecycle-file", "lifecycle-binding",
      "event-file", "partial-events", "event-structure", "event-count",
    ]);
    const reason = stableReasons.has(error?.message) ? error.message : "kernel-run-structure";
    return fail("run-record-invalid-or-unsafe", reason, "Helix run watch refused");
  }
  const graph = observedWorkflowGraph(definition, events);
  if (!graph.ok) return fail("run-record-invalid-or-unsafe", "kernel-graph", "Helix run watch refused");
  const lastNode = [...graph.nodes].reverse().find((node) => node.status !== "pending");
  const lines = [
    `Run: ${runId} ${state.completed ? `(finished: ${state.status})` : "(in progress or interrupted)"}`,
    `Workflow: ${state.workflow_id} v${state.workflow_version}`,
    `Node: ${lastNode ? `${lastNode.id} (${lastNode.kind}, ${lastNode.status})` : "not started"}`,
    `Effects journaled: ${state.journal_entries}`,
    `Events: ${events.length}`,
    "",
    ...workflowGraphLines(definition, events),
  ];
  return result({
    title: "Helix run watch",
    lines,
    details: {
      run_id: runId,
      workflow_id: state.workflow_id,
      workflow_version: state.workflow_version,
      finished: state.completed,
      status: state.status,
      code: state.code,
      terminal: state.terminal,
      events: events.length,
      journal_entries: state.journal_entries,
      flow: workflowGraphLines(definition, events).slice(1),
    },
  });
}

function renderRunsResume(runId, deps) {
  if (!runId) return fail("missing-run-id", null, "Helix run resume refused");
  const valid = validateRunId(runId);
  if (!valid.ok) return fail(valid.code, valid.detail, "Helix run resume refused");
  const statePath = join(deps.runsRoot, runId, `${runId}.state.json`);
  if (!existsSync(statePath)) return fail("run-not-found", "run-state-not-found", "Helix run resume refused");
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return fail("helix-config-unreadable", "state-json", "Helix run resume refused");
  }
  const scanned = scanOrRefuse(state, "Helix run resume refused");
  if (scanned.leak) return scanned.leak;
  if (state?.schema_version === 4) {
    if (state.run_id !== runId || typeof state.completed !== "boolean"
      || typeof state.workflow_id !== "string" || !/^sha256:[0-9a-f]{64}$/.test(state.definition_ref ?? "")) {
      return fail("invalid-resume-state", "kernel-state-structure", "Helix run resume refused");
    }
    if (state.completed) {
      return result({
        title: "Helix run resume",
        lines: [`Run ${runId} already completed (${state.status}). Resuming is a no-op.`],
        details: { run_id: runId, completed: true, status: state.status },
      });
    }
    return result({
      title: "Helix run resume",
      lines: [
        `Run ${runId} is structurally resumable from its private kernel checkpoint.`,
        `Workflow: ${state.workflow_id} v${state.workflow_version}`,
        "Resume requires the original task and a fresh exact provider attestation in an attended Pi session.",
      ],
      details: {
        run_id: runId,
        workflow_id: state.workflow_id,
        workflow_version: state.workflow_version,
        completed: false,
        task_required: true,
        in_process_resume: true,
      },
    });
  }
  const stateShape = validateRunnerState(state, { runId });
  if (!stateShape.valid) return fail("invalid-resume-state", "state-structure", "Helix run resume refused");
  // Pi-started named workflows bind an exact in-memory task into execution_ref.
  // Until in-process resume can restore that task and provider adapter, never
  // print the legacy config-only CLI: it would deterministically mismatch.
  if (state.task_bound === true) {
    return fail("workflow-resume-unsupported", state.config_id, "Helix workflow resume refused");
  }
  const resolvedConfig = resolveRunConfig(deps.runRegistry, state.config_id);
  if (!resolvedConfig.ok) {
    const named = resolveWorkflow(deps.stateRoot, state.config_id, deps.chainRegistry, deps.runRegistry);
    if (named.ok && named.workflow.source === "user") {
      return fail(
        "workflow-resume-unsupported",
        state.config_id,
        "Helix workflow resume refused",
      );
    }
  }
  const resolvedChain = resolveChain(deps.chainRegistry, state.chain_id);
  if (!resolvedConfig.ok || !resolvedChain.ok
    || resolvedConfig.config.chain !== state.chain_id
    || !validateMachineResume(
      resolvedChain.chain,
      resolvedConfig.config.max_iterations,
      state.toggles ?? null,
      state.machine,
    )) {
    return fail("invalid-resume-state", "machine-config-binding", "Helix run resume refused");
  }
  const eventsPath = join(deps.runsRoot, runId, `${runId}.events.jsonl`);
  let history;
  try {
    if (state.initializing && state.event_count === 0) {
      const text = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "";
      if (text !== "" && !text.endsWith("\n")) throw new Error("partial");
      history = text === "" ? [] : text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      if (history.length > 1 || (history.length === 1
        && !validateEventHistory(history, { run_id: runId }).valid)) throw new Error("invalid-initializing-events");
    } else {
      if (!existsSync(eventsPath)) throw new Error("missing");
      const text = readFileSync(eventsPath, "utf8");
      if (!text.endsWith("\n")) throw new Error("partial");
      history = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      if (history.length < state.event_count || !validateEventHistory(history, { run_id: runId }).valid) throw new Error("invalid");
    }
    if (!validateCheckpointEventBinding(history, state, {
      max_iterations: resolvedConfig.config.max_iterations,
      chain: resolvedChain.chain,
      toggles: state.toggles ?? null,
    })) throw new Error("pass-checkpoint-mismatch");
    if (state.completed && !history.some((event) => event.kind === "run-end") && state.pending_event?.kind !== "run-end") {
      throw new Error("terminal-event-missing");
    }
  } catch {
    return fail("resume-events-invalid", "event-stream-structure", "Helix run resume refused");
  }
  const disagreementsPath = disagreementSnapshotPath(
    join(deps.runsRoot, runId),
    runId,
    state.disagreement_ref,
  );
  try {
    const emptyInitializing = { schema_version: 1, run_id: runId, entries: [] };
    const document = disagreementsPath && existsSync(disagreementsPath)
      ? JSON.parse(readFileSync(disagreementsPath, "utf8"))
      : (state.initializing && hashRef(stableStringify(emptyInitializing)) === state.disagreement_ref
        ? emptyInitializing
        : (() => { throw new Error("missing"); })());
    if (!validateDisagreementDocument(document, runId).valid
      || hashRef(stableStringify(document)) !== state.disagreement_ref) throw new Error("invalid");
  } catch {
    return fail("resume-disagreements-invalid", "disagreement-record-structure", "Helix run resume refused");
  }
  // Project only known-structural, integer machine fields — never the raw
  // machine object (which could carry unexpected keys from a doctored file).
  const machine = {
    stage_index: Number.isInteger(state.machine?.stage_index) ? state.machine.stage_index : null,
    total_passes: Number.isInteger(state.machine?.total_passes) ? state.machine.total_passes : null,
  };
  if (state.completed === true) {
    return result({
      title: "Helix run resume",
      lines: [`Run ${runId} already completed (${state.stop_reason ?? "done"}). Resuming is a no-op.`],
      details: { run_id: runId, completed: true, stop_reason: state.stop_reason ?? null },
    });
  }
  // The resume CLI carries the run's config binding so `--resume` restores the
  // SAME config, not the default; the runner cross-checks config_id/chain_id.
  const configFlag = ` --config ${state.config_id}`;
  const cli = `node tools/loop/helix-task-loop.mjs --resume ${runId}${configFlag} --repo '<original-repository>'`;
  return result({
    title: "Helix run resume",
    lines: [
      `Run ${runId} is resumable (stage index ${machine.stage_index ?? "?"}, ${machine.total_passes ?? "?"} pass(es) done).`,
      `Config: ${state.config_id}${state.run_target.repo === "self" ? " on the original repository" : ""}`,
      `Repository binding: ${state.repository_ref}`,
      `CLI: ${cli}`,
    ],
    details: { run_id: runId, completed: false, config_id: state.config_id, repository_ref: state.repository_ref, machine, cli_invocation: cli },
  });
}

function renderRunsList(deps) {
  const runs = listRuns(deps.runsRoot);
  return result({
    title: "Helix runs",
    lines: [
      "Structural run records only",
      runs.length ? `Runs: ${runs.length}` : "Runs: none",
      ...runs.map((entry) =>
        `${entry.run_id}: ${entry.kind} ${entry.status} prune=${entry.prunable ? "available" : "non-prunable-flat-record"} iterations=${entry.iterations_run ?? "n/a"} tokens=${entry.total_tokens ?? "n/a"}${entry.worktree_branch ? ` worktree=${entry.worktree_branch}` : ""}`),
    ],
    details: { runs },
  });
}

function renderRunStatus(runId, deps) {
  if (!runId) return fail("missing-run-id", null, "Helix run status refused");
  const status = statusRun(deps.runsRoot, runId);
  if (!status.ok) return fail(status.code, status.detail, "Helix run status refused");
  return result({
    title: "Helix run status",
    lines: [
      `Run: ${status.run_id}`,
      "Structural run records only",
      ...status.entries.map((entry) =>
        `${entry.path}: ${entry.kind} ${entry.status} prune=${entry.prunable ? "available" : "non-prunable-flat-record"} stop=${entry.stop_reason ?? "n/a"} iterations=${entry.iterations_run ?? "n/a"} tokens=${entry.total_tokens ?? "n/a"}${entry.worktree_branch ? ` worktree=${entry.worktree_branch}` : ""}`),
    ],
    details: status,
  });
}

function renderRunPrune(runId, ctx, deps) {
  if (!runId) return fail("missing-run-id", null, "Helix run prune refused");
  const valid = validateRunId(runId);
  if (!valid.ok) return fail(valid.code, valid.detail, "Helix run prune refused");
  if (ctx.mode !== "tui") {
    return fail("helix-prune-requires-tui-confirm", "mode-not-tui", "Helix run prune refused");
  }
  if (ctx.confirm !== true) {
    return result({
      ok: true,
      status: "cancelled",
      code: "helix-prune-cancelled",
      title: "Helix run prune cancelled",
      lines: [`Prune cancelled for run ${runId}.`],
      details: { run_id: runId, confirmed: ctx.confirm === true },
      mutating: false,
    });
  }
  const pruned = pruneRun(deps.runsRoot, runId);
  if (!pruned.ok) return fail(pruned.code, pruned.detail, "Helix run prune refused");
  return result({
    title: "Helix run pruned",
    lines: [`Pruned structural run directory: ${runId}`],
    details: pruned,
    mutating: true,
  });
}

function mutationKind(tokens) {
  if (tokens[0] === "runs" && tokens[1] === "prune") return "prune";
  if (tokens[0] === "settings" && tokens[1] === "set") return "settings";
  if (tokens[0] === "profiles" && ["create", "switch"].includes(tokens[1])) return "profiles";
  if (tokens[0] === "setup" && tokens.length > 1) return "setup";
  if (tokens[0] === "workflows" && ["create", "import"].includes(tokens[1])) return "workflow";
  return null;
}

function authorizeMutation(kind, ctx) {
  if (!kind) return null;
  if (ctx.mode !== "tui") return fail("helix-mutation-requires-tui-confirm", "mode-not-tui", "Helix mutation refused");
  if (ctx.confirm !== true) {
    return result({
      ok: true,
      status: "cancelled",
      code: "helix-mutation-cancelled",
      title: "Helix mutation cancelled",
      lines: [`Mutation cancelled: ${kind}`],
      details: { mutation: kind, confirmed: false },
      mutating: false,
    });
  }
  return null;
}

export function isHelixPruneRequest(args) {
  const tokens = splitArgs(args);
  return tokens[0] === "runs" && tokens[1] === "prune";
}

export function isHelixMutationRequest(args) {
  return mutationKind(splitArgs(args)) !== null;
}

export function getHelixArgumentCompletions(argumentPrefix = "", options = {}) {
  const prefix = typeof argumentPrefix === "string" ? argumentPrefix.trimStart() : "";
  if (!prefix || !prefix.includes(" ")) {
    return TOP_LEVEL_COMPLETIONS.filter((item) => item.value.startsWith(prefix));
  }
  if (prefix.startsWith("run ")) {
    try {
      const root = options.root ?? DEFAULT_ROOT;
      const registry = options.runRegistry ?? readJson(root, "dispatch/config/run-configs.json");
      if (!validateRunConfigRegistry(registry).valid) return null;
      const query = prefix.slice("run ".length);
      return Array.isArray(registry?.configs)
        ? registry.configs
          .filter((config) => typeof config?.id === "string" && config.id.startsWith(query))
          .map((config) => ({ value: `run ${config.id}`, label: config.id, description: "Helix run config" }))
        : null;
    } catch {
      return null;
    }
  }
  if (prefix.startsWith("runs ")) {
    const query = prefix.slice("runs ".length);
    return RUNS_COMPLETIONS.filter((item) => item.value.slice("runs ".length).startsWith(query));
  }
  if (prefix.startsWith("workflows ")) {
    const query = prefix.slice("workflows ".length);
    return [
      { value: "workflows list", label: "list", description: "List built-in and user workflows" },
      { value: "workflows show ", label: "show", description: "Inspect stages and transitions" },
      { value: "workflows test ", label: "test", description: "Simulate without provider calls" },
      { value: "workflows create ", label: "create", description: "Create a workflow from a guided template" },
      { value: "workflows import ", label: "import", description: "Validate and deploy a WorkflowDefinition v4 JSON file" },
    ].filter((item) => item.value.slice("workflows ".length).startsWith(query));
  }
  return null;
}

export function executeHelixCommand(args = "", ctx = {}, options = {}) {
  const tokens = splitArgs(args);
  if (tokens[0] === "help") return renderHelp();

  let deps;
  try {
    deps = dependencies(options);
  } catch (error) {
    return configLoadFail(error);
  }
  if (tokens.length === 0) return renderDashboard(deps);

  const requestedMutation = mutationKind(tokens);
  if (requestedMutation === "prune") {
    if (!tokens[2]) return fail("missing-run-id", null, "Helix run prune refused");
    const valid = validateRunId(tokens[2]);
    if (!valid.ok) return fail(valid.code, valid.detail, "Helix run prune refused");
  }
  const mutationRefusal = authorizeMutation(requestedMutation, ctx);
  if (mutationRefusal) return mutationRefusal;

  const [verb, subverb, runId] = tokens;
  if (verb === "run") {
    if (tokens.length > 2) return usage(tokens.join(" "));
    const selected = subverb ? { ok: true, config_id: subverb } : resolveDefaultConfigId(deps);
    if (!selected.ok) return fail(selected.code, selected.detail, "Helix run preflight refused");
    const configId = selected.config_id;
    return renderPreflight(buildPreflight(configId, deps), configId);
  }
  if (verb === "runs") {
    if (subverb === "list") return renderRunsList(deps);
    if (subverb === "status") return renderRunStatus(runId, deps);
    if (subverb === "watch") return renderRunsWatch(runId, deps);
    if (subverb === "resume") return renderRunsResume(runId, deps);
    if (subverb === "prune") return renderRunPrune(runId, ctx, deps);
    return usage(tokens.join(" "));
  }
  if (verb === "help") return renderHelp();
  if (verb === "models") return renderModels(deps);
  if (verb === "chains") return renderChains(deps);
  if (verb === "workflows") return renderWorkflows(deps, tokens);
  if (verb === "settings") return renderSettings(deps, tokens);
  if (verb === "profiles") return renderProfiles(deps, tokens);
  if (verb === "setup") return renderSetup(deps, tokens);
  if (verb === "research") return renderResearch(deps, tokens, ctx);
  return usage(verb);
}
