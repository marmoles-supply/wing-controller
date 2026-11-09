// End-to-end check of the desktop UI in a real browser with a stubbed Tauri IPC.
//
// Verifies, against the real index.html script, everything about choosing WHAT a macro writes:
//   1.  "New macro" starts unconfigured (no usb/1/meter, no invented /ch/1/mute action).
//   2.  Changing the action target channel resolves the new address before Save Draft persists it.
//   3.  Toggle mode is only selectable for on/off parameters.
//   4.  Test Action (Shoot) runs the step through `test_action_step` (not raw OSC).
//   5.  A saved library edit reaches a running live session.
//   5b/5c. The Shoot warning: Enter accepts, Escape cancels, the notice keys silence it.
//   6.  An incomplete macro cannot be enabled.
//   7.  The HUD defaults panel seeds a step.
//   8.  A model parameter survives leaving the step and coming back.
//   9.  Model-scoped metadata comes from the model the selected optgroup names.
//   10. A preflight refusal is shown, not whispered into a collapsed card.
//   11. A send chosen from the grouped menu is saved with the step.
//   12-12e. The armed draft and the saved library carry the model the strip was read as running.
//   13. The armed draft carries the trigger's destination index.
//   14. A talkback assign drives the same destination control as a send.
//   15. The index-less /io node and the oscillator's extra `osc` segment.
//   16. The USB transport, the fader layers and the desk status.
//   17. The desk level: monitor buses, safes, AES50, W-Live and the clock.
//   24. The catalogue is re-read for the model the desk announces at discovery.
//   26. A range of channels reaches the backend as a range: the stub expands it like `parse_ids`, the
//       preview promises every channel, the step carries the selector whole, and the recipe tells a
//       trigger with nothing at all (cue-only) from one the operator started filling in.
//
// The run-time half (cancelling a Shoot, the unconfirmed-write report, the FX parameter picker, the
// live re-apply after disarming and the unsaved-draft guards) lives in
// `scripts/test-desktop-shoot-and-guards-browser.mjs`: headless Chrome on this machine wedges after
// roughly ninety seconds of page activity, so the suite is split in two halves that each finish well
// inside that window (docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md).
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is closed, and
// running it directly is a no-op in that case too.
//
// Run: node scripts/test-desktop-action-target-browser.mjs
// End-to-end check of the desktop UI in a real browser with a stubbed Tauri IPC.
//
// Verifies, against the real index.html script:
//   1. "New macro" starts unconfigured (no usb/1/meter, no invented /ch/1/mute action).
//   2. Changing the action target channel resolves the new address before Save Draft
//      persists it (the async-resolve race that sent the previous channel's command).
//   3. Toggle mode is only selectable for on/off parameters.
//   4. Test Action (Shoot) runs the step through `test_action_step` (not raw OSC) and
//      sends the selected step with its mode intact.
//   4b. The Shoot card and the session log say what a toggle really sends (`toggle (-1)`),
//      never the value the step stores — the report of 2026-10-05 showed `/ch/11/in/set/altsrc int=0`.
//   5. The live/armed request carries the whole trigger, its destination index and the model its
//      key belongs to.
//
// Needs Chrome with `--remote-debugging-port=9223`. The gate skips it when that port is
// closed, and running it directly is a no-op in that case too.
//
// Run: node scripts/test-desktop-action-target-browser.mjs
//
// **This file is the first half.** The second (sections 16-26) lives in
// `test-desktop-action-target-tail-browser.mjs`, and the split is not cosmetic: headless Chrome on this machine stops
// answering after roughly ninety seconds of page activity (`docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md`), measured here
// at ~72 s when section 15 ended — so one process cannot hold the whole suite. The stub is shared through
// `lib/desktop-ui-harness.mjs` rather than copied, because a stub in two files is a second answer to the same question.

import assert from 'node:assert/strict';
import {
  closeDialogIfOpen as closeDialog,
  debuggerPages,
  installDesktopStub,
  navigateDesktopPage,
  openDesktopTab,
} from './lib/desktop-ui-harness.mjs';

// The whole harness — the CDP client with its deadline, the desktop page and the Tauri stub — is in
// `lib/desktop-ui-harness.mjs`, shared with the tail suite so the two cannot drift apart.
const pages = await debuggerPages();
if (!pages) {
  console.log('SKIP: no Chrome remote debugging on port 9223');
  process.exit(3);
}

const { call, evaluate, sleep, closeTab } = await openDesktopTab();
// The tab must not survive a failing assertion either.
process.on('exit', () => closeTab());
await installDesktopStub(call);
await navigateDesktopPage({ call, evaluate, sleep });
assert.equal(await evaluate('typeof window.__TAURI__'), 'object', 'the stub must own the IPC layer');

const closeDialogIfOpen = () => closeDialog(evaluate, sleep);

// --- 1. New macro is born unconfigured -----------------------------------
await evaluate('document.getElementById("library-new").click()');
await sleep(400);
const created = await evaluate(`(() => ({
  triggerCategory: document.getElementById('trigger-category').value,
  triggerIds: document.getElementById('trigger-ids').value,
  triggerParameter: document.getElementById('trigger-parameter').value,
  address: document.getElementById('osc-address').value,
  recipeTrigger: document.getElementById('recipe-trigger').textContent,
  saved: window.__SAVED_LIBRARY && window.__SAVED_LIBRARY.macros[window.__SAVED_LIBRARY.macros.length - 1],
}))()`);
assert.equal(created.triggerCategory, '', 'a new macro must not claim a trigger source');
assert.equal(created.triggerIds, '', 'a new macro must not claim a channel');
assert.equal(created.triggerParameter, '', 'a new macro must not claim a trigger parameter');
assert.equal(created.address, '', 'a new macro must not carry an action address');
// A macro with no trigger at all is the editor's legitimate "only a cue fires it" choice (the cue-only
// macro, v0.2.85), so the recipe must say that and must not read as a half-made macro. This used to pin
// "not configured", which is the wording the cue-only work deliberately replaced.
assert.match(created.recipeTrigger, /fired only by a (timecode )?cue/i,
  'a macro with no trigger of its own must say a cue fires it');
assert.doesNotMatch(created.recipeTrigger, /not configured/i,
  'a trigger with nothing at all is the cue-only choice, not an unconfigured one');
