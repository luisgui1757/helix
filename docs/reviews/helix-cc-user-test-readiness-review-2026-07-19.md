# Helix CC repository-wide user-test readiness review

Review date: 2026-07-19
Target revision: `6b906ed7274b24c6652dee9e40d6b64a5ed611ea`
Package version: `0.3.1`

## 1. Review identity

Identity gate passed before source inspection and again after the review.

| Item | Verified value |
|---|---|
| Repository root | `/path/to/helix-cc` |
| Origin | `https://github.com/luisgui1757/helix-cc.git` |
| Branch | `main` |
| HEAD | `6b906ed7274b24c6652dee9e40d6b64a5ed611ea` |
| Package version | `0.3.1` |
| Initial working tree | ` M .gitignore`; untracked dispatch prompt |
| Platform | macOS 26.5.2, Darwin 25.5.0, arm64 |
| Node.js | `v24.16.0` |
| npm | `11.13.0` |
| Claude Code | `2.1.214` |
| Git | `2.55.0` |
| Bash | `5.3.9` |
| zsh | `5.9.1` |
| Codex CLI | `0.144.5` |
| Pi | `0.80.9` |
| Azure CLI | unavailable |
| GitHub Copilot CLI | unavailable |

The initial `.gitignore` difference only adds the narrow allowlist for the untracked dispatch prompt, with its associated comment update. That is the exception authorized by the review prompt.

Methods:

- Inspected all 46 tracked files—11,124 lines—including manifests, lockfile, every executable, library, workflow, agent, skill, test, document, proof record, recommendation, and review prompt.
- Reconstructed source paths and state transitions rather than accepting test or documentation claims.
- Ran the three required deterministic gates plus read-only status, help, and doctor commands.
- Checked current official Claude plugin/installation contracts and Microsoft Azure OpenAI authentication/endpoint contracts where repository claims depended on them.
- Made no provider model calls and no repository changes during the review.

Commands included the identity gate, `git ls-files`, targeted source searches, version queries, `npm ls`, the three required gates, `node bin/helix-cc-doctor --json`, `node bin/helix-cc-cliproxy status`, and user-facing help commands.

## 2. Five direct answers

1. **NO.** A fresh setup can report success without making `claudex` reachable, and the bare Copilot route selects a model the documentation explicitly rejects as the controller.
2. **NO.** The material is generally accurate but duplicated across a 294-line README, a 236-line quickstart, a 362-line provider guide, and large historical documents.
3. **NO.** `docs/quickstart.md` is the obvious candidate, but it does not cover every implemented mixed route, exact proof outcomes, role configuration, and route-specific recovery through a completed workflow.
4. **NO.** The unit/component suite contains meaningful orchestration and boundary assertions, but it missed both identified first-run failures and does not adequately exercise launcher/process integration.
5. **NO.** The normal gate has no installed-plugin, clean-install, or real user-entrypoint end-to-end test; provider and nine-role receipts are historical rather than reproducible gate coverage.

The single most important next move is to make one clean-room onboarding contract executable: fix the launcher/setup contradictions, consolidate the route procedure into the quickstart, and prove that procedure through a disposable-home subprocess test.

## 3. Executive verdict

### NOT READY FOR STRUCTURED USER TESTING

Blocking conditions:

- Bare `claudex --providers copilot` selects `copilot/gpt-5-mini`, although the repository says that model must not currently control the workflow.
- `setup.sh` installs the launcher under `~/.local/bin` and prints success, but neither persists that directory in the caller’s PATH nor gives the user a required PATH command.
- The canonical quickstart does not take every claimed provider combination from complete prerequisites through proof, launch, `/helix-cc:helix-loop`, terminal success, recovery, and re-verification.

The verdict changes only after all three are corrected, focused regressions cover them, the documentation is updated in the same change, a deterministic clean-install/launcher integration check passes, and the complete local gate is rerun.

## 4. End-to-end product trace

### Compact call graph

```text
fresh clone
  └─ setup.sh
      ├─ platform/version checks
      ├─ npm ci from package-lock
      ├─ prepare pinned CLIProxyAPI
      ├─ claude plugin validate --strict
      └─ install claudex symlink

claudex
  ├─ native
  │   └─ claude --plugin-dir <helix-cc>
  └─ provider-backed
      └─ helix-cc-cliproxy run
          ├─ validate credentials/configuration
          ├─ start Copilot/Azure adapters as selected
          ├─ render and start loopback CLIProxyAPI
          ├─ probe model catalog and attested identities
          ├─ spawn Claude Code with isolated gateway environment
          └─ stop owned helper processes

/helix-cc:helix-loop <task>
  ├─ helix-cc-doctor preflight
  ├─ confirmation and model/role configuration
  └─ Workflow(helix-delivery)
      ├─ parallel planners
      ├─ plan judge
      ├─ serialized builder
      └─ bounded pass loop, 1–5 times
          ├─ tester
          ├─ documenter
          ├─ parallel quality/security/red-team reviews
          ├─ verifier and deterministic evidence gate
          ├─ approve → terminal result
          └─ reject → remediation writer or terminal failure
```

The delivery workflow itself is coherent in [`workflows/helix-delivery.js`](../../workflows/helix-delivery.js): planner fan-out, single plan decision, serialized writers, post-write reviewers, deterministic evidence gating, and bounded remediation are explicitly ordered.

### Twelve journey results

