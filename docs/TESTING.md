# Tests and regression checks

[Latest runs](https://github.com/marmoles-supply/wing-controller/actions/workflows/tests.yml) ·
[Test audit](TEST_AUDIT_2026-11-09.md) · [Hardware/community testing](COMMUNITY_TESTING.md)

GitHub Actions runs the full verification gate and selected mutation checks on
pushes and pull requests, including forks. The job uses a hosted Apple Silicon
Mac, read-only repository access, no owner credentials and no physical console.
Cancelled or pending runs have not established a passing result. Open a run's
**Desktop tests (macOS arm64)** job to see each step; its downloadable test-logs
artefact retains full per-suite output and tool versions for 14 days.
Fresh visual captures are retained there too, so a screenshot difference can be
reviewed without automatically replacing the reference images.

The default Rust run lists its ignored cases explicitly. CI separately runs the
20-second synthetic runtime soak against a loopback fake console and verifies
that exactly one test executed. Physical-console cases and a cold-route timing
probe stay excluded. A short synthetic soak does not establish show endurance.
Fork runs may require GitHub's first-time contributor approval.

## What runs

| Layer | Location | What it establishes |
| --- | --- | --- |
| Rust behaviour | `#[cfg(test)]` modules in `crates/` and `desktop/src-tauri/src/` | Parsing, trigger policies, persistence/recovery, scheduling, local transport and other tested backend contracts |
| Node behaviour | `scripts/test-*.mjs` | Module and VM checks, including extracted UI logic |
| Source/structure contracts | Some `scripts/test-*.mjs` | Required declarations, command registration, paths and assets; these are not execution coverage |
| Browser interaction | `scripts/test-*-browser.mjs` | Real HTML/JavaScript in Chrome with synthetic state and stubbed native IPC |
| Visual record | `scripts/test-design-screens.mjs` | Fresh light/dark captures match exact reviewed renderer references; no pixel tolerance or masked areas |
| Static checks | `scripts/verify-all.sh` | TypeScript, window-script syntax and strict Maillot path/model audit |
| Mutation checks | `scripts/mutation-check-ci.mjs` | Selected tests reject thirteen deliberately reintroduced defects after a passing baseline |

Mutation checks use a temporary source copy, never edit production files, and
reject timeouts, compilation errors, missing mutation targets and zero-test
runs as evidence. They cover dwell/cooldown/stale boundaries, refused saves,
temporary-file cleanup, registration, locked New/Save handlers, gate retries,
bridge startup-state adoption/readiness order, a single changed screenshot pixel and a panicking
soak worker. A final normal-workspace
run checks cache isolation. Detected mutations are examples of sensitivity,
not a coverage score.

## Run locally

Use an Apple Silicon Mac, Node 26.8.2, Rust 1.98.1, Chrome and Poppler. See
[development setup](../README.md#development) and [protocol setup](PROTOCOL_REFERENCE.md).

```sh
npm ci
node scripts/setup-protocol-reference.mjs
./scripts/verify-all.sh --quick  # everyday loop; explicitly omits named browser suites
./scripts/verify-all.sh          # complete gate, required before a release
node scripts/mutation-check-ci.mjs  # after the gate, never concurrently
```

The quick gate still uses a private Chrome for the visual record. Missing Chrome
fails the visual check. Named browser suites require their final completion
marker; exit zero alone does not count as completion. Failed browser restarts
retain the original failure. Run only one gate/mutation check at a time.

The mutation command copies tracked source files as they currently exist on disk;
add new test files to Git before running it. Its Cargo artefacts use the separate
`target/ci-mutations` namespace; it never reuses the regular gate's test binaries.
Set `WING_VERIFY_LOG_DIR` to retain all
suite output. The CI workflow does this automatically.

## Adding a useful regression

Start from a reproducible failure and exercise the function or control that the
application actually uses. Check its observable result: saved contents, unchanged
state after refusal, dispatched values, visible feedback or returned error. A test
that only repeats the implementation's wording cannot establish that behaviour.

Run the test before the repair and retain the expected failure; after the repair,
require it to pass. When practical, reintroduce the defect in a temporary copy to
check that the test still rejects it. A timeout, compile error or empty test filter
does not demonstrate detection. Include a positive control alongside a refusal
case so a broken path cannot pass by doing nothing.

Use explicit clocks/Instants for timing boundaries. In browser tests, wait
boundedly for a fresh document and the actual state/event being asserted; fixed
delays are not evidence that startup, polling or a native event has completed.
IPC fixtures should reject unexpected calls and tests should check uncaught page
exceptions. A new named browser suite must close its own resources and finish
with `WING_BROWSER_SUITE_OK` only after every assertion passes.

Changed reference images need a separate visual review and recorded provenance.
Changing an expected image or adding a longer delay alone is not a diagnosis.

## Limits and next useful contributions

Passing tests do not guarantee the absence of regressions. No measured overall
line/branch coverage percentage is claimed. Source guards can be satisfied by
incorrect code that contains the expected wording; consequential behaviours
need executable cases and negative controls.

Chrome with IPC stubs is not the packaged Tauri/WebKit application. Native panels,
permission transitions, first-download installation, external applications and
console/audio hardware require separate acceptance. LTC self-generated signal
round trips establish internal consistency, not independent interoperability.

High-value work remains: independently generated/licensed LTC fixtures, process
termination between every station-restore stage, explicit durability outcomes
after failed directory synchronisation, stricter fixtures across older browser
suites, and packaged-app frontend/backend acceptance. Track these in the
[roadmap](ROADMAP.md); publish measured setup and failures as well as successes.

## Reviewed visual renderer records

The screenshot test opts into software compositing (`--disable-gpu`) in its own
private Chrome. The same bitmap and geometry intermittently produced two drawings
under automatic compositing; the capture record documents that investigation and
the rejected alternatives. This option applies to this test, not the application
or the other private-browser callers.

All ten reviewed images repeated exactly across five fresh browsers on each of
the local and hosted Macs:100 captures. Eight images also match between machines.
The explicitly selected `github-macos26` profile supplies two reviewed variants
for the native numeric-input inset. Source, environment, flags, hashes and
before/after pixel counts are recorded in `design/screens/renderer-profiles.json`
and `design/screens/SOFTWARE_RENDERER_REVIEW_2026-11-10.json`. Every pixel is still
compared exactly, with no masks or tolerance. A one-pixel mutation verifies that
the check detects an actual rendered change.

The profile requires the recorded platform/architecture/OS family and render mode. OS patch and
Chrome updates are logged, then checked against the same exact pixels: a changed
version string alone does not change the expected image. A changed rendering
fails until explicitly reviewed. There is no automatic choice of a passing
baseline and the test job never regenerates its expected files.
Software-rendered Chrome pictures do not establish graphics-driver or packaged
WebKit correctness; those remain separate acceptance boundaries.

To propose updated references, manually run **Capture visual reference for
review** in Actions on the intended branch. It creates deterministic candidate
images in a disposable checkout and uploads them; it neither commits them nor
accepts them as correct. Review the images and bounded pixel differences, record
provenance/hashes, then commit approved references with the source change. A
successful capture job is not a successful regression-test run.
