// The LTC input rate's contracts, driven in the page that ships.
//
// The owner reported it in one sentence: "El LTC está a 30fps pero lo lee a 25, y los cues van tarde", and then, after
// changing the selector, "lo he cambiado a 30 pero no cambia nada". Two screenshots showed why: the clock's status
// line read `Running · LTC · 25 fps` while the Settings selector read `30`. The rate is **declared**, never detected,
// and it is baked into the stream that is running — so a change of the selector reached nothing, and nothing
// compared the declared rate with the signal.
//
// The contracts here are the three halves of the fix, and the second one is the acceptance test the owner described:
//
//   1. **The selector is no longer in the file-verification group.** It lives with the live-input controls, the file
//      group has a rate of its own, and each governs one signal.
//   2. **The clock's status line follows a rate change.** With an input open at 25, choosing 30 reaches
//      `set_ltc_input_rate`, the page says what it is doing **before** it waits, and the readout then says 30 fps.
//      (Driven against the IPC stub, which is the closest the harness can come to the real thing: the stub's
//      `timecode_state` answers with the rate the stub's input was opened at, exactly as the backend's snapshot does
//      once the reopened stream decodes. What no browser suite can measure is a real interface decoding real LTC —
//      that is said in the report, not pretended here.)
//   3. **A wrong rate is not silent.** When the stub reports an open input that has decoded nothing for a few
//      seconds, the status line says so and names the rate in use; and a rate change that is refused keeps the
//      backend's sentence naming the step that failed on the line.
//
// Every step drives the real `desktop/ui/index.html` — the packaged application's frontend is that directory byte for
// byte (`frontendDist: "../ui"`, no bundling) — through the same `window.__TAURI__.core.invoke` the application calls.
//
// Needs Chrome with `--remote-debugging-port=9223` (or `WING_CHROME_PORT`). The gate starts one when the port is
// silent; a run with no browser exits 3 and the gate books that as a missing UI contract, not a pass.
//
// Run: node scripts/test-desktop-ltc-rate-browser.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import WebSocket from "ws";

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
const PAGE_URL = new URL("../desktop/ui/index.html", import.meta.url).href;

