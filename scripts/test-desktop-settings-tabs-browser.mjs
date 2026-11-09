// The Settings window is the one surface the audits said was never driven end to end: every tab has
// to open, render something real and close again without a JavaScript error. This walks all of them
// in the real window and fails on the first tab that does not paint or that throws.
//
// Needs Chrome on the debug port (the gate starts one); without it the test says so and passes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
const INDEX_URL = new URL('../desktop/ui/index.html', import.meta.url).href;

// Tab of its own: the browser tests share the port and the profile, and attaching to "the first
// index.html tab" let an old tab (from a test that died before closing its own) decide the state
// this test saw.
const page = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${INDEX_URL}`, { method: 'PUT' })).json();
assert.ok(page?.webSocketDebuggerUrl, 'could not open a Chrome tab for this test');
process.on('exit', () => {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', `http://127.0.0.1:${DEBUG_PORT}/json/close/${page.id}`]);
  } catch (_) {}
});

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});
let nextId = 0;
const pending = new Map();
const pageErrors = [];

socket.on('message', (raw) => {
  const message = JSON.parse(raw);
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params?.exceptionDetails || {};
    pageErrors.push(details.exception?.description || details.text || 'unknown exception');
  }
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
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    // `text` is only "Uncaught" for a TypeError inside the page; the description carries the message and
    // the page-side stack. A test that fails with "Uncaught" and nothing else tells nobody anything.
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`page threw: ${description}`);
  }
  return result.result.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSettingsCondition(expression, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return; }
    catch (error) { if (!/context.*destroyed|Cannot find context|Inspected target navigated/i.test(String(error))) throw error; }
    await sleep(50);
  }
  throw new Error(`Settings readiness timed out: ${label}`);
}
async function reloadReadySettingsPage() {
  const previous = await evaluate('window.__SETTINGS_TEST_DOCUMENT || null');
  await call('Page.reload', { ignoreCache: true });
  await waitForSettingsCondition(`Boolean(window.__SETTINGS_TEST_DOCUMENT)
    && window.__SETTINGS_TEST_DOCUMENT !== ${JSON.stringify(previous)}
    && typeof window.openSettingsModal === 'function'`, 'new document with registered Settings handlers');
}

