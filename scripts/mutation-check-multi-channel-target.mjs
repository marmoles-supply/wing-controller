// The multi-channel target contracts' teeth, proved by putting each defect back.
//
// The owner reported that a target over channels 9-12 muted channel 9 alone. The fix carries the whole
// selector into the compiled step (`ConfiguredActionStep::addresses`, resolved at compile time from
// `targetIds`), loops that list where the write happens, and makes the browser suite's IPC stub expand
// a range the way the backend's `parse_ids` does. This script puts each half of that defect back —
// the compile seam that keeps only the first address, a preview that counts a range as one packet, the
// window narrowing the range to the channel it paints (`desktop/ui/index.html:14279` and `:17514`, the
// two lines the investigation named), and the stub that never expands a range — and demands a failing
// contract that names it. It reports one of four verdicts and never blurs them:
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the tests **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason (including "it did not compile"), printed with the failure
//   COULD-NOT-RUN  nothing was measured (no cargo, or no browser for the UI half)
//
// Run: node scripts/mutation-check-multi-channel-target.mjs
//      node scripts/mutation-check-multi-channel-target.mjs --self-test   (the classifier; no cargo, no edits)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check
// that mutates the tree must never run inside a gate. It copies every file it is about to change and puts
// the bytes back whatever happens, so it is safe to run with uncommitted work in those files — but only
// its **own**: the restore refuses to overwrite a file whose bytes are neither the pre-run original nor
// what this check last wrote, leaves that file alone and says so. See `restoreAll` for the rule.
//
// The last two mutations cover the recipe wording the same commit repaired: the cue-only macro (v0.2.85)
// made a trigger with nothing at all a legitimate "only a cue fires it" choice, and the suite used to
// pin the old "not configured" text. Both branches of `currentTriggerText` are mutated here — the
// cue-only branch and the partial-trigger branch — so the repair provably keeps the property instead of
// loosening it.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = join(REPO, "desktop/src-tauri/src/main.rs");
const PAGE = join(REPO, "desktop/ui/index.html");
const SUITE = join(REPO, "scripts/test-desktop-action-target-browser.mjs");
const LOCK = join(tmpdir(), "wing-mutation-check-multi-channel.lock");
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEAL = /WING_BROWSER_SUITE_OK/;
const NO_BROWSER = /SKIP: no Chrome remote debugging/;
const RUST_ARGS = ["test", "-p", "wing-controller-desktop", "--bin", "wing-controller-desktop", "multi_channel"];
const TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/** What a run's result means for one mutation. Pure, so `--self-test` can check it without cargo or a tree. */
export function classify(expect, { code, output, timedOut }, kind = "rust") {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the run did not finish in ${Math.round(TIMEOUT_MS / 1000)} s` };
  }
  if (code === null) {
    return { verdict: "could-not-run", why: "the test runner could not be started: nothing was measured" };
  }
  // A compile error is not the contract failing, and neither is a suite that never reached the page.
  if (/error\[E\d+\]|error: could not compile/.test(output)) {
    return { verdict: "unexpected", why: "the mutated tree did not compile — that is not the contract failing" };
  }
  if (kind === "browser") {
    if (code === 3 || NO_BROWSER.test(output)) {
      return { verdict: "could-not-run", why: `no browser: the suite never ran (exit ${code})` };
    }
    if (code !== 0 && expect.test(output)) return { verdict: "caught" };
    if (code === 0 && SEAL.test(output)) return { verdict: "missed", why: "the suite PASSED with the defect in place" };
    if (code === 0) {
      return { verdict: "unexpected", why: "the suite exited 0 without its seal: it did not run the contracts it claims to" };
    }
    const firstFailure = (output.match(/AssertionError[^\n]*/) || [""])[0].slice(0, 160);
    return {
      verdict: "unexpected",
      why: `the suite failed, but not with ${expect}${firstFailure ? ` — it said: ${firstFailure}` : ""}`,
    };
  }
  if (code !== 0 && expect.test(output)) return { verdict: "caught" };
  if (code === 0) return { verdict: "missed", why: "the tests PASSED with the defect in place" };
  const firstFailure = (output.match(/assertion[^\n]*failed[^\n]*/) || [""])[0].slice(0, 160);
  return {
    verdict: "unexpected",
    why: `the tests failed, but not with ${expect}${firstFailure ? ` — they said: ${firstFailure}` : ""}`,
  };
}

// Each mutation is the inverse of a line in the fix, and each is expected to be caught by a named assertion.
const mutations = [
  {
    // The owner's defect exactly: the compiled step keeps the raw first address alone, so a selector
    // over 9-12 compiles to `/ch/9/mute` and the run writes one channel while the preview shows four.
    kind: "rust",
    name: "the compile seam keeps only the first channel of a range",
    file: MAIN,
    from: `    if !address.is_empty() && resolved.iter().any(|candidate| candidate == address) {
        resolved
    } else {
        vec![step.action_address.clone()]
    }`,
    to: `    let _ = resolved; // mutated: the compiled step keeps the raw first address alone
    vec![step.action_address.clone()]`,
    expect: /must compile one write per channel/,
  },
  {
    // The run reports what it sent; a preview that counts a range as one packet tells the operator one
    // write where four go out.
    kind: "rust",
    name: "a preview that counts a range as one packet",
    file: MAIN,
    from: `    Ok((per_address_packets * step.addresses.len().max(1), hex))`,
    to: `    Ok((per_address_packets, hex)) // mutated: the preview forgets the other channels`,
    expect: /four channels are four packets, not one/,
  },
  {
    // index.html:14279, the preview path: the window narrows the selector to the channel it paints,
    // which is the "shows four, stores one" defect on the window side.
    kind: "browser",
    name: "the preview narrows the range to the channel it paints (index.html:14279)",
    file: PAGE,
    from: `          if (targetResult.addresses.length > 0 && targetCategory.value !== "custom") {
            document.getElementById("osc-address").value = targetResult.addresses[0];`,
    to: `          if (targetResult.addresses.length > 0 && targetCategory.value !== "custom") {
            document.getElementById("osc-address").value = targetResult.addresses[0];
            // mutated: the range is narrowed to the channel the box shows
            const narrowedId = targetIds.value.trim().split(/[-,]/)[0];
            if (narrowedId) targetIds.value = narrowedId;`,
    // The narrowed field is read before the step it produces, so this is the assertion that fires.
    expect: /must keep the range the operator typed/,
  },
  {
    // index.html:17514, the resolve path that runs on every target change: same narrowing there.
    kind: "browser",
    name: "resolving the target narrows the range (index.html:17514)",
    file: PAGE,
    from: `        if (result.addresses.length > 0) {
          document.getElementById("osc-address").value = result.addresses[0];
          if (!silent) {`,
    to: `        if (result.addresses.length > 0) {
          document.getElementById("osc-address").value = result.addresses[0];
          // mutated: the range is narrowed to the channel the box shows
          const narrowedId = targetIds.value.trim().split(/[-,]/)[0];
          if (narrowedId) targetIds.value = narrowedId;
          if (!silent) {`,
    // The narrowed field is read before the step it produces, so this is the assertion that fires.
    expect: /must keep the range the operator typed/,
  },
  {
    // The unfaithful harness itself: the stub splits on commas only, so the check that a range means
    // four writes would be measuring the stub instead of the window. This is why the stub was fixed first.
    kind: "browser",
    name: "the stub that never expands a range (the unfaithful harness)",
    file: SUITE,
    from: `            return { addresses: parseIds(r.ids || '1').map((id) => '/' + r.category + '/' + id + '/' + r.parameter) };`,
    to: `            return { addresses: String(r.ids || '1').split(',').map((id) => '/' + r.category + '/' + id.trim() + '/' + r.parameter) };`,
    // The stub feeds the window's own preview as well as the check's second resolution, so the first
    // assertion to notice a range resolved to one address is the preview promise.
    expect: /must promise the four channels/,
  },
  {
    // The wording the repaired assertion pins: a macro with no trigger of its own is the cue-only
    // choice, not a half-made macro. Putting the old text back must turn check 1 red.
    kind: "browser",
    name: "a cue-only macro that reads as half-made again (index.html:16230)",
    file: PAGE,
    from: `          return "Fired only by a timecode cue (no trigger of its own)";`,
    to: `          return "Trigger not configured"; // mutated: a cue-only macro reads as half-made again`,
    expect: /must say a cue fires it/,
  },
  {
    // The negative control, and the reason the repair is not a loosening: a trigger the operator
    // started filling in is unfinished and must still say so.
    kind: "browser",
    name: "a partly filled trigger called cue-only (index.html:16236)",
    file: PAGE,
    from: `        if (!config.triggerCategory || !String(config.triggerIds || "").trim() || !config.triggerParameter) {
          return "Trigger not configured (choose a source, a channel and a parameter)";
        }`,
    to: `        if (!config.triggerCategory || !String(config.triggerIds || "").trim() || !config.triggerParameter) {
          // mutated: a partly filled trigger is called cue-only, so an unfinished macro looks finished
          return "Fired only by a timecode cue (no trigger of its own)";
        }`,
    expect: /must still read as not configured/,
  },
];

