// The backend half of Live Safe Mode, pinned to the command table itself.
//
// `test-desktop-live-safety-contracts.mjs` covers the window: that every handler which mutates the
// library asks `liveLockBlocks()` first, that the buttons are disabled and the refusal is visible.
// Nothing checked the **other** half — the Rust commands — so a command that writes to the console
// could be added without the padlock covering it. That is exactly the hole the 2026-09-24 audit
// found by hand ("the padlock covered the library but not direct sending to the console").
//
// This test reads `desktop/src-tauri/src/main.rs`, extracts every `#[tauri::command]`, works out
// which of them can put a **value** on the wire (as opposed to an argument-less read, a
// subscription, a discovery probe or a simulated frame) and asserts that each one reaches
// `refuse_live_change`, directly or through a helper. It also pins the classification itself, so
// adding a command that writes cannot pass unnoticed: the test fails and names it.
//
// Run: node scripts/test-desktop-live-safety-commands.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// `WING_MAIN_RS` exists for the mutation check: this test is only worth having if it fails when the
// guard is removed or a writing command is added, and that is proved by running it against a mutated
// copy (see the commit that introduced it).
const sourcePath = process.env.WING_MAIN_RS
  ? path.resolve(process.env.WING_MAIN_RS)
  : path.join(repoRoot, "desktop/src-tauri/src/main.rs");
const source = fs.readFileSync(sourcePath, "utf8");

/** Strips comments and string literals so brace matching cannot be thrown off by a `}` in prose. */
function stripNonCode(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "//") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    const rawString = /^r#*"/.exec(text.slice(i, i + 4));
    if (rawString) {
      const hashes = rawString[0].length - 2;
      const close = `"${"#".repeat(hashes)}`;
      const end = text.indexOf(close, i + rawString[0].length);
      i = end < 0 ? text.length : end + close.length;
      continue;
    }
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") j += 2;
        else if (text[j] === '"') break;
        else j += 1;
      }
      i = j + 1;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

const code = stripNonCode(source);

