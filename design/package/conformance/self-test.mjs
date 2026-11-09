// `self-test.mjs` — the proof that the conformance suite can fail.
//
// A suite that has never failed is a ceremony. This one runs the suite against a page that conforms and against one
// fixture per defect the suite claims to catch, and it fails itself if a fixture that **must** go red goes green.
// There are two conforming pages, on purpose: `good.html` (one theme) and `two-theme-columns.html` (both themes at
// once, the shape `design/specimen.html` has, which a rule that resolved the kit's two steps once for the whole page
// judged wrongly). The roadmap names two of them (a literal colour, a `--mono` number outside a well); the rest are
// here because a rule with no fixture is a rule nobody has ever seen work.
//
// It also exercises the two mechanisms around the eight rules: a declared deviation is *reported* rather than
// silently allowed, and a copy of the kit whose declared version does not match the files beside it is caught.
//
// Run: node design/conformance/self-test.mjs        (exit 0 when every fixture behaved)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureBrowser, VIEWPORT } from './collect.mjs';
import { runConformance } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const PORT = Number(process.env.WING_CHROME_PORT || 9223);
// The fixtures are run with a declaration that matches the kit copy *as it is now*, so a version bump in the kit
// (which the kit's maintainer does, and which the suite reports truthfully for a real app) cannot make the proof
// itself go red. That the mismatch is caught at all is proved by its own case below.
const KIT_VERSION = readFileSync(join(HERE, '..', 'VERSION'), 'utf8').trim();

