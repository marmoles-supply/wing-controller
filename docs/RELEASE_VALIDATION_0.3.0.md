# Desktop 0.3.0 release validation — 9 November 2026

Version **0.3.0**, build **20261109.2**, Apple Silicon community beta.
Measured on macOS 26.6.2 / arm64, Rust 1.98.1, Node 26.8.2, npm 11.19.1 and
Tauri CLI 2.11.4. This is an evidence record, not show certification.

## Source and package checks

- The full source gate completed **82 checks**, including all 34 named browser
  suites, strict Maillot path audit and Rust workspace tests.
- The full gate measured source commit `333f71d36c9833bc5e1274edb16d3a8068bb14ff`.
  Later changes were documentation and packaging checks: neutral outer-tar owner
  metadata and correction of the verifier's assumed ZIP directory prefix. Those
  were checked against the actual artefacts. Application/runtime source did not
  change after the gate.
- The release was built from the separate reviewed public checkout and installed
  locally. `verify-install.sh 0.3.0` finished **ALL CHECKS PASSED** after correcting
  that ZIP-check assumption; the package files themselves did not need replacement.
- Built, ZIP, DMG and installed executables are **arm64**, use the same stable
  `WING CONTROLLER Local Signing` certificate and designated requirement, and
  retain the icon artwork. Certificate subject/issuer contain only that public
  name. This is self-signing, **not Apple Developer ID or notarisation**.
- DMG/ZIP checksums verify; the DMG is detached after checking. Both formats and
  the application include legal/source information. **292** dependency entries,
  **535** preserved notices and all **five** MPL-covered crate sources passed
  hash checks. The separate source asset contains all 292 original crate archives
  checked against Cargo.lock; its outer tar records root/root, not the builder.
- Negative checks refuse a wrong legal-manifest version and a modified notice.
  Recovery-helper sandbox checks cover mismatched/unsigned executables, failed
  quarantine removal and a refused launch request. A launch request is not
  reported as proof that the app is running.
- Manual installed-app smoke confirmed v0.3.0, responsive workstation/Properties,
  the complete 13-chapter guide and Meter Bridge, while disconnected. It did not
  test audio capture, an active console or a show.

## Downloaded artefacts

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `WING_CONTROLLER_v0.3.0_AppleSilicon.dmg` | 11,422,619 | `ef31118766c4430cb4e763b8d6909285da4b5241e5919e5608da5a11b242ed73` |
| `WING_CONTROLLER_v0.3.0_AppleSilicon.zip` | 10,985,822 | `30c31b694469a8f219f40b2270fe2d6629204bed08aeadf44202309099395d7d` |
| `THIRD_PARTY_SOURCES_v0.3.0.tar.gz` | 22,654,007 | `c6fbc46be79e327f7392d8e2ef2bd969cb260cfdb08e0d9dc56b7b6ca86a1743` |

`SHA256SUMS.txt` lists all three. These hashes identify the checked packages;
GitHub's separately generated source-code downloads are different files.

## Limits and open work

The source checks reused known npm dependencies and Cargo caches; a fresh
installation of development dependencies on another machine was not measured.
Regenerable debug compilation cache was removed before the release build for
disk capacity. Source, prior releases, backups and private history were retained.

The local installer check removes quarantine. It does not establish first
download/approval on another Mac, older macOS compatibility, microphone permission
transitions, independent LTC/MTC, real WING behaviour, four-hour endurance or
power-loss recovery. **The owner has not tested LTC.** These remain explicit
[roadmap tasks](ROADMAP.md); the [audit](AUDIT_2026-11-09.md) distinguishes
implemented repairs from acceptance not yet measured.

Manual smoke also found stale help-summary copy: Properties still says eleven
chapters/three windows although the actual guide has 13 chapters and describes
five windows. DOC-01 records that correction for a subsequent application build.
This release retains that visible copy defect; the full guide opens correctly.