/** Every function body in the file, by name, with balanced braces. */
function functionBodies(text) {
  const bodies = new Map();
  const declaration = /(?:^|\n)\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[<(]/g;
  let match;
  while ((match = declaration.exec(text)) !== null) {
    const name = match[1];
    const open = text.indexOf("{", match.index + match[0].length);
    if (open < 0) continue;
    let depth = 0;
    let index = open;
    for (; index < text.length; index += 1) {
      if (text[index] === "{") depth += 1;
      else if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (!bodies.has(name)) bodies.set(name, text.slice(open, index + 1));
  }
  return bodies;
}

const bodies = functionBodies(code);
assert.ok(bodies.size > 200, `the extraction must find the file's functions (found ${bodies.size})`);

/**
 * The functions that put a **value** on the wire, i.e. that change the console's state.
 *
 * An argument-less read (`read_leaf_state`, `try_send_osc_read`), a discovery probe
 * (`probe_wing_route`), a meter subscription (`update_custom_meters`) and the simulated frames
 * (`frame_demo`, `usb_trigger_self_test`) all send packets too, and none of them is a state change:
 * Live Safe Mode must still let the operator look at the desk. The distinction is the whole point of
 * this test, so the primitives are named here rather than inferred.
 */
const writePrimitives = [
  "send_configured_osc_step", // a step of a run: set / delay_set / the write half of a toggle
  "execute_ramp_step", // the packets of a fade
  "write_and_read_back", // the hardware helpers
];
/** The one command that writes on its own, without going through a step. */
const selfWritingCommands = ["send_osc_message"];

const callsIn = (body, name) => new RegExp(`\\b${name}\\s*\\(`).test(body);

const writes = new Map();
for (const [name, body] of bodies) {
  writes.set(name, writePrimitives.some((primitive) => callsIn(body, primitive)));
}
let grew = true;
while (grew) {
  grew = false;
  for (const [name, body] of bodies) {
    if (writes.get(name)) continue;
    for (const [other, otherWrites] of writes) {
      // `send_osc_message` is an entry point, not a helper: calling it from somewhere else would be
      // its own decision, and none does.
      if (!otherWrites || other === "send_osc_message") continue;
      if (callsIn(body, other)) {
        writes.set(name, true);
        grew = true;
        break;
      }
    }
  }
}

const commands = [];
const commandPattern = /#\[tauri::command(?:\([^)]*\))?\]\s*\n\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g;
let commandMatch;
while ((commandMatch = commandPattern.exec(code)) !== null) commands.push(commandMatch[1]);
assert.ok(commands.length >= 40, `the command table must be read whole (found ${commands.length})`);

const reachesGuard = (name, seen = new Set()) => {
  if (seen.has(name)) return false;
  seen.add(name);
  const body = bodies.get(name) ?? "";
  if (callsIn(body, "refuse_live_change")) return true;
  // The shared gate: a live session first, then Live Safe Mode. Every console writer goes through it.
  if (callsIn(body, "refuse_console_write")) return true;
  for (const other of bodies.keys()) {
    if (other !== name && callsIn(body, other) && reachesGuard(other, seen)) return true;
  }
  return false;
};

const writingCommands = commands.filter((name) => writes.get(name) || selfWritingCommands.includes(name));
const unguarded = writingCommands.filter((name) => !reachesGuard(name));

// The classification is pinned, not just the guard: a new writing command must be looked at, and a
// read that starts being classified as a write means the primitives above are wrong.
// `fire_macro` joined on 2026-10-01: a secondary click on a macro row runs its whole action list, so it
// writes like the others and goes through the same gate (`refuse_console_write`: a live session first,
// then Live Safe Mode). It is named here on purpose — a new writing command must be a decision.
const EXPECTED_WRITING = [
  "send_osc_message",
  "start_wing_usb_stream",
  "test_action_step",
  "fire_macro",
];
assert.deepEqual(
  writingCommands.slice().sort(),
  EXPECTED_WRITING.slice().sort(),
  "the set of commands that can change the console's state changed: classify the new one (does it write? " +
    "then it needs `refuse_live_change`, or a line here saying why not)",
);
assert.deepEqual(
  unguarded,
  [],
  "every command that can write to the console must refuse under Live Safe Mode (refuse_live_change), " +
    `directly or through a helper: ${unguarded.join(", ")}`,
);

// The read-only paths must NOT be classified as writers: if the primitives ever swallow them, this
// test would silently stop protecting anything.
for (const readOnly of [
  "verify_macro_targets",
  "discover_wing",
  "read_strip_models",
  "read_fx_models",
  "get_stream_state",
  "update_active_meters",
  "frame_demo",
  "usb_trigger_self_test",
]) {
  assert.ok(!writingCommands.includes(readOnly), `${readOnly} only reads or simulates: it must not need the padlock`);
}

// ── The other half of the padlock: the station's own saved state ────────────────────────────────────
//
// Live Safe Mode also freezes the station: saving or importing a show profile or a macro library is
// refused while it is on (the 2026-09-24 audit's own wording). Those commands reach the guard through
// the `*_checked` helpers, so the reachability walk above is reused here on the file-writing
// primitives.
// The named writers, plus the two `std::fs` primitives a writer can reach for. `restore_recovered_copy` is here
// because it puts the recovery copy back over the primary with a temporary and a rename: it used to be an `fs::write`
// and the detector saw it, and when it grew the atomic write the two commands that restore a recovered file stopped
// looking like writers — a false negative in this list, not a change in what those commands do.
const filePrimitives = [
  "write_json_with_recovery",
  "write_text_atomic",
  "restore_recovered_copy",
  "fs::write",
  "create_dir_all",
];
const writesFiles = (name) => {
  const seen = new Set();
  const walk = (current) => {
    if (seen.has(current)) return false;
    seen.add(current);
    const body = bodies.get(current) ?? "";
    if (filePrimitives.some((primitive) => body.includes(primitive))) return true;
    return [...bodies.keys()].some((other) => other !== current && callsIn(body, other) && walk(other));
  };
  return walk(name);
};
const fileWritingCommands = commands.filter(writesFiles);

/**
 * Commands that write files and are deliberately **not** refused by the padlock, with the reason.
 *
 * A station backup and an export write the file the operator chose; they change neither the console
 * nor the station's stored state, and an operator must be able to save the show while it is live.
 * Loading a profile reads a file into the editor, and the folder helper creates a directory.
 */
const ALLOWED_WITHOUT_PADLOCK = {
  save_station_backup: "writes the file the operator chose: an export, not a station change",
  ensure_backup_folder: "creates the save folder; it changes nothing but the filesystem",
  load_show_runner_config:
    "reads a file into the editor (and repairs an unreadable file from the app's own recovery copy at load time)",
  load_macro_library:
    "reads the library (and repairs an unreadable file from the app's own recovery copy at load time)",
  get_timecode_cues:
    "reads the cue list (and repairs an unreadable file from the app's own recovery copy at load time, " +
    "which is the same path load_show_runner_config and load_macro_library already take)",
  log_backup_event: "appends a line to the session log: the log has to record what happens while live",
  set_inter_app_settings:
    "writes the list of other applications to talk to (Phase A of docs/INTER_APP_PLAN_REVIEW_2026-10-02.md): " +
    "it changes neither the station, nor the library, nor the console, and nothing in this build acts on it yet",
  export_timecode_cues:
    "writes the cue file the operator chose: an export, not a station change. It deliberately does not save the " +
    "list first — installing a list re-arms the engine — so exporting a copy cannot reset a rehearsal, and an " +
    "operator must be able to take a copy of the show while it is live, exactly like save_station_backup",
};

const stationUnguarded = fileWritingCommands.filter(
  (name) => !reachesGuard(name) && !(name in ALLOWED_WITHOUT_PADLOCK),
);
assert.deepEqual(
  stationUnguarded,
  [],
  "a command that writes the station's files must refuse under Live Safe Mode, or be listed in " +
    `ALLOWED_WITHOUT_PADLOCK with its reason: ${stationUnguarded.join(", ")}`,
);
const fileWritersExpected = [
  "ensure_backup_folder",
  "export_macro_library",
  "export_show_runner_config",
  "import_macro_library",
  "import_show_runner_config",
  "load_macro_library",
  "load_show_runner_config",
  "log_backup_event",
  "save_macro_library",
  "save_show_runner_config",
  "save_station_backup",
  // Phase A of the inter-application plans: it writes the peer registry, and nothing in this build acts
  // on it — the exemption above carries the reason. Classified here so a future command cannot appear
  // silently.
  "set_inter_app_settings",
  // The cue work added two writers. add_timecode_cue_at_position writes the list the operator is editing when they
  // type a position, so the padlock does not have to cover it; get_timecode_cues repairs an unreadable cue file from
  // the application's own recovery copy at load time, the same way load_macro_library and load_show_runner_config do.
  // Classified here so either of them appearing silently fails the contract.
  "add_timecode_cue_at_position",
  "get_timecode_cues",
  // Gated, not exempt: the cue list decides what fires during a show, so the command that writes it refuses under
  // the padlock — which is a different classification from the peer list above, and the contract is where that
  // distinction lives.
  "set_timecode_cues",
  // The same classification as the save above, and for the same reason: where a cue goes is part of what the show
  // will do, so it is covered by the padlock rather than exempt from it.
  "add_timecode_cue_from_position",
  // `Add cue at the end` writes the cue file for the same reason: it appends a cue the show would fire, so it is
  // gated like the other two adds. Classified here so a future writing command cannot appear silently.
  "add_timecode_cue_at_end",
  // Exporting the cue list writes only the file the operator chose and installs nothing: the exemption above carries
  // the reason, and it is the same one save_station_backup has.
  "export_timecode_cues",
  // Importing **replaces** the show's cue list (file and engine), so it is gated like the add paths rather than
  // exempt like the export, and it validates the file before it replaces anything.
  "import_timecode_cues",
];
assert.deepEqual(
  fileWritingCommands.slice().sort(),
  fileWritersExpected.slice().sort(),
  "the set of commands that write files changed: classify the new one (does the padlock have to cover " +
    "it, or does it only write where the operator said?)",
);

// --- Monitor is gated **asymmetrically**, and the direction is the contract ----------------
// `set_timecode_rehearsal` writes no file and touches no console, so no primitive above classifies it — and yet it
// decides whether the show fires at all, which is the most a command can change during a live session. Entering
// Monitor is refused while Live Safe Mode is on (the LTC plan keeps the control out of the window's own Live mode for
// that reason: "an operator who switched it on during a show would stop the show firing"). Leaving Monitor is **not**
// refused, and that asymmetry is deliberate: a symmetric gate would let an operator trap a live show in the only state
// where nothing fires, with no way out but disconnecting a show in progress. This pins the direction, because tidying
// the two branches into one unconditional refusal would recreate the trap and no browser suite would notice.
const rehearsalStart = source.indexOf("fn set_timecode_rehearsal(");
assert.ok(rehearsalStart > 0, "set_timecode_rehearsal must still exist for this contract to mean anything");
const rehearsalBody = source.slice(rehearsalStart, source.indexOf("\n}\n", rehearsalStart));
assert.match(
  rehearsalBody,
  /if rehearsing \{\s*\n\s*live\.refuse_live_change\(/,
  "putting the cue list in Monitor must be refused while a session is live",
);
assert.equal(
  (rehearsalBody.match(/refuse_live_change\(/g) || []).length,
  1,
  "and only in that direction: refusing to leave Monitor would trap a live show in the one state where nothing fires",
);
// Go is deliberately **not** gated, and the reason is the class the padlock actually covers: it stops configuration
// changing under a live show (and starting the stream). Firing is not configuration — `fire_macro` and
// `test_action_step` are in the writing class and are refused for writing to the console, while a sequence Go is the
// operator performing. A padlock that also stopped performance would make a sequential show unusable live, which is
// exactly when an operator wants to step one.
assert.doesNotMatch(
  source.slice(source.indexOf("fn timecode_sequential_go("), source.indexOf("\n}\n", source.indexOf("fn timecode_sequential_go("))),
  /refuse_live_change\(/,
  "a sequence Go is a performance action, not a configuration change: it must not be behind the padlock",
);
console.log("monitor gate contracts passed (asymmetric by design, and sequence Go left out of the padlock)");

console.log(`live-safety command table: ${commands.length} commands, ${writingCommands.length} can change state`);
for (const name of writingCommands) console.log(`  writes, guarded: ${name}`);
console.log(`  read-only / simulated / subscription: ${commands.length - writingCommands.length}`);
console.log(`  of the ${fileWritingCommands.length} commands that write files, all reach the padlock or are exports:`);
for (const name of fileWritingCommands) {
  const reason = ALLOWED_WITHOUT_PADLOCK[name];
  console.log(`    ${name}${reason ? ` — allowed: ${reason}` : ""}`);
}
console.log("backend live-safety contracts passed");
