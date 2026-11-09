#!/usr/bin/env node
// The three readings of a skip, tested WITHOUT A STUB and WITHOUT A BROWSER.
//
// **Why this file exists, and it is a structural reason rather than a taste.** `MEASURED`: of every
// `scripts/test-*.mjs` that mentions `cue-list.js`, exactly ONE does not drive Chrome — and it reads the file as
// TEXT. So the module's logic was only ever exercised through a browser suite, and a browser suite reaches it
// through a STUB. A stub is written by the same person, at the same time, from the same understanding as the code:
// **when it shares an assumption with the code, both pass.**
//
// That is not a hypothesis; it is how this session lost a defect. `skipReason` tested
// `across_silence === null`, while `AsRunLine` carries `skip_serializing_if = "Option::is_none"` so the real record
// OMITS the key and JavaScript sees `undefined`. The stub wrote an explicit `null` — a value the backend cannot
// produce — so the suite stayed green, the mutation that was supposed to guard it mutated the null branch, and the
// one case the last-run view exists for rendered "the position jumped" in production for three rounds until a fresh
// reader found it.
//
// So this test calls the function DIRECTLY, with the three shapes a real caller can pass, and **has no stub to share
// an assumption with**. It needs no browser, which also means it can run while the gate is using the only one.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../desktop/ui/cue-list.js", import.meta.url), "utf8");

// The function is pure and its only dependency is `secondsText`, so both are lifted out of the module and run here.
// Extraction is asserted rather than assumed: a rename must break this file loudly rather than silently test nothing.
const lift = (name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} must exist in cue-list.js for this test to mean anything`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} has unbalanced braces`);
};
const skipReason = new Function(`${lift("secondsText")}\n${lift("skipReason")}\nreturn skipReason;`)();

// --- the three readings, each passed in the shape the REAL producer uses -------------------------
// An `AsRunLine` is the record's line: snake_case, and `across_silence` ABSENT when it was never measured.
{
  const dropout = { spent: "skipped", id: "c", at: "01:00:30:00", jumped_ms: 1200, arrival_gap_ms: 1200, across_silence: true };
  assert.equal(skipReason(dropout), " · the timecode had stopped arriving for 1.2 s",
    "a measured dropout says so AND says for how long");

  const jumped = { spent: "skipped", id: "c", at: "01:00:20:00", jumped_ms: 3200, arrival_gap_ms: null, across_silence: false };
  assert.equal(skipReason(jumped), " · the position jumped 3.2 s",
    "a measured jump says the position jumped");

  // THE CASE THIS FILE EXISTS FOR. The key is not null; it is NOT THERE.
  const unmeasured = { spent: "skipped", id: "c", at: "01:00:40:00", jumped_ms: 900, arrival_gap_ms: null };
  const reading = skipReason(unmeasured);
  assert.equal(reading, " · the position moved 0.9 s",
    `a skip whose verdict was never measured must say the position moved, NOT assert a measurement nobody made (got "${reading}")`);
  assert.ok(!reading.includes("stopped arriving") && !reading.includes("jumped"),
    `and it must inherit neither of the other two readings (got "${reading}")`);

  // The same case in the other spelling the history entry uses, so neither vocabulary can drift.
  assert.equal(skipReason({ kind: "skipped", jumpedMs: 900, arrivalGapMs: null }),
    " · the position moved 0.9 s",
    "the camelCase vocabulary used by the history entry reads the same way");

  // And anything that is not a measured verdict at all - null, undefined, a string - is unmeasured rather than a jump.
  for (const verdict of [null, undefined, "true"]) {
    const why = skipReason({ spent: "skipped", across_silence: verdict, jumped_ms: 500 });
    assert.ok(why.includes("the position moved"),
      `a verdict of ${String(verdict)} is not a measurement, so the skip must read as unmeasured (got "${why}")`);
  }

  // A fired cue has no reason to give, and a cue that never skipped must not borrow one.
  assert.equal(skipReason({ spent: "fired" }), "", "a fired line carries no skip reason");
  assert.equal(skipReason({ kind: "fired" }), "", "in either vocabulary");
}
console.log("skip-reason contracts passed (three readings, both vocabularies, and an absent key is not a null)");
