// The design kit as a distributable artefact, proven in the same shape ITEM 1 proves for the CSS: **the artefact's
// copy of every file is byte-identical to its source**, so a stale artefact is a red test rather than a silent
// divergence.
//
//   node scripts/test-design-kit-package.mjs
//
// This is the acceptance test `design/SHARING_THE_KIT.md` §"What is missing" asks for (item 2), and each half is here
// for a reason that a document cannot carry:
//
//   1. **Byte-identity, per file, from the tree.** `design/package/<path>` must equal `design/<path>` byte for byte.
//      A copy that was regenerated before a token changed, or edited by hand, is named with both hashes — and the
//      break-on-purpose proof is in the commit that added this file: one byte typed into `design/package/tokens.css`
//      by hand, and the literal assertion is in that commit's message.
//   2. **The manifest is the list, and it is generated.** `MANIFEST.sha256` must be exactly what the sources render
//      *and* the file list must be exactly the generated one, so a hand-added file is caught as well as a stale one.
//      A manifest that is merely "present and plausible" is the failure mode this half exists to close: a hand-edited
//      hash would otherwise make the artefact verify against itself while disagreeing with the kit.
//   3. **The version travels.** `VERSION`, `KIT_VERSION` and `design/tokens.json`'s `version` must all say the same
//      thing, because a consumer declares `kitVersion` and the drift dashboard compares it.
//   4. **The tarball is the same bytes, deterministically.** Built twice, the tarball must be identical; read back,
//      it must contain exactly the committed artefact's files. This is what makes the pack trustworthy without a
//      checksum algorithm of its own, and it is why the packaging script writes its own USTAR rather than shelling
//      out to `tar` (which stamps mtimes and differs between platforms — see `scripts/lib/tar.mjs`).
//   5. **It runs where a consumer unpacks it.** The conformance runner is started from the extracted artefact and its
//      own output must name the kit it is standing in. A package whose runner cannot start is not a package.
//   6. **The adoption files travel, positively.** The four `adopt/` files are named here rather than left to the
//      generated list: dropping one from `PACKAGE_FILES` shrinks the list, and the missing-file check would agree
//      with the smaller list, so the artefact would quietly lose the mechanism again and every other assertion
//      would still pass. Without them a consumer takes the bytes and forgets the contract.
//
// Everything here is read-only with respect to the tree: the artefact is regenerated into a temporary directory, never
// over `design/package/`, so a failing test can never be the thing that destroyed the evidence.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KIT_VERSION_NAME,
  MANIFEST_NAME,
  PACKAGE_DIR,
  REPOSITORY_ROOT,
  SHIPPED_ALLOWANCE_NAME,
  conformanceFixtures,
  describePackage,
  firstDifference,
  kitVersion,
  listFiles,
  packageEntries,
  packagePaths,
  packageProblems,
  parseManifest,
  sha256,
  tarballBytes,
  tarballListing,
} from './lib/kit-package.mjs';
import { readTar } from './lib/tar.mjs';

// ---------------------------------------------------------------------------
// 1. The artefact's copy of every file is byte-identical to its source.
// ---------------------------------------------------------------------------
const problems = packageProblems();
assert.deepEqual(
  problems,
  [],
  `design/package/ is not what design/ generates — run \`node scripts/package-design-kit.mjs\` and commit the result:\n  ` +
    problems.join('\n  '),
);

// The direct per-file comparison, printed as the reader's own summary. `packageProblems()` is the contract; this loop
// is what makes the output say *which* files were compared and over how many bytes, so a reader does not have to trust
// the word "up to date".
let compared = 0;
let comparedBytes = 0;
for (const entry of packageEntries()) {
  const committed = readFileSync(join(PACKAGE_DIR, entry.path));
  assert.ok(
    committed.equals(entry.body),
    `design/package/${entry.path} must be byte-identical to its source: committed sha256 ${sha256(committed)}, ` +
      `source sha256 ${sha256(entry.body)}`,
  );
  compared += 1;
  comparedBytes += entry.body.length;
}

