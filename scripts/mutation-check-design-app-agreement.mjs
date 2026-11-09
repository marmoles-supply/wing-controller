// A mutation check for the design-agreement gate member: put each defect back, run
// `scripts/test-design-app-agreement-live.mjs` against it, and demand a failure that **names** the defect.
//
// "The gate is green" is worth very little on its own. What makes `test-design-app-agreement-live.mjs` worth
// something is that it goes **red** when the thing it describes is broken, with the window, the theme, the token and
// both values in the sentence. So this copies the live kit, the five windows and the application's allowance into
// `/tmp`, breaks one thing at a time, runs the gate member against that copy with `--root`, and reports one of:
//
//   caught         the gate member failed **and named this defect** — what we want
//   MISSED         it passed with the defect in place — the contract is toothless
//   UNEXPECTED     it failed, but for a reason other than this defect — investigate, do not ignore
//   COULD-NOT-RUN  it refused to measure (exit 3) where a real verdict was expected
//
// **It never touches the tracked tree.** Every mutation is applied to a fresh copy under `/tmp`, which is why this
// file can run while other programmes are editing the repository (the older `mutation-check-*.mjs` here restore the
// working tree from git and therefore refuse to run on a dirty tree; this one has nothing to restore). Each copy
// carries the marker below, and the run ends by grepping the **tracked** tree for that marker: the proof that the
// experiment stayed outside it is the grep, not the intention.
//
// Verdicts are reported, never blurred. The distinction matters most for `COULD-NOT-RUN`: a run that measured nothing
// is not a verdict on the contract, and the older harness in this repository once printed five MISSED when nothing had
// been measured at all.
//
// Run: node scripts/mutation-check-design-app-agreement.mjs
//      node scripts/mutation-check-design-app-agreement.mjs --self-test   (the classifier's own cases, no files)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CHECKER = join(REPO, 'scripts/test-design-app-agreement-live.mjs');
const WINDOWS = ['guide.html', 'index.html', 'ltc.html', 'meters.html', 'timecode.html'];
/// Stamped into every `/tmp` copy and grepped for in the tracked tree at the end. A marker the code itself would
/// print is found by one `grep`, which is the rule this project learned when a temporary edit to `macroHash` survived
/// a killed job and shipped ("An Experiment On A Tracked File Must Survive Being Killed").
const MARKER = 'MUTATION-DESIGN-AGREEMENT';

/// What a run's result means for one mutation. Pure, so it can be checked without touching a file — a classifier that
/// has silently changed its mind is how a mutation check lies.
export function classify(expect, expectCode, { code, output }) {
  if (code === expectCode && expect.test(output)) return { verdict: 'caught' };
  if (code === 0) {
    return { verdict: 'MISSED', why: `the gate member PASSED with the defect in place (exit 0): ${firstLine(output)}` };
  }
  if (code === 3 && expectCode !== 3) {
    return { verdict: 'COULD-NOT-RUN', why: `the gate member refused to measure (exit 3): ${firstLine(output)}` };
  }
  return {
    verdict: 'UNEXPECTED',
    why: `it exited ${code}, not ${expectCode}${expect.test(output) ? '' : `, and did not name the defect — it said: ${firstLine(output)}`}`,
  };
}

function firstLine(output) {
  const lines = String(output)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.find((line) => /disagree on|matched nothing|must declare|could not be read|no allowance file/.test(line)) || lines[0] || '').slice(0, 220);
}

/// A fresh copy of everything the gate member reads: the kit's canonical CSS, the five windows and the application's
/// allowance. A copy per mutation, so a mutation can never be measured against the previous one's leftovers.
function freshCopy() {
  const root = mkdtempSync(join(tmpdir(), 'wing-mutation-design-agreement-'));
  mkdirSync(join(root, 'design'), { recursive: true });
  mkdirSync(join(root, 'desktop/ui'), { recursive: true });
  copyFileSync(join(REPO, 'design/tokens.css'), join(root, 'design/tokens.css'));
  for (const file of WINDOWS) copyFileSync(join(REPO, 'desktop/ui', file), join(root, 'desktop/ui', file));
  copyFileSync(join(REPO, 'desktop/ui/allow.mjs'), join(root, 'desktop/ui/allow.mjs'));
  // The marker: this string lives only in a `/tmp` copy, and the tracked tree is grepped for it before this run is
  // allowed to call itself a proof.
  writeFileSync(join(root, 'MUTATION-MARKER.txt'), `${MARKER}\n`);
  return root;
}

/// Run the gate member against a copy, exactly as the gate would run it (a plain invocation, default allowance).
function runGate(root, script = CHECKER) {
  const run = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8', timeout: 120_000 });
  return { code: run.status, output: `${run.stdout || ''}\n${run.stderr || ''}` };
}

