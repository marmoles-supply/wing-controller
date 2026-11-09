// Contracts for the ordered (dither) patterns of the surfaces.
//
// What is checked here is what took effort to get right in the design and is easy to break without
// noticing: that the pattern is generated AT THE SIZE OF THE ELEMENT (not stretched, which was what
// produced rectangular cells and vertical lines) and that the cell comes out square.
//
// Like the rest of the browser tests, it needs Chrome on the debug port; without it, it skips with a
// note.
import assert from "node:assert/strict";
import WebSocket from "ws";

let targets;
try {
  const response = await fetch("http://127.0.0.1:9223/json");
  targets = await response.json();
} catch (_) {
  console.error("skipped: No Chrome listening on 9223 (see AGENTS.md)");
  process.exit(3);
}
const candidates = targets.filter((entry) => entry.type === "page" && entry.url.endsWith("/desktop/ui/index.html"));
// A `file://` tab is preferred: it always reads the working tree. A tab served by a server from an
// earlier run may be dead and serve an HTML without `dither.js`.
const target = candidates.find((entry) => entry.url.startsWith("file://")) || candidates[0];
if (!target) {
  console.error("skipped: no tab with desktop/ui/index.html open");
  process.exit(3);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
  return result.result.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Waiting for a condition beats sleeping: the Chrome UI takes a different time on every run.
const waitFor = async (expression, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await evaluate(expression)) return true;
    if (Date.now() > deadline) return false;
    await sleep(120);
  }
};

await send("Page.enable");
// This suite reads the classic light theme's own colours — the navy title bar and the black bevel it
// must not touch — and the window follows the stored theme when it boots. The Chrome profile is shared
// between the suites, so a run that left the dark theme on used to decide these checks; the light theme
// is pinned here and the previous value put back at the end.
const previousTheme = await evaluate(`localStorage.getItem('wing_theme')`).catch(() => null);
await evaluate(`localStorage.setItem('wing_theme', 'light')`).catch(() => {});
// The background is the operator's too, and it outlives a suite: a run that left it flat made the
// light/dark ramp comparison below compare two empty patterns and pass for the wrong reason (this
// happened on 2026-10-02, the first run after the background feature was added). Pinned like the theme,
// and remembered in `previousBackground` to be put back at the end.
const previousBackground = await evaluate(`localStorage.getItem('wing_background')`).catch(() => null);
const previousBackgroundColour = await evaluate(`localStorage.getItem('wing_background_colour')`).catch(() => null);
await evaluate(`localStorage.removeItem('wing_background'); localStorage.removeItem('wing_background_colour')`).catch(() => {});
await send("Page.reload", { ignoreCache: true });
assert.ok(await waitFor("typeof window.WingDither === 'object'", 9000),
  "the dither module must load in the window");

// --- 0. Pre-painting: a still-hidden surface already carries its pattern ----------------------
// Without this, every dialogue appeared with its flat blue and the pattern came in one frame later
// (a flicker visible when opening each window).
const prewarmed = await evaluate(`(() => {
  const bar = document.querySelector("#win95-confirm .win95-dialog-titlebar");
  return bar ? getComputedStyle(bar).backgroundImage.startsWith('url("data:image/png') : false;
})()`);
assert.equal(prewarmed, true, "dialogue title bars must be pre-painted at start-up");

// The desktop runs diagonally (horizontally it looked flat).
assert.equal(await evaluate("window.WingDither.presets.desk.diagonal"), true,
  "the desktop ramp must be diagonal");
// The grey gradient moved from the panel bodies to the block headers (operator request), so here
// the headers are checked and the body must stay flat.
assert.ok(await waitFor(`(() => {
  const tramada = (sel) => {
    const el = document.querySelector(sel);
    return Boolean(el) && getComputedStyle(el).backgroundImage.startsWith('url("data:image/png');
  };
  return tramada(".builder-panel > .section-head") && tramada(".workflow-head.section-head") && tramada(".card-header");
})()`, 6000),
  "the headers (main, subheaders and right column) must be patterned after loading");
assert.equal(await evaluate(`getComputedStyle(document.querySelector(".panel")).backgroundImage`), "none",
  "the panel body must stay flat: the gradient goes on the headers, not on the boxes");

