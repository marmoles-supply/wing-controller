// Verifies that a HUD alert cannot leave the operator without an emergency stop, and that an
// avalanche of alerts does not turn into a showstopper.
//
// Operator report (2026-09-22): a macro with a HUD alert + sound firing very often left the card
// stuck on screen —every firing reopened it, with a new beep— and the PANIC STOP button stayed
// under the scrim: it could not be pressed, nor could the operator disconnect.
//
// It checks, against the real script of both windows:
//   1. With a `center_hud` alert active —and also with a modal dialogue in front— the header PANIC
//      STOP is still the element that receives the click at its own centre (the header floats).
//   2. The alert card brings its own PANIC STOP and its click runs `panic_stop` through the same
//      path as the header button; the stop clears the alert and refuses alerts for 3 s.
//   3. An identical repeated alert is grouped: it is counted on screen, it does not restart the card
//      endlessly, it does not create an `AudioContext` per beep (one only per session) and past its
//      budget it stays still —no flash, no countdown and no sound— until someone closes it.
//   4. A DIFFERENT alert is never swallowed: it is presented at once even if the chain is frozen.
//   5. Courtesy notices are not stacked endlessly either: the card of the same macro is replaced,
//      there are never more than three and the chime goes at most once per second.
//   5b. The notice's size, duration, accent colour and flash are adjustable from Settings, and the
//      accent cannot repaint a failure: a failed action keeps the app's red and a test keeps its
//      blue, because those two fills are what the card is saying.
//   6. The bridge has the same button and stops the stream with the same command.
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it if the port is closed, and
// running it by hand is also a no-op in that case.
//
// Run: node scripts/test-desktop-hud-panic-browser.mjs
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
// A fake `AudioContext`: it counts contexts and beeps without making a sound. With the previous code
// each alert created a new context and each beep left one alive (the browser ends up throttling them).
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__INVOKES = [];
    window.__AUDIO = { contexts: 0, beeps: 0 };
    window.__TAURI__ = {
      core: { invoke: async (cmd) => { window.__INVOKES.push(cmd); return {}; } },
      event: { listen: async () => () => {} },
    };
    class FakeAudioContext {
      constructor() { window.__AUDIO.contexts += 1; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      createOscillator() {
        return {
          type: '', frequency: { value: 0 },
          connect: (node) => node,
          start: () => { window.__AUDIO.beeps += 1; },
          stop: () => {},
        };
      }
      createGain() { return { gain: { value: 0 }, connect: (node) => node }; }
      resume() { this.state = 'running'; }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  `,
});
const uiDir = new URL('../desktop/ui/', import.meta.url);

async function loadWindow(fileName) {
  await call('Page.navigate', { url: new URL(fileName, uiDir).href });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate('document.readyState === "complete" && typeof showHudAlert === "function"')) return;
    await sleep(100);
  }
  assert.fail(`${fileName} must expose the HUD engine`);
}

// The window has to be wide: with the default headless width the header stacks and the button ends
// up out of view, which is not what is being tested.
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// ── 1. Header + card button in the main window ────────────────────────────────────────
await loadWindow('index.html');
await evaluate('window.scrollTo(0, 0)');
await evaluate(`showHudAlert({
  title: 'ALERT STORM', message: 'macro firing hard', urgency: 'panic',
  flashStyle: 'strobe', displayMode: 'center_hud', durationMs: 5000, sound: 'beep',
})`);
await sleep(120);

const overlayActive = await evaluate('document.getElementById("hud-alert-overlay").classList.contains("active")');
assert.ok(overlayActive, 'the alert must be on screen');
const bodyFlag = await evaluate('document.body.classList.contains("hud-alert-active")');
assert.ok(bodyFlag, 'the body must flag the active alert so the header can float above it');

const headerHit = await evaluate(`(() => {
  const button = document.getElementById('top-panic-stop');
  if (!button) return { found: false };
  const rect = button.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { found: true, visible: false };
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const hit = document.elementFromPoint(x, y);
  return {
    found: true, visible: true, x, y,
    hitId: hit?.id || '',
    hitTag: hit?.tagName || '',
    inside: Boolean(hit && (hit === button || button.contains(hit))),
  };
})()`);
assert.ok(headerHit.found && headerHit.visible, 'the header PANIC STOP must be laid out');
assert.ok(
  headerHit.inside,
  `with a center HUD alert up, PANIC STOP must still take the click (hit ${headerHit.hitTag}#${headerHit.hitId} at ${headerHit.x},${headerHit.y})`,
);

// And with a modal dialogue in front (the "popups" case from the report) the header stays on top.
// Note: `evaluate` awaits promises, so the confirm is launched without returning its promise (it
// resolves when Cancel is pressed, further down).
await evaluate('(() => { win95Confirm({ title: "DIALOG CHECK", message: "while this is open", confirmLabel: "OK" }); return true; })()');
await sleep(80);
const dialogHit = await evaluate(`(() => {
  const button = document.getElementById('top-panic-stop');
  const rect = button.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
  const dialogOpen = Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
    .some((el) => getComputedStyle(el).display !== 'none');
  return { dialogOpen, inside: Boolean(hit && (hit === button || button.contains(hit))), hitId: hit?.id || '' };
})()`);
assert.ok(dialogHit.dialogOpen, 'the modal dialog must be open for this check to mean anything');
assert.ok(
  dialogHit.inside,
  `with a modal dialog open, PANIC STOP must still take the click (hit #${dialogHit.hitId})`,
);
await evaluate('document.getElementById("win95-confirm-cancel").click()');
await sleep(80);
const dialogClosed = await evaluate(`Array.from(document.querySelectorAll('.win95-dialog-backdrop'))
  .some((el) => getComputedStyle(el).display !== 'none')`);
assert.equal(dialogClosed, false, 'the modal dialog must be closed again');

const cardHasPanic = await evaluate('Boolean(document.querySelector("#hud-alert-overlay #hud-panic-btn"))');
assert.ok(cardHasPanic, 'the alert card must carry its own PANIC STOP');
const repeatHiddenOnFirst = await evaluate('getComputedStyle(document.getElementById("hud-overlay-repeat")).display');
assert.equal(repeatHiddenOnFirst, 'none', 'a first alert must not claim to be a repeat');

// ── 2. A different alert is never swallowed even while the chain is alive ──────────────────────────────────
await evaluate(`showHudAlert({ title: 'DIFFERENT', message: 'new information', urgency: 'info',
  flashStyle: 'static', displayMode: 'center_hud', durationMs: 0 })`);
await sleep(60);
const different = await evaluate(`(() => ({
  active: document.getElementById('hud-alert-overlay').classList.contains('active'),
  title: document.getElementById('hud-overlay-title').textContent,
  repeat: document.getElementById('hud-overlay-repeat').textContent,
}))()`);
assert.equal(different.active, true, 'a different alert must be shown even in the middle of a storm');
assert.equal(different.title, 'DIFFERENT', 'the new alert must replace the repeating one');
assert.equal(different.repeat, '', 'a new chain must not claim repeats');

// ── 3. Storm: it is grouped, it does not restart endlessly, one single AudioContext and it freezes ─────────────────
// Short duration on purpose: the chain budget is 3 durations (600 ms), so the freeze shows up in the
// test without waiting the 15 s of a 5 s alert.
const stormConfig = `{ title: 'STORM', message: 'same alert again', urgency: 'warning',
  flashStyle: 'strobe', displayMode: 'center_hud', durationMs: 200, sound: 'beep' }`;
await evaluate(`showHudAlert(${stormConfig})`);
for (let i = 0; i < 8; i += 1) {
  await sleep(150);
  await evaluate(`showHudAlert(${stormConfig})`);
}
const storm = await evaluate(`(() => {
  const overlay = document.getElementById('hud-alert-overlay');
  const repeat = document.getElementById('hud-overlay-repeat');
  return {
    active: overlay.classList.contains('active'),
    className: overlay.className,
    repeatText: repeat.textContent,
    audio: window.__AUDIO,
  };
})()`);
assert.ok(storm.active, 'a repeating alert must stay on screen, not blink in and out');
assert.match(storm.repeatText, /Repeating ×[2-9]/, `the card must count the repeats (got "${storm.repeatText}")`);
assert.match(
  storm.repeatText,
  /stays until you dismiss/i,
  `past its budget the alert must say it stays put (got "${storm.repeatText}")`,
);
assert.ok(
  !storm.className.includes('hud-flash-strobe'),
  `a frozen repeat must stop strobing (classes: ${storm.className})`,
);
assert.ok(storm.audio.contexts <= 1, `one AudioContext for the whole session (got ${storm.audio.contexts})`);
assert.ok(storm.audio.beeps <= 3, `the storm must not beep on every repeat (got ${storm.audio.beeps} beeps)`);

// ── 4. PANIC STOP: the card button, through the same path as the header one ────────────────
await evaluate('document.getElementById("hud-panic-btn").click()');
await sleep(120);
const invokesAfterCardPanic = await evaluate('window.__INVOKES.slice()');
assert.ok(
  invokesAfterCardPanic.includes('panic_stop'),
  `the in-card PANIC STOP must run panic_stop (invokes: ${invokesAfterCardPanic.join(', ')})`,
);
const overlayAfterPanic = await evaluate('document.getElementById("hud-alert-overlay").classList.contains("active")');
assert.equal(overlayAfterPanic, false, 'PANIC STOP must clear the alert from the screen');
const bodyFlagAfterPanic = await evaluate('document.body.classList.contains("hud-alert-active")');
assert.equal(bodyFlagAfterPanic, false, 'PANIC STOP must drop the header lift with the alert');

// What was left in the queue during the stop does not cover the window again, and stays in the log.
await evaluate(`showHudAlert({ title: 'QUEUED', message: 'still in the queue', urgency: 'panic', displayMode: 'center_hud', durationMs: 5000 })`);
await sleep(60);
const stillHidden = await evaluate('document.getElementById("hud-alert-overlay").classList.contains("active")');
assert.equal(stillHidden, false, 'alerts queued during the panic must stay off the screen');
const logAfterMute = await evaluate('document.getElementById("log-output").textContent');
assert.match(
  logAfterMute,
  /hud_alert_ignored_after_panic/,
  'the ignored alert must be visible in the session log, not swallowed in silence',
);

// ── 4b. F12 in the workstation window: the same stop, with the alert on top ───────────────────────────
// The previous stop mutes alerts for 3 s on purpose, so it waits for that to pass before checking
// the keyboard route WITH the alert on screen (otherwise the test would pass vacuously).
await sleep(3200);
await evaluate(`showHudAlert({ title: 'F12 CHECK', message: 'keyboard route', urgency: 'panic',
  flashStyle: 'static', displayMode: 'center_hud', durationMs: 0 })`);
await sleep(60);
const beforeF12InDock = await evaluate(`document.getElementById('hud-alert-overlay').classList.contains('active')`);
assert.ok(beforeF12InDock, 'the alert must be on screen before pressing F12');
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true }))`);
await sleep(120);
const f12InDock = await evaluate(`(() => ({
  invokes: window.__INVOKES.slice(),
  overlay: document.getElementById('hud-alert-overlay').classList.contains('active'),
}))()`);
assert.ok(f12InDock.invokes.includes('panic_stop'), 'F12 in the workstation must run panic_stop');
assert.equal(f12InDock.overlay, false, 'F12 must clear the alert from the screen too');

// ── 5. Courtesy notices: cap of three, grouped by macro and an accelerated chime ──────────────────
await evaluate('localStorage.setItem("wing_courtesy_notice_prefs", JSON.stringify({ soundEnabled: true, durationMs: 60000 }))');
const notices = await evaluate(`(() => {
  const beepsBefore = window.__AUDIO.beeps;
  const macro = (name) => ({
    name,
    actionSteps: [{ actionMode: 'hud_alert', alertTitle: 'GO', alertMessage: 'now' }],
    wingIp: '192.168.1.10',
    triggerOperator: '>',
    triggerThreshold: -18,
  });
  for (let i = 0; i < 8; i += 1) showCourtesyNotice(macro('STORM MACRO'), {});
  const afterSameMacro = document.getElementById('courtesy-notice-container').children.length;
  for (let i = 0; i < 5; i += 1) showCourtesyNotice(macro('OTHER ' + i), {});
  return {
    afterSameMacro,
    afterManyMacros: document.getElementById('courtesy-notice-container').children.length,
    chimes: window.__AUDIO.beeps - beepsBefore,
  };
})()`);
assert.equal(notices.afterSameMacro, 1, `the same macro must reuse one notice card (got ${notices.afterSameMacro})`);
assert.ok(
  notices.afterManyMacros <= 3,
  `courtesy notices must be capped at three cards (got ${notices.afterManyMacros})`,
);
assert.ok(notices.chimes <= 1, `the courtesy chime must be throttled (got ${notices.chimes})`);
await evaluate('document.getElementById("courtesy-notice-container").innerHTML = ""');

// ── 5b. The notice's size, duration, accent and flash are adjustable — and the accent cannot
//        repaint a failure ─────────────────────────────────────────────────────────────────────
// Every control here is pressed the way an operator presses it: the sliders dispatch `input` and the
// selects dispatch `change`, so these contracts cover the wiring and not merely the preference
// reader. The colour contract is the one that matters most, because an accent able to recolour a
// failed action into an ordinary notice would be a report that lies.
const courtesyControls = await evaluate(`(() => {
  const ids = ['pref-courtesy-duration', 'pref-courtesy-scale', 'pref-courtesy-accent', 'pref-courtesy-flash'];
  return {
    present: ids.every((id) => Boolean(document.getElementById(id))),
    disabled: ids.some((id) => document.getElementById(id)?.disabled === true),
    promisedFuture: ids
      .map((id) => document.getElementById(id)?.title || '')
      .some((title) => /arrives with|not yet|coming soon/i.test(title)),
  };
})()`);
assert.ok(courtesyControls.present, 'the notice settings must offer size, duration, accent and flash');
assert.equal(courtesyControls.disabled, false, 'no courtesy control may be disabled');
assert.equal(courtesyControls.promisedFuture, false, 'no courtesy tooltip may promise a future feature');

const sizing = await evaluate(`(() => {
  const slider = document.getElementById('pref-courtesy-scale');
  const headerSize = () => {
    document.getElementById('courtesy-notice-container').innerHTML = '';
    showCourtesyNotice({ name: 'SIZE PROBE', actionAddress: '/ch/1/mute', actionArgKind: 'int', actionValue: 1 }, {});
    const header = document.querySelector('#courtesy-notice-container .courtesy-notice-header');
    return parseFloat(getComputedStyle(header).fontSize);
  };
  const set = (value) => { slider.value = value; slider.dispatchEvent(new Event('input', { bubbles: true })); };
  set('1');
  const atOne = headerSize();
  set('1.6');
  const atLarge = headerSize();
  return { atOne, atLarge, readout: document.getElementById('pref-courtesy-scale-readout').textContent.trim() };
})()`);
assert.ok(
  sizing.atLarge > sizing.atOne * 1.4,
  `the size slider must enlarge the rendered card, not only the preference (got ${sizing.atOne}px then ${sizing.atLarge}px)`,
);
assert.match(sizing.readout, /160/, 'the size readout must follow the slider');

const persistent = await evaluate(`(() => {
  const slider = document.getElementById('pref-courtesy-duration');
  slider.value = '0';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('courtesy-notice-container').innerHTML = '';
  showCourtesyNotice({ name: 'PERSIST PROBE', actionAddress: '/ch/1/mute', actionArgKind: 'int', actionValue: 1 }, {});
  const card = document.querySelector('#courtesy-notice-container .courtesy-notice-card');
  return {
    readout: document.getElementById('pref-courtesy-duration-readout').textContent.trim(),
    barHidden: getComputedStyle(card.querySelector('.courtesy-progress-bar')).display === 'none',
  };
})()`);
assert.match(persistent.readout, /Persistent/i, 'a zero duration must read as Persistent');
assert.equal(persistent.barHidden, true, 'a persistent card must not draw a draining bar');
await sleep(900);
const stillThere = await evaluate(`document.querySelectorAll('#courtesy-notice-container .courtesy-notice-card').length`);
assert.equal(stillThere, 1, `a persistent card must survive the standard notice's dismiss time (got ${stillThere})`);

