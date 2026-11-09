// The acceptance test the roadmap writes for ITEM 5, verbatim:
//
//   "With three sample apps at versions `1.0.0`, `1.0.0` and `0.9.0`, the report names the one that is behind and
//    lists the deviations of each. Nothing to configure: it reads the declared files."
//
// So this test *builds* exactly that fleet - three plain-HTML sample apps, each with nothing but its own
// `design/conformance/allow.mjs` and a window to point at - and then asks `design/conformance/report.mjs` the
// dashboard question. If the report were reading a list of apps written into a test, or a tag in the filesystem,
// there would be nothing to find in a copy of the fleet made a second ago; the three declarations are the only
// input, which is what "nothing to configure" has to mean.
//
// It also pins the mechanisms around the report, because a dashboard that quietly rounds to "fine" is the failure
// this whole item exists to prevent: an app with no `kitVersion`, one that names a window that is not there, a
// deviation with no reason, and the two exit codes a caller can ask for.
//
// Run: node scripts/test-design-drift-report.mjs        (no browser: this is logic over declared files)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  behindPhrase,
  buildFleetReport,
  compareVersions,
  findAllowFiles,
  versionsBehind,
} from '../design/conformance/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT = resolve(HERE, '../design/conformance/report.mjs');
const ROOT = resolve(HERE, '..');

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok  ${name}`);
}

const temp = mkdtempSync(join(tmpdir(), 'wing-drift-report.'));
process.on('exit', () => { try { rmSync(temp, { recursive: true, force: true }); } catch (_) {} });

// ---------------------------------------------------------------------------
// The three sample apps, and the kit they were all taken from
// ---------------------------------------------------------------------------
/// The kit the samples declare. It is `1.0.0`, the same as the two current samples, and that is deliberate: the
/// roadmap's acceptance test says *one* app is behind, so the fleet in this test is the roadmap's fleet. The kit the
/// real consumers are measured against is `$ROOT/design/VERSION`, and `report.mjs --kit` is how a caller says which
/// copy is the authority - exactly the mechanism the real drift reading uses.
const SAMPLE_KIT_VERSION = '1.0.0';
const kitDir = join(temp, 'sample-kit');
mkdirSync(kitDir, { recursive: true });
writeFileSync(join(kitDir, 'VERSION'), `${SAMPLE_KIT_VERSION}\n`);

const SAMPLES = [
  {
    label: 'sample-app-a',
    kitVersion: '1.0.0',
    deviations: [],
  },
  {
    label: 'sample-app-b',
    kitVersion: '1.0.0',
    deviations: [
      { rule: 3, match: '#ff00ff', reason: 'the panic flash is magenta on purpose: it must be visible in both themes' },
    ],
  },
  {
    label: 'sample-app-c',
    kitVersion: '0.9.0',
    deviations: [
      { rule: 2, match: '42.5 dB', reason: 'the old meter well is kept until the desk is re-calibrated' },
      { rule: 1, match: 'div.legacy-panel', reason: 'the legacy panel predates the kit bevel and is scheduled for removal' },
    ],
  },
];

/// One sample app, made of the two things a consumer has: a window that links the kit, and the declaration that
/// says which kit it took. The declaration is the *fleet's* copy - a plain object - so this fixture cannot depend on
/// the repository's own allowance file drifting.
function writeSampleApp(sample) {
  const appDir = join(temp, sample.label);
  const conformanceDir = join(appDir, 'design', 'conformance');
  mkdirSync(conformanceDir, { recursive: true });
  writeFileSync(join(appDir, 'index.html'), [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${sample.label}</title>`,
    '<link rel="stylesheet" href="design/tokens.css">',
    '</head><body>',
    `<h1>${sample.label}</h1>`,
    '<div class="well"><span class="reading">42.5 dB</span></div>',
    '</body></html>',
    '',
  ].join('\n'));
  writeFileSync(join(appDir, 'design', 'tokens.css'), '/* the kit copy this sample took */\n:root { --face: #c0c0c0; }\n');
  const declaration = {
    app: sample.label,
    kitVersion: sample.kitVersion,
    allowApp: 'index.html',
    deviations: sample.deviations,
  };
  writeFileSync(join(conformanceDir, 'allow.mjs'), `export default ${JSON.stringify(declaration, null, 2)};\n`);
  return appDir;
}

for (const sample of SAMPLES) writeSampleApp(sample);

// ---------------------------------------------------------------------------
// The acceptance test itself
// ---------------------------------------------------------------------------
const report = await buildFleetReport({ root: temp, kitDir });

