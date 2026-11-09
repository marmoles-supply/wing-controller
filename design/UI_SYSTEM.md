# The WING CONTROLLER interface system

> **20 October 2026 — production adoption:** Start with `workstation/README.md`
> (relative to the kit root) and its working template/catalogue. The legacy
> three-sheet plan and simplified one-pair bevel described below are retained
> for existing consumers; they are not the target for new WING-equivalent GUIs.
> Production chrome and extracted surfaces take precedence. See the coverage
> inventory for settings, popups, secondary windows and runtime integration.


**Version 1.0.0 · 2026-10-07 · extracted from the shipped application (v0.2.92)**

This folder is the interface language of WING CONTROLLER and of anything that should look and behave like it: the
application, its secondary windows, its plugins and the applications other agents are building beside it. It exists
because those projects must agree about a bevel, a palette and a sentence — and because an agreement kept in five places
is not an agreement.

**Read this document before drawing a control. Link the kit — `tokens.css` for the values, `components.css` for the
drawings — before writing a colour or a rule.**

---

## 1. What this is, and what it is not

| It is | It is not |
|---|---|
| The **values** (`tokens.css`, `tokens.json`), the **components** (`components.css`), the **language** (this document) and the **rules of engagement** | A framework, a component library with JavaScript, or a build step |
| Plain CSS custom properties, plain HTML and plain CSS rules: it works in a Tauri window, in a web page, and in a plugin | A thing to `npm install`; there is nothing to compile |
| One home for the palette, with a **test that fails when a copy drifts** | A copy of a palette that each project keeps for itself |

There is no JavaScript here on purpose. The application behaves the way it does because of its own modules
(`desktop/ui/cue-list.js` and its neighbours); this folder only decides how things **look**, how they are **named**, and
what an operator is therefore allowed to **expect**. `components.css` is the one part of it that is not a value: it is
the kit's **drawing** of a button, a field, a well, a chip and the rest, in plain CSS, so that a project links it
instead of writing the same control again. It is hand-written rather than generated — a token is a value and a
component is a decision about structure — and `design/specimen.html` is the page that draws itself with it.

## 2. The language, in one paragraph

The application is a **desk instrument**: a matte silver face with raised controls, sunken wells where numbers live, and
the classic window furniture of a machine built to be operated rather than admired. Two kinds of surface exist and only
two: **face** (raised, for anything the operator can press or type into) and **well** (sunken, for anything the instrument
reports: a clock, a meter, a count). Text is either **ink** (what matters), **muted** (what explains) or **dim** (what is
absent). Colour is never decoration: each colour in this system means exactly one thing, and §5 lists them.

## 3. The two themes, and the rule that keeps them honest

Light is `:root`; dark is `body.theme-dark`. Dark re-declares **only what changes** — fewer than thirty values — and
everything else inherits, which is what stops the two themes drifting apart.

**The trap that has already cost this project once, written down so it costs nothing again.** A token must never be
aliased to another token inside `:root` when the dark theme re-declares the target:

```css
/* WRONG: `--face` freezes to the light #c0c0c0 before the dark rule can reach it. */
:root { --face: var(--win-btn-face); }
body.theme-dark { --win-btn-face: #222527; }
```

This is not hypothetical: the meters window froze exactly so, painted its button in the light classic face against a dark
panel, and lost a `:hover` to a specificity fight with the rule that followed (recorded in the source as visual audit F4).
Alias inside the window, not inside `:root` — or re-declare the alias in the dark block as well.

A secondary window that paints only the light palette is a foreign window in a dark application. If a window is themed,
it follows `wing_theme` in `localStorage` (`"dark"` / `"light"`) through the `storage` event, and it says so in a test.

## 4. Bevels: two shapes, and no third

| Shape | Where | Geometry |
|---|---|---|
| **Raised** | buttons, cards, tabs, anything pressable | `border-top/left: 1px solid var(--line-light)`, `border-bottom/right: 1px solid var(--line-dark)` |
| **Sunken** | wells, fields, readouts, tables, meters | the same pair, reversed |

Three rules follow, and they are what make a window look like this application rather than like a page:

1. **Light before dark.** A raised edge is light on the top-left and dark on the bottom-right. Reversing it is not a
   style choice; it inverts raised and sunken, and an operator reads a sunken button as broken.
2. **One shape per element.** A card is not raised and sunken at once. A well inside a raised card is fine; a raised
   control inside a well is fine; both on one element is not.
