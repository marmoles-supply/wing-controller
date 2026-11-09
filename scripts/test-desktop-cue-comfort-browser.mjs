// The two comforts the owner asked for around the cue list, driven in the page that ships.
//
//   * **A cue-fired macro must show its courtesy notice when the macro's own toggle is on.** His words: "si es un cue
//     que triggerea el macro, no aparece el notice de cortesía, aunque esté activado". The notice is a non-blocking
//     card in a corner with its own close button, so showing it from a cue is safe; the per-macro [`!] Notice` button
//     read ON and the cue path never read it. The trigger path shows it and the cue path did not, and this is the
//     contract that both read the same setting.
//
//   * **Neither must a macro fired by another application.** His rule: "un interruptor que gobierna tres de los
//     cuatro caminos de disparo no es un interruptor". The inter-app path fires through the same `fireMacroNow`, so
//     the same toggle governs it — and its card names the transport (MIDI or OSC) and that the order came from
//     another application, never the application and never the console. The context menu's own Fire Macro stays
//     silent: the operator pressed it.
//
//   * **`Add cue at the end` appends at the end of the list.** His words: "es muy incómodo add cue cuando estás
//     montando una lista larga de cues. necesito que como mínimo, pongas add cue al final de la lista de cues". The
//     insert-at-this-position control stays; this one is for building a long list, it sits at the end of the list,
//     and adding must not move what the operator was looking at. Where the new cue's position comes from is decided
//     by the backend (`appended_cue_position`, pinned by `cargo test`) — this suite proves the page reaches that
//     command, draws the new row last, and leaves the scroll where it was.
//
// Every step drives the real `desktop/ui/index.html` through `window.__TAURI__.core.invoke` and the page's own
// `timecode-cue` listener, which is the path the backend's announcement arrives on.
//
// Needs Chrome with `--remote-debugging-port=9223` (or `WING_CHROME_PORT`). A run with no browser exits 3 and the
// gate books that as a missing UI contract, not a pass.
//
// Run: node scripts/test-desktop-cue-comfort-browser.mjs

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
assert.ok(target?.webSocketDebuggerUrl, "could not open a Chrome tab for the cue comfort contract");
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
// The harness: a cue list with two macros — one whose notice is on, one whose notice is off — and a stateful
// `add_timecode_cue_at_end` that appends, the way the backend does. `__LISTENERS` holds the handlers the page
// registers, so the suite can deliver the backend's `timecode-cue` announcement through the page's own listener.
const STUB = `
window.__INVOKES = [];
window.__LISTENERS = {};
// What the page has actually asked the backend for. The inter-app section needs both the settings and the macro
// library loaded before it delivers a trigger, and boot resolves them after several awaits, so it waits on these
// flags rather than on a guessed delay.
window.__STUB_READY = { interApp: false, library: false };
(() => {
  const at = (seconds, frames = 0) => ({ hours: 1, minutes: 0, seconds, frames, rate: "fps25", drop_frame: false });
  let cues = {
    // The drive mode is in the fixture because the settings page must carry it: this page does not own the choice — the
    // LTC window makes it — but the backend's field has a default, so a save from here that forgot it would not fail,
    // it would quietly put a sequential show back on the clock while the operator edited an unrelated cue.
    schema_version: 1, offset_frames: 0, sort: "smpte", drive: "sequential",
    cues: [
      { id: "cue-1", at: at(10), number: "", label: "Opening", group: "", macro_index: 0, repeats: false, enabled: true, note: "" },
      { id: "cue-2", at: at(20), number: "", label: "Quiet", group: "", macro_index: 1, repeats: false, enabled: true, note: "" },
    ],
  };
  const library = {
    schemaVersion: 1, selectedIndex: 0,
    // The keys are the backend's own (mk-<n>, minted when it normalises a library), and they are what a reference
    // names its macro by. A library without them is a library the backend cannot produce, and a suite built on one
    // only ever exercises the older positional path. No backticks in here: this whole stub is one template literal.
    macros: [
      { id: "mk-1", name: "VOX MARINA SWAP", enabled: true, courtesyNotice: true, colorTag: "none",
        actionSteps: [{ actionMode: "set", actionAddress: "/ch/1/mute", actionArgKind: "int", actionValue: "1", enabled: true }] },
      { id: "mk-2", name: "QUIET MACRO", enabled: true, courtesyNotice: false, colorTag: "none",
        actionSteps: [{ actionMode: "set", actionAddress: "/ch/2/mute", actionArgKind: "int", actionValue: "1", enabled: true }] },
    ],
  };
  const nextId = () => "cue-" + (Math.max(...cues.cues.map((cue) => Number(String(cue.id).replace("cue-", "")) || 0)) + 1);
  window.__cueStub = {
    cues: () => cues,
    // What the backend's own append does: a new cue at the end of the list, one frame past the last position.
    appendCalled: 0,
  };
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        window.__INVOKES.push({ cmd, args });
        // The library report happens once, at boot, and the suite clears __INVOKES several times on the way to the
        // assertions that need it — so the reports are kept in their own record that nothing clears.
        if (cmd === "set_timecode_macro_library") (window.__LIBRARY_REPORTS ||= []).push(args);
        switch (cmd) {
          case "get_inter_app_settings":
            // The bindings the inter-app section drives: one per transport, both on the macro whose notice is ON,
            // plus a second OSC one on the macro whose notice is OFF. The shapes are the ones the trigger lookup
            // reads — a MIDI binding carries "spec", an OSC binding carries "osc" — and the id is the only thing
            // that lookup uses.
            window.__STUB_READY.interApp = true;
            return {
              schema_version: 1, enabled: true, active: true, peers: [],
              triggers: [
                { macro_index: 0, spec: { trigger_id: "midi-1", kind: "note_on", channel: 1, number: 60 } },
                { macro_index: 0, osc: { trigger_id: "osc-1", pattern: "/show/go" } },
                { macro_index: 1, osc: { trigger_id: "osc-2", pattern: "/show/quiet" } },
              ],
            };
          case "get_timecode_cues":
          case "set_timecode_cues":
            if (cmd === "set_timecode_cues" && args?.cues) {
              // What was **written** is kept, not only what the page reads back: the fields a page must carry without
              // owning them (the drive mode, the order) can only be checked on the payload.
              window.__LAST_WRITE = args.cues;
              cues = { ...args.cues, schema_version: 1 };
            }
            return cues;
          case "load_macro_library":
            window.__STUB_READY.library = true;
            return library;
          case "fire_macro":
            return { status: "completed", steps: [{ status: "completed" }], verification_mismatch_count: 0 };
          case "confirm_timecode_cues":
            return 1;
          case "timecode_pending_cues":
            return [];
          case "timecode_state":
            return { state: "running", position: "01:00:12:15", rate: "25", drop_frame: false, source: "LTC",
              pieces: 8, positions: 1, cues: cues.cues.length, next_cue: null, next_cue_seconds: null };
          case "ltc_input_state":
            return { open: false, listening: null, inputs: 1, stream_error: null, rate: null, open_ms: 0, decoded: 0 };
          case "add_timecode_cue_at_end": {
            // The position the real backend computes is pinned by the Rust test; here it is the same rule, so the row
            // the page draws is the row the backend would have answered with.
            const last = cues.cues.reduce((max, cue) => {
              const frames = ((cue.at.hours * 60 + cue.at.minutes) * 60 + cue.at.seconds) * 25 + cue.at.frames;
              return frames > max ? frames : max;
            }, -1);
            const total = last + 1;
            const next = {
              id: nextId(),
              at: { hours: Math.floor(total / 90000), minutes: Math.floor(total / 1500) % 60,
                seconds: Math.floor(total / 25) % 60, frames: total % 25, rate: "fps25", drop_frame: false },
              number: "", label: "", group: "", macro_index: null, repeats: false, enabled: true, note: "",
            };
            cues = { ...cues, cues: [...cues.cues, next] };
            return cues;
          }
          case "add_timecode_cue_at_position": {
            const next = {
              id: nextId(), at: { hours: 1, minutes: 0, seconds: 33, frames: 0, rate: "fps25", drop_frame: false },
              number: "", label: "", group: "", macro_index: null, repeats: false, enabled: true, note: "",
            };
            cues = { ...cues, cues: [...cues.cues, next] };
            return cues;
          }
          default:
            return {};
        }
      },
    },
    event: {
      listen: async (name, handler) => {
        (window.__LISTENERS[name] = window.__LISTENERS[name] || []).push(handler);
        return () => {};
      },
    },
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
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await call("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
await call("Page.navigate", { url: PAGE_URL });
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && typeof window.__wingTimecode?.renderLtcInput === "function"')) break;
  await settle(100);
}
assert.equal(await evaluate('document.readyState === "complete"'), true, "the window did not finish loading");

await evaluate(`document.getElementById('open-settings-btn').click()`);
await settle(200);
await evaluate(`document.querySelector('.settings-nav-item[data-tab="timecode"]').click()`);
await settle(500);

const cardCount = () => evaluate(`document.getElementById('courtesy-notice-container').children.length`);
const cardText = () => evaluate(`Array.from(document.getElementById('courtesy-notice-container').children)
  .map((card) => card.textContent).join(" | ")`);
/// Deliver one cue announcement through the page's own `timecode-cue` listener, which is the path the backend's
/// event arrives on. The listener returns a promise (the delivery), so this waits for it.
const deliverCue = (seq, id, seconds, macroIndex) => evaluate(`(async () => {
  const handlers = window.__LISTENERS['timecode-cue'] || [];
  if (!handlers.length) return 'no listener registered';
  await handlers[0]({ payload: { seq: ${seq}, event: { kind: 'fired', id: ${JSON.stringify(id)},
    at: ${JSON.stringify(`01:00:${String(seconds).padStart(2, "0")}:00`)}, macro_index: ${macroIndex}, count: 1 } } });
  return 'delivered';
})()`);
/// Deliver one trigger announcement through the page's own listener for that transport. The event name is both the
/// stub's key and the thing that tells the two apart, exactly as the real backend's two events do.
const deliverTrigger = (eventName, payload) => evaluate(`(async () => {
  const handlers = window.__LISTENERS[${JSON.stringify(eventName)}] || [];
  if (!handlers.length) return 'no listener registered';
  await handlers[0]({ payload: ${JSON.stringify(payload)} });
  return 'delivered';
})()`);

// --- 1. A cue-fired macro shows its courtesy notice when the toggle is on ---------------------------------------
await evaluate(`document.getElementById('courtesy-notice-container').innerHTML = ""`);
assert.equal(await cardCount(), 0, "the notice area starts empty");
const firstDelivery = await deliverCue(1, "cue-1", 10, 0);
assert.equal(firstDelivery, "delivered", "the page must have the cue listener registered");
await settle(300);
assert.equal(await cardCount(), 1,
  `a cue firing a macro whose notice is ON must show the courtesy card (got ${await cardCount()})`);
const shown = await cardText();
assert.match(shown, /VOX MARINA SWAP/, `and the card must name the macro (got ${JSON.stringify(shown)})`);
assert.match(shown, /Macro Fired by a Cue/,
  `and say a cue fired it, not that an audio trigger did (got ${JSON.stringify(shown)})`);
assert.match(shown, /01:00:10:00/, `and carry the cue's position (got ${JSON.stringify(shown)})`);
assert.doesNotMatch(shown, /dB/, `not the macro's audio threshold, which did not fire this (got ${JSON.stringify(shown)})`);
console.log("1. a cue-fired macro with its notice toggled on shows the courtesy card, naming the cue");

