// The macro library while a show is running (master plan 2026-09-22, §8, items 27 and 28).
//
// Two things took the list out from under the operator's hands and mixed one macro's numbers with
// another's:
//
//   27. `renderMacroLibrary()` was called from the macro-runtime event path. It empties
//       `#macro-library-list` and builds every row again, so every event of a running show threw the
//       scroll position back to the top and deleted whatever was being edited inside a row.
//   28. The counters were read positionally (`macroRuntime['macro-' + (index + 1)]`) while the runtime
//       writes them under the id the **backend** assigns, which counts only the enabled macros: with a
//       disabled row in between, a macro read its neighbour's counters. The map was also never
//       cleared, so a deleted macro's numbers could come back with the next macro that reused the id.
//
// Hand-off note (2026-09-27), resolved: the suite booted the window, seeded its library and then died on
// `the window must listen for macro runtime events` — the injected `window.__TAURI__.event.listen` stub
// never received a call. The cause was in this file: `core.invoke` was `null`, and the window decides
// with `hasTauri = Boolean(window.__TAURI__?.core?.invoke)`, so it bound its **own** no-op listener and
// the injected one was never used. The IPC half now answers the two commands the window asks for while
// it boots (`load_macro_library`, `target_catalog`), which puts the window on its Tauri path and makes
// this seam live. The checks below are the measurement for items 27 and 28 (the row is patched in place
// and the counters follow the macro's id) and must not be deleted.
//
// This suite drives the real listener through the same `window.__TAURI__.event.listen` seam the other
// suites use. It needs Chrome on the debug port; without it, it skips with a note.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const INDEX_URL = new URL('../desktop/ui/index.html', import.meta.url).href;

