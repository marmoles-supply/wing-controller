# 2 · Triggers

A trigger is the **WHEN** of a macro. The editor splits a macro into "1. Trigger Signal", "2. IF Gates"
and "3. Action Sequence".

The **Parameter** you pick chooses the family, and it decides **what can be compared with it**:

- **Meter trigger** — live audio telemetry: Meter Level, Monitor Meter, RTA Band or a V2 state
  meter (a level in dB, or an on/off flag).
- **OSC state trigger** — a console state change the app reads back: Mute, Fader, Input Trim,
  a frequency, a model, a name, and so on.

Each parameter is one of a few **kinds**, and the kind fixes the comparison, so an impossible one
cannot be built:

| Kind | Examples | Comparison | Value |
| --- | --- | --- | --- |
| Meter level | Meter Level, Monitor Meter, Automix Gain | rises above / falls below | dB |
| On/off | Mute, Phantom, Phase, Gate On, **Gate LED V2**, **Dyn State V2** | equals / not equals | ON or OFF |
| Number with a unit | Input Trim (dB), HPF Frequency (Hz), Gate Attack (ms), Pan (%) | is above / is below / equals / not equals | number in its range |
| Text | Name, a gate or dynamics model, a user-button mode | equals / not equals | the text (16 characters for a name, 8 for a DCA) |

A name is compared with **equals**, never with "rises above": text has no size. A V2 flag is 0 or 1,
so it is compared with ON/OFF and not against a dB threshold. If a parameter is not reported by the
console at all, it is not offered: the list only carries what can be watched. The **Edge** selector
applies to state parameters (becoming true, becoming false, both); in a meter trigger the
comparison already says which crossing is watched.

## Meter triggers

Meters do not come from OSC. The app opens a native meter subscription on TCP 2222 and the console
answers by UDP; values are 16-bit levels in **1/256 dB**, which the app
divides by 256. Two exceptions: V2 state slots 6 and 9 are raw 0/1, and FX state
meters use `value * 6.0 / 2048.0`.

### Sources and maximum index

The Source dropdown lists every trigger-capable category with its count:

- Mix: channels 40, aux inputs 8, buses 16, mains 4, matrices 8, DCAs 16, FX slots 16.
- Physical inputs (`0xA7`): local 24, aux in 8, AES50-A/B/C 48 each, StageConnect 32, USB 48, card 64,
  module 64, USB player 4, AES/EBU 2, user signals 56, oscillator 2, bus/main/matrix sources 32/8/16.
- Physical outputs (`0xA8`): local 8, aux 8, AES50-A/B/C 48 each, StageConnect 32, USB 48, card 64,
  module 64, USB recorder 4, AES/EBU 2.
- Meter-only: studio and solo monitor 6 (`solo_l`, `solo_r`, `mon1_l`, `mon1_r`, `mon2_l`,
  `mon2_r`), RTA 1-120.

The two long families are read in two levels. Inside **Sources** the list heads every run of families
that belong together — **Local** (local, aux, USB player, AES/EBU, oscillator), **Stage box** (AES50
A/B/C, StageConnect), **Card & USB** (USB audio, card, module), **Internal** (user signals) and **Bus
meters** (bus, main and matrix sources). Inside **Outputs** the same reading gives **Local** (local,
aux, USB recorder, AES/EBU), **Stage box** and **Card & USB**. The families and their counts are
unchanged, and their order is still the document's own (1955-1965 for the inputs, 1844-1846 for the
outputs): the second level groups the list rather than reordering it.

### Channel / IDs field

The editor field is labelled **Channel**; it accepts `1`, `1-8`, `1, 3, 5` and
mixed forms like `1-4, 7-10`. Reversed ranges are read in order (`8-1` = `1-8`),
duplicates are dropped, and one field holds at most 256 IDs. The meters card uses the
same syntax in **Channels / IDs** to build the watchlist. Each ID gets its own
meter address, so a range fires on whichever channel crosses first, and a macro runs
at most once per frame even when several channels cross. On a target that addresses a
**send**, the same field is labelled by its destination — **Bus** 1…16, **Matrix** 1…8 or
**Main** 1…4 — and an index above the destination's size is refused, as is a send on a family
that has none (matrices have no sends, a main has no bus send).

### Threshold, comparison, edge

- **Threshold** in dB: new macros start at **-18 dB**, clamped to **-120..24**.
- **Comparison**: **Rises above** detects a crossing from below the threshold. **Falls below**
  detects a crossing from above it. A reading at the threshold counts as reaching it.
- The **Edge** selector is shown for OSC state triggers. Choose whether the comparison becoming
  true, becoming false, or both can trigger a macro. Older saved meter macros can also carry
  a separate edge setting.

## Tuning

In **Advanced Trigger Tuning**, **Fast transients** uses Transient, 3 dB rearm and
0 ms for both dwell and cooldown. **Stable level** uses Level edge with an 80 ms
cooldown. Both presets use a 1500 ms stale timeout. Choose **Custom tuning** to
set each control separately.

