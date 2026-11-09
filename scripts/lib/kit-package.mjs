// The design kit as a **versioned artefact another repository can take**: which files travel, how they are copied,
// how the copy is proved byte-for-byte, and how a stale copy becomes a red test rather than a silent divergence.
//
// The shape of the artefact is a **directory of files, committed, plus a tarball built from it on demand**, and each
// half has a reason that the other cannot serve:
//
//   * The **directory** (`design/package/`) is what git can carry and what a byte-equality test can judge. A tarball
//     cannot be committed usefully: it is opaque to `git diff`, and every regeneration rewrites the whole blob, so a
//     one-line token change would arrive as a 90 KB binary diff with no reviewable content. Committing *this* is what
//     lets `scripts/test-design-kit-package.mjs` assert, on every gate run, that the artefact's copy of every file is
//     byte-identical to its source.
//   * The **tarball** (`design/dist/wing-controller-design-<version>.tar.gz`) is what a sibling repository takes
//     without cloning this one, and it is **built from the directory**, not from the sources, so the two cannot
//     disagree. It is deliberately not committed and not tracked: `design/dist/` is ignored, exactly like every other
//     build output in this repository, and `--check` regenerates it in memory and compares bytes to prove the writer
//     is deterministic.
//
// Why "generated, not assembled by hand" is enforced rather than promised: the copy is a raw `readFileSync`/
// `writeFileSync` of each source's bytes, and the only file whose content is composed is `MANIFEST.sha256`, which is
// itself derived from those bytes. There is no path through this module by which a human's edit to the artefact could
// survive a regeneration unnoticed: `collectPackage()` writes the sources over it, and `packageProblems()` compares
// the committed bytes against the sources before the test can pass.
//
// What travels, and what does not. The list is the minimum `design/SHARING_THE_KIT.md` names — `tokens.json` (the one
// hand-edited source), the generated `tokens.css`, the hand-written `components.css` (the drawings, so a consumer
// links a control instead of retyping it), `layout.css` and `layout.html` (the plan, so a consumer composes a window
// instead of guessing at one), `VERSION`, `UI_SYSTEM.md` and the conformance runner — plus the
// two files that make the kit usable rather than merely readable: the generated native form (`WingTheme.swift`,
// `scripts/generate-design-tokens-swift.mjs`) and the agent brief. `adopt/` travels for the same reason one step
// further on: the kit's advice ("declare what you took, run the judge") is prose a stranger can forget, so the
// directory carries the block to paste into a consumer's own `AGENTS.md`, the declaration template and the gate
// wiring — the mechanism that makes adoption persist, not a pointer to it. The exclusions are as deliberate as the
// inclusions, and `packageProblems()` proves each one is still excluded:
//
//   * `conformance/run.json` is the record of the kit's own last run — per-consumer state, and it stays out. So does
//     the **source** file `design/conformance/allow.mjs`, which is this repository's own 41 KB declaration for its
//     five windows (52 deviations): a byte copy of it would put this repository's findings in a sibling's report
//     under a name that is not theirs.
//   * `conformance/allow.mjs` **is** in the artefact, **composed rather than copied** (D11, 2026-10-08, kit 1.4.2).
//     Until 1.4.2 the artefact shipped `adopt/allow.mjs.example` and not the file `conformance/run.mjs` reads by
//     default, so a consumer's first documented command exited 3 with *"the app allowance file does not exist"* and
//     measured nothing — measured in a fresh unpack of the 1.4.1 tarball. What ships is the kit's own declaration of
//     the one page the tarball owns: the reference window, which reports `CONFORMANCE OK · 0 failures`, with
//     `deviations: []` and `kitVersion` read from `VERSION` so it cannot be left behind by a half-done re-copy.
//     That content is not what the source file of the same name holds, which is why it is a **third composed entry**
//     beside `KIT_VERSION` and `MANIFEST.sha256` rather than one more line in `PACKAGE_FILES`.
//   * `conformance/self-test.mjs` **and its `fixtures/` travel**, added 2026-10-08 with kit 1.4.1. They were excluded
//     as "the suite's own tests", while the artefact's own `conformance/README.md` told the consumer to run them: *"The
//     proof that the suite can fail: `node design/conformance/self-test.mjs`"*. **A document that instructs a consumer to
//     run a file the artefact does not contain is the same defect as a step that cannot be followed**, and the fixtures
//     are the strongest thing this suite has: pages that must go red, proving the judge can fail on the consumer's own
//     copy. They ship because they can — `self-test.mjs` imports only `./collect.mjs` and `./run.mjs` (both in the
//     artefact), writes its allowance into a `/tmp` directory, and the fixtures link `../../tokens.css`, which resolves
//     inside the artefact exactly as it does here.
//   * `specimen.html` **is** in the artefact, added 2026-10-08 with kit 1.4.1. It was excluded as "the visual reference
//     ... named in `README.md` and `AGENT_BRIEF.md` with its canonical location instead: a document has one home". That
//     reasoning had it backwards for a distributable: `README.md`, `AGENT_BRIEF.md` and `UI_SYSTEM.md` **all** send a
//     consumer to `design/specimen.html`, and the artefact carried four PNGs *of* the page — so a consumer received
//     pictures of a document it could not open. It needs no rewrite where it lands: it links `tokens.css` and
//     `components.css` by a path relative to `design/`, which is the shape the artefact mirrors.
//   * `reference/` **is** in the artefact, added 2026-10-08. A pointer to the specimen was not enough: measured, a
//     consumer replaced the kit's whole type scale, passed the suite with **0 failures in both themes** and looked
//     nothing like the specimen (`DESIGN-SYSTEM-ROADMAP.md` §4j). The judge decides whether a page obeys the rules,
//     not whether it looks like the kit, and the one artefact that answers the second question for an agent with no
//     screen is the captioned images — so they travel. That is true of the **directory** as well as the tarball,
//     because the byte-equality test compares them like every other file: a tarball-only copy would either break that
//     invariant or need `packageProblems()` to except a path, which is the beginning of an artefact nobody can judge.
//   * `reference-window/` **is** in the artefact, added 2026-10-08 with kit 1.4.1. The defect was a broken step rather
//     than a missing explanation: `adopt/README.md` step 1 tells a consumer to fork the kit's reference window, and the
//     artefact did not carry the directory, so the instruction could only be followed by somebody who already had this
//     repository. `index.html` is the window and `PLAN.md` is its region map — the keep/delete annotation R3 carries
//     nowhere else — and both travel for the reason `reference/` does: an artefact a consumer composes from, not a
//     pointer beside it.
//
// This module is read-only with respect to the tree: nothing here writes a file. The writer is
// `scripts/package-design-kit.mjs`.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readTar, writeTarGz } from './tar.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/// The repository this kit lives in — exported so a caller can print a path relative to it rather than an absolute
/// one, which is what makes the command's own output readable in a session log.
export const REPOSITORY_ROOT = REPO;
export const DESIGN_DIR = join(REPO, 'design');
/// Where the committed artefact lives. A directory, not a file, so git can diff it.
export const PACKAGE_DIR = join(DESIGN_DIR, 'package');
/// Where the untracked distributable lands. Any name that means "build output" would do; this one is also the name
/// `design/package/COMPOSITION.md` points a consumer at.
export const DIST_DIR = join(DESIGN_DIR, 'dist');
/// The tarball's basename, without the version.
export const TARBALL_STEM = 'wing-controller-design';
/// The manifest, inside the artefact. Every path in it is relative to the artefact's root.
export const MANIFEST_NAME = 'MANIFEST.sha256';
/// The marker a consumer can read for the version. `VERSION` is the kit's real authority (roadmap §4 ITEM 1) and is
/// copied verbatim; this file exists so a consumer that looks for a self-describing marker in an unpacked tarball
/// finds one, and so the version cannot be guessed from a filename.
export const KIT_VERSION_NAME = 'KIT_VERSION';

