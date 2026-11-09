import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const INDEX_URL = new URL('../desktop/ui/index.html', import.meta.url).href;
// Tab of its own: the browser tests share the port and the profile, and attaching to "the first
// index.html tab" let an old tab (from a test that died before closing its own) decide the state
// this test saw — that is how it failed once inside the gate.
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
  if (result.exceptionDetails) {
    // `text` is just "Uncaught" for a TypeError inside the page; the description carries the message and
    // the page-side stack. A test that fails with "Uncaught" and nothing else tells nobody anything.
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`page threw: ${description}`);
  }
  // Switching macros asks before discarding unsaved work through the app's own Win95 dialog (the
  // native confirm() returns false in the packaged app). The automated run answers "Discard" the way
  // an operator would, instead of leaving the dialog blocking the next assertion.
  await call('Runtime.evaluate', {
    expression: `(() => {
      const dialog = document.getElementById('win95-confirm');
      if (dialog && getComputedStyle(dialog).display !== 'none') {
        document.getElementById('win95-confirm-accept').click();
        return true;
      }
      return false;
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

// A bounded wait for the fact a step is about, in place of a fixed count of tries that measures the
// clock and then reads whatever the page happens to be: `expression` returns `{ ok: true, ... }` once
// the fact holds, and the caller names the property and prints the page it saw if it never did.
async function waitFor(expression, { tries = 30, every = 100 } = {}) {
  let state = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    state = await evaluate(expression);
    if (state?.ok) return state;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  return state;
}

try {
  // The tab is new: the window has to be loaded before it is touched (the test used to attach to a
  // tab the gate had already loaded).
  await call('Page.enable');
  // The app asks through its own Win95 dialog (the helper above accepts it), so a permissive confirm()
  // stub is kept as well, and `__wingTestDocument` is a token the stub writes into every document this
  // tab creates. The token is what the reload waits below are keyed to, because `document.readyState`
  // alone is answered by the *outgoing* document for a moment after `Page.reload`: the outgoing window is
  // loaded and carries its macro rows, so every condition those waits could check is already true in the
  // window that is being replaced. The token idiom is the one
  // `test-desktop-meter-bank-selector-browser.mjs` documents.
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__wingTestDocument = String(Date.now()) + ':' + Math.random(); window.confirm = () => true;`,
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await call('Runtime.evaluate', {
      expression: 'document.readyState === "complete" && Boolean(document.querySelector(".macro-rename-button"))',
      returnByValue: true,
    });
    if (ready.result?.value === true) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await evaluate('localStorage.removeItem("wing_mock_macro_library")');
  const outgoingDocument = await evaluate('String(window.__wingTestDocument || "")');
  await call('Page.reload', { ignoreCache: true });
  // The reload is waited for by the document it produces, not by `document.readyState` alone.
  const reloaded = await waitFor(`(() => {
    const token = String(window.__wingTestDocument || "");
    return {
      ok: document.readyState === "complete" && token !== "" && token !== ${JSON.stringify(outgoingDocument)}
        && Boolean(document.querySelector(".macro-rename-button")),
      token, href: location.href, ready: document.readyState,
      rows: document.querySelectorAll(".macro-row").length,
    };
  })()`, { tries: 60 });
  assert.ok(reloaded.ok, `the reloaded macro window must be the one under test (page: ${JSON.stringify(reloaded)})`);
  const position = await evaluate(`(() => {
    const input = document.getElementById('macro-name');
    input.scrollIntoView({ block: 'center' });
    const rect = input.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
      hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id || '' };
  })()`);
  assert.equal(position.hit, 'macro-name', 'name field must receive pointer events');
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y, button: 'left', clickCount: 1 });
  assert.equal(await evaluate('document.activeElement?.id'), 'macro-name', 'name field must focus on click');
  // The window claims the focus back one frame after a real pointer release: the pointerup handler on a
  // typeable field queues `requestAnimationFrame(() => claimFieldFocus(field))`
  // (desktop/ui/field-editing.js, the one home of the caret rule since 2026-10-09; it was
  // desktop/ui/index.html:17032 before that, guarded since this was measured), and `claimFieldFocus`
  // focuses the field again because the platform can revoke the page focus a moment after the click
  // (measured in WKWebView). Clicking Rename inside that same frame — which no operator can do, but this
  // test did —
  // let that deferred claim land after the inline editor was open: the claim focused the name field, the
  // editor's blur handler removed it (desktop/ui/index.html:15307), and the wait below then spent its
  // five seconds looking for a node the window itself had thrown away (reproduced: 2 runs in 120 with the
  // stack `input.remove ← index.html:15307 ← claimFieldFocus`, the frame the click queued; the gate
  // logged FAIL (6s)). This waits for the frame the click queued — the app's own callback, in
  // registration order, with a bounded fallback — so the rename is what is under test and not the
  // window's focus recovery.
  await evaluate(`new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(true); } };
    requestAnimationFrame(finish);
    setTimeout(finish, 500);
  })`);
  const before = await evaluate('document.getElementById("macro-name").value');
  await call('Input.insertText', { text: 'X' });
  const after = await evaluate('document.getElementById("macro-name").value');
  assert.notEqual(after, before, 'typing must change the name field');
  await evaluate(`(() => { const input = document.getElementById('macro-name'); input.value = ${JSON.stringify(before)}; input.blur(); })()`);
  // There was a wait here for "the row to show the name the field just wrote", on the theory that blurring
  // the name field repaints the row and the Rename click was racing that repaint. The theory does not hold
  // for this path: the field was put back to the name the macro already has, so the field's own change
  // handler returns before saving anything and no repaint follows — the wait was satisfied on its first
  // read and never protected the click. What protects it is the frame wait above (the window's own
  // deferred focus claim) and the click that is repeated below if the list replaces the row.

  const renamePosition = await evaluate(`(() => {
    const button = document.querySelector('.macro-row.selected .macro-rename-button');
    // With no selected row there is no button: this used to blow up with a TypeError that looked
    // like a code fault. If it happens, the tab it attached to is not this test's (empty library).
    if (!button) return { error: 'no selected macro row in this tab' };
    button.scrollIntoView({ block: 'center' });
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
      hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.className || '' };
  })()`);
  assert.ok(!renamePosition.error, renamePosition.error || '');
  assert.match(renamePosition.hit, /macro-rename-button/);
  // The button is really the thing under its own centre (asserted above), and then it is *clicked
  // through the page*: synthesising a mouse press at measured coordinates against a row that repaints
  // (the name field's save is still landing) made this test fail one run in five, with the click simply
  // landing where the button no longer was. That was a fact about synthetic input, not about the
  // rename, and it hid the real defect it eventually helped find — a repaint closing the open editor
  // (fixed in index.html by deferring rebuilds while a rename is in flight). What this test is for is
  // the flow, so it drives the flow.
  // A click can still be lost in the few milliseconds in which the list replaces that row (measured:
  // one run in five, with no editor in the DOM and the focus back in the name field). The rename itself
  // is what is under test, so the click is repeated while the row settles, and the number of attempts is
  // printed: if this ever becomes the common case, the log says so instead of the test going red.
  let focused = false;
  let attempts = 0;
  for (; attempts < 4 && !focused; attempts += 1) {
    const clicked = await evaluate(`(() => {
      const button = document.querySelector('.macro-row.selected .macro-rename-button');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.ok(clicked, 'the selected row must still have its Rename button');
    for (let wait = 0; wait < 12 && !focused; wait += 1) {
      focused = (await evaluate('document.activeElement?.className')) === 'macro-inline-name';
      if (!focused) await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (attempts > 1) console.log(`  Rename needed ${attempts} clicks (the list was replacing the row)`);
  if (!focused) {
    // Say what the page looked like instead of only that focus was elsewhere: an editor left in the DOM
    // by an earlier interaction, a row that is no longer connected, or no selected row at all are three
    // different faults and the message has to tell them apart.
    const diagnosis = await evaluate(`(() => ({
      editors: document.querySelectorAll('.macro-inline-name').length,
      selectedRows: document.querySelectorAll('.macro-row.selected').length,
      rowConnected: Boolean(document.querySelector('.macro-row.selected')?.isConnected),
      active: document.activeElement?.className || document.activeElement?.tagName || '',
    }))()`);
    assert.fail(`the inline editor must take focus when Rename is clicked (page: ${JSON.stringify(diagnosis)})`);
  }
  const renamed = `Browser rename ${Date.now()}`;
  // The editor the click created is kept as the node itself, not re-found by selector: the property is
  // that *this* editor stays open to be typed into, and "some .macro-inline-name exists" cannot tell the
  // editor the operator opened from one a rebuild put there instead — which is what made the old wait
  // unable to fail for the right reason. The wait is bounded and prints the page it saw when it fails.
  await evaluate('window.__wingRenameEditor = document.querySelector(".macro-inline-name")');
  const editor = await waitFor(`(() => {
    const node = window.__wingRenameEditor;
    const current = document.querySelector(".macro-inline-name");
    return {
      ok: Boolean(node) && node.isConnected && current === node,
      sameNode: Boolean(node) && current === node,
      connected: Boolean(node) && node.isConnected,
      focus: document.activeElement?.className || document.activeElement?.tagName || "",
      editors: document.querySelectorAll(".macro-inline-name").length,
    };
  })()`, { tries: 50 });
  assert.ok(editor.ok, `the inline rename editor must stay open to be typed into (page: ${JSON.stringify(editor)})`);
  // Typed into the node the click created: if a repaint replaced it, this says so instead of typing into
  // the replacement and calling that a rename.
  const typed = await evaluate(`(() => {
    const input = window.__wingRenameEditor;
    if (!input || !input.isConnected || document.querySelector('.macro-inline-name') !== input) return false;
    input.value = ${JSON.stringify(renamed)};
    input.blur();
    return true;
  })()`);
  assert.ok(typed, 'the inline rename editor must be open to be typed into');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await evaluate(`document.querySelector('.macro-row.selected .step-title')?.textContent === ${JSON.stringify(renamed)}`)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate('document.querySelector(".macro-row.selected .step-title")?.textContent'), renamed);
  assert.equal(await evaluate('document.getElementById("macro-name").value'), renamed);
  const originalIds = await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].triggerIds');
  const fieldName = `Browser field rename ${Date.now()}`;
  await evaluate(`(() => {
    const input = document.getElementById('macro-name');
    input.value = ${JSON.stringify(fieldName)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await evaluate(`document.querySelector('.macro-row.selected .step-title')?.textContent === ${JSON.stringify(fieldName)}`)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate('document.querySelector(".macro-row.selected .step-title")?.textContent'), fieldName);
  assert.equal(await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].triggerIds'), originalIds);
  await evaluate(`(() => {
    const button = document.querySelector('.macro-row.selected .macro-rename-button');
    button.click();
    const input = document.querySelector('.macro-inline-name');
    input.value = 'Cancelled rename';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  })()`);
  assert.equal(await evaluate('document.querySelector(".macro-row.selected .step-title")?.textContent'), fieldName);
  await evaluate(`(() => {
    const input = document.getElementById('trigger-ids');
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('library-save-current').click();
  })()`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].triggerIds === "4"')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].triggerIds'), '4');
  await evaluate(`(() => {
    document.querySelectorAll('.macro-select-button')[1].click();
    document.querySelectorAll('.macro-select-button')[0].click();
  })()`);
  // Selecting a macro may ask before discarding unsaved work, so the handler is async: let it finish.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await evaluate('document.getElementById("trigger-ids").value'), '4');
  await evaluate(`(() => {
    document.getElementById('add-condition').click();
    const enabled = document.getElementById('condition-enabled');
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('library-save-current').click();
  })()`);
  assert.equal(await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].conditions.length'), 1,
    'disabled IF rules must survive saving');
  assert.equal(await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].conditions[0].enabled'), false);
  await evaluate(`(() => {
    document.querySelectorAll('.macro-select-button')[1].click();
    document.querySelectorAll('.macro-select-button')[0].click();
  })()`);
  // Selecting a macro may ask before discarding unsaved work, so the handler is async: let it finish.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await evaluate('document.querySelectorAll("#condition-list .step-row").length'), 1,
    'disabled IF rules must survive reopening');
  const savedStepCount = await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].actionSteps.length');
  await evaluate('document.getElementById("add-delay-step").click()');
  assert.equal(await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].actionSteps.length'), savedStepCount,
    'unsaved timeline edits must not mutate the saved macro');
  await evaluate('document.querySelector(".macro-row.selected .macro-notice-btn").click()');
  assert.equal(await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].actionSteps.length'), savedStepCount,
    'saving a library toggle must not persist an unsaved timeline edit');
  await evaluate(`(() => {
    document.querySelectorAll('.macro-select-button')[1].click();
    document.querySelectorAll('.macro-select-button')[0].click();
  })()`);
  // Selecting a macro may ask before discarding unsaved work, so the handler is async: let it finish.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await evaluate('document.querySelectorAll("#action-steps-list .step-row").length'), savedStepCount,
    'reopening a saved macro must discard unsaved timeline edits');
  await evaluate(`(() => {
    const enabled = document.getElementById('step-enabled');
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  assert.equal(await evaluate('readConfigFromUi().actionSteps[0].enabled'), false,
    'selected action enabled state must be editable');
  assert.equal(await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].actionSteps[0].enabled !== false'), true,
    'editing action enabled state must not change saved data before Save Draft');
  assert.equal(await evaluate(`(() => {
    const original = macroLibrary.macros[0].enabled;
    applyConfig({ ...macroLibrary.macros[0], enabled: !original });
    return macroLibrary.macros[0].enabled === original;
  })()`), true, 'loading a draft must not change library enable state');
  await evaluate('document.getElementById("library-new").click()');
  assert.equal(await evaluate('macroLibrary.macros[macroLibrary.selectedIndex].enabled'), false,
    'new macros must start disabled');
  // 1.2.19: a new macro starts unconfigured instead of pretending to be `usb 1 meter`.
  assert.equal(await evaluate('readConfigFromUi().triggerCategory'), '',
    'new macros must start with an unconfigured trigger');
  assert.equal(await evaluate('readConfigFromUi().triggerParameter'), '',
    'new macros must start with an unconfigured trigger parameter');
  assert.equal(await evaluate('document.getElementById("threshold").value'), '-18',
    'new macros must start with a useful audio threshold');
  assert.equal(await evaluate('actionSteps.length'), 1, 'New must start with one blank step to configure');
  assert.equal(await evaluate('readConfigFromUi().actionSteps[0].actionAddress'), '',
    'the blank step must not carry an invented /ch/1/mute command');
  await evaluate(`(() => {
    const category = document.getElementById('trigger-category');
    category.value = 'usb';
    category.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  assert.deepEqual(await evaluate('[...document.getElementById("trigger-operator").options].map((o) => o.value)'), ['>', '<'],
    'meter triggers must expose only supported crossing operators');
  await evaluate(`(() => {
    document.querySelector('.btn-open-matrix[data-target-input="trigger-ids"]').click();
    // The categories are a vertical sidebar now; switch family and click the category itself.
    document.querySelector('.matrix-family-btn[data-family="mix"]').click();
    document.querySelector('#matrix-category-bar .matrix-cat-btn[data-cat="ch"]').click();
    const cell = document.querySelector('#matrix-grid-container .matrix-cell[data-id="3"]');
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11 }));
    document.getElementById('btn-apply-matrix').click();
  })()`);
  assert.equal(await evaluate('document.getElementById("trigger-category").value'), 'ch');
  assert.equal(await evaluate('document.getElementById("trigger-ids").value'), '3');
  await evaluate(`(() => {
    document.querySelector('.btn-open-matrix[data-target-input="trigger-ids"]').click();
    document.querySelector('.matrix-family-btn[data-family="sources"]').click();
    document.querySelector('#matrix-category-bar .matrix-cat-btn[data-cat="usb"]').click();
  })()`);
  assert.equal(await evaluate('selectedMatrixIds.size'), 0,
    'switching source family must not carry the old channel number');
  await evaluate('closeChannelMatrix()');
  await evaluate(`(() => {
    document.getElementById('add-condition').click();
    document.getElementById('condition-category').value = 'usb';
    document.getElementById('condition-ids').value = '7';
    document.getElementById('condition-parameter').value = 'meter';
    document.getElementById('condition-value').value = '-22';
    syncCurrentConditionFromFields();
    renderConditions();
    const row = document.querySelector('#condition-list .condition-row');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    document.getElementById('condition-ids').value = '99';
    [...document.querySelectorAll('#win95-context-menu .context-menu-item')]
      .find((item) => item.textContent.includes('Load Values into Gate Fields')).click();
  })()`);
  assert.equal(await evaluate('document.getElementById("condition-ids").value'), '7',
    'IF context menu must load current target schema fields');
  const oneStep = await evaluate('actionSteps.length');
  assert.equal(oneStep, 1);
  await evaluate(`(() => {
    const row = document.querySelector('#action-steps-list .action-step-item');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    [...document.querySelectorAll('#win95-context-menu .context-menu-item')]
      .find((item) => item.textContent.includes('Delete Step')).click();
  })()`);
  assert.equal(await evaluate('actionSteps.length'), 1, 'the last action cannot be deleted');

  // --- Firing the whole macro from its row ------------------------------------------------------
  // Asked for by the owner: Test Action proves one step, and what has to be trusted before a show is the
  // whole list, so the row's own menu offers it. (That clicking it reaches the backend is asserted in the
  // action-target suite, which is the one that collects invocations.)
  const menuItems = await evaluate(`(async () => {
    const row = document.querySelector('#macro-library-list .macro-row');
    if (!row) return { error: 'no macro row' };
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    // A row's menu asks about unsaved work before it lists anything (confirmDiscardDraft), so the answer
    // an operator gives is given here too: Discard, then the items appear.
    const accept = document.getElementById('win95-confirm-accept');
    if (accept && document.getElementById('win95-confirm')?.style.display !== 'none') {
      accept.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return [...document.querySelectorAll('#win95-context-menu .context-menu-item')].map((entry) => entry.textContent.trim());
  })()`);
  assert.ok(!menuItems.error, menuItems.error || '');
  assert.ok(
    menuItems.some((label) => label.includes('Fire Macro')),
    `the macro row's menu must offer firing the whole list (got ${JSON.stringify(menuItems)})`,
  );

  // --- A macro with no trigger of its own: only a cue fires it, and it can be enabled ----------
  //
  // The owner would not build one. The trigger select's empty entry read as "— Not configured —", the
  // library refused to enable a macro whose trigger was empty, and the row then printed "NOT
  // CONFIGURED", so a macro he wanted fired *only* by a timecode cue looked like a half-made one that
  // would fire on its own. The empty entry is now the named cue-only choice, such a macro is complete,
  // and enabling it is what makes it usable at all — a cue addresses it by its index in the library
  // and `fire_macro` never consults the trigger. What is asserted here is the window's half; the cue
  // that fires it is asserted where the firing already lives (`test-desktop-settings-tabs-browser.mjs`).
  const cueOnlyOption = await evaluate(`(() => {
    const select = document.getElementById('trigger-category');
    const option = [...select.options].find((entry) => entry.value === '');
    return { present: Boolean(option), label: option?.textContent || '' };
  })()`);
  assert.equal(cueOnlyOption.present, true,
    'the trigger select must keep an empty option the operator can choose');
  assert.match(cueOnlyOption.label, /Only a cue fires it/,
    `the empty trigger option must read as the cue-only choice, not as a missing value (got ${JSON.stringify(cueOnlyOption.label)})`);

  // A fully configured macro of this kind, pushed through the same `applyConfig` the library uses.
  const cueOnlyReady = await evaluate(`(() => {
    const macro = {
      name: 'Cue only smoke',
      enabled: false,
      triggerCategory: '',
      triggerIds: '',
      triggerParameter: '',
      actionSteps: [{
        enabled: true, actionMode: 'set', actionAddress: '/ch/1/mute',
        targetCategory: 'ch', targetIds: '1', targetParameter: 'mute', actionArgKind: 'int', actionValue: '1',
      }],
    };
    macroLibrary.macros.push(macro);
    macroLibrary.selectedIndex = macroLibrary.macros.length - 1;
    selectedMacroIndices.clear();
    selectedMacroIndices.add(macroLibrary.selectedIndex);
    applyConfig(macro);
    renderMacroLibrary();
    return { index: macroLibrary.selectedIndex, reason: macroIncompleteReason(macro) };
  })()`);
  assert.equal(cueOnlyReady.reason, '',
    `a macro with no trigger of its own must be complete, not incomplete (macroIncompleteReason said ${JSON.stringify(cueOnlyReady.reason)})`);
  // The narrowing matters: a trigger the operator *started* filling in is still unfinished, so this
  // change cannot have made some other genuinely-incomplete macro enable-able. The refusal must also
  // name what to do: the owner was told only "trigger not configured", read the modal as proof the
  // feature was broken, and never learned that clearing the trigger back to the cue-only choice is a
  // legitimate answer — the label is read from the page rather than retyped here, so the advice and
  // the select entry cannot drift apart (owner report, 2026-10-05).
  const partialTrigger = await evaluate(`(() => {
    const reason = macroIncompleteReason({ triggerCategory: 'usb', triggerIds: '1', triggerParameter: '',
      actionSteps: [{ enabled: true, actionMode: 'set', actionAddress: '/ch/1/mute' }] });
    const reasonNoAddress = macroIncompleteReason({ triggerCategory: 'usb', triggerIds: '', triggerParameter: 'meter',
      actionSteps: [{ enabled: true, actionMode: 'set', actionAddress: '/ch/1/mute' }] });
    const list = '• MUTE DRUMS: ' + reason;
    const dialog = macroEnableBlockedMessage([list]);
    return {
      reason, reasonNoAddress, list, dialog,
      cueOnlyLabel: CUE_ONLY_LABEL,
      cueOnlyReason: macroIncompleteReason({ triggerCategory: '', triggerIds: '', triggerParameter: '',
        actionSteps: [{ enabled: true, actionMode: 'set', actionAddress: '/ch/1/mute' }] }),
    };
  })()`);
  assert.ok(partialTrigger.reason,
    'a partly filled trigger must still be refused as incomplete');
  assert.ok(partialTrigger.reason.includes(partialTrigger.cueOnlyLabel),
    `the refusal must name the remedy with the editor's own cue-only label, not merely the state (reason was ${JSON.stringify(partialTrigger.reason)}, the label is ${JSON.stringify(partialTrigger.cueOnlyLabel)})`);
  assert.match(partialTrigger.reason, /^trigger is half set -/,
    `the refusal must say the trigger is half set (reason was ${JSON.stringify(partialTrigger.reason)})`);
  assert.ok(partialTrigger.list.includes(partialTrigger.cueOnlyLabel),
    `the bullet line the modal prints must carry the remedy too (line was ${JSON.stringify(partialTrigger.list)})`);
  // Both halves of "partial" are refused, and the second one names this defect: an implementation that
  // only handled "source chosen, nothing to watch" would leave the address-without-parameter case with
  // the old wording, and the first assertion above would not see it.
  assert.ok(partialTrigger.reasonNoAddress?.includes(partialTrigger.cueOnlyLabel),
    `an address with no parameter must get the same remedy, not a dead end (reason was ${JSON.stringify(partialTrigger.reasonNoAddress)})`);
  // The dialog's fixed tail used to talk about the action target, which was not the operator's problem.
  // The modal an operator would read is asserted through the window's own builder.
  assert.ok(partialTrigger.dialog.includes(partialTrigger.cueOnlyLabel),
    'the enable dialog must carry the remedy as well');
  assert.match(partialTrigger.dialog, /WHEN panel/,
    `the enable dialog must point a half-set trigger at the WHEN panel (dialog was ${JSON.stringify(partialTrigger.dialog)})`);
  assert.doesNotMatch(partialTrigger.dialog.split(partialTrigger.list)[1] || '', /Set the action target/,
    'a half-set trigger must not be given advice about the action target');
  assert.equal(partialTrigger.cueOnlyReason, '',
    'a macro with no trigger of its own must stay acceptable; only a half-set one is refused');
  assert.equal(await evaluate(`macroIncompleteReason({ triggerCategory: '', triggerIds: '', triggerParameter: '',
    actionSteps: [{ enabled: true, actionMode: 'set', actionAddress: '' }] })`),
    'no runnable action step',
    'a cue-only macro with nothing to run must still be refused');

  await new Promise((resolve) => setTimeout(resolve, 250));
  const cueOnlyRow = await evaluate(`(() => {
    const row = document.querySelector('#macro-library-list .macro-row.selected');
    return {
      summary: row?.querySelector('.step-meta')?.textContent || '',
      recipe: document.getElementById('recipe-trigger')?.textContent || '',
      detail: document.getElementById('recipe-trigger-detail')?.textContent || '',
    };
  })()`);
  assert.match(cueOnlyRow.summary, /CUE ONLY/,
    `the library row must say the cue-only choice, not NOT CONFIGURED (got ${JSON.stringify(cueOnlyRow.summary)})`);
  assert.doesNotMatch(cueOnlyRow.summary, /NOT CONFIGURED/,
    `the row must not contradict the trigger label (got ${JSON.stringify(cueOnlyRow.summary)})`);
  assert.match(cueOnlyRow.recipe, /timecode cue/i,
    `the WHEN summary must say a cue fires it (got ${JSON.stringify(cueOnlyRow.recipe)})`);
  assert.match(cueOnlyRow.detail, /timecode cue/i,
    `and the recipe detail must say the same (got ${JSON.stringify(cueOnlyRow.detail)})`);

  // The part that was actually broken: it could not be enabled. Live Safe Mode blocks enabling on
  // purpose, so it is switched off first, the way the operator does it.
  await evaluate(`(() => {
    const lock = document.getElementById('settings-live-lock');
    if (lock) { lock.checked = false; lock.dispatchEvent(new Event('change', { bubbles: true })); }
  })()`);
  await evaluate(`document.getElementById('library-toggle-enabled').click()`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(`macroLibrary.macros[${cueOnlyReady.index}]?.enabled === true`)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate(`macroLibrary.macros[${cueOnlyReady.index}]?.enabled`), true,
    'a macro with no trigger of its own must be enable-able; a cue needs it enabled and nothing else could turn it on');
  // Its trigger stayed empty through the enable: nothing invented a source on the way.
  const cueOnlyAfterEnable = await evaluate(`(() => {
    const macro = macroLibrary.macros[${cueOnlyReady.index}];
    return [macro.triggerCategory, macro.triggerIds, macro.triggerParameter];
  })()`);
  assert.deepEqual(cueOnlyAfterEnable, ['', '', ''],
    `enabling a cue-only macro must not invent a trigger for it (got ${JSON.stringify(cueOnlyAfterEnable)})`);
  console.log('cue-only macro: named choice, complete, enable-able, and the summaries agree');

  // --- The cue-only entry is reachable from the window, not only from a fixture -----------------
  //
  // The owner's own reproduction: pick a category the console addresses without an id — which seeds
  // `#trigger-ids` with "1" on purpose, because the completeness rule refuses an empty trigger id
  // before the resolver ignores it — and then choose the empty cue-only entry. The seeded id, and the
  // parameter `setSelectOptions`' `keepUnknown` had carried over, both survived that choice, so the
  // macro was saved "half set" and the enable check refused it. The only way to get an enabled macro
  // with no trigger was to enable it first and clear the trigger while it was enabled (owner report,
  // 2026-10-05); the empty state has to be reachable by the choice itself.
  const windowChoice = await evaluate(`(() => {
    const macro = {
      name: 'Cue only from the window',
      enabled: false,
      triggerCategory: '',
      triggerIds: '',
      triggerParameter: '',
      actionSteps: [{
        enabled: true, actionMode: 'set', actionAddress: '/ch/1/mute',
        targetCategory: 'ch', targetIds: '1', targetParameter: 'mute', actionArgKind: 'int', actionValue: '1',
      }],
    };
    macroLibrary.macros.push(macro);
    macroLibrary.selectedIndex = macroLibrary.macros.length - 1;
    selectedMacroIndices.clear();
    selectedMacroIndices.add(macroLibrary.selectedIndex);
    applyConfig(macro);
    renderMacroLibrary();
    const select = document.getElementById('trigger-category');
    // A real <select> fires input then change for one operator choice; the contract drives the pair.
    const setCategory = (value) => {
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setCategory('showstate');
    const seeded = document.getElementById('trigger-ids').value;
    const parameter = document.getElementById('trigger-parameter');
    const watch = [...parameter.options].find((option) => option.value !== '');
    if (watch) {
      parameter.value = watch.value;
      parameter.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setCategory('');
    return {
      index: macroLibrary.selectedIndex,
      seeded,
      watched: watch?.value || '',
      category: select.value,
      ids: document.getElementById('trigger-ids').value,
      parameterValue: parameter.value,
      parameterOptions: [...parameter.options].map((option) => option.value),
      reason: macroIncompleteReason(readConfigFromUi()),
    };
  })()`);
  // The seeding the completeness rule depends on is untouched for a real category...
  assert.equal(windowChoice.seeded, '1',
    `a real category the console addresses without an id must still seed the id field (got ${JSON.stringify(windowChoice.seeded)})`);
  assert.ok(windowChoice.watched, 'the show-state category must offer a parameter to watch for this contract');
  // ...and the cue-only choice is what empties the panel, all three fields.
  assert.equal(windowChoice.category, '', 'the cue-only choice must be the empty category');
  assert.equal(windowChoice.ids, '',
    `choosing the cue-only entry must leave the trigger id field empty, not seeded (got ${JSON.stringify(windowChoice.ids)})`);
  assert.equal(windowChoice.parameterValue, '',
    `choosing the cue-only entry must leave the watch parameter empty (got ${JSON.stringify(windowChoice.parameterValue)})`);
  assert.deepEqual(windowChoice.parameterOptions, [''],
    `the parameter select must fall back to its own empty state, not keep the previous category's parameter (got ${JSON.stringify(windowChoice.parameterOptions)})`);
  assert.equal(windowChoice.reason, '',
    `the window's own empty trigger must be complete, or the macro cannot be enabled (macroIncompleteReason said ${JSON.stringify(windowChoice.reason)})`);

  // Saved and enabled through the window's own controls: the state the operator could not reach.
  await evaluate(`document.getElementById('library-save-current').click()`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(`macroLibrary.macros[${windowChoice.index}]?.name === 'Cue only from the window'`)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const savedCueOnly = await evaluate(`(() => {
    const macro = macroLibrary.macros[${windowChoice.index}];
    return [macro?.triggerCategory, macro?.triggerIds, macro?.triggerParameter];
  })()`);
  assert.deepEqual(savedCueOnly, ['', '', ''],
    `the saved macro must carry the empty trigger the window showed (got ${JSON.stringify(savedCueOnly)})`);
  await evaluate(`document.getElementById('library-toggle-enabled').click()`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(`macroLibrary.macros[${windowChoice.index}]?.enabled === true`)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate(`macroLibrary.macros[${windowChoice.index}]?.enabled`), true,
    'a macro whose trigger was emptied by choosing the cue-only entry must be enable-able');
  // The same fields while a stored macro that is genuinely half set is on screen: the render must
  // show it as it is and never clear it behind the operator's back (the clearing belongs to the
  // choice above). The catalogue is re-rendered the way a desk answering its model does, because that
  // render is the path that could quietly rewrite the operator's stored trigger. Left refused, with
  // the remedy, exactly as before.
  const storedPartial = await evaluate(`(() => {
    applyConfig({ name: 'Stored half-set trigger', enabled: false, triggerCategory: '', triggerIds: '1', triggerParameter: '',
      actionSteps: [{ enabled: true, actionMode: 'set', actionAddress: '/ch/1/mute' }] });
    populateCategorySelects();
    return {
      category: document.getElementById('trigger-category').value,
      ids: document.getElementById('trigger-ids').value,
      parameter: document.getElementById('trigger-parameter').value,
      reason: macroIncompleteReason(readConfigFromUi()),
    };
  })()`);
  assert.deepEqual([storedPartial.category, storedPartial.ids, storedPartial.parameter], ['', '1', ''],
    `loading a stored half-set trigger, and re-rendering the catalogue over it, must show it honestly instead of clearing the operator's field (got ${JSON.stringify(storedPartial)})`);
  assert.match(storedPartial.reason, /^trigger is half set -/,
    `and it must still be refused with the half-set reason (got ${JSON.stringify(storedPartial.reason)})`);
  console.log('cue-only from the window: a real category seeds, the empty choice empties all three fields, and it enables');

  // --- Compact density: the macro row may not fold onto itself -------------------------------
  // Operator report after 0.2.52: "en modo compact de ui: rename, notice y muchas cosas se solapan,
  // se rompe la UI". The row pinned the secondary actions to the sizes they had when RENAME and
  // NOTICE were icon boxes; at the compact font NOTICE needs 36 px in a 20 px box, so the word ran
  // 8 px over ENABLED. The check below is the operator's, with the boxes: no two controls of the row
  // may intersect, each must have a real size, and no label may spill out of its own box — with a
  // deliberately long macro name, which is when the row is tightest (the name must ellipsise).
  const rowBoxes = () => evaluate(`(() => {
    const row = document.querySelector('#macro-library-list .macro-row');
    if (!row) return { error: 'no macro row to measure' };
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1), scrollW: el.scrollWidth, clientW: el.clientWidth };
    };
    return {
      compact: document.body.classList.contains('density-compact'),
      row: box(row),
      name: box(row.querySelector('.macro-select-button .step-title')),
      select: box(row.querySelector('.macro-select-button')),
      rename: box(row.querySelector('.macro-rename-button')),
      notice: box(row.querySelector('.macro-notice-btn')),
      enable: box(row.querySelector('.macro-enable-button')),
      inline: box(row.querySelector('.macro-inline-name')),
    };
  })()`);

  function assertRowApart(measured, where) {
    assert.ok(!measured.error, `${where}: ${measured.error || ''}`);
    assert.equal(measured.compact, true, `${where}: the compact density must be applied for this check`);
    assert.ok(measured.select.w > 0 && measured.select.h > 0, `${where}: the macro button must have a real size`);
    // The name lives INSIDE the macro button, so the button is not compared with it: the controls
    // that must not touch each other are the name itself and the three buttons beside it.
    const entries = ['name', 'rename', 'notice', 'enable'].map((key) => [key, measured[key]]);
    for (const [key, box] of entries) {
      assert.ok(box, `${where}: the first macro row must render its ${key} control`);
      assert.ok(box.w > 0 && box.h > 0, `${where}: ${key} must have a real size (got ${box.w}x${box.h})`);
    }
    const overlaps = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        assert.equal(overlaps(entries[i][1], entries[j][1]), false,
          `${where}: ${entries[i][0]} and ${entries[j][0]} must not intersect (${JSON.stringify(entries[i][1])} vs ${JSON.stringify(entries[j][1])})`);
      }
    }
    // Bounding boxes alone did not catch the report: the boxes were apart while the *word* NOTICE
    // was painted over the next button. A label wider than its own box is that overlap.
    for (const key of ['rename', 'notice', 'enable']) {
      assert.ok(measured[key].scrollW <= measured[key].clientW + 1,
        `${where}: the ${key} label must fit inside its own box (${measured[key].scrollW} > ${measured[key].clientW})`);
    }
    // A long name takes the room that is left and ellipsises; it never pushes into the buttons.
    assert.ok(measured.name.w > 0, `${where}: the macro name must stay readable`);
    assert.ok(measured.name.r <= measured.select.r + 0.5,
      `${where}: a long name must ellipsise inside its own button (name ends at ${measured.name.r}, button at ${measured.select.r})`);
  }

  const longName = 'A VERY LONG MACRO NAME THAT SHOULD ELLIPSISE INSTEAD OF PUSHING THE BUTTONS AROUND';
  const compactStep = { id: 'step-1', enabled: true, title: 'Mute CH 1', targetCategory: 'channel', actionAddress: '/ch/1/mute', actionValue: 1 };
  await evaluate(`localStorage.setItem('wing_ui_density', 'compact')`);
  await evaluate(`localStorage.setItem('wing_mock_macro_library', JSON.stringify({
    schemaVersion: 1, selectedIndex: 0, macros: [
      { name: ${JSON.stringify(longName)}, enabled: true, courtesyNotice: true, colorTag: 'red',
        triggerCategory: 'usb', triggerIds: '1', triggerParameter: 'meters', triggerOperator: 'gt', triggerThreshold: 12,
        actionSteps: [${JSON.stringify(compactStep)}] },
      { name: 'short', enabled: false, courtesyNotice: false, colorTag: 'none',
        triggerCategory: 'usb', triggerIds: '2', triggerParameter: 'meters', triggerOperator: 'gt', triggerThreshold: 12,
        actionSteps: [${JSON.stringify(compactStep)}] }
    ]
  }))`);
  // Seeded through a reload, and waited for by the document that reload produces (a new token): the
  // outgoing document answers `readyState` and already carries a macro row, so a wait on those two alone
  // would measure the window that is being replaced.
  const beforeCompactReload = await evaluate('String(window.__wingTestDocument || "")');
  await call('Page.reload', { ignoreCache: true });
  const compactWindow = await waitFor(`(() => {
    const token = String(window.__wingTestDocument || "");
    const title = document.querySelector("#macro-library-list .macro-row .step-title")?.textContent || "";
    return {
      ok: document.readyState === "complete" && token !== "" && token !== ${JSON.stringify(beforeCompactReload)}
        && title === ${JSON.stringify(longName)},
      token, href: location.href, title,
      rows: document.querySelectorAll("#macro-library-list .macro-row").length,
    };
  })()`, { tries: 40 });
  assert.ok(compactWindow.ok, `the reloaded window must show the seeded library (page: ${JSON.stringify(compactWindow)})`);
  assert.equal(await evaluate('document.querySelector("#macro-library-list .macro-row .step-title").textContent'),
    longName, 'the long name must be the one on screen for the compact check');
  assertRowApart(await rowBoxes(), 'compact density with a long macro name');

  // The rename control replaces the name with its own editor: the same promise holds while it is open.
  await evaluate('document.querySelector("#macro-library-list .macro-row .macro-rename-button").click()');
  const compactEditor = await waitFor(`(() => {
    const row = document.querySelector("#macro-library-list .macro-row");
    const input = row?.querySelector(".macro-inline-name");
    return {
      ok: Boolean(input) && input.isConnected,
      editors: document.querySelectorAll(".macro-inline-name").length,
      rows: document.querySelectorAll("#macro-library-list .macro-row").length,
    };
  })()`, { tries: 20 });
  assert.ok(compactEditor.ok, `the compact row must open the inline rename editor (page: ${JSON.stringify(compactEditor)})`);
  const withEditor = await rowBoxes();
  assert.ok(withEditor.inline && withEditor.inline.w > 0 && withEditor.inline.h > 0,
    'the inline rename editor must be laid out in the compact row');
  const overlapsInline = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  for (const key of ['notice', 'enable']) {
    assert.equal(overlapsInline(withEditor.inline, withEditor[key]), false,
      `compact density: the rename editor and the ${key} button must not intersect`);
  }
  await evaluate('document.querySelector(".macro-inline-name").blur()');
  console.log('compact density: the macro row controls stay apart, also with a long name');

  // --- Compact density: the picker's rows may not paint outside their own box ------------------
  // The rule above fixes the macro row; the picker the operator chooses a parameter from has the same
  // problem through another door: `body.density-compact button { height: 20px }` beats
  // `.parameter-menu-row`'s own `height: auto`, so a row whose label wraps — the self-send reason,
  // "Bus 3 cannot send to itself — the console ignores it (Maillot footnote 38)" — measured 22 px of
  // label in a 20 px box and painted the second line over its neighbour. A row must be allowed to
  // grow, and this measures the row the operator has to read.
  await evaluate(`(() => {
    const set = (id, value) => {
      const field = document.getElementById(id);
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('target-category', 'bus');
    set('target-ids', '3');
    set('target-parameter', 'send_level');
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const compactPicker = await evaluate(`(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1), scrollH: el.scrollHeight, clientH: el.clientHeight };
    };
    document.getElementById('send-id-menu').click();
    const panel = document.getElementById('send-id-menu-list');
    const row = [...panel.querySelectorAll('.parameter-menu-row')].find((entry) => entry.dataset.menuValue === '3');
    const label = row?.querySelector('.parameter-menu-label');
    return {
      compact: document.body.classList.contains('density-compact'),
      row: box(row),
      label: box(label),
      rowInside: Boolean(row) && row.getBoundingClientRect().left >= 0
        && row.getBoundingClientRect().right <= window.innerWidth,
      scrolled: Boolean(row) && row.offsetHeight > 0,
    };
  })()`);
  assert.equal(compactPicker.compact, true, 'the compact density must be applied for the picker check');
  assert.ok(compactPicker.scrolled, 'the bus destination row must be rendered for the picker check');
  assert.ok(compactPicker.row && compactPicker.row.h >= 20,
    `the compact picker row must have a real height (got ${JSON.stringify(compactPicker.row)})`);
  assert.ok(compactPicker.label && compactPicker.label.b <= compactPicker.row.b + 0.5
    && compactPicker.label.t >= compactPicker.row.t - 0.5,
    `compact density: the wrapped label must fit inside its own row (label ${JSON.stringify(compactPicker.label)} in row ${JSON.stringify(compactPicker.row)})`);
  assert.ok(compactPicker.row.scrollH <= compactPicker.row.clientH + 1,
    `compact density: the picker row must not clip its own content (${compactPicker.row.scrollH} in ${compactPicker.row.clientH})`);
  assert.equal(compactPicker.rowInside, true, 'the picker row must stay inside the window in compact density');
  await evaluate(`document.getElementById('send-id-menu').click()`);
  console.log('compact density: the picker row grows around its wrapped label');
  console.log('Desktop macro library/editor/IF browser smoke passed.');
} finally {
  // The browser tests share one Chrome profile. A failure inside the compact-density check must not
  // leave the whole gate running in compact mode with a seeded library (it did once, and the next
  // run failed far away from the cause), so the keys are put back even on the way out.
  try {
    await evaluate(`localStorage.setItem('wing_ui_density', 'standard');
      localStorage.removeItem('wing_mock_macro_library');
      document.body.classList.remove('density-compact');`);
  } catch (_) {}
  socket.close();
}

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
