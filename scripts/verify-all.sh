#!/usr/bin/env bash
# The verification gate for this project.
#
# Before this existed, the session baseline ran only TypeScript, HA maths and X32
# mapping — none of which touch the shipping desktop app. The desktop tree was once
# left not compiling for hours and nothing noticed, because `cargo test` was never
# part of any routine. This script runs everything that can fail, in one command.
#
# Usage: ./scripts/verify-all.sh [--quick] [--fast]
#   --quick  the everyday loop: everything except the browser suites (typecheck, window syntax,
#            Node tests except named *-browser.mjs suites, the strict Maillot audit and the Rust
#            workspace). ~40 s instead of ~7 minutes, because the ~20 `test-*-browser.mjs` runs are
#            ~90 % of the wall clock. The **full** gate is still required before a build: the browser
#            suites are where the UI contracts live, and the last three regressions in this tree were
#            caught there.
#            The design screenshot check also starts a private Chrome when available.
#   --fast   skip the Rust test suite (still runs typecheck, syntax and every Node test)

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FAST=0
QUICK=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --quick) QUICK=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# One gate at a time, per machine. This is a lock, not ceremony.
#
# Two `verify-all.sh` runs at once fabricate failures that are nobody's bug, and that cost three
# rounds of wrong diagnosis:
#   * The MIDI virtual-port tests in `desktop/src-tauri/src/inter_app_midi.rs` create ports with
#     FIXED names in CoreMIDI's namespace, and that namespace belongs to the machine's MIDI session,
#     not to the process. Measured 2026-10-05: two test processes at once -> 6 of 6 runs red; alone
#     -> 20 of 20 green. Those tests already serialise themselves with a `flock` (`MidiPortNamespace`,
#     same file), but a lock inside the test cannot stop the second gate from starting that suite.
#   * Two gates also fight over the single headless Chrome on port 9223: `start_chrome` SIGKILLs
#     whatever holds the port, so one gate kills the other's browser in the middle of a suite.
# A third mode is independent and deliberately NOT addressed here: the on-demand
# `com.apple.midiserver` transiently refuses a client in 0.3-0.4 % of runs. No lock fixes that one,
# and this one does not pretend to.
#
# `scripts/gate-lock.mjs` holds the claim: a directory whose `owner.json` names the owning pid, the
# same idiom as `takeLock` in `scripts/mutation-check-interapp.mjs`. `mkdir` is atomic, and
# `flock(1)` does not exist on macOS. A claim whose process is gone is taken over, never waited on.
# The wait is bounded: a gate that hangs for ever is worse than one that refuses, so this one
# refuses and says who holds it.
#
# The release runs from an EXIT trap, so it happens on success, on a failed check, on Ctrl-C and on
# any abort. A lock left behind by a SIGKILL is reclaimed by the next gate, which is the only thing
# standing between "this gate was killed" and "no gate ever runs again".
GATE_LOCK_HELPER="$ROOT_DIR/scripts/gate-lock.mjs"
GATE_LOCK_WAIT_SECONDS="${WING_GATE_LOCK_WAIT_SECONDS:-600}"
GATE_LOCK_HELD=0

gate_lock_release() {
  if [ "$GATE_LOCK_HELD" -eq 1 ]; then
    GATE_LOCK_HELD=0
    node "$GATE_LOCK_HELPER" release --pid "$$" || true
  fi
}

gate_lock_interrupted() {
  trap - INT TERM HUP
  gate_lock_release
  echo "verify-all.sh: interrupted before the gate finished; the machine lock is released." >&2
  exit 130
}

trap gate_lock_release EXIT
trap gate_lock_interrupted INT TERM HUP

# Armed *before* the claim on purpose: a signal can land in the instant between the helper's `mkdir`
# and the next line of this script, and that instant would otherwise leak the lock. The trap is safe
# to arm early because `release` removes the lock only when `owner.json` names this pid.
GATE_LOCK_HELD=1
if ! node "$GATE_LOCK_HELPER" acquire --pid "$$" --timeout-seconds "$GATE_LOCK_WAIT_SECONDS" \
  --command "./scripts/verify-all.sh $*"; then
  # The helper has already said who holds the lock, since when and how long it waited. Nothing ran,
  # and no lock is ours to release.
  GATE_LOCK_HELD=0
  exit 3
