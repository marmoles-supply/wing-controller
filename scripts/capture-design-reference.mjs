#!/usr/bin/env node
// Re-capture `design/reference/`: the images of **`design/specimen.html`**, in both themes on one page.
//
//   node scripts/capture-design-reference.mjs            # write the four bands into design/reference/
//   node scripts/capture-design-reference.mjs --dry-run  # render and report, write nothing
//
// Why this exists as a command rather than as a paragraph of instructions. The four images were first captured by hand
// on 2026-10-08 and `design/reference/README.md` recorded the recipe — "open the page at 1600 px and screenshot it" —
// but not **which part of the page** each image was. When the specimen changed the same day (four instrument steps,
// and the kit's base moving to 1.25) the images could not be refreshed: a re-capture would have been a new photograph
// wearing the old captions. This script is the missing half of that record: the bands are page coordinates in one
// table, the table is what the README prints, and a re-run is therefore a refresh.
//
// How a band is taken, and why it is reproducible:
//
//   * the same private Chrome the window lock uses (`scripts/lib/design-screens.mjs`): a fresh profile, a free port
//     (never 9223), 1600 px wide, device scale factor 1, font hinting off, the time zone pinned to UTC and the clock
//     frozen — so a page that prints a time prints the same time next year;
//   * a band is a **page coordinate** (`y`) and a **height**, not a scroll offset: a scroll offset depends on the
//     viewport, a page coordinate does not;
//   * the band is captured **twice** and the two images must be byte-identical, or the render is refused and nothing
//     is written — an image that would differ on the next run is not a record. The third band holds the
//     `--meter-ramp` gradient, whose Skia dither flips its swatch by one code point on about one pair in ten
//     (measured 2026-10-08; the numbers are in `scripts/lib/design-screens.mjs` and in `design/reference/README.md`),
//     so a band is given up to three attempts — each of them still requiring two byte-identical captures — before it
//     is refused. Run this command again on such a refusal: it is the rasteriser, not the page;
//   * the page's own height is measured and checked against the last band's end, so a page that grew cannot silently
//     leave its foot out of the record.
//
// The bands are cut at section boundaries of `design/specimen.html` (the `<h3>` sections), so each image's caption in
// the README is true of the whole image. `design/reference/README.md` carries the same numbers in a table; this file
// is the authority and the README points at it.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REPO_ROOT,
  VIEWPORT_WIDTH,
  captureBand,
  openTab,
  startPrivateBrowser,
} from './lib/design-screens.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPECIMEN = resolve(HERE, '../design/specimen.html');
const REFERENCE_DIR = resolve(HERE, '../design/reference');

/// The readiness flag the page sets for itself when both theme columns are built and the measured values are filled
/// in (`design/specimen.html`). Capturing before it is set is capturing a half-drawn page.
const READY = 'document.body.dataset.specimenReady === "1"';

/// The three attempts one band is given before the render is refused. Not a tolerance: **each** attempt still demands
/// two byte-identical captures, and a band that never agrees is still refused. It exists because the third band holds
/// the `--meter-ramp` gradient, whose Skia dither LUT flips the swatch by one code point roughly once in ten pairs
/// (measured 2026-10-08: 13 of 120 pairs — the measurement and its region are in the header of
/// `scripts/lib/design-screens.mjs`, and `design/reference/README.md` records the first sighting). Without the retry a
/// refresh run stops on the rasteriser's coin flip and writes nothing.
const BAND_ATTEMPTS = 3;

