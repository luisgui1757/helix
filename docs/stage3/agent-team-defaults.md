# Stage 3K — lean agent-team defaults

> **Historical implementation record — not current operational documentation
> (superseded 2026-07-10).** This page preserves what the named stage shipped at
> the time. Some mechanisms may still exist, but cost/no-spend policy, token
> budgets, write allowlists, live enablement, and the referenced live smoke
> commands were later removed; no task-loop live transport ships. Use the
> [current design contracts](design-contracts.md) and [manual](../manual.md) for
> current behavior. Do not treat commands here as runnable unless they also
> appear in those current documents.


Stage 3K adds the first default agent-team artifact for the long-lived task loop:
a minimal Builder plus independent-provider Reviewer team. It is deliberately a
config/markdown slice, not a new command. Stage 3L/M/N now supplies the per-role
model matrix that enforces the Reviewer independence requirement against concrete
provider specs.

Source of truth: ROADMAP Theme J ("Agent teams") and Stage 3A role identity rules.

## What shipped

| Piece | Responsibility |
| --- | --- |
| `dispatch/config/agent-team-defaults.json` | Additive lean team config: `Builder` and `Reviewer`; Reviewer declares provider independence from Builder. |
| `dispatch/lib/agent-team.mjs` | Validates team artifacts, maps canonical role IDs to existing dispatch roles, and projects routing/log views that ignore cosmetic aliases. |
| `docs/stage3/agents/builder.md` | Markdown role artifact for the Builder default. |
| `docs/stage3/agents/reviewer.md` | Markdown role artifact for the Reviewer default and its independence requirement. |
| `tests/dispatch-agent-team.test.mjs` | Canonical role stability, default validation, duplicate/unknown/mismatched role fail-closed checks, and alias-does-not-route/log regressions. |

## Contract

- Canonical agent-team IDs are exactly `Scout`, `Planner`, `Builder`, `Reviewer`,
  `Documenter`, and `RedTeam`.
- Existing dispatch role-envelope IDs remain lowercase (`builder`, `reviewer`,
  `redteam`, etc.). `agent-team.mjs` owns the explicit bridge.
- Defaults are additive: users add roles; the shipped default is not a hidden
  six-role organization.
- Cosmetic callsigns are display-only. They may affect a display label, but never
  `role_ids`, `dispatch_roles`, `log_roles`, provider independence, routing, or
  public records.
- Reviewer independence is a config requirement enforced by Stage 3L/M/N matrix
  expansion against concrete provider/model specs.

## Failure posture

The validator fails closed when:

- a role is missing its canonical ID;
- a cosmetic alias is used as the canonical ID;
- a canonical ID is duplicated;
- the lower-case dispatch role does not match the canonical ID mapping;
- a provider-independence reference points at a role not present in the team;
- defaults are not additive.

## Running

```bash
npm test                              # includes tests/dispatch-agent-team.test.mjs
```

No live or paid model call is part of this slice.
