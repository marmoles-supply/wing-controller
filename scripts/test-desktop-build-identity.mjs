// The build must not ship its builder (2026-10-09).
//
// WHY THIS EXISTS
//
// rustc records the path of every source file in two places that end up inside a shipped binary: debug
// information, and the location string attached to anything that can panic. Cargo compiles dependencies from
// the **absolute** path of the registry copy, so those strings carry whatever the build machine's home
// directory is called. Measured on `target/release/wing-controller-desktop` before this contract existed,
// 2026-10-09: **261 strings containing the account name**, most of them registry source paths, plus
// `/Users/<account>/DEVELOPIN/wing-controller/desktop/src-tauri…` from this project. `strings` on the
// shipped application told a reader the account the build ran under and where the project lived — a
// fingerprint of the builder, handed to every customer.
//
// The bundle identifier was the second one: `com.<account>.wingcontroller.desktop` carried the same account
// name in `Info.plist` and, because the identifier is part of the code requirement, in the signature macOS
// checks. It is now `com.wingcontroller.desktop` (the owner's decision, 2026-10-09; the app's data folder is
// a literal `Wing Controller Desktop`, not identifier-derived, so nothing of the operator's moved — but the
// code identity changed, so macOS asks once more for the microphone).
//
// The third was quieter: 130 build artefacts under `crates/wing-core/target/` were **tracked**, and their
// dep-info files carry absolute build paths. The root `.gitignore` rule `/target/` does not cover a member
// crate. They are untracked and ignored now.
//
// WHAT THIS CHECKS, and it is deliberately about the *class* of place rather than the three instances
// above: no file this project builds from or runs may contain a literal home directory, the build must
// sanitise compiler paths before it compiles, the code identity must not be the builder's account, and
// build output must not be tracked. A guard that named only the three files that happened to be wrong is a
// guard that would miss the fourth (AGENTS.md, "A Guard Shaped By The Defect Will Miss Its Sibling").
//
// What it cannot check is the compiled binary: a precompiled standard library keeps its own toolchain
// paths whatever this project passes to rustc. `scripts/audit-binary-shield.mjs` measures that in the
// artefact, and `desktop/build-dist.sh` runs it.
//
// Run: node scripts/test-desktop-build-identity.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SANITISER = `${ROOT}scripts/build-paths.sh`;
const BUILD = `${ROOT}desktop/build-dist.sh`;
const CONFIG = `${ROOT}desktop/src-tauri/tauri.conf.json`;

// Directories that are not this project's own source: historical release snapshots record what was true on
// their date and must not be rewritten, and the parked Android application is a separate decision.
const SKIP_DIRECTORIES = new Set([
  ".git", "node_modules", "target", "dist", "releases", "android", ".expo", "design/package",
]);
// File kinds that are built from or executed. A prose document may quote a path shape; a script may not.
const SOURCE_EXTENSIONS = [".mjs", ".js", ".sh", ".rs", ".toml", ".json", ".plist", ".html", ".css", ".kt"];

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(ROOT, path);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name) || SKIP_DIRECTORIES.has(rel)) continue;
      walk(path, found);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 1. No file this project builds from or runs names a real home directory.
//
//    Three shapes are accepted, and each one is a declaration rather than a leak, so each is listed with
//    its reason and printed by name on the way out — the same discipline the design kit asks of a declared
//    deviation. Every other occurrence is a machine's actual account name and fails.
// ---------------------------------------------------------------------------
const ACCEPTED_HOME_PATHS = [
  { prefix: "/Users/<", reason: "the placeholder in the comments that describe this defect" },
  { prefix: "/home/<", reason: "the same placeholder for a Linux description" },
  { prefix: "/Users/operator", reason: "the neutral fixture account in the station-backup suite" },
  { prefix: "/home/operator", reason: "the same fixture, spelled for the other platform" },
  { prefix: "/home/Applications", reason: "$sandbox/home/Applications in verify-install.sh, built from a temp dir" },
];
const accepted = new Map();
const offenders = [];
for (const path of walk(ROOT)) {
  const text = readFileSync(path, "utf8");
  text.split("\n").forEach((line, index) => {
    for (const [match] of line.matchAll(/\/(?:Users|home)\/[A-Za-z0-9._-]+/g)) {
      const allowed = ACCEPTED_HOME_PATHS.find((entry) => match.startsWith(entry.prefix));
      if (allowed) {
        accepted.set(allowed.prefix, (accepted.get(allowed.prefix) ?? 0) + 1);
        continue;
      }
      offenders.push(`${relative(ROOT, path)}:${index + 1}  ${match}`);
    }
  });
}
assert.deepEqual(
  offenders,
  [],
  `no source file may carry a build machine's home directory, found:\n  ${offenders.join("\n  ")}`,
);