// ---------------------------------------------------------------------------
// 2. The manifest is the generated list, and the file list is exactly it.
// ---------------------------------------------------------------------------
const manifestText = readFileSync(join(PACKAGE_DIR, MANIFEST_NAME), 'utf8');
const wantedManifest = packageEntries().find((entry) => entry.path === MANIFEST_NAME).body.toString('utf8');
const manifestDrift = firstDifference(manifestText, wantedManifest);
assert.equal(
  manifestDrift,
  null,
  manifestDrift
    ? `${MANIFEST_NAME} is not what the sources render — first difference at line ${manifestDrift.line}: committed ` +
      `${JSON.stringify(manifestDrift.committed)}, generated ${JSON.stringify(manifestDrift.generated)}`
    : '',
);
const manifest = parseManifest(manifestText);
const onDisk = listFiles(PACKAGE_DIR);
assert.deepEqual(
  [...manifest.keys()].sort(),
  onDisk.filter((path) => path !== MANIFEST_NAME).sort(),
  'the manifest must name every file in the artefact and nothing else, so a file nobody generated cannot hide',
);
// The generated list itself, and the deliberate exclusions. What stays out is the kit's **own state**: its allowance
// file and the record of its own last run. Everything else the artefact's own documents tell a consumer to open, run or
// copy travels — and the positive assertions below name the ones whose loss the equality check above could not feel.
assert.deepEqual(
  onDisk.sort(),
  [...packagePaths(), KIT_VERSION_NAME, MANIFEST_NAME].sort(),
  'the artefact must contain exactly the files it is generated from',
);
// The positive half of the same contract, and the reason it is written out rather than left to the list above: the
// defect this artefact had was a consumer receiving the bytes and not the mechanism. A path dropped from
// `PACKAGE_FILES` shrinks the generated list, so the missing-file check and the equality check would both agree with
// the loss — these four are therefore named, in the order `adopt/README.md` numbers its steps.
for (const travels of [
  'adopt/README.md',
  'adopt/AGENTS.snippet.md',
  'adopt/allow.mjs.example',
  'adopt/wire-your-gate.md',
  // Added 2026-10-08 with kit 1.4.2: both documents above name `gate.sh.example` as the runnable gate to copy, and
  // the artefact did not carry it — the same "a step a consumer cannot follow" defect one level up from the missing
  // `allow.mjs` that D11 repairs.
  'adopt/gate.sh.example',
]) {
  assert.ok(
    onDisk.includes(travels),
    `${travels} must travel: the kit's advice is a message read once, and this file is what makes taking the kit a ` +
      'contract rather than a preference (design/adopt/README.md)',
  );
}
for (const excluded of ['conformance/run.json']) {
  assert.ok(
    !onDisk.includes(excluded),
    `${excluded} must not travel: it is the record of this kit's own last run, and shipping it would put this ` +
      'repository in a consumer\'s report under a name that is not theirs',
  );
}
// The proof that the suite can fail, and the page the reference images are pictures of. Both were excluded and both
// were named by the artefact's own documents: `conformance/README.md` tells a consumer to run `self-test.mjs`, and
// `README.md`, `AGENT_BRIEF.md` and `UI_SYSTEM.md` send it to `specimen.html` — which it could not open in a package
// that carried four PNGs of the page and not the page. A file list that omits them is not smaller, it is broken.
for (const travels of ['specimen.html', 'conformance/self-test.mjs']) {
  assert.ok(
    onDisk.includes(travels),
    `${travels} must travel: a document that tells a consumer to open or run a file the artefact does not carry is the ` +
      'same defect as a step that cannot be followed',
  );
}
// And every fixture, one by one from the source directory rather than a count: `self-test.mjs` names each of them, so a
// fixture dropped from the discovery turns a suite that ships into one that cannot run — and the equality check above
// would agree with the smaller list, because it compares the artefact with the same discovery that lost it.
const fixtures = conformanceFixtures();
assert.ok(
  fixtures.length > 0 && onDisk.includes('conformance/fixtures/good.html'),
  'the conformance fixtures must travel: they are what proves the suite can fail, and `self-test.mjs` names each one',
);
assert.deepEqual(
  onDisk.filter((path) => path.startsWith('conformance/fixtures/')),
  fixtures,
  'the artefact must carry every fixture `self-test.mjs` runs, and nothing else under conformance/fixtures/',
);
// The same positive half for the component layer, and for the same reason: `components.css` is the answer to "the kit
// shares tokens and does not share components", and a consumer that never receives it writes the same button again.
// Dropping it from `PACKAGE_FILES` would shrink the generated list, so both equality checks above would agree with the
// loss — this assertion is what makes that a red test instead of a quietly smaller kit.
assert.ok(
  onDisk.includes('components.css'),
  'components.css must travel: it is the kit\'s component layer, and a consumer that does not receive it retypes the ' +
    'same button — the drift the layer exists to end',
);
// And the same positive half for the composition layer (kit 1.4.0), and for the same measured reason one step further
// on: `components.css` shared the button and shared no composed page, so every consumer composed the plan by guessing —
// a sibling repository passed the judge with 0 failures in both themes and had its UI rejected four times because of
// it. `layout.css` is the plan and `layout.html` is the page that composes it; a consumer that receives neither has
// received a kit that still cannot answer the question that cost it a fortnight.
for (const travels of ['layout.css', 'layout.html']) {
  assert.ok(
    onDisk.includes(travels),
    `${travels} must travel: the kit shares the plan as well as the drawings, and a consumer that does not receive it ` +
      'composes the plan by guessing (design/layout.css, design/layout.html)',
  );
}
// And the same positive half for the reference window (kit 1.4.1), which closes the oldest hole in this list. `layout`
// taught the plan and this window is the page the plan is composed in; `design/adopt/README.md` step 1 already told a
// consumer to start from it, and the artefact did not carry the directory, so the step could not be followed by anyone
// who took the artefact. Both files are named for that reason, and for one measured more: the window carries its four
// annotations inline for five of its six regions, and **R3's "keep two, delete the rest" is only in `PLAN.md`** — so a
// consumer that receives the window without the plan is told to gut it with the fold's own keep/delete instruction
// missing. Dropping either path from `PACKAGE_FILES` shrinks the generated list, so both equality checks above would
// agree with the loss; this assertion is what makes that a red test instead.
for (const travels of ['reference-window/index.html', 'reference-window/PLAN.md']) {
  assert.ok(
    onDisk.includes(travels),
    `${travels} must travel: design/adopt/README.md step 1 tells a consumer to start from the kit's reference window ` +
      'and to delete region by region, and a step a consumer cannot follow — or a region map that is not there to say ' +
      'what to delete — is the hole this assertion closes (design/reference-window/)',
  );
}
// And the same positive half for the shipped allowance (D11, kit 1.4.2), which is the one entry here that is
// **composed** rather than a copy — so the equality checks above compare it with what the packager writes, and only
// an assertion of its own content can catch a composition that is valid but wrong (an `allowApp` pointing at a page
// that does not travel, a `kitVersion` that does not move with `VERSION`, a deviation list seeded with findings).
// The acceptance test cannot stand in for this one either: it runs `run.mjs`, which never reads `allowApp`.
const shippedAllowance = readFileSync(join(PACKAGE_DIR, SHIPPED_ALLOWANCE_NAME), 'utf8');
for (const [needle, what] of [
  [`kitVersion: '${kitVersion()}'`, 'the kit version of the copy it stands in, read from VERSION at pack time'],
  ["app: 'Wing Controller reference window'", 'the name the drift dashboard shows for this row'],
  ["allowApp: '../reference-window/index.html'", "the kit's own page, relative to this file"],
  ['deviations: []', 'the empty deviation list the reference window needs'],
]) {
  assert.ok(
    shippedAllowance.includes(needle),
    `${SHIPPED_ALLOWANCE_NAME} must declare ${what} (${needle}); beside it, VERSION is ${kitVersion()}`,
  );
}
// The declaration is only runnable if the page it names is there. `allowApp` is resolved by `report.mjs` against the
// declaration's own directory (`resolve(dirname(allowPath), allowApp)`), so that is the path checked — measured, and
// the reason this assertion is not `join(PACKAGE_DIR, 'reference-window/index.html')` alone.
assert.ok(
  existsSync(join(PACKAGE_DIR, 'conformance', '../reference-window/index.html')),
  'the shipped allowance names ../reference-window/index.html, so that page must travel — a declaration that points ' +
    'at a file the artefact does not carry is the defect D11 exists to close, one step further on',
);
// And the composed file must not be the source of the same name. The file at `design/conformance/allow.mjs` is this
// repository's own declaration for its five windows; a tarball that carried it would report this repository's 52
// deviations under a consumer's name, which is exactly why the file list excluded it before D11.
assert.notEqual(
  shippedAllowance,
  readFileSync(join(REPOSITORY_ROOT, 'design', 'conformance', 'allow.mjs'), 'utf8'),
  `${SHIPPED_ALLOWANCE_NAME} must be composed, never a byte copy of design/conformance/allow.mjs — that file is this ` +
    "repository's own 52-deviation declaration and shipping it would put this repository's findings in a consumer's report",
);
assert.ok(
  !shippedAllowance.includes('meters.html') && !shippedAllowance.includes('guide.html'),
  `${SHIPPED_ALLOWANCE_NAME} must not carry this repository's window findings; its deviations belong to the reference window`,
);

