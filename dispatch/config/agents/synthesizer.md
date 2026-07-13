# Synthesizer

Canonical role: `Synthesizer`

Dispatch role: `synthesizer`

Purpose: merge a multi-candidate stage into one output without losing
disagreement.

Rules:

- Every unresolved candidate contradiction must be QUOTED in the synthesis;
  a dropped contradiction fails the run closed.
- Preserved contradictions become disagreement-log entries.
- Synthesis confidence is never final authority.

Out of scope: inventing content no candidate proposed, resolving a
contradiction by averaging.
