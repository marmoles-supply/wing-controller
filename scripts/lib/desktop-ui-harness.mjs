// The CDP client, the desktop page and the Tauri stub, in **one** place for the browser suites that need them.
//
// Extracted from `test-desktop-action-target-browser.mjs` when its second half had to move into a process of its own:
// headless Chrome on this machine stops answering after roughly ninety seconds of page activity
// (`docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md`), and a stub copied into two files is a second answer to the same
// question — which this project has paid for more than once.
//
// Two things here are deliberate and were measured:
//
// * **Every call has a deadline.** A wedged browser does not die: it stops answering, and a `Runtime.evaluate` with no
//   deadline waits for ever. The gate sat on one suite for twenty-five minutes because of it. Running out of time now
//   says what was asked, how long it waited and whether the browser is still answering its HTTP endpoint, and exits
//   non-zero, so a wedged browser is reported instead of hidden.
// * **The page URL is derived from this file**, not written out as an absolute path: the suites have to work wherever the
//   tree is checked out.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

export const CHROME_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const DEBUG_URL = `http://127.0.0.1:${CHROME_PORT}`;
export const DESKTOP_PAGE_URL = `file://${resolve(dirname(fileURLToPath(import.meta.url)), '../../desktop/ui/index.html')}`;

/// How long one CDP command may take before a suite gives up on the browser. See the note above.
export const CDP_DEADLINE_MS = 20000;

