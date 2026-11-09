# 13 · Timecode (MTC, LTC, SMPTE)

Timecode is a position in time that a show can be run against: a playback machine, a DAW, a lighting desk or a
theatre controller says "we are at 01:00:12:15", and this application can fire macros when the show reaches the
moments you choose. This chapter covers where the position can come from, how a cue is made, and what the limits
are.

Everything here is reached from **Properties → Timecode (MTC, LTC, SMPTE)**, except the cue list itself, which is
**read** there and **edited** in the LTC window (see *Cues*). The position itself is visible without opening anything:
in the **Timecode card** in the right-hand column, in the compact readout in the status area (once a position has
arrived), and in the **clock window** for a second screen.

## The three names

| Name | What it is | Where it comes from |
| --- | --- | --- |
| **SMPTE** | The numbering itself: hours, minutes, seconds and frames, at a frame rate | — |
| **MTC** | *MIDI Time Code*: that position sent as MIDI messages | A MIDI port. This application already speaks MIDI, so MTC needs **no new device and no new permission** |
| **LTC** | *Linear Time Code*: the same position recorded as an **audio** signal | A WAV file, or an audio input (an interface, or a virtual audio device another application feeds) |

**MTC carries a rate code**: 24, 25, 29.97 drop-frame or 30. The receiver reads that code automatically. Quarter-frame reception compensates the two-frame transmission delay in the direction of travel; a full-frame locate specifies its position directly. Invalid fields and incomplete, reordered or stale quarter-frame cycles are refused. Fractional 23.976 timing cannot be distinguished from 24 by the MTC rate code alone. LTC input uses the rate selected for the audio source.

## MTC: the easiest one

Open our MIDI ports (chapter 12), then press **Open our ports** in the timecode section or simply let the show
start: MTC arrives as quarter frames on the same port this application already listens to, and the readout starts
moving. Nothing else is needed — no device, no permission, no file.

## LTC from a file

**Verify an LTC file** reads a WAV and reports what is in it: the range it covers, the rate, whether it is
drop-frame, how many frames were read, and **which channel** carried the timecode. That last one matters: "this file
has no timecode" and "it is on the other channel" are different sentences, and only one of them is worth acting on.

The frame rate is chosen before the file, because LTC does not carry one. A file is the safest way to try this
feature: no permission, no device, nothing that can go wrong in front of an audience.

## LTC from an audio input

Choose a **device** (press **Refresh** to ask the system what it can see), a **channel**, and press **Listen**. The
channel matters: timecode is on **one** channel of a recording, and mixing channels could cancel a signal that is
inverted between them.

macOS will ask for permission to use the microphone **the first time**, and this application declares both the
description macOS shows and the entitlement the hardened runtime checks. Two practical notes:

- an **interface** or a **virtual audio device** (BlackHole, Loopback) is what carries timecode in practice — the
  built-in microphone hears the room, not timecode;
- the input closes when you press **Stop listening**, and it also closes when you switch the feature off.

## Cues

A cue is a position and the macro it fires.

**The list is read in Properties and edited in the LTC window.** The Timecode page in Settings shows you the whole
list — each cue's position, its name, its number and where it stands — with the search box, the offset it is running
with, the last cue the engine announced and where the list was last armed from. Everything that *changes* the list is
in the window the button **Edit the cue list…** opens: adding a cue, its number and its name, the section it belongs
to, its time, the order the list is laid out in, renumbering, and the offset. One editor, so two windows can never
show you different versions of the same show; the page keeps up on its own when the other window changes the list.

**Add cue** takes the position the timecode is at **right now**, or a position you type in the field beside it — a
typed position wins, because a field that quietly fell back to the live one would put the cue somewhere else without
saying so. If no timecode has arrived yet and there is nothing typed, it refuses and says why.

A cue's time can also be **edited** afterwards: four fields, hours down to frames, with buttons that nudge it by one
or ten frames. The backend validates and parses every value, so there is still one parser for timecode and it is the
backend's. Editing is local until you save — and saving **re-arms the cue list**, which the window tells you before
you do it.

The rules a show depends on, and they are worth reading once:

- the **first** position only **arms** the engine: a source that appears at 02:00 does not fire every cue before it;
- playing **into** a cue fires it, **once**;
- a **seek** past cues does **not** fire them, and **names every one it skipped** in the log — a scene skipped by a
  seek that leaves no trace is how twenty minutes of a rehearsal get lost;
