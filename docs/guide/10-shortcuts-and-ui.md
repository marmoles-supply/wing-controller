# 10 · Shortcuts & UI

## Keyboard shortcuts

**Workstation.** `Cmd` is macOS; on Windows and Linux the same shortcuts use `Ctrl`.

| Keys | Action |
| --- | --- |
| `F12` | PANIC STOP — fires even with a dialog open or caret in a field. |
| `Space` | Arm / disarm the draft; arms, never fires. |
| `Cmd+S` / `Cmd+E` | Save the draft / enable-disable the selected macro. |
| `Cmd+,` / `F1` | Open Properties / open Properties > Guide & Help. |
| `Cmd+I` | Show / hide the Inspector. |
| `Cmd+M` | Toggle the Meter Bridge: open, or close when open. |
| `1`–`9` | Select macro 1 to 9; selects, does not fire. |
| `Escape` | Close dialogs; leave "Only meters"; hide the tooltip. |

Two rules suppress everything else:

- When a dialog, HUD alert, matrix or context menu is open, only `F12` and `Escape` fire. `F12` works
   from inside all of them, and it never asks for confirmation unless you switch that on in Properties.
   **PANIC STOP does not hide behind any of them**: with a broadcast alert on screen, and also with a
   modal dialog open, the master header is painted above it, so the button stays clickable; the alert
   card carries its own **PANIC STOP** as well.
- With the caret in an `input`, `textarea` or `select`, nothing else fires, `Cmd+S` included.

`Space` can be switched off in Properties > Keyboard Shortcuts. That tab's list is the complete one,
while the older list below it omits `Space`, `F1`, `F12` and `1`–`9`.

**Meter Bridge.** The status bar repeats the list.

| Keys | Action |
| --- | --- |
| `M` | Channel Matrix selector. |
| `R` | Reset all peaks and clips. |
| `V` / `H` | Vertical (console) / horizontal (rack) layout — LED Bars only. |
| `1` / `2` / `3` | LED Bars / Vintage Analog VU / Task History Graph. |
| `+` or `=` / `-` | Zoom in / out by 0.1, between 0.6 and 2.0. |
| `Escape` | Close About, the matrix or a menu; `Enter` accepts a dialog. |
| Warnings | A warning that offers it can be muted for that one action or for all of them; **Properties → General & UI → Warnings** lists what is muted and shows it again. |
| `F12` | PANIC STOP, and nothing else swallows it first. The bridge can be the focused window on a second monitor, so the emergency stop must not depend on which window is in front. |

Here the keys never fire while typing in a field, while a dialog is open, or with a modifier held,
so `Cmd+R` never resets peaks. `F12` is the exception on purpose: it runs even with a dialog open,
exactly like in the workstation. The status bar repeats the list on the right, and the panic
acknowledgement replaces the centre line until the next status event.

## The workstation layout

The master header holds the chips: logo (About), status, IP pill, **► Connect** / **■ Offline**,
**[!] PANIC**, a telemetry chip for macros, evaluations and rate, then **Inspector**, **Meters**,
**Properties...** and **? Help**.

Two columns: builder and library beside the ops column. The divider resizes it (260–850 px);
double-click resets to 420 px. Properties > General & UI sets side and width; under 1180 px the two
columns stack.

Five cards reorder: **Inspector & Live Info**, **Connection**, **Live Meters**, **Diagnostics**
(collapsed at start) and **Session Log**. Click a header or chevron to collapse, or drag `⋮⋮` to
reorder; both persist. Cards never float — only the Properties dialog does — and meters leave through
**⧉ Popout**.

**Only meters** hides the meter controls (style, size, zoom, add-channels, banks) and leaves the
meters. It persists, the button becomes **Show all**, and `Escape` exits.

## The Inspector

Hover any control and the Inspector shows its category, id, what it does now and the manufacturer's
tip — the fastest way to identify a control. The balloon waits for an 800 ms dwell. Hide the card with
`Cmd+I` or the ✕; the state persists.

## Right-click menus

The workstation replaces the browser menu:

- **Macro rows** and **action steps** / **IF gates**: open or load in the editor, enable/disable,
   duplicate, move, delete, copy JSON, test one step.
- **Meters and watchlist tags**: alias, reset peaks, remove, change style, add channels.
- **Channel fields**: paste, clear, open the matrix for that field. The matrix grid has no menu of its
   own — you drag or click cells.
- **Header and IP**: connect, stop, PANIC, Network settings.
- **Background**: Properties, Help, About, matrix, Meter Bridge, arm, save, theme, density, sticky
   header, PANIC.

In the bridge, right-click a **strip**, a **bank tab** or the **background** for aliases, peak resets,
styles, bank rename/update/delete, always-on-top and close. Arrow keys, `Enter` and `Escape` drive the
menus. Properties > Context Menu disables them.

## Properties (Settings)

Open it with `Cmd+,`, **Properties...**, the logo or the background menu; `Escape` closes it and ⧉
floats it. Tabs: **General & UI** (theme, density, layout, safety), **Channels & Matrix**,
**Meters & Popups**, **Console & Network**, **OSC Monitor**, **MIDI, Inter-app OSC**, **Timecode (MTC, LTC, SMPTE)**,
**Profiles & Backup**, **Context Menu**, **Keyboard Shortcuts**, **HUD & Courtesy Notices**, **Guide & Help**,
**About...**.

There is no Save button, on purpose: every control writes as it changes, and the footer says
"Changes apply immediately" beside one **Close** button.

## Density and theme

Interface Density has two modes: **Standard** and **Compact** (smaller buttons, fields, cards and
matrix cells). The density choice is remembered. The three-way control is the meter **Size** preset —
Compact, Normal, Large — setting meter zoom to 0.8, 1.0 or 1.35; it touches the meters, not the
chrome.

Theme is **Light (Classic Slate)** or **Dark (FOH Low Glare)**, and it is shared: the bridge listens
and repaints. Meter style and zoom are not shared: the bridge keeps its own, taking the dock values
only as a starting point. Watchlists and banks are shared. The background menu also toggles theme,
density and the sticky header.

In the **Live Meters** card the meters sit **one per row**, like the bridge: the name takes the width
it needs — it no longer shrinks as soon as signal arrives — and the value keeps its own slot on the
right. In the light theme the name is navy and the value maroon, the classic ink of the grey panels;
the dark theme keeps its own colours.

## The Meter Bridge window

Open it with `Cmd+M`, header **Meters**, **⧉ Popout** or Properties > Meters. It is a real second OS
window for a second screen or an iPad in Sidecar; its button becomes **⧉ Focus** while open. Close it
from the dock banner, Properties, its **⇲ Dock** button or its menu, and pin it on top. Size,
position and pin persist.

## Design language

The app looks like a classic workstation tool: nothing is rounded, depth comes from 1 px bevels and a
hard 2 px shadow, gradients are dithered Bayer 4×4 ramps, and LEDs are flat — a 1 px bevel means "lit"
instead of a glow. The light theme gives readouts sunken grey panels with navy ink for received and
maroon for sent; the dark theme keeps the bevels on low-glare graphite.
