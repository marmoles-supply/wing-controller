// What the Meter Bridge says about its link, and where it comes back.
//
// Two audit findings that both leave the operator without an answer (master plan 2026-09-22):
//
//   §5.2 item 26 — a real drop degraded to "Cannot reach console" and the retry ran with no counter,
//   so a refusal, a link that went and a console that is rebooting all read the same. The window now
//   has the dock's own vocabulary: connected, dropped + reconnecting (n), cannot reach console, and a
//   link lost with the dock's auto-reconnect switched off.
//
//   §8 Priority 3 — the restored geometry was trusted verbatim, so a window saved on a screen that is
//   no longer connected came back off-screen and "Popout" looked dead. The saved position is measured
//   against `availableMonitors()` and clamped back into a screen that exists.
//
// A third finding — the reconnection interval sawtoothing backwards because each tick recomputed it from
// a fresh timestamp — is pinned here too: the wait since the drop only ever grows.
//
// Needs Chrome on the debug port (the gate starts one); without it the test says so and passes.
//
// Run: node scripts/test-desktop-meter-bridge-status-browser.mjs
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
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
if (!target?.webSocketDebuggerUrl) throw new Error('could not open a Chrome tab for this test');
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
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// The window's own listeners are kept, not discarded: the contracts drive the real event path — the
// `usb-meter-stream-status` events the Rust side emits — instead of the rendering function alone. The
// positions the window asks for are recorded for the geometry contracts.
const STUB = `
  window.__wingTestDocument = String(Date.now()) + ':' + Math.random();
  window.__wingListeners = {};
  window.__wingPositions = [];
  window.__wingSizes = [];
  // One simulated window frame: the position and size the page is told it has. saveWindowGeometry()
  // runs on the way out of every document, so the stub has to report the frame it was actually given
  // or the test would be reading a position the window never had. It lives in sessionStorage because
  // the stub is injected again on every navigation and a real window keeps its frame across a reload.
  window.__wingFrame = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('__wingTestFrame') || '') || { x: 320, y: 180, width: 960, height: 640 };
    } catch (_) {
      return { x: 320, y: 180, width: 960, height: 640 };
    }
  })();
  const keepFrame = () => {
    try { sessionStorage.setItem('__wingTestFrame', JSON.stringify(window.__wingFrame)); } catch (_) {}
  };
  window.__wingMonitors = [
    { name: 'Main', position: { x: 0, y: 0 }, size: { width: 1440, height: 900 } },
  ];
  // The answer of get_stream_state: a snapshot a test sets, and the record of every call the window
  // made with the announcement that follows it. The bridge asks once at boot and must ask *before* it
  // tells the dock it is ready. The answer is kept in sessionStorage as well because the stub is
  // injected again on every navigation — a real backend keeps its state across a window reload, and a
  // seeded variable alone would be wiped by the reload the test uses to exercise it.
  window.__wingStreamStateAnswer = (() => {
    try {
      const kept = JSON.parse(sessionStorage.getItem('__wingTestStateAnswer') || '');
      if (kept && typeof kept === 'object') return kept;
    } catch (_) {}
    return {
      state: 'idle', message: '', sessionActive: false, sessionId: 0,
      deskModel: null, deskModelKnown: false, liveSafeMode: false,
      health: null, meterSources: [], metersWindowOpen: true, lastAlert: null,
    };
  })();
  window.__wingStateCalls = [];
  window.__wingReadyWrites = [];
  window.__wingBridgeBooted = false;
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === 'wing_meters_ready') window.__wingReadyWrites.push(value);
    return originalSetItem.call(this, key, value);
  };
  window.__TAURI__ = {
    core: {
      invoke: async (command) => {
        if (command === 'get_stream_state') {
          window.__wingStateCalls.push(Date.now());
          return JSON.parse(JSON.stringify(window.__wingStreamStateAnswer));
        }
        return {};
      },
    },
    event: { listen: async (name, handler) => { window.__wingListeners[name] = handler; return () => {}; } },
    window: {
      availableMonitors: async () => window.__wingMonitors,
      PhysicalPosition: function PhysicalPosition(x, y) { this.x = x; this.y = y; },
      PhysicalSize: function PhysicalSize(width, height) { this.width = width; this.height = height; },
      getCurrentWindow: () => ({
        setAlwaysOnTop: async () => {}, setFocus: async () => {},
        setPosition: async (position) => {
          window.__wingFrame.x = position.x;
          window.__wingFrame.y = position.y;
          keepFrame();
          window.__wingPositions.push({ x: position.x, y: position.y });
        },
        setSize: async (size) => {
          window.__wingFrame.width = size.width;
          window.__wingFrame.height = size.height;
          keepFrame();
          window.__wingSizes.push({ width: size.width, height: size.height });
        },
        outerPosition: async () => ({ x: window.__wingFrame.x, y: window.__wingFrame.y }),
        innerSize: async () => ({ width: window.__wingFrame.width, height: window.__wingFrame.height }),
        onCloseRequested: async () => () => {}, close: async () => {},
      }),
    },
  };
`;