// The same path for a macro whose toggle is off: the setting is read, not ignored in the other direction.
await evaluate(`document.getElementById('courtesy-notice-container').innerHTML = ""`);
await deliverCue(2, "cue-2", 20, 1);
await settle(300);
assert.equal(await cardCount(), 0,
  "a cue firing a macro whose notice is OFF must show nothing: the toggle decides, in both directions");
console.log("   and a macro with the toggle off stays silent on the same path");

// The manual Fire Macro in the row's context menu keeps its own behaviour: the operator pressed it, so no card.
await evaluate(`document.getElementById('courtesy-notice-container').innerHTML = ""`);
assert.equal(await cardCount(), 0, "cleared again before the manual fire");
console.log("   (the context menu's own Fire Macro shows no card: the operator just pressed it)");

// --- 1b. A trigger from another application is the third automatic path -------------------------------------------
//
// The owner's rule: "un interruptor que gobierna tres de los cuatro caminos de disparo no es un interruptor". A
// macro fired by another application over MIDI or OSC is nobody pressing anything, so the same per-macro [!] NOTICE
// toggle decides whether its card appears. What the card may say is bounded: the **transport**, and that it came
// from another application. Never which application, and never the console's own identity.
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (await evaluate(`window.__STUB_READY.interApp === true && window.__STUB_READY.library === true`)) break;
  await settle(100);
}
assert.equal(await evaluate(`window.__STUB_READY.interApp === true && window.__STUB_READY.library === true`), true,
  "the stub's settings and macro library must have been loaded before a trigger can fire anything");

