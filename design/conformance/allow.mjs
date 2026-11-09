// The app's declared deviations, the version of the kit it took, and where the app is.
//
// A deviation is a *decision with a reason*, not a mute button: the suite reads this file, accepts only what is
// listed here, and prints every accepted deviation by name in its report. An undeclared deviation is a failure.
//
//   app:      'the operator\'s name for the app',   // what the drift dashboard calls this row
//   allowApp: 'index.html',                         // the window this declaration is about, relative to this file
//   kitVersion: '1.5.0',                            // the version of the copy beside this file (`../VERSION`)
//   deviations: [
//     {
//       rule: 3,                          // the §11 point (1–8), optional: without it, any rule may match
//       match: 'rgb(255, 0, 255)',        // any text the suite reported: a measured value, #hex, an element name
//       reason: 'the panic flash is magenta on purpose: it must be visible in both themes',
//     },
//   ]
//
// `match` is compared against the element, the path, the measured value and every spelling of the measured colour
// (`#ff00ff` and `rgb(255, 0, 255)` both work), ignoring case and whitespace.
//
// `kitVersion` must be the version of the kit you copied (the `VERSION` file beside this directory). The suite
// compares the two: a copy whose files come from two versions, or a declaration left behind by a half-done re-copy,
// is caught here. It cannot tell you the kit has moved on upstream — that is the drift dashboard's job
// (`design/conformance/report.mjs`, roadmap ITEM 5), which reads this same declaration:
//
//   node design/conformance/report.mjs --root .        # app · kit version · how far behind · deviations · last run
//
// The dashboard prints one row per app, found by this file alone — so a window that links the kit and declares
// nothing is a row that says it declared nothing, rather than an app nobody can see. `last conformance run` is the
// sibling `run.json`, written by `node design/conformance/run.mjs --app <window> --record`; with no such file the
// row says `never`, which is the truth and not a pass.
//
// ---------------------------------------------------------------------------
// What is declared here, and what is NOT (2026-10-08)
// ---------------------------------------------------------------------------
// **Two allowance files, two consumers, and an entry in the wrong one is silently useless** (measured 2026-10-08).
// This file takes **rendered-page** deviations for `design/conformance/run.mjs` — findings measured on a page, which
// is what rules 1–8 report. `desktop/ui/allow.mjs` takes **token-agreement** deviations for
// `scripts/test-design-app-agreement-live.mjs`, which compares each window's `:root` values with the kit's. The two
// are not interchangeable and a mistake in either direction is quiet: a token declaration written here is reported
// as a note that "matched nothing" on every run, and a rule-8 declaration written there can never match a token row,
// so it does nothing for `run.mjs` **and** turns the agreement checker's oracle red
// (`scripts/test-design-app-agreement.mjs` asserts that every entry in that file matched a row). The token file says
// its own half of this; this paragraph is the other half.
//
// `run.mjs` reads this one file for every window it is pointed at, and a declaration has no window field: `match`
// is a plain substring, so an entry made for one window also covers any other rendering that contains the same
// text. Every entry below is therefore measured **across all five windows** (`index.html`, `timecode.html`,
// `ltc.html`, `meters.html`, `guide.html`) and each one's reason says which window it is for. Four of the entries
// below also match renderings in `index.html`, which is named in their reason rather than hidden: the raised
// three-step face and the dark green furniture are the same idiom in both windows, and declaring it once with both
// named is more honest than writing it twice with one of the two pretending not to be covered.
//
// **Measured state, 2026-10-08 (later the same day), one window per line** — the numbers are from
// `node design/conformance/run.mjs --app desktop/ui/<window>` against this file, and every one of them moved in a
// commit that names it:
//
//   meters.html    `CONFORMANCE OK · 0 failures` · 40 declared
//   guide.html     `CONFORMANCE OK · 0 failures` · 293 declared
//   ltc.html       `CONFORMANCE OK · 0 failures` · 8 declared (this session: the 7 frozen inputs and the
//                  `dd#counters` readout were **fixed**, not declared — a themed `input, select` field rule and the
//                  instrument well in the header — and what is left is the save control's action green)
//   timecode.html  `CONFORMANCE OK · 0 failures` · 2 declared (the two raised header buttons are the same three-step
//                  face the meters entry below already covers; `span#version` was **fixed**: it is `--mono` in a
//                  `--crt` well now)
//   index.html     `CONFORMANCE FAILED · 1,069 failures` · 211 declared (rule 2 and rule 4 are **fixed** — except
//                  the Live button's ink, declared with the measurement that says the theme-following alternative
//                  reads worse; rule 5's nine greyed controls and the one rounded glyph are declared below; rule 3's
//                  913 unknown colours and rule 1's 156 palette-driven edges are deliberately **not** declared)
//
// **Corrected the same day, when rule 8 landed.** The five lines above are a photograph of the state *before*
// typography was judged at all: rules 1–7 never read a `font-size` (measured before the change:
// `grep -c 'font-size' design/conformance/rules.mjs` was **0**), so a window could set any pixel size it liked and
// still be green. Rule 8 now measures the kit's five steps and the single knob that moves them, and **the
// application never adopted its own type scale**. Re-measured 2026-10-08 against this file, rule 8's own findings:
//
//   meters.html    23 rule-8 failures
//   guide.html    210
//   ltc.html       68
//   timecode.html  22
//   index.html    488 (on top of the 1,069 it already carried)
//
// Every one was a literal `font-size` — 11px, 10px, 9px, 9.5px, 12px, 15px, 30px — that is not one of the kit's five
// steps (`8px`, `8.5px`, `9.5px`, `10.5px`, `11.5px` at `--meter-scale` 1). What makes the migration honest rather
// than convenient is the other measurement: the kit's own page passes rule 8 —
// `checked steps 5 · texts 468 · sized 468 · invented 0 · moved 468 · notMoved 0` on `design/specimen.html` — so the
// rule is satisfiable with the kit as it stands, and the drift was in the windows.
//
// **MIGRATED, 2026-10-08, one window per commit — and this paragraph replaces the "None is declared here" that was
// true when rule 8 landed.** Re-measured after the migration, each window through
// `node design/conformance/run.mjs --app desktop/ui/<window>` against this file:
//
//   timecode.html  22 -> 0 undeclared · 2 declared (the clock face, 52px)
//   meters.html    23 -> 0 undeclared · **nothing declared** — this window needs no rule-8 deviation at all
//   ltc.html       68 -> 0 undeclared · 2 declared (the clock face, 30px)
//   guide.html    210 -> 0 undeclared · 2 declared (the chapter title, 17px)
//   index.html    488 -> 0 undeclared · 2 declared (the Timecode card readout, 22px measured)
//
// The migration is `var(--font-base)` where a window wrote 11px, `--font-lg` for its 12px headings, `--font-sm` for
// its 10px lines, `--font-xs` for its 9px labels — plus the literals that already happened to *be* kit steps
// (9.5/10.5/11.5px), which cost one finding each because the knob could not move them and now can. What was declared
// in the `rule 8` block at the end of this file, when the migration landed, was the one class migration cannot reach:
// **an instrument readout larger than the kit's whole scale.** The five interface steps are `clamp()`s whose ceilings
// are badge 10px, xs 16px, sm 18px, base 13px and lg 14px, so **no setting of `--meter-scale` produced a text larger
// than 18px** — which meant the remedy this file's own README gives for big type ("raise the knob") could not reach a
// 21px, 22px, 26px, 30px or 52px clock.
//
// **EXECUTED, 2026-10-08 (`DESIGN-SYSTEM-ROADMAP.md` §4l, D-TYPE-4): the kit names the instrument readings.** The
// paragraph above is kept as the state the decision was taken against, because it is the measurement that made the
// decision, and three of its sentences are now false. The kit gained four steps above the interface's 18px ceiling —
// `--font-readout` (22px), `--font-readout-lg` (26px), `--font-clock` (30px), `--font-clock-lg` (52px) at
// `--meter-scale` 1 — whose **floors are the sizes measured in the windows**, so naming them moved no pixel (measured:
// `scripts/test-design-screens.mjs` reported all ten images byte-identical at that commit, both themes). The
// application's base then moved to 1.25 in the same day's second change (`DESIGN-SYSTEM-ROADMAP.md` §4l, D-TYPE-5), so
// the readings are now 23.375 / 27.625 / 31.875 / 55.25px and the screenshots were refreshed with that change.
// Re-measured the same day through `node design/conformance/run.mjs --app desktop/ui/<window>`:
//
//   timecode.html  the clock is `clamp(var(--font-clock), 7vw, var(--font-clock-lg))`; at both frames it runs in (the
//                  420 x 200 it opens in and its 260 x 140 minimum) `7vw` is below the floor, so it is `--font-clock`
//                  and lands on a step, and at the suite's rendering (756 x 469) `7vw` is 52.92px — between
//                  `--font-clock` and `--font-clock-lg` at the application's base of 1.25 — so the one declaration left
//                  for it covers **the `7vw` term**, reported by both of rule 8's checks and declared with both numbers.
//   ltc.html       the clock is `var(--font-clock)` = 30px, its own measured size; the declaration is **deleted**.
//   index.html     the Timecode card readout is `var(--font-readout)` = 22px and the Properties readout
//                  `var(--font-readout-lg)` = 26px; both declarations are **deleted**.
//   guide.html     the 17px chapter `h2` **stays declared**: D-TYPE-4 puts a document hierarchy out of an instrument
//                  scale, and the interface steps still reach only 18px while the nearest step below 17px is the 11.5px
//                  `--font-lg` this window gives its own `h3`. Its reason now says which steps it means.
//
// Two corrections this execution forced, both measured rather than assumed:
//
//   1. **The meter card's `.value` is not 21px and never was, at HEAD.** The declaration said 21px, taken from the
//      generic `.value` rule at `index.html:2694`; the element `renderMeters` builds is `.meter-card-header .value`,
//      which is `var(--font-lg)` and computes **11.5px** — measured on the rendered page by building the card and
//      reading `getComputedStyle`. It is a kit step already, so its declaration is **deleted**: a declaration whose
//      stated size is not the element's size is rot, whether or not it matches anything.
//   2. **`timecode.html`'s clock cannot be a fixed step.** A fixed 52px overflows the window's own 260 x 140 minimum
//      (measured: `body` scrollWidth 372 on a 260px body, and `body { overflow: hidden }` clips it), which is why the
//      cap stays the `clamp()`'s upper bound and the floor is the kit's 30px rather than the 22px the literal used.
//
// What is left in the `rule 8` block is therefore **two** declarations, not six: the middle of timecode's responsive
// clamp, and the guide's chapter title.
//
// **And `index.html`'s rule 3 is the one thing this file refuses to make green.** Its 1,007 baseline findings are
// **136 distinct hex values**, 917 of them matching exactly one finding: that is not a palette with families, it is
// roughly 136 colour decisions nobody has taken. D-INDEX-PALETTE-1 (2026-10-08) decides that each value is either a
// duplicate of a kit value — in which case the literal is replaced by the token — or genuinely new, in which case it
// goes into `design/tokens.json` and is regenerated, so every window can use it. Until that migration lands,
// index.html's rule 3 is **reported as not-yet-migrated**: not declared, not hidden. A `match` broad enough to cover
// a thousand findings is the mute button this design forbids, and the tool that names a declaration which matched
// nothing cannot name a declaration that matched too much. `docs/DESIGN_DISAGREEMENTS_2026-10-08.md` and the session
// report carry the measured list.
export default {
  // This is the kit's own copy, so the declaration and `design/VERSION` are two files of the same repository: if you
  // bump the kit's version, update this line in the same change — the suite will tell you if you forget, which is the
  // drift check doing its job.
  kitVersion: '1.5.0',
  app: 'design/conformance',
  // The kit's own consumable surface is the specimen: it links `tokens.css` and renders every token and component
  // the kit defines (`design/specimen.html`), and it is what the suite's fixture runs are checked against.
  allowApp: '../specimen.html',
  deviations: [
    // ---------------------------------------------------------------------------------------------------------
    // meters.html · rule 1 — the classic raised face's inner step
    // ---------------------------------------------------------------------------------------------------------
    {
      rule: 1,
      match: 'rgb(128, 128, 128) -1px -1px 0px 0px inset',
      reason:
        'meters.html (and the same idiom in index.html): a raised control here is the kit\'s light-before-dark edge pair plus one inset step in `--win-btn-shadow`, which `design/conformance` reads as a raised thing carrying a sunk-in second shape. It is one shape with a second step, not two shapes: the token exists for it, the pressed state is the same step moved to the other corner, and removing it would flatten every button in the window. 16 findings in meters.html — the two toolbars, the raised buttons, the five sidebar tabs and `div#meters-brand-logo` — and the same three-step face in 100 findings of index.html and 2 of timecode.html, all measured. Those two extra windows are why the reason names them: a declaration cannot say "meters only", so it says where it also reaches',
    },
    // ---------------------------------------------------------------------------------------------------------
    // meters.html · rule 1 — the active folder tab
    // ---------------------------------------------------------------------------------------------------------
    {
      rule: 1,
      match: 'right rgba(0, 0, 0, 0)',
      reason:
        'meters.html, `button.seg-tab.is-active`: the active sidebar tab is a folder tab and merges with the stage, so its right edge is deliberately `transparent` while the other three carry the bevel (meters.html `.seg-tab.is-active`, "the active tab keeps the classic folder-tab look"). The suite classifies the transparent edge as a mixed pair because a transparent colour is in neither kit step',
    },
    {
      rule: 1,
      match: 'top rgb(75, 99, 85)',
      reason:
        'meters.html, `div#meters-brand-logo`, dark theme: the mark keeps its own green edges (`#4b6355` light step, `#0c1410` dark step) rather than the kit\'s neutral `--win-btn-highlight`/`--win-btn-dark-shadow`, because in Stealth Dark the branding is tinted with the window\'s green while the chrome is not. It is a raised pair in the right orientation; it is simply not the kit\'s two step *values*, which is the livery decision D-PALETTE-1 records',
    },
    // ---------------------------------------------------------------------------------------------------------
    // meters.html · rule 3 — the instrument livery (D-PALETTE-1)
    // ---------------------------------------------------------------------------------------------------------
    {
      rule: 3,
      match: '#ffb454',
      reason:
        'meters.html, `span#bridge-status-badge`: the amber "not yet live" pill. This is the instrument\'s own livery — the operator reads the connection state by its colour — and the kit names ambers for other meanings (§5 gives `--amber` to an unfinished *value*, not to a link state). D-PALETTE-1: declared, not flattened (1 finding: its text)',
    },
    {
      rule: 3,
      match: '#d97a00',
      reason:
        'meters.html, `span#bridge-status-badge`: the same amber pill\'s darker edge, the amber pair read as a raised chip (4 findings: its four edges)',
    },
    {
      rule: 3,
      match: '#4a2f08',
      reason: 'meters.html, `span#bridge-status-badge`: the amber pill\'s warm dark ground (1 finding: its background)',
    },
    {
      rule: 3,
      match: '#202b25',
      reason:
        'meters.html, `div#meters-brand-logo`, dark theme: the brand mark\'s green-tinted face, the ground the green bevel is drawn on. Declared with the rest of the mark below, and it is also a dark surface in index.html (9 findings there), which is why the reason names both',
    },
    {
      rule: 3,
      match: '#4b6355',
      reason:
        'meters.html, `div#meters-brand-logo`: the mark\'s dark light-step edge (2 findings), declared with `#0c1410` as the pair; the same green is 18 findings of index.html\'s dark card furniture, so this entry covers both windows and says so',
    },
    {
      rule: 3,
      match: '#0c1410',
      reason:
        'meters.html, `div#meters-brand-logo`: the mark\'s dark dark-step edge (2 findings) and one inner shadow; the same value is 20 findings of index.html\'s dark furniture — one declared value, two windows',
    },
    {
      rule: 3,
      match: '#2b3b33',
      reason:
        'meters.html, `div#meters-brand-logo`: the mark\'s inner light step in the dark theme, reported together with `#121915` (its inner dark step) as one shadow; the entry names both because the suite reports them as one finding (1 finding)',
    },
    {
      rule: 3,
      match: '#19201d',
      reason:
        'meters.html, `aside.bridge-sidebar`: the group rail\'s dark ground, one step off the kit\'s `--face-3` but the window\'s own ladder with `#232c28` and `#19201d` (1 finding)',
    },
    {
      rule: 3,
      match: '#232c28',
      reason: 'meters.html, `button.seg-tab.is-active`: the selected tab\'s dark face, the second rung of the same ladder (1 finding)',
    },
    {
      rule: 3,
      match: '#4d665b',
      reason: 'meters.html, `button.seg-tab.is-active`: the selected tab\'s dark light-step edge (2 findings), the green-tinted pair with `#3b4d45`',
    },
    {
      rule: 3,
      match: '#3b4d45',
      reason: 'meters.html, `button.seg-tab.is-active`: the selected tab\'s dark dark-step edge (1 finding)',
    },
    {
      rule: 3,
      match: '#0b1410',
      reason:
        'meters.html, `button#meter-layout-select-menu` and `button#meter-style-select-menu`: the drawn dropdown\'s own dark field ground (2 findings; the same value is 27 findings of index.html\'s dark fields)',
    },
    // ---------------------------------------------------------------------------------------------------------
    // meters.html · rule 4 — the amber pill's black label
    // ---------------------------------------------------------------------------------------------------------
    {
      rule: 4,
      match: 'its text rgb(0, 0, 0)',
      reason:
        'meters.html, `span.beta-pill` ("BROADCAST FOH"): black text on the kit\'s `--amber`, the same in both themes *on purpose*. The pill is its own ground — the amber does not change between themes — so the ink must not either; forcing it to follow the theme would put pale ink on a mid amber in the dark theme (1 finding)',
    },
    // ---------------------------------------------------------------------------------------------------------
    // meters.html · rule 5 — the one disabled control
    // ---------------------------------------------------------------------------------------------------------
    {
      rule: 5,
      match: 'Remove selected meters from Watchlist',
      reason:
        'meters.html, `button#btn-remove-selected-meters` is disabled at rest because nothing is selected: its whole job is to take the selected meters out of the watchlist, so with no selection there is no action to take and the count beside it is `0`. It is a working control reached by selecting a strip first (`syncMeterSelectionUi` enables it, `removeSelectedMeters` acts), not a placeholder, and the repository\'s own contract asserts this exact state (`scripts/test-desktop-meter-bridge-status-browser.mjs` §9). Declared with that reason rather than fixed, because the alternative is a control that looks live and then refuses (1 finding)',
    },
    // ---------------------------------------------------------------------------------------------------------
    // guide.html · rule 4 — the reading palette's dark values
    // ---------------------------------------------------------------------------------------------------------
    // The same eight values `desktop/ui/allow.mjs` already declares for the agreement checker, with the same
    // reasoning: `DESIGN_DISAGREEMENTS_2026-10-08.md` rows 2–10, decided on 2026-10-08 before this file had any
    // rendered findings. This is the conformance suite's copy of that decision, one entry per token because this
    // suite reports them per token.
    {
      rule: 4,
      match: '--face-2',
      reason: 'guide.html keeps its own dark sidebar/table-head surface: the guide is a reading window whose dark surface order is inverted against the kit (chrome #222726, sidebar darker), and the kit has no value for a reading pane (DESIGN_DISAGREEMENTS_2026-10-08.md row 3)',
    },
    {
      rule: 4,
      match: '--face-3',
      reason: 'guide.html keeps its own dark reading-pane surface, the top of the same inverted order (row 2)',
    },
    {
      rule: 4,
      match: '--field',
      reason: 'guide.html keeps its own dark search-field surface, part of the same reading-window palette (row 4)',
    },
    {
      rule: 4,
      match: '--ink',
      reason: 'guide.html keeps its own dark ink: #e6efeb measures 14.07:1 on the sidebar #1b201f against the kit\'s 12.14:1, so the deviation is the higher-contrast one a long-form reading window wants (row 5)',
    },
    {
      rule: 4,
      match: '--muted',
      reason: 'guide.html keeps its own dark muted ink: #b9c6c0 measures 8.59:1 on #222726 against the kit\'s 5.80:1, and it is the sidebar note, the empty state and the status bar (row 6)',
    },
    {
      rule: 4,
      match: '--line-mid',
      reason: 'guide.html keeps its own dark divider step, used for the sidebar and table separators (row 8)',
    },
    {
      rule: 4,
      match: '--line-light',
      reason: 'guide.html keeps its own dark bevel highlight, the light-before-dark pair preserved (row 9)',
    },
    {
      rule: 4,
      match: '--line-dark',
      reason: 'guide.html keeps its own dark bevel shadow, the other half of its dark divider pair (row 10)',
    },
    // ---------------------------------------------------------------------------------------------------------
    // guide.html · rule 3 — the reading window's palette (D-PALETTE-1)
    // ---------------------------------------------------------------------------------------------------------
    // Every colour below is measured **only** in guide.html: none of the thirteen appears in the other four
    // windows' findings, so these entries are as narrow as they look. The values are guide.html's own `:root` and
    // `body.theme-dark` palette, the one the eight declarations above belong to.
    {
      rule: 3,
      match: '#e6efeb',
      reason:
        'guide.html, the reading window\'s dark ink: #e6efeb measures 14.07:1 on its sidebar #1b201f against the kit dark ink\'s 12.14:1. It is the body text of a long-form document, and the deviation is the higher-contrast one (119 rule-3 findings; the same value is also the `--ink` declaration above)',
    },
    {
      rule: 3,
      match: '#47524e',
      reason: 'guide.html, the dark divider/muted step of the reading palette: the sidebar edge, the table separators and the word counts (51 findings)',
    },
    {
      rule: 3,
      match: '#0b0f0e',
      reason: 'guide.html, the dark bevel shadow of the reading palette — the dark step of the search field, the chapter list and the buttons (44 findings)',
    },
    {
      rule: 3,
      match: '#59645f',
      reason: 'guide.html, the dark bevel highlight of the reading palette, the pair to #0b0f0e (41 findings)',
    },
    {
      rule: 3,
      match: '#ecebe5',
      reason:
        'guide.html, the light ground of the inline-code well and the port-value cells: the warm paper a code sample is read on, which the kit\'s `--field` white is not (16 findings; `#c9c7bf` and `#38423f`, the frame it used to draw, are gone — the well now uses the kit\'s sunken pair)',
    },
    {
      rule: 3,
      match: '#1b201f',
      reason: 'guide.html, the reading window\'s dark sidebar ground, darker than the content pane (4 findings; the same value is the `--face-2` declaration above)',
    },
    {
      rule: 3,
      match: '#d8ffe9',
      reason: 'guide.html, the title-bar wordmark ink in the dark theme, on its own #14372b bar (2 findings)',
    },
    {
      rule: 3,
      match: '#06231a',
      reason: 'guide.html, the ink of the selected chapter row on the dark green title colour (2 findings)',
    },
    {
      rule: 3,
      match: '#b9c6c0',
      reason: 'guide.html, the reading window\'s dark muted ink — the status bar and the build mark (2 findings; the same value is the `--muted` declaration above)',
    },
    {
      rule: 3,
      match: '#14372b',
      reason: 'guide.html, the dark title bar\'s ground, the green the window is titled with (1 finding)',
    },
    {
      rule: 3,
      match: '#171c1b',
      reason: 'guide.html, the reading window\'s dark search-field ground (1 finding; the same value is the `--field` declaration above)',
    },
    {
      rule: 3,
      match: '#141917',
      reason: 'guide.html, the dark reading pane\'s ground, darker than the kit\'s `--face-3` because a long text column is read on it (1 finding)',
    },
    // ---------------------------------------------------------------------------------------------------------
    // ltc.html · the action green (D-PALETTE-1)
    // ---------------------------------------------------------------------------------------------------------
    // The one control that writes the cue list is green on purpose, and the colour is the operator's way of finding
    // it (`desktop/ui/cue-list.js`, `installSaveStyles`: "Calm: a solid action green, so the one control that writes
    // is found without hunting and without shouting"). It is the instrument's own livery, not the furniture's, so
    // D-PALETTE-1 declares it rather than flattening it to the kit's neutral bevel. Every entry below is the same
    // recipe read in a different property, and each one states how many findings it matches.
    {
      rule: 1,
      match: 'rgb(63, 163, 99)',
      reason:
        'ltc.html, `button#save`: the action green is a four-edge pair of its own — #3fa363 top/left and #0c3d20 bottom/right in light, #47b16d/#0a2e18 in dark — not the kit\'s neutral step pair, so the suite reads it as mixed edges. It is light-before-dark in the right order, which is why this is a livery deviation and not a broken bevel (1 finding)',
    },
    {
      rule: 3,
      match: '#1c6f3c',
      reason:
        'ltc.html, `button#save`: the action green\'s ground, light #1c6f3c and dark #1f7a44 (the dark value appears in the same finding), from `cue-list.js` `installSaveStyles`. The ground is the button\'s own in both themes on purpose: it is the state of the write, not a surface (1 finding: the background)',
    },
    {
      rule: 3,
      match: '#3fa363',
      reason: 'ltc.html, `button#save`: the green pair\'s light step (light #3fa363, dark #47b16d, both in the same findings) on the top and left, the light-before-dark orientation the kit asks for (2 findings: the two edges)',
    },
    {
      rule: 3,
      match: '#4fbc74',
      reason: 'ltc.html, `button#save`: the inset specular highlight of the same green (light #4fbc74, dark #55c47c, both in the same finding) — the second step that makes the control look pressable (1 finding, reported together with the dark step as one shadow)',
    },
    {
      rule: 3,
      match: '#0c3d20',
      reason: 'ltc.html, `button#save`: the green pair\'s dark step (light #0c3d20, dark #0a2e18) on the bottom and right (2 findings: the two edges)',
    },
    {
      rule: 4,
      match: 'footer > button#save | its text rgb(255, 255, 255)',
      reason:
        'ltc.html, `button#save` (the only footer Save in the five windows): the label is #ffffff in both themes on purpose. The button\'s ground is its own green (#1c6f3c light, #1f7a44 dark) which does not follow the theme either, so a theme-following ink would put the dark theme\'s pale ink on a mid green; measured (WCAG relative luminance, this machine) #ffffff is 6.20:1 on the light ground and 5.35:1 on the dark one. Changing it is a change to the one control that writes the list, and it is declared here instead. **The match is scoped by path and property on purpose**: the bare phrase `its text rgb(255, 255, 255)` is also what a *frozen* element reports in any other window, and declaring that broadly would silence the very defect D-FIX-1 says must be fixed — measured: with the bare phrase, index.html\'s frozen `span.step-index` and `button#live-stream` were both reported as declared (1 finding)',
    },
    {
      rule: 4,
      match: 'live-stream',
      reason:
        'index.html, `button#live-stream` (the one control that starts the show): its label is #ffffff in both themes because its ground is its own green (#1e6b45) which is also the same in both themes; measured, white is 6.47:1 at rest and 5.08:1 on hover. The theme-following alternative was implemented and measured first (`var(--win-title-text)`, i.e. #70e7a9 in dark) and **rejected on that measurement**: 4.22:1 at rest and 3.31:1 on hover, a real loss on the main window for the sake of a number in this suite. The row is declared rather than fixed, and the value that would overturn this is a kit token whose dark value reads at least as well on this green (1 finding)',
    },
    // ---------------------------------------------------------------------------------------------------------
    // index.html · rules 2 and 4, and the one glyph rule 1 asks about
    // ---------------------------------------------------------------------------------------------------------
    {
      rule: 4,
      match: '#70e7a9',
      reason:
        'index.html keeps its own dark `--win-title-bg`, which is an ink here and not a surface: its only use is the About dialog product name (`index.html:9757`, `color: var(--win-title-bg, #000080)`), and the kit\'s `--win-title-text` dark value is the same #70e7a9, so the kit\'s title-bar background #153243 would put navy on the About name in dark. It is the same decision `desktop/ui/allow.mjs` already declares (DESIGN_DISAGREEMENTS_2026-10-08.md row 13, D1), carried to the conformance suite\'s own oracle (1 finding: the redefined token)',
    },
    {
      rule: 4,
      match: 'panic-stop',
      reason:
        'index.html, `button#top-panic-stop` and `button#panic-stop` (`class="danger"`, the emergency stops): the label is #ffffff in both themes because the ground is, too. `button.danger` paints the kit\'s own `--red` #b94444 in both themes — a refusal colour is a meaning and not a surface, so it does not follow the theme either — and white on it measures 5.29:1 (WCAG relative luminance, this machine). **Both theme-following alternatives measure worse on that fixed ground**: the kit\'s dark `--win-text` #e0e6ed gives 4.21:1 and its light `#000000` gives 3.97:1, so making the ink follow the theme would cost the one control an operator hits in an emergency. This is the same shape as the `button#live-stream` row above, and **the migration exposed it rather than caused it**: until `body.theme-dark button` stopped restating the ink, its `#edf4f0` (specificity 0,2,1) beat `button.danger`\'s white (0,1,1) in the dark theme, so the two themes differed by accident and the suite saw nothing frozen (2 findings, one per button)',
    },
    {
      rule: 1,
      match: 'library-search-icon',
      reason:
        'index.html, `span.library-search-icon`: a magnifier glyph drawn in CSS (a 7px circle plus a rotated stroke), not a control. The kit has square corners because its edges are for things the operator presses or reads; squaring a magnifier would cost the search field its only glyph, so it is declared rather than fixed (1 finding: the 50% corner)',
    },
    // ---------------------------------------------------------------------------------------------------------
    // index.html · rule 5 — the nine controls that are greyed at rest
    // ---------------------------------------------------------------------------------------------------------
    // Each of the three entries below is a *different* control with a different reachable state, which is why they are
    // three entries and not one. D-FIX-2: a disabled control is kept and declared only when it can do its job in some
    // reachable state; all nine can, and each reason names the handler and the state.
    {
      rule: 5,
      match: 'top-stop-stream',
      reason:
        'index.html, `button#top-stop-stream`: disabled at rest because nothing is streaming, and it says so ("Offline: not connected to the console"). It is the stop half of the transport: `applyStreamMode` (`index.html:16931`) enables it and relabels it "Disconnect"/"Cancel connection attempt" as soon as the mode is live, connecting or reconnecting, and its click handler is at `index.html:22301`. Reachable state: connect to the console. Kept, because removing it would leave the operator no way to stop a running stream (1 finding)',
    },
    {
      rule: 5,
      match: 'param-preset',
      reason:
        'index.html: seven `button.chip-button.param-preset` chips (Mute, Fader, Pan, Alt Source, Send, Gain, Name — `index.html:7780-7786`) are greyed exactly when the current destination does not have that parameter. `updatePresetSelection` (`index.html:14274`) computes `present = targetParametersForCategory(targetCategory.value).some(p => p.key === key)` and sets `button.disabled = !present`; the click handler is at `index.html:18495` and calls `selectTargetParameter`, logging `param_chip_unavailable` if the parameter is not there. Reachable state: choose a destination whose parameter list carries the chip. Greyed is the honest alternative to a chip that silently moved the write to another category (7 findings, one per chip)',
    },
    {
      rule: 5,
      match: 'add-fade-step',
      reason:
        'index.html, `button#add-fade-step`: disabled unless the chosen target parameter is a continuous float (or the category is `custom`), and it says so ("Fade needs a continuous float parameter: choose a level, a frequency, a time or a percentage"). `syncActionLimits` (`index.html:16801`) also disables it when the macro already holds the console\'s 32-step maximum; the click handler is at `index.html:18524`. Reachable state: choose a continuous parameter, or remove a step. Kept: a Fade on a write-only command is the write the backend refuses (1 finding)',
    },
    // ---------------------------------------------------------------------------------------------------------
    // rule 8 · the type scale (2026-10-08, and then D-TYPE-4 the same day) — two declarations, not six
    // ---------------------------------------------------------------------------------------------------------
    // §11 point 8 asks every text to be one of the kit's steps at the page's own `--meter-scale`, "and
    // `--meter-scale` is the only thing that moves them". The windows were migrated to the kit's names in this
    // session — `--font-base` where a window wrote 11px, `--font-lg` for its 12px headings, `--font-sm` for its 10px
    // lines, `--font-xs` for its 9px labels — and what was left was the one class migration cannot reach: an
    // **instrument readout larger than the interface scale**, whose five `clamp()`s cap at badge 10px, xs 16px, sm
    // 18px, base 13px and lg 14px, so **no setting of the knob produced a text larger than 18px**.
    //
    // **That residue is now named by the kit instead of declared here** (`DESIGN-SYSTEM-ROADMAP.md` §4l, D-TYPE-4).
    // Four instrument steps were added with the windows' own measured sizes as their floors — `--font-readout` 22px,
    // `--font-readout-lg` 26px, `--font-clock` 30px, `--font-clock-lg` 52px — and the windows use them: `ltc.html`'s
    // clock is `var(--font-clock)`, `index.html`'s two Timecode readouts are `var(--font-readout)` and
    // `var(--font-readout-lg)`, and `timecode.html`'s clock is `clamp(var(--font-clock), 7vw, var(--font-clock-lg))`.
    // Four of the six entries below are therefore **deleted**, and the two that remain are the two things a step
    // genuinely cannot name: the middle of a viewport-responsive clamp, and a document heading.
    {
      rule: 8,
      match: 'html > body > div#position',
      reason:
        'timecode.html, `div#position`: the master clock face, `clamp(var(--font-clock), 7vw, var(--font-clock-lg))`. **Both ends are the kit\'s own steps** — at the application\'s base (`--meter-scale` 1.25 since D-TYPE-5) `--font-clock` is 31.875px and `--font-clock-lg` 55.25px — and at the frames the window actually runs in the floor is what binds: at the 420 x 200 frame it opens in, and at its 260 x 140 minimum, `7vw` is below it, so the clock is `--font-clock` and lands on a step. What is declared is **the `7vw` term itself**, which binds at the suite\'s own rendering (756 x 469) where `7vw` is 52.92px — between the two steps and therefore not one of them. Both of rule 8\'s checks report it and both are declared here: check 1, because 52.92px is none of the nine steps at `--meter-scale` 1.25 (`… 27.625px, 31.875px, 55.25px`), and check 2, because the knob is forced to 1 and to 1.5 and this element goes from 52px to 52.92px while `--font-clock-lg` goes from 52px to 58.5px — the proportion a viewport-derived size cannot follow, since the scale is a function of `--meter-scale` alone and the kit\'s `clamp()` shape has no viewport term (`scripts/generate-design-tokens.mjs`). **A fixed step is not an option, and that is measured**: at the window\'s 260 x 140 minimum `--font-clock-lg` (52px at base 1, 55.25px at 1.25) overflows — `body` scrollWidth 372 on a 260px body at 52px, and `body { overflow: hidden }` clips the timecode. The rest of the window is migrated: `header` is `--font-lg`, the body text and the buttons `--font-base`, the counters, the countdown and the cue-panel lines `--font-sm`',
    },
    {
      rule: 8,
      match: 'div#guide-content > article#section-start-here > h2',
      reason:
        'guide.html, `.content h2` — the chapter title, **measured 17px**. A chapter title is document structure and not interface furniture, and D-TYPE-4 puts a document hierarchy **out of** an instrument scale on purpose. The kit\'s five interface steps are `clamp()`s that reach **at most 18px at any `--meter-scale`** while the nearest one below 17px is `--font-lg` = 11.5px — which is exactly the size this window gives its own `h3` after migration (`.content h3`), so "the step below" would collapse the chapter title into its own subsection heading and put the first line of a chapter at the same weight of hierarchy as a sub-head. The nearest step **above** 17px is now `--font-readout` = 22px, five pixels too far for a chapter title. Declared, not flattened. The path names the rendered chapter (`#section-start-here`) rather than the bare `h2`, because `h2` alone also matches headings in index.html; the CSS rule reaches every chapter title, and this run renders chapter 1. Reach: **2 rule-8 findings** on this one element. The rest of the window is migrated — prose, tables, the chapter list and the status bar to `--font-base`, the inline code and `<pre>` blocks and the sidebar note to `--font-sm`, the chapter word counts to `--font-sm`, `h3` to `--font-lg` — and the `button` rule gained a `font-size` it never had: `#btn-clear-search` was computing the browser\'s own `400 13.3333px`, the platform\'s type inside a kit window',
    },
  ],
};
