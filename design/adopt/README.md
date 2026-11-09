# Adopting the kit into another repository: six steps, once

> **20 October 2026 — production adoption:** Start with `workstation/README.md`
> (relative to the kit root) and its working template/catalogue. The legacy
> three-sheet plan and simplified one-pair bevel described below are retained
> for existing consumers; they are not the target for new WING-equivalent GUIs.
> Production chrome and extracted surfaces take precedence. See the coverage
> inventory for settings, popups, secondary windows and runtime integration.


**The message that told you about this kit is the door. This directory is the lock.** A rule that lives in a message
persists only as long as the agent that received it remembers; a rule that lives in **your** `AGENTS.md`, in a declared
version and in **your own gate** persists across sessions, agents and deadlines.

## What is true of a message, and what is true of a contract

| | |
|---|---|
| **A message is read once, by one agent, in one task** | The next agent in your repository never sees it |
| **A file in your repository is read at the start of every session** | That is what `AGENTS.snippet.md` is for |
| **A test in your gate fails when somebody drifts** | **This is the only one that survives an agent that forgets, does not read, or decides a colour does not matter** |

Without the fifth step below, adopting the kit is a **preference**. With it, it is a **contract**, and the difference is
not philosophical: it is whether the button somebody paints red at 2 a.m. is caught before a gig.

## The six steps

1. **Copy the reference window, and delete what you do not need.** Take the artefact as before - copy
   `design/package/` into your repository, or take `wing-controller-design-<version>.tar.gz` - **whose root is that
   directory's contents unpacked flat, so there is no `design/package/` inside the tarball** - and verify it with
   `shasum -a 256 -c` - and **start from the kit's reference window** (`design/reference-window/`), a complete working
   window you fork and gut, region by region, rather than a UI you assemble from tokens and components.
   **Its `PLAN.md` travels with it, and it is the region map**: for each of R1-R6 it states what the region is, which
   rule it demonstrates, which state it is in and **what to keep, replace or delete**. The window carries those four
   annotations inline for five of the six regions, and R3's "keep two, delete the rest" is written nowhere else - so a
   window without the plan tells you to gut it and then leaves the fold's own instruction to guesswork. **The window is
   the canon made copyable**: how it is ordered and how it is used, the two things the tokens and the components alone
   never carried. **Deleting a region is the intended way to use it** - the whole point is that you keep what you need.
   And **a window that invents its own plan declares it**: with its reason and **its measured reach**, in its allowance
   file, exactly as every other deviation is declared. **A layout nobody can link is a decision that has to be written
   down.** **Never hand-copy a value from this kit into your source.**
2. **Change your internal contract**: paste the block from `AGENTS.snippet.md` into **your** `AGENTS.md` (or your
   equivalent instruction file), replacing the two placeholders. This is the step that makes every future agent in your
   repository know where design comes from.
3. **Declare what you took**: copy `allow.mjs.example` to `<your folder>/design/conformance/allow.mjs` (the kit ships
   that file itself, composed at pack time and declaring the kit's own reference window — you are replacing that
   declaration with yours, not filling in a blank), set `app`, `allowApp`, **`kitVersion`** and your deviations - **each
   with a reason**. A deviation is a decision with a reason, never a mute button.

   **And one check changes its answer once you have done this, which is expected rather than a fault.**
   `shasum -a 256 -c MANIFEST.sha256` verifies the kit **as it shipped**, and this step deliberately changes exactly one
   of the files the manifest names: `conformance/allow.mjs`. So after you declare your own deviations that command
   reports **that one file and only that one** - `conformance/allow.mjs: FAILED`, exit 1 - and **a second name is a real
   difference** between your copy and the artefact, worth reading. Run the manifest check before you replace the file,
   which is when it answers the question it was written for: *did the kit arrive whole?*
4. **Wire the judge into your gate**: `wire-your-gate.md` has the command and the exit codes, and `gate.sh.example` is
   that command already wired up — the runnable gate to copy, paste and run, with every line marked as the kit's own
   tool or as one you must supply. **A kit that is not checked
   is a kit that will drift**, and the drift will be invisible because everything will still look fine.
