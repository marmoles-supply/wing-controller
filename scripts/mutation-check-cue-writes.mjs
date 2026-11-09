// The teeth of the cue-file writers, the Monitor gate and the guide's build line, proved by putting each defect back.
//
// Three of these are one class of defect that this project has now met three times: **a rule that matters, written by
// hand in several places, where one copy drifts**. `set_timecode_cues` is written from six call sites across three
// windows and the backend defaults BOTH `sort` and `drive`, so a payload that omits one does not fail — it silently
// replaces the operator's order with `smpte`, or puts a sequential show back on the clock, and installing a list
// re-arms the engine as well. On 2026-10-07 two of the six were doing exactly that while a comment beside the third
// claimed the opposite. So the guard is structural (no window may build a payload by hand) and the contracts are on
// the two surfaces that had drifted; this harness demands each of them fails when the defect returns.
//
// The fourth is different in kind: `set_timecode_rehearsal` decides whether the show fires at ALL, and its refusal has
// to stay **asymmetric** — refusing to LEAVE Monitor would trap a live show in the one state where nothing fires. A
// later reader "tidying" the two branches into one unconditional refusal would recreate that trap, no browser suite
// would notice, and the only reason it is safe is that this check pins the direction.
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the contract **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason, printed with the assertion that actually fired
//   COULD-NOT-RUN  nothing was measured (no browser, or a file a concurrent writer changed)
//   NO-VERDICT     the run did not finish inside its bound (a wedged browser looks exactly like this)
//
// Run: node scripts/mutation-check-cue-writes.mjs
//      node scripts/mutation-check-cue-writes.mjs --self-test   (the classifier and the anchor logic; no tree edit)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that mutates
// the working tree must never run inside a gate. It takes **byte copies** and restores from those bytes, never from
// git — the usual moment to run it is before a fix is committed, and those uncommitted bytes are the ones to keep. The
// restore guard refuses to overwrite a file a **concurrent writer** changed while the check was running.

import { execFileSync, spawn } from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, unlinkSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEAL = /WING_BROWSER_SUITE_OK/;
const NO_BROWSER = /SKIP: no Chrome remote debugging/;
const LOCK = join(tmpdir(), "wing-mutation-check-cue-writes.lock");
// The gate gives a browser suite 180 s. This runs suites directly, so it bounds each one itself: the known Chrome wedge
// on this machine looks exactly like a test that never returns.
const SUITE_TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);

