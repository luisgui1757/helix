# Fusion-Style Dispatch Architecture Spec

Status: Accepted Stage 3A build-spec. Stage 3B `dispatch-policy-core` built the
pure policy/config/schema/run-record substrate
([`docs/stage3/dispatch-policy-core.md`](../stage3/dispatch-policy-core.md));
Stage 3C added the thin one-cycle orchestrator over it — mock adapters only,
still no live model calls
([`docs/stage3/dispatch-orchestrator.md`](../stage3/dispatch-orchestrator.md)).

Prime's Phase 3 multi-model architecture uses the concept behind OpenRouter
Fusion, not the hosted `openrouter/fusion` model as the core design. The
canonical architecture is a policy-bound model panel, structured comparison,
synthesis, and objective verification loop.

Stage 3B implemented the substrate described here; Stage 3C sequences it into
one mock-backed dispatch cycle and nothing more. Anything beyond the exhaustive
build boundary below (hosted adapters, live/paid calls, autonomous loops beyond
one depth) remains blocked.

## Primary Inputs

- OpenRouter Fusion announcement:
  https://openrouter.ai/blog/announcements/fusion-beats-frontier/
- OpenRouter Fusion plugin guide:
  https://openrouter.ai/docs/guides/features/plugins/fusion
- RouterBench:
  https://arxiv.org/abs/2403.12031
- RouteLLM:
  https://arxiv.org/abs/2406.18665
- FrugalGPT:
  https://arxiv.org/abs/2305.05176
- Mixture-of-Agents:
  https://arxiv.org/abs/2406.04692
- LLM-Blender:
  https://arxiv.org/abs/2306.02561
- Multiagent debate:
  https://arxiv.org/abs/2305.14325
- LLM-as-judge bias:
  https://arxiv.org/abs/2506.22316

## Source Reading

OpenRouter Fusion separates a multi-model pipeline into:

1. Parallel candidate generation by a model panel.
2. Structured judge/comparison over those candidates.
3. Final synthesis by the calling model.
4. Bounded invocation rules such as a max tool-call count and recursion
   protection.

The papers above support four Prime requirements:

- **Routing is a cost/quality policy decision, not a fixed model count.**
  RouterBench and RouteLLM show that model routing must be evaluated against
  cost and task quality, not assumed.
- **Cheap-first cascades are legitimate when quality gates hold.** FrugalGPT
  supports routing/cascading as a way to reduce cost, but Prime must still
  stop when the objective gate fails.
- **Fusion/debate need structure.** Mixture-of-Agents, LLM-Blender, and
  multiagent debate support panel, comparison, and synthesis patterns; they do
  not make a model judge final authority.
- **Judges are biased.** LLM-as-judge bias work requires blind/randomized
  candidate ordering, stable rubrics, and escalation of unresolved conflicts.

## Non-Negotiable Requirements

- Use approved providers only: OpenAI, OpenRouter, GitHub Copilot, later Azure
  Foundry, and Claude only through the ROADMAP Q4 path after the
  live-billing/policy probe accepts it.
- The `no-spend-test` profile may use only mock providers and metadata-verified
  OpenRouter `:free` models. No real Copilot, OpenAI, Claude, Azure, or paid
  OpenRouter call is allowed in that profile.
- GitHub Copilot test calls belong only to explicit personal/maintainer
  profiles and must use the pinned cheapest eligible model entry from config.
- The hosted `openrouter/fusion` adapter is never the default path. It may
  become an optional adapter only after privacy, routing, price,
  provider-policy, recursion, and no-unapproved-fanout checks pass.
- The judge is never final authority. The final accept/reject decision comes
  from objective gates, source-of-truth citations, cost policy, provider
  policy, and explicit user constraints.
- The model set is task policy, not a hardcoded count. Some tasks use one model
  plus checks; higher-stakes tasks use two or more candidates plus structured
  comparison and synthesis.
- Every dispatch projects cost and token exposure before launch. Unknown price,
  unknown provider policy, unknown endpoint, unknown model eligibility, or stale
  price verification fails closed.
- Public artifacts must be safe for a future public repo: no secrets, auth
  contents, raw provider payloads, raw prompts/responses containing private
  code, session URLs, home paths, or hidden local state.

## Provider And Cost Policy

