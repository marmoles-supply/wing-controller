#!/usr/bin/env node
// The native generator for the design kit: `WingTheme.swift` is **rendered** from `design/tokens.json`, the same one
// file a human edits, so a colour is changed once and every platform's build picks it up.
//
//   node scripts/generate-design-tokens-swift.mjs                        # writes design/native/WingTheme.swift
//   node scripts/generate-design-tokens-swift.mjs --check                # fails instead of writing (for a hook or a review)
//   node scripts/generate-design-tokens-swift.mjs --json <p> --out <p>   # renders another `tokens.json` into another file
//
// `--json` and `--out` exist because the second half of this form's acceptance test — "change a value in `tokens.json`
// and see the generated form change" — could not be run by somebody who did not build the kit. An outsider started from
// a scratch tree holding only `tokens.json`, `VERSION` and this generator; there was no way to point either end
// anywhere else, and copying the tree by hand failed twice on the import graph (`scripts/lib/`, and the CSS generator
// this file reads its type scale from). That attempt and its two `ENOENT`s are recorded in
// `docs/HANDOFF_DESIGN_SYSTEM.md` §"Verifying the native form from outside the tree". The flags are the small answer;
// the defaults are unchanged, so `--json <p> --out <p>` is the only new shape and today's invocation writes the same
// bytes to the same path as before.
//
// Why a Swift file rather than an asset catalogue, which is the other form a Swift app consumes. **Decided here, with
// the grounds, because the kit did not already answer it** (`design/SHARING_THE_KIT.md` §"What is missing" leaves the
// choice open, and the six native neighbours — CodeSigner, CoreSteward, CoreWrapper, DantePatch, MicroAudioHost,
// rizomes — have no theme file of any kind to copy a precedent from):
//
//   * **A catalogue cannot be compared byte-for-byte by this repository's own tooling.** The acceptance test this
//     project holds every generated form to is "delete the generated file, regenerate, byte-identical", and it has to
//     run in `./scripts/verify-all.sh --quick`, which is Node and no browser. A `.xcassets` folder is a set of
//     `Contents.json` files whose colours are only *valid* if Xcode compiles them; there is no Node-side oracle for
//     that, so the test would degrade into "the JSON we generated is the JSON we generated" — a check that cannot
//     fail for the reason it exists. A plain Swift source file is judged by the compiler, and the bytes are ours.
//   * **A catalogue ties the kit to Xcode.** Every one of the six neighbours is a Swift package with a build; some are
//     built by `swift build` and by CI, not by a person in an Xcode window. A source file drops into any of them with
//     no target resources to declare and no per-target catalogue merge.
//   * **The cost of the choice, stated rather than hidden.** The palette reaches a view through SwiftUI's environment
//     (`WingColor.face(for: colorScheme)`) instead of automatically, so a view has to ask for the scheme it is in.
//     That is one parameter at each call site and it is the same discipline the web side already requires (the CSS
//     needs `body.theme-dark`, and a window that forgets it is a foreign window in a dark application —
//     `AGENTS.md`, "A Control Must Work, Or Say Why Not" §8). **What would overturn this decision:** a generated
//     catalogue that can be validated in `--quick` by a Node-side reader of the same grammar, or a neighbour whose
//     build step makes a non-catalogue asset impossible to use.
//
// Token names and values are **identical to the CSS side**, because both forms are rendered from the same JSON keys
// and this generator asks the CSS generator for the CSS spelling:
//
//   `design/tokens.json` key        `tokens.css` custom property      `WingColor` / `WingTheme` member
//   theme.light.winBtnFace          --win-btn-face                    WingColor.Light.winBtnFace
//   theme.dark.winBtnFace           --win-btn-face (in theme-dark)    WingColor.Dark.winBtnFace
//   theme.light.crtInk              --crt-ink                         WingColor.Light.crtInk (theme-independent)
//   theme.light.crt                 --crt                             WingColor.Light.crt
//   type.winFont                    --win-font                        WingTheme.winFont
//   type.mono                       --mono                            WingTheme.mono
//   type.steps []                   --font-<step>                     WingTheme.font<Step>(_ scale:)
//   type.scaleKnob                  --meter-scale                     WingTheme.meterScaleKnob / meterScaleBase
//   space.<n>                       --space-<n>                       WingTheme.space<n>
//   instrument.meterRamp            --meter-ramp                      WingGradient.meterRamp
//
// The kebab-case-to-camelCase rule is `toCssName`'s inverse, imported from `scripts/lib/design-tokens.mjs` so the two
// generators cannot drift about what a token is called: this file contains no name of its own.
//
// **The honest limit, which is also written into the generated file's own header.** This project's conformance suite
// (`design/conformance/`) judges a **rendered web page** — computed styles and geometry. It cannot judge a SwiftUI
// view, and nothing here pretends it does: the status of a native screen in this kit today is **"declared, not
// verified"**, and the generated header says so where a reader of the Swift file will meet it. What *is* verifiable
// from here is the form itself: `scripts/test-design-tokens-swift.mjs` proves the committed file is byte-identical to
// what the JSON renders, that a changed JSON value moves it, that `--json`/`--out` render a copy outside this tree
// without touching it, and (with a Swift toolchain present) that it compiles.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANONICAL_JSON, toCssName } from './lib/design-tokens.mjs';

