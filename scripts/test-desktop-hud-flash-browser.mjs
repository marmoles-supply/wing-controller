// Verifies the HUD alert flash never dims or hides the alert (or the window in fullscreen).
// Runs the same suite in both windows: the main window and the Meter Bridge, which each have
// their own copy of the alert engine and the CSS.
//
// The old implementation animated `opacity` from 1 to 0.15 on the card — and, in fullscreen,
// on the overlay itself — so a strobing alert made the whole window appear and disappear.
// The flash must be a COLOUR highlight: the alert keeps opacity 1 at every instant of the
// animation while a ring, the title bar or the overlay background changes colour.
//
// Checks, against the real index.html script:
//   1. Every urgency x flash style x display mode keeps opacity 1 on overlay, card, title bar,
//      body and message, sampled repeatedly across a full animation cycle.
//   2. Strobe and pulse actually highlight something (the animated property really changes).
//   3. Static flashes no animation at all.
//   4. A custom alert colour still flashes in fullscreen, where the custom background wins.
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is
// closed, and running it directly is a no-op in that case too.
//
// Run: node scripts/test-desktop-hud-flash-browser.mjs
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

// Own tab: this test navigates and installs its own Tauri stub, and the other browser tests
// share the debug port.
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
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__INVOKES = [];
    window.__LISTENERS = {};
    window.__TAURI__ = {
      core: { invoke: async (cmd, args) => { window.__INVOKES.push({ cmd, args }); return {}; } },
      event: {
        listen: async (event, handler) => {
          window.__LISTENERS[event] = handler;
          return () => {};
        },
      },
    };
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

// Samples the alert's computed style every ~35 ms for a bit more than one animation cycle.
const sampler = `(async () => {
  const overlay = document.getElementById('hud-alert-overlay');
  const card = overlay.querySelector('.hud-alert-card');
  const titlebar = overlay.querySelector('.hud-alert-titlebar');
  const body = overlay.querySelector('.hud-alert-body');
  const message = document.getElementById('hud-overlay-message');
  const samples = [];
  for (let i = 0; i < 20; i += 1) {
    const style = (el) => (el ? getComputedStyle(el) : null);
    samples.push({
      overlayOpacity: style(overlay).opacity,
      cardOpacity: style(card).opacity,
      titlebarOpacity: style(titlebar).opacity,
      bodyOpacity: style(body).opacity,
      messageOpacity: style(message).opacity,
      messageColor: style(message).color,
      visibility: style(card).visibility,
      display: style(card).display,
      cardShadow: style(card).boxShadow,
      cardAnimation: style(card).animationName,
      overlayAnimation: style(overlay).animationName,
      overlayShadow: style(overlay).boxShadow,
      overlayBackground: style(overlay).backgroundColor,
      titlebarBackground: style(titlebar).backgroundColor,
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  return samples;
})()`;

const URGENCIES = ['panic', 'warning', 'cue', 'info'];
const FLASHES = ['strobe', 'pulse', 'static'];
const DISPLAYS = ['center_hud', 'toast', 'fullscreen'];
const distinct = (values) => new Set(values).size;
// Every animation name seen in a sample run, so an entrance animation cannot slip back in.
const sampleAnimationNames = (samples) => [
  ...new Set(samples.flatMap((s) => [s.cardAnimation, s.overlayAnimation])),
].join(",");

