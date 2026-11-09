// Window soak harness: does a live session leak or degrade the two desktop windows?
//
// The gate's browser suites each prove a contract in about ninety seconds. Nobody measures what a
// show does to the two windows that stay open for hours: `usb-meter-frame` at the console's own
// rate, the OSC terminal taking hundreds of rows a second, the health grid once a second, macros
// firing and HUD alerts landing. This harness drives exactly that traffic through the windows' own
// captured listeners (never hand-rolled DOM work, so what is measured is the app) and samples what
// could grow: the JS heap, the DOM node count, the terminal's row count, the rAF frame interval and
// the resident memory of the whole Chrome process tree.
//
// It opens **two tabs of its own** on the shared debug port and closes them on the way out: the
// browser suites share that port, and disturbing their tab would make either order red.
//
//   node scripts/wing-soak-windows.mjs
//   node scripts/wing-soak-windows.mjs --minutes 2
//
// Flags (all optional):
//   --minutes <n>         total run length in minutes (default 20)
//   --meters <n>          meters on the watchlist, driven in every frame (default 48)
//   --frame-hz <n>        meter frames per second sent to each window (default 60)
//   --trace-hz <n>        OSC trace rows per second sent to the dock's terminal (default 300)
//   --sample-seconds <n>  seconds between samples of both windows (default 30)
//
// Warm-up: `min(2 minutes, half the run)`, so the default 20-minute run has the 2-minute warm-up the
// leak gate is written around, while a 2-minute run still has warm-up plus two samples. The growth
// gates compare the sample at the end of the warm-up with the last one.
//
// Visibility: rAF only runs in the tab Chrome considers visible, and the tab that is not visible gets
// its paint work coalesced into one owed frame (that is the app's own design). The sampler therefore
// brings each window to the front, waits for it to settle, samples it, and hands the front back at
// the end of the round, so both windows paint for about half the run.
//
// Traffic: one tick every 50 ms per window carries that tick's share of the frames and of the trace
// rows in a single CDP call, and the page-side helper hands each event to the handler the window
// registered, one at a time. Batching is what keeps the harness's own round trips from becoming the
// load — with one call per event the renderer received 49 of the 60 frames a second it was asked for.
// The driver never keeps more than a handful of calls in flight, because the sampler's calls wait
// behind them inside the renderer.
//
// The Chrome tree's RSS is read by finding the browser process once, before the run clock starts, and
// then walking `ps -eo pid=,ppid=` and summing `ps -o rss= -p <pids>`. The command-line scan that
// finds the process can take tens of seconds on this machine while a build runs, so it is done during
// setup and never inside a sample.
//
// The `file://` localStorage the windows share is captured before the first navigation and put back on
// the way out, so a browser suite that runs later in the same profile sees what it saw before.
//
// Measured with `performance.memory.usedJSHeapSize` when it is usable. On this machine's headless
// Chrome it is not: it answers the constant 10000000 whatever the page allocates (see the note the
// run prints). The heap number the gates use is `Runtime.getHeapUsage().usedSize` from the CDP
// session, which is the same quantity without the quantisation, taken after `HeapProfiler.collectGarbage`
// so it reads retained memory rather than whatever the collector has not got to yet.
//
// Exit status: 0 when nothing grew past its limit, 1 when a gate tripped (the message names it), 2 on
// a usage or environment error.
//
// Needs Chrome on the debug port (`scripts/verify-all.sh` documents how it is started); the port is
// `WING_CHROME_PORT` when set, 9223 otherwise.
import { execFile, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_PORT = Number.isFinite(DEBUG_PORT) && DEBUG_PORT > 0 ? DEBUG_PORT : 9223;
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const USAGE = `usage: node scripts/wing-soak-windows.mjs [--minutes n] [--meters n] [--frame-hz n] [--trace-hz n] [--sample-seconds n]`;

// The rAF sample length and how many opening frames are dropped: the first frames after a tab comes
// to the front carry the gap it spent hidden and are not a frame interval of the app.
const RAF_SAMPLE_MS = 2000;
const RAF_DROP_FRAMES = 5;
// How long a window is left at the front before it is sampled, so its first frames are steady.
const SETTLE_MS = 700;

// The limits the run is judged by.
const HEAP_GROWTH_LIMIT = 0.25; // usedJSHeapSize / getHeapUsage
const DOM_GROWTH_LIMIT = 0.20; // element count
const RAF_P95_FACTOR_LIMIT = 2; // last sample against the first after warm-up
const RSS_GROWTH_LIMIT = 0.30; // the whole Chrome tree

function parseFlags(argv) {
  const flags = { minutes: 20, meters: 48, frameHz: 60, traceHz: 300, sampleSeconds: 30 };
  const positive = (raw, name) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} needs a positive number (got "${raw}")`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`--${flag.replace(/^--/, '')} needs a value`);
      return argv[index];
    };
    if (flag === '--minutes') flags.minutes = positive(next(), 'minutes');
    else if (flag === '--meters') flags.meters = Math.floor(positive(next(), 'meters'));
    else if (flag === '--frame-hz') flags.frameHz = positive(next(), 'frame-hz');
    else if (flag === '--trace-hz') flags.traceHz = positive(next(), 'trace-hz');
    else if (flag === '--sample-seconds') flags.sampleSeconds = positive(next(), 'sample-seconds');
    else if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      throw new Error(`unknown argument "${flag}"\n${USAGE}`);
    }
  }
  if (flags.minutes < 1) throw new Error('--minutes must be at least 1');
  if (flags.meters < 1 || flags.meters > 240) throw new Error('--meters must be between 1 and 240');
  if (flags.frameHz > 240) throw new Error('--frame-hz must not exceed 240');
  if (flags.traceHz > 2000) throw new Error('--trace-hz must not exceed 2000');
  if (flags.sampleSeconds < 5) throw new Error('--sample-seconds must be at least 5 (a sample takes about 5 s)');
  return flags;
}

let FLAGS;
try {
  FLAGS = parseFlags(process.argv.slice(2));
} catch (error) {
  console.error(String(error.message || error));
  process.exit(2);
}

const TOTAL_MS = Math.round(FLAGS.minutes * 60_000);
// The leak gate is written around a two-minute warm-up. A run shorter than four minutes cannot afford
// it and still have samples left to compare, so half of it is the warm-up (a 2-minute run gets one
// minute of warm-up and two samples).
const WARMUP_MS = Math.min(120_000, Math.floor(TOTAL_MS / 2));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mb = (bytes) => (bytes == null ? 'n/a' : `${(bytes / 1048576).toFixed(1)} MB`);
const signed = (value) => (value == null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(1)} %`);

