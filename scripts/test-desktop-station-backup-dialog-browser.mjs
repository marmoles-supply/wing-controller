// Exercises the station backup end to end against the mock backend: saving (with the panel, without
// the panel and with the fallback) and restoring through the webview file picker.
//
// Why this test exists: the previous version asked the plugin for the panel **over IPC** and, if the
// call failed, it fell silently to a download that writes nothing in the packaged app. Worse: the macOS
// panel may never answer at all (it is a *sheet* whose completion handler does not always arrive), and
// then the `invoke` neither resolves nor rejects. Saving now has three paths and the operator always
// ends up knowing where the backup went.
//
// It checks:
//   1. Saving with the panel: it is asked for with the show name and the payload carries the ticked
//      sections; the report says where it went and "Show in Finder" opens the Finder.
//   2. Cancelling in the panel: there is no report and it is recorded.
//   3. Panel failure: the command returns the fallback (the backup folder) and the report says so.
//   4. Save failure: the reason is shown (no silence at all).
//   5. The show name names the file (with no accents or odd characters) and travels INSIDE the
//      file as metadata, together with the sections it carries and the date: loading it brings it back.
//   6. The folder button remembers the chosen folder.
//   7. Restoring: the webview file picker, the section picker with what the file carries, only what is
//      ticked is applied, and when the window comes back it REPORTS what was restored.
//
// It needs Chrome with `--remote-debugging-port=9223`.
//
// Run: node scripts/test-desktop-station-backup-dialog-browser.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const currentVersion = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8')).version;

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
  if (response.error) {
    try {
      request.reject(new Error(response.error.message));
    } catch (_) { /* a reply with nobody waiting for it: the window navigated */ }
  } else {
    request.resolve(response.result);
  }
});
const call = (method, params = {}) => {
  const promise = new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  // A restore navigates the window while the test is still asking it things: the request the
  // navigation kills is rejected with "Inspected target navigated or closed", and if that rejection
  // lands between two awaits it would take the whole process down. The awaiter still sees it.
  promise.catch(() => {});
  return promise;
};
// A restore reloads the window, and a CDP reply in flight when it does is lost: the rejected promise
// nobody awaits any more is not a test failure (an assertion still fails if something is wrong), but it
// brought the process down and broke the gate. Declared inert, as the sibling backup test does.
process.on('unhandledRejection', () => {});
async function evaluate(expression) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    } catch (error) {
      // Retried once when the reply was lost to the navigation; a real fault still fails the assertion
      // that reads the value.
      if (attempt === 1) throw error;
      await sleep(300);
    }
  }
  return undefined;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await call('Page.enable');
