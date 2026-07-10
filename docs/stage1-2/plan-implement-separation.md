# Plan / implement separation

**Native primitives already cover this — nothing is built.** Per the roadmap (§8,
§7-Theme F) and the "don't build speculative automation" rule, plan/implement separation
is: persist the distilled plan to `PLAN.md`, then clear context with the **native** `/new`
before implementing. `/new` is a Pi built-in (`BUILTIN_SLASH_COMMANDS`, "Start a new
session"); `PLAN.md` is a plain file. No extension or command is added.

## Why separate

Planning fills the context window with exploration, dead ends, and back-and-forth.
Carrying all of it into implementation wastes tokens and lets stale reasoning bias the
build. Distill the decision, drop the noise, implement from a clean slate.

## The exact flow (human + agent)

1. **Plan.** Explore and decide. Use the plan template + `\answer` capture in
   [`../m0a/vertical-smoke/plan-answer-capture.md`](../m0a/vertical-smoke/plan-answer-capture.md).
   State the CGS, the alternatives, and the checkable "Done when" gate.
2. **Distill to `PLAN.md`.** Write only what implementation needs: goal, CGS, steps each
   with a verification check, "Done when", and out-of-scope. Drop the transcript.
   `PLAN.md` may be committed; keep secrets/payloads out.
3. **Clear context: `/new`.** Start a fresh session. The distilled `PLAN.md` is on disk;
   the exploration is gone. (Pi's auto-compaction does not weaken the loaded Operating
   Contract — it lives in the system prompt, not the compacted message stream; see
   `../m0a/context-and-project-trust.md`. So the contract survives `/new` + reloading.)
4. **Implement** from `PLAN.md`, driving each step to its verification check.
5. **Gate.** Run the objective gate (`tools/loop/objective-gate-loop.sh --gate '<check>'`);
   it is the primary termination signal, not "the model thinks it's done".

## What is deliberately NOT built

- No `/plan` command (Pi ships a plan-mode *example* extension if richer plan-state is ever
  wanted; not adopted here).
- No PLAN.md scaffolder / auto-`/new` automation — it would be speculative over two native
  primitives (a file + `/new`).

If a concrete need appears (e.g. enforced plan-before-implement for a specific workflow),
revisit with source-verified Pi APIs — not before.
