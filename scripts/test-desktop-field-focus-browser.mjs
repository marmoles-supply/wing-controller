// Verifies that a single left click starts editing a text field, even when the window is not focused.
//
// Why this exists: in WKWebView a field can hold the DOM focus while the engine refuses every edit
// (typing and even `execCommand("insertText")` do nothing) until the window is key. Measured in the
// real engine, `execCommand` returns false and the value never changes in a non-focused window, and
// the very same click types fine once the window is focused — which is what "the field looks
// editable but does not let me type" looked like in the app. The click that activates an inactive
// window is also swallowed by macOS unless `acceptFirstMouse` is on, so the right-click -> Edit route
// used to be the only one that worked.
//
// Checks, in both windows:
//   1. A pointerdown on a typeable field with the page not focused claims the window (setFocus) and
//      focuses the field.
//   2. The window is claimed even when `document.hasFocus()` reads true: in the packaged app that
//      value is true while the window is not key, and a key window is what WebKit needs to edit.
//   3. Sliders and check boxes never claim the window.
//   4. The two-click caret rule, in all **five** windows: the first click selects the whole value,
//      the second puts the caret at its end, a third is native, and the re-focus that follows a click
//      never puts the full selection back (that was the "the caret jumps to the left on its own"
//      defect). The rule itself lives in `desktop/ui/field-editing.js`.
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is
// closed, and running it directly is a no-op in that case too.
//
// Run: node scripts/test-desktop-field-focus-browser.mjs
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
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__FOCUS_CALLS = 0;
    window.__TAURI__ = {
      core: { invoke: async () => ({}) },
      event: { listen: async () => () => {} },
      window: {
        getCurrentWindow: () => ({
          setFocus: async () => { window.__FOCUS_CALLS += 1; },
          setAlwaysOnTop: async () => {},
        }),
      },
    };
  `,
});

// Shared probe: dispatch a pointerdown on the control and report what the handler did.
const press = `(async (selector, pretendUnfocused) => {
  const calls = () => window.__FOCUS_CALLS;
  const before = calls();
  document.hasFocus = () => !pretendUnfocused;
  const el = document.querySelector(selector);
  if (!el) return { missing: selector };
  el.blur?.();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  return {
    selector,
    focusCalls: calls() - before,
    focused: document.activeElement === el,
    active: document.activeElement ? (document.activeElement.tagName + '#' + (document.activeElement.id || '')) : null,
  };
})`;

for (const [windowName, file] of [['main window', 'index.html'], ['meter bridge', 'meters.html']]) {
  await call('Page.navigate', { url: new URL(`../desktop/ui/${file}`, import.meta.url).href });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate('document.readyState === "complete" && Boolean(document.body)')) break;
    await sleep(100);
  }
  await sleep(400); // let boot() attach the handlers

  const textField = file === 'index.html' ? '#macro-name' : null;
  if (textField) {
    // --- 1. Unfocused window: claim it and focus the field -------------------
    const claimed = await evaluate(`${press}(${JSON.stringify(textField)}, true)`);
    assert.equal(claimed.focusCalls, 1, `${windowName}: an unfocused window must be claimed on the first click`);
    assert.equal(claimed.focused, true, `${windowName}: the clicked field must end up focused (${JSON.stringify(claimed)})`);
    console.log(`1. ${windowName} unfocused:`, JSON.stringify(claimed));

    // --- 2. "Focused" is not trustworthy: claim the window anyway -------------
    const claimedAgain = await evaluate(`${press}(${JSON.stringify(textField)}, false)`);
    assert.equal(
      claimedAgain.focusCalls,
      1,
      `${windowName}: the window must be claimed on every click over a field, not only when document.hasFocus() is false`,
    );
    assert.doesNotMatch(claimedAgain.active, /undefined/, `${windowName}: active element must stay a real control (${claimedAgain.active})`);
    console.log(`2. ${windowName} focused (claimed anyway):`, JSON.stringify(claimedAgain));

    // --- 3. Sliders and check boxes never claim the window -------------------
    for (const selector of ['#chk-peak-hold', '#slider-meter-scale']) {
      const ignored = await evaluate(`${press}(${JSON.stringify(selector)}, true)`);
      assert.equal(ignored.focusCalls, 0, `${windowName}: ${selector} must not claim the window`);
    }
    console.log(`3. ${windowName}: sliders and check boxes never claim the window`);
  } else {
    // The bridge's own `<select>`s are drawn by the shared dropdown (`dropdown.js`) now, so the only
    // caret field this window really shows is the prompt dialog's text box: it is opened through the
    // app's own `metersPrompt`, the way "New bank" does it.
    // The expression has to answer something other than the dialog's promise: `evaluate` awaits a
    // returned promise, and the prompt only settles when the operator accepts or cancels it.
    await evaluate(`(() => { window.__promptResult = metersPrompt({ title: 'Focus probe', label: 'Name', value: '' }); return true; })()`);
    await sleep(150);
    const field = await evaluate(`${press}('#meters-prompt-input', true)`);
    assert.equal(field.focusCalls, 1, `${windowName}: an unfocused window must be claimed on the first click`);
    console.log(`1. ${windowName} unfocused:`, JSON.stringify(field));
    const quiet = await evaluate(`${press}('#meters-prompt-input', false)`);
    assert.equal(quiet.focusCalls, 1, `${windowName}: the window must be claimed on every click over a field`);
    // The drawn dropdown is a button, not a caret field: it must not claim the window either.
    const drawn = await evaluate(`${press}('#meter-style-select-menu', true)`);
    assert.equal(drawn.focusCalls, 0, `${windowName}: a drawn dropdown button must not claim the window`);
    const ignored = await evaluate(`${press}('#btn-reset-peaks', true)`);
    assert.equal(ignored.focusCalls, 0, `${windowName}: a button must not claim the window`);
    console.log(`2. ${windowName} focused:`, JSON.stringify(quiet));
    console.log(`3. ${windowName}: buttons never claim the window`);
    await evaluate(`document.getElementById('meters-prompt-cancel').click()`);
  }
}

// --- The two-click caret rule, in every window ----------------------------
// Asked for by the owner (2026-10-09): one click selects the whole value so the first key typed
// overwrites it, a second click puts the caret at the end, and the same gesture works on every
// screen, panel and pop-up. The rule lives in `desktop/ui/field-editing.js`, which every window
// loads, so this probe is identical for all five and a window that stops loading the module fails
// here.
//
// The clicks are real mouse events, not `dispatchEvent`: WebKit places the caret itself as the
// default action of a click *after* the pointerdown handler, and only a real click reproduces the
// order the rule is built for. A probe input is used instead of a field of the window so the test
// never edits an operator's value. Measured this way on 2026-10-09: click one leaves [0, length],
// click two leaves [length, length] (append), and a third click leaves the caret where it was
// pointed at (native).
const makeCaretProbe = `(() => {
  document.getElementById("caret-rule-probe")?.remove();
  const el = document.createElement("input");
  el.type = "text";
  el.id = "caret-rule-probe";
  el.value = "123456";
  el.style.cssText = "position:fixed;right:0;bottom:0;width:220px;height:34px;z-index:2147483647;font:16px monospace;background:#ffefc0";
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  // The pointed click lands inside the text on purpose: a click to the right of the last character
  // is a click at the end of the value, a legitimate native position that would not tell the two apart.
  return { left: r.left, y: r.top + r.height / 2, middle: r.left + r.width * 0.5, pointed: r.left + 25, length: el.value.length };
})()`;

const caretState = `(() => {
  const el = document.getElementById("caret-rule-probe");
  if (!el) return { missing: true };
  let editing = true;
  try { editing = document.queryCommandEnabled("insertText") !== false; } catch (_) {}
  return { value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el, editing };
})()`;

for (const file of ["index.html", "meters.html", "ltc.html", "timecode.html", "guide.html"]) {
  await call('Page.navigate', { url: new URL(`../desktop/ui/${file}`, import.meta.url).href });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate('document.readyState === "complete" && Boolean(document.body)')) break;
    await sleep(100);
  }
  await sleep(400);
  const probe = await evaluate(makeCaretProbe);
  assert.equal(probe.length, 6, `${file}: the probe input must hold the six-character value`);

  const clickAt = async (x) => {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: probe.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: probe.y, button: 'left', clickCount: 1 });
    await sleep(120);
  };

  // 1. First click: the whole value is selected (that is what makes the next key overwrite it), and
  //    the selection survives the release -- WebKit collapses it on its own way out.
  await clickAt(probe.middle);
  const afterFirstClick = await evaluate(caretState);
  assert.deepEqual(
    { start: afterFirstClick.start, end: afterFirstClick.end },
    { start: 0, end: probe.length },
    `${file}: the first click must select the whole value (${JSON.stringify(afterFirstClick)})`,
  );

  // 2. Second click: the caret goes to the end, so a value can be appended or corrected from the right.
  await clickAt(probe.middle);
  const afterSecondClick = await evaluate(caretState);
  assert.deepEqual(
    { start: afterSecondClick.start, end: afterSecondClick.end },
    { start: probe.length, end: probe.length },
    `${file}: the second click must put the caret at the end of the value (${JSON.stringify(afterSecondClick)})`,
  );

  // 3. A third click is native: the caret lands where the operator pointed, neither selected nor at
  //    the end. This is the half a rewrite of the rule is most likely to lose.
  await clickAt(probe.pointed);
  const afterThirdClick = await evaluate(caretState);
  assert.equal(afterThirdClick.focused, true, `${file}: the third click must keep the field focused (${JSON.stringify(afterThirdClick)})`);
  assert.ok(
    afterThirdClick.start === afterThirdClick.end && afterThirdClick.start > 0 && afterThirdClick.start < probe.length,
    `${file}: a third click must leave the caret where it was pointed at, not selected and not at the end (${JSON.stringify(afterThirdClick)})`,
  );
  // ...and the field must still be editable. Anything in the window that clears the document selection
  // on a release -- the matrix grid did, on every pointerup, until 2026-10-09 -- leaves the caret at
  // the left edge with `insertText` disabled, which is the "the cursor jumps to the left on its own"
  // the owner reported. This sentence is the guard for that class of defect, wherever it lives.
  assert.equal(afterThirdClick.editing, true, `${file}: a click must leave the field editable (${JSON.stringify(afterThirdClick)})`);

  // 4. The bounded re-focus that follows a click must never put the full selection back: that was the
  //    defect the owner reported as "the caret jumps to the left on its own" while typing. The
  //    re-focus is provoked the way the packaged app provokes it, by the page reporting no focus.
  await evaluate(`(() => {
    const el = document.getElementById("caret-rule-probe");
    el.focus();
    el.setSelectionRange(3, 3);
    window.__REAL_HAS_FOCUS = document.hasFocus;
    document.hasFocus = () => false;
    window.__HOLD_FOCUS_BASE = window.__FOCUS_CALLS;
    return true;
  })()`);
  await sleep(950);
  const afterHold = await evaluate(caretState);
  const holdFocusCalls = await evaluate('window.__FOCUS_CALLS - window.__HOLD_FOCUS_BASE');
  await evaluate(`(() => {
    document.hasFocus = window.__REAL_HAS_FOCUS;
    document.getElementById("caret-rule-probe")?.remove();
    return true;
  })()`);
  assert.deepEqual(
    { start: afterHold.start, end: afterHold.end },
    { start: 3, end: 3 },
    `${file}: the re-focus after a click must not put the full selection back (${JSON.stringify(afterHold)})`,
  );
  assert.ok(
    holdFocusCalls >= 1,
    `${file}: the re-focus must really have run while the page reported no focus (${holdFocusCalls} calls)`,
  );

  console.log(`4. caret rule ${file}:`, JSON.stringify({ afterFirstClick, afterSecondClick, afterThirdClick, afterHold, holdFocusCalls }));
}

socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
