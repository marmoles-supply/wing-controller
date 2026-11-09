// The lock on the visual record: `design/screens/` must be what this tree renders **today**.
//
// The images in `design/screens/` are the record a person reviews, and the reason they exist is a measured one: a
// consumer passed the conformance suite with 0 failures in both themes while looking nothing like the specimen,
// because it had replaced the whole type scale and reassigned the kit's names. A judge over computed styles said
// "conforms"; a person looking at the two side by side would not have. So the record is pictures — and a picture
// that is not refreshed with the code it describes is worse than no picture, because it is a **lie with a
// timestamp**. This test is what makes the refresh happen: change what a window draws and this goes red naming the
// window, the theme and how much of the image moved.
//
// What it does, in order:
//
//   1. renders every window in both themes into a **scratch directory under /tmp** — never into `design/screens/`,
//      because a test that rewrites the artefact it checks is a test that can never fail;
//   2. compares each fresh image with the committed one, byte for byte first and then pixel by pixel, so a failure
//      can say *how much* differs and *where* rather than printing two whole files;
//   3. passes silently when they match. Silence is the contract: a green run has nothing to report.
//
// It drives Chrome — deterministically, on a **private port**, never 9223 — through `scripts/lib/design-screens.mjs`.
// That module is where the determinism lives (fixed 1600 px viewport, device scale factor 1, hinting off, motion
// frozen by injection, a fresh profile, no network, and a second sample that must equal the first), and a second
// render of the same tree is required to be a **byte-identical** file or this test refuses the render instead of
// blaming the images.
//
//   node scripts/test-design-screens.mjs                 judge this tree (exit 0 green, 1 a screen moved, 3 nothing measured)
//   node scripts/test-design-screens.mjs --only meters   judge one window
//   node scripts/test-design-screens.mjs --repo <dir>    judge another checkout (the proof of this lock uses it)
//   node scripts/test-design-screens.mjs --write         regenerate design/screens/ — **the refresh, done on purpose**
//
// `--write` is not what a failure asks you to run blindly: read the failing sentence, look at the window and at
// `design/reference/` beside it, and then refresh. A refreshed image is a claim that the window is right, not
// evidence that it is.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  REPO_ROOT,
  THEMES,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  WINDOWS,
  countPixelDifferences,
  decodePng,
  renderScreens,
  requireStableDoubleCapture,
  scratchDirectory,
  startPrivateBrowser,
  windowsByName,
} from './lib/design-screens.mjs';
import { selectRendererProfile } from './lib/design-renderer-profiles.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] ?? '';
};
const has = (name) => argv.includes(name);

const repo = resolve(flag('--repo') || REPO_ROOT);
const screensDir = resolve(repo, 'design/screens');
const write = has('--write');
const profileName = process.env.WING_SCREENSHOT_PROFILE || 'local';
assert.ok(!write || profileName === 'local', 'hosted references must be captured for review, never rewritten by the checking job');
const only = flag('--only') ? flag('--only').split(',').map((name) => name.trim()).filter(Boolean) : null;
const windows = windowsByName(only);
const themes = THEMES;

const CHROME_BIN = process.env.WING_CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME_BIN)) {
  // No rendering means no verdict. A missing browser must fail the gate, including in quick mode.
  console.log(`design-screens: no Chrome at ${CHROME_BIN}; set WING_CHROME_BIN to run. The visual record was NOT checked.`);
  process.exit(3);
}

