// The application's windows, rendered to PNG **deterministically** — the one place that knows how.
//
// `design/screens/` is the visual record of what this application looks like, and its lock
// (`scripts/test-design-screens.mjs`) renders the same images a second time and compares them. That lock is worth
// nothing unless a second render is a **byte-identical** file, so determinism is not a nicety here: it is the
// contract this module exists to keep. Four things make it true, and each one is a decision:
//
//   1. **A browser of its own, on a private port, with a fresh profile.** Never port 9223 (`AGENTS.md`: the gate
//      SIGKILLs whatever holds that port), never the gate's browser, never a profile that carries yesterday's
//      `localStorage`. Chrome is started headless with `--force-device-scale-factor=1` and
//      `--font-render-hinting=none`, and the two of those together are what make the same pixels come back.
//   2. **A fixed viewport** (1600 px wide: the same width the kit's own reference images use) and a capture that
//      grows to the page's full height, so the record shows the whole window rather than a fold.
//   3. **Motion is frozen by injection, not by waiting.** Every animation, transition, caret blink and scroll
//      behaviour is switched off with one stylesheet, and the page is sampled **twice** and required to be identical
//      before the image is accepted. A capture that caught a 400 ms pulse at t=390 ms would differ between runs and
//      the lock would report a change nobody made.
//   4. **No network and no clock in the image.** The pages are opened as `file://`, the window is left with no
//      Tauri backend (so its clock reads `--:--:--:--` and its status line says it is not running with the backend),
//      and nothing is downloaded. The version string the HTML carries is the one thing in the image that a release
//      changes, and that is deliberate: a new version is a new picture, and the lock should say so.
//
// The honest limit is the README's, and this module cannot fix it: this renders **change**, not resemblance.
//
// ---------------------------------------------------------------------------------------------------------------
// KNOWN LIMIT: the meter-ramp band flakes, and it is Skia's dither, not our page. Measured 2026-10-08.
// ---------------------------------------------------------------------------------------------------------------
// `design/reference/README.md` §"Refreshing these images" recorded this first, from the agent that re-cut the bands:
// one double capture of the third band was refused in ten pairs and the command passed on the next run. Reproduced
// here, and then measured properly:
//
//   * **Baseline, 2026-10-08, on this machine** (Chrome/155.0.8059.40): **13 of 120** capture pairs of the band
//     `y=3044 h=1052` of `design/specimen.html` differed, in **6 of 12** sessions. The differing pixels are always
//     `1438 of 1683200 (0.085%), in the region x 21..1578, y 934..947 (1558x14)` — in **page** coordinates
//     `y 3978..3991`, which is exactly `.ramp-demo`, the `--meter-ramp` `linear-gradient` — and always **±1 in one
//     channel** (`rgb(0,172,107)` against `rgb(0,172,108)`).
//   * The rate is **clustered by session, not per capture**: whole sessions (30 and 40 pairs) took zero differences
//     while others took 10–30 %. A single 10-pair run therefore proves nothing either way — which is how the first
//     candidate flag looked like a fix at 0 of 30 and then measured 12 of 120 in an interleaved rerun.
//   * The cost, and it is real: `captureBand()` refuses a band whose two captures differ, so a refresh run that
//     meets a flaky session stops with that sentence and writes nothing — the agent that re-cut the bands met it
//     once in ten runs, and it reproduced here on the first session tried. With a three-attempt budget (the
//     `attempts` `capture-design-reference.mjs` passes) **14 of 14** consecutive dry runs completed; the underlying
//     per-pair rate is unchanged by it, which is the point: the budget buys another pair, not a tolerance.
//
// **What it is.** The ±1 is Skia's dither shader. The Chrome build here carries
// `sk_dither(half4 a, half b, sampler2D c) { half e = sample(c, sk_FragCoord.xy*.125).x - .5; ... }` — a LUT texture
// indexed by fragment coordinate at 1/8-pixel granularity, which is why the difference is sub-8-bit and why it covers
// **all 14 rows of the swatch in one capture** rather than scattering. Skia also warns when it cannot build that LUT
// (`Couldn't create dither shader's LUT`), and `emulateDithering` / `VK_EXT_legacy_dithering` / `Render pass closed
// due to updating legacy dither` are in the same build. The LUT's contents are produced at runtime, and a
// re-rasterisation picks up a different one. It is a property of the **rasteriser**, not of the page: nothing in
// `design/specimen.html` changes between the two captures.
//
// **What was tried, and why it is not pinned.** Ten launch configurations were measured against the default,
// interleaved session by session so a quiet period could not favour one:
//
//   | candidate | pairs that differed | the picture |
//   |---|---|---|
//   | default | 13 of 120 | (the committed images: 140427 bytes for that band) |
//   | `--disable-partial-raster` | 12 of 120 | **byte-identical** |
//   | `--disable-accelerated-2d-canvas`, `--disable-features=CanvasOopRasterization`, `--disable-zero-copy`, `--force-color-profile=srgb` | 0 of the pairs tried | **byte-identical** |
//   | `--disable-gpu`, `--disable-gpu-rasterization`, `--disable-gpu-compositing` | 0 of the pairs tried | **2.0–3.5 % of the frame differs** (143282 bytes) |
//
// The four byte-identical flags are not pins: `--disable-partial-raster` was tested under the interleaved design that
// caught the false lead and it flakes at the same rate, **in the same sessions**, with the same region and the same
// ±1. The flags that do quiet the rasteriser do not pin it either — they **replace the picture**, and the committed
// `design/reference/*.png` are default-path images (the band above is 140427 bytes on both). Adopting one would make
// every band the command writes differ from the set in the repository, and refreshing `design/reference/**` is not
// this module's decision to take.
//
// **So the comparison stays exact.** A tolerance for "small" differences would be a mute button: this lock is the
// only thing between a changed window and a green build, and 1438 pixels in one place is exactly the size of a real
// change. The response to a refusal is to **run the capture again** — it is a coin flip on the rasteriser, not a
// signal about the page. A refusal that repeats every time, or that names a region other than this swatch or a
// difference larger than one code point, is not this: read it as a change and look at the page.
//
// If a future agent wants this genuinely pinned, the honest route is a rendering path whose dither LUT is
// deterministic (and then, deliberately, a refresh of every band in `design/reference/**` in the same commit), not a
// looser comparison here.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/// The size every screen image is taken at: **the window's own size**, not the page's full scroll height. What a
/// person reviews is the window as it opens, and the main window and the guide are taller than one screenful, so the
/// scrollable height is measured as well and reported (the lock prints it, and the README carries it) — a record that
/// quietly cropped half a window would be the same defect as a stale one. The rejected alternative was one 1600x1919
/// image of the main window: it stops ten images of five windows being comparable at a glance, and a record is a
/// picture of a window, not of a document.
export const VIEWPORT_WIDTH = 1600;
export const VIEWPORT_HEIGHT = 1000;

