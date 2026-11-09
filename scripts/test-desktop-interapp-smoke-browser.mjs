// The interactive review of every new surface: it presses each control and checks three things the other suites do
// not — that the click reached the backend, that **nothing threw**, and that the page did not break its own layout.
//
// It exists because of a whole class of defect that reached the owner's desk twice: a **Settings…** button whose
// handler called a function out of scope behind a `typeof` guard, so it did nothing and said nothing; and a clock
// window whose readout overflowed the window it opens in. Both passed a green gate, because the contracts asserted
// that the controls **existed** rather than that they **worked**.
//
// So every step here is: click it, then assert that the application asked the backend for something and that the
// console stayed silent. A control that does nothing fails; a handler that throws fails; a page that overflows its
// own dialog fails.
//
// Run: node scripts/test-desktop-interapp-smoke-browser.mjs (needs Chrome on the debug port; the gate starts one)

import assert from "node:assert/strict";
import fs from "node:fs";
import WebSocket from "ws";

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
const PAGE_URL = new URL("../desktop/ui/index.html", import.meta.url).href;
const SHOTS = process.env.WING_SMOKE_SHOTS || "";

const pages = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`, { signal: AbortSignal.timeout(2000) })
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);
if (!pages) {
  console.log(`SKIP: no Chrome remote debugging on port ${DEBUG_PORT}`);
  process.exit(3);
}

const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })).json();
assert.ok(target?.webSocketDebuggerUrl, "could not open a Chrome tab for the smoke review");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.once("open", resolve));

let nextId = 0;
const pending = new Map();
let consoleErrors = [];
socket.on("message", (data) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (request) {
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    consoleErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    consoleErrors.push(message.params.entry.text);
  }
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
const settle = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));

async function shoot(name) {
  if (!SHOTS) return;
  const shot = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(shot.data, "base64"));
}

// ---------------------------------------------------------------------------------------------------------------
// The harness: a backend that answers the way the real one does, including **echoing what was saved**, because a
// stub that answers `{}` hides every bug in the code that renders the answer.
//
// It also answers the way the real backend **fails**, because every stub above succeeds and a suite that only
// succeeds cannot see the message an operator reads when something is refused. The first version of this harness
// had no failure path at all, and that is how the permission button came to write its answer into the status line
// and have the following refresh overwrite it: the click reached the backend, the stub succeeded and the contract
// never looked at the sentence on screen. A case fixes a command's answer with `setStub(cmd, "() => value")` — or
// makes it throw with `setStub(cmd, "() => { throw new Error(...) }")` — and clears it again with `setStub(cmd)`.
const STUB = `
window.__INVOKES = [];
window.__STUB_FAULTS = {};
window.__setStub = (cmd, answer) => {
  // The per-case answer, as a function of the command's arguments: it may return a value or throw. Clearing it (no
  // second argument) is the default answer again.
  if (answer === undefined) delete window.__STUB_FAULTS[cmd];
  else window.__STUB_FAULTS[cmd] = answer;
  return window.__STUB_FAULTS[cmd] ? "set" : "cleared";
};
(() => {
  let settings = {
    schema_version: 1, enabled: true, active: true,
    peers: [{ id: "peer-1", kind: "osc", name: "QLab", host: "127.0.0.1", enabled: true, notes: "" }],
    triggers: [{
      id: "trigger-1", macro_index: 0,
      spec: { kind: "note_on", channel: 0, number: 60, value: 127 },
      osc: null, require: null, note: "VOX MARINA SWAP",
    }],
  };
  let cues = {
    schema_version: 1, offset_frames: 0,
    cues: [{
      id: "cue-1",
      at: { hours: 1, minutes: 0, seconds: 20, frames: 0, rate: "fps25", drop_frame: false },
      macro_index: 0, repeats: false, enabled: true, note: "VOX MARINA SWAP",
    }],
  };
  const library = {
    schemaVersion: 1, selectedIndex: 0,
    macros: [
      { name: "VOX MARINA SWAP", enabled: true, config: {} },
      { name: "MUTE DRUMS", enabled: false, config: {} },
    ],
  };
  // The ports are **closed when the window opens**, which is what the real page asks until the operator presses
  // "Open our ports" / "Start listening". The first version of this harness answered open: true from the start,
  // and that was invisible while the page read the state only after a sidebar click; now the page reads the
  // active Settings page at startup too, so an already-open answer made the first press close the ports and the
  // "Open our ports" contract failed for the harness's own reason. The stub follows the toggle, as the backend
  // does, instead of asserting a state the page can never reach on a fresh load.
  const midiPorts = [
    { name: "WING CONTROLLER In", direction: "in", ours: true },
    { name: "WING CONTROLLER Out", direction: "out", ours: true },
    { name: "Mixing Station", direction: "in", ours: false },
  ];
  let midiOpen = false;
  let oscOpen = false;
  const midiState = () => ({ open: midiOpen, sent: midiOpen ? 1 : 0, received: midiOpen ? 4 : 0,
    matches: midiOpen ? 1 : 0, dropped: 0, last: null, last_problem: null });
  const oscState = () => ({ open: oscOpen, port: 9100, bind: "this machine only",
    received: oscOpen ? 3 : 0, messages: oscOpen ? 5 : 0, matches: oscOpen ? 1 : 0, malformed: 0,
    unknown_senders: 0, dropped_flood: 0, sent: oscOpen ? 1 : 0, matches_dropped: 0, last: null,
    last_problem: null, default_port: 9100 });
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        window.__INVOKES.push({ cmd, args });
        const fault = window.__STUB_FAULTS[cmd];
        if (fault) return fault(args);
        switch (cmd) {
          case "get_inter_app_settings": return settings;
          case "set_inter_app_settings": settings = args.settings; return settings;
          case "get_timecode_cues": return cues;
          case "set_timecode_cues": cues = args.cues; return cues;
          case "add_timecode_cue_from_position": return cues;
          case "timecode_state": return { state: "running", position: "01:00:12:15", rate: "25", source: "MTC",
            pieces: 8, positions: 1, cues: 1, next_cue: "01:00:20:00", next_cue_seconds: 7.8 };
          case "load_macro_library": return library;
          case "save_macro_library": return args.library;
          case "inter_app_midi_ports": return midiPorts;
          case "inter_app_midi_open": midiOpen = true; return midiPorts;
          case "inter_app_midi_close": midiOpen = false; return {};
          case "inter_app_midi_state": return midiState();
          case "inter_app_osc_open": oscOpen = true; return oscState();
          case "inter_app_osc_close": oscOpen = false; return {};
          case "inter_app_osc_state": return oscState();
          case "ltc_input_state": return { open: false, listening: null, inputs: 1, stream_error: null };
          case "reconnect_ltc_input": return "Reconnected: listening to Micrófono del MacBook Pro · channel 1 · 48000 Hz";
          case "list_timecode_inputs": return [
            { name: "Micrófono del MacBook Pro", channels: 1, sample_rate: 48000, is_default: true },
          ];
          case "inter_app_midi_send": return { sent: true, description: "note on ch 1 #60 (127)", verifiable: false };
          case "inter_app_osc_send": return { sent: true, description: "/cue/1/go", verifiable: false };
          case "target_catalog": return { categories: [], targetParametersByCategory: {}, triggerParametersByCategory: {} };
          case "discover_wing": return { ip: "192.168.1.10", name: "desk", model: "WING", serial: "0", firmware: "0", localIp: "192.168.1.11", localInterface: "en0", replyText: "WING" };
          case "default_show_runner_config": return { actions: [], conditions: [], enabled: false };
          default: return {};
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
await call("Log.enable");
await call("Page.enable");
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await call("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
await call("Page.navigate", { url: PAGE_URL });
for (let attempt = 0; attempt < 80; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && typeof window.__wingOpenTimecodeWindow === "function"')) break;
  await settle(100);
}

const report = [];
const callsSince = async () => await evaluate("window.__INVOKES.length");
const invoked = async (name) =>
  await evaluate(`window.__INVOKES.some((entry) => entry.cmd === ${JSON.stringify(name)})`);
const resetInvocations = async () => await evaluate("window.__INVOKES.length = 0");

/// Fix one command's answer for the case that follows, or clear it again with `setStub(name)`. The answer is a small
/// **page-side expression that evaluates to a function of the command's arguments**, so a case can return a value
/// (`'() => ({ answers: [...] })'`) or make the command fail (`'() => { throw new Error("the microphone permission
/// was refused"); }'`), which is what a refusal from the real backend looks like. Every case that sets one clears it
/// before the next begins; leaving one behind would change the answer the generic walk further down sees, which is
/// how a stub quietly rewrites the suite it is meant to observe.
const setStub = async (cmd, answer) =>
  await evaluate(`window.__setStub(${JSON.stringify(cmd)}, ${answer ?? "undefined"})`);

/// Press something **and read what the operator reads**: by default the pressed control's own text, or another
/// element's with `readFrom` (the line beside the button), plus the commands the click reached and any error the page
/// threw. Clicking a control and asserting what it put on screen is one call, so a failure case is three lines — set
/// the answer, press, read the sentence — instead of a block of CDP calls.
async function pressAndRead(label, selector, expected = [], { stub, clear, readFrom, textOf, settleMs = 260 } = {}) {
  if (stub !== undefined) await setStub(stub.command, stub.answer);
  try {
    consoleErrors = [];
    await resetInvocations();
    const exists = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (!exists) {
      report.push({ label, ok: false, why: "the control does not exist" });
      assert.fail(`${label}: ${selector} does not exist`);
    }
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await settle(settleMs);
    const calls = await evaluate("window.__INVOKES.map((entry) => entry.cmd)");
    const readSelector = readFrom || selector;
    const text = await evaluate(
      textOf
        ? `(${textOf})(document.querySelector(${JSON.stringify(readSelector)}))`
        : `(document.querySelector(${JSON.stringify(readSelector)})?.textContent || "").trim()`,
    );
    const missing = [];
    for (const name of expected) if (!calls.includes(name)) missing.push(name);
    const ok = missing.length === 0 && consoleErrors.length === 0;
    report.push({ label, ok, calls, missing, errors: consoleErrors.slice(0, 2) });
    if (!ok) {
      assert.fail(
        `${label}: ${missing.length ? `it did not reach the backend (missing ${missing.join(", ")})` : ""}` +
        `${consoleErrors.length ? ` — and it threw: ${consoleErrors[0]}` : ""} (calls: ${JSON.stringify(calls)})`,
      );
    }
    return { calls, text };
  } finally {
    // Whatever the case did, the next one starts from the answers the harness was written with.
    if (clear) await setStub(clear);
  }
}

/// Click something and say what happened: the commands that followed, and any error the page threw. This is the
/// review, in one function.
async function press(label, selector, expected = []) {
  const { calls } = await pressAndRead(label, selector, expected);
  return calls;
}

/// Bring one Settings page up, the way the operator does: open the window and click its tab. The message contracts
/// below each start from their own page, so one case cannot be decided by where the previous one left the window.
async function openSettingsTab(tab) {
  await evaluate(`document.getElementById('settings-modal-backdrop').style.display = 'none'`);
  await evaluate(`document.getElementById('open-settings-btn').click()`);
  await settle(200);
  await evaluate(`document.querySelector('.settings-nav-item[data-tab="${tab}"]').click()`);
  await settle(200);
}

// --- The two cards in the right-hand column -------------------------------------------------------------------
await press("card: Timecode Settings…", "#btn-open-timecode-settings");
assert.equal(await evaluate(`getComputedStyle(document.getElementById('settings-modal-backdrop')).display !== "none"`), true,
  "the Timecode card's Settings… must open Settings");
assert.equal(await evaluate(`document.querySelector('.settings-nav-item.is-active')?.dataset?.tab`), "timecode",
  "and it must open on the Timecode page");
await shoot("01-timecode-page");

await press("card: inter-app Settings…", "#btn-open-interapp-settings");
assert.equal(await evaluate(`document.querySelector('.settings-nav-item.is-active')?.dataset?.tab`), "interapp",
  "the inter-app card's Settings… must open Settings on its own page");
await shoot("02-interapp-page");

// --- The inter-application page, control by control -----------------------------------------------------------
await press("page: Add an application", "#inter-app-peer-add", ["set_inter_app_settings"]);
const peerRows = await evaluate(`document.querySelectorAll('#inter-app-peer-list-rows input').length`);
assert.ok(peerRows > 0, "adding an application must put a row on the page");
await shoot("03-peer-added");

await press("page: Refresh the MIDI list", "#inter-app-midi-refresh", ["inter_app_midi_ports"]);
const portsText = await evaluate(`document.getElementById('inter-app-midi-ports').textContent`);
assert.match(portsText, /port\(s\) found/, `the refresh must report what it found (got ${JSON.stringify(portsText)})`);

await press("page: Open our ports", "#inter-app-midi-toggle", ["inter_app_midi_open"]);
await press("page: Send one message", "#inter-app-midi-test-send", ["inter_app_midi_send"]);
await press("page: Start listening", "#inter-app-osc-toggle", ["inter_app_osc_open"]);
await press("page: Send an OSC message", "#inter-app-osc-send", ["inter_app_osc_send"]);
await press("page: Learn a MIDI trigger", "#inter-app-trigger-learn", ["inter_app_midi_learn"]);
await press("page: Learn an OSC trigger", "#inter-app-osc-trigger-learn", ["inter_app_osc_learn"]);
await shoot("04-interapp-after-clicks");

// --- The timecode page, control by control --------------------------------------------------------------------
await evaluate(`document.querySelector('.settings-nav-item[data-tab="timecode"]').click()`);
await settle();
await press("page: Refresh the audio inputs", "#timecode-input-refresh", ["list_timecode_inputs"]);
// What matters is that the operator can see and choose the device the backend reported — the first version of this
// assertion counted options and was wrong: the picker correctly **replaces** its "press Refresh" placeholder.
const devices = await evaluate(`Array.from(document.getElementById('timecode-input-device').options).map((o) => o.textContent)`);
assert.ok(devices.some((text) => /Micrófono del MacBook Pro/.test(text)),
  `the device list must show what the backend answered (got ${JSON.stringify(devices)})`);
await press("page: Ask macOS for audio access", "#timecode-input-permission", ["request_audio_access"]);
await press("page: Listen to the audio input", "#timecode-input-toggle", ["open_ltc_input"]);
// The one control that gets an operator back from a hot unplug without relaunching. It is pressed like every other
// control here: the click must reach the backend, nothing may throw, and the layout must survive it.
await press("page: Reconnect the input", "#timecode-input-reconnect", ["reconnect_ltc_input"]);
const reconnected = await evaluate(`document.getElementById('timecode-input-state').textContent.trim()`);
assert.match(reconnected, /Reconnected: listening to/,
  `the reconnect must show the backend's own sentence (got ${JSON.stringify(reconnected)})`);

// The trap this exists for: macOS asks for the microphone only when a stream starts, and until it has been granted an
// application can be told there are **no** input devices — so the list looks empty and there is nothing to choose.
// The page has to say that, and offer the way out, because "no audio inputs" with no explanation is what made the
// owner conclude the feature was simply broken.
const accessHint = await evaluate(`(() => {
  const button = document.getElementById('timecode-input-permission');
  return { present: Boolean(button), title: button ? button.title : '' };
})()`);
assert.equal(accessHint.present, true, "the page must offer a way to ask macOS for audio access");
assert.match(accessHint.title, /asks only when a stream starts/, `and explain why it is needed (got ${JSON.stringify(accessHint.title)})`);
assert.match(accessHint.title, /no input devices at all/, `including what the operator sees without it (got ${JSON.stringify(accessHint.title)})`);
// **"Add a cue here" is no longer on this page.** The control moved to the LTC window, where it is pressed by
// `test-desktop-ltc-window-browser.mjs` (sections 21 and 22) — so the rule "every new control is pressed by a test"
// still holds, in the window that owns it. What this page gained instead is the way to that window, and it is pressed
// here so the summary is not a dead end.
await press("page: Edit the cue list", "#timecode-cue-edit-list", ["open_ltc_window"]);
await press("page: Pass the timecode on as MTC", "#timecode-forward-mtc", ["set_timecode_forwarding"]);
await press("page: Open the clock window", "#timecode-open-window", ["open_timecode_window"]);
await shoot("05-timecode-after-clicks");

// --- The macro editor's block ----------------------------------------------------------------------------------
await evaluate(`document.getElementById('settings-modal-backdrop').style.display = 'none'`);
await evaluate(`document.querySelector('#macro-bindings-list')?.closest('details')?.setAttribute('open', '')`);
await settle();
await press("macro: Add a MIDI binding", "#macro-add-midi", ["set_inter_app_settings"]);
await press("macro: Add a timecode cue here", "#macro-add-timecode", ["set_timecode_cues"]);
await press("macro: Open these bindings…", "#macro-open-interapp");
assert.equal(await evaluate(`getComputedStyle(document.getElementById('settings-modal-backdrop')).display !== "none"`), true,
  "the macro block's Open these bindings… must open Settings");
await shoot("06-macro-bindings");

// --- The message contracts, one per failure path -----------------------------------------------------------------
//
// Every stub above succeeds, and that is the hole this block fills: a click that reaches the backend and throws no
// error can still leave the operator with nothing to read — which is what happened to the permission button, whose
// answer was written into `#timecode-input-state` and overwritten by the refresh that followed it. So each case here
// fixes what the backend answers (a refusal, an empty list), presses the real control, and asserts **the sentence the
// operator reads**, with the harness's own answer echoed into it so the assertion cannot be satisfied by a message
// the page wrote on its own.

// The registry being refused is answered in `#inter-app-status`, which is where "The application could not be added."
// used to be written over the reason the backend gave. Every case starts from its own page so no earlier case decides
// what this one reads.
await openSettingsTab("interapp");
const addRefused = await pressAndRead("message: Add an application, refused", "#inter-app-peer-add",
  ["set_inter_app_settings"], {
    stub: { command: "set_inter_app_settings", answer: '() => { throw new Error("the desk refused: the profile is read-only"); }' },
    clear: "set_inter_app_settings",
    readFrom: "#inter-app-status",
  });
assert.match(addRefused.text, /the desk refused: the profile is read-only/,
  `an application that could not be added must say why, not that it could not (got ${JSON.stringify(addRefused.text)})`);
assert.doesNotMatch(addRefused.text, /^The application could not be added\.$/,
  `the reason must not be replaced by a sentence that names no reason (got ${JSON.stringify(addRefused.text)})`);

await openSettingsTab("timecode");
const refusedPermission = await pressAndRead("message: Ask macOS for audio access, refused", "#timecode-input-permission",
  ["request_audio_access"], {
    stub: { command: "request_audio_access", answer: '() => { throw new Error("the microphone permission was refused"); }' },
    clear: "request_audio_access",
    readFrom: "#timecode-input-state",
  });
assert.match(refusedPermission.text, /the microphone permission was refused/,
  `a refused permission must be read on the line, not swallowed (got ${JSON.stringify(refusedPermission.text)})`);

// The refusal is pressed and read again, which is the operator looking at the line a second time: the reason must
// still be there. The path that follows a **successful** ask is not taken on a refusal, so nothing may have written
// over it in between — and if a later change starts writing the refreshed count there anyway, this says so.
const refusedAgain = await pressAndRead("message: a refusal is still readable on the next press",
  "#timecode-input-permission", ["request_audio_access"], {
    stub: { command: "request_audio_access", answer: '() => { throw new Error("the microphone permission was refused"); }' },
    clear: "request_audio_access",
    readFrom: "#timecode-input-state",
  });
assert.match(refusedAgain.text, /the microphone permission was refused/,
  `the reason must survive the operator looking again (got ${JSON.stringify(refusedAgain.text)})`);

const grantedPermission = await pressAndRead("message: Ask macOS for audio access, granted", "#timecode-input-permission",
  ["request_audio_access"], {
    stub: { command: "request_audio_access", answer: '() => "macOS granted audio access."' },
    clear: "request_audio_access",
    readFrom: "#timecode-input-state",
    // The answer is shown with the device count, so the case has to wait for `refreshTimecodeInputs` to finish: a
    // read taken between the two lines would see neither the answer nor the count and would be measuring the timing.
    settleMs: 900,
  });
assert.match(grantedPermission.text, /macOS granted audio access\./,
  `what macOS answered must be on the line (got ${JSON.stringify(grantedPermission.text)})`);
assert.match(grantedPermission.text, /1 input device\(s\)/,
  `and the count it was refreshed with, in the same sentence (got ${JSON.stringify(grantedPermission.text)})`);

const unlistableInputs = await pressAndRead("message: Refresh the audio inputs, refused", "#timecode-input-refresh",
  ["list_timecode_inputs"], {
    stub: { command: "list_timecode_inputs", answer: '() => { throw new Error("CoreAudio did not answer"); }' },
    clear: "list_timecode_inputs",
    readFrom: "#timecode-input-state",
  });
assert.match(unlistableInputs.text, /could not be listed/,
  `a list that could not be read must be said out loud (got ${JSON.stringify(unlistableInputs.text)})`);
assert.match(unlistableInputs.text, /CoreAudio did not answer/,
  `and it must carry the reason the backend gave (got ${JSON.stringify(unlistableInputs.text)})`);

const noInputs = await pressAndRead("message: Refresh the audio inputs, none reported", "#timecode-input-refresh",
  ["list_timecode_inputs"], {
    stub: { command: "list_timecode_inputs", answer: "() => []" },
    clear: "list_timecode_inputs",
    readFrom: "#timecode-input-state",
  });
assert.match(noInputs.text, /no audio inputs/,
  `an empty list must say there are none, not stay silent (got ${JSON.stringify(noInputs.text)})`);
assert.match(noInputs.text, /press Ask macOS for access/,
  `and it must offer the way out of the trap macOS puts the operator in (got ${JSON.stringify(noInputs.text)})`);
assert.equal(await evaluate(`document.getElementById('timecode-input-device').options.length`), 1,
  "and the picker must show the one 'no audio inputs' placeholder rather than an empty box");

// --- The toolbar's own clock button ----------------------------------------------------------------------------
await evaluate(`document.getElementById('settings-modal-backdrop').style.display = 'none'`);
await press("toolbar: Clock", "#top-open-clock-btn", ["open_timecode_window"]);

// --- Geometry: nothing may spill out of the surface it lives in -------------------------------------------------
const geometry = await evaluate(`(() => {
  const out = [];
  for (const id of ['tabpage-interapp', 'tabpage-timecode']) {
    const page = document.getElementById(id);
    if (!page) continue;
    const box = page.getBoundingClientRect();
    for (const control of page.querySelectorAll('button, input, select, details, fieldset')) {
      const rect = control.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const spills = rect.right > box.right + 1 || rect.left < box.left - 1;
      if (spills) out.push({ page: id, control: control.id || control.tagName, right: Math.round(rect.right), box: Math.round(box.right) });
    }
  }
  return out;
})()`);
assert.deepEqual(geometry, [], `controls must stay inside their page: ${JSON.stringify(geometry)}`);

// --- Two generic contracts, because both of these reached the owner and neither was caught by naming controls one
//     by one: a control nobody presses is still a control the operator will press.
//
//     1. Nothing in these two pages may be disabled. A greyed placeholder left over from an earlier phase — "adding
//        an application arrives with the MIDI support" — sat exactly where the operator looks for that button, and
//        it was the button they pressed.
//     2. Everything must be reachable. The dialog body is 565 px tall inside a 630 px modal and both pages are
//        longer, so "the control exists" is not the same as "the operator can get to it": each page is scrolled to
//        its end and its last control has to land inside the window.
for (const [pageId, lastControlId] of [
  ["tabpage-interapp", "inter-app-trigger-learn"],
  ["tabpage-timecode", "timecode-open-window"],
]) {
  await evaluate(`document.getElementById('settings-modal-backdrop').style.display = 'none'`);
  await evaluate(`document.getElementById('open-settings-btn').click()`);
  await settle();
  await evaluate(`document.querySelector('.settings-nav-item[data-tab="${pageId.replace("tabpage-", "")}"]').click()`);
  await settle();

  // Buttons: none may be disabled. A select or an input may legitimately wait for a checkbox (the OSC condition
  // editor's fields wait for "only if argument"), but a **button** is an action, and a greyed one in this page was a
  // placeholder from an earlier phase sitting exactly where the operator looked for it.
  const disabled = await evaluate(`Array.from(document.querySelectorAll('#${pageId} button[disabled]'))
    .map((el) => el.id || el.textContent.trim().slice(0, 40))`);
  assert.deepEqual(disabled, [], `no button in ${pageId} may be a disabled placeholder: ${JSON.stringify(disabled)}`);

  // And no control may promise that something is coming: the placeholder above carried a tooltip saying "adding an
  // application arrives with the MIDI support", which was written when that was true and stayed after it was not.
  const promises = await evaluate(`Array.from(document.querySelectorAll('#${pageId} [title]'))
    .map((el) => el.getAttribute('title'))
    .filter((text) => /arrives with|not built yet|coming soon|will arrive|later step|a later step/i.test(text))`);
  assert.deepEqual(promises, [], `no control may promise a future feature: ${JSON.stringify(promises)}`);

  const reachable = await evaluate(`(() => {
    const page = document.getElementById('${pageId}');
    page.scrollTop = page.scrollHeight;
    const el = document.getElementById('${lastControlId}');
    if (!el) return { missing: true };
    const rect = el.getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), visible: rect.top >= 0 && rect.bottom <= window.innerHeight };
  })()`);
  assert.equal(reachable.missing ?? false, false, `${lastControlId} must exist`);
  assert.equal(reachable.visible, true, `${lastControlId} must be reachable by scrolling ${pageId} (${JSON.stringify(reachable)})`);
  await evaluate(`document.getElementById('${pageId}').scrollTop = 0`);
}

// --- And the two cards and the banner above them ---------------------------------------------------------------
const chrome = await evaluate(`(() => {
  const ids = ['timecode-card-position', 'timecode-card-state', 'timecode-card-cue', 'interapp-card-state', 'interapp-card-midi', 'interapp-card-osc', 'top-timecode'];
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    const rect = el?.getBoundingClientRect();
    out[id] = rect ? { w: Math.round(rect.width), h: Math.round(rect.height), text: (el.textContent || '').trim().slice(0, 60) } : null;
  }
  return out;
})()`);
for (const [id, box] of Object.entries(chrome)) {
  assert.ok(box && box.w > 0 && box.h > 0, `the ${id} card must be laid out and visible (got ${JSON.stringify(box)})`);
}

// --- And the other end of every click: the command it reached has to exist in the real backend ------------------
// This is the link that makes a DOM-and-clicks test mean something for the packaged application. Its frontend **is**
// these files (`frontendDist: "../ui"` in tauri.conf.json, with no bundling step), so a click here runs the same code
// the app runs — and the command the click reaches is registered, or it is not, in `main.rs`.
const registered = new Set(
  [...fs.readFileSync(new URL("../desktop/src-tauri/src/main.rs", import.meta.url), "utf8")
    .slice(fs.readFileSync(new URL("../desktop/src-tauri/src/main.rs", import.meta.url), "utf8").indexOf("generate_handler!["))
    .matchAll(/^\s{4,12}([a-z0-9_]+),$/gm)].map((match) => match[1]),
);
const observed = [...new Set(report.flatMap((step) => step.calls || []))];
const unregistered = observed.filter((command) => !registered.has(command));
assert.deepEqual(unregistered, [],
  `every command these controls reached must be registered in the backend: ${JSON.stringify(unregistered)}`);
console.log(`every command the clicks reached is in the backend: ${observed.length} distinct commands, all registered`);

console.log(`interactive review: ${report.filter((step) => step.ok).length}/${report.length} controls answered the backend with no error`);
for (const step of report) {
  console.log(`  ${step.ok ? "ok  " : "FAIL"} ${step.label}${step.calls?.length ? ` → ${step.calls.join(", ")}` : ""}`);
}
console.log("WING_BROWSER_SUITE_OK");
process.exit(0);
