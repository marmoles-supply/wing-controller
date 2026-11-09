# 3 · Actions & timing

The THEN half of a macro is a timeline of steps. This section covers what each step sends, whether it reads the console, and when the next step starts.

## The timeline is sequential, never parallel

The app runs the compiled steps in order. Step 2 starts only after step 1 returned. One macro runs one timeline at a time. Nothing inside a macro overlaps.

## What each mode does

**Set**. One datagram, one argument. An empty or unknown mode compiles as Set, the default. Every write that carries a value is then read back: text and closed lists compare as trimmed, case-insensitive text, numbers with the 0.005 tolerance, and `true`/`false` as 1/0. The read is retried inside a settle budget of 250 ms — each attempt is the wait for a limiter slot (17 ms) plus a 60 ms read, and an attempt only starts while a whole one still fits — so a step's read-back costs at most about 250 ms. A mismatch is traced and emitted as `action-verification`, but it is a report the operator reads and never a failed step. WING gives nothing else: "WING does not echo data sent over UDP by the client application". The protocol's OK/error replies belong to the node-command form this app does not use, and error events are never surfaced. A write to a path the console does not know is silently ignored; the read-back is your only feedback. Set ignores the Delay field.

**Toggle**. One datagram carrying the integer `-1`, and **the console flips the parameter itself**: "by sending a -1 to an OSC Command with an integer OSC Type Tag that can only accept values 0 or 1, the value of the parameter will toggle between 0 and 1" (the protocol's own *Special case: Toggle*). Nothing is read first, so a toggle cannot be delayed by a slow answer and cannot be raced by two presses: the desk's flip is atomic. The packet is also the one write that does not queue behind a fade's remaining packets, because a mute that lands a second late is a wrong mute. Toggle only compiles on an on/off parameter — anything else is refused when the macro is validated, because `-1` means nothing to a continuous value. The result is not read back: the console decided it, so the step is reported as **sent**, not as confirmed, and the run's own line for that step says the console had nothing to compare. Toggle ignores the Delay field.

**Wait** blocks and sends nothing. **Wait then set** blocks, then sends one write plus read-back. **Fade** ramps linearly and **Smooth fade** uses smoothstep; both send a series of values and are read back once, at the end of the ramp, to see that the console holds the value they aimed at. **Where the fade starts** and **what it aims at** are two independent choices:

| Fade from | Fade to | What it does |
| --- | --- | --- |
| the value I set | a value | the authored pair: `-60 → 0 dB`, `200 → 2000 Hz`. Nothing is read. |
| where it is now | a value | reads the parameter first, then ramps from **whatever the console holds** to the value you set |
| where it is now | an amount (+/−) | reads it, then moves it **up or down by** the amount you gave — `-3` fades down three, `+3` fades up three |
| the value I set | an amount (+/−) | the same arithmetic from your own start, with no read |

A fade **by an amount** is added to wherever the fade started and the *result* is then held to the parameter's range: `+3 dB` on a band already at `+15` stays at the top, and the amount itself is never clamped, so `+1000 Hz` means a thousand hertz. An amount of `0` is refused — it would not move anything.

A fade that starts **where it is now** has to read the parameter first: OSC has no relative write, so the console's own value is the only honest starting point. That read costs one limiter slot plus the answer (about a fifth of a second at worst, retried inside the same 250 ms budget a read-back gets), and the OSC terminal shows the value it read. **If the console does not answer, the step fails and nothing is written**: ramping from an invented value would move the parameter somewhere the operator did not ask for.

The endpoints are held to the range the **target parameter** documents — a fade-in from silence stays `-60 dB` on a fader and becomes `-15 dB` on a ±15 dB EQ gain, and a `200 → 2000 Hz` fade of a filter stays in hertz — and the ramp moves in the domain that leaf documents: by ratio for a frequency, a Q or a release time, by offset for a level or a percentage. A value the parameter cannot hold is brought to the nearest it can, and the preflight says so. They ignore the Delay field. **HUD alert** waits the Delay field in 10 ms chunks, emits, and returns at once: it never waits for a dismissal and sends no OSC packet. The editor hides that delay for alerts.

## When a step returns

| Mode | Reads the console? | Returns |
| --- | --- | --- |
| Set | read-back, any value except a write-only command | after the send, plus the read-back (at most about 250 ms; a command is sent and not read) |
| Toggle | no: the console flips the value it holds | after the single `-1` packet — no read first, no read-back, and it does not wait in the paced queue |
| Wait | no | after the wait |
| Wait then set | read-back, any value | after the wait + the send + the read-back (same 250 ms settle budget) |
| Fade / Smooth fade | read-back, at the end | after the whole ramp + the read-back (same 250 ms settle budget) |
| HUD alert | no | after its lead-in wait; dismissal is irrelevant |

## Which values a step can send

A step writes one value to one parameter, and the parameter decides what that value is. The target
list is grouped — **Level & routing**, **Sends** (with **Bus sends**, **Matrix sends** and **Main
sends** submenus), **Input**, **Filters**, **EQ**, **Gate**, **Dynamics**, **Insert**, **FX**,
**Output & routing**, **Show**, **Surface**, **Transport**, **Console**, **Monitor**, **Solo**,
**Console Lights**, **Safes**, **AES50**, **Cards** and **Globals**, with a catch-all **Other** for a
parameter no group claims; the trigger and gate pickers draw a **Meter** group ahead of them — and a
group opens on hover, on keyboard focus or on click. A parameter the selected strip does not have is
not in the list at all, and a bus's own index is never offered as a send destination — the console
ignores a bus that sends to itself.

- **A level or a number** (fader, trim, a frequency, a time, a mix): the field shows the parameter's
  own unit and range — `Input Trim` takes −18…18 dB, `HPF Frequency` 20…2000 Hz, `Send Level`
  −144…10 dB. A value outside the range is refused before it is sent.
- **On/off** (mute, phantom, phase, gate on): 1 or 0, and the readout says ON or OFF.
- **Text** (a name, a gate or dynamics model, a user-button mode): the value is text — a name takes
  16 characters, a DCA or mute group 8 — and a model or a mode is chosen from the list the console
  documents, so a typo cannot be sent.
- **A model** (`/gate/mdl`, `/dyn/mdl`, `/fx/mdl`) can also be *watched*: "when the gate model
  becomes DUCK" is a valid trigger, compared with equals. An FX model is chosen from the list the
  slot can load: slots 1…8 offer every documented model, slots 9…16 the effects only.
- **A send** (`Send Level`, `Matrix Send Level`, `Main Send Level` and their on/off, tap and pre/post
  switches): the index field names the destination — buses 1…16, matrices 1…8, mains 1…4 — and an
  index outside it is refused. **No destination, no address**: the field starts empty (the list says
  "choose the destination") and a step or a gate that does not name one is refused with the reason,
  rather than being sent to bus 1 in silence. Matrices have no sends at all and a main has no bus
  send, so neither is offered there.
- **Which FX slot an insert holds** is a closed list (`NONE`, `FX1`…`FX16`), and a channel's
  post-insert also has a mode (`FX`, `AUTO_X`, `AUTO_Y`) and an autogain weight (±12 dB). Assigning a
  slot to an insert takes that effect away from the strip it was plugged into, and every insert adds
  about 32 samples (0.66 ms) of processing delay.

Two modes are only offered when they make sense: **Toggle** needs an on/off parameter (it sends the
console's own flip, and `-1` means nothing to a continuous value), and **Smooth fade** needs a value
that can be ramped — a fade writes a series of numbers, so it is not offered for a mute, a name or a
model.

Both of them also need a leaf the console **reports**. A **write-only command** — `W-Live Control`
and the other W-Live transport leaves, `Clear AES50 Errors`, `Recorder Action`, `Player Action`,
`Scene Action` — is written and never read back: what such a command changed is reported at another
key (W-Live State, the AES50 counters, Recorder State), so the app sends it without a read-back and
without a verification notice, and it does not offer Toggle or Fade there (a command has no state for
the console to flip, and no end value for a fade to check). A command takes a **Set**.
A step at one of those keys is not offered at all: writing a key the console only reports, such as
the monitor level the full-size WING treats as read-only or anything on the Cards and Desk Status
screens, is refused with the reason rather than armed and ignored.

## The numbers

- **Send limiter: 17 ms per packet**, shared by every macro, ramp and the 500 ms state refresh. That is ~58 packets/s; the queue-full message says 60.
- **Queue bound: 1 s**. A packet whose slot is more than 1 s away fails with `OSC send queue full`; the macro fails and its remaining steps never run.
- **Ramp:** duration clamped to 20..60000 ms; the ramp is cut into as many steps as the duration's share of the send limiter allows, `clamp(2, 128, floor(duration/17) / addresses)`, and every step writes one packet per address the selector names. Each step is scheduled against the ramp's own clock, not by sleeping a fixed interval, so the duration holds whatever the selector writes instead of stretching by the number of channels. A duration too short for even two steps of a wide selector keeps both endpoints, takes about `2 × addresses × 17 ms`, and the preflight says so.
- **Ramp domain:** the leaf's own. A frequency, a Q and a release time are documented logarithmic and move by ratio (`20 → 20000 Hz` passes through 632 Hz at the halfway point, not 10 kHz); a level, a percentage, an attack, a hold and a delay move by offset.
- **Relative fade:** one leaf read before the ramp when it starts "where it is now" — attempts of one limiter slot (17 ms) plus a 60 ms read, inside a 250 ms budget — and nothing at all when both ends are authored. The read-back after the ramp is the usual one.
- **Steps per macro: 32**, counted *before* the enabled filter, so disabled steps consume slots.
- **Toggle: one packet, no read, and no wait.** It carries `-1` and the desk flips the parameter, so there
  is no read before it and no read-back after it: the step returns as soon as its packet is out, and that
  packet does not queue behind a fade. **Delay clamp: 60 000 ms** per step, polled every 5 ms. **Read-back**
  for the modes that have one: a read after the write, retried inside a 250 ms settle budget — each attempt is
  the limiter slot (17 ms) plus a 60 ms read, and an attempt only starts while a whole one still fits —
  tolerance 0.005. A mismatch that has to be reported costs one more short read, to name the strip's model.

## Disabled steps and steps with no target

A disabled step is dropped at compile time: it never runs and costs no time. A step with no target is dropped too, unless it does not need one — Wait and HUD alert survive without an address. Preflight rejects an empty address on the other modes; a macro with no enabled, targeted step cannot be armed.

## Overlap policies

Each macro keeps its own run state and its own one-slot queue. When the same macro triggers while it runs:

- **drop** (default): the trigger is discarded and counted as dropped.
- **queue one**: one follow-up run is stored; the next trigger is dropped.
- **restart**: the running timeline is cancelled and the new run is queued behind it.
- **concurrent** cannot be armed.

Two different macros can run at once, each with its own timeline, but they share the limiter: two simultaneous ramps need ~100 packets/s against ~58, so the queue grows until one hits the 1 s bound and fails. Keep one ramp in flight.

## Stopping

PANIC STOP and Disconnect both stop the stream. A running timeline checks for the stop between packets: every 2 ms while waiting for a limiter slot, every 5 ms inside a wait, and before each ramp packet. A deliberate stop is reported as `aborted`, never `failed`.

The honest consequence: **an aborted fade leaves the parameter at the last value sent.** Nothing ramps back and nothing jumps to the end. Abort a 60 s fade after 10 s and it stays there. To recover, arm a macro that Sets the final value, or re-trigger a short fade.

**PANIC STOP reaches a Test Action (Shoot) too.** `F12`, the header button or **Disconnect / Stop**
raises the Shoot's own stop flag, so a test `delay` or `fade` is interrupted instead of running to the
end: the step is reported `interrupted`, the run `cancelled`, and the event `aborted`, never a failure.
An aborted fade stays at the last value sent, exactly as above.

## Nothing is sent to a console the app is not connected to

Every console write in the app goes through one gate: a **live session** first, and then Live Safe Mode's
own rule. With the app disconnected — idle, stopped, failed or after a link drop — Test Action, the raw
send and **Fire Macro** refuse, name the state they saw and send nothing:

> Not connected (idle): testing a step on the console needs a live session, and nothing was sent.

That is deliberate. An operator looking at a window that says "disconnected" must not be writing to
somebody's console; connect first, then test.

## Firing a whole macro by hand

**Right-click a macro row → Fire Macro (run all its steps).** It runs the macro's enabled steps through the
same dispatcher a trigger uses, so what you fire is what the show will fire, and the run reports what it
did per step (`confirmed`, `unconfirmed`, `interrupted`). It is the way to prove a whole list before going
live: Test Action proves one step, this proves the list. It needs a live session like every other write,
and it does not touch the editor — the row's other menu actions load the macro and therefore still ask
about unsaved work first.

## HUD alert options

Display: Center HUD, Corner Toast, Fullscreen. Urgency: Emergency, Warning, Cue, Info. Flash: static, pulse, strobe, countdown at 150-2500 ms. Size presets 300/440/600/800 px, scale 0.7-2.0. Duration defaults to 5000 ms; 0 means persist. Sound: none, beep (rendered by the window), or voice — speech is handled by the system, so it does not delay the timeline. Target window: default, all, main, meters. The app routes `main` and `meters` to that window (meters falls back to main) and broadcasts anything else; each window resolves `default` from the saved HUD preferences.

**An alert cannot flood the window.** Repeating the *same* alert — same text, urgency, display, format
and duration — is coalesced instead of reopening the card forever: the window counts it
(`Repeating ×N`), says how many copies of a burst it dropped, and, past three times the alert's own
duration, freezes the card: the last text stays, the flash and the countdown stop and the sound goes
off, so a macro firing faster than its own alert cannot turn the screen into a strobe. Beeps are
coalesced too — at most one per second, a single shared audio context for the whole session rather
than one per alert, and none after the fifth repeat of the same alert. A *different* alert is never
swallowed and shows at once.

**Courtesy notices are capped too.** The little "macro triggered" card is a per-macro flag, and a macro
firing hard would otherwise stack cards in the corner for as long as it keeps firing: the card of the
same macro is replaced instead of stacked, at most three are on screen (the oldest goes first) and the
chime plays at most once per second, sharing the window's single audio context.

**An alert cannot trap you either.** While a broadcast alert covers the window the master header floats
above it — and it does the same with a modal dialog open — so **PANIC STOP**, the status chip and the
stop button stay clickable, and the alert card carries its own **PANIC STOP** button. Any of the three
routes — that button, the header, or `F12`, which also works in the Meter Bridge window — stops the
stream, clears the alert from the screen and ignores further alerts for three seconds (the session log
records each ignored one as `hud_alert_ignored_after_panic`).

## Recipes

**Two things at once: you cannot.** WING accepts no OSC bundles — "the contents of an OSC packet is always an OSC Message" — and a step carries one address with one value. Two Set steps back to back are 17 ms apart: the second waits for its limiter slot.

**Sequenced with waits.** Set, Wait 500, Fade 3000 lasts about 3.4 s: step 1 sends at t=0, step 2 blocks 500 ms, step 3 sends 128 packets 23 ms apart (~2.92 s of sleeps). A Fade drives **every address its selector names**, one packet per address per step, so `ch 1-4` fades the four channels together in the one duration; two Fades in sequence are what a crossfade still needs, and it takes both durations. Real overlap needs two macros, with the limiter risk above.

**Alert and act.** HUD alert "GO", Wait 200, Set `/ch/5/mute` 0: about 200 ms, with the alert on screen for its own duration.
