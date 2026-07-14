// Shared executable ordering for workflow stage steps. Save-time validation and
// runtime use this one function so a persisted workflow cannot pass validation
// and later fail only because its role/check/handoff ordering is unsupported.

import { STAGE_ROLES } from "./role-envelope.mjs";

export function stageStepSchedule(stage) {
  const leading = [];
  const beforeVerification = [];
  const trailing = [];
  let phase = "leading";
  let candidateRoles = 0;
  for (let index = 0; index < (stage?.steps ?? []).length; index += 1) {
    const step = stage.steps[index];
    if (step.kind === "handoff") {
      if (stage.steps.slice(index + 1).some((candidate) => candidate.kind !== "handoff")) return null;
      continue;
    }
    if (step.kind === "role") {
      if (step.role === "verifier") {
        if (phase === "trailing" || phase === "verifier") return null;
        phase = "verifier";
      } else {
        if (!STAGE_ROLES.candidate.includes(step.role)
          || phase === "middle" || phase === "verifier" || phase === "trailing") return null;
        candidateRoles += 1;
        phase = "candidates";
      }
      continue;
    }
    if (step.kind !== "local-check") return null;
    if (phase === "leading") leading.push(step);
    else if (phase === "candidates" || phase === "middle") {
      phase = "middle";
      beforeVerification.push(step);
    } else {
      phase = "trailing";
      trailing.push(step);
    }
  }
  if (!stage.steps.some((step) => step.kind === "role" && step.role === "verifier")) {
    trailing.unshift(...beforeVerification.splice(0));
  }
  if (candidateRoles === 0) return null;
  return { leading, beforeVerification, trailing };
}
