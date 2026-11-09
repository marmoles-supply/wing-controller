# Consuming the kit from another repository

> **20 October 2026 — production adoption:** Start with `workstation/README.md`
> (relative to the kit root) and its working template/catalogue. The legacy
> three-sheet plan and simplified one-pair bevel described below are retained
> for existing consumers; they are not the target for new WING-equivalent GUIs.
> Production chrome and extracted surfaces take precedence. See the coverage
> inventory for settings, popups, secondary windows and runtime integration.


**Read this instead of copying values.** It is the four things a sibling project does: take the kit, **link it** (the
values, then the components), declare which version it took, and run the kit's own check on its own screen. It is
deliberately short; the reasoning is in `SHARING_THE_KIT.md` and the rules are in `UI_SYSTEM.md` §11.

The kit's own version is in `design/VERSION`; every file below that name carries that version in its header.

**Start at `adopt/`.** Its files are the contract that outlives this page: the steps, the block to paste into **your**
`AGENTS.md`, the declaration template — a deviation is a decision with a reason, never a mute button — and the command
that wires the judge into **your** gate, where exit code `3` means nothing was measured. The sections below describe the
bytes you take; that directory is what keeps them true once the agent that read this is gone.

---

## 1. Take the artefact

Two forms of the same bytes, built by `node scripts/package-design-kit.mjs` in the `wing-controller` repository
(`design/package/`, and the tarball `design/dist/wing-controller-design-<version>.tar.gz`):

| Form | Take it when | What it is |
|---|---|---|
| `design/package/` | you want it in your own git history, reviewable file by file | the directory of files, committed here |
| `wing-controller-design-<version>.tar.gz` | you want the kit without cloning this repository | the same directory, packed, with `MANIFEST.sha256` inside |

Verify the pack before you unpack it:

**The `.sha256` is not inside the tarball and cannot be** - a file cannot carry its own digest. It is published **beside** the tarball, in the same release, and **the command below runs before you unpack anything**: an agent adopting this kit from the tarball ran it from inside the unpacked directory, found no such file, and reported that the artefact's integrity therefore could not be verified. The comment on the line said 'beside the tarball'; one consumer in one afternoon read past it, which is the whole argument for saying it in a sentence as well as a comment.

```sh
# <version> is the release you downloaded; the kit's own VERSION file names it.
shasum -a 256 -c wing-controller-design-<version>.tar.gz.sha256   # the checksum published beside the tarball
mkdir -p design && tar -xzf wing-controller-design-<version>.tar.gz -C design
cd design && shasum -a 256 -c MANIFEST.sha256                 # every file, against the pack's own manifest
```

**Unpack it where the suite and your allowance will live** — `<your folder>/design/`, the same place step 2 below puts
`design/conformance/allow.mjs` — because the suite reads the kit **beside it**: `conformance/collect.mjs` resolves
`dirname(conformance)/..`, so a copy whose sheets are somewhere else answers `could not run: the kit copy beside this
suite has no tokens.css`, exit **3** (nothing was measured).

What is inside (`MANIFEST.sha256` is the list, and it is the authority):

| Path | What it is |
|---|---|
| `VERSION` · `KIT_VERSION` | the kit's version. **Declare the one you took.** |
| `tokens.json` | **the one file a human edits.** Colour, type, spacing, the meter ramp. |
| `tokens.css` | generated from `tokens.json`: the web form, light in `:root` and dark in `body.theme-dark` |
| `components.css` | **the kit's drawings**, hand-written: buttons, fields, `select` with its drawn arrow, wells, cards/panels, labels and the mono readouts. Link it instead of writing the same control again. |
| `layout.css` | **the kit's plan**, hand-written: the master header, the two-column layout and its seam, the stacks, the sticky operator column and the folded card — plus, in its header, which card goes where, which ones fold, which column is fixed and how the height is shared. Link it instead of composing a plan by guessing. |
| `layout.html` | the **composed mockup** of that plan: fork it and delete what you do not need. No handlers and no data — structure, with every region labelled. |
| `reference-window/` | the **complete working window** to fork and gut (`index.html`) and its **region map** (`PLAN.md`): for each region, what it is, the rule it demonstrates, its state and **what to keep, replace or delete**. |
| `specimen.html` | the kit showing **itself**: every token and component, both themes, on one page. The four images below are pictures of this page. |
| `reference/` | four captioned PNGs of the specimen, both themes, for a reader with no screen — a **dated photograph**: read its `README.md` beside `VERSION`. |
| `adopt/` | adopting the kit in six steps: the `AGENTS.md` block, the allowance template, the gate wiring. Start at `adopt/README.md`. |
| `native/WingTheme.swift` | generated from the same `tokens.json`: the SwiftUI form |
| `UI_SYSTEM.md` | the language. **Read §11 before calling a screen done.** |
| `AGENT_BRIEF.md` | the pasteable brief for an agent working on a window |
| `README.md` | the short version of the language and the token list |
| `conformance/` | the suite, runnable: `node conformance/run.mjs --app <your page> --port <a private port>`. It ships its own proof too — `node conformance/self-test.mjs` runs it against the `conformance/fixtures/`, which are wrong on purpose, and fails if a page that must go red goes green. |