3. **The bevel is the state.** Pressing a raised control may sink it; that is the whole animation. Depth is
   information, so it is never decorative and never animated for its own sake.

The application's own count, so a reviewer can see the size of the problem this system exists to solve: `index.html`
carries 167 `inset` shadows, `meters.html` 56, `timecode.html` 6 and `ltc.html` 1, and only `meters.html` uses
`border-style: outset` at all (4 rules). Four windows, three vocabularies.

## 5. Colour has meaning

Never choose a colour for how it looks; choose it for what it says. These are the meanings, and they do not change
between the application, a window and a plugin.

| Token | Meaning | Never |
|---|---|---|
| `--accent` | **selection and focus**: the thing the operator is acting on | as a status colour |
| `--maroon` | **a warning that is not yet a refusal**: something needs attention and the action is still possible | as a failure |
| `--amber` | **unfinished or inherited**: a value that was not set here (an older file, another window, a default) | as a warning |
| `--red` / `--red-bright` | **refusal or failure**: this will not happen | for anything that still works |
| `--green` / `--green-dim` | **confirmed**: the thing happened and was verified | for "probably fine" |
| `--yellow` / `--gold` | **attention, and the meter's warning band** | as decoration |
| `--crt` / `--crt-ink` | **the instrument's own well and phosphor**: a clock, a counter, a decoded value | as a general background. The phosphor is the **same in both themes** — it is the instrument, not the furniture |

## 6. Type, space and the one scale knob

Two families only: `--win-font` for the interface and `--mono` for anything the operator reads as a **value** — a
timecode, an address, a frame count, a channel number. A number set in the interface font is a number that cannot be
compared down a column.

Sizes come from the kit's steps, every one of them derived from the single knob `--meter-scale`. There are two groups,
and they answer two different questions:

- **The interface steps** — `--font-badge`, `--font-xs`, `--font-sm`, `--font-base`, `--font-lg` — are the scale for
  reading an interface. Their `clamp()`s cap at 10/16/18/13/14px, so nothing in this group is larger than 18px.
- **The instrument steps** — `--font-readout` (22px), `--font-readout-lg` (26px), `--font-clock` (30px),
  `--font-clock-lg` (52px) — are the scale for reading an **instrument**: a value the instrument reports, and a
  window's clock face. Their floors are the sizes measured in the application's own windows, so naming them changed no
  pixel. A reading from across a room is what this group is for; a size the knob cannot reach is a size the kit does
  **not** name, and a window that needs one declares the deviation with its reason.

A screen that needs bigger type raises the knob; it does not invent a pixel size. A **document** hierarchy is not an
instrument reading and stays out of the scale — the operator's guide's 17px chapter title is a declared deviation for
exactly that reason. Spacing is a four-pixel grid, named `--space-1` … `--space-6`.

**The knob's own base, and what it is not.** The kit publishes the base in `design/tokens.css` (`--meter-scale: 1.25`
since 2026-10-08). It is **1.25 because that is the scale the application was drawn at**: at 1.25 the interface steps
give 8.3 / 9.3 / 10.4 / 11.0 / 12.125 against the windows' own drawn 9 / 10 / 11 / 12, reproduced within 0.3px, while
at 1 every window was uniformly about half a pixel smaller and the guide's prose read worse. A consumer that wants a
different base re-declares `--meter-scale` and says so; it does not get a second scale. **`--meter-scale` is a type
knob and only that** — a window that also wants to zoom its own instrument geometry keeps a separate property for it
(`meters.html` and `index.html` use `--meter-zoom`), because two controls sharing one variable is how raising the type
knob ends up resizing a meter.

## 7. Rules of honesty (the part that is not about looks)

An interface in this family is allowed to be dense, technical and plain. It is **not** allowed to mislead. These rules
come from this project's own record, and they are the part of the design system that outranks taste.

1. **A control works, or it says why not.** A disabled button is a promise; a placeholder is a lie with a date on it. If
   something cannot do its job yet, it is not on screen.
2. **Nothing fails silently.** `sent`, `confirmed`, `unconfirmed` and `unknown` are four different sentences and they
   keep four different words.
3. **A value is either sure or it is marked.** Where a judgement cannot be made, say **unknown**; never render it as
   "fine". Three states are the minimum for anything a machine decides: yes, no, and *nobody can tell*.
4. **A report must not lie about what was done.** If the packet carries `-1` and the card prints the stored value, the
   report is the defect — even when the machine behaved perfectly.