async function verifyHudFlash(windowName) {
  let combinations = 0;
    for (const display of DISPLAYS) {
    for (const urgency of URGENCIES) {
      for (const flash of FLASHES) {
        const label = `${display}/${urgency}/${flash}`;
        await evaluate(`showHudAlert({
          title: 'FLASH CHECK', message: 'must stay visible', urgency: '${urgency}',
          flashStyle: '${flash}', displayMode: '${display}', durationMs: 0,
          flashSpeedMs: 200,
        })`);
        // Let the 0.2 s entrance slide finish before sampling: that one-shot animation is the card
        // arriving, not the flash, and the flash must not be confused with it.
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Read the classes back first: a silent typo in the option plumbing would make this test
        // pass by testing a static alert.
        const classes = await evaluate('document.getElementById("hud-alert-overlay").className');
        assert.ok(classes.includes(`hud-urgency-${urgency}`), `${label}: urgency class missing (${classes})`);
        assert.ok(classes.includes(`mode-${display}`), `${label}: display class missing (${classes})`);
        if (flash !== 'static') assert.ok(classes.includes(`hud-flash-${flash}`), `${label}: flash class missing (${classes})`);

        const samples = await evaluate(sampler);
        for (const sample of samples) {
          // The overlay, the card and its title bar are what the old opacity keyframes dimmed.
          for (const key of ['overlayOpacity', 'cardOpacity', 'titlebarOpacity']) {
            assert.equal(sample[key], '1', `${label}: ${key} must stay 1 so the alert never blinks (got ${sample[key]})`);
          }
          // Body and message carry static design opacities; what matters is that the flash never
          // moves them, and that they stay legible throughout.
          for (const key of ['bodyOpacity', 'messageOpacity']) {
            assert.ok(Number(sample[key]) >= 0.8, `${label}: ${key} must stay legible (got ${sample[key]})`);
          }
          // Legibility of the fullscreen wash: light text on the dark urgency colour.
          if (display === 'fullscreen') {
            assert.equal(sample.messageColor, 'rgb(255, 255, 255)', `${label}: the fullscreen message must be white`);
          }
          assert.equal(sample.visibility, 'visible', `${label}: card must stay visible`);
          assert.notEqual(sample.display, 'none', `${label}: card must not be hidden`);
        }
        for (const key of ['overlayOpacity', 'cardOpacity', 'titlebarOpacity', 'bodyOpacity', 'messageOpacity']) {
          assert.equal(distinct(samples.map((s) => s[key])), 1, `${label}: ${key} must not animate`);
        }

        combinations += 1;
        // No entrance animation may come back: a fade or slide on appearance is what looked
        // glitchy and dimmed the alert while it was supposed to be visible.
        for (const animation of `${sampleAnimationNames(samples)}`.split(",")) {
          const name = animation.trim();
          assert.ok(
            name === "none" || name.startsWith("hudStrobe") || name.startsWith("hudPulse"),
            `${label}: only the colour flash may animate the alert (found ${name})`,
          );
        }
        const shadows = samples.map((s) => s.cardShadow);
        const overlayShadows = samples.map((s) => s.overlayShadow);
        const backgrounds = samples.map((s) => s.overlayBackground);
        const titlebars = samples.map((s) => s.titlebarBackground);

        if (flash === 'static') {
          assert.equal(distinct(shadows), 1, `${label}: a static flash must not animate the card`);
          assert.equal(distinct(overlayShadows), 1, `${label}: a static flash must not animate the overlay`);
          await evaluate('dismissHudAlert()');
          continue;
        }

        // Card and toast forms highlight the card ring and the title bar; fullscreen washes the
        // screen with an inset shadow so the pulse is visible whatever the overlay background is.
        const highlighted = display === 'fullscreen'
          ? distinct(overlayShadows) > 1
          : distinct(shadows) > 1 || distinct(titlebars) > 1;
        assert.ok(highlighted, `${label}: the flash must highlight a colour or a ring`);

        await evaluate('dismissHudAlert()');
      }
    }
  }
  // Custom colour in fullscreen: the !important background would beat a plain background
  // animation, so the inset-shadow wash is what keeps it flashing.
  await evaluate(`showHudAlert({
    title: 'CUSTOM', message: 'still flashing', urgency: 'panic', flashStyle: 'strobe',
    displayMode: 'fullscreen', durationMs: 0, flashSpeedMs: 200, customColor: '#7a00ff',
  })`);
  const customClasses = await evaluate('document.getElementById("hud-alert-overlay").className');
  assert.ok(customClasses.includes('has-custom-color'), `custom colour class missing (${customClasses})`);
  const customSamples = await evaluate(sampler);
  for (const sample of customSamples) {
    assert.equal(sample.cardOpacity, '1', `${windowName}: custom fullscreen must stay opaque`);
    assert.equal(sample.overlayOpacity, '1', `${windowName}: custom fullscreen must stay opaque`);
  }
  assert.ok(
    distinct(customSamples.map((s) => s.overlayShadow)) > 1,
    `${windowName}: custom fullscreen must still flash even though the custom background wins`,
  );
  await evaluate('dismissHudAlert()');
  return combinations;
}

