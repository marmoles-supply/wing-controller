// Diagnostics blocks and the "Only meters" button.
//
// Two behaviours the operator reported broken:
//
//   1. Collapsing a Diagnostics block must never hide its own chevron. The OSC monitor keeps its
//      header inside the section, so hiding the section hid the only way back in: the block could
//      be collapsed once and never reopened. The same has to hold for the Probe block, which could
//      not be collapsed at all before this test existed.
//   2. "Only meters" hides the CONFIGURATION of the meters card (view strip and channel ingest) and
//      leaves the meters; it is a button inside that card, so it must not hide the builder column,
//      the seam or the other cards. The bank row is a VIEW control (which group to watch), so it
//      stays visible: the operator can switch banks in focus mode.
//
// Needs Chrome on the debug port (the gate starts one); without it the test says so and passes.
//
// Run: node scripts/test-desktop-diagnostics-blocks-browser.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;

async function debuggerPages() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

const pages = await debuggerPages();
if (!pages) {
  console.log(`SKIP: no Chrome remote debugging on port ${DEBUG_PORT}`);
  process.exit(3);
}

const target = await (
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })
).json();
assert.ok(target?.webSocketDebuggerUrl, 'could not open a Chrome tab for this test');
process.on('exit', () => {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', `http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`]);
  } catch (_) {}
});

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});
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
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await call('Page.enable');
// The window talks to Rust for the catalogue, the library and the stream: stub the IPC it needs.
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__TAURI__ = {
      core: {
        invoke: async (cmd) => {
          if (cmd === 'load_macro_library') {
            // Una macro habilitada: las comprobaciones de la fila (NOTICE / RENAME / ENABLED) la
            // necesitan, y no estorba a las de los bloques de Diagnostics.
            return {
              schemaVersion: 1,
              selectedIndex: 0,
              macros: [{
                name: 'Macro uno',
                enabled: true,
                triggerCategory: 'usb',
                triggerIds: '1',
                triggerParameter: 'meter',
                triggerOperator: '>',
                triggerThreshold: -18,
                actionAddress: '/ch/1/mute',
                actionArgKind: 'int',
                actionValue: '1',
                actionMode: 'set',
                actionSteps: [{ actionAddress: '/ch/1/mute', actionArgKind: 'int', actionValue: '1', actionMode: 'set' }],
              }],
            };
          }
          if (cmd === 'target_catalog') return { categories: [], targetParametersByCategory: {}, triggerParametersByCategory: {} };
          // The library save answers with the library it was given: the window keeps whatever the
          // command returns, so an empty object here broke every later syncState (the colour tag
          // click saves, and the health check below repaints).
          if (cmd === 'save_macro_library') return args?.library ?? { macros: [] };
          if (cmd === 'save_show_runner_config') return args?.config ?? {};
          return {};
        },
      },
      event: {
        listen: async (event, handler) => {
          window.__LISTENERS = window.__LISTENERS || {};
          window.__LISTENERS[event] = handler;
          return () => {};
        },
      },
    };
  `,
});
// Start from a clean slate: the collapsed state is persisted, and a previous run must not decide
// what this one sees.
await call('Page.navigate', { url: new URL('../desktop/ui/index.html', import.meta.url).href });
await sleep(1200);
await evaluate(`(() => {
  localStorage.removeItem('wing_diag_collapsed');
  localStorage.removeItem('wing_card_collapsed');
  localStorage.removeItem('wing_meters_solo');
  localStorage.removeItem('wing_custom_meters');
})()`);
await call('Page.reload');
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && Boolean(document.getElementById("btn-meters-solo"))')) break;
  await sleep(100);
}

const visible = (selector) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.height > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
})()`);

const click = async (selector) => {
  const clicked = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.ok(clicked, `${selector} must exist in the window`);
  await sleep(120);
};

// The Diagnostics card is collapsed in the markup; open it so its blocks are measurable.
await evaluate(`document.querySelector('[data-card-id="diagnostics"]').classList.remove('is-collapsed')`);
await sleep(120);
assert.equal(await visible('[data-diag-body="probe"]'), true, 'the Probe block must start expanded');

