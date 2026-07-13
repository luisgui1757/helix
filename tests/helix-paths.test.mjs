import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { helixStateRoot, piAgentDir } from "../extensions/lib/helix-paths.mjs";

test("Helix state follows an explicit Pi agent directory", () => {
  const env = { PI_CODING_AGENT_DIR: "./tmp/pi-agent" };
  assert.equal(piAgentDir(env), resolve("./tmp/pi-agent"));
  assert.equal(helixStateRoot(env), resolve("./tmp/pi-agent/helix"));
});

test("HELIX_STATE_DIR overrides only the Helix state root", () => {
  const env = {
    PI_CODING_AGENT_DIR: "./tmp/pi-agent",
    HELIX_STATE_DIR: "./tmp/helix-state",
  };
  assert.equal(piAgentDir(env), resolve("./tmp/pi-agent"));
  assert.equal(helixStateRoot(env), resolve("./tmp/helix-state"));
});