check('the report finds the three apps from their declared files alone', () => {
  assert.deepEqual(report.rows.map((row) => row.label).sort(), ['sample-app-a', 'sample-app-b', 'sample-app-c']);
  assert.equal(report.kitVersion, SAMPLE_KIT_VERSION);
  assert.equal(report.fleetVersion, '1.0.0');
});

check('the report names the one that is behind - 0.9.0 - and only that one', () => {
  assert.deepEqual(report.behind.map((row) => row.label), ['sample-app-c'],
    'the roadmap requires the report to name the one that is behind: sample-app-c (0.9.0), and no other app');
  const behind = report.rows.find((row) => row.label === 'sample-app-c');
  assert.equal(behind.behind, true);
  assert.equal(behind.behindPhrase, 'a major release behind (0 -> 1)',
    'how far behind has to name the release that is missing (0.9.0 is the last of the 0 line), not a decimal difference');
  for (const label of ['sample-app-a', 'sample-app-b']) {
    const row = report.rows.find((item) => item.label === label);
    assert.equal(row.behind, false, `${label} is at the newest declared version and must not be reported as behind`);
    assert.equal(row.behindPhrase, 'up to date');
  }
});

check('the report lists the deviations of each app, with their reasons', () => {
  const a = report.rows.find((row) => row.label === 'sample-app-a');
  const b = report.rows.find((row) => row.label === 'sample-app-b');
  const c = report.rows.find((row) => row.label === 'sample-app-c');
  assert.deepEqual(a.deviations.map((item) => item.match), [], 'the conforming sample declares no deviation');
  assert.deepEqual(b.deviations.map((item) => item.match), ['#ff00ff'],
    'the roadmap requires the report to list the deviations of each app: sample-app-b declares #ff00ff');
  assert.match(b.deviations[0].reason, /magenta on purpose/);
  assert.deepEqual(c.deviations.map((item) => item.match), ['42.5 dB', 'div.legacy-panel']);
  assert.deepEqual(c.deviations.map((item) => item.rule), [2, 1]);
  assert.match(c.deviations[1].reason, /legacy panel/);
});

check('the last conformance run is said to be never, not left blank', () => {
  for (const row of report.rows) {
    assert.equal(row.run.status, 'never', 'a sample that has never recorded a run must say so');
    assert.equal(row.run.last, null);
  }
});

