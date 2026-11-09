# Changelog

One entry per released version, **newest first**: the desktop application (`Desktop x.y.z`) and the older
Android build (`1.0.x`), which is parked. An entry is the concise record of a release; the release note
beside a desktop build — the text an operator can read, shipped with the application — lives in
`desktop/release-notes/<version>.md`, and every one of those notes has its entry here (a test fails if one
does not: `scripts/test-desktop-changelog.mjs`).

Work that has not shipped yet sits in `## [Unreleased]` at the top, and moves into a version when a build
ships.

## [Unreleased]

- Prepare the independent source-available community repository, with professional use allowed,
  sale of copies/derivatives prohibited, corresponding-source redistribution and an explicit unofficial,
  no-warranty live-use disclaimer. Add platform, installation, guide and contribution documentation.
- Make source checks independent of ignored Android output, preserve hashed historical release
  evidence and label unverifiable imported build claims honestly. Acquire the pinned Maillot
  reference locally with PDF/text checksums instead of redistributing the full manual.
- Replace personal standalone-demo labels with generic vocal labels and refresh their two review renders.
- Correct standard binary MTC reception and output, ordered quarter-frame assembly, direction and latency;
  pace forwarding rather than bursting entire cycles. Source ownership and stream generations protect LTC/MTC
  transitions, reconnect and delayed callbacks. Fractional, reverse and unsupported output cases are explicit.
- Bind actions to the connected session, cancel all admitted work on Panic/Disconnect, and share each macro's
  overlap policy across manual, meter, state, MIDI, OSC and cue firing. Preserve cancelled, dropped, superseded
  and unconfirmed outcomes instead of reporting completion.
- Advance sequential Every cues, retain receipt identities across restarts, retry failed as-run writes and force
  history persistence on save and normal exit. Refuse a normal quit if the final history cannot be saved.
- Respect the focused dialog button on Enter, trap modal focus and restore it on close; keep floating Properties
  from blocking workspace shortcuts. Share the keyboard policy with the reusable design kit runtime.
- Refresh LTC macro choices without losing unfinished edits; report unavailable clock state honestly. Resolve
  fade/toggle capabilities against the selected model's catalogue metadata (Maillot model parameter tables).
- Save a recoverable station snapshot before restoring; compensate all affected sections on failure and name
  incomplete recovery. Correct the operator guide, window inventory and stale licensing implementation claims.
- Make fake-console test fixtures use a private loopback port; fixture setup failure now fails the test instead
  of silently skipping assertions when another application owns the console port.
- Hardware interoperability, multi-hour operation and native permission workflows still require their named
  acceptance passes. The current to-do also retains matrix keyboard navigation, LTC editor composition and
  device-arrival recovery; these are not presented as completed by these changes.

## [Desktop 0.2.99] - 2026-10-20

- **The design kit is approved, and the five windows draw one production chrome.** The reviewed kit
  **1.5.0** carries the production workstation material (`workstation.css`), the extracted surfaces and
  states (`surfaces.css`), the byte-identical dropdown/field-editing/dither/VU runtime modules, a working
  template and interactive catalogue, a manifest-validating creator and a canonical-chrome checker. The
  workstation, Meter Bridge, clock, LTC cue window and guide now share the raised chrome, panels, wells,
  controls and type scale. The older three-sheet specimen is retained for existing consumers and labelled
  historical, not the production target. Approved scope and limits: HTML/CSS/JavaScript consumers taking
  the complete kit and these five windows; arbitrary product workflows, native equivalence, OS panels and
  live telemetry are **not** covered. The kit's independent clone verified all 75 manifest entries and its
  distributed checker returned 0 failures at 420/820/1280 px in both themes.
- **The shared cue row follows the kit's type scale.** `cue-list.js` no longer writes fixed 9.5/10/10.5/11 px
  text or fixed 18 px controls: it uses `--font-base`, `--font-sm` and `--font-xs`, a minimum control height
  that grows with `--meter-scale`, and a number track derived from the same step so numbered and unnumbered
  rows keep the time aligned. The rules are scoped so the shared chrome cannot resize a row differently in
  the LTC and clock windows. The 420×200 clock and its one-row floor are preserved; the contracts measure
  18 px at the default scale, growth at scale 2, and the alignment in both states. (Audit U3.)
- **The guide names the five windows.** The opening chapter's “The two windows” became “The five windows”:
  workstation, Meter Bridge, clock, LTC cue window and guide, with how each opens. The generated guide
  content was refreshed.
- **Settings work from every route.** Timecode handlers are bound once at startup, so the Timecode card's
  Settings shortcut no longer arrives before its controls; polling follows the active page and stops on
  close. Settings categories are tabs with arrow/Home/End navigation; opening transfers focus, Tab is
  contained while modal, closing returns focus, floating mode updates modality, and child pickers consume
  Escape. The matrix keyboard pass remains open and is not claimed.
- **LTC header corrections.** The clock column no longer shrinks below its SMPTE text (the last frame digit
  was cut at 1180 px), and the last-fired readout is hidden until Live instead of showing an empty box.
- **The kit checker's screenshots are honest.** It repaints the dither after each theme change and waits with
  `setTimeout` rather than a background tab's animation frame; without the repaint, light-theme evidence
  carried the dark pattern while the checker was green. Kit links use the accent instead of the browser's
  navy, and the consumer documents no longer pin the expired 1.4.2 example and keep the provenance rule.
- **Verification:** `ALL GREEN · 79 checks`; the ten application images refreshed and re-rendered
  byte-identically; the final kit tarball independently cloned and checked. **R1–R5 remain open** — no Rust,
  protocol or execution source changed, and the release note states the impact explicitly.

## [Desktop 0.2.98] - 2026-10-10

- **The four browser suites the full gate had been red on since 9 October are fixed, and the gate is green:
  `ALL GREEN · 75 checks passed`.** Three of the four were faults in the application. A dropdown whose own button the
  window had scrolled out of sight opened past the edge of the window and left its last entries unreachable —
  measured, the button at 746…770 of a 720 px viewport with its panel `is-up` at 558…744 — and every menu now ends by
  being held inside the window, shifted along the edge it already opened against, with one taller than the window
  capped and scrolling. The Meter Bridge's dropdown fields were a drifted copy of the workstation's: their own text
  size (11 px against the shared design kit's 9.3 px), hard-coded border facets that were the kit's colour tokens
  written out by hand, a panel drop shadow the dark theme never got, and rows at 11 px; they now take the kit's rules
  and colours, and the bridge's buttons wear the workstation's dark bevel instead of one field restating it. The
  timecode window's cue list could be squeezed shorter than a single cue — 21.5 px of list against a 22 px row at
  420×200, so scrolling to the end left the last cue hanging out of the top of its box — and now has a floor of one row
  **measured from the row itself**, with the spacing tightened only while the list is open in a short window, so the
  folded clock and its recorded images are untouched. The fourth was a test that pinned light-theme colours and never
  pinned the theme (each window opened from a local file keeps its own storage, so it compared a dark bridge against a
  light workstation): it now pins the theme in **both** windows and measures **both**, which is where this family of
  fault hides — the dark theme of that control had never been measured at all. A fifth, smaller: the disabled-button
  contract demanded two exact greys the workstation had already replaced with the kit's dim token, and it now reads
  the colour from the page's own token. Recorded images of the Meter Bridge refreshed after looking at the difference.

## [Desktop 0.2.97] - 2026-10-10

- **The click rule on a field is applied where the engine cannot undo it, and a list that repaints under the click no
  longer takes the field with it.** The owner's report after 0.2.96 was exact — *"the clicks still do not work
  everywhere, for example the cues window"* — and it was two causes, neither of them the one 0.2.96 had fixed. **The
  list:** a click on a cue's field selects that row, selecting repaints the list, and the repaint replaced the element
  under the caret, so `document.activeElement` was `body` afterwards and the next keystroke changed nothing at all;
  `render()` now remembers the field (its row, its tag and class, its index among its siblings, its selection) and
  puts it back, and `select()` no longer repaints when the painted selection did not change. **The rule:** the engine
  places the caret as the *default action* of the press, which runs after every listener, so a selection set from a
  listener was collapsed again — measured in WKWebView, `setSelectionRange(0, 3)` at mouse-down on a field holding
  `-18` still typed `42` as `-1842`, and so did a `click` listener, while the same selection applied *after* the
  release gave `42`. Worse, the frame the module used before, `requestAnimationFrame`, **does not fire in a WKWebView
  whose application is not the active one** — the window the operator is in — so the rule ran in Chrome's suites and
  never in the app. The press the rule owns now has its default action cancelled and the selection set in that
  listener. One more half: the press counter is kept against the field's **address** rather than the element, because
  a rebuilt row handed the operator a new element and the second click looked like a first one. Measured after the
  change, same tool, real engine: `#threshold` (`-18`) gives `42` on one click, `-1842` on two and `-4218` on a third
  inside the text; a cue's own time field gives `42`, then `01:00:10:0042`, then `4201:00:10:00`. All of it comes from
  `scripts/dev-webkit-probe.swift`'s real event path, and `scripts/test-desktop-ltc-window-browser.mjs` gained section
  28 — a real mouse click and a real keystroke on a cue's own field, on a row that is not already selected — with
  three mutations in `scripts/mutation-check-ltc-window.mjs` proving each half fails by name when put back
  (**27 caught of 27**).

- **A fade can now start where the parameter is, and move it by an amount.** The owner asked for it in
  those words ("desde donde esté hasta X, o desde donde esté que baje o suba X"). The step's value panel
  gains two independent choices — **Fade from**: *the value I set* / *where it is now*, and **Fade to**:
  *a value* / *an amount (+/−)* — which together give four fades: the authored pair as before, "from
  wherever it is to X", "from wherever it is, up/down by X", and the same amount from an authored start.
  A fade that starts where the parameter is **reads the leaf first** (OSC has no relative write, so the
  console's own value is the only honest starting point), which costs one limiter slot plus the read —
  retried inside the same 250 ms budget a read-back gets — and the OSC terminal shows the value it read.
  **A read that does not answer fails the step and writes nothing**, because ramping from an invented
  value would move the parameter somewhere nobody asked for; the refusal names the address and the cause.
  An amount is added to wherever the fade started and the *result* is held to the parameter's own range,
  so `+3 dB` from a band already at `+15` stays at the top while `+1000 Hz` still means a thousand hertz —
  the amount itself is never clamped, which is the difference between an amount and a value. An amount of
  `0` is refused with its own sentence, like a wait of `0 ms`. The endpoint fields follow the modes: the
  start field hides when the console supplies it, the end field is relabelled **Change by (+/−)**, and the
  summary reads *"Fade Channels 1 Fader from where it is now by -3 dB over 1000 ms (reads the console
  first)"*. Five new Rust contracts (the four combinations, the clamping of the produced value, the
  refusal of a missing read, and the two halves against a desk — a relative fade ramps from the desk's own
  -6 to -9, and a desk that does not answer gets no writes at all), three new checks in
  `scripts/test-desktop-fade-endpoints-browser.mjs`, and the guide's chapter 3 and 4.

