# Contributing

The shipped product is the four folders under `skills/`. Keep each independently
installable and portable. Prefer a narrow instruction correction over adding a role, runtime,
configuration option, provider adapter, or dependency. Add executable code
only for an observed requirement that the host and instructions cannot meet.

For a behavior change, update the relevant Markdown and behavioral scenario in
the same change, then run the affected scenarios in disposable repositories.
Record each evaluated change in one dated file under `docs/reviews/`: scope and
source digests, hosts and roles, results including failed trials, open and
rejected findings, and a final review receipt or link. Keep round-by-round
discussion in the pull request. Append corrections; never rewrite earlier
entries or equate frontmatter validation with a successful workflow.
Record the reviewer role's body and distinguish evaluation roles from shipped
templates when attributing results to a configuration.

Keep current results, open limitations and their evidence links in `STATUS.md`.
Completed review rounds may leave the checkout when a merged main commit
preserves every byte and `docs/history/README.md` indexes each record. Keep failed
trials, rejected findings and exact review briefs in that immutable record;
never replace them with a success summary or editable PR comment. Verify the
archived blobs, inbound links and heading anchors before removal. Archive
interlinked records together or retain their dependencies. Append later
corrections in a new dated record, referencing the original, and link the correction
from that record's archive-index row. Keep work in progress
under `docs/reviews/`. Full Git history preserves offline access; source ZIPs and
shallow clones need the documented archive retrieval step. This policy also
applies to retired-engine evidence and does not change any review or merge gate.

The maintenance tests use Node.js 22.19.0 or newer, Git, and a POSIX shell.
The secret scan also needs Gitleaks:

```sh
node --test tests/*.test.mjs
git diff --check
gitleaks dir --redact .
```

The repository has no package dependencies. The tests check the portable package,
current documentation links, and repository governance. Behavioral evaluation
uses [the scenarios](evals/scenarios.md) and the user's already configured host;
live subscription runs are separate from unattended CI.

Use the [collection scenarios](evals/collection.md) for setup, prose editing,
and second opinions. Setup references may contain host-specific native settings;
do not add a shared routing format. Preserve unslop's stable rule IDs, upstream
attribution, and packaged license when editing its prose rules.

The [comparison runner](evals/comparison.md) is opt-in evaluation tooling, not a
product runtime. Its offline tests check accounting and acceptance assertions;
CI never launches a subscribed agent. Preserve failed trials, keep raw logs
outside Git, and publish only sanitized metrics with their source hashes.

Every change to `main` goes through a pull request. The required aggregate
`test`, dependency review, CodeQL, CODEOWNER review, last-push approval, and
resolved review conversations remain required by the checked-in policies.
Do not merge, weaken a gate, or alter live repository settings as part of a
skill change. See [security and governance](docs/security-governance.md).

Do not commit credentials, raw agent transcripts, provider payloads, personal
paths, or machine-local state. Existing historical review files are dated
records; do not silently reinterpret their results as current guarantees.
