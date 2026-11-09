// The specimen's acceptance test: **every token in `design/tokens.json` has a sample in `design/specimen.html`**, and
// the check fails by naming the token that has none.
//
// Why this test is the deliverable as much as the page is: a specimen that silently omits the token somebody just
// added is worse than no specimen, because it *looks* complete. The page is the only artefact an agent that cannot see
// a screen can open and compare against, so a gap in it is a gap in the design system's ability to be reproduced.
//
// The list of tokens is read **when this check runs** (`requiredSamples()` re-reads `tokens.json` on every call), never
// baked into this file or into the page: `tokens.json` is the machine-readable authority and another session is
// currently renaming a key in it and generating the CSS from it. The CSS names come from the kit's own `toCssName`,
// so the two spellings (`winBtnFace` and `--win-btn-face`) have one home.
//
// What it checks:
//   1. every token `tokens.json` carries has a `[data-token]` sample, and a token with none is **named** in the failure;
//   2. every bevel shape it carries has a `[data-bevel]` sample;
//   3. every word in §8 of `UI_SYSTEM.md` has a `[data-component]` sample — "every component" means the same thing as
//      "every token", read from the document rather than from a list written here;
//   4. the reverse direction: a sample for a token the kit no longer declares is a lie, and is named too;
//   5. nothing on the page would need a network; it links the kit's own `tokens.css`; its own stylesheet invents no
//      colour; and its own script parses, so a page that would render nothing is caught without a browser;
//   6. both themes are present as their own column on the one page, which is what the roadmap asks for;
//   7. this check's own derivation covers every token `tokens.css` declares, so a token the JSON forgot cannot be
//      invisible here as well.
//
// The browser suite (`scripts/test-specimen-browser.mjs`) then renders the page and checks the same token set on
// screen, because a source-text check passes while the screen shows nothing (roadmap §6).
//
// Run: node scripts/test-specimen.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COMPONENTS_CSS,
  SPECIMEN_HTML,
  UI_SYSTEM_MD,
  componentClasses,
  cssTokenNames,
  declaredClasses,
  externalReferences,
  literalColours,
  missingTokenSentences,
  readVocabulary,
  requiredSamples,
  specimenGaps,
} from './lib/specimen.mjs';

const html = readFileSync(SPECIMEN_HTML, 'utf8');
const required = requiredSamples();
const vocabulary = readVocabulary();
const gaps = specimenGaps(html, required, vocabulary);

// 0. The derivation itself has to be complete: a shape in `tokens.json` this check does not know how to require a
// sample for is reported instead of being skipped, because "the check did not look" and "there is nothing to look at"
// must not have the same output.
assert.equal(
  gaps.problems.length,
  0,
  `the specimen coverage check cannot read all of design/tokens.json:\n  ${gaps.problems.join('\n  ')}`,
);

// 1. The acceptance test. This is the one that must fail by naming the token with no sample.
const missingTokens = missingTokenSentences(gaps.missingTokens);
assert.equal(
  gaps.missingTokens.length,
  0,
  [
    `design/specimen.html has no sample for ${gaps.missingTokens.length} token(s) that design/tokens.json declares.`,
    'A reader of the specimen would not see that the kit has them at all, because the page would look complete.',
    'Add one sample per token below, naming it with data-token="<css name>":',
    ...missingTokens.map((sentence) => `  ${sentence}`),
  ].join('\n'),
);

// 2. The two bevel shapes are one of the kit's decisions (§4), so each must be drawn, not described.
assert.equal(
  gaps.missingBevels.length,
  0,
  `design/specimen.html draws no sample for ${gaps.missingBevels.map((b) => `bevel.${b.key}`).join(', ')}: ` +
  `draw it with data-bevel="<key>" so the page shows the two shapes rather than asserting them`,
);

// 3. Every component word of §8. The words are read from the document at check time.
assert.equal(
  gaps.missingComponents.length,
  0,
  `design/specimen.html has no component sample for: ${gaps.missingComponents.join(', ')} ` +
  `(the vocabulary of §8 of ${UI_SYSTEM_MD}); name each with data-component="<word>"`,
);

// 4. And the other direction: a sample for something the kit does not carry reads as coverage of a value that no
// longer exists — the same defect as a stale comment.
assert.deepEqual(
  gaps.staleTokens,
  [],
  `design/specimen.html samples ${gaps.staleTokens.join(', ')}, which design/tokens.json does not declare: ` +
  `delete the sample or the token, but do not leave a page that shows a value the kit does not have`,
);
assert.deepEqual(
  gaps.staleBevels,
  [],
  `design/specimen.html samples bevel(s) ${gaps.staleBevels.join(', ')}, which design/tokens.json does not declare`,
);

