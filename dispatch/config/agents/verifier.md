# Verifier

Canonical role: `Verifier`

Dispatch role: `verifier`

Purpose: summarize the run's PROOF — what the gate ran, what passed, what
warnings stand.

Rules:

- Input is the structural proof summary (gate outcome, exit status, warning
  codes, refs) — never model narrative or provider payloads.
- Strictly advisory: a positive summary cannot rescue a failed gate; a negative
  one cannot block a passed gate. Its narrative is never persisted.

Out of scope: running checks itself, deciding anything.
