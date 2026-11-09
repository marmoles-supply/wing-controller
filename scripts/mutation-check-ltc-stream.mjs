// The teeth of the LTC stream contracts, proved by putting each defect back.
//
// `scripts/test-desktop-ltc-stream-contract.mjs` is a source-scanning suite: it asserts the *shape* of the code that
// ships, because the three real defects of `dd182bb1` are visible in the source and nowhere else without hardware
// (three CoreAudio commands that ran on the main thread; a stream death that was an `eprintln!`; a reconnect with no
// generation; two running flags). "The contract passes" is worth little on its own — the project's rule is that a
// contract without a mutation is a contract nobody has proved has teeth. This script is that proof: it edits
// `main.rs` and `ltc_device.rs` back to the defective shape, one mutation at a time, runs the contract, and demands
// that it **fails naming the defect**. Each mutation is caught by a different named assertion, so a green table means
// five distinct properties are defended, not one assertion observed five times.
//
// Verdicts, never blurred:
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the contract **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason, printed with the assertion that actually fired
//   COULD-NOT-RUN  nothing was measured (the suite could not run, or a file was left alone because it is somebody
//                  else's)
//
// Run: node scripts/mutation-check-ltc-stream.mjs
//      node scripts/mutation-check-ltc-stream.mjs --self-test   (the classifier and the restore guard; no tree edit)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that mutates
// the working tree must never run inside a gate. It takes **byte copies** of the two files it rewrites and restores
// from those bytes, never from git — a mutation harness in this repository restored from git once and destroyed
// uncommitted work — so it is safe to run before the fix is committed. What it refuses to do is overwrite a file that
// a **concurrent writer** changed while the check was running: see `planRestore`, which is also proved by `--self-test`.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = join(REPO, "desktop/src-tauri/src/main.rs");
const DEVICE = join(REPO, "desktop/src-tauri/src/ltc_device.rs");
const SUITE = join(REPO, "scripts/test-desktop-ltc-stream-contract.mjs");
const LOCK = join(tmpdir(), "wing-mutation-check-ltc-stream.lock");
// This suite reads files and asserts; it needs no browser and no hardware. It is still bounded, because a check that
// hangs is indistinguishable from a check that found something.
const TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 120_000);

