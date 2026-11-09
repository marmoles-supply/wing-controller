#!/usr/bin/env node
// Two pages, one image: the instrument this design loop was missing for the question the owner keeps having to answer.
//
// On 2026-10-08 the owner reported what the loop was doing to him: *"los agentes me están devolviendo auténticas
// basuras de diseños, no se parecen en nada a wing-controller."* Measured against the tree, the loop had no judge for
// that sentence. The conformance suite measures **rules** - and a real consumer passed it with 0 failures in both
// themes while looking nothing like the specimen, because it had replaced the type scale and reassigned the kit's
// names. The screenshot lock (`scripts/test-design-screens.mjs`) measures **change** - it can say that a window moved,
// never whether it is right. Nothing measured **resemblance**, so an agent built a UI, saw green, and the only
// instrument left was the owner's eye, asked every time. This script is the missing half of that record, and nothing
// else.
//
// **It does not measure likeness, and it must never pretend to.** It renders two pages at one viewport, in both
// themes, with the discipline `scripts/lib/design-screens.mjs` already keeps for the visual record - a private Chrome
// on a port the OS picked (**never 9223**), a fresh profile, `--force-device-scale-factor=1`, font hinting off, the
// clock frozen to `2026-01-01T09:00:00Z` and the time zone pinned to UTC, `file://` only with no backend, and **two
// samples that must agree** or the render is refused - and then puts one page on the left and the other on the right
// of a single contact sheet, at the same pixel size, each labelled with its path and the theme, with a divider. The
// judgement stays with a person or an agent; it becomes **one glance instead of two applications**.
//
//   node scripts/compare-design-likeness.mjs --left desktop/ui/index.html --right <another project's page> [--out /tmp]
//   node scripts/compare-design-likeness.mjs --against-screens --left desktop/ui/index.html [--out /tmp]
//
// The second mode costs almost nothing and may matter more: it renders a window of **this** application and puts it
// beside the committed `design/screens/<window>-<theme>.png` for the same window, so somebody who has just edited a
// window here sees the drift at a glance. There it also prints **how much moved** - and that number is a change, not
// a resemblance: the two images are supposed to be the same window. It is never a verdict, and this script never
// exits non-zero because two pages differ.
//
// **What it is not.** It is not a gate test, it is not part of `--quick`, it is not named `test-*.mjs` (the gate runs
// that prefix), and a red mark from it would be the same lie in a new place: a tool whose red meant "not alike" would
// be a rule wearing a judgement's clothes. It is a report.
//
// **What it cannot do.** A page that needs a console, credentials or a live session renders as whatever it draws
// without them. Nothing is fabricated to make a prettier sheet - a broken page is shown broken, and that is a fact
// about the sheet its reader needs. The same is true of the theme: a page is offered both conventions - this
// application's (`wing_theme` written into `localStorage`, `body.theme-dark` toggled) and the browser's
// (`prefers-color-scheme`) - so a page that honours either is shown in both palettes, and a page that honours neither
// renders the same twice and the run says so rather than drawing a dark frame around a light page.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  FROZEN_CLOCK,
  REPO_ROOT,
  THEMES,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  WINDOWS,
  capture,
  countPixelDifferences,
  decodePng,
  openTab,
  startPrivateBrowser,
} from './lib/design-screens.mjs';
import { composeContactSheet } from './lib/contact-sheet.mjs';

/// The two sentences that go into the console output **and** into the picture, so a sheet that is filed away, pasted
/// into a message or opened a month later still says what it is and what it cannot do. The first one is the promise
/// this tool must never break.
const WHAT_IT_IS =
  'these two images are side by side for a person to judge; this tool measures nothing about resemblance.';
const WHAT_IT_CANNOT_DO =
  'a page that needs a console, credentials or a live session renders as whatever it draws offline: this tool opens ' +
  'a local file with no backend and fabricates no content to fill the sheet.';

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] ?? '';
};
const has = (name) => argv.includes(name);

function usage() {
  return [
    'compare-design-likeness: two pages, side by side, at the same size, in one image per theme.',
    '',
    '  node scripts/compare-design-likeness.mjs --left <page> --right <page> [--out <dir>]',
    '  node scripts/compare-design-likeness.mjs --against-screens --left <window page> [--out <dir>]',
    '',
    '  --left <path>        the reference page (this application, in the usual case)',
    '  --right <path>       the page to put beside it (required unless --against-screens)',
    '  --against-screens    compare --left (a window of this application) with its committed',
    '                       design/screens/<window>-<theme>.png rather than with another page',
    `  --out <dir>          where the sheets are written (default /tmp)`,
    '',
    `  the windows are ${WINDOWS.map((window) => window.file).join(', ')}`,
    '',
    'It renders both pages at 1600x1000, in both themes, from file:// with no backend, and writes one contact sheet',
    'per theme. It is a report: it measures nothing about resemblance and never fails because two pages differ.',
  ].join('\n');
}