- **what counts as a seek is a jump of more than 25 frames** — about a second, and it is a *frame* count rather than a
  time, so it is a little under a second at 30 fps and a little over at 24. That number is worth knowing because it is
  the line between *playing into* a cue and *passing* it: a move of 25 frames or less fires the cues it crosses, and
  anything larger names them as skipped. So a small hop — an operator nudging the machine forward — fires; a real move
  — jumping to another scene — does not.
- **and a skip says which kind of skip it was.** A cue crossed because the show was moved and a cue crossed because the
  timecode had stopped arriving and came back somewhere else used to read identically, and they are not the same event:
  one is a decision somebody made, the other is a **fault to go and look at**. The line reads *"the position jumped
  3.2 s"* in the first case and *"the timecode had stopped arriving for 1.2 s"* in the second. There is a **third** —
  *"the position moved"* — for the times the engine could not measure which it was, which is the first position after a list
  is installed or a source that has just been opened. The three readings share no words, so none can be mistaken for another.
  The same reason appears on the clock window, in the cue summary and in the log;
- moving **backwards** re-arms what is now ahead, and says so;
- two cues at one position both fire, in the order they are listed;
- a cue with **no macro chosen** fires nothing and says so, rather than firing the first macro in the library;
- **repeat** is three policies and not a switch: **once per pass** (the default — going back re-arms it), **every
  crossing** (it fires each time the position passes it), and **once in the show** (going back does not re-arm it, so a
  one-off announcement stays a one-off). **enabled** parks a cue without deleting it.

A cue is written when you press **Save** in the LTC window, and changing the list is refused while **Live Safe Mode**
is on — where a cue goes is part of what the show will do. The clock window has the same three repeat policies on its
own rows, and the same refusal.

## What ran, after the fact

Beside the cue list there is a file called **`timecode_as_run.json`**, in the same folder
(`~/Library/Application Support/Wing Controller Desktop/`). It is a line for every cue the engine dealt with: the cue's
id and its number, the position it fires at, whether it **fired** or was **skipped**, the wall-clock time the engine
decided, and — for a skip — which kind of skip it was, in the same three readings the window shows.

It exists because the marks **on the rows** are about the run in progress and nothing else. After a restart the engine
has fired nothing, so the rows are unmarked, and that is deliberate: a mark that said *"fired"* about a cue this
session has not reached would be a lie about the show in front of you. What survives a restart is the **record** — and
it is read as a record, not as the current state.

Four things about it are worth knowing:

- **It is written in batches, not on the audio callback.** A worker checks every 250 ms, independently of
  incoming timecode. It writes once 32 changes have accumulated or the oldest pending change is five seconds
  old. Saving the list and confirming either Quit or window close force a write immediately. With a healthy
  disk, the periodic delay is approximately five seconds plus a worker interval; it is not a power-loss guarantee.
- **It keeps the last 2 000 lines** and drops the oldest. Receipt numbers continue above restored history,
  so a result after restart cannot change an earlier performance's line.
- **Failed writes remain pending and are retried**, even if timecode has stopped. The clock state names the
  storage error. The show continues, but a normal quit refuses to close until the final record is saved;
  inputs and actions have already stopped. A forced process termination can still lose pending history.
- Outcomes distinguish **executed**, **cancelled**, **dropped**, **superseded**, **unconfirmed write** and
  **failed**, as well as an outcome still unknown. An execution receipt is not proof that a console or external
  application performed every action; MIDI and inter-app UDP report sending, without acknowledgements.

## The offset

A real rig always needs one: a source that arrives a little behind or ahead of the picture. The offset is in
**frames**, it is applied to **every** source at the single point where positions enter, and it is saved with the
cue list. Positive moves the timecode forward. Because it is applied before the cues are compared, a cue always
means the position the show is following, not the position a cable happened to say.

## The clock window

**⧉ Popout** on the Timecode card, or **Open the clock window** in the settings, gives a window made for a second
screen: the position in large phosphor digits, the state underneath, the next cue and how far away it is, and a
**Pin** button that keeps it above everything else. It is a **view**: closing it never stops the timecode, never
loses a position and never disarms a cue.

## Passing the timecode on

