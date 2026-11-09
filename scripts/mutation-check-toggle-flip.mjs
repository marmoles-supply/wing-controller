// The teeth of the toggle contracts, proved by putting each defect back.
//
// `scripts/test-desktop-ui-contracts.mjs` (source shape, no browser) and
// `scripts/test-desktop-action-target-browser.mjs` (the rendered Shoot card) assert what a toggle step
// puts on the wire and what the operator is told about it. "The contract passes" is worth little on its
// own — the project's rule is that a contract without a mutation is a contract nobody has proved has
// teeth. This script is that proof: it edits `main.rs` and `index.html` back to the defective shape, one
// mutation at a time, runs the contract that owns that property, and demands that it **fails naming the
// defect**. Each mutation is caught by a different named assertion, so a green table means distinct
// properties are defended, not one assertion observed five times.
//
// Verdicts, never blurred:
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the contract **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason, printed with the assertion that actually fired
//   COULD-NOT-RUN  nothing was measured (the suite could not run, the browser could not be started, or a
//                  file was left alone because it is somebody else's)
//
// Run: node scripts/mutation-check-toggle-flip.mjs
//      node scripts/mutation-check-toggle-flip.mjs --self-test   (the classifier and the restore guard)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check
// that mutates the working tree must never run inside a gate. It takes **byte copies** of the two files it
// rewrites and restores from those bytes, never from git — a mutation harness in this repository restored
// from git once and destroyed uncommitted work — so it is safe to run before the fix is committed. What it
// refuses to do is overwrite a file that a **concurrent writer** changed while the check was running: see
// `planRestore`, which is also proved by `--self-test`.
//
// The one browser mutation measures its own environment: it uses the Chrome already on the debug port, or
// starts its own with a fresh profile and kills only the browser it started (the project rule the LTC
// stream check learned the hard way). With no Chrome at all it reports COULD-NOT-RUN rather than MISSED,
// because "the defect would pass unnoticed" and "nothing was measured" are different sentences.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = join(REPO, "desktop/src-tauri/src/main.rs");
const UI = join(REPO, "desktop/ui/index.html");
const SOURCE_SUITE = join(REPO, "scripts/test-desktop-ui-contracts.mjs");
const BROWSER_SUITE = join(REPO, "scripts/test-desktop-action-target-browser.mjs");
const CHROME_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LOCK = join(tmpdir(), "wing-mutation-check-toggle-flip.lock");
// The source suite reads files and asserts; it needs no browser and no hardware. It is still bounded,
// because a check that hangs is indistinguishable from a check that found something.
const TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 120_000);

