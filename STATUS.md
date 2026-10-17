# Known limitations

Skills are instructions, not enforcement. Confirm the actual diff, test output,
review result and host permissions before accepting completion.

- Agents can omit evidence, overstate completion or edit after review. A saved
  reviewer role does not prevent those failures. Review must cover the final change.
- Agents can narrow valid input ranges without review catching it. Claude samples
  rejected `2 ** 53` despite a requested non-negative integer domain.
- Evidence writes have escaped the task directory on both hosts. Bounded reruns
  passed after instruction fixes, but only host controls can enforce write scope.
- Independent review adds time. A [historical pilot](evals/comparison.md#historical-result)
  took 1.86x plain Codex time and 6.47x plain Claude Code time, with no confirmed
  reviewer-caught functional defect. These small samples do not predict current performance.
- Model and effort support depends on the installed host and account. Verify
  observable dispatch settings; a configuration file or model self-report is
  insufficient. Provider-internal effort may remain unverified.
- Codex subagents inherit the launching turn's sandbox. Claude's supplied
  reviewer role allows file-reading tools only. T3's review role is an instruction,
  not a read-only boundary. See [native roles](docs/native-roles.md).
- Sol-loop needs an actual Sol route. A Claude-only reviewer is not a substitute.
  T3 cross-provider delivery and live GitHub merge, watcher and attachment flows
  still need end-to-end evaluation.
- Doc-view has been exercised for style choice, generation and refresh on both
  native hosts, with desktop/mobile Chrome and keyboard checks. Loading visibility
  varied, isolated-fixture coverage was incomplete, and some replies exceeded
  the length target or omitted style filenames. These samples do not establish
  reliability, screen-reader support, physical-device coverage or other browsers.
- Guided setup can vary in question order and reporting. Inspect the exact edit
  before saving. Windows/WSL, interrupted-session recovery, new host versions and
  untested model combinations need separate workflow checks.
- Frontend-design combined with Helix has not been evaluated as one workflow.

Maintenance tests cover package contracts and local tooling. They do not prove
live agent behavior. Use the [evaluation scenarios](evals/scenarios.md) and
[collection cases](evals/collection.md) when changing instructions. PRs record
results for the revision tested; older results do not certify later changes.
