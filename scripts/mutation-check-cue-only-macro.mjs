// The cue-only macro's teeth, proved by putting each defect back.
//
// The owner would not build a macro that only a SMPTE/timecode cue fires: the trigger select's empty entry read as
// "— Not configured —", the library refused to enable a macro with no trigger, and the row printed "NOT CONFIGURED"
// — so a macro he wanted fired *only* by a cue looked like one that would fire by itself. The fix is small (a named
// empty option, a narrowed completeness clause, summaries that agree with the label), and small fixes are exactly
// the ones a green gate can hide. This check puts the three ways the feature can be broken back, one at a time, and
// demands a browser contract that fails and names it:
//
//   caught         the suite failed **and named this defect** — what we want
//   MISSED         the suite **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason, printed with the real assertion
//   COULD-NOT-RUN  nothing was measured (no browser, no tab)
//   NO-VERDICT     the suite ran out of time — an environmental wedge, or a hang the mutation caused
//
// Run: node scripts/mutation-check-cue-only-macro.mjs
//      node scripts/mutation-check-cue-only-macro.mjs --self-test   (the classifier's own cases; no browser, no edits)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that mutates
// the tree must never run inside a gate. It does **not** restore from git — it copies `desktop/ui/index.html`'s bytes
// aside first and writes them back whatever happens, so it is safe to run with uncommitted work in that file (which
// is the normal case while someone is writing the fix this proves). It mutates **only** `desktop/ui/index.html`;
// `timecode.html` and `cue-list.js` are somebody else's while they are being edited.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const REPO = dirname(import.meta.dirname);
const PAGE = `${REPO}/desktop/ui/index.html`;
const MACRO_EDIT_SUITE = "scripts/test-desktop-macro-edit-browser.mjs";
// The suite that already fires a timecode cue through the window's own handler — extended rather than duplicated.
const CUE_SUITE = "scripts/test-desktop-settings-tabs-browser.mjs";
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEAL = /WING_BROWSER_SUITE_OK/;
const NO_BROWSER = /SKIP: no Chrome remote debugging/;
// The gate gives a browser test 180 s. This runs the suites directly, so it has to bound them itself: the known
// Chrome wedge on this machine looks exactly like a test that never returns.
const SUITE_TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/// Is there a browser answering on the debug port? One that answers is somebody else's and is left alone.
async function browserAnswers() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/// Start our own headless Chrome if the port is silent, so the verdict does not depend on who prepared what.
/// Returns the child to kill at the end, or null when an existing browser was reused.
async function ensureBrowser() {
  if (await browserAnswers()) {
    console.log(`using the browser already on port ${DEBUG_PORT}`);
    return null;
  }
  const profile = mkdtempSync(join(tmpdir(), "wing-cue-only-chrome-"));
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

/// Run a suite and say what happened to it, including how it exited — a suite that could not run is not a failure of
/// the contract, and the difference has to survive into the report.
function run(script) {
  try {
    const output = execFileSync("node", [script], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WING_CHROME_PORT: String(DEBUG_PORT) },
      timeout: SUITE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return { code: 0, output };
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`;
    if (error.killed || error.signal === "SIGKILL" || error.code === "ETIMEDOUT") {
      return { code: 124, output, timedOut: true };
    }
    return { code: typeof error.status === "number" ? error.status : 1, output };
  }
}

/// What a suite's result means for one mutation. Pure, so `--self-test` can check it without a browser or a tree.
export function classify(expect, { code, output, timedOut }) {
  if (timedOut) {
    return {
      verdict: "no-verdict",
      why: `the suite did not finish in ${Math.round(SUITE_TIMEOUT_MS / 1000)} s — a wedged browser looks like this, and so would a hang this mutation caused: re-run to tell them apart`,
    };
  }
  // A suite that never reached the page measured nothing, whatever its exit code says.
  if (code === 3 || NO_BROWSER.test(output)) {
    return { verdict: "could-not-run", why: `the suite never ran (exit ${code})` };
  }
  // `caught` means the suite **failed** and named this defect. A suite that passes with the defect in place while
  // printing the phrase somewhere is not evidence, and treating it as evidence is how a contract lies.
  if (code !== 0 && expect.test(output)) {
    return { verdict: "caught" };
  }
  if (code === 0 && SEAL.test(output)) {
    return { verdict: "missed", why: "the suite PASSED with the defect in place" };
  }
  const firstFailure = (output.match(/AssertionError[^\n]*/) || [""])[0].slice(0, 160);
  return {
    verdict: "unexpected",
    why: code === 0
      ? "the suite exited 0 without its seal: it did not run the contracts it claims to"
      : `the suite failed, but not with ${expect}${firstFailure ? ` — it said: ${firstFailure}` : ""}`,
  };
}

// Each mutation is the **inverse** of a line in the fix, and each is expected to be caught by a named assertion.
const mutations = [
  {
    // The clause that was narrowed: put the whole trigger requirement back and a cue-only macro is un-enable-able
    // again — the exact thing that stopped the owner building one. The reason text changed with the half-set trigger
    // repair (v0.2.86: it now names the remedy), so this `from` follows the source; what it puts back is the old
    // behaviour, not the old words, and the assertion that catches it is the cue-only macro being refused at all.
    name: "the trigger clause that refuses a macro with no trigger of its own",
    file: PAGE,
    from: `        if (macroTriggerIsPartial(macro)) return \`trigger is half set - \${TRIGGER_PARTIAL_REMEDY}\`;`,
    to: `        if (macroTriggerIsPartial(macro) || macroTriggerIsEmpty(macro)) return \`trigger is half set - \${TRIGGER_PARTIAL_REMEDY}\`; // mutated`,
    suite: MACRO_EDIT_SUITE,
    expect: /must be complete, not incomplete/,
  },
  {
    // The label and the summary drifting apart is how the owner ended up afraid: the choice said "only a cue fires
    // it" while the row still said the macro was not configured.
    name: "a row that contradicts the trigger label it was chosen from",
    file: PAGE,
    from: `      const CUE_ONLY_SUMMARY = "CUE ONLY (no trigger of its own)";`,
    to: `      const CUE_ONLY_SUMMARY = "NOT CONFIGURED"; // mutated`,
    suite: MACRO_EDIT_SUITE,
    expect: /must say the cue-only choice, not NOT CONFIGURED/,
  },
  {
    // "Only a cue fires it" has to mean the cue really does. A macro that nothing could fire is a dead control,
    // not a feature, so the firing path is mutated as well.
    name: "the cue that no longer fires a macro with no trigger of its own",
    file: PAGE,
    from: `        const macro = macroLibrary.macros?.[index];`,
    to: `        const macro = macroTriggerIsEmpty(macroLibrary.macros?.[index]) ? null : macroLibrary.macros?.[index]; // mutated`,
    suite: CUE_SUITE,
    expect: /must still reach fire_macro/,
  },
  {
    // The row's chain never learns whether the clock is running — the first link of "why did this cue not fire", and
    // the one that explains every cue at once when a signal dies. The accessor answers `null` for it, so the tooltip
    // reports that the application cannot judge the thing it does know.
    name: "a row whose chain never learns whether the clock is running",
    file: PAGE,
    from: `            clockRunning: lastTimecodeState === null ? null : lastTimecodeState === "running",`,
    to: `            clockRunning: null, // mutated: the row is never told whether timecode is arriving`,
    suite: CUE_SUITE,
    expect: /the chain starts with the clock/,
  },
];

if (process.argv.includes("--self-test")) {
  const cases = [
    ["a suite that fails and names the defect", /must still reach fire_macro/, { code: 1, output: "AssertionError: must still reach fire_macro" }, "caught"],
    ["a suite that PASSES while printing the phrase", /must still reach fire_macro/, { code: 0, output: "must still reach fire_macro\nWING_BROWSER_SUITE_OK" }, "missed"],
    ["a suite with no browser", /anything/, { code: 3, output: "SKIP: no Chrome remote debugging on port 9223" }, "could-not-run"],
    ["a suite that ran out of time", /anything/, { code: 124, output: "", timedOut: true }, "no-verdict"],
    ["a suite that failed for another reason", /must say the cue-only choice/, { code: 1, output: "AssertionError: something else entirely" }, "unexpected"],
    ["a suite that exited 0 without its seal", /anything/, { code: 0, output: "no seal here" }, "unexpected"],
  ];
  let failed = 0;
  for (const [name, expect, result, want] of cases) {
    const got = classify(expect, result).verdict;
    if (got !== want) failed += 1;
    console.log(`${got === want ? "ok  " : "FAIL"} ${name}: expected ${want}, got ${got}`);
  }
  console.log(failed === 0 ? "the classifier answers every case correctly" : `${failed} classifier case(s) wrong`);
  process.exit(failed === 0 ? 0 : 1);
}

// Only one run at a time: two would interleave mutations of the same file and share the debug port. A lock left by a
// run that died is taken over, because a stale lock that blocks the check for ever is its own kind of failure.
const LOCK = join(tmpdir(), "wing-mutation-check-cue-only.lock");
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

// The bytes as they were found, and a copy outside the tree: nothing here restores from git.
const original = readFileSync(PAGE, "utf8");
const backupDir = mkdtempSync(join(tmpdir(), "wing-cue-only-mutation-"));
const backup = join(backupDir, basename(PAGE));
copyFileSync(PAGE, backup);
const restore = () => writeFileSync(PAGE, original);

let browser = null;
try {
  browser = await ensureBrowser();
} catch (error) {
  console.error(String(error.message || error));
  console.error("nothing was measured: this is not a verdict on any contract");
  rmSync(LOCK, { force: true });
  process.exit(1);
}

const results = [];
try {
  for (const mutation of mutations) {
    // Whatever the previous mutation left, this one starts from the file as it was found.
    restore();
    if (!original.includes(mutation.from)) {
      results.push({ name: mutation.name, verdict: "unexpected", why: "the mutation target was not found — this check is stale" });
      continue;
    }
    writeFileSync(PAGE, original.replace(mutation.from, mutation.to));
    const { code, output, timedOut } = run(mutation.suite);
    results.push({ name: mutation.name, ...classify(mutation.expect, { code, output, timedOut }) });
  }
} finally {
  // Whatever happened, put every byte back — and say so if the file is not what it was, because a check that
  // silently leaves a mutation behind is worse than no check.
  restore();
  if (readFileSync(PAGE, "utf8") !== original) {
    console.error(`desktop/ui/index.html could NOT be restored — its original bytes are in ${backup}`);
  } else {
    rmSync(backupDir, { recursive: true, force: true });
  }
  if (browser) {
    browser.child.kill("SIGKILL");
    rmSync(browser.profile, { recursive: true, force: true });
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
  `${counts.unexpected ? `, ${counts.unexpected} unexpected (the suite failed for another reason)` : ""}` +
  `${counts["could-not-run"] ? `, ${counts["could-not-run"]} could not run (nothing was measured)` : ""}` +
  `${counts["no-verdict"] ? `, ${counts["no-verdict"]} without a verdict (timed out)` : ""}`);

const allCaught = results.every((result) => result.verdict === "caught");
console.log(allCaught
  ? "every way the cue-only macro can be broken is caught by a test that fails when it is put back"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
