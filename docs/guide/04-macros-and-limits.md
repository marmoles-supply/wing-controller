# 4 · Macros & limits

A macro is **WHEN** it listens, optional **IF** gates and **THEN** a timeline of steps.

## What a macro is

A macro carries a name, an enabled flag, a colour tag and a courtesy-notice flag, plus the three
parts of its recipe. **When**: source, channels, parameter, comparator, threshold, meter timing.
**If**: zero or more gates combined with AND or OR, evaluated when the trigger arrives.
**Then**: up to 32 ordered steps. The editor shows the recipe as When / If / Then; a new macro
starts blank. That summary can be drawn in two ways, chosen in **Settings → General & UI →
Appearance & Visual Theme → Macro summary**: the classic **three lines** of text, or one **card per part** — the trigger with its
qualifiers as chips, one row per gate with the AND/OR that joins them, and the steps as a numbered
list with the disabled ones marked. Both show the same macro and neither changes what runs.

## The library

**Saved Macros** is the library, capped at **128 macros**; anything past that is dropped silently.

It is stored as `macro_library.json` in the app's data folder, under
`~/Library/Application Support/Wing Controller Desktop/`. Each write copies the old file to
`macro_library.json.bak` before renaming the new one in; if the main file is unreadable the library
falls back to that `.bak`. Import also keeps the last 20 snapshots of the library.

- **Filter box** matches name, trigger and target.
- **Multi-select**: row checkbox, Shift, Cmd, **Select All**, which takes the whole library, not
  just filtered rows.
- **Batch actions**: Enable or Disable Selected, Duplicate, Delete, `[!] Notice`, Export, Import.
  Export and Import are the show's **Save…** and **Load…** (see chapter 6): they ask for the
  sections and the file rather than using a fixed desktop path, so nothing leaves the app without
  being told where it goes.
- **Batch enable is a toggle**: it enables if any selected macro is disabled, otherwise it disables
  them.

## Why a macro cannot be enabled

The app refuses to enable a macro for two reasons:

1. **Trigger not configured** — source, channels or parameter empty.
2. **No runnable action step** — no enabled step, or every enabled step has no address and is not
  a **Wait** or **HUD alert** step. Those two modes write nothing, so they need no target.

The window mirrors the rule, with a dialog naming the macro and the reason. An enabled macro that
still fails to compile at connect time is skipped and logged.

## Arming vs enabling

Enabling means "this macro belongs to the show". Arming means "run only the macro in the editor, now,
so I can prove it". **Arm Draft Only (Test)** is one flag on the draft; while it is set the draft is
the only macro compiled and the library is discarded for that session.

- Arming runs preflight and refuses if it fails.
- Arming is refused while the stream is live or reconnecting: Live Safe Mode answers with a
  dialog, not silence.
- Arming is deliberately not saved: the arming flag is dropped both on load and on save, and the
  draft keeps its "unsaved" marker.
- Click the button again to disarm.

## Preflight

**✓ Verify Syntax (Preflight)** checks the draft offline, without sending OSC:
valid IPv4, finite threshold, meter triggers limited to `>` or `<`, a resolvable trigger and
compilable gates, at least one enabled step, and per step a supported kind and mode, an address
starting with `/`, no meter address, no ambiguous legacy `/flt/cf`; **Set** and **Wait then set** values
must be inside the documented range.

It also returns a **packet estimate** for one run: a fade counts its ramp steps (2 to 128) times the
channels the selector names, **Wait** and **HUD alert** zero. The preflight also notes a fade whose
duration the 17 ms send limiter cannot fit, naming how long it will really take, and a fade endpoint
the target parameter cannot hold, naming the value the fade will use instead.

## Verify Targets

**Verify Targets** reads every OSC address your macros use and reports which ones the console
answers. It collects enabled writing steps, gates and state triggers, and skips meter addresses,
which are not readable leaves. It is read-only, checks at most 64 addresses within 20 s and says
how many of the total it checked.