/// The allowance the artefact ships: the declaration `conformance/run.mjs` reads when it is given no `--allow`. It is
/// **composed** from `VERSION` rather than copied from `design/conformance/allow.mjs`, which is this repository's own
/// declaration and must not travel (D11, 2026-10-08, kit 1.4.2 — see the header).
export const SHIPPED_ALLOWANCE_NAME = 'conformance/allow.mjs';

/// One file that travels: where it comes from in this repository, and where it lands in the artefact.
export const PACKAGE_FILES = [
  'VERSION',
  'tokens.json',
  'tokens.css',
  // The kit's drawings, beside the kit's values (2026-10-08). `tokens.css` is what a consumer links to get the
  // palette; a kit that shipped only that left every consumer writing its own `button` rule, which is how the same
  // control came to be drawn as many times as there were projects — one of them at 16 px against the kit's own
  // drawing because a local rule was later in the cascade. `components.css` is that button, once, and it travels for
  // the same reason `tokens.css` does: a consumer links it rather than retyping it.
  'components.css',
  'workstation.css',
  'surfaces.css',
  'runtime/dropdown.js',
  'runtime/field-editing.js',
  'runtime/dither.js',
  'runtime/vu-draw.js',
  'workstation/catalogue.html',
  'workstation/catalogue.js',
  'workstation/index.html',
  'workstation/interactions.js',
  'workstation/create.mjs',
  'workstation/check.mjs',
  'workstation/README.md',
  'workstation/COVERAGE.md',
  'workstation/reference/workstation-light.png',
  'workstation/reference/workstation-dark.png',
  'workstation/reference/catalogue-light.png',
  'workstation/reference/catalogue-dark.png',
  'workstation/reference/properties-light.png',
  'workstation/reference/properties-dark.png',
  // The kit's PLAN, beside the kit's values and drawings (2026-10-08, kit 1.4.0). `components.css` answered "what is a
  // button"; nothing answered "how is a window put together", and that gap was measured from the consumer's side: a
  // sibling repository linked the component layer, deleted every control rule of its own, passed the judge with 0
  // failures in both themes — and its owner rejected the UI four times, because it was composing the plan by guessing.
  // `layout.css` is the four rules this application composes every window with, and `layout.html` is the composed
  // mockup of them. **Both travel, and `specimen.html` still does not**, and the difference is what each is for:
  // `specimen.html` is the kit showing *itself* (every token and component, for a reader who has no screen), while
  // `layout.html` is the page a consumer is meant to **mount and copy** — and a pointer to this repository's
  // 32,000-line `desktop/ui/index.html` is exactly what the consumer measured as useless. Both files are documents of
  // the plan: `layout.css` is the rules and `layout.html` is the page that composes them.
  'layout.css',
  'layout.html',
  // The kit's REFERENCE WINDOW, the page a consumer forks and deletes from (2026-10-08, kit 1.4.1). `design/adopt/`
  // `README.md` step 1 already sent a consumer here — "start from the kit's reference window (`design/reference-window/`),
  // a complete working window you fork and gut, region by region" — and the artefact did not carry the directory, so
  // **the one step that tells a consumer how to start could not be followed by anyone who took the artefact**. That is
  // the composition layer's own defect one level up: `layout.css` gave the plan and no page composed it, and a file list
  // that omits a directory is a pointer to this repository rather than a thing a consumer can use. `index.html` links
  // the kit's three sheets by a path relative to `design/` (`../tokens.css`, `../components.css`, `../layout.css`),
  // which is exactly the shape the artefact mirrors, so it renders where it lands and needs no rewrite.
  //
  // **`PLAN.md` travels with it, and the choice is deliberate rather than inherited.** Step 1 makes deletion the way the
  // window is used, and the plan is where the region map lives: for each of R1-R6 it states what the region is, which
  // rule of §11 it demonstrates, which state it is in and **what a consumer does with it** — keep, replace, or delete.
  // Measured in the window: it carries those four annotations inline for five of the six regions (R1, R2, R4, R5, R6),
  // and **R3's "keep two, delete the rest" is only in the plan** — so a consumer that receives the window alone is told
  // to gut it while the fold's own keep/delete instruction is missing. The plan also carries the acceptance (the
  // window's definition of done) and the honest limits, which no other file in the artefact states. **The cost is the
  // plan's own history** — its dated corrections, the rejected alternative, the commit it names — and it is paid
  // rather than avoided because the artefact copies files byte for byte and cannot trim one: annotations and history are
  // a single document, and a lost annotation makes deletion guesswork, while the history costs a reader a paragraph it
  // can skip. A 1.4.0 consumer that re-copies is additive-safe: two files joined and nothing was removed.
  'reference-window/index.html',
  'reference-window/PLAN.md',
  'UI_SYSTEM.md',
  'AGENT_BRIEF.md',
  'README.md',
  'CONSUMING.md',
  // The visual reference, and the whole of it. The judge measures rules, not resemblance: a consumer replaced its
  // whole type scale, passed with 0 failures in both themes and looked nothing like the specimen, because nobody had
  // told it to open `design/reference/` and the package did not carry it (`DESIGN-SYSTEM-ROADMAP.md` §4j, D-TYPE-3).
  'reference/README.md',
  'reference/specimen-components-both-themes.png',
  'reference/specimen-colour-tokens-both-themes.png',
  'reference/specimen-instrument-and-type-both-themes.png',
  'reference/specimen-type-and-space-both-themes.png',
  // And the page those four images are pictures **of**. The exclusion used to be the other way round ("a document has
  // one home, and a stale copy of a page is worse than a pointer to the real one"), which was right about a document
  // and wrong about a distributable: three of the artefact's own documents send a consumer to `design/specimen.html`,
  // and shipping the photographs without the page gave a consumer four images it could not open. Both halves travel,
  // because a picture with no page is a pointer in the other direction.
  'specimen.html',
  // The four adoption files, in the order `adopt/README.md` numbers its steps. `CONSUMING.md` sends a reader here
  // first: the kit's advice is a message read once, and these are what survive the agent that received it.
  'adopt/README.md',
  'adopt/AGENTS.snippet.md',
  'adopt/allow.mjs.example',
  'adopt/wire-your-gate.md',
  // And the runnable gate those two documents send a consumer to — `adopt/README.md` step 4 and
  // `adopt/wire-your-gate.md` both name `gate.sh.example` as the thing to copy and run. It was missing from this
  // list, which is the same hole as the missing `allow.mjs` one level up: a document that tells a consumer to run a
  // script the artefact does not carry is a step that cannot be followed (2026-10-08, kit 1.4.2).
  'adopt/gate.sh.example',
  'native/WingTheme.swift',
  'conformance/README.md',
  'conformance/collect.mjs',
  'conformance/report.mjs',
  'conformance/rules.mjs',
  'conformance/run.mjs',
];

