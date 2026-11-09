#!/usr/bin/env node
// Evidence for one row of the readiness plan's failure matrix: **two instances must not run**.
//
// Found on 2026-09-30 (docs/SHOW_READINESS_RESULTS_2026-09-30.md, A3): forcing a second launch
// (`open -n`, a double launch while the first is still starting, or the copy on a mounted disk image
// beside the installed one) started a second application — two streams on one desk, two windows
// writing the same files, and two runtimes able to fire the same macro, which for a toggle is two
// flips and a parameter that ends where it started. The fix is the `tauri-plugin-single-instance`
// registration in `desktop/src-tauri/src/main.rs`.
//
// This script proves it on the binary that will be used, which is why it is a script and not a gate
// test: it launches the real application, and the gate has no business opening windows.
//
// Usage: node scripts/wing-verify-single-instance.mjs [--binary <path>] [--settle <seconds>]
//   default binary: the installed /Applications bundle, which is what a show machine runs.
//
// Exit 0 with the numbers when exactly one process survives two launches; non-zero otherwise.

import { execFileSync, spawn } from "node:child_process";

const DEFAULT_BINARY = "/Applications/WING CONTROLLER.app/Contents/MacOS/wing-controller-desktop";
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const binary = flag("--binary", DEFAULT_BINARY);
const settleSeconds = Number(flag("--settle", "6"));
const processName = binary.split("/").pop();

const pids = () => {
  try {
    return execFileSync("pgrep", ["-x", processName], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return []; // pgrep exits 1 with no output when nothing matches
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const launch = () => spawn(binary, [], { detached: true, stdio: "ignore" }).unref();

console.log(`single-instance check against ${binary}`);
console.log(`  process name: ${processName}`);

for (const pid of pids()) process.kill(Number(pid), "SIGTERM");
await sleep(2000);
if (pids().length > 0) {
  console.error(`  a previous instance is still running (${pids().join(", ")}): close it and run this again`);
  process.exit(2);
}

launch();
await sleep(settleSeconds * 1000);
const afterFirst = pids();
console.log(`  after the first launch:  ${afterFirst.length} process(es) ${JSON.stringify(afterFirst)}`);

launch();
await sleep(settleSeconds * 1000);
const afterSecond = pids();
console.log(`  after the second launch: ${afterSecond.length} process(es) ${JSON.stringify(afterSecond)}`);

for (const pid of afterSecond) process.kill(Number(pid), "SIGTERM");
await sleep(1500);
for (const pid of pids()) process.kill(Number(pid), "SIGKILL");

const ok =
  afterFirst.length === 1 &&
  afterSecond.length === 1 &&
  afterSecond[0] === afterFirst[0];
if (!ok) {
  console.error(
    `FAIL: a second launch must exit and leave the first instance running ` +
      `(first: ${JSON.stringify(afterFirst)}, second: ${JSON.stringify(afterSecond)})`,
  );
  process.exit(1);
}
console.log(`  one instance only, and it is the first one (pid ${afterFirst[0]})`);
console.log("single-instance contract passed");
