# Public-source verification history — 9 November 2026

The subsequent [Desktop 0.3.0 package validation](RELEASE_VALIDATION_0.3.0.md)
records the first binary release, installation checks and actual artefact hashes.

For the subsequent test-quality audit and hosted CI measurements, see
[tests and CI](TESTING.md) and the [test audit](TEST_AUDIT_2026-11-09.md).
The evidence below describes the initial source-publication pass.

## Measured source checks

The standalone source checkout completed **82 checks** in the full
`./scripts/verify-all.sh` gate, including all 34 named Chrome browser suites,
the strict Maillot path audit and Rust workspace tests. It had its own Git
repository, no generated Android directory and no private signing credentials.
The protocol reference was downloaded from the pinned public source and extracted
locally; both hashes matched. The manual is ignored and is not redistributed.

After that pass, two test guards were made generic to remove an identifying
fragment, and generated Tauri schemas were added to ignore rules. The affected
fallback-catalogue and meter-bank-selector browser suites were rerun successfully;
release provenance was also rechecked against the final new root history. Those
last hygiene edits did not change application behaviour. Final documentation
links and exported-file hashes were checked separately.

## Environment and reproducibility limits

Measured on an arm64 Mac running macOS **26.6.2**, Rust **1.98.1**, Node.js
**26.8.2**, npm **11.19.1** and Chrome **156.0.8078.81**. These are tested versions,
not a certified compatibility range.

To avoid duplicating several gigabytes on a nearly full disk, the source checkout
used an APFS copy-on-write clone of the existing npm installation. Its lockfile
was byte-identical and `npm ls --depth=0` reported all 39 direct dependencies with
no problems. Cargo reused compiled dependency caches. A fresh network `npm ci`
on another machine was **not** measured; contributors should follow the normal
installation instructions and report reproducible environment failures. Subsequent
hosted runs did measure a fresh `npm ci` on another Mac; their complete gate
outcomes and environments are recorded in the linked test audit.

## Privacy and provenance

The selected source tree, its new public history and its hash manifest were
reviewed separately from the private engineering repository. Gitleaks 8.30.1
reported no detected secrets in the reviewed public history. Private snapshots,
operator exports, downloaded manuals, issued licences, build output and dependency
directories are excluded. A pattern scan cannot prove the absence of every
possible secret format, hidden image data or future accidental disclosure.

Historical release records retain 85 builds tied to version metadata; 15 imported
notes lack surviving build evidence and remain explicitly unverified. Their
presence is not a claim that those builds were validated.

## What this does not establish

The initial source-publication pass built or installed no release package.
The subsequent v0.3.0 binary release is verified separately; see its release
notes and package validation report. Hardware opt-ins, installed
native permission workflows, independent LTC/MTC interoperability and multi-hour
show acceptance are outside this source-check pass. See
[known limitations](KNOWN_LIMITATIONS.md) and the [disclaimer](../DISCLAIMER.md).
