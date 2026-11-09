import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { differences, controlDifferences, ROLES, PROPERTIES } from '../design/workstation/check.mjs';

execFileSync(process.execPath, ['scripts/sync-design-surfaces.mjs', '--check'], { stdio: 'inherit' });
const css = readFileSync('design/surfaces.css', 'utf8');
for (const selector of ['.parameter-menu', '.win95-fieldset', '.win95-dialog', '.settings-sidebar',
  '.win95-hover-tooltip', '.win95-context-menu', '.matrix-cell', '.hud-alert-card',
  '.courtesy-notice-card', '.step-row', 'input[type="checkbox"]', 'input[type="range"]']) {
  assert.ok(css.includes(selector), `Missing production family: ${selector}`);
}
const reference = Object.fromEntries(ROLES.map(role => [role, [Object.fromEntries(PROPERTIES.map(key => [key, 'canonical']))]]));
assert.deepEqual(differences(reference, reference), []);
const altered = structuredClone(reference);
altered['.wc-card'].push({ ...altered['.wc-card'][0], boxShadow: 'none' });
assert.match(differences(reference, altered).join('\n'), /wc-card\[1\].boxShadow/);
delete altered['.wc-toolbar'];
assert.match(differences(reference, altered).join('\n'), /Missing required block/);
const button = Object.fromEntries(PROPERTIES.map(property => [property, 'canonical']));
assert.deepEqual(controlDifferences([{ button: [button] }], { button: [button] }), []);
assert.match(controlDifferences([{ button: [button] }], { button: [{ ...button, borderRadius: '16px' }] }).join('\n'), /drawing absent/);

// A new Properties category needs an explicit coverage decision; it cannot
// silently fall outside the inventory while the catalogue claims completeness.
const main = readFileSync('desktop/ui/index.html', 'utf8');
const categories = [...main.matchAll(/class="settings-nav-item[^"]*" data-tab="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(categories.sort(), ['general','matrix','meters','network','osc','timecode','interapp','profiles','contextmenu','shortcuts','hud','help','about'].sort());
const coverage = readFileSync('design/workstation/COVERAGE.md', 'utf8');
for (const category of categories) assert.ok(coverage.includes(`\`${category}\``));
console.log('Production surface extraction, coverage and second-instance drift contracts passed.');