fi

FAILED=()
BROWSER_TESTS_RUN=0
BROWSER_TESTS_SKIPPED=0
PASSED=0

step() {
  local label="$1"
  shift
  printf '%-46s' "$label"
  local started=$SECONDS
  if output="$("$@" 2>&1)"; then
    # The seconds are printed because a gate that "takes ages" has to say which step is the age:
    # the browser suites were 90 % of this one's wall clock, and `--quick` exists because of that.
    printf 'PASS (%ss)\n' "$((SECONDS - started))"
    PASSED=$((PASSED + 1))
    # A step that exits 0 while saying it skipped something is not the same as a step that did the work,
    # and this line used to throw its output away: nobody ever saw the release-note suite's "skipped N
    # note(s)" or a suite's "not landed yet" (audit 2026-10-02, S8).
    note_from_output "$output"
  else
    printf 'FAIL (%ss)\n' "$((SECONDS - started))"
    FAILED+=("$label")
    # The head carries the failing addresses; the tail used to be all the operator saw (S9).
    show_failure_output "$output"
  fi
}

# Anything a passing step admits it did not check, kept visible next to its PASS.
note_from_output() {
  local output="$1"
  echo "$output" | grep -iE 'skipp|unverified|not build-verified|not landed|no chrome|not checked|no browser' | head -n 5 | sed 's/^/    note: /' || true
}

# A failure's first lines, in full in a log file, because a suite prints its failures before its summary.
show_failure_output() {
  local output="$1"
  local log_file
  log_file="$(mktemp -t wing-gate-failure)" || log_file=""
  if [ -n "$log_file" ]; then
    printf '%s\n' "$output" >"$log_file"
    echo "$output" | head -n 24 | sed 's/^/    /'
    echo "    (full output: $log_file)"
  else
    echo "$output" | head -n 24 | sed 's/^/    /'
  fi
}

# A browser test that hangs (a native dialog waiting for input, a moved element) must fail the
# gate instead of blocking the session forever. macOS has no `timeout` by default, and `perl`/`gtimeout`
# are not assumed to exist either.
#
# The deadline is polled in this shell rather than run as a `( sleep N; kill )` watcher subshell. That
# watcher was the reason a finished gate went on "running" for three more minutes: its `sleep 180` is a
# child of the script, it survives the kill of its subshell, it holds the write end of whatever pipe the
# gate was piped into — and `tail`, and the background job, wait for every writer to close. Measured:
# the steps of a `--quick` run add up to 15 s while the pipeline took 3 m 10 s, with 6 s of CPU. Nothing
# was slow; the gate was holding itself open.
step_with_timeout() {
  local seconds="$1"
  shift
  local label="${1:-}"
  shift
  printf '%-46s' "$label"
  local started=$SECONDS
  local log_file
  log_file="$(mktemp -t wing-gate-step)"
  "$@" >"$log_file" 2>&1 &
  local pid=$!
  local deadline=$((SECONDS + seconds))
  while kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do
    sleep 0.2
  done
  local timed_out=0
  if kill -0 "$pid" 2>/dev/null; then
    timed_out=1
    kill -9 "$pid" 2>/dev/null
  fi
  wait "$pid"
  local status=$?
  local output
  output="$(cat "$log_file" 2>/dev/null || true)"
  # A browser suite has to say it finished. An exit status of 0 is not enough: sixteen of them used to
  # print "SKIP: no Chrome…" and exit 0 when the browser was wedged or absent, and this gate booked that
  # as PASS — eighteen UI suites reported green having asserted nothing (audit 2026-10-02, S1). Every
  # suite now ends with this seal; a run that cannot reach it is a run that did not happen.
  # Only the Chrome suites carry the seal; a plain Node test has nothing to seal and must not be asked
  # for one. The browser calls all name Chrome in their label (including the retry's).
  local needs_seal=0
  case "$label" in *Chrome*) needs_seal=1 ;; esac
  local sealed=0
  case "$output" in *WING_BROWSER_SUITE_OK*) sealed=1 ;; esac
  if [ "$status" -eq 0 ] && { [ "$needs_seal" -eq 0 ] || [ "$sealed" -eq 1 ]; }; then
    printf 'PASS (%ss)\n' "$((SECONDS - started))"
    PASSED=$((PASSED + 1))
    note_from_output "$output"
    rm -f "$log_file"
  else
    if [ "$status" -eq 0 ]; then
      printf 'FAIL (%ss, exited 0 without finishing)\n' "$((SECONDS - started))"
    else
      printf 'FAIL (%ss, exit %s%s)\n' "$((SECONDS - started))" "$status" "$([ "$timed_out" -eq 1 ] && echo ", timed out after ${seconds}s")"
    fi
    FAILED+=("$label")
    show_failure_output "$output"
  fi
  return "$status"
}

