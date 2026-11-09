import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Buffer } from 'node:buffer';

const source = await readFile(new URL('../src/osc/WingSession.js', import.meta.url), 'utf8');
const runtimeSource = source
  .replace(/^import .*;\n/gm, '')
  .replace('export default WingSession;', 'globalThis.__WingSession = WingSession;');

const nativePayloads = [];
const nativeConnects = [];
const nativeCloses = [];
const WingUdpHub = {
  WingOscModule: {},
  sendNative(_session, payload) {
    nativePayloads.push(payload);
    return true;
  },
  send() { return true; },
  registerSession() {},
  unregisterSession() {},
  closeNative(session) { nativeCloses.push(session); },
  connectNative(session, ip, port, requestId) {
    nativeConnects.push({ session, ip, port, requestId });
    return true;
  },
};

class DriverStub {
  constructor(session) { this.session = session; this.id = 'wing'; }
  handleWatchedAddressesChanged() {}
  handleNativeSocketConnected() { this.session.nativeBinaryReady = true; }
  handleIdentityApplied() {}
  startHandshake() {}
  sendControlMessage() { return true; }
}

class ConsoleProbeStub {}

const context = vm.createContext({
  Buffer,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Math,
  Date,
  Map,
  Set,
  Array,
  DataView,
  Uint8Array,
  OSC: { Message: class { pack() { return Buffer.alloc(4); } } },
  WingUdpHub,
  ConsoleProbe: ConsoleProbeStub,
  WingConsoleDriver: DriverStub,
  X32ConsoleDriver: DriverStub,
  UnsupportedConsoleDriver: DriverStub,
  detectConsoleIdentity: () => null,
  getConsoleCapabilities: () => ({}),
  isWingConsoleFamily: (family) => family === 'wing',
});

vm.runInContext(runtimeSource, context, { filename: 'WingSession.js' });
const WingSession = context.__WingSession;
const session = new WingSession({ maxMeterRequestValueBudget: 256 });
session.consoleFamily = 'wing';
session.connected = true;
session.wingOnline = true;
session.nativeBinaryReady = true;
session.nativeListenPort = 23456;

const channelAddresses = Array.from({ length: 40 }, (_, index) => `/meters/ch/${index + 1}`);
session.watchedAddressScopes.set('meters_workspace', channelAddresses);
session.watchedAddressScopes.set('engine', ['/meters/ch/40']);
session.subscribeToMeters(session.getEffectiveMeterAddresses());

const channelDescriptor = session.activeMeterRequest.find((descriptor) => descriptor.family === 'ch');
assert.equal(session.activeMeterValueCount, 104, 'critical meters must fit beside the visual meter quota');
assert.equal(session.activeVisualMeterValueCount, 96, 'visual meter requests must respect their lower quota');
assert.equal(channelDescriptor.indices.length, 13, 'one critical and twelve visual channel groups must be admitted');
assert.ok(channelDescriptor.indices.includes(40), 'engine trigger channel must survive workspace truncation');
assert.ok(session.activeMeterAddressSet.has('/meters/ch/40'), 'trigger coverage must be explicit');
assert.equal(session.droppedMeterAddresses.length, 27, 'dropped visual meters must be reported');
assert.equal(session.getRuntimeStatus().watchedMeterAddressCount, 40, 'watched count must describe addresses, not binary value cost');
assert.equal(session.getRuntimeStatus().activeMeterAddressCount, 13, 'active coverage must expose the admitted addresses');
assert.equal(session.getRuntimeStatus().activeMeterValueCount, 104, 'runtime must expose binary value cost separately');

session.watchedAddressScopes.set('meters_workspace', []);
session.watchedAddressScopes.set('engine', channelAddresses);
session.subscribeToMeters(session.getEffectiveMeterAddresses());
assert.equal(session.activeMeterValueCount, 256, 'critical trigger meters may use the full hard budget');
assert.equal(session.activeVisualMeterValueCount, 0, 'critical trigger meters must not consume the visual quota');
assert.equal(channelDescriptor.family, 'ch');
assert.equal(
  session.activeMeterRequest.find((descriptor) => descriptor.family === 'ch').indices.length,
  32,
  'the hard budget must still cap an oversized critical request',
);

let published = [];
session.on('wing_state', (event) => published.push(event));
session.publishDecodedMeter(
  { family: 'ch' },
  1,
  [256, 512, 768, 1024, 1280, 1536, 1792, 2048],
);
assert.deepEqual(
  published.map((event) => event.address),
  ['/meters/ch/1'],
  'decoder must fan out only the requested summary instead of every slot',
);

session.watchedMeterAddressSet = new Set(['/meters/chv2/1/gate_led']);
session.meterAddressPriorityMap = new Map([['/meters/chv2/1/gate_led', 0]]);
published = [];
session.publishDecodedMeter(
  { family: 'chv2' },
  1,
  Array.from({ length: 11 }, (_, index) => index * 256),
);
assert.deepEqual(
  published.map((event) => event.address),
  ['/meters/chv2/1/gate_led'],
  'a specific v2 trigger field must publish without unrelated slots or summary',
);