// --- 1. Every block collapses and, above all, can be collapsed back ---------
const BLOCKS = [
  { name: 'osc', body: '#osc-log-terminal', chevron: '[data-diag-chevron="osc"]' },
  { name: 'probe', body: '[data-diag-body="probe"]', chevron: '[data-diag-chevron="probe"]' },
  { name: 'health', body: '[data-diag-body="health"]', chevron: '[data-diag-chevron="health"]' },
  { name: 'stream', body: '#stream-output', chevron: '[data-diag-chevron="stream"]' },
];
for (const block of BLOCKS) {
  assert.equal(await visible(block.body), true, `${block.name} must start visible`);
  await click(block.chevron);
  assert.equal(await visible(block.body), false, `collapsing ${block.name} must hide its content`);
  // This is the regression: the chevron lives inside the block for the OSC monitor, so hiding the
  // wrong node left the operator without a way back.
  assert.equal(
    await visible(block.chevron),
    true,
    `${block.name}: the chevron must stay reachable while the block is collapsed`,
  );
  await click(block.chevron);
  assert.equal(await visible(block.body), true, `${block.name} must reopen from its chevron`);

  // The header row is the other click target; it must toggle as well.
  await click(`[data-diag-toggle="${block.name}"]`);
  assert.equal(await visible(block.body), false, `clicking the ${block.name} header must collapse it`);
  await click(block.chevron);
  assert.equal(await visible(block.body), true, `${block.name} must reopen from its chevron (second round)`);
}
console.log('1. every Diagnostics block collapses and reopens from its chevron');

// --- 2. "Only meters" hides the card's controls, not the window -------------
const CONFIGURATION = ['.meter-view-strip', '.meter-ingest-panel'];
for (const selector of CONFIGURATION) {
  assert.equal(await visible(selector), true, `${selector} must start visible`);
}
await click('#btn-meters-solo');
for (const selector of CONFIGURATION) {
  assert.equal(await visible(selector), false, `Only meters must hide ${selector}`);
}
// The meters themselves are claimed by the mode's own rule, which names the two control panels and
// nothing else: `body.meters-solo .meter-view-strip, body.meters-solo .meter-ingest-panel`. The check
// therefore asks whether the mode hid the container, not whether it has meters to draw — this suite
// starts from an empty watchlist, and the container is only painted when a meter value arrives (its
// own "No meters in watchlist" note included), so it has no height for `visible()` to measure.
const metersContainer = await evaluate(`(() => {
  const el = document.getElementById('meters-container');
  if (!el) return null;
  const style = getComputedStyle(el);
  return { display: style.display, visibility: style.visibility, box: el.getClientRects().length };
})()`);
assert.notEqual(metersContainer?.display, 'none', 'Only meters must leave the meters container on screen');
assert.notEqual(metersContainer?.visibility, 'hidden', 'and must not hide it another way');
assert.ok(metersContainer?.box > 0, 'the container must still generate its box in that mode');
assert.equal(await visible('.builder-column'), true, 'Only meters must not hide the builder column');
assert.equal(
  await visible('[data-card-id="logs"]'),
  true,
  'Only meters must not hide the other cards',
);
assert.equal(await visible('#btn-meters-solo'), true, 'the button itself must stay reachable');
assert.equal(
  await evaluate(`localStorage.getItem('wing_meters_solo')`),
  'true',
  'the mode must be remembered between sessions',
);

await click('#btn-meters-solo');
for (const selector of CONFIGURATION) {
  assert.equal(await visible(selector), true, `leaving the mode must bring ${selector} back`);
}
assert.equal(await evaluate(`localStorage.getItem('wing_meters_solo')`), 'false');

// Escape is the way out for an operator who cannot find the button.
await click('#btn-meters-solo');
assert.equal(await visible('.meter-ingest-panel'), false, 'the mode must be on before Escape');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(120);
assert.equal(await visible('.meter-ingest-panel'), true, 'Escape must leave the Only meters mode');
console.log('2. Only meters hides the meter controls and leaves the rest of the window alone');

// --- 3. The state survives a reload ----------------------------------------
await click('#btn-meters-solo');
await click('[data-diag-chevron="probe"]');
await call('Page.reload');
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && Boolean(document.getElementById("btn-meters-solo"))')) break;
  await sleep(100);
}
await evaluate(`document.querySelector('[data-card-id="diagnostics"]').classList.remove('is-collapsed')`);
await sleep(150);
assert.equal(await visible('.meter-ingest-panel'), false, 'the Only meters mode must survive a reload');
assert.equal(await visible('[data-diag-body="probe"]'), false, 'a collapsed block must stay collapsed');
assert.equal(
  await visible('[data-diag-chevron="probe"]'),
  true,
  'and it must still be reopenable after a reload',
);
await click('[data-diag-chevron="probe"]');
assert.equal(await visible('[data-diag-body="probe"]'), true, 'reopening after a reload must work');
console.log('3. the collapsed blocks and the mode survive a reload');

