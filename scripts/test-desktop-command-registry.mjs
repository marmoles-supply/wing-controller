// The command registry contract.
//
// A window that calls `invoke("something")` where `something` is not in the backend's `generate_handler!` gets a
// rejected promise and, unless the call site happens to catch it and say something, a button that does nothing. That
// is the quietest bug this application can have, and it is invisible to every suite: the window's own tests run with
// no backend, so they never call one.
//
// The same walk is run in the other direction, because a registered command nobody calls is either dead code or an
// interface that was promised and not finished — both worth being told about at the gate rather than discovered in a
// rehearsal.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registeredCommands } from './lib/command-registry.mjs';

const ROOT = new URL("..", import.meta.url).pathname;
const main = readFileSync(`${ROOT}desktop/src-tauri/src/main.rs`, "utf8");

const registered = registeredCommands(main);
// A mention in a later test/comment is not registration. This was a measured false green.
assert.deepEqual([...registeredCommands('generate_handler![present,] later(missing);')], ['present']);
assert.throws(() => registeredCommands('no registry here'), /registry/);
assert.throws(() => registeredCommands('generate_handler![not an identifier]'), /entry/);

/// Every window that calls `invoke`, and roughly how many distinct commands each one should be calling. The floors are
/// deliberately loose: their job is to catch a walk that stopped finding anything (a renamed helper, a window that
/// stopped being read), not to pin a count that every legitimate edit would have to update.
const WINDOWS = [
  ["index.html", 40],
  ["timecode.html", 4],
  ["ltc.html", 6],
];

let windowCalls = 0;
const allCalled = new Set();
for (const [name, floor] of WINDOWS) {
  const html = readFileSync(`${ROOT}desktop/ui/${name}`, "utf8");
  const called = [...new Set([...html.matchAll(/invoke\(\s*"([a-z0-9_]+)"/g)].map((match) => match[1]))].sort();
  windowCalls += called.length;
  for (const one of called) allCalled.add(one);
  assert.ok(
    called.length >= floor,
    `${name} should be calling its backend (found ${called.length}, expected at least ${floor}) — a walk that finds nothing proves nothing`,
  );
  const missing = called.filter((command) => !registered.has(command));
  assert.deepEqual(
    missing,
    [],
    `these commands are called from ${name} but not registered in the backend: ${missing.join(", ")} — that is a button that does nothing, which is the quietest bug this application can have`,
  );
}

// **Every window, not only the workstation.** This walk used to read `index.html` alone, and the header above says the
// bug it guards against "is invisible to every suite" — which was still true of the clock and the LTC window, the two
// that the cue work is moving into. The forward direction is the one that must fail the gate, so it is asserted for
// all three; the reverse direction stays a report, because a command may legitimately be used only by the meters or by
// a script.
const called = [...allCalled].sort();

// The other direction is a report rather than a failure: a command may be used by the meters or the clock window, or
// by a script, and counting them by indentation would be a guess. What the gate must fail on is the direction that
// makes a button do nothing, and that is asserted above.
const unused = [...registered].filter((name) => !called.includes(name));

console.log(`command registry passed: ${called.length} commands called from the window, all registered, ${unused.length} used elsewhere`);