// A fake but programmable backend: the test decides what each command answers and the list of calls is
// kept, which is what makes it possible to check what was asked and with what.
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__CALLS = [];
    window.__REPLIES = {};
    window.__FAILS = [];
    window.__REJECTS = {};
    window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          window.__CALLS.push({ cmd, args: args === undefined ? null : args });
          if (Object.prototype.hasOwnProperty.call(window.__REJECTS, cmd)) throw window.__REJECTS[cmd];
          if (window.__FAILS.includes(cmd)) throw new Error('mock failure for ' + cmd);
          // The two commands the restore uses to rebuild the Meter Bridge are recorded in the store
          // because the window navigates away right afterwards and the in-page call list goes with it.
          if (cmd === 'close_meters_window' || cmd === 'open_meters_window') {
            try {
              const relay = JSON.parse(localStorage.getItem('wing_test_meters_relay') || '[]');
              relay.push(cmd);
              localStorage.setItem('wing_test_meters_relay', JSON.stringify(relay));
            } catch (_) {}
          }
          if (Object.prototype.hasOwnProperty.call(window.__REPLIES, cmd)) return window.__REPLIES[cmd];
          if (cmd === 'save_station_backup') return { path: '/tmp/test-before-restore.wcz' };
          if (cmd === 'target_catalog') return typeof targetCatalogFallback !== 'undefined' ? targetCatalogFallback : { categories: [] };
          if (cmd === 'load_macro_library') return { schemaVersion: 1, selectedIndex: 0, macros: [] };
          // The cue list lives in its own file: the window reads it once when the backup carries it, and writes it
          // back through its own command when a restore does. Both are recorded, because what the operator is told
          // their backup holds has to be what the file really carries.
          if (cmd === 'get_timecode_cues') return window.__CUE_LIST_REPLY || { schema_version: 1, cues: [], offset_frames: 0, sort: 'smpte' };
          if (cmd === 'set_timecode_cues') {
            window.__CUE_WRITES = window.__CUE_WRITES || [];
            window.__CUE_WRITES.push(args?.cues || null);
            return args?.cues || { schema_version: 1, cues: [], offset_frames: 0, sort: 'smpte' };
          }
          if (cmd === 'is_meters_window_open') return false;
          if (cmd === 'default_show_runner_config' || cmd === 'load_show_runner_config') {
            return { name: 'New WING macro', wingIp: '192.168.1.10', triggerCategory: 'usb', triggerIds: '1',
              triggerParameter: 'meter', triggerOperator: '>', triggerEdgeMode: 'on', triggerThreshold: -18,
              conditions: [], enabled: false, armed: false, actionSteps: [] };
          }
          if (cmd === 'ensure_backup_folder') return args?.folder || '/Users/operator/Documents/WING CONTROLLER shows';
          if (cmd === 'save_macro_library') return args?.library ?? { macros: [] };
          if (cmd === 'save_show_runner_config') return args?.config ?? {};
          return {};
        },
      },
      event: { listen: async () => () => {} },
      window: {
        getCurrentWindow: () => ({
          onCloseRequested: async (handler) => {
            window.__CLOSE_HANDLERS = window.__CLOSE_HANDLERS || [];
            window.__CLOSE_HANDLERS.push(handler);
          },
          show: async () => {},
          setFocus: async () => {},
          close: async () => {},
        }),
      },
    };
  `,
});
const uiDir = new URL('../desktop/ui/', import.meta.url);
await call('Page.navigate', { url: new URL('index.html', uiDir).href });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && typeof renderBars === "function"')) break;
  await sleep(100);
  if (attempt === 59) assert.fail('index.html must finish booting');
}

// The Backup panel lives in the "Profiles & Backup" tab (that is the real identifier).
await evaluate(`document.getElementById('open-settings-btn').click()`);
await sleep(250);
await evaluate(`document.querySelector('.settings-nav-item[data-tab="profiles"]')?.click()`);
await sleep(150);
const tabReady = await evaluate(`(() => {
  const panel = document.getElementById('btn-export-station-backup');
  if (!panel) return { found: false };
  const tab = panel.closest('.win95-tabpage');
  return { found: true, tabId: tab?.id || '', active: tab?.classList.contains('is-active') || false };
})()`);
assert.ok(tabReady.found, 'the Backup panel must exist');
assert.equal(tabReady.active, true, `the Backup tab must be the one on screen (got ${tabReady.tabId})`);

// Isolation: an earlier run may have left the "Backup restored" report pending, and that
// report only appears at startup (that is its behaviour). It is waited for, closed and cleared.
await sleep(1300);
await evaluate(`(() => {
  localStorage.removeItem('wing_backup_last_restore');
  if (document.getElementById('win95-confirm')?.style.display === 'flex') {
    document.getElementById('win95-confirm-accept')?.click();
  }
})()`);
await sleep(200);

const tickScopes = (scopes) => evaluate(`(() => {
  document.querySelectorAll('.station-backup-scope').forEach((input) => { input.checked = ${JSON.stringify(scopes)}.includes(input.value); });
  return Array.from(document.querySelectorAll('.station-backup-scope')).filter((i) => i.checked).map((i) => i.value);
})()`);

const readAndCloseConfirm = `(() => {
  const visible = document.getElementById('win95-confirm')?.style.display === 'flex';
  const title = document.getElementById('win95-confirm-title')?.textContent || '';
  const message = document.getElementById('win95-confirm-message')?.textContent || '';
  if (visible) document.getElementById('win95-confirm-accept')?.click();
  return { visible, title, message };
})()`;

// ── 1. Saving with the panel ─────────────────────────────────────────────────────────────────────────
const ticked = await tickScopes(['macros', 'meters', 'network']);
assert.deepEqual(ticked, ['macros', 'meters', 'network'], 'the tick boxes must drive the export');
await evaluate(`(() => {
  document.getElementById('station-backup-show-name').value = 'Sala Grande · Sábado';
  document.getElementById('station-backup-ask').checked = true;
  window.__CALLS.length = 0;
  window.__REPLIES['save_station_backup'] = {
    path: '/Users/operator/Documents/WING CONTROLLER shows/Sala Grande · Sábado.wcz',
    folder: '/Users/operator/Documents/WING CONTROLLER shows',
    used_dialog: true,
    note: null,
  };
})()`);
await evaluate(`document.getElementById('btn-export-station-backup').click()`);
await sleep(300);
const exported = await evaluate(`(() => {
  const call = window.__CALLS.find((c) => c.cmd === 'save_station_backup');
  return {
    asked: Boolean(call),
    suggestedName: call?.args?.suggestedName || '',
    ask: call?.args?.ask,
    payload: call ? JSON.parse(call.args.contents) : null,
    bytes: call ? call.args.contents.length : 0,
    log: document.getElementById('log-output')?.textContent || '',
    confirm: ${readAndCloseConfirm},
  };
})()`);
assert.ok(exported.asked, 'export must ask the backend to save');
assert.equal(exported.suggestedName, 'Sala Grande · Sábado.wcz',
  `the file must be called "<show>.wcz", with no prefix and no date (got ${exported.suggestedName})`);
assert.equal(exported.ask, true, 'with "Ask where to save" ticked the backend must open the panel');
assert.ok(exported.bytes > 100, `the payload must carry the JSON (got ${exported.bytes} bytes)`);
assert.deepEqual(exported.payload.scope, ['macros', 'meters', 'network'], 'the file must declare exactly the ticked scopes');
assert.deepEqual(Object.keys(exported.payload.data).sort(), ['macros', 'meters', 'network'], 'and carry only their sections');
assert.ok(exported.confirm.visible, 'the operator must be told the backup was saved');
assert.match(exported.confirm.message, /WING CONTROLLER shows/, 'and where it went');
assert.match(exported.log, /backup_export_ok/, 'the log must record the export');
await sleep(200);
const reveal = await evaluate(`(() => {
  const call = window.__CALLS.find((c) => c.cmd === 'reveal_in_finder');
  return call?.args?.path || '';
})()`);
assert.match(reveal, /Sala Grande · Sábado\.wcz$/, '"Show in Finder" must reveal the file that was written');
const remembered = await evaluate(`localStorage.getItem('wing_backup_dir')`);
assert.equal(remembered, '/Users/operator/Documents/WING CONTROLLER shows', 'the folder must be remembered');

// ── 11. The cue list is a section of its own, and it cannot be declared without being carried ────────
//
// A show cannot be rebuilt from its preferences: the cue list is the show. It travels as one section, and the rule
// the other sections already follow applies to it — a file that says it carries the cue list and does not is refused
// by name, because being told a backup holds a list it does not is worse than being told it is incomplete.
const CUE_LIST_REPLY = {
  schema_version: 1,
  offset_frames: 2,
  sort: 'smpte',
  cues: [
    { id: 'cue-1', at: { hours: 1, minutes: 0, seconds: 10, frames: 0, rate: 'fps25', drop_frame: false },
      number: '12', label: 'Door', group: 'Act 1', macro_index: 0, repeats: false, enabled: true, note: 'Opening' },
  ],
};
await evaluate(`window.__CUE_LIST_REPLY = ${JSON.stringify(CUE_LIST_REPLY)}`);
await evaluate(`localStorage.removeItem('wing_timecode_cue_sort')`);
await evaluate(`localStorage.removeItem('wing_timecode_cue_created_order')`);
assert.equal(await evaluate(`document.querySelectorAll('.station-backup-scope[value="cues"]').length`), 1,
  'the panel offers the cue list where the other sections are');
assert.deepEqual(await tickScopes(['macros', 'cues']), ['macros', 'cues'],
  'and the tick boxes drive it like any other section');

const cueExport = await evaluate(`(() => {
  const built = window.__wingStationBackup.build(['macros', 'cues'], { cueList: window.__CUE_LIST_REPLY });
  return {
    scope: built.scope,
    carried: built.data.cues?.list?.cues?.length ?? null,
    problem: window.__wingStationBackup.problem(built),
  };
})()`);
assert.deepEqual(cueExport.scope, ['macros', 'cues'], 'a backup with the cue list declares the section');
assert.equal(cueExport.carried, 1, `and carries the list itself, not an empty section (got ${JSON.stringify(cueExport)})`);
assert.equal(cueExport.problem, null, 'and the app accepts what it wrote');

// With no list to carry, the builder does not declare the section: a scope that cannot be filled is not a promise.
assert.deepEqual(await evaluate(`window.__wingStationBackup.build(['macros', 'cues']).scope`), ['macros'],
  'a builder that was given no cue list does not declare the cues section');

const hollowCues = await evaluate(`(() => {
  // A copy: the builder keeps the caller's list by reference, and forging a hollow file must not hollow the fixture.
  const built = window.__wingStationBackup.build(['cues'], { cueList: JSON.parse(JSON.stringify(window.__CUE_LIST_REPLY)) });
  delete built.data.cues.list.cues;
  return window.__wingStationBackup.problem(built);
})()`);
assert.match(hollowCues, /declares the cues section but does not carry a cue list/,
  `a file that says it carries the cue list and does not is refused by name (got ${JSON.stringify(hollowCues)})`);

// Saving with the section ticked reads the list **once, before the payload is built**: the read is asynchronous and
// the builder is not, and a save that could not read it must abort rather than write a file that lies.
await evaluate(`window.__REPLIES['save_station_backup'] = { path: '/tmp/sala.wcz', folder: '/tmp', used_dialog: false }`);
await evaluate(`window.__CALLS.length = 0`);
await evaluate(`document.getElementById('station-backup-ask').checked = false`);
await evaluate(`document.getElementById('btn-export-station-backup').click()`);
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate(`window.__CALLS.some((entry) => entry.cmd === 'save_station_backup')`)) break;
  await sleep(100);
}
const savedWithCues = await evaluate(`(() => {
  const read = window.__CALLS.findIndex((entry) => entry.cmd === 'get_timecode_cues');
  const save = window.__CALLS.findIndex((entry) => entry.cmd === 'save_station_backup');
  const parsed = save >= 0 ? JSON.parse(window.__CALLS[save].args.contents) : null;
  return {
    read, save,
    reads: window.__CALLS.filter((entry) => entry.cmd === 'get_timecode_cues').length,
    scope: parsed?.scope ?? null,
    carried: parsed?.data?.cues?.list?.cues?.length ?? null,
    offset: parsed?.data?.cues?.list?.offset_frames ?? null,
  };
})()`);
assert.equal(savedWithCues.reads, 1, `saving with the cue list reads it exactly once (got ${JSON.stringify(savedWithCues)})`);
assert.equal(savedWithCues.read < savedWithCues.save, true, 'and reads it before it builds the file');

assert.deepEqual(savedWithCues.scope, ['macros', 'cues'], 'the file declares exactly what was ticked');
assert.equal(savedWithCues.carried, 1, 'with the cue list inside it');
assert.equal(savedWithCues.offset, 2, 'and the offset it is read with, because both are what the show\'s timecode means');
// The export left its own "saved" report open, and the next test clicks the same button: a modal that is not closed is
// a click that reaches nothing, which is how this block first broke the one after it.
await evaluate(readAndCloseConfirm);
await sleep(200);


// ── 2. Cancelling in the panel ───────────────────────────────────────────────────────────────────────
await evaluate(`(() => {
  window.__CALLS.length = 0;
  window.__REJECTS['save_station_backup'] = 'cancelled';
})()`);
await evaluate(`document.getElementById('btn-export-station-backup').click()`);
await sleep(300);
const cancelled = await evaluate(`(() => ({
  asked: window.__CALLS.filter((c) => c.cmd === 'save_station_backup').length,
  log: document.getElementById('log-output')?.textContent || '',
  confirm: document.getElementById('win95-confirm')?.style.display === 'flex',
}))()`);
assert.equal(cancelled.asked, 1, 'the save must be attempted once');
assert.match(cancelled.log, /backup_export_cancelled/, 'cancelling must be recorded');
assert.equal(cancelled.confirm, false, 'cancelling must not pop a confirmation');

// ── 3. The panel does not answer: fallback and the report says so ────────────────────────────────────
await evaluate(`(() => {
  delete window.__REJECTS['save_station_backup'];
  window.__CALLS.length = 0;
  window.__REPLIES['save_station_backup'] = {
    path: '/Users/operator/Documents/WING CONTROLLER shows/Sala Grande · Sábado.wcz',
    folder: '/Users/operator/Documents/WING CONTROLLER shows',
    used_dialog: false,
    note: 'the system dialog did not answer',
  };
})()`);
await evaluate(`document.getElementById('btn-export-station-backup').click()`);
await sleep(300);
const fallback = await evaluate(`(() => ({ confirm: ${readAndCloseConfirm}, log: document.getElementById('log-output')?.textContent || '' }))()`);
assert.ok(fallback.confirm.visible, 'a fallback save must still tell the operator');
assert.match(fallback.confirm.title, /backup folder/i, `the title must say it went to the backup folder (got "${fallback.confirm.title}")`);
assert.match(fallback.confirm.message, /did not answer/i, 'and it must explain why the dialog was not used');
assert.match(fallback.log, /\(no dialog\)/, 'the log must say the dialog was not used');

// ── 4. A real failure: the reason is shown ───────────────────────────────────────────────────────────
await evaluate(`(() => {
  window.__CALLS.length = 0;
  window.__REJECTS['save_station_backup'] = 'disk is full';
})()`);
await evaluate(`document.getElementById('btn-export-station-backup').click()`);
await sleep(300);
const failed = await evaluate(`(() => ({ confirm: ${readAndCloseConfirm}, log: document.getElementById('log-output')?.textContent || '' }))()`);
assert.ok(failed.confirm.visible, 'a failed save must tell the operator');
assert.match(failed.confirm.message, /disk is full/, 'and the message must carry the reason');
assert.match(failed.log, /backup_export_failed/, 'the log must record the failure');
await evaluate(`delete window.__REJECTS['save_station_backup']`);
await sleep(150);

// ── 5. The folder button remembers the chosen folder ─────────────────────────────────────────────────
await evaluate(`(() => { window.__CALLS.length = 0; window.__REPLIES['choose_backup_folder'] = '/Volumes/Shows 2026'; })()`);
await evaluate(`document.getElementById('station-backup-folder-btn').click()`);
await sleep(250);
const folderChosen = await evaluate(`(() => ({
  asked: Boolean(window.__CALLS.find((c) => c.cmd === 'choose_backup_folder')),
  stored: localStorage.getItem('wing_backup_dir'),
  label: document.getElementById('station-backup-folder-label')?.textContent || '',
}))()`);
assert.ok(folderChosen.asked, 'the folder button must ask the backend for a folder');
assert.equal(folderChosen.stored, '/Volumes/Shows 2026', 'the chosen folder must be remembered');
assert.match(folderChosen.label, /Shows 2026/, 'and shown next to the button');

// ── 6. Restoring through the webview picker, and the report on the way back ──────────────────────────
const backupJson = await evaluate(`(() => {
  const built = window.__wingStationBackup.build(['macros', 'meters']);
  built.show = { name: 'Sala Grande', savedAt: new Date().toISOString(), scopes: ['macros', 'meters'] };
  built.data.meters.customMetersWatchlist = [{ key: 'ch:9:meter' }];
  built.data.macros.library.macros = [{ ...built.data.macros.library.macros[0], name: 'INTRUDER FROM BACKUP' }];
  return JSON.stringify(built);
})()`);
await evaluate(`(() => {
  window.__CALLS.length = 0;
  localStorage.setItem('wing_custom_meters', '[{"key":"ch:1:meter"}]');
  localStorage.removeItem('wing_backup_last_restore');
})()`);
await evaluate(`(() => {
  const input = document.getElementById('station-backup-file-input');
  const file = new File([${JSON.stringify(backupJson)}], 'Sala Grande.wcz', { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(400);
const picker = await evaluate(`(() => ({
  offered: Array.from(document.querySelectorAll('[data-scope-pick]')).map((i) => i.dataset.scopePick),
  visible: Boolean(document.querySelector('[data-scope-pick]')),
  title: (() => {
    // Scoped to the overlay holding the picker: the window keeps other dialogs in the DOM (hidden).
    const root = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
      .find((overlay) => overlay.style.display === 'flex' && overlay.querySelector('[data-scope-pick]'));
    return root?.querySelector('.win95-dialog-titlebar')?.textContent || '';
  })(),
  body: (() => {
    const root = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
      .find((overlay) => overlay.style.display === 'flex' && overlay.querySelector('[data-scope-pick]'));
    return root?.querySelector('.macro-confirm-message')?.textContent || '';
  })(),
  log: document.getElementById('log-output')?.textContent || '',
}))()`);
assert.ok(picker.visible, 'the scope picker must appear after choosing a file');
assert.deepEqual(picker.offered, ['macros', 'meters'], 'and offer exactly the sections the file carries');
assert.match(picker.log, /backup_import_file_chosen/, 'the log must record the chosen file');
// The dialog shows both sides of the file's identity: its name on disk and the show it says it is.
assert.match(picker.title, /Sala Grande/, `the dialog must be titled with the show inside the file (got "${picker.title}")`);
assert.match(picker.body, /Sala Grande\.wcz/, `and must name the file it is about to apply (got "${picker.body}")`);
assert.match(picker.body, /Show: "Sala Grande"/, `and repeat the show name with its date (got "${picker.body}")`);
assert.equal(picker.body.match(/\bby v?(\S+)/)?.[1], currentVersion,
  `and the exact version that wrote it (got "${picker.body}")`);

await evaluate(`(() => {
  document.querySelectorAll('[data-scope-pick]').forEach((input) => { input.checked = input.dataset.scopePick === 'meters'; });
})()`);
await evaluate(`document.querySelector('[data-scope="accept"]').click()`);
await sleep(500);
// Restoring reloads the window: it is waited for to come back and the report it leaves is read.
let afterReload = { pending: null, report: '', title: '' };
for (let attempt = 0; attempt < 25; attempt += 1) {
  try {
    const probe = await evaluate(`(() => ({
      pending: localStorage.getItem('wing_backup_last_restore'),
      report: document.getElementById('win95-confirm')?.style.display === 'flex'
        ? (document.getElementById('win95-confirm-message')?.textContent || '')
        : '',
      title: document.getElementById('win95-confirm-title')?.textContent || '',
    }))()`);
    // Every read is merged: when the report appears the pending key has already been removed, so
    // keeping only the last read "with a key" would lose exactly the datum to be checked.
    if (probe) {
      afterReload = {
        pending: probe.pending ?? afterReload.pending,
        report: probe.report || afterReload.report,
        title: probe.title || afterReload.title,
      };
      if (probe.report) break;
    }
  } catch (_) { /* context lost during the reload */ }
  await sleep(300);
}
assert.ok(afterReload.pending, 'the restore must leave a report for the window to show');
const parsed = JSON.parse(afterReload.pending);
assert.match(parsed.file, /Sala Grande/, 'the report must name the file that was restored');
assert.deepEqual(parsed.scopes, ['meters'], 'and say which sections were applied');
// The report is the app's own account of what it did: the stored watchlist is the fact.
const appliedMeters = await evaluate(`localStorage.getItem('wing_custom_meters')`);
assert.equal(appliedMeters, '[{"key":"ch:9:meter"}]', `only the meters section may have been applied (got ${appliedMeters})`);
assert.ok(afterReload.report, 'and the window must actually show the report after coming back');
assert.match(afterReload.title, /restored/i, `the report title must say it was restored (got "${afterReload.title}")`);
assert.match(afterReload.title, /Sala Grande/, `and must name the show the file carries (got "${afterReload.title}")`);
assert.match(afterReload.report, /Meters/i, 'the report must list the section that was applied');
assert.ok(!/Macros/i.test(afterReload.report), `the report must not list sections that were not applied (got "${afterReload.report}")`);

// The report of the previous restore is closed here: it has already been checked and must not confuse
// the next case.
await evaluate(`(() => {
  if (document.getElementById('win95-confirm')?.style.display === 'flex') {
    document.getElementById('win95-confirm-accept')?.click();
  }
  localStorage.removeItem('wing_backup_last_restore');
})()`);
await sleep(250);

// ── 6b. The MACRO LIST buttons do the same (that is where the operator looked for them) ──────────────
// The case that cost a night: the Export of the list wrote a fixed file on the desktop without
// asking anything, so "no dialog appeared and the list repainted itself".
await evaluate(`(() => { window.__CALLS.length = 0; localStorage.removeItem('wing_backup_scopes'); })()`);
await evaluate(`document.getElementById('btn-close-settings').click()`);
await sleep(200);
await evaluate(`document.getElementById('library-export').click()`);
await sleep(300);
const contentsDialog = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('[data-scope-choice]')).map((input) => ({ scope: input.dataset.scopeChoice, checked: input.checked }));
  const hasName = Boolean(document.getElementById('backup-contents-name'));
  const visible = Boolean(document.querySelector('[data-scope-choice]'));
  return { rows, hasName, visible };
})()`);
assert.ok(contentsDialog.visible, 'the library Export must ask what the backup carries before asking for a file');
assert.deepEqual(
  contentsDialog.rows.filter((row) => row.checked).map((row) => row.scope),
  ['macros', 'meters'],
  'with macros and meters ticked by default (what a show needs)',
);
assert.ok(contentsDialog.hasName, 'and it must offer a name for the file');

// Only macros is ticked, a name is typed and it is accepted: the file is asked for with that.
await evaluate(`(() => {
  window.__REPLIES['save_station_backup'] = {
    path: '/Users/operator/Documents/WING CONTROLLER shows/Boda.wcz',
    folder: '/Users/operator/Documents/WING CONTROLLER shows',
    used_dialog: true,
    note: null,
  };
  document.querySelectorAll('[data-scope-choice]').forEach((input) => { input.checked = input.dataset.scopeChoice === 'macros'; });
  document.getElementById('backup-contents-name').value = 'Boda';
  document.querySelector('[data-backup="accept"]').click();
})()`);
await sleep(350);
const libraryExport = await evaluate(`(() => {
  const call = window.__CALLS.find((c) => c.cmd === 'save_station_backup');
  return {
    asked: Boolean(call),
    suggestedName: call?.args?.suggestedName || '',
    scopes: call ? JSON.parse(call.args.contents).scope : null,
    confirm: ${readAndCloseConfirm},
  };
})()`);
assert.ok(libraryExport.asked, 'accepting the contents dialog must save a backup');
assert.equal(libraryExport.suggestedName, 'Boda.wcz',
  `the name given in the dialog must name the file (got ${libraryExport.suggestedName})`);
assert.deepEqual(libraryExport.scopes, ['macros'], 'and only the section that was ticked must travel');
assert.ok(libraryExport.confirm.visible, 'and the operator must be told where it went');

// The Import of the list opens the file picker (the webview one) and accepts the old format.
await evaluate(`(() => { window.__CALLS.length = 0; localStorage.removeItem('wing_backup_last_restore'); })()`);
await evaluate(`document.getElementById('library-import').click()`);
await sleep(250);
const libraryImport = await evaluate(`document.getElementById('log-output')?.textContent || ''`);
assert.match(libraryImport, /backup_import_picker_opened/, 'the library Import must open the file picker');
const legacy = await evaluate(`(() => {
  const input = document.getElementById('station-backup-file-input');
  const file = new File([JSON.stringify({ schemaVersion: 1, selectedIndex: 0, macros: [{ name: 'VIEJA', enabled: false, actionSteps: [] }] })], 'wing_macro_library_export.json', { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
assert.ok(legacy, 'the legacy library file must reach the picker');
await sleep(400);
const legacyPicker = await evaluate(`(() => {
  const root = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
    .find((overlay) => overlay.style.display === 'flex' && overlay.querySelector('[data-scope-pick]'));
  return {
    offered: Array.from(document.querySelectorAll('[data-scope-pick]')).map((i) => i.dataset.scopePick),
    visible: Boolean(root),
    body: root?.querySelector('.macro-confirm-message')?.textContent || '',
    title: root?.querySelector('.win95-dialog-titlebar')?.textContent || '',
  };
})()`);
assert.ok(legacyPicker.visible, 'a bare library file must still be loadable');
assert.deepEqual(legacyPicker.offered, ['macros'], 'and it must be offered as a macros-only backup');
assert.match(legacyPicker.body, /does not say which show it is/, `and the dialog must admit the file carries no show name (got "${legacyPicker.body}")`);
assert.match(legacyPicker.title, /Load a backup/, `and not invent a show name for it (got "${legacyPicker.title}")`);
await evaluate(`document.querySelector('[data-scope="cancel"]')?.click()`);
await sleep(250);

// ── 6c. The SHOW sub-block: name, Save/Load and metadata inside the file ─────────────────────────────
const showBlock = await evaluate(`(() => {
  const field = document.getElementById('show-name-input');
  const save = document.getElementById('library-export');
  const load = document.getElementById('library-import');
  const legend = document.querySelector('#show-block legend');
  return {
    legend: legend?.textContent || '',
    field: Boolean(field),
    save: save?.textContent.trim() || '',
    load: load?.textContent.trim() || '',
    status: document.getElementById('show-status')?.textContent || '',
  };
})()`);
assert.equal(showBlock.legend, 'Show', `the sub-block must be titled Show (got "${showBlock.legend}")`);
assert.ok(showBlock.field, 'it must carry the show name field');
assert.equal(showBlock.save, 'Save…', `the export button must read Save… (got "${showBlock.save}")`);
assert.equal(showBlock.load, 'Load…', `the import button must read Load… (got "${showBlock.load}")`);
assert.match(showBlock.status, /WING CONTROLLER shows/, `the status line must say where shows are saved (got "${showBlock.status}")`);

// The name typed in the sub-block travels INSIDE the file (metadata), not only in the file name.
await evaluate(`(() => {
  const field = document.getElementById('show-name-input');
  field.value = 'Boda Marina';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  window.__CALLS.length = 0;
  window.__REPLIES['save_station_backup'] = {
    path: '/Users/operator/Documents/WING CONTROLLER shows/Boda Marina.wcz',
    folder: '/Users/operator/Documents/WING CONTROLLER shows',
    used_dialog: true,
    note: null,
  };
  document.getElementById('library-export').click();
})()`);
await sleep(350);
const contentsName = await evaluate(`(() => {
  const field = document.getElementById('backup-contents-name');
  const ask = { name: field?.value || '', visible: Boolean(document.querySelector('[data-scope-choice]')) };
  // The operator ticks what this show carries: macros and meters.
  document.querySelectorAll('[data-scope-choice]').forEach((input) => {
    input.checked = input.dataset.scopeChoice === 'macros' || input.dataset.scopeChoice === 'meters';
  });
  document.querySelector('[data-backup="accept"]')?.click();
  return ask;
})()`);
assert.ok(contentsName.visible, 'saving from the Show block must still ask what the file carries');
assert.equal(contentsName.name, 'Boda Marina', `and must come with the name already written in the Show box (got "${contentsName.name}")`);
await sleep(400);
const showMeta = await evaluate(`(() => {
  const call = window.__CALLS.find((c) => c.cmd === 'save_station_backup');
  const payload = call ? JSON.parse(call.args.contents) : null;
  const confirm = ${readAndCloseConfirm};
  return {
    suggestedName: call?.args?.suggestedName || '',
    show: payload?.show || null,
    scopes: payload?.scope || null,
    confirm,
    stored: localStorage.getItem('wing_backup_show_name'),
    remembered: (() => { try { return JSON.parse(localStorage.getItem('wing_backup_scopes') || 'null'); } catch (error) { return null; } })(),
  };
})()`);
assert.equal(showMeta.suggestedName, 'Boda Marina.wcz', `the show name must name the file (got ${showMeta.suggestedName})`);
assert.equal(showMeta.show?.name, 'Boda Marina', `the file must carry the show name inside it (got ${JSON.stringify(showMeta.show)})`);
assert.ok(Array.isArray(showMeta.show?.scopes) && showMeta.show.scopes.length > 0, 'and the sections it carries');
assert.equal(showMeta.stored, 'Boda Marina', 'and the name must be remembered for the next time');
assert.deepEqual(showMeta.scopes, ['macros', 'meters'], 'the sections ticked for the show must travel in the file');
assert.deepEqual(showMeta.remembered, ['macros', 'meters'], 'and must be the ones offered next time');
assert.ok(showMeta.confirm.visible, 'the operator must be told the show was saved');
await sleep(200);

// ── 6d. The backup folder exists from startup and closing warns of the show without a backup ─────────
const boot = await evaluate(`(() => ({
  log: document.getElementById('log-output')?.textContent || '',
  label: document.getElementById('station-backup-folder-label')?.textContent || '',
}))()`);
assert.match(boot.log, /backup_folder_ready/, 'the app must create the backup folder when it starts, not only when saving');
assert.match(boot.label, /WING CONTROLLER shows/, 'and the panel must show where the backups go');

const backupState = await evaluate(`(() => {
  localStorage.removeItem('wing_backup_last_saved_at');
  localStorage.removeItem('wing_backup_dirty');
  const never = stationBackupNotSaved();
  markBackupSaved();
  const afterSave = stationBackupNotSaved();
  markBackupChanged();
  const afterChange = stationBackupNotSaved();
  localStorage.removeItem('wing_backup_dirty');
  return { never, afterSave, afterChange };
})()`);
assert.equal(backupState.never, true, 'with no backup ever saved, the show counts as unsaved');
assert.equal(backupState.afterSave, false, 'right after a backup, it counts as saved');
assert.equal(backupState.afterChange, true, 'and any later change marks it unsaved again (that is the closing warning)');

// F16/Wiring: the flag only matters if the closing warning really reads it. The window's close request
// is fired here (the mock records the handler at load), so this is the dialog the operator would see.
// The handler is fired without awaiting it: it resolves when the operator answers, which is what the
// cancel below does.
const closeRegistered = await evaluate(`(() => {
  localStorage.removeItem('wing_backup_last_saved_at');
  localStorage.removeItem('wing_backup_dirty');
  window.__CLOSE_PREVENTED = false;
  const handler = window.__CLOSE_HANDLERS?.[0];
  if (!handler) return false;
  handler({ preventDefault: () => { window.__CLOSE_PREVENTED = true; } });
  return true;
})()`);
await sleep(300);
const closeWarning = await evaluate(`(() => {
  const dialog = document.getElementById('win95-confirm');
  const seen = {
    registered: true,
    visible: dialog?.style.display === 'flex',
    title: document.getElementById('win95-confirm-title')?.textContent || '',
    message: document.getElementById('win95-confirm-message')?.textContent || '',
    accept: document.getElementById('win95-confirm-accept')?.textContent || '',
  };
  document.getElementById('win95-confirm-cancel')?.click();
  return seen;
})()`);
assert.ok(closeRegistered, 'the window must register what happens when it is closed');
assert.ok(closeWarning.visible, 'a warning must be on screen before anything is closed');
assert.match(closeWarning.title, /Quit WING CONTROLLER/, `it must be the quitting warning (got "${closeWarning.title}")`);
assert.match(closeWarning.message, /no backup file saved/i, `the warning must say the show has no backup (got "${closeWarning.message}")`);
assert.match(closeWarning.message, /Save…/, 'and name the button that saves it');
assert.match(closeWarning.accept, /Quit anyway/i, `and offer to quit regardless (got "${closeWarning.accept}")`);
await sleep(250);
// Cancelling is what keeps the window open: `preventDefault` is the operator saying no.
const stayedOpen = await evaluate(`window.__CLOSE_PREVENTED === true`);
assert.ok(stayedOpen, 'cancelling the warning must keep the app open');

// ── 7. A file that lies about its contents is refused before anything is touched ─────────────────────
await evaluate(`(() => {
  window.__CALLS.length = 0;
  localStorage.setItem('wing_custom_meters', '[{"key":"ch:1:meter"}]');
  localStorage.removeItem('wing_backup_last_restore');
})()`);
const liar = await evaluate(`(() => {
  const broken = window.__wingStationBackup.build(['macros', 'meters']);
  delete broken.data.macros.library;
  delete broken.macroLibrary;
  const input = document.getElementById('station-backup-file-input');
  const file = new File([JSON.stringify(broken)], 'broken.wingstation.json', { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
assert.ok(liar, 'the file must be fed to the input');
await sleep(400);
const refused = await evaluate(`(() => ({
  confirm: ${readAndCloseConfirm},
  saves: window.__CALLS.filter((c) => c.cmd === 'save_macro_library').length,
  watchlist: localStorage.getItem('wing_custom_meters'),
  pending: localStorage.getItem('wing_backup_last_restore'),
  log: document.getElementById('log-output')?.textContent || '',
}))()`);
assert.ok(refused.confirm.visible, 'a file that lies about its sections must be refused with a reason');
assert.match(refused.confirm.message, /macro library/i, 'and the reason must say what is missing');
assert.equal(refused.saves, 0, 'nothing may be written to the library');
assert.equal(refused.watchlist, '[{"key":"ch:1:meter"}]', 'and no meter preference may be touched');
assert.equal(refused.pending, null, 'and no restore report may be left behind');
assert.match(refused.log, /backup_restore_failed/, 'the failure must be logged');

// ── 7b. A file cannot write the application's own state, and a section that is not there is not applied ─
// Both holes were reported by the adversarial review: a loaded file could forge "already saved"
// (silencing the closing warning) or leave the station with a section ticked that it never carried.
await evaluate(`(() => {
  window.__CALLS.length = 0;
  localStorage.setItem('wing_custom_meters', '[{"key":"ch:1:meter"}]');
  localStorage.removeItem('wing_backup_last_restore');
})()`);
// What the app state holds before the file is offered: it must be exactly the same afterwards.
const stateBefore = await evaluate(`(() => ({
  scopes: localStorage.getItem('wing_backup_scopes'),
  showName: localStorage.getItem('wing_backup_show_name'),
  savedAt: localStorage.getItem('wing_backup_last_saved_at'),
}))()`);
const forgedState = await evaluate(`(() => {
  const forged = window.__wingStationBackup.build(['settings']);
  forged.data.settings.storage = {
    wing_backup_last_saved_at: String(Date.now()),
    wing_backup_scopes: JSON.stringify(['network']),
    wing_backup_show_name: 'FORGED SHOW',
  };
  const input = document.getElementById('station-backup-file-input');
  const file = new File([JSON.stringify(forged)], 'forged.wingstation.json', { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
assert.ok(forgedState, 'the forged file must reach the picker');
await sleep(400);
const forgedRefused = await evaluate(`(() => ({
  confirm: ${readAndCloseConfirm},
  scopes: localStorage.getItem('wing_backup_scopes'),
  showName: localStorage.getItem('wing_backup_show_name'),
  savedAt: localStorage.getItem('wing_backup_last_saved_at'),
}))()`);
assert.ok(forgedRefused.confirm.visible, 'a file carrying the application\'s own state must be refused');
assert.match(forgedRefused.confirm.message, /invalid preferences/i, 'and say the preferences are not acceptable');
assert.equal(forgedRefused.scopes, stateBefore.scopes, 'it may not change which sections the next save offers');
assert.equal(forgedRefused.showName, stateBefore.showName, 'nor the show that is open');
assert.equal(forgedRefused.savedAt, stateBefore.savedAt, 'nor forge that the show is saved');

// A section declared but not carried is refused too: it used to be offered as "0 preferences" and
// reported as restored.
const emptySection = await evaluate(`(() => {
  const hollow = window.__wingStationBackup.build(['meters']);
  delete hollow.data.meters;
  const input = document.getElementById('station-backup-file-input');
  const file = new File([JSON.stringify(hollow)], 'hollow.wingstation.json', { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
assert.ok(emptySection, 'the hollow file must reach the picker');
await sleep(400);
const hollowRefused = await evaluate(`(() => ({
  confirm: ${readAndCloseConfirm},
  pending: localStorage.getItem('wing_backup_last_restore'),
}))()`);
assert.ok(hollowRefused.confirm.visible, 'a file that declares a section it does not carry must be refused');
assert.match(hollowRefused.confirm.message, /meters/i, 'and the reason must name the section');
assert.equal(hollowRefused.pending, null, 'and nothing may be reported as restored');

// ── 7c. Typing a show name of two words keeps both, and an empty selection is a real dialog ──────────
const typedName = await evaluate(`(() => {
  const field = document.getElementById('show-name-input');
  field.focus();
  field.value = '';
  // Keystroke by keystroke, as the operator types: "Boda Marina" must keep its space.
  for (const piece of ['Boda', ' ', 'Marina']) {
    field.value += piece;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const typed = field.value;
  field.blur();
  return { typed, stored: localStorage.getItem('wing_backup_show_name') };
})()`);
assert.equal(typedName.typed, 'Boda Marina', `the space in a two-word show name must survive typing (got "${typedName.typed}")`);
assert.equal(typedName.stored, 'Boda Marina', 'and the whole name must be the one that is kept');

await evaluate(`document.getElementById('library-export').click()`);
await sleep(300);
await evaluate(`(() => {
  document.querySelectorAll('[data-scope-choice]').forEach((input) => { input.checked = false; });
  document.querySelector('[data-backup="accept"]')?.click();
})()`);
// The notice is drawn on the dialog's own turn, so it needs one before it can be read.
await sleep(300);
const emptySelection = await evaluate(`(() => ${readAndCloseConfirm})()`);
assert.ok(emptySelection.visible, 'saving with nothing ticked must say so instead of doing nothing');
assert.match(emptySelection.message, /at least one section/i, `and say what to do (got "${emptySelection.message}")`);
const dialogStillOpen = await evaluate(`Boolean(document.querySelector('[data-scope-choice]'))`);
assert.ok(dialogStillOpen, 'and the contents dialog must still be there to correct it');
await evaluate(`document.querySelector('[data-backup="cancel"]')?.click()`);
await sleep(250);

// ── 7d. A hand-written file of the documented shape still loads ──────────────────────────────────────
// The rest of the test builds its files with the app's own builder, so envelope drift would move both
// sides together. This fixture is frozen text: a scheme-3 envelope with a `show` block, written here
// exactly as the guide documents it.
const frozenFile = {
  app: 'WING CONTROLLER',
  schemaVersion: 3,
  version: '0.2.48',
  exportedAt: '2026-09-23T10:00:00.000Z',
  scope: ['settings'],
  show: { name: 'Frozen Show', savedAt: '2026-09-23T10:00:00.000Z', scopes: ['settings'], appVersion: '0.2.48' },
  data: { settings: { storage: { wing_theme: 'dark' } } },
};
await evaluate(`(() => {
  localStorage.setItem('wing_theme', 'light');
  localStorage.removeItem('wing_backup_last_restore');
  const input = document.getElementById('station-backup-file-input');
  const file = new File([${JSON.stringify(JSON.stringify(frozenFile))}], 'wing_frozen-show_2026-09-23.wingstation.json', { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(400);
const frozenPicker = await evaluate(`(() => ({
  offered: Array.from(document.querySelectorAll('[data-scope-pick]')).map((i) => i.dataset.scopePick),
  visible: Boolean(document.querySelector('[data-scope-pick]')),
}))()`);
assert.ok(frozenPicker.visible, 'a hand-written file of the documented shape must be accepted');
assert.deepEqual(frozenPicker.offered, ['settings'], 'with exactly the sections it declares');
await evaluate(`document.querySelector('[data-scope="accept"]')?.click()`);
await sleep(600);
const frozenApplied = await evaluate(`(() => ({
  stored: localStorage.getItem('wing_theme'),
  showName: localStorage.getItem('wing_backup_show_name'),
  pending: localStorage.getItem('wing_backup_last_restore'),
}))()`);
assert.equal(frozenApplied.stored, 'dark', 'and what it carries must be applied');
assert.equal(frozenApplied.showName, 'Frozen Show', 'and the show name inside it must come back');
assert.match(frozenApplied.pending || '', /Frozen Show/, 'and the report must name that show');
await evaluate(`(() => {
  localStorage.removeItem('wing_backup_last_restore');
  localStorage.setItem('wing_theme', 'light');
})()`);
await sleep(200);

// ── 7e. The library and the watchlist can be saved from outside the SHOW block ───────────────────────
// Regression: `saveMacroLibraryState` and `saveCustomMeters` live outside the block that owns the
// status line, and calling the block's painter directly from there threw a ReferenceError (the macro
// was never saved and the watchlist change was never written). The block now exposes a hook.
const outsideScopes = await evaluate(`(async () => {
  window.__CALLS.length = 0;
  localStorage.setItem('wing_custom_meters', '[{"key":"ch:1:meter"}]');
  const logBefore = document.getElementById('log-output')?.textContent || '';
  document.getElementById('library-new').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  // The watchlist path is the other caller: it has to write the store, not die before writing it.
  customMetersWatchlist.push({ key: 'ch:12:meter', label: 'CH 12' });
  saveCustomMeters();
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    savedLibrary: window.__CALLS.filter((c) => c.cmd === 'save_macro_library').length,
    libraryMacros: (window.__CALLS.find((c) => c.cmd === 'save_macro_library')?.args?.library?.macros || []).length,
    watchlist: localStorage.getItem('wing_custom_meters'),
    status: document.getElementById('show-status')?.textContent || '',
    newLog: (document.getElementById('log-output')?.textContent || '').slice(logBefore.length),
  };
})()`);
assert.equal(outsideScopes.savedLibrary, 1, 'creating a macro must save the library through the backend');
assert.equal(outsideScopes.libraryMacros, 1, 'and the library must carry the new macro');
assert.match(outsideScopes.watchlist || '', /ch:12:meter/, `a watchlist change must reach the store (got ${outsideScopes.watchlist})`);
assert.match(outsideScopes.status, /WING CONTROLLER shows/, `the SHOW status line must still be there (got "${outsideScopes.status}")`);
assert.ok(!/macro_new_error|library_save_failed/.test(outsideScopes.newLog), `no save may fail with an error (got "${outsideScopes.newLog}")`);
await evaluate(`(() => { localStorage.setItem('wing_custom_meters', '[{"key":"ch:1:meter"}]'); })()`);
await sleep(200);

// ── 8. With no backend the report tells the truth (no "saved" when nothing was written) ──────────────
// `hasTauri` is frozen at startup, so this branch cannot be forced on the fly: the window source
// itself is checked to confirm that the browser-case wording is the honest one, and that the old one
// ("The browser is downloading…" with the same tone as a save) is gone.
const browserBranch = await evaluate(`(() => {
  const source = Array.from(document.scripts).map((s) => s.textContent || '').join('\\n');
  return {
    honest: /has no application backend, so/.test(source),
    honestTitle: /Backup handed to the browser/.test(source),
    oldLie: /The browser is downloading/.test(source),
  };
})()`);
assert.ok(browserBranch.honest, 'the no-backend warning must say the file was only offered as a download');
assert.ok(browserBranch.honestTitle, 'and its title must not read like a save');
assert.equal(browserBranch.oldLie, false, 'the old wording that read like a successful save must be gone');

console.log('1. saving asks the backend with the show name, carries the ticked scopes and says where it went');
console.log('2. cancelling the dialog is recorded and pops nothing');
console.log('3. when the dialog does not answer, the backup lands in the backup folder and it says so');
console.log('4. a real failure shows the reason instead of failing silently');
console.log('5. the folder button remembers and shows the chosen folder');
console.log('6. restoring uses the webview picker, applies only what is ticked and leaves a report');
console.log('6c. the Show block: name, Save/Load, and the show name inside the file itself');
console.log('6d. the backup folder is created at startup and a show without a backup counts as unsaved');
console.log('7. a file that lies about its sections is refused before anything is written');
console.log('7b. a file may not write the app state, nor claim a section it does not carry');
console.log('7c. a two-word show name survives typing and an empty selection is refused out loud');
console.log('7d. a hand-written file of the documented shape still loads and names its show');
console.log('7e. the library and the watchlist save from outside the SHOW block');
console.log('8. with no backend the warning tells the truth about where the file went');

// ── 9. The two dialogs are sized by what they carry ──────────────────────────────────────────────────
// They inherited `.win95-dialog`'s fixed 560 px height, so a four-row list sat in a half-empty panel.
await evaluate(`document.getElementById('library-export').click()`);
await sleep(300);
const saveDialog = await evaluate(`(() => {
  const overlay = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
    .find((node) => node.style.display === 'flex' && node.querySelector('#backup-contents-name'));
  const dialog = overlay?.querySelector('.win95-dialog');
  const box = dialog?.getBoundingClientRect();
  const rows = overlay?.querySelector('[data-scope-choice]')?.closest('div');
  return {
    height: Math.round(box?.height || 0),
    width: Math.round(box?.width || 0),
    rows: overlay?.querySelectorAll('[data-scope-choice]').length || 0,
    rowsHeight: Math.round(rows?.getBoundingClientRect().height || 0),
  };
})()`);
assert.equal(saveDialog.rows, 5, 'the save dialog must list the five sections, the cue list among them');
assert.ok(saveDialog.height >= 150 && saveDialog.height <= 400,
  `the save dialog must be as tall as its content, not the 560 px default (got ${saveDialog.height}px)`);
assert.ok(saveDialog.rowsHeight <= 140, `the four rows need no more than that (got ${saveDialog.rowsHeight}px)`);
await evaluate(`document.querySelector('[data-backup="cancel"]')?.click()`);
await sleep(200);

// The load dialog is measured through the real path (the picker is opened by the file input), because
// `win95PickScopes` lives inside the settings block and is not reachable from here.
await evaluate(`(() => {
  const file = new File([JSON.stringify({ app: 'WING CONTROLLER', schemaVersion: 3, scope: ['settings'],
    show: { name: 'Sala Grande', savedAt: new Date().toISOString(), scopes: ['settings'], appVersion: 'v0.2.50' },
    data: { settings: { storage: { wing_theme: 'dark' } } } })], 'Sala Grande.wcz', { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.getElementById('station-backup-file-input');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(400);
const pickerDialog = await evaluate(`(() => {
  const root = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
    .find((overlay) => overlay.style.display === 'flex' && overlay.querySelector('[data-scope-pick]'));
  const dialog = root?.querySelector('.win95-dialog');
  const box = dialog?.getBoundingClientRect();
  const measured = {
    height: Math.round(box?.height || 0),
    width: Math.round(box?.width || 0),
    body: root?.querySelector('.macro-confirm-message')?.textContent || '',
  };
  root?.querySelector('[data-scope="cancel"]')?.click();
  return measured;
})()`);
assert.ok(pickerDialog.height >= 150 && pickerDialog.height <= 460,
  `the load dialog must be as tall as its content, not the 560 px default (got ${pickerDialog.height}px)`);
assert.match(pickerDialog.body, /Sala Grande\.wcz/, 'and must name the file it is about to apply');
await sleep(200);
await evaluate(`(() => { localStorage.removeItem('wing_backup_last_restore'); localStorage.setItem('wing_theme', 'light'); })()`);

console.log(`9. the dialogs fit their content: save ${saveDialog.height}px, load ${pickerDialog.height}px`);

// ── 11. A failed restore puts back ONLY the keys it wrote ────────────────────────────────────────────
// The rollback used to remove every `wing_*` key and rewrite the snapshot, which also deleted whatever
// the other window had written while the restore was running: those keys survived only if the snapshot
// happened to carry them (master plan 2026-09-22, §3.3 item 11).
//
// The failure is a real one: the store refuses one of the two keys the meters section writes after the
// generic applier (`localStorage.setItem`, not the property assignment that applier uses), and the write
// the other window makes in the meantime is simulated where it happens, inside `setItem`.
const rollback = await evaluate(`(async () => {
  localStorage.setItem('wing_test_survivor', 'kept');
  localStorage.setItem('wing_custom_meters', JSON.stringify([{ key: 'ch:1' }]));
  localStorage.removeItem('wing_test_late');
  window.__LATE_WRITTEN = false;
  window.__REFUSED_ONCE = false;
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage) {
      if (!window.__LATE_WRITTEN) {
        window.__LATE_WRITTEN = true;
        original.call(localStorage, 'wing_test_late', 'written while the restore ran');
      }
      // Refused once, so the rollback that puts the key back can still write it: a store that refused
      // every write would make the rollback itself fail, which is not the case under test.
      if (key === 'wing_peak_config' && !window.__REFUSED_ONCE) {
        window.__REFUSED_ONCE = true;
        throw new Error('mock store refused wing_peak_config');
      }
    }
    return original.call(this, key, value);
  };
  const file = new File([JSON.stringify({ app: 'WING CONTROLLER', schemaVersion: 3, scope: ['meters'],
    show: { name: 'Fallida', savedAt: new Date().toISOString(), scopes: ['meters'], appVersion: 'v0.2.50' },
    data: { meters: {
      storage: { wing_custom_meters: JSON.stringify([{ key: 'ch:9' }]), wing_peak_config: '{"enabled":false}' },
      customMetersWatchlist: [{ key: 'ch:9' }],
      peakHoldConfig: { enabled: false },
    } } })], 'Fallida.wcz', { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.getElementById('station-backup-file-input');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  document.querySelectorAll('[data-scope-pick]').forEach((box) => { box.checked = box.dataset.scopePick === 'meters'; });
  document.querySelector('[data-scope="accept"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  Storage.prototype.setItem = original;
  const dialog = document.getElementById('win95-confirm');
  const open = getComputedStyle(dialog).display !== 'none';
  const result = {
    title: open ? document.getElementById('win95-confirm-title').textContent : '',
    message: open ? document.getElementById('win95-confirm-message').textContent : '',
    written: localStorage.getItem('wing_custom_meters'),
    survivor: localStorage.getItem('wing_test_survivor'),
    late: localStorage.getItem('wing_test_late'),
    failed: window.__REFUSED_ONCE,
  };
  if (open) document.getElementById('win95-confirm-accept')?.click();
  return result;
})()`);
assert.equal(rollback.failed, true, `the mock store must have refused the write (got ${JSON.stringify(rollback)})`);
assert.match(rollback.title, /not applied/i, `the failure must be reported (got ${JSON.stringify(rollback)})`);
assert.equal(rollback.written, JSON.stringify([{ key: 'ch:1' }]),
  `the key the attempt wrote must be put back (got ${rollback.written})`);
assert.equal(rollback.survivor, 'kept', 'a key that was there before must survive');
assert.equal(rollback.late, 'written while the restore ran',
  'a key another window wrote during the attempt must NOT be deleted by the rollback');
await evaluate(`localStorage.removeItem('wing_test_survivor'); localStorage.removeItem('wing_test_late'); localStorage.removeItem('wing_backup_last_restore');`);
await sleep(200);
console.log('11. a failed restore puts back only its own keys:', JSON.stringify(rollback));

// ── 10. The Meter Bridge is rebuilt from the restored preferences ───────────────────────────────────
// The bridge reads its layout, style, watchlist, peak hold and banks once, at start-up, and a restore
// writes all of them: leaving the window as it was kept the previous station on screen over the new
// station's preferences (master plan 2026-09-22, §3.3 item 12). The reload the dock asks for is
// recorded in localStorage because the window navigates away right afterwards.
const RELAY_KEY = 'wing_test_meters_relay';
await evaluate(`(() => {
  localStorage.removeItem('wing_test_meters_relay');
  // The bridge is open as far as the backend is concerned: that is what the restore has to look at.
  window.__REPLIES['is_meters_window_open'] = true;
})()`);
await evaluate(`(() => {
  const file = new File([JSON.stringify({ app: 'WING CONTROLLER', schemaVersion: 3, scope: ['settings'],
    show: { name: 'Puente', savedAt: new Date().toISOString(), scopes: ['settings'], appVersion: 'v0.2.50' },
    data: { settings: { storage: { wing_theme: 'dark' } } } })], 'Puente.wcz', { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.getElementById('station-backup-file-input');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(400);
await evaluate(`(() => {
  document.querySelectorAll('[data-scope-pick]').forEach((input) => { input.checked = input.dataset.scopePick === 'settings'; });
  document.querySelector('[data-scope="accept"]')?.click();
})()`);
await sleep(600);
let relay = null;
for (let attempt = 0; attempt < 25 && !relay; attempt += 1) {
  try {
    relay = await evaluate(`localStorage.getItem(${JSON.stringify('wing_test_meters_relay')})`);
  } catch (_) { /* context lost during the reload */ }
  if (!relay) await sleep(300);
}
assert.equal(relay, JSON.stringify(['close_meters_window', 'open_meters_window']),
  `an open Meter Bridge must be rebuilt from the restored preferences (got ${relay})`);
// The restore navigated this window and it comes back showing the report of what it applied. Every
// call until the new document answers is allowed to fail: a command issued to a target that is
// navigating is refused, and that refusal is not an assertion failure.
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    if (await evaluate('document.readyState === "complete" && Boolean(document.getElementById("station-backup-file-input"))')) break;
  } catch (_) { /* the window is navigating */ }
  await sleep(300);
}
try {
  await evaluate(`(() => {
    localStorage.removeItem('wing_backup_last_restore');
    if (document.getElementById('win95-confirm')?.style.display === 'flex') {
      document.getElementById('win95-confirm-accept')?.click();
    }
  })()`);
} catch (_) { /* the window is still settling */ }
await sleep(400);
console.log('10. the Meter Bridge is rebuilt after a restore:', relay);

console.log('desktop station backup dialog contracts passed');

socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
