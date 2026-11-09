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
Consequence: ten targeted mutation probes add runtime and need maintenance when
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

- The nine isolated mutation probes all caught their intended defects after
  passing baselines. These are assertion failures, not compilation failures or
  empty test filters. Source files remained unchanged; the build cache was reused.
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
