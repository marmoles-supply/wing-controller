// End-to-end check of the desktop UI in a real browser with a stubbed Tauri IPC — **the second half**.
//
// Split from `test-desktop-action-target-browser.mjs` because headless Chrome on this machine stops answering after
// roughly ninety seconds of page activity (`docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md`): measured, the first half reaches
// section 15 at ~72 s and the very next `Runtime.evaluate` never comes back. Each half is a process of its own with a
// fresh tab, which is the remedy this suite's own header already described for the runtime checks.
//
// Covers, against the real index.html script:
//   13-15. The armed draft's destination index, a talkback assign, and the index-less I/O node
//          with the oscillator's extra `osc` segment. They moved here from the first half because that half
//          reached the wedge at 75 s — measured — with section 15 as its last call.
//   17. The desk level: monitor buses, safes, AES50, W-Live and the clock.
//   24. The catalogue is re-read for the model the desk announces at discovery.
//   25. The Rack is not offered the monitor level write.
//   26. A range of channels reaches the backend as a range.
//
// The harness — the CDP client with its deadline, the page and the stub — is in `lib/desktop-ui-harness.mjs`, shared with
// the first half so the two cannot drift apart.
//
// Run: node scripts/test-desktop-action-target-tail-browser.mjs

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

// --- 13. The armed draft carries the trigger's destination index --------------------------
// `start_wing_usb_stream` takes an optional `sendId` beside `targetModel`, and the live request used
// to omit it: the backend then resolved the watched send with no index, taking destination 1 (and
// refusing a bus send outright), so a trigger the operator watched on send 3 silently watched send 1.
// A bus send is the worst case, so this drives one and asserts on the request the mock IPC recorded —
// the window builds it from `readConfigFromUi()`, so the field, the draft and the transport are all
// covered. Arming twice would disarm, so the click happens only when the button is not already armed.
const armedSendDraft = await evaluate(`(async () => {
  document.getElementById('stop-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('trigger-category', 'bus');
  await new Promise((resolve) => setTimeout(resolve, 250));
  set('trigger-ids', '2');
  set('trigger-parameter', 'send_level');
  await new Promise((resolve) => setTimeout(resolve, 250));
  set('trigger-send-id', '3');
  await new Promise((resolve) => setTimeout(resolve, 200));
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
    shown: !document.getElementById('trigger-send-id-field').classList.contains('hidden'),
    draftSendId: draft.sendId,
    draftParameter: draft.triggerParameter,
    armed: armed === true,
    request: window.__LAST_STREAM_REQUEST || null,
  };
})()`);
assert.equal(armedSendDraft.shown, true, 'a trigger on a send must show its own destination control');
assert.equal(armedSendDraft.draftParameter, 'send_level', 'the draft must watch the bus send');
assert.equal(armedSendDraft.draftSendId, 3,
  `the draft must report the watched destination (got ${JSON.stringify(armedSendDraft.draftSendId)})`);
assert.equal(armedSendDraft.armed, true, 'the bus-send draft must really be armed for this check');
assert.equal(armedSendDraft.request?.armed, true, 'the request the backend receives must be the armed draft');
assert.equal(armedSendDraft.request?.triggerCategory, 'bus', 'the request must carry the watched family');
assert.equal(armedSendDraft.request?.triggerParameter, 'send_level', 'the request must carry the watched send');
assert.equal(armedSendDraft.request?.sendId, 3,
  `the armed draft request must carry the trigger's destination (got ${JSON.stringify(armedSendDraft.request?.sendId)})`);
console.log('13. Armed draft send destination:', JSON.stringify({
  draft: [armedSendDraft.request?.triggerCategory, armedSendDraft.request?.triggerParameter, armedSendDraft.draftSendId],
  request: [armedSendDraft.request?.sendId, armedSendDraft.request?.armed],
}));
await evaluate(`document.getElementById('stop-stream').click()`);
await closeDialogIfOpen();