/** What a run's result means for one mutation. Pure, so `--self-test` can check it with no tree and no suite. */
export function classify(expect, { code, output, timedOut }) {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the contract did not finish in ${Math.round(TIMEOUT_MS / 1000)} s` };
  }
  if (code === null) {
    return { verdict: "could-not-run", why: "the contract could not be started: nothing was measured" };
  }
  // `caught` means the contract **failed** and named this defect. A contract that passes with the defect in
  // place while printing the phrase somewhere is not evidence.
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

// Each mutation is the inverse of one property a toggle contract defends. `from`/`to` are exact source
// text: a mutation whose target is not found is reported as stale rather than silently skipped.
//
// The first five are read by the source suite, which needs no browser; the sixth is the rendered card and
// is read by the browser suite.
const sourceMutations = [
  {
    // The owner's report, in one line: the packet carries the value the step was authored with instead of
    // the documented `-1`. This is what `/ch/11/in/set/altsrc int=0` looked like on the wire.
    name: "a toggle that sends the step's stored value instead of the documented -1",
    file: MAIN,
    from: `    toggled.value = "-1".to_string();`,
    to: `    // mutated: the value the step was authored with, which a toggle never sends
    toggled.value = step.value.clone();`,
    expect: /a toggle step must send the documented -1/,
  },
  {
    // The read that `b7f71e37` removed, back in the executor: it costs a round trip and it is the
    // behaviour Maillot's special case exists to avoid.
    name: "the toggle executor reading the live value first",
    file: MAIN,
    from: `    toggled.native_toggle = true;`,
    to: `    // mutated: read the state first, the round trip the -1 exists to avoid
    let _current = read_leaf_state(hub, wing_ip, &step.address, stream_stop, action_stop)?;
    toggled.native_toggle = true;`,
    expect: /the toggle path must not read the console first/,
  },
  {
    // The fallback executor kept beside the real one until 2026-10-05. It is the shape that made the read
    // look present in the source while the wire already carried `-1`.
    name: "the read-and-invert executor coming back",
    file: MAIN,
    from: `fn execute_toggle_step(\n    app: Option<&tauri::AppHandle>,`,
    to: `#[allow(dead_code)]
fn execute_toggle_step_by_reading() {}

fn execute_toggle_step(
    app: Option<&tauri::AppHandle>,`,
    expect: /the read-and-invert toggle executor must not come back/,
  },
  {
    // The inversion that fallback computed here, rather than letting the console own the value.
    name: "the binary inversion computed in the application",
    file: MAIN,
    from: `fn read_leaf_state(\n    hub: &UdpHub,`,
    to: `#[allow(dead_code)]
fn inverted_binary_state(value: &OscStateValue) -> Option<&'static str> {
    let _ = value;
    None
}

fn read_leaf_state(
    hub: &UdpHub,`,
    expect: /and neither must the inversion it computed here/,
  },
  {
    // The read-back of a flip: an expected value for a write whose result the console decided. Without the
    // exemption, every toggle waits for and reads an answer that cannot confirm it.
    name: "a native toggle given an expected value, so it is read back",
    file: MAIN,
    from: `    if step.native_toggle {
        return None;
    }`,
    to: `    // mutated: the exemption is gone, so a toggle is read back like a set`,
    expect: /a native toggle must have no expected value/,
  },
  {
    // The card printing the value the step stores. This is the exact line the owner photographed:
    // `/ch/11/in/set/altsrc int=0` for a packet that carried `,i -1`.
    name: "the Shoot card reporting the stored value a toggle never sends",
    file: UI,
    from: `          actionText = actionWireText(noticeMode, noticeAddress, kind, value);`,
    to: `          // mutated: the value the step stores, which a toggle never sends
          actionText = \`\${noticeAddress || '(no action target)'} \${kind}=\${value}\`;`,
    expect: /the Shoot card must print the wire text, not the stored value/,
  },
  {
    // The other half of an honest toggle: a step that cannot be a `-1` must be **refused with a reason**,
    // never quietly run as a write of the value it stores.
    name: "a toggle on a parameter that is not on/off, no longer refused",
    file: MAIN,
    from: `            if kind.as_deref() != Some("toggle") {
                problems.push(format!(
                    "{label}: toggle needs an on/off parameter; {} is not one.",
                    step.target_parameter
                ));`,
    to: `            // mutated: nothing refuses it, so a step that cannot flip runs as a write of what it holds
            if false {
                problems.push(format!(
                    "{label}: a message nothing prints",
                    step.target_parameter
                ));`,
    expect: /the validator must still refuse a toggle on a parameter that is not on\/off/,
  },
];

const browserMutations = [
  {
    // The same defect as the last one, read where the owner read it: the rendered card. The source suite
    // catches the shape; this proves the operator-visible text.
    name: "the rendered Shoot card showing the stored value of a toggle (browser)",
    file: UI,
    from: `          actionText = actionWireText(noticeMode, noticeAddress, kind, value);`,
    to: `          // mutated: the value the step stores, which a toggle never sends
          actionText = \`\${noticeAddress || '(no action target)'} \${kind}=\${value}\`;`,
    expect: /the Shoot card must say the toggle sends -1/,
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
    ["a contract that fails and names the defect", /must send the documented -1/, { code: 1, output: "AssertionError [ERR_ASSERTION]: a toggle step must send the documented -1, never the value the step was authored with" }, "caught"],
    ["a contract that PASSES while printing the phrase", /must send the documented -1/, { code: 0, output: "a toggle step must send the documented -1\ndesktop UI contracts passed" }, "missed"],
    ["a contract that failed for another reason", /must send the documented -1/, { code: 1, output: "AssertionError [ERR_ASSERTION]: something else entirely" }, "unexpected"],
    ["a contract that could not be started", /anything/, { code: null, output: "" }, "could-not-run"],
    ["a contract that ran out of time", /anything/, { code: 124, output: "", timedOut: true }, "no-verdict"],
  ];
  let failed = 0;
  for (const [name, expect, result, want] of cases) {
    const got = classify(expect, result).verdict;
    if (got !== want) failed += 1;
    console.log(`${got === want ? "ok  " : "FAIL"} classifier — ${name}: expected ${want}, got ${got}`);
  }

  // The restore guard, exercised for real on files outside the tree: a file this check wrote is put back, a
  // file a foreign writer changed is left exactly as it is.
  const dir = mkdtempSync(join(tmpdir(), "wing-toggle-guard-self-test-"));
  const file = join(dir, "sample.html");
  try {
    const original = "const a = -1;\n";
    const mutated = "const a = 0;\n";
    const foreignBytes = "const a = -1;\n// written by somebody else\n";
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

/** Run one contract suite and say what happened, including how it exited — a suite that could not run measured nothing. */
function runSuite(suite) {
  try {
    const output = execFileSync("node", [suite], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
      killSignal: "SIGKILL",
      env: { ...process.env, WING_CHROME_PORT: String(CHROME_PORT) },
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

// Only one run at a time: two would interleave mutations of the same file and each would restore the other's
// bytes. A lock left by a run that died is taken over, because a stale lock that blocks for ever is its own
// kind of failure.
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

// Every file a mutation can touch, its bytes, and a copy outside the tree. Nothing is restored from git: the
// normal way to run this check is **before** the fix is committed, and those uncommitted bytes are the ones to
// keep.
const originals = new Map([MAIN, UI].map((file) => [file, readFileSync(file, "utf8")]));
const backupDir = mkdtempSync(join(tmpdir(), "wing-toggle-mutation-"));
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

// --- The browser this check may have to start itself -----------------------------------------------
//
// The rendered-card contract needs Chrome on the debug port. The project rule is that a mutation check
// measures its own environment instead of inheriting whatever a human happened to start: it uses the
// browser already there, starts its own with a fresh profile when the port is silent, and kills **only**
// the one it started.

function chromeAlive() {
  try {
    execFileSync("curl", ["-s", "--max-time", "3", "-o", "/dev/null", `http://127.0.0.1:${CHROME_PORT}/json/version`]);
    return true;
  } catch {
    return false;
  }
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
let startedChrome = null;
let chromeProfile = null;

async function ensureChrome() {
  if (chromeAlive()) return "the browser already on the debug port";
  if (!existsSync(CHROME_BIN)) return null;
  chromeProfile = mkdtempSync(join(tmpdir(), "wing-toggle-mutation-chrome-"));
  // Its own process group, so the kill below reaches this browser and nothing else (`--headless=new` spawns
  // children; killing the group is the only way they all go).
  const child = spawn(CHROME_BIN, [
    "--headless=new",
    `--remote-debugging-port=${CHROME_PORT}`,
    `--user-data-dir=${chromeProfile}`,
    "about:blank",
  ], { detached: true, stdio: "ignore" });
  child.unref();
  startedChrome = child.pid;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (chromeAlive()) return `a browser this check started (pid ${child.pid}, profile ${chromeProfile})`;
    await wait(500);
  }
  return null;
}

function stopStartedChrome() {
  if (startedChrome === null) return;
  try {
    process.kill(-startedChrome, "SIGKILL");
  } catch {
    try {
      process.kill(startedChrome, "SIGKILL");
    } catch {}
  }
  startedChrome = null;
}

/** Run one mutation: restore first, refuse a file that moved, write the defect, run the suite, report. */
function runMutation(mutation, suite) {
  restoreAll();
  if (foreign.has(mutation.file)) {
    return {
      name: mutation.name,
      verdict: "could-not-run",
      why: `${basename(mutation.file)} changed while this check was running; its bytes were left alone`,
    };
  }
  const original = originals.get(mutation.file);
  if (!original.includes(mutation.from)) {
    return { name: mutation.name, verdict: "unexpected", why: "the mutation target was not found — this check is stale" };
  }
  // One more look before this write: a file that changed between the restore above and here belongs to
  // somebody else, and overwriting it is exactly the accident this guard exists to prevent.
  if (readFileSync(mutation.file, "utf8") !== original) {
    foreign.add(mutation.file);
    return {
      name: mutation.name,
      verdict: "could-not-run",
      why: `${basename(mutation.file)} changed while this check was running; its bytes were left alone`,
    };
  }
  const mutated = original.replace(mutation.from, mutation.to);
  writeFileSync(mutation.file, mutated);
  written.set(mutation.file, mutated);
  return { name: mutation.name, ...classify(mutation.expect, runSuite(suite)) };
}

console.log(`files this check writes and restores from its own byte copies: ${[...originals.keys()].map((file) => basename(file)).join(", ")}`);
console.log(`pre-run copies, kept if anything is left alone: ${backupDir}`);

const results = [];
try {
  // A mutation table is only as good as the tree it runs against: if the contract does not pass unmutated,
  // every verdict below would be describing the tree instead of a defect, so say that and measure nothing.
  const baseline = runSuite(SOURCE_SUITE);
  if (baseline.code !== 0) {
    console.error(`the source contract does not pass on the tree as it stands (exit ${baseline.code}): nothing was measured`);
    console.error((baseline.output.match(/AssertionError[^\n]*/) || [""])[0]);
    process.exitCode = 1;
    throw new Error("baseline");
  }
  console.log("the source contract passes on the tree as it stands: its mutations are measured against a green baseline");

  for (const mutation of sourceMutations) {
    results.push(runMutation(mutation, SOURCE_SUITE));
  }

  // The rendered card: the one contract that needs the browser, measured against a browser this check
  // either found or started. No browser is COULD-NOT-RUN, never MISSED.
  const browser = await ensureChrome();
  if (browser === null) {
    results.push({
      name: browserMutations[0].name,
      verdict: "could-not-run",
      why: `no Chrome answered on port ${CHROME_PORT} and none could be started: nothing was measured`,
    });
  } else {
    console.log(`the rendered-card contract runs against ${browser}`);
    const browserBaseline = runSuite(BROWSER_SUITE);
    if (browserBaseline.code !== 0) {
      results.push({
        name: browserMutations[0].name,
        verdict: "could-not-run",
        why: `the browser contract does not pass unmutated on this tree (exit ${browserBaseline.code}): nothing was measured`,
      });
    } else {
      results.push(runMutation(browserMutations[0], BROWSER_SUITE));
    }
  }
} catch (error) {
  if (error?.message !== "baseline") throw error;
} finally {
  // Whatever happened, put every byte back — but never over a file that changed under this check, and say so
  // if a file is not what it was, because a check that silently leaves a mutation behind (or silently eats
  // someone else's edit) is worse than no check at all.
  restoreAll();
  stopStartedChrome();
  if (chromeProfile !== null) rmSync(chromeProfile, { recursive: true, force: true });
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

const allCaught = results.length > 0 && results.every((result) => result.verdict === "caught");
console.log(allCaught
  ? "every toggle defect put back is caught by a contract that fails and names it"
  : "not every toggle defect was shown to be caught — read the verdicts above");
process.exit(allCaught && !process.exitCode ? 0 : 1);