// --- 4. The window chrome the audit fixed ---------------------------------
// The macro row buttons say what they do, the ENABLED state is unmistakable, the category tag is a
// real control with an Inspector entry and the window scrollbars are out of the way.
await evaluate(`(() => {
  localStorage.setItem('wing_custom_meters', JSON.stringify([{ key: 'ch:1', label: 'CH 1' }]));
})()`);
await call('Page.reload');
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && Boolean(document.querySelector(".macro-row"))')) break;
  await sleep(100);
}
await sleep(400);

const row = await evaluate(`(() => {
  const first = document.querySelector('.macro-row');
  const enabled = first?.querySelector('.macro-enable-button');
  const style = enabled ? getComputedStyle(enabled) : null;
  const tag = document.getElementById('builder-color-tag-dot');
  const name = document.getElementById('builder-color-tag-name');
  const beforeTag = { className: tag?.className, name: name?.textContent };
  tag?.click();
  return {
    notice: first?.querySelector('.macro-notice-btn')?.textContent,
    rename: first?.querySelector('.macro-rename-button')?.textContent,
    tagElement: tag?.tagName,
    inspectorHook: tag?.dataset.inspector,
    beforeTag,
    afterTag: { className: tag?.className, name: name?.textContent },
    // El relleno del estado activo es la TRAMA del modulo (PNG ordenado), no un degradado suave:
    // un linear-gradient ahi desentonaba con el resto de la ventana.
    enabledBackgroundImage: String(style?.backgroundImage || ''),
    enabledTop: style?.borderTopColor,
    enabledBottom: style?.borderBottomColor,
    enabledGlow: String(style?.boxShadow || ''),
    titleGlow: getComputedStyle(document.querySelector('.app-main-title')).textShadow,
  };
})()`);
assert.equal(row.notice, 'NOTICE', 'the notice button must be labelled, not a bare icon');
assert.equal(row.rename, 'RENAME', 'the pencil button must be labelled RENAME');
assert.equal(row.tagElement, 'BUTTON', 'the category tag must be a real control, not a span');
assert.equal(row.inspectorHook, 'builder-color-tag-dot', 'the category tag must answer in the Inspector');
assert.notEqual(row.afterTag.className, row.beforeTag.className, 'clicking the tag must cycle the colour');
assert.notEqual(row.afterTag.name, row.beforeTag.name, 'the tag must write the colour name next to it');
assert.equal(row.afterTag.name, String(row.afterTag.className).replace('macro-tag-dot tag-', ''));
assert.match(
  row.enabledBackgroundImage,
  /^url\("data:image\/png/,
  'the enabled state must wear the ordered-dither ramp (pixel style), not a smooth gradient',
);
assert.ok(
  !row.enabledBackgroundImage.includes('linear-gradient'),
  'the enabled state must not paint a smooth gradient: that reads as a modern button',
);
assert.ok(
  !/rgba?\([^)]*0\.\d+\)\s+0px\s+0px/.test(row.enabledGlow) && !/0 0 \d+px/.test(row.enabledGlow),
  `the enabled state must not glow (audit): ${row.enabledGlow}`,
);
assert.equal(
  row.titleGlow,
  'none',
  'the header app name must be flat: no soft glow',
);
assert.notEqual(
  row.enabledTop,
  row.enabledBottom,
  'the enabled button must have a bevel (light top, dark bottom) so it reads as active',
);

// The Inspector answers for it: hover it and read the card.
const tagHint = await evaluate(`(async () => {
  const tag = document.getElementById('builder-color-tag-dot');
  const rect = tag.getBoundingClientRect();
  tag.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: rect.left + 3, clientY: rect.top + 3 }));
  await new Promise((resolve) => setTimeout(resolve, 80));
  return {
    title: document.getElementById('inspector-title').textContent.trim(),
    desc: document.getElementById('inspector-desc').textContent.trim(),
  };
})()`);
assert.match(tagHint.title, /Category Tag/i, `the tag must have its own Inspector title: ${tagHint.title}`);
assert.ok(tagHint.desc.length > 40, `the tag must explain itself in the Inspector: ${tagHint.desc}`);

// Scrollbars: the window scrolls, but no bar takes width from the layout.
const gutters = await evaluate(`(() => {
  const measure = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const previous = el.style.maxHeight;
    el.style.maxHeight = '80px';
    const gutter = el.offsetWidth - el.clientWidth;
    el.style.maxHeight = previous;
    return gutter;
  };
  return {
    page: window.innerWidth - document.documentElement.clientWidth,
    opsColumn: measure('.ops-column'),
    library: measure('#macro-library-list'),
    steps: measure('.steps-list'),
  };
})()`);
assert.equal(gutters.page, 0, 'the window itself must not show a scrollbar gutter');
for (const [name, gutter] of Object.entries(gutters)) {
  if (name === 'page' || gutter === null) continue;
  assert.ok(gutter <= 2, `${name} must not reserve scrollbar width (borders count 2px, got ${gutter})`);
}
console.log('4. row buttons, ENABLED bevel, category tag and hidden scrollbars');
console.log('desktop Diagnostics blocks, Only meters and window chrome contracts passed');

