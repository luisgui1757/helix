// Helix effort vocabulary -> Pi public thinking-level policy.
//
// `default` and `provider-managed` intentionally leave the level to Pi/provider.
// Every other Helix effort is an explicit request. Pi normally clamps unsupported
// levels, so live ModelRegistry-backed dispatch must validate before session
// creation instead of silently running a different level.

const PI_EXPLICIT_LEVELS = new Set(["low", "medium", "high", "xhigh"]);

export const PI_EFFORT_CODES = Object.freeze({
  INVALID: "pi-effort-invalid",
  UNSUPPORTED: "pi-effort-unsupported",
  CAPABILITY_UNAVAILABLE: "pi-effort-capability-unavailable",
});

export function piThinkingLevelForEffort(effort = "default") {
  if (effort === "default" || effort === "provider-managed") return undefined;
  if (effort === "max") return "xhigh";
  if (PI_EXPLICIT_LEVELS.has(effort)) return effort;
  throw new Error(PI_EFFORT_CODES.INVALID);
}

export function resolvePiThinkingLevel(model, effort = "default") {
  const level = piThinkingLevelForEffort(effort);
  if (level === undefined) return undefined;
  if (!model?.reasoning) throw new Error(PI_EFFORT_CODES.UNSUPPORTED);
  const mapped = model.thinkingLevelMap?.[level];
  if (mapped === null || (level === "xhigh" && mapped === undefined)) {
    throw new Error(PI_EFFORT_CODES.UNSUPPORTED);
  }
  return level;
}

/** Closed, public-safe Helix effort values the exact Pi model can accept. */
export function supportedPiEfforts(model) {
  return ["default", "provider-managed", "low", "medium", "high", "xhigh", "max"]
    .filter((effort) => {
      try {
        resolvePiThinkingLevel(model, effort);
        return true;
      } catch {
        return false;
      }
    });
}
