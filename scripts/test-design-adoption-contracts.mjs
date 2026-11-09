import assert from 'node:assert/strict';
import { declarationProblems } from '../design/conformance/run.mjs';

const good = { kitVersion: '1.4.2', deviations: [{ rule: 1, match: 'specific-control', reason: 'The measured control has a second bevel step.' }] };
assert.deepEqual(declarationProblems(good, '1.4.2'), []);
assert.match(declarationProblems({ deviations: [] }, '1.4.2').join('\n'), /must declare kitVersion/);
assert.match(declarationProblems(good, '').join('\n'), /no VERSION/);
for (const reason of [undefined, '', '  ', 42]) {
  assert.match(declarationProblems({ ...good, deviations: [{ match: 'specific-control', reason }] }, '1.4.2').join('\n'), /non-empty reason/);
}
assert.match(declarationProblems({ ...good, deviations: [{ reason: 'specific reason', match: ' ' }] }, '1.4.2').join('\n'), /non-empty match/);
console.log('Design adoption declarations: absent provenance and unjustified exceptions fail.');