const CASES = [
  { fixture: 'good.html', expect: [] },
  // A page that paints both themes at once: the kit's two steps resolve differently in each column, and a rule that
  // resolves one pair for the whole page fails the column whose pair it did not read. `design/specimen.html` is such
  // a page (it is why this fixture exists); this one keeps the shape in the suite's own proof rather than in a
  // catalogue that a later change might not re-run.
  { fixture: 'two-theme-columns.html', expect: [] },
  { fixture: 'bad-literal-colour.html', expect: [{ rule: 3, code: 'unknown-colour', says: 'rgb(255, 0, 255)' }] },
  { fixture: 'bad-mono-outside-well.html', expect: [{ rule: 2, code: 'not-in-well', says: '42.5 dB' }] },
  { fixture: 'bad-mixed-edges.html', expect: [{ rule: 1, code: 'mixed-edges', says: 'top rgb' }] },
  { fixture: 'bad-rounded.html', expect: [{ rule: 1, code: 'rounded', says: '6px' }] },
  { fixture: 'bad-two-shapes.html', expect: [{ rule: 1, code: 'two-shapes', says: 'inset' }] },
  { fixture: 'bad-unknown-token.html', expect: [{ rule: 4, code: 'unknown-token', says: '--space-9' }] },
  { fixture: 'bad-frozen-palette.html', expect: [{ rule: 4, code: 'frozen-element', says: 'rgb(192, 192, 192)' }] },
  // A frozen element in one of two columns whose markup is identical five levels deep: both cards report the same
  // five-level `path`, so a suite that pairs the light and dark renderings by it judges the frozen card against the
  // changed one in the other column and reports nothing. The pairing must use the full structural key (roadmap §4d).
  { fixture: 'bad-two-column-frozen.html', expect: [{ rule: 4, code: 'frozen-element', says: 'rgb(192, 192, 192)' }] },
  { fixture: 'bad-redefined-token.html', expect: [{ rule: 4, code: 'redefined-token', says: '--face' }] },
  { fixture: 'bad-disabled-control.html', expect: [{ rule: 5, code: 'disabled-control', says: 'arrives with the MIDI support' }] },
  { fixture: 'bad-silent-refusal.html', expect: [{ rule: 5, code: 'silent-refusal', says: 'empty' }] },
  { fixture: 'bad-generic-refusal.html', expect: [{ rule: 5, code: 'generic-refusal', says: 'Error' }] },
  { fixture: 'bad-two-state.html', expect: [{ rule: 6, code: 'two-states', says: 'yes no' }] },
  { fixture: 'bad-colour-only-states.html', expect: [{ rule: 6, code: 'colour-only-state', says: 'colour' }] },
  // Rule 8, and the consumer's own measured case (`DESIGN-SYSTEM-ROADMAP.md` §4j): the kit's names reassigned to a
  // ramp of the page's own, so every text changed size. It is not one of the kit's five steps, and forcing the knob
  // does not move it. This fixture ran `CONFORMANCE OK · 0 failures` against rules 1-7 before rule 8 existed.
  { fixture: 'bad-renamed-ramp.html', expect: [
    { rule: 8, code: 'invented-size', says: '15px' },
    { rule: 8, code: 'step-not-minimum', says: '15px' },
  ] },
  { fixture: 'bad-invented-size.html', expect: [{ rule: 8, code: 'invented-size', says: '20px' }] },
  // The second check on its own, and the reason the suite renders the page twice: 9.5px **is** one of the kit's five
  // steps at --meter-scale 1, so the first check passes — a single-size photograph sees nothing wrong. At 1.5 the
  // kit's `--font-sm` goes to 11.3px and this stays 9.5px, which is the proportion a renamed ramp cannot fake.
  { fixture: 'bad-fixed-scale.html', expect: [{ rule: 8, code: 'step-not-proportional', says: '9.5px' }] },
  // Rule 9, the three sheets linked out of the order `UI_SYSTEM.md` §10 makes a contract. `bad-link-order.html` links
  // `components.css` **first** and `tokens.css` **second**, so every `var()` in the drawings asks the values sheet for
  // a value it has not declared yet. The finding names the sheet that got ahead of this one, with the position each
  // was linked at; the `says` below is that message's own opening, taken from `rule9LoadOrder` rather than invented.
  { fixture: 'bad-link-order.html', expect: [
    { rule: 9, code: 'load-order', says: 'the values sheet (tokens.css) is linked 2nd' },
  ] },
  // Rule 10, the plan a page linked and then answered a second time. `bad-retyped-plan.html` links the kit's three
  // sheets in the kit's own order and then re-declares the plan in its own `<style>`: `.stack`'s gap as 10px against
  // the kit's 8px, and `.builder-column`'s floor as 280px against the kit's 0px. Those two are computed as lengths and
  // are exactly what separates this page from the pages that compose the plan; the grid tracks are deliberately **not**
  // compared (see the rule's own comment in `rules.mjs`) because `grid-template-columns` computes to the **used** track
  // list (`520px 8px 300px` here, `740px` on `design/layout.html`) and can never match a declared `minmax()`.
  { fixture: 'bad-retyped-plan.html', expect: [
    { rule: 10, code: 'retyped-plan', says: 'gap: 10px' },
    { rule: 10, code: 'retyped-plan', says: 'min-width: 280px' },
  ] },
  // Rule 11, the page's own width against the window it is rendered in — the one measurement none of the other rules
  // takes. `bad-overflow.html` links the kit's three sheets in the kit's order, composes the kit's plan and declares
  // none of it, and is otherwise clean (`CONFORMANCE OK · 0 failures` before rule 11 existed), so the single failure
  // this fixture produces is unambiguously the overflow. Its defect is one card with an explicit 900px width — 144px
  // past the suite's own declared 756px rendering (`collect.mjs` `VIEWPORT`) — and the `says` below is the element the
  // rule names, taken from the finding rather than invented: the measured value's rightmost element.
  //
  // **This case is also the acceptance test for reusing a browser, and it was measured failing it.** On 2026-10-08,
  // with a foreign Chrome started at `--window-size=1280,900` answering the port, the suite laid this page out in the
  // foreign 1280px window, the 900px card fitted, and this case printed
  // `bad-overflow.html → MISSED (no rule 11 overflows-viewport naming "section#wider-than-the-window")` beside
  // `the suite exited 0 on a known-bad fixture`. The declared viewport is what closed that: the same foreign browser
  // now produces the same `FAIL rule 11 overflows-viewport` as a quiet port, because `openTab` forces `VIEWPORT` on
  // the tab before the page is loaded, so whose browser answered stops reaching the rules. What this fixture does NOT
  // prove is the limit rule 11's own comment states: at a single width it says nothing about
  // `desktop/ui/index.html`'s 29px-wide 1181-1208 band, which needs a width the suite never visits.
  { fixture: 'bad-overflow.html', expect: [
    { rule: 11, code: 'overflows-viewport', says: 'section#wider-than-the-window' },
  ] },
];

