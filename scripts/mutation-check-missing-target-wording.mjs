// The teeth of the no-target refusal contracts, proved by putting each defect back.
//
// The owner's enable dialog said `Step 2: no action address.` while the step row said
// `Buses — Not configured — Mute`, and he had to ask which one meant the other; the same fact was
// also printed twice, once by `validate_macro_config` and once by `preflight_config` (owner report,
// 2026-10-05, recorded in `docs/SESSION_2026-10-05.md`). The fix lives in `main.rs`:
//
//   * `missing_action_target_problem` — one reason, quoting the step row in the editor's own words;
//   * `action_step_problems` calls it — the compile path and the Shoot button refuse for it too;
//   * the preflight's own empty-address push is gone — the dialog prints one line.
//
// The contracts are `scripts/test-desktop-ui-contracts.mjs` (a source-scanning suite, run by the
// gate) and the Rust tests beside `action_step_problems`. "The contract passes" is worth little on
// its own — the project's rule is that a contract without a mutation is a contract nobody has proved
// has teeth. So each defect below is put back, the contract is run, and it must **fail naming it**.
//
// Verdicts, never blurred:
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the contract **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason, printed with the assertion that actually fired
//   COULD-NOT-RUN  nothing was measured (the suite could not run, or a file was left alone)
//
// Run: node scripts/mutation-check-missing-target-wording.mjs
//      node scripts/mutation-check-missing-target-wording.mjs --self-test   (classifier and guard; no tree edit)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a
// check that mutates the working tree must never run inside a gate. It takes a **byte copy** of the
// one file it rewrites and restores from those bytes, never from git — a mutation harness in this
// repository restored from git once and destroyed uncommitted work — so it is safe to run before the
// fix is committed. What it refuses to do is overwrite a file a **concurrent writer** changed while
// the check was running: see `planRestore`, which is also proved by `--self-test`.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = join(REPO, "desktop/src-tauri/src/main.rs");
const JS_SUITE = join(REPO, "scripts/test-desktop-ui-contracts.mjs");
const LOCK = join(tmpdir(), "wing-mutation-check-missing-target-wording.lock");
// The Rust suite compiles the mutated tree, so it needs more room than a source scan; a check that
// hangs is indistinguishable from a check that found something, so it is still bounded.
const TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);
// The two Rust tests this check drives by name; `libtest` accepts more than one filter.
const RUST_FILTERS = ["a_step_with_no_chosen_target", "a_chosen_target_with_no_address"];