/// Where the native form lands. `design/native/` rather than the kit's root, because it is one platform's form
/// among the several a consumer may need, and `design/` root is where the platform-neutral files live.
export const NATIVE_SWIFT = resolve(fileURLToPath(new URL('../design/native/WingTheme.swift', import.meta.url)));

/// This file's own path. `scripts/test-design-tokens-swift.mjs` runs the command line as a child process — the flags on
/// this script are a command line, and calling `renderWingThemeSwift()` in-process would prove nothing about them.
export const SWIFT_GENERATOR = fileURLToPath(import.meta.url);

/// This repository's root, for `show()`: a scratch path under `/tmp` printed as `../../../../tmp/...` is a path nobody
/// can act on, and this script's messages are much of its interface when it refuses or when a verifier reads them.
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/// A path as a reader should see it: relative to this repository when it is inside it, absolute when it is not. The
/// same helper `scripts/package-design-kit.mjs` uses, and for the same reason.
function show(path) {
  const inside = relative(REPOSITORY_ROOT, path);
  return inside.startsWith('..') ? path : inside;
}

/// The base of the scale knob, in points. The JSON names the knob's property (`type.scaleKnob`) but not its value —
/// the same gap the CSS generator documents beside `METER_SCALE_BASE`, and the two must agree or the web and native
/// scales start from different sizes. `scripts/test-design-tokens-swift.mjs` asserts that they do. **1.25 since
/// 2026-10-08**, the application's own drawn scale (`DESIGN-SYSTEM-ROADMAP.md` §4l, D-TYPE-5); the reasoning, and the
/// split from the meter zoom, is written beside the CSS generator's copy of this constant.
export const METER_SCALE_BASE = 1.25;

/// The per-step floor of the type scale, in points. The CSS form is
/// `clamp(<floor>, calc(<floor> + (var(--meter-scale) - 1) * <growth>), <cap>)`; Swift has no `clamp`, so the floor
/// is the static size and `font<Step>(_ scale:)` reproduces the clamped growth. The numbers are the CSS generator's,
/// read from its `FONT_STEP` table at generation time rather than retyped here, so a change to the web scale cannot
/// silently leave the native one behind.
const CSS_GENERATOR = resolve(fileURLToPath(new URL('./generate-design-tokens.mjs', import.meta.url)));

function cssScaleTable() {
  const source = readFileSync(CSS_GENERATOR, 'utf8');
  const match = /const FONT_STEP = \{([\s\S]*?)\n\};/.exec(source);
  if (!match) {
    throw new Error(
      'scripts/generate-design-tokens.mjs no longer has a FONT_STEP table, so this generator cannot tell what the ' +
        'native type scale should be; the two forms would drift, which is the failure the kit exists to prevent',
    );
  }
  const table = {};
  // A step name may carry a hyphen (`readout-lg`, `clock-lg`), because `tokens.json`'s `type.steps`, the CSS custom
  // property (`--font-readout-lg`) and this table all use one spelling. `\w+` was the first version and it silently
  // skipped every hyphenated key, which `renderWingThemeSwift()` then reported as a step the CSS generator has no
  // numbers for — a loud stop, but one that blamed the JSON for the reader's own defect.
  for (const step of match[1].matchAll(/'?([\w-]+)'?:\s*\{ floor: '([^']+)', growth: '([^']+)', cap: '([^']+)' \}/g)) {
    table[step[1]] = { floor: step[2], growth: step[3], cap: step[4] };
  }
  const steps = Object.keys(table);
  if (!steps.length) {
    throw new Error('scripts/generate-design-tokens.mjs\'s FONT_STEP table could not be read; refusing to guess a scale');
  }
  return table;
}