try {
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__SETTINGS_TEST_DOCUMENT = String(Date.now()) + ':' + Math.random();` });
  // The visible tab, not a background one: Chrome throttles the timers of a hidden tab (350 ms becomes
  // seconds, and after five minutes it drops to one timer a minute), and this walk is built on the
  // page settling between clicks — a backgrounded tab made it crawl instead of failing.
  await call('Page.bringToFront');
  // The macro summary preference is remembered in localStorage, and the browser tests share one
  // Chrome profile: a run that died after choosing the cards left the key behind and the next run
  // failed the "lines is the default" assertion below. Clear it and load once more, so this test
  // always starts from the real default no matter what ran before it.
  await reloadReadySettingsPage();
  await sleep(2400);
  await evaluate(`localStorage.removeItem('wing_macro_summary')`);
  await reloadReadySettingsPage();
  await sleep(2400);

  // The gear opens the window; it must start closed.
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('settings-modal-backdrop')).display === 'none'`), true,
    'the settings window must start closed');
  await evaluate(`document.getElementById('open-settings-btn').click()`);
  await sleep(400);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('settings-modal-backdrop')).display !== 'none'`), true,
    'the gear must open the settings window');

  const tabs = await evaluate(`Array.from(document.querySelectorAll('.settings-nav-item[data-tab]')).map((item) => item.dataset.tab)`);
  // The important tabs are pinned by name (a new one may be added freely, but losing one of these is
  // a regression). Previously this only asserted `>= 8`, so three tabs could vanish silently.
  const requiredTabs = ['general', 'matrix', 'meters', 'network', 'osc', 'interapp', 'timecode', 'profiles', 'contextmenu', 'shortcuts', 'hud', 'help', 'about'];
  for (const required of requiredTabs) {
    assert.ok(tabs.includes(required), `the settings window must keep its "${required}" tab (found ${tabs.join(', ')})`);
  }
  assert.equal(tabs.length, requiredTabs.length,
    `the settings window must list exactly its ${requiredTabs.length} tabs (found ${tabs.length}: ${tabs.join(', ')})`);
  assert.equal(tabs.length, new Set(tabs).size, 'no tab may be listed twice');

  for (const tab of tabs) {
    await evaluate(`document.querySelector('.settings-nav-item[data-tab="${tab}"]').click()`);
    await sleep(160);
    const state = await evaluate(`(() => {
      const page = document.getElementById('tabpage-${tab}');
      const active = Array.from(document.querySelectorAll('.win95-tabpage'))
        .filter((node) => node.classList.contains('is-active'))
        .map((node) => node.id);
      const painted = page ? page.getClientRects().length > 0 : false;
      const text = page ? (page.textContent || '').trim().length : 0;
      const controls = page ? page.querySelectorAll('button, input, select, textarea').length : 0;
      return { exists: Boolean(page), painted, text, controls, active };
    })()`);
    assert.equal(state.exists, true, `the "${tab}" tab must exist`);
    assert.equal(state.painted, true, `the "${tab}" tab must be visible after clicking it`);
    assert.deepEqual(state.active, [`tabpage-${tab}`], `only the "${tab}" tab may be active (got ${state.active.join(', ')})`);
    assert.ok(state.text > 40, `the "${tab}" tab must show real content (found ${state.text} characters)`);
  }

  // Every settings control must answer with a ScreenTip, which is the contract the inspector test
  // checks for the main panels; here it is limited to the tab that is open.
  await evaluate(`document.querySelector('.settings-nav-item[data-tab="general"]').click()`);
  await sleep(200);
  const untitled = await evaluate(`Array.from(document.querySelectorAll('#tabpage-general button, #tabpage-general input, #tabpage-general select'))
    .filter((el) => el.offsetParent !== null && !el.title && !el.closest('label')?.textContent?.trim())
    .map((el) => el.id || el.tagName + '.' + el.className)`);
  assert.deepEqual(untitled, [], 'every visible settings control must be identifiable (title or label)');

  // The macro summary has two drawings of the same recipe, chosen here and remembered.
  const readSummary = () => evaluate(`(() => {
    const select = document.getElementById('settings-macro-summary');
    const recipe = document.getElementById('macro-recipe');
    const text = (selector) => recipe?.querySelector(selector)?.textContent?.trim() || '';
    const shown = (selector) => {
      const node = recipe?.querySelector(selector);
      return node ? getComputedStyle(node).display !== 'none' : false;
    };
    return {
      options: Array.from(select?.options || []).map((option) => option.value),
      value: select?.value || '',
      blocks: document.body.classList.contains('macro-summary-blocks'),
      linesShown: shown('.recipe-content > strong'),
      detailShown: shown('.recipe-detail'),
      cards: recipe?.querySelectorAll('.recipe-row').length ?? 0,
      trigger: text('#recipe-trigger-detail'),
      gates: text('#recipe-condition-detail'),
      steps: text('#recipe-action-detail'),
      triggerLine: text('#recipe-trigger'),
      stored: localStorage.getItem('wing_macro_summary'),
    };
  })()`);
  const setSummary = (value) => evaluate(`(() => {
    const select = document.getElementById('settings-macro-summary');
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  const summaryLines = await readSummary();
  assert.deepEqual(summaryLines.options, ['lines', 'blocks'], 'the macro summary must offer the classic lines and the cards');
  assert.equal(summaryLines.value, 'lines', `the classic lines must be the default (got "${summaryLines.value}")`);
  assert.equal(summaryLines.blocks, false, 'the window must start without the cards class');
  assert.equal(summaryLines.linesShown, true, 'in lines mode the three sentences must be the visible ones');
  assert.equal(summaryLines.detailShown, false, 'and the card detail must stay hidden');
  assert.equal(summaryLines.cards, 3, 'the summary always keeps its three parts');

  await setSummary('blocks');
  await sleep(250);
  const summaryCards = await readSummary();
  assert.equal(summaryCards.blocks, true, 'choosing cards must put the window in cards mode');
  assert.equal(summaryCards.linesShown, false, 'the cards must replace the run-on sentences');
  assert.equal(summaryCards.detailShown, true, 'and show the structured detail');
  assert.equal(summaryCards.cards, 3, 'with one card per part');
  assert.equal(summaryCards.stored, 'blocks', 'and the choice must be written down');
  // The card content is the same macro the sentence describes: the gates card says there are none,
  // and the steps card lists what the THEN sentence lists.
  assert.match(summaryCards.gates, /No extra gates/, `the gates card must say there are no gates (got "${summaryCards.gates}")`);
  assert.ok(
    /\d+ steps?/.test(summaryCards.steps) || summaryCards.steps.length > 0,
    `the steps card must list the steps (got "${summaryCards.steps}")`,
  );
  assert.ok(summaryCards.trigger.length > 10, `the trigger card must say what is watched (got "${summaryCards.trigger}")`);

  // The choice survives a reload: it is a preference, not a view state of this session.
  await reloadReadySettingsPage();
  await sleep(2400);
  const summaryAfterReload = await readSummary();
  assert.equal(summaryAfterReload.blocks, true, 'the cards must come back after a reload');
  assert.equal(summaryAfterReload.value, 'blocks', 'and the setting must show the stored choice');

  // Back to the classic look, so what follows (and the next test) sees the default.
  await evaluate(`document.getElementById('open-settings-btn').click()`);
  await sleep(300);
  await evaluate(`document.querySelector('.settings-nav-item[data-tab="general"]').click()`);
  await sleep(150);
  await setSummary('lines');
  await sleep(200);
  const summaryBack = await readSummary();
  assert.equal(summaryBack.blocks, false, 'switching back to lines must undo the cards');
  assert.equal(summaryBack.linesShown, true, 'and bring the sentences back');
  assert.equal(summaryBack.stored, 'lines', 'and remember that too');

  // --- Window chrome: a dialog must never be lost off screen ---------------------------------
  // Operator report after 0.2.52: "hay un bug de que pueden quedar fuera de límites y ya no se pueden
  // mover porque no se puede acceder a la parte draggeable. Preferences y matrix selectors". The
  // titlebar is the only handle both dialogs have, so two things are driven here: the drag clamp (a
  // grabbable strip of the titlebar stays inside the window on both axes, on whichever side the
  // pointer was pushed to) and the Re-centre windows button that brings a dialog back and forgets the
  // geometry of the separate windows.
  //
  // The pointer events are the ones the handlers listen for, dispatched at the titlebar itself: this
  // is a drag, not a click, so the CDP mouse path is not what is being checked.
  const dragDialog = (selector, dx, dy) => evaluate(`(() => {
    const bar = document.querySelector(${JSON.stringify(selector)});
    const rect = bar.getBoundingClientRect();
    const x = rect.left + Math.min(40, Math.max(4, rect.width / 2));
    const y = rect.top + Math.max(2, rect.height / 2);
    const common = { bubbles: true, pointerId: 21, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1 };
    bar.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientX: x, clientY: y }));
    bar.dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: x + ${dx}, clientY: y + ${dy} }));
    bar.dispatchEvent(new PointerEvent('pointerup', { ...common, clientX: x + ${dx}, clientY: y + ${dy}, buttons: 0 }));
    return true;
  })()`);

  // What is left of the titlebar inside the viewport, and whether a press there would really land on
  // it: the master header is painted above dialogs on purpose, so geometry alone is not the promise.
  const titlebarReach = (selector) => evaluate(`(() => {
    const bar = document.querySelector(${JSON.stringify(selector)});
    const rect = bar.getBoundingClientRect();
    const x0 = Math.max(rect.left, 0), x1 = Math.min(rect.right, window.innerWidth);
    const y0 = Math.max(rect.top, 0), y1 = Math.min(rect.bottom, window.innerHeight);
    const hit = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
    return { stripX: x1 - x0, stripY: y1 - y0, height: rect.height,
      grab: Boolean(hit && hit.closest(${JSON.stringify(selector)})) };
  })()`);

  const assertReachable = (label, reach) => {
    // The dialog's 2px bevel sits between its edge and the titlebar, so the strip measures a little
    // under the 120px rule; anything smaller than that means the clamp is not holding.
    assert.ok(reach.stripX >= 120 - 4,
      `${label}: at least ~120 px of the titlebar must stay on screen (${reach.stripX.toFixed(1)})`);
    assert.ok(reach.stripY >= Math.min(32, reach.height) - 1,
      `${label}: the titlebar must stay in view (${reach.stripY.toFixed(1)} of ${reach.height.toFixed(1)})`);
    assert.equal(reach.grab, true, `${label}: a press on the visible strip must land on the titlebar`);
  };

  await reloadReadySettingsPage();
  await sleep(2400);
  await evaluate(`localStorage.removeItem('wing_settings_pos'); localStorage.removeItem('wing_matrix_pos');`);
  await evaluate(`document.getElementById('open-settings-btn').click()`);
  await sleep(400);
  for (const [where, dx, dy] of [['the top-left', -9000, -9000], ['the bottom-right', 9000, 9000]]) {
    await dragDialog('#settings-dialog-titlebar', dx, dy);
    assertReachable(`the Preferences window dragged far past ${where}`, await titlebarReach('#settings-dialog-titlebar'));
  }

  // The Channel Matrix Selector obeys the same rule, and it is the one that also remembers a position.
  await evaluate(`document.getElementById('btn-close-settings').click()`);
  await sleep(200);
  await evaluate(`localStorage.setItem('wing_matrix_pos', JSON.stringify({ left: '6000px', top: '4000px' }))`);
  await evaluate(`document.querySelector('.btn-open-matrix[data-target-input="trigger-ids"]').click()`);
  await sleep(500);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('channel-matrix-backdrop')).display !== 'none'`), true,
    'the matrix selector must open for the drag check');
  assertReachable('the matrix selector reopened at a remembered off-screen position',
    await titlebarReach('#channel-matrix-modal .win95-dialog-titlebar'));
  for (const [where, dx, dy] of [['the top-left', -9000, -9000], ['the bottom-right', 9000, 9000]]) {
    await dragDialog('#channel-matrix-modal .win95-dialog-titlebar', dx, dy);
    assertReachable(`the matrix selector dragged far past ${where}`,
      await titlebarReach('#channel-matrix-modal .win95-dialog-titlebar'));
  }
  await evaluate(`closeChannelMatrix()`);
  await sleep(200);

  // Re-centre windows: back to the middle, remembered geometry forgotten, and it says so.
  await evaluate(`document.getElementById('open-settings-btn').click()`);
  await sleep(300);
  await evaluate(`document.querySelector('.settings-nav-item[data-tab="general"]').click()`);
  await sleep(150);
  const recentreButton = await evaluate(`(() => {
    const button = document.getElementById('btn-recenter-windows');
    if (!button) return null;
    return { label: button.textContent.trim(), title: button.title, visible: button.offsetParent !== null };
  })()`);
  assert.ok(recentreButton, 'the General tab must offer a Re-centre windows button');
  assert.ok(recentreButton.visible, 'the button must be visible in the General tab');
  assert.ok(recentreButton.title.length > 20, `the button must carry a ScreenTip title (got "${recentreButton.title}")`);
  assert.match(recentreButton.label, /re-?centre windows/i, `the button must be labelled (got "${recentreButton.label}")`);

  // A dialog out of place, plus the geometry of both separate windows left far off screen. The matrix
  // selector is closed and has no remembered position, so the state this check asserts is exactly:
  // the Properties dialog has a position to drop, and both separate windows have geometry to forget.
  await dragDialog('#settings-dialog-titlebar', 9000, 9000);
  await evaluate(`(() => {
    localStorage.removeItem('wing_matrix_pos');
    localStorage.setItem('wing_meters_geom', JSON.stringify({ x: 9000, y: 9000, width: 900, height: 600 }));
    localStorage.setItem('wing_guide_geom', JSON.stringify({ x: 9000, y: 9000, width: 900, height: 600 }));
    localStorage.setItem('wing_work_geom', JSON.stringify({ x: 9000, y: 9000, width: 1200, height: 800 }));
  })()`);
  await evaluate(`document.getElementById('btn-recenter-windows').click()`);
  await sleep(400);
  const recentred = await evaluate(`(() => {
    const rect = document.getElementById('settings-modal').getBoundingClientRect();
    return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      centreX: rect.left + rect.width / 2, centreY: rect.top + rect.height / 2,
      viewWidth: window.innerWidth, viewHeight: window.innerHeight,
      status: document.getElementById('recenter-windows-status').textContent.trim(),
      metersGeom: localStorage.getItem('wing_meters_geom'),
      guideGeom: localStorage.getItem('wing_guide_geom'),
      workGeom: localStorage.getItem('wing_work_geom'),
      settingsPos: localStorage.getItem('wing_settings_pos'),
      open: getComputedStyle(document.getElementById('settings-modal-backdrop')).display,
    };
  })()`);
  assert.ok(recentred.left >= 0 && recentred.top >= 0
    && recentred.right <= recentred.viewWidth && recentred.bottom <= recentred.viewHeight,
    `the Preferences window must come back inside the viewport (${JSON.stringify(recentred)})`);
  assert.ok(Math.abs(recentred.centreX - recentred.viewWidth / 2) <= 2,
    `it must come back centred, not just visible (centre ${recentred.centreX} of ${recentred.viewWidth})`);
  assert.equal(recentred.metersGeom, null, 'wing_meters_geom must be gone from localStorage');
  assert.equal(recentred.guideGeom, null, 'wing_guide_geom must be gone from localStorage');
  assert.equal(recentred.workGeom, null,
    'the workstation window\'s own saved box must be forgotten too, or the next launch puts it back off-screen');
  assert.equal(recentred.settingsPos, null, 'the position the Preferences drag remembered must be gone too');
  // The status line says what really happened, and only that. Nothing was moved here: the reset put
  // the dialog back on its own CSS centring, and this window has no desktop frame to move the other
  // two. Counting the mere existence of the elements reported "Re-centred 2 windows" whatever
  // happened, and made the "nothing needed it" branch unreachable. The count is pinned, not the words.
  //
  // Four, not three, since 2026-09-27: the Channel Matrix now remembers its own position under the
  // dock's own key (`wing_dock_matrix_pos`; the shared `wing_matrix_pos` moved the bridge's matrix
  // whenever the dock's was dragged), so it is a fourth window whose remembered position is forgotten.
  //
  // Five since the workstation window remembers its own box (`wing_work_geom`): it is not moved — the
  // button is inside it — but the place it stored is dropped, which is what the line reports.
  assert.match(recentred.status,
    /^Nothing was moved; the remembered position of 5 windows was forgotten: Properties, Channel Matrix, Workstation window, Meter Bridge, Guide\./,
    `the status line must report what really happened (got "${recentred.status}")`);
  assert.doesNotMatch(recentred.status, /Re-centred/,
    `nothing was moved, so nothing may claim to have been re-centred (got "${recentred.status}")`);
  assert.doesNotMatch(recentred.status, /Meter Bridge \(moved/,
    'a window with no desktop frame must never be reported as moved');
  assert.match(recentred.status, /forgotten rather than moved/,
    `the note must say in its own words what happened to the separate windows (got "${recentred.status}")`);
  assert.notEqual(recentred.open, 'none', 're-centring must not close the window it was pressed in');

  // Pressing it again with nothing out of place has to say so: this is the branch the old code could
  // never reach, because `recentreDialog` returned true merely because the element existed.
  await evaluate(`document.getElementById('btn-recenter-windows').click()`);
  await sleep(300);
  const recentredAgain = await evaluate(`document.getElementById('recenter-windows-status').textContent.trim()`);
  assert.match(recentredAgain, /^No window needed re-centring\./,
    `a second press with nothing out of place must say so (got "${recentredAgain}")`);
  assert.doesNotMatch(recentredAgain, /\d+ window/,
    `nothing was stored or out of place, so no count may appear (got "${recentredAgain}")`);

  // A saved box is used only when it still lands on a screen the session has: that check is what keeps
  // a window left on a second display — unplugged since — from coming back off-screen, and it is
  // exercised here with the monitors stubbed, because this tab has no desktop frame of its own.
  const placeOnScreen = await evaluate(`(async () => {
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.window = Object.assign({}, window.__TAURI__.window, {
      availableMonitors: async () => [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }],
    });
    return {
      onScreen: await workWindowPlaceIsVisible({ x: 100, y: 80, width: 1200, height: 800 }),
      besideIt: await workWindowPlaceIsVisible({ x: 2600, y: 80, width: 1200, height: 800 }),
      aboveEveryScreen: await workWindowPlaceIsVisible({ x: 100, y: -4000, width: 1200, height: 800 }),
    };
  })()`);
  assert.equal(placeOnScreen.onScreen, true,
    'a box on a screen the operator still has must be restored as it is');
  assert.equal(placeOnScreen.besideIt, false,
    'a box on a screen that is gone must be dropped instead of restored off-screen');
  assert.equal(placeOnScreen.aboveEveryScreen, false,
    'a titlebar above every screen cannot be grabbed and must be dropped too');

  // And when a dialog really has to be moved, the line counts it. The Preferences dialog shrinks to
  // fit any viewport, so the case is the one the clamp exists for: the channel matrix selector is
  // taller than a short screen, the CSS centring cannot fit it, and `keepDialogOnScreen` places it.
  await call('Emulation.setDeviceMetricsOverride', { width: 700, height: 240, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  await evaluate(`localStorage.setItem('wing_matrix_pos', JSON.stringify({ left: '6000px', top: '4000px' }))`);
  await evaluate(`document.querySelector('.btn-open-matrix[data-target-input="trigger-ids"]').click()`);
  await sleep(450);
  await evaluate(`document.getElementById('btn-recenter-windows').click()`);
  await sleep(400);
  const moved = await evaluate(`(() => ({
    status: document.getElementById('recenter-windows-status').textContent.trim(),
    matrixPosition: document.getElementById('channel-matrix-modal').style.position,
    matrixStored: localStorage.getItem('wing_matrix_pos'),
    view: [window.innerWidth, window.innerHeight],
  }))()`);
  await evaluate(`closeChannelMatrix()`);
  await call('Emulation.clearDeviceMetricsOverride');
  await sleep(250);
  assert.match(moved.status, /^Re-centred 1 window: Channel Matrix\./,
    `a dialog that had to be moved must be counted as one moved window (got "${moved.status}")`);
  assert.equal(moved.matrixPosition, 'fixed', 'the clamped dialog is the one the clamp placed');
  assert.equal(moved.matrixStored, null, 'the matrix position it remembered must be gone');
  console.log('re-centre windows: the line counts what moved, what was forgotten, and what needed nothing');

  // The same promise in the floating layout: it is the other mode the dialog can be in.
  const setFloating = async (on) => {
    const now = await evaluate(`document.getElementById('settings-modal-backdrop').classList.contains('is-floating')`);
    if (now !== on) {
      await evaluate(`document.getElementById('btn-toggle-float-settings').click()`);
      await sleep(200);
    }
  };
  await setFloating(true);
  await dragDialog('#settings-dialog-titlebar', -9000, 9000);
  assertReachable('the floating Preferences window dragged past the bottom-left',
    await titlebarReach('#settings-dialog-titlebar'));
  await evaluate(`document.getElementById('btn-recenter-windows').click()`);
  await sleep(400);
  const floatingRecentred = await evaluate(`(() => {
    const rect = document.getElementById('settings-modal').getBoundingClientRect();
    return { inside: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
      floating: document.getElementById('settings-modal-backdrop').classList.contains('is-floating') };
  })()`);
  assert.equal(floatingRecentred.floating, true, 'the floating layout must still be the one in use');
  assert.equal(floatingRecentred.inside, true, 're-centring must bring the floating window back inside too');
  await setFloating(false);
  console.log('window chrome: the dialogs stay reachable while dragged, and Re-centre windows brings them back');

  // --- The Warnings block: what was muted can be brought back ---------------------------------
  // A warning is silenced with one of the two boxes `win95Confirm` draws, and the keys it writes
  // (`wing_notice_muted`, `wing_notice_<action>`) are the operator's own silence. This block lists
  // them by the action they belong to and takes them back; it is read from localStorage every time
  // the window opens, so a notice muted in an earlier session is named here without running its
  // action again first.
  await evaluate(`localStorage.setItem('wing_notice_muted', '1'); localStorage.setItem('wing_notice_shoot', '1');`);
  await evaluate(`document.getElementById('btn-close-settings').click()`);
  await sleep(200);
  await evaluate(`document.getElementById('open-settings-btn').click()`);
  await sleep(400);
  await evaluate(`document.querySelector('.settings-nav-item[data-tab="general"]').click()`);
  await sleep(150);
  const mutedBlock = await evaluate(`(() => {
    const list = document.getElementById('settings-notice-list');
    const buttons = Array.from(list?.querySelectorAll('[data-restore-notice]') || []);
    const all = document.getElementById('btn-restore-all-notices');
    return {
      keys: buttons.map((button) => button.dataset.restoreNotice),
      labels: buttons.map((button) => button.parentElement?.querySelector('span')?.textContent?.trim() || ''),
      titles: buttons.map((button) => button.title),
      restoreAll: all?.textContent.trim() || '',
      restoreAllTitle: all?.title || '',
      restoreAllVisible: Boolean(all && all.offsetParent !== null),
    };
  })()`);
  assert.deepEqual(mutedBlock.keys, ['wing_notice_muted', 'wing_notice_shoot'],
    `both mutings must be listed, the one for every warning first (got ${JSON.stringify(mutedBlock.keys)})`);
  assert.ok(mutedBlock.labels.includes('Send to the console'),
    `a muted action must be named by what its dialog does (got ${JSON.stringify(mutedBlock.labels)})`);
  assert.ok(mutedBlock.labels.includes('Every warning of this kind'),
    `the global muting must be listed too (got ${JSON.stringify(mutedBlock.labels)})`);
  for (const title of mutedBlock.titles) {
    assert.ok(title.length > 20, `every Restore button must carry a ScreenTip (got "${title}")`);
  }
  assert.match(mutedBlock.restoreAll, /Restore all warnings/i,
    `the block must offer the blanket restore (got "${mutedBlock.restoreAll}")`);
  assert.ok(mutedBlock.restoreAllVisible && mutedBlock.restoreAllTitle.length > 20,
    'the blanket restore must be visible and carry a ScreenTip');

  await evaluate(`document.querySelector('[data-restore-notice="wing_notice_shoot"]').click()`);
  await sleep(200);
  const afterRowRestore = await evaluate(`(() => ({
    shoot: localStorage.getItem('wing_notice_shoot'),
    all: localStorage.getItem('wing_notice_muted'),
    keys: Array.from(document.querySelectorAll('#settings-notice-list [data-restore-notice]')).map((b) => b.dataset.restoreNotice),
    status: document.getElementById('settings-notice-status').textContent.trim(),
  }))()`);
  assert.equal(afterRowRestore.shoot, null, 'a per-row Restore must remove exactly that key');
  assert.equal(afterRowRestore.all, '1', 'and leave the other mutings alone');
  assert.deepEqual(afterRowRestore.keys, ['wing_notice_muted'], 'the restored row must disappear from the list');
  assert.match(afterRowRestore.status, /Send to the console/,
    `the block must say what was restored (got "${afterRowRestore.status}")`);

  await evaluate(`document.getElementById('btn-restore-all-notices').click()`);
  await sleep(200);
  const afterAllRestore = await evaluate(`(() => ({
    keys: Object.keys(localStorage).filter((key) => key.startsWith('wing_notice_')),
    rows: document.querySelectorAll('#settings-notice-list [data-restore-notice]').length,
    text: (document.getElementById('settings-notice-list').textContent || '').replace(/\\s+/g, ' ').trim(),
    disabled: document.getElementById('btn-restore-all-notices').disabled,
    status: document.getElementById('settings-notice-status').textContent.trim(),
  }))()`);
  assert.deepEqual(afterAllRestore.keys, [],
    'Restore all warnings must remove wing_notice_muted and every wing_notice_* key');
  assert.equal(afterAllRestore.rows, 0, 'no row may be left behind');
  assert.match(afterAllRestore.text, /No warning is muted/,
    `with nothing muted the block must say so plainly (got "${afterAllRestore.text}")`);
  assert.equal(afterAllRestore.disabled, true, 'the blanket restore has nothing to do and must look inactive');
  assert.match(afterAllRestore.status, /restored/i,
    `the block must confirm the blanket restore (got "${afterAllRestore.status}")`);

  // Refreshed when the window opens, which is the case the list exists for: the notice was muted in
  // another session (or by another window), and its own dialog has not drawn in this one.
  await evaluate(`localStorage.setItem('wing_notice_panic_stop', '1')`);
  await evaluate(`document.getElementById('btn-close-settings').click()`);
  await sleep(200);
  await evaluate(`document.getElementById('open-settings-btn').click()`);
  await sleep(400);
  await evaluate(`document.querySelector('.settings-nav-item[data-tab="general"]').click()`);
  await sleep(150);
  const reopenedBlock = await evaluate(`(() => ({
    keys: Array.from(document.querySelectorAll('#settings-notice-list [data-restore-notice]')).map((b) => b.dataset.restoreNotice),
    text: (document.getElementById('settings-notice-list').textContent || '').replace(/\\s+/g, ' ').trim(),
  }))()`);
  assert.deepEqual(reopenedBlock.keys, ['wing_notice_panic_stop'],
    'a notice muted while the window was closed must be listed when it opens again');
  assert.match(reopenedBlock.text, /PANIC STOP/,
    `the row must name the action, not the storage key (got "${reopenedBlock.text}")`);
  // The notice keys are shared with the other browser test, so nothing may be left behind.
  await evaluate(`document.getElementById('btn-restore-all-notices').click()`);
  await sleep(150);
  assert.deepEqual(await evaluate(`Object.keys(localStorage).filter((key) => key.startsWith('wing_notice_'))`), [],
    'no notice key may survive this check');
  console.log('warnings block: muted notices are named, restorable one by one, and restored in bulk');

  // Closing must work from the footer and from Escape, and leave nothing behind.
  await evaluate(`document.getElementById('btn-close-settings').click()`);
  await sleep(250);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('settings-modal-backdrop')).display === 'none'`), true,
    'the Close button must close the settings window');
  await evaluate(`document.getElementById('open-settings-btn').click()`);
  await sleep(300);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(250);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('settings-modal-backdrop')).display === 'none'`), true,
    'Escape must close the settings window');

  assert.deepEqual(pageErrors, [], `the settings window must not throw while walking its tabs:\n${pageErrors.join('\n')}`);
  console.log(`desktop settings tab contracts passed (${tabs.length} tabs)`);
  console.log('macro summary: lines by default, cards on demand, and the choice survives a reload');
// --- 24. The inter-application tab says exactly what is true today --------------------------------
//
// Phase A of docs/INTER_APP_PLAN_REVIEW_2026-10-02.md: the switch and the list land, and nothing else —
// no MIDI client, no socket, no listener, no runtime hook. The promise is in the interface, so the
// interface is where it is asserted: a tab that claimed more than the code does would be worse than no
// tab at all.
await evaluate(`document.querySelector('.settings-nav-item[data-tab="interapp"]').click()`);
await sleep(200);
const interApp = await evaluate(`(() => {
  const box = document.getElementById('settings-inter-app');
  const status = document.getElementById('inter-app-status');
  const rows = document.getElementById('inter-app-peer-list-rows');
  const add = document.getElementById('inter-app-peer-add');
  return {
    present: Boolean(box && status && rows && add),
    checked: box ? box.checked : null,
    status: status ? status.textContent.trim() : '',
    rows: rows ? rows.textContent.trim() : '',
    addDisabled: add ? add.disabled : null,
    addTitle: add ? add.title : '',
  };
})()`);
assert.equal(interApp.present, true, 'the MIDI, Inter-app OSC tab must offer the switch, the editable list and its Add button');
assert.equal(interApp.checked, false, 'the feature must start off: nothing may be opened by default');
assert.match(interApp.status, /Off\. Nothing is opened/, `the status must say what "off" means (got ${JSON.stringify(interApp.status)})`);
assert.match(interApp.rows, /No applications yet/, 'an empty registry must say so rather than showing nothing');
// This assertion used to demand the opposite — that the Add button stayed **disabled** and kept saying "adding an
// application arrives with the MIDI support" — and that is what the owner pressed: a placeholder the suite defended
// while the feature was built and unreachable. The contract now says the button works and promises nothing.
assert.equal(interApp.addDisabled, false, 'adding an application must be available: a disabled placeholder here is a promise nobody can keep');
assert.doesNotMatch(interApp.addTitle, /arrives with|not built yet|coming soon/i, `the button must not promise a future feature (got ${JSON.stringify(interApp.addTitle)})`);
assert.match(interApp.addTitle, /Adds an application to the list with a name and an address/, `it must say what it does (got ${JSON.stringify(interApp.addTitle)})`);

// --- 25. The MIDI half of that page, which is Phase B's first step ---------------------------------
//
// It lists and counts, and nothing else: no message can be sent and none can trigger a macro yet. Two
// promises are worth pinning here — asking for the list opens nothing, and the page never shows a number or a
// state it did not get from the backend.
const midi = await evaluate(`(() => {
  const refresh = document.getElementById('inter-app-midi-refresh');
  const toggle = document.getElementById('inter-app-midi-toggle');
  const ports = document.getElementById('inter-app-midi-ports');
  const counters = document.getElementById('inter-app-midi-counters');
  return {
    present: Boolean(refresh && toggle && ports && counters),
    refreshTitle: refresh ? refresh.title : '',
    toggleTitle: toggle ? toggle.title : '',
    toggleLabel: toggle ? toggle.textContent.trim() : '',
    counters: counters ? counters.textContent.trim() : '',
  };
})()`);
assert.equal(midi.present, true, 'the Other Applications page must offer the MIDI list and its counters');
assert.match(midi.refreshTitle, /creates nothing/, `listing must not claim to open anything (got ${JSON.stringify(midi.refreshTitle)})`);
assert.match(midi.toggleTitle, /refuses while the switch above is off/, `opening must say it is gated (got ${JSON.stringify(midi.toggleTitle)})`);
assert.equal(midi.toggleLabel, 'Open our ports', 'the button offers to open when nothing is open');
assert.match(midi.counters, /Not open/, `with nothing open the page says so (got ${JSON.stringify(midi.counters)})`);

// Pressing Refresh with an answer it did not expect must not throw and must not invent ports: the browser
// harness answers `{}` for a command it does not model, which is exactly the awkward case.
await evaluate(`document.querySelector('.settings-nav-item[data-tab="interapp"]').click()`);
await sleep(120);
await evaluate(`document.getElementById('inter-app-midi-refresh').click()`);
await sleep(200);
const afterRefresh = await evaluate(`document.getElementById('inter-app-midi-ports').textContent.trim()`);
assert.match(afterRefresh, /No MIDI ports reported by the system/,
  `an unexpected answer must read as "no ports", never as invented ones (got ${JSON.stringify(afterRefresh)})`);

// --- 26. The test send, which is how the other application gets pointed at us ----------------------
//
// Phase B's second step lets the operator send one message by hand: it is what turns "we speak MIDI" into a
// control in Mixing Station, and it is the only sending there is until macros get a MIDI step.
const sendUi = await evaluate(`(() => {
  const ids = ['inter-app-midi-kind', 'inter-app-midi-channel', 'inter-app-midi-number', 'inter-app-midi-value', 'inter-app-midi-test-send', 'inter-app-midi-test-result'];
  const missing = ids.filter((id) => !document.getElementById(id));
  return {
    missing,
    kinds: Array.from(document.getElementById('inter-app-midi-kind').options).map((option) => option.value),
    result: document.getElementById('inter-app-midi-test-result').textContent.trim(),
    kindTitle: document.getElementById('inter-app-midi-kind').title,
    sendTitle: document.getElementById('inter-app-midi-test-send').title,
  };
})()`);
assert.deepEqual(sendUi.missing, [], 'the test send needs all of its fields');
assert.deepEqual(sendUi.kinds, ['note_on', 'note_off', 'control_change', 'program_change', 'pitch_bend'],
  'the closed list of messages is what this build can build');
assert.match(sendUi.kindTitle, /nothing else can be sent/, `the kind picker must say the list is closed (got ${JSON.stringify(sendUi.kindTitle)})`);
assert.match(sendUi.sendTitle, /refuses while the feature is switched off/, `the send button must say it is gated (got ${JSON.stringify(sendUi.sendTitle)})`);
assert.match(sendUi.result, /Nothing sent yet/, `before anything is pressed the page says so (got ${JSON.stringify(sendUi.result)})`);

// Pressing Send must never leave an operator with an unexplained answer. **What this covers, honestly**: this
// harness runs the window without the Tauri API, so it exercises the "no backend" path and asserts that the
// line explains itself instead of staying blank. The guard against printing a raw object when the backend
// answers something unexpected is in the window's code (`typeof answer === "string"`) and is *not* browser
// tested — saying otherwise would be the kind of coverage claim this project does not make.
await evaluate(`document.querySelector('.settings-nav-item[data-tab="interapp"]').click()`);
await sleep(120);
await evaluate(`document.getElementById('inter-app-midi-test-send').click()`);
await sleep(200);
const sendResult = await evaluate(`document.getElementById('inter-app-midi-test-result').textContent.trim()`);
assert.doesNotMatch(sendResult, /^\{\}$|^\[object/, `the result line must never show a raw object (got ${JSON.stringify(sendResult)})`);
assert.match(sendResult, /Not sent|Nothing sent|sent /, `the result must say what happened (got ${JSON.stringify(sendResult)})`);

// --- 27. Triggers from other applications, which is the half that fires our macros -----------------
//
// Phase B's third step: a message heard on our MIDI port fires the macro bound to it. What is asserted here is
// the *decision* — which macro a trigger event targets — because the firing itself goes through the window's
// existing path and the listener needs the Tauri API, which this harness does not have.
const triggerUi = await evaluate(`(() => {
  const status = document.getElementById('inter-app-trigger-status');
  const learn = document.getElementById('inter-app-trigger-learn');
  const list = document.getElementById('inter-app-trigger-list');
  return {
    present: Boolean(status && learn && list),
    learnTitle: learn ? learn.title : '',
    listText: list ? list.textContent.trim() : '',
    status: status ? status.textContent.trim() : '',
    hook: typeof window.__wingInterApp?.triggerTarget,
  };
})()`);
assert.equal(triggerUi.present, true, 'the page must offer the triggers section and its Learn button');
assert.equal(triggerUi.hook, 'function', 'the target lookup must be reachable for this assertion');
assert.match(triggerUi.learnTitle, /last message that arrived/, `Learn must say what it takes (got ${JSON.stringify(triggerUi.learnTitle)})`);
assert.match(triggerUi.listText, /No triggers yet/, `an empty binding list says so (got ${JSON.stringify(triggerUi.listText)})`);

// The decision: a bound trigger names its macro — by its own key once it has one, and by position only while the
// library has never been saved, which is the one moment a positional reference is still written — an unbound one
// names none, and an unknown id names nobody. The descriptor carries the **reference**, not a position resolved in
// the lookup: resolving needs the library, and the firing path resolves it through the one home for that rule.
const targets = await evaluate(`(() => {
  const make = (id, reference) => ({ ...reference, spec: { trigger_id: id, kind: 'note_on', channel: 1, number: 60 } });
  const settings = { triggers: [
    make('midi-1', { macro_index: 3 }),
    make('midi-2', { macro_index: null }),
    make('midi-3', { macro_id: 'mk-7' }),
  ] };
  const target = window.__wingInterApp.triggerTarget;
  return {
    bound: target(settings, 'midi-1'),
    unbound: target(settings, 'midi-2'),
    keyed: target(settings, 'midi-3'),
    unknown: target(settings, 'midi-9'),
    nothing: target({}, 'midi-1'),
    empty: target(null, 'midi-1'),
  };
})()`);
assert.equal(targets.bound?.reference?.macro_index, 3, 'a bound trigger names its macro, by position while the library has no keys');
assert.equal(targets.keyed?.reference?.macro_id, 'mk-7', 'and by its own key once it has one — the form a reorder cannot re-point');
assert.equal(targets.unbound?.reference?.macro_index ?? null, null, 'a learned trigger awaiting a macro names none — never macro 1');
assert.equal(targets.unknown, null, 'an id nobody bound is nobody\'s');
assert.equal(targets.nothing, null, 'a registry with no triggers binds nothing');
assert.equal(targets.empty, null, 'and a missing registry does not throw');

// And the condition: no condition means yes, a met one means yes, an unmet one means no — and the reason the
// backend gave is what the log shows, never a bare "it did not fire".
const holds = await evaluate(`(() => {
  const check = window.__wingInterApp.conditionHolds;
  return {
    absent: check(undefined),
    met: check({ met: true, reason: 'control change is 100' }),
    unmet: check({ met: false, reason: 'no value has arrived for control change yet' }),
    empty: check({}),
  };
})()`);
assert.equal(holds.absent, true, 'a binding with no condition fires');
assert.equal(holds.met, true, 'a met condition fires');
assert.equal(holds.unmet, false, 'an unmet condition does not');
assert.equal(holds.empty, false, 'and a condition object with no verdict is not a yes');

// The condition reads the same way the backend writes it, stale included: an operator comparing the row with the
// log must not have to translate.
const summaries = await evaluate(`(() => {
  const summary = window.__wingInterApp.conditionSummary;
  return {
    none: summary(null),
    control: summary({ kind: 'control_change', channel: 0, number: 255, operator: 'greater', value: 64, stale_ms: 0 }),
    note: summary({ kind: 'note_on', channel: 6, number: 42, operator: 'less_or_equal', value: 10, stale_ms: 2500 }),
  };
})()`);
assert.equal(summaries.none, 'no condition', 'no condition reads as no condition');
assert.equal(summaries.control, 'control change · any channel · any number · value > 64',
  `a condition reads like the backend writes it (got ${JSON.stringify(summaries.control)})`);
assert.match(summaries.note, /note on · channel 6 · number 42 · value ≤ 10/,
  `and the symbols are the same (got ${JSON.stringify(summaries.note)})`);
assert.match(summaries.note, /stale after 2\.5 s/, `staleness is part of the sentence (got ${JSON.stringify(summaries.note)})`);

// Pressing Learn without the backend must say so rather than appear to have learned something.
await evaluate(`document.querySelector('.settings-nav-item[data-tab="interapp"]').click()`);
await sleep(120);
await evaluate(`document.getElementById('inter-app-trigger-learn').click()`);
await sleep(200);
const learnStatus = await evaluate(`document.getElementById('inter-app-trigger-status').textContent.trim()`);
assert.match(learnStatus, /not running with the backend/, `Learn must be honest without a backend (got ${JSON.stringify(learnStatus)})`);

// --- 28. The counters are read only while the page is on screen ----------------------------------
//
// Phase B's promise that nothing polls in the background, measured rather than asserted. **What this proves,
// exactly**: entering the Other Applications page creates one interval and leaving it clears one — the window
// does not keep reading the MIDI monitor while the operator is looking at another page. It does not measure CPU
// (with the feature off there is no callback and no client at all, which the Rust side holds); it measures the
// one piece of polling this feature introduces.
const timers = await evaluate(`(() => {
  window.__TIMER_SPY = { intervals: 0, cleared: 0 };
  const realSetInterval = window.setInterval;
  const realClearInterval = window.clearInterval;
  window.setInterval = function (...args) { window.__TIMER_SPY.intervals += 1; return realSetInterval.apply(this, args); };
  window.clearInterval = function (...args) { window.__TIMER_SPY.cleared += 1; return realClearInterval.apply(this, args); };
  return true;
})()`);
assert.equal(timers, true, 'the spy must install');

await evaluate(`window.openSettingsModal('interapp')`);
await sleep(150);
const afterEntering = await evaluate(`window.__TIMER_SPY`);
assert.ok(afterEntering.intervals >= 1,
  `entering the page must start reading the monitor (got ${JSON.stringify(afterEntering)})`);

await evaluate(`document.querySelector('.settings-nav-item[data-tab="general"]').click()`);
await sleep(150);
const afterLeaving = await evaluate(`window.__TIMER_SPY`);
assert.ok(afterLeaving.cleared >= 1,
  `leaving the page must stop it: a monitor that keeps polling while nobody looks is the cost this refuses (got ${JSON.stringify(afterLeaving)})`);
assert.ok(afterLeaving.intervals >= afterEntering.intervals,
  'and nothing new was started by leaving');

// --- 29. The OSC listener, which only looks -------------------------------------------------------
//
// Phase C's first step: a socket that counts and triggers nothing. What is asserted here is that the page says
// so plainly and that starting it without a backend is honest rather than appearing to work.
const oscUi = await evaluate(`(() => {
  const port = document.getElementById('inter-app-osc-port');
  const toggle = document.getElementById('inter-app-osc-toggle');
  const counters = document.getElementById('inter-app-osc-counters');
  const section = counters ? counters.parentElement.textContent : '';
  return {
    present: Boolean(port && toggle && counters),
    port: port ? port.value : '',
    label: toggle ? toggle.textContent.trim() : '',
    counters: counters ? counters.textContent.trim() : '',
    toggleTitle: toggle ? toggle.title : '',
    section,
  };
})()`);
assert.equal(oscUi.present, true, 'the page must offer the OSC listener');
assert.equal(oscUi.port, '9100', 'the port field shows the default before any backend answers');
assert.equal(oscUi.label, 'Start listening', 'and the button offers to start');
assert.match(oscUi.counters, /Not listening/, `with nothing bound the page says so (got ${JSON.stringify(oscUi.counters)})`);
// This used to assert the section said "Nothing triggers yet" — true in Phase C, when the listener only counted, and
// false since triggers were built. The contract is now the opposite way round: the page must **not** claim to be
// harmless, and must say where it can be reached from and what the network option costs.
assert.doesNotMatch(oscUi.section, /Nothing triggers yet/,
  'the listener fires macros now, so the page must not still call it a counter');
assert.match(oscUi.section, /Where it listens/, `the section must say where it listens (got ${JSON.stringify(oscUi.section)})`);
assert.match(oscUi.section, /refused unless you have listed/, 'and that the network scope needs a list of addresses to filter by');
assert.match(oscUi.toggleTitle, /refuses while the switch above is off/, `and that it is gated (got ${JSON.stringify(oscUi.toggleTitle)})`);

await evaluate(`document.querySelector('.settings-nav-item[data-tab="interapp"]').click()`);
await sleep(120);
await evaluate(`document.getElementById('inter-app-osc-toggle').click()`);
await sleep(200);
const oscAfterPress = await evaluate(`document.getElementById('inter-app-osc-counters').textContent.trim()`);
assert.match(oscAfterPress, /not running with the backend/, `starting it without a backend must say so (got ${JSON.stringify(oscAfterPress)})`);

// Sending by hand: the fields exist, the honest limitation is written where the operator reads it, and pressing
// Send without a backend does not pretend anything left.
const oscSend = await evaluate(`(() => {
  const ids = ['inter-app-osc-host', 'inter-app-osc-target-port', 'inter-app-osc-address', 'inter-app-osc-send', 'inter-app-osc-send-result'];
  return {
    missing: ids.filter((id) => !document.getElementById(id)),
    result: document.getElementById('inter-app-osc-send-result').textContent.trim(),
    port: document.getElementById('inter-app-osc-target-port').value,
    address: document.getElementById('inter-app-osc-address').value,
  };
})()`);
assert.deepEqual(oscSend.missing, [], 'the test send needs all of its fields');
assert.match(oscSend.result, /no arguments/, `the limitation must be written where it is read (got ${JSON.stringify(oscSend.result)})`);
assert.notEqual(oscSend.port, '', 'the target port is seeded so the field is never empty');
// The field starts **empty** on purpose: the address belongs to the other application, and a made-up default here
// would be a console-looking literal in the window (the strict Maillot audit refused exactly that, correctly).
assert.equal(oscSend.address, '', "the address field starts empty: the address belongs to the other application");
await evaluate(`document.getElementById('inter-app-osc-send').click()`);
await sleep(200);
const oscSendResult = await evaluate(`document.getElementById('inter-app-osc-send-result').textContent.trim()`);
assert.match(oscSendResult, /not running with the backend/, `sending without a backend must say so (got ${JSON.stringify(oscSendResult)})`);

// Learning an OSC trigger takes the last address the listener heard, so the button must exist, say what it takes,
// and be honest without a backend — the same contract the MIDI Learn has.
const oscLearn = await evaluate(`(() => {
  const button = document.getElementById('inter-app-osc-trigger-learn');
  return { present: Boolean(button), title: button ? button.title : '' };
})()`);
assert.equal(oscLearn.present, true, 'the page must offer learning an OSC trigger');
assert.match(oscLearn.title, /last address the OSC listener heard/, `Learn must say what it takes (got ${JSON.stringify(oscLearn.title)})`);
await evaluate(`document.getElementById('inter-app-osc-trigger-learn').click()`);
await sleep(200);
const oscLearnStatus = await evaluate(`document.getElementById('inter-app-trigger-status').textContent.trim()`);
assert.match(oscLearnStatus, /not running with the backend/, `Learn must be honest without a backend (got ${JSON.stringify(oscLearnStatus)})`);

// The applications list, which for OSC **is** a filter of IP addresses: the page has to say what an empty list means,
// because "observe anyone" is a real state an operator should know about — and it has to say what the filter is not,
// because a list of addresses is not authentication (independent security audit, 2026-10-04).
const peerUi = await evaluate(`(() => {
  const add = document.getElementById('inter-app-peer-add');
  const rows = document.getElementById('inter-app-peer-list-rows');
  const section = document.querySelector('#tabpage-interapp').textContent;
  return {
    present: Boolean(add && rows),
    addTitle: add ? add.title : '',
    rowsText: rows ? rows.textContent.trim() : '',
  };
})()`);
assert.equal(peerUi.present, true, 'the page must let an application be named');
assert.match(peerUi.addTitle, /MIDI peer leaves the address empty/, `and say what an address means per protocol (got ${JSON.stringify(peerUi.addTitle)})`);
// The master switch has to say that it stops what is running: a switch that only refuses to start is a sign.
assert.match(
  await evaluate(`document.querySelector('#tabpage-interapp').textContent`),
  /also stops whatever is running/,
  'the feature switch must say that switching off stops what is running, not only what would start');
assert.match(peerUi.rowsText, /The OSC listener observes anyone until one is added/,
  `the empty list must say what it means for the listener (got ${JSON.stringify(peerUi.rowsText)})`);
await evaluate(`document.getElementById('inter-app-peer-add').click()`);
await sleep(200);
const peerStatus = await evaluate(`document.getElementById('inter-app-status').textContent.trim()`);
assert.ok(peerStatus.length > 0, 'adding without a backend must say something rather than nothing');

// The buttons on the two cards in the right-hand column have to open Settings. They existed and did nothing for a
// while: the handler called a function that was not in its scope, behind a `typeof` guard that turned the failure
// into silence — which is exactly how "press Settings and nothing happens" is built.
for (const [buttonId, tab] of [['btn-open-timecode-settings', 'timecode'], ['btn-open-interapp-settings', 'interapp']]) {
  await evaluate(`document.getElementById('settings-modal-backdrop').style.display = 'none'`);
  await evaluate(`document.getElementById('${buttonId}').click()`);
  await sleep(250);
  const opened = await evaluate(`(() => ({
    backdrop: getComputedStyle(document.getElementById('settings-modal-backdrop')).display !== 'none',
    active: document.querySelector('.settings-nav-item.is-active')?.dataset?.tab || '',
  }))()`);
  assert.equal(opened.backdrop, true, `${buttonId} must open Settings (got ${JSON.stringify(opened)})`);
  assert.equal(opened.active, tab, `${buttonId} must open Settings on the ${tab} page (got ${JSON.stringify(opened)})`);
}

// Where the OSC listener may be reached from: the safe choice must be the one it starts on, and the dangerous one
// must say what it costs.
const bindUi = await evaluate(`(() => {
  const bind = document.getElementById('inter-app-osc-bind');
  const section = document.querySelector('#tabpage-interapp').textContent;
  return {
    present: Boolean(bind),
    options: bind ? Array.from(bind.options).map((option) => option.value) : [],
    selected: bind ? bind.value : '',
    title: bind ? bind.title : '',
    section,
  };
})()`);
assert.equal(bindUi.present, true, 'the listener must offer where it can be reached from');
assert.deepEqual(bindUi.options, ['this_mac', 'network'], 'the two scopes');
assert.equal(bindUi.selected, 'this_mac', 'and it must start on the safe one');
assert.match(bindUi.title, /refused without at least one application listed/, `the network choice must say what it costs (got ${JSON.stringify(bindUi.title)})`);
// Whitespace-tolerant: the page's own indentation splits these sentences across lines, and a contract that failed on
// a line break would be a contract about formatting rather than about what the operator reads.
assert.match(bindUi.section, /any device on that network can send an address that\s+fires a macro/, 'and the page must say why');

// The compact readout in the status area. It must start **hidden**: a rig that does not use timecode should not see
// a permanent `--:--:--:--` in its status bar, and the moment it appears is the moment there is something to say.
const compact = await evaluate(`(() => {
  const badge = document.getElementById('top-timecode');
  const text = document.getElementById('top-timecode-text');
  return {
    present: Boolean(badge && text),
    hidden: badge ? badge.classList.contains('hidden') : null,
    text: text ? text.textContent.trim() : '',
    title: badge ? badge.title : '',
  };
})()`);
assert.equal(compact.present, true, 'the status area must be able to show the position');
assert.equal(compact.hidden, true, 'and must hide it until a position has arrived');
assert.match(compact.text, /^--/, `with a placeholder rather than a confident zero (got ${JSON.stringify(compact.text)})`);
assert.match(compact.title, /Settings → Timecode/, `and a pointer to where the rest lives (got ${JSON.stringify(compact.title)})`);

// --- 30. The timecode readout, which shows a state rather than only a number ----------------------
//
// Phase T1: MTC arrives on the MIDI ports, so the page's job is to say **where the show is** and **whether to
// trust it**. A readout that showed a position without saying it stopped arriving would be worse than no readout.
await evaluate(`document.querySelector('.settings-nav-item[data-tab="timecode"]').click()`);
await sleep(200);
const timecodeUi = await evaluate(`(() => ({
  position: document.getElementById('timecode-position').textContent.trim(),
  state: document.getElementById('timecode-state').textContent.trim(),
  counters: document.getElementById('timecode-counters').textContent.trim(),
  section: document.querySelector('#tabpage-timecode').textContent,
}))()`);
assert.match(timecodeUi.position, /^--/, `before anything arrives the readout is empty, not zero (got ${JSON.stringify(timecodeUi.position)})`);
assert.match(timecodeUi.state, /Nothing has arrived yet/, `and it says so (got ${JSON.stringify(timecodeUi.state)})`);
// Without a backend the page keeps its own initial wording, which is honest: "no messages read" rather than a
// rendered zero that would imply something had been asked for and answered.
assert.match(timecodeUi.counters, /Timecode messages read: 0|No timecode messages read/,
  `with nothing read the counters say so (got ${JSON.stringify(timecodeUi.counters)})`);
assert.match(timecodeUi.section, /arrives as MTC on the MIDI ports/, `the page must say where timecode comes from (got ${JSON.stringify(timecodeUi.section.slice(0, 120))})`);
assert.match(timecodeUi.section, /LTC/, `and that LTC is the next step, not a feature that is silently missing`);

// The cue list, as a **summary**. It is asserted here for what it says with no backend, and for the shape it has now:
// the list is read on this page and edited in the LTC window, so the controls that used to be pressed here are
// asserted ABSENT rather than pressed — an editor that reappeared would be two editors of one list again.
const cueUi = await evaluate(`(() => {
  const status = document.getElementById('timecode-cue-status');
  const list = document.getElementById('timecode-cue-list');
  const edit = document.getElementById('timecode-cue-edit-list');
  const gone = ['timecode-cue-add', 'timecode-cue-add-end', 'timecode-cue-save', 'timecode-cue-sort',
    'timecode-cue-renumber', 'timecode-cue-undo', 'timecode-cue-position', 'timecode-offset']
    .filter((id) => document.getElementById(id));
  return {
    present: Boolean(status && list && edit),
    editTitle: edit ? edit.title : '',
    status: status ? status.textContent.trim() : '',
    gone,
  };
})()`);
assert.equal(cueUi.present, true, 'the Timecode page must offer the cue list and the way to its editor');
assert.deepEqual(cueUi.gone, [],
  `and it must NOT offer the editor: that is the LTC window now (found ${JSON.stringify(cueUi.gone)})`);
assert.match(cueUi.editTitle, /where this list is edited/, `the way to the editor must say what it is for (got ${JSON.stringify(cueUi.editTitle)})`);
assert.match(cueUi.status, /No cues yet/, `an empty list says so (got ${JSON.stringify(cueUi.status)})`);
assert.match(cueUi.status, /Edit the cue list/,
  `and it says where a cue is added, instead of pointing at a control this page no longer has (got ${JSON.stringify(cueUi.status)})`);

// LTC: the audio signal's own section. What is asserted here is the part an operator has to know before choosing a
// file — that LTC does not carry its own frame rate — and the honesty of the button with no backend.
const ltcUi = await evaluate(`(() => {
  const rate = document.getElementById('timecode-ltc-rate');
  const verify = document.getElementById('timecode-ltc-verify');
  const result = document.getElementById('timecode-ltc-result');
  const rate29 = rate ? Array.from(rate.options).find((option) => option.value === '29.97') : null;
  return {
    present: Boolean(rate && verify && result),
    rates: rate ? Array.from(rate.options).map((option) => option.value) : [],
    rate29: rate29 ? rate29.textContent.trim() : '',
    rateTitle: rate ? rate.title : '',
    verifyTitle: verify ? verify.title : '',
    result: result ? result.textContent.trim() : '',
    section: document.querySelector('#tabpage-timecode').textContent,
  };
})()`);
assert.equal(ltcUi.present, true, 'the Timecode page must offer the LTC file');
// 29.97 is the rate the engine supports drop-frame for (`TimecodeRate::Fps29_97`), and it is the video rate: leaving
// it out of the list was a hole in the interface, not a limit of the codec. `open_ltc_input` accepts it, and this
// contract fails if the option disappears from the selector.
assert.deepEqual(ltcUi.rates, ['25', '24', '29.97', '30'],
  `the rates the codec understands, 29.97 drop-frame included (got ${JSON.stringify(ltcUi.rates)})`);
assert.match(ltcUi.rate29, /drop-frame/, `and the drop-frame rate says so (got ${JSON.stringify(ltcUi.rate29)})`);
assert.match(ltcUi.rateTitle, /does not carry one/, `the rate picker must say why it exists (got ${JSON.stringify(ltcUi.rateTitle)})`);
assert.match(ltcUi.verifyTitle, /no permission and no device/, `and why a file comes first (got ${JSON.stringify(ltcUi.verifyTitle)})`);
assert.match(ltcUi.section, /LTC is timecode as an audio signal/, 'the section explains what LTC is');
assert.match(ltcUi.result, /No file verified yet/, `and nothing is claimed before a file is read (got ${JSON.stringify(ltcUi.result)})`);
// The file is **checked, not played**. The page promised "LTC from a file" while the application only ever read one
// and reported what it held: a promise to remove, and this is the contract that keeps it removed.
assert.doesNotMatch(ltcUi.section, /LTC from a file/,
  'the page must not promise LTC played from a file: a file is read and reported, never played');
assert.match(ltcUi.section, /checked, never played/,
  `and must say what a file is for instead (got ${JSON.stringify(ltcUi.section.slice(0, 200))})`);
assert.match(ltcUi.section, /LTC file \(checked, not played\)/,
  'the step-by-step says the same thing before the operator presses anything');
await evaluate(`document.getElementById('timecode-ltc-verify').click()`);
await sleep(200);
const ltcStatus = await evaluate(`document.getElementById('timecode-ltc-result').textContent.trim()`);
assert.match(ltcStatus, /not running with the backend/, `verifying without a backend must say so (got ${JSON.stringify(ltcStatus)})`);

// The audio input, which is the one control here that can ask for the microphone permission. What is asserted is
// that it says so, that nothing is claimed before a device exists, and that pressing it without a backend is honest.
const inputUi = await evaluate(`(() => {
  const device = document.getElementById('timecode-input-device');
  const channel = document.getElementById('timecode-input-channel');
  const toggle = document.getElementById('timecode-input-toggle');
  const state = document.getElementById('timecode-input-state');
  return {
    present: Boolean(device && channel && toggle && state),
    channel: channel ? channel.value : '',
    label: toggle ? toggle.textContent.trim() : '',
    toggleTitle: toggle ? toggle.title : '',
    state: state ? state.textContent.trim() : '',
  };
})()`);
assert.equal(inputUi.present, true, 'the Timecode page must offer the audio input');
assert.equal(inputUi.channel, '1', 'the channel starts at the first one');
assert.equal(inputUi.label, 'Listen', 'and the button offers to listen');
assert.match(inputUi.toggleTitle, /microphone permission/, `the button must be honest about the permission (got ${JSON.stringify(inputUi.toggleTitle)})`);
assert.match(inputUi.state, /Not listening/, `with nothing open the page says so (got ${JSON.stringify(inputUi.state)})`);
await evaluate(`document.getElementById('timecode-input-toggle').click()`);
await sleep(200);
const inputAfterPress = await evaluate(`document.getElementById('timecode-input-state').textContent.trim()`);
assert.match(inputAfterPress, /not running with the backend/, `listening without a backend must say so (got ${JSON.stringify(inputAfterPress)})`);

// The way back from a hot unplug, which did not exist until now, and the sentence a **dead** stream puts on the page.
// The page used to print "Listening to …" for ever over a device that had gone, because nothing cleared the backend's
// flag and nothing told this window; the backend now clears it and announces it, and `renderLtcInput` — the same
// function the 250 ms state poll calls — is what has to turn that report into something an operator can act on.
const reconnectUi = await evaluate(`(() => {
  const button = document.getElementById('timecode-input-reconnect');
  return { present: Boolean(button), label: button ? button.textContent.trim() : '', title: button ? button.title : '' };
})()`);
assert.equal(reconnectUi.present, true, 'the Timecode page must offer a way to reconnect the audio input');
assert.match(reconnectUi.label, /Reconnect the input/, `and say what it is (got ${JSON.stringify(reconnectUi.label)})`);
assert.match(reconnectUi.title, /unplugged|reclaimed/, `and why an operator would press it (got ${JSON.stringify(reconnectUi.title)})`);
assert.match(reconnectUi.title, /default input/, `including the fallback it uses (got ${JSON.stringify(reconnectUi.title)})`);
await evaluate(`document.getElementById('timecode-input-reconnect').click()`);
await sleep(200);
const reconnectWithoutBackend = await evaluate(`document.getElementById('timecode-input-state').textContent.trim()`);
assert.match(reconnectWithoutBackend, /not running with the backend/,
  `reconnecting without a backend must say so (got ${JSON.stringify(reconnectWithoutBackend)})`);

const diedUi = await evaluate(`(() => {
  window.__wingTimecode.renderLtcInput({ open: false, listening: null, inputs: 1,
    stream_error: { message: 'The requested audio device is not available.', disconnected: true } });
  const line = document.getElementById('timecode-input-state').textContent.trim();
  window.__wingTimecode.renderLtcInput({ open: true, listening: 'QUANTUM · channel 1', inputs: 1, stream_error: null });
  return { line, listening: document.getElementById('timecode-input-state').textContent.trim() };
})()`);
assert.match(diedUi.line, /The requested audio device is not available\./,
  `a dead stream must show the reason the backend kept (got ${JSON.stringify(diedUi.line)})`);
assert.doesNotMatch(diedUi.line, /^Listening to/, 'and must not go on claiming it is listening');
assert.match(diedUi.line, /Reconnect the input/, `and must point at the control that recovers it (got ${JSON.stringify(diedUi.line)})`);
assert.match(diedUi.listening, /^Listening to QUANTUM/, `a live stream still reads as listening (got ${JSON.stringify(diedUi.listening)})`);

// --- 31. The cue list itself, with a backend behind it ---------------------------------------------
//
// Everything above runs with no backend, which an empty list cannot distinguish from a list nobody has made yet. The
// cue list is the one place where that matters: the panel's whole job is what it does with cues. So the window is
// reloaded against a fake backend that answers the four commands the list uses, and the list is driven the way the
// operator drives it — the same row the clock window shows, the same order, and the same rule that editing is local
// and saving is explicit.
//
// The keys this page remembers are cleared first: the browser suites share one Chrome profile, and a sort order left
// behind by an earlier run would decide what this one sees (the same reason `wing_macro_summary` is cleared above).
await evaluate(`localStorage.removeItem('wing_timecode_cue_sort')`);
await evaluate(`localStorage.removeItem('wing_timecode_cue_created_order')`);
// The fixture is what `get_timecode_cues` answers, and the backend draws every cue through one struct: `label` and
// `group` are strings and empty when nobody named the cue, and `number` is canonical text, empty when the operator has
// not numbered it. A fixture that omits a key the backend always sends is a fixture that lies, and it lies in the one
// direction that hides a defect — the row would draw no name box and no number, and the suite would call that correct.
const CUE_LIST = [
  { id: 'cue-3', at: { hours: 1, minutes: 0, seconds: 30, frames: 0, rate: 'fps25', drop_frame: false }, number: '', label: '', group: '', macro_index: 0, repeats: false, enabled: true, note: 'Curtain' },
  { id: 'cue-1', at: { hours: 1, minutes: 0, seconds: 10, frames: 0, rate: 'fps25', drop_frame: false }, number: '', label: '', group: '', macro_index: 0, repeats: false, enabled: true, note: 'Opening' },
  { id: 'cue-2', at: { hours: 1, minutes: 0, seconds: 20, frames: 0, rate: 'fps25', drop_frame: false }, number: '', label: '', group: '', macro_index: 0, repeats: false, enabled: false, note: 'Parked' },
  { id: 'cue-4', at: { hours: 1, minutes: 0, seconds: 20, frames: 0, rate: 'fps25', drop_frame: false }, number: '', label: '', group: '', macro_index: 1, repeats: true, enabled: true, note: 'Clash' },
];
/// The backend's own normalisation of one cue, written once and injected into every stub that writes the list this
/// suite drives. A stub whose `set_timecode_cues` answers `cues = args.cues.cues` repeats what the client sent and can
/// therefore never catch a mismatch with the real backend: `label` and `group` always come back as strings (empty when
/// nobody named them), a number comes back canonical (`007` is `7`, `1.50` is `1.5`), and it has to be a decimal —
/// this one stores the text and lets the duplicate check be the caller's, like the backend's `validate()`.
const cueNormalize = (cue) => {
  const canonicalNumber = (text) => {
    const value = String(text ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(value)) return value;
    const whole = Number(value.split('.')[0]).toString();
    const fraction = value.split('.')[1];
    if (fraction === undefined) return whole;
    const rest = fraction.replace(/0+$/, '');
    return rest ? `${whole}.${rest}` : whole;
  };
  return {
    ...cue,
    label: String(cue?.label ?? ''),
    group: String(cue?.group ?? '').trim(),
    number: canonicalNumber(cue?.number),
  };
};
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (() => {
      window.__INVOKES = [];
      const normalizeCues = ${cueNormalize.toString()};
      let cues = ${JSON.stringify(CUE_LIST)};
      let sort = 'smpte';
      window.__TAURI__ = {
        core: { invoke: async (cmd, args) => {
          window.__INVOKES.push({ cmd, args });
          switch (cmd) {
            // The order is the show's: it travels in the file, so the page has to read it from here and write it back.
            case 'get_timecode_cues': return { schema_version: 1, cues, offset_frames: 0, sort };
            case 'set_timecode_cues': cues = (args?.cues?.cues || []).map(normalizeCues); sort = args?.cues?.sort || sort; return { ...args.cues, cues, sort };
            case 'add_timecode_cue_from_position': return { schema_version: 1, cues, offset_frames: 0, sort };
            case 'timecode_state': return window.__STATE_OVERRIDE
              || { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: cues.length,
                   next_cue_id: 'cue-1', spent_ids: ['cue-3'], armed_at: '01:00:05:00' };
            case 'get_inter_app_settings': return { enabled: false, triggers: [] };
            case 'load_macro_library': return { macros: [
              // Macro 0 has no trigger of its own and one runnable step. A timecode cue addresses a macro
              // by its index in the library and never consults the trigger, so this is the case that proves
              // "only a cue fires it" still means *the cue fires it*.
              { name: 'Cue only', enabled: true, triggerCategory: '', triggerIds: '', triggerParameter: '',
                actionSteps: [{ enabled: true, actionMode: 'set', actionAddress: '/ch/1/mute', actionArgKind: 'int',
                  actionValue: '1', targetCategory: 'ch', targetIds: '1', targetParameter: 'mute' }] },
              { name: 'Macro B', steps: [] },
            ], selectedIndex: 0 };
            case 'inter_app_midi_ports': return [];
            case 'timecode_pending_cues': return [];
            default: return {};
          }
        } },
        event: { listen: async (name, handler) => { (window.__HANDLERS = window.__HANDLERS || {})[name] = handler; return () => {}; } },
        window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, setSize: async () => {}, setPosition: async () => {},
          close: async () => {}, onCloseRequested: async () => () => {}, innerSize: async () => ({ width: 1440, height: 900 }),
          outerPosition: async () => ({ x: 0, y: 0 }) }),
          LogicalSize: class { constructor(w, h) { this.width = w; this.height = h; } },
          LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } } },
      };
    })();
  `,
});
await reloadReadySettingsPage();
for (let attempt = 0; attempt < 200; attempt += 1) {
  if (await evaluate(`Boolean(window.__TAURI__?.core?.invoke) && Boolean(document.getElementById('open-settings-btn'))`)) break;
  await sleep(50);
}
await evaluate(`document.getElementById('open-settings-btn').click()`);
await sleep(300);
await evaluate(`document.querySelector('.settings-nav-item[data-tab="timecode"]').click()`);
for (let attempt = 0; attempt < 120; attempt += 1) {
  if (await evaluate(`document.querySelectorAll('#timecode-cue-list .cue-row').length === 4`)) break;
  await sleep(50);
}
assert.equal(await evaluate(`document.querySelectorAll('#timecode-cue-list .cue-row').length`), 4,
  'the cue list must paint the cues the backend answered with');

