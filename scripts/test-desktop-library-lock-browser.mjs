// Real handlers, real library state, stubbed native IPC. Disabled buttons alone do not prove a guard works.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { debuggerPages, openDesktopTab, installDesktopStub, navigateDesktopPage } from './lib/desktop-ui-harness.mjs';

if (!await debuggerPages()) {
  console.error('No Chrome: library lock behaviour was not measured.');
  process.exit(3);
}
const browser = await openDesktopTab();
const { call, evaluate, sleep, closeTab, pageErrors } = browser;
process.on('exit', closeTab);
await installDesktopStub(call, { strict: true });
const url = process.env.WING_TEST_ROOT
  ? pathToFileURL(resolve(process.env.WING_TEST_ROOT, 'desktop/ui/index.html')).href
  : browser.url;
await navigateDesktopPage({ ...browser, url });
await sleep(400);

async function seed(locked, reconnect = false) {
  await evaluate(`(async () => {
    const original = await invoke('default_show_runner_config');
    original.name = 'Keep this macro';
    original.enabled = false;
    macroLibrary = { schemaVersion: 1, selectedIndex: 0, macros: [original] };
    selectedMacroIndices = new Set([0]);
    applyConfig(disarmedConfig(original));
    draftDirty = false;
    renderMacroLibrary();
    safetyConfig.liveLock = ${JSON.stringify(locked)};
    streamMode = ${JSON.stringify(reconnect ? 'failed' : 'live')};
    liveReconnectWanted = ${JSON.stringify(reconnect)};
    lastLiveRequest = ${reconnect ? '{}' : 'null'};
    syncLiveLockUi();
    streamOutput.textContent = '';
    window.__INVOKES.length = 0;
    return true;
  })()`);
}
async function snapshot() {
  return evaluate(`({ library: JSON.stringify(macroLibrary),
    saves: window.__INVOKES.filter(row => row.cmd === 'save_macro_library').length,
    notice: streamOutput.textContent,
    count: macroLibrary.macros.length })`);
}
const actions = ['library-new', 'library-duplicate', 'library-delete', 'library-save-current'];
for (const reconnect of [false, true]) {
  for (const id of actions) {
    await seed(true, reconnect);
    const before = await snapshot();
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}).disabled`), true, `${id} must look locked`);
    // dispatchEvent deliberately reaches a disabled control's listener: test the guard behind the presentation.
    await evaluate(`document.getElementById(${JSON.stringify(id)}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await sleep(200);
    const after = await snapshot();
    assert.equal(after.library, before.library, `LOCKED ${id}: must preserve the actual library`);
    assert.equal(after.saves, before.saves, `LOCKED ${id}: must not reach persistence`);
    assert.match(after.notice, /\[LOCKED\]/, `LOCKED ${id}: refusal must explain itself`);
  }
}

// Positive controls: the same handlers must perform their jobs once unlocked.
for (const id of actions) {
  await seed(false);
  if (id === 'library-save-current') {
    await evaluate(`(() => { const name = document.getElementById('macro-name'); name.value = 'Saved exact name'; name.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await sleep(250);
  if (id === 'library-delete') {
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('win95-confirm')).display !== 'none'`), true, 'delete must ask before removal');
    await evaluate(`document.getElementById('win95-confirm-accept').click()`);
  }
  for (let attempt = 0; attempt < 30 && (await snapshot()).saves === 0; attempt++) await sleep(50);
  const after = await snapshot();
  assert.ok(after.saves > 0, `UNLOCKED ${id}: positive control must persist`);
  assert.equal(after.count, id === 'library-delete' ? 0 : id === 'library-save-current' ? 1 : 2, `UNLOCKED ${id}: expected library result`);
  if (id === 'library-save-current') {
    assert.equal(await evaluate(`window.__SAVED_LIBRARY.macros[0].name`), 'Saved exact name', 'save must persist exactly the edited name');
  }
}
assert.deepEqual(await evaluate('window.__UNKNOWN_INVOKES'), [], 'every IPC response used by this suite must be configured');
assert.deepEqual(pageErrors, [], 'uncaught page exceptions must fail the suite');
console.log('Library lock: four real handlers refuse changes while live/reconnecting; all work after unlocking.');
// A WebSocket keeps Node alive. Close it before completion, not only from an exit handler.
closeTab();
console.log('WING_BROWSER_SUITE_OK');
