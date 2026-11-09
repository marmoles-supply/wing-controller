// Verifies the timecode clock window: the readout an operator puts on a second screen.
//
// The clock is a **view**, and the two things worth pinning are what it shows before anything arrives and what it
// says when a control it offers cannot work. A clock that showed a confident `00:00:00:00` with no timecode running
// would be the worst possible lie for a show: it would look like a show that had started.
//
// It also asserts the pin, because a stage wants the clock above everything else and the permission for it is
// already granted: pressing it without a backend must say so rather than appearing to pin.
//
// And it pins the cue-delivery line, whose whole job is to answer "was anything lost?": hidden only when no timecode
// has ever arrived (nothing to count), on screen with zeros while timecode runs, and marked as trouble only when
// something is unconfirmed or lost. A counter that needed a cue to have fired before it appeared could not answer
// the question it exists for — that is the defect this suite holds down.
//
// The second half drives the cue panel, which is the feature the owner asked for: the chevron and the window that
// grows and remembers its box; the list ordered by SMPTE **by default** with the order as a view choice that writes
// nothing; the row's facts (time, name, active, fired, skipped); the clash of two cues in one frame, both kept and
// never moved on their own; the time editor that is **local** and a Save button that is **explicit** — a nudge must
// reach no command at all, because `set_timecode_cues` re-arms the engine; and the position and the countdown moving
// continuously instead of stepping once every 250 ms.
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is closed.
//
// Run: node scripts/test-desktop-timecode-clock-browser.mjs
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
const pageErrors = [];
socket.on('message', (data) => {
  const response = JSON.parse(data);
  if (response.method === 'Runtime.exceptionThrown') {
    const details = response.params?.exceptionDetails || {};
    pageErrors.push(details.exception?.description || details.text || 'unknown exception');
  }
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

/// The commands the clock calls on its own, once every 250 ms: reading the state and draining the ledger. They are
/// not "the window did something", so a case that asserts a press reached **no** command filters them out — otherwise
/// the assertion would be measuring the poll's timing rather than the press.
const cueCommands = () => evaluate(`window.__INVOKES.map((entry) => entry.cmd)
  .filter((cmd) => !['timecode_state', 'timecode_pending_cues', 'get_timecode_cues'].includes(cmd))`);

/// Wait until the page says something is true, or fail the way a timeout should: with what it last said.
async function waitFor(expression, what, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what} (${expression})`);
}

/// The window's store, provided by the suite so that each case can seed **exactly** the remembered state it is about.
/// The application runs on `tauri://localhost` and the browser suites share one Chrome profile: reading that profile
/// would let a key left behind by another suite decide what this one sees, and writing it would leave keys behind in
/// turn. It is the same shape as the real one, and without it the remembered box, the remembered panel and the
/// remembered order — the parts of the panel that only exist across a reload — could not be tested at all.
function storageStub(seed = {}) {
  return `
    (() => {
      const store = new Map(Object.entries(${JSON.stringify(seed)}));
      const fake = {
        getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: (key) => { store.delete(String(key)); },
        clear: () => store.clear(),
        key: (index) => [...store.keys()][index] ?? null,
        get length() { return store.size; },
      };
      Object.defineProperty(window, 'localStorage', { configurable: true, get: () => fake });
    })();
  `;
}

/// The fake desktop frame the window runs against. `sizes` records every `setSize` the window asks for, which is how
/// "the window grows when the panel unfolds and goes back to 420x200 when it folds" is measured; `handlers` collects
/// the window's `timecode-cue` listener, so the engine's announcements can be delivered the way the backend delivers
/// them.
///
/// `grows` is what the fake frame does with a `setSize` request:
///   * `true` — it takes the size **and announces it with `onResized` a macrotask later**, so a `read_window_box`
///     taken inside the `setSize` continuation still answers the old box. That timing is the whole point: a real
///     frame's `setSize` resolving means the request was accepted, not that the window already has the size, and
///     reading the box once — before the frame's own event — is exactly the stale measurement this wiring exists to
///     avoid. The new size is answered as soon as the event has fired, which is what makes the second read truthful.
///   * a number — the frame **takes** the height it wants and announces it the same way, so the window can measure a
///     clamp instead of the size it asked for.
///   * `false` — the frame refuses it (a maximised frame, or an edge the display will not pass) and stays where it is.
///     It fires no resize event, which is the other real answer: the window waits out its bounded deadline, reads the
///     box again, and that read is what says it did not grow.
/// Without this the suite could only measure that the window *asked*, which is the claim being removed.
function tauriStub({ state = { state: 'nothing', pieces: 0, positions: 0, source: 'MTC' }, cues = [], sort = 'smpte', drive = 'sequential', sizes = true, events = true, pending = [], fault = null, grows = true } = {}) {
  return `
    (() => {
      window.__INVOKES = [];
      window.__SIZES = [];
      window.__HANDLERS = {};
      let cues = ${JSON.stringify(cues)};
      let sort = ${JSON.stringify(sort)};
      // The drive mode is served as a **sequential** show, which is what makes the contract below meaningful: the
      // backend's field has a default of timecode, so a payload from this window that forgot it would not fail - it
      // would quietly put the operator's sequence back on the clock.
      let drive = ${JSON.stringify(drive)};
      // The window's own box, as the frame reports it: it starts where the emulated window is, a request the frame
      // took is **pending** until it announces the resize, and the box follows only then.
      let frameWidth = 420;
      let frameHeight = 200;
      let pendingBox = null;
      let resizeWatchers = [];
      const growMode = ${JSON.stringify(grows)};
      function applyRequest(width, height) {
        if (growMode === false) return;
        // On a macrotask, never inside the call: a frame that answered setSize has not necessarily applied it, and a
        // read taken in the caller's own continuation must still see the old box. That is the timing a real frame has,
        // and it is what makes the window's re-read after the frame's own resize event the measurement, not a formality.
        setTimeout(() => {
          pendingBox = { width, height: typeof growMode === 'number' ? growMode : height };
          for (const watcher of resizeWatchers.splice(0)) watcher();
        }, 0);
      }
      window.__TAURI__ = {
        core: { invoke: async (cmd, args) => {
          window.__INVOKES.push({ cmd, args });
          if (cmd === ${JSON.stringify(fault?.command ?? '')}) throw new Error(${JSON.stringify(fault?.message ?? '')});
          switch (cmd) {
            case 'timecode_state': return window.__STATE_OVERRIDE || ${JSON.stringify(state)};
            // The order travels in the file, which is what makes it the show's: the window has to read it from here.
            // So does the drive mode, which this window does not own and must hand back untouched.
            case 'get_timecode_cues': return { schema_version: 1, cues, offset_frames: 0, sort, drive };
            case 'set_timecode_cues': cues = args.cues.cues; sort = args.cues.sort || sort; drive = args.cues.drive || drive; return { ...args.cues, sort, drive };
            case 'add_timecode_cue_from_position': return { schema_version: 1, cues, offset_frames: 0, sort, drive };
            case 'timecode_pending_cues': return ${JSON.stringify(pending)};
            // What the frame really holds, in logical points: the same unit setSize was given, so the window can
            // compare and say whether its request became a result.
            case 'read_window_box': {
              const box = pendingBox || { width: frameWidth, height: frameHeight };
              return { width: box.width, height: box.height, physicalWidth: box.width, physicalHeight: box.height,
                scaleFactor: 1, maximized: growMode === false, fullscreen: false, monitorWorkWidth: 1440, monitorWorkHeight: 875 };
            }
            default: return {};
          }
        } },
        event: ${events
          ? `{ listen: async (name, handler) => { window.__HANDLERS[name] = handler; return () => {}; } }`
          : 'undefined'},
        window: ${sizes
          ? `{ getCurrentWindow: () => ({ setAlwaysOnTop: async () => {},
                setSize: async (size) => { window.__SIZES.push({ width: size.width, height: size.height }); applyRequest(size.width, size.height); },
                onResized: async (handler) => { resizeWatchers.push(handler); return () => { resizeWatchers = resizeWatchers.filter((entry) => entry !== handler); }; } }),
               LogicalSize: class { constructor(width, height) { this.width = width; this.height = height; } } }`
          : 'undefined'},
      };
    })();
  `;
}

const CUE_FIELDS = (id, hours, minutes, seconds, frames, extra = {}) => ({
  id, at: { hours, minutes, seconds, frames, rate: 'fps25', drop_frame: false },
  macro_index: 0, repeats: false, enabled: true, note: '', ...extra,
});

await call('Page.enable');
await call('Runtime.enable');
// The visible tab, not a background one: Chrome gives a background tab no focused element, and this suite asserts
// that a keyboard nudge leaves the focus where it was — plus its animation frames are what the motion contract reads.
await call('Page.bringToFront');
await call('Emulation.setDeviceMetricsOverride', { width: 420, height: 200, deviceScaleFactor: 1, mobile: false });

const url = new URL('../desktop/ui/timecode.html', import.meta.url).href;

// --- 1. What the clock shows with no timecode running ---------------------------------------------
// The harness answers "nothing has arrived", which is what the backend says before any timecode: the clock must
// render that sentence rather than a confident zero.
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__TAURI__ = { core: { invoke: async (cmd) => (cmd === 'timecode_state'
    ? { state: 'nothing', pieces: 0, positions: 0, source: 'MTC' }
    : {}) }, event: { listen: async () => () => {} },
    window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {} }) } };`,
});
await call('Page.navigate', { url });
await waitFor('document.readyState === "complete" && Boolean(document.getElementById("position"))', 'the clock to load');
const initial = await evaluate(`(() => ({
  position: document.getElementById('position').textContent.trim(),
  state: document.getElementById('state').textContent.trim(),
  source: document.getElementById('source').textContent.trim(),
  nextCue: document.getElementById('next-cue').textContent.trim(),
  counters: document.getElementById('counters').textContent.trim(),
  delivery: document.getElementById('delivery').textContent.trim(),
  deliveryHidden: document.getElementById('delivery').hidden,
  pin: document.getElementById('pin').textContent.trim(),
  pinTitle: document.getElementById('pin').title,
}))()`);
// Dashes, dimmed: the first version drew them at 92 px in bright phosphor, which reads as a failed display, and the
// correction went too far and left the well empty — which the owner read, correctly, as "no timer". A clock waiting
// for timecode shows its placeholders, dimly, at a size that fits.
assert.equal(initial.position, '--:--:--:--',
  `a clock with nothing to show must show its placeholders (got ${JSON.stringify(initial.position)})`);
assert.match(initial.state, /Nothing has arrived yet/, `and must say so (got ${JSON.stringify(initial.state)})`);
assert.match(initial.counters, /messages read: 0/, `the counters render a zero only when the backend says zero (got ${JSON.stringify(initial.counters)})`);
assert.equal(initial.source, 'MTC', 'the source is named even before anything arrives');
// The cue-delivery line is hidden in exactly one state: no timecode has ever arrived, so there is nothing to count
// and nothing the clock could say. That is the only case, and the rest of this suite holds the line to it.
assert.equal(initial.deliveryHidden, true, 'with no timecode at all the delivery line is hidden');
assert.equal(initial.delivery, '', 'and it renders no counters, because there is nothing to count yet');
// The cue line is rendered from the snapshot: with no cue list it says "none", and never invents a cue.
assert.match(initial.nextCue, /none/, `the cue line says there is no cue (got ${JSON.stringify(initial.nextCue)})`);

assert.equal(initial.pin, 'Pin', 'the pin starts off');
assert.match(initial.pinTitle, /above every other window/, `the pin explains what it does (got ${JSON.stringify(initial.pinTitle)})`);

// --- 1b. A counter with zeros is still a counter ---------------------------------------------------
// The owner opened a build, saw no change and was right: a line whose whole job is to answer "was anything lost?"
// cannot be invisible while its value is zero. A zero answers that question and proves the feature is alive, so the
// clock shows it as soon as timecode has arrived — in the dim colour, not the warning one, because nothing is wrong.
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__TAURI__ = { core: { invoke: async (cmd) => (cmd === 'timecode_state'
    ? { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: 0 }
    : {}) }, event: { listen: async () => () => {} } };`,
});
await call('Page.navigate', { url });
await waitFor('Boolean(document.getElementById("position")) && /^01:00:12:\\d\\d$/.test(document.getElementById("position").textContent.trim())', 'the clock to run');
const idleRunning = await evaluate(`(() => ({
  state: document.getElementById('state').textContent.trim(),
  delivery: document.getElementById('delivery').textContent.trim(),
  deliveryHidden: document.getElementById('delivery').hidden,
  deliveryTrouble: document.getElementById('delivery').classList.contains('is-cue-trouble'),
}))()`);
assert.match(idleRunning.state, /Running · 25 fps/, `the clock is running (got ${JSON.stringify(idleRunning.state)})`);
assert.equal(idleRunning.deliveryHidden, false,
  'once timecode has arrived the delivery line is on screen, even before a single cue has fired');
