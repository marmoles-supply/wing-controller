// The teeth of the macro-completeness contracts, proved by putting each defect back.
//
// `desktop/src-tauri/src/main.rs` has two functions that look at the same empty trigger and answer two
// different questions, and the whole cue-only macro depends on them not being confused:
//
//   * `validate_macro_config_for_model` decides whether a **preflight** has anything to refuse. An empty
//     trigger is a normal state there - the operator's "only a cue fires it" choice - so it says nothing;
//   * `macro_incomplete_reason` decides whether the macro **listens**. An empty trigger has no address to
//     watch, so the runtime reports it by name instead of pretending it is armed.
//
// The owner's refusal came from the window, and it was right: his trigger was **partly** filled, which is
// a different thing from having none. The contract that pins this
// (`tests::a_macro_with_no_trigger_of_its_own_is_complete_and_simply_does_not_listen`) is what stops the
// two answers from silently swapping, and this script demands that it fails when they do.
//
// Deliberately **not** named `test-*.mjs`: the gate runs that prefix, and this script mutates the tree.
// It reports one of four verdicts and never blurs them:
//
//   caught          the contract failed, and named the defect
//   MISSED          the contract **passed** with the defect in place
//   UNEXPECTED      it failed for another reason, printed with the real assertion
//   COULD-NOT-RUN   nothing was measured
//
// It takes **byte copies** and restores from those bytes, never from git: the sibling that restored from
// git destroyed uncommitted work once. And it restores a file **only** when the file still holds either
// the bytes this run started with or the bytes this script last wrote - a foreign change means another
// writer is in the tree, so it leaves the file alone and says so, loudly, with the backup path.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TARGET = "desktop/src-tauri/src/main.rs";
const TEST_NAME = "a_macro_with_no_trigger_of_its_own_is_complete_and_simply_does_not_listen";

/// Each mutation puts one half of the defect back, and names the assertion that must catch it.
const MUTATIONS = [
  {
    id: "M-A1",
    what: "the preflight refuses a macro with no trigger of its own",
    from: `        // An unfinished draft is a normal state, not an error: the library keeps it and the macro is
        // reported as not listening.`,
    to: `        problems.push("trigger not configured".to_string());`,
    snippet: "an empty trigger is a normal state, not a validation error",
  },
  {
    id: "M-A2",
    what: "the runtime pretends a macro with no trigger of its own is armed, so nobody is told it does not listen",
    from: `        return Some("trigger not configured".to_string());`,
    to: `        return None;`,
    snippet: "and it does not listen",
  },
];

function run(command, args) {
  try {
    const out = execFileSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/// One test, so a mutation costs a compile rather than the whole suite.
function runContract() {
  return run("cargo", ["test", "-p", "wing-controller-desktop", TEST_NAME]);
}

function classify({ passed, output, snippet }) {
  if (passed) return "MISSED";
  if (snippet && output.includes(snippet)) return "caught";
  const assertion = (output.match(/assertion[^\n]*|panicked at[^\n]*/) || [""])[0];
  return assertion ? `UNEXPECTED (${assertion})` : "UNEXPECTED";
}

function selfTest() {
  const cases = [
    [{ passed: false, output: "assertion failed: an empty trigger is a normal state, not a validation error", snippet: "an empty trigger is a normal state, not a validation error" }, "caught"],
    [{ passed: true, output: "test result: ok", snippet: "and it does not listen" }, "MISSED"],
    [{ passed: false, output: "error[E0425]: cannot find value", snippet: "and it does not listen" }, "UNEXPECTED"],
    [{ passed: false, output: "panicked at 'x'", snippet: "nothing matches" }, "UNEXPECTED"],
    [{ passed: false, output: "assertion `left == right` failed", snippet: "and it does not listen" }, "UNEXPECTED"],
    [{ passed: true, output: "", snippet: "" }, "MISSED"],
  ];
  let ok = 0;
  for (const [input, expected] of cases) {
    const got = classify(input);
    const fine = expected === "UNEXPECTED" ? got.startsWith("UNEXPECTED") : got === expected;
    if (fine) ok += 1;
    else console.log(`  classifier self-test: expected ${expected}, got ${got}`);
  }
  console.log(`classifier self-test: ${ok}/${cases.length}`);
  return ok === cases.length;
}

function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);

  const original = readFileSync(join(ROOT, TARGET), "utf8");
  const backup = mkdtempSync(join(tmpdir(), "wing-macro-mutation-"));
  writeFileSync(join(backup, "main.rs"), original);
  console.log(`backup: ${backup}/main.rs`);

  const results = [];
  try {
    const baseline = runContract();
    if (baseline.code !== 0) {
      console.log(`COULD-NOT-RUN: the contract does not pass before any mutation.\n${baseline.out.slice(-800)}`);
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
      const outcome = runContract();
      results.push({
        id: mutation.id,
        verdict: classify({ passed: outcome.code === 0, output: outcome.out, snippet: mutation.snippet }),
        what: mutation.what,
      });

      // Restore only what this script wrote: a foreign change is a concurrent writer, and clobbering it
      // is how work is lost. Leave it alone and say so.
      const now = readFileSync(join(ROOT, TARGET), "utf8");
      if (now === mutated) {
        writeFileSync(join(ROOT, TARGET), original);
      } else {
        console.log(`REFUSING to restore ${TARGET}: it changed while this ran. Backup: ${backup}/main.rs`);
        break;
      }
    }
  } finally {
    const now = readFileSync(join(ROOT, TARGET), "utf8");
    if (now !== original && now !== MUTATIONS.map((m) => original.replace(m.from, m.to)).find((text) => text === now)) {
      console.log(`left ${TARGET} untouched: it holds bytes this script did not write (backup: ${backup}/main.rs)`);
    } else if (now !== original) {
      writeFileSync(join(ROOT, TARGET), original);
      console.log(`${TARGET} restored from the bytes taken at the start`);
    }
  }

  console.log("\n==== summary ====");
  for (const result of results) {
    console.log(`${result.id}   ${result.verdict}${result.what ? ` :: ${result.what}` : ""}`);
  }
  const missed = results.filter((r) => String(r.verdict).startsWith("MISSED")).length;
  const couldNot = results.filter((r) => String(r.verdict).startsWith("COULD-NOT-RUN")).length;
  process.exit(missed > 0 || couldNot > 0 ? 1 : 0);
}

main();
