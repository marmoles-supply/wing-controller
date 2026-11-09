// The custom-bank selector in BOTH windows.
//
// The operator wants the same groups in both: a bank is a named set of meters he can watch in either
// window, and each window remembers its own choice (the dock `wing_dock_bank`, the bridge
// `wing_meters_bank`) so what one shows does not change what the other shows.
//
// Two failures that used to make this look broken:
//   1. "New bank" in the bridge saved the WHOLE watchlist, so the bank was identical to "All meters"
//      and selecting it changed nothing. It asks which meters it keeps now.
//   2. A bank whose meters were not in that window's watchlist left the grid empty or snapped the
//      dropdown back to "All meters". A bank's meters are shown and subscribed anyway, and the row
//      says how many of them are outside the watchlist.
//
// Needs Chrome on the debug port (the gate starts one); without it the test says so and passes.
//
// Run: node scripts/test-desktop-meter-bank-selector-browser.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
const DOCK = new URL('../desktop/ui/index.html', import.meta.url).href;
const BRIDGE = new URL('../desktop/ui/meters.html', import.meta.url).href;

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
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    // A token the page carries per document. This script runs before the window's own scripts on every
    // navigation, so a change of token is proof that a reloaded document is the one being read.
    window.__wingTestDocument = String(Date.now()) + ':' + Math.random();
    window.__TAURI__ = {
      core: {
        invoke: async (cmd) => {
          if (cmd === 'load_macro_library') return { schemaVersion: 1, selectedIndex: 0, macros: [] };
          if (cmd === 'target_catalog') return { categories: {}, targetParametersByCategory: {}, triggerParametersByCategory: {} };
          return {};
        },
      },
      event: { listen: async (name, handler) => {
        // The window's own handlers are kept, not discarded: the contracts below drive the real
        // meter-frame path instead of only its rendering function.
        (window.__listeners = window.__listeners || {})[name] = handler;
        return () => {};
      } },
      window: { getCurrentWindow: () => ({
        setAlwaysOnTop: async () => {}, setFocus: async () => {}, setPosition: async () => {},
        setSize: async () => {}, onCloseRequested: async () => () => {}, close: async () => {},
      }) },
    };
  `,
});

const WATCHLIST = [
  { key: 'ch:1', label: 'CH 1' },
  { key: 'ch:2', label: 'CH 2' },
  { key: 'usb:3', label: 'USB 3' },
];

const load = async (url, seed) => {
  await call('Page.navigate', { url });
  await sleep(1200);
  await evaluate(seed);
  // The reload is waited for by its document, not by `document.readyState` alone: right after
  // `Page.reload` the outgoing document still answers "complete", so that poll could pass while the
  // new document was blank. The suite then interrogated a page whose script had not run and aborted
  // with "… is not defined" before a single contract was checked.
  const previous = await evaluate('String(window.__wingTestDocument || "")');
  await call('Page.reload');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await evaluate(
      '({ ready: document.readyState, token: String(window.__wingTestDocument || "") })',
    );
    if (state.ready === 'complete' && state.token && state.token !== previous) break;
    await sleep(100);
  }
  await sleep(900);
};

// --- 1. Both windows list the same banks, and each keeps its own choice ------
await load(DOCK, `(() => {
  localStorage.setItem('wing_custom_meters', JSON.stringify([{ key: 'ch:1', label: 'CH 1' }]));
  localStorage.setItem('wing_meter_banks', JSON.stringify([
    { id: 'bA', name: 'Voces', keys: ['ch:2', 'ch:3'] },
    { id: 'bB', name: 'Bateria', keys: ['ch:1'] },
  ]));
  localStorage.removeItem('wing_dock_bank');
  localStorage.removeItem('wing_meters_bank');
})()`);

const dockPick = await evaluate(`(() => {
  const select = document.getElementById('meter-bank-select');
  const listed = Array.from(select.options).map((option) => option.textContent);
  select.value = 'bA';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return {
    listed,
    stored: localStorage.getItem('wing_dock_bank'),
    visible: visibleMeters().map((item) => item.key),
    subscription: subscriptionMeters().map((item) => item.key),
  };
})()`);
assert.deepEqual(dockPick.listed, ['All meters (1)', 'Voces (2)', 'Bateria (1)'],
  `the dock must list the banks the bridge stores: ${dockPick.listed}`);
assert.equal(dockPick.stored, 'bA', 'the dock must remember its own choice');
assert.deepEqual(dockPick.visible, ['ch:2', 'ch:3'],
  'the dock must show the bank meters even when they are not in its watchlist');
assert.deepEqual(dockPick.subscription, ['ch:1', 'ch:2', 'ch:3'],
  'and it must subscribe them, or the group would show no data');
console.log('1. the dock lists the shared banks and filters by the chosen one');

// --- 2. The two windows are independent -------------------------------------
// Each window keeps ITS own choice under its own key, so changing bank in one does not touch the
// other. (Both windows share an origin, so looking at the shared store is enough.)
await load(BRIDGE, `void 0`);
const bridgeState = await evaluate(`(() => {
  selectMeterGroupFilter('bank:bB');
  return {
    active: activeGroupFilter,
    bridge: localStorage.getItem('wing_meters_bank'),
    dock: localStorage.getItem('wing_dock_bank'),
  };
})()`);
assert.equal(bridgeState.active, 'bank:bB', 'the bridge must switch to its own bank');
assert.equal(bridgeState.bridge, 'bB', 'the bridge must remember its own choice');
assert.equal(bridgeState.dock, 'bA', 'the dock choice must be untouched by the bridge');
console.log('2. each window keeps its own bank, with the same shared groups');

// --- 3. And the dock restores its own choice after a reload -----------------
await load(DOCK, `void 0`);
const dockRestored = await evaluate(`({
  value: document.getElementById('meter-bank-select').value,
  visible: visibleMeters().map((item) => item.key),
  bank: localStorage.getItem('wing_meters_bank'),
})`);
assert.equal(dockRestored.value, 'bA', 'the dock must restore the bank it had chosen');
assert.deepEqual(dockRestored.visible, ['ch:2', 'ch:3'], 'and show that bank again');
assert.equal(dockRestored.bank, 'bB', 'while the bridge keeps its own different choice');
console.log('3. the dock restores its own bank while the bridge keeps another');

await load(BRIDGE, `(() => {
  localStorage.setItem('wing_custom_meters', JSON.stringify(${JSON.stringify(WATCHLIST)}));
  localStorage.removeItem('wing_meter_banks');
})()`);

const created = await evaluate(`(async () => {
  // "New bank" asks for a name and then for the meters it keeps.
  document.querySelector('[data-bank-new]').click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const input = document.getElementById('meters-prompt-input');
  input.value = 'Solo CH2';
  document.getElementById('meters-prompt-accept').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const picker = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
    .find((overlay) => overlay.querySelector('[data-meter-pick]'));
  if (!picker) return { error: 'the meter picker did not open' };
  const boxes = Array.from(picker.querySelectorAll('[data-meter-pick]'));
  boxes.forEach((box) => { box.checked = box.dataset.meterPick === 'ch:2'; });
  picker.querySelector('[data-pick="accept"]').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const banks = JSON.parse(localStorage.getItem('wing_meter_banks') || '[]');
  return {
    boxes: boxes.length,
    allCheckedAtStart: boxes.every((box) => box.checked) === false ? 'some' : 'all',
    banks: banks.map((bank) => ({ name: bank.name, keys: bank.keys })),
  };
})()`);
assert.ok(!created.error, `creating a bank in the bridge must ask which meters it keeps: ${created.error}`);
assert.equal(created.boxes, WATCHLIST.length, 'the picker must list the watchlist');
assert.deepEqual(
  created.banks,
  [{ name: 'Solo CH2', keys: ['ch:2'] }],
  'the bridge must store the chosen subset, not the whole watchlist',
);
console.log('4. the bridge saves the chosen subset of the watchlist');

// --- 5. And the bridge filters with it -------------------------------------
const bridgeFilter = await evaluate(`(() => {
  const bank = (JSON.parse(localStorage.getItem('wing_meter_banks') || '[]'))[0];
  selectMeterGroupFilter('bank:' + bank.id);
  return {
    active: activeGroupFilter,
    keys: getChannelsForGroup(activeGroupFilter, activeBankFilter).map((item) => item.key),
  };
})()`);
assert.equal(bridgeFilter.active, `bank:${'b'}`.slice(0, 5) + bridgeFilter.active.slice(5), 'the bank tab must become active');
assert.deepEqual(bridgeFilter.keys, ['ch:2'], 'the bridge must show only the bank\'s meters');
console.log('5. the bridge filters the strips with the saved bank');

// --- 6. One drawn dropdown for every select in both windows -----------------
//
// The owner's report: the window mixed two looks, because macOS draws a native `<select>` itself
// (WKWebView ignores `appearance: none` on one) while the macro editor's parameter field is the
// app's own control. `dropdown.js` hides every plain list behind the grouped picker's own field —
// the same classes, the same box — and this walks EVERY select of both documents to hold it to that:
// the source hidden, the button wearing the picker's classes, one row per option plus one header per
// `<optgroup>`, a row writing the source and firing `change` at a real consumer, the keyboard walk,
// and a refused option that cannot be chosen.
// The marker names something only the wanted window has: `window.WingDropdown` is defined in both
// documents, so waiting for it can be satisfied by the page that is being navigated away from and the
// sweep then reads an empty document (measured: "0 of 0 selects are drawn").
const loadDocument = async (url, marker) => {
  await call('Page.navigate', { url });
  let ready = false;
  for (let attempt = 0; attempt < 80 && !ready; attempt += 1) {
    ready = await evaluate(`document.readyState === "complete"
      && location.href === ${JSON.stringify(url)}
      && Boolean(document.querySelector(${JSON.stringify(marker)}))
      && Boolean(window.WingDropdown)`);
    if (!ready) await sleep(100);
  }
  assert.ok(ready, `${url} must load before the drawn dropdowns are read`);
  await sleep(600);
};

// The measured box of the drawn field: the button, the panel, the row it paints as highlighted, the
// heading an `<optgroup>` becomes, and — in the workstation — the grouped picker's own button and
// group row, which are the reference this component copies. Boxes with different amounts of content
// (a panel's height) are compared field by field in Node, never wholesale.
const LOOK_SIGNATURE = `(() => {
  const box = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      height: Math.round(rect.height),
      minHeight: style.minHeight,
      padding: style.padding,
      border: [style.borderTopWidth, style.borderTopStyle, style.borderTopColor, style.borderRightColor, style.borderBottomColor].join(' '),
      background: style.backgroundColor,
      chevron: style.backgroundImage,
      chevronPosition: style.backgroundPosition,
      chevronSize: style.backgroundSize,
      shadow: style.boxShadow,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStack: style.fontFamily,
      colour: style.color,
      justify: style.justifyContent,
    };
  };
  const drawnHosts = Array.from(document.querySelectorAll('[data-dropdown-for]'));
  const host = drawnHosts.find((item) => !item.querySelector('.dropdown-button')?.disabled) || drawnHosts[0];
  const groupHost = drawnHosts.find((item) => item.querySelector('.dropdown-group')) || null;
  window.WingDropdown.closeAll();
  const button = host?.querySelector('.dropdown-button');
  const panel = host?.querySelector('.dropdown-panel');
  if (button) button.click();
  const rows = Array.from(panel?.querySelectorAll('.dropdown-row') || []);
  const active = panel?.querySelector('.dropdown-row.is-active');
  // A row at rest: the chosen one is bold with a bullet, and the highlighted one wears the hover
  // paint, so neither says what an ordinary row looks like. The activeRow check below covers the
  // highlight.
  const row = rows.find((item) => !item.classList.contains('is-active') && !item.classList.contains('is-selected')) || rows[0];
  const header = groupHost?.querySelector('.dropdown-group');
  const signature = {
    referenceButton: box(document.getElementById('target-parameter-menu')),
    button: box(button),
    panel: box(panel),
    row: box(row),
    activeRow: active ? { background: getComputedStyle(active).backgroundColor, colour: getComputedStyle(active).color } : null,
    header: box(header),
    headerChevron: header ? getComputedStyle(header, '::after').content : null,
    headerPointer: header ? getComputedStyle(header).pointerEvents : null,
  };
  window.WingDropdown.closeAll();
  // The picker's own group row, for the heading to be measured against. It is opened last so the two
  // components never fight over the same corner of the window.
  const pickerButton = document.getElementById('target-parameter-menu');
  if (pickerButton) {
    pickerButton.click();
    const pickerPanel = document.getElementById('target-parameter-menu-list');
    const pickerGroupRow = pickerPanel.querySelector('.parameter-menu-row.is-group');
    signature.pickerPanel = box(pickerPanel);
    signature.pickerGroupRow = box(pickerGroupRow);
    signature.pickerGroupChevron = pickerGroupRow ? getComputedStyle(pickerGroupRow, '::after').content : null;
    pickerButton.click();
  } else {
    signature.pickerPanel = null;
    signature.pickerGroupRow = null;
    signature.pickerGroupChevron = null;
  }
  return signature;
})()`;

const sweepDropdowns = async (url, label, marker, theme) => {
  await loadDocument(url, marker);
  // The theme has to be pinned, not inherited. Each `file://` document keeps its own storage, so the
  // two windows can sit in different themes, and each keeps whatever the profile last held — this
  // suite compared the bridge in the dark theme against a workstation in the light one and reported
  // the difference as a layout defect (measured 2026-10-10: the dock's highlighted row was
  // `rgb(224, 230, 237)` — the dark row ink — against the light expectation hard-coded below, while
  // both windows agreed with each other and with the picker in each theme). Pinning it also means the
  // dark theme is measured rather than assumed, which is where the design rules say the defects hide.
  await evaluate(`localStorage.setItem("wing_theme", ${JSON.stringify(theme)})`);
  await loadDocument(url, marker);
  const applied = await evaluate(`document.body.classList.contains("theme-dark") ? "dark" : "light"`);
  assert.equal(applied, theme, `${label}: the window must load in the ${theme} theme it was asked for (got ${applied})`);
  const shape = await evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    const hostOf = (select) => document.querySelector('[data-dropdown-for="' + select.id + '"]');
    const drawn = selects.filter((select) => select.hasAttribute('data-dropdown-drawn'));
    const rest = selects.filter((select) => !select.hasAttribute('data-dropdown-drawn'));
    const problems = [];
    for (const select of drawn) {
      const host = hostOf(select);
      const button = host?.querySelector('.dropdown-button');
      const panel = host?.querySelector('.dropdown-panel');
      if (!host) { problems.push(select.id + ': the list has no drawn host'); continue; }
      if (!button?.classList.contains('parameter-menu-button')) problems.push(select.id + ': the button does not wear parameter-menu-button');
      if (!panel?.classList.contains('parameter-menu') || !panel.classList.contains('is-flat')) problems.push(select.id + ': the panel is not a parameter-menu is-flat');
      if (getComputedStyle(select).display !== 'none') problems.push(select.id + ': the native list is still drawn');
      if (!select.classList.contains('parameter-picker-source')) problems.push(select.id + ': the source is not hidden the way the picker hides its own');
      if (button.disabled !== Boolean(select.disabled)) problems.push(select.id + ': the drawn field ignores the source disabled state');
      if (button.getAttribute('aria-haspopup') !== 'listbox') problems.push(select.id + ': the button does not advertise a listbox');
      if (panel.getAttribute('role') !== 'listbox') problems.push(select.id + ': the panel is not a listbox');
      if (button.getAttribute('aria-controls') !== panel.id) problems.push(select.id + ': aria-controls does not point at the panel');
      if (button.getAttribute('aria-expanded') !== 'false') problems.push(select.id + ': a closed field must start collapsed');
      const option = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
      const shown = button.querySelector('.parameter-menu-value')?.textContent ?? '';
      if (option && shown !== option.textContent.trim()) problems.push(select.id + ': the button reads "' + shown + '" instead of "' + option.textContent.trim() + '"');
    }
    return {
      selects: selects.length,
      drawn: drawn.length,
      // A grouped parameter picker keeps its own control: the hidden list carrying
      // .parameter-picker-source is the picker's and it is left alone on purpose.
      ownedByPickers: rest.filter((select) => document.querySelector('[data-parameter-picker="' + select.id + '"]')).map((select) => select.id),
      unexplained: rest.filter((select) => !document.querySelector('[data-parameter-picker="' + select.id + '"]')).map((select) => select.id),
      problems,
    };
  })()`);
  assert.equal(shape.problems.length, 0, `${label}: every drawn dropdown must be the shared component: ${JSON.stringify(shape.problems)}`);
  assert.deepEqual(shape.unexplained, [], `${label}: every select must be drawn or owned by a grouped picker`);
  console.log(`6. ${label}: ${shape.drawn} of ${shape.selects} selects are drawn; the rest are the pickers' (${shape.ownedByPickers.join(', ') || 'none'})`);

  // One row per option, one header per `<optgroup>`, in the source's own order.
  const panels = await evaluate(`(() => {
    const results = [];
    for (const host of Array.from(document.querySelectorAll('[data-dropdown-for]'))) {
      const select = document.getElementById(host.dataset.dropdownFor);
      const button = host.querySelector('.dropdown-button');
      const panel = host.querySelector('.dropdown-panel');
      window.WingDropdown.closeAll();
      const disabled = button.disabled;
      if (!disabled) button.click();
      const rows = Array.from(panel.querySelectorAll('.dropdown-row'));
      const headers = Array.from(panel.querySelectorAll('.dropdown-group'));
      const rect = panel.getBoundingClientRect();
      results.push({
        id: select.id,
        disabled,
        // A field the app has put away (a kind that swapped it out, a collapsed cell) still has to
        // list its options, but it has no geometry to measure.
        visible: !disabled && panel.getClientRects().length > 0,
        open: !panel.hidden,
        expanded: button.getAttribute('aria-expanded'),
        rows: rows.length,
        options: select.options.length,
        headers: headers.length,
        optgroups: select.querySelectorAll('optgroup').length,
        rowValues: rows.map((row) => row.getAttribute('data-menu-value')).join('\\u0001'),
        optionValues: Array.from(select.options).map((option) => option.value).join('\\u0001'),
        rowRoles: rows.every((row) => row.getAttribute('role') === 'option'),
        rowLabels: rows.every((row) => row.classList.contains('parameter-menu-row') && Boolean(row.querySelector('.parameter-menu-label'))),
        headersAreHeadings: headers.every((header) => header.tagName !== 'BUTTON' && header.getAttribute('role') === 'presentation' && header.classList.contains('is-group') && header.classList.contains('is-header')),
        selectedRows: rows.filter((row) => row.classList.contains('is-selected')).length,
        expectedSelected: select.selectedIndex >= 0 ? 1 : 0,
        selectableRows: rows.filter((row) => !row.disabled).length,
        activeValue: panel.querySelector('.dropdown-row.is-active')?.getAttribute('data-menu-value') ?? null,
        value: select.value,
        panelWidth: Math.round(rect.width),
        clientHeight: Math.round(panel.clientHeight),
        scrolls: panel.scrollHeight > panel.clientHeight,
        windowWidth: window.innerWidth,
        panelLeft: Math.round(rect.left),
        panelRight: Math.round(rect.right),
      });
      window.WingDropdown.closeAll();
    }
    return results;
  })()`);
  assert.ok(panels.length > 0, `${label}: the window must have drawn dropdowns`);
  for (const panel of panels) {
    const where = `${label} · ${panel.id}`;
    if (panel.disabled) {
      // A disabled field cannot be operated at all, which is exactly what it must say.
      assert.equal(panel.open, false, `${where}: a disabled field must not open`);
      continue;
    }
    assert.equal(panel.open, true, `${where}: the button must open its panel`);
    assert.equal(panel.expanded, 'true', `${where}: an open field must say it is expanded`);
    assert.equal(panel.rows, panel.options, `${where}: the panel must list one row per option (${panel.rows} rows for ${panel.options} options)`);
    assert.equal(panel.rowValues, panel.optionValues, `${where}: the rows must carry the options in the source's own order`);
    assert.equal(panel.headers, panel.optgroups, `${where}: each <optgroup> must be one header row`);
    assert.equal(panel.rowRoles, true, `${where}: every row must be a listbox option`);
    assert.equal(panel.rowLabels, true, `${where}: every row must carry the picker's row label`);
    assert.equal(panel.headersAreHeadings, true, `${where}: a group heading must be a plain heading, not a choice`);
    assert.equal(panel.selectedRows, panel.expectedSelected, `${where}: the chosen option must be the marked row`);
    if (panel.expectedSelected === 1) {
      assert.equal(panel.activeValue, panel.value, `${where}: opening must highlight the current choice`);
    } else {
      assert.equal(panel.activeValue, panel.selectableRows > 0 ? panel.activeValue : null,
        `${where}: an unset field must still highlight its first choice`);
    }
    if (panel.visible) {
      assert.ok(panel.panelWidth >= Math.min(220, panel.windowWidth - 8),
        `${where}: the panel must be at least the picker's own width (got ${panel.panelWidth}px)`);
      assert.ok(panel.panelWidth <= Math.min(340, panel.windowWidth - 8),
        `${where}: the panel must stay the picker's box width (got ${panel.panelWidth}px)`);
      assert.ok(panel.panelLeft >= 0 && panel.panelRight <= panel.windowWidth,
        `${where}: the panel must not leave the window (${panel.panelLeft}..${panel.panelRight} of ${panel.windowWidth})`);
      if (panel.rows > 16) {
        // A long list scrolls inside the shared cap (parameter-menu.is-flat: max-height 320px) instead
        // of running past the bottom of the window.
        assert.ok(panel.clientHeight <= 320,
          `${where}: a long list must stay inside the picker's 320px cap (got ${panel.clientHeight}px)`);
        assert.equal(panel.scrolls, true, `${where}: a long list must scroll in its panel`);
      }
    }
  }
  console.log(`6. ${label}: ${panels.length} drawn fields list their options as rows and headings, inside the window`);

  return { shape, panels, look: await evaluate(LOOK_SIGNATURE) };
};

