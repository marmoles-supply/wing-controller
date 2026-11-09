// Release notes must state the build that version.json actually recorded.
//
// Release notes for 0.2.25/0.2.26/0.2.27 claimed invented build numbers
// (20260922.3/.4/.5) that never existed in version.json; the correct builds were
// 20260921.12/.13/.14. Nothing tied the prose to the recorded build, so the
// mistake shipped and had to be corrected by hand. This test derives the
// expected build/date from version.json history itself: for every note it finds
// the commit that introduced that version (the first commit whose version.json
// declares it) and compares the note's `Build:` and `Date:` lines with the
// build and buildDate recorded there.
//
// Notes written before version.json governed the desktop are reported and
// skipped, but only if they really predate the first version.json commit; a new
// note whose version never reaches version.json fails.
//
// Run: node scripts/test-desktop-release-notes.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseHistory, strictlyPredates, readArchivedReleaseProvenance, noteSha256 } from './lib/release-provenance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const notesDir = path.join(repoRoot, "desktop/release-notes");

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch (error) {
    assert.fail(`git ${args.join(" ")} failed: ${error.stderr?.toString() || error.message}`);
  }
};

assert.equal(git(['rev-parse', '--show-toplevel']), repoRoot, 'Release verification needs this checkout\'s own Git history, not an enclosing repository');

// --- Build the version -> recorded build map from version.json history -----
// `git log --reverse` walks oldest-first, so the first commit that declares a
// version is the one that introduced it. (`git log -1 --reverse` is NOT that
// commit: git applies the -1 limit before reversing, so it returns the newest
// commit that touched the file.)
const { firstVersionJsonCommit, recordedByVersion } = readReleaseHistory(repoRoot);
const archivedByVersion = readArchivedReleaseProvenance(repoRoot);
assert.ok(
  recordedByVersion.size > 0,
  "expected version.json history to record at least one version",
);

const workingTreeVersionJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "version.json"), "utf8"),
);

// --- No tolerated mismatches -----------------------------------------------
// 0.2.23 and 0.2.24 once lived here while their invented builds (20260922.1/.2)
// were corrected to the builds version.json actually recorded (20260921.10/.11).
// The map must stay empty: a release note with the wrong build has to break the
// gate, never be excused. The assertion below fails the moment an entry is
// added back, so this can never quietly become a place to hide a bad note.
const TOLERATED_MISMATCHES = new Map();
assert.equal(
  TOLERATED_MISMATCHES.size,
  0,
  "TOLERATED_MISMATCHES must stay empty: an entrance means a release note with a wrong build is being excused instead of failing the gate",
);

// --- Every note ------------------------------------------------------------
const noteFiles = fs
  .readdirSync(notesDir)
  .filter((name) => name.endsWith(".md"))
  .sort();
assert.ok(noteFiles.length > 0, "expected at least one release note");
for (const version of archivedByVersion.keys()) {
  assert.ok(noteFiles.includes(`${version}.md`), `Archived release note ${version} is missing from this checkout`);
}

const problems = [];
const skipped = [];
const unverified = [];
const pending = [];

for (const name of noteFiles) {
  const version = name.replace(/\.md$/, "");
  const relative = `desktop/release-notes/${name}`;
  const text = fs.readFileSync(path.join(notesDir, name), "utf8");

  const build = /^Build:\s*(\S+)/m.exec(text)?.[1] ?? null;
  const date = /^Date:\s*(\S+)/m.exec(text)?.[1] ?? null;
  assert.ok(build, `${relative} must declare a "Build:" line`);
  assert.ok(date, `${relative} must declare a "Date:" line`);

  const archived = archivedByVersion.get(version);
  if (archived) {
    assert.equal(noteSha256(text), archived.sha256, `${relative}: differs from its audited historical snapshot`);
    assert.equal(build, archived.build, `${relative}: archived build mismatch`);
    assert.equal(date, archived.buildDate, `${relative}: archived date mismatch`);
    if (archived.status === 'predates-version-json') {
      skipped.push(version);
      continue;
    }
    if (archived.status === 'imported-without-build-evidence') {
      unverified.push(version);
      continue;
    }
  }
  const recorded = recordedByVersion.get(version) || (archived && { ...archived, commit: archived.recordedAt });
  if (!recorded) {
    // No version.json commit ever declared this version yet.
    const introCommit = git(["log", "--reverse", "--format=%H", "--", relative])
      .split("\n")
      .filter(Boolean)[0];
    if (!introCommit) {
      // The note is not committed yet: during a release it is written right
      // after the version bump, before the commit. Accept it only if it matches
      // the working-tree version.json the release script just wrote.
      if (
        workingTreeVersionJson.version === version &&
        workingTreeVersionJson.build === build &&
        workingTreeVersionJson.buildDate === date
      ) {
        pending.push(version);
        continue;
      }
      problems.push(
        `${relative}: not committed yet, and the working-tree version.json records ${workingTreeVersionJson.version} / build ${workingTreeVersionJson.build} / buildDate ${workingTreeVersionJson.buildDate}, not ${version} / build ${build} / buildDate ${date}`,
      );
      continue;
    }
    // A note that predates version.json entirely cannot be checked against it.
    if (strictlyPredates(repoRoot, introCommit, firstVersionJsonCommit)) {
      skipped.push(version);
      continue;
    }
    problems.push(
      `${relative}: no version.json commit ever recorded version ${version} (note introduced in ${introCommit.slice(0, 8)}, after version.json existed)`,
    );
    continue;
  }

  if (recorded.build !== build || recorded.buildDate !== date) {
    problems.push(
      `${relative}: says Build: ${build} / Date: ${date}, but version.json at ${recorded.commit.slice(0, 8)} (the commit that introduced ${version}) records build ${recorded.build} / buildDate ${recorded.buildDate}`,
    );
  }
}

assert.deepEqual(
  problems,
  [],
  `release notes must match the build version.json recorded for their version:\n  - ${problems.join("\n  - ")}`,
);

if (skipped.length > 0) {
  console.log(
    `skipped ${skipped.length} note(s) written before version.json existed: ${skipped.join(", ")}`,
  );
}
if (pending.length > 0) {
  console.log(
    `accepted ${pending.length} uncommitted note(s) against the working-tree version.json: ${pending.join(", ")}`,
  );
}
if (unverified.length > 0) {
  console.log(`UNVERIFIED archival build claims (${unverified.length} notes imported without version history; wording checked only): ${unverified.join(', ')}`);
}
console.log(`release note build contracts passed (${noteFiles.length - unverified.length - skipped.length} build records checked; ${unverified.length + skipped.length} archival notes not build-verified)`);