const dismissed = await evaluate(`(() => {
  const slider = document.getElementById('pref-courtesy-duration');
  slider.value = '0.5';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('courtesy-notice-container').innerHTML = '';
  showCourtesyNotice({ name: 'SHORT PROBE', actionAddress: '/ch/1/mute', actionArgKind: 'int', actionValue: 1 }, {});
  return document.getElementById('courtesy-notice-container').children.length;
})()`);
assert.equal(dismissed, 1, 'the short notice must appear');
// The dismissal is a **timer**, and a fixed sleep against a timer is the flake class this repository has already been
// bitten by — this exact assertion failed in a gate run and passed on the quiet tree, which is the signature. It is
// polled now, bounded, the same way the action-target suite was fixed: the property under test is that the card
// dismisses **itself**, and how many milliseconds that takes is not the contract.
let goneAfter = 1;
for (let attempt = 0; attempt < 40; attempt += 1) {
  goneAfter = await evaluate(`document.querySelectorAll('#courtesy-notice-container .courtesy-notice-card').length`);
  if (goneAfter === 0) break;
  await sleep(50);
}
assert.equal(goneAfter, 0, `a 0.5 s notice must dismiss itself on its own timer (got ${goneAfter} after up to 2 s)`);

const accenting = await evaluate(`(() => {
  const picker = document.getElementById('pref-courtesy-accent');
  picker.value = '#ff00aa';
  picker.dispatchEvent(new Event('input', { bubbles: true }));
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  const headerBackground = (runtime) => {
    document.getElementById('courtesy-notice-container').innerHTML = '';
    showCourtesyNotice({ name: 'ACCENT PROBE', actionAddress: '/ch/1/mute', actionArgKind: 'int', actionValue: 1 }, runtime);
    const header = document.querySelector('#courtesy-notice-container .courtesy-notice-header');
    return getComputedStyle(header).backgroundColor;
  };
  return {
    normal: headerBackground({}),
    failed: headerBackground({ error: 'the action could not be sent' }),
    test: headerBackground({ testShoot: true, lastEvent: 'manual_test' }),
  };
})()`);
assert.equal(accenting.normal, 'rgb(255, 0, 170)', `the accent must repaint an ordinary notice (got ${accenting.normal})`);
assert.equal(accenting.failed, 'rgb(139, 0, 0)', `a failed action must keep the app's red (got ${accenting.failed})`);
assert.notEqual(accenting.test, accenting.normal, 'a test must keep its own colour, not the accent');

