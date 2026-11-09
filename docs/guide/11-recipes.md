# 11 · Recipes & a show in practice

Chapters 2 to 4 explain the parts of a macro. This chapter is the other direction: what to arm on a
show day, and seventeen macros you can type in as they stand.

## A show in practice

**Soundcheck.** Build every macro disabled and prove one at a time. Put it in the editor, Disconnect,
then press **Arm Draft Only (Test)**: while armed, the draft is the only macro compiled and the
library is discarded for that session. Arming is refused while the stream is live, so arm first, then
Connect + Listen.

Make the desk do something harmless: a **HUD alert** writes no OSC, and a Set on a spare channel mute
is visible and reversible. Fire it with **Test Action (Shoot)**, which runs the selected step through
the real dispatcher without arming — and **PANIC STOP** (`F12`) cancels it, so a wait or fade of up to
60 s ends where it is.
Before doors run **✓ Verify Syntax (Preflight)** and **Verify Targets**: a target that does not answer
is a write that vanishes without an error.

**Doors.** Enable only tonight's macros (row checkbox, then **Enable Selected**) and leave experiments
disabled — a disabled macro subscribes nothing. The library is compiled when the stream connects, so
enable before Connect. Turn on **Live Safe Mode** so no save, enable, delete or import can reach the
running session.

**Show.** Watch the Live Meters card or the Meter Bridge (`Cmd+M`). **PANIC STOP** — the header button
or `F12` — cancels queued steps but does not revert values already written.

**Changeover.** Disarm the draft, swap the enabled set, and run **Verify Targets** again if you
re-patched: addresses are literal numbers, so moving a channel moves the macro.

**End of night.** `Cmd+S`, then **Save…** in the SHOW box and the show profile — both write real
files. A station backup carries the library, the draft and the sections you tick — macros, meters,
settings, network — in one `.wcz`: the Save panel asks where to put it (macros and
meters are ticked for a show) and the file is written there, and loading it asks which sections to
apply.

## Recipes

Tuning is the Transient preset — Cooldown `0 ms`, Rearm `3.0 dB`, Dwell `0 ms`, Stale after
`1500 ms` — unless stated.

### 1. Feedback spike: alert, wait, mute

- **Use it when**: something starts to ring and the operator should know first.
- **Trigger**: Meter · Channels · ID `5` · Meter Level · `>` · `-6 dB`.
- **Actions**: HUD alert (Emergency, Center HUD, Strobe, 3 s); Wait `200` ms; Set `/ch/5/mute` = `1`.
- **Watch out**: the alert does not pause the timeline, so the mute lands 200 ms plus a limiter slot
   later. Nothing unmutes, and re-arming needs a 3 dB rise. If the ringing keeps retriggering, the alert
   repeats: the window coalesces it, counts it and stops beeping instead of filling the screen, and
   **PANIC STOP** (the header, the button in the alert card or `F12`) clears it — see chapter 3.

### 2. Mic thump: mute the channel

- **Use it when**: a mic takes a hit you want gone before the operator reacts.
- **Trigger**: Meter · Channels · ID `12` · Meter Level · `>` · `0 dB`, Cooldown `1000 ms`.
- **Actions**: Set `/ch/12/mute` = `1`.
- **Watch out**: the trigger reads slot 0, the input left leg: a hard-right channel reads as silence.
   It stays muted. On **DCAs** the same shape writes `/dca/1/mute`.

### 3. Duck the walk-in under a vocal peak

- **Use it when**: the MC talks over the walk-in and the music should step back.
- **Trigger**: Meter · Channels · ID `5` · `>` · `-10 dB`, mode Level, Dwell `60 ms`.
- **Gates**: Meter · Channels · ID `32` (music) · `>` · `-40 dB`, Logic AND.
- **Actions**: Fade `/bus/2/fdr` `-3` → `-14` over `1200` ms.
- **Watch out**: a Fade never reads the console, so it starts from your authored value — the "Fade
   start" help used to claim a read first and now says so. Back up is a second macro.

### 4. Walk-in down over two seconds

- **Use it when**: a fader has to travel between two levels when a cue lands.
- **Trigger**: OSC state · Channels · ID `40` · Mute · `==` · `0`, edge `on` (the MC mic opens).
- **Actions**: Fade `/ch/32/fdr` `-6` → `-18` over `2000` ms.
- **Watch out**: 117 packets ~17 ms apart (the send limiter's own pace for a 2000 ms ramp of one
   channel), so a second ramp can hit the 1 s queue bound. The first poll only primes the trigger.

