# Graph mode

Helix CC `0.5.x` provides two execution modes for each of its six public loops:

- `original` is the default and runs the existing audited standalone workflow;
- `graph` is secondary and runs a generated standalone workflow compiled from a
  validated graph definition.

The modes accept the same public input objects, invoke the same agent roles and
trusted child verifier, preserve the same labels and schemas, and return the
same observable results and failures. Graph mode is not a provider, tool, or
authority expansion.

## Selecting a mode

Each public skill must display and confirm the mode plus exact script path:

| Loop | Original mode | Graph mode |
|---|---|---|
| Delivery | `workflows/helix-delivery.js` | `workflows/graph/helix-delivery.js` |
| Implement-review | `workflows/helix-implement-review.js` | `workflows/graph/helix-implement-review.js` |
| TDD fix | `workflows/helix-tdd-fix.js` | `workflows/graph/helix-tdd-fix.js` |
| Scout | `workflows/helix-scout.js` | `workflows/graph/helix-scout.js` |
| Research | `workflows/helix-research.js` | `workflows/graph/helix-research.js` |
| Ship pre-PR | `workflows/helix-ship-pre-pr.js` | `workflows/graph/helix-ship-pre-pr.js` |

Omitting the selection means `original`. Mode is bound by the selected script
path and is not passed as a mutable workflow argument. A supplied value other
than exact `original` or exact `graph` must stop before doctor, evidence-session,
or Workflow invocation; test-mode selection enforces the same closed set.

Do not compare live write modes sequentially in one checkout. Use the
deterministic parity suite, or run each mode in a separate equivalent disposable
repository with a fresh evidence session. Never execute both shipping modes as
a live comparison because that would duplicate external effects.

## Definition model

Definitions under `graph/definitions/` are closed versioned JSON. They contain
no functions, JavaScript expressions, prompts, shell commands, or arbitrary
predicates. A definition declares:

- one entry node;
- typed `operation`, `fork`, `decision`, and `terminal` nodes;
- registered operation names;
- `control`, `read`, `write`, `evidence`, or `ship` effects;
- an independent `mutatesCheckout` capability (so an evidence operation can
  truthfully also be checkout-mutating);
- declared context reads and writes;
- outcome-labeled transitions;
- tags required before approval;
- explicit cyclic components, entry-crossing rails, and maximum bounds; and
- approved terminals.

The validator rejects unknown fields, duplicate or missing nodes, unreachable
states, incomplete outcomes, unsafe parallel capabilities, unavailable context,
non-string identifiers, unregistered operations, unmatched cyclic components,
cycles that can avoid their bounded entry, missing fresh approval requirements,
and excessive derived step ceilings.

Every successful path after a checkout mutation must cross the required fresh
evidence and deterministic-gate tags. A later mutation resets that proof state.
The signed TDD red reproducer is therefore rendered as both `evidence` and
`mutates checkout`; write/ship effects must declare mutation, and forks cannot.
Shipping preserves the original exact confirmation and preflight contract.

Each definition has a same-ID catalog under `graph/catalogs/`. Catalog entries
declare an operation's node kind, effect class, checkout-mutation capability,
context reads and writes, freshness tags, and complete outcomes. Compilation
requires an exact three-way match among definition nodes, catalog contracts, and
immediately bound async operation constants in the audited template. The
compiler alone emits the frozen runtime registry, so duplicate, extra, missing,
decoy, and unmarked bindings cannot displace a reviewed operation. Missing,
orphaned, or mismatched source sets fail generation.

## Compilation and artifacts

Run:

```bash
npm run graph:generate
npm run graph:check
```

The compiler combines a validated definition, its audited checked-in operation
template, the exact original workflow input/schema prelude where applicable,
and the bounded graph dispatcher. It emits an import-free standalone script
under `workflows/graph/`, with the definition digest and derived absolute step
ceiling embedded.

`docs/workflow-graphs.md` is rendered from those same definitions. Generated
workflow and diagram files must never be hand-edited. CI regenerates them in
memory and refuses missing or stale output.

Templates remain reviewed code because they contain the prompts and registered
operation implementations. Graph definitions control ordering and transitions;
they cannot add an operation that its template did not register.

