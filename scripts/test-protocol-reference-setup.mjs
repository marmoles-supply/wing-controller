import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installProtocolReference } from './setup-protocol-reference.mjs';
import { readProtocolReference } from './lib/protocol-reference.mjs';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-protocol-guard-'));
try {
  const pdfPath = path.join(folder, 'tampered.pdf');
  const destination = path.join(folder, 'reference.txt');
  fs.writeFileSync(pdfPath, '%PDF-synthetic-invalid-input');
  assert.throws(() => readProtocolReference(destination), /setup-protocol-reference/);
  await assert.rejects(() => installProtocolReference({ pdfPath, destination }), /checksum\/size mismatch/);
  assert.equal(fs.existsSync(destination), false, 'A rejected PDF must not install an extraction');
  fs.writeFileSync(destination, 'preserve an intentionally different local reference');
  await assert.rejects(() => installProtocolReference({ pdfPath, destination }), /will not be overwritten/);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'preserve an intentionally different local reference');
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
console.log('Protocol setup rejects tampered inputs and preserves existing references (no network).');