- **A macro fade is a value of the parameter it targets, not a level in dB.** The owner reported that fades
  "work half-well on faders and not on EQ bands and many other things", and the audit found three defects that
  were all invisible on a fader. (1) `normalize_action_steps` clamped **both** fade endpoints with
  `clamp(-144.0, 24.0)` before the step was compiled, and every path into the runtime passed through it: a
  `200 → 2000 Hz` fade of an EQ band arrived as `24 → 24` (128 writes of one number), a `-100 → 100 %` pan as
  `-100 → 24`, a `4 → 4000 ms` release as `4 → 24 ms`. A fader is `-144…10`, which is exactly why faders
  worked. The same clamp was called a feature in the guide and pinned by a Rust test, so the gate defended it;
  all three are corrected. The endpoints are now held to the range the **leaf** documents
  (`wing_core::targets::fade_value_range`), clamping the endpoints rather than each written value so a
  `-60 → 0` fade of a `±15 dB` EQ gain crosses the band's real range instead of holding at `-15` and moving at
  the end. (2) A ramp interpolated by offset whatever the leaf was: Maillot documents every frequency, Q and
  release time `logf` (`8615-8632`, `8217`, `8377`), so a `20 Hz → 20 kHz` sweep was already at 10 kHz halfway
  and crossed seven octaves in its first 10 %. `wing_core::targets::fade_domain` now answers per target — the
  strip's own model table first, because `/gate/rel` is `logf` on GATE and `linf` on DUCK — and the ramp moves
  by ratio where the leaf is logarithmic. (3) The step count came from the duration alone while one step
  writes one packet per selected channel, so a 1000 ms fade of eight channels took about 7 s; the count is now
  the duration's share of the 17 ms send limiter divided by the address count, each step is scheduled against
  the ramp's own clock, and a duration that cannot fit is stated in the preflight instead of being silently
  stretched. The window follows the same rule: the endpoints are re-seeded from the **new parameter** on every
  parameter change (not only on a change of kind, which left a fader's `-60` blocking a `±15 dB` EQ gain),
  held to their parameter's range on every load path, `+ Fade / Ramp` authors a fade of the parameter that is
  actually selected instead of a `ch 1 fader` step, and the help, the field labels and the step balloon read
  the parameter's own unit. **Also corrected:** an interrupted ramp reported `0 packets` for a fade that had
  been writing for a second (its partial counts now travel out of the step), its trace row now names the value
  it stopped on and a ramp reports its progress, and the preflight's packet estimate counted one address
  instead of the selector. Twenty new Rust contracts, one new browser suite
  (`scripts/test-desktop-fade-endpoints-browser.mjs`) and `scripts/mutation-check-fade-endpoints.mjs` — which
  puts each of the backend defects back and demands a named failure — pin it; the audit, its evidence and the
  open items are in `docs/MACRO_FADE_AUDIT_2026-10-09.md`.
- **The read-back tolerance for a written value is still the meter's 1/256 dB step (0.005) for every unit.**
  Recorded, not changed: the document never says the console rounds a float write to its documented step
  count, and the worked `/fdr` examples show a dB write coming back exactly, so widening the tolerance without
  a measurement would hide real mismatches. Whether a fade that lands on a coarse leaf (an EQ frequency's step
  is 0.7 %, about 7 Hz at 1 kHz) is reported as "the console did not apply …" is the first thing to measure on
  a desk. See `docs/MACRO_FADE_AUDIT_2026-10-09.md` §3.1.

## [Desktop 0.2.96] - 2026-10-09

- **One click rule for every field of every window, and it is the one the owner asked for.** One click selects the
  whole value so typing overwrites it, a second click leaves the caret at its end, later clicks are native (the
  operator's own wording is in `desktop/release-notes/0.2.96.md`). The rule had been written by hand in the main
  window and the meter bridge and did not exist in the LTC, Timecode or guide windows, so one gesture behaved three
  different ways and the three windows where typing was hardest had no handler at all; it now lives once, in
  `desktop/ui/field-editing.js`, loaded by all five, and `scripts/test-desktop-window-dialog-contracts.mjs` fails if a
  window keeps a copy. **Two defects were measured rather than guessed** (Chrome 155, 2026-10-09): the bounded
  re-focus that follows a click re-applied the *first* click's select-all, so the selection came back 140 ms later and
  again for nearly a second — the caret appeared to jump to the left on its own while the operator was typing — and
  both windows' channel-matrix grid cleared the document selection on **every** window-level `pointerup`
  (`onPointerUp` in `index.html`, `stopMatrixDrag` in `meters.html`), which left the field that had just been clicked
  with selection `[0,0]` and `insertText` disabled. The re-focus now only re-opens the engine's editing pipeline and
  never moves the caret; the grid clears the selection only while the grid owns the pointer.
  `scripts/test-desktop-field-focus-browser.mjs` drives **real mouse events** on a probe input in all five windows and
  asserts the three clicks plus the re-focus, and each of those four defects was put back by hand and made it fail,
  naming the defect.
- **The LTC window is a table now.** The owner's screenshot showed every field as an unlabelled box, the cue's number,
  name and time printed twice per cue, `Last run` wrapped onto two lines, and the row's own controls as a cluster of
  10px glyphs. The list now has a sticky column header that shares one `--cue-cols` template with every row (so a
  column name is over its own column), the fields come first with the shared identity line re-ordered *under* them as
  the row's status strip — time, health, its own controls — and nothing is printed twice (the time returns to the
  strip only while the ✎ editor is open, whose one live feedback it is, asked with `:has()` inside
  `@supports selector(:has(*))`). The toolbar is two lines with the shift preview ellipsised and its whole sentence in
  a tooltip, the header and the footer read as groups, and Live now hides the column names and the row's editing
  buttons with the fields they would change — a header over columns that are not there was a promise the window did
  not keep. Verified by the window's whole browser contract, whose sections 26 and 27 measure the **rendered** column
  x, that no row wraps, and that every field is a well in the kit's number type in both themes, by
  `CONFORMANCE OK · 0 failures`, and by the refreshed `design/screens/ltc-light.png` / `ltc-dark.png`.
- **The build no longer ships its builder.** Requested by the owner: no reference to this machine, to him, or to
  any AI tooling, in the code or in the binary. Three things carried one. The release binary held **261 strings
  containing the build machine's account name** — `rustc` records the path of every source file that can panic, and
  cargo compiles dependencies from the absolute path of the registry copy, so `strings` on a shipped copy named the
  account the build ran under and where the project lived; `scripts/build-paths.sh` now exports
  `--remap-path-prefix` through `CARGO_ENCODED_RUSTFLAGS` with the prefixes read from `$HOME` and the repository's
  own location, so **no machine path is written into the repository either**. The bundle identifier was that account name
  spelled as a reverse domain, in `Info.plist` **and in the code requirement
  macOS checks for the microphone grant**: it is now `com.wingcontroller.desktop`, and anybody who had granted the
  microphone grants it once more (nothing of the operator's moved — the support folder is a literal
  `Wing Controller Desktop`). And 130 build artefacts under `crates/wing-core/target/` were tracked, carrying
  absolute build paths in their dep-info files, together with one editor tool's local plugin configuration;
  both are untracked and ignored. Guarded by `scripts/test-desktop-build-identity.mjs` (always in the gate) and by a new
  *build-machine paths* line in `scripts/audit-binary-shield.mjs`, which fails the build on any. Two things are
  deliberately left and named in the plan (D8): the toolchain's own standard-library paths, which only a rustup
  build would close, and the parked Android package. One footnote in the protocol reference cites a third-party
  service as a source and stays: it is Patrick-Gilles Maillot's own citation in this project's primary protocol
  authority, and editing a reference document to remove its author's source would falsify the record.
  One more of the same family was found while checking the rule the owner restated — *keep the traces out of
  the app*: `desktop/ui/index.html` carried the **test console's own discovery identity** inside a comment
  beside the channel-pretap row, in a file every window is served and every build encrypts. It now names the
  model family and the firmware (`a WING Rack on FW 3.1.1`), which is what a code comment is for, and the
  measurement it records is unchanged. Nothing guarded that: the existing identity check walks the windows'
  *hints*, and does not read this changelog, the release notes, the text the build writes into the DMG, or
  the interface's comments — so `scripts/test-desktop-build-identity.mjs` gained a section that reads all of
  them (113 files) and fails on the shape of a unit, `WING-<family>-<serial>`; a model family like
  `wing-rack` is a token this application parses and stays.
- **The interface no longer travels in the binary as readable text, and the symbol table is gone.** Two
  measurements on the shipped binary decided this: Tauri embedded all 3.2 MB of `desktop/ui`
  **brotli-compressed and not encrypted** (tauri-codegen-2.6.3 `src/embedded_assets.rs:378`), so the cue
  engine, the macro matrix, the routing resolver and the guide came back out with one call to a decompressor;
  and the default release profile left **12,254** of this project's own symbols in the clear, which `nm` reads
  back as a function-level map of the application. The interface is now a ChaCha20-Poly1305 vault generated at
  build time by `scripts/build-ui-vault.mjs` and served by `src/ui_vault.rs` through Tauri's own `assets`
  extension point, with file names hashed so the binary cannot even list them; `[profile.release]` now strips,
  and folds with fat LTO. The honest limit is written down rather than implied:
  `docs/BINARY_PROTECTION_PLAN_2026-10-09.md` §1 and D3 — the key has to be reachable by the code that
  decrypts, so this makes copying expensive rather than impossible, and a copied DMG still runs until the
  licence lands (D6, the owner's decision to defer it). `panic = "abort"` was **rejected on stability
  grounds** (D1): this binary spawns 19 worker threads and a panic in one of them currently ends that thread,
  not the show. Guarded by `scripts/test-desktop-binary-shield.mjs` (always in the gate) and
  `scripts/audit-binary-shield.mjs` (called by `desktop/build-dist.sh`, so a leaking build cannot become a DMG).

## [Desktop 0.2.95] - 2026-10-08

- **The cue row is a table of fixed columns, and every field in it is a well.** Reported by the owner with a
  screenshot: the fields started at a different x on every row. Four separate causes, each measured by a rendered
  contract: the row of fields was RIGHT-ALIGNED, so it began wherever the row's own width left it; a grid fills
  its tracks in order, so a row missing a field moved every field after it; the number badge existed only on rows
  that had a number, so the time beside it shifted; and every field was drawn as a RAISED face, with the ones that
  are always on screen taking the browser's own border because no rule gave them one. All 35 fields are now wells
  in the kit's own field token and number type, and every column shares its x across every row.
- **Two contracts that measure what is RENDERED rather than what is written**, because the DOM was always correct
  and it was the layout that had stopped agreeing with itself: one for a column's coordinate, one for a field's
  bevel and type. The second found the fourth cause on its first run, on the fields nobody was looking at.
- The source guard around the cue row now states the edge it does not cover - it can say who declares a class, not
  that two declarations in two files cancel each other out - and the window's own row furniture has a single named
  owner.
- A stale comment in the main window's source still said the cue list is edited in Settings. It is edited in the
  LTC window; Settings keeps the summary. The button and its handler were already right.

## [Desktop 0.2.94] - 2026-10-08

- **The cue system read end to end against its own words**, and nine things an operator sees changed with it.
  The card's empty state names the LTC window and its button, where it used to send him to Settings - which
  cannot add cues; the card and the badge show the freewheel tolerance and the re-arm sentence, which they used
  to phrase themselves and leave out; the log no longer asserts a seek one line below the statement that held
  the verdict, and it names the length of a dropout instead of calling every one a jump. A cue problem nobody
  recognises reports "unknown" rather than "fine". The clock interpolates and counts down at every declared
  frame rate, not only at 25, and 23.976 is stored and accepted as 23.976. A cue added from the macro editor
  takes the next free id instead of minting one of its own, and the guide says three readings where it said two.

## [Desktop 0.2.93] - 2026-10-07

- **The courtesy notice is adjustable, and its accent cannot repaint a failure.** Its settings gained a size
  slider (70-180 %, scaling the card's text and padding while the borders stay exactly one pixel), a duration
  slider (half a second to thirty, with fully-left still meaning Persistent), an accent colour for an ordinary
  notice's caption and drain bar, and a flash that is off by default, pulses once a second - deliberately below
  the three-per-second rate that makes a flashing surface unsafe - and is switched off entirely when the system
  asks for reduced motion. A **failed** action keeps its red caption and a **test** keeps its blue one: those two
  fills are what the card is saying, so the colour preference is deliberately not allowed to touch them. Both
  sliders apply while they are dragged, and the older 2 s / 3.5 s / 5 s choices land on the new slider unchanged.

## [Desktop 0.2.92] - 2026-10-07

- **The LTC section is completed, and its worst defect is gone.** A list whose cues carried two stored frame rates could
  not be saved at all ("the cue list mixes frame rates"), and a cue is stamped with the source's rate when it is added -
  so changing the input's rate between two adds made the list unwritable. The refusal is deleted: the format the source
  speaks now is what gives a cue its meaning, and previously unsaveable lists save and fire.
- **A wrong declared frame rate stops being quiet.** The input measures the signal's own bit timing as it decodes -
  exact, and free of the bias a decoded-count estimate has - and the window names both numbers when they disagree by
  more than 2 %, never across a rate boundary (29.97 against 30 is 0.1 % and only the drop-frame bit separates them), and
  never with the word "detected": what is measured is the signal's playback speed at the sample rate the device reports.
- **A stream that goes quiet stops pretending it is listening.** The input watches the age of the data, says how long
  nothing has arrived, and reopens it **once** - bounded, with a twenty-second cooldown, logged, and never over a stream
  that has never decoded, where the fault is the rate or the channel and a reopen would hide the diagnosis.
- **A macro that changed since a cue named it is a note, not a gate.** The cue records a content hash of the macro, and
  the inspector says when the library's copy no longer matches - while the cue keeps firing exactly what it names.
- **The LTC window says more and lies less**: "used by N cues" with the cues named, a `×N` marker on a shared macro, a
  section typed on the row, a next-cue readout that names what it waits for (`next LTC` or `next on Go`, with the
  countdown only on the clock), Enter to append, and a signed bulk shift over a selection with one Undo. Three defects
  are fixed with it: the chain reads the live safety state, a missing health shows as **unknown** rather than "fine", and
  saving from that window no longer reverts an offset edited in Settings.
- **The gate reports a wedged browser instead of waiting for ever.** Every browser command has a deadline and, when it
  runs out, says what it asked for, how long it waited and whether the browser still answers; the longest UI suite is
  split into two processes (49 s and 27 s, measured) because headless Chrome on this machine stops answering after about
  ninety seconds of page activity.

` at the top, and moves into a version when a build
ships.

## [Unreleased]

- **The whole catalogue answers one contract, in a test.** It walks every category and parameter and
  pins what the editor, the validator and the resolver all read: a key that names rather than
  addresses, no duplicate in a family, a known value kind, a closed list with at least two distinct
  entries, an on/off value that is exactly 0 or 1, a finite numeric range, comparators exactly equal
  to the ones the kind allows, and — for every watchable parameter — each legitimate comparison
  accepted and each impossible one refused. It found the two dead entries (`load_snapshot`,
  `load_preset`) carrying no explanation at all; both now say why they write nothing.

- **A value is validated once, for a comparison and for a step.** A step writes without comparing
  anything, and it only checked closed lists: a hand-edited file or an Android import could send a
  40-character name to a 16-character leaf. A comparison is now seeded with a value its own parameter
  accepts too — the kind's default used to fall outside the range for Gate Range, Compressor Gain and
  a ratio, so the macro was born with a value its own validator refused.
## [Desktop 0.2.91] - 2026-10-05

- **The Shoot card told the truth about everything except a toggle.** A toggle sends `-1` and the console flips the
  parameter (Maillot: "By sending a -1 to an OSC Command with an integer OSC Type Tag that can only accept values 0 or 1,
  the value of the parameter will toggle between 0 and 1"), but the card after a Test Action, both Shoot dialogs and the
  session log printed the **stored** value - so a toggle of `/ch/11/in/set/altsrc` reported `int=0` while sending `-1`. The
  report was wrong and the packet was right. All of them now print what leaves, as `<address> toggle (-1)`.
- **The dead read-then-invert path is deleted.** `execute_toggle_step_by_reading` and its inversion helper survived as dead
  code called only from tests, with a comment beside the real executor still claiming a toggle reads first - so the tree
  said two different things about one step. They and the tests pinning them are gone; a toggle on a parameter that is not
  on/off is still refused with its reason. `Set` on a switch is unchanged.

## [Desktop 0.2.90] - 2026-10-05

- **The courtesy notice governs every path that fires a macro by itself.** 0.2.89 covered a macro fired by a cue and left
  the inter-application path out, so a macro fired from another application over MIDI or OSC showed no notice while its
  NOTICE toggle read on. It now shows one, naming the transport and nothing else - no application name and no console
  identity - and the context menu's Fire Macro stays silent, because there the operator has just pressed it himself.

## [Desktop 0.2.89] - 2026-10-05

- **The timecode input rate applies itself, and a wrong one is no longer silent.** Changing the rate did nothing to a
  running stream, which is opened with the rate of that moment, so material recorded at 30 fps decoded at 25 and the cues
  ran late with nothing on screen to explain it. A rate change now reopens the input by itself, says what it is doing
  before it waits, and names the step if the reopen fails; the control has moved from the file-verification group to sit
  with the live input it governs. When an open input has decoded no position at all since it opened, the status line says
  so and names the rate in use.
- **A cue-fired macro shows its courtesy notice, and adding a cue at the end is one press.** The toggle beside `enable`
  was honoured only by one firing path; all of them now read it, and a cue says what it is - the macro fired by a cue and
  the cue's position. `Add cue at the end` appends one frame past the latest position in the list whatever the ordering,
  and adding does not move what the operator was looking at.

## [Desktop 0.2.88] - 2026-10-05

- **The cue-only macro reaches the door it was knocking on.** 0.2.87 made the editor leave the trigger genuinely
  empty for "only a cue fires it", and the macro was still refused: the same rule lived in a fourth place, and that
  one was the check the window runs before arming anything - the backend's preflight, which read an empty source,
  channel or parameter as "not configured". It now treats only a **partly** filled trigger as unfinished, matching
  the editor, the validator and the runtime's own "does not listen" report. Half a trigger is still refused.

## [Desktop 0.2.87] - 2026-10-05

- **The "only a cue fires it" choice can be made.** Choosing it left a seeded channel id in the trigger - on
  purpose, for a rule that refuses an empty id - so the trigger ended up half set, with an empty source beside a
  filled id, and the macro could not be enabled as cue-only at all. The operator's only way through was to give it
  a trigger, enable it and then clear the trigger while it was enabled. The empty entry now empties the id and the
  watch parameter too. Real sources still seed their id, and a half-set trigger is still refused.
- **Builds keep one signing identity, so updating no longer loses the microphone grant.** Every ad-hoc build was a
  new code identity to macOS, and the grant is stored against that identity: a fresh build no longer matched it and,
  because the row still said granted, macOS never asked again - leaving the application told there were no audio
  inputs, with no dialog and no error. The build now signs with one stable identity from a script in this
  repository, and fails loudly instead of falling back to ad-hoc.

## [Desktop 0.2.86] - 2026-10-05

- **Three CoreAudio commands no longer run on the main thread.** Listing the LTC inputs, reading the input state and
  opening a stream were synchronous, so they ran inside the webview's callback - and opening can wait ten seconds for a
  device, blocking every other command and every panel behind it. All three are asynchronous now, with a source contract
  that fails if any of them goes back.
- **A stream that dies is a fact.** A hot unplug printed one line to a log while the window said "Listening to …". The
  handler is now a named function a test can call, it clears the flag, records the reason and emits an event.
- **One control recovers without a restart.** "Reconnect the input" re-resolves the device by name, closes the old stream
  with a bounded wait and uses a generation counter so a retired stream's error cannot speak for the new one.
- **A refusal now says what to do.** A half-set trigger is still refused, but the message named the action target and
  never mentioned clearing the trigger - the one thing that fixes it. It names the remedy and points at the WHEN panel.

## [Desktop 0.2.85] - 2026-10-05

- **An action target over several channels writes to all of them.** A range like `9-12` muted only channel 9: the window
  showed "4 targets" and everything downstream kept one address, so the compiled step sent one packet. The step now carries
  the selector and resolves it into the list at compile time, writing one message per channel in the send, the ramp, the
  toggle and the read-back, with the packet count reporting what was sent. The suite could not have caught it - its resolver
  stand-in never expanded a range and no test typed one - and that stand-in is now faithful to the real resolver.

- **A macro can be built to be fired only by a timecode cue.** The trigger Source select's empty entry was "— Not
  configured —" and the editor refused to enable such a macro, so an operator who wanted a cue to be the only trigger had
  to invent one he did not want. It is now a named choice, and only a **partly** filled trigger is still refused. The
  engine is unchanged: it already skipped a macro with an empty trigger, and a cue already fires a macro by library
  position without consulting the trigger. Label, row, WHEN summary, recipe and inspector now agree.
- **The cue panel's Save button is the action, in colour.** It was neutral grey and the owner did not see it. Green when
  saved, amber with a slow pulse and a marker while there are unsaved changes - read from the same predicate that paints
  the window's own unsaved notice, so the two cannot disagree. With reduced motion there is no animation and the state is
  carried by colour, outline and marker.

## [Desktop 0.2.84] - 2026-10-05

- **24-bit LTC recordings are read.** The reader accepted 16-bit PCM, 8-bit PCM and 32-bit float and refused 24-bit PCM,
  the most common depth for a recording of timecode. The sign is extended before scaling, because without it every sample
  above half scale reads as a large negative number - a defect that does not fail, it decodes wrongly.
- **A test was pinning that hole**, and deceptively: it declared 24 bits in the header while writing 16-bit samples. It is
  replaced by one that writes real 24-bit samples and requires them to survive to within one step of the depth with their
  sign intact. The refusal it used to cover now tests 32-bit **PCM**, which this build genuinely does not read.

## [Desktop 0.2.83] - 2026-10-05

- **Every native panel is asked for on the main thread.** Choosing a file, importing or exporting a macro library, and the
  station backup's panels were all requested from a worker thread, where macOS cannot create a window: the panel never
  appeared, nothing errored, and the command waited out its timeout in silence. All five now use
  `run_on_main_thread`, which is why they failed together and now work together.
- **The LTC file panel opens on 29.97.** The reader kept a second, narrower list of frame rates and refused the one the
  selector offers before the panel could be asked for.
- **No audio button can stay silent.** The permission and refresh paths are bounded and say what they are doing before
  they wait, with a message naming the setting to check.

## [Desktop 0.2.82] - 2026-10-05

- **The LTC file panel opens on every rate the selector offers.** Choosing 29.97 and pressing the button did nothing at
  all, because the file reader kept a second, narrower list of rates and refused it before the panel could be shown. The
  selector and the reader now share one parser.
- **No audio button can stay silent.** Refresh and Ask macOS for microphone access touched CoreAudio through a promise
  that could neither resolve nor reject, so the line stayed empty and the section looked dead while the rest of the
  window kept working. Both waits are bounded and both say what they are doing before they wait.

## [Desktop 0.2.81] - 2026-10-05

- **A button that cannot answer no longer stays silent.** The Timecode section's *Refresh* and *Ask macOS for microphone
  access* could stop doing anything while the rest of the window kept working: the call never came back, and a promise
  that neither resolves nor rejects runs neither the code after it nor its error path. Both CoreAudio paths are now
  bounded and both say what they are doing **before** they wait, so a permission macOS will not ask for again can no
  longer leave an operator pressing a button that answers nothing.

## [Desktop 0.2.80] - 2026-10-05

- **The cue panel arrives in the clock window**: a chevron expands it, the window grows and remembers its height, and
  when the frame refuses to grow the panel says so and names the reason and the display's ceiling.
- **Cues are listed in timecode order by default**, with a selector for manual or creation order, and the choice is
  saved **in the cue file** so it travels with the show.
- **A cue's time is editable** in four fields with a nudge of one or ten frames; editing is local and saving is explicit,
  because saving re-arms the list, and the button says so. The readout and the countdown move continuously.
- **A cue can carry the operator's own name**, separate from the macro's note, and a **number** that is a decimal stored
  canonically: between 5 and 6 an operator puts 5.5 and nothing else moves. The number lives inside the cue and
  renumbering cannot break a firing from outside, because what an outside system addresses is the cue's id.
- **Groups, search, lock, duplicate, undo**, a **"what just happened"** line and warnings ten and five seconds before the
  next cue. Broken cues are marked instead of failing quietly.
- **A cue can no longer be consumed without its macro running, silently**: the engine records what it decided before
  delivering anything and keeps it until the window confirms what happened; a refused hand-over is retried and the counts
  are visible, with a warning colour when something is unconfirmed or lost.
- **Cues fire after restarting the application**, which they did not: the saved list is installed at startup.
- **A corrupt cue list is repaired from its own recovery copy**, and the list can be **exported and imported**, with
  import validating the file before replacing anything.
- **A station backup carries the cue list**, where restoring a show used to leave the cues behind.
- The LTC input accepts **29.97** with drop-frame numbering, and the interface no longer promises "LTC from a file": a
  file is checked, never played.
- The verification gate can no longer run twice at once on one machine, which was manufacturing failures that belonged
  to nobody; two flaky test failures were diagnosed to their real causes.

## [Desktop 0.2.79] - 2026-10-05

- **The cue panel arrives in the clock window**: a chevron expands it, the window grows and remembers its size, and the
  list appears.
- **Cues are listed in timecode order by default**, with a selector for timecode, manual or creation order. The choice
  is saved **in the cue file**, so it travels with the show to another machine; `localStorage` is only a fallback, and
  all three places that save the list send it, because the field is optional on read and omitting it on write would
  have replaced the operator's choice with the default.
- **A cue's time can be edited**: four fields, hours to frames, with nudge buttons of one and ten frames. Editing is
  local and saving is explicit, because saving re-arms the cue list; the button says so and unsaved changes are marked.
- **The readout and the countdown move continuously.** They were derived from a 250 ms poll and advanced in quarters of
  a second; they are now interpolated between snapshots.
- **The delivery line is visible with zeros while timecode runs**, instead of hiding until the first cue.
- A window opened late now marks what was already resolved (`spent_ids`), names the next cue (`next_cue_id`) and shows
  where the list was armed (`armed_at`).
- Settings → Timecode gets the same order selector, the same rows, and the `note` it was saving but never showing.
- Two mutations, each with the whole gate: reverting the SMPTE order and making the nudge save both fail, naming the
  contract.
- Recorded, not resolved: the window growth is only exercised against a simulated frame; the cue row is implemented in
  both windows because the packaged interface has no bundler; a cue has no separate, editable name; and adding a cue
  without timecode is refused rather than placed at midnight.

## [Desktop 0.2.78] - 2026-10-04

- **A cue can no longer be lost, or consumed, in silence.** The engine marks a cue spent when the timecode crosses it,
  but the firing order travelled through a bounded channel that could drop it and a listener registered after an
  `await`: a dropped or unheard event was a cue consumed and a macro never run. The engine now records the event with a
  receipt **before** delivering anything and keeps it until the window confirms what it did; the channel is a doorbell
  with no data, so a refused hand-over is retried. Fired, delivered, blocked, nothing, failed, unconfirmed, retried and
  lost are visible in the clock and in Settings, in a warning colour when something is missing.
- **The cue list is installed into the engine at startup.** It was only installed on save or edit, so restarting the
  application left the engine with no cues: nothing fired, and nothing said why.
- **Four mutations prove the contracts** in `scripts/mutation-check-cues-rust.mjs`, which mutates `timecode.rs` and
  `main.rs` through byte copies rather than git, so it is safe on a dirty tree.
- Recorded, not fixed: delivery is at-least-once (a reload between firing and confirming can repeat a macro); a station
  backup does not carry the cue list; the cue list's `.bak` is never re-read; and importing a macro library can
  re-point a cue at another macro unnoticed.

## [Desktop 0.2.77] - 2026-10-04

- **Asking macOS for audio access now reports what the system did.** The probe's answer was written to the status line
  and immediately overwritten by the refresh that follows it, so the one line that explains a permission prompt, a
  refusal or a device count was never readable — a button that looked like it did nothing.
- **A refusal keeps its reason.** `addInterAppPeer` replaced the backend's explanation with a generic sentence, so a
  refusal that named something became a refusal that named nothing.
- **The window no longer steals focus from a control that has just opened.** The frame queued by a field's
  `pointerup` gave the focus back to the field unconditionally, so when it landed after the inline macro rename editor
  had opened, the editor blurred and removed itself. The guard runs **inside** the frame — outside it the field still
  holds the focus at `pointerup` and the guard would never fire — and it takes the focus back only when nothing else has
  claimed it. The suite that caught it was being called flaky for two days of this session; it was right.
- **The interface harness can now simulate failures.** Its stub could only succeed, which is why a message that erased
  itself passed: it asserted that a click reached the backend, not the sentence the operator reads. Six contracts now
  assert the visible text for a denied permission, a granted one, an unlistable device list, an empty one and a refused
  application, and each was checked by reintroducing its defect. One of them, honestly, does not catch the original
  defect and says so.
- Found and left open with its evidence: the startup path that reads the inter-application settings writes its error and
  overwrites it with the default state in the next call.

## [Desktop 0.2.76] - 2026-10-04

- **The Rearm hint described a rule the detector never had** (a drop below the threshold) and now describes the one it
  has: a margin above the lowest value seen since the trigger. The contract asserts the ideas that must be present and
  the phrases that must not, not the sentence.
- **The six timing fields carry the runtime's clamps.** Rearm offered −144..12 dB against a real clamp of 0.1..24, so
  the editor accepted a value the runtime discards and refused part of the range it accepts. An older or imported macro
  holding an out-of-range value is normalised into a **copy** on the way into the editor — the backend clamps rather
  than refuses — and still saves, with a log line and a header note; manual entry outside the range is still refused.
- **Two permanent timers stop while their window is hidden** (the backend-status poll and the Meter Bridge's link
  repaint), using the guard the right-column cards and the clock window already had, with one refresh on the way back.
- **Every persistent file is read with a size limit and restored atomically**, and the directory is flushed after the
  rename, so a crash mid-write cannot leave a truncated library or settings file.
- **The unlock helper verifies the signature and the executable hash** of the copy it is about to open, baked in from
  the build, and refuses — naming the path and touching nothing — when they do not match. `verify-install.sh` runs the
  shipped helper in a sandbox against synthetic bundles, including one that copies the identifier and the version but
  carries another binary.
- **The window has a Content-Security-Policy** where it had none, with a contract that fails if it is removed, and the
  OSC peer list is documented as a filter of addresses rather than authentication.
- **The guide no longer says a run with unconfirmed writes counts as completed** — it is counted and announced
  separately — and the trigger chapter agrees with the editor.

## [Desktop 0.2.75] - 2026-10-04

- **The audio device list can no longer be a dead end.** macOS asks for the microphone only when a stream starts, and
  until it has been granted an application can be told there are **no** input devices — so there is nothing to choose
  and nothing ever asks. The default input device is now always offered, a new **Ask macOS for access** button opens
  it for a moment to trigger the prompt, and the empty list says what is happening and what to press. It also says
  that timecode needs an interface or a virtual device, because the built-in microphone hears the room.

## [Desktop 0.2.74] - 2026-10-04

- **The disabled "Add application…" placeholder is gone**, and with it the settings contract that demanded it stay
  disabled and keep saying the feature had not arrived. It sat exactly where the operator looks for that button and
  it is the one the owner pressed. The editable list, its working button and a MIDI/OSC selector per row are where it
  was.
- **The clock follows the application's theme** (it was light grey in a dark window), **shows dimmed placeholders
  while it waits** (an empty well reads as no timer) and **fits the 420 x 200 window it opens in**, where the readout
  used to overflow and push the state, the next cue and the counters out of sight.
- **Every one of those defects is now put back on purpose** by `scripts/mutation-check-interapp.mjs`, which demands
  a failing test that names it: five of five are caught. And `test-desktop-interapp-smoke-browser.mjs`, which presses
  every control of every new surface and checks the click reached the backend, is in the gate.

## [Desktop 0.2.73] - 2026-10-04

- **Settings… on the two new cards did nothing.** The handler called a function that was not in its scope, behind a
  `typeof` guard that swallowed the failure. It now calls the global the toolbar's own Properties button uses, falls
  back to clicking that button, and says so in the window if neither works. The settings contract **clicks both
  buttons** and asserts the dialog opens on the right page — it only asserted they existed, which is how a dead
  button passed a green gate.
- **The clock window looked broken**: with no timecode it drew `--:--:--:--` at up to 92 px, which reads as a failed
  display, and the position overflowed the 420 x 200 window it opens in, pushing the state, the next cue and the
  counters out of sight. The readout is empty when nothing has arrived (the line underneath says so), it is sized to
  the window and grows with it, and the clock contract now measures that nothing overflows and that every row is
  inside the window.

## [Desktop 0.2.72] - 2026-10-04

- **The audio input's entitlement now reaches the application.** 0.2.71 declared it in the repository and the build
  threw it away: `build-dist.sh` re-signs the bundle and did not pass `--entitlements`, so the installed 0.2.71
  carries **no entitlements at all** and the audio input could list devices and never open one. The signing call
  passes the file now, and `verify-install.sh` **measures** `com.apple.security.device.audio-input` in the signature
  instead of trusting the declaration — a check that existed nowhere before, which is exactly how this shipped.
- Everything 0.2.71 carried, including the fixes the owner reported from testing it: *Add an application*, the clock
  as a popup, the tab names, the two cards in the right-hand column, the bindings block in the macro editor, and the
  instructions on both pages plus guide chapters 12 and 13.

The honest note this version adds: a green gate proves the contracts that were written, not that the feature works.
The entitlement was declared, the gate checked the files, and the application still could not record.

## [Desktop 0.2.71] - 2026-10-04

The owner tested 0.2.70 and reported what did not work. All of it is fixed, and the feature is where it belongs.

- **Four fixes to real defects.** *Add an application* was refused every time by the backend's own rule (a peer needs
  a name) and now creates a row with a starting name; the **audio input** needed the microphone **entitlement** as
  well as the usage description, and only the description was there — which is why devices listed and then nothing
  opened; **Refresh** says what it asked and what came back, instead of leaving an operator to guess; and
  `list_inputs` no longer turns "the audio subsystem refused" into "there are no inputs".
- **The clock is popupable**: a **Clock** button in the toolbar beside **Meters**, and the same **⧉ Popout** on the
  new Timecode card.
- **The feature is visible where the work happens**: two cards in the right-hand column — **Timecode (MTC, LTC,
  SMPTE)** and **MIDI, Inter-app OSC** — fed by one visible-only poll that also drives the status readout.
- **MIDI and timecode are in the macro editor**: a block under the trigger signal lists the bindings that fire the
  macro on screen, and makes one — a MIDI binding to **Learn** over, or a timecode cue at the position the show is at
  now.
- **The tabs are named as asked**: *MIDI, Inter-app OSC* and *Timecode (MTC, LTC, SMPTE)*, in the page and in every
  refusal that names them.
- **Instructions**: a folded *How to use this page* on each page, and two new guide chapters — **12 · MIDI and other
  applications** and **13 · Timecode (MTC, LTC, SMPTE)**.

Still unproved, and said in the release note: the audio input's live path, the Mixing Station acceptance pass, and
RTP-MIDI.

## [Desktop 0.2.70] - 2026-10-03

A feature release, and all of it **off by default**: with nothing switched on, this version behaves exactly like
0.2.69, which the five-minute soak and the full gate were run to confirm.

- **Other applications, over MIDI.** Virtual ports that exist only while the feature is on, a monitor, sending with
  a closed and validated message model, All Sound Off and All Notes Off on every channel from PANIC STOP, a macro
  step that sends MIDI, triggers with **Learn**, bindings that fire macros through the window's existing guarded
  path, and conditions on another application's values with staleness.
- **Other applications, over OSC.** A listener that counts and can fire macros — on this machine by default, with
  the network as an explicit choice that is refused without at least one application listed; sending with the
  address rule the research corrected; triggers with OSC patterns; and conditions on the matched message's own
  arguments.
- **Timecode.** MTC arrives on the MIDI port, so it needs no new device and no new permission; a cue engine that
  fires a cue once on a forward crossing, names the cues a **seek** skipped and re-arms them when the show goes
  back; LTC from a **file** and from an **audio input**, with its own codec proved by generating LTC in its tests;
  an offset applied to every source; the received timecode passed on as MTC; a clock window for a second screen and
  a compact readout in the status area.
- **A review found eight defects in the work, and all eight are fixed.** Two of them no test in this tree could
  have caught: macOS **terminates** a process that records audio without a usage description in its bundle — the
  feature worked in development and would have killed the installed application the first time an operator pressed
  Listen — and the master switch refused to start anything new but **did not stop what was already running**, so a
  microphone left recording kept recording. The rest include an OSC allow-list that was only applied when the
  listener opened, a disabled application that still fenced it, a readout that named every transport as MTC, and a
  cue engine that could have fired a burst of cues when the source changed.
- **Two gate contracts came out of that review**: if the audio input stays, the microphone usage description has to
  be declared; and every command the window calls has to be registered in the backend, which is the quietest way a
  button can do nothing.

**Not verified in this build, and worth saying rather than discovering**: the audio input's live path has never seen
a real signal; the microphone permission has never been asked for at runtime; the Mixing Station acceptance pass
(`docs/MIDI_ACCEPTANCE_STEPS.md`) has not been run; RTP-MIDI has been researched and not connected; and no real OSC
sender has been pointed at the listener. The listener stays on this machine unless an operator deliberately changes
it, and the research note on that screen says what the network choice costs.

## [Desktop 0.2.69] - 2026-10-02

- **The unblock helper no longer refuses to work when the application is open.** It exited 1 if a copy was
  running — which is the normal state while an operator tests the build they were just handed — and the disk
  image shipped that refusal, so the command that exists to restore the icon could decline to. It patches the
  bundle now and says that the open window keeps the old icon until it is relaunched. The install path had the
  same problem from the other side: it swallowed that refusal, so a release that was fine reported
  `installed icon FAIL`.

Everything else is 0.2.68: the consolidated changelog and this version's release note inside the disk image
and the ZIP, the unlock helper under its English name, and the custom icon written into **every** copy of the
application — including the one inside the image, which is what made an application run straight from the DMG
show macOS 26's dark tile.

## [Desktop 0.2.68] - 2026-10-02

- **The application's icon is correct on every copy, including the one inside the disk image.** The installed
  copy was never the problem; the copy in the image was: `cp -R` onto a disk image keeps the icon's flag but
  not the picture in `Icon\r`'s resource fork, and the `xattr -cr` the build runs so the signature verifies
  removes both — so an application run straight from the mounted image showed macOS 26's dark tile until it
  was installed and unblocked. The build writes the icon into the image's copy and the ZIP's and fails if the
  picture is missing, and the release verification checks both and asks the system what it actually draws.
- **The unlock helper is English**: `Unblock WING CONTROLLER.command`, in the image, the ZIP and the
  instructions, with a test that refuses to let the old name come back into anything that ships.
- **The changelog ships with the build**: the consolidated `CHANGELOG.md` and this version's
  `RELEASE NOTES <version>.md` are inside the disk image and the ZIP, and the release verification fails when
  either is missing.
- **`AGENTS.md` now lists what every release ships**, so none of it depends on somebody remembering.

## [Desktop 0.2.67] - 2026-10-02

Phases 1, 2 and 4 of the plan for the definitive version. Phase 3 (test infrastructure) and the hardware and
visual passes are deferred on purpose, with the reasons written in
`docs/DEFINITIVE_VERSION_PLAN_2026-10-02.md`.

- **The meter link is reconnected instead of being left dead**, and the seven places that discarded a
  watchlist update when the lock was poisoned now recover it: the operator's change used to disappear with no
  trace and no error, behind a badge that still said Live.
- **Fire Macro is refused while Live Safe Mode is on**, as the documents always promised: the window blocks
  it like the twelve other actions it already covered. The backend's own padlock is documented as never armed
  in a shipped build, with the decision and its reason beside the code — arming it would refuse a Shoot, a
  Fire Macro and a raw message, and a raw message is how a manual toggle reaches the console.
- **Live Safe Mode has the first test it has ever had**, and in both directions: with the lock on the click
  never reaches the backend (an IPC counter stays at zero) and the refusal is visible and logged with its
  action; with the lock off, the same click does reach it.
- **The gate can no longer book a run that did not happen as PASS**: every browser suite ends with a seal the
  gate demands, a machine without a browser fails instead of silently skipping the whole UI layer, and a
  passing step's own "skipped" lines are printed beside its PASS.
- **The Maillot path audit demands its reviewed list**: the 88 addresses whose family prefix differs are
  reviewed one by one, and a **new** one fails instead of hiding in a tolerated bucket.
- **`verify-install.sh` can no longer print "ALL CHECKS PASSED" having checked nothing**, it reports the
  volumes it had to detach, and `./scripts/release.sh <version>` runs the build, the checksums and the
  verification in one command so they cannot come apart.
- **Less dead code and fewer lies in the tests**: the comparisons that skipped themselves, the tolerances
  that re-armed on a total regression, the suite that destroyed a stored zoom, the parked-tree test now
  saying what it is, and the missing bound on the stress diagnostic.

## [Desktop 0.2.66] - 2026-10-02

- **A live session is no longer told it stopped.** The backend recorded a stream's terminal status without
  checking which session it came from, so reconnecting during a live session (saving the macro library does
  it) left the app believing there was no session — the badge said Live and the meters flowed while Shoot,
  Test Action, Fire Macro and the raw send were all refused with "Not connected (stopped)". Each status now
  carries the session that emitted it, and a superseded stream's last words are ignored.
- **A dead meter link is re-established**, instead of the app saying "asking the console again" while
  nothing was asked: the meter TCP connection is reconnected when it is gone, a socket whose write fails is
  dropped, and the request only counts as sent when it left. Without this, every meter-triggered macro was
  dead for the rest of the session behind a Live badge.
- **PANIC STOP runs both of its halves** even if the first one fails. It used to return early on a poisoned
  lock, before cancelling the Shoot in flight, so a run could keep writing after the emergency stop.
- **A quick save no longer releases a native-panel turn it never took** (a fabricated guard let a second
  file panel open over the first one, which is the hang the guard exists to prevent).
- **The verification gate can no longer book a run that did not happen as PASS.** Eighteen of twenty-two
  browser suites printed "skipped" and exited 0 when Chrome was wedged or absent; the gate demands a
  completion seal now, a missing browser fails instead of quietly skipping the whole UI layer, and a
  passing step's own "skipped"/"not landed" lines are printed beside its PASS instead of being discarded.
  A failure shows its first lines and keeps the full output.
- **The strict Maillot audit refuses to pass on an empty inspection**, prints all of its tolerated
  mismatches (it printed 40 of 88), and the four Rust tests that passed by returning early without their
  `LIVE_WING_*` variable are ignored with the reason named.
- **Stealth Dark stops glaring.** `--field`, `--win-title-bg`, `--surface`, `--line`, `--text`, `--accent`,
  `--maroon` and `--ink-muted` were used and never defined, so their light fallbacks survived into the dark
  theme: text fields were white, the About product name was navy on dark (1.06:1) and `UNSAVED` was maroon.
  The Meter Bridge had the same problem with its own names.
- **The Inspector no longer throws on a real action step**: `modeLabel()` was called and never defined, so
  hovering a step produced a `ReferenceError` and no hint.
- **The Meter Bridge stops claiming things the window is not doing**: its pin button and remembered
  preference only move once the window has actually been pinned, and the dock no longer marks the bridge
  open when the browser refused to open it. The console address has one writer with one rule for empty, so
  clearing it no longer restores the old address on the next launch. The meter Size preset follows the Zoom.
- **The window background is yours to choose**: follow the theme, the light gradient, the dark gradient or
  a flat colour, from Settings and from the background's own right-click menu, in both windows.
- **Dead code out**: `setTargetSelection`, the `data-toggle-target` / `data-recipe` / `data-scope-row`
  attributes nothing read, two `||` fallbacks for element ids that never existed, an unused constant, a
  truncated send-id cast and the test-only mock encoder's inverted FX scale.
## [Desktop 0.2.65] - 2026-10-02

- **The credits are a tribute now, and each of them has his own line and his own website.** The About tab,
  the Meter Bridge and the shipped guide all said what these two did in the register of a citation — and
  one of them praised a person and then talked about a product and about this application following an
  example. They now say what each of them did, what this application owes them, and that without it there
  would be no application: Patrick-Gilles Maillot documented these consoles and made it public
  (x32ram.com); David Schumann has kept Mixing Station the control surface the people at the desk deserve
  (mixingstation.app).
- **A quiet meter stream is no longer read as a dead link.** If no meter frames arrived within 3.5 s the
  stream tore down the whole session, even while the control surface was answering identity and OSC state
  perfectly — so the window said "disconnected" at a live console and every console write was then refused
  (correctly: the application had just declared there was no session). The owner had to disconnect and
  reconnect to get his macro back. The session now survives a meter stall while anything is still arriving,
  says so and asks the console for the meters again; only total silence ends it. The rule is a pure
  function with its own test.
- **The custom icon invalidates the icon caches when it is applied.** The artwork and the resource fork
  were both correct while the Dock kept showing the system's tile: the Dock and LaunchServices cache an
  icon per bundle path and do not re-read it because the bundle changed. `set-custom-icon.sh` now
  re-registers the bundle (`lsregister -f`) and restarts the Dock and the Finder, and says plainly that an
  application which was running when the icon was applied must be quit and opened again.
- **The Settings window can be reached from the other window again.** The `storage` listener (which lives
  with the floating-window controls, outside the Settings closure) called a function defined *inside* that
  closure, so a theme change from the Meter Bridge threw a `ReferenceError` and the Settings boxes kept the
  old state. The closure now hands its own function to a top-level holder, the pattern this project had
  already written down for the peak-hold controls. The settings suite also reports page exceptions by name
  instead of a bare "Uncaught".
- **The release checks tell the truth about volumes.** Three stale mounted images (0.2.37, 0.2.40 and the
  previous run's) made a good release look red: `verify-install.sh` now starts by detaching whatever an
  earlier run left mounted, naming it, and `build-dist.sh` says so when it cannot detach instead of
  swallowing the failure of all three attempts.
## [Desktop 0.2.64] - 2026-10-01

- **Nothing is sent to a console the application is not connected to.** The gate every writing command
  goes through only knew about Live Safe Mode, so Test Action and the raw send still reached a console
  while the window said "disconnected" — the operator reads the badge, and the desk does what it is told.
  `refuse_console_write` now requires a **live session** (`connecting` or `live`) first, and then applies
  Live Safe Mode; idle, stopped, failed and disconnected refuse, name the state they saw and send nothing.
- **Fire a whole macro from its row.** Right-click a macro → **Fire Macro (run all its steps)**: the new
  `fire_macro` command runs the macro's enabled steps through the same dispatcher a trigger uses, so what
  is fired is what the show fires, and the run reports each step's outcome like a Shoot. It is offered
  before the unsaved-draft question, because firing does not touch the editor — the editor actions still
  ask first.
- **The application's icon keeps its image.** macOS 26 forces a legacy `.icns` into the system squircle;
  the way out is a *custom* icon (`Icon\r` plus kHasCustomIcon in `com.apple.FinderInfo`), and this
  machine's `NSWorkspace -setIcon:forFile:options:` sets that flag and creates the marker while writing
  **no image** — Finder then falls back to the bundle's icon and the dark tile returns, while the project's
  own check reported "custom icon present". `scripts/write-custom-icon.py` writes the resource fork itself,
  the check now demands the image rather than the flag, and the format is round-tripped by a test.
- **An instrument for "why doesn't my macro fire?"** (`LIVE_WING_MACRO_REPRO=1`, hardware-gated): it
  compiles a macro through the application's own library path, prints the meter descriptor it asks the
  console for and the trigger it builds, subscribes like the stream does and reports the values it sees
  against the threshold. It is how the question was answered on the real console, and it took far longer
  than it should have.
## [Desktop 0.2.63] - 2026-10-01

- **A toggle step no longer offers a value it does not send.** The value chips ("ON (muted) / OFF
  (unmuted)") are the value a step writes, and a toggle writes none: it sends `-1` and the console flips
  the parameter. The toggle path hid them, and a renderer that runs afterwards — which only knew about
  closed lists — showed them again, so the operator saw two buttons for a value that never leaves the app
  and, with nothing in that step reading the parameter, they never changed. The hint beside them described
  the pre-0.2.61 behaviour too ("reads the current state and sends the opposite"); it now says what
  happens: one packet carrying `-1`, nothing read first, no waiting for the paced queue, reported as sent
  rather than confirmed, and not idempotent. The inspector's own description of the mode selector and the
  shipped guide were saying the same outdated thing and now agree with the code.
- **Installing keeps the application's icon.** `xattr -cr` (which the install needs: the bundle arrives
  quarantined) also deletes `com.apple.FinderInfo`, and a custom icon lives there — so macOS 26 drew its
  dark tile behind the artwork instead of the transparent marble W. `desktop/build-dist.sh` re-applies it
  after the same command; `scripts/verify-install.sh --install` did not. It does now, and the release
  check **fails** when the installed copy has lost it, which is how it was found.
- **What the recent behaviour changes left behind, swept out.** Two constructors in `wing-core` that
  nothing called (`parameter`, `state_parameter`) are gone and `cargo build --workspace` is warning-free;
  a doubled, self-contradicting doc comment went with them. The template buttons were removed from the
  window in an earlier release, but their whole apparatus was still in the file — six CSS rules, a loop
  that queried buttons which do not exist, `applyTemplate`, `inferTemplate`, a dead helper and a variable
  written in eight places and read only by that loop. All gone. Every one of the 231 interactive elements
  in the window is referenced by script, and every health row is a live counter.
- **The shipped guide, corrected twice**: chapter 11 still said a toggle reads first and fails without an
  answer, and chapter 5 still said a meter the console does not send is drawn as `-inf`, "indistinguishable
  from real silence" — which stopped being true when the windows learned to show `–` with an empty bar for
  a meter that has not reported.

## [Desktop 0.2.62] - 2026-10-01

- **A second launch cannot start a second application.** Forcing one (`open -n`, a double launch while
  the first is still starting, or the copy on a mounted disk image beside the installed one) used to
  start a second application: two streams on one desk, two windows writing the same library and show
  files (last one wins) and two runtimes able to fire the same macro — for a **toggle**, two flips and a
  parameter that ends exactly where it started. The second launch now focuses the window already open and
  exits (`tauri-plugin-single-instance`, pinned to `=2.4.0`: 2.5.x requires tauri 2.12 and would have
  upgraded the whole windowing stack a week before a show).
- **A meter with no value is no longer painted as silence.** A meter the frame did not carry was drawn at
  the bottom of the scale — `-inf dB`, the bar at rest, and the peak hold remembered a peak for it — so
  "the console reports silence" and "this window has no value" were the same display. It now says `–`
  with an empty bar and `PK --` and remembers nothing, while a value the console really reported at the
  bottom of the scale is still `-inf`. Both windows, including their templates before the first frame.
- **The emergency stop is tested as one action.** PANIC STOP stops the stream *and* cancels a Shoot in
  flight; each half had tests, the command that has to do both did not. It now has one, and it proves the
  run slot is empty afterwards.
- **`scripts/verify-install.sh <version>`** — the release verification as PASS/FAIL lines: the artefacts
  and their hashes, the application inside the DMG (version, signature, its instructions), that no volume
  is left mounted, and with `--install` the installed copy and its single instance. Its first run caught
  that the installed 0.2.61 predates the single-instance fix.
- **`scripts/wing-soak-windows.mjs`**, **`scripts/wing-verify-single-instance.mjs`**,
  **`scripts/wing-burst-hardware.sh`** and the `#[ignore]`d runtime soak — the instruments this audit
  measured with, kept so the next one does not rebuild them.
- **`docs/SHOW_MACHINE_RUNBOOK.md`**, **`docs/SHOW_READINESS_PLAN_2026-09-30.md`** and
  **`docs/SHOW_READINESS_RESULTS_2026-09-30.md`** — the show machine in order, and the audit phase by
  phase with its numbers and the one item it deliberately left open.
- **The DMG and ZIP instructions now say it outright:** install the application into `/Applications` and
  do not run it from the disk image, because macOS can wedge an app that runs from a mounted volume.
- **Measured, and on the record**: toggle 0.2 ms, set 34.7 ms, a 300 ms fade 403 ms, a read-back the desk
  never answers 183.8 ms; a 20-minute soak of both windows at 48 meters × 60 frames/s and 300 OSC traces/s
  with a flat heap, DOM and frame interval; sixteen simultaneous macros dispatching frame → run in
  p50 1.1 ms / p95 2.9 ms with every refusal counted.

## [Desktop 0.2.61] - 2026-09-30

- **The toggle is the console's own flip.** One packet carrying `-1` (the protocol's *Special case:
  Toggle*), so nothing is read before it: no round trip, no 400 ms failure when the desk is slow to
  answer a read, and no race when two presses arrive together (the desk's flip is atomic, where two
  read-and-write presses could both read the same value and flip once). That packet also skips the paced
  queue, so a toggle is not delayed behind a fade. The console decides the result, so the step is
  reported as sent, not as confirmed; the read-and-invert code remains as a tested fallback.

## [Desktop 0.2.60] - 2026-09-30

- **A mute is instant again.** The Shoot, a raw send and every strip/FX model read began with a
  discovery exchange (`WING?` on UDP 2222) before doing their work, which waits 650 ms per network
  adapter and once more on the system default when none answers: measured here, **1.302 s per click**
  against a desk that does not answer discovery promptly, and **0.6 ms** with the route remembered. The
  route (the local address the desk answered on and the model it announced) is now remembered per
  console and per adapter choice, filled in by the live session at connect, reused by every action, and
  forgotten when a send fails or a model read comes back wholly silent. Each action still binds its own
  socket to that address, so two commands cannot take each other's replies.
- **The window no longer freezes while the app looks for the desk.** `send_osc_message` and the Discover
  sweep were declared without `(async)`, which in Tauri runs them on the main thread; they now run on
  the threadpool, like the commands that already did. The Session Log line of a Shoot also ends with
  `elapsed=<n>ms`, measured from the click to the run's answer, so the next slow action can be reported
  as a number.

## [Desktop 0.2.59] - 2026-09-27

- **A run says which step failed.** Every step of a run carries its own state — `confirmed`,
  `unconfirmed`, `not_verifiable`, `interrupted`, `not_attempted` — and the step the console did not
  confirm is marked on its own row with the run's word for it, while a stop the operator asked for
  leaves no such mark and a write the run never sent is never shown as one that failed. The index a
  report names is the operator's row, not the compiled position, so a disabled step cannot shift it. The
  log line of an ignored write names the step it came from too.
- **Exports and imports ask where the file goes.** *Export/Import Show JSON* and the macro library's own
  export/import open the system's Save and Open panels with the station backup's guard and 25-second
  bound; a closed panel changes nothing and is not reported as a failure, and only a panel that cannot be
  shown falls back to a `WING CONTROLLER` folder inside the system's Downloads folder. No path is
  assembled from the home directory any more, and an export leaves no `.bak` beside the operator's file.
- **The FX parameter list learns the slot's model from the desk** (`read_fx_models`): one round trip per
  slot, once per visit to the category, never per keystroke; an answer fills an empty field only, `NONE`
  says the slot is empty, a silent slot leaves the manual field, and the line under the field says what
  the console reported when it is not what the field holds.
- **The workstation window remembers its box** (`wing_work_geom`): the size when it is sane, the place
  only when its titlebar still lands on a screen the session reports, otherwise the box is dropped and
  the window opens centred. Machine state, never exported, forgotten by *Re-centre windows*.
- **The browser-mode simulation library stays on the machine**: it is application state, so it is no
  longer carried by the macros section of a station backup and a loaded file cannot write it back.
- **Polish**: the three *Probe* diagnostics say in the panel that their answers are simulated (only
  *Verify Targets* reads a desk, and says so), the collapse chevrons and seven small labels are 9 px
  instead of 8 and 8.5 px, and the FX read keeps the last 32 slot lists of a visit so nothing in the
  panel grows for a session. The guide's claims about `~/Desktop` exports and about the simulation
  library travelling were corrected and the published guide rebuilt.

## [Desktop 0.2.58] - 2026-09-27

- **The backend's state is managed, and the windows ask for it.** `app.manage(BackendState)` plus a new
  `get_stream_state()` answer what the session really is — state, message, `sessionActive`, `sessionId`,
  the desk's model family, the live-safe mode, `health` (null unless a session is live), the meter
  sources, whether the bridge is open and the last alert. Both windows ask at start-up and after a reload
  and paint that answer instead of reconstructing the session from events they may have missed, which is
  what made an OFFLINE badge on a live stream, a frozen health grid, a bridge line contradicting itself
  and a HUD alert shown by nobody possible. Meter frames carry the session they belong to, so a window
  cannot paint part of the previous stream in the new one.
- **The console's own answers are in the code.** The monitor level's write is offered only where the desk
  takes it (the full-size console and the Rack refuse every form — measured — and only the Compact keeps
  it), an FX slot that holds no model says so instead of looking silent, the safes node keeps its
  hardware-confirmed spelling, and the measured meter group lengths of the family are recorded.
  `scripts/wing-hardware-checks.mjs` asks any console the same questions in one command.
- **The macro list stops rebuilding under the operator's hands**: a runtime event patches the affected row
  in place (the same DOM node, the scroll held, an inline rename left alone) instead of rebuilding the
  library, and the counters follow the macro's own identity rather than its position, so reordering or
  deleting can no longer show another macro's numbers.
- **The meter bridge says what its link is doing**: `● LIVE LISTENING`, `● DROPPED · RECONNECTING n`,
  `● CONNECTING · RETRY n`, `● CANNOT REACH CONSOLE` or `● CONNECTION LOST`, with the wait since the drop
  and the attempt number. A window saved on a screen that is gone comes back on a screen that exists.
- **Polish**: informative confirmations lost their redundant second button, the library's magnifier is a
  real icon, the dither pattern cache is bounded, "Hits" reads "evaluations", the bridge and the dock no
  longer share a matrix position key, and the disabled look exists in both themes.

## [Desktop 0.2.57] - 2026-09-27

- **For every WING, not for the one on the bench.** The console names its model when it answers
  discovery, and the app now reads it: meter groups are sized from that model (a full-size console
  sends 8 local input values where the decoder assumed 24, which shifted every following group in the
  datagram; with no model announced the length is derived from the frame and the frame is truncated
  rather than shifted), `/cfg/mon/<n>/$lvl` is a target where the surface has no control potentiometer
  and a watch on the full-size console (footnote 13), and the category id bounds, the GPI/O count and
  the local input and output counts follow the same rule.
- **The long category lists read in two levels**, and the meter card's own list with them: Local,
  Stage box, Card & USB, Internal and Bus meters inside "Sources", Local, Stage box and Card & USB
  inside "Outputs", each run headed under the group's own heading while the native `<optgroup>` keeps
  the coarse group alone.
- **The Shoot is cancellable while it runs**, and a write the console did not confirm is shown as
  `unconfirmed` in the run's result, the macro rows and the terminal instead of counting as completed.
- **The FX parameters come from the model the slot runs**, one `FX · <MODEL>` group per model, and that
  model can now be read from the console (`/fx/<slot>/mdl`, bounded to the slots in use) instead of
  being typed.
- **The fallback catalogue is complete**: the window was missing fifteen of the backend's sixty
  category rows (the eleven output families, mute groups, user controls, monitor meters and RTA bands),
  so until `target_catalog` answered the lists offered less than the console can address. A new static
  test compares the two catalogues field by field.
- **Two unbounded growths closed**: the per-meter state (history, VU, peak hold) is pruned to what the
  console will still send, and a stream faster than the window can paint no longer builds a queue — the
  newest frame is painted once per animation frame with the loudest value of the skipped ones merged in.
  The OSC terminal's event stream is capped at 300 traces/s and what the cap drops is announced as a
  marked row rather than silently lost.
- **The freeze reported while reading the dropdowns is a system-level wedge**, documented with the
  system's own hang reports (`docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md`); the same wedge was
  reproduced in headless Chrome here, and `verify-all.sh` now starts and restarts the browser itself so
  its death can no longer be reported as a missing contract.
- David Schumann joins the Special Thanks, for Mixing Station.

## [Desktop 0.2.56] - 2026-09-27

Build `20260927.1`.

- **The live-safety and data-integrity items the master plan still had open.** Live Safe Mode is now
  enforced in the backend and not only in the window: the state lives in the Rust half and every
  command that can change live work — saving or importing a library or a show profile, starting the
  stream, a Shoot, a raw message — is refused with a readable reason while it is on. A recovery copy
  that could not be written back is no longer reported as restored. A macro whose writes the console
  did not confirm is no longer counted as a clean completion: the run reports
  `completed_unconfirmed` with the number of unconfirmed writes, and only fully confirmed runs count
  as completed. And a Shoot can be cancelled: the window gets `stop_test_action`, the run reports
  `cancelled` instead of success or failure, and PANIC STOP raises the same flag.

- **`gate_ratio` is settled, and the desk wrote the answer.** The extracted option list looked
  truncated (`…, 1:4, gate`), so the key stayed out of the catalogue rather than offering values the
  console might ignore. Verified on hardware, the list is exactly those five rows and the leaf
  takes them as strings: `1:5`, `1:10`, `1:100`, `GATE` and `EXP` are ignored, and an integer is read
  as an index into the same five (`1` -> `1:2`, `4` -> `gate`).

## [Desktop 0.2.55] - 2026-09-26

Build `20260926.2`.

- **The warning dialogs can be muted, Enter accepts them, and red means something again.** A warning
  that offers it (Shoot, PANIC STOP, discarding an unsaved draft) carries **Do not show this again
  for this action** and **Do not show any of these warnings again**; a muted warning proceeds without
  asking, and Properties → General → Warnings lists every muted one with its own **Show again** button
  plus **Show all warnings again**. `Enter` accepts the primary action of every dialog — Shoot, quit,
  save, Properties, the channel matrix, station backup — while `Escape` still cancels, text fields
  keep Enter for themselves, and only the front-most dialog answers. And the red accept button is back
  to meaning "this destroys something": it was on eighteen dialogs, eleven of which were plain reports
  ("Could not save the macro", "PANIC STOP FAILED"), and those acknowledge with the normal button now.

- **A send without a destination has no address, and the panel asks for one.** The step and gate
  panels pre-selected Bus 1 (Matrix or Main 1) for every send, so the destination the macro really
  wrote was invisible — and on a bus that default is the bus's own send, which footnote 38 says the
  console ignores. The destination field now starts empty, the list opens with "choose the
  destination", the value is refused with the range to fill in until it is chosen, and the resolver
  builds no address at all without one. The Send preset picks the parameter, not the bus.

- **One chevron for every dropdown, and the macro panels stop shuffling.** The native lists drew the
  old boxed Windows-95 arrow while the grouped picker drew a bare chevron; both draw the same bare
  chevron now, in both themes. A field that appears and disappears with the selected parameter (the
  send destination, the value control a kind swaps) keeps its grid cell instead of collapsing it, so
  the two columns no longer jump out of line with the rows above.

- **`ptap` is offered, and the desk settled the checks the last batch left open.** The channel
  pretap is a string enum — the eight documented values are taken verbatim, an int write is ignored —
  so it is offered on channels alone; the compressor ratio needed nothing (a float write lands); the
  `gate_*`/`dyn_*` leaves answer reads and arrive on a `/*S` subscription; `/$ctl/safes/output/A` is
  the console's spelling and the extraction's `outpu/A` answers nothing; and of the six unmarked solo
  `$` rows, `$dim`, `$mono` and `$flip` latch a write (they are targets now) while the three
  source-solo reports do not (they stay watches). One grouped picker per field instead of two
  dropdowns, and no hover ScreenTip over an open dropdown.

## [Desktop 0.2.54] - 2026-09-26

Build `20260926.1`.

- **The desk level is a macro target now.** The monitor buses 1…2 (polarity, pan, width, the
  eight-band EQ, limiter, delay, dim and PFL dim, band solo trim, source level and mix, source and
  direct input, tags) and the solo configuration (mode LIVE/STUDIO/SIP, where solo is monitored, the
  solo mute and the four taps) can be set and watched; the console lights are writable and watched,
  and the safe masks — one character per item, `+` for safe — can be set before a scene load and
  watched; the W-Live multitrack gives ten commands (transport, session and marker handling, the time
  to jump to, naming, set marker and format the card) with the transport state and the card identity
  as watches; the AES50 health (link state, device, corrected and uncorrected counters) is watched
  with the documented error reset as a command; the clock lock and PPM are watched; and the global
  clock rate, clock source, startup mute, USB and StageConnect configuration are writable. Two rules
  make that safe: a key the console only **reports** can never be a step — the editor does not offer
  it, and the shared validator now refuses a hand-edited show file that names one — and a write-only
  **command** takes a Set (a toggle would have to read it first, a fade to check the value it ended
  on) and is sent without a read-back, because the console reports what it changed at another key.
  Three judged calls are documented: the monitor level `$lvl` is a watch and not a step because
  footnote 13 makes it read-only on the full-size WING (a Rack or a Compact could set it, so the
  write is withheld rather than forbidden by the console), the source solo's `OFF, CH39, AUX7` list is
  offered exactly as the document prints it with the console's own `$srcsolo`/`$srcsgrp`/`$srcsin`
  reports beside it, and `/$ctl/midi/*` and `/$ctl/$globals/*` stay out because they are desk wiring
  rather than a cue (1254-1394, 2950-3024, 3128-3145, 4016-4067, 4089-4097, 4128-4145, 4168-4186).

- **The whole strip is reachable now.** Bus mono, input balance and the auto-source switch, the
  PreSend EQ with its three bands, the gate's mix, gain and accent, the dynamics detector, envelope
  and auto, the filter slopes, tool filter, model and tilt, both sidechains (type, frequency, Q,
  source and tap), the process order, and tags — where `#D1`…`#D16` is the documented way to put a
  strip into a DCA. The EQ gained its model, its mix, its two shelf types and its tilt, and the
  matrices their direct input. A few of these differ by family (`eq_mix` is 0…125 per cent on
  channels, aux and matrices and 0…100 on buses and mains; the shelf types and the sidechain tap
  differ with it), so the catalogue carries one table of per-family overrides rather than a row per
  family. `gate_ratio` stays out until its option list can be read without the extraction's prose
  (1970-2441).

- **The USB recorder and player, the fader layers and the desk status are macro targets now.** A macro
  can start the two-track (STOP, REC, PAUSE, NEWFILE), choose its destination, depth and tracks, drive
  the player (IDLE, STOP, PLAY, PAUSE, NEXT, PREV, PLAYFILE) with its file and repeat, switch fader
  layers by their seven surfaces (L, C, R, CMPCT, RCK, EXT, VRT), and react to the recorder's or
  player's state and position — or to which strip and page the operator has selected, which is the
  trigger a live macro usually wants (Maillot 3051-3075, 3096-3097, 3220-3645).

- **A macro can re-patch a channel, switch the desk between Main and Alt, and fire a test tone.** The
  source group (seventeen entries), its number and the ALT pair are offered on channels and aux — the
  row a macro needs mid-show; `/io/altsw` and `/io/autoaltovr` are offered globally; and the oscillator
  gives a level (−40…6), a waveform (SINE, PINK, WHITE) and a frequency (20…20000 Hz). The writable
  source mode (M, ST, M/S) is offered on the twelve physical inputs whose own row the document writes;
  the oscillator's `mode` row is read-only in Maillot (1781) and is deliberately not offered as a write
  (1593-1793).

- **Solo, talkback and a footswitch are macro targets now.** `solo` is offered on every mix family and
  on the DCAs (writable and watchable); **Talkback** covers both buses — on/off, mode (AUTO, PUSH,
  LATCH), the two dims, individual levels and the assigns to 16 buses, 8 matrices and 4 mains, which
  reuse the same destination field the sends use; and **GPIO** offers the mode and the state a macro
  can drive, plus the read-only input state a macro can watch — so a footswitch can start a macro and
  a macro can light a lamp (Maillot 1456-1533, 1999-2874, 4009-4014).

- **A macro can recall a scene now.** `/$ctl/lib/$actionidx` and `/$ctl/lib/$action` are offered as
  **Scene Number** (0…16384) and **Scene Action** (IDLE, GOPREV, GONEXT, GO, PREV, NEXT, GOTAG), so
  the ordinary recipe — set the number, then send GO — is a two-step macro; the watched
  `$actidx`/`$active`/`$activeid`/`$actshow`/`$scenes` are offered as **Show State** triggers, so a
  macro can react to which scene is live. A show must be open, `$actionidx` must be 0 for NEXT or PREV
  followed by GO, and over plain OSC the scene list returns only its first name (Maillot 4105-4126,
  footnotes 77-79); the hints say all of it. This is the first batch of
  `docs/MACRO_TARGET_PLAN_2026-09-24.md`, which lists every control still to come.

## [Desktop 0.2.53] - 2026-09-25

Build `20260925.1`.

- **The model that travels with a trigger or an IF gate now comes from that panel's own strip.** The
  editor read the strip models once, keyed to the action's target, and every panel used that single
  answer: a trigger on ch/1 travelled with the model read for the target's ch/3. The backend checks the
  name against the model that travels, so a valid macro was refused naming a model it would never run,
  and the mirror case (the trigger's own model lacks the name) passed the check while the console
  ignored the write. Each panel with a strip of its own — the action step, the trigger and every IF
  gate — is now read for its own `family`/`ids`, one read per distinct strip (debounced, cached by
  strip), and `targetModelForParameter(key, storedModel, category, stripKey)` is the one lookup all
  three use. A strip that has not been read yet contributes nothing, never another strip's model.

- **A save no longer rewrites the model a macro was written for.** `targetModel` on the wire means
  "the model this target was last checked against, as the editor read it" — that is what the backend
  validates the name against. The macro library keeps the other answer: "the model this target was
  written for". A GEQ macro on `gate_thr` stayed a GEQ macro when the strip was read as running DEQ2,
  and a `section:name` key the strip no longer explains keeps naming its model in the option label
  until the target is pointed at another name.

- **The grouped picker's submenus stay inside the window.** The flip tested only the right edge, so at
  ~420 px the Sends submenu landed at `left: -186` — an unlabelled sliver whose nested submenu then
  covered its parent. Both edges are tested now and the result is clamped to the viewport. In compact
  density the picker rows also grow around a wrapped label instead of painting it outside a 20 px box.

- **Re-centre windows reports what really happened.** It counted a dialog merely because the element
  exists, so it claimed to have re-centred two windows when nothing had moved and the "nothing needed
  re-centring" sentence was unreachable. It now counts only what moved or whose remembered position
  was dropped, says so in its own words, and never claims to have moved the Meter Bridge or the Guide
  when no desktop frame is present.

- **An id list pasted with a typographic dash** (`1–4`) is read as the range it looks like, by the
  field and by the editor's own parse: the field accepted it while the parse read it as just `1`.

- **A model parameter is checked against the model the strip actually runs.** A gate, compressor or EQ
  name belongs to the model loaded in that slot — a `DEQ2` gate has `1-thr`, not `thr`, and a `WARM`
  compressor has no `thr` at all — and the console ignores the write without a word. The model the
  editor read now travels with the target, and a name that model does not have is refused with a
  message that names the model and a few names it does have. A file that carries no model keeps
  working as before, with the preflight note that the model was not checked.

- **A second, adversarial pass over the whole change found eleven defects, and this build closes
  them.** The most serious: the model check only looked at the `gate:1-thr` spelling, so a macro on the
  plain **Gate Threshold** key (which resolves to the same leaf) escaped it and could never fire on a
  strip running another model — the same names are now checked through the catalogue too; a trigger on
  a name with no value typed silently became `name == "1"` (it armed and never fired) and is refused
  instead; a meter index above its family's count (`ch 100`) can no longer be armed; colour, icon,
  compressor knee and output index are written as the whole numbers the console documents, and a fade
  is no longer offered on them; the Shoot button, preflight and the compile path now agree on a raw
  custom address; and the guide describes the read-back that really happens (any value, a fade at the
  end of its ramp, a report and never a failed step).

- **The macro target list is grouped, and a bus is never offered its own send.** The picker was one
  flat list of about a hundred keys, so the targets added in 0.2.52 — matrix sends, main sends, insert
  slots — could not be found and were reported as missing. It is now a menu grouped as Meter · Level &
  routing · Sends (Bus 1…16 / Matrix 1…8 / Main 1…4) · Input · Filters · EQ · Gate · Dynamics ·
  Insert · FX · Output & routing, with submenus that open on hover, on keyboard focus and on click. A
  bus's own index in a send destination is shown as unavailable with the reason (the console ignores
  it, Maillot footnote 38), and a stored macro pointing there is refused by Save, Arm and Shoot.

- **A write is read back whatever it carries, and a fade is checked at its end.** Only numbers used to
  be verified, so a model name, a tap or an insert slot could be written to a path the console ignores
  while the macro counted as completed. Now one rule decides what is verifiable and one rule compares
  (numbers within the documented tolerance, `true`/`false` as 1/0, everything else trimmed and
  compared as text), a ramp is verified once after its last write, and a mismatch is still something
  the operator reads rather than a failed step.

## [Desktop 0.2.52] - 2026-09-24

Build `20260924.2`.

- **The macro editor can no longer offer a comparison that cannot work.** A trigger on a source's
  **Name** used to arrive with "rises above" and a dB threshold — text has no size, so the macro
  saved, armed and could never fire, silently. Every parameter now carries its kind (meter level,
  on/off, number with a unit, text), and the kind decides the comparisons and the value field: a
  name is compared with **equals**, a V2 flag with **ON/OFF** instead of a dB threshold, a frequency
  with its own unit and range. A parameter the console does not report is not offered at all.

- **The same rule is enforced in the backend**, in preflight *and* in the path that compiles the
  library for a live session, so a hand-edited show file cannot inject a comparison the window would
  refuse. An unknown comparator is normalised to `>` and then judged by the parameter's kind: on a
  text, on/off or closed-list parameter `>` is not allowed, so it is refused; on a number it is
  treated as `>`.

- **The macro summary and the IF gates follow the same kind**, the Edge selector only appears where
  it means something (state parameters), and a fade is only offered for values that can be ramped.

- **A step that targets a model parameter is no longer rewritten to `mute`** when the operator
  selects another step and comes back, and a new step's blank channel list stays blank instead of
  silently becoming channel 1.

- **An index outside the family is refused** (`ch 999` used to resolve to a path the console ignores
  while the app reported success), the send index is bounded by its destination (buses 1–16, matrices
  1–8, mains 1–4), and `trim` and polarity are offered on buses, mains and matrices too — Maillot
  documents them there and the app was refusing them.
- Catalogue corrections from a Maillot audit: channel input gain and trim are two different leaves
  with their own ranges, EQ bands 5 and 6 are offered on buses/mains/matrices (not on channels),
  `comp_ratio` says 1.1–100, and the duplicated `trim`/`mute_group` entries are gone.

- **Every OSC node the protocol document defines was swept against the catalogue.** The controls the
  catalogue never offered are listed with their line numbers in `docs/MACRO_TARGET_COVERAGE.md`,
  highest value first (scene recall, solo, talkback, GPIO, input routing, the USB recorder and
  player, fader layers, desk status). The rows that document marks as this change are implemented in
  this build; the rest are the next batches.

- **The sends a macro could reach were only half of them.** Bus sends (level and on/off) were the
  only ones offered; a step can now set a channel's, an aux's or a bus's **matrix** send (1…8) and
  **main** send (1…4), choose the tap of every send (`PRE`/`POST`/`GRP` on channels and aux, pre/post
  on buses and mains), switch a send's "always on" and pan a bus send. Matrices have no sends at all in
  the protocol and a main has no numeric bus send; both are refused with the reason instead of writing
  a path the console ignores.

- **An insert can now say which FX slot it holds** (`NONE`, `FX1`…`FX16`), and a channel's
  post-insert its mode (`FX`, `AUTO_X`, `AUTO_Y`) and autogain weight (±12 dB). The hint warns that
  assigning a slot to an insert takes that effect away from the strip it was in, and that every
  insert adds about 32 samples (~0.66 ms) of delay.

- **The FX model is a closed list per slot instead of free text**: slots 1…8 load all the documented
  models, slots 9…16 the effects-only ones, so a typo can no longer be written and silently ignored
  by the console.

- **Strip controls that were missing**: width, input delay (on, mode and time), monitor mode and solo
  safe, each bounded by the documented range.

- **Two defects the sweep found are fixed.** A trigger or an IF gate on a bus send carried no
  destination and silently aimed at send 1, which for bus 1 is the self-send the console ignores;
  both now carry their own index or fail closed with the reason. And the output-source list was not
  Maillot's: it dropped `USR`, `SEND` and `MON` and invented `INP`, `USBREC` and `SIG`, so the editor
  offered `output_group = SEND` while the validator refused it.

- **`2250` is selectable again** as a gate and dynamics model, and `userctrl` offers the four user
  buttons the console has on the first page instead of sixteen: ids 5…16 built a path that does not
  exist, the same class of defect as `ch 999`.

## [Desktop 0.2.51] - 2026-09-24

Build `20260924.1`. A show is one file that is updated; the save/load dialogs fit their content; the dock's meters can be moved and removed.

- **A show is one file, and saving replaces it.** The file used to be
  `wing_<slug>_<date>.wingstation.json`, so saving the same show on another day left another file;
  now it is **`<show name>.wcz`** — the app's own type, recognisable in the Finder — and saving again
  overwrites it, which is what saving a show means. Older `.wingstation.json` / `.json` files still
  open.
- **The save and load dialogs are sized by what they carry.** Both inherited the 560 px height of the
  base dialog, so four rows sat in a half-empty panel; now they fit their content (≈240 px), and the
  section count says "1 preference" instead of "1 preferences".
- **The meter matrix opens with the view.** It used to arrive with the add field prefilled with
  `1-3`, so USB 1, 2 and 3 always looked selected whatever the watchlist had. The field starts empty
  and the matrix ticks exactly the meters that view already has, so it is a picture of the current
  selection: tick more and add, or replace with what is ticked.
- **The dock's meters can be moved and removed from the strip.** Every tag carries `‹` and `›` to
  move one place left or right (the strip order is the view order) next to the existing `×`.
- **Renaming a meter leaves the cell.** After Enter or clicking away, the inline alias editor stayed
  in the cell — the renderers skip an element that still holds an input — and the alias only came
  back by reloading the show. It now commits, writes the alias and leaves the cell immediately.

## [Desktop 0.2.50] - 2026-09-23

Build `20260923.3`. The macro summary can be read as cards, chosen in Settings.

- **The macro summary has a second presentation, chosen in Settings.** The WHEN / IF / THEN box above
  the editor was three lines of wrapped text; **Settings → General & UI → Appearance & Visual Theme → Macro summary** can now draw
  it as one card per part: the trigger with what it watches and its qualifiers (edge, mode, cooldown)
  as chips, one row per IF gate with the AND/OR that joins them, and the THEN steps as a numbered
  list with the disabled ones marked. It is presentation only — the same macro, the same behaviour —
  the choice is remembered, and it travels in a backup's settings scope. The default stays the
  classic lines.

## [Desktop 0.2.49] - 2026-09-23

Build `20260923.2`. The save system is a show system, and a file can no longer run code.

- **The macro list's Export/Import pair is now a SHOW box**: a **Name** field, **Save…** and
  **Load…**, and a line under them saying which show is open, when it was last saved, where the file
  went and whether anything changed since. It is the one place a show is saved from, so the two
  buttons the operator was actually pressing no longer behave differently from the Backup tab.
- **The show name lives inside the file.** A schema-3 backup now carries
  `show: { name, savedAt, scopes, appVersion }`, so a file that has been renamed, mailed or copied off
  a USB stick still says which show it is, and loading it puts the name back in the Name box. The
  restore report is titled `Show "<name>" restored` when the file carries a name.
- **The folder is `Documents/WING CONTROLLER shows`** (was `… backups`), matching the naming
  everywhere else, and an existing `WING CONTROLLER backups` folder is renamed to it on first start
  so shows saved with an earlier build stay where the operator looks for them. The app log is
  `logs/shows.log`.
- **The ticked sections are remembered**, so the next save offers what was chosen last time instead
  of the default, and the Inspector describes the new controls.
- **A restore is all or nothing.** Everything that can fail — the library and the draft written to
  disk — is done before a single preference is touched, and if any step fails the whole set of stored
  preferences is put back as it was and the dialog says which step failed instead of claiming that
  "nothing was changed". A file that declares a section it does not carry, or whose macro entries are
  not macros, is refused before anything is written.
- **A file cannot write the application's own state.** Keys such as the show name, the save folder,
  the ticked sections or "already saved" are never exported and are refused on the way in: a
  hand-edited file could otherwise silence the closing warning or point the next saves elsewhere.
- **The load dialog says which show a file is.** It shows the file's name on disk and the show name
  written inside it, with when it was saved and the version that wrote it, so two saves of the same
  show are never confused; a file from an earlier version, which carries no such metadata, says so
  instead of showing a blank.
- **The show name keeps its spaces while it is typed**, and saving with no section ticked says so
  instead of leaving the dialog sitting there. When a save replaces a file from earlier the same day,
  the confirmation says so.
- **A `.wingstation.json` can no longer run code in the window.** Meter labels and keys restored from
  a file reached the window's HTML unescaped and the window has no CSP, so a hand-made file could
  execute script — and the app's own file-writing command was within reach of that script. Every value
  that comes from a file is now escaped where it is rendered, the same treatment the Meter Bridge
  already had.
- **Saving is harder to interrupt.** The temp file a save writes is unique per process and is flushed
  to disk before the rename, so two saves at once cannot share it and a crash cannot leave a
  half-written show; a save that cannot use the chosen place falls back to the show folder instead of
  giving up; and a late answer to an abandoned Save panel is no longer thrown away — the file is
  written where the operator chose and the log says so.

## [Desktop 0.2.48] - 2026-09-23

Build `20260923.1`. Saving is where the operator looks for it, the folder exists from boot and closing warns about the show.

- **The backup folder exists from the moment the app starts** (`Documents/WING CONTROLLER backups`),
  created by a new `ensure_backup_folder` command at boot and shown in the Backup panel, so the
  operator can see where the saves go without saving something first.
- **Closing the app warns about the show as well as about the draft.** The quit confirmation used to
  mention only unsaved *macro* changes; it now also says "This show has no backup file saved" when
  there is no backup or when the library or the watchlist has changed since the last one, and the
  Backup panel shows when the last backup was taken.

- **The Export/Import buttons next to the macro list are the backup now.** They wrote and read a fixed
  `~/Desktop/wing_macro_library_export.json` with no dialog and no choice of what to save — which is
  where the operator was pressing, so the report "no dialog opens, the macro list just flashes" was
  about those two buttons, not about the Backup tab. They now ask what the file carries (macros and
  meters ticked by default) and what to call it, then use the same flow as the Backup tab: system Save
  panel, backup folder as the fallback, path in the confirmation, Show in Finder, and the restore's
  file picker plus scope picker with the post-reload report. A library file from an older version is
  still accepted and offered as a macros-only backup. The buttons say what they do ("Export…",
  "Import…") and the Inspector describes them.

## [Desktop 0.2.47] - 2026-09-22

Build `20260922.20`. The station backup can no longer end with no file and no message.

- **The station backup can no longer end with no file and no message.** Two separate failures were
  behind it. (1) The native Save panel is an AppKit *sheet* whose completion handler does not always
  arrive — a window that is not key, an app that is not frontmost, or a second panel requested while
  one is open (macOS **queues** it) leave the plugin waiting forever with **no timeout anywhere in the
  stack**, so the `invoke` neither resolved nor rejected: no panel, no error, no file. (2) Running an
  older DMG (the unsuffixed `/Volumes/WING CONTROLLER` is 0.2.41) still had the old `data:` URL export,
  which writes nothing in the packaged app.
  Now: the panel is asked for with the plugin's **callback** API plus a **25 s watchdog**, only one
  panel can be in flight (a second is refused instead of queued), and if the panel fails, does not
  answer or is cancelled the export **writes the backup into the backup folder anyway** and says
  where. **Ask where to save** (ticked by default) keeps the dialog for when it is wanted; unticked,
  and during a show, the file lands straight in `Documents/WING CONTROLLER backups` (changeable with
  **Folder…**). A confirmation always names the path, offers **Show in Finder**, and every step is
  logged to `logs/backup.log` inside the app's folder.
- **The panel says which build is running**, and the session log starts with
  `app_start version=… build=…`: the whole confusion came from an old version still being launchable
  from a mounted DMG.
- **Restoring tells you what it restored.** After the window comes back it reports the file and the
  sections applied with their counts, so a restore is never a silent no-op. The restore also uses the
  webview's own file picker (native, no plugin in the path) and a backend error string is no longer
  swallowed into `undefined` in the message.
- **The whole export handler is wrapped**: building the payload, the save and the confirmation all
  live inside one `try`, so nothing can die as an unhandled rejection without a dialog and a log line.

## [Desktop 0.2.46] - 2026-09-22

Build `20260922.19`. The save/load panel is asked for by the backend (and a failure is visible), and the report's interface finishing touches.

- **The station backup dialogs are asked for from Rust, not from the window.** The window used to call
  the dialog plugin over IPC (`plugin:dialog|save`): if that call failed — a permission, a name, an
  argument — the code fell back to a browser download that writes nothing in the packaged app, so the
  operator could be left without a backup and without a message. The panel is now opened with the
  plugin's Rust API from `save_station_backup` / `open_station_backup` (no IPC, no ACL, no argument
  guessing), and a failure is reported with its reason instead of being swallowed. The now-unused
  dialog permissions are gone from the capabilities.
- **RENAME and NOTICE are secondary controls again.** They were as tall as ENABLED/OFF and carried the
  same heavy bevel, which made every library row top-heavy; they are now 40x15 with flat borders and
  the text-only look, while ENABLED/OFF keeps its 54x18 raised button.
- **The classic theme no longer has black holes in the meter card.** The unlit CLIP led was a near-black
  square and the bar's well was pure black on a grey card; the led is now a grey button with maroon ink
  (red when it clips) and the well is a dark grey that still contrasts with the LEDs.
- **The PK box no longer moves the dB scale.** It grew from "PK --" to "PK -56.4" and squeezed the
  graduations sideways; it has a fixed width now.

## [Desktop 0.2.45] - 2026-09-22

Build `20260922.18`. The guide no longer tells how the app is built, the meters can be read and the backup really saves.

- **The station backup export opens the system's Save panel and writes a real file.** It used to hand
  the JSON to the browser as a `data:` URL download: in the packaged app no dialog appeared, nothing
  landed on disk and the log still said `station_backup_exported_successfully` (audit finding). Now the
  window asks for a path (`plugin:dialog|save`, suggested name and backup filter), the app writes the
  file there and a confirmation says where it went and which sections it carries; cancelling writes
  nothing and logs `station_backup_export_cancelled` instead. Restore asks for the file in the
  system's Open panel and reads it the same way the file input did, and keeps the scope picker.
  A **Show name** field names the file (`wing_<show>_<date>.wingstation.json`, accents and odd
  characters folded away) and is remembered for the next export, and the folder of the last backup is
  remembered too, so a run of shows does not scatter its files. The guide gets a "One file per show"
  section for the workflow this is for: tick Macros and Meters, leave Network and Settings alone.
  `scripts/test-desktop-station-backup-dialog-browser.mjs` drives both dialogs in Chrome.
- **A restored backup can no longer be silently overwritten by its own flat copy.** The import applied
  the section's own fields (watchlist, peak configuration) and then the generic preference block, so
  when a file carried the same setting twice the flat copy won. The section's field is applied last now,
  which is the one that says what the file is.
- **The meter list in the workstation is one meter per row**, like the Meter Bridge. With several
  columns the card was ~150 px wide and the value ate the name as soon as signal arrived (it ended up
  as "TRI…"); the name now keeps the row, the value never shrinks and the full name is in the tooltip.
  The classic (light) theme also got its ink back on that card: the name is navy, the value maroon and
  the dB graduations dark grey, all of them measured against the grey card (10.4:1, 7.1:1 and 6.7:1),
  and the channel tag went from 3.7:1 to 7.9:1 in the dark theme.
  `scripts/test-desktop-meter-layout-browser.mjs` holds all of it in Chrome.
- **The guide no longer shows how the app is built.** It explained its own plumbing — file names,
  internal documents, line numbers, script names, internal identifiers — and that is gone from both
  the published content and the Markdown sources (621 citations, the preambles that explained the
  convention, and the identifiers each chapter still used). The protocol documentation and its author
  are acknowledged once, in chapter 1, and nowhere else. The generator keeps a safety net, the window
  shows no file names even in its empty state, and the content contract fails the gate if a reference
  or an internal identifier comes back.

## [Desktop 0.2.44] - 2026-09-22

Build `20260922.17`. The complete guide inside the app, in its own window.

- **A broadcast alert can no longer take PANIC STOP away from the operator** (reported from a live
  show). A macro that fires faster than its own alert duration reopened the alert card on every hit —
  new beep, new `AudioContext` each time — and the card's scrim sat on top of the header, so the
  emergency stop could not be clicked and the alerts could not be dismissed fast enough. Three fixes:
  while an alert is up the master header (PANIC STOP, status chip, stop button) floats above it and
  still takes the click; the alert card carries **its own PANIC STOP**, which runs the same path as
  the header button; and **PANIC STOP** — any of the routes, plus `F12` — now clears the alert and
  ignores further alerts for three seconds, logging each as `hud_alert_ignored_after_panic`. The flood
  itself is bounded too: a repeated identical alert is coalesced and counted (`Repeating ×N`, with the
  copies a burst dropped), beeps are throttled to one per second with a single shared audio context
  and stop after the fifth repeat, and past three times its own duration the card freezes — no flash,
  no countdown, no sound — until somebody dismisses it. A *different* alert always shows at once, so
  information is never swallowed. The panic confirmation dialog (when enabled) also paints above the
  alert now. The courtesy notices get the same treatment: the card of the same macro is replaced
  instead of stacked, at most three are on screen and the chime plays at most once per second, with
  the window's audio context now shared by the alert beep, the chime and the panic feedback instead of
  one new context per sound. Both windows carry the same engine, and
  `scripts/test-desktop-hud-panic-browser.mjs` drives it in Chrome.
- **The complete guide ships with the app.** The Help tab in Properties stays as the short quick
  reference, with a button that opens **the complete guide in its own window** (`guide.html`): eleven
  chapters by topic (start here, triggers, actions & timing, macros & limits, meters & banks, saving
  & scopes, the WING protocol, diagnostics, troubleshooting, shortcuts & UI, and recipes for a show
  in practice), a search box that filters and highlights, index and hash links, print, remembered
  geometry and the same classic look and theme as the other two windows. 14,102 words written from
  the code and the audit, with the technical detail an operator asks for: the action order and its
  real timings (17 ms per packet, ramps of 2..128 packets, 32 steps, 60 s caps), the library cap, the
  backup scopes, the protocol and the limitations.
- The guide content is **generated**: `docs/guide/*.md` is the source and
  `scripts/generate-guide-content.mjs` writes `desktop/ui/guide-content.js`; a contract fails the gate
  when the generated file falls behind, and another one drives the window in Chrome (chapters,
  content, index, hash links, search).
- **Three Inspector tooltips no longer promise more than the code does**: "Fade start" said the runtime
  reads the parameter before ramping (a Fade never reads the console, it sends the authored values),
  "Decode" promised "typically under 50 µs" (it is the last measured frame and climbs when the Mac is
  busy) and the trigger latency said "emitted to the window" (the clock stops when the action is handed
  to the action thread, before the OSC write and the paint). The guide had to correct all three.
- **The graph scroll speed no longer claims to be seconds.** Both windows labelled it "seconds on
  screen" while the value is a speed (1x…10x) and a different scale in each window: the bridge draws
  `12000 / speed` ms of history and the dock pushes one sample every `350 / speed` ms into a fixed
  60-sample buffer. Both now read 1x…10x and the tooltip states the real history of that window.

## [Desktop 0.2.43] - 2026-09-22

Build `20260922.16`. The right column is no longer cut off, and the light theme becomes classic grey instead of black panels.

- **The right column is no longer cut off when the window is not wide enough.** Between ~1041 px and
  ~1189 px the layout could not fit (480 px + seam + the column) and the page overflowed sideways, so
  the cards appeared chopped at the window edge until something shrank. Measured and fixed: the
  right column is clamped to the space left, below 1180 px the window goes single-column, and the
  master header (`.master-stats` is 444 px wide) stacks in that band too — it was pushing Properties
  and Help off-screen. Verified with the real layout from 980 to 1440 px: zero horizontal overflow.
- **"Disconnected" is now "Offline"** in the status chip, the card summary and the header stop button:
  it was the widest label in the card headers and the one that pushed the buttons out.
- **The classic (light) theme is grey Win95 instead of black slabs.** The OSC terminal, the readouts
  (session log, stream, probe), the macro summary block and the meter cards were near-black surfaces
  that stood out too much in a grey window. They are recessed grey panels now, with classic ink: navy
  for what the console sent (RX) and maroon for what was sent (TX), and the numbers in dark ink. The
  meter's own well stays dark on purpose — that is what keeps the LED bar readable — and the dark
  theme keeps its CRT look untouched.

## [Desktop 0.2.42] - 2026-09-22

Build `20260922.15`. Pixels instead of modern glow, and the meter banks in both windows exactly as the operator wanted them.

- **The browser tests no longer fight over a Chrome tab.** Each of the four that attached to "the first
  index.html tab" now opens its own and closes it, and the gate still starts from a clean set of tabs.
  Sharing one tab was the cause of the intermittent failures inside the gate (`hud-flash`,
  `inspector-hints`, `field-validation`): a test that died before closing its tab left the next one a
  window with somebody else's state.

- **The same meter banks in both windows, each with its own choice.** The workstation's Live Meters
  card can pick any bank the Meter Bridge stores and shows only that group; the bridge keeps its own
  independent selection (`wing_meters_bank`, the dock remembers `wing_dock_bank`), so choosing a bank
  in one window does not change what the other shows. A bank is a list of meters, so a group that is
  broader than the window's watchlist is shown **and subscribed anyway** (the stream only carries what
  is subscribed) and the row says how many of its meters are outside the watchlist. Creating,
  renaming, updating and deleting banks stays in the bridge, where "New bank" asks which meters it
  keeps.
