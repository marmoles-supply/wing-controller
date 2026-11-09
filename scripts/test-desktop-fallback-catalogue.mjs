// The window's fallback catalogue must mirror the backend's, category by category.
//
// The fallback (`targetCatalogFallback` in `desktop/ui/index.html`) is what the standalone window
// reads until `target_catalog` answers — and what it keeps when that command fails or the app runs in
// a plain browser tab. It was fifteen categories behind the backend: every `output_*` family, the mute
// groups, the user controls, the monitor meters and the RTA bands could not be chosen at all in that
// state, and no test noticed because the browser tests read the same fallback and reported the same
// short list back to themselves (docs/MACRO_AUDIT_REMAINING_2026-09-24.md, last section).
//
// This guard closes that hole without a browser. It reads both catalogues **statically**:
//
//   * `crates/wing-core/src/lib.rs` is parsed for `TARGET_CATEGORIES` (the sixty rows) and for the
//     `*_TARGET_PARAMETERS` / `TRIGGER_*_PARAMETERS` tables the fifteen categories publish;
//   * `desktop/ui/index.html` is read for the fallback block (the `FALLBACK_*` declarations and the
//     `targetCatalogFallback` object) and evaluated in `node:vm` with no DOM, so the spreads and the
//     helper-built lists are read as the window really builds them;
//   * the two are compared field by field, and every difference is reported with its key.
//
// The middle section is the "the backend still says what this guard assumes" part: the dispatch that
// decides which table a category gets (`catalogue_target_parameters`,
// `trigger_parameters_for_category`) cannot be executed here, so the guard pins the lines it mirrors
// and fails loudly if their shape changes — a stale assumption must not pass as a green run.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUST = fs.readFileSync(path.join(repoRoot, 'crates/wing-core/src/lib.rs'), 'utf8');
const INDEX = fs.readFileSync(path.join(repoRoot, 'desktop/ui/index.html'), 'utf8');

// ── Reading a balanced run of source text ─────────────────────────────────────────────────────────
//
// Both files are source, not data: strings and comments may hold the brackets being counted, so the
// scanner honours `"`, `'`, `` ` ``, `//` and `/* */`. It is the one piece of parsing every reader
// below shares.

function balancedEnd(source, from, open, close) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`unbalanced ${open}${close} from offset ${from}`);
}

/** The text between the opening bracket at `from` and its partner, brackets included. */
function balancedText(source, from, open, close) {
  return source.slice(from, balancedEnd(source, from, open, close) + 1);
}