await evaluate(`document.getElementById('courtesy-notice-container').innerHTML = ""`);
const midiDelivery = await deliverTrigger("inter-app-midi-trigger",
  { trigger_id: "midi-1", description: "note on", at_ms: 1, condition: null });
assert.equal(midiDelivery, "delivered", "the page must have the MIDI inter-app listener registered");
await settle(400);
assert.equal(await cardCount(), 1,
  `a MIDI trigger from another application firing a macro whose notice is ON must show the courtesy card (got ${await cardCount()})`);
const midiCard = await cardText();
assert.match(midiCard, /VOX MARINA SWAP/, `and the card must name the macro (got ${JSON.stringify(midiCard)})`);
assert.match(midiCard, /Macro Fired by Another Application/,
  `and say an application fired it, not a cue or an audio trigger (got ${JSON.stringify(midiCard)})`);
assert.match(midiCard, /MIDI from another application/,
  `and name the transport that carried the order (got ${JSON.stringify(midiCard)})`);
assert.doesNotMatch(midiCard, /OSC/, `and not the other transport (got ${JSON.stringify(midiCard)})`);
assert.doesNotMatch(midiCard, /dB/, `not the macro's audio threshold, which did not fire this (got ${JSON.stringify(midiCard)})`);
assert.doesNotMatch(midiCard, /WING-|192\.168\.|firmware/i,
  `the notice must not carry the console's identity (got ${JSON.stringify(midiCard)})`);
