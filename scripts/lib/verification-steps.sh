# Shared by the real gate and its behavioural failure-path tests. Sourcing this file runs no checks.
# Test logs contain synthetic fixtures; CI retains complete output, including successful Rust counts.
save_step_output() {
  [ -n "${WING_VERIFY_LOG_DIR:-}" ] || return 0
  mkdir -p "$WING_VERIFY_LOG_DIR" || return 1
  local name
  name="$(printf '%s' "$1" | tr -c '[:alnum:].-' '_')"
  printf '%s\n' "$2" > "$WING_VERIFY_LOG_DIR/$name.log"
}

step() {
  local label="$1"
  shift
  printf '%-46s' "$label"
  local started=$SECONDS
  local output
  if output="$("$@" 2>&1)"; then
    # The seconds are printed because a gate that "takes ages" has to say which step is the age:
    # the browser suites were 90 % of this one's wall clock, and `--quick` exists because of that.
    printf 'PASS (%ss)\n' "$((SECONDS - started))"
    PASSED=$((PASSED + 1))
    # A step that exits 0 while saying it skipped something is not the same as a step that did the work,
    # and this line used to throw its output away: nobody ever saw the release-note suite's "skipped N
    # note(s)" or a suite's "not landed yet" (audit 2026-10-02, S8).
    note_from_output "$output"
    save_step_output "$label" "$output"
    return 0
  else
    printf 'FAIL (%ss)\n' "$((SECONDS - started))"
    FAILED+=("$label")
    # The head carries the failing addresses; the tail used to be all the operator saw (S9).
    show_failure_output "$output"
    save_step_output "$label" "$output"
    return 1
  fi
}

# Anything a passing step admits it did not check, kept visible next to its PASS.
note_from_output() {
  local output="$1"
  echo "$output" | grep -iE 'skipp|unverified|not build-verified|not landed|no chrome|not checked|no browser|[1-9][0-9]* ignored' | head -n 5 | sed 's/^/    note: /' || true
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
  local last_line
  last_line="$(printf '%s\n' "$output" | awk 'NF { line=$0 } END { print line }')"
  [ "$last_line" = "WING_BROWSER_SUITE_OK" ] && sealed=1
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
    [ "$status" -ne 0 ] || status=1
  fi
  save_step_output "$label" "$output"
  return "$status"
}


# Retry only when Chrome actually stopped answering. A failed restart must retain the original failure.
run_browser_suite() {
  local name="$1"
  local test_file="$2"
  local attempt=0
  if step_with_timeout 180 "Node test: ${name} (Chrome)" node "$test_file"; then
    return 0
  fi
  while [ "$attempt" -lt 2 ] && ! chrome_alive; do
    attempt=$((attempt + 1))
    echo "                                             browser unavailable: restart and retry (${attempt}/2)"
    if ! start_chrome; then
      echo "                                             restart failed; the original test failure is retained"
      return 1
    fi
    open_clean_tab
    # Replace a failure only once a retry can actually run. Moving this above start_chrome
    # used to erase a failed test when Chrome could not be restarted (audit 2026-11-09).
    FAILED=("${FAILED[@]:0:${#FAILED[@]}-1}")
    if step_with_timeout 180 "Node test: ${name} (Chrome, retry ${attempt})" node "$test_file"; then
      return 0
    fi
  done
  return 1
}