const cueListUi = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('#timecode-cue-list .cue-row'));
  const at = (row) => row?.querySelector('.cue-at')?.textContent.trim() || '';
  // Every row must be a cue the list carries: with an id only in the DOM, a lookup that misses is reported with the
  // ids that were there rather than as a TypeError about a container that is not one.
  const tags = (row) => Array.from(row?.querySelectorAll('.cue-tag') || []).map((tag) => tag.textContent.trim());
  return {
    ids: rows.map((row) => row.dataset.cueId || '(no id)'),
    times: rows.map(at),
    names: rows.map((row) => row.querySelector('.cue-name')?.textContent.trim() || ''),
    disabledTags: tags(rows.find((row) => row.dataset.cueId === 'cue-2')),
    // **A read-only row offers nothing to press**, and that is the change: the moves, the copy, the lock and the
    // number field are in the LTC window, which is the only editor. This used to be 2 — both rows of the clash
    // offered "→ free" — and asserting 0 here is what stops an editor reappearing on this page unnoticed.
    rowButtons: rows.reduce((total, row) => total + row.querySelectorAll('.cue-buttons button').length, 0),
    status: document.getElementById('timecode-cue-status')?.textContent.trim() || '',
    armed: document.getElementById('timecode-cue-armed')?.textContent.trim() || '',
    armedHidden: document.getElementById('timecode-cue-armed')?.hidden,
    spentTags: tags(rows.find((row) => row.dataset.cueId === 'cue-3')),
    nextTags: tags(rows.find((row) => row.dataset.cueId === 'cue-1')),
  };
})()`);
// The same list, the same order and the same words as the clock window's panel: SMPTE by default (the file holds a
// different order), the note shown for every cue, and the two states a row has to carry.
assert.deepEqual(cueListUi.times, ['01:00:10:00', '01:00:20:00', '01:00:20:00', '01:00:30:00'],
  `the list is laid out by SMPTE, with the tie in the list's own order (got ${JSON.stringify(cueListUi.times)})`);
