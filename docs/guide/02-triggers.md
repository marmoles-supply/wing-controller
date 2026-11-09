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
- **Comparison**: `>` rises above, `<` falls below, `==`, `!=`. Meter triggers
  only arm with `>` or `<`; preflight rejects `==`/`!=`. `>=` and `<=` normalize to
  `>` and `<`.
- **Edge**: **ON edge** (default), **OFF edge** or **ON/OFF edges**. It picks the directions watched: OFF =
  falling, ON/OFF = both, ON = rising — or falling when the comparison is **Falls below**.

## Tuning

**Advanced Trigger Tuning** has a Response preset plus five knobs. *Fast
transients* = transient, 0 ms, 3 dB, 0 ms, 1500 ms; *Stable level* = level, 80 ms, 3 dB, 60 ms,
1500 ms.

| Knob | Default | Range | Meaning |
| --- | --- | --- | --- |
| Mode | transient | transient / level | Transient fires on a rise from the recent minimum; level on a plain crossing |
| Cooldown | 0 ms | 0..2000 | Minimum time between two runs, both modes |
| Rearm | 3.0 dB | 0.1..24 | After a run, level must rise this far above the lowest value seen since that run |
| Dwell | 0 ms | 0..1000 | Level must stay above the threshold this long before firing |
| Stale after | 1500 ms | 250..10000 | Longer silence re-baselines instead of firing |

Ranges are enforced by the app. Rearm and dwell apply to the rising transient
path only; level mode and falling edges use the crossing plus cooldown. Rearm
is measured from the lowest value seen since the previous run, not from the
threshold itself, so a signal that stays loud can fire again after it forms a
new low and rises by that margin.

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
