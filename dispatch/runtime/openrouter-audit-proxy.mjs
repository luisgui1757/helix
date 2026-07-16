import { createServer } from "node:http";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const UPSTREAM = "https://openrouter.ai/api/v1";

function expectedRouting(route) {
  return {
    only: [route],
    order: [route],
    allow_fallbacks: false,
    require_parameters: true,
    data_collection: "deny",
    zdr: true,
  };
}

function sameRouting(actual, route) {
  const expected = expectedRouting(route);
  return actual && typeof actual === "object" && !Array.isArray(actual)
    && JSON.stringify(actual) === JSON.stringify(expected);
}

function inspectSseLine(line, state, model, route) {
  if (!line.startsWith("data:")) return;
  const payload = line.slice(5).trim();
  if (payload === "" || payload === "[DONE]") return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { state.invalid = true; state.failure_code ??= "sse-json-invalid"; return; }
  if (typeof parsed.model === "string" && parsed.model !== model) {
    state.invalid = true;
    state.failure_code ??= "response-model-mismatch";
  }
  if (typeof parsed.provider === "string") {
    state.route_observed = true;
    if (parsed.provider !== route) {
      state.invalid = true;
      state.failure_code ??= "response-route-mismatch";
    }
  }
}

export async function createOpenRouterAuditProxy({
  model, route, apiKey, signal = null, fetchImpl = globalThis.fetch, upstream = UPSTREAM,
} = {}) {
  if (![model, route, apiKey, upstream].every((value) => typeof value === "string" && value.length > 0)
    || typeof fetchImpl !== "function") throw new Error("openrouter-audit-proxy-invalid");
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? "openrouter-audit-proxy-cancelled");
  if (signal?.aborted) abort();
  else signal?.addEventListener?.("abort", abort, { once: true });
  const state = {
    calls: 0, completed: 0, finished: 0, invalid: false, route_observed: false,
    upstream_status: null, failure_code: null,
  };
  const idleWaiters = new Set();
  const notifyIdle = () => {
    if (state.finished !== state.calls) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };
  const server = createServer(async (request, response) => {
    let started = false;
    if (request.method !== "POST" || request.url !== "/api/v1/chat/completions") {
      state.invalid = true;
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) throw new Error("oversized");
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      let parsed;
      try { parsed = JSON.parse(body.toString("utf8")); } catch { parsed = null; }
      if (!parsed || parsed.model !== model || parsed.stream !== true || Object.hasOwn(parsed, "models")
        || !sameRouting(parsed.provider, route)) {
        state.invalid = true;
        state.failure_code ??= "request-policy-mismatch";
        response.writeHead(400).end();
        return;
      }
      state.calls += 1;
      started = true;
      const upstreamResponse = await fetchImpl(`${upstream}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      state.upstream_status = upstreamResponse?.status ?? null;
      if (!upstreamResponse?.ok || !upstreamResponse.body) {
        state.invalid = true;
        state.failure_code ??= "upstream-response-failed";
        response.writeHead(upstreamResponse?.status ?? 502).end();
        return;
      }
      response.writeHead(upstreamResponse.status, {
        "content-type": upstreamResponse.headers.get("content-type") ?? "text/event-stream",
      });
      const reader = upstreamResponse.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        response.write(Buffer.from(value));
        pending += decoder.decode(value, { stream: true });
        if (pending.length > MAX_REQUEST_BYTES) state.invalid = true;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) inspectSseLine(line.replace(/\r$/, ""), state, model, route);
      }
      pending += decoder.decode();
      if (pending !== "") inspectSseLine(pending.replace(/\r$/, ""), state, model, route);
      state.completed += 1;
      response.end();
    } catch {
      state.invalid = true;
      state.failure_code ??= "proxy-stream-failed";
      if (!response.headersSent) response.writeHead(size > MAX_REQUEST_BYTES ? 413 : 502);
      response.end();
    } finally {
      if (started) state.finished += 1;
      notifyIdle();
    }
  });
  server.on("clientError", (_error, socket) => {
    state.invalid = true;
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("openrouter-audit-proxy-listen-failed");
  let closed = false;
  return {
    base_url: `http://127.0.0.1:${address.port}/api/v1`,
    verify() {
      return state.calls > 0 && state.finished === state.calls && state.completed === state.calls
        && state.route_observed && !state.invalid;
    },
    async settle(timeoutMs = 1_000) {
      if (state.finished === state.calls) return true;
      let timer;
      const settled = await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); resolve(true); };
        idleWaiters.add(done);
        timer = setTimeout(() => { idleWaiters.delete(done); resolve(false); }, timeoutMs);
      });
      return settled && state.finished === state.calls;
    },
    status() {
      return { ...state };
    },
    async close() {
      if (closed) return;
      closed = true;
      controller.abort("openrouter-audit-proxy-closed");
      signal?.removeEventListener?.("abort", abort);
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
