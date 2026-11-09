# Known limitations and verification boundaries

This is a community source preview. Publishing source and passing automated
checks do not certify a particular show or every firmware/device combination.
The maintainer's reported stable live use is experience, not a guarantee.

- Desktop targets Apple Silicon macOS. No Intel, Windows or Linux installer is
  provided. Initial checks use macOS 26.6.2; a wider runtime range is unverified.
  Mobile development is parked.
- This source contains unreleased repairs. Historical binaries must not be
  labelled as binaries of this snapshot; no installer accompanies it yet.
- Hardware acceptance remains open for arbitrary WING model/firmware combinations,
  physical LTC audio, an independent MTC receiver and multi-hour show endurance.
  Synthetic tests do not replace these measurements.
- Native permission prompts, file/colour panels and device recovery need
  installed-app validation. Browser fixtures do not establish those interactions.
- Persistence compensation does not guarantee crash/power-loss atomicity.
  Preserve independent backups and test restoration away from a live show.
- Named audio-device recovery may substitute a default input and report it.
  Do not assume reconnect always restores the same physical source/channel.
- Some matrix keyboard navigation and dense timecode editing need further work.
  Discuss focused improvements through issues and pull requests.
- Fifteen imported historical notes lack surviving build metadata. Their text is
  preserved; their build claims are explicitly unverified.
- Source screenshots are review fixtures, not live-console evidence. Pixel equality
  can depend on the macOS/Chrome rendering environment.

No support, maintenance or response time is promised. Report bugs with redacted
data; use [private security reporting](../SECURITY.md) for vulnerabilities.
Read the [full disclaimer](../DISCLAIMER.md) and [licence](../LICENSE).