/** What a run's result means for one mutation. Pure, so `--self-test` can check it with no tree. */
export function classify(expect, { code, output, timedOut }) {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the contract did not finish in ${Math.round(TIMEOUT_MS / 1000)} s` };
  }
  if (code === null) {
    return { verdict: "could-not-run", why: "the contract could not be started: nothing was measured" };
  }
  // `caught` means the contract **failed** and named this defect. A contract that passes with the
  // defect in place while printing the phrase somewhere is not evidence.
  if (code !== 0 && expect.test(output)) {
    return { verdict: "caught" };
  }
  if (code === 0) {
    return { verdict: "missed", why: "the contract PASSED with the defect in place" };
  }
  // A Rust panic puts its message on the line **after** the location, so the report takes both lines
  // rather than printing "panicked at …:" and leaving the actual assertion out.
  const firstFailure = (output.match(/AssertionError[^\n]*|panicked at[^\n]*\n[^\n]*/) || [""])[0]
    .replace(/\s+/g, " ")
    .slice(0, 300);
  return {
    verdict: "unexpected",
    why: `the contract failed, but not with ${expect}${firstFailure ? ` — it actually said: ${firstFailure}` : ""}`,
  };
}

// Each mutation is the inverse of one property the fix added. `from`/`to` are exact source text: a
// mutation whose target is not found is reported as stale rather than silently skipped. Every
// mutation is run against the suite that owns the property, so a green table means both the source
// contract and the behavioural one were proved, not one assertion observed five times.
const mutations = [
  {
    // The owner's screenshot, exactly: the refusal goes back to the resolver's vocabulary.
    name: "the refusal stops naming the target and says `no action address` again",
    from: `        problems.push(missing_action_target_problem(label, step));`,
    to: `        problems.push(format!("{label}: no action address."));`,
    run: () => runJsSuite(),
    expect: /action_step_problems must refuse an empty action address through that shared reason/,
  },
  {
    // A second word for the state the editor draws as `— Not configured —` is how the operator ends
    // up translating between two vocabularies.
    name: "the refusal stops quoting the editor's own `— Not configured —`",
    from: `const NOT_CONFIGURED_LABEL: &str = "— Not configured —";`,
    to: `const NOT_CONFIGURED_LABEL: &str = "not set";`,
    run: () => runJsSuite(),
    expect: /must quote the editor's own/,
  },
  {
    // The duplicate line, as source shape: the preflight pushes its own empty-address reason beside
    // the validator's.
    name: "the preflight pushes its own empty-address reason beside the validator's (the double line)",
    from: `            if !raw_address.is_empty() && !raw_address.starts_with('/') {`,
    to: `            if raw_address.is_empty() {
                errors.push(format!(
                    "Step {step_number}: OSC action address is required"
                ));
            } else if !raw_address.starts_with('/') {`,
    run: () => runJsSuite(),
    expect: /the preflight's address rules must apply only to an address the operator gave/,
  },
  {
    // The same defect, behaviourally: an operator reading the enable dialog would see the step's
    // reason twice.
    name: "the preflight pushes a second line for the same missing target (behavioural)",
    from: `            if !raw_address.is_empty() && !raw_address.starts_with('/') {`,
    to: `            if raw_address.is_empty() {
                errors.push(format!(
                    "Step {step_number}: OSC action address is required"
                ));
            } else if !raw_address.starts_with('/') {`,
    run: () => runRustTests(),
    expect: /the preflight's second vocabulary for the same fact is gone|this step's reason is printed once/,
  },
  {
    // "Never chosen" and "chosen and its address is gone" collapsed into one message: the operator
    // is told to choose a target that the step file already selects.
    name: "a chosen target with no address is reported as never chosen",
    from: `    if (addresses_by_id && ids.is_empty()) || parameter.is_empty() {`,
    to: `    if true {`,
    run: () => runRustTests(),
    expect: /a target the file still selects must not be called unchosen/,
  },
];

/** The guard's decision for one file, as data, so it can be proved without the tree. */
export function planRestore(current, original, lastWritten) {
  if (current === original) return "ours"; // already what we found: nothing to do, and not foreign
  if (current === lastWritten) return "restore"; // our own mutation: put the bytes back
  return "foreign"; // somebody else wrote this: leave it alone and say so
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["a contract that fails and names the defect", /must be async/, { code: 1, output: "AssertionError [ERR_ASSERTION]: must be async" }, "caught"],
    ["a contract that PASSES while printing the phrase", /must be async/, { code: 0, output: "must be async\nall passed" }, "missed"],
    ["a contract that failed for another reason", /must be async/, { code: 1, output: "AssertionError [ERR_ASSERTION]: something else" }, "unexpected"],
    ["a contract that could not be started", /anything/, { code: null, output: "" }, "could-not-run"],
    ["a contract that ran out of time", /anything/, { code: 124, output: "", timedOut: true }, "no-verdict"],
  ];
  let failed = 0;
  for (const [name, expect, result, want] of cases) {
    const got = classify(expect, result).verdict;
    if (got !== want) failed += 1;
    console.log(`${got === want ? "ok  " : "FAIL"} classifier — ${name}: expected ${want}, got ${got}`);
  }

  // The restore guard, exercised for real on a file outside the tree: a file this check wrote is put
  // back, a file a foreign writer changed is left exactly as it is. This is the property the first
  // mutation harness in this repository lacked when it restored over a colleague's half-written source.
  const dir = mkdtempSync(join(tmpdir(), "wing-target-wording-guard-self-test-"));
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

/** Run one command and say what happened, including how it exited — a contract that could not run measured nothing. */
function runCommand(command, args) {
  try {
    const output = execFileSync(command, args, {
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

/** The source contract: it reads `main.rs` and `index.html`, needs no browser and no hardware. */
function runJsSuite() {
  return runCommand("node", [JS_SUITE]);
}

/** The behavioural contract: the Rust tests beside `action_step_problems`. */
function runRustTests() {
  return runCommand("cargo", [
    "test",
    "--package",
    "wing-controller-desktop",
    "--bin",
    "wing-controller-desktop",
    "--",
    ...RUST_FILTERS,
  ]);
}

// Only one run at a time: two would interleave mutations of the same file and each would restore the
// other's bytes. A lock left by a run that died is taken over, because a stale lock that blocks for
// ever is its own kind of failure.
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

// The one file a mutation can touch, its bytes, and a copy outside the tree. Nothing is restored from
// git: the normal way to run this check is **before** the fix is committed, and those uncommitted
// bytes are the ones to keep.
const originals = new Map([[MAIN, readFileSync(MAIN, "utf8")]]);
const backupDir = mkdtempSync(join(tmpdir(), "wing-target-wording-mutation-"));
for (const file of originals.keys()) copyFileSync(file, join(backupDir, basename(file)));
const written = new Map();
const foreign = new Set();

/** Put the file back to the bytes this check found, and refuse to touch one a foreign writer changed. */
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

console.log(`the file this check writes and restores from its own byte copy: ${basename(MAIN)}`);
console.log(`pre-run copy, kept if anything is left alone: ${backupDir}`);

// A mutation table is only as good as the tree it runs against: if a contract does not pass
// unmutated, every verdict below would be describing the tree instead of a defect, so say that and
// measure nothing.
for (const [name, run] of [["source contract", runJsSuite], ["Rust contracts", runRustTests]]) {
  const baseline = run();
  if (baseline.code !== 0) {
    console.error(`the ${name} does not pass on the tree as it stands (exit ${baseline.code}): nothing was measured`);
    console.error((baseline.output.match(/AssertionError[^\n]*|panicked at[^\n]*/) || [""])[0]);
    restoreAll();
    if (foreign.size > 0) {
      console.error(`this file changed while this check was running and was LEFT AS IT IS (pre-run bytes in ${backupDir}): ${[...foreign].join(", ")}`);
    }
    rmSync(LOCK, { force: true });
    process.exit(1);
  }
  console.log(`the ${name} passes on the tree as it stands`);
}

const results = [];
try {
  for (const mutation of mutations) {
    // Whatever the previous mutation left, this one starts from the file as it was found. A file that
    // changed under us is skipped rather than overwritten.
    restoreAll();
    if (foreign.has(MAIN)) {
      results.push({
        name: mutation.name,
        verdict: "could-not-run",
        why: `${basename(MAIN)} changed while this check was running; its bytes were left alone`,
      });
      continue;
    }
    const original = originals.get(MAIN);
    if (!original.includes(mutation.from)) {
      results.push({ name: mutation.name, verdict: "unexpected", why: "the mutation target was not found — this check is stale" });
      continue;
    }
    // One more look before this write: a file that changed between the restore above and here belongs
    // to somebody else, and overwriting it is exactly the accident this guard exists to prevent.
    if (readFileSync(MAIN, "utf8") !== original) {
      foreign.add(MAIN);
      results.push({
        name: mutation.name,
        verdict: "could-not-run",
        why: `${basename(MAIN)} changed while this check was running; its bytes were left alone`,
      });
      continue;
    }
    const mutated = original.replace(mutation.from, mutation.to);
    writeFileSync(MAIN, mutated);
    written.set(MAIN, mutated);
    results.push({ name: mutation.name, ...classify(mutation.expect, mutation.run()) });
  }
} finally {
  // Whatever happened, put every byte back — but never over a file that changed under this check, and
  // say so if a file is not what it was, because a check that silently leaves a mutation behind (or
  // silently eats someone else's edit) is worse than no check at all.
  restoreAll();
  if (foreign.size > 0) {
    console.error(`this file changed while this check was running and was LEFT AS IT IS (the pre-run bytes are in ${backupDir}): ${[...foreign].join(", ")}`);
  } else {
    const notRestored = [...originals].filter(([file, content]) => readFileSync(file, "utf8") !== content);
    if (notRestored.length > 0) {
      console.error(`this file could NOT be restored — its original is in ${backupDir}: ${notRestored.map(([file]) => file).join(", ")}`);
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
  ? "every no-target refusal defect put back is caught by a contract that fails and names it"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
