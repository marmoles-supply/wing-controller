// Exercise the gate's actual Bash functions with failing child processes and a fake browser.
// No Chrome, console, Cargo or production files are touched. An exit code is part of every assertion.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const library = fileURLToPath(new URL('./lib/verification-steps.sh', import.meta.url));
const logs = mkdtempSync(join(tmpdir(), 'wing-gate-contract-'));
function run(body) {
  const result = spawnSync('bash', ['-c', `
    set -uo pipefail
    . "$1"
    FAILED=(); PASSED=0
    ${body}
  `, 'gate-contract', library], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, WING_VERIFY_LOG_DIR: logs },
  });
  assert.equal(result.error, undefined, `the gate contract must finish: ${result.error}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
try {
  const missingChrome = spawnSync(process.execPath, [fileURLToPath(new URL('./test-design-screens.mjs', import.meta.url))], {
    env: { ...process.env, WING_CHROME_BIN: join(logs, 'no-such-browser') }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(missingChrome.status, 3, 'no Chrome must mean unmeasured, never passing');
  assert.doesNotMatch(missingChrome.stdout, /WING_BROWSER_SUITE_OK/);
  run(`step 'successful child' bash -c 'echo actual-output' || exit 10
    [ "$PASSED" -eq 1 ] && [ "\${#FAILED[@]}" -eq 0 ] || exit 11`);
  assert.equal(readFileSync(join(logs, 'successful_child.log'), 'utf8'), 'actual-output\n');
  run(`if step 'failed child' bash -c 'exit 7'; then exit 12; fi
    [ "$PASSED" -eq 0 ] && [ "\${#FAILED[@]}" -eq 1 ] || exit 13`);
  run(`if step_with_timeout 1 'missing seal (Chrome)' bash -c 'echo not-finished'; then exit 14; fi
    [ "$PASSED" -eq 0 ] && [ "\${#FAILED[@]}" -eq 1 ] || exit 15`);
  run(`if step_with_timeout 1 'early seal (Chrome)' bash -c 'echo WING_BROWSER_SUITE_OK; echo unfinished'; then exit 16; fi`);
  run(`step_with_timeout 1 'finished (Chrome)' bash -c 'echo WING_BROWSER_SUITE_OK' || exit 17
    [ "$PASSED" -eq 1 ] && [ "\${#FAILED[@]}" -eq 0 ] || exit 18`);
  run(`if step_with_timeout 0 'timed out (Chrome)' bash -c 'while :; do :; done'; then exit 19; fi
    [ "$PASSED" -eq 0 ] && [ "\${#FAILED[@]}" -eq 1 ] || exit 20`);
  run(`chrome_alive() { return 1; }
    start_chrome() { return 1; }
    open_clean_tab() { exit 21; }
    if run_browser_suite 'restart fails' /no-such-test.mjs; then exit 22; fi
    [ "\${#FAILED[@]}" -eq 1 ] || exit 23`);
  run(`alive=0
    chrome_alive() { [ "$alive" -eq 1 ]; }
    start_chrome() { alive=1; }
    open_clean_tab() { :; }
    # Child invocations run outside this shell; use a file to count attempts.
    count="$WING_VERIFY_LOG_DIR/attempts"
    node() { if [ ! -f "$count" ]; then touch "$count"; return 9; fi; echo WING_BROWSER_SUITE_OK; }
    run_browser_suite 'restart succeeds' ignored.mjs || exit 24
    [ "$PASSED" -eq 1 ] && [ "\${#FAILED[@]}" -eq 0 ] || exit 25`);
  console.log('Gate behaviour: child failures, timeout, final seal, failed/successful restart and full logs verified.');
} finally {
  rmSync(logs, { recursive: true, force: true });
}
