# Plan-Mode Extension Guidance

Status: behavior-level guidance only, 2026-07-08. No slash UX is added here.

Prime's planning discipline is adopted by reference from `AGENTS.md` and the
Operating Contract. A future plan-mode extension may make that discipline easier
to follow, but it must not duplicate the full contract or create a sprawling
planning UI.

## Consolidated Plan Block

Use one concise block:

```md
CGS:
Alternatives considered:
Done when:
```

Rules:

- `CGS` names the canonical approach and source of truth.
- `Alternatives considered` lists only material tradeoffs.
- `Done when` names objective checks or explicit acceptance criteria.
- Keep it stakes-gated: trivial work does not need a ceremony block.
- Do not add slash commands in this PR.

`APPEND_SYSTEM.md` remains unnecessary unless a future Pi update proves context
or compaction drift. The current Pi `0.80.3` evidence shows context files live in
the system prompt and are not compacted away.
