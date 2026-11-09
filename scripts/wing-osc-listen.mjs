// Read-only WING OSC listener: keeps a /*S subscription alive and logs every
// message, so a real change event can be compared against a leaf-read reply.
// No console state is written.
//
// Usage: node wing-osc-listen.mjs <wing-ip> <local-ip> [durationSec]

import dgram from "node:dgram";

const [, , wingIp = "192.168.1.10", localIp = "0.0.0.0", durationArg = "90"] = process.argv;
const durationSec = Number(durationArg);
const OSC_PORT = 2223;
const RENEW_MS = 8000;

function parseOsc(buf) {
  const end = buf.indexOf(0);
  if (end <= 0) return null;
  const address = buf.toString("utf8", 0, end);
  let off = end + 1;
  while (off % 4 !== 0) off += 1;
  if (buf[off] !== 0x2c) return { address, tags: "", values: [] };
  const tagsEnd = buf.indexOf(0, off);
  const tags = buf.toString("utf8", off + 1, tagsEnd);
  off = tagsEnd + 1;
  while (off % 4 !== 0) off += 1;
  const values = [];
  for (const tag of tags) {
    if (tag === "i") { values.push(buf.readInt32BE(off)); off += 4; }
    else if (tag === "f") { values.push(Number(buf.readFloatBE(off).toFixed(4))); off += 4; }
    else if (tag === "s") {
      const stop = buf.indexOf(0, off);
      values.push(buf.toString("utf8", off, stop));
      off = stop + 1;
      while (off % 4 !== 0) off += 1;
    } else if (tag === "T") values.push(true);
    else if (tag === "F") values.push(false);
    else break;
  }
  return { address, tags, values };
}

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
const started = Date.now();
const received = [];
const stamp = () => ((Date.now() - started) / 1000).toFixed(3).padStart(7);

socket.on("message", (msg, rinfo) => {
  if (rinfo.address !== wingIp) return;
  const parsed = parseOsc(msg);
  received.push({ at: Number(stamp()), tags: parsed?.tags ?? "", address: parsed?.address ?? "?", values: parsed?.values ?? [] });
  console.log(`[t=${stamp()}s] RX ${String(msg.length).padStart(4)}B  ${parsed?.address ?? "<unparsed>"}  tags="${parsed?.tags ?? ""}"  ${JSON.stringify(parsed?.values ?? [])}`);
});

socket.bind(0, localIp, () => {
  console.log(`listening ${socket.address().address}:${socket.address().port} for ${durationSec}s`);
  console.log(`TX /*S now, then renew every ${RENEW_MS / 1000}s. Move a control on the console when you are ready.\n`);
  const tick = () => socket.send(Buffer.from("/*S\0"), OSC_PORT, wingIp);
  tick();
  const timer = setInterval(() => {
    console.log(`[t=${stamp()}s] TX -> /*S renew`);
    tick();
  }, RENEW_MS);

  setTimeout(() => {
    clearInterval(timer);
    console.log("\n================ SUMMARY ================");
    console.log(`packets: ${received.length}`);
    const shapes = {};
    for (const r of received) {
      const key = `${r.address}  tags="${r.tags}"  arity=${r.values.length}`;
      shapes[key] = (shapes[key] ?? 0) + 1;
    }
    for (const [key, count] of Object.entries(shapes)) console.log(`  ${String(count).padStart(4)}x  ${key}`);
    console.log("=========================================");
    socket.close();
    process.exit(0);
  }, durationSec * 1000);
});