| # | Journey | Entry, states, and observable result | Proof, recovery, and gap |
|---:|---|---|---|
| 1 | Fresh clone to installation | Clone → `./setup.sh` → dependencies/pinned proxy/plugin validation → launcher symlink. Success text is printed by `setup.sh`. | Gate validates components, but not a new shell resolving `claudex`. A documented-platform user can receive success and then get `command not found`. |
| 2 | Native Claude first run | `claudex` → native `claude --plugin-dir` → authenticate → `/helix-cc:helix-loop`. Local doctor reported native prerequisites locally ready. | No provider call was made. The quickstart has the clearest workflow invocation, but does not define a concise final success contract or common recovery sequence. |
| 3 | OpenAI subscription | Login → proof `gpt-5.6-luna` → provider launcher → workflow. Runtime validates saved Codex-only credentials, starts the gateway, probes it, launches Claude, then cleans up. | Historical proof exists at the same executable code generation; current route availability was not called. The guide does not explicitly carry the user from provider launch back to the workflow invocation and terminal success. |
| 4 | GitHub Copilot | Device login → discover/pin `gpt-5.4` → proof → explicit launch. | Explicit documented command is coherent. Bare `claudex --providers copilot` instead chooses rejected `gpt-5-mini`; this is a blocking inconsistent default. |
| 5 | Azure Foundry GPT | Set `/openai/v1` endpoint, JSON deployment mapping and key or Azure CLI identity → proof → explicit launch. | Boundary implementation matches Microsoft’s `/openai/v1`, API-key, and Entra bearer contracts. Live proof is explicitly pending, and `az` was unavailable locally. |
| 6 | Mixed providers | Parser accepts unique subsets of Codex, Copilot, and Azure; mixed catalogs require namespaced models. | OpenAI+Copilot has a historical full-workflow receipt. Azure-containing pairs and the triple route are executable paths but lack canonical procedures and live evidence. |
| 7 | Successful `/helix-loop` | Skill preflight → model arguments → Workflow → all stages → deterministic approval. | Component simulation exercises stage order and approval. Historical OpenAI+Copilot evidence records a real nine-role run. The normal gate does not start through the actual installed command. |
| 8 | Another pass required | Failed review/evidence gate → remediation writer → next bounded pass. | Meaningfully covered by the workflow component test, including writer ordering and bounded retry. No installed-plugin execution proves the handoff contract. |
| 9 | Terminal failure | At final allowed pass, unresolved deterministic/reviewer problems produce an unapproved terminal result. | Component-covered; no real Claude/Workflow terminal-output test. |
| 10 | Diagnose unready route | `helix-cc-cliproxy status` plus `helix-cc-doctor --json`. Current observation: native locally ready; gateway idle/unreachable; Codex credential present; Copilot/Azure locally unavailable. | Status correctly distinguishes idle state from credential loss. Plugin `bin/` executables are placed on Bash-tool PATH while enabled, so the skill’s bare `helix-cc-doctor` command is valid under Claude’s plugin contract. |
| 11 | Update installation | `git pull --ff-only` → `./setup.sh` → reinstall exact lockfile and pinned proxy → validate → retain external user credentials/state. | Procedure exists but has no realistic update integration test. The launcher PATH defect remains after update, and an old installed Claude produces an error without an exact update recovery command. |
| 12 | Exit during startup/runtime | Normal return from Claude, proof, or matrix reaches `finally` and terminates owned children with TERM then KILL fallback. | Normal cleanup is source-backed. SIGINT/SIGTERM during synchronous Claude execution and partial startup are not exercised; deterministic early-interrupt cleanup remains unverified. |

### Claimed versus observed

Aligned claims:

- OpenRouter is deferred.
- Azure is implemented and boundary-tested but not live-proven.
- Status is not route proof.
- Mixed mode requires namespaced models.
- The proof workflows are deliberately narrower than the full delivery workflow.
- Historical receipts are labeled with dates and scope.

Material contradictions or missing evidence:

- Copilot’s launcher default contradicts the promoted-model policy.
- Setup success does not establish launcher discoverability.
- “Mixed Codex, Copilot, and Azure” is broader than the canonical mixed-route procedure.
- Tests execute workflow source with a fake `agent`; they do not prove installed-plugin invocation.
- Normal shutdown is implemented, but interrupted-process ownership is not proven.

## 5. Findings

### BLOCKING

#### B-01 — Copilot’s implicit controller is explicitly unpromoted

- **Impact:** A first user following valid command syntax can start the central workflow with a controller the project says is unsafe to promote.
- **Location:** `bin/claudex:98–111`, especially line 103; contradiction at `docs/quickstart.md:100–119` and `README.md:116`.
- **Wrong behavior:** `claudex --providers copilot` silently defaults to `copilot/gpt-5-mini`.
- **Proof:** The launcher’s provider switch assigns that exact model. The quickstart says not to use it as the top-level Workflow controller because its latest validation declared completion before background work finished.
- **Source of truth:** The repository’s current promoted-route policy is `copilot/gpt-5.4`.
- **Multi-location check:** Explicit README, quickstart, provider-guide, pin, proof, and launch examples consistently use `gpt-5.4`; only the launcher default retains `gpt-5-mini`.
- **Alternative checked:** `gpt-5-mini` is not merely undocumented—it is explicitly retained only as historical evidence and marked unpromoted.
- **User consequence:** A shorter, apparently supported command selects the known-wrong control model without warning.
- **Canonical fix:** Fail closed by requiring `--model` for Copilot, or change the promoted default and keep that value in one route-policy source. Requiring an explicit attested model is safer because Copilot aliases can drift.
- **Required test:** Invoke the real launcher as a subprocess for Copilot-only and every mixed provider set; assert either an actionable missing-model error or the exact promoted namespaced model passed downstream.
- **Documentation change:** Update launcher help, quickstart Copilot commands, model-selection rules, and STATUS/rejected-controller rationale together.
- **Confidence:** **High**, direct executable assignment plus explicit contradictory policy.

#### B-02 — Setup can declare success without producing a runnable launcher

