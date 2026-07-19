import test from "node:test";
import assert from "node:assert/strict";

import { createOpenRouterAuditProxy } from "../dispatch/runtime/openrouter-audit-proxy.mjs";

const routing = {
  only: ["exact-route/variant-a"], order: ["exact-route/variant-a"], quantizations: ["fp8"], allow_fallbacks: false,
  require_parameters: true, data_collection: "deny", zdr: true,
};

function stream(model, provider) {
  const identity = { id: "generation", model, ...(provider == null ? {} : { provider }) };
  return `data: ${JSON.stringify({ ...identity, choices: [{ delta: { content: "ok" } }] })}\n\n`
    + `data: ${JSON.stringify({ ...identity, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`
    + "data: [DONE]\n\n";
}

test("OpenRouter audit proxy preserves bytes and proves the required streamed model without undocumented route metadata", async () => {
  let captured;
  const proxy = await createOpenRouterAuditProxy({
    model: "vendor/model:free", route: "exact-route/variant-a", providerName: "ExactProvider",
    quantization: "fp8", apiKey: "credential",
    fetchImpl: async (_url, options) => {
      captured = { headers: options.headers, body: options.body.toString("utf8") };
      return new Response(stream("vendor/model:free", null), {
        status: 200, headers: { "content-type": "text/event-stream" },
      });
    },
  });
  try {
    const body = JSON.stringify({
      provider: { zdr: true, ...routing }, messages: [], stream: true, model: "vendor/model:free",
    });
    const response = await fetch(`${proxy.base_url}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(captured.body, body);
    assert.equal(captured.headers.Authorization, "Bearer credential");
    assert.equal(proxy.verify(), true);
  } finally {
    await proxy.close();
  }
});

test("OpenRouter audit proxy rejects outbound policy drift and observed route substitution", async () => {
  let upstreamCalls = 0;
  const proxy = await createOpenRouterAuditProxy({
    model: "vendor/model:free", route: "exact-route/variant-a", providerName: "ExactProvider",
    quantization: "fp8", apiKey: "credential",
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response(stream("vendor/model:free", "SubstitutedProvider"), {
        status: 200, headers: { "content-type": "text/event-stream" },
      });
    },
  });
  try {
    const drift = await fetch(`${proxy.base_url}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "vendor/model:free", stream: true, messages: [],
        provider: { ...routing, allow_fallbacks: true },
      }),
    });
    assert.equal(drift.status, 400);
    assert.equal(upstreamCalls, 0);
    const response = await fetch(`${proxy.base_url}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "vendor/model:free", stream: true, messages: [], provider: routing }),
    });
    await response.text();
    assert.equal(upstreamCalls, 1);
    assert.equal(proxy.verify(), false);
  } finally {
    await proxy.close();
  }
});

test("OpenRouter audit proxy requires the streamed response model even when optional endpoint metadata matches", async () => {
  const proxy = await createOpenRouterAuditProxy({
    model: "vendor/model:free", route: "exact-route/variant-a", providerName: "ExactProvider",
    quantization: "fp8", apiKey: "credential",
    fetchImpl: async () => new Response(stream(undefined, "ExactProvider"), {
      status: 200, headers: { "content-type": "text/event-stream" },
    }),
  });
  try {
    const response = await fetch(`${proxy.base_url}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "vendor/model:free", stream: true, messages: [], provider: routing }),
    });
    await response.text();
    assert.equal(proxy.verify(), false);
  } finally {
    await proxy.close();
  }
});
