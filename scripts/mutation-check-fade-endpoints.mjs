// The fade contracts' teeth, proved by putting each defect back.
//
// The owner reported that a fade "works half-well on faders and not on EQ bands and many other things".
// Three backend defects made that true, and each one is invisible on a fader:
//
//   1. `normalize_action_steps` clamped both endpoints with `clamp(-144.0, 24.0)` — a level in dB. On a
//      fader (`-144…10`) that changes nothing; on a 200 → 2000 Hz fade it makes `24 → 24`, a ramp that
//      writes the same number 128 times.
//   2. `execute_ramp_step` interpolated by offset whatever the leaf was, although Maillot documents a
//      frequency, a Q and a release time `logf` — a 20 Hz → 20 kHz sweep is already at 10 kHz halfway.
//   3. The step count came from the duration alone, so a fade of N channels took N × its duration once
//      the one-packet-per-17 ms limiter was counted.
//
// This check puts each defect back, one at a time, runs the Rust contracts that cover it, and demands a
// failure that names it. It reports one of four verdicts and never blurs them:
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the tests **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason (including "it did not compile"), printed with the real failure
//   COULD-NOT-RUN  nothing was measured (no cargo, no test binary)
//
// Run: node scripts/mutation-check-fade-endpoints.mjs
//      node scripts/mutation-check-fade-endpoints.mjs --self-test   (the classifier's own cases; no cargo, no edits)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that
// mutates the tree must never run inside a gate. It does **not** restore from git — it copies every file it is
// about to change into a temporary folder first and puts the bytes back whatever happens, so it is safe to run
// with uncommitted work in those files (which is the normal case while someone is writing the fix this proves).

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = join(REPO, "desktop/src-tauri/src/main.rs");
const CORE = join(REPO, "crates/wing-core/src/lib.rs");
// The lock is the sibling Rust check's: two mutation runs at once would interleave edits of the same files.
const LOCK = join(tmpdir(), "wing-mutation-check-cues-rust.lock");
// The contract suite, per crate: the desktop's is a binary, wing-core's is a library. A filter that matches no
// test makes cargo exit 0, which would be read as MISSED — so each run is also asked how many tests it ran.
const TEST_ARGS = {
  desktop: ["test", "-p", "wing-controller-desktop", "--bin", "wing-controller-desktop"],
  core: ["test", "-p", "wing-core"],
};
const TEST_TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);

/** How many tests a cargo run really executed. `0` means the filter matched nothing, not that they passed. */
export function testsRun(output) {
  let total = 0;
  for (const match of String(output).matchAll(/running (\d+) tests?/g)) total += Number(match[1]);
  return total;
}