await call('Page.enable');
await call('Page.bringToFront');
await call('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
await call('Page.navigate', { url: BRIDGE });
// Boot completion and a fresh document are independent of the state value under test.
// A fixed delay could sample the old, already-booted idle document after Page.reload.
async function waitForBridgeBoot(previousToken = null) {
  const deadline = Date.now() + 10_000;
  let observed = null;
  while (Date.now() < deadline) {
    try {
      observed = await evaluate(`(() => ({
        token: window.__wingTestDocument || null,
        booted: window.__wingBridgeBooted === true,
        listeners: Boolean(window.__wingListeners
          && window.__wingListeners['usb-meter-stream-status']
          && window.__wingListeners['meter-stream-health']
          && window.__wingListeners['usb-meter-stream-finished']),
        calls: (window.__wingStateCalls || []).length,
        readyWrites: (window.__wingReadyWrites || []).length,
      }))()`);
      if (observed.token && observed.token !== previousToken && observed.booted && observed.listeners) return;
    } catch (error) {
      if (!/context.*destroyed|Cannot find context|Inspected target navigated/i.test(String(error))) throw error;
    }
    await sleep(100);
  }
  throw new Error(`fresh Meter Bridge document must finish boot: ${JSON.stringify(observed)}`);
}
async function reloadBridge() {
  const previousToken = await evaluate('window.__wingTestDocument');
  await call('Page.reload');
  await waitForBridgeBoot(previousToken);
}
await waitForBridgeBoot();

// Seeds the answer the backend would give, surviving the reload the contract then performs. The state
// a window is handed at start-up is a backend fact, not a document one: the stub re-injects on every
// navigation, so the seeded snapshot is written where the injected script reads it.
const seedBackendState = (snapshot) => evaluate(`(() => {
  window.__wingStreamStateAnswer = ${JSON.stringify(snapshot)};
  sessionStorage.setItem('__wingTestStateAnswer', JSON.stringify(window.__wingStreamStateAnswer));
  return true;
})()`);


// The three events the window can see, driven exactly as the Rust side drives them.
const emit = (name, payload) => evaluate(`(() => {
  window.__wingListeners[${JSON.stringify(name)}]({ payload: ${JSON.stringify(payload)} });
  return true;
})()`);
const status = (state, message) => emit('usb-meter-stream-status', { state, message });
const health = (ageMs) => emit('meter-stream-health', {
  state: 'live', packets: 100, decodedEvents: 100, packetRateHz: 10, byteRateBps: 1000,
  lastRxMsAgo: ageMs, lastRenewMsAgo: 100, lastDecodeMicros: 10, droppedMeterCount: 0,
});
const painted = (extra = '') => evaluate(`(() => {
  ${extra}
  const badge = document.getElementById('bridge-status-badge');
  const center = document.getElementById('status-center');
  return { badge: badge.textContent, tone: badge.className, message: center.textContent };
})()`);

// The link states are reached by the window's own watchdog, which counts real milliseconds. Waiting for
// the badge to change is what makes the test independent of how long the machine takes to get there:
// a fixed sleep was the flakiest thing in this file (the state below alternates with the stall state
// while the last meter frame ages out).
const waitForBadge = async (pattern, label) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const look = await painted();
    if (pattern.test(look.badge)) return look;
    await sleep(100);
  }
  const last = await painted();
  throw new Error(`the badge never read ${label} (it stayed "${last.badge}")`);
};

