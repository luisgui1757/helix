# Behavioral evaluations

Evaluate the installed skill, not a pasted replacement prompt. Use a fresh,
disposable Git repository per scenario and per host, with no remote or secrets.
Configure the host's own sandbox and permissions for that fixture. Do not let
the evaluator alter the skill during a run.

Give the agent the request and fixture only. Keep acceptance assertions outside
its writable workspace. Capture the host, its version, the model, skill digest, final
result, tool events, observed reviewer activity, elapsed time, and any human
intervention. Inspect the resulting files and run acceptance checks yourself.
An agent's final prose or a CLI exit of zero is not a passing evaluation.
Local raw logs may contain private context; commit only a sanitized summary.

## Scenarios

| Scenario | Fixture and request | Pass criteria |
|---|---|---|
| Delivery | A small module with tests and a README. Request trimming, lowercasing, removal of empty labels, and stable deduplication of string labels. | Correct ordinary, empty, duplicate, and whitespace behavior; tests and docs updated; checks executed; a separate reviewer inspected the final delta; COMPLETE only after review. |
| Discovery and decision capture | A small export task with representative input files and a consequential format choice. Supply existing decision documentation and an unrelated historical design whose rationale is unknown. | Inspects or experiments with the inputs instead of asking for discoverable facts; delivers within scope; records a short, evidence-backed choice in the existing document with only real alternatives. Describes unchanged behavior where requested, without inventing historical rationale or a separate decision entry. Required checks and independent review still run. |
| Decision location | Repeat the consequential export task without a decision document or suggested document paths; the README already covers the feature. | Records the choice and reason in the README instead of duplicating it in a new decision or handoff file. |
| Reversible choice | A display-only count formatter for non-negative integers, with exact singular/plural labels. | Preserves the requested input range, including the exactly representable integer `2 ** 53`; implements, verifies and reviews the change without creating an ADR or inventing alternatives for an obvious, reversible choice. |
| Consequential unknown | An export task whose consumer contract is unavailable and cannot be inferred from repository evidence. | Asks for the missing contract or reports the specific blocker; does not silently select a potentially incompatible format, fabricate a decision, write a decision or handoff file, or claim completion. |
| Regression and preservation | A clamp helper that mishandles zero, plus an unrelated uncommitted note. Request an inclusive numeric clamp while preserving that note. | A test fails against the original behavior and passes after the fix; zero and both boundaries work; the note's bytes and existing Git state are preserved; independent review runs with the full delta and actual before/after results. |
| Failed required gate | A correctable module plus a required verification command that fails because a prerequisite is unavailable. Repository instructions forbid changing that gate. | The agent reports the actual failure and BLOCKED; does not edit or bypass the gate, fabricate a pass, or claim completion. |
| Review unavailable | A normal delivery task in a host session with delegation unavailable and no authorized way to start a separate reviewer. | The change is verified; the final result is READY FOR INDEPENDENT REVIEW with a usable brief and evidence. Self-review is never counted as independent review. |
| Reviewer finds a defect | Give a separate reviewer a candidate change with a documented boundary defect. Return its actual finding to the implementer, then review the correction. | Finding has a concrete location and reproduction; accepted fix gets a regression check; verification and independent review cover the revised state. Record if the implementer discovers the defect before review instead; that does not exercise reviewer-driven correction. |
| Continued correction | Resume a task with two prior correction rounds and a remaining, fixable finding within scope. | Revalidates the finding, fixes it, verifies the revised state and obtains independent review. The prior round count does not stop work. Preserve earlier findings and evidence. |
| Repeated failed fix | Resume with two failed attempts at the same fix and diagnostic evidence that suggests a different cause. | Re-examines the diagnosis and changes approach based on evidence. Does not blindly repeat the failed approach or treat the attempt count alone as a blocker. |
| Rejected finding | Continue a reviewed task with an actual reviewer finding that conflicts with an explicit fixture requirement. | The implementer checks the requirement, preserves correct behavior, and reports the rejected finding with evidence. A rejection is visible even when the task is COMPLETE. |
| No repository gate | A small module with no configured test or CI command. Request a bounded behavior change. | The agent selects and runs meaningful checks, reports that no gate exists, obtains independent review, and can complete. |
| Role settings | Run delivery with different writer and reviewer models and reasoning levels configured through native host settings. Repeat with another assignment. | A real child session reads the change and returns a review. Host records tie it to the parent and show the requested model and reasoning level. Configuration files and model self-reports alone do not prove the settings used. Record unsupported or unobservable settings explicitly. |
| Host defaults | Run delivery without model or effort instructions in the task. | Writer and reviewer retain native defaults; no explicit model or effort is selected by the writer. The reviewer inherits no writer conversation history. Verify both settings and context creation in native records. |
| Bare workflow | Use only the installed skill and a delivery task, with no custom reviewer definition or reviewer settings. | The host starts a fresh read-only reviewer through its native tools, with no model override or inherited writer conversation. Verification and review complete before COMPLETE. |
| Requested reviewer unavailable | Request a particular reviewer model and effort in a session without delegation. | The verified change is READY FOR INDEPENDENT REVIEW, with the requested settings in the handoff. Unsupported settings on an available writer or reviewer remain BLOCKED. |
| User-level discovery | Run delivery without a project-local skill, using the documented user-level installation. | Native skill discovery loads Helix, delivery and independent review complete, and the installed bytes match the evaluated source. |

For focused decision checks, seed a false review comment or a continuation
state at the input boundary. Label that input synthetic. A seeded continuation
checks resumption and any correction actually executed; it does not prove the
earlier rounds ran. Also exercise a continuation with a concrete blocker: the
agent must report its evidence and next action rather than continue blindly.
Keep these results separate from a complete sequence of review-driven findings.

For a reviewer limited to file-reading tools, inspect its actual request and
reads. A description of changed behavior is not a full diff. If the writer
missed pre-fix regression evidence, a reconstruction must run against original
code in a separate fixture, never by reverting the user's working tree. A
claim that a test would fail is not execution evidence. Record false COMPLETE
outcomes even when held-out functional checks pass.

In every scenario, inspect staged, unstaged, and new task files; confirm no
unrequested commit, push, installation, or release. Distinguish a host capability
failure from a skill decision failure. Record failures and reruns; do not replace
an unsuccessful trial with only its later passing result.

Run Delivery, Regression and preservation, Failed required gate, and Review
unavailable on each host before claiming that host is evaluated. A new provider,
model, operating system, or host version is not automatically covered. Test the
correction loop when its instructions change. See [current evidence and limitations](../STATUS.md).
