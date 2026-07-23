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
/helix-run quality-loop --execution-mode graph-mode -- Implement and verify the change
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

## Graph interpretation and execution modes

WorkflowDefinition v4 already is the definition graph. Helix compiles admitted
definitions into a canonical graph with locale-independent Unicode code-unit
node-id order and authored-order outgoing edges. Stable edge ids encode the source and authored
port: `node:next`, `node:condition:<index>`, `node:default`, `node:pass`,
`node:fail`, and `node:loops-off`. Forward/reverse reachability, path queries,
strongly connected components, runtime edges, and loops-disabled edges use this
single representation. Duplicate endpoints stay distinct because edge identity
is not just `(from,to)`.

`original-mode` remains the default direct field interpreter. `graph-mode` is a
secondary resolver that selects the typed edge and refuses missing or ambiguous
routes. Everything after target selection—including effects, parallel/map
behavior, budgets, retry, workspace transactions, journals, checkpoints,
subworkflows, gates, and terminals—is identical shared kernel code. Graph-mode
does not introduce implicit readiness, fan-out, joins, dataflow, or a second
workflow language.

Graph-mode consent identity also sorts preset ids and pinned `id@version` child
keys by Unicode code unit, so the same confirmed inputs hash identically under
every host locale. Original-mode deliberately retains its legacy locale-aware
ordering and serialized shape; existing original-mode binding hashes do not
change.

Planned views include nodes, compatible `targets`, typed edges, final-gate and
success ids, and cycle analyses without condition values. Observed views join
graph-mode transition edge ids directly and reject a missing or inconsistent
edge identity. Endpoint inference is restricted to legacy/original streams; if
several authored ports share an endpoint, the traversal is explicitly
ambiguous. Every nonempty parent/child stream starts with an exact definition,
mode, run, and sequence binding; each event kind has closed required/optional
fields. Unknown or extra fields, wrong definition hashes, invalid statuses,
missing start bindings, lifecycle drift, and mode/state drift refuse. Observed
output includes parent and pinned depth-one child graphs with explicit
current/last positions; child transition identity is retained in parent events.
Child run ids are derived from the exact parent run, node, and visit. A gate's
recorded `final` flag must match the authored node, and its result must agree with
the next pass/fail/loops-off edge. Effects are admitted only on effect-capable
nodes. Each completion or ordinary resume closes an exact open reference; a
retained effect that is already closed emits no second completion.
Journal-ahead reconciliation emits a distinct recovered-effect event because
the durable prefix has no public start to close. Instance reuse refuses, while
repair/retry binds the exact failed agent attempt, failure class, authored retry
ceiling, and definition repair ceiling. Runtime expansion cannot raise the
authored retry maximum. Every agent-bearing visit records a structural
`effect-plan` slot count before invocation evidence. Successful completion then
requires all agent, pipeline-stage, parallel-branch, or map-item slots; pipeline
stages settle in order, panel member indices are contiguous, later attempts have
an explicit controlling retry/repair event, and each final outcome is either
successful or an authored settled-agent allowlist match. An empty map is the
only zero-slot executable visit. A successful parent subworkflow visit cannot
end or transition until its exact child stream ends successfully. That retained
terminal proof remains authoritative only while resuming the same parent node
and visit. Node/run completion refuses while an
effect is open. A succeeded run-end must match the authored succeeded terminal
after an observed final-gate pass. A complete failed/refused/cancelled result
instead ends at the current nonterminal node with the exact code; completed
public state must match either admitted run-end. Closed private checkpoints bind
the exact terminal status/code and return it idempotently on direct replay.
Checkpoint-derived continuation exists only after an earlier durable snapshot;
failure of the first checkpoint leaves the product record incomplete and
nonresumable with an empty committed prefix. The direct scheduler may return a
closed failure, but without private checkpoint authority the public record
cannot claim completion; watch remains available for the initialization state.
Historical schema-4 child wrappers remain
watchable only as opaque original-mode progress and never borrow mutable child
definitions to claim nested authority.