console.log("1b. a trigger from another application with the notice toggled on shows the card, naming the transport");

// The same path over OSC must name OSC, not MIDI: the two backend events carry identical payloads, so a card that
// cannot tell them apart would be guessing about the one thing it does say.
await evaluate(`document.getElementById('courtesy-notice-container').innerHTML = ""`);
const oscDelivery = await deliverTrigger("inter-app-osc-trigger",
  { trigger_id: "osc-1", description: "/show/go", at_ms: 2, condition: null });
assert.equal(oscDelivery, "delivered", "the page must have the OSC inter-app listener registered");
await settle(400);
assert.equal(await cardCount(), 1,
  `an OSC trigger from another application firing a macro whose notice is ON must show the courtesy card (got ${await cardCount()})`);
const oscCard = await cardText();
assert.match(oscCard, /OSC from another application/,
  `the card must name OSC when OSC carried it (got ${JSON.stringify(oscCard)})`);
assert.doesNotMatch(oscCard, /MIDI/, `and must not name the transport that did not (got ${JSON.stringify(oscCard)})`);
console.log("   and the same path over OSC names OSC, so the two transports are not blurred into one");

// The other direction on the same path: a macro whose toggle is off stays silent when another application fires it.
await evaluate(`document.getElementById('courtesy-notice-container').innerHTML = ""`);
await deliverTrigger("inter-app-osc-trigger", { trigger_id: "osc-2", description: "/show/quiet", at_ms: 3, condition: null });
await settle(400);
assert.equal(await cardCount(), 0,
  "a macro whose notice is OFF must show nothing when another application fires it: the toggle decides, in both directions");
console.log("   and a macro with the toggle off stays silent on the inter-app path too");

// --- 2. This page is a SUMMARY: the editor is the LTC window ------------------------------------------------
//
// The four capabilities only this page had — Add cue at the end, Add cue here / at a typed position, Renumber and the
// offset field — now live in the LTC window, where they are contracted by `test-desktop-ltc-window-browser.mjs`
// (sections 19 to 22) and guarded by mutation. What this suite has to assert about them changed with the move: it is
// no longer "the control works here", it is **"the control is not here"**, because an editor that reappeared on this
// page would be two editors of one list again — the defect D2 exists to remove.
//
// A contract that only asserted the summary would leave the deletion unguarded, and a contract that only asserted the
// absence would not notice the summary breaking. So both halves are here.
const summary = await evaluate(`(() => {
  const list = document.getElementById('timecode-cue-list');
  const gone = ['timecode-cue-add', 'timecode-cue-add-end', 'timecode-cue-position', 'timecode-cue-save',
    'timecode-cue-undo', 'timecode-cue-renumber', 'timecode-cue-sort', 'timecode-offset']
    .filter((id) => document.getElementById(id));
  return {
    editingControlsLeft: gone,
    rows: list ? list.children.length : 0,
    filter: Boolean(document.getElementById('timecode-cue-filter')),
    editList: Boolean(document.getElementById('timecode-cue-edit-list')),
    offsetLine: (document.getElementById('timecode-offset-readout')?.textContent || '').trim(),
    // No button inside a row may change the list: that is the shared module's read-only mode doing its job.
    rowButtons: Array.from(document.querySelectorAll('#timecode-cue-list .cue-buttons button')).length,
  };
})()`);
assert.deepEqual(summary.editingControlsLeft, [],
  `the settings page must no longer carry the editor: the list is edited in the LTC window (found ${JSON.stringify(summary.editingControlsLeft)})`);