- **Impact:** Breaks the first command after a documented fresh installation.
- **Location:** Default install directory at `setup.sh:98–125`, success message at `setup.sh:179`, immediate documentation assumption at `docs/quickstart.md:27–35`.
- **Wrong behavior:** The script installs `claudex` under `~/.local/bin`. Its `export PATH=…` affects only the setup process and cannot update the invoking shell. It neither persists PATH nor warns when the target directory is absent from the caller’s PATH.
- **Proof:** After setup exits, the quickstart immediately requires `claudex --version`; no intervening PATH action is provided.
- **Source of truth:** A successful fresh-install procedure must make its next documented command work or provide the exact action required to make it work.
- **Multi-location check:** README and quickstart both use the same default and neither explains PATH. The existing setup test verifies symlink creation, not a fresh shell’s command resolution.
- **Alternative checked:** The current review machine already includes `~/.local/bin`, but that is maintainer environment state and does not satisfy a clean documented-platform path.
- **User consequence:** “Helix CC setup complete” may be followed immediately by `claudex: command not found`.
- **Canonical fix:** Detect whether the selected `--bin-dir` is on PATH. If not, finish with an exact shell-specific, copy-pasteable PATH instruction and do not claim the launcher is ready until the user-facing distinction is clear. Do not silently edit shell profiles.
- **Required test:** Run setup with a disposable HOME and minimal PATH, then start a fresh shell and assert the documented handoff either resolves `claudex` or emits the exact required PATH action.
- **Documentation change:** Add the PATH prerequisite/recovery to README and the canonical install section; document custom `--bin-dir`.
- **Confidence:** **High**, direct shell-scope semantics and missing documented handoff.

#### B-03 — No complete canonical route-to-workflow HOW-TO exists

- **Impact:** A new user cannot independently configure and prove every route the executable/docs present as supported.
- **Location:** Prerequisites at `docs/quickstart.md:7–35`; route sections at lines 57, 86, 121, and 141; troubleshooting at line 192.
- **Missing behavior:** The guide omits exact platform/Claude prerequisites, setup PATH handling, Azure login/permission commands, Azure-containing mixed combinations, a concrete per-role mixed configuration, common `/helix-loop` continuation, terminal success/failure examples, and route-specific recovery.
- **Proof:** Only OpenAI+Copilot gets a mixed proof procedure. The implementation accepts Azure with either or both other providers. Provider sections stop at launching Claude rather than explicitly continuing through the delivery workflow.
- **Source of truth:** The review’s user-testing definition and the executable provider grammar.
- **Multi-location check:** README and `docs/providers.md` contain fragments, but no single document composes them into one ordered procedure.
- **Alternative checked:** The missing material is not intentionally deferred: Azure itself is labeled implemented, and the runtime accepts the combinations. Historical proof documents are evidence, not usable onboarding.
- **User consequence:** A tester must infer commands and state transitions from multiple files or possess maintainer knowledge.
- **Canonical fix:** Make `docs/quickstart.md` the sole procedure: shared lifecycle first, then one complete route subsection per currently exposed state/combination, with prerequisites, proof output, loop invocation, terminal signals, shutdown, recovery, and update.
- **Required test:** Extract canonical commands and run their help/parser-safe portions in CI; validate every documented provider set and model-prefix rule against the production parser.
- **Documentation change:** This finding is itself a documentation restructuring requirement; README and provider reference must link to—not duplicate—the procedure.
- **Confidence:** **High**, direct information-system and executable-route comparison.

### IMPORTANT

#### I-01 — The normal gate stops below the real user entrypoint

- **Impact:** The suite can be green while installation, launcher defaults, plugin discovery, process orchestration, or terminal user output is broken.
- **Location:** Fake Workflow runtime at `tests/workflow.test.mjs:7–42`; narrow setup fakes at `tests/setup.test.mjs:20`; plugin source-shape assertions in `tests/plugin.test.mjs`.
- **Wrong/missing proof:** Workflow tests compile the production script with an injected fake `agent`. Proof tests do the same. Setup tests do not execute the full clean-user path. No normal test invokes an installed `/helix-cc:helix-loop`.
- **Proof:** Both blocking bugs coexist with 66/66 passing tests.
- **Source of truth:** Test names do not establish fidelity; production entrypoint and user-visible terminal outcome do.
- **Multi-location check:** Provider/doctor/proxy tests contain useful boundary assertions, but none composes the full chain.
- **User consequence:** A green gate overstates readiness.
- **Canonical fix:** Add deterministic subprocess integrations for setup, launcher routing, provider-helper startup/failure/cleanup, and plugin discovery; retain live provider proofs as explicit acceptance checks.
- **Required test:** See the minimal additions in section 8.
- **Documentation change:** STATUS must identify the highest-fidelity layer of each proof and distinguish current gate coverage from dated live receipts.
- **Confidence:** **High**.

#### I-02 — Interrupted process cleanup is not established

- **Impact:** Ctrl-C or termination during startup/model execution may leave helper processes or stale local state; the behavior is currently uncertain.
- **Location:** TERM/KILL cleanup helper at `bin/helix-cc-cliproxy:136`; normal `finally` paths at lines 742–779.
- **Missing proof:** No explicit SIGINT/SIGTERM ownership handler or integration test exercises partial startup, synchronous Claude execution, or proof interruption.
- **Source of truth:** The documented promise that sidecars stop when Claude exits.
- **Multi-location check:** Failed startup does stop accumulated children, and ordinary completion has `finally`; this finding is limited to asynchronous interruption.
- **User consequence:** A retry could encounter occupied ports or lingering helpers.
- **Canonical fix:** Define one signal-aware owner that forwards termination, waits with the existing bound, and exits with a meaningful code.
- **Required test:** Start with fake long-running children, send SIGINT and SIGTERM during readiness and Claude execution, assert bounded termination, exit code, no reachable port, and no child process.
- **Documentation change:** State stop/retry behavior and the recovery command if cleanup cannot complete.
- **Confidence:** **Medium**, absence of proof is direct; actual OS process-group behavior was not exercised.