// The two windows are compared theme by theme, never across themes.
const THEMES = ['light', 'dark'];
const looks = {};
for (const theme of THEMES) {
  looks[theme] = {
    dock: await sweepDropdowns(DOCK, `workstation (${theme})`, '#target-parameter-menu', theme),
    bridge: await sweepDropdowns(BRIDGE, `meter bridge (${theme})`, '#meter-layout-select', theme),
  };
}
const dock = looks.light.dock;
const bridge = looks.light.bridge;
const reference = dock.look.referenceButton;
assert.ok(reference, 'the workstation must still publish the grouped picker button as the reference field');

const pick = (box, fields) => Object.fromEntries(fields.map((field) => [field, box?.[field] ?? null]));
const BUTTON_FIELDS = ['height', 'minHeight', 'padding', 'border', 'background', 'fontSize', 'fontWeight', 'colour', 'shadow'];
// The panel's own `font-weight` is skipped: it is whatever the block around the field inherits, and
// no text in the panel uses it — every row states its own weight, which the row check below reads.
const PANEL_FIELDS = ['padding', 'border', 'background', 'fontSize', 'shadow'];
const ROW_FIELDS = ['minHeight', 'padding', 'fontSize', 'fontWeight', 'colour', 'justify'];
// The two windows keep their own `--win-font` stacks and the bridge's lists `Arial` last; the faces
// that are actually asked for first (and so the glyphs on screen) have to be the same.
const leadingFamilies = (stack) => String(stack).split(',').slice(0, 5)
  .map((name) => name.trim().replace(/^"|"$/g, ''));
