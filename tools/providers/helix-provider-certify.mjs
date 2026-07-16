#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createOpenRouterRuntime } from "../../dispatch/runtime/openrouter-runtime.mjs";
import { certifiedSessionBinding } from "../../dispatch/runtime/strict-runtime.mjs";

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
const accountResponse = await fetch("https://openrouter.ai/api/v1/auth/key", { headers });
if (!accountResponse.ok) fail("openrouter-account-proof-failed");
const accountBody = await accountResponse.json();
const observedAccount = accountBody?.data?.label;
if (observedAccount !== expectedAccount) fail("openrouter-account-mismatch");

const tuple = { provider: "openrouter", model, effort: "provider-managed", route, expected_account: expectedAccount };
const observedAt = Date.now();
const capability = {
  effective: { provider: tuple.provider, model, effort: tuple.effort, route, account: observedAccount },
  evidence: {
    provider: "verified-session", model: "verified-response", effort: "verified-session",
    route: "verified-response", account: "verified-session", source: "openrouter-live-certification",
    observed_at: observedAt, expires_at: observedAt + 5 * 60 * 1000,
  },
  credential_class: "api-key",
  policy: "official",
  certification: "live-certified",
  certification_ref: `sha256:${createHash("sha256").update(`${model}\0${route}`).digest("hex")}`,
  session_binding: certifiedSessionBinding({ provider_path: "openrouter", session_id: "live-certification", account: observedAccount }),
};
const runtime = createOpenRouterRuntime({
  async transport(request, context) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers, body: JSON.stringify(request), signal: context.signal,
    });
    if (!response.ok) throw new Error("openrouter-request-failed");
    return response.json();
  },
});
const preflight = await runtime.preflight(tuple, { capability, now: observedAt, require_live: true });
if (!preflight.ok) fail(preflight.code);
const result = await runtime.execute({
  tuple,
  messages: [{ role: "user", content: "Reply with exactly: HELIX_CERTIFIED" }],
  max_output_tokens: 8,
}, { attestation: preflight.attestation, now: observedAt, require_live: true });
runtime.dispose();
if (!result.ok) fail(result.code);
console.log(JSON.stringify({
  ok: true,
  provider: "openrouter",
  model_ref: createHash("sha256").update(model).digest("hex"),
  route_ref: createHash("sha256").update(route).digest("hex"),
  attestation_ref: result.attestation_ref,
}));
