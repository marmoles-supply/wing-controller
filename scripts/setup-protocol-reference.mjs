// Local-only acquisition. Both the upstream PDF and its pdftotext -layout output
// must match the independently measured hashes. Existing files are never replaced.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_REFERENCE, protocolReferencePath, readProtocolReference, sha256 } from './lib/protocol-reference.mjs';

export async function installProtocolReference({ pdfPath, destination = protocolReferencePath } = {}) {
  if (fs.existsSync(destination)) {
    readProtocolReference(destination);
    return { status: 'already-verified', textSha256: PROTOCOL_REFERENCE.textSha256 };
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-protocol-reference-'));
  try {
    let pdf;
    if (pdfPath) {
      if (fs.statSync(pdfPath).size !== PROTOCOL_REFERENCE.pdfBytes) throw new Error('Protocol PDF checksum/size mismatch. No reference was installed.');
      pdf = fs.readFileSync(pdfPath);
    }
    else {
      // macOS ships curl, which honours ordinary proxy configuration. Measured
      // here: Node's direct fetch timed out while the proxy-aware clients could
      // acquire this same pinned PDF. No new npm transport dependency is needed.
      const download = path.join(temp, 'download.pdf');
      try {
        execFileSync('curl', ['--fail', '--silent', '--show-error', '--location',
          '--proto', '=https', '--proto-redir', '=https', '--max-time', '45',
          '--max-filesize', String(PROTOCOL_REFERENCE.pdfBytes), '--output', download,
          PROTOCOL_REFERENCE.url], { stdio: 'pipe' });
      } catch { throw new Error('Protocol download failed. Check curl, network/proxy access and retry, or supply the pinned PDF with --pdf. No reference was installed.'); }
      pdf = fs.readFileSync(download);
    }
    if (pdf.length !== PROTOCOL_REFERENCE.pdfBytes || sha256(pdf) !== PROTOCOL_REFERENCE.pdfSha256) {
      throw new Error('Protocol PDF checksum/size mismatch. No reference was installed.');
    }
    const pdfFile = path.join(temp, 'reference.pdf');
    const textFile = path.join(temp, 'reference.txt');
    fs.writeFileSync(pdfFile, pdf);
    try { execFileSync('pdftotext', ['-layout', pdfFile, textFile], { stdio: 'pipe' }); }
    catch { throw new Error('Could not extract the protocol PDF. Install Poppler (pdftotext); the measured compatible version is 26.08.0.'); }
    readProtocolReference(textFile);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(textFile, destination, fs.constants.COPYFILE_EXCL);
    return { status: 'installed', textSha256: PROTOCOL_REFERENCE.textSha256 };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--check') {
      readProtocolReference();
      console.log('Maillot protocol reference: pinned text checksum verified.');
    } else if (!args.length || (args.length === 2 && args[0] === '--pdf')) {
      console.log(JSON.stringify(await installProtocolReference({ pdfPath: args[1] })));
    } else throw new Error('Usage: node scripts/setup-protocol-reference.mjs [--check | --pdf <local-pdf>]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