// The closed box of every drawn field is the picker's own field, in both windows — in each theme,
// because a colour that agrees in one theme can be a literal that never flips in the other.
for (const theme of THEMES) {
  const dock = looks[theme].dock;
  const bridge = looks[theme].bridge;
  const reference = dock.look.referenceButton;
  const where = `the ${theme} theme`;
  assert.deepEqual(pick(dock.look.button, BUTTON_FIELDS), pick(reference, BUTTON_FIELDS),
    `${where}: the drawn field must wear the picker's box (got ${JSON.stringify(pick(dock.look.button, BUTTON_FIELDS))})`);
  assert.deepEqual(pick(bridge.look.button, BUTTON_FIELDS), pick(reference, BUTTON_FIELDS),
    `${where}: the bridge's drawn field must wear the station's box (got ${JSON.stringify(pick(bridge.look.button, BUTTON_FIELDS))})`);
  for (const [name, look] of [['workstation', dock.look], ['meter bridge', bridge.look]]) {
    assert.equal(look.button.chevron, reference.chevron, `${where}: ${name}: the drawn field must draw the picker's chevron`);
    assert.equal(look.button.chevronPosition, reference.chevronPosition, `${where}: ${name}: the chevron must sit where the picker puts it`);
    assert.equal(look.button.chevronSize, reference.chevronSize, `${where}: ${name}: the chevron must be the picker's 10x6 glyph`);
    assert.deepEqual(leadingFamilies(look.button.fontStack), leadingFamilies(reference.fontStack),
      `${where}: ${name}: the drawn field must ask for the same faces first (got ${JSON.stringify(leadingFamilies(look.button.fontStack))})`);
  }
  assert.ok(dock.look.pickerPanel, `${where}: the grouped picker panel is the open-list reference`);
  assert.deepEqual(pick(dock.look.panel, PANEL_FIELDS), pick(dock.look.pickerPanel, PANEL_FIELDS),
    `${where}: the open panel must wear the picker panel box (got ${JSON.stringify(pick(dock.look.panel, PANEL_FIELDS))})`);
  assert.deepEqual(pick(bridge.look.panel, PANEL_FIELDS), pick(dock.look.panel, PANEL_FIELDS),
    `${where}: the bridge's open panel must wear the workstation panel's box`);
  assert.deepEqual(pick(bridge.look.row, ROW_FIELDS), pick(dock.look.row, ROW_FIELDS),
    `${where}: the bridge's rows must measure like the workstation's`);
  assert.deepEqual(leadingFamilies(bridge.look.row.fontStack), leadingFamilies(dock.look.row.fontStack),
    `${where}: the bridge rows must ask for the same faces as the workstation rows`);
  // The highlight paint is theme-dependent, and by one rule: the hover rule is `.parameter-menu-row:hover`
  // (0,2,0) and the dark row rule is `body.theme-dark .parameter-menu-row` (0,2,1), so in the dark theme the
  // row's own ink wins over the hover rule's white while the blue background stays. Pinned per theme, so a
  // change to either rule is a failure rather than a colour nobody looked at.
  const highlight = theme === 'dark'
    ? { background: 'rgb(0, 0, 128)', colour: 'rgb(224, 230, 237)' }
    : { background: 'rgb(0, 0, 128)', colour: 'rgb(255, 255, 255)' };
  assert.deepEqual(dock.look.activeRow, highlight,
    `${where}: the highlighted row must wear the picker's hover paint (got ${JSON.stringify(dock.look.activeRow)})`);
  assert.deepEqual(bridge.look.activeRow, dock.look.activeRow,
    `${where}: the bridge must highlight a row exactly as the workstation does`);
  // The heading an `<optgroup>` becomes keeps the picker group row's metrics without its branch.
  assert.equal(dock.look.headerChevron, 'none', `${where}: an <optgroup> heading must not draw the group row's branch chevron`);
  assert.equal(dock.look.headerPointer, 'none', `${where}: a heading must not be clickable`);
  assert.equal(bridge.look.header, null, `${where}: the bridge has no grouped list to head — nothing to compare`);
  if (dock.look.pickerGroupRow) {
    assert.deepEqual(pick(dock.look.header, ['minHeight', 'padding', 'font']), pick(dock.look.pickerGroupRow, ['minHeight', 'padding', 'font']),
      `${where}: a heading must keep the grouped picker's group row metrics`);
    assert.equal(dock.look.pickerGroupChevron, '"▸"', `${where}: the picker's group row keeps its branch chevron`);
  }
}
console.log('6. the drawn box, the panel, the row and the heading measure exactly like the grouped picker\'s');

