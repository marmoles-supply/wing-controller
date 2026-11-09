# 9 · Troubleshooting

Each entry: what it looks like, the likely causes in order, where to look, what to do.

## "I press Connect and it says Cannot reach console"

**Looks like:** the Connection card chip and the top badge read `Cannot reach console`, and the red line
under the buttons repeats it.

**`Cannot reach console` is `failed` — a first connect that never reached the console. `Connection lost` is
`offline` — a link existed and dropped.** Two states on purpose; for the second, read the meter entry
below.

1. **Wrong IP, or the console is off.** `WING?` goes to UDP 2222 and needs a `WING,` reply from
   exactly that address within 650 ms. The message names the IP and the adapters tried. Fix `WING IP`
   in the Connection card; it locks while connecting.
2. **Wrong Mac adapter.** Every local IPv4 is tried in turn. With **Strict Network
   Mode** only the adapter you picked is used, with no fallback; a missing adapter is
   named. Both live in Properties → *Console & Network*.
3. **Different subnet, no route.** The fallback binds the system default and gets nothing either.

**Do:** fix the IP or adapter, then confirm with **Verify WING** in Diagnostics
(`model · IP via interface`). Auto-reconnect retries every 2 s and keeps the `Cannot reach console`
label, because no link ever existed; turn it off for one attempt.

## "It is connected, meters move, but no macro fires"

1. **Not enabled.** The Connection summary row counts what is listening while live;
   a library row that says `OFF` is not compiled. Enabling is refused with a reason
   when the trigger or the action is incomplete.
2. **The library was edited after you connected.** The set is compiled at connect. Saving while live
   re-applies it, **except with a draft armed**: the log says `live_macros_reapply_skipped_armed`.
3. **Armed with the draft only.** `Arm Draft Only (Test)` makes that draft the only
   compiled macro; arming while live is refused.
4. **Source, IDs, threshold, edge.** An index the console does not have never arrives. New macros
   start at −18 dB and `ON edge` means rising only: the crossing needs previous `<` and current `>=`
   the threshold, so an already-loud signal must fall and rise first.
5. **Baseline.** Every connect clears the trigger state and the first frame
   becomes the reference, not an edge. A transient must drop and rise, or rise
   `Rearm dB` above the lowest value since you armed — hence the second hit fires.
6. **Stale-after.** A longer gap re-baselines and drops the hit; an IF gate on that meter counts as false
   once it is that old.
7. **IF gates.** The row shows `blocked` as its last event, and the Session Log gets the
   `IF conditions are not met` line.

**The watchlist is not a cause:** a trigger subscribes its own meters. The trap
is the slot — slot 0 is the input left leg, so a channel panned hard right reads as silence.

## "The macro fires — the row flashes — but nothing happens on the desk"

The console ignores a write to a path it does not know, with no error.

1. **Verify Targets** (Diagnostics → Probe) prints `<n> of <n> targets answer the console` and marks
   the rest `[SILENT] <address> no reply - strip model: <model>`. It checks at most 64 addresses in
   20 s, and says when the sweep was partial.
2. **Strip model.** The line under Parameter in *3. Action Target* reads `/gate/mdl`, `/dyn/mdl` and
   `/eq/mdl` and shows the model, or `silent`. A different gate, compressor or EQ model has different
   parameter names, and the write is ignored in silence; preflight warns too.
3. **Out of range.** The editor marks the field as you type, and preflight catches it before anything
   is sent.

Every write that carries a value is read back — **Set**, **Wait then set**, and a fade or smooth fade
at the end of its ramp — and a mismatch shows as `step_verify_failed: …` (the `action-verification`
event) in the Session Log. Numbers are compared with the documented tolerance, text and closed lists
as trimmed text. A mismatch is a report, not a failed step, so the macro carries on, and a TX row
proves the packet was sent, never that the console obeyed it.

## "The meters stopped moving but it still says Live"

Check **Last RX** (`N ms ago`) and **Rate**. Rate `0.0 Hz` with Last RX climbing is a stalled meter
stream.

Two watchdogs, and only one of them ends the session.

- **No packet of any kind** for **Network timeout** (3.5 s by default, 2–10 s in Properties →
  *Console & Network*) ends it: the status says `no valid packets from <console address> for N s`, the
  badge becomes `Connection lost`, and Rate, Bytes and Decode blank to `–`.