A silent target means the console did not answer: writes to it are ignored without error, so a
macro can fire and change nothing. For gate, compressor or EQ addresses the app also reads the
strip's model, because those names depend on it.

## Colour tags and the courtesy notice

Six tags exist: none, red, green, blue, amber, purple. A tag is a label for you: it changes nothing
about what the macro listens to or sends, and it is not a compiled field, so changing it does not
restart a live session.

The courtesy notice is a per-macro flag. When the macro starts, a floating card shows its name, what
it does and the time. Neither the tag nor the notice reaches the console or changes the timing of a
run.

Its preferences live in **Properties → HUD & Courtesy Notices**, and every one of them is about reading
the card rather than about what the macro does:

- **Auto-dismiss after** — a slider from half a second to thirty, and fully left is *Persistent*: the
  card then waits for its ✕. The thin bar along the bottom drains over exactly the chosen time, so the
  card itself says how long it has left.
- **Notice size** — scales the card's text and padding from 70 % to 180 %. The borders stay one pixel
  wide, so a large card still reads as a classic window instead of a stretched bitmap.
- **Accent colour** — the caption and the drain bar of an ordinary notice. It deliberately does **not**
  touch a failure or a test: a failed action keeps its red caption and a test keeps its blue one,
  because those two colours are what the card is saying.
- **Flash the card** — off by default, or only when an action failed, or on every notice. It pulses the
  outline once a second, deliberately below the three-per-second rate that makes a flashing surface
  unsafe, and it is switched off entirely when the system asks for reduced motion.

The corner, the chime and whether new macros start with a notice sit beside those, and **» Test
Courtesy Notice** draws a real card so all of it can be judged without waiting for a show.

## Compiling for the live session

The macro set is captured when the stream connects: the library is compiled once, at the start. A
later save re-applies it, but only when the fields the running session compiles changed; name,
colour tag and courtesy notice are excluded, so a rename does not blip the stream.

**Armed-draft exception**: while armed, the re-apply is skipped because only the draft is compiled;
the window applies the saved library when you disarm or reconnect.

## Limits and warnings

| Limit | Value |
| --- | --- |
| Macros per library | 128, truncated silently |
| Steps per macro | 32 |
| Delay per step | at most 60 s |
| Fade duration | 20 ms to 60 s; steps capped at 128, and one step writes one packet per selected channel, so a wide fade gets fewer steps — the preflight says when the duration cannot fit |
| Packets per fade | 2 to 128 steps × the channels the selector names |
| Fade endpoints | held to the target parameter's own range (a value it cannot hold is moved to the nearest it can, and the preflight says so); an *amount* is not a value and is never clamped — the value it produces is |
| Relative fade | "where it is now" reads the leaf first (one read, ~250 ms budget at worst) and fails the step, writing nothing, if the console does not answer |
| Ramp domain | the leaf's own: by ratio for a frequency, a Q or a release time, by offset for a level or a percentage |
| OSC pacing | one packet per 17 ms |
| Macro name | 60 characters; save and arm refuse longer |

Chapter 11 repeats these rows and adds the rest — meters, subscriptions, the log, Verify Targets — in
a single table, so it stands alone as a checklist.

One honest limitation. WING does not echo UDP writes, so the app checks the
writes it can by reading the value back. Every **Set**, **Wait then set**, **Fade**
and **Smooth fade** step that carries a value is read back within 250 ms and logs a verification
warning when the console reports something else — text and closed lists as
trimmed text, numbers with a 0.005 tolerance. If that happens, the run is shown
and counted separately as **completed with unconfirmed writes**: the timeline
finished, but it is not a clean completion. One gap remains open: a
**write-only command** (a W-Live transport leaf, the AES50 reset, a recorder or
player action) has no state of its own to read, so it is sent unverified — its
own report is a different key, such as W-Live State or the AES50 counters.
Run **Verify Targets** first, and read a clean green run as "the packets were
sent and the readable writes came back as expected", not "every possible console
side effect was proven".