const pages = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`, { signal: AbortSignal.timeout(2000) })
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);
if (!pages) {
  console.log(`SKIP: no Chrome remote debugging on port ${DEBUG_PORT}`);
  process.exit(3);
}

const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })).json();
assert.ok(target?.webSocketDebuggerUrl, "could not open a Chrome tab for the LTC rate contract");
process.on("exit", () => {
  try {
    execFileSync("curl", ["-s", "-o", "/dev/null", `http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`]);
  } catch (_) {}
});

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });

let nextId = 0;
const pending = new Map();
const pageErrors = [];
socket.on("message", (data) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown") {
    pageErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text);
  }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------------------------
// The harness: a small, **stateful** backend. `open_ltc_input` remembers the rate, `set_ltc_input_rate` applies it
// (after a delay long enough that the page's own sentence can be read while the call is still in flight), and
// `timecode_state` answers with the rate the input was opened at. That last part is the acceptance test: it is what
// the real backend does once the reopened stream decodes, and it is why the clock's line changes when the stream does.
//
// The delay is deliberate, not decoration: "says what it is doing before it waits" is only observable while a call is
// in flight, and a stub that answers instantly makes that claim untestable. `__setStub` fixes one command's answer
// for one case, so the refusal path can be driven too.
const STUB = `
window.__INVOKES = [];
window.__STUB_FAULTS = {};
window.__setStub = (cmd, answer) => {
  if (answer === undefined) delete window.__STUB_FAULTS[cmd];
  else window.__STUB_FAULTS[cmd] = answer;
  return window.__STUB_FAULTS[cmd] ? "set" : "cleared";
};
(() => {
  let ltcOpen = false;
  let ltcRate = "25";
  let ltcDecoded = 0;
  let ltcOpenMs = 0;
  // What the signal's own bit timing says, and whether the backend judged it a disagreement. "null" is "not enough
  // signal measured yet", which is the state a stream is in for its first 2 000 bit periods.
  let ltcMeasured = null;
  let ltcDisagrees = false;
  // The heartbeat: how long the data itself has been quiet, and the backend's verdict about it. "null" is "a position
  // has never arrived", which is a different fault and has its own sentence.
  let ltcDataAge = null;
  let ltcStalled = false;
  const listening = () => (ltcOpen ? "BlackHole 2ch · channel 1" : null);
  window.__ltcStub = {
    // The state a wrong declared rate produces: open, and nothing decoded at all since it opened.
    silentFor: (ms) => { ltcDecoded = 0; ltcOpenMs = ms; ltcDataAge = null; ltcStalled = false; },
    // And the healthy state, so the contract can prove the sentence is not shown for a working signal.
    decoded: (count, ms) => { ltcDecoded = count; ltcOpenMs = ms ?? ltcOpenMs; ltcDataAge = 20; ltcStalled = false; },
    // A measurement, and the verdict the backend's own rule reaches about it (the pure rule in timecode.rs).
    measured: (fps, disagrees = false) => { ltcMeasured = fps; ltcDisagrees = Boolean(disagrees); return "set"; },
    // A stream that **has** decoded and then gone quiet: the silent death that used to read "Listening to …" for ever.
    stalled: (ageMs) => { ltcDataAge = ageMs; ltcStalled = true; return "set"; },
  };
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        window.__INVOKES.push({ cmd, args });
        const fault = window.__STUB_FAULTS[cmd];
        if (fault) return fault(args);
        switch (cmd) {
          case "get_inter_app_settings":
            return { schema_version: 1, enabled: true, active: true, peers: [], triggers: [] };
          case "get_timecode_cues":
            return { schema_version: 1, offset_frames: 0, cues: [] };
          case "set_timecode_cues":
            return args.cues;
          case "load_macro_library":
            return { schemaVersion: 1, selectedIndex: 0, macros: [] };
          case "timecode_state":
            // The rate the input is decoding at — what the real snapshot carries, because the real one is built from
            // the positions the stream decoded.
            return ltcOpen
              ? { state: "running", position: "01:00:12:15", rate: ltcRate, drop_frame: false, source: "LTC",
                  pieces: 8, positions: 1, cues: 0, next_cue: null, next_cue_seconds: null }
              : { state: "nothing", position: null, rate: null, drop_frame: false, source: "LTC",
                  pieces: 0, positions: 0, cues: 0 };
          case "timecode_cues_at_rate":
            // The backend's answer, as the window consumes it: the ids of cues whose time does not exist at that rate.
            // The rule behind the answer is the backend's own (timecode::cues_impossible_at, pinned by cargo test),
            // so this stub answers with the shape and what is measured is the **page's** behaviour around it. No
            // backticks in these comments: the whole stub is one template literal.
            return (window.__RATE_CHECK || []).slice();
          case "list_timecode_inputs":
            return [{ name: "BlackHole 2ch", channels: 2, sample_rate: 48000, is_default: true }];
          case "open_ltc_input":
            ltcOpen = true;
            ltcRate = String(args?.rate ?? "25");
            ltcDecoded = 0;
            ltcOpenMs = 0;
            return "listening to BlackHole 2ch · channel 1 · 48000 Hz";
          case "set_ltc_input_rate": {
            // Slow enough to read the page's own sentence while this is still in flight.
            await new Promise((resolve) => setTimeout(resolve, 500));
            ltcRate = String(args?.rate ?? ltcRate);
            ltcDecoded = 0;
            ltcOpenMs = 0;
            return "The input was reopened at " + ltcRate + " fps: listening to BlackHole 2ch · channel 1 · 48000 Hz";
          }
          case "ltc_input_state":
            return { open: ltcOpen, listening: listening(), inputs: 1, stream_error: null,
              rate: ltcOpen ? ltcRate : null, open_ms: ltcOpen ? ltcOpenMs : 0, decoded: ltcDecoded,
              measured_fps: ltcOpen ? ltcMeasured : null,
              data_age_ms: ltcOpen ? ltcDataAge : null,
              stalled: ltcOpen ? ltcStalled : false,
              rate_disagrees: ltcOpen ? ltcDisagrees : false };
          case "reconnect_ltc_input":
            return "Reconnected: listening to BlackHole 2ch · channel 1 · 48000 Hz";
          case "close_ltc_input":
            ltcOpen = false;
            return null;
          case "verify_timecode_file":
            return { file: "take.wav", sample_rate: 48000, channels: 2, channel: 0, frames: 100, rejected: 0,
              first: "01:00:00:00", last: "01:00:04:00", rate: String(args?.rate ?? "25"), drop_frame: false };
          default:
            return {};
        }
      },
    },
    event: { listen: async () => () => {} },
    window: {
      getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, innerSize: async () => ({ width: 1440, height: 900 }),
        outerPosition: async () => ({ x: 0, y: 0 }), setSize: async () => {}, setPosition: async () => {},
        close: async () => {}, onCloseRequested: async () => () => {} }),
      LogicalSize: class { constructor(w, h) { this.width = w; this.height = h; } },
      LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } },
    },
  };
})();
`;

await call("Runtime.enable");
await call("Page.enable");
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
await call("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
await call("Page.navigate", { url: PAGE_URL });
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && typeof window.__wingTimecode?.renderLtcInput === "function"')) break;
  await settle(100);
}
assert.equal(await evaluate('document.readyState === "complete"'), true, "the window did not finish loading");

// Bring the Timecode page up the way the operator does. The listeners are attached when the tab is chosen, so
// nothing below is wired until this has happened.
await evaluate(`document.getElementById('open-settings-btn').click()`);
await settle(200);
await evaluate(`document.querySelector('.settings-nav-item[data-tab="timecode"]').click()`);
await settle(300);

const line = () => evaluate(`document.getElementById('timecode-input-state').textContent.trim()`);
const clockLine = () => evaluate(`document.getElementById('timecode-state').textContent.trim()`);
/// Wait for a condition rather than sleeping on it: this page answers from a 250 ms poll, so a fixed wait is a race with
/// it — and the race is invisible until the machine is busy. Read from the window suite, which learned the same lesson.
const waitFor = async (expression, what, tries = 40) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await evaluate(expression)) return true;
    await settle(150);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const invoked = (name) => evaluate(`window.__INVOKES.some((entry) => entry.cmd === ${JSON.stringify(name)})`);
const lastArgs = (name) => evaluate(
  `(window.__INVOKES.filter((entry) => entry.cmd === ${JSON.stringify(name)}).pop() || {}).args || null`);

// --- 1. The selector lives with the live input, not with the file ----------------------------------------------
//
// The owner's second screenshot: the rate sat immediately left of `Verify an LTC file…` with "No file verified yet."
// underneath, so it read as the rate of the file while it actually governed the incoming signal. The two groups are
// named in the markup for exactly this contract.
const groups = await evaluate(`(() => {
  const rate = document.getElementById('timecode-ltc-rate');
  const fileRate = document.getElementById('timecode-file-rate');
  const inputGroup = document.getElementById('timecode-ltc-input-group');
  const fileGroup = document.getElementById('timecode-ltc-file-group');
  return {
    hasRate: Boolean(rate), hasFileRate: Boolean(fileRate),
    hasInputGroup: Boolean(inputGroup), hasFileGroup: Boolean(fileGroup),
    rateInInputGroup: Boolean(rate && inputGroup && inputGroup.contains(rate)),
    rateInFileGroup: Boolean(rate && fileGroup && fileGroup.contains(rate)),
    verifyInFileGroup: Boolean(fileGroup && fileGroup.contains(document.getElementById('timecode-ltc-verify'))),
    fileRateInFileGroup: Boolean(fileRate && fileGroup && fileGroup.contains(fileRate)),
    sameElement: rate === fileRate,
    rateTitle: rate ? rate.title : '',
    fileRateTitle: fileRate ? fileRate.title : '',
  };
})()`);
assert.equal(groups.hasRate, true, "the live input must have a rate selector");
assert.equal(groups.hasFileRate, true, "the file verification must have a rate of its own, not the live one");
assert.equal(groups.sameElement, false, "one selector must not govern two unrelated things");
assert.equal(groups.hasInputGroup, true, "the live-input controls must be one group the contract can name");
assert.equal(groups.hasFileGroup, true, "the file-verification controls must be one group the contract can name");
// The owner's screenshot first: the rate of the incoming signal must not be sitting in the file-verification group,
// where it reads as the rate of the file.
assert.equal(groups.rateInFileGroup, false,
  "the rate of the incoming signal must NOT be in the file-verification group (that is the owner's screenshot)");
assert.equal(groups.rateInInputGroup, true, "the rate of the incoming signal must live with the input controls");
assert.equal(groups.verifyInFileGroup, true, "and the file group must still be the group that verifies a file");
assert.equal(groups.fileRateInFileGroup, true, "with its own rate inside it");
assert.match(groups.rateTitle, /timecode arriving on this input/,
  `the live rate must say what it is the rate of (got ${JSON.stringify(groups.rateTitle)})`);
assert.match(groups.rateTitle, /does not carry one/,
  `and that LTC carries no rate of its own (got ${JSON.stringify(groups.rateTitle)})`);
assert.match(groups.rateTitle, /reopens the stream at the new rate/,
  `and that changing it applies to the open stream (got ${JSON.stringify(groups.rateTitle)})`);
assert.match(groups.fileRateTitle, /file/,
  `the file's rate must say it governs the file (got ${JSON.stringify(groups.fileRateTitle)})`);
