# The Canon Plan - WING CONTROLLER is the reference, and the kit must carry it whole

## Why, in the owner's words and in measurements

The owner, 2026-10-08: *"me refiero a wing-controller. esa es la del diseno bueno que tienen que seguir todas las
otras. son el canon de diseno de ui, facilidad de uso, orden, logica."*

**The canon is three things, and the kit carried one and a half of them:**

| | what it is | where it lives | travels to the other apps? |
|---|---|---|---|
| **How it looks** | values, pieces, the plan | the kit: `tokens.css`, `components.css`, and `layout.css` | yes, and the plan was still landing |
| **How it is ordered** | what comes first, what is grouped, what collapses, how height is shared | **only inside this application's windows** | **no - there is nothing to copy** |
| **How it is used** | the eight operator rules, the three states, a control works or is absent, a refusal names its cause, the vocabulary | `design/UI_SYSTEM.md` section 11 - **a document** | written, **not applicable** |

**Measured on the consumer that reported it** (`openwing/control-app`): it links `tokens.css` and `components.css` **in
the right order**, has **no `:root` of its own fighting the kit**, and writes **2 control rules in 93 lines** - so the
values and the pieces arrive. And it writes **its own plan**: 5 `display: grid`, 2 `grid-template`, 6 `gap`, decided by
hand. Its own words: *"lo estoy adivinando, y adivinando sale la UI que el propietario llama descompensada."*

**And nothing anywhere measures resemblance.** The suite measures rules; the screenshot lock measures change. **The
owner is the only instrument in the loop, and he has been asked every time.**

## The principle

**Stop shipping ingredients. Ship the application.** A design like this one is not reproduced from a palette and a
plan; it is reproduced by **starting from the whole thing and removing what is not needed.** The consumer said it
without knowing it was the answer: *"primero copie su hoja para desbloquearme"* - what unblocked it was copying the
whole thing, not the layer.

## The five pieces, in order, each with its acceptance test

**P1 - the reference window, and it is the lever.** `design/reference-window/` - a complete, working, copy-and-gut
window: the master header, the two-column layout, the stacks of cards, a collapsible card, the states, the theme
switch, and **every region annotated with the rule it demonstrates**. Not a mockup: something an agent forks and
deletes from.
*Acceptance*: it renders in both themes; the suite's findings on it are zero or declared with reasons; its regions are
documented one by one; and **an agent builds a new window from it on a copy outside the tree without inventing a
layout** - the proof is that build, not this sentence.

**P2 - the adoption path forks instead of assembling.** `adopt/` step 1 stops being "take the artefact" and becomes
**"copy the reference window and delete what you do not need"**. And: **a window that invents its own plan declares
it**, with its reason and its measured reach, like every other deviation.
*Acceptance*: a fresh copy of `adopt/` and the artefact contain the fork instruction; the declaration route for a plan
is written; and the six steps are re-read against the new first step so no step contradicts it.

**P3 - the likeness loop gets an instrument that is not the owner.** `scripts/compare-design-likeness.mjs` (in flight)
renders a page beside ours, both themes, **one sheet**; and the adoption contract says a consumer commits its
screenshots **and puts the pair in front of a person**.
*Acceptance*: the tool produces deterministic sheets; and the rule appears in `adopt/` and in `design/screens/README.md`
with the honest sentence that **it measures nothing about resemblance**.

**P4 - the "how it is used" half becomes applicable.** Section 11's rules, the three states, the refusal vocabulary
and the **ordering conventions** - attached to **the reference window's regions**, not left in a document.
*Acceptance*: every region of P1 names the rule it demonstrates and the state it is in; and a reader can answer "what
does a new window do first?" from the window itself.

**P5 - what can be enforced, is.** A window that claims the canon must link `tokens.css`, then `components.css`, then
`layout.css`, **in that order**, and must not re-declare the plan it can link.
*Acceptance*: a suite check that **can fail**, with a fixture that links them out of order and one that retypes the
plan, each proving red before being trusted.

**And P5 applies to THIS application first.** Its five windows claim the canon - they are the canon - and today they
carry the plan inline, in their own sheets, exactly as they carried the controls inline until `components.css` landed
this afternoon. A rule that only binds the consumers would be the same defect this kit keeps finding: a rule the house
does not obey. So P5 has a second half, in the shape that worked for the component layer: **`index.html` first, then one
window per commit**, each deleting the plan it can now link, each with its screenshots refreshed in the same commit
because the lock will see the shift, and each with whatever genuinely remains **declared with its reason and its reach**.
`design/reference-window/` is the model the windows are moved towards, which is why P1 comes before this half.

## A rule the adoption path is missing, found while waiting (2026-10-08, measured)

The consumer links the kit with **absolute paths** - `href="/design/tokens.css?v=1791470061"`, served from its server's
root - while **this application's windows link a copy that travels inside their own folder**
(`href="design-tokens.css"`, mirrored by the token and component chains). The consequence is measurable and it bit the
likeness instrument before it rendered a single pair: **a page that links `/design/...` cannot be opened, judged or
photographed outside its own server**, so its judge needs the server up too, and the one-glance comparison the owner
asked for needs somebody to start `server.py` first.

**The rule is not "relative rather than absolute" - it is that the kit's files travel INTO the application and are
linked from there.** That is what the mirror chains exist for, and it is the difference between a window the kit's own
tools can pick up and one that only exists behind a process. It belongs in the adoption steps the moment `adopt/` is
free, in the same words the copy chain already uses.

## Order and the rules that govern this work

- **P1 waits for `layout.css` and `layout.html`** (in flight when this was written) because the reference window is
  built on the plan, and building it twice wastes the first one.
- Every piece carries **an acceptance test in the tree, proven by breaking it**, a green gate, and **one commit per
  piece** - the standard this kit was built to.
- **The record tells the truth**: if a measurement contradicts this plan, the plan changes in the same work, and the
  contradiction is written down rather than deleted.

## What is left, and exactly what to type (2026-10-08, written by a session that ran out of context)

**Read this before writing a fifth brief.** Four small, artefact-first briefs were given to subagents for the two
items below and produced **nothing** (the two fixtures they were asked for first *did* land, and are named here). The
work is small and fully measured; what failed is the hand-over, not the task. **Give it to a session with context, or
type it directly.**

### P5's check - one rule, and both fixtures are already committed
`design/conformance/fixtures/bad-link-order.html` (`55827d74`) and `bad-retyped-plan.html` (`8986f741`) are both in the
tree, both wrong on purpose. **What is missing is the check that catches them**, in `design/conformance/rules.mjs`,
written in the shape of that file's shortest existing rule:
1. **The link order**: a page claiming the canon links `tokens.css`, then `components.css`, then `layout.css`. The model
   that must pass is `design/layout.html` (its three links are at lines 10-12). If it cannot be read honestly from the
   rendered page, **mark it NOT CHECKED in the rule's own text** - this suite already carries one such rule and says so.
2. **The retyped plan**: a page that links `layout.css` **and then re-declares** `.layout`'s tracks, `.stack`'s gap or
   `.builder-column`'s `min-width` is answering a question twice. The fixture pins the exact numbers it retypes.
- **Proof required**: run `node design/conformance/run.mjs --app <fixture> --port 93xx` (**private port, never 9223**)
  and paste the literal sentence each fixture prints; then confirm `design/layout.html` passes. **Add both to
  `design/conformance/self-test.mjs`** so the count of checks that prove the suite can fail **goes up**.

### The window furniture - one CSS file, and the hole is named
An agent building `design/reference-window/index.html` reported that **seven class names it used exist in no file of
`design/`** (verified by grep): `.product-mark`, `.window-name`, `.tab-row`, `.tab`, `.header-actions`, `.panel`,
`.section-head`. Add them to **`design/components.css`**, every value a **token reference**, plus:
- **`.tab.is-active`** - the selected tab sinks (bevel inverted, ink `--accent`); `UI_SYSTEM.md` §4 says depth is the state;
- **the reason pattern** - how an unavailable control states why. The reference window composed one already (`.c-band`
  with `--dim`, linked by `aria-describedby`); name it or better it, and say which;
- **`.master-header`'s face** - `layout.css` gives it a row and padding but no surface, and the window borrowed
  `.c-panel-head`; name the borrowing as deliberate or give the header its own.
Then: the `desktop/ui/components.css` mirror, the regenerated artefact, and **the kit's version moves** with every
carrier found by `grep`.

### And the two things that follow those
- **`design/reference-window/` is not in `PACKAGE_FILES`** (`scripts/lib/kit-package.mjs`) - and `adopt/`'s step 1 now
  tells a consumer to copy it. **A consumer who takes the package cannot do step one.** Add it, regenerate, and decide
  whether the window's `PLAN.md` travels with it.
- **P1's remaining regions R3-R6** (the three cards, the readouts card, the reorderable card, the three states), each
  carrying its four annotations, in `design/reference-window/index.html` - R1 and R2 are in (`17a1f06a`).

### The reference window's first measurement (2026-10-08, by the session that ran out of context)

**Nobody had rendered `design/reference-window/index.html`.** The agent that built R1 and R2 said so honestly - it was
forbidden to run the judge - so the first run was made here, on a private port with 9223 verified free:

```
CONFORMANCE FAILED · 7 failure(s) · 6 of 8 rules checked
  FAIL · rule 5  · disabled-control      (1 finding)
  FAIL · rule 8  · invented-size         (3 findings)
  FAIL · rule 8  · step-not-minimum      (3 findings)
```

**The one is the state the plan asks for.** R1 shows a control that is unavailable *with its visible reason*, which is
§11.5, and rule 5 fails any `disabled` element by design - so it is **declared with its reason and its reach**, exactly
as P5's own window declares the same shape in `meters`/`index`/`timecode`.

**The six are the defect the reference window exists to make impossible.** Six text sizes in it are not one of the
kit's steps - three invented outright and three that do not move with `--meter-scale`. Its own builder reported "no
font-size literal was written", so the likely cause is the six short rules it wrote for R1's classes leaving an element
on the user agent's default, which is the same defect this morning's guide had when its `button` rule carried no
`font-size` and computed the platform's own 13.3333px. **Find them, put them on kit steps, and the window passes
criterion 1.** (`node design/conformance/run.mjs --app design/reference-window/index.html --port 941x` names each
element; the run above printed the failure list above its declared-deviation notes.)

### The six findings are one cause, and the furniture work fixes it (2026-10-08, measured)

Named, element by element:
```
FAIL · rule 8 · invented-size     h2  (… section.panel > header.section-head > h2)   "Card one/two/three" at 16.5px
FAIL · rule 8 · step-not-minimum  h2  (the same three elements)                      15.75px at --meter-scale 1
```
**One cause**: `.section-head` never declares a `font-size`, so its `h2` inherits the user agent's `1.5em` and multiplies
whatever step it sits in. The arithmetic is exact - **10.5px x 1.5 = 15.75px** at scale 1 and **11px x 1.5 = 16.5px** at
1.25 - so both checks fire on the same three elements, which is why six findings come from three cards.

**And `.section-head` is one of the seven class names the kit does not define.** The furniture work and these six findings
are the same task: give `.section-head` a heading size from the kit's steps and all six close. It is the same defect this
morning's guide had when a `button` rule carried no `font-size` and computed the platform's own 13.3333px - the third
time today that an element with no size written lands on something that is not the kit's.

### The count that is now stale, and the one that is not (2026-10-08, by grep before editing)

Rule 9 `load-order` landed (`017527cd`), so **the suite has nine rules** - and two places still say eight:
- `design/conformance/README.md:1`, *"the eight acceptance points, as a suite that can fail"* → the suite's count is nine;
- `design/UI_SYSTEM.md:269`, a quoted run, `6 of 8 rules checked` → it prints `6 of 9` today.

