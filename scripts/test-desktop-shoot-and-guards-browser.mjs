// End-to-end check of the desktop UI in a real browser with a stubbed Tauri IPC.
//
// The Shoot half of the action-target suite, against the real index.html script:
//   18. A running Shoot can be cancelled (`stop_test_action`), and the cancelled run is reported
//       without leaving a not-confirmed mark on the step.
//   19. A write the console did not confirm is shown as `completed_unconfirmed`, never as success,
//       and its own step row carries the mark; a confirming run clears it.
//   20. An FX parameter is offered per model, exactly the parameters that model has.
//   21. An FX step carries the model that has its key, and a name the model lacks says so.
//   25. The FX slot's model is read from the console (`read_fx_models`) when the operator arrives on
//       a slot: operator-paced, filed per slot state, with the manual field as the fallback.
//
// The other halves: `scripts/test-desktop-action-target-browser.mjs` (addressing, steps, sends,
// destinations, the model-aware catalogue re-read) and
// `scripts/test-desktop-live-reapply-and-guards-browser.mjs` (the live re-apply and the unsaved-draft
// guards). Headless Chrome on this machine wedges after roughly ninety seconds of page activity, so
// the suite is split into halves that each finish well inside that window
// (docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md).
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is closed, and
// running it directly is a no-op in that case too.
//
// Run: node scripts/test-desktop-shoot-and-guards-browser.mjs
// End-to-end check of the desktop UI in a real browser with a stubbed Tauri IPC.
//
// The run-time half of the action-target suite, against the real index.html script:
//   18. A running Shoot can be cancelled (`stop_test_action`), and the cancelled run is reported
//       without leaving a not-confirmed mark on the step.
//   19. A write the console did not confirm is shown as `completed_unconfirmed`, never as success,
//       and its own step row carries the mark; a confirming run clears it.
//   20. An FX parameter is offered per model, exactly the parameters that model has.
//   21. An FX step carries the model that has its key, and a name the model lacks says so.
//   22. A save while the session is live re-applies what the editor holds now (not what it held at
//       connect: `armed` and the draft travel refreshed).
//   23. ENABLE and the multiselect ask before they replace an unsaved draft.
//   25. The FX slot's model is read from the console when the operator arrives on the slot.
//
// Its sibling `scripts/test-desktop-action-target-browser.mjs` carries the addressing, step, send and
// destination checks (1-17) and the model-aware catalogue re-read (24): headless Chrome here wedges after roughly ninety seconds of
// page activity, so the suite is split in two halves that each finish well inside that window
// (docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md).
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is closed, and
// running it directly is a no-op in that case too.
//
// Run: node scripts/test-desktop-shoot-and-guards-browser.mjs
// End-to-end check of the desktop UI in a real browser with a stubbed Tauri IPC.
//
// Verifies, against the real index.html script:
//   1. "New macro" starts unconfigured (no usb/1/meter, no invented /ch/1/mute action).
//   2. Changing the action target channel resolves the new address before Save Draft
//      persists it (the async-resolve race that sent the previous channel's command).
//   3. Toggle mode is only selectable for on/off parameters.
//   4. Test Action (Shoot) runs the step through `test_action_step` (not raw OSC) and
//      sends the selected step with its mode intact.
//   5. The live/armed request carries the whole trigger, its destination index and the model its
//      key belongs to.
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is
// closed, and running it directly is a no-op in that case too.
//
// Run: node scripts/test-desktop-action-target-browser.mjs
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

// Use a tab of our own: this test installs its own Tauri stub and navigates, and the other
// browser test shares the debug port. Leaving the shared tab alone keeps either order green.
const target = await (
  await fetch('http://127.0.0.1:9223/json/new?about:blank', { method: 'PUT' })
).json();
assert.ok(target?.webSocketDebuggerUrl, 'could not open a Chrome tab for this test');
// The tab must not survive a failing assertion either.
process.on('exit', () => {
  try {
    // `--max-time`: a wedged browser never answers, and this exit handler would keep the process
    // alive for ever (docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md).
    execFileSync('curl', ['-s', '--max-time', '2', '-o', '/dev/null', `http://127.0.0.1:9223/json/close/${target.id}`]);
  } catch (_) {}
});

const page = target;

const socket = new WebSocket(page.webSocketDebuggerUrl);
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

/** The Win95 dialog is real state: a leftover one would be read as this check's answer. */
async function closeDialogIfOpen() {
  await evaluate(`(() => {
    const dialog = document.getElementById('win95-confirm');
    if (dialog && getComputedStyle(dialog).display !== 'none') {
      document.getElementById('win95-confirm-accept')?.click();
    }
  })()`);
  await sleep(120);
}

