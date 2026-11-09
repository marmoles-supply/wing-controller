#!/usr/bin/env bash
# Plan B, the automated half: the realtime burst against a connected console.
#
# The project already had seven hardware-gated tests, each behind its own environment variable and each
# printing what it measured. Nobody had run them as one thing, in an order, with a verdict — so the
# readiness plan's burst (docs/SHOW_READINESS_PLAN_2026-09-30.md, Plan B) starts here: discovery, the
# meter stream, the OSC reads, the verifier's silent paths, the toggle's state read, the write validation
# and the toggle end to end. Each step is strict: the first failure stops the burst.
#
# It **writes to the console** (toggles and sets, each restored by the test itself). Before running it:
#   1. save the show and take a station backup (the rollback),
#   2. tell the room, because a desk in a show must not be toggled by surprise,
#   3. have the desk connected and this Mac on the desk's network.
# The burst refuses to start without `--confirm-writes` for that reason.
#
# Usage: ./scripts/wing-burst-hardware.sh --confirm-writes [--mac-ip <addr>] [--desk-ip <addr>]
#   --mac-ip   this Mac's address on the desk's network (for the desk's own timings; optional)
#   --desk-ip  the console's address (default: the app's family default, 192.168.1.10)
# Output is written to docs/HARDWARE_BURST_<date>.log as well as to the screen.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONFIRM=0
MAC_IP=""
DESK_IP="192.168.1.10"
while [ $# -gt 0 ]; do
  case "$1" in
    --confirm-writes) CONFIRM=1 ;;
    --mac-ip) MAC_IP="${2:-}"; shift ;;
    --desk-ip) DESK_IP="${2:-}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$CONFIRM" -ne 1 ]; then
  cat >&2 <<'EOF'
This script writes to the console (toggles and sets; every test restores what it changed).
Save the show first, then run it again with --confirm-writes.
EOF
  exit 2
fi

LOG="docs/HARDWARE_BURST_$(date +%Y-%m-%d_%H%M).log"
mkdir -p docs
exec > >(tee "$LOG") 2>&1

echo "WING CONTROLLER · realtime burst"
echo "date:   $(date '+%Y-%m-%d %H:%M')"
echo "desk:   ${DESK_IP} · this Mac: ${MAC_IP:-<not given>}"
echo "app:    $(node -p 'require("./version.json").version' 2>/dev/null || echo '?') (build $(node -p 'require("./version.json").build' 2>/dev/null || echo '?'))"
echo "log:    ${LOG}"
echo "======================================================================"

STEPS=0
TOTAL=10
FAILED=0

# Each step: the environment variable the test needs, and the test's exact name.
burst_step() {
  local variable="$1"
  local test_name="$2"
  local title="$3"
  STEPS=$((STEPS + 1))
  printf '\n--- %d. %s\n' "$STEPS" "$title"
  local started=$SECONDS
  # The tests print what they measured — the console's answers, the frames, the flips — and that output
  # *is* the evidence this burst exists to collect, so it is shown whether the step passes or fails.
  local output status
  # `--include-ignored` because most of these tests are `#[ignore]`d: without it libtest *lists* them as
  # ignored and exits 0, which is how the first two versions of this script produced green steps that had
  # run nothing. The guard below then demands the result line of a test that actually ran.
  output="$(env "$variable=1" cargo test -p wing-controller-desktop --quiet "$test_name" -- --nocapture --include-ignored 2>&1)"
  status=$?
  # The console's own identity must not reach a file that is kept (project rule): only the family and the
  # firmware version are evidence, the name and serial are somebody's desk.
  output="$(printf '%s\n' "$output" | sed -E 's/name=[^ ]+/name=<console>/g')"
  printf '%s\n' "$output" \
    | grep -vE "^(running [0-9]+ test|test result:|$)|^warning|^\s+-->|^\s*\||^\s*[0-9]+ \||^\s*=|^\s+(Compiling|Finished|note:)" \
    | sed 's/^/    /'
  if ! printf '%s' "$output" | grep -qE "^test result: ok\. 1 passed"; then
    printf '    FAIL (%ss) — the step did not run exactly one test (nothing was proved)\n' "$((SECONDS - started))"
    FAILED=1
  elif [ $status -eq 0 ]; then
    printf '    PASS (%ss)\n' "$((SECONDS - started))"
  else
    printf '    FAIL (%ss) — stopping the burst here\n' "$((SECONDS - started))"
    FAILED=1
  fi
}

# 0. The desk's own answer times, read-only, before anything writes.
if [ -n "$MAC_IP" ]; then
  echo ""
  echo "--- 0. how long this desk takes to answer (read-only)"
  node scripts/wing-hardware-checks.mjs "$MAC_IP" "$DESK_IP" 2>&1 | sed -n '/== 7/,$p'
