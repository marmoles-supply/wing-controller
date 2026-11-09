// The teeth of the LTC window's contracts, proved by putting each defect back.
//
// `scripts/test-desktop-ltc-window-browser.mjs` is the contract; this puts each way it could be wrong back into
// `desktop/ui/ltc.html` and demands a failure that names it. The most important of them is a contract about
// **absence**: the window must never call `fire_macro` nor `confirm_timecode_cues`, because the main window owns firing
// and confirmation and a second window doing either would run every cue twice. An absence is exactly the kind of
// contract that rots unnoticed, which is why it is mutated and measured rather than trusted.
//
//   caught         the contract failed **and named this defect** — what we want
//   MISSED         the contract **passed** with the defect in place — the contract is toothless
//   UNEXPECTED     it failed for another reason, printed with the assertion that actually fired
//   COULD-NOT-RUN  nothing was measured (no browser)
//   NO-VERDICT     the run did not finish inside its bound (a wedged browser looks exactly like this)
//
// Run: node scripts/mutation-check-ltc-window.mjs
//      node scripts/mutation-check-ltc-window.mjs --self-test   (the classifier and the restore guard; no tree edit)
//
// It is deliberately **not** named `test-*.mjs`: the gate runs every file with that prefix, and a check that mutates the
// working tree must never run inside a gate. It starts its own headless Chrome when the debug port is silent and kills
// only the browser it started, so a verdict here does not depend on who prepared what.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOW = join(REPO, "desktop/ui/ltc.html");
/// The shared module the window draws with. It is carried here because the contracts this check protects are half the
/// window's wiring and half the rules it reads — a rule that lives in `cue-list.js` is exactly as much this window's
/// behaviour as the DOM it paints, and it was invisible to this check until a mutation in it was needed.
const CUE_LIST = join(REPO, "desktop/ui/cue-list.js");
/// The click rule every field of the window obeys. It is carried here for the same reason `cue-list.js` is: the rule
/// and the list are the two halves of "I clicked a cue's field and typed into it", and a mutation in either one is a
/// mutation of this window's behaviour.
const FIELD_EDITING = join(REPO, "desktop/ui/field-editing.js");
const SUITE = join(REPO, "scripts/test-desktop-ltc-window-browser.mjs");
const LOCK = join(tmpdir(), "wing-mutation-check-ltc-window.lock");
const DEBUG_PORT = Number(process.env.WING_CHROME_PORT || 9223);
const CHROME_BIN = process.env.WING_CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NO_BROWSER = /SKIP: no Chrome remote debugging/;
const TIMEOUT_MS = Number(process.env.WING_MUTATION_TIMEOUT_MS || 300_000);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a run's result means for one mutation. Pure, so `--self-test` can check it without a browser or a tree. */
export function classify(expect, { code, output, timedOut }) {
  if (timedOut) {
    return { verdict: "no-verdict", why: `the suite did not finish in ${Math.round(TIMEOUT_MS / 1000)} s` };
  }
  if (code === null) {
    return { verdict: "could-not-run", why: "the suite could not be started: nothing was measured" };
  }
  if (code === 3 || NO_BROWSER.test(output)) {
    return { verdict: "could-not-run", why: `the suite never ran (exit ${code})` };
  }
  if (code === 0 && !/WING_BROWSER_SUITE_OK/.test(output)) {
    return { verdict: "unexpected", why: "the suite exited 0 without its seal: it did not run the contracts it claims to" };
  }
  if (code !== 0 && expect.test(output)) {
    return { verdict: "caught" };
  }
  if (code === 0) {
    return { verdict: "missed", why: "the contract PASSED with the defect in place" };
  }
  const firstFailure = (output.match(/AssertionError[^\n]*/) || [""])[0].slice(0, 200);
  return {
    verdict: "unexpected",
    why: `the contract failed, but not with ${expect}${firstFailure ? ` — it said: ${firstFailure}` : ""}`,
  };
}

/** The guard's decision for one file, as data, so it can be proved without the tree. */
export function planRestore(current, original, lastWritten) {
  if (current === original) return "ours";
  if (current === lastWritten) return "restore";
  return "foreign";
}

