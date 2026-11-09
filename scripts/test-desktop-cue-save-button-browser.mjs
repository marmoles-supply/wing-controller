// Holds down the Save control of the shared cue panel: the one button that writes the cue list, and the one the owner
// never found. He spent a session with a cue marked "broken" because he had chosen a macro on its row and the save —
// which re-arms the whole cue engine — was a neutral grey button he did not notice.
//
// The contract is four things, and the first is the one that would have saved him the session:
//
//   1. the control is present and reads as **the action**, not as the grey the windows' button recipe paints;
//   2. after a local edit it carries the **unsaved** state, and after the save it does not;
//   3. that state is signalled **without the animation** — a colour of its own, an outline and a marker — because a
//      user who asked for reduced motion must still be told, and an animation may never be the only signal;
//   4. under `prefers-reduced-motion: reduce` there is **no animation at all**, and the static signal is still there.
//
// The unsaved state must come from the window's own answer to "is the list on screen the list the engine has" — the
// same predicate that paints the "● Unsaved changes" line — so this suite also reads that line and requires the two to
// agree. A button with a flag of its own is exactly how it ends up lying about what was saved.
//
// The clock window is driven end to end. The Settings window cannot render a cue without a backend, but its own dirty
// path — the offset box, a change the panel is not told about unless the window says so — is driven for real through
// the listeners it registers when its Timecode tab opens.
//
// Needs Chrome with `--remote-debugging-port=9223`. A suite that cannot run exits 3 rather than claiming a pass, which
// is what the gate demands.
//
// Run: WING_CHROME_PORT=9223 node scripts/test-desktop-cue-save-button-browser.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
const CLOCK_URL = new URL('../desktop/ui/timecode.html', import.meta.url).href;
const INDEX_URL = new URL('../desktop/ui/index.html', import.meta.url).href;
const LTC_URL = new URL('../desktop/ui/ltc.html', import.meta.url).href;

const pages = await (async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
})();
if (!pages) {
  console.log(`SKIP: no Chrome remote debugging on port ${DEBUG_PORT}`);
  process.exit(3);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/// One tab of its own, wired the way every suite in this repository is: a tab shared with another test would let an
/// old page decide what this one measures.
/// `preload` is injected **before** the page runs, which is the only way a window that needs a backend can be driven:
/// the LTC window draws no rows without one, and a stub added after load would be too late for its own boot. The tab is
/// opened blank and navigated once the script is in place.
async function openTab(url, preload) {
  const first = preload ? 'about:blank' : url;
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${first}`, { method: 'PUT' })).json();
  assert.ok(target?.webSocketDebuggerUrl, 'could not open a Chrome tab for this test');
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
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const waitFor = async (expression, what, attempts = 200) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what} (${expression})`);
  };
  await call('Page.enable');
  await call('Runtime.enable');
  const originalMotion = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  console.log(`Host reduced-motion preference before emulation: ${originalMotion}`);
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: no-preference)').matches`), true,
    'normal-animation cases must run with an explicit normal-motion preference');
  if (preload) {
    await call('Page.addScriptToEvaluateOnNewDocument', { source: preload });
    await call('Page.navigate', { url });
  }
  // A visible tab, not a background one: Chrome throttles a hidden tab's timers, and the panel's own repaints are what
  // this suite reads.
  await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  return {
    call, evaluate, waitFor, pageErrors,
    close: () => {
      socket.close();
      try { execFileSync('curl', ['-s', '-o', '/dev/null', `http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`]); } catch (_) {}
    },
  };
}

