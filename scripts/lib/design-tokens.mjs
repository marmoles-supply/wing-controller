// The bridge between `design/tokens.json` (the values a human edits), `design/tokens.css` (the generated CSS form those
// values are rendered into, and the form every consumer links) and the copy the application ships.
//
// Why a copy at all: the packaged frontend is `desktop/ui`, **byte for byte** (`tauri.conf.json` sets
// `frontendDist: "../ui"` with no bundling step), so a stylesheet outside that folder is not shipped. Why a bridge
// rather than a second source: a rule written twice drifts, so the copy is **generated** from the canonical CSS by
// `scripts/sync-design-tokens.mjs` and `scripts/test-design-tokens.mjs` fails when the two disagree — the same pattern,
// and the same reason, as `version.json` and `desktop/ui/version.js`. Since 2026-10-08 the canonical CSS is itself
// generated, from the JSON, by `scripts/generate-design-tokens.mjs` (design/DESIGN-SYSTEM-ROADMAP.md, ITEM 1).
//
// The third thing here is the contract between the two **forms** of the same kit: `tokens.css` for anything that is CSS
// and `tokens.json` for anything that is not. They carry the same values, so a value added to one and forgotten in the
// other is a defect this module can name — which is exactly what happened on 2026-10-07, when another session added a
// meter ramp to both by hand and nothing checked that the two agreed.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const DESIGN_DIR = resolve(REPO, 'design');
export const CANONICAL_CSS = resolve(DESIGN_DIR, 'tokens.css');
export const CANONICAL_JSON = resolve(DESIGN_DIR, 'tokens.json');
export const SHIPPED_CSS = resolve(REPO, 'desktop/ui/design-tokens.css');

/// The header the shipped copy carries, so a reader who opens it in the application's folder knows where it came from and
/// that editing it here is editing the wrong file.
export const GENERATED_NOTICE = `/* WING CONTROLLER — design tokens, as shipped.
 *
 * GENERATED FILE — do not edit. The one file a human edits is \`design/tokens.json\`; \`design/tokens.css\` is rendered
 * from it by \`scripts/generate-design-tokens.mjs\`, and this copy exists because the packaged frontend is \`desktop/ui\`
 * byte for byte, so a stylesheet outside it is not shipped. Run
 * \`node scripts/sync-design-tokens.mjs\` after changing the tokens: \`scripts/test-design-tokens.mjs\` fails when the two
 * differ.
 */
`;

/// What the shipped copy must contain, byte for byte.
export function renderShippedCss(canonical = readFileSync(CANONICAL_CSS, 'utf8')) {
  return `${GENERATED_NOTICE}\n${canonical}`;
}

/// `--win-btn-face` <-> `winBtnFace`, `--face-2` <-> `face2`: the two files spell the same token differently, and the
/// comparison has to meet in the middle. Digits count as a word boundary on the CSS side.
export function toJsonName(cssName) {
  const bare = cssName.replace(/^--/, '');
  return bare.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

export function toCssName(jsonName) {
  const kebab = String(jsonName)
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-z])([0-9])/g, '$1-$2');
  return `--${kebab.toLowerCase()}`;
}