### 5. Talkback: toggle the alternate source

- **Use it when**: a talkback mic should flip one channel between its two inputs.
- **Trigger**: Meter · Channels · ID `40` · `>` · `-30 dB`, Cooldown `2000 ms`.
- **Actions**: Toggle `/ch/32/in/set/altsrc`.
- **Watch out**: Toggle reads nothing: it sends one `-1` and the console flips the parameter, so the step
   is reported as sent and the result is the console's. `altsrc` is channel and aux only.

### 6. Follow the operator's mute

- **Use it when**: a hand mute should drag another parameter with it.
- **Trigger**: OSC state · Channels · ID `5` · Mute · `==` · `1`, edge `on`.
- **Actions**: Set `/fx/1/fxmix` = `0` — the vocal reverb return goes dry.
- **Watch out**: polling refreshes one address per 500 ms, so a quick mute and unmute is missed.
   Nothing restores the mix.

### 7. Changeover: staged fade of three channels

- **Use it when**: three channels must go down one after another.
- **Trigger**: OSC state · Mute Groups · ID `1` · Mute Group · `==` · `1`, edge `on`.
- **Gates**: Channels · ID `40` · Mute · `==` · `0` (only while the MC mic is open).
- **Actions**: Fade `/ch/1/fdr` `-5` → `-144` over `800` ms; Wait `120`; the same on `/ch/2/fdr`;
   Wait `120`; the same on `/ch/3/fdr`.
- **Watch out**: steps are serial, so this runs ~2.6 s. The 32-step cap counts disabled steps, and an
   abort leaves faders mid-travel.

### 8. Monitor wedge: mute on a transient

- **Use it when**: the wedge should close itself when the monitor mix spikes.
- **Trigger**: Meter · Monitor Meters · ID `3` (`mon1_l`) · Monitor Meter · `>` · `-12 dB`,
   Cooldown `2000 ms`.
- **Actions**: Set `/bus/8/mute` = `1`.
- **Watch out**: monitor meters are trigger-only, so the action must be a bus, matrix or channel.
   IDs `1..6` are `solo_l/r`, `mon1_l/r`, `mon2_l/r`.

### 9. Kick cue: one hit, a 200 ms HUD flash

- **Use it when**: you want to prove end to end that a channel trigger reaches the window.
- **Trigger**: Meter · Channels · ID `1` (kick) · `>` · `-20 dB`, Cooldown `300 ms`.
- **Actions**: HUD alert — title `KICK`, urgency Cue, Corner Toast, duration Custom `0.2` s, no
   sound, target window Meters.
- **Watch out**: the safe test macro — no OSC at all. On-screen time is the alert's own duration, not
   a timeline pause, and the editor takes it in seconds.

### 10. Clip guard on a mute group

- **Use it when**: any input of a range clipping should drop a group and tell you.
- **Trigger**: Meter · Channels · IDs `1-8` · Meter Level · `>` · `+6 dB`, Cooldown `3000 ms`.
- **Actions**: HUD alert (Warning, 2 s); Set `/mgrp/1/mute` = `1`.
- **Watch out**: a range fires on whichever ID crosses first, once per frame.

### 11. Recall a scene from a footswitch

- **Use it when**: the next scene should follow the operator's foot, not the mouse.
- **Trigger**: Show State · GPIO Input State · ID `1` · Equals · `1` — the pedal is a source like any
  other, so the same macro can start from a meter or a HUD button instead.
- **Actions**: Show Control · Scene Number = `3`; Show Control · Scene Action = `GO`.
- **Watch out**: the order matters — **set the number, then GO**. A show must be open, and the number
  must be `0` for `NEXT` or `PREV` to behave with `GO`; over plain OSC the scene list returns only its
  first name, so type the number. To react to a scene change instead, watch **Show State** (Active
  Scene, Active Scene Number or Active Scene Tag) with equals.

### 12. Talkback without holding a button

- **Use it when**: an announcement should reach the stage only for as long as you say so.
- **Trigger**: a HUD button or a GPIO input, as in recipe 11.
- **Actions**: Talkback · Talkback On = `1`; … ; Talkback · Talkback On = `0` after a wait — or set
  the mode to `PUSH` and drive only the assign you need: Talkback Bus Assign = `1`…`16`, Talkback
  Matrix Assign = `1`…`8`, Talkback Main Assign = `1`…`4`.
