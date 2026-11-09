#!/usr/bin/env node
// Verify the actual packaged notices, not just their filenames.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const directory = path.resolve(process.argv[2] || '');
const expectedVersion = process.argv[3];
if (!process.argv[2] || !expectedVersion) throw Error('Usage: verify-release-legal.mjs <Legal directory> <version>');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'DEPENDENCIES.json')));
if (manifest.schemaVersion !== 1 || manifest.version !== expectedVersion || manifest.target !== 'aarch64-apple-darwin' || !manifest.packages?.length) throw Error('Legal manifest identity mismatch');
const source = fs.readFileSync(path.join(directory, 'SOURCE.txt'), 'utf8');
if (!source.includes(`/tree/v${expectedVersion}`) || !source.includes(`/THIRD_PARTY_SOURCES_v${expectedVersion}.tar.gz`)) throw Error('Legal source links do not match release');
for (const name of ['LICENSE', 'DISCLAIMER.md', 'THIRD_PARTY.md', 'THIRD-PARTY-NOTICES.txt', 'Rust-standard-library-copyright.html']) {
  if (!fs.statSync(path.join(directory, name)).size) throw Error(`Missing legal document: ${name}`);
}
let count = 0, covered = 0;
for (const p of manifest.packages) {
  const name = `${p.name}-${p.version}`;
  if (!/^[a-zA-Z0-9_.+-]+$/.test(name) || !p.notices?.length || !/^[a-f0-9]{64}$/.test(p.sourceSha256)) throw Error('Invalid dependency record');
  for (const notice of p.notices) {
    if (path.basename(notice.file) !== notice.file || hash(fs.readFileSync(path.join(directory, 'notices', name, notice.file))) !== notice.sha256) throw Error(`Notice checksum mismatch: ${name}`);
    count++;
  }
  if (p.licence.includes('MPL-2.0')) {
    if (hash(fs.readFileSync(path.join(directory, 'covered-sources', name + '.crate'))) !== p.sourceSha256) throw Error(`Covered source mismatch: ${name}`);
    covered++;
  }
}
console.log(`Legal verified: ${manifest.packages.length} dependencies, ${count} notices, ${covered} covered-source archives; v${expectedVersion}.`);