let page;
try {
  // A tab of its own: the suites share the port and the profile, and attaching to "the first
  // index.html tab" let a tab another suite had left behind decide what this one saw.
  page = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${INDEX_URL}`, { method: 'PUT' })).json();
} catch (_) {
  console.log(`skipped: No Chrome listening on ${DEBUG_PORT} (see AGENTS.md)`);
  process.exit(3);
}
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
socket.on('message', (data) => {
  const response = JSON.parse(data);
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  if (response.error) request.reject(new Error(response.error.message));
  else request.resolve(response.result);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}
// The window's own dialogs are answered the way an operator would: the app never uses the native
// `confirm()` (it is a dead path in WKWebView), so a test that leaves one open blocks itself.
async function answerDialog() {
  return evaluate(`(() => {
    const dialog = document.getElementById('win95-confirm');
    if (dialog && getComputedStyle(dialog).display !== 'none') {
      const accept = document.getElementById('win95-confirm-accept');
      if (accept) { accept.click(); return true; }
    }
    return false;
  })()`);
}

await call('Page.enable');
// The visible tab, not a background one: Chrome throttles a hidden tab's timers to seconds.
await call('Page.bringToFront');
// The IPC half answers what the window asks for while it boots, so the window takes its **Tauri** path
// and binds `listen` to the stub below. Leaving `invoke` null is why this suite could not see a single
// runtime event: `hasTauri` is `Boolean(window.__TAURI__?.core?.invoke)`, so the window bound its own
// no-op listener instead and the injected one was never called.
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__LISTENERS = {};
    // The library the stub answers with, and the one it keeps: this suite replaces the library
    // wholesale before it measures anything, and a save_macro_library that answered an empty object
    // left macroLibrary.macros undefined for every check after it (the window assigns the command's
    // answer straight to macroLibrary). The mock below is the window's own standalone fallback,
    // copied so the shapes are the window's.
    const MOCK_LIBRARY = {
      schemaVersion: 1,
      selectedIndex: 0,
      macros: [
        {
          name: 'VOX ALL FILTER ON', enabled: false, courtesyNotice: true, colorTag: 'none',
          triggerCategory: 'usb', triggerIds: '1', triggerParameter: 'meters', triggerOperator: 'gt',
          triggerThreshold: 12, targetCategory: 'channel', actionAddress: '/ch/1/mute', actionValue: 1,
          actionSteps: [{ id: 'step-1', enabled: true, title: 'Mute Vox 1', targetCategory: 'channel', actionAddress: '/ch/1/mute', actionValue: 1 }],
        },
        {
          name: 'VOX MARINA SWAP', enabled: true, courtesyNotice: false, colorTag: 'green',
          triggerCategory: 'usb', triggerIds: '46', triggerParameter: 'meters', triggerOperator: 'gt',
          triggerThreshold: 12, targetCategory: 'channel', actionAddress: '/ch/2/mute', actionValue: 0,
          actionSteps: [{ id: 'step-1', enabled: true, title: 'Unmute Marina', targetCategory: 'channel', actionAddress: '/ch/2/mute', actionValue: 0 }],
        },
      ],
    };
    let savedLibrary = null;
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        window.__INVOKES = window.__INVOKES || [];
        window.__INVOKES.push({ cmd: command, args });
        // The window asks for the session once at start-up: the backend's own answer, with no health
        // at all because nothing is running in this tab. That null is the point of the check below.
        if (command === 'get_stream_state') {
          return {
            state: 'idle', message: '', sessionActive: false, sessionId: 0,
            deskModel: null, deskModelKnown: false, liveSafeMode: false,
            health: null, meterSources: [], metersWindowOpen: false, lastAlert: null,
          };
        }
        if (command === 'load_macro_library') {
          return JSON.parse(JSON.stringify(savedLibrary || MOCK_LIBRARY));
        }
        if (command === 'save_macro_library') {
          savedLibrary = args && args.library ? args.library : null;
          return JSON.parse(JSON.stringify(savedLibrary || MOCK_LIBRARY));
        }
        if (command === 'target_catalog') return { categories: {}, targetParametersByCategory: {}, triggerParametersByCategory: {} };
        return {};
      } },
      event: {
        listen: async (event, handler) => {
          window.__LISTENERS[event] = handler;
          return () => {};
        },
      },
    };
  `,
});
await call('Page.navigate', { url: INDEX_URL });
// The window wires its listeners late in the boot (the library comes from the backend/mock and the
// blocks are built after it), so the wait is for the listener itself and not for the first row: a
// suite that stopped at the rows read the counters before the runtime could ever publish one.
for (let attempt = 0; attempt < 200; attempt += 1) {
  const ready = await evaluate(`document.readyState === "complete"
    && Boolean(document.querySelector(".macro-rename-button"))
    && typeof (window.__LISTENERS || {})["macro-runtime-event"] === "function"`);
  if (ready) break;
  await sleep(150);
}
assert.equal(await evaluate('typeof window.__TAURI__'), 'object', 'the stub must own the event seam');
assert.equal(
  await evaluate('typeof (window.__LISTENERS || {})["macro-runtime-event"]'),
  'function',
  'the window must listen for macro runtime events',
);

// --- Pin what this suite depends on -----------------------------------------------------------------
// The Chrome profile is shared between suites, so nothing may be assumed about the state a previous
// run left behind (a filter or a selection of another suite decided this one's result before). The
// library itself is pinned through the stub's own `load_macro_library`; what lives in storage is
// pinned here, and every value is put back at the end of the run.
const preferencesTouched = ['wing_theme', 'wing_dock_matrix_pos'];
const previousPreferences = await evaluate(`(() => {
  const keys = ${JSON.stringify(preferencesTouched)};
  const out = {};
  keys.forEach((key) => { out[key] = window.localStorage.getItem(key); });
  return out;
})()`);
await evaluate(`(() => {
  // The light theme is what the window's own mocks and the other suites expect.
  window.localStorage.setItem('wing_theme', 'light');
  // A previous suite may have left the dock's channel-matrix dialog somewhere the operator's
  // viewport is not; it must not decide where this one's rows are.
  window.localStorage.removeItem('wing_dock_matrix_pos');
})()`);

