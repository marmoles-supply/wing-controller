// Verifies the Inspector / hover box answers for the controls the operator actually meets.
//
// The hover engine routes both the tooltip and the Inspector readout through `resolveHint`, so
// driving a pointermove over a control and reading the Inspector card is a real end-to-end check.
//
// Checks:
//   1. Controls with a hand-written entry answer as themselves, not as their container (the notice
//      button used to explain the whole macro it belongs to).
//   2. Controls with no hand-written entry get a real fallback: the label, what kind of control it
//      is and what it currently reads — never "X — part of WING CONTROL".
//   3. The whole surface reports a useful hint: every visible interactive control answers with a
//      title, a description longer than the label, and a section that is not the placeholder.
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is
// closed, and running it directly is a no-op in that case too.
//
// Run: node scripts/test-desktop-inspector-hints-browser.mjs
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
      core: {
        invoke: async (cmd, args) => {
          window.__INVOKES.push(cmd);
          if (cmd === 'load_macro_library') return { schemaVersion: 1, selectedIndex: 0, macros: [] };
          if (cmd === 'target_catalog') return { categories: [], targetParametersByCategory: {}, triggerParametersByCategory: {} };
          return {};
        },
      },
      event: { listen: async () => () => {} },
    };
  `,
});
await call('Page.navigate', { url: new URL('../desktop/ui/index.html', import.meta.url).href });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && Boolean(document.getElementById("inspector-desc"))')) break;
  await sleep(100);
}
assert.equal(await evaluate('typeof window.__TAURI__'), 'object', 'the stub must own the IPC layer');

async function hover(selector) {
  const dispatched = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerType: 'mouse',
      clientX: rect.left + Math.max(1, rect.width / 2),
      clientY: rect.top + Math.max(1, rect.height / 2),
    }));
    return true;
  })()`);
  assert.ok(dispatched, `${selector} must exist in the window`);
  await sleep(60);
  return evaluate(`(() => ({
    cat: document.getElementById('inspector-badge').textContent.trim(),
    id: document.getElementById('inspector-id-tag').textContent.trim(),
    title: document.getElementById('inspector-title').textContent.trim(),
    desc: document.getElementById('inspector-desc').textContent.trim(),
    tip: document.getElementById('inspector-tip').textContent.trim(),
  }))()`);
}

// --- 1. A control with its own entry answers as itself ---------------------
const notice = await hover('#library-toggle-notice');
assert.match(notice.title + notice.desc, /notice|courtesy/i, `the notice button must describe itself: ${JSON.stringify(notice)}`);
assert.doesNotMatch(notice.desc, /WHEN .*trigger/i, 'the notice button must not fall back to the macro description');
assert.equal(notice.id, '#library-toggle-notice', 'the hint must be tagged with the control, not the container');
console.log('1. Own entry wins over the container:', JSON.stringify({ title: notice.title, desc: notice.desc.slice(0, 90) }));

// --- 2. A control with no entry still gets a real hint --------------------
// The fallback has to keep working for controls added later, so it is exercised with synthetic
// controls injected here instead of relying on whatever happens to be unmapped today.
await evaluate(`(() => {
  const host = document.createElement('div');
  host.id = 'zz-fallback-host';
  host.innerHTML = [
    '<label>Stale ms <input id="zz-numeric" inputmode="numeric" value="1500" /></label>',
    '<label><input type="checkbox" id="zz-check" checked /><span>Arm on start</span></label>',
    '<label>Mode <select id="zz-select"><option>One</option><option selected>Two</option><option>Three</option></select></label>',
    '<button id="zz-icon-only" type="button">x</button>',
  ].join('');
  document.body.appendChild(host);
})()`);

const fallbackCases = [
  { selector: '#zz-numeric', title: /stale ms/i, expect: /number field/i, and: /1500/ },
  { selector: '#zz-check', title: /arm on start/i, expect: /check box/i, and: /ON/ },
  { selector: '#zz-select', title: /mode/i, expect: /dropdown/i, and: /"Two"/ },
  { selector: '#zz-icon-only', title: /icon only/i, expect: /button/i, and: null },
];
for (const { selector, title, expect, and } of fallbackCases) {
  const hint = await hover(selector);
  assert.match(hint.title, title, `${selector}: the fallback must read the label (${hint.title})`);
  assert.match(hint.desc, expect, `${selector}: the fallback must say what the control is (${hint.desc})`);
  if (and) assert.match(hint.desc, and, `${selector}: the fallback must report the current value (${hint.desc})`);
  assert.notEqual(hint.cat, 'WING CONTROL', `${selector}: the hint must name a real section`);
  assert.doesNotMatch(hint.desc, /— part of WING CONTROL/, `${selector}: the placeholder text must be gone`);
  console.log(`2. ${selector}:`, JSON.stringify({ cat: hint.cat, title: hint.title, desc: hint.desc.slice(0, 100) }));
}
await evaluate('document.getElementById("zz-fallback-host").remove()');

