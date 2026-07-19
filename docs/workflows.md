# WorkflowDefinition v4 guide

Helix runs one closed intermediate representation: WorkflowDefinition v4. The
guided builder and kernel-compatible legacy personal definitions are
compatibility inputs that normalize before hashing, consent, persistence, and
execution; host-only legacy steps refuse rather than being dropped. JSON import
and the programmatic builder produce v4 directly. User programs generate data;
Helix never executes them as workflow code.

## Fast path

```text
/helix-workflow-create
/helix-workflows show quality-loop
/helix-workflows test quality-loop
/helix-run quality-loop -- Implement and verify the change
/helix-run-watch <run-id>
```

Use the guided `implement-review`, `plan-implement`, or `tdd-fix` template unless
you need parallel, map/reduce, checkpoint, or subworkflow nodes.

## Required document

A v4 definition has exactly these top-level fields and no unknown fields:

- `schema_version: 4`, safe `id`, display `name`, `description`, positive
  `version`, and `source` (`user` or `built-in`);
- a closed `inputs` JSON schema, `start`, and keyed `nodes` object;
- explicit `limits`, `provider_policy`, `workspace_policy`, and
  `objective_gate`.

There must be exactly one successful terminal and exactly one `final: true`
gate. Its `on_pass` is the successful terminal's only incoming edge; every
reachable non-terminal must be able to reach it. The final gate has no local
`gate` field: it always executes the one top-level `objective_gate`. Unknown
targets, unreachable nodes, recursive/nested-depth-two subworkflows, and
unbounded cycles refuse.

The input schema is a bounded closed subset for object, array, string, number,
integer, and boolean values. The root is always a closed object and requires a
non-empty `task`; every accepted integer interval contains at least one safe
integer. Declared fields may add descriptions, defaults, and bounds. The attended runner prompts
for every non-task field: blank accepts a declared default, omits an optional
field, or refuses a required field without a default. String values preserve
spaces; enter `""` to supply an explicit empty string. It validates the
complete object before creating a run and binds it to resume identity.

## Nodes

| Kind | Purpose | Important requirements |
|---|---|---|
| `agent` | One typed role effect | exact role, stage id, schema, tools, mutation, timeout, retry, next |
| `pipeline` | Ordered agent handoff | 1–16 inline agents, next, `max_visits` |
| `parallel` | Bounded fan-out/fan-in | 1–64 branches, 1–16 concurrency, abort/settle policy |
| `map` | Agent over a typed array | JSON pointer, 0–256 items, failure policy |
| `reduce` | Deterministic aggregation | collect, count, or bounded-separator concat |
| `decision` | Closed routing | typed conditions, typed default edge, optional loops-off target |
| `gate` | Deterministic evidence | non-final: local file/argv gate; final: top-level objective only |
| `checkpoint` | Attended pause | stable reason and next; resume is the continue action |
| `subworkflow` | Reuse a named graph | exact id/version, maximum nesting depth one |
| `terminal` | End state | succeeded, failed, refused, or cancelled |

Conditions support `always`, scalar `eq`/`neq`/ordering/`contains`, boolean
`and`/`or`, and `not` over safe JSON pointers. No JavaScript, shell, template
evaluation, or implicit truthiness is allowed. Missing paths do not match.

Agent fields are executable contracts, not descriptive metadata. `role` is one
of `scout`, `planner`, `builder`, `reviewer`, `redteam`, or `documenter`;
`prompt` is exactly `tracked-step-v1`; non-reviewers use `semantic-v2`, while a
reviewer may use `semantic-v2` or `verdict-v1`. The runtime receives the exact
declared tool allowlist and mutation mode. Read-only roles cannot declare a
mutating mode, and a read-only agent cannot receive `bash`, `edit`, or `write`.
The only supported workspace policy is
`canonical-worktree`/`unchanged`/`off`; alternative persisted policy values
refuse rather than being ignored.

Deterministic mock adapters execute the complete validated tools and mutation
contract. Exact real Pi execution currently supports one read-only, tool-free
provider turn with transport retries disabled. Tool-bearing or mutating real
definitions refuse before credential or provider-control access rather than
silently changing the contract or hiding extra provider turns inside one
kernel effect.

## Defaults and ceilings

These values are exported once as `WORKFLOW_LIMITS`; checked-in exact/one-over
tests cover the principal document, graph, input, condition, and workspace
boundaries.