console.log("1. the rate selector lives with the live input; the file verification has its own");

// --- 2. The acceptance test: the clock's status line follows a rate change --------------------------------------
//
// Open an input at the rate the page starts on (25), and check the readout is reading it. Then choose 30 and check,
// in this order: the page said what it was doing before it waited; the change reached `set_ltc_input_rate`; the line
// carries the new rate; and **the clock's own status line says 30 fps** — the sentence the owner read as 25.
await evaluate(`document.getElementById('timecode-input-refresh').click()`);
await settle(400);
await evaluate(`document.getElementById('timecode-input-toggle').click()`);
await settle(500);
assert.equal(await invoked("open_ltc_input"), true, "pressing Listen must reach the backend");
assert.match(await clockLine(), /Running · LTC · 25 fps/,
  `with an input open at 25 the readout must say so (got ${JSON.stringify(await clockLine())})`);
assert.match(await line(), /Listening to BlackHole 2ch · channel 1 at 25 fps/,
  `and the input's own line must name the rate in use (got ${JSON.stringify(await line())})`);

await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const rate = document.getElementById('timecode-ltc-rate');
  rate.value = '30';
  rate.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
// Read **while the call is in flight**: the stub holds it for 500 ms, so this is the sentence the operator has while
// a reopen is enumerating devices and waiting for a stream to start.
const whileWaiting = await line();
assert.match(whileWaiting, /Applying 30 fps to the input/,
  `the page must say what it is doing before it waits (got ${JSON.stringify(whileWaiting)})`);