New scheduler checkpoints bind the exact ordered event history, including
forwarded child wrappers, through a rolling canonical ref: original-mode uses
schema 4 and graph-mode schema 5. Public schema-5 state carries the same ref.
The event path must be a regular non-symlink file no larger than 64 MiB before
watch or resume reads it. An unauthoritative valid suffix is shown only up to
the recorded committed prefix by both current and legacy active watch, and is
truncated only after resume authenticates that prefix.
Schemas 1/2/3 and legacy public schema 4 remain readable history but cannot
authorize continuation. Active watch renders exactly the checkpointed prefix,
so a valid-looking suffix left by an interrupted sink cannot become observed
authority; any alteration inside the retained prefix refuses. Public count/ref
advances only from a committed private checkpoint. Before any resume effect,
Helix requires the caller to supply and authenticate that exact parent prefix
and derives every child prefix from its exact parent wrappers. An omitted
prefix refuses as firmly as a changed one.
Public event and journal counts are safe, nonnegative cardinalities across run
discovery, watch, resume rendering, and actual continuation. They may lag the
private scheduler only under its durable projection-debt marker, never lead it,
and are repaired and durably cleared before provider certification. Failure to
clear that marker refuses the resume without granting adapter access.
Nonterminal private state requires incomplete public state. A private terminal
requires schema-2 projection debt; if public state is already complete, its
terminal status, code, and node must exactly match the private marker. That
matching case is a maintenance retry which clears debt before certification;
every other cross-document combination refuses before projection writes.
Terminal repair also passes the scheduler's canonical resume admission before
any projection write: task, definition, mode, runtime cast, immutable budgets,
journal evidence, authored terminal semantics, and the exact final event pair
must all agree. A forged terminal leaves the event file, public state, and
private debt byte-for-byte unchanged.

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
executing run namespace, visit, recursively nested child state, and budget state
all validate. Current schema-3 journal records persist that namespace and effect
identities include it; readable schema-1/2 records cannot prove an active
continuation.

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
`checkpoint`, and `subworkflow`. Pure graph construction helpers include
`fragment`, `sequence`, `conditional`, `evaluatorOptimizerLoop`,
`fanOutReduce`, and `composeFragments`. They namespace and rewrite supported
control targets and local output pointers, and refuse collisions, unknown
ports, dangling targets/pointers, accessors, proxies, cycles, excessive depth,
executable values, and size limits without invoking author input. Proxy inputs
are detected before reflection, and canonical UTF-8 input is admitted only
through the exact `max_canonical_bytes` boundary before structured cloning. All
constructors return ordinary JSON and use the same validator. `decision` emits
a typed default edge;
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
capacity for every unstarted effect is released deterministically. The
decisive result remains the node's terminal failure even when an earlier-indexed
retrying sibling later observes the stop; that synthetic sibling result is not
reported as operator cancellation.

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

Journal-ahead in-flight results retain their exact node, instance, base
invocation, and mutation bindings. Moving a result identity between parallel or
map members refuses before any continuation call.

The 256 KiB definition ceiling applies to canonical JSON. Helix saves v4 files
in that canonical form plus one trailing newline. Readers allow a separate
bounded 512 KiB transport envelope so historical or imported pretty-printed
JSON can be parsed and then checked against the canonical limit. Run copies,
watch, and resume accept the exact canonical limit plus that newline.

## Objective gates

Prefer `command-exit-zero`: Helix executes a bounded argv vector with
`shell: false` behind an observation-only OS boundary. macOS uses a deny-by-
default sandbox profile; Linux uses user, mount, network, and PID namespaces
plus IPC isolation, a minimal read-only chroot, and dropped capabilities before
the authored argv starts. macOS admits only explicit candidate, runtime,
dependency, and fixed system read roots. Both expose a private ephemeral temp
area and a self-contained sanitized Git database/index containing only the
admitted current HEAD tree and staged objects. Its 64 MiB pack ceiling fails
closed; host history, object storage, remotes, credentials, and the candidate's
physical `.git` metadata are absent. macOS admits top-level candidate entries
other than `.git`; Linux masks either an in-tree metadata directory or linked-
worktree pointer file. Admission also denies the linked worktree's per-worktree
administration and resolved shared common directories. Both
remove ambient credential variables and deny network access. Unsupported platforms or
missing boundary tooling refuse command-gate preflight. `file-contains` is
useful when no repository checker exists but is weaker because a model can
write the marker. Only the one final gate can produce success. Every other node
field—including final-gate `on_fail` and `loops_off`—is structurally forbidden
from targeting the successful terminal. Cancellation and the whole-run
deadline are checked after every fresh or resumed active node-entry checkpoint
and before an exact terminal `node-end`/`run-end` status/code pair is published.
If observed there, interruption wins. Once that pair and its terminal checkpoint are
durably committed, the terminal status is final; cancellation arriving during
the successful checkpoint write cannot make the direct result, persisted
state, or watch view contradict the run. The completed public state is written
within that checkpoint transaction; projection failure leaves durable debt, and
resume repairs the exact terminal from its authenticated marker before effects.