assert.deepEqual(cueListUi.names, ['Opening', 'Parked', 'Clash', 'Curtain'],
  `every row shows the cue's name, which is the note that used to be saved and never shown (got ${JSON.stringify(cueListUi.names)})`);
assert.ok(cueListUi.disabledTags.includes('off'), `a cue that is not active says so (got ${JSON.stringify(cueListUi.disabledTags)} for rows ${JSON.stringify(cueListUi.ids)})`);
assert.ok(cueListUi.disabledTags.includes('clash'), `and a cue sharing its frame says that too (got ${JSON.stringify(cueListUi.disabledTags)} for rows ${JSON.stringify(cueListUi.ids)})`);
assert.equal(cueListUi.rowButtons, 0,
  `and it offers nothing to press: the list is READ here and edited in the LTC window (got ${cueListUi.rowButtons} buttons)`);
assert.match(cueListUi.status, /hold more than one cue/, `the clash is said out loud (got ${JSON.stringify(cueListUi.status)})`);
// What the engine already knows, so a page opened late is not blank about a show in progress: which cue is next, and
// which cues it has spent. `spent_ids` does not say *how* a cue was spent, so a cue no announcement has named is
// painted neutrally — never as fired.
assert.ok(cueListUi.nextTags.includes('next'), `the engine's next cue is named on its row (got ${JSON.stringify(cueListUi.nextTags)})`);
assert.ok(cueListUi.spentTags.includes('spent'), `and a cue the engine has spent is marked, neutrally (got ${JSON.stringify(cueListUi.spentTags)})`);
assert.doesNotMatch(cueListUi.spentTags.join(' '), /fired|skipped/,
  `without inventing which of the two it was (got ${JSON.stringify(cueListUi.spentTags)})`);