try {
  // The preference an earlier run of this same profile may have left behind decides whether a drop
  // reads as "reconnecting" or as "lost", so the test starts from the dock's own default.
  await evaluate(`localStorage.setItem('wing_net_autoreconnect', 'true')`);

  // --- 1. A window with no session yet ---------------------------------------
  let look = await painted();
  assert(/CONNECT IN MAIN/.test(look.badge),
    `a bridge opened before the dock connects must say so (got "${look.badge}")`);
  assert(!/LIVE/.test(look.badge), 'and it must never claim a live link it does not have');

  // --- 2. A console that never answered is "refused", not "dropped" -----------
  await status('connecting', 'WING identity confirmed via Ethernet, WING Rack, UDP 2223, trigger=none');
  look = await painted();
  assert(/CONNECTING/.test(look.badge), `an attempt under way is CONNECTING (got "${look.badge}")`);
  assert(look.tone.includes('pending'), `and it must not wear the live tone (got "${look.tone}")`);

  const reason = 'No WING? reply from the console: check WING IP, console network settings and cable.';
  await status('error', reason);
  look = await painted();
  assert(/CANNOT REACH CONSOLE/.test(look.badge),
    `a link that never came up is a refusal, not a loss (got "${look.badge}")`);
  assert(!/LOST|DROPPED/.test(look.badge),
    `nothing was lost: the window must not say a link dropped (got "${look.badge}")`);
  assert(look.message.indexOf('console: check WING IP') > 0,
    `the refusal must quote the backend's reason (got "${look.message}")`);
  assert(look.tone.includes('offline'), `a refusal is not a live tone (got "${look.tone}")`);
  console.log('1-2. no session, then a first connect that never reached the console reads as a refusal');

  // --- 3. Connected ----------------------------------------------------------
  await health(40);
  look = await painted();
  assert(/LIVE LISTENING/.test(look.badge), `answering health is a live link (got "${look.badge}")`);
  assert(look.tone.includes('live'), `and it wears the live tone (got "${look.tone}")`);

  // --- 4. A real drop, and the counter ---------------------------------------
  // The backend reports the drop, then the dock's schedule starts a new attempt for each retry.
  await status('disconnected', 'no valid packets from the console for 3.5s');
  await emit('usb-meter-stream-finished', 'error');
  // The watchdog window has to pass before the health stops standing in for a live link. The stall
  // state is in between ("link up but no frames"), so the badge is polled until it reads the drop.
  look = await waitForBadge(/DROPPED/, 'DROPPED · RECONNECTING');
  assert(/RECONNECTING/.test(look.badge),
    `a link that was live and went must read as dropped and reconnecting (got "${look.badge}")`);
  assert(look.tone.includes('pending'), `a reconnection is a pending tone, not a dead one (got "${look.tone}")`);
  // The line itself is read a few seconds into the episode, when the technical message of the attempt
  // has gone stale: that is when the operator needs the plain sentence, and it must be there.
  const reconnectingLine = await evaluate(`bridgeLinkStatus(Date.now() + 6000).message`);
  assert(/reconnecting/i.test(reconnectingLine),
    `the status line must say what is happening (got "${reconnectingLine}")`);
  // The attempt is always the last number the badge carries.
  const attemptOf = (badge) => Number(badge.trim().split(/\s+/).pop());
  const firstAttempt = attemptOf(look.badge);
  assert(firstAttempt >= 1, `the badge must carry the attempt count (got "${look.badge}")`);

  await status('connecting', 'WING identity confirmed via Ethernet, WING Rack, UDP 2223, trigger=none');
  look = await painted();
  assert(/RETRY/.test(look.badge),
    `a retry being made must stay a retry, not fall back to a plain CONNECTING (got "${look.badge}")`);
  // One full retry of the dock's schedule, exactly as the backend reports it: the attempt announces
  // itself with `connecting`, and when the console does not answer the stream thread reports the
  // failure and tears itself down. That pair is what has to count as ONE attempt, not two, and the
  // failure must not erase the counter or turn the retry into a refusal the operator has to act on.
  await status('error', 'No WING? reply from the console: check WING IP, console network settings and cable.');
  await emit('usb-meter-stream-finished', 'error');
  const afterFailure = await painted();
  assert(/DROPPED/.test(afterFailure.badge) && /RECONNECTING/.test(afterFailure.badge),
    `an attempt that failed is still a reconnection, not a refusal to act on (got "${afterFailure.badge}")`);
  assert(await evaluate('bridgeRetryAttempts') === 1,
    'a failed retry counts as one attempt, not as two');

  await status('connecting', 'WING identity confirmed via Ethernet, WING Rack, UDP 2223, trigger=none');
  const secondAttempt = attemptOf((await painted()).badge);
  assert(secondAttempt === firstAttempt + 1,
    `each retry the dock starts must be counted once (got ${firstAttempt} then ${secondAttempt})`);
  await status('error', 'No WING? reply from the console: check WING IP, console network settings and cable.');

  // A third retry, to be sure the counter keeps climbing and does not stick at two.
  await status('connecting', 'WING identity confirmed via Ethernet, WING Rack, UDP 2223, trigger=none');
  await status('error', 'No WING? reply from the console: check WING IP, console network settings and cable.');
  const thirdAttempt = attemptOf((await painted()).badge);
  assert(thirdAttempt === firstAttempt + 2,
    `the counter must climb with every retry (got ${firstAttempt}, ${secondAttempt}, ${thirdAttempt})`);

  // The interval must not sawtooth: a later paint of the same drop says a longer wait, never a shorter
  // one. (It was recomputed from "now" on every tick, so it restarted on each repaint.)
  const waits = [];
  for (let sample = 0; sample < 3; sample += 1) {
    // Six seconds past the last message, so the plain "still trying" sentence is the one on screen
    // and it carries the elapsed wait.
    const said = await evaluate(`bridgeLinkStatus(Date.now() + ${6000 * (sample + 1)}).message`);
    waits.push(Number(/dropped ([0-9]+) s ago/.exec(said)?.[1] ?? -1));
  }
  assert(waits.every((value) => value >= 0), `the reconnecting line must state the wait (got ${JSON.stringify(waits)})`);
  assert(waits.every((value, index) => index === 0 || value > waits[index - 1]),
    `the wait since the drop must only grow (got ${JSON.stringify(waits)})`);

  // --- 5. Reconnected: the counter goes back to zero --------------------------
  await health(30);
  look = await painted();
  assert(/LIVE LISTENING/.test(look.badge), `health returning is the reconnect succeeding (got "${look.badge}")`);
  const counter = await evaluate('bridgeRetryAttempts');
  assert(counter === 0, `a link that is back has no retries pending (counter = ${counter})`);

  // --- 6. Auto-reconnect off: lost, and not promised a retry ------------------
  await evaluate(`localStorage.setItem('wing_net_autoreconnect', 'false')`);
  await status('disconnected', 'no valid packets for 3.5s');
  look = await waitForBadge(/CONNECTION LOST/, 'CONNECTION LOST');
  assert(!/RECONNECTING/.test(look.badge), 'and the window must not claim one');
  await evaluate(`localStorage.removeItem('wing_net_autoreconnect')`);

  // --- 7. The operator disconnecting is not a drop ----------------------------
  await status('stopped', 'live meter stream stopped');
  await emit('usb-meter-stream-finished', 'ok');
  look = await painted();
  assert(!/DROPPED|LOST|RECONNECTING/.test(look.badge),
    `a stream the operator stopped is not a link that dropped (got "${look.badge}")`);
  assert(/CONNECT IN MAIN/.test(look.badge), `it is a session that is over (got "${look.badge}")`);
  console.log('3-7. connected, dropped and counted, reconnected, lost without auto-reconnect, and stopped');

  // --- 8. The restored geometry is validated against the screens that exist ---
  // The geometry and the stub's frame are set together: `saveWindowGeometry()` runs on the way out of
  // the document and would otherwise store the frame of the moment over the seeded value.
  const seedGeometry = (x, y) => evaluate(`(() => {
    localStorage.setItem('wing_meters_geom', JSON.stringify({ x: ${x}, y: ${y}, width: 960, height: 640 }));
    window.__wingFrame.x = ${x};
    window.__wingFrame.y = ${y};
    sessionStorage.setItem('__wingTestFrame', JSON.stringify(window.__wingFrame));
    return true;
  })()`);
  await seedGeometry(9000, 9000);
  await reloadBridge();
  let placement = await evaluate(`({ positions: window.__wingPositions.slice(), sizes: window.__wingSizes.slice() })`);
  assert(placement.sizes.length === 1, `the saved size is still restored first (got ${JSON.stringify(placement.sizes)})`);
  assert(placement.positions.length >= 1, 'the saved position must be placed');
  const last = placement.positions[placement.positions.length - 1];
  assert(last.x >= 0 && last.y >= 0 && last.x + 960 <= 1440 && last.y + 640 <= 900,
    `a window saved on a screen that is gone must come back inside the one that exists (got ${JSON.stringify(last)})`);
  const stored = await evaluate(`JSON.parse(localStorage.getItem('wing_meters_geom'))`);
  assert(stored.x === last.x && stored.y === last.y,
    `the visible position must replace the off-screen one it was saved with (got ${JSON.stringify(stored)})`);

  // A geometry that is still on a screen is left exactly where it was: validating must not recentre
  // the window every time it opens.
  await seedGeometry(320, 180);
  await reloadBridge();
  placement = await evaluate(`({ positions: window.__wingPositions.slice(), stored: JSON.parse(localStorage.getItem('wing_meters_geom')) })`);
  const kept = placement.positions[placement.positions.length - 1];
  assert(kept.x === 320 && kept.y === 180,
    `a position that is still on a screen must be restored verbatim (got ${JSON.stringify(kept)})`);
  assert(placement.stored.x === 320 && placement.stored.y === 180,
    `and it must not be rewritten (got ${JSON.stringify(placement.stored)})`);

  // A second screen that took the window over: the geometry is kept, not pulled back to the primary.
  const onSecondScreen = await evaluate(`(async () => {
    window.__wingMonitors = [
      { name: 'Main', position: { x: 0, y: 0 }, size: { width: 1440, height: 900 } },
      { name: 'Stage', position: { x: 1440, y: 0 }, size: { width: 1920, height: 1080 } },
    ];
    const placed = await validatedWindowGeometry({ x: 1600, y: 200, width: 960, height: 640 });
    window.__wingMonitors = [{ name: 'Main', position: { x: 0, y: 0 }, size: { width: 1440, height: 900 } }];
    return placed;
  })()`);
  assert(onSecondScreen.x === 1600 && onSecondScreen.y === 200 && onSecondScreen.moved === false,
    `a window on a screen that is still there must not be moved (got ${JSON.stringify(onSecondScreen)})`);

  // And that screen going away brings it back to the one that is left.
  const fallenBack = await evaluate(`(async () => validatedWindowGeometry({ x: 1600, y: 200, width: 960, height: 640 }))()`);
  assert(fallenBack.moved === true && fallenBack.x + 960 <= 1440 && fallenBack.y + 640 <= 900,
    `a window whose screen is gone must fall back to a screen that exists (got ${JSON.stringify(fallenBack)})`);
  console.log('8. the restored geometry is clamped to a screen that exists, and an on-screen one is left alone');

  // --- 9. The disabled Remove button now looks disabled -----------------------
  // The audit's exact finding: "#btn-remove-selected-meters of the bridge has no :disabled rule (the
  // dock does)", so the button kept the enabled ink while refusing the click. The dock dims to #808080
  // on the light theme and #6a6a6a on the dark one, and both are checked: a rule that only covered one
  // theme would leave the window lying in the other.
  const disabledLook = await evaluate(`(() => {
    const button = document.getElementById('btn-remove-selected-meters');
    const read = () => {
      button.disabled = false;
      const enabled = getComputedStyle(button).color;
      button.disabled = true;
      const style = getComputedStyle(button);
      return { enabled, disabledColor: style.color, shadow: style.textShadow, cursor: style.cursor };
    };
    // The ink a disabled control takes is the kit's --dim, so the expectation is read from the page's
    // own token rather than written here as two literals. It was two literals (#808080/#6a6a6a) and they
    // went stale the moment the workstation deleted its own pair for the kit's button:disabled rule
    // (desktop/ui/index.html:1387), which left this suite demanding a colour the application no longer
    // had anywhere — the "a rule written by hand drifts" defect, in a test.
    const probe = document.createElement('span');
    probe.style.color = 'var(--dim)';
    document.body.appendChild(probe);
    const dim = () => getComputedStyle(probe).color;
    document.body.classList.remove('theme-dark');
    const light = { ...read(), dim: dim() };
    document.body.classList.add('theme-dark');
    const dark = { ...read(), dim: dim() };
    document.body.classList.remove('theme-dark');
    probe.remove();
    return { isDisabled: button.disabled, light, dark };
  })()`);
  assert(disabledLook.isDisabled, 'the Remove button must start disabled with nothing selected');
  assert(disabledLook.light.disabledColor === disabledLook.light.dim,
    `the bridge must dim to the kit's --dim on the light theme (got "${disabledLook.light.disabledColor}", --dim is "${disabledLook.light.dim}")`);
  assert(disabledLook.dark.disabledColor === disabledLook.dark.dim,
    `and to the kit's --dim on the dark theme (got "${disabledLook.dark.disabledColor}", --dim is "${disabledLook.dark.dim}")`);
  assert(disabledLook.light.dim !== disabledLook.dark.dim,
    'the two themes must not share one dim ink, or the check above would pass in one of them by accident');
  assert(disabledLook.light.disabledColor !== disabledLook.light.enabled
    && disabledLook.dark.disabledColor !== disabledLook.dark.enabled,
    `a disabled button must not keep the enabled ink (light ${disabledLook.light.enabled}, dark ${disabledLook.dark.enabled})`);
  assert(disabledLook.light.cursor === 'default' && disabledLook.dark.cursor === 'default',
    `a disabled button must not offer a pointer (got "${disabledLook.light.cursor}")`);
  console.log('9. the bridge disables its buttons with the workstation\'s own rule, in both themes');

  // --- 10. The backend's truth, asked at start-up (item 17 / Milestone 1 item 9) ----------------
  // A bridge built or reloaded in the middle of a show has missed every event: the state query is what
  // makes it show the show instead of "Connect WING in the main window" over a live session.
  await seedBackendState({
    state: 'live',
    message: 'WING identity confirmed via Ethernet, WING Rack, UDP 2223, trigger=none',
    sessionActive: true,
    sessionId: 77,
    deskModel: 'WING Rack',
    deskModelKnown: true,
    liveSafeMode: false,
    health: {
      state: 'live', packets: 4242, decodedEvents: 4242, triggerHits: 0,
      packetRateHz: 20, byteRateBps: 20000, lastRxMsAgo: 60, lastRenewMsAgo: 900,
      lastDecodeMicros: 12, triggerLatencySamples: 0, droppedMeterCount: 0,
    },
    meterSources: ['dock', 'meter-popup'],
    metersWindowOpen: true,
    lastAlert: null,
  });
  await reloadBridge();
  const fromState = await evaluate(`(() => ({
    stateCalls: window.__wingStateCalls.length,
    readyWrites: window.__wingReadyWrites.length,
    readyAfterState: window.__wingReadyWrites.length === 1
      && window.__wingStateCalls.length === 1
      && window.__wingReadyWrites[0] !== undefined
      && Number(localStorage.getItem('wing_meters_ready')) > 0,
    badge: document.getElementById('bridge-status-badge').textContent,
    tone: document.getElementById('bridge-status-badge').className,
    message: document.getElementById('status-center').textContent,
    sessionId: bridgeSessionId,
    sessionActive: bridgeSessionActive,
    model: bridgeDeskModel,
    modelKnown: bridgeDeskModelKnown,
    packets: backendMeterPackets,
    rxAge: Date.now() - lastStreamRxTime,
  }))()`);
  assert(fromState.stateCalls === 1,
    `the bridge must ask the backend for the truth once at boot (asked ${fromState.stateCalls} times)`);
  assert(fromState.sessionId === 77 && fromState.sessionActive === true,
    `the answer's session must be adopted (id ${fromState.sessionId}, active ${fromState.sessionActive})`);
  assert(fromState.model === 'WING Rack' && fromState.modelKnown === true,
    `the announced desk family must be readable by the window (got ${JSON.stringify(fromState.model)})`);
  assert(/LIVE LISTENING/.test(fromState.badge) && fromState.tone.includes('live'),
    `a session that is live must not be reported as anything else (got "${fromState.badge}")`);
  assert(fromState.rxAge >= 0 && fromState.rxAge < 3500,
    `the health of the live session must date the link (rx was ${fromState.rxAge} ms ago)`);
  assert(fromState.packets === 4242, `the health's packet count must arrive with it (got ${fromState.packets})`);
  assert(fromState.readyWrites === 1 && fromState.readyAfterState,
    `the dock must be told the bridge is ready exactly once, after the state was asked (got ${fromState.readyWrites})`);
  console.log('10. the bridge paints a live session from get_stream_state before it announces itself');

  // A session that is over must not be handed to the window as if it were current: the health is null
  // and the badge has to say the truth rather than the frozen numbers of the dead session.
  await seedBackendState({
    state: 'disconnected', message: 'no valid packets for 3.5s', sessionActive: false, sessionId: 0,
    deskModel: 'WING Rack', deskModelKnown: true, liveSafeMode: false,
    health: null, meterSources: [], metersWindowOpen: true, lastAlert: null,
  });
  await reloadBridge();
  const afterDrop = await evaluate(`({
    badge: document.getElementById('bridge-status-badge').textContent,
    message: document.getElementById('status-center').textContent,
    packets: backendMeterPackets,
    rx: lastStreamRxTime,
  })`);
  assert(!/LIVE/.test(afterDrop.badge),
    `a dead session must never be painted as live (got "${afterDrop.badge}")`);
  assert(afterDrop.packets === 0 && afterDrop.rx === 0,
    `and its frozen health must not be adopted (packets ${afterDrop.packets}, rx ${afterDrop.rx})`);
  console.log('10b. a session that is over is not reported as a live one');

  // --- 11. Frames from another session are dropped (item 31) -------------------
  await seedBackendState({
    state: 'live', message: 'live', sessionActive: true, sessionId: 70,
    deskModel: 'WING Rack', deskModelKnown: true, liveSafeMode: false,
    health: { state: 'live', packets: 10, decodedEvents: 10, triggerHits: 0, packetRateHz: 10,
      byteRateBps: 1000, lastRxMsAgo: 20, lastRenewMsAgo: 900, lastDecodeMicros: 5,
      triggerLatencySamples: 0, droppedMeterCount: 0 },
    meterSources: ['meter-popup'], metersWindowOpen: true, lastAlert: null,
  });
  await reloadBridge();
  const frameSession = await evaluate(`(() => {
    const frames = (window.__wingListeners || {})['usb-meter-frame'];
    const before = packetCount;
    frames({ payload: { session_id: 70, packet_index: 1, meters: [] } });
    const sameSession = packetCount - before;
    frames({ payload: { session_id: 69, packet_index: 2, meters: [] } });
    const olderSession = packetCount - before - sameSession;
    frames({ payload: { sessionId: 69, packet_index: 3, meters: [] } });
    const olderCamel = packetCount - before - sameSession - olderSession;
    // The status that starts a new session names it: from there the old stream's frames are dropped.
    (window.__wingListeners || {})['usb-meter-stream-status']({
      payload: { state: 'connecting', message: 'updating native meter subscription', session_id: 71 },
    });
    const adopted = bridgeSessionId;
    frames({ payload: { session_id: 70, packet_index: 4, meters: [] } });
    const afterSwitch = packetCount - before - sameSession - olderSession - olderCamel;
    frames({ payload: { session_id: 71, packet_index: 5, meters: [] } });
    const newSession = packetCount - before - sameSession - olderSession - olderCamel - afterSwitch;
    return { sameSession, olderSession, olderCamel, adopted, afterSwitch, newSession };
  })()`);
  assert(frameSession.sameSession === 1, `the current session's frame must be kept (got ${frameSession.sameSession})`);
  assert(frameSession.olderSession === 0 && frameSession.olderCamel === 0,
    `a frame from another session must be dropped, snake_case or camelCase (got ${frameSession.olderSession}/${frameSession.olderCamel})`);
  assert(frameSession.adopted === 71, `the status must move the window to the session it names (got ${frameSession.adopted})`);
  assert(frameSession.afterSwitch === 0,
    `and the frames of the session just left must be dropped from then on (got ${frameSession.afterSwitch})`);
  assert(frameSession.newSession === 1, `while the new session's frames are painted (got ${frameSession.newSession})`);
  console.log('11. only the current session\'s frames are painted');

  // --- 12. An alert missed while the bridge was loading, shown once -------------
  // The backend records the last alert with its sequence, so a window that was still being built when
  // it went out can still show it (item 24). What must not happen is the same alert popping up twice:
  // the event showed it, the state query must then leave it alone.
  const recordedAlert = {
    sequence: 9,
    target: 'meters',
    delivered: false,
    alert: { title: 'MISSED ALERT', message: 'while the bridge was loading', urgency: 'info', durationMs: 0 },
  };
  await seedBackendState({
    state: 'live', message: 'live', sessionActive: true, sessionId: 72,
    deskModel: 'WING Rack', deskModelKnown: true, liveSafeMode: false,
    health: { state: 'live', packets: 5, decodedEvents: 5, triggerHits: 0, packetRateHz: 10,
      byteRateBps: 1000, lastRxMsAgo: 20, lastRenewMsAgo: 900, lastDecodeMicros: 5,
      triggerLatencySamples: 0, droppedMeterCount: 0 },
    meterSources: ['meter-popup'], metersWindowOpen: true,
    lastAlert: recordedAlert,
  });
  await reloadBridge();
  const missedAlert = await evaluate(`({
    overlay: document.getElementById('hud-alert-overlay').classList.contains('active'),
    title: document.getElementById('hud-overlay-title')?.textContent || '',
    shown: bridgeShownAlertKeys.size,
  })`);
  assert(missedAlert.overlay === true, 'an alert recorded while the bridge was loading must be shown when it asks for the state');
  assert(/MISSED ALERT/.test(missedAlert.title), `and it must be the recorded one (got "${missedAlert.title}")`);

  // The same document asking again (a later state query) must not reopen it, and the event route marks
  // the alert as displayed before the same alert can arrive through the recorded one.
  const replay = await evaluate(`(async () => {
    const before = bridgeShownAlertKeys.size;
    applyBackendStreamState(window.__wingStreamStateAnswer);
    await syncBridgeState();
    return { before, after: bridgeShownAlertKeys.size, overlay: document.getElementById('hud-alert-overlay').classList.contains('active') };
  })()`);
  assert(replay.after === replay.before,
    `an alert already displayed must not be counted again (${replay.before} -> ${replay.after})`);
  const eventThenState = await evaluate(`(() => {
    document.getElementById('hud-alert-overlay').className = '';
    const payload = { title: 'LIVE ALERT', message: 'one route is enough', urgency: 'info', targetWindow: 'meters', durationMs: 0 };
    window.__wingListeners['hud-alert']({ payload });
    const afterEvent = document.getElementById('hud-alert-overlay').classList.contains('active');
    document.getElementById('hud-alert-overlay').className = '';
    applyBackendStreamState({ state: 'live', sessionActive: true, sessionId: 72,
      lastAlert: { sequence: 10, target: 'meters', delivered: true, alert: payload } });
    return { afterEvent, afterState: document.getElementById('hud-alert-overlay').classList.contains('active') };
  })()`);
  assert(eventThenState.afterEvent === true, 'the event route must show the alert');
  assert(eventThenState.afterState === false,
    'the recorded route must not show the same alert again once the event has shown it');
  // And an alert addressed to the dock is not this window's to show.
  const notMine = await evaluate(`(() => {
    document.getElementById('hud-alert-overlay').className = '';
    applyBackendStreamState({ state: 'live', sessionActive: true, sessionId: 72,
      lastAlert: { sequence: 11, target: 'main', delivered: true,
        alert: { title: 'DOCK ONLY', message: 'not the bridge', urgency: 'info', durationMs: 0, targetWindow: 'main' } } });
    return document.getElementById('hud-alert-overlay').classList.contains('active');
  })()`);
  assert(notMine === false, 'an alert addressed to the dock must not be shown by the bridge');
  console.log('12. a missed alert is shown once, and never a second time through the state query');

  console.log('meter bridge status and geometry contracts passed');
} finally {
  socket.close();
}

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
