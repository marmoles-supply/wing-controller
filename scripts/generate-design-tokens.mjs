#!/usr/bin/env node
// The generator for `design/tokens.css`: the CSS form of the kit is **rendered** from `design/tokens.json`, which is the
// one file a human edits.
//
//   node scripts/generate-design-tokens.mjs            # writes design/tokens.css
//   node scripts/generate-design-tokens.mjs --check    # fails instead of writing (for a hook or a review)
//
// Why the direction is JSON -> CSS and not CSS -> JSON. The kit has two forms of the same values: CSS for the windows
// and a machine-readable JSON for a consumer that is not CSS (a mobile app, a plugin, a build script). While both were
// hand-written, every value had to be typed twice in two spellings, and the CSS — the form only a browser can read —
// was the one that decided. The roadmap asked for the reverse (design/DESIGN-SYSTEM-ROADMAP.md, ITEM 1): the JSON is
// authored, the CSS is generated. Every existing consumer still links the CSS, and nothing it reads changed except the
// header — the generated file is byte for byte the one the hand-written file carried.
//
// What defines this generator's output is the committed `design/tokens.css`: the comments, the group order and the line
// breaks are the template's, and every value is looked up in the JSON. `scripts/test-design-tokens-generator.mjs` pins
// both halves of that: the rendered bytes equal the committed bytes, and a changed JSON value changes the CSS.
//
// The one place the template is more than a value lookup is the type scale. `tokens.json` names the scale steps
// (`type.steps`) and the knob (`type.scaleKnob`), but it carries no home for the arithmetic between the knob and each
// step, so the numbers in the `clamp()` expressions live here. That gap is deliberate and documented rather than hidden:
// see the note beside FONT_STEP below.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANONICAL_CSS, CANONICAL_JSON, toCssName } from './lib/design-tokens.mjs';

/// The base of the scale knob. The JSON names the knob's property (`type.scaleKnob`) but not its value, so the value
/// lives here, in the generator that also owns the per-step arithmetic around it. Raising it grows every `--font-*`
/// step together, which is the point of having one knob.
///
/// **1.25 since 2026-10-08 (`DESIGN-SYSTEM-ROADMAP.md` §4l, D-TYPE-5), and the measurement is why.** The application
/// was drawn at roughly the kit's scale x 1.25: at 1.25 the interface steps give 8.3 / 9.3 / 10.4 / **11.0** / 12.125
/// against the window's own drawn 9 / 10 / 11 / 12, reproduced within 0.3px, while at 1 every window is uniformly
/// about half a pixel smaller and the guide's prose reads worse (12px -> 10.5px). The kit is the application's own
/// scale — `tokens.json` records its `source` as the windows — so its base is where the application's base belongs:
/// **one home**, and every window that links the kit inherits it without declaring a knob of its own (which the
/// agreement checker would report as a disagreement, since it compares numeric tokens too).
///
/// This is the *type* knob. Before the split it was also `index.html`'s and `meters.html`'s meter-zoom slider
/// (0.6–2.0), whose geometry is `calc(<px> * var(--meter-scale))` — two controls sharing one variable, which is why
/// raising this value used to resize the meters instead of the type. The geometry now takes `--meter-zoom`.
const METER_SCALE_BASE = 1.25;

