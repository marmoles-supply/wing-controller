// Contracts for the shared instrument (analogue VU and history graph).
//
// What is pinned down here is what the operator notices and is easy to break without realising: that
// the scale is in dBFS (not in "VU" over data that is dBFS), that the needle has real instrument
// ballistics (fast attack, slow release), that both functions really draw, and that the graph's
// history window is what it says it is: the same samples, in the same order, bounded, drawn in place.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import WebSocket from "ws";

let targets;
try {
  const response = await fetch("http://127.0.0.1:9223/json");
  targets = await response.json();
} catch (_) {
  console.error("skipped: No Chrome listening on 9223 (see AGENTS.md)");
  process.exit(3);
}
const candidates = targets.filter((entry) => entry.type === "page" && entry.url.endsWith("/desktop/ui/index.html"));
const target = candidates.find((entry) => entry.url.startsWith("file://")) || candidates[0];
if (!target) {
  console.error("skipped: no tab with desktop/ui/index.html open");
  process.exit(3);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
  return result.result.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (expression, timeout = 9000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await evaluate(expression)) return true;
    if (Date.now() > deadline) return false;
    await sleep(120);
  }
};

await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
assert.ok(await waitFor("typeof window.WingVu === 'object'"), "the instrument module must load");

// --- 1. The scale is labelled in dBFS, with the red zone above 0 ------------------------
const scale = await evaluate("JSON.stringify(window.WingVu.scale)");
const parsed = JSON.parse(scale);
assert.deepEqual(parsed, { min: -60, max: 3, redFrom: 0 },
  `the scale must be dBFS with the red zone from 0 (${scale}); labelling "VU" over data in dBFS misleads`);

// --- 2. Ballistics: attack faster than release ---------------------------------------------
const ballistics = JSON.parse(await evaluate(`(() => {
  const key = "test-ballistics";
  window.WingVu.forget(key);
  const start = window.WingVu.ballistics(key, 0, { attack: 0.5, release: 0.1 });
  const onTheWayUp = window.WingVu.ballistics(key, 100, { attack: 0.5, release: 0.1 });
  const onTheWayDown = window.WingVu.ballistics(key, -100, { attack: 0.5, release: 0.1 });
  return JSON.stringify({
    stepUp: Math.abs(onTheWayUp - start),
    stepDown: Math.abs(onTheWayDown - onTheWayUp),
  });
})()`));
// With attack 0.5 and release 0.1, a jump from 0 to 100 rises 50; from 50 to -100 it falls only 15.
// That is real instrument ballistics, not a bug: the needle chases the signal and returns slowly.
assert.ok(ballistics.stepUp > 40, `the needle must rise fast (rose ${ballistics.stepUp.toFixed(1)})`);
assert.ok(ballistics.stepDown > 0, "and fall towards the signal when it drops");
assert.ok(ballistics.stepDown < ballistics.stepUp,
  `the release must be slower than the attack (${ballistics.stepDown.toFixed(1)} vs ${ballistics.stepUp.toFixed(1)})`);

// --- 3. Both functions really draw ---------------------------------------------------
const painted = JSON.parse(await evaluate(`(() => {
  const count = (ctx, w, h) => {
    const data = ctx.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && (data[i] > 20 || data[i + 1] > 20 || data[i + 2] > 20)) n += 1;
    return n;
  };
  const vu = document.createElement("canvas");
  vu.width = 300; vu.height = 160;
  const vuCtx = vu.getContext("2d");
  window.WingVu.drawAnalog(vuCtx, { width: 300, height: 160, db: -12, peak: -3, label: "PRUEBA", dark: false });
  const graph = document.createElement("canvas");
  graph.width = 300; graph.height = 90;
  const graphCtx = graph.getContext("2d");
  const now = Date.now();
  const samples = Array.from({ length: 120 }, (_, i) => ({ t: now - (119 - i) * 25, v: -30 + Math.sin(i / 5) * 12 }));
  window.WingVu.drawHistory(graphCtx, { width: 300, height: 90, samples, now, windowMs: 3000, peak: -3, dark: false });
  return JSON.stringify({ vu: count(vuCtx, 300, 160), graph: count(graphCtx, 300, 90) });
})()`));
assert.ok(painted.vu > 500, `the VU must paint the scale and the needle (painted ${painted.vu} px)`);
assert.ok(painted.graph > 500, `the graph must paint the grid and the trace (painted ${painted.graph} px)`);

