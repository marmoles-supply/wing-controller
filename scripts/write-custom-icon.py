#!/usr/bin/env python3
"""Write the icon image into a bundle's custom-icon resource fork.

Why this exists
---------------
macOS 26 (Tahoe) forces an app's *legacy* icon into the system squircle: the artwork ends up composited
behind a system-drawn tile (the "black square" the owner kept seeing). The one thing it does not reshape is
a **custom icon** — the Finder's "Get Info -> paste icon" mechanism: an `Icon\\r` file at the root of the
bundle plus the kHasCustomIcon bit in `com.apple.FinderInfo`.

`scripts/set-custom-icon.sh` applies that with `NSWorkspace -setIcon:forFile:options:` through JXA. On this
machine (macOS 26.6.2, 25G83) that call sets the flag and creates `Icon\\r` but writes **no image**: the
resource fork stays absent, Finder falls back to the bundle's `icon.icns`, and the tile comes back. The
check only looked at the flag, so it reported `[ok] custom icon present` for an icon with no picture in it
— a check that lies, which is the failure mode this whole audit keeps finding.

So the resource fork is written here, by hand, in the classic format:

  header (16 bytes) | data area | resource map
  header: data offset (u32 BE), map offset (u32 BE), data length (u32), map length (u32)
  data area: for each resource, its length (u32) then its bytes
  resource map: a copy of the header, then type list, reference lists and the (empty) name list

The single resource is `icns` id -16455, which is the one the Finder and the Dock read for a custom icon.

Usage:
  scripts/write-custom-icon.py <bundle.app> <icon.icns>
  scripts/write-custom-icon.py --check <bundle.app>
"""

from __future__ import annotations

import os
import struct
import sys

ICNS_TYPE = b"icns"
ICNS_ID = -16455


def build_resource_fork(resources: list[tuple[bytes, int, bytes]]) -> bytes:
    """Return a classic resource fork holding `resources` as (type, id, data)."""
    data_area = bytearray()
    offsets: list[int] = []
    for _type, _res_id, data in resources:
        offsets.append(len(data_area))
        data_area += struct.pack(">I", len(data)) + data

    # Type list: one type, `icns`, with its reference list right behind it.
    type_list = bytearray()
    type_list += struct.pack(">H", len(resources) - 1)
    ref_list_rel = 2 + 8
    type_list += ICNS_TYPE + struct.pack(">HH", len(resources) - 1, ref_list_rel)

    ref_list = bytearray()
    for (_type, res_id, _data), offset in zip(resources, offsets):
        ref_list += struct.pack(">HH", res_id & 0xFFFF, 0xFFFF)  # id, no name
        ref_list += b"\x00"  # attributes
        ref_list += offset.to_bytes(3, "big")  # offset into the data area
        ref_list += b"\x00\x00\x00\x00"  # reserved for the handle

    name_list = b""
    data_offset = 256  # the conventional start of the data area
    map_offset = data_offset + len(data_area)
    # Between the map's copy of the header and its type list: the next resource map handle, the file
    # reference number, the fork attributes, and the offsets to the type list and the name list.
    type_list_rel = 16 + 12
    name_list_rel = type_list_rel + len(type_list) + len(ref_list)
    reserved = struct.pack(">IHHHH", 0, 0, 0, type_list_rel, name_list_rel)
    body = reserved + bytes(type_list) + bytes(ref_list) + name_list
    map_header = struct.pack(">IIII", data_offset, map_offset, len(data_area), 16 + len(body))

    fork = bytearray(data_offset)
    fork[0:16] = map_header
    fork += data_area
    fork += map_header
    fork += body
    return bytes(fork)


def resource_fork_path(bundle: str) -> str:
    return os.path.join(bundle, "Icon\r", "..namedfork", "rsrc")


