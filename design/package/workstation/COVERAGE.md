# GUI coverage and ownership — 20 October 2026

This is the finite inventory used for the kit repair. **DOCUMENTED** below means
located in source; it does not mean every possible data combination was exercised.
Measurements and final verification belong in the session audit.

## Screens and embedded surfaces

| Surface | Production source | Integration contract |
|---|---|---|
| Workstation: library, editor, operator cards | `desktop/ui/index.html` | desktop UI, macro edit, macro library, inspector browser suites |
| Meter Bridge: toolbar, banks, stage, status | `desktop/ui/meters.html` | meter-bank-selector, meter-bridge-status, VU browser suites |
| Clock: folded/expanded, stale/active/empty | `desktop/ui/timecode.html` | timecode-clock browser suite, including 420×200 fallback |
| Cue editor: table, inspector, live mode, history | `desktop/ui/ltc.html` | LTC-window, cue-comfort, cue-save-button browser suites |
| Guide: search, chapter rail, article, print | `desktop/ui/guide.html` | guide browser suite and screen lock |
| Properties: all pages below | `index.html`, `initSettingsModal` | settings-tabs browser suite |
| Matrix picker in main and bridge | `index.html`, `meters.html` | channel-matrix and meter-bank-selector browser suites |
| Confirmation, notice and prompt | Both main and bridge | window-dialog contracts and browser Enter/Escape checks |
| Backup export/import scopes | `index.html`, dynamic dialogs | station-backup-dialog browser suite |
| Bridge About | `meters.html` | bridge/dialog integration contracts |
| Context menu and rich tooltip | `index.html` | context-menu and inspector-hints contracts |
| HUD centre/toast/fullscreen | Main and bridge | HUD-panic and HUD-flash contracts |
| Cue and alias inline editors | `cue-list.js`, main and LTC | field-focus, macro-edit, LTC-window browser suites |
| Host file/colour/permission panels | Tauri/macOS | Host-owned appearance; not a web component |

Properties categories, all thirteen: `general`, `matrix`, `meters`, `network`,
`osc`, `timecode`, `interapp`, `profiles`, `contextmenu`, `shortcuts`, `hud`,
`help`, `about`. These are application pages composed from shared controls, not
thirteen domain-specific components that another product must copy.

## Families

| Family | Reusable home / example | Behaviour retained by the application |
|---|---|---|
| Desk, frame, product header | `workstation.css`, working template | Branding, transport and emergency priorities |
| Panel, card, heading, subsection | `wc-card`, `wc-heading`, production surface rules | Data and card permissions |
| Columns, folding and ordering | `wc-workspace`, collapse runtime; production card rules | Persistent layout and permitted order |
| Normal, primary, danger, mini, icon and latched buttons | `surfaces.css`, catalogue Controls | Action and availability reason |
| Text, number and multiline input | Components plus field-editing runtime | Validation and data binding |
| Invalid field and explanation | Production `.is-invalid`, catalogue required name | Domain rules; never colour alone |
| Checkbox and radio | Production checkbox rules; native semantic inputs in catalogue | Values and mutually exclusive groups |
| Slider and numeric readout | Production range rules, catalogue Size | Units and limits |
| Colour well and swatch | Native colour field and production HUD classes | Host picker, chosen colour |
| Plain/grouped drawn select | Production dropdown runtime and `.parameter-*` rules | Option catalogue and availability |
| Nested picker | Production submenu drawing; dropdown optgroups/subgroups | Domain hierarchy and resolution |
| Horizontal/vertical tabs | Portable interaction module and Properties recipe | Page activation, subscriptions |
| Fieldset, legend, form row, help | `.win95-fieldset`, `.settings-row`, catalogue Properties | Field descriptions |
| Selectable list/library | Production library rules; working template | Storage, selection model, running state |
| Sequence/condition row | Production step/condition rules; catalogue sequence | Execution semantics and results |
| Table, cue row, inline editing | Catalogue table/edit recipe; existing cue renderer | SMPTE, save/undo, scheduling |
| Matrix/grid selector | Production `.matrix-*`, catalogue range selection | Channel identities and aliases |
| Status, badge, well, instrument | Shared wells and production status rules | Unknown/sent/confirmed truth |
| Meter, peak, ruler, analogue/history | Production meter rules and `runtime/vu-draw.js` | Telemetry, ballistics scheduling, units |
| Log and diagnostics | Production readout/diagnostic rules; catalogue log | Log source, retention and autoscroll policy |
| Dialog, prompt, confirm and notices | Production dialog drawing, native modal recipes | Confirmation queues and destructive actions |
| Settings shell | Production sidebar/content/footer, catalogue Properties | Actual pages and persistence |
| Context menu | Production drawing; catalogue keyboard/edge placement | Target resolution and commands |
| Tooltip and inspector | Production hint drawing, catalogue rich help | Help dictionary and hover timing |
| HUD, toast and alert | Production HUD/courtesy rules; catalogue notices | Sound, urgency, repetition, panic routing |
| Dither, desk and title patterns | Production `runtime/dither.js` | Product targets and background preference |
| Scrollbars, density, responsive layout | Production rules plus explicit window adapters | Minimum size per screen |
| Editorial document and print | Guide window adapter and guide styles | Chapter content and export |

The catalogue deliberately uses example data. Copy the visual recipe and attach
the application's real model; never transplant WING's OSC paths, show engine or
safety policy as if they were UI primitives.

## Decision record

**D01 — Production drawings are extracted, not restyled from memory.**
DOCUMENTED: main window classes `.parameter-menu`, `.win95-dialog`,
`.settings-sidebar`, `.matrix-cell`, `.win95-hover-tooltip` and
`.win95-context-menu` define material details absent from the original specimen.
Consequence: `surfaces.css` retains production literals and original names; a sync
check detects drift. Rejected alternative: another hand-maintained approximation,
which recreates the failure reported by the owner. Overturn this when the main
window itself consumes an equally complete canonical component module.

**D02 — Shared appearance does not transplant domain execution.**
DOCUMENTED: runtime dropdown/dither/VU modules are separable; cue rendering and
macro execution carry application state and protocol semantics.
Consequence: templates supply local demonstration adapters and honest labels.
Rejected alternative: distributing the main application script wholesale, which
would carry remote operations and hidden dependencies into unrelated projects.
Overturn this only for an independently specified domain package.

**D03 — Keep native-size contracts for secondary windows.**
DOCUMENTED: the clock's integration test requires its own readouts inside 420×200
even when a resize request is refused. Consequence: shared chrome has compact
layout adapters, not one universal window arrangement.
Rejected alternative: enlarge the minimum window to make a new header fit.
Overturn this if the owner changes the product's compact-clock requirement.

**D04 — Visual parity and integration checks are complementary.**
MEASURED in the preceding audit: the legacy rules accepted LTC/clock/guide while
the owner identified their appearance as the least representative.
Consequence: the new checker compares canonical chrome at multiple widths/themes;
the existing product browser tests continue to exercise actual settings/popups.
Rejected alternative: treating one green rules report or self-generated screenshot
baseline as aesthetic proof. Overturn this only with a stronger measured oracle.

## Explicit limits

The extraction covers drawings, not every application's interaction semantics.
The compact recipe runtime is not a complete replacement for WING's production
dialog queues, draggable settings, card persistence, nested catalogue resolver,
tooltip scheduler or hardware adapters. Their production tests remain in force.
Native GUI toolkits do not become visually equivalent by importing Swift colour
constants. Host panels, another machine's rendering and another project's final
integration require their own verification; none is claimed here.