/// The two themes, as the application names them. The key is the one every window writes and reads.
export const THEMES = ['light', 'dark'];

/// The windows of the application, in the order the README describes them. `file` is what is opened; `name` is the
/// stem of the images in `design/screens/`. A new window is added **here** and then its two images are written with
/// `--write`; nothing else has a list of windows.
export const WINDOWS = [
  { name: 'index', file: 'index.html', label: 'Main control window' },
  { name: 'meters', file: 'meters.html', label: 'Live meter bridge' },
  { name: 'timecode', file: 'timecode.html', label: 'Timecode (MTC) clock' },
  { name: 'ltc', file: 'ltc.html', label: 'LTC cue list' },
  { name: 'guide', file: 'guide.html', label: 'Complete guide' },
];

const CHROME_BIN = process.env.WING_CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/// Where a fresh render goes when a caller does not say. Always `/tmp`: a test that rendered into `design/screens/`
/// would be a test that rewrites the artefact it is checking, which is a test that can never fail.
export async function scratchDirectory(prefix = 'wing-screens') {
  return await mkdtemp(join(tmpdir(), `${prefix}-`));
}

/// The stylesheet that freezes the page. Injected as the **first** rule on every document (including after a
/// reload), because a transition that starts before it lands is a transition the capture can catch half-done.
const FREEZE_CSS = `*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  animation-play-state: paused !important;
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

/// The wall clock every rendered page is given, so that the time the window prints is part of the record rather than
/// a property of the moment somebody ran it. Without this, `index.html`'s session log stamps each line with
/// `new Date().toLocaleTimeString()` and **two runs of the same tree produce two different images** — measured:
/// 119 pixels in the log pane differed between two independent renders, and that alone would have made the lock
/// fail on a tree nobody changed.
///
/// The frozen time is deliberately a round number in the local zone, so a reader who sees `09:00:00` in a captured
/// log knows it is the render's own stamp and not a real session's. `Date.now`, `new Date()`, `performance.now()` and
/// `requestAnimationFrame`'s timestamp are all pinned to it; nothing else about the page is altered.
export const FROZEN_CLOCK = '2026-01-01T09:00:00Z';

function clockFreezeSource(epochMs) {
  return `(() => {
    const FROZEN = ${epochMs};
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(FROZEN); else super(...args); }
      static now() { return FROZEN; }
    }
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    try { Object.defineProperty(window, 'Date', { configurable: true, writable: true, value: FrozenDate }); }
    catch (_) { window.Date = FrozenDate; }
    if (window.performance) {
      try { Object.defineProperty(window.performance, 'now', { configurable: true, writable: true, value: () => 0 }); }
      catch (_) { }
    }
    if (window.requestAnimationFrame) {
      const realRaf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => realRaf(() => callback(0));
    }
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(FREEZE_CSS)};
    const attach = () => { if (document.head) document.head.appendChild(style); };
    if (document.head) attach(); else document.addEventListener('DOMContentLoaded', attach, { once: true });
    window.addEventListener('load', attach, { once: true });
  })();`;
}

export function windowsByName(names) {
  if (!names || names.length === 0) return WINDOWS;
  const wanted = new Set(names);
  const chosen = WINDOWS.filter((window) => wanted.has(window.name));
  const unknown = [...wanted].filter((name) => !WINDOWS.some((window) => window.name === name));
  if (unknown.length > 0) {
    throw new Error(`no such window: ${unknown.join(', ')} — the windows are ${WINDOWS.map((w) => w.name).join(', ')}`);
  }
  return chosen;
}

/// A Chrome of this module's own. `close()` is idempotent and kills the processes it started **and only those**
/// (matched by its own profile directory), so a run that dies half-way does not leave a browser holding the port.
export async function startPrivateBrowser({ port = 0, log = () => {} } = {}) {
  if (!existsSync(CHROME_BIN)) {
    throw Object.assign(new Error(`no Chrome at ${CHROME_BIN}: install it or set WING_CHROME_BIN`), { code: 'NO_CHROME' });
  }
  const profile = await mkdtemp(join(tmpdir(), 'wing-screens-chrome-'));
  const chosen = port || (await freePort());
  const args = [
    '--headless=new',
    `--remote-debugging-port=${chosen}`,
    `--user-data-dir=${profile}`,
    `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--lang=en-US',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-client-side-phishing-detection',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-pings',
    '--disable-remote-fonts',
    '--font-render-hinting=none',
    'about:blank',
  ];
  const child = spawn(CHROME_BIN, args, {
    stdio: 'ignore',
    detached: false,
    // The time zone is part of the picture when a window prints a time, so it is pinned here as well as in the
    // browser: a record taken in Madrid and compared in London would otherwise differ by an hour of log line.
    env: { ...process.env, TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
  });
  const debug = `http://127.0.0.1:${chosen}`;
  const deadline = Date.now() + 30000;
  let version = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${debug}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) { version = await response.json(); break; }
    } catch (_) { /* not up yet */ }
    await sleep(200);
  }
  if (!version) {
    try { child.kill('SIGKILL'); } catch (_) {}
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    throw Object.assign(new Error(`the private Chrome did not answer its debug port (${debug}) within 30 s`), { code: 'NO_BROWSER' });
  }
  log(`  private Chrome ${version.Browser} on ${debug} (profile ${profile})`);
  let closed = false;
  const close = async ({ removeProfile = true } = {}) => {
    if (closed) return;
    closed = true;
    try { child.kill('SIGKILL'); } catch (_) {}
    // The renderer and GPU helpers do not always take the parent's signal with them; the profile path is the one
    // string only this instance carries, which is why it is matched rather than a pkill on "Chrome".
    await runQuiet('pkill', ['-9', '-f', profile]);
    if (removeProfile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  return { port: chosen, debug, profile, version, close, child };
}

/// Render every requested window in every theme into `outDir`, in a fixed order, returning one entry per image with
/// its raw bytes. `onImage({ window, theme, bytes, width, height })` is called as each one lands.
export async function renderScreens({
  outDir,
  names,
  themes = THEMES,
  repo = REPO_ROOT,
  browser,
  settleMs = 260,
  log = () => {},
  onImage = null,
} = {}) {
  const windows = windowsByName(names);
  if (!outDir) throw new Error('renderScreens needs an outDir');
  await mkdir(outDir, { recursive: true });
  const own = !browser;
  const instance = browser || (await startPrivateBrowser({ log }));
  const results = [];
  try {
    const tab = await openTab(instance);
    try {
      for (const window of windows) {
        const url = `file://${resolve(repo, 'desktop/ui', window.file)}`;
        for (const theme of themes) {
          const { bytes, scrollHeight } = await capture(tab, { url, theme, settleMs });
          const file = join(outDir, `${window.name}-${theme}.png`);
          await writeFile(file, bytes);
          const entry = {
            window: window.name,
            label: window.label,
            theme,
            file,
            bytes,
            width: VIEWPORT_WIDTH,
            height: VIEWPORT_HEIGHT,
            scrollHeight,
          };
          results.push(entry);
          log(
            `  ${window.name}-${theme}.png  ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}, ${bytes.length} bytes` +
            (scrollHeight > VIEWPORT_HEIGHT ? ` (the window scrolls to ${scrollHeight} px)` : ''),
          );
          if (onImage) await onImage(entry);
        }
      }
    } finally {
      await tab.close();
    }
  } finally {
    if (own) await instance.close();
  }
  return results;
}

/// One image, and the height the window scrolls to. Exported because the lock's failure path, the README's numbers
/// and the proof of the lock all need to take exactly one.
export async function capture(tab, { url, theme, settleMs = 260 }) {
  await tab.call('Page.navigate', { url });
  await tab.waitForEvent('Page.loadEventFired');
  await waitFor(tab, 'document.readyState === "complete" && !!document.body', 15000);
  // The theme is written **and then the page is reloaded**, rather than only toggling the class afterwards: the
  // window's own script reads the key at start-up, and a class set from outside could be undone by the next render
  // of it. Writing the key is what the operator does, and a reload is what makes it take.
  await tab.evaluate(`localStorage.setItem('wing_theme', ${JSON.stringify(theme)})`);
  await tab.call('Page.reload', { ignoreCache: false });
  await tab.waitForEvent('Page.loadEventFired');
  await waitFor(tab, 'document.readyState === "complete" && !!document.body', 15000);
  await tab.evaluate(`document.body.classList.toggle('theme-dark', ${JSON.stringify(theme)} === 'dark')`);
  await tab.evaluate('document.fonts && document.fonts.ready');
  await waitForStable(tab, settleMs);

  // The viewport is the window's own size. The scrollable height is measured as well and returned, so the README can
  // say how much of a long window the picture shows — a record that quietly cropped half a window would be the same
  // defect as a stale one.
  await tab.call('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await tab.evaluate(`document.body.classList.toggle('theme-dark', ${JSON.stringify(theme)} === 'dark')`);
  await waitForStable(tab, settleMs);
  const layout = await tab.call('Page.getLayoutMetrics');
  const scrollHeight = Math.ceil(layout?.cssContentSize?.height ?? (await tab.evaluate('document.documentElement.scrollHeight')));

  // Sampled twice and required to agree. A page that is still moving is a page whose image would differ from the
  // next run of the same command, and this is where that is caught rather than at the byte-comparison. The retry
  // that `captureBand()` takes for the dithering meter-ramp swatch (see the header) is deliberately not offered to a
  // window: a window that will not sit still is a window bug, not a rasteriser coin flip.
  const bytes = await requireStableDoubleCapture(
    () => shoot(tab),
    { settleMs, what: `the window ${url} in the ${theme} theme` },
  );
  return { bytes, scrollHeight };
}

async function shoot(tab, clip = null) {
  const shot = await tab.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    // **Not** `captureBeyondViewport`: that captures the whole document, and the main window then comes back 1919 px
    // tall while the others come back 1000 — measured, after the viewport was already pinned to 1600x1000. The
    // record is the window as it opens, so the viewport is the picture. A caller that asks for a clip **does** want
    // beyond the viewport, and it is the clip's own page coordinates that decide what is in the picture.
    captureBeyondViewport: clip !== null,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    optimizeForSpeed: false,
  });
  return Buffer.from(shot.data, 'base64');
}

