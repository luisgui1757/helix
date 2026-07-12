// Helix dispatch — canonical provider identity + canonical→Pi mapping.
//
// Provider identifiers in run records are Helix-canonical, not the verbatim Pi
// provider id (spec §"Provider And Cost Policy"). Stage 3B owns this mapping.

/**
 * The canonical Helix provider set. Order is stable and used by the role
 * envelope provider enum.
 */
export const HELIX_PROVIDERS = Object.freeze([
  "openai-codex",
  "openai-api",
  "openrouter",
  "github-copilot",
  "azure-foundry",
  "claude-local",
  "mock",
]);

/**
 * Canonical Helix provider → Pi/runtime source. Descriptive only (no ids, no
 * secrets). Source of truth: fusion-dispatch-research.md §"Provider And Cost
 * Policy".
 */
export const PROVIDER_PI_SOURCE = Object.freeze({
  "openai-codex": "Pi native OpenAI Codex OAuth/subscription provider",
  "openai-api": "Pi native/OpenAI-compatible API-key provider",
  openrouter: "Pi native OpenRouter provider",
  "github-copilot": "Pi native GitHub Copilot OAuth/subscription provider",
  "azure-foundry": "models.json / OpenAI-compatible Azure AI Foundry entry",
  "claude-local": "first-party Claude CLI wrapper only if ROADMAP Q4 accepts it",
  mock: "deterministic fixture provider",
});

/**
 * Providers excluded from automated Stage-3 dispatch until an explicit roadmap
 * gate lands. `claude-local` is excluded until ROADMAP Q4 settles native-Claude
 * dispatch; `mock` is a fixture provider, never a real dispatch target.
 */
export const NON_AUTOMATED_PROVIDERS = Object.freeze(["claude-local"]);

/** @param {unknown} provider */
export function isHelixProvider(provider) {
  return typeof provider === "string" && HELIX_PROVIDERS.includes(provider);
}

/**
 * Descriptive Pi source for a canonical provider, or null when unknown. Callers
 * fail closed on null (unknown provider is never dispatchable).
 * @param {string} provider
 */
export function piSourceFor(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDER_PI_SOURCE, provider)
    ? PROVIDER_PI_SOURCE[provider]
    : null;
}

/** Whether a canonical provider is eligible for automated dispatch this stage. */
export function isAutomatedDispatchProvider(provider) {
  return isHelixProvider(provider) && !NON_AUTOMATED_PROVIDERS.includes(provider);
}

/**
 * Provider model-family, for the cross-family advisory (spec §"Multi-agent
 * orchestration": cross-family diversity is encouraged for adversarial panels).
 * `mock` is its own family, so an all-mock panel is a single family and warns —
 * a warning, never a blocker.
 */
export const PROVIDER_FAMILY = Object.freeze({
  "openai-codex": "openai",
  "openai-api": "openai",
  openrouter: "openrouter",
  "github-copilot": "github",
  "azure-foundry": "azure",
  "claude-local": "anthropic",
  mock: "mock",
});

/** @param {string} provider → its model family, or "unknown" for an unmapped id. */
export function providerFamily(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDER_FAMILY, provider) ? PROVIDER_FAMILY[provider] : "unknown";
}