5. **The state that only applies later says so.** A setting read once at open either applies itself or says that it
   applies on the next open.
6. **What a window writes, it shows.** If a window is about to save a value it did not display, that is a defect.

## 8. Vocabulary

Use these words, and only these, for the furniture. An operator who reads "band" in one window and "strip" in another is
being taught two systems.

**A row here is a thing, never a layout of things.** Every word in the table names furniture the operator can point at
— a well, a chip, a band — so a new **drawing** of one earns a row (`meter`, added 2026-10-08) and an **arrangement** of
them does not: `components.css` names its arrangements (`.card-head-row`, `.section-head`, `.tab-row`) and this table
stays silent, because the kit names furniture and never an arrangement (§10). A card head that carries an action is
therefore a class in the component layer, not a word here.

| Word | What it is | Not |
|---|---|---|
| **window** | a top-level surface with its own title bar | a panel, a dialog |
| **panel** | a titled region inside a window | a window |
| **card** | a raised, self-contained block inside a panel | a row |
| **row** | one item of a list, with its own controls | a card |
| **well** | a sunken area holding a value the instrument reports | a field |
| **meter** | a bar showing a level the instrument reports, on the kit's own ramp | a chart, a gauge |
| **field** | a sunken area the operator types into | a well |
| **chip / badge** | a small raised label attached to a row: a state, a count, a section | a button |
| **band** | a full-width strip that carries one message (a rehearsal, a warning) | a toast |
| **rail** | a narrow column used to navigate a list bigger than the screen | a menu |

## 9. How this folder stays honest

A design document that is written by hand rots the moment the code changes, so the parts of it that are **values** are
not maintained by hand:

1. `design/tokens.json` is the **single source a human edits**; `design/tokens.css` is **generated** from it by
   `scripts/generate-design-tokens.mjs`, so the CSS form carries the header that says it is generated.
   `scripts/test-design-tokens-generator.mjs` fails when the two disagree — the roadmap's acceptance test (delete the CSS,
   regenerate, byte-identical) is pinned there, not pasted into a document. **Built 2026-10-08 (ITEM 1).**
2. `desktop/ui/design-tokens.css` is the copy the application ships (the packaged frontend is `desktop/ui`, byte for byte
   — a file outside it is not shipped at all). `scripts/sync-design-tokens.mjs` writes that copy from the generated CSS,
   and `scripts/test-design-tokens.mjs` fails when the two differ — the same pattern, and the same reason, as
   `version.json` and `desktop/ui/version.js`. **Built 2026-10-07**, and given teeth: a hand edit to the copy is named,
   and a token added to one form of the kit and forgotten in the other is named with its value.
3. The two forms carry the same values, compared in **both** directions against inputs the test controls — 50 light
   tokens, 22 dark and 28 theme-independent (46 / 22 / 24 on the day the comparison landed, before the four instrument
   steps of §6 were added on 2026-10-08).
4. `design/components.css` is the one part that is **not** generated, because a component is a drawing and not a
   value; what keeps it honest is the page that uses it. `scripts/test-specimen.mjs` fails when the specimen does not
   link it, when the link does not come before the page's own `<style>`, when the page declares a class the layer
   already draws (**link it, do not retype it**), or when the layer carries a literal colour or reaches outside the
   kit. **Built 2026-10-08**, and its teeth were proved by hand: each of those four guards was made to fail with its
   own sentence on a byte copy, and the copy was restored byte-identically before anything was built on top of it.

## 10. How another application or plugin consumes this

**The load order is the contract, and it is four lines: the values, the components, the plan, then your own sheet.** The
kit is linked **before** your rules so that a deliberate override still wins — and that is a knife with two edges, both
of which have already cut. A rule of yours **before** the link loses silently: the kit draws over it and nothing says
so. A rule of yours **after** it wins silently, and the same control ends up drawn by whichever sheet happened to come
last rather than by a decision anybody made. That is what a sibling application measured and described in one sentence:
*"no era caché, ni coordinación, ni falta de acceso. Era mi hoja peleándose con la suya."* The answer is neither
order: **delete the control rules the kit now supplies**, and declare the ones you must keep.

```html
<!-- 1. the values, once, before anything else -->
<link rel="stylesheet" href="design/tokens.css" />
<!-- 2. the kit's components, drawn from those values: buttons, fields, select, wells, cards/panels, labels, readouts -->
<link rel="stylesheet" href="design/components.css" />
<!-- 3. the kit's plan: the master header, the two-column layout, the stacks, the sticky column, the folded card -->
<link rel="stylesheet" href="design/layout.css" />
<!-- 4. the theme the operator chose -->
<script>document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.toggle('theme-dark', localStorage.getItem('wing_theme') === 'dark');
});</script>
```