if (has('--help') || has('-h') || argv.length === 0) {
  const asked = argv.length > 0;
  const text = usage();
  if (asked) console.log(text);
  else console.error(text);
  process.exit(asked ? 0 : 2);
}

const outDir = resolve(flag('--out') || '/tmp');
const againstScreens = has('--against-screens');

function refuse(message, code = 2) {
  console.error(`compare-design-likeness: ${message}`);
  process.exit(code);
}

/// A page is a path. A URL is refused by name rather than fetched, because "no network" is part of what makes two
/// runs of this tool comparable at all, and a tool that silently reached for a dev server would be a second, different
/// instrument wearing this one's name.
function localPage(given, what) {
  if (!given) refuse(`${what} is required.\n\n${usage()}`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(given)) {
    refuse(
      `${what} is "${given}", which is a URL. This tool renders local files from file://, with no network: write the ` +
      'page to disk (or save it from the browser) and pass the path. Fetching a live page here would make two runs ' +
      'incomparable and would need a server this tool deliberately does not start.',
    );
  }
  const absolute = resolve(process.cwd(), given);
  if (!existsSync(absolute)) {
    refuse(`no such file: ${absolute} (${what}). Paths resolve from ${process.cwd()}.`);
  }
  if (!statSync(absolute).isFile()) refuse(`${absolute} (${what}) is not a file.`);
  return absolute;
}

/// How a path is printed in the console and on the sheet: relative to where the command was run when that is shorter
/// and still unambiguous, and absolute otherwise. A reader has to be able to open what the label names.
function displayPath(absolute) {
  const fromCwd = relative(process.cwd(), absolute);
  if (fromCwd && !fromCwd.startsWith(`..${sep}`) && fromCwd !== '..') return fromCwd;
  return absolute;
}

