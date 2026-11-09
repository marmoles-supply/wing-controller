// The cue contracts' teeth, proved by putting each defect back.
//
// `docs/CUE_SYSTEM_DESIGN_ADDENDUM_2026-10-04.md` §3.6 says the contract that matters most — "a cue that should have
// fired has fired, even when the hand-over is refused" — cannot live in `mutation-check-interapp.mjs`: that script
// restores the two UI files from git and does not know how to mutate Rust. This is its sibling for the backend half.
//
// It puts each way a cue could quietly not fire back — the order dropped in the hand-over, the confirmation that
// never clears, the full channel that drops without counting, the **startup install that never reaches the
// engine**, a new cue field that refuses the files written before it, a spent cue that forgets **how** it was spent,
// a cue pointing outside the macro library that is not reported broken, a corrupt list that never reads its
// recovery copy, and an LTC input that refuses the one drop-frame rate — into `desktop/src-tauri/src/timecode.rs`
// and `main.rs`, runs the Rust contract tests, and demands a failure that names the defect. It reports one of four
// verdicts and never blurs them:
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the tests **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason (including "it did not compile"), printed with the real failure
//   COULD-NOT-RUN  nothing was measured (no cargo, no test binary)
//
// Run: node scripts/mutation-check-cues-rust.mjs
//      node scripts/mutation-check-cues-rust.mjs --self-test     (the classifier's own cases; no cargo, no edits)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that mutates
// the tree must never run inside a gate. Unlike its sibling it does **not** restore from git — it copies every file
// it is about to change into a temporary folder first and puts the bytes back whatever happens, so it is safe to run
// with uncommitted work in those files (which is the normal case while someone is writing the fix this proves).

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMECODE = join(REPO, "desktop/src-tauri/src/timecode.rs");
const MAIN = join(REPO, "desktop/src-tauri/src/main.rs");
const LOCK = join(tmpdir(), "wing-mutation-check-cues-rust.lock");
// The contract suites, filtered to the modules the fix lives in — the base cargo arguments, plus one filter per
// suite. Three filters rather than one because the identity contract genuinely spans three homes: the engine's own
// module (`timecode::tests::`, `timecode_storage_tests::`), the key minting (`macro_keys`, in `main.rs`), and the
// macro library's own round-trip (`macro_library`). A filter list rather than a single string because the first
// version of this check used `timecode` alone and reported a false **MISSED**: the minting mutation was real, but
// the test that covers it was never run.
//
// The filters deliberately exclude the real-device MIDI/audio tests: those can fail for reasons this check does not
// measure, and a flaky failure would be reported as UNEXPECTED.
const TEST_ARGS = ["test", "-p", "wing-controller-desktop", "--bin", "wing-controller-desktop"];
const TEST_FILTERS = ["timecode", "macro_keys", "macro_library"];
const TEST_TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);