await settle(1000);
assert.equal(await invoked("set_ltc_input_rate"), true,
  "changing the rate with an input open must reach the backend's rate-change command");
assert.deepEqual(await lastArgs("set_ltc_input_rate"), { rate: "30" },
  "and it must carry the chosen rate");
assert.match(await line(), /Listening to BlackHole 2ch · channel 1 at 30 fps/,
  `the input's line must end up naming the new rate (got ${JSON.stringify(await line())})`);
const clockAfter = await clockLine();
assert.match(clockAfter, /Running · LTC · 30 fps/,
  `THE ACCEPTANCE TEST: after choosing 30 and letting the reopen happen, the readout must read 30 fps ` +
  `(got ${JSON.stringify(clockAfter)})`);
assert.doesNotMatch(clockAfter, /25 fps/,
  "and it must not still be reading the rate the stream was opened with");
console.log("2. the readout follows a rate change: 25 fps -> 30 fps, through set_ltc_input_rate");

// --- 2b. A clock that stopped says **against what window** it stopped --------------------------------------------
//
// The tolerance is a fact the backend reports, not a constant the window assumes, and the sentence has to name it: the
// difference between a signal that hiccupped and a show that stopped is the one an operator acts on. Both windows read
// the sentence from `cue-list.js`, so this assertion and the clock window's are one rule with two readers.
// The seam holds a **function** — the stub calls `fault(args)` — so the answer is wrapped.
await evaluate(`window.__setStub('timecode_state', () => ({ state: 'stale', position: '01:00:12:15', rate: '25', drop_frame: false, source: 'LTC', pieces: 8, positions: 1, age_ms: 2400, freewheel_ms: 750, freewheel_remaining_ms: 0 }))`);
await settle(700);
const stopped = await clockLine();
assert.match(stopped, /Stopped: no position for 2\.4 s/,
  `the readout says it stopped, and for how long (got ${JSON.stringify(stopped)})`);
