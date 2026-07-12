// Helix /helix command core - Stage 3O PR1.
//
// This module is Pi-runtime-free: it renders resolved Helix control-surface
// views and delegates policy to the existing Stage 3 validators/resolvers. The
// Mutating verbs (settings set, profile create/switch, setup, and structural
// prune) are gated by ctx.mode + explicit confirmation before any writer runs.

import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../../dispatch/lib/schema.mjs";
import { reduceEventLifecycle, validateCheckpointEventBinding, validateEventHistory } from "../../dispatch/lib/events.mjs";
import { routeForClass } from "../../dispatch/lib/routes.mjs";
import { resolveRunConfig, validateRunConfigRegistry } from "../../dispatch/lib/run-configs.mjs";
import { listRuns, pruneRun, statusRun, validateRunId } from "../../dispatch/lib/run-manager.mjs";
import { assertPublicSafe, hashRef, stableStringify } from "../../dispatch/lib/run-record.mjs";
import { isModelId, isPublicCode } from "../../dispatch/lib/public-values.mjs";
import { validateDisagreementDocument } from "../../dispatch/lib/handoff.mjs";
import { resolveChain, validateChainRegistry } from "../../dispatch/lib/chains.mjs";
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

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const HELIX_USAGE = `Usage:
  /helix
  /helix help
  /helix run [config-id]
  /helix runs list | status <run-id> | watch <run-id> | resume <run-id> | prune <run-id>
  /helix models
  /helix chains
  /helix settings [set <toggle> on|off]
  /helix profiles [show <id> | switch <id> | create <id>]
  /helix setup [<existing-profile-id> <stage>=<preset | provider/model[:effort]> ...]
               [<preset>.<role>=<provider/model[:effort][*instances]>[, ...] ...]
  /helix research <question> --metric <name> <cmp> <target> --max <n> [--plateau <n>]

The slash command is preflight/view/state only: loops execute through the printed
CLI commands. The shipped runner executes mock casts only; a cast naming any real
provider refuses as live-adapter-not-wired until the approval-gated transport lands.`;

