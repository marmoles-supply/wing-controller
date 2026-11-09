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
// Cargo can reuse a local-package test binary across source copies. Sharing the normal target
// left a mutant binary in a later gate despite byte-identical restored source (measured 2026-11-09).
// Keep mutation artefacts in their own namespace; never alter the regular gate's binaries.
const regularTarget = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
const env = { ...process.env, CARGO_TARGET_DIR: join(regularTarget, 'ci-mutations') };
let browser;
let sequence = 0;
async function run(command, args, { cwd = scratch, childEnv = env } = {}) {
  return await new Promise(resolveRun => {
    const child = spawn(command, args, { cwd, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
const visual = [process.execPath, ['scripts/test-design-screens.mjs', '--only', 'index']];
const soakTest = ['cargo', ['test', '-p', 'wing-controller-desktop', '--locked', '--quiet',
  'tests::a_runtime_soak_keeps_every_action_bounded_and_reports_its_latency', '--', '--ignored', '--exact']];
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
  { name: 'discarded bridge startup state', file: 'desktop/ui/meters.html',
    before: '          applyBackendStreamState(snapshot);', after: '          // Mutation probe: discard the queried backend state.',
    test: node('test-desktop-meter-bridge-status-browser.mjs'), evidence: /the answer's session must be adopted/ },
  { name: 'one changed screenshot pixel', file: ui, before: '</body>',
    after: '<div style="position:fixed;left:0;top:0;width:1px;height:1px;background:#ff0000;z-index:2147483647;pointer-events:none"></div></body>',
    test: visual, evidence: /1 of 1600000 pixels differ/ },
  { name: 'erased failure on browser restart', file: steps, before: '    if ! start_chrome; then', after: '    FAILED=()\n    if ! start_chrome; then',
    test: node('test-verification-gate.mjs'), evidence: /AssertionError/ },
  { name: 'panicking soak worker', file: main,
    before: '                        let dispatched_at = Instant::now();',
    after: '                        if macro_index == 0 { panic!("injected worker panic"); }\n                        let dispatched_at = Instant::now();',
    test: soakTest, evidence: /soak action worker must not panic/ },
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
    node('test-desktop-command-registry.mjs'), node('test-verification-gate.mjs'),
    node('test-desktop-meter-bridge-status-browser.mjs'), suite, visual, soakTest]) {
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
  // A postflight in the real workspace detects accidental contamination of its ordinary Cargo cache.
  const normal = await run(...cargo('wing-runtime'), { cwd: root, childEnv: { ...env, CARGO_TARGET_DIR: regularTarget } });
  assert.equal(normal.code, 0, `regular workspace must still pass after mutations: ${normal.output}`);
  assert.equal(normal.timedOut, false);
  assert.match(normal.output, /running [1-9]\d* tests?/, 'the cache-isolation control must execute tests');
  console.log(`Mutation checks: ${cases.length}/${cases.length} deliberate defects caught; source files untouched; regular workspace control passed.`);
} finally {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
