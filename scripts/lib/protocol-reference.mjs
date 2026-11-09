// Maillot WING Remote Protocols 3.1-03 is the pinned input of the existing
// protocol-path and model-table audits. Acquire locally; never redistribute the
// complete manual or extraction as part of this project's source snapshot.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_REFERENCE = Object.freeze({
  url: 'https://cdn-media.empowertribe.com/2106004e217b8eb2639d93672823eef5/WING_Remote-Protocols-3.1-03.pdf',
  pdfBytes: 38245609,
  pdfSha256: 'b4496d27440e47b63729ac16786a631224e4c0a21efb9fda7f378d40ed6589ce',
  textSha256: 'f06099e4b75c56f4ec0a51c389cac5570de21ed5e2bb2405848e6c81d8cea01d',
});
export const protocolReferencePath = fileURLToPath(new URL('../../scratch/wing_protocols.txt', import.meta.url));
export const sha256 = data => createHash('sha256').update(data).digest('hex');

export function readProtocolReference(filename = protocolReferencePath, { pinned = true } = {}) {
  if (!fs.existsSync(filename)) {
    throw new Error('Maillot protocol reference is missing. Install Poppler, then run node scripts/setup-protocol-reference.mjs (see docs/PROTOCOL_REFERENCE.md).');
  }
  const data = fs.readFileSync(filename);
  if (pinned && sha256(data) !== PROTOCOL_REFERENCE.textSha256) {
    throw new Error('The local Maillot reference differs from the pinned revision. It will not be overwritten. Use an explicit --protocols path for an intentional alternate audit.');
  }
  return data.toString('utf8');
}
