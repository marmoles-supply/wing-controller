// A contact sheet: two (or more) images side by side at their own pixel size, each labelled, with a divider between
// them — composed in the same private Chrome this repository renders its windows in.
//
// Why Chrome composes the picture. The repository has no drawing library and deliberately does not grow one; pasting
// pixels together by hand would need a font rasteriser for the labels, which is a dependency and a second opinion
// about type. Chrome already has the fonts, the layout and the one PNG encoder the visual record is taken with, so a
// sheet is a **page** and the sheet's picture is a screenshot of it. Reading an image stays where it already lives:
// `scripts/lib/design-screens.mjs` decodes a PNG (its size, and the difference between two of them), and this module
// imports that rather than opening a second door onto `pngjs`.
//
// Determinism is the renderer's, not a new promise: fixed pixel sizes (each column is exactly as wide as the image it
// shows), no animation or transition (the frozen stylesheet is injected on every document by `openTab`), no clock in
// the picture, and — the rule this module exists to keep — **the sheet is captured twice and the two captures must be
// byte-identical**, exactly as a window is. A sheet that is still moving is refused rather than written.
//
// What a sheet is **not**: a measurement. Nothing here compares the two images, counts their difference or scores a
// resemblance; it places them at the same size and gets out of the way. See `scripts/compare-design-likeness.mjs`.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { decodePng } from './design-screens.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/// The page tells this module when it is ready: every image decoded at its natural size and every font placed. It is
/// a bounded poll by **attempt count**, never by `Date.now()` — the page runs under the renderer's frozen clock, so a
/// deadline measured inside it would never arrive and a broken sheet would hang instead of saying so.
const READY_EXPRESSION = `new Promise((resolve, reject) => {
  let tries = 0;
  const check = () => {
    const images = Array.from(document.images);
    const ready = document.readyState === 'complete' && images.length > 0 &&
      images.every((image) => image.complete && image.naturalWidth > 0) &&
      (!document.fonts || document.fonts.status === 'loaded');
    if (ready) { resolve(true); return; }
    tries += 1;
    if (tries > 400) { reject(new Error('the contact sheet never finished loading its images and fonts')); return; }
    setTimeout(check, 25);
  };
  check();
})`;