const TOP_LEVEL_COMPLETIONS = Object.freeze([
  { value: "help", label: "help", description: "Show the public-safe Helix cheat sheet" },
  { value: "run", label: "run", description: "Preflight a run config; do not launch" },
  { value: "runs", label: "runs", description: "List, inspect, or prune structural run records" },
  { value: "models", label: "models", description: "View composite presets and the default role matrix" },
  { value: "chains", label: "chains", description: "View the staged chain catalog" },
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
    next: "Use /helix run with no argument to see the default config, or inspect /helix chains.",
  },
  "missing-run-id": {
    reason: "This verb needs a structural run id.",
    next: "Run /helix runs list and copy a listed run id.",
  },
  "unsafe-run-id": {
    reason: "The run id is not a safe structural record token.",
    next: "Use an exact run id from /helix runs list; path traversal and root-resolving ids are refused.",
  },
  "run-not-found": {
    reason: "No structural run record matched that run id.",
    next: "Run /helix runs list and choose an existing run id.",
  },
  "helix-settings-unreadable": {
    reason: "The user-local settings file exists but cannot be read or parsed.",
    next: "Fix or delete dispatch/local/settings.json (absent = all toggles on).",
  },
  "research-requires-attended": {
    reason: "Research is attended-only by owner decision.",
    next: "Run /helix research from an interactive TUI session and stay at the terminal.",
  },
  "toggle-disabled:autoresearch": {
    reason: "The autoresearch toggle is off - invoking the verb is an explicit conflict.",
    next: "Run /helix settings set autoresearch on, then retry.",
  },
  "toggle-disabled:multi-model": {
    reason: "A composite cast needs the multi-model toggle.",
    next: "Run /helix settings set multi-model on, or assign a plain provider/model instead.",
  },
  "helix-prune-requires-tui-confirm": {
    reason: "Prune requires an attended TUI confirmation.",
    next: "Open Pi in TUI mode and retry, or leave the record in place.",
  },
  "helix-mutation-requires-tui-confirm": {
    reason: "Every /helix mutation requires an attended TUI confirmation.",
    next: "Open Pi in TUI mode, retry the mutation, and confirm the prompt.",
  },
  "helix-mutation-cancelled": {
    reason: "The attended mutation was not confirmed.",
    next: "Retry and confirm only if the displayed mutation is intended.",
  },
  "live-adapter-not-wired": {
    reason: "This cast names a real provider, but the staged runner has no approved live transport in this build.",
    next: "Use the tracked mock cast for no-live proof, or wait for the separately approved live-adapter track.",
  },
  "helix-model-inventory-unavailable": {
    reason: "Pi's available-model inventory was unavailable, so Helix cannot validate a real member.",
    next: "Retry from an attended Pi TUI after provider login, or use a mock member.",
  },
  "preset-member-unavailable": {
    reason: "A requested provider/model is not in Pi's currently available inventory.",
    next: "Log in to that provider or choose an exact model shown by /helix setup.",
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
  const load = (key, rel) => options[key] ?? readJson(root, rel);
  return {
    root,
    runRegistry: load("runRegistry", "dispatch/config/run-configs.json"),
    chainRegistry: load("chainRegistry", "dispatch/config/chains.json"),
    roleMatrix: load("roleMatrix", "dispatch/config/role-matrix-defaults.json"),
    agentTeam: load("agentTeam", "dispatch/config/agent-team-defaults.json"),
    packageJson: load("packageJson", "package.json"),
    settings: load("settings", ".pi/settings.json"),
    runsRoot: options.runsRoot ?? join(root, "dispatch", "runs"),
    settingsPath: options.settingsPath ?? join(root, DEFAULT_SETTINGS_REL_PATH),
    matricesDir: options.matricesDir ?? join(root, "dispatch", "config", "matrices"),
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
    next: "Run /helix help, then retry with a supported no-live/view-only verb.",
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
      "Install/load: open this repository as a trusted Pi project; package resources are pinned in package.json and .pi/settings.json.",
      "Verify loaded: run /helix. Runtime RPC inventory can be checked with node tools/smoke/pi-e2e-load.mjs --runtime-rpc.",
      "First no-live preflight: /helix run mock-core-loop.",
      "Run loop manually: use the CLI printed by /helix run; PR1 does not launch loops from the slash command.",
      "Runs: /helix runs list, /helix runs status <run-id>, /helix runs prune <run-id>.",
      "Mutations: settings set, profiles create/switch, setup, and prune are TUI-only and require explicit confirmation.",
      "Views: /helix models (presets), /helix chains (staged catalog), /helix settings, /helix profiles.",
      "Casts: /helix setup saves stage assignments and complete per-role composite member lineups from Pi's available-model inventory.",
      "Loops: /helix run preflights; the printed CLI executes; /helix runs watch renders the loop widget from its event stream; /helix runs resume prints the resume CLI.",
      "Research: /helix research validates the mandatory metric+stop shape (attended, TUI only) and prints the research CLI.",
      "Live: presence declares live intent, but this build refuses real-provider casts as live-adapter-not-wired. The default mock config is no-live.",
      "Refusals: every refusal shows a stable code, reason, and next safe action.",
      "Manual: docs/manual.md.",
    ],
    details: {
      view_only: true,
      public_safe: true,
      launches_loop: false,
      live_calls: false,
      paid_calls: false,
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
      artifact: stage.artifact ? { ...stage.artifact } : null,
    })),
  };
}

function resourceStatus(pkg, settings) {
  const pkgSkills = Array.isArray(pkg?.pi?.skills) ? pkg.pi.skills : [];
  const pkgThemes = Array.isArray(pkg?.pi?.themes) ? pkg.pi.themes : [];
  const pkgExtensions = Array.isArray(pkg?.pi?.extensions) ? pkg.pi.extensions : [];
  const settingsExtensions = Array.isArray(settings?.extensions) ? settings.extensions : [];
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
    skills: pkgSkills.length,
    themes: pkgThemes.length,
    extensions: pkgExtensions.length,
    package_extensions: pkgExtensions.map(safeName),
    settings_extensions: settingsExtensions.map(safeName),
    helix_command_pinned:
      pkgExtensions.includes("./extensions/helix-command.ts") &&
      settingsExtensions.includes("../extensions/helix-command.ts"),
  };
}

function structuralObjectiveGate(gate) {
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

function manualRunId(configId) {
  return `${configId}-manual`;
}

function cliInvocation(configId) {
  return `node tools/loop/helix-task-loop.mjs --config ${configId} --run-id ${manualRunId(configId)}`;
}

/** Providers named by a resolved staged cast (the SIGNAL the runner acts on) —
 * includes panel_roles judge/synthesizer, matching the runner's live guard. */
function castProviders(cast) {
  return allCastProviders(cast);
}

function castLiveStatus(cast) {
  const providers = castProviders(cast);
  const allMock = providers.length > 0 && providers.every((p) => p === "mock");
  return allMock ? "no-live (mock providers only)" : "live intent (transport unavailable)";
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
  }).map((model) => ({ provider: model.provider, model: model.model, reasoning: model.reasoning === true }));
}

