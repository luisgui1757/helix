/**
 * Helix's Pi-native command surface.
 *
 * Each user-facing capability has a discoverable `helix-*` slash command.
 * `/helix` remains the dashboard and accepts the legacy verb form so existing
 * sessions do not break, but help and completion lead with dedicated commands.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  executeHelixCommand,
  getHelixArgumentCompletions,
  isHelixMutationRequest,
  renderHelixRunCompletion,
} from "./lib/helix-command-core.mjs";

const RUNNER_ENTRYPOINT = fileURLToPath(new URL("../tools/loop/helix-task-loop.mjs", import.meta.url));

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
  { id: "worktree", label: "Worktrees", description: "Isolate run mutations in a Git worktree; off uses the current checkout." },
  { id: "visual-cues", label: "Visual cues", description: "Show rich run events; off keeps plain event lines." },
]);

type CoreResult = ReturnType<typeof executeHelixCommand>;
type CommandDefinition = {
  name: string;
  description: string;
  coreArgs: (args: string) => string;
  completions?: (prefix: string) => ReturnType<typeof getHelixArgumentCompletions>;
  settingsUi?: boolean;
};

function trimWithPrefix(prefix: string, args: string): string {
  const suffix = args.trim();
  return suffix ? `${prefix} ${suffix}` : prefix;
}

function runCompletions(prefix: string) {
  const items = getHelixArgumentCompletions(`run ${prefix}`) ?? [];
  return items.map((item) => ({ ...item, value: item.value.replace(/^run /, "") }));
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
  { name: "helix-run", description: "Preflight and start a Helix workflow", coreArgs: (args) => trimWithPrefix("run", args), completions: runCompletions },
  { name: "helix-runs", description: "List Helix run records", coreArgs: (args) => trimWithPrefix("runs", args || "list") },
  { name: "helix-run-status", description: "Inspect a Helix run", coreArgs: (args) => trimWithPrefix("runs status", args) },
  { name: "helix-run-watch", description: "Show current run progress", coreArgs: (args) => trimWithPrefix("runs watch", args) },
  { name: "helix-run-resume", description: "Prepare an interrupted run to resume", coreArgs: (args) => trimWithPrefix("runs resume", args) },
  { name: "helix-run-prune", description: "Delete one run record", coreArgs: (args) => trimWithPrefix("runs prune", args) },
  { name: "helix-models", description: "Show casts and available models", coreArgs: () => "models" },
  { name: "helix-chains", description: "Show workflow chains", coreArgs: () => "chains" },
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
  const verb = args.trim().split(/\s+/, 1)[0] ?? "";
  return verb === "" || ["run", "models", "setup"].includes(verb);
}

async function availableModelInventory(args: string, ctx: ExtensionCommandContext) {
  if (!commandNeedsInventory(args) || typeof ctx.modelRegistry?.getAvailable !== "function") return null;
  try {
    const available = await ctx.modelRegistry.getAvailable();
    if (!Array.isArray(available)) return null;
    return available.flatMap((entry: any) => {
      const model = entry?.model && typeof entry.model === "object" ? entry.model : entry;
      const provider = PROVIDER_TO_HELIX[String(model?.provider ?? "")];
      if (!provider || typeof model?.id !== "string") return [];
      return [{ provider, model: model.id, reasoning: model.reasoning === true }];
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

function nextRunId(): string {
  return `helix-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function runSummary(stdout: string): { converged: boolean; stopReason: string | null } {
  const start = stdout.indexOf("{");
  if (start === -1) return { converged: false, stopReason: null };
  try {
    const parsed = JSON.parse(stdout.slice(start));
    return {
      converged: parsed?.converged === true,
      stopReason: typeof parsed?.stop_reason === "string" ? parsed.stop_reason : null,
    };
  } catch {
    return { converged: false, stopReason: null };
  }
}

async function runMockWorkflow(pi: ExtensionAPI, ctx: ExtensionCommandContext, preflight: CoreResult) {
  sendOutput(pi, preflight);
  if (!preflight.ok || ctx.mode !== "tui" || typeof ctx.ui?.confirm !== "function") return;
  const configId = String(preflight.details?.config_id ?? "");
  const approved = await ctx.ui.confirm(
    "Start Helix workflow",
    `Run the packaged no-live mock workflow with config ${configId}?`,
  );
  if (!approved) {
    ctx.ui.notify("Helix run cancelled; no workflow was started", "info");
    return;
  }

  const runId = nextRunId();
  ctx.ui.setWorkingMessage?.(`Helix is running ${configId}`);
  ctx.ui.setWorkingVisible?.(true);
  let execution;
  try {
    execution = await pi.exec(process.execPath, [
      RUNNER_ENTRYPOINT,
      "--config", configId,
      "--run-id", runId,
      "--summary",
    ], { cwd: ctx.cwd, signal: ctx.signal, timeout: 10 * 60 * 1000 });
  } catch {
    execution = { stdout: "", stderr: "", code: 1, killed: false };
  } finally {
    ctx.ui.setWorkingVisible?.(false);
    ctx.ui.setWorkingMessage?.();
  }
  const summary = runSummary(execution.stdout);
  sendOutput(pi, renderHelixRunCompletion({
    runId,
    configId,
    exitCode: execution.code,
    converged: summary.converged,
    stopReason: summary.stopReason,
  }));
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

  for (const command of COMMANDS) {
    pi.registerCommand(command.name, {
      description: command.description,
      ...(command.completions ? { getArgumentCompletions: command.completions } : {}),
      async handler(args: string, ctx: ExtensionCommandContext) {
        if (command.settingsUi && !args.trim() && ctx.mode === "tui" && typeof ctx.ui?.custom === "function") {
          await showSettings(pi, ctx);
          return;
        }

        const coreArgs = command.coreArgs(args);
        let out: CoreResult;
        try {
          const confirm = await confirmMutation(coreArgs, ctx);
          const modelInventory = await availableModelInventory(coreArgs, ctx);
          out = executeHelixCommand(coreArgs, { mode: ctx.mode, confirm }, { modelInventory });
        } catch {
          out = internalError();
        }
        if (command.name === "helix-run") {
          await runMockWorkflow(pi, ctx, out);
          return;
        }
        sendOutput(pi, out);
      },
    });
  }
}
