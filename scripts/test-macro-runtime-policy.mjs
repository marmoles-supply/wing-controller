import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/osc/MacroEngine.js', import.meta.url), 'utf8');
const runtimeSource = source
  .replace(/^import .*;\n/gm, '')
  .replace('export default new MacroEngine();', 'globalThis.__macroEngine = new MacroEngine();');

const oscHandlers = new Map();
const sent = [];
const states = new Map();
let sendsAccepted = true;

const OscManager = {
  on(event, handler) {
    oscHandlers.set(event, handler);
    return () => oscHandlers.delete(event);
  },
  setWatchedAddresses() {},
  getRuntimeStatus() {
    return { wingOnline: true };
  },
  getState(address) {
    return states.get(address);
  },
  getFreshState(address) {
    return states.get(address);
  },
  sendToWing(address, args) {
    if (!sendsAccepted) return false;
    sent.push({ address, args });
    states.set(address, args);
    return true;
  },
};

const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Math,
  Date,
  JSON,
  FileSystem: { documentDirectory: 'memory://' },
  Sharing: {},
  DocumentPicker: {},
  OscManager,
  readJsonTextWithBackup: async () => null,
  safeWriteJson: async () => true,
});

vm.runInContext(runtimeSource, context, { filename: 'MacroEngine.js' });
const engine = context.__macroEngine;
await engine.whenLoaded();

const emitWingState = (address, value) => {
  const handler = oscHandlers.get('wing_state');
  assert.equal(typeof handler, 'function', 'wing_state handler must be registered');
  states.set(address, [value]);
  handler({ address, args: [value] });
};

const emitOnlineStatus = (online) => {
  const handler = oscHandlers.get('wing_online_status');
  assert.equal(typeof handler, 'function', 'wing_online_status handler must be registered');
  handler(online);
};

assert.deepEqual(
  Array.from(engine.resolveAddresses({ type: 'fixed', category: 'unknown', ids: '', parameter: 'unknown' })),
  [],
  'invalid structured targets must fail closed',
);
assert.deepEqual(Array.from(engine.resolveAddresses('ch/1/mute')), [], 'custom string paths must start with /');

await engine.replaceMacros([
  {
    id: 'meter_baseline',
    name: 'Meter Baseline',
    enabled: true,
    triggerTarget: { type: 'fixed', category: 'ch', ids: '1', parameter: 'meter', customAddress: '' },
    triggerOperator: '>',
    triggerEdgeMode: 'on',
    triggerValue: -18,
    triggerMeterMode: 'transient',
    triggerMeterCooldownMs: 0,
    triggerMeterRearmDb: 3,
    triggerMeterDwellMs: 0,
    triggerMeterStaleAfterMs: 1000,
    executionPolicy: { overlapStrategy: 'drop', cooldownMs: 0, maxQueueDepth: 1, onDisconnect: 'abort' },
    actions: [
      { type: 'osc', target: { type: 'custom', customAddress: '/ch/1/mute' }, args: [1] },
    ],
  },
]);

emitWingState('/meters/ch/1', -10);
assert.equal(sent.length, 0, 'first hot meter packet must establish baseline only');

emitWingState('/meters/ch/1', -40);
assert.equal(sent.length, 0, 'falling below threshold should rearm without firing ON edge');

emitWingState('/meters/ch/1', -10);
assert.equal(sent.length, 1, 'fresh rising edge after baseline/rearm should fire once');

await new Promise((resolve) => setTimeout(resolve, 20));
const sentAfterFirstTransient = sent.length;
emitWingState('/meters/ch/1', -14);
assert.equal(sent.length, sentAfterFirstTransient, 'release above threshold must not fire by itself');
emitWingState('/meters/ch/1', -9);
assert.equal(sent.length, sentAfterFirstTransient + 1, 'FAST mode must detect a new transient after a partial meter release');