function buildPreflight(configId, deps) {
  const resolved = resolveRunConfig(deps.runRegistry, configId);
  if (!resolved.ok) return { ok: false, code: resolved.code, detail: resolved.detail };

  // The ACTIVE profile's saved cast overlays the tracked config (assignments and
  // default assignment only - never chain/gate/run_target, by schema).
  let config = resolved.config;
  let profileApplied = null;
  const active = resolveActiveProfile(deps.root);
  if (!active.ok) return { ok: false, code: active.code, detail: active.detail };
  if (active.profile) {
    const applied = applyProfileToConfig(config, active.profile);
    config = applied.config;
    if (applied.overridden.length) profileApplied = { profile_id: active.profile_id, overridden: [...applied.overridden] };
  }

  // Preflight mirrors the STAGED runner (the engine that actually executes),
  // not the legacy task-loop: resolve the chain and the per-stage cast so the
  // Live signal, providers, and staged-runnability reflect what will run.
  const chainResult = resolveChain(deps.chainRegistry, config.chain);
  if (!chainResult.ok) return { ok: false, code: chainResult.code, detail: chainResult.detail, config, profile_applied: profileApplied };
  const chain = chainResult.chain;
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
  const castResult = resolveChainCast({
    chain,
    assignments: config.assignments ?? {},
    defaults: config.default_assignment ?? null,
    presets: profiledPresets.presets,
    toggles: deps.toggles ?? loadedSettings.settings.toggles,
    availability: inventoryAvailability(deps),
  });
  if (!castResult.ok) return { ok: false, code: castResult.code, detail: castResult.detail, config, profile_applied: profileApplied };

  const providers = castProviders(castResult.cast);
  if (providers.some((provider) => provider !== "mock")) {
    return {
      ok: false,
      code: "live-adapter-not-wired",
      detail: providers.find((provider) => provider !== "mock"),
      config,
      chain,
      cast: castResult.cast,
      profile_applied: profileApplied,
    };
  }

  return {
    ok: true,
    config,
    chain,
    cast: castResult.cast,
    cast_providers: providers,
    live_status: castLiveStatus(castResult.cast),
    warnings: [],
    cli: cliInvocation(config.id),
    profile_applied: profileApplied,
  };
}

function renderPreflight(preflight, requestedId) {
  if (!preflight.ok) {
    return fail(preflight.code, preflight.detail, "Helix run preflight refused");
  }
  const { config, chain, cast, warnings, cli } = preflight;
  const stageCast = cast.map((c) => `${c.stage_id}=${c.executor_ref}`).join(" ");
  return result({
    title: "Helix run preflight",
    lines: [
      `Config: ${config.id}`,
      `Chain: ${chain.id} (${chain.task_class}, ${chain.stages.length} stage(s))`,
      `Cast source: ${preflight.profile_applied ? `profile ${preflight.profile_applied.profile_id} (${preflight.profile_applied.overridden.join("+")})` : "tracked config"}`,
      `Cast: ${stageCast}`,
      `Assignments: ${config.assignments && Object.keys(config.assignments).length ? Object.entries(config.assignments).map(([stage, a]) => `${stage}=${assignmentLabel(a)}`).join(" ") : "(defaults)"}`,
      `Providers: ${preflight.cast_providers.join(", ")}`,
      `Live: ${preflight.live_status}`,
      `Objective gate: ${config.objective_gate.type}:${config.objective_gate.path}`,
      `Rail: max_iterations=${config.max_iterations}`,
      config.parallel
        ? `Parallel: max_concurrency=${config.parallel.max_concurrency}`
        : "Parallel: none",
      `Warnings: ${warnings.length ? warnings.join(", ") : "none"}`,
      `Run ID suggestion: ${manualRunId(config.id)}`,
      `CLI: ${cli}`,
      "",
      "The slash command does not launch the loop. Run the CLI command explicitly if you want execution.",
    ],
    details: {
      requested_config_id: requestedId,
      config_id: config.id,
      chain: summarizeChain(chain),
      cast: cast.map((c) => ({ stage_id: c.stage_id, executor_ref: c.executor_ref })),
      providers: preflight.cast_providers,
      objective_gate: structuralObjectiveGate(config.objective_gate),
      rail: {
        max_iterations: config.max_iterations,
        parallel: config.parallel ? { ...config.parallel } : null,
      },
      live_status: preflight.live_status,
      warnings,
      cli_invocation: cli,
      launches_loop: false,
    },
  });
}

