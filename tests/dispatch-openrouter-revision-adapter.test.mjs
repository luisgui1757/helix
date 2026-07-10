import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOpenRouterRevisionAdapter,
  parseOpenRouterRevisionResponse,
  OPENROUTER_REVISION_CODES,
  OpenRouterRevisionAdapterError,
} from "../dispatch/lib/openrouter-revision-adapter.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "prime-openrouter-rev-"));
}

function baseConfig(cwd, overrides = {}) {
  return {
    model: "openai/gpt-oss-20b:free",
    cwd,
    allowed_paths: ["proposal.txt"],
    instruction: "replace the synthetic proposal with the requested marker",
    ...overrides,
  };
}

test("OpenRouter revision parser accepts strict and fenced JSON edits", () => {
  const strict = parseOpenRouterRevisionResponse(
    '{"edits":[{"path":"proposal.txt","content":"ok\\n"}]}',
    { allowed_paths: ["proposal.txt"] },
  );
  assert.equal(strict.ok, true, JSON.stringify(strict));
  assert.deepEqual(strict.value, { edits: [{ path: "proposal.txt", content: "ok\n" }] });

  const fenced = parseOpenRouterRevisionResponse(
    '```json\n{"edits":[{"path":"proposal.txt","content":"ok2\\n"}]}\n```',
    { allowed_paths: ["proposal.txt"] },
  );
  assert.equal(fenced.ok, true, JSON.stringify(fenced));
  assert.deepEqual(fenced.value.edits, [{ path: "proposal.txt", content: "ok2\n" }]);
});

test("OpenRouter revision parser fails closed on non-JSON, malformed, or unallowlisted edits", () => {
  const cases = [
    ["", OPENROUTER_REVISION_CODES.EMPTY_OUTPUT],
    ["not json", OPENROUTER_REVISION_CODES.RESPONSE_NOT_JSON],
    ['{"edits":[]}', OPENROUTER_REVISION_CODES.RESPONSE_MALFORMED],
    ['{"edits":[{"path":"proposal.txt"}]}', OPENROUTER_REVISION_CODES.RESPONSE_MALFORMED],
    ['{"edits":[{"path":"other.txt","content":"x"}]}', OPENROUTER_REVISION_CODES.RESPONSE_UNALLOWED_PATH],
    ['{"edits":[{"path":"../outside.txt","content":"x"}]}', OPENROUTER_REVISION_CODES.RESPONSE_UNALLOWED_PATH],
    ['{"edits":[{"path":"/abs/outside.txt","content":"x"}]}', OPENROUTER_REVISION_CODES.RESPONSE_UNALLOWED_PATH],
  ];
  for (const [text, code] of cases) {
    const parsed = parseOpenRouterRevisionResponse(text, { allowed_paths: ["proposal.txt", "../outside.txt", "/abs/outside.txt"] });
    assert.equal(parsed.ok, false, text);
    assert.equal(parsed.code, code, text);
  }
});

test("OpenRouter revision parser accepts sensitive-shaped paths when allowlisted by the adapter task", () => {
  const parsed = parseOpenRouterRevisionResponse(
    '{"edits":[{"path":".env","content":"SYNTHETIC=1\\n"}]}',
    { allowed_paths: [".env"] },
  );
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.deepEqual(parsed.value, { edits: [{ path: ".env", content: "SYNTHETIC=1\n" }] });
});

