// The LTC window's contracts: it reads the list, edits it through the same shared rules the settings page uses, and —
// the one that matters most — **it never fires a macro**.
//
// The split is deliberate. Running a macro and answering the engine for it belong to the main window, which is the one
// that fires and confirms; a second window doing either would run every cue twice. This suite pins that by pushing an
// engine event at this window's own listener and then asserting that `fire_macro` and `confirm_timecode_cues` were
// never reached — a contract about *absence*, which is exactly the kind that rots if nobody tests it.
//
// The rules it checks are shared (`desktop/ui/cue-list.js`), so what is measured here is the window's wiring: the dense
// row writes through those rules, Save posts the payload those rules build, and Live hides the editing tools.
//
// Run: node scripts/test-desktop-ltc-window-browser.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import WebSocket from "ws";

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
const PAGE_URL = new URL("../desktop/ui/ltc.html", import.meta.url).href;

const pages = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`, { signal: AbortSignal.timeout(2000) })
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);
if (!pages) {
  console.log(`SKIP: no Chrome remote debugging on port ${DEBUG_PORT}`);
  process.exit(3);
}

const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })).json();
assert.ok(target?.webSocketDebuggerUrl, "could not open a Chrome tab for the LTC window contract");
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
// The backend, as this window sees it: a two-cue list, a two-macro library, a running clock and one cue that cannot
// fire. `fire_macro` and `confirm_timecode_cues` are recorded **so that the absence of a call can be asserted**.
const STUB = `
window.__INVOKES = [];
window.__LISTENERS = {};
// The stub's own state lives in a closure: a top-level "let cues" here would collide with the page's own, and the
// second declaration is a SyntaxError that kills the whole inline script before its first invoke. No backticks in
// any comment inside this stub: it is one template literal.
(() => {
const at = (seconds, frames) => ({ hours: 1, minutes: 0, seconds, frames, rate: "fps25", drop_frame: false });
let cues = {
  // A non-zero offset on purpose: the window carries this value in every save without owning the control for it, so the
  // contract that it **shows** what it writes needs a value worth showing.
  schema_version: 1, offset_frames: 3, sort: "smpte",
  cues: [
    { id: "cue-1", number: "1", label: "Opening", group: "", at: at(10, 0), macro_id: "mk-2", macro_index: null, repeats: false, enabled: true, note: "" },
    { id: "cue-2", number: "2", label: "Parked", group: "", at: at(20, 0), macro_id: null, macro_index: null, repeats: false, enabled: false, note: "" },
    // A cue written before the three repeat policies existed: it carries the old boolean and no policy, which is what
    // the window has to read the same way the engine does.
    { id: "cue-3", number: "3", label: "Siren", group: "", at: at(30, 0), macro_id: "mk-1", macro_index: null, repeats: true, repeat: null, enabled: true, note: "" },
    // A fourth cue that is never selected, so "the shift moved the selection" can be told from "the shift moved
    // everything" — which is the assertion with teeth in the bulk-shift contract.
    { id: "cue-4", number: "4", label: "Encore", group: "", at: at(40, 0), macro_id: "mk-1", macro_index: null, repeats: false, enabled: true, note: "" },
  ],
};
// The engine's own state: the drive mode it was last given with a save, and how many cues its Go has fired.
let drive = "timecode";
let stepped = null;
// Monitor versus Armed, and the plan a rehearsal produces. The plan is a **fixture** here on purpose: what the engine
// does with a rehearsal is a Rust contract (the same plan as the show, and nothing in the delivery ledger); what this
// suite checks is that a window paints what the snapshot reports and never fires while it says Monitor.
let rehearsing = false;
let plan = [];
// Which cues the backend says name a macro whose content has moved since. One helper, so the contract can drive both
// directions — reported, and nothing to judge — without a second fixture.
let changed = {};
window.__SET_CHANGED = (id) => {
  changed = id ? { [String(id)]: true } : {};
  return "set";
};
const library = {  schemaVersion: 1, selectedIndex: 0,
  macros: [
    { id: "mk-1", name: "NOTHING TO SEND", enabled: true, actionSteps: [] },
    { id: "mk-2", name: "OPEN THE SHOW", enabled: true,
      actionSteps: [{ actionMode: "set", actionAddress: "/ch/1/mute", actionArgKind: "int", actionValue: "1", enabled: true }] },
  ],
};
window.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      window.__INVOKES.push({ cmd, args });
      switch (cmd) {
        case "get_timecode_cues": return cues;
        case "set_timecode_cues": cues = { ...args.cues, schema_version: 1 }; drive = cues.drive || "timecode"; return cues;
        case "load_macro_library": return library;
        case "set_timecode_rehearsal": {
          rehearsing = Boolean(args?.rehearsing);
          if (args?.clearPlan) plan = [];
          else if (rehearsing) plan = [
            { seq: 1, kind: "fired", id: "cue-1", at: "01:00:10:00", position: "01:00:10:02", delta_frames: 2 },
            { seq: 2, kind: "skipped", id: "cue-2", at: "01:00:20:00", position: "01:00:30:00", delta_frames: null },
          ];
          return rehearsing;
        }
        // The engine's Go: it fires the next cue **once**, and then the list is at its end — which is the state the
        // window has to be able to say out loud rather than leaving a control that looks broken.
        case "timecode_sequential_go": {
          if (stepped !== null) return 0;
          stepped = cues.cues[0] ? cues.cues[0].id : null;
          return stepped ? 1 : 0;
        }
        case "add_timecode_cue_at_end": {
          const last = cues.cues.reduce((max, cue) => {
            const frames = ((cue.at.hours * 60 + cue.at.minutes) * 60 + cue.at.seconds) * 25 + cue.at.frames;
            return Math.max(max, frames);
          }, 0);
          cues = { ...cues, cues: [...cues.cues, {
            id: "cue-" + (cues.cues.length + 1), number: "", label: "", group: "",
            at: { ...at(0, 0), seconds: Math.floor((last + 1) / 25) % 60, frames: (last + 1) % 25 },
            macro_id: null, macro_index: null, repeats: false, enabled: true, note: "" }] };
          return cues;
        }
        case "add_timecode_cue_from_position": return cues;
        // The typed door: the window sends the position it was given, and what it does with the answer is the same as
        // the other add — so the stub answers the list it has, exactly as the backend answers the list it installed.
        case "add_timecode_cue_at_position":
          // The parser is the backend own, and its refusal is a sentence the window shows unchanged. The fault has to
          // be raisable from the contract, or the refusal path is the one that never runs.
          if (window.__FAULT_ADD) throw new Error(window.__FAULT_ADD);
          return cues;
        case "timecode_state":
          // The engine's own record of what it has already fired travels in the snapshot, and the next poll repaints the
          // marks from it. A stub that omitted it would show a mark for a moment and then wipe it — which is the stub
          // lying, not the window losing it.
          return { state: "running", position: "01:00:12:15", rate: "25", drop_frame: false, source: "LTC",
            pieces: 8, positions: 2, freewheel_ms: 750, freewheel_remaining_ms: 600,
            cues: cues.cues.length, next_cue: "01:00:10:00", next_cue_id: "cue-1", next_cue_seconds: 2.4,
            // The sequence as the **engine** reports it: a window opened halfway through a rehearsal reads it here.
            drive,
            sequential_started: drive === "sequential" && stepped !== null,
            sequential_due: "01:00:15:00",
            sequential_next_id: stepped === null ? "cue-1" : null,
            sequential_at_end: stepped !== null,
            rehearsing,
            rehearsal_plan: rehearsing ? plan : [],
            spent_ids: window.__FIRED || [],
            spent_cues: (window.__FIRED || []).map((id) => ({ id, kind: "fired" })),
            // The backend describes **every** cue, with problem: null for a healthy one (cue_health maps over the
            // list — measured), and a window reads a cue the health does not describe as *unknown*, not as fine. The
            // fixture used to describe one cue of three, which would have made two healthy rows look unjudged.
            cue_health: [
              { id: "cue-1", problem: null, macro_id: "mk-2", macro_index: null, macro_changed: changed["cue-1"] ?? null },
              { id: "cue-2", problem: "no_macro", macro_id: null, macro_index: null, macro_changed: null },
              { id: "cue-3", problem: null, macro_id: "mk-1", macro_index: null, macro_changed: changed["cue-3"] ?? null },
              { id: "cue-4", problem: null, macro_id: "mk-1", macro_index: null, macro_changed: changed["cue-4"] ?? null },
            ],
            cues_broken: 1, macro_library_len: 2 };
        case "timecode_pending_cues": return [];
        // **The record, with the one case the ENGINE cannot produce today and the view must still word.**
        // A "fired" line has no verdict, and so may a skip whose verdict was never measured ("across_silence: null")
        // - a hand-edited file, or a schema that grows a field. The other two are the measured pair this whole body of
        // work exists to separate.
        case "timecode_as_run": return [
          { seq: 1, id: "cue-1", number: "1", at: "01:00:10:00", spent: "fired", wall_ms: 1, outcome: null, across_silence: null, jumped_ms: null },
          { seq: 2, id: "cue-2", number: "2", at: "01:00:20:00", spent: "skipped", wall_ms: 2, outcome: null, across_silence: false, jumped_ms: 3200 },
          { seq: 3, id: "cue-3", number: "3", at: "01:00:30:00", spent: "skipped", wall_ms: 3, outcome: null, across_silence: true, jumped_ms: 1200, arrival_gap_ms: 1200 },
          { seq: 4, id: "cue-4", number: "4", at: "01:00:40:00", spent: "skipped", wall_ms: 4, outcome: null, across_silence: null, jumped_ms: 900 },
        ];
        // Recorded, never expected: the assertions below are about these NOT being called.
        case "fire_macro": return { status: "completed", steps: [] };
        case "confirm_timecode_cues": return 1;
        default: return {};
      }
    },
  },
  event: {
    listen: async (name, handler) => {
      (window.__LISTENERS[name] ||= []).push(handler);
      return () => {};
    },
  },
};
})();
`;

await call("Page.enable");
// Pin the native opening size; do not inherit the preceding suite's clock viewport.
await call("Emulation.setDeviceMetricsOverride", { width: 1180, height: 760, deviceScaleFactor: 1, mobile: false });
await call("Runtime.enable");
// Live is remembered between openings, which is right for the operator and wrong for this suite: a run that failed
// while Live was on left it on, so the next run failed at its first assertion for a reason that had nothing to do with
// its mutation. Each run therefore starts from "Live off", whatever the last one left in this browser profile.
await call("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.removeItem("wing_ltc_live"); } catch (_) {}` });
await call("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
await call("Page.navigate", { url: PAGE_URL });
await settle(900);

const waitFor = async (expression, what, tries = 40) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await evaluate(expression)) return true;
    await settle(150);
  }
  throw new Error(`timed out waiting for ${what}`);
};

// --- 1. The window paints the list and the clock it was opened for ----------------------------------------------
await waitFor(`document.querySelectorAll('#rows .cue-row').length === 4`, "the four cues to be drawn");
const painted = await evaluate(`(() => {
  const position = document.getElementById('position');
  return {
    rows: document.querySelectorAll('#rows .cue-row').length,
    position: position.textContent.trim(),
    positionFits: position.scrollWidth <= position.clientWidth + 1,
    state: document.getElementById('state').textContent.trim(),
    rate: document.getElementById('rate').textContent.trim(),
    window: document.getElementById('window').textContent.trim(),
    next: document.getElementById('next').textContent.trim(),
    lastFact: getComputedStyle(document.querySelector('.facts .live-fact')).display,
  };
})()`);
assert.equal(painted.rows, 4, `the whole list is drawn (got ${JSON.stringify(painted)})`);
assert.equal(painted.position, "01:00:12:15", `the clock shows the position the backend answered (got ${JSON.stringify(painted.position)})`);
assert.equal(painted.positionFits, true,
  `the SMPTE readout must fit inside its own well, not lose its last frame digit to a squeezed flex column (got ${JSON.stringify(painted)})`);
assert.equal(painted.lastFact, "none",
  `the last-fired fact belongs to Live; before Live the header has no empty "last" readout (got ${JSON.stringify(painted.lastFact)})`);
assert.match(painted.state, /Running · LTC · 25 fps/,
  `the state sentence is the shared one both other surfaces show (got ${JSON.stringify(painted.state)})`);
assert.equal(painted.rate, "25 fps", `the frame rate in use is named (got ${JSON.stringify(painted.rate)})`);
assert.equal(painted.window, "0.75 s", `the freewheel window the backend reported is named (got ${JSON.stringify(painted.window)})`);
assert.match(painted.next, /01:00:10:00 in 2\.4 s/,
  `and the next cue with its countdown (got ${JSON.stringify(painted.next)})`);
console.log("1. the LTC window paints the list, the clock, the rate and the freewheel window");

// --- 2. The inspector explains a selected cue with the shared chain ---------------------------------------------
await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="cue-2"]').click()`);
await settle(200);
const inspector = await evaluate(`(() => ({
  marks: Array.from(document.querySelectorAll('#inspector-body .chain-mark')).map((node) => node.textContent.trim()),
  labels: Array.from(document.querySelectorAll('#inspector-body .chain-row')).map((node) => node.textContent.trim()),
  why: document.querySelector('#inspector-body .why')?.textContent.trim() || '',
}))()`);
assert.equal(inspector.marks.length, 6, `the chain has every link of the shared rule (got ${JSON.stringify(inspector.marks)})`);
assert.ok(inspector.marks.includes("ok"), `with the links that are fine marked (got ${JSON.stringify(inspector.marks)})`);
assert.equal(inspector.marks.filter((mark) => mark === "NO").length, 2,
  `and **both** failures this cue has marked — it is parked and it names no macro — where one reason could hold only one (got ${JSON.stringify(inspector.marks)})`);