assert.match(idleRunning.delivery, /Cues fired 0 · confirmed 0 · unconfirmed 0/,
  `and it says so with zeros (got ${JSON.stringify(idleRunning.delivery)})`);
assert.doesNotMatch(idleRunning.delivery, /retried|lost/,
  `zeros in the retry and loss counters are not invented as text (got ${JSON.stringify(idleRunning.delivery)})`);
assert.equal(idleRunning.deliveryTrouble, false,
  'with zeros the line carries no warning colour: it informs, it does not alarm');

// --- 2. The readout follows what the backend says --------------------------------------------------
// The harness answers `{}` for every command, which is exactly the awkward case: the clock must read it as "no
// timecode" rather than rendering blanks that look like a stopped show.
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__TAURI__ = { core: { invoke: async (cmd) => (cmd === 'timecode_state'
    ? { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC',
        cues: 2, next_cue: '01:00:20:00', next_cue_frames: 196, next_cue_seconds: 7.84,
        cues_fired: 3, cues_delivered: 2, fired_unconfirmed: 1, deliveries_deferred: 1, deliveries_lost: 0 }
    : {}) }, event: { listen: async () => () => {} } };`,
});
await call('Page.navigate', { url });
await waitFor('Boolean(document.getElementById("position")) && /^01:00:12:\\d\\d$/.test(document.getElementById("position").textContent.trim())', 'the clock to run');
const running = await evaluate(`(() => ({
  position: document.getElementById('position').textContent.trim(),
  state: document.getElementById('state').textContent.trim(),
  className: document.getElementById('state').className,
  counters: document.getElementById('counters').textContent.trim(),
  delivery: document.getElementById('delivery').textContent.trim(),
  deliveryHidden: document.getElementById('delivery').hidden,
  deliveryTrouble: document.getElementById('delivery').classList.contains('is-cue-trouble'),
}))()`);
assert.match(running.position, /^01:00:12:\d\d$/, 'the position is the one the backend reports, to the frame');
assert.match(running.state, /Running · 25 fps/, `with the rate (got ${JSON.stringify(running.state)})`);
assert.equal(running.className, '', 'a running clock carries no warning class');
assert.match(running.counters, /complete positions: 1/, `and the counters (got ${JSON.stringify(running.counters)})`);
// A cue the engine fired and the window has not confirmed is the one number that says a macro may not have run: it
// has to be on the surface an operator watches, counted, and marked — an order that only reached the log is the
// silent loss this line exists to prevent.
assert.equal(running.deliveryHidden, false, 'the delivery line stays on while timecode runs and a cue has fired');
assert.match(running.delivery, /Cues fired 3 · confirmed 2 · unconfirmed 1/,
  `the delivery counter says what fired and what was confirmed (got ${JSON.stringify(running.delivery)})`);
assert.match(running.delivery, /retried 1/, `including a hand-over the full queue had to retry (got ${JSON.stringify(running.delivery)})`);
assert.equal(running.deliveryTrouble, true, 'and an unconfirmed order is marked as trouble, not left in the dim grey');

// The line an operator reads before a cue is due: which cue is next, and how long there is.
const cueLine = await evaluate(`(() => ({
  cue: document.getElementById('next-cue').textContent.trim(),
  distance: document.getElementById('next-distance').textContent.trim(),
}))()`);
assert.equal(cueLine.cue, '01:00:20:00', `the next cue is named (got ${JSON.stringify(cueLine.cue)})`);
assert.match(cueLine.distance, /in 7\.[3-9] s/, `with the distance (got ${JSON.stringify(cueLine.distance)})`);

// The window is 420 x 200 and everything has to fit inside it: the first version drew the position at 92 px, which
// overflowed and pushed the state, the next cue and the counters out of the window — the owner saw a black box with
// giant dashes and nothing else.
const layout = await evaluate(`(() => {
  const inside = (id) => { const r = document.getElementById(id)?.getBoundingClientRect(); return r ? r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1 : false; };
  const position = document.getElementById('position');
  return {
    fits: position.scrollWidth <= position.clientWidth + 1,
    state: inside('state'), cue: inside('cue'), counters: inside('counters'), delivery: inside('delivery'),
    height: window.innerHeight, width: window.innerWidth,
  };
})()`);
assert.equal(layout.fits, true, `the position must fit its own box (${JSON.stringify(layout)})`);
// And the window follows the application's theme: the owner's window is dark and the clock was light grey, which is
// what "it does not match the theme" looks like. The key both other windows write is `wing_theme`.
// `file://` is an opaque origin and Chrome refuses localStorage there, which the application is not: it runs on
// `tauri://localhost`, where the key both other windows write works. So the theme is applied the way a change made in
// another window applies it — a `storage` event carrying the new value — which exercises the listener itself.
const themed = await evaluate(`(() => {
  window.dispatchEvent(new StorageEvent('storage', { key: 'wing_theme', newValue: 'dark' }));
  const style = getComputedStyle(document.body);
  const digits = (style.backgroundColor.match(/\\d+/g) || [0, 0, 0]).map(Number);
  return { dark: document.body.classList.contains('theme-dark'), background: style.backgroundColor,
    lum: Math.round(0.299 * digits[0] + 0.587 * digits[1] + 0.114 * digits[2]) };
})()`);
assert.equal(themed.dark, true, `a dark theme must reach the clock (got ${JSON.stringify(themed)})`);
assert.ok(themed.lum < 90, `and its surface must actually be dark, not light grey (got ${JSON.stringify(themed)})`);
// And back to light, so the rest of the suite sees the window it started with.
await evaluate(`window.dispatchEvent(new StorageEvent('storage', { key: 'wing_theme', newValue: 'light' }))`);
assert.equal(layout.state, true, `the state must be visible inside the window (${JSON.stringify(layout)})`);
assert.equal(layout.cue, true, `the next cue must be visible inside the window (${JSON.stringify(layout)})`);
assert.equal(layout.counters, true, `the counters must be visible inside the window (${JSON.stringify(layout)})`);
assert.equal(layout.delivery, true, `the cue-delivery line must stay inside the window too (${JSON.stringify(layout)})`);

// --- 3. The position and the countdown move with the timecode, not with the poll --------------------
// The snapshot arrives every 250 ms and painting it as it arrives makes the frames step four times a second, which
// is what the owner saw. There is no position stream to this window, so the clock interpolates locally between
// snapshots: the frames and the "in 7.8 s" have to advance on their own, and the interpolation may never paint a
// frame number the rate does not have.
const motion = [];
for (let sample = 0; sample < 12; sample += 1) {
  motion.push(await evaluate(`(() => ({
    position: document.getElementById('position').textContent.trim(),
    distance: document.getElementById('next-distance').textContent.trim(),
  }))()`));
  await sleep(70);
}
const frames = [...new Set(motion.map((sample) => sample.position))];
assert.ok(frames.length > 1,
  `the position must move continuously between snapshots, not once every 250 ms (saw ${JSON.stringify([...new Set(motion.map((s) => s.position))])})`);
for (const shown of frames) {
  assert.match(shown, /^01:00:12:\d\d$/, `every painted frame is within the second the snapshot gave (got ${JSON.stringify(shown)})`);
  const frame = Number(shown.slice(-2));
  assert.ok(frame >= 15 && frame <= 24,
    `and never invents a frame outside it (got ${JSON.stringify(shown)})`);
}
const distances = [...new Set(motion.map((sample) => sample.distance))];
assert.ok(distances.length > 1,
  `the countdown to the next cue must move with the timecode too (saw ${JSON.stringify(distances)})`);
for (const shown of distances) {
  const seconds = Number((/in (\d+\.\d) s/.exec(shown) || [])[1]);
  assert.ok(Number.isFinite(seconds) && seconds >= 7.3 && seconds <= 7.9,
    `and stay where the snapshot put it (got ${JSON.stringify(shown)})`);
}

