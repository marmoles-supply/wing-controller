#!/usr/bin/env node
// Machine-wide lock for `scripts/verify-all.sh`: one verification gate at a time, per user.
//
// Why this exists — those are measurements, not caution (the same story is told at the top of
// `verify-all.sh`, where the gate takes the claim):
//   * The MIDI virtual-port tests in `desktop/src-tauri/src/inter_app_midi.rs` create ports with
//     FIXED names in CoreMIDI's namespace, and that namespace belongs to the machine's MIDI
//     session, not to the process. Measured 2026-10-05: two test processes at once -> 6 of 6 runs
//     red; alone -> 20 of 20 green. The tests serialise themselves with a `flock`
//     (`MidiPortNamespace`, `inter_app_midi.rs`), but a lock inside the test cannot stop the second
//     gate from starting that suite at all.
//   * Two gates also fight over the one headless Chrome on port 9223: `start_chrome` SIGKILLs
//     whatever holds the port, so gate B kills gate A's browser mid-suite.
//   * A third mode is independent and deliberately NOT addressed here: the on-demand
//     `com.apple.midiserver` transiently refuses a client in 0.3-0.4 % of runs. No locking fixes
//     that one, and this lock does not pretend to.
//
// The idiom is `takeLock` from `scripts/mutation-check-interapp.mjs`: the claim names the owning
// pid in a file, and a claim whose process is gone is taken over rather than waited on. `flock(1)`
// does not exist on macOS, so the claim is a **directory** — `mkdir` is atomic on every POSIX
// system — and the pid is written into `owner.json` inside it an instant later.
//
// Usage (called by verify-all.sh; also useful by hand):
//   node scripts/gate-lock.mjs acquire --pid <gate pid> [--timeout-seconds N] [--command "..."]
//   node scripts/gate-lock.mjs release --pid <gate pid>
//   node scripts/gate-lock.mjs status
// Exit codes: 0 done · 3 the lock is held by a live gate and the bounded wait expired · 1 misuse.
//
// The wait is bounded on purpose: a gate that hangs for ever is worse than one that refuses. The
// bound is `--timeout-seconds` (verify-all.sh passes WING_GATE_LOCK_WAIT_SECONDS, default 600 s).

import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// `tmpdir()` is the per-user temporary directory. That is the right scope: the CoreMIDI namespace
// the lock protects is the user's MIDI session, and two gates of one user are the failure mode.
// `WING_GATE_LOCK_PATH` overrides the whole path (used by the tests of this lock, so a probe never
// collides with a real gate).
const LOCK_DIR = process.env.WING_GATE_LOCK_PATH || join(tmpdir(), "wing-controller-verify-gate.lock");
const OWNER_FILE = join(LOCK_DIR, "owner.json");
const DEFAULT_WAIT_SECONDS = 600;
const POLL_MS = 250;
// A claim is a `mkdir` followed, microseconds later, by writing `owner.json`. A directory that has
// stayed ownerless far longer than that is a crash between the two, not a claim in flight — and
// only then may it be taken over. The grace is what keeps two simultaneous reclaimers from
// deleting each other's fresh claim.
const ORPHAN_GRACE_MS = 1500;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function readOwner() {
  try {
    const owner = JSON.parse(readFileSync(OWNER_FILE, "utf8"));
    if (owner && Number.isInteger(owner.pid) && owner.pid > 0) return owner;
  } catch {
    // No owner file yet (a claim in flight), or an unreadable one: both mean "no known owner".
  }
  return null;
}

// `kill(pid, 0)` says whether the pid exists. EPERM means it exists but belongs to someone else,
// which is still alive as far as this lock is concerned.
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function describe(owner) {
  if (!owner) return "an unknown pid (a claim whose owner file is not readable yet)";
  const startedMs = Number(owner.startedAtEpochMs);
  const age = Number.isFinite(startedMs) ? `, ${formatDuration(Date.now() - startedMs)} ago` : "";
  const since = owner.startedAt ? ` since ${owner.startedAt}${age}` : "";
  // One line on purpose: this text is also embedded in single-line messages ("still waiting for
  // <this>") and a newline in the middle of those reads as a truncated sentence.
  const command = owner.command ? `, running \`${owner.command}\`` : "";
  return `pid ${owner.pid}${since}${command}`;
}

function takeOver(why) {
  console.log(`verify-all.sh: taking over the machine lock (${why})`);
  rmSync(LOCK_DIR, { recursive: true, force: true });
}