// --- 4. The graph does not break without data --------------------------------------------------------
const empty = await evaluate(`(() => {
  const cv = document.createElement("canvas");
  cv.width = 200; cv.height = 80;
  const ctx = cv.getContext("2d");
  window.WingVu.drawHistory(ctx, { width: 200, height: 80, samples: [], now: Date.now(), windowMs: 3000, dark: true });
  return "ok";
})()`);
assert.equal(empty, "ok", "drawing without samples must not throw");

// --- 5. The sample density is driven by the refresh rate, not by the scroll speed -----------------
// This broke once and the symptom was exactly what the operator reported: the graph looked coarse
// because the samples were spaced by the scroll speed and packets that did arrive were DISCARDED. It
// is checked statically (the render lives in the bridge window) so that it cannot come back without
// tripping the gate.
const bridgeHtml = fs.readFileSync("desktop/ui/meters.html", "utf8");
assert.match(bridgeHtml, /const sampleIntervalMs = 1000 \/ Math\.max\(5, currentGraphRefresh\)/,
  "the sampling interval must come from the refresh rate, not from the scroll speed");
assert.doesNotMatch(bridgeHtml, /const sampleIntervalMs = 1000 \/ Math\.max\(1, currentGraphSpeed\)/,
  "and it must not be tied to the scroll speed again: that discards packets");
assert.match(bridgeHtml, /id="graph-refresh-slider"/, "the bridge must offer the refresh slider");
assert.match(bridgeHtml, /id="graph-speed-slider"/, "and the scroll one separately");
assert.match(bridgeHtml, /localStorage\.setItem\("wing_graph_refresh_fps"/,
  "the refresh slider must save its preference in samples per second");

// --- 6. The bridge zoom is its own, not the sidebar's -----------------------------------
// The two windows shared the `wing_meter_scale` key, so in the real app (same origin, same storage)
// the popup zoom moved the sidebar one. The bridge must write ITS OWN key and not touch the
// workstation window's.
assert.doesNotMatch(bridgeHtml, /setItem\("wing_meter_scale"/,
  "the bridge must not write the sidebar zoom: it has its own key");
assert.match(bridgeHtml, /BRIDGE_SCALE_KEY = "wing_bridge_meter_scale"/,
  "the bridge must declare its zoom key");
assert.match(bridgeHtml, /localStorage\.setItem\(BRIDGE_SCALE_KEY/,
  "and save it when its slider moves");

const zoomSentinel = await evaluate(`(() => {
  // The bridge tab is not open in this suite: the check is done against the HTML itself, which is
  // where the logic that caused the bug lives, and with a sentinel in this window's storage.
  //
  // Both keys are captured and put back: this suite writes into the storage the other suites share, and it
  // used to remove \`wing_meter_scale\` unconditionally, destroying whatever a previous suite had left
  // (audit 2026-10-02, S12).
  const before = {
    scale: localStorage.getItem("wing_meter_scale"),
    bridge: localStorage.getItem("wing_bridge_meter_scale"),
  };
  localStorage.setItem("wing_meter_scale", "1.37");
  localStorage.setItem("wing_bridge_meter_scale", "1.9");
  const untouched = localStorage.getItem("wing_meter_scale") === "1.37";
  const restore = (key, value) => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  };
  restore("wing_meter_scale", before.scale);
  restore("wing_bridge_meter_scale", before.bridge);
  return untouched ? "ok" : "tocado";
})()`);
assert.equal(zoomSentinel, "ok", "the zoom keys must be independent");

// --- 7. The graph history is bounded, chronological and drawn in place --------------------------
// The history IS the drawing: per meter it is a FIFO of {t, v} samples that reaches the drawer as it
// is, without a copy, and the trace is stroked in array order. Master plan 2026-09-22, §8 measured
// the push/shift churn over those samples (21 ns per push+shift at the 1,442 bound, because V8
// left-trims a large fast array instead of moving it; the numbers are next to the push in
// `desktop/ui/meters.html`), and the decision was to keep the FIFO. What is pinned here is what an
// "optimisation" of that churn would silently break: a wrapped ring buffer, a shorter window, one
// extra retained sample or a copied array would all change the trace — and the copy is a failure
// even when the pixels would match, because materialising an ordered array per draw costs 135 ns
// (`slice`) to 4,500 ns (ring copy) per meter against the 21 ns per sample it would save.
const HISTORY_BOUND = 1442; // speed 1x with refresh at 120/s: the widest history one graph meter holds

// The bridge is a different document: it gets its own tab, closed again on exit, so the next test
// still finds index.html in the tab this suite uses.
async function openBridgeTab() {
  const created = await (await fetch("http://127.0.0.1:9223/json/new?about:blank", { method: "PUT" })).json();
  assert.ok(created?.webSocketDebuggerUrl, "the bridge tab must open");
  process.on("exit", () => {
    try {
      execFileSync("curl", ["-s", "-o", "/dev/null", `http://127.0.0.1:9223/json/close/${created.id}`]);
    } catch (_) {}
  });
  const bridgeSocket = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    bridgeSocket.addEventListener("open", resolve, { once: true });
    bridgeSocket.addEventListener("error", reject, { once: true });
  });
  let bridgeNextId = 0;
  const bridgePending = new Map();
  bridgeSocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = bridgePending.get(message.id);
    if (!entry) return;
    bridgePending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++bridgeNextId;
      bridgePending.set(id, { resolve, reject });
      bridgeSocket.send(JSON.stringify({ id, method, params }));
    });
  const evaluateOnBridge = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
    return result.result.value;
  };
  return { call, evaluate: evaluateOnBridge, close: () => bridgeSocket.close() };
}

