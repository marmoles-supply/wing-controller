// What `design/specimen.html` owes the kit, in one place.
//
// The specimen is the artefact an agent that cannot see a screen opens, screenshots and compares its own work
// against, so the dangerous failure is not that it looks wrong — it is that it looks *complete* while a token the
// kit declares has no sample at all. This module answers the only question that prevents that: **which samples does
// `design/tokens.json` require?**
//
// Two rules shape it:
//
//   1. **The list is read when the check runs, never baked in.** `tokens.json` is the machine-readable form of the
//      kit and it is the authority for the token set; another session is renaming a key in it and generating the CSS
//      from it right now, so a list copied into a test (or into the page) would be stale by the time it was read.
//      The CSS names are derived with `toCssName` from `./design-tokens.mjs` — the kit's own single home for the two
//      spellings (`winBtnFace` <-> `--win-btn-face`), not a second convention written here.
//   2. **A gap must never pass silently, and a check must not fail for the wrong reason.** Anything in a value-bearing
//      section that this module does not know how to require a sample for is reported as a `problem` instead of being
//      ignored; prose and identity keys are named explicitly so they are not mistaken for values.
//
// The static test (`scripts/test-specimen.mjs`) parses the page with this module. The browser suite
// (`scripts/test-specimen-browser.mjs`) renders it and uses the same `requiredSamples()` — so "every token" cannot mean
// two different things in the two checks.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANONICAL_CSS, CANONICAL_JSON, readCanonicalCss, toCssName } from './design-tokens.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const SPECIMEN_HTML = resolve(REPO, 'design/specimen.html');
export const UI_SYSTEM_MD = resolve(REPO, 'design/UI_SYSTEM.md');
/// The kit's component layer: the sheet a consumer links instead of writing its own controls, and the sheet the
/// specimen draws itself with. It is separate from `tokens.css` because it is **not** generated: a token is a value and
/// a component is a decision about structure.
export const COMPONENTS_CSS = resolve(REPO, 'design/components.css');

/// Top-level keys of `tokens.json` that are identity or prose, not values a reader has to see rendered. Named here so
/// that "unknown key" means unknown — not "the one key I forgot to allow".
const PROSE_KEYS = new Set(['name', 'version', 'source', 'notes']);

/// The sections that carry values and are walked below. A **new top-level section** is reported as a problem rather
/// than ignored: a whole class of values the specimen does not show is exactly the omission this module exists to
/// catch, and the fix (teach this module, then add samples) is a decision a human should make.
///
/// `layout` joined the list on 2026-10-08 with `opsColWidth` (`--ops-col-width`, the operator column's width), and this
/// is what the note above asks for: the section was added to `tokens.json`, this module was taught that its keys become
/// their own CSS names, and the specimen gained the sample. A value the kit publishes and its own reference page does
/// not show is the "looks complete" failure this file exists to make impossible.
///
/// `leading` joined the same way on 2026-10-08 with one step, `base` (`--leading-base`, the line box `layout.css` gives
/// `body`): its keys are step names like `space`'s, so the prefix is written where the sample name is built below. The
/// family is one step and the code is one loop, because how many steps a family has is the JSON's decision and not this
/// module's.
const VALUE_SECTIONS = new Set(['theme', 'type', 'space', 'leading', 'layout', 'bevel', 'instrument']);

/// The bevel keys that are a shape rather than a rule: each must be demonstrated with `data-bevel="<key>"`. `rule` is
/// the sentence that explains them and has nothing to render.
const BEVEL_SHAPES = new Set(['raised', 'sunken']);

