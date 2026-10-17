# Contributing

The product is the folders under `skills/`. Keep instructions portable and
changes focused. Add executable code only for a requirement the host and
instructions cannot meet. Do not add a runtime or provider adapter.

## Make a change

1. Read the affected skill, its callers and relevant documentation.
2. Make the smallest complete change. Update its documentation and behavioral
   scenario when behavior changes.
3. Run the maintenance checks below and affected scenarios in disposable
   repositories. Static checks alone do not prove an agent workflow.
4. Get independent review of the final diff and verification output. Resolve
   findings, rerun affected checks and review corrections before publishing.

Keep results and review findings in the pull request: tested revision, commands,
outcomes, failures, gaps and review settings. Preserve raw evidence privately.
Record rejected findings with their reasons there; put reusable constraints in
relevant usage or contributor documentation. Do not add review diaries, source
search reports or historical indexes to the repository. Git retains prior files.

Keep current limitations in [STATUS.md](STATUS.md). Do not turn a small sample
or an agent's completion claim into a reliability guarantee. Never commit raw
transcripts, credentials, account identifiers or machine-local paths.

## Checks

Use Node.js 22.19.0 or newer, Git, a POSIX shell and Gitleaks:

```sh
node --test tests/*.test.mjs
git diff --check
gitleaks dir --redact .
```

Tests cover packaging, installation, discovery, documentation and governance.
Use [behavioral scenarios](evals/scenarios.md) for Helix and
[collection scenarios](evals/collection.md) for the other skills. Live runs use
configured hosts and stay out of unattended CI. The optional
[comparison runner](evals/comparison.md) measures two small synthetic tasks;
retain failed trials and keep raw logs outside Git.

Every change to `main` needs a PR and the required checks and approvals.
Do not merge or change repository policies as part of a skill edit.
See [governance](docs/security-governance.md).

## Add or edit a skill

Keep custom entrypoints preferably under 100 lines and normally under 150.
Use plain language. Remove repetition; retain rules that prevent real failures.
Put conditional detail in references, not mandatory instructions hidden to meet
a line count. Apply Unslop to authored prose.

Each folder needs `SKILL.md` with `name` matching the folder and a concise
`description`. Custom and adapted skills use only those frontmatter keys.
Keep skills self-contained except for documented compositions. The delivery
bundle uses sibling links; keep its [dependency table](docs/install.md#workflow-dependencies)
current. Doc-view resolves its required skills through the host.

Add the skill to the README catalog, usage guide, test inventory and collection
scenarios. Explain its user-facing job or internal caller. Internal helpers
remain callable; do not invent portable controls to hide them.

Third-party skills need a packaged license and a pinned source in
[THIRD_PARTY.md](THIRD_PARTY.md). Describe adaptations. Preserve Unslop's rule IDs
and license. Frontend-design stays byte-identical to its pinned source; an
upstream update must change its revision and digest tests together. Imported
frontmatter may have a documented test exception.
