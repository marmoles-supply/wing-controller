// A minimal, **deterministic** USTAR writer and reader, so the design kit's distributable tarball is a byte-for-byte
// function of the files that go into it.
//
// Why not shell out to `tar`. The acceptance test for the kit's artefact is ITEM 1's acceptance test — the artefact's
// copy of every file is byte-identical to its source, and regenerating produces the same bytes. A tarball produced by
// `tar` is not that: it records each file's mtime and its mode, so two packages built from the same sources an hour
// apart differ, and `tar` also differs between the bsdtar that ships with macOS and GNU tar. Worse, macOS has no
// `--mtime` on bsdtar, so the determinism would have to be arranged by a second tool that may not be installed. This
// writer is 120 lines and takes the two inputs that actually decide the bytes — the path and the content — so a
// byte-equality test over the tarball is a real contract rather than a race with the clock.
//
// What is fixed, and why: `mtime` is 0 (a tarball that says when it was built cannot be compared), `uid`/`gid` are 0
// and `uname`/`gname` are empty (who built it is not part of the artefact), the mode is `0o644` for every entry (the
// kit is read-only data; an executable bit here would be a decision nobody made), and entries are emitted in byte
// order of their names. The format is USTAR, which every `tar` on every platform can read back.
//
// The reader exists so a consumer, or this project's own test, can list the artefact's contents without unpacking it:
// `readTar` returns exactly what was written, including each entry's mode and size, so `tar -tzf` is never the only
// way to see what shipped.

import { gunzipSync, gzipSync } from 'node:zlib';

/// The USTAR block size. Every header and every file body is padded to a multiple of this, and the archive ends with
/// two zero blocks.
export const BLOCK = 512;
/// Only regular files go into the kit, so the type flag is the same for every entry.
const TYPE_REGULAR = 0x30; // "0"
/// Fixed so the bytes do not depend on the wall clock. See the header note.
const FIXED_MTIME = 0;
const FIXED_MODE = 0o644;

/// Octal in a fixed-width field, NUL-terminated, as USTAR requires. A value that does not fit throws rather than
/// being truncated: a silently mis-sized field is a tarball that lists and extracts wrongly.
function octalField(value, width, what) {
  const digits = Math.max(1, width - 1);
  const text = value.toString(8);
  if (text.length > digits) {
    throw new Error(`tar: ${what} ${value} does not fit in ${digits} octal digits — the USTAR form cannot carry it`);
  }
  return text.padStart(digits, '0') + '\0';
}

/// `dir/name` -> `{ prefix: 'dir', name: 'name' }`, using USTAR's prefix field so paths longer than 100 bytes still
/// fit. A path with no split that keeps both halves inside their fields is impossible for this kit (the longest
/// component is 31 bytes) and throws, rather than writing a name a reader would silently truncate.
function splitUstarPath(path) {
  if (Buffer.byteLength(path, 'utf8') <= 100) return { prefix: '', name: path };
  for (let index = path.length - 1; index > 0; index -= 1) {
    if (path[index] !== '/') continue;
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { prefix, name };
    }
  }
  throw new Error(`tar: the path ${path} cannot be expressed in the USTAR fields`);
}

/// One 512-byte USTAR header.
function headerFor(path, size) {
  const { prefix, name } = splitUstarPath(path);
  const header = Buffer.alloc(BLOCK, 0);
  Buffer.from(name, 'utf8').copy(header, 0);
  Buffer.from(octalField(FIXED_MODE, 8, 'mode'), 'ascii').copy(header, 100);
  Buffer.from(octalField(0, 8, 'uid'), 'ascii').copy(header, 108);
  Buffer.from(octalField(0, 8, 'gid'), 'ascii').copy(header, 116);
  Buffer.from(octalField(size, 12, 'size'), 'ascii').copy(header, 124);
  Buffer.from(octalField(FIXED_MTIME, 12, 'mtime'), 'ascii').copy(header, 136);
  // The checksum is computed with its own field read as spaces, then written as six octal digits, a NUL and a space.
  header.fill(0x20, 148, 156);
  header[156] = TYPE_REGULAR;
  Buffer.from('ustar\0', 'ascii').copy(header, 257);
  Buffer.from('00', 'ascii').copy(header, 263);
  Buffer.from(prefix, 'utf8').copy(header, 345);
  let sum = 0;
  for (const byte of header) sum += byte;
  Buffer.from(sum.toString(8).padStart(6, '0') + '\0 ', 'ascii').copy(header, 148);
  return header;
}

/// The archive, byte for byte. `files` is `{ path, body }`, where `body` is a Buffer or a string; the order of the
/// input does not matter, because it is sorted here. This is the whole determinism contract: same paths, same bytes,
/// same archive.
export function writeTar(files) {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  const chunks = [];
  for (const file of sorted) {
    const body = Buffer.isBuffer(file.body) ? file.body : Buffer.from(String(file.body), 'utf8');
    if (body.length % BLOCK !== 0) {
      const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK, 0);
      body.copy(padded);
      chunks.push(headerFor(file.path, body.length), padded);
    } else {
      chunks.push(headerFor(file.path, body.length), body);
    }
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(chunks);
}

/// The gzip of `writeTar`, with the gzip header's own mtime and OS byte zeroed so the compressed bytes are as fixed
/// as the archive inside them. Without this the tarball would differ on every run even though its contents did not.
export function writeTarGz(files) {
  return gzipSync(writeTar(files), { level: 9, mtime: 0 });
}

/// Every entry in a tarball, as `{ path, size, mode, type, body }`, in the order they were written. `input` may be a
/// gzipped tarball or a plain one; gzip is recognised by its two magic bytes.
export function readTar(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const tar = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
  const entries = [];
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const numeric = (start, length) => {
      const field = header.subarray(start, start + length).toString('ascii').replace(/\0.*$/, '').trim();
      return field ? parseInt(field, 8) : 0;
    };
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = numeric(124, 12);
    entries.push({
      path: prefix ? `${prefix}/${name}` : name,
      mode: numeric(100, 8),
      size,
      type: String.fromCharCode(header[156]),
      body: tar.subarray(offset + BLOCK, offset + BLOCK + size),
    });
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}