const CATALOG = {
  categories: [
    { key: 'ch', label: 'Channels', count: 48, group: 'Inputs', canTarget: true, canTrigger: true },
    { key: 'bus', label: 'Buses', count: 16, group: 'Inputs', canTarget: true, canTrigger: true },
    { key: 'usb', label: 'USB Audio', count: 48, group: 'Inputs', canTarget: true, canTrigger: true },
    // The talkback node, with the destination rows exactly as the backend publishes them: the three
    // assigns carry the `sendIndexLabel`/`sendIndexMax` the sends carry, so the destination control
    // must serve them without a second implementation (Maillot 1469-1496).
    { key: 'talk', label: 'Talkback', count: 2, group: 'Talkback', canTarget: true, canTrigger: true },
    // The global MAIN/ALT switch: an **index-less** category — the address is /io/altsw, never
    // /io/1/altsw — which is what the editor's category list and id seeding have to cope with.
    { key: 'io', label: 'I/O', count: 1, group: 'I/O', canTarget: true, canTrigger: true },
    // The oscillator, whose leaves carry an extra osc segment: the key resolves to
    // /io/in/OSC/1/osc/lvl, and the editor must carry whatever the backend resolved.
    { key: 'preamp_oscillator', label: 'Oscillator', count: 2, group: 'Sources', canTarget: true, canTrigger: true },
    // Batch 4. The two USB transport nodes are index-less (`/rec/$action`), so the id must not
    // reach the address; their state halves are watched and never written. The fader layers carry
    // the layer **letter** in the id segment, and the console status is the watch-only trigger the
    // batch exists for.
    { key: 'rec', label: 'USB Recorder', count: 1, group: 'Transport', canTarget: true, canTrigger: false },
    { key: 'recstate', label: 'USB Recorder State', count: 1, group: 'Transport', canTarget: false, canTrigger: true },
    { key: 'play', label: 'USB Player', count: 1, group: 'Transport', canTarget: true, canTrigger: false },
    { key: 'playstate', label: 'USB Player State', count: 1, group: 'Transport', canTarget: false, canTrigger: true },
    { key: 'layer', label: 'Fader Layers', count: 7, group: 'Surface', canTarget: true, canTrigger: true },
    { key: 'stat', label: 'Console Status', count: 1, group: 'Console', canTarget: false, canTrigger: true },
    // Batch 6, the desk level. The monitor buses carry two numbered ids (`/cfg/mon/2/pan`, 1315), the
    // AES50 node three **lettered** ones (1 = A … 3 = C, `/$stat/B/stat`, 1254-1268), the W-Live card
    // its own number (`/cards/wlive/2/$ctl/control`, 2966) and the six desk nodes — lights, safes,
    // solo, globals, desk status and cards — no id segment at all. `deskstatus` and `cards` are
    // watched and never written, so they must stay out of the step destination list.
    { key: 'lights', label: 'Desk Lights', count: 1, group: 'Console', canTarget: true, canTrigger: true },
    { key: 'safes', label: 'Safes', count: 1, group: 'Control', canTarget: true, canTrigger: true },
    { key: 'monbus', label: 'Monitor Buses', count: 2, group: 'Monitor', canTarget: true, canTrigger: true },
    { key: 'solocfg', label: 'Solo Configuration', count: 1, group: 'Monitor', canTarget: true, canTrigger: true },
    { key: 'aes50', label: 'AES50 Status', count: 3, group: 'Console', canTarget: true, canTrigger: true },
    { key: 'deskstatus', label: 'Desk Status', count: 1, group: 'Console', canTarget: false, canTrigger: true },
    { key: 'wlive', label: 'W-Live Multitrack', count: 2, group: 'Transport', canTarget: true, canTrigger: true },
    { key: 'cards', label: 'Cards', count: 1, group: 'Transport', canTarget: false, canTrigger: true },
    { key: 'globals', label: 'Global Settings', count: 1, group: 'Console', canTarget: true, canTrigger: true },
    // The FX slots: the model decides which `/fx/<slot>/<name>` parameters exist (Maillot 2896-2942),
    // so the window offers them per model instead of inventing generic names.
    { key: 'fx', label: 'FX Slots', count: 16, group: 'Control', canTarget: true, canTrigger: true },
    { key: 'custom', label: 'Custom OSC', count: 1, group: 'Advanced', canTarget: true, canTrigger: false },
  ],
  targetParametersByCategory: {
    ch: [
      { key: 'mute', label: 'Mute', argKind: 'int', valueKind: 'toggle', offLabel: 'OFF', onLabel: 'ON' },
      { key: 'alt_source', label: 'Alt Source', argKind: 'int', valueKind: 'toggle' },
      { key: 'fader', label: 'Fader', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -144, maxValue: 10 },
      // A send the flat list buried: the operator reported "faltan sends a matrices" while this key
      // was in the catalogue and resolved. It must be reachable through the picker's Sends submenu.
      { key: 'send_matrix_level', label: 'Matrix Send Level', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -144, maxValue: 10, sendIndexLabel: 'Matrix', sendIndexMax: 8 },
      // The plain catalogue spelling of a model leaf: `gate_thr` resolves to /gate/thr and its row
      // names the slot it lives in, so check 12d can assert which strip's model the step travels with.
      { key: 'gate_thr', label: 'Gate Threshold', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -60, maxValue: 10, modelSection: 'gate', modelLeaf: 'thr' },
    ],
    // A bus send is the case that needs its destination most: with no index the resolver would take
    // the bus's own send, which the console ignores (the window builds the request from this row).
    bus: [
      { key: 'send_level', label: 'Send Level', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -144, maxValue: 10, sendIndexLabel: 'Bus', sendIndexMax: 16 },
    ],
    usb: [{ key: 'mute', label: 'Mute', argKind: 'int', valueKind: 'toggle' }],
    // The assigned destination rides in `sendId`, exactly as it does for a send: `talk_bus_assign`
    // addresses bus 1…16, `talk_matrix_assign` matrix 1…8 and `talk_main_assign` main 1…4.
    talk: [
      { key: 'talk_on', label: 'Talkback On', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, offLabel: 'OFF', onLabel: 'ON' },
      { key: 'talk_bus_assign', label: 'Talkback Bus Assign', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, offLabel: 'OFF', onLabel: 'ON', sendIndexLabel: 'Bus', sendIndexMax: 16 },
      { key: 'talk_matrix_assign', label: 'Talkback Matrix Assign', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, offLabel: 'OFF', onLabel: 'ON', sendIndexLabel: 'Matrix', sendIndexMax: 8 },
      { key: 'talk_main_assign', label: 'Talkback Main Assign', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, offLabel: 'OFF', onLabel: 'ON', sendIndexLabel: 'Main', sendIndexMax: 4 },
    ],
    // The two `/io` switches, exactly as the backend publishes them.
    io: [
      { key: 'io_altsw', label: 'Main/Alt Switch', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, offLabel: 'OFF (main)', onLabel: 'ON (alt)' },
      { key: 'io_auto_alt_override', label: 'Auto Input Override', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, offLabel: 'OFF', onLabel: 'ON' },
    ],
    // The oscillator's own leaves, one `osc` segment below the category prefix. No `source_mode`
    // here: Maillot prints the oscillator's own `mode` row `[RO]` (1781), so the backend offers the
    // three `osc` leaves on this category and not the source mode (see `source_parameter_allowed`).
    preamp_oscillator: [
      { key: 'osc_level', label: 'Oscillator Level', argKind: 'float', valueKind: 'number', minValue: -40, maxValue: 6 },
      { key: 'osc_mode', label: 'Oscillator Waveform', argKind: 'string', valueKind: 'enum', options: ['SINE', 'PINK', 'WHITE'] },
      { key: 'osc_freq', label: 'Oscillator Frequency', argKind: 'float', valueKind: 'hz', unit: 'Hz', minValue: 20, maxValue: 20000 },
    ],
    // The transport leaves a step writes, and the fader layer selection. The state halves are
    // deliberately absent: their categories cannot be a step destination at all.
    rec: [{ key: 'rec_action', label: 'Recorder Action', argKind: 'string', valueKind: 'enum', options: ['STOP', 'REC', 'PAUSE', 'NEWFILE'] }],
    play: [{ key: 'play_action', label: 'Player Action', argKind: 'string', valueKind: 'enum', options: ['IDLE', 'STOP', 'PLAY', 'PAUSE', 'NEXT', 'PREV', 'PLAYFILE'] }],
    layer: [{ key: 'layer_select', label: 'Fader Layer', argKind: 'int', valueKind: 'number', minValue: 1, maxValue: 22 }],
    // Batch 6. Each category's step list carries only what a step may write: the monitor bus leaves
    // (the read-only `$lvl` is absent), the safes text leaf, AES50's `clrerr`, the W-Live `$ctl`
    // commands and the global clock rate.
    monbus: [
      { key: 'monitor_pan', label: 'Monitor Pan', argKind: 'float', valueKind: 'percent', unit: '%', minValue: -100, maxValue: 100, canTrigger: true, operators: ['<', '>', '==', '!='] },
      { key: 'monitor_dim', label: 'Monitor Dim', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: 0, maxValue: 40, canTrigger: true, operators: ['<', '>', '==', '!='] },
    ],
    safes: [{ key: 'safes_ch', label: 'Channel Safes', argKind: 'string', valueKind: 'text', maxLen: 40, canTrigger: true, operators: ['==', '!='] }],
    aes50: [{ key: 'aes50_clear_errors', label: 'Clear AES50 Errors', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, offLabel: 'OFF', onLabel: 'ON' }],
    wlive: [
      { key: 'wlive_control', label: 'W-Live Control', argKind: 'string', valueKind: 'enum', options: ['STOP', 'PPAUSE', 'PLAY', 'REC'] },
      { key: 'wlive_marker_goto', label: 'W-Live Goto Marker', argKind: 'int', valueKind: 'number', minValue: 0, maxValue: 101 },
    ],
    globals: [{ key: 'global_clock_rate', label: 'Clock Rate', argKind: 'string', valueKind: 'enum', options: ['48000.0', '44100.0'], canTrigger: true, operators: ['==', '!='] }],
    // The two catalogue keys of an FX slot (Maillot 2935, 2896-2934). The model's own `/fx/<slot>/<name>`
    // parameters are not catalogue rows: they are offered per model from `fxModelTables`, below.
    fx: [
      { key: 'fx_mix', label: 'FX Mix', argKind: 'float', valueKind: 'percent', unit: '%', minValue: 0, maxValue: 100, canTrigger: true, operators: ['<', '>', '==', '!='] },
      { key: 'fx_model', label: 'FX Model', argKind: 'string', valueKind: 'enum', options: ['NONE', 'FLANGER', 'CHORUS', 'V-IMG'], canTrigger: true, operators: ['==', '!='] },
    ],
    custom: [{ key: 'load_snapshot', label: 'Load Snapshot', argKind: 'string', valueKind: 'text' }],
  },
  triggerParametersByCategory: {
    ch: [
      { key: 'meter', label: 'Meter Level', argKind: 'float', valueKind: 'db_meter', unit: 'dB' },
      { key: 'mute', label: 'Mute', argKind: 'int', valueKind: 'toggle' },
      // The gate threshold of the DEQ2 the strip runs (published as a strip-model group for the
      // target list by check 8). The trigger and the gate are catalogue lists, so the key the
      // strip-model read published is offered here to drive the payload the backend checks it against.
      { key: 'gate:1-thr', label: 'Gate Threshold', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -60, maxValue: 10, canTrigger: true, operators: ['>', '<'] },
      // The plain catalogue key for the same leaf: `gate_thr` resolves to /gate/thr, and its row
      // names the slot the leaf lives in (`modelSection`/`modelLeaf`) instead of a model, which is
      // what lets the editor send the model the strip runs for it — check 12c arms this key and reads
      // the request the backend received.
      { key: 'gate_thr', label: 'Gate Threshold', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -60, maxValue: 10, canTrigger: true, operators: ['>', '<'], modelSection: 'gate', modelLeaf: 'thr' },
    ],
    bus: [
      { key: 'meter', label: 'Meter Level', argKind: 'float', valueKind: 'db_meter', unit: 'dB' },
      { key: 'send_level', label: 'Send Level', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -144, maxValue: 10, sendIndexLabel: 'Bus', sendIndexMax: 16, canTrigger: true, operators: ['>', '<'] },
    ],
    usb: [{ key: 'meter', label: 'Meter Level', argKind: 'float', valueKind: 'db_meter', unit: 'dB' }],
    // The `/io` switches are reported as well, so both are watchable.
    io: [
      { key: 'io_altsw', label: 'Main/Alt Switch', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, canTrigger: true, operators: ['==', '!='] },
      { key: 'io_auto_alt_override', label: 'Auto Input Override', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, canTrigger: true, operators: ['==', '!='] },
    ],
    preamp_oscillator: [
      { key: 'meter', label: 'Meter Level', argKind: 'float', valueKind: 'db_meter', unit: 'dB' },
      { key: 'osc_level', label: 'Oscillator Level', argKind: 'float', valueKind: 'number', minValue: -40, maxValue: 6, canTrigger: true, operators: ['<', '>', '==', '!='] },
    ],
    // The transport state and the desk status: reported, never written. `rec` and `play` are absent
    // because the console does not read their leaves back, so they are no watch at all.
    recstate: [
      { key: 'rec_state', label: 'Recorder State', argKind: 'string', valueKind: 'enum', options: ['STOP', 'REC', 'PAUSE', 'ERROR'], canTrigger: true, operators: ['==', '!='] },
      { key: 'rec_time', label: 'Recorder Time', argKind: 'float', valueKind: 'number', minValue: 0, maxValue: 1000000000, canTrigger: true, operators: ['<', '>', '==', '!='] },
    ],
    playstate: [
      { key: 'play_state', label: 'Player State', argKind: 'string', valueKind: 'enum', options: ['STOP', 'PLAY', 'PAUSE', 'ERROR'], canTrigger: true, operators: ['==', '!='] },
      { key: 'play_position', label: 'Player Position', argKind: 'float', valueKind: 'number', minValue: 0, maxValue: 35999, canTrigger: true, operators: ['<', '>', '==', '!='] },
    ],
    stat: [
      { key: 'selected_strip', label: 'Selected Strip', argKind: 'int', valueKind: 'number', minValue: 1, maxValue: 76, canTrigger: true, operators: ['<', '>', '==', '!='] },
      { key: 'selected_page', label: 'Selected Page', argKind: 'int', valueKind: 'number', minValue: 0, maxValue: 30, canTrigger: true, operators: ['<', '>', '==', '!='] },
    ],
    layer: [
      { key: 'layer_select', label: 'Fader Layer', argKind: 'int', valueKind: 'number', minValue: 1, maxValue: 22, canTrigger: true, operators: ['<', '>', '==', '!='] },
    ],
    // Batch 6. The watch lists hold the read-only rows: the monitor level (`$lvl`, footnote 13) beside
    // the reported `pan`, the AES50 link health, the W-Live state, the card type and the signed clock
    // ppm. `deskstatus` and `cards` exist here alone — neither can be a step destination.
    monbus: [
      { key: 'monitor_level', label: 'Monitor Level', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -144, maxValue: 10, canTrigger: true, operators: ['<', '>', '==', '!='] },
      { key: 'monitor_invert', label: 'Monitor Invert', argKind: 'int', valueKind: 'toggle', minValue: 0, maxValue: 1, canTrigger: true, operators: ['==', '!='] },
    ],
    aes50: [
      { key: 'aes50_state', label: 'AES50 State', argKind: 'string', valueKind: 'enum', options: ['-', 'OK', 'ERR', 'UPD'], canTrigger: true, operators: ['==', '!='] },
      { key: 'aes50_errors_corrected', label: 'AES50 Corrected Errors', argKind: 'int', valueKind: 'number', minValue: 0, maxValue: 9999, canTrigger: true, operators: ['<', '>', '==', '!='] },
    ],
    wlive: [
      { key: 'wlive_state', label: 'W-Live State', argKind: 'string', valueKind: 'enum', options: ['STOP', 'PPAUSE', 'PLAY', 'REC'], canTrigger: true, operators: ['==', '!='] },
    ],
    cards: [
      { key: 'cards_type', label: 'Card Type', argKind: 'string', valueKind: 'enum', options: ['NONE', 'WLIVE', 'WDANTE', 'WMADI', 'WDWSG'], canTrigger: true, operators: ['==', '!='] },
    ],
    deskstatus: [
      { key: 'desk_ppm', label: 'Clock PPM', argKind: 'int', valueKind: 'number', minValue: -200, maxValue: 200, canTrigger: true, operators: ['<', '>', '==', '!='] },
    ],
    safes: [{ key: 'safes_ch', label: 'Channel Safes', argKind: 'string', valueKind: 'text', maxLen: 40, canTrigger: true, operators: ['==', '!='] }],
    globals: [
      { key: 'global_clock_rate', label: 'Clock Rate', argKind: 'string', valueKind: 'enum', options: ['48000.0', '44100.0'], canTrigger: true, operators: ['==', '!='] },
    ],
  },
  // Two models that both carry a `thr`, with different ranges: the metadata must come from the
  // model the selected optgroup names, never from the first match in the list.
  pluginModels: [
    { model: 'DEQ2', label: 'Graphic EQ', parameters: [
      { key: '1-thr', label: 'Threshold', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -60, maxValue: 10, step: 0.5 },
    ] },
    { model: 'GATE', label: 'Gate', parameters: [
      { key: 'thr', label: 'Threshold', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -80, maxValue: 0, step: 0.5 },
      { key: 'att', label: 'Attack', argKind: 'int', valueKind: 'number', minValue: 0, maxValue: 120, step: 1 },
    ] },
    // The appendix tables of three effect models, under the names the console reports. `mix` is in two
    // of them on purpose: 129 of the appendix names are shared by more than one model, which is why a
    // name can only be offered together with the model it belongs to.
    { model: 'FLANGER', label: 'Stereo Flanger', parameters: [
      { key: 'flc', label: 'Feedback Low Cut', argKind: 'float', valueKind: 'hz', unit: 'Hz', minValue: 20, maxValue: 400, step: 7.6, operators: ['<', '>', '==', '!='] },
      { key: 'mix', label: 'Mix', argKind: 'float', valueKind: 'percent', unit: '%', minValue: 0, maxValue: 100, step: 1, operators: ['<', '>', '==', '!='] },
    ] },
    { model: 'CHORUS', label: 'Chorus', parameters: [
      { key: 'mix', label: 'Mix', argKind: 'float', valueKind: 'percent', unit: '%', minValue: 0, maxValue: 100, step: 1, operators: ['<', '>', '==', '!='] },
      { key: 'sprd', label: 'Spread', argKind: 'float', valueKind: 'percent', unit: '%', minValue: 0, maxValue: 100, step: 1, operators: ['<', '>', '==', '!='] },
    ] },
    { model: 'V_IMG', label: 'Velvet Imager', parameters: [
      { key: 'mode', label: 'Mode', argKind: 'int', valueKind: 'number', minValue: 0, maxValue: 3, step: 1, operators: ['<', '>', '==', '!='] },
    ] },
  ],
  // What `/fx/<slot>/mdl` reports, and the appendix table that documents each model: the console's
  // spelling of three of them (`ROOM`, `DEL/REV`, `V-IMG`) is not the appendix's, so the window has to
  // resolve the model it was told instead of searching `pluginModels` by name.
  fxModelTables: [
    { model: 'FLANGER', table: 'FLANGER', label: 'Stereo Flanger' },
    { model: 'CHORUS', table: 'CHORUS', label: 'Chorus' },
    { model: 'V-IMG', table: 'V_IMG', label: 'Velvet Imager' },
  ],
};
const DEFAULT_CONFIG = {
  name: 'New WING macro', wingIp: '192.168.1.10', triggerCategory: 'usb', triggerIds: '1',
  triggerParameter: 'meter', triggerOperator: '>', triggerEdgeMode: 'on', triggerThreshold: -18,
  triggerMeterMode: 'transient', triggerMeterCooldownMs: 0, triggerMeterRearmDb: 3,
  triggerMeterDwellMs: 0, triggerMeterStaleAfterMs: 1500, macroOverlapStrategy: 'drop',
  logicalOperator: 'AND', conditions: [], enabled: false, armed: false,
  actionSteps: [{ label: 'Mute CH 1', actionAddress: '/ch/1/mute', actionArgKind: 'int',
    actionValue: '1', actionMode: 'set', targetCategory: 'ch', targetIds: '1',
    targetParameter: 'mute', sendId: 1, enabled: true }],
};