// ---------------------------------------------------------------------------
// The same answer on the command line, and the two exit codes a caller can ask for
// ---------------------------------------------------------------------------
function cli(args) {
  try {
    const stdout = execFileSync('node', [REPORT, '--root', temp, '--kit', kitDir, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status === undefined ? -1 : error.status, stdout: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

const printed = cli([]);

check('the printed report names the app that is behind and carries every reason', () => {
  assert.equal(printed.code, 0, 'reading the fleet is not a failure; only an explicit --fail-on-* flag makes it one');
  assert.ok(printed.stdout.includes('sample-app-c'), 'the behind app must be named');
  assert.ok(printed.stdout.includes('0.9.0'), 'the version it built against must be named');
  assert.ok(printed.stdout.includes('a major release behind (0 -> 1)'), 'how far behind must name the missing release');
  assert.ok(printed.stdout.includes('BEHIND (1)'), 'the behind list must say how many it found');
  assert.ok(!printed.stdout.includes('BEHIND (2)'), 'only one app is behind in this fleet');
  assert.ok(printed.stdout.includes('the panic flash is magenta on purpose'), 'a declared deviation must be reported as declared');
  assert.ok(printed.stdout.includes('the old meter well is kept until the desk is re-calibrated'), 'and with its reason');
  assert.ok(printed.stdout.includes('last conformance run'), 'the fifth column of the roadmap must be there');
  assert.ok(printed.stdout.includes('never'), 'a run that was never recorded must say so');
  assert.ok(printed.stdout.includes('kit version'), 'the second column of the roadmap must be there');
});

check('--json prints the same reading as a machine-readable report', () => {
  const json = cli(['--json']);
  assert.equal(json.code, 0);
  const parsed = JSON.parse(json.stdout);
  assert.deepEqual(parsed.behind.map((row) => row.label), ['sample-app-c']);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.fleetVersion, '1.0.0');
});

check('--fail-on-behind exits 1 exactly when something is behind, and the plain report exits 0', () => {
  assert.equal(printed.code, 0);
  const failed = cli(['--fail-on-behind']);
  assert.equal(failed.code, 1, 'a caller asking to be failed on drift must be failed');
  assert.ok(failed.stdout.includes('DRIFT REPORT FAILED'), 'the failure must say what it found');
});

// ---------------------------------------------------------------------------
// What the report refuses to be quiet about
// ---------------------------------------------------------------------------
{
  const appDir = join(temp, 'sample-app-d');
  const conformanceDir = join(appDir, 'design', 'conformance');
  mkdirSync(conformanceDir, { recursive: true });
  writeFileSync(join(appDir, 'index.html'), '<!doctype html><html><body><h1>d</h1></body></html>\n');
  writeFileSync(join(conformanceDir, 'allow.mjs'), `export default ${JSON.stringify({
    app: 'sample-app-d',
    allowApp: 'window-that-is-not-there.html',
    deviations: [{ rule: 3, match: '#123456' }],
  }, null, 2)};\n`);

  const withMissing = await buildFleetReport({ root: temp, kitDir });
  check('an app with no kitVersion, a window that is not there, and no reason is reported, not skipped', () => {
    const row = withMissing.rows.find((item) => item.label === 'sample-app-d');
    assert.ok(row, 'an app whose declaration is incomplete is still a row of the fleet');
    assert.equal(row.kitVersion, null);
    assert.equal(row.behindPhrase, 'unknown (no kitVersion declared)');
    assert.ok(row.problems.some((problem) => problem.includes('no kitVersion')), 'the missing version must be named');
    assert.ok(row.problems.some((problem) => problem.includes('does not exist')), 'the missing window must be named');
    assert.ok(row.problems.some((problem) => problem.includes('no reason')), 'the reasonless deviation must be named');
    assert.deepEqual(withMissing.undeclared.map((item) => item.label), ['sample-app-d']);
  });

  check('--fail-on-missing-declaration exits 1 on that app, and 0 once it declares itself', () => {
    const failed = cli(['--fail-on-missing-declaration']);
    assert.equal(failed.code, 1, 'an incomplete declaration must be able to fail a caller that asked');
    assert.ok(failed.stdout.includes('sample-app-d'));
    writeFileSync(join(conformanceDir, 'allow.mjs'), `export default ${JSON.stringify({
      app: 'sample-app-d',
      kitVersion: '1.0.0',
      allowApp: 'index.html',
      deviations: [],
    }, null, 2)};\n`);
    const clean = cli(['--fail-on-missing-declaration']);
    assert.equal(clean.code, 0, 'a fully declared app must not fail the same caller');
  });
}

// ---------------------------------------------------------------------------
// An application that declares itself where applications keep it: beside the kit copy it shipped
// ---------------------------------------------------------------------------
{
  // This is the shape the repository's own application has, and the shape the dashboard could not see: the window
  // folder carries the copy of the kit it ships (`design-tokens.css`) and declares its deviations in an `allow.mjs`
  // next to it (`desktop/ui/allow.mjs`). A bare `allow.mjs` with no copy of the kit beside it is not a declaration,
  // and a walk that read it would invent a fleet row out of any file of that name.
  const besideDir = join(temp, 'sample-app-e');
  mkdirSync(besideDir, { recursive: true });
  writeFileSync(join(besideDir, 'design-tokens.css'), '/* the copy of the kit this app ships */\n:root { --face: #c0c0c0; }\n');
  writeFileSync(join(besideDir, 'index.html'), '<!doctype html><html><body><h1>e</h1></body></html>\n');
  writeFileSync(join(besideDir, 'allow.mjs'), `export default ${JSON.stringify({
    app: 'sample-app-e',
    kitVersion: '1.0.0',
    allowApp: 'index.html',
    deviations: [
      { rule: 4, match: '#abcdef', reason: 'the legacy card keeps the pre-kit surface until the redesign lands' },
    ],
  }, null, 2)};\n`);
  const decoyDir = join(temp, 'decoy');
  mkdirSync(decoyDir, { recursive: true });
  writeFileSync(join(decoyDir, 'allow.mjs'), `export default ${JSON.stringify({
    app: 'decoy',
    kitVersion: '1.0.0',
    allowApp: 'index.html',
    deviations: [],
  }, null, 2)};\n`);

  const withBeside = await buildFleetReport({ root: temp, kitDir });
  check('an allow.mjs beside the shipped kit copy is an app row, and a bare allow.mjs is not', () => {
    const row = withBeside.rows.find((item) => item.label === 'sample-app-e');
    assert.ok(
      row,
      'an app that keeps its declaration in its window folder, beside the design-tokens.css it shipped, must be found: ' +
      'that is where this repository keeps desktop/ui/allow.mjs, and without this home the dashboard found only the kit',
    );
    assert.equal(row.kitVersion, '1.0.0', 'the row must carry the declared kitVersion');
    assert.deepEqual(row.deviations.map((item) => item.match), ['#abcdef'], 'the row must carry its declared deviations');
    assert.match(row.deviations[0].reason, /legacy card/, 'and their reasons');
    assert.ok(
      !withBeside.rows.some((item) => item.label === 'decoy'),
      'a bare allow.mjs with no copy of the kit beside it is not an application declaration and must not invent a row',
    );
    assert.ok(
      findAllowFiles(temp).includes(join(besideDir, 'allow.mjs')),
      'the discovery walk must find the beside-the-copy home',
    );
    assert.ok(
      !findAllowFiles(temp).includes(join(decoyDir, 'allow.mjs')),
      'the discovery walk must not find a bare allow.mjs',
    );
    // The classic homes still work, and the walk no longer stops at the first one it meets: `sample-app-a`'s
    // `design/conformance/allow.mjs` is found, and so is the beside-the-copy one under a different directory.
    assert.ok(findAllowFiles(temp).includes(join(temp, 'sample-app-a', 'design', 'conformance', 'allow.mjs')));
  });
}

// ---------------------------------------------------------------------------
// The version arithmetic, pinned on its own so a wrong comparison names itself
// ---------------------------------------------------------------------------
check('versions compare numerically, not as text', () => {
  assert.equal(compareVersions('1.0.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.9.0', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.1', '1.0.1'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1, '10 is greater than 9, and string comparison says otherwise');
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

check('how far behind is a count of releases, and a newer version is never behind', () => {
  assert.deepEqual(versionsBehind('0.9.0', '1.0.0'), { releases: 1, level: 'major', from: '0', to: '1' });
  assert.deepEqual(versionsBehind('1.0.0', '1.1.0'), { releases: 1, level: 'minor', from: '1.0', to: '1.1' });
  assert.deepEqual(versionsBehind('1.0.0', '1.0.1'), { releases: 1, level: 'patch', from: '1.0.0', to: '1.0.1' });
  assert.deepEqual(versionsBehind('1.0.0', '2.0.0'), { releases: 1, level: 'major', from: '1', to: '2' });
  assert.deepEqual(versionsBehind('1.0.0', '1.0.3'), { releases: 3, level: 'patch', from: '1.0.0', to: '1.0.3' });
  assert.equal(versionsBehind('1.0.1', '1.0.1'), 0, 'equal versions are 0 releases behind');
  assert.equal(versionsBehind('1.1.0', '1.0.1'), 0, 'an app ahead of the fleet is not behind it');
  // The distinction that bugged this out on its first run: `0` is a real answer, and it must not read as "unknown".
  assert.equal(behindPhrase(0), 'up to date');
  assert.equal(behindPhrase(null), 'unknown (no kitVersion declared)');
});

// ---------------------------------------------------------------------------
// The real fleet, read as it stands today (reported, never asserted: the tree is allowed to change)
// ---------------------------------------------------------------------------
{
  const real = cli(['--root', ROOT, '--kit', resolve(ROOT, 'design')]);
  assert.equal(real.code, 0, 'reading the repository\'s own fleet must not fail');
  assert.ok(real.stdout.includes('WING CONTROLLER · design-system drift'));
  const realReport = await buildFleetReport({ root: ROOT, kitDir: resolve(ROOT, 'design') });
  check('the repository\'s own fleet is two rows: the kit\'s declaration and the application\'s', () => {
    const appRow = realReport.rows.find((row) => row.allowPath.endsWith(join('desktop', 'ui', 'allow.mjs')));
    assert.ok(
      appRow,
      'the application\'s allowance (desktop/ui/allow.mjs, beside the design-tokens.css it ships) must be a row: ' +
      `before the discovery fix this dashboard found only the kit's own. Rows: ${JSON.stringify(realReport.rows.map((row) => row.label))}`,
    );
    assert.ok(
      appRow.kitVersion,
      'the application row must carry its declared kitVersion, or "who is behind and in what" cannot be answered',
    );
    assert.ok(
      realReport.rows.some((row) => row.allowPath.endsWith(join('design', 'conformance', 'allow.mjs'))),
      'the kit\'s own declaration must stay a row: the fix widens discovery, it does not replace a home',
    );
    assert.ok(
      realReport.rows.length >= 2,
      `this repository holds two declarations and both must be found; got ${realReport.rows.length}`,
    );
    // The printed dashboard, not only the object: the definition of done is about the row a reader sees.
    assert.ok(real.stdout.includes('apps found:'), 'the printed report must state how many declarations it found');
    assert.ok(real.stdout.includes(appRow.label), 'the application must be named in the printed table');
    assert.ok(real.stdout.includes(appRow.kitVersion), 'the application\'s kit version must be printed');
  });
  console.log('');
  console.log('--- what the dashboard says about this repository today ---');
  console.log(real.stdout.replace(/\n+$/, ''));
  console.log('--- end of the live reading ---');
}

console.log('');
console.log(`design drift report: ${checks} checks passed`);