function acquire(pid, timeoutMs, command) {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  let announcedAt = 0;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      try {
        writeFileSync(
          OWNER_FILE,
          `${JSON.stringify(
            {
              pid,
              startedAt: new Date().toISOString(),
              startedAtEpochMs: Date.now(),
              command: command || "",
            },
            null,
            2,
          )}\n`,
        );
      } catch (error) {
        // Claiming without being able to say who owns it would make the next gate wait on a ghost.
        rmSync(LOCK_DIR, { recursive: true, force: true });
        throw error;
      }
      console.log(`verify-all.sh: machine lock held (${LOCK_DIR}, owner pid ${pid})`);
      return 0;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    const owner = readOwner();
    if (owner && !pidAlive(owner.pid)) {
      takeOver(`left by ${describe(owner)}, and that process is gone`);
      continue;
    }
    if (!owner) {
      let ageMs;
      try {
        ageMs = Date.now() - statSync(LOCK_DIR).mtimeMs;
      } catch {
        // The directory vanished between the `mkdir` and the `stat`: retry at once, it is free.
        continue;
      }
      if (ageMs > ORPHAN_GRACE_MS) {
        takeOver(`ownerless for ${formatDuration(ageMs)}, so its claim never finished`);
        continue;
      }
    }

    const now = Date.now();
    if (now >= deadline) {
      console.error("");
      console.error("verify-all.sh: another verification gate holds this machine's lock and did not");
      console.error("               let go within the bounded wait. Nothing was run.");
      console.error(`  lock:     ${LOCK_DIR}`);
      console.error(`  held by:  ${describe(owner)}`);
      console.error(`  waited:   ${formatDuration(timeoutMs)} (bounded on purpose: a gate that waits for ever is worse than one that refuses)`);
      console.error("  what now: wait for that gate to finish, or stop it if it is wedged. A lock whose");
      console.error("            process no longer exists is taken over automatically, so a killed gate");
      console.error("            never blocks the next one.");
      console.error("");
      return 3;
    }
    if (!announced || now - announcedAt >= 30000) {
      console.log(
        `verify-all.sh: waiting for another gate to release the machine lock (${describe(owner)});` +
          ` up to ${formatDuration(timeoutMs)}`,
      );
      announced = true;
      announcedAt = now;
    }
    sleepSync(Math.min(POLL_MS, Math.max(1, deadline - now)));
  }
}

function release(pid) {
  const owner = readOwner();
  if (!owner) {
    // Nothing readable: there is no claim this process can prove is its own, and deleting a foreign
    // claim would be worse than leaving it — a dead one is taken over by the next gate.
    console.log(`verify-all.sh: the machine lock at ${LOCK_DIR} had no readable owner; nothing to release`);
    return 0;
  }
  if (owner.pid !== pid) {
    console.log(
      `verify-all.sh: not releasing the machine lock: it belongs to pid ${owner.pid}, not ${pid}`,
    );
    return 0;
  }
  rmSync(LOCK_DIR, { recursive: true, force: true });
  console.log(`verify-all.sh: machine lock released (pid ${pid})`);
  return 0;
}

function status() {
  let exists = true;
  try {
    statSync(LOCK_DIR);
  } catch {
    exists = false;
  }
  if (!exists) {
    console.log(`no machine lock at ${LOCK_DIR}`);
    return 0;
  }
  const owner = readOwner();
  if (!owner) {
    console.log(`machine lock at ${LOCK_DIR} has no readable owner yet`);
    return 0;
  }
  console.log(
    `machine lock at ${LOCK_DIR} is held by ${describe(owner)} — that process is ${
      pidAlive(owner.pid) ? "alive" : "GONE (the next gate will take the lock over)"
    }`,
  );
  return 0;
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`gate-lock: ${name} needs a value`);
    process.exit(1);
  }
  return value;
}

const action = process.argv[2];
const pid = Number(flagValue("--pid") ?? process.ppid);
if (!Number.isInteger(pid) || pid <= 0) {
  console.error("gate-lock: --pid must be a positive integer");
  process.exit(1);
}

switch (action) {
  case "acquire": {
    const seconds = Number(flagValue("--timeout-seconds") ?? DEFAULT_WAIT_SECONDS);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      console.error("gate-lock: --timeout-seconds must be a positive number");
      process.exit(1);
    }
    process.exit(acquire(pid, seconds * 1000, flagValue("--command") || ""));
  }
  case "release":
    process.exit(release(pid));
  case "status":
    process.exit(status());
  default:
    console.error("usage: gate-lock.mjs acquire|release [--pid N] [--timeout-seconds N] [--command CMD]");
    console.error("       gate-lock.mjs status");
    process.exit(1);
}
