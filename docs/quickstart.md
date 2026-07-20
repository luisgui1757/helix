# Claudex HOW-TO

This is the canonical zero-to-first-workflow guide for Helix CC. Follow the
shared steps once, then use the section for your selected route.

## 1. Prerequisites and installation

Supported hosts are macOS and Linux/WSL environments that can run:

- Git;
- Node.js `22.19.0` or newer with npm;
- Claude Code `2.1.154` or newer, installed using Anthropic's
  [official installation and integrity-verification guide](https://code.claude.com/docs/en/installation).

Install from a fresh clone:

```bash
git clone https://github.com/luisgui1757/helix-cc.git
cd helix-cc
./setup.sh
```

Setup refuses a missing or outdated Claude Code installation. It does not
download or execute a mutable remote installer. After verifying Claude Code,
setup installs locked dependencies, prepares the pinned local gateway,
validates the plugin, and places `claudex` in `~/.local/bin` by default. If that
directory is not on the invoking shell's `PATH`, setup prints an exact command
like this:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Run the printed command for the current shell and add it to the startup file
setup names for future shells. Setup never edits that file automatically. A
custom directory can be selected with `./setup.sh --bin-dir /absolute/path`.

Verify the handoff:

```bash
command -v claudex
claudex --claudex-help
npm run verify
node bin/helix-cc-doctor --human
```

`claudex --claudex-help` verifies the Helix CC launcher. `claudex --version`
is forwarded to Claude Code and therefore reports the Claude Code version.

## 2. Shared route lifecycle

Every provider-backed route follows the same sequence:

1. Complete its one-time connection or local configuration.
2. Run `node bin/helix-cc-cliproxy status` for saved-state classification.
3. Run the exact `proof` or `proof-matrix` command.
4. Require a JSON receipt with `"status": "passed"`, the requested model,
   matching `workflowResolvedModels`, and `"markerMatched": true`.
5. Launch `claudex` with both `--providers` and an explicit `--model`.
6. Choose one of the supported skills in section 8 and confirm its displayed configuration. Write loops start one ephemeral signed-evidence session automatically; stop if the `helix-cc-evidence` MCP server is unavailable.
7. Require the loop-specific terminal result from section 8 (`approved: true`
   for write loops or `completed: true` for scout).
8. Exit Claude normally; the launcher stops every helper process it owns.

A successful route receipt has this shape (model values vary by route):

```json
{
  "status": "passed",
  "mainRequestedModel": "openai/gpt-5.6-luna",
  "workflowResolvedModels": ["gpt-5.6-luna"],
  "workflowAgentTranscripts": 1,
  "markerMatched": true
}
```

Catalog or doctor readiness is not a proof receipt. A dated receipt in
`docs/history/` is evidence for that historical run, not current route health.

## 3. Native Claude

From the repository you want to change:

```bash
cd /path/to/your/project
claudex
```

Complete Claude Code's normal first-run connection if prompted, then continue
at [Run the first delivery workflow](#8-run-the-first-delivery-workflow).
`claudex --native` overrides `CLAUDEX_PROVIDERS` for one invocation.

## 4. OpenAI subscription

One-time browser connection:

```bash
cd /path/to/helix-cc
node bin/helix-cc-cliproxy login
```

Use `login --device` when the browser callback cannot complete. Prove and
launch the promoted route:

```bash
node bin/helix-cc-cliproxy proof \
  --providers codex \
  --model gpt-5.6-luna

claudex --providers codex --model gpt-5.6-luna
```

Single-Codex mode uses the unprefixed model ID. Continue at
[Run the first delivery workflow](#8-run-the-first-delivery-workflow).

## 5. GitHub Copilot

One-time device connection, exact served-model pin, proof, and launch:

```bash
cd /path/to/helix-cc
node bin/helix-cc-cliproxy copilot-login
node bin/helix-cc-cliproxy copilot-pin --model gpt-5.4
node bin/helix-cc-cliproxy proof \
  --providers copilot \
  --model copilot/gpt-5.4

claudex --providers copilot --model copilot/gpt-5.4
```

Re-run `copilot-pin` when an alias begins returning a new dated snapshot. The
launcher has no implicit Copilot model: omitting `--model` is an error.
`copilot/gpt-5-mini` remains unpromoted because its latest controller proof
completed before its background Workflow agent.

Continue at [Run the first delivery workflow](#8-run-the-first-delivery-workflow).

## 6. OpenAI and Copilot together

Complete both one-time connection procedures and the Copilot pin, then run:

```bash
node bin/helix-cc-cliproxy proof-matrix \
  --providers codex,copilot \
  --models openai/gpt-5.6-luna,copilot/gpt-5.4

claudex \
  --providers codex,copilot \
  --model openai/gpt-5.6-luna
```

Mixed mode requires namespaced IDs. The launch model is the top-level
controller; individual workflow roles can use either proven namespaced model.

Continue at [Run the first delivery workflow](#8-run-the-first-delivery-workflow).

## 7. Azure Foundry GPT and Azure-containing mixes

Azure is implemented and locally tested, but no live route is promoted yet.
Configure an OpenAI-compatible `/openai/v1` endpoint and an exact
deployment-to-served-model map:

```bash
export HELIX_CC_AZURE_ENDPOINT='https://<resource>.services.ai.azure.com/openai/v1'
export HELIX_CC_AZURE_MODELS='{"<deployment>":{"servedModel":"<expected-served-model>","efforts":["low","medium","high"]}}'
export HELIX_CC_AZURE_API_KEY='<value>'
```

Instead of `HELIX_CC_AZURE_API_KEY`, omit it, install Azure CLI, and select the
subscription containing the deployment:

```bash
az login
az account set --subscription '<subscription-id-or-name>'
az account show --output none
```

The selected identity must be permitted to invoke the named deployment.

Prove Azure alone before launch:

```bash
node bin/helix-cc-cliproxy proof \
  --providers azure \
  --model azure/<deployment>

claudex --providers azure --model azure/<deployment>
```

For an Azure-containing mix, first prove every single route, then prove the
exact combination. Examples:

```bash
node bin/helix-cc-cliproxy proof-matrix \
  --providers codex,azure \
  --models openai/gpt-5.6-luna,azure/<deployment>

node bin/helix-cc-cliproxy proof-matrix \
  --providers copilot,azure \
  --models copilot/gpt-5.4,azure/<deployment>

node bin/helix-cc-cliproxy proof-matrix \
  --providers codex,copilot,azure \
  --models openai/gpt-5.6-luna,copilot/gpt-5.4,azure/<deployment>
```

Launch only after the exact matrix returns `"status": "passed"`. Choose one
advertised namespaced model as the explicit controller. Azure and every
Azure-containing mix remain unpromoted until their own live receipts pass.

## 8. Run the first delivery workflow

Start from the repository Helix CC should change, not from the Helix CC plugin
checkout. Choose the smallest loop whose contract matches the task:

| Loop | Command | Required extra inputs | Terminal success |
|---|---|---|---|
| Full cycle / plan-implement | `/helix-cc:helix-loop <task>` | Exact verification argv, pass bound, optional role models | `approved: true` plus a valid signed zero-exit receipt |
| Implement-review | `/helix-cc:helix-implement-review <task>` | Exact verification argv, pass bound, optional role models | `approved: true` plus a valid signed zero-exit receipt |
| TDD fix | `/helix-cc:helix-tdd-fix <bug>` | Exact allowed test paths, reproduction/final argv, red and fix bounds | `approved: true` plus signed in-scope red and zero-exit final receipts |
| Scout | `/helix-cc:helix-scout <question>` | Optional scout/planner models | `completed: true`; checkout remains unchanged |
| Research | `/helix-cc:helix-research <objective>` | Metric/unit, numeric comparator target, exact measurement/test argv, pass bound, optional plateau bound | `target-met` or valuable `dead-end` returns `approved: true`; `diminishing-returns` or `max-iterations` returns structured `approved: false` |
| Ship pre-PR | `/helix-cc:helix-ship-pre-pr <completed task>` | Exact GitHub repo/head/base, task paths, separate verification/release-check argv, commit and PR text, separate PR confirmation | `approved: true`, signed pushed full SHA, exact open/reused unmerged PR |

The skill collects and displays the structured inputs before launch. Do not use
the ship loop when the requested handoff excludes a pull request; a normal Git
commit and push remain an operator action outside that loop. The ship loop never
merges, closes, approves, retargets, enables auto-merge, tags, or releases.

For a first end-to-end delivery run:

```text
/helix-cc:helix-loop Add a deterministic regression test for the reported bug, implement the root fix, update the relevant Markdown, and run the repository gate.
```

For a mixed cast, include the role request in the task, for example:

```text
Use openai/gpt-5.6-luna for the controller, builder, tester, and documenter; use copilot/gpt-5.4 for one planner and the correctness reviewer.
```

Before a write-capable launch, the skill shows:

- the exact task;
- planner and role models;
- the `maxPasses` bound;
- expected writer scope;
- the exact verification argv (plus signed test paths, reproduction, measurement, or release-check argv where the loop requires them).

Correct any mismatch before confirming. Writers remain serialized while
read-only panels may run in parallel. Exact argv is never interpreted by a
shell, and its first item must be a PATH-resolved executable name: use
`["node", "scripts/check.mjs"]`, not `["./scripts/check.mjs"]`. At most one
leading `./` on a task or test path is normalized away; absolute,
empty-segment, dot-segment, backslash, and `.git` paths are rejected afterward.
Ship commit messages and pull-request titles are single-line. TDD reproduction
is stricter: its agent cannot write directly, and the trusted service runs the
red command in a disposable repository copy. Test paths must be Git-visible
and produce a non-empty test delta. Only verified signed test contents are
applied back; ignored-file, Git-internal, HOME, sibling, green,
failed-to-start, and out-of-scope effects are discarded. The trusted service returns only exit/signal/error classes, output
digests, bounded Git deltas, and typed measurement or shipment facts; raw
command output is not placed in the workflow receipt. Scout is the exception: both of its roles
are read-only and its brief is returned as structured output instead of writing
Helix's `BRIEF.md`. Delivery, implement-review, and TDD throw with unresolved
reasons when their remediation bounds are exhausted; research instead returns
the documented structured non-approval for plateau or iteration exhaustion.
Do not treat either terminal shape as completion. See the
[workflow catalog](workflows.md) for exact stage and evidence contracts.

## 9. Status, shutdown, and recovery

Provider processes exist only while their owning `claudex`, `serve`, `proof`,
or `proof-matrix` command runs. Idle status therefore normally reports
`"status": "unreachable"`; saved connection state is reported separately.

```bash
node bin/helix-cc-cliproxy status
node bin/helix-cc-doctor --json
```

One process-level owner is active before the first provider child starts.
SIGINT and SIGTERM during backend readiness, attestation readiness, gateway
catalog convergence, active Claude, or proof execution stop every registered
child. The foreground child receives the original signal; provider children
receive SIGTERM. Any unresponsive child is killed after three seconds, ports
are released, and the launcher exits with 130 for SIGINT or 143 for SIGTERM.

| Symptom | Exact next action |
|---|---|
| `claudex: command not found` | Run the PATH export printed by `./setup.sh`, then retry `command -v claudex`. |
| Missing OpenAI connection | Re-run `node bin/helix-cc-cliproxy login`, then the exact proof. |
| Missing Copilot connection | Re-run `copilot-login`, then `copilot-pin`, then the exact proof. |
| Copilot model mismatch | Re-run `copilot-pin --model <unprefixed-id>` and repeat the proof. |
| Azure is not configured | Recheck endpoint, model-map JSON, and the selected Azure connection method. |
| Requested model absent | Stop the session, run the exact proof, and use only a model returned by that proof. |
| `helix-cc-evidence` MCP tool unavailable | Stop the write loop, run `/mcp`, and restart `claudex` only after the plugin server is connected. Do not substitute a prose command report. |
| Gateway port already in use | Exit the owning `claudex` session; do not start a second owner on the same port. |
| Old Claude Code version | Re-run `./setup.sh`; it invokes the official stable installer when Claude is absent or below the required version. |

## 10. Update and re-verify

```bash
cd /path/to/helix-cc
git pull --ff-only
./setup.sh
npm run verify
```

After any Claude Code, gateway, provider-adapter, or model change, rerun the
doctor and the exact route proof. Historical receipts do not carry forward
across changed versions or model identities.

## Current promoted routes

| Route | State |
|---|---|
| Native Claude | Supported; exact effective model follows the active Claude configuration |
| `gpt-5.6-luna` through OpenAI subscription | Live-proven on 2026-07-19 |
| `copilot/gpt-5.4` | Live-proven on 2026-07-19 with a dated served-model pin |
| OpenAI + Copilot | Live-proven on 2026-07-19 in a full nine-role workflow |
| Azure Foundry GPT | Implementation complete; live proof pending |
| Azure-containing mixed routes | Implementation complete; exact matrix proof required |
| OpenRouter | Deferred and unsupported |

See the [provider reference](providers.md), [current status](../STATUS.md), and
[historical evidence](history/README.md) for the underlying contracts and dated
receipts.