/// Every sample the specimen must contain, derived from `tokens.json` as it is **now**.
///
/// Returns `{ tokens, bevels, problems }`:
///   * `tokens`  — `Map<cssName, { name, declared: Set<'light'|'dark'|'shared'>, origins: string[] }>`. `origins`
///                 names the JSON path and value, so a failure can tell a reader exactly where the unsampled token
///                 came from.
///   * `bevels`  — `Map<key, { key, value, origin }>` for `bevel.raised` / `bevel.sunken`.
///   * `problems`— sentences describing a shape this derivation does not know how to require a sample for.
export function requiredSamples(json = JSON.parse(readFileSync(CANONICAL_JSON, 'utf8'))) {
  const tokens = new Map();
  const bevels = new Map();
  const problems = [];

  const add = (cssName, declared, value, origin) => {
    if (typeof value !== 'string') {
      problems.push(`${origin} is ${JSON.stringify(value)}, and this check only knows how to require a sample for a string value`);
      return;
    }
    const entry = tokens.get(cssName) ?? { name: cssName, declared: new Set(), origins: [] };
    entry.declared.add(declared);
    entry.origins.push(`${origin} = ${value}`);
    tokens.set(cssName, entry);
  };

  for (const [key, value] of Object.entries(json)) {
    if (PROSE_KEYS.has(key)) continue;
    if (!VALUE_SECTIONS.has(key)) {
      problems.push(
        `tokens.json has a section this coverage check does not know: "${key}". Either it is prose (add it to ` +
        `PROSE_KEYS) or it carries values the specimen must show (teach requiredSamples() about it, then add samples)`,
      );
      continue;
    }
  }

  for (const theme of ['light', 'dark']) {
    const section = json.theme?.[theme];
    if (section === undefined) continue;
    for (const [key, value] of Object.entries(section)) {
      add(toCssName(key), theme, value, `theme.${theme}.${key}`);
    }
  }

  const instrument = json.instrument ?? {};
  for (const [key, value] of Object.entries(instrument)) {
    add(toCssName(key), 'shared', value, `instrument.${key}`);
  }

  const type = json.type ?? {};
  for (const [key, value] of Object.entries(type)) {
    if (key === 'winFont') add('--win-font', 'shared', value, 'type.winFont');
    else if (key === 'mono') add('--mono', 'shared', value, 'type.mono');
    // The knob is named by its **value** (`meterScale`), because that is the token's name in CSS; the key is a
    // description of what it does.
    else if (key === 'scaleKnob') add(toCssName(value), 'shared', value, 'type.scaleKnob');
    else if (key === 'steps') {
      if (!Array.isArray(value)) {
        problems.push(`type.steps is ${JSON.stringify(value)}, and this check reads it as the list of font steps`);
        continue;
      }
      for (const step of value) add(`--font-${step}`, 'shared', step, `type.steps["${step}"]`);
    } else {
      problems.push(
        `tokens.json has a type value this coverage check does not know: "type.${key}". Teach requiredSamples() ` +
        `about it (which CSS token it becomes), so the specimen cannot omit it`,
      );
    }
  }

  const space = json.space ?? {};
  for (const [key, value] of Object.entries(space)) {
    add(`--space-${key}`, 'shared', value, `space.${key}`);
  }

  // The composition layer's own measurements. Unlike `space`, whose keys carry the `space-` prefix, these keys ARE the
  // CSS names (`opsColWidth` -> `--ops-col-width`), because that is what `design/layout.css` reads and what a consumer
  // declares. They are theme-independent: a column is furniture, not a palette.
  const layout = json.layout ?? {};
  for (const [key, value] of Object.entries(layout)) {
    add(toCssName(key), 'shared', value, `layout.${key}`);
  }

  // The leading family. Its keys are step names like `space`'s — the CSS name carries the prefix, the JSON key does
  // not — so the sample name is built the same way. Theme-independent: a line box is typography and not a palette.
  const leading = json.leading ?? {};
  for (const [key, value] of Object.entries(leading)) {
    add(`--leading-${key}`, 'shared', value, `leading.${key}`);
  }

  const bevel = json.bevel ?? {};
  for (const [key, value] of Object.entries(bevel)) {
    if (key === 'rule') continue;
    if (!BEVEL_SHAPES.has(key)) {
      problems.push(
        `tokens.json has a bevel this coverage check does not know: "bevel.${key}". Add it to BEVEL_SHAPES and draw ` +
        `it with data-bevel="${key}", or the specimen will show a kit that has two bevels while the file has three`,
      );
      continue;
    }
    bevels.set(key, { key, value: String(value), origin: `bevel.${key}` });
  }

  // The theme object itself may be missing entirely; that is a kit-level defect the other tests own, but a silent
  // `{}` here would make the specimen check pass over an empty kit.
  if (tokens.size === 0) {
    problems.push('tokens.json yielded no tokens at all: the specimen coverage check would prove nothing');
  }

  return { tokens, bevels, problems };
}

/// The vocabulary of `UI_SYSTEM.md` §8, read from the document at check time. A component sample is required for each
/// word, so "renders every component the kit defines" means the same thing as "renders every token".
export function readVocabulary(markdown = readFileSync(UI_SYSTEM_MD, 'utf8')) {
  const section = /^##\s*8\.\s*Vocabulary\s*$([\s\S]*?)(?=^##\s)/m.exec(markdown);
  if (!section) {
    throw new Error(
      `could not find "## 8. Vocabulary" in ${UI_SYSTEM_MD}: the component coverage check has nothing to read, and ` +
      `failing here is deliberate — a check that silently reads no words proves nothing`,
    );
  }
  const words = new Set();
  for (const line of section[1].split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const first = line.split('|')[1]?.trim() ?? '';
    if (!first || first.startsWith('-') || /^word$/i.test(first)) continue;
    for (const word of first.replace(/\*/g, '').split('/')) {
      const clean = word.trim().toLowerCase();
      if (/^[a-z][a-z -]*$/.test(clean)) words.add(clean);
    }
  }
  if (words.size < 5) {
    throw new Error(
      `read only ${words.size} word(s) from §8 of ${UI_SYSTEM_MD} (${[...words].join(', ')}): the table has moved or ` +
      `changed shape, and a component check over no words is a ceremony`,
    );
  }
  return [...words];
}

