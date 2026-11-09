// The consolidated changelog has to stay consolidated.
//
// `CHANGELOG.md` is the single record of every released version, and the release notes under
// `desktop/release-notes/` are the operator-facing text each desktop build ships. They are two views of the
// same releases, so a version with a note and no entry (or the reverse) is a release whose history went
// missing — which is exactly what the owner asked to fix when he asked for one changelog of all versions
// (2026-10-02). This test makes that invariant checkable, and keeps the document in the project's language:
// build documents are written in English.
//
// Run: node scripts/test-desktop-changelog.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

// Every `## [x]` heading in order.
const headings = [...changelog.matchAll(/^## \[([^\]]+)\][^\n]*$/gm)].map((match) => match[1]);
assert.ok(headings.length > 100, `the changelog must carry every version (found ${headings.length} sections)`);
assert.equal(headings[0], 'Unreleased', 'the newest work belongs in [Unreleased] at the top');

const versions = headings.map((heading) => heading.replace(/^Desktop\s+/, '').trim());
const notes = readdirSync(new URL('../desktop/release-notes/', import.meta.url))
  .filter((name) => name.endsWith('.md'))
  .map((name) => name.slice(0, -3))
  .sort();

const missing = notes.filter((version) => !versions.includes(version));
assert.deepEqual(
  missing,
  [],
  `every release note needs its changelog entry; missing: ${missing.join(', ')}`,
);

// No entry in Spanish: the project's build documents are English, and two of them slipped through in
// Spanish before this check existed. The marker list is deliberately made of words that do not occur in
// English prose, and the threshold is high enough that a quoted phrase cannot trip it.
const SPANISH = /\b(el|la|los|las|del|una|este|esta|estos|estas|desde|cuando|pero|sin embargo|más|está|están|hay|entre|sobre|antes|después|debe|puede|también|sólo|ningún|ninguna|cada|mientras|porque|aunque|hacia|según)\b/gi;
const entries = [...changelog.matchAll(/^## \[[^\]]+\][^\n]*\n([\s\S]*?)(?=^## \[|\Z)/gm)];
const suspects = entries
  .map((match) => ({
    heading: match[0].split('\n')[0],
    hits: (match[1].match(SPANISH) || []).length,
    lines: match[1].split('\n').length,
  }))
  .filter((entry) => entry.hits >= 10 && entry.hits / Math.max(1, entry.lines) > 0.15);
assert.deepEqual(
  suspects.map((entry) => `${entry.heading} (${entry.hits} markers in ${entry.lines} lines)`),
  [],
  'build documents are written in English; these entries look Spanish',
);

// The order is newest first, which is what makes the document readable top-down.
const dated = [...changelog.matchAll(/^## \[[^\]]+\] - (\d{4}-\d{2}-\d{2})$/gm)].map((match) => match[1]);
const sorted = [...dated].sort().reverse();
assert.deepEqual(dated, sorted, 'the sections must be newest first');

console.log(`desktop changelog contracts passed (${versions.length} versions, ${notes.length} release notes)`);