- **Watch out**: an assign takes its destination in the same field a send uses, so the label says
  which bus, matrix or main it switches, and the talkback id field picks `A` (`1`) or `B` (`2`). Set
  Individual Levels when the announcement should follow the per-bus levels rather than the common one.

### 13. Line check from the oscillator

- **Use it when**: a wedge or a tie-line has to be proved without a talk mic.
- **Trigger**: a HUD button, or the GPIO input of a panel switch.
- **Actions**: Set Oscillator · ID `1` · Oscillator Waveform = `SINE`; Oscillator Frequency =
  `1000`; Oscillator Level = `-20`; then patch it where you want it — Set Local Outputs · ID `8` ·
  Output Source Group = `OSC`. The stop step is Oscillator · Source Mute = `1` (and `0` again when
  the check is over).
- **Watch out**: the oscillator is a source like any other, so it is only heard once an output (or a
  channel) takes `OSC` as its source group: leaving the patch behind is the usual mistake, and so is
  muting the oscillator and forgetting it. The oscillator's own `mode` row is read-only in the
  reference, but the source keys every input has are offered beside the three `osc` leaves — Source
  Mute, Name, Colour and Icon — so the mute is the switch. The reference documents two oscillator
  inputs; use the same ID in every step.

### 14. A channel into a DCA by tag

- **Use it when**: a guest channel has to join a DCA without touching the desk's own patch.
- **Trigger**: OSC state · Channels · ID `12` · Tags · `==` · `#D1` (the guest strip is tagged).
- **Actions**: Set Channels · ID `12` · Tags = `#D1`.
- **Watch out**: `#D1`…`#D16` are the documented way to put a strip into a DCA (the tag *is* the
  assignment), and the field holds up to 80 characters, so the tag can carry the DCA and a note
  together. Writing the tag replaces the whole string: keep whatever else the strip was carrying. A
  typo is a tag that assigns nothing, and the console reports the same string back, so the watch
  compares exactly what you typed.

### 15. Multitrack: record, then drop markers

- **Use it when**: the show is being tracked and the cues should be findable afterwards.
- **Trigger**: a HUD button for the start, and a second macro (or a GPIO pedal) for the markers.
- **Actions**: Set W-Live Multitrack · ID `1` · W-Live Control = `REC`; then, at each cue, W-Live Set
  Marker = `1`. To jump back later: W-Live Goto Marker = the marker number.
- **Watch out**: every W-Live **transport** leaf is a command the console does not report back, so
  the app writes it and does not read it afterwards — what the card is doing is the W-Live State
  watch (`STOP`, `PPAUSE`, `PLAY`, `REC`), and a toggle or a fade is refused on a command: it would
  have to read the leaf first. The same screen carries the card type and version, so a macro can gate
  on Card Type `==` `WLIVE` before it arms anything. Naming a session works only while the transport
  is stopped, and a time to jump to takes effect with the following goto. **Format Card** erases every
  session on the card, so its step seeds `0`.

### 16. Protect a section, then recall the scene

- **Use it when**: a scene load must not touch the mutes or the buses you are riding.
- **Trigger**: a HUD button, or a footswitch as in recipe 11.
- **Actions**: Set Safes · Mute Group Safes = `++++++++` (8 groups); Set Safes · Bus Safes =
  `++++++++++++++++` (16 buses); Show Control · Scene Number = `4`; Show Control · Scene Action =
  `GO`; then Set Desk Lights · Touchscreen Light = `20` — the desk itself shows the show is protected.
- **Watch out**: each safe leaf is a text mask, one character per item: `+` safes that item and a
  space leaves it unprotected, and a mask longer than the scope's own count is refused. The reference
  does not say what a short mask, or an empty one, does to the items it does not name, so write the
  whole scope rather than the first few items, and read the current mask first if the operator has
  safes of their own — the app refuses an empty value instead of guessing. The safe rows cover the
  channels, auxes, buses, mains, matrices, DCAs, mute groups and FX slots, then the sources, the
  outputs and the desk's areas.

### 17. AES50 link alarm

