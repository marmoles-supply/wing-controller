# Instructions for agents adopting WING UI

Read `workstation/README.md` and `workstation/COVERAGE.md` first. The production
main window is the visual authority. The old specimen and `reference-window`
are historical simplified examples, not the target for a new product.

1. **Start from the working template.** Run
   `node workstation/create.mjs /absolute/path/to/new-project` from the extracted
   release. It validates the manifest and refuses an existing destination.
2. **Use complete blocks.** Inspect `workstation/index.html` and
   `workstation/catalogue.html`. They include working interactions. Copy their
   structure, then replace names, content and data adapters.
3. **Keep the vendored kit immutable.** Load tokens, components, workstation and
   surfaces in that order. Do not redefine its fonts, scale, colours, bevels,
   shadows, controls, gaps or states. Local CSS arranges domain content.
4. **Cover the whole GUI.** Include secondary windows, settings, dialogs, prompts,
   confirmations, contextual menus, dropdowns, tooltips, notices, lists, matrix
   selection, instruments and error/empty/unavailable states. Use the coverage
   inventory; do not stop at the landing screen.
5. **Reuse behaviour too.** Load the supplied dropdown and field-editing modules
   when using those controls. Preserve native select state. Use semantic buttons,
   labels and dialogs, roving tab focus, Escape and focus return. Bind actions
   independently of how a settings page is opened.
6. **Keep product logic in an adapter.** The kit does not connect to a console,
   execute macros, invent telemetry, persist settings or grant host permissions.
   Follow the runtime integration limits in the README.
7. **Verify against the canonical page.** Run
   `node wing-kit/workstation/check.mjs index.html ./visual-review`.
   Inspect both themes at 420, 820 and 1280 px, and test actual product workflows.
   A green legacy conformance report or a screenshot baseline of your own page
   does not establish resemblance.
8. **Declare what you took.** Keep `<your folder>/design/conformance/allow.mjs`
   with `app`, `allowApp`, `kitVersion` and every deviation as
   `{ rule, match, reason }`. A missing version or a deviation without a reason
   is refused by the runner: a silent exception is not adoption.
9. **Never hard-code a value the kit owns.** If something is missing, change
   `tokens.json` and regenerate the CSS; a value written into a window is a
   second answer to a question the kit already owns.
10. **A control works, or it is absent.** Never a greyed placeholder or a tooltip
   promising a future feature. Numbers the operator reads are `--mono` in a
   well, both themes are looked at, and nothing freezes. Never drive port 9223
   while this repository's verification gate is running; use a private port.
11. **State evidence honestly.** Record measured checks, screenshots and remaining
   host/platform limitations. Never label a native app equivalent just because
   it imported the colour constants.

The earlier brief prescribed three sheets and a simplified one-pair bevel.
That was insufficient: consumers could obey it and still look unlike WING.
The new entry preserves the production material and distributes complete recipes.