// --- 14. A talkback assign drives the same destination control as a send -------------------------
// Maillot 1469-1496: `/cfg/talk/A/B5` is bus 5 of talkback A. The assign carries the destination
// index the send parameters already use, so the field, its bound and its grouped picker must work
// for it with no second implementation — and the index must reach the address the draft resolves to.
const talkAssignDrafts = await evaluate(`(async () => {
  document.getElementById('stop-stream').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const visible = (id) => {
    const el = document.getElementById(id);
    return Boolean(el) && !el.classList.contains('hidden') && el.getClientRects().length > 0;
  };
  set('target-category', 'talk');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const drafts = {};
  for (const [key, label, max] of [
    ['talk_bus_assign', 'Bus', 16],
    ['talk_matrix_assign', 'Matrix', 8],
    ['talk_main_assign', 'Main', 4],
  ]) {
    set('target-parameter', key);
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Which destinations the grouped picker offers: open the control, read the rows it drew, close it.
    // A sendIndex row carries its index in data-menu-value, not in data-parameter, which only the
    // parameter pickers set.
    const menu = document.getElementById('send-id-menu-list');
    const button = document.getElementById('send-id-menu');
    if (menu.hidden) button.click();
    const opened = [...menu.querySelectorAll('.parameter-menu-row')]
      .map((row) => ({ value: row.dataset.menuValue, label: row.querySelector('.parameter-menu-label')?.textContent || '', disabled: row.disabled }));
    if (!menu.hidden) button.click();
    // One past the documented size, then the last documented destination.
    set('send-id', String(max + 1));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const refused = {
      invalid: document.getElementById('send-id').classList.contains('is-invalid'),
      problem: document.getElementById('send-id-problem')?.textContent || '',
    };
    // The last documented destination, which is valid for every family (main only has four) and so
    // is the one the save path must accept.
    set('send-id', String(max));
    await new Promise((resolve) => setTimeout(resolve, 120));
    // The config's own sendId is the trigger's destination; the step's index travels in its step
    // record, which is the value the save and the shoot path use.
    const step = readConfigFromUi().actionSteps[selectedStepIndex] || {};
    drafts[key] = {
      label: document.getElementById('send-id-label').textContent,
      hint: document.getElementById('send-id-hint').textContent,
      max: document.getElementById('send-id').max,
      shown: visible('send-id-field'),
      menuOpen: !menu.hidden,
      destination: activeTargetParameterInfo().label,
      rows: opened,
      refused,
      sendId: step.sendId,
      address: document.getElementById('osc-address').value,
      expectedDestination: label,
      expectedMax: max,
    };
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const draftBeforeSave = readConfigFromUi();
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  const library = window.__SAVED_LIBRARY || { macros: [] };
  const macro = (library.macros || [])[library.selectedIndex] || {};
  const dialog = document.getElementById('win95-confirm');
  drafts.dialog = dialog && getComputedStyle(dialog).display !== 'none'
    ? document.getElementById('win95-confirm-message')?.textContent || ''
    : '';
  drafts.wire = (draftBeforeSave.actionSteps || []).map((step) => ({ parameter: step.targetParameter, sendId: step.sendId, address: step.actionAddress }));
  drafts.saved = (macro.actionSteps || []).map((step) => ({ parameter: step.targetParameter, sendId: step.sendId, address: step.actionAddress }));
  return drafts;
})()`);
for (const [key, label, max] of [
  ['talk_bus_assign', 'Bus', 16],
  ['talk_matrix_assign', 'Matrix', 8],
  ['talk_main_assign', 'Main', 4],
]) {
  const seen = talkAssignDrafts[key];
  assert.equal(seen.shown, true, `${key} must show the destination control: an assign with no index addresses nothing`);
  assert.equal(seen.label, `${label} assign`,
    `${key} must label the destination "${label} assign" (got "${seen.label}")`);
  assert.equal(seen.max, String(max),
    `${key} must bound the destination at ${max}, the range the row publishes (got ${seen.max})`);
  assert.match(seen.hint, new RegExp(`${label} 1…${max}`),
    `${key} must say which destinations it addresses (got "${seen.hint}")`);
  // One extra row: the "choose the destination" placeholder that keeps an unset assign unset
  // instead of silently addressing destination 1.
  assert.equal(seen.rows.length, max + 1,
    `${key} must offer the placeholder plus its ${max} destinations (got ${seen.rows.length})`);
  assert.equal(seen.rows[0].value, '', `${key}'s first row must be the placeholder`);
  assert.deepEqual(seen.rows.slice(1).map((row) => row.value), Array.from({ length: max }, (_, index) => String(index + 1)),
    `${key}'s grouped picker must list the ${label} destinations 1…${max} in order (got ${JSON.stringify(seen.rows.slice(1).map((row) => row.value))})`);
  const expectedLabels = Array.from({ length: max }, (_, index) => label + ' ' + (index + 1));
  assert.deepEqual(seen.rows.slice(1).map((row) => row.label), expectedLabels,
    `${key}'s grouped picker must label each destination (got ${JSON.stringify(seen.rows.map((row) => row.label))})`);
  assert.equal(seen.rows.some((row) => row.disabled), false,
    `${key} must offer every ${label} destination: only a bus's own send is refused, and this is not a send`);
  assert.equal(seen.menuOpen, false, 'the grouped picker must be left closed for the checks that follow');
  assert.equal(seen.refused.invalid, true, `${key} must refuse ${max + 1}: ${label} only has ${max}`);
  assert.match(seen.refused.problem, new RegExp(`higher than ${max}`),
    `${key} must name the bound it refused (got "${seen.refused.problem}")`);
  assert.equal(seen.sendId, max, `${key} must carry the destination in the step record (got ${JSON.stringify(seen.sendId)})`);
  const leaf = `${key === 'talk_bus_assign' ? 'B' : key === 'talk_matrix_assign' ? 'MX' : 'M'}${max}`;
  assert.equal(seen.address, `/cfg/talk/A/${leaf}`,
    `${key} must resolve to its documented leaf (got "${seen.address}")`);
}
const talkAssignSaved = talkAssignDrafts.saved.find((step) => step.parameter === 'talk_main_assign');
assert.ok(talkAssignSaved, `the saved draft must hold the talkback assign (got ${JSON.stringify(talkAssignDrafts.saved)})`);
assert.equal(talkAssignDrafts.dialog, '',
  `nothing may refuse the save of a valid talkback assign (got "${talkAssignDrafts.dialog}")`);
assert.equal(talkAssignSaved.sendId, 4, 'the saved step must keep the destination index');
assert.equal(talkAssignSaved.address, '/cfg/talk/A/M4', 'the saved step must keep the resolved leaf');
// The ids are the talkback itself: 1 and 2 are the two entries the console has, and the readout names
// the one the operator is addressing.
const talkIdsScope = await evaluate(`(() => {
  const ids = document.getElementById('target-ids');
  const readout = document.getElementById('target-ids-destination');
  const show = (value) => {
    ids.value = value;
    ids.dispatchEvent(new Event('input', { bubbles: true }));
    return readout.textContent;
  };
  return { one: show('1'), two: show('2'), invalid: (() => {
    ids.value = '3';
    ids.dispatchEvent(new Event('input', { bubbles: true }));
    return { marked: ids.classList.contains('is-invalid'), problem: document.getElementById('target-ids-problem')?.textContent || '' };
  })() };
})()`);
assert.equal(talkIdsScope.one, 'Talkback A', `talkback id 1 must read as Talkback A (got "${talkIdsScope.one}")`);
assert.equal(talkIdsScope.two, 'Talkback B', `talkback id 2 must read as Talkback B (got "${talkIdsScope.two}")`);
assert.equal(talkIdsScope.invalid.marked, true, 'talkback id 3 must be refused: the node has two entries');
assert.match(talkIdsScope.invalid.problem, /talk only has 2/,
  `the refusal must name the two entries (got "${talkIdsScope.invalid.problem}")`);
