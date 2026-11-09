// The LTC input's contracts, asserted at the source that ships.
//
// The owner's requirement is that the chase be **unbreakable**; the study of 2026-10-05 found it was not, and the
// first defect is the one an operator feels as a hang: three commands that touch CoreAudio were declared as bare
// `#[tauri::command]` functions, which Tauri resolves to `ExecutionContext::Blocking` — so their bodies ran on the
// **main thread**, inside the WKWebView's script-message callback. `open_ltc_input` waits up to ten seconds for a
// stream to start, and `ltc_input_state` enumerates every device on every 250 ms poll, which is why even pressing
// Stop appeared to hang (the window calls the state read straight after it).
//
// The project had already written the rule next to `request_audio_access` — async plus `spawn_blocking` — and then
// left exactly these three. A source assertion is the honest contract here: it needs no device, no permission and
// no browser, it fails the moment somebody writes `fn` again, and it is the same shape as
// `test-desktop-audio-permission.mjs` and `test-desktop-command-registry.mjs`.
//
// What it can **not** prove is that CoreAudio answers quickly, or that a real device opens: those need hardware.
// What it proves is that no command in the LTC input path can block the thread that paints the window.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const MAIN = readFileSync(`${ROOT}desktop/src-tauri/src/main.rs`, "utf8");
const DEVICE = readFileSync(`${ROOT}desktop/src-tauri/src/ltc_device.rs`, "utf8");
const HTML = readFileSync(`${ROOT}desktop/ui/index.html`, "utf8");

/// The declaration of one command: the text from its attribute through the opening brace of its body.
function commandBody(source, name) {
  const found = new RegExp(`#\\[tauri::command[^\\]]*\\]\\s*(?:pub\\s+)?async\\s+fn\\s+${name}\\b`).exec(source);
  return found ? found[0] : null;
}

/// The body of a named function: from its signature to the first line that is nothing but a closing brace.
///
/// This exists because a regex over a whole file is not a contract. `assert.match(DEVICE, /clear_the_flag/)` passes
/// if *anything* in a thousand lines contains that text - including the function that does the opposite, or a test
/// that asserts it. Scoping the assertion to the function it is about is what gives it teeth; the mutation harness
/// is what proves it, and it did not: three of its five mutations were MISSED until this helper existed.
///
/// `name` may carry a signature fragment when the bare name is ambiguous - `new(error: &cpal::Error` finds the one
/// `new` that classifies a cpal error rather than the first `new` in the file. The body ends at the closing brace
/// written at **the same indentation as the `fn`**, which is the only line inside a formatted function that can be:
/// every inner brace is indented further, so the first attempt - "the first lone brace" - stopped at the closing
/// brace of an `if` and cut the handler in half.
function fnBody(source, name) {
  // A bare name gets the opening parenthesis appended; a name that already carries its signature - so that an
  // ambiguous `new` can be pinned to the one that takes a cpal error - is used as it stands.
  const signature = name.includes("(") ? `fn ${name}` : `fn ${name}(`;
  const start = source.indexOf(signature);
  if (start < 0) return "";
  const lineStart = source.lastIndexOf("\n", start) + 1;
  const indent = (source.slice(lineStart, start).match(/^\s*/) || [""])[0];
  const closer = new RegExp(`\\n${indent}\\}`).exec(source.slice(start));
  return closer ? source.slice(start, start + closer.index + closer[0].length) : source.slice(start);
}

// --- 1. The three commands that touch CoreAudio run off the main thread ----------------------------------------
// `#[tauri::command(async)]` also runs a synchronous body on the async runtime, but the body here **blocks**, so the
// only correct shape is an `async fn` whose blocking work is handed to `spawn_blocking`: the async runtime is a
// small pool, and ten seconds of device wait on it is ten seconds of every other command. Both spellings are
// accepted by the declaration check below, and the `spawn_blocking` check decides the rest.
for (const name of ["list_timecode_inputs", "ltc_input_state", "open_ltc_input"]) {
  const declared = commandBody(MAIN, name);
  assert.ok(declared, `${name} must be declared #[tauri::command] async fn — a bare fn runs on the main thread`);
  assert.match(declared, /async\s+fn/, `${name} must be async: ${declared}`);
}

// And the body really is moved off the webview thread rather than merely declared async: an `async fn` whose first
// line blocks would still freeze the window.
for (const name of ["list_timecode_inputs", "ltc_input_state", "open_ltc_input", "reconnect_ltc_input"]) {
  const start = MAIN.indexOf(`fn ${name}(`);
  assert.ok(start > 0, `${name} must exist in main.rs`);
  // The body of an async command ends at the next `#[tauri::command]` or at the end of its function; a window of
  // 4000 characters is far longer than any of these and far shorter than two commands.
  const body = MAIN.slice(start, start + 4000);
  assert.match(body, /spawn_blocking/, `${name} must move its blocking body into tauri::async_runtime::spawn_blocking`);
}

// `request_audio_access` is the idiom the three above were meant to follow; if it ever loses the shape, the comment
// that teaches it is a lie. This keeps the teacher honest.
assert.match(MAIN.slice(MAIN.indexOf("async fn request_audio_access")), /spawn_blocking/,
  "request_audio_access is the documented idiom: async plus spawn_blocking");