**Measured 2026-10-08, by an agent adopting this kit from its tarball:** the one-liner above **throws where this
document prints it**. A `<script>` in `<head>` runs before the body exists, so `document.body` is `null`:
`Uncaught TypeError: Cannot read properties of null (reading 'classList')`, and the class is never applied. **The
wrapper is the fix, not a style choice** - and it is written here because this page is where a consumer copies it
from, so a snippet that cannot run is worse than no snippet.


```css
/* 5. your own rules come LAST. Raised: anything pressable. Sunken: anything reported. Never both. */
.my-own-arrangement { display: grid; grid-template-columns: 1fr 2fr; }
```

**And `layout.css` is offered rather than imposed, which is the one place this document's own rule bends.** §1 says the
kit names furniture and never an arrangement, because a kit that decided every application's layout would make them
identical where variety is the point. `layout.css` is the application's **own** arrangement made portable, and it exists
because of a measurement rather than a preference: a consumer adopted the values and the drawings, deleted every control
rule of its own, passed the judge with **0 failures in both themes** — and was rejected four times by the owner, because
it was composing the plan by guessing and the four rules that would have answered it lived inside this repository's
32,000-line `desktop/ui/index.html`. So: **link it if it fits, delete what does not, and if your own ordering is right,
keep it and declare it** with its reason and its reach like any other deviation. What is no longer acceptable is
deriving the plan from nothing: `design/layout.html` is the composed page to fork. One cost is named in that file's own
header and belongs here too — its class names (`.stack`, `.layout`, `.column-resizer`, `header.master-header`) are
page-wide names, so a page that already uses one for something else must rename its own or not link the sheet.

`components.css` addresses each control **twice from one set of declarations** — once by the kit's class (`.c-btn`)
and once by the element the kit draws (`button`) — so a page that already has plain `<button>` and `<select>` elements
deletes its own control rules and gets the kit's drawing without renaming a thing. What it does not touch is what the
kit does not draw: a checkbox, a range, a colour well and a file picker keep the platform's own drawing, and the box
model is set on the kit's components rather than with a `*` reset that would move a consumer's layout.

**Rules of engagement.** Take the files and the document; do not take a copy of a palette, and do not retype a
component. Say which version you took (`design/VERSION`). If your application needs a value that is not here, **add it
here first** and tell this project's session what you added and why — a new colour invented in a consumer is the drift
this folder exists to prevent. If you change one, you are changing the language of every application that follows it,
which is allowed and is a decision: record it with the reason, in this folder's own history. And if a control of yours
genuinely must differ, **declare it in your allowance file with its reason** rather than letting a local rule win by
being later in the cascade.

**And a theme override is a load-order trap of its own.** A `body.theme-dark button { … }` broad enough to outrank your
own component rules does not just paint differently: **it hides the difference between a defect and a decision.**
Measured in this application on 2026-10-08 — the dark rule (specificity 0,2,1) beat `button.danger`'s white (0,1,1), so
the two emergency stops were grey-green in Stealth Dark and the refusal red in the light theme, and the check for a
frozen value saw nothing wrong because the two themes differed *by accident*; the same rule was hiding disabled buttons
that wore their enabled ink. Remove the broad override and both defects appear at once.

## 11. Checklist before a new screen is called done

