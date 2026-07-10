# Plan / answer capture (manual)

Stands in for the future plan-mode + `\answer` resolver (Phase 2). Uses only Pi natives
(`examples/extensions/plan-mode`, `PLAN.md`, `/new`) + this template. Keep it short — a
plan is revised, not an immutable ledger (ROADMAP §9-Q5).

## When to capture

- Before implementing anything non-trivial (blast radius > a typo).
- Whenever **more than one valid gold standard** exists — record the choice and why.

## Plan template (save as `PLAN.md` in the worktree, then `/new` before implementing)

```md
# Plan: <one-line goal>

CGS (canonical gold standard): <the first-principles best approach for this task>
Source of truth for "done": <tests | lint | typecheck | a named check | explicit acceptance>

Steps (each with a verification check):
1. <step> — verify: <check>
2. <step> — verify: <check>

Done when: <the checkable stopping criterion>
Out of scope: <what this change will NOT touch>
```

## `\answer` capture (when >1 gold standard is valid)

Until the resolver is built, record the decision inline in `PLAN.md`:

```md
## Answer: <the question with multiple valid answers>
Top recommendation: <option> — because <reason tied to this task's real constraints>
Ranked alternatives:
  2. <option> — <when it would win>
  3. <option> — <when it would win>
Chosen: <option> (by <maintainer/agent>, <date>)
```

## Rules

- **Objective gate is primary.** The plan is advisory; the named check in "Done when" is
  the source of truth. If no checkable stopping criterion exists, stop and ask.
- **Context separation:** persist the distilled plan to `PLAN.md`, then `/new` (clear
  context) before implementing — do not carry the whole planning transcript forward.
- **Public-safe:** `PLAN.md` may be committed; keep secrets, tokens, and payloads out.
- **No-spend:** if you used a model to plan, obey the cost policy in
  `../provider-and-egress-posture.md`.