assert.ok(created.saved, 'the new macro must be saved to the library');
assert.equal(created.saved.triggerCategory, '', 'the saved macro must stay unconfigured');
assert.ok(
  !(created.saved.actionSteps || []).some((step) => (step.actionAddress || '').includes('/ch/1/mute')),
  'the saved new macro must not contain an invented /ch/1/mute step',
);
console.log('1. New macro unconfigured:', JSON.stringify({
  trigger: [created.triggerCategory, created.triggerIds, created.triggerParameter],
  address: created.address,
  steps: created.saved.actionSteps,
}));

// The negative control that keeps the wording above from being a loosening: only a trigger with
// *nothing* at all is cue-only. A trigger the operator started filling in — a source and a channel
// with no parameter — is unfinished and must still read as not configured.
const partialTrigger = await evaluate(`(() => {
  const cat = document.getElementById('trigger-category');
  cat.value = 'ch';
  cat.dispatchEvent(new Event('change', { bubbles: true }));
  const ids = document.getElementById('trigger-ids');
  ids.value = '1';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  ids.dispatchEvent(new Event('change', { bubbles: true }));
  // The category change fills the parameter list; clearing it is what makes the trigger partial.
  const parameter = document.getElementById('trigger-parameter');
  parameter.value = '';
  parameter.dispatchEvent(new Event('change', { bubbles: true }));
  const text = document.getElementById('recipe-trigger').textContent;
  // Put the trigger back the way check 1 found it: the checks below fill their own trigger.
  cat.value = '';
  cat.dispatchEvent(new Event('change', { bubbles: true }));
  ids.value = '';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  ids.dispatchEvent(new Event('change', { bubbles: true }));
  parameter.value = '';
  parameter.dispatchEvent(new Event('change', { bubbles: true }));
  return { text };
})()`);
assert.match(partialTrigger.text, /not configured/i,
  'a partly configured trigger must still read as not configured');
console.log('1b. A partial trigger stays unfinished:', JSON.stringify(partialTrigger));

