# Contributing

This project welcomes focused improvements, bug reports and pull requests.
It uses a bespoke source-available licence. The terms allow paid
professional use, prohibit selling copies or derivatives, and require source
redistribution under the same terms. Contributions use that same [licence](LICENSE);
no copyright assignment is requested.

Start with the [roadmap](docs/ROADMAP.md), [dated audit](docs/AUDIT_2026-11-09.md)
and [architecture/protocol guide](docs/ARCHITECTURE.md). Hardware validation,
reproducible bug reports, documentation and accessibility work are useful
contributions as well as code.

## Issue → branch → checks → pull request

1. Search existing issues. For a roadmap task, put its ID in the issue title;
   describe the scope, expected behaviour and acceptance evidence. Use private
   reporting for suspected security vulnerabilities, following [SECURITY](SECURITY.md).
2. Fork the repository and create a focused branch from current `main`.
   Use synthetic data and an isolated test setup. Check your Git author and
   committer identity/email before the first push; prefer GitHub's noreply address.
3. Implement one coherent change. Add a regression that demonstrates the defect
   or a repeatable acceptance procedure when a test needs physical equipment.
   Preserve the current data contract and recoverability during storage changes.
4. Run the relevant checks and everyday quick gate; run the full gate for UI,
   runtime or release-impacting work. Run only one gate/browser suite at a time.
   Never turn a missing browser/hardware test into a claimed pass.
5. Open a PR against `main`, link the issue and explain before/after behaviour,
   evidence, checks and remaining limits. The maintainer reviews scope, safety,
   protocol authority, licence/provenance and acceptance results before merging.

Do not bump versions, create release tags or publish packages in a contribution.
Release signing and publication are maintainer-owned. A merged source repair
does not close its separate hardware acceptance task. Update the roadmap only
when its stated closure evidence exists.

Submit small, focused changes. Explain the problem, resulting behaviour, checks
performed and remaining limitations. State whether evidence was measured,
documented or inferred. Only contribute material you have the right to license;
identify third-party code and assets and preserve their notices.

Use Maillot's protocol definitions as the primary authority. Cite the relevant
path, token or section beside protocol changes. Check selected processing models
before assuming a parameter exists; distinguish a sent write from a confirmed
value. Do not test writes against a live show.

Keep private material out of commits and reports: credentials, environment
files, issued licences, customer/show data, console identities, private network
addresses, raw captures, screenshots containing operator information and signing
keys. Use synthetic examples. Run a maintained secret scanner against the exact
staged tree and all public commits before a
push. A successful pattern scan alone is not a publication clearance.

Use `npm ci` and the verification commands described in README. Record checks
that could not run rather than treating them as passing. Do not change version
metadata or package a release as a side effect of a contribution.