function required(json, ...path) {
  let node = json;
  for (const key of path) {
    node = node?.[key];
    if (node === undefined) {
      throw new Error(
        `design/tokens.json has no ${path.join('.')} — the native generator cannot render design/native/WingTheme.swift`,
      );
    }
  }
  if (typeof node !== 'string') {
    throw new Error(`design/tokens.json's ${path.join('.')} must be a string, found ${typeof node}`);
  }
  return node;
}

/// `#c0c0c0` -> `{ r: 192, g: 192, b: 192 }`. Three- and six-digit forms are accepted because the JSON has used both;
/// anything else stops the generator, because a colour that renders as the wrong one is worse than a missing file.
function hexComponents(value, what) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!match) {
    throw new Error(`design/tokens.json's ${what} is ${JSON.stringify(value)}, which is not a hex colour this generator can render`);
  }
  const hex = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/// `Color(red: 192.0 / 255.0, …)`. Written as an arithmetic expression rather than a decimal literal so the reader
/// can add up the value, and so rounding is the compiler's business rather than the generator's.
function swiftColor(value, what) {
  const { r, g, b } = hexComponents(value, what);
  return `Color(red: ${r}.0 / 255.0, green: ${g}.0 / 255.0, blue: ${b}.0 / 255.0)`;
}

/// `#c0c0c0` -> `0xC0C0C0`, for the documenting comment beside each colour, so the Swift file can be read against
/// `tokens.css` a value at a time.
function hexLiteral(value, what) {
  const { r, g, b } = hexComponents(value, what);
  const hex = (part) => part.toString(16).toUpperCase().padStart(2, '0');
  return `0x${hex(r)}${hex(g)}${hex(b)}`;
}