assert.match(inspector.why, /the cue is parked/,
  `and the sentence names the first link that is known to be broken, in the chain's own order (got ${JSON.stringify(inspector.why)})`);
assert.ok(inspector.labels.some((line) => line.includes("timecode running")),
  `the inspector names the links rather than showing colours alone (got ${JSON.stringify(inspector.labels)})`);
assert.ok(inspector.labels.some((line) => line.includes("macro chosen and present")),
  `including the second failure, which is not the one the sentence leads with (got ${JSON.stringify(inspector.labels)})`);
console.log("2. the inspector shows the shared chain for the selected cue, naming its first failure and marking both");

// --- 3. The dense row writes through the shared rules, and Save posts what those rules build --------------------
await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row[data-cue-id="cue-1"]');
  const time = row.querySelector('.dense-time');
  time.value = '01:00:33:00';
  time.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await settle(200);
const afterEdit = await evaluate(`(() => ({
  saveClass: document.getElementById('save').className,
  status: document.getElementById('status').textContent.trim(),
}))()`);
assert.match(afterEdit.saveClass, /is-unsaved/,
  `editing a time must mark the list unsaved (got ${JSON.stringify(afterEdit.saveClass)})`);
assert.match(afterEdit.status, /Unsaved changes/,
  `and the window must say so where the operator reads (got ${JSON.stringify(afterEdit.status)})`);

await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.getElementById('save').click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, "the save to reach the backend");
const written = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  return call?.args?.cues || null;
})()`);
assert.equal(written?.sort, "smpte", `the payload carries the order, or the backend would reset it (got ${JSON.stringify(written?.sort)})`);
assert.equal(written?.schema_version, 1, `and the schema version the file is written with (got ${JSON.stringify(written?.schema_version)})`);
assert.equal(written?.cues?.[0]?.at?.seconds, 33, `and the edited time (got ${JSON.stringify(written?.cues?.[0]?.at)})`);
assert.equal(written?.cues?.[0]?.macro_id, "mk-2",
  `and the macro is still named by its own key, not by a position (got ${JSON.stringify(written?.cues?.[0]?.macro_id)})`);
console.log("3. the dense row marks the list unsaved, and Save posts the payload the shared rules build");

// --- 4. Live hides the tools that change the list, and keeps what a show is read from ---------------------------
const beforeLive = await evaluate(`(() => ({

  addEnd: (document.getElementById('add-end') ? getComputedStyle(document.getElementById('add-end')).display : 'missing'),
  save: (document.getElementById('save') ? getComputedStyle(document.getElementById('save')).display : 'missing'),
  live: document.getElementById('live').getAttribute('aria-pressed'),
}))()`);
assert.notEqual(beforeLive.addEnd, "none", `editing tools are on screen before Live (got ${JSON.stringify(beforeLive.addEnd)})`);
await evaluate(`document.getElementById('live').click()`);
await settle(200);
const inLive = await evaluate(`(() => ({

  addEnd: (document.getElementById('add-end') ? getComputedStyle(document.getElementById('add-end')).display : 'missing'),
  capture: (document.getElementById('capture') ? getComputedStyle(document.getElementById('capture')).display : 'missing'),
  save: (document.getElementById('save') ? getComputedStyle(document.getElementById('save')).display : 'missing'),
  clock: (document.getElementById('position') ? getComputedStyle(document.getElementById('position')).display : 'missing'),
  inspector: (document.getElementById('inspector') ? getComputedStyle(document.getElementById('inspector')).display : 'missing'),
  lastFact: getComputedStyle(document.querySelector('.facts .live-fact')).display,
  pressed: document.getElementById('live').getAttribute('aria-pressed'),
}))()`);
assert.equal(inLive.addEnd, "none", `Live hides the add control (got ${JSON.stringify(inLive.addEnd)})`);
assert.equal(inLive.capture, "none", `and the capture control (got ${JSON.stringify(inLive.capture)})`);
assert.equal(inLive.save, "none", `and Save, which re-arms the engine (got ${JSON.stringify(inLive.save)})`);
// Every control that changes the list, including the ones added later: Renumber, the typed-position field and the
// button beside it, and the offset. A field left standing beside a hidden button is a control with nothing to press,
// which is how the first version of the typed add was written — the field had no `edit-only`.
//
// **Measured by whether anything is actually painted, not by computed `display`.** A hidden ANCESTOR does not change a
// descendant's computed `display` — the child simply is not rendered — so `getComputedStyle(...).display` answers
// "inline-block" for a button inside a hidden bar and a contract built on it fails for the wrong reason. That is what
// the first version of this check did.
const addedLater = await evaluate(`(() => {

  const painted = (element) => Boolean(element) && element.getClientRects().length > 0;
  const states = {
    renumber: painted(document.getElementById('renumber')),
    addAt: painted(document.getElementById('add-at')),
    addPosition: painted(document.querySelector('.add-position')),
    offset: painted(document.getElementById('offset')),
    offsetLabel: painted(document.querySelector('.offset-field')),
    // The drive is the control this fix was really about: it is in the header, it saves and re-arms, and it was
    // reachable from Live mode because "edit-only" only applied inside the footer.
    drive: painted(document.getElementById('drive')),
  };
  return Object.fromEntries(Object.entries(states).map(([key, value]) => [key, value ? 'painted' : 'hidden']));
})()`);
for (const [what, value] of Object.entries(addedLater)) {
  assert.equal(value, "hidden",
    `Live must hide ${what} too: it changes the list, and the tools that change the list are what Live puts away (got ${JSON.stringify(value)})`);
}
assert.notEqual(inLive.clock, "none", `and keeps the clock, which is what Live is for (got ${JSON.stringify(inLive.clock)})`);
assert.notEqual(inLive.inspector, "none", `and the inspector that explains a cue (got ${JSON.stringify(inLive.inspector)})`);
assert.equal(inLive.lastFact, "flex",
  `and the last-fired fact it exists for is shown now (got ${JSON.stringify(inLive.lastFact)})`);
assert.equal(inLive.pressed, "true", `and the button says it is on (got ${JSON.stringify(inLive.pressed)})`);
await evaluate(`document.getElementById('live').click()`);
console.log("4. Live hides the editing tools and keeps the clock and the inspector");

// --- 5. The one that matters: this window never fires a macro, and never answers for one -------------------------
await evaluate(`window.__INVOKES.length = 0`);
// The engine records the order before it announces it, and the snapshot carries that record — so the mark this window
// paints is also the one the next poll repaints. Setting it here is what the backend would have done.
await evaluate(`window.__FIRED = ['cue-1']`);
const delivered = await evaluate(`(async () => {
  const handlers = window.__LISTENERS['timecode-cue'] || [];
  if (!handlers.length) return 'no listener registered';
  await handlers[0]({ payload: { seq: 5, event: { kind: 'fired', id: 'cue-1', at: '01:00:10:00', macro_id: 'mk-2', macro_index: null } } });
  return 'delivered';
})()`);
assert.equal(delivered, "delivered", "this window must hear the engine so it can paint what ran");
await settle(400);
const engineCalls = await evaluate(`window.__INVOKES.filter((entry) => entry.cmd === 'fire_macro' || entry.cmd === 'confirm_timecode_cues').map((entry) => entry.cmd)`);
assert.deepEqual(engineCalls, [],
  `THE DIVISION: this window must never fire a macro nor answer for one, because the main window does (it called ${JSON.stringify(engineCalls)})`);
const marked = await evaluate(`Boolean(document.querySelector('#rows .cue-row[data-cue-id="cue-1"] .cue-tag.is-fired'))`);
assert.equal(marked, true, "and it must paint the mark, which is the half it does own");
console.log("5. the LTC window paints the engine's orders and never fires or confirms one");

// --- 6. The three repeat policies, one of them read from the older flag -----------------------------------------
//
// One boolean forced an operator to guess which of three behaviours he would get, and this row now says which. The
// third cue carries the old flag and no policy: the window must read it the way the engine does (`every` for `true`),
// which is the contract that keeps the two languages' answers from drifting apart.
const policies = await evaluate(`(() => {
  const read = (id) => {
    const row = document.querySelector('#rows .cue-row[data-cue-id="' + id + '"]');
    const pick = row.querySelector('.dense-repeat');
    return { value: pick.value, options: Array.from(pick.options).map((option) => option.value) };
  };
  return { one: read('cue-1'), two: read('cue-2'), three: read('cue-3') };
})()`);
assert.deepEqual(policies.three.options, ["pass", "show", "every"],
  `the three policies are offered, not a checkbox with two answers (got ${JSON.stringify(policies.three.options)})`);
assert.equal(policies.one.value, "pass",
  `a cue with no policy and no old flag is once per pass (got ${JSON.stringify(policies.one)})`);
assert.equal(policies.three.value, "every",
  `THE AGREEMENT: a cue carrying the old flag reads as every crossing, exactly as the engine reads it (got ${JSON.stringify(policies.three)})`);

await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const pick = document.querySelector('#rows .cue-row[data-cue-id="cue-3"] .dense-repeat');
  pick.value = 'show';
  pick.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await settle(200);
await evaluate(`document.getElementById('save').click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, "the save to reach the backend");
const policyWritten = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  const cue = (call?.args?.cues?.cues || []).find((entry) => entry.id === 'cue-3');
  return cue ? { repeat: cue.repeat, repeats: cue.repeats } : null;
})()`);
assert.equal(policyWritten?.repeat, "show", `choosing a policy writes the policy (got ${JSON.stringify(policyWritten)})`);
assert.equal(policyWritten?.repeats, false,
  `and clears the old flag in the same breath, so the file never carries two authorities (got ${JSON.stringify(policyWritten)})`);
console.log("6. the row offers the three policies and reads the older flag exactly as the engine does");

// --- 7. The drive mode, the Go, and the duration that moves a sequence on ---------------------------------------
//
// The mode is a property of the **list**, so the contract is that choosing it reaches the file, and that the engine —
// not this window — is what the header reports: the sequence line is read from the snapshot, because a window opened
// halfway through a rehearsal has to be able to say where the sequence is without having watched it start.
const driveBefore = await evaluate(`(() => ({
  value: document.getElementById('drive').value,
  options: Array.from(document.getElementById('drive').options).map((option) => option.value),
  goDisabled: document.getElementById('go').disabled,
  sequence: document.getElementById('sequence').textContent.trim(),
}))()`);
assert.deepEqual(driveBefore.options, ["timecode", "sequential"],
  `the two drives are offered (got ${JSON.stringify(driveBefore.options)})`);
assert.equal(driveBefore.value, "timecode", `the mode the file carries is the one shown (got ${JSON.stringify(driveBefore.value)})`);
assert.equal(driveBefore.goDisabled, true,
  `THE HONEST CONTROL: by timecode a Go has nothing to do, so it is not offered (got disabled=${driveBefore.goDisabled})`);
assert.equal(driveBefore.sequence, "", `and nothing pretends a sequence is running (got ${JSON.stringify(driveBefore.sequence)})`);

await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const pick = document.getElementById('drive');
  pick.value = 'sequential';
  pick.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, "the mode to reach the file");
const driveWritten = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  return call?.args?.cues?.drive ?? null;
})()`);
assert.equal(driveWritten, "sequential",
  `choosing a drive writes it to the list, which is where the mode lives (got ${JSON.stringify(driveWritten)})`);

await waitFor(`document.getElementById('sequence').textContent.includes('waiting for a Go')`, "the sequence line to follow the engine");
const afterMode = await evaluate(`(() => ({
  goDisabled: document.getElementById('go').disabled,
  sequence: document.getElementById('sequence').textContent.trim(),
}))()`);
assert.equal(afterMode.goDisabled, false, `in one-by-one drive the Go is offered (got ${JSON.stringify(afterMode)})`);
assert.match(afterMode.sequence, /waiting for a Go/,
  `and the window says the sequence has not been started rather than that it is running (got ${JSON.stringify(afterMode.sequence)})`);

await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.getElementById('go').click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'timecode_sequential_go')`, "the Go to reach the engine");
const goStatus = await evaluate(`document.getElementById('status').textContent.trim()`);
assert.match(goStatus, /Fired the next cue/,
  `a Go that fired a cue says so (got ${JSON.stringify(goStatus)})`);
await waitFor(`document.getElementById('sequence').textContent.includes('end of the list')`, "the end of the sequence to be said");
const atEnd = await evaluate(`document.getElementById('sequence').textContent.trim()`);
assert.match(atEnd, /at the end of the list/,
  `and a Go with nothing left says that, instead of a control that looks broken (got ${JSON.stringify(atEnd)})`);

// The duration: written as seconds, stored as milliseconds, and refused when it is not a duration.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row[data-cue-id="cue-1"] .dense-duration');
  row.value = '2.5';
  row.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await settle(150);
await evaluate(`document.getElementById('save').click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, "the duration to be saved");
const durationWritten = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  return (call?.args?.cues?.cues || []).find((cue) => cue.id === 'cue-1')?.duration_ms ?? null;
})()`);
assert.equal(durationWritten, 2500,
  `a duration typed in seconds is stored in milliseconds (got ${JSON.stringify(durationWritten)})`);

const refused = await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row[data-cue-id="cue-1"] .dense-duration');
  row.value = 'two seconds';
  row.dispatchEvent(new Event('change', { bubbles: true }));
  return { value: row.value, status: document.getElementById('status').textContent.trim() };
})()`);
assert.equal(refused.value, "2.5",
  `a duration that cannot be read is refused and the field is put back (got ${JSON.stringify(refused.value)})`);
assert.match(refused.status, /is not a duration/,
  `and the refusal says what a duration looks like (got ${JSON.stringify(refused.status)})`);
console.log("7. the drive mode reaches the file, the Go follows the engine, and a duration is seconds on screen and milliseconds in the file");