// Each mutation is the inverse of one line in the window, and each is expected to be caught by a named assertion.
const mutations = [
  {
    // The one that matters: the window firing the macro as well, which with the main window open would run every cue
    // twice — and the second run would be invisible, because both windows would confirm the same order.
    name: "the LTC window that fires the macro itself",
    from: `          if (id && (kind === "fired" || kind === "skipped")) {`,
    to: `          if (kind === "fired") { invoke("fire_macro", {}); } // mutated: this window fires as well
          if (id && (kind === "fired" || kind === "skipped")) {`,
    expect: /THE DIVISION/,
  },
  {
    // Live that changes the button and not the window: the editing tools stay on screen, which is the whole thing Live
    // exists to take away while a show runs.
    name: "Live that hides nothing",
    from: `      document.body.classList.toggle("is-live", live);`,
    to: `      // mutated: Live changes the button and leaves the editing tools on screen`,
    expect: /Live hides the add control/,
  },
  {
    // The payload without the order or the offset: the backend's field has a default, so this would not fail — it would
    // quietly rewrite the operator's order to `smpte` and lose the offset, which is why the rule lives in one place.
    name: "a save that sends the list without its order",
    from: `      const saved = await invoke("set_timecode_cues", { cues: CUE.cueListPayload(cues, offsetFrames, sortMode, drive) });`,
    to: `      const saved = await invoke("set_timecode_cues", { cues: { schema_version: 1, cues } }); // mutated: no order, no offset, no drive`,
    expect: /the payload carries the order/,
  },
  {
    // The repetition control writing the older boolean instead of the policy: two operators choosing "once in the show"
    // and "once per pass" would get the same file, and the cue that must not repeat would repeat.
    name: "a repetition control that writes the old flag instead of the policy",
    from: `        cue.repeat = policy.value;
        cue.repeats = false;`,
    to: `        cue.repeats = policy.value === "every"; // mutated: the old flag is written, the policy is not`,
    expect: /choosing a policy writes the policy/,
  },
  {
    // The drive selector whose choice never reaches the payload: the header would say "one by one" while the file and
    // the engine still ran by timecode, which is exactly the "control that appears to apply" this project keeps
    // removing. Nothing would look broken.
    name: "a drive selector whose choice never leaves the window",
    from: `      drive = event.target.value;
      panel.render();`,
    to: `      // mutated: the mode is shown and never reaches the payload
      panel.render();`,
    expect: /choosing a drive writes it/,
  },
  {
    // The row storing the seconds that were typed instead of the milliseconds the file holds: a two-and-a-half second
    // duration would become two milliseconds, and the sequence would run as fast as the clock allows.
    name: "a duration stored in seconds where the file holds milliseconds",
    from: `        cue.duration_ms = ms;`,
    to: `        cue.duration_ms = Number(duration.value); // mutated: seconds stored where milliseconds belong`,
    expect: /stored in milliseconds/,
  },
  {
    // A Monitor switch that asks for the armed list: the box would tick and the engine would go on firing, which is the
    // worst possible version of this control — an operator who believes the show is being watched.
    name: "a Monitor switch that asks for the armed list",
    from: `        const on = Boolean(await invoke("set_timecode_rehearsal", { rehearsing: rehearsalBox.checked }));`,
    to: `        const on = Boolean(await invoke("set_timecode_rehearsal", { rehearsing: false })); // mutated: asks for armed`,
    expect: /the switch must ask the engine for Monitor/,
  },
  {
    // A plan that paints the cue but not the lateness: the column this whole mode exists for, dropped while the report
    // still looks complete.
    name: "a rehearsal report that does not show how late a crossing was",
    from: `        const late = line.delta_frames === null || line.delta_frames === undefined
          ? ""
          : \`\${Number(line.delta_frames) >= 0 ? "+" : ""}\${line.delta_frames} f\`;`,
    to: `        const late = ""; // mutated: the lateness column is always empty`,
    expect: /how late that was, in frames/,
  },
  {
    // A cue the health does not describe reported as **fine** instead of unknown: this is the defect that made a row say
    // "the time exists at this rate" and "macro chosen and present" before any snapshot had described the cue, which is
    // the one state the three-valued chain exists to keep apart from "all is well".
    //
    // **The target was stale (found and repaired 2026-10-09).** `cue-list.js` grew a second reason to answer *unknown* —
    // a health whose `problem` this window cannot word — so the line became
    // `health === null || unrecognised ? null : isBroken(health)`. This mutation still named the old text, so the check
    // reported UNEXPECTED ("the mutation target was not found") and the defect it guards went unmeasured for as long as
    // that has been true. The mutation keeps its meaning — the `to` also drops the `unrecognised` arm, which is the same
    // class of defect. Measured after the repair, 2026-10-09: **24 caught of 24**, this one included.
    name: "a cue nobody has described, reported as fine",
    file: CUE_LIST,
    from: `      const broken = health === null || unrecognised ? null : isBroken(health);`,
    to: `      const broken = health === null ? false : isBroken(health); // mutated: an unknown cue reads as fine`,
    expect: /A CUE NOBODY HAS DESCRIBED IS UNKNOWN, not fine/,
  },
  {
    // **The three mutations of the click rule on a cue's own field** (section 28). Each is one half of the defect the
    // owner reported as "the clicks still do not work everywhere, for example the cues window": a click on a cue's
    // field selects that row, selecting repaints the list, and the repaint took the element under the caret with it.
    // They live together because each one alone leaves the gesture broken in a way the other two cannot see.
    name: "a repaint that takes the field the operator is in",
    file: CUE_LIST,
    from: `      restoreFocusedField(list, keptField);`,
    to: `      // mutated: the field under the caret is left to the repaint`,
    expect: /a click on a cue's field must leave that field focused/,
  },
  {
    name: "an unchanged selection that repaints the list anyway",
    file: CUE_LIST,
    from: `      if (selectionKey() === painted) return;`,
    to: `      // mutated: repaint whether or not the selection changed`,
    expect: /a click inside the row that is already selected must not rebuild the list/,
  },
  {
    // The press counter keyed by the ELEMENT: a rebuilt row gets a new element, so the second click on a cue's field
    // looked like the first and selected everything again instead of leaving the caret at the end.
    name: "a press counted against the element instead of its address",
    file: FIELD_EDITING,
    from: `    const key = fieldKey(field);`,
    to: `    if (!field.__wingKey) field.__wingKey = String(Math.random()); // mutated: the element is the key
    const key = field.__wingKey;`,
    expect: /and the caret at the end of the value, not a fresh selection of it/,
  },
  {
    // The reason attached to a link **nobody judged**: the failure sentence on an unknown link reads exactly like a
    // diagnosis, which is what "no position is arriving" did on a clock nobody had reported.
    name: "a reason attached to a link nobody judged",
    file: CUE_LIST,
    from: `      chain.push({ link, label, ok, detail: ok === false ? broken : (ok === null ? unknown : "") });`,
    to: `      chain.push({ link, label, ok, detail: ok === false || ok === null ? broken : "" }); // mutated: a diagnosis on an unknown link`,
    // Either of the two assertions may fire first — both are about this one defect, and the earlier one is the sentence
    // that checks the reason *is* the honest one. Both name it, which is what the verdict asks for.
    expect: /NO DIAGNOSIS ON AN UNKNOWN LINK|an unknown link says so/,
  },
  {
    // A shift that moves **every cue** instead of the selection: every other assertion about the shift would still
    // pass, which is why the unselected cue is the one with teeth.
    name: "a shift that moves every cue instead of the selected ones",
    from: `      const fps = shiftFps();
      const moved = chosen.map((id) => cues.find((cue) => cue.id === id)).filter(Boolean);
      const below = moved.find((cue) => CUE.toFrames(cue.at, fps) + delta < 0);`,
    to: `      const fps = shiftFps();
      const moved = [...cues]; // mutated: the whole list moves, not the selection
      const below = moved.find((cue) => CUE.toFrames(cue.at, fps) + delta < 0);`,
    expect: /AND THE CUE THAT WAS NOT SELECTED DID NOT MOVE/,
  },
  {
    // A shift applied without opening an undo step: the operator's way back would take back the *previous* change, or
    // nothing at all, and the range would be stuck where it landed.
    name: "a bulk shift that opens no undo step",
    from: `      panel.pushUndo();
      for (const cue of moved) cue.at = shiftedAt(cue, delta, fps);`,
    to: `      // mutated: no undo step is opened for the range
      for (const cue of moved) cue.at = shiftedAt(cue, delta, fps);`,
    // Either assertion may fire first — with no undo step opened the stack stays empty, so "there is something to take
    // back" fails before the times are even compared. Both name this defect.
    expect: /ONE UNDO STEP TAKES THE WHOLE RANGE BACK|and there is something to take back/,
  },
  {
    // A shift past midnight that wraps instead of refusing: the cue would land at the end of the show rather than a few
    // frames earlier, which is the kind of quiet move nobody finds until the cue fires at the wrong time.
    name: "a shift past midnight that wraps instead of refusing",
    from: `      if (below) {
        setStatus(
          \`Nothing moved: \${CUE.cueName(below).text} would land before 00:00:00:00. Shift the selection later, or by fewer frames.\`,
          true,
        );
        return;
      }`,
    to: `      // mutated: a shift past midnight wraps instead of being refused`,
    expect: /REFUSED, NOT WRAPPED/,
  },
  {
    // The hidden count always zero, so the preview claims the whole selection is on screen while the search is hiding
    // part of it — and the shift moves the hidden ones too.
    name: "a preview that claims nothing is hidden",
    file: CUE_LIST,
    from: `      visibleIds: () => orderedCues(visibleCues(), config.mode(), cues()).map((entry) => String(entry.cue.id)),`,
    to: `      visibleIds: () => cues().map((cue) => String(cue.id)), // mutated: everything counts as visible`,
    expect: /3 hidden by the search/,
  },
  {
    // A save that empties the undo stack and leaves the button on screen: a control that does nothing when pressed, which
    // is the one thing this project does not put in front of an operator. Found while making the shift's undo step
    // measurable — the contract could not tell "the range was taken back" from "an older change was".
    name: "a save that leaves the Undo button on screen",
    file: CUE_LIST,
    from: `      // The button's visibility **is** a function of the stack, so clearing the stack repaints it here. A Save clears
      // the stack (the draft and the list are the same thing again), and an Undo left on screen after it is a control
      // that does nothing when pressed — which is the one thing this project does not put on screen.
      for (const hook of undoHooks) hook();
    }`,
    to: `      // mutated: the Undo button is left on screen after a save has cleared the stack
    }`,
    expect: /a save leaves nothing to take back/,
  },
  {
    // A shortcut that steals Enter from the field it is typed in: setting a time would add a cue instead, and the
    // operator would watch a new row appear every time he confirmed a position.
    name: "a shortcut that steals Enter from the field being typed in",
    from: `      if (event.key !== "Escape" && event.key !== "Enter") return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, select, textarea, button")) return;`,
    to: `      if (event.key !== "Escape" && event.key !== "Enter") return;
      const target = event.target; // mutated: no guard against a field`,
    expect: /ENTER INSIDE A FIELD BELONGS TO THE FIELD/,
  },
  {
    // The note shown for every cue: a warning that is always on is a warning nobody reads, and it would read as a fault
    // in cues that are perfectly fine.
    name: "a change note shown for every cue",
    from: `      if (health?.macro_changed === true) {`,
    to: `      if (true) { // mutated: the note is always shown`,
    // The contract that fires is the **wait** for the note to clear, not the assertion after it: with the note always
    // shown, the note never clears, and the suite says so by name rather than by sleeping on it. That is the honest
    // verdict for this defect — the comparison that would make the note conditional is gone, so nothing can clear it.
    expect: /the note to clear/,
  },
  {
    // Binding a macro without recording its content: nothing can ever be compared afterwards, so the whole note is dead
    // — and nothing on screen would look wrong.
    name: "a bound macro whose content is not recorded",
    from: `        cue.macro_hash = reference.macro_id ? CUE.macroHash(CUE.macroForReference(macroLibrary, reference)) : null;`,
    to: `        // mutated: the macro's content is not recorded with the reference`,
    expect: /AND IT RECORDS THE MACRO'S CONTENT/,
  },
  {
    // The count made over the **whole list** instead of the cues that name the same macro: every row would claim every
    // other row shares its macro, which is worse than saying nothing at all.
    name: "a usage count made over the whole list",
    file: CUE_LIST,
    from: `    return list.filter((other) => {
      const otherKey = String(other?.macro_id ?? "").trim();
      if (key) return otherKey === key;
      return !otherKey && other?.macro_index === index;
    });`,
    to: `    return list.filter(() => true); // mutated: every cue counts as a user`,
    // The assertion that fires is the **count** one, which is the contract with teeth for this defect: a wrong count is
    // what the operator would act on, so the suite fails on the number before it ever reaches the "only this one" case.
    expect: /A SHARED MACRO SAYS HOW MANY CUES NAME IT/,
  },
  {
    // The marker shown for a macro only one cue names: a badge on every row, which is exactly the noise the precedents
    // mark the *shared* object to avoid.
    name: "a shared marker shown on a macro nobody shares",
    from: `      if (shared.length > 1) {`,
    to: `      if (shared.length >= 1) { // mutated: every macro is marked as shared`,
    // What fires is the badge list, because the mutation puts a marker on a row that must not have one — the extra entry
    // is the defect, and the list assertion names it.
    expect: /and the rows that name it carry the marker/,
  },
  {
    // A section field that writes nothing: the operator types a section and the cue keeps none, which is the state the
    // field was in before this phase — a control that appears to apply and does not.
    name: "a section field that writes nothing",
    from: `        cue.group = section.value.trim();`,
    to: `        // mutated: the section the operator typed is dropped`,
    // What fails is the **wait** for the list's names: a section that never reaches the cue never becomes a name other
    // rows are offered, and that wait is the operator-visible symptom rather than a detail further down the section.
    expect: /the list's names to be offered/,
  },
  {
    // The section written into the cue's **name** instead of its group: the row would say "Act 1" in the label field and
    // the file would carry no section at all — a value that looks saved and is not.
    name: "a section written into the wrong field",
    from: `        cue.group = section.value.trim();`,
    to: `        cue.label = section.value.trim(); // mutated: the section lands in the cue's name`,
    // Same wait, and for the same reason: a section written into the name never reaches the group, so it never becomes a
    // name the list offers. The save assertion behind it would also catch this, and it cannot be reached — which the
    // verdict states rather than hides.
    expect: /the list's names to be offered/,
  },
  {
    // The readout that says "next LTC" whatever the drive is: the defect the spec's split was reaching for, and a lie on
    // a list that waits for a person.
    name: "a next-cue readout that always says LTC",
    from: `        nextLabel.textContent = sequential ? "next on Go" : "next LTC";`,
    to: `        nextLabel.textContent = "next LTC"; // mutated: the drive the readout waits for is not named`,
    expect: /THE READOUT NAMES WHAT IT IS WAITING FOR/,
  },
  {
    // A countdown on the manual drive: seconds ticking towards a cue that fires when a person presses Go.
    name: "a countdown on a cue that waits for the operator",
    from: `        ? \`\${next.next_cue}\${!sequential && Number.isFinite(seconds) ? \` in \${seconds.toFixed(1)} s\` : ""}\``,
    to: `        ? \`\${next.next_cue}\${Number.isFinite(seconds) ? \` in \${seconds.toFixed(1)} s\` : ""}\` // mutated: a countdown on a manual cue`,
    expect: /WITH NO COUNTDOWN/,
  },
];

