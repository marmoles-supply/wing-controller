# Sharing the kit with the other projects

The owner's instruction is that `design/` be **the one source the unified design of every app and plugin can be built on**.
This page records what that means today, measured, and what is still missing. It is written from a scan of
the `DEVELOPIN` folder of the owner's machine on 2026-10-08, because the question "how do the other projects share this?" cannot be answered
without knowing what they are.

## What the neighbours actually are (MEASURED, one scan)

| project | kind | UI files | design tokens |
|---|---|---|---|
| `CodeSigner`, `CoreSteward`, `CoreWrapper`, `DantePatch`, `MicroAudioHost`, `rizomes` | **native macOS, Swift** | 5, 13, 4, 8, 29, 2 `.swift` | **none** |
| `openwing` | **documentation** - dossiers, reports and console PDFs; no `package.json` | 8 `.html` reports | none |
| `liverack`, `spectral dynamics` | one `.html` each, otherwise not a UI project | 1 | none |
| `mac optimizer`, `purge`, `defeedback`, `pluginhost.xcworkspace` | no UI source found | 0 | none |
| `wing-controller` | **web frontend**, `desktop/ui`, packaged byte for byte | the five windows | **the kit** |

**So the honest state is: the kit has exactly one consumer, this application**, and the projects that could share it are
mostly **native**, where a stylesheet does not reach. That is not a failure of the kit; it is the reason a prompt alone
cannot deliver what the owner asked for.

## Four layers, and what travels today

1. **The values** - `design/tokens.json` is platform-neutral data: colours, spacing, type, bevels, ramps. **This is the
   layer that can be shared with every project**, and it is the only one that is genuinely one source of truth.
   *Since 2026-10-08 it reaches CSS (`tokens.css`) and SwiftUI (`native/WingTheme.swift`), both generated from it, and
   another platform's form is a generator away rather than a copy of a palette.*
2. **The drawings** - `design/components.css` (2026-10-08) is the layer the kit was missing: the button, the field, the
   `select` with its drawn arrow, the well, the card and the panel, the label and the mono readout, written once in
   plain CSS instead of once per project. **This is the layer that reaches a web window and nothing else** - a SwiftUI
   view has no CSS - and it is why a consumer's sheet could go from its own control rules to **zero**. It is
   hand-written rather than generated (a token is a value, a component is a decision about structure) and the kit's own
   specimen draws itself with it, so it cannot rot into a copy.
3. **The plan** - `design/layout.css` and `design/layout.html` (2026-10-08, kit 1.4.0) are the layer the drawings could
   not answer: **what a window is composed of**, rather than what a button looks like. The four rules this application
   composes every window with - the master header, the two-column plan and its seam, the stacks, the sticky operator
   column and the folded card - named and documented, with the questions a consumer could not answer from the rules
   written into the file. It exists because the missing half was measured from the consumer's side: it linked the values
   and the drawings, deleted every control rule of its own, passed the judge with **0 failures in both themes**, and was
   rejected four times, because it was composing the plan by guessing. Like the drawings, it reaches a web window and
   nothing else - and unlike them it is **offered rather than imposed**: a window whose own ordering is right keeps it
   and declares it.
4. **The rules** - `design/UI_SYSTEM.md` §11's points are written in the operator's language, not in CSS, and they
   apply to a SwiftUI panel exactly as they apply to a window: a control works or is absent; both themes are looked at
   and nothing is frozen to one; a number the operator reads is monospaced and sits in a well; every text size is one
   of the kit's steps, moved only by the scale knob; a deviation is declared with a reason. **These travel as
   prose and as review discipline, not as code.** §11's own list, not this sentence, is where the count lives. **And
   the check is not one of these rules**: as of 2026-10-08 it measures **typography** (rule 8) and it still does **not**
   measure **composition**, so a green suite says the drawings and the type are the kit's and says nothing about the
   plan.
5. **The check** - `design/conformance/` judges the **rendered** page: computed styles and geometry. It can judge a web
   window. It **cannot** judge a SwiftUI view, and pretending otherwise would be the kind of claim this project forbids.
   Each platform needs its own honest answer, and today only one exists.

