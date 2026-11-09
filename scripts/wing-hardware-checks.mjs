#!/usr/bin/env node
/**
 * What this console says about itself — the questions the document cannot settle.
 *
 * The catalogue's counts, the per-model rules and the FX tables are only as good as the desk in front of
 * us, and the app is used with every console of the family rather than with one. This script asks a
 * connected WING the questions that decide those rules, so the same measurement can be taken on a Rack,
 * a Compact or a full-size console and the answers compared:
 *
 *   1. the model the desk announces at discovery (the field every model-aware rule reads),
 *   2. the meter group lengths, read from the console itself (a parent node answers its child keys,
 *      which is the count — the numbers the decoder sizes its groups with),
 *   3. the FX slot models (`/fx/<n>/mdl`, which answers `NONE` on a slot that holds nothing),
 *   4. footnote 13's monitor level: is `/cfg/mon/<n>/$lvl` writable on this model, and does every bus
 *      answer at all,
 *   5. the safes node's spelling and the length of each mask,
 *   6. the `/cards/wlive/*` report leaves (they answer only when a card is in the slot).
 *
 * Everything is read-only except the monitor level, which is written back with the value it had and
 * verified; the script never touches a show's own settings. It prints the model family and the numbers,
 * never the desk's identity: the discovery name, serial and address are deliberately not printed, so its
 * output can be pasted into the documentation (project rule: no console identity in what the operator
 * reads).
 *
 * Usage: node scripts/wing-hardware-checks.mjs <host-address-on-the-desk's-network> [desk-address]
 *   e.g. node scripts/wing-hardware-checks.mjs 192.168.1.11 192.168.1.10
 *
 * The source address matters: a socket that binds "any" can leave by the wrong interface, and then the
 * desk never answers even though it is there. Bind the address the desk's own network gave this Mac.
 *
 * What this does not cover: the **native meter stream** (TCP 2222). `wing-probe meter-usb` connects
 * without binding a source address, so on a Mac with two interfaces it leaves by the wrong one and the
 * connection times out — the app itself binds correctly (`probe_wing_route`), which is why it streams
 * while the probe does not. Measuring the meter groups over the native stream therefore needs either a
 * source-bound probe or the app itself; the group lengths above come from the OSC nodes, and the decoder
 * is pinned by `cargo test -p wing-core`.
 */

import dgram from 'node:dgram';

const OSC_PORT = 2223;
const DISCOVERY_PORT = 2222;
const localAddress = process.argv[2];
const deskAddress = process.argv[3] || '192.168.1.10';

if (!localAddress) {
  console.error('usage: node scripts/wing-hardware-checks.mjs <host-address-on-the-desk\'s-network> [desk-address]');
  process.exit(2);
}

/** OSC pads every field to a four-byte boundary. */
const pad = (buffer) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)]);
const oscString = (value) => pad(Buffer.from(`${value}\0`, 'utf8'));

function oscMessage(address, tags, value) {
  const parts = [oscString(address), oscString(tags)];
  if (tags === ',i') {
    const argument = Buffer.alloc(4);
    argument.writeInt32BE(value);
    parts.push(argument);
  } else if (tags === ',f') {
    const argument = Buffer.alloc(4);
    argument.writeFloatBE(value);
    parts.push(argument);
  } else if (tags !== ',') {
    parts.push(oscString(String(value)));
  }
  return Buffer.concat(parts);
}

function parseOsc(message) {
  const addressEnd = message.indexOf(0);
  if (addressEnd <= 0) return null;
  const address = message.toString('utf8', 0, addressEnd);
  let offset = addressEnd + 1;
  while (offset % 4) offset += 1;
  if (message[offset] !== 0x2c) return { address, tags: '', values: [] };
  const tagEnd = message.indexOf(0, offset);
  const tags = message.toString('utf8', offset + 1, tagEnd);
  offset = tagEnd + 1;
  while (offset % 4) offset += 1;
  const values = [];
  for (const tag of tags) {
    if (tag === 'i') {
      values.push(message.readInt32BE(offset));
      offset += 4;
    } else if (tag === 'f') {
      values.push(Number(message.readFloatBE(offset).toFixed(4)));
      offset += 4;
    } else if (tag === 's') {
      const end = message.indexOf(0, offset);
      values.push(message.toString('utf8', offset, end));
      offset = end + 1;
      while (offset % 4) offset += 1;
    } else if (tag === 'T') {
      values.push(true);
    } else if (tag === 'F') {
      values.push(false);
    } else {
      break;
    }
  }
  return { address, tags, values };
}

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
let waiting = [];

