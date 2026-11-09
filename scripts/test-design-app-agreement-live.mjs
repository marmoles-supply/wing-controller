// **A gate member, and its name is `-live` on purpose.** This file checks the **live tree**: the design kit as shipped
// (`design/tokens.css`) against the application's own windows (`desktop/ui/*.html`), theme by theme. A plain run on
// this repository exits **0** - measured 2026-10-08, after the instrument steps were added to the kit: 50 tokens, 5
// windows, 0 unexplained disagreement(s), 9 declared -
// and it exits **1** the moment a window actually drifts, naming the window, the theme, the token, the kit's value and
// the window's value.
//
// It was `scripts/check-design-app-agreement.mjs` while it failed by design: the link was unsettled, 44 disagreements
// across four windows were being decided one at a time, and a check that fails by design must not sit in the gate
// (the roadmap's §4f says so, and this project has already paid for a red gate that was a half-written revision). The
// link finished later the same day - `ltc.html` and `index.html` landed last - every remaining disagreement (eleven of
// them) is now **declared** in `desktop/ui/allow.mjs` rather than adopted, and a plain run is green. So it is a
// `test-*` now, and the gate picks it up by that prefix (`scripts/verify-all.sh`: `for test_file in scripts/test-*.mjs`).
//
// **`scripts/test-design-app-agreement.mjs` is this file's ORACLE, not this file.** The obvious name for a `test-*`
// here is taken by it, and that is the trap this name exists to avoid: the oracle is a different, narrower instrument
// that pins this checker's behaviour on fixtures it owns (the twelve false positives, the five inspected windows, the
// running total, the dark fallback, the allowance reader, and the drift this file must fail on). `-live` is what tells
// the two apart in one line each: **this one measures the tree; the oracle measures this one.** The oracle imports the
// exported functions below and also runs this file as a command on the real tree and on a `/tmp` copy of it, so a name
// change has to reach it in the same change.
//
// Measured 2026-10-08 (commit `ae84f4fd`, kit 1.0.1): 44 disagreements across four windows, and exactly one of them
// was the kit being **stale** rather than the application being wrong (`380122c7` changed index.html's colours from a
// contrast audit that measured them, and the kit caught up on `--dim` at `c3ad27f5`; `--field` dark was the one still
// open, `docs/DESIGN_DISAGREEMENTS_2026-10-08.md` row 12).
//
// What matters for the gate is unchanged: a new disagreement - a window that drifts, a kit value that moves on one
// side - fails the check again, and the eleven declared rows are printed as DECLARED, never silently allowed.
//
// The kit exists to be the single source of the owner's look, and the largest piece of work in
// `design/DESIGN-SYSTEM-ROADMAP.md` is removing the duplicate token declarations from this very application so the kit
// can supply them. That removal is only safe if something can tell, afterwards, that the two still agree **per theme**.
//
// A lenient check is not enough, and it was measured on 2026-10-08: comparing "does the kit's value appear anywhere in
// the application" passes all of them today, but it passes whenever a token is declared in `:root` and again in
// `body.theme-dark` - so a token carrying the kit's **light** value in the application's **dark** block would go
// unnoticed, and that is exactly the drift a removal could introduce. This compares light against light and dark
// against dark, and it names the token, the theme, the kit's value and what the application actually says.
//
// What this checker no longer does, measured against `docs/DESIGN_DISAGREEMENTS_2026-10-08.md` §3 (all twelve of the
// false positives that report named; fixing them took the count from 44 to 32, and nothing else moved):
//
//   1. **An alias is not a value.** `--face: var(--win-btn-face)` is a reference. `tokens.css:103-104` prescribes that
//      shape for a window whose dark block re-declares the target, and `isComparableValue()` below exists for exactly
//      this case. An alias is skipped, not compared - `meters.html:18,19,24,25,26,87,88,89,90,91`.
//   2. **A number is compared as a number.** `1.0` and `1` are the same number written two ways
//      (`meters.html:46` vs `tokens.css:85`).
//   3. **A CSS comment is not a value.** `readCanonicalCss()` (design-tokens.mjs) does **not** strip comments, and its
//      `([^;]+);` ran from the `--face:` *inside* the audit comment at `meters.html:82-86` to the real declaration's
//      `;` at `:87` - so the tool printed a value the file does not contain. `stripCssComments()` runs before the
//      parse, and the alias rule above then skips the real declaration too.
//
// The dark fallback has one shape, and it is decided by whether the window **links the kit** (`linksDesignKit()`, read
// from the HTML rather than assumed): for a window that does, a **dark** theme in which the window declares nothing
// resolves to the **kit's** dark value - the kit's own `body.theme-dark` is what paints it - and never to the window's
// light `:root` value. Measured 2026-10-08 on `meters.html` after its link: computed `--field` on `body` is `#0f1614`,
// while `w.dark.get(name) ?? w.light.get(name)` compared that dark standard against the window's light `#ffffff` and
// reported a row that was false. The light fallback is kept for the shape where the **kit** does not re-declare the
// token for dark: there the kit's dark value *is* its light value and the window's `:root` declaration is a real
// disagreement, reported once per theme - `meters.html`'s `--red` (`#e74c3c` against the kit's `#b94444`), whose
// second declaration in `desktop/ui/allow.mjs` depends on the dark row surviving.
//
// An allowance is read, in the shape `design/conformance/run.mjs` already uses (`readAllow`/`applyAllow`), and a
// declared deviation is **reported as declared** with its reason and the count of declarations that matched nothing;
// it is never silently skipped. The distinction is the whole point of the mechanism: a checker that quietly ignores an
// allowance is worse than one that does not support them.
//
// **The default is the application's own allowance, `desktop/ui/allow.mjs`** - the declaration that sits beside the
// windows this checker reads - and it is deliberately **not** `design/conformance/allow.mjs`. That other file is the
// **rendered-page suite's** allowance: a different consumer, read by `design/conformance/run.mjs` for findings measured
// on a rendered page, and it declares nothing about the application's token-theme disagreements. Defaulting to it
// reported the application's **ten** declared rows as unexplained, so the definition of done's "every deviation is
// declared and reported as declared" was untrue of the allowance the application actually has. Correcting the default
// was once reverted on a report of "14 unexplained + 10 declared" from what looked like an 8-entry file; measured
// 2026-10-08, that was a miscount - the file held **ten** entries, one declaration per row holds, and `0 unused`.
//
// Run: node scripts/test-design-app-agreement-live.mjs
//      node scripts/test-design-app-agreement-live.mjs --root <dir>   (a copy of the tree, outside it)
//      node scripts/test-design-app-agreement-live.mjs --allow <file> (or --no-allow)
//      node scripts/test-design-app-agreement-live.mjs --json         (the findings, for a test or a dashboard)
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, globSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isComparableValue, readCanonicalCss } from './lib/design-tokens.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CHECKER = fileURLToPath(import.meta.url);
/// The allowance a plain run reads: the **application's own** declaration, relative to the tree named by `--root`, in
/// the folder the checker already globs (`desktop/ui/*.html`). It is a different file from the **rendered-page suite's**
/// allowance `design/conformance/allow.mjs`, which `design/conformance/run.mjs` reads for findings measured on a page
/// and which declares nothing here; the two are not interchangeable. A test pins this literal, and a plain run against
/// the real tree pins the file it actually reads, so the default cannot drift back unnoticed.
export const DEFAULT_ALLOW = 'desktop/ui/allow.mjs';