session.watchedAddressScopes.set('meters_workspace', channelAddresses);
session.watchedAddressScopes.set('engine', ['/meters/preamp/stagea/1']);
session.subscribeToMeters(session.getEffectiveMeterAddresses());
const sourceDescriptor = session.activeMeterRequest.find(
  (descriptor) => descriptor.family === 'source' && descriptor.deviceKey === 'stagea',
);
assert.ok(sourceDescriptor, 'whole-device source cost must still be reserved for an engine trigger');
assert.ok(session.activeMeterAddressSet.has('/meters/preamp/stagea/1'), 'source trigger must be covered');
assert.ok(nativePayloads.length >= 2, 'meter requests must be queued through the native transport');

session.watchedAddressScopes.set('meters_workspace', ['/meters/ch/1']);
session.watchedAddressScopes.set('engine', ['/meters/usb/1']);
session.subscribeToMeters(session.getEffectiveMeterAddresses());
published = [];
session.publishDecodedMeter({ family: 'source', deviceKey: 'usb' }, 1, [256]);
session.publishDecodedMeter({ family: 'source', deviceKey: 'usb' }, 1, [512]);
assert.deepEqual(
  published.map((event) => event.address),
  ['/meters/usb/1', '/meters/usb/1'],
  'source USB trigger meters must publish every packet immediately',
);
assert.deepEqual(
  published.map((event) => event.args[0]),
  [1, 2],
  'source USB trigger meters must preserve rapid consecutive transients',
);

const visualSession = new WingSession({ meterVisualPublishIntervalMs: 50 });
visualSession.consoleFamily = 'wing';
visualSession.connected = true;
visualSession.wingOnline = true;
visualSession.nativeBinaryReady = true;
visualSession.nativeListenPort = 23457;
visualSession.watchedAddressScopes.set('meters_workspace', ['/meters/ch/1']);
visualSession.subscribeToMeters(visualSession.getEffectiveMeterAddresses());
const visualPublished = [];
visualSession.on('wing_state', (event) => visualPublished.push(event));
visualSession.publishDecodedMeter({ family: 'ch' }, 1, [256, 512, 0, 0, 0, 0, 0, 0]);
visualSession.publishDecodedMeter({ family: 'ch' }, 1, [768, 1024, 0, 0, 0, 0, 0, 0]);
assert.equal(visualPublished.length, 0, 'visual-only meter events must not publish synchronously');
assert.equal(visualSession.getState('/meters/ch/1')?.[0], 4, 'visual meter cache must still update immediately to the latest value');
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(
  visualPublished.map((event) => event.args[0]).join(','),
  '4',
  'visual-only meter events must coalesce to the newest value on flush',
);
visualPublished.length = 0;
visualSession.publishDecodedMeter({ family: 'ch' }, 1, [1280, 1536, 0, 0, 0, 0, 0, 0]);
visualSession.publishDecodedMeter({ family: 'ch' }, 1, [1792, 2048, 0, 0, 0, 0, 0, 0]);
assert.equal(visualPublished.length, 0, 'visual-only meter updates must wait for the configured refresh interval after a flush');
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(visualPublished.length, 0, 'visual-only meter refresh must not exceed the configured rate');
await new Promise((resolve) => setTimeout(resolve, 45));
assert.equal(
  visualPublished.map((event) => event.args[0]).join(','),
  '8',
  'visual-only meter refresh must deliver the latest value when the frame is due',
);
visualSession.disconnect();

session.setMeterVisualPublishIntervalMs(16);
assert.equal(session.getRuntimeStatus().visualMeterPublishIntervalMs, 16, 'meter UI refresh can be configured for smooth 60 fps visuals');

session.watchedAddressScopes.clear();
session.subscribeToMeters([]);
assert.equal(session.activeMeterRequest, null, 'removing every watcher must stop meter renewal');
assert.equal(session.getRuntimeStatus().watchedMeterAddressCount, 0, 'empty watcher scopes must remain visibly empty');
assert.equal(session.getRuntimeStatus().activeMeterAddressCount, 0, 'empty watcher scopes must clear prior coverage');

const transportSession = new WingSession();
transportSession.consoleFamily = 'wing';
transportSession.connected = true;
transportSession.wingOnline = true;
transportSession.connectionGeneration = 7;
transportSession.nativeReconnectDelaysMs = [1];
assert.equal(transportSession.ensureNativeTransportConnected(), true, 'first native connect should be queued');
assert.equal(transportSession.ensureNativeTransportConnected(), false, 'in-flight native connect must be deduplicated');
assert.equal(nativeConnects.at(-1).requestId, 7, 'native connect must carry the session generation');
transportSession.handleNativeSocketConnected({ ip: transportSession.wingIp, requestId: 6 });
assert.equal(transportSession.nativeBinaryReady, false, 'stale native connect event must be ignored');
transportSession.handleNativeSocketConnected({ ip: transportSession.wingIp, requestId: 7 });
assert.equal(transportSession.nativeBinaryReady, true, 'current native connect event must set readiness');