### IMPROVEMENT

#### P-01 — “Reuse existing sidecar” is unreachable under the outer ownership policy

- **Impact:** Maintainers must reason about two startup policies even though only one is reachable.
- **Location:** Reuse branch at `bin/helix-cc-cliproxy:162`; earlier rejection at line 389; unreachable `already-running` output at line 706.
- **Proof:** `startProviderRuntime` rejects a verified existing gateway before calling `startSidecar`, so `gateway.child === undefined` cannot arise through this path.
- **Source of truth:** Current runtime enforces exclusive ownership.
- **Multi-location check:** All `run`, `serve`, `proof`, and matrix commands go through the rejecting function.
- **User consequence:** No present functional failure, but dead behavior obscures ownership and test intent.
- **Canonical fix:** Retain exclusive ownership and delete the unreachable reuse/result paths, unless reuse is deliberately made a real, fully specified feature.
- **Required test:** Assert that an existing compatible gateway produces the documented exclusive-ownership error.
- **Documentation change:** Record the exclusive-ownership invariant in provider lifecycle reference.
- **Confidence:** **High**.

## 6. Documentation review

### Inventory

| File | Intended audience | Job to be done | Must keep | Duplicate or stale material | Recommended disposition |
|---|---|---|---|---|---|
| `README.md` | Prospective/new user | Define product and reach first run | Product promise, support summary, five-minute native path, links | Repeats all provider procedures, architecture differences, proof history | Reduce to approximately 80–120 lines |
| `docs/quickstart.md` | First tester/operator | Complete installation and first workflow | Ordered commands and recovery | Missing common lifecycle completion and several mixed routes | Make the canonical HOW-TO |
| `docs/providers.md` | Advanced operator/maintainer | Provider concepts and configuration reference | Schemas, namespaces, status vocabulary, security boundaries | Repeats procedures and dated evidence; still describes deferral “from 0.3.0” | Remove procedural duplication; retain reference only |
| `STATUS.md` | Maintainer/reviewer | Current support and evidence ledger | Current state, pending proof, dated receipts | Mixes current state, completed work, cleanup history | Keep concise, current-first, with evidence links |
| `docs/openai-subscription-proof.md` | Reviewer | Dated OpenAI evidence | Exact receipt and scope limits | Not onboarding material | Retain under evidence/history |
| `docs/azure-copilot-routing-proof.md` | Reviewer | Dated Copilot/Azure evidence | Full-workflow receipt and Azure limitation | Large and not actionable onboarding | Retain under evidence/history |
| `docs/helix-claude-code-delta.md` | Architect/maintainer | Explain divergence from upstream | Durable architectural decisions | Secondary to current use | Label architecture reference |
| `docs/pi-dynamic-workflows-assessment.md` | Architect | Historical alternative assessment | Decision rationale if still useful | Not relevant to first-run users | Move/label as historical analysis |
| `docs/recommendation.md` | Maintainer | Historical product recommendation | Durable accepted decisions only | 427 lines and embeds a large dispatch prompt | Extract durable decisions; archive the rest |
| `review-prompts/*` | Reviewer | Reproducible review dispatches | Exact prompts if intentionally retained | Over 1,200 lines, not user documentation | Keep outside onboarding and label as review artifacts |
| `LICENSE` | All | Legal terms | Entire file | None | Keep unchanged |

### Is it short and sweet?

**No.** The writing is often precise, but the information architecture forces a user to distinguish current procedure from duplicated explanation and dated evidence. README, quickstart, and provider guide each partially act as the operating manual.

### Duplication and drift map

- Provider setup commands appear in README, quickstart, and providers reference.
- Copilot model policy appears in all three, while the executable default drifted—evidence that prose duplication is already masking behavioral divergence.
- Route states appear in README, quickstart, providers guide, and STATUS.
- Proof receipts appear in README, STATUS, and two proof documents.
- Architecture/recommendation material is linked too near the onboarding path.
- Generic “macOS or Linux/WSL” omits the platform floors and resource/network prerequisites currently documented for Claude Code.

### Smallest coherent structure

1. `README.md`: product definition, audience, current route states, minimum prerequisites, five-minute native path, and links.
2. `docs/quickstart.md`: the sole ordered procedure for install, every route, workflow, success/failure, recovery, update, and shutdown.
3. `docs/providers.md`: provider/state vocabulary, configuration schemas, namespace rules, security boundaries, and lifecycle reference only.
4. `STATUS.md`: current support, current automated evidence, dated external proof, and pending/deferred work.
5. Evidence/architecture/history: proof records, delta/architecture, Pi assessment, recommendation history, and review prompts.

### Precise consolidation plan

- Move README “Use OpenAI/Copilot/Azure” and mixed-route procedures into matching `docs/quickstart.md` route headings.
- Move README “What was backported/deliberately different” into `docs/helix-claude-code-delta.md`.
- Move README proof narrative into STATUS links; preserve the receipts in the two proof documents.
- Expand quickstart “Install or update” from `setup.sh`, `package.json`, and official platform requirements, including launcher PATH validation.
- Add a “Shared successful workflow” section immediately before provider-specific routes. Every route should rejoin it after proof.
- Add an explicit mixed-route table tested against `parseProviderSet`, covering all accepted subsets and Azure’s pending state.
- Replace providers-guide procedure blocks with links to exact quickstart headings.
- Split STATUS into “Current product state,” “Current automated gate,” “Dated live evidence,” and “Pending or deferred.”
- Relabel recommendation, Pi assessment, and review prompts as non-onboarding historical/review material.

## 7. Supported-provider HOW-TO review

### Actual support matrix

