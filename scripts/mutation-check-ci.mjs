// Put selected real defects back in an isolated source copy and require the relevant tests to fail.
// A compiler error, timeout, stale mutation target or zero-test run is NOT a caught defect.
// Run only after the full gate, never concurrently with it. No source file in the working tree is changed.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPrivateBrowser } from './lib/design-screens.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = process.env.WING_VERIFY_LOG_DIR ? resolve(process.env.WING_VERIFY_LOG_DIR) : null;
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(name =>
  /^(Cargo\.(toml|lock)|version\.json|LICENSE)$/.test(name)
  || /^(crates|desktop|scripts|design|native|assets)\//.test(name));
const scratch = mkdtempSync(join(tmpdir(), 'wing-ci-mutations-'));
const env = { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || join(root, 'target') };
let browser;
let sequence = 0;
async function run(command, args) {
  return await new Promise(resolveRun => {
    const child = spawn(command, args, { cwd: scratch, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 300_000);
    child.on('error', error => { output += String(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (logDir) {
        mkdirSync(logDir, { recursive: true });
        writeFileSync(join(logDir, `mutation-${++sequence}.log`), `${command} ${args.join(' ')}\nexit=${code}; timedOut=${timedOut}\n${output}`);
      }
      resolveRun({ code, output, timedOut });
    });
  });
}
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `mutation target must exist exactly once: ${before}`);
  return source.replace(before, after);
}
const runtime = 'crates/wing-runtime/src/lib.rs';
const main = 'desktop/src-tauri/src/main.rs';
const ui = 'desktop/ui/index.html';
const steps = 'scripts/lib/verification-steps.sh';
const cargo = (packageName, filter) => ['cargo', ['test', '-p', packageName, '--locked', '--quiet', ...(filter ? [filter] : [])]];
const node = name => [process.execPath, [`scripts/${name}`]];
const suite = node('test-desktop-library-lock-browser.mjs');
const cases = [
  { name: 'dwell bypass', file: runtime, before: 'let dwell_elapsed = !hot', after: 'let dwell_elapsed = true || !hot',
    test: cargo('wing-runtime', 'transient_dwell_fires_at_its_boundary'), evidence: /transient_dwell_fires_at_its_boundary.*FAILED/ },
  { name: 'cooldown off by one', file: runtime, before: 'elapsed.as_millis() as u64 >= cooldown_ms', after: 'elapsed.as_millis() as u64 > cooldown_ms',
    test: cargo('wing-runtime', 'transient_cooldown_expires'), evidence: /transient_cooldown_expires.*FAILED/ },
  { name: 'stale off by one', file: runtime, before: 'gap.as_millis() as u64 > trigger.policy.stale_after_ms', after: 'gap.as_millis() as u64 >= trigger.policy.stale_after_ms',
    test: cargo('wing-runtime', 'stale_gap_boundary'), evidence: /stale_gap_boundary.*FAILED/ },
  { name: 'ignored recovery failure', file: main, before: 'fs::copy(path, &backup)', after: 'Ok::<u64, std::io::Error>(0)',
    test: cargo('wing-controller-desktop', 'a_failed_recovery_copy_preserves'), evidence: /a_failed_recovery_copy_preserves.*FAILED/ },
  { name: 'temporary left after failed rename', file: main,
    before: 'if let Err(error) = std::fs::rename(&temp, target) {\n        let _ = std::fs::remove_file(&temp);',
    after: 'if let Err(error) = std::fs::rename(&temp, target) {',
    test: cargo('wing-controller-desktop', 'a_failed_backup_rename_preserves'), evidence: /a_failed_backup_rename_preserves.*FAILED/ },
  { name: 'unregistered command', file: main, transform(source) {
      const start = source.indexOf('generate_handler![');
      assert.ok(start >= 0);
      return source.slice(0, start) + replaceOnce(source.slice(start, source.indexOf(']', start)), 'timecode_as_run,', '') + source.slice(source.indexOf(']', start));
    }, test: node('test-desktop-command-registry.mjs'), evidence: /timecode_as_run/ },
  { name: 'disabled New guard', file: ui, before: 'if (liveLockBlocks("creating a macro")) return;', after: 'if (false && liveLockBlocks("creating a macro")) return;',
    test: suite, evidence: /LOCKED library-new:/ },
  { name: 'disabled Save guard', file: ui, before: 'if (liveLockBlocks("saving the draft")) return false;', after: 'if (false && liveLockBlocks("saving the draft")) return false;',
    test: suite, evidence: /LOCKED library-save-current:/ },
  { name: 'erased failure on browser restart', file: steps, before: '    if ! start_chrome; then', after: '    FAILED=()\n    if ! start_chrome; then',
    test: node('test-verification-gate.mjs'), evidence: /AssertionError/ },
];
try {
  for (const name of files) {
    if (/(^|\/)(target|node_modules|gen|dist)\//.test(name)) continue;
    const destination = join(scratch, name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, name), destination);
  }
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  // Baselines are mandatory. A suite that is already red cannot demonstrate mutation sensitivity.
  browser = await startPrivateBrowser();
  env.WING_CHROME_PORT = String(browser.port);
  for (const [command, args] of [cargo('wing-runtime'), cargo('wing-controller-desktop', 'a_failed_'),
    node('test-desktop-command-registry.mjs'), node('test-verification-gate.mjs'), suite]) {
    const result = await run(command, args);
    assert.equal(result.timedOut, false, 'baseline timed out: nothing established');
    assert.equal(result.code, 0, `baseline failed: ${result.output}`);
    if (command === 'cargo') assert.match(result.output, /running [1-9]\d* tests?/, 'baseline must execute tests');
  }
  for (const entry of cases) {
    const path = join(scratch, entry.file);
    const original = readFileSync(path, 'utf8');
    try {
      writeFileSync(path, entry.transform ? entry.transform(original) : replaceOnce(original, entry.before, entry.after));
      const [command, args] = entry.test;
      const result = await run(command, args);
      assert.equal(result.timedOut, false, `${entry.name}: timed out, no verdict`);
      assert.equal(result.code, command === 'cargo' ? 101 : 1, `${entry.name}: expected assertion failure, got ${result.code}\n${result.output}`);
      if (command === 'cargo') {
        assert.match(result.output, /running [1-9]\d* tests?/, `${entry.name}: compiler failure is not detection`);
        assert.doesNotMatch(result.output, /^error\[E\d+\]:|^error: could not compile/m, `${entry.name}: compilation failure is not detection`);
        assert.match(result.output, /panicked at/, `${entry.name}: must fail an executed assertion`);
      }
      assert.match(result.output, entry.evidence, `${entry.name}: failure must identify the intended contract\n${result.output}`);
      console.log(`CAUGHT: ${entry.name}`);
    } finally { writeFileSync(path, original); }
  }
  console.log(`Mutation checks: ${cases.length}/${cases.length} deliberate defects caught; source files untouched.`);
} finally {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
