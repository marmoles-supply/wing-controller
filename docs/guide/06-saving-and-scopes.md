# 6 · Saving & scopes

WING CONTROLLER keeps state in three places: JSON files the application writes, its own stored
preferences, and the station backup you export by hand.

## What is saved, and where

**(a) Files the application writes**, under
`~/Library/Application Support/Wing Controller Desktop/`:

- `macro_library.json` — the whole macro library.
- `show_runner_config.json` — the show profile: the macro in the editor, not the library.
- The explicit exports — `wing_show_runner_config_export.json` and
  `wing_macro_library_export.json` — wherever you choose to put them with the system's Save panel.
  When that panel cannot be shown at all, the file goes to a `WING CONTROLLER` folder inside your
  Downloads folder instead, and the window says which path it really got.

Writes use a temp file and a rename; the old content goes to `.bak` first.

**(b) Stored preferences.** Both windows share one store, so the work window and the Meter Bridge
see the same preferences. Whether the bridge window is open belongs to the session and never travels,
and the handoff of a draft being edited between the two windows is session-only as well.

**Which survives what.** The files survive anything that clears the stored preferences, including
**Reset to Factory Defaults** — which wipes every preference except the console address, the window
state and the browser-mode simulation library. Stored preferences survive a normal quit and relaunch,
but only on this machine. The station backup is the only supported way to move them to another one.

## The scope system

Every preference belongs to one of four scopes. Anything that is not listed falls into **settings**,
so a new preference never falls out of a backup.

- **network** — the console IP address, the disconnect timeout, the chosen adapter, strict adapter
  mode and auto-reconnect.
- **meters** — the watchlist, the meter banks, the meter style, size and scale, the graph speed and
  refresh rate, the peak-hold configuration, the saved layout, and the meter window's geometry and
  always-on-top pin.
- **macros** — nothing of its own any more: the real library is not a preference (the macros section
  of the backup carries it as its own object, together with the macro that was in the editor) and the
  browser-mode simulation library is this machine's own pretend data, which never travels.
- **settings** — everything else: theme, density, sticky header, sidebar side and width, hotkeys,
  tooltips, context menus, matrix keys, HUD keys, safety keys, the OSC view, the popout state, the
  courtesy notice, the Inspector, which bank each window is showing, and the settings window's
  geometry.

## The station backup file

A schema-3 file has an envelope with the application name, `schemaVersion: 3`, the version,
`exportedAt`, the `scope` array you ticked, a `show` object and a `data` object with one section per
scope: `macros` carries the library and the draft that was in the editor, `meters` carries the
watchlist, the peak configuration and the meter preferences, and `network` and `settings` carry
theirs.

The `show` object is the show's identity: the name you typed, when it was saved, which scopes the
file carries and which version of the app wrote it. Because the name is **inside** the file and not
only in its file name, a file renamed by hand, sent by mail or copied off a USB stick still says
which show it is, and loading it puts the name back in the **Name** box.

A **complete** export also writes the flat schema-2 fields (the library, the draft, the stored
preferences, the watchlist, the peak configuration and the settings) so an older version can read it. A
schema-2 file is still accepted and read as "carries everything": the app reports all four scopes
for it.

Validation is per section and returns the first reason. A bad key in the meter section is refused
with "Backup file contains invalid preferences (meter section)."; network says "(network section)",
a section holding keys of another scope says "Backup file has *scope* preferences that belong to
another section.", and an unknown scope is named too.

## Export

Settings → Full Station Backup shows four checkboxes (Macros, Settings, Meters, Network), all
checked, plus Select all / Select none. With nothing ticked you get a "Nothing selected" dialog and
no file.

Otherwise, with **Ask where to save** ticked, the system's Save panel opens suggesting the show's own
name as `<show>.wcz` — the app's own file type for a saved show, so it is recognisable in the Finder —
and the file is written where you choose. Saving the same show again (any day) **replaces that file**:
saving a show means updating it, not piling up a copy per day. An older `.wingstation.json` or `.json`
file still opens. Untick it and the backup is written straight into the folder next to the tick box —
`Documents/WING CONTROLLER shows` until you choose another with **Folder…** — which is what you
want during a show, when a dialog per export is only in the way. That folder is created when the app
starts, not when you first save, so it is already there the first time you look for it; an older
`WING CONTROLLER backups` folder is renamed to it on first start, so shows saved with a previous
version stay where you expect them.

A confirmation always says **where the file went** and which sections it carries, with **Show in
Finder** to open it, and the app keeps a log of every step in
`~/Library/Application Support/Wing Controller Desktop/logs/shows.log`. Three things are worth
knowing because they are what makes this reliable:

- **If the Save panel cannot be used** — it does not answer, or another one is already open — the
  backup is written into the backup folder anyway and the confirmation says so. An export can no
  longer end with no file and no message.
- **Cancelling the panel** writes nothing and the log records `station_backup_export_cancelled`.
- **"Running WING CONTROLLER <version> (build …)"** is printed at the top of this panel: the version
  you are looking at is the one writing the backup.

### The SHOW box next to the macro list

The macro library card carries the day-to-day side of the same backup, in a box titled **Show**:

- **Name** — the show you are working on. It is the one name in the app: what you type here is also
  what the Properties panel shows and what is written inside the file. It remembers itself, so you
  type it once per show.
