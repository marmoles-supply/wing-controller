// The complete guide is generated, not hand-written: `docs/guide/NN-*.md` is the reviewed source and
// `desktop/ui/guide-content.js` is what the window loads. This contract keeps the two in step (the
// same pattern `test-plugin-models.mjs` uses for `plugin_models.rs`) and refuses a guide that is
// empty, duplicated or half-rendered.
//
// Run: node scripts/test-desktop-guide-content.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(repoRoot, 'desktop/ui/guide-content.js');
const guideDir = path.join(repoRoot, 'docs/guide');

// 1. The generated file must match the Markdown right now.
assert.ok(fs.existsSync(generated), 'desktop/ui/guide-content.js must exist (run scripts/generate-guide-content.mjs)');
try {
  const out = execFileSync('node', [path.join(repoRoot, 'scripts/generate-guide-content.mjs'), '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  console.log(out.trim());
} catch (error) {
  assert.fail(
    `desktop/ui/guide-content.js is out of date with docs/guide/*.md: run ` +
      `node scripts/generate-guide-content.mjs\n${error.stdout || ''}${error.stderr || ''}`,
  );
}

// What must not appear in the sources or in the published content: project file names, internal
// documents, scripts and bare line numbers from the external documentation.
const IMPLEMENTATION_REFERENCES = [
  [/\b(?:index|meters|guide)\.html\b/, 'an app window file'],
  [/\b(?:main|lib|runtime|plugin_models)\.rs\b/, 'a Rust source file'],
  [/\bwing_protocols\b|\bMASTER_PLAN\b|\bPLAN:\d+/, 'an internal document'],
  [/\bscripts\/[a-z0-9-]+\.mjs\b/, 'a build script'],
  [/\.(?:rs|mjs|js)\b/, 'a source file extension'],
  [/\(\d{2,4}(?:[–-]\d{2,4})?\)/, 'a bare documentation line number'],
];

// 2. The Markdown sources the shipped content comes from.
const sources = fs.readdirSync(guideDir).filter((name) => /^\d\d-.*\.md$/.test(name)).sort();
assert.ok(sources.length >= 10, `the guide must ship every chapter, found ${sources.length}`);

// 3. The shipped content: one entry per chapter, with real prose in it.
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(generated, 'utf8'), sandbox);
const sections = sandbox.window.WING_GUIDE_SECTIONS;
assert.ok(Array.isArray(sections) && sections.length === sources.length,
  `expected ${sources.length} sections in guide-content.js, found ${sections?.length}`);

const ids = new Set();
let totalWords = 0;
for (const [index, section] of sections.entries()) {
  const source = sources[index];
  assert.equal(section.id, source.replace(/^\d\d-/, '').replace(/\.md$/, ''),
    `section ${index + 1} must come from ${source}`);
  assert.ok(!ids.has(section.id), `duplicated guide section id: ${section.id}`);
  ids.add(section.id);
  assert.ok(section.title && section.title.length > 2, `${section.id} needs a title`);
  assert.ok(section.words >= 250, `${section.id} is too thin (${section.words} words)`);
  totalWords += section.words;
  assert.ok(/<p>|<ul>|<table>|<h2>/.test(section.html), `${section.id} rendered no HTML`);
  // Unrendered Markdown would reach the operator as literal asterisks and brackets.
  assert.ok(!/\*\*[^*]+\*\*/.test(section.html), `${section.id} still contains unrendered **bold**`);
  assert.ok(!/\]\([^)]+\)/.test(section.html), `${section.id} still contains an unrendered link`);
  assert.ok(!/^\s*[-*]\s/m.test(section.html), `${section.id} still contains an unrendered list item`);
  // Nothing about how the application is built (project owner decision, 2026-09-22): the operator
  // reads how it works, not which files it was made with. The files that ARE theirs
  // (`macro_library.json`, an exported `*.wingstation.json`) are allowed.
  for (const [pattern, what] of IMPLEMENTATION_REFERENCES) {
    const hit = section.html.match(pattern);
    assert.ok(!hit, `${section.id} must not mention ${what} (found "${hit?.[0]}")`);
  }
}