// --- 2. The stream's death is a fact the backend records and announces ------------------------------------------
// The whole response to a hot unplug used to be `eprintln!`. What must be true instead: the handler is a named
// function (the seam a unit test invokes), it clears the flag `is_open()` reads, keeps the reason, and the
// application emits an event so the page can stop saying "Listening to …".
//
// Every assertion here is scoped to the function it is about. A file-wide regex is what let a mutation through:
// `status.running.store(false` is satisfied just as well by `close_within`, so the handler could lose its clear
// and the contract would still pass. Scoping is the difference between a contract and a comment.
const onStreamError = fnBody(DEVICE, "on_stream_error");
assert.ok(onStreamError, "the stream's error handler must be a named function, not an inline closure");
assert.match(onStreamError, /status\.running\.store\(false/, "the handler must clear the flag the callbacks and is_open() read");
assert.match(onStreamError, /record_error\(/, "and it must keep the reason for the page");
// The error kinds are classified where a cpal error becomes one of ours, not in the handler: the handler is handed
// a `StreamError` already. Scoping these to the handler was my mistake, and the suite said so out loud.
const classifyStreamError = fnBody(DEVICE, "new(error: &cpal::Error");
assert.match(classifyStreamError, /ErrorKind::DeviceNotAvailable/, "DeviceNotAvailable must be recognised as the device going away");
assert.match(classifyStreamError, /ErrorKind::StreamInvalidated/, "and StreamInvalidated too: both mean the stream is dead");
assert.match(MAIN, /emit\(\s*"ltc-input-stream-dead"/, "the window must be told: the page cannot stop saying \"Listening\" otherwise");
assert.match(MAIN, /stream_error: input\.take_error\(\)/, "and the state read must carry the reason, taken once");
assert.match(HTML, /ltc-input-stream-dead/, "the window must listen for the death event");
assert.match(HTML, /Press Reconnect the input/, "and it must offer the way back from it");

// --- 3. One control recovers from a hot unplug -----------------------------------------------------------------
// The study's smallest answer to "a way to refresh without restarting": one async command, off the main thread, that
// bumps a generation, closes with a bounded wait, re-resolves the device by name with a fallback to the default
// input, and returns one sentence naming the step that failed.
const reconnect = commandBody(MAIN, "reconnect_ltc_input");
assert.ok(reconnect, "reconnect_ltc_input must be declared #[tauri::command] async fn");
assert.match(DEVICE, /pub fn reopen\(/, "the reopen path must live in ltc_device.rs, where the generation is");
assert.match(DEVICE, /close_within\(/, "closing must be bounded, so a stuck driver cannot hold the reconnect");
assert.match(DEVICE, /default_input_device\(\)/, "the device is re-resolved by name with a fallback to the default input");
assert.match(DEVICE, /the step that failed was finding the device/, "the refusal must name the step that failed");
assert.match(HTML, /id="timecode-input-reconnect"/, "the Timecode section must carry the control");
assert.match(HTML, /addEventListener\("click", reconnectLtcInput\)/, "and the control must be wired to the command");
assert.match(HTML, /Closing the stream and asking the system for the inputs again…/,
  "and it must say what it is doing before it waits");

// --- 4. One real running flag, not two -------------------------------------------------------------------------
// `running` was a plain `AtomicBool` in the struct while the six callbacks read a different `Arc<AtomicBool>` that
// nothing ever set false, so an in-flight block could still push positions and fire cues after a close. The struct
// must not own a plain flag again: the state it reports has to be the state the callbacks read.
assert.match(DEVICE, /struct LtcStreamStatus/, "one shared status is the flag the callbacks and the struct both read");
// The struct the application holds must not declare a flag of its own: that is exactly the split-brain state, and it
// is what `#[derive(Default)] pub struct LtcInput { ... running: AtomicBool, ... }` used to be.
const ltcInputStruct = /pub struct LtcInput \{([\s\S]*?)\n\}/.exec(DEVICE);
assert.ok(ltcInputStruct, "LtcInput must be declared in ltc_device.rs");
assert.doesNotMatch(ltcInputStruct[1], /running/,
  "LtcInput must not hold a second, unshared running flag: the callbacks read the shared status");
assert.match(DEVICE, /status\.is_running\(\)/, "the callback guard must read the shared status");
// Scoped, because the line above is satisfied by the six callback call sites alone: the guard could lose its
// generation check, or `is_open()` could stop consulting the shared status, and a file-wide match would not notice.
const isRunning = fnBody(DEVICE, "is_running");
assert.match(isRunning, /is_current\(\)/,
  "the shared status must also answer for the *current* generation, or an old stream's error still counts");
const isOpen = fnBody(DEVICE, "is_open");
assert.match(isOpen, /is_running\(\)/,
  "and is_open() must answer from that same shared status rather than from a field of its own");
// The status must be the one the callbacks are given, not a copy made for them.
assert.match(DEVICE, /Arc<LtcStreamStatus>/, "the status must travel as one shared `Arc`, not by value");

console.log("LTC stream contract passed: 3 CoreAudio commands off the main thread, death announced, one reconnect control, one running flag");
console.log("WING_BROWSER_SUITE_OK");