/// A CSS comment is `/* … */`, between and inside declarations. It must go before the block is parsed: the kit's own
/// `cssBlock()` reads `([^;]+);` and a comment carrying a `--token: value` sentence is then read as that token's
/// value, which is how `meters.html`'s dark `--face` was once reported as the audit comment above it. Neither `/*`
/// nor `*/` is legal inside a CSS string for a token value the kit carries, so a plain scanner is exact here.
export function stripCssComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/// `1.0` and `1` are one number in two spellings. Only equality is settled here: `1.0` and `2` still differ, and the
/// caller reports them in their own spelling.
export function sameNumber(left, right) {
  const pattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  return pattern.test(left) && pattern.test(right) && Number(left) === Number(right);
}

/// Text two parts of one finding share for a declared deviation to match against, in `run.mjs`'s vocabulary: a
/// measured value, a `#hex`, a token name or a file name, ignoring case and whitespace.
function normaliseMatch(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, '');
}

/// The allowance file, in the shape `design/conformance/allow.mjs` already has: a default export with `deviations`,
/// each `{ rule?, match, reason }`. A missing file is an empty allowance rather than an error - the kit's repository
/// ships one, an application that declares nothing has none - and it is said out loud in the report. Exported so a
/// test can read the very file a plain run reads and compare the run's accounting against it.
export async function readAllow(allowPath) {
  if (!existsSync(allowPath)) {
    return { deviations: [], path: allowPath, missing: true, error: null };
  }
  try {
    const module = await import(pathToFileURL(allowPath).href + `?t=${Date.now()}`);
    const value = module.default || {};
    return {
      deviations: Array.isArray(value.deviations) ? value.deviations : [],
      path: allowPath,
      missing: false,
      error: null,
    };
  } catch (error) {
    return { deviations: [], path: allowPath, missing: false, error: error.message };
  }
}