## 1b. Link them, in this order

```html
<!-- the values first -->
<link rel="stylesheet" href="design/tokens.css" />
<!-- then the kit's components, drawn from those values -->
<link rel="stylesheet" href="design/components.css" />
<!-- then the kit's plan: the header, the two columns, the stacks, the folded card -->
<link rel="stylesheet" href="design/layout.css" />
<!-- and your own sheet LAST, so a deliberate override still wins -->
<style> /* only what is genuinely yours */ </style>
```

**The prefix is wherever you put the copy of `design/`** — from §1's two forms it is `design/` (the directory you copied
or the folder you unpacked the tarball into). It is not cosmetic: the suite reads the kit it stands in
(`conformance/../tokens.css`), so the sheets and `conformance/` must come from the **same** copy, or the judge answers
exit 3 and measures nothing.

**This order is the contract, and it is what makes a rule of yours a decision.** A rule of yours *before* the kit's
link loses silently — the kit draws over it and nothing says so — and a rule of yours *after* it wins silently, so the
same control is drawn by whichever sheet happened to come last. That is what a sibling application measured, in its own
words: *"no era caché, ni coordinación, ni falta de acceso. Era mi hoja peleándose con la suya."* Its own sheet now
carries **0** control rules. And a control the kit had no drawing for — a `select`, whose arrow the platform draws
itself — came back with no arrow at all, which is why `components.css` draws one.

**`layout.css` is the plan, and it is offered rather than imposed.** `UI_SYSTEM.md` §1's rule that the kit names
furniture and never an arrangement is why: a kit that decided every application's layout would make them identical
where variety is the point. What this sheet removes is the third case, and it is the one a consumer measured: linking
the values and the drawings, deleting every control rule of its own, passing the judge with **0 failures in both
themes** — and still being rejected four times, because it was composing the plan **by guessing** and the four rules
that answer it lived inside this repository's 32,000-line `desktop/ui/index.html`. So link it if it fits, delete what
does not, and if your own ordering is right keep it and **declare it** with its reason and its reach. `layout.html` is
the composed page to fork. One cost is written in the sheet's own header and belongs here too: a layout class is a
page-wide name, so a page that already uses `.stack`, `.layout` or `.column-resizer` for something else must rename its
own or not link the sheet — the cascade will not settle it for you.

`components.css` draws each control **twice from one set of declarations** — by the kit's class (`.c-btn`, `.c-well`,
`.c-field`) and by the element the kit draws (`button`, `select`, `input[type="text"]`, `textarea`) — so the rule for a
project that already has plain markup is: **delete your own control rules and link the sheet.** What the kit does not
draw is left alone: a checkbox, a range, a colour well and a file picker keep the platform's drawing, and the box model
is set on the kit's components rather than with a `*` reset that would move your layout. **The element is addressed by
what it IS by default**, because that is what a consumer writes: a bare `<input>` is a text field by HTML, so
`input:not([type])` is part of the field list, and a `<button>` is drawn as an element whatever its `type`.

**The sheets must be somewhere your build can see them.** The kit ships the canonical `tokens.css`,
`components.css` and `layout.css`; a packaged front end with **no build step** cannot link a stylesheet outside its own
folder, and this repository is exactly that case — `tauri.conf.json` sets `frontendDist: "../ui"` with no bundling step,
so the application keeps a copy of each sheet beside its windows (`desktop/ui/design-tokens.css`,
`desktop/ui/components.css`) and **the copy is generated by a script and never hand-edited**:
`scripts/sync-design-tokens.mjs` and `scripts/sync-design-components.mjs` write them from the canonical files, and
`scripts/test-design-tokens.mjs` and `scripts/test-design-components.mjs` fail in this repository's gate when a copy
stops being the canonical bytes under its provenance notice. **Those four `scripts/` files are this repository's own
gate and are not in the artefact** — the artefact carries the kit and its judge, and installs nothing — so write your
equivalent against your own folder. If your project ships a folder the same way, copy the same
way and wire the same test — **a copy with no contract drifts, silently, and the drift looks like a design choice.**
`layout.css` has **no mirror in this repository yet**, and the reason belongs here because it is the rule rather than an
exception: a mirror exists for a file a window links, and `grep -l 'layout.css' desktop/ui/*.html` returns nothing —
making a window link it is a change per window, with its screenshots refreshed in the same commit. Do not copy a sheet
nothing links.