| Knob | Default | Range | Meaning |
| --- | --- | --- | --- |
| Mode | Transient | Transient / Level edge | Level edge requires a new threshold crossing. Rising Transient can also detect a rise above the threshold without a new crossing. |
| Cooldown | 0 ms | 0–2000 ms | Time from the start of a meter-triggered run during which the same macro discards new meter triggers. Applies to both modes and all meter channels in that macro. |
| Rearm | 3.0 dB | 0.1–24 dB | How far the level must rise from the lowest value since the last detection to fire again above the threshold in rising Transient mode. |
| Dwell | 0 ms | 0–1000 ms | How long reports must keep the level at or above the threshold before a rising Transient trigger can fire. |
| Stale | 1500 ms | 250–10000 ms | After a longer gap in reports, the first reading sets a new reference level. |

For example, with a threshold of −40 dB and a 3 dB rearm, a pulse that rises from
silence to −38 dB and then to −34 dB can produce two hits in Transient. Level
edge detects the first crossing. A later dip below −40 dB and a rise back above
it creates another crossing in either mode.

With a **250 ms cooldown**, a new hit 100 ms after the run starts is discarded.
An eligible hit at 250 ms can run, subject to IF and overlap rules. A hit refused
by an IF or dropped by the overlap policy leaves the timer alone. If the overlap
policy queues a run, its cooldown starts when the run takes the execution slot.
The Session Log shows the first hit skipped in each cooldown interval. The timer
is scoped to meter triggers and resets when a new live session starts.

Both modes see the same meter reports, approximately 50 ms apart. A pulse can
be missed if none of the received reports reaches its threshold. Dwell and rearm
apply only to rising Transient triggers. Level edge and falling triggers use the
crossing with the configured cooldown.

## IF timing

**Immediate** is the default, including for existing shows. It checks all IF
gates as soon as the meter trigger is detected. A single report can already
contain both the trigger level and the IF level.

Use **Wait for next report** when a second meter distinguishes two cues whose
pulses may appear in neighbouring reports. This setting requires one trigger
meter and one other meter in the IF gates. Additional gates may check either of
those two meters. The app keeps the trigger meter's value at the crossing and
waits for the first subsequent report carrying the other meter. It uses the
higher of that meter's value at the crossing and its new value. This covers a
pulse that arrives one report late or has already fallen by the next report.
Keep unrelated pulses outside the wait window, since either reading can
influence the decision.

Macros with the same trigger meter, threshold, direction and other IF meter
share the timing. Saving a timing change in one updates all of them. In Wait
mode, they use one detector and the same pair of values. Use the same detector
settings across the group. Level edge is a good starting point for one pulse
per cue. A group with mismatched timing or detector settings is flagged and
skipped when connecting.

The normal wait is about one meter interval (approximately 50 ms). After
125 ms without a fresh IF report the app discards the hit and writes
`action_if_timeout` to Session Log. A missing IF level at the crossing or
a change in meter subscription discards the hit with `action_if_cancelled`.
The usual overlap rules still apply, and the cooldown starts when a run takes
the execution slot. OSC, MIDI and timecode triggers retain their own timing.

## Why you do not get a run storm

Three doors:

1. **Baseline.** The first value a trigger sees becomes its reference, not an edge,
   so a macro never fires on the level already present when you connect. Every (re)connect clears the
   state and re-baselines.
2. **Staleness.** If no frame arrived within *Stale after*, the app re-baselines and drops the hit;
   a meter used by a gate counts as false once that old.
3. **IF gates.** Whatever survives still has to pass every enabled gate.

## IF gates

A gate is a second address compared with a value: source, channel/IDs, parameter, comparison, value.
It can be a meter or an OSC state leaf, and the value is validated against the
parameter's type and range: meter gates accept only `>` and `<`,
toggle gates only `==` and `!=`.

Add gates with **Add Gate**; the app keeps the first **16**. Logic is **AND** by
default or **OR**, and disabled gates are skipped. A missing or
expired value fails its gate, so gates fail closed.

When gates block a hit, nothing is sent: the log shows
`action_blocked: trigger hit ignored because IF conditions are not met (<name>)` and
the macro row shows `blocked` as its last event. The four counters — dropped, restarted, completed,
failed — do not include blocked hits.

## Watch out

- The console only sends meters it has. The app builds an address for whatever index you type
  but only fires when an event with that family, device and index arrives,
  so an index above the maximum in the list above stays silent.
- The watchlist and banks decide what the windows **display**; a trigger subscribes its own meters
  while its macro is enabled, and a disabled macro subscribes nothing.
- The trigger reads **one slot per channel**: slot 0 is `inL`, the input left leg. A channel panned
  hard right reads as silence. This is an open priority-1 issue.
- FX triggers expose slot 0 only, though the FX group has four levels and six state meters.
- OSC state triggers are polled: one subscribed address every 500 ms in rotation, primed with a leaf
  read at connect. With many state addresses the worst
  case is 500 ms times their count.