/** What a run's result means for one mutation. Pure, so `--self-test` can check it with no tree and no suite. */
export function classify(expect, { code, output, timedOut }) {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the contract did not finish in ${Math.round(TIMEOUT_MS / 1000)} s` };
  }
  if (code === null) {
    return { verdict: "could-not-run", why: "the contract could not be started: nothing was measured" };
  }
  // `caught` means the contract **failed** and named this defect. A contract that passes with the defect in place
  // while printing the phrase somewhere is not evidence.
  if (code !== 0 && expect.test(output)) {
    return { verdict: "caught" };
  }
  if (code === 0) {
    return { verdict: "missed", why: "the contract PASSED with the defect in place" };
  }
  const firstFailure = (output.match(/AssertionError[^\n]*/) || [""])[0].slice(0, 200);
  return {
    verdict: "unexpected",
    why: `the contract failed, but not with ${expect}${firstFailure ? ` — it actually said: ${firstFailure}` : ""}`,
  };
}

// Each mutation is the inverse of one property `dd182bb1` committed. `from`/`to` are exact source text: a mutation
// whose target is not found is reported as stale rather than silently skipped.
const mutations = [
  {
    // The freeze the owner felt: `#[tauri::command]` on a non-async fn is `ExecutionContext::Blocking`, so the body
    // runs in the WKWebView script-message callback. `list_inputs` enumerates CoreAudio.
    name: "the input list asked for on the main thread (a bare `#[tauri::command] fn`)",
    file: MAIN,
    from: `#[tauri::command]
async fn list_timecode_inputs() -> Result<Vec<ltc_device::AudioInputInfo>, String> {
    tauri::async_runtime::spawn_blocking(ltc_device::list_inputs)
        .await
        .map_err(|error| format!("the input list could not be read: {error}"))?
}`,
    to: `#[tauri::command]
fn list_timecode_inputs() -> Result<Vec<ltc_device::AudioInputInfo>, String> {
    // mutated: a synchronous command body runs inside the WKWebView's script-message callback
    tauri::async_runtime::block_on(tauri::async_runtime::spawn_blocking(ltc_device::list_inputs))
        .map_err(|error| format!("the input list could not be read: {error}"))?
}`,
    expect: /list_timecode_inputs must be declared #\[tauri::command\] async fn/,
  },
  {
    // The whole response to a hot unplug used to be a print. The page then went on saying "Listening to …" over a
    // stream that had stopped, and the reconnect control never saw a reason.
    name: "a dead stream that only prints, clearing no flag and recording no reason",
    file: DEVICE,
    from: `    status.running.store(false, Ordering::Relaxed);
    status.record_error(error.clone());
    on_death(error);`,
    to: `    // mutated: the death is printed and nothing else — the page keeps saying "Listening"
    eprintln!("LTC input error: {}", error.message);`,
    expect: /the handler must clear the flag the callbacks and is_open\(\) read/,
  },
  {
    // The generation counter's guard is `is_current()`: without it, a status a close or a reconnect has retired is
    // still "running", so the six callbacks of the stream that was closed go on pushing positions and firing cues —
    // the exact "an in-flight block still fires after Stop" the one shared flag exists to stop.
    name: "a reconnect whose generation check is gone (an old stream's error still speaks)",
    file: DEVICE,
    from: `        self.running.load(Ordering::Relaxed) && self.is_current()`,
    to: `        // mutated: the generation check is gone, so a retired stream is still "running"
        self.running.load(Ordering::Relaxed)`,
    expect: /must also answer for the \*current\* generation/,
  },
  {
    // The dead guard itself: `is_open()` answering from its own value instead of the flag the callbacks read is the
    // split-brain state the fix removed — the page says "Listening" while the stream it means is gone.
    name: "is_open() answering true on its own instead of reading the shared flag",
    file: DEVICE,
    from: `        self.inner.status
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|status| status.is_running()))
            .unwrap_or(false)`,
    to: `        // mutated: the state read no longer asks the flag the callbacks read
        true`,
    expect: /must answer from that same shared status/,
  },
  {
    // The second flag, in the shape it actually had: `LtcInput` owned a plain `AtomicBool` that `is_open()` answered
    // from — so the state reported and the state the callbacks read were two facts, and a close nobody read left an
    // in-flight block still firing cues.
    name: "the state read answering from a flag of LtcInput's own (the second running flag)",
    file: DEVICE,
    from: `#[derive(Default)]
pub struct LtcInput {
    inner: Arc<LtcInputInner>,
}`,
    to: `pub struct LtcInput {
    inner: Arc<LtcInputInner>,
    // mutated: a second running flag, the one the state read trusts instead of the callbacks' status
    running: AtomicBool,
}

impl Default for LtcInput {
    fn default() -> Self {
        Self { inner: Arc::new(LtcInputInner::default()), running: AtomicBool::new(false) }
    }
}`,
    expect: /LtcInput must not hold a second, unshared running flag/,
  },
];