await engine.replaceMacros([
  {
    id: 'usb_meter_transients',
    name: 'USB Meter Transients',
    enabled: true,
    triggerTarget: { type: 'fixed', category: 'usb', ids: '1', parameter: 'meter', customAddress: '' },
    triggerOperator: '>',
    triggerEdgeMode: 'on',
    triggerValue: -18,
    triggerMeterMode: 'transient',
    triggerMeterCooldownMs: 0,
    triggerMeterRearmDb: 3,
    triggerMeterDwellMs: 0,
    triggerMeterStaleAfterMs: 1000,
    executionPolicy: { overlapStrategy: 'concurrent', cooldownMs: 0, maxQueueDepth: 1, onDisconnect: 'abort' },
    actions: [
      { type: 'osc', target: { type: 'custom', customAddress: '/ch/5/mute' }, args: [1] },
    ],
  },
]);

const sentBeforeUsbTransients = sent.length;
emitWingState('/meters/usb/1', -8);
assert.equal(sent.length, sentBeforeUsbTransients, 'first hot source USB meter packet must establish baseline only');
emitWingState('/meters/usb/1', -40);
emitWingState('/meters/usb/1', -8);
emitWingState('/meters/usb/1', -14);
emitWingState('/meters/usb/1', -7);
assert.equal(
  sent.length,
  sentBeforeUsbTransients + 2,
  'FAST source USB meter triggers must catch rapid consecutive transients without waiting for a visual refresh',
);

await engine.replaceMacros([
  {
    id: 'overlap_drop',
    name: 'Overlap Drop',
    enabled: true,
    triggerTarget: { type: 'fixed', category: 'ch', ids: '1', parameter: 'mute', customAddress: '' },
    triggerOperator: '==',
    triggerEdgeMode: 'on',
    triggerValue: 1,
    executionPolicy: { overlapStrategy: 'drop', cooldownMs: 0, maxQueueDepth: 1, onDisconnect: 'abort' },
    actions: [
      { type: 'delay', ms: 120 },
      { type: 'osc', target: { type: 'custom', customAddress: '/ch/2/mute' }, args: [1] },
    ],
  },
]);

const firstRun = engine.executeMacro(engine.macros[0], { source: 'test' });
const secondRun = engine.executeMacro(engine.macros[0], { source: 'test' });
assert.equal(firstRun, true, 'first manual execution should start');
assert.equal(secondRun, false, 'overlap drop policy should reject a second active run');

let runtime = engine.getMacroRuntimeSnapshot().overlap_drop;
assert.equal(runtime.activeCount, 1, 'runtime snapshot should show one active run');
assert.equal(runtime.dropped, 1, 'runtime snapshot should count dropped overlap runs');
assert.equal(runtime.lastDropReason, 'already running', 'runtime snapshot should explain drop reason');

await new Promise((resolve) => setTimeout(resolve, 180));
runtime = engine.getMacroRuntimeSnapshot().overlap_drop;
assert.equal(runtime.activeCount, 0, 'runtime snapshot should return to idle after delay/action sequence');
assert.equal(runtime.completed, 1, 'runtime snapshot should count completed runs');
assert.ok(sent.some((item) => item.address === '/ch/2/mute'), 'delayed macro action should still execute');

await engine.replaceMacros([
  {
    id: 'disconnect_abort',
    name: 'Disconnect Abort',
    enabled: true,
    triggerTarget: { type: 'fixed', category: 'ch', ids: '1', parameter: 'mute', customAddress: '' },
    triggerOperator: '==',
    triggerEdgeMode: 'on',
    triggerValue: 1,
    executionPolicy: { overlapStrategy: 'drop', cooldownMs: 0, maxQueueDepth: 1, onDisconnect: 'abort' },
    actions: [
      { type: 'delay', ms: 100 },
      { type: 'osc', target: { type: 'custom', customAddress: '/ch/3/mute' }, args: [1] },
    ],
  },
]);