// ---------------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------------
const createdTabs = [];
let sockets = [];

function closeTab(id) {
  if (!id) return;
  try {
    // `--max-time`: a wedged browser never answers and this runs on the way out.
    execFileSync('curl', ['-s', '--max-time', '2', '-o', '/dev/null', `http://127.0.0.1:${CHROME_PORT}/json/close/${id}`]);
  } catch (_) {}
}

process.on('exit', () => {
  for (const id of createdTabs) closeTab(id);
});

async function openTab() {
  const response = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?about:blank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`could not open a Chrome tab (HTTP ${response.status})`);
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error('could not open a Chrome tab for the soak');
  createdTabs.push(target.id);
  return target;
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let nextId = 0;
  let closed = false;
  const pending = new Map();
  socket.on('message', (data) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  socket.on('close', () => {
    closed = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('the Chrome tab closed underneath the soak'));
    }
    pending.clear();
  });
  const call = (method, params = {}, timeoutMs = 30_000) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error(`${method}: the Chrome tab is already closed`));
        return;
      }
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} did not answer within ${timeoutMs} ms (a wedged browser?)`));
      }, timeoutMs);
      // A call still in flight must never be the reason the process lives on after the report: the run
      // is over the moment the summary is printed, and one late evaluate once kept Node alive ~30 s.
      if (typeof timer.unref === 'function') timer.unref();
      pending.set(id, { resolve, reject, method, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression, timeoutMs = 30_000) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };
  return { call, evaluate, target };
}

// ---------------------------------------------------------------------------------------------------
// What is injected into each tab before its document runs: the Tauri stub and the traffic generator.
//
// The shapes are the ones the two windows already expect (scripts/test-desktop-meter-bridge-status-browser.mjs
// for the bridge's `get_stream_state` and geometry, scripts/test-desktop-shoot-and-guards-browser.mjs
// for the dock's catalogue and macro-config commands). The traffic is fired at the handlers the pages
// captured in `window.__LISTENERS`, which is the same code the Rust side reaches through the IPC.
// ---------------------------------------------------------------------------------------------------
function buildWatchlist(count) {
  const list = [];
  for (let id = 1; id <= count; id += 1) {
    list.push({ group: 'usb', id, label: `USB ${id}`, key: `usb:${id}`, alias: `USB ${id}` });
  }
  return list;
}

function buildStub(watchlist, frameHz) {
  const catalog = {
    categories: [
      { key: 'usb', label: 'USB Audio', count: 48, group: 'Inputs', canTarget: true, canTrigger: true },
      { key: 'ch', label: 'Channels', count: 48, group: 'Inputs', canTarget: true, canTrigger: true },
      { key: 'bus', label: 'Buses', count: 16, group: 'Inputs', canTarget: true, canTrigger: true },
    ],
    targetParametersByCategory: {
      usb: [{ key: 'mute', label: 'Mute', argKind: 'int', valueKind: 'toggle', offLabel: 'OFF', onLabel: 'ON' }],
      ch: [{ key: 'mute', label: 'Mute', argKind: 'int', valueKind: 'toggle', offLabel: 'OFF', onLabel: 'ON' }],
      bus: [{ key: 'send_level', label: 'Send Level', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -144, maxValue: 10, sendIndexLabel: 'Bus', sendIndexMax: 16 }],
    },
    triggerParametersByCategory: {
      usb: [{ key: 'meter', label: 'Meter Level', argKind: 'float', valueKind: 'db_meter', unit: 'dB' }],
      ch: [{ key: 'meter', label: 'Meter Level', argKind: 'float', valueKind: 'db_meter', unit: 'dB' }],
      bus: [{ key: 'meter', label: 'Meter Level', argKind: 'float', valueKind: 'db_meter', unit: 'dB' }],
    },
    pluginModels: [],
    fxModelTables: [],
  };
  const defaultConfig = {
    name: 'Soak', wingIp: '192.168.1.10', triggerCategory: 'usb', triggerIds: '1',
    triggerParameter: 'meter', triggerOperator: '>', triggerThreshold: -18, triggerEdgeMode: 'on',
    triggerMeterMode: 'transient', macroOverlapStrategy: 'drop', logicalOperator: 'AND',
    conditions: [], enabled: false, armed: false, actionSteps: [],
  };
  return `
    window.__LISTENERS = window.__LISTENERS || {};
    window.__INVOKES = [];
    window.__SOAK = window.__SOAK || {};

    // The storage the windows already had is kept, so the soak can put it back and a browser suite that
    // runs later in the same profile sees what it saw before. Captured once, at the first document of
    // this tab, before anything of ours is written.
    if (window.__SOAK_PREV_CAPTURED === undefined) {
      var previousStorage = {};
      var captured = false;
      try {
        for (var storageIndex = 0; storageIndex < localStorage.length; storageIndex += 1) {
          var storageKey = localStorage.key(storageIndex);
          previousStorage[storageKey] = localStorage.getItem(storageKey);
        }
        captured = true;
      } catch (_) {}
      window.__SOAK_PREV = previousStorage;
      window.__SOAK_PREV_CAPTURED = captured;
    }

    var SOAK_WATCHLIST = ${JSON.stringify(watchlist)};
    try {
      localStorage.setItem('wing_custom_meters', JSON.stringify(SOAK_WATCHLIST));
    } catch (_) {}

    var SOAK_FRAME_HZ = ${JSON.stringify(frameHz)};
    var SOAK_SESSION_ID = 1;
    var SOAK_HEALTH = {
      state: 'live', packets: 1000, decodedEvents: 1000, triggerHits: 0,
      packetRateHz: SOAK_FRAME_HZ, byteRateBps: SOAK_FRAME_HZ * 800,
      lastRxMsAgo: 40, lastRenewMsAgo: 900, lastDecodeMicros: 12,
      triggerLatencySamples: 0, droppedMeterCount: 0,
    };
    var SOAK_STREAM_STATE = {
      state: 'live', message: 'soak session live', sessionActive: true, sessionId: SOAK_SESSION_ID,
      deskModel: null, deskModelKnown: false, liveSafeMode: false, health: SOAK_HEALTH,
      meterSources: ['dock', 'meter-popup'], metersWindowOpen: true, lastAlert: null,
    };
    var SOAK_CATALOG = ${JSON.stringify(catalog)};
    var SOAK_DEFAULT_CONFIG = ${JSON.stringify(defaultConfig)};

    window.__TAURI__ = {
      core: {
        invoke: async function (command, args) {
          window.__INVOKES.push({ cmd: command, args: args });
          if (command === 'get_stream_state') return JSON.parse(JSON.stringify(SOAK_STREAM_STATE));
          if (command === 'target_catalog') return SOAK_CATALOG;
          if (command === 'load_macro_library') return { schemaVersion: 1, selectedIndex: 0, macros: [] };
          if (command === 'load_show_runner_config' || command === 'default_show_runner_config') {
            return JSON.parse(JSON.stringify(SOAK_DEFAULT_CONFIG));
          }
          if (command === 'load_strip_models' || command === 'read_strip_models' || command === 'read_fx_models') return [];
          if (command === 'update_active_meters') return { ok: true };
          if (command === 'is_meters_window_open') return true;
          if (command === 'list_network_interfaces') return [];
          if (command === 'resolve_basic_target') return { addresses: [] };
          if (command === 'preflight_show_runner_config') {
            return { ok: true, messages: [], normalizedConfig: (args && args.config) || null };
          }
          if (command === 'save_macro_library' || command === 'save_show_runner_config' || command === 'save_station_backup') {
            return args || {};
          }
          return {};
        },
      },
      event: {
        listen: async function (name, handler) {
          window.__LISTENERS[name] = handler;
          return function () {};
        },
      },
      window: {
        availableMonitors: async function () {
          return [{ name: 'Main', position: { x: 0, y: 0 }, size: { width: 1440, height: 900 } }];
        },
        PhysicalPosition: function PhysicalPosition(x, y) { this.x = x; this.y = y; },
        PhysicalSize: function PhysicalSize(width, height) { this.width = width; this.height = height; },
        getCurrentWindow: function () {
          return {
            setAlwaysOnTop: async function () {}, setFocus: async function () {},
            setPosition: async function () {}, setSize: async function () {},
            outerPosition: async function () { return { x: 320, y: 180 }; },
            innerSize: async function () { return { width: 1440, height: 900 }; },
            onCloseRequested: async function () { return function () {}; },
            close: async function () {},
          };
        },
      },
    };

    // ---- the traffic generator ------------------------------------------------------------------
    // Every helper below builds the payload the Rust side would emit and hands it to the handler the
    // page registered, so the app's own handler, merge, paint and trim paths do the work.
    window.__SOAK.sent = { meterFrames: 0, traces: 0, health: 0, status: 0, actions: 0, verifications: 0, macroRuns: 0, alerts: 0 };
    window.__SOAK.meterKeys = SOAK_WATCHLIST.map(function (item) {
      return { key: item.key, label: item.label };
    });
    window.__SOAK.hudTarget = /meters\\.html$/.test(location.pathname) ? 'meters' : 'main';

    window.__SOAK.fireStatus = function () {
      var handler = window.__LISTENERS['usb-meter-stream-status'];
      if (!handler) return;
      window.__SOAK.sent.status += 1;
      handler({ payload: { state: 'live', message: 'soak session live', session_id: SOAK_SESSION_ID } });
    };

    window.__SOAK.fireMeter = function (packetIndex) {
      var handler = window.__LISTENERS['usb-meter-frame'];
      if (!handler) return;
      var keys = window.__SOAK.meterKeys;
      var meters = [];
      for (var index = 0; index < keys.length; index += 1) {
        var value = ((index * 7 + packetIndex * 3) % 60) - 50;
        meters.push({ key: keys[index].key, label: keys[index].label, value: value });
      }
      handler({ payload: { session_id: SOAK_SESSION_ID, packet_index: packetIndex, meters: meters } });
      window.__SOAK.sent.meterFrames += 1;
    };

    // A batch of frames in one call: the app still sees one usb-meter-frame event per frame (the
    // handler is called once each), but the harness does not spend one round trip per frame — which
    // is what made the achieved rate fall short of the asked one when the renderer was busy.
    window.__SOAK.fireMeters = function (firstIndex, count) {
      for (var offset = 0; offset < count; offset += 1) window.__SOAK.fireMeter(firstIndex + offset);
    };

    // One driver tick: that tick's frames and that tick's trace rows in a single round trip. The
    // window's own handlers are still called once per event.
    window.__SOAK.fireTick = function (meterFirst, meterCount, traceFirst, traceCount) {
      if (meterCount > 0) window.__SOAK.fireMeters(meterFirst, meterCount);
      if (traceCount > 0) window.__SOAK.fireTrace(traceFirst, traceCount);
    };

    window.__SOAK.fireTrace = function (firstId, count) {
      var handler = window.__LISTENERS['osc-message-trace'];
      if (!handler) return;
      for (var offset = 0; offset < count; offset += 1) {
        var id = firstId + offset;
        var leaf = id % 3 === 0 ? '/mute' : (id % 3 === 1 ? '/fader' : '/eq/gain');
        var address = '/ch/' + (1 + (id % 48)) + leaf;
        handler({ payload: {
          id: id,
          direction: id % 2 === 0 ? 'rx' : 'tx',
          address: address,
          args: [String(id % 2), ((id % 70) / 10).toFixed(1)],
          summary: 'soak ' + address,
          remote: '127.0.0.1:2223',
          timestamp: new Date().toISOString().slice(11, 23),
        } });
        window.__SOAK.sent.traces += 1;
      }
    };

    window.__SOAK.fireHealth = function () {
      var handler = window.__LISTENERS['meter-stream-health'];
      if (!handler) return;
      window.__SOAK.sent.health += 1;
      var tick = window.__SOAK.sent.health;
      handler({ payload: {
        state: 'live', packets: tick * SOAK_FRAME_HZ, decodedEvents: tick * SOAK_FRAME_HZ,
        triggerHits: 0, packetRateHz: SOAK_FRAME_HZ, byteRateBps: SOAK_FRAME_HZ * 800,
        lastRxMsAgo: 40, lastRenewMsAgo: 900, lastDecodeMicros: 12,
        triggerLatencySamples: 0, droppedMeterCount: 0,
      } });
    };

    window.__SOAK.fireAction = function (n) {
      var handler = window.__LISTENERS['show-action-event'];
      if (!handler) return;
      window.__SOAK.sent.actions += 1;
      handler({ payload: {
        state: n % 5 === 0 ? 'completed_unconfirmed' : 'completed',
        message: 'soak action ' + n,
        target: '/ch/' + (1 + (n % 48)) + '/mute',
        packets: 1,
      } });
    };

    window.__SOAK.fireVerification = function (n) {
      var handler = window.__LISTENERS['action-verification'];
      if (!handler) return;
      window.__SOAK.sent.verifications += 1;
      handler({ payload: {
        stepIndex: n % 3, stepLabel: 'Soak step',
        address: '/ch/' + (1 + (n % 48)) + '/mute',
        expected: 1, reported: 0, message: 'soak verification ' + n,
      } });
    };

    window.__SOAK.fireMacro = function (n) {
      var handler = window.__LISTENERS['macro-runtime-event'];
      if (!handler) return;
      window.__SOAK.sent.macroRuns += 1;
      handler({ payload: {
        macroId: 'macro-1', macroName: 'Soak Macro', running: n % 2 === 1, queued: false,
        dropped: 0, restarted: 0, completed: n, completedUnconfirmed: 0, failed: 0,
        lastEvent: n % 2 === 1 ? 'started' : 'completed', lastMessage: 'soak ' + n,
      } });
    };

    window.__SOAK.fireAlert = function (n) {
      var handler = window.__LISTENERS['hud-alert'];
      if (!handler) return;
      window.__SOAK.sent.alerts += 1;
      handler({ payload: {
        title: 'SOAK ALERT ' + n, message: 'periodic soak alert while the show runs',
        urgency: 'info', durationMs: 1500, targetWindow: window.__SOAK.hudTarget,
      } });
    };

    // ---- sampling --------------------------------------------------------------------------------
    // p50/p95 are computed by the parent from the raw intervals; the opening frames are dropped
    // because they carry the gap the tab spent out of the front.
    window.__SOAK.sampleRaf = function (durationMs, dropFrames) {
      return new Promise(function (resolve) {
        var intervals = [];
        var last = null;
        var startedAt = performance.now();
        var settled = false;
        var finish = function () {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          resolve(intervals.slice(Math.max(0, dropFrames | 0)));
        };
        var tick = function (now) {
          if (last !== null) intervals.push(now - last);
          last = now;
          if (performance.now() - startedAt < durationMs) requestAnimationFrame(tick);
          else finish();
        };
        // A tab that is not visible never gets an animation frame: without this the call would never
        // answer and the soak would hang instead of saying the sample could not be taken.
        var guard = setTimeout(finish, durationMs + 3000);
        requestAnimationFrame(tick);
      });
    };

    window.__SOAK.metrics = function (meterSelector) {
      var perfMemory = null;
      try {
        perfMemory = performance.memory ? performance.memory.usedJSHeapSize : null;
      } catch (_) {}
      return {
        performanceMemoryUsed: perfMemory,
        domNodes: document.getElementsByTagName('*').length,
        oscRows: document.querySelectorAll('.osc-row').length,
        meterRows: document.querySelectorAll(meterSelector).length,
        sent: JSON.parse(JSON.stringify(window.__SOAK.sent)),
      };
    };
  `;
}

// ---------------------------------------------------------------------------------------------------
// Chrome's resident memory
// ---------------------------------------------------------------------------------------------------
/** Runs one command and resolves with its stdout, or null when it failed or ran out of its budget. */
function runCommand(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout) => {
      resolve(error ? null : String(stdout ?? ''));
    });
  });
}

/**
 * The browser process on `port`: the process that carries `--remote-debugging-port=<port>` without a
 * `--type=` (the helpers inherit the flag on their command line).
 *
 * `pgrep -f` is used here rather than a `ps -eo ... command=` scan on purpose, and it is called **once**
 * per run. Both commands have to read the argument list of every process on the machine, and under a
 * running `cargo build` that took 23-29 s on this machine; doing it inside a sample blocked the sample
 * and pushed a round twenty seconds off its schedule. Discovery happens before the run clock starts,
 * and every later reading is a parent/child walk plus one `ps -o rss=` (~30 ms).
 */
async function discoverChromeRoot(port, budgetMs) {
  const text = await runCommand('pgrep', ['-f', `remote-debugging-port=${port}`], budgetMs);
  if (text == null) return null;
  const candidates = text
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  if (candidates.length === 0) return null;
  const commandsText = await runCommand('ps', ['-o', 'pid=,command=', '-p', candidates.join(',')], 5000);
  if (commandsText == null) return null;
  for (const line of commandsText.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match && !match[2].includes('--type=')) return Number(match[1]);
  }
  return null;
}

let chromeRootPid = null;

/**
 * The resident memory of the whole Chrome process tree: the browser process found by
 * `discoverChromeRoot` and every descendant, summed from `ps -o rss= -p <pids>`.
 *
 * Every call is asynchronous and bounded, so a slow or wedged `ps` can never hold the run: a round
 * whose reading does not arrive is reported as `n/a` and the nearest round that has a number is used.
 */
async function chromeTreeRss(port) {
  const began = Date.now();
  const failed = (reason, extra = {}) => ({ totalBytes: null, reason, rootPids: [], pids: [], ms: Date.now() - began, ...extra });

  if (chromeRootPid == null) chromeRootPid = await discoverChromeRoot(port, 8000);
  if (chromeRootPid == null) return failed('the Chrome browser process could not be found');

  const tableText = await runCommand('ps', ['-eo', 'pid=,ppid='], 4000);
  if (tableText == null) return failed('the process table did not answer');
  const childrenOf = new Map();
  for (const line of tableText.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
    childrenOf.get(ppid).push(pid);
  }
  const pids = [];
  const seen = new Set();
  const stack = [chromeRootPid];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
    for (const child of childrenOf.get(pid) || []) stack.push(child);
  }
  if (pids.length <= 1) {
    // The browser process is gone (or the table no longer knows it): find it again next round.
    chromeRootPid = null;
    return failed('the Chrome browser process is no longer in the process table');
  }

  const rssText = await runCommand('ps', ['-o', 'rss=', '-p', pids.join(',')], 4000);
  if (rssText == null) return failed('ps -o rss= did not answer', { rootPids: [chromeRootPid], pids });
  let totalKb = 0;
  for (const line of rssText.split('\n')) {
    const value = Number(line.trim());
    if (Number.isFinite(value)) totalKb += value;
  }
  return { totalBytes: totalKb * 1024, rootPids: [chromeRootPid], pids, ms: Date.now() - began };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

// ---------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------
async function main() {
  let pages;
  try {
    const response = await fetch(`http://127.0.0.1:${CHROME_PORT}/json`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    pages = await response.json();
  } catch (error) {
    console.error(`no Chrome remote debugging on port ${CHROME_PORT} (${String(error.message || error)})`);
    console.error('start it as scripts/verify-all.sh documents, then run this again');
    process.exit(2);
  }
  if (!Array.isArray(pages)) {
    console.error(`no Chrome remote debugging on port ${CHROME_PORT}`);
    process.exit(2);
  }

  const watchlist = buildWatchlist(FLAGS.meters);
  const windows = [
    { name: 'dock', label: 'desktop/ui/index.html', file: 'desktop/ui/index.html', meterSelector: '#meters-container .meter', url: pathToFileURL(path.join(REPO_ROOT, 'desktop/ui/index.html')).href },
    { name: 'bridge', label: 'desktop/ui/meters.html', file: 'desktop/ui/meters.html', meterSelector: '.v-meter-strip', url: pathToFileURL(path.join(REPO_ROOT, 'desktop/ui/meters.html')).href },
  ];

  console.log('window soak — options');
  console.log(`  minutes=${FLAGS.minutes} meters=${FLAGS.meters} frame-hz=${FLAGS.frameHz} trace-hz=${FLAGS.traceHz} sample-seconds=${FLAGS.sampleSeconds}`);
  console.log(`  chrome port=${CHROME_PORT} warm-up=${(WARMUP_MS / 1000).toFixed(1)} s total=${(TOTAL_MS / 1000).toFixed(1)} s rAF sample=${(RAF_SAMPLE_MS / 1000).toFixed(1)} s`);
  console.log(`  windows: dock=${windows[0].label} bridge=${windows[1].label}`);
  console.log('');

  try {
    for (const window of windows) {
      const target = await openTab();
      const tab = await connect(target);
      window.tab = tab;
      await tab.call('Page.enable');
      await tab.call('HeapProfiler.enable');
      await tab.call('Page.addScriptToEvaluateOnNewDocument', { source: buildStub(watchlist, FLAGS.frameHz) });
      await tab.call('Page.navigate', { url: window.url });
    }
    const [dock, bridge] = windows;
    await dock.tab.call('Page.bringToFront');
    // Started while the windows boot, and awaited before the run clock: finding the browser process can
    // take tens of seconds on this machine under a build, and that wait must not land inside a sample.
    const rootDiscovery = discoverChromeRoot(CHROME_PORT, 30_000).then((pid) => { chromeRootPid = pid; return pid; });

    // The dock's listeners are registered as its script parses; boot() is async and finishes a moment
    // later. Its own `listen` calls are the signal the harness waits for.
    await waitFor(dock.tab, `document.readyState === 'complete'
      && Boolean(document.getElementById('meters-container'))
      && Boolean(window.__LISTENERS['usb-meter-frame'])
      && Boolean(window.__LISTENERS['osc-message-trace'])
      && Boolean(window.__LISTENERS['meter-stream-health'])
      && Boolean(window.__LISTENERS['hud-alert'])`, 'the dock to register its listeners');
    await waitFor(bridge.tab, `window.__wingBridgeBooted === true && Boolean(window.__LISTENERS['usb-meter-frame'])`, 'the bridge to finish its boot');
    await sleep(600);

    // One enabled macro row, so `macro-runtime-event` reaches `refreshMacroRuntimeRows` and patches a
    // row instead of taking the early return. Its shape is the one the editor saves.
    const soakMacro = {
      name: 'Soak Macro', enabled: true, armed: false, triggerCategory: 'usb', triggerIds: '1',
      triggerParameter: 'meter', triggerOperator: '>', triggerThreshold: -18, triggerEdgeMode: 'on',
      triggerMeterMode: 'transient', macroOverlapStrategy: 'drop', logicalOperator: 'AND', conditions: [],
      actionSteps: [{
        label: 'Mute CH 1', actionAddress: '/ch/1/mute', actionArgKind: 'int', actionValue: '1',
        actionMode: 'set', targetCategory: 'ch', targetIds: '1', targetParameter: 'mute', sendId: 1, enabled: true,
      }],
    };
    const installed = await dock.tab.evaluate(`(() => {
      try {
        macroLibrary = { schemaVersion: 1, selectedIndex: 0, macros: [${JSON.stringify(soakMacro)}] };
        renderMacroLibrary();
        return (macroLibrary.macros || []).length;
      } catch (error) { return 'error: ' + error; }
    })()`);
    if (installed !== 1) {
      console.log(`  note: the soak macro row could not be installed (${String(installed)}); the macro-runtime path still runs its handler`);
    }

    const dockWatchlist = await dock.tab.evaluate('customMetersWatchlist.length');
    const bridgeWatchlist = await bridge.tab.evaluate('watchlist.length');
    console.log(`  watchlist loaded: dock=${dockWatchlist} bridge=${bridgeWatchlist} (asked for ${FLAGS.meters})`);

    const driver = startDriver(windows);
    const rootPid = await rootDiscovery;
    console.log(`  chrome process tree: root pid ${rootPid == null ? 'NOT FOUND (RSS will be reported as n/a)' : rootPid} on port ${CHROME_PORT}`);
    console.log('');

    try {
      // Pre-flight: prove the traffic actually reaches the app's rendering paths before spending the
      // run on it. A window that renders nothing would otherwise produce a flat, meaningless soak.
      await sleep(2500);
      const proof = {
        dock: await dock.tab.evaluate(`window.__SOAK.metrics(${JSON.stringify(dock.meterSelector)})`),
        bridge: await bridge.tab.evaluate(`window.__SOAK.metrics(${JSON.stringify(bridge.meterSelector)})`),
      };
      console.log(`  pre-flight dock:   frames=${proof.dock.sent.meterFrames} traces=${proof.dock.sent.traces} meter cards=${proof.dock.meterRows} terminal rows=${proof.dock.oscRows}`);
      console.log(`  pre-flight bridge: frames=${proof.bridge.sent.meterFrames} strips=${proof.bridge.meterRows}`);
      const problems = [];
      if (proof.dock.sent.meterFrames === 0) problems.push('the dock is not receiving meter frames');
      if (proof.dock.sent.traces === 0) problems.push('the dock is not receiving OSC traces');
      if (proof.dock.meterRows !== FLAGS.meters) problems.push(`the dock painted ${proof.dock.meterRows} meter cards, expected ${FLAGS.meters}`);
      if (proof.dock.oscRows === 0) problems.push('the dock rendered no OSC terminal rows');
      if (proof.bridge.meterRows !== FLAGS.meters) problems.push(`the bridge painted ${proof.bridge.meterRows} meter strips, expected ${FLAGS.meters}`);
      if (proof.bridge.sent.meterFrames === 0) problems.push('the bridge is not receiving meter frames');
      if (problems.length > 0) throw new Error(`the soak is not driving the app: ${problems.join('; ')}`);

      await dock.tab.evaluate(`window.__SOAK.fireStatus()`);
      await bridge.tab.evaluate(`window.__SOAK.fireStatus()`);
      console.log('  pre-flight status: live session announced to both windows');
      console.log('');

      const targets = [];
      for (let at = FLAGS.sampleSeconds * 1000; at < TOTAL_MS; at += FLAGS.sampleSeconds * 1000) targets.push(at);
      targets.push(TOTAL_MS);

      const epoch = Date.now();
      const rounds = [];
      let rotation = 0;
      for (const target of targets) {
        const wait = epoch + target - Date.now();
        if (wait > 0) await sleep(wait);
        const round = { at: Date.now() - epoch, byWindow: {} };
        // Started before the windows are sampled and collected after them: the tree read normally takes
        // ~80 ms, and this way even a slow one overlaps the five seconds of sampling instead of
        // delaying the round.
        const rssRead = chromeTreeRss(CHROME_PORT);
        for (const window of windows) {
          const step = Date.now();
          await window.tab.call('Page.bringToFront');
          // The driver keeps running; this only waits for the calls already in flight to land, so the
          // sampler is not reading the window behind a queue of the harness's own event batches.
          await driver.quietFor(window.name);
          await sleep(SETTLE_MS);
          const value = await sampleWindow(window);
          value.phases.front = Date.now() - step - value.tookMs;
          value.tookMs = Date.now() - step;
          round.byWindow[window.name] = value;
        }
        const settled = await Promise.race([rssRead, sleep(3000).then(() => null)]);
        const tree = settled || { totalBytes: null, reason: 'the read was still running when the round ended', pids: [], rootPids: [], ms: null };
        round.rssMs = tree.ms;
        round.rssNote = tree.reason || null;
        round.rssBytes = tree.totalBytes;
        round.rssPids = tree.pids.length;
        round.rssRoot = tree.rootPids[0] || null;
        rounds.push(round);
        console.log(formatRound(round, windows));
        // Hand the front back so the window that is not sampled now still paints: they alternate.
        rotation = (rotation + 1) % windows.length;
        await windows[rotation].tab.call('Page.bringToFront');
      }

      return report(windows, rounds);
    } finally {
      driver.stop();
    }
  } finally {
    await restoreStorage(windows);
    for (const socket of sockets) {
      // `terminate`, not `close`: a close handshake that is never completed would leave the pending
      // CDP calls' timeouts holding the process open after the report is printed.
      try { socket.terminate(); } catch (_) {}
    }
    sockets = [];
    for (const id of [...createdTabs]) closeTab(id);
    createdTabs.length = 0;
  }
}