// 3b. The author of the protocol documentation appears ONLY in the chapter 1 credits.
for (const section of sections) {
  if (section.id === 'start-here') continue;
  assert.ok(!/Maillot/i.test(section.html), `${section.id} must not name the protocol author outside the credits`);
}
assert.ok(
  /Maillot/i.test(sections[0].html),
  'the credits in chapter 1 must acknowledge the protocol documentation',
);

// 3b2. Nor internal identifiers: what the operator sees (the session log codes, the console meter
// names, the keys of the backup envelope) is allowed; what only exists inside the code,
// is not.
const ALLOWED_IDENTIFIERS = new Set([
  // Codes that appear literally in the session log.
  'action_blocked', 'action_completed', 'config_saved', 'hud_alert_ignored_after_panic',
  'library_imported', 'live_lock_blocked', 'live_macros_reapply_skipped_armed', 'live_start',
  'network_disconnected', 'panic_stop_requested', 'station_backup_export_cancelled',
  'station_backup_exported_successfully',
  'step_verify_failed', 'stream_error', 'stream_live',
  // Fields the operator reads inside those lines and in the frame inspector.
  'custom_meters', 'enabled_macros', 'trigger_hit',
  // Console meter names, exactly as they are chosen in the application.
  'inL', 'mon1_l', 'mon1_r', 'mon2_l', 'mon2_r', 'solo_l', 'solo_r',
  // Keys of the backup file the operator opens.
  'activeDraft', 'exportedAt', 'schemaVersion',
  // Units.
  'dB', 'dBFS',
]);
// `(?<![\w])` leaves out the pieces of a hexadecimal literal: `0xA7` is not the identifier `xA7`.
const IDENTIFIER = /(?<![\w])(?:[a-z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
for (const section of sections) {
  // The file names the operator does see (`macro_library.json`, a `.wingstation.json`) are removed
  // before looking for identifiers: their extension already gives them away.
  const codes = [...section.html.matchAll(/<code>([^<]+)<\/code>/g)]
    .flatMap((m) => m[1].replace(/\S+\.(?:json|wingstation|txt|md|js|mjs|csv)\b/g, ' ').match(IDENTIFIER) || []);
  const strays = [...new Set(codes.filter((token) => !ALLOWED_IDENTIFIERS.has(token)))];
  assert.deepEqual(strays, [], `${section.id} must not name internal identifiers: ${strays.join(', ')}`);
}

// 3c. The Markdown sources carry no implementation references either: otherwise the next
// regeneration would publish them.
for (const source of sources) {
  const text = fs.readFileSync(path.join(guideDir, source), 'utf8');
  for (const [pattern, what] of IMPLEMENTATION_REFERENCES) {
    const hit = text.match(pattern);
    assert.ok(!hit, `${source} must not mention ${what} (found "${hit?.[0]}")`);
  }
  if (source !== '01-start-here.md') {
    assert.ok(!/Maillot/i.test(text), `${source} must not name the protocol author outside the credits`);
  }
}

// 4. The window does not reveal how the application is built either: its visible TEXT is inspected
// (the `src` of the script that loads the content is mandatory and does not count).
const windowHtml = fs.readFileSync(path.join(repoRoot, 'desktop/ui/guide.html'), 'utf8');
const windowText = windowHtml
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ');
for (const [pattern, what] of [
  [/guide-content/, 'the generator or its output'],
  [/docs\/guide/, 'the Markdown sources'],
  [/scripts\//, 'a build script'],
  [/\.(?:mjs|rs)\b/, 'a source file'],
]) {
  const hit = windowText.match(pattern);
  assert.ok(!hit, `the guide window must not mention ${what} in its own text (found "${hit?.[0]}")`);
}

console.log(`guide content contracts passed (${sections.length} chapters, ${totalWords} words)`);