/// Replace exactly one string in one file, and refuse to call the mutation a measurement if the target was not there:
/// a stale mutation that silently changed nothing would be reported as MISSED and send the reader hunting a defect in
/// the contract that is really a defect in this file.
function replaceOnce(file, from, to) {
  const before = readFileSync(file, 'utf8');
  assert.ok(before.includes(from), `the mutation target ${JSON.stringify(from)} was not found in ${file} — this check is stale`);
  writeFileSync(file, before.replace(from, to));
}

/// How many times the marker appears anywhere under the tracked paths this run could have touched. `grep -c` per file
/// is the form the project asks for. The marker's one legitimate home is **this file**, which has to contain the
/// string to write it, so that single occurrence is excluded and reported separately: what the grep hunts is the
/// marker in any other tracked file, which would mean a copy of the experiment escaped `/tmp`.
function markerCounts() {
  const base = ['-r', '-c', MARKER, 'scripts', 'design', 'desktop/ui'];
  const collect = (run) => {
    const hits = String(run.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.endsWith(':0'));
    return { hits, total: hits.reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(':') + 1) || 0), 0) };
  };
  const everything = collect(spawnSync('grep', base, { cwd: REPO, encoding: 'utf8' }));
  const outside = collect(
    spawnSync('grep', [...base, '--exclude=mutation-check-design-app-agreement.mjs'], { cwd: REPO, encoding: 'utf8' }),
  );
  return { everything, outside };
}

const mutations = [
  {
    name: "a window's adopted token drifts (guide.html light --face)",
    expectCode: 1,
    expect: /desktop\/ui\/guide\.html \(light\): --face — the kit says #c0c0c0; :root here says #c0c0c1/,
    apply: (root) => replaceOnce(join(root, 'desktop/ui/guide.html'), '--face: #c0c0c0;', '--face: #c0c0c1;'),
  },
  {
    name: "a declared deviation's value moves (guide.html dark --ink), so the declaration stops matching",
    expectCode: 1,
    expect: /--ink — the kit says #e0e8e4; body\.theme-dark here says #123456[\s\S]*matched nothing: "#e6efeb"/,
    apply: (root) => replaceOnce(join(root, 'desktop/ui/guide.html'), '--ink: #e6efeb;', '--ink: #123456;'),
  },
  {
    name: "the kit's light theme disappears (design/tokens.css :root emptied)",
    expectCode: 1,
    expect: /the kit must declare its light theme/,
    apply: (root) => {
      const file = join(root, 'design/tokens.css');
      const css = readFileSync(file, 'utf8');
      const open = css.indexOf(':root {');
      const close = css.indexOf('}', open);
      writeFileSync(file, `${css.slice(0, open)}:root {\n${css.slice(close)}`);
    },
  },
  {
    name: "the application's allowance is not read by default (the 9c551963 gap, put back)",
    expectCode: 1,
    // Order-agnostic on purpose: the count is on stdout (the report) and the missing-file line follows it there, while
    // the "disagree on 11 point(s)" failure message is on stderr. Both are required, in whichever stream they land.
    expect: /^(?=[\s\S]*11 unexplained disagreement\(s\) · 0 declared)(?=[\s\S]*no allowance file at)/,
    evidence: '11 unexplained disagreement(s) · 0 declared',
    // The defect lived in the checker itself, so the checker is mutated too — it and its library module are copied to
    // `/tmp` with their relative layout, and the copy is run against the copy of the tree. Nothing tracked moves.
    apply: (_root, scratch) => {
      mkdirSync(join(scratch, 'scripts/lib'), { recursive: true });
      copyFileSync(CHECKER, join(scratch, 'scripts/test-design-app-agreement-live.mjs'));
      copyFileSync(join(REPO, 'scripts/lib/design-tokens.mjs'), join(scratch, 'scripts/lib/design-tokens.mjs'));
      replaceOnce(
        join(scratch, 'scripts/test-design-app-agreement-live.mjs'),
        "export const DEFAULT_ALLOW = 'desktop/ui/allow.mjs';",
        "export const DEFAULT_ALLOW = 'design/conformance/allow.mjs';",
      );
      return join(scratch, 'scripts/test-design-app-agreement-live.mjs');
    },
  },
  {
    name: 'the allowance cannot be read (a syntax error in desktop/ui/allow.mjs)',
    expectCode: 3,
    expect: /the allowance file could not be read/,
    apply: (root) => writeFileSync(join(root, 'desktop/ui/allow.mjs'), 'export default { deviations: [ this is not javascript\n'),
  },
];

