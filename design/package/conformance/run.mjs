// `run.mjs` — the conformance suite's command line, and the report an agent reads when it goes red.
//
//   node design/conformance/run.mjs --app <path-or-url> [--theme light|dark|both] [--allow <file>] [--port 9223]
//                                   [--record [<run.json>]] [--require-all-rules]
//
// Exit codes: 0 every rule ran and nothing failed; 1 at least one failure; 2 the command line is wrong; 3 nothing was
// measured (no browser, the page would not load, the kit copy could not be read). The three are kept apart because
// this project has already paid for a "skipped" that the gate booked as green.
//
// The report is written for an agent that cannot see the screen: every failure names the element, the measured value
// and the rule, in the operator's words, and says what to do.
//
// Every rendering is laid out in the suite's **own declared viewport** (`collect.mjs` `VIEWPORT`, 756x469), forced on
// the tab with `Emulation.setDeviceMetricsOverride` before a page is loaded, so a browser reused from another session
// cannot change what the rules judge. The report names the viewport it used, next to the browser it used.
//
// `--record` is the one thing this command *writes*: the run's outcome, beside the app's allowance
// (`design/conformance/run.json`, or the path given), where `design/conformance/report.mjs` reads it for the
// dashboard's `last conformance run` column. It is opt-in so a hand run cannot overwrite a real record by accident,
// and it is recorded even when the run failed — "last run: exit 1" is exactly what the dashboard exists to show.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ANIMATION_SETTLE_MS,
  ensureBrowser,
  gatherReferences,
  kitDirOfThisCopy,
  navigate,
  observe,
  observeAtScale,
  openTab,
  resolveAppUrl,
  VIEWPORT,
} from './collect.mjs';
import { CONFORMANCE_RUN_FILE, recordRun } from './report.mjs';
import { analyse, kitPalette, parseKitTokens, summarise } from './rules.mjs';

export const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url));
export const KIT_DIR = kitDirOfThisCopy();
export const DEFAULT_ALLOW = join(CONFORMANCE_DIR, 'allow.mjs');

const THEMES = ['both', 'light', 'dark'];

function normaliseMatch(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, '');
}

async function readAllow(allowPath) {
  if (!existsSync(allowPath)) {
    return { error: `the app allowance file does not exist: ${allowPath}` };
  }
  try {
    const module = await import(pathToFileURL(allowPath).href + `?t=${Date.now()}`);
    const value = module.default || {};
    return {
      kitVersion: value.kitVersion === undefined ? null : String(value.kitVersion).trim(),
      deviations: Array.isArray(value.deviations) ? value.deviations : [],
      path: allowPath,
    };
  } catch (error) {
    return { error: `the app allowance file could not be read: ${error.message}` };
  }
}

function readKit() {
  const cssPath = join(KIT_DIR, 'tokens.css');
  if (!existsSync(cssPath)) return { error: `the kit copy beside this suite has no tokens.css (${cssPath})` };
  const kit = parseKitTokens(readFileSync(cssPath, 'utf8'));
  if (!kit.names.size) return { error: `the kit copy beside this suite declares no tokens (${cssPath})` };
  const versionPath = join(KIT_DIR, 'VERSION');
  const version = existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : null;
  return { kit, palette: kitPalette(kit), version, cssPath };
}

/// Turn the allowance list into the report's own vocabulary: an undeclared failure is a failure, a declared one is
/// reported as declared with its reason, and a declaration that matched nothing is named so it does not rot.
function applyAllow(findings, deviations) {
  const used = new Set();
  for (const item of findings) {
    if (item.severity !== 'fail') continue;
    const haystack = normaliseMatch([
      item.code, item.element, item.path, item.measured,
      ...(item.spellings || []),
    ].join(' | '));
    for (let index = 0; index < deviations.length; index += 1) {
      const deviation = deviations[index] || {};
      // An explanation printed beside a suppressed failure is not validation. An invalid
      // declaration must leave the finding red as well as fail the declaration preflight.
      if (typeof deviation.reason !== 'string' || !deviation.reason.trim()) continue;
      if (deviation.rule !== undefined && String(deviation.rule) !== String(item.rule)) continue;
      const needle = normaliseMatch(deviation.match);
      if (!needle || !haystack.includes(needle)) continue;
      item.severity = 'declared';
      item.reason = deviation.reason.trim();
      used.add(index);
      break;
    }
  }
  const unused = deviations
    .map((deviation, index) => ({ deviation, index }))
    .filter(({ index }) => !used.has(index));
  return { unused };
}

