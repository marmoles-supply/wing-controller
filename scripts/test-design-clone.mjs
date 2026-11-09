import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const temp = mkdtempSync(join(tmpdir(), 'wing-clone-contract-'));
try {
  const kit = join(temp, 'kit');
  mkdirSync(join(kit, 'workstation'), { recursive: true });
  copyFileSync('design/workstation/create.mjs', join(kit, 'workstation/create.mjs'));
  const destination = join(temp, 'consumer');
  const validLine = `${'0'.repeat(64)}  missing.txt`;
  for (const [manifest, reason] of [
    [`${validLine}\nmalformed entry\n`, /Malformed kit manifest/],
    [`${validLine}\n${validLine}\n`, /Duplicate kit manifest/],
  ]) {
    writeFileSync(join(kit, 'MANIFEST.sha256'), manifest);
    const result = spawnSync(process.execPath, [join(kit, 'workstation/create.mjs'), destination], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, reason);
    assert.equal(existsSync(destination), false, 'validate the whole manifest before creating any output');
  }
  const created = spawnSync(process.execPath, ['design/package/workstation/create.mjs', destination], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  const pinned = JSON.parse(readFileSync(join(destination, 'wing-kit.json'), 'utf8'));
  assert.equal(pinned.version, readFileSync('design/VERSION', 'utf8').trim());
  assert.ok(readFileSync(join(destination, 'index.html'), 'utf8').includes('./wing-kit/workstation.css'));
  const twice = spawnSync(process.execPath, ['design/package/workstation/create.mjs', destination], { encoding: 'utf8' });
  assert.notEqual(twice.status, 0);
  assert.match(twice.stderr, /Destination exists/);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log('Kit clone validates all manifest lines, pins its version and never overwrites a destination.');
