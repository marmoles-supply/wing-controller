# `design/conformance/` — the acceptance points of `UI_SYSTEM.md` §11, §10's load order and plan, and the page's own width, as a suite that can fail

`design/UI_SYSTEM.md` §11 is eight checkboxes in a document. This directory turns them into something that can stop a
commit. **Those eight are the operator's points and they stay eight**; the suite's rule list is a different, longer
list, because eight of its rules judge the operator's points, two are the technical contracts of §10 — the load order of
the kit's sheets, and not re-declaring the plan the kit already gives you — and one (rule 11) is neither section's: it
is the suite's own measure of a page that is wider than the window it is rendered in. The lists do not move
together, and the table below names every rule the suite runs. It is the answer to the owner's question — *"I want all
my apps to have the same style and UI … how could I
coordinate all the agents so the visual results come out identical?"* — because coordination does not live in prose:
it lives in an artefact that goes red.

The suite imports **the app's rendered page**, in both themes, and judges it on computed styles and geometry. It never
greps the source for a string. `DESIGN-SYSTEM-ROADMAP.md` §6 is why: the foreign consumer that motivated this work
shipped seven broken acceptance points while its own 474 tests were green, and every one of its traps was a check
looking at the wrong artefact.

```
node design/conformance/run.mjs --app <path-or-url> [--theme light|dark|both] [--allow <file>] [--port 9223]
                                [--record [<run.json>]] [--require-all-rules]
```

Exit codes: **0** the suite ran and nothing failed · **1** at least one failure · **2** the command line is wrong ·
**3** nothing was measured (no browser, the page would not load, the kit copy could not be read). 0 and 3 are kept
apart on purpose: this project has already paid for a "skipped" that the gate booked as green.

---

## What each rule checks, and on which artefact

