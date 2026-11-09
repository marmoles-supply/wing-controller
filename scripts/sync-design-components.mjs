#!/usr/bin/env node
// Write the copies of the kit's layers that the application ships, from the canonical drawings.
//
//   node scripts/sync-design-components.mjs            # writes desktop/ui/components.css and desktop/ui/layout.css
//   node scripts/sync-design-components.mjs --check    # fails instead of writing (for a hook or a review)
//
// The application ships the kit by **copying it beside the window**: the packaged frontend is `desktop/ui` byte for
// byte (`tauri.conf.json` sets `frontendDist: "../ui"` with no bundling step), so a stylesheet outside that folder is
// not in the bundle. Two of the kit's sheets reach a window that way, and this is the **one list** of them
// (`COPIED_FILES` below), read by this writer and by `scripts/test-design-components.mjs`:
//
//   design/components.css -> desktop/ui/components.css   the drawings (the button, the well, the card)
//   design/layout.css     -> desktop/ui/layout.css       the plan (the two columns, the stacks, the folded card)
//
// `design/layout.css` joined that list on 2026-10-08, when `desktop/ui/index.html` linked it: the reason a mirror had
// been refused until then was "no window links it, so a mirror nothing links would be a second copy to keep in step",
// and that reason stops being true the moment a window links it. A third sheet is added to the list below, not to a
// second script.
//
// Each of the two is hand-written and is its own source (`design/UI_SYSTEM.md` §9: a component is a drawing and a plan
// is a decision about composition, not a value), so the copy is those bytes verbatim under a notice that says where
// they came from. The kit's third shipped sheet, `desktop/ui/design-tokens.css`, has its own chain
// (`scripts/sync-design-tokens.mjs`) because its canonical form is **generated** from `design/tokens.json`.
// `scripts/test-design-components.mjs` fails when either copy here drifts from its canonical file or was edited by
// hand.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANONICAL_COMPONENTS,
  COPIED_NOTICE,
  SHIPPED_COMPONENTS,
  renderShippedComponentsCss,
} from './lib/design-components.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/// The header the kit's plan carries in its shipped copy, in the same shape as the component layer's
/// (`COPIED_NOTICE` in `scripts/lib/design-components.mjs`), so a reader who opens either file in the application's
/// folder knows which of the two is the one to edit. It is written here rather than in that module because the module
/// is the component layer's own bridge; the plan's belongs beside the list it is copied by.
export const COPIED_LAYOUT_NOTICE = `/* WING CONTROLLER — the kit's plan, as shipped.
 *
 * COPIED FILE — do not edit. The plan is \`design/layout.css\`, hand-written because how a window is composed is a
 * decision and not a value. This copy exists because the packaged frontend is \`desktop/ui\` byte for byte, so a
 * stylesheet outside it is not shipped. Run \`node scripts/sync-design-components.mjs\` after changing the kit's plan:
 * \`scripts/test-design-components.mjs\` fails when the two differ.
 */
`;

/// Every sheet of the kit the application ships beside a window: its canonical drawing, the path the copy lives at, the
/// provenance notice the copy opens with, and the one function that renders the copy from the canonical bytes.
///
/// The notice is a field rather than a second rendering rule so the test can ask each copy for the header it is
/// supposed to carry without repeating the text; `render` is what the writer and the test both compare against, and for
/// the component layer it is the layer's own bridge (`renderShippedComponentsCss`), which stays the authority for
/// those bytes.
export const COPIED_FILES = [
  {
    label: 'workstation chrome',
    canonical: resolve(REPO, 'design/workstation.css'),
    shipped: resolve(REPO, 'desktop/ui/workstation.css'),
    notice: '/* COPIED FILE — edit design/workstation.css; run node scripts/sync-design-components.mjs. */',
    render: (canonical) => `/* COPIED FILE — edit design/workstation.css; run node scripts/sync-design-components.mjs. */\n${canonical}`,
  },
  {
    label: 'design components',
    canonical: CANONICAL_COMPONENTS,
    shipped: SHIPPED_COMPONENTS,
    notice: COPIED_NOTICE,
    render: renderShippedComponentsCss,
  },
  {
    label: 'design plan',
    canonical: resolve(REPO, 'design/layout.css'),
    shipped: resolve(REPO, 'desktop/ui/layout.css'),
    notice: COPIED_LAYOUT_NOTICE,
    render: (canonical) => `${COPIED_LAYOUT_NOTICE}\n${canonical}`,
  },
];

function short(path) {
  return path.startsWith(`${REPO}/`) ? path.slice(REPO.length + 1) : path;
}

/// Write every copy that is not already its canonical bytes, and answer how many were stale.
export function syncCopiedFiles({ checkOnly = false, log = console.log, error = console.error } = {}) {
  let stale = 0;
  for (const file of COPIED_FILES) {
    const wanted = file.render(readFileSync(file.canonical, 'utf8'));
    let current = null;
    try {
      current = readFileSync(file.shipped, 'utf8');
    } catch (_) {
      current = null;
    }
    const name = file.label;
    if (current === wanted) {
      log(`${name}: the shipped copy already matches ${short(file.canonical)}`);
      continue;
    }
    stale += 1;
    if (checkOnly) {
      error(
        `${name}: ${short(file.shipped)} does not match ${short(file.canonical)} — ` +
          'run `node scripts/sync-design-components.mjs`',
      );
      continue;
    }
    writeFileSync(file.shipped, wanted);
    log(
      current === null
        ? `${name}: wrote ${short(file.shipped)} from ${short(file.canonical)}`
        : `${name}: refreshed ${short(file.shipped)} from ${short(file.canonical)}`,
    );
  }
  return stale;
}

// Only run when invoked as a command: `scripts/test-design-components.mjs` imports the list above, and importing a
// script must not write files or exit the process.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkOnly = process.argv.includes('--check');
  const stale = syncCopiedFiles({ checkOnly });
  process.exit(checkOnly && stale > 0 ? 1 : 0);
}
