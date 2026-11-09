#!/usr/bin/env node
// Write the copy of the design tokens the application ships, from the **generated** canonical CSS.
//
//   node scripts/sync-design-tokens.mjs            # writes desktop/ui/design-tokens.css
//   node scripts/sync-design-tokens.mjs --check    # fails instead of writing (for a hook or a review)
//
// The chain is now three links, and each file has exactly one writer:
//
//   design/tokens.json --(scripts/generate-design-tokens.mjs)--> design/tokens.css --(this script)--> desktop/ui/...
//
// `design/tokens.json` is the one file a human edits; `design/tokens.css` is rendered from it by the generator; the copy
// has to live in `desktop/ui/` because that folder **is** the packaged frontend, byte for byte. This script renders the
// canonical CSS through the generator (rather than reading whatever the file happens to contain) and refuses when the
// committed file is not what the JSON generates — so a JSON edit cannot be half-applied to the shipped copy while
// `design/tokens.css` still shows the old value. `scripts/test-design-tokens.mjs` fails when the copy drifts from the
// canonical file, and `scripts/test-design-tokens-generator.mjs` fails when the canonical file drifts from the JSON.

import { readFileSync, writeFileSync } from 'node:fs';

import { renderCanonicalCss } from './generate-design-tokens.mjs';
import { CANONICAL_CSS, SHIPPED_CSS, renderShippedCss } from './lib/design-tokens.mjs';

const checkOnly = process.argv.includes('--check');

// The canonical CSS as the generator renders it, never as the file happens to read. `renderCanonicalCss()` fails loudly
// when the JSON is missing something it needs, which is the point: an empty or stale CSS is not a quiet fallback.
const generatedCanonical = renderCanonicalCss();
let committedCanonical = null;
try {
  committedCanonical = readFileSync(CANONICAL_CSS, 'utf8');
} catch (_) {
  committedCanonical = null;
}
if (committedCanonical !== generatedCanonical) {
  console.error(
    'design tokens: design/tokens.css is not what design/tokens.json generates — ' +
      'run `node scripts/generate-design-tokens.mjs` first, then this script',
  );
  process.exit(1);
}

const wanted = renderShippedCss(generatedCanonical);

let current = null;
try {
  current = readFileSync(SHIPPED_CSS, 'utf8');
} catch (_) {
  current = null;
}

if (current === wanted) {
  console.log('design tokens: the shipped copy already matches the generated design/tokens.css');
  process.exit(0);
}

if (checkOnly) {
  console.error(
    'design tokens: desktop/ui/design-tokens.css does not match the generated design/tokens.css — ' +
      'run `node scripts/sync-design-tokens.mjs`',
  );
  process.exit(1);
}

writeFileSync(SHIPPED_CSS, wanted);
console.log(
  current === null
    ? 'design tokens: wrote desktop/ui/design-tokens.css from the generated design/tokens.css'
    : 'design tokens: refreshed desktop/ui/design-tokens.css from the generated design/tokens.css',
);
