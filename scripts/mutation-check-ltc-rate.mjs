// The teeth of the LTC rate contracts, proved by putting each defect back.
//
// `scripts/test-desktop-ltc-rate-browser.mjs` is the page-side contract and the Rust test in `ltc_device.rs` is the
// device-free half. "The contract passes" is worth little on its own — the project's rule is that a contract without
// a mutation is a contract nobody has proved has teeth, and this project has already shipped a green gate over a
// control that did nothing. So this puts the owner's defect — and the two shapes it could come back in — into the
// files that ship, runs the contract that is supposed to catch it, and demands a failure that names it.
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the contract **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason, printed with the assertion that actually fired
//   COULD-NOT-RUN  nothing was measured (no browser, no cargo, or a file a concurrent writer changed)
//   NO-VERDICT     the run did not finish inside its bound (a wedged browser looks exactly like this)
//
// Run: node scripts/mutation-check-ltc-rate.mjs
//      node scripts/mutation-check-ltc-rate.mjs --self-test   (the classifier and the restore guard; no tree edit)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that mutates
// the working tree must never run inside a gate. It takes **byte copies** of the files it rewrites and restores from
// those bytes, never from git — the usual moment to run it is before the fix is committed, and those uncommitted
// bytes are the ones to keep. That guard is the one written for `mutation-check-ltc-stream.mjs`: it refuses to
// overwrite a file a **concurrent writer** changed while the check was running (`planRestore`, proved by
// `--self-test`). `mutation-check-cue-save.mjs` refuses to run at all on a dirty tree because it restores from git;
// leaving foreign bytes alone is the stronger property, so it is the one copied here.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(REPO, "desktop/ui/index.html");
// The state sentence both windows show moved into the shared module, so this check has to be able to put a defect back
// **there** — it is the only mutation check that carries the files the readout is built from.
const CUE_LIST = join(REPO, "desktop/ui/cue-list.js");
const DEVICE = join(REPO, "desktop/src-tauri/src/ltc_device.rs");
const SUITE = join(REPO, "scripts/test-desktop-ltc-rate-browser.mjs");
const LOCK = join(tmpdir(), "wing-mutation-check-ltc-rate.lock");
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NO_BROWSER = /SKIP: no Chrome remote debugging/;
const TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);
// The whole `ltc_device` test module, not one test by name: a mutation anywhere in that file is judged by **every**
// contract in it. A filter naming a single test is how a mutation comes back MISSED for a reason that has nothing to do
// with the contract it was written for — measured, when the data-age mutation was added and the contract that catches it
// lives in a different test of the same module.
const CARGO_TEST_ARGS = ["test", "-p", "wing-controller-desktop", "--bin", "wing-controller-desktop",
  "ltc_device::tests"];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a run's result means for one mutation. Pure, so `--self-test` can check it without a browser or cargo. */