export async function debuggerPages() {
  try {
    const response = await fetch(`${DEBUG_URL}/json`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

/// A tab of this suite's own, with the client that talks to it. The caller closes it with `closeTab`, including from an
/// `exit` handler: the tab must not survive a failing assertion.
export async function openDesktopTab() {
  const target = await (
    await fetch(`${DEBUG_URL}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  if (!target?.webSocketDebuggerUrl) throw new Error('could not open a Chrome tab for this suite');

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
    const started = Date.now();
    const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
    const timer = setTimeout(async () => {
      pending.delete(id);
      const alive = await fetch(`${DEBUG_URL}/json/version`, { signal: AbortSignal.timeout(2000) })
        .then(() => 'the browser still answers its HTTP endpoint, so it is wedged rather than gone')
        .catch(() => 'the browser does not answer its HTTP endpoint either, so it is gone');
      console.error(
        `the browser did not answer ${method} within ${CDP_DEADLINE_MS} ms (waited ${Date.now() - started} ms): ${alive}. ` +
        'This is the headless-Chrome wedge of docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md, not a failed check: nothing here ' +
        'says the window is wrong.',
      );
      process.exit(2);
    }, CDP_DEADLINE_MS);
    pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
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

  const closeTab = () => {
    // The **socket first**: an open WebSocket is a live handle on the event loop, so a suite that printed its seal would
    // go on running for ever — measured, after the split, as a run that never ended.
    try {
      socket.close();
    } catch (_) {}
    try {
      // `--max-time`: a wedged browser never answers, and this runs from an exit handler.
      execFileSync('curl', ['-s', '--max-time', '2', '-o', '/dev/null', `${DEBUG_URL}/json/close/${target.id}`]);
    } catch (_) {}
  };

  return { target, socket, call, evaluate, sleep, closeTab, url: DESKTOP_PAGE_URL };
}

/// The Win95 dialog is real state: a leftover one would be read as the next check's answer.
export async function closeDialogIfOpen(evaluate, sleep) {
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

/// Install the Tauri stub in every document this tab loads. `Page.addScriptToEvaluateOnNewDocument` is why a suite can
/// navigate and still find its stub: the browser re-applies it, not this file.
export async function installDesktopStub(call) {
  await call('Page.enable');
  // The visible tab, not a background one: Chrome throttles the timers of a hidden tab (350 ms becomes seconds, and after
  // five minutes it drops to one timer a minute), and every check below is built on `setTimeout` — a backgrounded tab
  // turned a two-minute run into a wedged one.
  await call('Page.bringToFront');
  await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__INVOKES = [];
    const CATALOG = ${JSON.stringify(CATALOG)};
    const DEFAULT_CONFIG = ${JSON.stringify(DEFAULT_CONFIG)};
    let savedLibrary = null;
    // The backend's own id-list reader (crates/wing-core/src/lib.rs, parse_ids): comma-separated
    // ids with "a-b" ranges expanded low to high, duplicates dropped, values above the cap ignored.
    // The stub used to split on commas only, so a range resolved to one bogus address and the window
    // looked right while the console saw a single channel — a stub that cannot expand a range cannot
    // be used to prove the window carries one.
    function parseIds(text, max = 256) {
      const clean = String(text === undefined || text === null ? '' : text).trim();
      if (!clean) return [];
      const out = [];
      const u16 = (value) => (/^[0-9]{1,5}$/.test(value) && Number(value) <= 65535 ? Number(value) : null);
      for (const raw of clean.split(',')) {
        if (out.length >= max) break;
        const item = raw.trim();
        if (!item) continue;
        const dash = item.indexOf('-');
        if (dash >= 0) {
          const start = u16(item.slice(0, dash).trim());
          const end = u16(item.slice(dash + 1).trim());
          if (start === null || end === null) continue;
          for (let id = Math.min(start, end); id <= Math.max(start, end); id += 1) {
            if (id > 0 && !out.includes(id)) {
              if (out.length >= max) break;
              out.push(id);
            }
          }
        } else {
          const id = u16(item);
          if (id !== null && id > 0 && out.length < max && !out.includes(id)) out.push(id);
        }
      }
      return out;
    }
    window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          window.__INVOKES.push({ cmd, args });
          if (cmd === 'target_catalog') {
            // Check 25 asks for the desk's model-aware answer: the step list of the monitor buses
            // loses the level on a Rack, which is what the backend's own rule returns for it.
            if (window.__RACK_CATALOGUE) {
              const rack = JSON.parse(JSON.stringify(CATALOG));
              rack.targetParametersByCategory.monbus = rack.targetParametersByCategory.monbus
                .filter((row) => row.key !== 'monitor_level');
              if (!rack.triggerParametersByCategory.monbus.some((row) => row.key === 'monitor_level')) {
                rack.triggerParametersByCategory.monbus.push({
                  key: 'monitor_level', label: 'Monitor Level', argKind: 'float', valueKind: 'db', unit: 'dB',
                  minValue: -144, maxValue: 10, canTrigger: true, operators: ['<', '>', '==', '!='],
                });
              }
              return rack;
            }
            return CATALOG;
          }
          // The discovery reply the model-aware catalogue re-read hangs off (check 24). The window
          // keeps the invoke it captured at boot, so the answer has to come from the stub and not
          // from a wrapper installed later.
          if (cmd === 'discover_wing') {
            return { ip: '192.168.1.10', name: 'desk', model: 'WING-RACK', serial: '0', firmware: '9.9.9',
              localIp: '192.168.1.11', localInterface: 'en0', replyText: 'WING' };
          }
          if (cmd === 'default_show_runner_config') return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
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
            // The input main/alt switch: the backend resolves alt_source to the input set node's
            // altsrc leaf (Maillot 3.1.0, scratch/wing_protocols.txt:1938), not to a leaf named after
            // the key. The owner's report of 2026-10-05 is about exactly this address, so the stub must
            // resolve it the same way the roster resolver does.
            if (r.category === 'ch' && r.parameter === 'alt_source') {
              return { addresses: parseIds(r.ids || '1').map((id) => '/ch/' + id + '/in/set/altsrc') };
            }
            // The generic node: one address per id the selector names, exactly as the backend
            // resolver does — a range is not one id, it is every channel between its ends.
            return { addresses: parseIds(r.ids || '1').map((id) => '/' + r.category + '/' + id + '/' + r.parameter) };
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
}

/// Navigate to the desktop page and wait until its script is up, so the first check does not race the load.
export async function navigateDesktopPage({ call, evaluate, sleep, url = DESKTOP_PAGE_URL, ready = 'Boolean(document.getElementById("library-new"))' }) {
  await call('Page.navigate', { url });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const readyExpression = 'document.readyState === "complete" && ' + ready;
      if (await evaluate(readyExpression)) return true;
    } catch (_) {
      // A document that is mid-navigation has no execution context yet: that is the next try, not a failure.
    }
    await sleep(100);
  }
  throw new Error(`the desktop page did not become ready at ${url}`);
}
