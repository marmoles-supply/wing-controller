# Desktop 0.3.2 package validation

Date: 18 November 2026. Build: 20261118.1, macOS Apple Silicon.

Status: local source and package checks complete. The matching GitHub Actions
check must pass before main is advanced and the release is published. The release
page links the accepted hosted run; this report does not pre-claim that result.

## Source and tests

- The full local source gate passed **87 checks**, including all **35 named
  browser suites**, strict Maillot path validation and the locked Rust workspace.
- Rust executed **564 passing tests**; **15 ignored tests** remain explicitly
  separate from that total. Physical console/interface acceptance is not inferred.
- New release-tool contracts compile real Rust fixtures through logical and
  physical paths, including spaces and URL characters. A deliberate removal of
  the physical remapping failed the intended assertion. The gate bootstrap tests
  exercise encoded file URLs and retain refused preparation/restart failures.
- Application source was frozen before compilation. Subsequent publication
  edits affect documentation and generated export/provenance metadata only.

## Packages and installation

- Built with Node 26.8.2, Rust 1.98.1, Tauri CLI 2.11.5 and macOS 26.6.2 on
  arm64. The build reused local dependencies/caches; it is not a cold dependency
  installation measurement. The hosted source check is a separate environment.
- Built, ZIP, DMG and installed executables are **arm64**, retain the custom icon
  and share the stable signing certificate and certificate-pinned designated
  requirement. The certificate subject/issuer contain only the project signing
  name. This is **self-signing, not Apple Developer ID or notarisation**.
- `verify-install.sh 0.3.2 --install` completed with **ALL CHECKS PASSED**. It
  checked signatures, legal/source notices, recovery-helper failure paths, icon
  rendering, installed version, single-instance behaviour and detached images.
- Manual native smoke observed 0.3.2, Offline, the retained macro library,
  responsive Properties and the 13-chapter guide, including the new IF timing
  section. Persisted library, draft and cue files remained byte-identical; only
  the local show-operation log changed. No console actions were fired.

## Privacy review

The separate public export omits engineering history, backups, packet captures,
operator investigations and show-specific rehearsal material. Its source manifest
records every selected file hash. Scanner findings and newly changed content were
reviewed; pattern scanning alone cannot certify arbitrary data.

The built executable contains no home or named-volume path prefixes and no known
private console identifier. ZIP member contents and AppleDouble metadata were
also checked for known private machine/operator fragments. The source archive
records root/root ownership. Original third-party archives are verified against
Cargo.lock, and retain their own notices and terms. Signing keys and app state
are not release assets.

## Checked artefacts

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `WING_CONTROLLER_v0.3.2_AppleSilicon.dmg` | 11,438,249 | `24641da9a954ffb596415a8ca3c5ce29d9b29827bc49092ef0a89f685c8a3174` |
| `WING_CONTROLLER_v0.3.2_AppleSilicon.zip` | 11,006,385 | `e5d91bcb7f726fc8d3533640e488459411eb796375e58e4eed327836a9b40f85` |
| `THIRD_PARTY_SOURCES_v0.3.2.tar.gz` | 22,653,889 | `565ee611624e32d74667587ddbabbed0a536ecf0392206662ac8c43bca4c3d5f` |

`SHA256SUMS.txt` lists all three. Published downloads are checked against these
same hashes before the release is announced.

## Limits and follow-ups

During manual automation, a subsequent launch presented an empty native
frame without an accessibility document. Native and WebContent samples were idle;
system logs recorded a completed main-frame load. The same process subsequently
showed the complete UI without changing the binary or resetting stored app data. The cause was
not established, so neither an application freeze nor a platform defect is
claimed. Packaged foreground/background and close/reopen readiness checks remain
a [TEST-02 follow-up](ROADMAP.md); process count alone is not UI readiness.

The short in-app help summary still has the known DOC-01 copy issue; the complete
guide contains 13 chapters. First-download Gatekeeper approval on another Mac,
wider macOS compatibility, independent LTC/interface signals, physical console
behaviour and long show endurance are not established by this release check.
Use the [installation guide](INSTALLATION.md), [disclaimer](../DISCLAIMER.md) and
[community testing guide](COMMUNITY_TESTING.md).
