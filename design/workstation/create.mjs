#!/usr/bin/env node
// Run from the distributed kit. Refuses existing destinations; verifies every
// manifest entry before writing so a mixed kit cannot become a new project.
import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] && resolve(process.argv[2]);
if (!output) throw new Error('Usage: node workstation/create.mjs /path/to/new-project');
if (existsSync(output)) throw new Error(`Destination exists; nothing written: ${output}`);
const manifest = readFileSync(join(kit, 'MANIFEST.sha256'), 'utf8');
const entries = [];
const names = new Set();
for (const line of manifest.split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  if (!/^[a-f0-9]{64}  \S.*$/.test(line)) throw new Error('Malformed kit manifest entry');
  const name = line.slice(66);
  if (names.has(name)) throw new Error(`Duplicate kit manifest entry: ${name}`);
  names.add(name);
  entries.push([line.slice(0, 64), name]);
}
if (!entries.length) throw new Error('Empty kit manifest');
for (const [hash, name] of entries) {
  if (isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw new Error('Invalid manifest path');
  const bytes = readFileSync(join(kit, name));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Kit was modified: ${name}`);
}
for (const [, name] of entries) {
  const target = join(output, 'wing-kit', name);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(kit, name), target);
}
copyFileSync(join(kit, 'MANIFEST.sha256'), join(output, 'wing-kit/MANIFEST.sha256'));
const version = readFileSync(join(kit, 'VERSION'), 'utf8').trim();
writeFileSync(join(output, 'index.html'), readFileSync(join(kit, 'workstation/index.html'), 'utf8').replaceAll('../', './wing-kit/'));
writeFileSync(join(output, 'AGENTS.md'), `# WING workstation contract\n\nRead wing-kit/workstation/README.md first. Keep wing-kit immutable. Change the product content and data adapter in index.html; reuse its wc-* blocks. Do not replace the shared palette, type scale, bevels, spacing or controls. Add domain layout only. Verify both themes at 420, 820 and 1280 pixels. Run \`node wing-kit/workstation/check.mjs index.html\`. A green rules report is not proof of visual resemblance.\n`);
writeFileSync(join(output, 'wing-kit.json'), JSON.stringify({ version, profile: 'workstation', entry: 'index.html' }, null, 2) + '\n');
console.log(`Created ${output} with WING kit ${version}. Open index.html; see wing-kit/workstation/README.md.`);
