// Prime dispatch — OpenRouter live builder adapter (Stage 3J; YOLO posture 2026-07-09).
//
// This is the smallest live implementation of the Stage 3I
// `modelAdapter.runRevision` boundary. It calls Pi's native OpenRouter provider
// with all repo/session/tool/resource surfaces disabled, parses the model's JSON
// edit payload, and returns only `{ edits:[{path,content}] }` to
// `makeModelRevision`. Presence = live: any OpenRouter model id is callable —
// there is no price/:free gating (spend is the backend billing ceiling's job).
//
// The prompt is built only from caller-declared fixture paths, bounds the
// outbound prompt payload before the provider call (CLI arg-size sanity), and
// failures throw stable codes only (no raw prompt, response, stderr, or path text).

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, sep } from "node:path";
import { validate } from "./schema.mjs";
import { REVISION_OUTPUT_SCHEMA } from "./revision-effect.mjs";
import { MODEL_ID_PATTERN } from "./public-values.mjs";

export const OPENROUTER_REVISION_CODES = Object.freeze({
  INVALID_CONFIG: "openrouter-revision-invalid-config",
  UNSAFE_INPUT_PATH: "openrouter-revision-unsafe-input-path",
  INPUT_UNREADABLE: "openrouter-revision-input-unreadable",
  INPUT_TOO_LARGE: "openrouter-revision-input-too-large",
  RUNNER_FAILED: "openrouter-revision-runner-failed",
  EMPTY_OUTPUT: "openrouter-revision-empty-output",
  RESPONSE_TOO_LARGE: "openrouter-revision-response-too-large",
  RESPONSE_NOT_JSON: "openrouter-revision-response-not-json",
  RESPONSE_MALFORMED: "openrouter-revision-response-malformed",
  RESPONSE_UNALLOWED_PATH: "openrouter-revision-response-unallowed-path",
});

export const OPENROUTER_REVISION_ADAPTER_CONFIG_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["model", "cwd", "allowed_paths", "instruction"],
  properties: {
    model: { type: "string", pattern: MODEL_ID_PATTERN },
    cwd: { type: "string", minLength: 1 },
    allowed_paths: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    instruction: { type: "string", minLength: 1 },
    max_input_bytes: { type: "integer", minimum: 1 },
    timeout_ms: { type: "integer", minimum: 1 },
    max_output_bytes: { type: "integer", minimum: 1 },
  },
});

export const DEFAULT_MAX_INPUT_BYTES = 32_768;

export class OpenRouterRevisionAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = "OpenRouterRevisionAdapterError";
    this.code = code;
  }
}

function fail(code) {
  throw new OpenRouterRevisionAdapterError(code);
}

function isUnsafeRelativePath(rel) {
  return typeof rel !== "string"
    || rel.length === 0
    || rel.includes("\0")
    || isAbsolute(rel)
    || rel.includes("..");
}

function resolveFixturePath(cwd, realCwd, rel) {
  if (isUnsafeRelativePath(rel)) return { code: OPENROUTER_REVISION_CODES.UNSAFE_INPUT_PATH };
  const full = join(cwd, rel);
  try {
    const st = lstatSync(full);
    if (st.isSymbolicLink() || !st.isFile()) return { code: OPENROUTER_REVISION_CODES.UNSAFE_INPUT_PATH };
    const real = realpathSync(full);
    if (real !== realCwd && !real.startsWith(realCwd + sep)) return { code: OPENROUTER_REVISION_CODES.UNSAFE_INPUT_PATH };
    return { full, exists: true, bytes: st.size };
  } catch (error) {
    if (!error || error.code !== "ENOENT") return { code: OPENROUTER_REVISION_CODES.INPUT_UNREADABLE };
    try {
      const parentReal = realpathSync(dirname(full));
      if (parentReal !== realCwd && !parentReal.startsWith(realCwd + sep)) {
        return { code: OPENROUTER_REVISION_CODES.UNSAFE_INPUT_PATH };
      }
      return { full, exists: false, bytes: 0 };
    } catch {
      return { code: OPENROUTER_REVISION_CODES.UNSAFE_INPUT_PATH };
    }
  }
}