export function declarationProblems(allow, version) {
  const problems = [];
  if (typeof version !== 'string' || !version.trim()) problems.push('the kit has no VERSION; its provenance cannot be verified');
  if (typeof allow.kitVersion !== 'string' || !allow.kitVersion.trim()) problems.push('the app must declare kitVersion before it can be verified');
  for (const [index, deviation] of (allow.deviations || []).entries()) {
    if (typeof deviation?.reason !== 'string' || !deviation.reason.trim()) {
      problems.push(`deviation ${index + 1} has no non-empty reason`);
    }
    if (typeof deviation?.match !== 'string' || !deviation.match.trim()) {
      problems.push(`deviation ${index + 1} has no non-empty match`);
    }
  }
  return problems;
}

/// Run every rule against one app. Returns the findings and the exit code; printing is the CLI's job, so the
/// self-test can assert on the same result object.
export async function runConformance(options = {}) {
  const app = options.app;
  const theme = options.theme || 'both';
  const port = Number(options.port || process.env.WING_CHROME_PORT || 9223);
  const allowPath = options.allowPath ? resolve(options.allowPath) : DEFAULT_ALLOW;
  const result = {
    app, theme, port,
    code: 0, failReason: null,
    findings: [], preflight: [], results: [], notes: [],
    snapshots: {}, kitVersion: null, declaredKitVersion: null, allowPath,
    viewport: VIEWPORT,
  };
  if (!THEMES.includes(theme)) {
    result.code = 2; result.failReason = `--theme must be one of ${THEMES.join(', ')}`;
    return result;
  }
  if (!app) {
    result.code = 2; result.failReason = '--app is required';
    return result;
  }
  const appUrl = resolveAppUrl(app, options.cwd);
  result.appUrl = appUrl;
  // A file the browser cannot open is not a verdict on the app: it is a run that did not happen. (Measured: without
  // this, Chrome's own error page was observed as a page and reported as nine failed checks.)
  if (appUrl.startsWith('file:')) {
    if (!existsSync(fileURLToPath(appUrl))) {
      result.code = 3;
      result.failReason = `the page does not exist: ${fileURLToPath(appUrl)}`;
      return result;
    }
  }

  const kit = readKit();
  if (kit.error) { result.code = 3; result.failReason = kit.error; return result; }
  result.kitVersion = kit.version;

  const allow = await readAllow(allowPath);
  if (allow.error) { result.code = 3; result.failReason = allow.error; return result; }
  result.declaredKitVersion = allow.kitVersion;
  for (const problem of declarationProblems(allow, kit.version)) {
    result.preflight.push({
      rule: 0, code: 'invalid-declaration', element: 'the app allowance', path: allowPath,
      measured: problem, kitSays: 'version and justified exceptions are mandatory',
      fix: 'complete the declaration; do not silence the visual finding', severity: 'fail', spellings: [],
    });
  }

  // Preflight: the app's declared kit version against the copy of the kit that sits beside this suite.
  if (!kit.version) {
    result.notes.push('the kit copy has no design/VERSION, so the drift check could not run');
  } else if (!allow.kitVersion) {
    result.notes.push(`the app declares no kitVersion in ${allowPath.split('/').pop()}, so the drift check could not run`);
  } else if (allow.kitVersion !== kit.version) {
    result.preflight.push({
      rule: 0, code: 'kit-version', element: 'the app allowance', path: '',
      measured: `the app declares kit ${allow.kitVersion} and the kit copy beside it is ${kit.version}`,
      kitSays: 'a copy of the kit declares the version it took, so a copy from two versions is caught rather than aged invisibly',
      fix: 're-copy the whole design/ directory and set kitVersion to the version you copied',
      severity: 'fail', spellings: [allow.kitVersion, kit.version],
    });
  } else {
    result.preflight.push({
      rule: 0, code: 'kit-version-ok', element: 'the app allowance', path: '',
      measured: `the app declares kit ${allow.kitVersion}, the same as the copy beside it`,
      kitSays: 'the declaration and the copy agree', fix: '', severity: 'note', spellings: [],
    });
  }

  const browser = await ensureBrowser(port);
  if (!browser.alive) {
    result.code = 3;
    result.failReason = browser.reason || 'no browser is answering the debug port and none could be started';
    return result;
  }
  result.browserOwn = browser.own;
  let tab = null;
  try {
    tab = await openTab(port);
    await navigate(tab, appUrl);
    const wanted = theme === 'both' ? ['light', 'dark'] : [theme];
    for (const name of wanted) {
      result.snapshots[name] = await observe(tab, name);
    }
    // Rule 8's second reading, and the only reason this suite renders a page more than twice: a single-size
    // photograph cannot see a renamed ramp, and a proportion can (`DESIGN-SYSTEM-ROADMAP.md` §4j). The knob is forced
    // to the kit's base and then raised, and every text must follow it in the kit's own proportion. It is taken in
    // the first theme rendered — the kit's type scale is the same in both (`body.theme-dark` re-declares no
    // `--font-*`) — and a page whose type differs per theme is still caught by the first check, which runs in both.
    const scaleTheme = wanted[0];
    try {
      const atOne = await observeAtScale(tab, scaleTheme, 1);
      const atOnePointFive = await observeAtScale(tab, scaleTheme, 1.5);
      result.typeControl = { atOne, atOnePointFive, theme: scaleTheme };
      for (const name of wanted) result.snapshots[name].typeControl = result.typeControl;
    } catch (error) {
      // The two renderings the rule runs on did not both happen, so it reports NOT RUN rather than judging one of
      // them — and the run says why, instead of a rule quietly passing on half its evidence.
      result.notes.push(
        `the type scale could not be read a second time at a changed --meter-scale (${error.message}): ` +
        'rule 8 reports NOT RUN rather than judging a single rendering',
      );
    }
    // Every rendering is taken after the page's animations were allowed to settle; when that wait ran out of its
    // bound, the reading is one instant of a page still in motion and a count read from it is a sample rather than
    // the page's value. Said out loud here rather than left in a field nobody prints (see `settleAnimations`).
    const unsettled = [];
    const noteSettle = (label, observation) => {
      const settle = observation && observation.animationSettle;
      if (!settle || !settle.timedOut) return;
      unsettled.push(
        `${label}: ${settle.running} animation(s) still running after ${settle.waitedMs} ms` +
        (settle.neverEnding ? `, ${settle.neverEnding} of them never-ending` : ''),
      );
    };
    for (const name of wanted) noteSettle(name, result.snapshots[name]);
    if (result.typeControl) {
      noteSettle('--meter-scale 1', result.typeControl.atOne);
      noteSettle('--meter-scale 1.5', result.typeControl.atOnePointFive);
    }
    if (unsettled.length) {
      result.notes.push(
        `the page was still animating when it was sampled, so this reading is one instant of it (the settle is bounded ` +
        `at ${ANIMATION_SETTLE_MS} ms, and an animation that never finishes cannot settle): ${unsettled.join(' · ')}`,
      );
    }
  } catch (error) {
    result.code = 3;
    result.failReason = error.message;
    return result;
  } finally {
    if (tab) tab.close();
    browser.close();
  }

  const primary = result.snapshots.light || result.snapshots.dark;
  const references = await gatherReferences(primary, KIT_DIR);
  result.notes.push(...references.notes);

  const analysis = analyse({
    kit: kit.kit,
    palette: kit.palette,
    snapshots: result.snapshots,
    references: references.references,
    declaredTokens: references.declaredTokens,
  });
  const findings = analysis.findings;
  const { unused } = applyAllow(findings, allow.deviations);
  for (const { deviation } of unused) {
    result.notes.push(
      `a declared deviation matched nothing: ${JSON.stringify(deviation.match)}` +
      (deviation.reason ? ` (${deviation.reason})` : ''),
    );
  }

  result.findings = findings;
  result.stats = analysis.stats;
  result.results = summarise(findings, analysis.stats);
  const failures = findings.filter((item) => item.severity === 'fail');
  const preflightFailures = result.preflight.filter((item) => item.severity === 'fail');
  const notChecked = result.results.filter((rule) => rule.status === 'not-checked' || rule.status === 'not-run');
  result.code = failures.length || preflightFailures.length ? 1 : 0;
  if (result.code === 0 && options.requireAllRules && notChecked.length) {
    result.code = 1;
    result.failReason = `--require-all-rules: ${notChecked.map((rule) => `rule ${rule.rule} (${rule.status})`).join(', ')}`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------
function pad(label) {
  return label.length >= 9 ? label : label + ' '.repeat(9 - label.length);
}

function printFinding(item, out) {
  out(`  FAIL · rule ${item.rule} · ${item.code}`);
  out(`      element:  ${item.element}${item.path ? `   (${item.path})` : ''}`);
  out(`      measured: ${item.measured}`);
  out(`      the kit:  ${item.kitSays}`);
  if (item.fix) out(`      fix:      ${item.fix}`);
}

export function printReport(result, out = console.log) {
  out('');
  out('WING CONTROLLER · design-system conformance');
  out(`  app:      ${result.appUrl || result.app}`);
  // "(not read)", not "unreadable": the kit is read *after* the two early returns (no `--app`, and a page that cannot
  // be opened), so on those paths this label used to claim a file it had never opened. A run that did not read the
  // kit must not say the kit could not be read — this project's own rule about reports that lie. (Corrected
  // 2026-10-08 while proving that a consumer's unpacked copy of this suite reads the `VERSION` beside it.)
  out(`  kit:      ${result.kitVersion ? `design/VERSION ${result.kitVersion}` : 'design/VERSION (not read)'}` +
    ` · declared by the app: ${result.declaredKitVersion || '(not declared)'}`);
  out(`  themes:   ${result.theme} (${Object.keys(result.snapshots).join(', ') || 'none rendered'})`);
  out(`  browser:  ${result.browserOwn === undefined ? 'none' : (result.browserOwn ? 'started by the suite' : 'reused on the debug port')}`);
  // The width every rule judged, said in the report a reader actually keeps. It is a declared constant (`collect.mjs`
  // `VIEWPORT`) forced on the tab before a page is loaded, so a reported `viewport width` that is not this number would
  // be a defect in the suite rather than a different browser: printing both is what lets a reader tell them apart.
  out(`  viewport: ${result.viewport ? `${result.viewport.width}x${result.viewport.height}` : '(not declared)'}` +
    ' (declared by the suite and forced on the tab; see collect.mjs VIEWPORT for why it is not inherited)');

  if (result.failReason) out(`  could not run: ${result.failReason}`);

  if (result.preflight.length) {
    out('');
    out('PREFLIGHT · the copy of the kit');
    for (const item of result.preflight) {
      if (item.severity === 'fail') { printFinding(item, out); continue; }
      out(`  ok       ${item.measured}`);
    }
  }

  out('');
  for (const rule of result.results) {
    out(`RULE ${rule.rule} · ${rule.title}`);
    if (rule.status === 'fail') {
      out(`  ${pad('FAILED')} ${rule.failures.length} finding(s) — see the failure list below`);
    } else if (rule.status === 'declared') {
      out(`  ${pad('DECLARED')} ${rule.declared.length} declared deviation(s)`);
      for (const item of rule.declared) out(`             · ${item.element}: ${item.reason}`);
    } else if (rule.status === 'not-checked') {
      out(`  ${pad('NOT CHECKED')} ${rule.notes[0] ? rule.notes[0].measured : ''}`);
      out('             the suite says so rather than passing for the wrong reason (see the README)');
    } else if (rule.status === 'not-run') {
      out(`  ${pad('NOT RUN')} ${rule.notes[0] ? rule.notes[0].measured : ''}`);
    } else {
      const stats = rule.stats
        ? Object.entries(rule.stats).map(([name, count]) => `${name} ${count}`).join(' · ')
        : '';
      out(`  ${pad('PASS')} ${stats ? `checked ${stats}` : 'nothing in this rendering broke it'}`);
    }
  }

  const failures = result.findings.filter((item) => item.severity === 'fail');
  const preflightFailures = result.preflight.filter((item) => item.severity === 'fail');
  if (failures.length || preflightFailures.length) {
    out('');
    out(`FAILURES (${failures.length + preflightFailures.length})`);
    for (const item of preflightFailures) printFinding(item, out);
    for (const item of failures) printFinding(item, out);
  }

  if (result.notes.length) {
    out('');
    out('NOTES (not failures: something the suite could not check, said out loud)');
    for (const note of result.notes) out(`  · ${note}`);
  }

  const checked = result.results.filter((rule) => rule.status !== 'not-checked' && rule.status !== 'not-run');
  const notChecked = result.results.filter((rule) => rule.status === 'not-checked' || rule.status === 'not-run');
  const total = failures.length + preflightFailures.length;
  out('');
  if (result.code === 3) {
    out(`CONFORMANCE NOT RUN · ${result.failReason}`);
  } else if (result.code === 0) {
    out(`CONFORMANCE OK · 0 failures · ${checked.length} of ${result.results.length} rules checked` +
      (notChecked.length ? ` · ${notChecked.length} not judged (${notChecked.map((rule) => `rule ${rule.rule}`).join(', ')})` : ''));
  } else {
    out(`CONFORMANCE FAILED · ${total} failure(s) · ${checked.length} of ${result.results.length} rules checked` +
      (result.failReason ? ` · ${result.failReason}` : ''));
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage() {
  return [
    'usage: node design/conformance/run.mjs --app <path-or-url> [options]',
    '',
    '  --app <path-or-url>   the application to check: an html file, a directory holding index.html, or a url',
    '  --theme <both|light|dark>   which renderings to look at (default both)',
    '  --allow <file>        the app\'s declared deviations (default: allow.mjs beside this script)',
    '  --port <n>            the Chrome debug port (default 9223, or $WING_CHROME_PORT)',
    '  --record [<file>]     write this run\'s outcome for the drift dashboard (default: run.json beside the',
    '                        allowance file); without it nothing is written',
    '  --require-all-rules   fail when a rule could not be checked on this run',
  ].join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const options = { cwd: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--app') options.app = argv[++index];
    else if (arg === '--theme') options.theme = argv[++index];
    else if (arg === '--allow') options.allowPath = argv[++index];
    else if (arg === '--port') options.port = argv[++index];
    else if (arg === '--record') {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) { options.recordPath = next; index += 1; }
      else options.record = true;
    } else if (arg === '--require-all-rules') options.requireAllRules = true;
    else if (arg === '--help' || arg === '-h') { console.log(usage()); process.exit(0); }
    else { console.error(`unknown argument: ${arg}\n\n${usage()}`); process.exit(2); }
  }
  const result = await runConformance(options);
  printReport(result);
  // The dashboard's fifth column, and the only write this command makes. It happens after the report is printed so
  // a recording failure can never hide the verdict, and a run that could not measure anything is not recorded at
  // all: "could not run" is not a conformance result.
  if ((options.record || options.recordPath) && result.code !== 3) {
    const allowPath = result.allowPath || DEFAULT_ALLOW;
    const runPath = options.recordPath ? resolve(options.recordPath) : join(dirname(allowPath), CONFORMANCE_RUN_FILE);
    const failures = result.findings.filter((item) => item.severity === 'fail').length +
      result.preflight.filter((item) => item.severity === 'fail').length;
    const declared = result.findings.filter((item) => item.severity === 'declared').length;
    try {
      recordRun(runPath, {
        at: new Date().toISOString(),
        app: result.appUrl || result.app,
        theme: result.theme,
        kitVersion: result.kitVersion,
        declaredKitVersion: result.declaredKitVersion,
        code: result.code,
        failures,
        declared,
      });
      console.log(`\nrecorded for the drift dashboard: ${runPath}`);
    } catch (error) {
      console.error(`the run could not be recorded (${runPath}): ${error.message}`);
    }
  }
  process.exit(result.code);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`conformance could not run: ${error.stack || error.message}`);
    process.exit(3);
  });
}
