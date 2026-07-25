/**
 * Helix \answer — interactive multi-CGS resolver
 *
 * When more than one valid Canonical Gold Standard exists (circumstantial — e.g.
 * Docker vs Podman vs Apple Containers), the agent calls this tool with a TOP
 * recommendation plus ranked alternatives; the user picks; the choice returns to
 * the agent. Built on Pi natives: `pi.registerTool` (TypeBox-compatible JSON
 * Schema params) + `ctx.ui.select`. Model-callable, so it does not add a slash
 * command that users could mistake for a direct workflow action.
 *
 * In `-p` / json / rpc (no TUI), cancellation, or invalid UI output, the tool
 * returns a typed unresolved result. It never silently chooses for the user.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildOptions, formatOption, resolveAnswer } from "./lib/answer-core.mjs";
import {
  piToolTurnJournal,
  resetPiToolTurnJournal,
} from "./lib/helix-tool-journal.mjs";

const Candidate = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["label"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 128, description: "Short name of the gold-standard option" },
    reason: { type: "string", maxLength: 512, description: "Why this option fits (one line)" },
  },
});

const AnswerParams = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["question", "recommendation"],
  properties: {
    question: { type: "string", minLength: 1, maxLength: 1_024, description: "The decision with more than one valid gold standard" },
    recommendation: Candidate,
    alternatives: {
      type: "array",
      items: Candidate,
      maxItems: 15,
      description: "Ranked alternatives, best first",
    },
    allow_custom: {
      type: "boolean",
      description: "Allow the user to enter a bounded custom answer",
    },
  },
});

export default function helixAnswer(pi: ExtensionAPI) {
  const journal = piToolTurnJournal(pi);
  const lifecycle = { closing: false, generation: 0 };
  pi.on?.("session_start", () => {
    lifecycle.generation += 1;
    lifecycle.closing = false;
    resetPiToolTurnJournal(pi);
  });
  pi.on?.("session_shutdown", () => {
    lifecycle.generation += 1;
    lifecycle.closing = true;
  });
  pi.registerTool({
    name: "answer",
    label: "Answer",
    description:
      "Resolve a decision that has more than one valid gold standard. Provide a top " +
      "recommendation and ranked alternatives; the user picks and the choice is returned. " +
      "Use when the best approach is circumstantial, not a single canonical answer.",
    parameters: AnswerParams,

    async execute(toolCallId: string, params: {
      question: string;
      recommendation: { label: string; reason?: string };
      alternatives?: Array<{ label: string; reason?: string }>;
      allow_custom?: boolean;
    }, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: {
      mode?: string;
      ui?: {
        select?: (prompt: string, options: string[]) => Promise<string | null>;
        input?: (prompt: string) => Promise<string | null>;
      };
    }) {
      const intent = journal.start({ tool_call_id: toolCallId, tool: "answer", args: params });
      if (!intent.ok) {
        return {
          content: [{ type: "text", text: `Unresolved: ${intent.code}; no option was selected.` }],
          details: { status: "unavailable", code: intent.code, chosen: null },
        };
      }
      const generation = lifecycle.generation;
      let result: any;
      let settlementStatus = "ok";
      try {
        const options = buildOptions(params);
        const interactive = signal?.aborted !== true && !lifecycle.closing
          && ctx?.mode === "tui" && typeof ctx.ui?.select === "function";

        let resolved = await resolveAnswer(options, {
          interactive,
          allowCustom: params.allow_custom === true,
          select: (labels: string[]) => ctx.ui!.select!(params.question, labels),
          ...(typeof ctx.ui?.input === "function"
            ? { input: () => ctx.ui!.input!("Custom answer") }
            : {}),
        });
        if (signal?.aborted === true || lifecycle.closing || lifecycle.generation !== generation) {
          resolved = {
            status: "cancelled",
            chosen: null,
            custom: null,
            interactive,
          };
        }
        const answer = resolved.custom ?? resolved.chosen?.label ?? null;
        const text = resolved.status === "answered"
          ? `Chosen: ${answer}`
          : `Unresolved: ${resolved.status}; no option was selected.`;

        result = {
          content: [{ type: "text", text }],
          details: {
            question: params.question,
            options: options.map(formatOption),
            status: resolved.status,
            chosen: answer,
            recommended: resolved.chosen?.isRecommended === true,
            custom: resolved.custom !== null,
            interactive,
          },
        };
        settlementStatus = resolved.status === "answered" ? "ok" : "refused";
      } catch {
        result = {
          content: [{ type: "text", text: "Unresolved: answer-tool-failed; no option was selected." }],
          details: { status: "unavailable", code: "answer-tool-failed", chosen: null },
        };
        settlementStatus = "failed";
      }
      const settled = journal.settle({
        tool_call_id: toolCallId,
        tool: "answer",
        intent_token: intent.intent_token,
        result: result.details,
        status: settlementStatus,
      });
      if (!settled.ok) {
        return {
          content: [{ type: "text", text: `Unresolved: ${settled.code}; no option was selected.` }],
          details: { status: "unavailable", code: settled.code, chosen: null },
        };
      }
      return result;
    },
  });
}