console.log('14. Talkback assign destinations:', JSON.stringify({
  bus: [talkAssignDrafts.talk_bus_assign.label, talkAssignDrafts.talk_bus_assign.max, talkAssignDrafts.talk_bus_assign.address],
  matrix: [talkAssignDrafts.talk_matrix_assign.label, talkAssignDrafts.talk_matrix_assign.max, talkAssignDrafts.talk_matrix_assign.address],
  main: [talkAssignDrafts.talk_main_assign.label, talkAssignDrafts.talk_main_assign.max, talkAssignDrafts.talk_main_assign.address],
  ids: [talkIdsScope.one, talkIdsScope.two],
}));
await closeDialogIfOpen();

// --- 15. The index-less /io node and the oscillator's extra `osc` segment ---------------------
// Two addresses the editor must not invent. `/io/altsw` carries no entry index, so a panel that
// concatenated the id would write `/io/1/altsw`, which the console ignores; and the oscillator's
// leaves live one segment deeper than their category (`/io/in/OSC/1/osc/lvl`), so an editor that
// built the address from the key's prefix would drop the segment. Both are resolved by the backend
// and only carried here, which this check asserts on the field, the draft and the saved step.
const ioAndOscillator = await evaluate(`(async () => {
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 350));
  const readStep = () => {
    const info = activeTargetParameterInfo();
    return {
      parameter: document.getElementById('target-parameter').value,
      ids: document.getElementById('target-ids').value,
      address: document.getElementById('osc-address').value,
      stepAddress: (readConfigFromUi().actionSteps[selectedStepIndex] || {}).actionAddress,
      min: info.minValue,
      max: info.maxValue,
      valueKind: info.valueKind,
      unit: info.unit,
    };
  };
  // The global switch: the category is index-less, so the ids field must not reach the address.
  const category = document.getElementById('target-category');
  category.value = 'io';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  set('target-ids', '1');
  set('target-parameter', 'io_altsw');
  await settle();
  const altsw = readStep();
  // …and the oscillator, whose level lives under its own osc node.
  category.value = 'preamp_oscillator';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  set('target-ids', '2');
  set('target-parameter', 'osc_level');
  await settle();
  const oscillator = readStep();
  set('osc-value', '-12');
  await settle();
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const macro = (window.__SAVED_LIBRARY?.macros || [])[window.__SAVED_LIBRARY?.selectedIndex || 0] || {};
  const saved = (macro.actionSteps || [])[0] || {};
  const dialog = document.getElementById('win95-confirm');
  return {
    altsw,
    oscillator,
    saved: { address: saved.actionAddress, parameter: saved.targetParameter, value: saved.actionValue, ids: saved.targetIds },
    dialog: dialog && getComputedStyle(dialog).display !== 'none'
      ? document.getElementById('win95-confirm-message')?.textContent || ''
      : '',
  };
})()`);
assert.equal(ioAndOscillator.altsw.address, '/io/altsw',
  `the index-less I/O switch must resolve without an id segment (got "${ioAndOscillator.altsw.address}")`);
assert.equal(ioAndOscillator.altsw.stepAddress, '/io/altsw',
  `the step record must carry the same index-less address (got "${ioAndOscillator.altsw.stepAddress}")`);
assert.equal(ioAndOscillator.oscillator.address, '/io/in/OSC/2/osc/lvl',
  `the oscillator level must keep the extra osc segment and the strip's own id (got "${ioAndOscillator.oscillator.address}")`);
assert.equal(ioAndOscillator.oscillator.stepAddress, '/io/in/OSC/2/osc/lvl',
  `the step record must carry the resolved oscillator address, not one rebuilt from the prefix (got "${ioAndOscillator.oscillator.stepAddress}")`);
assert.equal(ioAndOscillator.oscillator.min, -40,
  `the oscillator level's documented floor must come from the catalogue (got ${ioAndOscillator.oscillator.min})`);
assert.equal(ioAndOscillator.oscillator.max, 6,
  `the oscillator level's documented ceiling must come from the catalogue (got ${ioAndOscillator.oscillator.max})`);
assert.equal(ioAndOscillator.dialog, '',
  `nothing may refuse the save of a valid oscillator step (got "${ioAndOscillator.dialog}")`);
assert.equal(ioAndOscillator.saved.address, '/io/in/OSC/2/osc/lvl',
  `the saved step must keep the resolved address (got "${ioAndOscillator.saved.address}")`);
assert.equal(ioAndOscillator.saved.value, '-12',
  `the saved step must keep the level that was typed (got "${ioAndOscillator.saved.value}")`);
console.log('15. Index-less I/O and the oscillator segment:', JSON.stringify({
  altsw: ioAndOscillator.altsw.address,
  oscillator: ioAndOscillator.oscillator.address,
  saved: ioAndOscillator.saved.address,
}));
await closeDialogIfOpen();