/** The guard's decision for one file, as data, so it can be proved without the tree: "restore", "ours" or "foreign". */
export function planRestore(current, original, lastWritten) {
  if (current === original) return "ours"; // already what we found: nothing to do, and not foreign
  if (current === lastWritten) return "restore"; // our own mutation: put the bytes back
  return "foreign"; // somebody else wrote this: leave it alone and say so
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["a contract that fails and names the defect", /must be async/, { code: 1, output: "AssertionError [ERR_ASSERTION]: list_timecode_inputs must be async: #[tauri::command]" }, "caught"],
    ["a contract that PASSES while printing the phrase", /must be async/, { code: 0, output: "must be async\nLTC stream contract passed" }, "missed"],
    ["a contract that failed for another reason", /must be async/, { code: 1, output: "AssertionError [ERR_ASSERTION]: something else entirely" }, "unexpected"],
    ["a contract that could not be started", /anything/, { code: null, output: "" }, "could-not-run"],
    ["a contract that ran out of time", /anything/, { code: 124, output: "", timedOut: true }, "no-verdict"],
  ];
  let failed = 0;
  for (const [name, expect, result, want] of cases) {
    const got = classify(expect, result).verdict;
    if (got !== want) failed += 1;
    console.log(`${got === want ? "ok  " : "FAIL"} classifier — ${name}: expected ${want}, got ${got}`);
  }

  // The restore guard, exercised for real on files outside the tree: a file this check wrote is put back, a file a
  // foreign writer changed is left exactly as it is. This is the property the last mutation harness in this
  // repository lacked when it restored over a colleague's half-written source.
  const dir = mkdtempSync(join(tmpdir(), "wing-ltc-guard-self-test-"));
  const file = join(dir, "sample.rs");
  try {
    const original = "fn one() {}\n";
    const mutated = "fn one() { /* mutated */ }\n";
    const foreignBytes = "fn one() {}\n// written by somebody else\n";
    const guardCases = [
      ["our own unmutated bytes are not foreign", original, original, undefined, "ours"],
      ["our own mutation is restored", mutated, original, mutated, "restore"],
      ["a foreign write is left alone", foreignBytes, original, mutated, "foreign"],
    ];
    for (const [name, current, base, lastWritten, want] of guardCases) {
      writeFileSync(file, current);
      const got = planRestore(readFileSync(file, "utf8"), base, lastWritten);
      // Only a "restore" is allowed to write; a "foreign" verdict must leave the bytes that are there.
      if (got === "restore") writeFileSync(file, base);
      const after = readFileSync(file, "utf8");
      const ok = got === want && (got !== "foreign" || after === foreignBytes);
      if (!ok) failed += 1;
      console.log(`${ok ? "ok  " : "FAIL"} guard — ${name}: expected ${want}, got ${got}${got === "foreign" && after !== foreignBytes ? " (and it overwrote them!)" : ""}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(failed === 0 ? "the classifier and the restore guard answer every case correctly" : `${failed} self-test case(s) wrong`);
  process.exit(failed === 0 ? 0 : 1);
}

/** Run the contract and say what happened, including how it exited — a contract that could not run measured nothing. */
function runSuite() {
  try {
    const output = execFileSync("node", [SUITE], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return { code: 0, output };
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`;
    if (error.killed || error.signal === "SIGKILL" || error.code === "ETIMEDOUT") {
      return { code: 124, output, timedOut: true };
    }
    if (error.code === "ENOENT") {
      return { code: null, output };
    }
    return { code: typeof error.status === "number" ? error.status : 1, output };
  }
}

// Only one run at a time: two would interleave mutations of the same file and each would restore the other's bytes. A
// lock left by a run that died is taken over, because a stale lock that blocks for ever is its own kind of failure.
function takeLock() {
  try {
    writeFileSync(LOCK, String(process.pid), { flag: "wx" });
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = Number(readFileSync(LOCK, "utf8").trim());
    let alive = false;
    if (Number.isInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (alive) {
      console.error(`another run of this check is mutating the tree (pid ${owner}); nothing was measured`);
      process.exit(2);
    }
    console.error(`taking over a lock left by pid ${owner}, which is not running any more`);
    writeFileSync(LOCK, String(process.pid));
  }
}
takeLock();

// Every file a mutation can touch, its bytes, and a copy outside the tree. Nothing is restored from git: the normal
// way to run this check is **before** the fix is committed, and those uncommitted bytes are the ones to keep.
const originals = new Map([MAIN, DEVICE].map((file) => [file, readFileSync(file, "utf8")]));
const backupDir = mkdtempSync(join(tmpdir(), "wing-ltc-stream-mutation-"));
for (const file of originals.keys()) copyFileSync(file, join(backupDir, basename(file)));
const written = new Map();
const foreign = new Set();

/** Put every file back to the bytes this check found, and refuse to touch a file a foreign writer changed. */
function restoreAll() {
  for (const [file, original] of originals) {
    const current = readFileSync(file, "utf8");
    switch (planRestore(current, original, written.get(file))) {
      case "ours":
        written.delete(file);
        break;
      case "restore":
        writeFileSync(file, original);
        written.delete(file);
        break;
      default:
        foreign.add(file);
    }
  }
}

console.log(`files this check writes and restores from its own byte copies: ${[...originals.keys()].map((file) => basename(file)).join(", ")}`);
console.log(`pre-run copies, kept if anything is left alone: ${backupDir}`);

// A mutation table is only as good as the tree it runs against: if the contract does not pass unmutated, every
// verdict below would be describing the tree instead of a defect, so say that and measure nothing.
const baseline = runSuite();
if (baseline.code !== 0) {
  console.error(`the contract does not pass on the tree as it stands (exit ${baseline.code}): nothing was measured`);
  console.error((baseline.output.match(/AssertionError[^\n]*/) || [""])[0]);
  restoreAll();
  if (foreign.size > 0) {
    console.error(`these files changed while this check was running and were LEFT AS THEY ARE (pre-run bytes in ${backupDir}): ${[...foreign].join(", ")}`);
  }
  rmSync(LOCK, { force: true });
  process.exit(1);
}
console.log("the contract passes on the tree as it stands: mutations below are measured against a green baseline");

const results = [];
try {
  for (const mutation of mutations) {
    // Whatever the previous mutation left, this one starts from the file as it was found. A file that changed under
    // us is skipped rather than overwritten.
    restoreAll();
    if (foreign.has(mutation.file)) {
      results.push({
        name: mutation.name,
        verdict: "could-not-run",
        why: `${basename(mutation.file)} changed while this check was running; its bytes were left alone`,
      });
      continue;
    }
    const original = originals.get(mutation.file);
    if (!original.includes(mutation.from)) {
      results.push({ name: mutation.name, verdict: "unexpected", why: "the mutation target was not found — this check is stale" });
      continue;
    }
    // One more look before this write: a file that changed between the restore above and here belongs to somebody
    // else, and overwriting it is exactly the accident this guard exists to prevent.
    if (readFileSync(mutation.file, "utf8") !== original) {
      foreign.add(mutation.file);
      results.push({
        name: mutation.name,
        verdict: "could-not-run",
        why: `${basename(mutation.file)} changed while this check was running; its bytes were left alone`,
      });
      continue;
    }
    const mutated = original.replace(mutation.from, mutation.to);
    writeFileSync(mutation.file, mutated);
    written.set(mutation.file, mutated);
    results.push({ name: mutation.name, ...classify(mutation.expect, runSuite()) });
  }
} finally {
  // Whatever happened, put every byte back — but never over a file that changed under this check, and say so if a
  // file is not what it was, because a check that silently leaves a mutation behind (or silently eats someone else's
  // edit) is worse than no check at all.
  restoreAll();
  if (foreign.size > 0) {
    console.error(`these files changed while this check was running and were LEFT AS THEY ARE (the pre-run bytes are in ${backupDir}): ${[...foreign].join(", ")}`);
  } else {
    const notRestored = [...originals].filter(([file, content]) => readFileSync(file, "utf8") !== content);
    if (notRestored.length > 0) {
      console.error(`these files could NOT be restored — their originals are in ${backupDir}: ${notRestored.map(([file]) => file).join(", ")}`);
    } else {
      rmSync(backupDir, { recursive: true, force: true });
    }
  }
  rmSync(LOCK, { force: true });
}

const LABEL = { caught: "caught      ", missed: "MISSED      ", unexpected: "UNEXPECTED  ", "could-not-run": "COULD-NOT-RUN", "no-verdict": "NO-VERDICT  " };
for (const result of results) {
  console.log(`${LABEL[result.verdict]}  ${result.name}${result.why ? ` — ${result.why}` : ""}`);
}

const counts = results.reduce((tally, result) => ({ ...tally, [result.verdict]: (tally[result.verdict] || 0) + 1 }), {});
console.log(`\n${counts.caught || 0} caught of ${results.length}` +
  `${counts.missed ? `, ${counts.missed} missed (a contract that does not catch its defect)` : ""}` +
  `${counts.unexpected ? `, ${counts.unexpected} unexpected (the contract failed for another reason)` : ""}` +
  `${counts["could-not-run"] ? `, ${counts["could-not-run"]} could not run (nothing was measured)` : ""}` +
  `${counts["no-verdict"] ? `, ${counts["no-verdict"]} without a verdict (timed out)` : ""}`);

const allCaught = results.every((result) => result.verdict === "caught");
console.log(allCaught
  ? "every LTC stream defect put back is caught by a contract that fails and names it"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
