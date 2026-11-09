// Renderer selection is explicit: unknown hosts and unreviewed paths cannot silently pick a passing image.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { selectRendererProfile } from './lib/design-renderer-profiles.mjs';

const catalog = JSON.parse(readFileSync(new URL('../design/screens/renderer-profiles.json', import.meta.url), 'utf8'));
const name = 'github-macos26';
const record = catalog.profiles[name];
const observed = { ...record.capturedOn, platform: record.target.platform, arch: record.target.arch };
const good = selectRendererProfile(catalog, name, observed);
assert.equal(good.name, name);
assert.equal(Object.keys(good.images).length, 4, 'exactly four reviewed native-rendering variants');
assert.deepEqual(selectRendererProfile({}, 'local', {}).images, {}, 'default local references remain unchanged');
assert.throws(() => selectRendererProfile(catalog, '../../other', observed), /Unknown visual/);
for (const field of ['platform', 'arch', 'osVersion']) {
  assert.throws(() => selectRendererProfile(catalog, name, { ...observed, [field]: 'unreviewed' }), /capture and review/, `${field} changes must refuse the old host family`);
}
assert.equal(selectRendererProfile(catalog, name, { ...observed, chromeVersion: '157.0.0.0', osVersion: '26.8.0' }).name, name,
  'version updates still have to match the exact approved pixels; version strings alone are not a visual regression');
const invalid = structuredClone(catalog);
invalid.profiles[name].images['../../unchecked.png'] = '0'.repeat(64);
assert.throws(() => selectRendererProfile(invalid, name, observed), /Invalid reviewed/);
for (const [file, expected] of Object.entries(good.images)) {
  const actual = readFileSync(new URL(`../design/screens/${name}/${file}`, import.meta.url));
  assert.equal(createHash('sha256').update(actual).digest('hex'), expected, `${file} must match the explicitly reviewed capture`);
}
console.log('Renderer profiles: explicit platform family, bounded paths and four reviewed image hashes verified.');