// --- 8. The other list-level selector: the order, which is a property of the file too ---------------------------
//
// It is here because it was **broken and unnoticed**: the handler called a method the panel exposes only to a row's own
// editor, so choosing an order threw and wrote nothing while the selector showed the new order. Nothing tested it. The
// contract is that the choice reaches the file, which is the only thing that makes the selector true.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const pick = document.getElementById('sort');
  pick.value = 'manual';
  pick.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, "the order to reach the file");
const orderWritten = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  return call?.args?.cues?.sort ?? null;
})()`);
assert.equal(orderWritten, "manual",
  `choosing an order must write it, not throw while the selector shows it (got ${JSON.stringify(orderWritten)})`);
console.log("8. the order selector writes the order it shows");

// --- 9. Monitor: the list is watched, reported, and nothing is emitted ------------------------------------------
//
// The engine's half of this is a Rust contract (the same plan as the show, and no event in the delivery ledger). What
// is checked here is the window's half: that the switch reaches the engine, that the band which tells the operator the
// show is not firing is **read from the engine** rather than from the click, and that the plan paints the measurement
// Monitor exists for — how late the timecode was at each crossing, in frames.
const monitorBefore = await evaluate(`(() => ({
  box: document.getElementById('rehearsal').checked,
  bannerHidden: document.getElementById('monitor-banner').hidden,
  planHidden: document.getElementById('plan').hidden,
}))()`);
assert.equal(monitorBefore.box, false, `the switch starts off, because the list starts governing (got ${JSON.stringify(monitorBefore)})`);
assert.equal(monitorBefore.bannerHidden, true, "and no band claims the show is being watched");
assert.equal(monitorBefore.planHidden, true, "and there is no rehearsal report to read");

await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const box = document.getElementById('rehearsal');
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_rehearsal')`, "Monitor to reach the engine");
const monitorCall = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_rehearsal').pop();
  return call?.args ?? null;
})()`);
assert.equal(monitorCall?.rehearsing, true, `the switch must ask the engine for Monitor (got ${JSON.stringify(monitorCall)})`);

await waitFor(`!document.getElementById('monitor-banner').hidden`, "the band to appear");
const monitoring = await evaluate(`(() => ({
  banner: document.getElementById('monitor-banner').textContent.replace(/\\s+/g, ' ').trim(),
  planHidden: document.getElementById('plan').hidden,
  clearHidden: document.getElementById('clear-plan').hidden,
  rows: Array.from(document.querySelectorAll('#plan-body tr')).slice(1).map((tr) =>
    Array.from(tr.children).map((td) => td.textContent.trim())),
}))()`);
assert.match(monitoring.banner, /nothing is emitted/,
  `THE BAND: an operator must never have to wonder whether the show is firing (got ${JSON.stringify(monitoring.banner)})`);
assert.equal(monitoring.planHidden, false, "the rehearsal report is shown while the list is watched");
assert.equal(monitoring.clearHidden, false, "and there is something to clear");
assert.equal(monitoring.rows.length, 2, `the plan paints every line the snapshot reports (got ${JSON.stringify(monitoring.rows)})`);
assert.deepEqual(monitoring.rows[0], ["01:00:10:02", "fires", "01:00:10:00", "+2 f"],
  `a crossing shows where the engine was and how late that was, in frames (got ${JSON.stringify(monitoring.rows[0])})`);
assert.deepEqual(monitoring.rows[1], ["01:00:30:00", "skipped", "01:00:20:00", ""],
  `and a cue a seek jumped over shows no lateness, because it was never crossed at a position (got ${JSON.stringify(monitoring.rows[1])})`);

const firedWhileMonitoring = await evaluate(`window.__INVOKES.filter((entry) => entry.cmd === 'fire_macro' || entry.cmd === 'confirm_timecode_cues').length`);
assert.equal(firedWhileMonitoring, 0,
  `NOTHING IS EMITTED: while the list is watched this window fires no macro and confirms no order (it called ${firedWhileMonitoring})`);

await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.getElementById('clear-plan').click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_rehearsal')`, "the clear to reach the engine");
const clearCall = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_rehearsal').pop();
  return call?.args ?? null;
})()`);
assert.equal(clearCall?.clearPlan, true,
  `clearing the report asks for that and keeps the mode (got ${JSON.stringify(clearCall)})`);
console.log("9. Monitor reaches the engine, the band says nothing is emitted, and the plan shows the lateness in frames");

// --- 10. The chain's three values, and when a reason may be attached --------------------------------------------
//
// Three defects lived here and all three were the same mistake: a fact nobody had established was reported as a
// verdict. A cue the health does not describe (every cue before the first snapshot) read as "the time exists at this
// rate" and "macro chosen and present"; a clock nobody had reported explained itself as "no position is arriving"; and
// the LTC window hardcoded "firing allowed". The rule is tested **directly**, because it is a plain function of the
// shared module and a timing game around a polling snapshot would test the poll instead.
const chainRule = await evaluate(`(() => {
  const chain = (cue, context) => WingCueList.blockerChain(cue, context);
  const state = (links) => Object.fromEntries(links.map((link) => [link.link, link.ok]));
  const details = (links) => Object.fromEntries(links.map((link) => [link.link, link.detail]));
  const healthy = { id: "c1", enabled: true, macro_id: "mk-1" };
  const full = { health: { id: "c1", problem: null, macro_id: "mk-1", macro_index: null }, libraryLen: 2,
    clockRunning: true, firingAllowed: true, macroReady: true };
  return {
    nothingKnown: state(chain(healthy, {})),
    nothingKnownDetails: details(chain(healthy, {})),
    allKnown: state(chain(healthy, full)),
    allKnownDetails: details(chain(healthy, full)),
    badTime: state(chain(healthy, { ...full, health: { id: "c1", problem: "frame_not_at_rate" } })),
    badTimeDetails: details(chain(healthy, { ...full, health: { id: "c1", problem: "frame_not_at_rate" } })),
    parked: state(chain({ id: "c2", enabled: false }, full)),
    // A problem this window has never heard of: the backend can grow one, or a rename can reach Rust and not here.
    // It must be UNKNOWN - the row carries its broken tag from health.get() being truthy, and the chain explains it.
    unheard: state(chain(healthy, { ...full, health: { id: "c1", problem: "a_problem_this_window_cannot_word", macro_id: null, macro_index: null, macro_changed: null } })),
  };
})()`);
assert.deepEqual(chainRule.nothingKnown,
  { timecode: null, time: null, enabled: true, macro: null, permission: null, destination: null },
  `A CUE NOBODY HAS DESCRIBED IS UNKNOWN, not fine: only what the cue itself carries is a verdict (got ${JSON.stringify(chainRule.nothingKnown)})`);
assert.equal(chainRule.nothingKnownDetails.timecode, "this window is not being told whether the clock is running",
  `and an unknown link says so, instead of explaining a fact nobody established (got ${JSON.stringify(chainRule.nothingKnownDetails.timecode)})`);
assert.equal(chainRule.nothingKnownDetails.permission, "Live Safe Mode is enforced by the main window, which is the one that fires",
  `including the link this window cannot judge at all (got ${JSON.stringify(chainRule.nothingKnownDetails.permission)})`);
assert.ok(!Object.values(chainRule.nothingKnownDetails).some((text) => /no position is arriving|Live Safe Mode is on and the stream/.test(text)),
  `NO DIAGNOSIS ON AN UNKNOWN LINK: no link may borrow the sentence for a failure (got ${JSON.stringify(chainRule.nothingKnownDetails)})`);
assert.deepEqual(chainRule.allKnown,
  { timecode: true, time: true, enabled: true, macro: true, permission: true, destination: true },
  `with everything reported, every link is a verdict (got ${JSON.stringify(chainRule.allKnown)})`);
assert.ok(Object.values(chainRule.allKnownDetails).every((text) => text === ""),
  `and a link that is fine carries no reason at all (got ${JSON.stringify(chainRule.allKnownDetails)})`);
assert.equal(chainRule.badTime.time, false, `a label that cannot exist at the rate is a verdict (got ${JSON.stringify(chainRule.badTime)})`);
assert.equal(chainRule.badTime.macro, true, "and it does not contaminate the link beside it");
assert.match(chainRule.badTimeDetails.time, /cannot exist|does not exist/i,
  `the reason belongs to the broken link (got ${JSON.stringify(chainRule.badTimeDetails.time)})`);
assert.equal(chainRule.badTimeDetails.macro, "", `and to no other (got ${JSON.stringify(chainRule.badTimeDetails.macro)})`);
// **A problem the window cannot word is UNKNOWN, not fine.** The row's broken tag is drawn from health.get(id)
// being truthy, so the chain is what explains it - and a chain of healthy links would contradict the mark that
// sent the operator here. This is the fix in 47c7b45f, and this is its contract.
assert.equal(chainRule.unheard.time, null,
  `a problem this window cannot word must report unknown, not ok - the broken mark sent the operator here (got ${JSON.stringify(chainRule.unheard)})`);
assert.equal(chainRule.unheard.macro, null, "and the link beside it, for the same reason");
assert.equal(chainRule.parked.enabled, false, "what the cue itself carries is always a verdict, so a parked cue is not in doubt");

// And through the window, on a real row: the permission link the window used to claim, and the offset it will write.
await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="cue-1"]').click()`);
await settle(150);
const inspectorNow = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('#inspector-body .chain-row'));
  const permission = rows.find((row) => row.textContent.includes('firing allowed'));
  return {
    permissionMark: permission ? permission.querySelector('.chain-mark').textContent.trim() : null,
    permissionText: permission ? permission.textContent.trim() : null,
    offset: document.querySelector('#inspector-body .offset')?.textContent.trim() || '',
  };
})()`);
assert.equal(inspectorNow.permissionMark, "?",
  `THE LIE REMOVED: the window must not report firing as allowed when it cannot tell (got ${JSON.stringify(inspectorNow.permissionText)})`);
assert.match(inspectorNow.permissionText, /main window/,
  `and it says where the padlock actually is (got ${JSON.stringify(inspectorNow.permissionText)})`);
assert.match(inspectorNow.offset, /offset \+3 frames/,
  `WHAT IT WRITES IT SHOWS: the inspector names the global offset this window's saves will carry (got ${JSON.stringify(inspectorNow.offset)})`);
// The line used to end "(set in Settings)" and this suite pinned it — correctly, because "what a window writes it
// shows, **and it says where the control lives**" is the property. The control is here now, so the sentence and the
// assertion move together; and the second half is new, because a parenthetical that names a place is only honest if
// something is actually there.
assert.match(inspectorNow.offset, /set in the header/,
  `and says where the control for it lives (got ${JSON.stringify(inspectorNow.offset)})`);
assert.equal(
  await evaluate(`Boolean(document.querySelector('header #offset, .transport #offset'))`),
  true,
  'and that place must really hold the control: the sentence and the field move together, or the line is a lie again',
);
console.log("10. the chain reports unknown where nobody can judge, attaches a reason only to a broken link, and the inspector shows the offset it writes");

// --- 11. The bulk signed shift over a selection ----------------------------------------------------------------
//
// D5's other half, shaped by the precedent research on Hog 4: a **signed frame delta over the cues currently selected**,
// one undo step for the whole range, the count and the range shown before it applies, an empty selection disabling the
// control, and a refusal rather than a wrap when a cue would land before 00:00:00:00. The assertion with teeth is the
// cue that is **not** selected: a shift that moved everything would pass every other check here.
await evaluate(`(() => {
  // Put the four times back where the fixture had them, through the fields the operator uses: section 3 edited cue-1, and
  // a contract that depends on what an earlier section typed is a contract that breaks when that section changes.
  const wanted = { "cue-1": "01:00:10:00", "cue-2": "01:00:20:00", "cue-3": "01:00:30:00", "cue-4": "01:00:40:00" };
  for (const [id, time] of Object.entries(wanted)) {
    const field = document.querySelector('#rows .cue-row[data-cue-id="' + id + '"] .dense-time');
    field.value = time;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
})()`);
// Save, so the undo stack is **empty** before the shift. Without this the stack still holds the four field edits above,
// and "one undo takes the range back" would pass even with no undo step opened for the shift — measured: that is exactly
// how this contract was toothless the first time, and the mutation check said MISSED rather than caught.
await evaluate(`document.getElementById('save').click()`);
await waitFor(`window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').length >= 1`, "the save that clears the undo stack");
await settle(150);
const shiftStart = await evaluate(`(() => {
  // And start from a known selection: earlier sections clicked rows, and a selection that survived is exactly what this
  // control is for. A click that lands on no row clears it, which is also the gesture an operator will try first.
  document.getElementById('rows').click();
  return {
    applyDisabled: document.getElementById('shift-apply').disabled,
    preview: document.getElementById('shift-preview').textContent.trim(),
    selected: document.querySelectorAll('#rows .cue-row.is-selected').length,
    undoHidden: document.getElementById('undo').hidden,
  };
})()`);
assert.equal(shiftStart.undoHidden, true,
  `a save leaves nothing to take back, which is what makes the shift's own undo step measurable (got ${JSON.stringify(shiftStart)})`);
assert.equal(shiftStart.selected, 0,
  `a click that lands on no row drops the selection (got ${JSON.stringify(shiftStart)})`);
assert.equal(shiftStart.applyDisabled, true,
  `an empty selection disables the shift, because an unscoped shift is the global offset's job (got ${JSON.stringify(shiftStart)})`);
assert.match(shiftStart.preview, /select the cues to move/,
  `and it says how to select rather than doing nothing (got ${JSON.stringify(shiftStart.preview)})`);