**And two places say eight and are RIGHT**: `design/UI_SYSTEM.md:254` (*"These eight are no longer only checkboxes"*) and
`CANON_PLAN.md`'s own table both count **§11's operator points**, and §11 still has eight - the eighth being the type
scale. **A sweep of "eight" to "nine" would break them.**

**The distinction to carry forward: §11's points are what the operator must do; the suite's rules are what the machine can
check. They are not the same list and they do not move together.** Rule 9 is a technical contract about load order and is
deliberately *not* a ninth operator point.

**When fixing the two stale ones**: `design/conformance/README.md` travels in the artefact, so the kit's content changes
and **`design/VERSION` moves to 1.4.1** with every carrier found by `grep` (`design/VERSION`, `tokens.json`'s `version`,
the generated `tokens.css` and `WingTheme.swift`, `desktop/ui/design-tokens.css`, `CONSUMING.md`,
`conformance/README.md`, `conformance/allow.mjs`, `desktop/ui/allow.mjs`, `adopt/allow.mjs.example`, then the artefact).
Do it as one change; a version that moves without its generated forms is the defect this kit exists to prevent.

### What R3-R6 actually are today, and the furniture list corrected (2026-10-08, measured)

`design/reference-window/index.html` is 182 lines. R1 and R2 are built and the window passes its judge
(`CONFORMANCE OK · 0 failures`, 7 of 9 rules checked). **R3 to R6 are shells**: three identical
`<section class="panel"><header class="c-card-head"><h2>Card N</h2></header><div class="panel-body"></div></section>`,
**all three bodies empty, none folded**. So the remaining work is not decoration - it is the half of the window that
carries R3's folded card, R4's readouts, R5's reorderable card and R6's three states, each with its four annotations.

**And the shell corrects the furniture list.** The earlier measurement named seven undefined classes
(`.product-mark`, `.window-name`, `.tab-row`, `.tab`, `.header-actions`, `.panel`, `.section-head`). Two facts have moved
since:
- **`.section-head` is gone** - the three card heads now use the kit's own `.c-card-head`, which closed the six rule-8
  findings;
- **`.panel-body` is a new one**, used by all three cards and defined nowhere.

So the current list is **`.product-mark`, `.window-name`, `.tab-row`, `.tab`, `.header-actions`, `.panel`,
`.panel-body`** - seven again, one swapped. **`.panel`/`.panel-body` are the kit's `.c-panel`/`.c-panel-body` under another
name**, which is the same finding as `--surface` being `--face-2` in the consumer's tree: **a window that links the sheet
should use its names, not invent synonyms.** The fix is therefore not seven new definitions in `components.css` - it is
one of two things for each name, decided by measurement: **use the kit's class where it exists, and define it in the kit
only where it genuinely does not.**

### R5 is written and uncommitted (2026-10-08, measured by the session that could not commit it)

**`design/reference-window/index.html` is 344 lines and modified in the working tree, and the region R5 it carries is
built**: 32 occurrences of the grip/reorder vocabulary, up from 245 lines when R4 was committed, and 258 a round later
before it jumped to 344. The agent holding that file was asked for its state and did not answer.

**Why the parent did not commit it.** The file carries R1 to R5 together, and the agent that wrote R5 may still be
mid-edit, so a commit taken by the parent would carry work whose message could not describe it - the exact defect the
commit-by-path rule exists to prevent, and one this session already repaired once. **344 lines do not evaporate; a commit
that is not yours does.**

**What the next session does**: ask the holder once more (a message to an inactive agent starts a new turn), and if there
is no answer, **commit the file and say in the message that it carries R1-R4 with R5**, because leaving built work
uncommitted is worse than a message that lists what it carries:

    node design/conformance/run.mjs --app design/reference-window/index.html --port 93xx   # must still say 0 failures
    git commit -m "design(reference-window): R5, the reorderable card (carries R1-R4 of the file as well)" -- design/reference-window/index.html
    git show --stat

### Rule 10 runs and cannot fail: reverted, with the measurement (2026-10-08)

The wiring was written and proved wrong immediately, which is what the proof was for. Wired, the suite reports
**`8 of 10 rules checked`** - so `rule10RetypedPlan` **executes** - and then reports **`CONFORMANCE OK · 0 failures`**
**on `design/conformance/fixtures/bad-retyped-plan.html`**, the page built to be wrong, as well as on `design/layout.html`.

**A check that cannot fail for the reason it exists is not a check**, so the wiring was reverted and the suite is back to
nine rules. **The cause is a premise, not an implementation**: `getComputedStyle().gridTemplateColumns` returns the
**used** track list (`1074px 6px 420px`), never the declared `minmax(480px, 1fr) 6px minmax(260px, 420px)` - so the
function's string comparison against the kit's declaration cannot match on any page, correct or wrong, and the rule is
silent by construction. `gap` and `minWidth` do compute to lengths (`8px`, `0px`) and would have worked; the tracks would
not.

**What the next attempt needs, decided before typing**: either compare the **resolved** track list (parse the used value
into tracks and compare each against the kit's evaluated `minmax()` bounds), or read the **declaration** from the sheet
rather than the computed style, or **drop the tracks and check `gap` and `min-width` only** - and say in the rule's own
text which of the three it is, because that choice is the rule's honesty. `collect.mjs` already records the three
properties; the fixture already differs in all three places, including the 8px seam against the kit's 6px.

### The type scale was migrated and the spacing scale was not - measured (2026-10-08)

Both pages render with every text size on the kit's nine steps - rule 8 reports `invented 0` for
`desktop/ui/index.html` (254 texts) and for the reference window (34 texts) - and the contact sheet built by
`scripts/compare-design-likeness.mjs` still shows two pages that do not read as one family. **The measurement that
explains why**:

| file | spacing declarations | using `var(--space-*)` | with a literal `px` |
|---|---|---|---|
| `desktop/ui/index.html` | 800 | **0** | **737** |
| `design/components.css` | 32 | 30 | 0 |
| `design/layout.css` | 10 | 6 | 1 |

**The kit has a spacing scale and the application does not use it at all.** That is the same defect the type scale had
before rule 8 landed - a window re-deciding, by hand, what the kit already decides - and it is why two pages whose
typography is identical still look like different families. **Rule 8 migrated 488 findings of type in `index.html`; nothing
ever counted the spacing, because no rule reads it.**

**The decision, and it follows the type scale's precedent exactly**: the spacing scale gets a rule, and the windows are
migrated to it one window per commit, **not declared**. `--space-1` to `--space-6` are the steps; a rule would ask that
every `gap`, `padding` and `margin` be one of them, and that `--meter-scale` be the only thing that moves them if the type
moves.

**What the rule's first job is, and it is not "demand zero"**: **measure and classify**. Of the 737 literals, some are
structural rather than rhythmic - the 6px seam of the plan, a 1px border offset, a fixed instrument width - and a rule that
cannot tell the two apart would either silence the real defect or fail every page for the wrong reason, which is the
mistake rule 10 has just demonstrated twice in one afternoon. **So: count first, print the histogram by value, and let the
numbers say which are the rhythm and which are structure** - then write the rule against the rhythm, with the structural
values named in it.

**This is written here rather than fixed here because it is the next piece of work, not a defect in what is built**: the
five pieces of this objective are as they were, and this is the finding that says what the *next* one is.

### The spacing histogram: the same rhythm, written in numerals (2026-10-08)

The kit's steps are `--space-1` to `--space-6` = **2, 4, 6, 8, 12, 16px**. Counting every `padding`, `gap` and `margin`
declaration in `desktop/ui/index.html` by the value it carries:

| value | count | the kit's step |
|---|---|---|
| 6px | 237 | `--space-3` |
| 4px | 164 | `--space-2` |
| 8px | 129 | `--space-4` |
| 2px | 117 | `--space-1` |
| 10px | 71 | **none** |
| 3px | 71 | **none** |
| 5px | 46 | **none** |
| 1px | 35 | **none** (structural: borders and offsets) |
| 7px | 17 | **none** |
| 12px | 7 | `--space-5` |
| 16px | 4 | `--space-6` |
| 9, 11, 14, 18, 20, 22, 24px | 2-6 each | **none** |

**647 of them are already the kit's steps**, written as numerals instead of as the token: 81% of the window's rhythm is the
kit's rhythm. So this is not a window with a different spacing language - **it is a window with the kit's language written
by hand**, which is the cheapest possible version of this defect and the reason the rule can be modest.

**What that means for the rule and the migration, decided here:**
1. **Rename first, classify second.** Swapping the 647 literals for their tokens is mechanical and changes no pixel - it is
   the migration's bulk and its safest part, and it is checkable by the screens lock (the ten images must not move).
2. **Then the ~90 odd values, in two named groups.** **Structural** ones are 1px (35), which draw borders and offsets and
   are not rhythm; **off-scale** ones are 10px (71), 3px (71), 5px (46), 7px (17) and the long tail - and each of those is a
   decision: move it to the nearest step, or name it in the rule's own list as structural if it is (a 3px inset shadow
   offset is not a gap). **10px is the largest single off-scale value and sits exactly between `--space-4` and
   `--space-5`**, so it is the first one to look at and the one most likely to be a real rhythm error.
3. **The rule comes last, against the classified rhythm**, with the structural values named inside it - never a demand for
   zero, which would fail every correct page the way rule 10 did twice in one afternoon.

### The main window's 491 findings, grouped, and the work order (2026-10-08, measured)

`node design/conformance/run.mjs --app desktop/ui/index.html` → `CONFORMANCE FAILED · 491 failure(s) · 8 of 10 rules
checked`. By rule and code:

| count | finding | what it is |
|---|---|---|
| **418** | `rule 3 · unknown-colour` | the window paints colours the kit does not know. A long tail, each used a few times: `#8da099` 32, `#0b0e0d` 32, `#4b5a55` 20, `#3b5949` 16, `#273830` 16, ... |
| **64** | `rule 1 · mixed-edges` | the window's own edges against the kit's one-pair bevel |
| **7** | `rule 1 · two-shapes` | an element drawn as two shapes at once |
| **2** | `rule 10 · retyped-plan` | **the window re-declares the plan it can now link** - `.stack`'s gap and `.builder-column`'s `min-width` |

**The two rule-10 findings are the objective's own P5 arriving in the application**: "whoever claims the canon links
tokens → components → layout in that order and **does not re-declare the plan it can link**". The page now links
`layout.css` (`a369517d`), so the kit supplies `gap: var(--space-4)` and `min-width: 0`, and the window's own copies of
those two numbers are a second answer to a question that has one. **That is a two-line deletion, and the suite names both
elements.**

**The 418 colours are the real pass, and they are decidable one by one** - the kit's own rule decides them: a colour that
is a kit token under another name is **renamed**, and a colour that is genuinely the application's own is **added to
`design/tokens.json` and regenerated**, never hard-coded back (§6 of *The Design Kit Is The Only Source Of Design*). What
is forbidden is the shortcut the record already names: **a `match` broad enough to cover the tail would be the mute button
this design exists to prevent**, which is why these 491 have been counted and left visible rather than silenced.

**And the sequence is forced by the numbers**: the two-line plan deletion first (it is a defect, not a style), then the 71
edge findings, then the 418 colours in descending order of use - **each of them with its own decision written beside it**,
exactly as `meters.html` and `guide.html` did theirs.

### The canon has 47 colours and the window that generated it has 423 (2026-10-08, measured)

```
distinct hex values in design/tokens.css (the kit)      47
distinct hex values in desktop/ui/index.html            423
  ... already a kit value, so a pure rename              34
  ... not in the kit at all                             389   (92%)
```

**This is the measured answer to "the applications do not look alike": the flagship window does not use its own kit's
palette.** It carries 389 colours the kit has never heard of - `#0000c8`, `#005a9e`, `#00bcd4`, three greens one step
apart (`#004000`, `#006000`, `#008000`), the `#006868` a previous agent identified as a dead declaration, and a family of
near-black surfaces distinguished by one or two units (`#020505`, `#020606`, `#020705`, `#030705`). **Most of the 389 are
not a designer's palette; they are the same intent retuned by hand, twenty times.**