// ---------------------------------------------------------------------------
// 2. The build sanitises the compiler's paths, and it does so before it compiles anything.
// ---------------------------------------------------------------------------
assert.ok(existsSync(SANITISER), "scripts/build-paths.sh must exist: it is what stops the binary naming its builder");
const buildSource = readFileSync(BUILD, "utf8");
const buildLines = buildSource.split("\n");
const sourceLine = buildLines.findIndex((line) => /^\s*\.\s+"\$ROOT_DIR\/scripts\/build-paths\.sh"/.test(line));
assert.notEqual(sourceLine, -1, "desktop/build-dist.sh must source scripts/build-paths.sh");
const callLine = buildLines.findIndex((line) => line.includes("wing_export_sanitised_build_paths"));
assert.notEqual(callLine, -1, "desktop/build-dist.sh must call wing_export_sanitised_build_paths");
const firstCargo = buildLines.findIndex((line) => /^\s*cargo build/.test(line));
assert.notEqual(firstCargo, -1, "desktop/build-dist.sh must build with cargo");
assert.ok(
  sourceLine < firstCargo && callLine < firstCargo,
  `the sanitised flags have to be exported before the first cargo build (source at line ${sourceLine + 1}, ` +
    `export at ${callLine + 1}, cargo at ${firstCargo + 1}) — after it, the binary keeps the paths`,
);

// ---------------------------------------------------------------------------
// 3. The sanitiser reads its prefixes from the environment. A literal machine path in it would be the same
//    defect it exists to remove, and would also only work on one machine.
// ---------------------------------------------------------------------------
const sanitiserSource = readFileSync(SANITISER, "utf8");
assert.match(sanitiserSource, /\$\{HOME:-\}/, "the sanitiser must take the home prefix from $HOME");
assert.match(sanitiserSource, /BASH_SOURCE/, "the sanitiser must locate the repository from its own path");
assert.match(
  sanitiserSource,
  /CARGO_ENCODED_RUSTFLAGS/,
  "the sanitiser must use the encoded variable: RUSTFLAGS is split on whitespace, so a home directory with " +
    "a space in it would silently mangle the flags",
);
execFileSync("bash", ["-n", SANITISER], { stdio: "pipe" });

// ---------------------------------------------------------------------------
// 4. The code identity is the product's, not the builder's account.
//
//    This is pinned rather than pattern-matched on purpose: the identifier is part of the code requirement
//    macOS checks for the microphone grant, so changing it is a decision with a consequence at the desk,
//    and it should be a red test rather than a quiet edit.
// ---------------------------------------------------------------------------
const identifier = JSON.parse(readFileSync(CONFIG, "utf8"))?.identifier;
assert.equal(
  identifier,
  "com.wingcontroller.desktop",
  "the bundle identifier must not carry the build machine's account name; if it changes, macOS will ask " +
    "for the microphone again — change this line in the same commit that changes tauri.conf.json",
);

// ---------------------------------------------------------------------------
// 5. Build output must not be tracked. A `.gitignore` rule that does not cover a member crate is how 130
//    artefacts carrying absolute build paths were committed once already.
// ---------------------------------------------------------------------------
let tracked;
try {
  tracked = execFileSync("git", ["ls-files", "crates/*/target/*", ".claude/*"], { cwd: ROOT, encoding: "utf8" });
} catch (error) {
  assert.fail(`could not ask git what is tracked, so nothing was measured: ${error.message}`);
}
assert.equal(
  tracked.trim(),
  "",
  `these are build or tool outputs and must not be tracked:\n  ${tracked.trim().split("\n").join("\n  ")}`,
);
const ignore = readFileSync(`${ROOT}.gitignore`, "utf8");
for (const rule of ["crates/*/target/", ".claude/"]) {
  assert.ok(ignore.includes(rule), `.gitignore must ignore ${rule}`);
}