| Route | Actual state | Docs state | Complete step-by-step path? | Commands agree with code? | Success criterion stated? | Recovery stated? | Finding |
|---|---|---|---|---|---|---|---|
| Native Claude | Implemented; locally ready on review machine; account/policy still external | Supported | Partial | Yes | Partial | No | Missing clean install/PATH and terminal-result guidance |
| OpenAI subscription | Implemented and historically live-proven | Live-proven | Partial | Yes | Proof success not concretely illustrated | Authentication only | Does not explicitly rejoin `/helix-loop` workflow |
| GitHub Copilot | Implemented; `gpt-5.4` historically proven | Promoted for explicit `gpt-5.4` | No | **No** for bare command | Partial | Pin/auth only | Blocking implicit `gpt-5-mini` default |
| Azure Foundry GPT | Implemented and boundary-tested; live proof pending | Correctly marked pending | No | Explicit launch agrees | `"status":"passed"` is stated | No exact Azure recovery | Connection prerequisites and permissions are underspecified |
| OpenAI + Copilot | Implemented; historical full mixed proof | Live-proven | Partial | Yes with explicit models | Partial | No | No concrete per-role configuration or final outcome |
| OpenAI + Azure | Executable route; Azure unproven | Broadly implied, not guided | No | Parser/runtime support it | No | No | Missing canonical procedure |
| Copilot + Azure | Executable route; Azure unproven | Broadly implied, not guided | No | Parser/runtime support it | No | No | Missing canonical procedure |
| OpenAI + Copilot + Azure | Executable route; Azure unproven | Broadly implied, not guided | No | Parser/runtime support it | No | No | Missing canonical procedure |
| OpenRouter | Unsupported/deferred | Clearly deferred | Not required | N/A | N/A | N/A | Correctly excluded |

### Fourteen-step coverage

| Route | Covered | Missing or materially incomplete |
|---|---|---|
| Native | 2, 5, 8, 9, 10, 12, 14 | 1 exact prerequisites/PATH; 6–7 explicit route proof/success; 13 concrete recovery |
| OpenAI | 2–6, 8, 10, 12, 14 | 1 complete prerequisites; 7 exact success signal; 9 explicit loop continuation; 13 three likely failures |
| Copilot | 2–6, 8, 10, 12, 14 | 1, 7, 9, 13; launcher default contradicts promoted model |
| Azure | 2, 4–6, 8, 10, 12, 14 | 1; 3 exact `az` login/role path; 7 result example; 9; 13 |
| OpenAI+Copilot | 2–6, 8, 10, 12, 14 | 1, 7, 9, 11 concrete role object, 13 |
| Azure-containing mixed routes | Shared fragments only | No complete route-specific procedure for 1–14 |

There is **not** one hand-holding all-provider guide. `docs/quickstart.md` is discoverable and should become that guide, but currently it is a command collection plus status explanation rather than a complete zero-to-finished-workflow procedure for every exposed route.

## 8. Test review

### Exact check results

| Command | Exit | Result | Duration |
|---|---:|---|---:|
| `npm run check` | 0 | `validated helix-cc: 3 workflows, 9 agents, 2 skills` | 0.13 s |
| `npm test` | 0 | 66 passed; 0 failed; 0 cancelled; 0 skipped; 0 TODO | 670.851666 ms test runner; 0.81 s wall |
| `claude plugin validate --strict .` | 0 | Strict plugin validation passed | 0.27 s |

The first timing wrapper for `npm run check` tried to assign zsh’s read-only `status` parameter after the repository command had passed. The command was rerun with a corrected wrapper to obtain the clean exit and duration above. `npm run verify` was not counted separately because it composes these checks.

### Test-file classification

| Test file | Actual layer | What it proves | What it does not prove |
|---|---|---|---|
| `attested-proxy.test.mjs` | Unit/component HTTP boundary | Request validation, identity extraction, bounded payload/error behavior | Real Azure endpoint/authentication |
| `cliproxy.test.mjs` | Unit/component | Config, checksums, credentials, catalog/state logic, selected lifecycle failures | Full spawned helper chain and signals |
| `doctor.test.mjs` | Unit/component | Version/auth/state classification and formatting | Installed-plugin preflight in a real Claude session |
| `plugin.test.mjs` | Static source/document assertion | Manifest/agent/skill/workflow shapes and selected claims | Plugin discovery or invocation |
| `provider-matrix-proof.test.mjs` | Simulated-boundary component | Matrix proof script structure/result handling with injected agent | Real Workflow tool, models, or transcripts |
| `provider-proof.test.mjs` | Simulated-boundary component | Single-route proof contract with injected agent | Completed provider model call |
| `providers.test.mjs` | Unit | Provider parsing, mapping, namespace/config validation | Real command-line chain |
| `setup.test.mjs` | Subprocess component | Native launcher forwarding, some model forwarding, symlink and dry-run behavior | Full fresh setup, clean PATH, Copilot default |
| `workflow.test.mjs` | Component | Stage order, fan-out, retries, max-pass failure, model forwarding, evidence gate | Installed Workflow runtime or real agents |

### Matrix A — production surfaces

