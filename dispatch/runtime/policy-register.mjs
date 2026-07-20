// Dated provider/account policy facts. Expiry is deliberate: stale policy
// evidence disables new exact sessions instead of silently persisting a claim.

const SOURCE_DATE = "2026-07-16";
const VALID_UNTIL = "2026-08-15";

export const PROVIDER_POLICIES = Object.freeze({
  mock: Object.freeze({ status: "official", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "local-mock-contract" }),
  "anthropic-api": Object.freeze({ status: "official", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "https://platform.claude.com/docs/en/api/overview" }),
  "anthropic-consumer-oauth": Object.freeze({ status: "prohibited", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "https://support.claude.com/en/articles/11145838-using-the-claude-code-sdk" }),
  "openai-api": Object.freeze({ status: "official", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "https://developers.openai.com/api/docs" }),
  "codex-business-token": Object.freeze({ status: "official", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "https://learn.chatgpt.com/docs/enterprise/access-tokens" }),
  "codex-personal-oauth": Object.freeze({ status: "gray-unstable", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "https://developers.openai.com/codex/auth" }),
  "github-copilot": Object.freeze({ status: "official", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started" }),
  "azure-foundry-claude": Object.freeze({ status: "official", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-claude-code" }),
  "azure-openai": Object.freeze({ status: "official", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/reference" }),
  openrouter: Object.freeze({ status: "official", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "https://openrouter.ai/docs/guides/routing/provider-selection" }),
  cliproxyapi: Object.freeze({ status: "prohibited", reviewed_at: SOURCE_DATE, valid_until: VALID_UNTIL, source: "architecture-review-2026-07-16" }),
});

const PROVIDER_PATH = Object.freeze({
  mock: "mock",
  anthropic: "anthropic-api",
  "openai-api": "openai-api",
  openai: "openai-api",
  "openai-codex": "codex-personal-oauth",
  "github-copilot": "github-copilot",
  "azure-foundry-claude": "azure-foundry-claude",
  "azure-openai": "azure-openai",
  "azure-openai-responses": "azure-openai",
  openrouter: "openrouter",
});

export function providerPathFor(provider, { credential_class = null } = {}) {
  if (provider === "openai-codex" && credential_class === "workspace-token") return "codex-business-token";
  return PROVIDER_PATH[provider] ?? null;
}

export function providerPolicy(path, { now = Date.now() } = {}) {
  const policy = PROVIDER_POLICIES[path];
  if (!policy) return { ok: false, code: "provider-policy-unknown" };
  const validUntil = Date.parse(`${policy.valid_until}T23:59:59Z`);
  if (!Number.isFinite(validUntil) || now > validUntil) return { ok: false, code: "provider-policy-expired", policy };
  return policy.status === "prohibited"
    ? { ok: false, code: "provider-policy-blocked", policy }
    : { ok: true, policy };
}