// Click one — the anchor — and then shift-click another: a range over what is on screen.
await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="cue-1"]').click()`);
await settle(120);
const oneOnly = await evaluate(`(() => ({
  selected: document.querySelectorAll('#rows .cue-row.is-selected').length,
  preview: document.getElementById('shift-preview').textContent.trim(),
}))()`);
assert.equal(oneOnly.selected, 1, `a plain click selects one row (got ${JSON.stringify(oneOnly)})`);
await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row[data-cue-id="cue-3"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
})()`);
await settle(120);
const ranged = await evaluate(`(() => ({
  selected: Array.from(document.querySelectorAll('#rows .cue-row.is-selected')).map((row) => row.dataset.cueId),
  preview: document.getElementById('shift-preview').textContent.trim(),
  applyDisabled: document.getElementById('shift-apply').disabled,
}))()`);
assert.deepEqual(ranged.selected, ["cue-1", "cue-2", "cue-3"],
  `THE GESTURES OF A FILE LIST: shift-click takes the range between the two clicks (got ${JSON.stringify(ranged.selected)})`);
assert.equal(ranged.applyDisabled, false, "and a selection offers the shift");
assert.match(ranged.preview, /3 cue\(s\)/,
  `the preview says how many cues it would move (got ${JSON.stringify(ranged.preview)})`);

await evaluate(`(() => {
  const box = document.getElementById('shift-frames');
  box.value = '120';
  box.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await settle(120);
const previewed = await evaluate(`document.getElementById('shift-preview').textContent.trim()`);
assert.match(previewed, /first 01:00:10:00 → 01:00:14:20/,
  `WHAT IT WILL DO, BEFORE IT DOES IT: the first cue's before and after, 120 frames later at 25 fps (got ${JSON.stringify(previewed)})`);
assert.match(previewed, /last 01:00:30:00 → 01:00:34:20/,
  `and the last one's, which is what makes the range of the edit visible (got ${JSON.stringify(previewed)})`);

const timesBefore = await evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('#rows .cue-row')).map((row) => [row.dataset.cueId, row.querySelector('.dense-time').value]))`);
await evaluate(`document.getElementById('shift-apply').click()`);
await settle(200);
const afterShift = await evaluate(`(() => ({
  times: Object.fromEntries(Array.from(document.querySelectorAll('#rows .cue-row')).map((row) => [row.dataset.cueId, row.querySelector('.dense-time').value])),
  status: document.getElementById('status').textContent.trim(),
  selected: document.querySelectorAll('#rows .cue-row.is-selected').length,
  saveClass: document.getElementById('save').className,
  undoHidden: document.getElementById('undo').hidden,
}))()`);
assert.equal(afterShift.times["cue-1"], "01:00:14:20", `the first selected cue moved (was ${timesBefore["cue-1"]}, got ${afterShift.times["cue-1"]})`);
assert.equal(afterShift.times["cue-2"], "01:00:24:20", `and the second (got ${afterShift.times["cue-2"]})`);
assert.equal(afterShift.times["cue-3"], "01:00:34:20", `and the third (got ${afterShift.times["cue-3"]})`);
assert.equal(afterShift.times["cue-4"], timesBefore["cue-4"],
  `AND THE CUE THAT WAS NOT SELECTED DID NOT MOVE (was ${timesBefore["cue-4"]}, got ${afterShift.times["cue-4"]})`);
assert.match(afterShift.status, /3 cue\(s\) moved by \+120 frames/,
  `the window says what it did (got ${JSON.stringify(afterShift.status)})`);
assert.equal(afterShift.selected, 3, "and the selection survives the edit, so a second shift is one more click");
assert.match(afterShift.saveClass, /is-unsaved/, "the list is now unsaved, as any edit leaves it");
assert.equal(afterShift.undoHidden, false, "and there is something to take back");

// One undo step for the whole range, not three.
await evaluate(`document.getElementById('undo').click()`);
await settle(200);
const undone = await evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('#rows .cue-row')).map((row) => [row.dataset.cueId, row.querySelector('.dense-time').value]))`);
assert.deepEqual(undone, timesBefore,
  `ONE UNDO STEP TAKES THE WHOLE RANGE BACK, not one cue at a time (got ${JSON.stringify(undone)})`);

