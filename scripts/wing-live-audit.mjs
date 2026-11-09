// Live catalogue audit against a real console.
//
// Every address the target catalogue resolves is read, and every writable leaf the console reports
// is written back with the value it just reported and re-read. A write-back is, by definition, the
// value the console is already holding, so the desk does not change state; what it proves is that
// the leaf answers a read and accepts a write of the kind the app sends.
//
// Usage:
//   cargo run -q -p wing-probe -- paths-full > /tmp/paths.tsv
//   node scripts/wing-live-audit.mjs /tmp/paths.tsv <local-ip> [wing-ip] [--write] [--only <category>]
//
// The first run (2026-09-26, WING Rack FW 3.1.1) covered 745 addresses: 691 answered, 54
// stayed silent and every one of those is explained (53 model parameters whose model is not loaded
// and the write-only `/rec/path`), and all 646 write-backs landed. `--write` is what runs the
// second half; without it the script only reads.
//
// A silent address is a finding unless it is a model parameter (`paths-full` marks those) or a key
// the console does not report (`can_trigger` false): a leaf the app writes and cannot read back is
// exactly the class this audit exists to catch.
// Live catalogue audit: every resolved address is read, and (with --write) every reported writable
// leaf gets the value it just reported written back and re-read. Nothing on the desk changes state:
// a write-back is, by definition, the value the console is already holding.
//
//   node /tmp/wing-audit.mjs <paths.tsv> <localIp> [wingIp] [--write] [--only <category>]
import fs from 'node:fs';
import dgram from 'node:dgram';

const [tsvPath, localIp, ...rest] = process.argv.slice(2);
const wingIp = rest[0] && !rest[0].startsWith('--') ? rest[0] : '192.168.1.10';
const flags = rest.filter((arg) => arg.startsWith('--'));
const doWrite = flags.includes('--write');
const onlyIndex = rest.indexOf('--only');
const only = onlyIndex >= 0 ? rest[onlyIndex + 1] : null;

const rows = fs.readFileSync(tsvPath, 'utf8').trim().split('\n')
  .map((line) => line.split('\t'))
  .filter((parts) => parts.length >= 6 && !parts[2].startsWith('/meters/'))
  .filter((parts) => !only || parts[0] === only)
  .map(([category, key, address, argKind, canTrigger, writable, model]) => ({
    category, key, address, argKind,
    canTrigger: canTrigger === 'true',
    writable: writable === 'true',
    model: model === 'true',
  }));

