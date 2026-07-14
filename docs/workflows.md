# Workflow cookbook

Helix workflows are named, declarative state machines for Pi. The quickest safe
path is:

```text
/helix-workflow-create
/helix-workflows show quality-loop
/helix-workflows test quality-loop
/helix-run quality-loop -- Implement the requested change
/helix-run-watch <run-id>
```

Saving deploys a personal workflow immediately: it appears in `/helix-run`
completion and the workflow catalog. Built-ins are immutable. Use
`/helix-workflow-edit`, `/helix-workflow-clone`, and `/helix-workflow-delete`
for the rest of the lifecycle.

## Mental model

Each stage has a panel, a durable output, a pass ceiling, and one condition
family. A matching condition moves the state machine:

```text
○ plan
    reviewer=approve → implement
    reviewer=revise ↻ plan
○ implement
    reviewer=approve → complete
    reviewer=revise ↻ implement
    reviewer=revise-jump ↩ plan
```

`→` advances or stops, `↻` retries the current stage, and `↩` returns to a
named earlier stage. During a run, `●` marks the current stage, `✓` a completed
stage, and the line includes its observed pass count.

## Good defaults

| Choice | Default | Guidance |
|---|---|---|
| Template | `implement-review` | Use `plan-implement` for risk or `tdd-fix` for bugs. |
| Objective check | Command | Prefer a repository-owned check such as `npm test`; file text is weaker. |
| Stage passes | 3 | Lower for deterministic stages; raise only for a specific retry need. |
| Total passes | 6 | Must cover all expected stages and backtracking. |
| Whole-run deadline | 10 minutes | Hard limit for the complete workflow. |
| Provider-call deadline | 2 minutes | Starts before Pi session/resource creation. |
| Maximum concurrency | 2 | Applies to read-only panels; writer panels always serialize. |
| Cast | `daily` | A mock skeleton until the user overlays configured Pi models. |
| Repository | Current confirmed repository | Other-repository targets are refused. |

The builder recommends a command based on `package.json`, `Cargo.toml`, or
`pyproject.toml`, then falls back to `git diff --check`. It verifies that the
executable exists before save. Commands are an argv vector, not shell text, so
tokens such as `&&`, redirection, expansion, and pipelines have no shell meaning
and are passed only as literal arguments.

## What is required and allowed

| Block | Required | Allowed |
|---|---|---|
| Workflow | Yes | Safe unique id, description, known task class, stages, stop block, deployment block. |
| Stage | 1–16 | Unique lowercase id, optional label, 1–16 ordered role steps, 1–8 transitions, one output. |
| Role step | At least one candidate | `scout`, `planner`, `builder`, `reviewer`, `redteam`; optional final `verifier`. |
| Stage output | Every personal stage | Safe repository-relative path outside `.git`; kind `plan`, `brief`, or `notes`. |
| Condition family | One per stage | Complete verdict family, complete gate family, or `always` fallback. |
| Action | Every condition | `advance`, `retry`, `back` to an earlier stage, or `stop` with a stable code. |
| Objective check | Exactly one | Bounded `command-exit-zero` or contained `file-contains`. |
| Deployment | Exactly one | Default/per-stage cast, bounded concurrency, current repository, structural refs. |

Planner and builder are writer roles. Any stage containing one runs its candidate
panel serially against the shared worktree. Panels made only of scout, reviewer,
red-team, and verifier roles are read-only and can use bounded concurrency; the
runner writes their structured aggregate output. A personal workflow cannot
declare arbitrary shell, filesystem, local-check, or handoff effect steps.

Validation also caps ids at 64 characters, descriptions and step notes at 512,
labels at 128, artifact paths and file markers at 256, stop codes and executable
names at 128, command arguments at 32 × 256, command timeouts at 10 minutes,
whole-run time at one hour, and the serialized definition at 64 KiB. Global and
per-stage pass rails are positive integers no greater than 10,000. The guided UI
offers deliberately smaller practical choices. On-disk JSON is refused above
256 KiB before parsing, so whitespace cannot bypass the input boundary.

## Example 1: implement and review

Run `/helix-workflow-create`, choose **Implement and review**, keep three stage
passes and six total passes, and choose **Run a command** with `npm` and `test`.
The generated stage routes reviewer approval forward and both revision verdicts
back through the implementation stage. This is the smallest evaluator/optimizer
loop: a builder produces work and a reviewer decides whether to iterate.

## Example 2: plan, implement, and jump back

Choose **Plan, implement, review**. In the implementation stage, set:

```text
reviewer=approve     → advance
reviewer=revise      ↻ retry implement
reviewer=revise-jump ↩ back to plan
```

Use `revise-jump` when the defect invalidates the plan rather than just the
implementation. A back target must already appear earlier in the stage order;
the builder refuses moves or removals that would make it forward-pointing.

## Example 3: concurrent read-only audit

Add an `audit` stage with `scout`, `reviewer`, `redteam`, and `verifier`, no
planner or builder, an `AUDIT.json` notes output, and verdict routing from the
reviewer. Set maximum concurrency to 4. The four model calls may overlap because
none receives mutation tools. Helix owns the aggregate output and preserves the
configured cap. Add a later builder stage if the workflow should act on the
audit.

## Example 4: weaker file-text fallback

If the repository has no independent check, select **Check text in a stage
output** and choose an exact marker such as `REVIEW_APPROVED`. The checked path
must be one of the declared outputs. This proves only that the text exists; a
model can write it, so it is not equivalent to a repository-owned test command.

## Programmatic definition

The guided builder is recommended, but the deployed format is stable JSON. A
complete one-stage definition looks like this:

```json
{
  "schema_version": 1,
  "id": "quality-loop",
  "description": "Implement, review, and verify the repository tests",
  "task_class": "routine-code",
  "source": "user",
  "stages": [
    {
      "id": "implement",
      "label": "Implement and review",
      "max_passes": 3,
      "steps": [
        { "id": "implement", "kind": "role", "role": "builder" },
        { "id": "review", "kind": "role", "role": "reviewer" }
      ],
      "transitions": [
        { "when": { "type": "verdict", "role": "reviewer", "is": "approve" }, "action": "advance" },
        { "when": { "type": "verdict", "role": "reviewer", "is": "revise" }, "action": "retry" },
        { "when": { "type": "verdict", "role": "reviewer", "is": "revise-jump" }, "action": "retry" }
      ],
      "artifact": { "path": "implementation.md", "kind": "notes" }
    }
  ],
  "stop": {
    "max_iterations": 6,
    "max_runtime_ms": 600000,
    "objective_gate": {
      "type": "command-exit-zero",
      "command": "npm",
      "args": ["test"],
      "timeout_ms": 120000
    }
  },
  "deployment": {
    "chain_id": "quality-loop",
    "call_timeout_ms": 120000,
    "role_matrix": "mock-core-loop",
    "assignments": {},
    "default_assignment": { "kind": "composite", "preset": "daily" },
    "parallel": { "max_concurrency": 2 },
    "run_target": { "repo": "self" },
    "input_refs": [],
    "claims_ref": "local-ref:claims/quality-loop",
    "evidence_ref": "local-ref:evidence/quality-loop"
  }
}
```

`role_matrix` is the required compatibility binding and currently must remain
`mock-core-loop`; the effective workflow cast comes from `assignments`,
`default_assignment`, and any active user profile.

Deploy it as `quality-loop.json` in
`~/.pi/agent/helix/workflows/`, or under `$HELIX_STATE_DIR/workflows/` when that
override is set. The filename must equal `<id>.json`, the entry must be a regular
file rather than a symlink, the id cannot shadow a built-in, and every file in
the directory must validate or the catalog refuses closed. Use
`/helix-workflows test quality-loop` immediately after deployment.

## What “test” proves

| Layer | Executed | Proves |
|---|---|---|
| Definition | Always | Shape, bounds, routes, targets, stop codes, ceilings, output declarations, success simulation. |
| Deployment | Always | Cast/provider resolution, target, runtime limits, objective executable availability. |
| Runtime smoke | Optional TUI confirmation | Real staged runner, artifacts, transitions, checkpoints, cleanup; zero provider calls and simulated gate outcomes. |
| Real run | Separate attended action | Provider behavior and the actual objective command/file check for the user task. |

Smoke success is not task success. A real run can still fail because a provider,
tool, repository test, deadline, or user code behaves differently. Conversely,
a failed definition or deployment check prevents runtime effects entirely.

## Canonical workflow principles

Helix follows the composable workflow pattern described in
[Anthropic's workflow documentation](https://code.claude.com/docs/en/workflows)
and [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):
predefined control flow, small reusable role blocks, explicit routing,
evaluator/optimizer loops, bounded parallelization, objective stopping criteria,
durable state, and visible progress. Helix deliberately keeps arbitrary code out
of stage definitions; the repository-owned objective command is a narrow,
consent-visible checker rather than a general workflow scripting surface.