/** What a run's result means for one mutation. Pure, so `--self-test` can check it without cargo or a tree. */
export function classify(expect, { code, output, timedOut }) {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the tests did not finish in ${Math.round(TEST_TIMEOUT_MS / 1000)} s` };
  }
  if (code === null) {
    return { verdict: "could-not-run", why: "cargo could not be started: nothing was measured" };
  }
  // `caught` means the tests **failed** and named this defect. Passing while the phrase appears somewhere is not
  // evidence, and a compile error is not the contract failing.
  if (code !== 0 && /error\[E\d+\]|error: could not compile/.test(output)) {
    return { verdict: "unexpected", why: "the mutated tree did not compile — that is not the contract failing" };
  }
  if (code !== 0 && expect.test(output)) {
    return { verdict: "caught" };
  }
  if (code === 0) {
    return { verdict: "missed", why: "the tests PASSED with the defect in place" };
  }
  const firstFailure = (output.match(/assertion[^\n]*failed[^\n]*/) || [""])[0].slice(0, 160);
  return {
    verdict: "unexpected",
    why: `the tests failed, but not with ${expect}${firstFailure ? ` — they said: ${firstFailure}` : ""}`,
  };
}

// The ways a cue could quietly not fire. Each one is the **inverse** of a line in the fix, and each is expected to be
// caught by a named assertion in the tests that measure it.
const mutations = [
  {
    name: "the engine fires without recording: the original silent loss",
    file: TIMECODE,
    from: `            let _ = deliveries.record(event);`,
    to: `            let _ = event; // mutated: the event is never recorded`,
    expect: /both cues were crossed and fired/,
  },
  {
    name: "a confirmation that does not clear the order",
    file: TIMECODE,
    from: `        let entry = self.pending.remove(index);`,
    to: `        let entry = self.pending[index].clone();`,
    expect: /nothing is left unconfirmed/,
  },
  {
    name: "a full channel that drops without counting the retry",
    file: TIMECODE,
    from: `            if sender.try_send(()).is_err() {
                deliveries.record_deferred();
            }`,
    to: `            let _ = sender.try_send(());`,
    expect: /the full channel refused exactly one hand-over/,
  },
  {
    // The startup wiring itself: the saved list is read and reported, and never handed to the engine — which is
    // exactly the defect a restart used to have.
    name: "the saved list read at startup and never installed",
    file: MAIN,
    from: `    let (list, recovered) = read_timecode_cues_with_recovery(path)?;
    Ok((apply_timecode_cues(state, &list, announce), recovered))`,
    to: `    let (list, recovered) = read_timecode_cues_with_recovery(path)?;
    let _ = &announce; // mutated: the saved list reaches the engine only when the operator saves it
    Ok((list.cues.len(), recovered))`,
    expect: /a persisted cue must fire after a restart/,
  },
  {
    // A new field without `#[serde(default)]`: an older file (one written before the field existed) stops being this
    // build's file, which is precisely what the schema version staying at 1 forbids.
    name: "a new cue field that refuses the files written before it",
    file: TIMECODE,
    from: `    #[serde(default)]
    pub label: String,`,
    to: `    pub label: String, // mutated: no serde(default), so an older file is refused`,
    expect: /missing field .label./,
  },
  {
    // The cue number is the same contract on the field the number column and the external name depend on: without
    // `#[serde(default)]`, every file written before numbers existed stops being this build's file.
    name: "a cue number that refuses the files written before it",
    file: TIMECODE,
    from: `    #[serde(default, deserialize_with = "deserialize_cue_number")]
    pub number: String,`,
    to: `    #[serde(deserialize_with = "deserialize_cue_number")]
    pub number: String, // mutated: no serde(default), so an older file is refused`,
    expect: /missing field .number./,
  },
  {
    // And the same again for the group, so neither field can be added without the older-file direction being read.
    name: "a cue group that refuses the files written before it",
    file: TIMECODE,
    from: `    #[serde(default)]
    pub group: String,`,
    to: `    pub group: String, // mutated: no serde(default), so an older file is refused`,
    expect: /missing field .group./,
  },
  {
    // Two cues answering to one number: the number is what names a cue, and accepting a duplicate makes "go to cue
    // 5" ambiguous — which is the one thing the validation is there to prevent.
    name: "a list that accepts two cues with the same number",
    file: MAIN,
    from: `                if !numbers.insert(canonical.clone()) {`,
    to: `                if false && !numbers.insert(canonical.clone()) { // mutated: duplicate numbers are accepted`,
    expect: /two cues share the number/,
  },
  {
    // An import that installs a file it never validated: the defect is "the imported list replaced the current one
    // and only then did the operator find out". The contract refuses every shape by name **before** anything is
    // installed, so taking the check away turns it red.
    name: "an import that accepts a list this build cannot use",
    file: MAIN,
    from: `    imported.validate().map_err(|error| {
        format!("the cue list at {} cannot be imported: {error}", path.display())
    })?;`,
    to: `    // mutated: the imported list is never validated before it replaces the current one`,
    expect: /an invalid import must be refused before it replaces anything/,
  },
  {
    // An export that writes a list no reader would accept: the file looks exported and fails the moment it is
    // imported, which is the worst time to find out.
    name: "an export that writes a list this build cannot read back",
    file: MAIN,
    from: `    cues.validate()
        .map_err(|error| format!("this cue list cannot be exported: {error}"))?;`,
    to: `    // mutated: an invalid list is written out as if it were an export`,
    expect: /a list that is not a list is not exported/,
  },
  {
    // The kind of a spent cue is not stored: a window opened after the crossing can only paint "spent", which is the
    // state that hides whether the macro ran.
    name: "a spent cue that forgets whether it fired or was skipped",
    file: TIMECODE,
    from: `                    if seeking { CueSpentKind::Skipped } else { CueSpentKind::Fired },`,
    to: `                    CueSpentKind::Fired, // mutated: the kind is not stored with the id`,
    expect: /the kind is stored with the id/,
  },
  {
    // A cue pointing outside the library is not detected, which is the failure that used to be silent.
    name: "a cue whose macro is not in the library is not detected",
    file: TIMECODE,
    from: `                (None, Some(index)) => match library {
                    Some(view) if index >= view.len() => Some(CueProblem::MacroMissing),
                    _ => None,
                },`,
    to: `                (None, Some(_index)) => None, // mutated: an out-of-range macro is not detected`,
    expect: /a row can be marked broken/,
  },
  {
    // The key stops being minted: a library written before keys existed loads with every macro sharing an empty key,
    // and a reference that names one by key names all of them at once — or none.
    name: "a library that never mints a key for a macro",
    file: MAIN,
    from: `    mint_macro_ids(&mut macros);`,
    to: `    // mutated: no key is ever minted`,
    expect: /one unique key per macro/,
  },
  {
    // A cue that names its macro by key is not judged by it, so the fault the positional model could not see at all
    // comes back: a reference to a macro that no longer exists reads as healthy.
    name: "a cue whose macro key is gone reads as healthy",
    file: TIMECODE,
    from: `                (Some(key), _) => match library.and_then(|view| view.holds_key(key)) {
                    Some(false) => Some(CueProblem::MacroMissing),
                    _ => None,
                },`,
    to: `                (Some(_key), _) => None, // mutated: a key is never judged`,
    expect: /a key that is gone must be reported/,
  },
  {
    // The fired event stops carrying the key, so the window falls back to the position — which is exactly how a
    // reorder used to fire somebody else's macro.
    name: "a fired cue that does not hand over the key it names",
    file: TIMECODE,
    from: `                    macro_id: cue.macro_id.clone(),`,
    to: `                    macro_id: None, // mutated: the key never reaches the window`,
    expect: /must carry the macro's key/,
  },
  // There is deliberately **no** mutation for `TimecodeCue::macro_id` losing its `#[serde(default)]`. The field is an
  // `Option<String>`, which serde already treats as optional, so that mutation is **vacuous** — measured, not assumed:
  // it was in this list, its target was found, and it reported MISSED, because removing a redundant attribute cannot
  // change a parse. The contract it was meant to prove — an older cue file still loads, keyless — is pinned by an
  // assertion in `the_cue_number_and_group_travel_both_ways_between_builds` instead. The macro library's own key is a
  // plain `String`, where the attribute *is* load-bearing, and that one has a mutation below.
  {
    // And the same for the library's own field: a macro library written before keys existed has no `id` in it, and
    // refusing it would mean the operator's whole library fails to load because of a field we added.
    name: "a macro key that refuses the library files written before it",
    file: MAIN,
    from: `    /// \`""\` means "not minted yet", which is what every library written before this field says.
    #[serde(default)]
    id: String,`,
    to: `    /// \`""\` means "not minted yet", which is what every library written before this field says.
    id: String, // mutated: no serde(default), so an older library is refused`,
    expect: /missing field .id./,
  },
  {
    // The recovery copy is beside the file and is never read, which is what made the cue list's `.bak` dead weight.
    name: "a corrupt cue list that never reads its recovery copy",
    file: MAIN,
    from: `            let list = parse_timecode_cues_file(&backup).map_err(|error| {`,
    to: `            let list = parse_timecode_cues_file(path).map_err(|error| { // mutated: the recovery copy is never read`,
    expect: /the recovery copy answers/,
  },
  {
    // 29.97 is the rate LTC could not be started at while the engine supported it, so the page could not offer it.
    name: "an LTC input that refuses the one drop-frame rate",
    file: MAIN,
    from: `        "29.97" => Ok(timecode::TimecodeRate::Fps29_97),`,
    to: `        // mutated: 29.97 is no longer a rate this build reads`,
    expect: /29.97 is a rate this build reads/,
  },
  {
    // The show's frame rate ignored: the cue is counted in the format it was **written** at, which is the state that
    // fired a 25 fps list ten minutes early under a 30 fps source.
    name: "a cue counted in its own frame rate instead of the source's",
    file: TIMECODE,
    from: `fn cue_frames_at(cue: &TimecodeCue, format: (TimecodeRate, bool)) -> Option<i64> {
    cue.at
        .exists_in(format.0, format.1)
        .then(|| cue.at.to_frames_in(format.0, format.1))
}`,
    to: `fn cue_frames_at(cue: &TimecodeCue, _format: (TimecodeRate, bool)) -> Option<i64> {
    Some(cue.at.to_frames()) // mutated: the cue is counted in the format it was written at
}`,
    expect: /must not fire at 00:50:00:00/,
  },
  {
    // A label that cannot exist at the source's rate accepted anyway, so a cue nobody can place is compared at a frame
    // that does not exist and the row says nothing about it.
    name: "a frame number that does not exist at the source's rate accepted",
    file: TIMECODE,
    from: `        if self.frames >= rate.frames_per_second() as u32 {
            return false;
        }`,
    to: `        // mutated: a frame number that does not exist at this rate is accepted`,
    expect: /staying silent about a cue that can never fire/,
  },
  {
    // The freewheel window reported as nothing at all, so the operator cannot tell a hiccup from a stopped show.
    name: "a freewheel tolerance that is never reported",
    file: TIMECODE,
    from: `        let freewheel_ms = self.stale_after.as_millis() as u64;`,
    to: `        let freewheel_ms = 0u64; // mutated: the tolerance is not reported`,
    expect: /the tolerance is reported even before anything arrives/,
  },
  {
    // And the window's remaining time never reported, so "the window is exhausted" and "no show ever started" become
    // the same answer — which is exactly the pair the two fields exist to keep apart.
    name: "a freewheel window that never reports how much of it is left",
    file: TIMECODE,
    from: `        let freewheel_remaining_ms = match (position, age) {
            (Some(_), Some(age)) => Some(freewheel_ms.saturating_sub(age.as_millis() as u64)),
            _ => None,
        };`,
    to: `        let freewheel_remaining_ms = None; // mutated: the window is never reported as running`,
    expect: /500 ms of the 750 ms window are left/,
  },
  {
    // A rate change nobody is warned about: the answer is always "nothing would break", so the window asks no question
    // and the operator finds out from a row that went red after the show is already running at the new rate.
    name: "a rate change that never names the cues it would strand",
    file: TIMECODE,
    from: `pub fn cues_impossible_at(cues: &[TimecodeCue], rate: TimecodeRate, drop_frame: bool) -> Vec<String> {
    cues.iter()
        .filter(|cue| !cue.at.exists_in(rate, drop_frame))
        .map(|cue| cue.id.clone())
        .collect()
}`,
    to: `pub fn cues_impossible_at(cues: &[TimecodeCue], _rate: TimecodeRate, _drop_frame: bool) -> Vec<String> {
    let _ = cues;
    Vec::new() // mutated: a rate change is never warned about
}`,
    expect: /only the label that does not exist at 24 fps is named/,
  },
  {
    // Going back re-arming **every** policy, which makes "once in the show" and "once per pass" the same behaviour
    // again — the exact distinction the third policy exists for, and the one a rehearsal would notice first.
    name: "a cue that fires once in the show, armed again by going back",
    file: TIMECODE,
    from: `            if cue.repeat_policy() == CueRepeat::Show {
                return true;
            }`,
    to: `            // mutated: every policy is re-armed by going back, so "once in the show" repeats`,
    expect: /leaves the once-in-the-show cue spent/,
  },
  {
    // The older boolean read the other way round: every file written before the three policies existed would come back
    // with its repeating cues firing once and its one-shot cues firing every crossing.
    name: "the older repeat flag read backwards",
    file: TIMECODE,
    from: `        self.repeat.unwrap_or(if self.repeats { CueRepeat::Every } else { CueRepeat::Pass })`,
    to: `        self.repeat.unwrap_or(if self.repeats { CueRepeat::Pass } else { CueRepeat::Every }) // mutated: read backwards`,
    expect: /always meant every crossing/,
  },
  {
    // One by one drive behaving like timecode: the cues fire on their own times again, which is the whole thing the
    // mode exists to stop — a rehearsal that runs itself.
    name: "a one-by-one list that fires on a crossing anyway",
    file: TIMECODE,
    from: `        if self.drive == CueDrive::Sequential {`,
    to: `        if false { // mutated: the sequential branch is skipped`,
    expect: /a crossing must not fire a sequential cue/,
  },
  {
    // A duration that moves the sequence on at once: every cue due on the next position, which makes the field the
    // operator types look like it does something while the show runs away.
    name: "a duration that moves the sequence on immediately",
    file: TIMECODE,
    from: `            (Some(position), Some(ms)) => Some(add_ms(position, ms)),`,
    to: `            (Some(position), Some(_ms)) => Some(position), // mutated: the duration is ignored`,
    expect: /the next is not due|the deadline is measured from where the cue fired/,
  },
  {
    // A rehearsal that hands its events back anyway: the plan would be empty and the events would go on to the delivery
    // ledger, which is the one thing Monitor exists to prevent — a rehearsal that fires the show.
    name: "a rehearsal that hands its events to the delivery path anyway",
    file: TIMECODE,
    from: `        if !self.rehearsing {
            return events;
        }`,
    to: `        if true { // mutated: a rehearsal emits like a show
            return events;
        }`,
    expect: /a rehearsal hands back no events at all/,
  },
  {
    // A crossing reported as perfectly on time: the field Monitor exists for would read zero for every cue, and an
    // operator would conclude the timecode was fine when it was the report that was blind.
    name: "a rehearsal whose lateness is always zero",
    file: TIMECODE,
    from: `                    .map(|frames| position.to_frames() - frames),`,
    to: `                    .map(|_frames| 0i64), // mutated: every crossing reported as perfectly on time`,
    expect: /two frames past the time the cue names/,
  },
  {
    // The refusal put back: a list whose cues were captured at two rates becomes unsavable again, which is exactly what
    // an ordinary rate change of the input between two captures used to do — the second add fails and nothing is
    // written. The check that stood there compared stored rates that nothing else reads.
    name: "a save that refuses a list captured at two rates",
    file: MAIN,
    from: `        Ok(())
    }

    /// The list as it is stored: this build's schema, every cue number in its canonical decimal form, every group
    /// trimmed.`,
    to: `        // mutated: the mixed-rate refusal is back
        let rates: std::collections::HashSet<String> = self
            .cues
            .iter()
            .map(|cue| format!("{:?}{}", cue.at.rate, cue.at.drop_frame))
            .collect();
        if rates.len() > 1 {
            return Err("the cue list mixes frame rates".to_string());
        }
        Ok(())
    }

    /// The list as it is stored: this build's schema, every cue number in its canonical decimal form, every group
    /// trimmed.`,
    expect: /a list captured at two rates is still a list/,
  },
  {
    // The rate check with its tolerance opened to nothing: 29.97 read as 30 differs by 0.1 %, so every professional
    // default would be reported as a mismatch for ever — the false alarm the boundary rule exists to prevent.
    name: "a rate check that reports across a rate boundary",
    file: TIMECODE,
    from: `    (measured_fps - nominal).abs() / nominal > 0.02`,
    to: `    (measured_fps - nominal).abs() / nominal > 0.001 // mutated: the boundary is reported`,
    expect: /29\.97 read as 30 is 0\.1 %: not a disagreement/,
  },
  {
    // A cue that recorded no hash reported as changed: the false-alarm direction, and the one that would flag every cue
    // in a file written before this existed the moment the feature shipped.
    name: "a cue with no recorded content, reported as changed",
    file: TIMECODE,
    // The whole match, not just its `_ => None,` arm: that arm's text appears in several matches in this file, and a
    // first-occurrence replace landed in another one — the mutant then failed to compile, which the check reported as
    // UNEXPECTED rather than as a caught defect. An anchor that says which match it belongs to is the fix.
    from: `                macro_changed: match (cue.macro_hash.as_deref(), cue.macro_id.as_deref(), library) {
                    (Some(recorded), Some(key), Some(view)) => {
                        view.hash_of(key).map(|now| now != recorded)
                    }
                    _ => None,
                },`,
    to: `                macro_changed: match (cue.macro_hash.as_deref(), cue.macro_id.as_deref(), library) {
                    (Some(recorded), Some(key), Some(view)) => {
                        view.hash_of(key).map(|now| now != recorded)
                    }
                    _ => Some(true), // mutated: an unjudgeable cue reads as changed
                },`,
    expect: /a cue that recorded no hash is not judged at all/,
  },
  {
    // The comparison made against the **wrong macro**: every cue judged against whichever macro the library lists first.
    // Every other assertion about the note would still pass, which is why the "still matches" case is the one with teeth.
    name: "a content comparison made against the wrong macro",
    file: TIMECODE,
    from: `                .find(|known| known.key == key)
                .and_then(|known| known.hash.as_deref()),`,
    to: `                .find(|_known| true) // mutated: whichever macro comes first
                .and_then(|known| known.hash.as_deref()),`,
    expect: /a macro whose content still matches is not reported/,
  },
];

