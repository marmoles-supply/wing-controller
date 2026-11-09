// The teeth of the courtesy-notice contracts, proved by putting each defect back.
//
// The notice became adjustable from Settings (size, duration, accent colour, flash), and three of those
// settings can fail in a way that looks like success:
//
//   * the **accent** must not be able to repaint a failure. The red of a failed action and the blue of a
//     test are set inline in `showCourtesyNotice`, so they beat the accent on specificity. Let the accent
//     win and a card reporting a failed action reads as an ordinary notice — a report that lies, which is
//     this project's cardinal defect;
//   * the **size** slider must move the card on screen, not merely the preference. A slider wired to a
//     value that never reaches the stylesheet is the owner's own phrase for the class of bug that reached
//     him twice: a control that appears to work and does nothing;
//   * the **flash** must be off by default. Anything that blinks is a photosensitivity surface, so the
//     safe default is itself a contract, and a default that drifts to "on" would be invisible until it
//     mattered.
//
// Deliberately **not** named `test-*.mjs`: the gate runs that prefix, and this script mutates the tree.
// It reports one of four verdicts and never blurs them:
//
//   caught          the contract failed, and named the defect
//   MISSED          the contract **passed** with the defect in place
//   UNEXPECTED      it failed for another reason, printed with the real assertion
//   COULD-NOT-RUN   nothing was measured (no browser, or the file changed under it)
//
// It takes **byte copies** and restores from those bytes, never from git: the sibling that restored from
// git destroyed uncommitted work once. It restores only a file that still holds the bytes this run wrote,
// and it starts its own headless Chrome when the debug port is silent, killing only the browser it started.

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TARGET = "desktop/ui/index.html";
const SUITE = "scripts/test-desktop-hud-panic-browser.mjs";
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEAL = /WING_BROWSER_SUITE_OK/;
// The gate gives a browser suite 180 s; this runs one directly, so it bounds it itself. The known Chrome
// wedge on this machine looks exactly like a test that never returns.
const SUITE_TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);