// --- 3. Settings pages answer too (the modal has to be open to hover it) ---
await evaluate('document.getElementById("open-settings-btn").click()');
await sleep(500);
const settingsVisible = await evaluate(`(() => {
  const modal = document.getElementById('settings-modal');
  return Boolean(modal) && modal.getBoundingClientRect().height > 0;
})()`);
assert.ok(settingsVisible, 'the settings dialog must open for the hover pass');
const ip = await hover('#settings-wing-ip');
assert.match(ip.desc, /network|IP/i, `the WING IP field must explain itself: ${JSON.stringify(ip)}`);
assert.ok(ip.tip.length > 20, `settings controls must still give a real tip: ${JSON.stringify(ip)}`);
const scale = await hover('#pref-hud-scale');
assert.match(scale.desc, /scale|%/i, `the HUD scale slider must report its range: ${JSON.stringify(scale)}`);
console.log('3. Settings controls:', JSON.stringify({ ip: ip.desc.slice(0, 80), scale: scale.desc.slice(0, 80) }));
await evaluate('document.getElementById("btn-close-settings")?.click()');
await sleep(200);

// --- 4. Every visible interactive control answers something useful ---------
const sweep = await evaluate(`(() => {
  const ids = Array.from(document.querySelectorAll('button[id], input[id], select[id], textarea[id]'))
    .filter((el) => el.getBoundingClientRect().height > 0)
    .map((el) => el.id);
  const flat = [];
  for (const id of ids) {
    const el = document.getElementById(id);
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerType: 'mouse',
      clientX: rect.left + Math.max(1, rect.width / 2),
      clientY: rect.top + Math.max(1, rect.height / 2),
    }));
    flat.push({
      id,
      hasTitle: Boolean(el.getAttribute('title')),
      title: document.getElementById('inspector-title').textContent.trim(),
      desc: document.getElementById('inspector-desc').textContent.trim(),
      cat: document.getElementById('inspector-badge').textContent.trim(),
    });
  }
  return flat;
})()`);
const stubs = sweep.filter((entry) => entry.desc.length < 20 || !entry.title || entry.title === 'Control');
assert.deepEqual(stubs, [], `every visible control must have a real hint, these did not: ${JSON.stringify(stubs)}`);

// The hint must never be the control's own id read aloud: that is how "win95-confirm-accept" reached
// the inspector as "Win95 confirm accept". A control with no `title` of its own must be described by
// an INSPECTOR_HINTS entry, its label, or its section — never by `humanizeControlId`.
const humanizeId = (id) => {
  const words = String(id).replace(/^(btn|pref|setting|settings|chk|slider)-/, '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
};
const readFromId = sweep.filter((entry) => !entry.hasTitle && entry.title === humanizeId(entry.id));
assert.deepEqual(readFromId, [],
  `these controls have no description of their own, so the inspector read their id aloud: ${JSON.stringify(readFromId)}`);
assert.ok(sweep.length >= 40, `the sweep must cover the window's controls (only ${sweep.length} found)`);
console.log(`4. ${sweep.length} visible controls all answer with a title, a section and a real description`);

// --- 5. The Meter Bridge answers for its controls too ----------------------
// The bridge has no Inspector panel: its ScreenTip is the only readout, so this drives the real
// pointermove path and reads the tooltip that would be shown to the operator.
await call('Page.navigate', { url: new URL('../desktop/ui/meters.html', import.meta.url).href });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && Boolean(document.getElementById("win95-hover-tooltip"))')) break;
  await sleep(100);
}
// Pin the watchlist so the sweep does not depend on whatever a previous browser test left in the
// shared Chrome profile: an empty one shows the empty state (and its button) like a fresh install.
await evaluate(`localStorage.removeItem('wing_custom_meters')`);
await call('Page.navigate', { url: new URL('../desktop/ui/meters.html', import.meta.url).href });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && Boolean(document.getElementById("win95-hover-tooltip"))')) break;
  await sleep(100);
}
await sleep(400); // let the bridge finish booting and attach its handlers

