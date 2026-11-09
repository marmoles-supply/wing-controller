import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../desktop/ui/index.html', import.meta.url), 'utf8');
const start = source.indexOf('function confirmMacroDeletion(message) {');
const end = source.indexOf('async function upsertCurrentDraftIntoLibrary()', start);
assert.ok(start >= 0 && end > start, 'delete handlers exist');

// The 2026-09-22 audit removed the legacy `#macro-delete-confirm` dialog (it focused Cancel and
// its Enter cancelled the delete silently) and `confirmMacroDeletion` delegates to `win95Confirm`.
// The test drives that shared confirm instead of the nodes that no longer exist.
const confirms = [];
let resolveConfirm = null;
const context = {
  document: {
    getElementById() { return null; },
    addEventListener() {},
    removeEventListener() {},
  },
  win95Confirm(options) {
    confirms.push(options);
    return new Promise((resolve) => { resolveConfirm = resolve; });
  },
  macroLibrary: { selectedIndex: 1, macros: [{ name: 'First' }, { name: 'Second' }] },
  selectedMacroIndices: new Set([1]),
  // The delete path names the runtime counters of the macros it removes so they leave the map instead of
  // living for the session (master plan 2026-09-22, §5.2 item 28). Both collaborators are the window's,
  // so the sandbox provides them in the same shape: the id the console compiles, counted over the
  // enabled macros, and the map it is deleted from.
  macroRuntimeIdForIndex(index) { return `macro-${index + 1}`; },
  macroRuntime: { 'macro-1': { lastEvent: 'sent' }, 'macro-2': { lastEvent: 'sent' } },
  safeMacroName(macro) { return macro.name; },
  disarmedConfig(macro) { return macro; },
  applyConfig() {},
  syncState() {},
  streamOutput: { textContent: '' },
  async saveMacroLibraryState() {},
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

let pending = context.deleteSelectedMacros();
assert.equal(confirms.length, 1, 'deleting must ask the shared confirm dialog');
assert.match(confirms[0].message, /Second/, 'the dialog must name the macro being deleted');
assert.equal(confirms[0].danger, true, 'deleting macros is destructive and must be painted as such');
resolveConfirm(false);
await pending;
assert.equal(context.macroLibrary.macros.length, 2, 'cancel preserves macros');

pending = context.deleteSelectedMacros();
resolveConfirm(true);
await pending;
assert.deepEqual(context.macroLibrary.macros.map((macro) => macro.name), ['First']);
assert.equal(context.macroRuntime['macro-2'], undefined,
  'the deleted macro\'s counters must leave the map, not live for the session');
assert.notEqual(context.macroRuntime['macro-1'], undefined, 'and the macro that stayed keeps its own');

context.selectedMacroIndices = new Set([0]);
pending = context.deleteSelectedMacros();
resolveConfirm(true);
await pending;
assert.equal(context.macroLibrary.macros.length, 0, 'last macro can be removed');
console.log('Desktop macro Delete UI tests passed.');