/// Each mutation puts one defect back, names the suite that must catch it, and the assertion that must name it.
const MUTATIONS = [
  {
    id: "M-W1",
    file: "desktop/ui/timecode.html",
    suite: "scripts/test-desktop-timecode-clock-browser.mjs",
    what: "the clock window drops the drive mode into the shared builder, which falls back to the backend's default",
    from: "          cues: CUE.cueListPayload(draftCues, offsetFrames, cueSortMode(), cueDrive),",
    to: "          cues: CUE.cueListPayload(draftCues, offsetFrames, cueSortMode(), null),",
    snippet: "must hand back the drive mode",
  },
  {
    id: "M-W2",
    file: "desktop/ui/timecode.html",
    suite: "scripts/test-desktop-ui-contracts.mjs",
    what: "a window builds its own cue payload by hand again, which is how `sort` and `drive` drifted the first time",
    from: "          cues: CUE.cueListPayload(draftCues, offsetFrames, cueSortMode(), cueDrive),",
    to: "          cues: { schema_version: 1, cues: copyCues(draftCues), offset_frames: offsetFrames, sort: cueSortMode() },",
    snippet: "builds its own payload",
  },
  {
    id: "M-W3",
    file: "desktop/src-tauri/src/main.rs",
    suite: "scripts/test-desktop-live-safety-commands.mjs",
    what: "the Monitor refusal becomes unconditional, so a live show can be trapped in the state where nothing fires",
    from: `    if rehearsing {
        live.refuse_live_change("putting the cue list in monitor")?;
    }`,
    to: `    live.refuse_live_change("putting the cue list in monitor")?;`,
    snippet: "must be refused while a session is live",
  },
  {
    id: "M-W4",
    file: "desktop/ui/guide.html",
    suite: "scripts/test-desktop-guide-browser.mjs",
    what: "the guide reads a global nothing defines, so its build line goes back to being permanently empty",
    from: "window.APP_VERSION_INFO",
    to: "window.WING_VERSION",
    all: true,
    snippet: "must name the version it shipped in",
  },
  {
    id: "M-W5",
    file: "desktop/ui/cue-list.js",
    suite: "scripts/test-desktop-ltc-window-browser.mjs",
    what: "the shared module stops installing the row's look, so the LTC window goes back to nine unstyled classes",
    // ONE LINE in the shared module. That is the point of the mutation: the row's look has one home now, so a single
    // line decides it for every window — and two of the three windows' suites catch it, which is the property this
    // module already carries for the shared row itself (see the cue-comfort harness). The settings page's suite is
    // **blind** to it: measured, it passes with this defect in place.
    from: `    installSelectionStyles();
    installRowStyles();`,
    to: `    installSelectionStyles();`,
    snippet: "must install the row's look itself",
  },
  {
    id: "M-W6",
    file: "desktop/ui/ltc.html",
    suite: "scripts/test-desktop-ui-contracts.mjs",
    what: "a window re-declares a row class the module owns, which is how the two copies drifted the first time",
    from: "    .cue-dense {",
    to: "    .cue-line { display: block; }\n    .cue-dense {",
    snippet: 'declares a CSS rule for ".cue-line"',
  },
  {
    id: "M-W7",
    file: "desktop/src-tauri/src/main.rs",
    suite: "scripts/test-desktop-ui-contracts.mjs",
    what: "the one write door stops announcing the list, so the other two windows keep showing a list the engine no longer has",
    // The windows' halves are contracted in their browser suites, and those contracts DELIVER THE EVENT THEMSELVES:
    // they prove what a window does with it and nothing about whether it is ever sent. This is the mutation that
    // covers the sending half.
    from: `    let _ = app.emit("timecode-cues-changed", &cues);\n`,
    to: "",
    snippet: "must announce the list it installed",
  },
  // The offset-only defect, in the three windows it lived in. Each is its own mutation because each window holds
  // different state and its own suite is what must catch it — the fix is not one expression repeated three times.
  {
    id: "M-W8",
    file: "desktop/ui/timecode.html",
    suite: "scripts/test-desktop-timecode-clock-browser.mjs",
    what: "the clock compares the cue array alone, so a change to the offset it CARRIES reaches nobody",
    from: `          const sameHeld =
            JSON.stringify(published.cues) === JSON.stringify(savedCues) &&
            Math.trunc(Number(published.offset_frames ?? 0)) === Math.trunc(Number(offsetFrames ?? 0)) &&
            String(published.sort ?? "smpte") === String(savedSort ?? "smpte") &&
            String(published.drive ?? "timecode") === String(cueDrive ?? "timecode");`,
    to: `          const sameHeld = JSON.stringify(published.cues) === JSON.stringify(savedCues);`,
    snippet: "whose offset changed must still be taken",
  },
  {
    id: "M-W9",
    file: "desktop/ui/ltc.html",
    suite: "scripts/test-desktop-ltc-window-browser.mjs",
    what: "the LTC window compares the cue array alone, so an offset-only change is swallowed before the dirty rule is even reached",
    from: `          const sameHeld =
            JSON.stringify(published.cues) === JSON.stringify(savedCues) &&
            Math.trunc(Number(published.offset_frames ?? 0)) === Math.trunc(Number(savedOffsetFrames ?? 0)) &&
            String(published.sort ?? "smpte") === String(sortFromFile ?? "smpte") &&
            String(published.drive ?? "timecode") === String(savedDrive ?? "timecode");`,
    to: `          const sameHeld = JSON.stringify(published.cues) === JSON.stringify(savedCues);`,
    snippet: "an offset-only change must be taken",
  },
  {
    id: "M-W10",
    file: "desktop/ui/index.html",
    suite: "scripts/test-desktop-cue-comfort-browser.mjs",
    what: "the settings page compares the cue array alone, and it is the page with the offset field — the everyday path",
    from: `            const sameHeld =
              JSON.stringify(published.cues) === JSON.stringify(savedTimecodeCues) &&
              Math.trunc(Number(published.offset_frames ?? 0)) === Math.trunc(Number(timecodeOffsetFrames ?? 0)) &&
              String(published.sort ?? "smpte") === String(savedSortFromFile ?? "smpte") &&
              String(published.drive ?? "timecode") === String(timecodeDrive ?? "timecode");`,
    to: `            const sameHeld = JSON.stringify(published.cues) === JSON.stringify(savedTimecodeCues);`,
    snippet: "an offset-only change must be taken",
  },
  {
    id: "M-W11",
    file: "desktop/ui/cue-list.js",
    suite: "scripts/test-desktop-ltc-window-browser.mjs",
    what: "renumbering rewrites the cue ids as well as the numbers, so a cue fired from outside stops finding its cue",
    // The property that matters about Renumber: a cue number is the name an operator says out loud, and the **id** is
    // the address anything outside this window fires by. Numbering must never move an address.
    from: `      list.forEach((cue, index) => { cue.number = renumberValue(index); });`,
    to: `      list.forEach((cue, index) => { cue.number = renumberValue(index); cue.id = renumberValue(index); });`,
    snippet: "must rewrite NUMBERS ONLY",
  },
  {
    id: "M-W12",
    file: "desktop/ui/ltc.html",
    suite: "scripts/test-desktop-ltc-window-browser.mjs",
    what: "the number field stops patching the row's badge, so the row and the field show different numbers",
    // The defect the contract actually caught, in the shape it was first written: the field set `cue.number` and called
    // `local()`, and the badge beside it went on showing the previous number until something else repainted the row —
    // two places on screen disagreeing about one cue.
    from: `          if (badge) badge.textContent = text;`,
    to: `          if (badge) { /* leaves the badge showing the previous number */ }`,
    snippet: "must be drawn on the row",
  },
  {
    id: "M-W13",
    file: "desktop/ui/ltc.html",
    suite: "scripts/test-desktop-ltc-window-browser.mjs",
    what: "the offset field writes a value of its own instead of the one typed, so the file disagrees with the screen",
    // "What a value the operator typed reaches the file" is the property: a field that appeared to apply and wrote
    // something else is the defect this repository keeps finding, and it is silent — the field still shows the number
    // that was typed.
    from: `      offsetFrames = frames;`,
    to: `      offsetFrames = 0;`,
    snippet: "changing the offset must reach the file",
  },
  {
    id: "M-W14",
    file: "desktop/ui/ltc.html",
    suite: "scripts/test-desktop-ltc-window-browser.mjs",
    what: "the typed add sends a position of its own, so the cue lands somewhere other than where the operator said",
    // **A typed position wins over the live one** is a deliberate rule copied from the settings page: an operator who
    // typed a position means that position, and a control that placed the cue somewhere else without saying so is the
    // silent-substitution defect this repository keeps finding.
    from: `          adopt(await invoke("add_timecode_cue_at_position", { position: typed }));`,
    to: `          adopt(await invoke("add_timecode_cue_at_position", { position: "01:00:00:00" }));`,
    snippet: "the position TYPED is the one that must be sent",
  },
  {
    id: "M-W15",
    file: "desktop/ui/ltc.html",
    suite: "scripts/test-desktop-ltc-window-browser.mjs",
    what: "edit-only goes back to meaning 'inside the footer', so the header's drive and offset stay usable in Live",
    // The pre-existing defect this surfaced: `edit-only` says what it MEANS — this control changes the list — and
    // scoping it to the footer left the **drive** selector reachable in Live mode, where changing it SAVES AND RE-ARMS
    // during a show, while the bar holding the order selector was hidden.
    from: `    body.is-live .edit-only,`,
    to: `    body.is-live footer .edit-only,`,
    snippet: "it changes the list, and the tools that change the list are what Live puts away",
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

/// Start our own headless Chrome when the port is silent, so the verdict does not depend on who prepared what.
/// Returns the child and profile to clean up, or null when an existing browser was reused, or {failed:true}.
async function ensureBrowser(needed) {
  if (!needed) return null;
  if (await browserAnswers()) {
    console.log(`using the browser already on port ${DEBUG_PORT}`);
    return null;
  }
  const profile = mkdtempSync(join(tmpdir(), "wing-cue-writes-chrome-"));
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

/// Run a suite and say what happened to it, including how it exited: a suite that could not run gives no verdict about
/// the contract, and that difference has to survive into the report.
function runSuite(suite) {
  try {
    const output = execFileSync("node", [suite], {
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

/// What a suite's result means for one mutation. Pure, so it can be checked without a browser — this logic has been
/// wrong before in sibling harnesses (once calling an unmeasured run MISSED, once about to call an exit-0 run caught).
export function classify({ code, output, timedOut, snippet, isBrowser }) {
  if (timedOut) return "NO-VERDICT (the suite did not finish inside its bound)";
  if (code === 3 || NO_BROWSER.test(output)) return "COULD-NOT-RUN (no browser)";
  // A suite that does not parse cannot have named a defect, whatever its output contains. This is checked **before**
  // the snippet, because a snippet is matched as a substring and a short one matches almost anything: a mutation that
  // broke the syntax once read as `caught` here, which is the one verdict that must never be given lightly.
  if (/SyntaxError|Unexpected (token|identifier|end of input)|failed to parse/i.test(output)) {
    return "UNEXPECTED (the suite does not parse, so it named nothing)";
  }
  // A Node suite has no seal to print: its pass is exit 0.
  const passed = code === 0 && (isBrowser ? SEAL.test(output) : true);
  if (passed) return "MISSED";
  if (snippet && output.includes(snippet)) return "caught";
  const assertion = (output.match(/AssertionError[^\n]*|Error: [^\n]*/) || [""])[0];
  return assertion ? `UNEXPECTED (${assertion})` : "UNEXPECTED";
}

/// Apply one mutation to the bytes, or say why it cannot be applied: an anchor that is not found exactly once means
/// the code moved and this check would otherwise be measuring nothing at all.
export function mutate(original, mutation) {
  const occurrences = original.split(mutation.from).length - 1;
  if (mutation.all) {
    if (occurrences < 1) return { ok: false, reason: `anchor not found (${occurrences} occurrences)` };
    return { ok: true, text: original.split(mutation.from).join(mutation.to), occurrences };
  }
  if (occurrences !== 1) return { ok: false, reason: `anchor found ${occurrences} times, expected exactly 1` };
  return { ok: true, text: original.replace(mutation.from, mutation.to), occurrences };
}

function selfTest() {
  let passed = 0;
  const total = 8;
  const check = (condition, label) => {
    if (condition) passed += 1;
    else console.log(`  self-test failed: ${label}`);
  };
  check(classify({ code: 1, output: `AssertionError: must hand back the drive mode (got "timecode")`, snippet: "must hand back the drive mode", isBrowser: true }) === "caught",
    "a failing browser suite that names the defect is caught");
  check(classify({ code: 0, output: "WING_BROWSER_SUITE_OK", snippet: "x", isBrowser: true }) === "MISSED",
    "a browser suite that passes with the defect in place is MISSED");
  check(classify({ code: 0, output: "desktop UI contracts passed", snippet: "x", isBrowser: false }) === "MISSED",
    "a Node suite that exits 0 is MISSED");
  check(classify({ code: 1, output: "AssertionError: something else entirely", snippet: "must hand back the drive mode", isBrowser: true }).startsWith("UNEXPECTED"),
    "a failure that names something else is UNEXPECTED");
  check(classify({ code: 1, output: "SyntaxError: unexpected token", snippet: "must hand back the drive mode", isBrowser: false }).startsWith("UNEXPECTED"),
    "a syntax error is UNEXPECTED, not caught, even when the snippet appears in it");
  check(classify({ code: 124, output: "", timedOut: true, snippet: "x", isBrowser: true }).startsWith("NO-VERDICT"),
    "a run that did not finish is NO-VERDICT, never MISSED");
  check(classify({ code: 3, output: "SKIP: no Chrome remote debugging on port 9223", snippet: "x", isBrowser: true }).startsWith("COULD-NOT-RUN"),
    "a suite with no browser is COULD-NOT-RUN");
  // An exit-0 browser suite WITHOUT the seal is not a pass: the gate learned this the hard way.
  check(classify({ code: 0, output: "skipped", snippet: "x", isBrowser: true }).startsWith("UNEXPECTED"),
    "an exit-0 browser suite with no seal is not a pass");
  console.log(`classifier self-test: ${passed}/${total}`);
  return passed === total;
}

async function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);

  if (existsSync(LOCK)) {
    const owner = Number(readFileSync(LOCK, "utf8").trim());
    let alive = false;
    try {
      process.kill(owner, 0);
      alive = true;
    } catch (_) {}
    if (alive) {
      console.log(`COULD-NOT-RUN: another mutation check holds the lock (pid ${owner})`);
      process.exit(1);
    }
    unlinkSync(LOCK);
  }
/// **Refuse to mutate a tree this machine cannot put back.**
///
/// It happened, and it is the one failure mode a mutation harness must not have: the disk filled mid-run, the restore
/// failed with `ENOSPC`, and a mutated `timecode.rs` was left in the working tree. That is the accident
/// `AGENTS.md` records under *An Experiment On A Tracked File Must Survive Being Killed*, arriving by the one route
/// the existing rules do not cover — a killed process rolls back nothing, and **neither does a full disk**. A harness
/// that measures its own environment for a browser must measure it for free space too, because what it promises the
/// tree is that it will always put it back.
///
/// The floor is a gigabyte rather than the few megabytes the byte copies need: a Rust mutation runs `cargo test`,
/// which writes build artefacts, and the promise is about the whole run rather than about the copies.
const RESTORE_FLOOR_BYTES = 1024 * 1024 * 1024;
function requireRoomToRestore() {
  let free = 0;
  try {
    const stats = statfsSync(REPO);
    free = stats.bavail * stats.bsize;
  } catch (error) {
    console.error(`COULD-NOT-RUN: could not read the free space of ${REPO} (${String(error)}). This check rewrites files in the tree and refuses to do it without knowing it can put them back.`);
    process.exit(3);
  }
  if (free < RESTORE_FLOOR_BYTES) {
    console.error(
      `COULD-NOT-RUN: ${Math.round(free / (1024 * 1024))} MB free, and this check needs at least ${Math.round(RESTORE_FLOOR_BYTES / (1024 * 1024))} MB to be sure it can restore every file it rewrites. Nothing was mutated.`,
    );
    console.error("Free space and run it again: a mutation harness that cannot restore leaves a defect in the tree, which is exactly what it exists to detect.");
    process.exit(3);
  }
}

  requireRoomToRestore();

  writeFileSync(LOCK, String(process.pid));



  const originals = new Map();
  for (const mutation of MUTATIONS) {
    const path = join(REPO, mutation.file);
    if (!originals.has(mutation.file)) originals.set(mutation.file, readFileSync(path, "utf8"));
  }
  const backup = mkdtempSync(join(tmpdir(), "wing-cue-writes-mutation-"));
  for (const [file, text] of originals) writeFileSync(join(backup, file.replace(/\//g, "__")), text);
  console.log(`backup: ${backup}`);

  const needsBrowser = MUTATIONS.some((m) => m.suite.includes("-browser"));
  const browser = await ensureBrowser(needsBrowser);
  if (browser?.failed) {
    unlinkSync(LOCK);
    console.log("COULD-NOT-RUN: nothing was measured.");
    process.exit(1);
  }

  const results = [];
  let stop = false;
  try {
    // The baseline: every suite must pass before any mutation, or a failure later means nothing.
    for (const suite of [...new Set(MUTATIONS.map((m) => m.suite))]) {
      const baseline = runSuite(suite);
      const verdict = classify({ ...baseline, snippet: "", isBrowser: suite.includes("-browser") });
      if (verdict !== "MISSED") {
        console.log(`COULD-NOT-RUN: ${suite} does not pass before any mutation — ${verdict}`);
        console.log(baseline.output.slice(-1200));
        results.push({ id: "baseline", verdict: "COULD-NOT-RUN", what: suite });
        stop = true;
        break;
      }
      console.log(`baseline passes: ${suite}`);
    }

    for (const mutation of stop ? [] : MUTATIONS) {
      const original = originals.get(mutation.file);
      const applied = mutate(original, mutation);
      if (!applied.ok) {
        results.push({ id: mutation.id, verdict: `COULD-NOT-RUN (${applied.reason})`, what: mutation.what });
        continue;
      }
      const path = join(REPO, mutation.file);
      writeFileSync(path, applied.text);
      const outcome = runSuite(mutation.suite);
      results.push({
        id: mutation.id,
        verdict: classify({ ...outcome, snippet: mutation.snippet, isBrowser: mutation.suite.includes("-browser") }),
        what: mutation.what,
      });

      // Restore only what this script wrote. A foreign change means a concurrent writer, and clobbering it is how
      // uncommitted work is lost: leave it alone, say so loudly, and stop.
      const now = readFileSync(path, "utf8");
      if (now === applied.text) {
        writeFileSync(path, original);
      } else {
        console.log(`REFUSING to restore ${mutation.file}: it changed while this ran. Backup: ${backup}`);
        stop = true;
        break;
      }
    }
  } finally {
    for (const [file, original] of originals) {
      const path = join(REPO, file);
      const now = readFileSync(path, "utf8");
      if (now === original) continue;
      const written = MUTATIONS.filter((m) => m.file === file)
        .map((m) => mutate(original, m))
        .filter((r) => r.ok)
        .map((r) => r.text);
      if (written.includes(now)) {
        writeFileSync(path, original);
        console.log(`${file} restored from the bytes taken at the start`);
      } else {
        console.log(`left ${file} untouched: it holds bytes this script did not write (backup: ${backup})`);
      }
    }
    if (browser) {
      browser.child.kill("SIGKILL");
      rmSync(browser.profile, { recursive: true, force: true });
      console.log("stopped the browser this check started");
    }
    if (existsSync(LOCK)) unlinkSync(LOCK);
  }

  console.log("\n==== summary ====");
  for (const result of results) {
    console.log(`${result.id}   ${result.verdict}${result.what ? ` :: ${result.what}` : ""}`);
  }
  const caught = results.filter((r) => r.verdict === "caught").length;
  const missed = results.filter((r) => String(r.verdict).startsWith("MISSED")).length;
  const couldNot = results.filter((r) => /^(COULD-NOT-RUN|NO-VERDICT)/.test(String(r.verdict))).length;
  console.log(`caught ${caught}/${MUTATIONS.length}`);
  process.exit(missed > 0 || couldNot > 0 ? 1 : 0);
}

// Run only as a program. `export`ed helpers make this file importable by a reader or a test, and **importing it must
// never run the check**: the first version ran on import, so a one-line `require` of it took the lock and started a
// suite against the live tree while the verification gate was using it.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) main();