function resolveDefaultConfigId(deps) {
  const active = resolveActiveProfile(deps.root);
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
    `Package/resources: skills=${resourceStatus(deps.packageJson, deps.settings).skills}, themes=${resourceStatus(deps.packageJson, deps.settings).themes}, extensions=${resourceStatus(deps.packageJson, deps.settings).extensions}`,
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
      resource_status: resourceStatus(deps.packageJson, deps.settings),
    },
  });
}

function renderModels(deps) {
  const matrix = deps.roleMatrix;
  const matrixShape = validateRoleMatrixConfig(matrix);
  if (!matrixShape.valid) return fail("invalid-role-matrix", "role-matrix-defaults", "Helix models refused");
  const presetsResult = loadPresets(deps);
  if (!presetsResult.ok) return fail(presetsResult.code, presetsResult.detail, "Helix models refused");
  const active = resolveActiveProfile(deps.root);
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
      "Change: /helix settings set <toggle> on|off",
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
    const switched = switchProfile(deps.root, id);
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
    const created = saveProfile(deps.root, { schema_version: 1, profile_id: id, overrides: {} });
    if (!created.ok) return fail(created.code, created.detail, "Helix profile create refused");
    return result({
      title: "Helix profile created",
      lines: [`Created empty profile '${id}'. Assemble its cast with /helix setup ${id} ...`],
      details: { profile_id: id, mutating: true },
      mutating: true,
    });
  }
  if (sub === "show") {
    const loaded = loadProfile(deps.root, id);
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
  const listed = listProfiles(deps.root);
  if (!listed.ok) return fail(listed.code, listed.detail, "Helix profiles refused");
  const active = resolveActiveProfile(deps.root);
  if (!active.ok) return fail(active.code, active.detail, "Helix profiles refused");
  return result({
    title: "Helix profiles",
    lines: [
      `Active: ${active.profile_id ?? "(none - tracked defaults)"}`,
      listed.profiles.length ? "Profiles:" : "Profiles: none (create one with /helix profiles create <id>)",
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
        "Create a profile first, then assemble its cast: /helix profiles create <id>; /helix setup <id> <stage>=<executor> ...",
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
        "Real-provider casts declare live intent but refuse as live-adapter-not-wired in this build.",
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
  const active = resolveActiveProfile(deps.root);
  if (!active.ok) return fail(active.code, active.detail, "Helix setup refused");
  const existing = loadProfile(deps.root, profileId);
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
  const activated = saveAndActivateProfile(deps.root, profile);
  if (!activated.ok) return fail(activated.code, activated.detail, "Helix setup refused");
  return result({
    title: "Helix setup saved",
    lines: [
      `Profile '${profileId}' saved and activated.`,
      ...Object.entries(assignments).map(([stage, a]) => `  ${stage} -> ${assignmentLabel(a)}`),
      ...Object.entries(presetOverlays).map(([presetId, overlay]) => `  ${presetId}: ${Object.keys(overlay.roles).length} role lineup(s)`),
      "",
      "Preflight it: /helix run",
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
  const eventsPath = join(deps.runsRoot, runId, `${runId}.events.jsonl`);
  if (!existsSync(eventsPath)) return fail("run-not-found", "run-events-not-found", "Helix run watch refused");
  let events;
  try {
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
  const resolvedConfig = resolveRunConfig(deps.runRegistry, runStart?.config_id);
  const resolvedChain = resolveChain(deps.chainRegistry, runStart?.chain_id);
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
  const stateShape = validateRunnerState(state, { runId });
  if (!stateShape.valid) return fail("invalid-resume-state", "state-structure", "Helix run resume refused");
  const resolvedConfig = resolveRunConfig(deps.runRegistry, state.config_id);
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
        `${entry.run_id}: ${entry.kind} ${entry.status} prune=${entry.prunable ? "available" : "non-prunable-flat-record"} iterations=${entry.iterations_run ?? "n/a"} tokens=${entry.total_tokens ?? "n/a"}`),
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
        `${entry.path}: ${entry.kind} ${entry.status} prune=${entry.prunable ? "available" : "non-prunable-flat-record"} stop=${entry.stop_reason ?? "n/a"} iterations=${entry.iterations_run ?? "n/a"} tokens=${entry.total_tokens ?? "n/a"}`),
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
  if (verb === "settings") return renderSettings(deps, tokens);
  if (verb === "profiles") return renderProfiles(deps, tokens);
  if (verb === "setup") return renderSetup(deps, tokens);
  if (verb === "research") return renderResearch(deps, tokens, ctx);
  return usage(verb);
}
