// The kit's own allowance — the declaration `conformance/run.mjs` reads when it is given no `--allow`.
//
// THIS DECLARES THE KIT'S OWN PAGE, NOT YOURS. It names the reference window that travels inside this artefact
// and no deviations, because that page passes every rule in both themes: it is the kit showing itself, and it is
// the only page the tarball owns. **Replace `allowApp` with your window and declare your own deviations, each
// with its reason** — `adopt/allow.mjs.example` explains every field, and a deviation without a reason is a
// defect, never a mute button.
//
// GENERATED — do not edit. Written at pack time by `scripts/lib/kit-package.mjs` from the `VERSION` file beside
// this one, so the number below cannot be left behind by a half-done re-copy: a declaration that disagrees with
// the kit it stands in is a failure `run.mjs` reports before it measures anything.
export default {
  kitVersion: '1.5.0',
  // What the drift dashboard calls this row. It is the kit's own page, so it says so.
  app: 'Wing Controller reference window',
  // The window this declaration is about, relative to THIS FILE's directory (`conformance/`) — which is how
  // `report.mjs` resolves it. Replace with your page.
  allowApp: '../reference-window/index.html',
  // The kit's reference window passes every rule in both themes. A deviation invented here would be a mute
  // button in a kit whose whole argument is that one is a decision with a reason.
  deviations: [],
};
