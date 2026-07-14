// Helix dispatch — canonical provider identity + canonical→Pi mapping.
//
// Provider identifiers in run records are Helix-canonical, not the verbatim Pi
// provider id. This module is the single source of truth for that mapping.

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

// Pi's ModelRegistry is the provider authority. Persist exact, case-preserving
// Pi ids using a narrow public-safe token grammar; the list above documents
// known aliases but is not a closed dispatch allowlist.
export const PROVIDER_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._~-]*$";
const PROVIDER_ID_RE = new RegExp(PROVIDER_ID_PATTERN);

/**
 * Canonical Helix provider → Pi/runtime source. Descriptive only (no ids, no
 * secrets).
 */
export const PROVIDER_PI_SOURCE = Object.freeze({
  "openai-codex": "Pi native OpenAI Codex OAuth/subscription provider",
  "openai-api": "Pi native/OpenAI-compatible API-key provider",
  openrouter: "Pi native OpenRouter provider",
  "github-copilot": "Pi native GitHub Copilot OAuth/subscription provider",
  "azure-foundry": "models.json / OpenAI-compatible Azure AI Foundry entry",
  "claude-local": "reserved first-party Claude CLI wrapper; not automated in this release",
  mock: "deterministic fixture provider",
});

/**
 * Providers excluded from automated dispatch. `claude-local` remains reserved
 * until a separately reviewed transport exists; `mock` is a fixture provider,
 * never a real dispatch target.
 */
export const NON_AUTOMATED_PROVIDERS = Object.freeze(["claude-local"]);

/** @param {unknown} provider */
export function isHelixProvider(provider) {
  return typeof provider === "string" && PROVIDER_ID_RE.test(provider);
}

/**
 * Descriptive Pi source for a canonical provider, or null when unknown. Callers
 * fail closed on null (unknown provider is never dispatchable).
 * @param {string} provider
 */
export function piSourceFor(provider) {
  return !isHelixProvider(provider) ? null : Object.prototype.hasOwnProperty.call(PROVIDER_PI_SOURCE, provider)
    ? PROVIDER_PI_SOURCE[provider]
    : "Pi configured provider from ModelRegistry";
}

/** Whether a canonical provider is eligible for automated dispatch. */
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
  return Object.prototype.hasOwnProperty.call(PROVIDER_FAMILY, provider) ? PROVIDER_FAMILY[provider] : provider;
}