// --- 5. The health grid stops claiming the last session's numbers when the stream drops -------------
// The backend stops emitting `meter-stream-health` with the stream, so every row that only the emitter
// writes stayed frozen under a grid that said "no stream is running": Rate, Bytes and Decode were
// blanked and Hits, RX, Renew, Events, Dropped, the trigger latency and the header's hit counter were
// not (master plan 2026-09-22, §5.2 item 19).
const HEALTH_ROWS = ['health-rate', 'health-bytes', 'health-decode', 'health-hits', 'health-rx', 'health-renew',
  'health-events', 'health-dropped', 'health-trigger-latency', 'top-health-rate', 'top-health-hits'];

// The counter is named for what it counts (master plan 2026-09-22 §7 item 10): `trigger_hits` is how
// many times a macro's trigger conditions were **evaluated and met**, not a count of meter events, and
// an operator reading "Hits" took it for the packet or event count beside it.
const hitLabels = await evaluate(`JSON.stringify({
  header: document.querySelector('.master-stats span') ? Array.from(document.querySelectorAll('.master-stats span')).map((node) => node.textContent).find((text) => /Hits|Evaluations/.test(text)) : '',
  grid: Array.from(document.querySelectorAll('.health-grid .health-item span')).map((node) => node.textContent).find((text) => /Hits|Evaluations/.test(text)) || '',
})`);
const hitLabelsParsed = JSON.parse(hitLabels);
assert.ok(!/Hits/.test(hitLabelsParsed.header || '') && /Evaluations/.test(hitLabelsParsed.header || ''),
  `the header counter must read "Evaluations" and not "Hits" (got ${JSON.stringify(hitLabelsParsed.header)})`);
assert.ok(!/Hits/.test(hitLabelsParsed.grid || '') && /Evaluations/.test(hitLabelsParsed.grid || ''),
  `the health row must read "Evaluations" and not "Hits" (got ${JSON.stringify(hitLabelsParsed.grid)})`);
const healthStale = await evaluate(`(async () => {
  const emitter = (window.__LISTENERS || {})['meter-stream-health'];
  const status = (window.__LISTENERS || {})['usb-meter-stream-status'];
  if (!emitter || !status) return { error: 'the window must listen to the health and the status events' };
  emitter({ payload: {
    state: 'live', packetRateHz: 42.5, byteRateBps: 12345, lastDecodeMicros: 120, triggerHits: 7,
    lastRxMsAgo: 20, lastRenewMsAgo: 900, decodedEvents: 88, droppedMeterCount: 2,
    triggerLatencySamples: 5, triggerLatencyP50Micros: 300, triggerLatencyP95Micros: 900,
  } });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const ids = ${JSON.stringify(HEALTH_ROWS)};
  const read = () => Object.fromEntries(ids.map((id) => [id, document.getElementById(id)?.textContent ?? null]));
  const live = read();
  status({ payload: { state: 'disconnected', message: 'link lost' } });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const dropped = read();
  return { live, dropped, title: document.querySelector('.health-grid')?.title || '' };
})()`);
assert.ok(!healthStale.error, healthStale.error || '');
for (const id of HEALTH_ROWS) {
  assert.ok(healthStale.live[id] && healthStale.live[id] !== '\u2013',
    `the live reading must fill ${id} first (got ${JSON.stringify(healthStale.live[id])})`);
  assert.equal(healthStale.dropped[id], '\u2013',
    `${id} must stop showing the last session's number when the stream drops (got ${JSON.stringify(healthStale.dropped[id])})`);
}
assert.match(healthStale.title, /last session/i,
  `and the grid must say where those numbers come from (got "${healthStale.title}")`);
console.log('5. the health grid is blanked when the stream drops:', HEALTH_ROWS.length, 'rows');

// Leave the shared origin the way it was found. The page is served from `file://`, so every browser
// test in the gate shares this localStorage: a leftover `wing_meters_solo` or a collapsed block would
// hide controls from the next test (the Inspector sweep counts visible ones) and look like a bug in
// the window instead of a test that did not clean up.
await evaluate(`(() => {
  localStorage.removeItem('wing_diag_collapsed');
  localStorage.removeItem('wing_card_collapsed');
  localStorage.removeItem('wing_meters_solo');
  localStorage.removeItem('wing_custom_meters');
})()`);
socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
