// The microphone permission contract (review of 2026-10-03).
//
// macOS **terminates** a process that records from an audio input without an `NSMicrophoneUsageDescription` in its
// bundle: it does not ask, it kills. The audio input added for LTC (Phase T4 of docs/TIMECODE_PLAN.md) would
// therefore have worked in a development run and killed the installed application the first time an operator pressed
// "Listen" — the kind of defect that is invisible in every test that does not build a bundle.
//
// So the coupling is asserted here: **if the code that opens an audio input exists, the usage description has to
// exist too.** The day somebody removes the feature they may remove the key; the day somebody adds a second one, this
// test is where they find out what else macOS wants.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const INPUT = `${ROOT}desktop/src-tauri/src/ltc_device.rs`;
const PLIST = `${ROOT}desktop/src-tauri/Info.plist`;

const inputSource = existsSync(INPUT) ? readFileSync(INPUT, "utf8") : "";
const opensAnInput = /build_input_stream/.test(inputSource);

if (!opensAnInput) {
  // No audio input in this tree: nothing to declare, and saying so is the honest result rather than a silent pass.
  console.log("no audio input in this tree, so no microphone permission is required");
  console.log("WING_BROWSER_SUITE_OK");
  process.exit(0);
}

assert.ok(existsSync(PLIST), "the audio input opens a device, so desktop/src-tauri/Info.plist must declare NSMicrophoneUsageDescription");
const plist = readFileSync(PLIST, "utf8");
assert.match(plist, /NSMicrophoneUsageDescription/, "the usage description macOS demands before it will let this application record");
const text = /<key>NSMicrophoneUsageDescription<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
assert.ok(text, "the usage description must be a string, because that is what the system's dialog shows");

const description = text[1].trim();
assert.ok(description.length >= 40, `the description has to explain what the microphone is for (got ${JSON.stringify(description)})`);
assert.match(description, /timecode|LTC/i, `and name what it is for, which is timecode (got ${JSON.stringify(description)})`);
assert.match(description, /when you ask|only while you/i, `and say that it does not listen unasked (got ${JSON.stringify(description)})`);

// The project rule about what an operator reads applies to the system's dialog too: no console identity, no serial,
// no address, no firmware build. This is the one string macOS shows on this application's behalf.
assert.doesNotMatch(description, /WING-[A-Z0-9]/, `no console identity may reach the permission dialog (got ${JSON.stringify(description)})`);
assert.doesNotMatch(description, /\b\d{1,3}(\.\d{1,3}){3}\b/, `nor an IP address (got ${JSON.stringify(description)})`);
assert.doesNotMatch(description, /\bv?\d+\.\d+\.\d+\b/, `nor a firmware build (got ${JSON.stringify(description)})`);

// The description is what macOS **shows**; the entitlement is the **right to ask**. A bundle signed with the hardened
// runtime and no audio-input entitlement cannot record however well the code asks — which is exactly what happened
// on 2026-10-03, when only the description was here and the LTC input listed devices and then failed to open.
const ENTITLEMENTS = `${ROOT}desktop/src-tauri/entitlements.plist`;
assert.ok(existsSync(ENTITLEMENTS), 'the audio input also needs desktop/src-tauri/entitlements.plist: the hardened runtime checks it before it lets a process record');
const entitlements = readFileSync(ENTITLEMENTS, 'utf8');
assert.match(entitlements, /com\.apple\.security\.device\.audio-input/, 'the audio-input entitlement is the one macOS checks for recording');
const config = JSON.parse(readFileSync(`${ROOT}desktop/src-tauri/tauri.conf.json`, "utf8"));
assert.equal(config?.bundle?.macOS?.entitlements, 'entitlements.plist',
  'and the bundle has to be signed with it: a file nothing points at is a file that changes nothing');

console.log(`audio permission contract passed: ${description.length} characters of description, naming timecode`);
console.log("WING_BROWSER_SUITE_OK");