// Choosing a row writes the source and fires what a real selection fires; a consumer in the page
// reacts to it. The workstation's summary style is one the settings page stores and repaints.
await loadDocument(DOCK, '#target-parameter-menu');
const dockChoice = await evaluate(`(async () => {
  // Through the window's own entry point: the summary field lives on the General page of Properties,
  // and a field inside a closed dialog cannot take the focus back after a choice.
  document.getElementById('open-settings-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const select = document.getElementById('settings-macro-summary');
  const button = document.getElementById('settings-macro-summary-menu');
  const panel = document.getElementById('settings-macro-summary-listbox');
  // A stored preference from an earlier run must not decide whether this check has anything to do:
  // the window is put on the other style first, the way the operator would — before the counters are
  // attached, so this write is not counted as the choice below.
  const before = select.value === 'blocks' ? 'lines' : select.value;
  select.value = before;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const seen = { input: 0, change: 0 };
  const onInput = () => { seen.input += 1; };
  const onChange = () => { seen.change += 1; };
  select.addEventListener('input', onInput);
  select.addEventListener('change', onChange);
  window.WingDropdown.closeAll();
  button.click();
  const opened = !panel.hidden;
  const row = Array.from(panel.querySelectorAll('.dropdown-row')).find((item) => item.getAttribute('data-menu-value') === 'blocks');
  row.click();
  const state = {
    opened,
    value: select.value,
    seen,
    stored: localStorage.getItem('wing_macro_summary'),
    cardsClass: document.body.classList.contains('macro-summary-blocks'),
    closed: panel.hidden,
    focusedButton: document.activeElement === button,
  };
  select.removeEventListener('input', onInput);
  select.removeEventListener('change', onChange);
  select.value = before;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return { before, state };
})()`);
assert.equal(dockChoice.state.opened, true, 'the workstation panel must open before a row can be chosen');
assert.equal(dockChoice.state.value, 'blocks', 'choosing a row must write the source list');
assert.deepEqual(dockChoice.state.seen, { input: 1, change: 1 },
  `a choice must fire input + change exactly once (got ${JSON.stringify(dockChoice.state.seen)})`);
assert.equal(dockChoice.state.stored, 'blocks', 'the editor\'s own change listener must run: the chosen summary style is stored');
assert.equal(dockChoice.state.cardsClass, true, 'and the window must repaint with what the listener applied');
assert.equal(dockChoice.state.closed, true, 'choosing must close the panel');
assert.equal(dockChoice.state.focusedButton, true, 'and leave the focus on the drawn field');
console.log(`6. workstation: a row wrote the list, fired input + change once, and the editor stored "${dockChoice.state.stored}"`);