- **No more modern glow**: the ENABLED state of a macro wears the ordered-dither ramp the rest of the
  window uses (the `green` surface preset) instead of a smooth gradient, and the OSC monitor's ACTIVE
  badge lost its pulsing animation and its halo: flat colours and a 1px bevel.
- **The header brand is flat**: the app name had a soft green `text-shadow` in the dark theme (and the
  BETA badge a yellow one), and the logo brightened on hover. All three are gone; the logo hover keeps
  the classic face change, and the pressed state stays.
- **Two more soft glows out**: the card drag-insertion line (a 4px amber bar with an 8px halo) is a flat
  line with hard 1px edges, and the colour tag square no longer glows with its own colour (pixel bevel
  instead). What stays, on purpose, is the peak/CLIP lamp inside the meters and the HUD alert flashes:
  there the light is the instrument and the warning, and it answers to the Flash setting.

## [Desktop 0.2.41] - 2026-09-22

Build `20260922.14`. This is the multi-front audit round of 2026-09-22 (15 read-only fronts, an
adversarial verification pass and the fixes below; the full report, with the findings still open and the
false positives that were discarded, is `docs/MASTER_PLAN_2026-09-22.md`). Gate: green (34 checks).

- **Fixed a show stopper: the stream thread deadlocked itself.** With the `queue_one` ("Queue one
  run") or `restart` overlap policies, `maybe_start_show_action` emitted a runtime event while holding
  `runtime.queued`, and that emitter takes the same non-reentrant mutex: the stream thread hung, the
  meters froze with the window still reading "Live", no macro fired and PANIC STOP returned Ok without
  stopping anything.
- **PANIC STOP and "Disconnect / Stop" can no longer fail silently.** A rejected invoke left the screen
  untouched (no error, no log, no acknowledgement); they now report it, keep the local state honest and
  log it.
- **The "Send to the console" confirm no longer lies.** It read four ids that do not exist and always
  showed `(no address) = (no value)` while authorising a real write; it now describes the selected step.
- **A modal owns the keyboard again.** `#win95-confirm` was missing from `modalLayerIsOpen()`, so the
  1-9 keys changed the macro behind the dialog, and two overlapping confirms shared one DOM node and one
  OK. The guard now covers every dialog backdrop and the confirm queues its requests. The legacy
  "Delete macros" dialog (which focused Cancel and silently cancelled on Enter) is gone.
- **Saving the draft no longer clears the unsaved marker before the write**, the three "Export"
  actions and `update_active_meters` report their failures, and "Connect" no longer proceeds when the
  save it offered failed.
- **Protocol (Maillot 3.1.0):** the V2 gate LED is slot 6, not 8; V2 `gate led`/`dyn state` return 0/1
  and are no longer divided by 256 (the UI's `== 1` condition could never be true); the FX `x6/2048`
  scale applies to the band gain reduction, not the four levels; the user button writes `/bu/mode`
  instead of the `bu` node; a matrix model is read at `/mtx/...`; a datagram that ends inside a meter
  group stops the frame instead of decoding the next descriptor from a false boundary; the meter UDP
  buffer is 32 KiB; and the documented ranges for HPF/LPF, gate and compressor times, compressor
  gain/knee and FX mix now match the document in the editor and the preflight.
- The four long commands (`test_action_step`, `verify_macro_targets`, `usb_meter_stress_test`,
  `read_strip_models`) are `#[tauri::command(async)]`: they no longer block the main thread for up to
  60 s.
- **Instrumentation that told the truth only by accident:** `Dropped` is a real counter of rejected
  meter datagrams, `Rate`/`Bytes` are windowed rates instead of session averages, `Decode` no longer
  flickers to 0 twice per second, and `RX`/`Renew` read "N ms ago" instead of looking like latencies.
- **Readability:** the OSC path preview and the "Live" chip in the dark theme (1.10:1 and 1.61:1), the
  Meter Bridge ruler and rack marks in the light theme (1.02-1.86:1) and the history graph scale in both
  themes (1.26:1) are legible now; the dither texture no longer paints over the HUD urgency colour, so
  panic is red again instead of navy.
- **State tells the truth:** the Inspector no longer claims "Live" permanently, the OSC badge recovers
  after a reconnect, the health grid is marked stale when the stream falls, the log summary and the
  connection card follow the real state, saving while a draft is armed no longer claims to have
  re-applied the library, and the backup scope table has its duplicated key fixed and the bridge graph
  speed in the right scope.
- **Layout:** Properties can no longer clip its Close button, the HUD can no longer scale off screen,
  "Compact" density is actually compact, the macro name is no longer capped at 175 px, the Inspector is
  no longer nailed to 165 px and the tiny buttons in the Probe panel have a rule.
- **"Only meters" hides the meter card's controls, and nothing else.** It was hiding the builder
  column, the seam and every other card — a window with pieces missing — when what it promises is to
  hide the meter controls (style/size/zoom, add channels, banks) and leave the meters.
- **Diagnostics: every block collapses and, above all, reopens.** Collapsing the OSC monitor hid the
  whole section, its header and its chevron with it, so it could be collapsed once and never reopened;
  the Probe block had no chevron at all. Both are fixed, the four blocks (OSC, Probe, Link & health,
  Log) toggle from their header or their chevron, and the state is remembered.
- **The custom-bank selector**: choosing a bank filters the meters in both windows, "New bank" in the
  bridge now asks which meters it keeps (it used to save the whole watchlist, so the bank was identical
  to "All meters" and selecting it changed nothing), and **the bank you pick stays picked**: when none
  of its meters is in the current watchlist the window shows them all and explains why (instead of
  snapping the dropdown back to "All meters", which read as a broken control), and a bank that keeps
  the whole watchlist says it shows the same as "All meters".
- **The packets counter is gone** from the Live Meters header: it counted frames, not anything the
  operator acts on, and it was taking room next to the buttons that matter.
- **The green Connect block reads in every theme**: with the dark theme its "Live" chip was light grey
  on light green (1.6:1), and the Connect button kept saying "Connect + Listen" while it was disabled
  during a session — it now says "► Connected", greys down keeping the text light, and the chip has its
  own dark face.
- **The macro row is readable**: the pencil is labelled RENAME and the [!] is labelled NOTICE, and the
  ENABLED state has its own green gradient fill with a raised bevel (it was a flat green with a sunken
  shadow, which read as a pressed button).
- **The category tag is a control**: it was a bare square that changed colour when clicked, with no
  name, no keyboard focus and no Inspector entry. It is a button now, the colour name is written next
  to it, and it explains itself in the Inspector (and the Live Safe Mode lock can actually disable it).
- **No scrollbars in the working window.** The page, the columns, the lists and the readouts still
  scroll with the wheel and the trackpad, but the bars no longer take width or fight the look. The
  dialogs (Properties, Channel Matrix) keep theirs, where they help walking long lists.

## [Desktop 0.2.40] - 2026-09-22

- **Diagnostics: the OSC monitor moved to the top** and every block now collapses on its own. The OSC
  monitor, the link/health grid and the log have their own chevron, and the state is remembered in
  `wing_diag_collapsed`. The OSC block keeps its header when collapsed, so it can always be reopened.
- **Live Meters: "Only meters" focus mode.** A button in the card header hides the rest of the window
  (builder column, seam and every other card) and leaves the meters at full width. Escape brings
  everything back, the button shows its state and the mode is remembered in `wing_meters_solo`.
- **Fixed: the gradient could be missing on the first paint.** At load, the selected macro row had no
  dithered background and only picked it up after being selected again: the macro library arrives from
  the backend after the dither module has run, so those rows were painted after the startup sweep. The
  module now does three cheap sweeps after boot (0, 300 and 1200 ms).

## [Desktop 0.2.39] - 2026-09-22

- **Scoped backups.** The station backup is now a schema 3 file with one independent section per scope
  (macros, settings, meters, network) and a `scope` field declaring what it carries. Every preference
  belongs to a scope through an explicit table, and anything new falls into `settings`, so a fresh
  preference can never be left out of a backup by accident.
- **The restore no longer deletes anything.** It used to wipe every `wing_*` key before writing the
  file's, so a preference the file did not carry — an old backup, a partial one — vanished silently. It
  now writes only what the file brings, for the scopes you pick, and leaves the rest untouched.
- **Per-scope validation**: a file with a broken meter section is refused with the meter reason instead
  of being rejected as a whole.
- **Pickers on both sides**: checkboxes when exporting (with Select all / none and a warning if nothing
  is ticked) and a picker when restoring that lists what the file carries and applies only what you tick.
- **A backup can no longer fail because of the draft**: if the builder cannot be read at that moment the
  draft is skipped and logged, and the file is still produced.
- **A schema 2 file is still accepted** and read as "carries everything"; a complete export still emits
  the flat schema 2 fields so an older version can read it.
- Removed the invented MÁRMOLES SUPPLY CO. phrases: the About tagline, the `brand` field inside the
  payload and the installer banner.

## [Desktop 0.2.38] - 2026-09-22

- **Fixed a live regression: the sidebar meters could be left with no signal.** The bank
  filter returned an empty list when none of its meters was in the current watchlist
  (a bank saved with other channels, or a reloaded watchlist), so no meter was painted and there was
  no explanation. Now, if the bank gives no match, **all** the meters are shown and the bank is
  released: the selector goes back to *All meters*. Verified: 3 meters and a foreign bank -> 3 visible.
- **"Update bank" works again and is understood**: it did not repaint the list (the previous fix covered
  the selector, not this button), so now it repaints —verified: a bank of 1 key with 3 meters in the
  watchlist -> after updating, 3 keys and 3 visible— and the dialog says the contents are replaced and
  the name is kept (*Replace contents*). Saving a new bank repaints too.
- **The meter style is no longer linked between windows**: the workstation window writes
  `wing_meter_style` and the bridge `wing_meters_style`; the bridge inherits the value once if it has no
  key of its own. Verified: popup on `vu` and sidebar on `bars` at the same time.
- **The bank selector really filters**: the render built the meters from the whole watchlist instead of
  `visibleMeters()`. Contracts added to the Settings test for both things, and the bridge
  regulator test now pins its style precondition.

## [Desktop 0.2.37] - 2026-09-22

- **Meter style is no longer linked between windows.** The style (bars / VU / graph) was shared on
  purpose, so changing it in one window changed the other — the opposite of what you want when the
  bridge sits on a stage screen and the sidebar on the desk. The workstation writes `wing_meter_style`
  and the bridge `wing_meters_style`; the bridge inherits the workstation value once if it has no key of
  its own yet (translating the old value), so an update does not restyle anybody.
- **The custom bank selector filters again.** Two chained problems: the handler updated the active bank
  id and the labels but never repainted the meter list, and the renderer built the meters from the whole
  watchlist (`customMetersWatchlist`) instead of `visibleMeters()`, the function that applies the bank
  filter. Verified with data: three meters in the watchlist and a bank with one leaves **1 meter
  visible**.
- **The bridge scale-regulator test now pins its style precondition.** It failed when another test left
  the window in VU (the regulator only exists in the bars style), which happened while verifying these
  changes.
- New contracts in the Settings test: the workstation must not write the bridge style key again, and the
  meter renderer must use `visibleMeters()`.

## [Desktop 0.2.36] - 2026-09-22

- **Fixed: the desktop background did not change in the dark theme.** `presetFor()` had no case for the
  desktop, so it always returned the light preset: the dark ramp existed but was never chosen.
  Reproduced by measuring the whole pattern and pinned with a test that switches theme and back.
- **The grey gradient leaves the panel bodies and moves to the block headers**, which is where it gains
  importance (Build Macro, 1. Trigger Signal and the other groups); the bodies stay flat.
- **The main header stands apart from the subheaders**: Build Macro uses its own ramp, darker and with
  more range, and the groups use the soft grey.
- **1 px outline on the right column's headers** (Inspector, Connection, Meters…): without it the
  transition between the ramp and the block background looked dirty.
- **The Meter Bridge zoom no longer moves the sidebar's**: the bridge has its own key
  (`wing_bridge_meter_scale`) and inherits the value once.
- **The interface does not name the aesthetic**: the looks are "Light (Classic Slate)" and "Dark (FOH
  Low Glare)", the meter style is "Task History Graph", and a contract in the Settings test prevents the
  era's written references from coming back.

## [Desktop 0.2.35] - 2026-09-22

- **The Meter Bridge zoom no longer moves the sidebar zoom.** Both windows wrote the same key
  (`wing_meter_scale`) and they share storage (same origin), so moving the zoom in the popup also changed
  the meters in the sidebar. The bridge has its own key now (`wing_bridge_meter_scale`) and inherits the
  workstation value once if it does not exist yet, so an update does not resize anybody's meters. Its
  change listener and its reset button use the new key.
- **The interface stops naming the era's aesthetic.** The looks are "Light (Classic Slate)" and
  "Dark (FOH Low Glare)", the meter style is "Task History Graph", and descriptions, tooltips, the
  context-menu label and the properties window title were rewritten in neutral terms. Two internal
  identifiers were renamed (`renderHistoryGraphs`, `initContextMenu`). A new contract in the Settings
  test fails if "Win95" or "Windows 95" come back into either window.
- Carried over from 0.2.34: the graph samples at the refresh rate (5..120 per second) while scroll
  decides how many seconds fit on screen, and the custom icon is applied and checked by the build (the
  unlock script restores it, and the helper travels inside the package).

## [Desktop 0.2.34] - 2026-09-22

- **The graph samples at the refresh rate, not at the scroll speed.** The sampling interval was
  calculated from the scroll speed, so at 5x only 5 samples per second were kept and **the packets that
  did arrive were dropped**; raising the speed added no detail. Now the **Refresh rate** (5..120 samples
  per second) rules the density —measured: 120/s -> 106 samples in one second, 30/s -> 28, 5/s -> 5— and
  the **Scroll speed** decides how many seconds of history fit on screen (12 s at 1x, 1.2 s at 10x). Two
  sliders in the Meter Bridge window and in *Settings -> Audio Displays*, with the same preference
  (`wing_graph_refresh_fps`).
- **The custom icon is no longer a manual step.** The build applies it right after signing and checks it
  (the artifacts ship with it already, verified inside the DMG), and the unlock `.command` restores it
  after its `xattr -cr`, which is exactly what removes it. The helper travels inside the DMG and the ZIP.
  Documented in `docs/ICON_MACOS26.md`, including the price: `codesign --verify --strict` flags the
  icon's metadata as detritus (the app still launches, verified).
- **Fixed a helper bug**: the "the app is running" check used `pgrep -f`, which matches any open copy
  (for example the one on the mounted DMG), so it refused to apply the icon right during the unlock. It
  is now anchored to the full path.

## [Desktop 0.2.33] - 2026-09-22

- **Step rows and IF gate rows wear their ramp when selected.** The gradient was missing in the step
  list and in the gate list: both share the `.step-row` class (conditions are painted as
  `step-row condition-row`), so they had the same flat blue. One entry in the dither module covers both,
  with its dark theme variant, and the test checks it (it skips if the macro has no steps).

## [Desktop 0.2.32] - 2026-09-22

- **A single analogue VU meter for both windows** (`desktop/ui/vu-draw.js`): the Meter Bridge and the
  sidebar used to draw a dial each and they did not look alike. The scale is **in dBFS**, not in "VU"
  (the WING data is dBFS and labelling it as VU was misleading), with a red zone from 0, major and minor
  marks, a needle with a counterweight and a hard shadow, a visible pivot with a screw, a peak mark and
  per-channel ballistics (fast attack, slow return).
- **History graph refined**: the samples carry a timestamp and the trace moves **continuously** (before,
  each sample appeared all at once one step to the right: it looked jumpy), a grid with dBFS labels, a
  thin trace without `shadowBlur`, a peak line, a "now" mark and a window of up to ~6 s of data instead
  of 60 fixed samples.
- **Graph Refresh Rate** adjustable in *Settings → Audio Displays* (60/30/20/10 fps,
  `wing_graph_refresh_ms`): it changes how smoothly the canvas moves, not how much data arrives.
- **Dither patterns pre-painted at boot** (`WingDither.prewarm()`): the surfaces receive their pattern
  before they have layout, so opening a dialog no longer shows flat blue for one frame.
- **The desktop background runs diagonally** (dark at the top left, light at the bottom right).
- **Macro row highlights wear their ramp** when they are selected.
- New tests: `scripts/test-desktop-vu-draw-browser.mjs` (dBFS scale, ballistics and that both functions
  draw) and the three checks added to the dither test.

## [Desktop 0.2.31] - 2026-09-22

- **Ordered dithering on the surfaces.** New `desktop/ui/dither.js`, loaded by both windows: ramps with
  a 4x4 Bayer matrix generated **at the exact size of the element** and cached as PNG. On 256-colour
  screens these gradients looked dithered; what is painted flat today is a modern simplification. Title
  bars of dialogs and popups in blue `#000080 → #1084d0` (3 px cell, with the base colour kept at 30 %
  so it reads as a reflection), panels and headers in grey, and their greenish equivalents in the dark
  theme. Generating to size is what avoids the rectangular cells and the vertical lines that stretching
  a small pattern left behind.
- **Desktop background with a teal ramp**, generated for the window and fixed (it is not regenerated
  when the content grows and does not shift when scrolling).
- **The seam between the main block and the side block is no longer a grey band**: it becomes transparent
  and shows the desktop background, keeping the resize handle visible.
- **1 px of margin on the right of the blue bars** (`background-clip: padding-box`), so the
  blue does not touch the black bevel.
- **Settings → About decorated**: a dithered radial halo behind the logo and a dithered brand band.
- **New test** `scripts/test-desktop-dither-browser.mjs`: pattern generated to size (not stretched),
  square cell (measured 3.99 × 4.01 px), a hidden dialog that paints when it opens, About when its tab
  opens and the 1 px margin.
- **Hardened gate**: before the browser tests it closes the tabs pointing at the dead temporary server
  on `:8080`. A zombie tab from an earlier run took five tests down and looked like a code failure.

## [Desktop 0.2.30] - 2026-09-22

- **The reason a macro cannot be enabled is visible again.** Enable deliberately refuses macros that
  cannot run (an unconfigured trigger or a step with no target), but the reason was written only to
  `streamOutput`, which is collapsed in the Diagnostics card: the toggle stayed `off` with no
  explanation. It now opens the app's own dialog with the reason and what to do. Before, an empty step
  filled itself in with `/ch/1/mute`, so a blank macro fired a real mute.
- **The About W presses down like the other buttons** (it was missing the 1 px shift on click).
- **"Compact" really changes things**: the base was already 11 px and a second compact rule repeated the
  base values, so the setting did almost nothing. Now 10 px base, panels from 8 to 4/6 px, buttons from
  24 to 20 px, gaps from 6 to 3 px, and inside Settings too.

## [Desktop 0.2.29] - 2026-09-22

- **The inspector no longer reads the internal identifiers of the dialog controls.** The
  buttons and fields of `win95-confirm`, `win95-prompt`, `macro-delete-confirm`, `meters-confirm` and
  `meters-prompt` carried no description of their own, so the inspector fell back to humanising the `id`
  and showed "Win95 confirm accept" for the Accept button. Now the twelve controls are described in
  operator text, and two safeguards keep it that way: a static contract requires `title` on every
  control inside a dialog, and the inspector test fails if a control without `title` is described with
  its own `id`.

## [Desktop 0.2.28] - 2026-09-22

Release that gathers the work of the UI/UX re-audit of 2026-09-21 (full report in
`docs/UI_UX_REAUDIT_2026-09-21.md`). Build `20260922.1`.

- **Trigger latency is measured and shown.** The backlog's last open P0 was live latency metrics
  (UDP receive → decode → trigger → UI emit). The runtime now times every frame that fires something,
  from the datagram on the socket to the action emitted to the window, keeps the last 256 samples and
  reports nearest-rank p50/p95 plus the worst case; the Diagnostics card shows `Trigger p50 / p95 us`
  with the sample count and the worst case in its tooltip, and `–` until something fires. The health
  event used to be emitted *before* the actions ran, so it could not carry the number: it now goes
  after them. Rust test: `trigger_latency_percentiles_use_nearest_rank`.
This shipped in the 0.2.28 build (`dist/v0.2.28/`, recorded in `version.json` as `20260922.1`); the
"in the tree, not built yet" line that used to sit here belonged to the *Unreleased* stage and was
simply left behind when the release was cut. This is the UI/UX re-audit pass of 2026-09-21 (full report
in `docs/UI_UX_REAUDIT_2026-09-21.md`: fixed / false positive / open) plus the workstation half of the
custom meter banks. Covered by `./scripts/verify-all.sh` (30 checks *at that time*: today it is 32 —
the count lives in `scripts/verify-all.sh`, not here).

### Added

- **Custom meter banks in the workstation window too.** The workstation window now reads and writes
  `wing_meter_banks` in localStorage (selector plus Save as / Rename / Update / Delete), the same
  data the Meter Bridge uses, so a bank made in one window appears in the other. The second half of
  `scripts/test-desktop-meter-banks-browser.mjs` pins it.

### Fixed (UI/UX re-audit 2026-09-21)

Full report in `docs/UI_UX_REAUDIT_2026-09-21.md` (fixed / false positive / open).

- **Three dead `alert()` calls in the packaged app** (WKWebView has no dialog delegate, so
  `alert()` does nothing): the Live Safe Mode block on arming said *nothing*, and the two backup errors
  were invisible. They now come out through the app's own dialog, and the result of saving/loading is
  announced in the header chip instead of the Diagnostics panel, which is collapsed.
- **The `window.prompt()` for a meter alias** (also dead) goes through `win95Prompt`.
- **Live readability:** the Meter Bridge peak/value numbers were invisible in the dark
  theme (`#303030` on a dark background, 1.46:1), the dB scale measured 8px at ~2.7:1, the unlit
  CLIP lamp could not be seen (1.5:1) and `.h-meter-row.is-selected` painted no state at all.
- **`class="primary"` had no CSS rule at all** (OK indistinguishable from Cancel) and there was no style
  for `button:disabled` (disabled controls looked live).
- **An invalid channel list silently became channel 1** when adding meters; it is now
  rejected and the field explains what it accepts.
- **Two buttons saved the draft with different validation** ("Save changes" did not validate) and the
  Cmd+S tooltip pointed at the wrong one: validation lives in the only path that persists.
- **"Load Show Profile" / "Import Show JSON" replaced the draft without asking** and their failures
  went only to the collapsed panel.
- **Dialogs and controls:** the meter matrix's `Clear` becomes **Deselect** (it did not confirm and
  sits next to Cancel/Add), `metersConfirm` now paints the accept button red when `danger`, and the
  bridge's `Matrix...` button was drawn unstyled for using nonexistent tokens.