export function classify(expect, { code, output, timedOut, cargo = false }) {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the contract did not finish in ${Math.round(TIMEOUT_MS / 1000)} s — a wedged browser looks like this, and so would a hang this mutation caused` };
  }
  if (code === null) {
    return { verdict: "could-not-run", why: "the contract could not be started: nothing was measured" };
  }
  // A browser suite that never reached the page measured nothing, whatever its exit code says.
  if (!cargo && (code === 3 || NO_BROWSER.test(output))) {
    return { verdict: "could-not-run", why: `the suite never ran (exit ${code})` };
  }
  // A mutated tree that does not compile is not the contract failing, and must never be booked as `caught`.
  if (cargo && code !== 0 && /error\[E\d+\]|error: could not compile/.test(output)) {
    return { verdict: "unexpected", why: "the mutated tree did not compile — that is not the contract failing" };
  }
  // `caught` means the contract **failed** and named this defect. Passing while the phrase appears somewhere is not
  // evidence.
  if (code !== 0 && expect.test(output)) {
    return { verdict: "caught" };
  }
  if (code === 0) {
    return { verdict: "missed", why: "the contract PASSED with the defect in place" };
  }
  const firstFailure = (output.match(cargo ? /assertion[^\n]*failed[^\n]*/ : /AssertionError[^\n]*/) || [""])[0].slice(0, 200);
  return {
    verdict: "unexpected",
    why: `the contract failed, but not with ${expect}${firstFailure ? ` — it actually said: ${firstFailure}` : ""}`,
  };
}

// Each mutation is the inverse of one property the fix depends on. `edits` are exact source texts: a mutation whose
// target is not found is reported as stale rather than silently skipped.
const mutations = [
  {
    // The defect the owner reported, in its first half: the selector changes and **reaches nothing**. Without the
    // listener the page does not even say it is doing anything, which is what the assertion below names.
    name: "the rate selector that reaches nothing (the owner's \"no cambia nada\")",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `              document.getElementById("timecode-ltc-rate")?.addEventListener("change", applyLtcRateChange);`,
      to: `              // mutated: choosing a rate applies to nothing at all`,
    }],
    expect: /the page must say what it is doing before it waits/,
  },
  {
    // The defect the owner described in his second screenshot: the rate selector sitting with the file verification,
    // where it reads as the rate of the file while it governs the live input. Put back exactly that way — the live
    // selector is moved out of the input controls and into the file group.
    name: "the live rate selector put back in the file-verification group",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `                          <label>rate of the input
                            <select id="timecode-ltc-rate" title="The frame rate of the timecode arriving on this input. LTC does not carry one — that is the format, not this application — so the signal is decoded at the rate chosen here. Changing it while the input is open reopens the stream at the new rate, and the readout follows. If nothing decodes for a few seconds the status line below names the rate in use and says so. 29.97 is the video rate: the backend reads it as drop-frame numbering, and a drop-frame position is written with a semicolon before its frames.">
                              <option value="25">25</option>
                              <option value="24">24</option>
                              <option value="29.97">29.97 (drop-frame)</option>
                              <option value="30">30</option>
                            </select>
                          </label>
`,
      to: ``,
    }, {
      from: `                      <div id="timecode-ltc-file-group" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">`,
      to: `                      <div id="timecode-ltc-file-group" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                        <label>rate
                          <select id="timecode-ltc-rate" title="mutated: the live rate is back where it reads as the file's rate">
                            <option value="25">25</option>
                            <option value="24">24</option>
                            <option value="29.97">29.97 (drop-frame)</option>
                            <option value="30">30</option>
                          </select>
                        </label>`,
    }],
    expect: /must NOT be in the file-verification group/,
  },
  {
    // The silence half of the report: an input open at a rate the signal is not running at decodes nothing, and the
    // page said nothing at all about it. The condition is replaced by one that can never be true.
    name: "the wrong rate that decodes nothing and says nothing",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `          if (Number(state?.decoded) === 0 && Number.isFinite(openMs) && openMs >= LTC_NOTHING_DECODED_MS) {`,
      to: `          if (false) { // mutated: nothing decoded is not worth saying`,
    }],
    expect: /an open input that has decoded nothing must say so/,
  },
  {
    // The Rust half: the decision the whole change rests on. A stream already decoding at the chosen rate must not
    // be torn down — a reopen drops the lock the show is following — and putting that back means a rate that is
    // already in use is reopened anyway.
    name: "a rate already in use that reopens the stream anyway (the lock dropped for nothing)",
    file: DEVICE,
    kind: "cargo",
    edits: [{
      from: `        Some(current) if current == wanted => LtcRateChange::AlreadyAtRate,`,
      to: `        Some(current) if current != wanted => LtcRateChange::AlreadyAtRate, // mutated: the same rate reopens`,
    }],
    expect: /the_rate_change_decision_restarts_only_a_running_stream_at_another_rate/,
  },
  {
    // The sentence both windows read out of the shared module, with the fact it was written for falsified: a stopped
    // clock that does not carry the tolerance the backend reported leaves the operator unable to tell a signal that
    // hiccupped from a show that stopped — which is the whole reason the window is reported at all.
    name: "a stopped clock that ignores the freewheel tolerance the backend reported",
    file: CUE_LIST,
    kind: "browser",
    edits: [{
      from: `    const windowSeconds = ((Number(snapshot.freewheel_ms) || 0) / 1000).toFixed(2);`,
      to: `    const windowSeconds = "0.00"; // mutated: the tolerance the backend reported is ignored`,
    }],
    expect: /names the window it was judged against/,
  },
  {
    // The question never asked: the rate is applied and the cues the new rate cannot express are left behind, which is
    // the defect this whole check exists for — the operator finds out from a red row after the change, not before it.
    name: "a rate change applied without asking whether the cues survive it",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `        if (!(await confirmRateKeepsTheCues(rate))) {`,
      to: `        if (false) { // mutated: the rate is applied without asking whether the cues survive it`,
    }],
    expect: /must be put to the operator first/,
  },
  {
    // The measurement ignored: the stream is open and silent, and the page falls back to "check the rate and the
    // channel" while the signal's own bit timing already says which rate is arriving. The measurement is the whole
    // point of phase C — the app can do better than naming the two things that might be wrong.
    name: "a measured rate mismatch that the page does not report",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `          if (state?.rate_disagrees && Number.isFinite(measured)) {`,
      to: `          if (false && state?.rate_disagrees && Number.isFinite(measured)) { // mutated: the measurement is ignored`,
    }],
    expect: /THE MEASUREMENT IS NAMED/,
  },
  {
    // And the words: the sentence calling it a detection. The bit period measures the signal's playback speed at the
    // rate the device claims, so varispeed or pull-up moves it exactly as another frame rate would — "detected" is a
    // claim the measurement cannot support, and this is the one wording the phase is explicit about.
    name: "a measurement the page calls a detection",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `              \`\${measured.toFixed(1)} fps. LTC carries no rate of its own, so a declared rate that does not match a source \` +`,
      to: `              \`\${measured.toFixed(1)} fps (detected). LTC carries no rate of its own, so a declared rate that does not match a source \` +`,
    }],
    expect: /AND IT IS NEVER CALLED DETECTION/,
  },
  {
    // A stream that went quiet reported as if it were still listening: the case this phase exists for, and the one the
    // owner would have hit as "the clock stopped and the page said everything was fine".
    name: "a stream that went quiet still reported as listening",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `          if (state?.stalled) {`,
      to: `          if (false && state?.stalled) { // mutated: a silent stream is reported as listening`,
    }],
    expect: /A STREAM THAT WENT QUIET SAYS HOW LONG IT HAS BEEN QUIET/,
  },
  {
    // The other fault, turned into this one: a stream that never decoded at all is the rate or the channel, and calling
    // it stalled would send the operator to check a cable for a rate mistake.
    name: "a stream that never decoded, reported as stalled",
    file: DEVICE,
    // `cargo`, not `rust`: the runner below picks the command by this name, and `"rust"` would run the **browser**
    // suite instead — leaving the Rust test unrun and this mutation reported as MISSED for a reason that has nothing to
    // do with the contract. Measured: that is exactly what happened before this line was corrected.
    kind: "cargo",
    edits: [{
      from: `            stalled: is_stalled(status.data_age_ms(), LTC_STALL_MS),`,
      to: `            stalled: status.data_age_ms().unwrap_or(u64::MAX) >= LTC_STALL_MS, // mutated: never-decoded counts as stalled`,
    }],
    expect: /and it is not stalled, however long it has been open/,
  },
  {
    // The retry loop with no cooldown: a device that is simply gone would be torn down and rebuilt on every poll — the
    // flapping that made the arrival timeout a deliberate, bounded decision rather than an obvious one.
    name: "a retry loop with no cooldown",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `        if (Number.isFinite(last) && last > 0 && now - last < ARRIVAL_TIMEOUT_COOLDOWN_MS) return;`,
      to: `        // mutated: the cooldown between attempts is gone`,
    }],
    // What fires is the **stalled sentence** of the section before it: with no cooldown the page reopens on every poll, and
    // its own "reopening it (attempt 3 of 3)" overwrites the sentence the operator needs to read. The defect is caught by
    // the contract it damages, not by the one written to name it, and the verdict says so rather than blurring it.
    expect: /A STREAM THAT WENT QUIET SAYS HOW LONG IT HAS BEEN QUIET/,
  },
  {
    // The other half, and the one that would hide a diagnosis: reopening an input over a stream that has **never**
    // decoded, where the fault is the declared rate or the channel and no reopening can cure it.
    name: "a stream that never decoded, retried as if it had gone quiet",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `        if (!state.stalled) {`,
      to: `        if (!state.stalled && Number(state.decoded) > 0) { // mutated: "nothing ever arrived" is retried too`,
    }],
    expect: /A STREAM THAT NEVER DECODED IS NOT REOPENED/,
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
    ["a contract that fails and names the defect", /must say what it is doing/, { code: 1, output: "AssertionError [ERR_ASSERTION]: the page must say what it is doing before it waits" }, "caught"],
    ["a contract that PASSES while printing the phrase", /must say what it is doing/, { code: 0, output: "the page must say what it is doing before it waits\nWING_BROWSER_SUITE_OK" }, "missed"],
    ["a contract that failed for another reason", /must say what it is doing/, { code: 1, output: "AssertionError [ERR_ASSERTION]: something else entirely" }, "unexpected"],
    ["a browser suite that could not run", /anything/, { code: 3, output: "SKIP: no Chrome remote debugging on port 9223" }, "could-not-run"],
    ["a Rust mutation that does not compile", /the_rate_change_decision/, { code: 101, output: "error[E0425]: cannot find value", cargo: true }, "unexpected"],
    ["a Rust test that fails and names it", /the_rate_change_decision/, { code: 101, output: "test ltc_device::tests::the_rate_change_decision_restarts_only_a_running_stream_at_another_rate ... FAILED", cargo: true }, "caught"],
    ["a run out of time", /anything/, { code: 124, output: "", timedOut: true }, "no-verdict"],
  ];
  let failed = 0;
  for (const [name, expect, result, want] of cases) {
    const got = classify(expect, result).verdict;
    if (got !== want) failed += 1;
    console.log(`${got === want ? "ok  " : "FAIL"} classifier — ${name}: expected ${want}, got ${got}`);
  }

  // The restore guard, exercised for real on files outside the tree: a file this check wrote is put back, a file a
  // foreign writer changed is left exactly as it is.
  const dir = mkdtempSync(join(tmpdir(), "wing-ltc-rate-guard-self-test-"));
  const file = join(dir, "sample.html");
  try {
    const original = "<select id=\"one\"></select>\n";
    const mutated = "<select id=\"two\"></select>\n";
    const foreignBytes = "<select id=\"one\"></select>\n<!-- written by somebody else -->\n";
    const guardCases = [
      ["our own unmutated bytes are not foreign", original, original, undefined, "ours"],
      ["our own mutation is restored", mutated, original, mutated, "restore"],
      ["a foreign write is left alone", foreignBytes, original, mutated, "foreign"],
    ];
    for (const [name, current, base, lastWritten, want] of guardCases) {
      writeFileSync(file, current);
      const got = planRestore(readFileSync(file, "utf8"), base, lastWritten);
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

// --- The browser this check needs ------------------------------------------------------------------------------
// A browser suite started with no browser on the port exits 3, and a verdict that depends on who prepared what is not
// a verdict. This starts its own when the port is silent and kills only the one it started.
async function browserAnswers() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureBrowser() {
  if (await browserAnswers()) {
    console.log(`using the browser already on port ${DEBUG_PORT}`);
    return null;
  }
  const profile = mkdtempSync(join(tmpdir(), "wing-ltc-rate-mutation-chrome-"));
  const child = spawn(CHROME_BIN, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "about:blank",
  ], { stdio: "ignore" });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await browserAnswers()) {
      console.log(`started our own browser on port ${DEBUG_PORT}`);
      return { child, profile };
    }
    await delay(250);
  }
  child.kill("SIGKILL");
  rmSync(profile, { recursive: true, force: true });
  throw new Error(`no browser on port ${DEBUG_PORT} and ${CHROME_BIN} did not start one`);
}