// --- Setup: a library long enough to scroll, with a disabled row between two enabled ones --------
// The disabled row is what tells the positional key from the real one: the backend numbers only the
// enabled macros, so with row 1 disabled the second enabled macro is `macro-2` and *not* the macro at
// library index 2.
const seeded = await evaluate(`(async () => {
  const library = macroLibrary && Array.isArray(macroLibrary.macros) ? macroLibrary.macros : null;
  if (!library || library.length === 0) return { error: 'the window has no macro library to seed from' };
  const base = library[library.length - 1];
  const macros = [];
  for (let i = 0; i < 30; i += 1) {
    macros.push({
      ...JSON.parse(JSON.stringify(base)),
      name: 'Row ' + (i + 1),
      enabled: false,
      courtesyNotice: false,
    });
  }
  macroLibrary = { schemaVersion: 1, selectedIndex: 0, macros };
  await saveMacroLibraryState('test_seed_rows');
  const list = document.getElementById('macro-library-list');
  list.scrollTop = 0;
  return {
    rows: list.children.length,
    library: macroLibrary.macros.length,
    tagged: list.querySelectorAll('[data-macro-id]').length,
    firstChild: (list.firstElementChild ? list.firstElementChild.className : '') + '|' + (list.textContent || '').slice(0, 60),
    scrollable: list.scrollHeight > list.clientHeight + 40,
  };
})()`);
assert.ok(!seeded.error, seeded.error || '');
assert.equal(seeded.rows, 30,
  `the library must show every seeded macro (library ${seeded.library}, tagged rows ${seeded.tagged}, first child "${seeded.firstChild}")`);
assert.ok(seeded.scrollable, 'the seeded library must be long enough to scroll, or item 27 cannot be measured');

// Two enabled macros separated by a disabled one: library rows 1 and 3, which the backend compiles as
// macro-1 and macro-2.
const ids = await evaluate(`(async () => {
  macroLibrary.macros[0].enabled = true;
  macroLibrary.macros[2].enabled = true;
  await saveMacroLibraryState('test_enable_first_and_third');
  const rows = Array.from(document.querySelectorAll('.macro-row'));
  return {
    disabledRowId: rows[1].dataset.macroId,
    first: { id: rows[0].dataset.macroId, name: rows[0].querySelector('.step-title').textContent },
    third: { id: rows[2].dataset.macroId, name: rows[2].querySelector('.step-title').textContent },
  };
})()`);
assert.equal(ids.first.id, 'macro-1', "the first enabled macro is the backend's macro-1");
assert.equal(ids.third.id, 'macro-2', 'the next enabled macro is macro-2: the disabled row consumes no id');
assert.equal(ids.disabledRowId, '', 'an id must not be invented for a disabled row');