async function sweepBridge(label) {
  await evaluate(`(() => {
    for (const el of document.querySelectorAll('button[id], input[id], select[id], [role="button"][id]')) {
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) continue;
      el.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerType: 'mouse',
        clientX: rect.left + Math.max(1, rect.width / 2),
        clientY: rect.top + Math.max(1, rect.height / 2),
      }));
    }
    return true;
  })()`);
  // The tooltip only exists while the pointer rests on one control, so walk them one by one.
  const ids = await evaluate(`Array.from(document.querySelectorAll('button[id], input[id], select[id], [role="button"][id]'))
    .filter((el) => el.getBoundingClientRect().height > 0).map((el) => el.id)`);
  assert.ok(ids.length >= 12, `${label}: the bridge must expose its controls (only ${ids.length} found)`);
  const results = [];
  for (const id of ids) {
    await evaluate(`(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerType: 'mouse',
        clientX: rect.left + Math.max(1, rect.width / 2),
        clientY: rect.top + Math.max(1, rect.height / 2),
      }));
    })()`);
    // The ScreenTip only appears after the pointer rests (800 ms dwell) and every hop to another
    // control restarts it, so each one needs the full wait.
    await sleep(900);
    results.push(await evaluate(`(() => {
      const tip = document.getElementById('win95-hover-tooltip');
      return {
        id: ${JSON.stringify(id)},
        visible: getComputedStyle(tip).display !== 'none',
        title: tip.querySelector('.win95-hover-tooltip-title strong')?.textContent?.trim() || '',
        desc: tip.querySelector('.win95-hover-tooltip-desc')?.textContent?.trim() || '',
        cat: tip.querySelector('.win95-hover-tooltip-badge')?.textContent?.trim() || '',
      };
    })()`));
  }
  const silent = results.filter((entry) => !entry.visible || !entry.title || entry.desc.length < 20);
  assert.deepEqual(silent, [], `${label}: every control must show a real tooltip, these did not: ${JSON.stringify(silent)}`);
  console.log(`5. ${label}: ${results.length} controls answer with a titled ScreenTip`);
  return results;
}

await sweepBridge('meter bridge');
await evaluate('document.getElementById("btn-open-matrix").click()');
await sleep(600);
await sweepBridge('meter bridge matrix dialog');
await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');

// --- 6. The balloon is a static hint: it waits, and it leaves when the pointer moves -----
// It used to appear after 300 ms and then swap contents 60 ms after brushing the next control,
// which read as a tooltip glued to the cursor.
await call('Page.navigate', { url: new URL('../desktop/ui/index.html', import.meta.url).href });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && Boolean(document.getElementById("win95-hover-tooltip"))')) break;
  await sleep(100);
}
await sleep(600);

const tooltipState = `(() => {
  const tip = document.getElementById('win95-hover-tooltip');
  return { visible: getComputedStyle(tip).display !== 'none', title: tip.querySelector('.win95-hover-tooltip-title strong')?.textContent?.trim() || '' };
})()`;

async function pointAt(selector, dx = 0) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerType: 'mouse',
      clientX: rect.left + Math.max(1, rect.width / 2) + ${dx},
      clientY: rect.top + Math.max(1, rect.height / 2),
    }));
  })()`);
}

await pointAt('#library-select-all');
await sleep(250);
const tooEarly = await evaluate(tooltipState);
assert.equal(tooEarly.visible, false, `the balloon must wait for the pointer to rest, it showed after 250 ms (${JSON.stringify(tooEarly)})`);

await sleep(750);
const afterDwell = await evaluate(tooltipState);
assert.equal(afterDwell.visible, true, 'the balloon must appear once the pointer rests');
console.log('6. Dwell: hidden at 250 ms, shown after ~1 s:', JSON.stringify(afterDwell));

// Moving the pointer must take it away, not carry it to the next control.
await pointAt('#library-select-all', 40);
await sleep(120);
const afterMove = await evaluate(tooltipState);
assert.equal(afterMove.visible, false, `moving the pointer must dismiss the balloon (${JSON.stringify(afterMove)})`);
console.log('6. Movement dismisses it:', JSON.stringify(afterMove));

// --- 7. The open dropdown is a list to read, not a control to explain --------------------------
// The balloon and the Inspector readout chased the cursor across the grouped picker's rows and
// covered the very list being read. Inside an open menu neither is driven; outside it the hint is
// untouched, which the check below proves by asking for the same balloon on a normal control.
//
// A category has to be chosen first, and the page fills its own state asynchronously (the stored
// library lands after the first paint), so the choice is re-asserted until the parameter list is
// really there instead of trusting a fixed sleep.
//
// The earlier sections drive the window with a stubbed backend bridge, and a stub that answers
// `target_catalog` with nothing leaves the selects with no categories at all. This section needs a
// real list, so it restores the page's own fallback catalogue — the same constant the editor uses
// when the backend is unreachable — before choosing a category.
await evaluate(`(() => { targetCatalog = targetCatalogFallback; populateCategorySelects(); })()`);

async function chooseChannelCategory() {
  let last = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await evaluate(`(() => {
      const category = document.getElementById('target-category');
      if (category.value !== 'ch') {
        category.value = 'ch';
        category.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await sleep(100);
    last = await evaluate(`(() => {
      const select = document.getElementById('target-parameter');
      const category = document.getElementById('target-category');
      return {
        exists: Boolean(select),
        options: select ? select.options.length : -1,
        categoryOptions: category ? category.options.length : -1,
        categoryValue: category ? category.value : '',
        url: location.href,
      };
    })()`);
    if (last.options > 1) return last.options;
  }
  throw new Error(`the channel parameters must be selectable: ${JSON.stringify(last)}`);
}

const channelOptions = await chooseChannelCategory();
assert.ok(channelOptions > 1, `the channel parameters must be selectable (got ${channelOptions})`);
await pointAt('#target-parameter-menu');
await sleep(120);
await evaluate(`document.getElementById('target-parameter-menu').click()`);
await sleep(250);
const menuOpen = await evaluate(`!document.getElementById('target-parameter-menu-list').hidden`);
assert.equal(menuOpen, true, 'the picker must open for the dropdown check');

/** Waits for the menu to list a row: the panel is built from the catalogue of the chosen category,
    so asserting on a fixed sleep would be a race against that refresh (the lesson of `3dcb884b`). */
async function waitForMenuRow() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(`Boolean(document.querySelector('#target-parameter-menu-list .parameter-menu-row'))`)) return true;
    await sleep(100);
  }
  return false;
}