5. **Keep your own visual record, and make it fail rather than be remembered.** Commit
   `<your folder>/design/screens/` - one image per window per theme, named so the window and the theme are readable
   without opening the file (for example `meters-light.png` and `meters-dark.png`) - and add a test to **your** gate that
   renders those windows into a scratch directory under `/tmp` and compares them with the committed images. It passes
   when they match and fails naming the window, the theme and how much moved when they do not, so **a UI change without
   refreshed images is a red test of your own**. That is the rule this kit is built on - a rule that fails rather than a
   request that is remembered - and it is the only way "share your screenshot" survives contact with a deadline.

   The judge (step 4) reads computed styles, and **what it decides is easy to over-read in both directions - corrected
   2026-10-08, when rule 8 landed.** It **does** measure **typography**: every text must be one of the kit's steps - the
   five interface steps *and* the four instrument steps - and `--meter-scale` must be the only thing that moves them. It
   does **not** measure **composition**: no rule reads where a region sits, which column it is in, what shares its row,
   or how the height is shared. So a window can pass with 0 failures in both themes while looking nothing like the kit -
   it can have replaced the type scale, reassigned the kit's names, and composed a plan nobody decided. **A picture is
   the artefact that check cannot be**, and the plan is the artefact neither of them is: a green suite says the drawings
   and the type are the kit's, and it says **nothing** about the plan. The lock over your images catches **change, not
   ugliness** - whether your windows *resemble* the kit is answered by a person or an agent looking at your images beside
   this kit's own `reference/`, and whether their **composition** is the kit's is answered by reading
   `design/layout.css` and `design/layout.html`. Say that plainly in your own `design/screens/README.md`, so nobody
   reads a green gate as a design review.

   **And the kit's `reference/` is a dated photograph, so the code wins.** Read the date and the kit version in
   `design/reference/README.md`, and the kit version in `design/VERSION` — the same number while the photograph is
   current — before you compare anything with it. The images
   were taken from the kit **at the version that README names**, and that README also records a set that was
   superseded within the same day — a picture that is not refreshed with the code it describes is a lie with a
   timestamp, and it caught one consumer out: an afternoon went on a difference that was between the code and an older
   picture of it, which is the state a consumer that copies an old image set into its own repository puts itself in.
   If the `VERSION` beside the images is newer, they show a design the kit no longer draws. **When the two disagree,
   the code and `VERSION` are right and the picture is stale**; refresh it (or ask this project to) rather than
   matching it. The same rule runs the other way for your own `design/screens/`: your images are dated by the commit
   that wrote them, and the lock described above exists so they cannot quietly become a picture of a design you no
   longer have.

   **This application's own ten images were refreshed on 2026-10-08, and that is the state a picture is worth reading
   in — not a licence to trust it.** `design/screens/README.md` records the date and the measurement (all ten
   byte-identical to a fresh render at 1600 px in both themes), and `scripts/test-design-screens.mjs` is what makes a
   stale one a red test instead of a remembered promise. What is still true, and it is the sentence the consumer who
   lost the afternoon put in writing: ***a consumer looking only at the pictures learns an application that may already
   have moved.*** A picture is a photograph of this tree at the commit that wrote it. The moment you are comparing
   against it, `design/VERSION`, `desktop/ui/*.html` and the sheets they link are the present tense, and the picture is
   the past.

   **And read the reference application's own code when you have access to it — the pictures cannot carry a
   composition.** This is the correction a consumer earned the hard way, and it was written after the failure rather
   than before it: it copied a title bar out of a screenshot that was behind the code, and then spent an afternoon on
   a difference that was between its own page and a `desktop/ui/index.html` it had never opened. The code is
   `desktop/ui/*.html` in this repository: every window links `design-tokens.css` and `components.css` — the values and
   the drawings — and the **plan** they are composed from is `design/layout.css` with `design/layout.html` as the
   composed page. Read them together: the pictures show what the kit looks like, and only the code shows how a window
   is put together — which card sits in which column, which ones fold, which column is fixed, and how the height is
   shared. **No picture can carry that**, and the request this file's step 6 answers exists precisely because they
   cannot.

   `design/screens/` in this repository is the working example to copy: its `README.md` states the convention, and
   `scripts/test-design-screens.mjs` with `scripts/lib/design-screens.mjs` is the mechanism. **Those two are this
   repository's own harness and do not travel in the artefact** - they drive Chrome through the `ws` package, and the
   artefact's contract is that it needs nothing but Node and a browser - so copy the *shape* (a committed image per
   window per theme, and a test that re-renders and compares) rather than the files.

   **And this repository ships `scripts/compare-design-likeness.mjs`, which is an instrument rather than a verdict** -
   it is **not** in the artefact either, for the same measured reason (it renders through
   `scripts/lib/design-screens.mjs`, which imports `ws` and resolves this repository's root), so run it from a clone of
   this repository: it puts
   your page and a reference side by side, both themes, **in one image for a person to judge**, and it says of itself,
   in its own output, that **it measures nothing about resemblance**. So the contract is: **commit your screenshots,
   and put the pair in front of a person.** A tool that measured resemblance would be the same lie in a new place, and
   saying what it is not is part of shipping it.

6. **Link the kit's sheets rather than rewriting them.** The kit ships **three** sheets, and they answer three different
   questions: `tokens.css` is the **values** (a colour, a size, the steps a bevel is built from), `components.css` is the
   **drawings** (the button, the field, the `select` with its arrow, the well, the card and the panel, the label, the
   mono readout) and `layout.css` is the **plan** (the master header, the two-column layout and its seam, the stacks, the
   sticky operator column and the folded card). Link them in that order, and **your own sheet last**:

   ```html
   <link rel="stylesheet" href="design/tokens.css" />
   <link rel="stylesheet" href="design/components.css" />
   <link rel="stylesheet" href="design/layout.css" />
   <style> /* only what is genuinely yours */ </style>
   ```

   **The three hrefs above are the copy of the whole `design/` directory that step 3's allowance lives in, and the
   prefix is not cosmetic.** The suite reads the kit it stands in - `conformance/collect.mjs` resolves
   `dirname(conformance)/..` - so sheets placed anywhere else leave the judge with nothing to read: the measured
   failure is `could not run: the kit copy beside this suite has no tokens.css`, exit **3**, *nothing was measured*.
   Put the sheets where the suite is (the `design/` directory you copied), and if your page lives deeper, write the
   href relative to it - `../design/tokens.css` and so on.

   **`layout.css` is offered, not imposed, and that distinction is the difference between a plan and a template.** The
   kit's own rule is that it names furniture and never an arrangement, because a kit that decided every application's
   layout would make them identical where variety is the point - so a window whose own ordering is right keeps it, and
   **declares it** with its reason and its measured reach like any other deviation. What the file removes is the third
   case, and it is the one that cost a sibling application a fortnight: composing the plan **by guessing**, because the
   four rules that answer it lived inside this repository's 32,000-line `desktop/ui/index.html` where no consumer could
   find them. `design/layout.html` is the composed mockup: open it, or mount it, and delete what your window does not
   need rather than deriving the plan from scratch.

   **And one decision this kit took on the bevel, because a consumer asked and the answer is not "whatever looks
   closest".** The kit's bevel is **one pair** - light on the top-left, dark on the bottom-right, and nothing else on the
   element (`UI_SYSTEM.md` §4 rule 2). This application's own controls draw a **second inner step** on top of that pair
   (`desktop/ui/index.html:1305-1318`: `inset 1px 1px 0 var(--face-3)`, `inset -1px -1px 0 var(--line-mid)`), which is
   why the same face looks heavier there; the suite reports it as rule 1 `two-shapes`, and it is **declared as a
   deviation of that window** (`design/conformance/allow.mjs`) with its reach and its count. The kit did **not** adopt it,
   and the reason is a measurement rather than a preference: a box-shadow's direction is not in the computed style the
   suite reads, so a "named two-step bevel" would leave rule 1 unable to tell a second raised step from a sunken inner
   shape - the contract "one element is one shape" would still be stated and could no longer be judged. If your window
   wants the heavier face, draw it and declare it, exactly as this application does; if it wants to look like the kit,
   one pair is the whole of it. *What would overturn this:* a computed reading that distinguishes the two steps'
   direction, at which point the kit can name the second step and rule 1 can judge the direction instead of the presence
   of an inset.

   Then **delete the control rules your own sheet was writing.** `components.css` draws each control twice from one set
   of declarations - by the kit's class (`.c-btn`) and by the element the kit draws (`button`, `select`,
   `input[type="text"]`, `textarea`) - so plain markup gets the kit's drawing with nothing renamed, and the work is
   deletion rather than a rewrite. **A rule of yours that ends up after the kit's link does not override it; it fights
   it, silently.** That is the whole of what cost a sibling application an afternoon: *"no era caché, ni coordinación,
   ni falta de acceso. Era mi hoja peleándose con la suya"* - and *"estuve toda la tarde describiendo su diseño en vez
   de enlazarlo."*

   **A layout class is a page-wide name, and that is a real cost of linking `layout.css`.** Its names are this
   application's own (`.stack`, `.layout`, `.column-resizer`, `header.master-header`), kept so that a window already
   composed this way links the file and deletes its own copies with nothing renamed - and the price is that a page which
   already uses one of those names for something else gets the kit's rule underneath its own, silently, in the
   "override" direction the paragraph above describes. If that is your page, rename yours or do not link this sheet.

   **What a window still styles itself is a declaration, not a private decision.** Whatever control markup you keep -
   your own livery, a green action button, a reading window's palette - is declared with its reason in your allowance
   file, **one row per finding**, exactly as everything else in step 3 is. That is the model to copy: that
   application's own sheet now carries **0** control rules, and it declared the rest. A control rule left in your sheet
   and not declared is the drift this kit exists to remove, and it is invisible because everything still looks fine.

   **And the sheets must be somewhere your build can see them.** The kit ships the canonical `tokens.css`,
   `components.css` and `layout.css`; a packaged front end with no build step cannot link a stylesheet outside its own
   folder, and this repository is the case in point - `tauri.conf.json` sets `frontendDist: "../ui"` with no bundling
   step, so the application keeps a **byte-for-byte copy** of each sheet beside its windows
   (`desktop/ui/design-tokens.css`, `desktop/ui/components.css`), **made by a script and never edited by hand**
   (`scripts/sync-design-tokens.mjs`, `scripts/sync-design-components.mjs`), with `scripts/test-design-tokens.mjs` and
   `scripts/test-design-components.mjs` failing in this repository's gate when a copy stops being the canonical bytes
   under its provenance notice. **Those four `scripts/` files are this repository's own gate and do not travel in the
   artefact** - write your equivalent against your own folder - but copy the same way and wire the same test:
   **a copy with no contract drifts, silently, and the drift looks like a design choice.**

   **And `layout.css` has no mirror in this repository yet, and that is a measurement rather than an omission.** The
   mirror chain exists because a packaged window can only link a file inside its own folder; a mirror **nothing links**
   is a second copy to keep in step for no reason, and this application's five windows still carry the plan inline in
   their own sheets - they link `design-tokens.css` and `components.css` and not `layout.css`
   (`grep -l 'layout.css' desktop/ui/` returns nothing). Making them link it is a real change per window, with the
   screenshot lock attached to each, and it belongs in its own commit per window - the same shape the component layer
   took this afternoon. Until then the canonical `design/layout.css` is what the plan is read from (and what
   `design/layout.html` links), and no window pretends otherwise.

