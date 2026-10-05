# Codex settings

Use native project configuration in `.codex/config.toml`, or user configuration
in `$CODEX_HOME/config.toml` (`~/.codex/config.toml` by default) when that scope
was requested. Project configuration requires the host to trust the project.
Do not grant trust or weaken permissions as a side effect of choosing models.
An untrusted project can contain valid settings that the host ignores. In CLI
0.160.0, a command-line `projects.<path>.trust_level` override did not enable
the project layer. Use the host's normal trust flow and verify loading in a
fresh session; do not treat the presence of the file as proof.

The verified configuration path uses these native keys:

```toml
[agents]
default_subagent_model = "<requested reviewer model>"
default_subagent_reasoning_effort = "<requested reviewer effort>"
```

These are defaults for **all native subagents in that scope**, not just Helix.
Explain this and get that scope choice if the request has not already made it.
Merge the requested keys into an existing `[agents]` table; preserve other keys
and tables. To return to inherited defaults, remove only the overrides the
user asked to clear and check for higher or lower configuration layers.

An explicit spawn value overrides these defaults. A selected model without
either an explicit or configured effort uses that model's default effort.
A custom agent file can override both.
Inspect relevant competing settings before claiming a saved default will win.
Do not remove unrelated roles to make it win.

Codex also documents named custom agents in `.codex/agents/*.toml`. Do not assume
the installed client's delegation tool can select one. Our 0.160.0 evaluation
could pass explicit model and effort values but did not validate a named-role
selector. If the user needs Helix-only settings, check current support first;
otherwise give per-invocation settings without pretending they were persisted
as a working named role. Do not create a separate routing file.

Start the requested writer with:

```sh
codex --model <writer-model> -c 'model_reasoning_effort="<writer-effort>"'
```

In a fresh session, invoke Helix or second-opinion without model overrides to
use the saved subagent defaults. A fresh child must still omit inherited
conversation history. Verify its resolved `model` and `effort` in the native
child session records, matched to the parent dispatch. Read only records from
the verification run; do not search unrelated conversations or account files.

Check installed behavior against the official
[subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
when it differs from these examples.