assert.equal(await waitForMenuRow(), true, 'the picker must list the channel parameters');

/** Moves the pointer onto the first row of the open menu and reports both halves of the check: the
    row's own attributes right after the event (the panel can be rebuilt by a catalogue refresh, so
    reading them later would race that rebuild) and the balloon state after the full dwell. */
async function pointAtMenuRow() {
  const row = await evaluate(`(() => {
    const row = document.querySelector('#target-parameter-menu-list .parameter-menu-row');
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerType: 'mouse',
      clientX: rect.left + Math.max(1, rect.width / 2),
      clientY: rect.top + Math.max(1, rect.height / 2),
    }));
    return {
      label: row.textContent.trim(),
      title: row.getAttribute('title') || '',
      tooltipText: row.getAttribute('data-tooltip-text') || '',
    };
  })()`);
  await sleep(950);
  return { row, tooltip: await evaluate(tooltipState) };
}

const overRow = await pointAtMenuRow();
assert.equal(overRow.tooltip.visible, false,
  `the balloon must stay away while the pointer is inside the dropdown (row "${overRow.row.label}", ${JSON.stringify(overRow.tooltip)})`);
// The row's own title is still converted, so the browser's native tooltip cannot appear in its place.
assert.equal(overRow.row.title, '', 'no menu row may keep a native title');
console.log(`7. Dropdown: no balloon over the open list (row "${overRow.row.label}")`);

// Inside a submenu too, which is the same list one level down.
await evaluate(`document.querySelector('#target-parameter-menu-list .parameter-menu-row.is-group').dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))`);
await sleep(150);
const submenu = await evaluate(`(() => {
  const sub = document.querySelector('#target-parameter-menu-list .parameter-menu-submenu');
  const row = sub?.querySelector('.parameter-menu-row');
  if (!row) return { found: false };
  const rect = row.getBoundingClientRect();
  row.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerType: 'mouse',
    clientX: rect.left + Math.max(1, rect.width / 2),
    clientY: rect.top + Math.max(1, rect.height / 2),
  }));
  return { found: true, label: row.textContent.trim() };
})()`);
await sleep(950);
const inSubmenu = await evaluate(tooltipState);
if (submenu.found) {
  assert.equal(inSubmenu.visible, false,
    `the balloon must stay away inside a submenu too (row "${submenu.label}")`);
  console.log(`7. Submenu: no balloon either (row "${submenu.label}")`);
}

// Closing the menu hands the hint back: the very next control answers with its balloon.
await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))`);
await sleep(120);
await pointAt('#library-select-all');
await sleep(950);
const afterClose = await evaluate(tooltipState);
assert.equal(afterClose.visible, true,
  `outside the dropdown the balloon must still appear (${JSON.stringify(afterClose)})`);
console.log('7. Outside the dropdown the hint is untouched:', JSON.stringify(afterClose));

socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