// A shift that would wrap past midnight is refused, and says which cue it was.
await evaluate(`(() => {
  const box = document.getElementById('shift-frames');
  box.value = '-999999';
  box.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await evaluate(`document.getElementById('shift-apply').click()`);
await settle(200);
const refusedShift = await evaluate(`(() => ({
  status: document.getElementById('status').textContent.trim(),
  times: Object.fromEntries(Array.from(document.querySelectorAll('#rows .cue-row')).map((row) => [row.dataset.cueId, row.querySelector('.dense-time').value])),
}))()`);
assert.match(refusedShift.status, /would land before 00:00:00:00/,
  `REFUSED, NOT WRAPPED: a shift past midnight says so instead of moving the cue to the end of the show (got ${JSON.stringify(refusedShift.status)})`);
assert.deepEqual(refusedShift.times, timesBefore, "and nothing moved");

// The selection survives a search that hides part of it, and the preview says how much is hidden.
await evaluate(`(() => {
  const filter = document.getElementById('filter');
  filter.value = 'Encore';
  filter.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await settle(150);
const filtered = await evaluate(`(() => ({
  preview: document.getElementById('shift-preview').textContent.trim(),
  selected: document.querySelectorAll('#rows .cue-row.is-selected').length,
}))()`);
assert.match(filtered.preview, /3 cue\(s\)/,
  `the selection is a fact about cues, not about what is on screen, so a search does not silently drop it (got ${JSON.stringify(filtered.preview)})`);
assert.match(filtered.preview, /3 hidden by the search/,
  `and the window says how much of the selection the search is hiding, because the shift will move it too (got ${JSON.stringify(filtered.preview)})`);
await evaluate(`(() => {
  const filter = document.getElementById('filter');
  filter.value = '';
  filter.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await settle(120);
console.log("11. the shift moves the selection by a signed frame delta, previews it, refuses a wrap, and is one undo step");

// --- 12. The keyboard flow the window's specification names ------------------------------------------------------
//
// "Enter appends at the end" — and it must be **guarded against a field**, because Enter inside the time box belongs to
// the time box. Both halves are asserted, since a shortcut that steals Enter from the field it is typed in would make
// setting a time add a cue instead.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row[data-cue-id="cue-1"]');
  row.focus();
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'add_timecode_cue_at_end')`, "Enter on a row to append at the end");
assert.ok(await evaluate(`window.__INVOKES.some((entry) => entry.cmd === 'add_timecode_cue_at_end')`),
  "ENTER ON A ROW APPENDS A CUE AT THE END, which is the keyboard path to building a long list");

await settle(250);
await evaluate(`window.__INVOKES.length = 0`);
const inField = await evaluate(`(() => {
  const field = document.querySelector('#rows .cue-row[data-cue-id="cue-1"] .dense-time');
  field.focus();
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return { focused: document.activeElement === field };
})()`);
await settle(200);
const addedFromField = await evaluate(`window.__INVOKES.filter((entry) => entry.cmd === 'add_timecode_cue_at_end').length`);
assert.equal(addedFromField, 0,
  `ENTER INSIDE A FIELD BELONGS TO THE FIELD: typing a time and pressing Enter must not add a cue (it added ${addedFromField})`);
assert.equal(inField.focused, true, "and the field keeps the focus it had");
console.log("12. Enter on a row appends at the end, and Enter inside a field does not");

// --- 13. A macro that changed is a note, never a gate -----------------------------------------------------------
//
// The cue fires exactly the macro it names — that is what the operator asked for — so "the library's copy is not the one
// this cue was set up with" is information, not a fault. The contract is therefore two-sided: the note appears when the
// backend says the content moved, it does **not** appear when nothing can be judged, and the cue's own chain keeps
// saying it is fine, because it is.
await evaluate(`window.__SET_CHANGED('cue-1')`);
await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="cue-1"]').click()`);
// Waited for rather than slept on: the note comes from the engine's `cue_health` on the **next poll**, so a fixed sleep is
// a race with it — which passed on a quiet machine and failed in the gate run, where the browser is busier.
await waitFor(`Boolean(document.getElementById('inspector-body').querySelector('.drifted'))`, "the note to appear");
const noted = await evaluate(`(() => {
  const body = document.getElementById('inspector-body');
  return {
    note: body.querySelector('.drifted')?.textContent.trim() || '',
    marks: Array.from(body.querySelectorAll('.chain-mark')).map((node) => node.textContent.trim()),
    why: body.querySelector('.why')?.textContent.trim() || '',
  };
})()`);
assert.match(noted.note, /This macro has changed since this cue named it/,
  `THE NOTE IS SHOWN when the library's copy moved (got ${JSON.stringify(noted.note)})`);
assert.match(noted.note, /still fires the macro it names/,
  `and it says the cue still fires, because that is the truth (got ${JSON.stringify(noted.note)})`);
assert.ok(!noted.why, `AND IT IS NOT A BROKEN LINK: no failure sentence is printed for it (got ${JSON.stringify(noted.why)})`);
assert.ok(!noted.marks.includes("NO"),
  `and no link is marked broken for a cue that fires exactly what it names (got ${JSON.stringify(noted.marks)})`);

// The other direction, which is the one that would make the note useless: a cue nothing can be judged about shows none.
// Waited for rather than slept on: the window learns this from its 250 ms poll, so a fixed sleep is a race with it.
await evaluate(`window.__SET_CHANGED(null)`);
await waitFor(`!document.getElementById('inspector-body').querySelector('.drifted')`, "the note to clear");
const quiet = await evaluate(`document.getElementById('inspector-body').querySelector('.drifted')?.textContent.trim() || ''`);
assert.equal(quiet, "", `and a cue whose macro cannot be judged shows no note at all (got ${JSON.stringify(quiet)})`);

// And the record itself: binding a macro must write the content hash beside the key, or nothing can ever be compared.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const pick = document.querySelector('#rows .cue-row[data-cue-id="cue-1"] .cue-macro');
  pick.value = 'mk-1';
  pick.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await settle(150);
await evaluate(`document.getElementById('save').click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, "the bound macro to be saved");
const recorded = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  const cue = (call?.args?.cues?.cues || []).find((entry) => entry.id === 'cue-1');
  return cue ? { macro_id: cue.macro_id ?? null, macro_hash: cue.macro_hash ?? null } : null;
})()`);
assert.equal(recorded?.macro_id, "mk-1", `binding a macro names it by key (got ${JSON.stringify(recorded)})`);
assert.match(String(recorded?.macro_hash || ""), /^[0-9a-f]{8}$/,
  `AND IT RECORDS THE MACRO'S CONTENT, which is the only thing a later comparison can be made against (got ${JSON.stringify(recorded)})`);
console.log("13. a changed macro is a note in the inspector, never a broken link, and binding one records its content");

// --- 14. Used by N cues: a shared macro says so, and says which ------------------------------------------------
//
// One macro edited or deleted touches every cue that names it, and the precedents all put that fact where the operator
// already is: Eos prints a count and a list for a preset, grandMA3 marks the pool object and opens a reference list. This
// inspector is per **cue**, so it says how many cues of this list name the same macro and which they are. The marker on
// the row is the persistent half — and it must stay off a macro only one cue names, or it is noise on every row.
const usageFor = async (id) => {
  await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="${id}"]').click()`);
  await settle(150);
  return evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('#rows .cue-row'));
    return {
      usage: document.querySelector('#inspector-body .usage')?.textContent.trim() || '',
      badges: rows.filter((row) => row.querySelector('.shared-badge'))
        .map((row) => row.dataset.cueId + ":" + row.querySelector('.shared-badge').textContent.trim()),
    };
  })()`);
};

// The bindings this section reads are set here through the pickers, the operator's own path: section 13 binds mk-1 to
// cue-1, and a contract that depends on what an earlier section left behind is a contract that breaks when that section
// changes — the same reason section 11 puts its times back.
await evaluate(`(() => {
  const bind = (id, token) => {
    const pick = document.querySelector('#rows .cue-row[data-cue-id="' + id + '"] .cue-macro');
    pick.value = token;
    pick.dispatchEvent(new Event('change', { bubbles: true }));
  };
  bind("cue-1", "mk-2");
  bind("cue-3", "mk-1");
  bind("cue-4", "mk-1");
})()`);
await settle(150);

const sharedMacro = await usageFor("cue-3");
assert.match(sharedMacro.usage, /Used by 2 cues of this list/,
  `A SHARED MACRO SAYS HOW MANY CUES NAME IT (got ${JSON.stringify(sharedMacro.usage)})`);
assert.match(sharedMacro.usage, /3/, `and which they are, not only how many (got ${JSON.stringify(sharedMacro.usage)})`);
assert.match(sharedMacro.usage, /4/, `including the other one (got ${JSON.stringify(sharedMacro.usage)})`);
assert.deepEqual(sharedMacro.badges, ["cue-3:×2", "cue-4:×2"],
  `and the rows that name it carry the marker, the persistent half of the fact (got ${JSON.stringify(sharedMacro.badges)})`);

const uniqueMacro = await usageFor("cue-1");
assert.match(uniqueMacro.usage, /Used by 1 cue of this list: only this one/,
  `a macro only this cue names says so, which is what tells the operator it is safe to edit (got ${JSON.stringify(uniqueMacro.usage)})`);
assert.ok(!uniqueMacro.badges.includes("cue-1:×1"),
  `AND A MACRO ONE CUE NAMES CARRIES NO MARKER: a badge on every row is noise (got ${JSON.stringify(uniqueMacro.badges)})`);

const noMacro = await usageFor("cue-2");
assert.equal(noMacro.usage, "",
  `a cue that names no macro says nothing about users, because it has no macro to be used (got ${JSON.stringify(noMacro.usage)})`);
console.log("14. a shared macro says how many cues name it and which; a unique one says so and carries no marker");

// --- 15. The section: set on the row, offered from the list's own names, saved, one undo ----------------------------
//
// D14's rail was withdrawn by measurement — the owner's own list is 8 cues with **no** sections, and the field had no
// surface at all — and what survives is the fact itself. The contract is what makes the withdrawal honest: the field must
// work, the names the list already carries must be offered so one section cannot acquire two spellings, it must travel in
// the file's own field rather than in a second one invented for it, and one undo must take it back.
await evaluate(`window.__INVOKES.length = 0`);
const sectionField = '.cue-row[data-cue-id="cue-3"] .dense-section';
const sectionBefore = await evaluate(`(() => {
  const field = document.querySelector('${sectionField}');
  return { present: Boolean(field), value: field ? field.value : null,
           names: Array.from(document.querySelectorAll('#cue-section-names option')).map((node) => node.value) };
})()`);
assert.equal(sectionBefore.present, true, "every row carries a section field");
assert.equal(sectionBefore.value, "", `and it is empty for a cue that carries no section (got ${JSON.stringify(sectionBefore.value)})`);
assert.deepEqual(sectionBefore.names, [], `with no names offered while no cue has one (got ${JSON.stringify(sectionBefore.names)})`);

await evaluate(`(() => {
  const field = document.querySelector('${sectionField}');
  field.value = 'Act 1';
  field.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
// The names are painted with the rows, and a local edit deliberately does **not** repaint them (a repaint would destroy
// the field the operator is typing in): they arrive with the window's own poll. Waited for, not slept on.
await waitFor(`Array.from(document.querySelectorAll('#cue-section-names option')).some((node) => node.value === 'Act 1')`,
  "the list's names to be offered");
const sectionAfter = await evaluate(`(() => ({
  field: document.querySelector('${sectionField}')?.value ?? null,
  names: Array.from(document.querySelectorAll('#cue-section-names option')).map((node) => node.value),
}))()`);
assert.equal(sectionAfter.field, "Act 1",
  `THE SECTION THE OPERATOR TYPED IS THE CUE'S SECTION, and it survives a repaint (got ${JSON.stringify(sectionAfter)})`);
assert.ok(sectionAfter.names.includes("Act 1"),
  `AND THE LIST'S OWN NAMES ARE OFFERED to every row's field, so one section cannot acquire two spellings (got ${JSON.stringify(sectionAfter.names)})`);

// One undo takes it back — **before** the save, because a Save clears the undo stack and an Undo pressed after one is
// meant to do nothing (the same reason section 11 puts a save ahead of its own check).
await evaluate(`document.getElementById('undo').click()`);
await settle(250);
const sectionUndone = await evaluate(`document.querySelector('${sectionField}')?.value ?? null`);
assert.equal(sectionUndone, "", `ONE UNDO TAKES THE SECTION BACK (got ${JSON.stringify(sectionUndone)})`);

// And it travels in the file, in the field the file already has.
await evaluate(`(() => {
  const field = document.querySelector('${sectionField}');
  field.value = 'Act 1';
  field.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(`document.querySelector('${sectionField}')?.value === 'Act 1'`, "the section to be set again");
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.getElementById('save').click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, "the section to be saved");
const sectionSaved = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  const cue = (call?.args?.cues?.cues || []).find((entry) => entry.id === 'cue-3');
  return cue ? { group: cue.group ?? null } : null;
})()`);
assert.equal(sectionSaved?.group, "Act 1",
  `AND IT TRAVELS IN THE FIELD THE FILE ALREADY HAS, not in a second one invented for it (got ${JSON.stringify(sectionSaved)})`);
console.log("15. the section is set on the row, offered from the list's names, saved in the file's own field, and undone in one step");

// --- 16. The next cue names what it is waiting for ---------------------------------------------------------------
//
// The spec asked for "next LTC" and "next manual" as two readouts, because it assumed two drives running at once. D2 made
// the drive a property of the **list**, so there is one next cue — and what the readout must not do is keep calling it
// "next LTC" while the list waits for a person. The label follows the engine's drive, and the countdown belongs to the
// clock alone: nothing is counting down to a cue that waits for Go.
const setDrive = async (mode) => {
  await evaluate(`(() => {
    const pick = document.getElementById('drive');
    pick.value = '${mode}';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  // Waited on the **Go button**, which follows the drive and nothing else: synchronising on the label would be
  // synchronising on the very thing this section is testing, and a defect in it would pass the wait and fail later for a
  // reason that has nothing to do with the defect.
  await waitFor(`document.getElementById('go').disabled === ${mode === "sequential" ? "false" : "true"}`,
    `the engine's ${mode} drive to reach the window`);
  return evaluate(`(() => ({ label: document.getElementById('next-label').textContent.trim(), value: document.getElementById('next').textContent.trim() }))()`);
};

const onTheClock = await setDrive("timecode");
assert.equal(onTheClock.label, "next LTC", `by timecode the next cue waits for the clock (got ${JSON.stringify(onTheClock)})`);
assert.match(onTheClock.value, /01:00:10:00 in 2\.4 s/,
  `and the clock's countdown is shown, because there is one (got ${JSON.stringify(onTheClock.value)})`);

const onGo = await setDrive("sequential");
assert.equal(onGo.label, "next on Go",
  `THE READOUT NAMES WHAT IT IS WAITING FOR: a list on the manual drive waits for the operator, and calling that "next LTC" is a report that lies (got ${JSON.stringify(onGo)})`);
assert.match(onGo.value, /01:00:10:00/, `and it still says which cue is next (got ${JSON.stringify(onGo.value)})`);
assert.doesNotMatch(onGo.value, / in /,
  `WITH NO COUNTDOWN: nothing is counting down to a cue that waits for a person (got ${JSON.stringify(onGo.value)})`);
console.log("16. the next-cue readout names the drive it waits for, and only the clock gets a countdown");

// --- 17. The row is actually laid out as a row ----------------------------------
// This window carried **no CSS at all** for the classes the shared module creates: it styled its own `extras` and
// nothing else, and the module injects styles for the selection and the Save control but none for the row. So nine
// of the ten classes a cue row is made of had no rule here, and a row ran together — no gap, no monospace time, the
// name unable to ellipsise, the tags without the bordered boxes that carry their meaning, and nothing separating one
// row from the next (measured 2026-10-07). The look now lives in `cue-list.js` beside the elements it describes.
//
// The contract is **computed style**, not the presence of a stylesheet. That distinction is the whole point: every
// one of those classes existed before this fix, and no suite noticed, because a DOM query finds an element whether or
// not anything styles it. And it must be computed *here*, in the window that had nothing — asserting it in a window
// that carried its own copy would have passed all along.
const rowStyle = await evaluate(`(() => {
  const style = (element, property) => element ? getComputedStyle(element).getPropertyValue(property) : "";
  const rows = Array.from(document.querySelectorAll("#rows .cue-row"));
  const line = document.querySelector("#rows .cue-row .cue-line");
  const at = document.querySelector("#rows .cue-row .cue-at");
  const tags = document.querySelector("#rows .cue-row .cue-tags");
  const tag = document.querySelector("#rows .cue-row .cue-tag");
  return {
    rows: rows.length,
    lineDisplay: style(line, "display"),
    lineGap: style(line, "gap"),
    atFont: style(at, "font-family"),
    atFlex: style(at, "flex"),
    tagsDisplay: style(tags, "display"),
    tagBorder: style(tag, "border-top-width"),
    firstBorder: style(rows[0], "border-top-width"),
    secondBorder: style(rows[1], "border-top-width"),
    injected: Boolean(document.getElementById("wing-cue-row-style")),
  };
})()`);
assert.ok(rowStyle.rows >= 2,
  `this contract needs at least two rows to judge the separation (got ${rowStyle.rows})`);
assert.ok(rowStyle.injected,
  "the shared module must install the row's look itself, so every window that draws a row gets it");
assert.equal(rowStyle.lineDisplay, "flex",
  `the row's line must be laid out as a line: "cue-line" is a block div holding inline spans, so without this rule its parts run together (got display ${JSON.stringify(rowStyle.lineDisplay)})`);
assert.notEqual(rowStyle.lineGap, "normal",
  `and with a real gap between them (got ${JSON.stringify(rowStyle.lineGap)})`);
assert.match(rowStyle.atFont, /mono/i,
  `the position must be drawn in the monospace face a timecode is read in (got ${JSON.stringify(rowStyle.atFont)})`);
assert.equal(rowStyle.tagsDisplay, "flex",
  `the tag strip must lay its tags out rather than run them together as text (got ${JSON.stringify(rowStyle.tagsDisplay)})`);
assert.equal(rowStyle.tagBorder, "1px",
  `a tag's box carries its meaning, so it must have one (got ${JSON.stringify(rowStyle.tagBorder)})`);
assert.equal(rowStyle.secondBorder, "1px",
  `and consecutive rows must be separated (got ${JSON.stringify(rowStyle.secondBorder)})`);
assert.equal(rowStyle.firstBorder, "0px",
  `the first row carries no separator above it, because the header already is one (got ${JSON.stringify(rowStyle.firstBorder)})`);
console.log("17. the row is actually laid out as a row, asserted on computed style in the window that had no CSS");

// --- 17b. The row's controls follow the kit's scale, and the shared chrome cannot resize them -------------------
//
// This window links `workstation.css`, whose page-wide `button`/`input` rules are loaded **after** the sheet
// `cue-list.js` injects. Before the row's rules were scoped under `.cue-row`, the very same row was 18 px in the
// settings page and 24 px here — measured 2026-10-20. The contract is computed geometry: the compact 18 px height
// at the default scale, the kit's `--font-sm` on the control, and a real growth when `--meter-scale` rises.
const rowTokenFont = await evaluate(`(() => {
  const probe = document.createElement('span');
  probe.style.fontSize = 'var(--font-sm)';
  document.body.appendChild(probe);
  const size = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return size;
})()`);
const rowControl = await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row');
  const button = row.querySelector('.cue-buttons button');
  const style = getComputedStyle(button);
  return { height: button.getBoundingClientRect().height, font: parseFloat(style.fontSize),
    minHeight: parseFloat(style.minHeight) };
})()`);
assert.ok(rowControl.height >= 17.5 && rowControl.height <= 19,
  `the row's own control keeps the row's compact 18 px height, not the shared chrome's 24 px (got ${JSON.stringify(rowControl)})`);
assert.equal(rowControl.font, rowTokenFont,
  `and its text follows the kit's --font-sm (got ${rowControl.font}, token ${rowTokenFont})`);
assert.equal(rowControl.minHeight, 18,
  `the height is a floor, not a fixed box, so a larger scale is not clipped (got ${JSON.stringify(rowControl.minHeight)})`);

await evaluate(`document.querySelector('#rows .cue-row .cue-edit').click()`);
await waitFor(`Boolean(document.querySelector('#rows .cue-row .cue-editor'))`, "the row editor to open");
const rowEditor = await evaluate(`(() => {
  const input = document.querySelector('#rows .cue-row .cue-editor input');
  return { height: input.getBoundingClientRect().height, width: input.getBoundingClientRect().width,
    font: parseFloat(getComputedStyle(input).fontSize), cssHeight: getComputedStyle(input).height };
})()`);
assert.ok(rowEditor.height >= 17.5 && rowEditor.height <= 19,
  `the time field is the same height as the row's buttons at the default scale (got ${JSON.stringify(rowEditor)})`);
assert.equal(rowEditor.font, rowTokenFont,
  `and the field follows --font-sm too (got ${rowEditor.font}, token ${rowTokenFont})`);

const scaledControls = await evaluate(`(() => {
  document.documentElement.style.setProperty('--meter-scale', '2');
  const row = document.querySelector('#rows .cue-row');
  const button = row.querySelector('.cue-buttons button');
  const input = row.querySelector('.cue-editor input');
  const result = {
    buttonHeight: button.getBoundingClientRect().height,
    buttonFont: parseFloat(getComputedStyle(button).fontSize),
    inputHeight: input.getBoundingClientRect().height,
    inputWidth: input.getBoundingClientRect().width,
    inputFont: parseFloat(getComputedStyle(input).fontSize),
    rowOverflow: row.scrollWidth - row.clientWidth,
  };
  document.documentElement.style.removeProperty('--meter-scale');
  return result;
})()`);
assert.ok(scaledControls.buttonHeight > rowControl.height,
  `raising --meter-scale must make the row's control taller than 18 px, not clip a larger label inside it (got ${JSON.stringify(scaledControls)})`);
assert.ok(scaledControls.inputHeight > rowEditor.height,
  `and the time field must grow with it (got ${JSON.stringify(scaledControls)})`);
assert.ok(scaledControls.inputWidth > rowEditor.width,
  `and widen, so four digits still fit (got ${JSON.stringify(scaledControls)})`);
assert.ok(scaledControls.buttonFont > rowControl.font,
  `the control's text must follow the scale too (got ${JSON.stringify(scaledControls)})`);
assert.ok(scaledControls.rowOverflow <= 1,
  `and the row must wrap rather than overflow its own width when it grows (got ${JSON.stringify(scaledControls)})`);

await evaluate(`document.querySelector('#rows .cue-row .cue-edit').click()`);
await waitFor(`!document.querySelector('#rows .cue-row .cue-editor')`, "the row editor to close");
console.log("17b. the row's controls follow the kit's scale, and the shared chrome does not resize them");

// --- 18. The list changing in another window ------------------------------------
// Two editors of one file, and until this the only thing either of them did was read the list once at open: the clock
// and this window could disagree for an entire show without a word. Every write goes through one backend door, which
// announces the list it installed.
//
// It carries the **list**, not a bare fact, and the first case below is why: the emit happens inside the command, so
// the window that saved hears its own echo while its `invoke` is still in flight — with the previous list on its saved
// side and its edits on the draft side. Comparing is what tells that apart from somebody else's change, and the
// alternative was a flag held across an `await`, which a refusal or a throw can leave set.
//
// The state is **established, not assumed**: an earlier section may have left unsaved edits, and a contract that
// guessed its precondition fails for the wrong reason, which is worse than not having it.
await evaluate(`document.getElementById('save')?.click()`);
await settle(250);
const ltcRows = () => evaluate(`document.querySelectorAll('#rows .cue-row').length`);
const ltcStatus = () => evaluate(`document.getElementById('status').textContent.trim()`);
assert.equal(await evaluate(`Array.isArray(window.__LISTENERS['timecode-cues-changed'])`), true,
  "the LTC window must listen for the list changing in another window, or the two editors drift apart in silence");
const ltcBefore = await ltcRows();

// 1. The echo of this window's own save must not be reported as somebody else's change.
await evaluate(`(async () => {
  const published = await window.__TAURI__.core.invoke('get_timecode_cues');
  window.__LISTENERS['timecode-cues-changed'][0]({ payload: published });
})()`);
await settle(200);
assert.equal(await ltcRows(), ltcBefore, 'its own list is not a change');
assert.doesNotMatch(await ltcStatus(), /another window/,
  "and the echo of its own save must not be reported as another window's doing");

// 1b. **The same cues with a different offset is a change**, and this is the case the check order hides: the
//     comparison runs *before* the dirty rule and returns early on a match, so a cue-array-only comparison swallowed
//     an offset change with nothing said. The offset travels in the file, this window shows it in the inspector, and
//     it decides what fires. Measured through the consequence: press Save and read what the window wrote.
await evaluate(`window.__INVOKES.length = 0`);
// The expectation is read from the fixture rather than assumed: hard-coding it made this contract fail for the wrong
// reason the first time, because the fixture's offset is not zero. A contract that breaks when the fixture changes is
// a contract nobody trusts.
const ltcOffsetBase = await evaluate(`(async () => Number((await window.__TAURI__.core.invoke('get_timecode_cues')).offset_frames || 0))()`);
await evaluate(`(async () => {
  const published = await window.__TAURI__.core.invoke('get_timecode_cues');
  window.__LISTENERS['timecode-cues-changed'][0]({ payload: { ...published, offset_frames: Number(published.offset_frames || 0) + 12 } });
})()`);
await settle(250);
await evaluate(`document.getElementById('save')?.click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, 'the save after an offset-only change');
await settle(150);
const ltcOffsetWritten = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  return call?.args?.cues?.offset_frames ?? null;
})()`);
assert.equal(ltcOffsetWritten, ltcOffsetBase + 12,
  `an offset-only change must be taken even though the cue array is identical (had ${ltcOffsetBase}, wrote ${JSON.stringify(ltcOffsetWritten)})`);

// 2. A list that differs, with nothing unsaved here: taken, because that is what makes two editors of one file agree.
await evaluate(`(async () => {
  const published = await window.__TAURI__.core.invoke('get_timecode_cues');
  const extra = { id: 'cue-ltc-elsewhere',
    at: { hours: 1, minutes: 0, seconds: 50, frames: 0, rate: 'fps25', drop_frame: false },
    number: '', label: 'Added elsewhere', group: '', macro_index: 1, repeats: false, enabled: true, note: '' };
  window.__LISTENERS['timecode-cues-changed'][0]({ payload: { ...published, cues: [...published.cues, extra] } });
})()`);
await settle(250);
assert.equal(await ltcRows(), ltcBefore + 1,
  `with nothing unsaved this window must take the list another window published (had ${ltcBefore})`);
assert.doesNotMatch(await ltcStatus(), /another window/, 'and it must not warn about a change it took');

// 3. With an unsaved edit, the foreign list is refused **and the refusal is said out loud**. Removing a row changes
//    the draft and touches nothing on disk, which is exactly the state that must not be overwritten.
await evaluate(`document.querySelector('#rows .cue-row button.cue-remove')?.click()`);
await settle(150);
const ltcDirty = await ltcRows();
assert.equal(ltcDirty, ltcBefore, 'removing a row must change the draft and nothing else');
await evaluate(`(async () => {
  const published = await window.__TAURI__.core.invoke('get_timecode_cues');
  window.__LISTENERS['timecode-cues-changed'][0]({ payload: { ...published, cues: published.cues.slice(0, 1) } });
})()`);
await settle(250);
assert.equal(await ltcRows(), ltcDirty,
  'with unsaved edits the window must keep them rather than take a list that arrived underneath');
assert.match(await ltcStatus(), /changed in another window/,
  'and it must SAY so: "you have unsaved changes" and "somebody else changed the list" are different facts');
console.log('18. the LTC window takes a list changed elsewhere when it is clean, and keeps its edits and says so when it is not');

// --- 19. Renumber is here, and it rewrites numbers only ---------------------------------
// The settings page had this and this window did not, so the window that edits the list could not name its cues for
// reading out — "go to 12" — which is what a cue number is for. It is **a button and a call**: the rule lives in the
// shared module (`renumberCues`), which is where the settings page calls it from too, so this is not a second
// implementation of numbering.
const numbersBefore = await evaluate(`(() => Array.from(document.querySelectorAll('#rows .cue-row'))
  .map((row) => row.querySelector('.cue-number')?.textContent?.trim() || ''))()`);
const idsBefore = await evaluate(`(() => Array.from(document.querySelectorAll('#rows .cue-row')).map((row) => row.dataset.cueId))()`);
await evaluate(`document.getElementById('renumber')?.click()`);
await settle(250);
const numbering = await evaluate(`(() => ({
  numbers: Array.from(document.querySelectorAll('#rows .cue-row')).map((row) => row.querySelector('.cue-number')?.textContent?.trim() || ''),
  ids: Array.from(document.querySelectorAll('#rows .cue-row')).map((row) => row.dataset.cueId),
}))()`);
assert.deepEqual(
  numbering.numbers,
  numbering.numbers.map((_, index) => String(index + 1)),
  `Renumber must number the cues in the list's own order (before ${JSON.stringify(numbersBefore)}, after ${JSON.stringify(numbering.numbers)})`,
);
assert.deepEqual(
  numbering.ids,
  idsBefore,
  'and it must rewrite NUMBERS ONLY: every cue id stays exactly as it was, so a cue triggered from outside keeps working while the numbers change',
);
// The panel answers false when there is nothing to number, and the window then says so rather than leaving a button
// that appears to do nothing. **That branch is deliberately not contracted here**, because reaching it needs an empty
// cue list and this suite's fixture has cues in it — and an assertion that cannot fail is worse than an absent one,
// which is what the first version of this section had: a check on the status element that was true whatever happened.
console.log('19. Renumber numbers the cues in the list order and leaves every id alone');

// --- 20. A cue's number can be set here ------------------------------------------------
// The settings page could name a cue for reading out and this window could not, so a list built here could not be
// driven by "go to 12". The field edits `cue.number`, which is a **name and not an address**: the id is untouched, so
// numbering never moves what a trigger from outside fires.
const numbered = await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row');
  const field = row?.querySelector('.cue-dense .dense-number');
  if (!field) return { found: false };
  field.value = '5.5';
  // "input", not "change": the badge follows what is being typed, the way the settings page's own number field does,
  // so a fix that only listened for "change" would leave the row showing one number and the field another.
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return { found: true, id: row.dataset.cueId };
})()`);
assert.equal(numbered.found, true,
  'the LTC window must carry a cue-number field: without it a list built here cannot be driven by "go to 12"');
await settle(200);
const numberShown = await evaluate(`(() => {
  const row = document.querySelector('[data-cue-id=${JSON.stringify(numbered.id)}]');
  return {
    badge: row?.querySelector('.cue-number')?.textContent?.trim() || '',
    id: row?.dataset.cueId || '',
    field: row?.querySelector('.cue-dense .dense-number')?.value || '',
  };
})()`);
assert.equal(numberShown.badge, '5.5',
  `a number typed on the row must be drawn on the row (got ${JSON.stringify(numberShown.badge)})`);
assert.equal(numberShown.id, numbered.id,
  'and it must be a NAME and not an address: the cue id is untouched, so numbering never moves what an outside trigger fires');
// And it reaches the file: a number that only lived on screen would be a control that appears to work.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`document.getElementById('save')?.click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, 'the save carrying the typed number');
await settle(150);
const numberSaved = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  const cue = (call?.args?.cues?.cues || []).find((one) => one.id === ${JSON.stringify(numbered.id)});
  return cue?.number ?? null;
})()`);
assert.equal(numberSaved, '5.5',
  `the number must reach the file, or the control only appears to work (wrote ${JSON.stringify(numberSaved)})`);
console.log('20. a cue number typed on the row is drawn, saved, and moves no id');

// --- 21. The offset can be set here, and it reaches the file ----------------------------
// This window carried the offset without owning a control for it, and the settings page's field was the only one. The
// field is in the header beside the drive because they are the same kind of value: how this list is run, carried in the
// file, controlling what fires — and not an edit to any row. It behaves as they do: normalised, repainted, and SAVED
// (which re-arms), so a value that appeared to apply and did not is not possible.
const offsetBefore = await evaluate(`Number(document.getElementById('offset')?.value ?? 0)`);
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const field = document.getElementById('offset');
  field.value = String(${JSON.stringify(0)} - 7);
  field.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, 'the offset change to save');
await settle(200);
const offsetSaved = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'set_timecode_cues').pop();
  return { written: call?.args?.cues?.offset_frames ?? null, field: document.getElementById('offset')?.value ?? null };
})()`);
// The payload's schema marker is asserted where the payload is FIRST built (section 3, "the schema version the file
// is written with"), so it is not repeated here. **This was added and then removed on the same day**: a grep that
// ended in `head -6` had already shown an existing assertion, and I concluded from the truncation that none existed.
assert.equal(offsetSaved.written, -7,
  `changing the offset must reach the file, or the field only appears to work (had ${offsetBefore}, wrote ${JSON.stringify(offsetSaved.written)})`);