if (process.argv.includes("--self-test")) {
  const cases = [
    ["tests that fail and name the defect", /both cues were crossed and fired/,
      { code: 101, output: "assertion `left == right` failed: both cues were crossed and fired" }, "caught"],
    ["tests that PASS with the defect in place", /both cues were crossed and fired/,
      { code: 0, output: "test result: ok. 27 passed" }, "missed"],
    ["a tree that did not compile", /both cues were crossed and fired/,
      { code: 101, output: "error[E0308]: mismatched types" }, "unexpected"],
    ["tests that failed for another reason", /both cues were crossed and fired/,
      { code: 101, output: "assertion `left == right` failed: something else entirely" }, "unexpected"],
    ["no cargo at all", /anything/, { code: null, output: "" }, "could-not-run"],
    ["a run that ran out of time", /anything/, { code: 101, output: "", timedOut: true }, "no-verdict"],
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

// Only one run at a time: two would interleave mutations of the same files and each would restore the other's bytes.
// A lock left by a run that died is taken over, because a stale lock that blocks the check for ever is its own fault.
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

/** One cargo run for one filter. A timeout or a missing cargo is carried out, never folded into "it failed". */
function runOne(filter) {
  try {
    const output = execFileSync("cargo", [...TEST_ARGS, filter], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TEST_TIMEOUT_MS,
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

/** Every filter's result, joined: the mutation is caught if the suite that covers it says so, whichever that is. */
function runTests() {
  let code = 0;
  let output = "";
  let timedOut = false;
  for (const filter of TEST_FILTERS) {
    const result = runOne(filter);
    output += result.output;
    if (result.timedOut) timedOut = true;
    if (result.code !== 0 && code === 0) code = result.code;
  }
  return { code, output, timedOut };
}

// Every file a mutation can touch, its bytes, and a copy of those bytes outside the tree. The copy is what makes this
// safe to run with uncommitted work in the file: nothing is restored from git.
const originals = new Map([TIMECODE, MAIN].map((file) => [file, readFileSync(file, "utf8")]));
const backupDir = mkdtempSync(join(tmpdir(), "wing-cues-mutation-"));
const backups = new Map([...originals.keys()].map((file) => [file, join(backupDir, basename(file))]));
for (const [file, backup] of backups) copyFileSync(file, backup);

const restoreAll = () => {
  for (const [file, content] of originals) writeFileSync(file, content);
};

const results = [];
try {
  for (const mutation of mutations) {
    // Whatever the previous mutation left, this one starts from the file as it was found.
    restoreAll();
    const original = originals.get(mutation.file);
    if (!original.includes(mutation.from)) {
      results.push({ name: mutation.name, verdict: "unexpected", why: "the mutation target was not found — this check is stale" });
      continue;
    }
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    const result = runTests();
    results.push({ name: mutation.name, ...classify(mutation.expect, result) });
  }
} finally {
  // Whatever happened, put every byte back — and say so if a file is not what it was, because a check that silently
  // leaves a mutation behind is worse than no check.
  restoreAll();
  const notRestored = [...originals].filter(([file, content]) => readFileSync(file, "utf8") !== content);
  if (notRestored.length > 0) {
    console.error(`these files could NOT be restored — their originals are in ${backupDir}: ${notRestored.map(([file]) => file).join(", ")}`);
  } else {
    rmSync(backupDir, { recursive: true, force: true });
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
  `${counts.unexpected ? `, ${counts.unexpected} unexpected (the tests failed for another reason)` : ""}` +
  `${counts["could-not-run"] ? `, ${counts["could-not-run"]} could not run (nothing was measured)` : ""}` +
  `${counts["no-verdict"] ? `, ${counts["no-verdict"]} without a verdict (timed out)` : ""}`);

const allCaught = results.every((result) => result.verdict === "caught");
console.log(allCaught
  ? "every way a cue could be lost in silence is caught by a test that fails when it is put back"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