await call('Page.enable');
// The visible tab, not a background one: Chrome throttles the timers of a hidden tab (350 ms becomes
// seconds, and after five minutes it drops to one timer a minute), and every check below is built on
// `setTimeout` — a backgrounded tab turned a two-minute run into a wedged one.
await call('Page.bringToFront');
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__INVOKES = [];
    const CATALOG = ${JSON.stringify(CATALOG)};
    const DEFAULT_CONFIG = ${JSON.stringify(DEFAULT_CONFIG)};
    let savedLibrary = null;
    window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          window.__INVOKES.push({ cmd, args });
          if (cmd === 'target_catalog') return CATALOG;
          // This half starts with an empty macro library, so the editor is born from the show
          // configuration: the real load_show_runner_config answers it, and the stub must too.
          if (cmd === 'default_show_runner_config' || cmd === 'load_show_runner_config') return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
          if (cmd === 'load_macro_library') return savedLibrary || { schemaVersion: 1, selectedIndex: 0, macros: [] };
          if (cmd === 'save_macro_library') {
            savedLibrary = args.library;
            window.__SAVED_LIBRARY = JSON.parse(JSON.stringify(args.library));
            return args.library;
          }
          if (cmd === 'resolve_basic_target') {
            const r = args.request || {};
            if (r.category === 'custom') return { addresses: r.customAddress ? [r.customAddress] : [] };
            if (!r.category) return { addresses: [] };
            // The talkback node, addressed the way the backend resolver does: the id becomes the
            // letter (1 = A, 2 = B) and the assign's destination index names the leaf (B5, MX3, M1).
            if (r.category === 'talk') {
              const letter = r.ids === '2' ? 'B' : 'A';
              const assign = { talk_bus_assign: ['B', 16], talk_matrix_assign: ['MX', 8], talk_main_assign: ['M', 4] }[r.parameter];
              const leaf = assign ? assign[0] + Number(r.sendId || 1) : r.parameter;
              return { addresses: ['/cfg/talk/' + letter + '/' + leaf] };
            }
            // The index-less /io node: /io/altsw, with no id segment at all — the id the panel
            // happens to hold is not part of the address (the backend's CategoryIdSegment::Absent).
            if (r.category === 'io') return { addresses: ['/io/' + r.parameter.replace(/^io_/, '')] };
            // The USB transport (batch 4): two index-less nodes, so /rec/$action carries no id.
            if (['rec', 'recstate', 'play', 'playstate'].includes(r.category)) {
              const leaf = {
                rec_action: '/$action', rec_path: '/path', rec_resolution: '/resolution', rec_channels: '/channels',
                rec_state: '/$actstate', rec_time: '/$time',
                play_action: '/$action', play_file: '/$playfile', play_repeat: '/repeat',
                play_state: '/$actstate', play_position: '/$pos',
              }[r.parameter];
              return { addresses: leaf ? ['/' + r.category + leaf] : [] };
            }
            // The fader layers: the id selects the surface and the **letter** is the path segment
            // (/$ctl/layer/C/sel). An eighth id names no surface and resolves to nothing.
            if (r.category === 'layer') {
              const letters = ['L', 'C', 'R', 'CMPCT', 'RCK', 'EXT', 'VRT'];
              const letter = letters[Number(String(r.ids || '').split(',')[0].trim()) - 1];
              return { addresses: letter && r.parameter === 'layer_select' ? ['/$ctl/layer/' + letter + '/sel'] : [] };
            }
            // The desk status is index-less as well, and read-only: a watch, never a step.
            if (r.category === 'stat') {
              const leaf = { selected_strip: '/selidx', selected_page: '/pageidx' }[r.parameter];
              return { addresses: leaf ? ['/$ctl/$stat' + leaf] : [] };
            }
            // Batch 6, the desk level. The business the editor must not do itself: the AES50 ports are
            // addressed by the **letter** (1 = A, 2 = B, 3 = C — an id 4 names no port and resolves to
            // nothing), the six desk nodes are index-less (/$ctl/safes/ch, never /$ctl/safes/1/ch)
            // and the monitor and card nodes keep their number.
            if (r.category === 'aes50') {
              const port = ['A', 'B', 'C'][Number(String(r.ids || '').split(',')[0].trim()) - 1];
              const leaf = {
                aes50_state: '/stat', aes50_device: '/dev',
                aes50_errors_corrected: '/errorsc', aes50_errors_uncorrected: '/errorsu',
                aes50_clear_errors: '/clrerr',
              }[r.parameter];
              return { addresses: port && leaf ? ['/$stat/' + port + leaf] : [] };
            }
            if (['lights', 'safes', 'solocfg', 'globals'].includes(r.category)) {
              const node = {
                lights: { prefix: '/$ctl/cfg/lights', leaves: { lights_btns: '/btns', lights_leds: '/leds' } },
                safes: { prefix: '/$ctl/safes', leaves: { safes_ch: '/ch', safes_area_left: '/area/LEFT' } },
                solocfg: { prefix: '/cfg/solo', leaves: { solo_mode: '/mode', solo_dim: '/$dim' } },
                globals: { prefix: '/$globals', leaves: { global_clock_rate: '/clkrate', global_start_mute: '/startmute' } },
              }[r.category];
              const leaf = node.leaves[r.parameter];
              return { addresses: leaf ? [node.prefix + leaf] : [] };
            }
            if (['deskstatus', 'cards'].includes(r.category)) {
              const leaf = {
                desk_lock: '/$stat/lock', desk_ppm: '/$stat/ppm',
                cards_type: '/cards/$type', cards_version: '/cards/$ver',
              }[r.parameter];
              return { addresses: leaf ? [leaf] : [] };
            }
            if (r.category === 'monbus') {
              const id = String(r.ids || '1').split(',')[0].trim();
              const leaf = { monitor_level: '/$lvl', monitor_invert: '/inv', monitor_pan: '/pan', monitor_dim: '/dim' }[r.parameter];
              return { addresses: leaf ? ['/cfg/mon/' + id + leaf] : [] };
            }
            if (r.category === 'wlive') {
              const id = String(r.ids || '1').split(',')[0].trim();
              const leaf = {
                wlive_control: '/$ctl/control', wlive_open_session: '/$ctl/opensession',
                wlive_marker_goto: '/$ctl/gotomarker', wlive_marker_set: '/$ctl/setmarker',
                wlive_format_card: '/$ctl/formatsdcard', wlive_state: '/$stat/state',
              }[r.parameter];
              return { addresses: leaf ? ['/cards/wlive/' + id + leaf] : [] };
            }
            // The FX slot: fx_mix is /fxmix and fx_model is /mdl, while a model parameter
            // (fx:flc) is the leaf itself, /fx/1/flc (Maillot 2896-2942).
            if (r.category === 'fx') {
              const id = String(r.ids || '1').split(',')[0].trim();
              const parameter = String(r.parameter || '');
              if (parameter === 'fx_mix') return { addresses: ['/fx/' + id + '/fxmix'] };
              if (parameter === 'fx_model') return { addresses: ['/fx/' + id + '/mdl'] };
              const name = parameter.startsWith('fx:') ? parameter.slice(3) : '';
              return { addresses: name ? ['/fx/' + id + '/' + name] : [] };
            }
            // The oscillator's source node, one osc segment below the category prefix. The editor
            // must carry this address, never build it from the prefix and the key.
            if (r.category === 'preamp_oscillator') {
              const leaf = { osc_level: 'osc/lvl', osc_mode: 'osc/mode', osc_freq: 'osc/f', source_mode: 'mode' }[r.parameter];
              return { addresses: leaf ? ['/io/in/OSC/' + String(r.ids || '1').split(',')[0].trim() + '/' + leaf] : [] };
            }
            return { addresses: String(r.ids || '1').split(',').map((id) => '/' + r.category + '/' + id.trim() + '/' + r.parameter) };
          }
          if (cmd === 'test_action_step') {
            window.__TEST_ACTION = JSON.parse(JSON.stringify(args));
            // A real Shoot can last up to a minute (a wait or a fade is sent step by step), which is
            // what the cancel path exists for; the checks that only need the request leave this at 0
            // and get an answer at once.
            const slowMs = Number(window.__TEST_ACTION_SLOW_MS || 0);
            const status = window.__TEST_ACTION_STATUS || 'completed';
            const unconfirmed = Number(window.__TEST_ACTION_UNCONFIRMED || 0);
            // The run result carries one row per step with the backend's own per-step vocabulary
            // (confirmed, unconfirmed, interrupted, not_verifiable, not_attempted — master plan
            // 2026-09-22, item 17), and it is what the window marks the step row from (checks 18 and
            // 19). A cancelled run leaves its step interrupted, never unconfirmed.
            const stepStatus = status === 'completed_unconfirmed' ? 'unconfirmed'
              : status === 'cancelled' ? 'interrupted' : 'confirmed';
            const result = {
              status, target: 'stub', bytes: 1, packets: 1, packet_hex: '',
              verification_mismatch_count: unconfirmed,
              steps: [{
                index: 0,
                label: 'Step 1',
                address: String(args?.config?.actionSteps?.[0]?.actionAddress || ''),
                mode: String(args?.config?.actionSteps?.[0]?.actionMode || 'set'),
                status: stepStatus,
              }],
            };
            if (!slowMs) return result;
            window.__TEST_ACTION_RUNNING = true;
            return new Promise((resolve) => {
              window.__TEST_ACTION_FINISH = (stopped) => {
                window.__TEST_ACTION_RUNNING = false;
                window.__TEST_ACTION_FINISH = null;
                // A stop the operator asked for marks the step that was in flight as interrupted, the
                // way the backend's cancel path does: the write went out and this run does not claim
                // the console confirmed it (master plan 2026-09-22, item 17).
                resolve(stopped
                  ? { ...result, status: 'cancelled', steps: result.steps.map((step) => ({ ...step, status: 'interrupted' })) }
                  : result);
              };
              setTimeout(() => { if (window.__TEST_ACTION_FINISH) window.__TEST_ACTION_FINISH(false); }, slowMs);
            });
          }
          if (cmd === 'stop_test_action') {
            window.__STOP_TEST_ACTION_CALLS = (window.__STOP_TEST_ACTION_CALLS || 0) + 1;
            if (typeof window.__TEST_ACTION_FINISH !== 'function') return false;
            const finish = window.__TEST_ACTION_FINISH;
            window.__TEST_ACTION_FINISH = null;
            finish(true);
            return true;
          }
          if (cmd === 'read_strip_models') {
            // The read is per strip: recorded, because which strip was read is half of what the
            // editor must get right (check 12d). ch/1 runs DEQ2 in its gate slot, ch/3 runs GATE —
            // so 1-thr exists on one strip and thr on the other, and a model taken from the wrong
            // strip makes the backend refuse a valid macro or pass an invalid one.
            window.__STRIP_READS = window.__STRIP_READS || [];
            window.__STRIP_READS.push({ family: args.family, ids: String(args.ids) });
            const id = String(args.ids).split(',')[0].trim();
            const perStrip = { 'ch:1': 'DEQ2', 'ch:3': 'GATE' };
            const model = perStrip[args.family + ':' + id] || 'DEQ2';
            return [{ address: '/' + args.family + '/' + id + '/gate/mdl', family: args.family, id: Number(id), section: 'gate', model, error: null, elapsedMillis: 1 }];
          }
          if (cmd === 'read_fx_models') {
            // The FX slot's model read (check 25). Recorded with the slot list it was asked for —
            // that list is what the window must take from the ids field, bounded by the backend's
            // own eight-slot limit — and answered in the three shapes the backend's DTO really
            // carries: a model under the console's own spelling, the word NONE for an empty slot
            // (what a desk with nothing loaded answers, measured on a WING Rack 2026-09-27), and a
            // row with no model at all for a slot that stayed silent.
            window.__FX_READS = window.__FX_READS || [];
            window.__FX_READS.push({ slots: String(args.slots) });
            const answers = { 1: 'FLANGER', 4: 'V-IMG', 2: 'NONE' };
            return String(args.slots).split(',').map((raw) => {
              const id = Number(String(raw).trim());
              const answer = answers[id];
              const row = { address: '/fx/' + id + '/mdl', family: 'fx', id, section: 'mdl', model: null,
                slotState: 'silent', error: 'no answer', elapsedMillis: 250 };
              if (answer === 'NONE') return { ...row, slotState: 'empty', error: null, elapsedMillis: 5 };
              if (answer) return { ...row, model: answer, slotState: 'model', error: null, elapsedMillis: 5 };
              return row;
            });
          }
          if (cmd === 'preflight_show_runner_config') {
            window.__PREFLIGHT_CALLS = (window.__PREFLIGHT_CALLS || 0) + 1;
            // The real command answers with the normalised draft it judged, and arming applies it:
            // without it the arm path threw and no check could ever see an armed draft.
            return {
              ok: window.__PREFLIGHT_OK !== false,
              messages: window.__PREFLIGHT_MESSAGES || [],
              normalizedConfig: window.__PREFLIGHT_OK === false ? null : JSON.parse(JSON.stringify(args.config)),
            };
          }
          if (cmd === 'start_wing_usb_stream') {
            window.__STREAM_STARTS = (window.__STREAM_STARTS || 0) + 1;
            window.__LAST_STREAM_REQUEST = JSON.parse(JSON.stringify(args));
            setTimeout(() => {
              const handler = (window.__LISTENERS || {})['usb-meter-stream-status'];
              if (handler) handler({ payload: { state: 'live', message: 'stub live' } });
            }, 0);
            return {};
          }
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
const fileUrl = new URL('../desktop/ui/index.html', import.meta.url).href;
await call('Page.navigate', { url: fileUrl });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && Boolean(document.getElementById("library-new"))')) break;
  await sleep(100);
}
assert.equal(await evaluate('typeof window.__TAURI__'), 'object', 'the stub must own the IPC layer');
const pressKey = async (key, code, keyCode) => {
  // `keyDown` with the text Enter carries, not `rawKeyDown`: the browser's own default action for
  // Enter — the click on the focused button — needs the full keyboard event.
  const text = key === 'Enter' ? '\r' : undefined;
  const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await call('Input.dispatchKeyEvent', { type: 'keyDown', ...common, ...(text ? { text, unmodifiedText: text } : {}) });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  await sleep(220);
};

