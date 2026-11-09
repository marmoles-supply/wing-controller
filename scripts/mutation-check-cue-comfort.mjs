// The teeth of the cue comforts and of the notice toggle that governs every automatic firing path, proved by putting
// each defect back.
//
// `scripts/test-desktop-cue-comfort-browser.mjs` is the page-side contract and
// `a_cue_added_at_the_end_lands_one_frame_past_the_lasts_position` in `main.rs` is the device-free half. "The
// contract passes" is worth little on its own — this project has shipped a green gate over a control that did
// nothing — so this puts each defect back, runs the contract that is supposed to catch it, and demands a failure
// that names it.
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the contract **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason, printed with the assertion that actually fired
//   COULD-NOT-RUN  nothing was measured (no browser, no cargo, or a file a concurrent writer changed)
//   NO-VERDICT     the run did not finish inside its bound (a wedged browser looks exactly like this)
//
// Run: node scripts/mutation-check-cue-comfort.mjs
//      node scripts/mutation-check-cue-comfort.mjs --self-test   (the classifier and the restore guard; no tree edit)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that mutates
// the working tree must never run inside a gate. It takes **byte copies** of the files it rewrites and restores from
// those bytes, never from git — the usual moment to run it is before the fix is committed, and those uncommitted
// bytes are the ones to keep. The guard (`planRestore`) is the one written for `mutation-check-ltc-stream.mjs`: it
// refuses to overwrite a file a **concurrent writer** changed while the check was running.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(REPO, "desktop/ui/index.html");
const LTC = join(REPO, "desktop/ui/ltc.html");
const LTC_SUITE = join(REPO, "scripts/test-desktop-ltc-window-browser.mjs");
const GUIDE = join(REPO, "docs/guide/13-timecode.md");
const CUE_LIST_JS = join(REPO, "desktop/ui/cue-list.js");
const MIDI = join(REPO, "desktop/src-tauri/src/inter_app_midi.rs");
const LTC_DEVICE = join(REPO, "desktop/src-tauri/src/ltc_device.rs");
const UI_CONTRACTS = join(REPO, "scripts/test-desktop-ui-contracts.mjs");
const LTC_WINDOW = join(REPO, "scripts/test-desktop-ltc-window-browser.mjs");
const SKIP_REASON = join(REPO, "scripts/test-desktop-skip-reason.mjs");
const MAIN = join(REPO, "desktop/src-tauri/src/main.rs");
const TC = join(REPO, "desktop/src-tauri/src/timecode.rs");
const SUITE = join(REPO, "scripts/test-desktop-cue-comfort-browser.mjs");
const LOCK = join(tmpdir(), "wing-mutation-check-cue-comfort.lock");
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NO_BROWSER = /SKIP: no Chrome remote debugging/;
const TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);
const CARGO_TEST_ARGS = ["test", "-p", "wing-controller-desktop", "--bin", "wing-controller-desktop",
  "a_cue_added_at_the_end"];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a run's result means for one mutation. Pure, so `--self-test` can check it without a browser or cargo. */