/// Does this window load the kit's shipped stylesheet (`desktop/ui/design-tokens.css`)? It is what decides the dark
/// fallback in `compareDesign()`: a window the kit paints inherits the kit's `body.theme-dark` for any token it does
/// not override, while a window that does not link the kit keeps its own `:root` value in dark. Read from the HTML -
/// never assumed - so a window whose link was removed is measured as it is, and so a copy of the tree in `/tmp` is
/// measured the same way.
export function linksDesignKit(html) {
  for (const tag of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const text = tag[0];
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(text)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(text);
    const value = href ? href[1] ?? href[2] ?? href[3] ?? '' : '';
    if (/(^|\/)design-tokens\.css(?:[?#]|$)/i.test(value.trim())) return true;
  }
  return false;
}

/// One window's own declarations, per theme: `:root` is light, `body.theme-dark` overrides it. The comments are
/// stripped **here**, so every consumer of this function reads values the file actually declares.
export function readWindow(file, root = REPO) {
  const text = readFileSync(resolve(root, file), 'utf8');
  const parsed = readCanonicalCss(stripCssComments(text));
  return { file, light: parsed.light, dark: parsed.dark, linksKit: linksDesignKit(text) };
}

/// `applyAllow`: an undeclared problem stays a problem, a declared one is reported as declared with its reason, and a
/// declaration that matched nothing is named so it does not rot. The same three-way split `run.mjs` uses for rendered
/// findings, applied to these token-theme findings.
export function applyAllow(problems, deviations) {
  const used = new Set();
  const declared = [];
  const unexplained = [];
  for (const problem of problems) {
    const haystack = normaliseMatch(
      [problem.file, problem.theme, problem.token, problem.kitValue, problem.appValue, problem.sentence].join(' | '),
    );
    let match = null;
    for (let index = 0; index < deviations.length; index += 1) {
      if (used.has(index)) continue;
      const deviation = deviations[index] || {};
      const needle = normaliseMatch(deviation.match);
      if (!needle || !haystack.includes(needle)) continue;
      match = deviation;
      used.add(index);
      break;
    }
    if (match) {
      declared.push({
        ...problem,
        reason: match.reason || '(no reason given — a deviation without a reason is not a decision)',
      });
    } else {
      unexplained.push(problem);
    }
  }
  const unused = deviations
    .map((deviation, index) => ({ deviation, index }))
    .filter(({ index }) => !used.has(index))
    .map(({ deviation }) => deviation);
  return { unexplained, declared, unused };
}

/// Every disagreement between the kit and one application tree, as objects a caller can print, count or hand to
/// `applyAllow`. Pure: it reads files and computes, so a test can point it at a copy in `/tmp` without touching this
/// tree, and it throws only when the inputs are so thin that a comparison would prove nothing.
export function compareDesign({ root = REPO, strict = true } = {}) {
  const kitCssPath = resolve(root, 'design/tokens.css');
  const kitText = readFileSync(kitCssPath, 'utf8');
  const kit = readCanonicalCss(stripCssComments(kitText));
  // Every window is its own mini-application: it declares its own `:root` and its own `body.theme-dark`, in its own
  // HTML. So the comparison is per file - a token that agrees in `index.html` and drifts in `meters.html` is a real
  // defect, and naming the window is what makes the failure fixable. `design-tokens.css` is excluded because it is the
  // kit's own shipped copy: comparing it with itself would prove nothing.
  const appFiles = globSync('desktop/ui/*.html', { cwd: resolve(root) })
    .map((file) => `desktop/ui/${file}`.replace('desktop/ui/desktop/ui/', 'desktop/ui/'))
    .filter((file) => !file.endsWith('design-tokens.css'))
    .sort();
  const windows = appFiles.map((file) => readWindow(file, root)).filter((w) => w.light.size > 0);

  if (strict) {
    assert.ok(kit.light.size > 20, `the kit must declare its light theme (found ${kit.light.size} tokens)`);
    assert.ok(
      windows.length > 1,
      `the application's windows must be found (found ${windows.length}); a comparison against none proves nothing`,
    );
  }

  const problems = [];
  const skipped = [];
  const thin = [];
  for (const w of windows) {
    let declared = 0;
    for (const theme of ['light', 'dark']) {
      for (const [name, lightValue] of kit.light) {
        // The kit's own dark block overrides its :root, exactly as the application's does. Reading only `kit.light`
        // here made every correct dark override look like drift - a check comparing two things that are not the same
        // is indistinguishable, in its output, from a check that has found something.
        const kitDark = kit.dark.get(name);
        const kitValue = theme === 'dark' ? kitDark ?? lightValue : lightValue;
        const override = theme === 'dark' ? w.dark.get(name) : undefined;
        const rootValue = w.light.get(name);
        // The window's value for this theme, and the one place the fallback is decided. A window that links the kit is
        // painted by the kit in dark for anything it does not override itself: the kit's `body.theme-dark` is what
        // reaches the element, so when the kit re-declares the token for dark, that value **is** the window's dark
        // value and the window's light `:root` value is not. Comparing the light one against a dark standard reported
        // `meters.html`'s dark `--field` as "the kit says #0f1614; :root here says #ffffff" - a false row.
        //
        // The light fallback survives, and it must: when the kit does **not** re-declare the token for dark, its dark
        // value is its light value, and then the window's `:root` declaration is a real disagreement. That is
        // `meters.html`'s `--red`, and it is reported once per theme - the dark row is not swallowed here.
        const kitPaintsDark =
          theme === 'dark' && w.linksKit && kitDark !== undefined && override === undefined && rootValue !== undefined;
        const appValue = override !== undefined ? override : kitPaintsDark ? kitDark : rootValue;
        if (appValue === undefined) continue; // Not declaring a token is not a drift; it is reported below.
        if (theme === 'light' && w.dark.has(name)) declared += 1;
        else if (theme === 'dark' && override !== undefined) declared += 1;
        else if (theme === 'light' && w.light.has(name)) declared += 1;
        if (appValue === kitValue) continue;
        // An alias is a reference, not a value: `var(--x)` (the shape `tokens.css:103-104` prescribes) resolves to
        // whatever the theme declares, so comparing the spelling of the reference with a colour tests nothing.
        // `isComparableValue()` is the kit's own definition of "a literal colour or a gradient", and it is deliberately
        // narrow: a font stack that genuinely differs is still a disagreement, and it is reported.
        if (!isComparableValue(appValue) && /^var\(/i.test(appValue)) {
          skipped.push({ file: w.file, theme, token: name, appValue, kind: 'alias' });
          continue;
        }
        // Or the same number written two ways: `1.0` and `1`.
        if (sameNumber(appValue, kitValue)) {
          skipped.push({ file: w.file, theme, token: name, appValue, kitValue, kind: 'number-spelling' });
          continue;
        }
        const where = override !== undefined ? 'body.theme-dark' : ':root';
        problems.push({
          file: w.file,
          theme,
          token: name,
          kitValue,
          appValue,
          where,
          sentence: `${w.file} (${theme}): ${name} — the kit says ${kitValue}; ${where} here says ${appValue}`,
        });
      }
    }
    // A window that declares almost none of the kit's tokens is not drifting - it has its own palette. That is a
    // finding, not a failure, and it is exactly what ITEM 5's declared deviations exist to make explicit. Saying it out
    // loud is the difference between a kit nobody uses and a kit whose gaps are known.
    if (declared < kit.light.size / 4) {
      thin.push(`${w.file}: declares ${declared} of the kit's ${kit.light.size} tokens`);
    }
  }
  return { kit, windows, problems, skipped, thin };
}

/// How many findings a report lists before it prints an "and N more" tail. One home for the number: `report()` and
/// `formatProblems()` both read it, so a listing that says "12" while printing another count cannot happen.
export const LISTED_PROBLEMS = 12;

/// The message a reader sees. The count is stated **first and in full** - and the list is only the first twelve, or
/// **all** of them when there are fewer than twelve: saying "The first 12 are listed" over eleven rows is the same
/// class of lie as reading the list as the total. Reading the list as the total is how this check misled its own
/// author once (`9c9b5d71`, `d76750d3`).
export function formatProblems(problems) {
  const listed = Math.min(LISTED_PROBLEMS, problems.length);
  const howMany = listed === problems.length ? `All ${problems.length}` : `The first ${LISTED_PROBLEMS}`;
  return (
    `the application and the design kit disagree on ${problems.length} point(s). ` +
    `${howMany} are listed; the count is the total, and reading the list as the total is how this check ` +
    `misled its own author once:\n  ${problems.slice(0, LISTED_PROBLEMS).map((problem) => problem.sentence).join('\n  ')}` +
    (problems.length > LISTED_PROBLEMS ? `\n  … and ${problems.length - LISTED_PROBLEMS} more` : '')
  );
}

/// The default report, unchanged in shape from before this change except where the change is the point: the count is
/// still the total, and the declared deviations are now printed as declared instead of counted as disagreements.
export function report(result, out = console.log) {
  if (result.error) {
    out(`the agreement check could not run: ${result.error}`);
    return;
  }
  const { kit, windows, problems, skipped, thin, unexplained, declared, unused, allow } = result;
  out(
    `design kit vs application: ${kit.light.size} tokens, ${windows.length} windows · ` +
    `${unexplained.length} unexplained disagreement(s) · ${declared.length} declared`,
  );
  out(
    `  ${problems.length} disagreement(s) read, ${skipped.length} declaration(s) skipped as not-a-value ` +
    `(${[...new Set(skipped.map((item) => item.kind))].join(', ') || 'none'})`,
  );
  for (const problem of unexplained.slice(0, LISTED_PROBLEMS)) out(`  · ${problem.sentence}`);
  if (unexplained.length > LISTED_PROBLEMS) out(`  … and ${unexplained.length - LISTED_PROBLEMS} more`);
  for (const item of declared) out(`  DECLARED · ${item.sentence} — ${item.reason}`);
  for (const deviation of unused) {
    out(
      `  a declared deviation matched nothing: ${JSON.stringify(deviation.match)}` +
      (deviation.reason ? ` (${deviation.reason})` : ''),
    );
  }
  if (allow) {
    out(
      allow.error
        ? `  the allowance file could not be read (${allow.path}): ${allow.error}`
        : allow.missing
          ? `  no allowance file at ${allow.path}`
          : `  allowance: ${allow.path} · ${allow.deviations.length} declaration(s)`,
    );
  }
  if (thin.length > 0) {
    out(
      `  windows with their own palette rather than the kit's (a finding, not a failure - ITEM 5 declares these):\n` +
      thin.map((line) => `    ${line}`).join('\n'),
    );
  }
}

export async function checkDesign(options = {}) {
  const root = resolve(options.root || REPO);
  // A relative `--allow` (and the default, which is relative) resolves **inside the tree being checked**, so
  // `--root /tmp/copy` measures the copy's own declaration rather than this repository's - the same rule the rest of
  // this checker already follows when it globs `desktop/ui/*.html` under `root`. An absolute `--allow` is untouched.
  const allowPath = options.allowPath === false
    ? null
    : resolve(root, options.allowPath || DEFAULT_ALLOW);
  // An allowance that cannot be read is a COULD-NOT-RUN, not a green: a declaration that silently failed to load is
  // exactly the "quietly skipped allowance" this reader exists to prevent. `run.mjs` makes the same call for the
  // same reason.
  const allow = allowPath ? await readAllow(allowPath) : null;
  if (allow && allow.error) {
    return { root, allow, error: `the allowance file could not be read (${allow.path}): ${allow.error}` };
  }
  const compared = compareDesign({ root, strict: options.strict !== false });
  const { unexplained, declared, unused } = applyAllow(compared.problems, allow ? allow.deviations : []);
  return { ...compared, root, allow, unexplained, declared, unused };
}

function usage() {
  return [
    'usage: node scripts/test-design-app-agreement-live.mjs [options]',
    '',
    '  --root <dir>    the tree to check (default: this repository); a copy outside it is the way to',
    '                  measure a change without touching the tracked files',
    '  --allow <file>  the declared deviations (default: desktop/ui/allow.mjs, the APPLICATION\'s own, relative',
    '                  to --root; design/conformance/allow.mjs is the rendered-page suite\'s, a different consumer)',
    '  --no-allow      ignore every declaration and report every disagreement as unexplained',
    '  --json          print the findings as JSON instead of the report',
  ].join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') options.root = argv[++index];
    else if (arg === '--allow') options.allowPath = argv[++index];
    else if (arg === '--no-allow') options.allowPath = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') { console.log(usage()); process.exit(0); }
    else { console.error(`unknown argument: ${arg}\n\n${usage()}`); process.exit(2); }
  }
  const result = await checkDesign(options);
  if (result.error) {
    console.error(result.error);
    process.exit(3);
  }
  if (options.json) {
    console.log(JSON.stringify({
      root: result.root,
      kitTokens: result.kit.light.size,
      windows: result.windows.map((w) => w.file),
      problems: result.problems,
      skipped: result.skipped,
      unexplained: result.unexplained,
      declared: result.declared,
      unused: result.unused,
      allow: result.allow,
      thin: result.thin,
    }, null, 2));
  } else {
    report(result);
  }
  if (result.unexplained.length > 0) {
    assert.deepEqual(
      result.unexplained.map((problem) => problem.sentence),
      [],
      formatProblems(result.unexplained),
    );
  }
}

/// Is this file being run as the command, or imported by its oracle? The comparison resolves symlinks, and that is not
/// decoration: a copy of this file under `/tmp` (which is `/private/tmp`) or under `/var` (`/private/var`) has an
/// `import.meta.url` on the resolved path and an `argv[1]` on the unresolved one, so a literal comparison is false and
/// `main()` never runs - the file exits **0 having measured nothing**, which is the one failure a gate member must not
/// have. Measured while writing the mutation check: `node /tmp/.../test-design-app-agreement-live.mjs --root <tree>`
/// printed nothing and exited 0. `realpathSync` makes the two spellings one path wherever the file lives.
function isRunAsCommand() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(CHECKER);
  } catch {
    return false;
  }
}

if (isRunAsCommand()) {
  main().catch((error) => {
    if (error && error.code === 'ERR_ASSERTION') {
      console.error(error.message);
      process.exit(1);
    }
    console.error(`the agreement check could not run: ${error.stack || error.message}`);
    process.exit(3);
  });
}