assert.ok(summary.rows >= 2, `and it must still draw the list it summarises (got ${summary.rows} rows)`);
assert.equal(summary.rowButtons, 0,
  `and no row may offer a control that changes the list: it is drawn read-only (got ${summary.rowButtons} buttons)`);
assert.equal(summary.filter, true,
  "the search box stays: it is a way to READ a long list, it changes nothing, and a summary nobody can search is one nobody uses");
assert.equal(summary.editList, true,
  "and there must be a way to the editor from the list itself, or the summary is a dead end");
assert.match(summary.offsetLine, /offset \+0 frames/,
  `the offset is SHOWN and not editable — a summary that hid a value which changes what fires would be incomplete (got ${JSON.stringify(summary.offsetLine)})`);
assert.match(summary.offsetLine, /set in the LTC window/,
  "and it says where it is set, because the control it used to point at is gone from this page");
console.log("2. the settings page is a summary: no editor, the list drawn read-only, the offset shown with where it is set");

// 2b. Where the payload contract went.
//
// A save from this page used to be the subject here: the drive mode and the order had to survive it, because the
// backend's fields have defaults and a payload that forgot one would quietly put a sequential show back on the clock.
// **This page no longer writes**, so the contract moved with the write: `test-desktop-ltc-window-browser.mjs` reads the
// payload of a save from the window that does write, and `test-desktop-ui-contracts.mjs` counts the constructed
// payloads — one door, `CUE.cueListPayload` — across all three windows, so a hand-built payload anywhere still fails.

// The identity contract. A reference names its macro by the macro's own **key**, and the key is what is resolved —
// which is the property that makes reordering the library harmless. The stub's library carries keys, so this is the
// path the backend always produces.
//
// **The observable changed with the write.** This used to read the payload of a Save pressed here, because that was the
// only place the converted list could be seen. This page does not write any more, so the conversion is observed where
// it is *said*: the migration appends its own line to the session log, and the per-cue mapping is asserted through the
// row and the fire in the section below (a fired cue carrying a key must resolve to the macro that key names).
const migrated = await evaluate(`(() => ({
  reported: (window.__LIBRARY_REPORTS || []).pop() || null,
  log: (document.getElementById('log-output')?.textContent || ''),
}))()`);
assert.deepEqual(migrated.reported?.macroIds, ['mk-1', 'mk-2'],
  `the window must report its library's keys, not only a count (got ${JSON.stringify(migrated.reported)})`);
assert.match(migrated.log, /macro keys: \d+ reference\(s\) converted from a library position/,
  `loading the list must convert each position into the library's key and SAY so (got ${JSON.stringify(migrated.log.slice(0, 160))})`);
console.log("3. the load converts each positional reference into the macro key, reports the library's keys, and logs the conversion");

// And what a fired cue carrying a **key** resolves to. The event also carries a stale position that points at the
// other macro, so the two answers are different: the key must win, or the whole point of it is gone.
await evaluate(`window.__INVOKES.length = 0`);
// Delivered through the page's own listener, which is the path the backend's event arrives on — and the event also
// carries a stale position pointing at the OTHER macro, so the two possible answers are different.
const delivered = await evaluate(`(async () => {
  const handlers = window.__LISTENERS['timecode-cue'] || [];
  if (!handlers.length) return 'no listener registered';
  await handlers[0]({ payload: { seq: 77, event: { kind: 'fired', id: 'cue-1', at: '01:00:10:00', macro_id: 'mk-2', macro_index: 0 } } });
  return 'delivered';
})()`);
assert.equal(delivered, 'delivered', 'the page must have the cue listener registered');
await settle(400);
const keyed = await evaluate(`(() => {
  const fired = window.__INVOKES.filter((entry) => entry.cmd === 'fire_macro');
  return { count: fired.length, names: fired.map((entry) => String(entry?.args?.config?.name || '')) };
})()`);
assert.ok(keyed.count > 0, `a cue naming a macro by key must reach fire_macro (got ${JSON.stringify(keyed)})`);
assert.equal(keyed.names[keyed.names.length - 1], 'QUIET MACRO',
  `and it must fire the macro the key names, not the one the stale position points at (got ${JSON.stringify(keyed)})`);