- **The "Custom banks" separator was invisible** (`height: 0` with both borders on the same row).
- **The 1/2/3 and v/h shortcuts bypassed the rules of the layout selector**.
- **Copy:** the leftover Spanish in the interface (`Ruta: automática`, `Avisos de cortesía`, `En uso:`,
  `Buscando ruta hacia WING...`, `Adaptador … no disponible`, `Preferido:`, `(no disponible)`,
  `(sin verificar)`) and a bridge tooltip move to English; the same meter style had three
  different names between windows and F1/F12 were not in the shortcuts list.
- **Integrity:** the build numbers in the 0.2.25/0.2.26/0.2.27 notes were invented (the real ones
  are 20260921.12/13/14), two CHANGELOG entries had lost their heading, the HANDOFF header was five
  releases behind, and two tests that need Chrome did not follow the `-browser.mjs` convention
  (one broke the gate without Chrome and the other gave PASS without running anything).
- **Gate:** all Node tests have a 180 s watchdog and the summary says how many browser checks were
  skipped; the strict Maillot audit also scans the frontend's OSC literals and fails if the catalogue
  does not resolve them.

## [Desktop 0.2.27] - 2026-09-21

This section carries 0.2.27's own work together with the 0.2.22 to 0.2.26 builds, which were emitted
while the version line was being corrected from `1.2.x` to `0.2.x`; those builds now have their own
sections below, cut from their own release notes. An item here that names an earlier build belongs to
that build; everything else shipped by 0.2.27.

