#!/usr/bin/env node
// Binary shield audit — the measurement half of the protection work (2026-10-09).
//
// This script answers one question about a built binary: **does it still carry information it should not?**
// It is deliberately a measurement and not a review of the source, because the defects it hunts are all
// invisible in the source and obvious in the artefact:
//
//   * the default release profile left 12,254 of this project's own symbols in `target/release/
//     wing-controller-desktop` (measured 2026-10-08, 15.6 MB, arm64) — demangled names such as
//     `install_persisted_timecode_cues` and `meter_descriptors_for_target_for_models`. `nm` read the whole
//     architecture of the application out of a shipped copy;
//   * Tauri's `EmbeddedAssets` stored every file of `desktop/ui` brotli-compressed, so the entire interface
//     came back out of the binary with one call to a decompressor.
//
// Everything below is checked against the bytes of the binary rather than through `strings`, which
// silently drops any run shorter than its minimum or containing a byte it dislikes. A reader that truncates
// its own evidence and concludes from the truncation is the mistake this repository keeps writing down.
//
// WHAT EACH CHECK CAN AND CANNOT SEE — measured on both states, not assumed
//
//   * `readable excerpts` finds **0 on both**. Brotli did its job on the old binary, so this check alone
//     would have called the unshielded build clean. It is kept because it is the only check that would
//     catch a future build that embeds the interface verbatim, and it is *not* relied on.
//   * `asset-key names` is the check that catches compression: a brotli asset map still carries its keys in
//     the clear. 16 of 18 were readable in the old binary; 2 are readable now (`/index.html`, `/icon.png`)
//     and **both are explained by our own sources** — `/icon.png` is inside `tauri.conf.json`'s
//     `icons/icon.png`, and `/index.html` is Tauri's own default entry point. A name is only a finding when
//     it appears in the binary and nowhere in this project's Rust or config, which is the shape the asset
//     map produces and nothing else does. Without that distinction this check reported five defects where
//     there were none — and an audit that cries wolf is worse than no audit.
//   * `crate symbols` counts **symbol-table entries** through `nm`: 0 now, thousands before. This is the
//     check with teeth for the strip decision, and it has no false-positive mode.
//   * `crate-name strings` counts raw occurrences of the crate name and is mostly diagnostic: the stripped
//     binary still holds **5**, four of which are `std::any::type_name` strings in panic messages
//     (`wing_controller_desktop::BackendState`, `::LiveSafetyState`, `::InterAppOscState`,
//     `::InterAppMidiState`) and one the cargo metadata hash. Removing those would mean `panic = "abort"`,
//     which was rejected on stability grounds (docs/BINARY_PROTECTION_PLAN_2026-10-09.md, D1), so they are
//     reported rather than treated as zero. The threshold below sits between the two measured states.
//
// It is called by `desktop/build-dist.sh` right after the bundle is assembled, so a leaking build cannot be
// packaged; it is not part of `scripts/verify-all.sh`, because the gate must stay runnable on a tree with no
// release binary in it (see `scripts/test-desktop-binary-shield.mjs` for the contract that always runs).
//
// Usage: node scripts/audit-binary-shield.mjs [path-to-binary]
// Exit:  0 the binary is clean, 1 it leaks, 2 the audit could not be run.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHIELD_MAGIC = Buffer.from("WCVLT1\0\0", "latin1");
const EXCERPT_LENGTH = 64;
const EXCERPTS_PER_FILE = 8;
const CRATE_MARKERS = ["wing_controller_desktop", "wing_runtime", "wing_core", "wing_transport"];
// The two measured states are 5 (stripped) and 11,000 (unstripped); the threshold sits between them so it
// can only fire on a binary that stopped being stripped, never on the `type_name` residue.
const CRATE_NAME_STRING_LIMIT = 100;

const binary = process.argv[2] ?? join(ROOT, "target/release/wing-controller-desktop");

function fail(message) {
  console.error(`audit-binary-shield: ${message}`);
  process.exit(1);
}

function cannotRun(message) {
  console.error(`audit-binary-shield: COULD NOT RUN — ${message}`);
  process.exit(2);
}

if (!existsSync(binary)) {
  cannotRun(`there is no binary at ${binary}. Build one first: cargo build --release -p wing-controller-desktop`);
}

const bytes = readFileSync(binary);
const findings = [];