assert.equal(offsetSaved.field, '-7', 'and the field shows the value that was written');
// The inspector's own line is **deliberately not asserted here**: it renders only with a cue armed, and section 10
// already contracts it ("what it writes it shows, and it says where the control lives"). Re-asserting it here would
// mean building a selection this section does not need, and a contract that fails when the fixture state moves is one
// nobody trusts.
console.log('21. the offset is set in this window, and it is saved where it is written');

// --- 22. A cue can be added at a typed position ----------------------------------------
// The settings page could place a cue at a position it was told, and this window could only add at the end or at the
// timecode arriving now — so a list built in a rehearsal, before the signal exists, could not be started here. It is
// **one button and one field**, the settings page's own control, and the rules travel with it: an unsaved edit is saved
// first (the backend reads the FILE), and a typed position WINS over the live one.
await evaluate(`document.getElementById('save')?.click()`);
await settle(250);
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`(() => {
  const field = document.getElementById('add-position');
  field.value = '01:00:33:00';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('add-at')?.click();
})()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'add_timecode_cue_at_position')`, 'the typed add to reach the backend');
await settle(200);
const typedAdd = await evaluate(`(() => {
  const call = window.__INVOKES.filter((entry) => entry.cmd === 'add_timecode_cue_at_position').pop();
  return {
    position: call?.args?.position ?? null,
    field: document.getElementById('add-position')?.value ?? null,
    status: document.getElementById('status')?.textContent?.trim() || '',
  };
})()`);
assert.equal(typedAdd.position, '01:00:33:00',
  `the position TYPED is the one that must be sent — a field that fell back to the live position would place the cue somewhere else without saying so (sent ${JSON.stringify(typedAdd.position)})`);
assert.equal(typedAdd.field, '',
  'and the field is cleared, so the next Add cue does not silently repeat the position just used');
assert.match(typedAdd.status, /01:00:33:00/,
  `and the window says where it put the cue (got ${JSON.stringify(typedAdd.status)})`);
// The REFUSAL: the backend's parser answers with its own sentence and the window shows it unchanged, keeping what was
// typed. Moved here from the settings suite with the control — it was the one contract of that block with no home in
// the window the control moved to, and a refusal that threw away the operator's typing would be worse than no add.
await evaluate(`window.__FAULT_ADD = 'frame 99 does not exist at 25 fps (0 to 24)'`);
await evaluate(`(() => {
  const field = document.getElementById('add-position');
  field.value = '01:00:99:00';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('add-at')?.click();
})()`);
await settle(400);
const refusedAdd = await evaluate(`(() => ({
  status: document.getElementById('status')?.textContent?.trim() || '',
  field: document.getElementById('add-position')?.value ?? null,
}))()`);
assert.match(refusedAdd.status, /frame 99 does not exist at 25 fps \(0 to 24\)/,
  `the parser's refusal is what the operator reads, unchanged (got ${JSON.stringify(refusedAdd.status)})`);
assert.equal(refusedAdd.field, '01:00:99:00',
  'and what was typed is NOT thrown away, so he can correct one field of it instead of typing it again');
await evaluate(`window.__FAULT_ADD = ''`);
await evaluate(`(() => { document.getElementById('add-position').value = ''; })()`);

// **And the OTHER add: at the end of the list, which is the one a long list is built with.** It had no contract in
// this window — the suite pressed it only for its visibility in Live, while the property "the click reaches the
// backend" was contracted on the settings page, for the control that has since been deleted. So the contract moved
// here with the control, and the two mutations that put its defects back moved with it too.
await evaluate(`window.__INVOKES.length = 0`);
const rowsBeforeAddEnd = await evaluate(`document.querySelectorAll('#rows .cue-row').length`);
// The presence is asserted BEFORE it is pressed, so a missing control fails with the property under test rather than
// with a TypeError about a null — a contract that fails for another reason is one nobody can read.
assert.equal(await evaluate(`Boolean(document.getElementById('add-end'))`), true,
  'the window must offer a way to append a cue after the last one');