/// The samples a page declares, by marker attribute: `data-token="--face"`, `data-bevel="raised"`,
/// `data-component="window"`. Parsing is deliberately blind to markup shape — a sample may be a `<figure>`, a `<div>`
/// or anything else, because what the check demands is a declaration, not a layout.
export function samplesInHtml(html) {
  const collect = (attribute) => {
    const out = new Set();
    for (const match of html.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))) out.add(match[1].trim());
    return out;
  };
  return {
    tokens: collect('data-token'),
    bevels: collect('data-bevel'),
    components: collect('data-component'),
  };
}

/// What the page is missing, and what it declares that the kit does not have. `missing` is the acceptance test's
/// verdict; `stale` is the opposite lie — a sample for a token the kit no longer carries, which reads as coverage of
/// something that does not exist.
export function specimenGaps(html, required = requiredSamples(), vocabulary = readVocabulary()) {
  const present = samplesInHtml(html);
  return {
    missingTokens: [...required.tokens.values()].filter((token) => !present.tokens.has(token.name)),
    missingBevels: [...required.bevels.values()].filter((bevel) => !present.bevels.has(bevel.key)),
    missingComponents: vocabulary.filter((word) => !present.components.has(word)),
    staleTokens: [...present.tokens].filter((name) => !required.tokens.has(name)),
    staleBevels: [...present.bevels].filter((key) => !required.bevels.has(key)),
    problems: required.problems,
  };
}

/// A sentence per missing token, naming the token and where the kit declares it — the message a reader acts on.
export function missingTokenSentences(missingTokens) {
  return missingTokens.map(
    (token) =>
      `${token.name} (${token.origins.join('; ')}${token.declared.size ? `; theme: ${[...token.declared].join('/')}` : ''})`,
  );
}

/// Every reference that would need the network. The kit's own rule is that nothing is downloaded, so this is a
/// contract rather than a style note: a web font or a CDN link would make the specimen unopenable on the machine that
/// matters, and would make the values it prints depend on something outside the folder. Comments are removed first — a
/// URL written in prose is not a download, and a check that fails for the wrong reason is worse than the one it hunts.
export function externalReferences(html) {
  const live = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const found = new Set();
  for (const match of live.matchAll(/https?:\/\/[^\s"'<>)]+/g)) found.add(match[0]);
  for (const match of live.matchAll(/(?:src|href)\s*=\s*"(\/\/[^"]+)"/g)) found.add(match[1]);
  for (const match of live.matchAll(/@import[^;]*/g)) found.add(match[0].trim());
  return [...found];
}

/// Colour literals in a stylesheet, with its comments removed. The specimen is the reference, so it must be drawn from
/// the kit's tokens rather than teaching a palette of its own — the same rule §11.3 applies to an application.
export function literalColours(css) {
  const live = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Set();
  for (const match of live.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)) found.add(match[0]);
  return [...found];
}

/// The CSS tokens the canonical file declares, the guard that the derivation above cannot silently miss a spelling.
/// `readCanonicalCss` is the kit's own reader, so this is not a second parser of `tokens.css`.
export function cssTokenNames(css = readFileSync(CANONICAL_CSS, 'utf8')) {
  const { light, dark, shared } = readCanonicalCss(css);
  return [...new Set([...light.keys(), ...dark.keys(), ...shared.keys()])];
}

/// Strip comments, so a class named in prose is never mistaken for a rule. The kit writes long explanatory comments
/// and this module must not read them as selectors — the same reason `externalReferences` and `literalColours` do it.
function withoutComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, '');
}

/// Every class name `components.css` draws. The specimen must link that file and not retype it, so this is the list
/// the specimen's own stylesheet is checked against — derived from the layer at check time, never written out here,
/// because a hand-kept list is the drift this whole folder exists to make impossible.
export function componentClasses(css) {
  const names = new Set();
  for (const match of withoutComments(css).matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) names.add(match[1]);
  return [...names].sort();
}

/// The class names a stylesheet **declares** (as opposed to mentions): a class that appears in a selector list, which
/// is the text before a `{` that is not an at-rule. Used for the reverse direction of the check above — the specimen
/// must consume the layer, so a component class declared again in the page is a second answer to a question the kit
/// has already answered.
export function declaredClasses(css) {
  const out = new Set();
  for (const match of withoutComments(css).matchAll(/([^{}]+)\{/g)) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    for (const name of selector.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(name[1]);
  }
  return [...out].sort();
}
