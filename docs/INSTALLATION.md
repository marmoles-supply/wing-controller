# Installation, first launch and permissions

## Download the application

Open the [v0.3.0 community beta release](https://github.com/marmoles-supply/wing-controller/releases/tag/v0.3.0)
and expand **Assets**. Download **WING_CONTROLLER_v0.3.0_AppleSilicon.dmg** and
**SHA256SUMS.txt**. The `AppleSilicon.zip` is an alternative application archive;
GitHub's separate **Source code** downloads and **Code → Download ZIP** contain
developer source, not the application. No developer tools are needed to install
the DMG. The [development instructions](../README.md#development) are for contributors.

The desktop line targets **Apple Silicon (arm64/M-series) Macs**. There is no
supported Intel, Windows or Linux package. macOS 26.6.2 on arm64 is the environment
used for initial public source checks. Older package metadata saying 11.0 does
not establish a tested compatibility range.

## Verify and install

Only use assets in this project's
[GitHub Releases](https://github.com/marmoles-supply/wing-controller/releases).
Read its notes, supported macOS versions, limitations and checksums. Do not assume
an old binary contains newer source changes.

1. Download the Apple Silicon DMG and `SHA256SUMS.txt` from the same release.
2. In Terminal, change to the download folder and run:

   ```sh
   shasum -a 256 "WING_CONTROLLER_v0.3.0_AppleSilicon.dmg"
   ```

   Compare the **complete hash** with the DMG's entry in `SHA256SUMS.txt`.
   The checksum file also lists optional assets you may not have downloaded.
3. Open the DMG and copy **WING CONTROLLER.app** to **Applications**.
4. Eject the image and launch the installed copy. Do not run from the disk image.
5. Follow permission prompts for the features you actually use.

The release uses a stable **self-signed** certificate, not Apple Developer ID,
and is **not notarised by Apple**. macOS may block first launch. Check the origin
and checksum; if you choose to proceed, attempt to launch the installed app,
then open **System Settings → Privacy & Security → Open Anyway**, and confirm
the app-specific exception. Follow [Apple's guidance](https://support.apple.com/en-gb/102445).
Do not disable Gatekeeper globally or override a malware-detected warning.

The optional **Unblock WING CONTROLLER.command** verifies the matching app's
identity, version, executable signature and hash before clearing quarantine and
restoring its icon. It is for the trusted release it accompanies, and may itself
require macOS approval. The normal app-specific System Settings path comes first.

Local release verification clears quarantine. It does not establish the exact
first-download experience on another Mac; that remains a public acceptance task.

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

**LTC remains untested with real hardware by the owner.** Generated software
checks do not validate an audio interface, microphone workflow or independent
LTC/MTC interoperability. See the [audit](AUDIT_2026-11-09.md) and
[roadmap](ROADMAP.md) before relying on these features.

## Packaging your own build

Packaging needs Tauri CLI 2 and a stable certificate generated on **your own** Mac
using `./scripts/create-signing-identity.sh`. Never request or share a maintainer's
private signing key. Follow `desktop/build-dist.sh` and `scripts/release.sh` only
when deliberately preparing a new version; they do not install prerequisites.
Run the full source gate and release verification, and include the licence,
disclaimer and required dependency notices/source information. Source-check
success alone is not binary-release verification.