**Pass the timecode on as MTC** sends the followed position, with its offset, through our virtual MIDI output.
It sends a full-frame locate when acquiring a source or repositioning, then paces one quarter-frame message per
quarter of a frame, eight across two frames. Closing the ports or disabling forwarding retires the pending cycle.
Source/rate changes and jumps acquire a new position; late scheduling abandons the old cycle instead of bursting
missed messages. Repeated positions do not keep playback alive, and output stops after three frame periods without
fresh progressing input. A message already inside the operating system's send call cannot be recalled.

Continuous forward output supports 24, 25, 29.97 drop-frame and 30. **23.976 uses the 24-frame rate code at its
fractional cadence**, so the receiver must share that convention. **29.97 non-drop cannot be represented by an MTC
rate code** and forwarding reports a refusal. Reverse positions are forwarded as locates; continuous reverse MTC
output is not implemented. External receiver timing still needs a rehearsal measurement.

## Limits worth knowing

- **The audio input has not been proved against a real signal.** The codec is proved by generating LTC in its own
  tests; an interface feeding real timecode is a rehearsal item, and this guide says so rather than implying
  otherwise.
- **LTC does not carry its frame rate.** Choose it deliberately; a wrong rate decodes positions that cannot exist,
  and they are refused.
- **A position that stops arriving keeps being shown**, marked as stale. That is deliberate: an operator mid-show
  needs to know where the show *was*, and whether to trust it.
- **An open LTC input owns the clock until it is stopped or dies.** MIDI triggers and output remain available,
  but arriving MTC cannot overwrite LTC. After LTC is retired, the next valid MTC position acquires the clock and
  arms the cue engine afresh. A stale but still-open LTC input does not silently fail over. Merely opening MIDI
  ports, or receiving ordinary notes, does not change the source or re-arm cues.
- **29.97 is followed at its nominal 30** for the sub-second positions, with drop-frame numbering handled properly.

## The cue panel in the clock window

The clock window keeps its size until you ask for more. A **chevron** sits beside **Pin**: collapsing it leaves the
readout, the source, the next cue and Pin; expanding it grows the window and shows the cue list, and the window
remembers the height you left it at. If the system will not let the window grow, the list appears with its own scroll
rather than being cut off.

**The list is ordered by timecode by default.** That is the order a show runs in, and it does not depend on the order
the cues were made in — adding cues in several passes, rewinding in between, still leaves them laid out by time. The
selector beside the list offers **timecode**, **manual**, or **the order they were added**, and whichever you choose is
saved **in the cue file**, so opening the same show on another Mac keeps it. In **manual** order the ▲ and ▼ buttons on
a row are what move it; the other two orders place every cue themselves, and the move buttons are not offered there.

Each row shows its time, the macro it fires, whether it is enabled, and where it stands. A row marked **next** is the
one the engine will fire when the timecode reaches it. Rows already dealt with are marked: **fired** when the engine
fired it, **skipped** when a jump went past it, and **spent** when the engine only knows it was resolved — a window
opened late cannot always tell those apart, and it says so rather than guessing.

**A cue's time is four fields**, hours down to frames, and it can be nudged by one or ten frames without touching the
keyboard. Editing is local: nothing is written, and nothing is re-armed, until you press **Save**. That matters,
because saving re-arms the cue list — the button says so, and unsaved changes are marked until you do it. A cue can
also be added at the position the clock is reading, with **Add here**, and removed with the **✕** on the row — which is
the only way to take a cue out: there is no key for it, so a long list needs the mouse for that one action.

While timecode is running, the window shows how many cues fired, executed, were cancelled or dropped,
and how many still await an outcome, have an unconfirmed write or were lost. With nothing fired yet it shows zeros instead of hiding, because
a counter that answers "did anything go missing?" has to be able to answer "nothing". It turns to a warning colour when
an outcome is pending, a write is unconfirmed or an order was lost; check that before the next cue.

## Sequential drive and editing while the show runs

In sequential drive, **Go** and duration-based advancement visit each enabled cue once in the current progression,
including an **Every crossing** cue. Its SMPTE repeat policy remains independent: it cannot trap the sequential
cursor on the same row. Reset starts a new progression; rewinding re-arms eligible cues while preserving **once in
the show** rules.

The LTC editor refreshes macro choices when the library changes, preserving unsaved cue labels, sections, selection
and bindings. A changed macro is not silently rebound to a new saved hash. If the clock cannot be read, the display
says **unavailable**; the Monitor control retains its last value but cannot be changed until a valid state returns.
An unavailable read is not a stopped clock. A hung read is bounded in the UI and never produces overlapping polls.
