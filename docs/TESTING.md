# Tests and regression checks

[Latest runs](https://github.com/marmoles-supply/wing-controller/actions/workflows/tests.yml) ·
[Test audit](TEST_AUDIT_2026-11-09.md) · [Hardware/community testing](COMMUNITY_TESTING.md)

GitHub Actions runs the full verification gate and selected mutation checks on
pushes and pull requests, including forks. The job uses a hosted Apple Silicon
Mac, read-only repository access, no owner credentials and no physical console.
Cancelled or pending runs have not established a passing result. Open a run's
**Desktop tests (macOS arm64)** job to see each step; its downloadable test-logs
artefact retains full per-suite output and tool versions for 14 days.

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
| Visual record | `scripts/test-design-screens.mjs` | Fresh light/dark captures match committed images; sensitive to renderer/environment differences |
| Static checks | `scripts/verify-all.sh` | TypeScript, window-script syntax and strict Maillot path/model audit |
| Mutation checks | `scripts/mutation-check-ci.mjs` | Selected tests reject nine deliberately reintroduced defects after a passing baseline |

Mutation checks use a temporary source copy, never edit production files, and
reject timeouts, compilation errors, missing mutation targets and zero-test
runs as evidence. They cover dwell/cooldown/stale boundaries, refused saves,
temporary-file cleanup, registration, locked New/Save handlers and gate retries.
Nine detected mutations are nine examples of sensitivity, not a coverage score.

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
add new test files to Git before running it. It reuses the local Cargo target
cache, not the original source files. Set `WING_VERIFY_LOG_DIR` to retain all
suite output. The CI workflow does this automatically.

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
