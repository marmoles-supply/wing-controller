# WING workstation kit: start here

The production workstation is the visual authority. The older `reference-window/`
and specimen demonstrate the earlier simplified component vocabulary; **they are
not a substitute for the production appearance**. The owner rejected that
approximation on 20 October 2026. Passing the old conformance rules did not establish
visual resemblance. This is the lesson, not a claim that the old checks were useless.

## Create a project

From an extracted, unmodified release of the kit, with Node 22 or later:

```sh
node workstation/create.mjs /absolute/path/to/new-project
```

This refuses an existing directory, validates the complete SHA-256 manifest, copies
the pinned kit and creates a working `index.html`, `wing-kit.json` and `AGENTS.md`.
Open `index.html`. Search, selection, editing, tabs, folding, theme and dialogs work
without a backend. The example data is explicitly local and ephemeral.

Change the product name, content and data adapter. Keep the kit immutable.
Compose new screens from the supplied blocks; **do not redraw** their borders,
colours, fonts, shadows, spacing or selected states in local CSS.

```html
<link rel="stylesheet" href="wing-kit/tokens.css">
<link rel="stylesheet" href="wing-kit/components.css">
<link rel="stylesheet" href="wing-kit/workstation.css">
<link rel="stylesheet" href="wing-kit/surfaces.css">
```

Use `wc-app` on the body. The workstation entry intentionally does not load the
legacy `layout.css`: its global `main`, `.layout` and `.stack` rules assume a
particular page. The new layout classes are explicit `wc-*` roles.

## Recipes and responsibilities

Open `workstation/catalogue.html` beside the working template. It is a usable
catalogue, including Properties, confirm/prompt, menus, notifications, fields,
validation, checkboxes, radio buttons, ranges, drawn selects, matrix selection,
rows, inline editing, instruments and logs. Use its markup and public classes,
not a screenshot interpreted by an agent.

| Layer | Responsibility | Authority |
|---|---|---|
| `tokens.css` | Theme values and scale | Generated from `tokens.json` |
| `components.css` | Basic legacy controls | Existing shared library |
| `workstation.css` | Production two-step chrome, cards, frame and layout | Main window panel/header/button measurements |
| `surfaces.css` | Complete selected production CSS rules, pseudo states and responsive variants | Extracted from the actual main window |
| `runtime/dropdown.js` | Drawn select, groups, keyboard, native value/change events | Byte-identical production module |
| `runtime/field-editing.js` | First-click selection and caret behaviour | Byte-identical production module |
| `runtime/dither.js` | Pixel patterns, theme/resize handling and bounded cache | Byte-identical production module |
| `runtime/vu-draw.js` | Analogue meter and history drawing | Byte-identical production module |
| `workstation/interactions.js` | Tabs, folding, theme and native modal focus return | Backend-independent |
| Application adapter | Data, actions, validation rules, persistence, safety | The consuming application |

`surfaces.css` retains production class names. Load it only on WING-styled pages:
its checkbox, range and scrollbar rules are intentionally page-wide. Its literals
are measured production drawings, not permission to invent new colours. The
source repository regenerates it with `node scripts/sync-design-surfaces.mjs`;
`--check` fails when the extraction or any runtime module drifts.

## Interaction contracts

- Use labelled native buttons, inputs and dialogs. A decorative `div` is not a
  button. Tabs carry `aria-controls`, `aria-selected` and roving `tabindex`.
- `data-wc-dialog="id"` opens a native modal and restores its opener on close.
  Native modal focus containment and Escape remain active. Production domain
  confirmation queues and panic semantics stay in their application wrappers.
- `data-wc-collapse="id"` owns a panel and its `aria-expanded` state.
- A `role="tablist"` supports Left/Right, Home/End; vertical lists use Up/Down.
  A selected tab owns one panel. Do not initialise a panel's controls only when
  someone clicks its category: shortcuts must reach the same working controls.
- Drawn selects retain the native `<select>` as the source of truth. Load
  `runtime/dropdown.js` and `surfaces.css` together. Call `WingDropdown.init(root)`
  after inserting new selects, and `refresh(select)` after external updates.
  The module intercepts the native select value setter and retains instances;
  it is not yet a disposable SPA component adapter.
- Field editing is opt-in through its script. In plain web pages it needs no
  backend. A Tauri consumer must implement/adapt the optional `focus_webview`
  command; the WING module does not invent that host capability.
- Dither requires `WingDither.apply()` and `watch()` once, after DOM setup.
  `WingVu` takes explicit dimensions, values and theme. Example values are not
  telemetry. Do not add a second data path to render an instrument.
- Error, unavailable, stale, sent and confirmed states must have words as well as
  colour. The application supplies the honest state and the reason.

## Verify the result

```sh
node wing-kit/workstation/check.mjs index.html ./visual-review
```

This compares **every instance** of the required chrome roles against the
canonical shipped template at 420, 820 and 1280 px, in both themes, checks
horizontal overflow and optionally writes paired screenshots plus a JSON report.
It catches an overridden card even when another card still looks correct.
It also checks buttons and common field types against the complete style
signatures present in the working template and component catalogue. A private
rounded-button or recoloured-field rule cannot pass just because the cards match.

This is a drawing parity check, not a proof that an arbitrary application is usable.
Also open the catalogue, exercise the actual product's dialogs/settings, inspect
the paired screenshots, and run its integration tests. A screenshot lock against
your own redesigned page only freezes the redesign; it does not prove WING parity.
The legacy conformance runner is complementary and now refuses missing kit
provenance and exceptions without reasons.

## Surface coverage and limits

`workstation/COVERAGE.md` inventories
all five windows, all thirteen Properties pages and the popup families, with their
integration tests and ownership. It travels with the package.

Production secondary windows share `workstation.css`; their layout adapter keeps
the clock compact, the cue table scrollable and the guide printable. Sharing a
family does not mean putting a clock in an editor's two-column layout.

The kit is an HTML/CSS/JavaScript implementation. Its Swift file carries values,
not equivalent native controls. A React/Vue wrapper may preserve the DOM and
styles; a native SwiftUI/Qt implementation needs an explicit renderer and parity
tests before it may claim the same appearance. OS-owned file, colour and
permission panels remain host UI.

## Updating

Do not hand-edit the vendored kit. Review a new release, validate its manifest,
replace the complete kit directory and rerun parity and product tests. Keep
product data adapters outside the kit. Do not silently update live projects from
this source tree.