const connectCountBeforeError = nativeConnects.length;
transportSession.handleNativeTransportError({ type: 'tcp_send', requestId: 7 });
assert.equal(transportSession.nativeBinaryReady, false, 'native transport error must invalidate readiness');
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(nativeConnects.length, connectCountBeforeError + 1, 'native transport error must schedule reconnect');
assert.equal(nativeConnects.at(-1).requestId, 7, 'reconnect must stay on the current generation');
transportSession.handleNativeSocketConnected({ ip: transportSession.wingIp, requestId: 7 });

transportSession.storeState('/ch/1/mute', [1], 'console');
transportSession.lastMeterRxAt = Date.now();
transportSession.markConsoleOffline('test timeout');
assert.equal(transportSession.stateCache.size, 0, 'offline transition must invalidate cached console state');
assert.equal(transportSession.nativeBinaryReady, false, 'offline transition must invalidate native readiness');
assert.equal(transportSession.lastMeterRxAt, 0, 'offline transition must not retain healthy meter timestamps');
assert.ok(nativeCloses.includes(transportSession), 'offline transition must close the owned native socket');
transportSession.disconnect();

const refreshSession = new WingSession({
  watchedStateRefreshIntervalMs: 10,
  maxWatchedStateRefreshPerCycle: 16,
});
refreshSession.consoleFamily = 'wing';
refreshSession.connected = true;
refreshSession.wingOnline = true;
const refreshedAddresses = [];
refreshSession.sendToWing = (address) => {
  refreshedAddresses.push(address);
  return true;
};
refreshSession.scheduleWatchedStateRefresh([
  '/ch/1/mute',
  '/ch/2/mute',
  '/meters/ch/1',
]);
assert.deepEqual(refreshedAddresses, ['/ch/1/mute'], 'watched refresh must start without an initial burst');
await new Promise((resolve) => setTimeout(resolve, 25));
assert.deepEqual(
  refreshedAddresses,
  ['/ch/1/mute', '/ch/2/mute'],
  'watched refresh must pace controls and exclude native meter addresses',
);
assert.equal(refreshSession.getRuntimeStatus().watchedRefreshPendingCount, 0, 'finished refresh must empty its queue');

refreshedAddresses.length = 0;
refreshSession.scheduleWatchedStateRefresh(['/ch/3/mute', '/ch/4/mute', '/ch/5/mute']);
refreshSession.cancelWatchedStateRefresh();
await new Promise((resolve) => setTimeout(resolve, 25));
assert.deepEqual(refreshedAddresses, ['/ch/3/mute'], 'cancelled refresh must not leak delayed network sends');

refreshSession.recordNetworkTraffic('meter_rx', 516);
refreshSession.recordNetworkTraffic('control_rx', 64);
refreshSession.recordNetworkTraffic('tx', 32);
refreshSession.networkTraffic.sampleStartedAt = Date.now() - 1100;
const trafficStatus = refreshSession.getRuntimeStatus().networkTraffic;
assert.equal(trafficStatus.totals.meterRxFrames, 1, 'meter receive frames must be counted');
assert.equal(trafficStatus.totals.controlRxPackets, 1, 'control receive packets must be counted');
assert.equal(trafficStatus.totals.txPackets, 1, 'transmit packets must be counted');
assert.ok(trafficStatus.meterRxBytesPerSecond > 0, 'meter receive byte rate must be observable');
assert.ok(trafficStatus.txBytesPerSecond > 0, 'transmit byte rate must be observable');
refreshSession.disconnect();

const boundedCacheSession = new WingSession({ maxStateCacheEntries: 256 });
for (let index = 0; index < 300; index += 1) {
  boundedCacheSession.storeState(`/test/${index}`, [index], 'test');
}
assert.equal(boundedCacheSession.stateCache.size, 256, 'state observation cache must stay bounded');
assert.equal(boundedCacheSession.stateUpdatedAt.size, 256, 'state metadata cache must be evicted in lockstep');
assert.equal(boundedCacheSession.getState('/test/0'), undefined, 'oldest state must be evicted first');

const rateLimitedSession = new WingSession({ controlCommandBurst: 16, maxControlCommandsPerSecond: 50 });
rateLimitedSession.consoleFamily = 'wing';
rateLimitedSession.connected = true;
rateLimitedSession.wingOnline = true;
for (let index = 0; index < 16; index += 1) {
  assert.equal(rateLimitedSession.sendToWing(`/ch/${index + 1}/mute`, [1]), true);
}
assert.equal(rateLimitedSession.sendToWing('/ch/17/mute', [1]), false, 'control burst overflow must fail synchronously');
assert.equal(rateLimitedSession.commandStats.rateLimited, 1, 'rate-limited command must remain operator-visible');
assert.equal(rateLimitedSession.commandStats.lastReason, 'rate_limited');

console.log('Meter runtime safety simulation tests passed.');