const problems = [];
const temp = mkdtempSync(join(tmpdir(), 'wing-conformance-selftest.'));
process.on('exit', () => { try { rmSync(temp, { recursive: true, force: true }); } catch (_) {} });

function writeAllow(name, body) {
  const path = join(temp, name);
  writeFileSync(path, `export default ${JSON.stringify(body, null, 2)};\n`);
  return path;
}

const FIXTURE_ALLOW = writeAllow('allow-fixtures.mjs', { kitVersion: KIT_VERSION, deviations: [] });

const browser = await ensureBrowser(PORT);
if (!browser.alive) {
  console.error(`self-test: COULD-NOT-RUN: ${browser.reason || `nothing answers the debug port ${PORT}`}`);
  process.exit(3);
}
// Said before the cases rather than discovered in one of them: every fixture is laid out in the suite's own declared
// viewport, whatever window the browser that answered the port was started with, so a reader of this proof can see
// that "whoever's browser is on the port" is not an input to any verdict below.
console.log(`self-test · viewport ${VIEWPORT.width}x${VIEWPORT.height} (collect.mjs VIEWPORT) on port ${PORT}` +
  ` · every fixture is forced into it, so a reused browser cannot change a fixture's verdict`);

let passed = 0;
for (const testCase of CASES) {
  const app = join(FIXTURES, testCase.fixture);
  const result = await runConformance({ app, theme: 'both', port: PORT, allowPath: FIXTURE_ALLOW });
  if (result.code === 3) {
    console.error(`self-test: COULD-NOT-RUN on ${testCase.fixture}: ${result.failReason}`);
    browser.close();
    process.exit(3);
  }
  const failures = result.findings.filter((item) => item.severity === 'fail');
  if (testCase.expect.length === 0) {
    if (result.code !== 0 || failures.length) {
      problems.push(`${testCase.fixture}: it conforms, and the suite reported ${failures.length} failure(s): ` +
        failures.slice(0, 4).map((item) => `rule ${item.rule} ${item.code} (${item.measured})`).join(' · '));
      console.log(`self-test · ${testCase.fixture.padEnd(32)} → FAILED A PAGE THAT CONFORMS (${failures.length} finding(s))`);
    } else {
      console.log(`self-test · ${testCase.fixture.padEnd(32)} → CONFORMANCE OK, 0 failures`);
      passed += 1;
    }
  } else {
    for (const expected of testCase.expect) {
      const hit = failures.find((item) =>
        item.rule === expected.rule && item.code === expected.code &&
        String(item.measured).includes(expected.says));
      if (!hit) {
        problems.push(`${testCase.fixture}: expected a rule ${expected.rule} ${expected.code} failure mentioning ` +
          `"${expected.says}"; the suite reported ` +
          (failures.length ? failures.map((item) => `rule ${item.rule} ${item.code} (${item.measured})`).join(' · ') : 'nothing'));
        console.log(`self-test · ${testCase.fixture.padEnd(32)} → MISSED (no rule ${expected.rule} ${expected.code} naming "${expected.says}")`);
      } else {
        const extra = failures.filter((item) => item !== hit).length;
        console.log(`self-test · ${testCase.fixture.padEnd(32)} → FAIL rule ${hit.rule} ${hit.code} · ${hit.element} · ${hit.measured}` +
          (extra ? `  (+${extra} more finding(s))` : ''));
        passed += 1;
      }
    }
    // The suite's own contract: a fixture with a defect must not exit 0.
    if (result.code === 0) problems.push(`${testCase.fixture}: the suite exited 0 on a known-bad fixture`);
  }
}

