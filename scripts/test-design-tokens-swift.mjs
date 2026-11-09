// The native form of the kit, proven in the same shape ITEM 1 proves for the CSS: `design/native/WingTheme.swift` is
// **generated** from `design/tokens.json`, so "delete it, regenerate, byte-identical" is a test rather than a pasted
// shell session, and a value changed in the JSON must move the Swift.
//
//   node scripts/test-design-tokens-swift.mjs
//
// The four halves, and why each is here rather than in a document:
//
//   1. **Byte-identity.** The committed Swift must equal `renderWingThemeSwift()` byte for byte. This is the contract
//      that makes a stale generated file a red test; it is proven by breaking it on purpose in the commit that added
//      this file (a byte typed by hand into the generated `WingColor` value), and the literal assertion is in that
//      commit's message.
//   2. **The JSON still reaches it.** Rendering a copy whose `theme.light.accent` is `#010203` must produce that
//      colour and change exactly one line. Without this half, a generator with the palette pinned inside it would
//      pass the byte-identity check for ever while the JSON did nothing — which is precisely the failure the CSS
//      generator's test exists to catch (`scripts/test-design-tokens-generator.mjs`, acceptance test 2).
//   3. **The command line reaches another tree.** `--json <path>` and `--out <path>` must do what they say: a scratch
//      copy of `tokens.json` with one value changed, rendered by this repository's generator into that copy, carries
//      the new value — and the run leaves `design/tokens.json` and `design/native/WingTheme.swift` byte-identical and
//      unmodified. This is the half an outsider **could not run** before the flags existed, because the generator read
//      and wrote one fixed pair of paths; the failed attempt is recorded in `docs/HANDOFF_DESIGN_SYSTEM.md`
//      §"Verifying the native form from outside the tree". It is run as a child process, because the flags are a
//      command line and calling `renderWingThemeSwift()` in-process would prove nothing about them.
//   4. **The two forms agree.** Every colour the CSS declares must appear in the Swift with the same value, and the
//      type scale and the font stacks must be the CSS generator's own numbers rather than a second table. This is
//      what "token names and values identical to the CSS side" means as a check rather than as a promise.
//
// Plus two things a byte comparison cannot see: the file's header must say that this suite **cannot verify a native
// view** (the honest limit, "declared, not verified"), and — when a Swift toolchain is present — the generated file
// must actually compile, alone and with a consumer that uses the public API. The compile step is skipped with a note
// when `swiftc` is absent, and it is cheap when present: measured on this machine, `swiftc -typecheck` of the
// generated file and a consumer probe is **0.47 s** (Apple Swift 6.3.1), so it belongs in the everyday gate.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { METER_SCALE_BASE, NATIVE_SWIFT, SWIFT_GENERATOR, renderWingThemeSwift } from './generate-design-tokens-swift.mjs';
import { CANONICAL_CSS, CANONICAL_JSON, isComparableValue, readCanonicalCss, readCanonicalJson, toCssName } from './lib/design-tokens.mjs';

const json = JSON.parse(readFileSync(CANONICAL_JSON, 'utf8'));
const committed = readFileSync(NATIVE_SWIFT, 'utf8');

/// The first line where two texts differ, so a failure names the declaration rather than printing both files.
function firstDifference(a, b) {
  const aLines = String(a).split('\n');
  const bLines = String(b).split('\n');
  for (let index = 0; index < Math.max(aLines.length, bLines.length); index += 1) {
    if (aLines[index] !== bLines[index]) {
      return { line: index + 1, committed: aLines[index], generated: bLines[index] };
    }
  }
  return null;
}

/// A file's identity for the "untouched" assertion: its bytes **and** its modification time. Bytes alone would call a
/// run that rewrote the tree with the same content "untouched", and a rewrite of this tree is exactly the defect the
/// scratch proof below exists to catch; the nanosecond mtime is what makes the write visible even then.
function snapshot(path) {
  return {
    bytes: readFileSync(path, 'utf8'),
    mtimeNs: statSync(path, { bigint: true }).mtimeNs.toString(),
  };
}