// ---------------------------------------------------------------------------
// 6. Nothing that ships may carry a console's identity.
//
//    The owner's rule is one invariant — *"mientras esas huellas no se metan en la app, todo bien"*
//    (2026-10-09) — and until this section existed it was enforced in exactly one place: the window hints,
//    by `scripts/test-desktop-fallback-catalogue.mjs`. That guard walks the fallback catalogue's hints, and
//    it does not read `CHANGELOG.md`, the release notes, the text `desktop/build-dist.sh` writes into the
//    DMG, or the **comments** in the interface. Measured on 2026-10-09, one real unit identity was sitting
//    in the last of those: `desktop/ui/index.html` carried `WING Rack` inside a comment beside the
//    channel-pretap row, in a file that is served to every window and encrypted into every build.
//
//    A **model family** is not an identity and is explicitly allowed (`AGENTS.md`, "No Console Identity In
//    User-Visible Text", point 2): `wing-rack` and `wing-compact` are discovery tokens this application
//    parses, and they stay. What is checked for is the shape of a *unit* — `WING-<FAMILY>-<SERIAL>`, three
//    upper-case parts. Everything the build ships is read, and the count of files is printed so a run that
//    measured nothing cannot look like a run that measured something clean.
// ---------------------------------------------------------------------------
// Every file the build ships, each with the reason it is here. The list comes from `desktop/build-dist.sh`'s
// own `cp` and `write_unblock_helper` calls.
const shipped = [
  { path: "CHANGELOG.md", why: "copied into the DMG and the ZIP, and the operator reads it" },
  { path: "desktop/build-dist.sh", why: "its guide text and the unblock helper it writes ship as files" },
  { path: "scripts/set-custom-icon.sh", why: "copied into the DMG and the ZIP as set-custom-icon.sh" },
  { path: "desktop/src-tauri/Info.plist", why: "merged into the bundle's Info.plist of every installed copy" },
];
for (const name of readdirSync(`${ROOT}desktop/release-notes`)) {
  if (name.endsWith(".md")) {
    shipped.push({ path: `desktop/release-notes/${name}`, why: "shipped beside the application as its release note" });
  }
}
for (const path of walk(`${ROOT}desktop/ui`)) {
  shipped.push({ path: relative(ROOT, path), why: "served to the windows and encrypted into every build" });
}

const UNIT_IDENTITY = /\bWING-[A-Z0-9]+-[A-Z0-9]{3,}\b/g;
const identityOffenders = [];
let identityFilesRead = 0;
for (const { path: rel, why } of shipped) {
  const full = join(ROOT, rel);
  // A file that ships and cannot be read is a defect in this check, not a reason to skip it: silently
  // continuing is how a run that measured nothing comes to look like a run that measured something clean.
  assert.ok(existsSync(full), `${rel} ships (${why}) but is not there, so this check cannot read it`);
  identityFilesRead += 1;
  readFileSync(full, "utf8")
    .split("\n")
    .forEach((line, index) => {
      for (const [match] of line.matchAll(UNIT_IDENTITY)) identityOffenders.push(`${rel}:${index + 1}  ${match}`);
    });
}
assert.deepEqual(
  identityOffenders,
  [],
  "a console's own identity must not reach anything the build ships — the model family and the firmware " +
    "are what a code comment carries (AGENTS.md, point 2). Found:\n  " +
    identityOffenders.join("\n  "),
);
assert.ok(
  identityFilesRead > 20,
  `only ${identityFilesRead} shipped files were read; this check is supposed to walk the interface, the ` +
    `changelog, every release note and the build script`,
);

const acceptedList = [...accepted.entries()]
  .map(([prefix, count]) => `${prefix} x${count} (${ACCEPTED_HOME_PATHS.find((entry) => entry.prefix === prefix).reason})`)
  .join(", ");
console.log(
  `build identity contract passed: ${walk(ROOT).length} source files carry no home directory` +
    (acceptedList ? `; accepted by name: ${acceptedList}` : "") +
    `; paths are sanitised before cargo; the identifier is ${identifier}; no build output is tracked; ` +
    `${identityFilesRead} shipped files carry no console identity`,
);