const sentBeforeDisconnect = sent.length;
assert.equal(engine.executeMacro(engine.macros[0], { source: 'test' }), true, 'macro should start while online');
emitOnlineStatus(false);
await new Promise((resolve) => setTimeout(resolve, 140));
runtime = engine.getMacroRuntimeSnapshot().disconnect_abort;
assert.equal(sent.length, sentBeforeDisconnect, 'offline transition must cancel delayed writes');
assert.equal(runtime.activeCount, 0, 'offline transition must clear active runs');
assert.equal(runtime.aborted, 1, 'offline transition must count the aborted run');
assert.equal(runtime.lastAbortReason, 'console offline', 'offline abort reason must remain visible');
assert.equal(engine.executeMacro(engine.macros[0], { source: 'test' }), false, 'offline runtime must reject new runs');

emitOnlineStatus(true);
await engine.replaceMacros([
  {
    id: 'send_rejected',
    name: 'Send Rejected',
    enabled: true,
    triggerTarget: { type: 'fixed', category: 'ch', ids: '1', parameter: 'mute', customAddress: '' },
    triggerOperator: '==',
    triggerEdgeMode: 'on',
    triggerValue: 1,
    executionPolicy: { overlapStrategy: 'drop', cooldownMs: 0, maxQueueDepth: 1, onDisconnect: 'abort' },
    actions: [
      { type: 'osc', target: { type: 'custom', customAddress: '/ch/4/mute' }, args: [1] },
    ],
  },
]);
sendsAccepted = false;
assert.equal(engine.executeMacro(engine.macros[0], { source: 'test' }), true, 'admission precedes transport result');
runtime = engine.getMacroRuntimeSnapshot().send_rejected;
assert.equal(runtime.failed, 1, 'a rejected send must fail the run');
assert.equal(runtime.completed, 0, 'a rejected send must never be reported as completed');
sendsAccepted = true;

await engine.replaceMacros([
  {
    id: 'invalid_fade_start',
    name: 'Invalid Fade Start',
    enabled: true,
    triggerTarget: { type: 'fixed', category: 'ch', ids: '1', parameter: 'mute', customAddress: '' },
    triggerOperator: '==',
    triggerEdgeMode: 'on',
    triggerValue: 1,
    actions: [
      {
        type: 'fade',
        target: { type: 'fixed', category: 'ch', ids: '9', parameter: 'fader', customAddress: '' },
        endVal: '-5',
        durationSec: '0.05',
      },
    ],
  },
]);
states.delete('/ch/9/fdr');
assert.equal(engine.executeMacro(engine.macros[0], { source: 'test' }), true, 'valid fade syntax should enter runtime admission');
runtime = engine.getMacroRuntimeSnapshot().invalid_fade_start;
assert.equal(runtime.failed, 1, 'a fade without a fresh start value must fail visibly');
assert.equal(runtime.completed, 0, 'an invalid fade must never be reported as completed');

await engine.replaceMacros([
  {
    id: 'unsafe_fanout',
    name: 'Unsafe Fanout',
    enabled: true,
    triggerTarget: { type: 'fixed', category: 'ch', ids: '1', parameter: 'mute', customAddress: '' },
    triggerOperator: '==',
    triggerEdgeMode: 'on',
    triggerValue: 1,
    actions: [
      {
        type: 'fade',
        target: { type: 'fixed', category: 'ch', ids: '1-65', parameter: 'fader', customAddress: '' },
        endVal: '-5',
        durationSec: '1',
      },
    ],
  },
]);
assert.equal(engine.executeMacro(engine.macros[0], { source: 'test' }), true, 'fanout validation occurs inside the admitted run');
runtime = engine.getMacroRuntimeSnapshot().unsafe_fanout;
assert.equal(runtime.failed, 1, 'unsafe ramp fanout must fail before sending');
assert.match(runtime.lastFailureReason, /exceeds 64 targets/);

console.log('Macro runtime policy simulation tests passed.');
