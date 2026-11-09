// Generates `crates/wing-core/src/plugin_models.rs` from the Maillot appendix.
//
// Maillot WING Remote Protocols 3.1.0 is the protocol authority for this project (see AGENTS.md), and
// its "Appendix: Effects and Plugins' Parameters list" is the only complete source of which parameters
// each channel plugin model exposes. Channel gate/compressor/EQ parameters exist ONLY for the model
// loaded on that strip (`/gate/mdl`, `/dyn/mdl`, `/eq/mdl`), so the catalogue has to be model-aware
// instead of offering the generic names that the console silently ignores.
//
// Usage:
//   node scripts/wing-plugin-models.mjs           # write the Rust table
//   node scripts/wing-plugin-models.mjs --print    # print a summary instead
//   node scripts/wing-plugin-models.mjs --check    # fail if the committed file is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProtocolReference } from './lib/protocol-reference.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolPath = path.join(repoRoot, 'scratch/wing_protocols.txt');
const outputPath = path.join(repoRoot, 'crates/wing-core/src/plugin_models.rs');

const text = readProtocolReference(protocolPath);

/**
 * The appendix runs from its own heading to the next `Appendix:` heading. The table of contents has
 * an entry with the same words followed by dot leaders, so the heading is matched on a whole line.
 *
 * Returns the text together with the file line its first line is on, so every line number this script
 * reports or writes into the generated file is the one a reader finds in `scratch/wing_protocols.txt`.
 */
function appendixText(source) {
  // Page breaks put a form feed before the heading, so leading control characters are stripped — but
  // only for finding it: the text handed back keeps its own indentation, which is what tells a wrapped
  // value list from the row it continues.
  const raw = source.split('\n');
  const lines = raw.map((line) => line.replace(/^[\s\u000b\u000c]+/, ''));
  const heading = lines.findIndex((line) => /^Appendix: Effects and Plugins.+Parameters list\s*$/.test(line));
  if (heading < 0) throw new Error('the appendix heading was not found in scratch/wing_protocols.txt');
  let end = lines.length;
  for (let index = heading + 1; index < lines.length; index += 1) {
    if (/^Appendix: /.test(lines[index])) {
      end = index;
      break;
    }
  }
  // The heading is line `heading + 1` (1-based), so the line after it is `heading + 2`.
  return { text: raw.slice(heading + 1, end).join('\n'), firstLine: heading + 2 };
}

/**
 * The appendix's own `mdl` rows that name the wrong model, as `(printed name, table label, model)`.
 *
 * The "Stereo Flanger" table prints `0 “mdl”:  CHORUS` (7757), the name of the table above it: the
 * document's typo. The table's own label is the evidence for what its rows are, and the console lists
 * `CHORUS` (2903) and `FLANGER` (2904) as two separate models behind `/fx/<slot>/mdl`. Both halves are
 * needed: without the correction the flanger's rows are merged into CHORUS — the two tables share
 * `lc`, `hc`, `mix`, `dlyl`, `dlyr`, `depl`, `depr` and `spd`, so the merge is silent — and `FLANGER`,
 * a model the console offers, resolves to no table at all.
 */
const MODEL_CORRECTIONS = [{ printed: 'CHORUS', label: 'Stereo Flanger', model: 'FLANGER' }];

/// How many continuation lines one wrapped value list may take. The language-preset lists of the
/// reverb tables (`preset`, 7515-7567) are the longest, running over fifty lines, so the cap is a
/// runaway guard rather than a limit the document reaches: the join stops at a blank line, at the next
/// parameter row, and at any line not indented deeper than the row it continues.
const MAX_WRAPPED_SPEC_LINES = 64;

/// True while a spec has an opening bracket its own line never closes: the list continues below.
const bracketsAreOpen = (spec) => (spec.match(/\[/g) || []).length > (spec.match(/\]/g) || []).length;

/**
 * Every plugin table is a block of numbered parameter lines; the block's display name is the nearest
 * preceding line that is not itself a parameter, page header or footer.
 *
 * `firstLine` is the file line `appendix` starts on, so every reported line number is the one in
 * `scratch/wing_protocols.txt`. Returns the blocks as printed plus what the text extraction mangled on
 * the way, because a documented parameter must never be dropped in silence.
 */