- **Save…** — saves the show. It asks first what the file carries (macros and meters ticked, because
  that is what a show needs) with the name already filled in, then opens the system Save panel, or
  writes straight into the folder if **Ask where to save** is unticked.
- **Load…** — loads a show: pick the file and then which of its sections to apply. The dialog that
  asks for the sections shows both sides of the file's identity: **its name on disk** and the
  **show name written inside it**, with when it was saved and the version that wrote it — so two
  saves of the same show are never confused. A file from an earlier version, which carries no such
  metadata, says so instead of showing a blank, and it still loads: it is offered as a
  macros-only backup.
- **The line under the buttons** — which show, when it was last saved, where it went, and whether
  there are changes since. If it says there are unsaved changes, closing the app will ask you before
  quitting.

The ticked sections are remembered as well, so the next save offers what you chose last time rather
than making you tick it again.

### One file per show

That is what the scopes are for. A show needs its own macros and its own meters, but not a different
console address: tick **Macros** and **Meters** (leave Network and Settings unticked), type the show
name in **Name** and save. The file is suggested as `<show>.wcz`, one file per show, so saving after a
change updates that same file instead of leaving a copy behind; the name is remembered for the next
save — during a run you type it once. The folder of the last backup is remembered too, so the next Save or
Open panel starts there.

To load it, use **Load…** (or Restore Station Backup in Properties), pick the file and leave only
the sections you want back. Only
those are replaced: the console address, the theme, the shortcuts and the rest of the station stay
exactly as they are, which is what makes one file usable in a venue where the network is not yours.

Restoring a show replaces the whole section it brings, so a macro library with three macros leaves a
library with three macros. Keep the show files and restore the previous one to go back.

## Restore

Restore Station Backup… opens the system's file picker (filtered to `.wcz`, `.json` and
`.wingstation.json`; 5 MB maximum) and refuses while a session runs unless it is idle or offline. The dialog lists exactly what the file brings, with counts ("N macros", "N preferences")
and every box checked. **Only what you tick is written.** Untick everything and the restore is
cancelled. The macro library is written to its file, with the draft that was in the editor; the meter
preferences are written straight to their store, and the rest go through the same preference store,
which reports `removed: 0`. When a file carries the same setting twice — the section's own field and
the flat preference copy — the section's field wins. When the window comes back it **says what it
restored** (the file and the sections, with their counts), so a restore that changes nothing visible
is still a restore you can see. The restore does **not** delete anything else — the old behaviour of
wiping every stored preference first is gone. The
window then reloads.

## Show profiles and the macro library

- **Save / Load Show Profile** — one macro's configuration (triggers, steps, timing), in the
  app data directory.
- **Export / Import Show JSON** — the same single configuration, through the system's Save and Open
  panels: you choose the file, and closing the panel without choosing one changes nothing at all.
There is no separate library export any more: the **Save… / Load…** buttons of the SHOW box are the
one way in and out, so a library never leaves the app through a fixed path of its own. A bare library
file written by an older version — the `wing_macro_library_export.json` of previous releases — still
loads through **Load…**, where it is offered as a macros-only backup.

Show profiles and Show JSON carry macros only, are written straight to disk where you chose, and are
read back through the system's Open panel. A show is one `.wcz` (or an older `.wingstation.json`) with
library, draft and preferences together. Both those imports take a `.recovery.` snapshot before
replacing the live file. A station restore also saves a scoped **Before restore … .wcz** recovery copy
before its first change; if that copy cannot be saved, the restore refuses.

## Recovery copies

- `.bak` — `macro_library.json.bak`, `show_runner_config.json.bak`, beside the live files.
  Written on every save when the live file already exists, before the replacement. When the live
  file is unreadable the app falls back to the `.bak`, copies it back and reports `config-recovery`.
- `.recovery.<ms>.<pid>.<seq>.json` — snapshots taken when an import is about to replace a file;
  up to 20 per file, oldest pruned.
- **Before restore … .wcz** — the selected station sections before a restore, in the chosen backup folder.
  Load it through the SHOW box. A recovery copy can explicitly remove preferences introduced by the failed
  attempt; ordinary backups continue to merge the preferences they carry. Deletions are limited to the
  declared sections and can never include application bookkeeping.

To use one: quit the app, copy the snapshot over the live file, reopen.

## Limitations, verified

1. **The editor draft is kept across the restore.** It is saved to disk and handed to the next
  boot, which prefers it over the saved library. The draft you had in the editor comes back as you
  left it.
2. **The Meter Bridge does not reload.** Only the work window reloads itself. The bridge applies
  live only the preferences it listens to (the watchlist, the theme, the meter scale, the peak
  configuration and the banks), and it reads the layout, meter style, graph speed, refresh,
  geometry, bank and pin only when it opens. Close and reopen it after a restore.
3. **A failed restore attempts to put every changed section back.** The library, draft, cue list and
   affected preferences are captured before writing. Each recovery is attempted even if another fails;
   the refusal names any section it could not recover and the recovery file to load. This is recoverable
   compensation across files and preferences, not a crash-atomic transaction: a power cut or forced process
   termination can interrupt it, in which case load the saved recovery copy.
4. **The browser-mode simulation library stays on the machine.** It is the pretend library the window
   simulates when it runs without an application backend: it is not part of the station, so it is
   neither exported nor written back by a loaded file.