socket.on('message', (message) => {
  const parsed = parseOsc(message);
  if (!parsed) return;
  const slot = waiting.find((entry) => entry.address === parsed.address && !entry.done);
  if (slot) {
    slot.done = true;
    slot.reply = parsed;
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function read(address, timeoutMs = 600) {
  const slot = { address, done: false };
  waiting.push(slot);
  socket.send(oscString(address), OSC_PORT, deskAddress);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !slot.done) await sleep(15);
  waiting = waiting.filter((entry) => entry !== slot);
  return slot.reply || null;
}

async function write(address, tags, value, settleMs = 400) {
  socket.send(oscMessage(address, tags, value), OSC_PORT, deskAddress);
  await sleep(settleMs);
  return read(address);
}

function show(label, reply, width = 30) {
  const text = reply
    ? reply.values.length > 8
      ? `${reply.values.length} child keys`
      : JSON.stringify(reply.values)
    : 'NO ANSWER';
  console.log(`   ${label.padEnd(width)} ${text}`);
}

async function discover() {
  const probe = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const reply = await new Promise((resolve) => {
    probe.on('message', (message) => resolve(message.toString('utf8')));
    probe.bind(DISCOVERY_PORT, localAddress, () => probe.send(Buffer.from('WING?\0'), DISCOVERY_PORT, deskAddress));
    setTimeout(() => resolve(null), 2500);
  });
  try {
    probe.close();
  } catch (_) {
    /* already closed */
  }
  return reply;
}

/**
 * How long this desk takes to answer, which is the number a "the app is slow" report needs.
 *
 * The app asked the console to identify itself (`WING?`) before **every** operator action until
 * 0.2.60, which is why a plain mute could take a second: each adapter that does not answer costs a
 * whole 650 ms timeout before the next one is tried, plus one more on the system default. The route is
 * remembered now, so these two numbers are what is left: the desk's own discovery time and its own
 * leaf-read time. A desk that answers discovery in 300 ms is a desk that made every action 300 ms
 * slower then, and this is where that shows.
 */
async function measureLatency() {
  const roundTrip = async (send, waitMs = 1500) => {
    const probe = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const started = process.hrtime.bigint();
    const answer = await new Promise((resolve) => {
      probe.on('message', (message) => resolve(message));
      probe.bind(0, localAddress, () => send(probe));
      setTimeout(() => resolve(null), waitMs);
    });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    try {
      probe.close();
    } catch (_) {
      /* already closed */
    }
    return { answer, elapsedMs };
  };
  const discovery = await roundTrip((probe) => probe.send(Buffer.from('WING?\0'), DISCOVERY_PORT, deskAddress));
  console.log(`   WING? discovery        ${discovery.answer ? `${discovery.elapsedMs.toFixed(1)} ms` : `no answer in ${discovery.elapsedMs.toFixed(0)} ms`}`);
  for (const address of ['/ch/1/mute', '/ch/1/fdr']) {
    const first = await roundTrip((probe) => probe.send(oscMessage(address, '', undefined), OSC_PORT, deskAddress));
    console.log(`   ${address.padEnd(20)} ${first.answer ? `${first.elapsedMs.toFixed(1)} ms` : `no answer in ${first.elapsedMs.toFixed(0)} ms`}`);
  }
}

socket.bind(0, localAddress, async () => {
  console.log(`bound ${socket.address().address} -> ${deskAddress}\n`);

  console.log('== 1. the model the desk announces ==');
  const discovery = await discover();
  if (discovery) {
    const fields = discovery.split(',');
    // The name, serial and address are this unit's identity and stay out of the output on purpose.
    console.log(`   reply fields: ${fields.length}`);
    console.log(`   model field:  ${JSON.stringify(fields[3] ?? null)}`);
  } else {
    console.log('   no discovery reply');
  }

  console.log('\n== 2. meter group lengths, read from the console ==');
  for (const node of [
    '/io/in/LCL', '/io/in/AUX', '/io/in/A', '/io/in/B', '/io/in/C', '/io/in/SC', '/io/in/USB',
    '/io/in/CRD', '/io/in/MOD', '/io/in/PLAY', '/io/in/AES', '/io/in/USR', '/io/in/OSC',
    '/io/out/LCL', '/io/out/A', '/io/out/B', '/io/out/C', '/io/out/SC', '/io/out/USB', '/io/out/CRD',
    '/io/out/MOD', '/io/out/REC', '/io/out/AES',
  ]) {
    show(node, await read(node, 700), 16);
  }

  console.log('\n== 3. the FX slot models ==');
  for (const slot of [1, 2, 3, 4, 9, 16]) {
    const reply = await read(`/fx/${slot}/mdl`, 600);
    console.log(`   /fx/${slot}/mdl${slot < 10 ? ' ' : ''} -> ${reply ? JSON.stringify(reply.values) : 'silent'}`);
  }

  console.log('\n== 4. footnote 13: is the monitor level writable on this model? ==');
  for (const bus of [1, 2]) {
    const pan = await read(`/cfg/mon/${bus}/pan`, 550);
    const before = await read(`/cfg/mon/${bus}/$lvl`, 550);
    console.log(`   bus ${bus}: pan ${pan ? JSON.stringify(pan.values) : 'NO ANSWER'} · $lvl ${before ? JSON.stringify(before.values) : 'NO ANSWER'}`);
    if (!before || before.values.length === 0) continue;
    const [rounded, normalised, decibels] = before.values;
    const forms = [
      [',i', Math.round(Number(normalised) * 1024) + 30, 'normalised int'],
      [',f', Number(normalised) + 0.03, 'normalised float'],
      [',f', Number(decibels) + 3, 'dB float'],
      [',s', String(Number(decibels) + 3), 'dB string'],
    ];
    let accepted = null;
    for (const [tags, value, label] of forms) {
      const after = await write(`/cfg/mon/${bus}/$lvl`, tags, value);
      const changed = after && JSON.stringify(after.values) !== JSON.stringify(before.values);
      console.log(`     ${tags} ${String(value).padEnd(9)} (${label.padEnd(16)}) -> ${changed ? 'ACCEPTED' : 'refused'}`);
      if (changed) {
        accepted = { tags, value };
        break;
      }
    }
    if (accepted) {
      const restore = accepted.tags === ',i'
        ? Math.round(Number(normalised) * 1024)
        : accepted.tags === ',f'
          ? Number(accepted.value) > Number(decibels) ? Number(normalised) : Number(decibels)
          : String(rounded);
      const back = await write(`/cfg/mon/${bus}/$lvl`, accepted.tags, restore);
      console.log(`     restored -> ${back ? JSON.stringify(back.values) : 'NO ANSWER'}`);
    } else {
      console.log('     read-only on this model (every write form refused)');
    }
  }

  console.log('\n== 5. the safes node ==');
  show('/$ctl/safes/output', await read('/$ctl/safes/output'), 22);
  for (const group of ['LCL', 'A', 'MOD', 'REC']) {
    const reply = await read(`/$ctl/safes/output/${group}`, 550);
    const length = reply && reply.values.length ? String(reply.values[0]).length : 0;
    console.log(`   /$ctl/safes/output/${group}`.padEnd(26) + ` mask of ${length} characters`);
  }
  show('/$ctl/safes/outpu/A', await read('/$ctl/safes/outpu/A', 500), 22);

  console.log('\n== 6. the /cards/wlive report leaves (they answer only with a card in the slot) ==');
  for (const leaf of [
    '$actlink', '$battstate', 'etime', 'sdfree', 'sdsize', 'sdstate', 'rate', 'sessionlen',
    'sessionpos', 'markerpos', 'tracks', 'linkedpos', 'errorcode',
  ]) {
    const reply = await read(`/cards/wlive/1/${leaf}`, 500);
    const label = `/cards/wlive/1/${leaf}`;
    console.log(`   ${label.padEnd(30)}${reply ? JSON.stringify(reply.values).slice(0, 50) : 'silent'}`);
  }

  console.log('\n== 7. how long this desk takes to answer (the number behind "the app is slow") ==');
  await measureLatency();

  console.log('\ndone');
  socket.close();
  process.exit(0);
});

setTimeout(() => {
  console.log('FATAL: no answer from the desk within 90 s');
  process.exit(1);
}, 90_000);
