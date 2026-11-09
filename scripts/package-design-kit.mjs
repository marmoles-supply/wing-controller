#!/usr/bin/env node
// Package the design kit into the distributable, versioned form a sibling repository can take.
//
//   node scripts/package-design-kit.mjs                  # write design/package/ and the tarball
//   node scripts/package-design-kit.mjs --check          # fail instead of writing (the gate runs the test, which
//                                                        # calls this same comparison; this form is for a hook)
//   node scripts/package-design-kit.mjs --list           # what travels, from the artefact as it is on disk
//   node scripts/package-design-kit.mjs --no-tarball     # the directory only
//   node scripts/package-design-kit.mjs --tarball <path> # write the tarball somewhere else
//
// Why both a directory and a tarball, and why the directory is the committed one: see the header of
// `scripts/lib/kit-package.mjs`. In one line: git can diff a directory and a byte-equality test can judge it, and
// the tarball is built **from the directory's own bytes** so the two cannot disagree.
//
// This script and `scripts/lib/kit-package.mjs` are the only writers of `design/package/`. Nothing here reads
// `design/tokens.css` for a value: the copy step is a raw byte copy, which is why "byte-identical" is a property of
// the code rather than a promise in a document.
//
// Exit codes: 0 written, or already what the sources generate; 1 the artefact is stale (--check); 2 the command line
// is wrong or the artefact cannot be written safely. The same three-way discipline as the other design scripts.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MANIFEST_NAME,
  PACKAGE_DIR,
  REPOSITORY_ROOT,
  describePackage,
  kitVersion,
  packageEntries,
  packageProblems,
  parseManifest,
  sha256,
  tarballBytes,
  tarballListing,
  tarballPath,
} from './lib/kit-package.mjs';

function fail(message, code = 2) {
  console.error(`design kit package: ${message}`);
  process.exit(code);
}

/// A path as a reader should see it: relative to this repository when it is inside it, absolute when it is not. A
/// `--out` directory under `/tmp` printed as `../../../../tmp/...` is a path nobody can act on, and this script's
/// messages are the whole interface when it refuses.
function show(path) {
  const inside = relative(REPOSITORY_ROOT, path);
  return inside.startsWith('..') ? path : inside;
}

/// Remove the previous artefact's files, but only the ones its own manifest names **and** whose bytes still match
/// that manifest. A file that does not match is not this script's to delete: it is either a hand edit (which the
/// test exists to catch, so deleting it would destroy the evidence) or another session's work in progress. The
/// alternative — `rm -rf design/package` — is how an agent deletes somebody else's uncommitted file, and this project
/// has paid for that twice.
///
/// **Every file is checked before a single one is removed**, and that order is not cosmetic: the first version of
/// this function deleted as it walked the manifest, so a hand-edited `tokens.css` late in the list was refused
/// *after* twelve files had already been deleted — leaving the artefact half-destroyed. The refusal has to come
/// first, because the refusal is what protects the evidence, and a partial delete is the opposite of protecting it.
/// (Measured while breaking the acceptance test on purpose, 2026-10-08.)
function clearGenerated(dir) {
  const manifestPath = join(dir, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    fail(
      `${show(dir)} exists but has no ${MANIFEST_NAME}, so this script cannot tell its own ` +
        'files from somebody else\'s. Remove the directory by hand if it is yours; refusing to delete it.',
    );
    return 0;
  }
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const present = [...manifest].filter(([path]) => existsSync(join(dir, path)));
  for (const [path, hash] of present) {
    const actual = sha256(readFileSync(join(dir, path)));
    if (actual !== hash) {
      fail(
        `${show(join(dir, path))} was edited by hand (its sha256 is ${actual}, the manifest ` +
          `says ${hash}). Refusing to overwrite it — and refusing to delete the rest of the artefact until it is ` +
          'gone, so this refusal cannot leave a half-deleted package behind: run the test to see the drift, or ' +
          'delete the file deliberately. Nothing has been written or removed.',
      );
    }
  }
  for (const [path] of present) rmSync(join(dir, path));
  rmSync(manifestPath);
  return present.length;
}

