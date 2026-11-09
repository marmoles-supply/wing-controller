// One-shot read-only WING get-reply capture.
// Sends argument-less leaf reads (exactly what the connect-time priming sends)
// and dumps the raw bytes, to settle what the first `,sff`/`,sfi` argument holds.
//
// Usage: node wing-osc-gets.mjs <wing-ip> <local-ip> [address ...]

import dgram from "node:dgram";

const argv = process.argv.slice(2);
const wingIp = argv[0] ?? "192.168.1.10";
// Bind any local interface by default; the kernel chooses the route to the
// requested console. An explicit local address remains supported.
const localIp = argv[1] ?? "0.0.0.0";
const addresses = argv.slice(2);
if (addresses.length === 0) addresses.push("/ch/36/fdr", "/ch/36/mute", "/ch/36/$fdr", "/ch/36/pan");

const OSC_PORT = 2223;

function parseOsc(buf) {
  const end = buf.indexOf(0);
  if (end <= 0) return null;
  const address = buf.toString("utf8", 0, end);
  let off = end + 1;
  while (off % 4 !== 0) off += 1;
  if (buf[off] !== 0x2c) return { address, tags: "", values: [], bytes: [] };
  const tagsEnd = buf.indexOf(0, off);
  const tags = buf.toString("utf8", off + 1, tagsEnd);
  off = tagsEnd + 1;
  while (off % 4 !== 0) off += 1;
  const values = [];
  const bytes = [];
  for (const tag of tags) {
    if (tag === "i") { values.push(buf.readInt32BE(off)); bytes.push(buf.subarray(off, off + 4).toString("hex")); off += 4; }
    else if (tag === "f") { values.push(Number(buf.readFloatBE(off).toFixed(4))); bytes.push(buf.subarray(off, off + 4).toString("hex")); off += 4; }
    else if (tag === "s") {
      const stop = buf.indexOf(0, off);
      values.push(buf.toString("utf8", off, stop));
      bytes.push(buf.subarray(off, stop).toString("hex"));
      off = stop + 1;
      while (off % 4 !== 0) off += 1;
    } else if (tag === "T") values.push(true);
    else if (tag === "F") values.push(false);
    else break;
  }
  return { address, tags, values, bytes };
}

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
const pending = new Map(addresses.map((a) => [a, true]));

socket.on("message", (msg, rinfo) => {
  if (rinfo.address !== wingIp) return;
  const parsed = parseOsc(msg);
  if (!parsed) return;
  if (pending.has(parsed.address)) pending.delete(parsed.address);
  console.log(`\n${parsed.address}  tags="${parsed.tags}"  arity=${parsed.values.length}`);
  console.log(`  hex    : ${msg.toString("hex")}`);
  parsed.values.forEach((value, index) => {
    const raw = parsed.bytes[index];
    let asAscii = "";
    if (typeof value === "string") {
      asAscii = ` as string -> ${JSON.stringify(value)}`;
    } else if (raw) {
      const chars = Buffer.from(raw, "hex").toString("latin1").replace(/[^\x20-\x7e]/g, ".");
      asAscii = ` rawBytesAsAscii -> "${chars}"`;
    }
    console.log(`  arg[${index}] : ${JSON.stringify(value)}  (${raw ?? "-"})${asAscii}`);
  });
  if (pending.size === 0) {
    console.log("\nall requested addresses answered.");
    socket.close();
    process.exit(0);
  }
});

socket.bind(0, localIp, () => {
  console.log(`bound ${socket.address().address}:${socket.address().port} -> WING ${wingIp}:${OSC_PORT}`);
  console.log(`read-only leaf reads: ${addresses.join(", ")}\n`);
  for (const address of addresses) socket.send(Buffer.from(`${address}\0`), OSC_PORT, wingIp);
});

setTimeout(() => {
  console.log(`\ntimeout. unanswered: ${[...pending.keys()].join(", ") || "none"}`);
  socket.close();
  process.exit(0);
}, 8000);
