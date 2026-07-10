# Security Policy

`prime-reloaded` is a private release candidate. Keep it private until an
independent pre-publication audit verifies the complete Git object/ref graph,
tracked content, pull-request metadata, repository settings, commit identity,
and secret scan. The original `prime` repository is a private archive and must
never be made public; deleting ordinary branches does not remove persistent PR
refs or historical objects from that repository network.

Do not commit credentials, tokens, session/share links, private prompts, raw
agent transcripts, provenance footers, personal email addresses, private home
paths, or machine-local configuration. Before public release, the maintainer
must separately confirm that every previously exposed session has been revoked
and choose an explicit project license. Neither condition can be inferred from
a clean snapshot.

Prime's durable records are structural. Field-specific grammars reject URI- or
path-shaped model, provider, effect-code, and reference values at their input
boundaries. All structural persistence goes through the shared root-confined
writer, which verifies canonical containment, refuses symlinked parents and
targets, creates temporary files exclusively with no-follow semantics, and
verifies the atomic installation. Private crash-checkpoint directories use the
same confined reservation and verified installation boundary. New writers must
use that boundary rather than direct filesystem writes.

Use environment variables or approved local secret stores for provider keys.
CI must remain no-live and must not reference provider credentials. Raw review
artifacts belong only in a separate private archive unless they have been
explicitly sanitized for this release tree.

Report suspected vulnerabilities privately through GitHub's private
vulnerability-reporting/security-advisory flow when it is available for this
repository, or through another private channel provided by the maintainer. Do
not open a public issue for suspected secrets or vulnerabilities.
