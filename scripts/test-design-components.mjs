// The kit's drawings and its plan each have **one source and a shipped copy**, and this test is what keeps them one
// file.
//
// `design/components.css` (the drawings) and `design/layout.css` (the plan) are canonical: both are hand-written,
// because a component is a decision about structure and a plan is a decision about how a window is composed, and
// neither is a value (`design/UI_SYSTEM.md` §9). The five windows link `components.css`, and `index.html` links
// `layout.css`; they can only link a file that ships, and the packaged frontend is `desktop/ui` byte for byte — so
// `desktop/ui/components.css` and `desktop/ui/layout.css` are the copies, made by
// `scripts/sync-design-components.mjs`. **The list of copies lives in that script** (`COPIED_FILES`) and this test
// reads it, so the writer and the test cannot disagree about *which* files are copies; a hand edit in one of them is a
// drift, and drifts are what this kit exists to prevent, so this names it. It is the mirror of
// `scripts/test-design-tokens.mjs`, which guards the same chain for the kit's values.
//
// `design/layout.css` joined that list on 2026-10-08, in the change that linked it into `index.html`. Until then it had
// no mirror, and the recorded reason was "no window links it, so a mirror nothing links would be a second copy to keep
// in step" — a reason that stopped being true with the link, which is why the mirror arrives in the same commit.
//
// A comparison alone would pass on two empty files, so each copy is also asked for the rules the windows linked it for.
// Those sets are deliberately **not** lists of literal declarations — a copy that matched its canonical file byte for
// byte is already the drawing, and asserting its text twice would be a second source that can only drift from the
// first. What is asserted here is that the *selectors the windows now rely on* are still drawn by the file they load.
//
// Run: node scripts/test-design-components.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHIPPED_COMPONENTS } from './lib/design-components.mjs';
import { COPIED_FILES, COPIED_LAYOUT_NOTICE } from './sync-design-components.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const short = (path) => (path.startsWith(`${REPO}/`) ? path.slice(REPO.length + 1) : path);

// 1. Every copy is its canonical file under its notice, byte for byte.
let totalBytes = 0;
for (const file of COPIED_FILES) {
  const canonical = readFileSync(file.canonical, 'utf8');
  let shipped = null;
  try {
    shipped = readFileSync(file.shipped, 'utf8');
  } catch (_) {
    shipped = null;
  }
  assert.notEqual(
    shipped,
    null,
    `${short(file.shipped)} is missing: run \`node scripts/sync-design-components.mjs\``,
  );
  assert.equal(
    shipped,
    file.render(canonical),
    `${short(file.shipped)} is stale or was edited by hand: run \`node scripts/sync-design-components.mjs\``,
  );
  // The provenance notice is the one this chain writes, so a copy made by another route is not mistaken for a shipped
  // one, and a reader knows which of the two files to edit.
  assert.ok(
    shipped.startsWith(file.notice),
    `${short(file.shipped)} must open with its provenance notice (\`${file.label}\`), so a reader knows which of the ` +
      'two files to edit',
  );
  totalBytes += shipped.length;
}

const shippedComponents = readFileSync(SHIPPED_COMPONENTS, 'utf8');
const shippedLayoutPath = COPIED_FILES.find((file) => file.label === 'design plan').shipped;
const shippedLayout = readFileSync(shippedLayoutPath, 'utf8');

// 2. The component copy still draws the controls the windows linked it for. Each entry is a selector the layer
//    addresses — by the kit's class and by the element — and the list is the five windows' own reason to delete their
//    control rules.
const addresses = [
  ['.c-btn', 'the kit\'s button class'],
  ['button', 'the button element a window with plain markup already has'],
  ['.c-field', 'the kit\'s field class'],
  ['input[type="text"]', 'the text field element'],
  ['textarea', 'the textarea element'],
  ['.c-select', 'the kit\'s select class'],
  ['select', 'the select element, whose platform arrow the layer replaces'],
  ['appearance: none', 'the select reset that makes the kit\'s drawn arrow possible'],
  ['.c-well', 'the well a readout sits in'],
  ['.c-crt', 'the instrument surface'],
  ['button:disabled', 'the unavailable state, whose ink is the kit\'s `--dim`'],
];
for (const [selector, why] of addresses) {
  assert.ok(
    shippedComponents.includes(selector),
    `the shipped component layer no longer carries ${selector} (${why}), which a window deleted its own rule for`,
  );
}

// 3. The plan copy still draws the plan the kit publishes and `index.html` linked it for: the four rules, the folded
//    card, and the two responsive bands that keep the plan inside the window. Without this, a canonical file emptied
//    of its rules would still be "byte for byte" with its copy.
const planAddresses = [
  ['main', 'the rule that gives the window its own width and margin'],
  ['header.master-header', 'the title strip: one row, brand left, transport middle, buttons right'],
  ['.layout', 'the plan itself: two columns with the seam between them'],
  ['.layout.sidebar-left', 'the same plan mirrored, for a window whose instruments belong on the left'],
  ['.column-resizer', 'the seam that is the grid\'s own third track'],
  ['.ops-column', 'the operator column, which is the fixed one'],
  ['.stack', 'the one 8px gap everything in a window shares'],
  ['.builder-column', 'the work column, with the `min-width: 0` that lets it shrink'],
  ['is-collapsed', 'the folded card, the operator column\'s answer to a screenful of readouts'],
  ['@media (max-width: 1400px)', 'the band that stops the plan pushing past the window edge'],
  ['@media (max-width: 1180px)', 'the band that turns the plan into one column'],
];
for (const [selector, why] of planAddresses) {
  assert.ok(
    shippedLayout.includes(selector),
    `the shipped plan no longer carries ${selector} (${why}), which a window linked it for`,
  );
}

// 4. And the plan's notice names the file it was copied from, so a notice left behind by a copy of another sheet is
//    caught rather than trusted (step 1 already compared the copy against the notice it is rendered from).
assert.ok(
  COPIED_LAYOUT_NOTICE.includes('COPIED FILE — do not edit') && COPIED_LAYOUT_NOTICE.includes('design/layout.css'),
  'the plan\'s provenance notice must say it is a copied file and name design/layout.css',
);

console.log(
  `design shipped copies: ${COPIED_FILES.length} ` +
  `(${COPIED_FILES.map((file) => `${short(file.canonical)} -> ${short(file.shipped)}`).join(', ')}) are their canonical ` +
  `files byte for byte · ${totalBytes} bytes · ${addresses.length} control and ${planAddresses.length} plan addresses present`,
);