// The classifier's own cases. They need no files and no tree, and they exist because a classifier that has quietly
// started calling an unmeasured run "caught" is the one way this whole check can lie.
if (process.argv.includes('--self-test')) {
  const cases = [
    ['fails and names the defect', /--face/, 1, { code: 1, output: 'guide.html (light): --face — the kit says #c0c0c0; :root here says #c0c0c1' }, 'caught'],
    ['passes with the defect in place', /--face/, 1, { code: 0, output: '0 unexplained disagreement(s) · 11 declared' }, 'MISSED'],
    ['refuses to measure where a verdict was expected', /--face/, 1, { code: 3, output: 'the allowance file could not be read' }, 'COULD-NOT-RUN'],
    ['fails for another reason', /--face/, 1, { code: 1, output: 'the kit must declare its light theme (found 0 tokens)' }, 'UNEXPECTED'],
    ['exits 3 where exit 3 is the contract', /could not be read/, 3, { code: 3, output: 'the allowance file could not be read' }, 'caught'],
  ];
  let failed = 0;
  for (const [name, expect, expectCode, result, want] of cases) {
    const got = classify(expect, expectCode, result).verdict;
    if (got !== want) failed += 1;
    console.log(`${got === want ? 'ok  ' : 'FAIL'} ${name}: expected ${want}, got ${got}`);
  }
  console.log(failed === 0 ? 'the classifier answers every case correctly' : `${failed} classifier case(s) wrong`);
  process.exit(failed === 0 ? 0 : 1);
}

assert.ok(existsSync(CHECKER), `the gate member must exist at ${CHECKER}`);
assert.ok(
  readFileSync(CHECKER, 'utf8').includes(`export const DEFAULT_ALLOW = 'desktop/ui/allow.mjs';`),
  'the live gate member must still carry the application allowance as its default, or the mutation below measures nothing',
);

const results = [];
const scratchRoot = mkdtempSync(join(tmpdir(), 'wing-mutation-design-agreement-'));
try {
  for (const mutation of mutations) {
    const root = freshCopy();
    const scratch = join(scratchRoot, mutation.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40));
    mkdirSync(scratch, { recursive: true });
    let script = CHECKER;
    try {
      const applied = mutation.apply(root, scratch);
      if (typeof applied === 'string') script = applied;
      const { code, output } = runGate(root, script);
      const verdict = classify(mutation.expect, mutation.expectCode, { code, output });
      const matched = (output.match(mutation.expect) || [''])[0];
      const named = mutation.evidence && output.includes(mutation.evidence)
        ? mutation.evidence
        : (matched.split('\n').filter(Boolean)[0] || '');
      results.push({ name: mutation.name, ...verdict, named });
    } catch (error) {
      results.push({ name: mutation.name, verdict: 'UNEXPECTED', why: String(error.message || error) });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}

const LABEL = { caught: 'caught      ', MISSED: 'MISSED      ', UNEXPECTED: 'UNEXPECTED  ', 'COULD-NOT-RUN': 'COULD-NOT-RUN' };
for (const result of results) {
  console.log(`${LABEL[result.verdict]}  ${result.name}${result.why ? ` — ${result.why}` : ''}`);
  if (result.named) console.log(`               → ${result.named}`);
}

// The tracked tree, grepped for this run's own marker: the experiments above happened under `/tmp`, and this is the
// measurement of that rather than the claim.
const marker = markerCounts();
console.log(
  marker.outside.total === 0
    ? `grep -r -c ${MARKER} scripts design desktop/ui → 0 outside this check` +
      ` (this check itself carries the marker ${marker.everything.total} time(s), which is where it has to live)`
    : `grep -r -c ${MARKER} scripts design desktop/ui → ${marker.outside.total} outside this check: ${marker.outside.hits.join(', ')}`,
);

const counts = results.reduce((tally, result) => ({ ...tally, [result.verdict]: (tally[result.verdict] || 0) + 1 }), {});
console.log(
  `${counts.caught || 0} caught of ${results.length}` +
  `${counts.MISSED ? `, ${counts.MISSED} missed (a contract that does not catch its defect)` : ''}` +
  `${counts.UNEXPECTED ? `, ${counts.UNEXPECTED} unexpected (it failed for another reason)` : ''}` +
  `${counts['COULD-NOT-RUN'] ? `, ${counts['COULD-NOT-RUN']} could not run (nothing was measured)` : ''}`,
);

const allCaught = results.every((result) => result.verdict === 'caught') && marker.outside.total === 0;
console.log(
  allCaught
    ? 'every defect put back is caught by the gate member, with the window, the theme, the token and both values named'
    : 'not every defect was shown to be caught — read the verdicts above',
);
process.exit(allCaught ? 0 : 1);