await loadDocument(BRIDGE, '#meter-layout-select');
const bridgeChoice = await evaluate(`(() => {
  const select = document.getElementById('meter-style-select');
  const button = document.getElementById('meter-style-select-menu');
  const panel = document.getElementById('meter-style-select-listbox');
  let changes = 0;
  const count = () => { changes += 1; };
  // The stored style of an earlier run must not decide the outcome: start from the other drawing.
  select.value = 'bars';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  select.addEventListener('change', count);
  window.WingDropdown.closeAll();
  button.click();
  const drawn = () => Array.from(panel.querySelectorAll('.dropdown-row'));
  drawn().find((item) => item.getAttribute('data-menu-value') === 'vu').click();
  const first = changes;
  // Choosing the entry that is already selected is not a selection: a native list fires nothing, and
  // the drawn one must not either.
  button.click();
  drawn().find((item) => item.getAttribute('data-menu-value') === 'vu').click();
  const twice = changes;
  select.removeEventListener('change', count);
  return {
    value: select.value,
    changes: first,
    unchanged: twice - first,
    stored: localStorage.getItem('wing_meters_style'),
    graphSpeedHidden: document.getElementById('graph-speed-wrap').style.display === 'none',
  };
})()`);
assert.equal(bridgeChoice.value, 'vu', 'the bridge row must write its own list');
assert.equal(bridgeChoice.changes, 1, 'and fire one change');
assert.equal(bridgeChoice.unchanged, 0, 're-choosing the selected entry must fire nothing, exactly as a native list does');
assert.equal(bridgeChoice.stored, 'vu', 'the bridge\'s own listener must run: the chosen style is stored');
assert.equal(bridgeChoice.graphSpeedHidden, true, 'and the window must repaint with what the listener applied');
console.log('6. meter bridge: a row wrote the list and the bridge repainted with the chosen style');

// Keyboard: ArrowDown opens on the current choice and walks it, Enter chooses, Escape closes and gives
// the focus back without touching the choice, and type-ahead jumps without choosing or closing.
const keyboard = await evaluate(`(() => {
  const select = document.getElementById('meter-style-select');
  const button = document.getElementById('meter-style-select-menu');
  const panel = document.getElementById('meter-style-select-listbox');
  const keys = (key) => button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const activeValue = () => panel.querySelector('.dropdown-row.is-active')?.getAttribute('data-menu-value') ?? null;
  window.WingDropdown.closeAll();
  button.focus();
  const before = select.value;
  keys('ArrowDown');
  const announced = document.getElementById(button.getAttribute('aria-activedescendant') || '');
  const opened = {
    open: !panel.hidden,
    expanded: button.getAttribute('aria-expanded'),
    active: activeValue(),
    announced: announced?.getAttribute('data-menu-value') ?? null,
    announcedRole: announced?.getAttribute('role') ?? null,
    announcedSelected: announced?.getAttribute('aria-selected') ?? null,
  };
  keys('ArrowDown');
  const moved = activeValue();
  keys('Enter');
  const chosen = {
    value: select.value,
    closed: panel.hidden,
    focusedButton: document.activeElement === button,
    label: button.querySelector('.parameter-menu-value').textContent,
    optionLabel: select.selectedIndex >= 0 ? select.options[select.selectedIndex].textContent.trim() : '',
  };
  keys('ArrowDown');
  const reopened = !panel.hidden;
  keys('Escape');
  const escaped = { closed: panel.hidden, focusedButton: document.activeElement === button, value: select.value };
  keys('ArrowDown');
  keys('g');
  const typed = { open: !panel.hidden, active: activeValue(), value: select.value };
  keys('Escape');
  select.value = 'bars';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return { before, opened, moved, chosen, reopened, escaped, typed };
})()`);
assert.equal(keyboard.opened.open, true, 'ArrowDown must open the drawn list');
assert.equal(keyboard.opened.expanded, 'true', 'an open field must announce itself as expanded');
assert.equal(keyboard.opened.active, keyboard.before, 'ArrowDown must open on the current choice');
assert.equal(keyboard.opened.announced, keyboard.opened.active, 'the field must announce the row it highlights through aria-activedescendant');
assert.equal(keyboard.opened.announcedRole, 'option', 'the announced row must be a listbox option');
assert.equal(keyboard.opened.announcedSelected, 'true', 'the row the field opened on is the chosen one');
assert.notEqual(keyboard.moved, keyboard.before, 'the second ArrowDown must walk the list');
assert.equal(keyboard.opened.active, keyboard.before, 'and the highlight must have moved off the first row');
assert.equal(keyboard.chosen.value, keyboard.moved, 'Enter must choose the highlighted row');
assert.equal(keyboard.chosen.closed, true, 'Enter must close the panel');
assert.equal(keyboard.chosen.focusedButton, true, 'Enter must leave the focus on the drawn field');
assert.equal(keyboard.chosen.label, keyboard.chosen.optionLabel, 'the drawn field must name the choice it now carries');
assert.equal(keyboard.reopened, true, 'ArrowDown must reopen the list');
assert.equal(keyboard.escaped.closed, true, 'Escape must close the panel');
assert.equal(keyboard.escaped.focusedButton, true, 'Escape must give the focus back to the button');
assert.equal(keyboard.escaped.value, keyboard.chosen.value, 'Escape must leave the choice alone');
assert.equal(keyboard.typed.open, true, 'type-ahead must not close the panel');
assert.equal(keyboard.typed.value, keyboard.chosen.value, 'type-ahead must not choose anything');
assert.equal(keyboard.typed.active, 'graph', `type-ahead must jump to the first option starting with the letters (got "${keyboard.typed.active}")`);
console.log(`6. meter bridge: ArrowDown opened on "${keyboard.opened.active}", Enter chose "${keyboard.chosen.value}", Escape closed, type-ahead jumped to "${keyboard.typed.active}"`);

// One panel at a time, and a click anywhere else closes the open one.
const dismissal = await evaluate(`(() => {
  const styleHost = document.querySelector('[data-dropdown-for="meter-style-select"]');
  const layoutHost = document.querySelector('[data-dropdown-for="meter-layout-select"]');
  const stylePanel = styleHost.querySelector('.dropdown-panel');
  const layoutPanel = layoutHost.querySelector('.dropdown-panel');
  const styleButton = styleHost.querySelector('.dropdown-button');
  const layoutButton = layoutHost.querySelector('.dropdown-button');
  window.WingDropdown.closeAll();
  styleButton.click();
  const firstOpen = !stylePanel.hidden;
  if (!layoutButton.disabled) layoutButton.click();
  const second = { firstClosed: stylePanel.hidden, secondOpen: !layoutPanel.hidden };
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const outside = { secondClosed: layoutPanel.hidden };
  window.WingDropdown.closeAll();
  return { firstOpen, second, outside, firstExpanded: styleButton.getAttribute('aria-expanded') };
})()`);
assert.equal(dismissal.firstOpen, true, 'the bridge panel must open before the dismissal checks');
assert.equal(dismissal.second.firstClosed, true, 'opening another dropdown must close the open one');
assert.equal(dismissal.second.secondOpen, true, 'and the second one must be the open one');
assert.equal(dismissal.firstExpanded, 'false', 'a collapsed field must say it is collapsed again');
assert.equal(dismissal.outside.secondClosed, true, 'a click outside must close the open list');
console.log('6. meter bridge: one panel at a time, and a click outside closes it');