/// Each mutation puts one defect back, and names the assertion that must catch it.
const MUTATIONS = [
  {
    id: "M-C1",
    what: "the operator's accent repaints a failed action, so a failure reads as an ordinary notice",
    from: `          ? ' style="background: #8b0000; color: #fff;"'`,
    to: `          ? ''`,
    snippet: "must keep the app's red",
  },
  {
    id: "M-C2",
    what: "the size slider moves the preference but never reaches the card",
    from: `        container.style.setProperty("--courtesy-scale", String(prefs.scale));`,
    to: `        void prefs.scale;`,
    snippet: "must enlarge the rendered card",
  },
  {
    id: "M-C3",
    what: "every notice flashes whether the operator asked for it or not",
    from: `        if (prefs.flash === "always" || (prefs.flash === "error" && isError)) {`,
    to: `        if (true) {`,
    snippet: "must be off by default",
  },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browserAnswers() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/// Start our own headless Chrome if the port is silent, so the verdict does not depend on who prepared
/// what. Returns the child and profile to clean up, or null when an existing browser was reused.
async function ensureBrowser() {
  if (await browserAnswers()) {
    console.log(`using the browser already on port ${DEBUG_PORT}`);
    return null;
  }
  const profile = mkdtempSync(join(tmpdir(), "wing-courtesy-mutation-chrome-"));
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
  console.log(`COULD-NOT-RUN: no browser on port ${DEBUG_PORT} and ${CHROME_BIN} did not start one`);
  return { failed: true };
}

/// Run the suite and say what happened to it, including how it exited: a suite that could not run gives no
/// verdict about the contract, and that difference has to survive into the report.
function runSuite() {
  try {
    const output = execFileSync("node", [SUITE], {
      cwd: ROOT,
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
export function classify({ code, output, timedOut, snippet }) {
  if (timedOut) return "COULD-NOT-RUN (the suite did not finish)";
  if (code === 3 || /SKIP: no Chrome remote debugging/.test(output)) {
    return "COULD-NOT-RUN (no browser)";
  }
  const passed = code === 0 && SEAL.test(output);
  if (passed) return "MISSED";
  if (snippet && output.includes(snippet)) return "caught";
  const assertion = (output.match(/AssertionError[^\n]*|assertion[^\n]*|Error: [^\n]*/) || [""])[0];
  return assertion ? `UNEXPECTED (${assertion})` : "UNEXPECTED";
}

function selfTest() {
  const cases = [
    [{ code: 1, output: "AssertionError: a failed action must keep the app's red (got rgb(255, 0, 170))", snippet: "must keep the app's red" }, "caught"],
    [{ code: 0, output: "5b. ...\nWING_BROWSER_SUITE_OK", snippet: "must keep the app's red" }, "MISSED"],
    [{ code: 1, output: "SyntaxError: Unexpected token", snippet: "must keep the app's red" }, "UNEXPECTED"],
    [{ code: 124, output: "", timedOut: true, snippet: "x" }, "COULD-NOT-RUN"],
    [{ code: 3, output: "SKIP: no Chrome remote debugging on port 9223", snippet: "x" }, "COULD-NOT-RUN"],
    // An exit-0 run WITHOUT the seal is not a pass: the gate learned this the hard way, and so must we.
    [{ code: 0, output: "skipped", snippet: "x" }, "UNEXPECTED"],
  ];
  let ok = 0;
  for (const [input, expected] of cases) {
    const got = classify(input);
    const fine = expected === "caught" ? got === "caught"
      : expected === "MISSED" ? got === "MISSED"
        : got.startsWith(expected === "UNEXPECTED" ? "UNEXPECTED" : "COULD-NOT-RUN");
    if (fine) ok += 1;
    else console.log(`  classifier self-test: expected ${expected}, got ${got}`);
  }
  console.log(`classifier self-test: ${ok}/${cases.length}`);
  return ok === cases.length;
}

async function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);

  const original = readFileSync(join(ROOT, TARGET), "utf8");
  const backup = mkdtempSync(join(tmpdir(), "wing-courtesy-mutation-"));
  writeFileSync(join(backup, "index.html"), original);
  console.log(`backup: ${backup}/index.html`);

  const browser = await ensureBrowser();
  if (browser?.failed) {
    console.log("COULD-NOT-RUN: nothing was measured.");
    process.exit(1);
  }

  const results = [];
  try {
    const baseline = runSuite();
    if (baseline.code !== 0 || !SEAL.test(baseline.output)) {
      const verdict = classify({ ...baseline, snippet: "" });
      console.log(`COULD-NOT-RUN: the contract does not pass before any mutation — ${verdict}`);
      console.log(baseline.output.slice(-1200));
      results.push({ id: "baseline", verdict: "COULD-NOT-RUN" });
      return;
    }
    console.log("baseline: the contract passes");

    for (const mutation of MUTATIONS) {
      const occurrences = original.split(mutation.from).length - 1;
      if (occurrences !== 1) {
        results.push({ id: mutation.id, verdict: `COULD-NOT-RUN (anchor found ${occurrences} times)` });
        continue;
      }
      const mutated = original.replace(mutation.from, mutation.to);
      writeFileSync(join(ROOT, TARGET), mutated);
      const outcome = runSuite();
      results.push({
        id: mutation.id,
        verdict: classify({ ...outcome, snippet: mutation.snippet }),
        what: mutation.what,
      });

      // Restore only what this script wrote. A foreign change means a concurrent writer, and clobbering
      // it is how work is lost: leave it alone and say so.
      const now = readFileSync(join(ROOT, TARGET), "utf8");
      if (now === mutated) {
        writeFileSync(join(ROOT, TARGET), original);
      } else {
        console.log(`REFUSING to restore ${TARGET}: it changed while this ran. Backup: ${backup}/index.html`);
        break;
      }
    }
  } finally {
    const now = readFileSync(join(ROOT, TARGET), "utf8");
    const written = MUTATIONS.map((m) => original.replace(m.from, m.to));
    if (now !== original && !written.includes(now)) {
      console.log(`left ${TARGET} untouched: it holds bytes this script did not write (backup: ${backup}/index.html)`);
    } else if (now !== original) {
      writeFileSync(join(ROOT, TARGET), original);
      console.log(`${TARGET} restored from the bytes taken at the start`);
    }
    if (browser) {
      browser.child.kill("SIGKILL");
      rmSync(browser.profile, { recursive: true, force: true });
      console.log("stopped the browser this check started");
    }
  }

  console.log("\n==== summary ====");
  for (const result of results) {
    console.log(`${result.id}   ${result.verdict}${result.what ? ` :: ${result.what}` : ""}`);
  }
  const missed = results.filter((r) => String(r.verdict).startsWith("MISSED")).length;
  const couldNot = results.filter((r) => String(r.verdict).startsWith("COULD-NOT-RUN")).length;
  console.log(`caught ${results.filter((r) => r.verdict === "caught").length}/${results.length}`);
  process.exit(missed > 0 || couldNot > 0 ? 1 : 0);
}

main();
