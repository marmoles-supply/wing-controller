# `design/` — the shared interface language

> **20 October 2026 — production adoption:** Start with `workstation/README.md`
> (relative to the kit root) and its working template/catalogue. The legacy
> three-sheet plan and simplified one-pair bevel described below are retained
> for existing consumers; they are not the target for new WING-equivalent GUIs.
> Production chrome and extracted surfaces take precedence. See the coverage
> inventory for settings, popups, secondary windows and runtime integration.


Everything another application, window or plugin needs in order to look and behave like WING CONTROLLER.

| File | What it is | Read it when |
|---|---|---|
| **`UI_SYSTEM.md`** | The document: the language, the bevel rules, what every colour means, the honesty rules, the vocabulary, and how to consume this from another project | before drawing any control |
| **`tokens.css`** | The canonical values as CSS custom properties, light and dark, **generated** from `tokens.json`; every name the application already uses is an alias here | before writing any colour |
| **`components.css`** | The kit's **drawings**, hand-written: buttons (raised, latched, unavailable-with-a-reason), fields, `select` with its drawn arrow, wells and CRT readouts, cards/panels, labels, chips, bands, rails. **Link it after `tokens.css` and before your own sheet, then delete the control rules it replaces** | before drawing a control |
| **`layout.css`** | The kit's **plan**, hand-written: the four rules every window of this application is composed with — the master header, the two-column `.layout` and its 6px seam, `.stack`/`.builder-column`, the sticky `ops-column` and the folded card — plus the two responsive bands and, in its header, which card goes where, which fold, which column is fixed and how the height is shared. **Link it after `components.css` and before your own sheet**; it is offered rather than imposed, and a window that keeps its own ordering declares it | before composing a window |
| **`layout.html`** | The **composed mockup**: master header, the two-column plan, stacks of cards, one card folded, built from `components.css`'s own drawings. Structure rather than data — no handlers, no controls, every region labelled with what it is for. **Fork it rather than deriving the plan from scratch** | when you have to build a window and have no screen to look at |
| **`tokens.json`** | The values, machine-readable, for something that is not CSS — **the one file a human edits**, and the source the CSS is rendered from | when you add or change a value |
| **`conformance/`** | The acceptance checks, executable: the rules of `UI_SYSTEM.md` §11 judged on a **rendered** page, with `self-test.mjs` proving the suite can fail. Rule 7 is reported as not checked rather than passing silently. |
| **`native/WingTheme.swift`** | The SwiftUI form, **generated** from `tokens.json` by `scripts/generate-design-tokens-swift.mjs`; the same token names and values as the CSS. Its own header states the limit: a native view is **declared, not verified**. |
| **`package/`** | The kit as a distributable artefact, **generated** by `scripts/package-design-kit.mjs`: the files above plus a `MANIFEST.sha256`, for a repository that cannot read this directory. What to do with it is `CONSUMING.md`. |
| **`CONSUMING.md`** | The consumption path for a sibling repository: what to take, what to declare, and what not to do. Read it before copying a value. |
| **`VERSION`** | The version of this kit | when you copy it: say which one you took |

## The short version

- A control is **raised** (light edge top-left, dark bottom-right). A readout is **sunken** (the same pair, reversed).
  Nothing is both, and nothing is decorated.
- Two themes: `:root` is light, `body.theme-dark` is dark, and dark re-declares only what changes. **Never alias a token
  to another token inside `:root`** — that is the trap that once froze a window to the light palette.
- Colour is meaning: `--accent` is selection, `--maroon` is a warning that still works, `--amber` is inherited or
  unfinished, `--red` is a refusal, `--green` is confirmed, `--crt`/`--crt-ink` are the instrument.
- Numbers are `--mono` and sit in wells. Text is `--win-font`.
- A control works or it says why not; nothing fails silently; anything a machine decided has three states, not two.

## Status

**Corrected 2026-10-08, because the paragraph that stood here had gone stale within a day and a stale summary is the
first thing this design system forbids.** It said "the application still does not link it" and put the window
migration under "Next". It is done: **all five windows link the kit**, and `design/AGENT_BRIEF.md`'s own measured note
carries the numbers.

Done:

1. ✅ `design/tokens.json` is the one file a human edits, and `scripts/generate-design-tokens.mjs` renders
   `design/tokens.css` from it — byte for byte, so the header changed and nothing else did. The roadmap's acceptance test
   (delete the CSS, regenerate, byte-identical) and its second half (change one value in the JSON, the CSS changes) are
   pinned by `scripts/test-design-tokens-generator.mjs`, and both were proven by breaking them on purpose.
2. ✅ `scripts/sync-design-tokens.mjs` writes the shipped copy `desktop/ui/design-tokens.css` from the **generated** CSS,
   and `scripts/test-design-tokens.mjs` fails when the two differ **and** when the two *forms* of the kit
   (`tokens.css`, `tokens.json`) disagree — both proven by breaking them on purpose. The copy travels inside the bundle
   because the packaged frontend is `desktop/ui`, byte for byte.