// --- 16. The USB transport, the fader layers and the desk status --------------------------------
// Maillot `/rec` (3068-3075), `/play` (3045-3066), `/$ctl/layer/<letter>/sel` (3220, 3299, 3381,
// 3456, 3523, 3585, 3645) and `/$ctl/$stat/{selidx,pageidx}` (3096-3097). Two addresses the editor
// must not invent: the transport nodes are index-less, so `/rec/$action` carries no id whatever the
// panel holds, and the fader layers are addressed by a **letter**, so id 2 becomes
// `/$ctl/layer/C/sel`. The two state halves and the desk status are watch-only, which is the
// category flags' work: the step list must not offer them and the trigger list must.
const batch4Transport = await evaluate(`(async () => {
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 350));
  const keysOf = (id) => [...document.getElementById(id).querySelectorAll('option')]
    .filter((option) => option.value)
    .map((option) => option.value);
  const readStep = () => ({
    parameter: document.getElementById('target-parameter').value,
    ids: document.getElementById('target-ids').value,
    address: document.getElementById('osc-address').value,
    stepAddress: (readConfigFromUi().actionSteps[selectedStepIndex] || {}).actionAddress,
  });
  const lists = { target: keysOf('target-category'), trigger: keysOf('trigger-category'), condition: keysOf('condition-category') };
  // The recorder: one index-less leaf, so the id in the field never reaches the address.
  set('target-category', 'rec');
  await settle();
  set('target-ids', '1');
  set('target-parameter', 'rec_action');
  await settle();
  set('osc-value-options', 'REC');
  await settle();
  const recorder = readStep();
  // The player, reached through its own category with a different id: still no id segment.
  set('target-category', 'play');
  await settle();
  set('target-ids', '9');
  set('target-parameter', 'play_action');
  await settle();
  const player = readStep();
  // The fader layer: the id selects the surface, and the readout names it.
  set('target-category', 'layer');
  await settle();
  set('target-ids', '2');
  set('target-parameter', 'layer_select');
  await settle();
  set('osc-value', '7');
  await settle();
  const layer = {
    ...readStep(),
    readout: document.getElementById('target-ids-destination').textContent,
  };
  // An eighth id names no surface: the field refuses it and no address may be invented for it.
  set('target-ids', '8');
  await settle();
  const eighth = {
    invalid: document.getElementById('target-ids').classList.contains('is-invalid'),
    problem: document.getElementById('target-ids-problem')?.textContent || '',
    address: document.getElementById('osc-address').value,
  };
  // …and the state halves: watched, never written.
  set('target-ids', '1');
  await settle();
  set('trigger-category', 'stat');
  await settle();
  set('trigger-parameter', 'selected_strip');
  await settle();
  const stat = {
    keys: [...document.getElementById('trigger-parameter').options]
      .filter((option) => option.value && !option.value.includes(':') && !option.textContent.includes('not in this catalogue'))
      .map((option) => option.value),
    ids: document.getElementById('trigger-ids').value,
    preview: document.getElementById('trigger-path-preview').textContent,
  };
  // Put the watch panel back on a valid trigger before saving: the save validates the whole draft,
  // and the status trigger above carries the ids the category seeds plus the comparison still to be
  // filled in. (A status trigger is a perfectly saveable macro once its threshold is set; this check
  // is about the step's address, not about leaving a half-filled watch behind.)
  set('trigger-category', 'usb');
  await settle();
  set('trigger-ids', '1');
  set('trigger-parameter', 'meter');
  set('trigger-operator', '>');
  set('threshold', '-18');
  await settle();
  // Save the layer step and read what the library kept.
  set('target-category', 'layer');
  await settle();
  set('target-ids', '2');
  set('target-parameter', 'layer_select');
  await settle();
  set('osc-value', '7');
  await settle();
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const macro = (window.__SAVED_LIBRARY?.macros || [])[window.__SAVED_LIBRARY?.selectedIndex || 0] || {};
  const saved = (macro.actionSteps || []).find((step) => step.targetParameter === 'layer_select') || {};
  const dialog = document.getElementById('win95-confirm');
  return {
    lists, recorder, player, layer, eighth, stat,
    saved: { address: saved.actionAddress, ids: saved.targetIds, value: saved.actionValue },
    dialog: dialog && getComputedStyle(dialog).display !== 'none'
      ? document.getElementById('win95-confirm-message')?.textContent || ''
      : '',
  };
})()`);
for (const written of ['rec', 'play', 'layer']) {
  assert.ok(batch4Transport.lists.target.includes(written),
    `${written} is a step destination (got ${JSON.stringify(batch4Transport.lists.target)})`);
}
for (const watchOnly of ['recstate', 'playstate', 'stat']) {
  assert.ok(!batch4Transport.lists.target.includes(watchOnly),
    `${watchOnly} is read-only and must not be a step destination (got ${JSON.stringify(batch4Transport.lists.target)})`);
  assert.ok(batch4Transport.lists.trigger.includes(watchOnly) && batch4Transport.lists.condition.includes(watchOnly),
    `${watchOnly} must be a trigger and an IF gate (got ${JSON.stringify(batch4Transport.lists)})`);
}
assert.equal(batch4Transport.recorder.address, '/rec/$action',
  `the recorder action must resolve to its index-less leaf (got "${batch4Transport.recorder.address}")`);
assert.equal(batch4Transport.recorder.stepAddress, '/rec/$action',
  `the step record must carry the index-less recorder address (got "${batch4Transport.recorder.stepAddress}")`);
assert.equal(batch4Transport.player.address, '/play/$action',
  `the player action must resolve without an id segment even with 9 in the field (got "${batch4Transport.player.address}")`);
assert.equal(batch4Transport.layer.address, '/$ctl/layer/C/sel',
  `layer id 2 must resolve to the centre surface's own node (got "${batch4Transport.layer.address}")`);
assert.equal(batch4Transport.layer.stepAddress, '/$ctl/layer/C/sel',
  `the step record must carry the resolved layer letter (got "${batch4Transport.layer.stepAddress}")`);
assert.equal(batch4Transport.layer.readout, 'Fader Layer C',
  `the id field must name the surface the number addresses (got "${batch4Transport.layer.readout}")`);
assert.equal(batch4Transport.eighth.invalid, true, 'layer id 8 must be refused: the node has seven entries');
assert.match(batch4Transport.eighth.problem, /layer only has 7/,
  `the refusal must say how many surfaces the category has (got "${batch4Transport.eighth.problem}")`);
assert.doesNotMatch(batch4Transport.eighth.address, /layer\/8/,
  `no address may be invented for an eighth layer (got "${batch4Transport.eighth.address}")`);
assert.deepEqual(batch4Transport.stat.keys, ['selected_strip', 'selected_page'],
  `the desk status must offer its two read-only keys (got ${JSON.stringify(batch4Transport.stat.keys)})`);
assert.ok(String(batch4Transport.stat.ids).trim().length > 0,
  `the index-less status must seed the trigger ids, or the backend refuses it as unconfigured (got "${batch4Transport.stat.ids}")`);
assert.equal(batch4Transport.stat.preview, '/$ctl/$stat/selidx',
  `the status trigger must preview the backend's own address (got "${batch4Transport.stat.preview}")`);
assert.equal(batch4Transport.dialog, '',
  `nothing may refuse the save of a valid layer step (got "${batch4Transport.dialog}")`);
