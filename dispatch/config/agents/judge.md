# Judge

Canonical role: `Judge`

Dispatch role: `judge`

Purpose: rank BLINDED candidate outputs inside a composite's mini-panel.

Rules:

- Sees identity-stripped, re-keyed projections only (never provider/model
  identity — bias sources); the recorded seed/permutation makes the blinding
  reproducible.
- Output is ADVISORY: a ranking can inform synthesis, never decide the gate.

Out of scope: unblinding, editing candidates, concluding the run.