// 5. The kit's own rule: nothing is downloaded. A web font or a CDN link would make the page render differently on the
// machine that matters and would tie the reference to something outside this folder.
const external = externalReferences(html);
assert.deepEqual(
  external,
  [],
  `design/specimen.html refers to ${external.join(', ')}: the specimen must render with no network access, so its only ` +
  `external file is the kit's own tokens.css, beside it`,
);
assert.match(html, /<link[^>]*href="tokens\.css"/, 'design/specimen.html must link tokens.css, the canonical values');

// 5b. The specimen is the reference, so it obeys §11.3 itself: its own stylesheet is drawn from tokens, never from a
// colour invented beside them. A specimen with a palette of its own would teach that palette to the next agent.
const stylesheet = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
assert.ok(stylesheet.length > 0, 'design/specimen.html must carry its own stylesheet');
const literals = literalColours(stylesheet);
assert.deepEqual(
  literals,
  [],
  `design/specimen.html's own stylesheet uses literal colours: ${literals.join(', ')} — the specimen must be drawn ` +
  `from the kit's tokens, or it teaches a palette the kit does not have`,
);

// 5c. The page draws itself: the printed values, the dark column and the filter are its own script. A syntax error
// there would leave a page that looks complete and prints nothing, so it is checked here as well as in the browser
// suite — the everyday `--quick` gate does not run the browser suites, and this must not be the reason one is needed.
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
assert.ok(script.length > 0, 'design/specimen.html must carry its own script');
assert.doesNotThrow(() => new Function(script), "design/specimen.html's own script must parse");

// 5d. **The kit's component layer is linked, before the page's own rules, and the page does not retype it.** The rule
// this encodes is the one the kit learned from a consumer that wrote its own `button` rule after the kit's link: *a
// component sheet the kit's own page does not use is a copy rather than a layer*. Both halves are checked here,
// because either alone can be satisfied while the defect stands: the link exists and comes first, and **none of the
// classes `components.css` draws is declared again in this page's own stylesheet**. A specimen that retyped a
// component would look complete while teaching the consumer to retype it too.
const componentsAt = html.indexOf('href="components.css"');
assert.ok(
  componentsAt !== -1,
  'design/specimen.html must link components.css: it is the kit\'s component layer, and a layer the kit\'s own page ' +
    'does not use is a copy rather than a layer',
);
assert.ok(
  componentsAt < html.indexOf('<style>'),
  'design/specimen.html must link components.css BEFORE its own <style>, so the kit is not the override and a ' +
    'deliberate specimen-specific rule still wins',
);

// 5e. And the layer obeys the same rule the specimen does: it is drawn from the kit's tokens, never from a colour
// invented beside them, and it reaches nothing outside the kit. A literal in the file a consumer links instead of
// writing its own controls would teach that literal to every project that takes the kit.
const componentsCss = readFileSync(COMPONENTS_CSS, 'utf8');
const componentLiterals = literalColours(componentsCss);
assert.deepEqual(
  componentLiterals,
  [],
  `design/components.css uses literal colours: ${componentLiterals.join(', ')} — the layer a consumer links must be ` +
    `drawn from the kit's tokens, not from a palette written beside them`,
);
const componentExternal = externalReferences(componentsCss);
assert.deepEqual(
  componentExternal,
  [],
  `design/components.css refers to ${componentExternal.join(', ')}: the layer must render with no network access, ` +
    `exactly like the kit's own page`,
);

const declaredInPage = new Set(declaredClasses(stylesheet));
const retyped = componentClasses(componentsCss).filter((name) => declaredInPage.has(name));
assert.deepEqual(
  retyped,
  [],
  `design/specimen.html declares ${retyped.map((name) => `.${name}`).join(', ')}, which design/components.css already ` +
    `draws: link the layer and delete the copy, or the specimen is a second answer to a question the kit has one ` +
    `answer to`,
);

// 6. Both themes, on one page, each as its own column — that is what "side by side" means in the roadmap's ITEM 4.
for (const theme of ['light', 'dark']) {
  assert.match(
    html,
    new RegExp(`<section[^>]*data-theme="${theme}"`),
    `design/specimen.html must render the ${theme} theme as its own column`,
  );
}

// 7. A guard on this check's own derivation: every token `tokens.css` declares must be one this check knows how to
// require. The other test compares the two forms only for literal values (a colour, a gradient), so a *non-literal*
// token added to the CSS and forgotten in the JSON would pass there and would be invisible here — which is exactly
// the kind of hole the specimen exists to close.
const notRequired = cssTokenNames().filter((name) => !required.tokens.has(name));
assert.deepEqual(
  notRequired,
  [],
  `design/tokens.css declares ${notRequired.join(', ')}, which this coverage check does not require a sample for: ` +
  `teach requiredSamples() in scripts/lib/specimen.mjs where that token lives in tokens.json`,
);

console.log(
  `specimen: ${required.tokens.size} tokens, ${required.bevels.size} bevels and ${vocabulary.length} components ` +
  `sampled in both themes · no external reference · tokens read from tokens.json when this check ran`,
);