### Added

- **Custom meter banks in the Meter Bridge.** A bank is a named subset of the watchlist
  ("Voces", "Bateria"...) that the operator builds with **+ New from watchlist** and then uses
  as a filter of its own. Right-click a bank to rename it, refresh it from the current
  watchlist or delete it (with the app's own confirmation). They live in their own section
  under a rule, clearly apart from the standard groups, and are stored in `wing_meter_banks`
  in localStorage. `scripts/test-desktop-meter-banks-browser.mjs` pins the whole contract.
- **Field validation.** The editor accepted anything: `asdoijasod` in Threshold and `iuanf4ur`
  in the channel list were saved without a word and the macro then did nothing on the desk.
  Every typed field now has a rule — numbers with their range and unit, channel ids with the
  grammar (`1,3-5`) and the size of the selected family, the OSC address shape, on/off and
  choice parameters, and the macro name. Invalid values are marked **where they are** (red
  inset and the reason underneath, also in the tooltip) as they are typed, and **saving the
  draft or arming a macro is refused** with a dialog that lists what is wrong.
  `scripts/test-desktop-field-validation-browser.mjs` covers it.

### Fixed

- **Quitting asks first, always.** Closing the window previously asked only when there were
  unsaved changes, and the app menu's Quit (Cmd+Q) bypassed the question entirely: Tauri's
  predefined Quit goes straight to `terminate:` and never raises `RunEvent::ExitRequested`.
  The app now builds its own menu (mirroring the default one, so Cut/Copy/Paste are intact)
  with a Quit item that asks through the same Win95 dialog, and the window-close path asks
  whether or not the draft is dirty.

- **Typing after a click works: WebKit was closing its editing pipeline.** Measured with a
  temporary diagnostic inside a real instance of the packaged app: the window is focused, the
  page reports focus, the field is the active element, the keydown arrives with
  `defaultPrevented=false` — and `document.execCommand("insertText")` still returns **false**.
  On a field that has been clicked and released, `focus()` alone leaves it closed while
  `focus()` + `setSelectionRange` (or `blur()` + `focus()`) re-opens it, which is why holding
  the mouse button worked (the mouse-down establishes the selection) and why right-click →
  Edit always worked (it calls `select()`). `placeCaret()` in both windows now re-applies the
  selection after focusing and, when `queryCommandEnabled("insertText")` still says no, toggles
  the focus and restores the caret to the clicked position. Verified end to end on a real
  instance of the built app with the diagnostics removed: click, release, type, and the
  character lands.

- **Closing the app now closes it, and the confirmation dialogs are small again (0.2.26).**
  `core:window:allow-destroy` was not granted, so Tauri rejected its own `destroy()` and the window
  never closed; and macOS keeps an app alive after its last window closes, so even a successful
  destroy left the process and its Dock icon behind. The main window's destroy event now exits the
  process, the dialog buttons are no longer inverted, the reusable dialog is 400px wide instead of
  inheriting the Preferences window's 650x560, and a click on a value selects it so typing
  overwrites it.

- **The seam between the two columns was 24px wide.** The layout added the resizer's 8px **plus**
  the two 8px grid gaps. The column gap is now 0, the resizer measures 6px and wears the panel
  colour (with the 2px groove that lights up amber on hover) instead of letting the page background
  show through as a coloured stripe.

### Naming

- **The desktop line is 0.2.x.** The sequence went `0.1.1`, `0.1.2` and then jumped to `1.2.1`,
  which was a labelling mistake: the intended number was `0.2.1`. The mapping is `1.2.N ≡ 0.2.N`
  and the version in the tree is now `0.2.22` (build `20260921.9`). Emitted artifacts keep their
  original names because the version inside them reads `1.2.x`; nothing compares versions
  internally (`APP_VERSION_INFO` is only displayed, the data formats carry their own
  `schemaVersion`), so the correction is safe.

### Fixed since 0.1.2 (the entries that were still in Unreleased)

- **"Test Action (Shoot)" now runs the real step dispatcher.** It used to call
  `send_osc_message` with the step's raw address/kind/value, which bypassed
  `execute_configured_show_action`. A `toggle` step stores no value by design, so the
  test sent a fixed value and the parameter never alternated, while the macro timeline
  toggled correctly. The button now sends the selected step through the new
  `test_action_step` command, so toggle, fade, delay and HUD behave exactly like a
  macro run.
- **A stale action target can no longer be sent or saved.** `#osc-address` is resolved
  asynchronously (debounced preview plus the target `change` handler), so clicking
  Shoot / Save Draft / Arm could read the config before the new channel had resolved
  and fire the **previous** channel's command. Every path that reads the config now
  resolves the current target first; when a configured target does not resolve, the
  address is cleared instead of keeping the old one. The address preview also syncs the
  step model, so a re-selected step can no longer restore the old address.
- **Toggle is only offered for on/off parameters.** The mode option is disabled (and a
  toggle step reverts to Set with a log line) unless the selected target parameter is
  binary, matching the preflight rule.
- **The icon + name block in the header is a label again, not a button.** Moving About to
  the logo alone left the block with the pointer cursor, a raised hover and a pressed
  state, so icon and name together still behaved like one big button that did nothing.
  Only the logo keeps the pointer, the hover, the pressed state, `role="button"` and
  keyboard focus. A stray `overflow: hidden` declaration that sat outside any rule in the
  logo block (and therefore never applied) was dropped with it.
- **The Meter Bridge keeps its group and bank pickers in a vertical sidebar too.** The
  same problem as the matrix selector, in the bridge's own toolbar: Watchlist / USB 1-48
  / CH 1-40 / AUX 1-8 / BUS 1-16 / MAIN & MTX plus the four banks sat in a horizontal
  strip between the title bar and the meters, and on a narrow bridge window they pushed
  the meters aside and scrolled sideways. They are now two labelled sections (GROUP and
  BANK) in a 112px left sidebar, measured so the widest label ("MAIN & MTX", 66px) fits
  with room for the Win95 scrollbar; the bank section hides with its banks when the active
  group has none. The matrix dialog's sidebar was tightened from 168px to 152px for the
  same reason (its widest label measures 127px), which gives the grid back 16px. The
  meters keep the rest of the width: 846px at the bridge's default 960px window.
- **The matrix selector keeps its families and categories in a vertical sidebar.** With
  eleven source families (USB, Card, Local XLR, AES50-A/B/C, StageConnect, Module, USB
  Play, AES/EBU, User Sig, Oscillator, Bus/Main/Mtx Src) the horizontal chip bar needed
  its own horizontal scrollbar just to reach the last group, and the bar took width away
  from the grid. Families and categories are now two labelled sections in a left sidebar
  styled like the Properties one, and the redundant "Jump to" dropdown went with the bar:
  the whole list is visible at once. Applied to both windows (the main dialog and the
  Meter Bridge's).
- **`window.confirm()` returns false in the packaged app, and every "are you sure?" written
  with it silently cancelled its own action.** WKWebView has no dialog delegate, so the
  meters **Clear** button (the one reported), **Panic Stop**, the station-backup restore,
  the factory reset, "Replace & View" in both windows and the unsaved-draft guard all did
  nothing when they should have asked. Both windows now own a Win95 confirmation dialog
  (`win95Confirm` / `metersConfirm`, `Enter` accepts, `Escape` cancels, the backdrop
  cancels, and the dialog owns the keyboard while it is up) and no native `confirm` call
  remains; `test-desktop-ui-contracts.mjs` fails if one comes back, comment-aware.
- **The window being key is not enough: the webview has to be the first responder.** The
  click-to-edit fix claimed the window, but WebKit only takes text input when its own view
  holds the first-responder status, which `WebviewWindow::set_focus()` does not give it. A
  new `focus_webview` command reaches `Webview::set_focus()` (the `unstable` Tauri feature
  exposes `Manager::get_webview`), the app hands focus to the webview whenever the window
  gains it, and the field click path now asks for both the window and the webview, logging
  `window_focus_failed`/`webview_focus_failed` if either is refused.
- **Settings block titles cut their line cleanly again.** The fieldset legends carry an
  explicit block of the panel's own colour behind the title (themed, so dark mode follows),
  so the border stops at the text instead of running into the glyphs.
- **The catalogue is model-aware: every channel plugin table is in the build.** A channel's
  gate, compressor and EQ parameters exist only for the model loaded on that strip, and the
  catalogue only knew the generic names plus the three models verified by hand (DEQ2, WARM,
  LMT). `scripts/wing-plugin-models.mjs` now reads the Maillot appendix and generates
  `crates/wing-core/src/plugin_models.rs`: **99 models and 1013 parameters**, with the model
  lists each channel section accepts, and the appendix's own value descriptions kept
  verbatim. `wing-core::plugin_spec` turns those descriptions into editing metadata (range,
  step, unit, options, toggle), and `target_catalog` sends both to the frontend as
  `pluginModels` + `channelGateModels`/`channelDynModels`/`channelEqModels`.
  Name quirks are handled explicitly instead of silently: glued footnote digits (`ONEC22` is
  ONEC), variant names (`D241G`/`D241C` map to the single `D241` table through a generated
  alias list) and the appendix's repeated `CMB.peak`, which is dropped and recorded. Both the
  generator (`--check`) and `scripts/test-plugin-models.mjs` fail if the committed table
  drifts from the appendix; fourteen Rust tests cover the parser and the hardware-verified
  models.
- **The Meter Bridge ruler measures the real track instead of guessing it.** It placed its track
  with hard-coded 34px/62px offsets while the bars measure their fill against `.v-bar-track`,
  so the marks drifted: measured, the -18 mark sat at y=301.5 while a -18 dBFS bar topped
  out at y=307.3 (about 6 px). The ruler now measures the real track on every redraw, so it
  follows the strip chrome and the meter scale; worst offset is 1 px, from centring the
  label on its line. Locked by `scripts/test-desktop-bridge-ruler-browser.mjs`, which feeds
  eight levels and compares each fill's top edge with its mark (4.5 px without the fix).
- **The click-to-edit fix could never run: `setFocus` was not permitted.** 1.2.21 added a
  `pointerdown` handler that claims the window with `getCurrentWindow().setFocus()` before
  focusing the field, because WebKit refuses every edit while the window is not key. The
  Tauri capability only granted `set-always-on-top`, `set-position` and `set-size`, so the
  call was rejected and the rejected promise was swallowed: the fix did nothing and looked
  like a wrong diagnosis. `core:window:allow-set-focus` is now granted, the window is
  claimed on every click over a field (not only when `document.hasFocus()` is false, which
  reads true in the app even when the window is not key), and a rejection is logged as
  `window_focus_failed` instead of vanishing.
- **A contract test now cross-checks the two sides.** `test-desktop-ui-contracts.mjs`
  reads every window API the frontend calls (`setFocus`, `setAlwaysOnTop`, `setPosition`,
  `setSize`, …) and fails if `capabilities/default.json` does not grant it. The missing
  permission above was invisible to every existing check.
- **The meter watchlist starts empty and its only list action is Clear.** A fresh
  install used to seed USB 1, 2 and 3, and the meters panel offered "Reset list"
  (restore that seed) next to "Clear" — two buttons that meant nearly the same thing.
  The seed is gone in both windows (the dock and the Meter Bridge now start with no
  meters selected, each showing its own empty state that points at the matrix), the
  Reset button and its handler are gone, and Clear keeps its confirmation. The
  unused `.meter-btn-reset` rule went with it.
- **A left click on a field now starts editing even when the window is not focused.**
  Measured in the real engine (WKWebView, via `scripts/dev-webkit-probe.swift`): a field can hold
  the DOM focus while WebKit refuses every edit — typing and even `execCommand("insertText")`
  do nothing while the window is not key, and the very same click types fine once it is. On top
  of that, macOS does not send the click that activates an inactive window to the web content
  unless `acceptFirstMouse` is on, which is why right-click → Edit was the only route that
  worked. The main window now sets `acceptFirstMouse`, the Meter Bridge sets
  `accept_first_mouse(true)`, and both windows claim the window (`setFocus`) and focus the field
  on the first click when `document.hasFocus()` is false. The `user-select` guard rule stays,
  but its comment no longer claims to be the fix: A/B measured in WKWebView, the macro fields
  already computed `user-select: text` with and without it.
- **HUD alerts appear fully formed.** The card slid in with `hudSlideIn` (and the toast with
  `hudToastIn`), a fade/translate animation that looked glitchy and left the alert briefly
  translucent right when it had to be read. Both keyframes are gone, along with the card's
  `transform` transition, in the main window and in the Meter Bridge; the flash rules no
  longer chain the entrance animations either. The regression test now samples from the
  first instant and asserts that only `hudStrobe*`/`hudPulse*` may animate the alert.
- **The HUD alert flash no longer makes the window blink.** `hudStrobe`/`hudPulse`
  animated `opacity` from 1 down to 0.15 on the alert card and — in fullscreen — on the
  overlay itself, so a strobing alert (and in fullscreen the whole window) appeared and
  disappeared. The flash is now a colour highlight that never touches opacity: the card
  ring and the title bar pulse between the urgency colour and its bright variant, and
  fullscreen washes the screen with an inset shadow that paints over the overlay
  background (a custom colour is included, since that background is set with
  `!important`). The one-shot entrance animations (`hudSlideIn`, `hudToastIn`) are
  preserved instead of being replaced by the flash. Alert text stays fully opaque and
  legible: the fullscreen message is white on the dark wash, and a custom accent now
  darkens the title bar and keeps the title white instead of drawing accent-on-accent
  text that was invisible.

### Changed

- **A new macro is born unconfigured.** The New button used to hand out a macro that
  already read `usb 1 meter -> /ch/1/mute`, so a blank macro looked ready to listen and
  fire, and the Rust normaliser painted those same defaults back on every save. Trigger
  source/channel/parameter and the action target now start empty, `Add step` adds an
  unconfigured step instead of a channel-1 mute, and an empty value is preserved as
  empty on save. An enabled macro that is not configured cannot be enabled from the
  library list, and preflight explains exactly what is missing.
- **An incomplete macro no longer breaks the session.** An empty trigger used to make
  `start_wing_usb_stream` fail with "no native meter or OSC state trigger resolved
  for    ", so creating a new macro broke Live for every other macro. Unconfigured
  enabled macros are now skipped and reported through a `macro-library-warnings` event
  (log + `[NOT LISTENING]` block) while the rest keep running.
- **Saved library edits are re-applied to a running session.** The runtime captures the
  macro set when the stream connects, so an edit saved while live kept running the
  previous macros until a manual Disconnect/Connect. Saving a changed macro now
  restarts the stream with the new library automatically (logged as
  `live_macros_reapplied`); a rename or colour change does not, because the signature
  only covers the fields the runtime compiles.

### Tooling

- **Every control on screen now answers the Inspector and the hover box.** The hint map
  went from 77 to 220 entries (library toolbar, macro editor, HUD alert fields and
  defaults, meters, OSC monitor, network, matrix dialog, deletion dialog, diagnostics),
  and the fallback that covers the rest was rewritten: it reads the real label (including
  `<label>Text <input/></label>` shapes), says what the control is and what it currently
  reads ("Dropdown with 5 options, currently set to …", "Check box, currently ON [X]",
  "Slider from 150 to 2500, currently 330"), names the block it belongs to instead of the
  old "WING CONTROL" placeholder, and humanises the id when there is no label at all. The
  Meter Bridge got the same generic fallback, so its ScreenTips are no longer a flat
  "WING meter bridge control."
- New regression test `scripts/test-desktop-inspector-hints-browser.mjs`: checks that a
  control with its own entry answers as itself (not as its container), that the fallback
  names the label, the kind and the current value (exercised with synthetic controls so it
  keeps working for controls added later), that the settings dialog answers, that every
  visible control in the main window has a real hint (79 today), and that every control in
  the Meter Bridge and its matrix dialog shows a titled ScreenTip (12 + 23 today).
- New regression test `scripts/test-desktop-hud-flash-browser.mjs`: drives all 36
  combinations of display mode, urgency and flash style (plus a custom colour in
  fullscreen) and asserts that the overlay, card and title bar keep opacity 1 at every
  instant while the flash really highlights a colour or a ring — the guarantee that broke
  when the flash animated opacity.
- New regression test `scripts/test-desktop-action-target-browser.mjs`: drives the real
  `index.html` in Chrome with a stubbed Tauri IPC and checks the new-macro defaults, the
  retarget/race behaviour, toggle availability, the Shoot dispatch, the live re-apply and
  the enable guard. `verify-all.sh` now runs every `*-browser.mjs` test and opens the
  window tab itself when Chrome is on port 9223. Browser tests run under a 180 s watchdog,
  so a hung one fails the gate instead of blocking the session.

### Fixed (audit pass)

Everything below comes from the five-facet audit, re-verified against the code before being
touched; the findings that turned out to be false positives were left alone.

- **A malformed meter datagram no longer cancels every armed macro.** `decode_report` only
  rejects packets shorter than the 4-byte report id, but the `?` on its result ended the
  session. It is now ignored with a trace, and a non-timeout socket error is logged once per
  error kind while the receive watchdog decides whether the link is really gone.
- **A toggle confirmed the write before writing it.** The read-back ran before the send, so
  every successful toggle read the console twice, compared the untouched value against the
  new one and reported a verification failure. It is now sent as a discrete `set` so the
  read-back happens after the write. Locked by a fake-console integration test.
- **`parse_osc_arg("bool", …)` refused to guess.** Any value that was not `1/true/on/yes`
  became `false`, so a typo silently sent OFF; unknown spellings are now an error.
- **"Reset PK" now clears the clip latch** (it was re-latched by the next frame), and
  "Infinite (Latch)" peak hold survives a restart (JSON has no `Infinity`, so it was stored
  as `null` and reset the peak on every frame).
- **F12 respects the Panic confirmation preference**, and the same preference is honoured by
  the double-click alias path.
- **The IF gate summary no longer adds "dB" to state comparisons** (`mute 1 dB`).
- **The HUD alert panel is what it says.** Its values seed a step when the action mode is
  switched to Alert/HUD; the alert engine never read them before. The inert "fallback to
  Main" preference is gone (the fallback is always on) and `popout_autoclose` now has a
  control and the callback it was checking for.
- **Controls that promised and did nothing now work or are gone:** meter Reset restores the
  documented USB 1-3 defaults (it was a duplicate of Clear), the dock seeds them on first
  run, "pause auto-scroll when scrolled up" listens to the scroll, OSC syntax colours have
  the CSS rule they toggle and are applied on boot, the matrix cell size is applied, the
  Re-dock button has a handler, the factory reset sweeps every `wing_*` key (the hand-written
  list left ~20 behind), and the context menu's "Set as Macro Trigger" item exists. The
  checkbox promising a "Live Trigger" in the macro menu was removed: no such runtime command
  exists.
- **Dead wiring removed:** `.trigger-preset`/`.target-preset` handlers and
  `setTriggerSelection` (no such elements), a second `escapeHtml` that returned `""` for `0`,
  a browser popup fallback for the Meter Bridge that had no IPC, and the unreachable
  rehearsal stream branch.
- **The inspector hint fallback derives its section and title** from the surrounding fieldset
  legend and the control's own label instead of labelling ~150 controls "WING CONTROL"; the
  orphan hint keys and the phantom fade "curve" are gone.
- **The unsaved draft is visible ("Editing draft*") and guarded on window close** through
  Tauri's close request (not `beforeunload`, which also blocks reloads).

- **Meter Bridge:** it reads `wing_peak_config` (clip latch), distinguishes "no meter frames"
  from "link down" with an amber badge, has its own graph-speed key with a throttled push,
  positions the vertical scale marks by the same mapping as the fill, validates the stored
  style, and drops the dead `window.close()` fallbacks. Its meter source is released when the
  window closes, and a stream restart keeps the bridge's watchlist.
- **State refresh during a long fade:** the rotating leaf read used to lose every race for a
  slot in the global OSC limiter, so a condition could be evaluated against state nobody had
  confirmed for seconds. It now takes its slot (a fade loses one 17 ms slot per 500 ms) and
  the staleness window stays bounded.
- **Exports are written atomically and imports are size-capped** (8 MB); recovery snapshots
  carry milliseconds + pid + a sequence (two in the same second used to overwrite each other)
  and the oldest 20 are pruned.
- **`is_meters_window_open` answers whether the window exists**, so Cmd+M closes a minimised
  bridge instead of re-showing it; opening a closing window rebuilds it.
- **`parse_ids` honours its cap for comma-separated ids too** (the range branch already did).

### Protocol findings (a WING Rack, verified on hardware, read-only)

- **Gate and compressor parameter names belong to the strip's model**, confirmed by reading
  `/gate/mdl`, `/dyn/mdl` and `/eq/mdl`: `/ch/1` runs `DEQ2` (so `/ch/1/gate/thr` is silent
  while `/ch/1/gate/1-thr` = −32.5 and `/ch/1/gate/2-thr` = −30.5 answer), `/ch/36` runs
  `GATE`, `/main/1/dyn` runs `WARM` (drive/mix/trim answer, `thr` is silent) and `/mtx/1/dyn`
  runs `LMT`. The app now notes model dependence in preflight and, when a read-back fails,
  reports the model it read from the strip. Full model-aware parameter lists (DEQ2 bands,
  WARM, LMT, …) remain open.
- **Matrix, bus and DCA paths answer**: `/mtx/1/mute`, `/mtx/1/fdr`, `/bus/1/mute`,
  `/bus/1/send/1/lvl`, `/dca/1/mute`, `/ch/1/send/1/lvl`, `/ch/1/eq/1g`, `/ch/1/gate/on`,
  `/ch/1/dyn/on`. Matrices have no sends, and `/ch/1/postins/on` and `/main/1/postins/on`
  answer while `/aux/1/postins/on` stays silent — all of which the catalogue already reflects.

### Tooling

- `ws` is now a declared devDependency: the browser tests import it, and a clean `npm ci`
  would otherwise fail the gate for a missing package that only existed transitively.

## [Desktop 0.2.26] - 2026-09-21

- **Closing the window really closes the application.** `core:window:allow-destroy` was not granted, so
  the `destroy()` call Tauri's own close handler makes was rejected and the red button did nothing, and
  macOS keeps an application alive after its last window closes, so even a successful destroy left the
  process and its Dock icon behind. The main window's destroy event now exits the process (after closing
  the Meter Bridge and stopping the stream), and the confirmation dialog is the right way round: accepting
  closes, the button says "Close without saving", and only "Keep editing" prevents the close.
- **The confirmation dialogs are small again.** The reusable dialog inherited the Preferences window's
  650x560 size and looked absurd around two lines of text; it is now 400px wide and fits its content.
- **A click on a value selects it**, so typing overwrites the value instead of landing at the left edge,
  and a second click inside the field places the caret where the operator points. That selection is also
  what re-opens WebKit's editing pipeline, so typing keeps working.
- **The build refuses an icon that has lost its alpha channel.** The Dock was drawing a dark square for an
  installed copy whose bundle carried the correct transparent artwork: macOS had cached the icon for an
  older bundle path. LaunchServices was refreshed and the Dock restarted, and the build now fails rather
  than packaging such an icon.

## [Desktop 0.2.25] - 2026-09-21

- **Clicking a field and typing works, and the cause was measured rather than guessed.** The operator's
  "it only works while I hold the click" reproduced in the WebKit harness: on mouse-up WebKit keeps the DOM
  focus but closes its editing pipeline, so `insertText` returns false and nothing typed lands. Measured on
  a clicked-and-released field, `focus()` alone left it closed while `focus()` with a selection range, or a
  blur followed by a focus, re-opened it — which is why holding the button worked (the mouse-down sets the
  selection) and right-click → Edit always did (it calls `select()`).
- **`placeCaret()` restores the caret to the clicked position**, after focusing and, when WebKit still
  refuses the edit, by toggling the focus and putting the selection back. It runs from the claim path on
  both the press and the release in both windows, and the fix was verified end to end on a real instance of
  the built application with the diagnostics removed.

## [Desktop 0.2.24] - 2026-09-21

- **The click failure is reproduced, and the fix targets what was measured.** The operator's report — it
  works only while the button is held — reproduced in the WebKit harness: the engine gives the page focus on
  mouse-down and takes it back on mouse-up while the field keeps the DOM focus, so releasing the button made
  the field deaf and `window.focus()` did not restore it. A single `claimFieldFocus()` path in both windows
  now asks for the window (`setFocus`) **and** the webview (`focus_webview`), runs on the press and again on
  the release once the platform has handled it, and re-checks the focus a few times over the following
  second while the operator is still in the same field; a refusal is logged instead of vanishing.
- **The parameter selector offers the loaded model's own parameters.** With the strip models read from the
  console, the dropdown now lists that model's appendix parameters (`gate:1-thr`) with their documented
  ranges, validated against the generated plugin table before the address is built, because the generic
  name is silent on a strip that does not run that model.

## [Desktop 0.2.23] - 2026-09-21

- **The click fix moves to the layer that was missing: the webview's own focus.** Raising the window did not
  make WebKit's view the first responder, and WebKit only takes text input in that state. A new
  `focus_webview` command calls `Webview::set_focus()`, the application hands focus to the webview whenever
  the window gains it, and a click asks for both the window and the webview — logging
  `window_focus_failed` or `webview_focus_failed` if either is refused.
- **Several confirmation buttons were cancelling themselves, because `window.confirm()` returns false in
  the application.** WKWebView has no dialog delegate, so Clear in the meters panel, Panic Stop, the
  station-backup restore, the factory reset, Replace & View in both windows and the unsaved-draft guard all
  did nothing when they should have asked. Both windows now own a Win95 confirmation dialog — Enter accepts,
  Escape or the backdrop cancels, and the dialog keeps the keyboard while it is up — and a contract test
  fails if a native `confirm` call returns.
- **The strip model is read and shown.** The new read-only `read_strip_models` asks `/gate/mdl`, `/dyn/mdl`
  and `/eq/mdl` for the selected channels, and the Action panel shows what answered
  (`GATE 3=DEQ2 · DYN 3=WARM · EQ 3=STD`) under the parameter selector; a slot that stays silent is
  reported as such, which is exactly why a write to the generic name is ignored. The read is debounced to
  one round trip per edit, and a newer edit discards an older answer before it is painted.
- **Settings block titles cut their line cleanly again**, with the panel's own themed colour behind the
  legend so the border stops at the text.

## [Desktop 0.2.22] - 2026-09-21

- **The desktop line is numbered `0.2.x` from this release on.** The sequence went `0.1.1`, `0.1.2` and
  then jumped to `1.2.1`, which was a labelling mistake — the intended number was `0.2.1` — so the mapping
  is `1.2.N ≡ 0.2.N` and the previous release is `0.2.21` in the corrected line. Emitted artifacts keep
  their original names, because the version inside them reads `1.2.x`; nothing compares versions
  internally, so the correction is safe.
- **The click-to-edit fix could never run: the window focus permission was missing.**
  `capabilities/default.json` granted only `set-always-on-top`, `set-position` and `set-size`, so Tauri
  rejected `setFocus()` and the rejected promise was swallowed — the handler did nothing at all.
  `core:window:allow-set-focus` is granted now, the window is claimed on every click over a typeable
  control rather than only when `document.hasFocus()` is false (which reads true in the application even
  when the window is not key), and a rejection is logged as `window_focus_failed`. A contract test
  cross-checks every window API the frontend calls against the capability list, so a missing permission can
  never be silent again.
- **HUD alerts flash in colour instead of blinking.** The alert card and, in fullscreen, the overlay itself
  animated opacity down to 0.15, so the alert — and with it the whole window — appeared and disappeared.
  The ring and the title bar now pulse between the urgency colour and its bright variant, fullscreen washes
  the screen with an inset shadow that paints over the background (a custom colour included), and the alert
  text stays opaque. The entrance animations are gone as well: an alert appears fully formed.
- **Every control answers the Inspector and the hover box.** The hint map grew from 77 to 220 entries and
  the fallback that covers the rest was rewritten to read the real label, say what the control is and what
  it currently reads, name the block it belongs to instead of the old placeholder, and humanise the id when
  there is no label; the Meter Bridge has the same fallback. The on-screen balloon now waits 800 ms of rest
  before appearing and leaves as soon as the pointer really moves.
- **The selector layout was tidied.** Families and categories moved into a vertical sidebar in the matrix
  selector and in the Meter Bridge, so neither needs a horizontal scrollbar and the bridge ruler lines up
  with the bars (worst offset 1 px); the fresh-install meter seed and its "Reset list" button are gone,
  leaving "Clear" as the only list action, and the header's icon-and-name block is a plain label again,
  with only the logo keeping the pointer and keyboard focus.

## [Desktop 1.2.21] - 2026-09-21

- **A left click on a field starts editing again.** Measured in the real engine (WKWebView, since Chrome
  does not reproduce this), a field can hold the DOM focus while WebKit refuses every edit, and macOS does
  not deliver the click that activates an inactive window to the web content unless `acceptFirstMouse` is
  on — which is why right-click → Edit worked and a direct click did not. Both windows set
  `acceptFirstMouse` and, on the first click over a typeable control, claim the window (`setFocus`) and
  focus the field. The record for 1.2.20 is corrected too: the `user-select` rule was not the cause, as A/B
  measurement showed, and it stays only as a guard against blocks that set `user-select: none`.
- **HUD alerts flash in colour instead of the window blinking.** The alert card and, in fullscreen, the
  overlay animated opacity, so the alert and the window appeared and disappeared; the flash is now a ring
  and title-bar pulse between the urgency colour and its bright variant, with an inset wash in fullscreen
  that also works over a custom colour, and the alert text stays opaque. The entrance animations are gone:
  an alert appears fully formed.
- **Every control answers the Inspector and the hover box.** The hint map grew from 77 to 220 entries and
  the fallback was rewritten to read the real label, describe the control and its current value, name the
  block it belongs to instead of the old placeholder and humanise an unlabelled id; the Meter Bridge got
  the same fallback, so its ScreenTips are no longer a flat "WING meter bridge control."
- **Four new instruments keep this honest**: browser suites covering the 36 display × urgency × flash
  combinations in both windows, the inspector hints (an own entry beats its container, the fallback, 79
  main-window controls and 12 + 23 bridge controls) and cold and warm first clicks, plus a WKWebView probe
  that drives the real UI to settle Chrome-versus-WebKit differences.

## [Desktop 1.2.20] - 2026-09-21

- **Fields are editable in the application again.** WebKit inherits `user-select: none` into form controls,
  so any input inside a card that set that rule refused the caret and behaved like a read-only label while
  still looking editable; Chrome ignores the rule for form controls, which is why it looked fine in a
  browser. Selection is now restored explicitly for every control that can be typed in and kept off only
  for the controls that are dragged (ranges, checkboxes, radios). Focusing a numeric or id field selects
  its content, so typing replaces the value instead of landing inside it, and right-clicking any editable
  field offers Edit, Select All, Copy Value, Paste and Clear, while channel id fields keep their richer
  menu.
- **Builder and library polish.** The id chips under the trigger and target panels are gone, Quick
  Templates and their code are gone, "Save changes" in the Build Macro header saves the draft like "Save
  Draft" (respecting Live Safe Mode and the unsaved-changes guard), only the logo opens About, and the
  inspector and hover box now describe the per-macro row buttons instead of borrowing their container's
  text.
- **The compressor model the matrices run had no parameters of its own.** `LMT` exposes `/dyn/tspd`,
  `/dyn/trans`, `/dyn/tgain`, `/dyn/ton`, `/dyn/comp`, `/dyn/cgain` and `/dyn/con` rather than the generic
  compressor names (its `/dyn/thr` is silent), so those are now selectable with their appendix ranges, and
  the mix label was corrected for the models that do have it.

## [Desktop 1.2.19] - 2026-09-21

- **Test Action (Shoot) runs the macro's own dispatcher.** It used to send raw OSC with the step's address
  and value, bypassing the executor: a Toggle step carries no value by design, so the test sent a fixed
  value and the parameter never alternated while the timeline toggled correctly. The button now runs the
  selected step through the same dispatcher a macro run uses, so toggle, fade, delay and HUD alerts behave
  identically, and the read-back that reports an ignored write applies to the test too.
- **A changed action target is never sent or saved as the old one.** The address resolves
  asynchronously, so clicking Shoot, Save Draft or Arm could read the configuration before a new channel had
  resolved and fire the previous channel's command. Every path that reads the configuration now resolves
  the current target first and clears the address when a configured target does not resolve; Toggle is
  offered only for on/off parameters or a custom address, which preflight judges.
- **A new macro starts unconfigured.** The New button used to hand out a macro that already read
  `usb 1 meter -> /ch/1/mute`, and the normaliser painted those defaults back on every save, so a blank
  macro looked ready to listen and fire. Trigger source, channel, parameter and action target now start
  empty, `Add step` adds an unconfigured step, and an empty value stays empty. An enabled but unconfigured
  macro cannot be switched on and preflight explains what is missing; an incomplete macro is skipped and
  reported instead of breaking the session, and saving a changed macro re-applies it to a running session
  (`live_macros_reapplied`).
- **Work is no longer lost.** Switching, creating, duplicating, importing and deleting macros asks before
  discarding an unsaved draft (the delete dialog says the editor changes will be lost), Replace & View and
  Clear confirm before wiping the meter watchlist, the legacy "demo alias" purge runs only when the whole
  watchlist is legacy demo data (it used to delete every configured meter if a single alias matched), and
  Connect + Listen no longer saves a half-finished draft without saying so. **Live Safe Mode is real**:
  with the stream running it blocks saving, creating, enabling, deleting, duplicating, importing,
  reordering and the factory reset, explains why and disables those buttons, while the editor still takes
  typing.
- **Three read-only audits measured the interface, and their findings were fixed.** The header overflowed
  by 174 px at the window's own minimum width and pushed Properties, Help and Meters off-screen; the column
  divider followed the pointer 51 px behind and a 480 px dead strip appeared when the columns stack; amber
  live telemetry on grey at 1.45:1 and a Meter Bridge peak number at 1.19:1 were effectively invisible.
  The Meter Bridge now grows its text with the zoom, shows a numeric level in VU and History and releases
  its meter source when it closes; a dialog owns the keyboard (global shortcuts no longer change the macro
  behind a modal, the Matrix takes focus and F12 still reaches the panic stop); Win95 details were
  corrected (hard shadows instead of blur, monochrome glyphs, hidden leftovers), and Help and About now
  say what the application does.
- **Model-dependent gate and compressor parameters are selectable.** Their names belong to the model
  loaded in the strip, so `/gate/thr` is silent on a `DEQ2` strip and `/dyn/thr` on a `WARM` compressor.
  The catalogue now offers the model's real parameters with their documented ranges — for example
  `/gate/1-thr`, `/gate/2-thr` and `/gate/1-g` for DEQ2, `/dyn/drv`, `/dyn/trim` and `/dyn/mix` for WARM —
  and the strict path audit indexes the plugin appendices, so it stays at zero unknown addresses. Every new
  path was confirmed by reading the console (verified on hardware).

## [Desktop 1.2.18] - 2026-09-21

Build `20260921.5` (macOS Apple Silicon). Distributed from `dist/v1.2.18/`; the
operator-facing summary lives in `desktop/release-notes/1.2.18.md`.

### Added

- New action mode **Toggle (flip on/off)** for binary parameters: instead of forcing
  a value, the step reads the current state from the console and sends the opposite.
  Useful for footswitch-style macros, alternate source flips or any cue that should
  reverse what the console is doing now.
- The read happens on the action's own socket at execution time. Verified on
  hardware that the console answers the requesting socket even while the streaming
  window holds the `/*S` subscription, so the value is authoritative rather than a
  cached guess.
- Preflight accepts a toggle only on an on/off parameter (mute, phantom, phase, alt
  source, send on/off, insert, user button). A toggle on a fader or a filter is
  rejected with a clear message; a raw custom address is allowed with a note.
- The editor hides the value field for a toggle and explains the behaviour, because
  the value is not authored.

### Safety

- A toggle **fails closed**: if the console does not answer within 400 ms, or answers
  with anything that is not a clean 0 or 1, nothing is sent and the step reports what
  it saw. Guessing would make the result unpredictable.
- A toggle is **not idempotent**: every trigger flips the state, so a duplicated or
  repeated trigger flips it back. `Set` remains the mode for anything that must land
  in a known state.

### Validated on hardware (writes included)

- Toggle alternation in both directions on `/ch/36/mute`, with read-back each time.
- `/ch/1/eq/lg` (the new `eq_low_gain` parameter) accepted `-3.0` and read it back.
- Writing `-50.0` to the footnote-suffixed `/ch/36/gate/thr23` left the threshold at
  `-40.0` while the corrected `/ch/36/gate/thr` accepted `-50.0`: the silent no-op
  fixed in 1.2.16 is now proven rather than inferred.
- Every touched value was read first and restored afterwards.

## [Desktop 1.2.17] - 2026-09-21

Build `20260921.4` (macOS Apple Silicon). Distributed from `dist/v1.2.17/`; the
operator-facing summary lives in `desktop/release-notes/1.2.17.md`.

### Fixed

- The detached Meter Bridge window opened but never received meter frames. Tauri v2
  gives a window no IPC access at all unless a capability lists it, and
  `capabilities/default.json` listed only `main`, so the `meters` window could not
  subscribe to events and its watchlist never reached the backend. The capability
  now covers `main` and `meters`.
- Pin and the saved window geometry would still have failed: `core:window:default`
  only grants read access. The capability now also grants
  `core:window:allow-set-always-on-top`, `allow-set-position` and `allow-set-size`.
- Closing the detached window from its right-click menu used `window.close()`, which
  does nothing for a window the application owns; it now uses the real command.
- The Meters card had two buttons doing the same thing, in the header and in the
  toolbar, with different labels. The toolbar duplicate was removed and the
  remaining button reads **Popout**, switching to **Focus** while open.

### Added

- `scripts/test-desktop-ui-contracts.mjs` now reads every window label the Rust side
  creates and fails if no capability covers it, and verifies the window permissions
  the Meter Bridge calls are granted.

## [Desktop 1.2.16] - 2026-09-21

Build `20260921.3` (macOS Apple Silicon). Distributed from `dist/v1.2.16/`; the
operator-facing summary lives in `desktop/release-notes/1.2.16.md`.

### Fixed

- Restored compilation. The IF-semantics session ran out of budget after packaging
  1.2.15 and left `condition_operator_allowed` and `normalize_condition_value`
  undefined, so `cargo check`, `cargo build` and `cargo test` all failed. Both are
  implemented: IF conditions validate the comparator against the parameter's value
  semantics (continuous meters accept `>`/`<`; toggles, route codes and text accept
  `==`/`!=`; OSC numeric state accepts both) and normalize the value (toggle `0`/`1`,
  canonical Maillot route codes, integer rounding, documented-range clamping).
- The OSC state cache kept the ascii rendering of a leaf read instead of the value.
  `/ch/36/fdr` answers `,sff` `("-21.8", 0.3531, -21.752)` and the cache stored
  `"-21.8"`; it now stores the real value, and a non-leaf node listing is never
  cached as state.
- Resolved the real Maillot control paths. `thr23`, `thr26`, `thr32`, `thr37`,
  `thr42`, `thr46` and `lg24` are footnote references glued to the parameter name by
  the PDF text extraction, not path segments; the console only knows `/gate/thr`,
  `/dyn/thr` and `/eq/lg`. Gate and compressor threshold writes were silent no-ops:
  the console ignored them while the app reported success.
- Removed EQ bands 5 and 6, which the STD channel EQ does not have, and added the
  low and high bands (`/eq/lg`, `/eq/lf`, `/eq/lq`, `/eq/hg`, `/eq/hf`, `/eq/hq`)
  that were not automatable before.
- Corrected parameter ranges to the documented values: gate threshold -80..0, gate
  range 3..60, compressor threshold -60..0, EQ band and shelf gain -15..15, Q
  0.44..10, band frequency 20..20000, low 20..2000, high 50..20000.
- A saturated OSC send queue, a poisoned limiter or a socket error on the stream
  thread aborted the whole meter stream, because every paced send propagated its
  failure with `?`. The `/*S` subscription, its renew and the whole priming loop
  could each take the session down mid-show. Failures are now typed and only a real
  operator stop ends the session; anything else is recorded in the OSC monitor and
  skipped, which is safe because the periodic state refresh keeps conditions
  correct while the change-event subscription is degraded.
- An action interrupted by panic stop or by the stream ending (network timeout,
  meter stall, disconnect) was reported as `error`/`failed` and incremented the
  failure counter, telling the operator that a macro broke when it had been stopped
  on purpose. Those runs now report `aborted`; a send rejected while the stream is
  healthy still reports `failed`.
- The 1..9 macro selection hotkey queried `.library-item`, a class that never
  existed, so it did nothing. It now selects the real `macro-row`.
- The library inspector read `macro.actions`, `macro.threshold` and
  `macro.overlapStrategy`, none of which exist on a saved macro, so every row
  reported "Actions: 0 THEN" and a default threshold and overlap policy. It now
  reads `actionSteps`, `triggerThreshold` and `macroOverlapStrategy`.
- The meter context menu's "Win95 History Graph" assigned the nonexistent style
  value `history` instead of `win95_graph`, so it silently fell back to bars.
- The OSC terminal context menu's "Verify WING Identity" invoked `send_test_osc`,
  a command that was never registered, so it only logged a "command not found"
  error. It now runs the Maillot `WING?` probe like the Diagnostics button.
- Read-only triage on the console found four more selectors that wrote nowhere: aux
  filters (`hpf_*`, `lpf_*`; aux has no `/aux/<i>/flt` node), aux gate parameters
  (aux exposes no gate node at all despite the reference listing them), main sends
  (`/main/1/send/1/lvl` is silent; sends exist for ch, aux and bus), and oscillator
  polarity (`/io/in/OSC/1/pol` is silent; the oscillator node has no polarity leaf).
  None of them are offered any more. Aux keeps everything it really has, verified on
  the console: EQ, compressor, fader, mute, trim, phantom, phase and alt source.
- `load_snapshot` and `load_preset` resolved to `/show/load` and `/library/load`,
  which are silent on the console: snapshot and preset loading is a console
  filesystem operation over the snapshot JSON, not an OSC leaf. Both now fail closed
  so preflight rejects them instead of promising a write that never happens.

### Added

- Authoritative OSC state refresh. The console reports state only on change and
  never re-publishes it on subscribe or renew (measured over 112 s), so a single
  lost UDP event left a condition wrong forever. One argument-less leaf read per
  step now round-robins over the addresses used by OSC triggers and IF conditions,
  taking only an already-free OSC send slot so the meter receive loop never waits.
- `scripts/wing-osc-gets.mjs`, `scripts/wing-osc-listen.mjs`,
  `scripts/wing-osc-probe.mjs`: read-only console probes for leaf paths, `/*S`
  events while a control is moved, and subscription-renew behaviour.
- `wing-probe paths` plus `scripts/wing-maillot-path-audit.mjs`
  (`npm run audit:maillot`): dumps every address the catalogue resolves and
  cross-checks it against the reference with footnote digits stripped. First pass
  (superseded by the settled figures in "Known state" below): 332 addresses,
  0 footnote artifacts, 296 exact matches, 34 documented under another prefix,
  2 unknown.
- `scripts/test-desktop-ui-contracts.mjs`, wired into `test:safety`. Its main check
  compares every `invoke("...")` in both desktop windows against the Rust
  `tauri::generate_handler!` list, which is what would have caught `send_test_osc`
  automatically; it also pins the row class, the meter style values and the macro
  field names the inspector reads.

### Documentation

- `docs/maillot-compliance-matrix.md`: hardware-verified audit of the OSC control
  paths, the footnote-marker trap, and the model-dependence of gate, compressor and
  EQ parameters.
- `AGENTS.md`: protocol rules extended with the footnote trap and the
  model-dependence rule; the next version is now 1.2.16 and Android is declared
  parked.
- `desktop/build-dist.sh`: refuses to overwrite an emitted release and always
  releases the DMG scratch volume, even on failure.

### Known state

- Read-only hardware validation reproduced on a WING Rack, verified on hardware: 48 USB
  events, 49 for the mixed collection, 878 values across 16 Source plus 11 Output
  devices. Trigger/action dispatch, reconnect and soak remain unvalidated.
- Confirmed on the console: matrix sends (`MX1..8`) exist. Open: modelling the
  strip's current gate/compressor/EQ model so the editor stops offering parameters
  that model does not expose, and verifying `/main/1/dyn/thr`, `/mtx/1/dyn/thr` and
  `/aux/1/postins/on`.
- Final `npm run audit:maillot` measurement of 2026-09-21: 316 catalogued addresses,
  291 exact, 25 documented under the generic mix layout and 0 unknown. The 25 prefix
  differences are `aux` addresses whose parameter appears in the reference under the
  generic mix layout; each one was verified to answer on the console.

## [Desktop 1.2.15] - 2026-09-21

- Fixed the Maillot Channel 3 source/output device encoding: logical devices 1-16 are now sent as zero-based bytes `0x00-0x0f`; USB is correctly `0xA7 0x06`, not Card (`0xA7 0x07`).
- Meter collection changes now use a fresh report id and renew the active id, preventing packets from an older request from being decoded against a new collection order.
- Dock and popup meter requests now have separate owners and are merged, so either window can change or close without erasing the other's active meters. Macro trigger/condition meters remain an independent base subscription.
- Real-WING read-only validation received 48 USB events, a mixed USB/channel collection, and 878 events covering all 16 Source plus all 11 Output groups in Maillot order.

## [Desktop 1.2.14] - 2026-09-21

- Fixed loss of disabled IF rules and action states, and isolated unsaved editor arrays from the saved macro library.
- Made New create a clean disabled macro with a -18 dB meter default instead of inheriting the selected macro.
- Aligned meter/OSC trigger operators and Alert/HUD preflight with actual runtime capabilities.
- Repaired IF/action context menus and added a catalog-wide resolver contract test.
- Passed browser workflow coverage and 81 native Rust tests; real-WING action validation remains pending.

## [Desktop 1.2.13] - 2026-09-20

- Made macro names editable directly from saved macro rows and moved the editor name field above the WHEN/IF/THEN workflow.
- Added a browser interaction test for click/focus, both rename paths, and preservation of the saved trigger channel.

## [Desktop 1.2.12] - 2026-09-20

- Kept the latest Meter Bridge watchlist request across native stream startup and blocked stale stream senders.
- Added meter click/marquee selection, selected removal and contextual removal, with clearer live-state diagnostics.
- Fixed macro Matrix category/selection mismatches, single primary trigger picking and a stuck global text-selection lock; macro name edits now persist on completion.
- Confirmed real WING Rack read-only USB meter frames and all 77 native Rust tests. Full live macro execution remains unverified on hardware.

## [Desktop 1.2.11] - 2026-09-20

- Fixed Delete in the Saved Macros toolbar with an in-app confirmation; deleting the last macro now leaves an empty library across save/relaunch instead of recreating a default macro.
- Restored the right-click menu on actual macro rows with open, enable/disable, notice, duplicate, rename-in-editor, reorder, copy JSON and delete actions.
- Batch enable/notice no longer overwrites the selected saved macro with unsaved editor values. Corrected drag reordering when moving down.

## [Desktop 1.2.10] - 2026-09-20

- Added a saved network adapter priority in Settings. Auto still probes all interfaces; a chosen adapter is tried first, and optional exclusive mode fails closed instead of using another route.
- Applied the preference to Maillot `WING?` discovery, native meters and OSC, with the active route shown in Settings and included in station backup/reset.
- Verified targeted and broadcast identity against the real WING Rack through pinned Ethernet `en7` with Wi-Fi enabled. Macro actions were not executed during validation.

## [Desktop 1.2.9] - 2026-09-20

- Fixed WING connection on Macs with overlapping Wi-Fi/Ethernet subnets by selecting the IPv4 source that receives Maillot `WING?` / `WING,...` on UDP 2222, then binding native meter TCP, UDP return and OSC actions to it.
- Bound network discovery to each interface, surfaced the chosen local route in the UI, and made cancelling during connection stop before subscription where possible.
- Verified against a real WING Rack: targeted/broadcast discovery, TCP 2222 and one read-only USB meter frame (48 decoded values). Live macro execution and reconnect remain unverified on hardware.

## [Desktop 1.2.8] - 2026-09-20

- **The Gatekeeper unlocking suite is in both the ZIP and the DMG.** A double-clickable script strips the
  quarantine attribute, restores its own execution permission and launches the application, so a blocked
  operator does not have to type the commands by hand, and `README FIRST.txt` explains the three ways to
  open it on macOS Sequoia, Sonoma and newer Apple Silicon Macs.
- **The ZIP extracts into a dedicated folder** (`WING_CONTROLLER_v1.2.8_AppleSilicon`) holding the
  application, the unlock script and the instructions, with the sanitized `Info.plist`, the ad-hoc
  signature and the GPT/HFS+ disk image as 1.2.7 left them.

## [Desktop 1.2.7] - 2026-09-20

- **The application opens on Apple Silicon again (M1–M5, macOS Sequoia and Sonoma).** LaunchServices was
  rejecting the bundle over legacy 1990s Carbon attributes in `Info.plist` (`LSRequiresCarbon`,
  `CSResourcesFileMapped`), which are stripped, with `LSMinimumSystemVersion` set explicitly to `11.0` for
  arm64.
- **The bundle is ad-hoc signed with its resources sealed.** `codesign --force --deep --sign -` seals the
  resources and frameworks so the kernel accepts execution, and `codesign --verify --deep --strict` is what
  proves it.
- **The disk image is built as a modern GPT/HFS+ image** instead of the legacy `makehybrid -hfs` layout, so
  Gatekeeper on Sequoia accepts it, and the image carries a one-click unlock helper that removes the
  quarantine attribute if the application is still blocked.

## [Desktop 1.2.6] - 2026-09-19

- **A manual Test Action shoot can preview a courtesy notice.** A checkbox beside Test Action (Shoot)
  shows the floating Win95 notice when a manual preflight shoot runs, with the multi-step action tally, the
  target address, the parameter value and the destination it would reach, so the notice can be seen before
  a macro is armed.
- **Courtesy notices are configured under Properties → HUD & Courtesy Notices:** the auto-dismiss duration
  (2.0 s, 3.5 s, 5.0 s, 8.0 s or until dismissed), the screen corner used, an optional chime on a trigger,
  whether new macros enable a notice by default, and a button that previews the position and the sound.
- **The Properties dialog no longer clips its controls**: its tab pages scroll with a defined minimum height
  and generous bottom padding, and the dialog was resized for comfortable viewing across every property
  sheet.

## [Desktop 1.2.5] - 2026-09-19

- **The Saved Macros rows are a single compact line again.** They were inheriting a two-column grid meant
  for step rows and wrapped onto three lines with half-width buttons; each row is now a 24 px flex line
  holding the drag handle (which starts a drag only on itself), the multi-select checkbox with Shift+Click
  range selection, the colour dot, the macro's index, title and live summary, the courtesy-notice bell and
  the enable toggle, with explicit rules so the compact density preset cannot distort them.
- **The search and filter toolbar was polished**: the search input sits in a sunken box with a magnifier
  and a clear button, and Select All / Deselect All sit beside it on one line.

## [Desktop 1.2.4] - 2026-09-19

- **The accessory drawers are flat and out of the way.** Quick Templates moved out of the step-by-step flow
  into a selector in the Build Macro header and a subordinate drawer before the recipe summary, and the
  heavy 3D bevels came off Quick Templates, Raw OSC Diagnostics and Advanced Trigger Tuning so they read as
  indented subordinate tools.
- **A courtesy trigger notice can be shown per macro.** A toggle in Block 1 and a bell button on each
  library row enable a floating Win95 toast — distinct from the high-priority HUD alert — that appears in
  the screen corner with the macro title, an action breakdown, the trigger time, a 3.5 s auto-dismiss
  progress bar and an immediate dismiss button.
- **Saved Macros gained power-user handling**: drag-and-drop reordering with insertion indicators,
  persisted immediately; multi-selection with Shift ranges and Cmd/Ctrl toggles and a toolbar that adapts
  to the batch count for enable, disable, notice, duplicate and delete; a cycleable colour tag per macro
  shown in both the row and the builder header; an instant filter over name, trigger address and action
  target; and ▲ / ▼ buttons for moving one or several rows without dragging.
- **The Rust configuration carries the new fields** (`courtesy_notice`, `color_tag`) with `serde(default)`,
  so existing saved libraries load unchanged.

## [Desktop 1.2.3] - 2026-09-19

- **The technical drawers and buttons say what they are.** The top template drawer is **Quick Templates**,
  the trigger-response drawer inside Block 1 is **Advanced Trigger Tuning**, the bottom preview is **Raw OSC
  Diagnostics**, and the offline dry-run button is **Verify Syntax (Preflight)**, now clearly distinct from
  the live **Test Action (Shoot)**.
- **Library and builder are separate panels.** Saved Macros is mounted at the top of the left stack with
  its whole action bar (save draft, enable selected, new, duplicate, delete, export, import) and Build Macro
  sits directly beneath it, focused on the five steps, so firing at a live console and validating offline
  are two visibly different actions.

## [Desktop 1.2.2] - 2026-09-19

- **Connect and Disconnect latch instead of pretending.** The master buttons are **► Connect** and
  **■ Disconnect**, and they show the session's real state: Disconnect latched and disabled while
  disconnected, Connecting sunken and cancellable, Connected sunken, green and disabled while Disconnect is
  ready — so the same button cannot be pressed again as a dummy input.
- **The console address field at the top is clear, persistent and lockable.** It is a Win95 sunken pill
  that takes the caret from a click anywhere, keeps a custom address across reboots, refreshes and macro
  edits, is not overwritten when a macro is selected from the library, and locks itself with an explanatory
  tooltip while a session is live so a show cannot be interrupted by an accidental edit.
- **The builder workflow was separated.** Saved Macros moved out of Build Macro into its own panel with
  Build Macro beneath it, Templates moved to the top of the composer, the meter trigger response sits
  inside Block 1, Test Action (Shoot) sits beside Check (Preflight) in Block 4 for live firing and offline
  validation, and the raw OSC paths and hex diagnostics moved to a drawer at the bottom.

## [Desktop 1.2.1] - 2026-09-19

- **The interface is fully in English.** Every component, modal, property sheet, tooltip, dialog, inspector
  hint, status display and Win95 context menu was translated, and the mixed-language and leftover Spanish
  strings were removed from both windows and the macro engine; the brand name and the Windows 95 aesthetic
  variables were kept as they are.
- **The protocol and OSC engine were audited against Maillot 3.1.0**: every token family from channel to the
  V2 range, the native TCP handshake and stream subscription with 2 s heartbeat renewals and in-flight
  watchlist updates, and OSC over UDP with its 17 ms output cadence and one-second queue bound to protect
  the console's input buffer.
- **The live safety engine was hardened**: PANIC STOP halts listening and cancels every queued timeline step
  at once, guard conditions fail closed when cached state is missing or expired, fades interpolate linearly
  with a fanout limit of 64 targets, and configuration writes are atomic with a `.bak` rollback copy.

## [Desktop 0.1.2] - 2026-09-19

- Corrected the OSC diagnostic probe: Maillot 3.1.0, "Remote communications with WING" specifies `WING?` on UDP 2222, while "Subscribing to OSC Data" defines `/*S` as a single-client event subscription on UDP 2223. The diagnostic button now checks identity without stealing the active OSC subscription.
- Native live status now requires a valid WING reply. Receive timeout cancels pending actions and the UI can retry with a fresh trigger baseline. OSC-only sessions use `WING?` heartbeats for liveness.
- Native meter frames have a separate stale timer so identity replies cannot hide meter-trigger loss. The live watchlist can create or update its TCP meter subscription.
- Added a bounded, global 17 ms OSC control send cadence and connected F12 to Panic Stop.
- Station backup v2 restores library, draft and all desktop `wing_` preferences; JSON saves keep a recovery copy.
- Split desktop and Android version synchronization; corrected UI port labels and Meter Bridge health event.
- Kept Maillot Channel 3 meter request/decode order and normal 1/256 dB level scale unchanged; the documented FX exception remains unchanged.
- Maillot Channel 1 filter paths `/flt/lcf` and `/flt/hcf` now repair saved `/flt/cf` steps when HPF/LPF metadata is present; ambiguous legacy paths fail preflight.
- During live/reconnect, macro counts reflect the frozen runtime snapshot and library edits are labelled as next-connect changes; removed a competing UI-only network timeout indicator.
- A connection-only session is allowed with no enabled macros or selected meters; it does not dispatch actions.
- The side-panel macro count no longer says "Listening" while stopped.

## [Unreleased macOS prototype] - 2026-09-15

### Desktop
- Added the macOS/Android macro parity audit as the controlling checklist for
  the desktop macro builder: explicit `WHEN / IF / THEN`, Android-equivalent
  trigger operators/edges, condition gates, action timeline behavior, and
  parameter value naming/units are now P0 for the port.
- Added desktop macro config fields for Android parity: macro name, trigger
  comparator, trigger edge mode, overlap strategy, logical operator, and IF
  condition rows, with backward-compatible defaults for older prototype configs.
- Added meter-backed IF condition evaluation in the Rust show runner for
  rehearsal/live streams. Conditions are checked against fresh decoded meter
  state before action dispatch, and unavailable/stale condition state fails
  closed.
- Exposed macro name, trigger comparator/edge, and an IF condition section in
  the desktop UI recipe so the main workflow reads as `WHEN / IF / THEN`.
- Added multiple IF rule editing on desktop with add, duplicate, remove, select,
  enable/disable, AND/OR binding, and target-catalog-backed meter source fields.
- Promoted the action timeline out of advanced details and added Android-style
  independent `Wait` steps that pause the sequence without sending OSC.
- Added a metadata-backed slider alongside action value inputs for ranged
  parameters such as dB, Hz, ms, pan, ratio, Q, and integer values.
- Added first desktop support for Android-style `automation_cue` actions as
  fixed start-to-end smooth ramps using the existing target/value/duration
  fields. `from current` remains blocked until desktop OSC state receive is
  ported.
- Polished the desktop prototype visual system with steadier graphite surfaces,
  clearer focus states, lighter secondary buttons, more legible recipe rows, and
  calmer meter styling.
- Expanded the Tauri show-runner trigger selector from USB-only to a Maillot-backed
  target catalog covering mix, source, output, control, monitor, RTA, and V2 meter
  trigger families.
- Reworked the macOS macro builder workflow around trigger presets, grouped
  category selectors, target presets, quick ID/range chips, parameter chips,
  automatic OSC path previews, and per-step target metadata.
- Simplified the macOS show-runner screen into a two-column operator workflow:
  macro building is the primary surface, run/arm controls and meters are grouped
  together, and diagnostics/OSC internals are folded away by default.
- Added human value nomenclature to the macOS macro builder: Maillot `I 0..1`
  toggles render as OFF/ON labels, mute renders as OFF/unmuted vs ON/muted,
  faders/gains/meters render in dB, filters render in Hz, delays in ms, pan as
  left/center/right, and routing groups as named destinations.
- Added transient meter trigger controls for cooldown, rearm dB, dwell, and stale
  suppression so fast repeated USB/source meter hits are evaluated in Rust before
  UI rendering.
- Added live meter stream health events and UI diagnostics for packet rate, byte
  rate, last RX, last renew, decode time, decoded events, trigger hits, and
  dropped meter count.
- Saved the updated Patrick-Gilles Maillot WING Remote Protocols 3.1.0 reference
  under `scratch/reference/` and refreshed `scratch/wing_protocols.txt`.
- Reframed the desktop prototype as a WING macro workstation rather than a
  USB-only show runner; the default macro name is now general-purpose.
- Added desktop macro library persistence with visible macro selection, save
  draft, new, duplicate, delete, export, and import. Library import accepts the
  desktop library format and compatible single-config payloads, and imported
  macros are disarmed by default.
- Added live overlap runtime policies `restart` and `queue_one` alongside
  `drop`. Restart cancels the current action timeline without stopping the meter
  stream; queue-one stores one follow-up run and drops additional overlap hits
  while full. `concurrent` remains blocked by desktop preflight.
- Added per-macro library enablement and live execution of all enabled desktop
  macros. Meter subscriptions are merged into one native request while each
  macro keeps its own trigger ids, IF gates, action timeline, overlap policy,
  and runtime counters.
- Added macro runtime events for the desktop library: running, queued, dropped,
  restarted, completed, failed, and last event/message are surfaced per macro.
- Added a first Android macro schema v3 import adapter for the desktop library
  covering trigger targets, conditions, OSC/delay/fade/automation-cue action
  steps, and execution overlap policy.
- Added minimal desktop OSC state receive/cache for live mode. The live stream
  sends WING `/*S` state subscription, decodes simple OSC `i/f/s/T/F` state
  packets, and allows IF conditions against OSC state such as channel mute or
  fader addresses.
- Clarified the desktop macro workflow UI: the library now reads as saved
  macros with per-row `ENABLED/OFF` controls, the run panel distinguishes WING
  connection from arming a selected draft, and action values are labelled as the
  value/state being sent with human units.
- Renamed the live desktop operation around listening rather than running:
  connecting to WING arms enabled macros for trigger listening only, and macro
  actions remain gated by trigger/IF evaluation.
- Added a macOS port handoff document and a root double-click launcher:
  `docs/MACOS_PORT_HANDOFF_2026-09-16.md` and
  `Open Wing Controller Desktop.command`.
- Expanded desktop trigger/IF parameter coverage beyond native meters. Mix
  strips, source inputs, DCAs, FX slots, mute groups, and user controls now
  expose OSC-state parameters such as fader, gain/trim, name, EQ, gate, comp,
  sends, mutes, and source settings as trigger candidates. Native meter
  parameters still use the fast Channel-3 meter path; non-meter parameters are
  evaluated from cached WING OSC state and fire only on state-match edges.
- Cleaned up the desktop UI hierarchy: meter response/fastness controls now
  appear only for native meter triggers, with simple `Fast transients`, `Stable
  level`, and `Custom tuning` presets; non-meter triggers are labelled as OSC
  state triggers. Connection controls, settings/config tools, discovery, and
  draft arming are now separated into clearer sidebar sections.
- Remodeled the desktop prototype visual language into a more deliberate
  technical workstation: Win95-inspired bevels, teal title bars, CRT-style
  recipe/readout panes, listbox macro rows, denser control spacing, stronger
  live/disconnect/destructive button hierarchy, and less generic card styling.
  Captured the result at
  `temp_build/screens/macos_tauri_deep_ui_remodel_2026-09-16.png`.

### Protocol
- Desktop meter and target resolution now uses Maillot `0xa7` source groups,
  `0xa8` output groups, `/io/in/*`, `/io/out/*`, `/mtx`, Channel 3 request order,
  and `1/256 dB` meter values as the local authority.

## [1.0.133] - 2026-09-09

### Interface
- Added a configurable Meter UI Rate setting with Smooth, Balanced, and
  Economical profiles.
- Smooth is now the default meter UI profile, using a 16 ms visual cadence for
  the meter workspace, trigger previews, and target selector meters.

### Reliability
- Meter UI rate changes are applied to the active OSC session without
  reconnecting, while trigger- and automation-critical meter addresses continue
  to bypass visual coalescing.

### Protocol
- WING native meter decode remains aligned to Maillot Channel 3 `0xA7`/`0xA8`
  ordering and `1/256 dB` scale. This release changes persisted UI refresh
  preference and JS visual fan-out cadence only.

## [1.0.132] - 2026-09-09

### Reliability
- Coalesced visual-only meter fan-out to a 30 fps refresh clock while keeping
  trigger- and automation-critical meter addresses immediate.
- Added regression coverage for rapid FAST source USB meter transients so show
  triggers on `/meters/usb/N` do not wait for the visual meter refresh.

### Protocol
- WING native meter decode remains aligned to Maillot Channel 3 `0xA7` source
  request ordering and `1/256 dB` meter scale. This release changes JS fan-out
  timing only; wire requests, renew behavior, and value scaling are unchanged.

## [1.0.131] - 2026-09-07

### Network reliability
- Paced periodic watched-state refreshes at 20 ms intervals, bounded each cycle
  and admitted through the shared command limiter instead of sending a single
  synchronous OSC burst.
- Added a 96-value visual meter quota inside the 256-value hard request budget;
  trigger- and automation-critical meters retain priority and access to the
  full hard limit.
- Reduced the global meter overview to one representative meter per supported
  family while preserving focused named custom groups.
- Added live RX/TX packet and byte rates, meter frame rate, active visual meter
  cost, and refresh queue depth to Diagnostics.

### Protocol
- WING native metering remains aligned to Maillot Channel 3 `0xA7`/`0xA8`
  request/decode ordering, whole-device groups, renew behavior, and `1/256 dB`
  scale. This release changes request volume and pacing only.

## [1.0.130] - 2026-09-07

### Interface
- Rebuilt the permanent sidebar around stable workspace navigation, compact
  connection/show status, and contextual lists instead of duplicating every
  library and creation action on every screen.
- Reworked Overview into a restrained operational summary with one clear
  hierarchy, flatter sections, useful status first, and direct library/create
  actions without a second set of hero buttons.
- Introduced a neutral graphite surface system and separate semantic accents
  for shell, macros, automations, HA, success, warning, and danger.
- Standardized workspace headers, action iconography, sentence-case labels,
  smaller type, borders, radii, and status treatments across the main
  operational views and modals.

### Dependencies
- Added `lucide-react-native` and the Expo-compatible `react-native-svg` build
  so operational actions use a coherent icon language.

## [1.0.129] - 2026-09-06

### Reliability
- Reworked WING native meter recovery so broken TCP sockets are invalidated and
  rebuilt with bounded, generation-aware reconnects.
- Reduced dense-meter work by indexing macro triggers, publishing only watched
  addresses, coalescing UI updates, and sampling diagnostics only when visible.
- Macro execution now fails closed while offline or backgrounded, aborts
  active/queued work on disconnect, and reports rejected or failed actions.
- Cached console observations now include freshness and connection generation;
  stale values cannot prime triggers, macro conditions, or HA baselines.
- Added command admission/rate limits, automation trailing delivery, and
  fan-out limits to prevent unsafe bursts.
- Invalid macro targets now fail closed instead of falling back to channel 1
  mute.
- Idle HA setups release their endpoint sessions; only an opened or armed setup
  is monitored.
- Added listener/error-boundary containment, bounded native UDP work, bounded
  session state cache, foreground keep-awake, and disabled Android app backup.

### Recovery and verification
- Added canonical native WING sources plus an Expo config plugin and source-sync
  test so native behavior survives prebuild regeneration.
- Added focused macro, meter, native-sync, automation, and live-safety contract
  tests.
- Added `SHOW_RELIABILITY_AUDIT_2026-09-06.md` and a remediation handoff that
  separates code corrections from the remaining physical-WING validation.

### Protocol
- WING meter behavior remains aligned to Maillot Channel 3 `0xA7`/`0xA8`
  request/decode ordering, renew semantics, and `1/256 dB` meter scale.

## [1.0.128] - 2026-08-22

### Added
- Added quick adjacent meter selection presets (`1-8`, `9-16`, etc.) in meter
  selection mode.
- Selection counters now include the current meter view context, such as
  `SELECTED FROM CHANNELS`.
- Custom meter groups can now be duplicated for show/cue variants.
- Selected meters inside custom groups can now be moved up/down or removed in
  bulk.

## [1.0.127] - 2026-08-22

### Added
- Added an explicit meter multi-select mode for detail views, with a left-side
  drag rail for selecting adjacent meters without fighting normal scrolling.
- Selected meters can now seed a named `NEW GROUP`, be added in bulk to the
  active custom group, or be removed in bulk from an existing custom group.
- Meter detail rows now show selected state visually and keep offline meter-map
  selection available before connecting to a console.

## [1.0.126] - 2026-08-22

### Added
- Custom meter groups now support explicit naming and renaming from the meter
  workspace, so groups can be named per show or cue context.
- Row-level `ADD`, `CREATE FROM VIEW`, and `NEW GROUP` now open the naming flow
  before creating a custom meter group.

## [1.0.125] - 2026-08-22

### Changed
- Cleaned up custom meter group creation so the meter workspace no longer
  creates empty custom groups from the header or view selector.
- Custom meter groups are now created from concrete meter context: `CREATE FROM
  VIEW` seeds the group with the current meter view, and row-level `ADD` seeds a
  group with the selected meter when no custom group exists yet.
- Legacy empty auto-named custom meter groups are filtered on load so accidental
  groups from previous builds stop cluttering the meter grid.

## [1.0.124] - 2026-08-22

### Added
- Added a shared target resolution/preflight report for macro trigger,
  condition, and action targets, including resolved read/write/meter address
  sets.

### Fixed
- Meter detail rows remain editable while offline or waiting for packets, so
  custom meter groups can be created and filled before connecting to a console.
- The meter workspace now labels offline preparation as an offline map instead
  of implying native WING meters are unsupported.

## [1.0.123] - 2026-08-22

### Added
- Macro runtime counters are now exposed to the UI, showing active, queued,
  dropped, and restarted runs for operator diagnostics.
- Added a dynamic macro runtime policy simulation harness covering meter
  baseline suppression and overlap `drop` behavior.

### Fixed
- Macro runtime completion counters are now idempotent per run, preventing
  completed delayed/action sequences from being counted twice.

## [1.0.122] - 2026-08-22

### Added
- Macros now persist an explicit execution policy with conservative overlap
  handling. Meter/audio-triggered macros default to dropping overlapping runs
  instead of launching uncontrolled parallel executions.
- Meter FAST triggers now include envelope controls for cooldown, rearm dB,
  dwell time, and stale timeout.
- Macro runtime now tracks active runs per macro, enabling selective
  cancellation, restart, queue, and drop behavior.

### Fixed
- Console and meter triggers establish an initial baseline before firing, so
  opening/reopening the app does not fire a macro just because a watched value
  is already active.
- Meter triggers suppress firing after stale packet gaps until fresh packets
  establish a new baseline.

### Protocol
- WING meter decode remains Maillot-aligned (`0xa7`/`0xa8`, Channel 3,
  `1/256 dB`). This release changes trigger admission/runtime policy only.

## [1.0.121] - 2026-08-22

### Added
- Meter-based macro triggers now have a `FAST` response profile with tunable
  cooldown and dB rearm sensitivity for rapid audio trigger work.

### Fixed
- Macro, Automation, and HA workspace quick lists no longer stop after three
  items; macro lists now show the full available set.
- Macro enabled state is now displayed consistently with the engine: only
  `enabled === true` appears active.
- Meter macro edge state is tracked per macro and meter address, so one watched
  meter no longer blocks another meter in the same macro target range.
- Editing, disabling, deleting, or replacing macros clears their live edge and
  FAST-trigger runtime state.

### Protocol
- WING meter payload decode remains Maillot-aligned (`0xa7`/`0xa8`, Channel 3,
  `1/256 dB`). FAST trigger mode changes only macro edge detection.

## [1.0.120] - 2026-08-22

### Added
- Meter workspace custom groups can now be created, selected, saved, and
  curated with individual meter addresses from different WING meter families.

### Changed
- The global meter view now uses a safe sampled overview instead of subscribing
  to every mapped meter by default.
- Meter subscriptions are cleared when the app backgrounds, and a previous
  `METERS` workspace is restored to Overview on next launch for safer startup.

### Protocol
- WING native meter request order and decode semantics remain Maillot-aligned:
  Channel 3 framing, `0xa7` source groups, `0xa8` output groups, and meter
  values decoded as `1/256 dB` are unchanged. This release only caps request
  volume for runtime safety.

## [1.0.119] - 2026-08-01

### Added
- Macro actions can now run refined `Automation cue` ramps over arbitrary
  target parameters, with current/fixed start, end value, duration in
  milliseconds, and curve selection.
- Macro actions can now enable, disable, or toggle a saved automation.
- Show Preset export now supports a user-entered JSON filename and partial
  export of selected presets.

### Changed
- Show Preset and Complete Backup imports are additive: imported content is
  merged into the current app state instead of replacing loaded show data.
- Imported backup macros, automations, and HA setups are added disabled for
  live-write safety.
- Action timeline controls are larger and use explicit `UP`, `DOWN`, `COPY`,
  `EDIT`, and `DELETE` labels.

### Fixed
- Action timeline `UP`, `DOWN`, and `COPY` no longer open the action editor;
  only `EDIT` opens the popup.
- Macro preflight now blocks fixed targets with no selected object before save.

### Protocol
- No WING OSC path grammar changed in this release. Automation cues use the
  existing Maillot-aligned macro target resolver, including EQ band paths such
  as `/eq/{band}f`.

## [1.0.118] - 2026-08-01

### Changed
- Moved the build/version badge beside `by MÁRMOLES SUPPLY CO` so the title
  line keeps its layout.
- Compressed the global tools into two rows and added discreet visual markers
  for persistent views versus modal tools.
- Added Overview filters for Global, Macros, Automations, and HA Setups so show
  operators can monitor each live list directly from Overview.

## [1.0.117] - 2026-08-01

### Changed
- Reorganized global navigation so Overview, Meters, Show Presets, Diagnostics,
  Guide, and Settings stay grouped at the top of the app.
- Moved app version/build visibility beside the app name in the top header.
- Redesigned target selection with inline meters and no implicit Channel 1
  default for new trigger/action targets.

### Fixed
- Macro draft target selections survive leaving and reopening the app mid-edit.
- Action timeline UP, DN, COPY, and DEL controls no longer open the action
  editor; editing is now explicit through the EDIT control.
- Console-trigger configuration now removes the redundant fixed-target control
  and places target-object selection directly after object category.

## [1.0.116] - 2026-07-31

### Fixed
- Overview/sidebar preview lists for Macros, Automations, and HA Setups now keep
  showing disabled items when another item is enabled; active state is indicated
  by row styling instead of changing the preview filter.

## [1.0.115] - 2026-07-31

### Changed
- Replaced the polished marble/fader mark with a rough 8-bit pixel-art marble
  stone `W` icon.

## [1.0.114] - 2026-07-31

### Changed
- Rebrand: app display name and launcher label updated to **Mármoles Wing Tools**.
- Replaced app, adaptive, splash, and favicon source icons with the new marble
  M/W mixing-fader mark.

## [1.0.113] - 2026-06-11

### Safety
- Fresh installs, imported macros, duplicated macros, new automations, duplicated
  automations, and duplicated HA setups cannot begin writing live by surprise.
  Pending macro delays/fades stop on disconnect, background, preset load, list
  replacement, deletion, or disable.
- Added automation fleet preflight for source/target feedback cycles and shared
  write targets. Invalid enabled automations are excluded from runtime even if
  an edit makes them invalid after they were enabled.
- Hardened hydration failure handling so damaged macro, automation, HA, or Show
  Preset storage blocks automatic overwrite until an explicit verified recovery.
- Enforced list/action/mapping limits on creation, duplication, import, restore,
  and recovery snapshots. Imports no longer silently evict existing Show
  Presets, and malformed Complete Backups are rejected before changing data.
- Serialized native UDP/TCP writes, closed failed TCP connection attempts, made
  native transport errors visible in Diagnostics, and removed the unused TCP
  proxy and `react-native-udp` dependency.

### Added
- Show Presets now support visible text entry, update, duplicate, blank preset
  creation, local JSON import/export, and Complete Backup restore.
- Macro, Automation, and HA libraries now support safe disabled duplication.
- The active Show Preset and modified state are shown prominently beside
  `CONTROL CENTER` and in the Overview status area.
- Settings now exposes the saved console route, storage recovery state, and
  concise live-safety guarantees. The Guide is now an operational show
  preparation and recovery checklist.
- Added Expo lint configuration plus automation and live-safety contract tests.

### Validation
- Expo SDK 55 dependencies aligned; Expo Doctor passes `19/19`.
- Android `compileSdkVersion` and `targetSdkVersion` aligned to Expo SDK 55's
  documented API level `36`.
- Lint, TypeScript, automation safety, live-safety contracts, HA math, X32
  protocol mapping, and Android release Kotlin compilation pass.
- Protocol note: Maillot Channel 3 request/decode ordering, `0xA7`/`0xA8`
  group semantics, and `1/256 dB` meter scaling are unchanged by this release.

## [1.0.112] - 2026-06-07

### Safety
- Hardened JSON persistence with recoverable `.next`, `.bak.next`, and `.bak`
  candidates so interrupted replacements retain a validated recovery source.
- Macro create/update/toggle/delete/duplicate/reorder operations now roll back
  in-memory changes when their verified disk save fails.
- Automation and HA edits restore the last verified list after a persistence
  failure.
- Show Preset loads now restore the previous full show automatically if any
  macros, automations, HA, or preset-index write fails. A recovery preset is
  still retained as a second restoration path.
- Added `COMPLETE BACKUP`, containing the current show, all Show Presets, and UI
  settings. Importing it creates a loadable preset for its captured current show.

### Changed
- Added a visible `MODIFIED` marker when the loaded Show Preset no longer
  matches its owned current lists.
- Removed Mixing Station/Controlled Mode and their dead UI/runtime paths.
- Removed Active Selection from target authoring and status UI. Legacy selected
  targets are migrated conservatively to fixed CH 1 targets; legacy Mixing
  Station macros migrate disabled to console telemetry for manual review.
  The legacy selected-target migration references Maillot
  `/$ctl/$stat/selidx`; Channel 3 request/decode ordering and meter scales are
  unchanged.
- Removed obsolete internal guide/wizard/editor state and made operation status
  messages visible on the Overview.

## [1.0.111] - 2026-06-05

### Fixed
- **Critical: WING control/subscription went to the wrong UDP port → "connects
  but no send/receive".** The app sends its `WING?` discovery to UDP 2222 and the
  WING replies *from* 2222; `applyDetectedConsolePort()` then adopted 2222 as the
  OSC control route. Per Maillot, WING's OSC server is **only on 2223** (2222 is
  the discovery/native-metering responder), so all control messages and the
  `/*S~` event subscription were sent to a port WING doesn't listen on — silently
  breaking control, parameter events, and the live command flood. Fix: never
  route OSC control to the discovery/native port; keep it on 2223
  (`src/osc/WingSession.js` `applyDetectedConsolePort`). Verified on a live
  WING: Route port 2223, Last reply 2223, meters HEALTHY, `/*S~` event
  stream received, selection resolved.