/// The retry budget a flaky **rasteriser** is allowed — proved here, before a browser is started, because it is the
/// one place this lock could go deaf without anybody noticing. `captureBand()` gives a band up to three attempts for
/// the meter-ramp dithering (measured; the numbers are in the header of `scripts/lib/design-screens.mjs`). That budget
/// must buy **another pair of byte-identical captures**, never a tolerance: the assertions below are the whole
/// difference between the two. A change that made `requireStableDoubleCapture` return the differing bytes, or compare
/// with a threshold, fails here and not in a browser that happens to agree today. Two real 1×1 PNGs stand in for
/// captures, because the refusal path decodes them to say how much differed.
async function assertStableCaptureBudget() {
  const { PNG } = await import('pngjs');
  const png = (r, g, b) => {
    const image = new PNG({ width: 1, height: 1 });
    image.data[0] = r; image.data[1] = g; image.data[2] = b; image.data[3] = 255;
    return PNG.sync.write(image);
  };
  const differing = png(0, 172, 107);
  const other = png(0, 172, 108);
  const third = png(0, 172, 109);

  // A stand-in for a `shoot()`: the first capture of every pair returns `first` and the second `second`, so a pair is
  // either a genuine disagreement (different buffers) or a genuine agreement (the same buffer both times).
  // `state.capture` counts the captures taken, which is what proves the retry spends a **fresh pair** rather than
  // re-using the differing bytes.
  const pairSource = (first, second) => {
    const state = { capture: 0 };
    const shoot = () => {
      state.capture += 1;
      return Promise.resolve(state.capture % 2 === 1 ? first : second);
    };
    shoot.state = state;
    return shoot;
  };

  // One differing pair, then a settled one **of different bytes**: the retry is spent, and the winner is the settled
  // pair's bytes — so "accepted the fresh pair" cannot be confused with "re-used the bytes that differed". The third
  // buffer is what a re-used capture could never return.
  let pair = 0;
  const oneDifferingPairThenAgreement = () => {
    pair += 1;
    if (pair <= 2) return Promise.resolve(pair === 1 ? differing : other);
    return Promise.resolve(third);
  };
  const winner = await requireStableDoubleCapture(oneDifferingPairThenAgreement, { settleMs: 1, what: 'the budget probe', attempts: 3 });
  assert.equal(winner, third, 'the settled pair after a differing one must be accepted, byte for byte');
  assert.equal(pair, 4, 'the retry must take a fresh pair (two more captures), not re-use the differing one');

  // A pair that never agrees: refused, with the code the callers branch on and the attempt count in the sentence.
  const neverStable = pairSource(differing, other);
  await assert.rejects(
    () => requireStableDoubleCapture(neverStable, { settleMs: 1, what: 'the budget probe', attempts: 2 }),
    (error) => error.code === 'NOT_STABLE' && /in each of 2 attempts/.test(error.message),
    'a pair that never agrees must be refused after the last attempt, naming the attempt count',
  );
  assert.equal(neverStable.state.capture, 4, 'two failed attempts are two pairs');

  // An `attempts` budget of one is the window's contract: no retry at all.
  const singleOnce = pairSource(differing, other);
  await assert.rejects(
    () => requireStableDoubleCapture(singleOnce, { settleMs: 1, attempts: 1 }),
    (error) => error.code === 'NOT_STABLE',
  );
  assert.equal(singleOnce.state.capture, 2, 'attempts: 1 must take exactly one pair and refuse it');
}

await assertStableCaptureBudget();

console.log(
  `design-screens: ${windows.length} window(s) × ${themes.length} theme(s), each at ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} ` +
  `(the window as it opens), from ${repo}`,
);

const scratch = process.env.WING_VERIFY_LOG_DIR
  ? resolve(process.env.WING_VERIFY_LOG_DIR, 'visual-current')
  : await scratchDirectory('wing-screens-test');