- **No meter frame while something is still arriving** does not end it. The console can answer
  identity and OSC state perfectly and send no meters at all (the group it was asked for is empty, or
  the subscription was refused), so the session lives: the status says `connected; no meter frames for
  N s — asking the console again`, the app re-requests the meters over the native meter link — and
  reconnects that link first if it has gone — and every console write is still accepted.
- If the re-request cannot be sent at all, the same status reads `… reconnecting the meter link`, and
  the meter watchdog stays armed to try again.
- The session ends on a meter stall only when **nothing** is arriving: the status then reads
  `native meter stream stalled`.

So a grid that still says `Live` while the meters are motionless is telling the truth about the link:
read the status line, not the badge, to tell the two stalls apart.

**Do:** if the line reads `asking the console again`, the meters have already been re-requested — give
it a watchdog window. If it reads `reconnecting the meter link`, the app could not send the request and
is re-establishing the meter link; if either line persists, check the cable, the switch port and the
console's network, then **Disconnect / Stop** and **Connect + Listen**; Disconnect also cancels the
pending reconnect. To stop it now: **F12** or **Panic Stop**. The OSC monitor's `● ACTIVE` / `● IDLE`
badge (3 s of silence) agrees.

## "Live Safe Mode blocks me"

**Looks like:** the chip reads `[LOCKED] Live Safe Mode`; library buttons look dead with the tooltip
"Live Safe Mode: disconnect to change the library"; refusals log `live_lock_blocked <action>`.

**It covers** saving, creating, duplicating, deleting, importing, exporting, reordering, enabling,
the colour tag and the courtesy notice, arming, sending a test action, firing a macro by hand (Fire
Macro) and resetting preferences. It is enforced by the window while the stream is live, connecting or
reconnecting, and it is off by default.

**Out:** press **Disconnect / Stop**, or Properties → *General & UI* → **Live Operational Safety** →
clear `Live Safe Mode`; the library buttons come back immediately.

## "My bank shows meters that are not in my watchlist"

On purpose. While a bank is selected its members are displayed **and subscribed**, even when they are
not in the watchlist, and the hint says `N of its M meters are not in this watchlist and are being
listened to anyway`.

**"The bank I pick in one window does not change the other."** Also on purpose: the same banks in both
windows, one choice per window — the workstation in the dock, the bridge in its own window.

## "A window opens where I left it — off-screen"

The Meter Bridge, the Guide, the workstation window and the Properties dialog all save where they were
and how big they were.

- **Workstation** (this window): its size and its place come back at launch. A remembered place that
  no longer lands on a screen you have is dropped, and the window opens centred at its default size
  instead.
- **Meter Bridge:** position and inner size are restored, and they are checked against your monitors:
  a saved place that no longer exists is moved back into the screen that covers most of it. It opens at
  960×640 and does not reopen at launch — use **⧉ Popout** or `Cmd+M`.
- **Guide:** position and size are restored as they were, without checking your monitors; it opens at
  980×720 and reopens with **Open the complete guide** in Properties → *Guide & Help*.
- **Properties:** the position is restored verbatim, and the drag is clamped to the window while the
  restore is not. Whether you left it floating is remembered too.

**Back:** Properties → **Re-centre windows** (the *General & UI* tab). It centres the Properties and
Channel Matrix Selector dialogs, forgets the position they had remembered, brings the Meter Bridge and
the Guide back on screen (a closed one reopens centred, because the saved position is cleared too), and
forgets this window's own saved box, so the next launch opens it centred at its default size. Nothing
else you saved is touched. Only if that fails, Properties → **Reset to Factory
Defaults**, the last resort: it removes every saved window key and reloads, and it also returns every
other preference to its default (the macros in your library are not deleted).

## "Panic Stop does not stop the console"

**Does:** raises the stream stop flag and the Shoot's own stop flag, and logs `panic_stop_requested`;
`F12` and the toolbar `[!] PANIC` fire the same call.

**Stops:** the app's own traffic, the pending step and a **Test Action (Shoot)** in flight — a test
`delay` or `fade` of up to 60 s ends where it is instead of running to the end. A running timeline
stops between steps and is reported `aborted`, not `failed`.

**Cannot:** undo what was already applied — values already written stay on the desk; reconnect by
itself.

A rejected stop shows `PANIC STOP FAILED`, telling you to stop the stream on the console itself.
That desk-side stop covers everything else.
