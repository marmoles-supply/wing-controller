# WING CONTROLLER

An independent macOS workstation for controlling and automating **Behringer WING**
mixing consoles. Macros, triggers, meters, cues and timecode tools share one desktop
interface, with a Rust backend handling console communications.

**Apple Silicon Macs only for this desktop line.** This community source preview
is published so others can study, improve and contribute to it.

> **Unofficial software, used at your own risk.** This is not a Behringer or Music
> Tribe product. Neither company approves, certifies, supports or endorses it.
> It is supplied without warranties; you are responsible for validating your
> system, operating it and maintaining backups and a recovery plan. Read the
> [full disclaimer](DISCLAIMER.md) before use, especially in a live show.

## What it does

- Build macros with console-state, meter and external triggers, conditions and
  timed action steps.
- Monitor meters and connection/dispatch state in the workstation and Meter Bridge.
- Work with MIDI/OSC between applications and LTC/MTC timecode/cues.
- Save and restore station configuration and macro libraries.

The maintainer reports stable live-show use. That experience is not independent
certification or a guarantee for another setup. Validate your hardware, firmware,
network, integrations and features; see [known limitations](docs/KNOWN_LIMITATIONS.md).

## Compatibility and availability

| Item | Status |
| --- | --- |
| Desktop hardware | Apple Silicon / arm64 (M-series Macs) |
| Verified source-check environment | macOS 26.6.2 on arm64 |
| Older macOS | Prior package metadata declares 11.0; a supported runtime range is unmeasured |
| Intel Macs, Windows, Linux | No supported installer or verified desktop support |
| Consoles | WING-family protocols; feature/model/firmware dependent, not certified for every console |
| Android/iOS | Original Expo source retained; mobile development is parked |
| Installer for this snapshot | **Not published. This repository currently distributes source code.** |

A public repository does not install an app on a computer. Developers can compile
this source. A ready-to-install application needs a separately verified package
in [GitHub Releases](https://github.com/marmoles-supply/wing-controller/releases).
Historical local packages are not binaries of this newer source.
See [installation and permissions](docs/INSTALLATION.md).

## Start here

- **Operator:** [installation](docs/INSTALLATION.md), [first connection](docs/guide/01-start-here.md),
  [operator guide](docs/guide/README.md), [limitations](docs/KNOWN_LIMITATIONS.md).
- **Contributor:** [development below](#development), [contribution guide](CONTRIBUTING.md),
  [issues](https://github.com/marmoles-supply/wing-controller/issues) and pull requests.
- **Security:** [private reporting](SECURITY.md). Never post credentials, private
  console details or customer/show data in an issue.

## Development

Use an Apple Silicon Mac with Xcode Command Line Tools, Node.js **20.19 or later**
with npm, Rust/Cargo and Poppler (`pdftotext`). Chrome is needed for the complete
verification gate. Initial checks use Rust 1.98.1 and Node 26.8.2; this does not
establish that every earlier combination works.

```sh
git clone https://github.com/marmoles-supply/wing-controller.git
cd wing-controller
npm ci
node scripts/setup-protocol-reference.mjs
./scripts/verify-all.sh --quick
cargo run --locked -p wing-controller-desktop
```

Protocol setup downloads and verifies Maillot's pinned manual locally, then
extracts an ignored reference file. The complete manual is not redistributed.
See [reference acquisition/checksums](docs/PROTOCOL_REFERENCE.md).

`cargo run` compiles and launches a development app, not a release installer.
Node generates the UI vault during Cargo compilation. No maintainer signing key,
activation key, customer data or generated Android directory is needed to verify
this source checkout.

## Verification

See the [dated verification record](docs/VALIDATION.md) for measured results,
environment, dependency-cache use and what was not established.

```sh
./scripts/verify-all.sh --quick   # Everyday checks; omits named browser suites
./scripts/verify-all.sh           # Complete source gate, including browser suites
```

Quick mode also runs the design screenshot check when Chrome is available.
Run only one gate/browser suite at a time. Scripts manage their Chrome instances;
do not drive the shared test browser concurrently. Pixel baselines depend on the
rendering environment: review differences rather than accepting them blindly.

Ordinary checks are console-free. Hardware tests need explicit `LIVE_WING_*`
opt-ins; inspect them before enabling anything against a console. A source gate
does not certify a live show, packaged app or installed system. Historical
provenance preserves 85 build records; 15 archival notes lack surviving build
evidence and are explicitly labelled unverified.

## Source layout

| Path | Purpose |
| --- | --- |
| `desktop/src-tauri/` | Tauri app and native integrations |
| `desktop/ui/` | Workstation, meters, timecode, cue editor and guide |
| `crates/` | Protocol, runtime, transport and probe crates |
| `design/` | Tokens, components, reviewed renders and conformance tools |
| `scripts/` | Verification, reference setup, generation and release tools |
| `docs/guide/` | Operator guide sources |
| `src/`, `native/`, `plugins/` | Parked mobile source/integrations |

This repository starts a new public history. Private backups, operator exports,
machine diagnostics, credentials and downloaded manuals are excluded.
`SOURCE_MANIFEST.json` records the source revision and exported hashes.

## Licence

© 2026 **MÁRMOLES SUPPLY CO.** and contributors.
The [WING CONTROLLER Source-Available Licence 1.0](LICENSE) permits using, studying,
modifying and sharing original software, including use in paid professional work.
**Selling copies or derivatives is prohibited.** Redistributions must include
corresponding source under the same licence.

These are **source-available terms, not GPL or OSI open source**. They do not
convert to a permissive licence later. Third-party components retain their terms;
see [third-party notices](THIRD_PARTY.md). No third-party trademark rights or
endorsement are granted. Read the [disclaimer](DISCLAIMER.md) alongside the licence.