| Production surface | Current tests | Test layer | Meaningful assertions? | Important untested behavior | Adequacy verdict |
|---|---|---|---|---|---|
| Package/manifest/layout | Check, plugin tests, strict validator | Static/component | Yes for shape | Clean installed discovery | Partial |
| Setup/update | Setup tests | Subprocess component | Yes, narrow | Full setup, PATH handoff, old-Claude recovery, update preservation | Inadequate |
| Launcher parsing/defaults | Setup/providers tests | Unit/subprocess | Partial | Copilot-only default and all combinations | Inadequate |
| Doctor/status | Doctor and proxy tests | Unit/component | Yes | Real enabled-plugin context and concurrent runtime | Adequate for classification, not journey |
| Codex route | Proxy/provider tests and dated proof | Component + historical external | Mostly | Current complete model call and launch | Partial |
| Copilot route | Pin/discovery tests and dated proof | Component + historical external | Mostly | Current gateway process, default, alias drift | Partial |
| Azure route | Attested proxy tests | Component boundary | Yes | Live auth, deployment, catalog and model call | Partial |
| Mixed routing | Parser/matrix component + historical receipt | Component + historical external | Yes for namespacing | Azure combinations and real role assignment | Partial |
| Provider process lifecycle | Proxy tests | Component | Partial | Start chain, failed readiness cleanup, interruption | Inadequate |
| Proof workflows | Proof tests | Simulated-boundary component | Yes for contract | Actual Claude Workflow and transcript | Inadequate as E2E |
| Nine-role delivery | Workflow test + dated mixed receipt | Component + historical external | Strong orchestration assertions | Current installed-plugin terminal journey | Partial |
| Plugin skills/invocation | Static assertions/validator | Static | Shape only | `/helix-loop` and doctor invocation | Inadequate |
| Documentation commands | Scattered source assertions | Static | Limited | Parser/help consistency and ordered procedure | Inadequate |
| Platform branches | Artifact-selection tests | Unit | Limited | Clean macOS/Linux/WSL setup | Inadequate |

### Matrix B — user-journey proof

| User journey | Highest-fidelity current proof | Current or historical? | Reproducible in normal gate? | Missing proof | Required next test |
|---|---|---|---|---|---|
| Fresh installation | Launcher-only subprocess test | Current | Partly | Full clean setup and next-shell PATH | Disposable-HOME install test |
| Native first run | Local doctor plus static plugin validation | Current | Partly | Real command to terminal workflow result | Installed-plugin native smoke |
| OpenAI first run | Dated live route receipt | Historical | No | Current login→proof→launch | Opt-in live acceptance |
| Copilot first run | Dated `gpt-5.4` receipt | Historical | No | Correct implicit behavior and current call | Launcher regression + opt-in live acceptance |
| Azure first run | Simulated attested proxy | Current component | Yes | Real Azure deployment call | Bounded account-specific acceptance |
| OpenAI+Copilot | Dated two-provider/full-workflow receipt | Historical | No | Repeatable installed route | Opt-in matrix/full-workflow acceptance |
| Azure mixed routes | Parser/boundary tests | Current component | Yes | Real combined catalogs and role execution | Mixed acceptance after Azure promotion |
| Successful delivery | Fake-agent workflow plus dated real run | Mixed | Component only | Current installed terminal result | Installed-plugin smoke |
| Retry then approval | Fake-agent workflow | Current component | Yes | Runtime structured handoffs | Installed Workflow retry scenario |
| Terminal rejection | Fake-agent workflow | Current component | Yes | User-visible terminal failure | Installed Workflow rejection scenario |
| Diagnose route | Current doctor/status execution | Current | Yes | Active-route diagnostics | Simulated active gateway integration |
| Update/exit | Source and narrow tests | Current | Partly | Update preservation and signal cleanup | Update + SIGINT subprocess tests |

### Test verdicts

- **Unit/component tests: NO, not sufficient.** They are generally meaningful and better than their count alone suggests, especially for workflow ordering and proxy validation. They are insufficient because core launcher/setup behavior is outside the tested combinations.
- **Integration/end-to-end tests: NO, not sufficient.** No normal-gate test begins through the installed user entrypoint and observes a terminal user-visible workflow outcome. Historical receipts are useful evidence but not a reproducible automated test.

### Minimal required additions

1. **Launcher route matrix:** invoke every provider subset with and without a model; assert the exact namespaced controller or an actionable failure.
2. **Clean-install handoff:** use a disposable HOME and fresh shell; assert launcher resolution or the exact required PATH action.
3. **Provider lifecycle integration:** simulate external proxy/Copilot/Azure/Claude processes; assert readiness, errors, exit codes, environment, and cleanup.
4. **Signal cleanup:** signal during startup and active Claude execution; assert bounded child termination and stable retry.
5. **Installed-plugin workflow smoke:** invoke `/helix-cc:helix-loop` through the plugin loader while faking only the model-provider boundary; assert all roles, writer ordering, and terminal approved/rejected results.

Real provider acceptance should remain separate and opt-in: one current exact-model route proof per promoted provider, plus one complete heterogeneous nine-role run before broad promotion.

## 9. Implementation and architecture assessment

### Correct and worth retaining

- One provider-set parser rejects duplicates/unknown providers.
- Namespaced model enforcement in mixed mode is conceptually sound.
- Azure deployment-to-served-model attestation is fail-closed.
- Codex credentials are isolated and classified without printing secrets.
- Copilot’s package, loader transformation, model identity, and dated pin are integrity-bound.
- The proxy state uses loopback-only endpoints, restrictive state-file modes, bounded reads, and explicit catalog readiness.
- Doctor separates local readiness, route readiness, policy verification, and historical proof rather than calling credentials “ready.”
- Normal failed startup and ordinary completion clean up owned children.
- Workflow writer ordering and bounded retry semantics are clear and tested.
- Documentation is updated as an explicit workflow stage before review.

### Duplicated, unreachable, or misleading

- Promoted model policy is duplicated between code and three documents and has drifted.
- Route procedures and support states are duplicated throughout the docs.
- Sidecar reuse and `already-running` result branches are unreachable under the exclusive-owner check.
- The CLI lacks an explicit signal-ownership layer.
- “Implemented route” and “promoted/live-proven route” are separate concepts, but the user-facing route grammar exposes Azure combinations more broadly than the guide can support.
- Static plugin/workflow validation is presented near historical live evidence without a sufficiently prominent fidelity distinction.
- Large recommendation/review artifacts make current-operating information harder to locate.

The current architecture does not warrant a rewrite. The root fixes are a single launcher route-policy source, explicit process ownership, a canonical documentation path, and higher-fidelity boundary tests.

## 10. First-principles path forward

### Smallest complete 0.3.x product