assert.equal(cueListUi.armed, 'Re-armed at 01:00:05:00.',
  `and where the list was last armed is on the page (got ${JSON.stringify(cueListUi.armed)})`);

// **Where "choosing an order writes it into the cue list" went.** That contract lived here, and it cannot: the order
// selector is in the LTC window now, which is the only place that writes. The payload property it protected — that a
// constructed write carries `sort` and `drive` rather than letting the backend's defaults replace them — is asserted
// where the write is (`test-desktop-ltc-window-browser.mjs` reads the payload) and structurally, across all three
// windows, by the cue-write guard in `test-desktop-ui-contracts.mjs`.
assert.equal(await evaluate(`Boolean(document.getElementById('timecode-cue-sort'))`), false,
  'the order selector must be gone from this page: leaving it here would be a control that appears to change the show and does not');
// **Where "editing is local, and Save is the one thing that writes" went.** Both contracts lived here, over the row's
// editor (four fields and a nudge) and the Save button. This page has neither: the row is drawn read-only, and the
// editing — the four fields, the nudge, the copy, the lock — is in the LTC window, where those same properties are
// contracted (`test-desktop-ltc-window-browser.mjs`). What stays assertable HERE is that they are absent, which is
// what stops an editor reappearing on the page the operator reads.
assert.equal(
  await evaluate(`document.querySelectorAll('#timecode-cue-list .cue-editor').length`),
  0,
  'the row editor must be gone from this page: a summary with a time editor is an editor',
);
assert.equal(
  await evaluate(`window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').length`),
  0,
  'and reading the list must issue no write at all — the failure mode is a "summary" that can still edit the show',
);