At runtime, every operation receives a guarded context. The dispatcher rejects
undeclared reads, top-level writes, definitions, deletions, nested mutations,
and any declared write that the current operation did not actually perform.
Context objects and arrays are copied into accessor-free plain structured
values without reading a custom prototype's properties, cross-key aliases are
preserved during initial admission, and the copies are recursively read-only;
changes must replace a declared top-level key, so
even a nested mutate-then-restore attempt fails at the first write. Every
operation receives fresh revocable state and nested-value proxies. The runtime
revokes them as soon as the awaited operation finishes and snapshots arguments
to agent and child-workflow boundaries together while the capability is active,
so aliases within one call are preserved while a later operation or retained
boundary argument cannot reuse an earlier capability. The state capability
itself cannot be copied into graph context or a boundary argument. Property
descriptors and prototypes receive the same recursively read-only protection;
inherited methods are exposed only as protected receiver-bound calls, never as
mutable raw function objects. Accessors, context function/symbol values,
definitions, prototype changes, extension locks, and unsupported
non-structured values fail closed.

The compiler parses lexical scopes and rejects an operation that can reach any
value feeding graph state directly, through function or class declarations,
helper closures, later assignments, property-assigned helpers, transitive
aliases, or the enclosing Workflow function's implicit `arguments` binding. It
also rejects identifier, property, built-in mutator, and locally analyzable
call/constructor writes from an operation into an outer lexical binding,
including class constructors, built-in aliases, call/apply/bind/construct forms,
and operation-local aggregate aliases. Dynamic computed operation calls and
direct or aliased evaluation, source constructors, and constructor-derived
callables are forbidden so dynamic dispatch or source strings cannot bypass
lexical analysis. Helper/callback parameters must be simple identifiers and
cannot be mutated; operation-local destructuring, classes, and sequence
callables fail closed rather than exceeding the analyzer's supported grammar.
Aggregate
and call-mediated writes conservatively propagate dependencies across nested
object/array arguments, destructuring targets, object definition/assignment
helpers, direct or computed method calls, `Reflect.apply`, constructors, array
mutators, object/class methods, property-assigned functions, and custom helper
calls outside operations. Context reads and writes use the JavaScript-safe
identifier grammar; hyphenated IDs remain available for nodes, outcomes, and
tags. Compiler-generated shadows remain a second boundary.
This makes the catalog an enforced execution contract instead of descriptive
metadata.

## Comparing outcomes

Run the deterministic cross-mode comparison:

```bash
npm run graph:compare
```

It executes original and graph scripts against independent but equivalent
simulated boundaries. It compares:

- normalized inputs before either mode executes;
- success values or exact error name/message;
- agent calls and responses, including complete prompts, labels, phases, roles,
  models, and schemas;
- parallel group boundaries and cardinality;
- child-workflow names, arguments, returns, and failures; and
- ordinary workflow logs after removing graph-only structural node progress.

Only exact RSA public-key material and signature chunks on complete
receipt-shaped objects generated independently by deterministic fixtures are
normalized. An ordinary result or response field merely named `signature`
remains semantic and is compared exactly. All receipt fields, prompts, results,
errors, and control structure remain exact.

The broader graph regression command runs the existing public workflow test
catalog directly against graph scripts:

```bash
npm run test:graph
```

That includes malformed pre-agent inputs, remediation, replanning, TDD red
scope, research terminal variants, forged receipts, shipping refusal, and model
forwarding. `npm run verify` runs original tests, graph tests, cross-mode parity,
generation drift checks, and strict plugin validation.

## Adding a workflow graph safely

1. Start from a named workflow contract and identify every effect, deterministic
   gate, terminal outcome, and bounded cycle.
2. Add a closed definition. Reuse registered operation semantics only when the
   input, output, capability, and freshness contract is genuinely identical.
3. Add a reviewed template with one immediately bound operation constant for
   every definition marker. The compiler generates the only runtime registry;
   never add dynamic evaluation or accept source text as behavior.
4. Regenerate artifacts and inspect both generated JavaScript and Mermaid.
5. Add invalid-graph unit tests, success/failure component tests, original-mode
   parity when an original exists, and live proof only when the route and effect
   boundary authorize it.
6. Update the workflow catalog, status ledger, README, and migration ledger in
   the same change.

Arbitrary user-supplied graphs and a visual editor remain out of scope. A future
construction UI must emit this same closed IR and pass the same validator; it
must not become a second source of execution semantics.