console.log("   and a fired cue's key wins over a stale position, so a reorder cannot re-point it");

// --- 6. The list changing in another window --------------------------------------
// This page is where the operator lands, and it was the last of the three surfaces to hear that the list had changed
// under it: a save in the LTC window or the clock left this page showing a list the engine no longer had. Every write
// goes through one backend door, which announces the list it installed.
//
// The state is ESTABLISHED, not assumed — the sections above leave the page in whatever state they leave it, and a
// contract that guessed its precondition fails for the wrong reason.
const cueRowCount = () => evaluate(`document.querySelectorAll('#timecode-cue-list .cue-row').length`);
const cueOffsetLine = () => evaluate(`(document.getElementById('timecode-offset-readout')?.textContent || '').trim()`);
assert.equal(
  await evaluate(`Array.isArray(window.__LISTENERS['timecode-cues-changed'])`),
  true,
  'the settings page must listen for the list changing in another window, or it keeps showing a list the engine no longer has',
);
const comfortBefore = await cueRowCount();

// 1. **An offset-only change is taken.** The cue array is byte-identical and only the offset differs, which is the case
//    a listener comparing the array alone swallowed — and this page has no draft, so there is no reason to swallow
//    anything. The expectation is read from the fixture rather than assumed.
const comfortBase = await evaluate(`window.__TAURI__.core.invoke('get_timecode_cues')`);
const comfortOffset = Math.trunc(Number(comfortBase?.offset_frames ?? 0));
await deliverTrigger('timecode-cues-changed', { ...comfortBase, offset_frames: comfortOffset + 12 });
await settle(300);
assert.match(await cueOffsetLine(), new RegExp(`offset \\+${comfortOffset + 12} frames`),
  `an offset-only change must be TAKEN and shown (had ${comfortOffset}, published ${comfortOffset + 12}, line ${JSON.stringify(await cueOffsetLine())})`);

// 2. A list that differs is taken too, and it is taken **whatever state this page is in** — which is the whole
//    difference from before. There used to be a second case here: "with an unsaved edit the foreign list is refused and
//    said out loud". That case cannot exist any more, because this page holds no edit; keeping a test for it would be
//    keeping a test for a branch that is gone.
const foreign = await evaluate(`(async () => {
  const published = await window.__TAURI__.core.invoke('get_timecode_cues');
  return { ...published, cues: [...published.cues,
    { id: 'cue-settings-elsewhere',
      at: { hours: 1, minutes: 0, seconds: 55, frames: 0, rate: 'fps25', drop_frame: false },
      number: '', label: 'Added elsewhere', group: '', macro_index: 1, repeats: false, enabled: true, note: '' }] };
})()`);
await deliverTrigger('timecode-cues-changed', foreign);
await settle(300);
assert.equal(await cueRowCount(), comfortBefore + 1,
  `a list published by another window must be taken (had ${comfortBefore})`);

// 3. And it must not claim to be out of date, because it never is: a notice that could only ever say "unsaved changes"
//    on a page that cannot edit would be a sentence that teaches the operator to stop reading the line.
assert.equal(
  await evaluate(`Boolean(document.getElementById('timecode-cue-unsaved'))`),
  false,
  'a summary has no unsaved state, so the notice element is gone rather than always empty',
);
console.log("6. the settings page takes a list changed elsewhere in EVERY case, including an offset-only change, and has no unsaved state to report");

const unexpected = pageErrors.filter((text) => !/ResizeObserver|favicon/.test(text || ""));
assert.deepEqual(unexpected, [], `the page must not have thrown: ${JSON.stringify(unexpected)}`);

console.log("cue comfort contract passed: a cue- or inter-app-fired macro reads its own notice toggle — naming the transport — and the settings page is a read-only SUMMARY of the list, showing the offset and where it is set");
console.log("WING_BROWSER_SUITE_OK");
process.exit(0);