/// Fail unless a file is exactly as it was, naming what moved rather than printing two whole Swift files: the first
/// differing line when the content changed, the clock when only the write happened. This is `firstDifference()`'s
/// discipline applied to the "the scratch run must not touch this tree" contract.
function assertUntouched(path, before, why) {
  const now = snapshot(path);
  if (now.bytes === before.bytes && now.mtimeNs === before.mtimeNs) return;
  const drift = firstDifference(before.bytes, now.bytes);
  assert.fail(
    `${why}: ${path} is not untouched after the scratch run — ` +
      (drift
        ? `first difference at line ${drift.line}: before ${JSON.stringify(drift.committed)}, after ${JSON.stringify(drift.generated)}`
        : 'the bytes are identical but its mtime moved') +
      ` (mtime ${before.mtimeNs} -> ${now.mtimeNs}). A verifier's run that writes into this tree is the defect ` +
      '--json/--out exist to prevent.',
  );
}

// ---------------------------------------------------------------------------
// 1. The committed Swift is exactly what the generator renders.
// ---------------------------------------------------------------------------
const rendered = renderWingThemeSwift();
const drift = firstDifference(committed, rendered);
assert.equal(
  drift,
  null,
  drift
    ? `design/native/WingTheme.swift is not what design/tokens.json generates — first difference at line ` +
      `${drift.line}: committed ${JSON.stringify(drift.committed)}, generated ${JSON.stringify(drift.generated)}. ` +
      'Run `node scripts/generate-design-tokens-swift.mjs`; do not edit the generated file by hand.'
    : '',
);

// The files the two generators must agree about, read as the forms a consumer reads them.
const cssTokens = readCanonicalCss(readFileSync(CANONICAL_CSS, 'utf8'));
const jsonTokens = readCanonicalJson(json);

// ---------------------------------------------------------------------------
// 2. A changed value in the JSON changes the native form, and only that value.
// ---------------------------------------------------------------------------
const probe = structuredClone(json);
probe.theme.light.accent = '#010203';
const changed = renderWingThemeSwift(probe);
if (changed === committed) {
  assert.fail(
    'a changed value in design/tokens.json must change the generated WingTheme.swift: rendering --accent #010203 ' +
      `was byte-identical to ${json.theme.light.accent}, so that value no longer comes from the JSON`,
  );
}
// `#010203` -> `Color(red: 1.0 / 255.0, green: 2.0 / 255.0, blue: 3.0 / 255.0)`. Asserted on the rendered
// expression, because the point is that the JSON's bytes reached Swift's arithmetic and not a retyped literal.
assert.ok(
  changed.includes('Color(red: 1.0 / 255.0, green: 2.0 / 255.0, blue: 3.0 / 255.0)'),
  'a changed value in design/tokens.json must change the generated WingTheme.swift; the accent is still the old one',
);
const committedLines = committed.split('\n');
const changedLines = changed.split('\n');
assert.equal(changedLines.length, committedLines.length, 'changing a colour must not add or remove lines');
const differing = changedLines.filter((line, index) => line !== committedLines[index]);
assert.deepEqual(
  differing,
  [
    '    /// `--accent` — 0x010203',
    '    public static let accent = Color(red: 1.0 / 255.0, green: 2.0 / 255.0, blue: 3.0 / 255.0)',
  ],
  `changing one JSON value must change only its own declaration and its comment; the diff was ${JSON.stringify(differing)}`,
);

