// The eight acceptance points of `design/UI_SYSTEM.md` §11 - §10's load order and plan, which the eight do not cover -
// and rule 11, the page's own width against the window it was rendered in, which neither section names but a rendered
// page can be wrong about - as pure functions over a **rendered** page.
//
// Every function here takes the observation of a page that Chrome has already laid out (`collect.mjs` takes it) and
// answers a list of findings. Nothing in this file reads a source file, and nothing greps a stylesheet for a string:
// `DESIGN-SYSTEM-ROADMAP.md` §6 is explicit that a check which greps the source "passes while the screen shows
// nothing", and the foreign consumer that motivated this suite broke seven acceptance points while its own 474 tests
// were green. So a rule looks at computed styles, at geometry, and at the text the operator actually sees.
//
// There is one deliberate exception, and it is confined to rule 4: to answer "does every token this app asks for
// exist", the suite must know *which* tokens the app asks for, and a token that does not exist leaves no trace in the
// computed style except a silent fall back to the initial value (`border: 1px solid var(--nope)` computes to
// `border-width: 0`). The names therefore come from the app's stylesheets, and the **answer** — defined or not — is
// measured on the rendered page. That is why rule 4 takes `references` as an input rather than reading files itself.
//
// Finding shape, and it is the contract with the operator:
//   { rule, code, element, path, measured, kitSays, fix, severity, spellings? }
// `element` names the thing, `measured` is the value that was actually on screen, and `rule`/`kitSays` say which of
// the eight it broke. `fix` is written for an agent that cannot see the screen.

// ---------------------------------------------------------------------------
// The eight of §11, rules 9 and 10 (the load order and the plan of §10), and rule 11 (the page's own width), as data
// ---------------------------------------------------------------------------
export const RULES = [
  {
    id: 1,
    key: 'edges',
    title: 'raised things are light at the top-left and dark at the bottom-right; sunken ones are the reverse; nothing is both',
  },
  {
    id: 2,
    key: 'numbers',
    title: 'every number the operator reads is set in the kit number type and sits in a well',
  },
  {
    id: 3,
    key: 'colours',
    title: 'every colour on screen is one the kit knows (their meanings are §5)',
  },
  {
    id: 4,
    key: 'themes',
    title: 'both themes are real: every token resolves, the kit values change, and nothing is frozen to the light palette',
  },
  {
    id: 5,
    key: 'honesty',
    title: 'no control is greyed out at rest, and a refusal says why',
  },
  {
    id: 6,
    key: 'states',
    title: 'anything a machine decided can say yes, no or unknown, and the three are told apart without colour',
  },
  {
    id: 7,
    key: 'vocabulary',
    title: 'the window owns words come from §8 (not checked by the suite: it needs a reader)',
  },
  {
    id: 8,
    key: 'type',
    title: 'every text size is one of the kit steps, and --meter-scale is the only thing that moves them',
  },
  {
    id: 9,
    key: 'load-order',
    title: 'the kit is linked in one order: the values, then the components, then the plan',
  },
  {
    id: 10,
    key: 'retyped-plan',
    title: 'the plan is the kit\'s, not retyped here: the stack gap and the builder column',
  },
  {
    id: 11,
    key: 'viewport-fit',
    title: 'the page is no wider than the window the suite renders it in: nothing scrolls sideways',
  },
];

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', gold: '#ffd700', maroon: '#800000', silver: '#c0c0c0', gray: '#808080', grey: '#808080',
  aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff', orange: '#ffa500', navy: '#000080',
  teal: '#008080', olive: '#808000', purple: '#800080',
};

function colourOf(r, g, b, a) {
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
  r = clamp(r); g = clamp(g); b = clamp(b);
  const key = a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
  const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return { r, g, b, a, key, hex };
}

/// Parse one colour, or return null. Computed styles give `rgb()`/`rgba()`; stylesheets and custom properties can
/// also give `#hex` and a few names. Alpha is kept because rule 3 deliberately ignores translucent values.
export function parseColour(text) {
  if (typeof text !== 'string') return null;
  let value = text.trim().toLowerCase();
  if (!value || value === 'transparent' || value === 'none' || value === 'currentcolor') return null;
  if (NAMED[value]) value = NAMED[value];
  let match = /^#([0-9a-f]{3,8})$/.exec(value);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return colourOf(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), a);
  }
  match = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value);
  if (match) {
    const channel = (raw) => (raw.endsWith('%') ? (parseFloat(raw) / 100) * 255 : parseFloat(raw));
    let a = 1;
    if (match[4] !== undefined) a = match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    if ([match[1], match[2], match[3], a].some((x) => Number.isNaN(parseFloat(String(x))))) return null;
    return colourOf(channel(match[1]), channel(match[2]), channel(match[3]), a);
  }
  match = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value);
  if (match) {
    const a = match[4] === undefined ? 1 : parseFloat(match[4]);
    return colourOf(parseFloat(match[1]) * 255, parseFloat(match[2]) * 255, parseFloat(match[3]) * 255, a);
  }
  return null;
}

/// Every colour mentioned anywhere in a longer value: a gradient's stops, a box shadow, a font stack (never).
export function colourSpellings(text) {
  if (typeof text !== 'string' || !text) return [];
  const found = [];
  const re = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|color\(srgb[^)]*\)|\b(?:black|white|red|lime|green|blue|yellow|gold|maroon|silver|gray|grey|aqua|cyan|fuchsia|magenta|orange|navy|teal|olive|purple)\b/g;
  for (const raw of text.match(re) || []) {
    const colour = parseColour(raw);
    if (colour) found.push(colour);
  }
  return found;
}