const OSC = 2223;
const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const oscStr = (s) => pad(Buffer.from(`${s}\0`));
const encode = (address, tag, value) => {
  const parts = [oscStr(address), oscStr(tag)];
  if (tag === ',i') { const b = Buffer.alloc(4); b.writeInt32BE(value); parts.push(b); }
  else if (tag === ',f') { const b = Buffer.alloc(4); b.writeFloatBE(value); parts.push(b); }
  else if (tag === ',s') parts.push(oscStr(value));
  return Buffer.concat(parts);
};
// Self-check: the app's own encoder test pins these bytes for /ch/1/mute = 1.
const probe = encode('/ch/1/mute', ',i', 1).toString('hex');
const expected = '2f63682f312f6d75746500002c69000000000001';
if (probe !== expected) { console.error(`encoder self-check failed: ${probe}`); process.exit(1); }

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
let waiting = [];
const parse = (b) => {
  const end = b.indexOf(0); if (end <= 0) return null;
  const address = b.toString('utf8', 0, end);
  let off = end + 1; while (off % 4) off++;
  if (b[off] !== 0x2c) return { address, tags: '', values: [] };
  const te = b.indexOf(0, off); const tags = b.toString('utf8', off + 1, te);
  off = te + 1; while (off % 4) off++;
  const values = [];
  for (const tag of tags) {
    if (tag === 'i') { values.push(b.readInt32BE(off)); off += 4; }
    else if (tag === 'f') { values.push(Number(b.readFloatBE(off).toFixed(4))); off += 4; }
    else if (tag === 's') { const stop = b.indexOf(0, off); values.push(b.toString('utf8', off, stop)); off = stop + 1; while (off % 4) off++; }
    else if (tag === 'T') values.push(true);
    else if (tag === 'F') values.push(false);
    else break;
  }
  return { address, tags, values };
};
sock.on('message', (m) => {
  const p = parse(m); if (!p) return;
  const slot = waiting.find((w) => w.address === p.address && !w.done);
  if (slot) { slot.done = true; slot.reply = p; }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (address, ms = 260) => {
  const slot = { address, done: false }; waiting.push(slot);
  sock.send(oscStr(address), OSC, wingIp);
  const end = Date.now() + ms;
  while (Date.now() < end && !slot.done) await sleep(15);
  waiting = waiting.filter((w) => w !== slot);
  return slot.reply || null;
};
const send = (buf) => sock.send(buf, OSC, wingIp);
/** The console answers a leaf read with the value in three shapes: the display string (`"10k02"`,
    `"-oo"`, `"+0.5"`), a normalised float and a raw int. The display string is the value in the
    leaf's own units, which is what a write has to carry, so it is what this parser reads. */
const parseDisplay = (text) => {
  if (typeof text !== 'string') return Number(text);
  const trimmed = text.trim();
  if (trimmed === '-oo' || trimmed === '-inf' || trimmed === '+oo') return null;
  const kilo = /^([+-]?\d+(?:\.\d+)?)k(\d*)$/.exec(trimmed);
  if (kilo) return Number(`${kilo[1]}.${kilo[2] || 0}`) * 1000;
  const value = Number(trimmed.replace(/^\+/, ''));
  return Number.isFinite(value) ? value : null;
};
const writeBack = (row, reply) => {
  const kind = row.argKind;
  if (kind === 'none') return null;
  const display = reply.values[0];
  if (kind === 'string') {
    return typeof display === 'string' ? encode(row.address, ',s', display) : null;
  }
  const numeric = parseDisplay(display);
  if (numeric === null) return null;
  return kind === 'float'
    ? encode(row.address, ',f', numeric)
    : encode(row.address, ',i', Math.round(numeric));
};
const same = (before, after) => {
  const a = parseDisplay(before);
  const b = parseDisplay(after);
  if (a === null || b === null) return String(before).trim() === String(after).trim();
  return Math.abs(a - b) <= Math.max(0.0001, Math.abs(a) * 0.0005);
};

const skipWrite = (address) => address.includes('/$stat') || address.startsWith('/cards/');

sock.bind(0, localIp, async () => {
  const stats = new Map();
  const failures = [];
  const bump = (category, field) => {
    const entry = stats.get(category) || { keys: 0, answered: 0, missing: 0, written: 0, mismatched: 0, modelSilent: 0, commandSilent: 0 };
    entry[field] += 1; stats.set(category, entry);
  };
  for (const row of rows) {
    bump(row.category, 'keys');
    const reply = (await get(row.address)) || (await get(row.address, 400));
    if (!reply) {
      // A model parameter exists only while its model is loaded (`dyn:drv` on a strip running the
      // plain compressor has no transient-designer rows), and a write-only key is not a report at
      // all: both are expected to stay silent. Anything else that answers nothing is a finding.
      const expected = row.model || !row.canTrigger;
      if (expected) {
        bump(row.category, row.model ? 'modelSilent' : 'commandSilent');
      } else {
        bump(row.category, 'missing');
        failures.push(`NO ANSWER  ${row.address}  (${row.category}/${row.key})`);
      }
      continue;
    }
    bump(row.category, 'answered');
    if (!doWrite || !row.writable || !row.canTrigger || skipWrite(row.address)) continue;
    const packet = writeBack(row, reply);
    if (!packet) continue;
    send(packet);
    await sleep(40);
    const after = (await get(row.address)) || (await get(row.address, 400));
    bump(row.category, 'written');
    const before = reply.values[0];
    const now = after ? after.values[0] : null;
    if (!after || !same(before, now)) {
      bump(row.category, 'mismatched');
      failures.push(`WRITE-BACK ${row.address}  (${row.category}/${row.key}) before=${JSON.stringify(before)} after=${JSON.stringify(now)}`);
    }
  }
  console.log(`audited ${rows.length} addresses${doWrite ? ' (reads + write-back on reported targets)' : ' (reads only)'}\n`);
  console.log('category'.padEnd(16), 'keys'.padStart(5), 'read'.padStart(6), 'silent'.padStart(7), 'of which model'.padStart(15), 'command'.padStart(8), 'wrote'.padStart(6), 'mismatch'.padStart(9));
  let totals = { keys: 0, answered: 0, missing: 0, written: 0, mismatched: 0, modelSilent: 0, commandSilent: 0 };
  for (const [category, entry] of [...stats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(category.padEnd(16), String(entry.keys).padStart(5), String(entry.answered).padStart(6), String(entry.missing).padStart(7), String(entry.modelSilent).padStart(15), String(entry.commandSilent).padStart(8), String(entry.written).padStart(6), String(entry.mismatched).padStart(9));
    for (const field of Object.keys(totals)) totals[field] += entry[field];
  }
  console.log('-'.repeat(76));
  console.log('TOTAL'.padEnd(16), String(totals.keys).padStart(5), String(totals.answered).padStart(6), String(totals.missing).padStart(7), String(totals.modelSilent).padStart(15), String(totals.commandSilent).padStart(8), String(totals.written).padStart(6), String(totals.mismatched).padStart(9));
  if (failures.length) {
    console.log(`\n${failures.length} finding(s):`);
    for (const line of failures.slice(0, 60)) console.log('  ' + line);
    if (failures.length > 60) console.log(`  … and ${failures.length - 60} more`);
  }
  sock.close(); process.exit(0);
});
setTimeout(() => { console.log('FATAL timeout'); process.exit(1); }, 900000);