/// The type scale, as the three numbers inside `clamp(<floor>, calc(<floor> + (var(<knob>) - 1) * <growth>), <cap>)`.
/// The JSON's `type.steps` decides **which** steps exist and in what order; these numbers are the generator's, because
/// `tokens.json` has no section for them and inventing one would change the shape a foreign consumer reads. A step that
/// appears in `type.steps` and not here is a hard error, never a missing declaration: a silently absent font token is
/// exactly the "a check that looks at the wrong artefact" failure the kit exists to prevent.
const FONT_STEP = {
  badge: { floor: '8px', growth: '1.2px', cap: '10px' },
  xs: { floor: '8.5px', growth: '3.2px', cap: '16px' },
  sm: { floor: '9.5px', growth: '3.6px', cap: '18px' },
  base: { floor: '10.5px', growth: '2px', cap: '13px' },
  lg: { floor: '11.5px', growth: '2.5px', cap: '14px' },
  // The instrument steps (roadmap §4l, D-TYPE-4). The five interface steps above are a scale for reading an interface;
  // these four are a scale for reading an INSTRUMENT, and their floors are the sizes measured in the windows rather
  // than chosen here: `readout` 22px and `readout-lg` 26px are index.html's Timecode card and Properties readouts,
  // `clock` 30px is ltc.html's clock face and the floor of timecode.html's responsive clock, and `clock-lg` 52px is
  // that clock's cap in a wide window. Each grows at a quarter of its floor, so a step is 25 % larger at
  // `--meter-scale` 2 — the proportion the interface steps already use (`lg` grows 2.5px on an 11.5px floor).
  readout: { floor: '22px', growth: '5.5px', cap: '27.5px' },
  'readout-lg': { floor: '26px', growth: '6.5px', cap: '32.5px' },
  clock: { floor: '30px', growth: '7.5px', cap: '37.5px' },
  'clock-lg': { floor: '52px', growth: '13px', cap: '65px' },
};

/// The order the light theme declares its colours in. Written out rather than derived from `Object.keys`, so a value
/// added to the JSON cannot land in the CSS in an arbitrary place: it is emitted here or the regenerated file differs
/// from the committed one and the test says so.
const LIGHT_FACE = ['face', 'face2', 'face3', 'field'];
const LIGHT_INK = ['ink', 'muted', 'dim'];
const LIGHT_LINES = ['line', 'lineMid', 'lineLight', 'lineDark'];
const LIGHT_FURNITURE = [
  'winGray',
  'winBtnFace',
  'winBtnHighlight',
  'winBtnShadow',
  'winBtnDarkShadow',
  'winWindowFrame',
  'winText',
  'winTitleBg',
  'winTitleText',
];
const LIGHT_ACCENTS = ['accent', 'maroon', 'amber', 'green', 'greenDim', 'yellow', 'red', 'redBright', 'gold'];
/// **The desktop, and why it is its own group rather than one more line of furniture.** `--desk` is the ground the
/// application's own window sits on (`desktop/ui/index.html:41`, `background: var(--desk)` at `:63` and `:81`), and it is
/// the one value a consumer of this kit had to spell outside it. It is a surface the **themes** change — the classic teal
/// in light, near-black in Stealth Dark (#008080 / #0e1111) — which is exactly what the furniture group is not: those are
/// the window chrome, and the desktop is what the chrome is placed on.
const LIGHT_DESKTOP = ['desk'];
/// The dark theme re-declares only what changes. `crtInk` is deliberately **not** in this list: the phosphor is the same
/// in both themes, so the dark block must not restate it. Listing the keys explicitly (rather than walking the JSON's
/// dark object) is what keeps that deliberate absence from being regenerated into the file.
const DARK_COLOURS = [
  'face',
  'face2',
  'face3',
  'field',
  'ink',
  'muted',
  'dim',
  'line',
  'lineMid',
  'lineLight',
  'lineDark',
  'winGray',
  'winBtnFace',
  'winBtnHighlight',
  'winBtnShadow',
  'winBtnDarkShadow',
  'winText',
  'winTitleBg',
  'winTitleText',
  'accent',
  'maroon',
  'crt',
  'desk',
];

/// Read a required value out of the JSON, or fail naming the exact path. A generator that emitted `undefined` into a
/// stylesheet would produce a file that still parses and still "regenerates", which is worse than a loud stop.
function required(json, ...path) {
  let node = json;
  for (const key of path) {
    node = node?.[key];
    if (node === undefined) {
      throw new Error(`design/tokens.json has no ${path.join('.')} — the generator cannot render design/tokens.css`);
    }
  }
  if (typeof node !== 'string') {
    throw new Error(`design/tokens.json's ${path.join('.')} must be a string, found ${typeof node}`);
  }
  return node;
}