const bridge = await openBridgeTab();
await bridge.call("Page.enable");
await bridge.call("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
await bridge.call("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__TAURI__ = { core: { invoke: async () => ({}) }, event: { listen: async () => () => {} },
    window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, setFocus: async () => {} }) } };`,
});
await bridge.call("Page.navigate", { url: new URL("../desktop/ui/meters.html", import.meta.url).href });
let bridgeReady = false;
for (let attempt = 0; attempt < 80 && !bridgeReady; attempt += 1) {
  bridgeReady = await bridge.evaluate('document.readyState === "complete" && typeof renderMeters === "function"');
  if (!bridgeReady) await sleep(100);
}
assert.ok(bridgeReady, "the bridge window must load");

// The watchlist and the two sliders are set in the page and not in localStorage: another browser test
// shares this profile, and a seeded watchlist changes what the next one sees. Speed 1x with refresh
// at 120/s is the widest the history can be.
const cards = await bridge.evaluate(`(() => {
  watchlist = Array.from({ length: 4 }, (_, i) => ({ group: "usb", id: i + 1, label: "USB " + (i + 1), key: "usb:" + (i + 1), alias: "" }));
  activeGroupFilter = "all";
  activeBankFilter = "all";
  currentStyle = "graph";
  currentGraphSpeed = 1;
  currentGraphRefresh = 120;
  graphRefreshCache = { value: 120, at: Number.MAX_SAFE_INTEGER };
  loadGraphRefresh = () => 120;
  renderMeters();
  return document.querySelectorAll(".canvas-card").length;
})()`);
assert.equal(cards, 4, "four graph cards must be drawn for the four watchlist meters");

const hooked = await bridge.evaluate(`(() => {
  window.__hist = { calls: 0, copies: 0, outOfOrder: 0, overBound: 0, maxLen: 0, minGapMs: Infinity };
  const realDraw = window.WingVu.drawHistory;
  window.WingVu.drawHistory = function (ctx, options) {
    const samples = options && options.samples;
    const owner = Object.entries(historyGraphData).find((entry) => entry[1] === samples);
    window.__hist.calls += 1;
    if (!owner) {
      window.__hist.copies += 1;
    } else {
      if (samples.length > ${HISTORY_BOUND}) window.__hist.overBound += 1;
      if (samples.length > window.__hist.maxLen) window.__hist.maxLen = samples.length;
      for (let i = 1; i < samples.length; i += 1) {
        if (!(samples[i].t > samples[i - 1].t)) window.__hist.outOfOrder += 1;
        const gap = samples[i].t - samples[i - 1].t;
        if (gap < window.__hist.minGapMs) window.__hist.minGapMs = gap;
      }
    }
    return realDraw.apply(this, arguments);
  };
  return "ok";
})()`);
assert.equal(hooked, "ok", "the drawer must be observable");

// The state ~24 s of frames would have produced, written directly with the page's own interval so the
// next real frame continues the same timeline — and deliberately OVERFILLED past the bound: the page
// itself has to trim the window back to what these settings say it holds (1,442 at 1x and 120/s), so a
// "chunked drop" that keeps twice as many samples fails here instead of quietly widening the trace.
const HISTORY_OVERFILL = 3000;
const prefilled = await bridge.evaluate(`(() => {
  const now = Date.now();
  const interval = 1000 / 120;
  watchlist.forEach((item) => {
    const arr = historyGraphData[item.key] || (historyGraphData[item.key] = []);
    while (arr.length < ${HISTORY_OVERFILL}) arr.push({ t: now - (${HISTORY_OVERFILL} - arr.length) * interval, v: -30 });
    historyGraphLastPush[item.key] = 0;
  });
  return watchlist.length;
})()`);
assert.equal(prefilled, 4, "the four histories must be filled past the bound");

const feedBridge = (ms) => bridge.evaluate(`(async () => {
  const t0 = performance.now();
  let frames = 0;
  await new Promise((resolve) => {
    const step = () => {
      frames += 1;
      queueMeterFrame({ session_id: 0, meters: watchlist.map((w, i) => ({ key: w.key, label: w.label, value: -30 + 10 * Math.sin((frames + i) / 7) })) });
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  return frames;
})()`);

// First feed: only to let the page trim the overfilled window down to its own bound.
const trimFrames = await feedBridge(300);
const trimmed = await bridge.evaluate(`JSON.stringify(watchlist.map((item) => historyGraphData[item.key].length))`);
assert.deepEqual(JSON.parse(trimmed), [HISTORY_BOUND, HISTORY_BOUND, HISTORY_BOUND, HISTORY_BOUND],
  `the graph window must hold ${HISTORY_BOUND} samples per meter at 1x and 120/s, not whatever it was given (${trimmed})`);

const fed = await bridge.evaluate(`(async () => {
  const key = watchlist[0].key;
  const before = historyGraphData[key].slice();
  const t0 = performance.now();
  let frames = 0;
  await new Promise((resolve) => {
    const step = () => {
      frames += 1;
      queueMeterFrame({ session_id: 0, meters: watchlist.map((w, i) => ({ key: w.key, label: w.label, value: -30 + 10 * Math.sin((frames + i) / 7) })) });
      if (performance.now() - t0 < 400) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  const arr = historyGraphData[key];
  // How many samples the feed dropped: where the sample now at the front sat in the snapshot, found
  // by identity (it is the same object; the sample times are unique because of the refresh tick).
  const dropped = before.indexOf(arr[0]);
  let sameObjects = dropped >= 0;
  for (let i = 0; dropped >= 0 && i < before.length - dropped; i += 1) {
    if (arr[i] !== before[i + dropped]) sameObjects = false;
  }
  const hist = window.__hist;
  return {
    frames: frames + ${trimFrames},
    length: arr.length,
    anchored: dropped >= 0,
    dropped,
    appended: arr.length - before.length + Math.max(0, dropped),
    sameObjects,
    newestIsLast: arr[arr.length - 1].t > before[before.length - 1].t,
    history: {
      calls: hist.calls,
      copies: hist.copies,
      outOfOrder: hist.outOfOrder,
      overBound: hist.overBound,
      maxLen: hist.maxLen,
      minGapMs: hist.minGapMs === Infinity ? -1 : hist.minGapMs,
    },
  };
})()`);
bridge.close();

assert.ok(fed.frames > 3, `the bridge must paint during the feed (painted ${fed.frames} frames)`);
assert.ok(fed.anchored, "the samples drawn during the feed must still be the ones the window already held");
assert.ok(fed.dropped >= 1, `the real path must have pushed samples (dropped ${fed.dropped})`);
assert.equal(fed.length, HISTORY_BOUND,
  `the history must stay at its bound while it runs, not grow past it or shrink (it holds ${fed.length})`);
assert.ok(fed.sameObjects,
  "the samples kept must be the same objects in the same order: dropping the oldest cannot reorder or copy them");
assert.equal(fed.appended, fed.dropped, "each sample appended must drop exactly one from the front");
assert.ok(fed.newestIsLast, "the newest sample must be the last one drawn");
assert.ok(fed.history.calls > 0, "the drawer must be called with the graph history");
assert.equal(fed.history.copies, 0, "the drawer must be handed the live array, never a copy or a wrapped view");
assert.equal(fed.history.outOfOrder, 0, "the samples must be strictly chronological: the trace is stroked in array order");
assert.equal(fed.history.maxLen, HISTORY_BOUND,
  `at 120/s and 1x the graph must really hold ${HISTORY_BOUND} samples (it drew ${fed.history.maxLen})`);
assert.equal(fed.history.overBound, 0, `no draw may see more than ${HISTORY_BOUND} samples`);
assert.ok(fed.history.minGapMs >= 8,
  `two samples must not be closer than the 120/s tick (closest ${fed.history.minGapMs} ms)`);
console.log(
  `graph history: ${fed.length} samples per meter at the bound, ${fed.dropped} dropped in ${fed.frames} frames, ` +
  `${fed.history.calls} draws of the live array, closest samples ${fed.history.minGapMs.toFixed(2)} ms apart`,
);

socket.close();
console.log("desktop vu and graph contracts passed");

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
