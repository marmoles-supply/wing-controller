// The half-set trigger refusal's teeth, proved by putting each defect back.
//
// The owner tried to enable a macro whose trigger was half filled in. The refusal was correct — a
// partly configured trigger is unfinished and must never be enable-able — but the reason was the
// generic "trigger not configured", and the dialog's fixed tail talked about the **action target**,
// which was not his problem. Nothing told him the one thing that fixes it: finish the trigger, or
// clear it and choose the editor's own cue-only entry. He read the modal and concluded the feature
// was broken; a control that cannot tell the operator what to do is the failure this repository has
// already been bitten by twice.
//
// This check puts the two halves of the old wording back, one at a time, and demands a browser
// contract that fails and names it:
//
//   caught         the suite failed **and named this defect** — what we want
//   MISSED         the suite **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason, printed with the real assertion
//   COULD-NOT-RUN  nothing was measured (no browser, or a file changed under the check)
//   NO-VERDICT     the suite ran out of time — an environmental wedge, or a hang the mutation caused
//
// Run: node scripts/mutation-check-macro-trigger-wording.mjs
//      node scripts/mutation-check-macro-trigger-wording.mjs --self-test   (the classifier; no browser, no edits)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a
// check that mutates the tree must never run inside a gate. It does **not** restore from git — it
// copies the bytes aside first and writes them back whatever happens, so it is safe to run with
// uncommitted work in that file. It mutates **only** `desktop/ui/index.html`, and the restore
// refuses to overwrite a file whose bytes are neither the pre-run original nor what this check last
// wrote: another writer's work is left alone and reported (the guard copied from
// `mutation-check-multi-channel-target.mjs`, which learned it after a harness in this tree restored
// its own backup over a colleague's half-written file).

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = join(REPO, "desktop/ui/index.html");
const SUITE = "scripts/test-desktop-macro-edit-browser.mjs";
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEAL = /WING_BROWSER_SUITE_OK/;
const NO_BROWSER = /SKIP: no Chrome remote debugging/;
// The gate gives a browser suite 180 s. This runs it directly, so it bounds it itself: the known
// Chrome wedge on this machine looks exactly like a test that never returns.
const TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/** What a run's result means for one mutation. Pure, so `--self-test` can check it without a browser or a tree. */
export function classify(expect, { code, output, timedOut }) {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the suite did not finish in ${Math.round(TIMEOUT_MS / 1000)} s` };
  }
  // A suite that never reached the page measured nothing, whatever its exit code says.
  if (code === 3 || NO_BROWSER.test(output)) {
    return { verdict: "could-not-run", why: `the suite never ran (exit ${code})` };
  }
  // `caught` means the suite **failed** and named this defect. A suite that passes with the defect in
  // place while printing the phrase somewhere is not evidence, and treating it as evidence is how a
  // contract lies.
  if (code !== 0 && expect.test(output)) return { verdict: "caught" };
  if (code === 0 && SEAL.test(output)) return { verdict: "missed", why: "the suite PASSED with the defect in place" };
  const firstFailure = (output.match(/AssertionError[^\n]*/) || [""])[0].slice(0, 160);
  return {
    verdict: "unexpected",
    why: code === 0
      ? "the suite exited 0 without its seal: it did not run the contracts it claims to"
      : `the suite failed, but not with ${expect}${firstFailure ? ` — it said: ${firstFailure}` : ""}`,
  };
}

// Each mutation is the inverse of a line in the fix, and each is expected to be caught by a named
// assertion. The `to` text of the first one deliberately breaks the line so it can never be found
// again as the `from` of a later mutation.
const mutations = [
  {
    // The defect the owner reported, exactly: the reason names the state and hides the remedy.
    name: "a half-set trigger whose refusal does not name the remedy",
    from: `        if (macroTriggerIsPartial(macro)) return \`trigger is half set - \${TRIGGER_PARTIAL_REMEDY}\`;`,
    to: `        if (macroTriggerIsPartial(macro)) return "trigger is half set - finish it or clear it"; // mutated: the remedy is not named`,
    expect: /must name the remedy with the editor's own cue-only label/,
  },
  {
    // The other half of the report: the operator reads the closing line, and it sent him to the
    // action target while the trigger was the field he had left half finished.
    name: "the dialog tail that sends a half-set trigger to the action target",
    from: `        const closing = incompleteTrigger
          ? \`Set the trigger in the WHEN panel: \${TRIGGER_PARTIAL_REMEDY}, then enable it again.\`
          : "Set the action target in the step (or add a delay or HUD-alert step, which needs no target) and enable it again.";`,
    to: `        const closing = "Set the action target in the step (or add a delay or HUD-alert step, which needs no target) and enable it again."; // mutated: every reason gets the target advice`,
    expect: /must point a half-set trigger at the WHEN panel/,
  },
];

