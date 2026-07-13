# Security policy

Report vulnerabilities privately through GitHub's security-advisory flow for
this repository. Do not include credentials, private source, prompts, responses,
or session links in a public issue.

Helix keeps package resources immutable, stores mutable state under Pi's agent
directory, validates external input at command boundaries, and persists only
structural public-safe run metadata. Mutating operations require an attended
confirmation except for reversible feature toggles. Real-provider casts refuse
until a verified live transport is present; Helix does not silently fall back to
a mock or make an unapproved paid call.

Supported security fixes target the latest release. Reports should include the
affected version, impact, and a minimal reproduction that contains no private
data.
