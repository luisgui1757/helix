// Prime \answer resolver — pure option-building (zero dependencies, unit-testable).
//
// When more than one valid Canonical Gold Standard exists (circumstantial — e.g.
// Docker vs Podman vs Apple Containers), present the TOP recommendation plus
// ranked alternatives, let the user pick, and return the choice. This module
// holds only the deterministic ordering/formatting; the extension wires it to
// Pi's native ctx.ui.select.

/**
 * @typedef {{ label: string, reason?: string }} Candidate
 */

/**
 * Build the ordered option list: the recommendation is always rank 1, then the
 * alternatives in the order given (caller ranks them).
 * @param {{ recommendation: Candidate, alternatives?: Candidate[] }} input
 * @returns {Array<{ rank: number, label: string, reason: string, isRecommended: boolean }>}
 */
export function buildOptions(input) {
  if (!input || !input.recommendation || typeof input.recommendation.label !== "string") {
    throw new Error("answer: a recommendation with a label is required");
  }
  const alternatives = Array.isArray(input.alternatives) ? input.alternatives : [];
  const options = [
    {
      rank: 1,
      label: input.recommendation.label,
      reason: input.recommendation.reason ?? "",
      isRecommended: true,
    },
  ];
  alternatives.forEach((alt, i) => {
    if (!alt || typeof alt.label !== "string") return;
    options.push({ rank: i + 2, label: alt.label, reason: alt.reason ?? "", isRecommended: false });
  });
  return options;
}

/**
 * The deterministic default choice (used in non-interactive mode): the top
 * recommendation.
 * @param {Array<{ isRecommended: boolean }>} options
 */
export function defaultChoice(options) {
  return options.find((o) => o.isRecommended) ?? options[0];
}

/** Human-readable label for a menu row. */
export function formatOption(o) {
  const rec = o.isRecommended ? " (recommended)" : "";
  const reason = o.reason ? ` — ${o.reason}` : "";
  return `${o.rank}. ${o.label}${rec}${reason}`;
}

/** Map a selected menu label back to its option (null if not found). */
export function optionFromLabel(options, selectedLabel) {
  if (typeof selectedLabel !== "string") return null;
  return options.find((o) => formatOption(o) === selectedLabel) ?? null;
}

/**
 * Resolve the user's choice. Interactive mode calls `select(labels)` (Pi's
 * ctx.ui.select) and maps the result back; non-interactive returns the top
 * recommendation deterministically (the documented deterministic path). A
 * cancelled selection falls back to the recommendation so the agent always gets
 * a concrete answer.
 * @param {Array<object>} options
 * @param {{ interactive?: boolean, select?: (labels: string[]) => Promise<string|null> }} io
 */
export async function resolveAnswer(options, io = {}) {
  if (io.interactive && typeof io.select === "function") {
    const labels = options.map(formatOption);
    const selected = await io.select(labels);
    const chosen = optionFromLabel(options, selected);
    return { chosen: chosen ?? defaultChoice(options), interactive: true, cancelled: chosen === null };
  }
  return { chosen: defaultChoice(options), interactive: false, cancelled: false };
}
