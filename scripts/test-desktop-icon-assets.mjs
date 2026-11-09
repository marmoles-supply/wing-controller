// The macOS icon must stay transparent around the marble W.
//
// A previous icon shipped as a dark square with the logo flattened on top: in
// the Dock it read as a black tile instead of the marble W. The rule for this
// project is explicit — pure alpha around the W, never a dark background — and
// nothing checked it: eyeballing a favicon-sized render hides it.
//
// This test decodes the PNG alpha itself with node:zlib (IHDR + IDAT + the
// standard filters). It handles the two forms the artwork uses, 8-bit RGBA and
// 8-bit palette+alpha; any other colour type fails with a clear message rather
// than passing silently.
//
// Run: node scripts/test-desktop-icon-assets.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Thresholds derived from the current artwork (measured 2026-09-21):
//   desktop/ui/icon.png            512px  dark opaque  3.64%  transparent 64.2%
//   desktop/src-tauri/icons/icon.png 512px  dark opaque  3.64%  transparent 64.2%
//   32x32.png                       32px  dark opaque  0.55%  transparent 59.8%
//   128x128.png                    128px  dark opaque  2.49%  transparent 63.1%
//   icon.icns frames            32..1024px dark opaque 0.55-3.64%
// Flattening the artwork onto a dark background makes the ~64% transparent
// margin dark and opaque, so 8% is far below the flattened value while leaving
// room for a slightly darker marble texture.
const MAX_DARK_OPAQUE_FRACTION = 0.08;
const MIN_TRANSPARENT_FRACTION = 0.2;
const OPAQUE_ALPHA_MIN = 128;
const TRANSPARENT_ALPHA_MAX = 16;
const DARK_LUMA_MAX = 60;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buffer, label) {
  assert.ok(
    buffer.length > PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE),
    `${label} must be a real PNG (missing the 89 50 4E 47 signature)`,
  );

  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  assert.ok(header, `${label} must contain an IHDR chunk`);
  const { width, height, bitDepth, colorType, interlace } = header;
  assert.equal(
    interlace,
    0,
    `${label} is interlaced; this decoder only understands non-interlaced PNGs, refusing to pass it unverified`,
  );
  assert.equal(
    bitDepth,
    8,
    `${label} has bit depth ${bitDepth}; only 8-bit channels are decoded here, refusing to pass it unverified`,
  );

  // Colour type 6 is 8-bit RGBA; colour type 3 is an 8-bit palette plus an
  // alpha table in tRNS. Anything else cannot be verified here.
  let channels;
  if (colorType === 6) {
    channels = 4;
  } else if (colorType === 3) {
    channels = 1;
    assert.ok(palette, `${label} is palette-based but has no PLTE chunk, so its colours cannot be decoded`);
    assert.ok(
      transparency,
      `${label} is palette-based without a tRNS chunk: it has no alpha channel at all`,
    );
  } else {
    assert.fail(
      `${label} has colour type ${colorType}, which this test cannot decode (only 8-bit RGBA=6 and 8-bit palette+alpha=3 are handled): refusing to pass an unverified alpha channel`,
    );
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const line = raw.subarray(position, position + stride);
    position += stride;
    const current = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          value = (value + left) & 0xff;
          break;
        case 2:
          value = (value + up) & 0xff;
          break;
        case 3:
          value = (value + ((left + up) >> 1)) & 0xff;
          break;
        case 4: {
          const estimate = left + up - upLeft;
          const distanceLeft = Math.abs(estimate - left);
          const distanceUp = Math.abs(estimate - up);
          const distanceUpLeft = Math.abs(estimate - upLeft);
          const predictor =
            distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
              ? left
              : distanceUp <= distanceUpLeft
                ? up
                : upLeft;
          value = (value + predictor) & 0xff;
          break;
        }
        default:
          assert.fail(`${label} uses unknown PNG filter ${filter}`);
      }
      current[x] = value;
    }
  }

  const pixel = (x, y) => {
    const index = y * stride + x * channels;
    if (colorType === 6) {
      return { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2], a: pixels[index + 3] };
    }
    const paletteIndex = pixels[index];
    return {
      r: palette[paletteIndex * 3],
      g: palette[paletteIndex * 3 + 1],
      b: palette[paletteIndex * 3 + 2],
      a: paletteIndex < transparency.length ? transparency[paletteIndex] : 255,
    };
  };

  return { label, width, height, colorType, pixel };
}