// A list too long to read in one go carries a second level. "Sources" holds sixteen families (Maillot
// 1955-1965) and "Outputs" eleven (1844-1846), so the window writes the family onto each `<option>`
// (`data-subgroup`) and the drawn list heads every run of them — "Local", "Stage box", "Card & USB" —
// under the group's own heading. The `<optgroup>` keeps the coarse group alone: an `<optgroup>` cannot
// nest, and the native list is what the rest of the app reads.
await loadDocument(DOCK, '#target-parameter-menu');
const secondLevel = await evaluate(`(() => {
  const select = document.getElementById('trigger-category');
  const host = document.querySelector('[data-dropdown-for="trigger-category"]');
  const button = host.querySelector('.dropdown-button');
  const panel = host.querySelector('.dropdown-panel');
  window.WingDropdown.closeAll();
  if (!button.disabled) button.click();
  const optgroups = Array.from(select.querySelectorAll('optgroup'));
  // What the source says: one run per group and family, in reading order.
  const runs = [];
  let currentGroup = null;
  let previous = '';
  for (const option of Array.from(select.options)) {
    const group = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '';
    if (group !== currentGroup) { currentGroup = group; previous = ''; }
    const subgroup = option.dataset.subgroup || '';
    if (subgroup && subgroup !== previous) runs.push(group + ': ' + subgroup);
    previous = subgroup;
  }
  // What the panel paints, in the same shape.
  const painted = [];
  let current = null;
  for (const child of Array.from(panel.children)) {
    if (child.classList.contains('dropdown-group')) current = child.textContent.trim();
    else if (child.classList.contains('dropdown-subgroup')) painted.push(current + ': ' + child.textContent.trim());
  }
  // A heading is not a choice: the arrow walk never lands on one, and it is inert to the pointer.
  const keys = (key) => button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  keys('Home');
  const walked = [];
  for (let i = 0; i < 14; i += 1) {
    keys('ArrowDown');
    const active = panel.querySelector('.dropdown-row.is-active');
    walked.push(active ? (active.getAttribute('data-menu-value') || '') : '');
  }
  const inert = Array.from(panel.querySelectorAll('.dropdown-subgroup')).every((row) => getComputedStyle(row).pointerEvents === 'none');
  const sourceGroup = optgroups.find((group) => group.label === 'Sources');
  const state = {
    runs,
    painted,
    sourceOptions: sourceGroup ? sourceGroup.querySelectorAll('option').length : 0,
    groupHeaders: panel.querySelectorAll('.dropdown-group').length,
    optgroups: optgroups.length,
    subheads: panel.querySelectorAll('.dropdown-subgroup').length,
    walked,
    inert,
  };
  window.WingDropdown.closeAll();
  return state;
})()`);
// The two long families of the catalogue are both in the fallback now (the eleven output families
// joined it on 2026-09-27), so a field addressed at either of them reads in two levels: five runs of
// families inside "Sources" and three inside "Outputs", each headed under the group's own heading.
assert.deepEqual(secondLevel.runs, [
  'Sources: Local',
  'Sources: Stage box',
  'Sources: Card & USB',
  'Sources: Internal',
  'Sources: Bus meters',
  'Outputs: Local',
  'Outputs: Stage box',
  'Outputs: Card & USB',
], `the source and output families must be marked in the document's own order (got ${JSON.stringify(secondLevel.runs)})`);
assert.deepEqual(secondLevel.painted, secondLevel.runs,
  `every run of a second level must be headed, in order (got ${JSON.stringify(secondLevel.painted)})`);
assert.equal(secondLevel.subheads, secondLevel.runs.length, 'one subheading per run of a family, no more');
assert.equal(secondLevel.sourceOptions, 16, 'the sixteen documented input sources stay in the source group');
assert.equal(secondLevel.groupHeaders, secondLevel.optgroups,
  'the coarser heading stays one per `<optgroup>`: the native list is what the rest of the app reads');
assert.equal(secondLevel.inert, true, 'a subheading must be inert to the pointer, like a group heading');
assert.equal(secondLevel.walked.every((value) => value.length > 0), true,
  `every arrow step must land on a choice (got ${JSON.stringify(secondLevel.walked)})`);
console.log(`6. workstation: "Source" heads its families (${secondLevel.runs.map((run) => run.split(': ')[1]).join(', ')}) inside the group, and the arrow walk skips them`);

// The meter card's own "Group / Source" list picks from the same families, so it is read the same way
// — and its runs are kept together, which is what keeps a heading from appearing twice.
const meterFamilies = await evaluate(`(() => {
  const select = document.getElementById('meter-add-group');
  const host = document.querySelector('[data-dropdown-for="meter-add-group"]');
  const button = host.querySelector('.dropdown-button');
  const panel = host.querySelector('.dropdown-panel');
  window.WingDropdown.closeAll();
  button.click();
  const runs = [];
  const painted = [];
  let current = null;
  let previous = '';
  for (const option of Array.from(select.options)) {
    const group = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '';
    if (group !== current) { current = group; previous = ''; }
    const subgroup = option.dataset.subgroup || '';
    if (subgroup && subgroup !== previous) runs.push(group + ': ' + subgroup);
    previous = subgroup;
  }
  let heading = null;
  for (const child of Array.from(panel.children)) {
    if (child.classList.contains('dropdown-group')) heading = child.textContent.trim();
    else if (child.classList.contains('dropdown-subgroup')) painted.push(heading + ': ' + child.textContent.trim());
  }
  const state = {
    runs,
    painted,
    inputs: select.querySelector('optgroup[label^="Physical Inputs"]')?.querySelectorAll('option').length ?? 0,
    outputs: select.querySelector('optgroup[label^="Physical Outputs"]')?.querySelectorAll('option').length ?? 0,
    selected: select.value,
    // The option the card opens on must survive the grouped reading.
    stillSelected: Array.from(select.options).filter((option) => option.selected).length,
  };
  window.WingDropdown.closeAll();
  return state;
})()`);
assert.deepEqual(meterFamilies.runs, [
  'Physical Inputs (Maillot 0xA7): Local',
  'Physical Inputs (Maillot 0xA7): Stage box',
  'Physical Inputs (Maillot 0xA7): Card & USB',
  'Physical Inputs (Maillot 0xA7): Internal',
  'Physical Inputs (Maillot 0xA7): Bus meters',
  'Physical Outputs (Maillot 0xA8): Local',
  'Physical Outputs (Maillot 0xA8): Stage box',
  'Physical Outputs (Maillot 0xA8): Card & USB',
], `the meter card must read the same families as the macro editor (got ${JSON.stringify(meterFamilies.runs)})`);
assert.deepEqual(meterFamilies.painted, meterFamilies.runs,
  'and the drawn list must head each of those runs, once');
assert.equal(meterFamilies.inputs, 16, 'the sixteen input families stay in their group');
assert.equal(meterFamilies.outputs, 11, 'the eleven output families stay in theirs');
assert.equal(meterFamilies.stillSelected, 1, 'exactly one option stays selected after the grouped reading');
console.log(`6. workstation: the meter card reads its ${meterFamilies.inputs} input and ${meterFamilies.outputs} output families the same way`);

// The per-meter state follows the watchlist. History, VU state and peak hold are keyed by meter and
// nothing used to remove a key, so over a show the window kept the history of every meter it had ever
// shown. A meter that leaves the watchlist gives its state back; the one that stays keeps its history,
// which is what makes a graph survive a bank change.
const meterState = await evaluate(`(async () => {
  const holds = (name, key) => { try { return eval(name).has(key); } catch (e) { return null; } };
  const size = (name) => { try { return eval(name).size; } catch (e) { return -1; } };
  // No bank may add a key behind the test's back: the subscription is then the watchlist alone.
  customMeterBanks.length = 0;
  activeMeterBankId = '';
  customMetersWatchlist = [{ key: 'ch:1', label: 'CH 1', group: 'ch', id: 1 }];
  renderActiveMeterTags();
  await syncMetersWithBackend();
  handleMeterFrame({ meters: [{ key: 'ch:1', label: 'CH 1', value: -20 }] });
  const kept = {
    history: holds('meterHistoryBuffers', 'ch:1'),
    vu: holds('meterVuStates', 'ch:1'),
    peaks: holds('meterPeakData', 'ch:1'),
  };
  customMetersWatchlist = [{ key: 'usb:3', label: 'USB 3', group: 'usb', id: 3 }];
  renderActiveMeterTags();
  await syncMetersWithBackend();
  handleMeterFrame({ meters: [{ key: 'usb:3', label: 'USB 3', value: -30 }] });
  return {
    kept,
    after: {
      ch1History: holds('meterHistoryBuffers', 'ch:1'),
      ch1Vu: holds('meterVuStates', 'ch:1'),
      ch1Peaks: holds('meterPeakData', 'ch:1'),
      usb3History: holds('meterHistoryBuffers', 'usb:3'),
      size: size('meterHistoryBuffers'),
    },
  };
})()`);
assert.equal(
  meterState.kept.history && meterState.kept.vu && meterState.kept.peaks,
  true,
  `a watched meter must keep its history, its VU state and its peak (got ${JSON.stringify(meterState.kept)})`,
);
assert.equal(meterState.after.ch1History, false, 'a meter that left the watchlist must give its history back');
assert.equal(meterState.after.ch1Vu, false, 'and its VU state');
assert.equal(meterState.after.ch1Peaks, false, 'and its peak hold');
assert.equal(meterState.after.usb3History, true, 'while the meter that took its place keeps its own');
console.log(`6. workstation: the per-meter state follows the watchlist (${meterState.after.size} buffers after the swap)`);