// The engine's announcements paint the row here too: the page that runs the macro is this one, so a cue it fired and
// a cue the show seeked past are told apart on the same list the clock shows. The engine marks a cue spent **before**
// it announces it, so the snapshot that follows lists it — the mock says the same, or the page's own honest rule
// (a mark for a cue the engine no longer lists as spent is a lie) would wipe the mark on the next poll.
await evaluate(`window.__STATE_OVERRIDE = { state: 'running', position: '01:00:15:00', rate: '25', drop_frame: false,
  pieces: 9, positions: 2, source: 'MTC', cues: 4, next_cue_id: null, spent_ids: ['cue-1', 'cue-3'], armed_at: '01:00:05:00' }`);
await evaluate(`window.__HANDLERS?.['timecode-cue']({ payload: { seq: 1, event: { kind: 'fired', id: 'cue-1', at: '01:00:10:01', macro_index: 0 } } })`);
await evaluate(`window.__HANDLERS?.['timecode-cue']({ payload: { seq: 2, event: { kind: 'skipped', id: 'cue-3', at: '01:00:30:00', jumped_ms: 30000, arrival_gap_ms: 40, across_silence: false } } })`);
await sleep(400);
const markedUi = await evaluate(`(() => {
  const row = (id) => document.querySelector('#timecode-cue-list .cue-row[data-cue-id="' + id + '"]');
  return {
    fired: Array.from(row('cue-1')?.querySelectorAll('.cue-tag') || []).map((tag) => tag.textContent.trim()),
    skipped: Array.from(row('cue-3')?.querySelectorAll('.cue-tag') || []).map((tag) => tag.textContent.trim()),
  };
})()`);
assert.deepEqual(markedUi.fired, ['fired'], `a fired cue is marked where the macro ran (got ${JSON.stringify(markedUi.fired)})`);
assert.deepEqual(markedUi.skipped, ['skipped'], `and a skipped one is not painted as fired (got ${JSON.stringify(markedUi.skipped)})`);

// The macro this cue names (index 0) has **no trigger of its own**: it is the cue-only kind the macro
// editor now offers. The engine addresses a macro by its index in the library and never consults the
// trigger, so "only a cue fires it" has to mean the cue really does — a macro that nothing could fire
// would be a dead control, not a feature. Firing is proven where it reaches the backend: `fire_macro`.
const cueOnlyFire = await evaluate(`(() => {
  const calls = window.__INVOKES.filter((entry) => entry.cmd === 'fire_macro');
  const config = calls[0]?.args?.config || null;
  return {
    calls: calls.length,
    name: config?.name ?? null,
    trigger: config ? [config.triggerCategory, config.triggerIds, config.triggerParameter] : null,
    steps: Array.isArray(config?.actionSteps) ? config.actionSteps.length : 0,
  };
})()`);
assert.ok(cueOnlyFire.calls >= 1,
  `a cue naming a macro with no trigger of its own must still reach fire_macro (got ${cueOnlyFire.calls} call(s))`);
assert.equal(cueOnlyFire.name, 'Cue only',
  `and it must fire the macro the cue names, by index (got ${JSON.stringify(cueOnlyFire.name)})`);
assert.deepEqual(cueOnlyFire.trigger, ['', '', ''],
  `the macro it fires must be the triggerless one, unchanged (got ${JSON.stringify(cueOnlyFire.trigger)})`);
assert.equal(cueOnlyFire.steps, 1,
  `with its own action list, so the fire is not an empty one (got ${cueOnlyFire.steps} step(s))`);
console.log('cue-only macro: a timecode cue fires it through fire_macro');

// --- 31b. The same row, and what the list gained on top of it ---------------------------------------
//
// The row, the order comparator and the marks live in `desktop/ui/cue-list.js`, loaded here and by the clock window
// (`timecode.html`). This asserts the page is really drawing from that file, and pins what the list gained: the
// search box, undo of a local change, a duplicated cue, the lock that stops an accidental edit, the operator's own
// name for a cue, and the history line that answers "what just happened?".
const sharedRow = await evaluate(`(() => {
  const list = window.WingCueList;
  return {
    loaded: Boolean(list),
    api: Boolean(list) && typeof list.orderedCues === 'function' && typeof list.createPanel === 'function'
      && typeof list.positionText === 'function' && typeof list.clashMap === 'function',
    at: document.querySelector('#timecode-cue-list .cue-row[data-cue-id="cue-2"] .cue-at')?.textContent.trim() || '',
    written: list ? list.positionText({ hours: 1, minutes: 0, seconds: 20, frames: 0, drop_frame: false }) : '',
  };
})()`);
assert.equal(sharedRow.loaded, true,
  'the page must load the shared cue-list.js: the row lives there, not in a copy inside this page');
assert.equal(sharedRow.api, true, 'and the list must be built from its API');
assert.equal(sharedRow.at, sharedRow.written,
  `the time on a row is the shared file's own writer (${JSON.stringify(sharedRow.at)} vs ${JSON.stringify(sharedRow.written)})`);
// The other half of the `label` contract, where it lives: the shared module only draws the name box when the cue list
// carries the field, and it is asked here rather than through a fixture the backend cannot send. A file written before
// `label` existed has no key at all (`#[serde(default)]` fills it on the way in, and the key is always written on the
// way out), and a row must not put a box on screen whose contents the next read would drop.
assert.deepEqual(await evaluate(`(() => {
  const list = window.WingCueList;
  const at = { hours: 1, minutes: 0, seconds: 0, frames: 0, rate: 'fps25', drop_frame: false };
  return [list.cueHasLabel({ id: 'cue-9', at }), list.cueHasLabel({ id: 'cue-9', at, label: '' }), list.cueHasLabel({ id: 'cue-9', at, label: 'Door' })];
})()`), [false, true, true],
'a cue list without the `label` field must not put a name box on a row: one that carries it — even empty — puts the box there');

// The search box: one cue among a show's worth of them, and a state word — "off" — for a parked cue.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => { const box = document.getElementById('timecode-cue-filter'); box.value = 'parked'; box.dispatchEvent(new Event('input')); })()`);
const filteredUi = await evaluate(`(() => ({
  times: Array.from(document.querySelectorAll('#timecode-cue-list .cue-at')).map((node) => node.textContent.trim()),
  count: document.getElementById('timecode-cue-filter-count').textContent.trim(),
  hidden: document.getElementById('timecode-cue-filter-count').hidden,
  status: document.getElementById('timecode-cue-status').textContent.trim(),
  commands: window.__INVOKES.map((entry) => entry.cmd)
    .filter((cmd) => !['timecode_state', 'timecode_pending_cues', 'get_timecode_cues'].includes(cmd)),
}))()`);
assert.deepEqual(filteredUi.times, ['01:00:20:00'],
  `the search box shows only the cues that match (got ${JSON.stringify(filteredUi.times)})`);
assert.equal(filteredUi.count, '1 of 4 shown', `and says how much of the list is on screen (got ${JSON.stringify(filteredUi.count)})`);
assert.equal(filteredUi.hidden, false, 'the count is on screen while a filter is in force');
assert.match(filteredUi.status, /Showing 1 of 4/, `and the page's own status says it (got ${JSON.stringify(filteredUi.status)})`);
assert.deepEqual(filteredUi.commands, [], 'filtering is a view: it reaches no command');
await evaluate(`(() => { const box = document.getElementById('timecode-cue-filter'); box.value = 'off'; box.dispatchEvent(new Event('input')); })()`);
assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#timecode-cue-list .cue-at')).map((node) => node.textContent.trim())`),
  ['01:00:20:00'], 'a state word — “off” — finds a parked cue');
await evaluate(`(() => { const box = document.getElementById('timecode-cue-filter'); box.value = ''; box.dispatchEvent(new Event('input')); })()`);
assert.equal(await evaluate(`document.querySelectorAll('#timecode-cue-list .cue-row').length`), 4, 'and emptying it shows the whole list again');

// **Where the row-editing contracts went.** Undo, Duplicate, the explicit move out of a clash, the lock and the ✎
// editor's four fields and nudge were all contracted here, because this page's rows had the controls. The rows are
// read-only now and those controls are on the LTC window's rows, so their contracts MOVED there
// (`test-desktop-ltc-window-browser.mjs`, section 23) rather than being deleted — a capability that moved with no
// contract behind it is one that can break in silence, which is what this whole change would otherwise have caused.
assert.equal(
  await evaluate(`document.querySelectorAll('#timecode-cue-list .cue-buttons button').length`),
  0,
  'and this page must offer none of them: the row is a line to read, not a control surface',
);
// What just happened: the last cue the engine announced, with the wall-clock time it arrived.
const lastCueUi = await evaluate(`(() => ({
  text: document.getElementById('timecode-cue-last').textContent.trim(),
  hidden: document.getElementById('timecode-cue-last').hidden,
}))()`);
assert.equal(lastCueUi.hidden, false, 'a cue the engine announced is on screen');
// The line now says **which kind of skip** it was. A cue crossed by a move and one crossed while the timecode was gone
// used to read identically, and they are not the same event; the two readings share no wording, so neither can be
// mistaken for the other. The kinds themselves are contracted on the clock window, where the event is driven directly
// (`test-desktop-timecode-clock-browser.mjs`, which asserts both and that they differ). What this pins is that **the
// summary carries the same sentence the clock does** — a summary that dropped the reason would be the old line back
// again, on the surface the operator lands on.
assert.match(lastCueUi.text, /^Last skipped 01:00:30:00 “Curtain” · the position jumped 30\.0 s · \d\d:\d\d:\d\d$/,
  `naming the cue, its position, why it was skipped and the wall-clock time (got ${JSON.stringify(lastCueUi.text)})`);

// A window opened late can be told **how** a cue was spent, not only that it was: the snapshot carries the kind, so
// the row is painted truthfully without this page ever having heard the announcement. `spent_ids` alone could only
// ever say "spent", and this case proves which of the two the page is reading.
await evaluate(`window.__STATE_OVERRIDE = { state: 'running', position: '01:00:45:00', rate: '25', drop_frame: false,
  pieces: 9, positions: 2, source: 'MTC', cues: 5, next_cue_id: null, spent_ids: ['cue-4'], spent_cues: [{ id: 'cue-4', kind: 'skipped' }] }`);