function fixtureRefs(config) {
  let realCwd;
  try {
    realCwd = realpathSync(config.cwd);
  } catch {
    fail(OPENROUTER_REVISION_CODES.UNSAFE_INPUT_PATH);
  }

  return config.allowed_paths.map((rel) => {
    const resolved = resolveFixturePath(config.cwd, realCwd, rel);
    if (resolved.code) fail(resolved.code);
    return { path: rel, ...resolved };
  });
}

function promptBuilder(maxInputBytes) {
  let bytes = 0;
  const parts = [];
  const reserve = (n) => {
    if (!Number.isInteger(n) || n < 0 || bytes + n > maxInputBytes) {
      fail(OPENROUTER_REVISION_CODES.INPUT_TOO_LARGE);
    }
  };
  const push = (text) => {
    const chunk = String(text);
    const n = Buffer.byteLength(chunk, "utf8");
    reserve(n);
    bytes += n;
    parts.push(chunk);
  };
  return {
    push,
    reserve,
    finish() {
      return parts.join("");
    },
  };
}

function appendFixture(builder, fixture, isLast) {
  builder.push(`--- ${fixture.path} ---\n`);
  if (fixture.exists) {
    // Count the file payload before reading it. This closes the live-boundary
    // exposure gap: an oversized allowlisted fixture refuses before provider
    // invocation, and usually before the large file is loaded into memory.
    builder.reserve(fixture.bytes);
    let content = "";
    try {
      content = readFileSync(fixture.full, "utf8");
    } catch {
      fail(OPENROUTER_REVISION_CODES.INPUT_UNREADABLE);
    }
    builder.push(content);
  }
  builder.push(`\n--- end ${fixture.path} ---`);
  if (!isLast) builder.push("\n");
}

function buildPrompt(config, revisionInput, ctx) {
  const maxInputBytes = config.max_input_bytes ?? DEFAULT_MAX_INPUT_BYTES;
  const refs = fixtureRefs(config);
  const paths = config.allowed_paths.map((p) => JSON.stringify(p)).join(", ");
  const prompt = promptBuilder(maxInputBytes);

  for (const line of [
    "You are Prime's Stage 3J live builder adapter.",
    "Return ONLY JSON. Do not use Markdown fences unless forced by the interface.",
    'The JSON schema is exactly: {"edits":[{"path":"<allowed path>","content":"<complete file content>"}]}',
    `Allowed edit paths: ${paths}`,
    "Edit only those paths. Do not include explanations, diffs, comments, or extra keys.",
    `Task: ${config.instruction}`,
    `Revision metadata: iteration=${revisionInput?.iteration ?? "null"} previous_ref=${revisionInput?.previous_revision_ref ?? "null"} run=${ctx?.run_id ?? "null"}`,
    "Synthetic/public fixture files:",
  ]) {
    prompt.push(line);
    prompt.push("\n");
  }

  refs.forEach((fixture, index) => appendFixture(prompt, fixture, index === refs.length - 1));
  return prompt.finish();
}

function stripAnsi(text) {
  return String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");
}

function jsonFromFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1].trim() : null;
}

function jsonFromBalancedObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse a live model response into the exact Stage 3I revision output shape.
 * Returns stable codes on refusal and never includes raw response text in errors.
 *
 * @param {string} text stdout from the Pi/OpenRouter model call
 * @param {{allowed_paths:string[]}} opts adapter path allowlist
 * @returns {{ok:true,value:{edits:Array<{path:string,content:string}>}}|{ok:false,code:string}}
 */
