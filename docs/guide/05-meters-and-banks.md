# 5 · Meters & banks

## Where the meters come from

The console sends native meter frames: a client report id plus signed, big-endian 16-bit values, with levels in 1/256 dB. The app turns each value into dB and hands every watched meter to the windows with its label, its address and its value; both windows paint them.

Meters appear in two places: the **Live Meters** card and the separate **Meter Bridge** window, opened with `Cmd+M` or **⧉ Popout**; with the bridge open, `Cmd+M` closes it.

While it is open, the card keeps painting and shows an `[EXT]` banner with **Bring to front** and **Close window**; Popout becomes **⧉ Focus**. The app subscribes both meter lists together; closing the bridge releases its share.

## The watchlist

The watchlist is what you want to see; it starts empty.

To add, pick a **Group / Source** (USB, Card/Dante, channels, buses, DCAs, outputs…), type **Channels / IDs** as `1-4, 7`, or press **Matrix...** and tick them; Matrix fills the field and adds immediately, and **+ Add Channels** commits. **Label / Alias** is optional and numbers multiple IDs.

Click or double-click a meter name to rename it in place: **Enter** saves and the cell leaves edit mode at once (Escape cancels); the right-click menu has **Rename / Set Alias...** and **Remove "<name>" from Watchlist**. Each tag in the strip carries `‹` and `›` to move that meter one place left or right — the order of the strip is the order of the watchlist, which is the order of the meters in the view — and `×` to remove just that one. **✕ Remove All Meters** asks first.

The **Matrix...** dialog opens showing **what the view already has** ticked (per group), so it is a picture of the current selection rather than a guess: tick more and **Add to Meters**, or use **Replace & View** to leave exactly what is ticked. It no longer arrives with USB 1-3 chosen.

CLIP is a latch, so it stays lit after the peak falls; click the **CLIP** badge to clear it. **Reset PK** clears peaks and the latch, blocking re-latch for 250 ms.

## Styles and sizing

**Style**: LED Bars (Phosphor), Vintage Analog VU (a smoothed needle, not true ballistics) or Task History Graph. **Size** Compact / Normal / Large applies 0.8 / 1.0 / 1.35 zoom; **Zoom** runs 60%–200%. The dock scales the bars but not the value text; the bridge scales both. **Peak** toggles hold, **Reset PK** clears it; duration (1 / 2.5 / 5 s or Infinite) and clip latch are in Settings.

The dock lays its meters out one per row. The name takes the width and the value sits in a fixed
slot at the right, so the name does not shrink when the meter starts showing signal; a name too long
for the card is shortened with an ellipsis. In the light theme the name is navy and the value
maroon, so both stay readable on the grey card.

Two sliders appear with the graph style:

- **Speed**, called **Scroll** in the bridge: 1–10, default 5.
- **Graph Refresh Rate**: 5–120 samples per second, default 30. Refresh is how often a sample is taken and the trace redrawn; scroll is how much history is on screen.

Both windows label the control as a speed (1x…10x) and the tooltip now says what it does, but the maths is not the same in the two: the **bridge** shows `12000 / speed` ms of history, so 5x is 2.4 s; the **dock** keeps a fixed 60-sample buffer pushed every `350 / speed` ms, so 5x is about 4.2 s, 1x about 21 s and 10x about 2.1 s. Same word, different scale: read the dock's scroll as "how often a sample is pushed", not as seconds.

## Banks

A bank is a named list of meter keys (`ch:1`, `usb:7`…). Both windows read the same banks and pick up edits made in the other one at once.

The bridge manages them: **+ New from watchlist** asks for a name, then which meters it keeps, all ticked by default. Right-click a tab to rename, **Update from watchlist** (asks again) or delete; deleting leaves the watchlist alone. The dock only chooses.

Each window remembers its own choice, so selecting a bank in one does not change what the other shows.

A bank may hold meters outside the watchlist: they are shown with a channel-name label and subscribed too. The hint gives the count: "N of its M meters are not in this watchlist and are being listened to anyway."

## "Only meters"

**Only meters** hides the card's configuration: the view strip (style, size, zoom, speed, Peak, Reset PK) and the ingest panel (group, IDs, alias, Add, Remove All, tags). It does not hide the window: the bank row stays visible so you can still switch banks, and the button tooltip says the same. Escape leaves, unless a dialog or menu is open. The choice is remembered for the next session.

## The Meter Bridge in detail

Selectors: **Group** tabs (Watchlist, USB 1-48, CH 1-40, AUX 1-8, BUS 1-16, MAIN & MTX), **Bank** chips 1-16 / 17-32 / 33-48, and **Custom banks**. **Mode** is Vertical (Console) or Horizontal (Rack); it applies only to LED Bars and is disabled with a note for VU and Graph.

Most of its preferences are its own — style, zoom and scroll — and two are shared with the dock: the peak-hold configuration and the graph refresh rate. Changing a shared one in either window changes it in both. **Reset PK** clears peaks and latch with the same 250 ms grace. It also has its own Matrix dialog, **✕ Remove N** and **Replace & View**, which empties the watchlist after asking.

## Limits and warnings

There is no total cap on the watchlist: any number of meters can be listed. Each group is capped instead — Channels 1-40, USB 1-48, Card/Dante 1-64, Local XLR 1-24, AES50 1-48, monitor 1-6. The ID parser clamps a range to that maximum and drops out-of-range IDs; if nothing valid is left, nothing is added and a **Cannot add those meters** dialog names the range. No group accepts an index above its own maximum. Source and output meters are requested as whole device groups, so one USB entry pulls that device's 48 values; the rest are decoded but not drawn.

A meter the console does not send shows **no data**, which is not the same thing as silence: the window
shows `–` with an empty bar and `PK --` for it, while a value the console really reported at the bottom of
the scale is still `-inf`. Nothing is remembered for a meter that has not reported — no peak, no history
sample, no needle movement — so a meter that is not being sent can never be mistaken for a quiet one.

The stream carries only what is subscribed. Two things ask: the enabled macros, which carry their own descriptors and are merged with the windows' display lists into the session subscription, and the display lists of the two windows themselves, the dock and the bridge. The watchlist decides what you see, not what a macro can trigger on: a macro compiles its descriptors from its own target and can trigger on a meter you are not displaying. Selecting a bank replaces that window's display list with the bank's members, so they show data even when they are outside the watchlist; the bridge subscribes a whole group when you pick USB or CH. A rejected watchlist update is reported instead of leaving a grid that looks configured.