A Claude Code plugin with one deterministic installer/launcher, native Claude plus explicitly configured and proven external routes, one nine-role delivery workflow with bounded remediation, preflight/route proof/actionable failure/deterministic cleanup, and no promise that an implemented-but-unproven route is promoted.

### Exact user promise

> From a fresh supported macOS, Linux, or WSL environment, Helix CC provides one documented command path to install and verify the plugin, prove a selected promoted provider route, run a bounded multi-agent delivery workflow, recognize its final approved or rejected result, and safely stop, retry, or update.

### Consistent provider-state vocabulary

- **Deferred:** no supported execution path in this release.
- **Unavailable:** local prerequisite or configuration absent.
- **Locally ready:** tools/configuration/credentials pass read-only checks.
- **Route verified:** a current exact-model proof completed.
- **Workflow verified:** a full Helix delivery workflow completed on that exact route or mixture.
- **Historical evidence:** dated receipt only; never a current state.

“Implemented” belongs in engineering status, not as a user-ready state.

### Shared onboarding path

```text
prerequisites
→ install
→ verify launcher/plugin
→ choose route
→ connect/configure
→ read-only doctor/status
→ exact route proof
→ launch
→ /helix-cc:helix-loop
→ recognize approved/rejected terminal result
→ stop/retry/update/re-prove
```

### Deterministic before real work

- Supported OS/architecture and minimum versions.
- Launcher discoverability and plugin validation/discovery.
- Provider-set, model-prefix, and configuration validation.
- Credential class without secret disclosure.
- Port ownership and catalog readiness.
- Exact/pinned served model where required.
- Workflow input schema, role models, pass bound, and terminal-result contract.
- Cleanup on startup failure, normal exit, and interruption.

### Minimum meaningful test pyramid

- Focused units for parsing, schemas, identity extraction, and evidence gating.
- Components for doctor, proxy configuration, provider adapters, and workflow orchestration.
- Subprocess integrations for setup, launcher, process lifecycle, failure output, and signals.
- Installed-plugin deterministic smoke through `/helix-loop`.
- Opt-in current live proof per promoted provider.
- One current full heterogeneous nine-role acceptance before broader adoption.

### NOW — required for user testing

1. **Correct route policy**
   - Files: `bin/claudex`, launcher tests, README, quickstart, providers reference, STATUS.
   - Change: remove the unpromoted Copilot default; require an explicit attested model or centralize a promoted route policy.
   - Verify: route-matrix subprocess test; all local gates.

2. **Make installation handoff truthful**
   - Files: `setup.sh`, `tests/setup.test.mjs`, README, quickstart.
   - Change: validate `--bin-dir` discoverability and print exact PATH/restart action when absent.
   - Verify: disposable-HOME/minimal-PATH test plus a new shell resolving the documented command.

3. **Create the canonical HOW-TO**
   - Files: README, `docs/quickstart.md`, `docs/providers.md`, STATUS and proof/history links.
   - Change: apply the consolidation plan in section 6, including every exposed route, shared workflow continuation, exact success/failure, recovery, update, and stop behavior.
   - Verify: command/parser contract test, link check, and manual clean-room walkthrough.

4. **Raise integration evidence to the user boundary**
   - Files: setup/launcher/provider integration tests, package scripts if a distinct deterministic integration target is needed, STATUS.
   - Change: add clean-install, provider-lifecycle, and installed-plugin smoke tests.
   - Verify: failure-first demonstrations, then complete local gate.

5. **Specify and prove interruption ownership**
   - Files: `bin/helix-cc-cliproxy`, lifecycle integration tests, quickstart/providers lifecycle sections.
   - Change: explicit SIGINT/SIGTERM cleanup and retry contract.
   - Verify: signal during readiness and active child; no surviving child/port.

Final NOW verification:

```bash
npm run check
npm test
claude plugin validate --strict .
```

Then execute one clean-machine native workflow, repeat current exact OpenAI and Copilot route proofs, run one complete OpenAI+Copilot nine-role workflow, and record the exact revision/date. Azure remains unpromoted until its own bounded live proof succeeds.

### NEXT — required before broader adoption

- Exercise clean setup on supported macOS, Linux, and WSL baselines.
- Promote Azure only after exact live route and mixed-workflow evidence.
- Automate documentation link and command consistency.
- Remove unreachable sidecar-reuse behavior after confirming exclusive ownership.
- Define expiry/revalidation rules for dynamic Copilot aliases and other model catalogs.

### LATER — worthwhile improvements

- Move historical architecture, recommendation, and review artifacts into clearly labeled archival sections.
- Generate the human support-state table from a small route-policy data source if duplication persists.
- Add longer-running resilience checks for partial streaming and slow process shutdown.
- Reassess deferred OpenRouter only when it has a concrete user requirement; it is not a current blocker.

## 11. Residual uncertainty

| Unverified under this review | Why | Exact bounded follow-up |
|---|---|---|
| Current native model/workflow completion | Model-provider calls prohibited | Run one clean native task through `/helix-loop`, retain terminal result and exact versions |
| Current OpenAI subscription route | No provider calls | Run the documented single-route proof, then one representative delivery workflow |
| Current Copilot alias/model identity | Dynamic external catalog; no provider calls | Re-run `copilot-pin` and exact `gpt-5.4` proof; record served identity |
| Azure deployment route | `az` unavailable; no account/deployment | Use one nominated deployment, least-privilege caller identity, proof command, then one workflow role |
| Azure-containing mixed combinations | Depend on the preceding live route | Run the matrix for each route actually intended for promotion, not every parser permutation |
| Clean supported-platform installation | Review used an existing macOS checkout | Disposable macOS and Linux/WSL clean-machine walkthrough with minimal PATH |
| SIGINT/SIGTERM behavior | No process-interruption test was present | Add the bounded subprocess signal tests described above |
| Dynamic external documentation/contracts | Can change after 2026-07-19 | Recheck official Claude and Microsoft prerequisites immediately before release promotion |