/** Splits `a, b(1, 2), "x, y"` on the commas that sit outside quotes and brackets. */
function splitTopLevel(text) {
  const parts = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      current += char;
      if (char === '\\') {
        current += text[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** A Rust string literal (`"x"`) as its value; anything else is handed back for the caller. */
function rustLiteral(token) {
  const trimmed = token.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('&"') && trimmed.endsWith('"'))) {
    return trimmed.replace(/^&?"/, '').replace(/"$/, '');
  }
  return trimmed;
}

// ── The backend's sixty category rows ─────────────────────────────────────────────────────────────

const CATEGORY_MARKER = 'pub const TARGET_CATEGORIES: &[TargetCategoryInfo] = &[';
const categoryBody = (() => {
  const at = RUST.indexOf(CATEGORY_MARKER);
  assert.ok(at >= 0, `the backend catalogue moved: "${CATEGORY_MARKER}" is gone from lib.rs`);
  return balancedText(RUST, RUST.indexOf('[', at + CATEGORY_MARKER.length - 1), '[', ']');
})();

/** Every `category(...)` / `category_in(...)` row of the backend, in the order it publishes them. */
function rustCategories() {
  const rows = [];
  const call = /\b(category_in|category)\s*\(/g;
  let match;
  while ((match = call.exec(categoryBody)) !== null) {
    const open = categoryBody.indexOf('(', match.index);
    const args = splitTopLevel(balancedText(categoryBody, open, '(', ')').slice(1, -1));
    const withSubgroup = match[1] === 'category_in';
    assert.ok(args.length === (withSubgroup ? 8 : 7),
      `category row ${args[0]} has ${args.length} fields, not the ${withSubgroup ? 8 : 7} its constructor takes`);
    rows.push({
      key: rustLiteral(args[0]),
      label: rustLiteral(args[1]),
      group: rustLiteral(args[2]),
      subgroup: withSubgroup ? rustLiteral(args[3]) : '',
      count: Number(args[withSubgroup ? 4 : 3]),
      prefix: rustLiteral(args[withSubgroup ? 5 : 4]),
      canTrigger: args[withSubgroup ? 6 : 5] === 'true',
      canTarget: args[withSubgroup ? 7 : 6] === 'true',
    });
    call.lastIndex = open;
  }
  return rows;
}

// ── The backend's parameter tables ────────────────────────────────────────────────────────────────

/** `const NAME: &[&str] = &[...]`: the closed lists a `choice(...)` names instead of writing out. */
const rustStringLists = (() => {
  const lists = new Map();
  const declaration = /const\s+([A-Z][A-Z0-9_]*)\s*:\s*&\[&str\]\s*=\s*&\[/g;
  let match;
  while ((match = declaration.exec(RUST)) !== null) {
    const body = balancedText(RUST, RUST.indexOf('[', match.index + match[0].length - 1), '[', ']');
    lists.set(match[1], [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((item) => item[1]));
  }
  return lists;
})();

/**
 * One row of a `*_TARGET_PARAMETERS` table, read through the constructor the backend used.
 *
 * The constructors are the catalogue's vocabulary (`toggle`, `choice`, `number`, `integer`, `text`,
 * `meter_parameter`, …) and each one fixes the fields its row does not spell out: a toggle is an int
 * 0/1, a meter a float in dB between -144 and 10. The wrappers `write_only(..)` and
 * `read_only_on(.., ..)` are stripped first, exactly as the backend strips them, and the flags they
 * carry are kept.
 */
function rustParameterRow(entry, tableName) {
  let text = entry.trim();
  let canTrigger = true;
  let readOnlyOnModels = false;
  for (;;) {
    const wrapper = text.match(/^(write_only|read_only_on)\s*\(/);
    if (!wrapper) break;
    if (wrapper[1] === 'write_only') canTrigger = false;
    else readOnlyOnModels = true;
    const inner = balancedText(text, wrapper[0].length - 1, '(', ')').slice(1, -1);
    text = splitTopLevel(inner)[0];
  }
  const call = text.match(/^([a-z_]+)\s*\(/);
  assert.ok(call, `the guard cannot read the row "${entry.slice(0, 60)}…" of ${tableName}`);
  const args = splitTopLevel(balancedText(text, text.indexOf('('), '(', ')').slice(1, -1)).map(rustLiteral);
  const row = {
    key: args[0],
    label: args[1],
    argKind: 'float',
    valueKind: 'number',
    unit: '',
    min: undefined,
    max: undefined,
    canTrigger,
    options: [],
    maxLen: 0,
    readOnlyOnModels,
  };
  switch (call[1]) {
    case 'toggle':
      row.argKind = 'int';
      row.valueKind = 'toggle';
      row.min = 0;
      row.max = 1;
      break;
    case 'choice':
      row.argKind = 'string';
      row.valueKind = 'enum';
      row.options = args[2].startsWith('&[')
        ? [...args[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((item) => item[1])
        : rustStringLists.get(args[2]);
      assert.ok(Array.isArray(row.options), `${tableName}/${args[0]}: unknown option list ${args[2]}`);
      break;
    case 'number':
      row.valueKind = args[2];
      row.unit = args[3];
      row.min = Number(args[4]);
      row.max = Number(args[5]);
      break;
    case 'integer':
      row.argKind = 'int';
      row.valueKind = args[2];
      row.unit = args[3];
      row.min = Number(args[4]);
      row.max = Number(args[5]);
      break;
    case 'text':
      row.argKind = 'string';
      row.valueKind = 'text';
      row.maxLen = Number(args[2]);
      break;
    case 'meter_parameter':
      row.valueKind = 'db_meter';
      row.unit = 'dB';
      row.min = -144;
      row.max = 10;
      break;
    case 'meter_flag_parameter':
      row.argKind = 'int';
      row.valueKind = 'toggle';
      row.min = 0;
      row.max = 1;
      break;
    case 'state_parameter':
      row.argKind = args[2];
      row.valueKind = args[3];
      row.unit = args[4];
      row.min = Number(args[5]);
      row.max = Number(args[6]);
      break;
    case 'parameter':
    case 'dead_parameter':
      row.canTrigger = false;
      row.argKind = call[1] === 'parameter' ? args[2] : 'string';
      row.valueKind = row.argKind === 'string' ? 'text' : 'number';
      break;
    default:
      throw new Error(`${tableName}: the guard does not know the constructor ${call[1]}(...)`);
  }
  return row;
}

/** A whole `const NAME: &[TargetParameterInfo] = &[ ... ];` table, in row order. */
function rustParameterTable(name) {
  const declaration = new RegExp(`const\\s+${name}\\s*:\\s*&\\[TargetParameterInfo\\]\\s*=\\s*&\\[`);
  const match = declaration.exec(RUST);
  assert.ok(match, `the backend table ${name} is gone from lib.rs`);
  // The declaration may wrap (`const X: &[..] =\n &[..]`), so the bracket is found from its last char.
  const body = balancedText(RUST, match.index + match[0].length - 1, '[', ']');
  const rows = [];
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (char === '/' && body[index + 1] === '/') {
      index = body.indexOf('\n', index);
      if (index < 0) break;
      continue;
    }
    if (char === '/' && body[index + 1] === '*') {
      index = body.indexOf('*/', index) + 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      index = balancedEnd(`x${body.slice(index)}`, 1, char, char) + index - 1;
      continue;
    }
    const call = /^([a-z_]+)\s*\(/.exec(body.slice(index));
    if (call) {
      const end = balancedEnd(body, index + call[0].length - 1, '(', ')');
      rows.push(rustParameterRow(body.slice(index, end + 1), name));
      index = end + 1;
      continue;
    }
    index += 1;
  }
  return rows;
}

/** `operators_for_value_kind`: what the backend publishes as a row's comparators. */
const rustOperatorsByKind = (() => {
  const marker = 'pub fn operators_for_value_kind(value_kind: &str) -> &\'static [&\'static str] {';
  const at = RUST.indexOf(marker);
  assert.ok(at >= 0, 'operators_for_value_kind is gone from lib.rs');
  const body = balancedText(RUST, RUST.indexOf('{', at + marker.length - 1), '{', '}');
  const table = new Map();
  for (const arm of body.matchAll(/((?:"[a-z_]+"\s*\|\s*)*"[a-z_]+")\s*=>\s*(&\[[^\]]*\])/g)) {
    const kinds = [...arm[1].matchAll(/"([a-z_]+)"/g)].map((item) => item[1]);
    const operators = [...arm[2].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    for (const kind of kinds) table.set(kind, operators);
  }
  return table;
})();

// ── The window's fallback catalogue, without a browser ────────────────────────────────────────────

/**
 * The `FALLBACK_*` declarations and the `targetCatalogFallback` object, run in an empty `node:vm`
 * context. No DOM, no IPC and no Chrome: the block is pure data and helper functions (the field
 * validation suite drives the same object in the page).
 */
function fallbackCatalogue() {
  const start = INDEX.indexOf('const FALLBACK_CHANNEL_PRETAPS');
  const objectAt = INDEX.indexOf('const targetCatalogFallback = {');
  assert.ok(start >= 0 && objectAt > start,
    'the fallback catalogue moved: `const FALLBACK_CHANNEL_PRETAPS` or `const targetCatalogFallback` is gone');
  const end = balancedEnd(INDEX, INDEX.indexOf('{', objectAt), '{', '}');
  const code = `${INDEX.slice(start, end + 1)}\n;targetCatalogFallback`;
  return vm.runInContext(code, vm.createContext({}));
}

// ── What the backend's dispatch still says ────────────────────────────────────────────────────────
//
// The guard mirrors a few lines of `lib.rs` it cannot execute. Each one is pinned here by shape, so a
// rewritten dispatch fails this test instead of leaving the comparison below quietly comparing the
// wrong tables.

const BACKEND_SHAPES = [
  ['the target half of the write/watch split', /if\s*!category_can_target\(&category\)\s*\{\s*return Vec::new\(\);/],
  ['the eleven output families share one table', /if output_prefix_for_category\(&category\)\.is_some\(\)\s*\{\s*return OUTPUT_TARGET_PARAMETERS\.to_vec\(\);/],
  ['the mute groups own table', /"mutegroup"\s*=>\s*MUTEGROUP_TARGET_PARAMETERS\.to_vec\(\),/],
  ['the user controls own table', /"userctrl"\s*=>\s*USERCTRL_TARGET_PARAMETERS\.to_vec\(\),/],
  ['monitor is watch-only', /"monitor"\s*=>\s*TRIGGER_MONITOR_PARAMETERS\.to_vec\(\),/],
  ['rta is watch-only', /"rta"\s*=>\s*TRIGGER_RTA_PARAMETERS\.to_vec\(\),/],
  ['an output family watches its meter and its own rows',
    /output_device_id\(&category\)\.is_some\(\)[\s\S]{0,200}?with_meter\(\s*TRIGGER_METER_PARAMETERS,/],
  ['a category the console reports whole is its own watch list',
    /"mutegroup"\s*\|\s*"userctrl"[\s\S]{0,120}?target_parameters_for_category\(&category\)/],
];
for (const [what, shape] of BACKEND_SHAPES) {
  assert.match(RUST, shape, `the backend dispatch changed: the guard can no longer assume ${what}`);
}

// ── The comparison ────────────────────────────────────────────────────────────────────────────────

const backendCategories = rustCategories();
const fallback = fallbackCatalogue();
const problems = [];
const fail = (message) => problems.push(message);

// The category roster, both directions.
const backendByKey = new Map(backendCategories.map((row) => [row.key, row]));
const fallbackByKey = new Map(fallback.categories.map((row) => [row.key, row]));
assert.equal(backendByKey.size, backendCategories.length, 'the backend catalogue repeats a category key');
assert.equal(fallbackByKey.size, fallback.categories.length, 'the fallback catalogue repeats a category key');
for (const row of backendCategories) {
  const mine = fallbackByKey.get(row.key);
  if (!mine) {
    fail(`category ${row.key}: the fallback does not carry it at all`);
    continue;
  }
  for (const field of ['label', 'group', 'subgroup', 'count', 'prefix', 'canTrigger', 'canTarget']) {
    const theirs = field === 'subgroup' ? (mine.subgroup ?? '') : mine[field];
    if (theirs !== row[field]) {
      fail(`category ${row.key}: ${field} is ${JSON.stringify(theirs)} in the fallback, ${JSON.stringify(row[field])} in the backend`);
    }
  }
}
for (const row of fallback.categories) {
  if (!backendByKey.has(row.key)) fail(`category ${row.key}: the fallback carries a row the backend does not have`);
}

// The eleven output families are exactly the keys `output_prefix_for_category` builds a prefix for:
// an output category the resolver cannot address must not be offered, and vice versa.
const outputResolverKeys = (() => {
  const at = RUST.indexOf('fn output_prefix_for_category(category: &str) -> Option<&\'static str> {');
  assert.ok(at >= 0, 'output_prefix_for_category is gone from lib.rs');
  const body = balancedText(RUST, RUST.indexOf('{', at), '{', '}');
  const keys = new Set();
  for (const arm of body.matchAll(/((?:"[a-z0-9_]+"\s*\|\s*)*"[a-z0-9_]+")\s*=>/g)) {
    for (const name of arm[1].matchAll(/"([a-z0-9_]+)"/g)) {
      if (name[1].startsWith('output_')) keys.add(name[1]);
    }
  }
  return keys;
})();
const OUTPUT_CATEGORY_KEYS = backendCategories
  .filter((category) => category.key.startsWith('output_'))
  .map((category) => category.key);
assert.deepEqual([...outputResolverKeys].sort(), [...OUTPUT_CATEGORY_KEYS].sort(),
  'the eleven output families must be the categories output_prefix_for_category addresses');
assert.equal(OUTPUT_CATEGORY_KEYS.length, 11, 'the console has eleven output families (Maillot 4435)');

// The parameter lists of the fifteen categories this guard exists for: the eleven outputs and the
// four control families the fallback used to miss. The dispatch above decides which table each one
// gets; the tables themselves are read out of `lib.rs` and compared row by row, in order.
const COVERED = [
  ...OUTPUT_CATEGORY_KEYS.map((key) => ({
    key,
    // `catalogue_target_parameters` returns OUTPUT_TARGET_PARAMETERS for every output family, and
    // `trigger_parameters_for_category` puts the group meter in front of the same two rows.
    target: ['OUTPUT_TARGET_PARAMETERS'],
    trigger: ['TRIGGER_METER_PARAMETERS', 'OUTPUT_TARGET_PARAMETERS'],
  })),
  { key: 'mutegroup', target: ['MUTEGROUP_TARGET_PARAMETERS'], trigger: ['MUTEGROUP_TARGET_PARAMETERS'] },
  { key: 'userctrl', target: ['USERCTRL_TARGET_PARAMETERS'], trigger: ['USERCTRL_TARGET_PARAMETERS'] },
  { key: 'monitor', target: [], trigger: ['TRIGGER_MONITOR_PARAMETERS'] },
  { key: 'rta', target: [], trigger: ['TRIGGER_RTA_PARAMETERS'] },
];

/** One fallback row as the guard sees it: the fields the backend's catalogue declares. */
function fallbackRow(row) {
  return {
    key: row.key,
    label: row.label,
    argKind: row.argKind,
    valueKind: row.valueKind ?? (row.argKind === 'string' ? 'text' : 'number'),
    unit: row.unit ?? '',
    min: row.min,
    max: row.max,
    canTrigger: row.canTrigger,
    options: [...(row.options || [])],
    maxLen: row.maxLen ?? 0,
    operators: [...(row.operators || [])],
  };
}

function compareParameters(categoryKey, kind, backendRows, mineRows) {
  const mine = (mineRows || []).map(fallbackRow);
  const where = `${categoryKey}/${kind}`;
  if (backendRows.length === 0) {
    if (mine.length > 0) {
      fail(`${where}: the backend publishes no ${kind} parameter here, the fallback publishes ${mine.map((row) => row.key).join(', ')}`);
    }
    return 0;
  }
  const backendKeys = backendRows.map((row) => row.key);
  const mineKeys = mine.map((row) => row.key);
  if (backendKeys.join('|') !== mineKeys.join('|')) {
    fail(`${where}: the fallback offers [${mineKeys.join(', ')}], the backend [${backendKeys.join(', ')}]`);
    return 0;
  }
  backendRows.forEach((row, index) => {
    const other = mine[index];
    for (const field of ['label', 'argKind', 'valueKind', 'canTrigger']) {
      if (other[field] !== row[field]) {
        fail(`${where}/${row.key}: ${field} is ${JSON.stringify(other[field])} in the fallback, ${JSON.stringify(row[field])} in the backend`);
      }
    }
    if (other.unit !== row.unit) {
      fail(`${where}/${row.key}: unit is ${JSON.stringify(other.unit)} in the fallback, ${JSON.stringify(row.unit)} in the backend`);
    }
    for (const bound of ['min', 'max']) {
      const declared = Number.isFinite(row[bound]) ? row[bound] : undefined;
      if (declared === undefined && other[bound] !== undefined) {
        fail(`${where}/${row.key}: the fallback declares a ${bound} of ${other[bound]}, the backend declares none`);
      }
      if (declared !== undefined && other[bound] !== declared) {
        fail(`${where}/${row.key}: ${bound} is ${JSON.stringify(other[bound])} in the fallback, ${declared} in the backend`);
      }
    }
    if (row.options.length > 0 && other.options.join('|') !== row.options.join('|')) {
      fail(`${where}/${row.key}: the closed list is [${other.options.join(', ')}], the backend says [${row.options.join(', ')}]`);
    }
    if (other.maxLen !== row.maxLen) {
      fail(`${where}/${row.key}: maxLen is ${JSON.stringify(other.maxLen)} in the fallback, ${row.maxLen} in the backend`);
    }
    // The comparators are the backend's own rule for the value kind (`operators_for_value_kind`),
    // published on every DTO row; the fallback spells them out, so they are compared too.
    const expected = rustOperatorsByKind.get(row.valueKind);
    assert.ok(expected, `${where}/${row.key}: the backend has no comparator rule for ${row.valueKind}`);
    if (other.operators.length > 0 && other.operators.join('|') !== expected.join('|')) {
      fail(`${where}/${row.key}: the comparators are [${other.operators.join(', ')}], the backend offers [${expected.join(', ')}]`);
    }
  });
  return mine.length;
}

let comparedTargetRows = 0;
let comparedTriggerRows = 0;
for (const covered of COVERED) {
  const targetRows = covered.target.flatMap((name) => rustParameterTable(name));
  const triggerRows = covered.trigger.flatMap((name) => rustParameterTable(name));
  comparedTargetRows += compareParameters(covered.key, 'target', targetRows,
    fallback.targetParametersByCategory?.[covered.key]);
  comparedTriggerRows += compareParameters(covered.key, 'trigger', triggerRows,
    fallback.triggerParametersByCategory?.[covered.key]);
}

// The two watch-only families carry no step rows at all — not even an empty list — so the editor can
// never aim a step at a leaf the console only reports: `monitor` and `rta` are meters (Maillot table
// 5) and their categories say `canTarget: false`.
for (const covered of COVERED.filter((entry) => entry.target.length === 0)) {
  const rows = fallback.targetParametersByCategory?.[covered.key];
  if (Array.isArray(rows) && rows.length > 0) {
    fail(`category ${covered.key}: watch-only, but the fallback publishes ${rows.length} step rows`);
  }
}

// ── No console identity in what the operator reads (project rule) ─────────────────────────────────
//
// The same rule the browser suite walks over the page, kept here as well so it is checked without
// Chrome: a hint or a label may not name the console used for testing, its address or its firmware.
const CONSOLE_IDENTITY = /(WING-[A-Za-z0-9-]+|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b(?:fw|firmware)\b[^.;]{0,16}?\d+\.\d+)/i;
const named = [];
const identityFields = (text, where) => {
  const match = CONSOLE_IDENTITY.exec(String(text || ''));
  if (match) named.push(`${where} · "${match[0]}"`);
};
for (const row of fallback.categories) identityFields(row.label, `category ${row.key}`);
for (const map of ['targetParametersByCategory', 'triggerParametersByCategory']) {
  for (const [category, list] of Object.entries(fallback[map] || {})) {
    for (const row of list || []) {
      identityFields(row.label, `${category}/${row.key} · label`);
      identityFields(row.valueHint, `${category}/${row.key} · valueHint`);
    }
  }
}
assert.deepEqual(named, [],
  `no user-visible catalogue text may name the test console, these did: ${named.join(' | ')}`);

// ── The verdict ───────────────────────────────────────────────────────────────────────────────────

assert.deepEqual(problems, [],
  `the window's fallback catalogue does not mirror the backend:\n  ${problems.join('\n  ')}`);

assert.equal(fallback.categories.length, backendCategories.length,
  'the fallback must carry every backend category, and nothing else');
const rowCount = [...Object.values(fallback.targetParametersByCategory || {}), ...Object.values(fallback.triggerParametersByCategory || {})]
  .reduce((total, list) => total + (list?.length || 0), 0);
console.log(`The window fallback mirrors the backend: ${fallback.categories.length} categories and ${rowCount} parameter rows, `
  + `${comparedTargetRows} target and ${comparedTriggerRows} trigger rows of the fifteen covered families compared field by field.`);