// --- 2. Target change resolves before the draft is saved ------------------
await evaluate(`(() => {
  const cat = document.getElementById('target-category');
  cat.value = 'ch';
  cat.dispatchEvent(new Event('change', { bubbles: true }));
  const ids = document.getElementById('target-ids');
  ids.value = '5';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  ids.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(50);
const midFlight = await evaluate(`(() => {
  document.getElementById('library-save-current').click();
  return document.getElementById('osc-address').value;
})()`);
await sleep(500);
const savedAfterRetarget = await evaluate(`(() => {
  const lib = window.__SAVED_LIBRARY;
  const macro = lib.macros[lib.selectedIndex];
  return { address: document.getElementById('osc-address').value, steps: macro.actionSteps, legacyAddress: macro.actionAddress };
})()`);
assert.equal(savedAfterRetarget.address, '/ch/5/mute', 'the address must resolve to the new channel');
assert.ok(
  savedAfterRetarget.steps.some((step) => step.actionAddress === '/ch/5/mute'),
  `the saved draft must hold the new channel, got ${JSON.stringify(savedAfterRetarget.steps)}`,
);
assert.ok(
  !savedAfterRetarget.steps.some((step) => (step.actionAddress || '').includes('/ch/1/')),
  'the saved draft must not keep the previous channel command',
);
console.log('2. Retarget saved:', JSON.stringify({ midFlight, saved: savedAfterRetarget }));

// --- 3. Toggle is only offered for on/off parameters ----------------------
const toggleAvailability = await evaluate(`(() => {
  const param = document.getElementById('target-parameter');
  const mode = document.getElementById('action-mode');
  const option = mode.querySelector('option[value="toggle"]');
  const read = (key) => {
    param.value = key;
    param.dispatchEvent(new Event('change', { bubbles: true }));
    return { disabled: option.disabled, mode: mode.value };
  };
  const binary = read('mute');
  const numeric = read('fader');
  mode.value = 'toggle';
  param.value = 'mute';
  param.dispatchEvent(new Event('change', { bubbles: true }));
  const afterBinary = mode.value;
  const reverted = read('fader');
  // An untyped custom address has no proven binary/continuous capability.
  const category = document.getElementById('target-category');
  category.value = 'custom';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  const custom = { disabled: option.disabled, hidden: option.hidden };
  category.value = 'ch';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  return { binary, numeric, afterBinary, reverted, custom };
})()`);
assert.equal(toggleAvailability.binary.disabled, false, 'toggle must be available for mute');
assert.equal(toggleAvailability.numeric.disabled, true, 'toggle must be disabled for a dB fader');
assert.equal(toggleAvailability.reverted.mode, 'set', 'a toggle step must fall back to Set on a numeric parameter');
assert.equal(toggleAvailability.custom.disabled, true, 'an untyped custom address cannot promise toggle');
assert.equal(toggleAvailability.custom.hidden, true, 'unsupported operations are absent from the picker');
console.log('3. Toggle availability:', JSON.stringify(toggleAvailability));

// --- 3b. A toggle step offers no value, and says what it really does -----------------------------
// The value chips are the value the step sends, and a toggle sends none (it sends `-1` and the console
// flips the parameter). They used to reappear for a toggle step — a renderer that ran after the toggle
// path had hidden them re-showed them — so the operator saw "ON (muted) / OFF (unmuted)" buttons for a
// step that sends no value, and watched them never change. The hint described the pre-0.2.61 behaviour
// (reading the state first) on top of it. Both were reported by the owner on 2026-10-01.
const toggleValueUi = await evaluate(`(() => {
  const parameter = document.getElementById('target-parameter');
  parameter.value = 'mute'; parameter.dispatchEvent(new Event('change', { bubbles: true }));
  const mode = document.getElementById('action-mode');
  mode.value = 'toggle';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  const chips = document.getElementById('value-chips');
  const field = document.getElementById('value-field');
  const hint = document.getElementById('value-hint');
  return {
    chipsHidden: chips.classList.contains('hidden') || chips.children.length === 0,
    fieldHidden: field.classList.contains('hidden'),
    hint: hint.textContent,
  };
})()`);
assert.ok(toggleValueUi.chipsHidden, 'a toggle step must not offer ON/OFF value chips: it sends no value');
assert.ok(toggleValueUi.fieldHidden, 'and no value field either');
assert.doesNotMatch(toggleValueUi.hint, /reads the current state/i,
  'the hint must not describe the pre-0.2.61 read-and-invert toggle');
assert.match(toggleValueUi.hint, /-1/, 'it must say the packet it really sends');
assert.match(toggleValueUi.hint, /does not read it back|sent rather than confirmed/i,
  'and that the console decides the result');
console.log('3b. A toggle step sends no value:', JSON.stringify(toggleValueUi).slice(0, 160));

// --- 3c. Firing a whole macro reaches the backend -----------------------------------------------
// The row's menu fires the macro's entire action list through `fire_macro`, which is what an operator
// uses to prove the list on a real console. Asserted here because this suite collects invocations.
const fireMacro = await evaluate(`(async () => {
  window.__INVOKES.length = 0;
  const row = document.querySelector('#macro-library-list .macro-row');
  if (!row) return { error: 'no macro row in the library list' };
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  // A row's menu asks about unsaved work before it lists anything: answer as the operator would.
  const accept = document.getElementById('win95-confirm-accept');
  if (accept && document.getElementById('win95-confirm')?.style.display !== 'none') {
    accept.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const item = [...document.querySelectorAll('#win95-context-menu .context-menu-item')]
    .find((entry) => entry.textContent.includes('Fire Macro'));
  if (!item) return { error: 'no Fire Macro item in the row menu' };
  item.click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { calls: window.__INVOKES.filter((entry) => entry.cmd === 'fire_macro').length };
})()`);
assert.ok(!fireMacro.error, fireMacro.error || '');
assert.equal(fireMacro.calls, 1, 'Fire Macro must reach the backend through fire_macro');
console.log('3c. The row menu fires the whole macro:', JSON.stringify(fireMacro));

// --- 4. Shoot dispatches the real step -----------------------------------
const shoot = await evaluate(`(async () => {
  const param = document.getElementById('target-parameter');
  const mode = document.getElementById('action-mode');
  param.value = 'mute';
  param.dispatchEvent(new Event('change', { bubbles: true }));
  mode.value = 'toggle';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  const ids = document.getElementById('target-ids');
  ids.value = '7';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('send-osc').click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  return {
    test: window.__TEST_ACTION || null,
    rawOsc: window.__INVOKES.filter((entry) => entry.cmd === 'send_osc_message').length,
  };
})()`);
assert.ok(shoot.test, 'Shoot must invoke test_action_step');
assert.equal(shoot.rawOsc, 0, 'Shoot must not send raw OSC');
assert.equal(shoot.test.config.actionSteps.length, 1, 'Shoot must send a single step');
assert.equal(shoot.test.config.actionSteps[0].actionMode, 'toggle', 'the toggle mode must reach the dispatcher');
assert.equal(shoot.test.config.actionSteps[0].actionAddress, '/ch/7/mute', 'the shoot must use the freshly resolved channel');
console.log('4. Shoot:', JSON.stringify(shoot));

// --- 4b. What the Shoot card says a toggle sends --------------------------
// The owner's report of 2026-10-05: the card read `/ch/11/in/set/altsrc int=0` for a step whose packet is
// `,i -1` (Maillot 3.1.0, "Special case: Toggle", scratch/wing_protocols.txt:782-789 — and `altsrc` is in
// that class by its own table row, line 1938: `I  0..1`). The `0` in that line is the value the step
// **stores**; a toggle never sends it, so the card described a packet that never left and the operator
// read the app as writing a zero. The card, and the log beside it, must say `toggle (-1)`.
const toggleNotice = await evaluate(`(async () => {
  const param = document.getElementById('target-parameter');
  param.value = 'alt_source';
  param.dispatchEvent(new Event('change', { bubbles: true }));
  const ids = document.getElementById('target-ids');
  ids.value = '11';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const mode = document.getElementById('action-mode');
  mode.value = 'toggle';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  // The stored value, which is the \`0\` the owner saw: a toggle must not send it.
  document.getElementById('osc-value').value = '0';
  document.getElementById('courtesy-notice-container').innerHTML = '';
  document.getElementById('send-osc').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const dialog = document.getElementById('win95-confirm');
  if (dialog && getComputedStyle(dialog).display !== 'none') {
    document.getElementById('win95-confirm-accept')?.click();
  }
  // The card is drawn only AFTER the shoot's backend round-trip answers: "showCourtesyNotice" sits
  // behind the awaited step status. A fixed sleep here is therefore a race, and it fired once — the
  // full gate, as the first browser suite, with an empty container — while the suite then passed
  // four times in isolation on the same tree. Poll for the text instead, bounded, and let the
  // assertion below name the failure if the card never arrives at all.
  const card = await (async () => {
    const until = Date.now() + 5000;
    for (;;) {
      const text = document.getElementById('courtesy-notice-container')?.textContent || '';
      if (text.trim() || Date.now() >= until) return text;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  const sent = window.__TEST_ACTION?.config?.actionSteps?.[0] || null;
  const log = document.getElementById('log-output')?.textContent || '';
  // Put the editor back the way check 4 left it. This check moved the destination to the owner's address
  // on purpose, and the checks after it set their own ids against the parameter that is selected here.
  param.value = 'mute';
  param.dispatchEvent(new Event('change', { bubbles: true }));
  ids.value = '7';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { sent, card, log, restored: document.getElementById('osc-address').value };
})()`);
assert.equal(toggleNotice.sent?.actionMode, 'toggle', 'the shoot must send the toggle mode, which is what selects the -1');
assert.equal(toggleNotice.sent?.actionAddress, '/ch/11/in/set/altsrc', 'and the resolved alt-source address');
assert.equal(toggleNotice.sent?.actionValue, '0', "the step stores a 0, as the owner's did");
assert.match(toggleNotice.card, /toggle \(-1\)/, 'the Shoot card must say the toggle sends -1');
assert.match(toggleNotice.card, /\/ch\/11\/in\/set\/altsrc/, 'against the address that was written');
assert.doesNotMatch(toggleNotice.card, /int=0/, 'the card must not report the value a toggle never sends');
assert.match(toggleNotice.log, /\/ch\/11\/in\/set\/altsrc toggle \(-1\)/, 'the session log must agree with the card');
assert.equal(toggleNotice.restored, '/ch/7/mute', 'the check must leave the editor on the destination the checks after it read');
console.log('4b. The card of a toggle:', JSON.stringify(toggleNotice.card.slice(0, 140)));

// --- 5. A saved library edit reaches a live session -----------------------
// The runtime captures the macro set when the stream connects, so an edit saved
// while live used to keep running the previous macros until a manual reconnect.
const live = await evaluate(`(async () => {
  const triggerCat = document.getElementById('trigger-category');
  triggerCat.value = 'ch';
  triggerCat.dispatchEvent(new Event('change', { bubbles: true }));
  const triggerIds = document.getElementById('trigger-ids');
  triggerIds.value = '1';
  triggerIds.dispatchEvent(new Event('input', { bubbles: true }));
  const ids = document.getElementById('target-ids');
  ids.value = '9';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  ids.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 80));
  // Save before enabling: the enable guard reads the stored macro, so an unsaved draft is refused
  // on purpose (that is check 6 below).
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.getElementById('library-toggle-enabled').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.getElementById('live-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  return {
    starts: window.__STREAM_STARTS || 0,
    status: document.getElementById('stream-status').textContent,
    enabled: macroLibrary.macros[macroLibrary.selectedIndex]?.enabled === true,
  };
})()`);
assert.ok(live.starts >= 1, 'Live must connect against the stub');
assert.equal(live.enabled, true, 'the configured macro must be enabled before Live starts');
assert.equal(live.status, 'Live', `the stream must report live, got ${live.status}`);

const reapplied = await evaluate(`(async () => {
  const ids = document.getElementById('target-ids');
  ids.value = '11';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  ids.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 80));
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const macro = macroLibrary.macros[macroLibrary.selectedIndex];
  macro.name = 'Renamed ' + Date.now();
  await saveMacroLibraryState('test_rename');
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    starts: window.__STREAM_STARTS || 0,
    addresses: (window.__LAST_STREAM_REQUEST?.macroLibrary?.macros || [])
      .flatMap((entry) => (entry.actionSteps || []).map((step) => step.actionAddress)),
  };
})()`);
assert.equal(
  reapplied.starts,
  live.starts + 1,
  'saving a changed macro must re-apply it to the running session (and a rename must not restart again)',
);
assert.ok(
  reapplied.addresses.includes('/ch/11/mute'),
  `the running session must receive the new target, got ${JSON.stringify(reapplied.addresses)}`,
);
console.log('5. Live re-apply:', JSON.stringify({ live, reapplied }));

// --- 5b. The Shoot warning: Enter accepts, and its two boxes silence it -----------------------
// The warning only exists while a session is live, which is the state check 5 left behind. Enter is
// a real key through CDP, not a synthetic event: the dialog listens on the document in the capture
// phase, and what has to be pinned is that the browser's own Enter reaches it with the focus on the
// accept button (and on a notice box) instead of being swallowed by the page behind it. The two
// boxes are the operator's "do not ask me again": they must be real check boxes inside the dialog,
// must not steal the focus from the button, must write the key only when the action is accepted, and
// the next Shoot must go straight through.
const pressKey = async (key, code, keyCode) => {
  // `keyDown` with the text Enter carries, not `rawKeyDown`: the browser's own default action for
  // Enter — the click on the focused button — needs the full keyboard event.
  const text = key === 'Enter' ? '\r' : undefined;
  const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await call('Input.dispatchKeyEvent', { type: 'keyDown', ...common, ...(text ? { text, unmodifiedText: text } : {}) });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  await sleep(220);
};
const readNoticeDialog = () => evaluate(`(() => {
  const dialog = document.getElementById('win95-confirm');
  const boxes = Array.from(document.querySelectorAll('#win95-confirm-notices input[type="checkbox"]'));
  return {
    open: dialog ? getComputedStyle(dialog).display !== 'none' : false,
    title: document.getElementById('win95-confirm-title').textContent,
    message: document.getElementById('win95-confirm-message').textContent,
    acceptLabel: document.getElementById('win95-confirm-accept').textContent,
    acceptClass: document.getElementById('win95-confirm-accept').className,
    acceptTitle: document.getElementById('win95-confirm-accept').title,
    boxLabels: boxes.map((box) => box.closest('label')?.textContent?.trim() || ''),
    boxKinds: boxes.map((box) => box.tagName.toLowerCase() + ':' + box.type),
    boxPainted: boxes.map((box) => getComputedStyle(box.closest('label')).display !== 'none' && box.getClientRects().length > 0),
    insideDialog: Boolean(document.querySelector('#win95-confirm .win95-dialog #win95-confirm-notices')),
    focused: document.activeElement?.id || '',
    ran: window.__TEST_ACTION?.config?.actionSteps?.[0]?.actionAddress || '',
  };
})()`);
const clickShoot = async (settleMs = 500) => {
  await evaluate('window.__TEST_ACTION = null');
  return evaluate(`(async () => {
    document.getElementById('send-osc').click();
    await new Promise((resolve) => setTimeout(resolve, ${settleMs}));
    return true;
  })()`);
};

await evaluate(`localStorage.removeItem('wing_notice_muted'); localStorage.removeItem('wing_notice_shoot');`);
// The step check 5 saved is the one shot here, and no field is touched: editing one would mark the
// draft unsaved, and check 6's "New macro" would then ask to discard it instead of starting a blank
// macro — the dialog swallowed the click and the refusal that check reads never happened.
const SHOOT_ADDRESS = '/ch/11/mute';
assert.equal(await evaluate(`draftDirty === false`), true,
  'the draft must still be saved when this check starts, or New macro asks to discard it');
await clickShoot();
const shootWarning = await readNoticeDialog();
assert.equal(shootWarning.open, true, 'Shoot must warn while the stream is live');
assert.equal(shootWarning.title, 'Send to the console', `the warning must name the action (got "${shootWarning.title}")`);
assert.match(shootWarning.message, /It is a real change, not a test\.\s*$/,
  `the warning must say the write is real (got "${shootWarning.message}")`);
assert.equal(shootWarning.acceptLabel, 'Send it', 'the accept button must say what it does');
assert.equal(shootWarning.acceptClass, 'danger', 'Shoot writes to the live console, so its accept button stays red');
assert.ok(shootWarning.acceptTitle.length > 10, 'the accept button must carry a ScreenTip');
assert.deepEqual(shootWarning.boxLabels, [
  'Do not show this again for this action',
  'Do not show any of these warnings again',
], `the two notice boxes must carry the owner's wording (got ${JSON.stringify(shootWarning.boxLabels)})`);
assert.deepEqual(shootWarning.boxKinds, ['input:checkbox', 'input:checkbox'],
  'each notice must be a real check box inside a label');