# Headless Chrome on this machine wedges after roughly ninety seconds of page activity — its browser
# process shows the same ObjC class-lookup path as the application's own hang, its DevTools port stops
# answering and its renderer disappears (`docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md`, "The same wedge
# hits Chrome"). A browser test that dies with the browser is not a red contract, so the gate notices
# and runs that test once more on a fresh browser instead of reporting a failure that is not one. A
# test that fails while the browser is alive is reported as it always was: this only handles death.
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_PORT=9223
# Filled in by `start_chrome`, which uses a **fresh** directory every time: a Chrome that was SIGKILLed
# leaves `SingletonLock` behind, and the next instance pointed at the same directory refuses to start
# ("Failed to create a ProcessSingleton"). Reusing one directory turned a single dead browser into nine
# "no browser" failures, which the gate reported as if the UI contracts had not run.
CHROME_GATE_PROFILE=""

chrome_alive() {
  curl -s --max-time 2 "http://127.0.0.1:${CHROME_PORT}/json" > /dev/null 2>&1
}

start_chrome() {
  [ -x "$CHROME_BIN" ] || return 1
  # A wedged browser ignores SIGTERM — that is what wedged means here — so the port has to be freed with
  # SIGKILL before a new instance can bind it. The first version of this used a plain `pkill`, the
  # wedged process survived, every new Chrome exited because the port was taken, and the gate reported
  # the whole UI layer as SKIPPED: a browser outage must never look like missing coverage.
  pkill -9 -f "remote-debugging-port=${CHROME_PORT}" > /dev/null 2>&1 || true
  # The line above only matches processes carrying the port flag, and a wedged browser's helpers do not
  # always keep it: on 2026-10-01 the gate restarted its browser twice and the retry still timed out at
  # 180 s three times, while killing every process of its own profile by hand cleared the wedge at once.
  # The gate's profile directory is the one string only its instances carry, so it is matched as well —
  # and the guard keeps an empty value from turning into a `pkill` that matches everything.
  if [ -n "$CHROME_GATE_PROFILE" ]; then
    pkill -9 -f "$CHROME_GATE_PROFILE" > /dev/null 2>&1 || true
  fi
  if [ -n "$CHROME_GATE_PROFILE" ]; then
    rm -rf "$CHROME_GATE_PROFILE" > /dev/null 2>&1 || true
  fi
  CHROME_GATE_PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/wing-chrome-gate.XXXXXX")"
  # Bounded wait for the port to come free, because a new instance that cannot bind exits at once.
  for _ in $(seq 1 20); do
    if ! curl -s --max-time 1 "http://127.0.0.1:${CHROME_PORT}/json/version" > /dev/null 2>&1; then break; fi
    sleep 0.5
  done
  nohup "$CHROME_BIN" --headless=new --remote-debugging-port="${CHROME_PORT}" \
    --user-data-dir="$CHROME_GATE_PROFILE" about:blank > /dev/null 2>&1 &
  curl -s --retry 25 --retry-connrefused --retry-delay 1 --max-time 35 \
    "http://127.0.0.1:${CHROME_PORT}/json/version" > /dev/null 2>&1
}