- [ ] Every raised element is light-before-dark; every sunken one is the reverse; nothing is both.
- [ ] Every value the operator reads as a number is `--mono`, and every one of them sits in a well.
- [ ] No colour is used outside its meaning in §5.
- [ ] Both themes were looked at, and nothing froze to the light palette (see §3's trap).
- [ ] A control that cannot work is absent, not greyed; a refusal names its cause in the operator's own words.
- [ ] Anything a machine decided has three states, not two.
- [ ] The window's own words come from §8.
- [ ] Every text size is one of the kit's steps — the five interface steps **and** the four instrument steps — and
      `--meter-scale` is the only thing that moves them: a screen that needs bigger type raises the knob, and a size
      not even the instrument steps reach is a declared deviation with its reason, never a pixel written into the page.

These eight are no longer only checkboxes. `design/conformance/` runs them against a **rendered** page - computed styles,
geometry, visible text, never source text - and `self-test.mjs` proves the suite **can fail**, against the `fixtures/`
that are wrong on purpose. **They are the operator's rules, and they are the eight boxes above; the suite implements ten
rule functions.** Rules 9 (`load-order`) and 10 (`retyped-plan`) are technical contracts about the sheets a page links
and the plan it composes, not operator checkboxes: rule 9 asks that the kit is linked in one order (the values, then the
components, then the plan) and rule 10 that the plan's tracks are the kit's rather than retyped in the page. **Only the
first eight are the boxes above**, and a page's report counts the ten rule functions (`N of 10 rules checked`): the ten
is a fact about the suite and never a claim that §11 carries ten checkboxes, which is what a reader who met both numbers
used to have to measure. Rule 7, the vocabulary, is deliberately **not** checked there and says so, because §8 is about
meaning and no computed style tells a machine whether two words mean the same thing. Rule 8 is the one that looks at the
page twice, at `--meter-scale` 1 and at 1.5, because a single-size photograph cannot see a ramp wearing the kit's names
and a proportion can: measured on a consumer that passed with 0 failures in both themes while every text in its interface
was set at a size the kit never gave it.

## 12. Status, so nobody is misled

**Decided and built:** the tokens, this document, the machine-readable form, the native form — and, since 2026-10-08,
the **component layer** (`components.css`), which is the drawings rather than the values, and the **composition layer**
(`layout.css` with `layout.html`), which is the plan the drawings are arranged by. The specimen links the component
layer and draws itself with it, and `scripts/test-specimen.mjs` fails if it stops doing so; `layout.html` links all
three sheets and `node design/conformance/run.mjs --app design/layout.html` judges it on the rendered page
(`CONFORMANCE OK · 0 failures · 6 of 8 rules checked · 2 not judged (rule 6, rule 7)`).

**Corrected 2026-10-08, because the paragraph that stood here had gone stale within a day and a stale summary is the
first thing this design system forbids.** It said the application still carried its own `:root` in every window and
listed the copy, the synchroniser and the drift test as work still to do. Measured now: **all five windows link the
kit** (`guide.html:11`, `index.html:15`, `ltc.html:13`, `meters.html:12`, `timecode.html:12`), each declares what it
took, and `desktop/ui/allow.mjs` carries its deviations with a reason each. The measured state lives in `AGENTS.md`'s
own paragraph and in `docs/HANDOFF_DESIGN_SYSTEM.md`; do not read a count from this section — run
`node design/conformance/run.mjs --app <page>` and read the number it prints, because these move as the migration
lands.

**One divergence measured while writing this, kept visible rather than smoothed over.** The four windows do not agree on
every value. `--win-font` ends `Geneva, sans-serif` in the instrument windows (`timecode.html`, `ltc.html`) and
`Geneva, Arial, sans-serif` in `meters.html`; the kit takes the instrument value, and `Arial` returns only if a machine is
found where it matters. Everything else the kit calls canonical was compared value by value against the application —
16 light tokens and 13 dark ones, no other difference — which is the check that caught this one, and the reason the drift
test in §9 is not ceremony.

**And the gap this section must not smooth over — corrected 2026-10-08, because the paragraph that stood here had gone
stale the same day it was written, which is the failure this document warns about everywhere else.** It said the
component layer existed and **no** window linked it (`grep -l 'components.css' desktop/ui/` returned nothing, measured
the same morning). Measured again when the composition layer landed:
`grep -l 'components.css' desktop/ui/*.html` returns **five** — `guide.html`, `index.html`, `ltc.html`, `meters.html`,
`timecode.html` — each with its own commit and its screenshots refreshed in it, and each declared where it kept
something.

**The same gap, one layer on, and it is open on purpose: `layout.css` exists and no window links it yet.** Measured the
same way, `grep -l 'layout.css' desktop/ui/*.html` returns nothing. The five windows still carry the plan inline in
their own sheets — `.stack`, `.builder-column`, `.layout`, the master header and the seam — which is exactly the
duplication `layout.css` was written to end, and it has no mirror in `desktop/ui/` for the same reason the component
layer had none before its migration: a mirror nothing links is a second copy to keep in step. Making a window link it is
a real change with the screenshot lock attached, it belongs in its own commit per window, and `design/adopt/README.md`
step 6 records the state and the reasoning rather than leaving it to be discovered. Until then the canonical
`design/layout.css` is where the plan is read from, and what `design/layout.html` links.
