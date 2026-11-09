# The reference window - what it is, region by region, and what each one demonstrates

> **20 October 2026 — production adoption:** Start with `workstation/README.md`
> (relative to the kit root) and its working template/catalogue. The legacy
> three-sheet plan and simplified one-pair bevel described below are retained
> for existing consumers; they are not the target for new WING-equivalent GUIs.
> Production chrome and extracted surfaces take precedence. See the coverage
> inventory for settings, popups, secondary windows and runtime integration.


**This is the design P1 builds.** It is not a specimen and not a mockup: it is a **complete, working window**
that a consumer **forks and deletes from**, so that a new application starts from WING CONTROLLER instead of from a
blank page. The kit already ships **how it looks**; this ships **how it is ordered** and **how it is used**, which are
two thirds of the canon the owner named on 2026-10-08.

## The measured basis, so this is not invented

Measured in `desktop/ui/index.html` on 2026-10-08: the chain is `<main>` -> `<header class="master-header">` ->
`<div class="layout" id="main-layout">` -> `<div class="stack builder-column" id="builder-column">`, whose first child
is `<section class="panel library-panel" id="macro-library-panel">` holding `<div class="section-head"><h2>Saved
Macros</h2>`. There are **8 collapse buttons** and one card already folded (`panel card-draggable is-collapsed`), and
**the cards are draggable** - the operator decides their order. **Those facts are the canon of order**, and the
reference window must carry them, because a consumer cannot copy what it cannot see.

## The rule every region follows

Each region below carries, **in the window itself**: what it is, **which rule of `UI_SYSTEM.md` section 11 it
demonstrates**, **which state it is in**, and **what a consumer does with it** (keep, or delete). A region without those
four is decoration, and decoration is what makes an application stop looking like this one.

## The regions

**R1 - the master header.** The identity strip: product mark, the window's name, its tabs, and the trailing controls
(the theme switch, and **the reason for what is not offered - shown without a control that promises it**).

> **CORRECTED 2026-10-08, by measurement.** This region first asked for *"one control that is unavailable with its
reason"*. The conformance suite refused it, and the kit's own words are the argument: *"a control that cannot do its
job is absent, not greyed: a disabled button is a promise, and a tooltip that promises a future feature is a promise
with a date on it"*. **The window built to teach the canon was breaking a rule of the canon, on this plan's
instruction** - so the instruction is what changes, not the rule. R1 shows the reason (the band, in `--dim`) and
**no greyed control**: if a connection can be attempted, the control is there and works; if it cannot, the band says
why and there is nothing to press. Rejected alternative: declare the finding, as this application's own windows
declare theirs - rejected here because those declarations are for controls the operator needs in a live show, and
this window is the teaching artefact: **a canon that excuses itself in its own example teaches the excuse.** *Demonstrates*: section 11's "both themes are looked at and nothing freezes to one". *State*: the theme switch is
live in this window - it is the one place the canon shows its own light and dark face side by side. *Consumer*: keep the
structure, replace the mark and the tabs.

**R2 - the two-column layout.** `layout` with a **stacked column** on the left (the things the operator sets) and a
**readouts column** on the right (the things the operator reads), separated by the kit's own divider. *Demonstrates*:
the ordering convention - **settings left, readings right** - which is not written anywhere today and is the single
biggest reason a new window looks "unbalanced". *State*: it holds at its minimum width without horizontal overflow.
*Consumer*: keep, and let the column widths come from the kit's token rather than a local number.

**R3 - a stack of three cards, and none of them folds.** Three `.c-card` in the left column, all three **open on
arrival**, each with its `c-card-head` and one action. *Demonstrates*: the work area's half of the kit's fold rule -
`layout.css:46-47` gives the fold to the operator column and not to the cards the operator is working in - and rule 2 - any figure inside a
card is mono and sits in a well. *State*: three open.

> **CORRECTED 2026-10-08, by a stranger's measurement - and fixed the same day.** This region folded the **third card
> of the left column**, and the kit's own plan says otherwise: `layout.css:46-49` gives the folding cards to the **operator
> column** (*the work area's cards never fold; the operator column's do*), and `layout.html` agrees with `layout.css`. The
> window therefore contradicts the sheet it teaches, and a stranger who followed the sheet put its own fold on the right -
> the opposite of the reference it was told to fork. **`layout.css` is the authority, so this window is the defect.** The
> fix is to move the fold to a card in the operator column (or to drop the fold from this window and leave it to R6's
> operator card), and it is recorded here rather than quietly re-cut because the contradiction is the useful part: it was
> found by someone who had no reason to prefer either file.
>
> **FIXED 2026-10-08.** The fold is off this stack and lives on **R4**, the readouts card in the operator column, with
> the kit's `.card-summary` chip that stays visible while the body goes — which is where `layout.css:46-49` and §5 put
> it, and where the real window's foldable cards are (`desktop/ui/index.html:8148`, `#meters-collapsed-summary`). The
> paragraph above is kept, not deleted: it records who found the contradiction, why, and that the reference window
> itself was the side that was wrong.