## How to check, in a month, without trusting anybody

Ask each repository two questions:

> **What does your `kitVersion` say, and does your gate fail if somebody changes a colour by hand?**
>
> **Where are your screens, both themes, and does your gate fail when a window changes without them?**

A number and two yeses means it is sharing the design. "I think so" means it is not.

## What this kit can and cannot see

The kit's drift dashboard lists **the applications in the tree it is run over**. It cannot see your repository unless the
dashboard is run there, so **today, persistence is your responsibility**: the version you declare and the check you wire
are what make it true. What the kit brings is the one thing that makes that check possible at all - a single source, a
version, and a rule set worth checking.

## If your project is native (AppKit, SwiftUI, an audio unit)

Two of the owner's projects that already carry this kit are native, and the question they raise has an answer the kit
already implies - so it is written here once rather than decided again in each tree.

1. **The kit governs the tokens a native project can share**, which is why `native/WingTheme.swift` exists: colours, the
   type scale and its single knob, spacing, the gradient and the bevels' intent, generated from the same `tokens.json`
   as the CSS. Take it, declare it, and keep the generator beside it - a native target that hand-transcribes values has
   the drift the kit exists to prevent, in a file no test reads.
2. **The conformance suite cannot judge a native view**, because it reads a rendered web page. So the honest status of a
   native screen is **"declared, not verified"** - say it plainly, and do not let a screenshot in a README imply a check
   that never ran. The kit's own generated Swift says this in its header; yours should too.
3. **Your project's own design notes govern layout and hierarchy.** The kit names furniture - surfaces, ink, steps,
   wells, bevels - and never an arrangement. How many panels a window has, what each reports, and how a document's
   headings nest are yours; a kit rule that reached into those would make every application identical where variety is
   the point. If your notes and this kit appear to disagree, **check which question is being answered**: if it is a token,
   the kit wins; if it is an arrangement, your notes win.
4. **Being behind is a state, not a verdict.** A project whose copy is an older version stays honest by declaring that
   version rather than by pretending; re-copying is a small, deliberate step - take the new artefact, regenerate, re-run
   your judge, and refresh your declared `kitVersion` in the same change.