export function classify(expect, { code, output, timedOut, cargo = false }) {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the contract did not finish in ${Math.round(TIMEOUT_MS / 1000)} s — a wedged browser looks like this, and so would a hang this mutation caused` };
  }
  if (code === null) {
    return { verdict: "could-not-run", why: "the contract could not be started: nothing was measured" };
  }
  if (!cargo && (code === 3 || NO_BROWSER.test(output))) {
    return { verdict: "could-not-run", why: `the suite never ran (exit ${code})` };
  }
  if (cargo && code !== 0 && /error\[E\d+\]|error: could not compile/.test(output)) {
    return { verdict: "unexpected", why: "the mutated tree did not compile — that is not the contract failing" };
  }
  if (code !== 0 && expect.test(output)) {
    return { verdict: "caught" };
  }
  if (code === 0) {
    return { verdict: "missed", why: "the contract PASSED with the defect in place" };
  }
  const firstFailure = (output.match(cargo ? /assertion[^\n]*failed[^\n]*/ : /AssertionError[^\n]*/) || [""])[0].slice(0, 200);
  return {
    verdict: "unexpected",
    why: `the contract failed, but not with ${expect}${firstFailure ? ` — it actually said: ${firstFailure}` : ""}`,
  };
}


// Each mutation is the inverse of one property the fix depends on. `edits` are exact source texts: a mutation whose
// target is not found is reported as stale rather than silently skipped.
const mutations = [
  {
    // **A field drawn as a raised face instead of a well.** The kit's rule 2 puts a number the operator reads in a
    // well, and the bevel table gives sunken as "the same pair, reversed" - dark top-left, light bottom-right. The
    // row drew it the other way round for the editor's inputs, and the dense fields took the browser's own raised
    // border because no rule gave them one. Section 27 measures the COMPUTED colours, because the kit resolves its
    // tokens at render time and both themes resolve them differently.
    name: "a field the row draws is a raised face instead of a well",
    file: CUE_LIST_JS,
    kind: "browser",
    suite: LTC_WINDOW,
    edits: [{
      from: "border-bottom-color: var(--line-light, #dfdfdf); border-right-color: var(--line-light, #dfdfdf);",
      to: "border-top-color: var(--line-light, #dfdfdf); border-left-color: var(--line-light, #dfdfdf);",
    }],
    expect: /must be a WELL|is a well/,
  },
  {
    // **A second window owning the shared row's furniture.** The dense row lays out the shared row, so exactly one
    // window may own it; a second is how the two drifting copies the module's block exists to prevent would start.
    // The source guard cannot see a JOINT property - that is section 26's job - but it can see a second owner.
    name: "a second window owns the shared row's furniture",
    file: HTML,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{
      from: "  <style>",
      to: "  <style>\n    .cue-dense { display: flex; }",
    }],
    expect: /exactly one window may own it/,
  },
  {
    // **The defect 47c7b45f fixed, put back.** The two health-driven links asked "is this the problem?" and a
    // predicate like that answers FALSE for a problem it has never heard of - so a cue carrying an unrecognised
    // problem was drawn with its broken tag while blockerChain reported every link healthy.
    name: "a problem the window cannot word is reported as healthy",
    file: CUE_LIST_JS,
    kind: "browser",
    suite: LTC_WINDOW,
    edits: [{
      from: "      const unrecognised = health !== null && health.problem != null && !KNOWN_PROBLEMS.includes(health.problem);",
      to: "      const unrecognised = false;",
    }],
    expect: /must report unknown, not ok/,
  },
  {
    // **The static default saying less than its script.** The card shipped 'No cue list yet.' in the HTML while the
    // script wrote the full sentence into that same element (fixed in bde71fd7), and the static copy is what an
    // operator reads BEFORE any script runs. Note the substring trap this guard is built around: 'No cue list yet.'
    // IS a prefix of the sentence, so a `includes` check would pass on the defect.
    name: "a static default says less than the sentence its script writes",
    file: HTML,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{
      from: ">No cue list yet. Cues are added in the LTC window — “Edit the cue list…”.</div>",
      to: ">No cue list yet.</div>",
    }],
    expect: /says something its script never writes/,
  },
  {
    // **The third id rule, put back.** The window minted `cue-${cues.length + 1}-${Date.now() % 100000}` (fixed in
    // 54969b2d) while cue-list.js exported nextCueId - and the timestamp shape does not match the module's
    // /^cue-(\d+)$/, so the cue was invisible to its uniqueness scan.
    name: "a window mints a cue id of its own",
    file: HTML,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{
      from: "id: CUE.nextCueId(cues),",
      to: "id: `cue-${cues.length + 1}-${Date.now() % 100000}`,",
    }],
    expect: /a window is minting a cue id itself/,
  },
  {
    // **The default spelled by hand, in a window that reads the array four hundred lines earlier.** It was eight
    // literals in two files (f6f782f3); this puts one back, so the guard has something to find. A window that
    // hard-codes the default can disagree with cue-list.js the moment the array is reordered.
    name: "a window spells the module's sort default by hand",
    file: LTC,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{
      from: "String(published.sort ?? CUE.SORT_MODES[0])",
      to: "String(published.sort ?? \"smpte\")",
    }],
    expect: /spelling the module's default by hand/,
  },
  {
    // **The rule main.rs states in its own words**: the backend parser is "the only timecode parser in the tree, and
    // the window is not allowed a second one". MEASURED 2026-10-08: that was false - index.html carried a MORE
    // PERMISSIVE one, and stored cues from shapes the rest of the tree rejects. Fixed in b3c16651; this is what keeps
    // it fixed, and it puts the parser back rather than deleting the call, so the guard has something to count.
    name: "a window parses timecode with a parser of its own",
    file: HTML,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{
      from: "const at = CUE.parsePositionText(snapshot.position);",
      to: "const parts = /^(\\d+):(\\d+):(\\d+)[:;](\\d+)$/.exec(String(snapshot.position)); const at = parts ? { hours: Number(parts[1]), minutes: Number(parts[2]), seconds: Number(parts[3]), frames: Number(parts[4]) } : null;",
    }],
    expect: /exactly one timecode parser/,
  },
  {
    // **A number the operator reads, in the copy he reads BEFORE pressing the button.** The guide states how many lines
    // the as-run record keeps, the constant is timecode.rs:806, and the tooltip is the second copy. The guard compares
    // all three; this mutation makes the guide disagree with the other two.
    name: "the guide states a different record bound from the engine",
    file: GUIDE,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{ from: "keeps the last 2 000 lines", to: "keeps the last 3 000 lines" }],
    expect: /the guide tells the operator the record keeps/,
  },
  {
    // **The mutation for the contract that exists because a STUB shared the code's assumption.** This puts the
    // original defect back: `skipReason` tests only the JavaScript `null`, while the real record OMITS the key
    // (`skip_serializing_if = "Option::is_none"`) so the window sees `undefined`. The suite it drives has no stub and
    // no browser - it calls the function directly - so this mutation is caught by the one test that CANNOT inherit the
    // assumption that hid the defect for three rounds.
    name: "an unmeasured skip is decided by a null test, so an absent key reads as a jump",
    file: CUE_LIST_JS,
    kind: "browser",
    suite: SKIP_REASON,
    edits: [{
      from: `if (verdict !== true && verdict !== false) {`,
      to: `if (verdict === null) {`,
    }],
    expect: /must say the position moved/,
  },
  {
    // **The stub is a second declaration of the Rust DTO, and this is the mutation that keeps the guard honest.**
    // It invents a field the record does not carry - the exact defect that produced two bugs in one day, where a
    // window read `line.label` and stayed green because the stub had made one up. If the DTO guard is narrowed,
    // moved out of a `test-*.mjs`, or deleted, this mutation stops being caught and the harness says so.
    name: "a suite fixture invents a field the Rust struct does not declare",
    file: LTC_SUITE,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{
      from: `number: "4", at: "01:00:40:00"`,
      to: `number: "4", label: "invented", at: "01:00:40:00"`,
    }],
    expect: /AsRunLine does not declare/,
  },
  {
    // **A number the operator reads, drifting from the constant that governs it.** The tooltip on the Last run
    // button says how many lines the record keeps, and an HTML tooltip cannot derive it from Rust, so the two copies
    // are kept equal by a contract. This is the mutation that proves the contract compares them: the tooltip says
    // 3 000 while AS_RUN_LINES stays 2 000.
    name: "the operator-visible tooltip states a different number from the constant",
    file: LTC,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{
      from: `it is up to 2 000 lines`,
      to: `it is up to 3 000 lines`,
    }],
    expect: /while the engine keeps/,
  },
  {
    // The owner's report: the cue fires the macro and the courtesy notice never appears, though the macro's own
    // [!] NOTICE button reads ON.
    name: "the cue-fired macro whose courtesy notice never appears",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `          if (notice && macro.courtesyNotice === true) {
            showCourtesyNotice(config, notice);
          }`,
      to: `          // mutated: the cue path fires the macro and never reads the per-macro notice toggle`,
    }],
    expect: /must show the courtesy card/,
  },
  {
    // The owner's rule: "un interruptor que gobierna tres de los cuatro caminos de disparo no es un interruptor".
    // The inter-app path fires the macro and never asks for the notice, which is exactly the defect the cue path
    // had before d7052031 — a macro whose [!] NOTICE button reads ON stays silent when another application fires it.
    name: "an inter-app trigger firing the macro without asking for its notice",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `        fireMacroNow(macroIndex, { lastEvent: "inter_app", transport });`,
      to: `        fireMacroNow(macroIndex); // mutated: the inter-app path never asks for the per-macro notice`,
    }],
    expect: /a MIDI trigger from another application firing a macro whose notice is ON must show the courtesy card/,
  },
  {
    // The identity work, undone: the load stops converting a positional reference into the library's key, so what gets
    // saved is still a place in a list — the shape a reorder silently re-points.
    // **Narrowed to the conversion own observable** (2026-10-07). The defect was originally "the key is never
    // written", and that is not narrow: removing the conversion breaks macro resolution EVERYWHERE, so the first
    // contract to notice is the courtesy card in section 1 — reported, correctly, as UNEXPECTED, because the suite
    // then fails for a reason that is not the property under test. The conversion has two observables and each has
    // its own mutation: what it DOES is resolving by key (the next mutation), what it SAYS is this line. Neither
    // half of the conversion can be dropped without failing the contract written for it.
    name: "the load converts a positional reference into the macro key without saying so",
    file: HTML,
    kind: "browser",
    edits: [{
      // The two lines this used to target are no longer adjacent — a comment was written between them, which is
      // what the check reported as stale — so the target is the report itself, which is one line and cannot be
      // pushed apart by a comment beside it.
      from: `            \`macro keys: \${converted} reference(s) converted from a library position; \` +`,
      to: `            \`macro keys changed; \` + // mutated: the conversion is not reported`,
    }],
    expect: /must convert each position into the library/,
  },
  {
    // And the key ignored at the one place it decides what runs: the reference resolves by its old position, so a
    // reordered library fires whoever took that place — the defect the key exists to remove.
    name: "a keyed reference resolved by its old position instead of its key",
    // The rule moved into the shared module (it is the SAME rule both windows resolve by, which is the point of the
    // module), so the mutation moved with it: against `HTML` it had been silently stale.
    file: CUE_LIST_JS,
    kind: "browser",
    edits: [{
      from: `    const key = typeof reference?.macro_id === "string" ? reference.macro_id.trim() : "";
    if (key) return list.find((macro) => String(macro?.id ?? "").trim() === key) || null;`,
      // Narrowed on purpose: the first version ignored the key outright, which broke the inter-app path too and made an
      // **earlier** assertion fail — reported, correctly, as UNEXPECTED rather than caught. This one changes what
      // happens only when a reference carries **both**, which is the property the contract is about: the key wins.
      to: `    const stale = typeof reference?.macro_index === "number" ? reference.macro_index : null;
    if (stale !== null) return list[stale] || null; // mutated: the old position wins over the key
    const key = typeof reference?.macro_id === "string" ? reference.macro_id.trim() : "";
    if (key) return list.find((macro) => String(macro?.id ?? "").trim() === key) || null;`,
    }],
    expect: /must fire the macro the key names/,
  },
  {
    // The library reported as a count again, which can judge an old positional reference and nothing else: a cue
    // naming a key is then never judged at all, so a deleted macro reads as healthy.
    name: "a library reported as a count, with its keys left out",
    file: HTML,
    kind: "browser",
    edits: [{
      // The call gained a comment of its own after the keys, so the closing line moved: the target stops at the line
      // that carries the property, and the rest of the call is left intact so the mutation stays valid JavaScript.
      from: `          macroIds: macros.map((macro) => String(macro?.id ?? "").trim()),`,
      to: `          macroIds: [], // mutated: the keys are left out`,
    }],
    expect: /must report its library's keys/,
  },
  {
    // The two backend payloads are byte-identical in shape, so the transport is named at the registration. Both
    // paths labelled MIDI is the card claiming something it cannot know: it would say MIDI for an OSC order.
    name: "the two transports blurred into one on the courtesy card",
    file: HTML,
    kind: "browser",
    edits: [{
      from: `          listen("inter-app-osc-trigger", (event) => handleInterAppTrigger(event, "OSC"));`,
      to: `          listen("inter-app-osc-trigger", (event) => handleInterAppTrigger(event, "MIDI")); // mutated: an OSC order announced as MIDI`,
    }],
    expect: /the card must name OSC when OSC carried it/,
  },
  {
    // The comfort the owner asked for, removed: the only add is the one at the top of the panel again.
    //
    // **Retargeted from the settings page to the LTC window** (2026-10-07), with the control. The settings page stopped
    // being an editor, so its markup is not there to mutate any more and this mutation would have been reported stale
    // — a mutation that cannot be put back is a property with no teeth. The LTC window's `#add-end` is the control
    // that carries the comfort now, and its contract is in `test-desktop-ltc-window-browser.mjs` section 22.
    name: "Add cue at the end removed from the window that edits the list",
    file: LTC,
    suite: LTC_SUITE,
    kind: "browser",
    edits: [{
      from: `    <button id="add-end" class="edit-only" type="button"\n      title="Adds a cue after the last one in the list — one frame past it — ready for its macro. It is a save, so it re-arms the list.">Add at the end</button>`,
      to: `    <!-- mutated: the only add is the one at a position again -->`,
    }],
    // **Caught by an EARLIER contract than the one written for it**, and that is reported rather than hidden: the
    // control is referenced by the Live contract too (section 4 reads its display to prove that Live puts the editing
    // tools away), so removing it fails there first — with `got "missing"`, which names what happened. Both messages
    // are true of the defect; naming the one that actually fires is the difference between a verdict that can be
    // trusted and one that has been talked into place.
    expect: /Live hides the add control/,
  },
  {
    // The control is on the page and reaches the backend, and then **throws the answer away**: the list on screen does
    // not change, so the button appears to work and does nothing an operator can see. This is the shape that replaced
    // "wired to nothing" when the control moved: unwiring it can only produce a timeout, and a timeout is not an
    // assertion — the classifier would call it UNEXPECTED, which is true and useless.
    name: "Add cue at the end that reaches its command and drops the answer",
    file: LTC,
    suite: LTC_SUITE,
    kind: "browser",
    edits: [{
      from: `        adopt(await invoke("add_timecode_cue_at_end"));`,
      to: `        await invoke("add_timecode_cue_at_end"); // mutated: the answer is dropped`,
    }],
    expect: /must be drawn, or the control only appears to work/,
  },
  {
    // The Rust half: "at the end" that lands **on** the last cue's frame instead of after it. The new cue would be
    // drawn in the last row's frame, marked as a clash, and would fire with it — the opposite of the comfort asked
    // for, and exactly what a "+ 1" that looks harmless protects.
    name: "the appended cue landing on the last cue's own frame (a clash, not the end)",
    file: MAIN,
    kind: "cargo",
    edits: [{
      from: `            timecode::TimecodePosition::from_frames(last.to_frames() + 1, last.rate, last.drop_frame)`,
      to: `            timecode::TimecodePosition::from_frames(last.to_frames(), last.rate, last.drop_frame) // mutated: no step past the last cue`,
    }],
    expect: /a_cue_added_at_the_end_lands_one_frame_past_the_lasts_position/,
  },
  {
    // **The reliability gap, put back.** The clock is never read at the door, so every skip arrives with "no previous
    // arrival was measured" and a one-second dropout becomes indistinguishable from a deliberate seek again — which is
    // exactly the state this programme found the engine in. The mutation is the realistic one: the gap computation
    // looks like an unused local, and deleting it is precisely how this would be lost.
    name: "the door stops measuring the silence, so a dropout looks like a seek again",
    file: TC,
    kind: "cargo",
    // The filter runs ALL THREE tests of this rule, and that is the point rather than laziness: the mutation is in the
    // DOOR, and the test that catches it is the one that drives the door. Filtering to the cue-list test alone made the
    // harness report MISSED — the same false verdict a wrong \`suite\` produces, and for the same reason: nothing looked.
    cargoFilter: "silence",
    edits: [{
      from: `        let arrival_gap_ms = self
            .last_update
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|previous| now.saturating_duration_since(*previous)))
            .map(|gap| gap.as_millis().min(u64::MAX as u128) as u64);`,
      to: `        let arrival_gap_ms = None; // mutated: the clock is never read`,
    }],
    expect: /a_jump_across_silence_is_told_apart_from_a_seek/,
  },
  {
    // **The as-run record, never written.** The whole of gap 2 is "what ran is still there after a restart", and the
    // way that is lost is not a subtle one: a hook that stops being called, or a flush that returns before it writes.
    // The mutation is the blunt version of both, and the contract it must fail is the one that spans the engine, the
    // flush and the disk — which is why that contract exists at all: without it, a flush that was never called would
    // pass every test of its own pieces.
    name: "the as-run record is never written, so nothing survives a restart",
    file: MAIN,
    kind: "cargo",
    cargoFilter: "what_ran_survives_a_restart_through_the_file",
    edits: [{
      from: `    let Some(lines) = timecode.take_due_as_run(std::time::Instant::now()) else {
        return;
    };
    if let Err(error) = persist_timecode_as_run(path, &lines) {
        eprintln!("timecode as-run record not written: {error}");
    }`,
      to: `    // mutated: nothing is ever written
    let _ = (timecode, path);`,
    }],
    expect: /what_ran_survives_a_restart_through_the_file/,
  },
  {
    // **D9, put back.** The as-run flush returns to CoreMIDI's callback, which is where the first build had it: a disk
    // write on a driver thread, in a file that says three lines above it that nothing from a show belongs there. The
    // contract is structural, so this mutation is measured by the SUITE THAT READS THE SOURCE — and it is the only
    // shape of guard that can see this, because the failure it prevents is a timing violation nobody can observe
    // from outside.
    name: "the as-run record is flushed from the driver callback again",
    file: MIDI,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{
      from: `                    timecode.feed_system_message(bytes, std::time::Instant::now());`,
      to: `                    timecode.feed_system_message(bytes, std::time::Instant::now());\n                    crate::flush_timecode_as_run_for(&timecode); // mutated: back on the driver callback`,
    }],
    expect: /must NOT be flushed from CoreMIDI's callback/,
  },
  {
    // **D10, and it is the mutation that proves the guard is a LIST.** This restores the flush on the **cpal stream
    // callbacks** — the file the first version of the guard never looked at, because it named the file that had the
    // bug rather than the kind of place that produces it. It is here so that a future edit that narrows the guard
    // back to one file fails a mutation rather than passing quietly.
    name: "the as-run record is flushed from the AUDIO stream callback",
    file: LTC_DEVICE,
    kind: "browser",
    suite: UI_CONTRACTS,
    edits: [{
      from: `    for position in positions.iter() {\n        state.push_position(*position, std::time::Instant::now());\n    }`,
      to: `    for position in positions.iter() {\n        state.push_position(*position, std::time::Instant::now());\n    }\n    crate::flush_timecode_as_run_for(state); // mutated: on the audio callback`,
    }],
    expect: /must NOT be flushed from the cpal stream callbacks/,
  },
  {
    // **The defect INTER_APP_HANDOFF:374 recorded as a MISSED mutation, put back.** The copy keeps a number
    // instead of clearing it, so two cues in one frame are numbered the same - which is what the operator reads
    // out loud. The handoff says the old contract could not catch it because it identified the copy by a GUESSED id
    // (`cue-5`) while the copy gets whatever `nextCueId` returns; this suite reads the copy BY DIFFERENCE, which is
    // the fix the handoff itself prescribed, so the same defect is now catchable and this proves it.
    name: "a duplicated cue keeps the source's number",
    file: CUE_LIST_JS,
    kind: "browser",
    suite: LTC_WINDOW,
    edits: [{
      from: `      copy.number = "";`,
      to: `      copy.number = "99"; // mutated: the copy is numbered like something else`,
    }],
    expect: /the copy must CLEAR its number/,
  },];