3. ✅ An application outside this repository already consumes the kit: the control-app session added the meter ramp to
   `tokens.css` **and** `tokens.json` through the front door, with its reason in the token's comment, and that addition
   is committed here with its provenance (`3dddd469`). Its JSON key was renamed `meter-ramp` → `meterRamp` on 2026-10-08
   so all 16 keys follow one convention; that rename is the kit's decision, and the CSS property is still `--meter-ramp`.
4. ✅ **All five windows link the kit** and each declares what it took. `desktop/ui/allow.mjs` carries the declared
   deviations with a reason each, `design/specimen.html` renders every token in both themes, and the agreement checker
   (`scripts/test-design-app-agreement-live.mjs`) is a gate member.
5. ✅ **The kit travels (2026-10-08).** `scripts/generate-design-tokens-swift.mjs` renders `design/native/WingTheme.swift`
   from the same `tokens.json` — the form the six native Swift neighbours can point at — and
   `scripts/package-design-kit.mjs` writes `design/package/` plus the deterministic tarball in `design/dist/`, with
   `scripts/test-design-kit-package.mjs` and `scripts/test-design-tokens-swift.mjs` holding both to byte-identity.
   `design/CONSUMING.md` is what a sibling repository reads.
6. ✅ **The kit ships its components (2026-10-08, kit 1.2.0).** `design/components.css` is the layer a consumer links
   instead of retyping a button: buttons (raised, latched, unavailable-with-a-reason), fields, `select` with a drawn
   arrow, wells and CRT readouts, cards/panels, labels, chips, bands and rails, each control drawn once by the kit's
   class and once by the element, from one set of declarations. `design/specimen.html` links it and draws itself with
   it, and `scripts/test-specimen.mjs` fails if the page stops linking it, links it after its own `<style>`, re-declares
   one of its classes, or if the layer itself carries a literal colour. **No window links it yet** — that migration is
   one window per commit and has not been done, which `UI_SYSTEM.md` §12 says rather than hides.
7. ✅ **The kit ships its plan (2026-10-08, kit 1.4.0).** `design/layout.css` is the layer the components could not
   answer: the four rules this application composes every window with (`desktop/ui/index.html`'s `.stack`,
   `.builder-column`, `.layout` and the `<main> -> header.master-header -> .layout -> .stack` chain), named and
   documented, with the four questions a consumer cannot answer from the rules — which card goes where, which ones
   fold, which column is fixed and how the height is shared — answered in the file rather than left to be inferred. `design/layout.html` is the composed mockup of it. The same
   lesson the component layer recorded applies one step further on: a sibling repository linked `components.css`,
   deleted every control rule of its own, passed the judge with **0 failures in both themes** — and had its UI rejected
   four times, because it was still composing the plan by guessing. Two values arrived with it, both measured from this
   application rather than invented: `--desk` (the ground the windows stand on, `#008080` / `#0e1111`) and
   `--ops-col-width` (420px, the operator column's width). **No window links `layout.css` yet** — same reason as point
   6, and `design/adopt/README.md` step 6 records that the missing mirror is a measurement rather than an omission.

Still open, and named rather than implied:

8. `index.html` (~1,259 rendered conformance findings), `ltc.html` (39) and `timecode.html` (4) are **undeclared** where
   `design/conformance/run.mjs` reads declarations: a `match` broad enough to cover a thousand findings is the mute
   button this design forbids, so they need a family pass of their own. `meters.html` and `guide.html` are
   `CONFORMANCE OK · 0 failures`.
9. **Captioned screenshots of the real application.** `design/reference/` holds captioned images of
   `design/specimen.html` — both themes, four page bands, refreshed with the composition layer's two samples (the last
   band only; the first three came out byte-identical, 0 → 5131 px) — and says plainly that
   the application's own are **missing**, with the reasons (a `WKWebView` no CDP connection reaches, and a live window
   that can carry a console's identity). The ten images of the application itself are `design/screens/`, refreshed
   2026-10-08 and locked by `scripts/test-design-screens.mjs`. The date and the kit version of the kit's own images are
   in that folder's README, and the rule a consumer should read before comparing anything with them is in
   `design/adopt/README.md` step 5.
10. **What is verified on a native platform: nothing yet.** The theme is generated and compiles; the suite judges a
    **rendered web page** and cannot judge a SwiftUI view. The honest status of a native screen is **"declared, not
    verified"**, and it is written into `design/native/WingTheme.swift`'s own header. `--ops-col-width` has **no member
    there** on purpose: the native form carries values, and a composition is CSS.

Nothing here is shipped inside the application bundle's own window code; the token copy is, byte for byte. Saying more
than that would be the first thing this design system forbids.