**The direction is decided, and it is not a coin toss**: the owner's instruction is that this kit is *"la fuente de verdad
única en que se pueda basar el diseño unificado de todas las apps, marca de la casa"*, so **the window converges on the
kit, not the kit on the window.** A kit that grew to 390 colours by absorbing one window would be a description of that
window, not a standard for the others - and it would lose the one property the canon exists to have.

**So the pass is a mapping, and the measurement says its shape**: the 389 are mostly **clusters of near-identical values**,
not 389 decisions. The work is to cluster them **by function** - the surfaces, the inks, the accents, the status colours -
and map each cluster onto the kit's existing steps, adding a token to `design/tokens.json` only where a cluster has no
step of its own. **`#006868` is the first case to decide**: the kit's own record already asks whether `--desk-2` is a
second desk step or a dead declaration, and a window that paints it is evidence for one of the two answers.

### The window's real palette: fourteen roles, eight of them already the kit's (2026-10-08)

Of the 423 colours in `desktop/ui/index.html`, **267 are used exactly once**, 116 two or three times, 26 four to nine
times, and **14 are used ten times or more**. Those fourteen are the window's actual palette, and the measurement against
the kit splits them cleanly:

| the role | uses | in the kit? |
|---|---|---|
| `#ffffff` | 74 (border 27, color 25) | **yes** |
| `#000000` | 55 (border 26, color 7) | **yes** |
| `#70e7a9` | 38 (color 31) | **yes** - the kit's dark title ink |
| `#000080` | 30 (background 14, color 6) | **yes** |
| `#808080` | 27 | **yes** |
| `#800000` | 14 | **yes** |
| `#c0c0c0` | 12 | **yes** |
| `#404040` | 11 | **yes** |
| `#4b6355`, `#2b3b33` | 12 each (borders) | no |
| `#f0d17a` (a yellow), `#e74c3c` (a red) | 11 each | no |
| `#f19a96`, `#0d1110` | 10 each | no |

**Eight of the fourteen are already values the kit carries**, and together they are **261 of the window's ~880 colour
declarations**. The single largest piece of waste is concrete and mechanical: **the window writes `#ffffff` 74 times and
`#000000` 55 times as `border` and `color`** while the kit already has both - **129 declarations that become two tokens and
change no pixel.**

**The six that are not the kit's are the interesting half, and they look like the classic "same meaning, another value"**:
`#f0d17a` is a yellow and `#e74c3c` is a red, and the kit already names `--amber` and `--red`; `#4b6355`, `#2b3b33`,
`#f19a96` and `#0d1110` sit on borders and surfaces. **Each of those six is one decision** - map it onto the kit's role of
the same meaning, or add a token if the meaning is genuinely new - **and the kit's own rule decides it (§6): a value that
is missing is added to `design/tokens.json` and regenerated, never hard-coded back into the window.**

**So the palette pass has three parts, in this order, and now with sizes**: the eight kit-valued roles by rename (261
declarations, no pixel changes, proved by the screens lock); the six unknowns by one decision each; and then the **409
one-off and low-count values**, which are neither a palette nor decisions but the same roles retuned by hand - clustered
against the twenty roles above rather than treated as 409 cases.

### The spacing pass: step one is done in one window, and the guard it needs (2026-10-08)

`desktop/ui/meters.html` (`d1c5957b`): **78 declarations, 94 literals renamed** to `var(--space-1..6)`, committed alone,
**proved pixel-identical** - the screens lock reports the same ten images and the same 1,092,300 bytes, and `meters`'s two
images are the same bytes as the baseline taken before the edit; the conformance line is unchanged. Three structural checks
went beyond the lock: zero eligible-but-unrenamed declarations remain, both histograms (non-step spacing, and px literals
outside spacing) are byte-identical to before, and **every one of the 77 changed lines carries a spacing property**.

**What is left in that file, with its exact histogram** (the input for step two): `3px` 27, `10px` 12, `1px` 9, `14px` 8,
`5px` 8, `-2px` 3, `7px` 3, `18px` 2, `9px` 1, `22px` 1, `-9px` 1 - and **421 px literals in non-spacing properties**
(box-shadow 140, border 47, width 41, height 24, ...), which are a different task again.

**The guard, and it is a real one**: the rename is only a rename *while the kit's steps are 2, 4, 6, 8, 12 and 16px*. The
in-flight kit regeneration (the reference window joining the artefact and `design/VERSION` moving to 1.4.1) edits
`tokens.json` and regenerates `tokens.css`, `desktop/ui/design-tokens.css` and `WingTheme.swift` - **so if any `--space-*`
value changes there, every window that now names the tokens moves, `meters` included.** **`node
scripts/test-design-screens.mjs` is the thing that will catch it, and it must be run after that programme lands, before
believing any of this.**

### P1's third criterion, answered by a stranger: the value layer copies, the component layer does not (2026-10-08)

An agent that had never read this plan, this file or the git history was given the kit and `adopt/README.md` and told to
build a window of its own in `/tmp`, outside the tree. Its page, `bank.html`, came out at:

```
CONFORMANCE OK · 0 failures · 9 of 10 rules checked · 1 not judged (rule 7)
rule 8: invented 0 · moved 51 · notMoved 0     (zero literal colours, zero literal font sizes)
```

**So the criterion is answered, and the answer is not a pass.** The instruction was *"a stranger builds a new window from it
WITHOUT INVENTING THE LAYOUT"*. It invented, and here is what:

1. **The whole meter drawing** - `.meter-track`, `.meter-lit`, `.meter-unlit`, its height, its flex. `--meter-ramp` is a
   value; **no bar, track or meter class exists in any sheet**. And it had to **retype `.c-well`'s sunken edge pair**, which
   is precisely what `adopt/` step 6 forbids: **the kit supplies no bar, so the kit forces the retyping**.
2. **The three states' non-colour differences** - the confirmed band edge, the dashed unknown edge, the weight, the italic,
   the hollow dot. All of them live **only in the reference window**; `components.css` names `.dot.is-*` and
   `.c-band.is-refusal/.is-unknown` but **no `.c-band.is-confirmed`** and **none of the non-colour differences §11.6
   requires**. R6 built them by hand in the window and the kit never took them.
3. **A card head that carries an action** - it copied `.card-head-row` **out of `layout.html`'s page-local `<style>`**,
   because the kit draws `.c-card-head` as a block and `.section-head` is a raised plate, not a row.
4. **`body { background: var(--desk); font-size: var(--font-base); line-height: 1.35 }`** - the kit has no body rule, and
   **`1.35` is a literal in no token**, repeated in two kit files.
5. `style="width: 74%"` as the level's markup contract: no convention exists for a reading that is a bar.

**Two holes in the oracle itself, measured by the same agent:**
- **The judge never renders the two-column plan.** Its viewport is `756x469` - **below the kit's own 1180px band, where
  `layout.css` is already one column** - and `collect.mjs` contains no `Emulation.setDeviceMetricsOverride` call. **Every
  page is judged with the plan collapsed**, so rule 10 cannot separate a composed plan from a one-column page.
- **No rule reads where a gradient sits.** The stranger's first meter put `var(--meter-ramp)` on the lit bar, which
  compresses green to red **inside it** - a quiet channel showing red at its end. **The judge passed it; only the screenshot
  caught it.** That is the instrument's honest boundary, and it is why P3's pair in front of a person is not decoration.

**And a version-honesty window, which is the worst of the findings**: the artefact was regenerated **three times inside
three minutes under one version number**, and against the copy the contract told the consumer to take, `bank.html` **failed**
rule 10 - as did the kit's own `layout.html` and reference window - because rule 10 was, at that moment, comparing the used
track list to the declared text. **`run.mjs`'s preflight said `ok the app declares kit 1.4.0, the same as the copy beside
it` for all three packages.** A consumer in that window declared the right version and was judged by a suite that reds every
correct page, while the dashboard said it was up to date. **Five minutes later `design/VERSION` read 1.4.1 while
`design/package/VERSION` and `KIT_VERSION` still read 1.4.0.**

**The rule this earns, and it belongs beside "a kit whose content changes must move its version"**: **a regenerated
artefact and its version move in the same change or neither moves** - and **a suite that can red every correct page is worse
than no suite, because it teaches the consumer to ignore it.**

### Two corrections to the palette plan, measured in timecode.html (2026-10-08, commit a53c86c4)

**1. Where a window copies a kit token under the kit's own name, the fix is DELETION, not `var()`.** The 27 literals in
`desktop/ui/timecode.html` did not sit in arbitrary declarations: every one of them was a declaration like
`--face-2: #d4d0c8` - **the kit's token, copied under the kit's own name**. Substituting the token there would write
`--face-2: var(--face-2)`, **a custom-property cycle that blanks all fourteen names**. Measured token by token against the
linked `desktop/ui/design-tokens.css`: **14 of 14 light declarations equal the kit's light value and 13 of 13 dark ones the
kit's dark value, 0 mismatches** - pure duplication. So the change is the duplicate declaration going and the linked kit
supplying the name, and the dark block was deleted entire (the kit's own `body.theme-dark` **is** that palette, and it is the
same class the window's script toggles).

**The recipe for the other four windows, which this measures**: read the window's `:root` and its dark block, compare **each
declaration** against the kit's value for the same name in the file the window links, and then either **delete the block**
when every declaration matches, or **leave the ones that differ** with a reason - because a declaration that does not match
the kit is not duplication, it is an override, and an override is a decision.

**2. Rule 3 judges RENDERED colour, so a hand-written kit value was never a finding - and the pass's proof is the screens
lock, not a falling rule-3 count.** `timecode.html`'s rule 3 line was `PASS checked elements 14 · colours 44` with
`unknown-colour` 0 **before and after**: a window that paints a kit value by hand paints the right colour, and the suite
cannot see where it came from. **My own sizing was wrong for the same reason**: the "261 declarations" I counted as the
eight kit-valued roles in `index.html` are **invisible to the judge**, so the palette pass is driven by the **source-against-
kit measurement**, and the suite only drives the other half - the **389 values that are not in the kit at all**, which are
exactly the `rule 3 · unknown-colour` findings.

**So the palette pass has two detectors and they do not overlap**: the screens lock proves a rename changed nothing, and the
suite's rule 3 names what has no home in the kit. **A pass that watches only one of them either renames blind or misses two
thirds of the work.**

### The plan link is a change, not a formality - attributed at last (2026-10-08)

The `layout.css` link in `desktop/ui/meters.html` was reverted earlier today because the screens lock failed on that window
by 9.4% and the drift could not be attributed between the link and an uncommitted `design/components.css`. **The
attribution is now measured, and it is the link.**

```
without the link:  node scripts/test-design-screens.mjs -> 10 image(s) byte-identical, 1091910 bytes, WING_BROWSER_SUITE_OK
with the link:     meters-light 148519 of 1600000 pixels differ (9.282%)
                   meters-dark  151044 of 1600000 pixels differ (9.440%)
                   both in the region x 0..1599, y 67..979
```

**So the same experiment also settles the other question**: with `f55a2ec1` committed and the link out, **the ten images are
byte-identical**, which proves that the new `.c-meter`, `.c-meter-mask`, `.c-band.is-confirmed`, the dashed unknown band and
the hollow unknown dot **move no pixel of any application window** - the meter agent predicted that because none of the five
windows draws them, and this is the measurement that confirms it rather than the prediction.

**And it makes the link's cost visible, which the P5 requirement had been treating as free**: `layout.css` carries `main`,
the two-column plan, the stacks and the responsive bands, so **a window that has never linked it is drawn differently once it
does** - 9% of the window, below the header, which is where those rules land. **The commit that lands the link must therefore
carry the refreshed images, and the images must be looked at first**, exactly as the lock says. **That look is the owner's or
a session with context: a 9% change to the operator's meter window is not something to stamp blind, and the one refresh that
was done today without it - the index stacks - only went in because the change was a cascade accident the agent had already
diagnosed and rejected a declaration for.**

### The plan link is a visible change in three windows of five (2026-10-08, measured one by one)

P5 asks that whoever claims the canon link the values, the components and the plan, in that order. Two windows do today
(`index.html`, which linked it in `a369517d`, and `timecode.html`, committed today), and the other three were each measured
by landing the link alone and watching the screens lock:

| window | with the `layout.css` link | what happened |
|---|---|---|
| `timecode.html` | **light and dark byte-identical** | committed, one line |
| `guide.html` | light **2.902%** of pixels differ, region y 377..999 | reverted |
| `ltc.html` | light **8.418%** differ, region y 77..962 | reverted |
| `meters.html` | light **9.282%**, dark **9.440%**, region y 67..979 | reverted earlier, for the same reason |

**So the link is not a formality in three of the five.** `layout.css` carries `main`'s width, the two-column plan, the stacks
and the responsive bands, and a window that has never linked it **is drawn differently the moment it does** - by between
three and nine percent of its area, below its header, where those rules land. **`timecode` is the exception and the reason
is visible in the numbers**: the sheet reaches nothing that window draws.

**The decision that follows, and it is why this is written rather than batched**: **each of those three windows is a commit
that carries its refreshed images, and the images are looked at first** - which is the pair the adoption contract already
sends to a person, applied to the application's own windows. **A batch of three one-line links would have moved three
records with nobody looking at any of them**, and the one refresh done in a batch today (the index stacks) only went in
because the agent had already diagnosed the change as a cascade accident and rejected a declaration for it.

**And the order is forced**: `meters`, `ltc` and `guide` are the three windows whose palettes are already the kit's (twelve,
thirty-four and nine values respectively), so each of them is a window whose link and whose record can be settled in one
commit with nothing else in flight.