assert.deepEqual(shootWarning.boxPainted, [true, true], 'both boxes must be painted');
assert.equal(shootWarning.insideDialog, true, 'the boxes must live in the dialog body, not beside it');
assert.equal(shootWarning.focused, 'win95-confirm-cancel', 'a real console write starts with Cancel focused');
assert.equal(shootWarning.ran, '', 'nothing may reach the console before the warning is answered');
await evaluate(`document.getElementById('win95-confirm-accept').focus()`);

await pressKey('Enter', 'Enter', 13);
const afterEnter = await readNoticeDialog();
assert.equal(afterEnter.open, false, 'Enter must accept the Shoot warning');
assert.equal(afterEnter.ran, SHOOT_ADDRESS, `Enter must carry the action out (got "${afterEnter.ran}")`);
const afterEnterKeys = await evaluate(`(() => ({
  action: localStorage.getItem('wing_notice_shoot'),
  all: localStorage.getItem('wing_notice_muted'),
}))()`);
assert.equal(afterEnterKeys.action, null, 'an unticked box must not mute the notice');
assert.equal(afterEnterKeys.all, null, 'nor the whole family of warnings');
console.log('5b. Shoot warning:', JSON.stringify({ message: shootWarning.message.length, boxes: shootWarning.boxLabels }));