// --- 1. The surfaces carry a pattern, and the pattern is a custom-generated PNG ----
const painted = await evaluate(`(() => {
  window.WingDither.apply();
  const out = {};
  for (const selector of [".card-header", ".builder-panel > .section-head"]) {
    const el = document.querySelector(selector);
    if (!el) { out[selector] = null; continue; }
    const style = getComputedStyle(el);
    out[selector] = {
      image: style.backgroundImage.startsWith('url("data:image/png'),
      size: style.backgroundSize,
      rendering: style.imageRendering,
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    };
  }
  return out;
})()`);
for (const [selector, info] of Object.entries(painted)) {
  assert.ok(info, `${selector} must exist in the window`);
  assert.equal(info.image, true, `${selector} must carry a PNG pattern (not a smooth gradient)`);
  assert.equal(info.size, "100% 100%", `${selector} must cover the element`);
  assert.equal(info.rendering, "pixelated", `${selector} must render crisp pixels`);
}

// --- 2. The cell is square and the pattern is NOT stretched -----------------------------------
// The pattern is drawn by rounding the element size to the cell grid: the natural size of the PNG is
// compared with that of the element to prove there is no scaling, and the resulting cell is compared
// horizontally and vertically to prove it is square.
const geometry = await evaluate(`(async () => {
  await window.WingDither.apply();
  const el = document.querySelector(".card-header");
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const url = style.backgroundImage.slice(5, -2);
  const image = new Image();
  await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; image.src = url; });
  return {
    natural: { width: image.naturalWidth, height: image.naturalHeight },
    rect: { width: rect.width, height: rect.height },
  };
})()`);
assert.ok(geometry.natural.width > 8 && geometry.natural.height > 4, "the pattern must have real pixels");
const cellWidth = geometry.rect.width / geometry.natural.width;
const cellHeight = geometry.rect.height / geometry.natural.height;
assert.ok(cellWidth >= 2 && cellWidth <= 6, `the horizontal cell must measure 2-6 px (measures ${cellWidth.toFixed(2)})`);
assert.ok(Math.abs(cellWidth - cellHeight) <= 0.35,
  `the cell must be square: ${cellWidth.toFixed(2)} x ${cellHeight.toFixed(2)} px`);
// Custom-generated = the PNG has the resolution of the grid, not that of the element.
assert.ok(geometry.natural.width < geometry.rect.width,
  "the pattern must be a grid smaller than the element (visible cells), not 1:1");

// --- 3. A hidden dialogue is painted when it appears --------------------------------------------
await evaluate(`void win95Confirm({ title: "Prueba de trama", message: "contrato", confirmLabel: "OK", cancelLabel: "Cancel" })`);
assert.ok(await waitFor(`(() => { const bar = document.querySelector("#win95-confirm .win95-dialog-titlebar"); return Boolean(bar) && getComputedStyle(bar).backgroundImage.startsWith('url("data:image/png') && bar.getBoundingClientRect().width > 100; })()`, 6000),
  "the dialogue bar must be patterned when it opens");
const dialog = await evaluate(`(() => {
  const bar = document.querySelector("#win95-confirm .win95-dialog-titlebar");
  const style = getComputedStyle(bar);
  return {
    image: style.backgroundImage.startsWith('url("data:image/png'),
    rendering: style.imageRendering,
    width: bar.getBoundingClientRect().width,
    clip: style.backgroundClip,
    paddingRight: parseFloat(style.paddingRight),
    paddingLeft: parseFloat(style.paddingLeft),
  };
})()`);
assert.equal(dialog.image, true, "the dialogue bar must carry a pattern when it opens (it measures 0x0 while hidden)");
assert.equal(dialog.rendering, "pixelated", "and with crisp pixels");
assert.ok(dialog.width > 100, `the dialogue bar must have a real width (${dialog.width})`);
// The blue must not touch the black bezel on the right: 1px of padding with the background clipped
// to the padding box leaves that margin in the colour of the frame.
assert.equal(dialog.clip, "padding-box", "the bar background must be clipped to the padding box");
assert.ok(dialog.paddingRight > dialog.paddingLeft,
  `the bar must carry 1px more margin on the right (${dialog.paddingRight} vs ${dialog.paddingLeft})`);
await evaluate(`document.getElementById("win95-confirm-accept")?.click()`);
await sleep(300);