// ---------------------------------------------------------------------------
// 1. The symbol table, through `nm`. A stripped binary keeps no entry for this project's code.
// ---------------------------------------------------------------------------
let nmSymbols = null;
let nmLines = [];
// The buffer is deliberately large: an unstripped binary of this size prints over 30,000 symbols, and the
// default 1 MB limit makes `spawnSync` fail with ENOBUFS — which is to say it would report "could not
// measure" in exactly the case the measurement exists for.
const nm = spawnSync("nm", ["-a", binary], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (nm.error || nm.status === null) {
  nmSymbols = "nm is unavailable";
} else {
  const output = `${nm.stdout ?? ""}\n${nm.stderr ?? ""}`;
  nmLines = output.split("\n").filter((line) => line.trim() !== "");
  nmSymbols = /no symbols/i.test(output) ? 0 : nmLines.length;
}

const symbolsOfOurs = nmLines.filter((line) => CRATE_MARKERS.some((marker) => line.includes(marker)));
if (symbolsOfOurs.length > 0) {
  findings.push(
    `the symbol table still holds ${symbolsOfOurs.length} entr(ies) naming this project's crates, e.g. ` +
      `\`${symbolsOfOurs[0].trim().split(/\s+/).pop()}\`. The release profile must strip symbols ` +
      `(Cargo.toml, [profile.release]).`,
  );
}

// Raw occurrences of the crate name — diagnostic, with a limit far above the measured stripped state.
let crateNameStrings = 0;
for (const marker of CRATE_MARKERS) {
  let at = bytes.indexOf(marker, 0);
  while (at !== -1) {
    crateNameStrings += 1;
    at = bytes.indexOf(marker, at + 1);
  }
}
if (crateNameStrings > CRATE_NAME_STRING_LIMIT) {
  findings.push(
    `the crate name appears ${crateNameStrings} times in the binary, far above the ${CRATE_NAME_STRING_LIMIT} ` +
      `an ordinarily stripped build produces (measured: 5 stripped, 11,000 unstripped).`,
  );
}

// ---------------------------------------------------------------------------
// 1b. Build-machine paths. rustc records the path of every source file that can panic, and cargo compiles
//     dependencies from the absolute path of the registry copy — so an unsanitised build ships the builder's
//     own home directory to every customer. Measured on this tree before `scripts/build-paths.sh` existed,
//     2026-10-09: 261 strings containing `/Users/<account>`, which named the account the build ran under.
// ---------------------------------------------------------------------------
const machinePaths = [];
for (const pattern of ["/Users/", "/home/"]) {
  let count = 0;
  let at = bytes.indexOf(pattern, 0);
  while (at !== -1) {
    count += 1;
    at = bytes.indexOf(pattern, at + 1);
  }
  if (count > 0) machinePaths.push({ pattern, count });
}
if (machinePaths.length > 0) {
  findings.push(
    `the binary carries ${machinePaths.reduce((total, found) => total + found.count, 0)} build-machine ` +
      `path(s) (${machinePaths.map((found) => `${found.count} x \`${found.pattern}\``).join(", ")}), which ` +
      `names the account the build ran under. The build has to sanitise them: source ` +
      `scripts/build-paths.sh before cargo, as desktop/build-dist.sh step 0.2 does.`,
  );
}

// The *toolchain's* own standard-library paths are a compiler fingerprint, not a personal one, and a
// precompiled std keeps them whatever this project passes to rustc (Homebrew's Rust carries its Cellar
// path; a rustup toolchain already normalises them to `/rustc/<commit>`). Counted and reported rather
// than failed, because failing here would block every release over a path the project cannot reach.
let toolchainPaths = 0;
for (const pattern of ["/opt/homebrew/", "/usr/local/Homebrew/", "/Cellar/"]) {
  let at = bytes.indexOf(pattern, 0);
  while (at !== -1) {
    toolchainPaths += 1;
    at = bytes.indexOf(pattern, at + 1);
  }
}

// ---------------------------------------------------------------------------
// 2. The interface. Every readable piece of `desktop/ui` must be gone, and the file names with it — unless
//    the name is one this project's own sources legitimately carry.
// ---------------------------------------------------------------------------
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/** Everything in the Rust sources and the Tauri config that could legitimately name an interface file. */
function sourceText() {
  const parts = [];
  for (const dir of [join(ROOT, "desktop/src-tauri/src"), join(ROOT, "desktop/src-tauri")]) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".rs") && !name.endsWith(".json")) continue;
      try {
        parts.push(readFileSync(join(dir, name), "utf8"));
      } catch {
        // a directory entry that is not a readable file is not a reason to stop measuring
      }
    }
  }
  return parts.join("\n");
}

/** Evenly spaced 64-byte windows that are pure printable ASCII, so a match is unambiguous. */
function excerptsOf(file) {
  const content = readFileSync(file);
  const printable = (slice) => slice.length === EXCERPT_LENGTH && slice.every((byte) => byte >= 0x20 && byte <= 0x7e);
  const steps = Math.max(1, Math.floor(content.length / EXCERPTS_PER_FILE));
  const excerpts = [];
  for (let offset = 0; offset + EXCERPT_LENGTH <= content.length; offset += steps) {
    const slice = content.subarray(offset, offset + EXCERPT_LENGTH);
    if (printable(slice)) excerpts.push({ offset, slice });
    if (excerpts.length >= EXCERPTS_PER_FILE) break;
  }
  return excerpts;
}

const uiDir = join(ROOT, "desktop/ui");
const uiFiles = walk(uiDir);
if (uiFiles.length === 0) cannotRun(`${uiDir} holds no interface files, so there is nothing to look for`);

const sources = sourceText();
const leakedFiles = [];
const unexplainedNames = [];
const explainedNames = [];
for (const file of uiFiles) {
  const name = relative(uiDir, file).split(sep).join("/");
  // The asset-key form, `/name`, not a bare substring: a bare `icon.png` also matches `icons/icon.png` in
  // the bundle's own icon list, and that false positive is exactly what this shape removes.
  const assetKey = Buffer.from(`/${name}`, "utf8");
  if (bytes.includes(assetKey)) {
    // Explained either by the asset-key form (`icons/icon.png` in the bundle config covers `/icon.png`) or by
    // a quoted window URL (`WebviewUrl::App("guide.html")`), which is how this application opens its windows.
    if (sources.includes(`/${name}`) || sources.includes(`"${name}"`)) explainedNames.push(name);
    else unexplainedNames.push(name);
  }
  const leaked = excerptsOf(file).filter((excerpt) => bytes.includes(excerpt.slice));
  if (leaked.length > 0) leakedFiles.push({ name, leaked: leaked.length, first: leaked[0] });
}

if (unexplainedNames.length > 0) {
  findings.push(
    `the binary carries interface file names that no source of this project mentions ` +
      `(${unexplainedNames.slice(0, 8).join(", ")}${unexplainedNames.length > 8 ? ", …" : ""}). That is the ` +
      `shape of a Tauri asset map, which stores its keys in the clear. Check that main.rs still passes ` +
      `\`assets = ui_vault::UiVault\` to \`generate_context!\`.`,
  );
}
if (leakedFiles.length > 0) {
  findings.push(
    `the binary carries readable excerpts of ${leakedFiles.length} interface file(s): ` +
      leakedFiles
        .map((file) => `${file.name} (${file.leaked} excerpt(s), first at byte ${file.first.offset})`)
        .join(", ") +
      `. The interface must travel encrypted (scripts/build-ui-vault.mjs), not compressed.`,
  );
}

