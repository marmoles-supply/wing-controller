// The conformance suite's own logic, pinned without a browser.
//
// `design/conformance/self-test.mjs` proves the suite goes red on a *rendered* page; this file proves the same rules
// over observations this test controls, so the everyday loop (`verify-all.sh --quick`, which touches no browser)
// still catches a rule whose logic has rotted. Both exist on purpose: the browser proof is the one that matters
// (§6: rules are checked on the rendered result), and this one keeps the logic honest between those runs.
//
// Run: node scripts/test-design-conformance.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyse,
  kitPalette,
  looksNumeric,
  parseColour,
  parseKitTokens,
  rule1Edges,
  tokenRole,
} from '../design/conformance/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_CSS = resolve(HERE, '../design/tokens.css');

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok  ${name}`);
}

// ---------------------------------------------------------------------------
// The kit parser, the colour parser and the vocabulary the rules share
// ---------------------------------------------------------------------------
const kit = parseKitTokens(readFileSync(KIT_CSS, 'utf8'));
const palette = kitPalette(kit);

check('the kit parser reads both themes out of the live tokens.css', () => {
  assert.ok(kit.names.has('--face'), 'the live kit should declare --face');
  assert.ok(kit.light['--face'], 'the light table should carry --face');
  assert.ok(kit.dark['--face'], 'the dark table should carry --face');
  assert.ok(kit.darkNames.has('--face'), 'the dark block should re-declare --face');
  assert.ok(!kit.darkNames.has('--crt-ink'), '--crt-ink is deliberately the same in both themes');
});

check('colours parse in every spelling the page and the stylesheets use', () => {
  assert.equal(parseColour('#c0c0c0').key, 'rgb(192, 192, 192)');
  assert.equal(parseColour('#fff').key, 'rgb(255, 255, 255)');
  assert.equal(parseColour('rgb(5, 10, 8)').key, 'rgb(5, 10, 8)');
  assert.equal(parseColour('rgba(0, 0, 0, 0.4)').a, 0.4);
  assert.equal(parseColour('transparent'), null);
  assert.equal(parseColour('none'), null);
  assert.equal(parseColour('not a colour'), null);
});

check('a token is classed by what it is for, so a black frame is not frozen black text', () => {
  assert.equal(tokenRole('--ink'), 'ink');
  assert.equal(tokenRole('--crt-ink'), 'ink');
  assert.equal(tokenRole('--win-title-text'), 'ink');
  assert.equal(tokenRole('--face'), 'surface');
  assert.equal(tokenRole('--crt'), 'surface');
  assert.equal(tokenRole('--line-light'), 'line');
  assert.equal(tokenRole('--win-window-frame'), 'line');
  assert.equal(tokenRole('--maroon'), 'state');
});

check('the palette is the kit\'s, gradients included', () => {
  assert.ok(palette.has('rgb(192, 192, 192)'), 'the light face is a known colour');
  assert.ok(palette.has('rgb(0, 168, 107)'), 'a stop of --meter-ramp is a known colour');
  assert.ok(!palette.has('rgb(255, 0, 255)'), 'magenta is not a kit colour');
});

check('the number pattern knows a value from a word', () => {
  for (const text of ['42.5 dB', '-6.0 dB', '12:34:56', '1', '1.0.0', '192.168.1.10', '99%']) {
    assert.ok(looksNumeric(text), `"${text}" is a value the operator reads`);
  }
  for (const text of ['Channel 3', 'dB', 'gain', '', 'Shoot']) {
    assert.ok(!looksNumeric(text), `"${text}" is not a bare value`);
  }
});

// ---------------------------------------------------------------------------
// Synthetic observations, in the shape collect.mjs produces
// ---------------------------------------------------------------------------
const colour = (value) => parseColour(value).key;

function element(index, parent, fields = {}) {
  return {
    i: index,
    parent,
    tag: fields.tag || 'div',
    id: fields.id || '',
    cls: fields.cls || [],
    element: fields.element || `${fields.tag || 'div'}${fields.id ? '#' + fields.id : ''}`,
    path: fields.path || `html > body > ${fields.element || 'div'}${fields.id ? '#' + fields.id : ''}`,
    // The structural key rule 4e pairs the two renderings on (`collect.mjs`: every ancestor's tag plus `nth-of-type`).
    // A synthetic element that does not set one borrows its display path, which is unique in these hand-built
    // snapshots; the collision the key exists for is pinned below with two elements that share a path and carry
    // different structural keys.
    struct: fields.struct !== undefined
      ? fields.struct
      : (fields.path || `html > body > ${fields.element || 'div'}${fields.id ? '#' + fields.id : ''}`),
    text: fields.text || '',
    descText: fields.descText || fields.text || '',
    w: 100,
    h: 20,
    // The index into the observation's token table: the kit values a rule compares against, resolved where this
    // element lives (`collect.mjs`). A test that leaves it null falls back to <body>, which is the single-theme shape.
    tokens: fields.tokens === undefined ? null : fields.tokens,
    color: fields.color || colour(kit.light['--ink']),
    bg: fields.bg || 'rgba(0, 0, 0, 0)',
    borders: fields.borders || [
      { w: '0px', style: 'none', color: 'rgb(0, 0, 0)' },
      { w: '0px', style: 'none', color: 'rgb(0, 0, 0)' },
      { w: '0px', style: 'none', color: 'rgb(0, 0, 0)' },
      { w: '0px', style: 'none', color: 'rgb(0, 0, 0)' },
    ],
    radius: fields.radius || ['0px', '0px', '0px', '0px'],
    shadow: fields.shadow || 'none',
    outline: { w: '0px', style: 'none', color: 'rgb(0, 0, 0)' },
    backgroundImage: 'none',
    fontFamily: fields.fontFamily || 'Interface',
    fontSize: '12px',
    interactive: Boolean(fields.interactive),
    isField: Boolean(fields.isField),
    disabled: Boolean(fields.disabled),
    disabledWhy: fields.disabledWhy || '',
    role: fields.role || '',
    ariaLabel: '',
    title: '',
    dataState: fields.dataState === undefined ? null : fields.dataState,
    dataStateSet: fields.dataStateSet === undefined ? null : fields.dataStateSet,
    refusal: Boolean(fields.refusal),
    svgFill: null,
    svgStroke: null,
    shape: fields.shape || null,
  };
}

const raised = (theme) => [
  { w: '1px', style: 'solid', color: colour(kit[theme]['--win-btn-highlight']) },
  { w: '1px', style: 'solid', color: colour(kit[theme]['--win-btn-dark-shadow']) },
  { w: '1px', style: 'solid', color: colour(kit[theme]['--win-btn-dark-shadow']) },
  { w: '1px', style: 'solid', color: colour(kit[theme]['--win-btn-highlight']) },
];
const sunken = (theme) => [
  { w: '1px', style: 'solid', color: colour(kit[theme]['--line-dark']) },
  { w: '1px', style: 'solid', color: colour(kit[theme]['--line-light']) },
  { w: '1px', style: 'solid', color: colour(kit[theme]['--line-light']) },
  { w: '1px', style: 'solid', color: colour(kit[theme]['--line-dark']) },
];

function page(theme, elements) {
  const tokens = {};
  for (const [name, value] of Object.entries(kit[theme])) tokens[name] = value;
  return {
    bodyTokens: tokens,
    elements: [
      element(0, -1, { tag: 'body', element: 'body', path: 'html > body', bg: colour(kit[theme]['--face']) }),
      ...elements,
    ],
    styleTexts: [],
    inlineStyles: [],
    linkHrefs: [],
  };
}

function run(snapshots, extra = {}) {
  return analyse({
    kit,
    palette,
    snapshots,
    references: extra.references || [],
    declaredTokens: extra.declaredTokens || [],
  });
}

// A page that paints both themes at once, in the shape `collect.mjs` records it: <body> resolves the light values, and
// the elements below carry `tokens: 1` — the dark column, whose own cascade resolves the dark ones. This is the shape
// `design/specimen.html` has, and the defect this pins judged that column against <body>'s pair.
const TWO_THEME_TOKENS = [
  '--line-light', '--win-btn-highlight', '--line-dark', '--win-btn-dark-shadow', '--crt', '--field', '--mono',
];
function twoThemePage(elements) {
  const snapshot = page('light', elements);
  const row = (theme) => TWO_THEME_TOKENS.map((name) => kit[theme][name]);
  snapshot.tokenNames = TWO_THEME_TOKENS;
  snapshot.tokenTable = [row('light'), row('dark')];
  return snapshot;
}

const mono = kit.light['--mono'];

// ---------------------------------------------------------------------------
// A conforming page passes, and a page that must fail does
// ---------------------------------------------------------------------------
const conformingElements = [
  element(1, 0, { tag: 'div', id: 'card', element: 'div#card', cls: ['card'], path: 'html > body > div#card', borders: raised('light'), bg: colour(kit.light['--win-btn-face']) }),
  element(2, 1, { tag: 'div', id: 'well', element: 'div#well', cls: ['well'], path: 'html > body > div#card > div#well', borders: sunken('light'), bg: colour(kit.light['--crt']) }),
  element(3, 2, { tag: 'span', id: 'clock', element: 'span#clock', path: 'html > body > div#card > div#well > span#clock', text: '12:34:56', fontFamily: mono, color: colour(kit.light['--crt-ink']) }),
  element(4, 0, { tag: 'div', id: 'states', element: 'div#states', border: undefined, dataStateSet: 'yes no unknown' }),
  element(5, 4, { tag: 'span', id: 'chip', element: 'span#chip', cls: ['chip'], path: 'html > body > div#states > span#chip', text: 'ARMED', borders: raised('light'), bg: colour(kit.light['--win-btn-face']), dataState: 'yes', dataStateSet: 'yes no unknown', shape: { text: 'ARMED', children: [] } }),
  element(6, 0, { tag: 'button', id: 'shoot', element: 'button#shoot', path: 'html > body > button#shoot', text: 'Shoot', interactive: true, borders: raised('light'), bg: colour(kit.light['--win-btn-face']) }),
];

const conforming = run({ light: page('light', conformingElements) });
check('a conforming observation reports nothing (and rule 7 is not checked, never a pass)', () => {
  const failures = conforming.findings.filter((item) => item.severity === 'fail');
  assert.deepEqual(failures.map((item) => `rule ${item.rule} ${item.code}`), []);
  assert.equal(conforming.stats[1].raised, 3, 'the three raised edges should have been counted');
  assert.equal(conforming.stats[2].numbers, 1, 'the clock should have been counted as a value');
  const vocabulary = conforming.findings.find((item) => item.rule === 7);
  assert.equal(vocabulary.severity, 'not-checked');
});

check('a raised surface misread as a well is caught: the number outside a well fails', () => {
  const elements = [
    element(1, 0, { tag: 'div', id: 'panel', element: 'div#panel', borders: raised('light'), bg: colour(kit.light['--win-btn-face']) }),
    element(2, 1, { tag: 'span', id: 'reading', element: 'span#reading', path: 'html > body > div#panel > span#reading', text: '42.5 dB', fontFamily: mono, color: colour(kit.light['--ink']) }),
  ];
  const result = run({ light: page('light', elements) });
  assert.ok(result.findings.some((item) => item.rule === 2 && item.code === 'not-in-well' && item.measured.includes('42.5 dB')));
});

check('a number in the interface font fails even inside a well', () => {
  const elements = [
    element(1, 0, { tag: 'div', id: 'well', element: 'div#well', borders: sunken('light'), bg: colour(kit.light['--crt']) }),
    element(2, 1, { tag: 'span', id: 'reading', element: 'span#reading', path: 'html > body > div#well > span#reading', text: '42.5', fontFamily: 'Interface', color: colour(kit.light['--crt-ink']) }),
  ];
  const result = run({ light: page('light', elements) });
  assert.ok(result.findings.some((item) => item.rule === 2 && item.code === 'not-mono'));
});

check('edges that mix the two steps fail even though every colour is the kit\'s', () => {
  const mixed = [
    { w: '1px', style: 'solid', color: colour(kit.light['--line-light']) },
    { w: '1px', style: 'solid', color: colour(kit.light['--line-light']) },
    { w: '1px', style: 'solid', color: colour(kit.light['--line-dark']) },
    { w: '1px', style: 'solid', color: colour(kit.light['--line-dark']) },
  ];
  const result = rule1Edges(page('light', [element(1, 0, { borders: mixed })]), { kit });
  assert.ok(result.some((item) => item.code === 'mixed-edges'));
  const colours = run({ light: page('light', [element(1, 0, { borders: mixed })]) });
  assert.ok(!colours.findings.some((item) => item.rule === 3), 'the colours are the kit\'s, so rule 3 must stay quiet');
});

check('a rounded corner, and one element carrying both shapes, fail', () => {
  const rounded = rule1Edges(page('light', [element(1, 0, { radius: ['6px', '0px', '0px', '0px'] })]), { kit });
  assert.ok(rounded.some((item) => item.code === 'rounded'));
  const both = rule1Edges(page('light', [element(1, 0, { borders: raised('light'), shadow: 'rgb(255, 255, 255) 0px 1px 0px 0px inset' })]), { kit });
  assert.ok(both.some((item) => item.code === 'two-shapes'));
});

check('each column of a two-theme page is judged against the pair it resolves, and a mixed bevel in it still fails', () => {
  // The defect this pins was measured on the kit's own specimen: the two steps were resolved once from <body> (the
  // light pair) and the dark column's correct bevels were reported as mixed 154 times. The pair must come from the
  // element, and a genuinely rotated pair in that same column must still fail.
  const darkColumn = [
    element(1, 0, { element: 'div#dark-raised', path: 'html > body > section:nth-of-type(2) > div#dark-raised', tokens: 1, borders: raised('dark'), bg: colour(kit.dark['--win-btn-face']) }),
    element(2, 0, { element: 'div#dark-well', path: 'html > body > section:nth-of-type(2) > div#dark-well', tokens: 1, cls: ['well'], borders: sunken('dark'), bg: colour(kit.dark['--crt']) }),
    element(3, 2, { element: 'span#dark-reading', path: 'html > body > section:nth-of-type(2) > div#dark-well > span#dark-reading', tokens: 1, text: '42.5 dB', fontFamily: mono, color: colour(kit.light['--crt-ink']) }),
  ];
  const result = run({ light: twoThemePage(darkColumn) });
  const failures = result.findings.filter((item) => item.severity === 'fail');
  assert.deepEqual(failures.map((item) => `rule ${item.rule} ${item.code} (${item.measured})`), [],
    'the dark column\'s own pair must be the one its bevels are judged against');
  assert.equal(result.stats[1].raised, 1, 'the dark column\'s raised card should have been recognised as raised');
  assert.equal(result.stats[1].sunken, 1, 'the dark column\'s well should have been recognised as sunken');

  const rotated = [
    { w: '1px', style: 'solid', color: colour(kit.dark['--win-btn-highlight']) },
    { w: '1px', style: 'solid', color: colour(kit.dark['--win-btn-highlight']) },
    { w: '1px', style: 'solid', color: colour(kit.dark['--win-btn-dark-shadow']) },
    { w: '1px', style: 'solid', color: colour(kit.dark['--win-btn-dark-shadow']) },
  ];
  const mixed = rule1Edges(twoThemePage([
    element(1, 0, { element: 'div#dark-mixed', path: 'html > body > section:nth-of-type(2) > div#dark-mixed', tokens: 1, borders: rotated }),
  ]), { kit });
  assert.ok(mixed.some((item) => item.code === 'mixed-edges'), 'a rotated pair in the dark column is still a mix');
});

check('a colour outside the kit fails rule 3, and a shade from another theme does not', () => {
  const literal = run({ light: page('light', [element(1, 0, { bg: 'rgb(255, 0, 255)' })]) });
  const finding = literal.findings.find((item) => item.rule === 3);
  assert.ok(finding && finding.measured.includes('rgb(255, 0, 255)'));
  assert.ok(finding.spellings.includes('#ff00ff'), 'the hex spelling travels with the finding so a deviation can quote it');
  const darkShadeInLight = run({ light: page('light', [element(1, 0, { bg: colour(kit.dark['--face']) })]) });
  assert.ok(!darkShadeInLight.findings.some((item) => item.rule === 3), 'the palette is the kit\'s colours in both themes');
});

check('a greyed control fails, with the promise it carries quoted', () => {
  const result = run({ light: page('light', [element(1, 0, { tag: 'button', element: 'button#add', interactive: true, disabled: true, disabledWhy: 'arrives with the MIDI support' })]) });
  const finding = result.findings.find((item) => item.rule === 5 && item.code === 'disabled-control');
  assert.ok(finding && finding.measured.includes('arrives with the MIDI support'));
});

check('a refusal with no words, and one that names nothing, both fail', () => {
  const silent = run({ light: page('light', [element(1, 0, { refusal: true, role: 'alert' })]) });
  assert.ok(silent.findings.some((item) => item.code === 'silent-refusal'));
  const generic = run({ light: page('light', [element(1, 0, { refusal: true, role: 'alert', descText: 'Error' })]) });
  assert.ok(generic.findings.some((item) => item.code === 'generic-refusal'));
  const named = run({ light: page('light', [element(1, 0, { refusal: true, role: 'alert', descText: 'Refused: the console did not answer' })]) });
  assert.ok(!named.findings.some((item) => item.rule === 5), 'a refusal that names its cause must pass');
});

check('a machine decision with two states fails, and a third state is required', () => {
  const two = run({ light: page('light', [element(1, 0, { dataState: 'yes', dataStateSet: 'yes no', shape: { text: 'OK' } })]) });
  assert.ok(two.findings.some((item) => item.rule === 6 && item.code === 'two-states'));
  const three = run({ light: page('light', [element(1, 0, { dataState: 'yes', dataStateSet: 'yes no unknown', shape: { text: 'ARMED' } })]) });
  assert.ok(!three.findings.some((item) => item.rule === 6 && item.severity === 'fail'), 'three declared states pass');
});

check('states that differ only in colour fail, and states with their own words pass', () => {
  const colourOnly = run({ light: page('light', [
    element(1, 0, { dataState: 'yes', dataStateSet: 'yes no unknown', shape: { text: 'OK', children: [] } }),
    element(2, 0, { dataState: 'no', dataStateSet: 'yes no unknown', shape: { text: 'OK', children: [] } }),
  ]) });
  assert.ok(colourOnly.findings.some((item) => item.code === 'colour-only-state'));
  const words = run({ light: page('light', [
    element(1, 0, { dataState: 'yes', dataStateSet: 'yes no unknown', shape: { text: 'ARMED', children: [] } }),
    element(2, 0, { dataState: 'no', dataStateSet: 'yes no unknown', shape: { text: 'SAFE', children: [] } }),
  ]) });
  assert.ok(!words.findings.some((item) => item.code === 'colour-only-state'));
  const absent = run({ light: page('light', [element(1, 0, { dataState: 'yes', dataStateSet: 'yes no unknown', shape: { text: 'ARMED' } })]) });
  assert.ok(absent.findings.some((item) => item.code === 'state-not-on-page' && item.severity === 'note'),
    'a declared state that is not on the page is said out loud, as a note');
});

// ---------------------------------------------------------------------------
// Rule 4's four checks
// ---------------------------------------------------------------------------
const light = page('light', []);
const dark = page('dark', []);

check('one theme rendered means rule 4 says NOT RUN rather than passing', () => {
  const result = run({ light });
  const rule = result.findings.find((item) => item.rule === 4);
  assert.equal(rule.severity, 'not-run');
});

check('a token the app asks for and nothing defines is caught, and a fallback is left alone', () => {
  const result = run({ light, dark }, {
    references: [
      { name: '--space-9', hasFallback: false, source: 'app', element: 'div#padded', path: 'div#padded' },
      { name: '--also-missing', hasFallback: true, source: 'app', element: 'div#padded', path: 'div#padded' },
      { name: '--defined-elsewhere', hasFallback: false, source: 'app', element: 'div#x', path: 'div#x' },
    ],
    declaredTokens: ['--defined-elsewhere'],
  });
  const unknown = result.findings.filter((item) => item.code === 'unknown-token');
  assert.equal(unknown.length, 1, 'exactly the token without a fallback and without a definition is reported');
  assert.equal(unknown[0].measured.includes('--space-9'), true);
});

check('a kit token redefined away from the copy is caught on the computed value', () => {
  const pageWithFace = (value) => {
    const snapshot = page('light', []);
    snapshot.bodyTokens['--face'] = value;
    return snapshot;
  };
  const result = run({ light: pageWithFace(colour(kit.light['--crt'])), dark: page('dark', []) });
  const finding = result.findings.find((item) => item.code === 'redefined-token');
  assert.ok(finding && finding.measured.includes('--face'));
});

check('a colour frozen to a light value on an element is caught, and a deliberate both-theme colour is not', () => {
  const flagged = run({
    light: page('light', [element(1, 0, { element: 'div#frozen', path: 'html > body > div#frozen', bg: colour(kit.light['--face']) })]),
    dark: page('dark', [element(1, 0, { element: 'div#frozen', path: 'html > body > div#frozen', bg: colour(kit.light['--face']) })]),
  });
  assert.ok(flagged.findings.some((item) => item.code === 'frozen-element'));
  const ink = run({
    light: page('light', [element(1, 0, { element: 'span#phosphor', path: 'html > body > span#phosphor', text: 'LIVE', color: colour(kit.light['--crt-ink']) })]),
    dark: page('dark', [element(1, 0, { element: 'span#phosphor', path: 'html > body > span#phosphor', text: 'LIVE', color: colour(kit.light['--crt-ink']) })]),
  });
  assert.ok(!ink.findings.some((item) => item.code === 'frozen-element'), '--crt-ink is the same in both themes on purpose');
});

check('a frozen element is paired across renderings by its structure, not by its five-level display path', () => {
  // Two columns of identical markup, five levels below the column: both cards report the same display `path`, which
  // is capped and omits the column. The light column's card is frozen to the light face; the dark column's card
  // follows the theme. Pairing the renderings by `path` collapsed the two dark cards onto one key and kept the last,
  // so the frozen card was judged against the changed one and never reported (DESIGN-SYSTEM-ROADMAP.md §4d).
  const sharedPath = 'div.w1 > div.w2 > div.w3 > div.w4 > div.card';
  const FROZEN = 'section:nth-of-type(1) > div.card';
  const CHANGED = 'section:nth-of-type(2) > div.card';
  const column = (index, struct, theme) => element(index, 0, {
    element: 'div.card', cls: ['card'], path: sharedPath, struct, bg: colour(kit[theme]['--win-btn-face']),
  });
  const result = run({
    light: page('light', [column(1, FROZEN, 'light'), column(2, CHANGED, 'dark')]),
    dark: page('dark', [column(1, FROZEN, 'light'), column(2, CHANGED, 'dark')]),
  });
  const frozen = result.findings.filter((item) => item.code === 'frozen-element');
  assert.equal(frozen.length, 1, 'exactly the frozen light-column card is reported, and the changed dark-column card is not');
  assert.ok(frozen[0].measured.includes('rgb(192, 192, 192)'), 'the frozen card is named by its measured value');
});

console.log('');
console.log(`design conformance rules: ${checks} checks passed`);
