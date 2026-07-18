# Workflow architecture assumptions and rejected findings

Append-only provider, policy, and architecture ledger.

## 2026-07-16

Assumptions requiring periodic revalidation:

- Provider policy entries expire on 2026-08-15. Expiry exact-disables new
  sessions until official documentation is reviewed again.
- Pi `>=0.80.7 <0.81.0` is the supported volatile runtime range. Changed public
  exports or response identity fields require a seam/matrix update.
- OpenRouter's official request fields remain `only`, `order`,
  `allow_fallbacks`, `require_parameters`, `data_collection`, and `zdr`; the
  returned `provider` remains the route evidence required by exact mode.
- Pi's OpenRouter stream continues to carry model and provider identity in raw
  SSE chunks even though AgentSession omits the route. The localhost audit proxy
  exact-disables the path if that wire evidence disappears or changes shape.
- Account handles must come from official session/status evidence. A configured
  credential or caller-copied label is not entitlement proof.
- Account handles are not filesystem paths: provider-issued repeated dots are
  valid, while whitespace and control characters remain invalid. Raw handles
  stay memory-only; durable records carry only attestation references.

Rejected findings / false alarms:

- “Adopt a dynamic-workflows package as the kernel”: rejected. Neither package
  simultaneously preserves Helix exact multi-provider binding, effect-aware
  workspace recovery, and current operator UX. No source or fixtures from the
  unlicensed Michaelliv repository were copied.
- “Use CLIProxyAPI as the provider spine”: rejected. Pool rotation, aliases,
  fallback, account invisibility, and protocol translation violate exact tuple
  and instruction-boundary invariants.
- “Build on Claude Agent SDK/Workflow JavaScript”: rejected as the global
  substrate because it cannot satisfy the required provider breadth. It remains
  a possible future Claude-specific runtime beneath the same kernel.
- “A Git worktree is an OS sandbox”: rejected. Documentation consistently calls
  it Git-state isolation and leaves tool/process authority explicit.
- “Requested model/effort proves effective identity”: rejected. Requested-only
  evidence exact-disables the path.

## 2026-07-18

New durable invariants:

- The top-level `objective_gate` is the sole final objective authority. A final
  gate node contains routing only; no other node field may target the succeeded
  terminal, and terminal/resume success requires its recorded pass evidence.
- V4 definition checks distinguish structurally validated edges from edges
  actually observed in a kernel run. One deterministic smoke path is not branch
  coverage and is never presented as such.
- A standalone live-certification proof is not ambient product authorization.
  `require_live_certification: true` refuses before provider preflight unless
  the selected adapter can present current live-certified evidence.

Rejected findings / bounded false alarms:

- “Stock templates currently bypass the final gate”: rejected. Their v1-to-v4
  migration already produced a single-gated graph. The defect was reachable
  through supported native-v4 import and programmatic construction, so the
  validator/runtime fix was still mandatory.
- “The first full-suite deadline failure proves a scheduler regression”:
  rejected after the unchanged test returned the correct timeout code, passed
  alone in 1.23s, and passed in the next complete 647-test run. No timing
  threshold, test, or legacy runner behavior was changed.
