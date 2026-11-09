// End-to-end check of the fade editor, in a real browser with a stubbed Tauri IPC.
//
// Why this exists: the window kept a fade's two endpoints as a **level in dB** everywhere it
// defaulted, clamped or summarised them, while the runtime clamped both of them with
// `clamp(-144.0, 24.0)` before the step was ever compiled. On a fader (`-144…10`) that is invisible;
// on an EQ band's frequency (`20…20000 Hz`) it turned an authored `200 → 2000` into `24 → 24`, a ramp
// that writes the same number 128 times, and the editor painted the rewritten value back into the
// fields on Arm. The owner reported it as "fades work on faders and not on EQ bands and many other
// things". The backend half is pinned by `a_fade_endpoint_is_held_to_its_own_parameter_range` and
// `a_frequency_fade_survives_the_compiler` in `desktop/src-tauri/src/main.rs`; this suite pins the
// window's half, which the stub cannot see any other way:
//
//   1. A fade of a fader keeps the conventional fade-in from silence (`-60 → 0`).
//   2. Switching the target to a frequency re-seeds both endpoints inside the *new* parameter's own
//      range, without the operator typing anything and without a field problem to fix first. The
//      stale `-60`/`0` pair used to survive (the clamp only ran when the value *kind* changed) and the
//      field rule then refused a value the operator never wrote for that parameter.
//   3. Typed endpoints inside the range are saved exactly: `200 → 2000 Hz` arrives as `200`/`2000`,
//      not as the dB range the backend used to clamp them to.
//   4. The field still refuses an endpoint the parameter cannot hold, and says the range.
//   5. `+ Fade / Ramp` authors a fade of the parameter that is selected — it used to build a
//      `ch 1 fader` step whatever the operator had chosen.
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate starts one when the port is silent, and
// running this directly with no browser is a no-op (exit 3, never exit 0).
//
// Run: node scripts/test-desktop-fade-endpoints-browser.mjs

import assert from 'node:assert/strict';
import {
  closeDialogIfOpen as closeDialog,
  debuggerPages,
  installDesktopStub,
  navigateDesktopPage,
  openDesktopTab,
} from './lib/desktop-ui-harness.mjs';

const pages = await debuggerPages();
if (!pages) {
  console.log('SKIP: no Chrome remote debugging on port 9223');
  process.exit(3);
}

const { call, evaluate, sleep, closeTab } = await openDesktopTab();
process.on('exit', () => closeTab());
await installDesktopStub(call);
await navigateDesktopPage({ call, evaluate, sleep });
assert.equal(await evaluate('typeof window.__TAURI__'), 'object', 'the stub must own the IPC layer');
const closeDialogIfOpen = () => closeDialog(evaluate, sleep);

