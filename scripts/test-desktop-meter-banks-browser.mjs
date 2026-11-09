// Custom meter banks in the Meter Bridge: create from the watchlist, select, rename, update from the
// watchlist and delete. The bridge shares them with the workstation window through localStorage
// (`wing_meter_banks`), so the shape of that value is part of the contract.
//
// Needs Chrome on the debug port (the gate starts one); without it the test says so and passes.
import WebSocket from "ws";

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
const PAGE = new URL("../desktop/ui/meters.html", import.meta.url).href;

async function chromeTarget() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
    return await response.json();
  } catch (_) {
    return null;
  }
}

const target = await chromeTarget();
if (!target) {
  console.log("Chrome is not listening on the debug port: custom bank test skipped.");
  process.exit(3);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});
let nextId = 0;
const pending = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(raw);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`page threw: ${description}`);
  }
  return result.result.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/// Waits for a page-side condition instead of trusting a fixed sleep.
///
/// This suite reloaded the dock and asserted 2200 ms later that the bank selector was there: on a busy
/// machine (the gate runs the browser and the Rust suite at once) the page had not finished, the element
/// was not there yet, and the suite failed on a window that was in fact fine (2026-10-02).
async function waitFor(expression, timeout = 8000, step = 100) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      if (await wsEval(expression)) return true;
    } catch (_) {}
    if (Date.now() > deadline) return false;
    await sleep(step);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await call("Page.enable");
  // The bridge talks to Rust for the window and the meter stream: stub the IPC the page needs.
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__TAURI__ = {
      core: { invoke: async () => ({}) },
      event: { listen: async () => () => {} },
      window: { getCurrentWindow: () => ({
        setAlwaysOnTop: async () => {}, setFocus: async () => {}, setPosition: async () => {},
        setSize: async () => {}, onCloseRequested: async () => () => {}, close: async () => {},
      }) },
    };`,
  });
  await call("Page.navigate", { url: PAGE });
  await sleep(2000);

  // Seed a watchlist and start with no banks at all.
  await evaluate(`localStorage.setItem('wing_custom_meters', JSON.stringify([
    { key: 'ch:1', label: 'CH 1' }, { key: 'ch:2', label: 'CH 2' }, { key: 'usb:3', label: 'USB 3' },
  ])); localStorage.removeItem('wing_meter_banks');`);
  await call("Page.reload");
  await sleep(1800);

  // The banks live in their own section, separated from the standard groups.
  assert(await evaluate(`Boolean(document.querySelector('.bridge-sidebar-sep'))`),
    "the sidebar must separate the custom banks from the standard groups");
  assert(await evaluate(`document.body.textContent.includes('Custom banks')`),
    "the sidebar must title the custom banks section");
  assert(await evaluate(`document.querySelector('#custom-bank-tabs [data-bank-new]')?.textContent.includes('New')`),
    "the section must offer creating a bank from the watchlist");
  assert(await evaluate(`JSON.parse(localStorage.getItem('wing_meter_banks') || '[]').length === 0`),
    "a fresh install must not invent banks");

  // Create one from the watchlist through the app's own prompt (window.prompt returns null in the app).
  await evaluate(`document.querySelector('#custom-bank-tabs [data-bank-new]').click()`);
  await sleep(250);
  assert(await evaluate(`getComputedStyle(document.getElementById('meters-prompt')).display !== 'none'`),
    "creating a bank must ask for its name in the app's own prompt");
  await evaluate(`document.getElementById('meters-prompt-input').value = 'Voces';
    document.getElementById('meters-prompt-accept').click()`);
  await sleep(250);

  // A bank is a subset: the bridge asks which meters it keeps (all ticked to begin with).
  const picker = await evaluate(`(() => {
    const overlay = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
      .find((entry) => entry.querySelector('[data-meter-pick]'));
    if (!overlay) return null;
    const boxes = Array.from(overlay.querySelectorAll('[data-meter-pick]'));
    return { count: boxes.length, allChecked: boxes.every((box) => box.checked) };
  })()`);
  assert(picker, "creating a bank must ask which meters it keeps");
  assert(picker.count === 3 && picker.allChecked,
    "the picker must list the watchlist with every meter ticked (the bank keeps them unless unticked)");
  await evaluate(`(() => {
    const overlay = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
      .find((entry) => entry.querySelector('[data-meter-pick]'));
    overlay.querySelector('[data-pick="accept"]').click();
  })()`);
  await sleep(250);

  const created = JSON.parse(await evaluate(`localStorage.getItem('wing_meter_banks')`));
  assert(created.length === 1 && created[0].name === "Voces", "the bank must be saved with its name");
  assert(created[0].keys.join(",") === "ch:1,ch:2,usb:3", "the bank must keep the watchlist meters");
  assert(await evaluate(`document.querySelector('#custom-bank-tabs [data-bank-id]')?.textContent.includes('Voces (3)')`),
    "the tab must show the bank name and how many meters it holds");
  assert(await evaluate(`activeGroupFilter.startsWith('bank:')`), "creating a bank must select it");
  assert(await evaluate(`getChannelsForGroup(activeGroupFilter).map((item) => item.key).join(',') === 'ch:1,ch:2,usb:3'`),
    "the selected bank must decide which meters are shown");

  // Rename, update from the watchlist and delete, all from the bank's context menu.
  await evaluate(`document.querySelector('#custom-bank-tabs [data-bank-id]')
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 }))`);
  await sleep(200);
  const menuLabels = await evaluate(`Array.from(document.querySelectorAll('#win95-context-menu .cmd-label'))
    .map((entry) => entry.textContent)`);
  for (const wanted of ["Rename bank", "Update from watchlist", "Delete bank"]) {
    assert(menuLabels.some((label) => label.includes(wanted)), `the bank menu must offer "${wanted}"`);
  }

  await evaluate(`Array.from(document.querySelectorAll('#win95-context-menu .context-menu-item'))
    .find((row) => row.textContent.includes('Rename')).click()`);
  await sleep(200);
  await evaluate(`document.getElementById('meters-prompt-input').value = 'Voces principales';
    document.getElementById('meters-prompt-accept').click()`);
  await sleep(200);
  assert(await evaluate(`JSON.parse(localStorage.getItem('wing_meter_banks'))[0].name === 'Voces principales'`),
    "renaming a bank must persist");

  await evaluate(`localStorage.setItem('wing_custom_meters', JSON.stringify([{ key: 'usb:1', label: 'USB 1' }]));
    loadWatchlist()`);
  await evaluate(`document.querySelector('#custom-bank-tabs [data-bank-id]')
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 }))`);
  await sleep(200);
  await evaluate(`Array.from(document.querySelectorAll('#win95-context-menu .context-menu-item'))
    .find((row) => row.textContent.includes('Update from watchlist')).click()`);
  await sleep(250);
  const updatePicker = await evaluate(`(() => {
    const overlay = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
      .find((entry) => entry.querySelector('[data-meter-pick]'));
    if (!overlay) return null;
    // The watchlist changed and no meter of the bank is still in it: nothing is ticked.
    const boxes = Array.from(overlay.querySelectorAll('[data-meter-pick]'));
    const checked = boxes.filter((box) => box.checked).length;
    boxes.forEach((box) => { box.checked = true; });
    overlay.querySelector('[data-pick="accept"]').click();
    return { count: boxes.length, checked };
  })()`);
  assert(updatePicker && updatePicker.count === 1 && updatePicker.checked === 0,
    `updating must ask again, with the surviving meters ticked (got ${JSON.stringify(updatePicker)})`);
  await sleep(250);
  assert(await evaluate(`JSON.parse(localStorage.getItem('wing_meter_banks'))[0].keys.join(',') === 'usb:1'`),
    "updating a bank must take the current watchlist");

  await evaluate(`document.querySelector('#custom-bank-tabs [data-bank-id]')
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 }))`);
  await sleep(200);
  await evaluate(`Array.from(document.querySelectorAll('#win95-context-menu .context-menu-item'))
    .find((row) => row.textContent.includes('Delete bank')).click()`);
  await sleep(250);
  assert(await evaluate(`getComputedStyle(document.getElementById('meters-confirm')).display !== 'none'`),
    "deleting a bank must ask first");
  await evaluate(`document.getElementById('meters-confirm-accept').click()`);
  await sleep(250);
  assert(await evaluate(`JSON.parse(localStorage.getItem('wing_meter_banks')).length === 0`),
    "accepting the confirmation must delete the bank");
  assert(await evaluate(`!activeGroupFilter.startsWith('bank:')`),
    "deleting the selected bank must fall back to a standard group");

  await evaluate(`localStorage.removeItem('wing_meter_banks'); localStorage.removeItem('wing_custom_meters');`);
  console.log("meter bridge bank contracts passed");
} finally {
  socket.close();
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`).catch(() => {});
}

