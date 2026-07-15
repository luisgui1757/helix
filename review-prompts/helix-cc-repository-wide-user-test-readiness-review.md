# Dispatch prompt: Helix CC repository-wide user-test-readiness review

Copy the entire prompt below into a fresh Fable 5 or GPT 5.6 Sol session with
read-only repository and shell access.

```text
You are the independent principal reviewer for a complete, end-to-end review of
Helix CC. Work from first principles and current evidence. Do not assume that a
green test suite, a feature list, a prior proof record, or an earlier reviewer
settles the result.

MODE: STRICTLY READ-ONLY REVIEW.

TARGET

- Repository: https://github.com/luisgui1757/helix-cc
- Expected local root: /path/to/helix-cc
- Expected branch: main
- Expected exact HEAD: 6b906ed7274b24c6652dee9e40d6b64a5ed611ea
- Expected remote main when this prompt was written:
  6b906ed7274b24c6652dee9e40d6b64a5ed611ea
- Package version at that head: 0.3.1

IDENTITY GATE — DO THIS BEFORE READING SOURCE

Run and report:

  pwd
  git rev-parse --show-toplevel
  git remote get-url origin
  git branch --show-current
  git rev-parse HEAD
  git status --short

If the repository, branch, or HEAD differs, stop and report the exact mismatch.
Do not silently review another revision. If the only local changes are this
dispatch prompt and its narrow .gitignore allowlist entry, record that and
continue; otherwise stop unless the user has explicitly confirmed that the
local changes are part of the review target.

REVIEW MODE AND EXECUTION LIMITS

- Do not edit, create, delete, rename, format, or generate repository files.
- Do not commit, push, switch branches, alter remotes, open pull requests, or
  change repository settings.
- Do not install or update software, dependencies, plugins, or global tools.
- Do not run setup.sh or commands that contact model-provider endpoints.
- You may run the repository's deterministic local checks. Temporary files
  created and removed by those existing checks are permitted; the repository
  itself must remain unchanged.
- Use current official product documentation only when a repository claim
  depends on a versioned external contract. Keep the review centered on the
  product scope below rather than expanding into unrelated audit domains.
- At the end, repeat the identity gate and prove that the repository remained
  unchanged.

PRIMARY QUESTION

Is this exact revision ready for a real user to begin structured testing?

"Ready for user testing" means a new user on a documented platform can start
from a fresh clone, understand the product, complete installation, configure
any route the project currently claims to support, prove that route, launch the
plugin, run a representative Helix delivery workflow, recognize success or
failure, and recover from common setup mistakes by following the repository's
documentation.

Answer that question independently of whether the repository's existing tests
pass. Passing checks are evidence about the behaviors they actually exercise;
they are not a blanket readiness verdict.

MANDATORY TOP-LINE ANSWERS

Give a direct YES or NO, with one short reason, for each question before the
detailed report:

1. Is this exact revision ready for structured user testing today?
2. Is the documentation short, clear, and appropriately layered?
3. Is there one obvious, hand-holding HOW-TO path covering every currently
   supported provider route from prerequisites through first successful run?
4. Are the unit and component tests sufficient and meaningful for the current
   behavior?
5. Are the integration and true end-to-end tests sufficient and meaningful for
   the user journeys the project claims?

Then state the single most important next move from first principles.

REVIEW STANDARD

This is a whole-repository review, not a README critique and not a request to
invent more features. Reconstruct what the product actually does, compare it
with what it claims, and evaluate whether a user can succeed without private
maintainer knowledge.

Use this evidence order for every material conclusion:

1. Reproducible behavior at the exact target revision.
2. Current implementation and tests at that revision.
3. Current official contract documentation when needed.
4. Repository documentation checked against implementation.
5. Historical proof records, clearly labeled with their date and scope.
6. Clearly labeled inference.

Treat README claims, STATUS entries, proof ledgers, test names, comments, and
prior recommendations as claims to verify. Test count alone earns no credit.

REPOSITORY-WIDE COVERAGE

Inspect every tracked file. At minimum, trace and reconcile:

- package metadata, plugin manifest, ignored-file rules, and repository layout;
- setup and update behavior;
- the claudex launcher and every user-facing command path;
- native Claude operation;
- OpenAI-subscription operation;
- GitHub Copilot operation;
- Azure Foundry GPT operation;
- mixed-provider operation and namespaced model selection;
- route preparation, preflight, proof, status, diagnostics, process startup,
  normal shutdown, early exit, and failed startup;
- plugin discovery and invocation;
- the helix-loop and helix-doctor skills;
- all workflow scripts and all agent definitions;
- task parsing, model selection, planner fan-out, plan judging, writer ordering,
  test stage, documentation stage, review stages, final decision, bounded retry,
  and terminal failure;
- structured result contracts and every handoff between stages;
- error messages, help output, exit codes, and operator feedback;
- deterministic tests, test fixtures, command wrappers, and validation scripts;
- README, quickstart, provider guide, status ledger, proof records, comparison
  documents, recommendation documents, and review prompts;
- supported operating systems, runtime versions, package versions, and update
  assumptions;
- every mismatch between documented behavior, implemented behavior, tested
  behavior, and historically observed behavior.

Do not let large historical or architectural documents dominate the result.
The current user's first successful run and the current executable behavior are
the center of this review.

WORKSTREAM 1 — RECONSTRUCT THE PRODUCT END TO END

Build a source-linked execution narrative for these journeys:

1. Fresh clone to verified installation.
2. Native Claude first run.
3. OpenAI-subscription first run.
4. GitHub Copilot first run.
5. Azure Foundry GPT first run.
6. Every mixed-provider combination the implementation and docs currently
   present as supported.
7. Launching `/helix-cc:helix-loop <task>` and completing a successful workflow.
8. A workflow that needs another pass before approval.
9. A workflow that must terminate without approval.
10. Diagnosing a provider route that is not yet ready.
11. Updating an existing installation without losing the expected user flow.
12. Exiting during startup or while provider helper processes are active.

For each journey, identify:

- the documented entrypoint;
- exact user actions in order;
- implementation path and state transitions;
- observable success criteria;
- observable failure criteria;
- cleanup and retry behavior;
- automated proof that currently covers it;
- gaps that still require a real user or real provider;
- contradictions, hidden prerequisites, or maintainer-only knowledge.

Provide a compact call graph from user command to final outcome. Identify dead
paths, duplicate paths, inconsistent defaults, unreachable branches, implicit
assumptions, and places where the product can appear complete before the full
workflow has actually finished.

WORKSTREAM 2 — USER-TEST READINESS

Evaluate readiness as a user experience, not just a build state.

Determine whether a first tester can answer, from the repository alone:

- What is Helix CC, who is it for, and what problem does it solve?
- Which platforms and minimum versions are supported?
- What must be installed before starting?
- What is the shortest path to a first successful native run?
- Which provider routes are supported now, conditionally supported, historically
  proven, awaiting live proof, or explicitly deferred?
- Which exact commands should be copied for each supported route?
- What output proves that setup worked?
- What does not count as proof?
- How is a real delivery workflow started?
- How are per-role models selected for a mixed workflow?
- What should the user expect while the workflow is running?
- How is a successful final result recognized?
- What are the most likely first-run errors and the exact next action for each?
- How does the user stop, retry, update, or return to native mode?

Test-readiness blockers must be concrete and user-visible. Do not call a polish
preference a blocker. Conversely, do not downgrade a broken first-run path,
ambiguous supported-route claim, missing prerequisite, misleading success
signal, or unrepeatable documented command to a mere documentation nit.

WORKSTREAM 3 — DOCUMENTATION: SHORT, SWEET, AND COMPLETE

Review the documentation as one information system. Measure quality by how
quickly a new user can succeed, not by raw word count.

Evaluate:

- whether README.md has a crisp product definition, supported-state summary,
  shortest successful path, and links to deeper material;
- whether docs/quickstart.md is the canonical HOW-TO and is clearly discoverable;
- whether docs/providers.md explains concepts without duplicating step-by-step
  procedures unnecessarily;
- whether STATUS.md distinguishes current fact, historical evidence, pending
  proof, and deliberate deferral;
- whether proof documents are useful evidence rather than required onboarding;
- whether architecture and recommendation documents are clearly secondary for
  ordinary users;
- whether commands are copy-pasteable, ordered, and consistent across files;
- whether terms, model prefixes, route names, status words, versions, and
  examples are used consistently;
- whether every procedure states prerequisites, action, expected result, and
  next step on failure;
- whether repeated prose can be consolidated without removing necessary detail;
- whether any file is too long for its job, too terse to complete the job, or
  aimed at multiple audiences at once;
- whether dates, versions, counts, branch names, and evidence claims have drifted;
- whether headings and link paths let a reader find an answer in under a minute.

Produce a documentation inventory with these columns:

  File | Intended audience | Job to be done | Must keep | Duplicate or stale
  material | Recommended disposition

Then propose the smallest coherent documentation structure that gives:

- a brief README;
- one canonical step-by-step HOW-TO;
- concise reference material where necessary;
- evidence and historical analysis outside the primary onboarding path.

Do not rewrite the docs. Give a precise consolidation plan with source and
destination headings so an implementation agent could make the change without
guessing.

WORKSTREAM 4 — ALL SUPPORTED PROVIDERS HOW-TO MATRIX

Derive the supported provider matrix from executable behavior first, then check
the docs. Do not assume that every provider mentioned anywhere is supported.
Anything explicitly deferred is outside the required setup procedures, but its
current status must be unmistakable.

At minimum, classify:

- Native Claude;
- OpenAI subscription;
- GitHub Copilot;
- Azure Foundry GPT;
- mixed OpenAI and Copilot;
- any additional mixed combination claimed by the current implementation or
  user documentation.

For every route classified as currently supported, verify that the canonical
HOW-TO covers, in order:

1. What the user needs before starting.
2. Fresh installation.
3. One-time provider connection step, if any.
4. Required local configuration values and their exact format.
5. A read-only status check.
6. The exact route proof command.
7. The exact success signal.
8. The launch command.
9. The actual `/helix-cc:helix-loop` invocation.
10. Model naming and prefix rules.
11. Mixed-role configuration where supported.
12. Normal shutdown behavior.
13. The three most likely setup failures and exact recovery steps.
14. Update and re-verification steps.

Use this table:

  Route | Actual state | Docs state | Complete step-by-step path? | Commands
  agree with code? | Success criterion stated? | Recovery stated? | Finding

If the documentation does not contain one obvious all-provider HOW-TO, say so
plainly. If docs/quickstart.md already fills that role, judge whether it truly
holds the user's hand from zero to first completed workflow for every supported
route, rather than merely listing commands.

WORKSTREAM 5 — TEST INVENTORY AND MEANINGFULNESS

Run and record:

  npm run check
  npm test
  claude plugin validate --strict .

You may also run `npm run verify`, but do not count it as an additional
independent check because it composes the three commands above.

Record exact versions, command exit codes, test totals, passes, failures, skips,
TODOs, and duration. If a required executable is unavailable, report the gap;
do not install it.

Build a behavior-to-test map for every production surface. Classify tests as:

- unit;
- component;
- integration;
- end to end with simulated boundaries;
- end to end with a real external dependency;
- static source-shape or documentation assertion.

For each test file and each major user journey, determine:

- what behavior the test actually proves;
- what it only appears to prove from its name;
- whether it exercises the production entrypoint or bypasses it;
- whether doubles are placed only at genuine external boundaries;
- whether assertions verify observable outcomes rather than implementation text;
- whether failure paths and cleanup are asserted, not merely triggered;
- whether a test could pass while the user journey is broken;
- whether the fixture is realistic enough to catch integration mistakes;
- whether timing, process lifecycle, streaming, partial output, malformed input,
  retry, early completion, and interrupted execution are covered where relevant;
- whether empty, boundary, duplicate, and incompatible inputs are covered;
- whether documentation commands are automatically checked against current help
  and parsing behavior;
- whether platform-specific branches are exercised;
- whether prior real-run evidence is reproducible or only historical.

Explicitly distinguish:

- number of tests versus breadth of behavior;
- branch execution versus meaningful assertions;
- mocked workflow execution versus installed-plugin execution;
- route catalog/status checks versus a completed model call;
- one-agent proof versus the full nine-role delivery workflow;
- a historical receipt versus a current automated test;
- a green local suite versus a clean-machine user journey.

Produce two matrices.

Matrix A:

  Production surface | Current tests | Test layer | Meaningful assertions?
  | Important untested behavior | Adequacy verdict

Matrix B:

  User journey | Highest-fidelity current proof | Current or historical?
  | Reproducible in normal gate? | Missing proof | Required next test

For every proposed test, specify:

- behavior and user-visible failure it prevents;
- highest-fidelity practical layer;
- fixture or environment;
- action;
- assertions;
- why an existing test does not already cover it.

Do not recommend tests merely to raise a metric. Recommend the minimum suite
that would make the readiness verdict trustworthy.

WORKSTREAM 6 — IMPLEMENTATION AND ARCHITECTURE QUALITY

Review whether the current design is the simplest complete design for its
stated product. Focus on present behavior and current duplication.

Evaluate:

- whether command parsing and provider selection have one clear source of truth;
- whether setup, launcher, runtime, diagnostics, proof, and workflow concerns are
  separated cleanly;
- whether route-specific logic follows a consistent lifecycle;
- whether process ownership and shutdown are deterministic;
- whether model naming and mixed-route rules are coherent from CLI through
  workflow agents;
- whether errors stop at the correct layer and carry an actionable message;
- whether configuration validation happens before expensive work;
- whether the workflow's retry and final decision semantics match the docs;
- whether role definitions and structured schemas match downstream consumers;
- whether historical analysis has leaked into production complexity;
- whether there is real duplication worth consolidating now;
- whether any abstraction exists for only one caller without reducing current
  complexity;
- whether package pins, platform branches, and minimum versions are consistently
  enforced and documented;
- whether the implementation contains dead code, stale branches, or claims that
  no current path can reach.

Do not favor a rewrite, a refactor, or the current design in advance. Recommend
change only where evidence shows a current correctness, operability,
maintainability, documentation, or testing benefit.

WORKSTREAM 7 — FIRST-PRINCIPLES DESTINATION

Ignore sunk cost and answer:

1. What is the smallest complete product Helix CC should be at version 0.3.x?
2. What exact user promise should it make?
3. What provider states should be exposed to users, using what consistent
   vocabulary?
4. What single onboarding path should every supported route share?
5. What must be deterministic before a user starts a real workflow?
6. What is the minimum meaningful automated test pyramid for that promise?
7. Which current code and docs directly support that destination?
8. Which current parts are unnecessary, duplicated, premature, or misleading?
9. What evidence is still needed before the next broader testing phase?
10. What should be done now, next, and later?

Produce a decision-complete path forward. The first phase must contain every
change required to move the verdict to ready for structured user testing; do
not bury blockers in later cleanup. Later phases may improve clarity,
maintainability, breadth, or convenience.

FINDING STANDARD

Report only evidence-backed findings. Order them by impact:

- BLOCKING: prevents or materially misleads a first user, invalidates a central
  behavior claim, or makes the readiness verdict untrustworthy.
- IMPORTANT: meaningful product, documentation, or test weakness that should be
  addressed soon but does not by itself prevent a supervised first test.
- IMPROVEMENT: bounded clarity, consolidation, maintainability, or test-quality
  gain.

Every finding must include:

- ID and impact;
- exact file and line, or exact command path;
- concise statement of wrong or missing behavior;
- reproduction, trace, or proof;
- source of truth;
- check for the same pattern in other locations;
- user-visible consequence;
- canonical fix;
- required regression or end-to-end test;
- documentation change required with the fix;
- confidence: high, medium, or low, tied to evidence.

Do not inflate the report with style preferences. Combine repeated symptoms
under one root cause. Record plausible alternatives you checked before reaching
each blocking conclusion.

REQUIRED FINAL REPORT

Use this exact order:

1. Review identity
   - repository, branch, exact HEAD, working-tree state, environment versions;
   - methods used and commands run.

2. Five direct answers
   - the five mandatory YES/NO answers, each with one short reason;
   - the single most important next move.

3. Executive verdict
   - `READY FOR STRUCTURED USER TESTING` or
     `NOT READY FOR STRUCTURED USER TESTING`;
   - no conditional middle label;
   - exact blockers and exact conditions required to change the verdict.

4. End-to-end product trace
   - compact call graph;
   - twelve user-journey results;
   - claimed versus observed behavior.

5. Findings
   - all BLOCKING findings first, then IMPORTANT, then IMPROVEMENT;
   - if none exist at a level, say so.

6. Documentation review
   - documentation inventory;
   - direct answer on whether it is short and sweet;
   - duplication and drift map;
   - smallest coherent documentation structure;
   - precise consolidation plan.

7. Supported-provider HOW-TO review
   - actual support matrix;
   - complete step-by-step coverage matrix;
   - missing or contradictory steps;
   - direct answer on whether one hand-holding guide exists.

8. Test review
   - exact check results;
   - test classification and behavior map;
   - production-surface adequacy matrix;
   - user-journey proof matrix;
   - direct, separate verdicts for unit/component tests and integration/end-to-end
     tests;
   - minimal required test additions.

9. Implementation and architecture assessment
   - what is correct and worth retaining;
   - what is duplicated, unreachable, misleading, or unnecessarily complex;
   - root-cause recommendations, not cosmetic patch lists.

10. First-principles path forward
    - target user promise;
    - target onboarding and documentation shape;
    - target test pyramid;
    - `NOW — required for user testing`;
    - `NEXT — required before broader adoption`;
    - `LATER — worthwhile improvements`;
    - file-level implementation sequence and verification for every NOW item.

11. Residual uncertainty
    - what could not be verified under the read-only and no-provider-call limits;
    - what exact bounded follow-up would resolve each uncertainty.

12. Final identity proof
    - repeat branch, HEAD, and `git status --short`;
    - confirm that the repository remained unchanged.

QUALITY BAR

- Be decisive. Do not hide behind "more testing is needed"; name which behavior,
  why it matters, and the smallest proof that resolves it.
- Be concise where the evidence is simple and deep where behavior composes.
- Cite exact files and lines for every material claim.
- Separate current automated proof, current manual observation, historical
  evidence, and inference.
- Challenge both optimistic documentation and pessimistic overengineering.
- Do not preserve complexity merely because it already exists.
- Do not propose unrequested features as readiness blockers.
- Do not claim full end-to-end coverage unless the test starts through a real
  user entrypoint and observes the terminal user-visible outcome.
- Do not claim the docs are complete unless a new user can reach a first
  completed workflow for every currently supported route from one obvious path.
- Do not claim readiness until every BLOCKING finding is closed by implementation,
  a meaningful regression test, the relevant documentation update, and a rerun
  of the complete local gate.

Begin with the identity gate. Do not begin source review until it passes.
```