// ---------------------------------------------------------------------------
// 3. The version travels, and it is one number.
// ---------------------------------------------------------------------------
assert.equal(
  readFileSync(join(PACKAGE_DIR, 'VERSION'), 'utf8').trim(),
  kitVersion(),
  'design/package/VERSION must be the kit version, byte for byte (it is a raw copy of design/VERSION)',
);
assert.equal(
  readFileSync(join(PACKAGE_DIR, KIT_VERSION_NAME), 'utf8').trim(),
  kitVersion(),
  `${KIT_VERSION_NAME} must name the kit version a consumer declares`,
);
assert.ok(
  readFileSync(join(PACKAGE_DIR, 'tokens.json'), 'utf8').includes(`"version": "${kitVersion()}"`),
  'the artefact\'s tokens.json must carry the kit version',
);
for (const generated of ['tokens.css', 'native/WingTheme.swift']) {
  assert.ok(
    readFileSync(join(PACKAGE_DIR, generated), 'utf8').includes(`Version ${kitVersion()}.`),
    `design/package/${generated} must print the version in its generated header`,
  );
}

// ---------------------------------------------------------------------------
// 4. The tarball: deterministic bytes, and the same files.
// ---------------------------------------------------------------------------
const tarball = tarballBytes();
const again = tarballBytes();
assert.ok(
  tarball.equals(again),
  `the tarball must be a function of its contents: two builds gave sha256 ${sha256(tarball)} and ${sha256(again)}. ` +
    'A tarball that changes on every run cannot be compared, and the drift this kit removes would come back as a diff ' +
    'nobody can read',
);
const listing = tarballListing(tarball);
assert.deepEqual(
  listing.map((entry) => entry.path),
  listFiles(PACKAGE_DIR),
  'the tarball must carry exactly the committed artefact\'s files, in the same order',
);
const bytesOf = new Map(listFiles(PACKAGE_DIR).map((path) => [path, readFileSync(join(PACKAGE_DIR, path))]));
const archived = new Map(readTar(tarball).map((entry) => [entry.path, entry.body]));
for (const [path, expected] of bytesOf) {
  assert.ok(
    archived.has(path) && archived.get(path).equals(expected),
    `the tarball's copy of ${path} must be byte-identical to the committed artefact's copy`,
  );
}