/// The first family of a CSS font stack: `"MS Sans Serif", "Microsoft Sans Serif", …, sans-serif` -> `MS Sans Serif`.
/// The stack is a CSS spelling that means nothing in Swift, and Swift takes a family name, so the kit's first choice
/// is what a native view can actually set — with the whole stack kept in the generated file as a comment, because a
/// reader comparing the two forms should not have to open `tokens.json` to see what was left behind.
function firstFontFamily(stack, what) {
  const first = String(stack).split(',')[0].trim().replace(/^["']|["']$/g, '');
  if (!first) throw new Error(`design/tokens.json's ${what} is ${JSON.stringify(stack)}, which names no font family`);
  return first;
}

/// A linear gradient, as stops. `linear-gradient(to right, #00a86b 0%, …)`: the direction is dropped because the
/// generated `LinearGradient.wingRamp` carries `startPoint`/`endPoint` as parameters with the CSS default
/// (`leading` -> `trailing`, which is `to right`), and a consumer that needs another direction passes it.
function gradientStops(value, what) {
  const match = /^linear-gradient\(\s*to\s+right\s*,(.*)\)$/i.exec(String(value).trim());
  if (!match) {
    throw new Error(
      `design/tokens.json's ${what} is ${JSON.stringify(value)}; this generator renders only a "to right" linear gradient`,
    );
  }
  const stops = match[1].split(',').map((stop) => stop.trim()).filter(Boolean).map((stop, index) => {
    const parts = stop.split(/\s+/);
    if (parts.length !== 2 || !parts[1].endsWith('%')) {
      throw new Error(`design/tokens.json's ${what} has a stop ${JSON.stringify(stop)} that is not "<colour> <percent>%"`);
    }
    return { color: parts[0], position: parts[1], index };
  });
  if (stops.length < 2) {
    throw new Error(`design/tokens.json's ${what} has ${stops.length} stop(s); a gradient needs at least two`);
  }
  return stops;
}

/// Everything the template needs, read out of the JSON, with every lookup failing loudly by name. No value reaches
/// the Swift file that was not read from `design/tokens.json`.
function readTokens(json = JSON.parse(readFileSync(CANONICAL_JSON, 'utf8'))) {
  const light = json?.theme?.light ?? {};
  const dark = json?.theme?.dark ?? {};
  const names = [...new Set([...Object.keys(light), ...Object.keys(dark)])].sort();
  const colours = names.map((name) => {
    const lightValue = Object.hasOwn(light, name) ? light[name] : null;
    const darkValue = Object.hasOwn(dark, name) ? dark[name] : null;
    if (lightValue === null && darkValue === null) {
      throw new Error(`design/tokens.json declares ${name} in neither theme`);
    }
    return { name, light: lightValue ?? darkValue, dark: darkValue ?? lightValue, darkDeclared: darkValue !== null };
  });
  const scale = cssScaleTable();
  const steps = json?.type?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('design/tokens.json has no type.steps array — the native generator cannot render the type scale');
  }
  for (const step of steps) {
    if (!scale[step]) {
      throw new Error(
        `design/tokens.json's type.steps names "${step}", which the CSS generator has no scale numbers for either; ` +
          'the two forms must name the same steps',
      );
    }
  }
  const space = json?.space;
  if (!space || typeof space !== 'object' || Object.keys(space).length === 0) {
    throw new Error('design/tokens.json has no space section — the native generator cannot render the spacing grid');
  }
  return {
    version: required(json, 'version'),
    source: required(json, 'source'),
    colours,
    winFontStack: required(json, 'type', 'winFont'),
    monoStack: required(json, 'type', 'mono'),
    winFont: firstFontFamily(required(json, 'type', 'winFont'), 'type.winFont'),
    mono: firstFontFamily(required(json, 'type', 'mono'), 'type.mono'),
    /// The scale knob is declared twice: the JSON key (`type.scaleKnob`, camelCase, as the JSON's own convention)
    /// and the CSS custom property it becomes (`--meter-scale`). A comment that says `--meterScale` would be a name
    /// that exists in neither form, so both are kept and each is used where it belongs.
    knob: required(json, 'type', 'scaleKnob'),
    knobProperty: toCssName(required(json, 'type', 'scaleKnob')),
    steps: steps.map((step) => ({ step, ...scale[step] })),
    spaces: Object.entries(space).map(([step, value]) => ({ step, value })),
    ramp: gradientStops(required(json, 'instrument', 'meterRamp'), 'instrument.meterRamp'),
    bevelRule: json?.bevel?.rule ?? null,
  };
}

/// The Swift identifier for a token: `winBtnFace` -> `winBtnFace`, `meter-ramp` -> `meterRamp`. Derived through
/// `toCssName`'s inverse shape — camelCase is the JSON's own convention — so a JSON key is one identifier, not a
/// second naming scheme this generator invents.
function swiftMember(name) {
  return String(name).replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

function enumCaseName(step) {
  // `readout-lg` -> `ReadoutLg`, so a hyphenated step name (the instrument steps, roadmap §4l) is a legal Swift
  // identifier and still reads as the CSS property it comes from. A name with no hyphen is unchanged, which is what
  // every name was before the instrument steps existed.
  return step
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/// The generated file, byte for byte. `json` is injected so a test can render a changed copy without touching the
/// tree, exactly as `renderCanonicalCss(json)` does for the CSS form.
export function renderWingThemeSwift(json = JSON.parse(readFileSync(CANONICAL_JSON, 'utf8'))) {
  const tokens = readTokens(json);

  // Two tokens that would generate the same member in the same namespace are a defect this generator must not be
  // able to produce silently: one of the two values would simply not exist, and a view would compile against the
  // wrong one. Nothing in today's JSON collides; this is the guard that keeps it so.
  const seen = new Map();
  for (const colour of tokens.colours) {
    const member = swiftMember(colour.name);
    if (seen.has(member)) {
      throw new Error(
        `design/tokens.json declares ${seen.get(member)} and ${colour.name}, which both become WingColor.${member}; ` +
          'the native form cannot carry two tokens under one name',
      );
    }
    seen.set(member, colour.name);
  }

  const lightLines = tokens.colours
    .map((colour) => `    /// \`${toCssName(colour.name)}\` — ${hexLiteral(colour.light, `theme.light.${colour.name}`)}${colour.darkDeclared ? '' : ' (declared once: this token is the same in both themes)'}\n    public static let ${swiftMember(colour.name)} = ${swiftColor(colour.light, `theme.light.${colour.name}`)}`)
    .join('\n');
  const darkLines = tokens.colours
    .map((colour) => `    /// \`${toCssName(colour.name)}\` — ${hexLiteral(colour.dark, `theme.dark.${colour.name}`)}${colour.darkDeclared ? '' : ' (the kit declares this token in one theme only)'}\n    public static let ${swiftMember(colour.name)} = ${swiftColor(colour.dark, `theme.dark.${colour.name}`)}`)
    .join('\n');
  const shared = tokens.colours.filter((colour) => !colour.darkDeclared);
  // One public function per token, rather than a `Token` enum plus a switch. A public enum's cases are public, but
  // a public *function* taking it as a parameter cannot be written for an internal type without leaking it, and the
  // access-level juggling that follows is exactly the kind of thing that compiles here and fails in a consumer. One
  // function per token is duller and has no such edge.
  const pickerLines = tokens.colours
    .map(
      (colour) =>
        `  /// \`${toCssName(colour.name)}\` for the scheme a view is in.\n` +
        `  public static func ${swiftMember(colour.name)}(for scheme: ColorScheme) -> Color {\n` +
        `    scheme == .dark ? Dark.${swiftMember(colour.name)} : Light.${swiftMember(colour.name)}\n` +
        '  }',
    )
    .join('\n\n');
  const fontMembers = tokens.steps
    .map(
      (step) =>
        `  /// \`--font-${step.step}\`, from the same \`clamp()\` in \`tokens.css\`: floor ${step.floor}, growth ` +
        `${step.growth} per unit of \`${tokens.knobProperty}\`, cap ${step.cap}.\n` +
        `  public static let font${enumCaseName(step.step)}: CGFloat = ${parseFloat(step.floor)}\n` +
        `  public static func font${enumCaseName(step.step)}(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {\n` +
        `    min(${parseFloat(step.cap)}, ${parseFloat(step.floor)} + (scale - WingTheme.meterScaleBase) * ${parseFloat(step.growth)})\n` +
        '  }',
    )
    .join('\n\n');
  const spaceMembers = tokens.spaces
    .map(
      (entry) =>
        `  /// \`--space-${entry.step}\` — ${entry.value} in the CSS grid.\n` +
        `  public static let ${swiftMember(`space${entry.step}`)}: CGFloat = ${parseFloat(entry.value)}`,
    )
    .join('\n');
  const rampLines = tokens.ramp
    .map(
      (stop) =>
        `    WingGradientStop(position: ${parseFloat(stop.position) / 100}, color: ${swiftColor(stop.color, 'instrument.meterRamp')}),`,
    )
    .join('\n');

  return `// WING CONTROLLER design kit — the native (SwiftUI) form. Version ${tokens.version}.
//
// GENERATED FILE — do not edit. The one file a human edits is \`design/tokens.json\`; this Swift is rendered from it
// by \`scripts/generate-design-tokens-swift.mjs\`, and \`scripts/test-design-tokens-swift.mjs\` fails when the two
// disagree. The same JSON renders \`design/tokens.css\` (\`scripts/generate-design-tokens.mjs\`), so a colour is
// changed once and both forms follow.
//
// Source: ${tokens.source}
//
// -----------------------------------------------------------------------------------------------------------------
// THE HONEST LIMIT — read this before quoting anything below as verified
// -----------------------------------------------------------------------------------------------------------------
// **This kit's conformance suite judges a rendered web page.** It measures computed styles and geometry in a browser
// (\`design/conformance/run.mjs\`, the points of \`design/UI_SYSTEM.md\` §11). It **cannot** judge a SwiftUI
// view, and nothing in this file claims it does. The status of a native screen built on this theme today is
// **"declared, not verified"**: the values below are declared here and rendered from the same JSON the web side
// uses, and whether a particular panel draws them correctly has not been measured by any tool in this repository.
// What *has* been checked is the form itself — byte-identity against the JSON, and that this file compiles.
//
// The rules of §11 still apply to a native view, and they are the point of adopting the kit rather than a
// colour table: a control works or it is absent; both themes are looked at and nothing freezes to the light one;
// figures the operator reads are monospaced and sit in a well; every text size is one of the kit's five steps,
// moved only by the scale knob; a refusal names its cause. Those are review discipline here, not a machine check.
//
// -----------------------------------------------------------------------------------------------------------------
// What this file provides
// -----------------------------------------------------------------------------------------------------------------
//   * \`WingColor\`     — every token of \`design/tokens.css\`, both themes, under the **same names**: the member is
//                       the CSS custom property without its leading dashes (\`--win-btn-face\` ->
//                       \`WingColor.winBtnFace\`, \`--line-light\` -> \`WingColor.lineLight\`).
//   * \`WingColor.<name>(for:)\` — the value for the scheme the view is in. This is the one thing a view has to do
//                       that the CSS does automatically: SwiftUI hands the scheme to a view, it does not resolve a
//                       palette for it. One function per token, with no default for \`scheme\`, so a view cannot
//                       acquire a palette by forgetting to ask which theme it is in.
//   * \`WingTheme\`     — the type scale (\`--font-*\`), the two font family names (\`--win-font\`, \`--mono\`), the
//                       four-pixel spacing grid (\`--space-*\`) and the scale knob (\`${tokens.knobProperty}\`).
//   * \`WingGradient\` — the meter ramp (\`--meter-ramp\`), a MEASURED value rather than a chosen one, deliberately the
//                       same in both themes (see \`design/tokens.css\`).
//${shared.length ? `\n// Theme-independent in the kit, so both themes carry the same value here: ${shared.map((colour) => `\\\`${toCssName(colour.name)}\\\``).join(', ')}.\n` : ''}//${tokens.bevelRule ? `\n// The bevel is geometry rather than a value, so \`design/tokens.json\` carries it as prose: ${tokens.bevelRule}\n// In SwiftUI the raised pair is a stroke in \`WingColor.lineLight\` on the top-left and \`WingColor.lineDark\` on the\n// bottom-right, and a well is the same pair reversed. Nothing here draws it for you: a generated shape would have to\n// decide a corner radius and a stroke width that \`tokens.json\` does not carry.\n` : ''}//

#if canImport(SwiftUI)
import SwiftUI

/// Every colour token in the kit, as the CSS declares them. Light is \`design/tokens.css\`'s \`:root\`, dark is its
/// \`body.theme-dark\`, and a token the dark theme does not re-declare is the same value in both (the phosphor).
public enum WingColor {
  /// \`:root\` — the light theme, complete.
  public enum Light {
${lightLines}
  }

  /// \`body.theme-dark\` — only what changes, with the theme-independent tokens restated so a dark-only call site
  /// cannot fall through to nothing. **Never alias a token to another token inside a theme**: that is the trap that
  /// once froze a window to the light palette (see \`design/tokens.css\`, "The dark theme").
  public enum Dark {
${darkLines}
  }

${pickerLines}
}
${fontMembers ? `\n/// Type, spacing and the one scale knob — the values that are not colours.\npublic enum WingTheme {\n  /// The CSS font stack the kit carries: ${tokens.winFontStack}\n  /// Swift names a family, not a stack, so the first family is exposed and the rest is the browser's fallback rung.\n  public static let winFont: String = ${JSON.stringify(tokens.winFont)}\n  /// The CSS font stack the kit carries: ${tokens.monoStack}\n  public static let mono: String = ${JSON.stringify(tokens.mono)}\n\n  /// \`${tokens.knobProperty}\`: the base the type scale is measured from, in points. The JSON names the knob but not its\n  /// value, so it lives here and in \`scripts/generate-design-tokens.mjs\` — and the two are asserted equal.\n  public static let meterScaleBase: CGFloat = ${METER_SCALE_BASE}\n\n${fontMembers}\n\n${spaceMembers}\n}\n` : ''}
/// The meter ramp, as stops in the gradient's own order. The colours are NOT \`WingColor\` members: the ramp is one
/// MEASURED gradient of six stops in \`tokens.json\`, not six palette entries, and giving them token names would
/// invite a view to use the warning band as a status colour.
public struct WingGradientStop: Sendable {
  public let position: Double
  public let color: Color
}

public enum WingGradient {
  /// \`--meter-ramp\` — green to the reference, warning above it, red at the top.
  public static let meterRamp: [WingGradientStop] = [
${rampLines}
  ]
}

public extension LinearGradient {
  /// \`--meter-ramp\` as a gradient. The default direction is the CSS one (\`to right\`); pass another when the meter
  /// is vertical, which is a decision about the meter and not about the kit.
  static func wingRamp(
    _ stops: [WingGradientStop],
    startPoint: UnitPoint = .leading,
    endPoint: UnitPoint = .trailing
  ) -> LinearGradient {
    LinearGradient(
      stops: stops.map { Gradient.Stop(color: $0.color, location: $0.position) },
      startPoint: startPoint,
      endPoint: endPoint
    )
  }
}
#endif
`;
}

/// The command line. `--check` exists for the same reason the other two design scripts offer it: a review or a hook
/// wants the answer without a write. `--json` and `--out` are the two ends of one operation — read another file, write
/// another file — and both default to this repository's canonical pair, so the everyday invocation is unchanged. The
/// usage text names both defaults, because "which file did it read?" is the question a verifier outside this tree has.
function usage() {
  return [
    'usage: node scripts/generate-design-tokens-swift.mjs [--json <path>] [--out <path>] [--check]',
    '',
    "  --json <path>   the tokens to render (default: design/tokens.json, this repository's canonical JSON)",
    '  --out <path>    where the Swift form is written (default: design/native/WingTheme.swift)',
    '  --check         report the drift and exit 1 instead of writing (the default is to write)',
  ].join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  let jsonPath = CANONICAL_JSON;
  let outPath = NATIVE_SWIFT;
  let checkOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--json' || arg === '--out') {
      // A following flag is not a value: `--json --out x` must refuse rather than read a file named "--out", the same
      // guard `design/conformance/run.mjs` puts on `--record`.
      if (!value || value.startsWith('--')) {
        console.error(`${arg} needs a path\n\n${usage()}`);
        process.exit(2);
      }
      if (arg === '--json') jsonPath = resolve(value);
      else outPath = resolve(value);
      index += 1;
    } else if (arg === '--check') {
      checkOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}\n\n${usage()}`);
      process.exit(2);
    }
  }

  let json;
  try {
    json = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    console.error(`design tokens (swift): cannot read ${show(jsonPath)} as JSON — ${error.message}`);
    process.exit(2);
  }

  const wanted = renderWingThemeSwift(json);
  let current = null;
  try {
    current = readFileSync(outPath, 'utf8');
  } catch (_) {
    current = null;
  }

  // The hint reproduces the invocation that would fix the drift, flags included, so a verifier who pointed `--out` at a
  // scratch file is not told to run a command that would write this repository's own generated form.
  const command =
    'node scripts/generate-design-tokens-swift.mjs' +
    (jsonPath === CANONICAL_JSON ? '' : ` --json ${show(jsonPath)}`) +
    (outPath === NATIVE_SWIFT ? '' : ` --out ${show(outPath)}`);

  if (current === wanted) {
    console.log(`design tokens (swift): ${show(outPath)} is already what ${show(jsonPath)} generates`);
    process.exit(0);
  }
  if (checkOnly) {
    console.error(
      `design tokens (swift): ${show(outPath)} is not what ${show(jsonPath)} generates — run \`${command}\``,
    );
    process.exit(1);
  }
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, wanted);
  } catch (error) {
    console.error(`design tokens (swift): cannot write ${show(outPath)} — ${error.message}`);
    process.exit(2);
  }
  console.log(
    current === null
      ? `design tokens (swift): wrote ${show(outPath)} from ${show(jsonPath)}`
      : `design tokens (swift): regenerated ${show(outPath)} from ${show(jsonPath)}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