/// Values are compared with their whitespace collapsed: `tokens.css` wraps a long gradient over lines and `tokens.json`
/// carries it on one, and a difference in line breaks is not a difference in colour.
function normalise(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/// The declarations of one CSS block, as `name -> value`. The block is found by its **brace** — searching for the bare
/// text `body.theme-dark` finds the mention inside this file's own header comment first, which is how the first version
/// of this module read the light theme as two tokens long.
function cssBlock(css, selector) {
  const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 's').exec(css);
  if (!match) return new Map();
  const out = new Map();
  for (const declaration of match[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(declaration[1], normalise(declaration[2]));
  }
  return out;
}

/// Every token the canonical file declares, split by theme.
export function readCanonicalCss(css = readFileSync(CANONICAL_CSS, 'utf8')) {
  const light = cssBlock(css, ':root');
  const dark = cssBlock(css, 'body.theme-dark');
  // A value the dark theme does not re-declare is **theme-independent**: the instrument's phosphor, a meter ramp. Those
  // may live in the JSON's `instrument` section instead of a theme, which is a naming choice rather than a disagreement.
  const shared = new Map();
  for (const [name, value] of light) {
    if (!dark.has(name)) shared.set(name, value);
  }
  return { light, dark, shared };
}

/// What counts as a value the two forms must agree about: a literal colour or a gradient. An alias (`var(--x)`) is a
/// reference, not a value, and comparing two spellings of a reference would test nothing.
export function isComparableValue(value) {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^linear-gradient\(/i.test(value);
}

function jsonSection(json, ...path) {
  let node = json;
  for (const key of path) {
    node = node?.[key];
    if (node === undefined) return {};
  }
  return node && typeof node === 'object' ? node : {};
}

/// `tokens.json` as two theme maps plus the theme-independent `instrument` section, keyed by the **CSS** name.
///
/// What this deliberately does **not** read, measured 2026-10-08 and left as it is: the `type`, `space` and `bevel`
/// sections. They are not blind by accident, and widening this function would not make them visible on its own:
///
///   - `space` holds real values that reach the CSS (`space.2` = `4px` = `--space-2`), but the JSON key omits the
///     `space-` prefix the CSS name carries, so `toCssName('2')` is `--2` and every entry would be reported as a
///     missing CSS token. Its values are lengths, and `isComparableValue` (below) compares only literal colours and
///     gradients, so they would still be skipped.
///   - `type` mixes values with metadata: `winFont`/`mono` are byte-identical to `--win-font`/`--mono`, while `steps`
///     and `scaleKnob` are names, and the `--font-*` scale arithmetic and `--meter-scale`'s base value have no JSON
///     home at all.
///   - `bevel` is prose describing the `--line-light`/`--line-dark` pair; no CSS declaration carries it.
///
/// Closing that gap is a decision about the shape a foreign consumer reads and about comparing non-colour values, so it
/// is recorded here rather than half-made. The generated CSS does carry `space`, the font stacks and the ramp **from**
/// the JSON, so a drift in those now reddens `scripts/test-design-tokens-generator.mjs`; the type-scale arithmetic and
/// `--meter-scale`'s base remain the generator's own, by design and by this note.
export function readCanonicalJson(json = JSON.parse(readFileSync(CANONICAL_JSON, 'utf8'))) {
  const collect = (section) => {
    const out = new Map();
    for (const [key, value] of Object.entries(section)) {
      if (typeof value === 'string') out.set(toCssName(key), normalise(value));
    }
    return out;
  };
  return {
    light: collect(jsonSection(json, 'theme', 'light')),
    dark: collect(jsonSection(json, 'theme', 'dark')),
    shared: collect(jsonSection(json, 'instrument')),
    raw: json,
  };
}

/// Every disagreement between the canonical CSS and the canonical JSON, as sentences a reader can act on. An empty array
/// is the contract: the two forms of the kit carry the same values, and a value that exists in one of them and not the
/// other is a defect — which is not hypothetical, since a whole token arrived that way on 2026-10-07.
export function tokenDisagreements(
  css = readFileSync(CANONICAL_CSS, 'utf8'),
  json = JSON.parse(readFileSync(CANONICAL_JSON, 'utf8')),
) {
  const fromCss = readCanonicalCss(css);
  const fromJson = readCanonicalJson(json);
  const problems = [];
  const comparable = (map) => [...map].filter(([, value]) => isComparableValue(value));

  // CSS -> JSON, per theme, and then the theme-independent tokens, which the JSON may keep in `instrument` or in either
  // theme: where a kit files a value is a naming choice, whether it is there at all is the contract.
  for (const theme of ['light', 'dark']) {
    for (const [name, value] of comparable(fromCss[theme])) {
      const jsonValue = fromJson[theme].get(name) ?? fromJson.shared.get(name);
      if (jsonValue === undefined) {
        problems.push(`tokens.json has no entry for ${name} (${theme} in tokens.css, value ${value})`);
      } else if (jsonValue !== value) {
        problems.push(`${name}: tokens.css says ${value} (${theme}) and tokens.json says ${jsonValue}`);
      }
    }
  }
  for (const [name, value] of comparable(fromCss.shared)) {
    const jsonValue = fromJson.shared.get(name) ?? fromJson.light.get(name) ?? fromJson.dark.get(name);
    if (jsonValue === undefined) {
      problems.push(`tokens.json has no entry for ${name} (theme-independent in tokens.css, value ${value})`);
    } else if (jsonValue !== value) {
      problems.push(`${name}: tokens.css says ${value} (theme-independent) and tokens.json says ${jsonValue}`);
    }
  }

  // And the other direction: a colour the JSON declares must exist in the CSS, with the same value.
  for (const theme of ['light', 'dark']) {
    for (const [name, value] of comparable(fromJson[theme])) {
      const cssValue = fromCss[theme].get(name) ?? fromCss.shared.get(name);
      if (cssValue === undefined) {
        problems.push(`tokens.css has no ${name} for tokens.json's ${value} (${theme})`);
      } else if (cssValue !== value) {
        problems.push(`${name}: tokens.json says ${value} (${theme}) and tokens.css says ${cssValue}`);
      }
    }
  }
  for (const [name, value] of comparable(fromJson.shared)) {
    const cssValue = fromCss.shared.get(name) ?? fromCss.light.get(name) ?? fromCss.dark.get(name);
    if (cssValue === undefined) {
      problems.push(`tokens.css has no ${name} for tokens.json's instrument section (${value})`);
    } else if (cssValue !== value) {
      problems.push(`${name}: tokens.json's instrument says ${value} and tokens.css says ${cssValue}`);
    }
  }

  return [...new Set(problems)];
}