## [1.0.110] - 2026-06-05

### Changed
- Rebrand: app renamed to **WING TOOLS** (by MARMOLES SUPPLY CO).
  - Launcher label `app_name` → "WING TOOLS".
  - In-app header → "WING TOOLS" / "by MARMOLES SUPPLY CO".
  - `app.json` name → "WING TOOLS".
- New app icon: warm-dark mixing-fader motif (amber faders on a dark gradient),
  generated at all densities (legacy `ic_launcher`/round, adaptive
  foreground/background/monochrome) + source PNGs, replacing the old icon.
- Killed leftover light-blue chrome in native resources: adaptive icon
  background, splash background, `iconBackground`, `colorPrimary` → dark `#0C0C0D`
  (was `#E6F4FE` / `#208AEF` / `#023c69`).

## [1.0.109] - 2026-06-05

### Changed
- Finished the UI legibility/calm pass across the rest of the app:
  - **Category group colors harmonized** to a warm earthy palette in
    `src/domain/targetCapabilities.ts` (was a cyan/orange/green/pink rainbow):
    MIX CHANNELS amber, SOURCES orange, OUTPUTS gold, SYSTEM/DCAs taupe. This was
    the last source of cyan/pink/neon-green (routing patchbay, object grid,
    object-category pills) — now cohesive and warm.
  - Verbose **guide-text** paragraphs (HA, Automation) muted (warm → neutral
    muted) so they recede instead of competing with content.
  - **Diagnostic lines** demoted: automation LIVE/dispatches line and the macro
    OSC event-log title → muted (no longer warm/accent-colored).
  - Verified on device: Automation editor, trigger config modal, routing
    patchbay, object-category pills — all consistent with the neutral-dark +
    warm-accent + progressive-disclosure system.

