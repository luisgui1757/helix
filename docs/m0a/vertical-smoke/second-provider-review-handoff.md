# Manual second-provider review handoff

Stands in for the future adversarial / multi-team review substrate (Phase 3). Until that
exists, a "review" is a **manual handoff to a second, cross-family model** whose output is
advisory — the objective gate remains the real decision (ROADMAP §7-Theme B).

## When

Meaningful work: plans, risky changes, security/architecture, and PR preflight. Skip for
typos and obvious one-liners.

## Pick an independent reviewer

- **Different model family** from the author (diversity is what pays off — ROADMAP §7-B).
- **No-spend / cheapest:** Phase-3 no-spend tests use only mock providers plus
  metadata-verified OpenRouter `:free` models over synthetic/public fixtures.
  GitHub Copilot is personal/maintainer-profile only with a current pinned eligible
  model; **no Claude live-billing probe**; Azure Foundry postponed
  (`../provider-and-egress-posture.md`).
- Example: author on provider A → review with a `:free` OpenRouter model of a different
  family, or a second Codex/Copilot model. Record which model reviewed.

## Handoff packet (public-safe)

Give the reviewer:

1. The **diff** or the specific files/lines (no secrets, no `auth.json`, no payloads).
2. The **CGS + "Done when"** from `PLAN.md`.
3. The reviewer prompt below.

```
You are an independent reviewer from a different model family. Review this change
against its stated CGS and "Done when" gate. Lead with material findings, each with:
severity, exact location, why it is wrong, a reproduction/trace, the source of truth,
a multi-location check, a recommended fix, and confidence. If there are no material
findings, say so and name any test/verification gaps. Do not rubber-stamp; try to
refute the change.
```

## Capture the result (advisory, not authority)

- Record findings and their disposition (accepted → fix + test; rejected → reason) in the
  PR body or a `reviews/` note. **Preserve rejected findings with rationale** (contract).
- **Convergence is objective:** the change is done when the **gate passes**
  (tests/lint/typecheck/`npm run check:resources`/lockdown smoke), not when a model says
  "looks good." A model "I agree" is never the stopping signal.

## Rules

- Cross-family, no-spend by default, objective gate primary, no secrets in the packet.
