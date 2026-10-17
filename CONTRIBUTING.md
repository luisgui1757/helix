# Contributing

The shipped product is the folders under `skills/`. Keep each portable and
independently installable except for explicitly documented compositions. Prefer
a narrow instruction correction over adding a role, runtime,
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
second opinions and frontend design. Setup references may contain host-specific
native settings; do not add a shared routing format. Preserve unslop's stable rule IDs, upstream
attribution, and packaged license when editing its prose rules.
Keep frontend-design byte-identical to its pinned upstream revision; to update
it, change the revision, attribution and test digests together.

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

## Adding a skill

Add one self-contained folder under `skills/` with a `SKILL.md` and any
references, scripts or license it needs. Ordinarily it must not link into another
skill's folder. The nine [Theo-inspired skills](docs/theo-provenance.md) are an
explicit exception: the requested workflows compose sibling helpers. Keep their
dependencies documented and test that a copied bundle resolves every skill link.
Doc-view resolves its required design and writing skills through the host and
documents missing dependencies. Do not duplicate or silently replace those
skills or add hidden dependencies. Each skill's frontmatter `name` must equal
its folder name. The install guide
links every folder automatically. Add the folder to the skill list in
`tests/skill.test.mjs`, a README row with its origin and license, usage in the
how-to, a collection scenario, and a STATUS row once it has evidence.

Helix-authored and adapted skills use only `name` and `description`
frontmatter. A third-party skill needs its license inside the folder and an
entry in `THIRD_PARTY.md` with its pinned source; an adapted one also records
what changed. An unmodified import keeps its upstream bytes, so it needs a
digest test and, if it carries other frontmatter keys, an exception in the
metadata test.

The Theo-inspired bundle is locally authored paraphrase/new text under this
repository's MIT license, not an imported upstream file. Its provenance labels
and source links replace an upstream-file license claim; do not copy original
source wording or assert an upstream license that has not been established.