# A previous run leaves its tab pointing at the :8080 server, which no longer exists. The tests pick
# it by the URL suffix, reload and find a page with no DOM: five tests failed because of this and it
# looked like a bug in the code. Those tabs are closed and a `file://` one is guaranteed.
# Tests that attach to an existing tab use the FIRST one with `index.html`, so an old tab — from
# another run or from a test that died before closing its own — decided the state the next one saw:
# `test-desktop-macro-edit-browser.mjs` failed that way inside the gate (it attached to a tab with an
# empty macro library and found no row at all).
# EVERY tab of both windows is closed and one clean tab is opened.
open_clean_tab() {
  local stale_tabs
  stale_tabs="$(curl -s --max-time 2 "http://127.0.0.1:${CHROME_PORT}/json" | node -e "let d='';process.stdin.on('data',(c)=>{d+=c}).on('end',()=>{try{for(const t of JSON.parse(d)){if(t.type!=='page')continue;const u=String(t.url||'');if(u.startsWith('http://127.0.0.1:8080')||u.includes('/desktop/ui/'))console.log(t.id)}}catch(_){}})" 2>/dev/null || true)"
  for stale in $stale_tabs; do
    curl -s "http://127.0.0.1:${CHROME_PORT}/json/close/${stale}" > /dev/null 2>&1 || true
  done
  curl -s -X PUT "http://127.0.0.1:${CHROME_PORT}/json/new?file://$(pwd)/desktop/ui/index.html" > /dev/null 2>&1 || true
  sleep 1
}

echo "=============================================="
echo "  WING CONTROLLER · verification gate"
echo "=============================================="

step "TypeScript" npx tsc --noEmit

step "HTML script syntax" node -e '
const fs = require("fs"), vm = require("vm");
// The shared modules the windows load with `<script src>` are checked too: a syntax error in one of
// them breaks every window that loads it, and an inline-only check would never look at it.
for (const file of ["desktop/ui/field-editing.js"]) {
  new vm.Script(fs.readFileSync(file, "utf8"));
  console.log(`${file} OK`);
}
for (const file of ["desktop/ui/index.html", "desktop/ui/meters.html", "desktop/ui/timecode.html"]) {
  const content = fs.readFileSync(file, "utf8");
  const blocks = /<script(?:\s+src="[^"]*")?>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = blocks.exec(content)) !== null) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
  console.log(`${file} OK`);
}'

# Every Node test in scripts/ is picked up automatically, so a new test cannot be
# forgotten. Browser-driven tests need Chrome on the debug port and are skipped with a
# note when that is not available:
#   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
#     --remote-debugging-port=9223 --user-data-dir=/tmp/wing-chrome about:blank
# One of them drives the real window, so make sure a tab is showing it instead of relying on the
# operator having opened it by hand. The gate now starts the browser itself when the port is silent and
# restarts it when a test dies with it, so the UI contract layer cannot be skipped or misreported just
# because a headless Chrome went away mid-run.
#
# `--quick` does not touch the browser at all: on this machine bringing headless Chrome up takes about
# three minutes when it is wedged (docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md), and that wait landed on
# the everyday loop even though every Chrome suite was being skipped. The prologue is the browser's.
if [ "$QUICK" -eq 0 ]; then
  if ! chrome_alive; then
    start_chrome || true
  fi
  if chrome_alive; then
    open_clean_tab
  fi
