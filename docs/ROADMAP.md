# Roadmap and contributor tasks

Updated 9 November 2026 for the first public Apple Silicon release. This is the
current public to-do list. [The dated audit](AUDIT_2026-11-09.md) explains evidence
and limits; [architecture](ARCHITECTURE.md) explains the code. P1 means acceptance
or security work to prioritise; P2 means a focused improvement; P3 means gradual
maintenance. An unchecked task is not automatically a reproduced runtime defect.

## P1 — reliability and independent acceptance

- [ ] **SAVE-01 — Exercise crash recovery and station restoration.** Individual
  files already use temporary writes, file synchronisation, recovery copies and
  rename. Station import saves a pre-restore snapshot and compensates for ordinary
  failures, but spans several files and browser localStorage. In isolated test
  data, terminate between every restore stage, inject full-disk/permission/corrupt
  file failures, restart and recover the exact original station. Record which
  stores committed. Decide whether a durable transaction journal is justified
  from those results; do not choose a database before defining the data contract.
- [ ] **LTC-01 — Validate real LTC input.** The owner has not tested LTC. Generated
  codec fixtures do not establish interoperability. Use an independent generator
  and audio interface at supported rates; record lock time, decoded positions,
  channel selection, level/noise/silence, rate changes and unplug/replug. Cover
  armed cues and stale callbacks during source changes. Publish a sanitised test
  report with tolerances, not a claim based on our own encoder/decoder round trip.
- [ ] **MTC-01 — Measure an independent MTC receiver.** Cover fractional rates,
  drop-frame, source/rate changes, jumps, silence and late deadlines. Validate
  23.976 cadence with rate code 24; reverse positions are locates, not reverse
  playback, and 29.97 non-drop output is refused. Record bytes and timing against
  an independent reference.
- [ ] **WING-01 — Accept repaired paths on controlled hardware.** Verify selected
  models/parameters, request ordering, native meter groups/scales/renewal,
  reconnect, overlapping runs, queued work and Panic Stop. Distinguish sent,
  confirmed, unconfirmed, cancelled and dropped. Keep the desk isolated from a
  show and omit identifying console/customer/network data from public evidence.
- [ ] **SOAK-01 — Run a representative four-hour show.** Record memory, CPU,
  dispatch latency, queue pressure, reconnects, meters, cues, external triggers
  and saved outcomes. A short overloaded synthetic soak does not close this task.
- [ ] **MAC-01 — Verify a clean Mac and permission lifecycle.** Install the actual
  downloaded release on another Apple Silicon Mac; check app-specific Gatekeeper
  approval, native panels, microphone denial/grant and retention over a subsequent
  identity-signed update. Record OS/build. Local unquarantined installation and
  Chrome tests do not establish this first-download experience.
- [ ] **DEP-01 — Triage the parked Expo/development dependency advisories.** The
  dated npm scan reports 34 affected package entries, including one critical.
  Establish reachable developer-tool paths, update within supported Expo v55
  constraints and rerun relevant checks. Do not apply npm's suggested Expo
  downgrade or `audit fix --force`. These packages are not the shipped desktop
  Rust binary; that distinction is not a developer-tool security clearance.

## P2 — focused improvements

- [ ] **SAVE-02 — Report durability uncertainty after rename.** Directory-open/
  directory-fsync errors are currently ignored after content has committed. Define
  a result that distinguishes committed bytes from uncertain durability. Inject
  those failures, verify read-back and recovery, and preserve callers' rollback
  semantics. Simply returning an error after rename can misreport a committed
  change as untouched; no data loss from this path has been measured.
- [ ] **LTC-02 — Preserve input identity during device recovery.** Retain names,
  distinguish enumeration failure from zero devices, and detect arrival while
  the input is closed. Define explicit fallback consent/policy. Current fallback
  is reported, but can select the default device and clamp the channel. Cover
  missing/renamed devices, fewer channels and generation changes, then LTC-01.
- [ ] **UI-01 — Make matrix selection keyboard-operable.** Add roving focus,
  arrow navigation, Space/Enter selection, Escape cancellation and visible focus.
  Verify return to the invoking control and reachable Panic in both themes.
- [ ] **SEC-01 — Review the UI/IPC trust boundary.** Inventory imported-content
  sinks, navigation and command permissions per window. Reproduce a threat path
  before changing CSP/capabilities. Add negative tests for untrusted names/values
  while preserving supported local workflows. No exploit has been demonstrated.
- [ ] **DEP-02 — Track unmaintained Unicode dependencies upstream.** Five unic
  0.9.0 crates have RustSec maintenance notices. Identify the introducing desktop
  dependency and an upstream-supported migration; do not replace a parser stack
  solely to silence an audit without regression evidence.
- [ ] **UI-02 — Simplify the LTC list and inspector.** Separate source, show,
  list and edit controls while preserving unfinished edits and compact clock
  behaviour. Compare both themes/widths and rerun cue/keyboard contracts.

## P3 — maintainability

- [ ] **ARCH-01 — Extract modules gradually.** Start with one high-change
  responsibility in `main.rs` or `index.html`; retain contracts and measure runtime
  cost. File size is not a reason for a broad rewrite before live use.
- [ ] **CI-01 — Establish reproducible macOS CI.** Measure a clean toolchain and
  dependency install, document versions and cache boundaries, then automate the
  appropriate gate. Keep hardware tests opt-in and signing keys private. Do not
  count skipped browser suites as passing.

Mobile work remains parked. Commercial activation is not a prerequisite for
this source-available project and must not be enabled as incidental cleanup.

## How to pick up a task

Open an [issue](https://github.com/marmoles-supply/wing-controller/issues/new/choose)
using its ID in the title, describe the proposed scope and link the evidence.
Issues hold discussion and assignments; this checklist records accepted scope
and closure. Submit a focused PR following [CONTRIBUTING](../CONTRIBUTING.md).
Close an item only with implementation/measurement evidence and its acceptance
result. Hardware and release acceptance require their own dated report.