// --- 18. A running Shoot can be cancelled, and an unconfirmed write is never read as a success ---
// The command runs on the backend for as long as the step takes (a wait or a fade is sent step by
// step) and the window awaits it, so the button that fired it is also the cancel: clicking it raises
// the run's own flag through `stop_test_action` and the run comes back `cancelled` (master plan
// 2026-09-22, §3.2 item 4). Nothing may reach the console after that.
const cancelStart = await evaluate(`(async () => {
  window.__TEST_ACTION = null;
  window.__STOP_TEST_ACTION_CALLS = 0;
  window.__TEST_ACTION_STATUS = 'completed';
  window.__TEST_ACTION_SLOW_MS = 6000;
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const shoot = document.getElementById('send-osc');
  const before = { label: shoot.textContent, disabled: shoot.disabled };
  shoot.click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const dialog = document.getElementById('win95-confirm');
  return { before, dialogOpen: getComputedStyle(dialog).display !== 'none' };
})()`);
await closeDialogIfOpen();
const running = await evaluate(`(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const shoot = document.getElementById('send-osc');
  return {
    running: window.__TEST_ACTION_RUNNING === true,
    label: shoot.textContent,
    title: shoot.title,
    clicked: Boolean(window.__TEST_ACTION),
  };
})()`);
assert.equal(running.clicked, true, 'the Shoot must reach the backend before it can be cancelled');
assert.equal(running.running, true, `the run must be in flight (dialog was ${cancelStart.dialogOpen ? 'accepted' : 'not drawn'})`);
assert.equal(running.label, '■ Cancel test action', `the button that fired the run must offer the cancel (got "${running.label}")`);
assert.match(running.title, /stop the test action/i, `the cancel must say what it does (got "${running.title}")`);

