// Checks the layout and legibility of the dock meters (workstation window).
//
// Operator report (2026-09-22), with screenshots: with several columns the card came down to ~150 px
// and, as soon as signal arrived, the value ate the name until it read "TRI…"; and in the light theme
// the name was mint green on a grey card, which cannot be read. The bridge already stacked the meters
// and the operator put it forward as an example.
//
// Checks, against the real script:
//   1. The container has a SINGLE column: one meter per row.
//   2. With signal and a long name, the name is not clipped (and the value keeps its slot).
//   3. The name and the value are legible in both themes (contrast ≥ 4.5:1 on the card).
//   4. The card structure is still there (CLIP, scale, PK).
//
// Needs Chrome with `--remote-debugging-port=9223`.
//
// Run: node scripts/test-desktop-meter-layout-browser.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

async function debuggerPages() {
  try {
    const response = await fetch('http://127.0.0.1:9223/json', { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

const pages = await debuggerPages();
if (!pages) {
  console.log('SKIP: no Chrome remote debugging on port 9223');
  process.exit(3);
}

const target = await (
  await fetch('http://127.0.0.1:9223/json/new?about:blank', { method: 'PUT' })
).json();
assert.ok(target?.webSocketDebuggerUrl, 'could not open a Chrome tab for this test');
process.on('exit', () => {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', `http://127.0.0.1:9223/json/close/${target.id}`]);
  } catch (_) {}
});

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let nextId = 0;
const pending = new Map();
socket.on('message', (data) => {
  const response = JSON.parse(data);
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  if (response.error) request.reject(new Error(response.error.message));
  else request.resolve(response.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await call('Page.enable');
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__INVOKES = [];
    window.__TAURI__ = {
      core: { invoke: async (cmd) => { window.__INVOKES.push(cmd); return {}; } },
      event: { listen: async () => () => {} },
    };
  `,
});
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const uiDir = new URL('../desktop/ui/', import.meta.url);
await call('Page.navigate', { url: new URL('index.html', uiDir).href });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && typeof renderBars === "function"')) break;
  await sleep(100);
  if (attempt === 59) assert.fail('index.html must expose renderBars');
}
await evaluate('window.scrollTo(0, 0)');

// A long name and a value above the "-inf" threshold: this is the case from the operator's screenshot.
await evaluate(`renderBars([
  { key: 'ch:1:meter', label: 'LOCAL 1', alias: 'TRIGGER', value: -6.4, peak: -3.1, isClipped: false },
  { key: 'ch:2:meter', label: 'LOCAL 2', alias: 'VOZ PRINCIPAL DEL MAESTRO DE CEREMONIAS', value: -58.7, peak: -56.4, isClipped: false },
], 'normal')`);
await sleep(120);

// ── 1. One column ───────────────────────────────────────────────────────────────────────────────────
const layout = await evaluate(`(() => {
  const container = document.getElementById('meters-container');
  const style = getComputedStyle(container);
  const tracks = style.gridTemplateColumns.split(' ').filter(Boolean);
  const cards = Array.from(container.querySelectorAll('.meter')).map((card) => {
    const alias = card.querySelector('.meter-alias-title');
    const value = card.querySelector('.value');
    const box = card.getBoundingClientRect();
    return {
      alias: alias.textContent,
      aliasTruncated: alias.scrollWidth > alias.clientWidth + 1,
      aliasWidth: Math.round(alias.clientWidth),
      value: value.textContent,
      valueTruncated: value.scrollWidth > value.clientWidth + 1,
      valueShrink: getComputedStyle(value).flexShrink,
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  });
  return { display: style.display, tracks, cards, containerWidth: Math.round(container.getBoundingClientRect().width) };
})()`);
assert.equal(layout.display, 'grid', 'the meter container must be a grid');
assert.equal(layout.tracks.length, 1, `one meter per row (got ${layout.tracks.length} columns: ${layout.tracks.join(' | ')})`);
assert.equal(layout.cards.length, 2, 'both meters must be rendered');
for (const card of layout.cards) {
  assert.ok(
    Math.abs(card.width - layout.containerWidth) <= 2,
    `each card must use the full row (card ${card.width}px vs container ${layout.containerWidth}px)`,
  );
}
console.log(`1. one meter per row: 1 column of ${layout.containerWidth}px, cards ${layout.cards.map((c) => c.width).join('/')}px`);

// ── 2. The name is not clipped with signal ─────────────────────────────────────────────────────────────
const longName = layout.cards[1];
assert.equal(longName.value, '-58.7 dB', 'the second meter must show its value');

// ── 2b. A meter the frame did not carry is not painted as silence (A4, 2026-09-30) ──────────────────
await evaluate(`renderBars([
  { key: 'ch:3:meter', label: 'LOCAL 3', alias: 'SIN DATO' },
  { key: 'ch:4:meter', label: 'LOCAL 4', alias: 'SILENCIO', value: -90, peak: -90, isClipped: false },
], 'normal')`);
await sleep(120);
const noData = await evaluate(`(() => {
  const cards = Array.from(document.getElementById('meters-container').querySelectorAll('.meter')).map((card) => ({
    alias: card.querySelector('.meter-alias-title').textContent,
    value: card.querySelector('.value').textContent,
    fill: card.querySelector('.fill').style.width,
    peak: card.querySelector('.peak-val-badge').textContent,
  }));
  return cards;
})()`);
assert.equal(noData[0].value, '\u2013',
  `a meter with no value must say so instead of claiming silence (got "${noData[0].value}")`);
assert.equal(noData[0].fill, '0%', `and its bar must stay empty (got "${noData[0].fill}")`);
assert.equal(noData[0].peak, 'PK --', `and it must invent no peak (got "${noData[0].peak}")`);
assert.equal(noData[1].value, '-inf',
  `a meter the console reports at the bottom of the scale is still -inf (got "${noData[1].value}")`);
console.log('2b. no data is "\u2013" with an empty bar; a reported -90 dB is still -inf');
await evaluate(`renderBars([
  { key: 'ch:1:meter', label: 'LOCAL 1', alias: 'TRIGGER', value: -6.4, peak: -3.1, isClipped: false },
  { key: 'ch:2:meter', label: 'LOCAL 2', alias: 'VOZ PRINCIPAL DEL MAESTRO DE CEREMONIAS', value: -58.7, peak: -56.4, isClipped: false },
], 'normal')`);
await sleep(120);
assert.equal(
  longName.aliasTruncated,
  false,
  `the name must not be squeezed by the value (alias "${longName.alias}" got ${longName.aliasWidth}px)`,
);
assert.equal(longName.valueTruncated, false, 'the value must not be truncated either');
assert.equal(longName.valueShrink, '0', `the value must never shrink (flex-shrink: ${longName.valueShrink})`);
console.log(`2. with signal, "${longName.alias}" keeps its ${longName.aliasWidth}px and the value stays "${longName.value}"`);

// ── 3. Contrast in both themes ────────────────────────────────────────────────────────────────────
const contrastProbe = `(() => {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (color) => color.match(/\\d+/g).slice(0, 3).map(Number);
  const ratio = (a, b) => {
    const [light, dark] = [luminance(parse(a)), luminance(parse(b))].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const card = document.querySelectorAll('#meters-container .meter')[1];
  const alias = card.querySelector('.meter-alias-title');
  const value = card.querySelector('.value');
  const tag = card.querySelector('.meter-channel-tag');
  const scale = card.querySelector('.meter-footer-scale');
  const background = getComputedStyle(card).backgroundColor;
  const scaleColor = getComputedStyle(scale).color;
  // The graduations sit on the same grey as the card.
  const scaleBackground = getComputedStyle(scale).backgroundColor === 'rgba(0, 0, 0, 0)'
    ? background
    : getComputedStyle(scale).backgroundColor;
  return {
    background,
    aliasColor: getComputedStyle(alias).color,
    valueColor: getComputedStyle(value).color,
    tagColor: getComputedStyle(tag).color,
    scaleColor,
    alias: Number(ratio(getComputedStyle(alias).color, background).toFixed(2)),
    value: Number(ratio(getComputedStyle(value).color, background).toFixed(2)),
    tag: Number(ratio(getComputedStyle(tag).color, background).toFixed(2)),
    scale: Number(ratio(scaleColor, scaleBackground).toFixed(2)),
  };
})()`;

for (const theme of ['dark', 'light']) {
  await evaluate(`document.body.classList.toggle('theme-dark', ${theme === 'dark'})`);
  await sleep(60);
  const colors = await evaluate(contrastProbe);
  assert.ok(
    colors.alias >= 4.5,
    `${theme}: the meter name must be readable (ratio ${colors.alias}, ${colors.aliasColor} on ${colors.background})`,
  );
  assert.ok(
    colors.value >= 4.5,
    `${theme}: the meter value must be readable (ratio ${colors.value}, ${colors.valueColor} on ${colors.background})`,
  );
  assert.ok(
    colors.tag >= 4.5,
    `${theme}: the channel tag must stay legible (ratio ${colors.tag}, ${colors.tagColor} on ${colors.background})`,
  );
  assert.ok(
    colors.scale >= 4.5,
    `${theme}: the dB graduations must be readable (ratio ${colors.scale}, ${colors.scaleColor})`,
  );
  console.log(`3. ${theme}: name ${colors.alias}:1, value ${colors.value}:1, tag ${colors.tag}:1, scale ${colors.scale}:1 on ${colors.background}`);
}

// ── 3b. Light theme: neither the CLIP LED nor the bar well may be black holes ───────────
const lightDetails = await evaluate(`(() => {
  document.body.classList.remove('theme-dark');
  const card = document.querySelectorAll('#meters-container .meter')[1];
  const clip = card.querySelector('.clip-led-badge');
  const bar = card.querySelector('.bar');
  const pk = card.querySelector('.peak-val-badge');
  const hex = (rgb) => rgb.match(/\\d+/g).slice(0, 3).map(Number);
  const brightness = (rgb) => { const [r, g, b] = hex(rgb); return (r * 299 + g * 587 + b * 114) / 1000; };
  const backdrop = getComputedStyle(card.parentElement).backgroundColor;
  const wellBefore = getComputedStyle(bar).backgroundColor;
  const pkWidthBefore = pk.getBoundingClientRect().width;
  pk.textContent = 'PK --';
  const pkWidthEmpty = pk.getBoundingClientRect().width;
  pk.textContent = 'PK -56.4';
  const pkWidthFull = pk.getBoundingClientRect().width;
  return {
    clipBackground: getComputedStyle(clip).backgroundColor,
    clipBrightness: Number(brightness(getComputedStyle(clip).backgroundColor).toFixed(1)),
    well: wellBefore,
    wellBrightness: Number(brightness(wellBefore).toFixed(1)),
    pkWidthEmpty: Math.round(pkWidthEmpty),
    pkWidthFull: Math.round(pkWidthFull),
    backdrop,
  };
})()`);
assert.ok(
  lightDetails.clipBrightness > 90,
  `the unlit CLIP led must not be a black hole in the light theme (brightness ${lightDetails.clipBrightness}, ${lightDetails.clipBackground})`,
);
assert.ok(
  lightDetails.wellBrightness > 30,
  `the meter well must not be black in the light theme (brightness ${lightDetails.wellBrightness}, ${lightDetails.well})`,
);
assert.equal(
  lightDetails.pkWidthEmpty,
  lightDetails.pkWidthFull,
  `the PK box must not move the dB scale: "PK --" is ${lightDetails.pkWidthEmpty}px and "PK -56.4" is ${lightDetails.pkWidthFull}px`,
);
console.log(`3b. light theme: CLIP led ${lightDetails.clipBackground} (brightness ${lightDetails.clipBrightness}), well ${lightDetails.well}, PK box fixed at ${lightDetails.pkWidthFull}px`);

// ── 4. The card is still complete ─────────────────────────────────────────────────────────────────────
const structure = await evaluate(`(() => {
  const card = document.querySelectorAll('#meters-container .meter')[1];
  const scale = card.querySelector('.meter-footer-scale');
  return {
    bar: Boolean(card.querySelector('.bar .fill')),
    clip: card.querySelector('.clip-led-badge')?.textContent,
    peak: card.querySelector('.peak-val-badge')?.textContent,
    scale: scale ? Array.from(scale.children).map((span) => span.textContent).join(' ') : '',
    aliasTitle: card.querySelector('.meter-alias-title')?.title || '',
  };
})()`);
assert.ok(structure.bar, 'the bar must still be there');
assert.equal(structure.clip, 'CLIP', 'the CLIP led must still be there');
assert.equal(structure.peak, 'PK -56.4', `the peak badge must keep its value (got "${structure.peak}")`);
assert.equal(structure.scale, '-48 -18 -6 0', `the footer scale must be intact (got "${structure.scale}")`);
assert.match(structure.aliasTitle, /VOZ PRINCIPAL DEL MAESTRO/, 'the tooltip must carry the full name for when it does not fit');
console.log('4. the card keeps its bar, CLIP led, scale, peak badge and the full-name tooltip');

// ── 5. The watchlist can be reordered and pruned from the strip ─────────────────────────────────────
// The strip had a `×` per meter and nothing to move them: the order of the meters in the view is the
// order of the watchlist, so changing it meant editing the show file.
const stripState = () => evaluate(`(() => ({
  keys: customMetersWatchlist.map((item) => item.key),
  stored: JSON.parse(localStorage.getItem('wing_custom_meters') || '[]').map((item) => item.key),
  tags: Array.from(document.querySelectorAll('#active-meters-tags .meter-tag')).map((tag) => ({
    key: tag.dataset.meterKey,
    label: tag.querySelector('.meter-tag-alias')?.textContent || '',
    left: Boolean(tag.querySelector('.tag-move[data-move="-1"]')),
    right: Boolean(tag.querySelector('.tag-move[data-move="1"]')),
    remove: Boolean(tag.querySelector('.tag-remove')),
  })),
}))()`);
const clickTag = (key, selector) => evaluate(`(() => {
  const tag = Array.from(document.querySelectorAll('#active-meters-tags .meter-tag'))
    .find((node) => node.dataset.meterKey === ${JSON.stringify(key)});
  tag?.querySelector(${JSON.stringify(selector)})?.click();
  return Boolean(tag);
})()`);

await evaluate(`(() => {
  customMetersWatchlist = [
    { key: 'usb:1', group: 'usb', id: 1, label: 'USB 1' },
    { key: 'usb:2', group: 'usb', id: 2, label: 'USB 2' },
    { key: 'usb:3', group: 'usb', id: 3, label: 'USB 3' },
  ];
  saveCustomMeters();
  renderActiveMeterTags();
})()`);
await sleep(150);
const strip = await stripState();
assert.deepEqual(strip.keys, ['usb:1', 'usb:2', 'usb:3'], 'the strip must show the watchlist in order');
assert.equal(strip.tags.length, 3, 'one tag per meter');
assert.ok(strip.tags.every((tag) => tag.left && tag.right && tag.remove), 'every tag must offer move left, move right and remove');

await clickTag('usb:1', '.tag-move[data-move="1"]');
await sleep(150);
const movedRight = await stripState();
assert.deepEqual(movedRight.keys, ['usb:2', 'usb:1', 'usb:3'], 'moving right must swap with the next meter');
assert.deepEqual(movedRight.stored, ['usb:2', 'usb:1', 'usb:3'], 'and the new order must be the one stored');
await clickTag('usb:3', '.tag-move[data-move="-1"]');
await sleep(150);
const movedLeft = await stripState();
assert.deepEqual(movedLeft.keys, ['usb:2', 'usb:3', 'usb:1'], 'moving left must swap with the previous meter');
// The ends are ends: nothing wraps around.
await clickTag('usb:2', '.tag-move[data-move="-1"]');
await clickTag('usb:1', '.tag-move[data-move="1"]');
await sleep(120);
const atEnds = await stripState();
assert.deepEqual(atEnds.keys, ['usb:2', 'usb:3', 'usb:1'], 'the first cannot move left and the last cannot move right');

await clickTag('usb:3', '.tag-remove');
await sleep(150);
const removed = await stripState();
assert.deepEqual(removed.keys, ['usb:2', 'usb:1'], 'remove must take the meter out of the watchlist');
assert.deepEqual(removed.stored, ['usb:2', 'usb:1'], 'and out of what is stored');
assert.equal(removed.tags.length, 2, 'and out of the strip');
console.log(`5. the strip reorders and prunes: ${removed.keys.join(', ')} left, stored the same`);

// ── 6. Renaming a meter leaves the cell, not an editor ──────────────────────────────────────────────
// Operator report: after typing an alias and pressing Enter (or clicking away) the cell stayed in
// edit mode and only came back to normal by reloading the show.
await evaluate(`(() => {
  customMetersWatchlist = [
    { key: 'usb:1', group: 'usb', id: 1, label: 'USB 1' },
    { key: 'usb:2', group: 'usb', id: 2, label: 'USB 2' },
  ];
  saveCustomMeters();
  renderActiveMeterTags();
})()`);
await sleep(150);
const aliasResult = await evaluate(`(() => {
  const aliasEl = document.querySelector('#active-meters-tags .meter-tag[data-meter-key="usb:1"] .meter-tag-alias');
  startInlineAliasEdit(aliasEl, 'usb:1');
  const input = aliasEl.querySelector('input.inline-alias-editor');
  input.value = 'VOZ 1';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const after = document.querySelector('#active-meters-tags .meter-tag[data-meter-key="usb:1"] .meter-tag-alias');
  return {
    stillEditing: after?.dataset.isEditing === 'true',
    hasInput: Boolean(after?.querySelector('input')),
    text: after?.textContent || '',
    alias: customMetersWatchlist.find((item) => item.key === 'usb:1')?.alias || '',
    stored: JSON.parse(localStorage.getItem('wing_custom_meters') || '[]').find((item) => item.key === 'usb:1')?.alias || '',
  };
})()`);
assert.equal(aliasResult.alias, 'VOZ 1', `Enter must keep the alias (got "${aliasResult.alias}")`);
assert.equal(aliasResult.stored, 'VOZ 1', 'and write it to the stored watchlist');
assert.equal(aliasResult.hasInput, false, 'the editor must leave the cell');
assert.equal(aliasResult.stillEditing, false, 'and the cell must not stay marked as editing');
assert.match(aliasResult.text, /VOZ 1/, `the label must show the alias at once (got "${aliasResult.text}")`);
console.log('6. renaming a meter commits on Enter and the cell stops being an editor');

// ── 7. The meter matrix opens with the view, not with a guess ───────────────────────────────────────
// Operator report: "when the matrix opens, USB 1, 2 and 3 are always selected". The add field arrived
// prefilled with "1-3", so that is what the matrix showed, whatever the watchlist had.
const openMeterMatrix = (fieldText) => evaluate(`(() => {
  const input = document.getElementById('meter-add-ids');
  input.value = ${JSON.stringify(fieldText)};
  document.querySelector('button.btn-open-matrix[data-target-input="meter-add-ids"]').click();
  const modal = document.getElementById('channel-matrix-modal');
  const selected = Array.from(document.querySelectorAll('#channel-matrix-modal .matrix-cell.is-selected'))
    .map((cell) => Number(cell.dataset.id || cell.textContent));
  return {
    open: getComputedStyle(document.getElementById('channel-matrix-backdrop')).display !== 'none',
    selected,
    field: input.value,
  };
})()`);
const closeMatrix = () => evaluate(`document.getElementById('btn-cancel-matrix').click()`);

await evaluate(`(() => {
  customMetersWatchlist = [];
  saveCustomMeters();
  renderActiveMeterTags();
})()`);
await sleep(120);
const emptyWatchlist = await openMeterMatrix('');
assert.equal(emptyWatchlist.open, true, 'the matrix must open');
assert.equal(emptyWatchlist.field, '', 'the add field must start empty: USB 1-3 used to be prefilled');
assert.deepEqual(emptyWatchlist.selected, [], `an empty watchlist must tick nothing (got ${emptyWatchlist.selected.join(', ')})`);
await closeMatrix();
await sleep(120);

await evaluate(`(() => {
  customMetersWatchlist = [
    { key: 'usb:1', group: 'usb', id: 1, label: 'USB 1' },
    { key: 'usb:3', group: 'usb', id: 3, label: 'USB 3' },
  ];
  saveCustomMeters();
  renderActiveMeterTags();
})()`);
await sleep(120);
// The field is given a different number on purpose: what the matrix shows is the view, not the field.
const withWatchlist = await openMeterMatrix('5');
assert.deepEqual(withWatchlist.selected.slice().sort((a, b) => a - b), [1, 3],
  `the matrix must open with the meters already in the view (got ${withWatchlist.selected.join(', ')})`);
await closeMatrix();
await sleep(120);
await evaluate(`(() => { customMetersWatchlist = []; saveCustomMeters(); renderActiveMeterTags(); handleMeterFrame({}); })()`);
console.log(`7. the meter matrix opens with the view (empty -> nothing, usb:1+usb:3 -> ${withWatchlist.selected.join('/')})`);

// ── 8. A change made in the Meter Bridge reaches this window ──────────────────────────────────────
// Theme, peak hold and the graph rate are keys both windows write. The bridge listened to them and the
// dock did not, so the direction bridge → dock was missing: turning the peaks off (or picking the dark
// theme) in the bridge left this window as it was until a relaunch, and its next write of the key put
// the stale copy back (master plan 2026-09-22, §5.2 item 25).
const mirror = await evaluate(`(async () => {
  const raw = {
    theme: localStorage.getItem('wing_theme'),
    peak: localStorage.getItem('wing_peak_config'),
    fps: localStorage.getItem('wing_graph_refresh_fps'),
  };
  // A known starting state: every browser test shares this origin, so what this check asserts first
  // cannot depend on what the previous run left behind.
  localStorage.setItem('wing_peak_config', JSON.stringify({ enabled: true, duration: 2500, clipLatch: true }));
  loadPeakHoldConfig();
  syncPeakHoldControls();
  localStorage.setItem('wing_theme', 'light');
  applyDockTheme('light');
  const before = {
    theme: document.body.classList.contains('theme-dark'),
    peak: document.getElementById('chk-peak-hold')?.checked,
    peakInMemory: peakHoldConfig.enabled,
  };
  const fromBridge = (key, value) => {
    localStorage.setItem(key, value);
    // Exactly what this window receives when the other one writes it.
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  };
  fromBridge('wing_theme', 'dark');
  fromBridge('wing_peak_config', JSON.stringify({ enabled: false, duration: 2500, clipLatch: true }));
  // 15, not 12: this window's own slider steps by 5 and the browser snaps what it cannot hold.
  fromBridge('wing_graph_refresh_fps', '15');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const after = {
    theme: document.body.classList.contains('theme-dark'),
    peak: document.getElementById('chk-peak-hold')?.checked,
    peakInMemory: peakHoldConfig.enabled,
    peakSetting: document.getElementById('settings-peak-enabled')?.checked,
    fps: document.getElementById('settings-graph-refresh')?.value,
    fpsLabel: document.getElementById('settings-graph-refresh-val')?.textContent,
  };
  // The origin is shared by every browser test: the keys go back to what they were, in the store and
  // in this window's own state.
  if (raw.theme === null) localStorage.removeItem('wing_theme'); else localStorage.setItem('wing_theme', raw.theme);
  if (raw.peak === null) localStorage.removeItem('wing_peak_config'); else localStorage.setItem('wing_peak_config', raw.peak);
  if (raw.fps === null) localStorage.removeItem('wing_graph_refresh_fps'); else localStorage.setItem('wing_graph_refresh_fps', raw.fps);
  applyDockTheme(raw.theme || 'light');
  loadPeakHoldConfig();
  syncPeakHoldControls();
  syncGraphRefreshControl();
  return { before, after };
})()`);
assert.equal(mirror.before.theme, false, 'this check starts in the light theme');
assert.equal(mirror.before.peakInMemory, true, 'and with the peaks on');
assert.equal(mirror.after.theme, true, 'the theme the bridge picked must reach this window');
assert.equal(mirror.after.peak, false, 'the peak hold the bridge switched off must reach its own check box');
assert.equal(mirror.after.peakInMemory, false, 'and the object this window draws peaks from');
assert.equal(mirror.after.peakSetting, false, 'and the Settings control must show it too');
assert.equal(mirror.after.fps, '15', 'the graph rate the bridge set must reach this window\'s slider');
assert.equal(mirror.after.fpsLabel, '15/s', 'and its label');
console.log('8. bridge changes reach the dock:', JSON.stringify(mirror.after));

console.log('desktop meter layout contracts passed');

socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