const flashing = await evaluate(`(() => {
  const mode = document.getElementById('pref-courtesy-flash');
  const draw = (runtime) => {
    document.getElementById('courtesy-notice-container').innerHTML = '';
    showCourtesyNotice({ name: 'FLASH PROBE', actionAddress: '/ch/1/mute', actionArgKind: 'int', actionValue: 1 }, runtime);
    const card = document.querySelector('#courtesy-notice-container .courtesy-notice-card');
    return card.classList.contains('courtesy-flash');
  };
  const set = (value) => { mode.value = value; mode.dispatchEvent(new Event('change', { bubbles: true })); };
  set('off');
  const offOnNormal = draw({});
  const offOnFailure = draw({ error: 'boom' });
  set('error');
  const failureOnlyOnNormal = draw({});
  const failureOnlyOnFailure = draw({ error: 'boom' });
  set('always');
  const alwaysOnNormal = draw({});
  return { offOnNormal, offOnFailure, failureOnlyOnNormal, failureOnlyOnFailure, alwaysOnNormal };
})()`);
assert.equal(flashing.offOnNormal, false, 'the flash must be off by default');
assert.equal(flashing.offOnFailure, false, 'the flash must be off by default, a failure included');
assert.equal(flashing.failureOnlyOnNormal, false, '"only when an action failed" must not flash an ordinary notice');
assert.equal(flashing.failureOnlyOnFailure, true, '"only when an action failed" must flash a failure');
assert.equal(flashing.alwaysOnNormal, true, '"on every notice" must flash an ordinary notice');
await evaluate(`(() => {
  document.getElementById('courtesy-notice-container').innerHTML = '';
  localStorage.setItem('wing_courtesy_notice_prefs', JSON.stringify({ durationMs: 3500, position: 'pos-bottom-right', soundEnabled: false, defaultForNew: false, scale: 1, accent: '', flash: 'off' }));
  applyCourtesyNoticeContainerStyles();
})()`);