// The seventh point is reported as not checked, never as a pass. If that ever changes to green, this catches it.
{
  const result = await runConformance({ app: join(FIXTURES, 'good.html'), theme: 'both', port: PORT, allowPath: FIXTURE_ALLOW });
  const vocabulary = result.results.find((rule) => rule.rule === 7);
  if (!vocabulary || vocabulary.status !== 'not-checked') {
    problems.push(`rule 7 should be reported as not-checked; it reported "${vocabulary ? vocabulary.status : 'nothing'}"`);
    console.log(`self-test · rule 7 status                              → ${vocabulary ? vocabulary.status : 'missing'} (expected not-checked)`);
  } else {
    console.log('self-test · rule 7 status                              → NOT CHECKED, as documented (it needs a reader)');
    passed += 1;
  }
  // A structurally broken page must be reported as such, not passed.
  const noKit = await runConformance({ app: join(FIXTURES, 'bad-redefined-token.html'), theme: 'light', port: PORT, allowPath: FIXTURE_ALLOW });
  const themes = noKit.results.find((rule) => rule.rule === 4);
  if (!themes || themes.status !== 'not-run') {
    problems.push(`rule 4 with --theme light should be not-run; it was "${themes ? themes.status : 'missing'}"`);
    console.log(`self-test · rule 4 on one theme                        → ${themes ? themes.status : 'missing'} (expected not-run)`);
  } else {
    console.log('self-test · rule 4 on one theme                        → NOT RUN, and it says so (both themes are needed)');
    passed += 1;
  }
}

// The drift mechanism: the declaration against the copy beside it.
{
  const wrongVersion = KIT_VERSION === '0.0.0' ? '0.9.0' : '0.0.0';
  const allowPath = writeAllow('allow-wrong-version.mjs', { kitVersion: wrongVersion, deviations: [] });
  const result = await runConformance({ app: join(FIXTURES, 'good.html'), theme: 'both', port: PORT, allowPath });
  const hit = result.preflight.find((item) => item.code === 'kit-version' && item.severity === 'fail');
  if (!hit) {
    problems.push('a declared kitVersion older than the copy was not caught');
    console.log('self-test · kitVersion drift                           → MISSED');
  } else {
    console.log(`self-test · kitVersion drift                           → FAIL ${hit.measured}`);
    passed += 1;
  }
}

// The allowance mechanism: a declared deviation is reported as declared, not silently allowed.
{
  const allowPath = writeAllow('allow-deviation.mjs', {
    kitVersion: KIT_VERSION,
    deviations: [{ rule: 3, match: '#ff00ff', reason: 'the panic flash is magenta on purpose' }],
  });
  const result = await runConformance({ app: join(FIXTURES, 'bad-literal-colour.html'), theme: 'both', port: PORT, allowPath });
  const declared = result.findings.find((item) => item.severity === 'declared' && item.rule === 3);
  if (!declared) {
    problems.push('a declared deviation was not accepted, or was silently dropped');
    console.log('self-test · declared deviation                         → MISSED');
  } else {
    console.log(`self-test · declared deviation                         → DECLARED (${declared.reason}), and the report says so`);
    passed += 1;
  }
  if (result.code !== 0) {
    problems.push('a page whose only defect is declared should not fail the run');
  }
}

browser.close();

if (problems.length) {
  console.error('');
  console.error(`SELF-TEST FAILED · ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log('');
console.log(`self-test: ${passed} checks proved the suite can fail, and the conforming fixture stayed green.`);
console.log('WING_CONFORMANCE_SELF_TEST_OK');
