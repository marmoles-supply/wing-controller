# Paste into the consuming project's AGENTS.md

Our interface uses the pinned WING kit at `<kit path>`, version `<kit version>`.
Read its `AGENT_BRIEF.md` and `workstation/README.md` before changing UI.
Start from `workstation/create.mjs`, then reuse the working template and catalogue
recipes. Keep the vendored kit immutable. Do not redraw its controls, fonts,
colours, bevels, spacing or states in local styles. Cover secondary windows,
settings, menus and dialogs as well as the main screen. Product logic belongs in
an adapter, not inside the kit. Run its canonical parity checker and our product
integration tests; inspect both themes and narrow windows. The old three-sheet
specimen is a legacy example, not the current production target.