// A console that sends faster than the window can paint must not build a queue: the frames between two
// paints are merged into the one that is owed (the peak survives), and one task of twenty frames costs
// exactly one paint. This is the contract that keeps memory tied to the configuration and not to the
// length of the show.
const coalesced = await evaluate(`(async () => {
  const handler = (window.__listeners || {})['usb-meter-frame'];
  if (!handler) return { skipped: true };
  customMeterBanks.length = 0;
  activeMeterBankId = '';
  customMetersWatchlist = [{ key: 'ch:1', label: 'CH 1', group: 'ch', id: 1 }];
  renderActiveMeterTags();
  meterPeakData.delete('ch:1');
  const original = handleMeterFrame;
  let paints = 0;
  handleMeterFrame = (frame) => { paints += 1; return original(frame); };
  // Twenty frames delivered in one task, as a console that outruns the window would deliver them: one
  // of them is the loudest, and it is the value the operator must still see.
  for (let i = 0; i < 20; i += 1) {
    handler({ payload: { packet_index: i, meters: [{ key: 'ch:1', label: 'CH 1', value: i === 7 ? -3 : -40 - i }] } });
  }
  const beforePaint = { paints, owed: Boolean(owedMeterFrame), peak: meterPeakData.get('ch:1')?.peak ?? null };
  await new Promise((resolve) => setTimeout(resolve, 150));
  const after = { paints, owed: Boolean(owedMeterFrame), peak: meterPeakData.get('ch:1')?.peak ?? null };
  handleMeterFrame = original;
  return { beforePaint, after };
})()`);
assert.notEqual(coalesced.skipped, true, 'the window must register its meter listener for this contract');
assert.equal(coalesced.beforePaint.paints, 0, 'a burst of frames must not paint frame by frame');
assert.equal(coalesced.beforePaint.owed, true, 'the newest frame must be owed a paint');
assert.equal(coalesced.after.paints, 1, `twenty frames in one task must cost exactly one paint (got ${coalesced.after.paints})`);
assert.equal(coalesced.after.owed, false, 'and must leave nothing owed once it has been painted');
assert.equal(coalesced.after.peak, -3, 'the loudest value of the whole burst must reach the display, not only the last frame');
console.log('6. workstation: a burst of meter frames costs one paint and keeps its peak');

// The bridge shows the most meters of the two windows (forty-eight cost about 15 ms a frame), so it
// makes the same promise: a burst costs one paint, and the loudest value of the burst still lands.
await loadDocument(BRIDGE, '#meter-layout-select');
const bridgeCoalesced = await evaluate(`(async () => {
  const handler = (window.__listeners || {})['usb-meter-frame'];
  if (!handler) return { skipped: true };
  const original = onMeterFrame;
  let paints = 0;
  onMeterFrame = (frame) => { paints += 1; return original(frame); };
  for (let i = 0; i < 20; i += 1) {
    handler({ payload: { packet_index: i, meters: [{ key: 'usb:1', label: 'USB 1', value: i === 5 ? -2 : -40 - i }] } });
  }
  const beforePaint = { paints, owed: Boolean(owedMeterFrame) };
  await new Promise((resolve) => setTimeout(resolve, 150));
  const after = {
    paints,
    owed: Boolean(owedMeterFrame),
    // The loudest value of the burst reaches the display: the bridge's own value cache holds it.
    shown: latestValues['usb:1'] ?? null,
  };
  onMeterFrame = original;
  return { beforePaint, after };
})()`);
assert.notEqual(bridgeCoalesced.skipped, true, 'the bridge must register its meter listener for this contract');
assert.equal(bridgeCoalesced.beforePaint.paints, 0, 'a burst of frames must not paint frame by frame in the bridge either');
assert.equal(bridgeCoalesced.after.paints, 1, `twenty frames in one task must cost the bridge one paint (got ${bridgeCoalesced.after.paints})`);
assert.equal(bridgeCoalesced.after.owed, false, 'and must leave nothing owed');
assert.equal(bridgeCoalesced.after.shown, -2, 'the loudest value of the burst must be the one the bridge shows');
console.log('6. meter bridge: a burst of meter frames costs one paint and keeps its peak');

// A refused option stays visible, explained and unchoosable — and it is the source's own `disabled`
// that decides, not the app's particular lists.
for (const [url, label, fallback, marker] of [[DOCK, 'workstation', 'meter-display-style', '#target-parameter-menu'], [BRIDGE, 'meter bridge', 'meter-layout-select', '#meter-layout-select']]) {
  await loadDocument(url, marker);
  const refused = await evaluate(`(() => {
    const hostOf = (select) => document.querySelector('[data-dropdown-for="' + select.id + '"]');
    let select = null;
    for (const host of Array.from(document.querySelectorAll('[data-dropdown-for]'))) {
      const candidate = document.getElementById(host.dataset.dropdownFor);
      if (Array.from(candidate.options).some((option) => option.disabled)) { select = candidate; break; }
    }
    // No list in this window refuses an entry by itself, so one is disabled here: the drawn row has to
    // follow the source's own \`disabled\`, not the app's particular lists.
    let injected = false;
    if (!select) {
      select = document.getElementById(${JSON.stringify(fallback)}) || document.getElementById(document.querySelector('[data-dropdown-for]').dataset.dropdownFor);
      injected = true;
    }
    const option = Array.from(select.options).find((item) => item.disabled) || select.options[0];
    if (!option) return { skipped: true };
    if (injected) option.disabled = true;
    const hadTitle = option.title;
    if (!hadTitle) option.title = 'refused by this contract test';
    const host = hostOf(select);
    const button = host.querySelector('.dropdown-button');
    const panel = host.querySelector('.dropdown-panel');
    if (button.disabled) return { skipped: true, id: select.id };
    window.WingDropdown.closeAll();
    button.click();
    const row = Array.from(panel.querySelectorAll('.dropdown-row')).find((item) => item.getAttribute('data-menu-value') === option.value);
    const before = select.value;
    let changes = 0;
    const count = () => { changes += 1; };
    select.addEventListener('change', count);
    row.click();
    const state = {
      skipped: false,
      id: select.id,
      injected,
      unavailable: row.classList.contains('is-unavailable'),
      rowDisabled: row.disabled,
      title: row.title,
      expectedTitle: option.title,
      valueKept: select.value === before,
      changes,
      stillOpen: !panel.hidden,
    };
    select.removeEventListener('change', count);
    if (injected) option.disabled = false;
    if (!hadTitle) option.title = '';
    window.WingDropdown.closeAll();
    return state;
  })()`);
  assert.equal(refused.skipped, false, `${label}: a disabled option must be checkable (${JSON.stringify(refused)})`);
  assert.equal(refused.unavailable, true, `${label} · ${refused.id}: a disabled option must wear the picker's unavailable row`);
  assert.equal(refused.rowDisabled, true, `${label} · ${refused.id}: a disabled option must not be selectable`);
  assert.equal(refused.title, refused.expectedTitle, `${label} · ${refused.id}: the row must carry the option's own reason`);
  assert.equal(refused.valueKept, true, `${label} · ${refused.id}: clicking a refused row must not write the list`);
  assert.equal(refused.changes, 0, `${label} · ${refused.id}: a refused row must not fire change`);
  assert.equal(refused.stillOpen, true, `${label} · ${refused.id}: a refused row must leave the list open`);
  console.log(`6. ${label}: "${refused.id}"${refused.injected ? ' (one option refused for the check)' : ''} — the refused row is visible, explained and unchoosable`);
}

