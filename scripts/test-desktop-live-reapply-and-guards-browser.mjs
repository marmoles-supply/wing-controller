// End-to-end check of the desktop UI in a real browser with a stubbed Tauri IPC.
//
// The session half of the action-target suite, against the real index.html script:
//   22. A save while the session is live re-applies what the editor holds now (not what it held at
//       connect: `armed` and the draft fields travel refreshed).
//   23. ENABLE and the multiselect ask before they replace an unsaved draft.
//
// The other halves: `scripts/test-desktop-action-target-browser.mjs` (addressing, steps, sends,
// destinations, the model-aware catalogue re-read) and
// `scripts/test-desktop-shoot-and-guards-browser.mjs` (the Shoot cancel, the unconfirmed-write report
// and the FX parameter picker). Headless Chrome on this machine wedges after roughly ninety seconds of
// page activity, so the suite is split into halves that each finish well inside that window
// (docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md).
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is closed, and
// running it directly is a no-op in that case too.
//
// Run: node scripts/test-desktop-live-reapply-and-guards-browser.mjs
// End-to-end check of the desktop UI in a real browser with a stubbed Tauri IPC.
//
// The run-time half of the action-target suite, against the real index.html script:
//   18. A running Shoot can be cancelled (`stop_test_action`), and the cancelled run is reported.
//   19. A write the console did not confirm is shown as `completed_unconfirmed`, never as success.
//   20. An FX parameter is offered per model, exactly the parameters that model has.
//   21. An FX step carries the model that has its key, and a name the model lacks says so.
//   22. A save while the session is live re-applies what the editor holds now (not what it held at
//       connect: `armed` and the draft travel refreshed).
//   23. ENABLE and the multiselect ask before they replace an unsaved draft.
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
            const result = {
              status, target: 'stub', bytes: 1, packets: 1, packet_hex: '',
              verification_mismatch_count: unconfirmed,
            };
            if (!slowMs) return result;
            window.__TEST_ACTION_RUNNING = true;
            return new Promise((resolve) => {
              window.__TEST_ACTION_FINISH = (stopped) => {
                window.__TEST_ACTION_RUNNING = false;
                window.__TEST_ACTION_FINISH = null;
                resolve(stopped ? { ...result, status: 'cancelled' } : result);
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
          window.__IPC_CALLS = window.__IPC_CALLS || {};
          window.__IPC_CALLS[cmd] = (window.__IPC_CALLS[cmd] || 0) + 1;
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
// --- 22. A live session re-applies what the editor holds now, not what it held at connect ------
// `lastLiveRequest` is the snapshot the re-apply and the auto-reconnect replay. It kept `armed` and
// the draft fields frozen at connect time, so a save made after disarming still sent `armed: true`
// and the backend compiled the draft of an hour ago instead of the library just saved (master plan
// 2026-09-22, §5.2 item 20).
const liveSave = await evaluate(`(async () => {
  document.getElementById('stop-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('trigger-category', 'ch');
  set('trigger-ids', '1');
  set('trigger-parameter', 'meter');
  set('trigger-operator', '>');
  set('threshold', '-18');
  set('target-category', 'ch');
  set('target-ids', '2');
  await new Promise((resolve) => setTimeout(resolve, 200));
  set('target-parameter', 'mute');
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  // Enabled, or the whole library is filtered out of the runtime signature and there is nothing to
  // re-apply. The draft is clean here, so the row's ENABLE asks nothing.
  document.querySelector('.macro-row.selected .macro-enable-button').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  document.getElementById('armed-toggle').click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  document.getElementById('live-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const connectedArmed = window.__LAST_STREAM_REQUEST?.armed === true;
  // Disarm, move the step and save: the re-apply has to carry the current draft and the library.
  document.getElementById('armed-toggle').click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  set('target-ids', '3');
  await new Promise((resolve) => setTimeout(resolve, 300));
  window.__LAST_STREAM_REQUEST = null;
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 800));
  const request = window.__LAST_STREAM_REQUEST;
  return {
    connectedArmed,
    armedNow: armed === true,
    enabled: macroLibrary.macros[macroLibrary.selectedIndex]?.enabled === true,
    armedAfterSave: request ? request.armed : null,
    addresses: (request?.macroLibrary?.macros || []).flatMap((entry) => (entry.actionSteps || []).map((step) => step.actionAddress)),
    log: logLines.slice(-6).join('\\n'),
  };
})()`);
assert.equal(liveSave.connectedArmed, true, `the session must have started from the armed draft (got ${JSON.stringify(liveSave)})`);
assert.equal(liveSave.armedNow, false, `the draft must be disarmed before the save under test (got ${JSON.stringify(liveSave)})`);
assert.equal(liveSave.armedAfterSave, false,
  `the re-apply after disarming must send a disarmed request (got ${JSON.stringify(liveSave)})`);
assert.ok(liveSave.addresses.includes('/ch/3/mute'),
  `the re-applied request must carry the library just saved (got ${JSON.stringify(liveSave.addresses)})`);

// --- 23b. Live Safe Mode: what it refuses, and that it is the lock doing the refusing ---------------
//
// The lock is a safety feature and it had no test of its behaviour at all: nothing asserted that it
// blocks anything, and Fire Macro was the one action it did not cover although the shipped documents
// promised it did (audit 2026-10-02). This checks both directions: refused while the lock is on, and the
// same click reaching the backend once it is off.
const lockContract = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const menuItem = () => [...document.querySelectorAll('#win95-context-menu *')]
    .find((el) => (el.textContent || '').trim() === 'Fire Macro (run all its steps)');
  // The row is re-queried every time: the lock's own state change repaints the library, so a node captured
  // before it is detached and a synthetic event on it goes nowhere (found the hard way).
  const openMenu = async () => {
    const row = document.querySelector('.macro-row.selected') || document.querySelector('.macro-row');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }));
    await wait(300);
    return row;
  };
  const fireMacroCalls = () => (window.__IPC_CALLS || {}).fire_macro || 0;
  const setLock = async (on) => {
    const box = document.getElementById('settings-live-lock');
    box.checked = on;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(250);
  };

  const live = streamMode;
  await setLock(true);
  const lockedBefore = fireMacroCalls();
  await openMenu();
  const itemPresent = Boolean(menuItem());
  menuItem()?.closest('div')?.click();
  await wait(450);
  const whileLocked = fireMacroCalls() - lockedBefore;
  const lockedNotice = (streamOutput?.textContent || '').includes('[LOCKED]');
  const lockedLog = logLines.slice(-3).join(' | ');

  await setLock(false);
  const unlockedBefore = fireMacroCalls();
  await openMenu();
  menuItem()?.closest('div')?.click();
  await wait(450);
  const whileUnlocked = fireMacroCalls() - unlockedBefore;

  return {
    live, itemPresent, whileLocked, lockedNotice, lockedLog, whileUnlocked,
    // Kept small: these are what made the second direction fail the first time (a repaint replaces the
    // row, and a stale node swallows the click).
    debug: {
      macroCount: (macroLibrary.macros || []).length,
      selectedSteps: ((macroLibrary.macros || [])[macroLibrary.selectedIndex]?.actionSteps || []).length,
      lastLog: logLines.slice(-2).join(' | '),
    },
  };
})()`);
assert.equal(lockContract.live, 'live', `the lock contract needs a live session (got ${lockContract.live})`);
assert.equal(lockContract.itemPresent, true, 'the row menu must offer Fire Macro');
assert.equal(lockContract.whileLocked, 0,
  `Live Safe Mode must refuse firing a macro by hand before it reaches the backend (got ${JSON.stringify(lockContract)})`);
assert.ok(lockContract.lockedNotice, `the refusal must be visible where the operator is looking (got ${JSON.stringify(lockContract)})`);
assert.ok(/live_lock_blocked firing a macro by hand/.test(lockContract.lockedLog),
  `the refusal must be logged with its action (got ${JSON.stringify(lockContract.lockedLog)})`);
assert.equal(lockContract.whileUnlocked, 1,
  `with the lock off the same click must reach the backend, or the check above proves nothing (got ${JSON.stringify(lockContract)})`);
console.log('22. Live re-apply after disarming:', JSON.stringify({
  armedAfterSave: liveSave.armedAfterSave,
  hasNewAddress: liveSave.addresses.includes('/ch/3/mute'),
}));
await closeDialogIfOpen();

// --- 23. ENABLE and the multiselect ask before they replace an unsaved draft ---------------------
// The row's ENABLE moved the save target and the multiselect checkbox loaded the ticked macro into
// the editor, both without a word: the unsaved draft was gone and the next Cmd+S wrote it into the
// macro the row had selected (master plan 2026-09-22, §5.2 items 21 and 22).
const dirtyGuard = await evaluate(`(async () => {
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  // Two complete, disabled macros, set up through the app's own save path.
  const template = macroLibrary.macros.find((entry) => (entry.actionSteps || []).length > 0
    && entry.triggerCategory && entry.triggerParameter) || readConfigFromUi();
  macroLibrary.macros = [
    { ...JSON.parse(JSON.stringify(template)), name: 'First of the pair', enabled: false },
    { ...JSON.parse(JSON.stringify(template)), name: 'Second of the pair', enabled: false },
  ];
  macroLibrary.selectedIndex = 1;
  selectedMacroIndices.clear();
  selectedMacroIndices.add(1);
  applyConfig(disarmedConfig(macroLibrary.macros[1]));
  renderMacroLibrary();
  await saveMacroLibraryState('test_pair_ready');
  await new Promise((resolve) => setTimeout(resolve, 350));
  set('macro-name', 'Draft of the second macro');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const before = { dirty: draftDirty, selected: macroLibrary.selectedIndex, enabled: macroLibrary.macros[0].enabled === true };
  document.querySelectorAll('.macro-enable-button')[0].click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  return {
    before,
    dialogOpen: getComputedStyle(document.getElementById('win95-confirm')).display !== 'none',
    message: document.getElementById('win95-confirm-message').textContent,
    whileOpen: { dirty: draftDirty, selected: macroLibrary.selectedIndex, enabled: macroLibrary.macros[0].enabled === true },
  };
})()`);
assert.equal(dirtyGuard.before.dirty, true, 'the draft must be unsaved for this check');
assert.equal(dirtyGuard.before.enabled, false, 'the first macro must start disabled');
assert.equal(dirtyGuard.dialogOpen, true, 'ENABLE must ask before it replaces the draft');
assert.match(dirtyGuard.message, /Discard them and open this macro\?/,
  `the question must name what is about to happen (got "${dirtyGuard.message}")`);
assert.equal(dirtyGuard.whileOpen.selected, dirtyGuard.before.selected, 'nothing may switch while the question is open');
assert.equal(dirtyGuard.whileOpen.enabled, false, 'and the macro may not be enabled yet');
await pressKey('Escape', 'Escape', 27);
console.log('23a. ENABLE asked before switching the save target');
const enableRefused = await evaluate(`(() => ({
  dirty: draftDirty,
  selected: macroLibrary.selectedIndex,
  enabled: macroLibrary.macros[0].enabled === true,
  open: getComputedStyle(document.getElementById('win95-confirm')).display !== 'none',
}))()`);
assert.equal(enableRefused.open, false, 'Escape must close the question');
assert.equal(enableRefused.dirty, true, 'keeping the draft must leave it unsaved');
assert.equal(enableRefused.enabled, false, 'a refused ENABLE must not enable the macro');
assert.equal(enableRefused.selected, dirtyGuard.before.selected, 'and must not move the editor');

console.log('23b. a refused ENABLE changed nothing');
const enableAccepted = await evaluate(`(async () => {
  document.querySelectorAll('.macro-enable-button')[0].click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  return { open: getComputedStyle(document.getElementById('win95-confirm')).display !== 'none' };
})()`);
assert.equal(enableAccepted.open, true, 'the question must be asked again');
await evaluate(`document.getElementById('win95-confirm-accept').focus()`);
await pressKey('Enter', 'Enter', 13);
console.log('23c. the question is asked again');
const enableDone = await evaluate(`(async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return {
    enabled: macroLibrary.macros[0].enabled === true,
    selected: macroLibrary.selectedIndex,
    editorName: document.getElementById('macro-name').value,
    dirty: draftDirty,
  };
})()`);
assert.equal(enableDone.enabled, true, 'accepting must enable the macro');
assert.equal(enableDone.selected, 0, 'and the editor must move to it, so the next save writes into it');
assert.equal(enableDone.editorName, 'First of the pair',
  `the editor must show the macro the row selected (got "${enableDone.editorName}")`);

console.log('23d. ENABLE accepted: the editor follows the row');
const checkGuard = await evaluate(`(async () => {
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('macro-name', 'Second draft to protect');
  await new Promise((resolve) => setTimeout(resolve, 250));
  // Two clicks: the first ticks the second row (two ticked, no question), the second leaves exactly
  // one ticked, which is the case that loads a macro into the editor.
  document.querySelectorAll('.macro-check')[1].click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.querySelectorAll('.macro-check')[1].click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  return {
    dirty: draftDirty,
    selected: macroLibrary.selectedIndex,
    open: getComputedStyle(document.getElementById('win95-confirm')).display !== 'none',
  };
})()`);
assert.equal(checkGuard.dirty, true, 'the draft must be unsaved before ticking a row');
assert.equal(checkGuard.open, true, 'the multiselect must ask before it loads another macro into the editor');
await pressKey('Escape', 'Escape', 27);
console.log('23e. the multiselect asked before loading another macro');
const checkRefused = await evaluate(`(() => {
  const boxes = document.querySelectorAll('.macro-check');
  return {
    dirty: draftDirty,
    selected: macroLibrary.selectedIndex,
    ticked: Array.from(boxes).map((box) => box.checked),
    open: getComputedStyle(document.getElementById('win95-confirm')).display !== 'none',
  };
})()`);
assert.equal(checkRefused.open, false, 'Escape must close the question');
assert.equal(checkRefused.dirty, true, 'keeping the draft must leave it unsaved');
assert.equal(checkRefused.selected, checkGuard.selected, 'and must not move the editor');
assert.deepEqual(checkRefused.ticked, [true, true],
  'the tick set must go back to what it was before the refused click (both rows were ticked)');
console.log('23. Unsaved-draft guards:', JSON.stringify({ enable: [enableDone.enabled, enableDone.selected], ticked: checkRefused.ticked }));
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
