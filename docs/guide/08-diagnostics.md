# 8 · Diagnostics

## The four blocks

The card starts collapsed; its header summarises the session as `Rate 0.0 Hz · 0 evaluations`. Inside, four blocks collapse independently and remember their state. Visible order: **OSC Monitor, Probe, Link & health, Log**.

## Link & health

Counters start at zero on each session.

| Row | Unit, window, what it measures | Healthy | Suspect |
| --- | --- | --- | --- |
| **Rate** | Hz, 1 decimal. Meter frames/s over the window since the previous update (a frame or the 500 ms tick), smoothed 0.5; never a session average. | ~15-20 Hz: a frame every ~50 ms. | `0.0 Hz` live: no meter subscription, or a stale report id. |
| **Bytes** | B/s, integer. Same window; decoded meter frame bytes only. | Moves with Rate; Bytes ÷ Rate ≈ one frame. | Near 32768 × Rate, frames hit the 32 KiB buffer and truncate. |
| **Decode** | µs, integer. The **last measured** decode, frame arrival to the end of decoding, successes only. | Tens to hundreds of µs. | Climbs with Rate unchanged when the Mac is busy. Rejected datagrams never update it. |
| **Trigger** | `p50 / p95` µs or `–`; nearest-rank percentiles over the last 256 evaluations. | p50 of a few hundred µs; p95 not ten times above. | `–`: nothing fired yet. p95 far above p50: stalls. |
| **Evaluations** | Cumulative trigger fires per frame. | Grows only when your triggers cross. | Not "actions sent": IF-blocked macros count; two triggers on one macro count twice, one action starts. |
| **Last RX** | Time **since** the last accepted datagram, `N ms ago` or `never`. | Tens of ms with meters flowing, hundreds with only OSC state. | Rejected datagrams and other source IPs do not refresh it; the watchdog drops the session after 3.5 s. |
| **Last renew** | Time since the app last **sent** a renewal. | Resets every 2 s, never past ~2 s. | Past ~5 s the thread is stalled; the console stops meter data 5 s after a renew. |
| **Events** | Cumulative decoded meter readings per frame. | Grows whenever Rate is non-zero. | Cannot freeze while Rate moves. |
| **Dropped** | Cumulative meter datagrams rejected as truncated or undecodable. | `0` for a whole show. | Each is also an `ignored undecodable meter datagram` row; socket-queue losses are **not** counted. |
| **Scale** | Static label `1/256 dB → dBFS`. | — | Raw 1/256 dB integers ÷ 256; exceptions: V2 slots 6 and 9 raw, FX slots 4-8 × 6/2048. |

Caveats. The **Trigger** tooltip says the clock stops when the action is handed to the action thread, and that is exactly where it stops; the OSC write and the UI paint are not included. On disconnect only Rate, Bytes and Decode blank to `–`; the other rows keep their last value. The payload always reports `state` as `live`, and the card ignores it.

## OSC monitor

One row per traced message: time, tag, address, arguments, remote. **RX rows are console traffic**: OSC state with decoded arguments, raw replies, undecodable meter datagrams, UDP errors. **TX rows are the app's own**: macro writes, test sends, the `/*S` renewal every 2 s, the rotating state read every 500 ms, failed `WING?` probes, meter renew failures over TCP 2222.

A healthy session shows a slow TX trickle: meter frames are never traced per frame, and a **successful** meter renew is not traced at all. A TX row means the app sent a packet, not that the console obeyed.

**ALL / RX ← / TX →** filter by direction; the text box matches address, summary, remote or arguments, case-insensitively; **Auto** pins the view to the newest row. The `RX / TX / Total` counters ignore the filters; **Clear** resets buffer and counters; the buffer holds 100, 300 (default), 500 or 1000 messages. Badge: **● ACTIVE** on each row, **● IDLE** after 3 s silence, **● OFFLINE** when the link drops, IDLE on a new live session. **Verify WING** sends a `WING?` query on UDP 2222 and prints model, IP and interface.

## Log

Two readouts share the name. The collapsible **Log** block is a status line rewritten in place: each live frame replaces it with `packet=N label=value …` plus `trigger_hit=…`/`action=…` when something fired; otherwise the last status message.

The **Session Log** card is the history: newest first, `HH:MM:SS event …`, capped at 160 lines. Names include `live_start`, `stream_live`, `stream_error`, `network_disconnected`, `trigger …` and `action_completed: … packets=…`, `step_verify_failed: …`, `panic_stop_requested`, `config_saved` and `library_imported`. Three examples:

- `live_start ip=192.168.1.10 enabled_macros=3 threshold=-30 armed=true custom_meters=4` — the session snapshot; the macro library is frozen here.
- `trigger usb1-rising-demo -12.34 -> -8.90` — a meter crossed its threshold; previous value then current.
- `step_verify_failed: /ch/1/fdr expected 0.5, console reports 0` — the write was ignored; the path or the strip model is wrong.

Read downward from `live_start`: the last lines before a failure say where it stopped; old lines fall off after 160 entries.

## Probe

Four buttons; none writes to the console. **Frame demo** builds one meter request and one renew packet in memory and prints their hex. **Trigger self-test** decodes four synthetic packets through the same decoder and trigger runtime and reports decoded events, hits and the first hit. **Stress test** runs 1000 frames at 1 ms, visual cadence 66 ms, returning average and maximum decode time. **Verify Targets** reads every address your library uses, up to 64 in 20 s, listing `[ok] = value` or `[SILENT]` with the strip model behind a silent gate, compressor or EQ path; a silent target never receives the macro's writes. The first three compute locally; the fourth only reads.

## If this, then look here

- **Meters do not move** — Last RX fresh with `Rate 0.0 Hz`: no meter subscription. Add meters and restart.
- **Macro does not fire** — Evaluations stays 0: the trigger never crossed, or its meter is not subscribed. Library edits apply at connect, so restart after editing.
- **Macro fires, desk does nothing** — Evaluations grows and the log says `action_completed`, yet nothing changes: run **Verify Targets**; a nonexistent path is ignored silently.
- **Counters frozen** — the session ended: Rate, Bytes and Decode show `–`; the log holds `stream_error` or `network_disconnected`.
- **RX grows but Rate is zero** — state traffic arrives but no meter frame decodes: empty watchlist or a stale report id; if Dropped climbs too, frames are rejected.