function assertTransparentIcon(png) {
  const { label, width, height, colorType, pixel } = png;
  // The alpha channel must exist as such: RGBA, or a palette with a tRNS table.
  assert.ok(
    colorType === 6 || colorType === 3,
    `${label} must keep an alpha channel (colour type 6 RGBA or 3 palette+tRNS), got ${colorType}`,
  );

  // The frame's border must be pure alpha: corners and edge midpoints.
  const border = [
    ["top-left corner", 0, 0],
    ["top-right corner", width - 1, 0],
    ["bottom-left corner", 0, height - 1],
    ["bottom-right corner", width - 1, height - 1],
    ["top edge midpoint", width >> 1, 0],
    ["bottom edge midpoint", width >> 1, height - 1],
    ["left edge midpoint", 0, height >> 1],
    ["right edge midpoint", width - 1, height >> 1],
  ];
  for (const [name, x, y] of border) {
    const { a } = pixel(x, y);
    assert.ok(
      a <= TRANSPARENT_ALPHA_MAX,
      `${label}: the ${name} must be transparent (alpha ${a} <= ${TRANSPARENT_ALPHA_MAX}); a dark square fills the frame`,
    );
  }

  let opaque = 0;
  let darkOpaque = 0;
  let transparent = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { r, g, b, a } = pixel(x, y);
      if (a <= TRANSPARENT_ALPHA_MAX) transparent += 1;
      if (a >= OPAQUE_ALPHA_MIN) {
        opaque += 1;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (luma < DARK_LUMA_MAX) darkOpaque += 1;
      }
    }
  }

  const total = width * height;
  assert.ok(opaque > 0, `${label} is entirely transparent: the marble W is missing`);
  const transparentFraction = transparent / total;
  assert.ok(
    transparentFraction >= MIN_TRANSPARENT_FRACTION,
    `${label}: only ${(transparentFraction * 100).toFixed(1)}% of the frame is transparent (expected >= ${MIN_TRANSPARENT_FRACTION * 100}%); the artwork was flattened onto an opaque background`,
  );
  const darkFraction = darkOpaque / opaque;
  assert.ok(
    darkFraction <= MAX_DARK_OPAQUE_FRACTION,
    `${label}: ${(darkFraction * 100).toFixed(1)}% of the opaque pixels are dark (expected <= ${MAX_DARK_OPAQUE_FRACTION * 100}%); the W sits on a dark square instead of on alpha`,
  );
}

// --- The PNG assets --------------------------------------------------------
for (const relative of [
  "desktop/ui/icon.png",
  "desktop/src-tauri/icons/icon.png",
  "desktop/src-tauri/icons/32x32.png",
  "desktop/src-tauri/icons/128x128.png",
]) {
  const absolute = path.join(repoRoot, relative);
  assert.ok(fs.existsSync(absolute), `${relative} must exist`);
  assertTransparentIcon(decodePng(fs.readFileSync(absolute), relative));
}

console.log("icon PNG transparency contracts passed");

// --- The .icns bundle ------------------------------------------------------
// The modern icns entries are plain PNGs inside the container; the older
// is32/s8mk/il32/l8mk entries are not, and are ignored.
const ICNS_MAGIC = Buffer.from("icns", "ascii");
const MODERN_ICNS_PNG_ENTRIES = ["ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"];

const icnsPath = path.join(repoRoot, "desktop/src-tauri/icons/icon.icns");
assert.ok(fs.existsSync(icnsPath), "desktop/src-tauri/icons/icon.icns must exist");
const icns = fs.readFileSync(icnsPath);
assert.ok(icns.length > 8, "icon.icns is too small to be a real icns container");
assert.ok(
  icns.subarray(0, 4).equals(ICNS_MAGIC),
  "icon.icns must start with the `icns` magic",
);
assert.equal(
  icns.readUInt32BE(4),
  icns.length,
  "icon.icns declares a length that does not match the file: the container is truncated or padded",
);

const entries = new Map();
let offset = 8;
while (offset + 8 <= icns.length) {
  const type = icns.toString("ascii", offset, offset + 4);
  const length = icns.readUInt32BE(offset + 4);
  assert.ok(
    length >= 8 && offset + length <= icns.length,
    `icon.icns entry ${type} declares an invalid length ${length}`,
  );
  if (!entries.has(type)) entries.set(type, icns.subarray(offset + 8, offset + length));
  offset += length;
}

for (const type of MODERN_ICNS_PNG_ENTRIES) {
  const frame = entries.get(type);
  assert.ok(frame, `icon.icns must embed the ${type} PNG frame`);
  assertTransparentIcon(decodePng(frame, `icon.icns ${type}`));
}

console.log("icns transparency contracts passed");
// --- The automatic macOS 26 tile fix, pinned as a contract ------------------------------------
// The custom icon is Finder metadata and cannot be applied before signing: the build applies it
// afterwards and checks it, and the unblock step (whose `xattr -cr` is exactly what erases it) puts it
// back. If those steps go away, the tile returns and nobody notices until the operator sees it.
const buildScript = fs.readFileSync("desktop/build-dist.sh", "utf8");
assert.match(buildScript, /set-custom-icon\.sh/,
  "the build must apply the custom icon (see docs/ICON_MACOS26.md)");