/// The conformance directory's JavaScript, discovered rather than written out, so a module added to the runner is
/// either shipped or a red test — never silently absent from a package whose runner then cannot start. `self-test.mjs`
/// is included deliberately: `conformance/README.md` tells a consumer to run it as "the proof that the suite can fail",
/// and a suite that ships the instruction and not the file is the defect this module exists to catch. `allow.mjs` is
/// filtered out of the **discovery** because it is not copied at all: `packageEntries()` composes it
/// (`SHIPPED_ALLOWANCE_NAME`), since the file of that name in `design/` is the kit's own 52-deviation declaration.
function conformanceModules() {
  const dir = join(DESIGN_DIR, 'conformance');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.mjs') && name !== 'allow.mjs')
    .sort()
    .map((name) => `conformance/${name}`);
}

/// Every file under `conformance/fixtures/`, discovered for the same reason the modules are: the self-test names its
/// fixtures one by one, and a fixture that stops travelling turns a `self-test.mjs` that ships into one that cannot run.
/// A flat directory today; walked recursively so a fixture gaining a subdirectory is shipped rather than dropped.
export function conformanceFixtures() {
  const root = join(DESIGN_DIR, 'conformance', 'fixtures');
  const out = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const absolute = join(dir, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (statSync(absolute).isDirectory()) walk(absolute, relativePath);
      else out.push(`conformance/fixtures/${relativePath}`);
    }
  };
  if (existsSync(root)) walk(root, '');
  // Sorted as paths, not only per directory: `listFiles(PACKAGE_DIR)` sorts the artefact's whole listing, and the test
  // compares the two, so a nested fixture set must come out in the same order the on-disk walk produces.
  return out.sort();
}

