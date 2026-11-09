import assert from 'node:assert/strict';
import X32Protocol from '../src/osc/x32Protocol.js';

const testMuteTranslation = () => {
  const outgoing = X32Protocol.canonicalToNative('/ch/1/mute', [1]);
  assert.equal(outgoing.address, '/ch/01/mix/on');
  assert.equal(outgoing.args[0], 0);

  const incoming = X32Protocol.nativeToCanonical('/ch/01/mix/on', [1]);
  assert.equal(incoming.address, '/ch/1/mute');
  assert.equal(incoming.args[0], 0);
};

const testFaderTranslation = () => {
  const outgoing = X32Protocol.canonicalToNative('/bus/2/fdr', [-10]);
  assert.equal(outgoing.address, '/bus/02/mix/fader');
  assert.ok(outgoing.args[0] > 0 && outgoing.args[0] < 1);

  const incoming = X32Protocol.nativeToCanonical('/bus/02/mix/fader', [outgoing.args[0]]);
  assert.equal(incoming.address, '/bus/2/fdr');
  assert.ok(Math.abs(incoming.args[0] - (-10)) < 0.2);
};

const testPanTranslation = () => {
  const outgoing = X32Protocol.canonicalToNative('/aux/3/pan', [25]);
  assert.equal(outgoing.address, '/auxin/03/mix/pan');
  assert.equal(outgoing.args[0], 0.25);

  const incoming = X32Protocol.nativeToCanonical('/auxin/03/mix/pan', [-0.5]);
  assert.equal(incoming.address, '/aux/3/pan');
  assert.equal(incoming.args[0], -50);
};

const testSendTranslation = () => {
  const outgoing = X32Protocol.canonicalToNative('/ch/5/send/7/on', [1]);
  assert.equal(outgoing.address, '/ch/05/mix/07/on');
  assert.equal(outgoing.args[0], 1);

  const incoming = X32Protocol.nativeToCanonical('/ch/05/mix/07/level', [0.5]);
  assert.equal(incoming.address, '/ch/5/send/7/lvl');
  assert.ok(Number.isFinite(incoming.args[0]));
};

const testMainStereoTranslation = () => {
  const outgoing = X32Protocol.canonicalToNative('/main/1/pan', [-25]);
  assert.equal(outgoing.address, '/main/st/mix/pan');
  assert.equal(outgoing.args[0], -0.25);

  const incoming = X32Protocol.nativeToCanonical('/main/st/config/name', ['LR']);
  assert.equal(incoming.address, '/main/1/name');
  assert.equal(incoming.args[0], 'LR');
};

const testInputTrimTranslation = () => {
  const outgoing = X32Protocol.canonicalToNative('/ch/9/in/set/$g', [6]);
  assert.equal(outgoing.address, '/ch/09/preamp/trim');
  assert.equal(outgoing.args[0], 6);

  const incoming = X32Protocol.nativeToCanonical('/auxin/04/preamp/trim', [-3.25]);
  assert.equal(incoming.address, '/aux/4/in/set/$g');
  assert.equal(incoming.args[0], -3.25);
};

const testUnsupportedMetering = () => {
  const outgoing = X32Protocol.canonicalToNative('/meters/ch/1', []);
  assert.equal(outgoing.unsupported, true);
};

const run = () => {
  testMuteTranslation();
  testFaderTranslation();
  testPanTranslation();
  testSendTranslation();
  testMainStereoTranslation();
  testInputTrimTranslation();
  testUnsupportedMetering();
  console.log('X32 protocol mapping tests passed.');
};

run();
