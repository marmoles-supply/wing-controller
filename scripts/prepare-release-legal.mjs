#!/usr/bin/env node
// Conservative arm64 desktop notice/source inventory, including build dependencies.
// Original cached .crate bytes are checked against Cargo.lock, never reconstructed
// from a possibly modified registry checkout. MPL sources travel inside the app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (bin, args) => execFileSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const version = JSON.parse(fs.readFileSync(path.join(root, 'version.json'))).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
const destination = path.resolve(process.argv[2] || path.join(root, 'dist', `v${version}`, 'Legal'));
const bundle = path.dirname(destination);
if (fs.existsSync(destination)) {
  const expected = path.join(root, 'dist', `v${version}`, 'Legal');
  const issued = path.join(bundle, `WING_CONTROLLER_v${version}_AppleSilicon.dmg`);
  const marker = path.join(destination, '.wing-generated.json');
  const previous = JSON.parse(fs.readFileSync(fs.existsSync(marker) ? marker : path.join(destination, 'DEPENDENCIES.json')));
  if (destination !== expected || fs.existsSync(issued) || previous.schemaVersion !== 1 || previous.version !== version) throw Error(`Refusing to overwrite unrecognised or issued legal staging: ${destination}`);
  fs.rmSync(destination, { recursive: true });
}
const metadata = JSON.parse(run('cargo', ['metadata', '--locked', '--offline', '--filter-platform', 'aarch64-apple-darwin', '--format-version', '1']));
const packages = new Map(metadata.packages.map(p => [p.id, p]));
const nodes = new Map(metadata.resolve.nodes.map(n => [n.id, n]));
const start = metadata.packages.find(p => p.name === 'wing-controller-desktop');
if (!start) throw Error('Desktop package missing');
const pending = [start.id], seen = new Set();
while (pending.length) {
  const id = pending.pop();
  if (seen.has(id)) continue;
  seen.add(id);
  pending.push(...nodes.get(id).dependencies);
}
const selected = [...seen].map(id => packages.get(id)).filter(p => p.source).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
const lock = new Map(fs.readFileSync(path.join(root, 'Cargo.lock'), 'utf8').split('[[package]]').slice(1).map(block => {
  const value = key => new RegExp(`^${key} = "([^"]+)"`, 'm').exec(block)?.[1];
  return [`${value('name')}@${value('version')}`, value('checksum')];
}));
const rustRoot = run('rustc', ['--print', 'sysroot']).trim();
const rustDocs = [path.join(rustRoot, 'share/doc/rustc'), path.join(rustRoot, 'share/doc/rust/html')].find(p => fs.existsSync(path.join(p, 'COPYRIGHT-library.html')));
if (!rustDocs) throw Error('Rust standard-library notices are missing; install the matching Rust documentation first');
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, '.wing-generated.json'), JSON.stringify({ schemaVersion: 1, version, generator: 'prepare-release-legal.mjs' }) + '\n');
const sources = fs.mkdtempSync(path.join(bundle, '.third-party-sources-'));
const manifest = [];
const sections = ['Third-party notices for WING CONTROLLER ' + version,
  'Conservative Apple Silicon desktop Cargo closure, including build/proc-macro dependencies.\nThis is not proof that every listed package is linked into the optimised executable.\nOriginal third-party terms apply; the project no-sale condition does not restrict these components.\nFull pristine sources are available in the matching release asset; MPL-covered sources are also included here.'];