await sleep(600);
const spentKindUi = await evaluate(`Array.from(document.querySelectorAll('#timecode-cue-list .cue-row[data-cue-id="cue-4"] .cue-tag')).map((tag) => tag.textContent.trim())`);
assert.ok(spentKindUi.includes('skipped'),
  `the snapshot's own kind paints the row, with no announcement heard (got ${JSON.stringify(spentKindUi)})`);
assert.ok(!spentKindUi.includes('fired'), `and never invents a fired cue (got ${JSON.stringify(spentKindUi)})`);

// A cue that cannot fire what it names is marked, with the reason — and the mark is only as good as the library
// the window reported: with `macro_library_len: null` the backend judges a cue with no macro only, and says so.
await evaluate(`window.__STATE_OVERRIDE = { state: 'running', position: '01:00:45:00', rate: '25', drop_frame: false,
  pieces: 9, positions: 2, source: 'MTC', cues: 5, next_cue_id: null, spent_ids: [], spent_cues: [],
  cue_health: [{ id: 'cue-2', problem: 'macro_missing', macro_index: 7 }, { id: 'cue-1', problem: null, macro_index: 0 }],
  cues_broken: 1, macro_library_len: 5 }`);
await sleep(600);
const brokenUi = await evaluate(`(() => {
  const row = document.querySelector('#timecode-cue-list .cue-row[data-cue-id="cue-2"]');
  const tag = row?.querySelector('.cue-tag.is-broken');
  return {
    text: tag?.textContent.trim() || '',
    title: tag?.title || '',
    rowClass: Boolean(row?.classList.contains('is-broken')),
    onHealthy: document.querySelectorAll('#timecode-cue-list .cue-row[data-cue-id="cue-1"] .cue-tag.is-broken').length,
  };
})()`);
assert.equal(brokenUi.text, 'broken', `a cue that cannot fire what it names is marked (got ${JSON.stringify(brokenUi)})`);
assert.match(brokenUi.title, /names macro 7, which is not in the library \(the library has 5\)/,
  `and the reason names the macro and the library (got ${JSON.stringify(brokenUi.title)})`);
assert.equal(brokenUi.rowClass, true, 'with the row itself marked, not only a tag');
assert.equal(brokenUi.onHealthy, 0, 'and a cue that is fine carries no such mark');
// And the title is the **whole chain**, not only the reason: the links an operator would check, in order, with each one
// marked. The fixture is a parked cue that also names a macro the library lost — two failures — so this pins that the
// chain shows **both** while the one `problem` field the snapshot carries can only hold the first.
assert.match(brokenUi.title, /The chain when this cue is crossed: ok timecode running/,
  `the chain starts with the clock, which this snapshot says is running (got ${JSON.stringify(brokenUi.title)})`);
assert.match(brokenUi.title, /NO cue enabled/,
  `and marks the parked cue (got ${JSON.stringify(brokenUi.title)})`);
assert.match(brokenUi.title, /NO macro chosen and present/,
  `and the macro the library lost, which the reason alone cannot say (got ${JSON.stringify(brokenUi.title)})`);
assert.match(brokenUi.title, /ok time exists at this rate/,
  `naming the links that are fine as well as the ones that are not (got ${JSON.stringify(brokenUi.title)})`);

// The countdown notices on the card: "in 8 s" and "it is about to fire" are not the same sentence. The state is
// written the way section 32's own helper writes it — declared there, and this block runs before it, so it is written
// out here rather than reached forward for.
await evaluate(`window.__STATE_OVERRIDE = ${JSON.stringify({ state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1,
  source: 'MTC', cues: 4, next_cue: '01:00:16:15', next_cue_frames: 100, next_cue_seconds: 4 })}`);
await sleep(1400);
const cardWarning = await evaluate(`(() => {
  const line = document.getElementById('timecode-card-cue');
  return { text: line.textContent.trim(), warn: line.classList.contains('is-cue-warn') };
})()`);
assert.match(cardWarning.text, /— 5 s to go/, `inside five seconds the card says so (got ${JSON.stringify(cardWarning.text)})`);
assert.equal(cardWarning.warn, true, 'and carries the warning colour as the second signal');

// --- 31c. The cue's number: the name that is said out loud, and never an address --------------------
//
// The number lives inside the cue, so reordering the list never moves it, and it belongs to exactly one cue. What a
// system that triggers cues from outside addresses is the **id**, which renumbering never touches — so the badge's
// own words have to say that, and a duplicate has to arrive without the number of the cue it copied, or the save
// would be refused with "two cues share the number" the moment an operator pressed the copy button.
const NUMBERED_CUES = CUE_LIST.map((cue, index) => ({
  ...cue,
  number: ['', '12', '', '5.5'][index],
  group: ['Act 1', '', 'Act 2', 'Act 2'][index],
}));
// The sort key and the lock list are cleared the same way the main run clears them: the browser suites share one
// Chrome profile, and a sort order or a lock left behind by an earlier run would decide what this one sees.
await evaluate(`localStorage.removeItem('wing_timecode_cue_sort')`);
await evaluate(`localStorage.removeItem('wing_timecode_cue_created_order')`);
await evaluate(`localStorage.removeItem('wing_timecode_cue_locks')`);
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (() => {
      window.__NUMBER_STUB = true;
      window.__INVOKES = [];
      const normalizeCues = ${cueNormalize.toString()};
      let cues = ${JSON.stringify(NUMBERED_CUES)};
      let sort = 'smpte';
      window.__TAURI__ = {
        core: { invoke: async (cmd, args) => {
          window.__INVOKES.push({ cmd, args });
          switch (cmd) {
            case 'get_timecode_cues': return { schema_version: 1, cues, offset_frames: 0, sort };
            case 'set_timecode_cues': cues = (args?.cues?.cues || []).map(normalizeCues); sort = args?.cues?.sort || sort; return { ...args.cues, cues, sort };
            case 'timecode_state': return { state: 'running', position: '01:00:45:00', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: cues.length };
            case 'get_inter_app_settings': return { enabled: false, triggers: [] };
            case 'load_macro_library': return { macros: [{ name: 'Macro A', steps: [] }], selectedIndex: 0 };
            case 'timecode_pending_cues': return [];
            default: return {};
          }
        } },
        event: { listen: async (name, handler) => { (window.__HANDLERS = window.__HANDLERS || {})[name] = handler; return () => {}; } },
        window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, setSize: async () => {}, setPosition: async () => {},
          close: async () => {}, onCloseRequested: async () => () => {}, innerSize: async () => ({ width: 1440, height: 900 }),
          outerPosition: async () => ({ x: 0, y: 0 }) }),
          LogicalSize: class { constructor(w, h) { this.width = w; this.height = h; } },
          LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } } },
      };
    })();
  `,
});
await reloadReadySettingsPage();
for (let attempt = 0; attempt < 200; attempt += 1) {
  if (await evaluate(`Boolean(window.__NUMBER_STUB) && Boolean(document.getElementById('open-settings-btn'))`)) break;
  await sleep(50);
}
await evaluate(`document.getElementById('open-settings-btn').click()`);
// The dialog, then the tab: each click is waited for by the element it produces, because a fixed sleep is a guess
// about how long a 31 000-line document takes.
for (let attempt = 0; attempt < 120; attempt += 1) {
  if (await evaluate(`Boolean(document.querySelector('.settings-nav-item[data-tab="timecode"]'))`)) break;
  await sleep(50);
}
await evaluate(`document.querySelector('.settings-nav-item[data-tab="timecode"]').click()`);
for (let attempt = 0; attempt < 120; attempt += 1) {
  if (await evaluate(`Boolean(window.__NUMBER_STUB) && document.querySelectorAll('#timecode-cue-list .cue-row').length === 4`)) break;
  await sleep(50);
}
const numberedUi = await evaluate(`(() => {
  const row = (id) => document.querySelector('#timecode-cue-list .cue-row[data-cue-id="' + id + '"]');
  return {
    badges: Array.from(document.querySelectorAll('#timecode-cue-list .cue-number')).map((node) => node.textContent.trim()),
    ids: Array.from(document.querySelectorAll('#timecode-cue-list .cue-row')).map((node) => node.dataset.cueId),
    noBadge: row('cue-3').querySelectorAll('.cue-number').length,
    title: row('cue-1').querySelector('.cue-number')?.title || '',
    inputs: document.querySelectorAll('#timecode-cue-list .cue-number-input').length,
  };
})()`);
// The list is laid out by SMPTE here, which the badges follow: cue-1 (01:00:10) has 12, cue-4 (01:00:20, macro 1,
// second in its frame) has 5.5, and cue-3 (01:00:30) has no number at all and therefore no badge.
assert.deepEqual(numberedUi.ids, ['cue-1', 'cue-2', 'cue-4', 'cue-3'],
  `the numbered run is the same list, in the same order (got ${JSON.stringify(numberedUi.ids)})`);
assert.deepEqual(numberedUi.badges, ['12', '5.5'],
  `a number the list carries is shown, and only those (got ${JSON.stringify(numberedUi.badges)})`);
assert.equal(numberedUi.noBadge, 0, 'a cue with no number has no badge, rather than one derived from its place');
assert.equal(numberedUi.inputs, 0,
  `and no row offers a box to change it: the number is set in the LTC window, which is the only editor (got ${numberedUi.inputs})`);
assert.match(numberedUi.title,
  /the name the operator says out loud.*reordering the list.*never moves it.*the cue's id, which renumbering never touches/s,
  `the badge must say what a number is and what a trigger actually addresses (got ${JSON.stringify(numberedUi.title)})`);

// --- 31c-bis. The populated row follows the kit's type scale, and its columns stay aligned (audit U3) -----------
//
// The row used to carry fixed 11 px / 9.5 px text, so the kit's `--meter-scale` never reached it. This measures
// the **computed** sizes against the tokens themselves (a probe resolves each custom property in the same page),
// then grows the scale and checks the text moves with it. It also measures the numbered and unnumbered rows at the
// same time: the badge is a cell some rows do not have, so its track must keep the time in one column at both
// scales, which is the defect the slot was introduced for.
const cueScale = await evaluate(`(() => {
  const probe = (name) => {
    const span = document.createElement('span');
    span.style.fontSize = 'var(' + name + ')';
    document.body.appendChild(span);
    const size = parseFloat(getComputedStyle(span).fontSize);
    span.remove();
    return size;
  };
  const rows = [...document.querySelectorAll('#timecode-cue-list .cue-row')];
  const byId = (id) => rows.find((row) => row.dataset.cueId === id);
  const at = (id) => byId(id)?.querySelector('.cue-at');
  const read = () => ({
    numberedX: at('cue-1')?.getBoundingClientRect().x,
    unnumberedX: at('cue-3')?.getBoundingClientRect().x,
    font: parseFloat(getComputedStyle(at('cue-1')).fontSize),
    tags: parseFloat(getComputedStyle(byId('cue-1').querySelector('.cue-tags')).fontSize),
  });
  const before = read();
  const tokens = { base: probe('--font-base'), xs: probe('--font-xs') };
  document.documentElement.style.setProperty('--meter-scale', '2');
  const after = read();
  document.documentElement.style.removeProperty('--meter-scale');
  return { before, tokens, after };
})()`);
assert.equal(cueScale.before.font, cueScale.tokens.base,
  `the cue's position must be drawn at the kit's --font-base (got ${cueScale.before.font}, token ${cueScale.tokens.base})`);
assert.equal(cueScale.before.tags, cueScale.tokens.xs,
  `and its tags at --font-xs (got ${cueScale.before.tags}, token ${cueScale.tokens.xs})`);
assert.ok(Math.abs(cueScale.before.numberedX - cueScale.before.unnumberedX) < 0.75,
  `a row with a number and a row without one must put the time in the same column (got ${JSON.stringify(cueScale.before)})`);
assert.ok(cueScale.after.font > cueScale.before.font,
  `raising --meter-scale must grow the row's text, not leave it at a fixed size (got ${JSON.stringify(cueScale)})`);
assert.ok(Math.abs(cueScale.after.numberedX - cueScale.after.unnumberedX) < 0.75,
  `and the number track must grow with it, keeping both times aligned (got ${JSON.stringify(cueScale.after)})`);

// **Where the rest of this section went.** The number BOX, its Duplicate and its Renumber are controls of this page's
// rows, and the rows are read-only now: they are on the LTC window's rows, contracted there (section 20 for the field
// and the badge it patches, 19 for Renumber, 23 for Duplicate and the clash move). What stays here is what a SUMMARY
// still shows — the badge and its tooltip — and the canonicalisation this block also asserted (`007` written back as
// `7`) is a **Rust** contract, documented and tested at `timecode.rs:656-686`, so nothing here was its only guard.
assert.equal(
  await evaluate(`document.querySelectorAll('#timecode-cue-list .cue-number-input').length`),
  0,
  'and no row offers a box to change a number: a summary that could edit a cue is the thing this change removed',
);

// --- 31d. The section a cue belongs to: an address for READING, and never a control here ----------
//
// The field is the cue's `group`, and the two windows called it two different words — "group" here and "section" in
// the LTC window, where it is edited from the names the list already carries. With this page a summary, only the
// editing window's word is left, and the divergence resolves itself.
//
// What stays assertable here is what the summary still does with it: the **filter** finds a cue by the section it is
// in, which is a way to read a long list and changes nothing. The box that changed it is on the LTC window's row.
const groupUi = await evaluate(`(() => ({
  inputs: document.querySelectorAll('#timecode-cue-list .cue-group').length,
  datalist: Boolean(document.getElementById('timecode-cue-groups')),
}))()`);
assert.equal(groupUi.inputs, 0, 'no row here offers a box to change the section: it is a line to read, not a control');
assert.equal(groupUi.datalist, false,
  'and the names it used to offer are gone with it: the LTC window computes them from the list it draws');

// The filter still finds a cue by the section it is in, compared as the name is stored. The expectation is read from
// the fixture the stub was given — `Act 1` is one cue, `Act 2` is two — rather than from a count that would have to be
// edited every time the fixture moved.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => { const box = document.getElementById('timecode-cue-filter'); box.value = 'Act 1'; box.dispatchEvent(new Event('input')); })()`);
const groupFilter = await evaluate(`(() => ({
  ids: Array.from(document.querySelectorAll('#timecode-cue-list .cue-row')).map((node) => node.dataset.cueId),
  count: document.getElementById('timecode-cue-filter-count').textContent.trim(),
  commands: window.__INVOKES.map((entry) => entry.cmd).filter((cmd) => !['timecode_state', 'timecode_pending_cues', 'get_timecode_cues'].includes(cmd)),
}))()`);
const expectedActOne = NUMBERED_CUES.filter((cue) => cue.group === 'Act 1').map((cue) => cue.id);
assert.deepEqual(groupFilter.ids.slice().sort(), expectedActOne.slice().sort(),
  `searching a section shows exactly the cues in it (got ${JSON.stringify(groupFilter.ids)})`);