// --- 4. The chevron: the panel unfolds, the window grows, and both are remembered --------------------
// Folded, this window is the clock it always was (420 x 200, the position, the state, the next cue and the pin).
// Unfolded, the panel needs height no 420 x 200 window has, so the window **grows** and the panel scrolls inside
// whatever height it gets — the geometry pattern index.html and meters.html already use. A frame that refuses to
// grow leaves a panel that still scrolls: the growth is comfort, not a requirement.
const manyCues = Array.from({ length: 14 }, (_, index) => CUE_FIELDS(`cue-${index + 1}`, 1, 0, index + 1, 10, { note: `Scene ${index + 1}` }));
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: tauriStub({
    state: { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: manyCues.length },
    cues: manyCues,
  }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length > 0', 'the cue list to render');
const folded = await evaluate(`(() => {
  const toggle = document.getElementById('cue-panel-toggle');
  const pin = document.getElementById('pin');
  const panel = document.getElementById('cue-panel');
  return {
    toggle: toggle.textContent.trim(),
    expanded: toggle.getAttribute('aria-expanded'),
    controls: toggle.getAttribute('aria-controls'),
    beforePin: Boolean(toggle.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING),
    hidden: panel.hidden,
    sizes: window.__SIZES.slice(),
    inside: ['state', 'cue', 'counters', 'delivery'].every((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1;
    }),
    height: window.innerHeight,
  };
})()`);
assert.match(folded.toggle, /Cues/, `the header must offer the cue panel (got ${JSON.stringify(folded.toggle)})`);
assert.equal(folded.beforePin, true, 'and it must sit before the Pin, which the owner already uses');
assert.equal(folded.controls, 'cue-panel', 'and say which panel it opens');
assert.equal(folded.expanded, 'false', 'a folded clock says it is folded');
assert.equal(folded.hidden, true, 'with the panel out of the way');
assert.deepEqual(folded.sizes, [], `and a folded clock asks the frame for nothing: it is already the size it opened at (${JSON.stringify(folded.sizes)})`);
assert.equal(folded.inside, true, 'folded, the clock reads exactly as it did before the panel existed');

await evaluate(`document.getElementById('cue-panel-toggle').click()`);
await waitFor('Boolean(document.getElementById("cue-panel")) && document.getElementById("cue-panel").hidden === false', 'the panel to unfold');
const unfolded = await evaluate(`(() => {
  const panel = document.getElementById('cue-panel');
  const toggle = document.getElementById('cue-panel-toggle');
  return {
    expanded: toggle.getAttribute('aria-expanded'),
    toggle: toggle.textContent.trim(),
    sizes: window.__SIZES.slice(),
    inside: ['position', 'state', 'cue', 'counters', 'delivery'].every((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1;
    }),
    scrolls: panel.scrollHeight > panel.clientHeight,
    rows: panel.querySelectorAll('.cue-row').length,
    lastRowInside: (() => {
      panel.scrollTop = panel.scrollHeight;
      const row = panel.querySelector('.cue-row:last-child');
      const box = panel.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
    })(),
  };
})()`);
assert.equal(unfolded.expanded, 'true', 'unfolding says so on the control');
assert.match(unfolded.toggle, /▾/, `and the chevron points down (got ${JSON.stringify(unfolded.toggle)})`);
assert.equal(unfolded.sizes.length >= 1, true, 'unfolding asks the frame for a taller window');
assert.deepEqual(unfolded.sizes[unfolded.sizes.length - 1], { width: 420, height: 460 },
  `and it asks for the remembered height, not for nothing (${JSON.stringify(unfolded.sizes)})`);
assert.equal(unfolded.inside, true,
  'with the panel open every reading the clock exists for is still inside the window it has now');
assert.equal(unfolded.rows, 14, 'and every cue is in the panel, not a truncated list');
assert.equal(unfolded.scrolls, true, 'the list scrolls rather than pushing the clock out of the window');
assert.equal(unfolded.lastRowInside, true, 'and the last cue is reachable by scrolling the panel to its end');

// And at the box it asked for, which is the layout the operator actually unfolds into: a whole cue row fits, first
// and last, and the clock's readings are still where they belong. 420x200 is the fallback for a frame that refuses
// to grow, so the two are measured separately rather than one being asked to prove the other.
await call('Emulation.setDeviceMetricsOverride', { width: 420, height: 460, deviceScaleFactor: 1, mobile: false });
await sleep(150);
const grown = await evaluate(`(() => {
  const panel = document.getElementById('cue-panel');
  const box = panel.getBoundingClientRect();
  panel.scrollTop = panel.scrollHeight;
  const last = panel.querySelector('.cue-row:last-child').getBoundingClientRect();
  panel.scrollTop = 0;
  const first = panel.querySelector('.cue-row').getBoundingClientRect();
  const control = panel.querySelector('.cue-row .cue-buttons button');
  return {
    height: window.innerHeight,
    lastRowWhole: last.top >= box.top - 1 && last.bottom <= box.bottom + 1,
    firstRowWhole: first.top >= box.top - 1 && first.bottom <= box.bottom + 1,
    inside: ['position', 'state', 'cue', 'counters', 'delivery'].every((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1;
    }),
    controlHeight: control ? control.getBoundingClientRect().height : null,
    controlFont: control ? parseFloat(getComputedStyle(control).fontSize) : null,
  };
})()`);
assert.equal(grown.height, 460, `the grown box is the one the window asked for (got ${grown.height})`);
assert.equal(grown.firstRowWhole && grown.lastRowWhole, true,
  `in the grown window a whole cue row fits, first and last (${JSON.stringify(grown)})`);
assert.equal(grown.inside, true, 'and the clock keeps its own readings inside the taller window too');
// The clock links `workstation.css`, whose page-wide button rules come later in the cascade than the sheet the
// shared row module injects. The row's own compact height must survive that: 24 px here would make the 420 x 200
// fallback lose the row it has room for.
assert.ok(grown.controlHeight >= 17.5 && grown.controlHeight <= 19,
  `the clock's cue-row control keeps the row's 18 px height, not the shared chrome's 24 px (got ${JSON.stringify(grown)})`);
await call('Emulation.setDeviceMetricsOverride', { width: 420, height: 200, deviceScaleFactor: 1, mobile: false });
await sleep(150);

await evaluate(`document.getElementById('cue-panel-toggle').click()`);
await waitFor('Boolean(document.getElementById("cue-panel")) && document.getElementById("cue-panel").hidden === true', 'the panel to fold away');
const refolded = await evaluate(`(() => {
  const sizes = window.__SIZES.slice();
  return { expanded: document.getElementById('cue-panel-toggle').getAttribute('aria-expanded'), last: sizes[sizes.length - 1],
    fit: window.__CUE_FIT ? { ...window.__CUE_FIT } : null };
})()`);
assert.equal(refolded.expanded, 'false', 'folding it back says so too');
assert.deepEqual(refolded.last, { width: 420, height: 200 },
  `and the window goes back to the 420 x 200 clock it opened as (${JSON.stringify(refolded.last)})`);
assert.deepEqual(refolded.fit, { requested: 200, actual: 200, grew: true, measured: true, maximized: false, fullscreen: false, monitorWorkHeight: 875 },
  `and folding compares the frame's own answer with what it asked for (${JSON.stringify(refolded.fit)})`);

// And it remembers: a clock left unfolded comes back unfolded, at the height it was left at, instead of the operator
// unfolding it again on every launch.
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: storageStub({ wing_timecode_cue_panel: 'open', wing_timecode_cue_height: '520' }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length > 0', 'the remembered list to render');
const remembered = await evaluate(`(() => ({
  expanded: document.getElementById('cue-panel-toggle').getAttribute('aria-expanded'),
  hidden: document.getElementById('cue-panel').hidden,
  sizes: window.__SIZES.slice(),
  rows: document.querySelectorAll('#cue-list .cue-row').length,
  fit: window.__CUE_FIT ? { ...window.__CUE_FIT } : null,
}))()`);
assert.equal(remembered.hidden, false, 'a panel left open must come back open');
assert.equal(remembered.expanded, 'true', 'and its chevron with it');
assert.deepEqual(remembered.sizes[0], { width: 420, height: 520 },
  `at the height it was left at, not at the default (${JSON.stringify(remembered.sizes)})`);
assert.equal(remembered.rows, 14, 'with the list already painted when it is');
// A request is not a result, and the window says which it got: the frame's own report agrees with what was asked, so
// this window grew. This is the measurement a `setSize` that merely resolved could never make.
assert.deepEqual(remembered.fit, { requested: 520, actual: 520, grew: true, measured: true, maximized: false, fullscreen: false, monitorWorkHeight: 875 },
  `unfolding reports the growth it measured, not the one it asked for (${JSON.stringify(remembered.fit)})`);
assert.equal(await evaluate(`document.getElementById('cue-fit').hidden`), true,
  'a window that grew has nothing to explain, so the sentence stays away');

// --- 4b. A frame that refuses the size: the window says so instead of claiming it grew -----------------
// The other half of the same contract. A maximised frame (or one clamped by the display's work area) accepts
// `setSize` and keeps its own size, and the old wiring returned `true` because the call resolved — a panel that
// believes a height the window does not have. The stub's frame reports the height it really holds, with the two facts
// that explain it, and the window's own fit says it did not grow rather than leaving the claim standing.
const refusedCues = Array.from({ length: 14 }, (_, index) => CUE_FIELDS(`cue-${index + 1}`, 1, 0, index + 1, 10, { note: `Scene ${index + 1}` }));
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: tauriStub({
    state: { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: refusedCues.length },
    cues: refusedCues,
    grows: false,
  }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length > 0', 'the list to render against a frame that will not grow');
await evaluate(`document.getElementById('cue-panel-toggle').click()`);
await waitFor('Boolean(window.__CUE_FIT)', 'the window to compare its request with the frame');
const refusedFit = await evaluate(`(() => ({
  sizes: window.__SIZES.slice(),
  fit: window.__CUE_FIT ? { ...window.__CUE_FIT } : null,
  panelScrolls: (() => { const panel = document.getElementById('cue-panel'); return panel.scrollHeight > panel.clientHeight; })(),
  fitLine: (() => { const line = document.getElementById('cue-fit'); return { hidden: line.hidden, text: line.textContent.trim() }; })(),
}))()`);
assert.deepEqual(refusedFit.sizes[refusedFit.sizes.length - 1], { width: 420, height: 460 },
  'the window still asks for the height the panel needs');
assert.equal(refusedFit.fit?.grew, false,
  `but it does not claim the frame gave it: it measured 200 where it asked for 460 (${JSON.stringify(refusedFit.fit)})`);
assert.equal(refusedFit.fit?.measured, true, 'the frame answered, so the refusal is a measurement, not silence');
assert.equal(refusedFit.fit?.maximized, true, 'with the frame\'s own explanation — it is already maximised');
assert.equal(refusedFit.fit?.monitorWorkHeight, 875, 'and the height its display actually offers, which is the ceiling it hit');
assert.equal(refusedFit.panelScrolls, true, 'the panel scrolls in the height it really has, so nothing is out of reach');
// And the window **says** it, where the operator is: a measurement nobody can read is not an answer, and the
// sentence has to name which of the cases it is — "it did not grow" alone has three different cures.
assert.equal(refusedFit.fitLine.hidden, false, 'the window says out loud that it did not grow');
assert.match(refusedFit.fitLine.text, /asked for 460 pt of height and did not grow: it is already maximised/,
  `naming the case (got ${JSON.stringify(refusedFit.fitLine.text)})`);
assert.match(refusedFit.fitLine.text, /This display offers 875 pt of height/,
  `and the ceiling it hit (got ${JSON.stringify(refusedFit.fitLine.text)})`);
await evaluate(`document.getElementById('cue-panel-toggle').click()`);
await waitFor('Boolean(document.getElementById("cue-panel")) && document.getElementById("cue-panel").hidden === true', 'the panel to fold away');
assert.equal(await evaluate(`document.getElementById('cue-fit').hidden`), true,
  'and folding the panel takes the sentence with it: nothing needs the height any more');

// --- 5. The list is ordered by SMPTE, and the order is only a view ---------------------------------
// The owner's complaint, and the defect this suite exists to hold down: the list was painted in the order the file
// happened to hold. SMPTE is the default, the choice writes **nothing** (sorting is not a change to what fires, and
// writing the file would re-arm the engine), and two cues in the same frame keep the list's own order, which is the
// order the engine fires them in.
const unsortedCues = [
  CUE_FIELDS('cue-3', 1, 0, 30, 0, { note: 'third' }),
  CUE_FIELDS('cue-1', 1, 0, 10, 0, { note: 'first' }),
  CUE_FIELDS('cue-2', 1, 0, 20, 0, { note: 'second' }),
  CUE_FIELDS('cue-4', 1, 0, 20, 0, { note: 'tied with second' }),
];
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: tauriStub({
    state: { state: 'running', position: '01:00:00:00', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: unsortedCues.length },
    cues: unsortedCues,
  }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length === 4', 'the list to render');
const sortUi = await evaluate(`(() => {
  const select = document.getElementById('cue-sort');
  return {
    value: select.value,
    options: Array.from(select.options).map((option) => option.value),
    selectedLabel: select.options[select.selectedIndex].textContent.trim(),
    times: Array.from(document.querySelectorAll('#cue-list .cue-at')).map((node) => node.textContent.trim()),
    names: Array.from(document.querySelectorAll('#cue-list .cue-name')).map((node) => node.textContent.trim()),
    arrows: document.querySelectorAll('#cue-list .cue-buttons button').length,
    invokes: window.__INVOKES.map((entry) => entry.cmd),
  };
})()`);
assert.equal(sortUi.value, 'smpte', `the list opens on SMPTE, not on whatever order the file held (got ${JSON.stringify(sortUi.value)})`);
assert.deepEqual(sortUi.options, ['smpte', 'manual', 'created'], 'the selector offers the three orders the design names');
assert.match(sortUi.selectedLabel, /SMPTE/, `and the choice says SMPTE (got ${JSON.stringify(sortUi.selectedLabel)})`);
assert.deepEqual(sortUi.times, ['01:00:10:00', '01:00:20:00', '01:00:20:00', '01:00:30:00'],
  `the rows are in SMPTE order, with the tie in the list's own order (got ${JSON.stringify(sortUi.times)})`);
assert.deepEqual(sortUi.names, ['first', 'second', 'tied with second', 'third'],
  `and each row carries its own cue (got ${JSON.stringify(sortUi.names)})`);

// Choosing an order **writes it into the cue list**: the order is part of the show, so it travels with the file
// rather than living in one Mac's `localStorage`. Writing the file re-arms the engine, and the payload has to carry
// `sort` — the backend's field has a default, so a payload that forgot it would not fail, it would quietly replace
// the operator's choice with `smpte`.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => { const select = document.getElementById('cue-sort'); select.value = 'manual'; select.dispatchEvent(new Event('change')); })()`);
const manual = await evaluate(`(() => ({
  times: Array.from(document.querySelectorAll('#cue-list .cue-at')).map((node) => node.textContent.trim()),
  ups: document.querySelectorAll('#cue-list .cue-up').length,
  downs: document.querySelectorAll('#cue-list .cue-down').length,
}))()`);
assert.deepEqual(manual.times, ['01:00:30:00', '01:00:10:00', '01:00:20:00', '01:00:20:00'],
  `manual order is the list's own order (got ${JSON.stringify(manual.times)})`);
const sortSave = await evaluate(`(() => {
  const calls = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues');
  return { count: calls.length, sort: calls[0]?.args?.cues?.sort ?? null,
    cues: calls[0]?.args?.cues?.cues?.length ?? 0 };
})()`);
assert.equal(sortSave.count, 1, `choosing an order saves the list exactly once (got ${sortSave.count})`);
assert.equal(sortSave.sort, 'manual', `and the payload carries the order, or the file would be reset to SMPTE (got ${JSON.stringify(sortSave.sort)})`);
assert.equal(sortSave.cues, 4, `along with the list itself, not a list that lost its cues (got ${sortSave.cues})`);
assert.equal(manual.ups, 4, `manual offers an up arrow on every row (got ${manual.ups})`);
assert.equal(manual.downs, 4, `and a down arrow on every row (got ${manual.downs})`);
await evaluate(`(() => { const select = document.getElementById('cue-sort'); select.value = 'smpte'; select.dispatchEvent(new Event('change')); })()`);
const backToSmpte = await evaluate(`(() => ({
  ups: document.querySelectorAll('#cue-list .cue-up').length,
  downs: document.querySelectorAll('#cue-list .cue-down').length,
}))()`);
assert.deepEqual([backToSmpte.ups, backToSmpte.downs], [0, 0],
  `in SMPTE the arrows are not offered at all, rather than shown dead (got ${JSON.stringify(backToSmpte)})`);

// And the file is the source of truth, not this window's memory: a list whose `sort` says `manual` opens manual,
// with the arrows the mode offers, whatever `localStorage` would have said.
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub({ wing_timecode_cue_sort: 'smpte' }) });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: tauriStub({
    state: { state: 'running', position: '01:00:00:00', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: unsortedCues.length },
    cues: unsortedCues,
    sort: 'manual',
  }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length === 4', 'the list to render from a file that chose manual');
const fileOrder = await evaluate(`(() => ({
  value: document.getElementById('cue-sort').value,
  times: Array.from(document.querySelectorAll('#cue-list .cue-at')).map((node) => node.textContent.trim()),
  ups: document.querySelectorAll('#cue-list .cue-up').length,
}))()`);
assert.equal(fileOrder.value, 'manual',
  `the order comes from the cue file, not from this window's own memory (got ${JSON.stringify(fileOrder.value)})`);
assert.deepEqual(fileOrder.times, ['01:00:30:00', '01:00:10:00', '01:00:20:00', '01:00:20:00'],
  `and the rows are in that order (got ${JSON.stringify(fileOrder.times)})`);
assert.equal(fileOrder.ups, 4, 'with the arrows the mode offers');

// --- 6. A row says what it is, and what the engine did with it -------------------------------------
const markedCues = [
  CUE_FIELDS('cue-1', 1, 0, 10, 0, { note: 'Opening' }),
  CUE_FIELDS('cue-2', 1, 0, 20, 0, { note: 'Parked', enabled: false }),
  CUE_FIELDS('cue-3', 1, 0, 30, 0, { note: 'Clash A' }),
  CUE_FIELDS('cue-4', 1, 0, 30, 0, { note: 'Clash B' }),
];
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: tauriStub({
    state: { state: 'running', position: '01:00:05:00', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: markedCues.length },
    cues: markedCues,
  }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length === 4', 'the list to render');
const rowFacts = await evaluate(`(() => {
  const row = (id) => document.querySelector('.cue-row[data-cue-id="' + id + '"]');
  const tags = (id) => Array.from(row(id).querySelectorAll('.cue-tag')).map((tag) => tag.textContent.trim());
  return {
    names: Array.from(document.querySelectorAll('#cue-list .cue-name')).map((node) => node.textContent.trim()),
    tags1: tags('cue-1'), tags2: tags('cue-2'), tags3: tags('cue-3'), tags4: tags('cue-4'),
    freeOnThree: Boolean(row('cue-3').querySelector('.cue-free')),
    freeOnFour: Boolean(row('cue-4').querySelector('.cue-free')),
    status: document.getElementById('cue-status').textContent.trim(),
  };
})()`);
assert.deepEqual(rowFacts.names, ['Opening', 'Parked', 'Clash A', 'Clash B'],
  `every row shows its own name, which is the note the list carries (got ${JSON.stringify(rowFacts.names)})`);
assert.deepEqual(rowFacts.tags2, ['off'], `a cue that is not active says so on its row (got ${JSON.stringify(rowFacts.tags2)})`);
assert.deepEqual(rowFacts.tags3, ['clash'], `two cues in one frame are both kept and both marked (got ${JSON.stringify(rowFacts.tags3)})`);
assert.deepEqual(rowFacts.tags4, ['clash'], `on both rows, not only the later one (got ${JSON.stringify(rowFacts.tags4)})`);
assert.equal(rowFacts.freeOnThree && rowFacts.freeOnFour, true,
  'and moving one is offered as a control, never done on its own');
assert.match(rowFacts.status, /hold more than one cue/,
  `the list says the clash out loud (got ${JSON.stringify(rowFacts.status)})`);
assert.match(rowFacts.status, /01:00:30:00/, `naming the position they share (got ${JSON.stringify(rowFacts.status)})`);

// The engine's announcements: a cue that fired and a cue that was skipped are painted differently, because
// conflating the two is how a rehearsal is lost. The engine marks a cue spent **before** it announces it, so the
// snapshot that follows already lists the cue: the mock says the same, or the window's own honest rule — a mark for a
// cue the engine no longer lists as spent is a lie — would wipe it on the next poll and this would measure the mock.
await evaluate(`window.__STATE_OVERRIDE = { state: 'running', position: '01:00:15:00', rate: '25', drop_frame: false,
  pieces: 9, positions: 2, source: 'MTC', cues: 4, next_cue_id: null, spent_ids: ['cue-1', 'cue-3'], armed_at: '01:00:05:00' }`);
await evaluate(`window.__HANDLERS['timecode-cue']({ payload: { seq: 1, event: { kind: 'fired', id: 'cue-1', at: '01:00:10:00', macro_index: 0 } } })`);
await evaluate(`window.__HANDLERS['timecode-cue']({ payload: { seq: 2, event: { kind: 'skipped', id: 'cue-3', at: '01:00:30:00', jumped_ms: 30000, arrival_gap_ms: 40, across_silence: false } } })`);
await sleep(400); // long enough for a poll: the mark has to survive the snapshot it is painted from
const marks = await evaluate(`(() => {
  const row = (id) => document.querySelector('.cue-row[data-cue-id="' + id + '"]');
  return {
    one: Array.from(row('cue-1').querySelectorAll('.cue-tag')).map((t) => t.textContent.trim()),
    three: Array.from(row('cue-3').querySelectorAll('.cue-tag')).map((t) => t.textContent.trim()),
    oneFired: row('cue-1').classList.contains('is-fired'),
    oneSkipped: row('cue-1').classList.contains('is-skipped'),
    threeFired: row('cue-3').classList.contains('is-fired'),
    threeSkipped: row('cue-3').classList.contains('is-skipped'),
    threeStruck: getComputedStyle(row('cue-3').querySelector('.cue-at')).textDecorationLine,
  };
})()`);
assert.deepEqual(marks.one, ['fired'], `a cue the engine fired is marked as fired (got ${JSON.stringify(marks.one)})`);
assert.deepEqual(marks.three, ['clash', 'skipped'],
  `a cue the engine skipped is marked as skipped, not as fired (got ${JSON.stringify(marks.three)})`);
assert.equal(marks.oneFired && !marks.oneSkipped && marks.threeSkipped && !marks.threeFired, true,
  `and the two states are not each other's class (${JSON.stringify(marks)})`);
assert.match(marks.threeStruck, /line-through/, 'a skipped cue is struck through, which is what "skipped" looks like');

// A rewind re-arms the cues the engine's own rule re-arms — those later than where the show went back to — and the
// marks follow, so the picture cannot claim a cue is spent when the engine has armed it again. The engine's spent set
// no longer holds them, so the snapshot says that too: it is the snapshot, not the event alone, that keeps the rows
// honest across the polls.
await evaluate(`window.__STATE_OVERRIDE = { state: 'running', position: '01:00:05:00', rate: '25', drop_frame: false,
  pieces: 10, positions: 3, source: 'MTC', cues: 4, next_cue_id: 'cue-1', spent_ids: [], armed_at: '01:00:05:00' }`);
await evaluate(`window.__HANDLERS['timecode-cue']({ payload: { seq: 3, event: { kind: 'rearmed', count: 2, position: '01:00:05:00' } } })`);
await sleep(400);
const rearmed = await evaluate(`(() => {
  const row = (id) => document.querySelector('.cue-row[data-cue-id="' + id + '"]');
  return {
    one: Array.from(row('cue-1').querySelectorAll('.cue-tag')).map((t) => t.textContent.trim()),
    three: Array.from(row('cue-3').querySelectorAll('.cue-tag')).map((t) => t.textContent.trim()),
  };
})()`);
assert.deepEqual(rearmed.one, ['next'],
  `a rewind clears the fired mark of a cue that is armed again, and it is the engine's next cue once more (got ${JSON.stringify(rearmed.one)})`);
assert.deepEqual(rearmed.three, ['clash'], `and the skipped mark with it (got ${JSON.stringify(rearmed.three)})`);

// --- 6b. A clock opened late can still say what already happened ------------------------------------
//
// The event stream only carries what happens while this window is listening, and the orders that fired before it
// opened have already been answered for by the window that ran their macros. The snapshot closes that hole: it names
// the next cue, the cues the engine has spent, and where the list was last armed. `spent_ids` does not say *how* a cue
// was spent — the engine's `spent` set receives a cue that fired and one a seek jumped over — so it is painted
// neutrally, and the announcement is what names the kind.
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: tauriStub({
    state: { state: 'running', position: '01:00:20:00', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC',
      cues: markedCues.length, next_cue_id: 'cue-2', spent_ids: ['cue-1', 'cue-3'], armed_at: '01:00:05:00' },
    cues: markedCues,
  }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length === 4', 'the late clock to paint the list');
await sleep(400);
const lateTags = await evaluate(`(() => {
  const row = (id) => document.querySelector('.cue-row[data-cue-id="' + id + '"]');
  const tags = (id) => Array.from(row(id).querySelectorAll('.cue-tag')).map((tag) => tag.textContent.trim());
  const armed = document.getElementById('cue-armed');
  return {
    one: tags('cue-1'), two: tags('cue-2'), three: tags('cue-3'),
    oneFired: row('cue-1').classList.contains('is-fired'),
    armed: armed.textContent.trim(), armedHidden: armed.hidden,
  };
})()`);
assert.deepEqual(lateTags.one, ['spent'],
  `a cue the engine has already spent is marked, without this window having heard it fire (got ${JSON.stringify(lateTags.one)})`);
assert.equal(lateTags.oneFired, false, 'and it is not painted as fired: `spent` does not say which of the two it was');
assert.deepEqual(lateTags.two, ['off', 'next'],
  `the engine's next cue is named on its row (got ${JSON.stringify(lateTags.two)})`);
assert.deepEqual(lateTags.three, ['clash', 'spent'],
  `and a spent cue that shares its frame keeps both facts (got ${JSON.stringify(lateTags.three)})`);
assert.equal(lateTags.armedHidden, false, 'the position the list was last armed from is on screen');
assert.equal(lateTags.armed, 'Re-armed at 01:00:05:00.', `with its position (got ${JSON.stringify(lateTags.armed)})`);

// An announcement names the kind, and the neutral mark becomes the true one.
await evaluate(`window.__HANDLERS['timecode-cue']({ payload: { seq: 9, event: { kind: 'fired', id: 'cue-1', at: '01:00:10:00', macro_index: 0 } } })`);
await sleep(150);
const named = await evaluate(`Array.from(document.querySelector('.cue-row[data-cue-id="cue-1"]').querySelectorAll('.cue-tag')).map((tag) => tag.textContent.trim())`);
assert.deepEqual(named, ['fired'], `an announcement replaces the neutral mark with the kind (got ${JSON.stringify(named)})`);

// And when the engine arms the list again — a rewind, or a save — the snapshot stops listing the cue as spent, and a
// mark that stayed would be the lie this window exists not to tell.
await evaluate(`window.__STATE_OVERRIDE = { state: 'running', position: '01:00:05:00', rate: '25', drop_frame: false, pieces: 9, positions: 2, source: 'MTC',
  cues: 4, next_cue_id: null, spent_ids: [], armed_at: '01:00:05:00' }`);
await sleep(600);
const reArmedLater = await evaluate(`(() => {
  const row = (id) => document.querySelector('.cue-row[data-cue-id="' + id + '"]');
  return {
    one: Array.from(row('cue-1').querySelectorAll('.cue-tag')).map((tag) => tag.textContent.trim()),
    two: Array.from(row('cue-2').querySelectorAll('.cue-tag')).map((tag) => tag.textContent.trim()),
  };
})()`);
assert.deepEqual(reArmedLater.one, [],
  `a cue the engine has armed again stops being marked as spent (got ${JSON.stringify(reArmedLater.one)})`);
assert.deepEqual(reArmedLater.two, ['off'],
  `and a cue that is no longer next says only what it is (got ${JSON.stringify(reArmedLater.two)})`);

// --- 7. Editing is local; saving is explicit -------------------------------------------------------
// `set_timecode_cues` hands the list to the engine, and `configure_cues` resets it: **every save re-arms every cue**.
// So the four fields and the nudge edit what is on screen and call nothing, the button that saves says it re-arms,
// and the unsaved change is visible until it is saved. A nudge that saved would mean holding `→` for a second
// emptied the spent marks of a running show — that is the defect this section exists to catch.
const editableCues = [CUE_FIELDS('cue-1', 1, 0, 10, 0, { note: 'Editable' })];
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: tauriStub({
    state: { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: 1 },
    cues: editableCues,
  }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length === 1', 'the list to render');
const saveLabel = await evaluate(`(() => {
  const save = document.getElementById('cue-save');
  return { text: save.textContent.trim(), title: save.title };
})()`);
assert.match(saveLabel.text, /re-arm/i, `the save button must say that saving re-arms the cues (got ${JSON.stringify(saveLabel.text)})`);
assert.match(saveLabel.title, /re-arms every cue/, `and explain what that means (got ${JSON.stringify(saveLabel.title)})`);
await evaluate(`window.__INVOKES.length = 0`);

await evaluate(`document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-buttons button').click()`);
const editor = await evaluate(`(() => {
  const row = document.querySelector('.cue-row[data-cue-id="cue-1"]');
  const inputs = row.querySelectorAll('.cue-editor input');
  const buttons = Array.from(row.querySelectorAll('.cue-editor button')).map((button) => button.textContent.trim());
  return {
    fields: inputs.length,
    values: Array.from(inputs).map((input) => input.value),
    labels: Array.from(inputs).map((input) => input.getAttribute('aria-label')),
    buttons,
  };
})()`);
assert.equal(editor.fields, 4, 'the editor offers four fields: hours, minutes, seconds and frames');
assert.deepEqual(editor.values.map(Number), [1, 0, 10, 0], `showing the cue's own position (got ${JSON.stringify(editor.values)})`);
assert.deepEqual(editor.buttons, ['−10f', '−1f', '+1f', '+10f', 'Now'],
  `with the nudge the ergonomics call for (got ${JSON.stringify(editor.buttons)})`);

// One press. The row must follow it, and **no command may have been called**.
await evaluate(`Array.from(document.querySelectorAll('.cue-row[data-cue-id="cue-1"] .cue-editor button')).find((b) => b.textContent.trim() === '+1f').click()`);
await sleep(80);
const nudged = await evaluate(`(() => ({
  at: document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-at').textContent.trim(),
  notice: document.getElementById('cue-status').textContent.trim(),
  dirty: document.getElementById('cue-status').classList.contains('is-dirty'),
}))()`);
assert.equal(nudged.at, '01:00:10:01', `a nudge of +1 frame moves the cue (got ${JSON.stringify(nudged.at)})`);
assert.deepEqual(await cueCommands(), [],
  'and it must reach no command at all: saving re-arms the engine, and a held arrow would be a storm of re-arms');
assert.match(nudged.notice, /Unsaved changes/,
  `with the unsaved change visible, not silent (got ${JSON.stringify(nudged.notice)})`);
assert.match(nudged.notice, /re-arms/, `and saying what saving will do (got ${JSON.stringify(nudged.notice)})`);
assert.equal(nudged.dirty, true, 'marked, not only mentioned in passing');

// The keyboard is the same nudge, and it is local for the same reason.
await evaluate(`(() => {
  const row = document.querySelector('.cue-row[data-cue-id="cue-1"]');
  row.focus();
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
})()`);
await sleep(80);
const keyed = await evaluate(`(() => ({
  at: document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-at').textContent.trim(),
  // A headless tab that was never brought to the front has no focused element at all, so what is asserted is that the
  // nudge left the focus on this row and not somewhere else: "no focus to keep" is not "the focus was lost".
  focusHeld: !document.activeElement || document.activeElement === document.body
    || document.activeElement.dataset?.cueId === 'cue-1',
  focusedElsewhere: document.activeElement?.dataset?.cueId || '',
}))()`);
assert.equal(keyed.at, '01:00:10:11', `Shift+→ moves ten frames (got ${JSON.stringify(keyed.at)})`);
assert.equal(keyed.focusHeld, true,
  `and the nudge does not hand the focus to something else, so the next press lands on the same row (focus went to ${JSON.stringify(keyed.focusedElsewhere)})`);
assert.deepEqual(await cueCommands(), [], 'the keyboard nudge is local as well');

// Add here is a save — it takes the position the backend is reading — and the unsaved edit is written first so that
// what the backend adds to is what is on screen.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.getElementById('cue-add-here').click()`);
await waitFor('window.__INVOKES.some((entry) => entry.cmd === "add_timecode_cue_from_position")', 'Add here to reach the backend');
const addedTo = await cueCommands();
assert.deepEqual(addedTo, ['set_timecode_cues', 'add_timecode_cue_from_position'],
  `an unsaved edit is saved before a cue is added, so the addition lands on the list on screen (got ${JSON.stringify(addedTo)})`);

// The save itself: one call, carrying the position that was nudged, and no edit left unsaved. The editor is still
// open across the addition, so the nudge goes straight back to the same cue.
await evaluate(`Array.from(document.querySelectorAll('.cue-row[data-cue-id="cue-1"] .cue-editor button')).find((b) => b.textContent.trim() === '−1f').click()`);
await sleep(60);
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.getElementById('cue-save').click()`);
await waitFor('window.__INVOKES.some((entry) => entry.cmd === "set_timecode_cues")', 'Save to reach the backend');
await sleep(150);
const saved = await evaluate(`(() => {
  const calls = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues');
  return {
    calls: calls.length,
    at: calls[0]?.args?.cues?.cues?.[0]?.at || null,
    schema: calls[0]?.args?.cues?.schema_version,
    drive: calls[0]?.args?.cues?.drive ?? null,
    sort: calls[0]?.args?.cues?.sort ?? null,
    notice: document.getElementById('cue-status').textContent.trim(),
    dirty: document.getElementById('cue-status').classList.contains('is-dirty'),
  };
})()`);
assert.equal(saved.calls, 1, `Save writes the list once, not on every keystroke (got ${saved.calls})`);
assert.deepEqual([saved.at.hours, saved.at.minutes, saved.at.seconds, saved.at.frames], [1, 0, 10, 10],
  `and it carries the position that was edited on screen (got ${JSON.stringify(saved.at)})`);
assert.equal(saved.schema, 1, 'the file keeps its schema version');
// Both of these have a default on the backend, so a payload that forgot one would not fail — it would quietly change
// how the show runs. This window owns neither control: it must hand back exactly what the file gave it. The drive
// mode is the dangerous one, because installing a list also re-arms the engine.
assert.equal(saved.drive, 'sequential',
  `Save must hand back the drive mode the file carried, not reset a sequential show to the backend's default (got ${JSON.stringify(saved.drive)})`);
assert.equal(saved.sort, 'smpte',
  `and it must hand back the order, which has a default on the backend too (got ${JSON.stringify(saved.sort)})`);
assert.equal(saved.dirty, false, 'the unsaved notice goes away once the engine has the list');

// A position that cannot exist is refused by the backend, and **the operator does not lose what they typed**.
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: tauriStub({
    state: { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: 1 },
    cues: editableCues,
    fault: { command: 'set_timecode_cues', message: 'frame 25 does not exist at 25 fps (0 to 24)' },
  }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length === 1', 'the list to render again');
await evaluate(`document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-buttons button').click()`);
await sleep(60);
await evaluate(`(() => {
  const input = document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-editor input:last-of-type');
  input.value = '25';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await evaluate(`document.getElementById('cue-save').click()`);
await sleep(250);
const refused = await evaluate(`(() => ({
  notice: document.getElementById('cue-status').textContent.trim(),
  frames: document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-editor input:last-of-type')?.value || '',
  dirty: document.getElementById('cue-status').classList.contains('is-dirty'),
}))()`);
assert.match(refused.notice, /frame 25 does not exist at 25 fps/,
  `a refusal must be read with the backend's own words (got ${JSON.stringify(refused.notice)})`);
assert.equal(refused.dirty, true, 'and the change is still there to correct, not thrown away');

// --- 8. A clock with no desktop frame is still a clock ----------------------------------------------
// The panel asks the window to grow; a build (or a browser tab) whose frame cannot answer must leave a list that
// still scrolls rather than a control that does nothing and says nothing.
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__TAURI__ = { core: { invoke: async (cmd) => (cmd === 'timecode_state'
    ? { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: 14 }
    : (cmd === 'get_timecode_cues' ? { schema_version: 1, cues: ${JSON.stringify(manyCues)}, offset_frames: 0 } : {})) } };`,
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length === 14', 'the list to render without a frame');
await evaluate(`document.getElementById('cue-panel-toggle').click()`);
await sleep(150);
const frameless = await evaluate(`(() => {
  const panel = document.getElementById('cue-panel');
  return {
    hidden: panel.hidden,
    expanded: document.getElementById('cue-panel-toggle').getAttribute('aria-expanded'),
    scrolls: panel.scrollHeight > panel.clientHeight,
    rows: panel.querySelectorAll('.cue-row').length,
    inside: ['position', 'state', 'cue', 'counters', 'delivery'].every((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return r.bottom <= window.innerHeight + 1;
    }),
  };
})()`);
assert.equal(frameless.hidden, false, 'the panel opens even when the frame cannot resize the window');
assert.equal(frameless.expanded, 'true', 'and says so');
assert.equal(frameless.rows, 14, 'with the whole list in it');
assert.equal(frameless.scrolls, true, 'scrollable inside the height the window already has');
assert.equal(frameless.inside, true, 'and the clock itself is not pushed out of the window');

// --- 9. A stale position keeps being shown, with the warning class ---------------------------------
// The operator needs to know where the show *was*, and whether to trust it. The position is written the way the
// backend writes a drop-frame one — a semicolon before the frames — because the clock paints the position it parsed
// together with the snapshot's drop-frame flag rather than echoing the string: a mock that said `drop_frame: true` and
// then wrote a colon would be testing a mix the backend never sends.
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__TAURI__ = { core: { invoke: async (cmd) => (cmd === 'timecode_state'
    ? { state: 'stale', position: '01:00:12;15', rate: '25', drop_frame: true, pieces: 8, positions: 1, source: 'MTC', age_ms: 2400, freewheel_ms: 750, freewheel_remaining_ms: 0 }
    : {}) }, event: { listen: async () => () => {} } };`,
});
await call('Page.navigate', { url });
await waitFor('Boolean(document.getElementById("state")) && document.getElementById("state").className === "is-stale"', 'the stale clock to paint');
const stale = await evaluate(`(() => ({
  position: document.getElementById('position').textContent.trim(),
  state: document.getElementById('state').textContent.trim(),
  className: document.getElementById('state').className,
  delivery: document.getElementById('delivery').textContent.trim(),
  deliveryHidden: document.getElementById('delivery').hidden,
}))()`);
assert.equal(stale.className, 'is-stale', `a stopped position must be marked (got ${JSON.stringify(stale)})`);
assert.equal(stale.position, '01:00:12;15',
  `and still shown, with the drop-frame notation it arrived in (got ${JSON.stringify(stale.position)})`);
assert.match(stale.state, /Stopped: no position for/, `the sentence says it stopped (got ${JSON.stringify(stale.state)})`);
assert.ok(stale.state.includes("2.4"), `and how long it has been (got ${JSON.stringify(stale.state)})`);
// The window it was judged against is **named**, not assumed: the backend reports the tolerance, and an operator has to
// be able to tell a signal that hiccupped from a show that stopped. The same sentence is shared with the settings page.
assert.match(stale.state, /past the 0\.75 s window/,
  `the freewheel window is named in the sentence (got ${JSON.stringify(stale.state)})`);
// Timecode that arrived and then stopped is not the `nothing` state, and the counter that answers "was anything
// lost?" belongs on screen for as long as the show is being watched — with zeros if nothing was lost.
assert.equal(stale.deliveryHidden, false, 'a stopped-but-arrived clock keeps the delivery counter on screen');
assert.match(stale.delivery, /Cues fired 0/, `with zeros (got ${JSON.stringify(stale.delivery)})`);

// --- 10. The shared row, and what the list gained on top of it --------------------------------------
//
// The row, the order comparator and the marks live in `desktop/ui/cue-list.js`, which this window loads with
// `<script src>` and Settings loads too. This section pins the things the panel gained on top of the row the suite
// already holds: the search box, undo of a local change, a duplicated cue, the lock that stops an accidental edit,
// the "what just happened" line and the 10 s / 5 s countdown notices.
const sharedCues = [
  CUE_FIELDS('cue-1', 1, 0, 10, 0, { note: 'Opening' }),
  CUE_FIELDS('cue-2', 1, 0, 20, 0, { note: 'Door', enabled: false }),
  CUE_FIELDS('cue-3', 1, 0, 30, 0, { note: 'Curtain' }),
  CUE_FIELDS('cue-4', 1, 0, 40, 0, { note: 'Rain' }),
];
await call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: tauriStub({
    state: { state: 'running', position: '01:00:05:00', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: 4 },
    cues: sharedCues,
  }),
});
await call('Page.navigate', { url });
await waitFor('document.querySelectorAll("#cue-list .cue-row").length === 4', 'the shared list to render');

const sharedRow = await evaluate(`(() => {
  const list = window.WingCueList;
  return {
    loaded: Boolean(list),
    api: Boolean(list) && typeof list.orderedCues === 'function' && typeof list.createPanel === 'function'
      && typeof list.positionText === 'function' && typeof list.clashMap === 'function',
    times: Array.from(document.querySelectorAll('#cue-list .cue-at')).map((node) => node.textContent.trim()),
  };
})()`);
assert.equal(sharedRow.loaded, true,
  'the clock must load the shared cue-list.js: the row lives there, not in a copy inside this window');
assert.equal(sharedRow.api, true, 'and the panel must be built from its API');
// The order is the shared comparator's answer. It is also the mutation the design asks for: break the sort in
// `cue-list.js` and this line and Settings' own `cueListUi.times` fail together — one file, both suites.
assert.deepEqual(sharedRow.times, ['01:00:10:00', '01:00:20:00', '01:00:30:00', '01:00:40:00'],
  `the rows are in SMPTE order, which is the shared comparator's job (got ${JSON.stringify(sharedRow.times)})`);

// --- 10a. The search box: one cue among a show's worth of them -------------------------------------
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => { const box = document.getElementById('cue-filter'); box.value = 'door'; box.dispatchEvent(new Event('input')); })()`);
const filtered = await evaluate(`(() => ({
  times: Array.from(document.querySelectorAll('#cue-list .cue-at')).map((node) => node.textContent.trim()),
  count: document.getElementById('cue-filter-count').textContent.trim(),
  hidden: document.getElementById('cue-filter-count').hidden,
  status: document.getElementById('cue-status').textContent.trim(),
}))()`);
assert.deepEqual(filtered.times, ['01:00:20:00'],
  `the search box shows only the cues that match what is typed (got ${JSON.stringify(filtered.times)})`);
assert.equal(filtered.count, '1 of 4 shown', `and says how much of the list is on screen (got ${JSON.stringify(filtered.count)})`);
assert.equal(filtered.hidden, false, 'the count is on screen while a filter is in force');
assert.match(filtered.status, /Showing 1 of 4/, `and the status line says it too (got ${JSON.stringify(filtered.status)})`);
assert.deepEqual(await cueCommands(), [], 'filtering is a view: it must reach no command at all');

// A state word finds the cues in that state — the design's example was "las deshabilitadas".
await evaluate(`(() => { const box = document.getElementById('cue-filter'); box.value = 'off'; box.dispatchEvent(new Event('input')); })()`);
const filteredOff = await evaluate(`Array.from(document.querySelectorAll('#cue-list .cue-at')).map((node) => node.textContent.trim())`);
assert.deepEqual(filteredOff, ['01:00:20:00'],
  `a state word — “off” — finds a parked cue (got ${JSON.stringify(filteredOff)})`);
await evaluate(`(() => { const box = document.getElementById('cue-filter'); box.value = ''; box.dispatchEvent(new Event('input')); })()`);
assert.equal(await evaluate(`document.querySelectorAll('#cue-list .cue-row').length`), 4, 'and emptying it shows the whole list again');
assert.equal(await evaluate(`document.getElementById('cue-filter-count').hidden`), true, 'with the count out of the way');

// --- 10b. Undo takes back the last local change, and stops there -----------------------------------
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-buttons button').click()`);
await sleep(60);
assert.equal(await evaluate(`document.getElementById('cue-undo').hidden`), true,
  'undo is not offered before there is anything to take back');
await evaluate(`Array.from(document.querySelectorAll('.cue-row[data-cue-id="cue-1"] .cue-editor button')).find((button) => button.textContent.trim() === '+1f').click()`);
await sleep(60);
const beforeUndo = await evaluate(`(() => ({
  at: document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-at').textContent.trim(),
  undoVisible: !document.getElementById('cue-undo').hidden,
}))()`);
assert.equal(beforeUndo.at, '01:00:10:01', `the nudge moved the cue (got ${JSON.stringify(beforeUndo.at)})`);
assert.equal(beforeUndo.undoVisible, true, 'and undo is offered the moment there is a change to take back');
await evaluate(`document.getElementById('cue-undo').click()`);
await sleep(60);
const afterUndo = await evaluate(`(() => ({
  at: document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-at').textContent.trim(),
  undoHidden: document.getElementById('cue-undo').hidden,
}))()`);
assert.equal(afterUndo.at, '01:00:10:00', `undo puts the list back the way it was (got ${JSON.stringify(afterUndo.at)})`);
assert.equal(afterUndo.undoHidden, true, 'and goes away when there is nothing left to take back');
assert.deepEqual(await cueCommands(), [], 'undo is local: only Save writes the list');

// --- 10c. Duplicate: a copy with an id of its own, and the clash said out loud ----------------------
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.querySelector('.cue-row[data-cue-id="cue-3"] .cue-duplicate').click()`);
const duplicated = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('#cue-list .cue-row'));
  const copy = rows.find((row) => row.dataset.cueId === 'cue-5');
  return {
    count: rows.length,
    ids: rows.map((row) => row.dataset.cueId),
    copyAt: copy?.querySelector('.cue-at')?.textContent.trim() || '',
    copyTags: Array.from(copy?.querySelectorAll('.cue-tag') || []).map((tag) => tag.textContent.trim()),
    free: document.querySelectorAll('#cue-list .cue-free').length,
  };
})()`);
assert.equal(duplicated.count, 5, 'duplicating a cue adds a row');
assert.equal(new Set(duplicated.ids).size, 5, 'the copy has an id of its own, which is what the engine keys its marks by');
assert.equal(duplicated.copyAt, '01:00:30:00', `and it lands on the frame of the cue it copied (got ${JSON.stringify(duplicated.copyAt)})`);
assert.deepEqual(duplicated.copyTags, ['clash'], `two cues in one frame are both kept and both marked (got ${JSON.stringify(duplicated.copyTags)})`);
assert.ok(duplicated.free >= 2, 'and moving one is offered as a control, never done on its own');
assert.deepEqual(await cueCommands(), [], 'duplicating is local: nothing is written until Save (re-arms)');

// --- 10d. Lock: a row that cannot be edited by accident --------------------------------------------
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.querySelector('.cue-row[data-cue-id="cue-2"] .cue-lock').click()`);
const locked = await evaluate(`(() => {
  const row = document.querySelector('.cue-row[data-cue-id="cue-2"]');
  return {
    tags: Array.from(row.querySelectorAll('.cue-tag')).map((tag) => tag.textContent.trim()),
    buttons: Array.from(row.querySelectorAll('.cue-buttons button')).map((button) => button.textContent.trim()),
    editor: row.querySelectorAll('.cue-editor').length,
    stored: JSON.parse(localStorage.getItem('wing_timecode_cue_locks') || '[]'),
  };
})()`);
assert.deepEqual(locked.tags, ['off', 'locked'], `a locked cue says so on its row (got ${JSON.stringify(locked.tags)})`);
assert.deepEqual(locked.buttons, ['Locked'],
  `and keeps only the lock: nothing that would change it is on screen (got ${JSON.stringify(locked.buttons)})`);
assert.equal(locked.editor, 0, 'its time editor is gone with the rest of the editing controls');
assert.deepEqual(locked.stored, ['cue-2'], `the lock is remembered on this Mac (got ${JSON.stringify(locked.stored)})`);
assert.deepEqual(await cueCommands(), [], 'locking reaches no command: the lock is a guard on this window, not show data');
// It survives the snapshot's own repaints: the lock is on the row, and a poll must not bring the controls back.
await sleep(400);
assert.equal(await evaluate(`document.querySelectorAll('.cue-row[data-cue-id="cue-2"] .cue-edit').length`), 0,
  'a locked row is still locked after the snapshot has been painted');
await evaluate(`document.querySelector('.cue-row[data-cue-id="cue-2"] .cue-lock').click()`);
assert.equal(await evaluate(`document.querySelectorAll('.cue-row[data-cue-id="cue-2"] .cue-edit').length`), 1,
  'and unlocking brings its controls back');

// --- 10e. What just happened: the last announcement, with its time ---------------------------------
assert.equal(await evaluate(`document.getElementById('last-cue').hidden`), true,
  'before anything has fired there is nothing to say, and the line is out of the window');
await evaluate(`window.__HANDLERS['timecode-cue']({ payload: { seq: 1, event: { kind: 'fired', id: 'cue-1', at: '01:00:10:00', macro_index: 0 } } })`);
await sleep(120);
const lastFired = await evaluate(`(() => ({
  text: document.getElementById('last-cue').textContent.trim(),
  hidden: document.getElementById('last-cue').hidden,
}))()`);
assert.equal(lastFired.hidden, false, 'a cue that fired is on screen');
assert.match(lastFired.text, /^Last fired 01:00:10:00 “Opening” · \d\d:\d\d:\d\d$/,
  `naming the cue, its position and the wall-clock time it arrived (got ${JSON.stringify(lastFired.text)})`);
await evaluate(`window.__HANDLERS['timecode-cue']({ payload: { seq: 2, event: { kind: 'skipped', id: 'cue-3', at: '01:00:30:00', jumped_ms: 30000, arrival_gap_ms: 40, across_silence: false } } })`);
await sleep(120);
const lastSkipped = await evaluate(`document.getElementById('last-cue').textContent.trim()`);
assert.match(lastSkipped, /^Last skipped 01:00:30:00 “Curtain” · the position jumped 30\.0 s · \d\d:\d\d:\d\d$/,
  `and a skipped cue is never painted as one that fired (got ${JSON.stringify(lastSkipped)})`);

// --- The same cue, crossed while the signal was gone ----------------------------------------
//
// **This is the reliability gap, on screen.** A cue the show was moved past and a cue crossed while the timecode had
// stopped arriving used to produce the identical line, so an operator could not tell a decision from a fault. The
// engine decides which one it was — the threshold lives there, once, and this window only reads the verdict — and what
// this asserts is that the two readings share **no wording at all**, because "the position jumped" and "the timecode
// had stopped arriving" send him to two different places.
const droppedLine = await evaluate(`(async () => {
  window.__HANDLERS['timecode-cue']({ payload: { seq: 9, event: { kind: 'skipped', id: 'cue-3', at: '01:00:30:00',
    jumped_ms: 30000, arrival_gap_ms: 1200, across_silence: true } } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  return document.getElementById('last-cue').textContent.trim();
})()`);
assert.match(droppedLine, /the timecode had stopped arriving for 1\.2 s/,
  `a cue crossed after a silence must say the timecode was gone, not that the position jumped (got ${JSON.stringify(droppedLine)})`);
assert.doesNotMatch(droppedLine, /the position jumped/,
  'and it must carry none of the wording of the other case, so the two can never be mistaken for each other');
// The distance is asserted on the SEEK above, and it is the same 30 s in both: no comparison of positions could have
// told these two apart, which is why the fix had to be a clock rather than arithmetic.

// --- 10f. The countdown notices at ten seconds and at five -----------------------------------------
//
// WATCHOUT publishes the states Pre / Last10 / Last5 / Reached: "in 8 s" and "it is about to fire" are not the same
// sentence, and the second one is what an operator acts on.
const countdownAt = async (frames) => {
  await evaluate(`window.__STATE_OVERRIDE = { state: 'running', position: '01:00:05:00', rate: '25', drop_frame: false,
    pieces: 9, positions: 2, source: 'MTC', cues: 5, next_cue: '01:00:13:00', next_cue_frames: ${frames}, next_cue_seconds: ${(frames / 25).toFixed(2)} }`);
  await sleep(400);
  return evaluate(`(() => {
    const node = document.getElementById('next-warning');
    const rect = node.getBoundingClientRect();
    return {
      text: node.textContent.trim(),
      hidden: node.hidden,
      classes: node.className,
      inside: rect.bottom <= window.innerHeight + 1 && rect.right <= window.innerWidth + 1,
    };
  })()`);
};
const pre = await countdownAt(400); // 16 s — outside the ten-second window, which is what "Pre" means
assert.equal(pre.hidden, true, `sixteen seconds out there is no notice yet (got ${JSON.stringify(pre)})`);
const last10 = await countdownAt(240); // 9.6 s
assert.equal(last10.text, '10 s', `inside ten seconds the notice says so (got ${JSON.stringify(last10.text)})`);
assert.match(last10.classes, /is-last10/, `with its own state (got ${JSON.stringify(last10.classes)})`);
assert.equal(last10.inside, true, 'and it is inside the 420 x 200 window the clock opens as');
const last5 = await countdownAt(100); // 4 s
assert.equal(last5.text, '5 s', `inside five seconds it says that instead (got ${JSON.stringify(last5.text)})`);
assert.match(last5.classes, /is-last5/, `with the tighter state (got ${JSON.stringify(last5.classes)})`);
assert.equal(last5.inside, true, 'and it still fits the window');

// The line that just happened is inside the window too: the clock grew a reading and it must not push the position,
// the state, the next cue or the counters out of it.
const newLines = await evaluate(`(() => {
  const inside = (id) => {
    const node = document.getElementById(id);
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.bottom <= window.innerHeight + 1 && rect.right <= window.innerWidth + 1;
  };
  return {
    last: inside('last-cue'), warn: inside('next-warning'), find: inside('cue-filter'),
    clock: ['position', 'state', 'cue', 'counters', 'delivery'].every(inside),
    height: window.innerHeight,
  };
})()`);
assert.equal(newLines.last && newLines.warn, true,
  `the readings this window gained are inside the window (${JSON.stringify(newLines)})`);
assert.equal(newLines.clock, true, 'and the readings it already had are still there with them');

// And with the panel unfolded in a window that never grew — the 420 x 200 fallback a frame that refuses to resize
// leaves — everything the operator reads is still inside it, and the list scrolls rather than pushing them out.
await evaluate(`document.getElementById('cue-panel-toggle').click()`);
await sleep(200);
const openFit = await evaluate(`(() => {
  const inside = (id) => {
    const node = document.getElementById(id);
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.bottom <= window.innerHeight + 1 && rect.right <= window.innerWidth + 1;
  };
  const panel = document.getElementById('cue-panel');
  return {
    height: window.innerHeight,
    clock: ['position', 'state', 'cue', 'counters', 'delivery', 'last-cue'].every(inside),
    filter: inside('cue-filter'), undo: inside('cue-undo') || document.getElementById('cue-undo').hidden,
    warning: inside('next-warning'),
    rows: panel.querySelectorAll('.cue-row').length,
    scrolls: panel.scrollHeight > panel.clientHeight,
  };
})()`);
assert.equal(openFit.height, 200, 'this is the fallback window, not the grown one');
assert.equal(openFit.clock, true,
  `with the panel open the clock's own readings are still inside 420 x 200 (${JSON.stringify(openFit)})`);
assert.equal(openFit.filter && openFit.warning, true, 'and so are the search box and the countdown notice');
assert.equal(openFit.rows >= 5, true, 'with the whole list in the panel, not a truncated one');
assert.equal(openFit.scrolls, true, 'which scrolls inside the height the window has');
await evaluate(`document.getElementById('cue-panel-toggle').click()`);

// --- The list changing somewhere else ---------------------------------------
// Two editors of one file, and until now no way for either to hear the other: each read the list once at open and
// never again, so they drifted apart in silence. Every write goes through one backend door, which announces the list
// it installed.
//
// The contract covers both answers, because only one of them is obvious. A window with nothing unsaved **takes** the
// published list — that is what makes the two agree. A window with unsaved edits **keeps** them and says so, because
// taking a foreign list over the operator's typing loses work, and saying nothing leaves the two disagreeing quietly.
await evaluate(`document.getElementById('cue-panel-toggle').click()`);
await sleep(120);
// **The state is established, not assumed.** An earlier section may have left unsaved edits, and a contract that
// guessed would fail for the wrong reason — which is worse than not having it. So: save first, which is also the case
// below that matters most.
await evaluate(`document.getElementById('cue-save').click()`);
await sleep(250);
await evaluate(`(() => {
  window.__HAD_LISTENER = typeof window.__HANDLERS['timecode-cues-changed'] === 'function';
})()`);
assert.equal(await evaluate(`window.__HAD_LISTENER`), true,
  'the clock must listen for the list changing in another window, or the two editors drift apart in silence');
const listBefore = await evaluate(`document.querySelectorAll('#cue-list .cue-row').length`);

// 1. **The echo of this window's own save.** The real backend emits the installed list before the command returns, so
//    the window that saved hears it back while its `invoke` is still in flight. That is why the event carries the list
//    instead of a bare fact: the window can tell "that is what I have" by comparing, and stay quiet. A window that
//    warned here would tell the operator that somebody else changed the list, immediately after he pressed Save.
await evaluate(`(async () => {
  const list = await window.__TAURI__.core.invoke('get_timecode_cues');
  window.__HANDLERS['timecode-cues-changed']({ payload: list });
})()`);
await sleep(200);
const echo = await evaluate(`(() => ({
  rows: document.querySelectorAll('#cue-list .cue-row').length,
  status: document.getElementById('cue-status').textContent.trim(),
}))()`);
assert.equal(echo.rows, listBefore, `its own list is not a change (had ${listBefore}, now ${echo.rows})`);
assert.doesNotMatch(echo.status, /another window/,
  `and the echo of its own save must not be reported as somebody else's change (got ${JSON.stringify(echo.status)})`);

// 1b. **The same cues with a different offset is a change.** This window carries the offset, the order and the drive
//     mode without owning any of those controls, and the offset decides what fires. A listener that compared the cue
//     array alone returned early here and the change reached **nobody** — this window, and both others, went on
//     writing their old offset. Measured through the consequence rather than through an internal: press Save and read
//     what the window actually wrote.
await evaluate(`window.__INVOKES.length = 0`);
// Read the expectation from the fixture instead of assuming it: a hard-coded number makes the contract fail for the
// wrong reason the day the fixture's offset stops being zero.
const clockOffsetBase = await evaluate(`(async () => Number((await window.__TAURI__.core.invoke('get_timecode_cues')).offset_frames || 0))()`);
await evaluate(`(async () => {
  const list = await window.__TAURI__.core.invoke('get_timecode_cues');
  window.__HANDLERS['timecode-cues-changed']({ payload: { ...list, offset_frames: Number(list.offset_frames || 0) + 12 } });
})()`);
await sleep(200);
await evaluate(`document.getElementById('cue-save').click()`);
await waitFor('window.__INVOKES.some((entry) => entry.cmd === "set_timecode_cues")', 'Save to reach the backend after an offset-only change');
await sleep(150);
const offsetWritten = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  return call?.args?.cues?.offset_frames ?? null;
})()`);
assert.equal(offsetWritten, clockOffsetBase + 12,
  `a list whose cues are identical but whose offset changed must still be taken: it decides what fires, and comparing the cue array alone made it reach nobody (had ${clockOffsetBase}, wrote ${JSON.stringify(offsetWritten)})`);
console.log('    and an offset-only change is taken, not swallowed by a comparison that looked at the cue array alone');

// 2. Nothing unsaved here and a list that differs, so the published list is taken — which is what makes two editors
//    of one file agree instead of drifting apart quietly.
await evaluate(`(async () => {
  const list = await window.__TAURI__.core.invoke('get_timecode_cues');
  const extra = { id: 'cue-from-elsewhere',
    at: { hours: 1, minutes: 0, seconds: 50, frames: 0, rate: 'fps25', drop_frame: false },
    number: '', label: 'Added elsewhere', group: '', macro_index: 1, repeats: false, enabled: true, note: '' };
  window.__HANDLERS['timecode-cues-changed']({ payload: { ...list, cues: [...list.cues, extra] } });
})()`);
await sleep(200);
const adopted = await evaluate(`(() => ({
  rows: document.querySelectorAll('#cue-list .cue-row').length,
  status: document.getElementById('cue-status').textContent.trim(),
}))()`);
assert.equal(adopted.rows, listBefore + 1,
  `with nothing unsaved the clock must take the list another window published (had ${listBefore}, now ${adopted.rows})`);
assert.doesNotMatch(adopted.status, /another window/,
  `and it must not warn about a change it took (got ${JSON.stringify(adopted.status)})`);

// 3. An unsaved edit here, so the published list is refused and the refusal is said out loud. Removing a row from the
//    draft touches nothing on disk, so the window is dirty with the file unchanged.
await evaluate(`document.querySelector('#cue-list .cue-row button.cue-remove')?.click()`);
await sleep(120);
const dirtyRows = await evaluate(`document.querySelectorAll('#cue-list .cue-row').length`);
assert.equal(dirtyRows, adopted.rows - 1,
  `removing a row must change the draft and nothing else (got ${dirtyRows})`);
await evaluate(`(async () => {
  const list = await window.__TAURI__.core.invoke('get_timecode_cues');
  window.__HANDLERS['timecode-cues-changed']({ payload: { ...list, cues: list.cues.slice(0, 1) } });
})()`);
await sleep(200);
const kept = await evaluate(`(() => ({
  rows: document.querySelectorAll('#cue-list .cue-row').length,
  status: document.getElementById('cue-status').textContent.trim(),
}))()`);
assert.equal(kept.rows, dirtyRows,
  `with unsaved edits the clock must keep them rather than take a list that arrived underneath (got ${kept.rows}, expected ${dirtyRows})`);
assert.match(kept.status, /changed in another window/,
  `and it must SAY so, because "you have unsaved changes" and "somebody else changed the list" are different facts (got ${JSON.stringify(kept.status)})`);
console.log('the clock takes a list changed elsewhere when it has nothing unsaved, and keeps its own edits and says so when it has');

// Nothing the clock did, from the first navigation to the last, may have thrown: this window is on a second screen
// during a show, and a thrown exception is a clock that stopped being one.
assert.deepEqual(pageErrors, [], `the clock must not throw while it is driven:\n${pageErrors.join('\n')}`);

socket.close();
console.log('timecode clock contracts passed');

// The gate demands this line. A suite that cannot run must not reach this.
console.log('WING_BROWSER_SUITE_OK');