| Rule | The rule | What the suite actually measures |
|---|---|---|
| 1 | Raised is light-before-dark, sunken is the reverse, nothing is both | Every element whose four drawn edges are a two-tone `solid` pair: the **computed** colour of each of the four edges, classified against the kit's two steps (`--line-light`/`--win-btn-highlight` and `--line-dark`/`--win-btn-dark-shadow`) **as the element itself resolves them**. Custom properties inherit, so a page that paints both themes at once (the kit's own specimen does, by design) has one pair per column, and each element is judged against its own. A pair that is not one of the two orientations fails. Also: any element with a non-zero computed `border-radius` (the kit has square corners), and any raised element that also draws an `inset` shadow — one element, two shapes |
| 2 | Numbers are set in `--mono` and sit in a well | Every rendered element whose **own text nodes** are a bare value (a number with an optional unit, a timecode, a version, an address — interactive controls are excluded, and a `chip`/`badge` count is allowed by §8). Its **computed** `font-family` must carry the kit's `--mono` family, and its nearest surface must be sunken: the reversed edge pair, or the instrument ground (`--crt`), or a field's `--field` background, each read where that element lives. A raised surface ends the search |
| 3 | Colour is meaning, and the palette is the kit's | Every **computed** colour a rendered element actually paints — its text, its background, its four drawn edges, its outline, colours inside a gradient or a shadow, an SVG fill or stroke — against the union of the kit's colour tokens in both themes. A colour the kit does not name is a failure unless the app declared it. Translucent colours are skipped (see "cannot check honestly") |
| 4 | Both themes were looked at, and nothing froze | Four checks on **computed values**: (a) every `var(--x)` the app's stylesheets and inline styles ask for resolves on the rendered page in both themes — a missing token falls back to the property's initial value silently, which is how a foreign consumer lost 33 of them; (b) every token the kit's dark block re-declares actually changes on the page; (c) no computed kit token disagrees with the value the kit copy beside the suite declares; (d) no element paints, in both themes, the light value of a token the dark theme changes (the §3 alias trap), judged per property role so a legitimately black window frame is not reported as frozen black text — and the two renderings are paired by each element's **full structural key** (every ancestor's tag plus `nth-of-type`, with no cap), not by the five-level display path, so two columns of identical markup cannot be collapsed onto one key |
| 5 | A control works or says why not | Every rendered control carrying `disabled` or `aria-disabled="true"` **at rest** fails, and the words it carries (title/aria-label/text) are quoted so the operator sees the promise that is being made. Every refusal surface (`role="alert"` or `data-refusal`) must carry words, and not only a bare "Error"/"Failed"/"Refused" |
| 6 | Anything a machine decided has three states | Every element carrying `data-state` must use one of `yes`, `no`, `unknown`, and its feature must declare the three it can take with `data-state-set="yes no unknown"`. Two states fail. Where two states are on the page, their non-colour rendering signature (text, aria-label, title, role, child tags and geometry, weight, italics, decoration) must differ — colour alone is a failure |
| 7 | The window's own words come from §8 | **Reported, never passed.** The suite inventories the page's class names and control labels and prints §8's words beside them, and says out loud that it did not judge meaning. See below |
| 8 | Every text size is one of the kit's steps (the five **interface** steps and the four **instrument** steps), and `--meter-scale` is the only thing that moves them | **Two checks, and both are needed.** (a) Every rendered element whose **own text nodes** are visible has a **computed** `font-size` that is one of the kit's steps — computed from the kit's own `clamp()`s in `design/tokens.css` at the `--meter-scale` **that element resolves**, never from the page's `--font-*` values (a page that reassigned the kit's names would otherwise be judged against its own ramp). A size that is none of them is `invented-size`. (b) The suite renders the page twice more with the knob **forced** to 1 and to 1.5 and pairs the two readings by each element's full structural key: at 1 the size must be one of the kit's **minima**, and at 1.5 it must be the **same step's** value there, in the kit's own proportion — `step-not-minimum` or `step-not-proportional`. This is the check a single-size photograph cannot make, and it is the one that catches a ramp wearing the kit's names |
| 9 | The kit's sheets are linked in one order: the values, then the components, then the plan | Every stylesheet `<link>` the page carries that resolves to a kit sheet, **in the order it appears** — `tokens.css`, then `components.css`, then `layout.css`. A kit sheet linked above one it should follow draws over it, and nothing on screen says which won. A page that links none of them is not judged by this rule |
| 10 | The plan is the kit's, not retyped here: the stack gap and the builder column | Every rendered element wearing a plan class (`.stack`, `.builder-column`) must resolve the kit's own value — `.stack`'s `gap` is `8px`, `.builder-column`'s `min-width` is `0px`. Another value is a second answer to a question `layout.css` has already answered. **The grid tracks are deliberately not compared, and it is not a gap to be "fixed" back**: measured, `getComputedStyle().gridTemplateColumns` is the *used* track list (`740px` on the correct `design/layout.html`), never the declared `minmax()` text, so a string comparison there would match no page at all — the reason `rules.mjs` keeps `gap` and `min-width`, which do compute |
| 11 | The page is no wider than the window the suite renders it in, so nothing scrolls sideways | The page's own **`scrollWidth`** against **`window.innerWidth`**, recorded for the document and for `<body>` because a page can scroll on either, and judged on the widest of them. This is the one measurement none of the other rules takes: they all read a computed style, a rect or a colour, and a page can be 187px too wide with every one of those correct — measured when this rule landed (2026-10-08), `desktop/ui/index.html` was `documentElement.scrollWidth` 943 against `innerWidth` 756, and it and `ltc.html` were both fixed the same day (`a3bf2768`, `2f6376f1`), so rule 11 now reads `excess 0` on both. The finding names the element that is widest past the edge (the row or block that could be made to fit), says how far the page is past the viewport, and names the furthest right element. **It answers one width, deliberately**: the suite declares its own viewport — 756 × 469, `VIEWPORT` in `collect.mjs`, forced on the tab with `Emulation.setDeviceMetricsOverride` before a page is loaded — so the page is never laid out in whatever window the browser on the debug port happened to have, and a page too wide only in a band of widths the suite never visits (the 28px at 1181 and 9px at 1200 that motivated the rule) is not in its reach — see "cannot check honestly" |

**Rules 1–8 are `UI_SYSTEM.md` §11's operator points; rules 9 and 10 are §10's technical contracts** — the load order of
the kit's sheets, and not re-declaring the plan the kit gives you. **Rule 11 belongs to neither section**: it is the
suite's own instrument for a rendered page wider than the window it is rendered in, which no computed style records and
no section of the kit names. §11 still has eight points; the suite's list is longer, and the two lists do not move
together.

A **PASS** line also reports what was looked at (`checked edges 9 · raised 7 · sunken 2`), so a rule that silently
matched nothing is visible as a zero rather than as a green line.

When a rule fails, the message names the element (with its path), the measured value and the rule, in the operator's
words, and says what to do:

```
FAILURES (1)
  FAIL · rule 3 · unknown-colour
      element:  div#swatch   (html > body > div#swatch)
      measured: its background is rgb(255, 0, 255) (#ff00ff)
      the kit:  every colour on screen is one the kit knows; a colour is chosen for what it says, and only the kit says what it means
      fix:      use a kit token, or declare this deviation with its reason in the app allowance file
```

---

## What the app has to provide

The suite needs a rendered page, and a small contract with it. None of it is JavaScript and none of it is a build step
— the fixtures beside this file are plain HTML.

1. **The kit, linked.** `<link rel="stylesheet" href="design/tokens.css">` before the app's own stylesheet. The suite
   reads `tokens.css` and `VERSION` from the copy beside it (`design/conformance/` → `design/`).
2. **The two themes, the kit's way.** Light is `:root`; dark is the class `theme-dark` on `<body>`. The suite renders
   the page twice, setting `wing_theme` in `localStorage` and toggling that class, which is the mechanism
   `UI_SYSTEM.md` §3 and §10 already require. The suite enforces both states; it does not guess at another mechanism.
3. **A machine decision** carries `data-state="yes|no|unknown"`, and the feature around it carries
   `data-state-set="yes no unknown"`. Without that mark the suite cannot see a machine decision, and it says so as
   `NOT CHECKED` rather than passing.
4. **A refusal** is rendered by an element with `role="alert"` or `data-refusal`, and carries the machine's reason.
5. **Text sizes come from the kit's scale.** Every text is set with one of the kit's steps — the interface steps
   `--font-badge`, `--font-xs`, `--font-sm`, `--font-base`, `--font-lg`, or the instrument steps `--font-readout`,
   `--font-readout-lg`, `--font-clock`, `--font-clock-lg` — and the whole scale follows the single knob `--meter-scale`
   — the suite forces that knob to 1 and to 1.5 and requires the page's texts to follow it in the kit's own proportion.
   A size the kit does not have is a declared deviation, never a pixel written into the page.
6. Nothing else. The furniture words (`panel`, `card`, `well`, `field`, `chip`, `band`, `rail`) are §8's; the suite
   uses `well`/`field`/`chip`/`badge` only as carve-outs (a count on a chip, a field's background).

---

## How another project consumes it — the decision

**D-CONF-1 — inside this repository, a relative path; in another project, a plain copy of `design/`, with the
version declared.**

- Inside this repository an app is checked with `node design/conformance/run.mjs --app <path>`, reading the one copy
  of the kit here.
- In another project, **copy the whole `design/` directory** into that project's tree — which the app has to do
  anyway, because it links `tokens.css` from it — and run
  `node design/conformance/run.mjs --app <its index.html>` from the project root. The suite is self-contained:
  nothing under `design/conformance/` imports anything outside `design/`, so the copy works with no install and no
  build step.
- **Drift is caught by declaration, not by magic.** The app states the version it took in
  `design/conformance/allow.mjs` (`kitVersion`), and the suite compares it with the `VERSION` file of the copy
  beside it. A copy whose files come from two versions, or a declaration left behind by a half-done re-copy, fails
  the preflight.

**Consequences.** The app owns its copy and can be checked offline, on a machine with nothing installed but Node and
a browser. The declaration is a *fact about the copy*, and the suite refuses to be silent when the two disagree.

**What it does not do.** It cannot tell that the kit has moved on upstream: two apps can each declare `1.4.0` and each
be internally consistent while one of them is a year behind. That is the drift dashboard's job
(`DESIGN-SYSTEM-ROADMAP.md` ITEM 5), which reads this same `kitVersion` declaration.

**Rejected — a published tarball.** There is no package registry in this project (no publishable package, no scope),
and a private dependency is a real cost for a plain-HTML consumer with no build step; `UI_SYSTEM.md` §1 is explicit
that this kit is not a thing to `npm install`.

**Rejected — a symlink into this repository.** It is fragile across checkouts: an absolute link breaks when the tree
moves and a relative one breaks when the two repositories are not siblings. Worse, it is invisible once it is not a
link any more — a copy looks exactly the same to the next reader, and the drift would be discovered by an operator
rather than by a test.

**What would overturn this decision.** A real registry this project can publish to, or a build step becoming
universal among the consuming apps — either would make a pinned dependency cheaper than a copy.

---

## Declared deviations

An app that must differ says so, once, with a reason. The suite accepts **only** what is declared, reports it as
declared, and names a declaration that matched nothing (so declarations do not rot).

```js
// design/conformance/allow.mjs, in the app's copy
export default {
  kitVersion: '1.4.2',                          // the version of the copy beside you — read design/VERSION
  deviations: [
    {
      rule: 3,                                    // optional: the §11 point, 1–8
      match: '#ff00ff',                           // any text the suite reported — a value, a hex, an element
      reason: 'the panic flash is magenta on purpose: it must be visible in both themes',
    },
  ],
};
```

`match` is compared, ignoring case and whitespace, against the element, its path, the measured value and every
spelling of a measured colour (`#ff00ff` and `rgb(255, 0, 255)` both match).

The same file is the app's **identity to the drift dashboard** (`report.mjs`, below). Two more keys are read from it,
and both are declarations rather than configuration:

| Key | What it declares |
|---|---|
| `app` | the operator-readable name the dashboard prints for this row |
| `allowApp` | the window this declaration is about, relative to `allow.mjs` (a file, or a directory holding `index.html`) |

Without `allowApp` the app is still a row — labelled by its directory — but the dashboard says out loud that the
window is not declared, because a fleet that cannot tell which window a declaration belongs to is a fleet whose rows
cannot be trusted.

**Kit 1.4.2 ships a runnable `conformance/allow.mjs` of its own, and that is D11 (2026-10-08).** Until 1.4.2 the
artefact shipped `adopt/allow.mjs.example` and **not** the file `conformance/run.mjs` reads by default, so a
consumer's first documented command exited **3** with *"the app allowance file does not exist"* and measured nothing
(measured in a fresh unpack of the 1.4.1 tarball, `/tmp`). The shipped declaration is the kit's own: it names the
kit's reference window — the only page the tarball owns — carries `kitVersion` from the `VERSION` beside it, and
declares `deviations: []`. That is honest rather than a bypass, and it is measured: the reference window reports
`CONFORMANCE OK · 0 failures` against exactly that minimal declaration. **Replace `allowApp` with your own window and
add your deviations**; the example above keeps its role as the thing you copy when you declare them, because it
explains every field. The default is composed at pack time from `VERSION`
(`scripts/lib/kit-package.mjs`) and is deliberately **not** a copy of the 41 KB declaration this repository uses for
its own five windows: shipping that would put this repository's findings in a sibling's report under a name that is
not theirs, which is why the file list excluded it before 1.4.2.

---

## The drift dashboard — `report.mjs`

`run.mjs` judges **one** app against the copy of the kit beside it. It cannot answer the owner's question, because
that question is about the fleet:

```
node design/conformance/report.mjs [--root <dir>] [--kit <dir>] [--json [file]]
                                   [--fail-on-behind] [--fail-on-missing-declaration] [--quiet]
```

```
WING CONTROLLER · design-system drift
  fleet root:   /Users/…/wing-controller
  kit:          1.4.2  (/Users/…/design/VERSION)
  newest seen:  1.4.2 — the newest of the kit and every app's declaration
  apps found:   4 declaration(s), 1 behind

  app           kit version  how far behind                   deviations declared  last conformance run
  ------------  -----------  -------------------------------  -------------------  --------------------
  sample-app-a  1.0.0        up to date                       none                 never
  sample-app-b  1.0.0        up to date                       1                    never
  sample-app-c  0.9.0        a major release behind (0 -> 1)  2                    never
  sample-app-d  1.0.0        up to date                       none                 never
```

**Nothing is configured.** The report finds an app by the only thing an app has to write — its
`design/conformance/allow.mjs`, the same file `run.mjs` reads — and a page that links the kit and declares nothing is
a row that *says* it declared nothing. It reads the declared files and nothing else: no registry, no network, no list
of apps written into the report.

| Column | Where it comes from |
|---|---|
| **app** | `app` in the allowance, or the allowance's own directory |
| **kit version** | `kitVersion` — the truth about the copy the app took, checked against the copy beside it by `run.mjs` |
| **how far behind** | the app's `kitVersion` against the newest version any declared file names, the kit's `VERSION` included |
| **deviations declared** | the count, and the report lists each one with its `match`, its `rule` and its **reason** |
| **last conformance run** | `run.json` beside the allowance, written by `run.mjs --record [<file>]`: the time, and the exit code |

**How far behind is a reading, not an oracle, and it says so.** It compares declarations with each other — useful,
because a fleet in which one app is at `0.9.0` and the rest are at `1.0.0` says which one to fix without anybody
opening a repository. It cannot see that *every* declaration is old; that is the kit's own history, and the report's
`NOTES` prints exactly that limit rather than implying coverage. The level it names is the **first segment that
differs** (`0.9.0` against `1.0.0` is a major release — 0 vs 1 — even though those two numbers are one release apart
in the release notes), because a precise-looking number over an imprecise comparison is a lie this project has
already paid for.

**What it refuses to be quiet about.** An allowance with no `kitVersion`, one whose `allowApp` names a window that is
not there, and a deviation with no `reason` are all printed under `PROBLEMS`; an app that has never recorded a run
says `never`, which is not a pass; and a deviation that matched nothing on the last recorded run is what
`run.mjs`'s own `NOTES` already name. A dashboard that rounds all of that to "fine" is the failure this item exists
to prevent.

**Exit codes.** `0` the report was produced · `1` the caller asked to be failed and it found what it asked about
(`--fail-on-behind`, `--fail-on-missing-declaration`) · `2` the report could not run. Note that **finding drift is
not a failure by itself**: `report.mjs` is a reading, and the acceptance test reads a fleet with an app behind and
expects exit `0` — the flag is what turns a reading into a gate.

**The last line of every report is the number**, which is the whole point of ITEM 5:

```
DRIFT · 4 app(s) · 1 behind · newest declared 1.0.0
```

**What it does not do.** It does not compare the fleet against the kit's git history, so a fleet that is uniformly
stale reads as up to date; it does not read an app's windows to count deviations itself (that is `run.mjs`'s job,
against the copy beside it); and it does not touch the network.

---

## What the suite cannot check honestly, and says so

Writing a check that passes for the wrong reason is worse than the defect it hunts, so these are reported instead of
being guessed at.

- **Rule 7 — the vocabulary of §8 is not executable.** §8 is about what a word *means*: an element named `strip` and
  one named `band` can be the very same thing on screen, and no computed style tells the suite which word the
  operator was taught. The suite prints the page's own class names and control labels next to §8's list and reports
  the rule as `NOT CHECKED`. `--require-all-rules` turns that into a failure for a caller that wants a run where every
  rule was judged; the default keeps it visible without pretending.
- **Rule 8 without its second rendering is `NOT RUN`, not judged.** The rule *is* its two checks: one size on screen
  cannot see a ramp wearing the kit's names, and the proportion between two settings of the knob can. A snapshot taken
  without the second rendering — a caller that built its own observation, or a run whose browser died between the
  renderings — therefore reports `NOT RUN` and never a pass, and `--require-all-rules` turns that into a failure. The
  suite renders the page twice more for this reason alone, and it says which theme those readings were taken in.
- **Rule 8 and a text that is not in the light DOM.** The rule reads elements, so text drawn into a `<canvas>`, a
  shadow root or a pseudo-element's `content` is not measured — the same blind spot rule 4's reference inventory
  already names.
- **Rule 8 and a nested knob.** The second check forces `--meter-scale` on `<html>` and `<body>`, which outranks the
  kit's own `:root` declaration. A page that raises the knob on a **deeper container** keeps it there; those texts are
  still judged by the first check, against the scale they declare, and the report prints a `note` saying how many were
  not moved rather than passing over them in silence.
- **Rule 8's steps are the kit's, not yours.** A page that genuinely needs a size the kit does not have declares
  it, with its reason, through the same allowance mechanism every other deviation uses. One entry whose `match` names
  the element covers **every** rule-8 finding for it: a size that is none of the steps costs **two**
  (`invented-size` at the page's own scale, then `step-not-minimum` at the forced one — the proportion is not reported
  once the minimum has already failed for that element), and a size that is one of the steps but written as a literal
  costs **one** (`step-not-proportional`). Measured on the fixtures: `bad-invented-size.html` and
  `bad-renamed-ramp.html` two each, `bad-fixed-scale.html` one.
- **Rule 8 and a size that is a function of the viewport.** The scale is a function of `--meter-scale` alone: the
  generator's `clamp()` shape has no viewport term. A page that sizes a text with `clamp(…, <n>vw, …)` therefore has a
  size the scale cannot name between its bounds, and the clock window is the measured case — at both of its own sizes
  (420 × 200 and its 260 × 140 minimum) `timecode.html`'s clock lands on a kit step, and the `7vw` between them does
  not. That element is declared, and its reason says so.
- **The meanings of §5 (rule 3).** The suite can prove that every colour is one the kit knows, or that the app
  declared it; it cannot prove that `--green` was used for *confirmed* and not for "probably fine". That is a reading
  matter, and the README says so rather than implying the suite judges it.
- **Rule 5's "names its cause".** The suite proves a refusal carries words and is not a bare state word; whether those
  words identify the cause is a reading matter.
- **Rule 6's "unknown is reachable".** The suite checks the declared vocabulary (`data-state-set`) and the
  non-colour difference between the states that are on the page. Whether the app can actually *reach* `unknown` is
  not visible in one rendering.
- **Box-shadow bevels.** §4 defines the bevel as a border pair, and that is what rule 1 judges. A raised shape faked
  entirely with `box-shadow` is not classified (the `inset` case is caught only on an element that already has a
  raised border pair).
- **Translucent colours.** Rule 3 skips any colour with alpha below 1: a shadow drawn in `rgba(0,0,0,.4)` is depth,
  not a palette meaning, and reporting it would make the rule fail for the wrong reason.
- **A theme-dependent class name.** Finding paths leave out `theme-dark`, the kit's own switch, so one defect in two
  themes is one finding. Another class that appears only in one theme would split a finding in two.
- **Stylesheets and DOM the suite cannot reach.** The reference inventory (rule 4a) is built from `<style>` blocks,
  inline `style` attributes and the stylesheets the page links; an `@import`ed sheet is not read for `var()`
  references (its *effect* is still measured everywhere else), and a `<style>` inside a shadow root is not seen at
  all, because elements inside a shadow root are not in the page's light DOM — so they are not checked either.
- **Rule 11 measures one width, on purpose.** The suite chooses one viewport and only one: **756 × 469, declared as
  `VIEWPORT` in `collect.mjs` and forced on the tab with `Emulation.setDeviceMetricsOverride` before a page is loaded**,
  so no page is ever laid out in whatever window the browser that answered the debug port happened to have. The number
  is not a free choice: it is the width every count and every allowance in this tree was measured at, which is why
  declaring it moved no number, and it is below the kit's `@media (max-width: 1180px)` band, so `layout.css` lays the
  plan out collapsed. One rendering means rule 11 answers "does this page fit at the width the suite declares" and
  nothing more: a page too wide only in a narrow band of widths the suite never visits is invisible to it,
  and that band is the measured reason the rule exists: `desktop/ui/index.html` overflows by 28px at 1181 and 9px at
  1200, because its `div.master-stats` and `#open-help-btn` need 1209px while its header's reset starts at 1180
  (`design/CANON_PLAN.md`, "The judge's viewport, measured on a frozen snapshot", point 5 — the band spans 1181-1208px,
  and the agent that closed it reported it overflowing at every width in that band and at none of 122 widths sampled
  from 1170 to 1230), while at 756 the same page overflows by 187px for an unrelated reason — so one rendering cannot
  separate the band from that overflow. Catching a 29px-wide band needs a **sweep of several widths**: one rendering per
  width, each paying the settle wait the suite already pays per rendering, so the cost is renderings × widths, and a
  second width is a change to how the suite renders *every* page. The single width is the decision, not an oversight,
  and a green rule-11 line must not be read as "this page fits at every width".
- **Rule 11 and dead CSS.** Like every rule in this suite it measures the rendered page, so a declaration that never
  wins is not on screen. Measured the same day: the fix for the band above dropped two `display: grid` halves of a media
  query the base rule overrode, and the rendered page did not change by a pixel — the suite never sees dead code.
- **Rule 2 excludes interactive controls.** A number on a `<button>` is a label, not a readout, and the kit's rule is
  about what the instrument reports.

---

## The proof that the suite can fail

```
node design/conformance/self-test.mjs
```

It runs the suite against `fixtures/good.html` — a small page that conforms — and against one fixture per defect:
a literal colour, a `--mono` number outside a well (both named by the roadmap), mixed edges, a rounded corner, one
element carrying both shapes, a token that does not exist, a palette frozen to the light values, a frozen element in
one of two columns whose identical markup gives both the same five-level path (the pairing must use the full
structural key), a redefined kit
token, a greyed control, a refusal with no words, a refusal that names nothing, a two-state machine decision,
states told apart by colour alone, and three for the type scale. It fails itself if a fixture that **must** go red
goes green, and it proves the two
mechanisms around the rules: a declared deviation is reported as declared, and a copy of the kit whose declared
version does not match the files beside it is caught.

The three type fixtures each prove a different half of rule 8, and the first is the measured blind spot the rule
exists for (`DESIGN-SYSTEM-ROADMAP.md` §4j):

| Fixture | What it does | What catches it |
|---|---|---|
| `bad-renamed-ramp.html` | reassigns the kit's own names to a ramp of the page's own — `--font-sm: var(--t-sm)`, the consumer's exact move — so every text changes size while the palette, the bevels and the wells stay the kit's | `invented-size` (the first check) and `step-not-minimum` (the second). **This page ran `CONFORMANCE OK · 0 failures` against rules 1–7 before rule 8 existed**, which is the proof the blind spot was real |
| `bad-invented-size.html` | sets one text at 20px, a size the kit never had | `invented-size` |
| `bad-fixed-scale.html` | sets a text at 9.5px — **one of the kit's interface steps at `--meter-scale` 1**, so the first check passes — written as a literal, so raising the knob moves nothing | `step-not-proportional`: the second check alone, and the reason the suite renders the page twice. A single-size photograph sees nothing wrong with this page |

There is a **second conforming page**, `fixtures/two-theme-columns.html`, and it is a page that paints both themes at
once. It exists because this is the one shape that is *not* caught by a bad fixture: a rule that resolved the kit's
two steps once for the whole page failed that page's dark column while its bevels were correct (measured on the kit's
own specimen: 154 rule-1 findings for one mis-resolution). A fixture that must go **green** is the only thing that
catches a rule which has become too strict, and `bad-mixed-edges.html` is still what proves the rule can fail.

The gate runs it through `scripts/test-design-conformance-browser.mjs`, and the rule logic is pinned without a browser
by `scripts/test-design-conformance.mjs` (so it is covered by `verify-all.sh --quick`, which touches no Chrome). That
second file builds its own observations and never takes rule 8's second rendering, so what it pins for rule 8 is the
`NOT RUN` it must report without one — the rule's logic itself is pinned by the rendered proof above, which is the
only place the two readings exist.

The dashboard's own acceptance test is `scripts/test-design-drift-report.mjs`, and it is the roadmap's test verbatim:
it *builds* a fleet of three sample apps at `1.0.0`, `1.0.0` and `0.9.0` — each with nothing but its own
`allow.mjs` and a window — and asserts that the report names the one that is behind and lists the deviations of
each. Because the samples are made in a temporary directory at run time, there is no list of apps anywhere for the
report to read: the declarations are the only input, which is what "nothing to configure" has to mean. It also pins
the version arithmetic, the two `--fail-on-*` exit codes, and the refusal to stay quiet about a missing `kitVersion`,
a window that is not there and a deviation with no reason. It touches no browser, so `--quick` runs it.

---

## Running it, and the port

Needs Node 22 or newer (the suite uses the built-in WebSocket: there is no dependency to install) and Chrome or
Chromium. `--port` (or `$WING_CHROME_PORT`) chooses the debug port; the default is the repository's 9223, where the
suite **reuses** a browser that is already answering and starts its own only when the port is silent, killing only
that one.

**Reusing a browser is harmless to the rules, and that is a property of the suite rather than a hope.** Every tab is
forced into the declared `VIEWPORT` (756 × 469) before a page is loaded, so the window the browser was started with
cannot reach a measurement. Measured 2026-10-08: with a foreign Chrome started at `--window-size=1280,900` answering
the port, the suite used to lay the known-bad `bad-overflow.html` fixture out in the foreign 1280px window and report
`MISSED … the suite exited 0 on a known-bad fixture`; with the override in place, the same foreign browser produces the
same rule 11 failure as a quiet port. The report prints both the browser it used (`reused` or `started by the suite`)
and the `viewport` it judged, so a reader can see which browser measured the run.

**Do not run it while `scripts/verify-all.sh` is running.** The gate owns 9223 and SIGKILLs whatever holds it, so two
processes on that port manufacture failures for both — the rule in `AGENTS.md` that already cost another agent a
false diagnosis. For a hand run beside a gate, use `--port 9333` and a browser of your own.

## Measuring one window reports the other windows' declarations as "matched nothing" - and that is expected

Observed on 2026-10-08 while measuring `index.html` alone (1,069 findings): the run printed four
`a declared deviation matched nothing` lines, all of them about **`ltc.html`'s** `button#save`. The allowance is
**shared across the application's windows**, so a run of one window cannot match the entries that belong to another - they
are not wrong, they are simply not present in this run. A run that measures all the windows matches all of them.

Recorded because it reads like a defect and is not one, and because the same mechanism has a real counterpart that **is**
worth watching: an entry that matches nothing when **every** window is measured is a declaration whose finding has gone
away, and that one means what it says.