// A dark-only change must move the dark declaration **and only the dark one**: the two themes are separate lookups,
// and a generator that read the light map for both would pass the probe above and fail here. The line counts are the
// check, because the accent's light value is what the probe above left untouched: exactly one line may differ between
// the light probe and the dark probe.
const darkProbe = structuredClone(json);
darkProbe.theme.dark.accent = '#040506';
const darkChanged = renderWingThemeSwift(darkProbe);
const lightOnlyChanged = changedLines.filter((line, index) => line !== committedLines[index]);
const darkOnlyChanged = darkChanged.split('\n').filter((line, index) => line !== committedLines[index]);
assert.equal(
  darkOnlyChanged.length,
  lightOnlyChanged.length,
  'a change to one theme must move the same number of lines as a change to the other, and neither may move both',
);
assert.ok(
  darkOnlyChanged.some((line) => line.includes('public static let accent = Color(red: 4.0 / 255.0')),
  'a dark-theme value in design/tokens.json must reach the Swift dark palette',
);
assert.deepEqual(
  darkOnlyChanged.filter((line) => line.includes('public static let') || line.includes('///')),
  [
    '    /// `--accent` — 0x040506',
    '    public static let accent = Color(red: 4.0 / 255.0, green: 5.0 / 255.0, blue: 6.0 / 255.0)',
  ],
  'a dark change may move only the dark declaration of that token, and nothing else in the file',
);

// ---------------------------------------------------------------------------
// 3. The command line reaches another tree, and a run outside this one leaves it alone.
// ---------------------------------------------------------------------------
// This is the half of the acceptance test that could not be run by an outsider: copy `tokens.json`, change one value,
// render it — with `--json` pointing at the copy and `--out` writing into the copy. The generator is invoked **as a
// process**, because the flags are a command line and `renderWingThemeSwift()` proves nothing about them. The copy is a
// real `/tmp` directory, and the repository's own two files are snapshotted (bytes **and** mtime) before the child
// runs: a scratch proof that quietly writes this tree is the defect this exercise exists to prevent, so "untouched" is
// asserted, not assumed. Both mutations that prove these contracts were run on a `/tmp` copy of the tree, and their
// literal output is in the commit that added this section.
const scratchAccent = '#0a0b0c';
// `#0a0b0c` -> `Color(red: 10.0 / 255.0, green: 11.0 / 255.0, blue: 12.0 / 255.0)`. Asserted on the rendered expression
// rather than on the hex, because the hex also appears in the documenting comment beside the value.
const scratchExpression = 'Color(red: 10.0 / 255.0, green: 11.0 / 255.0, blue: 12.0 / 255.0)';
assert.notEqual(json.theme.light.accent, scratchAccent, 'the scratch probe must change the value, not restate it');

