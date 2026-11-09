// WING CONTROLLER's declared deviations from the design kit, one entry per (window, theme, token).
//
// This file is the application's own declaration, and it is the same shape `design/conformance/run.mjs` already
// reads: `{ kitVersion, app, allowApp, deviations: [{ rule?, match, reason }] }`. A deviation is a decision with a
// reason, not a mute button: the suite accepts only what is listed here, reports each one as declared by name, and
// names a declaration that matched nothing so it cannot rot.
//
// One entry per row of `docs/DESIGN_DISAGREEMENTS_2026-10-08.md` marked `DECLARED DEVIATION`. Every match below is
// the window's own value as a hex literal, which is what the conformance suite measures and what the agreement
// checker compares. A row the table marks `WINDOW ADOPTS THE KIT` is deliberately absent: the window's declaration
// was deleted and the kit's value stands (see the commits that linked each window).
//
// `kitVersion` is the version of the copy this app took, read from `design/VERSION`; the suite compares the two and
// fails a declaration left behind by a half-done re-copy.
//
// **This file holds 9 entries, not 11, and the tree now says so (measured 2026-10-08).** Removing the two `#e74c3c`
// entries is what the link completed: `meters.html` no longer declares `--red` (it adopted the kit's #b94444), so a
// checker run with `--no-allow` reports **9 unexplained disagreement(s) · 0 declared**, and this file declares all
// nine. The scripts that carried the old number have been lowered, and each claim here is checkable rather than a
// reading: `scripts/test-design-app-agreement.mjs:68` reads `const RUNNING_TOTAL = 9;`, and
// `scripts/test-design-app-agreement-live.mjs:3` prints `52 tokens, 4 windows · 0 unexplained disagreement(s) · 9
// declared` (46 until the four instrument steps landed the same day). The oracle asserts its running total
// **exactly** - a constant left behind fails with `9 !== 11` - and lowering it "deliberately, in the same change" is
// what its own failure message asks for.
export default {
  kitVersion: '1.5.0',
  app: 'WING CONTROLLER',
  allowApp: 'index.html',
  deviations: [
    {
      rule: 4,
      match: '#1b201f',
      reason:
        'guide.html keeps its own dark sidebar/table-head surface: the guide is a reading window whose dark surface order is inverted against the kit (chrome #222726, sidebar darker), and the kit has no value for a reading pane (DESIGN_DISAGREEMENTS_2026-10-08.md row 2)',
    },
    {
      rule: 4,
      match: '#2c3533',
      reason:
        'guide.html keeps its own dark hover/table-head step: the reading pane is a literal #141917 and the kit cannot express this window\'s three-step dark surface order (row 3)',
    },
    {
      rule: 4,
      match: '#171c1b',
      reason: 'guide.html keeps its own dark search-field surface, part of the same reading-window palette (row 4)',
    },
    {
      rule: 4,
      match: '#e6efeb',
      reason:
        'guide.html keeps its own dark ink: #e6efeb measures 14.07:1 on the sidebar #1b201f against the kit\'s 12.14:1, so the deviation is the higher-contrast one a long-form reading window wants (row 5)',
    },
    {
      rule: 4,
      match: '#b9c6c0',
      reason:
        'guide.html keeps its own dark muted ink: #b9c6c0 measures 8.59:1 on #222726 against the kit\'s 5.80:1, and it is the sidebar note, the empty state and the status bar (row 6)',
    },
    {
      rule: 4,
      match: '#0b0f0e',
      reason: 'guide.html keeps its own dark bevel shadow, the other half of its dark divider pair (row 10)',
    },
    {
      rule: 4,
      match: '#47524e',
      reason: 'guide.html keeps its own dark divider step, used for the sidebar and table separators (row 8)',
    },
    {
      rule: 4,
      match: '#59645f',
      reason: 'guide.html keeps its own dark bevel highlight, the light-before-dark pair preserved (row 9)',
    },
    {
      rule: 4,
      match: '#70e7a9',
      reason:
        'index.html keeps its own dark --win-title-bg, which is an ink here and not a surface: its only use is the About dialog product name (index.html:9757, color: var(--win-title-bg, #000080)), and the kit\'s --win-title-text dark value is the same #70e7a9, so the kit\'s title-bar background #153243 would put navy on the About name in dark. Three roles wear the one name (surface in the kit, ink here, edge in meters.html:1117) and splitting it is a later kit change (DESIGN_DISAGREEMENTS_2026-10-08.md row 13, D1)',
    },
  ],
};