if (process.argv.includes("--self-test")) {
  const cases = [
    ["a contract that fails and names the defect", /THE DIVISION/, { code: 1, output: "AssertionError: THE DIVISION: this window must never fire" }, "caught"],
    ["a contract that PASSES with the defect in place", /THE DIVISION/, { code: 0, output: "THE DIVISION\nWING_BROWSER_SUITE_OK" }, "missed"],
    ["a contract that failed for another reason", /THE DIVISION/, { code: 1, output: "AssertionError: something else entirely" }, "unexpected"],
    ["a suite that could not run", /THE DIVISION/, { code: 3, output: "SKIP: no Chrome remote debugging on port 9223" }, "could-not-run"],
    ["a suite that exited 0 without its seal", /THE DIVISION/, { code: 0, output: "nothing ran here" }, "unexpected"],
    ["a run out of time", /THE DIVISION/, { code: 124, output: "", timedOut: true }, "no-verdict"],
  ];
  let failed = 0;
  for (const [name, expect, result, want] of cases) {
    const got = classify(expect, result).verdict;
    if (got !== want) failed += 1;
    console.log(`${got === want ? "ok  " : "FAIL"} classifier — ${name}: expected ${want}, got ${got}`);
  }
  const dir = mkdtempSync(join(tmpdir(), "wing-ltc-window-guard-self-test-"));
  const file = join(dir, "sample.html");
  try {
    const original = "<button id=\"one\"></button>\n";
    const mutated = "<button id=\"two\"></button>\n";
    const foreignBytes = original + "<!-- written by somebody else -->\n";
    for (const [name, current, base, lastWritten, want] of [
      ["our own unmutated bytes are not foreign", original, original, undefined, "ours"],
      ["our own mutation is restored", mutated, original, mutated, "restore"],
      ["a foreign write is left alone", foreignBytes, original, mutated, "foreign"],
    ]) {
      writeFileSync(file, current);
      const got = planRestore(readFileSync(file, "utf8"), base, lastWritten);
      if (got !== want) failed += 1;
      console.log(`${got === want ? "ok  " : "FAIL"} restore guard — ${name}: expected ${want}, got ${got}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed === 0 ? "the classifier and the restore guard answer every case correctly" : `${failed} case(s) wrong`);
  process.exit(failed === 0 ? 0 : 1);
}

// Only one run at a time: two would interleave mutations of the same file and each would restore the other's bytes.
function takeLock() {
  try {
    writeFileSync(LOCK, String(process.pid), { flag: "wx" });
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = Number(readFileSync(LOCK, "utf8").trim());
    let alive = false;
    if (Number.isInteger(owner) && owner > 0) {
      try { process.kill(owner, 0); alive = true; } catch { alive = false; }
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

/// Is there a browser answering on the debug port? One that answers is somebody else's and is left alone.
async function browserAnswers() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/// Start our own headless Chrome if the port is silent, so the verdict does not depend on who prepared what.
async function ensureBrowser() {
  if (await browserAnswers()) {
    console.log(`using the browser already on port ${DEBUG_PORT}`);
    return null;
  }
  const profile = mkdtempSync(join(tmpdir(), "wing-ltc-window-chrome-"));
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

function runContract() {
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
    if (error.code === "ENOENT") return { code: null, output };
    return { code: typeof error.status === "number" ? error.status : 1, output };
  }
}

const browser = await ensureBrowser().catch((error) => {
  console.error(String(error.message));
  rmSync(LOCK, { force: true });
  process.exit(2);
});

const originals = new Map([
  [WINDOW, readFileSync(WINDOW, "utf8")],
  [CUE_LIST, readFileSync(CUE_LIST, "utf8")],
  [FIELD_EDITING, readFileSync(FIELD_EDITING, "utf8")],
]);
const backupDir = mkdtempSync(join(tmpdir(), "wing-ltc-window-mutation-"));
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

const baseline = runContract();
if (baseline.code !== 0) {
  console.log("the contract does not pass on the tree as it stands, so no mutation below would mean anything:");
  console.log((baseline.output || "").split("\n").slice(-6).join("\n"));
  restoreAll();
  rmSync(backupDir, { recursive: true, force: true });
  rmSync(LOCK, { force: true });
  if (browser) {
    browser.child.kill("SIGKILL");
    rmSync(browser.profile, { recursive: true, force: true });
  }
  process.exit(2);
}

const results = [];
try {
  for (const mutation of mutations) {
    restoreAll();
    // A mutation names the file it belongs to, so a rule in the shared module can be put back just as a line of the
    // window can. It defaults to the window, which is where every mutation that does not say otherwise lives.
    const target = mutation.file ?? WINDOW;
    const original = originals.get(target);
    if (!original.includes(mutation.from)) {
      results.push({ name: mutation.name, verdict: "unexpected", why: `the mutation target was not found in ${basename(target)} — this check is stale` });
      continue;
    }
    const mutated = original.replace(mutation.from, mutation.to);
    writeFileSync(target, mutated);
    written.set(target, mutated);
    results.push({ name: mutation.name, ...classify(mutation.expect, runContract()) });
  }
} finally {
  restoreAll();
  const left = [...originals].filter(([file, bytes]) => readFileSync(file, "utf8") !== bytes);
  if (left.length > 0 || foreign.size > 0) {
    console.error(`these files were NOT restored — their originals are in ${backupDir}: ${[...left.map(([file]) => file), ...foreign].join(", ")}`);
  } else {
    rmSync(backupDir, { recursive: true, force: true });
  }
  rmSync(LOCK, { force: true });
  if (browser) {
    browser.child.kill("SIGKILL");
    rmSync(browser.profile, { recursive: true, force: true });
  }
}

const LABEL = { caught: "caught      ", missed: "MISSED      ", unexpected: "UNEXPECTED  ", "could-not-run": "COULD-NOT-RUN", "no-verdict": "NO-VERDICT  " };
for (const result of results) {
  console.log(`${LABEL[result.verdict]}  ${result.name}${result.why ? ` — ${result.why}` : ""}`);
}
const counts = results.reduce((tally, result) => ({ ...tally, [result.verdict]: (tally[result.verdict] || 0) + 1 }), {});
console.log(`\n${counts.caught || 0} caught of ${results.length}` +
  `${counts.missed ? `, ${counts.missed} missed (a contract that does not catch its defect)` : ""}` +
  `${counts.unexpected ? `, ${counts.unexpected} unexpected (the contract failed for another reason)` : ""}` +
  `${counts["could-not-run"] ? `, ${counts["could-not-run"]} could not run (nothing was measured)` : ""}`);
const allCaught = results.every((result) => result.verdict === "caught");
console.log(allCaught
  ? "every way the LTC window can be wrong is caught by a contract that fails when it is put back"
  : "not every defect was shown to be caught — read the verdicts above");
process.exit(allCaught ? 0 : 1);