// ---------------------------------------------------------------------------------------------
// The workstation window manages the same banks from its meters panel: the selector filters the
// meters it shows and the buttons save, rename, refresh and delete. It attaches to the page the
// gate opened for the other browser tests.
// ---------------------------------------------------------------------------------------------
const workstation = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json())
  .find((item) => item.url.endsWith("/desktop/ui/index.html"));
assert(workstation, "open desktop/ui/index.html in Chrome remote debugging first");

const ws = new WebSocket(workstation.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});
let wsId = 0;
const wsPending = new Map();
ws.on("message", (raw) => {
  const message = JSON.parse(raw);
  const entry = wsPending.get(message.id);
  if (!entry) return;
  wsPending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
const wsCall = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++wsId;
    wsPending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const wsEval = async (expression) => {
  const result = await wsCall("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};

let previousWatchlist = null;
let previousBanks = null;
let previousDockBank = null;
try {
  await wsCall("Page.enable");
  await wsCall("Page.reload", { ignoreCache: true });
  await sleep(2400);
  previousWatchlist = await wsEval(`localStorage.getItem('wing_custom_meters')`);
  previousBanks = await wsEval(`localStorage.getItem('wing_meter_banks')`);
  previousDockBank = await wsEval(`localStorage.getItem('wing_dock_bank')`);

  await wsEval(`localStorage.setItem('wing_custom_meters', JSON.stringify([
    { key: 'ch:1', label: 'CH 1' },
  ])); localStorage.setItem('wing_meter_banks', JSON.stringify([
    { id: 'b1', name: 'Voces', keys: ['ch:2', 'ch:3'] },
  ])); localStorage.removeItem('wing_dock_bank');`);
  await wsCall("Page.reload");
  await sleep(2200);

  // The workstation window PICKS banks (the same groups as the bridge) to see only that group.
  // What it does NOT do is manage them: creating, renaming, updating and deleting live in the bridge.
  assert(await waitFor(`Boolean(document.getElementById('meter-bank-select'))`),
    "the workstation must offer the shared bank selector");
  for (const id of ['btn-meter-bank-save', 'btn-meter-bank-rename', 'btn-meter-bank-update', 'btn-meter-bank-delete']) {
    assert(!(await wsEval(`Boolean(document.getElementById('${id}'))`)),
      `#${id} must stay in the Meter Bridge: the workstation only picks a bank`);
  }
  assert(await wsEval(`document.getElementById('meter-bank-select').options.length === 2`),
    "the selector must list the stored bank plus 'All meters'");

  const picked = await wsEval(`(() => {
    const select = document.getElementById('meter-bank-select');
    select.value = 'b1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      value: document.getElementById('meter-bank-select').value,
      stored: localStorage.getItem('wing_dock_bank'),
      visible: visibleMeters().map((item) => item.key),
      // A group may hold meters that are not in the watchlist: they are shown anyway and subscribed,
      // or the group would come out empty because the stream only brings what is subscribed.
      subscription: subscriptionMeters().map((item) => item.key),
      tags: Array.from(document.querySelectorAll('#active-meters-tags .meter-tag')).map((tag) => tag.dataset.meterKey),
      hint: document.getElementById('meter-bank-hint').textContent,
    };
  })()`);
  const same = (list, expected) => list.length === expected.length && list.every((item, i) => item === expected[i]);
  assert(picked.value === 'b1', "the chosen bank must stay chosen");
  assert(picked.stored === 'b1', "the workstation must remember its own bank selection");
  assert(same(picked.visible, ['ch:2', 'ch:3']), `the bank must decide which meters are shown: ${picked.visible}`);
  assert(same(picked.subscription, ['ch:1', 'ch:2', 'ch:3']),
    `the subscription must add the bank's meters that are not in the watchlist: ${picked.subscription}`);
  assert(same(picked.tags, ['ch:2', 'ch:3']), `the tag strip must follow the bank too: ${picked.tags}`);
  assert(/not in this watchlist/.test(picked.hint),
    `the hint must explain that the group is broader than the watchlist: ${picked.hint}`);

  // Going back to "All meters" restores the watchlist and releases what the bank had added.
  const back = await wsEval(`(() => {
    const select = document.getElementById('meter-bank-select');
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      stored: localStorage.getItem('wing_dock_bank'),
      visible: visibleMeters().map((item) => item.key),
      subscription: subscriptionMeters().map((item) => item.key),
    };
  })()`);
  assert(same(back.visible, ['ch:1']), `All meters must show the watchlist again: ${back.visible}`);
  assert(same(back.subscription, ['ch:1']), `the extra meters of the bank must be released: ${back.subscription}`);
  assert(back.stored === '', "the choice must be remembered as 'all meters'");

  console.log("workstation meter bank contracts passed");
} finally {
  await wsEval(previousWatchlist === null
    ? `localStorage.removeItem('wing_custom_meters')`
    : `localStorage.setItem('wing_custom_meters', ${JSON.stringify(previousWatchlist)})`).catch(() => {});
  await wsEval(previousBanks === null
    ? `localStorage.removeItem('wing_meter_banks')`
    : `localStorage.setItem('wing_meter_banks', ${JSON.stringify(previousBanks)})`).catch(() => {});
  await wsEval(previousDockBank === null
    ? `localStorage.removeItem('wing_dock_bank')`
    : `localStorage.setItem('wing_dock_bank', ${JSON.stringify(previousDockBank)})`).catch(() => {});
  await wsEval(`document.querySelectorAll('.win95-dialog-backdrop').forEach((el) => { el.style.display = 'none'; })`).catch(() => {});
  await wsCall("Page.reload").catch(() => {});
  ws.close();
}


// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
