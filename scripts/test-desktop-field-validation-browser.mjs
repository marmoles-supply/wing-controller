// Field validation in the macro editor: typing something that is not a value must be marked where it
// is and must block saving or arming. The editor used to accept "asdoijasod" in Threshold and
// "iuanf4ur" in Channels without a word, and the macro then did nothing on the desk.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
const INDEX_URL = new URL('../desktop/ui/index.html', import.meta.url).href;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The same file the page under test loads. The batch-2 section reads the fallback catalogue out of
// this text and compares it with the Rust catalogue, so the two sides cannot drift.
const indexHtmlForComparison = fs.readFileSync(path.join(repoRoot, 'desktop/ui/index.html'), 'utf8');

// This test drives the real window in Chrome, so it is named `-browser.mjs`: the gate gives it a
// watchdog and skips it with a visible note when the debug port is closed.
// A tab of its own: the browser tests share the port and the profile, and latching onto "the
// first index.html tab" let an old tab (from a test that died before closing its own) decide
// the state this test saw.
const page = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${INDEX_URL}`, { method: 'PUT' })).json();
assert.ok(page?.webSocketDebuggerUrl, 'could not open a Chrome tab for this test');
process.on('exit', () => {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', `http://127.0.0.1:${DEBUG_PORT}/json/close/${page.id}`]);
  } catch (_) {}
});

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});
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
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Types into a field the way the UI sees it, without needing injected keystrokes. */
async function type(id, value) {
  await evaluate(`(() => {
    const field = document.getElementById(${JSON.stringify(id)});
    field.focus();
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(60);
}

async function closeDialogIfOpen() {
  await evaluate(`(() => {
    const dialog = document.getElementById('win95-confirm');
    if (dialog && getComputedStyle(dialog).display !== 'none') {
      document.getElementById('win95-confirm-accept').click();
      return true;
    }
    return false;
  })()`);
  await sleep(80);
}

const dialogVisible = () =>
  evaluate(`(() => {
    const dialog = document.getElementById('win95-confirm');
    return Boolean(dialog) && getComputedStyle(dialog).display !== 'none';
  })()`);

const dialogText = () => evaluate(`document.getElementById('win95-confirm-message')?.textContent || ''`);

// Saving a valid draft writes the library: keep the previous value and put it back, so this test
// cannot leak state into the others that share the same Chrome profile.
let previousLibrary = null;
// The window follows the stored theme (`wing_theme`, applied at boot), and several checks below read
// the colours it decides: the profile is shared between the suites, so one that left the dark theme on
// used to decide them. The light theme is pinned for this run and the previous value put back at the
// end, exactly like the stored library above.
let previousTheme = null;
try {
  // The test attaches to the page the gate opened, so reload it to pick up the current file. The
  // stored library is put aside first and removed, so the page builds its own default: the first
  // checks below read the macro the page loaded, and a run that died before its `finally` (or another
  // window's run — the profile is shared) used to leave a library behind that decided them instead.
  // It is restored at the end, so the other tests still find what they left.
  await call('Page.enable');
  previousLibrary = await evaluate(`localStorage.getItem('wing_mock_macro_library')`).catch(() => null);
  await evaluate(`localStorage.removeItem('wing_mock_macro_library')`).catch(() => {});
  previousTheme = await evaluate(`localStorage.getItem('wing_theme')`).catch(() => null);
  await evaluate(`localStorage.setItem('wing_theme', 'light')`).catch(() => {});
  await call('Page.reload', { ignoreCache: true });
  await sleep(2400);
  // The profile is shared and the machine may still be busy with the test that ran just before this
  // one, so wait until the page has really built its draft and its trigger panel rather than trusting
  // the fixed sleep. The first assertion below used to fail only inside the gate — and pass alone —
  // because a value typed before the field was wired left no validity mark to assert on.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await evaluate(`(() => {
      const field = document.getElementById('threshold');
      const parameter = document.getElementById('trigger-parameter');
      return document.readyState === 'complete'
        && Boolean(field) && Boolean(parameter) && parameter.options.length > 1;
    })()`).catch(() => false);
    if (ready) break;
    await sleep(250);
  }
  await evaluate('document.querySelectorAll("#win95-confirm").forEach((el) => { el.style.display = "none"; })');

  // An empty field is a draft in progress, not an error: the app already refuses to arm an
  // incomplete macro, so saving a half-built one must stay possible.
  await type('trigger-ids', '');
  assert.equal(await evaluate(`document.getElementById('trigger-ids').classList.contains('is-invalid')`), false,
    'an empty channel list must not block a draft');
  await type('osc-address', '');
  assert.equal(await evaluate(`document.getElementById('osc-address').classList.contains('is-invalid')`), false,
    'an empty OSC address must not block a draft');

  // A word where a dB value belongs is marked at once, with the reason next to the field.
  await type('threshold', 'asdoijasod');
  assert.equal(await evaluate(`document.getElementById('threshold').classList.contains('is-invalid')`), true,
    'a non-numeric threshold must be marked as invalid');
  assert.match(await evaluate(`document.getElementById('threshold-problem')?.textContent || ''`), /number/i,
    'the field must say what is wrong');

  // …and saving is refused, naming the field.
  await evaluate(`document.getElementById('library-save-current').click()`);
  await sleep(150);
  assert.equal(await dialogVisible(), true, 'saving an invalid draft must be refused');
  const saveMessage = await dialogText();
  assert.match(saveMessage, /Cannot save/i, `the dialog must say it cannot save (got "${saveMessage}")`);
  assert.match(saveMessage, /Threshold/i, 'the dialog must name the offending field');
  await closeDialogIfOpen();

  // A real value clears the mark and lets the save through.
  await type('threshold', '-30');
  assert.equal(await evaluate(`document.getElementById('threshold').classList.contains('is-invalid')`), false,
    'a numeric threshold must be accepted');
  assert.equal(await evaluate(`Boolean(document.getElementById('threshold-problem'))`), false,
    'the problem note must disappear');
  await evaluate(`document.getElementById('library-save-current').click()`);
  await sleep(200);
  assert.equal(await dialogVisible(), false, 'a valid draft must save without a dialog');
  await closeDialogIfOpen();

  // Channel ids: the grammar first, then the range of the selected family.
  await evaluate(`(() => {
    const category = document.getElementById('trigger-category');
    category.value = 'ch';
    category.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(60);
  await type('trigger-ids', 'iuanf4ur');
  assert.equal(await evaluate(`document.getElementById('trigger-ids').classList.contains('is-invalid')`), true,
    'gibberish in the channel list must be marked');
  await type('trigger-ids', '1,3-5');
  assert.equal(await evaluate(`document.getElementById('trigger-ids').classList.contains('is-invalid')`), false,
    'a list of ids and ranges must be accepted');
  await type('trigger-ids', '999');
  assert.equal(await evaluate(`document.getElementById('trigger-ids').classList.contains('is-invalid')`), true,
    'an id past the end of the family must be refused');
  assert.match(await evaluate(`document.getElementById('trigger-ids-problem')?.textContent || ''`), /40/,
    'the message must say how many channels the family has');
  await type('trigger-ids', '1');
  assert.equal(await evaluate(`document.getElementById('trigger-ids').classList.contains('is-invalid')`), false,
    'the original value must be valid again');
  await evaluate(`document.getElementById('library-save-current').click()`);
  await sleep(200);
  assert.equal(await dialogVisible(), false, 'the repaired draft must save');
  await closeDialogIfOpen();

  // ── A pasted en dash is the range it looks like ────────────────────────────────────────────────
  //
  // The field accepted "1–4" (en dash) while the editor's own parse read it as just {1} — and the
  // backend's id grammar dropped it entirely — so the same list meant two different things depending
  // on who read it. Every dash look-alike is normalised where the id list is parsed, so the field and
  // the editor agree.
  const dashes = await evaluate(`(() => {
    const field = document.getElementById('trigger-ids');
    field.value = '1\u20134';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    const sorted = (text) => [...parseIdsToSet(text)].sort((a, b) => a - b);
    return {
      invalid: field.classList.contains('is-invalid'),
      problem: idListProblem('1\u20134', 'trigger-category'),
      parsed: sorted('1\u20134'),
      emDash: sorted('2\u20143'),
      figureDash: sorted('2\u20123'),
      minusSign: sorted('5\u22126'),
      ascii: sorted('1-4'),
      fieldValue: field.value,
      configIds: readConfigFromUi().triggerIds,
    };
  })()`);
  assert.equal(dashes.problem, null,
    `the field must accept an en dash as a range (got ${JSON.stringify(dashes.problem)})`);
  assert.equal(dashes.invalid, false, 'an en-dash range must not be marked invalid');
  assert.deepEqual(dashes.parsed, [1, 2, 3, 4],
    `the editor must read "1–4" as the range it looks like (got ${JSON.stringify(dashes.parsed)})`);
  assert.deepEqual(dashes.emDash, [2, 3], 'an em dash spells the same range');
  assert.deepEqual(dashes.figureDash, [2, 3], 'a figure dash spells the same range');
  assert.deepEqual(dashes.minusSign, [5, 6], 'a minus sign spells the same range');
  assert.deepEqual(dashes.ascii, [1, 2, 3, 4], 'the ASCII hyphen keeps working');
  assert.equal(dashes.fieldValue, '1\u20134', 'the field keeps what the operator typed');
  assert.equal(dashes.configIds, '1\u20134', 'and the draft carries it unchanged');
  await type('trigger-ids', '1');

  // ── The comparison follows the parameter's kind ───────────────────────────────────────────────
  //
  // The operator's report: a source category offered `Name` with the comparator "Rises above" and a
  // dB threshold. A name is text, `>` on text is always false, and the macro armed and never fired
  // with nothing said. The comparator list and the value control are built from the catalogue's
  // `valueKind`/`operators` now, so an impossible comparison cannot be authored here at all.
  const setSelect = async (id, value) => {
    await evaluate(`(() => {
      const select = document.getElementById(${JSON.stringify(id)});
      select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(80);
  };

  const triggerControls = () => evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    const operator = document.getElementById('trigger-operator');
    const config = readConfigFromUi();
    return {
      operators: [...operator.options].map((option) => option.value),
      labels: [...operator.options].map((option) => option.textContent),
      number: visible('threshold'),
      text: visible('trigger-value'),
      toggle: visible('trigger-toggle'),
      options: visible('trigger-options'),
      edgeHidden: document.getElementById('trigger-edge-field').classList.contains('hidden'),
      valueLabel: document.getElementById('trigger-threshold-label').textContent,
      triggerValue: config.triggerValue,
      triggerThreshold: config.triggerThreshold,
      recipe: document.getElementById('recipe-trigger').textContent,
    };
  })()`);

  await setSelect('trigger-category', 'usb');
  await setSelect('trigger-parameter', 'name');
  const nameControls = await triggerControls();
  assert.deepEqual(nameControls.operators, ['==', '!='],
    `a name is compared, never ordered (got ${JSON.stringify(nameControls.operators)})`);
  assert.deepEqual(nameControls.labels, ['Equals', 'Not equals'], 'the labels must say what the comparison is');
  assert.equal(nameControls.text, true, 'a text parameter needs a text field, not a dB number');
  assert.equal(nameControls.number, false, 'the numeric threshold must be hidden for a name');
  assert.equal(nameControls.toggle, false, 'a name is not an on/off pair');
  assert.equal(nameControls.edgeHidden, false, 'a state parameter keeps the Edge selector');
  assert.match(nameControls.valueLabel, /text/i, `the field must say it takes text (got "${nameControls.valueLabel}")`);

  // Typing a name saves, and the config carries it in `triggerValue` (not in the dB threshold).
  await type('trigger-value', 'VOX 1');
  assert.equal(await evaluate(`document.getElementById('trigger-value').classList.contains('is-invalid')`), false,
    'a name must be accepted for a name parameter');
  const namedConfig = await triggerControls();
  assert.equal(namedConfig.triggerValue, 'VOX 1', 'the name must travel in triggerValue');
  assert.match(namedConfig.recipe, /equals/i, `the readout must say the comparison (got "${namedConfig.recipe}")`);
  assert.match(namedConfig.recipe, /VOX 1/, `the readout must show the name (got "${namedConfig.recipe}")`);
  assert.doesNotMatch(namedConfig.recipe, /dB/, 'a name is never compared as a dB level');

  // A name longer than the console accepts is refused (Maillot: a channel or source name is 16).
  await type('trigger-value', 'ABCDEFGHIJKLMNOPQ');
  assert.equal(await evaluate(`document.getElementById('trigger-value').classList.contains('is-invalid')`), true,
    'a name past maxLen must be marked');
  assert.match(await evaluate(`document.getElementById('trigger-value-problem')?.textContent || ''`), /16/,
    'the message must say how many characters fit');
  await type('trigger-value', 'VOX 1');
  await evaluate(`document.getElementById('library-save-current').click()`);
  await sleep(200);
  assert.equal(await dialogVisible(), false, 'a text trigger must save without a dialog');
  const savedTrigger = await evaluate(`(() => {
    const library = JSON.parse(localStorage.getItem('wing_mock_macro_library') || '{"macros":[]}');
    const macro = library.macros[library.selectedIndex];
    return { value: macro?.triggerValue, parameter: macro?.triggerParameter };
  })()`);
  assert.equal(savedTrigger.value, 'VOX 1', 'the saved macro must carry the name in triggerValue');
  assert.equal(savedTrigger.parameter, 'name', 'the saved macro must keep the Name parameter');

  // A meter is the opposite case: only a crossing, and the threshold is a number in dB.
  await setSelect('trigger-parameter', 'meter');
  await type('threshold', '-20');
  const meterControls = await triggerControls();
  assert.deepEqual(meterControls.operators, ['>', '<'],
    `a meter only crosses a threshold (got ${JSON.stringify(meterControls.operators)})`);
  assert.deepEqual(meterControls.labels, ['Rises above', 'Falls below'], 'the meter labels name the crossing');
  assert.equal(meterControls.number, true, 'a meter threshold is a number');
  assert.equal(meterControls.text, false, 'a meter has no text value');
  assert.equal(meterControls.toggle, false, 'a meter is not an on/off pair');
  assert.equal(meterControls.edgeHidden, true,
    'a meter watches a crossing named by the comparator: no second, contradictory Edge selector');
  assert.match(meterControls.valueLabel, /dB/, `the threshold must show its unit (got "${meterControls.valueLabel}")`);
  assert.equal(await evaluate(`document.getElementById('threshold').classList.contains('is-invalid')`), false,
    '-20 dB must be inside the meter range');
  await type('threshold', '99');
  assert.equal(await evaluate(`document.getElementById('threshold').classList.contains('is-invalid')`), true,
    'a threshold above the parameter maximum must be refused');
  await type('threshold', '-20');

  // An on/off parameter is compared with an ON/OFF pair, and the config carries 0/1 in triggerValue.
  await setSelect('trigger-parameter', 'mute');
  const muteControls = await triggerControls();
  assert.deepEqual(muteControls.operators, ['==', '!='],
    `an on/off parameter cannot be ordered (got ${JSON.stringify(muteControls.operators)})`);
  assert.equal(muteControls.toggle, true, 'an on/off parameter needs the ON/OFF pair');
  assert.equal(muteControls.number, false, 'an on/off parameter has no dB threshold');
  assert.equal(muteControls.text, false, 'an on/off parameter is not free text');
  await evaluate(`(() => {
    const toggle = document.getElementById('trigger-toggle');
    toggle.value = '0';
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(80);
  const muteConfig = await triggerControls();
  assert.equal(muteConfig.triggerValue, '0', 'the on/off state must travel in triggerValue');
  assert.match(muteConfig.recipe, /equals/i, `the readout must say the comparison (got "${muteConfig.recipe}")`);
  assert.match(muteConfig.recipe, /OFF/i, `the readout must say the state (got "${muteConfig.recipe}")`);

  // A fade writes a stream of float values: it is offered for a level, never for a mute or a name.
  const fadeAvailability = await evaluate(`(() => {
    const category = document.getElementById('target-category');
    category.value = 'ch';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const fade = document.getElementById('action-mode').querySelector('option[value="fade"]');
    const cue = document.getElementById('action-mode').querySelector('option[value="automation_cue"]');
    const read = (key) => {
      const parameter = document.getElementById('target-parameter');
      parameter.value = key;
      parameter.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        fadeDisabled: fade.disabled,
        fadeHidden: fade.hidden,
        cueDisabled: cue.disabled,
        addButton: document.getElementById('add-fade-step').disabled,
      };
    };
    return { mute: read('mute'), name: read('name'), fader: read('fader') };
  })()`);
  assert.equal(fadeAvailability.mute.fadeDisabled, true, 'a mute cannot fade: a fade sends float values');
  assert.equal(fadeAvailability.name.fadeDisabled, true, 'a name cannot fade');
  assert.equal(fadeAvailability.fader.fadeDisabled, false, 'a fader is a continuous parameter and can fade');
  assert.equal(fadeAvailability.mute.cueDisabled, true, 'Smooth fade is a ramp too, and needs a continuous value');
  assert.equal(fadeAvailability.mute.addButton, true, 'the + Fade / Ramp button follows the same rule');
  assert.equal(fadeAvailability.fader.addButton, false, 'a fader keeps the fade step button');

  // ── A ramp needs a float leaf, not only a numeric kind ────────────────────────────────────────
  //
  // The backend decides with `watch_value_is_continuous(rule)`: `arg_kind == "float"` **and** a numeric
  // value kind. The editor decided from the value kind alone, so a whole-number leaf — which keeps the
  // `number` kind on purpose, so it still gets the ordered comparators — was offered Fade and Smooth
  // fade, and the ramp would write `,f` where the console reads `,i`. `scene_index` (argKind int) and
  // `delay_time` (argKind float, same `number` kind) are the fallback's own pair, so nothing here is a
  // test-only invention; the two rows after them are transcribed from the backend catalogue, which the
  // reduced fallback does not carry, all transcribed from the backend catalogue with the constructor
  // it really uses: `color` and `output_source` are the integer constructor (argKind int, valueKind
  // number), `comp_knee` is an integer in whole dB (argKind int but valueKind `db`, the kind a fader
  // has — the one that shows the value kind alone was never the rule), and `hpf_freq` a float in Hz.
  const rampRule = await evaluate(`(() => {
    const chRows = targetCatalog.targetParametersByCategory.ch;
    targetCatalog.targetParametersByCategory.ch = [
      ...chRows,
      { key: 'color', label: 'Color', argKind: 'int', valueKind: 'number', min: 1, max: 18, canTrigger: true, operators: ['<', '>', '==', '!='] },
      { key: 'output_source', label: 'Output Source Index', argKind: 'int', valueKind: 'number', min: 1, max: 64, canTrigger: true, operators: ['<', '>', '==', '!='] },
      { key: 'comp_knee', label: 'Compressor Knee', argKind: 'int', valueKind: 'db', unit: 'dB', min: 0, max: 5, canTrigger: true, operators: ['<', '>', '==', '!='] },
      { key: 'hpf_freq', label: 'HPF Frequency', argKind: 'float', valueKind: 'hz', unit: 'Hz', min: 20, max: 2000, canTrigger: true, operators: ['<', '>', '==', '!='] },
    ];
    const category = document.getElementById('target-category');
    const mode = document.getElementById('action-mode');
    const fade = mode.querySelector('option[value="fade"]');
    const cue = mode.querySelector('option[value="automation_cue"]');
    const read = (key) => {
      const parameter = document.getElementById('target-parameter');
      parameter.value = key;
      parameter.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        fadeDisabled: fade.disabled,
        fadeHidden: fade.hidden,
        cueDisabled: cue.disabled,
        cueHidden: cue.hidden,
        addButton: document.getElementById('add-fade-step').disabled,
      };
    };
    category.value = 'ch';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const floatNumber = read('delay_time');
    const colour = read('color');
    const sourceIndex = read('output_source');
    const knee = read('comp_knee');
    const hpf = read('hpf_freq');
    const fader = read('fader');
    // The show panel's own whole-number leaf, on the destination that offers it.
    category.value = 'show';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const sceneIndex = read('scene_index');
    // A mode the parameter cannot support must not survive the switch either: a step that carried
    // Fade falls back to Set the moment the destination becomes a whole number.
    mode.value = 'fade';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const afterStoredFade = mode.value;
    mode.value = 'automation_cue';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const afterStoredSmoothFade = mode.value;
    targetCatalog.targetParametersByCategory.ch = chRows;
    category.value = 'ch';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    return { sceneIndex, colour, sourceIndex, knee, floatNumber, hpf, fader, afterStoredFade, afterStoredSmoothFade };
  })()`);
  assert.equal(rampRule.sceneIndex.fadeDisabled, true,
    'Scene Number is a whole number (argKind int): Fade must not be offered');
  assert.equal(rampRule.sceneIndex.fadeHidden, true, 'the Fade option must be hidden, not merely disabled');
  assert.equal(rampRule.sceneIndex.cueDisabled, true,
    'Smooth fade is a ramp as well and must be refused for a whole number');
  assert.equal(rampRule.sceneIndex.addButton, true,
    'the + Fade / Ramp button must be disabled for a whole number');
  assert.equal(rampRule.colour.fadeDisabled, true,
    'a colour index is an int leaf (the backend builds it with the integer constructor) and cannot fade');
  assert.equal(rampRule.colour.cueDisabled, true, 'Smooth fade must be refused for a colour index too');
  assert.equal(rampRule.colour.addButton, true,
    'the + Fade / Ramp button must follow the same rule for a colour index');
  assert.equal(rampRule.sourceIndex.fadeDisabled, true,
    'an output source index is an int leaf and cannot fade');
  assert.equal(rampRule.sourceIndex.addButton, true,
    'the + Fade / Ramp button must follow the same rule for an output source index');
  assert.equal(rampRule.knee.fadeDisabled, true,
    'a compressor knee in whole dB carries the `db` kind a fader has, yet its leaf is an int: Fade must not be offered');
  assert.equal(rampRule.knee.cueDisabled, true,
    'Smooth fade must be refused for a whole-dB knee, whose kind alone would have allowed it');
  assert.equal(rampRule.knee.addButton, true,
    'the + Fade / Ramp button must be disabled for a whole-dB knee');
  assert.equal(rampRule.floatNumber.fadeDisabled, false,
    'Delay Time has the same `number` kind as Scene Number but is a float: it keeps its fade, which is what proves the rule reads argKind');
  assert.equal(rampRule.floatNumber.cueDisabled, false, 'Smooth fade stays available for a float number');
  assert.equal(rampRule.floatNumber.addButton, false, 'the fade step button stays enabled for a float number');
  assert.equal(rampRule.hpf.fadeDisabled, false, 'a float Hz leaf (HPF Frequency) keeps its fade');
  assert.equal(rampRule.hpf.cueDisabled, false, 'Smooth fade stays available for a float Hz leaf');
  assert.equal(rampRule.hpf.addButton, false, 'the fade step button stays enabled for a float Hz leaf');
  assert.equal(rampRule.fader.fadeDisabled, false, 'a fader is a continuous float parameter and can fade');
  assert.equal(rampRule.afterStoredFade, 'set',
    'a step that carried Fade must fall back to Set when its destination is a whole number');
  assert.equal(rampRule.afterStoredSmoothFade, 'set',
    'a step that carried Smooth fade must fall back to Set under the same rule');

  // A quick chip is a shortcut for a parameter of the current destination, not a way to move the
  // write: clicking "Pan" while the destination was `dca 5` used to write to `ch 5`.
  const chipGuard = await evaluate(`(() => {
    const category = document.getElementById('target-category');
    category.value = 'usb';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const pan = [...document.querySelectorAll('.param-preset')].find((button) => button.dataset.parameter === 'pan');
    const fader = [...document.querySelectorAll('.param-preset')].find((button) => button.dataset.parameter === 'fader');
    const panDisabled = pan.disabled;
    pan.click();
    return {
      panDisabled,
      faderDisabled: fader.disabled,
      category: document.getElementById('target-category').value,
      parameter: document.getElementById('target-parameter').value,
    };
  })()`);
  assert.equal(chipGuard.panDisabled, true, 'a chip the destination does not have must be disabled');
  assert.equal(chipGuard.faderDisabled, true, 'all three chips missing from usb must be disabled');
  assert.equal(chipGuard.category, 'usb', 'a disabled chip must never move the write to another category');
  assert.notEqual(chipGuard.parameter, 'pan', 'the parameter must not change to a chip of another family');

  // Changing the destination category changes the parameter, and a value of another kind must not
  // survive it: a fader's `-20` used to become a mute's value. Which key a fresh destination offers
  // first is the catalogue's own first row — `source_mode` for a source since batch 3 put it at the
  // head of the backend's source table — so the expectation is read from the catalogue rather than
  // pinned to a key, and the next check pins the order itself against `lib.rs`.
  const valueReset = await evaluate(`(() => {
    const category = document.getElementById('target-category');
    category.value = 'ch';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const parameter = document.getElementById('target-parameter');
    parameter.value = 'fader';
    parameter.dispatchEvent(new Event('change', { bubbles: true }));
    const value = document.getElementById('osc-value');
    value.value = '-20';
    value.dispatchEvent(new Event('input', { bubbles: true }));
    const faderValue = value.value;
    category.value = 'usb';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const first = (targetCatalog.targetParametersByCategory.usb || [])[0] || {};
    return {
      faderValue,
      firstKey: first.key,
      firstKind: first.valueKind,
      firstOption: first.options ? first.options[0] : '',
      parameter: document.getElementById('target-parameter').value,
      value: document.getElementById('osc-value').value,
      kind: activeTargetParameterInfo().valueKind,
    };
  })()`);
  assert.equal(valueReset.faderValue, '-20', 'the fader value must be settable');
  assert.equal(valueReset.parameter, valueReset.firstKey,
    `a new destination must offer its own catalogue's first parameter (got "${valueReset.parameter}", catalogue says "${valueReset.firstKey}")`);
  assert.equal(valueReset.kind, valueReset.firstKind,
    `the control must follow the new parameter's kind (got "${valueReset.kind}", catalogue says "${valueReset.firstKind}")`);
  assert.notEqual(valueReset.value, '-20', 'a dB value must not survive as the value of a parameter of another kind');
  assert.equal(valueReset.value, valueReset.firstKind === 'toggle' ? '1' : valueReset.firstOption,
    `the new parameter must start at its own default (got "${valueReset.value}" for a ${valueReset.firstKind} key)`);

  // ── IF gates follow the same rules ────────────────────────────────────────────────────────────
  await setSelect('condition-category', 'usb');
  const conditionControls = () => evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    const operator = document.getElementById('condition-operator');
    return {
      operators: [...operator.options].map((option) => option.value),
      labels: [...operator.options].map((option) => option.textContent),
      number: visible('condition-value'),
      text: visible('condition-text-value'),
      toggle: visible('condition-toggle'),
    };
  })()`);

  await setSelect('condition-parameter', 'meter');
  const meterGate = await conditionControls();
  assert.deepEqual(meterGate.operators, ['>', '<'],
    `a meter gate only crosses a threshold (got ${JSON.stringify(meterGate.operators)})`);
  assert.equal(meterGate.number, true, 'a meter gate takes a number');

  await setSelect('condition-parameter', 'name');
  const nameGate = await conditionControls();
  assert.deepEqual(nameGate.operators, ['==', '!='],
    `a name gate is compared, never ordered (got ${JSON.stringify(nameGate.operators)})`);
  assert.deepEqual(nameGate.labels, ['Equals', 'Not equals'], 'the gate labels must say what the comparison is');
  assert.equal(nameGate.text, true, 'a text gate needs a text field');
  assert.equal(nameGate.number, false, 'the numeric gate value must be hidden for a name');

  await setSelect('condition-parameter', 'mute');
  const muteGate = await conditionControls();
  assert.deepEqual(muteGate.operators, ['==', '!='],
    `an on/off gate cannot be ordered (got ${JSON.stringify(muteGate.operators)})`);
  assert.equal(muteGate.toggle, true, 'an on/off gate needs the ON/OFF pair');

  // ── A brand-new step keeps its blank channel list ─────────────────────────────────────────────
  //
  // `stepFromFields` used to write `targetIds: value.trim() || "1"`, so "+ Step" was born as channel
  // 1 and fired there as soon as a destination was chosen, while the field showed "— Not configured —".
  await evaluate(`document.getElementById('add-step').click()`);
  await sleep(250);
  const blankStep = await evaluate(`(() => {
    const steps = readConfigFromUi().actionSteps;
    const step = steps[steps.length - 1];
    return {
      field: document.getElementById('target-ids').value,
      ids: step.targetIds,
      address: step.actionAddress,
      oscAddress: document.getElementById('osc-address').value,
    };
  })()`);
  assert.equal(blankStep.field, '', 'a new step shows an empty channel list');
  assert.equal(blankStep.ids, '', 'a blank channel list must be stored blank, never as channel 1');
  assert.equal(blankStep.address, '', 'a blank step carries no address');
  assert.equal(blankStep.oscAddress, '', 'the address preview must not invent /ch/1/... for a blank step');

  // ── A send names its destination, and its index is bounded by it ──────────────────────────────
  //
  // `#send-id` was a bare "Send 1…16": the same box meant a bus, a matrix or a main depending on the
  // selected key, and "send Matrix 9" passed the rule while the console ignored the write. The
  // destination now comes from the parameter row (`sendIndexLabel`/`sendIndexMax`), and the label,
  // the hint and the refusal all name it.
  await setSelect('target-category', 'ch');
  await setSelect('target-parameter', 'send_level');
  const busSend = await evaluate(`(() => ({
    label: document.getElementById('send-id-label').textContent,
    hint: document.getElementById('send-id-hint').textContent,
    shown: !document.getElementById('send-id-field').classList.contains('hidden'),
    max: document.getElementById('send-id').max,
  }))()`);
  assert.equal(busSend.shown, true, 'a send_* parameter must show the destination control');
  assert.match(busSend.label, /Bus/, `the label must name the destination (got "${busSend.label}")`);
  assert.match(busSend.hint, /Bus/, `the hint must name the destination (got "${busSend.hint}")`);
  assert.equal(busSend.max, '16', 'a bus send takes 1…16');

  await type('send-id', '16');
  assert.equal(await evaluate(`document.getElementById('send-id').classList.contains('is-invalid')`), false,
    'bus 16 is the last bus and must be accepted');
  await type('send-id', '17');
  assert.equal(await evaluate(`document.getElementById('send-id').classList.contains('is-invalid')`), true,
    'bus 17 does not exist and must be refused, not clamped');
  const busProblem = await evaluate(`document.getElementById('send-id-problem')?.textContent || ''`);
  assert.match(busProblem, /Bus/, `the reason must name the destination (got "${busProblem}")`);
  assert.match(busProblem, /16/, `the reason must say which bus is the last (got "${busProblem}")`);

  // …and the refusal reaches the save gate rather than persisting a write nowhere.
  await evaluate(`document.getElementById('library-save-current').click()`);
  await sleep(250);
  assert.equal(await dialogVisible(), true, 'saving a send index past its destination must be refused');
  const sendSaveMessage = await dialogText();
  assert.match(sendSaveMessage, /Cannot save/i, `the dialog must say it cannot save (got "${sendSaveMessage}")`);
  assert.match(sendSaveMessage, /Bus/i, `the dialog must name the destination (got "${sendSaveMessage}")`);
  await closeDialogIfOpen();
  await type('send-id', '16');

  // The same control follows the key: a matrix send has eight destinations, a main send four.
  await setSelect('target-parameter', 'send_matrix_level');
  const matrixSend = await evaluate(`(() => ({
    label: document.getElementById('send-id-label').textContent,
    max: document.getElementById('send-id').max,
  }))()`);
  assert.match(matrixSend.label, /Matrix/, `the label must follow the key (got "${matrixSend.label}")`);
  assert.equal(matrixSend.max, '8', 'there are 8 matrices');
  await type('send-id', '9');
  assert.equal(await evaluate(`document.getElementById('send-id').classList.contains('is-invalid')`), true,
    'matrix 9 must be refused');
  assert.match(await evaluate(`document.getElementById('send-id-problem')?.textContent || ''`), /Matrix/,
    'the reason must name the matrix destination');
  await type('send-id', '8');

  await setSelect('target-parameter', 'send_main_level');
  const mainSend = await evaluate(`(() => ({
    label: document.getElementById('send-id-label').textContent,
    max: document.getElementById('send-id').max,
  }))()`);
  assert.match(mainSend.label, /Main/, `the label must follow the key (got "${mainSend.label}")`);
  assert.equal(mainSend.max, '4', 'there are 4 mains');
  await type('send-id', '5');
  assert.equal(await evaluate(`document.getElementById('send-id').classList.contains('is-invalid')`), true,
    'main 5 must be refused');
  assert.match(await evaluate(`document.getElementById('send-id-problem')?.textContent || ''`), /Main/,
    'the reason must name the main destination');
  await type('send-id', '1');

  // ── The grouped picker reaches the sends the flat list buried ─────────────────────────────────
  //
  // The operator's report was "faltan sends a matrices": `send_matrix_level` was in the catalogue and
  // resolved (`/ch/1/send/MX1/lvl`), but it sat near the bottom of one flat <select> and was
  // effectively invisible. The picker is a grouped view over that very select — same id, same
  // options, same `change` event — so this is the regression that must stay reachable from the UI.
  await setSelect('target-category', 'ch');
  const pickerShape = await evaluate(`(() => {
    const host = document.querySelector('[data-parameter-picker="target-parameter"]');
    const button = document.getElementById('target-parameter-menu');
    const panel = document.getElementById('target-parameter-menu-list');
    const noteOf = (item) => item.querySelector('.parameter-menu-note')?.textContent || '';
    button.click();
    const groups = [...panel.children]
      .filter((child) => child.classList.contains('parameter-menu-item'))
      .map((item) => item.dataset.menuGroup);
    const sends = panel.querySelector('[data-menu-group="sends"]');
    // Hover is the pointer path: the submenu opens without a click.
    sends.dispatchEvent(new MouseEvent('mouseenter'));
    const sendsOpen = sends.classList.contains('is-open');
    const childGroups = [...sends.querySelectorAll('.parameter-menu-submenu > .parameter-menu-item')]
      .map((item) => item.dataset.menuGroup);
    const bus = sends.querySelector('[data-menu-group="sends_bus"]');
    const matrix = sends.querySelector('[data-menu-group="sends_matrix"]');
    const main = sends.querySelector('[data-menu-group="sends_main"]');
    matrix.dispatchEvent(new MouseEvent('mouseenter'));
    const matrixEntries = [...matrix.querySelectorAll('.parameter-menu-row[data-parameter]')].map((row) => row.dataset.parameter);
    main.dispatchEvent(new MouseEvent('mouseenter'));
    const mainEntries = [...main.querySelectorAll('.parameter-menu-row[data-parameter]')].map((row) => row.dataset.parameter);
    return {
      host: Boolean(host),
      groups,
      sendsOpen,
      childGroups,
      busRange: noteOf(bus),
      matrixRange: noteOf(matrix),
      mainRange: noteOf(main),
      matrixEntries,
      mainEntries,
      selectOptions: [...document.getElementById('target-parameter').options].map((option) => option.value),
    };
  })()`);
  assert.equal(pickerShape.host, true, 'the target parameter must carry a grouped picker');
  assert.ok(pickerShape.groups.includes('level'), `the menu must expose its groups (got ${JSON.stringify(pickerShape.groups)})`);
  assert.ok(pickerShape.groups.includes('sends'), 'the menu must have a Sends group');
  assert.equal(pickerShape.sendsOpen, true, 'hovering a group must open its submenu');
  assert.deepEqual(pickerShape.childGroups, ['sends_bus', 'sends_matrix', 'sends_main'],
    `the Sends submenu must hold the three destination families (got ${JSON.stringify(pickerShape.childGroups)})`);
  assert.ok(pickerShape.matrixEntries.includes('send_matrix_level'),
    `a matrix send must be reachable from the UI, not only from the catalogue (got ${JSON.stringify(pickerShape.matrixEntries)})`);
  assert.ok(pickerShape.mainEntries.includes('send_main_level'),
    `a main send must be reachable from the UI too (got ${JSON.stringify(pickerShape.mainEntries)})`);
  assert.equal(pickerShape.busRange, 'Bus 1…16', 'the bus submenu must name its destination range');
  assert.equal(pickerShape.matrixRange, 'Matrix 1…8', 'the matrix submenu must name its destination range');
  assert.equal(pickerShape.mainRange, 'Main 1…4', 'the main submenu must name its destination range');
  assert.ok(pickerShape.selectOptions.includes('send_matrix_level'),
    'the select under the menu must keep carrying every option it carried before');

  // One implementation, three pickers: the trigger and the gate draw the same groups over their own
  // selects, so a target added to one is reachable from all of them.
  const otherPickers = await evaluate(`(() => {
    const setCategory = (id) => {
      const select = document.getElementById(id);
      select.value = 'ch';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setCategory('trigger-category');
    setCategory('condition-category');
    const read = (id) => {
      const button = document.getElementById(id + '-menu');
      const panel = document.getElementById(id + '-menu-list');
      button.click();
      const groups = [...panel.children]
        .filter((child) => child.classList.contains('parameter-menu-item'))
        .map((item) => item.dataset.menuGroup);
      button.click();
      return groups;
    };
    return { trigger: read('trigger-parameter'), condition: read('condition-parameter') };
  })()`);
  for (const [name, groups] of Object.entries(otherPickers)) {
    assert.ok(groups.includes('sends'), `the ${name} picker must expose the Sends group too (got ${JSON.stringify(groups)})`);
    assert.ok(groups.includes('level'), `the ${name} picker must expose its groups (got ${JSON.stringify(groups)})`);
  }

  // Choosing through the menu writes to the select and reaches the saved config, exactly as picking
  // the entry in the native list does.
  await setSelect('target-category', 'ch');
  const menuChoice = await evaluate(`(() => {
    // "On screen" means inside the viewport, not merely laid out: \`getClientRects().length > 0\` is
    // true for a box parked at \`left: -186px\`, which is how the narrow-window submenu escaped the
    // assertion this replaces (see the narrow-width check below).
    const inViewport = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
        && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
    };
    document.getElementById('target-parameter-menu').click();
    const panel = document.getElementById('target-parameter-menu-list');
    const sends = panel.querySelector('[data-menu-group="sends"]');
    sends.dispatchEvent(new MouseEvent('mouseenter'));
    const matrix = sends.querySelector('[data-menu-group="sends_matrix"]');
    matrix.dispatchEvent(new MouseEvent('mouseenter'));
    const row = matrix.querySelector('.parameter-menu-row[data-parameter="send_matrix_level"]');
    const reachable = inViewport(row);
    row.click();
    const select = document.getElementById('target-parameter');
    return {
      reachable,
      value: select.value,
      optionText: select.selectedOptions[0]?.textContent || '',
      draft: readConfigFromUi().actionSteps[selectedStepIndex]?.targetParameter || '',
      closed: document.getElementById('target-parameter-menu-list').hidden,
      buttonValue: document.querySelector('[data-parameter-picker="target-parameter"] .parameter-menu-value')?.textContent || '',
    };
  })()`);
  assert.equal(menuChoice.reachable, true, 'the matrix send entry must be on screen inside the open submenu');
  assert.equal(menuChoice.value, 'send_matrix_level', 'the menu must write the choice into the select');
  assert.match(menuChoice.optionText, /Matrix Send Level/, 'the select must show the parameter chosen from the menu');
  assert.equal(menuChoice.draft, 'send_matrix_level', 'the chosen parameter must reach the step the editor reads');
  assert.equal(menuChoice.closed, true, 'choosing an entry must close the menu');
  assert.match(menuChoice.buttonValue, /Matrix Send Level/, 'the menu button must name the chosen parameter');

  // ── The submenu stays inside the window at a narrow width ─────────────────────────────────────
  //
  // At ~420 px the Sends submenu flipped to avoid the right edge and landed mostly off the *left*
  // one (measured `left: -186, right: 34`): an unlabelled sliver whose own nested submenu then
  // covered its parent. The flip tested only the right edge. Both edges are tested now and the
  // result is clamped; this measures the real rectangles against the viewport, which the old
  // `getClientRects().length > 0` helper could not do — it is true for that sliver.
  const narrowViewport = [420, 720];
  await call('Emulation.setDeviceMetricsOverride', {
    width: narrowViewport[0], height: narrowViewport[1], deviceScaleFactor: 1, mobile: false,
  });
  await sleep(250);
  const narrowMenu = await evaluate(`(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
        width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
    };
    const inside = (b) => Boolean(b) && b.width > 0 && b.height > 0
      && b.left >= 0 && b.top >= 0 && b.right <= window.innerWidth && b.bottom <= window.innerHeight;
    document.getElementById('target-parameter-menu').click();
    const panel = document.getElementById('target-parameter-menu-list');
    const sends = panel.querySelector('[data-menu-group="sends"]');
    sends.dispatchEvent(new MouseEvent('mouseenter'));
    const sendsSubmenu = sends.querySelector('.parameter-menu-submenu');
    const matrix = sends.querySelector('[data-menu-group="sends_matrix"]');
    matrix.dispatchEvent(new MouseEvent('mouseenter'));
    const nested = matrix.querySelector('.parameter-menu-submenu');
    const row = matrix.querySelector('.parameter-menu-row[data-parameter="send_matrix_level"]');
    const label = row?.querySelector('.parameter-menu-label');
    const boxes = {
      panel: box(panel),
      sendsRow: box(sends.querySelector('.parameter-menu-row')),
      sendsSubmenu: box(sendsSubmenu),
      nested: box(nested),
      row: box(row),
    };
    return {
      view: [window.innerWidth, window.innerHeight],
      boxes,
      inside: Object.fromEntries(Object.entries(boxes).map(([key, value]) => [key, inside(value)])),
      rowLabelText: label?.textContent || '',
      rowLabelFits: Boolean(row?.contains(label)) && label.getBoundingClientRect().width > 0,
      open: !panel.hidden,
    };
  })()`);
  await call('Emulation.clearDeviceMetricsOverride');
  await sleep(200);
  assert.equal(narrowMenu.open, true, 'the picker must be open for the narrow-width check');
  for (const [name, ok] of Object.entries(narrowMenu.inside)) {
    assert.equal(ok, true,
      `at ${narrowViewport[0]} px the ${name} must stay inside the viewport (${JSON.stringify(narrowMenu.boxes[name])} in ${JSON.stringify(narrowMenu.view)})`);
  }
  assert.match(narrowMenu.rowLabelText, /Matrix Send Level/,
    `the nested submenu must keep its label on screen (got "${narrowMenu.rowLabelText}")`);
  assert.equal(narrowMenu.rowLabelFits, true, 'the entry must still render its own label');
  // The nested submenu belongs to the matrix row and must not be hidden behind its parent's box.
  assert.ok(narrowMenu.boxes.nested.left >= narrowMenu.boxes.sendsSubmenu.left,
    `the nested submenu must not be drawn to the left of the branch it belongs to (${JSON.stringify(narrowMenu.boxes)})`);
  await evaluate(`document.getElementById('target-parameter-menu').click()`);
  console.log('narrow width: the Sends submenu and its nested branch stay inside the window');
  // The config the save path is handed carries the parameter the menu chose. (The standalone page has
  // no `resolve_basic_target` in its IPC mock, so a save with a target configured aborts on the
  // address resolve before `save_macro_library`, exactly as the trigger-send check above notes; what
  // this pins is the config that path gets.)
  const menuChoiceConfig = await evaluate(`(() => {
    const config = disarmedConfig(readConfigFromUi());
    const step = (config.actionSteps || [])[selectedStepIndex] || {};
    return { parameter: step.targetParameter, sendId: step.sendId };
  })()`);
  assert.equal(menuChoiceConfig.parameter, 'send_matrix_level',
    'the saved config must carry the parameter chosen from the menu');

  // ── The keyboard path through the picker ──────────────────────────────────────────────────────
  //
  // The reviewer drove this with trusted key events and it works, but no script tested it at all
  // (there was no Arrow*/Enter/Tab in any of them): a picker that only answers the pointer is
  // unusable for an operator who never touches the mouse, and nothing stopped it rotting. These are
  // trusted events through CDP, so the browser's own default actions — Tab moving the focus, Enter
  // clicking the focused button — are what carries the path.
  const pressKey = async (key, code, keyCode) => {
    // `keyDown` (with the text Enter carries), not `rawKeyDown`: the browser's default action for
    // Enter on a focused button — the click this path relies on — needs the full keyboard event.
    const text = key === 'Enter' ? '\r' : undefined;
    const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await call('Input.dispatchKeyEvent', { type: 'keyDown', ...common, ...(text ? { text, unmodifiedText: text } : {}) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
    await sleep(90);
  };
  const focusState = () => evaluate(`(() => {
    const active = document.activeElement;
    return {
      id: active?.id || '',
      tag: active?.tagName || '',
      isMenuButton: Boolean(active?.classList?.contains('parameter-menu-button')),
      isRow: Boolean(active?.classList?.contains('parameter-menu-row')),
      isGroup: Boolean(active?.classList?.contains('is-group')),
      rowValue: active?.dataset?.menuValue || '',
      panelOpen: !document.getElementById('target-parameter-menu-list').hidden,
      insideSubmenu: Boolean(active?.closest?.('.parameter-menu-submenu')),
    };
  })()`);
  // The native list is hidden behind the picker button (one choice, one control), so the Tab path an
  // operator takes is from the control just before it — the matrix button that belongs to the ids
  // field — into the picker button.
  await evaluate(`document.querySelector('.btn-open-matrix[data-target-input="target-ids"]').focus()`);
  await pressKey('Tab', 'Tab', 9);
  const tabbed = await focusState();
  assert.equal(tabbed.isMenuButton, true, `Tab must reach the picker button (focus: ${JSON.stringify(tabbed)})`);
  await pressKey('ArrowDown', 'ArrowDown', 40);
  const opened = await focusState();
  assert.equal(opened.panelOpen, true, 'ArrowDown on the button must open the panel');
  assert.equal(opened.isRow, true, `ArrowDown must focus a row (focus: ${JSON.stringify(opened)})`);
  assert.equal(opened.isGroup, true,
    `the top level holds group rows, which ArrowRight enters (focus: ${JSON.stringify(opened)})`);
  await pressKey('ArrowRight', 'ArrowRight', 39);
  const entered = await focusState();
  assert.equal(entered.panelOpen, true, 'the panel must stay open while a group is entered');
  assert.equal(entered.insideSubmenu, true,
    `ArrowRight must enter the group and focus a row inside its submenu (focus: ${JSON.stringify(entered)})`);
  // Walk down to a real entry: a group row opens another branch instead of choosing.
  let entry = entered;
  let steps = 0;
  while (entry.isGroup && steps < 40) {
    await pressKey('ArrowDown', 'ArrowDown', 40);
    entry = await focusState();
    steps += 1;
  }
  assert.equal(entry.isGroup, false, `the walk must reach an entry row (focus: ${JSON.stringify(entry)})`);
  assert.ok(entry.rowValue, `the focused entry must name a parameter (focus: ${JSON.stringify(entry)})`);
  const chosenByKeyboard = entry.rowValue;
  await pressKey('Enter', 'Enter', 13);
  const applied = await evaluate(`(() => ({
    value: document.getElementById('target-parameter').value,
    panelOpen: !document.getElementById('target-parameter-menu-list').hidden,
    focusedButton: document.activeElement?.id || '',
  }))()`);
  assert.equal(applied.panelOpen, false, 'Enter must close the panel');
  assert.equal(applied.value, chosenByKeyboard,
    `Enter must apply the focused entry (got ${JSON.stringify(applied)} for "${chosenByKeyboard}")`);
  assert.equal(applied.focusedButton, 'target-parameter-menu', 'the focus must come back to the button');
  // Escape closes without choosing and leaves the focus where the operator can carry on.
  await pressKey('ArrowDown', 'ArrowDown', 40);
  assert.equal((await focusState()).panelOpen, true, 'ArrowDown must reopen the panel for the Escape check');
  await pressKey('Escape', 'Escape', 27);
  const escaped = await evaluate(`(() => ({
    panelOpen: !document.getElementById('target-parameter-menu-list').hidden,
    focusedButton: document.activeElement?.id || '',
    value: document.getElementById('target-parameter').value,
  }))()`);
  assert.equal(escaped.panelOpen, false, 'Escape must close the panel');
  assert.equal(escaped.focusedButton, 'target-parameter-menu', 'Escape must return the focus to the button');
  assert.equal(escaped.value, chosenByKeyboard, 'Escape must leave the choice alone');
  // Back where the following checks expect the target panel.
  await evaluate(`(() => {
    const select = document.getElementById('target-parameter');
    select.value = 'send_matrix_level';
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  console.log(`keyboard: Tab → ArrowDown → ArrowRight → ${steps}× ArrowDown → Enter applied "${chosenByKeyboard}", Escape closed`);

  // ── One choice, one control ───────────────────────────────────────────────────────────────────
  //
  // The window used to draw the flat native list *and* the grouped button under it: two dropdowns of
  // different shapes for one choice. A native list cannot carry the picker's two levels (`<optgroup>`
  // gives one and no submenu), so the button is the field's control and the native list stays in the
  // DOM, hidden, as the value holder every other part of the editor reads.
  const oneControl = await evaluate(`(() => {
    const select = document.getElementById('target-parameter');
    const button = document.getElementById('target-parameter-menu');
    const label = select.closest('label');
    const firstLabelable = label.querySelector('button, input, select, textarea');
    return {
      selectRects: select.getClientRects().length,
      selectDisplay: getComputedStyle(select).display,
      buttonRects: button.getClientRects().length,
      buttonHeight: Math.round(button.getBoundingClientRect().height),
      buttonBackground: getComputedStyle(button).backgroundColor,
      inspector: button.dataset.inspector || '',
      labelHasButton: label.contains(button),
      firstLabelable: firstLabelable ? firstLabelable.id : '',
    };
  })()`);
  assert.equal(oneControl.selectRects, 0, 'the native list must not be drawn beside the button');
  assert.equal(oneControl.selectDisplay, 'none', 'the native list is hidden with display: none');
  assert.ok(oneControl.buttonRects > 0, 'the grouped button is the control the operator sees');
  assert.ok(oneControl.buttonHeight >= 22,
    `the button must wear the field's height (got ${oneControl.buttonHeight}px)`);
  assert.equal(oneControl.buttonBackground, 'rgb(255, 255, 255)',
    `the button must wear the field's white box (got ${oneControl.buttonBackground})`);
  assert.equal(oneControl.inspector, 'target-parameter',
    "the button must carry the field's own ScreenTip, because the id now lives on the hidden list");
  assert.equal(oneControl.labelHasButton, true, "the field's label must wrap the button");
  assert.equal(oneControl.firstLabelable, 'target-parameter-menu',
    "the field's label must point at the button, never at the hidden list");
  // A click on the field's own label is what the operator does when they read "Parameter": it must
  // reach the button, not an invisible select.
  await evaluate(`document.getElementById('target-parameter').closest('label').click()`);
  await sleep(120);
  const labelOpened = await evaluate(`(() => ({
    panelOpen: !document.getElementById('target-parameter-menu-list').hidden,
    focused: document.activeElement?.id || '',
  }))()`);
  assert.equal(labelOpened.panelOpen, true,
    `clicking the field's label must open the picker (focus: ${labelOpened.focused})`);
  await evaluate(`document.getElementById('target-parameter-menu').click()`);
  await sleep(80);
  assert.equal(await evaluate(`document.getElementById('target-parameter-menu-list').hidden`), true,
    'the button closes the panel it opened');
  console.log(`one control: native list hidden, button ${oneControl.buttonHeight}px, label opens the picker`);

  // ── A bus is never offered a send to itself ───────────────────────────────────────────────────
  //
  // Maillot footnote 38 (`scratch/wing_protocols.txt`:2528): "Sending bus 'n' to bus 'n' is not
  // possible… trying to enable `/bus/1/send/1/on` will be ignored". The backend refuses it, so the
  // editor must not offer it: the bus's own index is disabled in the destination list, with the
  // reason on the row, and a draft that already points there is marked invalid.
  await setSelect('target-category', 'bus');
  await setSelect('target-parameter', 'send_level');
  await type('target-ids', '3');
  // No destination is chosen for a fresh send: the field is emptied, flagged, and the list asks for
  // one instead of handing the console bus 1 in silence.
  await type('send-id', '');
  const emptyDestination = await evaluate(`(() => ({
    invalid: document.getElementById('send-id').classList.contains('is-invalid'),
    problem: document.getElementById('send-id-problem')?.textContent || '',
    placeholder: document.querySelector('#send-id-menu-list .parameter-menu-row')?.textContent?.trim() || '',
  }))()`);
  assert.equal(emptyDestination.invalid, true, 'a send with no destination must be marked invalid');
  assert.match(emptyDestination.problem, /choose the bus this send feeds \(1…16\)/,
    `the reason must ask for the destination (got "${emptyDestination.problem}")`);
  const selfSendList = await evaluate(`(() => {
    const button = document.getElementById('send-id-menu');
    button.click();
    const panel = document.getElementById('send-id-menu-list');
    const rows = [...panel.querySelectorAll('.parameter-menu-row')];
    const own = rows.find((row) => row.dataset.menuValue === '3');
    const other = rows.find((row) => row.dataset.menuValue === '2');
    const before = document.getElementById('send-id').value;
    own.click();
    const afterOwnClick = document.getElementById('send-id').value;
    other.click();
    return {
      count: rows.length,
      ownDisabled: own.disabled,
      ownLabel: own.textContent,
      ownTitle: own.title,
      afterOwnClick,
      before,
      afterOther: document.getElementById('send-id').value,
    };
  })()`);
  // The first row is the "choose the destination" placeholder: a send with no destination has no
  // address, so the list asks for one instead of pre-selecting bus 1.
  assert.equal(selfSendList.count, 17, `a bus send offers the 16 buses plus the placeholder (got ${selfSendList.count})`);
  assert.equal(selfSendList.before, '', 'a send parameter starts with no destination chosen');
  assert.equal(selfSendList.ownDisabled, true, "a bus's own index must be offered as unavailable");
  assert.match(selfSendList.ownLabel, /Bus 3 cannot send to itself/,
    `the unavailable row must name the bus and the rule (got "${selfSendList.ownLabel}")`);
  assert.match(selfSendList.ownLabel, /footnote 38/, "the reason must cite Maillot's footnote 38");
  assert.match(selfSendList.ownTitle, /footnote 38/, 'the tooltip must carry the reason too');
  assert.equal(selfSendList.afterOwnClick, selfSendList.before,
    'a disabled destination must not be selectable, by click or otherwise');
  assert.equal(selfSendList.afterOther, '2', 'the other destinations must stay selectable');

  // A draft (or a stored macro) that points at the bus's own send is refused with the same reason,
  // not silently kept as a target that never fires.
  await type('send-id', '3');
  assert.equal(await evaluate(`document.getElementById('send-id').classList.contains('is-invalid')`), true,
    "a bus's own send must be marked invalid");
  const selfSendProblem = await evaluate(`document.getElementById('send-id-problem')?.textContent || ''`);
  assert.match(selfSendProblem, /Bus 3 cannot send to itself/,
    `the field must say why (got "${selfSendProblem}")`);
  assert.match(selfSendProblem, /footnote 38/, 'the field reason must cite footnote 38');
  await evaluate(`document.getElementById('library-save-current').click()`);
  await sleep(250);
  assert.equal(await dialogVisible(), true, 'saving a bus send to itself must be refused');
  const selfSendSaveMessage = await dialogText();
  assert.match(selfSendSaveMessage, /Bus 3 cannot send to itself/,
    `the save refusal must carry the footnote-38 reason (got "${selfSendSaveMessage}")`);
  await closeDialogIfOpen();
  await type('send-id', '4');
  assert.equal(await evaluate(`document.getElementById('send-id').classList.contains('is-invalid')`), false,
    'bus 4 is a legal destination for a bus-3 strip');
  assert.match(await evaluate(`document.getElementById('recipe-action').textContent`), /send Bus 4/,
    'the action readout must name the destination the operator chose');

  // The trigger panel carries its own strip and its own index, and follows the same rule.
  await setSelect('trigger-category', 'bus');
  await setSelect('trigger-parameter', 'send_level');
  await type('trigger-ids', '5');
  const triggerSelfSend = await evaluate(`(() => {
    document.getElementById('trigger-send-id-menu').click();
    const rows = [...document.getElementById('trigger-send-id-menu-list').querySelectorAll('.parameter-menu-row')];
    const own = rows.find((row) => row.dataset.menuValue === '5');
    return { disabled: own?.disabled, label: own?.textContent || '' };
  })()`);
  assert.equal(triggerSelfSend.disabled, true, "a bus trigger must not be offered its own send either");
  assert.match(triggerSelfSend.label, /Bus 5 cannot send to itself/, 'the trigger list must carry the same reason');
  await type('trigger-send-id', '5');
  assert.equal(await evaluate(`document.getElementById('trigger-send-id').classList.contains('is-invalid')`), true,
    "a bus trigger watching its own send must be marked invalid");
  assert.match(await evaluate(`document.getElementById('trigger-send-id-problem')?.textContent || ''`), /footnote 38/,
    'the trigger refusal must cite footnote 38');
  await type('trigger-send-id', '1');

  // The same id-list parse decides the bus's own send, so an en-dash list has to reach it too: with
  // "3–5" the editor must see 3, 4 and 5, or bus 4 would be offered as a legal destination for a
  // bus-3…5 trigger — the write footnote 38 says the console ignores.
  await type('trigger-ids', '3\u20135');
  await type('trigger-send-id', '4');
  assert.equal(await evaluate(`document.getElementById('trigger-send-id').classList.contains('is-invalid')`), true,
    'an en-dash range must reach the bus self-send rule, which reads the same list');
  assert.match(await evaluate(`document.getElementById('trigger-send-id-problem')?.textContent || ''`), /Bus 4 cannot send to itself/,
    'the reason must name the bus the en-dash range covers');
  await type('trigger-send-id', '6');
  assert.equal(await evaluate(`document.getElementById('trigger-send-id').classList.contains('is-invalid')`), false,
    'bus 6 is outside the 3–5 range and must stay legal');
  await type('trigger-ids', '5');
  await type('trigger-send-id', '1');

  // Put the panels back where the next checks expect them.
  await setSelect('target-category', 'ch');
  await type('target-ids', '1');
  await setSelect('target-parameter', 'send_level');
  await type('send-id', '1');

  // ── Availability is per family ────────────────────────────────────────────────────────────────
  // An aux has a pre-insert and no post-insert (`/aux/1/postins/on` is silent on hardware), the
  // post-insert mode and its autogain weight are channel controls, and a matrix has no send node at
  // all (Maillot 2182-2183). `ptap` is offered on channels alone, and its encoding is settled: the
  // desk takes the eight documented strings verbatim (WING Rack, FW 3.1.1).
  const familyKeys = await evaluate(`(() => {
    const category = document.getElementById('target-category');
    const parameter = document.getElementById('target-parameter');
    const keysFor = (key) => {
      category.value = key;
      category.dispatchEvent(new Event('change', { bubbles: true }));
      return [...parameter.options].map((option) => option.value);
    };
    return { ch: keysFor('ch'), aux: keysFor('aux'), bus: keysFor('bus'), main: keysFor('main'), matrix: keysFor('matrix') };
  })()`);
  assert.ok(familyKeys.ch.includes('post_insert_slot'), 'a channel has a post-insert');
  assert.ok(!familyKeys.aux.includes('post_insert_slot'), 'an aux has no post-insert');
  assert.ok(familyKeys.aux.includes('pre_insert_slot'), 'an aux has a pre-insert');
  assert.ok(familyKeys.ch.includes('post_insert_mode'), 'the post-insert mode is a channel control');
  ['aux', 'bus', 'main', 'matrix'].forEach((family) => {
    assert.ok(!familyKeys[family].includes('post_insert_mode'),
      `the post-insert mode is a channel control, not a ${family} one`);
  });
  ['ch', 'aux', 'bus', 'main', 'matrix'].forEach((family) => {
    assert.ok(familyKeys[family].includes('delay_on'), `${family} has an input/output delay`);
    assert.equal(familyKeys[family].includes('ptap'), family === 'ch',
      `the pretap is a channel control and must be offered there alone (${family})`);
  });
  assert.ok(familyKeys.bus.includes('send_level'), 'a bus sends to other buses');
  assert.ok(!familyKeys.main.includes('send_level'), 'a main has no numeric bus send');
  assert.ok(familyKeys.main.includes('send_matrix_level'), 'a main sends to matrices');
  assert.ok(!familyKeys.main.includes('send_main_level'), 'a main does not send to itself');
  assert.ok(familyKeys.bus.includes('send_pre'), 'a bus send takes its tap as pre/post');
  assert.ok(!familyKeys.ch.includes('send_pre'), 'a channel send takes PRE/POST/GRP, not pre/post');
  assert.ok(!familyKeys.matrix.includes('send_level'), 'a matrix has no send node at all');
  assert.ok(!familyKeys.matrix.includes('send_matrix_level'), 'a matrix has no matrix send either');

  // ── The standalone catalogue carries the backend's delay range ───────────────────────────────
  // One f32 range cannot express the four documented units (0…150 m, 0.5…500 ft, 0.5…500 ms,
  // 16…500 samples), so the backend takes the widest documented value and names each unit's own
  // limit in the hint. The fallback the standalone window runs on must say the same: pinned at 150 it
  // refused a 500 ms delay the packaged app accepted. This test runs without an IPC stub, so what it
  // drives IS the fallback catalogue.
  await setSelect('target-category', 'ch');
  await setSelect('target-parameter', 'delay_time');
  await type('osc-value', '500');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), false,
    '500 ms, the widest documented delay, must be accepted and not refused at 150');
  const delayHint = await evaluate(`document.getElementById('value-hint').textContent`);
  assert.match(delayHint, /150 m/, `the hint must name the metre limit (got "${delayHint}")`);
  assert.match(delayHint, /500 samples/, `the hint must name the sample limit (got "${delayHint}")`);
  assert.match(delayHint, /Delay Mode/, `the hint must say the unit follows Delay Mode (got "${delayHint}")`);
  await type('osc-value', '600');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), true,
    'a delay past the widest documented value must still be refused');

  // Put the panels back where the next checks expect them: the 600 ms delay belongs to `delay_time`
  // and would be an out-of-range value on the send the next checks configure.
  await setSelect('target-category', 'ch');
  await type('target-ids', '1');
  await setSelect('target-parameter', 'send_level');
  await type('send-id', '1');
  await type('osc-value', '-20');

  // ── A trigger or an IF gate that watches a send carries its own destination ───────────────────
  //
  // The backend refuses a trigger or a gate on a send with no destination index: a bus send with no
  // destination is the self-send the console ignores, so "watch send 1" in silence is not an option.
  // The trigger panel and the gate panel therefore get the same bounded control the step has.
  await setSelect('trigger-category', 'ch');
  await setSelect('trigger-parameter', 'send_matrix_level');
  const triggerSend = await evaluate(`(() => ({
    label: document.getElementById('trigger-send-id-label').textContent,
    hint: document.getElementById('trigger-send-id-hint').textContent,
    shown: !document.getElementById('trigger-send-id-field').classList.contains('hidden'),
    max: document.getElementById('trigger-send-id').max,
  }))()`);
  assert.equal(triggerSend.shown, true, 'a send trigger must show its own destination control');
  assert.match(triggerSend.label, /Matrix/, `the trigger label must name the destination (got "${triggerSend.label}")`);
  assert.match(triggerSend.hint, /Matrix/, `the trigger hint must name the destination (got "${triggerSend.hint}")`);
  assert.equal(triggerSend.max, '8', 'a matrix send trigger takes 1…8');
  await type('trigger-send-id', '9');
  assert.equal(await evaluate(`document.getElementById('trigger-send-id').classList.contains('is-invalid')`), true,
    'matrix 9 must be refused on the trigger too');
  assert.match(await evaluate(`document.getElementById('trigger-send-id-problem')?.textContent || ''`), /Matrix/,
    'the trigger refusal must name the destination');
  await type('trigger-send-id', '8');
  assert.equal(await evaluate(`document.getElementById('trigger-send-id').classList.contains('is-invalid')`), false,
    'matrix 8 is the last matrix and must be accepted');
  assert.match(await evaluate(`document.getElementById('recipe-trigger').textContent`), /send Matrix 8/,
    'the trigger readout must name the destination');

  // The config the editor hands to the save and preflight paths carries the index. (The standalone
  // page has no `resolve_basic_target` in its IPC mock, so a save with a target configured aborts on
  // the address resolve before `save_macro_library`; what this pins is the config that path gets.)
  const savedTriggerSend = await evaluate(`(() => {
    const config = readConfigFromUi();
    return { parameter: config.triggerParameter, sendId: config.sendId };
  })()`);
  assert.equal(savedTriggerSend.parameter, 'send_matrix_level', 'the config must keep the watched send');
  assert.equal(savedTriggerSend.sendId, 8, 'the config must carry the trigger destination index');
  await setSelect('trigger-parameter', 'mute');
  assert.equal(await evaluate(`document.getElementById('trigger-send-id-field').classList.contains('hidden')`), true,
    'a trigger with no destination must not show an index control');
  await setSelect('trigger-parameter', 'send_matrix_level');

  // The same control on an IF gate, with that gate's own destination.
  await evaluate(`document.getElementById('add-condition').click()`);
  await sleep(250);
  await setSelect('condition-category', 'ch');
  await setSelect('condition-parameter', 'send_main_on');
  const gateSend = await evaluate(`(() => ({
    label: document.getElementById('condition-send-id-label').textContent,
    shown: !document.getElementById('condition-send-id-field').classList.contains('hidden'),
    max: document.getElementById('condition-send-id').max,
  }))()`);
  assert.equal(gateSend.shown, true, 'a send gate must show its own destination control');
  assert.match(gateSend.label, /Main/, `the gate label must name the destination (got "${gateSend.label}")`);
  assert.equal(gateSend.max, '4', 'a main send gate takes 1…4');
  await type('condition-send-id', '5');
  assert.equal(await evaluate(`document.getElementById('condition-send-id').classList.contains('is-invalid')`), true,
    'main 5 must be refused on a gate');
  assert.match(await evaluate(`document.getElementById('condition-send-id-problem')?.textContent || ''`), /Main/,
    'the gate refusal must name the destination');
  await type('condition-send-id', '4');
  const savedGateSend = await evaluate(`(() => {
    const config = readConfigFromUi();
    const gate = config.conditions[config.conditions.length - 1] || {};
    return { parameter: gate.targetParameter, sendId: gate.sendId, recipe: document.getElementById('recipe-condition').textContent };
  })()`);
  assert.equal(savedGateSend.parameter, 'send_main_on', 'the gate must keep the watched send');
  assert.equal(savedGateSend.sendId, 4, 'the gate must carry its own destination index');
  assert.match(savedGateSend.recipe, /send Main 4/, `the gate readout must name the destination (got "${savedGateSend.recipe}")`);

  // The gate's destination picker is the third self-send registration and it was untested: the step
  // and the trigger have one, and the reviewer verified the gate's behaves the same — this pins it.
  // It draws the same grouped list over the gate's own fields, disables the bus's own index with the
  // footnote-38 reason, and writes through the control the editor reads.
  await setSelect('condition-category', 'bus');
  await setSelect('condition-parameter', 'send_level');
  await type('condition-ids', '5');
  assert.equal(await evaluate(`Boolean(document.getElementById('condition-send-id-menu'))`), true,
    'the gate destination must carry its own grouped picker, like the step and the trigger');
  const gatePicker = await evaluate(`(() => {
    const inViewport = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
        && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
    };
    document.getElementById('condition-send-id-menu').click();
    const panel = document.getElementById('condition-send-id-menu-list');
    const rows = [...panel.querySelectorAll('.parameter-menu-row')];
    const own = rows.find((row) => row.dataset.menuValue === '5');
    const other = rows.find((row) => row.dataset.menuValue === '2');
    const before = document.getElementById('condition-send-id').value;
    const ownDisabled = Boolean(own?.disabled);
    const ownLabel = own?.textContent || '';
    // The list scrolls (16 destinations) and hangs below its button, so the panel is asserted inside
    // the window horizontally (the flip and the clamp are what this pins); the row the operator has
    // to read is brought into view the way the keyboard does it and asserted whole.
    const panelBox = panel.getBoundingClientRect();
    const panelInside = panelBox.width > 0 && panelBox.height > 0 && panelBox.left >= 0
      && panelBox.right <= window.innerWidth;
    const firstRowInside = rows.length > 0 && inViewport(rows[0]);
    own?.scrollIntoView({ block: 'nearest' });
    const ownInside = inViewport(own);
    own?.click();
    const afterOwn = document.getElementById('condition-send-id').value;
    other?.click();
    const config = readConfigFromUi();
    return {
      count: rows.length,
      ownDisabled,
      ownLabel,
      before,
      afterOwn,
      afterOther: document.getElementById('condition-send-id').value,
      panelInside,
      firstRowInside,
      ownInside,
      configSend: (config.conditions[selectedConditionIndex] || {}).sendId,
      configParameter: (config.conditions[selectedConditionIndex] || {}).targetParameter,
      closed: panel.hidden,
    };
  })()`);
  assert.equal(gatePicker.count, 17,
    `the gate destination list must offer the placeholder plus the 16 buses (got ${gatePicker.count})`);
  assert.equal(gatePicker.ownDisabled, true, "the gate's own bus index must be offered as unavailable");
  assert.match(gatePicker.ownLabel, /Bus 5 cannot send to itself/,
    `the gate's unavailable row must carry the footnote-38 reason (got "${gatePicker.ownLabel}")`);
  assert.equal(gatePicker.afterOwn, gatePicker.before, 'a disabled destination must not be selectable on the gate');
  assert.equal(gatePicker.afterOther, '2', 'the gate destination list must stay usable');
  assert.equal(gatePicker.closed, true, 'choosing a gate destination must close its menu');
  assert.equal(gatePicker.panelInside, true, "the gate destination panel must be inside the viewport");
  assert.equal(gatePicker.firstRowInside, true, 'its first destination must be on screen, not merely laid out');
  assert.equal(gatePicker.ownInside, true, "the gate's own destination row must be readable once scrolled to");
  assert.equal(gatePicker.configParameter, 'send_level', 'the gate must keep the watched send');
  assert.equal(gatePicker.configSend, 2,
    `the destination chosen in the gate's own menu must reach the gate record (got ${JSON.stringify(gatePicker)})`);
  // Back to the gate the following checks expect.
  await setSelect('condition-category', 'ch');
  await setSelect('condition-parameter', 'send_main_on');
  await type('condition-ids', '1');
  await type('condition-send-id', '4');

  // Reloading the macro puts both indices back where the operator left them.
  const restoredSendIds = await evaluate(`(() => {
    const config = readConfigFromUi();
    applyConfig(config, { keepDirty: true });
    return {
      trigger: document.getElementById('trigger-send-id').value,
      gate: document.getElementById('condition-send-id').value,
    };
  })()`);
  assert.equal(restoredSendIds.trigger, '8', 'reloading the macro must restore the trigger destination');
  assert.equal(restoredSendIds.gate, '4', 'reloading the macro must restore the gate destination');
  await setSelect('condition-parameter', 'meter');
  assert.equal(await evaluate(`document.getElementById('condition-send-id-field').classList.contains('hidden')`), true,
    'a gate with no destination must not show an index control');

  // ── fx_model is a closed list ────────────────────────────────────────────────────────────────
  await setSelect('target-category', 'fx');
  await setSelect('target-parameter', 'fx_model');
  const fxModel = await evaluate(`(() => {
    const select = document.getElementById('osc-value-options');
    const input = document.getElementById('osc-value');
    return {
      tag: select.tagName,
      selectShown: !select.classList.contains('hidden'),
      inputHidden: input.classList.contains('hidden'),
      options: [...select.options].map((option) => option.value),
      value: select.value,
      hint: document.getElementById('value-hint').textContent,
      refused: fieldProblem('osc-value-options', 'asdoijasod'),
    };
  })()`);
  assert.equal(fxModel.tag, 'SELECT', 'a model comes from a list, never from free text');
  assert.equal(fxModel.selectShown, true, 'the model list must be the control on screen');
  assert.equal(fxModel.inputHidden, true, 'the free-text field must be gone, so a typo cannot be typed');
  assert.ok(fxModel.options.includes('NONE'), 'NONE is one of the documented models');
  assert.ok(fxModel.options.includes('HALL'), 'HALL is one of the documented models');
  assert.equal(fxModel.value, 'NONE', 'a fresh FX model starts at NONE');
  assert.match(fxModel.hint, /1…8/, `the hint must say which slots load every model (got "${fxModel.hint}")`);
  assert.match(fxModel.hint, /9…16/, 'the hint must say which slots load the reduced list');
  assert.match(fxModel.hint, /Custom OSC/i, 'the hint must say how to reach a model parameter value');
  assert.match(fxModel.refused || '', /choose one of/i, 'a value outside the list must be refused with the list');

  await evaluate(`(() => {
    const select = document.getElementById('osc-value-options');
    select.value = 'HALL';
    select.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(120);
  assert.equal(await evaluate(`document.getElementById('osc-value').value`), 'HALL',
    'the chosen model must reach the value the editor reads');
  assert.match(await evaluate(`document.getElementById('value-hint').textContent`), /HALL/,
    'the readout must show the chosen model');

  // ── A matrix send survives the fields → step → fields round trip ──────────────────────────────
  await setSelect('target-category', 'ch');
  await setSelect('target-parameter', 'send_matrix_level');
  await type('target-ids', '2');
  await type('send-id', '3');
  await type('osc-value', '-20');
  const sendReadout = await evaluate(`(() => {
    const steps = readConfigFromUi().actionSteps;
    const step = steps[selectedStepIndex];
    return {
      label: step.label,
      stepLine: stepLabel(step, selectedStepIndex),
      recipe: document.getElementById('recipe-action').textContent,
    };
  })()`);
  assert.match(sendReadout.label, /send Matrix 3/,
    `the action readout must name the destination (got "${sendReadout.label}")`);
  assert.match(sendReadout.stepLine, /send Matrix 3/,
    `the step line must name the destination (got "${sendReadout.stepLine}")`);
  assert.match(sendReadout.recipe, /send Matrix 3/,
    `the recipe must name the destination (got "${sendReadout.recipe}")`);

  await evaluate(`document.getElementById('duplicate-step').click()`);
  await sleep(250);
  const sendRoundTrip = await evaluate(`(() => {
    const steps = readConfigFromUi().actionSteps;
    const step = steps[steps.length - 1];
    return {
      parameter: document.getElementById('target-parameter').value,
      ids: document.getElementById('target-ids').value,
      send: document.getElementById('send-id').value,
      value: document.getElementById('osc-value').value,
      stepParameter: step.targetParameter,
      stepIds: step.targetIds,
      stepSend: step.sendId,
      stepValue: step.actionValue,
    };
  })()`);
  assert.equal(sendRoundTrip.parameter, 'send_matrix_level', 'the fields must show the stored key again');
  assert.equal(sendRoundTrip.stepParameter, 'send_matrix_level', 'the step must keep the key');
  assert.equal(sendRoundTrip.ids, '2', 'the fields must show the stored channel list again');
  assert.equal(sendRoundTrip.stepIds, '2', 'the step must keep the channel list');
  assert.equal(sendRoundTrip.send, '3', 'the fields must show the stored send index again');
  assert.equal(sendRoundTrip.stepSend, 3, 'the step must keep the send index');
  assert.equal(sendRoundTrip.value, '-20', 'the fields must show the stored value again');
  assert.equal(sendRoundTrip.stepValue, '-20', 'the step must keep the value');

  // ── Test Action (Shoot) runs the same field rules ─────────────────────────────────────────────
  // Shoot used to skip every rule and the backend command validates nothing, so an out-of-range value
  // reached the console while "Save changes" would have refused it.
  await evaluate(`(() => {
    const category = document.getElementById('target-category');
    category.value = 'ch';
    category.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await type('target-ids', '999');
  assert.equal(await evaluate(`document.getElementById('target-ids').classList.contains('is-invalid')`), true,
    'the out-of-range channel list must be marked before shooting');
  await evaluate(`document.getElementById('send-osc').click()`);
  await sleep(250);
  assert.equal(await dialogVisible(), true, 'Shoot must refuse an invalid draft instead of sending it');
  const shootMessage = await dialogText();
  assert.match(shootMessage, /Cannot fire this action/i, `the dialog must say Shoot was refused (got "${shootMessage}")`);
  assert.match(shootMessage, /Target channels/i, 'the dialog must name the offending field');
  await closeDialogIfOpen();
  await type('target-ids', '1');

  // ── A legacy macro with no steps must not seed its step with the trigger's destination ────────
  //
  // `config.sendId` is the *trigger's* destination. The default step `applyConfig` synthesises for a
  // stored macro that has no `actionSteps` used to read it, so a send trigger (Matrix 8 here) would
  // have aimed the invented step at matrix 8 as well. The action's index is 1 unless a step says
  // otherwise.
  const legacySendTrigger = await evaluate(`(() => {
    applyConfig({
      name: 'Legacy send trigger',
      wingIp: '192.168.1.10',
      triggerCategory: 'ch',
      triggerIds: '1',
      triggerParameter: 'send_matrix_level',
      triggerOperator: '>',
      triggerEdgeMode: 'on',
      triggerThreshold: -20,
      sendId: 8,
      conditions: [],
      enabled: false,
      armed: false,
      actionSteps: [],
    }, { keepDirty: true });
    const step = actionSteps[0] || {};
    return {
      triggerField: document.getElementById('trigger-send-id').value,
      triggerLabel: document.getElementById('trigger-send-id-label').textContent,
      stepSend: step.sendId,
      stepCategory: step.targetCategory,
      stepParameter: step.targetParameter,
      action: currentActionText(readConfigFromUi()),
    };
  })()`);
  assert.equal(legacySendTrigger.triggerField, '8', 'the trigger destination must survive the load');
  assert.match(legacySendTrigger.triggerLabel, /Matrix/, 'the load must label the trigger destination');
  assert.equal(legacySendTrigger.stepSend, 1,
    'the synthesised legacy step must not borrow the trigger destination');
  assert.equal(legacySendTrigger.stepCategory, '', 'the synthesised step stays unconfigured');
  assert.equal(legacySendTrigger.stepParameter, '', 'the synthesised step has no parameter yet');
  assert.doesNotMatch(legacySendTrigger.action, /send /,
    `an unconfigured action must name no destination (got "${legacySendTrigger.action}")`);

  // A whole config carries the trigger's `sendId`; the action line must take its index from the step.
  const sendIdsSideBySide = await evaluate(`(() => {
    const config = {
      name: 'Send trigger and send step',
      wingIp: '192.168.1.10',
      triggerCategory: 'ch', triggerIds: '1', triggerParameter: 'send_matrix_level',
      triggerOperator: '>', triggerEdgeMode: 'on', triggerThreshold: -20, sendId: 8,
      conditions: [], enabled: false, armed: false,
      // The legacy flat copy of the selected step, in the same object as the trigger's sendId.
      targetCategory: 'ch', targetIds: '2', targetParameter: 'send_main_level',
      actionSteps: [{
        label: 'Set', actionAddress: '/ch/2/main/3/lvl', actionArgKind: 'float', actionValue: '-20',
        actionMode: 'set', targetCategory: 'ch', targetIds: '2', targetParameter: 'send_main_level',
        sendId: 3, enabled: true,
      }],
    };
    applyConfig(config, { keepDirty: true });
    return {
      action: currentActionText(config),
      trigger: currentTriggerText(config),
      recipeAction: document.getElementById('recipe-action').textContent,
      recipeTrigger: document.getElementById('recipe-trigger').textContent,
    };
  })()`);
  assert.match(sendIdsSideBySide.action, /send Main 3/,
    `the action line must name its own destination (got "${sendIdsSideBySide.action}")`);
  assert.doesNotMatch(sendIdsSideBySide.action, /Matrix/,
    'the action line must not borrow the trigger destination');
  assert.match(sendIdsSideBySide.trigger, /send Matrix 8/,
    `the trigger line must name its own destination (got "${sendIdsSideBySide.trigger}")`);
  assert.match(sendIdsSideBySide.recipeAction, /send Main 3/,
    `the recipe must name the action destination (got "${sendIdsSideBySide.recipeAction}")`);
  assert.match(sendIdsSideBySide.recipeTrigger, /send Matrix 8/,
    `the recipe must name the trigger destination (got "${sendIdsSideBySide.recipeTrigger}")`);

  // ── The model a model-scoped key was read from travels with the target ────────────────────────
  //
  // The backend refuses a `section:name` parameter whose name the strip's loaded model does not have
  // (`validate_macro_config`, which names the model and a few names it does have), and
  // `start_wing_usb_stream` takes the same optional `targetModel` for the draft an operator arms. The
  // editor's half is to say which model it read the key from — and nothing else: the refusal and its
  // wording stay in the backend, so nothing here asks the window to judge the model.
  //
  // The standalone page has no Tauri IPC, so the strip-model read is stubbed: `publishModelParameters`
  // is handed the very `models` array `read_strip_models` feeds it, for the strip the panels are on.
  // The target panel is put on ch/1 first, because that is the panel the read's option groups belong
  // to: a read of a strip no panel is on is filed for the panels that are on it and publishes nothing
  // to the target select (the window must never show one strip's models under another strip's target).
  // The trigger and the gate are catalogue lists without optgroups of their own, so the key the read
  // published is offered there too. Every assertion below reads the object `readConfigFromUi()`
  // returns — the same object the save and preflight paths are handed.
  await setSelect('target-category', 'ch');
  await type('target-ids', '1');
  const modelGroup = await evaluate(`(() => {
    targetCatalog.pluginModels = [
      { model: 'DEQ2', label: 'Graphic EQ', parameters: [
        { key: '1-thr', label: 'Threshold', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -60, maxValue: 10, step: 0.5 },
      ] },
      { model: 'GATE', label: 'Gate', parameters: [
        { key: 'thr', label: 'Threshold', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -80, maxValue: 0, step: 0.5 },
      ] },
      // A model the strip read of this session never publishes, for the stored-macro check below: its
      // table is in the catalogue, so a stored gate:2-thr written for it can still be described.
      { model: 'GEQ', label: 'Graphic EQ', parameters: [
        { key: '2-thr', label: 'Threshold', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -60, maxValue: 10, step: 0.5 },
      ] },
    ];
    targetCatalog.triggerParametersByCategory.ch = [
      ...targetCatalog.triggerParametersByCategory.ch,
      { key: 'gate:1-thr', label: 'Gate Threshold (1-thr)', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -60, maxValue: 10, canTrigger: true, operators: ['>', '<'] },
    ];
    // The plain catalogue key for the same leaf, with the two fields the backend publishes on the 49
    // keys of that kind: gate_thr resolves to /gate/thr, and modelSection/modelLeaf say which slot the
    // leaf lives in. The editor used to send a model only for the section:name spelling, so a macro on
    // this key was never checked against the model the strip's gate really runs. Offered in the target
    // list and in the trigger/gate list (both come from the catalogue).
    const slotRow = { key: 'gate_thr', label: 'Gate Threshold', argKind: 'float', valueKind: 'db', unit: 'dB', minValue: -60, maxValue: 10, canTrigger: true, operators: ['>', '<'], modelSection: 'gate', modelLeaf: 'thr' };
    targetCatalog.targetParametersByCategory.ch = [...targetCatalog.targetParametersByCategory.ch, { ...slotRow }];
    targetCatalog.triggerParametersByCategory.ch = [...targetCatalog.triggerParametersByCategory.ch, { ...slotRow }];
    // What the strip-model read answers for /ch/1/gate/mdl.
    publishModelParameters([{ address: '/ch/1/gate/mdl', family: 'ch', id: 1, section: 'gate', model: 'DEQ2', error: null, elapsedMillis: 1 }]);
    return {
      groups: [...document.querySelectorAll('#target-parameter optgroup[data-strip-model]')].map((group) => group.dataset.stripModel),
      offered: [...document.getElementById('target-parameter').options].some((option) => option.value === 'gate:1-thr'),
      slotOffered: [...document.getElementById('target-parameter').options].some((option) => option.value === 'gate_thr'),
    };
  })()`);
  assert.ok(modelGroup.groups.includes('gate:DEQ2'),
    `the strip model must be published as an optgroup (got ${JSON.stringify(modelGroup.groups)})`);
  assert.equal(modelGroup.offered, true, 'the model parameter must be offered inside that group');
  assert.equal(modelGroup.slotOffered, true, 'the plain catalogue key of the same leaf must be offered too');

  // A step: the key chosen from the group writes the model the group names.
  await setSelect('target-category', 'ch');
  await setSelect('target-parameter', 'gate:1-thr');
  const scopedStep = await evaluate(`(() => {
    const step = readConfigFromUi().actionSteps[selectedStepIndex] || {};
    return { parameter: step.targetParameter, model: step.targetModel };
  })()`);
  assert.equal(scopedStep.parameter, 'gate:1-thr', 'the step must keep the key chosen from the model group');
  assert.equal(scopedStep.model, 'DEQ2', `the step must carry the model its key was read from (got ${JSON.stringify(scopedStep)})`);

  // The trigger and the gate: the select must not be the target one here, so their model can only
  // come from the group the strip-model read published for that key.
  await setSelect('target-parameter', 'mute');
  await setSelect('trigger-category', 'ch');
  await setSelect('trigger-parameter', 'gate:1-thr');
  await evaluate(`document.getElementById('add-condition').click()`);
  await sleep(250);
  await setSelect('condition-category', 'ch');
  await setSelect('condition-parameter', 'gate:1-thr');
  const scopedRecords = await evaluate(`(() => {
    const config = readConfigFromUi();
    const gate = config.conditions[config.conditions.length - 1] || {};
    return {
      targetSelect: document.getElementById('target-parameter').value,
      triggerParameter: config.triggerParameter,
      triggerModel: config.targetModel,
      gateParameter: gate.targetParameter,
      gateModel: gate.targetModel,
    };
  })()`);
  assert.equal(scopedRecords.targetSelect, 'mute',
    'the target select must not be on the model key, or it would answer for the other two');
  assert.equal(scopedRecords.triggerParameter, 'gate:1-thr', 'the trigger must keep the model-scoped key');
  assert.equal(scopedRecords.triggerModel, 'DEQ2',
    `the trigger must carry the model its key was read from (got ${JSON.stringify(scopedRecords)})`);
  assert.equal(scopedRecords.gateParameter, 'gate:1-thr', 'the gate must keep the model-scoped key');
  assert.equal(scopedRecords.gateModel, 'DEQ2',
    `the gate must carry the model its key was read from (got ${JSON.stringify(scopedRecords)})`);

  // A key that is not model-scoped carries no model at all: the backend reads an absent model as
  // "not known", so an invented one would be worse than none.
  await setSelect('trigger-parameter', 'meter');
  await setSelect('condition-parameter', 'meter');
  const unscopedModels = await evaluate(`(() => {
    const config = readConfigFromUi();
    const step = config.actionSteps[selectedStepIndex] || {};
    const gate = config.conditions[config.conditions.length - 1] || {};
    return {
      step: step.targetModel, stepParameter: step.targetParameter,
      trigger: config.targetModel, triggerParameter: config.triggerParameter,
      gate: gate.targetModel, gateParameter: gate.targetParameter,
    };
  })()`);
  assert.equal(unscopedModels.stepParameter, 'mute', 'the step must be on a key of the catalogue');
  assert.ok(!unscopedModels.step, `a key that is not model-scoped must carry no model (got ${JSON.stringify(unscopedModels.step)})`);
  assert.equal(unscopedModels.triggerParameter, 'meter', 'the trigger must be on a meter');
  assert.ok(!unscopedModels.trigger, `a meter trigger must carry no model (got ${JSON.stringify(unscopedModels.trigger)})`);
  assert.equal(unscopedModels.gateParameter, 'meter', 'the gate must be on a meter');
  assert.ok(!unscopedModels.gate, `a meter gate must carry no model (got ${JSON.stringify(unscopedModels.gate)})`);

  // ── The plain catalogue keys carry the model of the slot their row names ───────────────────────
  //
  // `gate_thr` (Gate Threshold) is not the name of a model but a leaf inside one: the backend checks it
  // through the catalogue mapping, against the model the strip's gate slot runs. The editor could only
  // name a model for the `section:name` spelling, so this key travelled with nothing and the check
  // could never fire. The model now comes from the slot the strip-model read published for that
  // section — the same `publishModelParameters` call, no second read — on the step, on the trigger and
  // on the IF gate. The stub is untouched since the block above: the gate still reads DEQ2.
  await setSelect('target-category', 'ch');
  await setSelect('target-parameter', 'gate_thr');
  await setSelect('trigger-category', 'ch');
  await setSelect('trigger-parameter', 'gate_thr');
  await evaluate(`document.getElementById('add-condition').click()`);
  await sleep(250);
  await setSelect('condition-category', 'ch');
  await setSelect('condition-parameter', 'gate_thr');
  const slotRecords = await evaluate(`(() => {
    const config = readConfigFromUi();
    const step = config.actionSteps[selectedStepIndex] || {};
    const gate = config.conditions[config.conditions.length - 1] || {};
    return {
      stepParameter: step.targetParameter, stepModel: step.targetModel,
      triggerParameter: config.triggerParameter, triggerModel: config.targetModel,
      gateParameter: gate.targetParameter, gateModel: gate.targetModel,
    };
  })()`);
  assert.equal(slotRecords.stepParameter, 'gate_thr', 'the step must keep the plain catalogue key');
  assert.equal(slotRecords.stepModel, 'DEQ2',
    `the step must carry the model the slot the key belongs to runs (got ${JSON.stringify(slotRecords)})`);
  assert.equal(slotRecords.triggerParameter, 'gate_thr', 'the trigger must keep the plain catalogue key');
  assert.equal(slotRecords.triggerModel, 'DEQ2',
    `the trigger must carry the model of the key's slot (got ${JSON.stringify(slotRecords.triggerModel)})`);
  assert.equal(slotRecords.gateParameter, 'gate_thr', 'the gate must keep the plain catalogue key');
  assert.equal(slotRecords.gateModel, 'DEQ2',
    `the gate must carry the model of the key's slot (got ${JSON.stringify(slotRecords.gateModel)})`);

  // A step whose row names no slot carries nothing, exactly as before: the model of the gate slot must
  // not leak into a key that lives outside gate/dyn/eq.
  await setSelect('target-parameter', 'fader');
  const slotlessStep = await evaluate(`(() => {
    const step = readConfigFromUi().actionSteps[selectedStepIndex] || {};
    return { parameter: step.targetParameter, model: step.targetModel };
  })()`);
  assert.equal(slotlessStep.parameter, 'fader', 'the step must be on a key of the catalogue');
  assert.ok(!slotlessStep.model,
    `a key whose row carries no modelSection must carry no model (got ${JSON.stringify(slotlessStep.model)})`);

  // The `section:name` spelling keeps the behaviour it has under this very stub.
  await setSelect('trigger-parameter', 'gate:1-thr');
  const scopedUnchanged = await evaluate(`(() => {
    const config = readConfigFromUi();
    return { parameter: config.triggerParameter, model: config.targetModel };
  })()`);
  assert.equal(scopedUnchanged.parameter, 'gate:1-thr', 'the trigger must keep the model-scoped key');
  assert.equal(scopedUnchanged.model, 'DEQ2',
    `gate:1-thr must keep carrying the model it carried before (got ${JSON.stringify(scopedUnchanged)})`);
  await setSelect('target-parameter', 'mute');

  // ── A stored plain key keeps the model it was written for, but never reports it as the strip's ──
  //
  // The same DEQ2 read, a macro written for GEQ: DEQ2 has `1-thr` and no `thr`, which is the very case
  // the model field exists for. The model that travels must be the strip's DEQ2 — the backend then
  // refuses the macro with the message that names DEQ2 and the names it does have — while the stored
  // record keeps the model it was written for: nothing is rewritten or cleared, and the key stays
  // selected. The window does not judge the pair here; the refusal and its wording stay in the backend.
  // The mirror case follows: a read that covered another slot only (dyn) leaves the record's own GEQ as
  // the only model the window has, so that is what travels.
  const storedSlotKey = await evaluate(`(() => {
    const stored = {
      name: 'Written for a GEQ on the plain key',
      wingIp: '192.168.1.10',
      triggerCategory: 'ch', triggerIds: '1', triggerParameter: 'gate_thr', targetModel: 'GEQ',
      triggerOperator: '>', triggerEdgeMode: 'on', triggerThreshold: -20, logicalOperator: 'AND',
      conditions: [{ label: 'Gate', targetCategory: 'ch', targetIds: '1', targetParameter: 'gate_thr', targetModel: 'GEQ', operator: '>', value: '-20', sendId: 1, enabled: true }],
      enabled: false, armed: false,
      actionSteps: [{ label: 'Gate threshold', actionAddress: '/ch/1/gate/thr', actionArgKind: 'float', actionValue: '-20', actionMode: 'set', targetCategory: 'ch', targetIds: '1', targetParameter: 'gate_thr', targetModel: 'GEQ', sendId: 1, enabled: true }],
    };
    applyConfig(stored, { keepDirty: true });
    const option = document.getElementById('target-parameter').selectedOptions[0];
    const stripRead = readConfigFromUi();
    // A read that answered for the dyn slot only: nothing was published for gate, so the record's own
    // model is the only witness left and it travels as stored.
    publishModelParameters([{ address: '/ch/1/dyn/mdl', family: 'ch', id: 1, section: 'dyn', model: 'WARM', error: null, elapsedMillis: 1 }]);
    applyConfig(stored, { keepDirty: true });
    const slotMissing = readConfigFromUi();
    const step = stripRead.actionSteps[0] || {};
    const gate = stripRead.conditions[0] || {};
    const missingStep = slotMissing.actionSteps[0] || {};
    return {
      select: document.getElementById('target-parameter').value,
      optionText: option ? option.textContent : '',
      stepParameter: step.targetParameter, stepModel: step.targetModel,
      triggerParameter: stripRead.triggerParameter, triggerModel: stripRead.targetModel,
      gateParameter: gate.targetParameter, gateModel: gate.targetModel,
      missingParameter: missingStep.targetParameter, missingModel: missingStep.targetModel,
      missingTriggerModel: slotMissing.targetModel,
      storedStepModel: stored.actionSteps[0].targetModel,
      storedTriggerModel: stored.targetModel,
      storedGateModel: stored.conditions[0].targetModel,
    };
  })()`);
  assert.equal(storedSlotKey.select, 'gate_thr', 'the stored catalogue key must stay selected');
  // A plain catalogue key is labelled by its own catalogue row, so the option text carries no model of
  // its own: the model-in-the-label rule covers the `section:name` keys (the check below still pins
  // "GEQ · 2-thr — Threshold"), and what the record itself holds is asserted just below.
  assert.equal(storedSlotKey.optionText, 'Gate Threshold',
    `the option keeps the catalogue label of the key (got "${storedSlotKey.optionText}")`);
  assert.equal(storedSlotKey.stepParameter, 'gate_thr', 'the step must keep the stored key');
  assert.equal(storedSlotKey.stepModel, 'DEQ2',
    `the step must report the model the strip runs in that slot, so the backend can refuse it by name (got ${JSON.stringify(storedSlotKey.stepModel)})`);
  assert.equal(storedSlotKey.triggerParameter, 'gate_thr', 'the trigger must keep the stored key');
  assert.equal(storedSlotKey.triggerModel, 'DEQ2', 'the trigger must report the strip\'s model');
  assert.equal(storedSlotKey.gateParameter, 'gate_thr', 'the gate must keep the stored key');
  assert.equal(storedSlotKey.gateModel, 'DEQ2', 'the gate must report the strip\'s model');
  assert.equal(storedSlotKey.missingParameter, 'gate_thr', 'the key must survive a read that covered no slot of it');
  assert.equal(storedSlotKey.missingModel, 'GEQ',
    `with nothing published for that slot the record's own model must travel (got ${JSON.stringify(storedSlotKey.missingModel)})`);
  assert.equal(storedSlotKey.missingTriggerModel, 'GEQ', 'the trigger keeps the stored model too');

  // ── The library keeps the model the macro was written for ─────────────────────────────────────
  //
  // Save is the other half of the rule the block above pins: the wire carries the model the strip
  // runs, but the record the library keeps must stay the model the macro was *written for*. The save
  // path used to copy `readConfigFromUi()`'s model straight into the library entry, so a GEQ macro on
  // `gate_thr` became a DEQ2 macro the moment the strip was read — the macro the operator can see
  // silently changed under them. The three assertions that used to claim this ("the stored macro
  // itself must not be rewritten") read the literal object the test itself passed to `applyConfig`,
  // which nothing could have changed: they could not fail.
  //
  // This page has no Tauri IPC, and its standalone mock has no `resolve_basic_target`, so a save with
  // a configured target aborts in the address resolve and never reaches `save_macro_library` (the
  // end-to-end save is driven, with its own IPC stub, by check 12e of
  // `test-desktop-action-target-browser.mjs`). What is asserted here is the record the save path
  // builds — `libraryConfigForSave` is the very function `upsertCurrentDraftIntoLibrary` hands to the
  // library — read against the wire config the same call produced.
  const writtenModel = await evaluate(`(() => {
    publishModelParameters([{ address: '/ch/1/gate/mdl', family: 'ch', id: 1, section: 'gate', model: 'DEQ2', error: null, elapsedMillis: 1 }]);
    const stored = {
      name: 'Written for a GEQ',
      wingIp: '192.168.1.10',
      triggerCategory: 'ch', triggerIds: '1', triggerParameter: 'gate_thr', targetModel: 'GEQ',
      triggerOperator: '>', triggerEdgeMode: 'on', triggerThreshold: -20, logicalOperator: 'AND',
      conditions: [{ label: 'Gate', targetCategory: 'ch', targetIds: '1', targetParameter: 'gate_thr', targetModel: 'GEQ', operator: '>', value: '-20', sendId: 1, enabled: true }],
      enabled: false, armed: false,
      actionSteps: [{ label: 'Gate threshold', actionAddress: '/ch/1/gate/thr', actionArgKind: 'float', actionValue: '-20', actionMode: 'set', targetCategory: 'ch', targetIds: '1', targetParameter: 'gate_thr', targetModel: 'GEQ', sendId: 1, enabled: true }],
    };
    applyConfig(stored, { keepDirty: true });
    // The wire config the save is handed: the model the strip was read as running.
    const wire = disarmedConfig(readConfigFromUi());
    // The library record: the same draft, reconciled with the record it replaces.
    const kept = libraryConfigForSave(wire, stored);
    // A target whose key really changed adopts the model the editor read for the new name.
    const retargeted = libraryConfigForSave(
      { ...wire, triggerParameter: 'gate:1-thr', targetModel: 'DEQ2' },
      { ...stored, triggerParameter: 'mute', targetModel: '' },
    );
    return {
      wireStep: (wire.actionSteps[0] || {}).targetModel,
      wireTrigger: wire.targetModel,
      wireTriggerParameter: wire.triggerParameter,
      wireGate: (wire.conditions[0] || {}).targetModel,
      savedStep: (kept.actionSteps[0] || {}).targetModel,
      savedTrigger: kept.targetModel,
      savedGate: (kept.conditions[0] || {}).targetModel,
      retargetedTrigger: retargeted.targetModel,
      // The editor's own record after the read, which is what the save path reconciles with: it must
      // still say the model the macro was written for. (The literal handed to applyConfig is not
      // asserted on anywhere — nothing in the window can change it.)
      liveStepModel: (actionSteps[0] || {}).targetModel,
      liveTriggerModel: loadedTriggerTarget.targetModel,
      liveGateModel: (conditions[0] || {}).targetModel,
    };
  })()`);
  assert.equal(writtenModel.wireStep, 'DEQ2',
    `the wire must carry the model the strip runs (got ${JSON.stringify(writtenModel)})`);
  assert.equal(writtenModel.wireTrigger, 'DEQ2', 'the trigger on the wire carries the strip\'s model too');
  assert.equal(writtenModel.wireGate, 'DEQ2', 'the gate on the wire carries the strip\'s model too');
  assert.equal(writtenModel.savedStep, 'GEQ',
    `the library must keep the model the step was written for (got ${JSON.stringify(writtenModel.savedStep)})`);
  assert.equal(writtenModel.savedTrigger, 'GEQ',
    `the library must keep the model the trigger was written for (got ${JSON.stringify(writtenModel.savedTrigger)})`);
  assert.equal(writtenModel.savedGate, 'GEQ',
    `the library must keep the model the gate was written for (got ${JSON.stringify(writtenModel.savedGate)})`);
  assert.equal(writtenModel.retargetedTrigger, 'DEQ2',
    'a target pointed at another name must adopt the model the editor read for it');
  assert.equal(writtenModel.liveStepModel, 'GEQ', 'the step record must keep the written model through the read');
  assert.equal(writtenModel.liveTriggerModel, 'GEQ', 'the trigger record must keep it too');
  assert.equal(writtenModel.liveGateModel, 'GEQ', 'and so must the gate record');

  // ── A stored macro keeps the model it was written for ─────────────────────────────────────────
  //
  // The strip now runs GATE, and this macro was written for a GEQ whose `2-thr` no read in this
  // session publishes: nothing the window read can explain the key, so the only witness of the model
  // is the stored record itself. The key must stay selected, with the model it was written for named
  // on the option ("GEQ · 2-thr — Threshold") and carried in the config the save path is handed.
  // Clearing the model would turn the macro the operator can see — the one the backend refuses,
  // naming GEQ — into a different one.
  const storedKeyModel = await evaluate(`(() => {
    publishModelParameters([{ address: '/ch/1/gate/mdl', family: 'ch', id: 1, section: 'gate', model: 'GATE', error: null, elapsedMillis: 1 }]);
    const stored = {
      name: 'Written for a GEQ',
      wingIp: '192.168.1.10',
      triggerCategory: 'ch', triggerIds: '1', triggerParameter: 'gate:2-thr', targetModel: 'GEQ',
      triggerOperator: '>', triggerEdgeMode: 'on', triggerThreshold: -20, logicalOperator: 'AND',
      conditions: [{ label: 'Gate', targetCategory: 'ch', targetIds: '1', targetParameter: 'gate:2-thr', targetModel: 'GEQ', operator: '>', value: '-20', sendId: 1, enabled: true }],
      enabled: false, armed: false,
      actionSteps: [{ label: 'Gate threshold', actionAddress: '/ch/1/gate/2-thr', actionArgKind: 'float', actionValue: '-20', actionMode: 'set', targetCategory: 'ch', targetIds: '1', targetParameter: 'gate:2-thr', targetModel: 'GEQ', sendId: 1, enabled: true }],
    };
    applyConfig(stored, { keepDirty: true });
    const option = document.getElementById('target-parameter').selectedOptions[0];
    const config = readConfigFromUi();
    const step = config.actionSteps[0] || {};
    const gate = config.conditions[0] || {};
    return {
      groups: [...document.querySelectorAll('#target-parameter optgroup[data-strip-model]')].map((group) => group.dataset.stripModel),
      select: document.getElementById('target-parameter').value,
      optionText: option ? option.textContent : '',
      optionInGroup: Boolean(option?.parentElement?.dataset?.stripModel),
      stepParameter: step.targetParameter, stepModel: step.targetModel,
      triggerParameter: config.triggerParameter, triggerModel: config.targetModel,
      gateParameter: gate.targetParameter, gateModel: gate.targetModel,
      // The editor's own records, not the literal passed to applyConfig: these are what the option
      // label and the save path read, so a read (or a save) that overwrote them would show here.
      liveStepModel: (actionSteps[0] || {}).targetModel,
      liveTriggerModel: loadedTriggerTarget.targetModel,
      liveGateModel: (conditions[0] || {}).targetModel,
    };
  })()`);
  assert.ok(!storedKeyModel.groups.includes('gate:GEQ'),
    `the strip must be read as running GATE for this check (got ${JSON.stringify(storedKeyModel.groups)})`);
  assert.equal(storedKeyModel.select, 'gate:2-thr',
    'a stored key the model the strip reports does not have must stay selected');
  assert.equal(storedKeyModel.optionInGroup, false,
    'the kept key must be the explicit option, not one the strip-model read explains');
  assert.equal(storedKeyModel.optionText, 'GEQ · 2-thr — Threshold',
    `the kept option must name the model the macro was written for, the stored key and the parameter (got "${storedKeyModel.optionText}")`);
  assert.equal(storedKeyModel.stepParameter, 'gate:2-thr', 'the step must keep the stored key');
  assert.equal(storedKeyModel.stepModel, 'GEQ', `the step must keep the stored model (got ${JSON.stringify(storedKeyModel)})`);
  assert.equal(storedKeyModel.triggerParameter, 'gate:2-thr', 'the trigger must keep the stored key');
  assert.equal(storedKeyModel.triggerModel, 'GEQ', 'the trigger must keep the stored model');
  assert.equal(storedKeyModel.gateParameter, 'gate:2-thr', 'the gate must keep the stored key');
  assert.equal(storedKeyModel.gateModel, 'GEQ', 'the gate must keep the stored model');
  // The three records the editor holds, which the label and the save path read: a key the strip's read
  // cannot explain keeps the model the macro was written for. (The literal object handed to
  // `applyConfig` is asserted on nowhere: nothing in the window can change it.)
  assert.equal(storedKeyModel.liveStepModel, 'GEQ', 'the step record must keep the written model');
  assert.equal(storedKeyModel.liveTriggerModel, 'GEQ', 'the trigger record must keep the written model');
  assert.equal(storedKeyModel.liveGateModel, 'GEQ', 'the gate record must keep the written model');

  // ── Show control: the writable pair and the read-only set are two categories ──────────────────
  //
  // Maillot `/$ctl/lib` (4105-4126) is how a macro recalls a scene, and the ordinary recipe is "set
  // the number, then GO". What can be written (`scene_index`, `scene_action`) and what can only be
  // watched (the five `$actidx`, `$active`, `$activeid`, `$actshow` and `$scenes` keys) cannot share
  // one category: `can_trigger`/`can_target` live on the category, so one list would either write a
  // read-only leaf or watch a write. These assertions run against the fallback catalogue — this page
  // opens without an IPC stub, so what they drive IS the standalone window — and they hold it to the
  // same keys, kinds, ranges, options and split the backend catalogue publishes.
  const showCatalogue = await evaluate(`(() => {
    const options = (id) => {
      const select = document.getElementById(id);
      return select
        ? [...select.querySelectorAll('option')]
          .filter((option) => option.value)
          .map((option) => ({
            key: option.value,
            label: option.textContent,
            group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
          }))
        : [];
    };
    return {
      target: options('target-category'),
      trigger: options('trigger-category'),
      condition: options('condition-category'),
      categories: targetCatalog.categories
        .filter((category) => category.key === 'show' || category.key === 'showstate')
        .map((category) => ({
          key: category.key, label: category.label, group: category.group, count: category.count,
          canTrigger: category.canTrigger, canTarget: category.canTarget,
        })),
    };
  })()`);
  assert.deepEqual(showCatalogue.categories, [
    { key: 'show', label: 'Show Control', group: 'Control', count: 1, canTrigger: false, canTarget: true },
    { key: 'showstate', label: 'Show State', group: 'Control', count: 1, canTrigger: true, canTarget: false },
  ], `show control must be two categories over the same node: the writable pair cannot be watched and the read-only set cannot be written (got ${JSON.stringify(showCatalogue.categories)})`);
  const targetCategoryKeys = showCatalogue.target.map((entry) => entry.key);
  const triggerCategoryKeys = showCatalogue.trigger.map((entry) => entry.key);
  const conditionCategoryKeys = showCatalogue.condition.map((entry) => entry.key);
  assert.ok(targetCategoryKeys.includes('show'),
    `Show Control must be offered as a step destination (got ${JSON.stringify(targetCategoryKeys)})`);
  assert.ok(!targetCategoryKeys.includes('showstate'),
    'Show State must never be offered as a step destination: every one of its keys is read-only');
  assert.ok(triggerCategoryKeys.includes('showstate'),
    `Show State must be offered as a trigger (got ${JSON.stringify(triggerCategoryKeys)})`);
  assert.ok(!triggerCategoryKeys.includes('show'),
    'Show Control must never be offered as a trigger: its keys are writes, not state to watch');
  assert.ok(conditionCategoryKeys.includes('showstate'),
    `Show State must be offered as an IF gate (got ${JSON.stringify(conditionCategoryKeys)})`);
  assert.ok(!conditionCategoryKeys.includes('show'),
    'Show Control must never be offered as an IF gate for the same reason');
  assert.equal(showCatalogue.target.find((entry) => entry.key === 'show').label, 'Show Control (1)',
    'the step destination list must label the category "Show Control"');
  assert.equal(showCatalogue.trigger.find((entry) => entry.key === 'showstate').label, 'Show State (1)',
    'the trigger list must label the category "Show State"');
  assert.equal(showCatalogue.target.find((entry) => entry.key === 'show').group, 'Control',
    'the new category must land in a named group of the category list, not an unlabelled one');

  // The keys themselves, on the side each belongs to. The select also holds the "— Not configured —"
  // entry and, when an earlier check left one behind, a `<section>:<name>` key of the strip-model read
  // (those are re-added to every destination); what this pins is the category's own plain keys.
  await setSelect('target-category', 'show');
  const showTargetKeys = await evaluate(`(() => {
    const select = document.getElementById('target-parameter');
    const all = [...select.options].map((option) => option.value);
    return {
      plain: all.filter((key) => key && !key.includes(':')),
      labels: [...select.options]
        .filter((option) => option.value && !option.value.includes(':'))
        .map((option) => option.textContent),
    };
  })()`);
  assert.deepEqual(showTargetKeys.plain, ['scene_index', 'scene_action'],
    `Show Control must offer exactly the two writable keys (got ${JSON.stringify(showTargetKeys.plain)})`);
  assert.deepEqual(showTargetKeys.labels, ['Scene Number', 'Scene Action'],
    `the writable pair must carry the frozen labels (got ${JSON.stringify(showTargetKeys.labels)})`);

  await setSelect('trigger-category', 'showstate');
  const showstateTriggerKeys = await evaluate(`(() => {
    const select = document.getElementById('trigger-parameter');
    const all = [...select.options].map((option) => option.value);
    return {
      plain: all.filter((key) => key && !key.includes(':')),
      labels: [...select.options]
        .filter((option) => option.value && !option.value.includes(':'))
        .map((option) => option.textContent),
    };
  })()`);
  assert.deepEqual(showstateTriggerKeys.plain,
    ['scene_active_index', 'scene_active_name', 'scene_active_tag', 'scene_show_name', 'scene_list'],
    `Show State must offer exactly the five read-only keys (got ${JSON.stringify(showstateTriggerKeys.plain)})`);
  assert.deepEqual(showstateTriggerKeys.labels,
    ['Active Scene Number', 'Active Scene', 'Active Scene Tag', 'Active Show', 'Scene List'],
    `the read-only set must carry the frozen labels (got ${JSON.stringify(showstateTriggerKeys.labels)})`);

  // The picker's own grouping: a `scene_*` key belongs under "Show", not buried in "Other".
  const showMenu = await evaluate(`(() => {
    const panel = document.getElementById('target-parameter-menu-list');
    // A picker left open by an earlier check would swallow the first click below: put the control in
    // a known state, then open it, read it and close it again.
    if (!panel.hidden) document.getElementById('target-parameter-menu').click();
    document.getElementById('target-parameter-menu').click();
    const group = panel.querySelector('[data-menu-group="show"]');
    const rows = group
      ? [...group.querySelectorAll('.parameter-menu-row[data-parameter]')].map((row) => row.dataset.parameter)
      : [];
    const label = group?.querySelector('.parameter-menu-row.is-group .parameter-menu-label')?.textContent || '';
    document.getElementById('target-parameter-menu').click();
    return { label, rows, open: !panel.hidden };
  })()`);
  assert.equal(showMenu.open, false, 'the grouped picker must be left closed for the checks that follow');
  assert.equal(showMenu.label, 'Show',
    `the grouped picker must file the show keys under a "Show" group (got "${showMenu.label}")`);
  assert.deepEqual(showMenu.rows, ['scene_index', 'scene_action'],
    `the Show group must carry the writable pair (got ${JSON.stringify(showMenu.rows)})`);

  // `scene_index` is a whole number in 0…16384, so it gets the number field with that range.
  await setSelect('target-parameter', 'scene_index');
  const sceneIndexControl = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    const field = document.getElementById('osc-value');
    return {
      number: visible('osc-value') && field.type === 'number',
      options: visible('osc-value-options'),
      min: field.min,
      max: field.max,
      hint: document.getElementById('value-hint').textContent,
    };
  })()`);
  assert.equal(sceneIndexControl.number, true,
    'Scene Number is a number, so the step value must be the number field');
  assert.equal(sceneIndexControl.options, false,
    'Scene Number is not a closed list, so the list select must stay hidden');
  assert.equal(sceneIndexControl.min, '0', 'Scene Number starts at 0');
  assert.equal(sceneIndexControl.max, '16384',
    'Scene Number must carry the documented maximum (Maillot 4116: 0..16384)');
  assert.match(sceneIndexControl.hint, /show must be open/i,
    `the scene number hint must say a show has to be open (got "${sceneIndexControl.hint}")`);
  assert.match(sceneIndexControl.hint, /\$actionidx should be 0/i,
    `the hint must carry footnote 79: $actionidx is 0 for NEXT or PREV with GO (got "${sceneIndexControl.hint}")`);
  await type('osc-value', '16385');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), true,
    'a scene number above 16384 must be refused where it is typed');
  assert.match(await evaluate(`document.getElementById('osc-value-problem')?.textContent || ''`), /16384/,
    'the refusal must name the documented maximum');
  await type('osc-value', '16384');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), false,
    '16384 is the last scene number the console documents and must be accepted');

  // `scene_action` is a choice: the closed list, and only the seven documented actions.
  await setSelect('target-parameter', 'scene_action');
  const sceneActionControl = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    const options = document.getElementById('osc-value-options');
    return {
      options: visible('osc-value-options'),
      number: visible('osc-value'),
      values: [...options.options].map((option) => option.value),
      hint: document.getElementById('value-hint').textContent,
    };
  })()`);
  assert.deepEqual(sceneActionControl.values,
    ['IDLE', 'GOPREV', 'GONEXT', 'GO', 'PREV', 'NEXT', 'GOTAG'],
    `Scene Action must be a closed list with exactly the seven documented actions (got ${JSON.stringify(sceneActionControl.values)})`);
  assert.equal(sceneActionControl.options, true, 'a closed list must be offered as the list select');
  assert.equal(sceneActionControl.number, false, 'a closed list has no free number to type');
  assert.match(sceneActionControl.hint, /GOTAG treats \$actionidx as the tag number/i,
    `the action hint must say what GOTAG does with $actionidx (got "${sceneActionControl.hint}")`);
  assert.match(sceneActionControl.hint, /show has been opened/i,
    `the action hint must say a show has to be open (got "${sceneActionControl.hint}")`);

  // A read-only key is watched: text where text belongs, a bounded number where a number belongs.
  await setSelect('trigger-parameter', 'scene_active_name');
  const sceneNameTrigger = await triggerControls();
  assert.deepEqual(sceneNameTrigger.operators, ['==', '!='],
    `an active scene name is text: it is compared, never ordered (got ${JSON.stringify(sceneNameTrigger.operators)})`);
  assert.equal(sceneNameTrigger.text, true, 'an active scene name must use the text field');
  assert.equal(sceneNameTrigger.number, false, 'an active scene name is not a dB threshold');
  assert.equal(await evaluate(`document.getElementById('trigger-value').maxLength`), 256,
    'Maillot 4109 caps the active scene name at 256 characters, so the field must say so');

  await setSelect('trigger-parameter', 'scene_active_index');
  const activeIndexTrigger = await evaluate(`(() => {
    const field = document.getElementById('threshold');
    return {
      number: !field.classList.contains('hidden') && field.getClientRects().length > 0,
      min: field.min,
      max: field.max,
    };
  })()`);
  assert.equal(activeIndexTrigger.number, true,
    'Active Scene Number is a number the trigger compares, so it needs the numeric field');
  assert.equal(activeIndexTrigger.min, '0', 'the active scene number starts at 0');
  assert.equal(activeIndexTrigger.max, '16384', 'the active scene number is bounded at 16384');
  await type('threshold', '16385');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('threshold').classList.contains('is-invalid')`), true,
    'the same 16384 bound must hold when the active scene number is watched');
  await type('threshold', '12');

  // ── An index-less trigger still carries an id ──────────────────────────────────────────────────
  //
  // `/$ctl/lib/$actidx` has no id segment, so the resolver ignores the list — but the backend's
  // completeness rule (`macro_incomplete_reason`) refuses an empty `trigger_ids` *before* the resolver
  // ever runs, so a trigger on Show State must carry a number or the macro can never be enabled. The
  // window seeds the field's own default when such a category is picked, both when the field was left
  // untouched and when it had been cleared first. Action steps have no such rule, so nothing there is
  // rewritten.
  const indexLessTriggerIds = await evaluate(`(() => {
    const category = document.getElementById('trigger-category');
    const ids = document.getElementById('trigger-ids');
    const parameter = document.getElementById('trigger-parameter');
    const read = () => {
      category.value = 'showstate';
      category.dispatchEvent(new Event('change', { bubbles: true }));
      parameter.value = 'scene_active_name';
      parameter.dispatchEvent(new Event('change', { bubbles: true }));
      const config = readConfigFromUi();
      return {
        field: ids.value,
        wire: config.triggerIds,
        recipe: currentTriggerText(config),
        reason: macroIncompleteReason(config),
      };
    };
    // Untouched: the field still carries the window's own default.
    ids.value = '1';
    ids.dispatchEvent(new Event('input', { bubbles: true }));
    const untouched = read();
    // Cleared first and the category picked afterwards: the real trap, because a blank list used to
    // travel as-is and the window then refused its own macro as incomplete.
    category.value = '';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    ids.value = '';
    ids.dispatchEvent(new Event('input', { bubbles: true }));
    const cleared = read();
    return { untouched, cleared };
  })()`);
  for (const [where, seen] of [['untouched', indexLessTriggerIds.untouched], ['cleared', indexLessTriggerIds.cleared]]) {
    assert.equal(seen.field, '1',
      `an ${where} Show State trigger must be left holding an id (got ${JSON.stringify(seen)})`);
    assert.equal(seen.wire, '1',
      `${where}: the draft must carry a non-empty trigger id, or the backend refuses the macro before the resolver ignores the list`);
    assert.doesNotMatch(seen.recipe, /not configured/i,
      `${where}: the readout must not call a Show State trigger unconfigured (got "${seen.recipe}")`);
    assert.notEqual(seen.reason, 'trigger not configured',
      `${where}: the enable guard must not refuse a Show State trigger for a missing id (got ${JSON.stringify(seen.reason)})`);
  }

  // The IF gate is the same watch, so the read-only category must be selectable there too.
  if (!(await evaluate(`Boolean(document.getElementById('condition-category'))`))) {
    await evaluate(`document.getElementById('add-condition').click()`);
    await sleep(250);
  }
  // Its id list is seeded the same way: an empty one would be read as an unconfigured gate.
  await evaluate(`(() => {
    const ids = document.getElementById('condition-ids');
    const category = document.getElementById('condition-category');
    category.value = '';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    ids.value = '';
    ids.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await setSelect('condition-category', 'showstate');
  await setSelect('condition-parameter', 'scene_active_tag');
  const tagGate = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    const field = document.getElementById('condition-value');
    const all = [...document.getElementById('condition-parameter').options].map((option) => option.value);
    return {
      // Same two non-catalogue entries as the step list: "— Not configured —" and a kept unknown key.
      keys: all.filter((key) => key && !key.includes(':')),
      number: visible('condition-value'),
      min: field.min,
      max: field.max,
      ids: document.getElementById('condition-ids').value,
      gateIds: conditionFromFields().targetIds,
    };
  })()`);
  assert.deepEqual(tagGate.keys,
    ['scene_active_index', 'scene_active_name', 'scene_active_tag', 'scene_show_name', 'scene_list'],
    `the IF gate must offer the same five read-only keys (got ${JSON.stringify(tagGate.keys)})`);
  assert.equal(tagGate.number, true, 'Active Scene Tag is a number the gate compares');
  assert.equal(tagGate.min, '0', 'the active scene tag starts at 0');
  assert.equal(tagGate.max, '128', 'Maillot 4126 bounds the active scene tag at 0…128');
  assert.equal(tagGate.ids, '1',
    `an IF gate on Show State must be seeded with an id rather than left blank (got ${JSON.stringify(tagGate)})`);
  assert.equal(tagGate.gateIds, '1', 'the gate record must carry the seeded id, not the blank field');

  // Nothing in either scope leaks across the split, whatever category the operator picks: no step
  // destination carries a read-only key, and no trigger or gate list carries a writable one.
  const scopeLeaks = await evaluate(`(() => {
    const readOnly = ['scene_active_index', 'scene_active_name', 'scene_active_tag', 'scene_show_name', 'scene_list'];
    const writable = ['scene_index', 'scene_action'];
    const leaks = [];
    const watchLeaks = [];
    Object.entries(targetCatalog.targetParametersByCategory || {}).forEach(([category, parameters]) => {
      (parameters || []).forEach((parameter) => {
        if (readOnly.includes(parameter.key)) leaks.push(category + '/' + parameter.key);
      });
    });
    Object.entries(targetCatalog.triggerParametersByCategory || {}).forEach(([category, parameters]) => {
      (parameters || []).forEach((parameter) => {
        if (writable.includes(parameter.key)) watchLeaks.push(category + '/' + parameter.key);
      });
    });
    // The two maps are deliberately asymmetric: "show" is written only, "showstate" watched only,
    // so a scope must never reach into the other map for a missing category.
    const targetMap = targetCatalog.targetParametersByCategory || {};
    const triggerMap = targetCatalog.triggerParametersByCategory || {};
    return {
      leaks,
      watchLeaks,
      showstateInTargetMap: Object.prototype.hasOwnProperty.call(targetMap, 'showstate'),
      showInTriggerMap: Object.prototype.hasOwnProperty.call(triggerMap, 'show'),
    };
  })()`);
  assert.deepEqual(scopeLeaks.leaks, [],
    `a read-only show key must never appear in a step destination list (got ${JSON.stringify(scopeLeaks.leaks)})`);
  assert.deepEqual(scopeLeaks.watchLeaks, [],
    `a writable show key must never appear in a trigger or IF gate list (got ${JSON.stringify(scopeLeaks.watchLeaks)})`);
  assert.equal(scopeLeaks.showstateInTargetMap, false,
    'the target map must not carry showstate: the two maps are deliberately asymmetric and a step list must not fall back to the trigger map');
  assert.equal(scopeLeaks.showInTriggerMap, false,
    'the trigger map must not carry show: a trigger or gate must not fall back to the target map for a writable key');

  // The split must come from the category flags, not from a hardcoded list of names: flipping
  // `canTrigger`/`canTarget` on the live catalogue has to move the two categories between the three
  // selects, and restoring the flags has to put the split back exactly as it was.
  const flagRule = await evaluate(`(() => {
    const keysOf = (id) => [...document.getElementById(id).querySelectorAll('option')]
      .filter((option) => option.value)
      .map((option) => option.value);
    const snapshot = () => ({
      target: keysOf('target-category'), trigger: keysOf('trigger-category'), condition: keysOf('condition-category'),
    });
    const show = targetCatalog.categories.find((category) => category.key === 'show');
    const showstate = targetCatalog.categories.find((category) => category.key === 'showstate');
    const before = snapshot();
    show.canTrigger = true;
    showstate.canTarget = true;
    populateCategorySelects();
    const flipped = snapshot();
    show.canTrigger = false;
    showstate.canTarget = false;
    populateCategorySelects();
    return { before, flipped, restored: snapshot() };
  })()`);
  assert.ok(!flagRule.before.target.includes('showstate') && flagRule.flipped.target.includes('showstate'),
    `the step destination list must be filtered by canTarget, not by a name list (before ${JSON.stringify(flagRule.before.target)}, flipped ${JSON.stringify(flagRule.flipped.target)})`);
  assert.ok(!flagRule.before.trigger.includes('show') && flagRule.flipped.trigger.includes('show'),
    `the trigger list must be filtered by canTrigger, not by a name list (before ${JSON.stringify(flagRule.before.trigger)}, flipped ${JSON.stringify(flagRule.flipped.trigger)})`);
  assert.ok(!flagRule.before.condition.includes('show') && flagRule.flipped.condition.includes('show'),
    `the IF gate list must be filtered by canTrigger too (before ${JSON.stringify(flagRule.before.condition)}, flipped ${JSON.stringify(flagRule.flipped.condition)})`);
  assert.deepEqual(flagRule.restored, flagRule.before,
    `restoring the flags must restore the split exactly (got ${JSON.stringify(flagRule.restored)})`);

  // ── Batch 2: solo, talkback and GPIO ─────────────────────────────────────────────────────────
  //
  // Maillot's talkback node (`/cfg/talk`, 1458-1534), the GPIO node (`/$ctl/gpio`, 4008-4014) and
  // the solo switch every mix family publishes (`$solo`: 1999, 2250, 2394, 2565, 2732; `/dca/<n>/
  // $solo` at 2874). These run against the fallback catalogue — this page opens without an IPC stub,
  // so what they drive IS the standalone window — and hold it to the same keys, labels, kinds,
  // ranges, options and write/watch split the backend catalogue publishes.
  const talkbackCatalogue = await evaluate(`(() => {
    const optionList = (id) => {
      const select = document.getElementById(id);
      return select
        ? [...select.querySelectorAll('option')]
          .filter((option) => option.value)
          .map((option) => ({
            key: option.value,
            label: option.textContent,
            group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
          }))
        : [];
    };
    return {
      target: optionList('target-category'),
      trigger: optionList('trigger-category'),
      condition: optionList('condition-category'),
      categories: targetCatalog.categories
        .filter((category) => ['talk', 'gpio', 'gpiostate'].includes(category.key))
        .map((category) => ({
          key: category.key, label: category.label, group: category.group, count: category.count,
          canTrigger: category.canTrigger, canTarget: category.canTarget,
        })),
    };
  })()`);
  assert.deepEqual(talkbackCatalogue.categories, [
    { key: 'talk', label: 'Talkback', group: 'Talkback', count: 2, canTrigger: true, canTarget: true },
    { key: 'gpio', label: 'GPIO', group: 'GPIO', count: 4, canTrigger: true, canTarget: true },
    { key: 'gpiostate', label: 'GPIO Input State', group: 'GPIO', count: 4, canTrigger: true, canTarget: false },
  ], `the talkback and GPIO categories must mirror the backend catalogue (got ${JSON.stringify(talkbackCatalogue.categories)})`);
  const talkCategoryKeys = {
    target: talkbackCatalogue.target.map((entry) => entry.key),
    trigger: talkbackCatalogue.trigger.map((entry) => entry.key),
    condition: talkbackCatalogue.condition.map((entry) => entry.key),
  };
  assert.ok(talkCategoryKeys.target.includes('talk') && talkCategoryKeys.trigger.includes('talk')
    && talkCategoryKeys.condition.includes('talk'),
  `Talkback is written and reported, so it must be selectable in all three panels (got ${JSON.stringify(talkCategoryKeys)})`);
  // The GPIO split: the read-only `$state` is watchable and never a step, the writable pair the
  // other way round. The split is the category's own flags — the same rule the show pair uses.
  assert.ok(talkCategoryKeys.target.includes('gpio') && talkCategoryKeys.trigger.includes('gpio'),
    `GPIO mode and state are written and reported (got ${JSON.stringify(talkCategoryKeys)})`);
  assert.ok(!talkCategoryKeys.target.includes('gpiostate'),
    'GPIO Input State is read-only and must never be offered as a step destination');
  assert.ok(talkCategoryKeys.trigger.includes('gpiostate') && talkCategoryKeys.condition.includes('gpiostate'),
    `GPIO Input State must be offered as a trigger and as an IF gate (got ${JSON.stringify(talkCategoryKeys)})`);
  for (const list of ['target', 'trigger', 'condition']) {
    const label = talkbackCatalogue[list].find((entry) => entry.key === 'talk')?.label;
    assert.equal(label, 'Talkback (2)', `the ${list} category list must label the category "Talkback" and offer both entries`);
  }
  for (const list of ['target', 'trigger']) {
    assert.equal(talkbackCatalogue[list].find((entry) => entry.key === 'gpio')?.group, 'GPIO',
      `the ${list} list must file the GPIO keys under a "GPIO" group, not an unlabelled one`);
  }
  assert.equal(talkbackCatalogue.trigger.find((entry) => entry.key === 'gpiostate')?.group, 'GPIO',
    'the watch half of the GPIO node belongs in the same "GPIO" group');
  // The brief's ordering: the two new groups sit before the catch-all, not after "Advanced".
  const groupOrder = await evaluate(`(() => {
    const groups = [...document.getElementById('target-category').querySelectorAll('optgroup')].map((group) => group.label);
    return { groups, advanced: groups.indexOf('Advanced'), talkback: groups.indexOf('Talkback'), gpio: groups.indexOf('GPIO') };
  })()`);
  assert.ok(groupOrder.talkback >= 0 && groupOrder.gpio >= 0,
    `the two new groups must exist in the category list (got ${JSON.stringify(groupOrder.groups)})`);
  assert.ok(groupOrder.talkback < groupOrder.advanced && groupOrder.gpio < groupOrder.advanced,
    `Talkback and GPIO must be ordered before the catch-all (got ${JSON.stringify(groupOrder.groups)})`);

  // The keys themselves: exactly the eight frozen talkback keys, with their frozen labels.
  await setSelect('target-category', 'talk');
  const talkKeys = await evaluate(`(() => {
    const select = document.getElementById('target-parameter');
    const plain = [...select.options].filter((option) => option.value && !option.value.includes(':'));
    return {
      keys: plain.map((option) => option.value),
      labels: plain.map((option) => option.textContent),
    };
  })()`);
  assert.deepEqual(talkKeys.keys,
    ['talk_on', 'talk_mode', 'talk_monitor_dim', 'talk_bus_dim', 'talk_individual', 'talk_bus_assign', 'talk_matrix_assign', 'talk_main_assign'],
    `Talkback must offer exactly the eight frozen keys (got ${JSON.stringify(talkKeys.keys)})`);
  assert.deepEqual(talkKeys.labels,
    ['Talkback On', 'Talkback Mode', 'Talkback Monitor Dim', 'Talkback Bus Dim', 'Talkback Individual Levels', 'Talkback Bus Assign', 'Talkback Matrix Assign', 'Talkback Main Assign'],
    `the talkback keys must carry the frozen labels (got ${JSON.stringify(talkKeys.labels)})`);
  // The same eight keys are what the console reports, so the trigger (and IF gate) list carries them
  // too. An earlier check left the trigger on Show State, and the select keeps a stored key it cannot
  // explain (the "kept unknown" rule the step list has as well), so that one leftover is set aside
  // rather than pretending the list can be empty.
  await setSelect('trigger-category', 'talk');
  const talkTriggerKeys = await evaluate(`(() => {
    const select = document.getElementById('trigger-parameter');
    return [...select.options].filter((option) => option.value && !option.value.includes(':')).map((option) => option.value);
  })()`);
  assert.deepEqual(talkTriggerKeys.filter((key) => key !== 'scene_active_name'), talkKeys.keys,
    `every talkback key is reported by the console, so the trigger list must carry all eight (got ${JSON.stringify(talkTriggerKeys)})`);

  // `talk_mode` is a closed list: a choice is never typed, because a typo in an enum is a write the
  // console ignores in silence.
  await setSelect('target-parameter', 'talk_mode');
  const talkModeControl = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    const options = document.getElementById('osc-value-options');
    return {
      options: visible('osc-value-options'),
      number: visible('osc-value'),
      values: [...options.options].map((option) => option.value),
      hint: document.getElementById('value-hint').textContent,
    };
  })()`);
  assert.deepEqual(talkModeControl.values, ['AUTO', 'PUSH', 'LATCH'],
    `Talkback Mode must be a closed list with exactly the three documented modes (got ${JSON.stringify(talkModeControl.values)})`);
  assert.equal(talkModeControl.options, true, 'a closed list must be offered as the list select');
  assert.equal(talkModeControl.number, false, 'a closed list has no free number to type');
  assert.match(talkModeControl.hint, /AUTO, PUSH or LATCH/,
    `the hint must name the three modes (got "${talkModeControl.hint}")`);

  // The two dims are documented `40..0` — an amount of attenuation, not a level — in 41 steps, so 40
  // and 0 are both inside the range and 41 is outside it. The bounds themselves are stored in their
  // numeric order (`min 0`, `max 40`), because a `min 40 / max 0` pair would refuse the 40 the
  // document allows and let 41 through; the documented order lives in the wording. The backend
  // catalogue carries the same pair, so both refuse the same 41.
  for (const dim of ['talk_monitor_dim', 'talk_bus_dim']) {
    await setSelect('target-parameter', dim);
    const dimControl = await evaluate(`(() => {
      const field = document.getElementById('osc-value');
      return { min: field.min, max: field.max, hint: document.getElementById('value-hint').textContent };
    })()`);
    assert.equal(dimControl.min, '0', `${dim} must carry the documented range's lower end`);
    assert.equal(dimControl.max, '40', `${dim} must carry the documented range's upper end`);
    assert.match(dimControl.hint, /40…0/,
      `the ${dim} hint must keep the documented order (got "${dimControl.hint}")`);
    await type('osc-value', '41');
    await sleep(150);
    assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), true,
      `${dim} must refuse 41: the documented range is 40…0`);
    await type('osc-value', '40');
    await sleep(120);
    assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), false,
      `${dim} must accept 40, the most attenuation the document allows`);
    await type('osc-value', '0');
    await sleep(120);
    assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), false,
      `${dim} must accept 0, no attenuation`);
  }

  // ── The three assigns and the destination control ──────────────────────────────────────────────
  //
  // Each assign carries the destination index the send parameters already use, so the editor's own
  // destination control (its field, its range, its grouped picker) serves them without a second
  // implementation. The bounds are asserted here from the fallback rows; the app's own catalogue is
  // driven in test-desktop-action-target-browser.mjs with the IPC stub, which is where the real
  // `sendIndexLabel`/`sendIndexMax` the backend publishes are exercised.
  for (const [key, label, max] of [
    ['talk_bus_assign', 'Bus', 16],
    ['talk_matrix_assign', 'Matrix', 8],
    ['talk_main_assign', 'Main', 4],
  ]) {
    await setSelect('target-parameter', key);
    const assignControl = await evaluate(`(() => {
      const field = document.getElementById('send-id');
      return {
        shown: !document.getElementById('send-id-field').classList.contains('hidden'),
        label: document.getElementById('send-id-label').textContent,
        hint: document.getElementById('send-id-hint').textContent,
        max: field.max,
      };
    })()`);
    assert.equal(assignControl.shown, true, `${key} must show the destination control: without an index it addresses nothing`);
    assert.equal(assignControl.label, `${label} assign`,
      `${key} must label its destination "${label} assign" (got "${assignControl.label}")`);
    assert.equal(assignControl.max, String(max),
      `${key} must bound its destination at ${max} (got ${assignControl.max})`);
    assert.match(assignControl.hint, new RegExp(`${label} 1…${max}`),
      `${key} must say which destinations it addresses (got "${assignControl.hint}")`);
    // 17 / 9 / 5 are one past each family's documented size, and 16 / 8 / 4 are its last entry.
    await type('send-id', String(max + 1));
    await sleep(120);
    assert.equal(await evaluate(`document.getElementById('send-id').classList.contains('is-invalid')`), true,
      `${key} must refuse ${max + 1}: ${label} only has ${max}`);
    assert.match(await evaluate(`document.getElementById('send-id-problem')?.textContent || ''`), new RegExp(`higher than ${max}`),
      `${key} must name the bound it refused (got "${await evaluate(`document.getElementById('send-id-problem')?.textContent || ''`)}")`);
    await type('send-id', String(max));
    await sleep(120);
    assert.equal(await evaluate(`document.getElementById('send-id').classList.contains('is-invalid')`), false,
      `${key} must accept ${max}, the last documented ${label}`);
  }

  // ── Talkback A and B: the id the field carries and the letter the path prints ──────────────────
  //
  // `/cfg/talk` holds two entries addressed by letter (`/cfg/talk/A/$on`, Maillot 1461) while the
  // backend resolver reads the number 1 or 2, so the field keeps numbers and the readout names the
  // talkback the number means: without it the second entry is invisible.
  await setSelect('target-category', 'talk');
  const talkIdsReadout = await evaluate(`(() => {
    const ids = document.getElementById('target-ids');
    const readout = document.getElementById('target-ids-destination');
    const show = (value) => {
      ids.value = value;
      ids.dispatchEvent(new Event('input', { bubbles: true }));
      return readout.textContent;
    };
    return { one: show('1'), two: show('2'), both: show('1, 2'), stray: show(''), title: readout.title };
  })()`);
  assert.equal(talkIdsReadout.one, 'Talkback A', `talkback id 1 must read as Talkback A (got "${talkIdsReadout.one}")`);
  assert.equal(talkIdsReadout.two, 'Talkback B', `talkback id 2 must read as Talkback B (got "${talkIdsReadout.two}")`);
  assert.equal(talkIdsReadout.both, 'Talkback A, B', `both entries must be named (got "${talkIdsReadout.both}")`);
  assert.match(talkIdsReadout.stray, /1 = A, 2 = B/,
    `a field with no usable id must still say how to address A or B (got "${talkIdsReadout.stray}")`);
  // Both entries are addressable, and a third is not: the count is the console's two.
  await type('target-ids', '2');
  await sleep(120);
  assert.equal(await evaluate(`document.getElementById('target-ids').classList.contains('is-invalid')`), false,
    'talkback id 2 (talkback B) must be accepted');
  const talkStrayId = await evaluate(`(() => {
    const ids = document.getElementById('target-ids');
    ids.value = '3';
    ids.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      invalid: ids.classList.contains('is-invalid'),
      problem: document.getElementById('target-ids-problem')?.textContent || '',
      readout: document.getElementById('target-ids-destination').textContent,
    };
  })()`);
  assert.equal(talkStrayId.invalid, true, 'talkback id 3 must be refused: the node has two entries');
  assert.match(talkStrayId.problem, /talk only has 2/,
    `the refusal must name the two entries (got "${talkStrayId.problem}")`);
  assert.doesNotMatch(talkStrayId.readout, /Talkback [AB]/,
    `no readout may claim an entry the console does not have (got "${talkStrayId.readout}")`);
  assert.match(talkStrayId.readout, /1 = A, 2 = B/,
    `a refused id must leave the way to address A or B on screen (got "${talkStrayId.readout}")`);
  // The same readout follows the trigger and the IF gate, and stays silent for a numbered category.
  const readoutScope = await evaluate(`(() => {
    const set = (categoryId, idsId, readoutId, value, category) => {
      const select = document.getElementById(categoryId);
      select.value = category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const ids = document.getElementById(idsId);
      ids.value = value;
      ids.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById(readoutId).textContent;
    };
    return {
      trigger: set('trigger-category', 'trigger-ids', 'trigger-ids-destination', '2', 'talk'),
      conditionTalk: set('condition-category', 'condition-ids', 'condition-ids-destination', '1', 'talk'),
      conditionChannel: set('condition-category', 'condition-ids', 'condition-ids-destination', '3', 'ch'),
      triggerChannel: set('trigger-category', 'trigger-ids', 'trigger-ids-destination', '3', 'ch'),
    };
  })()`);
  assert.equal(readoutScope.trigger, 'Talkback B', `the trigger panel must name talkback B (got "${readoutScope.trigger}")`);
  assert.equal(readoutScope.conditionTalk, 'Talkback A', `the IF gate must name talkback A (got "${readoutScope.conditionTalk}")`);
  assert.equal(readoutScope.conditionChannel, '', 'a numbered category has nothing to name: channel 3 is not "Channel C"');
  assert.equal(readoutScope.triggerChannel, '', 'the readout must stay empty outside the letter-addressed categories');
  await setSelect('trigger-category', 'usb');

  // ── GPIO: the read-only leaf is watched, never written ─────────────────────────────────────────
  await setSelect('target-category', 'gpio');
  const gpioTargetKeys = await evaluate(`(() => {
    const select = document.getElementById('target-parameter');
    const plain = [...select.options].filter((option) => option.value && !option.value.includes(':'));
    return { keys: plain.map((option) => option.value), labels: plain.map((option) => option.textContent) };
  })()`);
  assert.deepEqual(gpioTargetKeys.keys, ['gpio_mode', 'gpio_state'],
    `GPIO must offer the two writable keys and never the read-only one (got ${JSON.stringify(gpioTargetKeys.keys)})`);
  assert.deepEqual(gpioTargetKeys.labels, ['GPIO Mode', 'GPIO State'],
    `the writable GPIO keys must carry the frozen labels (got ${JSON.stringify(gpioTargetKeys.labels)})`);
  await setSelect('target-parameter', 'gpio_mode');
  const gpioModeControl = await evaluate(`(() => {
    const options = document.getElementById('osc-value-options');
    return [...options.options].map((option) => option.value);
  })()`);
  assert.deepEqual(gpioModeControl, ['TGLNO', 'TGLNC', 'INNO', 'INNC', 'OUTNO', 'OUTNC'],
    `GPIO Mode must be the closed list of the six documented modes (got ${JSON.stringify(gpioModeControl)})`);

  await setSelect('trigger-category', 'gpiostate');
  // The parameter select keeps a stored key it cannot explain, so the parameter the panel really
  // watches is picked again after the category moves: the control below follows the selection.
  await setSelect('trigger-parameter', 'gpio_input_state');
  const gpioTriggerKeys = await evaluate(`(() => {
    const select = document.getElementById('trigger-parameter');
    const plain = [...select.options].filter((option) => option.value && !option.value.includes(':'));
    return { keys: plain.map((option) => option.value), labels: plain.map((option) => option.textContent) };
  })()`);
  assert.deepEqual(gpioTriggerKeys.keys.filter((key) => key !== 'scene_active_name'), ['gpio_input_state'],
    `GPIO Input State must be offered as a trigger (got ${JSON.stringify(gpioTriggerKeys.keys)})`);
  assert.deepEqual(gpioTriggerKeys.labels.filter((label) => !label.startsWith('scene_active_name')), ['GPIO Input State'],
    `the read-only key must carry its frozen label (got ${JSON.stringify(gpioTriggerKeys.labels)})`);
  const gpioInputTrigger = await triggerControls();
  assert.deepEqual(gpioInputTrigger.operators, ['==', '!='],
    `an input state is an on/off value: it is compared, never ordered (got ${JSON.stringify(gpioInputTrigger.operators)})`);
  assert.equal(gpioInputTrigger.toggle, true, 'GPIO Input State must use the on/off control');
  assert.equal(gpioInputTrigger.number, false, 'GPIO Input State is not a dB threshold');
  if (!(await evaluate(`Boolean(document.getElementById('condition-category'))`))) {
    await evaluate(`document.getElementById('add-condition').click()`);
    await sleep(250);
  }
  await setSelect('condition-category', 'gpiostate');
  const gpioGateKeys = await evaluate(`(() => {
    const select = document.getElementById('condition-parameter');
    return [...select.options].filter((option) => option.value && !option.value.includes(':')).map((option) => option.value);
  })()`);
  assert.deepEqual(gpioGateKeys.filter((key) => key !== 'scene_active_name' && key !== 'scene_active_tag'), ['gpio_input_state'],
    `the IF gate must offer the same read-only key (got ${JSON.stringify(gpioGateKeys)})`);
  // The writable pair is watched too: the console reports `mode` and `gpstate` (4011, 4014).
  await setSelect('trigger-category', 'gpio');
  const gpioWatchedKeys = await evaluate(`(() => {
    const select = document.getElementById('trigger-parameter');
    return [...select.options].filter((option) => option.value && !option.value.includes(':')).map((option) => option.value);
  })()`);
  assert.deepEqual(gpioWatchedKeys.filter((key) => !['scene_active_name', 'gpio_input_state'].includes(key)), ['gpio_mode', 'gpio_state'],
    `the console reports the writable pair, so both must be watchable (got ${JSON.stringify(gpioWatchedKeys)})`);

  // ── Solo: one key on every mix family and on the DCA ───────────────────────────────────────────
  const soloFamilies = await evaluate(`(() => {
    const families = ['ch', 'aux', 'bus', 'main', 'matrix', 'dca'];
    const read = (category, scope) => {
      const select = document.getElementById(scope === 'trigger' ? 'trigger-category' : 'target-category');
      select.value = category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const parameter = document.getElementById(scope === 'trigger' ? 'trigger-parameter' : 'target-parameter');
      const option = [...parameter.options].find((entry) => entry.value === 'solo');
      return { offered: Boolean(option), label: option?.textContent || '' };
    };
    return families.map((family) => ({ family, target: read(family, 'target'), trigger: read(family, 'trigger') }));
  })()`);
  for (const entry of soloFamilies) {
    assert.equal(entry.target.offered, true, `solo must be offered as a step target on ${entry.family}`);
    assert.equal(entry.target.label, 'Solo', `solo must carry the frozen label on ${entry.family} (got "${entry.target.label}")`);
    // The DCA has no meter of its own in this catalogue, so its watch list is a different shape; the
    // five mix families carry their meter first and solo among the rest. Both are asserted only for
    // the row's own presence, which is what the brief freezes.
    assert.equal(entry.trigger.offered, true,
      `the console publishes solo, so ${entry.family} must offer it as a trigger or IF gate too`);
  }
  await setSelect('target-category', 'ch');
  await setSelect('target-parameter', 'solo');
  const soloControl = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    const hint = document.getElementById('value-hint').textContent;
    return { toggle: visible('osc-value-options') || visible('osc-value'), hint };
  })()`);
  assert.equal(soloControl.toggle, true, 'solo is an on/off parameter: it must be offered as 0/1');
  assert.match(soloControl.hint, /1 = soloed|ON \(soloed\)/i,
    `the solo hint must say what 1 means (got "${soloControl.hint}")`);
  await type('osc-value', '2');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), true,
    'solo is 0 or 1, so 2 must be refused');
  await type('osc-value', '1');
  await sleep(120);

  // ── Batch 3: routing, oscillator, source mode and the global MAIN/ALT switch ───────────────────
  //
  // Maillot's input-connection node (`/ch/1/in/conn/*`, 1955-1965; `/aux/1/in/conn/*`, 2224-2233),
  // the `/io` switches (1593-1594), the oscillator's own leaves under the extra `osc` segment
  // (1789-1793) and the writable source mode (1599, 1781). These run against the fallback catalogue
  // — this page opens without an IPC stub, so what they drive IS the standalone window — and hold it
  // to the same keys, labels, kinds, ranges, options and write/watch split the backend publishes.
  const batch3Categories = await evaluate(`(() => {
    const optionList = (id) => {
      const select = document.getElementById(id);
      return select
        ? [...select.querySelectorAll('option')]
          .filter((option) => option.value)
          .map((option) => ({
            key: option.value,
            label: option.textContent,
            group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
          }))
        : [];
    };
    return {
      target: optionList('target-category'),
      trigger: optionList('trigger-category'),
      condition: optionList('condition-category'),
      categories: targetCatalog.categories
        .filter((category) => category.key === 'io' || category.key.startsWith('preamp_') || category.key === 'usersig')
        .map((category) => ({
          key: category.key, label: category.label, group: category.group, count: category.count,
          canTrigger: category.canTrigger, canTarget: category.canTarget,
        })),
      indexLess: [...INDEX_LESS_CATEGORIES],
    };
  })()`);
  const batch3Keys = {
    target: batch3Categories.target.map((entry) => entry.key),
    trigger: batch3Categories.trigger.map((entry) => entry.key),
    condition: batch3Categories.condition.map((entry) => entry.key),
  };
  // The new `io` category: index-less like `show`, written and reported, so it is selectable in all
  // three panels. The brief's frozen group is its own "I/O", not the "Control" catch-all.
  assert.ok(batch3Keys.target.includes('io') && batch3Keys.trigger.includes('io')
    && batch3Keys.condition.includes('io'),
  `the I/O category must be offered in all three panels (got ${JSON.stringify(batch3Keys)})`);
  for (const list of ['target', 'trigger', 'condition']) {
    const entry = batch3Categories[list].find((category) => category.key === 'io');
    assert.equal(entry?.group, 'I/O',
      `the ${list} list must file the two /io switches under their own "I/O" group (got ${JSON.stringify(entry)})`);
    assert.equal(entry?.label, 'I/O (1)',
      `the ${list} list must label the category "I/O" with its single entry (got "${entry?.label}")`);
  }
  assert.deepEqual(batch3Categories.categories.filter((category) => category.key === 'io'),
    [{ key: 'io', label: 'I/O', group: 'I/O', count: 1, canTrigger: true, canTarget: true }],
    'the io category must mirror the backend catalogue: one documented entry, addressable and watchable');
  assert.ok(batch3Categories.indexLess.includes('io'),
    `an index-less category needs its ids seeded for the trigger panel (got ${JSON.stringify(batch3Categories.indexLess)})`);
  const batch3GroupOrder = await evaluate(`(() => {
    const groups = [...document.getElementById('target-category').querySelectorAll('optgroup')].map((group) => group.label);
    return { groups, io: groups.indexOf('I/O'), sources: groups.indexOf('Sources'), advanced: groups.indexOf('Advanced') };
  })()`);
  assert.ok(batch3GroupOrder.io >= 0 && batch3GroupOrder.sources >= 0,
    `the I/O and Sources groups must exist in the category list (got ${JSON.stringify(batch3GroupOrder.groups)})`);
  assert.ok(batch3GroupOrder.io < batch3GroupOrder.advanced && batch3GroupOrder.sources < batch3GroupOrder.advanced,
    `I/O and Sources must be ordered before the catch-all (got ${JSON.stringify(batch3GroupOrder.groups)})`);
  // Both switches are written and the console reports them, so they appear in the step, trigger and
  // IF-gate lists. An index-less category keeps a number in the trigger ids field: the backend's
  // completeness rule refuses an empty trigger id before the resolver ever ignores it.
  await setSelect('target-category', 'io');
  await setSelect('trigger-category', 'io');
  await setSelect('condition-category', 'io');
  const ioKeys = await evaluate(`(() => {
    const plain = (id) => {
      const select = document.getElementById(id);
      return [...select.options]
        .filter((option) => option.value && !option.value.includes(':'))
        .map((option) => ({ key: option.value, label: option.textContent }));
    };
    return {
      target: plain('target-parameter'),
      trigger: plain('trigger-parameter'),
      condition: plain('condition-parameter'),
      triggerIds: document.getElementById('trigger-ids').value,
      targetIds: document.getElementById('target-ids').value,
    };
  })()`);
  const ioPairs = [
    ['io_altsw', 'Main/Alt Switch'],
    ['io_auto_alt_override', 'Auto Input Override'],
  ];
  for (const [scope, rows] of [['target', ioKeys.target], ['trigger', ioKeys.trigger], ['condition', ioKeys.condition]]) {
    const mine = rows.filter((row) => row.key.startsWith('io_'));
    assert.deepEqual(mine.map((row) => row.key), ioPairs.map((pair) => pair[0]),
      `the ${scope} list must offer exactly the two frozen /io keys (got ${JSON.stringify(rows)})`);
    assert.deepEqual(mine.map((row) => row.label), ioPairs.map((pair) => pair[1]),
      `the ${scope} list must carry the frozen I/O labels (got ${JSON.stringify(rows)})`);
  }
  assert.ok(ioKeys.triggerIds.trim().length > 0,
    `picking an index-less category must seed the trigger ids field, or the backend refuses the macro as unconfigured (got "${ioKeys.triggerIds}")`);
  await setSelect('target-parameter', 'io_altsw');
  const ioControl = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    return {
      // A toggle is not a closed list of one entry: it is the 0/1 pair, drawn by the free-number
      // control. /io/altsw takes 0 or 1 (1593), so the field must be the number and the select
      // must stay hidden — a leftover list from the previous parameter is not an answer.
      toggle: visible('osc-value'),
      list: visible('osc-value-options'),
      kind: activeTargetParameterInfo().valueKind,
      hint: document.getElementById('value-hint').textContent,
    };
  })()`);
  assert.equal(ioControl.kind, 'toggle',
    `Main/Alt Switch is an on/off parameter (got ${JSON.stringify(ioControl.kind)})`);
  assert.equal(ioControl.toggle, true, 'the switch must be offered as a 0/1 value');
  assert.equal(ioControl.list, false, 'the switch is not a closed list');
  assert.match(ioControl.hint, /1593/,
    `the switch hint must cite the documented leaf (got "${ioControl.hint}")`);
  await type('osc-value', '2');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), true,
    'Main/Alt Switch is 0 or 1, so 2 must be refused');
  await type('osc-value', '1');
  await sleep(120);

  // ── The oscillator: its leaves live one segment deeper ────────────────────────────────────────
  //
  // `/io/in/OSC/<n>/osc/{lvl,mode,f}` (1789-1793). Nothing in the editor may build that address: the
  // step record carries the key and the backend resolves it, so what is asserted here is that the
  // three keys are offered on the oscillator with the documented controls, and that the extra `osc`
  // segment is named where the operator can see it.
  await setSelect('target-category', 'preamp_oscillator');
  const oscillatorKeys = await evaluate(`(() => {
    const select = document.getElementById('target-parameter');
    const plain = [...select.options].filter((option) => option.value && !option.value.includes(':'));
    return { keys: plain.map((option) => option.value), labels: plain.map((option) => option.textContent) };
  })()`);
  for (const key of ['osc_level', 'osc_mode', 'osc_freq']) {
    assert.ok(oscillatorKeys.keys.includes(key),
      `the oscillator must offer ${key} (got ${JSON.stringify(oscillatorKeys.keys)})`);
  }
  // …and not `source_mode`: Maillot prints the oscillator's own `/mode` row `[RO]` (1781), so the
  // console takes no write there and the key must never be offered as one.
  assert.ok(!oscillatorKeys.keys.includes('source_mode'),
    `the oscillator's mode row is [RO] (1781) and must not be offered as a write (got ${JSON.stringify(oscillatorKeys.keys)})`);
  assert.ok(oscillatorKeys.labels.includes('Oscillator Level') && oscillatorKeys.labels.includes('Oscillator Waveform')
    && oscillatorKeys.labels.includes('Oscillator Frequency'),
  `the oscillator keys must carry the frozen labels (got ${JSON.stringify(oscillatorKeys.labels)})`);
  // The level is a number, -40…6 (1790), not a closed list and not a dB range shrunk to suit it.
  await setSelect('target-parameter', 'osc_level');
  const oscLevelControl = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    const field = document.getElementById('osc-value');
    return {
      number: visible('osc-value'),
      options: visible('osc-value-options'),
      min: field.min,
      max: field.max,
      hint: document.getElementById('value-hint').textContent,
    };
  })()`);
  assert.equal(oscLevelControl.number, true, 'the oscillator level is typed as a number');
  assert.equal(oscLevelControl.options, false, 'the oscillator level is not a closed list');
  assert.equal(oscLevelControl.min, '-40', `the level starts at -40 (got ${oscLevelControl.min})`);
  assert.equal(oscLevelControl.max, '6', `the level ends at 6 (got ${oscLevelControl.max})`);
  assert.match(oscLevelControl.hint, /osc\/lvl/,
    `the level hint must name the address it writes, which carries the extra osc segment (got "${oscLevelControl.hint}")`);
  // The waveform is a closed list: a typo in an enum is a write the console ignores in silence.
  await setSelect('target-parameter', 'osc_mode');
  const oscModeControl = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    return {
      options: visible('osc-value-options'),
      values: [...document.getElementById('osc-value-options').options].map((option) => option.value),
      hint: document.getElementById('value-hint').textContent,
    };
  })()`);
  assert.deepEqual(oscModeControl.values, ['SINE', 'PINK', 'WHITE'],
    `the waveform must be the three documented shapes (got ${JSON.stringify(oscModeControl.values)})`);
  assert.equal(oscModeControl.options, true, 'a closed list is offered as the list select');
  assert.match(oscModeControl.hint, /SINE, PINK or WHITE/,
    `the waveform hint must name the three shapes (got "${oscModeControl.hint}")`);
  // The frequency is a number in Hz, 20…20000 (1793).
  await setSelect('target-parameter', 'osc_freq');
  const oscFreqControl = await evaluate(`(() => {
    const field = document.getElementById('osc-value');
    return { min: field.min, max: field.max, hint: document.getElementById('value-hint').textContent };
  })()`);
  assert.equal(oscFreqControl.min, '20', `the frequency starts at 20 Hz (got ${oscFreqControl.min})`);
  assert.equal(oscFreqControl.max, '20000', `the frequency ends at 20000 Hz (got ${oscFreqControl.max})`);
  assert.match(oscFreqControl.hint, /osc\/f/,
    `the frequency hint must name the address it writes (got "${oscFreqControl.hint}")`);

  // ── A value outside a documented range is refused, naming the bound ────────────────────────────
  //
  // The level stops at 6 (1790) and the frequency starts at 20 Hz (1793); both are documented
  // endpoints, not roundings, so the field must refuse one step past each and say which bound it used.
  await setSelect('target-parameter', 'osc_level');
  await type('osc-value', '7');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), true,
    'the oscillator level must refuse 7: the documented range is -40…6');
  assert.match(await evaluate(`document.getElementById('osc-value-problem')?.textContent || ''`), /maximum is 6/,
    `the refusal must name the upper bound it used (got "${await evaluate(`document.getElementById('osc-value-problem')?.textContent || ''`)}")`);
  await type('osc-value', '-40');
  await sleep(120);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), false,
    'the oscillator level must accept -40, the documented floor');
  await setSelect('target-parameter', 'osc_freq');
  await type('osc-value', '19');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), true,
    'the oscillator frequency must refuse 19 Hz: the documented range is 20…20000');
  assert.match(await evaluate(`document.getElementById('osc-value-problem')?.textContent || ''`), /minimum is 20/,
    'the refusal must name the lower bound it used');
  await type('osc-value', '20');
  await sleep(120);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), false,
    '20 Hz is the documented floor and must be accepted');

  // ── The writable source mode ──────────────────────────────────────────────────────────────────
  //
  // `source_mode` is the source's own mode — the writable counterpart of the read-only
  // `/ch/1/in/set/$mode` — so it belongs on the twelve source categories whose `mode` row Maillot does
  // not mark `[RO]`: local 1599, aux 1618, AES50 A/B/C 1629/1652/1671, StageConnect 1690, USB 1702,
  // card 1713, module 1724, USB player 1735, AES/EBU 1747 and user signals 1760. The oscillator's row
  // is `[RO]` (1781) and keeps the key out, and the mix families never see it.
  const sourceModeFamilies = await evaluate(`(() => {
    const sources = FALLBACK_SOURCE_CATEGORIES.map((category) => category.key);
    const read = (category, scope) => {
      const select = document.getElementById(scope === 'trigger' ? 'trigger-category' : 'target-category');
      select.value = category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const parameter = document.getElementById(scope === 'trigger' ? 'trigger-parameter' : 'target-parameter');
      const option = [...parameter.options].find((entry) => entry.value === 'source_mode');
      return { offered: Boolean(option), label: option?.textContent || '' };
    };
    return {
      sources,
      target: sources.map((category) => ({ category, ...read(category, 'target') })),
      trigger: sources.map((category) => ({ category, ...read(category, 'trigger') })),
    };
  })()`);
  const physicalSources = ['preamp_local', 'preamp_aux', 'preamp_aes50a', 'preamp_aes50b', 'preamp_aes50c',
    'preamp_stageconnect', 'usb', 'preamp_card', 'preamp_module', 'preamp_usbplayer', 'preamp_aesebu', 'usersig'];
  // The names are spelled as the backend catalogue spells them; the editor must carry the same keys.
  const physicalSourceKeys = sourceModeFamilies.sources.filter((key) => key !== 'preamp_oscillator'
    && !['preamp_bus', 'preamp_main', 'preamp_matrix'].includes(key));
  assert.deepEqual(physicalSourceKeys, physicalSources,
    `the standalone catalogue must carry the twelve physical sources (got ${JSON.stringify(physicalSourceKeys)})`);
  for (const entry of sourceModeFamilies.target) {
    const mustOffer = entry.category !== 'preamp_bus' && entry.category !== 'preamp_main'
      && entry.category !== 'preamp_matrix' && entry.category !== 'preamp_oscillator';
    assert.equal(entry.offered, mustOffer,
      `source_mode must be offered on ${entry.category}${mustOffer ? '' : ' — its own mode row is read-only there, and the three meter-only groups have no writable leaf at all'}`);
    if (mustOffer) {
      assert.equal(entry.label, 'Source Mode',
        `source_mode must carry the frozen label on ${entry.category} (got "${entry.label}")`);
    }
  }
  // Every source whose row is writable reports it as well, which is what makes "when the input goes
  // stereo" a plain state trigger. The oscillator and the three meter-only groups are the exceptions.
  for (const entry of sourceModeFamilies.trigger) {
    if (['preamp_bus', 'preamp_main', 'preamp_matrix', 'preamp_oscillator'].includes(entry.category)) continue;
    assert.equal(entry.offered, true, `the console reports the source mode, so ${entry.category} must offer it as a trigger`);
  }
  // The mix families must never offer it: their own `$mode` is read-only, and offering `source_mode`
  // there would aim a step at a leaf the console only publishes.
  const mixFamiliesWithoutSourceMode = await evaluate(`(() => {
    const families = ['ch', 'aux', 'bus', 'main', 'matrix', 'dca'];
    const read = (category, scope) => {
      const select = document.getElementById(scope === 'trigger' ? 'trigger-category' : 'target-category');
      select.value = category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const parameter = document.getElementById(scope === 'trigger' ? 'trigger-parameter' : 'target-parameter');
      return [...parameter.options].some((option) => option.value === 'source_mode');
    };
    return { target: families.filter((family) => read(family, 'target')), trigger: families.filter((family) => read(family, 'trigger')) };
  })()`);
  assert.deepEqual(mixFamiliesWithoutSourceMode, { target: [], trigger: [] },
    `source_mode belongs to the sources, never to a mix family (got ${JSON.stringify(mixFamiliesWithoutSourceMode)})`);
  // The closed list, and the default the editor paints: M, ST or M/S, never the oscillator waveform.
  await setSelect('target-category', 'preamp_local');
  await setSelect('target-parameter', 'source_mode');
  const sourceModeControl = await evaluate(`(() => ({
    values: [...document.getElementById('osc-value-options').options].map((option) => option.value),
    hint: document.getElementById('value-hint').textContent,
  }))()`);
  assert.deepEqual(sourceModeControl.values, ['M', 'ST', 'M/S'],
    `the source mode must be the three documented modes (got ${JSON.stringify(sourceModeControl.values)})`);
  assert.match(sourceModeControl.hint, /M .*ST .*M\/S/,
    `the source mode hint must name the three modes (got "${sourceModeControl.hint}")`);

  // ── Input routing on ch and aux, and nowhere else ─────────────────────────────────────────────
  //
  // Four keys on the two families that have an `/in/conn` node (1955-1965, 2224-2233). A bus, a main
  // and a matrix have `/in/set` and no `conn` node at all (2376-2378, 2547-2549, 2707-2709), so the
  // resolver answers nothing for them and the editor must not offer the keys.
  const routingKeys = ['input_conn_group', 'input_conn_index', 'input_conn_alt_group', 'input_conn_alt_index'];
  const routingAvailability = await evaluate(`(() => {
    const families = ['ch', 'aux', 'bus', 'main', 'matrix'];
    const read = (category, scope) => {
      const select = document.getElementById(scope === 'trigger' ? 'trigger-category' : 'target-category');
      select.value = category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const parameter = document.getElementById(scope === 'trigger' ? 'trigger-parameter' : 'target-parameter');
      const present = [...parameter.options].map((option) => option.value);
      return ${JSON.stringify(routingKeys)}.filter((key) => present.includes(key));
    };
    return {
      target: Object.fromEntries(families.map((family) => [family, read(family, 'target')])),
      trigger: Object.fromEntries(families.map((family) => [family, read(family, 'trigger')])),
    };
  })()`);
  for (const family of ['ch', 'aux']) {
    assert.deepEqual(routingAvailability.target[family], routingKeys,
      `all four routing keys must be step targets on ${family} (got ${JSON.stringify(routingAvailability.target[family])})`);
    assert.deepEqual(routingAvailability.trigger[family], routingKeys,
      `the console reports the connection, so all four must be watchable on ${family} (got ${JSON.stringify(routingAvailability.trigger[family])})`);
  }
  for (const family of ['bus', 'main', 'matrix']) {
    assert.deepEqual(routingAvailability.target[family], [],
      `${family} has no /in/conn node, so no routing key may be offered (got ${JSON.stringify(routingAvailability.target[family])})`);
    assert.deepEqual(routingAvailability.trigger[family], [],
      `${family} reports no input connection, so no routing key may be watchable (got ${JSON.stringify(routingAvailability.trigger[family])})`);
  }
  // The group is a closed list of the seventeen documented entries — Maillot's own `/in/conn/grp`
  // list (1956), which is *not* the nineteen-entry output list at 1844-1846 (`SEND` and `MON` are
  // not input sources).
  await setSelect('target-category', 'ch');
  await setSelect('target-parameter', 'input_conn_group');
  const routingGroupControl = await evaluate(`(() => {
    const el = document.getElementById('osc-value-options');
    // The closed list is drawn by the shared dropdown (dropdown.js): its button is the control on
    // screen, so that is what "visible" has to read.
    const control = document.getElementById('osc-value-options-menu');
    return {
      visible: Boolean(control) && !control.closest('.hidden') && control.getClientRects().length > 0,
      values: [...el.options].map((option) => option.value),
      kind: activeTargetParameterInfo().valueKind,
      hint: document.getElementById('value-hint').textContent,
    };
  })()`);
  assert.equal(routingGroupControl.visible, true, 'the input source group is a closed list, not free text');
  // Either value kind draws the closed list — the backend's own `output_group` row arrives as
  // `route_group` in the DTO while the frozen brief types these four as choices — so what is
  // asserted here is that the control really is a list, and the list is compared just below.
  assert.ok(['enum', 'route_group'].includes(routingGroupControl.kind),
    `a documented group list is a choice, not a free string (got ${routingGroupControl.kind})`);
  assert.deepEqual(routingGroupControl.values,
    ['OFF', 'LCL', 'AUX', 'A', 'B', 'C', 'SC', 'USB', 'CRD', 'MOD', 'PLAY', 'AES', 'USR', 'OSC', 'BUS', 'MAIN', 'MTX'],
    `the group must be the seventeen documented entries (got ${JSON.stringify(routingGroupControl.values)})`);
  // The number: the documented bound is 1…64 whatever the group, and the hint has to say that the
  // meaningful range depends on the group, because one field cannot validate it.
  await setSelect('target-parameter', 'input_conn_index');
  const routingIndexControl = await evaluate(`(() => {
    const field = document.getElementById('osc-value');
    return { min: field.min, max: field.max, hint: document.getElementById('value-hint').textContent };
  })()`);
  assert.equal(routingIndexControl.min, '1', `the connection index starts at 1 (got ${routingIndexControl.min})`);
  assert.equal(routingIndexControl.max, '64',
    `the connection index must keep the documented bound of 64, or bus 32 could not be written (got ${routingIndexControl.max})`);
  assert.match(routingIndexControl.hint, /depends on the group/,
    `the hint must say the meaningful range depends on the group (got "${routingIndexControl.hint}")`);
  assert.match(routingIndexControl.hint, /BUS is 1…32, MAIN 1…8, MTX 1…16/,
    `the hint must name each group's own size (got "${routingIndexControl.hint}")`);
  await type('osc-value', '65');
  await sleep(150);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), true,
    'the connection index must refuse 65: the documented range is 1…64');
  assert.match(await evaluate(`document.getElementById('osc-value-problem')?.textContent || ''`), /maximum is 64/,
    'the refusal must name the bound it used');
  await type('osc-value', '32');
  await sleep(120);
  assert.equal(await evaluate(`document.getElementById('osc-value').classList.contains('is-invalid')`), false,
    '32 must be accepted: it is a legitimate $BUS number and the field must not shrink to suit $MAIN');
  // The alt pair carries the same group list: it is the same connection, switched to by `/io/altsw`.
  await setSelect('target-parameter', 'input_conn_alt_group');
  const routingAltGroups = await evaluate(`[...document.getElementById('osc-value-options').options].map((option) => option.value)`);
  assert.deepEqual(routingAltGroups, routingGroupControl.values,
    `the alt group must be the same seventeen-entry list (got ${JSON.stringify(routingAltGroups)})`);
  // The grouped picker files the new keys where their vocabulary says they belong: input routing and
  // the source mode with the other input controls, the oscillator's three leaves with the levels.
  // A key no rule recognised would still be reachable, but under "Other" — which is what this pins.
  const batch3MenuGroups = await evaluate(`(() => {
    const path = (key) => parameterMenuPath({ value: key, info: {} }).map((group) => group.key).join('/');
    return {
      connGroup: path('input_conn_group'),
      connIndex: path('input_conn_alt_index'),
      sourceMode: path('source_mode'),
      oscLevel: path('osc_level'),
      oscMode: path('osc_mode'),
      oscFreq: path('osc_freq'),
      altsw: path('io_altsw'),
      override: path('io_auto_alt_override'),
    };
  })()`);
  for (const key of ['connGroup', 'connIndex', 'sourceMode']) {
    assert.equal(batch3MenuGroups[key], 'input',
      `${key} must be grouped with the other input controls (got "${batch3MenuGroups[key]}")`);
  }
  for (const key of ['oscLevel', 'oscMode', 'oscFreq']) {
    assert.equal(batch3MenuGroups[key], 'level',
      `${key} must be grouped with the level controls (got "${batch3MenuGroups[key]}")`);
  }
  for (const key of ['altsw', 'override']) {
    assert.equal(batch3MenuGroups[key], 'routing',
      `${key} must be grouped with the routing controls (got "${batch3MenuGroups[key]}")`);
  }

  // ── Batch 4: the USB transport, the fader layers and the console status ────────────────────────
  //
  // Maillot's USB recorder and player (`/rec` 3068-3075, `/play` 3043-3066), the seven fader layers
  // (`/$ctl/layer/<letter>/sel`, 3220, 3299, 3381, 3456, 3523, 3585, 3645) and the desk status a
  // macro can watch (`/$ctl/$stat/{selidx,pageidx}`, 3096-3097). These run against the fallback
  // catalogue — this page opens without an IPC stub, so what they drive IS the standalone window —
  // and hold it to the same keys, labels, kinds, ranges, options and write/watch split the backend
  // catalogue publishes. The split is the categories' own `canTrigger`/`canTarget`: the transport
  // leaves are written and never read back, the state leaves are read and never written.
  const batch4Catalogue = await evaluate(`(() => {
    const optionList = (id) => {
      const select = document.getElementById(id);
      return select
        ? [...select.querySelectorAll('option')]
          .filter((option) => option.value)
          .map((option) => ({
            key: option.value,
            label: option.textContent,
            group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
          }))
        : [];
    };
    const rows = (map, category) => (targetCatalog[map]?.[category] || []).map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      argKind: parameter.argKind,
      valueKind: parameter.valueKind,
      canTrigger: parameter.canTrigger,
      min: parameter.min ?? null,
      max: parameter.max ?? null,
      maxLen: parameter.maxLen ?? null,
      options: [...(parameter.options || [])],
    }));
    return {
      target: optionList('target-category'),
      trigger: optionList('trigger-category'),
      condition: optionList('condition-category'),
      targetGroups: [...document.getElementById('target-category').querySelectorAll('optgroup')].map((group) => group.label),
      triggerGroups: [...document.getElementById('trigger-category').querySelectorAll('optgroup')].map((group) => group.label),
      categories: targetCatalog.categories
        .filter((category) => ['layer', 'rec', 'recstate', 'play', 'playstate', 'stat'].includes(category.key))
        .map((category) => ({
          key: category.key, label: category.label, group: category.group, count: category.count,
          canTrigger: category.canTrigger, canTarget: category.canTarget,
        })),
      recTarget: rows('targetParametersByCategory', 'rec'),
      playTarget: rows('targetParametersByCategory', 'play'),
      layerTarget: rows('targetParametersByCategory', 'layer'),
      recTrigger: rows('triggerParametersByCategory', 'rec'),
      playTrigger: rows('triggerParametersByCategory', 'play'),
      recStateTrigger: rows('triggerParametersByCategory', 'recstate'),
      playStateTrigger: rows('triggerParametersByCategory', 'playstate'),
      statTrigger: rows('triggerParametersByCategory', 'stat'),
      layerTrigger: rows('triggerParametersByCategory', 'layer'),
      indexLess: [...INDEX_LESS_CATEGORIES],
    };
  })()`);
  assert.deepEqual(batch4Catalogue.categories, [
    { key: 'layer', label: 'Fader Layers', group: 'Surface', count: 7, canTrigger: true, canTarget: true },
    { key: 'rec', label: 'USB Recorder', group: 'Transport', count: 1, canTrigger: false, canTarget: true },
    { key: 'recstate', label: 'USB Recorder State', group: 'Transport', count: 1, canTrigger: true, canTarget: false },
    { key: 'play', label: 'USB Player', group: 'Transport', count: 1, canTrigger: false, canTarget: true },
    { key: 'playstate', label: 'USB Player State', group: 'Transport', count: 1, canTrigger: true, canTarget: false },
    { key: 'stat', label: 'Console Status', group: 'Console', count: 1, canTrigger: true, canTarget: false },
  ], `the batch-4 categories must mirror the backend catalogue (got ${JSON.stringify(batch4Catalogue.categories)})`);
  const batch4Selected = {
    target: batch4Catalogue.target.map((entry) => entry.key),
    trigger: batch4Catalogue.trigger.map((entry) => entry.key),
    condition: batch4Catalogue.condition.map((entry) => entry.key),
  };
  for (const written of ['rec', 'play', 'layer']) {
    assert.ok(batch4Selected.target.includes(written),
      `${written} is written, so it must be offered as a step destination (got ${JSON.stringify(batch4Selected.target)})`);
  }
  for (const watchOnly of ['recstate', 'playstate', 'stat']) {
    assert.ok(!batch4Selected.target.includes(watchOnly),
      `${watchOnly} is read-only and must never be offered as a step destination (got ${JSON.stringify(batch4Selected.target)})`);
    assert.ok(batch4Selected.trigger.includes(watchOnly) && batch4Selected.condition.includes(watchOnly),
      `${watchOnly} must be offered as a trigger and as an IF gate (got ${JSON.stringify(batch4Selected)})`);
  }
  // The console never reads the transport leaves back, so a trigger or a gate on one could never
  // fire: the whole category is `canTrigger: false` and must stay off both watch lists.
  for (const writtenOnly of ['rec', 'play']) {
    assert.ok(!batch4Selected.trigger.includes(writtenOnly) && !batch4Selected.condition.includes(writtenOnly),
      `${writtenOnly} is written and never read back, so it must not be watchable (got ${JSON.stringify(batch4Selected)})`);
  }
  // The groups: the transport and the desk status sit before the "Advanced" catch-all, and the layer
  // category keeps the "Surface" group the backend catalogue gives it. The catch-all itself is only
  // drawn where a category can be targeted — `custom` is written, never watched — so the order is
  // pinned on the catalogue the two pickers are both built from, not on one panel's optgroups.
  const batch4Order = await evaluate(`(() => {
    const keys = targetCatalog.categories.map((category) => category.key);
    return {
      keys,
      custom: keys.indexOf('custom'),
      targetGroups: [...document.getElementById('target-category').querySelectorAll('optgroup')].map((group) => group.label),
      triggerGroups: [...document.getElementById('trigger-category').querySelectorAll('optgroup')].map((group) => group.label),
      conditionGroups: [...document.getElementById('condition-category').querySelectorAll('optgroup')].map((group) => group.label),
    };
  })()`);
  for (const category of ['layer', 'rec', 'recstate', 'play', 'playstate', 'stat']) {
    const at = batch4Order.keys.indexOf(category);
    assert.ok(at >= 0 && at < batch4Order.custom,
      `the ${category} category must be declared before the "Advanced" catch-all (got ${JSON.stringify(batch4Order.keys)})`);
  }
  for (const list of ['triggerGroups', 'conditionGroups']) {
    assert.ok(batch4Order[list].includes('Transport') && batch4Order[list].includes('Console'),
      `the watch pickers must draw the "Transport" and "Console" groups (got ${JSON.stringify(batch4Order[list])})`);
  }
  assert.ok(batch4Order.targetGroups.includes('Surface') && batch4Order.triggerGroups.includes('Surface'),
    `the "Surface" group must be drawn wherever the fader layers are offered (got ${JSON.stringify(batch4Order)})`);
  assert.ok(batch4Order.targetGroups.indexOf('Surface') < batch4Order.targetGroups.indexOf('Advanced')
    && batch4Order.targetGroups.indexOf('Transport') < batch4Order.targetGroups.indexOf('Advanced'),
  `Surface and Transport must be ordered before the catch-all (got ${JSON.stringify(batch4Order.targetGroups)})`);
  for (const list of ['target', 'trigger']) {
    assert.equal(batch4Catalogue[list].find((entry) => entry.key === 'layer')?.label, 'Fader Layers (7)',
      `the ${list} list must label the fader-layer category "Fader Layers" with its seven entries`);
    assert.equal(batch4Catalogue[list].find((entry) => entry.key === 'layer')?.group, 'Surface',
      `the ${list} list must file the fader layers under "Surface"`);
  }
  for (const [category, label] of [['rec', 'USB Recorder (1)'], ['recstate', 'USB Recorder State (1)'], ['play', 'USB Player (1)'], ['playstate', 'USB Player State (1)']]) {
    const list = category === 'recstate' || category === 'playstate' ? 'trigger' : 'target';
    assert.equal(batch4Catalogue[list].find((entry) => entry.key === category)?.label, label,
      `the ${list} list must label ${category} as the backend does (got "${batch4Catalogue[list].find((entry) => entry.key === category)?.label}")`);
  }
  assert.equal(batch4Catalogue.trigger.find((entry) => entry.key === 'stat')?.label, 'Console Status (1)',
    'the watch picker must label the desk status "Console Status"');
  assert.equal(batch4Catalogue.trigger.find((entry) => entry.key === 'stat')?.group, 'Console',
    'the desk status belongs in the "Console" group');

  // The keys themselves, read from the catalogue (a panel can hold a stored key the list cannot
  // explain, so the exact lists are read where they are declared, not from the select).
  const batch4Pairs = {
    rec: [['rec_action', 'Recorder Action'], ['rec_path', 'Recorder Destination'], ['rec_resolution', 'Recorder Bit Depth'], ['rec_channels', 'Recorder Tracks']],
    play: [['play_action', 'Player Action'], ['play_file', 'Player File'], ['play_repeat', 'Player Repeat']],
    layer: [['layer_select', 'Fader Layer']],
    recstate: [['rec_state', 'Recorder State'], ['rec_time', 'Recorder Time']],
    playstate: [['play_state', 'Player State'], ['play_position', 'Player Position']],
    stat: [['selected_strip', 'Selected Strip'], ['selected_page', 'Selected Page']],
  };
  for (const [rows, expected] of [
    [batch4Catalogue.recTarget, batch4Pairs.rec],
    [batch4Catalogue.playTarget, batch4Pairs.play],
    [batch4Catalogue.layerTarget, batch4Pairs.layer],
    [batch4Catalogue.recStateTrigger, batch4Pairs.recstate],
    [batch4Catalogue.playStateTrigger, batch4Pairs.playstate],
    [batch4Catalogue.statTrigger, batch4Pairs.stat],
  ]) {
    assert.deepEqual(rows.map((row) => row.key), expected.map((pair) => pair[0]),
      `the batch-4 lists must offer exactly the frozen keys (got ${JSON.stringify(rows.map((row) => row.key))})`);
    assert.deepEqual(rows.map((row) => row.label), expected.map((pair) => pair[1]),
      `the batch-4 keys must carry the frozen labels (got ${JSON.stringify(rows.map((row) => row.label))})`);
  }
  // The transport leaves are written, not reported; the state leaves the other way round. The flags
  // on the rows agree with the flags on the category — the same rule the selects filter on.
  for (const row of [...batch4Catalogue.recTarget, ...batch4Catalogue.playTarget]) {
    assert.equal(row.canTrigger, false, `${row.key} is written and never read back, so its row must not be watchable`);
  }
  for (const row of [...batch4Catalogue.recStateTrigger, ...batch4Catalogue.playStateTrigger, ...batch4Catalogue.statTrigger, ...batch4Catalogue.layerTrigger]) {
    assert.equal(row.canTrigger, true, `${row.key} is reported by the console, so its row must be watchable`);
  }
  assert.deepEqual(batch4Catalogue.recTrigger, [], 'the recorder leaves are not reported, so the trigger list must be empty');
  assert.deepEqual(batch4Catalogue.playTrigger, [], 'the player leaves are not reported, so the trigger list must be empty');
  assert.deepEqual(batch4Catalogue.layerTrigger, batch4Catalogue.layerTarget,
    'the console reports the fader layer, so its watch list is its write list');

  // The documented ranges: the whole numbers keep the `number` value kind so they still get the
  // ordered comparators, and each bound is Maillot's own.
  assert.deepEqual(
    batch4Catalogue.layerTarget[0] && [batch4Catalogue.layerTarget[0].argKind, batch4Catalogue.layerTarget[0].valueKind, batch4Catalogue.layerTarget[0].min, batch4Catalogue.layerTarget[0].max],
    ['int', 'number', 1, 22],
    `Fader Layer must be a whole number 1…22 (got ${JSON.stringify(batch4Catalogue.layerTarget[0])})`);
  const batch4Ranges = Object.fromEntries([...batch4Catalogue.recStateTrigger, ...batch4Catalogue.playStateTrigger, ...batch4Catalogue.statTrigger]
    .map((row) => [row.key, [row.valueKind, row.min, row.max, row.maxLen]]));
  assert.deepEqual(batch4Ranges.rec_time.slice(0, 3), ['number', 0, 1000000000],
    `Recorder Time must stay a number with the deliberately wide bound the backend carries (got ${JSON.stringify(batch4Ranges.rec_time)})`);
  assert.deepEqual(batch4Ranges.play_position.slice(0, 3), ['number', 0, 35999],
    `Player Position must be 0…35999 in 36000 steps (3060) (got ${JSON.stringify(batch4Ranges.play_position)})`);
  assert.deepEqual(batch4Ranges.selected_strip.slice(0, 3), ['number', 1, 76],
    `Selected Strip must be 1…76 (3096) (got ${JSON.stringify(batch4Ranges.selected_strip)})`);
  assert.deepEqual(batch4Ranges.selected_page.slice(0, 3), ['number', 0, 30],
    `Selected Page must be 0…30 (3097) (got ${JSON.stringify(batch4Ranges.selected_page)})`);
  assert.equal(batch4Ranges.play_position[3], null, 'Player Position has no documented length: it is a number, not text');
  const playFileRow = batch4Catalogue.playTarget.find((row) => row.key === 'play_file');
  assert.deepEqual([playFileRow.valueKind, playFileRow.maxLen], ['text', 256],
    `Player File is 256 characters of text (3051) (got ${JSON.stringify(playFileRow)})`);
  const recPathRow = batch4Catalogue.recTarget.find((row) => row.key === 'rec_path');
  assert.deepEqual([recPathRow.valueKind, recPathRow.maxLen], ['text', null],
    `Recorder Destination is text with no documented length (3072) (got ${JSON.stringify(recPathRow)})`);
  const playRepeatRow = batch4Catalogue.playTarget.find((row) => row.key === 'play_repeat');
  assert.deepEqual([playRepeatRow.valueKind, playRepeatRow.min, playRepeatRow.max], ['toggle', 0, 1],
    `Player Repeat is the 0/1 toggle of 3066 (got ${JSON.stringify(playRepeatRow)})`);
  assert.ok(batch4Catalogue.indexLess.includes('rec') && batch4Catalogue.indexLess.includes('recstate')
    && batch4Catalogue.indexLess.includes('play') && batch4Catalogue.indexLess.includes('playstate')
    && batch4Catalogue.indexLess.includes('stat'),
  `the transport and status nodes carry no id segment, so their ids must be seeded for the trigger panel (got ${JSON.stringify(batch4Catalogue.indexLess)})`);
  assert.ok(!batch4Catalogue.indexLess.includes('layer'),
    'the fader layers are addressed by a letter, not index-less: their id is the surface');

  // The closed lists, read from the page and driven through the target panel: a choice is never
  // typed, because a typo in an enum is a write the console ignores in silence.
  assert.deepEqual(batch4Catalogue.recTarget.find((row) => row.key === 'rec_action').options, ['STOP', 'REC', 'PAUSE', 'NEWFILE'],
    'Recorder Action must be the four documented actions (3071)');
  assert.deepEqual(batch4Catalogue.recTarget.find((row) => row.key === 'rec_resolution').options, ['16', '24'],
    'Recorder Bit Depth must be the documented 16 or 24 (3073)');
  assert.deepEqual(batch4Catalogue.recTarget.find((row) => row.key === 'rec_channels').options, ['2', '4'],
    'Recorder Tracks must be the documented 2 or 4 (3074)');
  assert.deepEqual(batch4Catalogue.playTarget.find((row) => row.key === 'play_action').options,
    ['IDLE', 'STOP', 'PLAY', 'PAUSE', 'NEXT', 'PREV', 'PLAYFILE'],
    'Player Action must be the seven documented actions (3053)');
  assert.deepEqual(batch4Catalogue.recStateTrigger.find((row) => row.key === 'rec_state').options, ['STOP', 'REC', 'PAUSE', 'ERROR'],
    'Recorder State must be the four states the recorder reports (3069)');
  assert.deepEqual(batch4Catalogue.playStateTrigger.find((row) => row.key === 'play_state').options, ['STOP', 'PLAY', 'PAUSE', 'ERROR'],
    'Player State must be the four states the player reports — PLAY, not REC (3055)');
  await setSelect('target-category', 'rec');
  await setSelect('target-parameter', 'rec_action');
  const recActionControl = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    return {
      values: [...document.getElementById('osc-value-options').options].map((option) => option.value),
      list: visible('osc-value-options'),
      number: visible('osc-value'),
      hint: document.getElementById('value-hint').textContent,
    };
  })()`);
  assert.deepEqual(recActionControl.values, ['STOP', 'REC', 'PAUSE', 'NEWFILE'],
    `the step panel must offer the four recorder actions as a list (got ${JSON.stringify(recActionControl.values)})`);
  assert.equal(recActionControl.list, true, 'a closed list must be offered as the list select');
  assert.equal(recActionControl.number, false, 'a closed list has no free number to type');
  assert.match(recActionControl.hint, /3071/, 'the recorder action hint must cite the documented leaf');
  // The player's list has seven entries, and the number the panel writes is the string the document
  // prints: 16/24 and 2/4 are choices, not numbers with a range.
  await setSelect('target-category', 'play');
  await setSelect('target-parameter', 'play_action');
  const playActionControl = await evaluate(`(() => ({
    values: [...document.getElementById('osc-value-options').options].map((option) => option.value),
    list: !document.getElementById('osc-value-options').classList.contains('hidden'),
  }))()`);
  assert.deepEqual(playActionControl.values, ['IDLE', 'STOP', 'PLAY', 'PAUSE', 'NEXT', 'PREV', 'PLAYFILE'],
    `the step panel must offer the seven player actions (got ${JSON.stringify(playActionControl.values)})`);
  for (const [key, expected] of [
    ['rec_resolution', ['16', '24']],
    ['rec_channels', ['2', '4']],
  ]) {
    await setSelect('target-category', 'rec');
    await setSelect('target-parameter', key);
    const values = await evaluate(`[...document.getElementById('osc-value-options').options].map((option) => option.value)`);
    assert.deepEqual(values, expected, `${key} must be the documented list (got ${JSON.stringify(values)})`);
  }
  // The fader layer: an integer 1…22, drawn as a number with its own bounds and the caveat the
  // document prints (1…7 settable, 1…6 on C, 8 and 9 a no-op).
  await setSelect('target-category', 'layer');
  await setSelect('target-parameter', 'layer_select');
  const layerControl = await evaluate(`(() => {
    const field = document.getElementById('osc-value');
    return { min: field.min, max: field.max, hint: document.getElementById('value-hint').textContent };
  })()`);
  assert.equal(layerControl.min, '1', `the fader layer starts at 1 (got ${layerControl.min})`);
  assert.equal(layerControl.max, '22', `the fader layer keeps the documented bound of 22 (got ${layerControl.max})`);
  assert.match(layerControl.hint, /1…7/, 'the layer hint must say which layers can really be set');
  assert.match(layerControl.hint, /1…6 on the centre/, 'the layer hint must keep the centre surface\'s own range (3299)');

  // ── The layer ids: 1 = L … 7 = VRT, and an eighth is refused ───────────────────────────────────
  //
  // `/$ctl/layer/L/sel` is addressed by a **letter** (3220 et al.) while the panel and the resolver
  // carry the number, so the field keeps the numeric grammar and the readout names the surface the
  // number means — exactly as talkback's 1 = A / 2 = B does. Without it the six layers after the
  // first are invisible to the operator.
  const layerIdsReadout = await evaluate(`(() => {
    const ids = document.getElementById('target-ids');
    const readout = document.getElementById('target-ids-destination');
    const show = (value) => {
      ids.value = value;
      ids.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        readout: readout.textContent,
        invalid: ids.classList.contains('is-invalid'),
        problem: document.getElementById('target-ids-problem')?.textContent || '',
      };
    };
    const named = {};
    for (const id of [1, 2, 3, 4, 5, 6, 7]) named[id] = show(String(id));
    return { named, eight: show('8'), range: show('1-7'), stray: show('') };
  })()`);
  const layerLetters = ['L', 'C', 'R', 'CMPCT', 'RCK', 'EXT', 'VRT'];
  layerLetters.forEach((letter, index) => {
    const seen = layerIdsReadout.named[index + 1];
    assert.equal(seen.readout, `Fader Layer ${letter}`,
      `layer id ${index + 1} must read as layer ${letter} (got "${seen.readout}")`);
    assert.equal(seen.invalid, false, `layer id ${index + 1} is one of the seven the console has`);
  });
  assert.equal(layerIdsReadout.range.readout, `Fader Layer ${layerLetters.join(', ')}`,
    `a range of layers must name every surface it addresses (got "${layerIdsReadout.range.readout}")`);
  assert.equal(layerIdsReadout.range.invalid, false, '1-7 is exactly the seven layers and must be accepted');
  assert.equal(layerIdsReadout.eight.invalid, true, 'layer id 8 must be refused: the node has seven entries');
  assert.match(layerIdsReadout.eight.problem, /layer only has 7/,
    `the refusal must say how many entries the category has (got "${layerIdsReadout.eight.problem}")`);
  assert.match(layerIdsReadout.eight.problem, /1 = L, 2 = C, 3 = R, 4 = CMPCT, 5 = RCK, 6 = EXT, 7 = VRT/,
    `the refusal must name the seven surfaces, so the operator can see which id they wanted (got "${layerIdsReadout.eight.problem}")`);
  assert.doesNotMatch(layerIdsReadout.eight.readout, /Fader Layer [A-Z]/,
    `no readout may claim a layer the console does not have (got "${layerIdsReadout.eight.readout}")`);
  assert.match(layerIdsReadout.stray.readout, /1 = L, 2 = C/,
    `a field with no usable id must still say how to address a layer (got "${layerIdsReadout.stray.readout}")`);
  // The same readout follows the trigger and the IF gate, and stays silent for a numbered category.
  const layerReadoutScope = await evaluate(`(() => {
    const set = (categoryId, idsId, readoutId, value, category) => {
      const select = document.getElementById(categoryId);
      select.value = category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const ids = document.getElementById(idsId);
      ids.value = value;
      ids.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById(readoutId).textContent;
    };
    return {
      trigger: set('trigger-category', 'trigger-ids', 'trigger-ids-destination', '2', 'layer'),
      condition: set('condition-category', 'condition-ids', 'condition-ids-destination', '4', 'layer'),
      channel: set('trigger-category', 'trigger-ids', 'trigger-ids-destination', '3', 'ch'),
    };
  })()`);
  assert.equal(layerReadoutScope.trigger, 'Fader Layer C', `the trigger panel must name layer C (got "${layerReadoutScope.trigger}")`);
  assert.equal(layerReadoutScope.condition, 'Fader Layer CMPCT', `the IF gate must name layer CMPCT (got "${layerReadoutScope.condition}")`);
  assert.equal(layerReadoutScope.channel, '', 'a numbered category has nothing to name: channel 3 is not "Channel C"');

  // ── The state keys are watched, and the numbers are typed ──────────────────────────────────────
  //
  // `rec_time` and `play_position` are reported as numbers, so they get the ordered comparators and
  // the numeric field with the documented bounds; the two `$actstate` lists are choices, and the two
  // status keys are whole numbers. A step is impossible on all of them: their categories are not in
  // the step destination list at all, which the assertions above already pin.
  await setSelect('trigger-category', 'recstate');
  await setSelect('trigger-parameter', 'rec_state');
  const recStateTrigger = await triggerControls();
  assert.deepEqual(recStateTrigger.operators, ['==', '!='],
    `a state is compared, never ordered (got ${JSON.stringify(recStateTrigger.operators)})`);
  assert.equal(recStateTrigger.options, true, 'Recorder State is a closed list of the four states');
  const recStateValues = await evaluate(`[...document.getElementById('trigger-options').options].map((option) => option.value)`);
  assert.deepEqual(recStateValues, ['STOP', 'REC', 'PAUSE', 'ERROR'],
    `the trigger panel must offer the four recorder states (got ${JSON.stringify(recStateValues)})`);
  await setSelect('trigger-category', 'playstate');
  await setSelect('trigger-parameter', 'play_state');
  const playStateValues = await evaluate(`[...document.getElementById('trigger-options').options].map((option) => option.value)`);
  assert.deepEqual(playStateValues, ['STOP', 'PLAY', 'PAUSE', 'ERROR'],
    `the player reports PLAY where the recorder reports REC (got ${JSON.stringify(playStateValues)})`);
  await setSelect('trigger-parameter', 'play_position');
  const playPositionTrigger = await triggerControls();
  assert.deepEqual(playPositionTrigger.operators, ['<', '>', '==', '!='],
    `a position is ordered (got ${JSON.stringify(playPositionTrigger.operators)})`);
  assert.equal(playPositionTrigger.number, true, 'Player Position must be typed as a number');
  const playPositionBounds = await evaluate(`(() => {
    const field = document.getElementById('threshold');
    return { min: field.min, max: field.max };
  })()`);
  assert.deepEqual(playPositionBounds, { min: '0', max: '35999' },
    `Player Position must carry the documented 0…35999 bounds (got ${JSON.stringify(playPositionBounds)})`);
  await setSelect('trigger-category', 'recstate');
  await setSelect('trigger-parameter', 'rec_time');
  const recTimeBounds = await evaluate(`(() => {
    const field = document.getElementById('threshold');
    return { min: field.min, max: field.max };
  })()`);
  assert.deepEqual(recTimeBounds, { min: '0', max: '1000000000' },
    `Recorder Time carries no documented range, so the field keeps the backend's wide bound (got ${JSON.stringify(recTimeBounds)})`);
  await setSelect('trigger-category', 'stat');
  await setSelect('trigger-parameter', 'selected_strip');
  const stripBounds = await evaluate(`(() => {
    const field = document.getElementById('threshold');
    return { min: field.min, max: field.max };
  })()`);
  assert.deepEqual(stripBounds, { min: '1', max: '76' },
    `Selected Strip must be 1…76 (3096) (got ${JSON.stringify(stripBounds)})`);
  await setSelect('trigger-parameter', 'selected_page');
  const pageBounds = await evaluate(`(() => {
    const field = document.getElementById('threshold');
    return { min: field.min, max: field.max };
  })()`);
  assert.deepEqual(pageBounds, { min: '0', max: '30' },
    `Selected Page must be 0…30 (3097) (got ${JSON.stringify(pageBounds)})`);
  // Picking an index-less category seeds the trigger's id, or the backend refuses the macro as
  // unconfigured before the resolver ever ignores the list.
  const batch4Seeded = await evaluate(`(() => {
    const seed = (categoryId, idsId, category) => {
      const field = document.getElementById(idsId);
      field.value = '';
      const select = document.getElementById(categoryId);
      select.value = category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return field.value;
    };
    return {
      recstate: seed('trigger-category', 'trigger-ids', 'recstate'),
      playstate: seed('condition-category', 'condition-ids', 'playstate'),
      stat: seed('trigger-category', 'trigger-ids', 'stat'),
    };
  })()`);
  for (const [name, seeded] of Object.entries(batch4Seeded)) {
    assert.ok(String(seeded).trim().length > 0,
      `picking the index-less ${name} must seed the ids field, or the backend refuses the macro (got "${seeded}")`);
  }
  // The grouped picker files the new keys where their vocabulary says they belong: the transport
  // under "Transport", the layer under "Surface" and the desk status under "Console" — none of them
  // in the catch-all.
  const batch4MenuGroups = await evaluate(`(() => {
    const path = (key) => parameterMenuPath({ value: key, info: {} }).map((group) => group.key).join('/');
    return {
      recAction: path('rec_action'), recPath: path('rec_path'), recResolution: path('rec_resolution'), recChannels: path('rec_channels'),
      recState: path('rec_state'), recTime: path('rec_time'),
      playAction: path('play_action'), playFile: path('play_file'), playRepeat: path('play_repeat'),
      playState: path('play_state'), playPosition: path('play_position'),
      layer: path('layer_select'), strip: path('selected_strip'), page: path('selected_page'),
    };
  })()`);
  for (const key of ['recAction', 'recPath', 'recResolution', 'recChannels', 'recState', 'recTime', 'playAction', 'playFile', 'playRepeat', 'playState', 'playPosition']) {
    assert.equal(batch4MenuGroups[key], 'transport',
      `${key} must be filed under the Transport heading (got "${batch4MenuGroups[key]}")`);
  }
  assert.equal(batch4MenuGroups.layer, 'surface', `the fader layer belongs under "Surface" (got "${batch4MenuGroups.layer}")`);
  for (const key of ['strip', 'page']) {
    assert.equal(batch4MenuGroups[key], 'console',
      `${key} must be filed under the Console heading (got "${batch4MenuGroups[key]}")`);
  }
  // The write/watch split is the category flags, never a name list: flipping the two flags moves the
  // categories between the panels and restoring them puts the split back exactly as it was.
  const batch4FlagRule = await evaluate(`(() => {
    const keysOf = (id) => [...document.getElementById(id).querySelectorAll('option')]
      .filter((option) => option.value)
      .map((option) => option.value);
    const rec = targetCatalog.categories.find((category) => category.key === 'rec');
    const stat = targetCatalog.categories.find((category) => category.key === 'stat');
    const snapshot = () => ({ target: keysOf('target-category'), trigger: keysOf('trigger-category'), condition: keysOf('condition-category') });
    const before = snapshot();
    rec.canTrigger = true;
    stat.canTarget = true;
    populateCategorySelects();
    const flipped = snapshot();
    rec.canTrigger = false;
    stat.canTarget = false;
    populateCategorySelects();
    return { before, flipped, restored: snapshot() };
  })()`);
  assert.ok(!batch4FlagRule.before.trigger.includes('rec') && batch4FlagRule.flipped.trigger.includes('rec'),
    `the recorder must appear in the watch list only when its flag says so (before ${JSON.stringify(batch4FlagRule.before.trigger)}, flipped ${JSON.stringify(batch4FlagRule.flipped.trigger)})`);
  assert.ok(!batch4FlagRule.before.target.includes('stat') && batch4FlagRule.flipped.target.includes('stat'),
    `the desk status must appear in the step list only when its flag says so (before ${JSON.stringify(batch4FlagRule.before.target)}, flipped ${JSON.stringify(batch4FlagRule.flipped.target)})`);
  assert.deepEqual(batch4FlagRule.restored, batch4FlagRule.before,
    `restoring the flags must restore the split exactly (got ${JSON.stringify(batch4FlagRule.restored)})`);
  console.log('batch 4: transport, fader layers and console status contracts held against the fallback catalogue');

  // ── Batch 5: the strip long tail ───────────────────────────────────────────────────────────────
  //
  // Maillot's per-strip controls the reduced catalogue never offered: the input switches `srcauto`
  // (1937, 2210) and `bal` (1941, 2214), the `busmono` switch (2389, 2560, 2727), the PreSend EQ
  // (2013-2023), the filter node's two slopes, tool filter, model and tilt (1970-1979), the gate and
  // dynamics sidechains (2048-2055, 2130-2138), the compressor's detector, envelope and auto switch
  // (2113-2118 and the same three rows on bus, main and matrix), the process order (2003-2008), the
  // tags (2187) and the EQ family (2059-2094, 2262-2283, 2400-2442, 2571-2611, 2738-2782). These run
  // against the fallback catalogue — this page opens without an IPC stub, so what they drive IS the
  // standalone window — and hold it to the frozen keys, labels, kinds, ranges, option lists and
  // family gates the brief fixes.
  //
  // The per-family keys are the ones this section has to pin family by family, because a shared row
  // cannot say it: `eq_mix` is 0…125 % on ch, aux and mtx and 0…100 % on bus and main; the shelf
  // types are `PEQ, SHV` on ch, add `CUT` on aux and become the thirteen crossover types on
  // bus/main/matrix; the dynamics sidechain tap is the channel's eight-entry list on ch and the
  // desk's six-entry list on every other family, and its source list is the channel's SELF/CH.1…40
  // on ch and the desk's own SELF/BUS.1…AUX.8 on the other four.
  //
  // Two values are the console's own rather than the extracted table's, and both catalogues carry
  // them: the sidechain type `OFF` (2049, 2131 print `Off`, the `/ch/1` dump reports `gatesc.type=OFF`
  // and `dynsc.type=OFF`, scratch/wing_protocols.txt:958) and the channel sidechain source `SELF`
  // (2052 prints `SHELF`, the same dump reports `gatesc.src=SELF` and `dynsc.src=SELF`). A write of
  // the reference's spelling is one the console ignores in silence, which is the failure this whole
  // mirror exists to prevent.
  const batch5FrozenLists = {
    eqModelsCh: ['STD', 'SOUL', 'E88', 'E84', 'F110', 'PULSAR', 'MACH4'],
    eqModelsAux: ['STD', 'SOUL', 'E88', 'E84', 'F110', 'PULSAR'],
    eqModelsOut: ['STD', 'SOUL', 'E88', 'E84', 'F110', 'PULSAR', 'PIA'],
    shelfCh: ['PEQ', 'SHV'],
    shelfAux: ['PEQ', 'SHV', 'CUT'],
    crossover: ['PEQ', 'SHV', 'CUT', 'BW6', 'BW12', 'BS12', 'LR12', 'BW18', 'BW24', 'BS24', 'LR24', 'BW48', 'LR48'],
    tapsCh: ['IN', 'FILT', '3', '4', '5', 'PFL', 'AFL', 'POST'],
    tapsOther: ['BUS', 'DYN', 'PFL', 'AFL', 'EQ', 'INS2'],
    scTypes: ['OFF', 'LP12', 'HP12', 'BP', 'NOTCH'],
    // The console's own `/ch/1` dump reports `gatesc.src=SELF` and `dynsc.src=SELF` (scratch/
    // wing_protocols.txt:958), so the channel list opens with SELF and not with the `SHELF` row 2052
    // prints; a write of the reference's word would be ignored in silence.
    channelSources: ['SELF', ...Array.from({ length: 40 }, (_, index) => `CH.${index + 1}`)],
    // The desk-tapping list of the other four families (2319, 2483, 2658, 2828).
    mixSources: [
      'SELF',
      ...Array.from({ length: 16 }, (_, index) => `BUS.${index + 1}`),
      ...Array.from({ length: 4 }, (_, index) => `MAIN.${index + 1}`),
      ...Array.from({ length: 8 }, (_, index) => `MTX.${index + 1}`),
      ...Array.from({ length: 8 }, (_, index) => `AUX.${index + 1}`),
    ],
    detectors: ['PEAK', 'RMS'],
    envelopes: ['LIN', 'LOG'],
    filterModels: ['TILT', 'MAX', 'AP1', 'AP2'],
    hpfSlopes: ['6', '12', '18', '24'],
    lpfSlopes: ['6', '12'],
    processOrders: [
      'GEDI', 'GEID', 'GIED', 'IGED', 'GDEI', 'GDIE', 'GIDE', 'IGDE', 'EGDI', 'EGID', 'EIGD',
      'IEGD', 'EDGI', 'EDIG', 'EIDG', 'IEDG', 'DEGI', 'DEIG', 'DIEG', 'IDEG', 'DGEI', 'DGIE',
      'DIGE', 'IDGE',
    ],
  };
  /** The option list each batch-5 choice key carries in its shared row (the channel default). */
  const batch5FrozenOptions = {
    flt_low_slope: batch5FrozenLists.hpfSlopes,
    flt_high_slope: batch5FrozenLists.lpfSlopes,
    flt_model: batch5FrozenLists.filterModels,
    dyn_detector: batch5FrozenLists.detectors,
    dyn_envelope: batch5FrozenLists.envelopes,
    gate_sc_type: batch5FrozenLists.scTypes,
    gate_sc_source: batch5FrozenLists.channelSources,
    gate_sc_tap: batch5FrozenLists.tapsCh,
    dyn_sc_type: batch5FrozenLists.scTypes,
    dyn_sc_source: batch5FrozenLists.channelSources,
    proc_order: batch5FrozenLists.processOrders,
    eq_model: batch5FrozenLists.eqModelsCh,
    eq_low_type: batch5FrozenLists.shelfCh,
    eq_high_type: batch5FrozenLists.shelfCh,
    dyn_sc_tap: batch5FrozenLists.tapsCh,
  };
  /** Every batch-5 key with the label and controls the brief freezes for it. */
  const batch5FrozenRows = [
    { key: 'source_auto', label: 'Auto Source', argKind: 'int', valueKind: 'toggle', min: 0, max: 1 },
    { key: 'input_balance', label: 'Input Balance', argKind: 'float', valueKind: 'db', min: -9, max: 9 },
    { key: 'bus_mono', label: 'Bus Mono', argKind: 'int', valueKind: 'toggle', min: 0, max: 1 },
    { key: 'peq_on', label: 'PreSend EQ On', argKind: 'int', valueKind: 'toggle', min: 0, max: 1 },
    { key: 'peq_1_gain', label: 'PreSend EQ 1 Gain', argKind: 'float', valueKind: 'db', min: -15, max: 15 },
    { key: 'peq_1_freq', label: 'PreSend EQ 1 Frequency', argKind: 'float', valueKind: 'hz', min: 20, max: 20000 },
    { key: 'peq_1_q', label: 'PreSend EQ 1 Q', argKind: 'float', valueKind: 'number', min: 0.44, max: 10 },
    { key: 'peq_2_gain', label: 'PreSend EQ 2 Gain', argKind: 'float', valueKind: 'db', min: -15, max: 15 },
    { key: 'peq_2_freq', label: 'PreSend EQ 2 Frequency', argKind: 'float', valueKind: 'hz', min: 20, max: 20000 },
    { key: 'peq_2_q', label: 'PreSend EQ 2 Q', argKind: 'float', valueKind: 'number', min: 0.44, max: 10 },
    { key: 'peq_3_gain', label: 'PreSend EQ 3 Gain', argKind: 'float', valueKind: 'db', min: -15, max: 15 },
    { key: 'peq_3_freq', label: 'PreSend EQ 3 Frequency', argKind: 'float', valueKind: 'hz', min: 20, max: 20000 },
    { key: 'peq_3_q', label: 'PreSend EQ 3 Q', argKind: 'float', valueKind: 'number', min: 0.44, max: 10 },
    { key: 'flt_low_slope', label: 'HPF Slope', argKind: 'string', valueKind: 'enum' },
    { key: 'flt_high_slope', label: 'LPF Slope', argKind: 'string', valueKind: 'enum' },
    { key: 'flt_tool', label: 'Tool Filter', argKind: 'int', valueKind: 'toggle', min: 0, max: 1 },
    { key: 'flt_model', label: 'Filter Model', argKind: 'string', valueKind: 'enum' },
    { key: 'flt_tilt', label: 'Filter Tilt', argKind: 'float', valueKind: 'db', min: -6, max: 6 },
    { key: 'dyn_detector', label: 'Dynamics Detector', argKind: 'string', valueKind: 'enum' },
    { key: 'dyn_envelope', label: 'Dynamics Envelope', argKind: 'string', valueKind: 'enum' },
    { key: 'dyn_auto', label: 'Dynamics Auto', argKind: 'int', valueKind: 'toggle', min: 0, max: 1 },
    { key: 'gate_sc_type', label: 'Gate Sidechain Type', argKind: 'string', valueKind: 'enum' },
    { key: 'gate_sc_freq', label: 'Gate Sidechain Frequency', argKind: 'float', valueKind: 'hz', min: 20, max: 20000 },
    { key: 'gate_sc_q', label: 'Gate Sidechain Q', argKind: 'float', valueKind: 'number', min: 0.44, max: 10 },
    { key: 'gate_sc_source', label: 'Gate Sidechain Source', argKind: 'string', valueKind: 'enum' },
    { key: 'gate_sc_tap', label: 'Gate Sidechain Tap', argKind: 'string', valueKind: 'enum' },
    { key: 'dyn_sc_type', label: 'Dynamics Sidechain Type', argKind: 'string', valueKind: 'enum' },
    { key: 'dyn_sc_freq', label: 'Dynamics Sidechain Frequency', argKind: 'float', valueKind: 'hz', min: 20, max: 20000 },
    { key: 'dyn_sc_q', label: 'Dynamics Sidechain Q', argKind: 'float', valueKind: 'number', min: 0.44, max: 10 },
    { key: 'dyn_sc_source', label: 'Dynamics Sidechain Source', argKind: 'string', valueKind: 'enum' },
    { key: 'dyn_sc_tap', label: 'Dynamics Sidechain Tap', argKind: 'string', valueKind: 'enum' },
    { key: 'proc_order', label: 'Process Order', argKind: 'string', valueKind: 'enum' },
    { key: 'tags', label: 'Tags', argKind: 'string', valueKind: 'text', maxLen: 80 },
    { key: 'gate_mix', label: 'Gate Mix', argKind: 'float', valueKind: 'percent', min: 0, max: 100 },
    { key: 'gate_gain', label: 'Gate Gain', argKind: 'float', valueKind: 'db', min: -6, max: 12 },
    { key: 'gate_accent', label: 'Gate Accent', argKind: 'float', valueKind: 'number', min: 0, max: 100 },
    { key: 'eq_model', label: 'EQ Model', argKind: 'string', valueKind: 'enum' },
    { key: 'eq_mix', label: 'EQ Mix', argKind: 'float', valueKind: 'percent', min: 0, max: 125 },
    { key: 'eq_low_type', label: 'EQ Low Type', argKind: 'string', valueKind: 'enum' },
    { key: 'eq_high_type', label: 'EQ High Type', argKind: 'string', valueKind: 'enum' },
    { key: 'eq_tilt', label: 'EQ Tilt', argKind: 'float', valueKind: 'db', min: -6, max: 6 },
  ];
  /** Which families offer each batch-5 key, in the catalogue's own family order. */
  const batch5FrozenFamilies = {
    source_auto: ['ch', 'aux'],
    input_balance: ['ch', 'aux'],
    bus_mono: ['bus', 'main', 'matrix'],
    peq_on: ['ch'], peq_1_gain: ['ch'], peq_1_freq: ['ch'], peq_1_q: ['ch'],
    peq_2_gain: ['ch'], peq_2_freq: ['ch'], peq_2_q: ['ch'],
    peq_3_gain: ['ch'], peq_3_freq: ['ch'], peq_3_q: ['ch'],
    flt_low_slope: ['ch'], flt_high_slope: ['ch'], flt_tool: ['ch'], flt_model: ['ch'], flt_tilt: ['ch'],
    dyn_detector: ['ch', 'bus', 'main', 'matrix'],
    dyn_envelope: ['ch', 'bus', 'main', 'matrix'],
    dyn_auto: ['ch', 'bus', 'main', 'matrix'],
    gate_sc_type: ['ch'], gate_sc_freq: ['ch'], gate_sc_q: ['ch'], gate_sc_source: ['ch'], gate_sc_tap: ['ch'],
    // The dynamics sidechain exists on every mix family (2130-2138, 2315-2323, 2478-2487, 2653-2662,
    // 2823-2832); the reference prints the channel's gate sidechain only, and a channel is the only
    // family with a gate, which is why `gate_sc_*` above stays on `ch`.
    dyn_sc_type: ['ch', 'aux', 'bus', 'main', 'matrix'],
    dyn_sc_freq: ['ch', 'aux', 'bus', 'main', 'matrix'],
    dyn_sc_q: ['ch', 'aux', 'bus', 'main', 'matrix'],
    dyn_sc_source: ['ch', 'aux', 'bus', 'main', 'matrix'],
    dyn_sc_tap: ['ch', 'aux', 'bus', 'main', 'matrix'],
    proc_order: ['ch'],
    tags: ['ch', 'aux', 'bus', 'main', 'matrix'],
    gate_mix: ['ch'], gate_gain: ['ch'], gate_accent: ['ch'],
    eq_model: ['ch', 'aux', 'bus', 'main', 'matrix'],
    eq_mix: ['ch', 'aux', 'bus', 'main', 'matrix'],
    eq_low_type: ['ch', 'aux', 'bus', 'main', 'matrix'],
    eq_high_type: ['ch', 'aux', 'bus', 'main', 'matrix'],
    eq_tilt: ['bus', 'main', 'matrix'],
  };
  const batch5Catalogue = await evaluate(`(() => {
    const rows = (source, category) => (targetCatalog[source]?.[category] || []).map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      argKind: parameter.argKind,
      valueKind: parameter.valueKind,
      unit: parameter.unit || '',
      min: parameter.min ?? null,
      max: parameter.max ?? null,
      maxLen: parameter.maxLen ?? null,
      options: [...(parameter.options || [])],
      modelSection: parameter.modelSection || null,
      modelLeaf: parameter.modelLeaf || null,
      continuous: isContinuousParameter(parameter),
    }));
    const all = {};
    for (const family of FALLBACK_MIX_FAMILIES) {
      all[family] = rows('targetParametersByCategory', family);
    }
    const familiesOf = (key) => FALLBACK_MIX_FAMILIES
      .filter((family) => (targetCatalog.targetParametersByCategory[family] || []).some((row) => row.key === key));
    const triggerRow = (family, key) => (targetCatalog.triggerParametersByCategory[family] || [])
      .find((row) => row.key === key) || null;
    const keys = Object.keys(${JSON.stringify(batch5FrozenFamilies)});
    return {
      rows: all,
      families: Object.fromEntries(keys.map((key) => [key, familiesOf(key)])),
      eqMixTrigger: {
        ch: triggerRow('ch', 'eq_mix') ? { min: triggerRow('ch', 'eq_mix').min, max: triggerRow('ch', 'eq_mix').max } : null,
        bus: triggerRow('bus', 'eq_mix') ? { min: triggerRow('bus', 'eq_mix').min, max: triggerRow('bus', 'eq_mix').max } : null,
      },
      dynScTapTrigger: {
        ch: triggerRow('ch', 'dyn_sc_tap') ? [...triggerRow('ch', 'dyn_sc_tap').options] : null,
        bus: triggerRow('bus', 'dyn_sc_tap') ? [...triggerRow('bus', 'dyn_sc_tap').options] : null,
      },
      menu: Object.fromEntries(keys.map((key) => [
        key,
        parameterMenuPath({ value: key, info: {} }).map((group) => group.key).join('/'),
      ])),
      processOrders: [...FALLBACK_PROCESS_ORDERS],
      channelSources: [...FALLBACK_CHANNEL_SC_SOURCES],
      mixSources: [...FALLBACK_MIX_SC_SOURCES],
    };
  })()`);
  /** One family's row for a batch-5 key, or `null` when that family does not offer it. */
  const batch5RowOf = (family, key) =>
    batch5Catalogue.rows[family].find((row) => row.key === key) || null;
  // Every key, with the frozen label and the control it must carry.
  for (const frozen of batch5FrozenRows) {
    const row = batch5RowOf('ch', frozen.key) || batch5RowOf('bus', frozen.key);
    assert.ok(row, `the standalone catalogue must offer ${frozen.key} on the family the brief gives it`);
    assert.equal(row.label, frozen.label,
      `${frozen.key}: the label must be the frozen one (got ${JSON.stringify(row.label)})`);
    assert.equal(row.argKind, frozen.argKind,
      `${frozen.key}: the OSC argument kind must be ${frozen.argKind} (got ${JSON.stringify(row.argKind)})`);
    assert.equal(row.valueKind, frozen.valueKind,
      `${frozen.key}: the value kind must be ${frozen.valueKind} (got ${JSON.stringify(row.valueKind)})`);
    if (frozen.min !== undefined) {
      assert.equal(row.min, frozen.min,
        `${frozen.key}: min must be ${frozen.min} (got ${JSON.stringify(row.min)})`);
    }
    if (frozen.max !== undefined) {
      assert.equal(row.max, frozen.max,
        `${frozen.key}: max must be ${frozen.max} (got ${JSON.stringify(row.max)})`);
    }
    if (frozen.maxLen !== undefined) {
      assert.equal(row.maxLen, frozen.maxLen,
        `${frozen.key}: the documented length must be ${frozen.maxLen} (got ${JSON.stringify(row.maxLen)})`);
    }
  }
  // The frozen option lists, on the channel row that is the shared default for the per-family keys.
  for (const [key, expected] of Object.entries(batch5FrozenOptions)) {
    const row = batch5RowOf('ch', key);
    assert.ok(row, `${key} must be offered on a channel`);
    assert.deepEqual(row.options, expected,
      `${key}: the channel row must carry the documented list (got ${JSON.stringify(row.options)})`);
  }
  // The twenty-four process orders are a closed list, and they really are the four processors in
  // every order: 24 permutations, each using G, E, D and I exactly once.
  assert.deepEqual(batch5Catalogue.processOrders, batch5FrozenLists.processOrders,
    `the process order list must be the twenty-four documented orders (got ${JSON.stringify(batch5Catalogue.processOrders)})`);
  assert.equal(new Set(batch5Catalogue.processOrders).size, 24,
    'the twenty-four process orders must be twenty-four distinct values');
  for (const order of batch5Catalogue.processOrders) {
    assert.match(order, /^[GEDI]{4}$/,
      `a process order names the four processors (got ${JSON.stringify(order)})`);
    assert.equal(new Set(order).size, 4,
      `a process order uses each of G, E, D and I exactly once (got ${JSON.stringify(order)})`);
  }
  // The two sidechain source lists: the console takes the names, so each is written out — the
  // channel's one name plus its forty channels, and the desk-tapping family's own name, sixteen
  // buses, four mains, eight matrices and eight auxes.
  assert.deepEqual(batch5Catalogue.channelSources, batch5FrozenLists.channelSources,
    `the channel sidechain sources must be SELF and CH.1…CH.40 (got ${JSON.stringify(batch5Catalogue.channelSources)})`);
  assert.deepEqual(batch5Catalogue.mixSources, batch5FrozenLists.mixSources,
    `the desk-tapping sidechain sources must be SELF, BUS.1…16, MAIN.1…4, MTX.1…8 and AUX.1…8 (got ${JSON.stringify(batch5Catalogue.mixSources)})`);
  assert.equal(batch5Catalogue.channelSources.length, 41,
    `a channel sidechain source list is a name and forty channels (got ${batch5Catalogue.channelSources.length} entries)`);
  assert.equal(batch5Catalogue.mixSources.length, 37,
    `the desk-tapping list is a name and thirty-six destinations (got ${batch5Catalogue.mixSources.length} entries)`);
  // ── The per-family values ──────────────────────────────────────────────────────────────────────
  //
  // One shared row per key plus the overlay the catalogue applies per family: the range and the
  // option list a family really documents, never a union the console ignores.
  for (const [family, expected] of [
    ['ch', { min: 0, max: 125 }], ['aux', { min: 0, max: 125 }], ['matrix', { min: 0, max: 125 }],
    ['bus', { min: 0, max: 100 }], ['main', { min: 0, max: 100 }],
  ]) {
    const row = batch5RowOf(family, 'eq_mix');
    assert.ok(row, `EQ Mix must be offered on ${family}`);
    assert.deepEqual({ min: row.min, max: row.max }, expected,
      `eq_mix on ${family} must be ${expected.min}…${expected.max} (got ${row.min}…${row.max})`);
  }
  for (const key of ['eq_low_type', 'eq_high_type']) {
    assert.deepEqual(batch5RowOf('ch', key).options, batch5FrozenLists.shelfCh,
      `${key} on a channel must be PEQ or SHV (2069, 2094)`);
    assert.deepEqual(batch5RowOf('aux', key).options, batch5FrozenLists.shelfAux,
      `${key} on an aux must add CUT (2262, 2283)`);
    for (const family of ['bus', 'main', 'matrix']) {
      assert.deepEqual(batch5RowOf(family, key).options, batch5FrozenLists.crossover,
        `${key} on a ${family} must be the thirteen crossover types (2405, 2442, 2577, 2611, 2781, 2782)`);
    }
  }
  assert.deepEqual(batch5RowOf('ch', 'eq_model').options, batch5FrozenLists.eqModelsCh,
    'a channel EQ carries MACH4 (2059)');
  assert.deepEqual(batch5RowOf('aux', 'eq_model').options, batch5FrozenLists.eqModelsAux,
    'an aux EQ documents the six models without MACH4 (2257)');
  for (const family of ['bus', 'main', 'matrix']) {
    assert.deepEqual(batch5RowOf(family, 'eq_model').options, batch5FrozenLists.eqModelsOut,
      `a ${family} EQ carries PIA where a channel carries MACH4 (2400, 2571, 2738)`);
  }
  assert.deepEqual(batch5RowOf('ch', 'dyn_sc_tap').options, batch5FrozenLists.tapsCh,
    'a channel taps its own strip (2136)');
  for (const family of ['aux', 'bus', 'main', 'matrix']) {
    assert.deepEqual(batch5RowOf(family, 'dyn_sc_tap').options, batch5FrozenLists.tapsOther,
      `a ${family} taps the desk instead (2322, 2486, 2661, 2831)`);
  }
  assert.deepEqual(batch5RowOf('ch', 'dyn_sc_source').options, batch5FrozenLists.channelSources,
    'a channel sidechain listens to SELF and the forty channels (2135, 958)');
  for (const family of ['aux', 'bus', 'main', 'matrix']) {
    assert.deepEqual(batch5RowOf(family, 'dyn_sc_source').options, batch5FrozenLists.mixSources,
      `a ${family} sidechain taps the desk, so its own source list is the desk's (2319, 2483, 2658, 2828)`);
  }
  // The overlay is applied where the family's list is built, so the trigger and the IF gate read the
  // same overridden row as the step list: a bus watch on `eq_mix` compares against 0…100, not 125.
  assert.deepEqual(batch5Catalogue.eqMixTrigger,
    { ch: { min: 0, max: 125 }, bus: { min: 0, max: 100 } },
    `the watch list must carry the family's own eq_mix range (got ${JSON.stringify(batch5Catalogue.eqMixTrigger)})`);
  assert.deepEqual(batch5Catalogue.dynScTapTrigger,
    { ch: batch5FrozenLists.tapsCh, bus: batch5FrozenLists.tapsOther },
    `the watch list must carry the family's own sidechain tap list (got ${JSON.stringify(batch5Catalogue.dynScTapTrigger)})`);
  // ── The family gates ───────────────────────────────────────────────────────────────────────────
  for (const [key, expected] of Object.entries(batch5FrozenFamilies)) {
    assert.deepEqual(batch5Catalogue.families[key], expected,
      `${key} must be offered on ${JSON.stringify(expected)} and nowhere else (got ${JSON.stringify(batch5Catalogue.families[key])})`);
  }
  // ── The model-dependent keys ───────────────────────────────────────────────────────────────────
  //
  // These seven keys are leaves *inside* the model the strip runs — `gate_mix`/`gate_gain`/
  // `gate_accent` in the gate slot (`/gate/mix`, `/gate/gain`, `/gate/acc`), `dyn_detector`/
  // `dyn_envelope`/`dyn_auto` in the dynamics slot (`/dyn/det`, `/dyn/env`, `/dyn/auto`) and
  // `eq_tilt` in the EQ slot (`/eq/tilt`, which footnote 35 prints for the STD model) — so their rows
  // name the slot and the editor reports the model its own read filed for the strip; it never judges
  // the model. `eq_model` is the model selector itself: its row must name no slot, exactly as
  // `gate_type` and `comp_type` do not, because the appendix tables exclude `mdl` and a slot on it
  // would make the backend refuse every step that selects a model.
  assert.deepEqual(
    ['gate_mix', 'gate_gain', 'gate_accent', 'dyn_detector', 'dyn_envelope', 'dyn_auto', 'eq_tilt', 'eq_model'].map((key) => {
      const row = batch5RowOf('ch', key) || batch5RowOf('bus', key);
      return [key, row.modelSection, row.modelLeaf];
    }),
    [
      ['gate_mix', 'gate', 'mix'],
      ['gate_gain', 'gate', 'gain'],
      ['gate_accent', 'gate', 'acc'],
      ['dyn_detector', 'dyn', 'det'],
      ['dyn_envelope', 'dyn', 'env'],
      ['dyn_auto', 'dyn', 'auto'],
      ['eq_tilt', 'eq', 'tilt'],
      ['eq_model', null, null],
    ],
    'the seven model leaves must name their slot and the EQ model selector must name none',
  );
  // A fade ramps a float leaf only, and the model-dependent keys are no exception: the three gate
  // leaves are floats and keep it, while an on/off, a model selector, a closed list and free text do
  // not get one however numeric their wording looks.
  const batch5Fade = await evaluate(`(() => {
    const category = document.getElementById('target-category');
    const parameter = document.getElementById('target-parameter');
    const mode = document.getElementById('action-mode');
    const fade = mode.querySelector('option[value="fade"]');
    category.value = 'ch';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const read = (key) => {
      parameter.value = key;
      parameter.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        fadeDisabled: fade.disabled,
        fadeHidden: fade.hidden,
        addButton: document.getElementById('add-fade-step').disabled,
      };
    };
    const result = {
      mix: read('gate_mix'),
      gain: read('gate_gain'),
      accent: read('gate_accent'),
      auto: read('dyn_auto'),
      model: read('eq_model'),
      order: read('proc_order'),
      tags: read('tags'),
    };
    parameter.value = 'mute';
    parameter.dispatchEvent(new Event('change', { bubbles: true }));
    return result;
  })()`);
  for (const key of ['mix', 'gain', 'accent']) {
    assert.equal(batch5Fade[key].fadeDisabled, false,
      `${key} is a float leaf and keeps its fade (got disabled ${batch5Fade[key].fadeDisabled})`);
    assert.equal(batch5Fade[key].addButton, false,
      `the fade step button must stay enabled for ${key}`);
  }
  for (const [key, what] of [['auto', 'an on/off switch'], ['model', 'a model selector'], ['order', 'a closed list'], ['tags', 'free text']]) {
    assert.equal(batch5Fade[key].fadeDisabled, true,
      `${key} is ${what} and must not be offered a fade`);
    assert.equal(batch5Fade[key].fadeHidden, true,
      `the Fade option must be hidden, not merely disabled, for ${key}`);
    assert.equal(batch5Fade[key].addButton, true,
      `the fade step button must be disabled for ${key}`);
  }
  // ── The picker ─────────────────────────────────────────────────────────────────────────────────
  //
  // The grouped picker files the whole long tail by rule: the filter node under Filters, the PreSend
  // EQ beside the EQ with its own band submenu, the gate and dynamics sidechains under the processor
  // they belong to, the input switches under Input and the strip's own switches under Level &
  // routing. Not one batch-5 key may land in the catch-all.
  for (const [key, expected] of Object.entries({
    source_auto: 'input', input_balance: 'input',
    bus_mono: 'level', tags: 'level',
    peq_on: 'eq', peq_1_gain: 'eq/peq_bands', peq_2_q: 'eq/peq_bands', peq_3_freq: 'eq/peq_bands',
    eq_model: 'eq', eq_mix: 'eq', eq_low_type: 'eq/eq_bands', eq_high_type: 'eq/eq_bands', eq_tilt: 'eq',
    flt_low_slope: 'filters', flt_high_slope: 'filters', flt_tool: 'filters', flt_model: 'filters', flt_tilt: 'filters',
    gate_mix: 'gate', gate_gain: 'gate', gate_accent: 'gate',
    gate_sc_type: 'gate', gate_sc_freq: 'gate', gate_sc_q: 'gate', gate_sc_source: 'gate', gate_sc_tap: 'gate',
    dyn_detector: 'dynamics', dyn_envelope: 'dynamics', dyn_auto: 'dynamics',
    dyn_sc_type: 'dynamics', dyn_sc_freq: 'dynamics', dyn_sc_q: 'dynamics', dyn_sc_source: 'dynamics', dyn_sc_tap: 'dynamics',
    proc_order: 'insert',
  })) {
    assert.equal(batch5Catalogue.menu[key], expected,
      `${key} must be filed under "${expected}" (got ${JSON.stringify(batch5Catalogue.menu[key])})`);
  }
  for (const [key, path] of Object.entries(batch5Catalogue.menu)) {
    assert.notEqual(path, 'other',
      `${key} fell into the picker's catch-all, which is what this batch must not do`);
  }
  console.log('batch 5: the strip long tail held against the fallback catalogue, family by family');

  // ── Batch 6: the desk level ────────────────────────────────────────────────────────────────────
  //
  // Console lights (`/$ctl/cfg/lights/*`, 3128-3145), the safes (`/$ctl/safes/*`, 4016-4067), the two
  // monitor buses (`/cfg/mon/1|2/*`, 1314-1378), the solo configuration (`/cfg/solo/*`, 1380-1394),
  // the AES50 ports (`/$stat/<A|B|C>/*`, 1253-1272), the desk status (`/$stat/{lock,ppm}`, 1274-1275),
  // the W-Live card (`/cards/wlive/<n>/*`, 2966-2991), the cards node (`/cards/$type|$ver`,
  // 2950-2954) and the global settings (`/$globals/*`, 4169-4186). Like every batch before it this
  // runs against the fallback catalogue — the page opens without an IPC stub, so what it drives IS the
  // standalone window — and holds it to the frozen keys, labels, kinds, ranges, lists and the
  // write/watch split the categories and their two parameter lists carry.
  //
  // Two shapes are new here. The safes are **strings** of `+`/space with a documented length per
  // scope, so each is a text row with that `maxLen` and never a number; and the AES50 ports are
  // addressed by the **letter** A/B/C while the panel keeps the numbers 1…3, so the id readout has to
  // name the port a number means (the seam talkback and the fader layers opened).
  const batch6CategoryKeys = ['lights', 'safes', 'monbus', 'solocfg', 'aes50', 'deskstatus', 'wlive', 'cards', 'globals'];
  // The frozen key sets, in the document's own order. The step list of a category that also carries
  // read-only rows comes first and those rows follow it, which is how the backend's
  // `desk_level_watch_parameters` builds the watch list too.
  const batch6KeysByCategory = {
    lights: ['lights_btns', 'lights_leds', 'lights_meters', 'lights_rgbleds', 'lights_chlcds', 'lights_chlcdctr', 'lights_chedit', 'lights_main', 'lights_glow', 'lights_patch', 'lights_lamp'],
    safes: ['safes_ch', 'safes_aux', 'safes_bus', 'safes_main', 'safes_mtx', 'safes_dca', 'safes_mute', 'safes_fx',
      'safes_source_lcl', 'safes_source_aux', 'safes_source_a', 'safes_source_b', 'safes_source_c', 'safes_source_sc',
      'safes_source_usb', 'safes_source_crd', 'safes_source_mod', 'safes_source_play', 'safes_source_aes',
      'safes_source_usr', 'safes_source_osc',
      'safes_output_lcl', 'safes_output_aux', 'safes_output_a', 'safes_output_b', 'safes_output_c', 'safes_output_sc',
      'safes_output_usb', 'safes_output_crd', 'safes_output_mod', 'safes_output_rec', 'safes_output_aes',
      'safes_area_left', 'safes_area_center', 'safes_area_right', 'safes_area_compact', 'safes_area_rack',
      'safes_area_extern', 'safes_area_virtual', 'safes_custom', 'safes_setup'],
    monbus: ['monitor_invert', 'monitor_pan', 'monitor_width', 'monitor_eq_on', 'monitor_eq_low_gain',
      'monitor_eq_low_freq',
      'monitor_eq_1_gain', 'monitor_eq_1_freq', 'monitor_eq_1_q', 'monitor_eq_2_gain', 'monitor_eq_2_freq', 'monitor_eq_2_q',
      'monitor_eq_3_gain', 'monitor_eq_3_freq', 'monitor_eq_3_q', 'monitor_eq_4_gain', 'monitor_eq_4_freq', 'monitor_eq_4_q',
      'monitor_eq_5_gain', 'monitor_eq_5_freq', 'monitor_eq_5_q', 'monitor_eq_6_gain', 'monitor_eq_6_freq', 'monitor_eq_6_q',
      'monitor_eq_high_gain', 'monitor_eq_high_freq', 'monitor_limiter', 'monitor_delay_on', 'monitor_delay',
      'monitor_dim', 'monitor_pfl_dim', 'monitor_band_solo_trim', 'monitor_source_level', 'monitor_source_mix',
      'monitor_source', 'monitor_direct_in', 'monitor_tags', 'monitor_level', 'monitor_active_level'],
    solocfg: ['solo_mode', 'solo_monitor', 'solo_mute', 'solo_dim', 'solo_mono', 'solo_flip', 'solo_channel_tap',
      'solo_bus_tap', 'solo_main_tap', 'solo_matrix_tap', 'solo_source', 'solo_source_state', 'solo_source_group',
      'solo_source_input'],
    aes50: ['aes50_clear_errors', 'aes50_state', 'aes50_device', 'aes50_errors_corrected', 'aes50_errors_uncorrected'],
    deskstatus: ['desk_lock', 'desk_ppm'],
    wlive: ['wlive_control', 'wlive_open_session', 'wlive_marker_edit', 'wlive_marker_goto', 'wlive_marker_delete',
      'wlive_session_delete', 'wlive_time', 'wlive_session_name', 'wlive_marker_set', 'wlive_format_card',
      'wlive_state'],
    cards: ['cards_type', 'cards_version'],
    globals: ['global_clock_rate', 'global_clock_source', 'global_start_mute', 'global_usb_config', 'global_stageconnect_config'],
  };
  // The safe lengths, byte for byte from the block (4017-4067), `custom` and `setup` included: the
  // block gives each a documented length and calls it a mask over the items of its area.
  const batch6SafeLengths = {
    safes_ch: 40, safes_aux: 8, safes_bus: 16, safes_main: 4, safes_mtx: 8, safes_dca: 16, safes_mute: 8, safes_fx: 16,
    safes_source_lcl: 24, safes_source_aux: 8, safes_source_a: 48, safes_source_b: 48, safes_source_c: 48,
    safes_source_sc: 32, safes_source_usb: 48, safes_source_crd: 64, safes_source_mod: 64, safes_source_play: 4,
    safes_source_aes: 2, safes_source_usr: 48, safes_source_osc: 2,
    safes_output_lcl: 8, safes_output_aux: 8, safes_output_a: 48, safes_output_b: 48, safes_output_c: 48,
    safes_output_sc: 32, safes_output_usb: 48, safes_output_crd: 64, safes_output_mod: 64, safes_output_rec: 4,
    safes_output_aes: 2,
    safes_area_left: 7, safes_area_center: 6, safes_area_right: 7, safes_area_compact: 9, safes_area_rack: 5,
    safes_area_extern: 8, safes_area_virtual: 8, safes_custom: 31, safes_setup: 3,
  };
  const batch6MonitorSources = [
    'OFF',
    ...Array.from({ length: 4 }, (_, index) => `MAIN.${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `MTX.${index + 1}`),
    ...Array.from({ length: 16 }, (_, index) => `BUS.${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `AUX.${index + 1}`),
  ];
  const batch6MonitorDirectIns = [
    'OFF',
    ...Array.from({ length: 40 }, (_, index) => `CH.${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `AUX.${index + 1}`),
    ...Array.from({ length: 16 }, (_, index) => `BUS.${index + 1}`),
    ...Array.from({ length: 4 }, (_, index) => `MAIN.${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `MTX.${index + 1}`),
  ];
  const batch6StageConnectConfigs = ['AUTO', ...Array.from({ length: 33 }, (_, index) => `${index}/${32 - index}`)];
  const batch6Catalogue = await evaluate(`(() => {
    const keysOf = (id) => [...document.getElementById(id).querySelectorAll('option')]
      .filter((option) => option.value)
      .map((option) => option.value);
    const groupsOf = (id) => [...document.getElementById(id).querySelectorAll('optgroup')].map((group) => group.label);
    const rows = (map, category) => (targetCatalog[map]?.[category] || []).map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      argKind: parameter.argKind,
      valueKind: parameter.valueKind,
      unit: parameter.unit || '',
      canTrigger: parameter.canTrigger,
      offLabel: parameter.offLabel ?? null,
      onLabel: parameter.onLabel ?? null,
      defaultValue: parameter.defaultValue ?? null,
      min: parameter.min ?? null,
      max: parameter.max ?? null,
      maxLen: parameter.maxLen ?? null,
      options: [...(parameter.options || [])],
    }));
    return {
      categories: targetCatalog.categories
        .filter((category) => ${JSON.stringify(batch6CategoryKeys)}.includes(category.key))
        .map((category) => ({
          key: category.key, label: category.label, group: category.group, count: category.count,
          prefix: category.prefix, canTrigger: category.canTrigger, canTarget: category.canTarget,
        })),
      targetKeys: keysOf('target-category'),
      triggerKeys: keysOf('trigger-category'),
      conditionKeys: keysOf('condition-category'),
      targetGroups: groupsOf('target-category'),
      triggerGroups: groupsOf('trigger-category'),
      conditionGroups: groupsOf('condition-category'),
      lights: rows('targetParametersByCategory', 'lights'),
      safes: rows('targetParametersByCategory', 'safes'),
      monitorTarget: rows('targetParametersByCategory', 'monbus'),
      monitorTrigger: rows('triggerParametersByCategory', 'monbus'),
      soloTarget: rows('targetParametersByCategory', 'solocfg'),
      soloTrigger: rows('triggerParametersByCategory', 'solocfg'),
      aes50Target: rows('targetParametersByCategory', 'aes50'),
      aes50Trigger: rows('triggerParametersByCategory', 'aes50'),
      deskTrigger: rows('triggerParametersByCategory', 'deskstatus'),
      wliveTarget: rows('targetParametersByCategory', 'wlive'),
      wliveTrigger: rows('triggerParametersByCategory', 'wlive'),
      cardsTrigger: rows('triggerParametersByCategory', 'cards'),
      globalTarget: rows('targetParametersByCategory', 'globals'),
      globalTrigger: rows('triggerParametersByCategory', 'globals'),
      indexLess: [...INDEX_LESS_CATEGORIES],
      aes50Names: idDestinationNames('aes50'),
    };
  })()`);
  // The nine categories: labels, groups, counts, prefixes and both flags.
  assert.deepEqual(batch6Catalogue.categories, [
    { key: 'lights', label: 'Desk Lights', group: 'Console', count: 1, prefix: '/$ctl/cfg/lights', canTrigger: true, canTarget: true },
    { key: 'safes', label: 'Safes', group: 'Control', count: 1, prefix: '/$ctl/safes', canTrigger: true, canTarget: true },
    { key: 'monbus', label: 'Monitor Buses', group: 'Monitor', count: 2, prefix: '/cfg/mon', canTrigger: true, canTarget: true },
    { key: 'solocfg', label: 'Solo Configuration', group: 'Monitor', count: 1, prefix: '/cfg/solo', canTrigger: true, canTarget: true },
    { key: 'aes50', label: 'AES50 Status', group: 'Console', count: 3, prefix: '/$stat', canTrigger: true, canTarget: true },
    { key: 'deskstatus', label: 'Desk Status', group: 'Console', count: 1, prefix: '/$stat', canTrigger: true, canTarget: false },
    { key: 'wlive', label: 'W-Live Multitrack', group: 'Transport', count: 2, prefix: '/cards/wlive', canTrigger: true, canTarget: true },
    { key: 'cards', label: 'Cards', group: 'Transport', count: 1, prefix: '/cards', canTrigger: true, canTarget: false },
    { key: 'globals', label: 'Global Settings', group: 'Console', count: 1, prefix: '/$globals', canTrigger: true, canTarget: true },
  ], `the batch-6 categories must mirror the backend catalogue (got ${JSON.stringify(batch6Catalogue.categories)})`);
  // The two watch-only categories never reach the step list, and every writable one is offered there.
  for (const category of ['lights', 'safes', 'monbus', 'solocfg', 'aes50', 'wlive', 'globals']) {
    assert.ok(batch6Catalogue.targetKeys.includes(category),
      `${category} is written, so it must be a step destination (got ${JSON.stringify(batch6Catalogue.targetKeys)})`);
  }
  for (const watchOnly of ['deskstatus', 'cards']) {
    assert.ok(!batch6Catalogue.targetKeys.includes(watchOnly),
      `${watchOnly} is watch-only and must never be a step destination (got ${JSON.stringify(batch6Catalogue.targetKeys)})`);
    assert.ok(batch6Catalogue.triggerKeys.includes(watchOnly) && batch6Catalogue.conditionKeys.includes(watchOnly),
      `${watchOnly} must be offered as a trigger and as an IF gate (got ${JSON.stringify(batch6Catalogue)})`);
  }
  // The groups the two category pickers draw, and the order: every batch-6 category is declared
  // before the "Advanced" catch-all the custom category lives in.
  const batch6Order = await evaluate(`(() => {
    const keys = targetCatalog.categories.map((category) => category.key);
    return { keys, custom: keys.indexOf('custom') };
  })()`);
  for (const category of batch6CategoryKeys) {
    const at = batch6Order.keys.indexOf(category);
    assert.ok(at >= 0 && at < batch6Order.custom,
      `the ${category} category must be declared before the "Advanced" catch-all (got ${JSON.stringify(batch6Order.keys)})`);
  }
  for (const list of ['triggerGroups', 'conditionGroups']) {
    for (const group of ['Console', 'Control', 'Monitor', 'Transport']) {
      assert.ok(batch6Catalogue[list].includes(group),
        `the watch pickers must draw the "${group}" group (got ${JSON.stringify(batch6Catalogue[list])})`);
    }
  }
  assert.ok(batch6Catalogue.targetGroups.includes('Monitor') && batch6Catalogue.targetGroups.includes('Transport'),
    `the step picker must draw the desk-level groups (got ${JSON.stringify(batch6Catalogue.targetGroups)})`);
  // The keys, label by label. The lights carry the eleventh row the brief allowed only if the block
  // really has one: `chedit` is at 3141, between the LCD contrast and the touchscreen.
  assert.deepEqual(batch6Catalogue.lights.map((row) => row.key), batch6KeysByCategory.lights,
    `the console lights must offer the block's eleven rows (got ${JSON.stringify(batch6Catalogue.lights.map((row) => row.key))})`);
  for (const [key, range] of Object.entries({
    lights_btns: [0, 100], lights_leds: [5, 100], lights_meters: [0, 100], lights_rgbleds: [0, 100],
    lights_chlcds: [5, 100], lights_chlcdctr: [0, 100], lights_chedit: [5, 100], lights_main: [5, 100],
    lights_glow: [0, 100], lights_patch: [0, 100], lights_lamp: [0, 100],
  })) {
    const row = batch6Catalogue.lights.find((parameter) => parameter.key === key);
    assert.deepEqual([row.argKind, row.valueKind, row.min, row.max], ['int', 'number', range[0], range[1]],
      `${key} must be the integer ${range[0]}…${range[1]} the block prints (got ${JSON.stringify(row)})`);
  }
  // The safes: forty-one text rows, one per leaf, each with its documented length. A number field
  // here would send `40` where the console wants forty characters.
  assert.deepEqual(batch6Catalogue.safes.map((row) => row.key), batch6KeysByCategory.safes,
    `the safes must offer one row per documented leaf (got ${JSON.stringify(batch6Catalogue.safes.map((row) => row.key))})`);
  assert.equal(batch6Catalogue.safes.length, 41, 'the block documents forty-one safe leaves');
  for (const row of batch6Catalogue.safes) {
    assert.deepEqual([row.argKind, row.valueKind, row.maxLen], ['string', 'text', batch6SafeLengths[row.key]],
      `${row.key} must be the ${batch6SafeLengths[row.key]}-character text leaf of the block (got ${JSON.stringify(row)})`);
    assert.match(row.label, /Safes$/, `${row.key} must be labelled as a safes scope (got "${row.label}")`);
  }
  assert.deepEqual(batch6Catalogue.safes.map((row) => row.key).slice(-2), ['safes_custom', 'safes_setup'],
    'the two area masks the block documents last are offered too: 31 characters for custom, 3 for setup');
  // The monitor buses: every documented leaf, and the two read-only ones on the watch side alone.
  assert.deepEqual(batch6Catalogue.monitorTrigger.map((row) => row.key), batch6KeysByCategory.monbus,
    `the monitor buses must offer every documented leaf (got ${JSON.stringify(batch6Catalogue.monitorTrigger.map((row) => row.key))})`);
  assert.deepEqual(batch6Catalogue.monitorTarget.map((row) => row.key),
    batch6KeysByCategory.monbus.filter((key) => !['monitor_level', 'monitor_active_level'].includes(key)),
    `the monitor level (footnote 13) and the active level (1377, [RO]) must stay out of the step list (got ${JSON.stringify(batch6Catalogue.monitorTarget.map((row) => row.key))})`);
  for (const [key, expected] of [
    ['monitor_level', ['float', 'db', -144, 10]],
    ['monitor_pan', ['float', 'percent', -100, 100]],
    ['monitor_width', ['float', 'percent', -150, 150]],
    ['monitor_eq_low_freq', ['float', 'hz', 20, 2000]],
    ['monitor_eq_1_q', ['float', 'number', 0.44, 10]],
    ['monitor_eq_high_freq', ['float', 'hz', 50, 20000]],
    ['monitor_limiter', ['float', 'db', -40, 0]],
    ['monitor_delay', ['float', 'number', 0.1, 100]],
    ['monitor_dim', ['float', 'db', 0, 40]],
    ['monitor_pfl_dim', ['float', 'db', 0, 40]],
    ['monitor_band_solo_trim', ['float', 'db', 0, 24]],
    ['monitor_source_level', ['float', 'db', -144, 10]],
    ['monitor_active_level', ['float', 'db', -144, 10]],
  ]) {
    const row = batch6Catalogue.monitorTrigger.find((parameter) => parameter.key === key);
    assert.deepEqual([row.argKind, row.valueKind, row.min, row.max], expected,
      `${key} must carry the documented range (got ${JSON.stringify(row)})`);
  }
  for (const [key, expected] of [['monitor_source', batch6MonitorSources], ['monitor_direct_in', batch6MonitorDirectIns]]) {
    const row = batch6Catalogue.monitorTrigger.find((parameter) => parameter.key === key);
    assert.deepEqual(row.options, expected,
      `${key} must carry the documented source list (got ${row.options.length} entries, expected ${expected.length})`);
  }
  // The solo configuration: the eleven keys the brief names plus the three `$` leaves the node also
  // documents (`$srcsolo`, `$srcsgrp`, `$srcsin`, 1392-1394, as Source Solo, Group and Input). Six
  // leaves are `$` rows, and the desk splits them (WING Rack, FW 3.1.1): `$dim`, `$mono` and
  // `$flip` latch a write, the three source-solo reports do not, so only those three are watches
  // alone.
  const batch6SoloReadOnly = ['solo_source_state', 'solo_source_group', 'solo_source_input'];
  assert.deepEqual(batch6Catalogue.soloTrigger.map((row) => row.key), batch6KeysByCategory.solocfg,
    `the solo configuration must offer the node's fourteen leaves (got ${JSON.stringify(batch6Catalogue.soloTrigger.map((row) => row.key))})`);
  assert.deepEqual(batch6Catalogue.soloTarget.map((row) => row.key),
    batch6KeysByCategory.solocfg.filter((key) => !batch6SoloReadOnly.includes(key)),
    `every $-prefixed solo leaf is read-only and must stay out of the step list (got ${JSON.stringify(batch6Catalogue.soloTarget.map((row) => row.key))})`);
  for (const [key, expected] of [
    ['solo_mode', ['LIVE', 'STUDIO', 'SIP']],
    ['solo_monitor', ['PH', 'SPK', 'PH+SPK']],
    ['solo_channel_tap', ['PFL', 'AFL']],
    ['solo_bus_tap', ['PFL', 'AFL']],
    ['solo_main_tap', ['PFL', 'AFL']],
    ['solo_matrix_tap', ['PFL', 'AFL']],
    ['solo_source', ['OFF', 'CH39', 'AUX7']],
  ]) {
    const row = batch6Catalogue.soloTrigger.find((parameter) => parameter.key === key);
    assert.deepEqual(row.options, expected,
      `${key} must be the documented list (got ${JSON.stringify(row.options)})`);
  }
  // AES50: the four read-only health leaves watched, `clrerr` written.
  assert.deepEqual(batch6Catalogue.aes50Trigger.map((row) => row.key),
    ['aes50_state', 'aes50_device', 'aes50_errors_corrected', 'aes50_errors_uncorrected'],
    `the AES50 health leaves must be watches, never steps (got ${JSON.stringify(batch6Catalogue.aes50Trigger.map((row) => row.key))})`);
  assert.deepEqual(batch6Catalogue.aes50Target.map((row) => row.key), ['aes50_clear_errors'],
    `clrerr is the one writable AES50 leaf (got ${JSON.stringify(batch6Catalogue.aes50Target.map((row) => row.key))})`);
  const aes50Row = (key) => batch6Catalogue.aes50Trigger.find((parameter) => parameter.key === key);
  assert.deepEqual(aes50Row('aes50_state').options, ['-', 'OK', 'ERR', 'UPD'],
    `the AES50 state list must be Maillot's four states (got ${JSON.stringify(aes50Row('aes50_state').options)})`);
  assert.deepEqual([aes50Row('aes50_device').valueKind, aes50Row('aes50_device').maxLen], ['text', 128],
    'the AES50 device name is 128 characters of text (1255)');
  for (const key of ['aes50_errors_corrected', 'aes50_errors_uncorrected']) {
    assert.deepEqual([aes50Row(key).argKind, aes50Row(key).min, aes50Row(key).max], ['int', 0, 9999],
      `${key} must be the 0…9999 counter of 1256-1257 (got ${JSON.stringify(aes50Row(key))})`);
  }
  assert.deepEqual([batch6Catalogue.aes50Target[0].valueKind, batch6Catalogue.aes50Target[0].min, batch6Catalogue.aes50Target[0].max],
    ['toggle', 0, 1], 'Clear AES50 Error Counters must be the 0/1 toggle of 1258');
  // The desk status: the clock lock and the signed ppm, both watches.
  assert.deepEqual(batch6Catalogue.deskTrigger.map((row) => row.key), ['desk_lock', 'desk_ppm'],
    `the desk status must offer its two read-only keys (got ${JSON.stringify(batch6Catalogue.deskTrigger.map((row) => row.key))})`);
  assert.deepEqual([batch6Catalogue.deskTrigger[1].argKind, batch6Catalogue.deskTrigger[1].min, batch6Catalogue.deskTrigger[1].max],
    ['int', -200, 200], 'Clock PPM must keep the signed -200…200 range of 1275');
  // The W-Live card: the block's ten written `$ctl` leaves and the state watch.
  assert.deepEqual(batch6Catalogue.wliveTarget.map((row) => row.key),
    ['wlive_control', 'wlive_open_session', 'wlive_marker_edit', 'wlive_marker_goto', 'wlive_marker_delete',
      'wlive_session_delete', 'wlive_time', 'wlive_session_name', 'wlive_marker_set', 'wlive_format_card'],
    `the W-Live transport must offer every written leaf of the block (got ${JSON.stringify(batch6Catalogue.wliveTarget.map((row) => row.key))})`);
  assert.deepEqual(batch6Catalogue.wliveTrigger.map((row) => row.key), ['wlive_state'],
    `$stat/state is the W-Live watch (got ${JSON.stringify(batch6Catalogue.wliveTrigger.map((row) => row.key))})`);
  for (const row of batch6Catalogue.wliveTarget) {
    assert.equal(row.canTrigger, false, `${row.key} is written and never read back, so its row must not be watchable`);
  }
  assert.equal(batch6Catalogue.wliveTrigger[0].canTrigger, true,
    'wlive_state is the state the console reports, so its row must be watchable');
  assert.deepEqual(batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_control').options, ['STOP', 'PPAUSE', 'PLAY', 'REC'],
    'the W-Live control list is STOP, PPAUSE, PLAY, REC (2968-2969)');
  assert.deepEqual(batch6Catalogue.wliveTrigger[0].options, ['STOP', 'PPAUSE', 'PLAY', 'REC'],
    'the W-Live state the console reports is the same four states (2991)');
  assert.deepEqual(
    [batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_marker_goto').min,
      batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_marker_goto').max],
    [0, 101], 'Goto Marker must keep 101, the value that validates stime data (2975)');
  assert.deepEqual(
    [batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_open_session').max,
      batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_marker_set').valueKind,
      batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_format_card').valueKind],
    [100, 'toggle', 'toggle'], 'the session number stops at 100 and the two switches are 0/1 (2970, 2983-2984)');
  assert.deepEqual(
    [batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_time').valueKind,
      batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_time').max],
    ['ms', 36000000], 'W-Live Time is milliseconds up to 36000000 (2978-2980)');
  assert.deepEqual(
    [batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_session_name').valueKind,
      batch6Catalogue.wliveTarget.find((row) => row.key === 'wlive_session_name').maxLen],
    ['text', 19], 'the session name is 19 characters (2981-2982)');
  // The cards node: the "is a W-Live card in the slot" watch.
  assert.deepEqual(batch6Catalogue.cardsTrigger.map((row) => row.key), ['cards_type', 'cards_version'],
    `the cards node must offer its two read-only keys (got ${JSON.stringify(batch6Catalogue.cardsTrigger.map((row) => row.key))})`);
  assert.deepEqual(batch6Catalogue.cardsTrigger[0].options, ['NONE', 'WLIVE', 'WDANTE', 'WMADI', 'WDWSG'],
    `the card type list must be the document's own (got ${JSON.stringify(batch6Catalogue.cardsTrigger[0].options)})`);
  assert.deepEqual([batch6Catalogue.cardsTrigger[1].valueKind, batch6Catalogue.cardsTrigger[1].maxLen], ['text', 32],
    'the card version is 32 characters of text (2954)');
  // The global settings: the clock, its source, the startup mute and the two configuration lists.
  assert.deepEqual(batch6Catalogue.globalTarget.map((row) => row.key), batch6KeysByCategory.globals,
    `the global settings must offer their five keys (got ${JSON.stringify(batch6Catalogue.globalTarget.map((row) => row.key))})`);
  assert.deepEqual(batch6Catalogue.globalTrigger.map((row) => row.key), batch6KeysByCategory.globals,
    'every global key is reported as well as written, so its watch list is its write list');
  for (const [key, expected] of [
    ['global_clock_rate', ['48000.0', '44100.0']],
    ['global_clock_source', ['INT', 'A', 'B', 'C', 'AES', 'CARD', 'MOD']],
    ['global_usb_config', ['2/2', '8/8', '16/16', '32/32', '48/48']],
    ['global_stageconnect_config', batch6StageConnectConfigs],
  ]) {
    const row = batch6Catalogue.globalTarget.find((parameter) => parameter.key === key);
    assert.deepEqual(row.options, expected,
      `${key} must be the documented list (got ${JSON.stringify(row.options)})`);
  }
  assert.deepEqual(
    [batch6Catalogue.globalTarget.find((row) => row.key === 'global_clock_rate').valueKind,
      batch6Catalogue.globalTarget.find((row) => row.key === 'global_clock_rate').argKind],
    ['enum', 'string'], 'the clock rate is written as the string the document prints (48000.0, 44100.0, 4171)');
  assert.equal(batch6StageConnectConfigs.length, 34, 'the StageConnect split runs AUTO plus 0/32 … 32/0 (4177-4186)');
  // The index-less seams batch 6 adds, and the letter seam AES50 uses.
  for (const category of ['lights', 'safes', 'solocfg', 'deskstatus', 'cards', 'globals']) {
    assert.ok(batch6Catalogue.indexLess.includes(category),
      `${category} carries no id segment, so its ids must be seeded for the watch panel (got ${JSON.stringify(batch6Catalogue.indexLess)})`);
  }
  for (const category of ['aes50', 'monbus', 'wlive']) {
    assert.ok(!batch6Catalogue.indexLess.includes(category),
      `${category} is addressed by an entry (a letter, a bus number or a slot), not without one`);
  }
  assert.deepEqual(batch6Catalogue.aes50Names, ['A', 'B', 'C'],
    `the AES50 ids must read as the three ports (got ${JSON.stringify(batch6Catalogue.aes50Names)})`);

  // ── The safes are strings: a text field of the documented length ───────────────────────────────
  //
  // The whole point of the shape: a safe is a run of `+`/space, one character per item, so the step
  // panel must draw a text field whose `maxlength` is the documented length and whose hint says what
  // a `+` means. A number field would take `40` and write it where forty characters belong.
  await setSelect('target-category', 'safes');
  await setSelect('target-parameter', 'safes_ch');
  const safeControl = await evaluate(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      // A plain select is drawn by the shared dropdown (dropdown.js) now: the native list is hidden
      // and the button beside it is the control the operator sees, so "visible" is read from that
      // button — including the .hidden class the app puts on the source when a kind swaps it out.
      if (el && el.tagName === 'SELECT') {
        const button = document.getElementById(id + '-menu');
        return Boolean(button) && !button.closest('.hidden') && button.getClientRects().length > 0;
      }
      return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
    };
    const field = document.getElementById('osc-value');
    return {
      type: field.type,
      text: visible('osc-value'),
      list: visible('osc-value-options'),
      maxLength: field.maxLength,
      placeholder: field.placeholder,
      title: field.title,
      label: document.getElementById('value-field-label').textContent,
      hint: document.getElementById('value-hint').textContent,
    };
  })()`);
  assert.equal(safeControl.type, 'text', `a safe must be typed as text, not as a number (got "${safeControl.type}")`);
  assert.equal(safeControl.text, true, 'the text field must be the visible control for a safe');
  assert.equal(safeControl.list, false, 'a safe is not a closed list: every run of + and space is valid');
  assert.equal(safeControl.maxLength, 40, `Channel Safes is 40 characters (4017) (got ${safeControl.maxLength})`);
  assert.equal(safeControl.placeholder, 'at most 40 characters',
    `the field must say how long a safe string may be (got "${safeControl.placeholder}")`);
  assert.match(safeControl.hint, /\+/, `the hint must say what a + means (got "${safeControl.hint}")`);
  assert.match(safeControl.hint, /4017/, `the hint must cite the documented leaf (got "${safeControl.hint}")`);
  // A safe longer than the scope must be refused, by the maxlength the field carries or by the rule
  // that reads it before saving.
  const longSafeProblem = await evaluate(`(() => {
    const field = document.getElementById('osc-value');
    field.value = '+'.repeat(41);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return document.getElementById('osc-value-problem')?.textContent || '';
  })()`);
  assert.match(longSafeProblem, /at most 40 characters/,
    `a 41-character safe must be refused with the documented length (got "${longSafeProblem}")`);

  // ── The read-only leaves are watches: the step list must not carry them ────────────────────────
  //
  // `monitor_level` is the plan's footnote-13 case and `solo_source_input` a `$` leaf the desk does
  // not take a write for; both must be selectable in the watch panel with their own comparison, and
  // neither may appear in the step panel's parameter list for its category.
  await setSelect('target-category', 'monbus');
  const monitorStepKeys = await evaluate(`[...document.getElementById('target-parameter').options]
    .filter((option) => option.value)
    .map((option) => option.value)`);
  assert.ok(!monitorStepKeys.includes('monitor_level') && !monitorStepKeys.includes('monitor_active_level'),
    `the monitor bus level is read-only and must not be a step parameter (got ${JSON.stringify(monitorStepKeys)})`);
  await setSelect('target-parameter', 'monitor_dim');
  const monitorDimBounds = await evaluate(`(() => {
    const field = document.getElementById('osc-value');
    return { min: field.min, max: field.max };
  })()`);
  assert.deepEqual(monitorDimBounds, { min: '0', max: '40' },
    `Monitor Dim is documented 40…0, so the field must accept both 0 and 40 (got ${JSON.stringify(monitorDimBounds)})`);
  await setSelect('trigger-category', 'monbus');
  await setSelect('trigger-parameter', 'monitor_level');
  const monitorLevelTrigger = await triggerControls();
  assert.equal(monitorLevelTrigger.number, true, 'Monitor Level is a dB number the trigger compares');
  assert.ok(monitorLevelTrigger.operators.includes('<') && monitorLevelTrigger.operators.includes('>'),
    `a level is ordered (got ${JSON.stringify(monitorLevelTrigger.operators)})`);
  const monitorLevelBounds = await evaluate(`(() => {
    const field = document.getElementById('threshold');
    return { min: field.min, max: field.max };
  })()`);
  assert.deepEqual(monitorLevelBounds, { min: '-144', max: '10' },
    `Monitor Level must carry the documented -144…10 bounds (got ${JSON.stringify(monitorLevelBounds)})`);
  await setSelect('trigger-category', 'solocfg');
  const soloWatchKeys = await evaluate(`[...document.getElementById('trigger-parameter').options]
    .filter((option) => option.value && !option.value.includes(':') && !option.textContent.includes('not in this catalogue'))
    .map((option) => option.value)`);
  for (const key of batch6SoloReadOnly) {
    assert.ok(soloWatchKeys.includes(key), `${key} must be offered as a watch (got ${JSON.stringify(soloWatchKeys)})`);
  }
  const soloStepKeys = await evaluate(`(() => {
    const select = document.getElementById('target-category');
    select.value = 'solocfg';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return [...document.getElementById('target-parameter').options].filter((option) => option.value).map((option) => option.value);
  })()`);
  for (const key of batch6SoloReadOnly) {
    assert.ok(!soloStepKeys.includes(key), `${key} is read-only and must not be a step parameter (got ${JSON.stringify(soloStepKeys)})`);
  }

  // ── The AES50 letters: 1 = A, 2 = B, 3 = C, and a fourth port is refused ───────────────────────
  //
  // `/$stat/A/stat` is addressed by a **letter** (1254) while the panel and the resolver carry the
  // number, so the id readout names the port — exactly as talkback's 1 = A / 2 = B and the fader
  // layers' 1 = L … 7 = VRT do (see `ID_SEGMENT_NAME_CATEGORIES`). Without it the two ports after the
  // first are invisible to the operator.
  await setSelect('target-category', 'aes50');
  await setSelect('target-parameter', 'aes50_clear_errors');
  const aes50IdsReadout = await evaluate(`(() => {
    const ids = document.getElementById('target-ids');
    const readout = document.getElementById('target-ids-destination');
    const show = (value) => {
      ids.value = value;
      ids.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        readout: readout.textContent,
        invalid: ids.classList.contains('is-invalid'),
        problem: document.getElementById('target-ids-problem')?.textContent || '',
      };
    };
    const named = {};
    for (const id of [1, 2, 3]) named[id] = show(String(id));
    return { named, four: show('4'), range: show('1-3'), stray: show('') };
  })()`);
  ['A', 'B', 'C'].forEach((letter, index) => {
    const seen = aes50IdsReadout.named[index + 1];
    assert.equal(seen.readout, `AES50 Port ${letter}`,
      `AES50 id ${index + 1} must read as port ${letter} (got "${seen.readout}")`);
    assert.equal(seen.invalid, false, `AES50 id ${index + 1} is one of the three ports the node has`);
  });
  assert.equal(aes50IdsReadout.range.readout, 'AES50 Port A, B, C',
    `a range of ports must name every port it addresses (got "${aes50IdsReadout.range.readout}")`);
  assert.equal(aes50IdsReadout.range.invalid, false, '1-3 is exactly the three ports and must be accepted');
  assert.equal(aes50IdsReadout.four.invalid, true, 'a fourth AES50 port must be refused: the node has three');
  assert.match(aes50IdsReadout.four.problem, /aes50 only has 3/,
    `the refusal must say how many ports the category has (got "${aes50IdsReadout.four.problem}")`);
  assert.match(aes50IdsReadout.four.problem, /1 = A, 2 = B, 3 = C/,
    `the refusal must name the three ports (got "${aes50IdsReadout.four.problem}")`);
  assert.doesNotMatch(aes50IdsReadout.four.readout, /AES50 Port [A-Z]/,
    `no readout may claim a port the console does not have (got "${aes50IdsReadout.four.readout}")`);
  assert.match(aes50IdsReadout.stray.readout, /1 = A, 2 = B, 3 = C/,
    `a field with no usable id must still say how to address a port (got "${aes50IdsReadout.stray.readout}")`);
  // The same readout follows the watch panel, and stays silent for a numbered category.
  const aes50ReadoutScope = await evaluate(`(() => {
    const set = (categoryId, idsId, readoutId, value, category) => {
      const select = document.getElementById(categoryId);
      select.value = category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const ids = document.getElementById(idsId);
      ids.value = value;
      ids.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById(readoutId).textContent;
    };
    return {
      trigger: set('trigger-category', 'trigger-ids', 'trigger-ids-destination', '2', 'aes50'),
      condition: set('condition-category', 'condition-ids', 'condition-ids-destination', '3', 'aes50'),
      channel: set('trigger-category', 'trigger-ids', 'trigger-ids-destination', '3', 'ch'),
    };
  })()`);
  assert.equal(aes50ReadoutScope.trigger, 'AES50 Port B',
    `the trigger panel must name port B (got "${aes50ReadoutScope.trigger}")`);
  assert.equal(aes50ReadoutScope.condition, 'AES50 Port C',
    `the IF gate must name port C (got "${aes50ReadoutScope.condition}")`);
  assert.equal(aes50ReadoutScope.channel, '', 'a numbered category has nothing to name: channel 3 is not "Channel C"');
  // An index-less batch-6 category seeds its trigger id, or the backend refuses the macro before the
  // resolver ever ignores the list.
  const batch6Seeded = await evaluate(`(() => {
    const select = document.getElementById('trigger-category');
    const ids = document.getElementById('trigger-ids');
    const seed = (category) => {
      ids.value = '';
      select.value = category;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return ids.value;
    };
    return { lights: seed('lights'), solocfg: seed('solocfg'), globals: seed('globals') };
  })()`);
  for (const [name, seeded] of Object.entries(batch6Seeded)) {
    assert.ok(String(seeded).trim().length > 0,
      `picking the index-less ${name} must seed the ids field, or the backend refuses the macro (got "${seeded}")`);
  }

  // ── The clock's lists and the negative ppm, through the panels that draw them ───────────────────
  await setSelect('target-category', 'globals');
  await setSelect('target-parameter', 'global_clock_rate');
  const clockRateControl = await evaluate(`(() => ({
    values: [...document.getElementById('osc-value-options').options].map((option) => option.value),
    list: !document.getElementById('osc-value-options').classList.contains('hidden'),
    number: !document.getElementById('osc-value').classList.contains('hidden'),
    hint: document.getElementById('value-hint').textContent,
  }))()`);
  assert.deepEqual(clockRateControl.values, ['48000.0', '44100.0'],
    `the step panel must offer the two documented clock rates (got ${JSON.stringify(clockRateControl.values)})`);
  assert.equal(clockRateControl.list, true, 'a closed list must be offered as the list select');
  assert.equal(clockRateControl.number, false, 'a closed list has no free number to type');
  assert.match(clockRateControl.hint, /4171/, 'the clock rate hint must cite the documented leaf');
  await setSelect('target-parameter', 'global_stageconnect_config');
  const stageConnectValues = await evaluate(`[...document.getElementById('osc-value-options').options].map((option) => option.value)`);
  assert.deepEqual(stageConnectValues, batch6StageConnectConfigs,
    `StageConnect must offer AUTO and the 33 splits (got ${stageConnectValues.length} entries)`);
  await setSelect('trigger-category', 'deskstatus');
  await setSelect('trigger-parameter', 'desk_ppm');
  const ppmTrigger = await triggerControls();
  assert.equal(ppmTrigger.number, true, 'Clock PPM is a number the trigger compares');
  const ppmBounds = await evaluate(`(() => {
    const field = document.getElementById('threshold');
    return { min: field.min, max: field.max };
  })()`);
  assert.deepEqual([ppmBounds.min, ppmBounds.max], ['-200', '200'],
    `Clock PPM must keep the signed -200…200 range (got ${JSON.stringify(ppmBounds)})`);
  // The negative half is half the range: a comparison below zero must be accepted and one past the
  // documented bound refused, or the "the clock is running slow" trigger could never be written.
  const ppmValues = await evaluate(`(() => {
    const field = document.getElementById('threshold');
    const show = (value) => {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        invalid: field.classList.contains('is-invalid'),
        problem: document.getElementById('threshold-problem')?.textContent || '',
      };
    };
    return { slow: show('-150'), fast: show('200'), tooFar: show('250') };
  })()`);
  assert.equal(ppmValues.slow.invalid, false,
    `a negative ppm is inside the signed range and must be accepted (got ${JSON.stringify(ppmValues.slow)})`);
  assert.equal(ppmValues.fast.invalid, false,
    `the top of the documented range must be accepted (got ${JSON.stringify(ppmValues.fast)})`);
  assert.equal(ppmValues.tooFar.invalid, true,
    `a ppm past 200 must be refused (got ${JSON.stringify(ppmValues.tooFar)})`);
  assert.match(ppmValues.tooFar.problem, /200/,
    `the refusal must name the documented bound (got "${ppmValues.tooFar.problem}")`);

  // ── The picker files every desk-level key by rule, and none in the catch-all ────────────────────
  const batch6MenuGroups = await evaluate(`(() => {
    const wanted = ${JSON.stringify(batch6KeysByCategory)};
    const out = {};
    for (const [category, keys] of Object.entries(wanted)) {
      out[category] = keys.map((key) => ({
        key,
        path: parameterMenuPath({ value: key, info: {} }).map((group) => group.key).join('/'),
      }));
    }
    return out;
  })()`);
  const batch6ExpectedGroup = {
    lights: 'lights', safes: 'safes', monbus: 'monitor', solocfg: 'solo', aes50: 'aes50',
    deskstatus: 'console', wlive: 'cards', cards: 'cards', globals: 'globals',
  };
  for (const [category, entries] of Object.entries(batch6MenuGroups)) {
    for (const entry of entries) {
      assert.equal(entry.path, batch6ExpectedGroup[category],
        `${entry.key} must be filed under "${batch6ExpectedGroup[category]}" (got "${entry.path}")`);
      assert.notEqual(entry.path, 'other',
        `${entry.key} fell into the picker's catch-all, which is what this batch must not do`);
    }
  }
  // The strip keys whose names begin with the same words keep their own group: `monitor_mode` is a
  // strip's monitor selection and `solo_safe` its solo-safe switch, and both belong with the level
  // controls rather than under the desk-level headings.
  const batch6NeighbourGroups = await evaluate(`(() => ({
    monitorMode: parameterMenuPath({ value: 'monitor_mode', info: {} }).map((group) => group.key).join('/'),
    soloSafe: parameterMenuPath({ value: 'solo_safe', info: {} }).map((group) => group.key).join('/'),
    solo: parameterMenuPath({ value: 'solo', info: {} }).map((group) => group.key).join('/'),
  }))()`);
  for (const [name, path] of Object.entries(batch6NeighbourGroups)) {
    assert.equal(path, 'level', `${name} must stay with the strip's own level controls (got "${path}")`);
  }
  console.log('batch 6: the desk level held against the fallback catalogue, family by family');

  await setSelect('trigger-category', 'usb');

  // ── The fallback rows against `crates/wing-core/src/lib.rs` ────────────────────────────────────
  //
  // The standalone catalogue is a mirror, so the one thing it cannot do is drift. This reads the
  // Rust catalogue out of the working tree and compares the shared key on each new row — the label,
  // the OSC argument kind, the value kind, the range, the options, the writability and the length —
  // plus every key the backend still carries for the six families the batch touches. Hints are
  // deliberately not compared: the fallback's are shorter prose, and the batch-1 rows already
  // differ there.
  const rustCatalogue = fs.readFileSync(path.join(repoRoot, 'crates/wing-core/src/lib.rs'), 'utf8');
  // The generated appendix table the model-scoped rows take their lists from (`CHANNEL_EQ_MODELS`
  // and friends): a `choice(...)` row may name one through its full path, and the declaration then
  // lives here rather than in `lib.rs`.
  const pluginModelsSource = fs.readFileSync(path.join(repoRoot, 'crates/wing-core/src/plugin_models.rs'), 'utf8');
  // A `const NAME: &[TargetParameterInfo] = &[ … ];` block, split into its rows at top level.
  const rustTable = (name) => {
    // Anchored at the start of a line, so a mention of the name inside a comment or a hint string
    // cannot be mistaken for the declaration; and the initialiser's own `= &[` is what is sliced, so
    // the type annotation (`: &[TargetParameterInfo]`) cannot be mistaken for it. Both mistakes are
    // invisible while every table opens with a plain row, and fatal to the first row of a table that
    // opens with a comment block — which is what the source table does.
    const declaration = new RegExp(`^\\s*const ${name}\\b[^=]*= &\\[`, 'm').exec(rustCatalogue);
    assert.ok(declaration, `crates/wing-core/src/lib.rs must still declare ${name} as an array literal`);
    const open = rustCatalogue.indexOf('= &[', declaration.index);
    const end = rustCatalogue.indexOf('];', open);
    // From the array's own bracket, with the line comments removed: a comma inside a comment block is
    // not a row separator, and a table may open with one (the source table does).
    const body = rustCatalogue.slice(open, end)
      .replace(/^=\s*&\[/, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const rows = [];
    let depth = 0;
    let current = '';
    for (const character of body) {
      if (character === ',' && depth === 0) {
        if (current.trim()) rows.push(current.trim());
        current = '';
        continue;
      }
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      current += character;
    }
    if (current.trim()) rows.push(current.trim());
    return rows;
  };
  const ROW_FIELDS = ['argKind', 'valueKind', 'min', 'max', 'canTrigger', 'maxLen'];
  /** The argument list of the constructor inside a row, whatever wrapper it sits in. */
  const constructorArguments = (row, builder) => {
    const open = row.indexOf(`${builder}(`) + builder.length;
    let depth = 0;
    for (let index = open; index < row.length; index += 1) {
      if (row[index] === '(') depth += 1;
      if (row[index] === ')') {
        depth -= 1;
        if (depth === 0) return row.slice(open + 1, index);
      }
    }
    return row.slice(open + 1);
  };
  const parseRustRow = (row) => {
    const call = /\b(toggle|number|integer|choice|text|dead_parameter)\s*\(/.exec(row);
    if (!call) return null;
    const builder = call[1];
    const args = constructorArguments(row, builder);
    const strings = [...args.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
    const [key, label] = strings;
    if (!key) return null;
    // Every numeric literal in the argument list, in order: for `number`/`integer` that is min then
    // max, for `text` the documented length. Rust writes long literals with underscores
    // (`1_000_000_000.0`), which the pattern has to accept or the widest bound in the catalogue
    // (`rec_time`) would silently read as "no maximum" and never be compared.
    const numbers = args
      .replace(/"[^"]*"/g, '""')
      .split(',')
      .map((piece) => piece.trim())
      .filter((piece) => /^-?\d[\d_]*(\.\d+)?$/.test(piece))
      .map((piece) => Number(piece.replaceAll('_', '')));
    // `write_only(...)` wraps the constructor: the leaf is written and the console never reports it,
    // which is exactly what `can_trigger` carries. The builders below used to force
    // `canTrigger: true`, so every write-only row — batch 1's show pair, batch 4's transport —
    // read as watchable here, the opposite of what the backend publishes.
    const canTrigger = !row.includes('write_only');
    const entry = { key, label, argKind: 'string', valueKind: 'text', canTrigger };
    if (builder === 'toggle') Object.assign(entry, { argKind: 'int', valueKind: 'toggle', min: 0, max: 1, canTrigger });
    if (builder === 'number' || builder === 'integer') {
      Object.assign(entry, {
        argKind: builder === 'number' ? 'float' : 'int',
        valueKind: strings[2],
        min: numbers[0],
        max: numbers[1],
        canTrigger,
      });
    }
    if (builder === 'choice') {
      Object.assign(entry, { argKind: 'string', valueKind: 'enum', options: true, canTrigger });
    }
    if (builder === 'text') Object.assign(entry, { argKind: 'string', valueKind: 'text', maxLen: numbers[0], canTrigger });
    return entry;
  };
  /** The top-level comma-separated arguments of a constructor call, quoted strings respected. */
  const splitRustArguments = (args) => {
    const pieces = [];
    let current = '';
    let depth = 0;
    let quoted = false;
    for (let index = 0; index < args.length; index += 1) {
      const character = args[index];
      if (quoted) {
        if (character === '\\') {
          current += character + (args[index + 1] ?? '');
          index += 1;
          continue;
        }
        current += character;
        if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        current += character;
        continue;
      }
      if ('([{'.includes(character)) depth += 1;
      if (')]}'.includes(character)) depth -= 1;
      if (character === ',' && depth === 0) {
        pieces.push(current);
        current = '';
        continue;
      }
      current += character;
    }
    pieces.push(current);
    return pieces;
  };
  /**
   * The option list a Rust `choice(...)` row declares: its third argument, resolved through the
   * `const NAME: &[&str] = &[…]` declaration it names, or read as an inline `&[…]` literal. A
   * fully-qualified name (`crate::plugin_models::CHANNEL_EQ_MODELS`) is resolved by its last segment,
   * in `lib.rs` first and then in the generated appendix table, which is where the model lists live.
   * `null` when the row is not a choice or the list cannot be resolved — a drifted list is then a
   * failure, never a silent pass.
   */
  const rustChoiceOptions = (row) => {
    if (!row || !/\bchoice\s*\(/.test(row)) return null;
    const third = (splitRustArguments(constructorArguments(row, 'choice'))[2] || '').trim().replace(/^&/, '');
    const inline = /^\[([\s\S]*)\]$/.exec(third);
    if (inline) return [...inline[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    if (!/^[A-Za-z_][\w:]*$/.test(third)) return null;
    const name = third.split('::').pop();
    const declaration = new RegExp(`const ${name}\\b[^=]*= &\\[([^\\]]*)\\]`).exec(rustCatalogue)
      || new RegExp(`const ${name}\\b[^=]*= &\\[([^\\]]*)\\]`).exec(pluginModelsSource);
    return declaration ? [...declaration[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]) : null;
  };
  const fallbackRows = (source, name) => {
    const start = source.search(new RegExp(`const ${name} = (?:[A-Za-z_$][\\w$]*\\s*)?\\[`));
    assert.ok(start >= 0, `desktop/ui/index.html must still declare ${name}`);
    const end = source.indexOf('\n      ];', start);
    const body = source.slice(start, end);
    return [...body.matchAll(/\{\s*key:\s*"([^"]+)"/g)].map((match) => {
      const rowStart = match.index;
      const rowEnd = body.indexOf('\n', rowStart);
      const row = body.slice(rowStart, rowEnd);
      const numbers = {};
      for (const field of ['min', 'max', 'maxLen']) {
        const found = new RegExp(`${field}:\\s*(-?[\\d.]+)`).exec(row);
        if (found) numbers[field] = Number(found[1]);
      }
      return {
        key: match[1],
        label: /label:\s*"([^"]+)"/.exec(row)?.[1] || '',
        argKind: /argKind:\s*"([^"]+)"/.exec(row)?.[1] || '',
        valueKind: /valueKind:\s*"([^"]+)"/.exec(row)?.[1] || '',
        canTrigger: !/canTrigger:\s*false/.test(row),
        options: /options:\s*\[/.test(row),
        ...numbers,
      };
    });
  };
  const compareRow = (where, rustRow, fallbackRow) => {
    for (const field of ROW_FIELDS) {
      if (rustRow[field] === undefined || fallbackRow[field] === undefined) continue;
      assert.deepEqual(fallbackRow[field], rustRow[field],
        `${where}: the standalone catalogue's ${field} must mirror crates/wing-core/src/lib.rs (got ${JSON.stringify(fallbackRow[field])}, backend ${JSON.stringify(rustRow[field])})`);
    }
    assert.equal(fallbackRow.label, rustRow.label, `${where}: the label must match the backend catalogue`);
  };
  // The talkback rows are transcribed from the Maillot reference into both catalogues, so the label,
  // the OSC argument kind, the value kind, the range, the options and the writability of each one are
  // compared field by field. (Hints are not: the fallback's are shorter prose, and the batch-1 rows
  // already differ there.)
  const talkRustRows = rustTable('TALK_TARGET_PARAMETERS').map(parseRustRow).filter(Boolean);
  assert.ok(talkRustRows.length > 0, "TALK_TARGET_PARAMETERS must still hold the backend's rows");
  const talkFallbackRows = fallbackRows(indexHtmlForComparison, 'FALLBACK_TALK_PARAMETERS');
  assert.deepEqual(talkFallbackRows.map((row) => row.key), talkRustRows.map((row) => row.key),
    `FALLBACK_TALK_PARAMETERS must offer exactly the keys the backend carries (got ${JSON.stringify(talkFallbackRows.map((row) => row.key))})`);
  for (const rustRow of talkRustRows) {
    compareRow(`FALLBACK_TALK_PARAMETERS/${rustRow.key}`, rustRow, talkFallbackRows.find((row) => row.key === rustRow.key));
  }
  // The GPIO split: `gpio` writes and reports `mode`/`gpstate`, `gpiostate` only reports `$state`, so
  // the source table above carries the whole node and the two category lists are what split it. Each
  // list is compared with the backend table the category publishes.
  const gpioRustRows = rustTable('GPIO_TARGET_PARAMETERS').map(parseRustRow).filter(Boolean);
  const gpioStateRustRows = rustTable('GPIO_STATE_PARAMETERS').map(parseRustRow).filter(Boolean);
  assert.deepEqual(gpioRustRows.map((row) => row.key), ['gpio_mode', 'gpio_state'],
    'GPIO_TARGET_PARAMETERS must hold the two writable rows');
  assert.deepEqual(gpioStateRustRows.map((row) => row.key), ['gpio_input_state'],
    'GPIO_STATE_PARAMETERS must hold the read-only row');
  const gpioFallbackRows = fallbackRows(indexHtmlForComparison, 'FALLBACK_GPIO_PARAMETERS');
  for (const rustRow of [...gpioRustRows, ...gpioStateRustRows]) {
    const mine = gpioFallbackRows.find((row) => row.key === rustRow.key);
    assert.ok(mine, `the standalone GPIO table must carry ${rustRow.key}`);
    compareRow(`FALLBACK_GPIO_PARAMETERS/${rustRow.key}`, rustRow, mine);
  }
  // The watch-only entry `FALLBACK_GPIO_INPUT_PARAMETERS` derives from the table above is what the
  // `gpiostate` category really publishes, so it is read from the page (the source text only names
  // the filter) and compared with the backend's own read-only table.
  const gpioWatchOnlyKeys = await evaluate(`FALLBACK_GPIO_INPUT_PARAMETERS.map((parameter) => parameter.key)`);
  assert.deepEqual(gpioWatchOnlyKeys, gpioStateRustRows.map((row) => row.key),
    `the watch-only half must carry exactly the read-only rows the backend publishes (got ${JSON.stringify(gpioWatchOnlyKeys)})`);
  for (const rustRow of gpioStateRustRows) {
    compareRow(`FALLBACK_GPIO_PARAMETERS/${rustRow.key}`, rustRow, gpioFallbackRows.find((row) => row.key === rustRow.key));
  }
  // `solo` on the five mix families and on the DCA.
  const rustSolo = parseRustRow(rustTable('MIX_BASE_TARGET_PARAMETERS').find((row) => /"solo"/.test(row)));
  assert.ok(rustSolo, 'MIX_BASE_TARGET_PARAMETERS must still carry a solo row');
  const fallbackSolo = fallbackRows(indexHtmlForComparison, 'FALLBACK_MIX_ROWS').find((row) => row.key === 'solo');
  assert.ok(fallbackSolo, 'the standalone mix table must carry the solo row');
  compareRow('FALLBACK_MIX_ROWS/solo', rustSolo, fallbackSolo);
  const rustDca = rustTable('DCA_TARGET_PARAMETERS').map(parseRustRow).filter(Boolean);
  const fallbackDca = fallbackRows(indexHtmlForComparison, 'FALLBACK_DCA_ROWS');
  // The DCA keys this catalogue carries, compared with the backend's own rows: `solo` is the key the
  // batch adds, the rest are the DCA rows the fallback already mirrored. Whatever the backend offers
  // and this reduced catalogue does not is reported, never silently accepted.
  for (const key of ['solo', 'mute', 'fader', 'name', 'color', 'icon', 'monitor_mode']) {
    const rustRow = rustDca.find((row) => row.key === key);
    assert.ok(rustRow, `DCA_TARGET_PARAMETERS must still carry ${key}`);
    const mine = fallbackDca.find((row) => row.key === key);
    // Asserted, not skipped: the comment above this loop promised "reported, never silently accepted", and
    // deleting `mute`/`fader`/`name`/`color`/`icon`/`monitor_mode` from the standalone table used to leave
    // the suite green (audit 2026-10-02, S7).
    assert.ok(mine, `the standalone DCA table must carry ${key}`);
    compareRow(`FALLBACK_DCA_ROWS/${key}`, rustRow, mine);
  }
  // The families the brief freezes: `solo` is on all five mix families, and the DCA has its own row.
  const soloFamiliesInFallback = await evaluate(`(() => {
    const mix = FALLBACK_MIX_ROWS.find((row) => row.key === 'solo');
    return {
      families: mix ? [...mix.families] : [],
      dca: FALLBACK_DCA_ROWS.some((row) => row.key === 'solo'),
    };
  })()`);
  assert.deepEqual(soloFamiliesInFallback.families.slice().sort(), ['aux', 'bus', 'ch', 'main', 'matrix'],
    `solo must be declared for all five mix families (got ${JSON.stringify(soloFamiliesInFallback.families)})`);
  assert.equal(soloFamiliesInFallback.dca, true, 'the DCA table must carry its own solo row (Maillot 2874)');
  console.log('batch 2: talkback, GPIO and solo contracts compared against crates/wing-core/src/lib.rs');

  // ── Batch 3's rows against the same Rust catalogue ─────────────────────────────────────────────
  //
  // The routing pair, the two `/io` switches, the source mode and the oscillator's three leaves are
  // transcribed from the Maillot reference into both catalogues, so each row is compared field by
  // field: the label, the OSC argument kind, the value kind, the range, the options and the
  // writability. The group list is compared as a list, not as a boolean, because it is the one place
  // where a plausible-looking copy (`SEND`, `MON` — the *output* list at 1844-1846) would be wrong.
  // The four routing rows are rows of the *mix* table on both sides — the backend keeps them in
  // `MIX_BASE_TARGET_PARAMETERS` and gates them with `mix_parameter_allowed`, and the fallback keeps
  // them in `FALLBACK_MIX_ROWS` — so they are found by key in the backend's mix table and in the
  // fallback's own. A separate table would be a second place for the family gate to be forgotten.
  const rustMixRows = rustTable('MIX_BASE_TARGET_PARAMETERS').map(parseRustRow).filter(Boolean);
  const routingRustRows = rustMixRows.filter((row) => row.key.startsWith('input_conn_'));
  assert.deepEqual(routingRustRows.map((row) => row.key),
    ['input_conn_group', 'input_conn_index', 'input_conn_alt_group', 'input_conn_alt_index'],
    `MIX_BASE_TARGET_PARAMETERS must hold the four routing rows (got ${JSON.stringify(routingRustRows.map((row) => row.key))})`);
  const routingFallbackRows = fallbackRows(indexHtmlForComparison, 'FALLBACK_MIX_ROWS')
    .filter((row) => row.key.startsWith('input_conn_'));
  assert.deepEqual(routingFallbackRows.map((row) => row.key), routingRustRows.map((row) => row.key),
    `FALLBACK_MIX_ROWS must carry exactly the routing keys the backend carries (got ${JSON.stringify(routingFallbackRows.map((row) => row.key))})`);
  for (const rustRow of routingRustRows) {
    const mine = routingFallbackRows.find((row) => row.key === rustRow.key);
    assert.ok(mine, `the standalone mix table must carry ${rustRow.key}`);
    compareRow(`FALLBACK_MIX_ROWS/${rustRow.key}`, rustRow, mine);
  }
  // The families: a channel and an aux are the only two with an `/in/conn` node.
  const routingFamiliesInFallback = await evaluate(`(() => {
    const rows = FALLBACK_MIX_ROWS.filter((row) => row.key.startsWith('input_conn_'));
    return {
      keys: rows.map((row) => row.key),
      families: [...new Set(rows.flatMap((row) => [...row.families]))].sort(),
      groups: [...FALLBACK_INPUT_CONN_GROUPS],
    };
  })()`);
  assert.deepEqual(routingFamiliesInFallback.families, ['aux', 'ch'],
    `the four routing keys belong to ch and aux alone (got ${JSON.stringify(routingFamiliesInFallback.families)})`);
  // The group list itself, read from the page: the same seventeen entries the backend carries. The
  // sixteen-character options on a routing row must be exactly this list, or the editor would offer a
  // value the backend refuses (or refuse one it accepts).
  const routingGroupList = routingFamiliesInFallback.groups;
  assert.deepEqual(routingGroupList,
    ['OFF', 'LCL', 'AUX', 'A', 'B', 'C', 'SC', 'USB', 'CRD', 'MOD', 'PLAY', 'AES', 'USR', 'OSC', 'BUS', 'MAIN', 'MTX'],
    `the routing group list must be Maillot's seventeen /in/conn/grp entries (got ${JSON.stringify(routingGroupList)})`);
  for (const key of ['input_conn_group', 'input_conn_alt_group']) {
    const declared = await evaluate(`(() => {
      const row = FALLBACK_MIX_ROWS.find((parameter) => parameter.key === ${JSON.stringify(key)});
      return row ? [...row.options] : null;
    })()`);
    assert.deepEqual(declared, routingGroupList,
      `${key} must carry the seventeen groups as its own option list (got ${JSON.stringify(declared)})`);
  }
  // The same list in the Rust catalogue, whatever the constant is called: a `const NAME: &[&str] = &[`
  // whose entries are the documented groups. Compared by value, so a renamed constant is fine and a
  // changed list is not.
  const rustGroupList = (() => {
    const declarations = [...rustCatalogue.matchAll(/const ([A-Z0-9_]+): &\[&str\] = &\[([^\]]*)\];/g)];
    for (const declaration of declarations) {
      const values = [...declaration[2].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      if (values.length === routingGroupList.length && values.every((value, index) => value === routingGroupList[index])) {
        return { name: declaration[1], values };
      }
    }
    return null;
  })();
  assert.ok(rustGroupList,
    `crates/wing-core/src/lib.rs must declare a group list equal to ${JSON.stringify(routingGroupList)}`);
  // The `/io` switches.
  const ioRustRows = rustTable('IO_TARGET_PARAMETERS').map(parseRustRow).filter(Boolean);
  assert.deepEqual(ioRustRows.map((row) => row.key), ['io_altsw', 'io_auto_alt_override'],
    `IO_TARGET_PARAMETERS must hold the two switches (got ${JSON.stringify(ioRustRows.map((row) => row.key))})`);
  const ioFallbackRows = fallbackRows(indexHtmlForComparison, 'FALLBACK_IO_PARAMETERS');
  assert.deepEqual(ioFallbackRows.map((row) => row.key), ioRustRows.map((row) => row.key),
    `FALLBACK_IO_PARAMETERS must offer exactly the keys the backend carries (got ${JSON.stringify(ioFallbackRows.map((row) => row.key))})`);
  for (const rustRow of ioRustRows) {
    const mine = ioFallbackRows.find((row) => row.key === rustRow.key);
    assert.ok(mine, `the standalone I/O table must carry ${rustRow.key}`);
    compareRow(`FALLBACK_IO_PARAMETERS/${rustRow.key}`, rustRow, mine);
  }
  // The source mode: the backend's source table carries `source_mode`, and the fallback's row must
  // agree with it on the label, the kind and the option list.
  const sourceModeRustRow = parseRustRow(rustTable('SOURCE_TARGET_PARAMETERS').find((row) => /"source_mode"/.test(row)));
  assert.ok(sourceModeRustRow, 'SOURCE_TARGET_PARAMETERS must still carry a source_mode row');
  const sourceModeFallbackRow = fallbackRows(indexHtmlForComparison, 'FALLBACK_SOURCE_PARAMETERS')[0];
  assert.ok(sourceModeFallbackRow, 'the standalone source table must carry the source_mode row');
  assert.equal(sourceModeFallbackRow.key, 'source_mode',
    `the source table's first row must be source_mode (got ${sourceModeFallbackRow.key})`);
  compareRow('FALLBACK_SOURCE_PARAMETERS/source_mode', sourceModeRustRow, sourceModeFallbackRow);
  const sourceModeOptions = await evaluate(`[...FALLBACK_SOURCE_MODE]`);
  assert.deepEqual(sourceModeOptions, ['M', 'ST', 'M/S'],
    `the source mode list must be the three documented modes (got ${JSON.stringify(sourceModeOptions)})`);
  // The oscillator's own three leaves. They share the backend's `SOURCE_TARGET_PARAMETERS` table with
  // `source_mode` and the other source rows, so each is looked up by key there and compared with the
  // fallback row of the same key.
  const oscillatorKeysExpected = ['osc_level', 'osc_mode', 'osc_freq'];
  const oscillatorFallbackRows = fallbackRows(indexHtmlForComparison, 'FALLBACK_SOURCE_PARAMETERS')
    .filter((row) => row.key.startsWith('osc_'));
  assert.deepEqual(oscillatorFallbackRows.map((row) => row.key), oscillatorKeysExpected,
    `FALLBACK_SOURCE_PARAMETERS must carry the three oscillator leaves (got ${JSON.stringify(oscillatorFallbackRows.map((row) => row.key))})`);
  for (const key of oscillatorKeysExpected) {
    const rustRow = parseRustRow(rustTable('SOURCE_TARGET_PARAMETERS').find((row) => new RegExp(`"${key}"`).test(row)));
    assert.ok(rustRow, `SOURCE_TARGET_PARAMETERS must still carry the ${key} row`);
    compareRow(`SOURCE_TARGET_PARAMETERS/${key}`, rustRow, oscillatorFallbackRows.find((row) => row.key === key));
  }
  // The families: `source_mode` reaches the twelve writable rows and not the oscillator (1781 is
  // `[RO]`), while the three `osc` leaves are the oscillator's alone. Both are read from the page and
  // compared with the rule the backend enforces in `source_parameter_allowed`.
  const sourceFamiliesInFallback = await evaluate(`(() => {
    const families = (key) => {
      const row = FALLBACK_SOURCE_PARAMETERS.find((parameter) => parameter.key === key);
      return row ? [...row.families] : [];
    };
    return {
      mode: families('source_mode').slice().sort(),
      oscillator: [...new Set(FALLBACK_SOURCE_PARAMETERS
        .filter((parameter) => parameter.key.startsWith('osc_'))
        .flatMap((parameter) => [...parameter.families]))].sort(),
    };
  })()`);
  assert.deepEqual(sourceFamiliesInFallback.mode,
    ['preamp_aes50a', 'preamp_aes50b', 'preamp_aes50c', 'preamp_aesebu', 'preamp_aux', 'preamp_card',
      'preamp_local', 'preamp_module', 'preamp_stageconnect', 'preamp_usbplayer', 'usb', 'usersig'],
    `source_mode must be declared for the twelve writable source rows (got ${JSON.stringify(sourceFamiliesInFallback.mode)})`);
  assert.ok(!sourceFamiliesInFallback.mode.includes('preamp_oscillator'),
    'the oscillator mode row is [RO] (1781) and must not be offered as a write');
  assert.deepEqual(sourceFamiliesInFallback.oscillator, ['preamp_oscillator'],
    `the osc leaves belong to /io/in/OSC alone (got ${JSON.stringify(sourceFamiliesInFallback.oscillator)})`);
  // The oracle test derives the expected first parameter from the catalogue, so the order itself is
  // pinned here: the first row the backend offers for a source is the first row the standalone
  // catalogue offers for `usb`. On both sides it is `source_mode`, which batch 3 placed at the head
  // of the source table — and the editor offers `parameters[0]` when a panel lands on a category, so
  // the two catalogues must agree on which key that is.
  const firstSourceRust = parseRustRow(rustTable('SOURCE_TARGET_PARAMETERS')[0]);
  const firstUsbFallback = await evaluate(`(targetCatalog.targetParametersByCategory.usb || [])[0]?.key || ''`);
  assert.equal(firstSourceRust?.key, 'source_mode',
    `SOURCE_TARGET_PARAMETERS must open with source_mode (got ${JSON.stringify(firstSourceRust)})`);
  assert.equal(firstUsbFallback, firstSourceRust.key,
    `the standalone catalogue must offer the backend's first source key first (got "${firstUsbFallback}", backend "${firstSourceRust.key}")`);
  // The rest of the `usb` list is mirrored against the same Rust table: the reduced catalogue keeps
  // its own rows for the source vocabulary it already published (`FALLBACK_USB_SOURCE_ROWS`), and a
  // range that drifts there is a value the standalone window would accept and the packaged app refuse.
  const usbFallbackRows = await evaluate(`[...FALLBACK_USB_SOURCE_ROWS]`);
  for (const key of ['gain', 'phantom_48v', 'mute', 'phase', 'name']) {
    const rustRow = parseRustRow(rustTable('SOURCE_TARGET_PARAMETERS').find((row) => new RegExp(`"${key}"`).test(row)));
    assert.ok(rustRow, `SOURCE_TARGET_PARAMETERS must still carry the ${key} row`);
    compareRow(`FALLBACK_USB_SOURCE_ROWS/${key}`, rustRow, usbFallbackRows.find((row) => row.key === key));
  }
  // The waveform list, the level's range and the frequency's, read from the page and compared with
  // the frozen values the brief carries (1790, 1792, 1793).
  const oscillatorFrozen = await evaluate(`(() => {
    const row = (key) => FALLBACK_SOURCE_PARAMETERS.find((parameter) => parameter.key === key);
    return {
      waveforms: [...FALLBACK_OSC_WAVEFORMS],
      level: { min: row('osc_level').min, max: row('osc_level').max },
      freq: { min: row('osc_freq').min, max: row('osc_freq').max, unit: row('osc_freq').unit, valueKind: row('osc_freq').valueKind },
    };
  })()`);
  assert.deepEqual(oscillatorFrozen.waveforms, ['SINE', 'PINK', 'WHITE'],
    `the waveform list must be the three documented shapes (got ${JSON.stringify(oscillatorFrozen.waveforms)})`);
  assert.deepEqual(oscillatorFrozen.level, { min: -40, max: 6 },
    `the level range must be -40…6 as documented at 1790 (got ${JSON.stringify(oscillatorFrozen.level)})`);
  assert.deepEqual(oscillatorFrozen.freq, { min: 20, max: 20000, unit: 'Hz', valueKind: 'hz' },
    `the frequency must be 20…20000 Hz (got ${JSON.stringify(oscillatorFrozen.freq)})`);
  console.log('batch 3: routing, I/O, source mode and oscillator contracts compared against crates/wing-core/src/lib.rs');

  // ── Batch 4's rows against the same Rust catalogue ─────────────────────────────────────────────
  //
  // The USB transport, the fader layer and the console status are transcribed from the Maillot
  // reference into both catalogues, so each row is compared field by field: the label, the OSC
  // argument kind, the value kind, the range, the documented length and the writability. The closed
  // lists are compared as lists — through the constant each `choice(...)` row names, so a drifted
  // option list cannot hide behind a shared hint — and the categories themselves are compared with
  // `TARGET_CATEGORIES`, because the batch adds six of them and their flags *are* the write/watch
  // split. The two seams the batch 4 editor keeps as name lists (which categories carry no id
  // segment, which are addressed by a letter) are compared with `category_id_segment` too: they are
  // mirrors, and a mirror is exactly the thing that drifts.
  const batch4Tables = [
    ['REC_TARGET_PARAMETERS', 'FALLBACK_REC_PARAMETERS'],
    ['REC_STATE_PARAMETERS', 'FALLBACK_REC_STATE_PARAMETERS'],
    ['PLAY_TARGET_PARAMETERS', 'FALLBACK_PLAY_PARAMETERS'],
    ['PLAY_STATE_PARAMETERS', 'FALLBACK_PLAY_STATE_PARAMETERS'],
    ['LAYER_TARGET_PARAMETERS', 'FALLBACK_LAYER_PARAMETERS'],
    ['STAT_STATE_PARAMETERS', 'FALLBACK_STAT_PARAMETERS'],
  ];
  const batch4RustRaw = new Map();
  for (const [rustName, fallbackName] of batch4Tables) {
    const rawRows = rustTable(rustName);
    const rustRows = rawRows.map(parseRustRow).filter(Boolean);
    assert.ok(rustRows.length > 0, `${rustName} must still hold the backend's rows`);
    rawRows.forEach((row) => {
      const parsed = parseRustRow(row);
      if (parsed) batch4RustRaw.set(parsed.key, row);
    });
    const mine = fallbackRows(indexHtmlForComparison, fallbackName);
    assert.deepEqual(mine.map((row) => row.key), rustRows.map((row) => row.key),
      `${fallbackName} must offer exactly the keys the backend carries (got ${JSON.stringify(mine.map((row) => row.key))})`);
    for (const rustRow of rustRows) {
      const fallbackRow = mine.find((row) => row.key === rustRow.key);
      assert.ok(fallbackRow, `the standalone table must carry ${rustRow.key}`);
      compareRow(`${fallbackName}/${rustRow.key}`, rustRow, fallbackRow);
    }
  }
  // The transport leaves are written and never reported; the state rows the other way round. That is
  // the split the whole batch is about, so it is asserted on the Rust side as well.
  for (const [key, watchable] of [
    ['rec_action', false], ['rec_path', false], ['rec_resolution', false], ['rec_channels', false],
    ['play_action', false], ['play_file', false], ['play_repeat', false],
    ['rec_state', true], ['rec_time', true], ['play_state', true], ['play_position', true],
    ['layer_select', true], ['selected_strip', true], ['selected_page', true],
  ]) {
    const rustRow = parseRustRow(batch4RustRaw.get(key));
    assert.ok(rustRow, `crates/wing-core/src/lib.rs must still carry the ${key} row`);
    assert.equal(rustRow.canTrigger, watchable,
      `${key} must be ${watchable ? 'watchable' : 'written only'} in the backend catalogue (got canTrigger ${rustRow.canTrigger})`);
  }
  // The closed lists, resolved through the constant each row names.
  const batch4PageOptions = await evaluate(`(() => ({
    recAction: [...FALLBACK_REC_ACTIONS],
    recResolution: [...FALLBACK_REC_RESOLUTIONS],
    recChannels: [...FALLBACK_REC_CHANNELS],
    recState: [...FALLBACK_REC_STATES],
    playAction: [...FALLBACK_PLAY_ACTIONS],
    playState: [...FALLBACK_PLAY_STATES],
    layerNames: idDestinationNames('layer'),
  }))()`);
  for (const [key, expected] of [
    ['rec_action', batch4PageOptions.recAction],
    ['rec_resolution', batch4PageOptions.recResolution],
    ['rec_channels', batch4PageOptions.recChannels],
    ['rec_state', batch4PageOptions.recState],
    ['play_action', batch4PageOptions.playAction],
    ['play_state', batch4PageOptions.playState],
  ]) {
    const resolved = rustChoiceOptions(batch4RustRaw.get(key));
    assert.ok(resolved, `the backend's ${key} row must still name a list of options this test can resolve`);
    assert.deepEqual(resolved, expected,
      `${key}: the backend option list must be exactly the documented one (got ${JSON.stringify(resolved)}, expected ${JSON.stringify(expected)})`);
  }
  // The seven layer letters are the readout's own names: 1 = L … 7 = VRT, on both sides.
  const rustLayerLetters = /const FADER_LAYER_LETTERS: &\[&str\] = &\[([^\]]*)\]/.exec(rustCatalogue);
  assert.ok(rustLayerLetters, 'crates/wing-core/src/lib.rs must still declare FADER_LAYER_LETTERS');
  assert.deepEqual([...rustLayerLetters[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]), batch4PageOptions.layerNames,
    'the seven letters the resolver puts in the path must be the seven the editor readout names');
  // The six categories: the label, the group, the count, the prefix and both flags, compared with
  // the backend's `TARGET_CATEGORIES`.
  const rustCategoryRows = [...rustCatalogue.matchAll(/category\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*,\s*(true|false)\s*,?\s*\)/g)]
    .map((match) => ({
      key: match[1], label: match[2], group: match[3], count: Number(match[4]), prefix: match[5],
      canTrigger: match[6] === 'true', canTarget: match[7] === 'true',
    }));
  assert.ok(rustCategoryRows.length > 10, 'TARGET_CATEGORIES must still be parseable');
  const batch4PageCategories = await evaluate(`targetCatalog.categories
    .filter((category) => ['layer', 'rec', 'recstate', 'play', 'playstate', 'stat'].includes(category.key))
    .map((category) => ({
      key: category.key, label: category.label, group: category.group, count: category.count,
      prefix: category.prefix, canTrigger: category.canTrigger, canTarget: category.canTarget,
    }))`);
  assert.equal(batch4PageCategories.length, 6, 'the standalone catalogue must carry the six batch-4 categories');
  for (const mine of batch4PageCategories) {
    const backend = rustCategoryRows.find((row) => row.key === mine.key);
    assert.ok(backend, `TARGET_CATEGORIES must still carry ${mine.key}`);
    assert.deepEqual(mine, backend,
      `the standalone ${mine.key} category must mirror the backend catalogue (got ${JSON.stringify(mine)}, backend ${JSON.stringify(backend)})`);
  }
  // The two id seams the editor mirrors as name lists: index-less categories and letter-addressed
  // ones. `category_id_segment` is the backend's own answer, so the two cannot drift. A variant may
  // be declared in more than one arm — batch 6 added a second `Absent` arm rather than growing the
  // first past readability — so every arm is collected and unioned; reading only the first would
  // report the batch-6 names as missing while the backend resolves them.
  const rustSegmentArm = (variant) => {
    const arms = [...rustCatalogue.matchAll(new RegExp(`((?:"[a-z0-9_]+"\\s*\\|\\s*)*"[a-z0-9_]+")\\s*=>\\s*\\{?\\s*CategoryIdSegment::${variant}`, 'g'))];
    if (arms.length === 0) return null;
    const names = arms.flatMap((arm) => [...arm[1].matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]));
    return [...new Set(names)].sort();
  };
  const pageIdSeams = await evaluate(`({
    indexLess: [...INDEX_LESS_CATEGORIES].sort(),
    letter: [...ID_SEGMENT_NAME_CATEGORIES.keys()].sort(),
  })`);
  // Batch 6 is written against `lib.rs` by another agent in the same working tree, so the page may
  // carry the six index-less categories and the AES50 letter seam before the backend does. Until
  // `lib.rs` mentions one of the batch-6 categories the comparison ignores exactly those names and
  // stays strict about everything before them; the moment one lands, the tolerance is gone and a
  // half-landed batch is a failure — the same "not landed yet" rule the batch-5 section uses, and it
  // cannot hide a drift inside the batch-4 names themselves.
  const batch6IndexLessSeam = ['cards', 'deskstatus', 'globals', 'lights', 'safes', 'solocfg'];
  const batch6LetterSeam = ['aes50'];
  // Same shape as batch 5: a floor first, so a total regression cannot flip this back to "not landed yet".
  {
    const batch6Names = batch6IndexLessSeam.concat(batch6LetterSeam);
    const carried = batch6Names.filter((name) => rustCategoryRows.some((row) => row.key === name)).length;
    assert.ok(carried >= batch6Names.length,
      `crates/wing-core/src/lib.rs must carry the ${batch6Names.length} batch-6 category names (it carries ${carried})`);
  }
  const batch6SeamLanded = rustCategoryRows.some((row) => batch6IndexLessSeam.concat(batch6LetterSeam).includes(row.key));
  const seamComparison = (pageNames, rustNames) => (batch6SeamLanded
    ? { page: pageNames, rust: rustNames }
    : {
      page: pageNames.filter((name) => !batch6IndexLessSeam.concat(batch6LetterSeam).includes(name)),
      rust: (rustNames || []).filter((name) => !batch6IndexLessSeam.concat(batch6LetterSeam).includes(name)),
    });
  const indexLessSeam = seamComparison(pageIdSeams.indexLess, rustSegmentArm('Absent'));
  assert.deepEqual(indexLessSeam.page, indexLessSeam.rust,
    'INDEX_LESS_CATEGORIES must name exactly the categories the backend resolves without an id segment'
    + (batch6SeamLanded ? '' : ' (the six batch-6 names are tolerated until crates/wing-core/src/lib.rs carries them)'));
  const letterSeam = seamComparison(pageIdSeams.letter, rustSegmentArm('Letter'));
  assert.deepEqual(letterSeam.page, letterSeam.rust,
    'ID_SEGMENT_NAME_CATEGORIES must name exactly the categories the backend resolves by letter'
    + (batch6SeamLanded ? '' : ' (aes50 is tolerated until crates/wing-core/src/lib.rs carries it)'));
  if (!batch6SeamLanded) {
    console.warn('batch 6: crates/wing-core/src/lib.rs carries none of the nine batch-6 categories yet,'
      + ' so the id-seam comparison tolerates exactly the batch-6 names; every name from the earlier batches is still strict');
  }
  console.log('batch 4: transport, fader layer and console status contracts compared against crates/wing-core/src/lib.rs');

  // ── Batch 5's rows against the same Rust catalogue ─────────────────────────────────────────────
  //
  // The strip long tail is transcribed from the Maillot reference into both catalogues, so each row
  // is compared field by field: the label, the OSC argument kind, the value kind, the range, the
  // documented length and the writability. The shared row of a per-family key is the **channel**
  // default on both sides — the first family the document prints for it (2063 for `eq_mix`, 2059 for
  // `eq_model`, 2069 and 2094 for the two shelf types, 2136 for the dynamics sidechain tap) — while
  // the overlay's own answers are pinned family by family in the section above, where the page's rows
  // really carry them. The reduced catalogue carries other batches' keys as well and deliberately
  // lacks the gate/dynamics/EQ band rows the backend publishes, so the comparison walks the batch's
  // own frozen key list rather than the whole table.
  //
  // The closed lists are compared by value, never by the constant's name: the shared row is resolved
  // through whatever `const NAME: &[&str] = &[…]` its `choice(...)` names, and every per-family list
  // must exist in the Rust catalogue as a literal list holding exactly the documented values.
  const batch5FrozenKeys = [
    'bus_mono', 'input_balance', 'source_auto',
    'peq_on', 'peq_1_gain', 'peq_1_freq', 'peq_1_q', 'peq_2_gain', 'peq_2_freq', 'peq_2_q',
    'peq_3_gain', 'peq_3_freq', 'peq_3_q',
    'gate_mix', 'gate_gain', 'gate_accent',
    'dyn_detector', 'dyn_envelope', 'dyn_auto',
    'flt_low_slope', 'flt_high_slope', 'flt_tool', 'flt_model', 'flt_tilt',
    'gate_sc_type', 'gate_sc_freq', 'gate_sc_q', 'gate_sc_source', 'gate_sc_tap',
    'dyn_sc_type', 'dyn_sc_freq', 'dyn_sc_q', 'dyn_sc_source', 'dyn_sc_tap',
    'proc_order', 'tags',
    'eq_model', 'eq_mix', 'eq_low_type', 'eq_high_type', 'eq_tilt',
  ];
  assert.equal(batch5FrozenKeys.length, 41, 'the batch-5 brief fixes forty-one keys');
  const batch5RustRaw = new Map();
  for (const row of rustTable('MIX_BASE_TARGET_PARAMETERS')) {
    const parsed = parseRustRow(row);
    if (parsed) batch5RustRaw.set(parsed.key, row);
  }
  const batch5FallbackRows = fallbackRows(indexHtmlForComparison, 'FALLBACK_MIX_ROWS');
  // The backend half of this batch is written against the same frozen names by another agent, so the
  // working tree this test runs in may not carry the keys yet. None present is the batch not landed:
  // the note is printed loudly and the comparison below is skipped, because asserting against a
  // catalogue that has no such rows would only say the backend is missing. The moment one key lands
  // every assertion becomes strict — a half-landed batch is a failure, not a skip — and nothing here
  // can pass while a row that exists disagrees with the fallback.
  // The tolerance below fires when the backend carries *none* of the batch — which is exactly what a total
  // regression looks like, so it must not be the only guard: the floor makes deleting the batch a failure
  // (audit 2026-10-02, S7).
  assert.ok(batch5RustRaw.size >= batch5FrozenKeys.length,
    `crates/wing-core/src/lib.rs must carry the ${batch5FrozenKeys.length} batch-5 keys (it carries ${batch5RustRaw.size})`);
  const batch5BackendLanded = batch5FrozenKeys.some((key) => batch5RustRaw.has(key));
  if (!batch5BackendLanded) {
    console.warn('batch 5: crates/wing-core/src/lib.rs carries none of the forty-one batch-5 keys yet,'
      + ' so the mirror comparison is skipped; the fallback rows above are still held to the frozen brief');
  } else {
    for (const key of batch5FrozenKeys) {
      const raw = batch5RustRaw.get(key);
      assert.ok(raw, `MIX_BASE_TARGET_PARAMETERS must still carry the batch-5 ${key} row`);
      const mine = batch5FallbackRows.find((row) => row.key === key);
      assert.ok(mine, `the standalone mix table must carry ${key}`);
      compareRow(`FALLBACK_MIX_ROWS/${key}`, parseRustRow(raw), mine);
    }
    // The shared option list of every batch-5 choice row, resolved through the constant it names.
    for (const [key, expected] of Object.entries(batch5FrozenOptions)) {
      const resolved = rustChoiceOptions(batch5RustRaw.get(key));
      assert.ok(resolved,
        `the backend's ${key} row must still name an option list this test can resolve`);
      assert.deepEqual(resolved, expected,
        `${key}: the backend's shared option list must be the documented channel default (got ${JSON.stringify(resolved)}, expected ${JSON.stringify(expected)})`);
    }
    // The per-family lists, by value: an aux shelf type, the output families' crossover and model
    // lists and the desk's sidechain tap list are not the shared row's, so they are looked for as
    // literal lists with exactly the documented values — a renamed constant is fine, a changed list
    // is not.
    const rustListByValue = (values) => {
      const wanted = JSON.stringify(values);
      return [...rustCatalogue.matchAll(/\[([^\[\]]*)\]/g)]
        .some((group) => JSON.stringify([...group[1].matchAll(/"([^"]*)"/g)].map((match) => match[1])) === wanted);
    };
    for (const [label, values] of [
      ['the aux EQ model list', batch5FrozenLists.eqModelsAux],
      ['the output EQ model list', batch5FrozenLists.eqModelsOut],
      ['the aux shelf-type list', batch5FrozenLists.shelfAux],
      ['the thirteen crossover types', batch5FrozenLists.crossover],
      ['the desk sidechain tap list', batch5FrozenLists.tapsOther],
      ['the twenty-four process orders', batch5FrozenLists.processOrders],
      ['the channel sidechain source list', batch5FrozenLists.channelSources],
      ['the desk sidechain source list', batch5FrozenLists.mixSources],
    ]) {
      assert.ok(rustListByValue(values),
        `crates/wing-core/src/lib.rs must declare ${label} with exactly these values: ${JSON.stringify(values)}`);
    }
    // The seven model leaves name the slot the editor travels with, and the map may hold the pairs in
    // an arm or in a table, so the key and the pair are looked for close together rather than in one
    // shape. `eq_model` is the model selector itself and must map nothing: the appendix tables
    // exclude `mdl`, so a slot on it would make the backend refuse every step that selects a model.
    for (const [key, section, leaf] of [
      ['gate_mix', 'gate', 'mix'], ['gate_gain', 'gate', 'gain'], ['gate_accent', 'gate', 'acc'],
      ['dyn_detector', 'dyn', 'det'], ['dyn_envelope', 'dyn', 'env'], ['dyn_auto', 'dyn', 'auto'],
      ['eq_tilt', 'eq', 'tilt'],
    ]) {
      assert.ok(new RegExp(`"${key}"[\\s\\S]{0,80}?"${section}"\\s*,\\s*"${leaf}"`).test(rustCatalogue),
        `the backend's model map must still give ${key} the ${section} leaf ${leaf}`);
    }
    const rustModelLeafMap = rustCatalogue.slice(
      rustCatalogue.indexOf('fn model_leaf_name'),
      rustCatalogue.indexOf('fn is_meter_parameter'),
    );
    assert.ok(rustModelLeafMap.includes('fn model_leaf_name'),
      'crates/wing-core/src/lib.rs must still declare model_leaf_name');
    assert.ok(!/"eq_model"\s*=>/.test(rustModelLeafMap),
      'model_leaf_name must not map eq_model: `mdl` is excluded from the model tables, so a slot on the model selector would refuse every step that sets one');
    console.log('batch 5: the strip long tail compared against crates/wing-core/src/lib.rs');
  }

  // ── Batch 6's rows against the same Rust catalogue ─────────────────────────────────────────────
  //
  // The desk level is transcribed from the Maillot reference into both catalogues, so each row is
  // compared field by field: the label, the OSC argument kind, the value kind, the range, the
  // documented length and the writability — plus the option list of every closed row, resolved
  // through the constant the `choice(...)` names.
  //
  // The backend half is written against the same names by another agent in this same working tree, so
  // the comparison walks the batch's own key list rather than any one Rust table: the nine categories
  // put their keys in several tables (AES50's five are split across the two sides of its node, the
  // W-Live card's eleven across two more), and a key found in any `TargetParameterInfo` table is
  // compared. The list carries three keys the brief's own frozen list did not name —
  // `solo_source_state`, `solo_source_group` and `solo_source_input`, the
  // `$srcsolo`/`$srcsgrp`/`$srcsin` leaves at 1392-1394 — and five more on the W-Live card
  // (`editmarker`, `deletemarker`, `deletesession`, `stime`, `namesession`, 2971-2982), because the
  // landed backend offers them and the standalone catalogue may not silently fall behind it.
  const batch6FrozenKeys = Object.values(batch6KeysByCategory).flat();
  assert.equal(batch6FrozenKeys.length, 130, 'the batch offers 130 keys across its nine categories');
  const batch6BriefNamedKeys = [
    'lights_btns', 'lights_leds', 'lights_meters', 'lights_rgbleds', 'lights_chlcds', 'lights_chlcdctr',
    'lights_main', 'lights_glow', 'lights_patch', 'lights_lamp', 'lights_chedit',
    'safes_ch', 'safes_aux', 'safes_bus', 'safes_main', 'safes_mtx', 'safes_dca', 'safes_mute', 'safes_fx',
    'monitor_pan', 'monitor_width', 'monitor_dim', 'monitor_source', 'monitor_level',
    'solo_mode', 'solo_monitor', 'solo_mute', 'solo_dim', 'solo_mono', 'solo_flip', 'solo_channel_tap',
    'solo_bus_tap', 'solo_main_tap', 'solo_matrix_tap', 'solo_source',
    'aes50_state', 'aes50_device', 'aes50_errors_corrected', 'aes50_errors_uncorrected', 'aes50_clear_errors',
    'desk_lock', 'desk_ppm',
    'wlive_control', 'wlive_open_session', 'wlive_marker_goto', 'wlive_marker_set', 'wlive_format_card',
    'wlive_state', 'cards_type', 'cards_version',
    'global_clock_rate', 'global_clock_source', 'global_start_mute', 'global_usb_config',
    'global_stageconnect_config',
  ];
  for (const key of batch6BriefNamedKeys) {
    assert.ok(batch6FrozenKeys.includes(key), `the frozen brief names ${key}, so the catalogue must carry it`);
  }
  const batch6FrozenOptions = {
    monitor_source: batch6MonitorSources,
    monitor_direct_in: batch6MonitorDirectIns,
    solo_mode: ['LIVE', 'STUDIO', 'SIP'],
    solo_monitor: ['PH', 'SPK', 'PH+SPK'],
    solo_channel_tap: ['PFL', 'AFL'],
    solo_bus_tap: ['PFL', 'AFL'],
    solo_main_tap: ['PFL', 'AFL'],
    solo_matrix_tap: ['PFL', 'AFL'],
    solo_source: ['OFF', 'CH39', 'AUX7'],
    aes50_state: ['-', 'OK', 'ERR', 'UPD'],
    wlive_control: ['STOP', 'PPAUSE', 'PLAY', 'REC'],
    wlive_state: ['STOP', 'PPAUSE', 'PLAY', 'REC'],
    cards_type: ['NONE', 'WLIVE', 'WDANTE', 'WMADI', 'WDWSG'],
    global_clock_rate: ['48000.0', '44100.0'],
    global_clock_source: ['INT', 'A', 'B', 'C', 'AES', 'CARD', 'MOD'],
    global_usb_config: ['2/2', '8/8', '16/16', '32/32', '48/48'],
    global_stageconnect_config: batch6StageConnectConfigs,
  };
  // Every `const NAME: &[TargetParameterInfo] = &[…]` in the backend, flattened into one key → row
  // map: which table a key lives in is the backend's business, that the key exists and agrees with
  // the standalone catalogue is not. The rows are split here rather than through `rustTable` because
  // a declaration may put its initialiser on the next line (`TRIGGER_METER_PARAMETERS` does), which
  // that helper's single-line anchor refuses.
  const rustRowsByKey = new Map();
  for (const declaration of rustCatalogue.matchAll(/^\s*const ([A-Z0-9_]+)\s*:\s*&\[TargetParameterInfo\]\s*=\s*&\[/gm)) {
    const equals = rustCatalogue.indexOf('=', declaration.index);
    const open = rustCatalogue.indexOf('&[', equals);
    const end = rustCatalogue.indexOf('];', open);
    const body = rustCatalogue.slice(open + 2, end).replace(/^\s*\/\/.*$/gm, '');
    const pieces = [];
    let depth = 0;
    let current = '';
    for (const character of body) {
      if (character === ',' && depth === 0) {
        if (current.trim()) pieces.push(current.trim());
        current = '';
        continue;
      }
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      current += character;
    }
    if (current.trim()) pieces.push(current.trim());
    for (const row of pieces) {
      const parsed = parseRustRow(row);
      if (parsed && !rustRowsByKey.has(parsed.key)) rustRowsByKey.set(parsed.key, { raw: row, parsed });
    }
  }
  const batch6FallbackRows = new Map();
  for (const list of [batch6Catalogue.lights, batch6Catalogue.safes, batch6Catalogue.monitorTrigger,
    batch6Catalogue.soloTrigger, batch6Catalogue.aes50Trigger, batch6Catalogue.aes50Target,
    batch6Catalogue.deskTrigger, batch6Catalogue.wliveTarget, batch6Catalogue.wliveTrigger,
    batch6Catalogue.cardsTrigger, batch6Catalogue.globalTarget]) {
    for (const row of list) batch6FallbackRows.set(row.key, row);
  }
  const batch6BackendLanded = batch6FrozenKeys.some((key) => rustRowsByKey.has(key));
  if (!batch6BackendLanded) {
    console.warn('batch 6: crates/wing-core/src/lib.rs carries none of the batch-6 keys yet,'
      + ' so the mirror comparison is skipped; the fallback rows above are still held to the frozen brief');
  } else {
    for (const key of batch6FrozenKeys) {
      const mine = batch6FallbackRows.get(key);
      assert.ok(mine, `the standalone catalogue must carry ${key}`);
      const backend = rustRowsByKey.get(key);
      assert.ok(backend, `crates/wing-core/src/lib.rs must carry the batch-6 ${key} row`);
      compareRow(`batch6/${key}`, backend.parsed, mine);
    }
    // The closed lists, resolved through the constant each `choice(...)` row names: a drifted list
    // cannot hide behind a hint both catalogues share.
    for (const [key, expected] of Object.entries(batch6FrozenOptions)) {
      const backend = rustRowsByKey.get(key);
      assert.ok(backend, `crates/wing-core/src/lib.rs must carry the ${key} row`);
      const resolved = rustChoiceOptions(backend.raw);
      assert.ok(resolved, `the backend's ${key} row must still name an option list this test can resolve`);
      assert.deepEqual(resolved, expected,
        `${key}: the backend option list must be exactly the documented one (got ${JSON.stringify(resolved)}, expected ${JSON.stringify(expected)})`);
    }
    // The ON/OFF wording and the seed of every batch-6 toggle, against the arm that publishes them:
    // `parameter_value_metadata` in `desktop/src-tauri/src/main.rs`. A plain browser tab draws the
    // fallback's labels where the packaged app draws the backend's, so a switch whose 0/1 wording
    // differs between the two reads as a different control. The two seeds matter more than the
    // wording: the backend seeds `wlive_format_card` at 0 (formatting erases every session on the
    // card) and `monitor_delay_on` at 1 (a processing switch, like `eq_on` and `peqt_on`), and the
    // read-only switches at 0 so a new step cannot claim to have pressed one.
    const mainRsSource = fs.readFileSync(path.join(repoRoot, 'desktop/src-tauri/src/main.rs'), 'utf8');
    const metadataArm = (name) => {
      const marker = `metadata.${name} = Some(match key {`;
      const start = mainRsSource.indexOf(marker);
      assert.ok(start >= 0, `main.rs must still publish ${name} through parameter_value_metadata`);
      const end = mainRsSource.indexOf('});', start);
      const body = mainRsSource.slice(start + marker.length, end);
      const pairs = new Map();
      // A key may share its arm with alternatives, listed on one line or wrapped across several:
      // (`"a" | "b" => "label"` and `"a"\n | "b" => "label"` are both read).
      for (const match of body.matchAll(/((?:"[a-z0-9_]+"\s*(?:\|\s*)?)+)\s*=>\s*"((?:[^"\\]|\\.)*)"/g)) {
        for (const key of match[1].matchAll(/"([a-z0-9_]+)"/g)) {
          if (!pairs.has(key[1])) pairs.set(key[1], match[2]);
        }
      }
      return { pairs, armDefault: /_\s*=>\s*"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] };
    };
    const batch6ToggleKeys = ['monitor_invert', 'monitor_eq_on', 'monitor_delay_on', 'solo_mute', 'solo_dim',
      'solo_mono', 'solo_flip', 'solo_source_state', 'aes50_clear_errors', 'desk_lock', 'wlive_marker_set',
      'wlive_format_card', 'global_start_mute'];
    const offLabels = metadataArm('off_label');
    const onLabels = metadataArm('on_label');
    const seeds = metadataArm('default_value');
    for (const key of batch6ToggleKeys) {
      const row = batch6FallbackRows.get(key);
      assert.ok(row, `the standalone catalogue must carry the batch-6 toggle ${key}`);
      assert.equal(row.valueKind, 'toggle', `${key} must still be a 0/1 toggle in the standalone catalogue`);
      assert.equal(row.offLabel, offLabels.pairs.get(key) ?? offLabels.armDefault,
        `${key}: the fallback's OFF wording must be the one parameter_value_metadata publishes (got ${JSON.stringify(row.offLabel)})`);
      assert.equal(row.onLabel, onLabels.pairs.get(key) ?? onLabels.armDefault,
        `${key}: the fallback's ON wording must be the one parameter_value_metadata publishes (got ${JSON.stringify(row.onLabel)})`);
      assert.equal(row.defaultValue, seeds.pairs.get(key) ?? seeds.armDefault,
        `${key}: the fallback must seed the value parameter_value_metadata seeds (got ${JSON.stringify(row.defaultValue)})`);
    }
    console.log('batch 6: the toggle wording and the seeds compared against desktop/src-tauri/src/main.rs');
    // The nine categories: the label, the group, the count, the prefix and both flags.
    for (const mine of batch6Catalogue.categories) {
      const backend = rustCategoryRows.find((row) => row.key === mine.key);
      assert.ok(backend, `TARGET_CATEGORIES must still carry ${mine.key}`);
      assert.deepEqual(mine, backend,
        `the standalone ${mine.key} category must mirror the backend catalogue (got ${JSON.stringify(mine)}, backend ${JSON.stringify(backend)})`);
    }
    // The two seams, strictly now that the backend carries the batch: the six index-less node names
    // and the AES50 letter segment.
    const rustIndexLess = rustSegmentArm('Absent') || [];
    for (const category of ['lights', 'safes', 'solocfg', 'deskstatus', 'cards', 'globals']) {
      assert.ok(rustIndexLess.includes(category),
        `the backend must resolve ${category} without an id segment (got ${JSON.stringify(rustIndexLess)})`);
    }
    assert.ok((rustSegmentArm('Letter') || []).includes('aes50'),
      `the backend must resolve aes50 by the port letter (got ${JSON.stringify(rustSegmentArm('Letter'))})`);
    console.log('batch 6: the desk level compared against crates/wing-core/src/lib.rs');
  }

  // ── The Rearm hint: a margin above the recent minimum, not a drop below the threshold ──────────
  //
  // `INSPECTOR_HINTS['trigger-rearm-db']` described the detector as needing a fall below the
  // threshold, while `normalize_trigger_policy` in `desktop/src-tauri/src/main.rs` treats `rearm_db`
  // as a margin above the lowest value seen since the run. The contract fixes the ideas that must be
  // there and the phrases that must not — not the whole sentence, which would make it a style checker.
  await setSelect('trigger-category', 'usb');
  // The four tuning fields carry `.meter-tuning-field`, and `updateTriggerKindUi` hides them with
  // `.hidden` while a Response preset owns them (index.html:13282-13284); `.form-grid > .hidden` is
  // `visibility: hidden` (index.html:2791-2794), which is exactly what `fieldIsOnScreen` refuses.
  // Choosing Custom is what an operator does to edit them, and it is what puts them on screen.
  await setSelect('trigger-response-preset', 'custom');
  await setSelect('trigger-parameter', 'meter');
  await evaluate(`document.getElementById('meter-response-details').open = true`);
  // `focus()` plus the event the Inspector actually listens for (`focusin`, index.html), so the check
  // does not depend on whether the headless window itself owns the system focus.
  await evaluate(`(() => {
    const field = document.getElementById('trigger-rearm-db');
    field.focus();
    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  })()`);
  await sleep(80);
  const rearmHint = await evaluate(`(() => {
    const hint = INSPECTOR_HINTS['trigger-rearm-db'] || {};
    return {
      desc: hint.desc || '',
      tip: hint.tip || '',
      shownDesc: document.getElementById('inspector-desc').textContent,
      shownTip: document.getElementById('inspector-tip').textContent,
    };
  })()`);
  const rearmHintText = `${rearmHint.desc} ${rearmHint.tip}`;
  assert.match(rearmHintText, /lowest value/i,
    `the Rearm hint must name the recent minimum it measures from (got "${rearmHintText}")`);
  assert.match(rearmHintText, /\brises?\b/i,
    `the Rearm hint must say the signal rises (got "${rearmHintText}")`);
  assert.match(rearmHintText, /since that trigger|since the previous run/i,
    `the Rearm hint must say what the minimum is measured since (got "${rearmHintText}")`);
  for (const phrase of ['drop below threshold', 'below the threshold required', 'threshold required before']) {
    assert.doesNotMatch(rearmHintText, new RegExp(phrase, 'i'),
      `the Rearm hint must not describe a drop below the threshold (found "${phrase}" in "${rearmHintText}")`);
  }
  // …and it is the hint the operator actually meets: focusing the field paints it in the Inspector.
  assert.equal(rearmHint.shownDesc, rearmHint.desc,
    `the Inspector must show the Rearm hint itself (got "${rearmHint.shownDesc}")`);
  assert.equal(rearmHint.shownTip, rearmHint.tip,
    `the Inspector must show the Rearm tip itself (got "${rearmHint.shownTip}")`);
  // The guide and the hint must tell the same story — both name the recent minimum, and neither
  // revives the drop-below-threshold rule — or the operator reads one thing in the manual and another
  // in the editor. `test-desktop-guide-content.mjs` already keeps the generated copy in step with the
  // Markdown this reads.
  const triggerGuide = fs.readFileSync(path.join(repoRoot, 'docs/guide/02-triggers.md'), 'utf8');
  assert.match(triggerGuide, /lowest value|recent minimum/i,
    'the trigger guide must name the recent minimum the Rearm margin is measured from');
  assert.doesNotMatch(triggerGuide, /drop below the threshold|below the threshold required|threshold required before/i,
    'the trigger guide must not say re-arming needs a drop below the threshold');
  console.log('rearm hint: the margin above the recent minimum, not a drop below the threshold');

  // ── The six timing fields carry the runtime's own clamps ───────────────────────────────────────
  //
  // `normalize_trigger_policy` and the step normaliser in `desktop/src-tauri/src/main.rs` clamp rearm
  // to 0.1..24 dB, cooldown to 0..2000 ms, dwell to 0..1000 ms, stale to 250..10000 ms and every
  // step's delay/fade to 0..60000 / 20..60000 ms. The editor used to offer -144..12 dB for Rearm, so
  // it refused part of the accepted range and accepted a value the backend clamps away.
  const timingRules = await evaluate(`(() => {
    const read = (id) => { const rule = FIELD_RULES[id]; return { min: rule.min, max: rule.max, step: rule.step }; };
    return {
      rearm: read('trigger-rearm-db'), cooldown: read('trigger-cooldown-ms'), dwell: read('trigger-dwell-ms'),
      stale: read('trigger-stale-ms'), delay: read('delay-ms'), fade: read('fade-ms'),
    };
  })()`);
  assert.deepEqual(timingRules, {
    rearm: { min: 0.1, max: 24, step: 0.1 },
    cooldown: { min: 0, max: 2000, step: 1 },
    dwell: { min: 0, max: 1000, step: 1 },
    stale: { min: 250, max: 10000, step: 1 },
    delay: { min: 0, max: 60000, step: 1 },
    fade: { min: 20, max: 60000, step: 1 },
  }, `the six timing fields must carry the runtime's clamps (got ${JSON.stringify(timingRules)})`);

  // One step past each bound, typed into the visible field: the field is marked and the reason names
  // the bound it used. The four trigger timers live in the Advanced Trigger Tuning drawer, opened
  // above with the Custom preset; the delay field is only on screen in the step's wait mode and the
  // fade field needs a continuous target, so those two are driven through the very rule their input
  // handler uses.
  //
  // The visibility is asserted, not assumed: a `.hidden` tuning field is `visibility: hidden`, so
  // without the Custom preset `refreshFieldValidity` returns without marking and every refusal below
  // would fail while the rule was right. That is how this contract first went red.
  const timingFieldsOnScreen = await evaluate(`['trigger-rearm-db', 'trigger-cooldown-ms', 'trigger-dwell-ms', 'trigger-stale-ms']
    .every((id) => fieldIsOnScreen(document.getElementById(id)))`);
  assert.equal(timingFieldsOnScreen, true,
    'the four timing fields must be on screen for the range contract to mean anything (choose the Custom response preset)');
  const refusedTimingValue = async (id, value, pattern) => {
    await type(id, value);
    await sleep(120);
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}).classList.contains('is-invalid')`), true,
      `${id} must refuse ${value}: the runtime's limit is ${pattern}`);
    const problem = await evaluate(`document.getElementById(${JSON.stringify(id)} + '-problem')?.textContent || ''`);
    assert.match(problem, pattern, `the ${id} refusal must name the bound it used (got "${problem}")`);
  };
  await refusedTimingValue('trigger-rearm-db', '0', /cannot be lower than 0\.1 dB/);
  await refusedTimingValue('trigger-rearm-db', '24.1', /cannot be higher than 24 dB/);
  await refusedTimingValue('trigger-cooldown-ms', '2001', /cannot be higher than 2000 ms/);
  await refusedTimingValue('trigger-dwell-ms', '1001', /cannot be higher than 1000 ms/);
  await refusedTimingValue('trigger-stale-ms', '249', /cannot be lower than 250 ms/);
  const hiddenTimingProblems = await evaluate(`({
    delay: fieldProblem('delay-ms', '60001'),
    fade: fieldProblem('fade-ms', '19'),
  })`);
  assert.match(String(hiddenTimingProblems.delay), /cannot be higher than 60000 ms/,
    `a delay past 60 s must be refused by the rule the field uses (got "${hiddenTimingProblems.delay}")`);
  assert.match(String(hiddenTimingProblems.fade), /cannot be lower than 20 ms/,
    `a fade below 20 ms must be refused by the rule the field uses (got "${hiddenTimingProblems.fade}")`);

  // …and the endpoints themselves are accepted: they are the runtime's limits, not roundings.
  const timingExtremes = await evaluate(`(() => {
    const cases = [
      ['trigger-rearm-db', '0.1'], ['trigger-rearm-db', '24'],
      ['trigger-cooldown-ms', '0'], ['trigger-cooldown-ms', '2000'],
      ['trigger-dwell-ms', '0'], ['trigger-dwell-ms', '1000'],
      ['trigger-stale-ms', '250'], ['trigger-stale-ms', '10000'],
      ['delay-ms', '0'], ['delay-ms', '60000'],
      ['fade-ms', '20'], ['fade-ms', '60000'],
    ];
    return cases.map(([id, value]) => ({ id, value, problem: fieldProblem(id, value) }));
  })()`);
  for (const entry of timingExtremes) {
    assert.equal(entry.problem, null,
      `${entry.id} = ${entry.value} is a runtime limit and must be accepted (got "${entry.problem}")`);
  }
  for (const [id, value] of [['trigger-rearm-db', '0.1'], ['trigger-rearm-db', '24'],
    ['trigger-cooldown-ms', '0'], ['trigger-cooldown-ms', '2000'], ['trigger-dwell-ms', '0'],
    ['trigger-dwell-ms', '1000'], ['trigger-stale-ms', '250'], ['trigger-stale-ms', '10000']]) {
    await type(id, value);
    await sleep(60);
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}).classList.contains('is-invalid')`), false,
      `${id} = ${value} is a runtime limit and the visible field must accept it`);
  }
  console.log('timing limits: rearm 0.1..24 dB and the four timers at the runtime clamps');

  // ── A macro that carries values from before those limits still saves ───────────────────────────
  //
  // The backend clamps rather than refuses (`normalize_trigger_policy` and the step normaliser in
  // `desktop/src-tauri/src/main.rs`), so an imported or older macro holding an out-of-range value must
  // be normalised on the way into the editor. The drawer is opened and the Custom preset chosen first
  // on purpose: a closed drawer, or an open one still owned by a preset, leaves the tuning fields
  // `visibility: hidden`, and `collectDraftProblems` skips exactly what it cannot see — a check that
  // never validated them would prove nothing about the save being refused.
  const legacyMacro = {
    name: 'Legacy out-of-range macro',
    enabled: false,
    armed: false,
    triggerCategory: 'usb', triggerIds: '1', triggerParameter: 'meter',
    triggerOperator: '>', triggerEdgeMode: 'on', triggerThreshold: -18,
    triggerMeterMode: 'transient',
    triggerMeterCooldownMs: 999999,
    triggerMeterRearmDb: -12,
    triggerMeterDwellMs: 999999,
    triggerMeterStaleAfterMs: 1,
    conditions: [],
    actionSteps: [{
      label: 'Wait', enabled: true, actionAddress: '', actionArgKind: 'int', actionValue: '1',
      actionMode: 'delay_set', delayMs: 999999, fadeDurationMs: 1,
      targetCategory: '', targetIds: '', targetParameter: '',
    }],
  };
  await evaluate(`localStorage.setItem('wing_mock_macro_library', ${JSON.stringify(JSON.stringify({ schemaVersion: 1, selectedIndex: 0, macros: [legacyMacro] }))})`);
  await call('Page.reload', { ignoreCache: true });
  await sleep(2400);
  // `boot()` is async and applies the library after the catalogue is read, so wait for the effect
  // itself (the field showing the value the runtime will use) instead of for a fixed guess.
  let legacyLoaded = false;
  for (let attempt = 0; attempt < 60 && !legacyLoaded; attempt += 1) {
    legacyLoaded = await evaluate(`document.getElementById('trigger-rearm-db').value === '0.1'`).catch(() => false);
    if (!legacyLoaded) await sleep(150);
  }
  await evaluate(`document.getElementById('meter-response-details').open = true`);
  // The preset the load computed from the clamped values is Custom, but the fields' `.hidden` class
  // was last written by `updateTriggerKindUi` before that; driving the operator's own two choices
  // re-applies it, and without it the four fields stay off screen and unvalidated.
  await setSelect('trigger-response-preset', 'custom');
  await setSelect('trigger-parameter', 'meter');
  const legacyFieldsOnScreen = await evaluate(`['trigger-rearm-db', 'trigger-cooldown-ms', 'trigger-dwell-ms', 'trigger-stale-ms']
    .every((id) => fieldIsOnScreen(document.getElementById(id)))`);
  assert.equal(legacyFieldsOnScreen, true,
    'the legacy macro timing fields must be on screen for the save check to mean anything');
  const normalizedFields = await evaluate(`(() => ({
    rearm: document.getElementById('trigger-rearm-db').value,
    cooldown: document.getElementById('trigger-cooldown-ms').value,
    dwell: document.getElementById('trigger-dwell-ms').value,
    stale: document.getElementById('trigger-stale-ms').value,
    delay: document.getElementById('delay-ms').value,
    fade: document.getElementById('fade-ms').value,
  }))()`);
  assert.deepEqual(normalizedFields, {
    rearm: '0.1', cooldown: '2000', dwell: '1000', stale: '250', delay: '60000', fade: '20',
  }, `a legacy macro must show the values the runtime will use (got ${JSON.stringify(normalizedFields)})`);
  await evaluate(`document.getElementById('library-save-current').click()`);
  await sleep(250);
  assert.equal(await dialogVisible(), false,
    'a legacy macro whose values the backend clamps must save without a validation dialog');
  await closeDialogIfOpen();
  const savedLegacyValues = await evaluate(`(() => {
    const library = JSON.parse(localStorage.getItem('wing_mock_macro_library') || '{"macros":[]}');
    const macro = (library.macros || [])[0] || {};
    const step = (macro.actionSteps || [])[0] || {};
    return {
      rearm: macro.triggerMeterRearmDb, cooldown: macro.triggerMeterCooldownMs,
      dwell: macro.triggerMeterDwellMs, stale: macro.triggerMeterStaleAfterMs,
      delay: step.delayMs, fade: step.fadeDurationMs,
    };
  })()`);
  assert.deepEqual(savedLegacyValues, {
    rearm: 0.1, cooldown: 2000, dwell: 1000, stale: 250, delay: 60000, fade: 20,
  }, `the saved payload must carry the clamped values (got ${JSON.stringify(savedLegacyValues)})`);
  console.log('legacy macro: out-of-range timing values are normalised to the runtime limits and still save');

  // Leave the shared page as it was found: this test types into the very fields the other browser
  // tests drive, so a leftover value or an open dialog would break them.
  await call('Page.reload', { ignoreCache: true });
  await sleep(2000);
  console.log('desktop field validation contracts passed');
} finally {
  await evaluate(previousLibrary === null
    ? `localStorage.removeItem('wing_mock_macro_library')`
    : `localStorage.setItem('wing_mock_macro_library', ${JSON.stringify(previousLibrary)})`).catch(() => {});
  await evaluate(previousTheme === null
    ? `localStorage.removeItem('wing_theme')`
    : `localStorage.setItem('wing_theme', ${JSON.stringify(previousTheme)})`).catch(() => {});
  await closeDialogIfOpen().catch(() => {});
  socket.close();
}

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