| Concern | Default | Absolute ceiling |
|---|---:|---:|
| Workflow identifiers / names / descriptions | — | 64 / 128 / 1,024 characters |
| Workflow version | 1 | 1,000,000 |
| Workflow nodes | — | 256 |
| Serialized workflow definition | — | 256 KiB |
| Workflow JSON read envelope | — | 512 KiB |
| Canonical public-helper serialization | — | 2 MiB, depth 64 |
| Input schema depth / object fields | — | 4 / 32 |
| Serialized runtime input | — | 1 MiB |
| Input descriptions / string values | — | 256 / 65,536 characters |
| JSON pointer / one pointer segment | — | 512 / 128 characters |
| Agent prompt / tools | tracked prompt / role tools | 16,384 characters / 16 tools |
| Agent effects | 32 | 1,000 |
| Concurrency | 4 | 16 |
| Parallel branches / pipeline agents | — | 64 / 16 |
| Map and input-array items | 16 | 256 |
| Decision transitions | — | 16 |
| Condition depth / boolean width | — | 32 / 8 |
| Allowed failure codes | — | 16 |
| Explicit node visits | 3 in builders | 32 |
| Implicit node visits | — | min(effects + nodes, 1,256) |
| Explicit attempts / retry backoff | 1 / 0 | 3 / 60 seconds |
| Whole run, cumulative across continuations | 30 minutes | 8 hours |
| One model call | 10 minutes | 1 hour |
| Gate marker / command / arguments | — | 256 chars / 128 chars / 32 × 256 chars |
| Gate timeout | — | 10 minutes |
| Reduce separator / checkpoint reason | — | 32 / 128 characters |
| Structured repair | 2 declared | 2 |
| Scheduler payload / private checkpoint document | — | 15 MiB / 16 MiB |
| Effect journal | — | 8 MiB, identical write/read ceiling |

Retries and panel members are effects: every actual model invocation consumes
the shared effect/token/cost budget and appears in observed events. A panel's
first wave is reserved atomically so a one-effect limit cannot launch two calls.
Structured-output repair is another actual invocation, consumes the same
lifetime budget, and stops at `limits.structured_repair_attempts`. Usage from a
failed completed call remains counted. Definition budget maxima cannot be raised
by resume or an injected scheduler ledger. A child invocation enforces its own
declared effect ceiling through a checkpointed scoped ledger while also
consuming the shared parent lifetime budget. The effective allowance is always
the lower remaining ceiling; a later child invocation receives a fresh local
allowance without resetting the parent total. On continuation, every nested
child effect, token, cost, and reservation total must be contained by the
enclosing parent snapshot or the checkpoint refuses before execution. The root
totals must also cover durable journal-prefix usage and checkpointed calls not
yet represented there; resetting all nested levels together still refuses.
Loop-disabled mode follows an explicit `loops_off` target. Every decision edge
whose target can reach that decision—including a forward-entry edge and a
cyclic default—must be marked `loop: true`. The loops-disabled graph must prove
that `loops_off` cannot return to the decision; a decision may declare
`loops_off` only when it has an actual cyclic `loop: true` edge. An acyclic
marker or invalid escape refuses and cannot make an otherwise unreachable node
appear reachable. The kernel never guesses how to escape a cycle.

Read-only agents may use only read/search tools. `shared-serialized` writers run
under one writer mutex with private before-state checkpoints.
`isolated-proposal` writers run in disposable real Git worktrees, then promote
only when the canonical workspace still has the exact captured fingerprint.
Conflict or cleanup ambiguity refuses; Helix does not auto-resolve semantics.
Repeated visits use distinct agent, map, parallel, and child-run identities.
Continuation accepts a completed entry only when its exact journal record,
visit, recursively nested child state, and budget state all validate.

## Programmatic example