// The shipped tarball, if one has been built here, must be the same bytes as the one the sources produce now. This is
// the "a stale artefact is a red test" half applied to the packed form: it is skipped with a note when nobody has
// built the tarball on this machine (it is a build output, not a tracked file), and it never writes over one.
const shipped = join(REPOSITORY_ROOT, 'design/dist', `wing-controller-design-${kitVersion()}.tar.gz`);
let shippedNote = '';
try {
  const shippedBytes = readFileSync(shipped);
  assert.ok(
    shippedBytes.equals(tarball),
    `the tarball at design/dist/wing-controller-design-${kitVersion()}.tar.gz is stale: its sha256 is ` +
      `${sha256(shippedBytes)} and the sources produce ${sha256(tarball)}. ` +
      'Run `node scripts/package-design-kit.mjs` and republish it',
  );
} catch (error) {
  if (error?.code === 'ENOENT') shippedNote = ' (no tarball built on this machine: it is a build output, not tracked)';
  else throw error;
}

// ---------------------------------------------------------------------------
// 5. A consumer can start the runner from the unpacked artefact.
// ---------------------------------------------------------------------------
// The whole point of the pack is that a sibling repository can point the suite at its own page. That requires the
// runner to start with nothing from this repository on the path — which is a property of the *file set*, so it is
// measured rather than assumed. Two invocations, because each exercises a different link in the chain and neither
// needs a browser:
//
//   * no `--app` at all -> exit 2 (the command line is wrong), the banner printed. The banner's `design/VERSION`
//     label is a label, not a reading — `readKit()` has not run yet at that point — so nothing is claimed from it.
//   * `--app` naming a page that is not there -> exit 3 (nothing was measured), **and the runner must say the page
//     does not exist rather than that the kit is unreadable**. That is the measured proof that `readKit()` found
//     `tokens.css` and `VERSION` inside the unpacked artefact: the page check runs after it, and a kit it could not
//     read exits 3 with a different sentence naming `tokens.css`.
const scratch = mkdtempSync(join(tmpdir(), 'wing-kit-package-'));
try {
  const unpacked = join(scratch, 'package');
  const write = spawnSync('bash', ['-c', `mkdir -p ${JSON.stringify(unpacked)} && tar -xzf - -C ${JSON.stringify(unpacked)}`], {
    input: tarball,
  });
  assert.equal(write.status, 0, `the tarball must unpack with the system tar: ${write.stderr}`);

  const bare = spawnSync('node', ['conformance/run.mjs'], { cwd: unpacked, encoding: 'utf8' });
  assert.equal(
    bare.status,
    2,
    'the packaged conformance runner must start and refuse a missing --app with exit 2 (a wrong command line is 2; ' +
      `nothing measured is 3); it exited ${bare.status}:\n${bare.stdout}${bare.stderr}`,
  );
  assert.ok(
    bare.stdout.includes('WING CONTROLLER · design-system conformance'),
    `the packaged runner must print its banner; its own output said:\n${bare.stdout}`,
  );

  const missingPage = spawnSync('node', ['conformance/run.mjs', '--app', 'no-such-window.html'], { cwd: unpacked, encoding: 'utf8' });
  assert.equal(
    missingPage.status,
    3,
    `the packaged runner must report an unopenable page as "nothing was measured" (exit 3); it exited ` +
      `${missingPage.status}:\n${missingPage.stdout}${missingPage.stderr}`,
  );
  assert.ok(
    missingPage.stdout.includes('the page does not exist'),
    `the packaged runner must name the missing page; its own output said:\n${missingPage.stdout}`,
  );
  assert.ok(
    !missingPage.stdout.includes('no tokens.css'),
    'the packaged runner must find tokens.css inside the unpacked artefact; its own output said it did not:\n' +
      missingPage.stdout,
  );

  // And the `VERSION` beside it: `--app` naming a page that **exists** gets past both early returns, so `readKit()`
  // runs and the report prints the version it read. The page is in the package and is judged honestly — a README is
  // not the window the suite is for, so a non-zero exit and an empty finding list both mean "read it and found
  // nothing", not "could not read the kit". No browser is needed for the banner, which is printed before any page is
  // opened.
  const readKit = spawnSync('node', ['conformance/run.mjs', '--app', 'conformance/README.md'], {
    cwd: unpacked,
    encoding: 'utf8',
  });
  assert.ok(
    readKit.stdout.includes(`design/VERSION ${kitVersion()} · declared by the app:`),
    `the packaged runner must read the VERSION beside it and print it; its own output said:\n${readKit.stdout}`,
  );
  assert.ok(
    !readKit.stdout.includes('design/VERSION (not read)') && !readKit.stdout.includes('design/VERSION unreadable'),
    `the packaged runner read its own VERSION: the banner must not disclaim it; its own output said:\n${readKit.stdout}`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const summary = describePackage();
console.log(
  `design kit package: ${summary.files} file(s), version ${summary.version}, ${compared} compared byte for byte ` +
    `(${comparedBytes} bytes), tarball sha256 ${sha256(tarball)}${shippedNote}`,
);
