# Design system: what to build next, so every app looks the same

> **From:** the owner, via the control-app session (`sesion-wing-edit`, `openwing`)
> **To:** the session that owns `wing-controller/design/` (the design system's maintainer)
> **Status:** a request and a specification, not a report. Everything in it is unbuilt unless it says *done*.
> **Where it lives:** `wing-controller/design/` — beside the values it is about. Any agent in any project can read it.

---

## 1. What the owner asked for, in his words

> *"I want all my apps to have the same style and UI, but I don't know how to do it. How could I coordinate all the agents so the visual results come out identical?"*

The honest answer, and the reason this document exists:

**Identical visual results are not achieved by coordinating agents. They are achieved by removing their ability to decide.**

An agent cannot be relied on to follow a style guide. Style rules are prose, and prose does not block a commit. The
coordination happens in the *artefact*: in a generated file, a version number and a red test — never in an instruction
that everybody promises to remember.

**This is not a theory. The control-app session is the proof.** With 474 tests green it did all of this:

| What it did, while knowing the kit existed | Which rule it broke |
|---|---|
| `:root` dark, when the kit says `:root` is light | the two-theme model |
| Its own storage key for the theme preference | the shared preference |
| **Aliased a token to another token inside `:root`** | the kit's own *"visual audit F4"* trap |
| Overwrote a local stylesheet declaring **13 colours of its own** | *"do not take a copy of a palette"* |
| **33 tokens that did not exist**, so borders and padding fell to their initial value **silently** | nothing checked |
| `var(--bevel-up)` for every panel — **the token does not exist**, so the boxes had **no bevel at all** | nothing checked |
| **Two of four tabs did not accept the theme**: 9.25:1 between adjacent surfaces | §3, and it was the owner's *"everything clashes"* |

It **read** the kit. It **knew** it existed. It shipped all of it anyway. Then it wrote tests for each one, and every
single one would have been caught by the conformance suite this document asks for.

---

## 2. What already exists (done — do not rebuild it)

Verified in this folder on 2026-10-08:

| Artefact | State |
|---|---|
| `design/UI_SYSTEM.md` | **done** — the language, bevels, colour meanings, honesty rules, vocabulary, and the 7-point acceptance checklist in §11 |
| `design/tokens.css` | **done** — the canonical values, light and dark (`VERSION` = `1.0.0`) |
| `design/tokens.json` | **done** — the same values for a non-CSS consumer |
| `design/README.md` | **done** — what the kit is, and the rule *"when you copy it: say which one you took"* |
| `scripts/lib/design-tokens.mjs` | **done** — imports, name conversion, `tokenDisagreements()`, `renderShippedCss()` |
| `scripts/sync-design-tokens.mjs` | **done** — writes `desktop/ui/design-tokens.css` from the canonical file |
| `scripts/test-design-tokens.mjs` | **done** — fails when the shipped copy drifts or the two *forms* disagree |
| A foreign consumer | **done** — the control-app session added `--meter-ramp` to `tokens.css` **and** `tokens.json`, with its reason in the token's comment (committed with provenance `3dddd469`) |

**Also worth stating plainly, because it undermines the system:** `desktop/ui/design-tokens.css` ships inside the
application bundle and **the application does not link it**. The kit's only real consumer today is a foreign app.
A kit its own owner does not use is a kit nobody else will respect.

### Measured on 2026-10-08, before planning that link: the owner's app already agrees with the kit, to the value

Nothing in `desktop/ui/*.html` linked `design-tokens.css` (confirmed by grep; see the correction below). The application
declares **63** custom
properties of its own, and **every one of the kit's 46 tokens is among them - all 46, no exceptions, and all 46 carry a
value the kit also carries**. Zero missing, zero disagreeing. That is not a coincidence: `tokens.json` records its own
`source` as *"extracted from desktop/ui/*.html (2026-10-07, v0.2.92)"*. The kit is a copy of the application, and the two
have not drifted since.

**Two consequences, and the second is the work.** Both are written from the pre-link state the measurement above
describes, and both were acted on:

1. **Linking the kit today is visually safe** - the values are the same, so nothing moves. That is why it is the right
   moment to do it: a link added while a migration is pending would be untestable.
2. **Linking alone changes nothing about authority.** The application would still declare all 46 values itself, and its
   declarations would still win. To make the kit the single source, the **46 duplicate declarations have to come out of
   the application** and the linked file has to supply them. That - not the `<link>` element - is what "the kit's own
   application links the kit" has to mean, and it is the largest single piece of work in this document. **It was done**:
   the 20 `WINDOW ADOPTS THE KIT` declarations came out with the link, window by window, and the 9 that had to stay are
   declared (§8, §4f; it was 11 until `meters.html` adopted the kit's `--red` and dropped its own `#e74c3c`, measured
   2026-10-08).

**Corrected 2026-10-08, after the link (the measurement below is kept as the pre-link one its heading dates):** the
"nothing links the kit" and "all 46 duplicated declarations are still there" statements are no longer true. All five
windows link `design-tokens.css` before their own `<style>`, the `WINDOW ADOPTS THE KIT` declarations were removed window
by window, and the 9 that remain are declared with reasons in `desktop/ui/allow.mjs` (§8, §4f; 11 until `meters.html`
adopted the kit's `--red`, measured 2026-10-08). The caveat below still
stands as the reason the strict comparison exists.

**The caveat on that measurement, stated because it bounds what it proves.** The comparison was **lenient**: it asked
whether the kit's value for a token appears *anywhere* in the application, which passes whenever the app declares that
token in both `:root` and `body.theme-dark`. It therefore proves the values are **present**, not that the **theme mapping
is identical** - a token could carry the kit's light value in the app's dark block and this check would not notice. The
strict version - compare light against light and dark against dark - is what the conformance suite (ITEM 3) and the
declared deviations (ITEM 5) exist to do, and it is the check that must be in the tree before the 46 declarations are
removed.

---

## 3. The five gaps

### GAP 1 — Two sources of truth, kept in step by hand

`tokens.css` and `tokens.json` are **siblings**. They agree because a test compares them, not because one is derived
from the other. Every added value has to be written **twice, by hand, in two spellings** — and the CSS one is the
canonical one, which is backwards for anything that is not CSS (a mobile app, a plugin, a build script).

**Measured defect, live in the kit right now:** of the **16 keys** in `tokens.json`, **15 are `camelCase`**
(`winFont`, `scaleKnob`) and exactly one is not: **`meter-ramp`**. A hyphenated key. It works, because the comparison
normalises names, but it breaks the file's own convention and it was introduced by a foreign consumer because nothing
enforced the spelling.

### GAP 2 — The comparison was one-way — **DONE (2026-10-08)**

**Closed in code by `ea7ebc0d`, and pinned by a contract in `bf694d1a`.**

`tokenDisagreements()` in `scripts/lib/design-tokens.mjs` walks **both** directions now: a value in the CSS missing from
the JSON, *and* a token in the JSON with no CSS entry — the direction a JSON-first workflow produces constantly.

What the second commit added is the part that was actually missing, and it is worth reading before trusting any green
run of this kit again: **the assertion that existed could not tell whether the reverse direction existed at all.** It ran
the comparison over the two live files and demanded `[]`, and it still demanded `[]` after the JSON → CSS half was
deleted from the library. It proved the files agreed; it never proved a direction was checked. Two directions are now
pinned against inputs the test controls, and the pin was **proven by breaking it on purpose**: with
`comparable(fromJson[...])` replaced by an empty map in the reverse half only, `node scripts/test-design-tokens.mjs`
exits 1 and names the defect — and every message it printed came from the *other* direction, which is the proof that the
broken one reported nothing.

The roadmap's own acceptance test was run as written: a key added to `tokens.json` and not to `tokens.css` makes the test
fail, naming it (`tokens.css has no --roadmap-item-two-probe for tokens.json's #123456 (light)`).

### GAP 3 — The acceptance checklist is prose

`UI_SYSTEM.md` §11 has its points, and they are the right ones. They are **checkboxes in a document**. Nothing can run
them, so nothing fails when they are violated — which is how the control-app broke four of them at once.

The rules, for reference:

1. Every raised element is light-before-dark; every sunken one is the reverse; nothing is both.
2. Every value the operator reads as a number is `--mono`, and every one of them sits in a well.
3. No colour is used outside its meaning in §5.
4. Both themes were looked at, and nothing froze to the light palette (§3's trap).
5. A control that cannot work is absent, not greyed; a refusal names its cause in the operator's own words.
6. Anything a machine decided has three states, not two.
7. The window's own words come from §8.

### GAP 4 — No shared visual reference

There is no way for an agent that cannot see a screen to *look at* the system, and no captioned reference of the real
application. `UI_SYSTEM.md` names `design/specimen.html` and `design/reference/` as next steps (its §12, points 3–4);
neither exists.

### GAP 5 — There is no way to detect drift

Nobody can answer *"which of my apps is behind, and what did each one deviate on?"* without reading every repository.
Every app that copies the kit takes version `1.0.0` and then ages invisibly.

---

## 4. What to build

Five work items. Each one has **what**, **where**, and **the acceptance test** — the test is not optional, because the
whole point is that the rule must be able to fail.

---

### ITEM 1 — Make `tokens.json` the single source, and generate the CSS from it — **DONE (2026-10-08, `c3ad27f5`)**

Verified by the parent with the roadmap's own two acceptance tests: `rm design/tokens.css` + the generator restores it **byte-identical**, and a changed value in the JSON changes exactly that line in the CSS. Both restored and re-verified.

**What.** `tokens.json` becomes the one file a human edits. `tokens.css` becomes **generated**. `VERSION` keeps being
the version of the kit as a whole.

**Where.** `design/tokens.json` (hand-written) · `design/tokens.css` (generated, with a header saying so, exactly as
`desktop/ui/design-tokens.css` already does) · `scripts/generate-design-tokens.mjs` (the generator).

**Fix while you are in there.**

- Rename the key **`meter-ramp` → `meterRamp`** in `tokens.json`, so all 16 keys follow one convention. Say so in the
  changelog: it is a foreign consumer's value and the rename is the kit's decision.
- Keep `scripts/sync-design-tokens.mjs` working, but have it call the generator rather than compare two hand-written
  files.

**Acceptance test.** Delete `design/tokens.css`, run the generator, and the file comes back **byte-identical** to what
was there. Then change one value in the JSON, regenerate, and the CSS changes with it.

**Migration note.** This reverses the direction of the current canon. Do it as its own commit, and state in the commit
message that the CSS is now the generated form — because every existing consumer reads the CSS, and none of them should
notice anything except the header.

---

### ITEM 2 — Make the two-form comparison two-way — **DONE (2026-10-08, `bf694d1a`)**

The direction existed already; the *test that can fail* is what this item was really missing, and it is in place.

**What.** `tokenDisagreements()` reports, in both directions: a token in the CSS with no JSON entry **and** a token in
the JSON with no CSS entry.

**Where.** `scripts/lib/design-tokens.mjs`.

**Acceptance test.** Add a key to `tokens.json` **and not** to `tokens.css`; `node scripts/test-design-tokens.mjs`
**must fail**, naming it. Prove it by breaking it on purpose and pasting the failure into the commit message — the same
standard the kit already holds itself to (*"both proven by breaking them on purpose"*).

---

### ITEM 3 — Turn the acceptance points into a conformance suite — **DONE (2026-10-08, `688163a9`)**

All the rules are checked on the **rendered page** (computed styles, geometry, visible text), never on source text, with exit codes `0 ok · 1 failure · 2 bad CLI · 3 COULD-NOT-RUN`. **Rule 7 is deliberately not checked and says so**, because §8 is about meaning and no computed style tells a machine whether two words mean the same thing; `--require-all-rules` turns that into a failure for a caller who wants all of them judged. Thirteen bad fixtures plus one good one, and `self-test.mjs` proves the suite fails on the bad ones while the good one stays green - verified by the parent running it: `18 checks proved the suite can fail`.

This is the item that actually delivers what the owner asked for.

**What.** A package any app can run, which imports the kit and checks **that app's rendered interface** against §11.
It must work for a plain-HTML app (no build step) and be usable by a bundled one.

**Where.** `design/conformance/` in this repository, with a documented way to consume it from another project
(a relative import, a copy with its version declared, or a published tarball — pick one and write it down).

**Suggested shape.**

```
design/conformance/
  README.md          how an app runs it, and what it needs from the app
  rules.mjs          one exported function per acceptance point, pure, testable
  run.mjs            CLI: run.mjs --app <path-or-url> [--theme light|dark]
  allow.mjs          the app's declared deviations (see ITEM 5)
  self-test.mjs      proves the suite CAN fail, by running it against known-bad fixtures
```

**The rules, and how each one is checked without a human looking:**

| §11 | Check |
|---|---|
| 1. Light-before-dark, never both | For every element with a bevel: the top/left border colour is the kit's light step and the bottom/right is the dark one, or the reverse — **never a mix**. Fails on any border-radius ≠ 0. |
| 2. Numbers in `--mono`, in a well | Every element whose text matches a number pattern resolves to `--mono` **and** has a sunken parent (field background + reversed bevel). |
| 3. Colour has meaning | Every colour in the app's stylesheets is either a token reference, or on the app's declared deviation list. Fails on any literal hex not declared. |
| 4. Both themes, nothing frozen | Every `var(--x)` in the app resolves in **both** themes. Fails on an unresolvable token, and on a token whose computed value is identical in light and dark when the kit says it should differ. |
| 5. No permanently disabled control; a refusal names its cause | No control carries `disabled` outside a transient, self-describing state. A refused action renders the machine's own reason. |
| 6. Three states, not two | Every machine-decided state carries a value from `yes` / `no` / `unknown`, and is distinguishable **without colour** (word or shape). |
| 7. The vocabulary of §8 | The app's own class and label vocabulary does not invent words the kit already has (window, panel, card, row, well, field, chip, band, rail). |

**Acceptance test.** `self-test.mjs` runs the suite against **two fixtures that must fail** — one with a literal colour,
one with a `--mono` number outside a well — and asserts that it reports them. A conformance suite that has never failed
is a ceremony.

**Important.** Rules must be **executable** and **explainable**. When a rule fails, the message must name the element,
the measured value, and the rule — in the operator's words, not in CSS jargon. The audience is an agent that has to fix
it without being able to see the screen.

---

### ITEM 4 — `design/specimen.html`: the shared visual reference — **DONE (2026-10-08, `7b3608d3`)**

**What.** One page that renders **every** token and **every** component the kit defines, in **both themes**, side by
side, with the token name and its value printed beside each sample. Plus `design/reference/` with captioned screenshots
of the real application under both themes.

**Where.** `design/specimen.html`, `design/reference/`.

**Why it matters more than it sounds.** An agent cannot see a screen. A specimen page is the closest thing to *looking at
the system*: it is the artefact an agent can open, screenshot, and compare against its own output. Without it, "make it
look like the kit" is unverifiable.

**Acceptance test.** Every token in `tokens.json` appears in the specimen, and a check fails when a token has **no**
sample. It must also render correctly with no network access (the kit's own rule: nothing downloaded).

---

### ITEM 5 — Declared deviations, and a drift dashboard — **DONE (2026-10-08, `8eecafd0`)**

The dashboard answers the owner's question as a number: `app · kit version · how far behind · deviations declared · last conformance run`. Verified by the parent: its 13 checks pass (measured 2026-10-08: `design drift report: 13 checks passed`; this line said 11 before `9c551963` widened the discovery), and a throwaway copy with the "one app behind" case neutralised exits 1 with an AssertionError - so the test can fail, which was measured rather than assumed.

**What.** Two small mechanisms that make the whole system observable.

1. **Declared deviations.** An app that must differ declares it, in one file, with a reason each. The conformance suite
   reads that list and **only** accepts deviations that are on it. An undeclared deviation is a failure; a declared one
   is reported as declared, never silently allowed.
2. **Version declaration.** Every consuming app states the kit version it built against, in one obvious place.
3. **A dashboard.** One page or command that answers: *app · kit version · how far behind · deviations declared · last
   conformance run*. This turns "all my apps look the same" from a wish into **a number**.

**Where.** `design/conformance/allow.mjs` (the app's list) and `design/conformance/report.mjs` (the dashboard).

**Acceptance test.** With three sample apps at versions `1.0.0`, `1.0.0` and `0.9.0`, the report names the one that is
behind and lists the deviations of each. Nothing to configure: it reads the declared files.

---

## 4b. Measured while building ITEM 5: the kit's own specimen fails the kit's own suite

`node design/conformance/run.mjs --app design/specimen.html` reports **182 failures** - rule 2 (a printed token value
sitting outside a well) and rule 4 (a form control frozen to one theme). It was **reported, not fixed**, and it belongs
here rather than only in a handoff, because it is a defect in the kit's own front door: the page every agent is told to
look at does not conform to the rules every consumer is judged by.

Two readings, and the decision between them is a design decision, not a bug fix:

- **The rules are right and the specimen is sloppy** - then the specimen needs the same treatment any app gets, and the
  suite should be run against it in the gate so it cannot rot again.
- **The rules are over-reaching for a catalogue page** - printing a token's value beside its sample is the *point* of a
  specimen, and rule 2 exists to stop an operator-facing reading from floating free of a well. If that is the case, the
  specimen declares the deviation through ITEM 5's mechanism, with that reason, and the rules stay as they are for apps.

**Measured 2026-10-08, and it settles the case - against what this section first predicted.** `run.mjs --app
design/specimen.html --port 9341` exits 1 with **182 failures, and 154 of them are one defect**:

```
154  rule 1 · mixed-edges     the specimen's own bevels mix the light and dark steps
 27  rule 2 · not-in-well     a printed token value floats outside a well
  1  rule 4 · frozen-element  a form control does not follow the theme
```

**Two corrections, and the second is the important one.** The first draft said "182 is too many to be one accident"; the
group shape says the opposite, it is **one** defect repeated 154 times. But **counting them was not reading them**, and
the two failures quoted in full say something the count cannot:

```
div.c-window.raised     top/left rgb(68,80,76) · bottom/right rgb(13,16,15)
section.theme-col.sunken  top/left rgb(13,16,15) · bottom/right rgb(68,80,76)
```

They are **exact opposites of each other - which is precisely what rule 1 asks for**. On the face of it the specimen's
bevels are *right*, and the rule is failing something that looks correct. So **"the rules are right and the page is
sloppy" is NOT established**, and writing it as a conclusion was this session's third premature verdict.

Two readings survive, and they need one more measurement to separate:

- **The rule mis-resolves which step is "the light one" in the light column.** The specimen renders **both themes on one
  page**, so `--line-light` and `--line-dark` resolve differently in each column; a rule that classifies against "the
  kit's two steps **as this page resolves them**" can be fooled by a page that shows two themes at once - which no
  ordinary app does, and which the specimen does by design.
- **The specimen swapped them in one column.**

**Measured one level deeper (2026-10-08), and the specimen's bevels are right by construction.** `design/specimen.html`
lines 26-27 declare them as the kit's own pair and nothing else:

```css
.raised { border-color: var(--line-light) var(--line-dark) var(--line-dark) var(--line-light); }
.sunken { border-color: var(--line-dark) var(--line-light) var(--line-light) var(--line-dark); }
```

`border-color` is top, right, bottom, left - so `.raised` is the light step on top and left and the dark step on the bottom
and right, and `.sunken` is that pair reversed. **That is exactly what rule 1 asks for**, and the measured colours agree:
in the dark column `rgb(68,80,76)` is `--line-light` and `rgb(13,16,15)` is `--line-dark`, each on the right edges.

**So the surviving reading is the other one, as an inference with grounds rather than a proof**: the rule resolves **one**
pair of steps for the whole page and judges **both** columns against it. A page that renders both themes at once - which
the specimen does by design and no ordinary app does - then fails the column whose pair it did not resolve: **154 times,
one systematic mis-judgement rather than 154 mistakes.** If that is right, the defect is in the **suite**, not the page,
and the fix is per-column resolution of the two tokens the rule compares against.

**Proven 2026-10-08, by reading the judge.** `design/conformance/rules.mjs:239-240` builds the two step sets **once**, at
the top of rule 1, and every element on the page is then classified against that single pair:

```js
const light = new Set([read('--line-light'), read('--win-btn-highlight')].filter(Boolean));
const dark  = new Set([read('--line-dark'),  read('--win-btn-dark-shadow')].filter(Boolean));
```

A page that renders **both themes at once** - the specimen, by design - therefore fails every element of the column whose
pair was not the one resolved: **154 systematic mis-judgements, not 154 mistakes, and the specimen's bevels are the kit's
own pair.** The defect is in the **suite**, and the direction of the fix is per-element (or per-column) resolution of the
two tokens a rule compares against. The oracle for that fix is in the tree already: rule 1 on the specimen must go **154
to 0**, while `bad-mixed-edges.html` in the fixtures must still fail - **a suite that stops failing a genuinely mixed
bevel to make a page pass would be a worse defect than the one being fixed.**

**How it was going to be proved, for the record**: print, for one element in each column, the four computed edge colours **and** the
pair the rule resolved when it judged them. If both columns resolve to the same pair while the elements carry different
ones, the rule is wrong for a two-theme page and the specimen is exonerated.

**What would settle it, for the record**: one element, measured in **both** columns, printing for each the four computed edge colours
**and** the resolved values of the two kit tokens the rule compares them against. If the page's light column resolves
`--line-light`/`--line-dark` to the dark theme's pair, the rule is wrong for a two-theme page; if they resolve correctly
and the element still mixes, the page is wrong. **Until that is run, neither verdict is honest.**

## 4c. Retracted 2026-10-08, hours after it was written: there was no `--crt` defect

This section claimed the kit's source contradicted itself about `--crt`, with three surfaces saying three things. **It was
wrong, and the measurement that decided it is the one the section itself asked for.**

```
before:  :root --crt: #050a08          the JSON's light value, correct
change light.crt to #c0ffee, regenerate
after:   :root --crt: #c0ffee          the generator reads that key
```

**The generator reads `light.crt`, the JSON is the authority, and the light block carries the light value.** What had been
read as "the dark value in the light block" is the **dark block's own declaration**, four lines further down:
`design/tokens.css:126` sits inside `body.theme-dark`, and the light declaration is at `:46`, inside `:root`. The error was
**reading a line range and attributing it to the wrong block** - the same class of mistake as reading a table's legend and
believing it was the table, made twice in one session by the same author.

**One residue survives, and it is a sentence rather than a defect**: the header comment says *"The CRT well and phosphor
are the same in both themes on purpose"*, and only the **phosphor** is - `crtInk` is `#70e7a9` in both, while `crt` is
`#050a08` light and `#030806` dark. A comment that says "well and phosphor" when it means "phosphor" is the kind of
imprecision this project treats as a defect anywhere it is read by an operator; here it is read by whoever edits the kit,
which is nearly as costly.

## 4d. Found 2026-10-08, reported and deliberately not fixed: the suite can miss a frozen element

While repairing the page-level step resolution (`fb2382d5`), the same agent found a **second, distinct** defect and left
it out of that commit on purpose, with the reason that it has its own oracle. It is recorded here because **a false
negative is worse than a false positive**: a suite that reports something that is not there wastes an hour, and one that
stays silent about something that is ruins the trust the whole kit runs on.

`design/conformance/rules.mjs:573` pairs the two theme renderings with
`byPath = new Map(dark.elements.map(e => [e.path, e]))`, and `path` is capped at five levels and **does not include the
column**. A page whose two columns produce identical five-level paths therefore **collapses two different elements onto one
key**, and `byPath` keeps the last. Measured in a throwaway copy: a genuinely frozen element
(`background rgb(192,192,192)` in both renderings) is **not reported** because a same-path element in the other column
changed. It does not change the specimen's own verdict, which is why it was found by reading and confirmed by a separate
experiment rather than by a red test.

**The fix design is already stated**: collect a full structural key (every ancestor's tag plus `nth-of-type`) and pair on
that. **The oracle it needs**: a fixture with two same-path elements of which one is frozen, which must be reported -
`two-theme-columns.html` is the page shape to build on, and the mutation to prove it is to put the old five-level pairing
back and watch the fixture go unreported.

**Two other findings from the same repair, both real, both the parent's to decide:**

- **Rule 4's single specimen finding is genuine**: `input[type="range"]` carries `appearance: auto`, the page sets no
  `color-scheme`, and the user agent paints its field background white in **every** rendering and every column. That is a
  defect in the specimen, not in the rule.
- **Rule 2's remaining 9 are the §4b question**: a printed value sitting directly on a **raised** surface
  (`div.c-rail.raised`, `figure.sample.raised`). Rule 2 exists so an operator-facing number does not float free of a
  well, and a specimen's whole job is to print values beside samples. Either the specimen puts them in wells or it
  declares the deviation with that reason - and that is a design decision, not a bug fix.

## 4e. Two decisions taken 2026-10-08, on the specimen's remaining ten findings

They came out of the repair of the page-level step resolution (`fb2382d5`) and the agent was right to hand them back:
they are design decisions, not bug fixes. Both are taken here, from evidence, in the form the project's decision rule
asks for - consequences, the rejected alternative, and what would overturn them.

**D-SPEC-1 — the specimen satisfies rule 2 rather than declaring a deviation.** Rule 2's remaining nine are a printed
value sitting directly on a **raised** surface (`div.c-rail.raised`, `figure.sample.raised`): the token's own value,
`"1"` through `"11.5px"`, printed beside its sample. The rule exists so that a number an operator reads never floats free
of a well, and the specimen prints numbers by its very nature - so this looked like a rule over-reaching for a catalogue
page.
**Decision: the specimen changes, not the rule.** The sample captions go into a sunken surface.
*Consequences*: the specimen's layout changes slightly, and a reader still sees every value beside its sample, which is
the page's job. *Rejected alternative*: declaring a deviation for the kit's own specimen. The kit exists to be the
standard other apps are measured against, and **the first declaration in its own file would be the kit telling itself it
may ignore the kit** - every other app then has an excuse, which is the failure mode the roadmap's §2 already names.
*What would overturn it*: a measurement showing that a sunken caption makes the specimen materially harder to read, which
would be an argument about the specimen's purpose, not about the rule.

**D-SPEC-2 — the range input is a page defect, and the page gets `color-scheme`.** Rule 4's one remaining specimen finding
is genuine and measured: `input[type="range"]` carries `appearance: auto`, the page sets no `color-scheme`, and the user
agent paints its `field` background `rgb(255,255,255)` **in every rendering and every column** - a white control on a dark
instrument window.
**Decision: the specimen declares its colour scheme** (or styles the control), so the control follows the theme.
*Consequences*: one line in the page; the suite's rule 4 stops reporting it for the right reason rather than being
suppressed. *Rejected alternative*: adding it to the allowance - that would be declaring a real visual defect as
intended, which is the one thing the declared-deviation mechanism must never become. *What would overturn it*: nothing
found; the white background is a defect by the kit's own §11 point 4, "both themes were looked at, and nothing froze".

**Neither of these is done here.** They are decisions with their grounds written down, and the work is in
`design/specimen.html`, whose writer finished and committed.

## 5. The one thing that must not be promised

**"Identical" is not achievable, and should not be.** A touch application needs 44 px targets; a desktop one needs 24.
A phone in sunlight and a console in a dark room need different surfaces — the kit's own light theme is at 52.7 % of
white luminance **on purpose**, because it is the theme for daylight, and a light theme that obeyed the dark-room rule
would be unusable outdoors.

What **is** achievable, and what this document is for:

> **Identical in everything that does not require otherwise, with every exception written down, versioned and tested.**

That is the thing that can be coordinated. The other thing breaks on the first app with a different need.

---

## 6. Evidence: what a foreign consumer actually tripped over

Written down because these are the traps the next app will hit, and because a rule that has never caught anything is
a rule nobody believes. All of these happened to one app in one night.

| # | The trap | What it looked like on screen | How it was found |
|---|---|---|---|
| 1 | A CSS selector that matched nothing (`.track > i` against `class="fill"`) | A resource bar **empty** at 18.8 % | Looking at a screenshot and distrusting it |
| 2 | `textContent` on a container that held a `<span class="dot">` | A status dot that could **never** light up | Reading the DOM |
| 3 | Seven tokens that did not exist, including every bevel | Panels with **no bevel at all**, silently | A test that walks every `var()` and checks it resolves |
| 4 | Missing `theme.js` on two of four panels | **9.25:1** between adjacent surfaces — the owner's *"everything clashes"* | Objective measurement in a real browser |
| 5 | A theme selector that read the DOM class before it was set | The selector **lied** about which theme was on | Measurement, then reading the code |
| 6 | `--green` on the light surface | "Live" and "no warnings" **invisible in daylight** (1.16:1) | Contrast measured over 430 pairs |
| 7 | A fixed canvas backing store | The spectrum at **49.5 %** of screen resolution: blurry | Measured against devicePixelRatio |
| 8 | The app's own screenshot tool writing **0-byte** PNGs | The verification tool itself **lied** | Noticing a screenshot that proved nothing |

**The pattern, and it is the same eight times:** a check that looks at the wrong artefact, disguised as something else.
No amount of extra tests finds those. **Looking at the artefact and measuring it does.**

Two consequences for the conformance suite:

- **Rules 1–7 must be checked on the rendered result or on computed styles, not on source text.** A test that greps the
  source for a string passes while the screen shows nothing.
- **The suite must be able to fail.** `self-test.mjs` (ITEM 3) is not decoration; it is the difference between a check
  and a ceremony.

---

## 6b. Measured while starting ITEM 1: the kit is behind the application, not the other way round

`scripts/check-design-app-agreement.mjs` (committed `32c2df42`, deliberately not `test-*` until the kit catches up)
compares the kit with **every window file**, per theme, and it found **twelve disagreements** across `index.html` and
`guide.html`. The history says which side is stale:

**Corrected 2026-10-08, after the link: that is history on two counts.** The kit caught up, and the file is now
`scripts/test-design-app-agreement-live.mjs`, a `test-*` **and a gate member** - the `check-*` half of its name and its
deliberate absence from the gate both ended when the link landed (§4f). The twelve below are also no longer twelve: they
were decided one at a time, and today a plain run exits 0 with `46 tokens, 5 windows · 0 unexplained · 9 declared` (11
until `meters.html` adopted the kit's `--red`; measured 2026-10-08).

- `380122c7` *"fix(appearance): the contrast the visual audit measured"* changed `index.html`'s colours **from a
  measurement**. Those values are defensible.
- `design/tokens.css` has not been regenerated since `3dddd469`, which is the meter ramp the control app added.

**The twelve are not one phenomenon, and reading them as one was this session's third wrong conclusion.** They are two:

| Where | How many | What it is | Who is right |
|---|---|---|---|
| `index.html`, `--dim` and `--red` | 2 | changed by `380122c7`, a contrast audit that **measured** | **the application** - the kit catches up |
| `guide.html`, its whole dark palette (plus one light token) | 11 | a window built with a palette of its own (`229bb52b`) that never adopted the kit | **neither**: it is an undeclared deviation |

For the first two the direction of the catch-up is **the kit towards the application**. For the other eleven it is not a
stale kit at all: `guide.html` has its own dark palette, plausibly deliberate, and what is wrong about it is that **it is
undeclared**. That is precisely what ITEM 5's declared-deviations mechanism exists for - an app that must differ says so,
with a reason, and the conformance suite reports it as declared rather than allowing it silently.

So the check cannot become `test-*` until **both** are settled: the kit catching up on two tokens (ITEM 1) and
`guide.html` declaring its deviation (ITEM 5). Until then it stays a `check-` script that fails on purpose, and the
reasons are in its header. **Both were settled, and the link landed after them** - the check went green for the right
reason and is now `test-design-app-agreement-live.mjs`, a gate member (§4f); details of the rename are in the numbered
note below. Note what it also means: the roadmap's §2 claim that the application "agrees
with the kit to the value" was measured **leniently** and is **false in the strict comparison** - the twelve are real.

**Two things to carry, and the second is a mistake made and corrected while writing this:**

1. The catch-up belongs to **ITEM 1**, which owns `design/tokens.*`. The check becomes `test-design-app-agreement.mjs`
   in that same change, because a check that fails by design must not sit in the gate. **Corrected 2026-10-08: the
   prediction's shape held but not its spelling.** It became `scripts/test-design-app-agreement-live.mjs` - `-live`
   because the obvious name belongs to its oracle, `scripts/test-design-app-agreement.mjs` (§4f) - and it did move into
   the gate, though only after the link landed, not with ITEM 1.
2. **An edit was made and reverted**: `guide.html`'s three drifted values were "aligned with the kit" before the history
   was read - which meant aligning them with the **stale** standard. They were restored from the copy taken beforehand
   and verified. The lesson is narrow and worth keeping: **know which side is the standard before you make anything
   match it.**

### Measured risk ITEM 4 declared about itself, worth keeping

`scripts/lib/specimen.mjs` imports `CANONICAL_JSON`, `CANONICAL_CSS`, `toCssName` and `readCanonicalCss` from
`scripts/lib/design-tokens.mjs`, which **ITEM 1 owns and was rewriting while ITEM 4 worked**. If that export shape
changes, the specimen check breaks **loudly** rather than silently - which is the right failure mode, and the reason it
is written down here rather than discovered later. It already survived one concurrent change: another session renamed
`meter-ramp` to `meterRamp` in `tokens.json` mid-work, and both specimen tests passed unchanged because the CSS custom
property did not move.

**One thing ITEM 4 could not do, and it is the gate's business**: `scripts/test-specimen-browser.mjs` was proven by hand
and has **not** been through the gate's browser rotation, because the full gate was not run for that item. Worth one full
gate run before any build.

### Corrections ITEM 1's report forced, written down because the parent agent got them wrong

1. **`index.html` has SIX disagreements with the kit, not two.** The parent read the twelve its own check prints and
   took them for the total; the check prints `problems.slice(0, 12)` of **44**. The message now states the count. Two of
   the six were **not** adopted, with reasons worth keeping: `--win-title-bg` is also used as a **text** colour in the
   About dialog, so copying a phosphor green into the kit's title *background* would corrupt the token's meaning, and
   `--field` is a deliberate appearance choice (`a7830b49`) that meters and ltc do not share.
2. **The blame the parent gave was wrong.** `380122c7` did **not** change `--red`; `#b94444` comes from the `8be6a736`
   rescue snapshot of 2026-09-21. The decision (the application's value wins) still stands, but the provenance in the
   roadmap's §6b was wrong and the JSON's notes now carry the measured one.
3. **The split is not "two and eleven".** Before ITEM 1's catch-up the check reported: guide 11, index 6, ltc 11, meters
   16 - **44 in total**, across **four** windows. After: guide 11, index 2, ltc 11, meters 20. Several meters entries are
   the reader's own false positives (`var(--win-btn-face)` is an alias; `1.0` compared against `1`), so the check needs a
   smarter reader before its number can be trusted to the digit. What it can be trusted for is that it **finds** things
   nothing else could see.

**A pre-existing defect ITEM 1 found while sealing its own work**: `test-desktop-meter-bank-selector-browser.mjs` fails
on a dark-theme profile because the bridge panel shadow is `rgba(0,0,0,0.46)` against the workstation's `0.65`, and it
passes on a fresh profile. `meters.html` **hardcodes the light panel shadow** while `index.html` overrides `--shadow` in
dark. That is a third window with its own palette, and it is the same disease the owner described as "everything clashes".

**The kit's JSON key rename is a read-contract change**, so `VERSION` and `tokens.json`'s `version` go to **1.0.1**
together - the CSS custom property did not move, so a CSS consumer sees nothing, but a JSON consumer reading
`meter-ramp` would.

## 7. Order of work, and why

1. ~~**ITEM 2** first~~ — **done 2026-10-08 (`bf694d1a`)**: it was small, and it was provable by breaking it on
   purpose, which is how it was proved. ~~**ITEM 1 is the next one.**~~ - it was the next one, and it is done (2 below).
2. ~~**ITEM 1** second~~ - **done 2026-10-08 (`c3ad27f5`)**: the single source, with the generator, the rename and the kit at 1.0.1.
3. ~~**ITEM 3** third~~ - **done 2026-10-08 (`688163a9`)**: the item that actually answers the owner's question, with 13 bad fixtures and a self-test that proves it can fail.
4. ~~**ITEM 5** fourth~~ - **done 2026-10-08 (`8eecafd0`)**.
5. ~~**ITEM 4** fifth~~ - **done 2026-10-08 (`7b3608d3`)**: and it found its own gap, see 4b.

**And one thing that is not an item but mattered more than any of them:** link the kit from **your own application**. It
is done (2026-10-08, one window per commit; §8). `desktop/ui/design-tokens.css` used to ship in the bundle with nothing
linking it; today all five windows load it before their own `<style>`, so the kit's owner is its first consumer and no
other app has that excuse.

---

## 8. Definition of done, for the whole document

- [x] `design/tokens.css` is generated from `design/tokens.json`, and regenerating it changes nothing (`c3ad27f5`; verified by the parent: `rm tokens.css` + generator -> byte-identical, and a changed JSON value changes exactly that line).
- [x] `meterRamp` is spelled like the other 15 keys, and the kit's `VERSION` went to **1.0.1** with it: the rename is a
      read-contract change for a JSON consumer even though the CSS custom property did not move.
- [x] `scripts/test-design-tokens.mjs` fails when a token is in the JSON and not in the CSS — and it is pinned
      against inputs the test controls, because the live-file assertion passed with the direction deleted (`bf694d1a`).
- [x] `design/conformance/` exists, is documented, and **can fail**: `self-test.mjs` proves it against 13 known-bad
      fixtures while the conforming one stays green (`688163a9`). Rule 7 is reported as not checked rather than passing
      silently, and its break-on-purpose proof was done on a copy in `/tmp`, verified with `grep -c TODO-EXPERIMENT` -> 0.
- [ ] At least one foreign app (the control app) passes conformance, with its deviations **declared**, not assumed.
      **Not reachable from this repository**: the control app lives in another project, and its author session consumes
      the kit from there. This line is theirs to close, with the mechanism `design/conformance/README.md` documents.
- [x] `design/specimen.html` renders every token in both themes, and fails when a token has no sample (`7b3608d3`).
      Proven by breaking it: with every occurrence of `--win-gray` removed from the page, `scripts/test-specimen.mjs`
      exits 1 and names `--win-gray`; restored, 6 occurrences, tree clean, exits 0.
- [ ] `design/reference/` holds captioned screenshots **of the application**. It holds four of the **specimen** and a
      README that says why the application's are not there: the theme lives in the WKWebView's localStorage, synthetic
      clicks are refused, no CDP reaches it, and there is no window-id tool on this machine (`import Quartz` raises
      `ModuleNotFoundError`). It is a needs-the-desk item, and a live shot could carry a console identity, which this
      project forbids in anything user-visible. **Declared, not silently missing.**
- [x] Every consuming app declares its kit version, and one command reports who is behind. **Done** (`8eecafd0`, the discovery widened by `9c551963`): an app declares itself in its own `conformance/allow.mjs`, discovery also reads an `allow.mjs` **beside the copy of the kit the app shipped**, and `node design/conformance/report.mjs --root .` prints **two** rows - `design/conformance` and `WING CONTROLLER`, the application's carrying `kitVersion 1.0.1` and its **9** declared deviations with their reasons (11 until `meters.html` adopted the kit's `--red`; measured 2026-10-08) - instead of the kit's own row alone. Measured 2026-10-08. The only part this cannot close from here is the **foreign** app: the control app lives in another repository and declares itself there, which is the bullet below.
- [x] The kit's own application links the kit. **Done 2026-10-08, one window per commit** (`75fa9728` and the commits around it): all five windows load the shipped kit before their own `<style>` - `guide.html:11`, `index.html:15`, `ltc.html:13`, `meters.html:12`, `timecode.html:12` - so `desktop/ui/design-tokens.css` is no longer a file that ships without a consumer. Each window's remaining disagreements are **declared**, not assumed: `desktop/ui/allow.mjs` holds **9** entries, one per row, each with its reason, and the renamed gate member (`scripts/test-design-app-agreement-live.mjs`, §4f) prints `46 tokens, 5 windows · 0 unexplained disagreement(s) · 9 declared` and **exits 0**. Measured 2026-10-08: at that moment `RUNNING_TOTAL = 11` in its oracle had not moved, and it was lowered to **9** later the same day when `meters.html` adopted the kit's `--red` and dropped its own `#e74c3c`.

When those nine are true, the owner's question stops being a hope and becomes a report he can read: *which app is
behind, and what did each one deviate on.*

## 4f. Two similarly named files, and one line tells them apart: `-live` measures the tree, the other measures it

Added 2026-10-08, after the checker's repair, because the names invite exactly the mistake this whole document is about.
**Rewritten the same day when the link landed**, because the pair a reader now meets in the gate's own output is the
opposite of the pair this section first named:

- **`scripts/test-design-app-agreement-live.mjs` is the gate member.** It measures the **live tree**: the kit as shipped
  (`design/tokens.css`) against the application's own windows (`desktop/ui/*.html`), theme by theme. A plain run on this
  repository **exits 0** and prints `design kit vs application: 46 tokens, 5 windows · 0 unexplained disagreement(s) · 9
  declared` (11 until `meters.html` adopted the kit's `--red`; measured 2026-10-08); it **exits 1** the moment a window drifts, naming the window, the theme, the token and **both** values. The
  gate picks it up by the `test-*` prefix alone (`scripts/verify-all.sh`: `for test_file in scripts/test-*.mjs`), so it is
  a member now and nothing had to be registered by hand.
- **`scripts/test-design-app-agreement.mjs` is its ORACLE, not the same file.** It is a different, narrower instrument:
  it pins the gate member's behaviour on fixtures it owns - the twelve false readings that must stay skipped, the windows
  that must not silently drop out of the report, the dark fallback, the allowance reader - and, new with the link, it
  **breaks the gate member on purpose on `/tmp` copies** of the real tree, **one declaration at a time**, demanding that
  it exit 1 with the sentence that names the file, the theme, the token and both values. It also runs the gate member
  **through a symlink** (`/tmp` and `/var` are symlinks on this machine), because a guard that compares two spellings of
  the same path literally once skipped `main()` and exited **0 having measured nothing** - the one failure a gate member
  must not have, which the gate books as PASS. The count it asserts is `RUNNING_TOTAL`, **asserted exactly** and never as
  a floor.

**Why the member is `-live`, in one line: one measures the tree, the other measures it.** The obvious `test-*` name was
this oracle's while the link was unsettled, which is why the gate member had to be named around it.

**The order in which both changed**: while the link was unsettled the checker was `scripts/check-design-app-agreement.mjs`,
deliberately **not** a `test-*` and **not** in the gate, because it failed by design and a check that fails by design must
not sit in the gate (this project already paid for a red gate that turned out to be a half-written revision). The link
finished on 2026-10-08 - `ltc.html` and `index.html` landed last, eleven remaining disagreements are **declared** in
`desktop/ui/allow.mjs` rather than adopted, and a plain run went green. Only then was it renamed
`test-design-app-agreement-live.mjs` and moved into the gate; and the oracle's expected count was **lowered deliberately
in that same change**, because the number is the oracle and an oracle that accepts any number above a floor stops telling
you when it has stopped seeing something.

## 4g. D-INDEX-PALETTE-1: index's 136 rule-3 values are a tokens.json decision, not an allowance entry

Taken 2026-10-08, when the agent declaring the last three windows measured `index.html`'s rule 3: **1,007 findings over
136 distinct hexes** - 917 of them matching exactly one finding, 46 matching one each, the top 12 covering roughly 700. It
is not a palette with families; it is **about 136 individual decisions nobody has taken**, and the agent was right to bring
it back rather than invent one reason for all of them. It offered two options and both hide half of that fact, so the
decision is a third:

**The decision.** Each of the 136 values is one of two things, and the question is which:

1. It **duplicates a value the kit already has** - then the literal is **replaced by the token** and it is a **fix**.
2. It is **genuinely new to this window** - then it **goes into `design/tokens.json` and is regenerated**, so every window
   can use it. That is ITEM 1's mechanism, and the only path by which a colour in this project has one home.

**Until that migration happens, index's rule 3 is reported as not-yet-migrated** - not declared, not hidden, with the
136-value list in the report. The eight groups the agent found (dark surfaces, light inks, green status/phosphor, semantic
red/amber/green, focus blue, muted metals) are **migration batches, not declarations**.

*Consequences*: index keeps failing rule 3 while the migration is pending, and that stays visible rather than green.
*Rejected alternative*: eight family declarations. Their largest entry would silence several hundred findings, and each
member would be a palette decision taken by an allowance file instead of by the design - the mute button this kit exists
to forbid. *What would overturn it*: a measurement showing the 136 are **one instrument's livery that no other window needs
and that must not enter the kit** - if that is what they are, they are declared **one by one, 136 entries with 136
reasons**: expensive, and honest.

## 4h. The tree went red on 2026-10-08 in a file this programme does not own - and its owner fixed it

Recorded because the record must say red when it is red. `./scripts/verify-all.sh --quick` fails in the **Rust** suite:
`timecode_storage_tests::the_ltc_input_accepts_29_97_and_refuses_what_is_not_a_rate` panics with `'48' is not a frame rate
this build reads (24, 25, 23.976, 29.97 or 30)`. It reproduces **in isolation** with `desktop/src-tauri/src/main.rs`
unmodified, and `desktop/src-tauri/src/timecode.rs` and `desktop/ui/ltc.html` are dirty under another writer, so **the fix
is theirs and this programme does not touch it**: repairing another agent's half-written source is what the commit rule
forbids. Every measurement of the design work quoted in this document predates this regression, and the "36 checks green"
line that appears in earlier entries is a photograph of a state that has since changed - which is exactly why the entries
that carry it are dated.

**Resolved the same day, by the programme that owned it.** Measured: `cargo test --workspace` exits **0**, with
**333 + 161 + 4 + 6 + 5 passed and 0 failed**, and `desktop/src-tauri/src/timecode.rs` is no longer dirty - it was
committed. **This programme did not touch it**, and that is the rule working rather than a courtesy: a half-written file
belongs to its writer, the failure was reported with its exact test name and message, and the writer repaired it.

**And the lesson this section demonstrates about itself**: a note written in the present tense about the state of a tree
goes stale in hours. The honest form is a dated measurement **plus its resolution**, which is what this section now is - the
first version asserted in the present that the tree was red, and was already false by the time anybody read it.

## 4i. Three findings from closing the last three windows (2026-10-08), recorded rather than absorbed

**1. An agent overrode D-FIX-1 with a measurement, and it was right to.** D-FIX-1 said a frozen element is a defect and
gets fixed. For `button#live-stream` the agent implemented the theme-following fix first and **measured it worse**:
`var(--win-title-text)` gives 4.22:1 at rest and 3.31:1 on hover against its own green, where the frozen white gives 6.47:1
and 5.08:1 - and its ground does not follow the theme either, so the ink that matches it is the correct one. The same
reasoning applies to ltc's Save label. Both are **declared, with their measured contrast in the reason**, and the agent
stated what would overturn the decision: **a kit token whose dark value reads at least as well on those greens.** A blanket
instruction lost to a measurement, in the direction the measurement pointed - which is the behaviour this project wants and
rarely gets to observe. Nothing about D-FIX-1 changes for the general case; this is one element where the rule's premise
(a fix exists that is not worse) was false.

**2. A refusal with a hole in it, found and not fixed.** The seven `button.chip-button.param-preset` controls are disabled
until a destination carrying that chip is chosen, and their tooltip reads *"Not available for : this chip cannot change the
destination"* - **the destination name is empty**, because `targetCategory.value` is `""` in a window with no console
catalogue and `categoryLabel("")` returns `""`. It fills in once a console is attached, which is why it was not noticed: the
sentence only has a hole in the state where the control is disabled anyway. It is a defect by §11's standard - *a refusal
names its cause in the operator's own vocabulary* - and it belongs to whoever owns that window's copy.

**3. A finding about the KIT's light palette, not about the windows.** On the light face a kit well's light step **is**
`#ffffff`, the same value as `--field`, so a well drawn on a light surface shows **only its dark top and left edge**: in a
3x crop of index's macro step numbers it reads as a bracket rather than a frame. The agent judged it better than no well and
said so instead of hiding it. **This is a property of the kit**, not of those elements, and it means a well on the light
face is doing half the job the rule asks of it. Worth a token decision - a light-face well step that is not the field's own
colour - rather than a per-element workaround.

### Correction to 4i point 3, measured the next round: the well's orientation is right, and the invisible edge is the palette

The entry above called the light-face well "a well doing half the job the rule asks of it". **Measured, that overstates
it.** `design/specimen.html:27` declares the sunken pair as the kit prescribes -
`border-color: var(--line-dark) var(--line-light) var(--line-light) var(--line-dark)` - and `border-color` is top, right,
bottom, left, so a well carries **the dark step on its top and left** and the light step on its bottom and right. That is
`design/UI_SYSTEM.md:60`'s "the same pair, reversed", exactly. **The orientation is correct.**

What the agent observed is a consequence of the light palette rather than a fault in the element: on the light face
`--line-light` **is** `#ffffff`, the same value as `--field`, so a well sitting on a light surface shows its two dark edges
and its two light edges vanish into the ground. **That is what a sunken field on white looks like**, in this kit and in the
interface idiom it comes from; the light step exists for wells drawn on darker furniture.

So there is **no defect here and no token decision to take** - only a sentence of mine to correct, and the reminder that
`UI_SYSTEM.md:65` already names the real hazard in this area: an operator reads a **raised/sunken inversion** as a broken
control, which is a different thing from an edge that shares its ground's colour.

## 4j. A consumer measured a blind spot in the judge itself: the suite did not look at typography

Reported 2026-10-08 by the session maintaining `openwing`, a consumer of this kit, with its reproduction and numbers in that
repository's `design/INFORME-al-kit-punto-ciego-tipografia.md`. **Their application passed the suite with 0 failures in both
themes while looking nothing like the specimen** - the owner said so on sight and was right - because they had replaced the
kit's whole type scale with a ramp of their own and **reassigned the kit's names** to point at it
(`--font-sm: var(--t-sm)`). **Verified here**: `grep -c 'font-size' design/conformance/rules.mjs` is **0**. The suite judges
colour, shape, wells and the three states; it has never judged a text size, and typography is, by this kit's own document,
**a scale with a single control**.

**D-TYPE-1 - the suite measures the scale.** Two checks, no new files: every visible text's computed `font-size` must be
**one of the kit's five steps** for that theme (the `clamp()`s of `tokens.css` at the page's own `--meter-scale`), and
**`--meter-scale` must be the only thing that moves them** - at 1 the five give their minima, at 1.5 they rise **in the
kit's proportion**. The second check is the one that matters: a single-size photograph cannot see a renamed ramp, and a
proportion can. Declarable as a deviation, like everything else - **declared with a reason**, never by changing an interface
in silence. *Rejected alternative*: leave it to the visual reference - it fails for exactly the consumer this kit exists to
serve, one that cannot see a screen. *What would overturn it*: a rule that cannot distinguish the kit's five steps from a
ramp wearing their names.

**D-TYPE-2 - the adoption path names the reference.** `adopt/AGENTS.snippet.md` told a consumer to read §11 and run the
judge, and never said that `design/reference/` exists or must be opened. The consumer read the tokens, passed the judge, and
did not open the reference until the owner told them to - and then the difference was obvious in ten seconds. **The cheapest
of the three fixes, and the one that would have prevented the round.** Done in the same change as this entry.

**D-TYPE-3 - the reference travels in the artefact.** `design/package/` links `specimen.html` as a pointer but does not
carry `design/reference/`, so a consumer who takes the package - which `CONSUMING.md` recommends - loses the visual
reference and never learns it exists. It must travel with the kit.

**And the sentence worth keeping, because it is the consumer's own and it is true**: **passing the judge is not looking
alike.** Two different questions, and this kit can only answer one. While the second has an artefact - and it does, the
captioned images in `reference/` - the path to it belongs in the adoption steps; otherwise every consumer repeats the
mistake of reading the values, passing the judge, and believing they have finished.

## 4k. The blind spot was a class, and the worst member is the oracle itself (audit, 2026-10-08)

An independent audit measured, on copies outside the tree, **every dimension an application can change wholesale
while the suite still reports success**. Fifteen dimensions with before/after findings, its apparatus proved able to fail
before being trusted, and every mutation probe-checked so no conclusion rests on a change that never reached the page. The
entry that matters most is not typography:

**D-ORACLE-1 - the oracle lives in the consumer's tree, and that makes every other rule editable.** `run.mjs` reads
`design/tokens.css` **beside the suite** - the consumer's own copy - as the standard to compare against. Measured: a
consumer who edits that copy (and their local declarations) gets a green suite with `--face`, `--line-light`, `--ink` and
`--accent` all changed. **A rule set whose standard is supplied by the party being judged is not a rule set.** The lock
already exists: `design/package/MANIFEST.sha256` carries today's correct hash (`6472f947…`), so a preflight comparing the
`tokens.css` in use against the manifest closes the whole family at once.

**D-TYPE-2 - our own windows must migrate to the kit's five steps.** The in-flight rule 8 reports **68 `invented-size`
findings on `ltc.html`** (30px, 12px, 11px, 9px are none of the kit's steps). The owner's instruction is that the
applications must **look alike**, so the answer is migration, not declaration - with the deviation route kept for what
genuinely cannot fit.

**D-CLASS-1 - the class, not the instance.** The suite judges what §11 states, so **any dimension the kit declares and §11
never states is unguarded**, and the audit lists them as *unwritten*: the type scale and its single knob, **the two families
only**, the four-pixel spacing grid, **two surfaces and only two**, the `1px` square bevel, "the bevel is the state",
"the phosphor and the ramp are the same in both themes", and iconography. **A rule cannot cite a point that does not
exist**, so the fix is two-sided: state them in §11, and extend the existing non-colour token comparison from "tokens whose
value parses as a colour" to **every token the kit declares** - which covers type, spacing and every future non-colour token
in one place.

**D-FREE-1 - and what the kit does NOT claim stays free.** The audit separates the dimensions where a consumer is
legitimately free: layout, topology and how many panels there are; what each window reports; everything inside an image;
the meaning of a colour beyond the palette; the wording. **"All apps must look alike" does not mean all apps identical**,
and writing rules there would make every application the same where the kit intends variety.

**D-SETTLE-1 - a suite defect the audit found while measuring**: a colour transition in flight (2.5s) makes the suite read
mid-flight colours and manufacture **29 and 391 false findings**, because `observe()` never settles transitions before
reading computed styles. A guard is not supposed to be able to fail for a reason that is not a defect.

**Two more from the same audit, both measured, one of them a single character.**

**D-MINUS-1 - the kit's own readings are invisible to the kit's own rule.** Rule 2's number patterns use `[-+]?`, which
does not match **U+2212 MINUS SIGN**, and the specimen prints its readouts as `−6.0`, `−6.0 dB` and `−24.0`. Measured:
forcing every well into the interface font produced findings for `01:02:03:04`, the rail numerals and ltc's counters, and
`grep -c '−6.0'` over that report is **0**. So the instrument's own negative values are never judged by the rule that exists
to judge values. The guard is one character wide, and **the kit's own specimen is the ready-made fixture it needs** - a
fixture that must fail once the pattern is widened, which also means the specimen's baseline will move and that movement is
the proof.

**D-STATE-1 - the three states are unguarded by default, and the fix must be measured before it is recommended.** Default
run on a page that declares no states at all: `CONFORMANCE OK · 0 failures · 5 of 7 rules checked · 2 not judged` (the readout **as measured then**; the suite prints the current count itself, and after the type-scale rule it is one higher), **exit
0**. With `--require-all-rules`, **exit 1**. So a consumer's gate that does not pass it books green a page with no state
handling whatsoever - exactly the "control works or is absent" question in its third form. **But the reverse trap is worse**:
rule 7 is deliberately NOT CHECKED, and a gate that always fails is a gate that gets ignored. **Before this goes into
`adopt/wire-your-gate.md`, measure which rules `--require-all-rules` actually demands** - if it demands the one that is
explicitly not checked, the recommendation is wrong as written and the flag needs a companion.

## 4l. The type scale is measured everywhere, and two decisions fall out of measuring it

The migration landed: five windows, one commit each, **every rule-8 finding either migrated or declared** - `timecode` 22,
`meters` 23, `ltc` 68, `guide` 210, `index` 488, all to **0 undeclared**. `meters.html` now prints exactly the specimen's
shape (`checked steps 5 · texts 33 · sized 33 · invented 0 · moved 33 · notMoved 0`). It found one real defect on the way:
`guide.html`'s `button` rule carried **no `font-size`**, so `#btn-clear-search` computed the browser's own
`400 13.3333px` - **the platform's type inside a kit window** - and it is `var(--font-base)` now. And it found a trap in the
tool: **a finding's path prints an element's id in place of its classes**, so a declaration matched on a class name silently
matches nothing. Recorded in the allowance file itself.

**D-TYPE-4 - the kit gains instrument steps above 18px, and stays out of document headings.** Grounds, measured: the five
`clamp()`s cap at 10/16/18/13/14px, so **no setting of `--meter-scale` yields a text larger than 18px**, while the readings
that matter are `timecode #position` **52px**, `ltc #position` **30px**, `index #timecode-position` **26px** and
`#timecode-card-position` **22px**. An instrument read from across a room is what a kit should name, and five windows each
inventing "the clock is special" is precisely the drift the kit exists to prevent - so it becomes **a step or two the kit
names**, not five allowances. **The guide's chapter `h2` (17px) is the opposite case**: a document hierarchy, which an
instrument scale should stay out of. *Rejected alternative*: leave all six as declared deviations - it works, and it teaches
five windows that the scale does not cover the one reading their operator looks at most. *What would overturn it*: a
measurement showing the steps cannot be chosen so that the clocks land on them at the scales the windows use.

**D-TYPE-5 - split `--meter-zoom` from `--meter-scale`, then raise the application's base to 1.25.** Grounds, measured:
**the application was drawn at roughly the kit's scale × 1.25** - at 1.25 the kit gives badge 8.3, xs 9.3, sm 10.4, base
**11.0**, lg 12.125 against the app's old 9/10/11/12, reproduced within 0.3px. At scale 1, which is what is committed, every
window is uniformly about half a pixel smaller and **`guide.html` reads worse** - its prose went 12px to 10.5px and the gap
between an `h3` and its prose thinned. The migration could not raise the knob because **index and meters own it**: both set
`--meter-scale` from the operator's meter-zoom slider (0.6-2.0) and their geometry is `calc(<px> * var(--meter-scale))`, so
raising it resizes the meters. **Two different controls sharing one variable is the defect**; the split is worth doing on its
own merits, and it is what lets the type grow again without touching the instrument. *Rejected alternative*: keep scale 1 -
it passes every rule, and it accepts a window that reads worse than before. *What would overturn it*: the split costing the
meters' geometry something the ratio cannot recover, measured rather than assumed.