/** The guard's decision for one file, as data, so it can be proved without the tree: "restore", "ours" or "foreign". */
export function planRestore(current, original, lastWritten) {
  if (current === original) return "ours"; // already what we found: nothing to do, and not foreign
  if (current === lastWritten) return "restore"; // our own mutation: put the bytes back
  return "foreign"; // somebody else wrote this: leave it alone and say so
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["a contract that fails and names the defect", /must show the courtesy card/, { code: 1, output: "AssertionError [ERR_ASSERTION]: a cue firing a macro whose notice is ON must show the courtesy card" }, "caught"],
    ["a contract that PASSES while printing the phrase", /must show the courtesy card/, { code: 0, output: "must show the courtesy card\nWING_BROWSER_SUITE_OK" }, "missed"],
    ["a contract that failed for another reason", /must show the courtesy card/, { code: 1, output: "AssertionError [ERR_ASSERTION]: something else entirely" }, "unexpected"],
    ["a browser suite that could not run", /anything/, { code: 3, output: "SKIP: no Chrome remote debugging on port 9223" }, "could-not-run"],
    ["a Rust mutation that does not compile", /a_cue_added_at_the_end/, { code: 101, output: "error[E0425]: cannot find value", cargo: true }, "unexpected"],
    ["a Rust test that fails and names it", /a_cue_added_at_the_end/, { code: 101, output: "test a_cue_added_at_the_end_lands_one_frame_past_the_lasts_position ... FAILED", cargo: true }, "caught"],
    ["a run out of time", /anything/, { code: 124, output: "", timedOut: true }, "no-verdict"],
  ];
  let failed = 0;
  for (const [name, expect, result, want] of cases) {
    const got = classify(expect, result).verdict;
    if (got !== want) failed += 1;
    console.log(`${got === want ? "ok  " : "FAIL"} classifier — ${name}: expected ${want}, got ${got}`);
  }

  // The restore guard, exercised for real on files outside the tree: a file this check wrote is put back, a file a
  // foreign writer changed is left exactly as it is.
  const dir = mkdtempSync(join(tmpdir(), "wing-cue-comfort-guard-self-test-"));
  const file = join(dir, "sample.html");
  try {
    const original = "<button id=\"one\"></button>\n";
    const mutated = "<button id=\"two\"></button>\n";
    const foreignBytes = "<button id=\"one\"></button>\n<!-- written by somebody else -->\n";
    const guardCases = [
      ["our own unmutated bytes are not foreign", original, original, undefined, "ours"],
      ["our own mutation is restored", mutated, original, mutated, "restore"],
      ["a foreign write is left alone", foreignBytes, original, mutated, "foreign"],
    ];
    for (const [name, current, base, lastWritten, want] of guardCases) {
      writeFileSync(file, current);
      const got = planRestore(readFileSync(file, "utf8"), base, lastWritten);
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

async function browserAnswers() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureBrowser() {
  if (await browserAnswers()) {
    console.log(`using the browser already on port ${DEBUG_PORT}`);
    return null;
  }
  const profile = mkdtempSync(join(tmpdir(), "wing-cue-comfort-mutation-chrome-"));
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

function runContract(mutation) {
  const command = mutation.kind === "cargo" ? "cargo" : "node";
  // A mutation whose defect lives in another window is measured by THAT window suite: running the settings suite at a
  // defect put into `ltc.html` reports MISSED, which reads as "the contract is blind" when in truth nothing looked.
  // Per-mutation, for the same reason the browser suite is: a Rust mutation measured by the WRONG test reports MISSED,
  // which reads as "the contract is blind" when in truth nothing looked.
  const args = mutation.kind === "cargo" ? ["test", "-p", "wing-controller-desktop", "--bin", "wing-controller-desktop",
    mutation.cargoFilter || "a_cue_added_at_the_end"] : [mutation.suite || SUITE];
  try {
    const output = execFileSync(command, args, {
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
    if (error.code === "ENOENT") {
      return { code: null, output };
    }
    return { code: typeof error.status === "number" ? error.status : 1, output };
  }
}

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

const browser = await ensureBrowser().catch((error) => {
  console.error(String(error.message));
  rmSync(LOCK, { force: true });
  process.exit(2);
});


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

// `LTC` is here because two of the mutations moved to the window that edits the list, and a file the check does not
// take a byte copy of is one it cannot restore — the failure was a `TypeError` on an undefined original, which is at
// least loud, but it would have been a mutation measured against a tree it never put back.
// **A mutation can have to invert a STUB as well as a source file**, and LTC_SUITE is here for exactly that: the
// as-run fixture in test-desktop-ltc-window-browser.mjs is a second declaration of the Rust DTO, and the mutation that
// proves the DTO guard compares them has to edit the fixture rather than any production file. Without this entry the
// harness reads \`originals.get(LTC_SUITE)\` as undefined and dies at the edit check - which is what happened, on the
// first run of that mutation, in 2026-10-08. The check below the map is what stops it happening again.
const originals = new Map([HTML, LTC, CUE_LIST_JS, MAIN, TC, MIDI, LTC_DEVICE, LTC_SUITE, GUIDE].map((file) => [file, readFileSync(file, "utf8")]));
const backupDir = mkdtempSync(join(tmpdir(), "wing-cue-comfort-mutation-"));
for (const file of originals.keys()) copyFileSync(file, join(backupDir, basename(file)));
const written = new Map();
const foreign = new Set();

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

function stopBrowser() {
  if (browser) {
    browser.child.kill("SIGKILL");
    rmSync(browser.profile, { recursive: true, force: true });
  }
}

console.log(`files this check writes and restores from its own byte copies: ${[...originals.keys()].map((file) => basename(file)).join(", ")}`);
console.log(`pre-run copies, kept if anything is left alone: ${backupDir}`);

// A mutation table is only as good as the tree it runs against: if a contract does not pass unmutated, every verdict
// below would be describing the tree instead of a defect, so say that and measure nothing.
for (const kind of ["browser", "cargo"]) {
  const result = runContract(mutations.find((mutation) => mutation.kind === kind));
  if (result.code !== 0) {
    console.error(`the ${kind} contract does not pass on the tree as it stands (exit ${result.code}): nothing was measured`);
    console.error((result.output.match(/AssertionError[^\n]*|assertion[^\n]*failed[^\n]*/) || [""])[0]);
    restoreAll();
    stopBrowser();
    rmSync(LOCK, { force: true });
    process.exit(1);
  }
}
console.log("both contracts pass on the tree as it stands: the mutations below are measured against a green baseline");

const results = [
];
try {
  for (const mutation of mutations) {
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
    if (original === undefined) {
      console.error(
        `mutation "${mutation.name}" names a file the harness does not read and restore (${basename(mutation.file)}).\n` +
        "A mutation that edits a file this check cannot restore would leave it mutated, so the run stops here.\n" +
        "Add the constant to the \`originals\` map if the mutation is meant to touch it.",
      );
      process.exit(3);
    }
    const missing = mutation.edits.find((edit) => !original.includes(edit.from));
    if (missing) {
      results.push({ name: mutation.name, verdict: "unexpected", why: `the mutation target was not found — this check is stale: ${missing.from.slice(0, 80)}` });
      continue;
    }
    if (readFileSync(mutation.file, "utf8") !== original) {
      foreign.add(mutation.file);
      results.push({
        name: mutation.name,
        verdict: "could-not-run",
        why: `${basename(mutation.file)} changed while this check was running; its bytes were left alone`,
      });
      continue;
    }
    const mutated = mutation.edits.reduce((text, edit) => text.replace(edit.from, edit.to), original);
    writeFileSync(mutation.file, mutated);
    written.set(mutation.file, mutated);
    results.push({ name: mutation.name, ...classify(mutation.expect, runContract(mutation), { cargo: mutation.kind === "cargo" }) });
  }
} finally {
  restoreAll();
  stopBrowser();
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

const allCaught = results.every((result) => result.verdict === "caught");
console.log(allCaught
  ? "every cue comfort defect put back is caught by a contract that fails and names it"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