/// One theme's colour declarations, straight from the JSON keys named in `keys`.
function colourLines(json, theme, keys) {
  return keys
    .map((key) => `  ${toCssName(key)}: ${required(json, 'theme', theme, key)};`)
    .join('\n');
}

/// A long gradient is wrapped in the committed file, and the generator reproduces that wrapping so a reader can still
/// diff the generated file by eye and so the regeneration test compares bytes rather than "the same colours". The colour
/// stops go four to a line under the declaration, which is the shape `design/tokens.css` carried when it was still
/// hand-written; `test-design-tokens-generator.mjs` pins the wrapping with a two-stop probe.
function gradientLines(property, value) {
  const open = value.indexOf('(');
  const close = value.lastIndexOf(')');
  if (open === -1 || close < open) {
    throw new Error(`design/tokens.json's ${property} must be a gradient, found ${JSON.stringify(value)}`);
  }
  const inner = value.slice(open + 1, close).trim();
  const comma = inner.indexOf(',');
  const head = inner.slice(0, comma + 1);
  const stops = inner
    .slice(comma + 1)
    .split(',')
    .map((stop) => stop.trim())
    .filter(Boolean);
  const lines = [`  ${property}: ${value.slice(0, open)}(${head}`];
  for (let index = 0; index < stops.length; index += 4) {
    const chunk = stops.slice(index, index + 4);
    const last = index + 4 >= stops.length;
    lines.push(`    ${chunk.join(', ')}${last ? ');' : ','}`);
  }
  return lines.join('\n');
}