/// Every path that must be in the artefact, sorted. Sorted because the manifest is compared as bytes and a directory
/// listing's order is not a contract. `SHIPPED_ALLOWANCE_NAME` is in the list even though nothing is read from
/// `design/` for it: `packageEntries()` composes it, and the artefact's file list is what the test compares against
/// the identical list below.
export function packagePaths() {
  return [...new Set([...PACKAGE_FILES, SHIPPED_ALLOWANCE_NAME, ...conformanceModules(), ...conformanceFixtures()])].sort();
}

/// The kit's version, from `design/VERSION` (the authority — `readKitVersion()` in `design/conformance/report.mjs`
/// reads this same file). `design/tokens.json` carries a copy and `MANIFEST.sha256` records it; `packageProblems()`
/// fails when the three disagree, because a version is exactly the kind of value this kit refuses to keep twice.
export function kitVersion() {
  return readFileSync(join(DESIGN_DIR, 'VERSION'), 'utf8').trim();
}

/// The version `design/tokens.json` declares, which is the version the generated CSS and the generated Swift both
/// print in their headers.
export function jsonVersion() {
  return String(JSON.parse(readFileSync(join(DESIGN_DIR, 'tokens.json'), 'utf8')).version).trim();
}

/// The allowance the artefact ships, **composed** — the kit's own declaration of the one page inside the tarball
/// (D11, 2026-10-08, kit 1.4.2). Before 1.4.2 a consumer's first `run.mjs --app <page>` exited 3 with *"the app
/// allowance file does not exist"* and measured nothing, because the tarball shipped the example and not this file.
///
/// `allowApp` is relative to **this file's own directory**, which is what `report.mjs` resolves
/// (`resolve(dirname(allowPath), allowApp)`) and what `design/conformance/README.md` documents — measured, and not
/// what the D11 note first spelled: with the artefact root's `'reference-window/index.html'`, `report.mjs` prints
/// *"allowApp points at reference-window/index.html, which does not exist"*; `'../reference-window/index.html'`
/// resolves. The kit's own `design/conformance/allow.mjs` uses `'../specimen.html'` for the same reason.
export function renderShippedAllowance() {
  return [
    '// The kit\'s own allowance — the declaration `conformance/run.mjs` reads when it is given no `--allow`.',
    '//',
    '// THIS DECLARES THE KIT\'S OWN PAGE, NOT YOURS. It names the reference window that travels inside this artefact',
    '// and no deviations, because that page passes every rule in both themes: it is the kit showing itself, and it is',
    '// the only page the tarball owns. **Replace `allowApp` with your window and declare your own deviations, each',
    '// with its reason** — `adopt/allow.mjs.example` explains every field, and a deviation without a reason is a',
    '// defect, never a mute button.',
    '//',
    '// GENERATED — do not edit. Written at pack time by `scripts/lib/kit-package.mjs` from the `VERSION` file beside',
    '// this one, so the number below cannot be left behind by a half-done re-copy: a declaration that disagrees with',
    '// the kit it stands in is a failure `run.mjs` reports before it measures anything.',
    'export default {',
    `  kitVersion: '${kitVersion()}',`,
    '  // What the drift dashboard calls this row. It is the kit\'s own page, so it says so.',
    '  app: \'Wing Controller reference window\',',
    '  // The window this declaration is about, relative to THIS FILE\'s directory (`conformance/`) — which is how',
    '  // `report.mjs` resolves it. Replace with your page.',
    '  allowApp: \'../reference-window/index.html\',',
    '  // The kit\'s reference window passes every rule in both themes. A deviation invented here would be a mute',
    '  // button in a kit whose whole argument is that one is a decision with a reason.',
    '  deviations: [],',
    '};',
    '',
  ].join('\n');
}