/// Compose one sheet and write it to `outFile`.
///
/// `columns` are `{ bytes, label, detail }`: the PNG as it came from the renderer (or from the record on disk), the
/// path a reader needs in order to know what they are looking at, and the line under it (theme, size, how far the
/// document scrolls). Every column must be the same pixel size — the whole point of the sheet is that the two things
/// are shown at one size — and a caller that hands over mismatched images gets a refused render, not a stretched one.
///
/// `footer` is a list of lines printed under the images: what the sheet is, what the tool cannot do, and any note the
/// caller measured (a page that rendered identically in both themes, for example).
export async function composeContactSheet(tab, {
  columns,
  outFile,
  title,
  provenance = '',
  footer = [],
  theme = 'light',
  settleMs = 260,
  width = null,
  height = null,
} = {}) {
  if (!Array.isArray(columns) || columns.length < 2) throw new Error('a contact sheet needs at least two columns');
  if (!outFile) throw new Error('composeContactSheet needs an outFile');

  const scratch = await mkdtemp(join(tmpdir(), 'wing-contact-sheet-'));
  const sizes = [];
  const files = [];
  for (const [index, column] of columns.entries()) {
    if (!column?.bytes) throw new Error(`column ${index + 1} has no image bytes`);
    const image = await decodePng(column.bytes);
    sizes.push({ width: image.width, height: image.height });
    const file = join(scratch, `column-${index + 1}.png`);
    await writeFile(file, column.bytes);
    files.push(file);
  }
  const first = sizes[0];
  const oddSize = sizes.find((size) => size.width !== first.width || size.height !== first.height);
  if (oddSize) {
    throw new Error(
      `the sheet's images are not the same size: ${first.width}x${first.height} against ${oddSize.width}x${oddSize.height}. ` +
      'A sheet that silently stretched one of them would be a picture nobody can judge from, so this render is refused.',
    );
  }
  if (width && height && (width !== first.width || height !== first.height)) {
    throw new Error(`the caller expected ${width}x${height} images and the columns are ${first.width}x${first.height}`);
  }

  const html = buildHtml({ columns, files, sizes: first, title, provenance, footer, theme });
  const htmlFile = join(scratch, 'sheet.html');
  await writeFile(htmlFile, html);

  // The load watcher is registered **before** the navigation: a local page can fire `load` between the response to
  // `Page.navigate` and the next line, and a watcher registered after that waits for an event that has already
  // happened. `Page.navigate` failing is the only case where the promise is not awaited, and then it is swallowed so
  // a leak cannot surface as an unrelated rejection fifteen seconds later.
  const loaded = tab.waitForEvent('Page.loadEventFired');
  try {
    await tab.call('Page.navigate', { url: pathToFileURL(htmlFile).href });
  } catch (error) {
    loaded.catch(() => {});
    throw error;
  }
  await loaded;
  await tab.evaluate(READY_EXPRESSION);
  await sleep(settleMs);

  // The viewport is set to the sheet's own measured size, so "the picture" and "the page" are the same rectangle and
  // a capture cannot quietly crop the footer off. The layout is fixed-width, so pinning the metrics does not reflow
  // it — and that is checked rather than assumed: a sheet whose size moved under the metrics is refused.
  const measured = await measureSheet(tab);
  await tab.call('Emulation.setDeviceMetricsOverride', {
    width: measured.width,
    height: measured.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(settleMs);
  const after = await measureSheet(tab);
  if (after.width !== measured.width || after.height !== measured.height) {
    throw new Error(
      `the contact sheet changed size while its viewport was pinned (${measured.width}x${measured.height} became ` +
      `${after.width}x${after.height}); the picture would be cropped. The sheet must not size itself with viewport units.`,
    );
  }
  await assertImagesAtWholePixels(tab, first);

  let bytes = await shoot(tab);
  await sleep(settleMs);
  const again = await shoot(tab);
  if (!bytes.equals(again)) {
    throw Object.assign(
      new Error(
        `the contact sheet ${htmlFile} did not stop moving between two captures ${settleMs} ms apart. ` +
        'A sheet that would differ on the next run is refused rather than written.',
      ),
      { code: 'NOT_STABLE' },
    );
  }
  await writeFile(outFile, bytes);
  // The working copy - the two column images and the sheet's own HTML - goes only on success. A refused render leaves
  // it behind on purpose: the sentence that refused it names this page, and the page is the one thing a reader can
  // open to see what the capture was looking at.
  await rm(scratch, { recursive: true, force: true }).catch(() => {});
  return { file: outFile, width: measured.width, height: measured.height, bytes };
}

async function measureSheet(tab) {
  const box = await tab.evaluate(
    '(() => { const el = document.querySelector(".sheet"); const r = el.getBoundingClientRect();' +
    ' return { width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()',
  );
  if (!box || !box.width || !box.height) throw new Error('the contact sheet has no measurable size');
  return box;
}

/// Every image must sit at a whole pixel and at its own size.
///
/// The whole-pixel part is not tidiness. An image whose top edge lands on a half-pixel is **resampled** by the
/// compositor, and two runs of the same command were measured to differ by 66 pixels in a single row that way, in one
/// theme and not the other — a sheet that would differ from the next one is not a record, so it is refused here rather
/// than mislabelled as a change in the pages. The size part is the sheet's whole premise: the two pages are shown at
/// one size, so a scaled image is refused rather than silently stretched.
async function assertImagesAtWholePixels(tab, sizes) {
  const rects = await tab.evaluate(
    'Array.from(document.images).map((image) => { const r = image.getBoundingClientRect();' +
    ' return { x: r.x, y: r.y, width: r.width, height: r.height }; })',
  );
  if (!Array.isArray(rects) || rects.length === 0) throw new Error('the contact sheet has no images to check');
  for (const [index, rect] of rects.entries()) {
    if (rect.width !== sizes.width || rect.height !== sizes.height) {
      throw new Error(
        `the sheet drew column ${index + 1} at ${rect.width}x${rect.height} and the image is ` +
        `${sizes.width}x${sizes.height}: the sheet shows each page at its own size, so a scaled image is refused ` +
        'rather than written.',
      );
    }
    if (![rect.x, rect.y, rect.width, rect.height].every((value) => Number.isInteger(value))) {
      throw new Error(
        `the sheet drew column ${index + 1} at a fractional position (x=${rect.x}, y=${rect.y}): an image on a ` +
        'half-pixel is resampled by the compositor, and two runs of the same command can then differ by a row of ' +
        'pixels in a picture that is supposed to be reproducible. Keep the sheet furniture (line-height, padding, ' +
        'border) at whole-pixel heights.',
      );
    }
  }
}

async function shoot(tab) {
  const shot = await tab.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    // Not `captureBeyondViewport`: the viewport was pinned to the sheet's own size, so the viewport **is** the sheet.
    captureBeyondViewport: false,
    optimizeForSpeed: false,
  });
  return Buffer.from(shot.data, 'base64');
}