Prime has three dispatch profiles.

| Profile | Purpose | Eligible providers | Cost rule | Network rule |
| --- | --- | --- | --- | --- |
| `no-spend-test` | CI/local verification and smoke tests | mock providers; OpenRouter models only when id ends `:free` and provider metadata says price is zero | hard zero metered spend; refuse unknown/stale metadata; synthetic/public-safe fixture input only | only approved endpoints; no hosted Fusion |
| `personal` | Maintainer daily use | OpenAI, OpenRouter, GitHub Copilot, Claude-local candidate only if ROADMAP Q4 later accepts it | show projected spend/token exposure before multi-model runs; require confirmation above configured threshold | approved providers only |
| `lockdown` | corporate/public-safe mode | Azure Foundry/internal gateway/local model endpoints; other providers only if allowlisted at boundary | configured budget plus endpoint allowlist; numeric cap must be supplied by profile config | deny-by-default boundary; OpenRouter normally off unless explicitly approved |

Default caps:

- `no-spend-test`: USD 0 metered spend, 2 candidates max, 2 successful
  candidates required, 1 judge pass, 1 synthesis pass, 1 iteration.
- `personal`: user-configurable; default warning before any wide matrix, max 5
  primary iterations, and hard stop at the roadmap backstop ($100 metered spend
  or 10M tokens per run, whichever trips first).
- `lockdown`: max 5 primary iterations unless profile config is stricter;
  numeric metered-spend/token caps and endpoint allowlist must be supplied by
  profile config; unknown endpoint, unknown model, or missing cap means stop.

No implementation may compute spend from stale constants. If Pi or a provider
does not expose current price metadata, the dispatcher records
`price_status: unknown` and refuses automatic wide dispatch. Subscription
providers record token usage and subscription-consumption status; the token cap
always binds. The USD cap counts only metered spend. Subscription consumption is
not converted to dollars unless the provider exposes authoritative pricing.

OpenRouter `:free` eligibility is two-part: the model id must end in `:free`,
and current provider metadata must verify zero price. Metadata verification time
and source are recorded in the run record. No-spend fixtures must be synthetic
or already-public content, never private repository content.

Stage 3B pins this (review finding N4) as metadata fields `verified_at`,
`source`, and `ttl_seconds`, with profiles carrying `price_ttl_seconds` and
`copilot_pin_ttl_seconds`. Price is fresh only when explicitly verified,
non-future, finite-TTL bounded, and within TTL; anything else is stale and fails closed
(`dispatch/lib/cost-policy.mjs`).

GitHub Copilot is intentionally absent from `no-spend-test`. Personal-profile
Copilot tests require a pinned config entry with model id, verification date,
source, included/zero-multiplier status if available, and overage policy. If the
pin is stale or absent, Copilot dispatch stops.

Provider identifiers in run records are Prime-canonical, not necessarily the
verbatim Pi provider id. Stage 3B owns the canonical-to-Pi mapping table. The
initial canonical set is:

| Prime provider | Pi/runtime source |
| --- | --- |
| `openai-codex` | Pi native OpenAI Codex OAuth/subscription provider |
| `openai-api` | Pi native/OpenAI-compatible API-key provider |
| `openrouter` | Pi native OpenRouter provider |
| `github-copilot` | Pi native GitHub Copilot OAuth/subscription provider |
| `azure-foundry` | `models.json` / OpenAI-compatible Azure AI Foundry entry |
| `claude-local` | first-party Claude CLI wrapper only if ROADMAP Q4 accepts it |
| `mock` | deterministic fixture provider |

Native Claude OAuth is excluded from automated dispatch until ROADMAP Q4 is
settled. The existing fallback ratification applies to interactive/manual use
with explicit extra-usage warnings, not to Stage 3 dispatch.

## Role Schema

Roles are stable identifiers, not decorative labels. Cosmetic callsigns may be
displayed, but logs, fixtures, and tests use canonical names.

Canonical roles:

- `scout`: gather source facts and candidate approaches.
- `planner`: produce a CGS-first plan and stopping criteria.
- `builder`: implement the selected plan.
- `reviewer`: independently review behavior, risks, and missing tests.
- `redteam`: search for security, correctness, and public-safety failures.
- `judge`: compare candidates against a rubric; never final authority.
- `synthesizer`: produce the final recommendation/action plan from the judge
  analysis and preserved disagreements.