export function parseOpenRouterRevisionResponse(text, opts = {}) {
  const clean = stripAnsi(text).trim();
  if (!clean) return { ok: false, code: OPENROUTER_REVISION_CODES.EMPTY_OUTPUT };

  const jsonText = jsonFromFence(clean) ?? (clean.startsWith("{") ? clean : jsonFromBalancedObject(clean));
  if (!jsonText) return { ok: false, code: OPENROUTER_REVISION_CODES.RESPONSE_NOT_JSON };

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, code: OPENROUTER_REVISION_CODES.RESPONSE_NOT_JSON };
  }

  if (!validate(REVISION_OUTPUT_SCHEMA, parsed, "$").valid) {
    return { ok: false, code: OPENROUTER_REVISION_CODES.RESPONSE_MALFORMED };
  }
  const allowed = new Set(Array.isArray(opts.allowed_paths) ? opts.allowed_paths : []);
  for (const edit of parsed.edits) {
    if (!allowed.has(edit.path) || isUnsafeRelativePath(edit.path)) {
      return { ok: false, code: OPENROUTER_REVISION_CODES.RESPONSE_UNALLOWED_PATH };
    }
  }
  return { ok: true, value: parsed };
}

function appendCapped(current, chunk, maxBytes) {
  const next = current + chunk;
  if (Buffer.byteLength(next, "utf8") <= maxBytes) return { text: next, tooLarge: false };
  return { text: next.slice(0, maxBytes), tooLarge: true };
}

function defaultRunPi({ model, prompt, timeout_ms, max_output_bytes }) {
  return new Promise((resolve) => {
    const args = [
      "--provider", "openrouter",
      "--model", model,
      "--approve",
      "--no-session",
      "--no-tools",
      "--no-context-files",
      "--no-skills",
      "--no-themes",
      "--no-prompt-templates",
      "--no-extensions",
      "-p", prompt,
    ];
    const child = spawn("pi", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" },
    });
    let stdout = "";
    let stderr = "";
    let tooLarge = false;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ status: null, stdout: "", stderr: "", timed_out: true, too_large: false });
      settled = true;
    }, timeout_ms);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (tooLarge) return;
      const next = appendCapped(stdout, chunk, max_output_bytes);
      stdout = next.text;
      tooLarge = next.tooLarge;
      if (tooLarge) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      if (tooLarge) return;
      const next = appendCapped(stderr, chunk, max_output_bytes);
      stderr = next.text;
      tooLarge = next.tooLarge;
      if (tooLarge) child.kill("SIGTERM");
    });
    child.on("error", () => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({ status: null, stdout: "", stderr: "", timed_out: false, too_large: false });
    });
    child.on("close", (status) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({ status, stdout, stderr, timed_out: false, too_large: tooLarge });
    });
  });
}

/**
 * Create the live OpenRouter modelAdapter implementation for Stage 3I.
 *
 * @param {object} config
 * @param {string} config.model OpenRouter model id
 * @param {string} config.cwd repo root containing synthetic/public fixture files
 * @param {string[]} config.allowed_paths exact repo-relative paths the model may edit
 * @param {string} config.instruction task instruction over those fixture files
 * @param {number} [config.max_input_bytes=32768] maximum outbound prompt payload
 * @param {number} [config.timeout_ms=120000]
 * @param {number} [config.max_output_bytes=65536]
 * @param {object} [deps]
 * @param {Function} [deps.runPi] injectable runner for tests
 * @returns {{runRevision:function,calls:number}}
 */
export function createOpenRouterRevisionAdapter(config, deps = {}) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async runRevision(revisionInput, ctx = {}) {
      if (!validate(OPENROUTER_REVISION_ADAPTER_CONFIG_SCHEMA, config, "$").valid) {
        fail(OPENROUTER_REVISION_CODES.INVALID_CONFIG);
      }

      const prompt = buildPrompt(config, revisionInput, ctx);
      const runner = deps.runPi ?? defaultRunPi;
      calls += 1;
      const result = await runner({
        model: config.model,
        prompt,
        timeout_ms: config.timeout_ms ?? 120_000,
        max_output_bytes: config.max_output_bytes ?? 65_536,
      });
      if (!result || result.too_large) fail(OPENROUTER_REVISION_CODES.RESPONSE_TOO_LARGE);
      if (result.timed_out || result.status !== 0) fail(OPENROUTER_REVISION_CODES.RUNNER_FAILED);
      const parsed = parseOpenRouterRevisionResponse(result.stdout, { allowed_paths: config.allowed_paths });
      if (!parsed.ok) fail(parsed.code);
      return parsed.value;
    },
  };
}
