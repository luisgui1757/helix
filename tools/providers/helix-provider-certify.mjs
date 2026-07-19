#!/usr/bin/env node

import { createHash } from "node:crypto";

function fail(code) {
  console.error(`provider-certification: ${code}`);
  process.exit(1);
}

if (process.env.HELIX_LIVE_TESTS !== "1") fail("live-authorization-required");
if (process.env.HELIX_LIVE_PROVIDER !== "openrouter") fail("unsupported-live-provider");
const model = process.env.HELIX_LIVE_MODEL;
const route = process.env.HELIX_LIVE_ROUTE;
const expectedAccount = process.env.HELIX_LIVE_EXPECTED_ACCOUNT;
const credential = process.env.OPENROUTER_API_KEY;
if (![model, route, expectedAccount, credential].every((value) => typeof value === "string" && value.length > 0)) {
  fail("live-configuration-incomplete");
}
if (!model.endsWith(":free")) fail("live-model-must-be-free");

const headers = { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" };
const accountResponse = await fetch("https://openrouter.ai/api/v1/key", { headers });
if (!accountResponse.ok) fail("openrouter-account-proof-failed");
const accountBody = await accountResponse.json();
const observedAccount = accountBody?.data?.creator_user_id;
if (observedAccount !== expectedAccount) fail("openrouter-account-mismatch");

const endpointsResponse = await fetch("https://openrouter.ai/api/v1/endpoints/zdr", { headers });
if (!endpointsResponse.ok) fail("openrouter-endpoint-proof-failed");
const endpointsBody = await endpointsResponse.json();
const endpoints = endpointsBody?.data;
const matches = Array.isArray(endpoints) ? endpoints.filter((endpoint) =>
  endpoint?.model_id === model && endpoint.status === 0 && endpoint.tag === route
  && typeof endpoint.provider_name === "string" && endpoint.provider_name.length > 0
  && typeof endpoint.quantization === "string" && endpoint.quantization.length > 0
  && Array.isArray(endpoint.supported_parameters)
  && endpoint.supported_parameters.includes("max_tokens")
  && endpoint.supported_parameters.includes("tools")) : [];
if (matches.length !== 1) fail("openrouter-endpoint-identity-ambiguous-or-unavailable");
const endpoint = matches[0];

const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers,
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Reply with exactly: HELIX_CERTIFIED" }],
    max_tokens: 8,
    stream: false,
    provider: {
      only: [route], order: [route], quantizations: [endpoint.quantization],
      allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true,
    },
  }),
});
if (!response.ok) fail("openrouter-request-failed");
const body = await response.json();
const text = body?.choices?.[0]?.message?.content;
const inputTokens = body?.usage?.prompt_tokens;
const outputTokens = body?.usage?.completion_tokens;
const totalTokens = body?.usage?.total_tokens;
if (body?.model !== model || typeof body?.id !== "string"
  || typeof text !== "string" || text.trim() !== "HELIX_CERTIFIED"
  || !Number.isSafeInteger(inputTokens) || inputTokens < 0
  || !Number.isSafeInteger(outputTokens) || outputTokens < 0
  || !Number.isSafeInteger(totalTokens) || totalTokens < 0
  || !Number.isSafeInteger(inputTokens + outputTokens) || inputTokens + outputTokens !== totalTokens) {
  fail("openrouter-response-identity-invalid");
}
const generationResponse = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(body.id)}`, { headers });
if (!generationResponse.ok) fail("openrouter-generation-proof-failed");
const generation = (await generationResponse.json())?.data;
if (generation?.model !== model || generation?.provider_name !== endpoint.provider_name) {
  fail("openrouter-generation-identity-mismatch");
}
const attestationRef = `sha256:${createHash("sha256").update([
  observedAccount, model, route, endpoint.quantization, endpoint.provider_name, body.id,
].join("\0")).digest("hex")}`;
console.log(JSON.stringify({
  ok: true,
  provider: "openrouter",
  model_ref: createHash("sha256").update(model).digest("hex"),
  route_ref: createHash("sha256").update(route).digest("hex"),
  quantization: endpoint.quantization,
  attestation_ref: attestationRef,
}));