// Ticking the first box mutes this action alone, and the action still goes through.
await clickShoot(450);
await evaluate(`document.getElementById('win95-confirm-notice-action').click();document.getElementById('win95-confirm-notice-action').focus()`);
const ticked = await evaluate(`(() => ({
  checked: document.getElementById('win95-confirm-notice-action').checked,
  other: document.getElementById('win95-confirm-notice-all').checked,
}))()`);
assert.equal(ticked.checked, true, 'the first box must be tickable');
assert.equal(ticked.other, false, 'the two boxes must stay independent');
await pressKey('Enter', 'Enter', 13);
const afterMute = await readNoticeDialog();
assert.equal(afterMute.open, false, 'Enter accepts with the focus on a notice box too');
assert.equal(afterMute.ran, SHOOT_ADDRESS, 'the action must still run when the box was ticked');
assert.equal(await evaluate(`localStorage.getItem('wing_notice_shoot')`), '1',
  'ticking the first box must remember this action');

// The next Shoot does not draw at all: it proceeds exactly as if it had been accepted.
await clickShoot(450);
const silenced = await readNoticeDialog();
assert.equal(silenced.open, false, 'a muted notice must not be drawn again');
assert.equal(silenced.ran, SHOOT_ADDRESS, 'the muted action must still reach the console');

// Escape still cancels, and restoring the warning brings the question back: the two keys are the
// operator's own silence, not a change to what the action does.
await evaluate(`localStorage.removeItem('wing_notice_shoot')`);
await clickShoot(450);
const restored = await readNoticeDialog();
assert.equal(restored.open, true, 'removing the key must bring the warning back');
await pressKey('Escape', 'Escape', 27);
const afterEscape = await readNoticeDialog();
assert.equal(afterEscape.open, false, 'Escape must close the warning');
assert.equal(afterEscape.ran, '', 'Escape must cancel the action');
assert.equal(await evaluate(`localStorage.getItem('wing_notice_shoot')`), null, 'Escape must not write a key');
await evaluate(`localStorage.removeItem('wing_notice_muted'); localStorage.removeItem('wing_notice_shoot');`);
console.log('5c. Shoot notice keys: ticking one silences the next shoot, Escape still cancels');

// --- 6. An incomplete macro cannot be enabled -----------------------------
// An enabled-but-unconfigured macro is skipped by the runtime, so the UI must say
// why instead of showing a green ENABLED row that never listens.
const enableGuard = await evaluate(`(async () => {
  document.getElementById('library-new').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.getElementById('library-toggle-enabled').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const macro = macroLibrary.macros[macroLibrary.selectedIndex];
  return {
    enabled: macro.enabled === true,
    message: document.getElementById('stream-output').textContent,
    starts: window.__STREAM_STARTS || 0,
  };
})()`);
assert.equal(enableGuard.enabled, false, 'an unconfigured macro must not become ENABLED');
assert.match(enableGuard.message, /Cannot enable an incomplete macro/, 'the refusal must be explained');
assert.equal(enableGuard.starts, reapplied.starts, 'a disabled macro must not restart the live session');
// The refusal is a real dialog: close it, or the next check reads this one's message.
await closeDialogIfOpen();
console.log('6. Enable guard:', JSON.stringify(enableGuard));

// --- 7. The HUD defaults panel seeds a step, and the factory reset keeps the console IP -------
const hudSeed = await evaluate(`(async () => {
  localStorage.setItem('wing_hud_prefs', JSON.stringify({
    display: 'toast', cardSize: 'giant', scale: 1.6, flashSpeed: 200,
    fontTitle: 30, fontMsg: 20, sound: 'voice', duration: 9, targetWindow: 'all',
  }));
  document.getElementById('library-new').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const mode = document.getElementById('action-mode');
  mode.value = 'hud_alert';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    display: document.getElementById('hud-alert-display').value,
    cardSize: document.getElementById('hud-alert-card-size').value,
    scale: document.getElementById('hud-alert-scale').value,
    sound: document.getElementById('hud-alert-sound').value,
  };
})()`);
assert.equal(hudSeed.display, 'toast', 'the HUD defaults panel must seed a new alert step');
assert.equal(hudSeed.cardSize, 'giant', 'the card size default must be seeded');
assert.equal(hudSeed.sound, 'voice', 'the sound default must be seeded');
console.log('7. HUD defaults seed:', JSON.stringify(hudSeed));

// --- 8. A model parameter survives leaving the step and coming back ---------
// `setSelectOptions` started with `innerHTML = ""`, which wiped the `<optgroup data-strip-model>`
// entries the strip-model read adds. `updateTargetParameters` then fell back to `options[0]`
// ("mute"), so selecting another step and coming back rewrote the step to `/ch/1/mute` and the next
// save persisted it. The step must keep `gate:1-thr` and resolve its own address.
const modelStep = await evaluate(`(async () => {
  const category = document.getElementById('target-category');
  category.value = 'ch';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  const ids = document.getElementById('target-ids');
  ids.value = '1';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  // The strip-model read is debounced by 450 ms.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const groups = [...document.querySelectorAll('#target-parameter optgroup[data-strip-model]')]
    .map((group) => group.dataset.stripModel);
  const option = [...document.getElementById('target-parameter').options].find((entry) => entry.value === 'gate:1-thr');
  if (option) {
    const parameter = document.getElementById('target-parameter');
    parameter.value = 'gate:1-thr';
    parameter.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  const before = readConfigFromUi().actionSteps.map((step) => step.targetParameter);
  // Add a second step and come back to the first one, the exact round trip that corrupted it.
  document.getElementById('add-step').click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  document.querySelector('#action-steps-list .action-step-item').click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const steps = readConfigFromUi().actionSteps;
  return {
    groups,
    optionPresent: Boolean(option),
    selected: document.getElementById('target-parameter').value,
    before,
    after: steps.map((step) => step.targetParameter),
    address: steps[0]?.actionAddress || '',
  };
})()`);
assert.ok(modelStep.groups.includes('gate:DEQ2'),
  `the strip-model read must publish its optgroup (got ${JSON.stringify(modelStep.groups)})`);