### The judge's viewport, measured on a frozen snapshot: the width changes no verdict, and rule 10 was never width-blind (2026-10-08)

**What this section corrects, and it leaves the wrong sentence standing above so the correction is readable.** The section
*"P1's third criterion, answered by a stranger"* says:

> - **The judge never renders the two-column plan.** Its viewport is `756x469` - **below the kit's own 1180px band, where
>   `layout.css` is already one column** - and `collect.mjs` contains no `Emulation.setDeviceMetricsOverride` call. **Every
>   page is judged with the plan collapsed**, so rule 10 cannot separate a composed plan from a one-column page.

**The first half is confirmed to the digit. The second half is refuted by measurement**: at 1440 the plan *is* laid out, no
rule's verdict moves with it, and rule 10 reads the same two numbers - and separates the same pages - at both widths,
because the collapse touches neither of them. What rule 10 cannot do it cannot do at **any** width, and that limit is
already written into the rule (`rules.mjs:1149-1158`).

**How it was measured, and the first finding is about method.** The repository's suite was **not edited**: a copy of
`design/conformance/` and the kit files it reads was taken outside the tree and **only the copy** gained
`Emulation.setDeviceMetricsOverride` and a `--viewport WxH` flag, on a **private port, never 9223**. And because the tree
**moved under the first attempt** - five commits in nine minutes (`0cd986bf` ltc 20:16:56, `9a9cac1b` index 20:18:15,
`c7d1e5b4` guide 20:19:31, `f55a2ec1` components 20:19:24, `b069527f` docs 20:20:59), with 36 dirty paths at the end -
every number below comes from a **frozen snapshot**: `git archive HEAD design desktop/ui` extracted to `/tmp` at
**`b069527f`** (`design/layout.html` `aee32e86`, `reference-window/index.html` `9b5ab444`, `index.html` `e5b853de`,
`meters.html` `d6e7ff16`, `timecode.html` `1508b982`, `ltc.html` `804c1542`, `guide.html` `5cf372b0`, the fixture
`4d966b28`), each run with the page's own sha1 taken **before and after** it: no page moved during any run reported here.
The drive-by runs that preceded the snapshot are the reason this paragraph exists - a measurement taken while another
programme commits five times in nine minutes is not a measurement, and one of them read `rule 10 · retyped-plan` on
`index.html` for a file state that `9a9cac1b` had already fixed.

**1. The default is exactly 756x469, and the suite has no viewport control** (`grep -rc setDeviceMetricsOverride
design/conformance/` returns 0; `grep -rn Emulation design/conformance/` returns 0 occurrences). With no override at all,
the collector reports `innerWidth 756, innerHeight 469` on every page. At 1440x1000 the three facts the earlier agent
reported are reproduced exactly - `740px - static - none` at 756, `998px 6px 420px - sticky - flex` at 1440 on
`design/layout.html` - and the raw observation (saved beside this run) is what rule 10 reads at each width:

```
design/layout.html        756x469                              1440x1000
.layout                   740px (one track)                    998px 6px 420px
.stack / .builder-column  gap 8px - min-width 0px              gap 8px - min-width 0px   <- identical
.ops-column               position static                      position sticky
.column-resizer           display none (zero box, not collected)     display flex, w 6
elements collected        92                                   94
```

**2. Findings by page and rule, both widths, at the suite's own sampling.** "Settled" is the same run with CSS
transitions allowed to finish (below); on every page but `index.html` the two agree.

| page | 756x469 | 1440x1000 | moves with the width? |
|---|---|---|---|
| `design/layout.html` | 0 failures - 0 declared - rules 6 and 7 not judged | identical | **no** |
| `design/reference-window/index.html` | 0 failures - 0 declared - rule 7 not judged | identical | **no** |
| `desktop/ui/index.html` | **489 failures** - 213 declared | **475 failures** - 213 declared | **only rule 3, and it is the transition (below)** |
| `desktop/ui/meters.html` | 0 failures - 39 declared | identical | **no** |
| `desktop/ui/timecode.html` | 0 failures - 4 declared | 0 failures - **2 declared** | **rule 8 only, and only a declaration disappears** |
| `desktop/ui/ltc.html` | 0 failures - 8 declared | identical | **no** |
| `desktop/ui/guide.html` | 0 failures - 291 declared | identical | **no** |
| `design/conformance/fixtures/bad-retyped-plan.html` | **3 failures, exit 1** | **the same 3 failures, exit 1** | **no** |

There is no rule whose verdict moves. Rules 9 (load order) and 10 (the plan) are identical at both widths on every page.
Rule 4's two-theme check is identical on every page - `design/layout.html` reports `tokens 52 - references 50 -
frozenTokens 0 - frozenElements 0` at both - so **the width does not touch the two-theme reading**, and it does not touch
rule 1's either: `design/layout.html` reports `edges 31 - raised 21 - sunken 10` at both widths, and the two elements the
desktop width adds are not edges at all. **The one genuine width effect in the whole set is `timecode.html`'s clock**:
`clamp(var(--font-clock), 7vw, var(--font-clock-lg))` is 52.92px at 756 (7vw between two steps, which is exactly the two
*declared* rule-8 findings the `allow.mjs` entry describes) and 55.25px at 1440, where 7vw is 100.8px and the clamp sits on
`--font-clock-lg`, a kit step, so there is **no finding left to declare**. It is a declaration closing, not a new failure.

**3. What rule 10 does at 1440, and it does the same at 756.** Its statistics per page, at both widths:

| page | at 756x469 | at 1440x1000 |
|---|---|---|
| `design/layout.html` | `elements 92 - checked 3 - retyped 0` - PASS | `elements 94 - checked 3 - retyped 0` - PASS |
| `design/reference-window/index.html` | `elements 61 - checked 3 - retyped 0` - PASS | `elements 63 - checked 3 - retyped 0` - PASS |
| `desktop/ui/index.html` | `elements 513 - checked 3 - retyped 0` - PASS | `elements 515 - checked 3 - retyped 0` - PASS |
| `meters` / `timecode` / `ltc` / `guide` | `checked 0` - silent, and the report prints `checked 0` rather than passing quietly | the same |
| `design/conformance/fixtures/bad-retyped-plan.html` | `checked 3 - retyped 3` - **3 failures, exit 1** | `checked 3 - retyped 3` - **the same 3 failures, exit 1** |

So: it finds the plan on the three pages that compose one (`checked 3` = the builder `.stack`, its `.builder-column` and
the operator `.stack`); it says `checked 0` on the four windows that define no such class, which is a pass that shows its
own blindness rather than hiding it; it **reds the fixture built to be wrong at both widths** - `div.stack.builder-column`
`.stack resolves gap: 10px` and `.builder-column resolves min-width: 280px`, `aside.stack.ops-column` `.stack resolves gap:
10px` - which is the discriminating power the wrong sentence above says it cannot have; and it is quiet on all five
windows, `index.html` included, whose own retyped gap and floor are gone (`9a9cac1b`, the two-line deletion the palette
section above asked for). **What rule 10 does not do at any width is judge the tracks**, deliberately: the computed
`gridTemplateColumns` is the used track list, so a comparison against the declared `minmax()` text cannot match a correct
page or separate a wrong one.

**4. What the narrow band does hide: the seam and the sticky column - and only those.** The desktop rendering collects
exactly **two** more elements on each page that composes the plan: `div.column-resizer` and its `div.resizer-handle` grip
(92 to 94 on `layout.html`, 61 to 63 on the reference window, 513 to 515 on `index.html`). **No rule attaches a finding to
either**: rule 1's tally does not move, rule 10's numbers do not move, and rule 3 gains one paint per design page (227 to
228 colours) that is the kit's own `--line`. So the two-column plan is *laid out but not judged* at 1440, where at 756 it is
neither.

**5. And a desktop defect that neither width would catch.** `desktop/ui/index.html` overflows its own window horizontally
between **1181px and about 1208px**: at 1181 `documentElement.scrollWidth` is 1209 on an 1181px viewport (28px past the
edge) and at 1200 it is still 1209 (9px), the two elements past the edge being the master header's `div.master-stats` and
`button#open-help-btn` - the window's own header band, which is only reset at its `@media (max-width: 1180px)`. **The kit's
own plan does not overflow at any width from 1181 to 1920** (`design/layout.html` and the reference window are clean at
every one), so this is the application's header, not the plan. No rule reads `scrollWidth`, `position`, `display` or the
tracks, so a suite pinned at **either** 756 or 1440 books this as green.

**6. The confound, and it is the most useful number here: `index.html`'s counts are read mid-transition.** At the frozen
hash `e5b853debc`, four runs at each width:

| | 756x469 | 1440x1000 |
|---|---|---|
| suite's own sampling (40 ms) | 418 `unknown-colour` - 64 `mixed-edges` - 7 `two-shapes` - **489 failures** | 404 - 64 - 7 - **475 failures** |
| transitions finished (1000 ms) | 383 - 57 - 14 - **454 failures** | 383 - 57 - 14 - **454 failures** |

