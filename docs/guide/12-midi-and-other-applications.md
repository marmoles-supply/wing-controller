# 12 · MIDI and other applications

This chapter is about talking to the applications *around* the console: Mixing Station on a tablet, QLab or
LiveProfessor on another laptop, TouchOSC on an iPad. It is a separate feature from everything else in this guide —
it has its own switch, it is **off by default**, and with it off nothing is opened, no port is created and no macro
can be triggered by anything outside this application.

Everything in this chapter lives in **Properties → MIDI, Inter-app OSC**.

## The switch, and what it means

**Enable talking to other applications** is the master switch. While it is off:

- no virtual MIDI port exists, so other applications cannot see this one at all;
- the OSC listener binds nothing, so no UDP port is open;
- the audio input used for LTC is closed, and no microphone is opened;
- nothing is passed on to anybody.

Switching it **off stops what is running**: the MIDI ports close, the OSC listener closes, the audio input closes
and the forwarding stops. It is a switch, not a sign — an operator who switches off a microphone expects the
microphone to stop.

## The applications list

**Add an application** gives you a row with a name and an address. For OSC this list is the listener's **IP filter**,
so it is configuration with a consequence:

- **with no application listed**, the OSC listener observes anyone who can reach it (which is how you find out who
  is sending before deciding to restrict the network);
- **with one listed**, the listener hears only that address.

A **MIDI** row leaves the address empty: the system enumerates MIDI ports, and an address there would mean nothing.
A row you switch off stays in the list and is not used — it does not restrict the listener either.

**A filter of addresses is not authentication.** It decides whose packets are read; it does not prove who sent them,
because a UDP packet carries whatever origin address its sender writes into it. Anyone who can reach the port can put
a listed address in a packet, and the macro that packet names will fire. What keeps that off the network is the scope
below: **this machine only** is the recommended way to connect, because then only something already running on this
Mac can reach the port at all.

## MIDI: ports, monitor and sending

**Refresh the list** asks the system which MIDI ports exist and opens nothing. Your own ports — **WING CONTROLLER
In** and **WING CONTROLLER Out** — appear only while the switch is on **and** you press **Open our ports**; they are
created on request and destroyed when you close them. Another application's ports appear once that application is
running.

The monitor counts what arrives and remembers the last message. **Send one message** sends a single note or CC so
you can prove the path in the other direction without building a macro. **PANIC STOP** also sends All Sound Off and
All Notes Off on all sixteen channels, which is how a stuck note in a software instrument is silenced from here.

A macro step can send MIDI as well: **Send MIDI** in the action timeline, with the message kind, channel, number and
value. MIDI has **no acknowledgement**, so a MIDI step is reported as *sent*, never as *confirmed*.

## Triggers from another application, with Learn

A **binding** is what makes another application able to fire one of your macros: a message it sends, and the macro
that fires.

1. Press **Add a binding** (or **Add a MIDI binding** in the macro editor, which makes the binding for the macro you
   are building).
2. Press **Learn**, then press the control in the other application. Whatever message arrives is captured exactly as
   it came — kind, channel, number and the value range — and replaces any guess. Learn is the answer to "which note
   did that button send", and it is why nothing has to be guessed twice.
3. Save. The binding fires its macro through the same path a hand-fired macro takes: the console-write guard, the
   Stop button and the overlap rules all apply.

A **condition** on a binding is a value this application watches, so a button can be made to fire only when
something else is true — and "never received" is a different verdict from "received and false", because those are
different sentences when you are debugging. A condition also has a **stale** time: a value older than that is not
treated as met.

## OSC: the listener, and where it listens

**Start listening** binds a UDP port on the port number you choose (9100 by default) and counts what arrives. It can
also fire macros, through the same bindings.

**Where it listens matters, and it is a decision rather than a preference:**

- **this machine only** (the default, and the recommended way to connect) — only something already running on this
  Mac can reach the port;
- **the network** — for an application on another device (TouchOSC on a tablet, QLab on another laptop). This is
  **refused unless at least one application is listed**, because on a network *any* device on that network could
  send an address that fires a macro, and a macro at the wrong moment in a show is the failure this application
  exists to avoid.

The list of applications does not turn the network option into a safe one: it decides which **source addresses** are
read, and a packet's source address is written by whoever sends it. On a network, someone who can reach the port can
put a listed address into a packet and fire the macro that packet names. That is why **this machine only** stays the
recommendation: it is the one scope where the list of addresses is not the only thing in the way.

The readout says where it is listening and what it is doing: `listening on 9100 · this machine only`, with the
counters beside it.

**Sending OSC** works the other way: a macro step of kind **Send OSC** takes an address and typed arguments. The
address rule is the protocol's own: no spaces, no stray commas, no empty part. A pattern character in an address is
allowed, because OSC uses them.

## The Mixing Station combination, concretely

Its own documentation is clear about which half is which, and it decides how to set this up: Mixing Station's **OSC
API exposes mixer parameters and subscriptions, not its custom buttons**, while its **actions** are assigned to a
custom control **or to a MIDI control**. So the combination is a MIDI combination:

| Direction | How it works |
| --- | --- |
| **Your macro → a Mixing Station button** | Send the note or CC that a MIDI control there listens for; the actions assigned to that control run. |
| **A Mixing Station button → your macro** | The button carries `MIDI → Send/Receive` and emits a note or CC. Add a binding here, press **Learn**, press the button. |
| **Both at once** | One macro of yours fires an action layer there, the layer changes what its controls do, and one of those controls fires another of your macros. Our own messages are recognised and do not re-trigger us. |

Make sure the action list on the custom button is **also assigned to a MIDI control** (Mixing Station allows either),
and that our virtual port is selected in its device list — it appears there like any other.

## Limits worth knowing before you trust it

- **MIDI has no acknowledgement.** A send is reported as *sent*; nothing here claims a confirmation MIDI cannot
  give.
- **MIDI 2.0 and SysEx are not implemented.** SysEx in particular is *not* journalled by the system's own driver, so
  it cannot be monitored here either.
- **The ports exist only while they are open**, which is deliberate: an application that is not using MIDI should
  not appear in every other application's MIDI device list.
- **Our own ports must not collide with themselves.** These transport tests cannot run while this application is
  open, because it holds virtual ports with the same names — the failure says so rather than saying *timeout*.
- **A MIDI peer row's address is unused**: the system enumerates MIDI ports, and an address there means nothing.

All ways of firing a configured macro share its overlap policy: meters, console state, MIDI, inter-app OSC,
timecode cues and manual firing. **Drop** refuses a new run while one is active; **Queue one** retains one waiting
run; **Restart** cancels the current run and replaces any waiting run. Replaced or refused orders retain their own
outcome. Panic and Disconnect cancel every admitted active or waiting run. A run belongs to its connected session
and destination, including during preflight; a saved address cannot authorise another console. Cancellation checks
precede each action and follow transport-lock waits. A packet already handed to the operating system cannot be recalled.