function parsePluginTables(appendix, firstLine = 1) {
  // Leading whitespace is optional because the page-break normalisation may already have eaten it.
  const parameter = /^[\s\u000b\u000c]*(\d+)\s+[“"]([^”"]+)[”"]:\s*(.*?)\s*$/;
  // The rows the extraction damaged. The closing quote is missing (7211 `5 “drive`, 7227 `5 “pres`)
  // or came out as another opening quote (8140 `4 “t_hi“`), the colon may be gone as well (7214
  // `8 “heq”`, 7230 `8 “sag”`), and the opening quote can be a right one (8149 `12 ”airm”:`). The name
  // then runs to the first quote, colon or run of two spaces, and the spec is what follows it.
  const damaged = /^[\s\u000b\u000c]*(\d+)\s+[“‘"”]([^“‘"”\s]+)[“‘"”]?\s*(?::\s*|\s{2,})(.*?)\s*$/;
  const noise = /^(©|WING remote protocols|Effects and Plugins|Standard effects|Premium effects|Filter Plugins|Gate Plugins|EQ Plugins|Compressor Plugins|\s*$)/;
  const lines = appendix.split('\n');
  const blocks = [];
  const recovered = [];
  const wrapped = [];
  let current = null;
  let pendingLabel = null;
  for (let position = 0; position < lines.length; position += 1) {
    const line = lines[position];
    const exact = parameter.exec(line);
    const match = exact || damaged.exec(line);
    if (!match) {
      const trimmed = line.trim();
      // Anything that is not a page header, footer or standalone page number can name the next table.
      if (trimmed && !noise.test(trimmed) && !/^\d+$/.test(trimmed)) pendingLabel = trimmed;
      continue;
    }
    const index = Number(match[1]);
    if (index === 0) {
      current = { label: pendingLabel || '(unnamed)', line: firstLine + position, parameters: [] };
      blocks.push(current);
    }
    if (!current) continue;
    if (!exact) {
      recovered.push({ index, name: match[2], line: firstLine + position, label: current.label });
    }
    // A value list longer than the printed column wraps onto the following lines, which carry neither
    // an index nor a name (`str [1:1.5, 1:2, 1:3, 1:4,` + `gate] ratio`, 8219-8220; the ST-DL pattern
    // takes three lines, 7778-7780). They are indented deeper than the row they continue and are not
    // themselves a row, which is what tells a wrapped list from the next parameter, from the next
    // table's label and from a page header. Joining them keeps the documented values: without it the
    // gate's ratio lost `gate` and a `wave` list lost four of its seven waveforms.
    let spec = match[3];
    if (bracketsAreOpen(spec)) {
      const indent = line.length - line.trimStart().length;
      let next = position + 1;
      let joined = 0;
      while (next < lines.length && joined < MAX_WRAPPED_SPEC_LINES) {
        const candidate = lines[next];
        const continuation = candidate.trim();
        // A page footer lands in the middle of the longest lists (the `preset` list of the Hall table
        // runs from 7515 to 7567 and page 160's footer is printed inside it): it is neither part of
        // the list nor the end of it, so it is stepped over.
        if (continuation && noise.test(continuation)) {
          next += 1;
          continue;
        }
        if (!continuation) break;
        if (parameter.test(candidate) || damaged.test(candidate)) break;
        if (candidate.length - candidate.trimStart().length <= indent) break;
        spec = `${spec} ${continuation}`;
        joined += 1;
        next += 1;
        if (!bracketsAreOpen(spec)) break;
      }
      if (joined > 0) {
        wrapped.push({ index, name: match[2], line: firstLine + position, lines: joined, label: current.label });
        position = next - 1;
      }
    }
    current.parameters.push({ index, name: match[2], spec });
  }

  // A block with no `mdl` row names no model. The extraction restarted the index column in the middle
  // of the Mood Filter table (7189-7195), so that table's tail arrived as a second block carrying the
  // same label; it is the table above it continued, and the six rows it printed (`rel`, `mix`, `lfo`,
  // `spd`, `phase`, `wave`) belong to MOOD. A block with no model and no label to continue is reported
  // as unnamed rather than merged into whatever came before it.
  const tables = [];
  const continued = [];
  const unparsed = [];
  for (const block of blocks) {
    const model = modelOf(block);
    const previous = tables[tables.length - 1];
    if (!model && previous && previous.label === block.label) {
      previous.parameters.push(...block.parameters);
      continued.push({ label: block.label, line: block.line, names: block.parameters.map((p) => p.name) });
      continue;
    }
    if (!model) unparsed.push({ label: block.label, line: block.line });
    tables.push({ ...block, model });
  }

  // Printed index numbers with no row at all: the document itself skips them (`*BUS*` 8 between
  // `eq_on` and `g`, Deluxe Amp 3, Red Compressor 6). They are reported, never invented.
  const gaps = [];
  for (const table of tables) {
    const printed = new Set(table.parameters.map((p) => p.index));
    const highest = Math.max(...printed);
    const missing = [];
    for (let index = 1; index <= highest; index += 1) if (!printed.has(index)) missing.push(index);
    if (missing.length > 0) gaps.push({ label: table.label, model: table.model, missing });
  }

  return { tables, recovered, wrapped, continued, unparsed, gaps };
}