## What was missing, and is now built (2026-10-08)

1. **A native generator — built.** `scripts/generate-design-tokens-swift.mjs` renders `tokens.json` into
   `design/native/WingTheme.swift`, carrying the same token names and values as the CSS form: `--win-btn-face` is
   `WingColor.winBtnFace` because the generator imports the CSS name mapping rather than retyping it, and the type
   scale's floors are read out of the CSS generator's own table. A colour is changed once, in the JSON, and every
   platform's build picks it up. `scripts/test-design-tokens-swift.mjs` holds it to byte-identity, to a changed JSON
   value moving the right line of the right theme, and to compiling (`swiftc -typecheck`, 0.47 s measured). **The
   honest limit is in the generated file's own header**: this suite judges a rendered web page, so a native view is
   **"declared, not verified"**. The choice of a Swift source file over an asset catalogue, and what would overturn it,
   is recorded in that generator's header.
2. **A distributable form — built.** `scripts/package-design-kit.mjs` writes `design/package/` (27 files, generated,
   carrying `VERSION` and `KIT_VERSION`, the four `adopt/` files that make taking the kit persist, and since
   2026-10-08 the component layer `components.css` and the composition layer `layout.css` + `layout.html`)
   and builds a deterministic tarball into `design/dist/`. The directory is the
   committed form because git can diff it and a byte-equality test can judge it; the tarball is built **from the
   directory's own bytes**, so the two cannot disagree.
   `scripts/test-design-kit-package.mjs` fails when the artefact's copy of any file is not byte-identical to its
   source — proven by breaking it on purpose — and proves the runner starts where a consumer unpacks it.
   **What a sibling repository runs and declares is now a short file: `design/CONSUMING.md`.**
3. **Cross-platform verification — still not possible, and still said out loud.** The drift report compares kit
   versions and declared deviations; what it cannot do is check a native view. Until each platform has its own check,
   the honest sentence for those apps is **"declared, not verified"** — which this project's own standard requires
   saying out loud, and which `design/native/WingTheme.swift` says in its first thirty lines.

The prompt below is now worth sending **with the artefact**, because a native project has something to point at.

## What a sibling project's agent should be told

Paste this, and change the two paths:

> **There is one design kit, and this project adopts it. Do not invent colours, spacing, type or bevels.**
> The kit's source of truth is `tokens.json` - **it is the only file a human edits**; every platform's form is
> **generated** from it, so never hand-edit a generated file and never copy a value into your source.
> **Declare what you took**: `app`, `allowApp`, **`kitVersion`** and `deviations` - each with a reason - in
> `<your folder>/design/conformance/allow.mjs`. A deviation is a decision with a reason, never a mute button.
> **Read `design/UI_SYSTEM.md` §11** and hold to it in the platform's own idiom: a control works or is absent; both
> themes are looked at and nothing freezes to one; figures the operator reads are monospaced and sit in a well.
> **If a value is missing, it is added to `tokens.json` and regenerated**, never hard-coded in a view.
> Say plainly what you could not verify: for a native view today that is **"declared, not verified"**.

## What the owner has to do

**Nothing in this repository** - the rule now lives in `AGENTS.md`, which every agent here reads, and the two pieces
that were missing are built (2026-10-08). For the sibling projects, the prompt above is now worth sending: a native
project takes `design/package/` or the tarball, declares the `kitVersion` it took, and the drift dashboard can say who
is behind. **What it still cannot do is check a native view** - so each of those projects should adopt the kit's
palette and rules, and say "declared, not verified" about its screens until it has a check of its own.

Also still true, and outside this kit's reach: **`openwing` has no `package.json`** (it is documentation), and the
three projects with no UI source (`mac optimizer`, `purge`, `defeedback`, `pluginhost.xcworkspace`) have nothing to
theme. Of the thirteen, the ones that can adopt this today are the six Swift apps; the two single-page HTML projects
can link `tokens.css` and `components.css` as this application's windows link the first of the two today.

The step-by-step a sibling's agent follows is `design/CONSUMING.md`; the pasteable brief is `design/AGENT_BRIEF.md`.