/// The four bands, in page order, each cut at a section boundary of the specimen. `y` and `height` are page
/// coordinates at 1600 px wide; `image` is the file in `design/reference/`; `shows` is the caption the README carries,
/// and it names only what the band actually contains.
export const BANDS = [
  {
    image: 'specimen-components-both-themes.png',
    y: 0,
    height: 1412,
    shows: 'How to read the page, every component of `UI_SYSTEM.md` §8 — window, panel, card, row, well, field, chip, badge, band, rail, and tonight\'s `meter` — including the `select` with the arrow `components.css` draws, the button in both its states, the card whose head now carries a live `Follow` control on the kit\'s own `card-head-row`, and the two bevels with the `--line-*` step each edge resolves to',
  },
  {
    image: 'specimen-colour-tokens-both-themes.png',
    y: 1412,
    height: 1632,
    shows: 'The face and the window furniture, the three weights of ink, and the four bevel line steps — one card per token, the light value beside the dark',
  },
  {
    image: 'specimen-instrument-and-type-both-themes.png',
    y: 3044,
    height: 1052,
    shows: 'The meaning colours of §5, and the instrument: the `--crt` well and its phosphor, the meter ramp, and the `--meter-scale` knob',
  },
  {
    image: 'specimen-type-and-space-both-themes.png',
    y: 4096,
    height: 1337,
    shows: 'The type section — the two families and every step the kit declares with the size it measured, including tonight\'s `--leading-base` line box drawn on three wrapped lines — the space grid, and the composition layer\'s two values (the desktop the windows stand on, and the operator column\'s width), down to the foot of the page',
  },
];

/// The last band must end at the foot of the page: a band that stopped short would be a record that quietly leaves
/// the end of the document out, and one that ran past it would be a record with blank paper in it.
export function bandsProblem(pageHeight) {
  const last = BANDS[BANDS.length - 1];
  const end = last.y + last.height;
  if (end !== pageHeight) {
    return (
      `design/specimen.html is ${pageHeight} px tall and the bands cover ${end} px: ` +
      `the last band (y ${last.y}, height ${last.height}) no longer reaches the foot of the page. ` +
      'Re-cut the bands at a section boundary and update this table and design/reference/README.md together.'
    );
  }
  const gaps = [];
  for (let index = 1; index < BANDS.length; index += 1) {
    const previous = BANDS[index - 1];
    if (previous.y + previous.height !== BANDS[index].y) gaps.push(`${previous.image} -> ${BANDS[index].image}`);
  }
  if (gaps.length) return `the bands do not meet: ${gaps.join(', ')}`;
  return null;
}

function show(path) {
  const inside = relative(REPO_ROOT, path);
  return inside.startsWith('..') ? path : inside;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const browser = await startPrivateBrowser({ log: (line) => console.log(line.trimEnd()) });
  let exitCode = 0;
  try {
    const tab = await openTab(browser);
    try {
      await tab.call('Page.navigate', { url: `file://${SPECIMEN}` });
      await tab.waitForEvent('Page.loadEventFired');
      const pageHeight = await tab.evaluate(`(() => {
        const layout = document.documentElement;
        return Math.ceil(Math.max(layout.scrollHeight, document.body.scrollHeight));
      })()`);
      const problem = bandsProblem(pageHeight);
      if (problem) {
        console.error(`design-reference: ${problem}`);
        process.exitCode = 1;
        return;
      }
      if (!dryRun) await mkdir(REFERENCE_DIR, { recursive: true });
      console.log(`design-reference: design/specimen.html is ${pageHeight} px tall at ${VIEWPORT_WIDTH} px wide`);
      for (const band of BANDS) {
        const { bytes } = await captureBand(tab, {
          url: `file://${SPECIMEN}`,
          y: band.y,
          height: band.height,
          readyExpression: READY,
          attempts: BAND_ATTEMPTS,
        });
        if (!dryRun) await writeFile(join(REFERENCE_DIR, band.image), bytes);
        console.log(
          `  ${band.image.padEnd(46)} y ${String(band.y).padStart(4)} + ${String(band.height).padStart(4)} px` +
          `  ${VIEWPORT_WIDTH}x${band.height}, ${bytes.length} bytes${dryRun ? '  (dry run, not written)' : ''}`,
        );
      }
      console.log(
        dryRun
          ? 'design-reference: nothing was written; run without --dry-run to refresh the images'
          : `design-reference: wrote ${BANDS.length} image(s) into ${show(REFERENCE_DIR)} — commit them with the change they show`,
      );
    } finally {
      await tab.close();
    }
  } finally {
    await browser.close();
  }
  if (process.exitCode) process.exit(process.exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