/// The artefact's content as `{ path, body }`, where `body` is a **Buffer of the source's own bytes**. This is the
/// whole copy step: no reformatting, no header inserted, no line endings touched. Byte-identity is therefore not
/// something this module achieves by care — it is the only thing it can do. The three composed entries
/// (`SHIPPED_ALLOWANCE_NAME`, `KIT_VERSION`, `MANIFEST.sha256`) are the deliberate exceptions, and a test comparing
/// the artefact against `design/` cannot confuse them with copies because `packageProblems()` names them as composed.
export function packageEntries() {
  const entries = packagePaths()
    .filter((path) => path !== SHIPPED_ALLOWANCE_NAME)
    .map((path) => ({
      path,
      body: readFileSync(join(DESIGN_DIR, path)),
    }));
  entries.push({ path: KIT_VERSION_NAME, body: Buffer.from(`${kitVersion()}\n`, 'utf8') });
  entries.push({ path: SHIPPED_ALLOWANCE_NAME, body: Buffer.from(renderShippedAllowance(), 'utf8') });
  entries.push({ path: MANIFEST_NAME, body: Buffer.from(renderManifest(entries), 'utf8') });
  // Sorted, because the artefact's file list is a contract: the tarball sorts its entries and `--check` compares lists,
  // and an artefact whose on-disk order came from the order of this array would make a diff of two versions depend on
  // how the array happened to be written.
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

/// The manifest: one `sha256<TWO SPACES>path` line per file, in path order, with a short header that says what the
/// file is, which version it describes and how it is reproduced. The header is prose and the lines below it are the
/// contract; the same `sha256sum -c` reading a reader may already know works on the body.
export function renderManifest(entries) {
  const lines = [...entries]
    .filter((entry) => entry.path !== MANIFEST_NAME)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${sha256(entry.body)}  ${entry.path}`);
  return [
    `# ${TARBALL_STEM} — manifest of the files that travel. Version ${kitVersion()}.`,
    '#',
    '# GENERATED FILE — do not edit. Written by `scripts/package-design-kit.mjs`; `scripts/test-design-kit-package.mjs`',
    '# fails when a line here disagrees with the source file it names. Each line is the SHA-256 of that file\'s bytes,',
    '# as the source in this repository has them, so the check a reader knows (`shasum -a 256 -c MANIFEST.sha256`)',
    '# verifies the artefact against itself; the test verifies it against the sources.',
    '#',
    ...lines,
    '',
  ].join('\n');
}

