// The gate's contract *about* the conformance suite: it must run, it must go red on every known-bad fixture, and it
// must stay green on the one that conforms.
//
// The suite's own proof is `design/conformance/self-test.mjs`; this file is what the verification gate runs, so a
// weakened self-test cannot quietly become ceremony — it asserts the literal proof lines, one per rule that can be
// checked, and it asserts that the seventh is reported as NOT CHECKED rather than as a pass.
//
// It drives Chrome indirectly: the self-test reuses the gate's browser on the debug port and only starts one when
// that port is silent.
//
// Run: node scripts/test-design-conformance-browser.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF_TEST = resolve(HERE, '../design/conformance/self-test.mjs');

let output = '';
let status = 0;
try {
  output = execFileSync('node', [SELF_TEST], { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  status = error.status === undefined ? -1 : error.status;
  output = `${error.stdout || ''}${error.stderr || ''}`;
  console.error(output);
  if (status === 3) {
    assert.fail('the conformance self-test could not run: there is no browser on the debug port and none could be started');
  }
  assert.fail(`the conformance self-test exited ${status}; its output is above`);
}
process.stdout.write(output);

// Every rule with a fixture proves it can fail, and proves it by name.
const proofs = [
  'FAIL rule 1 mixed-edges',
  'FAIL rule 1 rounded',
  'FAIL rule 1 two-shapes',
  'FAIL rule 2 not-in-well',
  'FAIL rule 3 unknown-colour',
  'FAIL rule 4 unknown-token',
  'FAIL rule 4 frozen-element',
  'FAIL rule 4 redefined-token',
  'FAIL rule 5 disabled-control',
  'FAIL rule 5 silent-refusal',
  'FAIL rule 5 generic-refusal',
  'FAIL rule 6 two-states',
  'FAIL rule 6 colour-only-state',
];
for (const proof of proofs) {
  assert.ok(output.includes(proof), `the self-test did not prove "${proof}"`);
}
assert.ok(output.includes('rgb(255, 0, 255)'), 'the literal-colour fixture must be named by its measured value');
assert.ok(output.includes('--space-9'), 'the missing-token fixture must be named by the token it asks for');
assert.ok(output.includes('CONFORMANCE OK, 0 failures'), 'the conforming fixture must stay green');
assert.ok(output.includes('two-theme-columns.html'), 'the page that paints both themes at once must be run: it is the shape ' +
  'a rule that resolved the kit\'s two steps once for the whole page judged wrongly');
assert.ok(output.includes('rule 7 status                              → NOT CHECKED'),
  'rule 7 must be reported as not checked, never as a pass');
assert.ok(output.includes('kitVersion drift                           → FAIL'),
  'a declared kit version that does not match the copy beside it must be caught');
assert.ok(output.includes('declared deviation                         → DECLARED'),
  'a declared deviation must be reported as declared rather than silently allowed');
assert.ok(!output.includes('MISSED'), 'a fixture that must fail was missed');
assert.ok(!output.includes('FAILED A PAGE THAT CONFORMS'), 'the conforming fixture went red');
assert.ok(output.includes('WING_CONFORMANCE_SELF_TEST_OK'), 'the self-test did not print its seal');

console.log('the conformance suite fails on every known-bad fixture and stays green on the conforming one');
console.log('WING_BROWSER_SUITE_OK');