/** `0 “mdl”: DEQ2` names the model a table implements, with the document's own typos corrected. */
function modelOf(table) {
  const mdl = table.parameters.find((p) => p.name === 'mdl');
  if (!mdl) return null;
  const printed = mdl.spec.replace(/[^A-Za-z0-9*_-]/g, '').trim() || null;
  if (!printed) return null;
  return MODEL_CORRECTIONS.find((entry) => entry.printed === printed && entry.label === table.label)?.model ?? printed;
}

/** The models a given channel path accepts, read from its own section of the routing tables. */
function modelsForPath(source, path_) {
  const start = source.indexOf(`\n${path_}`);
  if (start < 0) throw new Error(`${path_} was not found in the protocol text`);
  const rest = source.slice(start + path_.length + 1);
  const next = rest.search(/\n[a-z$]?\/|\n\/ch\/\d+\//);
  const span = next > 0 ? rest.slice(0, next) : rest.slice(0, 1200);
  // Model names can start with a digit (9000G, 76LA, 2250), so the token pattern allows them; the
  // `known` set keeps the routing prose out.
  return (span.toUpperCase().match(/\b[A-Z0-9][A-Z0-9*]{1,6}\b/g) || []).filter(
    // A name needs a letter… except the one all-digit model the console has (2250, documented on
    // every family at 2030, 2104, 2293, 2450, 2622, 2792): the old `/[A-Z]/` test silently dropped
    // it, so the editor could not select a model the console offers. `resolveModelName` still
    // resolves every token against the appendix tables, so prose numbers cannot leak into a list.
    (token) => /[A-Z]/.test(token) || token.length >= 3,
  );
}

const appendixSource = appendixText(text);
const dropped = [];
const { tables, recovered, wrapped, continued, unparsed, gaps } = parsePluginTables(appendixSource.text, appendixSource.firstLine);
const byModel = new Map();
for (const table of tables) {
  const model = table.model;
  if (!model) continue;
  const parameters = table.parameters.filter((p) => p.name !== 'mdl');
  const unique = [];
  for (const parameter of parameters) {
    if (unique.some((p) => p.name === parameter.name)) {
      // The appendix lists a name twice for CMB ("peak" as a switch and as a percentage); one OSC
      // path cannot be two parameters, so the first definition wins and the drop is recorded.
      dropped.push({ model, name: parameter.name, spec: parameter.spec });
      continue;
    }
    unique.push(parameter);
  }
  const existing = byModel.get(model);
  if (existing) {
    // A model documented twice (for instance as both a gate and a compressor plugin) keeps the union.
    for (const parameter of unique) {
      if (!existing.parameters.some((p) => p.name === parameter.name)) existing.parameters.push(parameter);
    }
    continue;
  }
  byModel.set(model, { model, label: table.label, parameters: unique });
}

const known = new Set(byModel.keys());
const aliases = new Map();

/**
 * Resolves a name from a routing table onto an appendix table. Footnote markers are glued to the last
 * name of those lists ("ONEC22" is ONEC plus note 22) and some families are split by variant there
 * while the appendix documents one table ("D241G"/"D241C" are the gate and compressor variants of the
 * D241 table). Exact matches win; anything else is recorded as an alias so the mapping is explicit.
 */
function resolveModelName(token) {
  if (known.has(token)) return { model: token, reported: token };
  // A glued footnote digit is an extraction artifact, not a name: "ONEC22" is ONEC.
  const withoutFootnote = token.replace(/\d+$/, '');
  if (known.has(withoutFootnote)) return { model: withoutFootnote, reported: withoutFootnote };
  // A letter suffix is a real variant the appendix documents as one table: D241G / D241C -> D241.
  const prefixed = [...known].filter((model) => token.startsWith(model) && token.length > model.length);
  if (prefixed.length === 1) {
    aliases.set(token, prefixed[0]);
    return { model: prefixed[0], reported: token };
  }
  return null;
}

const sectionModels = (path_) => {
  const seen = [];
  for (const token of modelsForPath(text, path_)) {
    const resolved = resolveModelName(token);
    if (!resolved) continue;
    // The list keeps the name the console reports; the alias table maps it onto the appendix table.
    if (!seen.includes(resolved.reported)) seen.push(resolved.reported);
  }
  return seen;
};

const gateModels = sectionModels('/ch/1/gate/mdl');
const eqModels = sectionModels('/ch/1/eq/mdl');
const dynModels = sectionModels('/ch/1/dyn/mdl');

// FX-only models are the appendix tables that no channel section lists. The set is taken before the
// console's own spellings are registered below: those aliases point at FX tables (`R-OOM`, `DELREV`,
// `V_IMG`), and counting an alias target as "reached by a strip list" would drop three effect models
// from this list.
const aliasTargets = new Set(aliases.values());
const fxModels = [...known].filter(
  (model) =>
    !aliasTargets.has(model) &&
    !gateModels.includes(model) &&
    !eqModels.includes(model) &&
    !dynModels.includes(model),
);

/**
 * The names the console offers behind `/fx/<slot>/mdl` that the appendix's tables spell differently.
 *
 * `/fx/1/mdl` lists `ROOM` (2897), `DEL/REV` (2901) and `V-IMG` (2916) — and `DEL/REV`, not `DELREV`,
 * is what the console takes (the routing-table note at 955 says the same) — while the appendix's
 * tables are `R-OOM` ("Room Reverb"), `DELREV` ("Delay/Reverb") and `V_IMG` ("Velvet Imager"). Without
 * these the three models' parameters are out of reach: an editor that reads `/fx/1/mdl` gets a name
 * `plugin_model()` cannot answer for.
 */
const CONSOLE_MODEL_ALIASES = [
  ['ROOM', 'R-OOM'],
  ['DEL/REV', 'DELREV'],
  ['V-IMG', 'V_IMG'],
];
for (const [reported, table] of CONSOLE_MODEL_ALIASES) {
  if (!known.has(table)) throw new Error(`the console model ${reported} aliases ${table}, which is not an appendix table`);
  aliases.set(reported, table);
}

/** The PDF extraction leaves zero-width spaces and stray breaks inside the tables; clean them out. */
const cleanText = (value) =>
  String(value)
    .replace(/[\u200b\u200c\u200d\ufeff\u00ad]/g, '')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();

const rustString = (value) => `"${cleanText(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const parameterLine = (parameter) => `            PluginParameter { name: ${rustString(parameter.name)}, spec: ${rustString(parameter.spec)} },`;

const models = [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
const rust = `// @generated by scripts/wing-plugin-models.mjs — do not edit by hand.
//
// Source of truth: Maillot WING Remote Protocols 3.1.0, "Appendix: Effects and Plugins' Parameters
// list" (scratch/wing_protocols.txt). A channel's gate, compressor and EQ parameters exist only for
// the model loaded on that strip (\`/gate/mdl\`, \`/dyn/mdl\`, \`/eq/mdl\`), so the catalogue is built
// from these tables instead of offering generic names the console ignores in silence.

// Names the appendix repeats inside one model and that were dropped (one OSC path cannot be two
// parameters): ${dropped.length === 0 ? 'none' : dropped.map((d) => `${d.model}.${d.name}`).join(', ')}.
//
// Rows the text extraction mangled and this generator recovered (the closing quote missing or wrong,
// and the colon gone with it), as \`TABLE index "name"\`: ${recovered.length === 0 ? 'none' : recovered.map((row) => `${row.label} ${row.index} "${row.name}"`).join(', ')}.
//
// Value lists the printed column wrapped onto the lines below them (${wrapped.length} rows): a wrapped
// line carries no index and is indented deeper than the row it continues, so it is joined back onto it.
// Without that the gate's \`ratio\` list loses \`gate\` (8219-8220) and the ST-DL \`pat\` list two of its
// ten patterns (7778-7780).
//
// A table the extraction restarted the index column inside: its further rows belong to the table above
// it — ${continued.length === 0 ? 'none' : continued.map((row) => `${row.label} from line ${row.line} (${row.names.join(', ')})`).join(', ')}.
//
// Printed index numbers the document carries no row for: ${gaps.length === 0 ? 'none' : gaps.map((gap) => `${gap.model} ${gap.missing.join('/')}`).join(', ')}. No name is invented for them.
//
// Tables that name no model at all: ${unparsed.length === 0 ? 'none' : unparsed.map((table) => `${table.label} (line ${table.line})`).join(', ')}.
//
// The "Stereo Flanger" table prints \`mdl: CHORUS\` (7757), the name of the table above it. Its rows are
// registered under FLANGER, the separate model the console lists at 2904, and CHORUS keeps exactly the
// rows of its own table (7742-7753).

/// One parameter of a plugin model, exactly as the appendix names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PluginParameter {
    pub name: &'static str,
    /// The appendix's own value description, e.g. \`linf [-80, 0, 161] dB\` or \`str [OFF, LPF, HPF]\`.
    pub spec: &'static str,
}

