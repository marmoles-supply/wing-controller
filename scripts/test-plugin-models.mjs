// Keeps `crates/wing-core/src/plugin_models.rs` in step with the Maillot appendix.
//
// The model-aware catalogue is built from the appendix tables ("which parameters does the model on
// this strip actually expose?"), so a hand-edited or stale generated file would quietly offer
// parameters the console ignores. This test regenerates the table in memory and compares it, and
// checks a few models against names verified on real hardware.
//
// Run: node scripts/test-plugin-models.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = readFileSync(path.join(repoRoot, 'crates/wing-core/src/plugin_models.rs'), 'utf8');

// --- 1. The committed file is exactly what the generator produces ----------
execFileSync('node', ['scripts/wing-plugin-models.mjs', '--check'], { cwd: repoRoot, stdio: 'inherit' });
console.log('1. plugin_models.rs matches the appendix');

// --- 2. The table is complete enough to be useful -------------------------
assert.match(generated, /pub const PLUGIN_MODELS: &\[PluginModel\] = &\[/, 'the model table must exist');
const modelCount = (generated.match(/^    PluginModel \{$/gm) || []).length;
const parameterCount = (generated.match(/PluginParameter \{ name:/g) || []).length;
assert.ok(modelCount >= 90, `the appendix documents ~99 plugin tables, the file has ${modelCount}`);
assert.ok(parameterCount >= 1000, `expected the full parameter set, the file has ${parameterCount}`);

for (const model of ['GATE', 'DEQ2', 'DEQ3', 'WARM', 'LMT', 'CMB', 'RIDE', 'E88C', 'ONEC', 'STD', 'SOUL']) {
  assert.ok(
    new RegExp(`model: "${model}",`).test(generated),
    `the ${model} table must be generated`,
  );
}
console.log(`2. ${modelCount} models, ${parameterCount} parameters`);

// --- 3. Names verified against the test console are present ----------------
// WING Rack FW 3.1.1 answered these read-only, so they are the ground truth for the format.
const verified = {
  DEQ2: ['1-thr', '2-thr', '1-g', '2-g'],
  WARM: ['drv', 'trim', 'mix'],
  LMT: ['tspd', 'trans', 'tgain', 'ton', 'comp', 'cgain', 'con'],
  GATE: ['thr', 'range', 'att', 'hld', 'rel', 'acc', 'ratio'],
};
for (const [model, parameters] of Object.entries(verified)) {
  const block = new RegExp(`model: "${model}",[\\s\\S]*?\\n    \\},`).exec(generated)?.[0] ?? '';
  assert.ok(block, `the ${model} block must be present`);
  for (const parameter of parameters) {
    assert.ok(
      block.includes(`name: "${parameter}"`),
      `${model} must expose ${parameter}`,
    );
  }
}
console.log('3. hardware-verified names are present in their models');

// --- 4. The aliases the routing tables need --------------------------------
for (const [reported, table] of [['D241G', 'D241'], ['D241C', 'D241']]) {
  assert.ok(
    generated.includes(`("${reported}", "${table}")`),
    `${reported} must resolve to the ${table} table`,
  );
}
console.log('4. variant names resolve through the alias table');

// --- 5. The channel section lists come from the routing tables ------------
for (const list of ['CHANNEL_GATE_MODELS', 'CHANNEL_DYN_MODELS', 'CHANNEL_EQ_MODELS']) {
  const body = new RegExp(`pub const ${list}: &\\[&str\\] = &\\[([^\\]]*)\\]`).exec(generated)?.[1] ?? '';
  assert.ok(body.length > 0, `${list} must be generated`);
  const entries = body.split(',').map((entry) => entry.trim().replace(/"/g, '')).filter(Boolean);
  assert.ok(entries.length >= 7, `${list} looks too short: ${entries.length}`);
}
assert.match(generated, /pub const CHANNEL_EQ_MODELS: &\[&str\] = &\["STD"/, 'the EQ list starts with STD');
console.log('5. channel gate/dyn/EQ model lists are generated');

// --- 6. Every model the console offers for an FX slot resolves ------------
// `/fx/<slot>/mdl` is a closed list (Maillot 2896-2934) and the appendix is where its parameters are.
// A name the console reports that resolves to no table leaves those parameters unreachable, which is
// what `ROOM`, `DEL/REV` and `V-IMG` did until they became aliases (`R-OOM`, `DELREV`, `V_IMG`).
const catalogSource = readFileSync(path.join(repoRoot, 'crates/wing-core/src/lib.rs'), 'utf8');
const generatedModels = new Set(
  [...generated.matchAll(/^        model: "((?:[^"\\]|\\.)*)",$/gm)].map((match) => match[1]),
);
const generatedAliases = new Map(
  [...generated.matchAll(/^    \("((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\),$/gm)].map((match) => [
    match[1],
    match[2],
  ]),
);
const resolves = (name) => generatedModels.has(generatedAliases.get(name) ?? name);
const consoleList = (constant) => {
  const body = new RegExp(`const ${constant}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`).exec(catalogSource)?.[1] ?? '';
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
};
const slots1to8 = consoleList('FX_MODELS_SLOTS_1_TO_8');
const slots9to16 = consoleList('FX_MODELS_SLOTS_9_TO_16');
assert.ok(slots1to8.length >= 60, `the console documents 64 models for slots 1…8, got ${slots1to8.length}`);
assert.ok(slots9to16.length > 0, 'the reduced list for slots 9…16 must be read');
for (const name of [...slots1to8, ...slots9to16]) {
  assert.ok(resolves(name), `${name} is offered by /fx/<slot>/mdl but resolves to no appendix table`);
}
for (const name of slots9to16) {
  assert.ok(slots1to8.includes(name), `${name} is offered for slots 9…16 but not for slots 1…8`);
}
console.log(`6. all ${slots1to8.length + slots9to16.length} console FX model names resolve to a table`);

// --- 7. The flanger has its own table and the chorus keeps hers -----------
// The "Stereo Flanger" table prints `mdl: CHORUS` (7757), the document's typo; its rows belong to
// FLANGER (the console lists CHORUS and FLANGER separately at 2903-2904) and CHORUS must not gain the
// flanger's feedback controls. Model names carry `*` (`*MASTER*`), so they are escaped before use.
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const modelBlock = (name) =>
  new RegExp(`model: "${escapeRegExp(name)}",[\\s\\S]*?\\n    \\},`).exec(generated)?.[0] ?? '';
const parametersOf = (name) =>
  [...modelBlock(name).matchAll(/PluginParameter \{ name: "([^"]+)", spec: /g)].map((match) => match[1]);
const chorus = parametersOf('CHORUS');
const flanger = parametersOf('FLANGER');
assert.ok(chorus.length === 11, `the Stereo Chorus table prints 11 parameters, got ${chorus.length}`);
assert.ok(flanger.length === 12, `the Stereo Flanger table prints 12 parameters, got ${flanger.length}`);
assert.ok(flanger.includes('flc') && flanger.includes('fhc') && flanger.includes('feed'), 'the flanger owns its feedback rows');
assert.ok(chorus.includes('wave') && chorus.includes('sprd'), 'the chorus keeps its own rows');
assert.ok(!chorus.includes('flc') && !flanger.includes('wave'), 'the two tables must not be merged');
console.log(`7. FLANGER (${flanger.length}) and CHORUS (${chorus.length}) are separate tables`);

// --- 8. The rows the extraction damaged are recovered, none dropped -------
// Two classes, both counting every printed row: a mangled quote or colon (7211, 7227, 8140, 8149) and
// an index column that restarted inside a table (7189-7195, the tail of MOOD).
const carries = (model, name) =>
  new RegExp(
    `model: "${escapeRegExp(model)}",[\\s\\S]*?PluginParameter \\{ name: "${escapeRegExp(name)}"`,
  ).test(generated);
for (const [model, name] of [
  ['RACKAMP', 'drive'],
  ['RACKAMP', 'heq'],
  ['UKROCK', 'pres'],
  ['UKROCK', 'sag'],
  ['ANGEL', 'pres'],
  ['ANGEL', 'sag'],
  ['*MASTER*', 't_hi'],
  ['*MASTER*', 'airm'],
  ['MOOD', 'rel'],
  ['MOOD', 'lfo'],
  ['MOOD', 'wave'],
]) {
  assert.ok(carries(model, name), `${model} must carry ${name}: the printed row is documented`);
}
// The gate's ratio list wraps onto 8220; the join is what keeps its fifth value.
assert.match(generated, /name: "ratio", spec: "str \[1:1\.5, 1:2, 1:3, 1:4, gate\] ratio"/, 'a wrapped list keeps its last value');
console.log('8. mangled and restarted rows are recovered with their documented names');

console.log('plugin model table verified');