function writePackage(dir) {
  if (existsSync(dir) && !statSync(dir).isDirectory()) fail(`${show(dir)} is not a directory`);
  // The comparison first, so a stale artefact is reported rather than silently overwritten — and so `--check` and
  // the writer share one definition of "correct".
  const problemsBefore = existsSync(dir) ? packageProblems(dir) : [];
  const entries = packageEntries();
  const removed = existsSync(dir) ? clearGenerated(dir) : 0;
  mkdirSync(dir, { recursive: true });
  for (const entry of entries) {
    const absolute = join(dir, entry.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, entry.body);
  }
  return { entries, removed, problemsBefore };
}

/// The tarball's own checksum is written beside it, because a sibling repository that takes the tarball has no other
/// way to know it arrived whole. The tarball is not tracked by git, so this file is a build output too.
function writeTarball(absolute) {
  const bytes = tarballBytes();
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
  const sums = `${sha256(bytes)}  ${absolute.split('/').pop()}\n`;
  writeFileSync(`${absolute}.sha256`, sums);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const listOnly = args.includes('--list');
  const noTarball = args.includes('--no-tarball');
  const outIndex = args.indexOf('--out');
  const tarballIndex = args.indexOf('--tarball');
  const dir = outIndex === -1 ? PACKAGE_DIR : resolve(args[outIndex + 1] || '');
  const tarPath = noTarball ? null : tarballIndex === -1 ? tarballPath() : resolve(args[tarballIndex + 1] || '');

  if (outIndex !== -1 && !args[outIndex + 1]) fail('--out needs a directory');
  if (tarballIndex !== -1 && !args[tarballIndex + 1]) fail('--tarball needs a path');

  if (listOnly) {
    const summary = describePackage(dir);
    if (!existsSync(dir)) fail(`there is no artefact at ${show(dir)} — run this script first`);
    console.log(`design kit ${summary.version} · ${summary.files} file(s) · ${summary.bytes} bytes`);
    for (const path of summary.paths) console.log(`  ${path}`);
    return;
  }

  if (checkOnly) {
    const problems = packageProblems(dir);
    if (problems.length) {
      console.error(`design kit package: ${show(dir)} is not what design/ generates:`);
      for (const problem of problems) console.error(`  - ${problem}`);
      console.error('  run `node scripts/package-design-kit.mjs` and commit the result');
      process.exit(1);
    }
    console.log(`design kit package: up to date (${describePackage(dir).files} files, version ${kitVersion()})`);
    return;
  }

  const { problemsBefore, removed } = writePackage(dir);
  const summary = describePackage(dir);
  const lines = [
    `design kit package: wrote ${summary.files} file(s), version ${summary.version}, ${summary.bytes} bytes ` +
      `into ${show(dir)}` +
      (removed ? ` (replaced ${removed} generated file(s))` : ''),
  ];
  if (problemsBefore.length) {
    // Regenerated over a stale artefact: the drift is worth printing, because it is the same list the test would
    // have printed and the reader should know what changed.
    lines.push(`design kit package: the previous artefact was stale (${problemsBefore.length} problem(s)):`);
    for (const problem of problemsBefore) lines.push(`  - ${problem}`);
  }
  if (tarPath) {
    const tarball = writeTarball(tarPath);
    lines.push(
      `design kit package: wrote ${show(tarPath)} (${tarball.bytes} bytes, sha256 ` +
        `${tarball.sha256}) and its .sha256 beside it`,
    );
    const listing = tarballListing(readFileSync(tarPath));
    lines.push(`design kit package: the tarball reads back as ${listing.length} entries`);
  }
  for (const line of lines) console.log(line);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