**With the transitions finished the two widths are identical, and at 40 ms they are not**: the difference is when the
reading is taken, not what the desktop layout is. `.card-draggable` carries `transition: transform 0.15s ease, box-shadow
0.15s ease, border-color 0.15s ease` (`desktop/ui/index.html:4066`) and `observe()` samples 2 rAF + 40 ms after it toggles
`theme-dark`, so the suite reads a colour that is still interpolating - the same element at the same width measures
`#525d5a`, `#606a66` or `#45514d` in different runs, and whether one edge of a card happens to land exactly on the kit's
value depends on how far the interpolation has got. It is why the 491 failures quoted in the palette sections above sits
between the two rows of this table (`9a9cac1b` then removed rule 10's two). **A count from this suite on `index.html` is
not reproducible to better than about 35 findings until `observe()` waits for the animations to settle rather than for 2
rAF and 40 ms - and that repair is worth more than any viewport change.**

**The recommendation: leave the viewport alone, and say in the suite's own text what it does not lay out.** The measurement
is that the width changes **no verdict** - not one page crosses from green to red or back, no rule's findings move except
one *declared* rule-8 pair on `timecode.html` closing, and the one remaining movement on `index.html` disappears when the
transition it samples is allowed to finish. Making desktop the default or adding a second pass would therefore buy **no
new verdict today**, and would cost real things:

- **Make 1440x1000 the default** *(rejected)*. Cost: one override in `collect.mjs`, but it **re-baselines every recorded
  number** (`conformance/allow.mjs`'s measured counts and reasons, `desktop/ui/allow.mjs`, the measured block in
  `AGENTS.md`, `docs/DESIGN_DISAGREEMENTS_2026-10-08.md`, `design/screens/`) while changing no verdict, and it **stops
  judging the band the windows' own `@media (max-width: 1180px)` rules exist for** - the band where this application's
  history has the 1041px overflow, and where four of the five windows are laid out today. It also would not catch the
  overflow in point 5, which lives at 1181-1208px.
- **Add the desktop rendering as a second pass** *(rejected)*. Cost: every browser run doubles - measured here, one
  `--theme both` run (two themes plus rule 8's two forced-scale renderings) is 0.7-1.3 s per page, i.e. about **6 s of
  browser time for these seven pages at one width and about 12 s for two**, with the doubled analysis and report on top.
  The heavier price is not the seconds: `applyAllow` is a **plain substring match with no viewport field**, so a declaration
  that is right at 756 (the `timecode.html` clock's `7vw`, whose own reason states the 756x469 rendering) becomes an
  unused-declaration note, or a swallowed failure, on the other pass, and the declaration list stops meaning one thing.
- **Leave it alone and write it down** *(chosen)*. Cost: two sentences - one in `design/conformance/README.md`'s rule-10
  row and one in the header comment of `collect.mjs`/`run.mjs` - saying that the suite renders **the headless browser's own
  756x469**, that this is below the kit's `@media (max-width: 1180px)` band so the plan is judged collapsed, that rule 10's
  two readings are `gap` and `min-width` and the collapse changes neither, and that the tracks, `position` and overflow are
  not read at any width. No number moves, no run doubles, no window goes red.

**What would overturn this.** (a) A rule that reads the geometry the collapse changes - the track count, `.ops-column`'s
`position`, `scrollWidth` against `innerWidth`, a sticky column's clipped height. If such a rule is written it needs a
desktop rendering **and** the point-5 band, and the second pass becomes the honest price; today it would be a rule no
rendering exercises. (b) The point-6 repair landing, at which point the numbers in the palette sections above must be
re-measured rather than quoted, because they are transition readings.

### What is left, 2026-10-08 late - the four debts, and why no seventh writer (appended, not rewritten)

The five pieces are built and proved. The artefact is cut at 1.4.1 with 53 files and its own self-test runs green from inside
the unpacked tarball. Six agents are writing in this tree right now - the last three window links, the collector's settle, the
card-head row and the line-height token - and **I am not opening a seventh front**, because three of the four things below
would touch files those six hold, and the fourth would make the screens lock red while five records are being refreshed.

**The four debts, in the order they can be taken, with their blockers:**

1. **`index.html` overflows horizontally by 28px at 1181 and 9px at 1200** - `div.master-stats` + `#open-help-btn` need
   1209px and the header's own reset is at 1180, so there is a 29-pixel band where the window is wider than the viewport.
   **No rule reads `scrollWidth`, and the suite pinned at 756 or 1440 books it green.** Measured by the viewport agent, which
   also established that the kit's own plan is clean from 1181 to 1920, so this is the application's defect and not the
   sheet's. **Two halves, and the second is the valuable one**: the header must wrap or reset at the width it actually needs,
   **and the suite needs a rule that reads overflow** - which is a new rule, and a new rule wants a quiet tree.
   *Blocked by*: nothing holds `desktop/ui/index.html`, but a layout fix there moves its screenshots, and its counts are not
   reproducible until the collector stops reading pages mid-transition.

2. **The collector reads pages mid-transition** - `.card-draggable` transitions `border-color 0.15s` and `observe()` samples
   2 rAF + 40 ms, so four runs of `index.html` at one commit gave 489, 475, 454 and 454, and the same element measured
   `#525d5a`, `#606a66` or `#45514d`. Every recorded number for that page, including the 491 in this file's palette
   sections, is one sample of a ±35 cloud. *In flight* - and it is the one that unblocks debt 1.

3. **`guide`, `ltc` and `meters` still link two sheets of three**, and each one's link is a visible change: 2.902%, 8.418%,
   9.282%/9.440%. Each is a commit carrying its refreshed images, looked at first. *All three in flight.* When they land, the
   five windows all claim the canon, which is what P5 asks.

4. **The kit's version and its artefact are owed one more move together.** Today's later changes - the card-head row and the
   line-height token - add content to the kit without moving it, on purpose, because the artefact was cut at 1.4.1 an hour
   ago and a content change under one number is the defect this kit exists to prevent. **One decision, by me, when the tree
   is quiet: `design/VERSION` to 1.4.2, every carrier by `grep`, the artefact regenerated in the same commit.**

**And the verdict that outranks all four**: P1's third criterion was answered by a stranger and the answer was no. **Six things
it had to invent, and five of them are now closed or in flight** - the meter drawing, the confirmed band, the non-colour state
differences, the operable fold, the card-head row - **with the line-height token decided and being implemented now.** The
canon stops needing an inventor by the end of the day; the sixth debt on that list was never the stranger's, it was ours.

### The version move now owed, and its carriers measured before anyone types (2026-10-08)

**Four content changes landed tonight without the version moving**, on purpose, because the artefact was cut at 1.4.1 an hour
before them and *the artefact and its version move together or neither moves*: the operable fold and the theme label
(`fa0ec43c`), the sheet's shell note (`24c7bcdd`), the kit's header bullet for the same thing (`804dd1d4`), and - in flight as
this is written - the card-head row and the line-height token. **When those two land, `design/VERSION` goes to 1.4.2 and
every carrier moves in one commit with the regenerated artefact.**

**The carriers, measured by `grep -rl '1\.4\.1'` and not from a list** - fourteen outside the artefact:

```
design/VERSION                              the string itself
design/tokens.json                          its `version` field AND a new 1.4.1 -> 1.4.2 note
design/tokens.css                           GENERATED - regenerate, never edit
design/native/WingTheme.swift               GENERATED - regenerate, never edit
desktop/ui/design-tokens.css                GENERATED through the sync script
design/CONSUMING.md                         prose
design/conformance/README.md                prose
design/conformance/allow.mjs                its kitVersion, which the preflight compares with VERSION
desktop/ui/allow.mjs                        the same declaration for the application
design/adopt/allow.mjs.example              the example a consumer copies
scripts/lib/kit-package.mjs                 the packager's own version constant
scripts/test-design-kit-package.mjs         the test that asserts it
design/dist/wing-controller-design-1.4.1.tar.gz.sha256   the FILENAME carries the version - a new file, not an edit
```

**And three hits that must NOT be rewritten, which is exactly why this is written down:**

1. **`design/CANON_PLAN.md`** - it appears only because this file *records* 1.4.1. A `sed` over the tree would rewrite the
   day's own history: the same mistake as the sweep I nearly made over "eight", when §11's eight points were correct.
2. **`design/tokens.json` and `conformance/README.md`** also carry **historical notes** - the 1.3.0 -> 1.4.0 and 1.4.0 -> 1.4.1
   sentences. **Read each hit before changing it**; the note for the *new* move is appended, the old ones stay true.
3. **Nine files inside `design/package/`** carry it too, and **the whole artefact is regenerated, not edited** - it must be
   byte-identical to its sources, which is the identity `test-design-kit-package.mjs` enforces and the reason the packager
   refused to cut it while eight writers held the tree.

**The safety net for the move**: `scripts/test-design-tokens.mjs`, `-tokens-generator.mjs`, `-tokens-swift.mjs`,
`test-design-kit-package.mjs` (two builds byte-identical) and `test-design-app-agreement-live.mjs`. **If the generated forms
and the artefact are regenerated rather than edited and those five are green, the move is done** - and the one thing that
cannot be checked by a test is the historical notes, which is why they are named here.

### The 491 in the palette sections was never a stable number - it is 454 (2026-10-08, appended)

Three sections above quote `index.html` at **491 failures**. **That figure was one sample of a cloud**: the collector sampled
the page 2 rAF + 40 ms after toggling the theme, and `.card-draggable` transitions `border-color 0.15s`, so four runs of the
same commit read **489, 475, 454, 454**, and the same element measured `rgb(116,125,122)`, `rgb(147,154,152)` or
`rgb(176,181,179)` across flips.

`193b45ca` made `observe()` await `document.getAnimations()` before sampling, bounded at 1000 ms with the bound printed when it
is hit. **`index.html` is now 454 four times, byte-identical** - and the defect is measured rather than inferred: at the old
instant **42 CSSTransitions are running at t=50-67 of 150 ms**, none of whose interpolated values is a kit colour, which is
exactly the **37 extra rule-3 findings** the old number carried. The settle costs **+0.16 s** on that page and is a **no-op on
the other six** (they have 0 animations at every sampling point), and the self-test is unchanged at 27.

**So the family pass on `index.html` is 454 findings - 383 rule-3 colours and 71 rule-1 edges - and not 491.** The sections
above stay as written because they are dated photographs, but **the number to work from is 454**, and any earlier count in
this file for that page should be read as one frame of a moving picture. **The general rule it earns: a count taken before
the page has settled is not a measurement, and the suite now says so by waiting and by naming when it could not.**

**And one consequence for the version move**: `design/package/MANIFEST.sha256` now disagrees for `conformance/collect.mjs`
and `conformance/run.mjs` as well, on top of the three files already stale from tonight's other work. **The carrier list above
says nine files inside the artefact; it is eleven or more by now, and the whole artefact is regenerated rather than edited** -
which is why the list names the identity check as the safety net rather than the individual files.

### The second stranger is testing yesterday's artefact, and that reorders the last acts (2026-10-08, round 151)

The tarball the second stranger was handed is `wing-controller-design-1.4.1.tar.gz`, **cut before tonight's five fixes**: the
meter, the confirmed band, the three states' non-colour differences, the operable fold and the card-head row all landed
**after** it. So **its invention list will look like the first stranger's**, and reading it as "the kit still cannot be copied"
would be reading it wrong: **it is measuring the contract, which is exactly what 1.4.1 changed** - the step paths that could not
both be right, the self-test and fixtures that did not travel, the window and plan that were missing from the artefact. **That
is the question it can answer, and its report should be read against those, not against tonight's component layer.**

**Which forces an order on what is left:**

1. **The `body` frame lands or is reverted** (its author has both options and the measurement of what it moved).
2. **The version moves to 1.4.2 and the artefact is cut again**, in one commit with every carrier - **five content changes are
   owed it**: the operable fold and the theme label, the sheet's shell note, the kit's header bullet, the card-head row, the
   `body` frame, plus whatever rule 11 and the line-height token add.
3. **Then, and only then, a stranger test means something about tonight's kit.** Handing one the 1.4.2 tarball asks the question
   P1's third criterion actually poses: **can someone who has never seen this repository build a window from what we ship
   today, without inventing the six things the last one had to invent?** **A test run before step 2 cannot answer that, and a
   test run after it is the only evidence that would let the criterion be called met rather than suspended.**

**And the same order settles the two stale records**: `meters` (1.144%) and `timecode` (0.574%) moved when the uncommitted
`body` frame landed, so their refreshes belong **after** it is settled, each in its own commit, each looked at - **not in a
batch while the kit is moving**, which is the rule this evening has already paid for three times.

### The second stranger passed, with zero declarations - and found nine defects (2026-10-08, landmark)

An agent that never read this repository took `wing-controller-design-1.4.1.tar.gz`, followed `adopt/README.md` step by step,
built a console panel by forking the reference window and gutting it per `PLAN.md`, and verified it with the kit's own judge:
**`CONFORMANCE OK · 0 failures · 9 of 10 rules checked`, exit 0, `deviations: []`.** Its own words: *"the final panel needs no
mute button - which is the strongest single result in this report."* The self-test ran from the copy (27 checks, green).

**And it is the measurement of tonight's work.** Its §3, verbatim: *"Nothing was copied into the panel from the reference
window's page-local sheet, and the reason is the kit's own correction: three of the reference window's rules are no longer
needed - the kit's `components.css` now carries `.c-band.is-confirmed`, `.c-band.is-unknown` and the hollow unknown dot, whose
own comment says they lived only in the reference window's page-local stylesheet until the kit took it. I used the kit's."*
**The inventions fell from five drawings to three arrangement classes** (`.strip-field`, `.readout-value` - needed because
`.c-well` has `text-align: right` and **no width**, so `48 kHz` was clipped - and `.c-titlebar .c-band`), each justified by the
kit's own rule that it names furniture and never an arrangement.

**The findings, in the order they should be taken:**

1. **The reference window arrives with its Readouts card FOLDED, and the judge cannot see inside it.** Measured both ways on
   the stranger's page: folded, `RULE 2 · checked numbers 0` and `RULE 6 · NOT CHECKED`; open, `checked numbers 4` and
   `checked states 3`. **A card folded on arrival is unverified, not conformant** - and it is the example we tell consumers to
   fork. **Fix: the window arrives with everything the judge must see visible, and the fold is demonstrated by pressing the
   control the window now carries.**
2. **`UI_SYSTEM.md` §10's theme snippet throws where it is printed**: `document.body.classList.toggle(...)` runs in `<head>`
   where `document.body` is `null` - measured, `Uncaught TypeError: Cannot read properties of null (reading 'classList')`, the
   class never applied. **The kit's own document ships code that does not run.**
3. **Two of the contract's own paths name files that do not exist**: `adopt/README.md` step 3 says copy
   `design/conformance/allow.mjs` (the template is `adopt/allow.mjs.example`) and step 1 says copy `design/package/` (there is
   no such directory in the tarball).
4. **The published checksum does not travel in the artefact**: `CONSUMING.md` §1 tells the consumer to run
   `shasum -a 256 -c wing-controller-design-1.4.1.tar.gz.sha256`, **and that file is not in the tarball**. *"I verified the
   tarball by computing its SHA-256 - which proves nothing, since I had no published value to compare against."*
5. **`MANIFEST.sha256` verifies only from inside the unpacked `design/` directory**, and the contract does not say so: from
   the tarball's flat root all 52 files fail to open.
6. **No gate to wire the judge into**, and none of the four `scripts/` files the contract names as the pattern. The stranger
   wrote its own; the contract gives the shape of the lock but **no acceptance test for the lock itself**.
7. **The reference images are 1.4.0 while `design/VERSION` is 1.4.1**, and on that machine **the PNGs would not decode at
   all**, so it could not judge resemblance - the one thing the contract says the judge cannot do either.
8. Three tools are cited as runnable while being deliberately absent (`compare-design-likeness.mjs`, the mutation check, the
   browser conformance suite); the contract assumes a clone the artefact does not have.
9. Its one unverified claim is honest: the protocol rule behind its refusal (*a `DEQ2` strip has no `/gate/thr`*) comes from
   this repository's `AGENTS.md`, not from the kit, and it says so in the panel's own comment.

**Two of these are ours and small: the folded card (1) and the throwing snippet (2).** Both are a change to something the kit
ships and both are the kind of defect this evening has been fixing all night - **a document that does not do what it says.** The
rest are the artefact's contract and belong to the version move, which is now owed more than a version: **the artefact must
carry its own checksum, and the two paths in `adopt/` must name files that exist.**

### Rule 11 is in, and the plan's own quotes about the rule count are now stale (2026-10-08, appended)

**Three sentences above are false as of `42bfde37`**: the ones quoting `8 of 10 rules checked` and `9 of 10 rules checked` (the
suite runs **eleven** rules now), and the line saying **no rule reads `scrollWidth`**.

`rule11ViewportFit`, code `overflows-viewport`, reads a page-level `overflow` field the collector now records
(`viewportWidth`, `scrollWidth`, `wideningBox`, `excess`, `widestPastEdge`, `rightmost`; a page that fits carries `excess: 0`
and null element fields). Registered where 9 and 10 are - the one-shot block after the per-theme loop. The self-test went
**27 to 28**, and the fixture's teeth were proved by putting the same defect into a copy of `good.html` **outside the tree**,
so a concurrent gate could never see a conforming fixture broken.

**And it found two overflows the suite had been booking green, both pre-existing and both real:**

- `index.html`: **187px**, `div.master-stats` reaching 943 against the suite's 756 (`454 -> 455` findings).
- **`ltc.html`: 71px**, `div.transport` reaching 827 with `button#live` at its right edge - and **`ltc.html` was
  `CONFORMANCE OK · 0 failures` before this rule existed.** Proved pre-existing by symlinking `desktop/ui/` into /tmp and
  swapping in HEAD's `design-tokens.css` and `layout.css`: identical numbers. **Not declared** - a declared overflow is the
  mute button this design forbids - so `design/conformance/allow.mjs` is untouched and both stay red where a reader can see
  them.

**What the rule cannot see, written in its own comment and in the README**: the suite renders at **one width, 756x469** (no
`Emulation` call anywhere), so it catches a page too wide *there* and **cannot see `index.html`'s 1181-1208 band** - at 756
that page overflows by 187px for an unrelated reason, and a single rendering cannot separate the two. A sweep of widths is
what it would need, and the suite's viewport was deliberately left alone. Two more measured facts from its report belong in
the record: **`overflow-x: hidden` does not hide the defect** (934 still reported), and **dead CSS is invisible to the suite**
- the header band's fix dropped two `display: grid` declarations that had never applied, and no rule noticed, because nothing
on screen changed.

### A figure measured on one page does not transfer to another, and the parent got that wrong (2026-10-08, appended)

The second stranger measured, on **its own panel**, that a folded card hides its contents from the collector: `RULE 2 · checked
numbers 0` and `RULE 6 · NOT CHECKED` folded, `checked numbers 4` and `checked states 3` open. The parent then briefed the
reference window's fix quoting **those** figures as if they were that window's - and the agent measured its own page instead of
copying them, which is the whole reason the error stayed out of the tree:

- **`RULE 2 · checked numbers 0 → 2`**, not 4: **R4 carries two numeric values** (peak and RMS); the clock offset has no value
  and the reason band is prose. The `4` was the adopter's page, which carried four.
- **`RULE 6 · checked states 3 → 3`**, not `NOT CHECKED`: **R6's three `data-state` elements live in their own card** ("Machine
  decisions") in the same operator column and **were never folded**, so nothing on this page ever hid them. The adopter's
  `NOT CHECKED` was its own page, where the states sat inside the card that was closed.

Both figures are quoted in `design/reference-window/index.html` and its `PLAN.md` **with the adopter's name attached**, which is
the provenance the correction needs. The lesson is worth more than the fix: **a measurement belongs to the page it was taken
on**, and a brief that quotes one page's numbers as another's is the same defect this file records everywhere else - an
inference wearing the clothes of a measurement. The window still earned the change: R4 now arrives open, `0 -> 2` numbers the
judge had never seen, and the fold is one press away on a button whose `aria-expanded` arrives truthful.

### D11 - the artefact ships a runnable `conformance/allow.mjs`, decided on measurement (2026-10-08)

**Measured by the agent that built the gate template, in a fresh unpack of `design/dist/wing-controller-design-1.4.1.tar.gz`
into /tmp**: the tarball ships `adopt/allow.mjs.example` and **not** the `design/conformance/allow.mjs` that
`conformance/run.mjs` reads, **so the first run of any gate a consumer builds from this kit exits 3** with *"the app allowance
file does not exist"* - and **nothing is measured**. The agent's own first /tmp run printed exactly that, and it worked around
it by seeding the file once in the template.

**The decision: the artefact ships a runnable `conformance/allow.mjs`.** The kit owns exactly one page inside the tarball -
the reference window - so the shipped declaration is the kit's own: `app: 'Wing Controller reference window'`,
`allowApp: 'reference-window/index.html'`, the kit's `kitVersion` read from `VERSION` beside it, `deviations: []`. **It is
honest rather than a bypass, and that is measured, not assumed**: the reference window reports `CONFORMANCE OK · 0 failures`
against exactly that minimal declaration.

**Consequences.** A consumer's first `run.mjs --app <page>` measures their page instead of failing on a missing file; the
gate template's seeding step becomes a no-op for a fresh unpack and remains only for a consumer who deleted the file; and the
example keeps its role as the thing you copy when you declare your own deviations.

**Rejected alternative: leave it to the template to seed.** It works for anyone who runs the template, and it fails for
anyone who follows the contract's plainer instruction - *"verify with the kit's own tools: `node design/conformance/run.mjs
--app <page>`"* - which is the first command `CONSUMING.md` and `AGENTS.snippet.md` both give. **A kit whose own documented
first command exits 3 is the defect this whole evening has been about**, and a script that writes the missing file is a
workaround for it rather than a repair.

**What would overturn it**: a consumer with several pages, where a shipped default with `allowApp` pointing at the reference
window would be misleading. That is answered by the file's own comment - it says it is the kit's default, names the window and
says to replace it with yours - and by the example, which stays.

**Where it lands**: `scripts/lib/kit-package.mjs`'s file list and the artefact's own content, **so it goes in with the version
move and the regeneration, not as a separate edit** - and its acceptance test is the one that matters: unpack the tarball into
/tmp and run the judge on the reference window with **no seeding step at all**.

### One commit names one file and carries two, and two measurements worth keeping (2026-10-08, appended)

**The over-wide commit is `160a061c`** (the D11 record above, amended from `33d72c54`). The agent that re-cut the reference
bands landed its set, then noticed an ambiguous README sentence and ran `git commit --amend -- design/reference/` - **but
between its commit and its amend, `33d72c54` had landed on top, so the amend amended that one instead of its own.** Its
message names `design/CANON_PLAN.md` and the commit now also carries **one line of `design/reference/README.md`**. It checked
and said so itself: the plan text is byte-intact, `d7ceedf0` is still in history with the four PNGs and the README's bulk, and
**it did not rewrite history a second time**, which is the rule this file already carries. **The defect is the same one this
evening has recorded four times over - a message that describes less than the commit carries - reached this time through
`--amend` rather than a sweep, and the process fix is one command: read `git log -1` immediately before an amend, because an
amend edits whatever HEAD is, and HEAD belongs to whoever committed last.**

**And two measurements from that work that outlive it:**

1. **The four reference PNGs decode, verified three ways.** `sips` reads each (`format: png`, `pixelWidth 1600`, heights
   1412 / 1632 / 1052 / 1337) and converts every one to TIFF at exit 0; `file` agrees; and an independent pass over the raw
   chunks reports `every chunk CRC verified, IDAT inflates, every scanline filter valid, IEND present`, with no trailing
   bytes. **So the agent that could not decode them was reporting its own machine, not our files** - which corrects that
   finding to what it is: a reader-side limitation, not a writer-side defect.
2. **A pre-existing capture flake, now written down with its numbers.** The third band was refused once by the tool's own
   double-capture check: `1438 of 1683200 pixels differ (0.085%), in the region x 21..1578, y 934..947` - **which is exactly
   `.ramp-demo`, the `--meter-ramp` gradient, and the differing pixels are ±1 in one channel** (`rgb(0,172,107)` against
   `rgb(0,172,108)`): Chrome's gradient dithering, not layout. **Ten pairs of that band: one differed.** So "captured twice
   and required byte-identical" holds about nine times in ten there, and **the fix belongs in `scripts/lib/design-screens.mjs`**
   - pin the rasterisation, or tolerate dither-only differences - **not in `design/reference/`**. The written set came from a
   run whose two captures agreed.

### The third stranger: CONFORMANCE OK with ONE invented rule, and twelve findings (2026-10-08, the night's verdict)

Adopted `wing-controller-design-1.4.2.tar.gz` as a stranger, verified the published checksum the way `adopt/README.md:23` names
(`shasum -a 256 -c wing-controller-design-1.4.2.tar.gz.sha256` -> OK), built a panel window, judged it with the kit's own tool.
**`CONFORMANCE OK · 0 failures · 10 of 11 rules checked · 1 not judged (rule 7)`**, self-test 28 green, **one declared
deviation** - the unavailable control, with a 949-character reason, which is the route `components.css:110` itself gives.

**Its own words, and they are the objective's measurement**: *"The kit gives **everything structural**; my own `<style>` contains
**exactly one rule**"* - `.c-well.is-secondary { font-size: var(--font-badge) }`, a kit value that no named step between
`--font-xs` and the next one up covers. **The invented list across the three stranger tests: five drawings, then three
arrangement classes, then one rule.**

**D11's acceptance test, measured three ways**: a fresh unpack judged on the reference window exits **0**; its own page against
the **unmodified** shipped allowance exits **1, not 3** (*"so the judge ran; only the declaration needed writing"*); and
`run.json` was written by the judge's own `--record`. **No file had to be written by hand before the judge would run.**

**The twelve findings, in the order they matter:**

1. **The suite renders at 756px, where `layout.css:289-310` collapses the plan to one column** - so **every geometry rule
   judges the fallback column, and the two-column composition, the seam, the sticky column and the 1400px band are never
   rendered at all.** That is a statement about what every green line this evening actually measured, and it is why the
   stranger made its own 1280x900 renders.
2. **`gate.sh.example` announces a skipped check as green**: `SKIP screenshot lock - none is wired here yet` followed by
   `gate: OK - kit self-test, page(s) judged, screenshot lock: all green on port 9338`. That is the kit's own stated worst
   failure - *a green light nobody earned* (`wire-your-gate.md:24`) - **written into the gate that ships the rule.**
3. **`gate.sh.example` defaults to port 9223** - the one port the kit tells every consumer never to drive.
4. **Step 3 breaks the kit's own integrity check**: `MANIFEST.sha256` pins the shipped `conformance/allow.mjs`, so following
   the step that says to write your own makes `shasum -a 256 -c MANIFEST.sha256` fail with `conformance/allow.mjs: FAILED`
   and exit 1 - on a document that calls the manifest *the authority*. **A direct consequence of D11, created tonight.**
5. **§10's "link it, do not retype it" is broken by the canon window, and no rule notices.** `reference-window/index.html:59`
   claims the kit names no `.c-band.is-confirmed`, carries three such rules page-locally, and **kit 1.4.2 names all three**
   (`components.css:475`, `:490`, `:464`). Measured on two copies differing only in those declarations: **both
   `CONFORMANCE OK · 0 failures`; screenshots byte-identical.** Zero reach, zero findings.
6. **The suite toggles `body.theme-dark` itself without pressing the window's switch**, so its dark photograph shows
   `Theme: light` on a dark page - **a state no operator can produce**, because the kit's own mechanism is `apply()` setting
   class and control together.
7. **`adopt/README.md`'s `design/...` paths are source-repository paths**: the same sentence says the tarball root is flat and
   then writes the window as `design/reference-window/`, which does not exist inside it. Only `wire-your-gate.md:8` and the
   template use the artefact's own `<kit>/...` convention.
8. **Step 2's snippet has five placeholders, not two** (`<our folder>`, `<page>`, `<a private port>`, `<kit>` twice), and they
   are inside the rule rather than in the text above it.
9. **`README.md:64` still says "No window links it yet"** about `components.css` while `UI_SYSTEM.md:313` corrects it to five -
   **a stale summary inside the artefact that forbids stale summaries.**
10. **`CONSUMING.md:28-33` puts a paragraph of prose inside the ```sh fence**, before the commands it calls "the command above".
11. **The judge's numeric patterns have no `dBFS` unit** (`rules.mjs:389`), so a console reading in dBFS is silently outside
    rule 2's reach.
12. **Step 5 names four paths that are not in the artefact** (`scripts/test-design-screens.mjs`, `scripts/lib/design-screens.mjs`,
    `compare-design-likeness.mjs`, `design/screens/`) in the same paragraph that says they do not travel.

**What it could not establish**: whether the kit still looks like the application it came from (both documents say
"documented, not measured"); how stale the 1.4.1 pictures are at VERSION 1.4.2 (it did not render the specimen at both
versions); anything about the source repository; and rule 7, which it read by eye. Full report at `/tmp/stranger3/REPORT.md`.

### The gate template's three defects are fixed, and the parent broke the fourth-site rule (2026-10-08, appended)

The stranger's three worst findings are closed in `761cc9f4`, each measured in both directions. **The skipped check is no longer
green**: the final line is built from RAN/SKIPPED lists and a run with a skip ends **3** - not 1, because nothing was found
wrong, and not 0, because the thing it would have measured was never measured - with the port default moved off 9223 to 9333,
the port the kit's own documents already use. **And the manifest-versus-step-3 contradiction is resolved in words where a
consumer meets it** (`adopt/README.md:42-47` and the template's allowance block), with the sentence's claim measured: a fresh
unpack verifies **55/55 OK**, and after one declared deviation it reports **54 OK, 1 FAILED - `conformance/allow.mjs`** - exactly
one file, named, which is what the sentence promises. The template's two runs are on the record as `gate: OK` exit 0 with every
check available and **`gate: INCOMPLETE` exit 3** with the lock absent.

**And the parent's own defect, which is why this paragraph exists.** Commit `b383c236` corrected `design/reference/README.md`
- the staleness guard - **and did not regenerate `design/package/**`**, so the committed mirror went stale and
`test-design-kit-package.mjs` was **red at HEAD** until the next agent regenerated the artefact and had to carry
`design/package/reference/README.md` in a commit whose message named it. **That is the fourth-site rule this file states, broken
by the agent that wrote it the same evening**: the artefact mirrors every source under `design/`, so **a content change to any
mirrored file is not finished until the artefact regenerates** - and the rule was already written down twice, once in the plan
and once in `AGENTS.md`. **What caught it was not a reader but a test, and what repaired it was an agent with a narrower
brief than the mistake.**

### The recorder app: CONFORMANCE OK, ONE invented rule, and a false negative in the suite's own teeth (2026-10-08, appended)

The second of four blind adopters finished: a **multitrack recorder window** forked from the reference window, built only from the
1.4.2 tarball, verified end to end. **`CONFORMANCE OK · 0 failures · 10 of 11 rules checked`**, gate green, `DRIFT · 1 app(s) ·
none behind`, and a screenshot lock it wrote itself with the kit's own browser plumbing. **Its invented list**: one value-bearing
rule (`.dot.is-recording { background: var(--gold) }` - a **kit** value, because §5's seven colour meanings have no "a track
being written"), one attribute name of its own (`data-track-state`, deliberately not `data-state`, which rule 6 owns), and the
data. **Its own sheet is four rules long and contains no literal colour, size, radius or shadow.**

**The convergence this experiment was for**: the third stranger needed exactly one value rule (`.c-well.is-secondary`); **so did
this one** - a different domain, a different rule, the same count, and both reasoned from §5. Two blind agents, one missing
meaning each, no drift in the drawing.

**THE FINDING THAT MATTERS MOST, and it is the suite's foundation**: `design/conformance/collect.mjs` **never sets a viewport**
(`grep -c Emulation` is 0), so every rule judges **whatever window the browser it found happens to have** - and `ensureBrowser`
reuses any browser that already answers. The gate template's default port is **9333**, which is the very port `CONSUMING.md` and
`conformance/README.md` document as the private port for a hand run, **so every consumer on a shared machine picks the same
number**. Measured here: another session's Chrome was on 9333 at `--window-size=1280,900`; the gate reused it; **rule 11 rendered
in that foreign window, the 900px `bad-overflow` fixture fitted, and the self-test reported `MISSED … the suite exited 0 on a
known-bad fixture`** - a **false negative in the one test that exists to prove the suite can fail**. The agent reproduced the
mechanism deliberately on a port it controlled and then got a clean green on a quiet one. **Its sentence: the kit's own written
rule - two processes on one port fight, and both lie - biting its own template.** The root fix is in flight: the suite declares
its own viewport so reuse stops mattering, and `756x469` stays the declared size because every count and allowance in this tree
was taken at it.

**Three more, all in the consumer documents:**

1. **`CONSUMING.md:28-34` is a ```sh fence whose first line is prose** - the parent's own edit from tonight, inserted above the
   three real commands and *inside* the fence, so the block cannot be pasted into a shell. **A paragraph about copy-paste
   mistakes that makes one**, in the consumer-facing document.
2. **`SHARING_THE_KIT.md` is cited twice in `CONSUMING.md`** (lines 5, 201) as where the reasoning lives, **and is not in the
   tarball**, with nothing marking it as not-travelling.
3. **`README.md:15` lists `package/` as a kit file** while `adopt/README.md` step 1 says there is no `design/package/` inside the
   tarball - so the table and the step contradict each other for a tarball consumer.

**And the finding the third stranger made, now independently replicated**: a faithful fork **inherits the reference window's five
page-local rules, three of which the kit has since taken** (`components.css:475/490/464`), **and the inherited comment denies
it** - `reference-window/index.html:59-60` still says *"the kit names no `.c-band.is-confirmed`"*. This agent deleted the three,
as the third stranger did. **Two blind agents, the same trap, the same repair**: the canon window is teaching a fork to retype
what the kit supplies, and its own comment says the opposite.

### The routing app: three blind agents, and only ONE of them needed a value rule (2026-10-08, appended)

The third of four blind adopters finished: a **patch and routing window**, forked from the reference window, built only from the
1.4.2 tarball. **`CONFORMANCE OK · 0 failures · 10 of 11 rules checked`**, self-test 28 green, gate green, dashboard up to date,
and its own screenshot lock, written on the kit's browser plumbing. **Its invented list contains no value at all**: *"no colour, no
type size, no bevel, no component drawing is invented - judge rule 3 (colours 396), rule 1 (raised 43 / sunken 17) and rule 8
(checked steps 9, invented 0) are the measurement."* What it invented was three **arrangements** (a matrix grid, a cell whose
whole body is a state, and the refusal's cause and sentence) and the content - every value a kit step.

**So the count across the three finished apps is 1 value rule, 1 value rule, 0 value rules.** The third stranger needed
`.c-well.is-secondary`; the recorder needed `.dot.is-recording`; the routing window needed neither, and drew a 30-cell assignment
matrix with the kit's own latched bevel and no fill of its own. **No agent invented a colour, a type size, a bevel, a component
drawing or a token, and none redefined one.**

**And it sharpened the port finding to a point that matters**: the `bad-overflow` fixture's own comment claims 900px *"is also
past the 800px screen width the same browser reports, so the page overflows however the browser's window happens to be sized on
this machine"* - **true of the browser the suite starts, and false of one it reuses.** The fixture was designed to be
window-size-independent and the reuse loophole defeats the design.

**Five more, all in the consumer documents or the canon:**

1. **Three different ports are named for the same hand run** - `CONSUMING.md` §3 says `--port 9333`, `wire-your-gate.md` says
   `--port 9335` twice, and `gate.sh.example` defaults to 9333. On a shared machine that is one number three ways and a collision.
2. **`CONSUMING.md` §3's literal command does not run from where §1 puts you**: §1 unpacks into `<your folder>/design/`, §3 prints
   `node conformance/run.mjs --app index.html`, and that resolves only from *inside* `design/` - `Cannot find module`, exit 1.
   `conformance/README.md` prints the other spelling (`node design/conformance/run.mjs` from the root). **Both are right in their
   own cwd and neither says which cwd it means.**
3. **Four documents are cited as authority and are not in the tarball, with no "does not travel" note** - unlike `scripts/*`,
   which the docs do label. `SHARING_THE_KIT.md` (`CONSUMING.md:5`), `DESIGN-SYSTEM-ROADMAP.md` (`conformance/README.md:14`),
   **`design/CANON_PLAN.md` cited in three kit files** (`tokens.css:108`, `layout.css:49`, `components.css:237`), and
   `docs/HANDOFF_DESIGN_SYSTEM.md` (`UI_SYSTEM.md:298`).
4. **The canon ships three inert tab buttons with no handler**, against the kit's own §7.1 (*a control must work or say why not*),
   and **both obvious repairs are decisions no one can settle from the tarball**: making them work needs a screen switcher the
   kit does not name, and one that hides a card blinds the judge - the kit's own recorded trap, where a folded card made the
   judge print `RULE 2 · PASS · checked numbers 0`.
5. **The kit's own judge sets the theme by toggling a class, not by pressing the window's control**, so its dark pass photographs
   `Theme: light` on a dark page. **Three agents have now found this independently**, and two of them fixed it the same way: press
   the control, and require the page to end in the theme asked for.

**Still owed by the parent, and it is mine**: `CONSUMING.md:28-34` is a ```sh fence whose first line is prose - **inserted by the
parent tonight, above the three real commands and inside the fence**, so the block cannot be pasted into a shell. It travels with
the artefact re-cut the viewport fix will require anyway.

### Four blind adopters, four domains, and NOT ONE reached into a page-local stylesheet (2026-10-08, the experiment's result)

Four agents built apps from the 1.4.2 tarball alone, in four domains, unable to read each other or this repository. **All four
report `CONFORMANCE OK · 0 failures · 10 of 11 rules checked`**, each with a green gate, a self-test at 28, and a drift row at
1.4.2.

| app | invented value rules | reached into a page-local `<style>` |
|---|---|---|
| console panel (the third stranger) | **1** - `.c-well.is-secondary` | 1 |
| multitrack recorder | **1** - `.dot.is-recording` (`--gold`, a kit value) | 1 (plus four rules inherited from the reference window) |
| patch and routing | **0** - three arrangements only | 1 (`.c-well.is-secondary`) |
| spectrum analysis | **0** - one drawing (`.target-mark`) and one number (`width: 2px`) | **NONE** |

**And the fourth's own words are the answer to the question this experiment exists to ask**: *"Did you have to reach into a
page's own stylesheet for a drawing or a value? The answer is no - and that is a positive finding about kit 1.4.2."* It explains
why: `components.css:480-488` records adopting the three shape declarations it previously forced consumers to copy out of the
reference window's page - the confirmed edge, the dashed unknown edge and the hollow dot - **and this agent took all three from
the kit.** The same fix that the third stranger and the recorder both verified by deleting their inherited copies.

**And the one drawing it invented, it invented honestly**: a threshold mark, `.target-mark`, because the kit names `.c-meter` and
no mark of any kind, using `--ink` **because §5 gives no colour to a reference and it refused to borrow one of the four state
meanings.** Its only invented number is a 2px hairline.

**Four defects it found that the other three did not:**

1. **`gate.sh --help` prints ONE line of the ~60-line header it promises** (`sed -n '2,/^#$/p'` stops at line 3 because line 3
   is already a bare `#`), measured on a fresh unpack. **The flag exists and does not do what its own file says.**
2. **The gate as shipped can never print `gate: OK`** - it ends `exit 3 — INCOMPLETE` with the lock as its only skip. That is
   documented and honest, but it means the artefact's own gate is red-by-design out of the box, and a consumer's first run of it
   looks like a failure.
3. **The template's command and the dashboard's column cannot both be satisfied**: `gate.sh.example` runs `run.mjs` **without
   `--record`**, so the drift dashboard prints `never` (*"that is not a pass"*) for anyone who wires the template as shipped.
4. **`adopt/AGENTS.snippet.md` point 2 gives the load-order hrefs with no `design/` prefix**, while step 6 and `CONSUMING.md`
   §1b both require it - **and that snippet is the text that gets pasted into a consumer's instruction file, i.e. the text that
   outlives the session.**

**Plus two it shares with the others**: step 5 tells the consumer to copy a convention from `design/screens/README.md`, **which
does not travel**, and the flag saying so lives in a different file; and `components.css`'s window does not guard `localStorage`
where the kit's own suite does (`collect.mjs:510`), so a window that copies the reference window's switch throws where storage is
refused - against §11.5, *a control works or says why not.*

### Corrections appended 2026-10-08, after the viewport fix landed (the four stale sentences the re-cut of 1.4.2 revealed)

**This section is appended, never edited into the paragraphs it corrects.** Those paragraphs are photographs of the tree as it
stood when they were written, and four clauses in them are now false in the present tense. The rule this file already carries:
a photograph of the past is not a lie, but a photograph presented as the present is.

1. **`:585-586` - "the suite has no viewport control" is false now.** The sentence reads *"the suite has no viewport control
   (`grep -rc setDeviceMetricsOverride design/conformance/` returns 0; `grep -rn Emulation design/conformance/` returns 0
   occurrences)"*. Measured at HEAD `2fc10bce` (2026-10-08): `grep -rc setDeviceMetricsOverride design/conformance/` now totals
   **6** across five files (`collect.mjs` 1 - the declaration and the forced call, `run.mjs` 1, `rules.mjs` 1, `README.md` 2,
   `fixtures/bad-overflow.html` 1), and `grep -rn Emulation design/conformance/` returns **6 occurrences**. The suite declares
   `VIEWPORT = { width: 756, height: 469 }` (`collect.mjs:49`) and forces it on every tab with
   `Emulation.setDeviceMetricsOverride` **before a page is loaded** (`collect.mjs:139`), so `756x469` is a declaration now and
   not whatever window the browser on the port happened to have. The rest of the paragraph - the 1440x1000 comparison and its
   table - is a measurement of the 756 default and is untouched.

2. **`:1078-1079` - "The root fix is in flight" is false now: it landed in `2fc10bce`.** The suite declares its own viewport as
   described above, and `756x469` did stay the declared size, so every count and allowance in this tree taken at it is still
   comparable. The mechanism the paragraph describes - the gate template's default port shared with a hand run, the foreign
   Chrome at `--window-size=1280,900`, the `bad-overflow` fixture fitting and the self-test printing `MISSED` - is the defect the
   declaration closes; it is re-measured after the fix in the acceptance test at the end of this section.

3. **`:890-895` - "both stay red" is false now: both were fixed the same day and neither is red.** The record said `index.html`
   overflowed by 187px (`div.master-stats` reaching 943 against the suite's 756) and `ltc.html` by 71px (`div.transport` reaching
   827), and that `design/conformance/allow.mjs` was deliberately left untouched so "both stay red where a reader can see them".
   Measured today with the kit's own judge, in a foreign browser this agent started at 1280x900 on a checked private port and
   forced into the suite's declared 756x469:
   - `desktop/ui/index.html` - `RULE 11 · PASS · checked viewport width 756 · widest scrollWidth 756 · excess 0`. The run still
     exits 1, but on the **pre-existing rule 1 (71) and rule 3 (383) findings** this document already records, not on rule 11.
     Fixed by `a3bf2768` (*fix(index): the master header wraps below 942, so the page fits at 756*).
   - `desktop/ui/ltc.html` - `RULE 11 · PASS · checked viewport width 756 · widest scrollWidth 756 · excess 0`, and the whole run
     is **`CONFORMANCE OK · 0 failures · 9 of 11 rules checked · 2 not judged (rule 6, rule 7)`**, exit 0. Fixed by `2f6376f1`
     (*fix(ltc): the header wraps below 840, so the window fits at 756*).
   So "both stay red" is a photograph of the tree between rule 11's landing (`42bfde37`) and those two fixes.

4. **`conformance/README.md:43` carried the same stale present tense** - *"measured, `desktop/ui/index.html` is
   `documentElement.scrollWidth` 943 against `innerWidth` 756"*. Corrected in place (this is a rule's prose, not the record of a
   run): the figure is dated to when rule 11 landed, and the clause now records that both pages were fixed the same day
   (`a3bf2768`, `2f6376f1`) and that rule 11 reads `excess 0` on both.

5. **`adopt/wire-your-gate.md:29` was overstated** - *"If another process owns the debugging port, two runs fight and both lie."*
   Corrected in place. What is still true: two runs sharing a browser can **fight over the browser** - one may close a tab, or the
   browser itself, under the other's run, and a run killed that way measures nothing. What is no longer true: that they **lie
   about layout**, because the suite forces its own declared viewport on every tab before a page is loaded, so a browser another
   run started cannot change what rule 11 sees. The private port remains the rule.

**Why 1.4.2 does not move.** This is one unpublished cut. `design/VERSION` stays **1.4.2** because the regeneration, the clause
corrections and the re-cut tarball are all content *inside* the same cut, and a second bump would be the "content under a stale
number" defect in reverse - a new number over content nobody has consumed.

**The acceptance test, measured on the re-cut, with a foreign browser present** (2026-10-08). The re-cut
`wing-controller-design-1.4.2.tar.gz` (`sha256 4000457164115a9c2baf89d116de2acc280b8f1f0e1881140f27f513f0fbe563`, beside it the
published `.sha256` with the same digest) was unpacked into a clean `/tmp` directory and, **from inside the unpacked copy**,
`conformance/self-test.mjs` was run against a foreign Chrome this session started at `1280x900` on port **`9337`**
(`--headless=new --window-size=1280,900`, never 9223; the suite's banner says `every fixture is forced into it, so a reused
browser cannot change a fixture's verdict`). The same foreign browser was used for both halves, so "whose browser answered" is
not a variable.

- **Before** - the same foreign browser, the pre-fix revision `a47a8825` (which has rule 11 and no viewport control, measured to
  have none: `grep -rc setDeviceMetricsOverride design/conformance/` reports nothing nonzero there):
  `self-test · bad-overflow.html → MISSED (no rule 11 overflows-viewport naming "section#wider-than-the-window")`, beside
  `the suite exited 0 on a known-bad fixture` - exit 1, `SELF-TEST FAILED · 2 problem(s)`.
- **After** - the unpacked re-cut: `self-test · bad-overflow.html → FAIL rule 11 overflows-viewport ·
  section#wider-than-the-window · documentElement.scrollWidth is 908px against a 756px viewport: 152px too wide; the furthest
  right element is section#wider-than-the-window, reaching 908px` - exit 0, `28 checks proved the suite can fail`,
  `WING_CONFORMANCE_SELF_TEST_OK`.
- **And the page, not only the fixture**: `node conformance/run.mjs --app reference-window/index.html --port 9337` from inside
  the unpacked copy, with **no seeding** (no `conformance/run.json` travels and none was written; the shipped
  `conformance/allow.mjs` is the one read) and the same foreign browser, printed
  `CONFORMANCE OK · 0 failures · 10 of 11 rules checked · 1 not judged (rule 7)`, exit 0, with rule 11
  `PASS · checked viewport width 756 · widest scrollWidth 756 · excess 0`.

**And the artefact itself**: `node scripts/test-design-kit-package.mjs` printed
`design kit package: 56 file(s), version 1.4.2, 56 compared byte for byte (1518943 bytes), tarball sha256
4000457164115a9c2baf89d116de2acc280b8f1f0e1881140f27f513f0fbe563` - two builds of the tarball byte-identical, and the shipped
`design/dist/` copy equal to them.