// How many driver calls may be in flight per window. It is deliberately small: the sampler's own CDP
// calls queue behind them inside the renderer, so a deep queue delays every sample and starves the
// window's animation frames (a burst of twenty calls was measured leaving a 800 ms hole in the rAF
// sample). One tick carries a batch of frames and a batch of traces, so six is ample.
const MAX_IN_FLIGHT = 6;
// The driver's tick. Every tick sends **one** call per window carrying that tick's meter frames and
// that tick's trace rows; the app still receives one event per frame and one per trace.
const DRIVER_TICK_MS = 50;

function startDriver(windows) {
  const stops = [];
  const inFlight = new Map();
  let stopped = false;
  for (const window of windows) {
    const tab = window.tab;
    let outstanding = 0;
    window.dropped = { tick: 0, extra: 0 };
    // The calls are sent immediately instead of being chained one round trip at a time: the renderer
    // executes them in the order they arrived (CDP keeps that order) and a chain would cap the driver
    // at one round trip in flight, which measured at about 40 ms per call and left the app receiving
    // 49 of the 60 frames a second and 178 of the 300 traces it was asked for.
    const send = (kind, expression) => {
      if (stopped) return;
      // A browser that cannot keep up must not let the queue grow without bound: the tick that would
      // have fired is counted as dropped instead of being queued for ever.
      if (outstanding > MAX_IN_FLIGHT) {
        window.dropped[kind] += 1;
        return;
      }
      outstanding += 1;
      tab.evaluate(expression, 15_000)
        .catch(() => {})
        .then(() => { outstanding -= 1; });
    };
    inFlight.set(window.name, () => outstanding);

    // The rates are counted off the wall clock and the batch is that tick's share of them, so a late
    // tick catches up instead of silently lowering the rate the run reports. The catch-up is capped so
    // one missed second cannot arrive as an eight-second burst.
    const epoch = Date.now();
    const frameBatch = Math.max(1, Math.round((FLAGS.frameHz * DRIVER_TICK_MS) / 1000));
    const traceBatch = Math.max(1, Math.round((FLAGS.traceHz * DRIVER_TICK_MS) / 1000));
    let metersFired = 0;
    let tracesFired = 0;
    stops.push(setInterval(() => {
      const elapsed = Date.now() - epoch;
      const meters = Math.max(0, Math.min(Math.floor((elapsed * FLAGS.frameHz) / 1000) - metersFired, frameBatch * 6));
      const traces = Math.max(0, Math.min(Math.floor((elapsed * FLAGS.traceHz) / 1000) - tracesFired, traceBatch * 6));
      if (meters === 0 && traces === 0) return;
      const expression = `window.__SOAK.fireTick(${metersFired + 1}, ${meters}, ${tracesFired + 1}, ${traces})`;
      metersFired += meters;
      tracesFired += traces;
      send('tick', expression);
    }, DRIVER_TICK_MS));

    // The health grid, once a second, and the paths a show also reaches: macro runtime lines, action
    // reports, the verification refusal and a HUD alert.
    let seconds = 0;
    stops.push(setInterval(() => {
      seconds += 1;
      send('extra', 'window.__SOAK.fireHealth()');
      if (seconds % 5 === 0) send('extra', `window.__SOAK.fireMacro(${seconds})`);
      if (seconds % 10 === 0) send('extra', `window.__SOAK.fireAction(${seconds})`);
      if (seconds % 30 === 0) send('extra', `window.__SOAK.fireVerification(${seconds})`);
      if (seconds % 15 === 0) send('extra', `window.__SOAK.fireAlert(${seconds})`);
    }, 1000));
  }
  const stop = () => {
    stopped = true;
    for (const timer of stops) {
      clearInterval(timer);
      clearTimeout(timer);
    }
  };
  // Lets the sampler wait until the driver is not sitting on a queue of renderer work, so the sample
  // is taken in the state the run is in rather than behind a backlog the harness itself created.
  const quietFor = async (name, timeoutMs = 1500) => {
    const outstandingOf = inFlight.get(name);
    if (!outstandingOf) return;
    const deadline = Date.now() + timeoutMs;
    while (outstandingOf() > 2 && Date.now() < deadline) await sleep(25);
  };
  return { stop, quietFor };
}