// ---------------------------------------------------------------------------
// 3. The shield must actually be present. Absence is a different defect from leakage and is named as one.
// ---------------------------------------------------------------------------
if (!bytes.includes(SHIELD_MAGIC)) {
  findings.push(
    "the binary holds no interface vault (the WCVLT1 magic is absent). The window would either fail to " +
      "load or be served by a provider other than the shield.",
  );
}

// ---------------------------------------------------------------------------
// Report. Every number here is printed so the next reader can compare it with the previous run instead of
// trusting a summary.
// ---------------------------------------------------------------------------
const shownPath = binary.startsWith(ROOT) ? relative(ROOT, binary) : binary;
console.log(`audit-binary-shield: ${shownPath} (${(bytes.length / 1048576).toFixed(1)} MB)`);
console.log(`  interface files checked : ${uiFiles.length}`);
console.log(`  readable excerpts found : ${leakedFiles.reduce((total, file) => total + file.leaked, 0)}`);
console.log(
  `  unexplained file names  : ${unexplainedNames.length}` +
    (explainedNames.length > 0 ? ` (${explainedNames.length} more are named by our own sources: ${explainedNames.join(", ")})` : ""),
);
console.log(`  crate symbols in nm     : ${symbolsOfOurs.length}`);
console.log(`  crate-name strings      : ${crateNameStrings} (limit ${CRATE_NAME_STRING_LIMIT})`);
console.log(`  build-machine paths     : ${machinePaths.reduce((total, found) => total + found.count, 0)}`);
console.log(`  toolchain paths (std)   : ${toolchainPaths} (the compiler's own; not removable from outside it)`);
console.log(
  `  symbol table (nm)       : ${
    nmSymbols === 0
      ? "stripped"
      : nmSymbols === "nm is unavailable"
        ? "nm is unavailable"
        : `${nmSymbols} entries, ${symbolsOfOurs.length} of them ours`
  }`,
);
console.log(`  vault present           : ${bytes.includes(SHIELD_MAGIC) ? "yes" : "NO"}`);

if (findings.length > 0) {
  console.error("");
  for (const finding of findings) console.error(`audit-binary-shield: FAIL — ${finding}`);
  process.exit(1);
}
console.log("audit-binary-shield: OK — no symbol of this project, no readable interface, the vault present");
