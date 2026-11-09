# Installation, first launch and permissions

## What you can install today

This source snapshot has **no published, verified installer**. GitHub's **Code →
Download ZIP** downloads source code, not a ready-to-run macOS application.
Use the [development instructions](../README.md#development) if you are comfortable
installing developer tools and compiling the project.

The desktop line targets **Apple Silicon (arm64/M-series) Macs**. There is no
supported Intel, Windows or Linux package. macOS 26.6.2 on arm64 is the environment
used for initial public source checks. Older package metadata saying 11.0 does
not establish a tested compatibility range.

## Installing a packaged release when one is available

Only use assets in this project's
[GitHub Releases](https://github.com/marmoles-supply/wing-controller/releases).
Read its notes, supported macOS versions, limitations and checksums. Do not assume
an old binary contains newer source changes.

1. Download the Apple Silicon DMG and `SHA256SUMS.txt` from the same release.
2. Verify the DMG checksum against the published value before opening it.
3. Open the DMG and copy **WING CONTROLLER.app** to **Applications**.
4. Eject the image and launch the installed copy. Do not run from the disk image.
5. Follow permission prompts for the features you actually use.

A local signing certificate does not mean Apple notarisation. macOS may block a
downloaded app. Check its origin and checksum first; follow release-specific
instructions only if you trust that package. Do not disable Gatekeeper globally.
A helper, if shipped, is intended for its matching app/version, not as a blanket
security workaround.

## Permissions and first connection

- **Microphone:** needed for LTC audio input. Denial prevents capture. A signing
  identity change may require a new grant; unrelated developer builds do not
  necessarily inherit it.
- **Files/folders:** choose intended show/backup locations and preserve independent
  copies before restoring or replacing a station.
- **Network:** the Mac must reach the console. OSC uses UDP 2223; discovery uses
  UDP 2222; native-meter requests use TCP 2222 with UDP reports. Network/privacy
  controls vary by macOS version.

Before connecting to an active show, read the [disclaimer](../DISCLAIMER.md),
[first-connection guide](guide/01-start-here.md) and
[troubleshooting](guide/09-troubleshooting.md). Verify targets, routing, values
and recovery on your hardware. Keep independent console/show backups and a way
to operate manually.

## Packaging your own build

Packaging needs Tauri CLI 2 and a stable certificate generated on **your own** Mac
using `./scripts/create-signing-identity.sh`. Never request or share a maintainer's
private signing key. Follow `desktop/build-dist.sh` and `scripts/release.sh` only
when deliberately preparing a new version; they do not install prerequisites.
Run the full source gate and release verification, and include the licence,
disclaimer and required dependency notices/source information. Source-check
success alone is not binary-release verification.