- `verifier`: run objective gates and summarize proof.
- `documenter`: update roadmap/README/status docs after behavior changes.

Every role output must conform to the same envelope:

```json
{
  "schema_version": 1,
  "run_id": "string",
  "stage": "candidate|judge|synthesis|verification",
  "role": "scout|planner|builder|reviewer|redteam|judge|synthesizer|verifier|documenter",
  "provider": "openai-codex|openai-api|openrouter|github-copilot|azure-foundry|claude-local|mock",
  "model": "string",
  "cost_class": "free|subscription|paid|unknown",
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "cost_estimate_usd": null,
    "cost_actual_usd": null,
    "cost_basis": "metered|subscription|free|unknown",
    "price_status": "verified|unknown|stale|not_applicable",
    "price_source": "string|null"
  },
  "attempt": 1,
  "iteration": 1,
  "input_ref": {
    "kind": "sha256|redacted-id|local-ref",
    "value": "string",
    "algorithm": "sha256|null"
  },
  "claims_ref": "local-ref-or-hash",
  "evidence_ref": "local-ref-or-hash",
  "uncertainty": ["string"],
  "risks": ["string"],
  "recommendation": "string",
  "proposed_actions": ["string"],
  "open_questions": ["string"],
  "status": "ok|blocked|failed|refused|timeout"
}
```

Stage 3B must use TypeBox as the runtime validator. TypeScript types alone are
insufficient because provider/model outputs arrive at runtime, and TypeBox is
the Pi-native pattern already used by the extension API and Stage 1+2. Tests
must prove malformed role outputs fail closed before they can reach
judge/synthesis.

Stage 3B implementation note (recorded contradiction). The tested policy core
cannot import TypeBox: this package forbids installed runtime dependencies
(`tools/check-prime-resources.mjs`) and pins `extensions/` to its two existing
files, and the bare `typebox` specifier resolves only inside Pi's runtime, not
under `node --test`. The runtime validator (`dispatch/lib/schema.mjs`) is
therefore a zero-dependency structural checker whose schema descriptors are
authored in the exact JSON-Schema shape TypeBox emits, so they are drop-in for
real TypeBox once the dispatcher is wired into a Pi extension. The requirement
this clause protects — runtime, not TypeScript-only, fail-closed validation — is
met and tested. Reconciliation detail: `docs/stage3/dispatch-policy-core.md`.

Role/stage validity:

| Stage | Allowed roles |
| --- | --- |
| `candidate` | `scout`, `planner`, `builder`, `reviewer`, `redteam`, `documenter` |
| `judge` | `judge` |
| `synthesis` | `synthesizer` |
| `verification` | `verifier`, `documenter` |

`input_ref` is a reference to ignored local storage or a SHA-256 hash of the
exact prompt payload. The algorithm is recorded. Role claims/evidence stay as
local refs or hashes until a public-safe export step exists.

## Routing Policy

Routing starts with task classification. The classifier may be deterministic at
first; it must be testable and visible in logs.

| Task class | Default route | Panel size | Min successes | Judge/synthesis rule | Objective gate |
| --- | --- | ---: | ---: | --- | --- |
| `trivial` | single model or local tool | 1 | 1 | no judge | relevant command or none if informational |
| `routine-code` | builder + independent reviewer | 2 | 2 | synthesize only if reviewer disagrees | tests/lint/typecheck/pr-gate |
| `architecture` | scout/planner panel + judge + synthesis | 2-3 | panel size | blind compare; preserve disagreements | spec checklist + review |
| `security` | redteam panel + judge + synthesis | 2-3 | panel size | cross-family required when providers available | public-safety/security gates |
| `roadmap-reconciliation` | planner/reviewer panel + judge + synthesis | 2-3 | panel size | contradiction ledger required | roadmap consistency check |
| `pr-preflight` | reviewer/redteam panel + verifier | 2-3 | panel size | preserve blockers; no synthesis success without gates | pr-gate/checklist |
| `risky-change` | builder + independent reviewer/redteam | 2-3 | panel size | synthesize only after reviewer/redteam pass | relevant tests + risk gate |
| `ui-quality` | prime-ui skill path + reviewer | 1-2 | panel size | synthesize only material alternatives | visual/accessibility/perf checks |

