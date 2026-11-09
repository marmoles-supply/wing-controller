// A mutation check for the review harness: put each defect the owner found back, run the contract that is supposed to
// catch it, and demand a failure that names it.
//
// "The tests pass" is worth very little on its own — the owner has watched builds pass a green gate and not work.
// What makes a test worth something is that it **fails when the thing it describes is broken**. So this puts each of
// the five defects back, one at a time, restores the files from git afterwards whatever happens, and reports one of:
//
//   caught         the contract failed **and named this defect** — what we want
//   missed         the suite **passed** with the defect in place — the contract is toothless
//   unexpected     the suite failed, but for a reason other than this defect — investigate, do not ignore
//   could-not-run  the suite never measured anything (no browser) — **not** a verdict on the contract
//   no-verdict     the suite ran out of time — an environmental wedge or a hang this mutation caused; re-run
//
// The first version conflated the last case with `missed`: run without a browser it printed five MISSED, which read as
// "these defects would pass unnoticed" when the truth was "nothing was measured" — and it contradicted a green run
// from a session that had prepared a browser by hand. A verdict that depends on the environment is not a verdict, so
// this now starts its own headless Chrome when the debug port is silent (and leaves alone one that already answers),
// and kills only the browser it started.
//
// Run: node scripts/mutation-check-interapp.mjs
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that mutates
// the working tree must never run inside a gate. It also **refuses to run on a dirty tree**, because it restores the
// two UI files from git — which once destroyed uncommitted work.

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = dirname(import.meta.dirname);
const PAGE = `${REPO}/desktop/ui/index.html`;
const CLOCK = `${REPO}/desktop/ui/timecode.html`;
const HARNESS = "scripts/test-desktop-interapp-smoke-browser.mjs";
const CLOCK_SUITE = "scripts/test-desktop-timecode-clock-browser.mjs";
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEAL = /WING_BROWSER_SUITE_OK/;
const NO_BROWSER = /SKIP: no Chrome remote debugging/;
// The gate gives a browser test 180 s. This runs suites directly, so it has to bound them itself: the known Chrome
// wedge on this machine looks exactly like a test that never returns.
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
  const profile = mkdtempSync(join(tmpdir(), "wing-mutation-chrome-"));
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
  execFileSync("git", ["checkout", "--", "desktop/ui/index.html", "desktop/ui/timecode.html"], { cwd: REPO });
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
    // A suite killed by its own timeout gives no verdict about the contract, and saying otherwise would be the same
    // mistake as calling an unmeasured run "MISSED".
    if (error.killed || error.signal === "SIGKILL" || error.code === "ETIMEDOUT") {
      return { code: 124, output, timedOut: true };
    }
    return { code: typeof error.status === "number" ? error.status : 1, output };
  }
}

/// What a suite's result means for one mutation. Pure, so it can be checked without a browser — this logic has been
/// wrong twice already (once calling an unmeasured run `MISSED`, once about to call an exit-0 suite `caught`).
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

const mutations = [
  {
    name: "a dead Add an application button (the bug the owner pressed)",
    file: PAGE,
    from: `<button type="button" id="inter-app-peer-add"`,
    to: `<button type="button" id="inter-app-peer-add" disabled`,
    suite: HARNESS,
    // Caught twice over, and the first is the one the owner lived: a disabled button does nothing when pressed, so
    // the press step fails because the click never reached the backend — which is the whole symptom. The generic
    // "no disabled button" contract would catch it as well, if a press ever stopped being the first thing to notice.
    expect: /Add an application: it did not reach the backend|disabled placeholder/,
  },
  {
    name: "a handler that goes nowhere (the Settings… bug)",
    file: PAGE,
    from: `document.getElementById("btn-open-timecode-settings")?.addEventListener("click", () => openSettingsOn("timecode"));`,
    to: `document.getElementById("btn-open-timecode-settings")?.addEventListener("click", () => { /* mutated: does nothing */ });`,
    suite: HARNESS,
    expect: /must open Settings/,
  },
  {
    name: "a readout that overflows its window (the broken clock)",
    file: CLOCK,
    from: `font-size: clamp(22px, 7vw, 52px);`,
    to: `font-size: 92px;`,
    suite: CLOCK_SUITE,
    expect: /must fit its own box/,
  },
  {
    name: "a readout that leaves the well empty (the owner's \"no timer\")",
    file: CLOCK,
    from: `position.textContent = snapshot?.position || "--:--:--:--";`,
    to: `position.textContent = snapshot?.position || "";`,
    suite: CLOCK_SUITE,
    expect: /must show its placeholders/,
  },
  {
    name: "a clock that ignores the application's theme (the owner's light grey popup)",
    file: CLOCK,
    from: `      document.body.classList.toggle("theme-dark", theme === "dark");`,
    to: `      /* mutated: ignores the theme */`,
    suite: CLOCK_SUITE,
    expect: /dark theme must reach the clock/,
  },
];

// The classifier's own cases. They run before anything else, need no browser and no clean tree, and they exist
// because both of the mistakes this check has made were in this function.
if (process.argv.includes("--self-test")) {
  const cases = [
    ["a suite that fails and names the defect", /must open Settings/, { code: 1, output: "AssertionError: must open Settings" }, "caught"],
    ["a suite that PASSES while printing the phrase", /must open Settings/, { code: 0, output: "must open Settings\nWING_BROWSER_SUITE_OK" }, "missed"],
    ["a suite with no browser", /anything/, { code: 3, output: "SKIP: no Chrome remote debugging on port 9223" }, "could-not-run"],
    ["a suite that ran out of time", /anything/, { code: 124, output: "", timedOut: true }, "no-verdict"],
    ["a suite that failed for another reason", /must fit its own box/, { code: 1, output: "AssertionError: something else entirely" }, "unexpected"],
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

// It restores these two files from git between mutations, so **anything uncommitted in them is destroyed**. That
// happened once, to the clock's theme and placeholders, so the script now refuses to run rather than risk it again.
const dirty = execFileSync("git", ["status", "--porcelain", "desktop/ui/index.html", "desktop/ui/timecode.html"],
  { cwd: REPO, encoding: "utf8" }).trim();
if (dirty) {
  console.error("commit index.html and timecode.html first: this check restores them from git and would wipe your work");
  console.error(dirty);
  process.exit(2);
}

// Only one run at a time: two of them would interleave mutations of the same two files and share the debug port, and
// the second would restore the first's work from git underneath it. A lock left by a run that died is taken over,
// because a stale lock that blocks the check for ever is its own kind of failure.
const LOCK = join(tmpdir(), "wing-mutation-check.lock");
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
    const original = readFileSync(mutation.file, "utf8");
    if (!original.includes(mutation.from)) {
      results.push({ name: mutation.name, verdict: "unexpected", why: "the mutation target was not found — the check is stale" });
      continue;
    }
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    const { code, output, timedOut } = run(mutation.suite);
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
  ? "every defect the owner found is caught by a test that fails when it is put back"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
