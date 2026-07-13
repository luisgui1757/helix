/**
 * Helix yolo-fence
 *
 * Keeps Pi's yolo-by-default speed while fencing irreversible / high-blast-radius
 * operations behind an explicit confirm. Source-verified against Pi 0.80.3:
 * `tool_call` handlers may return `{ block: true, reason }` (see
 * examples/extensions/permission-gate.ts, protected-paths.ts).
 *
 * FAIL-CLOSED gate = `ctx.mode === "tui"`, NOT `ctx.hasUI`. Per
 * docs/extensions.md:912-914 and docs/rpc.md:1068, `ctx.hasUI` is **true in RPC
 * mode** (and TUI), so `!ctx.hasUI` would wrongly allow a risky op in `--mode rpc`
 * where an interactive human is not guaranteed (the client can auto-approve, and
 * dialogs auto-resolve to `undefined` on timeout). Only a real terminal
 * (`ctx.mode === "tui"`) may prompt; `rpc` / `json` / `print` all BLOCK.
 *
 * This is defense-in-depth, NOT containment — the denylist is a regex speed bump
 * (evadable via heredocs, aliases, scripts, `find -delete`). The real boundary is
 * an OS/container sandbox; `tools/lockdown/` provides the local no-egress proof.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifyCommand, classifyWritePath } from "./lib/fence-rules.mjs";

export default function helixFence(pi: ExtensionAPI) {
  // Agent tool calls: bash commands + write/edit targets.
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const command = String(event.input?.command ?? "");
      const { risky, rule } = classifyCommand(command);
      if (!risky) return undefined;
      return decide(ctx, `bash (${rule})`, command);
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const path = String(event.input?.path ?? "");
      const { protectedPath, rule } = classifyWritePath(path);
      if (!protectedPath) return undefined;
      return decide(ctx, `${event.toolName} protected path (${rule})`, path);
    }

    return undefined;
  });

  // User `!` / `!!` shell commands. user_bash intercepts by returning a
  // replacement result (docs/extensions.md); there is no `{ block }` here, so a
  // denied command is replaced with a non-zero cancelled result.
  pi.on("user_bash", async (event, ctx) => {
    const command = String((event as { command?: unknown }).command ?? "");
    const { risky, rule } = classifyCommand(command);
    if (!risky) return undefined;

    if (ctx.mode !== "tui") {
      return refuse(`helix-fence blocked user command (${rule}); no interactive terminal to confirm (mode=${ctx.mode})`);
    }
    const allowed = await ctx.ui.confirm(
      `⚠️ helix-fence: risky command (${rule})`,
      `Run this shell command?\n\n  ${command}`,
    );
    if (!allowed) {
      ctx.ui.notify(`helix-fence: command cancelled (${rule})`, "warning");
      return refuse(`helix-fence: user declined command (${rule})`);
    }
    return undefined;
  });
}

/**
 * Confirm only in a real terminal (`ctx.mode === "tui"`); fail closed in every
 * other mode (`rpc` / `json` / `print`). Returns a `tool_call` verdict:
 * `{ block: true, reason }` to block, or `undefined` to allow.
 */
async function decide(
  ctx: { mode?: string; ui: { select: (p: string, o: string[]) => Promise<string | null>; notify: (m: string, l: string) => void } },
  label: string,
  detail: string,
): Promise<{ block: true; reason: string } | undefined> {
  if (ctx.mode !== "tui") {
    return { block: true, reason: `helix-fence: ${label} blocked (fail-closed: interactive confirm requires a terminal; mode=${ctx.mode})` };
  }
  const choice = await ctx.ui.select(
    `⚠️ helix-fence: ${label}\n\n  ${detail}\n\nAllow this operation?`,
    ["No, block it", "Yes, allow once"],
  );
  if (choice !== "Yes, allow once") {
    ctx.ui.notify(`helix-fence: blocked ${label}`, "warning");
    return { block: true, reason: `helix-fence: ${label} blocked by user` };
  }
  return undefined;
}

/** Build a cancelled user_bash replacement result. */
function refuse(message: string) {
  return { result: { output: message, exitCode: 1, cancelled: true, truncated: false } };
}
