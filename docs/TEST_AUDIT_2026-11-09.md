# Test audit — 9 November 2026

Scope: source-test credibility, failure handling, selected regression gaps and
automatic execution. This is not a certification of the application or a complete
review of every assertion. No release/version bump is part of this work.

## Method and findings

The existing suite contains Rust behaviour tests, Node/VM execution tests,
browser tests with stubbed IPC, visual comparisons and source-string guards.
Counting files or gate steps does not measure test cases or coverage. No overall
coverage percentage has been measured.

| Finding | Evidence | Repair / remaining limit |
| --- | --- | --- |
| A failed Chrome restart erased an earlier failed test | **MEASURED:** executing the original retry block with a failed restart left zero failures | Retain the failure until a retry can run; exercise the actual shared Bash functions with successful and failed children/restarts |
| Exit-zero without the browser completion marker returned zero to its caller | **DOCUMENTED:** original timeout wrapper recorded failure but returned the child's status | Return failure and require the final non-empty line to be the marker; negative cases cover absent and early markers |
| Registry test accepted a command mentioned after the registration list | **MEASURED:** removing only `timecode_as_run` from the registry still passed | Parse the bounded identifier list; mutation removes the real registration while later mentions remain |
| Source guard accepted a disabled Live Safe Mode protection | **MEASURED:** `false && liveLockBlocks(...)` still passed the old source check | Execute New, Duplicate, Delete and Save in the real UI while live/reconnecting, verify state/persistence/refusal, then verify unlocked positive controls |
| Trigger-policy tests never used nonzero dwell | **DOCUMENTED:** all six previous runtime cases used zero dwell | Explicit Instants cover dwell completion/reset, cooldown expiry and stale boundary; remove a scheduler-dependent 2 ms sleep |
| Atomic writer tests omitted two refused-save paths | **DOCUMENTED:** successful saves were covered; recovery-copy/rename failures were not | Block destinations with nonempty directories; assert error, unchanged previous contents and temporary cleanup |
| Design screenshot test passed when Chrome was missing | **DOCUMENTED:** early `process.exit(0)` | Exit 3; test that absence cannot emit a completion marker |
| Shared browser stub silently accepted unknown IPC; uncaught exceptions were discarded | **DOCUMENTED:** generic `{}` fallback and discarded CDP events | Add opt-in strict fixtures, unknown-call recording and page-exception collection; new lock suite enforces both. Older suites still need migration |
| Synthetic soak swallowed worker panics and did not reconcile outcomes | **DOCUMENTED**, then **MEASURED** with one worker deliberately panicking while the others run | Join errors fail; every hit must equal returned-Ok + returned-Err + dropped, every slot must release and sample counts must match. Ok is labelled as a returned report, not console confirmation |
| Sharing Cargo artefacts with mutation copies contaminated a later ordinary test run | **MEASURED:** the regular stale-boundary test failed using a mutant binary; touching source without changing its SHA-256 restored the expected pass | Mutations use a separate `target/ci-mutations` namespace and a final normal-workspace control. Extra disk/build cost is deliberate |
| LTC round-trip comment claimed it was the only software proof possible | **DOCUMENTED:** generator and decoder shared the implementation | Correct the comment. Independent fixtures remain pending; self-consistency is not interoperability |

There are meaningful existing tests too: replacing the real library deletion with
a no-op made its VM test fail. It would be incorrect to describe the suite as all
cosmetic. It would also be incorrect to infer that every test is useful merely
because the suite exists.

Reproducers now live in `scripts/test-verification-gate.mjs`,
`scripts/test-desktop-library-lock-browser.mjs`, the Rust test modules and
`scripts/mutation-check-ci.mjs`. Mutation runs first require clean baselines,
then a failure naming the intended contract. Compilation failure is not success.

## Decisions this audit takes