const isNotice = relative => /^(?:licen[cs]e|copying|copyright|notice|authors|unlicense)(?:[._-]|$)/i.test(path.posix.basename(relative))
  && (relative.split('/').length === 1 || /^(?:licen[cs]es?|notices?)\//i.test(relative));
const fallbackFiles = p => {
  if (p.name === 'alloc-stdlib') return ['LICENSE'];
  if (['dasp_sample', 'defmt-parser'].includes(p.name)) return ['LICENSE-MIT'];
  if (p.name === 'tauri-plugin') return ['LICENSE_MIT'];
  if (p.name.startsWith('unic-')) return ['LICENSE-MIT', 'COPYRIGHT.md', 'AUTHORS'];
  if (/^(?:objc2(?:-|$)|block2$|dispatch2$)/.test(p.name)) return ['LICENSE.md'];
  return [];
};
const cachedDownloads = new Map();
try {
  for (const p of selected) {
    const name = `${p.name}-${p.version}`;
    if (!/^[a-zA-Z0-9_.+-]+$/.test(name) || !p.license) throw Error(`Unreviewed package identity/licence: ${p.name}`);
    const pkgRoot = path.dirname(p.manifest_path);
    const registry = path.basename(path.dirname(pkgRoot));
    const archive = path.join(path.dirname(path.dirname(path.dirname(pkgRoot))), 'cache', registry, name + '.crate');
    const bytes = fs.readFileSync(archive);
    if (hash(bytes) !== lock.get(`${p.name}@${p.version}`)) throw Error(`Registry source checksum mismatch: ${name}`);
    const memberBytes = relative => execFileSync('tar', ['-xOf', archive, `${name}/${relative}`], { maxBuffer: 8 * 1024 * 1024 });
    if (!memberBytes('Cargo.toml').equals(fs.readFileSync(p.manifest_path))) throw Error(`Registry manifest differs from checked archive: ${name}`);
    const members = run('tar', ['-tzf', archive]).trim().split('\n');
    if (members.some(m => !m.startsWith(name + '/') || m.split('/').includes('..') || m.startsWith('/'))) throw Error(`Unsafe archive paths: ${name}`);
    fs.writeFileSync(path.join(sources, name + '.crate'), bytes);
    const record = { name: p.name, version: p.version, licence: p.license, authors: p.authors, repository: p.repository, sourceSha256: hash(bytes), notices: [] };
    const pkgNotices = path.join(destination, 'notices', name);
    fs.mkdirSync(pkgNotices, { recursive: true });
    sections.push(`\n=== ${name} ===\nDeclared licence: ${p.license}\nDeclared authors: ${p.authors.join('; ')}\nRepository: ${p.repository || 'see source archive'}`);
    const add = (file, data, origin) => {
      const safe = file.replaceAll(path.sep, '__');
      fs.writeFileSync(path.join(pkgNotices, safe), data);
      record.notices.push({ file: safe, origin, sha256: hash(data) });
      sections.push(`\n--- ${file} (${origin}) ---\n${data.toString('utf8')}`);
    };
    const files = members.filter(m => !m.endsWith('/')).map(m => m.slice(name.length + 1)).filter(isNotice);
    for (const file of files) add(file, memberBytes(file), 'pristine crate contents');
    if (!files.length && p.name === 'selectors') {
      add('MPL-header.txt', Buffer.from(memberBytes('lib.rs').toString('utf8').split('\n').slice(0, 4).join('\n') + '\n'), 'selectors lib.rs');
    } else if (!files.length) {
      const fallback = fallbackFiles(p);
      const vcs = JSON.parse(memberBytes('.cargo_vcs_info.json'));
      const repository = p.repository?.replace(/\.git$/, '').replace(/\/$/, '');
      if (!fallback.length || !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(vcs.git.sha1)) throw Error(`Missing reviewed notice fallback: ${name}`);
      for (const file of fallback) {
        const url = `${repository.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/${vcs.git.sha1}/${file}`;
        if (!cachedDownloads.has(url)) cachedDownloads.set(url, Buffer.from(run('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '30', url])));
        add(file, cachedDownloads.get(url), url);
      }
      // objc2's upstream LICENSE.md declares MIT but links the full terms.
      // Preserve authors/source, the exact declaration and the standard permission text.
      if (/^(?:objc2(?:-|$)|block2$|dispatch2$)/.test(p.name)) add('MIT-permission.txt', Buffer.from(fs.readFileSync(path.join(rustDocs, 'licenses/MIT.txt'), 'utf8').replace(/^Copyright \(c\) <year> <copyright holders>\n/m, '')), 'standard MIT permission text; attribution remains in upstream sources/metadata');
    }
    if (p.license.includes('MPL-2.0')) {
      fs.mkdirSync(path.join(destination, 'covered-sources'), { recursive: true });
      fs.writeFileSync(path.join(destination, 'covered-sources', name + '.crate'), bytes);
    }
    manifest.push(record);
  }
  fs.copyFileSync(path.join(rustDocs, 'COPYRIGHT-library.html'), path.join(destination, 'Rust-standard-library-copyright.html'));
  fs.cpSync(path.join(rustDocs, 'licenses'), path.join(destination, 'Rust-licences'), { recursive: true });
  sections.push('\nRust standard-library notices and complete licence texts are included separately in this Legal folder.');
  fs.writeFileSync(path.join(destination, 'THIRD-PARTY-NOTICES.txt'), sections.join('\n\n') + '\n');
  fs.writeFileSync(path.join(destination, 'DEPENDENCIES.json'), JSON.stringify({ schemaVersion: 1, version, target: 'aarch64-apple-darwin', rustc: run('rustc', ['--version']).trim(), scope: 'desktop dependency closure including build/proc-macro dependencies', packages: manifest }, null, 2) + '\n');
  for (const [name, template] of [['LICENSE', 'LICENSE'], ['DISCLAIMER.md', 'publication/DISCLAIMER.md'], ['THIRD_PARTY.md', 'publication/THIRD_PARTY.md']]) {
    const source = fs.existsSync(path.join(root, name)) ? name : template;
    fs.copyFileSync(path.join(root, source), path.join(destination, name));
  }
  const sourceInfo = `Corresponding source for WING CONTROLLER ${version}\n\nOriginal application: https://github.com/marmoles-supply/wing-controller/tree/v${version}\nDownload: https://github.com/marmoles-supply/wing-controller/archive/refs/tags/v${version}.tar.gz\n\nPristine third-party crate sources: https://github.com/marmoles-supply/wing-controller/releases/download/v${version}/THIRD_PARTY_SOURCES_v${version}.tar.gz\nEach .crate archive is verified against Cargo.lock; DEPENDENCIES.json records hashes and upstream notices.\nMPL-covered sources are also in covered-sources/; their full MPL terms are in notices/.\nThird-party sources keep their original terms, including their redistribution/commercial permissions.\nRust standard-library source: https://github.com/rust-lang/rust/tree/${run('rustc', ['-vV']).match(/^commit-hash: (\S+)/m)?.[1]}/library\nBuild instructions are in the tagged README. Use your own signing identity; private maintainer keys are not required.\n`;
  fs.writeFileSync(path.join(destination, 'SOURCE.txt'), sourceInfo);
  fs.writeFileSync(path.join(sources, 'README.txt'), sourceInfo);
  fs.copyFileSync(path.join(destination, 'DEPENDENCIES.json'), path.join(sources, 'DEPENDENCIES.json'));
  run('tar', ['-czf', path.join(bundle, `THIRD_PARTY_SOURCES_v${version}.tar.gz`), '-C', sources, '.']);
  console.log(`Prepared ${manifest.length} checked upstream source archives, preserved notices, MPL sources and Rust notices.`);
} finally {
  fs.rmSync(sources, { recursive: true, force: true });
}