fi
for test_file in scripts/test-*.mjs; do
  name="$(basename "$test_file")"
  if [[ "$name" == *-browser.mjs ]]; then
    # `--quick` leaves the Chrome suites out: they are ~90 % of this gate's wall clock and the
    # everyday loop does not need them. The full gate is what runs before a build, and the summary
    # says how many were left out so a green `--quick` is never read as a green full gate.
    if [ "$QUICK" -eq 1 ]; then
      BROWSER_TESTS_SKIPPED=$((BROWSER_TESTS_SKIPPED + 1))
      continue
    fi
    # A browser that died between two tests is brought back **before** the test is blamed for it. This is
    # the piece the first two attempts missed: the restart lived only on the retry path *after* a
    # failure, so a death between tests was reported as nine tests that "could not be started", which
    # looks like missing coverage rather than a browser that went away.
    if ! chrome_alive; then
      start_chrome || true
      if chrome_alive; then
        echo "                                             a fresh browser: the previous one died between tests"
        open_clean_tab
      fi
    fi
    # This machine's headless Chrome also dies after roughly ten minutes of cumulative work (its browser
    # process wedges and its renderer disappears), so it is rotated between tests, never during one.
    if [ "$BROWSER_TESTS_RUN" -gt 0 ] && [ $((BROWSER_TESTS_RUN % 8)) -eq 0 ] && chrome_alive; then
      echo "                                             a fresh browser for the next tests (headless Chrome dies after ~10 minutes here)"
      start_chrome || true
      open_clean_tab
    fi
    BROWSER_TESTS_RUN=$((BROWSER_TESTS_RUN + 1))
    if chrome_alive; then
      if ! step_with_timeout 180 "Node test: ${name} (Chrome)" node "$test_file"; then
        # A browser that died under the test is not a verdict: the test is run again on a fresh one, up
        # to two more times. Only a failure with the browser still alive, or a failure that survives
        # both restarts, is reported as a failed contract.
        attempt=0
        while [ "$attempt" -lt 2 ] && ! chrome_alive; do
          attempt=$((attempt + 1))
          echo "                                             the browser died with the test: restarting it and running this one again (${attempt}/2)"
          # The attempt that just failed was the browser's, not the contract's, so its failure entry is
          # replaced by the retry's result.
          FAILED=("${FAILED[@]:0:${#FAILED[@]}-1}")
          if ! start_chrome; then break; fi
          open_clean_tab
          if step_with_timeout 180 "Node test: ${name} (Chrome, after a browser restart)" node "$test_file"; then
            break
          fi
        done
      fi
    else
      # No browser at all: a machine without Chrome skips the layer, but a machine that has the binary
      # and cannot start it is a failure — the UI contracts did not run, and that is not a skip.
      if [ -x "$CHROME_BIN" ]; then
        printf '%-46s%s\n' "Node test: ${name}" "FAIL (Chrome is installed but could not be started on port ${CHROME_PORT})"
        FAILED+=("Node test: ${name} (no browser)")
      else
        # A machine without Chrome used to skip the whole UI layer and still print ALL GREEN, which
        # contradicts this project's own rule ("it fails rather than skips when the browser cannot be
        # started"). The layer that catches the UI regressions did not run; that is a failure.
        printf '%-46s%s\n' "Node test: ${name}" "FAIL (no Chrome on port ${CHROME_PORT} and no browser to start)"
        FAILED+=("Node test: ${name} (no browser at all)")
      fi
    fi
    continue
  fi
  step_with_timeout 180 "Node test: ${name}" node "$test_file"
done

step "Maillot path audit (strict)" node scripts/wing-maillot-path-audit.mjs --strict

if [ "$FAST" -eq 0 ]; then
  step "Rust workspace tests" cargo test --workspace --quiet
else
  printf '%-46s%s\n' "Rust workspace tests" "SKIP (--fast)"
fi

echo "----------------------------------------------"
if [ "${#FAILED[@]}" -eq 0 ]; then
  if [ "$QUICK" -eq 1 ]; then
    # Not "ALL GREEN": under --quick a green line is not the gate, and an independent review found that the label
    # could be read as one — the count of skipped browser suites is on the same line, but the word was doing the
    # talking. It says what it is now.
    echo "QUICK GREEN · ${PASSED} checks passed · ${BROWSER_TESTS_SKIPPED} browser suites SKIPPED (--quick:"
    echo "            this is the everyday loop, not the gate. Run ./scripts/verify-all.sh before a build.)"
  else
    echo "ALL GREEN · ${PASSED} checks passed"
  fi
  # Said out loud because it is the thing this gate does *not* do: an independent review found that the source gate
  # was being read as if it covered the shipped artefacts, and the release path that does cover them is
  # `release.sh`, which runs `verify-install.sh` (DMG, signatures, entitlements measured on the installed copy).
  echo "            source gate only: it does not verify the DMG or the installed application."
  exit 0
fi
echo "FAILURES (${#FAILED[@]}):"
for label in "${FAILED[@]}"; do
  echo "  - ${label}"
done
exit 1
