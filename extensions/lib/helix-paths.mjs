// Installed Helix resources are immutable package data. Mutable settings,
// profiles, and run records live beside Pi's user configuration so package
// updates cannot erase them and repository checkouts stay clean.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function piAgentDir(env = process.env) {
  const configured = env.PI_CODING_AGENT_DIR;
  return typeof configured === "string" && configured.length > 0
    ? resolve(configured)
    : join(homedir(), ".pi", "agent");
}

export function helixStateRoot(env = process.env) {
  const configured = env.HELIX_STATE_DIR;
  return typeof configured === "string" && configured.length > 0
    ? resolve(configured)
    : join(piAgentDir(env), "helix");
}