assert.equal(modelStep.optionPresent, true, 'the model parameter must be offered as an option');
assert.equal(modelStep.after[0], 'gate:1-thr',
  `the step must keep its model parameter across a round trip (got ${JSON.stringify(modelStep.after)})`);
assert.equal(modelStep.selected, 'gate:1-thr', 'the select must still show the stored parameter');
assert.ok(modelStep.address.includes('gate:1-thr'),
  `the resolved address must keep the model parameter (got ${modelStep.address})`);
console.log('8. Model parameter round trip:', JSON.stringify(modelStep));

// The metadata comes from the model named by the optgroup: DEQ2 carries `1-thr` with a -60..10 dB
// range, GATE carries `thr` with -80..0. A key the selected model does not have gets no metadata at
// all, instead of another model's range or a string kind sent to a float leaf.
const modelMetadata = await evaluate(`(() => ({
  thr: parameterInfo('target', 'ch', 'gate:1-thr'),
  notInModel: parameterInfo('target', 'ch', 'gate:thr'),
  otherModel: parameterInfo('target', 'ch', 'gate:att'),
}))()`);
assert.equal(modelMetadata.thr?.minValue, -60, 'gate:1-thr must carry DEQ2\'s own range');
assert.equal(modelMetadata.thr?.unit, 'dB', 'gate:1-thr must carry DEQ2\'s own unit');
assert.equal(modelMetadata.notInModel, null,
  'a name DEQ2 does not carry must have no metadata (GATE\'s `thr` range must not be borrowed)');
assert.equal(modelMetadata.otherModel, null,
  'a name DEQ2 does not carry must not inherit another model\'s value kind');
console.log('9. Model-scoped metadata:', JSON.stringify(modelMetadata));

// --- 10. A preflight refusal is shown, not whispered into a collapsed card ---
// "Arm Draft Only" wrote `arm_blocked_preflight_failed` into the log and did nothing else, so the
// button simply stayed off with no reason on screen.
await closeDialogIfOpen();
const armRefusal = await evaluate(`(async () => {
  window.__PREFLIGHT_OK = false;
  window.__PREFLIGHT_MESSAGES = ['Trigger ">" is not valid for Source Name: use == or !='];
  document.getElementById('stop-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  document.getElementById('armed-toggle').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const dialog = document.getElementById('win95-confirm');
  const visible = Boolean(dialog) && getComputedStyle(dialog).display !== 'none';
  const message = document.getElementById('win95-confirm-message')?.textContent || '';
  document.getElementById('win95-confirm-accept')?.click();
  window.__PREFLIGHT_OK = true;
  return {
    visible,
    message,
    calls: window.__PREFLIGHT_CALLS || 0,
    armed: typeof armed === 'boolean' ? armed : null,
  };
})()`);
assert.equal(armRefusal.visible, true, 'a preflight refusal must appear where the operator is looking');
assert.match(armRefusal.message, /not valid for Source Name/, `the dialog must carry the backend reason (got "${armRefusal.message}")`);
assert.equal(armRefusal.armed, false, 'a refused macro must not be left armed');
console.log('10. Arm preflight refusal:', JSON.stringify(armRefusal));

// --- 11. A send chosen from the grouped menu is saved with the step -------------------------
// The operator's report: matrix sends were effectively invisible in the flat parameter list. This
// drives the grouped picker the way the operator does — Sends, then Matrix sends — and checks the
// parameter reaches the saved library entry, not only the select.
const menuSave = await evaluate(`(async () => {
  const category = document.getElementById('target-category');
  category.value = 'ch';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('target-parameter-menu').click();
  const panel = document.getElementById('target-parameter-menu-list');
  const sends = panel.querySelector('[data-menu-group="sends"]');
  sends.dispatchEvent(new MouseEvent('mouseenter'));
  const matrix = sends.querySelector('[data-menu-group="sends_matrix"]');
  matrix.dispatchEvent(new MouseEvent('mouseenter'));
  const row = matrix.querySelector('.parameter-menu-row[data-parameter="send_matrix_level"]');
  const reachable = Boolean(row) && row.getClientRects().length > 0;
  if (row) row.click();
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('target-ids', '2');
  set('send-id', '3');
  set('osc-value', '-20');
  await new Promise((resolve) => setTimeout(resolve, 200));
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const library = window.__SAVED_LIBRARY || {};
  const macro = (library.macros || [])[library.selectedIndex] || {};
  const step = (macro.actionSteps || [])[0] || {};
  return {
    reachable,
    select: document.getElementById('target-parameter').value,
    saved: step.targetParameter,
    savedSend: step.sendId,
    address: step.actionAddress,
  };
})()`);
assert.equal(menuSave.reachable, true, 'the matrix send must be visible inside the open Sends submenu');
assert.equal(menuSave.select, 'send_matrix_level', 'the menu must write the choice into the select');
assert.equal(menuSave.saved, 'send_matrix_level',
  `the saved library entry must carry the parameter chosen from the menu (got ${menuSave.saved})`);
assert.equal(menuSave.savedSend, 3, 'the saved step must carry the destination chosen for it');
console.log('11. Menu send saved:', JSON.stringify(menuSave));