async function waitFor(tab, expression, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await tab.evaluate(expression, 8000)) return;
    } catch (_) {}
    await sleep(150);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`);
}

async function sampleWindow(window) {
  const began = Date.now();
  const phases = {};
  const mark = (name, from) => {
    phases[name] = Date.now() - from;
  };
  // The heap is read after a collection: the gate is about what the window keeps, not about what the
  // collector has not got to yet.
  let step = Date.now();
  await window.tab.call('HeapProfiler.collectGarbage');
  mark('gc', step);
  step = Date.now();
  const metrics = await window.tab.evaluate(`window.__SOAK.metrics(${JSON.stringify(window.meterSelector)})`);
  mark('metrics', step);
  step = Date.now();
  const heap = await window.tab.call('Runtime.getHeapUsage');
  mark('heap', step);
  step = Date.now();
  const intervals = await window.tab.evaluate(
    `window.__SOAK.sampleRaf(${RAF_SAMPLE_MS}, ${RAF_DROP_FRAMES})`,
    RAF_SAMPLE_MS + 15_000,
  );
  mark('raf', step);
  const sorted = (Array.isArray(intervals) ? intervals : []).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return {
    heapBytes: heap?.usedSize ?? null,
    heapTotalBytes: heap?.totalSize ?? null,
    performanceMemoryUsed: metrics.performanceMemoryUsed,
    domNodes: metrics.domNodes,
    oscRows: metrics.oscRows,
    meterRows: metrics.meterRows,
    sent: metrics.sent,
    rafFrames: sorted.length,
    rafP50: percentile(sorted, 0.5),
    rafP95: percentile(sorted, 0.95),
    phases,
    tookMs: Date.now() - began,
  };
}

function formatRound(round, windows) {
  const rssText = round.rssBytes == null
    ? `chrome rss=n/a${round.rssNote ? ` (${round.rssNote})` : ''}`
    : `chrome rss=${mb(round.rssBytes)} over ${round.rssPids} processes (root ${round.rssRoot}, ${round.rssMs} ms)`;
  const lines = [`sample t=${(round.at / 1000).toFixed(1)} s  ${rssText}`];
  for (const window of windows) {
    const value = round.byWindow[window.name];
    lines.push(`  ${window.name.padEnd(6)} heap=${mb(value.heapBytes)} perf.memory=${value.performanceMemoryUsed == null ? 'n/a' : value.performanceMemoryUsed} dom=${value.domNodes} osc-rows=${value.oscRows} meters=${value.meterRows} raf p50=${value.rafP50 == null ? 'n/a' : value.rafP50.toFixed(2)}ms p95=${value.rafP95 == null ? 'n/a' : value.rafP95.toFixed(2)}ms (${value.rafFrames} frames) frames=${value.sent.meterFrames} traces=${value.sent.traces}`);
    lines.push(`         front+settle=${value.phases.front}ms gc=${value.phases.gc}ms metrics=${value.phases.metrics}ms heap=${value.phases.heap}ms raf=${value.phases.raf}ms (took ${value.tookMs} ms)`);
  }
  return lines.join('\n');
}

async function restoreStorage(windows) {
  const dock = windows.find((window) => window.name === 'dock') || windows[0];
  if (!dock?.tab) return;
  try {
    const restored = await dock.tab.evaluate(`(() => {
      if (window.__SOAK_PREV_CAPTURED !== true) return false;
      try {
        localStorage.clear();
        var previous = window.__SOAK_PREV || {};
        for (var key in previous) {
          if (Object.prototype.hasOwnProperty.call(previous, key)) localStorage.setItem(key, previous[key]);
        }
        return true;
      } catch (_) { return false; }
    })()`, 8000);
    console.log(restored
      ? 'localStorage of the shared file:// origin restored to what it held before the soak'
      : 'note: localStorage could not be captured before the run, so it was left as it is');
  } catch (_) {}
}

function report(windows, rounds) {
  const failures = [];
  const notes = [];

  const baselineIndex = rounds.findIndex((round) => round.at >= WARMUP_MS);
  const baseIndex = baselineIndex < 0 ? rounds.length - 1 : baselineIndex;
  const finalIndex = rounds.length - 1;

  console.log('');
  console.log(`=== soak summary — ${(TOTAL_MS / 1000 / 60).toFixed(1)} min run, warm-up ${(WARMUP_MS / 1000).toFixed(1)} s, ${rounds.length} samples ===`);
  console.log(`baseline = sample ${baseIndex + 1} (t=${(rounds[baseIndex].at / 1000).toFixed(1)} s, end of warm-up), final = sample ${finalIndex + 1} (t=${(rounds[finalIndex].at / 1000).toFixed(1)} s)`);
  console.log('');

  const row = (label, base, final, format, limit) => {
    const delta = typeof base === 'number' && typeof final === 'number' && base !== 0 ? (final - base) / base : null;
    const verdict = limit != null && delta != null ? (delta > limit ? `  ** OVER ${(limit * 100).toFixed(0)} % **` : '') : '';
    console.log(`  ${label.padEnd(22)} ${format(base).padStart(12)} ${format(final).padStart(12)} ${signed(delta == null ? null : delta * 100).padStart(10)}${verdict}`);
    return delta;
  };

  for (const window of windows) {
    const base = rounds[baseIndex].byWindow[window.name];
    const final = rounds[finalIndex].byWindow[window.name];
    console.log(`${window.name.toUpperCase()}  ${window.label}`);
    console.log(`  ${'metric'.padEnd(22)} ${'baseline'.padStart(12)} ${'final'.padStart(12)} ${'delta'.padStart(10)}`);

    const heapDelta = row('JS heap used', base.heapBytes, final.heapBytes, mb, HEAP_GROWTH_LIMIT);
    if (heapDelta == null) notes.push(`${window.name}: the JS heap could not be measured, the heap gate was skipped`);
    else if (heapDelta > HEAP_GROWTH_LIMIT) {
      failures.push(`${window.name}: JS heap grew ${signed(heapDelta * 100)} (${mb(base.heapBytes)} -> ${mb(final.heapBytes)}), over the ${HEAP_GROWTH_LIMIT * 100} % limit`);
    }

    const domDelta = row('DOM nodes', base.domNodes, final.domNodes, (value) => String(value), DOM_GROWTH_LIMIT);
    if (domDelta != null && domDelta > DOM_GROWTH_LIMIT) {
      failures.push(`${window.name}: DOM node count grew ${signed(domDelta * 100)} (${base.domNodes} -> ${final.domNodes}), over the ${DOM_GROWTH_LIMIT * 100} % limit`);
    }

    row('.osc-row rows', base.oscRows, final.oscRows, (value) => String(value), null);
    row('meter rows', base.meterRows, final.meterRows, (value) => String(value), null);

    row('rAF p50 (ms)', base.rafP50, final.rafP50, (value) => (value == null ? 'n/a' : value.toFixed(2)), null);
    const rafDelta = row('rAF p95 (ms)', base.rafP95, final.rafP95, (value) => (value == null ? 'n/a' : value.toFixed(2)), null);
    if (base.rafP95 == null || final.rafP95 == null) {
      notes.push(`${window.name}: the rAF sample came back empty, the frame-interval gate was skipped`);
    } else if (final.rafP95 > base.rafP95 * RAF_P95_FACTOR_LIMIT) {
      failures.push(`${window.name}: rAF p95 went from ${base.rafP95.toFixed(2)} ms to ${final.rafP95.toFixed(2)} ms, more than ${RAF_P95_FACTOR_LIMIT}x`);
    } else if (rafDelta != null && rafDelta > 0.25) {
      noteOnce(notes, `${window.name}: rAF p95 grew ${signed(rafDelta * 100)} but stayed under the ${RAF_P95_FACTOR_LIMIT}x limit`);
    }

    row('meter frames sent', base.sent.meterFrames, final.sent.meterFrames, (value) => String(value), null);
    row('OSC traces sent', base.sent.traces, final.sent.traces, (value) => String(value), null);
    row('health events sent', base.sent.health, final.sent.health, (value) => String(value), null);
    row('macros/actions/alerts', base.sent.macroRuns + base.sent.actions + base.sent.alerts, final.sent.macroRuns + final.sent.actions + final.sent.alerts, (value) => String(value), null);

    if (final.sent.meterFrames <= base.sent.meterFrames) {
      failures.push(`${window.name}: no meter frame reached the window after the warm-up (${base.sent.meterFrames} -> ${final.sent.meterFrames}) — the run measured nothing`);
    }
    const drops = window.dropped || {};
    const droppedTotal = (drops.tick || 0) + (drops.extra || 0);
    if (droppedTotal > 0) {
      notes.push(`${window.name}: ${droppedTotal} driver ticks were dropped because the tab could not keep up (event ticks ${drops.tick || 0}, health/extras ${drops.extra || 0})`);
    }
    console.log('');
  }

  // A round whose RSS read timed out is skipped rather than failing the run: the nearest round that has
  // a number is used, and which one it was is printed.
  const nearestRss = (index) => {
    for (let distance = 0; distance < rounds.length; distance += 1) {
      for (const candidate of [index - distance, index + distance]) {
        if (candidate >= 0 && candidate < rounds.length && typeof rounds[candidate].rssBytes === 'number') {
          return { index: candidate, bytes: rounds[candidate].rssBytes };
        }
      }
    }
    return null;
  };
  const rssBaseSample = nearestRss(baseIndex);
  const rssFinalSample = nearestRss(finalIndex);
  const rssBase = rssBaseSample?.bytes ?? null;
  const rssFinal = rssFinalSample?.bytes ?? null;
  console.log(`CHROME PROCESS TREE (port ${CHROME_PORT})`);
  console.log(`  ${'metric'.padEnd(22)} ${'baseline'.padStart(12)} ${'final'.padStart(12)} ${'delta'.padStart(10)}`);
  const rssDelta = row('resident memory', rssBase, rssFinal, mb, RSS_GROWTH_LIMIT);
  if (rssBaseSample && rssBaseSample.index !== baseIndex) {
    console.log(`  (baseline RSS taken at t=${(rounds[rssBaseSample.index].at / 1000).toFixed(1)} s: the sample at the warm-up had no reading)`);
  }
  if (rssFinalSample && rssFinalSample.index !== finalIndex) {
    console.log(`  (final RSS taken at t=${(rounds[rssFinalSample.index].at / 1000).toFixed(1)} s: the last sample had no reading)`);
  }
  if (rssDelta == null) {
    const reasons = [...new Set(rounds.map((round) => round.rssNote).filter(Boolean))];
    notes.push(`Chrome process tree RSS could not be measured${reasons.length > 0 ? ` (${reasons.join('; ')})` : ''}`);
  } else if (rssDelta > RSS_GROWTH_LIMIT) {
    failures.push(`Chrome RSS grew ${signed(rssDelta * 100)} (${mb(rssBase)} -> ${mb(rssFinal)}), over the ${RSS_GROWTH_LIMIT * 100} % limit`);
  }
  console.log('');

  // `performance.memory` is the field the gate names, but headless Chrome quantises it to a constant.
  // Say so rather than reporting a stable number that means nothing.
  const perfValues = new Set();
  for (const round of rounds) {
    for (const window of windows) perfValues.add(round.byWindow[window.name].performanceMemoryUsed);
  }
  if (perfValues.size <= 1) {
    const only = [...perfValues][0];
    notes.unshift(`performance.memory.usedJSHeapSize was unusable in this headless Chrome: it answered ${only == null ? 'null' : only} in every sample of every window whatever the load was. The heap numbers above are Runtime.getHeapUsage().usedSize (after HeapProfiler.collectGarbage), which is the same quantity without the quantisation.`);
  }

  for (const note of notes) console.log(`note: ${note}`);
  if (notes.length > 0) console.log('');

  if (failures.length > 0) {
    console.log('SOAK FAILED');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('SOAK PASSED: no window grew past its heap, DOM, frame-interval or Chrome-RSS limit');
  process.exitCode = 0;
}

function noteOnce(notes, note) {
  if (!notes.includes(note)) notes.push(note);
}

/**
 * Empties stdout before the process goes. The report is written to a pipe when the gate runs the
 * harness, and a pipe write is asynchronous: exiting while it is still buffered would truncate it.
 */
function flushStdout() {
  return new Promise((resolve) => {
    if (process.stdout.writableLength === 0) {
      resolve();
      return;
    }
    process.stdout.write('', () => resolve());
  });
}

// Everything the run had to do (the tabs closed, the storage put back, the driver stopped) has already
// happened by the time this settles; the explicit exit is what keeps a late CDP answer or an undici
// keep-alive socket from holding the process open after the report.
main()
  .then(async () => {
    await flushStdout();
    process.exit(process.exitCode || 0);
  })
  .catch(async (error) => {
    console.error(`soak failed to run: ${String(error?.stack || error)}`);
    await flushStdout();
    process.exit(2);
  });