function buildHtml({ columns, files, sizes, title, provenance, footer, theme }) {
  const figures = columns.map((column, index) => `
      <figure class="column">
        <figcaption>
          <span class="path">${escapeHtml(column.label)}</span>
          <span class="detail">${escapeHtml(column.detail || '')}</span>
        </figcaption>
        <img src="${pathToFileURL(files[index]).href}" width="${sizes.width}" height="${sizes.height}"
             alt="${escapeHtml(column.label)}">
      </figure>`);
  const row = figures.join('\n      <div class="divider" role="separator"></div>');
  const footerHtml = footer
    .filter((line) => String(line || '').trim().length > 0)
    .map((line) => `    <p>${escapeHtml(line)}</p>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!-- The kit's tokens, so the frame around the comparison is drawn with the same furniture as the application it is
     about; the fallbacks in the sheet's own rules keep it legible if the link is ever unavailable. -->
<link rel="stylesheet" href="${escapeHtml(kitTokensUrl())}">
<style>
  html, body { margin: 0; padding: 0; background: var(--face, #c0c0c0); }
  /* Every vertical measurement here is a whole number of pixels, and that is not tidiness: an image whose top edge
     lands on a fractional y is resampled by the compositor, and two runs of the same command then differ by a row of
     pixels in the picture. Measured: with a 1.35 line-height the columns sat at y = 61.4, and the dark sheet of the
     same command came back 66 pixels different between two runs — all of them in the single row where that
     half-pixel landed. The guard below refuses a fractional placement rather than hoping the compositor rounds it the
     same way twice. */
  body {
    color: var(--ink, #000000);
    font-family: var(--win-font, Geneva, sans-serif);
    font-size: 12px;
    line-height: 15px;
    --sheet-face: var(--face, #c0c0c0);
    --sheet-face-2: var(--face-2, #d4d0c8);
    --sheet-ink: var(--ink, #000000);
    --sheet-muted: var(--muted, #404040);
    --sheet-line: var(--line, #808080);
  }
  body.theme-dark {
    --sheet-face: var(--face, #222726);
    --sheet-face-2: var(--face-2, #2b3230);
    --sheet-ink: var(--ink, #e0e8e4);
    --sheet-muted: var(--muted, #93a49d);
    --sheet-line: var(--line, #343c3a);
  }
  .sheet { display: inline-block; background: var(--sheet-face); color: var(--sheet-ink); }
  .bar {
    display: flex; justify-content: space-between; align-items: baseline;
    height: 15px; padding: 6px 12px; background: var(--sheet-face-2); border-bottom: 1px solid var(--sheet-line);
  }
  .bar .name { font-weight: bold; letter-spacing: 0.02em; }
  .bar .facts { font-family: var(--mono, monospace); font-size: 10px; line-height: 15px; color: var(--sheet-muted); }
  .row { display: flex; align-items: stretch; padding: 10px 12px; }
  figure.column { margin: 0; width: ${sizes.width}px; }
  figure.column figcaption {
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
    height: 15px; padding: 0 2px 6px;
  }
  figure.column .path { font-family: var(--mono, monospace); font-size: 12px; line-height: 15px; font-weight: bold; }
  figure.column .detail { font-size: 11px; line-height: 15px; color: var(--sheet-muted); text-align: right; }
  figure.column img { display: block; width: ${sizes.width}px; height: ${sizes.height}px; }
  .divider { width: 2px; margin: 0 16px; background: var(--sheet-line); }
  .foot { padding: 8px 12px 10px; border-top: 1px solid var(--sheet-line); background: var(--sheet-face-2); }
  .foot p { margin: 0 0 2px; font-size: 11px; line-height: 15px; }
  .foot p:last-child { margin-bottom: 0; }
</style>
</head>
<body${theme === 'dark' ? ' class="theme-dark"' : ''}>
  <div class="sheet">
    <div class="bar">
      <span class="name">${escapeHtml(title)}</span>
      <span class="facts">${escapeHtml(provenance)}</span>
    </div>
    <div class="row">${row}
    </div>
    <div class="foot">
${footerHtml}
    </div>
  </div>
</body>
</html>
`;
}

/// The canonical sheet is read from the repository **at run time** and linked, never transcribed: the frame around a
/// comparison of this application's design is drawn with this application's own kit or it is not drawn at all.
function kitTokensUrl() {
  return new URL('../../design/tokens.css', import.meta.url).href;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