/// One band of a **long page**, at page coordinates, for `design/reference/`.
///
/// The windows' `capture()` is viewport-bound and that is right for `design/screens/`: the record there is the window
/// as it opens. `design/reference/` is a photograph of `design/specimen.html`, which is several screens tall, so its
/// record is taken in bands and each band is named by a `y` and a `height` in **page coordinates** rather than by a
/// scroll offset — a scroll offset depends on the viewport and on what is above it, a page coordinate does not, and
/// the README records the numbers so the next capture is a refresh rather than a new photograph.
///
/// `readyExpression` is the caller's own readiness test (the specimen waits for its `specimenReady` flag), because
/// "the page is ready" is a fact about the page and not about this library. The band is sampled twice and the two
/// captures must be equal, exactly as `capture()` requires of a window: an image that would differ on the next run
/// is refused rather than committed.
export async function captureBand(tab, { url, y, height, readyExpression = 'true', settleMs = 260, attempts = 1 } = {}) {
  if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) {
    throw new Error(`captureBand needs a page coordinate and a height, got y=${y} height=${height}`);
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`captureBand needs attempts to be a positive integer, got ${attempts}`);
  }
  await tab.call('Page.navigate', { url });
  await tab.waitForEvent('Page.loadEventFired');
  await waitFor(tab, 'document.readyState === "complete" && !!document.body', 15000);
  await waitFor(tab, readyExpression, 15000);
  await tab.evaluate('document.fonts && document.fonts.ready');
  await waitForStable(tab, settleMs);

  const clip = { x: 0, y, width: VIEWPORT_WIDTH, height };
  try {
    const bytes = await requireStableDoubleCapture(
      () => shoot(tab, clip),
      { settleMs, what: `the band y=${y} h=${height} of ${url}`, attempts },
    );
    return { bytes, y, height };
  } catch (error) {
    if (error.code !== 'NOT_STABLE') throw error;
    // The refusal keeps the measurement it refused on, and adds the one thing a reader needs to tell a rasteriser
    // coin flip from a page that moved: the swatch this repository has measured it on, and where it is written down.
    error.message +=
      ` Known and measured: a ±1 difference confined to design/specimen.html's .ramp-demo swatch (the --meter-ramp` +
      ` gradient, page y 3978..3991 at 1600 px wide) is Chrome's gradient dithering, on roughly 13 of 120 pairs` +
      ` measured 2026-10-08 — run the capture again rather than looking for a change. Any other region, or a larger` +
      ` difference, is not that, and is the page or the render actually moving. The measurement is in the header of` +
      ` scripts/lib/design-screens.mjs.`;
    throw error;
  }
}

