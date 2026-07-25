// Helix \answer resolver — pure option-building (zero dependencies, unit-testable).
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
 * Resolve the user's choice. A concrete answer exists only after an explicit
 * interactive selection. Non-interactive mode, cancellation, and invalid UI
 * output remain unresolved. When custom answers are enabled, selecting the
 * dedicated row invokes `input()` and accepts one bounded non-empty value.
 * @param {Array<object>} options
 * @param {{
 *   interactive?: boolean,
 *   allowCustom?: boolean,
 *   maxCustomLength?: number,
 *   select?: (labels: string[]) => Promise<string|null>,
 *   input?: () => Promise<string|null>,
 * }} io
 */
export async function resolveAnswer(options, io = {}) {
  if (!io.interactive || typeof io.select !== "function") {
    return { status: "unavailable", chosen: null, custom: null, interactive: false };
  }
  const customLabel = "Write a custom answer…";
  const labels = [...options.map(formatOption), ...(io.allowCustom ? [customLabel] : [])];
  const selected = await io.select(labels);
  if (selected === null) {
    return { status: "cancelled", chosen: null, custom: null, interactive: true };
  }
  if (selected === customLabel) {
    if (typeof io.input !== "function") {
      return { status: "unavailable", chosen: null, custom: null, interactive: true };
    }
    const custom = (await io.input())?.trim() ?? "";
    const maximum = Number.isSafeInteger(io.maxCustomLength)
      && io.maxCustomLength >= 1 && io.maxCustomLength <= 4_096
      ? io.maxCustomLength
      : 4_096;
    if (custom.length < 1 || custom.length > maximum) {
      return { status: "cancelled", chosen: null, custom: null, interactive: true };
    }
    return { status: "answered", chosen: null, custom, interactive: true };
  }
  const chosen = optionFromLabel(options, selected);
  return chosen == null
    ? { status: "invalid-selection", chosen: null, custom: null, interactive: true }
    : { status: "answered", chosen, custom: null, interactive: true };
}