for (const [windowName, fileName] of [['main window', 'index.html'], ['meter bridge', 'meters.html']]) {
  await loadWindow(fileName);
  const combinations = await verifyHudFlash(windowName);
  console.log(`${windowName} (${fileName}): ${combinations} display x urgency x flash combinations keep opacity 1`);
  console.log(`${windowName} (${fileName}): strobe and pulse highlight, custom fullscreen keeps flashing`);
}

// --- 5. A HUD alert addressed to the bridge survives the bridge not being ready yet ----------------
// The webview is created before its listeners exist, so an alert emitted in between reached a webview
// that dropped it — and an alert emitted with the window closed falls back to the dock as
// `meters_fallback` and was then shown by nobody. The dock keeps the alert the bridge is entitled to
// and hands it over when the bridge announces that it is listening (master plan 2026-09-22, §5.2
// item 24).
await loadWindow('index.html');
const PENDING_ALERT = {
  title: 'BRIDGE PENDING', message: 'this one had to wait', urgency: 'warning',
  flashStyle: 'static', displayMode: 'center_hud', durationMs: 0, sound: 'none', targetWindow: 'meters',
};
const stash = await evaluate(`(async () => {
  localStorage.removeItem('wing_hud_alert_pending');
  window.__INVOKES = [];
  const handler = (window.__LISTENERS || {})['hud-alert'];
  if (!handler) return { error: 'the dock must listen for hud-alert' };
  handler({ payload: ${JSON.stringify({ ...PENDING_ALERT }) } });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const overlay = document.getElementById('hud-alert-overlay');
  const stored = JSON.parse(localStorage.getItem('wing_hud_alert_pending') || 'null');
  return {
    stored: stored && stored.alert ? stored.alert.title : null,
    persistent: stored ? stored.expiresAt : null,
    shownHere: overlay ? overlay.className.includes('active') : false,
  };
})()`);
assert.ok(!stash.error, stash.error || '');
assert.equal(stash.stored, 'BRIDGE PENDING', `the alert addressed to the bridge must be kept for it (got ${JSON.stringify(stash)})`);
assert.equal(stash.persistent, 0, 'a persistent alert has no end of its own');
assert.equal(stash.shownHere, false, 'the dock must not show an alert addressed to the bridge alone');

const handover = await evaluate(`(async () => {
  window.__INVOKES = [];
  window.dispatchEvent(new StorageEvent('storage', { key: 'wing_meters_ready', newValue: String(Date.now()) }));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const sent = window.__INVOKES.filter((entry) => entry.cmd === 'trigger_hud_alert');
  // An alert that already ended while nobody could see it is not sent either: the report of a warning
  // that is over would be worse than the silence it replaces.
  localStorage.setItem('wing_hud_alert_pending', JSON.stringify({
    alert: ${JSON.stringify({ ...PENDING_ALERT, title: 'TOO LATE' })},
    at: Date.now() - 9000,
    expiresAt: Date.now() - 500,
  }));
  window.__INVOKES = [];
  window.dispatchEvent(new StorageEvent('storage', { key: 'wing_meters_ready', newValue: String(Date.now()) }));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const late = window.__INVOKES.filter((entry) => entry.cmd === 'trigger_hud_alert');
  localStorage.removeItem('wing_hud_alert_pending');
  return {
    sent: sent.length,
    title: sent[0] && sent[0].args && sent[0].args.alert ? sent[0].args.alert.title : '',
    lateSent: late.length,
  };
})()`);
assert.equal(handover.sent, 1, `the ready signal must hand the waiting alert to the bridge (got ${JSON.stringify(handover)})`);
assert.equal(handover.title, 'BRIDGE PENDING', `the alert sent must be the one that waited (got ${JSON.stringify(handover)})`);
assert.equal(handover.lateSent, 0, 'an alert that already ended must not be sent late');
console.log('5. a waiting HUD alert reaches the bridge when it announces itself');

// And the bridge does announce itself, once its listeners are in place: that is the whole handshake.
await loadWindow('meters.html');
const ready = await evaluate(`localStorage.getItem('wing_meters_ready')`);
assert.ok(Number(ready) > 0, `the bridge must announce that its listeners are up (got ${ready})`);
console.log('6. the bridge announces its listeners are up');

socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
