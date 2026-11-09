# 1 · Start here

This chapter covers what WING CONTROLLER is, how to start a session, and what the safety controls
do. The rest of the guide assumes you have read it.

## What the app is

WING CONTROLLER is a macOS desktop app that watches a Behringer WING console over the network and
fires OSC commands on it when live audio or console state crosses a threshold you defined. You
build a macro from a trigger, optional conditions and an ordered list of actions; while a session
runs, the app listens and sends.

It is **not** a console remote and **not** an editor. It does not mirror your console's parameter
set, and you cannot mix on it. It only listens (to meters and console state over OSC) and fires OSC
writes, while showing you meters and traffic. Set the show up on the console or in the WING's
own remote editor; this app is the layer that reacts.

## The five windows

**Workstation** — the main window: Connection card, macro editor and library, meters,
Diagnostics, Session Log.

**Meter Bridge** — a window for meters only, meant for a second monitor. Open it with
**⧉ Popout** on the meters card, with **Meters** in the toolbar, or with `Cmd+M`. `Cmd+M` is a real
toggle: it closes the bridge when the bridge is already open. The bridge has its own style, layout
and zoom, and can be pinned always-on-top.

**Clock** — the timecode readout for a second screen: large digits, the source and its state, the
next cue and how far away it is, and a **Pin**. Open it with **⧉ Popout** on the Timecode card, with
**Clock** in the toolbar, or with **Open the clock window** in Properties > Timecode. It is a view:
closing it never stops the timecode, loses a position or disarms a cue.

**LTC cue window** — the whole cue list as a dense table, with an inspector that explains a cue and
a **Live** mode that hides the editing tools. Open it with **Edit the cue list…** on the Timecode
page or with **Open the LTC window** in Properties > Timecode. This is the editor: cues are added,
timed, renumbered and saved here, and the Timecode page reads the same list. The window never fires
a macro — the main window owns firing.

**Guide** — this document in a window of its own, opened from Properties > Guide & Help, from
**? Help**, or with `F1`. It prints as one document.

The workstation and the Meter Bridge each keep their own meter watchlist, and the app subscribes to
the union of the two watchlists. HUD alerts can be aimed at the workstation, the bridge, or both.

## Get going in two steps

**1. Set the console IP.** Type the console's IPv4 address into **WING IP** in the Connection card
(it starts at `192.168.1.10`). If you do not know it, use **Discover WING on the network** in
Properties > Console & Network, which sends the `WING?` broadcast on UDP 2222.

**2. Press Connect + Listen**. The status badge goes Connecting, then Live.

**What "Live" means.** The app has confirmed the console's identity and is listening for OSC
state updates. Your enabled macros have been compiled into the running session and
are waiting for their triggers. If the watchlist has meters, the native meter stream is flowing at
the same time. The summary row in the Connection card switches from "Configured" to
"Listening".

While a session runs, the IP field and the Connect button are locked; disconnect first to change
them. **Disconnect / Stop** ends the session.

## What the Mac and the console need

The Mac must be able to reach the console on the network. Three paths are used:

| Purpose | Transport | Port |
| --- | --- | --- |
| OSC control (writes, state subscription) | UDP | **2223** |
| Discovery / identity (`WING?`) | UDP | **2222** |
| Native meters (TCP request; frames come back by UDP) | TCP | **2222** |

Two places tell you whether the Mac actually sees the console:

- **Properties > Console & Network**: console IP, priority adapter and
  "Use only the selected adapter", disconnect timeout (default 3.5 s)
  and auto-reconnect every 2 s.
- **Diagnostics**: the Link & health grid (Rate, Bytes, Decode, Last RX,
  Last renew, Dropped) and **Verify WING**, which probes identity on UDP 2222.

Limitations worth knowing before you trust a green light:

- Meters exist only while a session is running **and** a watchlist is subscribed. With no meters
  selected, the app never opens the meter TCP connection at all. A watchlist the app rejects leaves
  the grid showing configuration that looks real but is only defaults.
- The meter subscription is renewed every 2 s against the console's 5 s report timeout.
  A report id that is not renewed simply stops.
- A real link drop retries every 2 s with no backoff and no attempt counter, and the bridge has no
  reconnect vocabulary of its own.
- Meter counts per device and the exact identity of the `0xa7`/`0xa8` group bytes still need a
  read-only check on hardware.

## The safety model

**Armed macros.** Only enabled macros run in a session. The draft arm ("Arm Draft Only (Test)")
compiles just the macro in the editor, so you can prove one macro on the desk without the rest of the
library; while it is armed, saving the library does not change what is running until you disarm.
Arming is deliberately not carried across restarts.

**PANIC STOP (`F12`).** It stops the stream, cancels all queued timeline steps and cancels a **Test
Action (Shoot)** in flight, so a test `delay` or `fade` of up to 60 s ends where it is. It does **not**
revert values already written to the console.
If "Require confirmation before executing Panic Stop" is enabled, it asks first.

**Live Safe Mode (the lock).** Enable it in Properties. While the stream is live
it blocks library changes — save draft, new, duplicate, delete, import, export, enable/disable,
courtesy notice, colour tag, reorder — plus arming, sending a test action to the console, firing a
macro by hand (Fire Macro) and resetting preferences. You can still type in the editor; the lock is on
the actions that would change the library or write to the console under the running session. It also
stays on during a reconnect, not just while the badge says Live. The window is what enforces it; the
backend's own contribution is that nothing is sent at all while there is no live session.

**A `Set` does not wait for confirmation.** The step encodes the OSC message and sends it, then the
sequence moves on; nothing blocks waiting for the console to acknowledge. After a discrete `set` or
**Wait then set** the app does read the value back and reports a mismatch — but a mismatch is reported,
not treated as a failed step. A write to a path the console does not know, or to a parameter the
strip's model does not have, is ignored without any error, and the macro can still count as
completed.

## Where the rest of the documentation lives

- **Properties > Guide & Help**, the **? Help** button or `F1`
  opens the short in-app quick reference.
- **This guide** is the complete documentation, one chapter per topic: triggers, actions and timing,
  macros and limits, meters, saving and scopes, the protocol, Diagnostics, troubleshooting,
  shortcuts, and recipes for a real show.

## Credits and thanks

The console's remote-protocol behaviour described in chapter 7 follows the public *WING remote
protocols* documentation written by **Patrick-Gilles Maillot**, who went to the trouble of finding out
what these consoles say, wrote it down, and made it public. Without his work, this application would not
exist — his documentation and tools are at *x32ram.com*. And our thanks to the operators whose reports
from real shows shaped the warnings, the limits table and the recipes in this guide.

**David Schumann**, who has spent years making *Mixing Station* the control surface the people at the desk
deserve (*mixingstation.app*). He set the standard this application is measured against; without his
example, it would not have been attempted.