**D01 — Run the full gate on hosted macOS arm64 for every push and PR.**
**DOCUMENTED:** [GitHub's runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
list `macos-26` as a standard runner with architecture “arm64”. **INFERRED until a hosted run completes:**
this can reproduce the macOS-specific gate without the owner's machine.
Consequence: longer runs, with explicit Node/Rust versions, lockfile installation,
full history, protocol checksums and retained logs. No signing secrets or live
console are supplied.
Rejected alternative: Linux-only or quick-only CI would omit macOS/native/browser
contracts. A hosted macOS inability to execute a contract would overturn the
runner choice; it would not justify silently marking that contract passed.

**D02 — Prove selected tests by reintroducing actual defects in a temporary copy.**
**MEASURED:** the original registry and lock guards accepted concrete broken code
(`scripts/test-desktop-command-registry.mjs:20` and
`scripts/test-desktop-live-safety-contracts.mjs:216`, before repair).
Consequence: targeted mutation probes add runtime and need maintenance when
their intended implementation changes.
Rejected alternative: another count/badge would not establish detection. Replace a
probe when a stronger executable test or a changed implementation makes its
defect irrelevant; never classify stale targets, compile errors or timeouts as caught.

**D03 — Preserve the distinction between source checks, stubbed UI and hardware.**
**DOCUMENTED:** the browser harness replaces native IPC
(`scripts/lib/desktop-ui-harness.mjs:389`); LTC fixtures use our own
generator (`desktop/src-tauri/src/ltc.rs:694`). Consequence: source CI does not close hardware/installation acceptance.
Rejected alternative: calling a browser fixture end-to-end app validation claims
a boundary it never crosses. Independent packaged-app and hardware measurements
can expand the accepted evidence, with the exact environment recorded.

## Evidence record

The pre-edit engineering quick gate passed 49 checks and explicitly omitted 34
named browser suites. This is a baseline, not the result of the repaired full
suite. Hosted run links and final local/mutation results are recorded below after
they finish. No external LTC, live-console or multi-hour show testing is claimed.

Lesson retained: our earlier explanation correctly said tests existed, but their
presence did not establish their sensitivity. The audit found real false greens
in the project's own verification and corrects that record explicitly.

### Local measured checks

- The initial nine isolated mutation probes caught their intended defects after
  passing baselines. These were assertion failures, not compilation failures or
  empty test filters. Production source stayed unchanged; sharing the regular
  build cache nevertheless contaminated a later run, as recorded below.
- The Rust workspace run passed 561 tests and explicitly ignored 15. Thirteen
  require physical-console opt-ins; one is a cold-route timing measurement and
  one a 20-second loopback synthetic soak. CI runs that last case separately.
- The initial full audit run failed on an unclosed socket in our new browser test
  and on the provenance test still reading the Bash reporter's old file location.
  Both are repaired. That failed run is retained as a lesson; it is not relabelled
  green because the underlying assertions had passed.
- Actionlint accepted the workflow. Gitleaks reported no detected secrets in
  the source candidate or the scanned public history; this is pattern-based evidence.

The strengthened mutation pass caught **10/10** intended defects, including a
single panicking soak worker while other workers can still complete. Its
unmodified soak baseline passed before injection. The regular runtime suite then
passed all ten tests after the isolated mutation run.

The same runtime policy under test is called by the live subscription at
`desktop/src-tauri/src/main.rs:7118` and `:7508`, not a test-only duplicate.
The atomic writers serve the actual macro-library and station-backup commands.
These are source-wiring facts, not physical-console acceptance.

The second full local pass completed every Node/browser suite, then failed on
that contaminated Rust cache. It remains a failed gate. The source SHA-256 was
identical before and after the timestamp-only rebuild. Subsequent verification
uses isolated mutation artefacts and an ordinary-workspace control; it does not
reinterpret a stale binary as a new application defect.

### Hosted evidence and portability repairs

[Hosted run 42700801637](https://github.com/marmoles-supply/wing-controller/actions/runs/42700801637)
completed a clean dependency install, pinned protocol acquisition/extraction and
Rust tests, but failed four frontend/visual suites. It is a failed run, not cloud
acceptance. macOS26.7.2 arm64, Chrome156.0.8078.80, Node26.8.2, Rust1.98.1 and
Poppler26.10.0 were recorded in its artefact.

- Bridge reloads guessed1800ms and could read the previous booted document.
  They now wait for a changed document token plus independent boot/listener
  completion, then retain the original session/model/health assertions.
- Tooltip tests guessed900ms for an800ms dwell and could read retained content
  while hidden. They now bring the tab forward, reset through the actual pointer
  handler and poll boundedly for the new tooltip. Early-dwell and content checks remain.
- Cue-save tests inherited the host motion preference before demanding animation.
  Normal and reduced-motion branches are now explicitly selected and asserted;
  the original host preference is logged. The original cloud preference was not captured.
- Four visual differences were reproduced by a separate deterministic capture,
  [run42705465503](https://github.com/marmoles-supply/wing-controller/actions/runs/42705465503).
  The app UI source bytes were identical. Six images were byte-identical. Meter
  light/dark differed only123/126pixels inside the filtered logo (18×16 region);
  LTC light/dark differed42pixels in a native numeric input (9×7 region). Full
  captures were inspected and four exact variants approved with their hashes.

**D04 — Keep separate explicitly selected visual records for these renderers.**
This initial decision's four automatic-renderer variants were later narrowed to
two software-renderer variants by D06 below; its original evidence is retained.
**MEASURED:** the ten-image local record passes unchanged; the hosted capture
reproduces precisely the four bounded differences above. Consequence: four extra
images and recorded renderer provenance need maintenance. All ten images still
undergo exact byte/pixel checks; nothing is masked and no tolerance is added.
Rejected alternative: replacing local images moves the failure to the other
machine; tolerances or masks stop checking the affected logo/value. Strict
version-string rejection also rejects unchanged pictures after a renderer update;
versions are therefore logged, while platform family and exact images remain enforced.
A common reproducible renderer proven on both machines would overturn the need
for separate records. Wider or unexplained differences require another review.

### Settings startup/polling repair

[Run42707537543](https://github.com/marmoles-supply/wing-controller/actions/runs/42707537543)
passed the four previously failing suites and Rust, then failed only the Settings
cue-delivery check. The test waited600ms after a simulated state change.
**DOCUMENTED:** its reload readiness allowed DOM presence before boot registered
Settings handlers; cue rows can load independently of an open Settings page.
**INFERRED:** an early lost click left polling inactive on this run.

The repair waits for a fresh per-document token and registered Settings hooks on
every reload, opens Settings and Timecode through their real controls, and verifies
modal visibility, active tab and running polling. Each changed stub state has a
revision; the test requires that exact revision to be consumed and rendered.
All original visible/count/warning/empty assertions remain. It calls no production
render/poll function directly. The complete Settings suite passed locally afterwards.

The local full gate passed86 checks, including35 named browser suites and561 Rust
tests;15 Rust cases were explicitly ignored. That full pass preceded the final
Settings-only repair; the changed Settings suite passed separately afterwards.
This is local evidence, not a replacement for final hosted acceptance. Packaged-app startup acceptance is
tracked separately; waiting for readiness in a test does not close that task.

### Native dialog close-event ordering

[Run42712520984](https://github.com/marmoles-supply/wing-controller/actions/runs/42712520984)
passed Settings and Rust but failed the design workstation's focus-return check.
It read `dialog.open === false`, then waited a zero-delay timer before checking
focus. **DOCUMENTED:** the [HTML dialog closing algorithm](https://html.spec.whatwg.org/multipage/interactive-elements.html#close-the-dialog)
removes `open` before it says to “Queue an element task on the user interaction
task source”. A timer is not a barrier for that event. The actual opener-focus
handler is registered before `showModal()` in `design/workstation/interactions.js:34`.

The test now observes the real native close event and waits boundedly for closed
state plus exact opener focus, retaining both final assertions. It never focuses
the opener or dispatches a synthetic close event itself. **INFERRED:** task ordering
caused the hosted failure; no runtime focus defect was established by that run.

The repaired workstation suite passed locally. A separate temporary copy then
removed only the real opener-focus handler: the same suite failed with its
focus-return assertion, the active element was `body`, and no completion marker
was emitted. This additional negative control is separate from the initial ten CI probes.
The subsequent local quick gate passed51 checks and explicitly omitted35 named
browser suites. Its screenshot check still ran; Rust again passed561/ignored15.

The audit also corrected the contributor setup text: the old Node20.19 minimum
conflicted with the suite's use of `node:fs.globSync` in
`scripts/test-design-app-agreement-live.mjs:83`. Setup now names the actually
measured Node26.8.2 and Rust1.98.1 instead of asserting an untested older range.

### Main-branch policy

**D05 — Require the GitHub Actions desktop test check before main advances.**
**MEASURED:** a temporary protected branch rejected a ref update to failed
commit `acc061375843031c7f6d84bf94900a8cc7a31767`, using the same publishing App.
The server named the failing required check and the branch stayed unchanged.
The temporary rule and branch were then removed.

The chosen policy binds `Desktop tests (macOS arm64)` to GitHub Actions App15368,
requires an up-to-date branch, applies to admins and disallows force pushes and
branch deletion. Consequence: source changes need the passing check before
integration; the maintainer still reviews the meaning and scope of a change.
Rejected alternative: a displayed badge alone cannot prevent a failed change
being integrated. A mandatory approving reviewer was not added for a sole-owner
project; the contributor PR/review process remains documented in CONTRIBUTING.
Changing the workflow's job name requires deliberately updating this policy.

This is enforcement of a named check, not independent review of the test code.
[GitHub documents](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
that skipped/neutral conclusions can satisfy required checks; the configured
desktop job has no skip condition or `continue-on-error`. Future workflow/test
changes still require scrutiny. Main protection is recorded as applied only
after its actual settings have been read back.

### Failure diagnostics

The first24lines-only reporter hid the visual check's explanation behind its
successful capture listing in run42715636039. **MEASURED:** executing the old
helper with60setup lines and a final assertion omitted that assertion from console
output. The shared helper now prints bounded context from both ends and preserves
the complete log. Its executable fixture requires the final assertion to remain
visible. The workstation focus timeout also reports only the active tag/id,
avoiding a full `body.outerHTML` dump with an embedded background image.

### Bridge backend fixture and the second hosted rejection

Run42715636039 also rejected bridge startup-state adoption (session0 rather than77).
The earlier fresh-document barrier was insufficient to explain this: boot awaits
`syncBridgeState()` before setting its completion flag (`meters.html:7043–7058`).
A longer wait was therefore rejected as a repair.

**DOCUMENTED:** the old fixture silently restored an idle answer when file-URL
session storage was absent or unreadable. **COULD NOT ESTABLISH:** which response
that hosted run actually returned; it was not logged. The replacement keeps the
backend snapshot in the Node process and embeds the selected revision in the
single preload script before reload. It records the returned snapshot and checks
the intended fixture independently before the existing adoption/health/ready-order
assertions. No application state-adoption function is invoked to fix startup.

The repaired suite passed locally. Removing only `applyBackendStreamState(snapshot)`
in a temporary app copy then failed the original session-adoption assertion,
after the intended fixture had been verified. This becomes an eleventh CI mutation
probe; the earlier10/10 evidence above refers to the preceding implementation.

### Exact screenshot repeatability — 10 November follow-up

Run42715636039 rejected66 pixels on one Inspector-header row in the dark main
window, x1325..1494/y88. Local instrumentation reproduced both complete image
hashes. The header's rectangle was identical (1139,71.09375,402,35), as were DPR1,
its CSS and the generated background PNG SHA-256
`102bcbca003173a33df8626dd3dcc08435602e5ac4c8128a9dd43fcf80db6da7`.
**MEASURED:** final composition differed despite identical bitmap and geometry.
**COULD NOT ESTABLISH:** the precise internal browser/driver cause.

Lesson retained: five targeted samples with `--disable-accelerated-2d-canvas`
suggested a remedy; three full captures disproved it by producing both hashes.
That flag was not adopted. Its apparent early success was not repeatability proof.

**D06 — Pin software compositing for the exact screenshot test only.**
**MEASURED:** [capture run42719049204](https://github.com/marmoles-supply/wing-controller/actions/runs/42719049204)
and the matching local experiment each produced five byte-identical full ten-image
sets with `--disable-gpu`:100 captures total. Eight images match between machines;
two LTC images differ only42 pixels in the previously identified native input.
Full images were visually reviewed. The changed renderer also changes other
pixels (up to132149/1600000 in the dark main window), so references were deliberately
updated with source, flags and old/new hashes, not treated as an invisible switch.
See `design/screens/SOFTWARE_RENDERER_REVIEW_2026-11-10.json` for all counts.

Consequence: the screenshot caller explicitly opts in, the actual launch arguments
identify its render mode, and the host profile enforces it. Other browser callers,
product-media generation and application rendering keep their normal behaviour.
The two unnecessary meter variants are removed; two native-input variants remain.
The comparison stays exact. A twelfth mutation adds one rendered red pixel and
requires the real screenshot check to reject it after a passing baseline.

Rejected alternatives: accepting either automatic image, masking the row, adding
tolerance or retrying until an expected image appears would weaken the oracle.
Changing production CSS solely for this test would affect operators. The narrower
Canvas2D flag did not fix repeatability. Software rendering does not establish
GPU-driver or native WebKit correctness; that is an explicit acceptance limit.
A reproducible normal-renderer record measured across both environments would
overturn this choice. Future software-renderer differences still fail for review.

### Final assertion review: readiness is an ordering contract

**MEASURED:** removing only `await` from the real bridge startup query still
passed the preceding suite. Its `readyAfterState` check counted calls after boot;
it did not prove that the state had been adopted before announcing readiness.
The name of that assertion overstated its evidence.

The fixture now journals query/reply counts, revision and the actual adopted
session at the instant `wing_meters_ready` is written. The unmodified application
passes. The same missing-`await` mutation now fails with the captured session0 at
announcement, even though session77 is adopted afterwards. This is the thirteenth
mutation probe. The one-pixel probe also requires a numeric boundary and its exact
1×1 region at(0,0), so an unrelated11-pixel difference cannot satisfy its evidence.