// --- 27. A runtime event must not rebuild the list ----------------------------------------------
const duringShow = await evaluate(`(() => {
  const list = document.getElementById('macro-library-list');
  const rowBefore = Array.from(document.querySelectorAll('.macro-row')).find((row) => row.dataset.macroId === 'macro-2');
  const renameButton = rowBefore.querySelector('.macro-rename-button');
  renameButton.click();
  const editing = rowBefore.querySelector('.macro-inline-name');
  editing.value = 'Half typed name';
  editing.focus();
  // Scrolled last, and read straight back: opening the inline editor is a DOM change and the window's
  // observers repaint the list, which is exactly why the readback is part of the measurement.
  list.scrollTop = list.scrollHeight;
  const scrollBefore = { top: list.scrollTop, max: list.scrollHeight - list.clientHeight };
  (window.__LISTENERS['macro-runtime-event'])({ payload: {
    macroId: 'macro-2', macroName: ${JSON.stringify(ids.third.name)}, running: true, queued: false,
    dropped: 3, restarted: 1, completed: 7, completedUnconfirmed: 2, failed: 0,
    lastEvent: 'started', lastMessage: '',
  } });
  // While the inline editor is open the row is deliberately left as it is: the counters catch up on
  // the next event, so the measurement of the row's node and of the edit is taken here.
  const listAfter = document.getElementById('macro-library-list');
  const rowAfter = Array.from(document.querySelectorAll('.macro-row')).find((row) => row.dataset.macroId === 'macro-2');
  const editingAfter = document.querySelector('.macro-inline-name');
  const whileEditing = {
    sameRowNode: rowBefore === rowAfter,
    scrollBefore,
    scrollAfter: { top: listAfter.scrollTop, max: listAfter.scrollHeight - listAfter.clientHeight },
    editingValue: editingAfter ? editingAfter.value : null,
    editingFocused: Boolean(editingAfter) && document.activeElement === editingAfter,
    line: rowAfter ? rowAfter.querySelector('.step-meta').textContent : null,
  };
  // The rename is closed (Escape) and the next event of the same macro must now paint the counters.
  if (editingAfter) editingAfter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const closed = !document.querySelector('.macro-inline-name');
  (window.__LISTENERS['macro-runtime-event'])({ payload: {
    macroId: 'macro-2', macroName: ${JSON.stringify(ids.third.name)}, running: false, queued: false,
    dropped: 3, restarted: 1, completed: 7, completedUnconfirmed: 2, failed: 0,
    lastEvent: 'completed', lastMessage: '',
  } });
  const painted = Array.from(document.querySelectorAll('.macro-row')).find((row) => row.dataset.macroId === 'macro-2');
  return {
    sameRowNode: whileEditing.sameRowNode,
    scrollBefore: whileEditing.scrollBefore,
    scrollAfter: whileEditing.scrollAfter,
    editingSurvived: whileEditing.editingValue === 'Half typed name' && whileEditing.editingFocused,
    lineWhileEditing: whileEditing.line,
    renameClosed: closed,
    counters: painted ? painted.querySelector('.step-meta').textContent : null,
    title: painted ? painted.querySelector('.macro-select-button').title : null,
    firstMacroLine: document.querySelector('.macro-row[data-macro-id="macro-1"] .step-meta').textContent,
  };
})()`);
assert.equal(duringShow.sameRowNode, true,
  'the row must be the same DOM node after a runtime event: a rebuild replaces it (item 27)');
assert.ok(duringShow.scrollBefore.max > 40 && duringShow.scrollBefore.top === duringShow.scrollBefore.max,
  `the list must really be scrolled to its bottom before the event, or the scroll cannot be measured (got ${JSON.stringify(duringShow.scrollBefore)})`);
assert.equal(duringShow.scrollAfter.top, duringShow.scrollBefore.top,
  `the scroll position must survive a runtime event (was ${duringShow.scrollBefore.top}/${duringShow.scrollBefore.max}, now ${duringShow.scrollAfter.top}/${duringShow.scrollAfter.max})`);
assert.equal(duringShow.editingSurvived, true,
  'an inline rename in progress must survive a runtime event (item 27)');
assert.equal(duringShow.renameClosed, true,
  'the inline rename must close on Escape so the row can be repainted');
// The row the operator is editing is left alone on purpose: the line must not change under the
// caret. That is the difference between "the list is patched" and "the list is rebuilt".
assert.ok(!/dropped 3/.test(duringShow.lineWhileEditing || ''),
  `a row being renamed must not have its line rewritten under the caret, got ${JSON.stringify(duringShow.lineWhileEditing)}`);
console.log('27. In place:', JSON.stringify({
  sameRowNode: duringShow.sameRowNode,
  scroll: `${duringShow.scrollAfter.top}/${duringShow.scrollAfter.max}`,
  editingSurvived: duringShow.editingSurvived,
  renameClosed: duringShow.renameClosed,
}));

// --- 28. The counters belong to the macro the backend named -------------------------------------
assert.match(duringShow.counters, /dropped 3 .* completed 7 .* unconfirmed 2/,
  `the counters of macro-2 must be the ones published for macro-2, got ${JSON.stringify(duringShow.counters)}`);
assert.match(duringShow.title, /dropped 3/,
  `the row tooltip must repeat the counters of its own macro, got ${JSON.stringify(duringShow.title)}`);
assert.ok(!/dropped 3/.test(duringShow.firstMacroLine || ''),
  `macro-1 must not show macro-2's counters, got ${JSON.stringify(duringShow.firstMacroLine)}`);