## 12. Final identity proof

Repeated identity gate at the end of the read-only review:

```text
pwd
/path/to/helix-cc

git rev-parse --show-toplevel
/path/to/helix-cc

git remote get-url origin
https://github.com/luisgui1757/helix-cc.git

git branch --show-current
main

git rev-parse HEAD
6b906ed7274b24c6652dee9e40d6b64a5ed611ea

git status --short
 M .gitignore
?? review-prompts/helix-cc-repository-wide-user-test-readiness-review.md
```

Branch, HEAD, origin, and working-tree status exactly matched the initial identity gate and the prompt-authorized dispatch-file exception. The repository remained unchanged during the review.

## 13. Consolidated implementation resolution — 2026-07-19

This section is an append-only status update. Sections 1–12 remain the exact
read-only review of version 0.3.1 at
`6b906ed7274b24c6652dee9e40d6b64a5ed611ea`; they have not been rewritten to
make the historical verdict appear green.

### Resolution verdict

**READY FOR STRUCTURED USER TESTING** on native Claude, the exact promoted
OpenAI-subscription route, the exact promoted GitHub Copilot route, and their
documented mixture. Version 0.3.2 closes every blocking and important finding
from this review plus the independent Fable review supplied to the maintainer.
Azure remains an explicit proof-pending route rather than an implied success.

### Finding disposition

| Finding | Final disposition | Verification |
|---|---|---|
| B-01 / Fable B3 — implicit Copilot controller | Accepted and fixed | Every provider-backed launch now requires one explicit route-valid model; launcher and main-entrypoint regressions pass |
| B-02 — setup PATH handoff | Accepted and fixed | Disposable-home/minimal-PATH subprocess test verifies the exact current-shell and startup-file handoff |
| B-03 / Fable I2–I3 — incomplete and duplicated HOW-TO | Accepted and fixed | `docs/quickstart.md` is the sole zero-to-workflow procedure; README and provider reference link to it; command/link contract test passes |
| Fable B1 — wrapped-session preflight contradiction | Accepted and fixed | The wrapper emits a bounded receipt only after catalog readiness; the real doctor subprocess accepts it after direct gateway values are scrubbed and reports no gateway value |
| Fable B2 — doctor command resolution | Runtime-blocker claim rejected; ambiguity removed | [Claude's plugin contract](https://code.claude.com/docs/en/plugins-reference) adds plugin `bin/` to Bash-tool PATH, so an external-shell `command -v` was not runtime proof. Both skills nevertheless use `node "${CLAUDE_PLUGIN_ROOT}/bin/helix-cc-doctor" --json` explicitly |
| I-01 / Fable I1 — gate below production entrypoints | Accepted and fixed | Main proxy help, failure, read-only status, launch/proof route checks, launcher subprocesses, and scrubbed-session composition now execute production entrypoints |
| I-02 / Fable P8 — interrupted cleanup | Accepted and fixed | Foreground ownership forwards termination, escalates after the bound, and a subprocess test proves the unresponsive child is gone with exit 143 |
| Fable I4 — stale promoted-route skill text | Accepted and fixed | Skill names the current OpenAI, Copilot, and mixed receipts while retaining Azure's proof-pending state |
| Fable P1 — option-order dependence | Accepted and fixed | `claudex` parses wrapper options throughout argv; reordered launch regression passes |
| Fable P2 / P-01 — unreachable sidecar reuse | Accepted and fixed | Dead reuse/result branches removed; one-owner lifecycle documented and tested |
| Fable P3 — wrong dependency recovery | Accepted and fixed | Error now names the locked `npm ci --ignore-scripts --include=optional` command |
| Fable P4 — ambient Copilot path environment | Accepted and fixed | Resolver accepts an explicit environment seam |
| Fable P5 — external links and doctor jargon | Split | The questioned OpenAI URLs remain valid official redirects, so that link concern is recorded as a false alarm. The jargon field was renamed to `dynamicWorkflowsPeerCompatible` and documented |
| Fable P6 — misleading launcher version check | Accepted and fixed | HOW-TO uses `claudex --claudex-help` for launcher identity and states that `--version` belongs to Claude Code |
| Fable P7 — stale STATUS commit pin | Accepted and fixed | STATUS carries date/version/current evidence without a self-invalidating pre-update hash |

### Final evidence on the remediated tree

| Surface | Result |
|---|---|
| Plugin structure | `npm run check` passed: 3 workflows, 9 agents, 2 skills |
| Deterministic suite | 76 passed; 0 failed, skipped, or TODO |
| Strict validator | `claude plugin validate --strict .` passed on Claude Code 2.1.214 |
| OpenAI route | `gpt-5.6-luna` proof passed with one matching Workflow transcript |
| Copilot route | Fresh `gpt-5.4` pin resolved to `gpt-5.4-2026-03-05`; exact proof passed with one matching transcript |
| Mixed matrix | OpenAI + Copilot proof passed with both exact resolved models and two transcripts |
| Full delivery | Disposable repository completed in one pass with `approved: true`; seven `gpt-5.6-luna` and two `gpt-5.4` transcripts; two fixture tests and `git diff --check` passed; no permission denials |
| Cleanup | Gateway returned to `unreachable`; no owned helper process remained |
| Azure | Not run: Azure CLI and deployment configuration remain unavailable; route stays unpromoted |

The full live delivery started through `bin/helix-cc-cliproxy run`, loaded the
plugin with `--plugin-dir`, invoked the shipped `helix-delivery` Workflow, and
observed the terminal structured result. The normal deterministic suite does
not contact provider endpoints; its new subprocess coverage exercises the
launcher, runtime entrypoint, active-session doctor composition, and process
lifecycle at their actual local boundaries.
