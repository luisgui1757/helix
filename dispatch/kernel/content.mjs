// Typed prompt framing. This is defense in depth over the real authority
// boundary: repository/agent data never supplies tools, bindings, budgets,
// permissions, transitions, or gates.

import { createHash } from "node:crypto";

export const CONTENT_CLASSES = Object.freeze([
  "trusted-policy", "operator-task", "repository-data", "agent-output",
]);

export function frameContent(kind, value) {
  if (!CONTENT_CLASSES.includes(kind)) throw new Error("content-provenance-invalid");
  const serialized = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value ?? null);
  if (serialized.length > 64 * 1024) throw new Error("content-boundary-too-large");
  const marker = `HELIX_${createHash("sha256").update(`${kind}:${serialized}`).digest("hex").slice(0, 24).toUpperCase()}`;
  const neutralized = serialized.replaceAll(marker, "HELIX_MARKER_REMOVED");
  return `<${marker} class=${kind}>\n${neutralized}\n</${marker}>`;
}