The command observation is bound to exact before/after workspace fingerprints.
Named and staged runs create a private guard snapshot before the command and
restore any detected drift; restoration or guard cleanup uncertainty fails the
gate structurally and cannot route through `on_fail`. Unconfirmed termination,
sandbox, fingerprint, and cleanup uncertainty are likewise non-routable; only a
real checker exit produces `pass` or `fail`. External checker executables are
admitted as exact files; no parent-directory grant is inferred, and any read
root containing the candidate refuses. Linux containment helpers come only from
fixed trusted system/Nix roots, never authored `PATH`. Nix closure discovery
uses a fixed helper and private configuration/home against the local daemon
store with plugins, substituters, and builders disabled; ambient Nix remotes,
credentials, configuration, and `PATH` cannot run during preparation. Host fingerprint/private-
view discovery similarly uses fixed Git with closed configuration and
replacement refs disabled. Fingerprints read indexed metadata and bounded
physical tracked/untracked bytes without Git content conversion, so local
clean/process filters cannot execute. Ambient `PATH`, Git repository-targeting
values, and replacement refs cannot redirect preparation. Symlinks contribute
their target text without dereference; non-regular entries are structural. The evidence ref covers the command identity, sandbox mode, fingerprints,
result, and guard status. A checker that needs build output must consume output
created by a counted candidate effect; the gate itself cannot write the
candidate or an outside path. Timeout/cancellation sends a process-group kill
and waits for confirmed close before cleanup, fingerprint, restore, or evidence.
If confirmation exceeds its bound, Helix preserves the guard/scratch state and
returns `objective-gate-termination-unconfirmed`; it never samples a possibly
live process as final evidence. Confirmed pre-abort, timeout, spawn failure, and
process error remain typed `error` results rather than authored `fail`; staged
compatibility execution rejects every malformed gate shape before routing.
Before a command gate launches, the scheduler checkpoints its exact run,
definition, node, visit, and objective identity; before routing, it checkpoints
the closed pass/fail/error result. Resume reuses a settled result and returns an
unknown outcome for an in-flight or unconfirmed result, so it never relaunches
the command to discover what happened. Cancellation or the run deadline that
wins first replaces a late pass/fail before it can become durable routing
evidence.

## What testing proves

`/helix-workflows test` proves the closed definition, reachability, targets,
bounds, cast resolution, and objective-gate availability with zero provider
calls. It reports v4 edges as structurally validated, never as executed. The
optional smoke normalizes to v4 and executes the same deterministic path in
both execution modes through the real Workflow Kernel from independent
identical disposable worktrees. Complete normalized result, output, visit,
budget, ordered trace, journal-structure, and final-workspace drift refuses;
only documented mode/run/time-derived identity differs. It reports the nodes,
effects, and edges actually observed and does not claim unvisited branches.
Both disposable worktrees are bound to one exact replacement-disabled commit,
pre-admit one immutable raw-tree manifest, and only then populate raw indexed
blobs without checkout filters. The manifest bounds object ids, modes, byte
paths, prefix collisions, individual and aggregate bytes, and file count before
worktree registration. POSIX path and symlink-target bytes are preserved
exactly. A disposable pre-registration tree materializes and byte-enumerates
the complete path/type skeleton, verifies every regular-file executable bit and
symlink payload, and must be removed successfully; arbitrary filesystem
collision behavior is never approximated with Unicode transforms. Physical
fingerprints use the same bounds and configuration-sterile Git metadata.
Cleanup independently removes and reconciles every Git registration and every
derived lexical/physical checkout identity against the filesystem; uncertainty
preserves the recovery root. Objective-sandbox preparation verifies scratch
cleanup on every refusal after creation, prioritizes cleanup failure, and rolls
back an opened workspace guard if preparation throws.
The deterministic candidate writes required synthetic artifacts inside its
counted workspace transaction. Artifact verification hashes that real file and
the authored file/command objective checker executes against the worktree; a
command checker uses the same read-only sandbox and fingerprint guard as a
named run. Neither host observer invents a reference, route, or convergence
marker. The model/task semantics remain simulated even though the authored gate
check is real.
The repository gate additionally reruns the complete kernel adversarial suite
under graph-mode, covering retry/repair, fan-out settlement, budgets, workspace
rollback/conflict, journal recovery, capacity, nested continuation,
cancellation, and deadlines through the secondary resolver.
Only an attended real run plus its deterministic gate proves the user's task.
