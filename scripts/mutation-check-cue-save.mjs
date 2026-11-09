// A mutation check for the Save control's contract: put each defect back, run the contract that is supposed to catch
// it, and demand a failure that names it. "The contract passes" is worth little on its own — the owner has watched a
// green gate ship a button he could not find, and the whole point of `test-desktop-cue-save-button-browser.mjs` is that
// it fails when the thing it describes breaks.
//
// The three defects are the three halves of what he asked for:
//
//   * the button never says it is unsaved (the session he lost: an edit, no save, a cue marked "broken");
//   * the reduced-motion guard is gone, so a user who asked for no animation gets a flashing control;
//   * the calm state is the neutral grey it used to be, so the action is not visible without hunting.
//
// Verdicts, never blurred: `caught` (the contract failed and named this defect), `MISSED` (the suite passed with the
// defect in place), `UNEXPECTED` (it failed for another reason, printed with the real assertion) and `COULD-NOT-RUN`
// (nothing was measured — no browser). `NO-VERDICT` means the suite ran out of time, which is an environment or a
// hang, not a statement about the contract.
//
// Run: node scripts/mutation-check-cue-save.mjs
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that mutates
// the working tree must never run inside a gate. It also **refuses to run on a dirty `cue-list.js`**, because it
// restores that file from git — which once destroyed uncommitted work elsewhere in this repository.

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = dirname(import.meta.dirname);
const PANEL = `${REPO}/desktop/ui/cue-list.js`;
const SUITE = "scripts/test-desktop-cue-save-button-browser.mjs";
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEAL = /WING_BROWSER_SUITE_OK/;
const NO_BROWSER = /SKIP: no Chrome remote debugging/;
// The gate gives a browser test 180 s. This runs the suite directly, so it bounds it itself: the known Chrome wedge on
// this machine looks exactly like a test that never returns.
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

/// Start our own headless Chrome when the port is silent, so a verdict never depends on who prepared what. Returns the
/// child to kill at the end, or null when an existing browser was reused.
async function ensureBrowser() {
  if (await browserAnswers()) {
    console.log(`using the browser already on port ${DEBUG_PORT}`);
    return null;
  }
  const profile = mkdtempSync(join(tmpdir(), "wing-cue-save-mutation-chrome-"));
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

function restore() {
  execFileSync("git", ["checkout", "--", "desktop/ui/cue-list.js"], { cwd: REPO });
}

/// Run the suite and say what happened to it, including how it exited — a suite that could not run is not a failure of
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

/// What a suite's result means for one mutation. Pure, so it can be checked without a browser.
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
  // printing the phrase somewhere is not evidence.
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

const mutations = [
  {
    name: "a Save button that never says anything is unsaved (the session the owner lost)",
    from: `saveButton.classList.toggle(SAVE_UNSAVED_CLASS, isDirty());`,
    to: `saveButton.classList.toggle(SAVE_UNSAVED_CLASS, false); /* mutated: the state never reaches the button */`,
    expect: /after a local edit the Save control must carry the unsaved state/,
  },
  {
    name: "a reduced-motion guard that is gone, so the pulse flashes at a user who asked for none",
    from: `{ animation: none; }`,
    to: `{ /* mutated: keeps pulsing for reduced motion */ }`,
    expect: /must not animate: a reduced-motion user must not get a flashing control/,
  },
  {
    name: "the neutral grey action colour the owner could not find",
    from: `background: #1c6f3c;`,
    to: `background: #c0c0c0;`,
    expect: /must still read as the action, not the neutral grey/,
  },
];

// The classifier's own cases. They need no browser and no clean tree, and they exist because the mistakes this kind of
// check has made before were all in this function.
if (process.argv.includes("--self-test")) {
  const cases = [
    ["a suite that fails and names the defect", /must not animate/, { code: 1, output: "AssertionError: must not animate: a reduced-motion user must not get a flashing control" }, "caught"],
    ["a suite that PASSES while printing the phrase", /must not animate/, { code: 0, output: "must not animate\nWING_BROWSER_SUITE_OK" }, "missed"],
    ["a suite with no browser", /anything/, { code: 3, output: "SKIP: no Chrome remote debugging on port 9223" }, "could-not-run"],
    ["a suite that ran out of time", /anything/, { code: 124, output: "", timedOut: true }, "no-verdict"],
    ["a suite that failed for another reason", /must not animate/, { code: 1, output: "AssertionError: something else entirely" }, "unexpected"],
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

// It restores `cue-list.js` from git between mutations, so **anything uncommitted in it is destroyed**. That happened
// once elsewhere in this repository, so the script refuses to run rather than risk it again.
const dirty = execFileSync("git", ["status", "--porcelain", "desktop/ui/cue-list.js"],
  { cwd: REPO, encoding: "utf8" }).trim();
if (dirty) {
  console.error("commit desktop/ui/cue-list.js first: this check restores it from git and would wipe your work");
  console.error(dirty);
  process.exit(2);
}

// Only one run at a time: two of them would interleave mutations of the same file. A lock left by a run that died is
// taken over, because a stale lock that blocks the check for ever is its own kind of failure.
const LOCK = join(tmpdir(), "wing-cue-save-mutation.lock");
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
      console.error(`another run of this check is using the tree (pid ${owner}); nothing was measured`);
      process.exit(2);
    }
    console.error(`taking over a lock left by pid ${owner}, which is not running any more`);
    writeFileSync(LOCK, String(process.pid));
  }
}
takeLock();

let browser = null;
try {
  browser = await ensureBrowser();
} catch (error) {
  console.error(String(error.message || error));
  console.error("nothing was measured: this is not a verdict on any contract");
  process.exit(1);
}

const results = [];
try {
  for (const mutation of mutations) {
    restore();
    const original = readFileSync(PANEL, "utf8");
    if (!original.includes(mutation.from)) {
      results.push({ name: mutation.name, verdict: "unexpected", why: "the mutation target was not found — the check is stale" });
      continue;
    }
    writeFileSync(PANEL, original.replace(mutation.from, mutation.to));
    const { code, output, timedOut } = run(SUITE);
    results.push({ name: mutation.name, ...classify(mutation.expect, { code, output, timedOut }) });
  }
} finally {
  // Whatever happened, leave the working tree as it was found.
  restore();
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
  ? "every defect the owner asked about is caught by a test that fails when it is put back"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
