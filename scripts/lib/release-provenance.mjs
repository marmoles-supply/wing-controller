// Release facts have one source: version.json history. A filtered public
// snapshot retains a bounded, hashed record of that evidence, not private Git.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const noteSha256 = text => createHash('sha256').update(text).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
export function readReleaseHistory(root, revision = 'HEAD') {
  const commits = git(root, ['log', '--reverse', '--format=%H', revision, '--', 'version.json']).split('\n').filter(Boolean);
  if (!commits.length) throw new Error('Expected committed version.json history in this repository.');
  const recordedByVersion = new Map();
  for (const commit of commits) {
    const data = JSON.parse(git(root, ['show', `${commit}:version.json`]));
    if (data.version && data.build && data.buildDate && !recordedByVersion.has(data.version)) {
      recordedByVersion.set(data.version, { commit, build: data.build, buildDate: data.buildDate });
    }
  }
  return { firstVersionJsonCommit: commits[0], recordedByVersion };
}

export function strictlyPredates(root, ancestor, descendant) {
  return ancestor !== descendant && spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root }).status === 0;
}

export function createReleaseProvenance(root, revision) {
  const { firstVersionJsonCommit, recordedByVersion } = readReleaseHistory(root, revision);
  const names = git(root, ['ls-tree', '-r', '--name-only', revision, '--', 'desktop/release-notes']).split('\n').filter(name => name.endsWith('.md'));
  const notes = names.map(name => {
    const version = path.basename(name, '.md');
    const text = execFileSync('git', ['show', `${revision}:${name}`], { cwd: root, encoding: 'utf8' });
    const build = /^Build:\s*(\S+)/m.exec(text)?.[1];
    const buildDate = /^Date:\s*(\S+)/m.exec(text)?.[1];
    const recorded = recordedByVersion.get(version);
    if (recorded) {
      if (build !== recorded.build || buildDate !== recorded.buildDate) throw new Error(`Release note ${version} disagrees with version.json history.`);
      return { version, build, buildDate, sha256: noteSha256(text), status: 'version-json-history', recordedAt: recorded.commit };
    }
    const introducedAt = git(root, ['log', '--reverse', '--format=%H', revision, '--', name]).split('\n')[0];
    if (!build || !buildDate || (!strictlyPredates(root, introducedAt, firstVersionJsonCommit) && introducedAt !== firstVersionJsonCommit)) {
      throw new Error(`Release note ${version} has no historical build evidence; export refused.`);
    }
    // Imported notes in the first source snapshot have no earlier build record.
    // Freeze their wording, but explicitly retain the lack of verification.
    return { version, build, buildDate, sha256: noteSha256(text), status: introducedAt === firstVersionJsonCommit ? 'imported-without-build-evidence' : 'predates-version-json', introducedAt };
  });
  return { schemaVersion: 1, sourceRevision: revision, notes };
}

export function readArchivedReleaseProvenance(root) {
  const filename = path.join(root, 'desktop/release-notes/provenance.json');
  if (!fs.existsSync(filename)) return new Map();
  const archive = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (archive.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(archive.sourceRevision) || !Array.isArray(archive.notes) || !archive.notes.length) {
    throw new Error('Invalid archived release provenance.');
  }
  const records = new Map();
  for (const note of archive.notes) {
    if (!/^\d+\.\d+\.\d+$/.test(note.version) || !/^[a-f0-9]{64}$/.test(note.sha256)
      || !['version-json-history', 'predates-version-json', 'imported-without-build-evidence'].includes(note.status)
      || !/^[a-f0-9]{40}$/.test(note.status === 'version-json-history' ? note.recordedAt : note.introducedAt)
      || typeof note.build !== 'string' || typeof note.buildDate !== 'string' || records.has(note.version)) {
      throw new Error('Invalid or duplicate archived release note.');
    }
    records.set(note.version, note);
  }
  return records;
}