- **Use it when**: a digital snake is the one cable nobody may lose quietly.
- **Trigger**: OSC state · AES50 Status · ID `1` (`A`) · AES50 State · `==` · `ERR`, edge `on`.
- **Actions**: HUD alert (Emergency, 3 s); Set Monitor Buses · ID `2` · Monitor Source = `MAIN.1` so
  the operator keeps hearing the desk while the snake is down; Set Desk Lights · Patch Panel Light =
  `100` to point at the panel.
- **Watch out**: the port field prints the letter — `1` is `A`, `2` is `B`, `3` is `C` — and the
  state list is `-`, `OK`, `ERR`, `UPD`, so compare against `ERR` and not against a number. The
  corrected and uncorrected counters beside it are watches: they climb before the link drops, and
  **Clear AES50 Errors** resets the counters, not the link. The rest of the desk status block (clock
  lock, PPM) is watched too, so a macro can refuse to run when the desk clock is not locked.

## What you cannot do today

Matrix sends, main sends and the tap of any send are all offered now: the picker's **Sends** group
carries **Bus sends** (1…16), **Matrix sends** (1…8) and **Main sends** (1…4), the index field is
labelled with the destination and its range, and **trim** and **phase** are offered on buses, mains
and matrices as well as on channels and aux.

1. **Send outside a destination's range.** The editor offers exactly what the console has — buses
   1…16, matrices 1…8, mains 1…4 — and refuses an index outside it; a bus cannot send to itself, and a
   matrix has no sends at all while a main has no numeric bus send.
2. **Load a snapshot or preset.** `/show/load` and `/library/load` are silent on the console and
   resolve to nothing on purpose.
3. **Gate an aux.** The document lists `/aux/1/gate/*`, but the console has no aux gate node, so the
   app refuses it.
4. **Watch a raw address.** A Custom OSC step can write an address you type, but there is no custom
   trigger: a raw address can never be a trigger or a gate.

## Limits at a glance

Every address in this chapter uses one of the documented forms. Read a green run as "the packets
were sent", not "the console changed".

| Limit | Value |
| --- | --- |
| Macros per library | 128; past that dropped silently |
| Steps per macro | 32, counted before the disabled filter, so a disabled step costs a slot |
| Macro name | 60 characters; save and arm refuse longer |
| Macro name, gaps | Duplicate appends " copy" and the inline rename saves unchecked, so both can pass 60 |
| Delay per step | 60 s silent clamp; the editor's field takes 0..60 000 ms and refuses anything else |
| Fade duration | 20 ms..60 s silent clamp; the editor's field takes 20..60 000 ms and refuses anything else |
| Packets per fade | 2..128 steps × the channels the selector names (one packet per channel per step) |
| Fade endpoints | the target parameter's own range; a value it cannot hold is moved to the nearest it can |
| Ramp domain | the leaf's own: by ratio for a frequency, a Q or a release time, by offset for a level or a percentage |
| OSC pacing | 17 ms per packet (~58/s) shared by macros, ramps and the state refresh; queue bound 1 s |
| IF gates per macro | 16 |
| Sends per strip | buses 1..16, matrices 1..8, mains 1..4; the editor offers the destination's own range and refuses an index outside it |
| Strips per family | 40 ch, 8 aux, 16 bus, 4 main, 8 matrix, 16 DCA, 8 mute groups, 16 FX |
| Desk-level families | monitor buses 1…2, W-Live cards 1…2, AES50 ports 1…3 (printed A, B, C), oscillator inputs 1…2, fader-layer surfaces 1…7 (L, C, R, CMPCT, RCK, EXT, VRT); an index above the family's own count is refused |
| Meter index | the family's own count — 40 ch, 8 aux, 16 bus, 4 main, 8 matrix, 16 DCA, 8 mute groups, 16 FX, 6 monitor, 120 RTA — and a source or output device by its own count (2 AES/EBU, 4 player/recorder); an index above it is refused |
| Meter subscription | data times out after 5 s on the console; the app renews every 2 s |
| OSC subscription | `/*S` dies after 10 s on the console; the app re-sends it on the same 2 s tick |
| Session log | 160 lines, oldest dropped |
| Trigger latency | p50 / p95 over the last 256 evaluations |
| Verify Targets | 64 addresses at most inside a 20 s budget; the result says how many of the total it checked |
| Meter group size | fixed per device in the app — 24 values for the local group — but the real size depends on the console model: a full-size console sends 8 local meters and a Rack/Compact sends 24. When the console sends fewer values than the app expects, the groups that follow in the same frame are read at the wrong offset |