assert.equal(groupFilter.count, `1 of ${NUMBERED_CUES.length} shown`,
  `and says how much of the list is on screen (got ${JSON.stringify(groupFilter.count)})`);
assert.deepEqual(groupFilter.commands, [], 'and searching reaches no command: it is a view of the list, never a filter of the show');
await evaluate(`(() => { const box = document.getElementById('timecode-cue-filter'); box.value = ''; box.dispatchEvent(new Event('input')); })()`);

// The numbered run above left a copy behind on purpose, and the contracts that follow were written against the plain
// four-cue list: they get their own document back, with the same fixture the main run opened with, rather than having
// every count below quietly renumbered. A fixture that is reloaded is cheaper to read than a count that was edited.
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (() => {
      window.__PLAIN_STUB = true;
      window.__INVOKES = [];
      const normalizeCues = ${cueNormalize.toString()};
      let cues = ${JSON.stringify(CUE_LIST)};
      let sort = 'smpte';
      window.__TAURI__ = {
        core: { invoke: async (cmd, args) => {
          window.__INVOKES.push({ cmd, args });
          switch (cmd) {
            case 'get_timecode_cues': return { schema_version: 1, cues, offset_frames: 0, sort };
            case 'set_timecode_cues': cues = (args?.cues?.cues || []).map(normalizeCues); sort = args?.cues?.sort || sort; return { ...args.cues, cues, sort };
            case 'timecode_state': return window.__STATE_OVERRIDE
              || { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: cues.length,
                   next_cue_id: 'cue-1', spent_ids: ['cue-3'], armed_at: '01:00:05:00' };
            case 'get_inter_app_settings': return { enabled: false, triggers: [] };
            case 'load_macro_library': return { macros: [{ name: 'Macro A', steps: [] }, { name: 'Macro B', steps: [] }], selectedIndex: 0 };
            case 'inter_app_midi_ports': return [];
            case 'timecode_pending_cues': return [];
            default: return {};
          }
        } },
        event: { listen: async (name, handler) => { (window.__HANDLERS = window.__HANDLERS || {})[name] = handler; return () => {}; } },
        window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, setSize: async () => {}, setPosition: async () => {},
          close: async () => {}, onCloseRequested: async () => () => {}, innerSize: async () => ({ width: 1440, height: 900 }),
          outerPosition: async () => ({ x: 0, y: 0 }) }),
          LogicalSize: class { constructor(w, h) { this.width = w; this.height = h; } },
          LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } } },
      };
    })();
  `,
});
await reloadReadySettingsPage();
for (let attempt = 0; attempt < 200; attempt += 1) {
  if (await evaluate(`Boolean(window.__PLAIN_STUB) && Boolean(document.getElementById('open-settings-btn'))`)) break;
  await sleep(50);
}
await evaluate(`document.getElementById('open-settings-btn').click()`);
for (let attempt = 0; attempt < 120; attempt += 1) {
  if (await evaluate(`Boolean(document.querySelector('.settings-nav-item[data-tab="timecode"]'))`)) break;
  await sleep(50);
}
await evaluate(`document.querySelector('.settings-nav-item[data-tab="timecode"]').click()`);
for (let attempt = 0; attempt < 120; attempt += 1) {
  if (await evaluate(`Boolean(window.__PLAIN_STUB) && document.querySelectorAll('#timecode-cue-list .cue-row').length === 4`)) break;
  await sleep(50);
}


// The operator's own name for a cue. `get_timecode_cues` draws every cue through one struct, so the key is always
// there — empty for a cue nobody has named — and the box is offered on every row, including the copy the duplicate
// made a moment ago. The "no box for a list that does not carry it" half of this contract is the shared module's own
// `cueHasLabel`, checked where it lives (section 31b) rather than pretended here with a fixture the backend cannot
// send.
// The name BOX is on the LTC window row now (its 'dense-label'), so what this page must show is the name, not a
// way to change it. The 'no box for a list that does not carry it' half is the shared module's own 'cueHasLabel',
// checked where it lives (section 31b) rather than pretended here with a fixture the backend cannot send.
assert.equal(await evaluate(`document.querySelectorAll('#timecode-cue-list .cue-label').length`), 0,
  'a summary must offer no box to rename a cue: the name is set in the LTC window');

const LABELLED_CUES = CUE_LIST.map((cue, index) => ({ ...cue, label: index === 1 ? 'Opening door' : '' }));
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (() => {
      // A marker the test can wait for: without it, a wait for "four cue rows" is satisfied by the **previous** page,
      // which the reload has not replaced yet, and the assertion then measures the stub that was replaced.
      window.__LABEL_STUB = true;
      window.__INVOKES = [];
      const normalizeCues = ${cueNormalize.toString()};
      let cues = ${JSON.stringify(LABELLED_CUES)};
      let sort = 'smpte';
      window.__TAURI__ = {
        core: { invoke: async (cmd, args) => {
          window.__INVOKES.push({ cmd, args });
          switch (cmd) {
            case 'get_timecode_cues': return { schema_version: 1, cues, offset_frames: 0, sort };
            case 'set_timecode_cues': cues = (args?.cues?.cues || []).map(normalizeCues); sort = args?.cues?.sort || sort; return { ...args.cues, cues, sort };
            case 'add_timecode_cue_from_position': return { schema_version: 1, cues, offset_frames: 0, sort };
            case 'add_timecode_cue_at_position':
              if (window.__FAULT_ADD) throw new Error(window.__FAULT_ADD);
              return { schema_version: 1, cues, offset_frames: 0, sort };
            case 'set_timecode_macro_library': return args?.macroCount ?? 0;
            case 'timecode_state': window.__STATE_READ_REV = window.__STATE_REV || 0; return window.__STATE_OVERRIDE
              || { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: cues.length };
            case 'get_inter_app_settings': return { enabled: false, triggers: [] };
            case 'load_macro_library': return { macros: [{ name: 'Macro A', steps: [] }], selectedIndex: 0 };
            case 'inter_app_midi_ports': return [];
            case 'timecode_pending_cues': return [];
            default: return {};
          }
        } },
        event: { listen: async (name, handler) => { (window.__HANDLERS = window.__HANDLERS || {})[name] = handler; return () => {}; } },
        window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, setSize: async () => {}, setPosition: async () => {},
          close: async () => {}, onCloseRequested: async () => () => {}, innerSize: async () => ({ width: 1440, height: 900 }),
          outerPosition: async () => ({ x: 0, y: 0 }) }),
          LogicalSize: class { constructor(w, h) { this.width = w; this.height = h; } },
          LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } } },
      };
    })();
  `,
});
await reloadReadySettingsPage();
await waitForSettingsCondition(`Boolean(window.__LABEL_STUB)`, 'label fixture');
await evaluate(`document.getElementById('open-settings-btn').click()`);
await waitForSettingsCondition(`getComputedStyle(document.getElementById('settings-modal-backdrop')).display === 'flex'`, 'Settings opened through its button');
await evaluate(`document.querySelector('.settings-nav-item[data-tab="timecode"]').click()`);
await waitForSettingsCondition(`document.getElementById('tabpage-timecode').classList.contains('is-active')
  && interAppMidiTimer !== null && document.querySelectorAll('#timecode-cue-list .cue-row').length === 4`, 'visible Timecode page with its poll running');
const labelledUi = await evaluate(`(() => {
  const row = document.querySelector('#timecode-cue-list .cue-row[data-cue-id="cue-1"]');
  const inputs = Array.from(document.querySelectorAll('#timecode-cue-list .cue-label'));
  return {
    inputs: inputs.length,
    name: row?.querySelector('.cue-name')?.textContent.trim() || '',
    otherName: document.querySelector('#timecode-cue-list .cue-row[data-cue-id="cue-2"] .cue-name')?.textContent.trim() || '',
  };
})()`);
assert.equal(labelledUi.inputs, 0, 'and no name box: the row is read here and renamed in the LTC window');
assert.equal(labelledUi.name, 'Opening door', `and the row shows the operator's name (got ${JSON.stringify(labelledUi.name)})`);
// The window tells the backend how long its macro library is, once per change: without it a cue that names a macro
// outside the library cannot be judged at all, and the mark would be a guess.
assert.equal(await evaluate(`window.__INVOKES.find((entry) => entry.cmd === 'set_timecode_macro_library')?.args?.macroCount ?? null`), 1,
  'the window must report its library length, so a cue that names a missing macro can be marked');
assert.equal(labelledUi.otherName, 'Parked',
  `a cue with no name of its own falls back to its note (got ${JSON.stringify(labelledUi.otherName)})`);

// **Where the name-typing and the typed add went.** Both were driven from this page: the name box and the position
// field were controls of its rows and its toolbar, and BOTH have moved to the LTC window — the name is its row's
// `dense-label` (section 23) and the typed add is section 22, which asserts the same three things this block did (the
// text goes to the backend's parser as typed, the field is cleared once the cue exists, and the live position is not
// used as well). The one contract that had no home there is the REFUSAL — the parser's sentence shown unchanged and
// what was typed kept — so it was added to section 22 rather than dropped here.

// --- 32. The cue-delivery line answers "was anything lost?" on this page too ------------------------
//
// The clock window's line is pinned in its own suite; this is the same rule on Settings → Timecode, because that is
// where an operator looks while a show runs. It is hidden in exactly one state — no timecode has ever arrived, so
// there is nothing to count — it is on screen with zeros while timecode runs, and it carries the warning colour only
// when something is unconfirmed or lost. A counter that only appeared after a cue had fired could not answer the
// question it exists for.
const deliveryUi = () => evaluate(`(() => {
  const line = document.getElementById('timecode-cue-delivery');
  return { hidden: line.hidden, text: line.textContent.trim(), trouble: line.classList.contains('is-cue-trouble'),
    readRevision: window.__STATE_READ_REV || 0, modal: getComputedStyle(document.getElementById('settings-modal-backdrop')).display,
    active: document.getElementById('tabpage-timecode').classList.contains('is-active'),
    polling: interAppMidiTimer !== null, visibility: document.visibilityState };
})()`);
/// What the poll is answered with, from the stub's own box: the page keeps one reference to its backend, so this is
/// the seam, and the render below it is the only thing that changes between the cases.
const answerState = (state) => evaluate(`(() => {
  window.__STATE_OVERRIDE = ${JSON.stringify(state)};
  window.__STATE_REV = (window.__STATE_REV || 0) + 1;
  return window.__STATE_REV;
})()`);
async function waitForDelivery(revision, predicate, label) {
  const deadline = Date.now() + 10_000;
  let last;
  do {
    last = await deliveryUi();
    if (last.readRevision >= revision && predicate(last)) return last;
    await sleep(50);
  } while (Date.now() < deadline);
  throw new Error(`Timecode delivery did not consume/render ${label}: ${JSON.stringify(last)}`);
}

const runningRevision = await answerState({ state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: 4 });
const deliveryRunning = await waitForDelivery(runningRevision, row => !row.hidden && /Cues fired: 0/.test(row.text) && !row.trouble, 'running with zero deliveries');
assert.equal(deliveryRunning.hidden, false, 'while timecode runs the delivery line is on screen');
assert.match(deliveryRunning.text, /Cues fired: 0 · executed: 0 · awaiting outcome: 0/,
  `with zeros, which both answers "was anything lost?" and proves the counter is alive (got ${JSON.stringify(deliveryRunning.text)})`);
assert.equal(deliveryRunning.trouble, false, 'and zeros are not a warning');

const troubleRevision = await answerState({ state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC',
  cues: 4, cues_fired: 3, cues_delivered: 2, fired_unconfirmed: 1, deliveries_deferred: 1, deliveries_lost: 0 });
const deliveryTrouble = await waitForDelivery(troubleRevision, row => !row.hidden && /awaiting outcome: 1/.test(row.text) && row.trouble, 'an unconfirmed delivery');
assert.equal(deliveryTrouble.hidden, false, 'a cue the window has not confirmed keeps the line on screen');
assert.match(deliveryTrouble.text, /awaiting outcome: 1/, `naming what is outstanding (got ${JSON.stringify(deliveryTrouble.text)})`);
assert.equal(deliveryTrouble.trouble, true, 'and an unconfirmed order is the one case that carries the warning colour');

const nothingRevision = await answerState({ state: 'nothing', pieces: 0, positions: 0, source: 'MTC' });
const deliveryNothing = await waitForDelivery(nothingRevision, row => row.hidden && row.text === '', 'no incoming timecode');
assert.equal(deliveryNothing.hidden, true,
  'with no timecode at all — and nothing counted — the line is out of the page: there is nothing it could say');
assert.equal(deliveryNothing.text, '', 'and it renders no counters rather than an empty box');

} finally {
  socket.close();
}

// The UI does not name the period look: it speaks of Light and Dark, and the meter style is "Task
// History Graph". This is checked against the code of both windows, where the references lived.
import { readFileSync } from "node:fs";
for (const file of ["desktop/ui/index.html", "desktop/ui/meters.html", "desktop/ui/timecode.html"]) {
  const html = readFileSync(file, "utf8");
  assert.doesNotMatch(html, /Win95|Windows 95/,
    `${file}: no window may name the period look (use Light/Dark and "Task History Graph")`);
}
console.log("desktop ui naming contracts passed");

// Two things that broke and are easy to repeat:
//   1. The meters style was linked between windows (the workstation also wrote the bridge's key and
//      the bridge listened to its own), so changing one changed the other.
//   2. The bank selector did not filter: the render used the whole watchlist instead of `visibleMeters()`.
const appHtml = readFileSync("desktop/ui/index.html", "utf8");
assert.doesNotMatch(appHtml, /setItem\("wing_meters_style"/,
  "the workstation window must not write the Meter Bridge's style key: each window has its own");
assert.match(appHtml, /const itemsWithValues = visibleMeters\(\)\.map/,
  "the meters render must use visibleMeters(), which is what applies the active bank's filter");
assert.doesNotMatch(appHtml, /const itemsWithValues = customMetersWatchlist\.map/,
  "and not the whole watchlist: with that, picking a bank changed nothing");
console.log("desktop meter independence contracts passed");

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
