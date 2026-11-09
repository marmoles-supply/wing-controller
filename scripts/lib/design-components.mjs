// The bridge between `design/components.css` (the kit's **drawings**, hand-written) and the copy the application ships.
//
// Why a copy at all: the packaged frontend is `desktop/ui`, **byte for byte** (`tauri.conf.json` sets
// `frontendDist: "../ui"` with no bundling step), so a stylesheet outside that folder is not shipped. The five windows
// link `design-tokens.css` for the values and `components.css` for the drawings, and both of those are copies that live
// in `desktop/ui` — this module is the second half of that chain, and the exact mirror of
// `scripts/lib/design-tokens.mjs`.
//
// Why a bridge rather than a second source: a rule written twice drifts, so the copy is made by
// `scripts/sync-design-components.mjs` and `scripts/test-design-components.mjs` fails when the two disagree. What is
// different from the tokens is only where the bytes come from: `design/tokens.css` is *generated* from
// `design/tokens.json`, while `design/components.css` is itself the source, so the copy is those bytes verbatim under a
// notice that says where they came from (`design/UI_SYSTEM.md` §9: "`design/components.css` is the one part that is
// **not** generated, because a component is a drawing and not a value").

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const CANONICAL_COMPONENTS = resolve(REPO, 'design/components.css');
export const SHIPPED_COMPONENTS = resolve(REPO, 'desktop/ui/components.css');

/// The header the shipped copy carries, so a reader who opens it in the application's folder knows where it came from
/// and that editing it here is editing the wrong file.
export const COPIED_NOTICE = `/* WING CONTROLLER — the kit's component layer, as shipped.
 *
 * COPIED FILE — do not edit. The drawing is \`design/components.css\`, hand-written because a component is a decision
 * about structure and not a value. This copy exists because the packaged frontend is \`desktop/ui\` byte for byte, so a
 * stylesheet outside it is not shipped. Run \`node scripts/sync-design-components.mjs\` after changing the kit's
 * drawing: \`scripts/test-design-components.mjs\` fails when the two differ.
 */
`;

/// What the shipped copy must contain, byte for byte.
export function renderShippedComponentsCss(canonical = readFileSync(CANONICAL_COMPONENTS, 'utf8')) {
  return `${COPIED_NOTICE}\n${canonical}`;
}