await mkdir(scratch, { recursive: true });
let browser;
let results;
let renderer = { name: 'local', images: {} };
try {
  try {
    browser = await startPrivateBrowser({ softwareCompositing: true, log: (line) => console.log(line) });
  } catch (error) {
    console.error(`design-screens: could not start a private Chrome (${error.code || 'ERROR'}): ${error.message}`);
    process.exit(3);
  }
    const catalog = profileName === 'local' ? {} : JSON.parse(readFileSync(join(screensDir, 'renderer-profiles.json'), 'utf8'));
    const observed = { platform: process.platform, arch: process.arch,
      osVersion: process.platform === 'darwin' ? execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim() : '',
      chromeVersion: String(browser.version.Browser).split('/')[1],
      renderMode: browser.launchArguments.includes('--disable-gpu') ? 'software-compositor' : 'automatic' };
    renderer = selectRendererProfile(catalog, profileName, observed);
    console.log(`Visual renderer profile: ${renderer.name}; environment ${JSON.stringify(observed)}`);
    for (const [name, hash] of Object.entries(renderer.images)) {
      const bytes = readFileSync(join(screensDir, renderer.name, name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `reviewed reference ${name} must retain its recorded hash`);
    }
  results = await renderScreens({
    outDir: scratch,
    names: only,
    themes,
    repo,
    browser,
    log: (line) => console.log(line),
  });
} catch (error) {
  console.error(`design-screens: the render did not finish (${error.code || 'ERROR'}): ${error.message}`);
  if (browser) await browser.close();
  process.exit(3);
}
await browser.close();

// ---------------------------------------------------------------------------------------------------------------
// The comparison. One failing sentence per image, and each sentence names the window, the theme and how much moved.
// ---------------------------------------------------------------------------------------------------------------
const failures = [];
const summaries = [];
for (const result of results) {
  const fileName = `${result.window}-${result.theme}.png`;
  const committedPath = renderer.images[fileName]
    ? join(screensDir, renderer.name, fileName) : join(screensDir, fileName);
  const where = `${result.window} window, ${result.theme} theme`;
  if (!existsSync(committedPath)) {
    failures.push(
      `${where}: design/screens/${result.window}-${result.theme}.png does not exist. The record is missing an image ` +
      `this tree renders, which is the gap that lets a window change unrecorded. Run \`node scripts/test-design-screens.mjs --write\` ` +
      'and commit the image with the change that produced it.',
    );
    continue;
  }
  const committed = readFileSync(committedPath);
  const sameBytes = committed.equals(result.bytes);
  const fresh = await decodePng(result.bytes);
  const recorded = await decodePng(committed);
  const difference = countPixelDifferences(recorded, fresh);
  if (sameBytes) {
    summaries.push(`${result.window}-${result.theme}.png identical (${result.bytes.length} bytes, ${fresh.width}x${fresh.height})`);
    continue;
  }
  if (difference.pixels === 0) {
    // Same pixels, different bytes: the image a person reviews is right and the file is not the file this tree
    // produces. Refusing it is the honest answer — a byte-identical render is what the refresh promises.
    failures.push(
      `${where}: the two images render the same pixels but are not byte-identical ` +
      `(recorded ${committed.length} bytes, fresh ${result.bytes.length} bytes). Re-render and commit the fresh file.`,
    );
    continue;
  }
  failures.push(
    `${where}: ${difference.sentence}; the recorded image is design/screens/${result.window}-${result.theme}.png and the ` +
    `fresh render is ${join(scratch, `${result.window}-${result.theme}.png`)}. A changed window must arrive with its ` +
    'refreshed images in the same commit: look at them, then run `node scripts/test-design-screens.mjs --write`.',
  );
}

// A file in the record that this tree no longer renders is the same defect from the other side: a reader opens it
// and sees a window that does not exist any more.
const expected = new Set(results.map((result) => `${result.window}-${result.theme}.png`));
if (existsSync(screensDir) && !only) {
  for (const entry of readdirSync(screensDir)) {
    if (!entry.endsWith('.png')) continue;
    if (!expected.has(entry)) {
      failures.push(
        `design/screens/${entry} is not an image this tree renders. The record carries a window or theme that is gone, ` +
        'and a reader would take it for the application. Delete it in the same commit that removed the window.',
      );
    }
  }
}

console.log('---');
for (const summary of summaries) console.log(summary);

// `--write` is the deliberate refresh — the thing a person runs **after** reading a failure and looking at the
// window. It is not a flag that makes the failure go away on its own: it still exits non-zero unless the record it
// has just written is also what the same comparison would accept. The decision stays where it belongs.
if (write) {
  if (!existsSync(screensDir)) await mkdir(screensDir, { recursive: true });
  await Promise.all(results.map((result) => writeFile(join(screensDir, `${result.window}-${result.theme}.png`), result.bytes)));
  console.log(`wrote ${results.length} image(s) into design/screens/ — commit them with the change they show.`);
  // A missing entry is now present and a differing entry is now the fresh one; only the "stale file" defects can
  // survive a write, because nothing was deleted.
  const afterWrite = [];
  for (const result of results) {
    const committed = readFileSync(join(screensDir, `${result.window}-${result.theme}.png`));
    if (!committed.equals(result.bytes)) {
      afterWrite.push(`${result.window} window, ${result.theme} theme: the file written back does not equal the render`);
    }
  }
  if (afterWrite.length > 0) {
    console.error(`design-screens: FAIL — ${afterWrite.join('; ')}`);
    process.exit(1);
  }
  const staleAfterWrite = failures.filter((failure) => failure.includes('is not an image this tree renders'));
  if (staleAfterWrite.length > 0) {
    console.error(`design-screens: FAIL — the record still carries an image this tree does not render:`);
    for (const failure of staleAfterWrite) console.error(`  · ${failure}`);
    process.exit(1);
  }
  console.log(`design-screens: the written record is what this tree renders now (${results.length} image(s))`);
  console.log('WING_BROWSER_SUITE_OK');
  process.exit(0);
}

if (failures.length > 0) {
  console.error('');
  console.error(`design-screens: FAIL — ${failures.length} of ${results.length} image(s) in design/screens/ are not what this tree renders now.`);
  for (const failure of failures) console.error(`  · ${failure}`);
  console.error('');
  console.error(`the fresh renders were kept in ${scratch} so they can be looked at beside design/reference/ before anything is refreshed.`);
  process.exit(1);
}

const total = results.reduce((sum, result) => sum + result.bytes.length, 0);
console.log(
  `design-screens: ${results.length} image(s) in design/screens/ are exactly what this tree renders today ` +
  `(${total} bytes, byte-identical to a fresh render at ${VIEWPORT_WIDTH} px, both themes)`,
);
console.log('design-screens: this lock catches CHANGE, not ugliness — whether the windows resemble the kit is a person\'s question, answered beside design/reference/');

// This suite drives Chrome, so it carries the seal the gate demands of anything that does. A run that could not
// reach this line must not be read as a suite that ran.
console.log('WING_BROWSER_SUITE_OK');
