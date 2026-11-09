import assert from 'node:assert/strict';
import { buildAutomationFleetPreflight } from '../src/domain/automationSafety.js';

const target = (address) => ({ address });
const resolveAddresses = (value) => value?.address ? [value.address] : [];
const automation = (id, source, destinations, enabled = true, responseMs = 50) => ({
  id,
  enabled,
  responseMs,
  sourceTarget: target(source),
  targetItems: destinations.map((address, index) => ({ id: `${id}_${index}`, target: target(address) })),
});

const testAcyclicFleet = () => {
  const report = buildAutomationFleetPreflight([
    automation('a', '/ch/1/fdr', ['/ch/2/fdr']),
    automation('b', '/ch/3/fdr', ['/ch/4/fdr']),
  ], resolveAddresses);
  assert.deepEqual(report.errorsById, {});
};

const testTargetConflict = () => {
  const report = buildAutomationFleetPreflight([
    automation('a', '/ch/1/fdr', ['/ch/3/fdr']),
    automation('b', '/ch/2/fdr', ['/ch/3/fdr']),
  ], resolveAddresses);
  assert.match(report.errorsById.a[0], /Target conflict/);
  assert.match(report.errorsById.b[0], /Target conflict/);
};

const testCycle = () => {
  const report = buildAutomationFleetPreflight([
    automation('a', '/ch/1/fdr', ['/ch/2/fdr']),
    automation('b', '/ch/2/fdr', ['/ch/1/fdr']),
  ], resolveAddresses);
  assert.ok(report.errorsById.a.some((message) => message.includes('cycle')));
  assert.ok(report.errorsById.b.some((message) => message.includes('cycle')));
};

const testDisabledMappingsAreIgnored = () => {
  const report = buildAutomationFleetPreflight([
    automation('a', '/ch/1/fdr', ['/ch/2/fdr']),
    automation('b', '/ch/2/fdr', ['/ch/1/fdr'], false),
  ], resolveAddresses);
  assert.deepEqual(report.errorsById, {});
};

const testProjectedCommandRateLimit = () => {
  const destinations = Array.from({ length: 11 }, (_, index) => `/ch/${index + 10}/fdr`);
  const report = buildAutomationFleetPreflight([
    automation('fast_fanout', '/ch/1/fdr', destinations, true, 50),
  ], resolveAddresses);
  assert.ok(report.errorsById.fast_fanout.some((message) => message.includes('Projected command rate')));
};

const testCombinedCommandRateLimit = () => {
  const report = buildAutomationFleetPreflight([
    automation('a', '/ch/1/fdr', Array.from({ length: 6 }, (_, index) => `/ch/${index + 10}/fdr`)),
    automation('b', '/ch/2/fdr', Array.from({ length: 6 }, (_, index) => `/bus/${index + 1}/fdr`)),
  ], resolveAddresses);
  assert.ok(report.errorsById.a.some((message) => message.includes('Combined enabled automations')));
  assert.ok(report.errorsById.b.some((message) => message.includes('Combined enabled automations')));
};

testAcyclicFleet();
testTargetConflict();
testCycle();
testDisabledMappingsAreIgnored();
testProjectedCommandRateLimit();
testCombinedCommandRateLimit();
console.log('Automation safety tests passed.');