Rules:

- A two-model panel does not require one model to be the arbiter. `judge` is a
  logical role that can run on a separate model, the cheaper configured judge,
  or the synthesizer model when the profile is constrained. The system must not
  treat one candidate model as inherently authoritative.
- For high-stakes tasks, prefer a cross-family judge or reviewer when eligible
  providers are configured. If only one family is available, warn and reduce the
  claim to "same-family review", not "independent review".
- If a panel member fails, continue only when the route's `min_successes` is
  still met. Otherwise stop. Never silently shrink a panel and report success.
- Profile-cap vs route precedence (review finding N3, Stage 3B `resolvePanel`):
  profile caps are maxima; a route's `min_successes` applies to the launched
  candidates; a capped panel is recorded as a `panel-capped-by-profile` warning,
  never silently shrunk; a cap that drops the launched panel below the route
  minimum, or required successes above the launched count, fails closed.
- Recursion depth is one: a Fusion-style dispatch cannot call another
  Fusion-style dispatch inside panel, judge, or synthesis stages.
- Classification floors are mandatory. Tasks touching auth, credentials,
  provider config, egress, telemetry, sandboxing, persisted data shape, branch
  protection, release gates, or public-safety scans can never route below
  `security` or `risky-change`. PR preflight and risky changes map explicitly to
  the table above. Uncertain classification routes upward to the higher-risk
  class or stops for user input in TUI mode. User overrides are allowed only to
  raise risk or to disable adversarial review explicitly; every override is
  recorded.
- Route config reserves `effort` and `instances`; Stage 3L/M/N implements the
  per-role matrix shape
  `role -> [{ provider, model, effort, instances, price? }]`. `effort` may be
  `default|low|medium|high|xhigh|max|provider-managed`; `instances` is a
  positive integer bounded by route/profile caps and the finite loop token budget.
  Optional `price` metadata is carried to the shared provider/cost gate for
  metadata-verified OpenRouter `:free` specs.
- Convergence means diff stability plus objective-gate pass. Model consensus
  alone is never convergence.

## Judge-Bias Mitigations

Required in Stage 3B:

- Rubric-first judging: the rubric is fixed before candidates are seen.
- Candidate order randomized or blinded before judge input.
- Candidate provider/model labels hidden from the judge by default; labels may
  be revealed only when provider-specific capability matters and must be logged.
- Pairwise comparison for 2-3 candidates before any absolute score.
- The judge returns consensus, contradictions, partial coverage, unique
  strengths, blind spots, and failure risks. It does not merge candidates.
- The synthesizer must quote unresolved contradictions into the final output
  instead of averaging them away.
- Judge input is a projection of the role envelope: provider, model,
  cost_class, usage, and other identifying fields are stripped; candidates are
  re-keyed as A/B/C. The projection records an RNG seed so deterministic
  fixtures can reproduce randomized order. A label reveal is allowed only by
  config or explicit TUI user approval and is recorded as a reveal event.
- The judge model must not be one of the candidate models when an eligible
  alternative exists. If no eligible alternative exists, the run records a
  `judge_in_panel` degradation warning.

Optional later:

- Self-consistency across repeated judge passes.
- Separate judge and verifier models for high-risk tasks.
- Per-fixture judge-bias regression tests.

## Failure Behavior

Fail closed when:

- No eligible model exists for a required role.
- Cost, endpoint, or provider policy is unknown for automatic dispatch.
- A provider returns an auth, rate-limit, quota, or policy refusal that drops
  below `min_successes`.
- A role output does not validate against the envelope.
- Objective gates fail after the allowed iteration budget.
- Public-safe logging cannot be guaranteed.
- Escalation is needed in non-TTY mode. In `print`, `json`, `rpc`, CI, or any
  mode without a real terminal, escalation means a fail-closed stop with the
  reason recorded. This mirrors the yolo-fence rule: terminal-only interaction
  is gated on `ctx.mode === "tui"`, not on `hasUI`.

Escalate to the user when:

- Candidates materially contradict each other and objective evidence does not
  resolve the contradiction.
- The no-spend test profile has fewer than the required current metadata-verified
  `:free` OpenRouter models in Pi inventory.