/// The file name carries both sides and the theme, so a reader knows what a sheet is without opening it. The prefix
/// strips the repository root, the working directory and the home directory in that order, which is what turns
/// `<home>/DEVELOPIN/wing-controller/desktop/ui/index.html` into `desktop-ui-index`.
function slugFor(absolute) {
  let path = absolute;
  const prefixes = [REPO_ROOT, process.cwd(), homedir()]
    .filter((prefix) => prefix && prefix !== '/')
    .sort((left, right) => right.length - left.length);
  for (const prefix of prefixes) {
    if (path.startsWith(`${prefix}${sep}`)) {
      path = path.slice(prefix.length + 1);
      break;
    }
  }
  const slug = path
    .replace(/\.html?$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'page';
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB (${bytes.toLocaleString('en-US')} bytes)`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes.toLocaleString('en-US')} bytes)`;
}

// ---------------------------------------------------------------------------------------------------------------
// What is being compared. Resolved and checked **before** a browser is started, so a typo costs a message and not a
// render: a page that does not exist would otherwise be captured as Chrome's own file-not-found screen, and a sheet
// labelled with the application's path would be a picture of an error page wearing the wrong name.
// ---------------------------------------------------------------------------------------------------------------
const leftAbs = localPage(flag('--left'), '--left');
const leftDisplay = displayPath(leftAbs);
const leftSlug = slugFor(leftAbs);

// A sheet always reads left to right as "what it should look like" then "what it does look like". In the compare mode
// the reference is `--left` - this application's page, in the usual case - and the subject is `--right`. In
// `--against-screens` the reference is the **committed record** and the subject is the fresh render of `--left`. The
// two columns are named once, here, and every message and label below is built from that: the arrangement restated in
// four places is how a report ends up describing a picture that is not the one it wrote.
let windowRecord = null; // { window } — --against-screens only
let subjectAbs = null;
let subjectDisplay = null;
if (againstScreens) {
  if (flag('--right')) {
    console.log('compare-design-likeness: --right is ignored with --against-screens:');
    console.log('  the right-hand column is the fresh render of --left.');
  }
  const name = basename(leftAbs).replace(/\.html?$/i, '').toLowerCase();
  const window = WINDOWS.find((entry) => entry.name === name);
  if (!window) {
    refuse(
      `--against-screens compares a window of this application with its committed record, so --left must be one of ` +
      `${WINDOWS.map((entry) => entry.file).join(', ')}; got ${leftDisplay} (which would look for ` +
      `design/screens/${name}-<theme>.png).`,
    );
  }
  for (const theme of THEMES) {
    const committed = resolve(REPO_ROOT, 'design/screens', `${window.name}-${theme}.png`);
    if (!existsSync(committed)) {
      refuse(
        `design/screens/${window.name}-${theme}.png does not exist, so there is no record to put the fresh render ` +
        'beside. Refresh the record first (`node scripts/test-design-screens.mjs --write`), then compare.',
      );
    }
  }
  windowRecord = { window };
} else {
  subjectAbs = localPage(flag('--right'), '--right');
  subjectDisplay = displayPath(subjectAbs);
}

// ---------------------------------------------------------------------------------------------------------------
// The render. One private Chrome, one tab: each page in both themes.
// ---------------------------------------------------------------------------------------------------------------
console.log('compare-design-likeness: two pages, one contact sheet per theme. Nothing here is scored.');
if (againstScreens) {
  console.log(
    `  left column   design/screens/${windowRecord.window.name}-<theme>.png ` +
    `(the committed record of the ${windowRecord.window.label.toLowerCase()})`,
  );
  console.log(`  right column  ${leftDisplay} (rendered now)`);
} else {
  console.log(`  left column   ${leftDisplay} (the reference)`);
  console.log(`  right column  ${subjectDisplay} (the page beside it)`);
}
console.log(`  each at ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} (the window as it opens), both themes, file:// with no backend,`);
console.log(`  clock frozen to ${FROZEN_CLOCK}, time zone UTC, two samples per image that must agree.`);
console.log('');

let browser;
let tab;
let chromeVersion = 'unknown';
try {
  browser = await startPrivateBrowser({ log: (line) => console.log(line) });
  chromeVersion = browser.version?.Browser || 'unknown';
  tab = await openTab(browser);
} catch (error) {
  console.error(`compare-design-likeness: could not start a private Chrome (${error.code || 'ERROR'}): ${error.message}`);
  if (browser) await browser.close().catch(() => {});
  process.exit(3);
}

/// One page in one theme, through the renderer's own `capture()`: it is the function that writes `wing_theme`, reloads
/// so the page's own start-up reads it, waits for the fonts and the settle, pins the viewport and refuses an image
/// whose two consecutive samples disagree. Calling it is the point — a second implementation of that discipline is a
/// second answer to what a rendered page is, which is the drift this repository keeps paying for.
async function renderPage(absolute, tag) {
  const url = pathToFileURL(absolute).href;
  const rendered = {};
  for (const theme of THEMES) {
    // The page is offered both theme conventions, and the offer is the only thing added to the renderer's own
    // discipline: `capture()` writes this application's key and class, and `prefers-color-scheme` is the convention
    // every other web application uses. A page that honours either one is shown in both palettes; a page that honours
    // neither renders the same twice and is reported as such below, rather than having a palette invented for it.
    // Measured against the committed record: this changes nothing in this application's own five windows (they carry
    // no `prefers-color-scheme` rule), and `--against-screens` is the check that says so.
    await tab.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    const { bytes, scrollHeight } = await capture(tab, { url, theme });
    rendered[theme] = { bytes, scrollHeight };
    console.log(
      `  ${tag}-${theme}.png  ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}, ${humanBytes(bytes.length)}` +
      (scrollHeight > VIEWPORT_HEIGHT ? ` — the document is ${scrollHeight} px tall, so the image is the window, not the whole page` : ''),
    );
  }
  return rendered;
}

/// Every page this run has to render, and the tag each one is logged under. In `--against-screens` mode the subject
/// column is the same render as the reference role's, so there is exactly one page to capture.
const subjectTag = againstScreens ? leftSlug : slugFor(subjectAbs);
const toRender = [{ abs: leftAbs, display: leftDisplay, tag: leftSlug }];
if (!againstScreens) toRender.push({ abs: subjectAbs, display: subjectDisplay, tag: subjectTag });

const captured = new Map(); // tag → { light, dark }
try {
  for (const side of toRender) captured.set(side.tag, await renderPage(side.abs, side.tag));
} catch (error) {
  console.error(`compare-design-likeness: the render did not finish (${error.code || 'ERROR'}): ${error.message}`);
  await tab.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(3);
}

// A page that comes back identical in both themes did not receive the theme: either it has no dark palette or it uses
// a convention this renderer does not set. Said out loud, because a sheet whose two themes are the same picture can
// otherwise be read as "this page's dark theme matches its light theme", which would be an invented finding.
const notes = [];
for (const side of toRender) {
  const rendered = captured.get(side.tag);
  if (rendered.light.bytes.equals(rendered.dark.bytes)) {
    notes.push(
      `${side.display} rendered identically in both themes: it honours neither this application's "wing_theme" / ` +
      '"theme-dark" convention nor the browser\'s "prefers-color-scheme", which are the two this run offers. Nothing ' +
      'was faked to give it a dark palette.',
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The sheets. Composed in the same private Chrome, with the same two-samples-must-agree rule the windows are held to.
// ---------------------------------------------------------------------------------------------------------------
await mkdir(outDir, { recursive: true });
const sheets = [];
try {
  for (const theme of THEMES) {
    // The sheet's own frame follows the theme it is showing, and the emulated media is set to match so the frame can
    // never be influenced by whichever theme the last render happened to leave behind.
    await tab.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    const columns = [];
    if (againstScreens) {
      const committedPath = resolve(REPO_ROOT, 'design/screens', `${windowRecord.window.name}-${theme}.png`);
      columns.push({
        bytes: readFileSync(committedPath),
        label: `design/screens/${windowRecord.window.name}-${theme}.png`,
        detail: `the committed record · ${theme} theme`,
      });
    } else {
      const left = captured.get(leftSlug)[theme];
      columns.push({
        bytes: left.bytes,
        label: leftDisplay,
        detail: `${theme} theme · document ${left.scrollHeight} px`,
      });
    }
    const subject = captured.get(subjectTag)[theme];
    columns.push({
      bytes: subject.bytes,
      label: againstScreens ? `${leftDisplay} (rendered now)` : subjectDisplay,
      detail: `${theme} theme · document ${subject.scrollHeight} px`,
    });

    const footer = [WHAT_IT_IS, WHAT_IT_CANNOT_DO, ...notes];
    const name = againstScreens
      ? `likeness-record-${windowRecord.window.name}-vs-fresh-${theme}.png`
      : `likeness-${leftSlug}-vs-${subjectTag}-${theme}.png`;

    // In the drift mode the two images are meant to be the same window, so the distance between them is a fact the
    // reader wants — and it is a fact about **change**. It is never computed between two different pages: a pixel count
    // between two designs would be a number pretending to be a resemblance, which is the lie this tool refuses.
    if (againstScreens) {
      const change = countPixelDifferences(await decodePng(columns[0].bytes), await decodePng(columns[1].bytes));
      console.log(`  ${windowRecord.window.name}-${theme}: change, not resemblance — ${change.sentence}`);
      footer.push(
        `change, not resemblance: the fresh render differs from the committed record — ${change.sentence}. ` +
        'That number says the window moved, never that it is right or wrong.',
      );
    }

    const sheet = await composeContactSheet(tab, {
      columns,
      outFile: join(outDir, name),
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      title: `WING CONTROLLER · likeness sheet · ${theme} theme`,
      provenance:
        `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} at scale 1 · file:// · clock ${FROZEN_CLOCK} · TZ UTC · ` +
        `two samples agreed · ${chromeVersion}`,
      footer,
      theme,
    });
    sheets.push(sheet);
    console.log('');
  }
} catch (error) {
  console.error(`compare-design-likeness: the sheet was not written (${error.code || 'ERROR'}): ${error.message}`);
  await tab.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(3);
}

await tab.close().catch(() => {});
await browser.close().catch(() => {});

// ---------------------------------------------------------------------------------------------------------------
// The report. Paths, sizes, and the two sentences that keep this tool honest.
// ---------------------------------------------------------------------------------------------------------------
console.log('sheets written:');
for (const sheet of sheets) {
  console.log(`  ${sheet.file}  ${sheet.width}x${sheet.height}, ${humanBytes(sheet.bytes.length)}`);
}
console.log('');
console.log(`what this is: ${WHAT_IT_IS}`);
console.log(`what it cannot do: ${WHAT_IT_CANNOT_DO}`);
if (notes.length > 0) {
  console.log('');
  for (const note of notes) console.log(`note: ${note}`);
}
console.log('');
console.log('It is a report, not a contract: it is not part of ./scripts/verify-all.sh, it is not named test-*.mjs,');
console.log('and it never exits non-zero because two pages differ. Open the sheets and judge them yourself.');
