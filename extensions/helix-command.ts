/**
 * Helix's Pi-native command surface.
 *
 * Each user-facing capability has a discoverable `helix-*` slash command.
 * `/helix` remains the dashboard and accepts the legacy verb form so existing
 * sessions do not break, but help and completion lead with dedicated commands.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  executeHelixCommand,
  getHelixArgumentCompletions,
  isHelixMutationRequest,
  renderHelixRunCompletion,
  renderWorkflowRuntimeTest,
} from "./lib/helix-command-core.mjs";
import {
  loadOnboardingState,
  ONBOARDING_PAGES,
  saveOnboardingState,
} from "./lib/helix-onboarding.mjs";
import { createPiAgentAdapter } from "../dispatch/lib/pi-agent-adapter.mjs";
import { supportedPiEfforts } from "../dispatch/lib/pi-effort.mjs";
import { preflightObjectiveGate } from "../dispatch/lib/task-loop.mjs";
import {
  WORKFLOW_ROLE_BLOCKS,
  WORKFLOW_TEMPLATES,
  createWorkflowFromTemplate,
  isSafeWorkflowPath,
  objectiveGateSummary,
  testWorkflow,
  validateWorkflow,
} from "../dispatch/lib/workflows.mjs";
import { executeNamedWorkflow, resumeNamedWorkflow } from "./lib/helix-execution.mjs";
import { helixStateRoot } from "./lib/helix-paths.mjs";
import { builtInWorkflows, deleteUserWorkflow, resolveWorkflow, saveUserWorkflow, workflowCatalog } from "./lib/helix-workflows.mjs";
import { isHelixProvider } from "../dispatch/lib/providers.mjs";
import { isPublicCode } from "../dispatch/lib/public-values.mjs";
import { normalizeWorkflowDefinition, normalizeWorkflowInput } from "../dispatch/workflow/schema.mjs";
import { smokeTestWorkflowRuntime } from "./lib/helix-workflow-test.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

const PROVIDER_TO_HELIX: Record<string, string> = {
  "openai-codex": "openai-codex",
  openai: "openai-api",
  "openai-api": "openai-api",
  openrouter: "openrouter",
  "github-copilot": "github-copilot",
  "azure-foundry": "azure-foundry",
  mock: "mock",
};

const FEATURES = Object.freeze([
  { id: "multi-model", label: "Multi-model", description: "Use composite casts; off resolves a single model." },
  { id: "loops", label: "Loops", description: "Iterate until the objective gate passes; off runs one pass per stage." },
  { id: "autoresearch", label: "Autoresearch", description: "Enable attended metric-driven research runs." },
  { id: "context-engine", label: "Context engine", description: "Use fresh structural handoffs; off passes the transcript through." },
  { id: "worktree", label: "Worktrees", description: "Isolate mutations in Git worktrees; named workflows refuse while this is off." },
  { id: "visual-cues", label: "Visual cues", description: "Show rich run events; off keeps plain event lines." },
]);

type CoreResult = ReturnType<typeof executeHelixCommand>;
type CommandDefinition = {
  name: string;
  description: string;
  coreArgs: (args: string) => string;
  completions?: (prefix: string) => ReturnType<typeof getHelixArgumentCompletions>;
  onboardingUi?: boolean;
  settingsUi?: boolean;
  workflowCreatorUi?: boolean;
  workflowLifecycleUi?: "edit" | "clone" | "delete";
  resumeUi?: boolean;
};

function trimWithPrefix(prefix: string, args: string): string {
  const suffix = args.trim();
  return suffix ? `${prefix} ${suffix}` : prefix;
}

function runCompletions(prefix: string) {
  const items = getHelixArgumentCompletions(`run ${prefix}`) ?? [];
  const completions = new Map(items.map((item) => {
    const value = item.value.replace(/^run /, "");
    return [value, { ...item, value }];
  }));
  try {
    const catalog = workflowCatalog(
      helixStateRoot(),
      readRegistry("../dispatch/config/chains.json"),
      readRegistry("../dispatch/config/run-configs.json"),
    );
    if (catalog.ok) {
      const query = prefix.trimStart();
      for (const workflow of catalog.workflows) {
        if (workflow.id.startsWith(query)) {
          completions.set(workflow.id, {
            value: workflow.id,
            label: workflow.id,
            description: workflow.source === "user" ? "Personal Helix workflow" : "Built-in Helix workflow",
          });
        }
      }
    }
  } catch {
    // Built-in completion remains available when personal workflow state is unreadable.
  }
  return [...completions.values()];
}

function settingsCompletions(prefix: string) {
  const trimmed = prefix.trimStart();
  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1 && !trimmed.endsWith(" ")) {
    return FEATURES.filter((feature) => feature.id.startsWith(parts[0] ?? ""))
      .map((feature) => ({ value: `${feature.id} `, label: feature.id, description: feature.description }));
  }
  const valuePrefix = parts[1] ?? "";
  return ["on", "off"].filter((value) => value.startsWith(valuePrefix))
    .map((value) => ({ value: `${parts[0]} ${value}`, label: value, description: `Turn ${parts[0]} ${value}` }));
}

const COMMANDS: readonly CommandDefinition[] = Object.freeze([
  {
    name: "helix",
    description: "Open the Helix dashboard",
    coreArgs: (args) => args.trim(),
    completions: (prefix) => getHelixArgumentCompletions(prefix),
  },
  { name: "helix-help", description: "Show Helix commands and first steps", coreArgs: () => "help" },
  { name: "helix-onboarding", description: "Rerun the Helix getting-started tour", coreArgs: () => "help", onboardingUi: true },
  { name: "helix-run", description: "Preflight and start a Helix workflow", coreArgs: (args) => trimWithPrefix("run", args), completions: runCompletions },
  { name: "helix-runs", description: "List Helix run records", coreArgs: (args) => trimWithPrefix("runs", args || "list") },
  { name: "helix-run-status", description: "Inspect a Helix run", coreArgs: (args) => trimWithPrefix("runs status", args) },
  { name: "helix-run-watch", description: "Show current run progress", coreArgs: (args) => trimWithPrefix("runs watch", args) },
  { name: "helix-run-resume", description: "Resume an interrupted workflow", coreArgs: (args) => trimWithPrefix("runs resume", args), resumeUi: true },
  { name: "helix-run-prune", description: "Delete one run record", coreArgs: (args) => trimWithPrefix("runs prune", args) },
  { name: "helix-models", description: "Show casts and available models", coreArgs: () => "models" },
  { name: "helix-chains", description: "Show workflow chains", coreArgs: () => "chains" },
  { name: "helix-workflows", description: "List, inspect, and test named workflows", coreArgs: (args) => trimWithPrefix("workflows", args || "list") },
  {
    name: "helix-workflow-create",
    description: "Create a named workflow with a guided builder",
    coreArgs: (args) => trimWithPrefix("workflows create", args),
    workflowCreatorUi: true,
  },
  {
    name: "helix-workflow-edit",
    description: "Edit a user workflow in the guided builder",
    coreArgs: (args) => trimWithPrefix("workflows show", args),
    workflowLifecycleUi: "edit",
  },
  {
    name: "helix-workflow-clone",
    description: "Copy a user workflow under a new name",
    coreArgs: (args) => trimWithPrefix("workflows show", args),
    workflowLifecycleUi: "clone",
  },
  {
    name: "helix-workflow-delete",
    description: "Delete a user workflow",
    coreArgs: (args) => trimWithPrefix("workflows show", args),
    workflowLifecycleUi: "delete",
  },
  {
    name: "helix-settings",
    description: "Toggle Helix features",
    coreArgs: (args) => args.trim() ? `settings set ${args.trim()}` : "settings",
    completions: settingsCompletions,
    settingsUi: true,
  },
  { name: "helix-profiles", description: "Manage saved model casts", coreArgs: (args) => trimWithPrefix("profiles", args) },
  { name: "helix-setup", description: "Configure the active cast", coreArgs: (args) => trimWithPrefix("setup", args) },
  { name: "helix-research", description: "Preflight attended autoresearch", coreArgs: (args) => trimWithPrefix("research", args) },
]);

function commandNeedsInventory(args: string): boolean {
  const tokens = args.trim().split(/\s+/);
  const verb = tokens[0] ?? "";
  return verb === "" || ["run", "models", "setup"].includes(verb)
    || (verb === "workflows" && ["test", "import", "create"].includes(tokens[1] ?? ""));
}

async function availableModelInventory(args: string, ctx: ExtensionCommandContext) {
  if (!commandNeedsInventory(args) || typeof ctx.modelRegistry?.getAvailable !== "function") return null;
  try {
    const available = await ctx.modelRegistry.getAvailable();
    if (!Array.isArray(available)) return null;
    return available.flatMap((entry: any) => {
      const model = entry?.model && typeof entry.model === "object" ? entry.model : entry;
      const rawProvider = String(model?.provider ?? "");
      const provider = PROVIDER_TO_HELIX[rawProvider] ?? (isHelixProvider(rawProvider) ? rawProvider : null);
      if (!provider || typeof model?.id !== "string") return [];
      return [{
        provider,
        model: model.id,
        reasoning: model.reasoning === true,
        supported_efforts: supportedPiEfforts(model),
      }];
    });
  } catch {
    return null;
  }
}

async function confirmMutation(args: string, ctx: ExtensionCommandContext): Promise<boolean | undefined> {
  if (!isHelixMutationRequest(args)) return undefined;
  if (ctx.mode !== "tui" || typeof ctx.ui?.confirm !== "function") return undefined;
  return ctx.ui.confirm("Confirm Helix change", `Apply this change?\n\n${args}`);
}

function internalError(): CoreResult {
  return {
    ok: false,
    status: "fail-closed",
    code: "helix-command-internal-error",
    title: "Helix command refused",
    text: "Helix refusal: helix-command-internal-error\nReason: an unexpected internal error occurred.\nNext safe action: retry the command, or run /helix-help.",
    details: { code: "helix-command-internal-error", mutating: false },
  };
}

function sendOutput(pi: ExtensionAPI, out: CoreResult) {
  pi.sendMessage({
    customType: "helix-command",
    content: out.text,
    display: true,
    details: { title: out.title, status: out.status, code: out.code, ...out.details },
  }, { triggerTurn: false });
}

function sendProviderRefusal(pi: ExtensionAPI, code: string) {
  pi.sendMessage({
    customType: "helix-command",
    content: `Helix refusal: ${code}\nNo workflow state or model prompt was created.`,
    display: true,
    details: { title: "Helix provider preflight refused", status: "fail-closed", code },
  }, { triggerTurn: false });
}

function nextRunId(): string {
  return `helix-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function readRegistry(path: string) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

const WORKFLOW_PANEL_ROLES = [...WORKFLOW_ROLE_BLOCKS];
const WORKFLOW_CANDIDATE_ROLES = WORKFLOW_PANEL_ROLES.filter((role) => role !== "verifier");
const SAFE_STAGE_ID = /^[a-z][a-z0-9-]*$/;

function stageHasCandidate(stage: any) {
  return stage.steps.some((step: any) => step.kind === "role" && step.role !== "verifier");
}

function transitionSummary(rule: any) {
  const when = rule.when.type === "always"
    ? "always"
    : rule.when.type === "gate"
      ? `gate=${rule.when.is}`
      : `${rule.when.role}=${rule.when.is}`;
  return `${when} → ${rule.action}${rule.target ? ` ${rule.target}` : ""}`;
}

function suggestedObjectiveCommand(cwd?: string): { command: string; args: string[] } {
  const root = typeof cwd === "string" && cwd ? cwd : process.cwd();
  if (existsSync(`${root}/package.json`)) return { command: "npm", args: ["test"] };
  if (existsSync(`${root}/Cargo.toml`)) return { command: "cargo", args: ["test"] };
  if (existsSync(`${root}/pyproject.toml`)) return { command: "python", args: ["-m", "pytest"] };
  return { command: "git", args: ["diff", "--check"] };
}

async function chooseObjectiveGate(workflow: any, ctx: any) {
  const kind = await ctx.ui.select("How should Helix independently decide success?", [
    "Run a command (recommended)",
    "Check text in a stage output (weaker: the model writes the marker)",
  ]);
  if (!kind) return false;
  if (kind.startsWith("Run a command")) {
    const suggested = suggestedObjectiveCommand(ctx.cwd);
    const command = (await ctx.ui.input("Executable (no shell)", suggested.command))?.trim() ?? "";
    const argsText = (await ctx.ui.input("Arguments (space-separated; passed literally, no shell)", suggested.args.join(" ")))?.trim() ?? "";
    const timeout = await ctx.ui.select("Objective-check timeout", ["1 minute", "2 minutes (recommended)", "5 minutes", "10 minutes"]);
    if (!command || !timeout) return false;
    workflow.stop.objective_gate = {
      type: "command-exit-zero",
      command,
      args: argsText ? argsText.split(/\s+/) : [],
      timeout_ms: Number(timeout.split(" ")[0]) * 60_000,
    };
    return true;
  }
  const outputs = workflow.stages.map((stage: any) => stage.artifact?.path).filter(Boolean);
  const path = await ctx.ui.select("Stage output to check", [...new Set(outputs)]);
  const marker = path
    ? (await ctx.ui.input("Exact text that means success", "HELIX_WORKFLOW_PASS"))?.trim() ?? ""
    : "";
  if (!path || !marker) return false;
  workflow.stop.objective_gate = { type: "file-contains", path, contains: marker };
  ctx.ui.notify("File-text checks are model-writable; use a command check when the repository has one", "warning");
  return true;
}

async function chooseTransitionAction(workflow: any, stage: any, rule: any, ctx: any) {
  const earlier = workflow.stages.slice(0, workflow.stages.indexOf(stage));
  const choices = ["Advance", "Retry this stage", ...earlier.map((entry: any) => `Go back to ${entry.id}`), "Stop"];
  const selected = await ctx.ui.select("Choose the transition action", choices);
  if (!selected) return false;
  delete rule.target;
  delete rule.reason;
  if (selected === "Advance") rule.action = "advance";
  else if (selected === "Retry this stage") rule.action = "retry";
  else if (selected === "Stop") {
    const fallback = `stopped-by-${stage.id}`;
    const reason = (await ctx.ui.input(`Stable stop code (for example ${fallback})`))?.trim() || fallback;
    if (!isPublicCode(reason)) {
      ctx.ui.notify("Stop codes use letters, numbers, dot, underscore, colon, slash, or dash", "warning");
      return false;
    }
    rule.action = "stop";
    rule.reason = reason;
  } else {
    rule.action = "back";
    rule.target = selected.slice("Go back to ".length);
  }
  return true;
}

async function addStage(workflow: any, ctx: any) {
  const id = (await ctx.ui.input("New stage id (lowercase, hyphens allowed)"))?.trim() ?? "";
  if (!SAFE_STAGE_ID.test(id) || workflow.stages.some((stage: any) => stage.id === id)) {
    ctx.ui.notify("Stage id is invalid or already used", "warning");
    return;
  }
  const roles: string[] = [];
  while (true) {
    const available = (roles.length ? WORKFLOW_PANEL_ROLES : WORKFLOW_CANDIDATE_ROLES)
      .filter((role) => !roles.includes(role));
    const selected = await ctx.ui.select(
      roles.length ? "Add another panel role" : "Choose the first panel role",
      [...(roles.length ? ["Done adding roles"] : []), ...available],
    );
    if (!selected) return;
    if (selected === "Done adding roles") break;
    roles.push(selected);
    if (selected === "verifier" || available.length === 1) break;
  }
  const outputPath = (await ctx.ui.input("Durable output file for this stage", `${id}.md`))?.trim() ?? "";
  if (!isSafeWorkflowPath(outputPath)) {
    ctx.ui.notify("Output must be a safe repository-relative file path", "warning");
    return;
  }
  const outputKind = await ctx.ui.select("Durable output kind", ["plan", "brief", "notes"]);
  if (!outputKind) return;
  const maxChoice = await ctx.ui.select("Maximum passes for this stage", ["1", "2", "3 (recommended)", "5"]);
  if (!maxChoice) return;
  const family = await ctx.ui.select("What decides the next state?", [
    "Verdict from a panel role", "Objective gate result", "Always advance",
  ]);
  if (!family) return;
  let transitions: any[];
  if (family === "Verdict from a panel role") {
    const role = await ctx.ui.select("Which role routes the stage?", roles.filter((candidate) => candidate !== "verifier"));
    if (!role) return;
    transitions = [
      { when: { type: "verdict", role, is: "approve" }, action: "advance" },
      { when: { type: "verdict", role, is: "revise" }, action: "retry" },
      { when: { type: "verdict", role, is: "revise-jump" }, action: "retry" },
    ];
  } else if (family === "Objective gate result") {
    transitions = [
      { when: { type: "gate", is: "pass" }, action: "advance" },
      { when: { type: "gate", is: "fail" }, action: "retry" },
    ];
  } else {
    transitions = [{ when: { type: "always" }, action: "advance" }];
  }
  workflow.stages.push({
    id, label: id.replaceAll("-", " "), max_passes: Number(maxChoice.split(" ")[0]),
    steps: roles.map((role) => ({ id: role, kind: "role", role })), transitions,
    artifact: { path: outputPath, kind: outputKind },
  });
}

async function editStageRoles(workflow: any, ctx: any) {
  const id = await ctx.ui.select("Choose a stage panel", workflow.stages.map((stage: any) => stage.id));
  const stage = workflow.stages.find((entry: any) => entry.id === id);
  if (!stage) return;
  const action = await ctx.ui.select("Edit panel roles (read-only panels can run concurrently)", ["Add role", "Remove role"]);
  const roleSteps = stage.steps.filter((step: any) => step.kind === "role");
  if (action === "Add role") {
    const available = WORKFLOW_PANEL_ROLES.filter((role) => !roleSteps.some((step: any) => step.role === role));
    const role = await ctx.ui.select("Role to add", available);
    if (!role) return;
    const step = { id: role, kind: "role", role };
    const verifier = stage.steps.findIndex((candidate: any) => candidate.role === "verifier");
    if (role === "verifier" || verifier === -1) stage.steps.push(step);
    else stage.steps.splice(verifier, 0, step);
  } else if (action === "Remove role") {
    const candidateSteps = roleSteps.filter((step: any) => step.role !== "verifier");
    const role = await ctx.ui.select("Role to remove", roleSteps.map((step: any) => step.role));
    if (!role) return;
    if (role !== "verifier" && candidateSteps.length <= 1) {
      ctx.ui.notify("A runnable stage needs at least one candidate panel role", "warning");
      return;
    }
    if (stage.transitions.some((rule: any) => rule.when.role === role)) {
      ctx.ui.notify("Change the verdict routing before removing that role", "warning");
      return;
    }
    stage.steps = stage.steps.filter((step: any) => step.role !== role);
  }
}

async function editStageOutput(workflow: any, ctx: any) {
  const id = await ctx.ui.select("Choose a stage", workflow.stages.map((stage: any) => stage.id));
  const stage = workflow.stages.find((entry: any) => entry.id === id);
  if (!stage) return;
  const outputPath = (await ctx.ui.input("Durable output file", stage.artifact.path))?.trim() ?? "";
  if (!isSafeWorkflowPath(outputPath)) {
    ctx.ui.notify("Output must be a safe repository-relative file path", "warning");
    return;
  }
  const isOnlyGateOutput = workflow.stop.objective_gate.type === "file-contains"
    && stage.artifact.path === workflow.stop.objective_gate.path
    && workflow.stages.filter((entry: any) => entry.artifact.path === workflow.stop.objective_gate.path).length === 1;
  if (isOnlyGateOutput && outputPath !== workflow.stop.objective_gate.path) {
    ctx.ui.notify("At least one stage output must remain the objective gate file", "warning");
    return;
  }
  const outputKind = await ctx.ui.select("Durable output kind", ["plan", "brief", "notes"]);
  if (outputKind) stage.artifact = { path: outputPath, kind: outputKind };
}

async function editStageTransitions(workflow: any, ctx: any) {
  const id = await ctx.ui.select("Choose a stage", workflow.stages.map((stage: any) => stage.id));
  const stage = workflow.stages.find((entry: any) => entry.id === id);
  if (!stage) return;
  const action = await ctx.ui.select("Edit transition blocks", [
    "Change action", "Replace condition family", "Add condition", "Remove condition",
  ]);
  if (action === "Replace condition family") {
    const family = await ctx.ui.select("New condition family", [
      "Verdict from a panel role", "Objective gate result", "Always",
    ]);
    if (family === "Verdict from a panel role") {
      const roles = stage.steps.filter((step: any) => step.kind === "role" && step.role !== "verifier")
        .map((step: any) => step.role);
      const role = await ctx.ui.select("Routing role", roles);
      if (!role) return;
      stage.transitions = [
        { when: { type: "verdict", role, is: "approve" }, action: "advance" },
        { when: { type: "verdict", role, is: "revise" }, action: "retry" },
        { when: { type: "verdict", role, is: "revise-jump" }, action: "retry" },
      ];
    } else if (family === "Objective gate result") {
      stage.transitions = [
        { when: { type: "gate", is: "pass" }, action: "advance" },
        { when: { type: "gate", is: "fail" }, action: "retry" },
      ];
    } else if (family === "Always") {
      stage.transitions = [{ when: { type: "always" }, action: "advance" }];
    }
    return;
  }
  if (action === "Change action") {
    const label = await ctx.ui.select("Choose a condition", stage.transitions.map(transitionSummary));
    const rule = stage.transitions.find((candidate: any) => transitionSummary(candidate) === label);
    if (rule) await chooseTransitionAction(workflow, stage, rule, ctx);
    return;
  }
  if (action === "Remove condition") {
    if (stage.transitions.length <= 1) {
      ctx.ui.notify("A stage needs at least one transition", "warning");
      return;
    }
    const label = await ctx.ui.select("Condition to remove", stage.transitions.map(transitionSummary));
    stage.transitions = stage.transitions.filter((candidate: any) => transitionSummary(candidate) !== label);
    return;
  }
  const family = stage.transitions.find((rule: any) => rule.when.type !== "always")?.when.type ?? null;
  const choices = family === "verdict"
    ? ["approve", "revise", "revise-jump"]
    : family === "gate"
      ? ["pass", "fail"]
      : ["always"];
  const value = await ctx.ui.select("Condition to add", choices);
  if (!value) return;
  const routingRole = family === "verdict"
    ? stage.transitions.find((rule: any) => rule.when.type === "verdict")?.when.role
    : null;
  const rule: any = value === "always"
    ? { when: { type: "always" }, action: "advance" }
    : family === "verdict"
      ? { when: { type: "verdict", role: routingRole, is: value }, action: "advance" }
      : { when: { type: "gate", is: value }, action: "advance" };
  if (stage.transitions.some((candidate: any) => JSON.stringify(candidate.when) === JSON.stringify(rule.when))) {
    ctx.ui.notify("That condition already exists", "warning");
    return;
  }
  if (await chooseTransitionAction(workflow, stage, rule, ctx)) stage.transitions.push(rule);
}

async function editDeployment(workflow: any, ctx: any) {
  const action = await ctx.ui.select("Deployment settings", [
    "Default cast preset", "Stage cast preset", "Clear stage cast", "Maximum concurrency",
  ]);
  if (action === "Default cast preset") {
    const preset = await ctx.ui.select("Default preset", ["daily", "overlord"]);
    if (preset) workflow.deployment.default_assignment = { kind: "composite", preset };
  } else if (action === "Stage cast preset") {
    const stage = await ctx.ui.select("Stage", workflow.stages.map((entry: any) => entry.id));
    const preset = stage ? await ctx.ui.select("Preset", ["daily", "overlord"]) : null;
    if (stage && preset) workflow.deployment.assignments[stage] = { kind: "composite", preset };
  } else if (action === "Clear stage cast") {
    const stage = await ctx.ui.select("Stage override to clear", Object.keys(workflow.deployment.assignments));
    if (stage) delete workflow.deployment.assignments[stage];
  } else if (action === "Maximum concurrency") {
    const value = await ctx.ui.select("Maximum concurrent model calls", ["1", "2 (recommended)", "3", "4"]);
    if (value) workflow.deployment.parallel.max_concurrency = Number(value.split(" ")[0]);
  }
}

async function customizeWorkflow(workflow: any, ctx: any) {
  const backTargetsValid = (stages: any[]) => stages.every((stage, index) =>
    stage.transitions.every((rule: any) => rule.action !== "back"
      || stages.slice(0, index).some((candidate) => candidate.id === rule.target)));
  while (true) {
    const action = await ctx.ui.select("Workflow building blocks", [
      "Finish building", "Add stage", "Remove stage", "Move stage earlier", "Move stage later",
      "Edit stage panel roles", "Edit stage durable output", "Edit stage transitions", "Edit objective check", "Edit deployment", "Edit duration limits",
    ]);
    if (!action) {
      const discard = typeof ctx.ui.confirm === "function"
        ? await ctx.ui.confirm("Discard this draft?", "No changes have been saved.")
        : true;
      if (discard) return false;
      continue;
    }
    if (action === "Finish building") return true;
    if (action === "Add stage") await addStage(workflow, ctx);
    else if (action === "Remove stage") {
      if (workflow.stages.length <= 1) ctx.ui.notify("A workflow needs at least one stage", "warning");
      else {
        const id = await ctx.ui.select("Stage to remove", workflow.stages.map((stage: any) => stage.id));
        if (id) {
          if (workflow.stages.some((stage: any) => stage.transitions.some((rule: any) => rule.target === id))) {
            ctx.ui.notify("That stage is a back target; change the transition before removing it", "warning");
            continue;
          }
          const remaining = workflow.stages.filter((stage: any) => stage.id !== id);
          if (!remaining.every(stageHasCandidate)) {
            ctx.ui.notify("That removal would leave a stage without a candidate role", "warning");
            continue;
          }
          if (workflow.stop.objective_gate.type === "file-contains"
            && !remaining.some((stage: any) => stage.artifact.path === workflow.stop.objective_gate.path)) {
            ctx.ui.notify("At least one stage output must remain the objective gate file", "warning");
            continue;
          }
          workflow.stages = remaining;
          delete workflow.deployment.assignments[id];
        }
      }
    } else if (action === "Move stage earlier" || action === "Move stage later") {
      const id = await ctx.ui.select("Stage to move", workflow.stages.map((stage: any) => stage.id));
      const index = workflow.stages.findIndex((stage: any) => stage.id === id);
      const target = action === "Move stage earlier" ? index - 1 : index + 1;
      if (index >= 0 && target >= 0 && target < workflow.stages.length) {
        const reordered = [...workflow.stages];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        if (!reordered.every(stageHasCandidate)) {
          ctx.ui.notify("Every stage needs at least one candidate role", "warning");
        } else if (!backTargetsValid(reordered)) {
          ctx.ui.notify("That move would put a back target after its transition stage", "warning");
        } else workflow.stages = reordered;
      }
    } else if (action === "Edit stage panel roles") await editStageRoles(workflow, ctx);
    else if (action === "Edit stage durable output") await editStageOutput(workflow, ctx);
    else if (action === "Edit stage transitions") await editStageTransitions(workflow, ctx);
    else if (action === "Edit objective check") await chooseObjectiveGate(workflow, ctx);
    else if (action === "Edit deployment") await editDeployment(workflow, ctx);
    else if (action === "Edit duration limits") {
      const total = await ctx.ui.select("Whole-run deadline", ["5 minutes", "10 minutes (recommended)", "20 minutes", "60 minutes"]);
      const call = total ? await ctx.ui.select("Per-provider-call deadline", ["1 minute", "2 minutes (recommended)", "5 minutes"]) : null;
      if (total && call) {
        workflow.stop.max_runtime_ms = Number(total.split(" ")[0]) * 60_000;
        workflow.deployment.call_timeout_ms = Number(call.split(" ")[0]) * 60_000;
      }
    }
  }
}

function retargetWorkflow(workflow: any, id: string) {
  workflow.id = id;
  workflow.source = "user";
  workflow.deployment.chain_id = id;
  workflow.deployment.input_refs = [];
  workflow.deployment.claims_ref = `local-ref:claims/${id}`;
  workflow.deployment.evidence_ref = `local-ref:evidence/${id}`;
}

async function showWorkflowLifecycle(pi: ExtensionAPI, ctx: ExtensionCommandContext, mode: "edit" | "clone" | "delete", rawId: string) {
  if (ctx.mode !== "tui" || typeof ctx.ui?.select !== "function" || typeof ctx.ui?.confirm !== "function"
    || (mode !== "delete" && typeof ctx.ui?.input !== "function")) {
    ctx.ui?.notify?.("Workflow lifecycle changes require Pi TUI mode", "warning");
    return;
  }
  const chains = readRegistry("../dispatch/config/chains.json");
  const runs = readRegistry("../dispatch/config/run-configs.json");
  const catalog = workflowCatalog(helixStateRoot(), chains, runs);
  if (!catalog.ok) {
    ctx.ui.notify(`Workflows could not be loaded (${catalog.code})`, "error");
    return;
  }
  const userIds = catalog.workflows.filter((workflow: any) => workflow.source === "user").map((workflow: any) => workflow.id);
  const id = rawId.trim() || await ctx.ui.select("Choose a user workflow", userIds) || "";
  const resolved = resolveWorkflow(helixStateRoot(), id, chains, runs);
  if (!resolved.ok || resolved.workflow.source !== "user") {
    ctx.ui.notify("Choose an existing user workflow; built-ins are immutable", "warning");
    return;
  }
  if (mode === "delete") {
    if (!await ctx.ui.confirm(`Delete workflow ${id}?`, "This removes the personal workflow definition. Existing run records remain inspectable.")) return;
    const deleted = deleteUserWorkflow(helixStateRoot(), id);
    ctx.ui.notify(deleted.ok ? `Workflow ${id} deleted` : `Workflow was not deleted (${deleted.code})`, deleted.ok ? "info" : "error");
    return;
  }
  const workflow: any = structuredClone(resolved.workflow);
  let targetId = id;
  if (mode === "clone") {
    targetId = (await ctx.ui.input("New workflow name", `${id}-copy`))?.trim() ?? "";
    if (!targetId) return;
    retargetWorkflow(workflow, targetId);
  }
  if (!await customizeWorkflow(workflow, ctx)) {
    ctx.ui.notify(`Workflow ${id} unchanged`, "info");
    return;
  }
  const valid = validateWorkflow(workflow);
  const tested = valid.valid ? testWorkflow(workflow) : null;
  const gateReady = valid.valid ? preflightObjectiveGate(ctx.cwd ?? process.cwd(), workflow.stop.objective_gate) : null;
  if (!valid.valid || !tested?.ok || !gateReady?.ok) {
    const first = valid.errors?.[0];
    ctx.ui.notify(first
      ? `Workflow invalid at ${first.path}: ${first.message}`
      : !tested?.ok
        ? `Workflow test failed (${tested?.code})`
        : `Objective-check executable is unavailable (${workflow.stop.objective_gate.command})`, "error");
    return;
  }
  const preview = workflow.stages.map((stage: any) =>
    `${stage.id}: ${stage.transitions.map(transitionSummary).join("; ")}`).join("\n");
  if (!await ctx.ui.confirm(`${mode === "clone" ? "Save" : "Update"} workflow ${targetId}?`,
    `${preview}\n\nObjective check: ${objectiveGateSummary(workflow.stop.objective_gate)}\nDefinition transitions tested: ${tested.transitions_tested}/${tested.transitions_total}`)) return;
  const saved = saveUserWorkflow(helixStateRoot(), workflow, {
    replace: mode === "edit",
    builtInIds: builtInWorkflows(chains, runs).map((entry: any) => entry.id),
  });
  if (!saved.ok) {
    ctx.ui.notify(`Workflow was not saved (${saved.code})`, "error");
    return;
  }
  ctx.ui.notify(`Workflow ${targetId} ${mode === "clone" ? "created" : "updated"}`, "info");
  sendOutput(pi, executeHelixCommand(`workflows show ${targetId}`, { mode: "print" }));
}

async function showWorkflowCreator(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  if (ctx.mode !== "tui" || typeof ctx.ui?.select !== "function" || typeof ctx.ui?.input !== "function") {
    sendOutput(pi, executeHelixCommand("workflows list", { mode: ctx.mode }));
    return;
  }
  const templateLabel = await ctx.ui.select(
    "Choose a starting workflow",
    WORKFLOW_TEMPLATES.map((template) => `${template.label} — ${template.description}`),
  );
  if (!templateLabel) return;
  const template = WORKFLOW_TEMPLATES.find((entry) => templateLabel.startsWith(entry.label));
  if (!template) return;
  const id = (await ctx.ui.input("Workflow name", "my-workflow"))?.trim();
  if (!id) return;
  const primaryOutput = (await ctx.ui.input("Primary durable output file", "proposal.txt"))?.trim();
  if (!primaryOutput) return;
  const maxChoice = await ctx.ui.select("Maximum total stage passes", ["4", "6 (recommended)", "8", "12"]);
  if (!maxChoice) return;
  const created = createWorkflowFromTemplate({
    id,
    template: template.id,
    gate_path: primaryOutput,
    gate_contains: "HELIX_WORKFLOW_PASS",
    max_iterations: Number(maxChoice.split(" ")[0]),
  });
  if (!created.ok) {
    ctx.ui.notify(`Workflow could not be created (${created.code})`, "error");
    return;
  }
  const workflow: any = created.workflow;
  if (!await chooseObjectiveGate(workflow, ctx)) return;
  for (const stage of workflow.stages) {
    const passChoice = await ctx.ui.select(
      `${stage.label ?? stage.id}: maximum passes`,
      ["1", "2", "3 (recommended)", "5"],
    );
    if (!passChoice) return;
    stage.max_passes = Number(passChoice.split(" ")[0]);
    for (const transition of stage.transitions.filter((rule: any) =>
      rule.when.type === "verdict" && ["revise", "revise-jump"].includes(rule.when.is))) {
      const earlier = workflow.stages.slice(0, workflow.stages.indexOf(stage));
      const choices = ["Retry this stage", ...earlier.map((entry: any) => `Go back to ${entry.id}`), "Stop the workflow"];
      const action = await ctx.ui.select(
        `${stage.label ?? stage.id}: when ${transition.when.role} says ${transition.when.is}`,
        choices,
      );
      if (!action) return;
      delete transition.target;
      delete transition.reason;
      if (action === "Retry this stage") transition.action = "retry";
      else if (action === "Stop the workflow") {
        transition.action = "stop";
        transition.reason = `stopped-by-${stage.id}-${transition.when.is}`;
      } else {
        transition.action = "back";
        transition.target = action.slice("Go back to ".length);
      }
    }
    for (const transition of stage.transitions.filter((rule: any) => rule.when.type === "gate" && rule.action !== "advance")) {
      const action = await ctx.ui.select(
        `${stage.label ?? stage.id}: when the gate is ${transition.when.is}`,
        ["Retry this stage", "Stop the workflow"],
      );
      if (!action) return;
      if (action === "Stop the workflow") {
        transition.action = "stop";
        transition.reason = `stopped-by-${stage.id}-gate-${transition.when.is}`;
      }
    }
  }
  if (!await customizeWorkflow(workflow, ctx)) return;
  const valid = validateWorkflow(workflow);
  const tested = valid.valid ? testWorkflow(workflow) : null;
  const gateReady = valid.valid ? preflightObjectiveGate(ctx.cwd ?? process.cwd(), workflow.stop.objective_gate) : null;
  if (!valid.valid || !tested?.ok || !gateReady?.ok) {
    const first = valid.errors?.[0];
    ctx.ui.notify(first
      ? `Workflow invalid at ${first.path}: ${first.message}; no file was saved`
      : !tested?.ok
        ? `Workflow test failed (${tested?.code ?? "unknown"}); no file was saved`
        : `Objective-check executable is unavailable (${workflow.stop.objective_gate.command}); no file was saved`, "error");
    return;
  }
  const preview = workflow.stages.map((stage: any, index: number) =>
    `${index + 1}. ${stage.id} (max ${stage.max_passes})\n` +
    `   panel: ${stage.steps.filter((step: any) => step.kind === "role").map((step: any) => step.role).join(", ")}\n` +
    `   output: ${stage.artifact.path} (${stage.artifact.kind})\n` +
    stage.transitions.map((rule: any) => `   ${transitionSummary(rule)}`).join("\n"),
  ).join("\n");
  const approved = await ctx.ui.confirm(
    `Save workflow ${id}`,
    `${preview}\n\nDefault cast: ${workflow.deployment.default_assignment.preset}\nStage casts: ${Object.entries(workflow.deployment.assignments).map(([stage, assignment]: any) => `${stage}=${assignment.preset ?? assignment.model}`).join(", ") || "none"}\nConcurrency: ${workflow.deployment.parallel.max_concurrency} (read-only panels only; writer stages serialize)\nTarget: ${workflow.deployment.run_target.repo}${workflow.deployment.run_target.ref ? ` (${workflow.deployment.run_target.ref})` : ""}\nGlobal maximum: ${workflow.stop.max_iterations}\nRuntime: ${workflow.stop.max_runtime_ms}ms total; ${workflow.deployment.call_timeout_ms}ms per call\nObjective check: ${objectiveGateSummary(workflow.stop.objective_gate)}\nDefinition transitions tested: ${tested.transitions_tested}/${tested.transitions_total}\nRuntime effects: not executed\nSimulation: ${tested.simulation.stop_reason}`,
  );
  if (!approved) return;
  const chains = readRegistry("../dispatch/config/chains.json");
  const runs = readRegistry("../dispatch/config/run-configs.json");
  const saved = saveUserWorkflow(helixStateRoot(), workflow, {
    builtInIds: builtInWorkflows(chains, runs).map((entry: any) => entry.id),
  });
  if (!saved.ok) {
    ctx.ui.notify(`Workflow was not saved (${saved.code})`, "error");
    return;
  }
  ctx.ui.notify(`Workflow ${id} saved; transitions tested ${tested.transitions_tested}/${tested.transitions_total}`, "info");
  sendOutput(pi, executeHelixCommand(`workflows show ${id}`, { mode: "print" }));
}

function parseRunArgs(args: string) {
  const separator = args.indexOf(" -- ");
  return separator === -1
    ? { workflowId: args.trim(), task: "" }
    : { workflowId: args.slice(0, separator).trim(), task: args.slice(separator + 4).trim() };
}

function parseWorkflowInputValue(raw: string, schema: any) {
  if (schema.type === "string") return raw === '""' ? "" : raw;
  if (schema.type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error("boolean");
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) throw new Error("number");
    const value = JSON.parse(raw);
    if (!Number.isFinite(value) || (schema.type === "integer" && !Number.isSafeInteger(value))) throw new Error("number");
    return value;
  }
  return JSON.parse(raw);
}

async function collectWorkflowInput(ctx: ExtensionCommandContext, workflow: any, task: string) {
  const normalized = normalizeWorkflowDefinition(workflow);
  if (!normalized.ok) return { ok: false, code: normalized.code };
  const input: Record<string, any> = { task };
  for (const [key, schema] of Object.entries(normalized.definition.inputs.properties) as Array<[string, any]>) {
    if (key === "task") continue;
    const hasDefault = Object.hasOwn(schema, "default");
    const required = normalized.definition.inputs.required.includes(key);
    const defaultText = hasDefault ? (JSON.stringify(schema.default) ?? "declared") : "";
    const defaultHint = hasDefault
      ? `, default ${defaultText.length <= 64 ? defaultText : "declared"}; leave blank to use it`
      : required ? ", required" : ", optional; leave blank to omit";
    const stringHint = schema.type === "string" ? "; spaces are preserved; enter \"\" for an empty string" : "";
    const raw = await ctx.ui.input?.(`Workflow input '${key}' (${schema.type}${defaultHint}${stringHint}${schema.description ? `: ${schema.description}` : ""})`);
    if (raw == null || raw === "" || (schema.type !== "string" && raw.trim() === "")) {
      if (hasDefault) {
        input[key] = structuredClone(schema.default);
        continue;
      }
      if (required) return { ok: false, code: `workflow-input-required:${key}` };
      continue;
    }
    try { input[key] = parseWorkflowInputValue(schema.type === "string" ? raw : raw.trim(), schema); }
    catch { return { ok: false, code: `workflow-input-invalid:${key}` }; }
  }
  const checked = normalizeWorkflowInput(normalized.definition.inputs, input);
  return checked.valid ? { ok: true, input: checked.input } : { ok: false, code: "workflow-input-invalid" };
}

function confirmationCastLines(cast: any): string[] {
  if (!Array.isArray(cast)) return ["  unavailable"];
  return cast.flatMap((stage: any) => {
    const lines = [`  ${stage.stage_id} [${stage.executor_ref}]`];
    for (const [role, members] of Object.entries(stage.roles ?? {})) {
      for (const member of Array.isArray(members) ? members : []) {
        lines.push(`    ${role}: ${member.provider}/${member.model}:${member.effort} x${member.instances}`);
      }
    }
    for (const [role, member] of Object.entries(stage.panel_roles ?? {})) {
      if (member && typeof member === "object") {
        const typed = member as any;
        lines.push(`    ${role} (panel): ${typed.provider}/${typed.model}:${typed.effort} x${typed.instances}`);
      }
    }
    return lines;
  });
}

function confirmationCastSpecs(cast: any): any[] {
  if (!Array.isArray(cast)) return [];
  return cast.flatMap((stage: any) => [
    ...Object.entries(stage.roles ?? {}).flatMap(([role, members]: any) =>
      (Array.isArray(members) ? members : []).map((member: any) => ({ ...member, role }))),
    ...Object.entries(stage.panel_roles ?? {}).flatMap(([role, member]: any) =>
      member && typeof member === "object" ? [{ ...member, role }] : []),
  ]).filter((member: any) => member.provider !== "mock");
}

async function runWorkflow(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string) {
  if (ctx.mode !== "tui" || typeof ctx.ui?.confirm !== "function") {
    sendOutput(pi, executeHelixCommand("run " + parseRunArgs(args).workflowId, { mode: ctx.mode }));
    return;
  }
  let { workflowId, task } = parseRunArgs(args);
  if (!workflowId) {
    const catalog = executeHelixCommand("workflows list", { mode: "print" });
    const ids = Array.isArray(catalog.details?.workflows)
      ? catalog.details.workflows.map((workflow: any) => String(workflow.id))
      : [];
    workflowId = await ctx.ui.select("Choose a workflow", ids) ?? "";
    if (!workflowId) return;
  }
  const registries = {
    chains: readRegistry("../dispatch/config/chains.json"),
    runs: readRegistry("../dispatch/config/run-configs.json"),
  };
  const named = resolveWorkflow(helixStateRoot(), workflowId, registries.chains, registries.runs);
  if (!named.ok) {
    ctx.ui.notify(`Workflow is unavailable (${named.code})`, "error");
    return;
  }
  if (!task) task = (await ctx.ui.input?.("What should this workflow do?"))?.trim() ?? "";
  if (!task) {
    ctx.ui.notify("A workflow task is required; nothing was started", "warning");
    return;
  }
  const collected = await collectWorkflowInput(ctx, named.workflow, task);
  if (!collected.ok) {
    ctx.ui.notify(`Workflow input refused (${collected.code}); nothing was started`, "warning");
    return;
  }
  const modelInventory = await availableModelInventory(`run ${workflowId}`, ctx);
  const preflight = executeHelixCommand(`run ${workflowId}`, { mode: ctx.mode }, { modelInventory, cwd: ctx.cwd });
  sendOutput(pi, preflight);
  if (!preflight.ok) return;
  const configId = String(preflight.details?.config_id ?? workflowId);
  const providers = Array.isArray(preflight.details?.providers) ? preflight.details.providers : [];
  const worktreeEnabled = preflight.details?.worktree_enabled !== false;
  const maxRuntimeMs = Number(preflight.details?.runtime_limits?.max_runtime_ms);
  const callTimeoutMs = Number(preflight.details?.runtime_limits?.call_timeout_ms);
  const executionBindingRef = String(preflight.details?.execution_binding_ref ?? "");
  const gate = named.ok
    ? objectiveGateSummary(named.workflow.schema_version === 4 ? named.workflow.objective_gate : named.workflow.stop.objective_gate)
    : "unavailable";
  const inputNames = Object.keys(collected.input).sort().join(", ");
  const exactCast = confirmationCastLines(preflight.details?.cast).join("\n");
  const realProviders = providers.filter((provider: string) => provider !== "mock");
  let adapter: any = null;
  let exactBindings: any[] = [];
  let expectedExactRef: string | null = null;
  if (realProviders.length > 0) {
    adapter = createPiAgentAdapter({
      modelRegistry: ctx.modelRegistry,
      signal: ctx.signal,
      callTimeoutMs,
      exactMode: true,
      ...((pi as any).helixSessionFactory ? { sessionFactory: (pi as any).helixSessionFactory } : {}),
    });
    if (preflight.details?.require_live_certification === true && adapter.liveCertification !== true) {
      sendProviderRefusal(pi, "provider-live-certification-required");
      return;
    }
    const exact = await adapter.preflightExact(confirmationCastSpecs(preflight.details?.cast), { signal: ctx.signal });
    if (!exact.ok) {
      sendProviderRefusal(pi, exact.code ?? "provider-exact-preflight-failed");
      return;
    }
    exactBindings = exact.bindings;
    expectedExactRef = exact.binding_ref;
  }
  const routing = exactBindings.length > 0
    ? exactBindings.map((binding: any) =>
      `  ${binding.provider}/${binding.model}:${binding.effort} via ${binding.route} account ${binding.account_ref.slice(0, 19)}…`).join("\n")
    : "  mock-only";
  const approved = await ctx.ui.confirm(
    "Start Helix workflow",
    `Workflow: ${configId}\nStages: ${preflight.details?.chain?.stages?.map((stage: any) => stage.id).join(" → ")}\nExact cast:\n${exactCast}\nExact routing:\n${routing}\nProviders: ${providers.join(", ")}\nObjective check: ${gate}\nMaximum passes: ${preflight.details?.rail?.max_iterations}\nRuntime: ${maxRuntimeMs}ms total; ${callTimeoutMs}ms per provider call\nTask: ${task}\nBound inputs: ${inputNames}\nRepository: ${ctx.cwd}\nIsolation: ${worktreeEnabled ? "per-run Git worktree" : "unavailable"}\n\nPi tools use the normal Pi trust boundary. A worktree protects Git state; it is not an OS sandbox.`,
  );
  if (!approved) {
    ctx.ui.notify("Helix run cancelled; no workflow was started", "info");
    return;
  }

  const runId = nextRunId();
  ctx.ui.setWorkingMessage?.(`Helix is running ${configId}`);
  ctx.ui.setWorkingVisible?.(true);
  let execution: any;
  const runAbort = new AbortController();
  let runAbortCode: string | null = null;
  const cancelRun = () => {
    runAbortCode ??= "workflow-run-cancelled";
    runAbort.abort(runAbortCode);
  };
  ctx.signal?.addEventListener?.("abort", cancelRun, { once: true });
  const runTimer = setTimeout(() => {
    runAbortCode ??= "workflow-run-timeout";
    runAbort.abort(runAbortCode);
  }, maxRuntimeMs);
  try {
    execution = await executeNamedWorkflow({
      workflow_id: workflowId,
      task,
      input: collected.input,
      run_id: runId,
      cwd: ctx.cwd,
      state_root: helixStateRoot(),
      package_root: PACKAGE_ROOT,
      chain_registry: registries.chains,
      run_registry: registries.runs,
      adapter,
      expected_binding_ref: executionBindingRef,
      expected_exact_ref: expectedExactRef,
      signal: runAbort.signal,
      onEvent(event: any) {
        if (event.kind === "pass-start") {
          ctx.ui.setWorkingMessage?.(`Helix · ${event.stage_id} · pass ${event.pass}/${event.of}`);
        } else if (event.kind === "node-start") {
          ctx.ui.setWorkingMessage?.(`Helix · ${event.node_id} · visit ${event.visit}`);
        } else if (event.kind === "gate") {
          ctx.ui.setWorkingMessage?.(`Helix · objective check ${event.result}`);
        } else if (event.kind === "blocked") {
          ctx.ui.setWorkingMessage?.(`Helix · blocked · ${event.code}`);
        }
      },
    });
    if (!execution.ok && runAbortCode) execution.code = runAbortCode;
    else if (!execution.ok && execution.code === "kernel-run-deadline-exceeded") execution.code = "workflow-run-timeout";
    else if (!execution.ok && !execution.code && adapter?.lastFailureCode?.()) execution.code = adapter.lastFailureCode();
  } catch {
    execution = { ok: false, code: "helix-runner-failed", converged: false, stop_reason: null };
  } finally {
    clearTimeout(runTimer);
    ctx.signal?.removeEventListener?.("abort", cancelRun);
    ctx.ui.setWorkingVisible?.(false);
    ctx.ui.setWorkingMessage?.();
  }
  sendOutput(pi, renderHelixRunCompletion({
    runId,
    configId,
    exitCode: execution.ok ? 0 : 1,
    converged: execution.converged === true,
    stopReason: execution.stop_reason,
    failureCode: execution.ok ? null : execution.code,
    resumable: execution.resumable === true,
    hasRunRecord: typeof execution.state_path === "string",
  }));
}

async function resumeWorkflow(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string) {
  const runId = args.trim();
  if (!runId || /\s/.test(runId)) {
    sendOutput(pi, executeHelixCommand(`runs resume ${runId}`, { mode: ctx.mode }));
    return;
  }
  const resumable = executeHelixCommand(`runs resume ${runId}`, { mode: ctx.mode });
  sendOutput(pi, resumable);
  if (!resumable.ok || resumable.details?.completed === true || resumable.details?.in_process_resume !== true) return;
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Resume must run in an attended Pi TUI", "warning");
    return;
  }
  const task = (await ctx.ui.input?.("Re-enter the original workflow task"))?.trim() ?? "";
  if (!task) {
    ctx.ui.notify("The original task is required; the interrupted run was not changed", "warning");
    return;
  }
  const workflowId = String(resumable.details.workflow_id ?? "");
  const registries = {
    chains: readRegistry("../dispatch/config/chains.json"),
    runs: readRegistry("../dispatch/config/run-configs.json"),
  };
  const named = resolveWorkflow(helixStateRoot(), workflowId, registries.chains, registries.runs);
  if (!named.ok) {
    ctx.ui.notify(`Workflow is unavailable (${named.code})`, "error");
    return;
  }
  const collected = await collectWorkflowInput(ctx, named.workflow, task);
  if (!collected.ok) {
    ctx.ui.notify(`Workflow input refused (${collected.code}); the checkpoint was not changed`, "warning");
    return;
  }
  const modelInventory = await availableModelInventory(`run ${workflowId}`, ctx);
  const preflight = executeHelixCommand(`run ${workflowId}`, { mode: ctx.mode }, { modelInventory, cwd: ctx.cwd });
  sendOutput(pi, preflight);
  if (!preflight.ok) return;
  const providers = Array.isArray(preflight.details?.providers) ? preflight.details.providers : [];
  const callTimeoutMs = Number(preflight.details?.runtime_limits?.call_timeout_ms);
  const realProviders = providers.filter((provider: string) => provider !== "mock");
  let adapter: any = null;
  let exactBindings: any[] = [];
  let expectedExactRef: string | null = null;
  if (realProviders.length > 0) {
    adapter = createPiAgentAdapter({
      modelRegistry: ctx.modelRegistry,
      signal: ctx.signal,
      callTimeoutMs,
      exactMode: true,
      ...((pi as any).helixSessionFactory ? { sessionFactory: (pi as any).helixSessionFactory } : {}),
    });
    if (preflight.details?.require_live_certification === true && adapter.liveCertification !== true) {
      sendProviderRefusal(pi, "provider-live-certification-required");
      return;
    }
    const exact = await adapter.preflightExact(confirmationCastSpecs(preflight.details?.cast), { signal: ctx.signal });
    if (!exact.ok) {
      sendProviderRefusal(pi, exact.code ?? "provider-exact-preflight-failed");
      return;
    }
    exactBindings = exact.bindings;
    expectedExactRef = exact.binding_ref;
  }
  const routing = exactBindings.length > 0
    ? exactBindings.map((binding: any) =>
      `  ${binding.provider}/${binding.model}:${binding.effort} via ${binding.route} account ${binding.account_ref.slice(0, 19)}…`).join("\n")
    : "  mock-only";
  const approved = await ctx.ui.confirm(
    "Resume Helix workflow",
    `Run: ${runId}\nWorkflow: ${workflowId}\nExact cast:\n${confirmationCastLines(preflight.details?.cast).join("\n")}\nExact routing:\n${routing}\nProviders: ${providers.join(", ")}\nTask: ${task}\n\nHelix will verify the task hash, workflow version, provider binding, private checkpoint, and retained worktree before continuing.`,
  );
  if (!approved) {
    ctx.ui.notify("Helix resume cancelled; the checkpoint was not changed", "info");
    return;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort("workflow-run-cancelled");
  ctx.signal?.addEventListener?.("abort", cancel, { once: true });
  ctx.ui.setWorkingVisible?.(true);
  ctx.ui.setWorkingMessage?.(`Helix · resuming ${runId}`);
  let execution: any;
  try {
    execution = await resumeNamedWorkflow({
      run_id: runId,
      task,
      input: collected.input,
      cwd: ctx.cwd,
      state_root: helixStateRoot(),
      package_root: PACKAGE_ROOT,
      chain_registry: registries.chains,
      run_registry: registries.runs,
      adapter,
      expected_binding_ref: String(preflight.details?.execution_binding_ref ?? ""),
      expected_exact_ref: expectedExactRef,
      signal: controller.signal,
      onEvent(event: any) {
        if (event.kind === "node-start") ctx.ui.setWorkingMessage?.(`Helix · ${event.node_id} · visit ${event.visit}`);
      },
    });
    if (!execution.ok && execution.code === "kernel-run-deadline-exceeded") {
      execution.code = "workflow-run-timeout";
    }
  } catch {
    execution = { ok: false, code: "helix-resume-failed", converged: false, stop_reason: null };
  } finally {
    ctx.signal?.removeEventListener?.("abort", cancel);
    ctx.ui.setWorkingVisible?.(false);
    ctx.ui.setWorkingMessage?.();
  }
  sendOutput(pi, renderHelixRunCompletion({
    runId,
    configId: workflowId,
    exitCode: execution.ok ? 0 : 1,
    converged: execution.converged === true,
    stopReason: execution.stop_reason,
    failureCode: execution.ok ? null : execution.code,
    resumable: execution.resumable === true,
    hasRunRecord: typeof execution.state_path === "string",
  }));
}

async function testWorkflowCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string) {
  const tokens = args.trim().split(/\s+/);
  const id = tokens[1] ?? "";
  if (!id || tokens[0] !== "test" || tokens.length !== 2) return false;
  const modelInventory = await availableModelInventory(`workflows test ${id}`, ctx);
  const checked = executeHelixCommand(`workflows test ${id}`, { mode: ctx.mode }, { modelInventory, cwd: ctx.cwd });
  sendOutput(pi, checked);
  if (!checked.ok || ctx.mode !== "tui" || typeof ctx.ui?.confirm !== "function") return true;
  const chains = readRegistry("../dispatch/config/chains.json");
  const runs = readRegistry("../dispatch/config/run-configs.json");
  const resolved = resolveWorkflow(helixStateRoot(), id, chains, runs);
  if (!resolved.ok) return true;
  const approved = await ctx.ui.confirm(
    `Run isolated runtime smoke test for ${id}?`,
    "Helix will normalize the definition to v4, execute one deterministic path through the real Workflow Kernel in a temporary detached Git worktree, simulate agent and objective effects, and remove the worktree. No provider is called and this does not claim the task-specific objective passes or every branch was covered.",
  );
  if (!approved) {
    ctx.ui.notify("Runtime smoke test skipped; definition and deployment checks remain valid", "info");
    return true;
  }
  ctx.ui.setWorkingMessage?.(`Helix · runtime smoke · ${id}`);
  ctx.ui.setWorkingVisible?.(true);
  let outcome;
  try {
    const normalized = normalizeWorkflowDefinition(resolved.workflow);
    const childDefinitions = normalized.ok ? Object.values(normalized.definition.nodes)
      .filter((node: any) => node.kind === "subworkflow")
      .map((node: any) => resolveWorkflow(helixStateRoot(), node.workflow_id, chains, runs))
      .filter((child: any) => child.ok)
      .map((child: any) => child.workflow) : [];
    outcome = await smokeTestWorkflowRuntime({
      workflow: resolved.workflow,
      subworkflows: childDefinitions,
      cwd: ctx.cwd,
      package_root: PACKAGE_ROOT,
      signal: ctx.signal,
      onEvent(event: any) {
        if (event.kind === "node-start") ctx.ui.setWorkingMessage?.(`Helix smoke · ${event.node_id} · visit ${event.visit}`);
      },
    });
  } catch {
    outcome = { ok: false, code: "workflow-runtime-smoke-failed" };
  } finally {
    ctx.ui.setWorkingVisible?.(false);
    ctx.ui.setWorkingMessage?.();
  }
  sendOutput(pi, renderWorkflowRuntimeTest({ workflowId: id, outcome }));
  return true;
}

function clip(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function wrap(text: string, width: number): string[] {
  if (width <= 1) return [clip(text, width)];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > width) {
      const candidate = remaining.slice(0, width + 1);
      const split = candidate.lastIndexOf(" ");
      const cut = split > 0 ? split : width;
      lines.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
}

type OnboardingContext = ExtensionCommandContext | ExtensionContext;
type OnboardingTourResult = "completed" | "later";

async function showOnboardingTour(ctx: OnboardingContext): Promise<OnboardingTourResult> {
  return ctx.ui.custom<OnboardingTourResult>((tui, theme, keybindings, done) => {
    let pageIndex = 0;
    return {
      render(width: number) {
        const contentWidth = Math.max(1, width - 4);
        const page = ONBOARDING_PAGES[pageIndex];
        const isLast = pageIndex === ONBOARDING_PAGES.length - 1;
        const lines = [
          theme.fg("accent", theme.bold(clip(`Helix onboarding · ${pageIndex + 1}/${ONBOARDING_PAGES.length}`, contentWidth))),
          "",
          theme.fg("text", theme.bold(clip(page.title, contentWidth))),
          "",
        ];
        page.body.forEach((paragraph, index) => {
          lines.push(...wrap(paragraph, contentWidth).map((line) => theme.fg("text", line)));
          if (index < page.body.length - 1) lines.push("");
        });
        lines.push("");
        lines.push(...wrap(
          isLast
            ? "↑ previous · enter finish · esc later"
            : "↑ previous · ↓/enter next · esc later",
          contentWidth,
        ).map((line) => theme.fg("dim", line)));
        return lines.map((line) => `  ${line}`);
      },
      invalidate() {},
      handleInput(data: string) {
        if (keybindings.matches(data, "tui.select.up")) {
          pageIndex = Math.max(0, pageIndex - 1);
        } else if (keybindings.matches(data, "tui.select.down")) {
          pageIndex = Math.min(ONBOARDING_PAGES.length - 1, pageIndex + 1);
        } else if (keybindings.matches(data, "tui.select.confirm")) {
          if (pageIndex === ONBOARDING_PAGES.length - 1) {
            done("completed");
            return;
          }
          pageIndex += 1;
        } else if (keybindings.matches(data, "tui.select.cancel")) {
          done("later");
          return;
        }
        tui.requestRender();
      },
    };
  });
}

function persistOnboardingChoice(ctx: OnboardingContext, status: "completed" | "dismissed"): boolean {
  const saved = saveOnboardingState(helixStateRoot(), status);
  if (!saved.ok) {
    ctx.ui.notify("Helix onboarding choice could not be saved; run /helix-onboarding to retry", "warning");
    return false;
  }
  return true;
}

async function runOnboarding(ctx: OnboardingContext) {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Open Pi in TUI mode to run /helix-onboarding", "warning");
    return;
  }
  const result = await showOnboardingTour(ctx);
  if (result === "completed" && persistOnboardingChoice(ctx, "completed")) {
    ctx.ui.notify("Helix onboarding complete · open /helix-help any time", "info");
  } else if (result === "later") {
    ctx.ui.notify("Helix onboarding deferred · run /helix-onboarding any time", "info");
  }
}

async function maybeShowFirstRunOnboarding(ctx: ExtensionContext) {
  if (ctx.mode !== "tui") return;
  const state = loadOnboardingState(helixStateRoot());
  if (!state.ok) {
    ctx.ui.notify("Helix onboarding state is unreadable · fix or remove onboarding.json in Helix state, then retry", "warning");
    return;
  }
  if (state.status !== "unseen") return;

  const choice = await ctx.ui.select("Welcome to Helix", [
    "Start the 4-step tour",
    "Later",
    "Don't show again",
  ]);
  if (choice === "Start the 4-step tour") {
    await runOnboarding(ctx);
  } else if (choice === "Don't show again") {
    if (persistOnboardingChoice(ctx, "dismissed")) {
      ctx.ui.notify("Helix onboarding hidden · run /helix-onboarding any time", "info");
    }
  } else {
    ctx.ui.notify("Helix onboarding deferred · it will return on the next Pi startup", "info");
  }
}

async function showSettings(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const initial = executeHelixCommand("settings", { mode: ctx.mode });
  if (!initial.ok || !initial.details?.toggles) {
    sendOutput(pi, initial);
    return;
  }

  const toggles = { ...initial.details.toggles } as Record<string, boolean>;
  await ctx.ui.custom((tui, theme, keybindings, done) => {
    let selected = 0;
    return {
      render(width: number) {
        const contentWidth = Math.max(1, width - 4);
        const lines = [theme.fg("accent", theme.bold(clip("Helix features", contentWidth))), ""];
        FEATURES.forEach((feature, index) => {
          const marker = index === selected ? "›" : " ";
          const checked = toggles[feature.id] ? "x" : " ";
          const text = clip(`${marker} [${checked}] ${feature.label}`, contentWidth);
          lines.push(index === selected
            ? theme.bg("selectedBg", theme.fg("accent", text))
            : theme.fg(toggles[feature.id] ? "text" : "muted", text));
        });
        lines.push("");
        lines.push(...wrap(FEATURES[selected]?.description ?? "", contentWidth).map((line) => theme.fg("muted", line)));
        lines.push("");
        lines.push(theme.fg("dim", clip("↑↓ navigate · enter/space toggle · esc close", contentWidth)));
        return lines.map((line) => `  ${line}`);
      },
      invalidate() {},
      handleInput(data: string) {
        if (keybindings.matches(data, "tui.select.up")) {
          selected = selected === 0 ? FEATURES.length - 1 : selected - 1;
        } else if (keybindings.matches(data, "tui.select.down")) {
          selected = selected === FEATURES.length - 1 ? 0 : selected + 1;
        } else if (keybindings.matches(data, "tui.select.confirm") || data === " ") {
          const feature = FEATURES[selected];
          if (feature) {
            const enabled = !toggles[feature.id];
            const out = executeHelixCommand(
              `settings set ${feature.id} ${enabled ? "on" : "off"}`,
              { mode: "tui", confirm: true },
            );
            if (out.ok) {
              toggles[feature.id] = enabled;
              ctx.ui.notify(`${feature.label} ${enabled ? "enabled" : "disabled"}`, "info");
            } else {
              ctx.ui.notify(`${feature.label} was not changed (${out.code ?? "refused"})`, "error");
            }
          }
        } else if (keybindings.matches(data, "tui.select.cancel")) {
          done(undefined);
          return;
        }
        tui.requestRender();
      },
    };
  });
}

export default function helixCommand(pi: ExtensionAPI) {
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("helix-command", (message, _options, theme) => {
      const details = message.details as { title?: string; status?: string } | undefined;
      const title = details?.title ?? "Helix";
      const color = details?.status === "fail-closed" ? "error" : details?.status === "cancelled" ? "warning" : "accent";
      return {
        render(width: number) {
          const contentWidth = Math.max(1, width - 4);
          return [
            `  ${theme.fg(color, theme.bold(clip(title, contentWidth)))}`,
            ...wrap(String(message.content ?? ""), contentWidth).map((line) => `  ${theme.fg("text", line)}`),
          ];
        },
        invalidate() {},
      };
    });
  }

  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup") return;
    try {
      await maybeShowFirstRunOnboarding(ctx);
    } catch {
      ctx.ui.notify("Helix onboarding could not open · run /helix-onboarding to retry", "warning");
    }
  });

  for (const command of COMMANDS) {
    pi.registerCommand(command.name, {
      description: command.description,
      ...(command.completions ? { getArgumentCompletions: command.completions } : {}),
      async handler(args: string, ctx: ExtensionCommandContext) {
        if (command.onboardingUi) {
          try {
            await runOnboarding(ctx);
          } catch {
            ctx.ui.notify("Helix onboarding could not open · retry /helix-onboarding", "warning");
          }
          return;
        }
        if (command.workflowCreatorUi && !args.trim()) {
          await showWorkflowCreator(pi, ctx);
          return;
        }
        if (command.workflowLifecycleUi) {
          await showWorkflowLifecycle(pi, ctx, command.workflowLifecycleUi, args);
          return;
        }
        if (command.name === "helix-run") {
          await runWorkflow(pi, ctx, args);
          return;
        }
        if (command.resumeUi) {
          await resumeWorkflow(pi, ctx, args);
          return;
        }
        if (command.name === "helix-workflows" && await testWorkflowCommand(pi, ctx, args)) return;
        if (command.settingsUi && !args.trim() && ctx.mode === "tui" && typeof ctx.ui?.custom === "function") {
          await showSettings(pi, ctx);
          return;
        }

        const coreArgs = command.coreArgs(args);
        let out: CoreResult;
        try {
          const modelInventory = await availableModelInventory(coreArgs, ctx);
          const workflowMutation = /^workflows\s+(?:create|import)(?:\s|$)/.test(coreArgs);
          if (workflowMutation && ctx.mode === "tui") {
            const preview = executeHelixCommand(coreArgs, { mode: ctx.mode, confirm: false }, { modelInventory, cwd: ctx.cwd });
            if (preview.code !== "helix-mutation-cancelled") {
              out = preview;
            } else {
              const confirm = await confirmMutation(coreArgs, ctx);
              out = executeHelixCommand(coreArgs, { mode: ctx.mode, confirm }, { modelInventory, cwd: ctx.cwd });
            }
          } else {
            const confirm = await confirmMutation(coreArgs, ctx);
            out = executeHelixCommand(coreArgs, { mode: ctx.mode, confirm }, { modelInventory, cwd: ctx.cwd });
          }
        } catch {
          out = internalError();
        }
        sendOutput(pi, out);
      },
    });
  }
}