/// `MANIFEST.sha256` as `Map<path, hash>`.
export function parseManifest(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line);
    if (match) out.set(match[2].trim(), match[1]);
  }
  return out;
}

/// The first line where two texts differ, so a failure names the file and the line rather than printing both blobs.
/// The same shape `scripts/test-design-tokens-generator.mjs` uses for the generated stylesheet.
export function firstDifference(a, b) {
  const aLines = String(a).split('\n');
  const bLines = String(b).split('\n');
  for (let index = 0; index < Math.max(aLines.length, bLines.length); index += 1) {
    if (aLines[index] !== bLines[index]) {
      return { line: index + 1, committed: aLines[index], generated: bLines[index] };
    }
  }
  return null;
}

/// Every file under `dir`, as artefact-relative paths, recursively. Used only by `--check`, to catch a file that was
/// added to the artefact by hand: a corpus comparison that walked the manifest alone would call a stale artefact
/// clean while it carried an extra file nobody generated.
export function listFiles(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const absolute = join(dir, name);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (statSync(absolute).isDirectory()) out.push(...listFiles(absolute, relativePath));
    else out.push(relativePath);
  }
  return out.sort();
}

/// The tarball built from the artefact directory's own bytes — not from `design/`, and not from `PACKAGE_FILES`.
/// Reading the directory is what makes the tarball and the committed copy unable to disagree: both come from the same
/// bytes, and `packageProblems()` has already failed if those bytes are not the sources'.
export function tarballBytes(dir = PACKAGE_DIR) {
  const files = listFiles(dir).map((path) => ({ path, body: readFileSync(join(dir, path)) }));
  return writeTarGz(files);
}

/// The tarball's path for a version, in the untracked build-output directory.
export function tarballPath(version = kitVersion()) {
  return join(DIST_DIR, `${TARBALL_STEM}-${version}.tar.gz`);
}