assert.equal(batch4Transport.saved.address, '/$ctl/layer/C/sel',
  `the saved step must keep the resolved layer address (got "${batch4Transport.saved.address}")`);
assert.equal(batch4Transport.saved.value, '7',
  `the saved step must keep the layer that was typed (got "${batch4Transport.saved.value}")`);
console.log('16. USB transport, fader layers and desk status:', JSON.stringify({
  recorder: batch4Transport.recorder.address,
  player: batch4Transport.player.address,
  layer: [batch4Transport.layer.readout, batch4Transport.layer.address, batch4Transport.saved.address],
  stat: [batch4Transport.stat.keys, batch4Transport.stat.preview],
}));
await closeDialogIfOpen();

// --- 17. The desk level: monitor buses, safes, AES50, W-Live and the clock ------------------------
// Maillot `/cfg/mon/<n>/*` (1314-1378), `/$ctl/safes/*` (4016-4067), `/$stat/<A|B|C>/*` (1253-1272),
// `/$stat/{lock,ppm}` (1274-1275), `/cards/wlive/<n>/*` (2966-2991), `/cards/$type` (2951) and
// `/$globals/clkrate` (4171). Three address shapes the editor must not build itself: the monitor bus
// and the card keep their number, the AES50 port is a **letter** (1 = A … 3 = C), and the six desk
// nodes are index-less, so a safe typed with 9 in the ids field still resolves to `/$ctl/safes/ch`.
// The safes are strings, so the step value must survive as typed — `+` and spaces and all — and the
// two watch-only nodes must never appear as step destinations.
const batch6Desk = await evaluate(`(async () => {
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 350));
  const keysOf = (id) => [...document.getElementById(id).querySelectorAll('option')]
    .filter((option) => option.value)
    .map((option) => option.value);
  const readStep = () => ({
    parameter: document.getElementById('target-parameter').value,
    ids: document.getElementById('target-ids').value,
    address: document.getElementById('osc-address').value,
    stepAddress: (readConfigFromUi().actionSteps[selectedStepIndex] || {}).actionAddress,
    value: document.getElementById('osc-value').value,
  });
  const lists = { target: keysOf('target-category'), trigger: keysOf('trigger-category'), condition: keysOf('condition-category') };
  // The monitor bus: the id selects the bus and the leaf follows it.
  set('target-category', 'monbus');
  await settle();
  set('target-ids', '2');
  set('target-parameter', 'monitor_pan');
  await settle();
  set('osc-value', '-25');
  await settle();
  const monitor = readStep();
  // The safe: a run of + and space, written as typed, and no id in the address whatever the field holds.
  set('target-category', 'safes');
  await settle();
  set('target-ids', '9');
  set('target-parameter', 'safes_ch');
  await settle();
  const safeValue = '+'.repeat(3) + ' '.repeat(2) + '+'.repeat(35);
  set('osc-value', safeValue);
  await settle();
  const safe = readStep();
  // The AES50 port: the id becomes the letter.
  set('target-category', 'aes50');
  await settle();
  set('target-ids', '3');
  set('target-parameter', 'aes50_clear_errors');
  await settle();
  set('osc-value-options', '1');
  await settle();
  const aes50Step = { ...readStep(), readout: document.getElementById('target-ids-destination').textContent };
  // …and a fourth port names no port at all.
  set('target-ids', '4');
  await settle();
  const aes50Fourth = {
    invalid: document.getElementById('target-ids').classList.contains('is-invalid'),
    problem: document.getElementById('target-ids-problem')?.textContent || '',
    address: document.getElementById('osc-address').value,
  };
  // The W-Live card keeps its number, and the leaf is two segments below the node.
  set('target-ids', '2');
  set('target-category', 'wlive');
  await settle();
  set('target-ids', '2');
  set('target-parameter', 'wlive_control');
  await settle();
  set('osc-value-options', 'REC');
  await settle();
  const wlive = readStep();
  // The global clock: index-less like the safe.
  set('target-category', 'globals');
  await settle();
  set('target-ids', '1');
  set('target-parameter', 'global_clock_rate');
  await settle();
  set('osc-value-options', '44100.0');
  await settle();
  const globals = readStep();
  // The two watch-only nodes: the AES50 link, the card identity and the clock ppm.
  set('trigger-category', 'aes50');
  await settle();
  set('trigger-ids', '2');
  set('trigger-parameter', 'aes50_state');
  await settle();
  set('trigger-operator', '==');
  set('trigger-options', 'ERR');
  await settle();
  const aes50Watch = {
    address: document.getElementById('trigger-path-preview').textContent,
    readout: document.getElementById('trigger-ids-destination').textContent,
  };
  set('trigger-category', 'cards');
  await settle();
  set('trigger-parameter', 'cards_type');
  await settle();
  set('trigger-options', 'WLIVE');
  await settle();
  const cardsWatch = document.getElementById('trigger-path-preview').textContent;
  set('trigger-category', 'deskstatus');
  await settle();
  set('trigger-parameter', 'desk_ppm');
  await settle();
  set('trigger-operator', '<');
  set('threshold', '-100');
  await settle();
  const ppmWatch = document.getElementById('trigger-path-preview').textContent;
  // Put the watch panel back on a saveable trigger before saving the safe step.
  set('trigger-category', 'usb');
  await settle();
  set('trigger-ids', '1');
  set('trigger-parameter', 'meter');
  set('trigger-operator', '>');
  set('threshold', '-18');
  await settle();
  // Save the safe step and read what the library kept: the string, verbatim. The id goes back to 1
  // first: the resolver ignores it on an index-less node, but the field rule still refuses a number
  // the category does not have, and this check is about the value rather than about that refusal.
  set('target-category', 'safes');
  await settle();
  set('target-ids', '1');
  set('target-parameter', 'safes_ch');
  await settle();
  set('osc-value', safeValue);
  await settle();
  document.getElementById('library-save-current').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const macro = (window.__SAVED_LIBRARY?.macros || [])[window.__SAVED_LIBRARY?.selectedIndex || 0] || {};
  const saved = (macro.actionSteps || []).find((step) => step.targetParameter === 'safes_ch') || {};
  const dialog = document.getElementById('win95-confirm');
  return {
    lists, monitor, safe, aes50Step, aes50Fourth, wlive, globals, aes50Watch, cardsWatch, ppmWatch,
    safeValue,
    saved: { address: saved.actionAddress, value: saved.actionValue },
    dialog: dialog && getComputedStyle(dialog).display !== 'none'
      ? document.getElementById('win95-confirm-message')?.textContent || ''
      : '',
  };
})()`);
for (const written of ['lights', 'safes', 'monbus', 'solocfg', 'aes50', 'wlive', 'globals']) {
  assert.ok(batch6Desk.lists.target.includes(written),
    `${written} is written, so it must be a step destination (got ${JSON.stringify(batch6Desk.lists.target)})`);
}
for (const watchOnly of ['deskstatus', 'cards']) {
  assert.ok(!batch6Desk.lists.target.includes(watchOnly),
    `${watchOnly} is read-only and must not be a step destination (got ${JSON.stringify(batch6Desk.lists.target)})`);
  assert.ok(batch6Desk.lists.trigger.includes(watchOnly) && batch6Desk.lists.condition.includes(watchOnly),
    `${watchOnly} must be a trigger and an IF gate (got ${JSON.stringify(batch6Desk.lists)})`);
}
assert.equal(batch6Desk.monitor.address, '/cfg/mon/2/pan',
  `monitor bus 2's pan must carry the bus number (got "${batch6Desk.monitor.address}")`);