assert.match(stopped, /past the 0\.75 s freewheel window/,
  `and names the window it was judged against (got ${JSON.stringify(stopped)})`);
assert.match(stopped, /re-arms the list instead of firing the cues it passed/,
  `and what a signal that returns will do (got ${JSON.stringify(stopped)})`);
assert.doesNotMatch(stopped, /^Nothing has arrived/,
  `a clock that stopped is not a clock that never started (got ${JSON.stringify(stopped)})`);
await evaluate(`window.__setStub('timecode_state')`);
console.log("2b. a stopped clock names the freewheel window it was judged against, and what returning will do");

// --- 2c. A rate change that would strand a cue is put to the operator **before** it is applied -------------------
//
// The list keeps the labels it has, so a label the new rate cannot express would never fire — and choosing the old rate
// back does not repair it, because the times were never converted, only read differently. The page therefore asks the
// backend first and, if anything is named, asks the operator; a refusal must leave the input exactly where it was.
await evaluate(`window.__RATE_CHECK = ['cue-9']`);
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const rate = document.getElementById('timecode-ltc-rate');
  rate.value = '24';
  rate.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await settle(600);
const asked = await evaluate(`(() => {
  const box = document.getElementById('win95-confirm');
  return {
    shown: Boolean(box) && box.style.display === 'flex',
    message: document.getElementById('win95-confirm-message')?.textContent.trim() || '',
  };
})()`);
assert.equal(asked.shown, true,
  `a rate change that would strand a cue must be put to the operator first (got ${JSON.stringify(asked)})`);
assert.match(asked.message, /1 cue\(s\) have a time that does not exist at 24 fps/,
  `and the question must say how many, and at which rate (got ${JSON.stringify(asked.message)})`);
assert.match(asked.message, /cue-9/,
  `naming a cue the window cannot resolve by its id rather than saying nothing (got ${JSON.stringify(asked.message)})`);
assert.equal(await invoked("set_ltc_input_rate"), false,
  "and nothing may be applied while the question is still open");

await evaluate(`document.getElementById('win95-confirm-cancel')?.click()`);
await settle(500);
assert.equal(await invoked("set_ltc_input_rate"), false, "refusing the change must not reach the backend at all");
const afterRefusal = await evaluate(`(() => ({
  selector: document.getElementById('timecode-ltc-rate').value,
  log: document.getElementById('log-output').textContent,
}))()`);
assert.equal(afterRefusal.selector, '30',
  `the selector must be put back to the rate the backend says the input is at (got ${JSON.stringify(afterRefusal.selector)})`);
assert.match(afterRefusal.log, /kept at 30/,
  `and the decision must be in the log, which persists — the input's line is repainted by the poll (got ${JSON.stringify(afterRefusal.log.slice(-200))})`);