const cancelled = await evaluate(`(async () => {
  document.getElementById('send-osc').click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  const shoot = document.getElementById('send-osc');
  return {
    stopCalls: window.__STOP_TEST_ACTION_CALLS || 0,
    stillRunning: window.__TEST_ACTION_RUNNING === true,
    label: shoot.textContent,
    output: document.getElementById('osc-output').textContent,
    log: logLines.slice(-6).join('\\n'),
    // A stop the operator asked for is interrupted, which is not a write the console refused: it
    // must not leave the not-confirmed mark behind (master plan 2026-09-22, item 17).
    marked: document.querySelectorAll('#action-steps-list .step-row.is-unconfirmed').length,
  };
})()`);
assert.equal(cancelled.stopCalls, 1, 'the cancel must call stop_test_action, exactly once');
assert.equal(cancelled.stillRunning, false, 'the cancelled run must have finished');
assert.match(cancelled.output, /cancelled before it finished/i,
  `the window must say the step was stopped (got "${cancelled.output}")`);
assert.match(cancelled.output, /"status": "cancelled"/,
  `the result the backend returned must be shown as it is (got "${cancelled.output}")`);
assert.match(cancelled.log, /test_action_cancel_requested stopped=true/,
  `the cancel must be logged with what the backend answered (got "${cancelled.log}")`);
