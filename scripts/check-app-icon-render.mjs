// What does macOS actually draw for this application?
//
// The owner kept seeing the system's dark tile instead of the marble W — sometimes right after running the
// DMG's unblock command, sometimes not — and no file on disk could answer it: the `.icns` was correct, the
// custom icon's resource fork was correct, and `--check` said so. What matters is what the **system** hands
// back for that bundle, which is `NSWorkspace.iconForFile` (Finder and the Dock both go through it). This
// asks it, renders the bundle's own `.icns` at the same size, and compares the two pixel by pixel.
//
//   node scripts/check-app-icon-render.mjs [bundle path]
//
// Exit 0 when the system returns the bundle's own artwork; non-zero when it returns something else — which
// is the failure the owner reported, and which no earlier check could see.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bundle = process.argv[2] || '/Applications/WING CONTROLLER.app';
const icns = join(bundle, 'Contents', 'Resources', 'icon.icns');
const work = mkdtempSync(join(tmpdir(), 'wing-icon-'));

const run = (command, args) => execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

// 1. The system's answer for the bundle.
const jxa = `
ObjC.import('AppKit');
ObjC.import('Foundation');
const icon = $.NSWorkspace.sharedWorkspace.iconForFile(${JSON.stringify(bundle)});
const rep = $.NSBitmapImageRep.imageRepWithData(icon.TIFFRepresentation);
const png = rep.representationUsingTypeProperties($.NSPNGFileType, $());
png.writeToFileAtomically(${JSON.stringify(join(work, 'system.png'))}, true);
`;
const jxaPath = join(work, 'icon.js');
execFileSync('bash', ['-c', `cat > ${JSON.stringify(jxaPath)} <<'JXA'\n${jxa}\nJXA`]);
run('osascript', ['-l', 'JavaScript', jxaPath]);

// 2. The bundle's own artwork, at the same size.
run('sips', ['-s', 'format', 'png', '-Z', '256', icns, '--out', join(work, 'icns.png')]);
run('sips', ['-Z', '256', join(work, 'system.png'), '--out', join(work, 'system-scaled.png')]);

// 3. Compare the **pixels**. Two PNGs of the same picture can differ in bytes (metadata, encoder choices),
//    which is exactly how the first version of this check managed to lie: it hashed the re-encoded files.
//    BMP is uncompressed, so identical pixels produce identical bytes.
const pixels = (path) => {
  const bmp = join(work, `${path.split('/').pop()}.bmp`);
  run('sips', ['-s', 'format', 'bmp', path, '--out', bmp]);
  const data = readFileSync(bmp);
  // Skip the 14-byte file header and the DIB header, whose size is the first field after it.
  const dibSize = data.readUInt32LE(14);
  return { header: data.subarray(0, 14 + dibSize).toString('base64'), body: data.subarray(14 + dibSize) };
};
const system = { hash: 0, bytes: 0, ...(() => {
  const { header, body } = pixels(join(work, 'system-scaled.png'));
  let hash = 0;
  for (let i = 0; i < body.length; i += 1) hash = (hash * 31 + body[i]) | 0;
  return { hash, bytes: body.length, header };
})() };
const ours = (() => {
  const { header, body } = pixels(join(work, 'icns.png'));
  let hash = 0;
  for (let i = 0; i < body.length; i += 1) hash = (hash * 31 + body[i]) | 0;
  return { hash, bytes: body.length, header };
})();

if (system.hash === ours.hash) {
  console.log(`app icon render: the system returns the bundle's own artwork (${ours.bytes} bytes)`);
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}
console.error('app icon render: macOS is NOT showing the bundle\'s artwork for this app.');
console.error(`  bundle      : ${bundle}`);
console.error(`  system icon : ${system.hash} (${system.bytes} bytes)`);
console.error(`  bundle icns : ${ours.hash} (${ours.bytes} bytes)`);
console.error('  This is the dark tile the owner kept seeing. The custom icon (Icon\\r + com.apple.FinderInfo)');
console.error('  and the cache invalidation are what make the system prefer the artwork; if this fails, run');
console.error('  scripts/set-custom-icon.sh on the bundle and check again.');
rmSync(work, { recursive: true, force: true });
process.exit(1);
