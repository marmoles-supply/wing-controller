// Verifies the Meter Bridge ruler lines up with the meter bars.
//
// The ruler placed its track with hard-coded 34px/62px offsets while the bars measure their fill
// against `.v-bar-track`, whose geometry moves with the strip chrome and the meter scale. Measured,
// the -18 mark sat at y=301.5 while a -18 dBFS bar topped out at y=307.3: about 6 px of drift, which
// makes the ruler useless for judging level.
//
// The check drives the real page in Chrome, feeds a known dBFS value and compares the fill's top
// edge with the centre of the matching ruler mark for several levels.
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is closed.
//
// Run: node scripts/test-desktop-bridge-ruler-browser.mjs
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

await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__TAURI__ = { core: { invoke: async () => ({}) }, event: { listen: async () => () => {} },
    window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, setFocus: async () => {} }) } };`,
});

const url = new URL('../desktop/ui/meters.html', import.meta.url).href;
await call('Page.navigate', { url });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && typeof renderMeters === "function"')) break;
  await sleep(100);
}
// The watchlist starts empty by design, so seed one meter and reload.
// The scale slider only exists in the bars style, and the window remembers the style: it is set
// here, with the page already loaded, so no earlier test can leave this test measuring a DOM
// without the slider (it happened: the style stayed on VU from another check and this test failed).
const previousMetersStyle = await evaluate(`localStorage.getItem('wing_meters_style')`).catch(() => null);
await evaluate(`localStorage.setItem('wing_meters_style', 'bars')`);
await evaluate(`localStorage.setItem('wing_custom_meters', JSON.stringify([{ group: 'usb', id: 1, label: 'USB 1', key: 'usb:1' }]))`);
await call('Page.navigate', { url });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await evaluate('document.readyState === "complete" && document.querySelector(".v-bar-track")')) break;
  await sleep(100);
}
await sleep(400);

const LEVELS = [0, -3, -6, -12, -18, -24, -36, -48];
const results = [];
for (const db of LEVELS) {
  const measured = await evaluate(`(() => {
    // Feed the frame the bridge consumes and let it paint.
    const frame = { meters: [{ key: 'usb:1', value: ${db}, label: 'USB 1' }] };
    if (typeof onMeterFrame === 'function') onMeterFrame(frame);
    else if (typeof handleMeterFrame === 'function') handleMeterFrame(frame);
    const fill = document.querySelector('#v-strips-container .v-meter-fill');
    const track = document.querySelector('#vertical-bridge-container .bridge-scale-track');
    const mark = [...document.querySelectorAll('.ruler-mark')]
      .find((el) => el.textContent.trim() === '${db === 0 ? '0' : String(db)}');
    if (!fill || !track || !mark) return null;
    const fillTop = fill.getBoundingClientRect().top;
    const markBox = mark.getBoundingClientRect();
    const markCenter = markBox.top + markBox.height / 2;
    const barBox = document.querySelector('#v-strips-container .v-bar-track').getBoundingClientRect();
    const trackBox = track.getBoundingClientRect();
    return { fillTop, markCenter, delta: fillTop - markCenter, trackHeight: trackBox.height, barHeight: barBox.height };
  })()`);
  assert.ok(measured, `${db} dBFS: the bridge must expose the strip, the track and the ${db} mark`);
  results.push({ db, ...measured });
  assert.ok(
    Math.abs(measured.delta) <= 1.5,
    `${db} dBFS: the fill must top out on its ruler mark, it is ${measured.delta.toFixed(2)}px off`,
  );
}
const worst = results.reduce((acc, r) => (Math.abs(r.delta) > Math.abs(acc.delta) ? r : acc));
console.log(
  `ruler alignment: ${results.length} levels checked, worst offset ${worst.delta.toFixed(2)}px at ${worst.db} dBFS`,
);
assert.ok(
  Math.abs(results[0].trackHeight - results[0].barHeight) <= 1,
  'the ruler track must be the same box the bars measure their fill against',
);
console.log('ruler track matches the bar track:', results[0].trackHeight.toFixed(1), 'px');

// Leave the shared Chrome profile as it was found: another browser test runs in the same profile and
// a seeded watchlist changes which controls the bridge shows.
await evaluate(`localStorage.removeItem('wing_custom_meters')`);
// This suite also seeded the bridge's meter style, and "leave the shared profile as it was found" was only
// true for the watchlist: the next suite inherited "bars" (audit 2026-10-02, S12).
await evaluate(previousMetersStyle === null
  ? `localStorage.removeItem('wing_meters_style')`
  : `localStorage.setItem('wing_meters_style', ${JSON.stringify(previousMetersStyle)})`).catch(() => {});
socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
