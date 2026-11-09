// Read-only WING OSC subscription probe.
// Answers one design question: after a /*S subscription, does the console
// re-publish state on its own or when the subscription is renewed, or does it
// only report changes? That decides whether an OSC condition cache can go stale.
//
// It never writes console state: only `/*S` (subscribe) and argument-less leaf
// reads, which are the exact frames the desktop priming path sends.
//
// Usage: node wing-osc-probe.mjs <wing-ip> <local-ip> [durationSec]

import dgram from "node:dgram";

const [, , wingIp = "192.168.1.10", localIp = "0.0.0.0", durationArg = "30"] = process.argv;
const durationSec = Number(durationArg);
const OSC_PORT = 2223;

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
const marks = [];

const stamp = () => ((Date.now() - started) / 1000).toFixed(3).padStart(7);

socket.on("message", (msg, rinfo) => {
  if (rinfo.address !== wingIp) return;
  const parsed = parseOsc(msg);
  received.push({ at: Number(stamp()), address: parsed?.address ?? "?", tags: parsed?.tags ?? "", values: parsed?.values ?? [], bytes: msg.length });
  console.log(`[t=${stamp()}s] RX ${String(msg.length).padStart(4)}B  ${parsed?.address ?? "<unparsed>"}${parsed?.tags ? `  (${parsed.tags}) ${JSON.stringify(parsed.values)}` : ""}`);
});

const send = (label, payload) => {
  socket.send(payload, OSC_PORT, wingIp, (error) => {
    if (error) console.error(`send failed (${label}):`, error.message);
    else console.log(`[t=${stamp()}s] TX -> ${label}`);
  });
};

socket.bind(0, localIp, () => {
  console.log(`bound ${socket.address().address}:${socket.address().port} -> WING ${wingIp}:${OSC_PORT}`);
  console.log(`running ${durationSec}s. Read-only: /*S and leaf reads, no state writes.\n`);

  send("/*S (subscribe)", Buffer.from("/*S\0"));

  const plan = [
    { at: 5, run: () => {
        send("read /ch/36/fdr", Buffer.from("/ch/36/fdr\0"));
        send("read /ch/36/mute", Buffer.from("/ch/36/mute\0"));
      } },
    { at: 10, run: () => send("/*S renew #1", Buffer.from("/*S\0")) },
    { at: 20, run: () => send("/*S renew #2", Buffer.from("/*S\0")) },
  ];
  for (const step of plan) {
    setTimeout(() => { marks.push({ at: step.at, label: "renew-or-read" }); step.run(); }, step.at * 1000);
  }

  setTimeout(() => {
    console.log("\n================ SUMMARY ================");
    console.log(`packets received : ${received.length}`);
    const unique = [...new Set(received.map((r) => r.address))].sort();
    console.log(`unique addresses : ${unique.length}`);
    for (const address of unique.slice(0, 25)) {
      const hits = received.filter((r) => r.address === address);
      console.log(`   ${address.padEnd(28)} ${hits.length} pkt   first@${hits[0].at}s  last@${hits.at(-1).at}s`);
    }
    if (unique.length > 25) console.log(`   ... ${unique.length - 25} more`);
    const bursts = [10, 20];
    for (const t of bursts) {
      const window = received.filter((r) => r.at >= t && r.at < t + 1.5);
      console.log(`packets in the 1.5s after the renew at t=${t}s : ${window.length}`);
    }
    const gap = received.length ? received.at(-1).at : 0;
    console.log(`last packet at   : t=${gap}s`);
    console.log("=========================================");
    socket.close();
    process.exit(0);
  }, durationSec * 1000);
});