// The disabled row of the library has no runtime id at all: what arrives for an id no enabled row
// computes must not be painted on somebody else's row.
const disabledRowLine = await evaluate(`document.querySelectorAll('.macro-row')[1].querySelector('.step-meta').textContent`);
assert.ok(!/dropped 3/.test(disabledRowLine),
  `the disabled row must not borrow the counters, got ${JSON.stringify(disabledRowLine)}`);

// Opening a rename and leaving it open is part of the check above; the half-typed editor is closed
// here so the rest of the run starts from a clean row.
await evaluate(`(() => {
  const input = document.querySelector('.macro-inline-name');
  if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
})()`);

// Reordering the library must not move the counters with the position: they follow the macro's id.
const afterReorder = await evaluate(`(async () => {
  const list = document.getElementById('macro-library-list');
  list.scrollTop = 0;
  document.querySelector('.macro-row[data-macro-id="macro-2"] .macro-select-button').click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  document.getElementById('library-move-up').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const rows = Array.from(document.querySelectorAll('.macro-row'));
  return {
    lines: rows.slice(0, 3).map((row) => ({
      id: row.dataset.macroId,
      title: row.querySelector('.step-title').textContent,
      meta: row.querySelector('.step-meta').textContent,
    })),
  };
})()`);
for (const line of afterReorder.lines) {
  if (line.id === 'macro-2') {
    assert.match(line.meta, /dropped 3/,
      `after the reorder macro-2 must keep its own counters, got ${JSON.stringify(line.meta)}`);
  } else {
    assert.ok(!/dropped 3/.test(line.meta),
      `${line.id || line.title} must not inherit macro-2's counters, got ${JSON.stringify(line.meta)}`);
  }
}
console.log('28. Counters follow the id:', JSON.stringify(afterReorder.lines.map((line) => `${line.id || '(none)'}:${/dropped 3/.test(line.meta)}`)));

// A runtime event for an id no enabled row carries paints nothing, and is no excuse to rebuild either.
const unknownId = await evaluate(`(() => {
  const list = document.getElementById('macro-library-list');
  list.scrollTop = list.scrollHeight;
  const before = list.scrollTop;
  const rowsBefore = list.children.length;
  (window.__LISTENERS['macro-runtime-event'])({ payload: {
    macroId: 'macro-9', macroName: 'gone', running: false, queued: false, lastEvent: 'completed',
    dropped: 0, restarted: 0, completed: 1, completedUnconfirmed: 0, failed: 0, lastMessage: '',
  } });
  return { scrollKept: list.scrollTop === before, rowsBefore, rowsAfter: list.children.length };
})()`);
assert.equal(unknownId.rowsAfter, unknownId.rowsBefore,
  'an event for an unknown id must not rebuild the list either (item 27)');
assert.equal(unknownId.scrollKept, true, 'and must not move the scroll position');

// --- 28. Deleting a macro clears its counters ---------------------------------------------------
// The id of the deleted macro must leave the map: the backend reuses `macro-<n>` for whatever macro
// happens to be the n-th enabled one afterwards, and the deleted macro's history must not come back
// as the new one's.
const beforeDelete = await evaluate(`(() => ({
  selectedName: macroLibrary.macros[macroLibrary.selectedIndex].name,
  hasRuntime: Object.prototype.hasOwnProperty.call(macroRuntime, 'macro-2'),
}))()`);
assert.equal(beforeDelete.hasRuntime, true, 'macro-2 must be in the runtime map before the deletion');
assert.equal(beforeDelete.selectedName, 'Row 3', 'macro-2 is the macro named "Row 3"');
const afterDelete = await evaluate(`(async () => {
  // A stale entry of a macro that does not exist (a library a previous session left behind, or an id
  // the backend reused): clearing what a deletion removes has to take this with it too.
  macroRuntime['macro-9'] = { macroId: 'macro-9', lastEvent: 'completed', dropped: 0, restarted: 0, completed: 1, completedUnconfirmed: 0, failed: 0 };
  document.getElementById('library-delete').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const dialog = document.getElementById('win95-confirm');
  if (dialog && getComputedStyle(dialog).display !== 'none') {
    document.getElementById('win95-confirm-accept').click();
  }
  await new Promise((resolve) => setTimeout(resolve, 900));
  return {
    hasDeletedRuntime: Object.prototype.hasOwnProperty.call(macroRuntime, 'macro-2'),
    hasStaleRuntime: Object.prototype.hasOwnProperty.call(macroRuntime, 'macro-9'),
    rowsShowingStale: Array.from(document.querySelectorAll('.macro-row'))
      .filter((row) => /completed 1 .*unconfirmed 0/.test(row.querySelector('.step-meta')?.textContent || '')).length,
    macroCount: macroLibrary.macros.length,
    macroNames: macroLibrary.macros.slice(0, 4).map((macro) => macro.name),
  };
})()`);
await answerDialog();
assert.equal(afterDelete.macroCount, 29, `the deletion must remove one macro, got ${afterDelete.macroCount}`);
assert.ok(!afterDelete.macroNames.includes('Row 3'),
  `the deleted macro must be gone, got ${JSON.stringify(afterDelete.macroNames)}`);