await evaluate(`document.getElementById('add-end').click()`);
await waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'add_timecode_cue_at_end')`, 'Add at the end to reach its command');
await settle(250);
assert.equal(await evaluate(`window.__INVOKES.some((entry) => entry.cmd === 'add_timecode_cue_at_end')`), true,
  'the window must offer a way to append a cue after the last one, and the click must reach the backend\'s own command');
assert.equal(await evaluate(`document.querySelectorAll('#rows .cue-row').length`), rowsBeforeAddEnd + 1,
  'and the cue it answers with must be drawn, or the control only appears to work');

console.log('22. a cue can be added at a typed position, and the typed position is what is sent');

// --- 23. The row's editing controls, which moved here with the editor --------------------
// The settings page's cue list became a read-only summary, so the controls that used to be on its rows are on this
// window's rows now — this is the only place the list is edited.
//
// **This section exists because the move moved the controls and left their contracts behind.** The ✎ editor with its
// four fields and the nudge, Undo, Duplicate, the lock and the explicit move out of a clash were contracted only in
// the settings suite; none of them was contracted here, in the window they moved to. A capability with no contract is
// one that can break in silence, and the deletion that made this page the editor is exactly when that would happen.
// So every assertion below is one that used to live there.
// **The row is chosen by what is THERE, not by what the fixture started with.** An earlier section of this suite
// removes a cue and another adds one, so a section that named `cue-1` failed with a null click — the fixture is not the
// state, and a contract that assumes it is fails for the wrong reason. `cue-3` is the "Siren" cue, and its position is
// read from the row rather than assumed.
const ROW_ID = "cue-3";
const editBefore = await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row[data-cue-id="${ROW_ID}"]');
  return { at: row?.querySelector('.cue-at')?.textContent?.trim() || '', editor: row?.querySelectorAll('.cue-editor').length || 0 };
})()`);
assert.ok(editBefore.at, `the section needs a row to work on (got ${JSON.stringify(editBefore.at)})`);
assert.equal(editBefore.editor, 0, 'a row does not carry its editor until it is asked for');
await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="${ROW_ID}"] .cue-edit').click()`);
await settle(200);
const opened = await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row[data-cue-id="${ROW_ID}"]');
  const inputs = row.querySelectorAll('.cue-editor input');
  return {
    fields: inputs.length,
    values: Array.from(inputs).map((input) => input.value),
    buttons: Array.from(row.querySelectorAll('.cue-editor button')).map((button) => button.textContent.trim()),
  };
})()`);
assert.equal(opened.fields, 4, 'the row offers the four fields of a cue position');
// The expectation comes from the row's own readout, so it cannot pass by agreeing with a fixture that has moved.
const shownPosition = editBefore.at.split(":").map(Number);
assert.deepEqual(opened.values.map(Number), shownPosition,
  `the editor shows the position the row shows, ${JSON.stringify(editBefore.at)} (got ${JSON.stringify(opened.values)})`);
assert.deepEqual(opened.buttons, ['−10f', '−1f', '+1f', '+10f', 'Now'], 'with the nudge');
// The nudge is LOCAL: it changes the draft and reaches no command, because a save is what re-arms and an arrow key
// held down must not be a storm of re-arms.
await evaluate(`window.__INVOKES.length = 0`);
await evaluate(`Array.from(document.querySelectorAll('#rows .cue-row[data-cue-id="${ROW_ID}"] .cue-editor button')).find((button) => button.textContent.trim() === '+1f').click()`);
await settle(200);
const nudged = await evaluate(`(() => ({
  at: document.querySelector('#rows .cue-row[data-cue-id="${ROW_ID}"] .cue-at')?.textContent?.trim() || '',
  undoOffered: !document.getElementById('undo')?.hidden,
  commands: window.__INVOKES.map((entry) => entry.cmd)
    .filter((cmd) => !['timecode_state', 'timecode_pending_cues', 'get_timecode_cues'].includes(cmd)),
}))()`);
assert.notEqual(nudged.at, editBefore.at,
  `the nudge must move the cue on the row (both were ${JSON.stringify(nudged.at)})`);
assert.deepEqual(nudged.commands, [], `and reach no command at all (got ${JSON.stringify(nudged.commands)})`);
assert.equal(nudged.undoOffered, true, 'and Undo is offered the moment there is something to take back');
await evaluate(`document.getElementById('undo')?.click()`);
await settle(200);
assert.equal(
  await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="${ROW_ID}"] .cue-at')?.textContent?.trim() || ''`),
  editBefore.at,
  'Undo puts the row back the way it was',
);

// Duplicate makes a copy with an id of its own **on the same frame** — two cues in one frame are both kept and fire in
// the list's own order — and the frame then says so on both rows, with the explicit move out. It is never done for the
// operator: moving a cue he placed is his decision.
await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="${ROW_ID}"] .cue-duplicate').click()`);
await settle(250);
const duplicated = await evaluate(`(() => {
  const field = (row, selector) => row?.querySelector(selector)?.value ?? null;
  const rows = Array.from(document.querySelectorAll('#rows .cue-row'));
  const source = rows.find((row) => row.dataset.cueId === "${ROW_ID}");
  const sourceAt = source?.querySelector('.cue-at')?.textContent?.trim() || '';
  const copy = rows.find((row) => row !== source && row.querySelector('.cue-at')?.textContent?.trim() === sourceAt);
  return {
    ids: rows.map((row) => row.dataset.cueId),
    copyId: copy?.dataset.cueId || '',
    clashTags: Array.from(source?.querySelectorAll('.cue-tag') || []).map((tag) => tag.textContent.trim()),
    freeButtons: rows.filter((row) => row.querySelector('.cue-free')).length,
    // **The three fields the handoff named and no contract asserted.** duplicateCue clears the number and the
    // label and leaves the group alone, and until now this suite checked only that the copy had an id of its own - so
    // the property "INTER_APP_HANDOFF:374" documented was the one nothing defended. The SOURCE values travel with
    // the read rather than being written into the test, because a literal here would be a second answer to what
    // the fixture says.
    copyNumber: field(copy, '.dense-number'),
    copyLabel: field(copy, '.dense-label'),
    copyGroup: field(copy, '.dense-section'),
    sourceNumber: field(source, '.dense-number'),
    sourceLabel: field(source, '.dense-label'),
    sourceGroup: field(source, '.dense-section'),
  };
})()`);
assert.ok(duplicated.copyId && duplicated.copyId !== ROW_ID,
  `Duplicate must make a cue with an id of its own (ids were ${JSON.stringify(duplicated.ids)})`);
// **The property INTER_APP_HANDOFF:374 described and nothing asserted.**
assert.equal(duplicated.copyNumber, '',
  `the copy must CLEAR its number: two cues numbered the same is what the operator reads out loud, and the handoff recorded exactly this as the defect a mutation could not catch (source was ${JSON.stringify(duplicated.sourceNumber)}, copy got ${JSON.stringify(duplicated.copyNumber)})`);
assert.equal(duplicated.copyLabel, '',
  `and CLEAR its label, for the same reason — the source's label is what the copy would be mistaken for (source was ${JSON.stringify(duplicated.sourceLabel)}, copy got ${JSON.stringify(duplicated.copyLabel)})`);
assert.equal(duplicated.copyGroup, duplicated.sourceGroup,
  `and KEEP the group: a cue duplicated inside a section belongs to that section, and dropping it would move the copy somewhere the operator did not ask for (source was ${JSON.stringify(duplicated.sourceGroup)}, copy got ${JSON.stringify(duplicated.copyGroup)})`);
assert.ok(duplicated.clashTags.includes('clash'),
  `and the frame holds two cues, which the row says rather than resolving silently (got ${JSON.stringify(duplicated.clashTags)})`);
assert.equal(duplicated.freeButtons, 2, 'and BOTH rows of the clash offer the explicit move out of it');
await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="${duplicated.copyId}"] .cue-free').click()`);
await settle(250);
const freed = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('#rows .cue-row'));
  const source = rows.find((row) => row.dataset.cueId === "${ROW_ID}");
  const copy = rows.find((row) => row.dataset.cueId === ${JSON.stringify(duplicated.copyId)});
  return {
    sourceAt: source?.querySelector('.cue-at')?.textContent?.trim() || '',
    copyAt: copy?.querySelector('.cue-at')?.textContent?.trim() || '',
  };
})()`);
assert.notEqual(freed.copyAt, freed.sourceAt,
  `the explicit move must put the copy on a frame of its own (both at ${JSON.stringify(freed.copyAt)})`);

// The lock is a guard on THIS window, not part of the cue list: it marks the row and takes the controls that would
// change it away, so a lock is not a label. It is not written into the show, so no command is involved either.
//
// The lock lives in `localStorage` on purpose — that is what makes it survive a reload — which also means a previous
// run of this suite leaves its own behind. So the row's starting state is READ, and the suite puts it back at the end:
// a fixture that drifts between runs is how a contract starts failing for the wrong reason.
const LOCK_ID = "cue-4";
await evaluate(`window.__INVOKES.length = 0`);
const wasLocked = await evaluate(`document.querySelectorAll('#rows .cue-row[data-cue-id="${LOCK_ID}"].is-locked').length > 0`);
if (wasLocked) {
  await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="${LOCK_ID}"] .cue-lock').click()`);
  await settle(200);
}
await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="${LOCK_ID}"] .cue-lock').click()`);
await settle(200);
const locked = await evaluate(`(() => {
  const row = document.querySelector('#rows .cue-row[data-cue-id="${LOCK_ID}"]');
  return {
    isLocked: Boolean(row?.classList.contains('is-locked')),
    editButtons: row?.querySelectorAll('.cue-edit').length || 0,
    lockText: row?.querySelector('.cue-lock')?.textContent?.trim() || '',
    lockTitle: row?.querySelector('.cue-lock')?.title || '',
    commands: window.__INVOKES.map((entry) => entry.cmd)
      .filter((cmd) => !['timecode_state', 'timecode_pending_cues', 'get_timecode_cues'].includes(cmd)),
  };
})()`);
assert.equal(locked.isLocked, true, 'the lock marks the row on this Mac');
assert.equal(locked.editButtons, 0, 'and takes away the controls that would change it, or a lock is only a colour');
assert.match(locked.lockText, /Locked/i,
  `and the control says the row is locked rather than looking the same as an unlocked one (got ${JSON.stringify(locked.lockText)})`);
assert.match(locked.lockTitle, /Press to unlock it/i,
  `and its tooltip is where the way back is said (got ${JSON.stringify(locked.lockTitle)})`);
assert.deepEqual(locked.commands, [], `nothing about the lock reaches the backend: it is a guard on the window (got ${JSON.stringify(locked.commands)})`);
// Put back, so the next run starts where this one did.
await evaluate(`document.querySelector('#rows .cue-row[data-cue-id="${LOCK_ID}"] .cue-lock').click()`);
await settle(200);
assert.equal(await evaluate(`document.querySelectorAll('#rows .cue-row[data-cue-id="${LOCK_ID}"].is-locked').length`), 0,
  'and the suite leaves the row as it found it, because the lock outlives the run');

// --- 24. the last run, as a record: three readings, and the marks left alone -----------------
//
// **This is the contract item 6 exists for, and the third of its three clauses is the one nothing could assert until
// now.** The record's line carries `Option<bool>` for the skip verdict, so a skip whose verdict was never measured is
// representable - and the view must say **"the position moved"** rather than inherit "jumped", which would assert a
// measurement nobody made. The engine cannot produce that line today; the view must word it anyway, and this stub
// serves one so the wording is pinned.
{
  const before = await evaluate(`document.querySelectorAll('#rows .cue-row .cue-tag').length`);
  await evaluate(`document.getElementById('last-run-show').click()`);
  await settle(200);
  const shown = await evaluate(`(() => {
    const panel = document.getElementById('last-run');
    const lines = Array.from(document.querySelectorAll('#last-run-lines .last-run-line')).map((row) => row.textContent);
    return {
      hidden: panel?.hidden ?? null,
      heading: panel?.querySelector('h2')?.textContent?.trim() ?? null,
      lines,
      marksAfter: document.querySelectorAll('#rows .cue-row .cue-tag').length,
      asked: window.__INVOKES.filter((entry) => entry.cmd === 'timecode_as_run').length,
    };
  })()`);
  assert.equal(shown.asked, 1,
    `opening the last run must ASK for the record - it is not on the poll, so nothing else would ever fetch it (asked ${shown.asked})`);
  assert.equal(shown.heading, 'Last run',
    `and it must be LABELLED as the last run, not folded into the marks (heading was ${JSON.stringify(shown.heading)})`);
  assert.equal(shown.lines.length, 4, `every line of the record must be drawn (got ${shown.lines.length})`);
  assert.ok(shown.lines[0].includes('fired') && !shown.lines[0].includes('the position'),
    `a fired cue says it fired and carries no verdict, because there is none to carry (got ${JSON.stringify(shown.lines[0])})`);
  assert.ok(shown.lines[1].includes('the position jumped 3.2 s'),
    `a measured jump says so with its distance (got ${JSON.stringify(shown.lines[1])})`);
  assert.ok(shown.lines[2].includes('the timecode had stopped arriving for 1.2 s'),
    `a measured dropout says so with its gap (got ${JSON.stringify(shown.lines[2])})`);
  assert.ok(shown.lines[3].includes('the position moved'),
    `AND A SKIP WHOSE VERDICT WAS NEVER MEASURED SAYS "the position moved": it must not inherit "jumped", which would assert a measurement nobody made, in the one view built to tell the two apart (got ${JSON.stringify(shown.lines[3])})`);
  assert.ok(!shown.lines[3].includes('jumped') && !shown.lines[3].includes('stopped arriving'),
    `and it must inherit NEITHER reading (got ${JSON.stringify(shown.lines[3])})`);
  assert.equal(shown.marksAfter, before,
    `and the record must NOT touch the row marks: a mark says what THIS session fired, and this session has fired nothing (before ${before}, after ${shown.marksAfter})`);
  await evaluate(`document.getElementById('last-run-show').click()`);
  await settle(150);
  const closed = await evaluate(`Boolean(document.getElementById('last-run')?.hidden)`);
  assert.ok(closed, 'and pressing it again closes the panel rather than leaving it open with nothing to say');
}
console.log('24. the last run: asked for on open, labelled, three readings, and the marks untouched');

