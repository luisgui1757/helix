// Helix lockdown smoke — local mock "approved provider" endpoint.
//
// A zero-dependency, OpenAI-Chat-Completions-compatible stub used to prove that
// an active Pi session routes model traffic ONLY to the approved (local) endpoint
// and never to a real provider or pi.dev. It runs on loopback inside the
// deny-by-default container (`--network none` still provides `lo`).
//
// Public-safety contract:
//   * Binds 127.0.0.1 only.
//   * Logs method + path + a request counter to stderr. NEVER logs request
//     headers or bodies (no prompts, no keys, no payloads).
//   * Returns a fixed canned assistant message; performs no outbound network.
//   * Accepts any Authorization value (the client uses a dummy key) and never
//     echoes or stores it.
//
// Usage: node mock-openai-endpoint.mjs [--port N] [--model ID]
//   Defaults: port 8080, model "helix-mock/echo-1".

import { createServer } from "node:http";

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number.parseInt(argValue("--port", process.env.MOCK_PORT || "8080"), 10);
const MODEL = argValue("--model", process.env.MOCK_MODEL || "helix-mock/echo-1");
const CANNED = "helix-lockdown-mock-ok";

let requestCount = 0;

function drain(req) {
  // Consume and discard the body without inspecting it (no payload logging).
  return new Promise((resolve) => {
    req.on("data", () => {});
    req.on("end", resolve);
    req.on("error", resolve);
  });
}

function chatCompletion() {
  return {
    id: "chatcmpl-helix-mock",
    object: "chat.completion",
    created: 0,
    model: MODEL,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: CANNED },
        finish_reason: "stop"
      }
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

function streamChunks(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  const base = { id: "chatcmpl-helix-mock", object: "chat.completion.chunk", created: 0, model: MODEL };
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: CANNED }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer(async (req, res) => {
  requestCount += 1;
  // Destinations/method/path only — never headers or body.
  process.stderr.write(`REQ ${requestCount} ${req.method} ${req.url}\n`);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  await drain(req);

  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "helix-mock" }] }));
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    // Body was drained without inspection; always stream to satisfy both
    // streaming and non-streaming clients that fall back to reading SSE.
    streamChunks(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found", type: "invalid_request_error" } }));
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`LISTEN 127.0.0.1:${PORT} model=${MODEL}\n`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
