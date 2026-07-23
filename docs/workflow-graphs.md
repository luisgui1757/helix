# Workflow graphs

This file is generated from the validated graph-mode definitions. Do not edit it directly; run `npm run graph:generate`. Original mode remains the default, and these diagrams describe only the secondary graph-mode scripts.

## Helix delivery

Competing plans, serialized implementation, complete evidence passes, remediation, and correctness-triggered replanning.

Definition digest: `c7133f7c73195b4a6e5f3f619ef054eab2bfed6bfc63c312510890834687b81c`. Derived absolute step ceiling: `71`.

```mermaid
flowchart TD
  n0[["Candidate plans<br/><small>read</small>"]]
  n1["Plan judge<br/><small>read</small>"]
  n2["Initial implementation<br/><small>write · mutates checkout</small>"]
  n3["Begin verification pass<br/><small>control</small>"]
  n4["Test<br/><small>write · mutates checkout</small>"]
  n5["Synchronize documentation<br/><small>write · mutates checkout</small>"]
  n6["Signed command evidence<br/><small>evidence</small>"]
  n7[["Correctness and red-team reviews<br/><small>read</small>"]]
  n8["Verification gate<br/><small>read</small>"]
  n9{"Deterministic pass decision<br/><small>control</small>"}
  n10[["Corrected candidate plans<br/><small>read</small>"]]
  n11["Corrected plan judge<br/><small>read</small>"]
  n12["Implement corrected plan<br/><small>write · mutates checkout</small>"]
  n13["Remediate verified findings<br/><small>write · mutates checkout</small>"]
  n14(["Approved<br/><small>control</small>"])
  n15(["Pass rail exhausted<br/><small>control</small>"])
  n0 --> n1
  n1 --> n2
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  n6 --> n7
  n7 --> n8
  n8 --> n9
  n9 -->|approved| n14
  n9 -->|exhausted| n15
  n9 -->|replan| n10
  n9 -->|remediate| n13
  n10 --> n11
  n11 --> n12
  n12 --> n3
  n13 --> n3
  classDef read fill:#e8f1ff,stroke:#4677b5,color:#10243e
  classDef write fill:#fff1d6,stroke:#b7791f,color:#3d2705
  classDef evidence fill:#e5f7ed,stroke:#2f855a,color:#123c2a
  classDef ship fill:#ffe5e5,stroke:#c53030,color:#4a1111
  classDef control fill:#eee9ff,stroke:#6b46c1,color:#26164e
  class n0,n1,n7,n8,n10,n11 read
  class n2,n4,n5,n12,n13 write
  class n6 evidence
  class n3,n9,n14,n15 control
```

Cycles:

- `verification-loop`: entry `verification-pass`, maximum 5 traversals.

## Helix implement-review

Settled implementation followed by bounded complete evidence and remediation passes.

Definition digest: `3d74d6dd974ee3f146be11c8e5a1cc8dae2040f6efa2b5ab37e57bd65941b852`. Derived absolute step ceiling: `51`.

```mermaid
flowchart TD
  n0["Initial implementation<br/><small>write · mutates checkout</small>"]
  n1["Begin verification pass<br/><small>control</small>"]
  n2["Test<br/><small>write · mutates checkout</small>"]
  n3["Synchronize documentation<br/><small>write · mutates checkout</small>"]
  n4["Signed command evidence<br/><small>evidence</small>"]
  n5[["Correctness and red-team reviews<br/><small>read</small>"]]
  n6["Verification gate<br/><small>read</small>"]
  n7{"Deterministic pass decision<br/><small>control</small>"}
  n8["Remediate verified findings<br/><small>write · mutates checkout</small>"]
  n9(["Approved<br/><small>control</small>"])
  n10(["Pass rail exhausted<br/><small>control</small>"])
  n0 --> n1
  n1 --> n2
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  n6 --> n7
  n7 -->|approved| n9
  n7 -->|exhausted| n10
  n7 -->|remediate| n8
  n8 --> n1
  classDef read fill:#e8f1ff,stroke:#4677b5,color:#10243e
  classDef write fill:#fff1d6,stroke:#b7791f,color:#3d2705
  classDef evidence fill:#e5f7ed,stroke:#2f855a,color:#123c2a
  classDef ship fill:#ffe5e5,stroke:#c53030,color:#4a1111
  classDef control fill:#eee9ff,stroke:#6b46c1,color:#26164e
  class n5,n6 read
  class n0,n2,n3,n8 write
  class n4 evidence
  class n1,n7,n9,n10 control
```