assert.match(cancelled.log, /step_status=interrupted/,
  `the cancelled step's own status must be logged (got "${cancelled.log}")`);
assert.equal(cancelled.marked, 0, 'a cancelled run must not mark its step as unconfirmed');
assert.equal(cancelled.label, '▶ Test Action (Shoot)',
  `the button must go back to shooting once the run is over (got "${cancelled.label}")`);
await closeDialogIfOpen();
console.log('18. Shoot cancel:', JSON.stringify({ running: running.label, stopCalls: cancelled.stopCalls, output: cancelled.output.split('\\n')[0] }));

// A write the console did not confirm is never printed as a clean success: the run reports
// `completed_unconfirmed` and the operator is told how many writes the console ignored (master plan
// 2026-09-22, item 13).
const unconfirmed = await evaluate(`(async () => {
  window.__TEST_ACTION = null;
  window.__TEST_ACTION_SLOW_MS = 0;
  window.__TEST_ACTION_STATUS = 'completed_unconfirmed';
  window.__TEST_ACTION_UNCONFIRMED = 2;
  document.getElementById('send-osc').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const dialog = document.getElementById('win95-confirm');
  const rows = [...document.querySelectorAll('#action-steps-list .step-row')];
  const marked = rows.filter((row) => row.classList.contains('is-unconfirmed'));
  return {
    output: document.getElementById('osc-output').textContent,
    dialogOpen: getComputedStyle(dialog).display !== 'none',
    dialogTitle: document.getElementById('win95-confirm-title').textContent,
    dialogMessage: document.getElementById('win95-confirm-message').textContent,
    log: logLines.slice(-4).join('\\n'),
    marked: marked.length,
    markStep: marked[0]?.dataset.stepIdx || '',
    markText: marked[0]?.querySelector('.step-run-mark')?.textContent || '',
    markTitle: marked[0]?.title || '',
  };
})()`);
assert.match(unconfirmed.output, /did not confirm 2 write\(s\)/,
  `an unconfirmed run must say so instead of showing raw JSON (got "${unconfirmed.output}")`);