// Accepting it applies the change: the check is a question, never a veto.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const rate = document.getElementById('timecode-ltc-rate');
  rate.value = '24';
  rate.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await settle(600);
await evaluate(`document.getElementById('win95-confirm-accept')?.click()`);
await settle(1200);
assert.equal(await invoked("set_ltc_input_rate"), true,
  "accepting the question must reach the backend's rate-change command");
await evaluate(`window.__RATE_CHECK = []`);
console.log("2c. a rate change that would strand a cue is asked first, refused without applying, and applied when accepted");

// The other half of the same rule: the page does not decide for itself that a rate is already in use — the backend
// owns that decision (`ltc_device::ltc_rate_change`, pinned by `cargo test`), and the page must always ask.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const rate = document.getElementById('timecode-ltc-rate');
  rate.value = '30';
  rate.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await settle(1000);
assert.equal(await invoked("set_ltc_input_rate"), true,
  "re-choosing the same rate is still sent to the backend, which owns the decision not to restart");
console.log("   and re-choosing the same rate is still the backend's decision, not the page's");

// --- 3. A wrong rate must not be silent -------------------------------------------------------------------------
//
// The stub now reports what a declared rate that does not match the signal really looks like: open, and nothing
// decoded since it opened. The status line has to say so, and it has to name the rate in use — otherwise an operator
// whose source is 30 and whose selector is 25 has nothing to read, which is where this started.
await evaluate(`window.__ltcStub.silentFor(6000)`);
await settle(700);
const silent = await line();
assert.match(silent, /no timecode position has been decoded/,
  `an open input that has decoded nothing must say so (got ${JSON.stringify(silent)})`);
assert.match(silent, /30 fps/,
  `and it must name the rate in use (got ${JSON.stringify(silent)})`);
assert.match(silent, /Check the rate of the input and the channel/,
  `and point at the two things an operator can change (got ${JSON.stringify(silent)})`);

// And it must not cry wolf: one decoded position is a working signal, whatever else is true of it.
await evaluate(`window.__ltcStub.decoded(1, 6000)`);
await settle(700);
const healthy = await line();
assert.doesNotMatch(healthy, /no timecode position has been decoded/,
  `an input that has decoded a position must not be reported as silent (got ${JSON.stringify(healthy)})`);
assert.match(healthy, /Listening to BlackHole 2ch · channel 1 at 30 fps/,
  `it reads as listening, with the rate (got ${JSON.stringify(healthy)})`);
console.log("3. an open input that has decoded nothing names its rate and says so; a working one does not");

// 3b. The measurement, when there is one, and the words it may use.
//
// The decoder measures the signal's **own** bit timing — the only fact that can answer "is the rate I chose the rate
// that is arriving?", because a count-derived estimate is biased towards the declaration (the decoder accepts only
// numbers valid at it). The sentence must name both numbers, and it must **never** say the rate was detected: the bit
// period measures the signal's playback speed at the rate the device runs at, so varispeed or pull-up moves it exactly
// as another frame rate would, and LTC carries nothing that separates those.
await evaluate(`window.__ltcStub.silentFor(6000)`);
await evaluate(`window.__ltcStub.measured(25.02, false)`);
await settle(700);
const agreeing = await line();
assert.doesNotMatch(agreeing, /own bit timing/,
  `a measurement that agrees with the declaration is not worth a sentence (got ${JSON.stringify(agreeing)})`);
assert.match(agreeing, /no timecode position has been decoded/,
  `and the case that was already there still gets its answer (got ${JSON.stringify(agreeing)})`);

await evaluate(`window.__ltcStub.measured(25.0, true)`);
await settle(700);
const disagreeing = await line();
assert.match(disagreeing, /the signal's own bit timing is 25\.0 fps/,
  `THE MEASUREMENT IS NAMED, against the rate the operator declared (got ${JSON.stringify(disagreeing)})`);