- GitHub Copilot has no current pinned eligible model entry for the selected
  personal/maintainer profile.
- The task would exceed the configured cap but the user may approve a wider run.

Where no objective gate exists, dispatch output is advisory and the human user
is final authority. Gate outcomes enter the run record from process exit status
or a deterministic checker result; the verifier summarizes proof but never
determines the recorded gate result.

## Public-Safe Logging

Stage 3B persists structural public-safe run records only:

- run id, timestamp, task class, route id, role ids, provider/model ids, cost
  class, price status, usage rollups, cap status, iteration count, exit status,
  gate command names, warning codes, judge seed/permutation, blinding flag,
  rubric id, label-reveal events, and redacted/hashes of inputs.
- branch name and objective gate file paths only when the run target is this
  repository; other branch names and file paths are omitted or hashed.
- refs/hashes to ignored local claims/evidence, not the free text itself.

Raw prompts, model responses, provider payloads, and transcripts must stay in
ignored local storage until a mechanical redaction/export step exists. A future
public PR may include only the structural public-safe summary. Free-text
claims/evidence may enter a public-safe record only after that export step
defines deterministic checks for secrets, private code excerpts, private file
names, session URLs, home paths, and provider payload residue.

## Evaluation Fixtures

Stage 3B must add deterministic fixtures before live model calls. These are
dispatcher/policy fixtures over canned mock provider outputs; they do not test
model quality.

1. `roadmap-reconciliation`: candidates disagree on a roadmap checkbox; expected
   output preserves the conflict and requires an evidence-backed resolution.
2. `code-review`: one candidate misses a security regression; judge catches the
   contradiction; objective gate remains final.
3. `extension-implementation-plan`: panel proposes different Pi-extension
   shapes; synthesis selects the one matching Pi APIs and no slash clutter.
4. `security-posture`: redteam flags a hidden egress or provenance leak;
   dispatcher refuses success until the public-safety gate passes.
5. `ui-quality`: prime-ui path produces a design recommendation; verifier keeps
   accessibility/performance checks separate from model taste.

Success metrics:

- structured role output validation passes/fails deterministically.
- no-spend profile never selects a paid OpenRouter model or any real non-
  OpenRouter provider.
- unknown cost/policy fails closed.
- judge bias mitigations are observable in the run record.
- unresolved contradictions are preserved.
- objective gate result controls convergence.
- fixture oracles define expected route, warnings, cap state, gate state, and
  public-safe run-record shape.

## Stage 3B Build Boundary

Allowed in the next implementation slice (exhaustive):

- pure dispatch-policy library and tests.
- route/profile config schema.
- deterministic model/provider fixtures and mock provider adapter.
- TypeBox role envelope validator.
- structural public-safe run-record writer for hashes/refs and metadata only.
- no-spend OpenRouter `:free` smoke only after the pure tests pass and current
  metadata/preflight/inventory prove the candidate spend-safe.

Not allowed in the next implementation slice:

- hosted `openrouter/fusion` adapter in any form.
- paid live model calls of any provider.
- Azure Foundry live tests without the work-laptop/provider setup.
- autonomous/unattended loops until per-run caps, structural records, hard stop
  conditions, and the aggregate session/daily ceiling are implemented.
- live pipeline UI.
- pi-messenger adoption before its no-exfiltration audit.
- replacing objective gates with a model judge.
- direct API/provider calls beyond the no-spend OpenRouter `:free` smokes.

In-loop PR checks use dry-run/checklist semantics. `tools/ship/pr-gate.sh`
remains the pre-PR gate; Stage 3B must not run it mid-iteration in a way that
expects a clean tree while implementation is still in progress.

## Acceptance Bar

This Stage 3A spec is accepted only when review confirms:

- provider allowlist and per-profile cost ceilings are explicit.
- role schema is concrete enough to validate.
- routing policy by task class and risk is specified.
- evaluation fixtures and success metrics are specified.
- judge-bias mitigations are mandatory.
- failure/escalation behavior is fail-closed.
- public-safe logging excludes raw private payloads and free-text
  claims/evidence until a mechanical export step exists.
- a no-spend OpenRouter `:free` test profile is defined.
- metering/cap fields make token and spend ceilings enforceable.

After acceptance, the next branch should be `stage3/dispatch-policy-core`.