/// The whole determinism contract, in one place: take the picture twice, `settleMs` apart, and refuse unless the two
/// are **byte-identical**. Shared by a window (`capture()`) and a band (`captureBand()`) so the rule cannot drift
/// between them, and bounded by `attempts` only where a caller has measured that a retry is warranted.
///
/// Exported **for its own contract, not for callers**: a comparison that tolerates "small" differences is the mute
/// button this design forbids, so the behaviour an `attempts` budget is allowed to have — retry the pair, never accept
/// a pair that differs, refuse after the last attempt — is asserted directly by `test-design-screens.mjs`.
export async function requireStableDoubleCapture(shoot, { settleMs = 260, what = 'the capture', attempts = 1 } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const bytes = await shoot();
    await sleep(settleMs);
    const again = await shoot();
    if (bytes.equals(again)) return bytes;
    last = { bytes, again };
  }
  const differing = countPixelDifferences(await decodePng(last.bytes), await decodePng(last.again));
  throw Object.assign(
    new Error(
      `${what} did not stop moving: ` +
      `${differing.sentence || 'the two captures differ'} between two captures ${settleMs} ms apart` +
      (attempts > 1 ? `, in each of ${attempts} attempts` : '') +
      '. The image would not be reproducible, so this render is refused rather than written.',
    ),
    { code: 'NOT_STABLE' },
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The CDP client, deliberately small: a private Chrome, a private port, one tab at a time.
// ---------------------------------------------------------------------------------------------------------------
// Exported because `scripts/capture-design-reference.mjs` takes the **specimen's** bands with the same browser, the
// same frozen clock and the same viewport this lock renders the windows with: a second CDP client would be a second
// set of flags, and two records of one kit taken with two browsers is the drift this folder exists to catch.
export async function openTab(instance) {
  const target = await (await fetch(`${instance.debug}/json/new?about:blank`, { method: 'PUT' })).json();
  if (!target?.webSocketDebuggerUrl) throw new Error('could not open a tab in the private Chrome');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.once('open', resolveOpen);
    socket.once('error', rejectOpen);
  });
  let nextId = 0;
  const pending = new Map();
  const watchers = new Map();
  socket.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    if (message.method && watchers.has(message.method)) {
      for (const watcher of watchers.get(message.method)) {
        clearTimeout(watcher.timer);
        watcher.resolve(message.params);
      }
      watchers.delete(message.method);
    }
  });
  const call = (method, params = {}) =>
    new Promise((resolveCall, rejectCall) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCall(new Error(`the private Chrome did not answer ${method} within 20 s`));
      }, 20000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolveCall(value); },
        reject: (error) => { clearTimeout(timer); rejectCall(error); },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };

  /// Wait for one CDP event. A reload is waited on by its **event**, not by polling `readyState`: the old document
  /// answers `readyState === "complete"` while the new one is still coming, and a capture taken then is a capture of
  /// the previous theme with the new one's name on it. Measured: it put the dark `meters` image in the light palette.
  const waitForEvent = (method, timeoutMs = 15000) =>
    new Promise((resolveEvent, rejectEvent) => {
      const timer = setTimeout(() => {
        watchers.delete(method);
        rejectEvent(new Error(`the private Chrome never sent ${method} within ${timeoutMs} ms`));
      }, timeoutMs);
      const list = watchers.get(method) || [];
      list.push({ resolve: resolveEvent, timer });
      watchers.set(method, list);
    });

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: clockFreezeSource(Date.parse(FROZEN_CLOCK)),
  });
  await call('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return {
    target,
    call,
    evaluate,
    waitForEvent,
    close: async () => {
      try { socket.close(); } catch (_) {}
      await runQuiet('curl', ['-s', '--max-time', '2', '-o', '/dev/null', `${instance.debug}/json/close/${target.id}`]);
    },
  };
}