// ── 6. The bridge: same button, same command ─────────────────────────────────────────────────────────
await loadWindow('meters.html');
await evaluate('window.scrollTo(0, 0)');
await evaluate(`showHudAlert({ title: 'BRIDGE ALERT', message: 'stop from here', urgency: 'panic',
  flashStyle: 'strobe', displayMode: 'fullscreen', durationMs: 0 })`);
await sleep(80);
const bridge = await evaluate(`(() => {
  const button = document.getElementById('hud-panic-btn');
  return {
    present: Boolean(button),
    overlay: document.getElementById('hud-alert-overlay').classList.contains('active'),
    label: button ? button.textContent.trim() : '',
  };
})()`);
assert.ok(bridge.present, 'the Meter Bridge alert must carry its own PANIC STOP');
assert.ok(bridge.overlay, 'the bridge alert must be on screen');
assert.match(bridge.label, /PANIC/, `the bridge button must say PANIC (got "${bridge.label}")`);
await evaluate('document.getElementById("hud-panic-btn").click()');
await sleep(120);
const bridgeInvokes = await evaluate('window.__INVOKES.slice()');
assert.ok(bridgeInvokes.includes('panic_stop'), 'the bridge PANIC STOP must run panic_stop');
const bridgeStatus = await evaluate('document.getElementById("hud-panic-status").textContent');
assert.match(bridgeStatus, /PANIC STOP sent|PANIC STOP FAILED/, `the bridge must report the panic (got "${bridgeStatus}")`);