/// A plugin model as it appears behind a strip's \`mdl\` tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PluginModel {
    pub model: &'static str,
    pub label: &'static str,
    pub parameters: &'static [PluginParameter],
}

/// Every plugin table the appendix documents (${models.length} models).
pub const PLUGIN_MODELS: &[PluginModel] = &[
${models
  .map(
    (model) => `    PluginModel {
        model: ${rustString(model.model)},
        label: ${rustString(model.label)},
        parameters: &[
${model.parameters.map(parameterLine).join('\n')}
        ],
    },`,
  )
  .join('\n')}
];

/// Names the console (or a routing table) reports that resolve to another appendix table.
///
/// Two kinds share it. A routing table splits a family into variants the appendix documents once
/// (\`D241G\`/\`D241C\` are the gate and compressor variants of \`D241\`). And three effect models carry a
/// name of their own on the console: \`/fx/<slot>/mdl\` offers \`ROOM\` (2897), \`DEL/REV\` (2901) and
/// \`V-IMG\` (2916) where the appendix's tables are \`R-OOM\`, \`DELREV\` and \`V_IMG\`. A caller that read
/// the slot's model gets a name this table resolves, so the parameters of the three models are
/// reachable instead of resolving to nothing.
pub const PLUGIN_MODEL_ALIASES: &[(&str, &str)] = &[
${[...aliases.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([reported, table]) => `    (${rustString(reported)}, ${rustString(table)}),`)
  .join('\n')}
];

