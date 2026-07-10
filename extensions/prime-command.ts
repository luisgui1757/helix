/**
 * Prime /prime - conservative Stage 3O control surface.
 *
 * One Pi slash command routes argument verbs through the pure core module:
 * dashboard, run preflight, structural run inspection, and TUI-confirmed
 * settings/profile/setup/prune mutations.
 * PR1 never launches the task loop, never toggles live mode, and never calls a
 * provider/model adapter.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  executePrimeCommand,
  getPrimeArgumentCompletions,
  isPrimeMutationRequest,
} from "./lib/prime-command-core.mjs";

async function confirmMutation(args: string, ctx: ExtensionCommandContext): Promise<boolean | undefined> {
  if (!isPrimeMutationRequest(args)) return undefined;
  if (ctx.mode !== "tui") return undefined;
  if (typeof ctx.ui?.confirm !== "function") return undefined;
  return ctx.ui.confirm(
    "Confirm Prime mutation",
    "Apply this attended /prime state change? Review the command text before confirming.",
  );
}

const PROVIDER_TO_PRIME: Record<string, string> = {
  "openai-codex": "openai-codex",
  openai: "openai-api",
  "openai-api": "openai-api",
  openrouter: "openrouter",
  "github-copilot": "github-copilot",
  "azure-foundry": "azure-foundry",
  mock: "mock",
};

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
      const provider = PROVIDER_TO_PRIME[String(model?.provider ?? "")];
      if (!provider || typeof model?.id !== "string") return [];
      return [{ provider, model: model.id, reasoning: model.reasoning === true }];
    });
  } catch {
    return null;
  }
}

export default function primeCommand(pi: ExtensionAPI) {
  pi.registerCommand("prime", {
    description: "Prime control surface: dashboard, run preflight, presets/chains/settings/profiles, setup casts, research preflight, run watch/resume/prune.",
    getArgumentCompletions(argumentPrefix: string) {
      return getPrimeArgumentCompletions(argumentPrefix);
    },
    async handler(args: string, ctx: ExtensionCommandContext) {
      // Throw fence: an unexpected error (e.g. an fs failure) must never surface
      // a raw message — which could carry an absolute private path — to the user.
      // Return a stable, public-safe refusal instead.
      let out;
      try {
        const confirm = await confirmMutation(args, ctx);
        const modelInventory = await availableModelInventory(args, ctx);
        out = executePrimeCommand(args, { mode: ctx.mode, confirm }, { modelInventory });
      } catch {
        out = {
          ok: false,
          status: "fail-closed",
          code: "prime-command-internal-error",
          title: "Prime command refused",
          text: "Prime refusal: prime-command-internal-error\nReason: an unexpected internal error occurred.\nNext safe action: retry /prime, or run /prime help.",
          details: { code: "prime-command-internal-error", mutating: false },
        };
      }
      pi.sendMessage({
        customType: "prime-command",
        content: out.text,
        display: true,
        details: { title: out.title, ...out.details },
      }, { triggerTurn: false });
      return out;
    },
  });
}