// And with the keyboard, which is the route that does not depend on which window has the mouse focus.
await sleep(1400);
await evaluate(`showHudAlert({ title: 'BRIDGE F12', message: 'keyboard route', urgency: 'panic',
  flashStyle: 'static', displayMode: 'fullscreen', durationMs: 0 })`);
const beforeF12 = await evaluate('window.__INVOKES.length');
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true }))`);
await sleep(150);
const f12InBridge = await evaluate(`(() => ({
  invokes: window.__INVOKES.slice(),
  overlay: document.getElementById('hud-alert-overlay').classList.contains('active'),
  status: document.getElementById('status-center').textContent,
}))()`);
assert.ok(
  f12InBridge.invokes.length > beforeF12 && f12InBridge.invokes.includes('panic_stop'),
  `F12 in the Meter Bridge must run panic_stop (invokes: ${f12InBridge.invokes.join(', ')})`,
);
// The bridge leaves the acknowledgement 1.2 s on the card before closing it, so it gets that margin.
await sleep(1400);
const bridgeCleared = await evaluate(`document.getElementById('hud-alert-overlay').classList.contains('active')`);
assert.equal(bridgeCleared, false, 'F12 in the bridge must clear the alert');
assert.match(f12InBridge.status, /PANIC STOP/, `the bridge status bar must acknowledge the panic (got "${f12InBridge.status}")`);

console.log('1. with a HUD alert up, and with a modal dialog open, the header PANIC STOP takes the click');
console.log('2. a different alert is never swallowed');
console.log('3. a repeated alert is counted, throttled, silenced and finally frozen instead of blinking');
console.log('4. the alert card has its own PANIC STOP, it stops the stream, clears the alert and mutes further ones');
console.log('4b. F12 stops the stream from both windows, with the alert on screen');
console.log('5. courtesy notices are capped, grouped by macro and their chime is throttled');
console.log('5b. the notice is sizeable, its duration is adjustable, and its accent cannot repaint a failure');
console.log('6. the Meter Bridge alert carries the same PANIC STOP');
console.log('desktop hud panic contracts passed');

// Without closing the socket the process stays alive and the gate kills it by watchdog.
socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