assert.equal(unconfirmed.dialogOpen, true, 'an unconfirmed write must be put in front of the operator');
assert.match(unconfirmed.dialogTitle, /did not confirm/i, `the dialog must name the problem (got "${unconfirmed.dialogTitle}")`);
assert.match(unconfirmed.dialogMessage, /ignored 2 of its writes/, `the dialog must carry the count (got "${unconfirmed.dialogMessage}")`);
assert.match(unconfirmed.log, /status=completed_unconfirmed unconfirmed=2/,
  `the log must carry the status (got "${unconfirmed.log}")`);
// The verification travels to the step, not only to the run (master plan 2026-09-22, item 17): the
// step's own row is marked, and the ScreenTip carries the run's word for it.
assert.match(unconfirmed.log, /step_status=unconfirmed/,
  `the log must carry the step's own status (got "${unconfirmed.log}")`);
assert.equal(unconfirmed.marked, 1,
  `exactly the step the console did not confirm must be marked (got ${unconfirmed.marked})`);
assert.equal(unconfirmed.markText, '!', `the mark must be visible on the row (got "${unconfirmed.markText}")`);
assert.match(unconfirmed.markTitle, /unconfirmed/i,
  `the marked row must say what it means (got "${unconfirmed.markTitle}")`);
await closeDialogIfOpen();
await evaluate(`window.__TEST_ACTION_SLOW_MS = 0; window.__TEST_ACTION_STATUS = 'completed'; window.__TEST_ACTION_UNCONFIRMED = 0;`);
// A run the console did confirm leaves no mark: the mark describes the last run of that step, it is
// not a permanent accusation.
const markCleared = await evaluate(`(async () => {
  document.getElementById('send-osc').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    marked: document.querySelectorAll('#action-steps-list .step-row.is-unconfirmed').length,
    marks: document.querySelectorAll('#action-steps-list .step-run-mark').length,
    output: document.getElementById('osc-output').textContent,
  };
})()`);
assert.match(markCleared.output, /"status": "completed"/,
  `the confirming run must be reported as completed (got "${markCleared.output}")`);
assert.equal(markCleared.marked, 0, 'a run the console confirmed must clear the not-confirmed mark');
assert.equal(markCleared.marks, 0, 'the mark itself must be gone from the list, not only its class');
console.log('19. Unconfirmed write:', JSON.stringify({ dialog: unconfirmed.dialogTitle, output: unconfirmed.output.split('\\n')[0], mark: unconfirmed.markText }));

// --- 20. An FX parameter is offered per model, and the model travels with the step ---------------
// A model's `/fx/<slot>/<name>` parameters exist only for that model (Maillot 2896-2942): the panel
// names the model, the grouped picker offers exactly its names, and the step carries the model so the
// backend can refuse a name the model does not have instead of writing it into silence.
const fxPicker = await evaluate(`(async () => {
  const category = document.getElementById('target-category');
  category.value = 'fx';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  const ids = document.getElementById('target-ids');
  ids.value = '1';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  const field = document.getElementById('fx-model-field');
  const model = document.getElementById('fx-model');
  const param = document.getElementById('target-parameter');
  const read = () => ({
    hidden: field.classList.contains('hidden'),
    models: [...model.options].map((option) => option.value).filter(Boolean),
    groups: [...param.querySelectorAll('optgroup')].map((group) => ({
      model: group.dataset.stripModel,
      label: group.label,
      keys: [...group.querySelectorAll('option')].map((option) => option.value),
    })),
    menuGroups: (() => {
      // The panel is built when it opens, from the very options the select holds.
      document.getElementById('target-parameter-menu')?.click();
      const panel = document.getElementById('target-parameter-menu-list');
      const labels = [...(panel?.querySelectorAll('.parameter-menu-row') || [])].map((row) => row.textContent.trim());
      document.getElementById('target-parameter-menu')?.click();
      return labels;
    })(),
  });
  const unconfigured = read();
  model.value = 'FLANGER';
  model.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const flanger = read();
  return { unconfigured, flanger };
})()`);
assert.equal(fxPicker.unconfigured.hidden, false, 'the FX model field must be on screen for the FX category');
assert.deepEqual(fxPicker.unconfigured.models, ['FLANGER', 'CHORUS', 'V-IMG'],
  `the model list must be the console's own names (got ${JSON.stringify(fxPicker.unconfigured.models)})`);
assert.deepEqual(fxPicker.unconfigured.groups, [],
  'no model named means no model parameters: the catalogue keys alone are not a model (see next check)');
assert.ok(fxPicker.flanger.groups.some((group) => group.model === 'fx:FLANGER'),
  `the chosen model's parameters must be offered as its own group (got ${JSON.stringify(fxPicker.flanger.groups)})`);
assert.ok(fxPicker.flanger.menuGroups.some((label) => label.includes('FX · FLANGER')),
  `the grouped picker must show the model by name (got ${JSON.stringify(fxPicker.flanger.menuGroups)})`);
assert.deepEqual(
  fxPicker.flanger.groups.find((group) => group.model === 'fx:FLANGER')?.keys,
  ['fx:flc', 'fx:mix'],
  'the group must hold exactly the parameters the model has',
);
assert.ok(
  !fxPicker.flanger.groups.some((group) => (group.keys || []).includes('fx:sprd')),
  'a parameter of another model must not be offered for this one',
);
console.log('20. FX model list:', JSON.stringify({ models: fxPicker.unconfigured.models.length, groups: fxPicker.flanger.groups.length }));
await closeDialogIfOpen();

const fxStep = await evaluate(`(async () => {
  const model = document.getElementById('fx-model');
  const param = document.getElementById('target-parameter');
  const choose = async (key) => {
    const option = [...param.querySelectorAll('optgroup option')].find((item) => item.value === key);
    if (!option) return false;
    option.selected = true;
    param.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    return true;
  };
  const choseFlc = await choose('fx:flc');
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  const library = window.__SAVED_LIBRARY;
  const saved = library.macros[library.selectedIndex].actionSteps[0];
  // The other model has no flc: the group is rebuilt from CHORUS and the key that is not in it is
  // kept, labelled with the model that does not have it, so the operator is not shown a parameter
  // CHORUS cannot take.
  model.value = 'CHORUS';
  model.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const keptLabel = [...param.options].find((option) => option.value === 'fx:flc')?.textContent || '';
  const chorusKeys = [...param.querySelectorAll('optgroup[data-strip-model="fx:CHORUS"] option')].map((option) => option.value);
  const choseMix = await choose('fx:mix');
  const mixModel = [...param.options].find((option) => option.value === 'fx:mix')?.parentElement?.dataset?.stripModel || '';
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  const relibrary = window.__SAVED_LIBRARY;
  const resaved = relibrary.macros[relibrary.selectedIndex].actionSteps[0];
  return {
    choseFlc,
    saved: { key: saved.targetParameter, model: saved.targetModel, address: saved.actionAddress },
    keptLabel,
    chorusKeys,
    choseMix,
    mixModel,
    resaved: { key: resaved.targetParameter, model: resaved.targetModel, address: resaved.actionAddress },
    dialog: getComputedStyle(document.getElementById('win95-confirm')).display !== 'none'
      ? document.getElementById('win95-confirm-title').textContent : '',
  };
})()`);
assert.equal(fxStep.choseFlc, true, 'the model group must offer the parameter the operator is looking for');
assert.equal(fxStep.saved.key, 'fx:flc', `the step must name the model's parameter (got ${JSON.stringify(fxStep.saved)})`);
assert.equal(fxStep.saved.model, 'FLANGER', `the step must travel with the model that has it (got ${JSON.stringify(fxStep.saved)})`);
assert.equal(fxStep.saved.address, '/fx/1/flc', `the address must be the model's own leaf (got "${fxStep.saved.address}")`);
assert.deepEqual(fxStep.chorusKeys, ['fx:mix', 'fx:sprd'], 'the new model must offer its own parameters');
assert.match(fxStep.keptLabel, /has no parameter called flc/,
  `a key the chosen model does not have must say so (got "${fxStep.keptLabel}")`);