Cycles:

- `verification-loop`: entry `verification-pass`, maximum 5 traversals.

## Helix research

Bounded hypotheses and experiments with signed final measurement, tests, and deterministic convergence outcomes.

Definition digest: `7679fb90d36d7aca03ad87d2d759ee983b6bee2c5ac322941fe8259ac868841a`. Derived absolute step ceiling: `63`.

```mermaid
flowchart TD
  n0["Initialize research state<br/><small>control</small>"]
  n1["Begin research pass<br/><small>control</small>"]
  n2["Falsifiable hypothesis<br/><small>read</small>"]
  n3["Bounded experiment<br/><small>write · mutates checkout</small>"]
  n4["Preliminary signed measurement<br/><small>evidence</small>"]
  n5["Research ledger<br/><small>write · mutates checkout</small>"]
  n6["Final signed measurement<br/><small>evidence</small>"]
  n7["Final signed tests<br/><small>evidence</small>"]
  n8["Research review<br/><small>read</small>"]
  n9["Research verification gate<br/><small>read</small>"]
  n10{"Deterministic convergence decision<br/><small>control</small>"}
  n11(["Target or valuable dead-end<br/><small>control</small>"])
  n12(["Diminishing returns or iteration rail<br/><small>control</small>"])
  n0 --> n1
  n1 --> n2
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  n6 --> n7
  n7 --> n8
  n8 --> n9
  n9 --> n10
  n10 -->|approved| n11
  n10 -->|continue| n1
  n10 -->|stopped| n12
  classDef read fill:#e8f1ff,stroke:#4677b5,color:#10243e
  classDef write fill:#fff1d6,stroke:#b7791f,color:#3d2705
  classDef evidence fill:#e5f7ed,stroke:#2f855a,color:#123c2a
  classDef ship fill:#ffe5e5,stroke:#c53030,color:#4a1111
  classDef control fill:#eee9ff,stroke:#6b46c1,color:#26164e
  class n2,n8,n9 read
  class n3,n5 write
  class n4,n6,n7 evidence
  class n0,n1,n10,n11,n12 control
```

Cycles:

- `research-loop`: entry `research-pass`, maximum 5 traversals.

## Helix scout

Read-only reconnaissance followed by a decision-ready implementation brief.

Definition digest: `d37683594f6a5630e82bf97014b461bb78dd2c5fb79aaf89d3d4799bc3368200`. Derived absolute step ceiling: `2`.

```mermaid
flowchart TD
  n0["Repository reconnaissance<br/><small>read</small>"]
  n1(["Decision-ready brief<br/><small>read</small>"])
  n0 --> n1
  classDef read fill:#e8f1ff,stroke:#4677b5,color:#10243e
  classDef write fill:#fff1d6,stroke:#b7791f,color:#3d2705
  classDef evidence fill:#e5f7ed,stroke:#2f855a,color:#123c2a
  classDef ship fill:#ffe5e5,stroke:#c53030,color:#4a1111
  classDef control fill:#eee9ff,stroke:#6b46c1,color:#26164e
  class n0,n1 read
```

Cycles:

- None; this workflow is acyclic.

## Helix ship pre-PR

Exact intent and preflight, documentation, dual review, deterministic gate, then one bounded shipment effect.

Definition digest: `bbd9646875b553ca9fb876ad16e79d69c9432afcaaba5628c9e82b2c9bfb8989`. Derived absolute step ceiling: `8`.