// --- 3b. A macro row highlight carries a pattern when it is selected --------------------------
// It runs at the end of the normal flow (it is not painted "on load"), so here the same thing the
// operator sees is checked: a row is selected and its blue becomes a ramp.
const rowHighlight = await evaluate(`(async () => {
  const row = document.querySelector(".macro-row");
  if (!row) return { skip: true };
  row.classList.add("selected");
  for (let i = 0; i < 40; i++) {
    if (getComputedStyle(row).backgroundImage.startsWith('url("data:image/png')) {
      return { image: true, colour: getComputedStyle(row).color };
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return { image: false };
})()`);
// The library in this profile may be empty (another suite can leave it that way), and then there is
// nothing to paint. That is a missing fixture, not a failure — but it must not be silent either, which is
// what the audit found: these two contracts could vanish with exit 0. The gate prints this line beside the
// PASS now (S8), so a run that could not check the ramp says so.
if (rowHighlight.skip) {
  console.warn("note: no macro row to select in this profile, so the selected-row ramp was not checked");
}
assert.notEqual(rowHighlight.image, false,
  "a selected macro row must carry its ramp (its CSS uses !important, so the pattern goes in as important)");

// --- 3c. And the same with the step and IF gate rows ------------------------------------------
// Macro steps and conditions share the `.step-row` class; if the loaded macro has none, the check is
// skipped (there is nothing to paint).
const stepHighlight = await evaluate(`(async () => {
  const step = document.querySelector(".step-row");
  if (!step) return { skip: true };
  step.click();
  for (let i = 0; i < 40; i++) {
    const selected = document.querySelector(".step-row.selected");
    if (selected && getComputedStyle(selected).backgroundImage.startsWith('url("data:image/png')) {
      return { image: true, isGate: selected.classList.contains("condition-row") };
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return { image: false };
})()`);
if (stepHighlight.skip) {
  console.warn("note: no step row in this profile, so the selected-step ramp was not checked");
}
assert.notEqual(stepHighlight.image, false,
  "a selected step (or IF gate) row must carry its ramp");

