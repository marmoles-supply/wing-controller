// A small runner for the cue UI mutations, used while landing the interface pieces. It is NOT part of the gate (it is
// not named `test-*.mjs`), it does NOT run `verify-all.sh`, and it restores each file from an in-memory copy after
// every mutation, so it cannot leave a mutated tree behind. It drives **one** suite per mutation against a private
// headless Chrome on `WING_CHROME_PORT`, which is what makes a verdict fast enough to land a piece at a time.
//
// Usage: WING_CHROME_PORT=9224 node scripts/probe-cue-mutations.mjs [--only M10,M15]
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from "node:path";

const ROOT = dirname(import.meta.dirname);
const CUE = 'desktop/ui/cue-list.js';
const INDEX = 'desktop/ui/index.html';
const CLOCK = 'desktop/ui/timecode.html';

const MUTATIONS = [
  {
    id: 'M11', file: CUE, suite: 'scripts/test-desktop-settings-tabs-browser.mjs',
    what: "the snapshot's own spent kind is ignored (a late window paints the neutral mark)",
    from: '      if (Array.isArray(snapshot?.spent_cues)) {',
    to: '      if (false) { // MUTATION: the spent kind from the snapshot is ignored',
    snippet: "the snapshot's own kind paints the row",
  },
  {
    id: 'M12', file: CUE, suite: 'scripts/test-desktop-settings-tabs-browser.mjs',
    what: 'a cue that cannot fire what it names is not marked',
    from: '      if (Array.isArray(snapshot?.cue_health)) {',
    to: '      if (false) { // MUTATION: the broken-cue mark is never painted',
    snippet: 'cannot fire what it names is marked',
  },
  {
    id: 'M18', file: CLOCK, suite: 'scripts/test-desktop-timecode-clock-browser.mjs',
    what: 'the window never says out loud that the frame refused to grow',
    from: '      const text = fit ? fitSentence(fit) : "";\n      if (line.textContent !== text) line.textContent = text;\n      line.hidden = !text;',
    to: '      const text = fit ? fitSentence(fit) : "";\n      if (line.textContent !== text) line.textContent = text;\n      line.hidden = true; // MUTATION: the sentence is never shown',
    snippet: 'says out loud that it did not grow',
  },
  {
    id: 'M19', file: INDEX, suite: 'scripts/test-desktop-station-backup-dialog-browser.mjs',
    what: 'the cue list is declared in the backup but never put into it',
    from: '            payload.data.cues = { list: cueList };',
    to: '            // MUTATION: the declared section is not carried',
    snippet: 'and the app accepts what it wrote',
  },
  {
    id: 'M10', file: CUE, suite: 'scripts/test-desktop-settings-tabs-browser.mjs',
    what: 'the shared module offers a name box for a cue list that carries no `label`',
    from: '    return typeof cue?.label === "string";',
    to: '    return true; // MUTATION: a name box the next read would drop',
    snippet: 'must not put a name box',
  },
  {
    id: 'M13', file: INDEX, suite: 'scripts/test-desktop-settings-tabs-browser.mjs',
    what: 'the macro library length is reported as zero (every named macro looks missing)',
    from: '        const count = Array.isArray(macroLibrary?.macros) ? macroLibrary.macros.length : 0;',
    to: '        const count = 0; // MUTATION: the library length is reported as zero',
    snippet: 'must report its library length',
  },
  {
    id: 'M14', file: INDEX, suite: 'scripts/test-desktop-settings-tabs-browser.mjs',
    what: 'a typed position is ignored (the cue lands where the show is now)',
    from: '        const typed = String(field?.value || "").trim();',
    to: '        const typed = ""; // MUTATION: the typed position is ignored',
    snippet: "a typed position goes to the backend's parser",
  },
  {
    id: 'M15', file: CUE, suite: 'scripts/test-desktop-settings-tabs-browser.mjs',
    what: 'a duplicated cue keeps the name and the number of the cue it copied',
    from: '      copy.number = "";',
    to: '      copy.number = "99";',
    snippet: 'the copy starts with no number',
  },
  {
    id: 'M16', file: CLOCK, suite: 'scripts/test-desktop-timecode-clock-browser.mjs',
    what: 'the frame is read once and never re-read after its resize event (a stale measurement is taken for the result)',
    from: '        box = (await frameBox()) || box;',
    to: '        // MUTATION: the frame is never re-read after its own resize event',
    snippet: "and folding compares the frame's own answer with what it asked for",
  },
  {
    id: 'M17', file: CLOCK, suite: 'scripts/test-desktop-timecode-clock-browser.mjs',
    what: 'the comparison never reads the frame (`grew` is hard-coded true)',
    from: '        grew: actual !== null && Math.abs(actual - wanted) <= 1,',
    to: '        grew: true, // MUTATION: the comparison is skipped',
    snippet: 'does not claim the frame gave it',
  },
];

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const selected = MUTATIONS.filter((entry) => !only || only.includes(entry.id));

const backups = new Map();
for (const file of [CUE, INDEX, CLOCK]) backups.set(file, readFileSync(`${ROOT}/${file}`, 'utf8'));
const restoreAll = () => { for (const [file, text] of backups) writeFileSync(`${ROOT}/${file}`, text); };

const results = [];
for (const mutation of selected) {
  const path = `${ROOT}/${mutation.file}`;
  const before = readFileSync(path, 'utf8');
  const occurrences = before.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    results.push({ id: mutation.id, verdict: `COULD-NOT-RUN (anchor x${occurrences})` });
    continue;
  }
  writeFileSync(path, before.replace(mutation.from, mutation.to));
  const run = spawnSync('node', [mutation.suite], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, WING_CHROME_PORT: process.env.WING_CHROME_PORT || '9224' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  restoreAll();
  const passed = output.includes('WING_BROWSER_SUITE_OK');
  const named = output.includes(mutation.snippet);
  const assertion = (output.match(/AssertionError[^\n]*/) || [''])[0];
  let verdict;
  if (passed) verdict = 'MISSED (the suite passed with the defect in place)';
  else if (named) verdict = 'caught';
  else verdict = 'UNEXPECTED';
  results.push({ id: mutation.id, verdict, what: mutation.what, assertion: assertion.slice(0, 180) });
  console.log(`${mutation.id} ${verdict} :: ${mutation.what}`);
  if (assertion) console.log(`    ${assertion.slice(0, 180)}`);
}
restoreAll();
console.log('\n==== summary ====');
for (const entry of results) console.log(`${entry.id.padEnd(5)} ${entry.verdict}`);
writeFileSync('/tmp/probe-cue-mutations.json', JSON.stringify(results, null, 2));