assert.equal(afterDelete.hasDeletedRuntime, false,
  'the counters of a deleted macro must leave the runtime map (item 28: it was never cleared)');
assert.equal(afterDelete.hasStaleRuntime, false,
  'an entry for an id no macro computes must not survive a rebuild (item 28: the map used to grow all session)');
assert.equal(afterDelete.rowsShowingStale, 0,
  `no row may paint the counters of a macro that is gone, got ${afterDelete.rowsShowingStale} row(s)`);

// Put the shared profile back as it was found, exactly as the theme-pinning suites do: the next
// suite decides its own state instead of inheriting this one's.
await evaluate(`(() => {
  const previous = ${JSON.stringify(previousPreferences)};
  Object.keys(previous).forEach((key) => {
    if (previous[key] === null || previous[key] === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, previous[key]);
  });
})()`).catch(() => {});

// --- The window takes its session from the backend, not from the events it missed -----------------
// `reconcileStreamState()` asks `get_stream_state` once at start-up (master plan 2026-09-22 §5.2 item
// 17). The answer is the *backend's* truth: with no session live it carries `health: null`, and the
// window must empty the grid rather than keep whatever a previous session left on screen. The stub
// answers `health: null`, which is what a window opened while nothing is running really gets.
const reconciled = await evaluate(`(async () => {
  const before = {
    offlineBadge: document.getElementById('osc-live-badge')?.textContent || '',
    rate: document.getElementById('health-rate')?.textContent || '',
  };
  const asked = (window.__INVOKES || []).some((entry) => entry.cmd === 'get_stream_state');
  await reconcileStreamState();
  return {
    asked,
    state: streamMode,
    badge: document.getElementById('osc-live-badge')?.textContent || '',
    rate: document.getElementById('health-rate')?.textContent || '',
    hits: document.getElementById('health-hits')?.textContent || '',
    gridTitle: document.querySelector('.health-grid')?.title || '',
    collapsed: document.getElementById('diagnostics-collapsed-summary')?.textContent || '',
    before,
  };
})()`);
assert.equal(reconciled.asked, true, 'the window must ask the backend for the session state');
assert.equal(reconciled.state, 'idle', `no session is live in this stub, so the window must be idle (got ${reconciled.state})`);
assert.equal(reconciled.rate, '\u2013',
  `a backend answer with no live session must empty the health rows, got ${JSON.stringify(reconciled.rate)}`);
assert.equal(reconciled.hits, '\u2013',
  `the evaluation counter must be emptied too, got ${JSON.stringify(reconciled.hits)}`);
assert.match(reconciled.gridTitle, /No stream is running/,
  `the grid must say why it is empty, got ${JSON.stringify(reconciled.gridTitle)}`);
assert.match(reconciled.collapsed, /stale/,
  `the collapsed summary must say the numbers are stale, got ${JSON.stringify(reconciled.collapsed)}`);
console.log('D. session taken from the backend:', JSON.stringify({ asked: reconciled.asked, state: reconciled.state, rate: reconciled.rate }));

socket.close();
console.log('desktop macro runtime row contracts passed');

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