/// Everything wrong with the committed artefact, as sentences a reader can act on. An empty array is the contract
/// this kit's whole export story rests on: **the artefact's copy of every file is byte-identical to its source**, and
/// a stale copy is a red test rather than a silent divergence.
///
/// The checks, in the order they would fire:
///   1. the artefact exists at all, and its file list is exactly the generated one (a missing file and an extra file
///      are the same defect from two directions);
///   2. `MANIFEST.sha256` is exactly the manifest those sources render — so a hash line edited by hand, or a source
///      file changed without regenerating, is named with the path and both hashes;
///   3. every file's bytes equal its source's bytes, compared directly as well as through the manifest, because the
///      manifest could be regenerated while a file lagged (`--check` prints the first differing line);
///   4. `KIT_VERSION`, `VERSION` and `design/tokens.json`'s `version` all say the same thing.
export function packageProblems(dir = PACKAGE_DIR) {
  const problems = [];
  if (!existsSync(dir)) {
    return [`the design kit package does not exist at ${relative(REPO, dir)} — run \`node scripts/package-design-kit.mjs\``];
  }
  const expected = packageEntries();
  const expectedPaths = expected.map((entry) => entry.path).sort();
  const actualPaths = listFiles(dir);

  const missing = expectedPaths.filter((path) => !actualPaths.includes(path));
  const extra = actualPaths.filter((path) => !expectedPaths.includes(path));
  if (missing.length) problems.push(`the package is missing ${missing.length} file(s): ${missing.join(', ')}`);
  if (extra.length) {
    problems.push(
      `the package carries ${extra.length} file(s) that nothing generates: ${extra.join(', ')} — a hand-added file ` +
        'is not part of the artefact',
    );
  }

  const manifestPath = join(dir, MANIFEST_NAME);
  if (existsSync(manifestPath)) {
    const committedManifest = readFileSync(manifestPath, 'utf8');
    const wantedManifest = expected.find((entry) => entry.path === MANIFEST_NAME).body.toString('utf8');
    const drift = firstDifference(committedManifest, wantedManifest);
    if (drift) {
      problems.push(
        `${MANIFEST_NAME} is not what the sources render — first difference at line ${drift.line}: committed ` +
          `${JSON.stringify(drift.committed)}, generated ${JSON.stringify(drift.generated)}`,
      );
    }
  }

  for (const entry of expected) {
    const path = join(dir, entry.path);
    if (!existsSync(path)) continue; // already reported as missing
    const committed = readFileSync(path);
    if (committed.equals(entry.body)) continue;
    const difference = firstDifference(committed.toString('utf8'), entry.body.toString('utf8'));
    // The composed files (`MANIFEST.sha256`, `KIT_VERSION`, and the shipped allowance) have no source of the same
    // name whose bytes they are, so the sentence names what wrote them rather than a `design/` path that is a
    // different document.
    const source = entry.path === MANIFEST_NAME || entry.path === KIT_VERSION_NAME
      ? 'what the sources render'
      : entry.path === SHIPPED_ALLOWANCE_NAME
        ? 'what the packager composes from design/VERSION (D11)'
        : `design/${entry.path}`;
    problems.push(
      `design/package/${entry.path} is not ${source}: committed sha256 ${sha256(committed)}, source sha256 ` +
        `${sha256(entry.body)}` +
        (difference
          ? ` — first difference at line ${difference.line}: committed ${JSON.stringify(difference.committed)}, ` +
            `source ${JSON.stringify(difference.generated)}`
          : ' — the bytes differ but the texts do not, so one side has different line endings or a trailing newline'),
    );
  }

  const versions = {
    'design/VERSION': kitVersion(),
    [`design/package/${KIT_VERSION_NAME}`]: existsSync(join(dir, KIT_VERSION_NAME))
      ? readFileSync(join(dir, KIT_VERSION_NAME), 'utf8').trim()
      : '(missing)',
    'design/tokens.json version': jsonVersion(),
  };
  const distinct = new Set(Object.values(versions));
  if (distinct.size > 1) {
    problems.push(
      `the kit's version is declared differently in three places: ${Object.entries(versions)
        .map(([what, value]) => `${what} = ${value}`)
        .join(', ')}`,
    );
  }
  return problems;
}

/// What a consumer gets, counted, for the command's own output and for the report. Derived from the artefact as it
/// exists on disk, so a summary cannot describe a package that is not there.
export function describePackage(dir = PACKAGE_DIR) {
  const paths = existsSync(dir) ? listFiles(dir) : [];
  let bytes = 0;
  for (const path of paths) bytes += statSync(join(dir, path)).size;
  return { files: paths.length, bytes, version: kitVersion(), paths };
}

/// A tarball listing, for a report or a test: `{ path, size, mode }` per entry, no bodies. Used to prove the tarball
/// can be read back by something other than the writer that made it.
export function tarballListing(bytes) {
  return readTar(bytes).map((entry) => ({ path: entry.path, size: entry.size, mode: entry.mode, type: entry.type }));
}
