// The design kit has **one source of truth and two forms**, and this test is what makes that true rather than aspirational.
//
//   1. `design/tokens.css` is canonical. The application ships a copy at `desktop/ui/design-tokens.css` (the packaged
//      frontend is `desktop/ui`, byte for byte, so a file outside it is not shipped), and the copy must be exactly what
//      the synchroniser generates — a hand edit there is a drift, and drifts are what this kit exists to prevent.
//   2. `design/tokens.json` carries the same values for a consumer that is not CSS. A value added to one form and
//      forgotten in the other is a defect, and this names it — which is not hypothetical: on 2026-10-07 another session
//      added a meter ramp to both files **by hand** and nothing checked that the two agreed.
//   3. The kit still declares what it claims to declare, so an accidental deletion of a whole theme is caught here rather
//      than by an application that suddenly renders in the light palette on a dark desk.
//
// Run: node scripts/test-design-tokens.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CANONICAL_CSS,
  CANONICAL_JSON,
  SHIPPED_CSS,
  readCanonicalCss,
  readCanonicalJson,
  renderShippedCss,
  tokenDisagreements,
} from './lib/design-tokens.mjs';

// 1. The shipped copy is the generated one, byte for byte.
let shipped = null;
try {
  shipped = readFileSync(SHIPPED_CSS, 'utf8');
} catch (_) {
  shipped = null;
}
assert.notEqual(
  shipped,
  null,
  'desktop/ui/design-tokens.css is missing: run `node scripts/sync-design-tokens.mjs`',
);
assert.equal(
  shipped,
  renderShippedCss(readFileSync(CANONICAL_CSS, 'utf8')),
  'desktop/ui/design-tokens.css is stale or was edited by hand: run `node scripts/sync-design-tokens.mjs`',
);

// 2. The two forms carry the same values.
const disagreements = tokenDisagreements();
assert.deepEqual(
  disagreements,
  [],
  `design/tokens.css and design/tokens.json disagree:\n  ${disagreements.join('\n  ')}`,
);

// 2b. **Both directions, on inputs this test controls.** The comparison above runs on the live files and passes while
// those two files agree, so it cannot tell whether a direction exists at all: delete the JSON -> CSS half of
// `tokenDisagreements` and every assertion above still passes. A JSON-only value is the direction a JSON-first workflow
// produces constantly (a plugin, a mobile app, a build script), so each direction is pinned here against an emptied
// counterpart. This is the acceptance test the design roadmap asks for, made permanent instead of pasted once.
const cssText = readFileSync(CANONICAL_CSS, 'utf8');
const emptyJson = { theme: { light: {}, dark: {} }, instrument: {} };
const cssToJson = tokenDisagreements(cssText, emptyJson);
assert.ok(
  cssToJson.some((problem) => problem.includes('tokens.json has no entry for')),
  `a CSS-only token must be reported as missing from the JSON; got ${JSON.stringify(cssToJson.slice(0, 3))}`,
);

const jsonOnly = {
  theme: { light: { roadmapItemTwoProbe: '#123456' }, dark: {} },
  instrument: {},
};
const jsonToCss = tokenDisagreements(cssText, jsonOnly);
assert.ok(
  jsonToCss.some(
    (problem) => problem.includes('roadmap-item-two-probe') && problem.includes('tokens.css has no'),
  ),
  `a JSON-only token must be reported as missing from the CSS, naming it; got ${JSON.stringify(jsonToCss.slice(0, 3))}`,
);

// 3. The kit still says what it claims to say.
const css = readCanonicalCss();
const json = readCanonicalJson();
assert.ok(css.light.size >= 20, `the light theme must still be declared (found ${css.light.size} tokens)`);
assert.ok(css.dark.size >= 15, `the dark theme must still be declared (found ${css.dark.size} tokens)`);
assert.ok(
  css.shared.size >= 2,
  `the instrument's tokens are declared once and shared by both themes (found ${css.shared.size})`,
);
assert.equal(json.raw.version, readFileSync(new URL('../design/VERSION', import.meta.url), 'utf8').trim(),
  'design/VERSION and the version inside tokens.json must agree');

console.log(
  `design tokens: ${css.light.size} light, ${css.dark.size} dark, ${css.shared.size} theme-independent · ` +
  `version ${json.raw.version} · the shipped copy matches design/tokens.css`,
);