if (process.argv.includes("--self-test")) {
  const cases = [
    ["a suite that fails and names the defect", /must name the remedy/, { code: 1, output: "AssertionError: must name the remedy with the editor's own cue-only label" }, "caught"],
    ["a suite that PASSES while printing the phrase", /must name the remedy/, { code: 0, output: "must name the remedy\nWING_BROWSER_SUITE_OK" }, "missed"],
    ["a suite with no browser", /anything/, { code: 3, output: "SKIP: no Chrome remote debugging on port 9223" }, "could-not-run"],
    ["a suite that ran out of time", /anything/, { code: 124, output: "", timedOut: true }, "no-verdict"],
    ["a suite that failed for another reason", /must point a half-set trigger at the WHEN panel/, { code: 1, output: "AssertionError: something else entirely" }, "unexpected"],
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

/** Is there a browser answering on the debug port? One that answers is somebody else's and is left alone. */
async function browserAnswers() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch (_) {
    return false;
  }
}

/** Start our own headless Chrome when the debug port is silent, so a verdict never depends on who prepared what. */
async function ensureBrowser() {
  if (await browserAnswers()) {
    console.log(`using the browser already on port ${DEBUG_PORT}`);
    return null;
  }
  const profile = mkdtempSync(join(tmpdir(), "wing-trigger-wording-chrome-"));
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

function runSuite() {
  try {
    const output = execFileSync("node", [SUITE], {
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
    return { code: typeof error.status === "number" ? error.status : 1, output };
  }
}

// Only one run at a time: two would interleave mutations of the same file and each would restore the
// other's bytes. A lock left by a run that died is taken over, because a stale lock blocks for ever.
const LOCK = join(tmpdir(), "wing-mutation-check-macro-trigger-wording.lock");
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
      } catch (_) {
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
// `written` remembers the bytes this check itself put into the page, so the restore can tell its own
// mutation from another writer's work — a harness in this tree restored its own backup over a
// colleague's half-written file twice in one day, and this one must never do that.
const original = readFileSync(PAGE, "utf8");
const backupDir = mkdtempSync(join(tmpdir(), "wing-macro-trigger-wording-mutation-"));
copyFileSync(PAGE, join(backupDir, basename(PAGE)));
let written = null;
let foreign = false;

/** Puts the page back to the bytes this check found, and refuses to touch bytes it did not write. */
function restore() {
  const current = readFileSync(PAGE, "utf8");
  if (current === original) {
    written = null;
    return;
  }
  if (written !== null && current === written) {
    writeFileSync(PAGE, original);
    written = null;
    return;
  }
  foreign = true;
}

const browser = await ensureBrowser().catch((error) => {
  console.error(String(error.message || error));
  console.error("nothing was measured: this is not a verdict on any contract");
  rmSync(LOCK, { force: true });
  process.exit(1);
});

console.log(`the file this check will mutate and restore from its own byte copy: ${basename(PAGE)}`);
console.log(`pre-run copy, kept if anything is left alone: ${backupDir}`);

const results = [];
try {
  for (const mutation of mutations) {
    // Whatever the previous mutation left, this one starts from the file as it was found. A file that
    // changed under us is skipped rather than overwritten.
    restore();
    if (foreign) {
      results.push({
        name: mutation.name,
        verdict: "could-not-run",
        why: `${basename(PAGE)} changed while this check was running; its bytes were left alone`,
      });
      continue;
    }
    if (!original.includes(mutation.from)) {
      results.push({ name: mutation.name, verdict: "unexpected", why: "the mutation target was not found — this check is stale" });
      continue;
    }
    // One more look before this write: a file that changed between the restore above and here belongs
    // to somebody else, and overwriting it is exactly the accident this guard exists to prevent.
    if (readFileSync(PAGE, "utf8") !== original) {
      foreign = true;
      results.push({
        name: mutation.name,
        verdict: "could-not-run",
        why: `${basename(PAGE)} changed while this check was running; its bytes were left alone`,
      });
      continue;
    }
    const mutated = original.replace(mutation.from, mutation.to);
    writeFileSync(PAGE, mutated);
    written = mutated;
    results.push({ name: mutation.name, ...classify(mutation.expect, runSuite()) });
  }
} finally {
  // Whatever happened, put every byte back — but never over a file that changed under this check, and
  // say so if the file is not what it was, because a check that silently leaves a mutation behind (or
  // silently eats someone else's edit) is worse than no check at all.
  restore();
  if (foreign) {
    console.error(`${PAGE} changed while this check was running and was LEFT AS IT IS (the pre-run bytes are in ${backupDir})`);
  } else if (readFileSync(PAGE, "utf8") !== original) {
    console.error(`${PAGE} could NOT be restored — its original bytes are in ${backupDir}`);
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
  `${counts.unexpected ? `, ${counts.unexpected} unexpected (a contract failed for another reason)` : ""}` +
  `${counts["could-not-run"] ? `, ${counts["could-not-run"]} could not run (nothing was measured)` : ""}` +
  `${counts["no-verdict"] ? `, ${counts["no-verdict"]} without a verdict (timed out)` : ""}`);

const allCaught = results.every((result) => result.verdict === "caught");
console.log(allCaught
  ? "every way the refusal can hide the remedy is caught by a contract that fails when it is put back"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
