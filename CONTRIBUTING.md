# Contributing

This project welcomes focused improvements, bug reports and pull requests.
It uses a bespoke source-available licence. The terms allow paid
professional use, prohibit selling copies or derivatives, and require source
redistribution under the same terms. Contributions use that same [licence](LICENSE);
no copyright assignment is requested.

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