assert.equal(batch6Desk.monitor.stepAddress, '/cfg/mon/2/pan',
  `the step record must carry the resolved monitor address (got "${batch6Desk.monitor.stepAddress}")`);
assert.equal(batch6Desk.safe.address, '/$ctl/safes/ch',
  `a safe must resolve without an id segment even with 9 in the field (got "${batch6Desk.safe.address}")`);
assert.equal(batch6Desk.safe.stepAddress, '/$ctl/safes/ch',
  `the step record must carry the index-less safe address (got "${batch6Desk.safe.stepAddress}")`);
assert.equal(batch6Desk.safe.value, batch6Desk.safeValue,
  `the safe string must survive as typed, + and spaces included (got ${JSON.stringify(batch6Desk.safe.value)})`);
assert.equal(batch6Desk.saved.value, batch6Desk.safeValue,
  `the saved step must keep the safe string verbatim (got ${JSON.stringify(batch6Desk.saved.value)}; dialog ${JSON.stringify(batch6Desk.dialog)})`);
assert.equal(batch6Desk.aes50Step.address, '/$stat/C/clrerr',
  `AES50 id 3 must resolve to port C (got "${batch6Desk.aes50Step.address}")`);
assert.equal(batch6Desk.aes50Step.readout, 'AES50 Port C',
  `the id field must name the port the number addresses (got "${batch6Desk.aes50Step.readout}")`);
assert.equal(batch6Desk.aes50Fourth.invalid, true, 'a fourth AES50 port must be refused: the node has three');
assert.match(batch6Desk.aes50Fourth.problem, /aes50 only has 3/,
  `the refusal must say how many ports the category has (got "${batch6Desk.aes50Fourth.problem}")`);
assert.doesNotMatch(batch6Desk.aes50Fourth.address, /stat\/[4D]\//,
  `no address may be invented for a fourth port (got "${batch6Desk.aes50Fourth.address}")`);
assert.equal(batch6Desk.wlive.address, '/cards/wlive/2/$ctl/control',
  `the W-Live control must resolve below the card's own number (got "${batch6Desk.wlive.address}")`);
assert.equal(batch6Desk.wlive.stepAddress, '/cards/wlive/2/$ctl/control',
  `the step record must carry the resolved card address (got "${batch6Desk.wlive.stepAddress}")`);
assert.equal(batch6Desk.globals.address, '/$globals/clkrate',
  `the clock rate must resolve to its index-less leaf (got "${batch6Desk.globals.address}")`);
assert.equal(batch6Desk.aes50Watch.address, '/$stat/B/stat',
  `the AES50 watch must resolve to port B's state (got "${batch6Desk.aes50Watch.address}")`);
assert.equal(batch6Desk.aes50Watch.readout, 'AES50 Port B',
  `the watch panel must name the port too (got "${batch6Desk.aes50Watch.readout}")`);
assert.equal(batch6Desk.cardsWatch, '/cards/$type',
  `the card type watch must resolve to its index-less leaf (got "${batch6Desk.cardsWatch}")`);
assert.equal(batch6Desk.ppmWatch, '/$stat/ppm',
  `the clock ppm watch must resolve to its index-less leaf (got "${batch6Desk.ppmWatch}")`);
assert.equal(batch6Desk.dialog, '',
  `nothing may refuse the save of a valid safe step (got "${batch6Desk.dialog}")`);
assert.equal(batch6Desk.saved.address, '/$ctl/safes/ch',
  `the saved step must keep the resolved safe address (got "${batch6Desk.saved.address}")`);
console.log('17. desk level:', JSON.stringify({
  lists: { target: batch6Desk.lists.target.length, watch: batch6Desk.lists.trigger.length },
  monitor: batch6Desk.monitor.address,
  safe: [batch6Desk.saved.address, batch6Desk.safeValue.length],
  aes50: [batch6Desk.aes50Step.readout, batch6Desk.aes50Step.address, batch6Desk.aes50Watch.address],
  wlive: batch6Desk.wlive.address,
  globals: batch6Desk.globals.address,
  watches: [batch6Desk.cardsWatch, batch6Desk.ppmWatch],
}));
await closeDialogIfOpen();