// --- 25. every rate the engine publishes maps to the right frames per second ------------------
//
// **This contract exists because the defect was that NOTHING tested a rate but 25.** MEASURED before the fix: five
// call sites converted the engine's label into this module's key, three did it wrong, and every browser suite mocked the
// snapshot rate as 25 — the single label for which every site agreed, and `timecode.html` agreed there only through a
// `default` arm. So the clock window interpolated at the wrong frames per second for every other rate, and one window
// re-armed cues at a rate its own shift disagreed with.
//
// It asserts the mapping DIRECTLY, for both spellings, at every rate the engine can publish — which is the thing no test
// did. The labels come from `TimecodeRate::label()` (timecode.rs:68-76) and the keys from this module's own tables.
{
  const mapped = await evaluate(`(() => {
    const labels = ["24", "25", "29.97", "23.976", "30"];
    const keys = ["fps24", "fps25", "fps29_97", "fps23_976", "fps30"];
    const wrong = [];
    for (const rate of labels) {
      const got = WingCueList.framesPerSecond({ rate });
      const key = WingCueList.framesPerSecond({ rate: keys[labels.indexOf(rate)] });
      if (got !== key) wrong.push(rate + ": label " + got + " vs key " + key);
      if (!Number.isFinite(got) || got <= 0) wrong.push(rate + " mapped to " + got);
    }
    return { wrong, count: labels.length };
  })()`);
  assert.deepEqual(mapped.wrong, [],
    `every rate the engine publishes must map to the same frames per second under both spellings — the label it prints and the key this module uses — because five call sites hand it one or the other and three of them were wrong while every suite mocked 25: ${mapped.wrong.join("; ")}`);
  assert.equal(mapped.count, 5, 'and all five rates must be checked, not the one that happens to agree everywhere');
}
console.log('25. every published rate maps correctly under both spellings');

console.log('23. the row edits here: the four fields and the nudge, Undo, Duplicate with the explicit clash move, and the lock');

// --- 26. a column is a column, in every row -----------------------------------------------------
//
// **The owner reported this with a screenshot, and no contract here could have caught it.** The fields on
// the cue rows started at a different x on every row. The cause was one property: the dense line was
// \`display: flex; margin-left: auto\`, which RIGHT-ALIGNS the group - so a row's starting x was the row's
// right edge MINUS THAT ROW'S OWN WIDTH, and the macro's name and the repeat value are never the same twice.
//
// So this measures a COORDINATE rather than a string, which is what the other contracts in this tree do not.
// The DOM was always correct; it was the layout that was wrong, and a test that reads the DOM cannot see a
// layout that has stopped agreeing with itself.
{
  const columns = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("#rows .cue-row")];
    const names = ["dense-number", "dense-label", "dense-section", "dense-time", "dense-repeat", "dense-duration"];
    const out = { rows: rows.length, x: {}, wrapped: [], dump: [] };
    for (const name of names) {
      // Only the rows that HAVE the cell: a row with no duration field is not a column that moved.
      const cells = rows.map((row) => row.querySelector("." + name)).filter(Boolean);
      out.x[name] = [...new Set(cells.map((cell) => Math.round(cell.getBoundingClientRect().x)))];
    }
    // **The dimension the first version of this contract was missing, and the owner's second screenshot is what
    // it cost.** A cell can share its column's x and still sit on a different LINE, because that is what a grid
    // does when it runs out of tracks - and a wrapped row is not a row. **The exact question is not "how many
    // pixels apart are these boxes" but "did the grid put them on the same row"**, so this reads the resolved
    // "grid-row-start" rather than measuring a y: a box can be 2px off a sibling because it is a shorter element
    // vertically centred, and that is not a wrapped row. A row number is.
    for (const row of rows) {
      const cells = [...(row.querySelector(".cue-dense") || row).children]
        .filter((el) => getComputedStyle(el).display !== "none");
      const lines = [...new Set(cells.map((el) => getComputedStyle(el).gridRowStart))];
      if (lines.length > 1) {
        out.wrapped.push(row.dataset.cueId + " sits on grid rows " + lines.join(", ") + ": " +
          cells.map((el) => (el.className || el.tagName) + "@row" + getComputedStyle(el).gridRowStart).join(" "));
      }
    }
    // And what else is inside the dense box, in DOM order, with where each one landed. **A child with no
    // grid-column is auto-placed, so it takes a free track and moves everything after it** - which is the shape
    // of this defect, and naming it turns a red test into a direction.
    const box = rows[0] && rows[0].querySelector(".cue-dense");
    if (box) {
      out.dump = [...box.children].map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return \`\${el.className || el.tagName} x=\${Math.round(r.x)} y=\${Math.round(r.y)} w=\${Math.round(r.width)} col=\${cs.gridColumnStart} display=\${cs.display}\`;
      });
    }
    return out;
  })()`);
  assert.ok(columns.rows >= 4, `the rows must be drawn for this to measure anything (got ${columns.rows})`);
  const wandered = Object.entries(columns.x)
    .filter(([, v]) => v.length > 1)
    .map(([k, v]) => `${k} starts at x ${v.join(", ")}`);
  assert.deepEqual(
    wandered,
    [],
    `a column is not a column: these cells start at more than one x across the rows. The dense line used to be RIGHT-ALIGNED by margin-left: auto, so each row began its own width away from the right edge (measured ${JSON.stringify(columns.x)})`,
  );
  assert.deepEqual(
    columns.wrapped,
    [],
    `a row wrapped: these cells sit on a different line from the rest of their own row, which is what a grid does when it runs out of tracks. Everything inside the first dense box, with where it landed: ${JSON.stringify(columns.dump)}`,
  );
  console.log(`26. every column shares its x across ${columns.rows} rows, and no row wraps (${Object.keys(columns.x).length} columns measured)`);
}

// --- 27. a field is a WELL and its number is the kit's mono ----------------------------------------
//
// **The kit's rule 2, and it names both halves**: a number the operator reads is set in the kit number type AND sits
// in a well. The bevel table defines a well as "the same pair, reversed" - dark on the top-left, light on the
// bottom-right - and the row drew the opposite: the default border made every side dark and then LIGHTENED the top
// and the left, which is a raised face, the shape of a control rather than of a readout.
//
// **Measured on the COMPUTED style**, because the kit's tokens resolve at render time and both themes resolve them
// differently. Section 26 measures a coordinate and this measures a colour pair and a font: a source guard can read
// which token a rule names, but only the render says what the token came out as.
{
  const wells = await evaluate(`(() => {
    const fields = [
      ...document.querySelectorAll("#rows .cue-row .cue-editor input"),
      ...document.querySelectorAll("#rows .cue-row .cue-dense input[type=text]"),
    ];
    if (!fields.length) return { count: 0 };
    const root = getComputedStyle(document.body);
    const resolve = (name) => {
      const probe = document.createElement("span");
      probe.style.color = root.getPropertyValue(name).trim();
      document.body.appendChild(probe);
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    };
    const dark = resolve("--line-dark");
    const light = resolve("--line-light");
    const wrong = [];
    for (const field of fields) {
      const s = getComputedStyle(field);
      const id = field.className || field.tagName;
      if (s.borderTopColor !== dark || s.borderLeftColor !== dark) {
        wrong.push(id + ": top/left " + s.borderTopColor + "/" + s.borderLeftColor + " should be " + dark);
      }
      if (s.borderBottomColor !== light || s.borderRightColor !== light) {
        wrong.push(id + ": bottom/right " + s.borderBottomColor + "/" + s.borderRightColor + " should be " + light);
      }
      if (!/mono|Menlo|Consolas|Courier|monospace/i.test(s.fontFamily)) {
        wrong.push(id + ": font " + s.fontFamily + " is not the kit number type");
      }
    }
    return { count: fields.length, wrong: [...new Set(wrong)] };
  })()`);
  assert.ok(wells.count > 0, "the row must draw fields for this to measure anything");
  assert.deepEqual(
    wells.wrong,
    [],
    `a field the row draws is a well - the kit's bevel table gives sunken as "the same pair, reversed", dark on the top-left and light on the bottom-right - and its number is set in the kit number type: ${JSON.stringify(wells.wrong)}`,
  );
  console.log(`27. every field the row draws is a well in the kit's number type (${wells.count} fields)`);
}

// --- 28. a real click on a cue's own field keeps the field, the caret and the selection ------------------------
//
// **The contract that was missing, and the owner found it instead.** Every other check in this file drove a field
// with `value = …` and a dispatched `change`, or with a probe input appended to `<body>` — neither of which is a
// click on a cue. A click on a cue's field selects that row, selecting repaints the list, and the repaint replaced
// the very element under the caret: measured (Chrome and WKWebView, 2026-10-09), `document.activeElement` was `body`
// after the click and the next keystroke changed nothing. The field is put back by `render()` now, and this is the
// measurement with teeth — a real mouse press and a real keystroke, on a row that is NOT already selected, because
// that is the case that rebuilds.
{
  // A known state: nothing selected, so the click below is the one that selects the row and forces the repaint.
  await evaluate(`document.getElementById('rows').click()`);
  await settle(120);
  const target = await evaluate(`(() => {
    const row = document.querySelector('#cue-rows .cue-row[data-cue-id="cue-3"]');
    const field = row.querySelector('.dense-time');
    field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = field.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, value: field.value, selected: row.classList.contains('is-selected') };
  })()`);
  assert.equal(target.selected, false, `the row this measures must start unselected, or the repaint under test does not happen (got ${JSON.stringify(target)})`);

  const clickField = async () => {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await settle(120);
  };
  const typed = async (key) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: `Digit${key}`, text: key, unmodifiedText: key, windowsVirtualKeyCode: key.charCodeAt(0) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: `Digit${key}`, windowsVirtualKeyCode: key.charCodeAt(0) });
    await settle(80);
  };
  const fieldState = () => evaluate(`(() => {
    const field = document.querySelector('#cue-rows .cue-row[data-cue-id="cue-3"] .dense-time');
    return { value: field.value, focused: document.activeElement === field,
             active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null,
             start: field.selectionStart, end: field.selectionEnd };
  })()`);

  await clickField();
  const afterFirst = await fieldState();
  assert.equal(afterFirst.focused, true,
    `a click on a cue's field must leave that field focused — the row repaints itself when the click selects it, and the repaint used to take the field with it (got ${JSON.stringify(afterFirst)})`);
  assert.deepEqual({ start: afterFirst.start, end: afterFirst.end }, { start: 0, end: target.value.length },
    `and the whole value selected, so the first key typed replaces it (got ${JSON.stringify(afterFirst)})`);

  await typed('9');
  const afterTyping = await fieldState();
  assert.equal(afterTyping.value, '9',
    `and one keystroke must REPLACE the value: the click rule exists for this, and a click that rebuilds the row is where it was lost (got ${JSON.stringify(afterTyping)})`);

  // Put the field back before the second click measures the other half: a second click leaves the caret at the END,
  // so typing appends. The value is restored through the field's own path so the draft is not left edited here.
  await evaluate(`(() => {
    const field = document.querySelector('#cue-rows .cue-row[data-cue-id="cue-3"] .dense-time');
    field.value = ${JSON.stringify(target.value)};
    field.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await settle(150);
  // ONE click: the press before it was the first one, so this is the second — and the row was rebuilt in between,
  // which is the state the element-vs-address bug needed. The field is stamped first, because a press inside a row
  // that is ALREADY the selection has nothing to repaint, and repainting it would replace the field under the caret
  // for no reason at all (and cost the frame, on a list of hundreds).
  await evaluate(`document.querySelector('#cue-rows .cue-row[data-cue-id="cue-3"] .dense-time').dataset.probe = "kept"`);
  await clickField();
  const stampKept = await evaluate(`document.querySelector('#cue-rows .cue-row[data-cue-id="cue-3"] .dense-time').dataset.probe === "kept"`);
  assert.equal(stampKept, true,
    'a click inside the row that is already selected must not rebuild the list: nothing about the selection changed, and a rebuild replaces the field the operator is in');
  const afterSecondClick = await fieldState();
  assert.equal(afterSecondClick.focused, true, `the second click must leave the field focused too (got ${JSON.stringify(afterSecondClick)})`);
  assert.deepEqual({ start: afterSecondClick.start, end: afterSecondClick.end }, { start: target.value.length, end: target.value.length },
    `and the caret at the end of the value, not a fresh selection of it (got ${JSON.stringify(afterSecondClick)})`);
  await typed('9');
  const appended = await fieldState();
  assert.equal(appended.value, `${target.value}9`,
    `a second click must leave the caret at the END of the value, so the next key appends — and this is the half that a rebuild between the two clicks used to break: comparing ELEMENTS made the second click look like a first one and select everything again (got ${JSON.stringify(appended)})`);

  await evaluate(`(() => {
    const field = document.querySelector('#cue-rows .cue-row[data-cue-id="cue-3"] .dense-time');
    field.value = ${JSON.stringify(target.value)};
    field.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('rows').click();
  })()`);
  await settle(150);
  console.log("28. a real click on a cue's field keeps the field, and the second click appends at its end");
}

const unexpected = pageErrors.filter((text) => !/ResizeObserver|favicon/.test(text || ""));
assert.deepEqual(unexpected, [], `the window must not have thrown: ${JSON.stringify(unexpected)}`);

console.log("LTC window contract passed: the list is drawn and edited through the shared rules, the inspector explains a cue, Live hides the editing tools, and the window never fires a macro");
console.log("WING_BROWSER_SUITE_OK");
process.exit(0);