/** Selects the step's destination and mode through the real controls, as an operator does. */
async function chooseTarget(category, parameter, ids = '1') {
  await evaluate(`(() => {
    const cat = document.getElementById('target-category');
    cat.value = ${JSON.stringify(category)};
    cat.dispatchEvent(new Event('change', { bubbles: true }));
    const ids = document.getElementById('target-ids');
    ids.value = ${JSON.stringify(ids)};
    ids.dispatchEvent(new Event('input', { bubbles: true }));
    ids.dispatchEvent(new Event('change', { bubbles: true }));
    const p = document.getElementById('target-parameter');
    p.value = ${JSON.stringify(parameter)};
    p.dispatchEvent(new Event('change', { bubbles: true }));
    const mode = document.getElementById('action-mode');
    mode.value = 'fade';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
}

async function fadeFields() {
  return evaluate(`(() => {
    // The two fields' own notes, not every note on the page: another panel's empty note is not this
    // step's problem (and a fresh macro has one).
    const note = (id) => {
      const element = document.getElementById(id);
      return element ? element.textContent : '';
    };
    return {
      start: document.getElementById('fade-start').value,
      end: document.getElementById('fade-end').value,
      startLabel: document.getElementById('fade-start-label').textContent,
      endLabel: document.getElementById('fade-end-label').textContent,
      mode: document.getElementById('action-mode').value,
      parameter: document.getElementById('target-parameter').value,
      problems: [note('fade-start-problem'), note('fade-end-problem')].filter(Boolean),
    };
  })()`);
}

// --- 1. A fader keeps the fade-in from silence ------------------------------------------------
await evaluate('document.getElementById("library-new").click()');
await sleep(400);
await chooseTarget('ch', 'fader');
const fader = await fadeFields();
assert.equal(fader.mode, 'fade', 'the mode must be the one this check set');
assert.equal(fader.start, '-60', `a fader's fade starts at -60 dB (got ${fader.start})`);
assert.equal(fader.end, '0', `and arrives at unity (got ${fader.end})`);
assert.match(fader.startLabel, /dB/, `the field must say the unit (got "${fader.startLabel}")`);
assert.deepEqual(fader.problems, [], 'the fader pair must be valid as it stands');
console.log('1. fader fade default:', JSON.stringify({ start: fader.start, end: fader.end, label: fader.startLabel }));

// --- 2. A frequency re-seeds both endpoints inside its own range ------------------------------
//
// This is the defect: `fader` (-144…10 dB) and a frequency (20…20000 Hz) share no unit at all, and
// the fields were only re-clamped when the value *kind* changed. The stub's oscillator frequency is a
// float Hz leaf, the same shape as an EQ band's.
await chooseTarget('preamp_oscillator', 'osc_freq');
const frequency = await fadeFields();
assert.equal(frequency.parameter, 'osc_freq', 'the frequency must be the selected parameter');
assert.match(frequency.startLabel, /Hz/, `the label must say Hz, not dB (got "${frequency.startLabel}")`);
const startHz = Number(frequency.start);
const endHz = Number(frequency.end);
assert.ok(Number.isFinite(startHz) && Number.isFinite(endHz), 'both endpoints must be numbers');
assert.ok(startHz >= 20 && startHz <= 20_000, `the start must be inside 20…20000 Hz (got ${startHz})`);
assert.ok(endHz >= 20 && endHz <= 20_000, `the end must be inside 20…20000 Hz (got ${endHz})`);
assert.notEqual(startHz, endHz, 'a fresh fade must be a fade, not two equal endpoints');
assert.deepEqual(frequency.problems, [], 'the re-seeded pair must be valid: nothing for the operator to fix');
console.log('2. frequency fade re-seeded:', JSON.stringify({ start: startHz, end: endHz }));

// --- 2b. The same value kind, a narrower range: the case the old guard could not see -----------
//
// `fader` and a monitor dim are both `db`, so a guard that compared the *kind* does nothing at all
// here and leaves the fader's `-60`, which a `0…40 dB` parameter cannot hold — the field rule then
// refuses the save, for a value the operator never wrote for that parameter. The pair is taken from a
// fresh fader first, so the stale values really are outside the new range (a `0…40` range contains the
// oscillator's `20/0`, which is why this check does not simply continue from the frequency above).
await chooseTarget('ch', 'fader');
const faderAgain = await fadeFields();
// A fader pair, in the fader's own range. The exact default is `-60 → 0` on this tree, but this check
// is about the *next* change: asserting the literal here would make a window that seeded `-144 → 0`
// fail on the setup instead of on the defect the check exists for.
assert.ok(
  Number(faderAgain.start) >= -144 && Number(faderAgain.start) <= 10,
  `the fader pair must be a valid fader pair before the same-kind change (got ${faderAgain.start})`,
);
assert.deepEqual(faderAgain.problems, [], 'and it must be valid as it stands');
await chooseTarget('monbus', 'monitor_dim');
const dim = await fadeFields();
assert.equal(dim.parameter, 'monitor_dim', 'the monitor dim must be the selected parameter');
const dimStart = Number(dim.start);
const dimEnd = Number(dim.end);
assert.ok(
  dimStart >= 0 && dimStart <= 40,
  `a same-kind change must re-seed inside 0…40 dB, not keep the fader's -60 (got ${dimStart})`,
);
assert.ok(dimEnd >= 0 && dimEnd <= 40, `and so must the end (got ${dimEnd})`);
assert.notEqual(dimStart, dimEnd, 'a fresh fade must never be two equal endpoints');
assert.deepEqual(dim.problems, [], 'the re-seeded pair must be valid: nothing for the operator to fix');
console.log('2b. same-kind narrower range re-seeded:', JSON.stringify({ start: dimStart, end: dimEnd }));

// --- 3. Typed endpoints inside the range are saved exactly ------------------------------------
// Back to the frequency, so the saved step is the one check 3 reads.
await chooseTarget('preamp_oscillator', 'osc_freq');
await evaluate(`(() => {
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('fade-start', '200');
  set('fade-end', '2000');
  return true;
})()`);
await sleep(150);
const typed = await fadeFields();
assert.deepEqual(typed.problems, [], '200 → 2000 Hz is inside the parameter range, so nothing is refused');
await closeDialogIfOpen();
await evaluate('document.getElementById("library-save-current").click()');
await sleep(500);
await closeDialogIfOpen();
const saved = await evaluate(`(() => {
  const library = window.__SAVED_LIBRARY || { macros: [] };
  const macro = library.macros[library.selectedIndex] || library.macros[library.macros.length - 1] || {};
  const step = (macro.actionSteps || [])[0] || macro;
  return {
    start: step.fadeStartValue,
    end: step.fadeEndValue,
    mode: step.actionMode,
    parameter: step.targetParameter,
  };
})()`);
assert.equal(saved.mode, 'fade', 'the saved step must still be a fade');
assert.equal(saved.parameter, 'osc_freq', 'on the frequency that was selected');
assert.equal(saved.start, 200, `the saved start must be the authored 200 Hz, not a clamped dB value (got ${saved.start})`);
assert.equal(saved.end, 2000, `the saved end must be the authored 2000 Hz (got ${saved.end})`);
console.log('3. saved frequency fade:', JSON.stringify(saved));

// --- 4. An endpoint the parameter cannot hold is still refused, and the range is named ---------
//
// The negative control: the window must not simply accept anything now that it re-seeds. `5 Hz` is
// below the oscillator's documented 20 Hz, and the refusal has to name the range so the operator can
// fix it instead of guessing.
await evaluate(`(() => {
  const field = document.getElementById('fade-start');
  field.value = '5';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(150);
const tooLow = await evaluate(`(() => {
  const note = document.getElementById('fade-start-problem');
  return { text: note ? note.textContent : '', marked: document.getElementById('fade-start').classList.contains('is-invalid') };
})()`);
assert.match(tooLow.text, /20/, `the refusal must name the parameter's own minimum (got "${tooLow.text}")`);
assert.equal(tooLow.marked, true, 'the field must be marked as invalid too');
console.log('4. out-of-range endpoint refused:', JSON.stringify(tooLow));

// Put the authored pair back, so the next check adds a step from a valid draft.
await evaluate(`(() => {
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('fade-start', '200');
  set('fade-end', '2000');
  return true;
})()`);
await sleep(150);

// --- 5. + Fade / Ramp authors a fade of the selected parameter --------------------------------
await evaluate('document.getElementById("add-fade-step").click()');
await sleep(300);
await closeDialogIfOpen();
await evaluate('document.getElementById("library-save-current").click()');
await sleep(500);
await closeDialogIfOpen();
const added = await evaluate(`(() => {
  const library = window.__SAVED_LIBRARY || { macros: [] };
  const macro = library.macros[library.selectedIndex] || library.macros[library.macros.length - 1] || {};
  const step = (macro.actionSteps || [])[macro.actionSteps.length - 1] || {};
  return {
    mode: step.actionMode,
    parameter: step.targetParameter,
    start: step.fadeStartValue,
    end: step.fadeEndValue,
    address: step.actionAddress,
  };
})()`);
assert.equal(added.mode, 'fade', 'the added step must be a fade');
assert.equal(
  added.parameter,
  'osc_freq',
  `+ Fade / Ramp must fade the selected parameter, not channel 1's fader (got ${added.parameter} at ${added.address})`,
);
assert.ok(
  Number(added.start) >= 20 && Number(added.start) <= 20_000,
  `the added step's start must be inside the parameter's range (got ${added.start})`,
);
assert.ok(
  Number(added.end) >= 20 && Number(added.end) <= 20_000,
  `the added step's end must be inside the parameter's range (got ${added.end})`,
);
console.log('5. + Fade / Ramp authored:', JSON.stringify(added));

// --- 6. A relative fade: "from where it is", and "by an amount" -------------------------------
//
// The two modes are what the owner asked for: a fade that starts from whatever the console holds, and
// one that moves it up or down by a signed amount. Neither exists in OSC (there is no relative write),
// so "where it is now" makes the step read the leaf first — the window must say so, hide the start
// field it no longer uses, and carry both words into the saved step.
await chooseTarget('ch', 'fader');
const relative = await evaluate(`(() => {
  const setSelect = (id, value) => {
    const select = document.getElementById(id);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setSelect('fade-from-mode', 'current');
  setSelect('fade-to-mode', 'relative');
  return {
    startHidden: document.getElementById('fade-start-field').classList.contains('hidden'),
    endLabel: document.getElementById('fade-end-label').textContent,
    amount: document.getElementById('fade-end').value,
    recipe: (document.getElementById('recipe-action') || {}).textContent || '',
    summary: typeof currentActionText === 'function'
      ? currentActionText({
          actionMode: 'fade',
          actionValue: '0',
          delayMs: 0,
          fadeStartValue: -60,
          fadeEndValue: Number(document.getElementById('fade-end').value),
          fadeFrom: 'current',
          fadeTo: 'relative',
          fadeDurationMs: 1000,
          targetCategory: 'ch',
          targetIds: '1',
          targetParameter: 'fader',
          sendId: 1,
        })
      : '',
  };
})()`);
assert.equal(relative.startHidden, true, 'a fade from where it is has no start value to type');
assert.match(relative.endLabel, /Change by/, `the end field must be labelled as an amount (got "${relative.endLabel}")`);
assert.match(relative.endLabel, /dB/, `and keep the parameter's unit (got "${relative.endLabel}")`);
assert.notEqual(Number(relative.amount), 0, `the amount is seeded with a real move (got ${relative.amount})`);
assert.match(relative.summary, /from where it is now/, `the summary must say where it starts (got "${relative.summary}")`);
assert.match(relative.summary, /by -3/, `and name the amount (got "${relative.summary}")`);
assert.match(relative.summary, /reads the console first/, `and say that it reads (got "${relative.summary}")`);
console.log('6. relative modes:', JSON.stringify(relative));

// --- 7. An amount is not a value of the parameter: its range does not apply to it ---------------
//
// `+100` on a monitor dim (`0…40 dB`) is a perfectly good *amount*: the run adds it to wherever the
// fade started and holds the result to the range. Judged as a value it would be refused, which is the
// distinction the whole mode exists for.
await chooseTarget('monbus', 'monitor_dim');
await evaluate(`(() => {
  const setSelect = (id, value) => {
    const select = document.getElementById(id);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setSelect('fade-to-mode', 'value');
  const end = document.getElementById('fade-end');
  end.value = '100';
  end.dispatchEvent(new Event('input', { bubbles: true }));
  end.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(150);
const asValue = await evaluate(`(() => {
  const note = document.getElementById('fade-end-problem');
  return { text: note ? note.textContent : '', value: document.getElementById('fade-end').value };
})()`);
assert.match(
  asValue.text,
  /cannot be higher than 40/,
  `as a value, +100 is outside a 0…40 dB dim and must be refused (got "${asValue.text}")`,
);
await evaluate(`(() => {
  const select = document.getElementById('fade-to-mode');
  select.value = 'relative';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const end = document.getElementById('fade-end');
  end.value = '100';
  end.dispatchEvent(new Event('input', { bubbles: true }));
  end.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(150);
const asAmount = await evaluate(`(() => {
  const note = document.getElementById('fade-end-problem');
  return { text: note ? note.textContent : '', value: document.getElementById('fade-end').value };
})()`);
assert.equal(
  asAmount.text,
  '',
  `as an amount, +100 on a 0…40 dB dim must be accepted (got "${asAmount.text}")`,
);
console.log('7. an amount is not a value:', JSON.stringify({ asValue, asAmount }));

// --- 8. An amount of 0 is refused, and the two words reach the saved step ------------------------
await evaluate(`(() => {
  const end = document.getElementById('fade-end');
  end.value = '0';
  end.dispatchEvent(new Event('input', { bubbles: true }));
  end.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(150);
const zero = await evaluate(`(() => {
  const note = document.getElementById('fade-end-problem');
  return { text: note ? note.textContent : '' };
})()`);
assert.match(zero.text, /fade by 0 does not move anything/, `a fade by 0 must be refused (got "${zero.text}")`);
// Put a real amount back and save: the step carries both modes and the amount.
await evaluate(`(() => {
  const setSelect = (id, value) => {
    const select = document.getElementById(id);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setSelect('fade-from-mode', 'current');
  setSelect('fade-to-mode', 'relative');
  const end = document.getElementById('fade-end');
  end.value = '-3';
  end.dispatchEvent(new Event('input', { bubbles: true }));
  end.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(150);
await closeDialogIfOpen();
await evaluate('document.getElementById("library-save-current").click()');
await sleep(500);
await closeDialogIfOpen();
const savedRelative = await evaluate(`(() => {
  const library = window.__SAVED_LIBRARY || { macros: [] };
  const macro = library.macros[library.selectedIndex] || library.macros[library.macros.length - 1] || {};
  // The step the editor is on, not the first one: check 5 added a step after the one checks 1-4 used.
  const steps = macro.actionSteps || [];
  const step = steps.find((candidate) => candidate.fadeFrom === 'current' && candidate.fadeTo === 'relative') || {};
  return {
    from: step.fadeFrom,
    to: step.fadeTo,
    end: step.fadeEndValue,
    parameter: step.targetParameter,
    all: steps.map((candidate) => [candidate.fadeFrom, candidate.fadeTo, candidate.fadeEndValue]),
  };
})()`);
assert.equal(
  savedRelative.from,
  'current',
  `the saved step must keep "where it is now" (got ${savedRelative.from}; steps ${JSON.stringify(savedRelative.all)})`,
);
assert.equal(savedRelative.to, 'relative', `and "an amount" (got ${savedRelative.to})`);
assert.equal(Number(savedRelative.end), -3, `with the amount the operator typed (got ${savedRelative.end})`);
console.log('8. saved relative fade:', JSON.stringify(savedRelative));

// The tab and its socket are closed here, not only from the `exit` handler: an open WebSocket is a live
// handle on the event loop, so waiting for `exit` to close it is a process that never exits.
closeTab();
// The one line the gate demands. A suite that could not run must not reach it.
console.log('WING_BROWSER_SUITE_OK');
