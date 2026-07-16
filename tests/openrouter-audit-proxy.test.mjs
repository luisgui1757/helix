import test from "node:test";
import assert from "node:assert/strict";

import { createOpenRouterAuditProxy } from "../dispatch/runtime/openrouter-audit-proxy.mjs";

const routing = {
  only: ["ExactRoute"], order: ["ExactRoute"], allow_fallbacks: false,
  require_parameters: true, data_collection: "deny", zdr: true,
};

function stream(model, provider) {
  return `data: ${JSON.stringify({ id: "generation", model, provider, choices: [{ delta: { content: "ok" } }] })}\n\n`
    + `data: ${JSON.stringify({ id: "generation", model, provider, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`
    + "data: [DONE]\n\n";
}

test("OpenRouter audit proxy preserves bytes and proves exact streamed model and route", async () => {
  let captured;
  const proxy = await createOpenRouterAuditProxy({
    model: "vendor/model:free", route: "ExactRoute", apiKey: "credential",
    fetchImpl: async (_url, options) => {
      captured = { headers: options.headers, body: options.body.toString("utf8") };
      return new Response(stream("vendor/model:free", "ExactRoute"), {
        status: 200, headers: { "content-type": "text/event-stream" },
      });
    },
  });
  try {
    const body = JSON.stringify({ model: "vendor/model:free", stream: true, messages: [], provider: routing });
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
    model: "vendor/model:free", route: "ExactRoute", apiKey: "credential",
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response(stream("vendor/model:free", "SubstitutedRoute"), {
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