const scratch = mkdtempSync(join(tmpdir(), 'wing-swift-json-'));
try {
  const scratchJson = join(scratch, 'tokens.json');
  const scratchSwift = join(scratch, 'WingTheme.swift');
  const copied = structuredClone(json);
  copied.theme.light.accent = scratchAccent;
  writeFileSync(scratchJson, `${JSON.stringify(copied, null, 2)}\n`);

  const before = { json: snapshot(CANONICAL_JSON), swift: snapshot(NATIVE_SWIFT) };
  const run = spawnSync(process.execPath, [SWIFT_GENERATOR, '--json', scratchJson, '--out', scratchSwift], {
    encoding: 'utf8',
  });
  assert.equal(
    run.status,
    0,
    `\`node scripts/generate-design-tokens-swift.mjs --json <copy> --out <copy>\` must render the copy and exit 0; ` +
      `it exited ${run.status}:\n${String(run.stderr || run.stdout).split('\n').slice(0, 12).join('\n')}`,
  );
  // The tree first, before the scratch output is even read: a run whose `--out` defaulted to the tree (or whose
  // `--json`/`--out` were dropped) must fail on *this* sentence, not on a missing scratch file further down.
  assertUntouched(CANONICAL_JSON, before.json, 'a scratch run with --json pointing elsewhere must not modify design/tokens.json');
  assertUntouched(
    NATIVE_SWIFT,
    before.swift,
    'a scratch run with --out pointing elsewhere must not modify design/native/WingTheme.swift',
  );
  // And the copy: the changed value must have reached the Swift, which is the sentence that catches a `--json` that
  // read the wrong file (a generator with its own path pinned, or a flag that was silently ignored).
  assert.ok(existsSync(scratchSwift), `--out must create ${scratchSwift}; nothing was written there`);
  const scratchRendered = readFileSync(scratchSwift, 'utf8');
  assert.ok(
    scratchRendered.includes(scratchExpression),
    `the generator must render --json's changed value into --out: expected ${scratchExpression} for ` +
      `theme.light.accent = ${scratchAccent} (${CANONICAL_JSON} still says ${json.theme.light.accent}), and the file ` +
      `written to ${scratchSwift} does not carry it`,
  );
  assert.notEqual(
    scratchRendered,
    committed,
    'the Swift rendered from the changed copy must differ from the committed design/native/WingTheme.swift — ' +
      'otherwise the value being asserted came from the tree and not from --json',
  );
  assert.ok(
    run.stdout.includes(scratchSwift) && run.stdout.includes(scratchJson),
    `the write must name both paths it used, so a verifier can see where the bytes went; it printed ` +
      `${JSON.stringify(run.stdout.trim())}`,
  );

  // `--check` honours the same two flags: against the copy it just wrote it is in sync and exits 0. That is
  // discriminating rather than decorative — a `--check` that ignored `--out` would compare this repository's unchanged
  // Swift against the copy's changed rendering and exit 1.
  const inSync = spawnSync(process.execPath, [SWIFT_GENERATOR, '--check', '--json', scratchJson, '--out', scratchSwift], {
    encoding: 'utf8',
  });
  assert.equal(
    inSync.status,
    0,
    `\`--check\` must compare --out against what --json renders and report the copy in sync (exit 0); it exited ` +
      `${inSync.status}:\n${String(inSync.stderr || inSync.stdout).split('\n').slice(0, 12).join('\n')}`,
  );

  // And the command line refuses what it does not know, so a verifier's typo is a sentence rather than a write to
  // whichever path the default happens to be.
  const refused = spawnSync(process.execPath, [SWIFT_GENERATOR, '--nonsense'], { encoding: 'utf8' });
  assert.equal(refused.status, 2, `an unknown argument must exit 2; it exited ${refused.status}`);
  assert.ok(
    `${refused.stderr}${refused.stdout}`.includes('unknown argument: --nonsense'),
    'an unknown argument must be named in the refusal, not swallowed',
  );

  // The proof, printed, so the passing run carries its own evidence rather than only a silent exit 0.
  console.log(
    `design tokens (swift): the command line rendered a changed /tmp copy through --json/--out (theme.light.accent ` +
      `${json.theme.light.accent} -> ${scratchAccent}, ${scratchExpression}) and left design/tokens.json and ` +
      'design/native/WingTheme.swift untouched',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 4. The two forms carry the same token names and the same values.
// ---------------------------------------------------------------------------
// Every **colour** the CSS declares, in both themes, must be a member of the Swift form under the CSS spelling. This
// is the "names are identical" half: `--win-btn-face` is `WingColor.winBtnFace`, and a colour the CSS has and the
// Swift does not is named rather than silently absent. The non-colour tokens (`--meter-scale`, the `--font-*` steps,
// the `--space-*` grid, the two font stacks) are asserted separately, member by member, further down — the two forms
// spell those differently on purpose (`WingTheme.meterScaleBase`, `WingTheme.fontBase(_:)`), and pretending they are
// the same member would be the weaker check.
const memberOf = (name) => name.replace(/^--/, '').replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
const missing = [];
for (const theme of ['light', 'dark']) {
  for (const [name, value] of cssTokens[theme]) {
    if (!isComparableValue(value)) continue;
    if (!new RegExp(`public static let ${memberOf(name)}\\b`).test(committed)) missing.push(`${name} (${theme})`);
  }
}
for (const [name, value] of cssTokens.shared) {
  if (!isComparableValue(value)) continue;
  if (!new RegExp(`public static let ${memberOf(name)}\\b`).test(committed)) missing.push(`${name} (theme-independent)`);
}
assert.deepEqual(
  missing,
  [],
  `the native form must carry every token the CSS form carries, under the CSS spelling; missing: ${missing.join(', ')}`,
);

// And the values: the hex the JSON holds must appear as the Swift arithmetic that renders it. Comparing the arithmetic
// rather than "the file contains the hex" is deliberate — the hex appears in the documenting comment too, so a file
// whose comment said #c0c0c0 and whose value said something else would pass the weaker check.
function swiftExpressionFor(hex, what) {
  const text = String(hex).trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  assert.ok(match, `${what} is ${JSON.stringify(hex)}, which is not a hex colour`);
  const full = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1];
  const component = (part) => `${parseInt(part, 16)}.0 / 255.0`;
  return `Color(red: ${component(full.slice(0, 2))}, green: ${component(full.slice(2, 4))}, blue: ${component(full.slice(4, 6))})`;
}
const valueProblems = [];
for (const theme of ['light', 'dark']) {
  for (const [name, value] of jsonTokens[theme]) {
    if (!/^#[0-9a-f]{3,8}$/i.test(value)) continue;
    const expression = swiftExpressionFor(value, `${name} (${theme})`);
    if (!committed.includes(expression)) valueProblems.push(`${name} (${theme}): the JSON says ${value}, the Swift has no ${expression}`);
  }
}
assert.deepEqual(
  valueProblems,
  [],
  `the two forms must carry the same values; differences:\n  ${valueProblems.join('\n  ')}`,
);

// The type scale must be the CSS generator's own numbers. The floors are the `clamp()` floors in `tokens.css`, read
// here from the generated CSS rather than from a second table: a floor changed on the web side and not here is the
// drift this assertion exists to catch.
const scaleProblems = [];
// The Swift member's spelling, derived from the step name the JSON declares. A step name may carry a hyphen (the
// instrument steps, roadmap §4l: `readout-lg`, `clock-lg`), and the generated member drops it and capitalises the next
// letter — `WingTheme.fontReadoutLg` — so a reader that only uppercased the first letter could not see those members at
// all and would report the Swift form as missing them. This is the same kebab-to-camel rule `memberOf` above uses.
const swiftFontMember = (step) =>
  `font${step.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`;
for (const step of json.type.steps) {
  const cssFloor = new RegExp(`--font-${step}: clamp\\(([0-9.]+)px`).exec(readFileSync(CANONICAL_CSS, 'utf8'));
  assert.ok(cssFloor, `tokens.css must declare --font-${step} with a clamp() floor`);
  const swiftFloor = new RegExp(`public static let ${swiftFontMember(step)}: CGFloat = ([0-9.]+)\\b`).exec(committed);
  if (!swiftFloor) scaleProblems.push(`the Swift form has no ${swiftFontMember(step)} member`);
  else if (Number(swiftFloor[1]) !== Number(cssFloor[1])) {
    scaleProblems.push(`--font-${step}: tokens.css floors at ${cssFloor[1]}px and the Swift form at ${swiftFloor[1]}`);
  }
}
assert.deepEqual(scaleProblems, [], `the two type scales must be the same scale:\n  ${scaleProblems.join('\n  ')}`);
// The scale knob's base is the CSS generator's `METER_SCALE_BASE`, not a number retyped here. It is imported from the
// Swift generator (which reads the CSS generator's table) and asserted against `tokens.css`'s `--meter-scale` value.
const knobName = toCssName(json.type.scaleKnob);
assert.ok(
  new RegExp(`${knobName}: ${METER_SCALE_BASE};`).test(readFileSync(CANONICAL_CSS, 'utf8')),
  `tokens.css must declare ${knobName}: ${METER_SCALE_BASE}; and the Swift base must be the same value`,
);
assert.ok(
  new RegExp(`public static let meterScaleBase: CGFloat = ${METER_SCALE_BASE}\\b`).test(committed),
  `the Swift form must declare meterScaleBase = ${METER_SCALE_BASE}`,
);
// The spacing grid, likewise: every CSS step's pixel value must appear as the Swift member's.
for (const [step, value] of Object.entries(json.space)) {
  assert.ok(
    new RegExp(`public static let space${step}: CGFloat = ${parseFloat(value)}\\b`).test(committed),
    `the native form must carry --space-${step} (${value}) as space${step}`,
  );
}
// The font family is the CSS stack's first family, and the whole stack stays in the file so a reader can compare.
assert.ok(committed.includes(`public static let winFont: String = "${json.type.winFont.split(',')[0].trim().replace(/"/g, '')}"`), 'WingTheme.winFont must be the first family of --win-font');
assert.ok(committed.includes(json.type.winFont), 'the whole --win-font stack must stay in the file, so the two forms can be read against each other');

// ---------------------------------------------------------------------------
// 5. The honest limit is in the file a native developer opens, not only in a document here.
// ---------------------------------------------------------------------------
assert.ok(
  committed.includes('"declared, not verified"'),
  'the generated Swift must state, in its own header, that a native screen is "declared, not verified"',
);
assert.ok(
  committed.includes('It **cannot** judge a SwiftUI'),
  'the generated Swift must say that the conformance suite cannot judge a SwiftUI view',
);
assert.ok(
  committed.startsWith('// WING CONTROLLER design kit — the native (SwiftUI) form.'),
  'the generated Swift must open with the line that says what it is',
);
assert.ok(committed.includes('GENERATED FILE — do not edit'), 'the generated Swift must say it is generated');
assert.ok(committed.includes(`Version ${json.version}.`), 'the generated Swift must carry the kit version in its header');

// ---------------------------------------------------------------------------
// 6. It compiles — alone, and against a consumer that uses the public API.
// ---------------------------------------------------------------------------
// This is the half a text comparison cannot do: a generated file that names a member nothing declares, or one whose
// members are internal, is a file a consumer cannot build against. `swiftc` is not present on every machine this
// project is checked out on, so its absence is a printed note and not a silent pass or a false failure.
const swiftc = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
if (swiftc.error || swiftc.status !== 0) {
  console.log(
    'design tokens (swift): NOTE — no Swift toolchain on PATH, so the generated file was NOT compiled here; ' +
      'the byte comparison above still ran',
  );
} else {
  const dir = mkdtempSync(join(tmpdir(), 'wing-swift-'));
  try {
    writeFileSync(join(dir, 'WingTheme.swift'), committed);
    // A consumer probe, written from the tokens the JSON declares rather than from a list typed here, so a token that
    // disappears from the JSON disappears from the probe too and the probe cannot go stale on its own.
    const colourCalls = jsonTokens.light.keys().map((name) => {
      const member = name.replace(/^--/, '').replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
      return `  WingColor.${member}(for: .light),`;
    });
    const probe = [
      'import SwiftUI',
      'let _allColours: [Color] = [',
      ...colourCalls,
      ']',
      'let _sizes: [CGFloat] = [',
      ...json.type.steps.map((step) => `  WingTheme.${swiftFontMember(step)},`),
      ...Object.keys(json.space).map((step) => `  WingTheme.space${step},`),
      ']',
      'let _ramp = LinearGradient.wingRamp(WingGradient.meterRamp)',
      'struct WingProbe: View {',
      '  @Environment(\\.colorScheme) private var scheme',
      '  var body: some View {',
      '    Text("9001").font(.custom(WingTheme.mono, size: WingTheme.fontBase())).foregroundStyle(WingColor.crtInk(for: scheme))',
      '      .background(WingColor.crt(for: scheme)).padding(WingTheme.space4)',
      '  }',
      '}',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'Consumer.swift'), probe);
    const check = spawnSync('swiftc', ['-typecheck', 'WingTheme.swift', 'Consumer.swift'], { cwd: dir, encoding: 'utf8' });
    assert.equal(
      check.status,
      0,
      `the generated WingTheme.swift must compile, alone and against a consumer of its public API; swiftc said:\n` +
        `${String(check.stderr || check.stdout).split('\n').slice(0, 12).join('\n')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(
  `design tokens (swift): design/native/WingTheme.swift is byte-identical to what design/tokens.json generates ` +
    `(${committed.length} bytes, ${jsonTokens.light.size} light + ${jsonTokens.dark.size} dark tokens, version ${json.version})`,
);