assert.match(disagreeing, /at 30 fps, but the signal's own bit timing/,
  `with both numbers in one sentence (got ${JSON.stringify(disagreeing)})`);
assert.doesNotMatch(disagreeing, /detect/i,
  `AND IT IS NEVER CALLED DETECTION: the bit period measures playback speed, not the source's setting (got ${JSON.stringify(disagreeing)})`);
assert.doesNotMatch(disagreeing, /no timecode position has been decoded/,
  `it takes precedence over the hedged sentence, because it is the diagnosis of it (got ${JSON.stringify(disagreeing)})`);

// And a healthy signal is never reported, however the measurement is worded.
await evaluate(`window.__ltcStub.decoded(120, 6000)`);
await evaluate(`window.__ltcStub.measured(30.0, false)`);
await settle(700);
const quiet = await line();
assert.doesNotMatch(quiet, /own bit timing/,
  `a working signal gets no measurement sentence at all (got ${JSON.stringify(quiet)})`);
console.log("3b. the signal's own bit timing is named against the declared rate, never as a detection");

// 3c. The stream that went quiet, which is the one that used to read "Listening to …" for ever.
//
// A device can die without an error callback: the stream stays open and `is_open()` stays true, so nothing on the page
// changed while the signal had stopped. The backend now watches the **age of the data**, and the two faults stay
// distinct — a stream that has never decoded is the rate or the channel, and it keeps its own sentence.
await evaluate(`window.__ltcStub.decoded(120, 30_000)`);
await evaluate(`window.__ltcStub.stalled(4_200)`);
await evaluate(`window.__ltcStub.measured(30.0, true)`);
await settle(700);
const wentQuiet = await line();
assert.match(wentQuiet, /no timecode position has arrived for 4 s/,
  `A STREAM THAT WENT QUIET SAYS HOW LONG IT HAS BEEN QUIET (got ${JSON.stringify(wentQuiet)})`);
assert.match(wentQuiet, /The stream is open and silent/,
  `and says what that is: open as far as the system is concerned, and silent (got ${JSON.stringify(wentQuiet)})`);
assert.match(wentQuiet, /Check the cable and the channel, or press Reconnect/,
  `naming what an operator can actually do about it (got ${JSON.stringify(wentQuiet)})`);
assert.doesNotMatch(wentQuiet, /own bit timing/,
  `AND IT TAKES PRECEDENCE OVER THE MEASUREMENT: a rate mismatch reported over a signal that has stopped would send ` +
  `the operator to change the wrong thing (got ${JSON.stringify(wentQuiet)})`);

// The other half, beside its neighbour: a stream that has **never** decoded is a different fault with a different cure.
await evaluate(`window.__ltcStub.silentFor(6_000)`);
await evaluate(`window.__ltcStub.measured(null, false)`);
await settle(700);
const neverDecoded = await line();
assert.match(neverDecoded, /no timecode position has been decoded/,
  `a stream that never decoded keeps its own sentence about the rate and the channel (got ${JSON.stringify(neverDecoded)})`);
assert.doesNotMatch(neverDecoded, /The stream is open and silent/,
  `and is not called stalled, because it never decoded at all (got ${JSON.stringify(neverDecoded)})`);
console.log("3c. a stream that decoded and went quiet says so, and stays distinct from one that never decoded");

// --- 3d. The arrival timeout: the stream that went quiet is reopened, bounded and announced ------------------------
//
// The last piece of D7's recovery. Every condition here is one of the measurements that shaped it: a stall is the
// backend's verdict from the **age of the data**, a stream that never decoded is a different fault that reopening cannot
// cure, and a retry loop over a device that is simply gone would flap — so it is one attempt per quiet episode with a
// cooldown, and the log says so rather than the page churning in silence.
// The **never-decoded** case comes first, and that order is a measurement: the attempt budget is per quiet episode, so
// running the stall first would leave a spent budget that masks exactly the defect this half is for.
await evaluate(`localStorage.removeItem('wing_ltc_arrival_retry_at')`);
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`window.__ltcStub.silentFor(6_000)`);
await evaluate(`window.__ltcStub.measured(null, false)`);
await settle(900);
const reconnects = () => evaluate(`window.__INVOKES.filter((entry) => entry.cmd === 'reconnect_ltc_input').length`);
assert.equal(await reconnects(), 0,
  "A STREAM THAT NEVER DECODED IS NOT REOPENED: that fault is the rate or the channel, and a reopen would hide the diagnosis");