test("OpenRouter adapter runs any model id, including non-:free ids, through the injected runner", async () => {
  const cwd = tmp();
  try {
    writeFileSync(join(cwd, "proposal.txt"), "base\n", "utf8");
    let seen = null;
    const paid = createOpenRouterRevisionAdapter(baseConfig(cwd, { model: "openai/gpt-oss-20b" }), {
      runPi(args) {
        seen = args;
        return { status: 0, stdout: '{"edits":[{"path":"proposal.txt","content":"paid ok\\n"}]}' };
      },
    });

    const result = await paid.runRevision({ iteration: 1 }, { run_id: "r" });
    assert.deepEqual(result, { edits: [{ path: "proposal.txt", content: "paid ok\n" }] });
    assert.equal(paid.calls, 1);
    assert.equal(seen.model, "openai/gpt-oss-20b");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("OpenRouter adapter accepts sensitive-shaped fixture paths but still refuses traversal and absolute paths", async () => {
  const cwd = tmp();
  try {
    writeFileSync(join(cwd, ".env"), "SYNTHETIC_FIXTURE=1\n", "utf8");
    let sensitiveCalls = 0;
    const sensitive = createOpenRouterRevisionAdapter(baseConfig(cwd, { allowed_paths: [".env"] }), {
      runPi(args) {
        sensitiveCalls += 1;
        assert.match(args.prompt, /SYNTHETIC_FIXTURE=1/);
        return { status: 0, stdout: '{"edits":[{"path":".env","content":"SYNTHETIC_FIXTURE=2\\n"}]}' };
      },
    });
    const result = await sensitive.runRevision({ iteration: 1 }, { run_id: "r" });
    assert.deepEqual(result, { edits: [{ path: ".env", content: "SYNTHETIC_FIXTURE=2\n" }] });
    assert.equal(sensitiveCalls, 1);

    let unsafeCalls = 0;
    const runner = () => { unsafeCalls += 1; return { status: 0, stdout: "{}" }; };
    for (const path of ["../escape.txt", "/etc/passwd"]) {
      const unsafe = createOpenRouterRevisionAdapter(baseConfig(cwd, { allowed_paths: [path] }), { runPi: runner });
      await assert.rejects(
        () => unsafe.runRevision({ iteration: 1 }, { run_id: "r" }),
        (error) => error instanceof OpenRouterRevisionAdapterError
          && error.code === OPENROUTER_REVISION_CODES.UNSAFE_INPUT_PATH,
        path,
      );
    }
    const locatorModel = createOpenRouterRevisionAdapter(
      baseConfig(cwd, { model: "https:" + "/example.test/model" }),
      { runPi: runner },
    );
    await assert.rejects(
      () => locatorModel.runRevision({ iteration: 1 }, { run_id: "r" }),
      (error) => error instanceof OpenRouterRevisionAdapterError
        && error.code === OPENROUTER_REVISION_CODES.INVALID_CONFIG,
    );
    assert.equal(unsafeCalls, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("OpenRouter adapter builds a synthetic prompt, invokes the injected runner, and returns parsed edits", async () => {
  const cwd = tmp();
  try {
    writeFileSync(join(cwd, "proposal.txt"), "base\n", "utf8");
    let seen = null;
    const adapter = createOpenRouterRevisionAdapter(baseConfig(cwd), {
      runPi(args) {
        seen = args;
        return {
          status: 0,
          stdout: '```json\n{"edits":[{"path":"proposal.txt","content":"base\\nmarker\\n"}]}\n```',
        };
      },
    });

    const result = await adapter.runRevision({ iteration: 1, previous_revision_ref: null }, { run_id: "r-iter1" });
    assert.deepEqual(result, { edits: [{ path: "proposal.txt", content: "base\nmarker\n" }] });
    assert.equal(adapter.calls, 1);
    assert.equal(seen.model, "openai/gpt-oss-20b:free");
    assert.match(seen.prompt, /Allowed edit paths: "proposal.txt"/);
    assert.match(seen.prompt, /base/);
    assert.match(seen.prompt, /Return ONLY JSON/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("OpenRouter adapter refuses an oversized outbound prompt before invoking the runner", async () => {
  const cwd = tmp();
  try {
    writeFileSync(join(cwd, "proposal.txt"), "x".repeat(1024 * 1024), "utf8");
    let runnerCalls = 0;
    const adapter = createOpenRouterRevisionAdapter(baseConfig(cwd, { max_input_bytes: 1024 }), {
      runPi() {
        runnerCalls += 1;
        return { status: 0, stdout: '{"edits":[{"path":"proposal.txt","content":"ok"}]}' };
      },
    });

    await assert.rejects(
      () => adapter.runRevision({ iteration: 1 }, { run_id: "r" }),
      (error) => error instanceof OpenRouterRevisionAdapterError
        && error.code === OPENROUTER_REVISION_CODES.INPUT_TOO_LARGE,
    );
    assert.equal(adapter.calls, 0, "adapter call count increments only after the prompt cap passes");
    assert.equal(runnerCalls, 0, "runner is never invoked for an oversized prompt");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("OpenRouter adapter runner and parse failures expose only stable codes", async () => {
  const cwd = tmp();
  try {
    writeFileSync(join(cwd, "proposal.txt"), "base\n", "utf8");
    const PRIVATE = "PRIVATE_RESPONSE_PAYLOAD_123";

    const badOutput = createOpenRouterRevisionAdapter(baseConfig(cwd), {
      runPi() {
        return { status: 0, stdout: `not-json ${PRIVATE}` };
      },
    });
    await assert.rejects(
      () => badOutput.runRevision({ iteration: 1 }, { run_id: "r" }),
      (error) => error.code === OPENROUTER_REVISION_CODES.RESPONSE_NOT_JSON
        && !String(error.message).includes(PRIVATE),
    );

    const failedRunner = createOpenRouterRevisionAdapter(baseConfig(cwd), {
      runPi() {
        return { status: 1, stdout: "", stderr: PRIVATE };
      },
    });
    await assert.rejects(
      () => failedRunner.runRevision({ iteration: 1 }, { run_id: "r" }),
      (error) => error.code === OPENROUTER_REVISION_CODES.RUNNER_FAILED
        && !String(error.message).includes(PRIVATE),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