// --- 24. The catalogue follows the model the desk announces --------------------------------------
// The catalogue is model-aware: how many entries a family has and whether a model-restricted leaf takes
// a write at all (`monitor_level`, Maillot footnote 13) come from the model in the discovery reply. The
// window reads it once at start-up, before any desk has named itself, so a reply has to make it ask
// again — otherwise the picker keeps describing a desk that was never in front of the operator.
const catalogueRefresh = await evaluate(`(async () => {
  const seen = () => (window.__INVOKES || []).filter((entry) => entry.cmd === 'target_catalog');
  const before = seen().length;
  document.getElementById('discover').click();
  await new Promise((resolve) => setTimeout(resolve, 800));
  const calls = seen();
  return { added: calls.length - before, deskModel: calls.length ? (calls[calls.length - 1].args || {}).deskModel || '' : '' };
})()`);
assert.ok(catalogueRefresh.added >= 1,
  `a discovery reply must re-read the model-aware catalogue (got ${JSON.stringify(catalogueRefresh)})`);
assert.equal(catalogueRefresh.deskModel, 'WING-RACK',
  `the model the desk announced must travel with the request (got ${JSON.stringify(catalogueRefresh)})`);
console.log('24. the catalogue is re-read for the announced model:', JSON.stringify(catalogueRefresh));

// --- 25. A WING Rack is not offered the monitor level write -------------------------------------
// Footnote 13 grants `$lvl` to a surface with no monitor level potentiometer, but the Rack was
// measured to ignore **every** write form, so the backend withholds it there and on the full-size
// console; only the Compact keeps it. The window must not offer the step when the desk in front of
// the operator is a Rack — the write would be silently ignored while the macro reported success.
const rackMonitorLevel = await evaluate(`(async () => {
  // Check 24 announced a Rack, which makes the window ask for the model-aware catalogue. What the
  // stub answers here is the real backend's answer for that desk, hand-written from
  // \`target_catalog\`'s own rule: the level is a watch on every model and a step on the Compact
  // alone (crates/wing-core \`monitor_level_is_writable\`, measured on a Rack 2026-09-27).
  window.__RACK_CATALOGUE = true;
  await refreshTargetCatalogForDesk('WING-RACK');
  const set = (id, value) => {
    const field = document.getElementById(id);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('target-category', 'monbus');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const stepKeys = [...document.getElementById('target-parameter').options].filter((option) => option.value).map((option) => option.value);
  set('trigger-category', 'monbus');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const watchKeys = [...document.getElementById('trigger-parameter').options].filter((option) => option.value).map((option) => option.value);
  const requested = (window.__INVOKES || []).filter((entry) => entry.cmd === 'target_catalog').slice(-1)[0];
  return { stepKeys, watchKeys, deskModel: (requested?.args || {}).deskModel || '' };
})()`);
assert.equal(rackMonitorLevel.deskModel, 'WING-RACK',
  `the model must travel with the catalogue request (got ${JSON.stringify(rackMonitorLevel.deskModel)})`);
assert.ok(!rackMonitorLevel.stepKeys.includes('monitor_level'),
  `a WING Rack must not be offered the monitor level as a step: it was measured to ignore the write (got ${JSON.stringify(rackMonitorLevel.stepKeys)})`);
assert.ok(rackMonitorLevel.watchKeys.includes('monitor_level'),
  `the level is still a watch on a Rack: the console reports it (got ${JSON.stringify(rackMonitorLevel.watchKeys)})`);
console.log('25. the Rack is not offered the monitor level write:', JSON.stringify({ step: rackMonitorLevel.stepKeys.includes('monitor_level'), watch: rackMonitorLevel.watchKeys.includes('monitor_level') }));


console.log('ALL BROWSER CHECKS PASSED');
// --- A MIDI step's target is its message, not an address -------------------
//
// Phase B's sending step, from the editor's side: the mode offers it, its fields appear only for it, what the
// editor saves is the message the backend validates, and the row says what will be sent. The dangerous failure
// this guards against is an editor that saves a step with no message — the step then vanishes in the compile
// path, which is exactly what happened three times while building it.
const midiStep = await evaluate(`(() => {
  const mode = document.getElementById('action-mode');
  const list = () => document.getElementById('action-steps-list').textContent;
  mode.value = 'midi_send';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  const panelForMidi = document.getElementById('midi-action-fields').classList.contains('visible');
  const valueHiddenForMidi = document.getElementById('value-field').classList.contains('hidden');
  document.getElementById('step-midi-kind').value = 'control_change';
  document.getElementById('step-midi-channel').value = '6';
  document.getElementById('step-midi-number').value = '20';
  document.getElementById('step-midi-value').value = '100';
  const saved = (readConfigFromUi().actionSteps || [])[0] || {};
  const rowText = list();
  mode.value = 'set';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  const panelForSet = document.getElementById('midi-action-fields').classList.contains('visible');
  return {
    panelForMidi,
    valueHiddenForMidi,
    panelForSet,
    midi: saved.midi || null,
    mode: saved.actionMode || '',
    rowText,
  };
})()`);
assert.equal(midiStep.panelForMidi, true, 'choosing the MIDI mode must show the message fields');
assert.equal(midiStep.valueHiddenForMidi, true, 'and hide the console value, which a MIDI step does not have');
assert.equal(midiStep.panelForSet, false, 'and hide them again for every other mode');
assert.equal(midiStep.mode, 'midi_send', `the saved step keeps its mode (got ${JSON.stringify(midiStep.mode)})`);
assert.deepEqual(midiStep.midi, { kind: 'control_change', channel: 6, number: 20, value: 100 },
  `the saved step must carry the message itself (got ${JSON.stringify(midiStep.midi)})`);
// The list is not redrawn on every keystroke, so the row still shows the values the fields had when it was
// drawn — what is asserted here is that the row *does* describe the message and names the mode in words, where
// it used to print the stored value (`midi_send`).
assert.match(midiStep.rowText, /MIDI (note on|control change)/,
  `the row must say what will be sent (got ${JSON.stringify(midiStep.rowText)})`);
assert.match(midiStep.rowText, /send MIDI/, `and name the mode in words (got ${JSON.stringify(midiStep.rowText)})`);
assert.doesNotMatch(midiStep.rowText, /midi_send/, `not in the contract's spelling (got ${JSON.stringify(midiStep.rowText)})`);