// --- 3d. The desktop background changes with the theme ---------------------------------------
// This broke once: `presetFor` had no case for the desktop, so it always returned the light preset
// and in the dark theme the background was still the teal ramp. The initial comparison I wrote was
// flawed (it looked only at the PNG prefix, which is the same in all of them): here the size and a
// summary of the whole datum are compared.
const deskSignature = `(() => {
  const url = document.body.style.backgroundImage;
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) hash = (hash * 31 + url.charCodeAt(i)) | 0;
  return url.length + ":" + hash;
})()`;
const deskLight = await evaluate(deskSignature);
await evaluate(`(() => { const sel = document.getElementById("theme-selector"); sel.value = "dark"; sel.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await sleep(700);
const deskDark = await evaluate(deskSignature);
await evaluate(`(() => { const sel = document.getElementById("theme-selector"); sel.value = "light"; sel.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await sleep(700);
const deskBack = await evaluate(deskSignature);
assert.notEqual(deskDark, deskLight,
  "the desktop background must change when switching to the dark theme (its dark preset has to be used)");
assert.equal(deskBack, deskLight, "and come back to exactly the same pattern when returning to the light theme");

// --- 4. The About decoration is painted when its tab opens ---------------------------------
await evaluate(`document.getElementById("open-settings-btn").click()`);
await sleep(300);
await evaluate(`document.querySelector('.settings-nav-item[data-tab="about"]')?.click()`);
assert.ok(await waitFor(`(() => { const band = document.getElementById("about-brand-band"); return Boolean(band) && getComputedStyle(band).backgroundImage.startsWith('url("data:image/png') && band.getBoundingClientRect().height >= 16; })()`, 6000),
  "the About band must be patterned when the tab opens");
const about = await evaluate(`(() => {
  const band = document.getElementById("about-brand-band");
  const wrap = document.querySelector(".win95-about-logo-wrap");
  const rect = band.getBoundingClientRect();
  return {
    band: getComputedStyle(band).backgroundImage.startsWith('url("data:image/png'),
    bandHeight: Math.round(rect.height),
    glow: (wrap.style.getPropertyValue("--about-glow") || "").includes("data:image/png"),
  };
})()`);
assert.equal(about.band, true, "the About brand band must carry a pattern when the tab opens");
assert.ok(about.bandHeight >= 16, `the band must have height (${about.bandHeight} px); a flex-shrink was flattening it`);
assert.equal(about.glow, true, "the logo glow must be generated for the About");
await evaluate(`document.getElementById("btn-close-settings")?.click()`);

// --- 5. The window's background is the operator's choice, from Settings and from its own menu -------
//
// Three choices, independent of the theme: the light gradient, the dark gradient, or a flat colour with no
// pattern (owner, 2026-10-02). Both writers go through `setBackground`, so the menu and the Settings
// control cannot disagree; the flat case has to *remove* the pattern, not paint a colour behind it.
const backgroundState = `(() => ({
  mode: document.body.dataset.deskMode,
  solid: document.body.classList.contains('bg-solid'),
  colour: getComputedStyle(document.body).backgroundColor,
  ramp: document.body.style.backgroundImage || '',
  stored: localStorage.getItem('wing_background'),
  storedColour: localStorage.getItem('wing_background_colour'),
}))()`;
await evaluate(`setBackground('solid', '#000000')`);
await sleep(500);
let bg = await evaluate(backgroundState);
assert.equal(bg.mode, 'solid', 'the background mode must reach the dither');
assert.equal(bg.solid, true, 'a flat background must carry the class that hides the texture');
assert.equal(bg.colour, 'rgb(0, 0, 0)', `solid black must paint black, got ${bg.colour}`);
assert.equal(bg.ramp, 'none', 'a flat background must have no ramp at all');
await evaluate(`setBackground('light')`);
await sleep(500);
const lightRamp = await evaluate(`document.body.style.backgroundImage.length + ':' + document.body.dataset.deskMode`);
await evaluate(`setBackground('dark')`);
await sleep(500);
const darkRamp = await evaluate(`document.body.style.backgroundImage.length + ':' + document.body.dataset.deskMode`);
assert.ok(lightRamp.endsWith(':light') && darkRamp.endsWith(':dark'),
  `each gradient must name its own mode (${lightRamp} / ${darkRamp})`);
// The mode suffix alone made the comparison below a tautology: "0:light" !== "0:dark" even with both
// gradients empty. The byte length has to be real first (audit 2026-10-02, S2).
assert.ok(Number(lightRamp.split(':')[0]) > 100 && Number(darkRamp.split(':')[0]) > 100,
  `both gradients must actually be painted (${lightRamp} / ${darkRamp})`);
assert.notEqual(darkRamp, lightRamp, 'the light and dark gradients must be different patterns');
// The menu on the background offers the same choices, and choosing one applies it.
await evaluate(`document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 700, clientY: 500 }))`);
await sleep(400);
const menuText = await evaluate(`document.getElementById('win95-context-menu').textContent || ''`);
for (const label of ['BACKGROUND', 'Follow the theme', 'Light gradient', 'Dark gradient', 'Solid black', 'Solid white', 'Solid grey']) {
  assert.ok(menuText.includes(label), `the background menu must offer "${label}"`);
}
await evaluate(`(() => {
  const item = [...document.querySelectorAll('#win95-context-menu *')].find((el) => (el.textContent || '').trim() === 'Solid white');
  (item.closest('[data-context-item], .win95-context-item, div') || item).click();
})()`);
await sleep(500);
bg = await evaluate(backgroundState);
assert.equal(bg.colour, 'rgb(255, 255, 255)', `the menu choice must paint the window, got ${bg.colour}`);
assert.equal(bg.stored, 'solid', 'the menu choice must be remembered');
// Back to the default, so the rest of the profile is not left painted white for the next suite.
await evaluate(`setBackground('auto'); document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); document.body.click();`);
await sleep(300);

// Leave the profile's theme as it was found, so the next suite decides its own colours.
await evaluate(previousTheme === null
  ? `localStorage.removeItem('wing_theme')`
  : `localStorage.setItem('wing_theme', ${JSON.stringify(previousTheme)})`).catch(() => {});
await evaluate(previousBackground === null
  ? `localStorage.removeItem('wing_background')`
  : `localStorage.setItem('wing_background', ${JSON.stringify(previousBackground)})`).catch(() => {});
await evaluate(previousBackgroundColour === null
  ? `localStorage.removeItem('wing_background_colour')`
  : `localStorage.setItem('wing_background_colour', ${JSON.stringify(previousBackgroundColour)})`).catch(() => {});

socket.close();
console.log("desktop dither contracts passed");

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