```mermaid
flowchart TD
  n0["Shipping intent<br/><small>read</small>"]
  n1["Synchronize documentation<br/><small>write · mutates checkout</small>"]
  n2["Signed pre-PR preflight<br/><small>evidence</small>"]
  n3[["Correctness and red-team reviews<br/><small>read</small>"]]
  n4["Pre-PR verification gate<br/><small>read</small>"]
  n5{"Deterministic ship decision<br/><small>control</small>"}
  n6(["Commit, push, and open or reuse PR<br/><small>ship · mutates checkout</small>"])
  n7(["Shipment refused<br/><small>control</small>"])
  n0 --> n1
  n1 --> n2
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 -->|ship| n6
  n5 -->|refuse| n7
  classDef read fill:#e8f1ff,stroke:#4677b5,color:#10243e
  classDef write fill:#fff1d6,stroke:#b7791f,color:#3d2705
  classDef evidence fill:#e5f7ed,stroke:#2f855a,color:#123c2a
  classDef ship fill:#ffe5e5,stroke:#c53030,color:#4a1111
  classDef control fill:#eee9ff,stroke:#6b46c1,color:#26164e
  class n0,n3,n4 read
  class n1 write
  class n2 evidence
  class n6 ship
  class n5,n7 control
```

Cycles:

- None; this workflow is acyclic.

## Helix TDD fix

Signed baseline, bounded isolated red reproduction, smallest complete fix, and bounded complete evidence passes.

Definition digest: `fefc1fd564bd435b7d3654a2c05c3880fc341184cbf7153b7d52a5422d9af285`. Derived absolute step ceiling: `62`.

```mermaid
flowchart TD
  n0["Signed TDD baseline<br/><small>evidence</small>"]
  n1["Begin red reproduction pass<br/><small>control</small>"]
  n2["Isolated signed red reproduction<br/><small>evidence · mutates checkout</small>"]
  n3{"Red reproduction decision<br/><small>control</small>"}
  n4["Smallest complete fix<br/><small>write · mutates checkout</small>"]
  n5["Begin fix verification pass<br/><small>control</small>"]
  n6["Focused tests<br/><small>write · mutates checkout</small>"]
  n7["Synchronize documentation<br/><small>write · mutates checkout</small>"]
  n8["Signed final command evidence<br/><small>evidence</small>"]
  n9["Root-cause review<br/><small>read</small>"]
  n10["TDD verification gate<br/><small>read</small>"]
  n11{"Deterministic fix decision<br/><small>control</small>"}
  n12["Remediate verified findings<br/><small>write · mutates checkout</small>"]
  n13(["Approved<br/><small>control</small>"])
  n14(["Red reproduction exhausted<br/><small>control</small>"])
  n15(["Fix passes exhausted<br/><small>control</small>"])
  n0 --> n1
  n1 --> n2
  n2 --> n3
  n3 -->|red| n4
  n3 -->|retry| n1
  n3 -->|exhausted| n14
  n4 --> n5
  n5 --> n6
  n6 --> n7
  n7 --> n8
  n8 --> n9
  n9 --> n10
  n10 --> n11
  n11 -->|approved| n13
  n11 -->|remediate| n12
  n11 -->|exhausted| n15
  n12 --> n5
  classDef read fill:#e8f1ff,stroke:#4677b5,color:#10243e
  classDef write fill:#fff1d6,stroke:#b7791f,color:#3d2705
  classDef evidence fill:#e5f7ed,stroke:#2f855a,color:#123c2a
  classDef ship fill:#ffe5e5,stroke:#c53030,color:#4a1111
  classDef control fill:#eee9ff,stroke:#6b46c1,color:#26164e
  class n9,n10 read
  class n4,n6,n7,n12 write
  class n0,n2,n8 evidence
  class n1,n3,n5,n11,n13,n14,n15 control
```

Cycles:

- `reproduction-loop`: entry `reproduction-pass`, maximum 2 traversals.
- `verification-loop`: entry `verification-pass`, maximum 5 traversals.