assert.match(buildScript, /set-custom-icon\.sh --check/,
  "and it must check that it really landed in the bundle");
assert.match(buildScript, /Unblock WING CONTROLLER\.command/,
  "the unblock helper must be generated, under its English name (build documents are English)");
assert.doesNotMatch(buildScript, /Desbloquear/,
  "no Spanish filename may come back into what the build ships");
assert.match(buildScript, /\$DIR\/set-custom-icon\.sh/,
  "the unblock step must restore the icon its own `xattr -cr` wipes");
// The copy inside the image and the ZIP: `cp -R` copies the icon's flag but not its resource fork, and the
// `xattr -cr` that keeps the signature verifiable removes both, so an app run from the mounted image showed
// macOS 26's dark tile while the installed copy looked right (owner's report, 2026-10-02).
assert.match(buildScript, /write-custom-icon\.py" "\$MOUNT_PATH\/WING CONTROLLER\.app"/,
  "the build must write the icon into the copy inside the image");
assert.match(buildScript, /write-custom-icon\.py" --check "\$MOUNT_PATH\/WING CONTROLLER\.app"/,
  "and refuse to ship that copy without the picture");
assert.match(buildScript, /write-custom-icon\.py" --check[\s\S]{0,120}ZIP_STAGING/,
  "the same for the copy inside the ZIP");
// And the changelog travels with both artefacts, which the owner asked for explicitly.
assert.match(buildScript, /cp "\$ROOT_DIR\/CHANGELOG\.md" "\$MOUNT_PATH\/CHANGELOG\.md"/,
  "the image must carry the consolidated changelog");
// The build's own variable is `APP_VERSION` (and `RELEASE_NOTES_FILE` is the source): `$VERSION` does not
// exist in that scope, and the first attempt at this copy died with "VERSION: unbound variable".
assert.match(buildScript, /cp "\$RELEASE_NOTES_FILE" "\$MOUNT_PATH\/RELEASE NOTES \$\{APP_VERSION\}\.md"/,
  "and this version's release note beside it");
assert.match(buildScript, /cp "\$RELEASE_NOTES_FILE" "\$ZIP_STAGING[^"]*RELEASE NOTES \$\{APP_VERSION\}\.md"/,
  "in the ZIP as well as the image");
const verifyInstall = fs.readFileSync("scripts/verify-install.sh", "utf8");
assert.match(verifyInstall, /the DMG carries the changelog/,
  "and the release verification must check the changelog is really in the image");
assert.match(verifyInstall, /the app inside the DMG carries its icon image/,
  "as well as the icon on the copy inside the image");

const iconHelper = fs.readFileSync("scripts/set-custom-icon.sh", "utf8");
assert.match(iconHelper, /pgrep -f -- "\^\$\{APP_PATH\}\/Contents\/MacOS\/"/,
  "the running-app check must be anchored to the path, or any open copy blocks it");

// The custom icon needs its **image**, not only the flag.
//
// `NSWorkspace -setIcon:forFile:options:` sets kHasCustomIcon and creates `Icon\r` while leaving the
// resource fork empty on macOS 26.6.2 (25G83): Finder then falls back to the bundle's icon.icns and the
// system tile comes back — the black square the owner kept seeing, while this project's own check said
// "custom icon present". `scripts/write-custom-icon.py` writes the image itself, and the format is subtle
// enough that it was wrong the first time (the map's 12 reserved bytes), so it is round-tripped here.
{
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wing-icon-"));
  const bundle = path.join(tmp, "Fake.app");
  fs.mkdirSync(path.join(bundle, "Contents", "Resources"), { recursive: true });
  const artwork = fs.readFileSync("desktop/ui/icon.png").length
    ? Buffer.concat([Buffer.from("icns"), Buffer.alloc(2048, 7)])
    : Buffer.alloc(0);
  const source = path.join(tmp, "source.icns");
  fs.writeFileSync(source, artwork);
  execFileSync("python3", ["scripts/write-custom-icon.py", bundle, source], { stdio: "pipe" });
  const check = execFileSync("python3", ["scripts/write-custom-icon.py", "--check", bundle], { encoding: "utf8" });
  assert.match(check, /custom icon image present/, `the written icon must read back: ${check.trim()}`);
  // And the stored bytes must be the artwork, not a prefix of it or the map.
  const reader = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('w', 'scripts/write-custom-icon.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
stored = module.read_icns_resource(sys.argv[1])
sys.stdout.write(str(len(stored) if stored else 0))
`;
  const storedLength = Number(execFileSync("python3", ["-c", reader, bundle], { encoding: "utf8" }));
  assert.equal(storedLength, artwork.length, "the image read back must be exactly what was written");
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("desktop icon asset contracts passed");