```js
import {
  agent, decision, objectiveGate, pipeline, terminal, workflow,
} from "pi-helix/dispatch/workflow/builder.mjs";

const objective = {
  type: "command-exit-zero",
  command: "npm",
  args: ["test"],
  timeout_ms: 120000,
};

const reviewer = agent({
  role: "reviewer",
  stage_id: "review",
  output_schema: "verdict-v1",
  mutation: "read-only",
  timeout_ms: 120000,
  retry: { max_attempts: 2, backoff_ms: 1000 },
});

const built = workflow({
  id: "quality-loop",
  name: "Quality loop",
  description: "Review, remediate, and prove the repository objective.",
  start: "review",
  nodes: {
    review: pipeline([reviewer], "route", { max_visits: 3 }),
    route: decision([
      {
        when: {
          op: "eq",
          path: "/outputs/review/by_role/reviewer/recommendation",
          value: "approve",
        },
        target: "objective",
      },
      {
        when: {
          op: "eq",
          path: "/outputs/review/by_role/reviewer/recommendation",
          value: "revise",
        },
        target: "review",
        loop: true,
      },
    ], "failed", { loops_off: "objective" }),
    objective: objectiveGate("succeeded", "review", {
      loops_off: "failed",
    }),
    succeeded: terminal("succeeded"),
    failed: terminal("failed", "review-condition-unmatched"),
  },
  objective_gate: objective,
});

if (!built.ok) throw new Error(JSON.stringify(built.errors));
process.stdout.write(`${JSON.stringify(built.definition, null, 2)}\n`);
```

Write that output to a repository-relative file and deploy it in an attended Pi
TUI. Import receives Pi's current model inventory and validates the complete
parent/direct-child deployment before asking for mutation confirmation:

```text
/helix-workflows import quality-loop.json
```

The builder also exports non-final `gate`, plus `parallel`, `map`, `reduce`,
`checkpoint`, and `subworkflow`. All constructors return ordinary JSON and use
the same defaults as the validator. `decision` emits a typed default edge;
pass `{ default_loop: true, loops_off: "…" }` when that default is a bounded
back edge.

## Common patterns

### Evaluator/optimizer

Pipeline a mutating builder into a read-only reviewer. A decision routes
`approve` to the final objective gate and `revise` back to the pipeline. Both the
pipeline's `max_visits` and global effect ceiling bound the loop.

### Parallel panel

Use `parallel([scout, reviewer, redteam], "reduce", { max_concurrency: 3 })`.
Output order follows definition order, not completion order. `failure: "abort"`
is the safe default; `settle` also requires explicit `allow_failure_codes` and
preserves only failures explicitly classified by the scheduler as agent
failures. Scheduler/runtime integrity, identity, policy, workspace, budget,
cancellation, and final-gate failures are structurally non-maskable regardless
of an authored code allowlist. After the first decisive abort result, workers
claim no new branches/items. Only already-started work settles, and reserved
capacity for every unstarted effect is released deterministically.

### Map/reduce

Map a read-only agent over `/inputs/items` with an explicit `max_items`, then
reduce `/outputs/map-node` by `collect`, `count`, or `concat`. Oversized arrays
refuse before child dispatch.

### Checkpoint and subworkflow

A checkpoint pauses after its durable scheduler/workspace commit and is shown
as paused with the exact resume command. The attended resume supplies a
one-shot continue action bound to that exact node visit; a later visit pauses
again. A child checkpoint is namespaced beneath its parent and consumes the
same one-shot consent exactly once. A subworkflow pins both id and version,
shares the parent lifetime budget/journal/workspace while retaining its own
effect ceiling, emits nested structural events, and may not
invoke another subworkflow. Runtime smoke resolves the same pinned direct child
bundle as product execution and includes child nodes, effects, and transitions
in its observed counts. Deployment preflight, provider inventory, and consent
likewise include every direct child's effective cast. The child must accept
every normalized parent input; incompatible closed schemas refuse before
import, consent, or run creation. Gate-only parents and parents whose model
work exists only in a child are valid deployments.

The 256 KiB definition ceiling applies to canonical JSON. Helix saves v4 files
in that canonical form plus one trailing newline. Readers allow a separate
bounded 512 KiB transport envelope so historical or imported pretty-printed
JSON can be parsed and then checked against the canonical limit. Run copies,
watch, and resume accept the exact canonical limit plus that newline.

## Objective gates

Prefer `command-exit-zero`: Helix executes a bounded argv vector with
`shell: false`. `file-contains` is useful when no repository checker exists but
is weaker because a model can write the marker. Only the one final gate can
produce success. Every other node field—including final-gate `on_fail` and
`loops_off`—is structurally forbidden from targeting the successful terminal.

## What testing proves

`/helix-workflows test` proves the closed definition, reachability, targets,
bounds, cast resolution, and objective-gate availability with zero provider
calls. It reports v4 edges as structurally validated, never as executed. The
optional smoke normalizes to v4 and executes one deterministic path through the
real Workflow Kernel in a disposable worktree; it reports the nodes, effects,
and edges actually observed and does not claim unvisited branches. Only an
attended real run plus its deterministic gate proves the user's task.