/// The window's store, provided by the suite so this test cannot read a key another suite left behind, and cannot
/// leave one behind itself. The clock reads its panel and its order through it.
function storageStub() {
  return `
    (() => {
      const store = new Map();
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

/// The fake desktop frame behind the clock: enough for it to read its list, save it and grow for the panel. Everything
/// else the window can ask is answered with an empty object, and `__INVOKES` records every call so "the edit reached
/// no command" can be asserted rather than assumed.
function clockStub(cues) {
  return `
    (() => {
      window.__INVOKES = [];
      let cues = ${JSON.stringify(cues)};
      let sort = 'smpte';
      window.__TAURI__ = {
        core: { invoke: async (cmd, args) => {
          window.__INVOKES.push({ cmd, args });
          switch (cmd) {
            case 'timecode_state':
              return { state: 'running', position: '01:00:12:15', rate: '25', drop_frame: false, pieces: 8, positions: 1, source: 'MTC', cues: cues.length };
            case 'get_timecode_cues':
              return { schema_version: 1, cues, offset_frames: 0, sort };
            case 'set_timecode_cues':
              cues = args.cues.cues; sort = args.cues.sort || sort;
              return { ...args.cues, sort };
            case 'timecode_pending_cues':
              return [];
            case 'read_window_box':
              return { width: 420, height: 640, physicalWidth: 420, physicalHeight: 640, scaleFactor: 1,
                maximized: false, fullscreen: false, monitorWorkWidth: 1440, monitorWorkHeight: 875 };
            default:
              return {};
          }
        } },
        event: { listen: async () => () => {} },
        window: { getCurrentWindow: () => ({
          setAlwaysOnTop: async () => {},
          setSize: async () => {},
          onResized: async () => () => {},
        }), LogicalSize: class { constructor(width, height) { this.width = width; this.height = height; } } },
      };
    })();
  `;
}

const CUE_FIELDS = (id, hours, minutes, seconds, frames, extra = {}) => ({
  id, at: { hours, minutes, seconds, frames, rate: 'fps25', drop_frame: false },
  macro_index: 0, repeats: false, enabled: true, note: '', ...extra,
});

/// Everything the Save control says about itself: what it is, what it looks like, and what the stylesheet asks of it.
/// The marker is read from the pseudo-element because it is content, not a class — it is there with no animation at all.
const SAVE_STATE = `(() => {
  const save = document.getElementById('cue-save');
  if (!save) return null;
  const style = getComputedStyle(save);
  const rgb = (style.backgroundColor.match(/\\d+/g) || []).map(Number);
  return {
    present: true,
    sharedClass: save.classList.contains('wing-cue-save'),
    unsaved: save.classList.contains('is-unsaved'),
    stylesheet: Boolean(document.getElementById('wing-cue-save-style')),
    background: style.backgroundColor,
    // The windows paint every button the neutral --face grey: zero saturation. An action colour is not grey, and
    // this is the measurement of "it must be visible without hunting".
    saturation: rgb.length >= 3 ? Math.max(...rgb) - Math.min(...rgb) : 0,
    animation: style.animationName,
    animationDuration: style.animationDuration,
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    marker: getComputedStyle(save, '::after').content,
  };
})()`;

/// Open the clock's cue panel and nudge the one cue +1 frame, the edit the owner was making when the save got away
/// from him. It is local: it must reach no command.
async function nudgeTheCue(tab) {
  await tab.waitFor(`document.querySelectorAll('#cue-list .cue-row').length === 1`, 'the cue list to render');
  // Make sure it is unfolded, without folding it again when the caller already opened it.
  await tab.evaluate(`(() => {
    const panel = document.getElementById('cue-panel');
    if (panel && panel.hidden) document.getElementById('cue-panel-toggle').click();
  })()`);
  await tab.waitFor(`!document.getElementById('cue-panel').hidden`, 'the cue panel to unfold');
  await tab.evaluate(`document.querySelector('.cue-row[data-cue-id="cue-1"] .cue-buttons button').click()`);
  await tab.waitFor(`document.querySelectorAll('.cue-row[data-cue-id="cue-1"] .cue-editor button').length === 5`,
    'the time editor to open');
  await tab.evaluate(`window.__INVOKES.length = 0`);
  await tab.evaluate(
    `Array.from(document.querySelectorAll('.cue-row[data-cue-id="cue-1"] .cue-editor button')).find((b) => b.textContent.trim() === '+1f').click()`);
  await sleep(80);
}

try {
  // --- 1. The clock: present, calm, and unmistakably the action ---------------------------------------
  const clock = await openTab('about:blank');
  const clockCues = [CUE_FIELDS('cue-1', 1, 0, 10, 0, { note: 'Editable' })];
  await clock.call('Page.addScriptToEvaluateOnNewDocument', { source: storageStub() });
  await clock.call('Page.addScriptToEvaluateOnNewDocument', { source: clockStub(clockCues) });
  await clock.call('Page.navigate', { url: CLOCK_URL });
  await clock.waitFor(`document.querySelectorAll('#cue-list .cue-row').length === 1`, 'the clock cue list to render');
  await clock.evaluate(`document.getElementById('cue-panel-toggle').click()`);
  await clock.waitFor(`!document.getElementById('cue-panel').hidden`, 'the cue panel to unfold');

  const calm = await clock.evaluate(SAVE_STATE);
  assert.ok(calm?.present, 'the cue panel must offer its Save control');
  assert.equal(calm.sharedClass, true,
    'and it must be the control the shared cue module owns (`wing-cue-save`), not a button each window wires on its own');
  assert.equal(calm.stylesheet, true, "and the module's own stylesheet must be in the document");
  assert.equal(calm.unsaved, false, 'with nothing edited it must not claim there is anything to save');
  assert.ok(calm.saturation >= 40,
    `with nothing edited it must still read as the action, not the neutral grey the button recipe paints (saturation ${calm.saturation}, ${calm.background})`);
  assert.equal(calm.animation, 'none',
    `and it must be calm, not pulsing, while there is nothing unsaved (animation ${calm.animation})`);
  assert.equal(calm.outlineStyle, 'none', 'and carry no attention outline while there is nothing to save');
  assert.ok(!/●/.test(calm.marker), `and no unsaved marker (marker ${JSON.stringify(calm.marker)})`);

  // --- 2. After an edit it announces itself, and the whole unsaved state is static ---------------------
  await nudgeTheCue(clock);
  const editCommands = await clock.evaluate(`window.__INVOKES.map((entry) => entry.cmd)`);
  assert.deepEqual(editCommands, [],
    `a nudge must stay local — saving re-arms the engine — so the unsaved state comes from the draft, not from a write (got ${JSON.stringify(editCommands)})`);

  const dirty = await clock.evaluate(SAVE_STATE);
  assert.equal(dirty.unsaved, true, 'after a local edit the Save control must carry the unsaved state');
  assert.notEqual(dirty.background, calm.background,
    `and it must say so in its colour, not only in an animation (${calm.background} -> ${dirty.background})`);
  assert.equal(dirty.outlineStyle, 'solid', `with an attention outline (got ${dirty.outlineStyle})`);
  assert.equal(dirty.outlineWidth, '2px', `of a width that is not a hairline (got ${dirty.outlineWidth})`);
  assert.match(String(dirty.marker), /●/,
    `and a marker that is content, not motion — this is what a reduced-motion user reads (marker ${JSON.stringify(dirty.marker)})`);
  assert.match(dirty.animation, /wing-cue-save-pulse/,
    `and then, on top of all that, the pulse (got ${dirty.animation})`);
  assert.equal(dirty.animationDuration, '2.6s',
    `slow enough to draw the eye rather than flash at it (got ${dirty.animationDuration})`);

  // The button and the window's own notice must agree: they read the same predicate, and this is the assertion that
  // would fail if a second flag were introduced that could drift from it.
  const notice = await clock.evaluate(`(() => ({
    text: document.getElementById('cue-status').textContent.trim(),
    dirty: document.getElementById('cue-status').classList.contains('is-dirty'),
  }))()`);
  assert.equal(notice.dirty, true, `the window's own unsaved line must be up too (got ${JSON.stringify(notice)})`);
  assert.match(notice.text, /Unsaved changes/,
    `and say the same thing as the button (got ${JSON.stringify(notice.text)})`);

  // --- 3. Saving calms it again ------------------------------------------------------------------------
  await clock.evaluate(`document.getElementById('cue-save').click()`);
  await clock.waitFor(`window.__INVOKES.some((entry) => entry.cmd === 'set_timecode_cues')`, 'Save to reach the backend');
  await sleep(150);
  const saved = await clock.evaluate(SAVE_STATE);
  assert.equal(saved.unsaved, false, 'after the save the control must stop claiming there is anything unsaved');
  assert.equal(saved.background, calm.background,
    `and go back to the calm action colour (${dirty.background} -> ${saved.background})`);
  assert.equal(saved.animation, 'none', `with the pulse stopped (animation ${saved.animation})`);
  assert.equal(saved.outlineStyle, 'none', 'and no outline left over');
  assert.ok(!/●/.test(saved.marker), `and no marker left over (marker ${JSON.stringify(saved.marker)})`);

  // --- 4. Reduced motion: no animation, the state still unmistakable ------------------------------------
  await clock.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await clock.call('Page.navigate', { url: CLOCK_URL });
  await clock.waitFor(`document.querySelectorAll('#cue-list .cue-row').length === 1`, 'the cue list to render again');
  assert.equal(await clock.evaluate(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`), true,
    'the emulated preference must be the one the page sees, or this section measures nothing');
  const calmReduced = await clock.evaluate(SAVE_STATE);
  assert.equal(calmReduced.animation, 'none', 'a user who asked for reduced motion must get no animation, ever');
  await nudgeTheCue(clock);
  const reduced = await clock.evaluate(SAVE_STATE);
  assert.equal(reduced.unsaved, true,
    'with reduced motion the unsaved state must still be announced — losing the animation must not lose the message');
  assert.equal(reduced.animation, 'none',
    `and it must not animate: a reduced-motion user must not get a flashing control (animation ${reduced.animation})`);
  assert.notEqual(reduced.background, calmReduced.background,
    `the signal that carries the state instead is its colour (${calmReduced.background} -> ${reduced.background})`);
  assert.equal(reduced.outlineStyle, 'solid', `with the attention outline (got ${reduced.outlineStyle})`);
  assert.equal(reduced.outlineWidth, '2px', `at its full width (got ${reduced.outlineWidth})`);
  assert.match(String(reduced.marker), /●/,
    `and the marker, which is content and does not move (marker ${JSON.stringify(reduced.marker)})`);

  // --- 5. The same control, in the window that now edits the list ----------------------------------------
  //
  // This half used to drive the SETTINGS window, because that is where the cue list was edited. The list is edited in
  // the LTC window now, so the button the owner never found lives there — and the lesson goes with it, because that
  // window is where he will be looking for it. The clock's green is the module's; this window's button must carry it
  // too, or "every window gets it" is a promise the stylesheet does not keep.
  // A minimal backend, installed before the page boots: the LTC window draws its rows from `get_timecode_cues`, and a
  // window with no rows has no draft to dirty. Two cues are enough for the nudge below.
  const ltcStub = `
    (() => {
      const at = (seconds, frames) => ({ hours: 1, minutes: 0, seconds, frames, rate: "fps25", drop_frame: false });
      let cues = { schema_version: 1, offset_frames: 0, sort: "smpte", drive: "timecode", cues: [
        { id: "cue-1", number: "1", label: "Opening", group: "", at: at(10, 0), macro_id: null, macro_index: null, repeats: false, enabled: true, note: "" },
        { id: "cue-2", number: "2", label: "Curtain", group: "", at: at(20, 0), macro_id: null, macro_index: null, repeats: false, enabled: true, note: "" },
      ] };
      window.__INVOKES = [];
      window.__TAURI__ = {
        core: { invoke: async (cmd, args) => {
          window.__INVOKES.push({ cmd, args });
          switch (cmd) {
            case "get_timecode_cues": return cues;
            case "set_timecode_cues": return args?.cues ?? cues;
            case "timecode_state": return { state: "stopped", position: null, rate: "25", drop_frame: false, pieces: 0, positions: 0, source: null, cues: cues.cues.length, spent_ids: [] };
            case "timecode_pending_cues": return [];
            default: return {};
          }
        } },
        event: { listen: async (name, handler) => { (window.__HANDLERS = window.__HANDLERS || {})[name] = handler; return () => {}; } },
        window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, setSize: async () => {}, setPosition: async () => {},
          close: async () => {}, onCloseRequested: async () => () => {}, innerSize: async () => ({ width: 1180, height: 760 }),
          outerPosition: async () => ({ x: 0, y: 0 }) }),
          LogicalSize: class { constructor(w, h) { this.width = w; this.height = h; } } },
      };
    })();
  `;
  const ltc = await openTab(LTC_URL, ltcStub);
  await ltc.waitFor(`Boolean(window.WingCueList) && Boolean(document.getElementById('save'))`,
    'the LTC window and its Save control');
  await ltc.waitFor(`document.querySelectorAll('#rows .cue-row').length > 0`, 'the cue rows');
  const ltcCalm = await ltc.evaluate(`(() => {
    const save = document.getElementById('save');
    const style = getComputedStyle(save);
    const rgb = (style.backgroundColor.match(/\\d+/g) || []).map(Number);
    // A probe that carries nothing but the shared class, in this document and this theme: if the module's rule reaches
    // this control, the two are the same colour. A window rule silently overriding it would show up here.
    const probe = document.createElement('button');
    probe.className = 'wing-cue-save';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.appendChild(probe);
    const probeBackground = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      sharedClass: save.classList.contains('wing-cue-save'),
      unsaved: save.classList.contains('is-unsaved'),
      stylesheet: Boolean(document.getElementById('wing-cue-save-style')),
      background: style.backgroundColor,
      probeBackground,
      saturation: rgb.length >= 3 ? Math.max(...rgb) - Math.min(...rgb) : 0,
      animation: style.animationName,
    };
  })()`);
  assert.equal(ltcCalm.sharedClass, true,
    'the LTC window must get the same control from the shared module, not a second one of its own');
  assert.equal(ltcCalm.stylesheet, true, "and the module's stylesheet, which is what makes it look the same");
  assert.equal(ltcCalm.unsaved, false, 'calm before anything is edited');
  assert.ok(ltcCalm.saturation >= 40,
    `and painted as the action, not the neutral grey (saturation ${ltcCalm.saturation}, ${ltcCalm.background})`);
  assert.equal(ltcCalm.background, ltcCalm.probeBackground,
    `and painted by the shared rule itself (${ltcCalm.background} vs the module's own ${ltcCalm.probeBackground})`);
  assert.equal(ltcCalm.animation, 'none', 'with no pulse while there is nothing unsaved');

  // A local edit on a row: the ✎ editor's nudge. It is the same shape of edit the Settings window's offset box was —
  // made through a control the panel does not own — and the button must follow it, or it goes on saying "saved" while
  // the draft on screen is not what the engine has.
  await ltc.evaluate(`document.querySelector('#rows .cue-row .cue-edit').click()`);
  await sleep(200);
  await ltc.evaluate(`Array.from(document.querySelectorAll('#rows .cue-row .cue-editor button')).find((button) => button.textContent.trim() === '+1f').click()`);
  await sleep(200);
  const ltcDirty = await ltc.evaluate(`(() => {
    const save = document.getElementById('save');
    return {
      unsaved: save.classList.contains('is-unsaved'),
      animation: getComputedStyle(save).animationName,
      outline: getComputedStyle(save).outlineStyle,
      marker: getComputedStyle(save, '::after').content,
    };
  })()`);
  assert.equal(ltcDirty.unsaved, true,
    'a local edit must put THIS window\'s Save control in its unsaved state: it is the only button that writes');
  assert.match(ltcDirty.animation, /wing-cue-save-pulse/, `and it pulses here too (got ${ltcDirty.animation})`);
  assert.equal(ltcDirty.outline, 'solid', 'with the same static outline the reduced-motion user relies on');
  assert.match(String(ltcDirty.marker), /●/, 'and the same static marker');

  // Undo: the state is derived from the draft, not latched. Taking the edit back must calm the control again.
  await ltc.evaluate(`document.getElementById('undo').click()`);
  await sleep(250);
  assert.equal(await ltc.evaluate(`document.getElementById('save').classList.contains('is-unsaved')`), false,
    'taking the edit back must calm the control again, not leave it latched on');

  assert.deepEqual(clock.pageErrors, [], `the clock must not throw while it is driven:\n${clock.pageErrors.join('\n')}`);
  assert.deepEqual(ltc.pageErrors, [], `the LTC window must not throw while it is driven:\n${ltc.pageErrors.join('\n')}`);
  clock.close();
  ltc.close();

} catch (error) {
  console.error(error?.stack || String(error));
  process.exit(1);
}

console.log('cue save button contracts passed');

// The gate demands this line. A suite that cannot run must not reach this.
console.log('WING_BROWSER_SUITE_OK');