/** Run one contract and say what happened to it, including how it exited. */
function runContract(mutation) {
  const command = mutation.kind === "cargo" ? "cargo" : "node";
  const args = mutation.kind === "cargo" ? CARGO_TEST_ARGS : [SUITE];
  try {
    const output = execFileSync(command, args, {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WING_CHROME_PORT: String(DEBUG_PORT) },
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

const browser = await ensureBrowser().catch((error) => {
  console.error(String(error.message));
  rmSync(LOCK, { force: true });
  process.exit(2);
});

// Every file a mutation can touch, its bytes, and a copy outside the tree. Nothing is restored from git: the normal
// way to run this check is **before** the fix is committed, and those uncommitted bytes are the ones to keep.
const originals = new Map([HTML, DEVICE, CUE_LIST].map((file) => [file, readFileSync(file, "utf8")]));
const backupDir = mkdtempSync(join(tmpdir(), "wing-ltc-rate-mutation-"));
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

function stopBrowser() {
  if (browser) {
    browser.child.kill("SIGKILL");
    rmSync(browser.profile, { recursive: true, force: true });
  }
}

console.log(`files this check writes and restores from its own byte copies: ${[...originals.keys()].map((file) => basename(file)).join(", ")}`);
console.log(`pre-run copies, kept if anything is left alone: ${backupDir}`);

// A mutation table is only as good as the tree it runs against: if a contract does not pass unmutated, every verdict
// below would be describing the tree instead of a defect, so say that and measure nothing.
const baselines = new Map();
for (const kind of ["browser", "cargo"]) {
  const probe = mutations.find((mutation) => mutation.kind === kind);
  const result = runContract(probe);
  baselines.set(kind, result);
  if (result.code !== 0) {
    console.error(`the ${kind} contract does not pass on the tree as it stands (exit ${result.code}): nothing was measured`);
    console.error((result.output.match(/AssertionError[^\n]*|assertion[^\n]*failed[^\n]*/) || [""])[0]);
    restoreAll();
    stopBrowser();
    rmSync(LOCK, { force: true });
    process.exit(1);
  }
}
console.log("both contracts pass on the tree as it stands: the mutations below are measured against a green baseline");

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
    // Every edit's target must be found: a stale mutation is a measurement that did not happen, not a silent skip.
    const missing = mutation.edits.find((edit) => !original.includes(edit.from));
    if (missing) {
      results.push({ name: mutation.name, verdict: "unexpected", why: `the mutation target was not found — this check is stale: ${missing.from.slice(0, 80)}` });
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
    const mutated = mutation.edits.reduce((text, edit) => text.replace(edit.from, edit.to), original);
    writeFileSync(mutation.file, mutated);
    written.set(mutation.file, mutated);
    results.push({ name: mutation.name, ...classify(mutation.expect, runContract(mutation), { cargo: mutation.kind === "cargo" }) });
  }
} finally {
  // Whatever happened, put every byte back — but never over a file that changed under this check, and say so if a
  // file is not what it was, because a check that silently leaves a mutation behind (or silently eats someone else's
  // edit) is worse than no check at all.
  restoreAll();
  stopBrowser();
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
  ? "every LTC rate defect put back is caught by a contract that fails and names it"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
