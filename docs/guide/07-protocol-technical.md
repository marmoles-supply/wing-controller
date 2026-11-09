# 7 · Protocol (technical)

WING CONTROLLER uses three channels: OSC over UDP for control, a plain-text discovery probe on UDP 2222, and a binary meter subscription whose request goes over TCP 2222 and whose frames come back on a UDP port you declare.

## The three channels

**OSC, UDP 2223.** The console communicates over ports 2223 (UDP) and 2222 (UDP, TCP), but OSC itself uses a single UDP port, 2223, with replies to the calling port or to a `/%<port>` you name. The app sends all OSC to 2223.

**Discovery, UDP 2222.** Send the 5 bytes `WING?` to port 2222; the console answers `WING,<ip>,<name>,<model>,<serial>,<firmware>`. The app probes this way on every connect and matches the `WING,` prefix on receive. **Verify WING** is this probe.

**Native meters: request over TCP 2222, data over the UDP port you declare.** Port 2222 is listed as UDP and TCP; channel #3 is metering, and data goes to the client IP at the specified port. The app connects TCP to 2222 and declares its own UDP socket's port.

## The native meter request frame

Payloads follow the channel selector `0xdf, 0xd<ChID>`; the example starts `dfd3…` = `0xdf` plus channel 3. The app sends `0xdf, 0xd3` verbatim as the frame prefix. Inside: `0xd3` + word is the UDP port that will receive meter data, and it must be set at least once; `0xd4` + long is the report id; `0xdc` … `0xde` bracket a meter collection; `0xa0` … `0xaf` are family tokens followed by zero-based indices, where `0x00…0x7f` means index 1…128, repeatable.

A meter request looks like `dfd3d400000002dca001de` (report id 2, channel 2); its renewal is the report id alone, `dfd3d400000002`. Replies carry the client-specified 4-byte report id as a prefix, and meters return in request order; the app drops any frame whose first four bytes do not match. Use a different id per collection; the app starts at 1 and increments on each collection change.

**Escape.** `0xdf` introduces a channel change, so it must be escaped or doubled. The app does not implement this — it concatenates the request bytes unescaped — so a port in `0xDFD0…0xDFDE` would corrupt the request.

## The values

Levels are two bytes, signed, big-endian, in 1/256 dB, decoded as `<int16>/256`. Two exceptions:

- **V2 gate led and dyn state are 0 or 1**, not dB; those slots pass through unchanged.
- **FX subscriptions return 4 levels and 6 state meters**; band gain reduction — the first five state meters — is `value * 6.0 / 2048`. The four levels stay 1/256 dB; the app scales only the five slots after them.

## Meter groups

- **Channel, aux, bus, main, matrix** — `0xa0`–`0xa4`, 8: in L/R, out L/R, gate key/gain, dyn key/gain.
- **Those five, V2** — `0xab`–`0xaf`, 11: the 8 plus gate led, dyn state, automix gain.
- **DCA** — `0xa5`, 4 values. **FX** — `0xa6`, 10.
- **Source / output** — `0xa7` / `0xa8`, a group level stream.
- **Monitor** — `0xa9`, 6. **RTA** — `0xaa`, 120.

**Source and output groups are model-dependent.** Their 8 values are only an example — local ins: 8 meters, local outs: 8 meters — and the count is never fixed. All 24 local inputs may not be available depending on the console model: WING has 8 preamps full-size versus 24 on Rack/Compact. The app assumes a fixed count per device id: local 24, AES50 A/B/C 48, USB/Card 48. A shorter group shifts every later group in the same datagram to the wrong offset. The app truncates the frame instead of inventing values, but the count remains an assumption. A group with fewer bars than expected is this assumption, not a console fault.

## Subscription and renewal

**OSC.** `/*S` enables event messages; events carry single-tag values. Only one subscription exists at a time, dying after 10 seconds, so renew every 10 seconds. The app sends `/*S\0` at connect and on every renew.

**Native meters.** Data times out after 5 seconds: the console sends for 5 s about every 50 ms, and you renew with a simple renew command containing the ID, every 5 seconds at most. A renew is only `0xd4` plus the id.

**What the app does.** It renews the meter subscription every 2 seconds and re-sends the `/*S` state subscription on the same tick; identity (`WING?`) is probed once a second, on its own cadence. Both sit comfortably inside their windows. If meters go quiet the session ends instead of showing frozen bars.

## Reading a value with no side effects

A leaf read is an address with **no arguments**, pointing at a leaf — there is no more hierarchy data after the current one — such as `/ch/1/fdr`. Replies are `,s` for strings or enums, `,sff` (ascii, raw, float) for floats, `,sfi` (ascii, raw, int) for ints. The app sends exactly that and waits up to 400 ms. It keeps the **last** argument when numeric, because the first is only a rounded ASCII rendering.

**Verify Targets** reads every address used by an enabled step or condition — up to 64 addresses in 20 seconds — and reports which answered; for a silent one it reads the strip model (`/gate/mdl`, `/dyn/mdl`, `/eq/mdl`) to explain why.

## Writing

Written values may be strings, big-endian int32 or float32 with matching tags, and the console manages the conversion itself: a fader takes `-2` as a string or `-3.0` as a float. The app emits `i`, `f` and `s`, and `T`/`F` for booleans.

WING does not echo data sent over UDP by the client application, although the client may be notified with an OSC event in case of an error. There is no positive acknowledgement for the app's single-parameter writes. A write to a parameter that does not exist, or that the model loaded on that strip does not expose, is ignored **without any error**. That is why the app preflights, why a numeric write can be read back to verify it, and why gate/compressor/EQ names are gated by model.

## What the app does not support

- **Sends beyond a destination's range.** The console takes bus sends `1..16`, matrix sends
  `MX1..MX8` and main sends `1..4`. Each send is offered under its own destination — `/send/<n>/…`,
  `/send/MX<n>/…`, `/main/<n>/…` — with the index bounded by that destination, so matrix sends are
  reachable from the picker's **Sends** group and an index the console lacks is refused before the
  write instead of being sent as a silent no-op.
- **`/show/load` and `/library/load`.** Shown as Load Snapshot / Load Preset but resolving to no address: loading is a console filesystem operation, not an OSC leaf, and both were silent on hardware.
- **The aux gate.** The protocol defines `/aux/1/gate/*`, but the console has no aux gate node — `/aux/1/gate/mdl` is silent while `/aux/1/dyn/*` answers — so the catalogue never offers it.
- **Other catalogue refusals.** Aux has no filter node and no post-insert; a main strip has no
  numeric bus send; a model parameter is accepted only in its own section.

## Where the address list comes from, and how to audit it

The target catalogue is the list of addresses the app can target, and its model-dependent part follows the console's parameter set, so a model is offered only the parameters that exist on it. Two checks cover it:

- A validation pass compares every catalogue path with that parameter set, normalising stray trailing digits such as `thr23` → `thr`; in strict mode an unknown address fails the check.
- A read-only check sends argument-less leaf reads on 2223 and prints the raw bytes, so an address can be confirmed against a real console.

The validation does not check types or ranges, cannot see addresses assembled at runtime, and ignores the native protocol entirely (`0xd3/0xd4/0xdc/0xde`, `0xa0…0xaf`, 1/256 dB, FX scaling, the escape rule). A clean validation means the paths exist, not that the console will accept the write.
