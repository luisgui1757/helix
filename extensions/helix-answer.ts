/**
 * Helix \answer — interactive multi-CGS resolver
 *
 * When more than one valid Canonical Gold Standard exists (circumstantial — e.g.
 * Docker vs Podman vs Apple Containers), the agent calls this tool with a TOP
 * recommendation plus ranked alternatives; the user picks; the choice returns to
 * the agent. Built on Pi 0.80.3 natives: `pi.registerTool` (TypeBox-compatible
 * JSON Schema params) + `ctx.ui.select`. Model-callable, so it does NOT add a
 * `/` menu entry (protects the command-surface budget, ROADMAP §6).
 *
 * Deterministic non-interactive path: in `-p` / json / rpc (no TUI), it returns
 * the top recommendation without prompting. See extensions/lib/answer-core.mjs.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildOptions, formatOption, resolveAnswer } from "./lib/answer-core.mjs";

const Candidate = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["label"],
  properties: {
    label: { type: "string", description: "Short name of the gold-standard option" },
    reason: { type: "string", description: "Why this option fits (one line)" },
  },
});

const AnswerParams = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["question", "recommendation"],
  properties: {
    question: { type: "string", description: "The decision with more than one valid gold standard" },
    recommendation: Candidate,
    alternatives: {
      type: "array",
      items: Candidate,
      description: "Ranked alternatives, best first",
    },
  },
});

export default function helixAnswer(pi: ExtensionAPI) {
  pi.registerTool({
    name: "answer",
    label: "Answer",
    description:
      "Resolve a decision that has more than one valid gold standard. Provide a top " +
      "recommendation and ranked alternatives; the user picks and the choice is returned. " +
      "Use when the best approach is circumstantial, not a single canonical answer.",
    parameters: AnswerParams,

    async execute(_toolCallId: string, params: {
      question: string;
      recommendation: { label: string; reason?: string };
      alternatives?: Array<{ label: string; reason?: string }>;
    }, _signal: unknown, _onUpdate: unknown, ctx: {
      mode?: string;
      ui?: { select?: (prompt: string, options: string[]) => Promise<string | null> };
    }) {
      const options = buildOptions(params);
      const interactive = ctx?.mode === "tui" && typeof ctx.ui?.select === "function";

      const { chosen, cancelled } = await resolveAnswer(options, {
        interactive,
        select: (labels: string[]) => ctx.ui!.select!(params.question, labels),
      });

      const note = !interactive
        ? " (non-interactive: auto-selected the recommendation)"
        : cancelled
          ? " (cancelled: defaulted to the recommendation)"
          : "";

      return {
        content: [{ type: "text", text: `Chosen: ${chosen.label}${note}` }],
        details: {
          question: params.question,
          options: options.map(formatOption),
          chosen: chosen.label,
          recommended: chosen.isRecommended,
          interactive,
        },
      };
    },
  });
}