// --- An OSC step carries a message, its destination and its arguments --------------
//
// The same shape as the MIDI step, with the part the test send does not have: **arguments**, each with its own
// type, so nothing is parsed from text. The failing case this guards is an editor that saves the address but loses
// the arguments, which would send a message that means something else.
const oscStep = await evaluate(`(() => {
  const mode = document.getElementById('action-mode');
  mode.value = 'osc_send';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  const panelVisible = document.getElementById('osc-action-fields').classList.contains('visible');
  const valueHidden = document.getElementById('value-field').classList.contains('hidden');
  document.getElementById('step-osc-host').value = '127.0.0.1';
  document.getElementById('step-osc-port').value = '53000';
  document.getElementById('step-osc-address').value = '/cue/selected/start';
  document.getElementById('step-osc-add-arg').click();
  const row = document.querySelector('#step-osc-args .osc-arg-row');
  const type = row.querySelector('select');
  type.value = 'str';
  type.dispatchEvent(new Event('change', { bubbles: true }));
  const valueInput = document.querySelector('#step-osc-args .osc-arg-row input');
  valueInput.value = 'cue';
  valueInput.dispatchEvent(new Event('change', { bubbles: true }));
  const saved = (readConfigFromUi().actionSteps || [])[0] || {};
  const rowText = document.getElementById('action-steps-list').textContent;
  const rows = document.querySelectorAll('#step-osc-args .osc-arg-row').length;
  mode.value = 'set';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  const panelAfter = document.getElementById('osc-action-fields').classList.contains('visible');
  return { panelVisible, valueHidden, panelAfter, rows, osc: saved.osc || null, mode: saved.actionMode || '', rowText };
})()`);
assert.equal(oscStep.panelVisible, true, 'choosing the OSC mode must show its fields');
assert.equal(oscStep.valueHidden, true, 'and hide the console value');
assert.equal(oscStep.panelAfter, false, 'and hide them again for every other mode');
assert.equal(oscStep.rows, 1, 'adding an argument must add a row');
assert.equal(oscStep.mode, 'osc_send', `the saved step keeps its mode (got ${JSON.stringify(oscStep.mode)})`);
assert.deepEqual(oscStep.osc, {
  host: '127.0.0.1',
  port: 53000,
  address: '/cue/selected/start',
  args: [{ type: 'str', value: 'cue' }],
}, `the saved step must carry the message and its arguments (got ${JSON.stringify(oscStep.osc)})`);
// As with the MIDI step: the list is not redrawn on every keystroke, so the row shows the values it had when it was
// drawn — here "(no address)", honestly, rather than a value typed a moment later.
assert.match(oscStep.rowText, /OSC (\(no address\)|\/cue\/selected\/start)/,
  `the row must say what will be sent (got ${JSON.stringify(oscStep.rowText)})`);
assert.match(oscStep.rowText, /send OSC/, `and name the mode in words (got ${JSON.stringify(oscStep.rowText)})`);

// --- 26. A target over a range of channels reaches the backend as a range -------------------------
//
// The owner's report: a target over channels 9-12 muted channel 9 alone. The window keeps a single
// `#osc-address` box and paints the first channel into it, which is fine — what the backend compiles
// from is the step's selector (`targetIds: "9-12"`), and the stub now expands a range the way
// `wing_core::targets::parse_ids` does. So the contract is: the window resolves the whole range, the
// preview promises four targets, the step that would reach the backend still carries the range, and
// the selector means four addresses and not one. A window that narrows the range to the channel it
// painted shows four and writes one, and this fails.
const rangeTarget = await evaluate(`(async () => {
  const category = document.getElementById('target-category');
  category.value = 'ch';
  category.dispatchEvent(new Event('change', { bubbles: true }));
  const parameter = document.getElementById('target-parameter');
  parameter.value = 'mute';
  parameter.dispatchEvent(new Event('change', { bubbles: true }));
  const ids = document.getElementById('target-ids');
  ids.value = '9-12';
  ids.dispatchEvent(new Event('input', { bubbles: true }));
  ids.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const step = (readConfigFromUi().actionSteps || [])[0] || {};
  // What the backend's resolver answers for the selector the step carries, through the same stub.
  const resolved = await window.__TAURI__.core.invoke('resolve_basic_target', {
    request: {
      category: step.targetCategory, ids: step.targetIds, parameter: step.targetParameter,
      sendId: step.sendId, customAddress: step.actionAddress,
    },
  });
  return {
    fieldIds: ids.value,
    box: document.getElementById('osc-address').value,
    previewCount: document.getElementById('target-path-count').textContent,
    previewText: document.getElementById('target-path-preview').textContent,
    stepSelector: step.targetIds || '',
    stepAddress: step.actionAddress || '',
    addresses: resolved.addresses,
  };
})()`);
assert.equal(rangeTarget.fieldIds, '9-12', 'the field must keep the range the operator typed');
assert.equal(
  rangeTarget.stepSelector, '9-12',
  `the step that reaches the backend must carry the range, not the channel the box shows (got ${JSON.stringify(rangeTarget.stepSelector)})`,
);
assert.equal(
  rangeTarget.previewCount, '4 targets',
  `the preview must promise the four channels the selector means (got ${JSON.stringify(rangeTarget.previewCount)})`,
);
assert.deepEqual(
  rangeTarget.addresses,
  ['/ch/9/mute', '/ch/10/mute', '/ch/11/mute', '/ch/12/mute'],
  `a range must resolve to one address per channel (got ${JSON.stringify(rangeTarget.addresses)})`,
);
assert.equal(
  rangeTarget.box, '/ch/9/mute',
  'the single box still names the first channel; the whole list travels in the selector, not the box',
);
console.log('26. A range target is carried whole:', JSON.stringify(rangeTarget));

// The tab and its socket are the harness's, and closing them is its job: a browser that wedged
// (docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md) would leave the close request unanswered and the process alive after the
// checks have passed, and the harness's `--max-time` curl is what makes the run end.
closeTab();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