/// Appendix parameter names the text extraction mangled, as \`(model, appendix name, console name)\`.
///
/// The routing tables are the authority for a leaf, not the plugin appendix, and they disagree in
/// exactly one place: the Standard EQ table for bus/mtx/main prints its band 6 Q row as \`"7q"\` with
/// the description "q 6" (\`scratch/wing_protocols.txt:8658\`, the band digit mangled on extraction),
/// while the leaves that really exist are \`/bus/1/eq/6q\` (2434), \`/main/1/eq/6q\` (2605) and
/// \`/mtx/1/eq/6q\` (2775). It is the same class of defect as the footnote references glued to
/// \`thr23\`: the document says one thing and the console answers another.
///
/// This table is deliberately one row wide and one-directional, and it is written here, in the
/// generator, because it is knowledge about the document rather than something the document says.
/// It teaches a consumer the console name a mangled appendix row addresses, so \`STD\` *has* \`6q\`. It
/// never makes the mangled spelling a legal name: \`7q\` names no leaf on the console, and accepting
/// it would let an \`eq:7q\` target through the model check into a write the console ignores in
/// silence — the very defect the check exists to stop.
pub const PLUGIN_PARAMETER_ALIASES: &[(&str, &str, &str)] = &[("STD", "7q", "6q")];

/// The console name of one appendix row: the appendix spelling, unless the extraction mangled it.
fn console_parameter_name(model: &str, appendix_name: &'static str) -> &'static str {
    PLUGIN_PARAMETER_ALIASES
        .iter()
        .find(|(alias_model, appendix, _)| *alias_model == model && *appendix == appendix_name)
        .map(|(_, _, console)| *console)
        .unwrap_or(appendix_name)
}

/// Models the channel gate accepts (\`/ch/N/gate/mdl\`).
pub const CHANNEL_GATE_MODELS: &[&str] = &[${gateModels.map(rustString).join(', ')}];

/// Models the channel compressor accepts (\`/ch/N/dyn/mdl\`).
pub const CHANNEL_DYN_MODELS: &[&str] = &[${dynModels.map(rustString).join(', ')}];

/// Models the channel EQ accepts (\`/ch/N/eq/mdl\`).
pub const CHANNEL_EQ_MODELS: &[&str] = &[${eqModels.map(rustString).join(', ')}];

/// Appendix tables that no channel gate/dyn/EQ section lists: effect-slot models.
pub const FX_ONLY_MODELS: &[&str] = &[${fxModels.map(rustString).join(', ')}];

/// The table for a model, as the console reports it behind \`mdl\`.
pub fn plugin_model(model: &str) -> Option<&'static PluginModel> {
    let wanted = model.trim().to_ascii_uppercase();
    let resolved = PLUGIN_MODEL_ALIASES
        .iter()
        .find(|(reported, _)| *reported == wanted)
        .map(|(_, table)| *table)
        .unwrap_or(wanted.as_str());
    PLUGIN_MODELS.iter().find(|entry| entry.model == resolved)
}