assert.equal(fxStep.choseMix, true, 'the new model must offer the parameter it shares');
assert.equal(fxStep.mixModel, 'fx:CHORUS', `the shared name must come from the model on screen (got "${fxStep.mixModel}")`);
assert.equal(fxStep.resaved.model, 'CHORUS', `naming another model must rewrite the step's model (got ${JSON.stringify(fxStep.resaved)})`);
assert.equal(fxStep.dialog, '', `a valid FX step must save without a refusal (got "${fxStep.dialog}")`);
console.log('21. FX step:', JSON.stringify({ saved: fxStep.saved, resaved: fxStep.resaved, kept: fxStep.keptLabel }));
await closeDialogIfOpen();

// --- 25. The FX slot's model is read from the console, once, when the operator arrives -----------
// `/fx/<slot>/mdl` is a leaf of the slot itself — "FX 1 model (see Appendix for details, graphics and
// parameter values)" (Maillot 2895-2940) — so it is not part of the strip sweep: `read_fx_models` is
// the command that answers it, one round trip per slot named and bounded by the backend's own
// eight-slot limit. What the window has to get right (master plan 2026-09-22, §12, "Decided
// (2026-09-27), not yet wired"): ask when the panel is pointed at a slot — operator-paced, never per
// frame and never a read per keystroke — file the answer (a model fills the empty field so the picker
// offers that model's own parameters, `NONE` says the slot is empty, silence leaves the manual field
// to the operator), and say what it is waiting for while the console answers.
const fxSlotRead = await evaluate(`(async () => {
  const category = document.getElementById('target-category');
  const ids = document.getElementById('target-ids');
  const select = document.getElementById('fx-model');
  const param = document.getElementById('target-parameter');
  const hint = () => document.getElementById('fx-model-hint').textContent;
  const reads = () => (window.__FX_READS || []).map((entry) => entry.slots);
  const groups = () => [...param.querySelectorAll('optgroup')].map((group) => ({
    model: group.dataset.stripModel,
    keys: [...group.querySelectorAll('option')].map((option) => option.value),
  }));
  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  category.value = 'fx';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  const before = reads().length;
  ids.value = '4';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  // A keystroke more in the same field: still one read, for the list the field settled on.
  ids.value = '4';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  const waiting = {
    newReads: reads().length - before,
    hint: hint(),
    model: select.value,
    fieldDisabled: select.disabled,
  };
  await settle(700);
  const answered = { reads: reads().slice(before), model: select.value, hint: hint(), groups: groups() };
  // An empty slot: the console answers NONE, which is not a model to name.
  ids.value = '2';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(700);
  const empty = { model: select.value, hint: hint() };
  // A slot that stays silent: the manual field is the fallback, and naming a model still offers it.
  ids.value = '3';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(700);
  const silent = { model: select.value, hint: hint() };
  select.value = 'FLANGER';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(250);
  const manual = { model: select.value, groups: groups() };
  // Back to a slot already answered: the window re-files the answer instead of asking again.
  const beforeReturn = reads().length;
  ids.value = '4';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(700);
  const returned = { newReads: reads().length - beforeReturn, model: select.value };
  // Leaving the category forgets the answers, so the next entry asks the desk again — the desk is
  // where an effect is loaded or unloaded — and the list that travels is the one the field holds.
  category.value = 'ch';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(100);
  category.value = 'fx';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  ids.value = '5,6';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(700);
  const reentered = { reads: reads().slice(beforeReturn), model: select.value };
  return { waiting, answered, empty, silent, manual, returned, reentered };
})()`);
assert.equal(fxSlotRead.waiting.newReads, 0,
  'entering a slot must not read on the keystroke: the ids field settles first');
assert.match(fxSlotRead.waiting.hint, /Reading/i,
  `the panel must say it is reading the slot instead of blocking (got "${fxSlotRead.waiting.hint}")`);
assert.equal(fxSlotRead.waiting.fieldDisabled, false,
  'a read in flight must not disable the manual model field');
assert.deepEqual(fxSlotRead.answered.reads, ['4'],
  `arriving on a slot must ask the console for exactly that slot (got ${JSON.stringify(fxSlotRead.answered.reads)})`);
assert.equal(fxSlotRead.answered.model, 'V-IMG',
  `an empty model field must take the model the console answered (got "${fxSlotRead.answered.model}")`);
assert.deepEqual(fxSlotRead.answered.groups.find((group) => group.model === 'fx:V-IMG')?.keys, ['fx:mode'],
  'the picker must offer the parameters of the model the console named, under its own spelling');
assert.equal(fxSlotRead.empty.model, '',
  `a slot the console answered NONE for has no model to name (got "${fxSlotRead.empty.model}")`);
assert.match(fxSlotRead.empty.hint, /empty|NONE/i,
  `an empty slot must say so (got "${fxSlotRead.empty.hint}")`);
assert.equal(fxSlotRead.silent.model, '',
  `a slot that stayed silent must not be given a guessed model (got "${fxSlotRead.silent.model}")`);
assert.match(fxSlotRead.silent.hint, /did not answer/i,
  `a silent slot must ask the operator for the model by hand (got "${fxSlotRead.silent.hint}")`);
assert.equal(fxSlotRead.manual.model, 'FLANGER', 'the manual model field must stay the fallback');
assert.ok(fxSlotRead.manual.groups.some((group) => group.model === 'fx:FLANGER'),
  `naming a model by hand must still offer its parameters (got ${JSON.stringify(fxSlotRead.manual.groups)})`);
assert.equal(fxSlotRead.returned.newReads, 0,
  'a slot list already answered must not cost a second round trip');
assert.equal(fxSlotRead.returned.model, 'V-IMG',
  `coming back to a slot must re-file what it answered (got "${fxSlotRead.returned.model}")`);
assert.deepEqual(fxSlotRead.reentered.reads, ['5,6'],
  `re-entering the category must ask the desk again, for the slots the field names (got ${JSON.stringify(fxSlotRead.reentered.reads)})`);
console.log('25. FX slot read:', JSON.stringify({
  reads: fxSlotRead.answered.reads, seeded: fxSlotRead.answered.model,
  empty: fxSlotRead.empty.model, silent: fxSlotRead.silent.model,
  reentered: fxSlotRead.reentered.reads,
}));
await closeDialogIfOpen();

console.log('ALL BROWSER CHECKS PASSED');
socket.close();
try {
  // A browser that wedged (docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md) would leave this request
  // unanswered and the process alive after the checks have passed: the abort makes the run end.
  await fetch(`http://127.0.0.1:9223/json/close/${target.id}`, { signal: AbortSignal.timeout(2000) });
} catch (_) {}

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