## [1.0.108] - 2026-06-05

### Changed
- UI legibility & calm pass (reduce cognitive load). Guided by
  `docs/UI_PRINCIPLES_2026-06-05.md`.
  - **Text hierarchy**: 3 neutral text tokens (primary/secondary/muted); 138
    scattered grays migrated. Values/titles read bright, labels/help recede.
  - **Section titles** now crisp white-bold (were all amber → removed accent
    overload; warmth reserved for interactive elements).
  - **Progressive disclosure**: new lightweight `Disclosure` primitive. HA
    Console A/B cards now show only Label/IP/actions; OSC port (Advanced) and
    route/family/last-seen (Status details) collapse by default.
  - **HA Console A/B redesign**: one cohesive ochre accent (was amber+green+blue
    mix), card body padding, ghost buttons, demoted diagnostics, trimmed copy.
  - **Global spacing**: shared card/section/hero/module/condition padding + gaps
    increased for breathing room across every screen.
  - **Blue chrome neutralized**: hero card bg, section left-accents, endpoint
    buttons (no more stray blue against the warm/neutral system).

## [1.0.107] - 2026-06-05

### Changed
- Dark-mode correction (design feedback): the 1.0.106 warm palette tinted the
  *surfaces* themselves, making the whole app read orange/brown. Reworked so the
  base is a true NEUTRAL dark grey (zinc-like) and warmth comes ONLY from accents.
  - `designTokens` `surface0-3`/`border0-2` retuned to neutral dark.
  - Sidebar active rows + overview module cards now use neutral surfaces with the
    domain accent only on borders/dots/text (removed warm-brown fills).
  - Neutralized leftover warm-brown button/panel fills (HA/automation OPEN LIST,
    automation active card, HA readiness panel).
  - Accent hues kept (Macro amber / Automation orange / HA ochre); flat solid
    colors only (no gradients/shadows) to stay cheap to render.
  - Toggles made per-domain consistent (HA switches green→ochre).
  - Border-radius scale tidied (oddball radii collapsed to 4/6/8/10/12/14/16/pill).

