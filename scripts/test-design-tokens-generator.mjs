// ITEM 1 of `design/DESIGN-SYSTEM-ROADMAP.md`: `design/tokens.css` is **generated** from `design/tokens.json`.
//
// The roadmap asks for this to be proven by its own acceptance test — "delete `tokens.css`, run the generator, and the
// file comes back byte-identical; then change one value in the JSON, regenerate, and the CSS changes with it" — and this
// project's standard is that a claim of that kind is not a pasted shell session but a test that can fail. Both halves are
// asserted here, against inputs this test controls (a copy of the JSON, rendered in memory), so neither depends on the
// state of the working tree beyond the committed files themselves.
//
// Why byte-identity rather than "the same values": the committed CSS is what defines the generator's comments, group
// order and line breaks. A generator that produced a reordered or reformatted stylesheet would still be correct and would
// still make the diff of every future change unreadable. Comparing bytes is what keeps the generated file the file the
// hand-written one was.
//
// Run: node scripts/test-design-tokens-generator.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { renderCanonicalCss } from './generate-design-tokens.mjs';
import { CANONICAL_CSS, CANONICAL_JSON } from './lib/design-tokens.mjs';

const json = JSON.parse(readFileSync(CANONICAL_JSON, 'utf8'));
const committed = readFileSync(CANONICAL_CSS, 'utf8');

/// The first line where two texts differ, so a failure names the declaration instead of printing both whole files. A
/// generated stylesheet is compared byte for byte, and "line 40: committed X, generated Y" is the sentence a reader can
/// act on.
function firstDifference(a, b) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  for (let index = 0; index < Math.max(aLines.length, bLines.length); index += 1) {
    if (aLines[index] !== bLines[index]) {
      return { line: index + 1, committed: aLines[index], generated: bLines[index] };
    }
  }
  return null;
}

// 1. The committed CSS is exactly what the generator renders. This is the acceptance test with teeth: a hand edit to
// `design/tokens.css`, or a JSON value that was changed without regenerating, reddens it. Proof by breaking it on
// purpose is in the commit that added this file, by typing `--accent: #000081;` into the generated CSS by hand.
const rendered = renderCanonicalCss();
const drift = firstDifference(committed, rendered);
assert.equal(
  drift,
  null,
  drift
    ? `design/tokens.css is not what design/tokens.json generates — first difference at line ${drift.line}: ` +
      `committed ${JSON.stringify(drift.committed)}, generated ${JSON.stringify(drift.generated)}. ` +
      'Run `node scripts/generate-design-tokens.mjs`; do not edit the generated file by hand.'
    : '',
);
// 2. A changed value in the JSON changes the generated CSS, and nothing else. The probe is rendered in memory; the tree
// is not touched, and the mutation the generator cannot hide from is this one: rendering a JSON whose accent is #010203
// must produce #010203 in the CSS. Proof by breaking it on purpose is in the same commit, with the accent pinned inside
// the generator so the JSON's accent could no longer reach the CSS — the probe then rendered the old #000080.
const probe = structuredClone(json);
probe.theme.light.accent = '#010203';
const changed = renderCanonicalCss(probe);
if (changed === committed) {
  assert.fail(
    'a changed value in design/tokens.json must change the generated CSS: rendering --accent #010203 was byte-identical ' +
      `to ${json.theme.light.accent}, so that value no longer comes from the JSON`,
  );
}
assert.ok(
  changed.includes('  --accent: #010203;'),
  'a changed value in design/tokens.json must change the generated CSS; --accent is still the old one',
);
// Exactly one line differs, so the test names the declaration the value feeds rather than "the file changed somewhere".
const committedLines = committed.split('\n');
const changedLines = changed.split('\n');
assert.equal(changedLines.length, committedLines.length, 'changing a colour must not add or remove lines');
const differing = changedLines.filter((line, index) => line !== committedLines[index]);
assert.deepEqual(
  differing,
  ['  --accent: #010203;'],
  `changing one JSON value must change exactly its declaration; the diff was ${JSON.stringify(differing)}`,
);

// 2b. The rename the kit took while it was in there: the JSON key is `meterRamp` like the other 15, and the CSS custom
// property is still `--meter-ramp` — the CSS is the form every existing consumer reads, so its spelling is unchanged.
assert.ok(
  Object.hasOwn(json.instrument, 'meterRamp'),
  'design/tokens.json must spell the ramp key `meterRamp`, like the other camelCase keys',
);
assert.ok(
  !Object.hasOwn(json.instrument, 'meter-ramp'),
  'design/tokens.json must not keep the hyphenated `meter-ramp` key: the rename is the kit\'s decision',
);
const rampProbe = structuredClone(json);
rampProbe.instrument.meterRamp = 'linear-gradient(to right, #111111 0%, #222222 100%)';
assert.ok(
  renderCanonicalCss(rampProbe).includes('  --meter-ramp: linear-gradient(to right,\n    #111111 0%, #222222 100%);'),
  'the ramp value must come from the JSON and land on `--meter-ramp`, wrapped as the committed file wraps it',
);

// 3. A JSON value the generator needs and cannot find stops it, naming the path, instead of rendering `undefined` into
// the stylesheet. A generated file that contains `undefined` still parses and still "regenerates", which is the silent
// failure this kit exists to prevent.
const missing = structuredClone(json);
delete missing.instrument.meterRamp;
assert.throws(
  () => renderCanonicalCss(missing),
  /instrument\.meterRamp/,
  'a missing JSON value must stop the generator and name its path',
);

console.log(
  `design tokens generator: ${committed.length} bytes of design/tokens.css reproduced from design/tokens.json · ` +
    `a changed value changes the CSS · the ramp key is meterRamp and the property is --meter-ramp`,
);