if (process.argv.includes("--self-test")) {
  const cases = [
    ["tests that fail and name the defect", /must compile one write per channel/, "rust",
      { code: 101, output: "assertion `left == right` failed: a target spanning several channels must compile one write per channel" }, "caught"],
    ["tests that PASS with the defect in place", /must compile one write per channel/, "rust",
      { code: 0, output: "test result: ok. 4 passed" }, "missed"],
    ["a tree that did not compile", /must compile one write per channel/, "rust",
      { code: 101, output: "error[E0308]: mismatched types" }, "unexpected"],
    ["a browser suite that passes with the defect", /must carry the range/, "browser",
      { code: 0, output: "ALL BROWSER CHECKS PASSED\nWING_BROWSER_SUITE_OK" }, "missed"],
    ["a browser suite with no browser", /must carry the range/, "browser",
      { code: 3, output: "SKIP: no Chrome remote debugging on port 9223" }, "could-not-run"],
    ["a browser suite that fails for another reason", /must carry the range/, "browser",
      { code: 1, output: "AssertionError: something else entirely" }, "unexpected"],
    ["a run that ran out of time", /anything/, "rust",
      { code: 101, output: "", timedOut: true }, "no-verdict"],
  ];
  let failed = 0;
  for (const [name, expect, kind, result, want] of cases) {
    const got = classify(expect, result, kind).verdict;
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
  const profile = mkdtempSync(join(tmpdir(), "wing-multi-channel-chrome-"));
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

function runRust() {
  try {
    const output = execFileSync("cargo", RUST_ARGS, {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return { code: 0, output };
  } catch (error) {
    return errorResult(error);
  }
}

function runBrowser() {
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
    return errorResult(error);
  }
}

function errorResult(error) {
  const output = `${error.stdout || ""}${error.stderr || ""}`;
  if (error.killed || error.signal === "SIGKILL" || error.code === "ETIMEDOUT") {
    return { code: 124, output, timedOut: true };
  }
  if (error.code === "ENOENT") {
    return { code: null, output };
  }
  return { code: typeof error.status === "number" ? error.status : 1, output };
}

// Only one run at a time: two would interleave mutations of the same files and each would restore the
// other's bytes. A lock left by a run that died is taken over, because a stale lock blocks for ever.
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

const browser = await ensureBrowser().catch((error) => {
  console.error(String(error.message || error));
  console.error("nothing was measured for the UI half: this is not a verdict on any contract");
  return null;
});

// Every file a mutation can touch, its bytes, and a copy outside the tree: nothing is restored from git.
// `written` remembers the bytes this check itself put in each file, so the restore can tell its own
// mutation from another writer's work. That distinction is the whole protection: a mutation harness in
// this tree restored its own backup over a colleague's half-written file twice in one day, and this one
// must never do that. A file that changed while the check ran is left exactly as it is and reported,
// with the pre-run bytes kept beside it. (It deliberately does not refuse a merely *dirty* file: the
// normal way to use this check is before the fix is committed, and the byte copy is what makes that
// safe — the same call `mutation-check-cues-rust.mjs` makes for its own files.)
const originals = new Map([MAIN, PAGE, SUITE].map((file) => [file, readFileSync(file, "utf8")]));
const backupDir = mkdtempSync(join(tmpdir(), "wing-multi-channel-mutation-"));
for (const file of originals.keys()) copyFileSync(file, join(backupDir, basename(file)));
const written = new Map();
const foreign = new Set();

/// Puts every file back to the bytes this check found, and refuses to touch a file whose current bytes
/// are neither that original nor what this check last wrote: those are somebody else's work.
function restoreAll() {
  for (const [file, original] of originals) {
    const current = readFileSync(file, "utf8");
    if (current === original) {
      written.delete(file);
      continue;
    }
    if (written.get(file) === current) {
      writeFileSync(file, original);
      written.delete(file);
      continue;
    }
    foreign.add(file);
  }
}

console.log(`files this check will write and restore from its own byte copies: ${[...originals.keys()].map((file) => basename(file)).join(", ")}`);
console.log(`pre-run copies, kept if anything is left alone: ${backupDir}`);

const results = [];
try {
  for (const mutation of mutations) {
    // Whatever the previous mutation left, this one starts from the file as it was found. A file that
    // changed under us is skipped rather than overwritten.
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
    // One more look before this write: a file that changed between the restore above and here belongs to
    // somebody else, and overwriting it is exactly the accident this guard exists to prevent.
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
    const result = mutation.kind === "rust" ? runRust() : runBrowser();
    results.push({ name: mutation.name, ...classify(mutation.expect, result, mutation.kind) });
  }
} finally {
  // Whatever happened, put every byte back — but never over a file that changed under this check, and
  // say so if a file is not what it was, because a check that silently leaves a mutation behind (or
  // silently eats someone else's edit) is worse than no check at all.
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
  ? "every way a range could narrow to its first channel is caught by a contract that fails when it is put back"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