/// The generated CSS, byte for byte. `json` is injected so a test can render a changed copy without touching the tree.
export function renderCanonicalCss(json = JSON.parse(readFileSync(CANONICAL_JSON, 'utf8'))) {
  const version = required(json, 'version');
  const knob = toCssName(required(json, 'type', 'scaleKnob'));
  const steps = json?.type?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('design/tokens.json has no type.steps array — the generator cannot render the type scale');
  }
  const fontLines = steps
    .map((step) => {
      const numbers = FONT_STEP[step];
      if (!numbers) {
        throw new Error(
          `design/tokens.json's type.steps names "${step}", which this generator has no scale numbers for; ` +
            `add them to FONT_STEP in scripts/generate-design-tokens.mjs`,
        );
      }
      // The knob's own property name is interpolated, so renaming `type.scaleKnob` renames every reference in one step.
      const expression = `clamp(${numbers.floor}, calc(${numbers.floor} + (var(${knob}) - 1) * ${numbers.growth}), ${numbers.cap})`;
      return `  --font-${step}: ${expression};`;
    })
    .join('\n');
  const space = json?.space;
  if (!space || typeof space !== 'object' || Object.keys(space).length === 0) {
    throw new Error('design/tokens.json has no space section — the generator cannot render the spacing grid');
  }
  const spaceLines = Object.keys(space)
    .map((step) => `  --space-${step}: ${required(json, 'space', step)};`)
    .join('\n');
  // The leading family, shaped exactly like `space`: the JSON's keys are the step names and the CSS name carries the
  // prefix. One step today (`base`), and the code is the same shape whether the family holds one step or three — the
  // count is the JSON's decision, and a step named there and not rendered here is a silently absent token, the failure
  // this kit exists to prevent.
  const leading = json?.leading;
  if (!leading || typeof leading !== 'object' || Object.keys(leading).length === 0) {
    throw new Error("design/tokens.json has no leading section — the generator cannot render the kit's line box");
  }
  const leadingLines = Object.keys(leading)
    .map((step) => `  --leading-${step}: ${required(json, 'leading', step)};`)
    .join('\n');

  return `/* WING CONTROLLER — design tokens, canonical CSS form. Version ${version}.
 *
 * GENERATED FILE — do not edit. The one file a human edits is \`design/tokens.json\`; this CSS is rendered from it by
 * \`scripts/generate-design-tokens.mjs\`, and \`scripts/test-design-tokens-generator.mjs\` fails when the two disagree. A
 * consumer still links THIS file, and being generated changed nothing it reads: the JSON is the authoring form, the CSS
 * is the public one.
 *
 * The values are the application's own, extracted from the windows it ships (\`desktop/ui/*.html\`) rather than invented
 * for a document: the palette of the instrument windows (\`timecode.html\`, \`ltc.html\`) as the base, the bevel vocabulary
 * of \`meters.html\` (\`--win-*\`), and the type scale from the same window.
 *
 * Two rules make this file the published form rather than a fourth opinion:
 *
 *   1. **Every name the windows already use is an alias here**, so a window can link this file and delete its own
 *      \`:root\` without renaming a single rule. A rename can follow; a rename is not a prerequisite.
 *   2. **The app ships a copy, and a test compares them.** \`desktop/ui/design-tokens.css\` is generated from this file;
 *      \`scripts/test-design-tokens.mjs\` fails if the two ever differ. One home, no drift — the pattern this project
 *      already uses for \`version.json\` and \`desktop/ui/version.js\`.
 *
 * Light is \`:root\`, dark is \`body.theme-dark\`, and the dark theme re-declares only what changes. The CRT well and its
 * phosphor is the same in both themes on purpose, and the well is not: they are the instrument, not the furniture.
 */

:root {
  /* ---- the face: the metal the application is made of ------------------------------------------------------- */
${colourLines(json, 'light', LIGHT_FACE)}

  /* ---- ink: text, and the two weights of it ---------------------------------------------------------------- */
${colourLines(json, 'light', LIGHT_INK)}

  /* ---- lines, and the four steps a bevel is built from ----------------------------------------------------- */
  /* \`--line-light\` is the top-left highlight, \`--line-dark\` the bottom-right shadow, \`--line\`/\`--line-mid\` the
   * divider between two flat faces. A raised control is light-then-dark; a sunken one is the same pair reversed. */
${colourLines(json, 'light', LIGHT_LINES)}

  /* ---- the classic window furniture, spelled the way the meters window spells it ---------------------------- */
${colourLines(json, 'light', LIGHT_FURNITURE)}

  /* ---- the desktop the windows are placed on ---------------------------------------------------------------- */
  /* \`--desk\` is not a surface INSIDE a window: it is the ground the application's window sits on, and the two themes
   * disagree about it on purpose (the classic teal against near-black, \`#008080\` / \`#0e1111\`). It is the value the
   * session in \`openwing\` had to spell outside this file to paint a desktop at all, and it is measured from
   * \`desktop/ui/index.html:41\` and \`:4978\` rather than invented here. */
${colourLines(json, 'light', LIGHT_DESKTOP)}

  /* ---- accents: what a colour means, not what it looks like ------------------------------------------------- */
  /* \`--accent\` is the selection and the focus. \`--maroon\` is a warning that is not yet a refusal. \`--amber\` is an
   * unfinished or inherited value. The four state colours below are the meter and status vocabulary. */
${colourLines(json, 'light', LIGHT_ACCENTS)}

  /* ---- the instrument: a sunken well, its phosphor, and the level ramp ------------------------------------- */
  --crt: ${required(json, 'theme', 'light', 'crt')};
  --crt-ink: ${required(json, 'theme', 'light', 'crtInk')};
  /* The level ramp of a meter. It is MEASURED, not chosen: green up to the reference, warning
   * above it, red at the top, with the stops at 0/56/82/99 % taken from the instrument window
   * (\`meters.html\`). Like \`--crt-ink\`, it is deliberately the SAME in both themes: a meter is
   * the instrument, not the furniture, and an operator reads the same colour in either theme.
   * Added at the request of the control-app session (openwing, 2026-10-07); it was the only
   * value that app had to spell outside this file. */
${gradientLines('--meter-ramp', required(json, 'instrument', 'meterRamp'))}

  /* ---- type ------------------------------------------------------------------------------------------------ */
  --win-font: ${required(json, 'type', 'winFont')};
  --mono: ${required(json, 'type', 'mono')};
  /* One scale knob, and every step derived from it, so a meter bank can grow without inventing sizes. */
  ${knob}: ${METER_SCALE_BASE};
${fontLines}

  /* ---- leading: the line box of the page frame --------------------------------------------------------------- */
  /* \`--leading-base\` is the ONE step of the kit's leading family, and the family is one step because the kit's
   * drawings use one: neither of those sheets sets a \`line-height\` on a drawing — the one \`layout.css\` carries is the
   * frame's own \`body\` rule below — so every control, card and panel the kit ships inherits the line box of the page
   * that links it, and the two pages that compose a frame both wrote this same \`1.35\` by hand until a stranger reported
   * it (\`design/CANON_PLAN.md\`, P1's third criterion, finding 4). The specimen is a document page and is not one of
   * the two; it keeps its own 1.4. It is the line box \`design/layout.css\` gives \`body\`, and the value is the
   * application's own rather than invented here: \`desktop/ui/index.html:88\` sets \`line-height: 1.35\` on its \`body\`.
   * It is theme-independent — a line box is typography, not a palette — and the family is spelled \`leading\` and not
   * \`line\` because \`--line\`, \`--line-mid\`, \`--line-light\` and \`--line-dark\` are the bevel's four edge steps. */
${leadingLines}

  /* ---- spacing: a four-pixel grid, named by its step --------------------------------------------------------- */
${spaceLines}

  /* ---- the arrangement: the one measurement the kit's composition layer needs ------------------------------- */
  /* \`--ops-col-width\` is the width of the operator column in \`design/layout.css\` — the right-hand column of the
   * two-column plan every window of this application is built on. It is a TOKEN rather than a loose variable because
   * \`desktop/ui/index.html:172\` writes it as \`minmax(260px, var(--ops-col-width, 420px))\` inside a 32,000-line file:
   * a consumer could not find the number, and a consumer that guessed 420px was copying a default rather than reading
   * one. It is the same in both themes — a column is furniture, not a palette — and it is the one part of the plan the
   * operator resizes, which is why it is the one part the kit names. */
  --ops-col-width: ${required(json, 'layout', 'opsColWidth')};
}

/* The dark theme. Only what changes is re-declared; everything else inherits, which is what keeps the two themes from
 * drifting apart — the failure this project has already paid for once, when a window froze its face colour to the light
 * value because a \`:root\` alias was resolved before the dark rule could override it. **Never alias a token to another
 * token inside \`:root\` if the dark theme re-declares the target**: alias it in the window, or re-declare the alias here. */
body.theme-dark {
${colourLines(json, 'dark', DARK_COLOURS)}
  /* \`--crt-ink\` is deliberately absent: the phosphor is the same in both themes. */
}
`;
}

/// The command line. The `--check` form exists because a review or a hook wants the answer without a write, the same
/// contract `scripts/sync-design-tokens.mjs` offers for the copy the application ships.
function main() {
  const checkOnly = process.argv.includes('--check');
  const wanted = renderCanonicalCss();
  let current = null;
  try {
    current = readFileSync(CANONICAL_CSS, 'utf8');
  } catch (_) {
    current = null;
  }

  if (current === wanted) {
    console.log('design tokens: design/tokens.css is already what design/tokens.json generates');
    process.exit(0);
  }
  if (checkOnly) {
    console.error(
      'design tokens: design/tokens.css is not what design/tokens.json generates — ' +
        'run `node scripts/generate-design-tokens.mjs`',
    );
    process.exit(1);
  }
  writeFileSync(CANONICAL_CSS, wanted);
  console.log(
    current === null
      ? 'design tokens: wrote design/tokens.css from design/tokens.json'
      : 'design tokens: regenerated design/tokens.css from design/tokens.json',
  );
}

// Only run the command line when this file is the program. The synchroniser imports `renderCanonicalCss` from here, and
// an unguarded top level would make that import regenerate the canonical file as a side effect.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