fi

burst_step LIVE_WING_TEST discover_wing_finds_console_on_active_network "discovery: the desk answers WING? through an adapter this Mac has"
[ "$FAILED" -eq 0 ] && burst_step LIVE_WING_METER_TEST live_wing_usb_meter_route_receives_native_frames "the native meter stream really delivers frames"
[ "$FAILED" -eq 0 ] && burst_step LIVE_WING_OSC_TEST live_wing_osc_state_refresh_reads_and_caches_the_real_value "a leaf read comes back and is cached"
[ "$FAILED" -eq 0 ] && burst_step LIVE_WING_VERIFY_TEST live_wing_verifier_reports_silent_paths_and_their_strip_model "the verifier tells a silent path from an answered one"
[ "$FAILED" -eq 0 ] && burst_step LIVE_WING_TOGGLE_TEST live_wing_toggle_read_gets_the_current_binary_state "the toggle's state read gets a real binary value"
[ "$FAILED" -eq 0 ] && burst_step LIVE_WING_WRITE_TEST live_wing_write_validation_of_toggle_and_corrected_paths "a write is read back, and a footnote-suffixed path really is a no-op"
[ "$FAILED" -eq 0 ] && burst_step LIVE_WING_TOGGLE_E2E live_wing_toggle_alternates_a_real_binary_parameter "the native toggle flips a real parameter, twice"
# The show leans on toggles, so the storm is part of the burst and not an afterthought: 200 single
# presses and then bursts of 2, 5 and 10 with no read in between, the console's own parity as the judge.
[ "$FAILED" -eq 0 ] && burst_step LIVE_WING_TOGGLE_STORM live_wing_toggle_storm_counts_every_press "the toggle storm: every press counted, scene left as found"
# The shape a show actually uses: one press, eight channels. The visible variant (mute + alt source +
# solo, with the solo's read-only mirror proving the console acted) is
# `LIVE_WING_LIGHTSHOW=1 cargo test ... live_wing_lightshow -- --nocapture --include-ignored`.
[ "$FAILED" -eq 0 ] && burst_step LIVE_WING_MUTE_GROUP_TEST live_wing_mute_group_toggles_the_first_eight_channels "a mute group on eight channels: 32 presses, parity per channel"
# Real signal, so the trigger path is measured and not assumed: the console's own oscillator feeds a
# channel, the native stream carries its meter, and the app's trigger runtime fires the action. It saves
# every path it writes and restores them even on the way out of a panic.
[ "$FAILED" -eq 0 ] && burst_step LIVE_WING_SIGNAL_TEST live_wing_trigger_under_real_signal_measures_the_latency "a macro under real signal: the trigger path, measured end to end"

echo ""
echo "======================================================================"
if [ "$FAILED" -ne 0 ]; then
  echo "BURST STOPPED at step ${STEPS} of ${TOTAL}. Fix that first; the rest was not run."
  exit 1
fi
echo "AUTOMATED BURST PASSED · ${STEPS} of ${TOTAL} steps"

# The console's own name and address must not reach a file that is kept (project rule: no identity, no
# serial, no address in anything an operator reads). The numbers are the evidence; whose desk it is, is
# not. Masked here, after the summary and before the human text, so the log's measurements are complete
# when the mask runs.
if [ -f "$LOG" ]; then
  sed -i '' -e "s/${DESK_IP}/<console>/g" "$LOG" 2>/dev/null || true
  if [ -n "$MAC_IP" ]; then
    sed -i '' -e "s/${MAC_IP}/<this-mac>/g" "$LOG" 2>/dev/null || true
  fi
fi

cat <<'EOF'

Now the parts that need a human at the desk (the plan's B2-B6). Write the numbers into
docs/SHOW_READINESS_RESULTS_<date>.md as you go:

B2 · toggle storm: 200 single presses on one mute, then multi-press bursts. N packets must be N
     flips and the parameter must end where it started. Watch the desk's own state, not the app.
B3 · macros under signal: 8-16 macros (several toggles, two fades at once, conditions on live meter
     triggers) driven by real signal. Read the Health card: trigger latency, dropped, queue-full.
B4 · the ceiling: raise the load (more macros, shorter fades, a bigger watchlist, the bridge open)
     until the first refusal, and write down the exact numbers where it happened.
B5 · drills: pull the cable mid-fade; power-cycle the desk mid-macro; PANIC STOP during a fade and
     during a toggle; close and reopen the bridge; sleep and wake the Mac; enable Live Safe Mode
     during a run; write to a parameter the desk refuses. Each one: visible, recoverable, no lie.
B6 · endurance: 30-60 minutes of show-like use with the bridge open, sampling the app's and the
     WebContent's memory and the health card. Nothing may creep.
EOF