## [1.0.106] - 2026-06-04

### Changed
- UI/Design audit pass — warm palette redesign + design-system tightening:
  - New centralized design tokens (`src/constants/designTokens.ts`): warm
    ochre/black `surface0-3` + `border0-2` hierarchy; 177 neutral chrome sites
    migrated off hardcoded hex.
  - Replaced the cyan primary accent with warm per-domain accents
    (Macro=amber, Automation=orange, HA=ochre); tokenized success/warning/danger.
    All cyan (hex + rgba glows + slider props) removed.
  - Enforced an 11px minimum typography floor across all text and scaled styles.
  - Removed the disabled Operating Mode card; connection card now compresses
    when connected.
  - Consolidated Settings to a single sidebar-footer entry point (removed 4
    duplicate workspace-header gears); moved app version into the Settings modal.
  - Fixed remaining user-facing "Automization" → "Automation" labels.
  - Removed orphaned styles; primary touch target raised to 44px.
- Code: extracted pure value-scale/format math to `src/domain/valueScales.ts`.

### Notes / Follow-ups
- HA workspace body still uses green (`success` token) for identity; ochre
  conversion deferred (the global green→success pass coupled them). Documented.

## [1.0.105] - 2026-06-03

### Changed
- Finalized the accumulated tablet workspace UX stack from sessions 4-12:
  - compact control-center overview for macros, automizations and HA setups,
  - full-screen macro and automization libraries,
  - reusable visual roles for summary panels, dashboard sections and HA event rows,
  - tablet-friendly UI settings for typography, text size, density and diagnostics.
- Kept WING runtime behavior unchanged from `1.0.104`; this release is a tablet smoke/freeze build for the visual workspace refinements.

### Validation
- Passed tablet ADB smoke on Samsung tablet `R52W407V9FH` with installed `1.0.104` before release bump:
  - macro editor home,
  - Macro Library,
  - Automization Library,
  - UI Settings,
  - Control Center overview,
  - HA setup identity/endpoints/preflight/ownership,
  - HA source-to-trim mappings,
  - HA runtime/arm/resync and event log.
- Automated checks passed before release bump:
  - `npx tsc --noEmit`
  - `node scripts/test-ha-compensation.mjs`
  - `node scripts/test-x32-protocol.mjs`

## [1.0.98] - 2026-05-25

### Added
- Cross-family HA compensation support between supported console families:
  - `WING -> WING`
  - `WING -> X32/M32`
  - `X32/M32 -> WING`
  - `X32/M32 -> X32/M32`
- Dynamic follower trim specs inside HA runtime:
  - WING trims use `±18 dB` with `0.1 dB` resolution,
  - X32/M32 trims use `±12 dB` with `0.25 dB` resolution.
- HA endpoint sessions now react to console identity changes and re-prime the correct address set once a console is detected as WING or X32/M32.

### Changed
- HA source routing is no longer hardcoded WING-only:
  - `LOCAL/AES-A/AES-B/AES-C` now resolve against the actual owner family,
  - X32/M32 owners resolve shared headamp gain through `/headamp/[000..127]/gain`,
  - WING owners continue to use `/io/in/.../g`.
- HA follower trim writes are now family-aware:
  - WING followers write `/ch|aux/.../in/set/trim`,
  - X32/M32 followers write their trim-compatible canonical paths which translate to `/ch|auxin/.../preamp/trim`.
- HA setup UI now adapts source limits and target limits to detected endpoint families instead of assuming dual-WING throughout.
- Current-route seeding for HA endpoints now accepts any console family that the HA engine supports, not only WING.

### Fixed
- X32/M32 HA compensation no longer gets rounded through WING trim assumptions; quarter-dB trim paths now preserve the intended value and saturation math.
- HA preflight now catches family-specific invalid mappings such as:
  - WING local source indexes above `24`,
  - X32 local source indexes above `32`,
  - X32 follower channel targets above `32`,
  - WING-only `AES-C` mappings selected on an X32/M32 owner.
- HA workspace copy and status badges no longer claim `DUAL WING` when the setup is actually cross-family.

## [1.0.97] - 2026-05-25

### Changed
- X32/M32 protocol alignment was tightened against the official OSC spec:
  - main L/R now maps to `/main/st/...` instead of the previous placeholder route,
  - main L/R pan/name/color are now translated through the compatibility driver,
  - channel and aux `gain` in the X32/M32 path now resolvqe to digital input trim where the protocol actually exposes it.

### Added
- Extra X32/M32 protocol coverage in `scripts/test-x32-protocol.mjs` for:
  - main stereo path translation,
  - input trim translation on channels and aux inputs.

### Fixed
- X32/M32 main-bus canonical addresses now round-trip correctly between app targets and native OSC responses.
- The X32/M32 target editor now exposes the controls that actually exist on the desk for `main`, `ch`, and `aux` instead of hiding valid main-pan/name/color and input-trim paths.

## [1.0.96] - 2026-05-25

### Added
- Safe console-family detection layer for the primary OSC session:
  - WING models remain fully supported,
  - X32/M32-family consoles are now detected explicitly and can enter a partial compatibility driver instead of being mistaken for a silent WING failure.
- A dedicated probe/driver split inside the OSC session stack:
  - `ConsoleProbe` now owns family probing and port discovery,
  - `WingConsoleDriver` owns WING-specific handshake, polling and raw subscriptions,
  - `X32ConsoleDriver` now handles `/xremote`, state polling and canonical address translation for supported X32/M32 controls,
  - `UnsupportedConsoleDriver` remains as the probe-only fallback for truly unsupported families.
- Pure protocol coverage for the new X32/M32 mapping layer in `scripts/test-x32-protocol.mjs`.

### Changed
- Runtime connection UI now exposes detected console family, support level, reply port, and unsupported-family warnings more clearly across the sidebar and `CONTROL CENTER`.
- Runtime diagnostics now expose the active driver mode (`WING`, `X32/M32`, or `PROBE-ONLY`) so the transport policy is visible during troubleshooting.
- HA setup creation no longer auto-seeds from the current route when the detected console family is unsupported for HA workflows.
- Target editing now adapts when an X32/M32-family console is active:
  - object categories are reduced to supported X32/M32 domains,
  - selected-strip targeting is hidden,
  - unsupported meter/preamp/HA expectations are removed from the normal path.

### Fixed
- Standard WING action sends are now blocked once a truly unsupported console family is positively detected, preventing normal macro/automization/HA writes from being routed into unknown transports.
- WING transport policy is now centralized behind driver selection instead of being scattered across session methods, reducing the chance of future multi-family regressions.
- Core X32/M32 canonical controls now translate safely through the driver for:
  - mute,
  - fader,
  - pan,
  - name/color,
  - send on/level,
  - DCA mute/fader.

## [1.0.94] - 2026-05-25

### Changed
- Workspace navigation now persists the last real workspace (`Macro`, `Automization`, or `HA`) and restores it on relaunch instead of always landing in the overview.
- `CONTROL CENTER` was compacted into a denser operational overview so it stops wasting tablet space while still exposing system pulse and workspace entry points.
- Sidebar quick lists for `Macros`, `Automizations`, and `HA` now show multiple items instead of a single preview row.
- HA UI copy now frames saved configs as `HA setups` in the main navigation and library flows instead of presenting them like ad-hoc actions.
- Macro editor copy was cleaned up so draft creation no longer shows `automation` wording in the main name field.

### Added
- Inline enable/disable switches directly in the main sidebar quick lists for `Macros`, `Automizations`, and `HA setups`.

### Fixed
- Workspace selection now routes through a single navigation path, avoiding leftover cross-selection inconsistencies between `Macro`, `Automization`, `HA`, and `Overview`.
- Unsaved `New Macro` draft state is no longer persisted as a fake restorable workspace.
- HA quick-list and library visuals now use a coherent green accent instead of leaking automization orange styles into HA flows.
- Opening a new macro draft now refreshes the status panel instead of leaving stale HA/runtime messages visible.

## [1.0.93] - 2026-05-24

### Fixed
- App launch flow no longer drops into the Expo Router `Explore` scaffold screen.
- Navigation shell now opens directly into the WING controller workspace, removing the leftover tab-based starter UI from production use.

## [1.0.92] - 2026-05-24

### Fixed
- HA endpoint setup no longer confuses placeholder text with configured routes:
  - endpoints now show explicit states for `NOT SET`, `INVALID IP`, `DUPLICATE IP`, `ONLINE`, and `OFFLINE`,
  - preflight now distinguishes `IP required` from `IP invalid`,
  - invalid endpoint values no longer spawn useless OSC sessions while editing.
- New HA pair creation now seeds `Console A` from the currently connected WING route when available, reducing setup friction.
- HA endpoint editor now includes direct actions to `USE CURRENT WING` or `CLEAR` each side independently.
- HA summaries across sidebar, overview and runtime now show per-endpoint connectivity instead of implying a single opaque offline state.
- Left sidebar layout on tablet was reworked so HA cards and footer no longer collapse into the lower-left corner.

## [1.0.91] - 2026-05-24

### Added
- New dedicated `HA Compensation` engine for dual-WING workflows with:
  - explicit owner/follower HA selection,
  - per-console endpoint config,
  - baseline-based trim compensation from headamp gain delta,
  - trim saturation detection and follower manual-trim baseline adoption.
- Dual-console OSC session architecture:
  - shared UDP hub,
  - per-WING session abstraction,
  - compatibility facade so existing macro/automization flows remain intact.
- HA workspace enhancements:
  - `1:1 RANGE GENERATOR` for fast bulk mapping,
  - live compensation table with owner baseline/current, delta, desired trim, overshoot and last write info.

### Changed
- Main workspace home redesigned into a true `CONTROL CENTER` overview for all three engines:
  - `Macros`
  - `Automizations`
  - `HA Compensation`
- Empty-state workflow replaced with live system overview cards, module previews and clearer navigation back to `OVERVIEW`.
- Sidebar/app framing updated to reflect that the app is now multi-engine, not macro-only.

### Fixed
- HA arm preflight now blocks follower trim collisions so two active links cannot target the same trim on the current follower side.
- HA runtime now forces resync after owner/config changes instead of continuing with stale baselines.

## [1.0.90] - 2026-05-21

### Fixed
- Sidebar quick-list overflow on tablet height: now exactly one compact active row per block (`MACROS` / `AUTOMIZATIONS`) to prevent footer overlap.
- Removed extra `+N more` helper rows from sidebar to keep layout stable and clean.

## [1.0.89] - 2026-05-21

### Changed
- Sidebar `MACROS` / `AUTOMIZATIONS` compacted to a true quick-list format (no oversized preview cards).
- `OPEN LIST` actions enlarged and restyled for clearer affordance and easier touch targets.
- Quick rows now prioritize active items and keep list height controlled to avoid panel/footer overlap.
- Launcher icon redesigned with WING-inspired palette and explicit control/macro visual cues.

### Fixed
- Sidebar overflow/regression introduced by the previous `OPEN LIST` preview implementation.
- Native Android app icon mismatch by regenerating and wiring updated icon assets (`drawable-nodpi/app_icon.png` + refreshed Expo icon set).

## [1.0.88] - 2026-05-21

### Changed
- Sidebar list UX reworked to remove inner scrolling for `MACROS` and `AUTOMIZATIONS`.
- Left panel now shows compact active previews plus `OPEN LIST` actions instead of full long list cards.
- Added full-screen tablet-friendly library modals:
  - `MACRO LIBRARY` for complete macro management.
  - `AUTOMIZATION LIBRARY` for complete automization management.
- Selecting an item from either library modal now jumps straight into editor context and closes the modal.

### Fixed
- Android launcher icon wiring now points to native drawable resource (`@drawable/app_icon`) so icon updates actually appear on device.

## [1.0.87] - 2026-05-21

### Added
- New app icon set (brand refresh) with coherent assets for:
  - `icon.png`
  - `android-icon-foreground.png`
  - `android-icon-background.png`
  - `android-icon-monochrome.png`

### Changed
- Sidebar architecture redesigned for tablet workflow:
  - top control area is now fixed (`Connection`, mode, status, quick actions),
  - macros and automizations are now in dedicated list panes with their own internal scroll.
- Reduced reliance on one long sidebar scroll to reach macro/automization lists.
- `Connect/Disconnect` control resized/rebalanced to avoid clipped text in compact widths and larger typography modes.
- List UI compacted and clarified:
  - cleaner section headers,
  - clearer action labels (`IMPORT`, `EXPORT`),
  - better card density for macro/automization scanning.
- Diagnostics panel visual treatment refined to reduce noise while preserving protocol visibility.

### Fixed
- `CONNECT`/`DISCONNECT` label clipping in narrow button layouts.
- Sidebar readability issues caused by excessive vertical stacking before reaching actionable lists.

## [1.0.86] - 2026-05-21

### Added
- Persistent UI settings storage (`ui_settings.json`) with automatic load/save:
  - typography
  - text size
  - density
  - meter preview rows
  - inline guides
  - diagnostic panel visibility
- New `RESET DEFAULTS` action in `UI SETTINGS`.

### Changed
- `UI SETTINGS` redesigned into clearer grouped sections with descriptions and a stronger live preview block.
- Expanded typography options (`System`, `Sans`, `Condensed`, `Serif`, `Mono`) and text-size presets (`Small`, `Normal`, `Large`, `XL`).
- Density now has visible impact on workspace layout (sidebar/workspace spacing, header layout, modal comfort paddings).
- Workspace header actions now wrap safely on wider layouts to avoid clipping.
- Target selector CTA text and button prominence improved (`SELECT TARGETS` / `EDIT TARGETS`).
- Modal safe-area bottom handling increased to reduce footer overlap with tablet system navigation.

### Fixed
- Settings behavior that appeared “half-applied” is now deterministic and persistent across app restarts.
- Global text scaling now also scales `lineHeight`, reducing cropped/overlapping labels when increasing text size.
- Diagnostic panels can be disabled from settings to declutter macro-building workspace.

## [1.0.85] - 2026-05-20

### Fixed
- `Automizations` workspace is now actually editable (not add-only):
  - editable name,
  - editable source field,
  - mode switch (`INVERSE` / `DIRECT`),
  - target count stepper.
- Sidebar cards reflect live edits immediately.

## [1.0.84] - 2026-05-20

### Added
- Sidebar split into two explicit sections:
  - `MACROS` (discrete Trigger/IF/THEN workflows),
  - `AUTOMIZATIONS` (dedicated space for realtime mapping workflows).
- Dedicated CTA for the new section: `+ ADD AUTOMIZATION`.
- New workspace branch for selected automizations (separate from macro editor), preparing the inverse/proportional link engine UX.
- Release snapshot for this build:
  - `releases/2026-05-20-build-1.0.84/wing-controller-1.0.84-release.apk`
  - `releases/2026-05-20-build-1.0.84/SHA256SUMS.txt`
  - `releases/2026-05-20-build-1.0.84/BUILD_MANIFEST.md`

### Changed
- Macro creation CTA renamed to `+ ADD MACRO` to avoid mixing concepts.
- Empty workspace guidance now reflects the dual model (macro timelines vs realtime automizations).

## [1.0.83] - 2026-05-20

### Added
- Active Selection validity surfaced in macro UI (`resolved/unresolved`) for Trigger, IF and THEN target editors.
- Live trigger telemetry preview now supports:
  - monitor meters (`/meters/monitor/*`),
  - RTA bands (`/meters/rta/*`),
  - V2 state meters (`gate_led`, `dyn_state`) as ON/OFF status chips.
- Release snapshot for this build:
  - `releases/2026-05-20-build-1.0.83/wing-controller-1.0.83-release.apk`
  - `releases/2026-05-20-build-1.0.83/SHA256SUMS.txt`
  - `releases/2026-05-20-build-1.0.83/BUILD_MANIFEST.md`
- New protocol audit artifacts:
  - `docs/maillot-compliance-matrix.md`
  - `docs/roadmap-maillot-features.md`

### Changed
- `selected` target resolution no longer silently falls back to `CH1` when `/$ctl/$stat/selidx` is unresolved.
- Trigger match evaluation now handles all `meter*` parameters consistently (not only legacy `meter`).
- UI meter preview subscriptions are now cleaned up when the trigger editor no longer needs them, reducing stale watched-address scopes.

## [1.0.82] - 2026-05-20

### Added
- Baseline freeze artifacts for reproducible rollback:
  - `releases/2026-05-20-build-1.0.82/wing-controller-1.0.82-release.apk`
  - `releases/2026-05-20-build-1.0.82/SHA256SUMS.txt`
  - `releases/2026-05-20-build-1.0.82/BUILD_MANIFEST.md`

### Fixed
- Source/output native meter request now follows Maillot-oriented device-byte semantics strictly:
  - source/output device bytes are sent in zero-based form (`0x00...`),
  - `0xA7` and `0xA8` payloads are emitted as token + device-byte list, instead of repeated token pairs.
- Removed auto-fallback toggling between one-based/zero-based source ids to avoid silent off-by-one group decoding.

## [1.0.81] - 2026-05-20

### Added
- Output meters are now integrated into macro targets (`Output Audio Meter (dB)`), with dedicated categories:
  - Local Out, Aux Out, AES50 A/B/C Out, StageConnect Out, USB Out, Card Out, Module Out, USB Rec Out, AES/EBU Out.
- Realtime trigger meter preview now labels output and user-signal addresses explicitly (`... OUT ...`, `USR ...`).

### Changed
- Meter transport wiring now includes WING native `0xA8` output device requests in the same style as source meter groups.
- Source/output meter grouping and decode logic were aligned to Maillot-oriented fixed-group behavior with safer adaptive fallback decode.
- User Signal object count updated to `48` in the selector.

## [1.0.80] - 2026-05-20

### Added
- Automatic console model detection from:
  - discovery reply (`WING?` on port 2222, `c_model` field)
  - OSC syscfg values (`/$syscfg/$cnscfg`, `/$syscfg/$cnsmdl`)
- Runtime exposure of model diagnostics (`consoleModel`, source field, raw model strings) for UI/status panel.

### Changed
- Handshake now proactively queries `/$syscfg/$cnscfg` and `/$syscfg/$cnsmdl`, and retries while model is still unknown.
- `LOCAL IN` capacity can now auto-adapt from real detected model in the target selector logic (`wing` => 8, rack/compact => 24).

## [1.0.79] - 2026-05-20

### Changed
- Source meter decode now adapts between two valid packet styles:
  - full source-group payloads (e.g. all local source meters in one block)
  - indexed/selected payloads (only requested source IDs)
- Source meter request keeps Maillot `0xA7` flow and adds automatic source-device index fallback:
  - starts with `1..16` mode
  - if no source data arrives, retries once in `0..15` mode without touching non-source meters.
- Added runtime status exposure for source meter mode diagnostics (`sourceDeviceIndexMode`).

### Fixed
- Prevented wrong source index mapping when a source packet contains fewer values than the full group size (e.g. selected `Local 11` no longer gets decoded as `Local 1`).
- Updated `usersig` source meter group baseline to `24` to match current UI selection range.

## [1.0.78] - 2026-05-20

### Changed
- Removed numeric reference markers below Trigger value sliders for both `Fader` and `Audio Level Meter` editors, reducing visual clutter in macro popups.
- Fader slider now uses the same fine non-linear curve family as meter/level controls, with an explicit `-oo..-90 dB` off-zone and high-resolution control in the active audio range.

### Fixed
- Fader slider midpoint behavior and dB feel are now coherent with the meter trigger scale, while preserving full editable range down to `-oo`.

## [1.0.77] - 2026-05-20

### Fixed
- Meter trigger slider calibration updated so the physical midpoint now maps to `-20 dB` exactly.
- Trigger scale consistency pass completed for key dynamic controls using Maillot v3.1.0-3 ranges:
  - `gate_thr`: `-80..0 dB`
  - `comp_thr`: `-60..0 dB`
  - `gate_attack`: `0..120 ms`
  - `gate_release`: `4..4000 ms`
- Dynamics UI labeling corrected for `comp_knee` to index-domain (`0-5`) instead of dB wording.

## [1.0.76] - 2026-05-20

### Changed
- Refined trigger/action value scales across the macro editor with protocol-aligned ranges (pan, EQ gain/Q, gate/comp threshold, range, attack/release, makeup, ratio, knee).
- Pan controls now use true `L100..R100` scale instead of normalized `0..1`.
- Meter threshold slider now uses a non-linear dB curve (matching the realtime meter visual behavior) for finer control around meaningful live ranges.
- Fader comparisons in trigger evaluation now run in dB domain for consistent `fdr` threshold behavior.

### Fixed
- Loading existing macros now normalizes legacy values into coherent UI units (dB/Hz/ms/pan) before editing, reducing mixed-scale confusion.
- Trigger/Condition/Action target changes now reset value fields to scale-appropriate defaults, preventing stale values from incompatible parameter types.

## [1.0.75] - 2026-05-20

### Changed
- Trigger meter bar rendering now uses a compressed piecewise dB curve (pro-meter style) so low-level noise (e.g. `-100 dB`) stays near-zero visually while keeping useful resolution near `-20..+12 dB`.
- Very low signal bands are now rendered in neutral gray and transition to green/yellow/red only when the level is meaningful.

### Fixed
- Diagnostic transport logs no longer dump unreadable binary payloads as UTF-8 text (`?` spam). Binary frames are now summarized as throttled `[Rx BIN] len=... hex=...`.
- Connection diagnostic panel typography/height reduced to keep the left column readable without crowding.

## [1.0.74] - 2026-05-20

### Changed
- Runtime backport strategy: restored OSC/meter engine behavior to the 1.0.62 baseline while keeping the modern macro-builder UI layer.
- Trigger target picker CTA kept as explicit `SELECT TARGET(S)` / `EDIT TARGET(S)` with larger hit area.

### Fixed
- Meter bar visual scale now maps correctly to dB values using a calibrated range (`-128 dB` to `+12 dB`) instead of the previous mismatched width curve.
- Fader value editor now works in dB domain end-to-end (slider + manual input), so displayed values, saved values and macro logic stay coherent.
- Added compatibility subscription wrapper in UI so advanced screens work against the 1.0.62-style `OscManager.on()` API.

## [1.0.73] - 2026-05-20

### Fixed
- Restored meter stream startup after the 1.0.71 signature optimization regression.
- Meter subscribe now waits for native TCP readiness before applying signature-dedupe state.
- Every native TCP metering reconnect now forces a fresh full meter collection subscription.

## [1.0.72] - 2026-05-20

### Fixed
- Native meter TCP link now auto-recovers after socket failures (e.g. `Broken pipe`) by reconnecting to the last WING host/port.
- Meter transport retries now trigger a clean native reconnect path instead of staying stuck on a dead socket.

### Changed
- Target object picker CTA in macro editor is now explicit (`SELECT TARGET(S)` / `EDIT TARGET(S)`), larger, and includes contextual helper text.

## [1.0.71] - 2026-05-20

### Fixed
- Removed periodic meter micro-cuts caused by redundant resubscription loops every keepalive cycle.
- Meter subscription now only reconfigures when the effective meter target signature actually changes.

### Changed
- Added stable subscription signature caching for meter collections, preserving active `reportId`s across unchanged `selidx` polls.

## [1.0.70] - 2026-05-20

### Changed
- Meter subscriptions now allocate independent `reportId`s per source-device collection (`0xA7`) instead of mixing multiple source devices in one collection frame.
- Meter renew (`0xD4`) is now sent for every active meter report id.

### Fixed
- Eliminated cross-device source meter ambiguity when `local` and `usb` (or other source groups) are watched simultaneously.
- Source meter decoding now resolves against the exact descriptor set for each incoming `reportId`, reducing wrong source-index mapping risk.

## [1.0.69] - 2026-05-20

### Changed
- Source-meter `usb` group size corrected to `48` (Maillot/WING routing spec), preventing misalignment when decoding mixed source requests (`local + usb`).
- Source-meter `usersig` default group size updated to `48`.
- Console model normalization now maps discovery/syscfg tokens (`ngc-full`, `wing-bk`, `wing-rack`, `wing-compact`) into stable internal variants.

### Fixed
- Fixed `local in` source meters disappearing (e.g. `local/11`) when WING source packet parsing was offset by wrong USB group assumptions.
- Added explicit model refresh from `/$syscfg/$cnscfg` and `/$syscfg/$cnsmdl` during handshake to reduce wrong local-count assumptions.

## [1.0.68] - 2026-05-20

### Added
- Automatic source-meter group size adaptation from incoming native meter packet length (per requested device order).
- WING discovery model parsing (`wing`, `wing-rack`, `wing-compact`) stored in runtime status.

### Changed
- `local` source-meter base count now follows detected console model (`8` on `wing`, `24` on `wing-rack` / `wing-compact`) with runtime auto-correction if packet size differs.
- `usb` source-meter base count updated to `64` and still auto-corrected by packet inference when needed.
- Target selector now applies console-model-aware local input count in UI (object grid and category count).

### Fixed
- Fixed source meter index drift when real source-group payload size differs from hardcoded counts.
- Prevented invalid local source IDs (e.g. >8 on `wing`) from being kept silently in trigger target selection.

## [1.0.67] - 2026-05-20

### Changed
- Source metering native request (`0xA7`) now uses **device-only collection** (no source index bytes), aligned with Maillot docs and libwing/wapi behavior.
- Source metering decode now always processes the full meter block for the requested source device group.

### Fixed
- Fixed `source meter` trigger values being mapped to wrong channels (e.g. monitoring `local/11` could read `local/1` values).

## [1.0.66] - 2026-05-20

### Added
- Source categories (`LOCAL/AES50/STAGECONNECT/EXP CARD/USB/USR`) now expose `Meter (dB)` as a selectable trigger/condition parameter.
- DCA category now also exposes `Meter (dB)` for telemetry-based macros.

### Changed
- Native source metering request (`0xA7`) now sends **device + explicit indices**, aligned with Maillot meter collection format.
- Source meter decode now maps returned values to the **requested source indices** instead of assuming full-group payloads.
- Typography and text-size settings are now applied globally to `Text`/`TextInput` rendering across the app UI.
- DCA object count in selector corrected to `8` (WING range).

### Fixed
- Fixed source meter triggers not updating when monitoring specific source IDs (e.g. `Local 11`) due to index mapping mismatch.
- Fixed partial typography application where only some labels/buttons reacted to settings.
- Added source-device alias normalization (`aes50a/b/c`, `card/crd/wlive`) for more robust custom meter addressing.

## [1.0.65] - 2026-05-20

### Added
- Target object list now opens in a dedicated popup (`Select Objects`) instead of expanding inline inside the macro builder.
- UI Settings now includes a live preview block so typography and text-size changes are immediately visible.

### Changed
- Reworked `UI SETTINGS` modal layout to be scrollable and stable on tablet sizes (no overflow clipping).
- Typography and text-size settings are now applied directly in macro-builder editor surfaces (Trigger/IF/THEN + Target Editor) instead of relying on global defaults.
- Trigger/IF/THEN modal titles, labels and apply buttons now scale with selected UI text size.

### Fixed
- Removed broken global `Text.defaultProps`/`TextInput.defaultProps` strategy that was not reliably affecting styled text.
- Fixed settings modal overflow/desbordamiento issues.
- Target object selection flow no longer creates long inline grids that break popup readability.

## [1.0.64] - 2026-05-20

### Added
- New `UI SETTINGS` modal accessible from the workspace header and empty state.
- Typography selection (`System`, `Sans`, `Serif`, `Mono`).
- Text size presets (`S`, `M`, `L`).
- UI density presets (`Compact`, `Comfortable`) for macro editor modals.
- Meter preview row limit settings (`4`, `8`, `12`) to control Trigger modal height pressure.
- Context-help toggle for operator guide cards in Trigger/IF editors.

### Changed
- Trigger/IF/THEN modals now use safe-area aware containers and bottom padding to avoid footer overlap with Samsung navigation controls.
- Modal structure tuned for tablet fit: compact padding, stacked-pane behavior improvements, and sticky apply footer.
- Target object selection is now compact by default with a collapsible object grid (`OPEN GRID` / `HIDE GRID`).
- Trigger meter preview now truncates long channel lists and shows a `+N more` summary.

### Fixed
- `APPLY` buttons in modal footers no longer render underneath system navigation controls.
- Multiple button labels were resized/adjusted to reduce clipping risk with aggressive device fonts.
- Type safety issue in meter threshold clamp path (`descriptor.min/max` fallback).

## [1.0.63] - 2026-05-20

### Added
- Runtime protocol status in UI (WING online state, native meter socket state, listen port, active meter groups).
- Macro preflight checks with explicit errors/warnings before save.
- Target-aware value normalization and clamping for trigger/condition/action values.
- Target-aware operator filtering (`==`, `!=`, `>`, `<`) based on parameter type.
- `OscManager.on(...)` unsubscribe return and `OscManager.off(...)` helper for safer listener cleanup.

### Changed
- `SafeAreaView` import moved to `react-native-safe-area-context` (React Native deprecation cleanup).
- Default fade action target/value/duration tuned for real use (`fader`, `-10 dB`, `2.0s`).
- Macro editor copy/layout cleaned up for better readability and coherence.
- Mixing Station trigger path now clearly shown as unavailable when bridge support is disabled.

### Fixed
- Prevented false-positive UI messaging that suggested an active Mixing Station bridge when disabled.
- Reduced meter-trigger debug noise in `MacroEngine` with a dedicated verbose toggle.

## [1.0.62] - 2026-05-20

### Snapshot
- First functional baseline confirmed on device.
- Realtime WING OSC state/events receiving verified.
- Realtime meter receiving verified.
- Meter-based trigger evaluation verified.
- Trigger edge modes (`on`, `off`, `on_off`) available.

### Artifact
- See `releases/2026-05-20-first-functional-1.0.62/BUILD_MANIFEST.md`.