def set_custom_icon_flag(bundle: str) -> None:
    """Set kHasCustomIcon (byte 8, bit 0x04) in the bundle's com.apple.FinderInfo.

    The Finder and the Dock only look at `Icon\r`'s resource fork when that bit is set, and `cp -R` onto a
    disk image copies the bit but not the fork — which is how the copy inside the DMG ended up with an `Icon`
    file, the flag, and no picture, while the installed copy looked right (measured 2026-10-02). Setting it
    here means one command gives a bundle both halves of the custom icon.

    Through `xattr`, because Python's `os.getxattr`/`os.setxattr` do not exist on macOS (it was the first
    thing this function tried, and the icon test caught it at once).
    """
    import subprocess

    info = bytearray(32)
    try:
        existing = subprocess.run(
            ["xattr", "-px", "com.apple.FinderInfo", bundle],
            capture_output=True,
            check=True,
            text=True,
        ).stdout
        parsed = bytes.fromhex("".join(existing.split()))
        if len(parsed) >= 32:
            info = bytearray(parsed[:32])
    except (subprocess.CalledProcessError, ValueError):
        pass  # no FinderInfo yet: the all-zero block below is the right starting point
    info[8] |= 0x04
    subprocess.run(
        ["xattr", "-wx", "com.apple.FinderInfo", info.hex(), bundle],
        check=True,
    )


def read_icns_resource(bundle: str) -> bytes | None:
    """Return the `icns` resource stored in the bundle's custom icon, or None."""
    path = resource_fork_path(bundle)
    try:
        with open(path, "rb") as handle:
            fork = handle.read()
    except OSError:
        return None
    if len(fork) < 16:
        return None
    data_offset, map_offset, _data_len, _map_len = struct.unpack(">IIII", fork[:16])
    if map_offset <= 0 or map_offset >= len(fork) or data_offset >= len(fork):
        return None
    # The map after its 16-byte header copy: next handle (4), file ref (2), attributes (2), then the
    # offsets to the type list and the name list (2 each).
    map_start = map_offset
    cursor = map_start + 16 + 4 + 2 + 2
    type_list_rel, _name_rel = struct.unpack(">HH", fork[cursor : cursor + 4])
    type_list_at = map_start + type_list_rel
    count = struct.unpack(">H", fork[type_list_at : type_list_at + 2])[0] + 1
    for index in range(count):
        entry = type_list_at + 2 + index * 8
        res_type = fork[entry : entry + 4]
        res_count = struct.unpack(">H", fork[entry + 4 : entry + 6])[0] + 1
        ref_rel = struct.unpack(">H", fork[entry + 6 : entry + 8])[0]
        if res_type != ICNS_TYPE:
            continue
        ref_at = type_list_at + ref_rel
        for ref_index in range(res_count):
            ref = ref_at + ref_index * 12
            offset = int.from_bytes(fork[ref + 5 : ref + 8], "big")
            length = struct.unpack(">I", fork[data_offset + offset : data_offset + offset + 4])[0]
            start = data_offset + offset + 4
            return fork[start : start + length]
    return None


def main() -> int:
    argv = sys.argv[1:]
    if len(argv) == 2 and argv[0] == "--check":
        bundle = argv[1]
        icon = read_icns_resource(bundle)
        if icon is None:
            print(f"[--] {bundle}: no custom icon image (only the flag, if anything)")
            return 1
        print(f"[ok] {bundle}: custom icon image present ({len(icon)} bytes of icns)")
        return 0
    if len(argv) != 2:
        print(__doc__)
        return 2
    bundle, source = argv
    with open(source, "rb") as handle:
        artwork = handle.read()
    if not artwork.startswith(b"icns"):
        print(f"Error: {source} is not an .icns file", file=sys.stderr)
        return 1
    icon_file = os.path.join(bundle, "Icon\r")
    with open(icon_file, "wb"):
        pass  # the marker file itself is empty; the image lives in its resource fork
    fork = build_resource_fork([(ICNS_TYPE, ICNS_ID, artwork)])
    with open(resource_fork_path(bundle), "wb") as handle:
        handle.write(fork)
    set_custom_icon_flag(bundle)
    written = read_icns_resource(bundle)
    if written is None or len(written) != len(artwork):
        print("Error: the resource fork was written but cannot be read back", file=sys.stderr)
        return 1
    print(f"[ok] wrote {len(artwork)} bytes of artwork into {bundle}/Icon")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