// --- 12. The armed draft carries the model the strip read ----------------------------------
// `start_wing_usb_stream` takes an optional `targetModel` next to `sendId`, and the backend checks a
// `section:name` parameter against it. The model is the one the strip-model read published for the
// key (check 8's `<optgroup data-strip-model>`); a trigger that is not model-scoped must carry
// nothing, because the backend reads an absent model as "not known" and an invented one would be
// worse than none. This asserts on the request the mock IPC actually received — the window builds it
// from the object `readConfigFromUi()` returns — so both the value and the transport are covered.
await closeDialogIfOpen();
const armedDraft = await evaluate(`(async () => {
  document.getElementById('stop-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const category = document.getElementById('target-category');
  category.value = 'ch';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  set('target-ids', '1');
  // The strip-model read is debounced by 450 ms: let it publish the DEQ2 group again.
  await new Promise((resolve) => setTimeout(resolve, 800));
  set('trigger-category', 'ch');
  set('trigger-ids', '1');
  set('trigger-parameter', 'gate:1-thr');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const draft = readConfigFromUi();
  // Saving first keeps the connect from asking about unsaved changes through the Win95 dialog.
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  document.getElementById('armed-toggle').click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  document.getElementById('live-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  return {
    draftParameter: draft.triggerParameter,
    draftModel: draft.targetModel,
    armed: armed === true,
    request: window.__LAST_STREAM_REQUEST || null,
  };
})()`);
assert.equal(armedDraft.draftParameter, 'gate:1-thr', 'the draft must watch the model-scoped trigger');
assert.equal(armedDraft.draftModel, 'DEQ2', `the draft must report the model read for its key (got ${JSON.stringify(armedDraft)})`);
assert.equal(armedDraft.armed, true, 'the draft must really be armed for this check');
assert.equal(armedDraft.request?.armed, true, 'the request the backend receives must be the armed draft');
assert.equal(armedDraft.request?.triggerParameter, 'gate:1-thr', 'the request must carry the watched key');
assert.equal(armedDraft.request?.targetModel, 'DEQ2',
  `the armed draft request must carry the model the strip read (got ${JSON.stringify(armedDraft.request?.targetModel)})`);
console.log('12. Armed draft model:', JSON.stringify({
  draft: [armedDraft.draftParameter, armedDraft.draftModel],
  request: [armedDraft.request?.triggerParameter, armedDraft.request?.targetModel, armedDraft.request?.armed],
}));

// The same request for a trigger that is not model-scoped: the key is carried empty, never invented.
const unscopedDraft = await evaluate(`(async () => {
  document.getElementById('stop-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const field = document.getElementById('trigger-parameter');
  field.value = 'meter';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  document.getElementById('armed-toggle').click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  document.getElementById('live-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  return { model: window.__LAST_STREAM_REQUEST?.targetModel, parameter: window.__LAST_STREAM_REQUEST?.triggerParameter };
})()`);
assert.equal(unscopedDraft.parameter, 'meter', 'the second draft must watch a meter');
assert.ok(!unscopedDraft.model,
  `a trigger that is not model-scoped must carry no model (got ${JSON.stringify(unscopedDraft.model)})`);
console.log('12b. Unscoped draft model:', JSON.stringify(unscopedDraft));
await evaluate(`document.getElementById('stop-stream').click()`);
await closeDialogIfOpen();

// --- 12c. The armed draft carries the model for a plain catalogue key ----------------------
// `gate_thr` (Gate Threshold) resolves to the very same leaf as `gate:1-thr`, and the backend checks
// it through the catalogue mapping. The editor knew a model only for the `section:name` spelling, so
// this draft carried nothing and the check could never fire; the row now names the slot the leaf lives
// in (`modelSection`), and the model the strip-model read published for that slot travels with the
// draft. Asserted on the request the mock IPC recorded, exactly like checks 12 and 13.
const armedCatalogueDraft = await evaluate(`(async () => {
  document.getElementById('stop-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const category = document.getElementById('target-category');
  category.value = 'ch';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  set('target-ids', '1');
  // The strip-model read is debounced by 450 ms: let it publish the DEQ2 model of the gate slot again.
  await new Promise((resolve) => setTimeout(resolve, 800));
  set('trigger-category', 'ch');
  set('trigger-ids', '1');
  set('trigger-parameter', 'gate_thr');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const draft = readConfigFromUi();
  // Saving first keeps the connect from asking about unsaved changes through the Win95 dialog.
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  if (armed !== true) {
    document.getElementById('armed-toggle').click();
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  document.getElementById('live-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  return {
    draftParameter: draft.triggerParameter,
    draftModel: draft.targetModel,
    armed: armed === true,
    request: window.__LAST_STREAM_REQUEST || null,
  };
})()`);
assert.equal(armedCatalogueDraft.draftParameter, 'gate_thr', 'the draft must watch the plain catalogue key');
assert.equal(armedCatalogueDraft.draftModel, 'DEQ2',
  `the draft must report the model the strip runs in that key's slot (got ${JSON.stringify(armedCatalogueDraft.draftModel)})`);
assert.equal(armedCatalogueDraft.armed, true, 'the catalogue-key draft must really be armed for this check');
assert.equal(armedCatalogueDraft.request?.armed, true, 'the request the backend receives must be the armed draft');
assert.equal(armedCatalogueDraft.request?.triggerParameter, 'gate_thr', 'the request must carry the watched key');
assert.equal(armedCatalogueDraft.request?.targetModel, 'DEQ2',
  `the armed draft request must carry the model for the catalogue key (got ${JSON.stringify(armedCatalogueDraft.request?.targetModel)})`);
console.log('12c. Armed draft model for a catalogue key:', JSON.stringify({
  draft: [armedCatalogueDraft.draftParameter, armedCatalogueDraft.draftModel],
  request: [armedCatalogueDraft.request?.triggerParameter, armedCatalogueDraft.request?.targetModel, armedCatalogueDraft.request?.armed],
}));
await evaluate(`document.getElementById('stop-stream').click()`);
await closeDialogIfOpen();