## 2. Declare what you took

Create `<your folder>/design/conformance/allow.mjs`:

```js
export default {
  app: 'YOUR APP NAME',        // the name the drift dashboard shows
  allowApp: 'index.html',      // the window this declaration is about
  kitVersion: '<version>',     // the VERSION you copied — a number, so the fleet can say who is behind
  deviations: [
    // { rule: 4, match: '#0b0f0e', reason: 'the reading pane keeps its own dark surface: <why, measured>' },
  ],
};
```

`deviations` starts empty and grows one row at a time. **It is a decision with a reason, never a mute button**: the
suite accepts only what is listed, prints every accepted deviation by name, and a declaration with no reason is a
defect. Do not put a `match` in that is broad enough to cover findings you have not read.

Then the drift dashboard can see you — from this repository:

```sh
node design/conformance/report.mjs --root /path/to/where-your-projects-live
```

## 3. Run the kit's check, and look at both themes

```sh
node conformance/run.mjs --app index.html --port 9333   # a private port, never 9223
```

It judges the **rendered** page — computed styles, geometry, visible text — against the rules of `UI_SYSTEM.md`
§11. Exit codes: `0` the rules ran and nothing failed, `1` a rule failed, `2` the command line is wrong, `3` nothing was
measured (no browser, the page would not load). **`3` is not a pass.** This project has already paid for a suite that
said "skipped" and was booked as green.

**Look at both themes as well**, by eye. Every rule in that suite was written after a consumer shipped a window at
1.16:1 contrast while its own tests were green.

## 4. The five things it must not do

1. **Do not edit `tokens.css`, `native/WingTheme.swift`, or anything else generated.** They carry a header saying so,
   and this repository's test fails when they are not what `tokens.json` renders.
2. **Do not copy a value into your own source.** If a colour is `#222527` in a Swift view or a bare hex in a CSS rule,
   it is a second answer to a question the kit already answers.
3. **Do not change a token to suit one screen.** If a value is missing or wrong, it changes in `tokens.json` **here**,
   and every platform's build follows. A new colour invented in a consumer is the drift this kit exists to remove.
4. **Do not link the CSS and then re-declare it.** Link `tokens.css`, **then** `components.css`, **then** `layout.css`
   **before** your own `<style>` — the values, the drawings, the plan, then your sheet — so a deliberate override still
   wins, and **delete the rules the kit now supplies**: your `button`, your `select`, your field, and the plan you copied
   out of somebody's window. A window that restates them is a
   window that will drift, and a rule of yours that ends up *later* in the cascade does not override the kit, it
   fights it — which is exactly what cost a sibling application an afternoon and left its `select` with no arrow. What
   you still style yourself is a **deviation, and it is declared with its reason** in your allowance file — one row per
   finding, exactly as every other declaration there is. The model to copy: that application's own sheet now carries
   **0** control rules, and it declared the rest.
5. **Do not drive port 9223 while a gate is running** in this repository: the gate kills whatever holds that port.
   Use a private port.

## 5. What is verified, and what is not — say which

**Verified for the web:** `conformance/run.mjs` measures your rendered page. That is a real check.

**Not verified for a native view:** the suite judges a **rendered web page**. It cannot judge a SwiftUI view, and
`native/WingTheme.swift` says so in its own header. Adopting the theme makes your palette identical and generated; it
does not make your panels checked. Until your platform has its own check, the honest sentence is **"declared, not
verified"** — write it in your own notes rather than letting a green web check imply more than it measured.

**And keep your own picture, because a green suite is not a design review.** The judge reads computed styles: a window
can pass it with 0 failures while looking nothing like the kit, so commit **your own `design/screens/`, one image per
window in both themes, and add the test that makes a UI change without refreshed images a red test of your own** —
`adopt/README.md` step 5 is the mechanism, and this repository's `design/screens/` with
`scripts/test-design-screens.mjs` is the working example to copy (**both in this repository, not in the artefact**: that
harness drives Chrome through the `ws` package, and the artefact installs nothing). That lock catches **change, not
ugliness**: whether you
resemble the kit is answered by looking at your images beside `design/reference/`, and saying so is part of the step.

## 6. What this file does not settle

The kit ships one native form, SwiftUI, because six of the thirteen sibling projects are native macOS Swift apps
(`SHARING_THE_KIT.md`, measured 2026-10-08). A project on another platform has `tokens.json` and `UI_SYSTEM.md` §11,
and no generated form: ask, and the generator is written from the same JSON rather than a palette being copied. There
is no asset catalogue, and the reason is in `scripts/generate-design-tokens-swift.mjs`'s header — an `.xcassets` folder
cannot be compared byte-for-byte by the gate that guards this kit.