// --- 7. No console identity in what the operator reads -----------------------
//
// The app runs against many different WING consoles and the unit used for testing is one of them: its
// discovery name, its address and its firmware build are evidence for the engineering record (code
// comments and `docs/`), never text the operator reads. The window's fallback catalogue mirrors the
// backend's rows, so every row of every category is walked here and the guard names the offending key
// rather than counting them.
await loadDocument(DOCK, '#target-parameter-menu');
const catalogue = await evaluate(`(() => {
  const rows = [];
  const collect = (list, category) => {
    (list || []).forEach((row) => {
      if (!row || !row.key) return;
      rows.push({ category: String(category), key: row.key, valueHint: row.valueHint || '', title: row.title || '', label: row.label || '' });
    });
  };
  Object.entries(targetCatalogFallback.targetParametersByCategory || {}).forEach(([category, list]) => collect(list, category));
  Object.entries(targetCatalogFallback.triggerParametersByCategory || {}).forEach(([category, list]) => collect(list, category));
  return { rows, categories: new Set(rows.map((row) => row.category)).size };
})()`);
const CONSOLE_IDENTITY = /(WING-[A-Za-z0-9-]+|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b(?:fw|firmware)\b[^.;]{0,16}?\d+\.\d+)/i;
const named = [];
for (const row of catalogue.rows) {
  for (const field of ['valueHint', 'title', 'label']) {
    const match = CONSOLE_IDENTITY.exec(row[field]);
    if (match) named.push(`${row.category}/${row.key} · ${field} · "${match[0]}"`);
  }
}
assert.deepEqual(named, [],
  `no user-visible catalogue text may name the test console, these did: ${named.join(' | ')}`);
assert.ok(catalogue.rows.length > 50,
  `the identity walk must cover the whole catalogue (only ${catalogue.rows.length} rows were read)`);
console.log(`7. ${catalogue.rows.length} catalogue rows over ${catalogue.categories} categories name no console, no address and no firmware build`);

// --- 8. Dialog keys respect the focused control --------------------------
//
// Every dialog respects the focused button on Enter; Escape
// cancels. The meter picker answered Escape alone, so the keyboard had no way to accept a bank, and
// the About dialog opened with no focus at all, so neither key reached it (master plan 2026-09-22,
// bridge dialog parity with the workstation window).
// The dialogs under test belong to the bridge, and the check above left the workstation window loaded.
await loadDocument(BRIDGE, '#meter-layout-select');
const pressKey = async (key, keyCode) => {
  const common = { key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  const text = key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {};
  await call('Input.dispatchKeyEvent', { type: 'keyDown', ...common, ...text });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  await sleep(250);
};
const findMeterPicker = `Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
  .find((overlay) => overlay.querySelector('[data-meter-pick]'))`;

const openKeyboardPicker = () => evaluate(`(async () => {
  document.querySelector('[data-bank-new]').click();
  await new Promise((resolve) => setTimeout(resolve, 220));
  document.getElementById('meters-prompt-input').value = 'Entered bank';
  document.getElementById('meters-prompt-accept').click();
  await new Promise((resolve) => setTimeout(resolve, 260));
  const picker = ${findMeterPicker};
  if (!picker) return { error: 'the meter picker did not open' };
  // Enter on Cancel must cancel without creating the bank.
  picker.querySelector('[data-pick="cancel"]').focus();
  return { open: true, focused: document.activeElement?.dataset?.pick || '' };
})()`);
const pickerOpen = await openKeyboardPicker();
assert.ok(!pickerOpen.error, pickerOpen.error || '');
await pressKey('Enter', 13);
const cancelledByEnter = await evaluate(`({ open: Boolean(${findMeterPicker}), banks: JSON.parse(localStorage.getItem('wing_meter_banks') || '[]').map(b=>b.name) })`);
assert.equal(cancelledByEnter.open, false);
assert.ok(!cancelledByEnter.banks.includes('Entered bank'), 'Enter on Cancel must not save a bank');
assert.ok(!(await openKeyboardPicker()).error);
await evaluate(`(${findMeterPicker}).querySelector('[data-pick="accept"]').focus()`);
await pressKey('Enter', 13);
const acceptedByEnter = await evaluate(`(() => ({
  open: Boolean(${findMeterPicker}),
  banks: JSON.parse(localStorage.getItem('wing_meter_banks') || '[]').map((bank) => bank.name),
}))()`);
assert.equal(acceptedByEnter.open, false, 'Enter must close the meter picker');
assert.ok(acceptedByEnter.banks.includes('Entered bank'),
  `Enter must accept the bank the operator ticked (got ${JSON.stringify(acceptedByEnter.banks)})`);

await evaluate(`(async () => {
  document.querySelector('[data-bank-new]').click();
  await new Promise((resolve) => setTimeout(resolve, 220));
  document.getElementById('meters-prompt-input').value = 'Cancelled bank';
  document.getElementById('meters-prompt-accept').click();
  await new Promise((resolve) => setTimeout(resolve, 260));
})()`);
assert.ok(await evaluate(`Boolean(${findMeterPicker})`), 'the picker must open again');
await pressKey('Escape', 27);
const escaped = await evaluate(`(() => ({
  open: Boolean(${findMeterPicker}),
  banks: JSON.parse(localStorage.getItem('wing_meter_banks') || '[]').map((bank) => bank.name),
}))()`);
assert.equal(escaped.open, false, 'Escape must close the meter picker');
assert.ok(!escaped.banks.includes('Cancelled bank'), 'and it must not store a bank nobody accepted');

// The prompt keeps its keys when the focus has left the input (Tab reaches its buttons).
const promptKeys = await evaluate(`(() => {
  document.querySelector('[data-bank-new]').click();
  return { open: getComputedStyle(document.getElementById('meters-prompt')).display !== 'none' };
})()`);
assert.equal(promptKeys.open, true, 'the bridge prompt must open for a new bank');
await evaluate(`document.getElementById('meters-prompt-cancel').focus()`);
await pressKey('Escape', 27);
const promptClosed = await evaluate(`getComputedStyle(document.getElementById('meters-prompt')).display`);
assert.equal(promptClosed, 'none', 'Escape must cancel the bridge prompt from its buttons too');

const about = await evaluate(`(() => {
  document.getElementById('meters-brand-logo').click();
  return {
    open: getComputedStyle(document.getElementById('meters-about-backdrop')).display !== 'none',
    focused: document.activeElement?.id || '',
  };
})()`);
assert.equal(about.open, true, 'the About dialog must open');
assert.ok(['meters-about-ok', 'meters-about-close'].includes(about.focused),
  `its buttons must take the focus, or no key reaches it (got "${about.focused}")`);
await pressKey('Enter', 13);
assert.equal(await evaluate(`getComputedStyle(document.getElementById('meters-about-backdrop')).display`), 'none',
  'Enter must dismiss the About dialog');
console.log('8. Enter honours the focused button; Escape cancels the bridge dialogs');

// Leave the shared origin clean for the next browser test.
await evaluate(`(() => {
  localStorage.removeItem('wing_custom_meters');
  localStorage.removeItem('wing_meter_banks');
  localStorage.removeItem('wing_dock_bank');
  localStorage.removeItem('wing_meters_bank');
  localStorage.removeItem('wing_macro_summary');
  localStorage.removeItem('wing_meters_style');
})()`);
console.log('desktop meter bank selector contracts passed');
socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