// ---------------------------------------------------------------------------
// The kit, as the copy beside this suite declares it
// ---------------------------------------------------------------------------
function stripComments(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseDeclarations(block) {
  const out = {};
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g;
  let match;
  while ((match = re.exec(block)) !== null) {
    out[match[1]] = match[2].replace(/\s+/g, ' ').trim();
  }
  return out;
}

function parseBlocks(css, selectorPattern) {
  const out = {};
  const re = new RegExp(selectorPattern + '\\s*\\{([\\s\\S]*?)\\}', 'g');
  let match;
  while ((match = re.exec(css)) !== null) Object.assign(out, parseDeclarations(match[1]));
  return out;
}

/// Read `tokens.css` into light/dark tables. `names` is every token the kit declares; `darkNames` is the subset the
/// dark block re-declares — the kit's own statement of "this value changes between the themes".
export function parseKitTokens(cssText) {
  const css = stripComments(cssText);
  const light = parseBlocks(css, ':root');
  const dark = parseBlocks(css, 'body\\.theme-dark');
  return {
    light,
    dark,
    names: new Set([...Object.keys(light), ...Object.keys(dark)]),
    darkNames: new Set(Object.keys(dark)),
  };
}

/// What a token is *for*. Rule 4 uses this to tell a frozen surface from a frozen edge, because a colour that is a
/// legitimate black frame in both themes must not be reported as a frozen black text.
export function tokenRole(name) {
  const n = String(name).replace(/^--/, '');
  if (/^(accent|maroon|amber|green|green-dim|yellow|red|red-bright|gold)$/.test(n)) return 'state';
  if (/(^|-)ink$|(^|-)text$|muted|dim$/.test(n)) return 'ink';
  if (/face|field|gray|grey|(^|-)bg$|^crt$/.test(n)) return 'surface';
  if (/line|shadow|highlight|frame|bevel/.test(n)) return 'line';
  return 'other';
}

/// The palette rule 3 judges against: every colour the kit names, in **both** themes, gradients included. The union
/// is deliberate — a colour's *meaning* (§5) does not change with the theme, so `--accent` stays a known colour in
/// either; using the light value in the dark theme is rule 4's business, not rule 3's.
export function kitPalette(kit) {
  const palette = new Set();
  for (const table of [kit.light, kit.dark]) {
    for (const value of Object.values(table)) {
      for (const colour of colourSpellings(value)) palette.add(colour.key);
    }
  }
  return palette;
}

/// Colour values that are legitimate in *both* themes for a given role, and the values that are the light value of a
/// kit token the dark block changes. A value in the second set that does not change on the page is frozen.
export function frozenCandidates(kit) {
  const candidates = { ink: new Set(), surface: new Set(), line: new Set(), state: new Set() };
  const stable = { ink: new Set(), surface: new Set(), line: new Set(), state: new Set() };
  for (const [name, lightValue] of Object.entries(kit.light)) {
    const role = tokenRole(name);
    if (role === 'other') continue;
    const light = parseColour(lightValue);
    if (!light) continue;
    const darkValue = kit.dark[name];
    const dark = darkValue === undefined ? null : parseColour(darkValue);
    // A token the dark block does not touch is the kit saying "same in both themes".
    if (!dark || dark.key === light.key) stable[role].add(light.key);
    else candidates[role].add(light.key);
  }
  for (const role of Object.keys(candidates)) {
    for (const value of stable[role]) candidates[role].delete(value);
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Small helpers over the observation
// ---------------------------------------------------------------------------
function elementName(element) {
  return element.element || element.tag;
}

function where(element) {
  return element.path && element.path !== element.element ? element.path : '';
}

function finding(rule, code, element, measured, kitSays, fix, extra = {}) {
  return {
    rule,
    code,
    element: elementName(element),
    path: where(element),
    measured,
    kitSays,
    fix,
    severity: 'fail',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Kit values, resolved **where the element lives**
// ---------------------------------------------------------------------------
// A rule compares an element's own computed paint against a kit value. Custom properties inherit, so the honest value
// is the one that resolves on that element: a page that paints two themes at once resolves the kit's two steps
// differently in each column, and reading them once from <body> judged the dark column against the light pair —
// measured on the kit's own specimen as 154 rule-1 findings on bevels that are correct. `collect.mjs` records each
// element's own values, deduplicated, and the element carries its index into that table. A snapshot built without the
// table (the no-browser checks in `scripts/test-design-conformance.mjs`, and anything older) falls back to <body>,
// which is the old behaviour, so the table is an addition and not a new precondition.
const COMPARED_TOKENS = [
  '--line-light', '--win-btn-highlight', '--line-dark', '--win-btn-dark-shadow', '--crt', '--field', '--mono',
  '--meter-scale', '--space-3', '--space-4', '--ops-col-width',
];

/// One kit value as this element resolves it, then <body>, then the kit copy. `element` null asks for the page.
function tokenValue(snapshot, element, kit, name) {
  const names = snapshot.tokenNames || COMPARED_TOKENS;
  const table = snapshot.tokenTable;
  if (table && element && Number.isInteger(element.tokens) && table[element.tokens]) {
    const index = names.indexOf(name);
    const own = index >= 0 ? table[element.tokens][index] : '';
    if (own) return own;
  }
  const body = (snapshot.bodyTokens || {})[name];
  if (body !== undefined && body !== '') return body;
  return kit.light[name];
}

function tokenColour(snapshot, element, kit, name) {
  return parseColour(tokenValue(snapshot, element, kit, name));
}

/// The two edge steps, as **this element** resolves them. `element` null means the page (`<body>`, then the kit). A
/// step the page does not resolve at all is left out rather than guessed, and the caller reports `no-kit-steps`.
function stepValues(snapshot, kit, element = null) {
  const read = (name) => {
    const colour = parseColour(tokenValue(snapshot, element, kit, name));
    return colour ? colour.key : null;
  };
  const light = new Set([read('--line-light'), read('--win-btn-highlight')].filter(Boolean));
  const dark = new Set([read('--line-dark'), read('--win-btn-dark-shadow')].filter(Boolean));
  return { light, dark };
}

function colourPropertyKeys(element) {
  // Every colour this element actually paints, with a plain description of where it is painted.
  const out = [];
  const add = (raw, what) => {
    for (const colour of colourSpellings(raw)) out.push({ colour, what });
  };
  if (element.text) add(element.color, 'its text');
  add(element.bg, 'its background');
  const sides = ['top', 'right', 'bottom', 'left'];
  element.borders.forEach((border, index) => {
    if (border.style && border.style !== 'none' && parseFloat(border.w) > 0) {
      add(border.color, `its ${sides[index]} edge`);
    }
  });
  if (element.outline && element.outline.style && element.outline.style !== 'none' && parseFloat(element.outline.w) > 0) {
    add(element.outline.color, 'its outline');
  }
  add(element.shadow, 'a shadow');
  if (element.backgroundImage && element.backgroundImage !== 'none') add(element.backgroundImage, 'a background image');
  if (element.svgFill) add(element.svgFill, 'an svg fill');
  if (element.svgStroke) add(element.svgStroke, 'an svg stroke');
  return out;
}

// ---------------------------------------------------------------------------
// Rule 1 — the two shapes, and no third
// ---------------------------------------------------------------------------
export function rule1Edges(snapshot, ctx) {
  const findings = [];
  // The page-level pair is only the "can this rule run at all" guard. Every element is judged against the pair that
  // resolves **on it**, because a page may paint two themes at once and each column carries its own pair.
  const pageSteps = stepValues(snapshot, ctx.kit);
  const stats = { elements: snapshot.elements.length, edges: 0, raised: 0, sunken: 0, rounded: 0 };
  findings.stats = stats;
  if (!pageSteps.light.size || !pageSteps.dark.size) {
    return [{ rule: 1, code: 'no-kit-steps', element: 'the page', measured: 'the kit edges are not defined on it', kitSays: 'the kit draws edges with --line-light/--line-dark (or --win-btn-highlight/--win-btn-dark-shadow)', fix: 'link the kit stylesheet before your own', severity: 'not-run' }];
  }
  for (const element of snapshot.elements) {
    const steps = stepValues(snapshot, ctx.kit, element);
    const borders = element.borders;
    const radius = element.radius.find((value) => parseFloat(value) > 0);
    if (radius) {
      stats.rounded += 1;
      findings.push(finding(1, 'rounded', element, `a corner rounded by ${radius}`, 'the kit has square corners: a rounded control belongs to another system', 'set border-radius to 0 and let the edge pair carry the shape', { spellings: [] }));
    }
    const allSolid = borders.every((border) => border.style === 'solid' && parseFloat(border.w) > 0);
    if (!allSolid) continue;
    const topLeft = [borders[0].color, borders[3].color];
    const bottomRight = [borders[2].color, borders[1].color];
    const uniform = topLeft.concat(bottomRight).every((value) => value === borders[0].color);
    if (uniform) continue; // a frame or a divider, not a shape
    stats.edges += 1;
    const topLeftSame = topLeft[0] === topLeft[1];
    const bottomRightSame = bottomRight[0] === bottomRight[1];
    const raised = topLeftSame && bottomRightSame && steps.light.has(topLeft[0]) && steps.dark.has(bottomRight[0]);
    const sunken = topLeftSame && bottomRightSame && steps.dark.has(topLeft[0]) && steps.light.has(bottomRight[0]);
    if (raised) stats.raised += 1;
    if (sunken) stats.sunken += 1;
    const measured =
      `top ${topLeft[0]} · left ${topLeft[1]} · bottom ${bottomRight[0]} · right ${bottomRight[1]}`;
    if (!raised && !sunken) {
      findings.push(finding(
        1,
        'mixed-edges',
        element,
        measured,
        'a raised thing is the kit light step on its top and left and the dark step on its bottom and right; a sunken thing is the same pair the other way round',
        'use --line-light (or --win-btn-highlight) for the top and left and --line-dark (or --win-btn-dark-shadow) for the bottom and right — or swap all four for a well',
        { spellings: [] },
      ));
    }
    if (raised && /\binset\b/.test(String(element.shadow))) {
      findings.push(finding(
        1,
        'two-shapes',
        element,
        `raised edges, and a sunk-in shadow: ${element.shadow}`,
        'one element is one shape: a raised card does not also carry a sunken inner shape',
        'keep the raised edge pair and move the sunken shape into a child well',
        { spellings: [] },
      ));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 2 — numbers are --mono, and they sit in a well
// ---------------------------------------------------------------------------
const NUMBER_PATTERNS = [
  /^[-+]?\d+(?:[.,]\d+)?(?:\s*(?:%|dBu|dB|kHz|Hz|MHz|ms|s|fps|px|B|KB|MB|GB))?$/i,
  /^\d{1,3}:\d{2}(?::\d{2})?(?:[.:]\d{1,3})?$/,
  /^v?\d+\.\d+(?:\.\d+)?$/,
  /^\d{1,3}(?:\.\d{1,3}){3}$/,
];

/// The operator reads this as a value, not as a word.
export function looksNumeric(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  return NUMBER_PATTERNS.some((pattern) => pattern.test(value));
}

function firstFamily(fontFamily) {
  if (typeof fontFamily !== 'string') return '';
  const first = fontFamily.split(',')[0] || '';
  return first.replace(/^["']|["']$/g, '').trim().toLowerCase();
}

/// The four edges as one pair, when the element draws a clean two-step edge; null when it does not (no edges, a
/// uniform frame, or a mix). The step sets decide which way round it is, so a raised panel is never mistaken for a
/// well — which is exactly the bug the first version of this had, measured by the self-test.
function edgePair(element) {
  const borders = element.borders;
  const allSolid = borders.every((border) => border.style === 'solid' && parseFloat(border.w) > 0);
  if (!allSolid) return null;
  const topLeft = [borders[0].color, borders[3].color];
  const bottomRight = [borders[2].color, borders[1].color];
  if (topLeft[0] !== topLeft[1] || bottomRight[0] !== bottomRight[1]) return null;
  if (topLeft[0] === bottomRight[0]) return null;
  return { topLeft: topLeft[0], bottomRight: bottomRight[0] };
}

function isRaisedPair(pair, steps) {
  return Boolean(pair) && steps.light.has(pair.topLeft) && steps.dark.has(pair.bottomRight);
}

function isSunkenPair(pair, steps) {
  return Boolean(pair) && steps.dark.has(pair.topLeft) && steps.light.has(pair.bottomRight);
}

export function rule2Numbers(snapshot, ctx) {
  const findings = [];
  const elements = snapshot.elements;
  const mono = firstFamily(tokenValue(snapshot, null, ctx.kit, '--mono'));
  if (!mono) {
    return [{ rule: 2, code: 'no-mono', element: 'the page', measured: 'the kit number type is not defined on it', kitSays: 'numbers are set in --mono', fix: 'link the kit stylesheet before your own', severity: 'not-run' }];
  }
  let numbers = 0;
  findings.stats = { numbers: 0 };
  for (const element of elements) {
    if (!element.text || !looksNumeric(element.text)) continue;
    if (element.interactive) continue;
    // §8 gives a chip or a badge a count. A count on a raised chip is that word doing its job, not a well violation.
    if (element.cls.some((name) => name === 'chip' || name === 'badge')) continue;
    numbers += 1;
    findings.stats.numbers = numbers;
    // Each value is compared against the number type **it** resolves: a page may set a different one per subtree.
    const ownMono = firstFamily(tokenValue(snapshot, element, ctx.kit, '--mono')) || mono;
    if (firstFamily(element.fontFamily) !== ownMono) {
      findings.push(finding(
        2,
        'not-mono',
        element,
        `“${element.text}”, set in ${element.fontFamily || 'the interface font'}`,
        `everything the operator reads as a value is set in the kit number type --mono (${ownMono})`,
        'set font-family: var(--mono) on this element',
        { spellings: [] },
      ));
    }
    // The nearest surface decides: a well is sunken, or it is the instrument ground; a raised surface ends the search.
    // Each ancestor is judged against **its own** pair, ground and field colour: a page that paints two themes at once
    // resolves those differently per column, and the page-level pair would miss the well in the other column.
    let insideWell = false;
    let reached = null;
    for (let index = element.i; index >= 0; index = elements[index].parent) {
      const ancestor = elements[index];
      if (!ancestor) break;
      const background = parseColour(ancestor.bg);
      const pair = edgePair(ancestor);
      const ancestorSteps = stepValues(snapshot, ctx.kit, ancestor);
      if (isSunkenPair(pair, ancestorSteps)) { insideWell = true; reached = 'a sunken well'; break; }
      const crt = tokenColour(snapshot, ancestor, ctx.kit, '--crt');
      if (crt && background && background.key === crt.key) { insideWell = true; reached = 'the instrument well'; break; }
      const field = tokenColour(snapshot, ancestor, ctx.kit, '--field');
      if (ancestor.isField && field && background && background.key === field.key) { insideWell = true; reached = 'a field'; break; }
      if (index !== element.i && isRaisedPair(pair, ancestorSteps)) { reached = ancestor.element; break; }
    }
    if (!insideWell) {
      findings.push(finding(
        2,
        'not-in-well',
        element,
        `“${element.text}” on ${reached || 'an unsunken surface'}`,
        'a value the instrument reports sits in a well: a sunken area with the kit edge pair reversed',
        'put this value inside an element whose edges are the reverse pair (or whose background is --crt), or use a class the kit names well/field',
        { spellings: [] },
      ));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 3 — colour has meaning, and the palette is the kit's
// ---------------------------------------------------------------------------
export function rule3Colours(snapshot, ctx) {
  const findings = [];
  const known = ctx.palette;
  const stats = { elements: 0, colours: 0 };
  findings.stats = stats;
  for (const element of snapshot.elements) {
    const seen = new Set();
    let painted = false;
    for (const { colour, what } of colourPropertyKeys(element)) {
      // Translucent values are compositing, not palette. The kit names no translucent colour, and a shadow drawn in
      // rgba(0,0,0,.4) is depth, not a meaning; reporting it would make this rule fail for the wrong reason.
      if (colour.a < 1) continue;
      stats.colours += 1;
      if (!painted) { painted = true; stats.elements += 1; }
      if (known.has(colour.key)) continue;
      if (seen.has(colour.key + what)) continue;
      seen.add(colour.key + what);
      findings.push(finding(
        3,
        'unknown-colour',
        element,
        `${what} is ${colour.key} (${colour.hex})`,
        'every colour on screen is one the kit knows; a colour is chosen for what it says, and only the kit says what it means',
        'use a kit token, or declare this deviation with its reason in the app allowance file',
        { spellings: [colour.key, colour.hex] },
      ));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 4 — both themes, nothing frozen
// ---------------------------------------------------------------------------
export function rule4Themes(ctx) {
  const findings = [];
  const { light, dark, kit } = ctx;
  if (!light || !dark) {
    return [{
      rule: 4, code: 'needs-both-themes', element: 'the run', measured: 'only one theme was rendered',
      kitSays: 'this rule compares the light and dark renderings of the same page',
      fix: 'run without --theme (or with --theme both) so both themes are looked at', severity: 'not-run',
    }];
  }
  const lightTokens = light.bodyTokens || {};
  const darkTokens = dark.bodyTokens || {};

  // 4a. The kit must be linked at all.
  const missing = [...kit.names].filter((name) => !(name in lightTokens) && !(name in darkTokens));
  if (missing.length === kit.names.size && missing.length > 0) {
    findings.push(finding(
      4, 'kit-not-linked', { element: 'the page', path: '' },
      `${kit.names.size} kit tokens are not defined on it (--face and everything beside it)`,
      'the kit is a stylesheet the page links before its own: <link rel="stylesheet" href="design/tokens.css">',
      'link the kit, then re-run the suite',
      { spellings: [] },
    ));
  } else if (missing.length) {
    findings.push(finding(
      4, 'kit-tokens-missing', { element: 'the page', path: '' },
      `${missing.length} kit token(s) are not defined on it: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}`,
      'a page that links the kit carries every token the kit declares',
      'link the kit copy the app declared, and check nothing strips tokens out of it',
      { spellings: [] },
    ));
  }

  // 4b. Every token the app asks for exists here. The names come from the app's stylesheets (see the header of this
  // file); the answer is measured on this rendered page, in both themes.
  const defined = new Set([...Object.keys(lightTokens), ...Object.keys(darkTokens), ...ctx.declaredTokens]);
  for (const reference of ctx.references || []) {
    if (reference.hasFallback) continue; // var(--x, something) is a deliberate fallback
    if (defined.has(reference.name)) continue;
    const subject = reference.source === 'kit'
      ? { element: 'the kit stylesheet', path: '' }
      : { element: reference.element || 'the app stylesheet', path: reference.path || '' };
    findings.push(finding(
      4, 'unknown-token', subject,
      `it asks for ${reference.name}, which nothing on this page defines`,
      'every token an app asks for resolves; a token that does not exist falls back to the property initial value, silently',
      reference.source === 'kit'
        ? 'this one is inside the kit copy itself: re-copy the kit'
        : 'use a token the kit defines, or add the value to the kit first (UI_SYSTEM.md §10)',
      { spellings: [reference.name], kitSourced: reference.source === 'kit' },
    ));
  }

  // 4c. The kit's own theme-varying tokens must actually change on this page. A token that stays at its light value
  // is the §3 trap ("never alias a token to another token inside :root"): the alias was resolved before dark could
  // reach it. This is caught on the computed value, not by reading the alias.
  const frozenTokens = [];
  for (const name of kit.darkNames) {
    if (!parseColour(kit.light[name])) continue; // only colour tokens can be judged by value
    const lightValue = parseColour(lightTokens[name]);
    const darkValue = parseColour(darkTokens[name]);
    if (!lightValue || !darkValue) continue;
    if (lightValue.key === darkValue.key) frozenTokens.push(`${name} stays ${lightValue.key}`);
  }
  if (frozenTokens.length) {
    findings.push(finding(
      4, 'frozen-kit-token', { element: 'the page', path: '' },
      frozenTokens.join(' · '),
      'the kit changes these values between the themes; a token that does not change is frozen to the light palette (the §3 trap)',
      'do not alias a kit token to another kit token inside :root: alias it in the window, or re-declare the alias in body.theme-dark as well',
      { spellings: [] },
    ));
  }

  // 4d. The page must not redefine a kit token away from the value the kit copy declares. This is §10's "take the
  // file and the document; do not take a copy of a palette", measured on the computed value.
  for (const name of kit.names) {
    const kitLight = parseColour(kit.light[name]);
    if (!kitLight) continue;
    for (const [theme, tokens, expectedRaw] of [['light', lightTokens, kit.light[name]], ['dark', darkTokens, kit.dark[name]]]) {
      if (expectedRaw === undefined) continue;
      const expected = parseColour(expectedRaw);
      const actual = parseColour(tokens[name]);
      if (!expected || !actual || actual.key === expected.key) continue;
      findings.push(finding(
        4, 'redefined-token', { element: `the ${theme} rendering`, path: '' },
        `${name} is ${actual.key}, and this kit copy declares ${expected.key}`,
        'the kit has one home for a value; an app takes the file and the document, it does not take a copy of a palette',
        'delete the local re-declaration, or add the value to the kit first (UI_SYSTEM.md §10)',
        { spellings: [name, actual.key, actual.hex, expected.key, expected.hex] },
      ));
    }
  }

  // 4e. A colour frozen to a light value **on an element**: the value is the same in both themes and equals the light
  // value of a kit token the dark theme changes. The role of the token (ink, surface, edge) decides which property is
  // judged, so a black frame that is legitimately black in both themes is not mistaken for frozen black text.
  const candidates = frozenCandidates(kit);
  const channels = {
    ink: (element) => (element.text ? [{ value: element.color, what: 'its text' }] : []),
    surface: (element) => (element.bg && parseColour(element.bg) && parseColour(element.bg).a >= 1 ? [{ value: element.bg, what: 'its background' }] : []),
    line: (element) => element.borders
      .map((border, index) => ({ border, what: ['top', 'right', 'bottom', 'left'][index] }))
      .filter(({ border }) => border.style && border.style !== 'none' && parseFloat(border.w) > 0)
      .map(({ border, what }) => ({ value: border.color, what: `its ${what} edge` })),
  };
  // The light and dark renderings are paired on the element's **full structural key**, collected by `collect.mjs`
  // (every ancestor's tag plus `nth-of-type`, from <html> down, with no cap). `element.path` is a display name for a
  // reader: capped at five levels and leaving the column out, so two columns of identical markup share it. Pairing by
  // it collapsed those two onto one key and kept the last, so a frozen element in one column was judged against a
  // changed element of the same path in the other and never reported (DESIGN-SYSTEM-ROADMAP.md §4d, proved by
  // `fixtures/bad-two-column-frozen.html`). An element without a structural key cannot be paired honestly at all, so
  // it is left out rather than paired on an ambiguous name.
  const byStruct = new Map();
  for (const element of dark.elements) {
    if (element.struct) byStruct.set(element.struct, element);
  }
  const frozenByElement = new Map();
  for (const element of light.elements) {
    if (!element.struct) continue;
    const other = byStruct.get(element.struct);
    if (!other) continue;
    for (const role of Object.keys(channels)) {
      if (!candidates[role].size) continue;
      const lightValues = channels[role](element);
      const darkValues = channels[role](other);
      for (let index = 0; index < lightValues.length; index += 1) {
        const before = parseColour(lightValues[index].value);
        const after = darkValues[index] ? parseColour(darkValues[index].value) : null;
        if (!before || !after) continue;
        if (before.key !== after.key) continue;
        if (!candidates[role].has(before.key)) continue;
        const key = element.struct;
        if (!frozenByElement.has(key)) frozenByElement.set(key, { element, values: [] });
        const frozen = frozenByElement.get(key);
        if (!frozen.values.includes(`${lightValues[index].what} ${before.key}`)) {
          frozen.values.push(`${lightValues[index].what} ${before.key}`);
        }
      }
    }
  }
  // If an app token is itself frozen, name it: that is the alias the trap is about, and naming it saves a search.
  const frozenAppTokens = [];
  for (const [name, lightRaw] of Object.entries(lightTokens)) {
    if (kit.names.has(name)) continue;
    const lightValue = parseColour(lightRaw);
    const darkValue = parseColour(darkTokens[name]);
    if (!lightValue || !darkValue || lightValue.key !== darkValue.key) continue;
    if (Object.values(candidates).some((set) => set.has(lightValue.key))) frozenAppTokens.push(name);
  }
  findings.stats = {
    tokens: kit.names.size,
    references: (ctx.references || []).length,
    frozenTokens: frozenTokens.length,
    frozenElements: frozenByElement.size,
  };
  for (const { element, values } of frozenByElement.values()) {
    findings.push(finding(
      4, 'frozen-element', element,
      `${values.join(' · ')} — the same in both themes`,
      'this value is the light value of a kit token the dark theme changes, so the element was frozen before dark could reach it',
      frozenAppTokens.length
        ? `the frozen token looks like ${frozenAppTokens.slice(0, 4).join(', ')}: alias it inside the window, not inside :root, or re-declare it in body.theme-dark`
        : 'let the value come from the kit token in the themed subtree instead of a light value fixed at :root',
      { spellings: [] },
    ));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 5 — a control works, or it says why not
// ---------------------------------------------------------------------------
const GENERIC_REFUSALS = new Set(['error', 'failed', 'failure', 'refused', 'denied', 'n/a', 'na', 'unknown', '-', '!', '?']);

export function rule5Honesty(snapshot) {
  const findings = [];
  const stats = { controls: 0, refusals: 0 };
  findings.stats = stats;
  for (const element of snapshot.elements) {
    if (element.interactive) stats.controls += 1;
    if (element.refusal) stats.refusals += 1;
    if (element.disabled) {
      const says = (element.disabledWhy || element.descText || '').replace(/\s+/g, ' ').trim();
      findings.push(finding(
        5, 'disabled-control', element,
        says ? `it is greyed out and says “${says.slice(0, 120)}”` : 'it is greyed out and says nothing at all',
        'a control that cannot do its job is absent, not greyed: a disabled button is a promise, and a tooltip that promises a future feature is a promise with a date on it',
        'remove it, or make it work; if this app must keep it, declare the deviation with its reason',
        { spellings: [] },
      ));
    }
    if (element.refusal) {
      const text = (element.descText || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        findings.push(finding(
          5, 'silent-refusal', element,
          'the refusal surface is empty',
          'nothing fails silently, and a refusal names its cause in the operator own words',
          'render the machine own reason inside this element',
          { spellings: [] },
        ));
      } else if (GENERIC_REFUSALS.has(text.toLowerCase().replace(/[.!]+$/, ''))) {
        findings.push(finding(
          5, 'generic-refusal', element,
          `the refusal says only “${text}”`,
          'a refusal names its cause: "sent", "confirmed", "unconfirmed" and "unknown" are different sentences and keep different words',
          'say what was refused and why, in the operator own words',
          { spellings: [] },
        ));
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 6 — three states, not two
// ---------------------------------------------------------------------------
const STATES = ['yes', 'no', 'unknown'];

export function rule6States(snapshot) {
  const findings = [];
  const declared = snapshot.elements.filter((element) => element.dataState);
  if (!declared.length) {
    return [{
      rule: 6, code: 'no-declared-state', element: 'the page',
      measured: 'no element declares data-state, so the suite cannot see a machine decision on it',
      kitSays: 'anything a machine decided carries data-state="yes|no|unknown" and data-state-set with the three words it can take',
      fix: 'mark each machine-decided element with data-state and its feature with data-state-set="yes no unknown"; the suite then checks it',
      severity: 'not-checked',
    }];
  }
  const present = new Map();
  findings.stats = { states: declared.length };
  for (const element of declared) {
    if (!STATES.includes(element.dataState)) {
      findings.push(finding(
        6, 'state-word', element,
        `data-state="${element.dataState}"`,
        `a machine decision can say ${STATES.join(', ')} — those are the words`,
        'use one of yes, no, unknown',
        { spellings: [] },
      ));
    }
    const set = String(element.dataStateSet || '').trim().split(/\s+/).filter(Boolean);
    if (!set.length) {
      findings.push(finding(
        6, 'no-state-set', element,
        'it declares a state but not the states it can take',
        'a machine decision needs three states, and the page declares them with data-state-set="yes no unknown"',
        'add data-state-set="yes no unknown" to the element or to a feature around it',
        { spellings: [] },
      ));
    } else if (!STATES.every((state) => set.includes(state))) {
      findings.push(finding(
        6, 'two-states', element,
        `the states it can take are declared as “${set.join(' ')}”`,
        'anything a machine decided has three states: yes, no, and nobody can tell',
        'add unknown to data-state-set, and render it when the judgement cannot be made',
        { spellings: [] },
      ));
    }
    if (STATES.includes(element.dataState)) {
      if (!present.has(element.dataState)) present.set(element.dataState, []);
      present.get(element.dataState).push(element);
    }
  }
  const statesOnPage = [...present.keys()];
  for (let a = 0; a < statesOnPage.length; a += 1) {
    for (let b = a + 1; b < statesOnPage.length; b += 1) {
      const left = present.get(statesOnPage[a])[0];
      const right = present.get(statesOnPage[b])[0];
      const signature = (element) => JSON.stringify(element.shape || {});
      if (signature(left) === signature(right)) {
        findings.push(finding(
          6, 'colour-only-state', left,
          `“${statesOnPage[a]}” and “${statesOnPage[b]}” are drawn identically except for colour`,
          'the three states are told apart without colour: a word, or a shape',
          'give each state its own word or its own shape, so an operator who cannot see the colour still reads it',
          { spellings: [] },
        ));
      }
    }
  }
  const declaredSet = new Set();
  for (const element of declared) String(element.dataStateSet || '').trim().split(/\s+/).forEach((s) => s && declaredSet.add(s));
  const absent = STATES.filter((state) => !statesOnPage.includes(state));
  if (absent.length && declaredSet.size) {
    findings.push({
      rule: 6, code: 'state-not-on-page', element: 'the page', path: '',
      measured: `${absent.join(', ')} declared but not rendered on this page`,
      kitSays: 'the suite checks the vocabulary and the word-or-shape difference; whether the app can reach unknown is a reading matter',
      fix: 'nothing to fix unless a declared state can never be reached',
      severity: 'note', spellings: [],
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 7 — the vocabulary
// ---------------------------------------------------------------------------
export const KIT_WORDS = ['window', 'panel', 'card', 'row', 'well', 'field', 'chip', 'badge', 'band', 'rail'];

/// Reported, never passed. §8 is about what a word *means*: an element named "strip" and an element named "band" can
/// be the same thing on screen, and no amount of computed style tells the suite which one the operator was taught.
/// The suite therefore inventories the page own words and says, loudly, that it did not judge them.
export function rule7Vocabulary(snapshot) {
  const classes = new Set();
  for (const element of snapshot.elements) for (const name of element.cls) classes.add(name);
  const labels = new Set();
  for (const element of snapshot.elements) {
    if (!element.interactive) continue;
    const label = (element.descText || element.text || '').replace(/\s+/g, ' ').trim();
    if (label) labels.add(label.slice(0, 40));
  }
  const sample = [...classes].slice(0, 10).join(', ');
  const items = [{
    rule: 7, code: 'vocabulary-not-checked', element: 'the page', path: '',
    measured: `${classes.size} class name(s) and ${labels.size} control label(s) on screen${sample ? `, e.g. ${sample}` : ''}`,
    kitSays: `the kit own furniture words are: ${KIT_WORDS.join(', ')}`,
    fix: 'a reader compares the words above with §8; the suite does not judge meaning, so it neither passes nor fails this rule',
    severity: 'not-checked', spellings: [],
    inventory: { classes: [...classes].slice(0, 60), labels: [...labels].slice(0, 60) },
  }];
  items.stats = { classes: classes.size, labels: labels.size };
  return items;
}

// ---------------------------------------------------------------------------
// Rule 8 — the type scale, and the one control that moves it
// ---------------------------------------------------------------------------
// §11 point 8, and the answer to a measured blind spot (`DESIGN-SYSTEM-ROADMAP.md` §4j). A consumer of this kit
// replaced its whole type scale with a ramp of its own and **reassigned the kit's names** to point at it
// (`--font-sm: var(--t-sm)`), so every text in its interface changed size, and the suite reported **0 failures in
// both themes**. Verified here before this rule existed: `grep -c 'font-size' rules.mjs` was 0, and the consumer's
// own fixture ran `CONFORMANCE OK · 0 failures` against rules 1-7.
//
// Two checks, and both are needed, because they see different things:
//
//   1. Every visible text's computed `font-size` is one of the kit's **steps**, at the `--meter-scale` **that
//      text resolves** — computed from the kit's own `clamp()`s in `design/tokens.css`, never from the page's
//      `--font-*` (a page that reassigned the names would otherwise be judged against its own ramp and pass).
//   2. `--meter-scale` is the **only thing that moves them**. The suite renders the page twice more with the knob
//      forced to 1 and to 1.5 (`collect.mjs`: an inline declaration on `<html>` and `<body>`, so the kit's own
//      `:root { --meter-scale: 1 }` is outranked), pairs the two readings by each element's full structural key, and
//      requires the size at 1 to be one of the kit's **minima** and the size at 1.5 to be the **same step's** value
//      there, in the kit's own proportion. A single-size photograph cannot see a renamed ramp; a proportion can —
//      and this is the check that catches the case where a page writes the right pixels as literals.
//
// Both readings are needed for either to count: a run without the second one reports rule 8 as **NOT RUN** rather
// than judging a single photograph, which is the failure this rule exists to stop. A page that genuinely needs a
// step the kit lacks **declares it with a reason**, like every other deviation.
const PX_EPSILON = 0.02; // measured: Chrome 155 reports the kit's clamp() arithmetic exactly (8.6px, 12.125px, …)

function px(value) {
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function formatPx(value) {
  return `${Number(value.toFixed(3))}px`;
}

function closePx(a, b) {
  return a !== null && b !== null && Math.abs(a - b) <= PX_EPSILON;
}

/// One `--font-*` step as the kit declares it: `clamp(<floor>, calc(<floor> + (var(<knob>) - 1) * <growth>), <cap>)`,
/// written by `scripts/generate-design-tokens.mjs` (its `FONT_STEP`). The floor appears twice and the two spellings
/// must agree; a shape this does not recognise is returned as an error and reported, never guessed at, because a
/// silently unparsed scale would make this rule pass on every page.
const TYPE_STEP_RE = /^clamp\(\s*(-?[\d.]+)px\s*,\s*calc\(\s*(-?[\d.]+)px\s*\+\s*\(\s*var\(\s*(--[A-Za-z0-9_-]+)\s*\)\s*-\s*1\s*\)\s*\*\s*(-?[\d.]+)px\s*\)\s*,\s*(-?[\d.]+)px\s*\)$/;

/// The kit's type steps for one theme: `{ steps: [{ name, step, floor, growth, cap }], knob }`, or `{ error }`.
/// The type scale is declared once in `:root` and the dark block re-declares no `--font-*`, but a future kit may, so
/// the theme's own table wins where it has one.
export function parseTypeScale(kit, theme = 'light') {
  const table = theme === 'dark' ? { ...kit.light, ...kit.dark } : kit.light;
  const steps = [];
  let knob = null;
  for (const [name, value] of Object.entries(table)) {
    if (!name.startsWith('--font-')) continue;
    const match = TYPE_STEP_RE.exec(String(value).trim());
    if (!match) return { error: `${name} is ${JSON.stringify(value)}, not the kit's clamp() shape` };
    if (match[1] !== match[2]) {
      return { error: `${name} names two different floors in one clamp(): ${match[1]}px and ${match[2]}px` };
    }
    knob = match[3];
    steps.push({
      name,
      step: name.slice('--font-'.length),
      floor: Number(match[1]),
      growth: Number(match[4]),
      cap: Number(match[5]),
    });
  }
  if (!steps.length) return { error: `the ${theme} table declares no --font-* step` };
  return { steps, knob: knob || '--meter-scale' };
}

/// The kit's own arithmetic for one step at one position of the knob. The clamp() is the kit's; this only evaluates
/// it, so the expected values are the kit's and not a second opinion written here.
export function typeStepValue(step, scale) {
  return Math.min(step.cap, Math.max(step.floor, step.floor + (scale - 1) * step.growth));
}

/// The knob as **this element** resolves it. A page may raise it per subtree (the kit's own meters window scopes its
/// own), so the expected size of a text is a function of the knob where that text lives.
function elementScale(snapshot, element, kit) {
  const value = px(tokenValue(snapshot, element, kit, '--meter-scale'));
  return value === null || value <= 0 ? 1 : value;
}

export function rule8Type(snapshot, ctx) {
  const theme = ctx.theme === 'dark' ? 'dark' : 'light';
  const scale = parseTypeScale(ctx.kit, theme);
  if (scale.error) {
    return [{
      rule: 8, code: 'no-kit-type', element: 'the page', path: '',
      measured: `the kit's own type scale could not be read: ${scale.error}`,
      kitSays: 'every --font-* step is the kit generator\'s clamp() of --meter-scale, and those are the scale this rule judges',
      fix: 're-copy the kit: design/tokens.css is generated, and its --font-* steps are the scale',
      severity: 'not-run', spellings: [],
    }];
  }

  // The rule is the two checks together. A snapshot taken without the second reading — a caller that built its own
  // observation, or a run whose browser died between the renderings — says so rather than judging one photograph:
  // a single size on screen is exactly what could not see the renamed ramp this rule was written for.
  const control = snapshot.typeControl;
  if (!control || !control.atOne || !control.atOnePointFive) {
    return [{
      rule: 8, code: 'type-not-rendered', element: 'the run', path: '',
      measured: 'the page was not rendered a second time with --meter-scale moved',
      kitSays: 'at --meter-scale 1 the kit\'s steps give their minima and at 1.5 they rise in the kit\'s proportion: a single-size photograph cannot see a renamed ramp, and a proportion can',
      fix: 'run the suite with a browser — run.mjs takes the second reading itself — or declare why this page cannot be rendered at another scale',
      severity: 'not-run', spellings: [],
    }];
  }

  const findings = [];
  const stats = { steps: scale.steps.length, texts: 0, sized: 0, invented: 0, moved: 0, notMoved: 0 };
  findings.stats = stats;

  // --- Check 1: every visible text is one of the kit's steps, where that text lives ------------------------------
  for (const element of snapshot.elements || []) {
    if (!element.text) continue;
    stats.texts += 1;
    const size = px(element.fontSize);
    if (size === null) continue;
    stats.sized += 1;
    const own = elementScale(snapshot, element, ctx.kit);
    const expected = scale.steps.map((step) => typeStepValue(step, own));
    if (expected.some((value) => closePx(size, value))) continue;
    stats.invented += 1;
    // The count and the names come from the kit's own table, never from a number written here: the scale has nine
    // steps since the instrument steps landed (`DESIGN-SYSTEM-ROADMAP.md` §4l, D-TYPE-4), and a message that still said
    // "five" would be a report that lies about what it measured.
    const names = scale.steps.map((step) => step.name).join(', ');
    findings.push(finding(
      8,
      'invented-size',
      element,
      `“${element.text}” is set at ${formatPx(size)}, and at --meter-scale ${own} the kit's ${scale.steps.length} steps are ${expected.map(formatPx).join(', ')}`,
      `a text size comes from the kit's ${scale.steps.length} steps, every one of them a clamp() of the single knob --meter-scale; a size that is none of them is a step invented on this screen`,
      `set this text with one of ${names}, or raise --meter-scale, or declare this deviation with its reason`,
      { spellings: [formatPx(size)] },
    ));
  }

  // --- Check 2: the knob is the only thing that moves them -------------------------------------------------------
  const atOne = control.atOne;
  const atOnePointFive = control.atOnePointFive;
  const halfByStruct = new Map();
  for (const element of atOnePointFive.elements || []) {
    if (element.struct && element.text) halfByStruct.set(element.struct, element);
  }
  const minima = scale.steps.map((step) => typeStepValue(step, 1));
  let ownScale = 0;
  for (const element of atOne.elements || []) {
    if (!element.text || !element.struct) continue;
    const other = halfByStruct.get(element.struct);
    if (!other) continue; // re-flowed away between the two readings: nothing was measured, so nothing is claimed
    // An element that declares its own knob did not follow the one this reading forced. Its size is still judged by
    // check 1, against the scale it declares; it is counted here so the report can say it was not moved.
    if (!closePx(elementScale(atOne, element, ctx.kit), 1) || !closePx(elementScale(atOnePointFive, other, ctx.kit), 1.5)) {
      ownScale += 1;
      continue;
    }
    const sizeOne = px(element.fontSize);
    const sizeHalf = px(other.fontSize);
    if (sizeOne === null || sizeHalf === null) continue;
    stats.moved += 1;
    const matches = scale.steps.filter((step) => closePx(sizeOne, typeStepValue(step, 1)));
    if (matches.length !== 1) {
      stats.notMoved += 1;
      findings.push(finding(
        8,
        'step-not-minimum',
        element,
        `at --meter-scale 1 it measures ${formatPx(sizeOne)}, and the kit's ${scale.steps.length} steps give their minima ${minima.map(formatPx).join(', ')}`,
        'at the bottom of the knob the kit\'s steps are their minima; a size that is none of them does not come from the knob',
        'set this text with a var(--font-*) step, so --meter-scale is the only thing that moves it',
        { spellings: [formatPx(sizeOne)] },
      ));
      continue;
    }
    const step = matches[0];
    const expectedHalf = typeStepValue(step, 1.5);
    if (closePx(sizeHalf, expectedHalf)) continue;
    stats.notMoved += 1;
    findings.push(finding(
      8,
      'step-not-proportional',
      element,
      `from ${formatPx(sizeOne)} at --meter-scale 1 to ${formatPx(sizeHalf)} at 1.5; the kit's ${step.name} goes from ${formatPx(typeStepValue(step, 1))} to ${formatPx(expectedHalf)}`,
      '--meter-scale must be the only thing that moves a text size: at 1.5 the kit\'s steps rise in the kit\'s own proportion',
      `use ${step.name}, or the step this text is meant to be: a size written as a literal does not follow the knob`,
      { spellings: [formatPx(sizeOne), formatPx(sizeHalf)] },
    ));
  }
  if (ownScale) {
    findings.push({
      rule: 8, code: 'own-scale', element: 'the page', path: '',
      measured: `${ownScale} text(s) declare their own --meter-scale, so forcing the page's knob did not move them`,
      kitSays: 'the page may raise the knob on a subtree, but the suite can only move the one it can reach: those texts were judged by the first check, against the scale they declare',
      fix: 'nothing to fix — said out loud so the second check does not look as if it covered them',
      severity: 'note', spellings: [],
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 9 — the kit's sheets, in the kit's own order
// ---------------------------------------------------------------------------
// §10 makes the load order a contract and it is four lines: the values, the components, the plan, then the page's own
// sheet (`design/UI_SYSTEM.md` §10; `CANON_PLAN.md` P5). The eight points of §11 do not cover it, and a page that
// links the kit in the wrong order passes all eight while the wrong sheet draws over the right one.
//
// The order is read from the **rendered** document rather than inferred from the pixels, because the pixels are the
// wrong instrument for it. A custom property is substituted at computed-value time, after every sheet has cascaded,
// so `components.css` linked before `tokens.css` paints identically until two sheets claim the same property on the
// same element - and then the sheet that loses is silent. The defect is the order itself: a page can show it exactly
// as it should and still be wrong, so the honest measurement is the order the laid-out document adopted, which is
// what `collect.mjs` records (`linkHrefs`, every `<link rel="stylesheet">` in document order).
//
// What this does not see, said out loud rather than passed: a sheet pulled in with an `@import` inside a `<style>`,
// and a `<link>` that is `disabled` or an alternate stylesheet, are not in that list and are not judged. A page
// linking one sheet, or none, is trivially in order and is left to rule 4, which still requires its tokens to resolve.
const KIT_SHEET_ORDER = [
  { rank: 0, name: 'the values sheet', files: ['tokens.css', 'design-tokens.css'] },
  { rank: 1, name: 'the components sheet', files: ['components.css'] },
  { rank: 2, name: 'the plan sheet', files: ['layout.css'] },
];

/// The kit sheet an href names, by its file name, or null when it is not one of the kit's three. Query strings are
/// dropped (`tokens.css?v=1791470061` is the same sheet) and the comparison is case-insensitive.
function kitSheetOf(href) {
  let base = '';
  try {
    base = decodeURIComponent(new URL(href).pathname.split('/').pop() || '');
  } catch (_) {
    base = String(href).split(/[?#]/)[0].split('/').pop() || '';
  }
  base = base.toLowerCase();
  for (const sheet of KIT_SHEET_ORDER) if (sheet.files.includes(base)) return sheet;
  return null;
}

function sheetFile(href) {
  try {
    return decodeURIComponent(new URL(href).pathname.split('/').pop() || '') || String(href);
  } catch (_) {
    return String(href).split(/[?#]/)[0].split('/').pop() || String(href);
  }
}

function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

export function rule9LoadOrder(snapshot) {
  const findings = [];
  const hrefs = Array.isArray(snapshot && snapshot.linkHrefs) ? snapshot.linkHrefs : [];
  const linked = hrefs
    .map((href, index) => ({ href, position: index + 1, sheet: kitSheetOf(href) }))
    .filter((entry) => entry.sheet);
  findings.stats = { stylesheets: hrefs.length, 'kit sheets': linked.length };
  const order = KIT_SHEET_ORDER.map((sheet) => sheet.files[0]).join(', then ');
  let earlier = null;
  for (const entry of linked) {
    if (earlier && entry.sheet.rank < earlier.sheet.rank) {
      // The sheet that got ahead of this one is the one this one should have preceded. Naming both, with the
      // position each was linked at, is "which was expected, which was found, and where".
      findings.push(finding(
        9,
        'load-order',
        { element: `link[href="${sheetFile(entry.href)}"]`, path: `head, stylesheet link ${entry.position}` },
        `${entry.sheet.name} (${sheetFile(entry.href)}) is linked ${ordinal(entry.position)}; ` +
          `${earlier.sheet.name} (${sheetFile(earlier.href)}) is linked ${ordinal(earlier.position)}; ` +
          `the kit order is ${order}`,
        'the kit is linked in one order - the values, then the components, then the plan - because a sheet linked out ' +
          'of that order draws over the one before it, and nothing on screen says so',
        `move the <link> for ${sheetFile(entry.href)} above the <link> for ${sheetFile(earlier.href)}`,
      ));
      // One finding names the first breach, which is the one to fix; the run after that names the next if there is one.
      break;
    }
    if (!earlier || entry.sheet.rank > earlier.sheet.rank) earlier = entry;
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 10 — the plan is the kit's, not retyped here
// ---------------------------------------------------------------------------
// The kit's plan answers questions a consumer is tempted to answer again by hand: the gap a stack breathes with, and
// the floor a builder column may shrink to. The values below are the kit's own resolved values, written out here so the
// check needs no second file. A class that carries one of them paints a second answer to a question the kit has already
// answered, and nothing on screen says which of the two won.
//
// The grid tracks are **deliberately not compared here**, and this is not a gap to be "fixed" back into a string
// comparison. MEASURED, 2026-10-08: `getComputedStyle().gridTemplateColumns` is the **used** track list once the grid
// has been laid out, never the declared `minmax()` text. `design/layout.html`, which composes the kit's plan and is
// correct, measures `740px`; `fixtures/bad-retyped-plan.html`, which retyped the tracks, measures `520px 8px 300px`.
// Neither is the kit's declared `minmax(480px, 1fr) 6px minmax(260px, 420px)`, so an entry comparing that string cannot
// match on **any** page at any width: it reds every page composing the plan and separates none of them from a page that
// retyped it - a guard with no discriminating power. What actually separates the fixture from the green pages is `gap`
// (10px against 8px) and `min-width` (280px against 0px), and those two are computed as lengths and are kept below. A
// page's tracks are checked by the sheet it links (rule 9) and by rule 4 - that every token it asks for resolves - not
// here, because the tracks themselves are not measurable as declared text on a rendered page.
const PLAN_CLASSES = [
  { cls: 'stack', property: 'gap', declares: 'gap', value: '8px' },
  { cls: 'builder-column', property: 'minWidth', declares: 'min-width', value: '0px' },
];

function rule10RetypedPlan(snapshot) {
  const findings = [];
  const elements = Array.isArray(snapshot && snapshot.elements) ? snapshot.elements : [];
  const stats = { elements: elements.length, checked: 0, retyped: 0 };
  findings.stats = stats;
  for (const element of elements) {
    const cls = Array.isArray(element.cls) ? element.cls : [];
    for (const plan of PLAN_CLASSES) {
      if (!cls.includes(plan.cls)) continue;
      stats.checked += 1;
      const measured = String(element[plan.property] == null ? '' : element[plan.property]).trim();
      if (measured === plan.value) continue;
      stats.retyped += 1;
      findings.push(finding(
        10,
        'retyped-plan',
        element,
        `.${plan.cls} resolves ${plan.declares}: ${measured || 'nothing'}`,
        `the kit declares .${plan.cls} ${plan.declares}: ${plan.value}`,
        "remove the rule that re-declares it, or link the kit's sheet and delete the copy",
      ));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 11 — the page fits the window it was rendered in
// ---------------------------------------------------------------------------
// The eight points of §11, and rules 9 and 10, all read *inside* the page: a computed style, a bevel, a colour, the
// geometry of a class the kit names, the order of the sheets. Not one of them can see the page's own size, and a page
// wider than its window is wrong in a way no computed style records: every element on it can carry a kit value and the
// window still scrolls sideways, carrying whatever stands off its right edge out of the operator's reach.
//
// The measurement is the observation's `overflow` field (`collect.mjs`, "The page's own width against the window it
// was laid out in"): `scrollWidth` against `window.innerWidth`, for the document and for `<body>`, because a page can
// scroll on either. This rule takes the widest of the boxes and fails when it is past the viewport.
//
// WHAT THIS CANNOT SEE, SAID OUT LOUD, BECAUSE IT IS HALF THIS RULE'S CONTRACT. The suite renders each page at ONE
// width - **its own declared viewport, `VIEWPORT` in `collect.mjs` (756 x 469), forced with
// `Emulation.setDeviceMetricsOverride` before the page is loaded rather than inherited from the browser it found** -
// so this rule answers "does this page fit at the width the suite declares" and nothing more, and the width it judges
// is a declared number instead of an accident. It was 756 x 469 by accident before the declaration, which is why every
// count in this tree already assumes it and none of them moved when the declaration was added. **The declaration
// changes nothing about this rule's blind spot**: a page too wide only in a band of widths the suite never visits is
// still invisible to it, and that band is exactly what motivated the rule: `desktop/ui/index.html` overflows by 28px
// at 1181 and 9px at 1200, because its `div.master-stats` + `#open-help-btn` need 1209px while its header's reset
// starts at 1180 (`design/CANON_PLAN.md`, "The judge's viewport, measured on a frozen snapshot", point 5: the band
// spans 1181-1208px; the agent that closed it reported it overflowing at every width in that band and at none of 122
// widths sampled from 1170 to 1230). At 756 that same page overflows by 187px for an unrelated reason, so one
// rendering cannot separate the band from that other overflow - a reader must not take this rule's green line as
// "this page fits at every width". Catching a 29px-wide band needs a **sweep of several widths**: one rendering per
// width, each paying the settle wait the suite already pays per rendering, so the cost is renderings x widths, and a
// second width is a change to how the suite renders *every* page - a viewport decision another agent measured and
// recommended leaving alone (the width changes no verdict today, and `applyAllow` has no viewport field, so a
// declaration that is right at one width becomes an unused note or a swallowed failure at the other). So this rule is
// single-width **on purpose**: it catches a page too wide at the width the suite declares, and the narrow band around
// 1181 still needs a width the suite does not visit.
//
// It is also blind the way every rule in this file is blind: a declaration that never wins is not on screen. Measured
// the same day, the fix for that band dropped two dead `display: grid` halves of a media query the base rule
// overrode, and the rendered page did not change — the suite never sees dead code. This rule measures what the page
// did, not what the sheet says, and that is its strength and this blind spot in one sentence.
//
// One measured consequence, so nobody is surprised by it: `overflow-x: hidden` does NOT hide the defect from this
// rule. Measured on a copy of the conforming fixture (2026-10-08), the same 900px card with `html { overflow-x:
// hidden }` still reports `documentElement.scrollWidth` 934 against a 756px viewport. A page that clips its overflow
// is therefore reported too, and rightly: content clipped at the right edge is content the operator cannot reach at
// all. Whether that clip was deliberate is a reading matter, and it belongs in the app's allowance with its reason.
function rule11ViewportFit(snapshot) {
  const findings = [];
  const overflow = snapshot && snapshot.overflow;
  if (!overflow || !Number.isFinite(Number(overflow.viewportWidth))) {
    // A snapshot built by hand (the no-browser checks in `scripts/test-design-conformance.mjs`) carries no viewport,
    // and a rule with no measurement says so rather than passing for the wrong reason.
    findings.stats = { 'viewport width': 0, pages: 0, excess: null };
    findings.push({
      rule: 11, code: 'no-viewport-measurement', element: 'the page', path: '',
      measured: 'this observation carries no viewport measurement, so the suite cannot say whether the page fits',
      kitSays: 'a page must be no wider than the window it is rendered in',
      fix: 'observe the page through collect.mjs (the browser path) instead of a snapshot built by hand',
      severity: 'not-run', spellings: [],
    });
    return findings;
  }
  const excess = Number(overflow.excess) || 0;
  // The stats are recorded even when the page fits, so a green line shows what was measured (756/756/0) instead of a
  // rule that matched nothing and a reader who cannot tell the two apart.
  findings.stats = { 'viewport width': overflow.viewportWidth, 'widest scrollWidth': overflow.scrollWidth, excess };
  if (excess <= 0) return findings;

  // The element to name: the widest thing past the edge, which is the row or block that could be made to fit, and
  // failing that the element that reaches furthest right, and failing both the measurement itself.
  const culprit = overflow.widestPastEdge || overflow.rightmost || { element: 'the page', path: '' };
  const detail = [
    `${overflow.wideningBox || 'documentElement'}.scrollWidth is ${overflow.scrollWidth}px against a ` +
      `${overflow.viewportWidth}px viewport: ${excess}px too wide`,
  ];
  if (overflow.rightmost) {
    detail.push(`the furthest right element is ${overflow.rightmost.element}, reaching ${overflow.rightmost.right}px`);
  }
  if (overflow.widestPastEdge &&
      (!overflow.rightmost || overflow.widestPastEdge.element !== overflow.rightmost.element)) {
    detail.push(`the widest thing past the edge is ${overflow.widestPastEdge.element}, ${overflow.widestPastEdge.width}px wide`);
  }
  findings.push(finding(
    11,
    'overflows-viewport',
    culprit,
    detail.join('; '),
    `the suite renders every page in its own declared viewport (${overflow.viewportWidth}px wide here) and a page must ` +
      'fit it: a page ' +
      'that scrolls sideways carries whatever stands off its right edge out of the operator\'s reach',
    'make the page fit the window - let the row wrap, give the element a max-width of 100% or a min-width of 0 so it ' +
      'can shrink, or move it inside the window - because a page that scrolls sideways hides its own right edge ' +
      'behind a scroll gesture the operator has to know to make',
  ));
  return findings;
}

// ---------------------------------------------------------------------------
// The whole checklist
// ---------------------------------------------------------------------------
/// A measured value with its colours blanked out. Two renderings of the same defect (light and dark) differ only in
/// the colours, so they are one finding; two different defects on one element (a bad background and a bad edge) keep
/// different shapes and stay two.
function measuredShape(measured) {
  return String(measured || '')
    .replace(/rgba?\([^)]*\)/g, 'COLOUR')
    .replace(/#[0-9a-fA-F]{3,8}\b/g, 'COLOUR');
}

/// Run every rule over the observations. `ctx` carries: kit, palette, references (rule 4 input), declaredTokens,
/// and one-or-two `snapshots` (`{ light, dark }`). Returns the findings and what each rule managed to look at, so a
/// rule that matched nothing is visible as a count of zero rather than a green line.
export function analyse(ctx) {
  const themeFindings = [];
  const stats = {};
  for (const [theme, snapshot] of Object.entries(ctx.snapshots)) {
    const calls = [
      [1, rule1Edges(snapshot, ctx)],
      [2, rule2Numbers(snapshot, ctx)],
      [3, rule3Colours(snapshot, ctx)],
      [5, rule5Honesty(snapshot)],
      [6, rule6States(snapshot)],
      [7, rule7Vocabulary(snapshot)],
      // Rule 8 is the one rule that reads across renderings rather than inside one: the snapshot carries the pair of
      // readings taken with the knob forced (`run.mjs`), and `theme` decides which table the kit's steps come from.
      [8, rule8Type(snapshot, { ...ctx, theme })],
    ];
    for (const [id, items] of calls) {
      if (items.stats && !stats[id]) stats[id] = items.stats;
      for (const item of items) themeFindings.push({ theme, ...item });
    }
  }
  const themeItems = rule4Themes({ ...ctx, light: ctx.snapshots.light, dark: ctx.snapshots.dark });
  if (themeItems.stats) stats[4] = themeItems.stats;
  for (const item of themeItems) themeFindings.push({ theme: 'both', ...item });

  // Rule 9 is the document's own adopted stylesheet order. It is the same in both renderings - the links do not move
  // between themes - so it is asked once, of whichever rendering exists, rather than twice for the same answer.
  const orderItems = rule9LoadOrder(ctx.snapshots.light || ctx.snapshots.dark || {});
  if (orderItems.stats) stats[9] = orderItems.stats;
  for (const item of orderItems) themeFindings.push({ theme: 'both', ...item });

  // Rule 10 is the plan a page linked and then answered a second time. Its two numbers are the kit's own geometry
  // (`.stack`'s gap and `.builder-column`'s floor; the tracks are not comparable here - see the rule's own comment),
  // and `body.theme-dark` re-declares neither `--space-4` nor the floor - so, like rule 9, it is asked once of whichever
  // rendering exists rather than twice for one answer. What that does not see, said out loud: a page that retyped the
  // plan **inside a theme-only rule** would differ between the two renderings, and one reading cannot tell which of
  // them answered.
  const planItems = rule10RetypedPlan(ctx.snapshots.light || ctx.snapshots.dark || {});
  if (planItems.stats) stats[10] = planItems.stats;
  for (const item of planItems) themeFindings.push({ theme: 'both', ...item });

  // Rule 11 is the page's own width against the window it was rendered in — the one measurement none of the eight,
  // nor rule 9, nor rule 10 takes. It is asked once, of whichever rendering exists, for the same reason rules 9 and
  // 10 are: the viewport does not change with the theme, and a second reading of `<html>`'s width would be the same
  // number. What that leaves unseen is said here: a page whose overflow exists only in the dark rendering (a theme-only
  // rule that widened something) would be read in the light rendering alone, and this one reading could not tell.
  const fitItems = rule11ViewportFit(ctx.snapshots.light || ctx.snapshots.dark || {});
  if (fitItems.stats) stats[11] = fitItems.stats;
  for (const item of fitItems) themeFindings.push({ theme: 'both', ...item });

  const merged = new Map();
  const order = [];
  for (const item of themeFindings) {
    if (item.severity === 'note' || item.code === 'state-not-on-page') {
      order.push(item);
      continue;
    }
    const key = [item.rule, item.code, item.element, item.path, measuredShape(item.measured)].join('|');
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.themes.push(item.theme);
      if (item.measured !== existing.measured && !existing.measured.includes(item.measured)) {
        existing.measured = `${existing.measured} · in the ${item.theme} theme: ${item.measured}`;
      }
      for (const spelling of item.spellings || []) {
        if (!existing.spellings.includes(spelling)) existing.spellings.push(spelling);
      }
    } else {
      const copy = { ...item, themes: [item.theme] };
      merged.set(key, copy);
      order.push(copy);
    }
  }
  return { findings: order, stats };
}

/// Every rule, with a status each, for the report. `findings` are already allow-filtered by the caller.
export function summarise(findings, stats = {}) {
  return RULES.map((rule) => {
    const items = findings.filter((item) => item.rule === rule.id);
    const failures = items.filter((item) => item.severity === 'fail');
    const declared = items.filter((item) => item.severity === 'declared');
    const notes = items.filter((item) => item.severity === 'note' || item.severity === 'not-run' || item.severity === 'not-checked');
    let status = 'ok';
    if (failures.length) status = 'fail';
    else if (declared.length) status = 'declared';
    else if (items.some((item) => item.severity === 'not-checked')) status = 'not-checked';
    else if (items.some((item) => item.severity === 'not-run')) status = 'not-run';
    else if (!items.length) status = 'ok';
    return { rule: rule.id, key: rule.key, title: rule.title, status, failures, declared, notes, findings: items, stats: stats[rule.id] || null };
  });
}