// --- 12d. The model travels from the panel's OWN strip, never from the target's -----------------
// The defect this pins: `read_strip_models` was called once, keyed to the target panel, and every
// panel read one global section→model map. A trigger on ch/1 therefore travelled with the model read
// for the target's ch/3 — the backend checks the name against that model, so a valid macro on ch/1
// was refused naming a model it would never run, and the mirror case (the trigger's own model lacks
// the name) passed the check while the console ignored the write. This one drives two strips with
// different models and asserts both directions, on the request the mock IPC records.
await closeDialogIfOpen();
const twoStrips = await evaluate(`(async () => {
  document.getElementById('stop-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const draftOf = () => {
    const config = readConfigFromUi();
    const step = config.actionSteps[selectedStepIndex] || {};
    return {
      triggerParameter: config.triggerParameter,
      triggerModel: config.targetModel,
      stepParameter: step.targetParameter,
      stepModel: step.targetModel,
      reads: (window.__STRIP_READS || []).map((entry) => entry.family + ':' + entry.ids),
    };
  };
  // The action is on ch/1 (DEQ2) and the trigger on ch/3 (GATE): two strips, two models.
  set('target-category', 'ch');
  set('target-ids', '1');
  set('target-parameter', 'gate_thr');
  await new Promise((resolve) => setTimeout(resolve, 800));
  set('trigger-category', 'ch');
  set('trigger-ids', '3');
  set('trigger-parameter', 'gate_thr');
  await new Promise((resolve) => setTimeout(resolve, 800));
  const forward = draftOf();
  // The mirror: the action moves to ch/3 (GATE) and the trigger back to ch/1 (DEQ2).
  set('target-ids', '3');
  await new Promise((resolve) => setTimeout(resolve, 300));
  set('trigger-ids', '1');
  set('trigger-parameter', 'gate_thr');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const mirror = draftOf();
  // Neither strip is read twice: re-typing the same ids must not schedule another read.
  const before = (window.__STRIP_READS || []).length;
  set('target-ids', '9');
  await new Promise((resolve) => setTimeout(resolve, 50));
  set('target-ids', '3');
  set('trigger-ids', '1');
  await new Promise((resolve) => setTimeout(resolve, 900));
  const reReads = (window.__STRIP_READS || []).length - before;
  // A family with no strip is never read: a usb source has no /gate/mdl to answer.
  set('trigger-category', 'usb');
  set('trigger-ids', '1');
  await new Promise((resolve) => setTimeout(resolve, 700));
  const nonStripReads = (window.__STRIP_READS || []).filter((entry) => entry.family === 'usb').length;
  set('target-ids', '1');
  set('target-parameter', 'mute');
  return { forward, mirror, reReads, nonStripReads };
})()`);
for (const [where, expected] of [['forward', { trigger: 'GATE', step: 'DEQ2' }], ['mirror', { trigger: 'DEQ2', step: 'GATE' }]]) {
  const seen = twoStrips[where];
  assert.ok(seen.reads.includes('ch:1') && seen.reads.includes('ch:3'),
    `12d ${where}: each panel's own strip must be read (reads: ${JSON.stringify(seen.reads)})`);
  assert.equal(seen.triggerParameter, 'gate_thr', `12d ${where}: the trigger must stay on the plain catalogue key`);
  assert.equal(seen.triggerModel, expected.trigger,
    `12d ${where}: the trigger must carry the model read for ITS strip, not the target's (got ${JSON.stringify(seen)})`);
  assert.equal(seen.stepParameter, 'gate_thr', `12d ${where}: the step must stay on the plain catalogue key`);
  assert.equal(seen.stepModel, expected.step,
    `12d ${where}: the step must carry the model read for the target's strip (got ${JSON.stringify(seen)})`);
}
assert.equal(twoStrips.reReads, 0,
  `12d: a strip already read must not be read again (${twoStrips.reReads} extra reads)`);
assert.equal(twoStrips.nonStripReads, 0,
  `12d: a family with no strip must never be read (${twoStrips.nonStripReads} reads for usb)`);
console.log('12d. Two strips, two models:', JSON.stringify(twoStrips));
await closeDialogIfOpen();

// --- 12e. The saved library keeps the model the macro was written for ----------------------------
// The other half of 12d: the wire carries the model the strip runs, the library record keeps the
// model the macro was written for. The save path used to copy the wire model into the library entry,
// so a GEQ macro on `gate_thr` became a DEQ2 macro the moment the strip was read; the assertions that
// claimed otherwise read the test's own literal. This drives the real save and reads the library the
// mock IPC actually received.
const writtenModels = await evaluate(`(async () => {
  document.getElementById('stop-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const name = 'Written for a GEQ ' + Date.now();
  const stored = {
    name, wingIp: '192.168.1.10',
    triggerCategory: 'ch', triggerIds: '1', triggerParameter: 'gate_thr', targetModel: 'GEQ',
    triggerOperator: '>', triggerEdgeMode: 'on', triggerThreshold: -20, logicalOperator: 'AND',
    conditions: [{ label: 'Gate', targetCategory: 'ch', targetIds: '1', targetParameter: 'gate_thr', targetModel: 'GEQ', operator: '>', value: '-20', sendId: 1, enabled: true }],
    enabled: false, armed: false,
    actionSteps: [{ label: 'Gate threshold', actionAddress: '/ch/1/gate/thr', actionArgKind: 'float', actionValue: '-20', actionMode: 'set', targetCategory: 'ch', targetIds: '1', targetParameter: 'gate_thr', targetModel: 'GEQ', sendId: 1, enabled: true }],
  };
  applyConfig(stored, { keepDirty: true });
  set('target-category', 'ch');
  set('target-ids', '1');
  // Let the ch/1 read (DEQ2) answer again for this check.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const wire = readConfigFromUi();
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  const library = window.__SAVED_LIBRARY || { macros: [] };
  const saved = (library.macros || []).find((macro) => macro.name === name) || {};
  const savedStep = (saved.actionSteps || [])[0] || {};
  const savedGate = (saved.conditions || [])[0] || {};
  // Loading the saved macro back shows the same two answers again: the label keeps the model the
  // macro was written for, the wire keeps the model the strip runs.
  applyConfig(saved, { keepDirty: true });
  const option = document.getElementById('target-parameter').selectedOptions[0];
  const reloaded = readConfigFromUi();
  return {
    savedName: saved.name || '',
    wire: [(wire.actionSteps[0] || {}).targetModel, wire.targetModel, (wire.conditions[0] || {}).targetModel],
    saved: [savedStep.targetModel, saved.targetModel, savedGate.targetModel],
    reloaded: [(reloaded.actionSteps[0] || {}).targetModel, reloaded.targetModel, (reloaded.conditions[0] || {}).targetModel],
    optionText: option ? option.textContent : '',
  };
})()`);
assert.ok(writtenModels.savedName.startsWith('Written for a GEQ'),
  `12e: the save must have written the macro to the library (got ${JSON.stringify(writtenModels)})`);
assert.deepEqual(writtenModels.wire, ['DEQ2', 'DEQ2', 'DEQ2'],
  `12e: the wire must carry the model the strip runs, for step, trigger and gate (got ${JSON.stringify(writtenModels.wire)})`);
assert.deepEqual(writtenModels.saved, ['GEQ', 'GEQ', 'GEQ'],
  `12e: the library must keep the model each target was written for (got ${JSON.stringify(writtenModels.saved)})`);
assert.deepEqual(writtenModels.reloaded, ['DEQ2', 'DEQ2', 'DEQ2'],
  `12e: a saved macro read back must still travel with the strip's model (got ${JSON.stringify(writtenModels.reloaded)})`);
console.log('12e. Saved library keeps the written model:', JSON.stringify(writtenModels));
await closeDialogIfOpen();

// The tab and its socket are closed here, not only from the `exit` handler: an open WebSocket is a live handle on the
// event loop, so waiting for `exit` to close it is a process that never exits — measured, after the split.
closeTab();
console.log("WING_BROWSER_SUITE_OK");
