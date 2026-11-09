import assert from 'node:assert/strict';
import HaMath from '../src/ha/haMath.js';

const testInverseDeltaCompensation = () => {
  const result = HaMath.computeCompensation({
    ownerGainBaseline: 12,
    currentOwnerGain: 15,
    followerTrimBaseline: 4,
  });

  assert.ok(result, 'compensation result should exist');
  assert.equal(result.delta, 3);
  assert.equal(result.desiredTrim, 1);
  assert.equal(result.saturated, false);
};

const testManualTrimBaselineAdoption = () => {
  const delta = HaMath.computeGainDelta(10, 13);
  assert.equal(delta, 3);

  const adoptedBaseline = HaMath.adoptManualTrimBaseline(2, delta);
  assert.equal(adoptedBaseline, 5);

  const nextResult = HaMath.computeCompensation({
    ownerGainBaseline: 10,
    currentOwnerGain: 15,
    followerTrimBaseline: adoptedBaseline,
  });

  assert.ok(nextResult, 'next compensation result should exist');
  assert.equal(nextResult.delta, 5);
  assert.equal(nextResult.desiredTrim, 0);
};

const testOvershootClampAndRecovery = () => {
  const saturated = HaMath.computeCompensation({
    ownerGainBaseline: 20,
    currentOwnerGain: -5,
    followerTrimBaseline: 10,
  });

  assert.ok(saturated, 'saturated compensation result should exist');
  assert.equal(saturated.delta, -25);
  assert.equal(saturated.rawDesiredTrim, 35);
  assert.equal(saturated.desiredTrim, 18);
  assert.equal(saturated.overshoot, 17);
  assert.equal(saturated.saturated, true);

  const summary = HaMath.summarizeSaturation({
    'ch:1': {
      overshoot: saturated.overshoot,
      desiredTrim: saturated.desiredTrim,
    },
  });

  assert.equal(summary.saturated, true);
  assert.equal(summary.maxOvershoot, 17);
  assert.equal(summary.targets[0]?.targetKey, 'ch:1');

  const recovered = HaMath.computeCompensation({
    ownerGainBaseline: 20,
    currentOwnerGain: 12,
    followerTrimBaseline: 10,
  });

  assert.ok(recovered, 'recovered compensation result should exist');
  assert.equal(recovered.delta, -8);
  assert.equal(recovered.desiredTrim, 18);
  assert.equal(recovered.overshoot, 0);
  assert.equal(recovered.saturated, false);

  const clearedSummary = HaMath.summarizeSaturation({});
  assert.equal(clearedSummary.saturated, false);
  assert.equal(clearedSummary.targets.length, 0);
};

const testX32TrimRangeAndStep = () => {
  const result = HaMath.computeCompensation({
    ownerGainBaseline: 10,
    currentOwnerGain: 13,
    followerTrimBaseline: 2.25,
    trimMin: -12,
    trimMax: 12,
    trimStep: 0.25,
    tolerance: HaMath.getToleranceForStep(0.25),
  });

  assert.ok(result, 'x32 compensation result should exist');
  assert.equal(result.delta, 3);
  assert.equal(result.desiredTrim, -0.75);
  assert.equal(result.saturated, false);

  const saturated = HaMath.computeCompensation({
    ownerGainBaseline: 0,
    currentOwnerGain: -20,
    followerTrimBaseline: 10,
    trimMin: -12,
    trimMax: 12,
    trimStep: 0.25,
    tolerance: HaMath.getToleranceForStep(0.25),
  });

  assert.ok(saturated, 'x32 saturation result should exist');
  assert.equal(saturated.rawDesiredTrim, 30);
  assert.equal(saturated.desiredTrim, 12);
  assert.equal(saturated.saturated, true);

  const adoptedBaseline = HaMath.adoptManualTrimBaseline(-1.25, 3, 0.25);
  assert.equal(adoptedBaseline, 1.75);
};

const run = () => {
  testInverseDeltaCompensation();
  testManualTrimBaselineAdoption();
  testOvershootClampAndRecovery();
  testX32TrimRangeAndStep();
  console.log('HA compensation math tests passed.');
};

run();