/// Every parameter of a model in appendix order (\`mdl\` itself excluded), as \`(console name, row)\`:
/// what a caller that builds one entry per parameter should walk, because a row's printed name can
/// be the mangled spelling of the console's name (see \`PLUGIN_PARAMETER_ALIASES\`).
pub fn plugin_parameters(model: &str) -> Option<Vec<(&'static str, &'static PluginParameter)>> {
    plugin_model(model).map(|entry| {
        entry
            .parameters
            .iter()
            .map(|parameter| (console_parameter_name(entry.model, parameter.name), parameter))
            .collect()
    })
}

/// The parameter names a model exposes, in appendix order (\`mdl\` itself excluded), **as the console
/// knows them**: an appendix row the extraction mangled is reported under its console name (see
/// \`PLUGIN_PARAMETER_ALIASES\`). A caller that lists these names to an operator is offering names
/// the console accepts, not names the PDF printed.
pub fn plugin_parameter_names(model: &str) -> Option<Vec<&'static str>> {
    plugin_parameters(model).map(|parameters| {
        parameters
            .into_iter()
            .map(|(console_name, _row)| console_name)
            .collect()
    })
}

/// Whether a model exposes a given console parameter name.
pub fn plugin_model_has_parameter(model: &str, parameter: &str) -> bool {
    plugin_parameter_names(model).is_some_and(|names| names.contains(&parameter))
}

/// Whether **any** documented model exposes this console parameter name: what a \`section:name\`
/// target may name, whatever model the strip happens to run. The mangled appendix spelling of an
/// aliased row is not such a name (see \`PLUGIN_PARAMETER_ALIASES\`).
pub fn plugin_parameter_is_documented(parameter: &str) -> bool {
    let parameter = parameter.trim();
    !parameter.is_empty()
        && PLUGIN_MODELS.iter().any(|model| {
            model
                .parameters
                .iter()
                .any(|entry| console_parameter_name(model.model, entry.name) == parameter)
        })
}
`;

if (process.argv.includes('--print')) {
  console.log(`models: ${models.length}`);
  for (const model of models) {
    console.log(`  ${model.model.padEnd(10)} ${String(model.parameters.length).padStart(3)} params  ${model.label}`);
  }
  console.log(`gate: ${gateModels.length}  dyn: ${dynModels.length}  eq: ${eqModels.length}  fx-only: ${fxModels.length}`);
  console.log(`recovered rows:      ${recovered.length === 0 ? 'none' : recovered.map((row) => `${row.label} ${row.index} "${row.name}"`).join(', ')}`);
  console.log(`wrapped value lists: ${wrapped.length} rows`);
  console.log(`continued tables:    ${continued.length === 0 ? 'none' : continued.map((row) => `${row.label} line ${row.line}`).join(', ')}`);
  console.log(`index gaps:          ${gaps.length === 0 ? 'none' : gaps.map((gap) => `${gap.model} ${gap.missing.join('/')}`).join(', ')}`);
  console.log(`tables with no mdl:  ${unparsed.length === 0 ? 'none' : unparsed.map((table) => `${table.label} line ${table.line}`).join(', ')}`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== rust) {
    console.error('crates/wing-core/src/plugin_models.rs is out of date: rerun node scripts/wing-plugin-models.mjs');
    process.exit(1);
  }
  console.log(`plugin models up to date (${models.length} models)`);
  process.exit(0);
}

writeFileSync(outputPath, rust);
console.log(`wrote crates/wing-core/src/plugin_models.rs: ${models.length} models, ${models.reduce((n, m) => n + m.parameters.length, 0)} parameters`);
console.log(`channel gate models: ${gateModels.join(', ')}`);
console.log(`channel dyn models:  ${dynModels.join(', ')}`);
console.log(`channel eq models:   ${eqModels.join(', ')}`);
console.log(`fx-only models:      ${fxModels.join(', ')}`);