// Then the fault this is for: a stream that decoded and then went quiet.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`window.__ltcStub.decoded(120, 30_000)`);
await evaluate(`window.__ltcStub.stalled(4_200)`);
await waitFor(`window.__INVOKES.filter((entry) => entry.cmd === 'reconnect_ltc_input').length === 1`,
  "the quiet stream to be reopened once");
assert.equal(await reconnects(), 1, "A STREAM THAT WENT QUIET IS REOPENED, without the operator having to notice");

// The cooldown: a second poll must not start a second reopen. This is what keeps a device that is simply gone from being
// torn down and rebuilt four times a second.
await settle(800);
assert.equal(await reconnects(), 1, "AND ONLY ONCE: the cooldown is what stops a retry loop from flapping");

// The log is where the operator can see what the window did on its own, with the wall-clock time of every attempt.
const log = await evaluate(`document.getElementById('log-output')?.textContent || ''`);
assert.match(log, /went quiet and was reopened/,
  `AND THE REOPENING IS LOGGED, so an automatic action is never a silent one (got ${JSON.stringify(log.slice(0, 200))})`);
console.log("3d. a quiet stream is reopened once, with a cooldown, a log line, and never over a stream that never decoded");

// A rate change that is refused names the step that failed, and the sentence survives the polling that continues
// while the page is open. The backend's reopen closes the stream before it opens the new one, so there is nothing to
// report except the refusal — and a refusal the next 250 ms tick erases is no answer at all.
await evaluate(`window.__setStub('set_ltc_input_rate', () => {
  throw new Error('the step that failed was opening the device: BlackHole 2ch is held by another application');
})`);
await evaluate(`(() => {
  const rate = document.getElementById('timecode-ltc-rate');
  rate.value = '24';
  rate.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await settle(1200);
const refused = await line();
assert.match(refused, /the step that failed was opening the device/,
  `a refused rate change must say which step failed (got ${JSON.stringify(refused)})`);
assert.match(refused, /held by another application/,
  `and it must carry the backend's own sentence (got ${JSON.stringify(refused)})`);
await evaluate(`window.__setStub('set_ltc_input_rate')`);
console.log("   and a refused rate change keeps the step that failed on the line");

// --- 4. The file's rate is its own ------------------------------------------------------------------------------
//
// The reason the selector had to move: one control was silently governing two signals. This proves the file read
// takes the file's rate, and that the live input's rate has nothing to do with it.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => { document.getElementById('timecode-file-rate').value = '24'; })()`);
await evaluate(`document.getElementById('timecode-ltc-verify').click()`);
await settle(400);
assert.deepEqual(await lastArgs("verify_timecode_file"), { rate: "24" },
  "Verify an LTC file must read the file's own rate, not the live input's");
assert.match(await evaluate(`document.getElementById('timecode-ltc-result').textContent.trim()`), /24 fps/,
  "and it must report what the file holds");
console.log("4. the file is verified at the file's rate, which the live input's rate cannot change");

const unexpected = pageErrors.filter((text) => !/ResizeObserver|favicon/.test(text || ""));
assert.deepEqual(unexpected, [], `the page must not have thrown: ${JSON.stringify(unexpected)}`);

console.log("LTC input rate contract passed: the selector moved to the live input, a change reaches the backend and the clock's line follows it, a silent decode names its rate, and a refusal names the step");
console.log("WING_BROWSER_SUITE_OK");
// The CDP socket would keep this process alive after the seal, and a suite that prints the seal and then hangs is
// indistinguishable from a wedged browser to whoever is watching it.
process.exit(0);