> **CORRECTED 2026-10-08 by a stranger's measurement.** This line claimed that *the fold state survives a reload, a
> consumer copies the mechanism and not the storage key*. **There is no mechanism to copy**: the folded card
> carries the class and nothing else - no control, no `aria-expanded`, no handler - so a consumer who comes
> looking for the mechanism finds only its result. The window shows **the folded state** (now on R4); **an operable
> fold is not in it yet**, and that is a gap in this window rather than a thing this page can promise.
>
> **FIXED 2026-10-08.** The fold is operable now, here and in `design/layout.html`, written the same way in both so a
> consumer copies one thing: a `<button>` in the folded card's head, drawn by the kit's own `button` rules, carrying
> `aria-expanded` (`false` folded, `true` open) and a short label that names what it does ("Unfold" / "Fold"). The
> handler toggles the card's `is-collapsed` class and the attribute together, in the shape of the theme switch's
> `apply()`; **the hiding stays the kit's** (`.c-card.is-collapsed > :not(.c-card-head)`, `layout.css` §5) with
> `.card-summary` as the folded face, so no rule of the kit is restated. Enter and Space already fire a `<button>`, so
> no key handler was added and nothing is prevented. The storage key this paragraph's first line promised is still
> **not** copied: the fold is state, not a preference, and it is not written to `localStorage`. Both pages were
> re-judged after the change (`node design/conformance/run.mjs`, private ports): `CONFORMANCE OK · 0 failures` on each.
*Consumer*: keep two, delete the rest - **deleting a card is the intended way to use this window.**

**R4 - the readouts card, and it is where the dense type lives and where the fold lives.** A card in the right column
carrying: a labelled reading in a well, a value with its unit, and a smaller secondary reading. It arrives **open**
(`layout.css` §5: the fold is the `.c-card.is-collapsed` class, which the toggle keeps off on arrival, and the
`.card-summary` chip inside the head is what the operator reads instead of the body once it is pressed), because the
operator column is the column the kit folds — the correction recorded under R3 moved the fold here — and **a card
folded on arrival is unverified, not conformant** (the measurement is the correction below). *Demonstrates*: section
11's rule 2 in full, and rule 8 - every size is one of the kit's steps, and `--meter-scale` is the only thing that moves
them. *State*: open, normal, and **unavailable** (a reading that has no source says so with the reason rule 5 requires,
rather than showing `--`); the folded state is one press away on the head's own button, so it stays demonstrable.
*Operable since 2026-10-08*: the head carries the fold's own button - `aria-expanded` plus a label that names what it
does - and it is the same mechanism, written the same way, as `design/layout.html`'s. *Consumer*: keep the shape,
replace the readings.

> **CORRECTED 2026-10-08, by measurement - a card folded on arrival is unverified, not conformant.** This entry said the
> card *arrives folded*. `design/conformance/collect.mjs` skips every element with no box, and a folded body has none, so
> the suite judged **none** of the readings this window exists to teach: measured on this page with the card folded, the
> run printed `RULE 2 · PASS · checked numbers 0`, and the adopter that forked this kit measured
> `RULE 6 · NOT CHECKED · no element declares data-state` on its own page, where the three states sat inside the folded
> card, and `checked numbers 4` · `checked states 3` there once it was open. Measured on this page with the card open:
> `RULE 2 · PASS · checked numbers 2` and `RULE 6 · PASS · checked states 3` — this card carries two values rather than
> the adopter's four, and rule 6 read 3 before this change as well, because R6's three states are their own card in the
> same column and were never folded (the missing line the adopter saw is a property of its page, not of this one). So
> the window must not start in the state that hides what it teaches: the `is-collapsed` class is off the card,
> and the fold is one press away on `#fold-toggle`, which still folds and unfolds it with `aria-expanded` following -
> **the fold remains demonstrable without being the arrival state.** Rejected alternative: keep the card folded and
> declare rules 2 and 6 instead - rejected because this window is the teaching artefact, and a canon that excuses itself
> in its own example teaches the excuse (the argument R1 already records). What would overturn this: a collector that
> judges a box-less element, which would let a folded card's readings be verified and would put the fold back on
> arrival.

**R5 - the reorderable card.** One card carries the drag affordance the real window has. *Demonstrates*: the canon's
**order is the operator's** - a card list is not a fixed table. *State*: a grip that is visible in both themes and
reachable by keyboard. *Consumer*: keep if the window has a list the operator orders; delete it otherwise - and **say
which**, in the window's own comments, so the next reader knows it was a decision.

**R6 - the three states, shown once each.** One control that is available, one that is pressing/latched, and one that is
unavailable **with its visible reason**. *Demonstrates*: section 11's rule 5 and rule 6 together - the states are the
product, not a coat of paint. *State*: all three at once, so a reader can see them without pressing anything.
*Consumer*: keep all three; they are the fastest way to see whether a new window has understood the canon.

## The acceptance, and it is the definition of done for P1

1. It renders in **both themes**, and the judge's findings on it are **zero or declared with a reason and a reach**.
2. **Every region carries its four annotations** (what it is, the rule, the state, what to do with it), and a reader can
   answer *"what does a new window do first?"* from the window itself.
3. **A stranger builds a new window from it, on a copy outside this tree, without inventing a layout** - and that build
   is the proof, not this sentence. If the builder has to invent a column, a gap or an order, this plan failed and the
   window must say what it was missing.
4. It links `tokens.css`, then `components.css`, then `layout.css`, in that order, and **does not retype what it can
   link** - the same rule the component sheet already carries.

## The honest limits, written in the window itself

- **It is a window, not the application.** With no console and no live session its readings are static and plausible,
  never fabricated traffic. It says so, the way the screenshot record says it.
- **It cannot carry everything the real windows do** - a full macro editor, a meter bank selector, an OSC browser. It
  carries **the composition those live in**, which is the part nobody could copy until now.
- **And it is not a judge of resemblance.** Nothing here measures whether a fork *looks like* WING CONTROLLER; that
  question is answered by a person looking at the fork beside this window, which is what `scripts/compare-design-likeness.mjs`
  exists to make a one-glance question instead of an afternoon.
