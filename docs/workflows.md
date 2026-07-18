# WorkflowDefinition v4 guide

Helix runs one closed intermediate representation: WorkflowDefinition v4. The
guided builder and legacy personal definitions are compatibility inputs that
normalize before hashing, consent, persistence, and execution. JSON import and
the programmatic builder produce v4 directly. User programs generate data;
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
integer, and boolean values. The root requires a non-empty `task`; declared
fields may add descriptions, defaults, and bounds. The attended runner prompts
for every non-task field: blank accepts a declared default, omits an optional
field, or refuses a required field without a default. It validates the complete
object before creating a run and binds it to resume identity.

## Nodes

| Kind | Purpose | Important requirements |
|---|---|---|
| `agent` | One typed role effect | exact role, stage id, schema, tools, mutation, timeout, retry, next |
| `pipeline` | Ordered agent handoff | 1–16 inline agents, next, `max_visits` |
| `parallel` | Bounded fan-out/fan-in | branches, 1–16 concurrency, abort/settle policy |
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

## Defaults and ceilings

| Concern | Default | Absolute ceiling |
|---|---:|---:|
| Agent effects | 32 | 1,000 |
| Concurrency | 4 | 16 |
| Map items | 16 | 256 |
| Pipeline agents | — | 16 |
| Node visits | 3 in builders | 32 |
| Explicit attempts | 1 | 3 |
| Whole run | 30 minutes | 8 hours |
| One call | 10 minutes | 1 hour |
| Structured repair | 2 declared | 2 |
| Serialized definition | — | 256 KiB |

Retries and panel members are effects: every actual model invocation consumes
the shared effect/token/cost budget and appears in observed events. A panel's
first wave is reserved atomically so a one-effect limit cannot launch two calls.
Loop-disabled mode follows an explicit `loops_off` target; cyclic defaults must
be marked `loop: true`, and the kernel never guesses how to escape a back edge.

Read-only agents may use only read/search tools. `shared-serialized` writers run
under one writer mutex with private before-state checkpoints.
`isolated-proposal` writers run in disposable real Git worktrees, then promote
only when the canonical workspace still has the exact captured fingerprint.
Conflict or cleanup ambiguity refuses; Helix does not auto-resolve semantics.

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
TUI:

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
preserves those typed child failures but cannot mask
identity, policy, corruption, workspace, or final-gate failures.

### Map/reduce

Map a read-only agent over `/inputs/items` with an explicit `max_items`, then
reduce `/outputs/map-node` by `collect`, `count`, or `concat`. Oversized arrays
refuse before child dispatch.

### Checkpoint and subworkflow

A checkpoint pauses after its durable scheduler/workspace commit and is shown
as paused with the exact resume command. The attended resume supplies the
continue action. A child checkpoint is namespaced beneath its parent and
continues exactly once. A subworkflow pins both id and version, shares the
parent's budget/journal/workspace, emits nested structural events, and may not
invoke another subworkflow. Runtime smoke resolves the same pinned direct child
bundle as product execution.

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
