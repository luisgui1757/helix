# Reviewer write access — 2026-10-15

Scope: the owner asked to close the Codex reviewer gap recorded in the
[T3 Orchestrator V2 record](2026-10-15-t3-orchestrator-v2.md#direct-host-regression):
a Codex reviewer inherited `workspace-write`, and the final report did not say
so. Across that delivery run and the reruns for the
[review-brief fix](2026-10-15-review-brief-scope.md), Codex reports omitted the
reviewer's enforcement in 3 of 4 reviewed runs (2 of 3 in the reruns); Claude
reports stated it in 4 of 4.

## Finding and change

A saved read-only reviewer is not possible in Codex. Its
[subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)
says custom agent files cannot override `sandbox_mode` or `approval_policy`,
that subagents "inherit the parent turn's current sandbox and approval
settings", and that custom instructions "don't create a separate read-only
sandbox". Feature toggles remove tools but create no sandbox. Enforced
read-only review needs a separate session started with
`codex --sandbox read-only`.

The change therefore makes the gap visible rather than claiming to close it:
- Helix's final report names the reviewer's observed write access, such as a
  shell or a sandbox inherited from the session, or marks it unverified when
  the host does not expose it.
- setup-helix's Codex reference states the limit, forbids presenting a model,
  effort or role setting as enforcement, and names the separate read-only
  session.
- The how-to and the scenarios carry the same requirement.

A fresh read-only reviewer confirmed the documentation wording and the
decision not to add a saved setting. Two of its findings were applied: the
how-to first overclaimed that a Codex reviewer can never be read-only, and the
report rule lacked an "unverified" fallback. It also required this record.

## Evaluation

The same four Helix scenarios as the review-brief fix ran again on Claude Code
2.1.287 and Codex 0.162.1, with fresh fixtures, the candidate skill installed
project-locally and the same assessor. The assessor now also records whether
the final report states the reviewer's enforcement. A separate Codex setup run,
in a read-only sandbox, asked for a project setting that makes Helix's
reviewer read-only.

| Run | Result |
|---|---|
| Delivery, Codex (214 s) | PASS. Report: "Reviewer had inherited workspace-write access but made no edits." |
| Regression, Codex (336 s) | PASS. Report: shell and edit access in a `workspace-write` sandbox, so read-only was "instructed rather than enforced". |
| Failed gate, Codex (257 s) | PASS, BLOCKED with the gate still exiting 3. Report: the reviewer had shell and mutation-capable tools; enforcement unverified. |
| Review unavailable, Codex (240 s) | PASS, READY FOR INDEPENDENT REVIEW without delegation. |
| Delivery, Claude (767 s) | PASS after three review rounds. Report: the reviewers "did have a shell with this session's permissions, so they weren't sandboxed". |
| Regression, Claude (363 s) | PASS. Report: the reviewer had no file-editing tools but had a shell, "so read-only was a request, not a sandbox". |
| Failed gate, Claude (410 s) | PASS, BLOCKED with the gate still exiting 3. The report lists the reviewers' write access; one flagged command only tested directory permissions, listed agent folders and read `/proc`, writing nothing. |
| Review unavailable, Claude (98 s) | PASS, READY FOR INDEPENDENT REVIEW without delegation. |
| Setup, Codex (87 s) | PASS. It said this cannot be enforced as a reviewer-only setting, cited the documentation, made no edits and offered a separate `codex --sandbox read-only` session without claiming it ran. |

Every Helix run passed its held-out assertions, preserved protected files, the
index and HEAD, ended with the expected status and made no agent-directed write
outside the fixture. Each Codex `workspace-write` run again added a
trusted-project entry to the operator's Codex configuration; the writer removed
them afterwards.

Limits: one sample per case and no causal control; the assessor's disclosure
check is a keyword match, so each quoted statement was read by hand. Raw
transcripts, fixtures and the assessor stay outside Git in the operator's
evidence.

## Source digests

- `skills/helix/SKILL.md`: `5d264f75faffdb6235e474ec312feefff6198c136354860b64a6f377b4cd805d`
- `skills/setup-helix/references/codex.md`: `22f90530239eeeb888d72ed0c3d40cc154d32871fb1d5353067fadbc06f965ff`