/** What a run's result means for one mutation. Pure, so `--self-test` can check it without cargo or a tree. */
export function classify(expect, { code, output, timedOut }) {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the tests did not finish in ${Math.round(TEST_TIMEOUT_MS / 1000)} s` };
  }
  if (code === null) {
    return { verdict: "could-not-run", why: "cargo could not be started: nothing was measured" };
  }
  if (code === 0) {
    // A green run that executed no test is not a contract holding: it is this check having gone stale.
    return testsRun(output) === 0
      ? { verdict: "unexpected", why: "the filter matched no test — this check is stale" }
      : { verdict: "missed", why: "the contracts passed with the defect in place" };
  }
  // A compile error is not the contract failing: the mutation has to be a *behaviour* the tests catch.
  if (/error\[E\d+\]|error: could not compile/.test(output)) {
    return { verdict: "unexpected", why: "the mutation did not compile" };
  }
  return expect.test(output)
    ? { verdict: "caught", why: "the contract failed and named the defect" }
    : { verdict: "unexpected", why: "it failed for another reason" };
}

const mutations = [
  {
    name: "the fade endpoints are clamped to a dB range again",
    file: MAIN,
    filter: "a_frequency_fade_survives_the_compiler",
    from: `    let relative_end = normalize_fade_to(step.fade_to.clone()) == "relative";
    let start = sane_fade_value(start);
    let end = sane_fade_value(end);
    // The selector's range governs only the address the selector produced: a raw path keeps the values
    // the operator typed, with the sanity bound. Same rule as every other value check.
    if !step_selector_owns_address(step) {
        return (start, end);
    }
    match wing_core::targets::fade_value_range(
        &step.target_category,
        &step.target_parameter,
        step.target_model.as_deref(),
    ) {
        Some((min, max)) => (start.clamp(min, max), if relative_end { end } else { end.clamp(min, max) }),
        None => (start, end),
    }`,
    to: `    let _ = step_selector_owns_address(step);
    let _ = step.fade_to.clone();
    (start.clamp(-144.0, 24.0), end.clamp(-144.0, 24.0))`,
    expect: /a_frequency_fade_survives_the_compiler|fade_start_value|2000/,
  },
  {
    name: "a ramp interpolates by offset whatever the leaf documents",
    file: MAIN,
    filter: "a_ramp_moves_in_the_domain_its_leaf_documents",
    from: `    match domain {
        wing_core::targets::FadeDomain::Logarithmic if start > 0.0 && end > 0.0 => {
            start * (end / start).powf(progress)
        }
        _ => start + (end - start) * progress,
    }`,
    to: `    let _ = domain;
    start + (end - start) * progress`,
    expect: /a_ramp_moves_in_the_domain_its_leaf_documents|geometric midpoint|632/,
  },
  {
    name: "the step count ignores how many addresses a step writes",
    file: MAIN,
    filter: "a_ramp_is_cut_to_fit_its_duration_and_the_osc_limiter",
    from: `    let budget = (duration_ms / interval_ms).max(1) as usize;
    usize::min(RAMP_MAX_STEPS, usize::max(2, budget / addresses))`,
    to: `    let _ = addresses;
    let budget = (duration_ms / interval_ms).max(1) as usize;
    usize::min(RAMP_MAX_STEPS, usize::max(2, budget))`,
    expect: /a_ramp_is_cut_to_fit_its_duration_and_the_osc_limiter|eight-address ramp|steps/,
  },
  {
    name: "a relative fade forgets the amount and stops where it started",
    file: MAIN,
    filter: "a_relative_fade_resolves_against_the_value_the_console_holds",
    from: `    let end = if step.fade_to == "relative" {
        start + step.fade_end_value
    } else {
        step.fade_end_value
    };`,
    to: `    let end = if step.fade_to == "relative" {
        start
    } else {
        step.fade_end_value
    };`,
    expect: /a_relative_fade_resolves_against_the_value_the_console_holds|fades down|fades up|-9/,
  },
  {
    name: "a fade from where it is starts from the authored value instead of the console's",
    file: MAIN,
    filter: "a_fade_from_the_consoles_value_ramps_from_what_the_desk_holds",
    from: `    let start = if step.fade_from == "current" {
        current.ok_or_else(|| {`,
    to: `    let start = if false {
        current.ok_or_else(|| {`,
    expect: /fade_from_the_consoles_value|start where the desk was|the desk was/,
  },
  {
    name: "a model's own table no longer decides a model-scoped fade's domain",
    file: CORE,
    package: "core",
    filter: "a_model_scoped_fade_domain_follows_the_model_the_step_carries",
    from: `            if let Some(rule) = model_parameter_rule(&section, &name, model) {
                if rule.logarithmic {
                    return FadeDomain::Logarithmic;
                }`,
    to: `            if let Some(rule) = model_parameter_rule(&section, &name, model) {
                let _ = &rule;
                if false {
                    return FadeDomain::Logarithmic;
                }`,
    expect: /a_model_scoped_fade_domain_follows_the_model_the_step_carries|DUCK|Linear/,
  },
];

/** One cargo run for one mutation's filter. A timeout or a missing cargo is carried out, never folded in. */
function runFilter(mutation) {
  const args = [...(TEST_ARGS[mutation.package] || TEST_ARGS.desktop), mutation.filter];
  try {
    const output = execFileSync("cargo", args, {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TEST_TIMEOUT_MS,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
    });
    return { code: 0, output, timedOut: false };
  } catch (error) {
    if (error.killed || error.signal === "SIGTERM") {
      return { code: null, output: String(error.stdout || ""), timedOut: true };
    }
    if (error.status === undefined) {
      return { code: null, output: String(error.message || ""), timedOut: false };
    }
    return {
      code: error.status,
      output: `${error.stdout || ""}${error.stderr || ""}`,
      timedOut: false,
    };
  }
}

if (process.argv.includes("--self-test")) {
  const cases = [
    // A green run that executed no test is a stale filter, not a contract holding: cargo exits 0 when the
    // filter matches nothing, and the first version of this check read that as MISSED.
    ["a passing run is MISSED", /x/, { code: 0, output: "running 1 test\ntest result: ok. 1 passed", timedOut: false }, "missed"],
    ["a filter that matched nothing is UNEXPECTED", /x/, { code: 0, output: "running 0 tests", timedOut: false }, "unexpected"],
    ["a named failure is caught", /the defect/, { code: 101, output: "the defect happened", timedOut: false }, "caught"],
    ["an unnamed failure is UNEXPECTED", /the defect/, { code: 101, output: "something else", timedOut: false }, "unexpected"],
    ["a compile error is UNEXPECTED", /x/, { code: 101, output: "error[E0063]: missing field", timedOut: false }, "unexpected"],
    ["a timeout is NO-VERDICT", /x/, { code: null, output: "", timedOut: true }, "no-verdict"],
    ["no cargo is COULD-NOT-RUN", /x/, { code: null, output: "spawn cargo ENOENT", timedOut: false }, "could-not-run"],
  ];
  let failed = 0;
  for (const [name, expect, result, want] of cases) {
    const got = classify(expect, result).verdict;
    if (got !== want) {
      failed += 1;
      console.error(`self-test: ${name} — expected ${want}, got ${got}`);
    }
  }
  console.log(failed === 0 ? `mutation-check classifier self-test OK (${cases.length} cases)` : `${failed} self-test failure(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

// Only one run at a time.
try {
  writeFileSync(LOCK, String(process.pid), { flag: "wx" });
} catch {
  console.error(`another mutation check holds ${LOCK}; refusing to interleave edits of the same files`);
  process.exit(2);
}
process.on("exit", () => {
  try {
    rmSync(LOCK, { force: true });
  } catch (_) {}
});

// Every file a mutation can touch, its bytes, and a copy outside the tree: nothing is restored from git, so this
// is safe to run with uncommitted work in those files.
const backupDir = mkdtempSync(join(tmpdir(), "wing-fade-mutation-"));
const originals = new Map();
for (const file of [MAIN, CORE]) {
  const bytes = readFileSync(file, "utf8");
  originals.set(file, bytes);
  copyFileSync(file, join(backupDir, basename(file)));
}
const restoreAll = () => {
  for (const [file, bytes] of originals) writeFileSync(file, bytes);
};
process.on("exit", restoreAll);

const results = [];
for (const mutation of mutations) {
  restoreAll();
  const original = originals.get(mutation.file);
  if (!original.includes(mutation.from)) {
    results.push({ name: mutation.name, verdict: "unexpected", why: "the mutation target was not found — this check is stale" });
    continue;
  }
  writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
  const result = runFilter(mutation);
  results.push({ name: mutation.name, ...classify(mutation.expect, result) });
  if (results[results.length - 1].verdict === "unexpected" || results[results.length - 1].verdict === "no-verdict") {
    // Print the real failure once, so an UNEXPECTED verdict can be read rather than guessed at.
    console.error(`--- ${mutation.name}: the run said\n${String(result.output).split("\n").slice(-25).join("\n")}`);
  }
}
// The tree is put back whatever happened: a check whose whole purpose is "these guards have teeth" that leaves a
// mutation behind is worse than no check.
restoreAll();
const notRestored = [MAIN, CORE].filter((file) => {
  try {
    return readFileSync(file, "utf8") !== originals.get(file);
  } catch (_) {
    return true;
  }
});
if (notRestored.length > 0) {
  console.error(`these files could NOT be restored — their originals are in ${backupDir}: ${notRestored.join(", ")}`);
  process.exit(3);
}
rmSync(backupDir, { recursive: true, force: true });

let clean = 0;
for (const result of results) {
  if (result.verdict === "caught") clean += 1;
  console.log(`${result.verdict.padEnd(13)} ${result.name} — ${result.why}`);
}
// Only `caught` counts. A stale target, a compile error, a timeout or a run that could not start all mean
// **nothing was measured** for that contract, and this check exists to say the contracts have teeth: a
// green line over an unmeasured one is exactly the "a check that cannot fail for the reason it exists"
// defect the project keeps finding.
const problems = results.length - clean;
console.log(
  problems === 0
    ? `every fade contract has teeth (${clean}/${results.length})`
    : `${problems} of ${results.length} mutation(s) measured nothing or were missed`,
);
process.exit(problems === 0 ? 0 : 1);
