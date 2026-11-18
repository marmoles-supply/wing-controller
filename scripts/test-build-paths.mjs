// Exercise the real shell sanitiser through rustc, including a symlinked checkout
// and a physical directory containing spaces, percent and hash characters.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = realpathSync(mkdtempSync(join(tmpdir(), 'wing-paths-')));
try {
  const home = join(folder, 'fixture home');
  const physical = join(home, 'external volume % #', 'project');
  const logical = join(home, 'checkout');
  mkdirSync(join(physical, 'scripts'), { recursive: true });
  symlinkSync(physical, logical, 'dir');
  copyFileSync(fileURLToPath(new URL('./build-paths.sh', import.meta.url)), join(physical, 'scripts/build-paths.sh'));
  const flags = execFileSync('bash', ['-c', '. "$1"; wing_export_sanitised_build_paths; printf "%s" "$CARGO_ENCODED_RUSTFLAGS"', 'wing-path-test', join(logical, 'scripts/build-paths.sh')], {
    env: { ...process.env, HOME: home, CARGO_ENCODED_RUSTFLAGS: '--cfg=wing_path_fixture' }, encoding: 'utf8',
  }).split('\x1f');
  assert.equal(flags[0], '--cfg=wing_path_fixture', 'caller flags must survive');
  writeFileSync(join(physical, 'probe.rs'), 'fn main() { println!("{}", file!()); }\n');
  for (const [kind, root] of [['logical', logical], ['physical', physical]]) {
    const executable = join(folder, `probe-${kind}`);
    execFileSync('rustc', ['--crate-name', 'wing_path_probe', ...flags, join(root, 'probe.rs'), '-o', executable]);
    assert.equal(execFileSync(executable, [], { encoding: 'utf8' }).trim(), '/build/src/probe.rs', `${kind} source path must be sanitised with the repository mapping taking precedence over HOME`);
    assert.ok(!readFileSync(executable).includes(Buffer.from(home)), `${kind} binary must not retain the fixture home`);
  }
  // The actual artefact auditor must reject each private path family, including
  // named macOS volumes. A synthetic blob needs no release binary or signer.
  const fixture = join(folder, 'leaking-binary');
  for (const prefix of ['/Users/', '/home/', '/Volumes/']) {
    writeFileSync(fixture, `fixture ${prefix}synthetic-builder/project/main.rs`);
    let output = '';
    try { execFileSync(process.execPath, [fileURLToPath(new URL('./audit-binary-shield.mjs', import.meta.url)), fixture], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (error) { assert.equal(error.status, 1); output = `${error.stdout}${error.stderr}`; }
    assert.match(output, /build-machine path\(s\)/, 'the real auditor must name the path finding');
    assert.ok(!output.includes('synthetic-builder'), 'audit diagnostics must not print the private path');
  }
  console.log('build paths: real rustc output sanitised for logical/physical spaced paths; artefact auditor rejects all private path families');
} finally {
  rmSync(folder, { recursive: true, force: true });
}