async function waitFor(tab, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await tab.evaluate(expression)) return true;
    } catch (_) { /* the document is being replaced */ }
    await sleep(100);
  }
  throw new Error(`the page never satisfied ${expression} within ${timeoutMs} ms`);
}

/// Wait for the page to be quiet: no layout change, no pending animation frame, over a short window.
async function waitForStable(tab, settleMs) {
  await sleep(settleMs);
  await tab.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(60);
}

async function freePort() {
  const { createServer } = await import('node:net');
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runQuiet(command, args) {
  return new Promise((resolveRun) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore' });
      child.on('error', () => resolveRun());
      child.on('exit', () => resolveRun());
    } catch (_) { resolveRun(); }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// PNG comparison. Raw bytes decide "identical"; pixels decide the sentence a reader acts on.
// ---------------------------------------------------------------------------------------------------------------
export async function decodePng(buffer) {
  const { PNG } = await import('pngjs');
  return PNG.sync.read(buffer);
}

/// How many pixels differ between two decoded PNGs, and where. `null` bounds when nothing differs; `wholeImage` when
/// the two are not even the same size, because then a bounding region would be a lie.
export function countPixelDifferences(left, right) {
  if (!left || !right) return { pixels: null, bounds: null, wholeImage: true, sizes: [] };
  const sizes = [[left.width, left.height], [right.width, right.height]];
  if (left.width !== right.width || left.height !== right.height) {
    return {
      pixels: null,
      bounds: null,
      wholeImage: true,
      sizes,
      sentence: `the two images are not the same size: ${sizes[0][0]}x${sizes[0][1]} against ${sizes[1][0]}x${sizes[1][1]}`,
    };
  }
  const { width, height } = left;
  let pixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      // All four channels, alpha included, because `sentence` is the number a reader compares against the refusals
      // already written down — a count that quietly ignored alpha would not be the same count.
      if (
        left.data[index] !== right.data[index] ||
        left.data[index + 1] !== right.data[index + 1] ||
        left.data[index + 2] !== right.data[index + 2] ||
        left.data[index + 3] !== right.data[index + 3]
      ) {
        pixels += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (pixels === 0) return { pixels: 0, bounds: null, wholeImage: false, sizes, sentence: 'no pixel differs' };
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const share = ((pixels / (width * height)) * 100).toFixed(3);
  return {
    pixels,
    bounds,
    wholeImage: false,
    sizes,
    sentence:
      `${pixels} of ${width * height} pixels differ (${share}%), in the region x ${bounds.x}..${maxX}, ` +
      `y ${bounds.y}..${maxY} (${bounds.width}x${bounds.height})`,
  };
}
