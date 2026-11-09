// The cue row, the list's own order, and the marks the engine's state paints — shared by both windows.
//
// Why this file exists: the cue row was written twice, once in `timecode.html` (the clock) and once in
// `index.html` (Settings), because the packaged frontend is `desktop/ui` with no bundler. Two copies of
// one row drift, and the drift is invisible until a show finds it. The project already has the idiom
// for sharing without a bundler — `dither.js` and `dropdown.js` are loaded with `<script src>` by every
// window that needs them — and this is the same thing for the cue list: one row renderer, one order
// comparator, one set of marks.
//
// What lives here and what does not:
//
//   * the **row** (time, number when the cue list carries one, name, tags, the buttons, the time editor),
//     the **order comparator** (`orderedCues`), and the **marks** the engine's snapshot and events paint
//     (`next` / `spent` / `fired` / `skipped`), because those are the things both windows must agree on
//     down to the class name;
//   * the **position arithmetic** (frames, nudge, the next free frame), because a nudge that landed on a
//     frame drop-frame numbering skips would produce a cue the save then refuses;
//   * the **draft's own bookkeeping** the row needs: undo of the last local change, the search filter,
//     the lock a row can be put under, and the "what just happened" record.
//
// What does not live here: which commands a window calls to read or write the list, how it words its own
// status line, and what a Settings row carries that a clock row does not (the macro picker and the two
// switches). Those arrive through `createPanel`'s config and its `extras` hook, so a window supplies its
// own words and its own backend and still gets the same row.
//
// A control that cannot do its job is not drawn. Two fields this module knows how to show are only drawn
// when the cue list actually carries them — `label` (the operator's name for a cue) and `number` (a cue's
// stable, addressable number). An older backend simply does not send them, and then no name field and no
// number column exist, rather than a box that would lose what was typed into it or a number that would
// vanish on the next read.
(function () {
  "use strict";

  /// The three layouts the list can be shown in, in the order the selectors offer them. `smpte` is the
  /// default and lives in the backend's `CueSortMode`; this array is only the view's copy of it.
  const SORT_MODES = ["smpte", "manual", "created"];

  /// How a list is driven, as the file spells it: by the show clock, or by the operator stepping through it.
  ///
  /// The same two words the backend's `CueDrive` serialises, because they are one field of one file.
  const DRIVE_MODES = ["timecode", "sequential"];

  /// The creation order, remembered by the window — a view note, never written into the cue file. The cue
  /// file keeps one array and the backend appends new cues to it, so the array order *is* the creation
  /// order until somebody reorders the list by hand, and reordering writes that array. Without a record of
  /// its own the "Added" view would become a second copy of "Manual" after the first hand reorder.
  const CREATED_ORDER_KEY = "wing_timecode_cue_created_order";

  /// Which rows this Mac is protecting from an accidental edit. A lock is a guard on **this** window while
  /// the show runs, not show data: it never reaches the cue file, so toggling it cannot re-arm the engine
  /// (`set_timecode_cues` does, and a lock is not worth re-arming a show for). Both windows read the key,
  /// so a cue locked in the clock is locked in Settings, and the `storage` event keeps the two in step.
  const LOCKED_KEY = "wing_timecode_cue_locks";

  /// How many local changes can be taken back. The design's honest minimum is "undo the last change"; a
  /// small stack costs nothing and covers the two or three presses an operator makes by accident. Bounded,
  /// because this holds copies of the list and a show can be long.
  const UNDO_LIMIT = 25;

  /// How much of a cue's name the one-line history shows. The clock window is 420 px wide and the line has
  /// a wall-clock time on it too; a long name is truncated rather than pushing the time out of the window.
  const HISTORY_NAME_MAX = 22;

  /// The class this module puts on the window's Save control, and the state it carries while the draft on screen is
  /// not the list the engine has. The window owns the question ("is anything unsaved?") and the module owns what the
  /// answer looks like, so the button reads the same in both windows — the point of this file.
  const SAVE_CLASS = "wing-cue-save";
  const SAVE_UNSAVED_CLASS = "is-unsaved";
  const SAVE_STYLE_ID = "wing-cue-save-style";

  /// The Save control's own look. It is styled from here rather than from the two windows' `<style>` blocks because a
  /// rule written twice drifts — the same reason this module exists at all (see the header). The ids are named in the
  /// selectors so these rules outrank the windows' own `.cue-bar button` recipe, which is more specific than a bare
  /// class. Every fact about the unsaved state is **static** (a colour of its own, an outline, a marker) and the pulse
  /// is only added on top: an animation is never the only signal, and a user who asked for reduced motion gets none.
  /// The class a **selected** row carries, and the look that goes with it.
  ///
  /// Selection lives here rather than in a window because the panel rebuilds every row on each render — a filter
  /// keystroke is enough — so a selection a window painted itself would vanish the first time the panel re-rendered
  /// without being asked. The marks already live here for the same reason. An outline goes with the fill so a selected
  /// row is visible in both palettes and to an operator who cannot rely on a subtle background.
  const SELECTED_CLASS = "is-selected";
  const SELECTION_STYLE_ID = "wing-cue-selection-style";

  /// The row's own look, and the reason it lives here rather than in each window.
  ///
  /// It was written by hand twice — `index.html:2817-2859` and `timecode.html:193-247` — and the two copies had
  /// **already drifted** in three ways an operator could see: the line gap was 6 px in one and 4 px in the other; one
  /// marked a clashing cue's time and the other did not; and only one drew the time field with the application's
  /// etched border, so the other fell back to the browser's own control. A third window (`ltc.html`) wrote none of it,
  /// so nine of the ten classes this module creates for every cue had no rule there at all and its rows ran together
  /// with no spacing, no monospace time and nothing separating one row from the next (2026-10-07).
  ///
  /// **The windows' copies must be deleted, not merely superseded.** This file is loaded by a `<script src>` *before*
  /// each window's `<style>` block — the note beside the installers below says so, and says the rules there are
  /// id-scoped so that the order is not what decides them. These are **class**-scoped, so for them the order **is**
  /// what decides: a class rule left behind in a window would come later in the document, win on equal specificity,
  /// and the drift would survive the move while looking fixed.
  ///
  /// **Every colour carries a fallback on purpose.** A host that forgets a token does not get "no colour" — it gets
  /// whatever the fallback says, in **both** themes, because a custom property that is not defined is simply invalid
  /// at computed-value time. That is how white text fields in the dark theme and a 1.06:1 product name reached the
  /// owner once already, and a fourth window will not read the paragraph above.
  const ROW_STYLE_ID = "wing-cue-row-style";

  function installRowStyles() {
    if (document.getElementById(ROW_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ROW_STYLE_ID;
    style.textContent = `
      /* The row's controls follow the kit's type scale, and they keep their own compact height. The shared
         chrome ("workstation.css", loaded after this injected sheet in the LTC and clock windows) styles every
         button and input on the page, so the rules for the row's controls are scoped under .cue-row: an equally
         specific rule written earlier would lose to it, and the same row would be 18 px in one window and 24 px
         in another. */
      .cue-row { --cue-control-h: max(18px, calc(var(--font-sm, 10.5px) * 1.5));
        display: flex; flex-direction: column; gap: 2px; padding: 2px 0;
        border-top: 1px solid var(--line-mid, #808080); outline: none; }
      .cue-row:first-child { border-top: 0; }
      .cue-row:focus { background: var(--face-3, #ffffff); box-shadow: inset 0 0 0 1px var(--accent, #000080); }
      .cue-row.is-fired .cue-at { color: var(--muted, #404040); }
      .cue-row.is-skipped .cue-at { color: var(--maroon, #800000); text-decoration: line-through; }
      .cue-row.is-off { opacity: 0.6; }
      .cue-row.is-clash .cue-at { color: var(--maroon, #800000); }
      .cue-row.is-next .cue-at { color: var(--accent, #000080); font-weight: bold; }
      .cue-row.is-spent .cue-at { color: var(--muted, #404040); }
      .cue-row.is-broken .cue-at { color: var(--maroon, #800000); }
      .cue-line { display: flex; align-items: center; gap: 4px; min-width: 0; }
      .cue-at { font-family: var(--mono, monospace); font-size: var(--font-base, 11px); flex: 0 0 auto; }
      .cue-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cue-name.is-blank { color: var(--muted, #404040); }
      /* **A fixed track for a cell that is sometimes absent.** The badge is drawn only when a cue has a number,
         and the time beside it is a flex item - so on a row without a badge the time moved left and the
         measurement read three different x for one column. A column that exists on every row must not be moved
         by a cell that exists on some. */
      .cue-number { font-family: var(--mono, monospace); font-size: var(--font-base, 11px); color: var(--accent, #000080);
        flex: 0 0 auto; min-width: calc(var(--font-base, 11px) * 2); }
      /* The slot and the badge are one track, so a row without a number does not move the time beside it. The
         width is derived from the same type step, so growing the scale cannot make a badge wider than the track
         that keeps the column aligned. */
      .cue-number-slot { flex: 0 0 auto; min-width: calc(var(--font-base, 11px) * 2); }
      .cue-tags { flex: 0 0 auto; display: flex; gap: 3px; font-size: var(--font-xs, 9.5px); }
      .cue-tag { padding: 0 3px; border: 1px solid var(--line-mid, #808080); color: var(--muted, #404040); }
      .cue-tag.is-fired { color: var(--accent, #000080); border-color: var(--accent, #000080); }
      .cue-tag.is-skipped { color: var(--maroon, #800000); border-color: var(--maroon, #800000); font-weight: bold; }
      .cue-tag.is-clash { color: var(--maroon, #800000); border-color: var(--maroon, #800000); font-weight: bold; }
      .cue-tag.is-next { color: var(--accent, #000080); border-color: var(--accent, #000080); font-weight: bold; }
      .cue-tag.is-spent { color: var(--muted, #404040); border-style: dashed; }
      .cue-tag.is-locked { color: var(--muted, #404040); border-style: dotted; }
      .cue-tag.is-broken { color: var(--maroon, #800000); border-color: var(--maroon, #800000); font-weight: bold; }
      .cue-buttons { flex: 0 0 auto; display: flex; gap: 2px; }
      .cue-row .cue-buttons button { height: auto; min-height: var(--cue-control-h);
        padding: 0 4px; font-size: var(--font-sm, 10.5px); }
      .cue-editor { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
      /* **A field is a WELL, not a raised face.** The kit's rule 2 puts a number the operator reads in a well, and
         its bevel table defines one as the same pair, reversed - dark on the top-left, light on the bottom-right.
         A raised face is the shape of a CONTROL; these four hold the time, so they are readouts. The default border
         above already makes every side dark, so a well only has to LIGHTEN the bottom and the right. */
      .cue-row .cue-editor input { width: 3.2em; height: auto; min-height: var(--cue-control-h);
        font-family: var(--mono, monospace); font-size: var(--font-sm, 10.5px);
        text-align: center; border: 1px solid var(--line-dark, #000000);
        border-bottom-color: var(--line-light, #dfdfdf); border-right-color: var(--line-light, #dfdfdf);
        background: var(--field, #ffffff); color: var(--ink, #000000); }
      .cue-row .cue-editor button { height: auto; min-height: var(--cue-control-h);
        padding: 0 4px; font-size: var(--font-sm, 10.5px); }
      .cue-sep { font-family: var(--mono, monospace); }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function installSelectionStyles() {
    if (document.getElementById(SELECTION_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SELECTION_STYLE_ID;
    style.textContent = `
      .cue-row.${SELECTED_CLASS} { background: #d8e4ff; box-shadow: inset 3px 0 0 #1c4fd0; }
      body.theme-dark .cue-row.${SELECTED_CLASS} { background: #1b2a44; box-shadow: inset 3px 0 0 #7fb2ff; }
    `;
    document.head.appendChild(style);
  }

  function installSaveStyles() {
    if (document.getElementById(SAVE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SAVE_STYLE_ID;
    style.textContent = `
      /* Calm: a solid action green, so the one control that writes is found without hunting and without shouting. */
      #cue-save, #timecode-cue-save, .${SAVE_CLASS} {
        background: #1c6f3c;
        color: #ffffff;
        border: 1px solid #0c3d20;
        border-top-color: #3fa363;
        border-left-color: #3fa363;
        box-shadow: inset 1px 1px 0 #4fbc74, inset -1px -1px 0 #0c3d20;
        font-weight: bold;
      }
      #cue-save:hover, #timecode-cue-save:hover, .${SAVE_CLASS}:hover { background: #24854a; }
      #cue-save:active, #timecode-cue-save:active, .${SAVE_CLASS}:active { background: #155a30; }
      body.theme-dark #cue-save, body.theme-dark #timecode-cue-save, body.theme-dark .${SAVE_CLASS} {
        background: #1f7a44;
        color: #ffffff;
        border-color: #0a2e18;
        border-top-color: #47b16d;
        border-left-color: #47b16d;
        box-shadow: inset 1px 1px 0 #55c47c, inset -1px -1px 0 #0a2e18;
      }
      body.theme-dark #cue-save:hover, body.theme-dark #timecode-cue-save:hover,
      body.theme-dark .${SAVE_CLASS}:hover { background: #268a4e; }

      /* Unsaved: a different colour, an outline and a marker, all of them there with no animation running at all. */
      #cue-save.${SAVE_UNSAVED_CLASS}, #timecode-cue-save.${SAVE_UNSAVED_CLASS}, .${SAVE_CLASS}.${SAVE_UNSAVED_CLASS} {
        background: #9a4407;
        color: #ffffff;
        border-color: #4d2102;
        border-top-color: #d98a3c;
        border-left-color: #d98a3c;
        box-shadow: 0 0 0 2px rgba(255, 208, 138, 0.55), inset 1px 1px 0 #d98a3c, inset -1px -1px 0 #4d2102;
        outline: 2px solid #ffd08a;
        outline-offset: 1px;
        font-weight: bold;
      }
      body.theme-dark #cue-save.${SAVE_UNSAVED_CLASS}, body.theme-dark #timecode-cue-save.${SAVE_UNSAVED_CLASS},
      body.theme-dark .${SAVE_CLASS}.${SAVE_UNSAVED_CLASS} { background: #a8500c; }
      #cue-save.${SAVE_UNSAVED_CLASS}::after, #timecode-cue-save.${SAVE_UNSAVED_CLASS}::after,
      .${SAVE_CLASS}.${SAVE_UNSAVED_CLASS}::after { content: "● "; color: #ffd08a; }

      /* The pulse: slow and shallow, so it draws the eye to an unsaved draft without turning into a flashing control. */
      @keyframes wing-cue-save-pulse {
        0%, 100% { box-shadow: 0 0 0 2px rgba(255, 208, 138, 0.30), inset 1px 1px 0 #d98a3c, inset -1px -1px 0 #4d2102; }
        50% { box-shadow: 0 0 0 7px rgba(255, 208, 138, 0.90), inset 1px 1px 0 #d98a3c, inset -1px -1px 0 #4d2102; }
      }
      #cue-save.${SAVE_UNSAVED_CLASS}, #timecode-cue-save.${SAVE_UNSAVED_CLASS},
      .${SAVE_CLASS}.${SAVE_UNSAVED_CLASS} { animation: wing-cue-save-pulse 2.6s ease-in-out infinite; }

      /* Reduced motion: no animation at all. Everything the state says is already in the rule above. */
      @media (prefers-reduced-motion: reduce) {
        #cue-save.${SAVE_UNSAVED_CLASS}, #timecode-cue-save.${SAVE_UNSAVED_CLASS},
        .${SAVE_CLASS}.${SAVE_UNSAVED_CLASS} { animation: none; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function readStored(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function writeStored(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* nothing to remember is not a failure */ }
  }

  /// `CSS.escape` where it exists, and a small equivalent where it does not: a cue id is used inside an
  /// attribute selector, and an id with a quote in it must not be able to break the query.
  function escapeForSelector(value) {
    const text = String(value ?? "");
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(text);
    return text.replace(/["\\]/g, "\\$&");
  }

  // ---- Position arithmetic --------------------------------------------------------------------------
  //
  // The arithmetic is the backend's own (`TimecodePosition::to_frames` / `from_frames`, drop-frame
  // included, with the 2 589 408-frame drop-frame day): nudging a drop-frame cue by a frame must not land
  // on a number drop-frame numbering skips, or every press would produce something the save then refuses.
  // It is arithmetic, not a second parser — no position is ever read from text here.

  /// The frame rate the cue's own position is written at. `fps29_97` counts 30 frame numbers per second —
  /// two numbers a minute are dropped from the numbering, not from the count — so its arithmetic is 30.
  /// **Both spellings of one fact, because the tree hands this function two and they must not disagree.**
  /// The record's `rate` is the LABEL the engine publishes (`label()`, `timecode.rs:68-76`: "24", "25", "29.97",
  /// "23.976", "30"); this module's own tables use the KEY ("fps24", "fps29_97", …). **MEASURED: five call sites
  /// existed and three passed the bare label into a lookup whose default is 25** — so the clock window interpolated at
  /// the wrong frames per second for every rate except 25, `clearMarksAfter` re-armed cues at a rate the same window's
  /// shift disagreed with, and a cue added from the macro editor on a 23.976 show was stored at 25 fps. The 23.976 arm
  /// below was added when that one case was found; **the fix did not reach the callers**, which is why this now accepts
  /// the label too. One home beats five fixes.
  function framesPerSecond(at) {
    switch (String(at?.rate || "")) {
      // The labels the engine publishes, mapped to the same numbers as the keys below.
      case "24": return 24;
      case "25": return 25;
      case "30": return 30;
      case "29.97": return 30;
      case "23.976": return 24;
      case "fps24": return 24;
      // 23.976 counts **24 numbers** a second, exactly as the backend's own table says (`Fps24 | Fps23_976 => 24`):
      // what is fractional about it is the wall-clock second, not the numbering. It used to fall to the default and be
      // counted at 25, which made a nudge or a shift move a 23.976 cue by the wrong amount — a rate the backend has and
      // this module did not.
      case "fps23_976": return 24;
      case "fps30": return 30;
      case "fps29_97": return 30;
      case "fps25": return 25;
      default: return 25;
    }
  }

  /// `01:00:12:15`, and `01:00:12;15` when the numbering is drop-frame: the convention every timecode tool
  /// uses, and the one the backend's `describe()` writes.
  function positionText(at) {
    if (!at) return "?";
    const pad = (value) => String(Number(value) || 0).padStart(2, "0");
    return `${pad(at.hours)}:${pad(at.minutes)}:${pad(at.seconds)}${at.drop_frame ? ";" : ":"}${pad(at.frames)}`;
  }

  /// What the timecode readout's state line says, from the snapshot, in **one** place.
  ///
  /// Both windows show this line — the settings page and the popout clock — and the sentence was written by hand in
  /// both, already differing in punctuation and in what they said about the window. A sentence two surfaces phrase
  /// independently is a sentence that drifts (AGENTS.md, "A Rule Written By Hand In Several Places Will Drift"), so it
  /// lives here and both call it.
  ///
  /// `compact` is for the clock, which is 420 x 200 and read from across a room: the same facts, fewer words. It is not
  /// a second sentence — the tolerance and the state are named in both.
  ///
  /// `freewheel_ms` and `freewheel_remaining_ms` come from the backend, which reports the tolerance and says `Some(0)`
  /// when the window is **exhausted** rather than never started: a clock that has never seen a position says so
  /// instead of claiming a dropout.
  function timecodeStateText(snapshot, options = {}) {
    const errors = [snapshot?.forwarding_error && `MTC forwarding: ${snapshot.forwarding_error}`,
      snapshot?.as_run_error && `Recording failed: ${snapshot.as_run_error} (retrying)`].filter(Boolean);
    return clockStateText(snapshot, options) + (errors.length ? ` · ${errors.join(" · ")}` : "");
  }
  function clockStateText(snapshot, options = {}) {
    if (!snapshot || snapshot.state === "nothing") return "Nothing has arrived yet.";
    if (snapshot.state === "running") {
      const drop = snapshot.drop_frame ? (options.compact ? " · drop-frame" : " · drop-frame numbering") : "";
      // The clock drops the source on purpose: it is 420 x 200 and the source is the one fact the window it lives in
      // does not need — both surfaces have carried their own wording for this, and both wordings are contracts.
      if (options.compact) return `Running · ${snapshot.rate || "?"} fps${drop}`;
      return `Running · ${snapshot.source || "MTC"} · ${snapshot.rate || "?"} fps${drop}`;
    }
    const seconds = ((Number(snapshot.age_ms) || 0) / 1000).toFixed(1);
    const windowSeconds = ((Number(snapshot.freewheel_ms) || 0) / 1000).toFixed(2);
    if (options.compact) {
      return `Stopped: no position for ${seconds} s — past the ${windowSeconds} s window.`;
    }
    return `Stopped: no position for ${seconds} s, past the ${windowSeconds} s freewheel window. ` +
      "The last position is shown above, and a signal that returns re-arms the list instead of firing the cues it passed.";
  }

  /// Two cues are in the same frame when these four numbers are the same. It is the same comparison the
  /// backend makes (one rate for the whole list), and it is what decides the one thing list order is
  /// allowed to decide: the order two tied cues fire in.
  function positionKey(at) {
    return [Number(at?.hours) || 0, Number(at?.minutes) || 0, Number(at?.seconds) || 0, Number(at?.frames) || 0].join(":");
  }

  /// Read the notation the readout shows — `HH:MM:SS:FF` or `HH:MM:SS;FF` — into four numbers. Not a second
  /// timecode parser: it accepts exactly what the backend just wrote into the snapshot, and it is used for
  /// nothing but "copy the position that is on screen".
  function parsePositionText(text) {
    const parts = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[:;](\d{1,2})$/.exec(String(text || "").trim());
    if (!parts) return null;
    return { hours: Number(parts[1]), minutes: Number(parts[2]), seconds: Number(parts[3]), frames: Number(parts[4]) };
  }

  function framesInADay(fps, dropFrame) {
    const numbers = fps * 60 * 60 * 24;
    if (!dropFrame) return numbers;
    const minutes = 24 * 60;
    return numbers - 2 * (minutes - minutes / 10);
  }

  function toFrames(at, fps) {
    let total = Number(at.hours) * fps * 3600 + Number(at.minutes) * fps * 60 + Number(at.seconds) * fps + Number(at.frames);
    if (at.drop_frame) {
      const totalMinutes = Number(at.hours) * 60 + Number(at.minutes);
      total -= 2 * (totalMinutes - Math.floor(totalMinutes / 10));
    }
    return total;
  }

  /// The four numbers a frame count decomposes into. It returns **only** those four: the rate and the
  /// drop-frame flag belong to the position being moved, not to an arithmetic helper, and the caller
  /// spreads them back in.
  function fromFrames(total, fps, dropFrame) {
    const perSecond = fps;
    const perMinute = perSecond * 60;
    const perHour = perMinute * 60;
    const day = framesInADay(fps, dropFrame);
    total = ((total % day) + day) % day;
    let number = total;
    if (dropFrame) {
      const perTenMinutes = perMinute * 10 - 18;
      const perDroppingMinute = perMinute - 2;
      const blocks = Math.floor(total / perTenMinutes);
      const rest = total % perTenMinutes;
      number = rest < 2 ? total + 18 * blocks : total + 18 * blocks + 2 * Math.floor((rest - 2) / perDroppingMinute);
    }
    return {
      hours: Math.floor(number / perHour),
      minutes: Math.floor((number % perHour) / perMinute),
      seconds: Math.floor((number % perMinute) / perSecond),
      frames: number % perSecond,
    };
  }

  function nudgeAt(at, delta) {
    const fps = framesPerSecond(at);
    return { ...at, ...fromFrames(toFrames(at, fps) + Number(delta || 0), fps, Boolean(at.drop_frame)) };
  }

  /// The same position, one frame later, until no other cue is there. Offered per row and never done on its
  /// own: two cues in the same frame are both kept — that tie is the one thing the list's order decides,
  /// and it is documented and tested — so moving one is the operator's decision, not this file's.
  function nextFreeFrame(cue, cues) {
    const taken = new Set((Array.isArray(cues) ? cues : []).filter((other) => other !== cue).map((other) => positionKey(other.at)));
    let candidate = cue.at;
    for (let step = 0; step < 400; step += 1) {
      candidate = nudgeAt(candidate, 1);
      if (!taken.has(positionKey(candidate))) return candidate;
    }
    return candidate;
  }

  // ---- The list's own order -------------------------------------------------------------------------

  function rememberCreationOrder(cues) {
    let order = [];
    try {
      const parsed = JSON.parse(readStored(CREATED_ORDER_KEY) || "[]");
      if (Array.isArray(parsed)) order = parsed.map(String);
    } catch (_) { order = []; }
    const present = (Array.isArray(cues) ? cues : []).map((cue) => String(cue?.id ?? ""));
    const known = order.filter((id) => present.includes(id));
    for (const id of present) if (!known.includes(id)) known.push(id);
    if (known.join("\u0000") !== order.join("\u0000")) writeStored(CREATED_ORDER_KEY, JSON.stringify(known));
    return known;
  }

  /// The rows in the order this window shows them. Ties keep the list's own order in every mode but Manual,
  /// which is the order the engine fires them in — so what is on screen and what fires cannot disagree.
  ///
  /// `allCues` is the whole draft when `cues` is a filtered view: the creation order is a property of the
  /// list, and remembering it from a filtered subset would forget every cue the filter is hiding.
  function orderedCues(cues, mode, allCues) {
    const entries = (Array.isArray(cues) ? cues : []).map((cue, index) => ({ cue, index }));
    if (mode === "manual") return entries;
    if (mode === "created") {
      const order = rememberCreationOrder(allCues || cues);
      return entries.sort((a, b) => {
        const left = order.indexOf(String(a.cue?.id ?? ""));
        const right = order.indexOf(String(b.cue?.id ?? ""));
        return ((left < 0 ? a.index : left) - (right < 0 ? b.index : right)) || (a.index - b.index);
      });
    }
    return entries.sort((a, b) => {
      const left = a.cue?.at || {};
      const right = b.cue?.at || {};
      for (const field of ["hours", "minutes", "seconds", "frames"]) {
        const difference = (Number(left[field]) || 0) - (Number(right[field]) || 0);
        if (difference) return difference;
      }
      return a.index - b.index;
    });
  }

  /// Which positions hold more than one cue, by position key. Two cues in one frame are both kept and they
  /// fire in the list's own order; the clash is *shown* and moving one is an explicit action, never
  /// automatic.
  function clashMap(cues) {
    const counts = new Map();
    for (const cue of Array.isArray(cues) ? cues : []) {
      const key = positionKey(cue?.at);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return new Map([...counts].filter(([, count]) => count > 1));
  }

  /// A cue's **number** when the cue list carries one, as text; `""` when it does not.
  ///
  /// The number is the operator's name for a cue — the thing they say out loud ("go to 12") — and it is
  /// deliberately **not** an address: what a system that triggers cues from outside uses is the `id`, which
  /// renumbering never touches. It is stored inside the cue, so reordering the list or renaming it never moves
  /// a number, and this file never derives one from a row's place or from a position: a number the file does
  /// not carry would change on the next reorder and break exactly the promise it makes. With no number there
  /// is nothing to show and the row shows no badge.
  function cueNumber(cue) {
    const value = cue?.number;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
    return "";
  }

  /// The next number a renumber would give the `index`-th cue in the list's own order: 1, 2, 3 … as text.
  ///
  /// This is the **explicit** action and never a side effect: a cue that has no number keeps none, and nothing
  /// here runs on a save. Renumbering rewrites numbers only — the ids and the order are what an external
  /// firing addresses, and they are not this file's to touch.
  function renumberValue(index) {
    return String(Number(index) + 1);
  }

  /// The numbers in use, by the canonical form a duplicate would collide with: `007` and `7` are one number.
  function numbersInUse(cues) {
    const used = new Map();
    for (const cue of Array.isArray(cues) ? cues : []) {
      const number = cueNumber(cue);
      if (!number) continue;
      const canonical = /^\d+(\.\d+)?$/.test(number) ? String(Number(number)) : number;
      used.set(canonical, cue);
    }
    return used;
  }

  /// Whether this list carries the operator's own name for a cue (`label`). A file written before the field
  /// existed has no key at all, and then the row shows the note instead and Settings offers no name field.
  function cueHasLabel(cue) {
    return typeof cue?.label === "string";
  }

  /// The name a row shows: the operator's `label` when there is one, otherwise the `note` the macro editor
  /// wrote when the cue was made, otherwise nothing and the row says so.
  function cueName(cue) {
    const label = String(cue?.label ?? "").trim();
    if (label) return { text: label, from: "label" };
    const note = String(cue?.note ?? "").trim();
    if (note) return { text: note, from: "note" };
    return { text: "(no name)", from: "" };
  }

  /// Why a cue cannot fire what it names, in the operator's words. The snapshot carries the reference — the macro's
  /// key, or the older position for a cue written before macros had keys — and, when a window has reported its
  /// library, how long that library is. The sentence names the macro the way the operator named it: the cue's own
  /// `note` holds the macro's name as it was when the cue was created, which is what a person recognises, with the key
  /// as the fallback for a cue that was never named. `macro_library_len: null` means no window has reported one, and
  /// then nothing is judged by position: the backend does not guess, and neither does this.
  function brokenReason(health, libraryLen, cue = null) {
    if (health?.problem === "no_macro") return "This cue fires nothing: no macro has been chosen for it.";
    // A label that cannot exist at the frame rate the show is running: the cue is left exactly where it was written,
    // because moving it to the nearest frame the rate does have would fire it somewhere nobody asked for.
    if (health?.problem === "frame_not_at_rate") {
      return `This cue's time — ${positionText(cue?.at)} — does not exist at the frame rate the show is running, so it will not fire. It is left exactly where it was written: change it to a time that rate has.`;
    }
    if (health?.problem === "macro_missing") {
      const library = typeof libraryLen === "number" ? ` (the library has ${libraryLen})` : "";
      const named = String(cue?.note ?? "").trim();
      // A reference by key is the only one that can honestly say the macro is *gone*: the key names one macro and it
      // is not there any more. An older positional reference can only say its place is outside the list.
      if (health.macro_id) {
        return named
          ? `This cue fires "${named}", and that macro is not in the library${library}.`
          : `This cue names macro ${health.macro_id}, which is not in the library${library}.`;
      }
      return `This cue names macro ${health.macro_index}, which is not in the library${library}.`;
    }
    return "This cue cannot fire what it names.";
  }

  /// The chain an operator walks when a cue does not fire, in the order he would check it.
  ///
  /// One home for the rule, because it is read from the row today and from the cue window's inspector tomorrow — and two
  /// hand-written copies of "why did nothing happen" is how a row and an inspector come to disagree. Each link is
  /// `{ link, label, ok, detail }`, and `ok` is deliberately **three-valued**: `true`, `false`, or `null` for "this
  /// window cannot judge it". A link nobody can judge must never read as broken — that is the difference between "the
  /// cue will not fire" and "I do not know whether it will", and an operator acts on them differently.
  ///
  /// The links this module judges by itself come from the cue and its health; the three only the caller knows — whether
  /// the clock is running, whether firing is allowed right now, and whether the macro has anything to send — arrive in
  /// `context`. The `detail` of the two health-driven links is the same sentence the row already showed, so a tooltip
  /// and a row cannot word one fact two ways.
  ///
  /// Two rules keep the three values honest, and both are applied in one place inside: a fact the caller did not report
  /// — and a cue the health does not describe, which is every cue before the first snapshot — is **unknown**, never
  /// "fine"; and a `detail` sentence is attached only to a link that is **known to be broken**, because a reason
  /// attached to a state nobody judged explains something that was never established.
  function blockerChain(cue, context = {}) {
    const health = context.health || null;
    const libraryLen = typeof context.libraryLen === "number" ? context.libraryLen : null;
    const chain = [];
    /// One home for the three-valued rule **and** for when a `detail` may be attached at all.
    ///
    /// `broken` is the sentence for a link that is **known** to be broken and `unknown` the one for a link nobody could
    /// judge; neither is ever attached to a link that is fine. That second half is not decoration: "no position is
    /// arriving, so nothing can be crossed" on a clock nobody had reported explained a fact that had never been
    /// established, which reads exactly like a diagnosis.
    const push = (link, label, ok, broken = "", unknown = "") =>
      chain.push({ link, label, ok, detail: ok === false ? broken : (ok === null ? unknown : "") });
    /// A reported fact, as a value or as "nobody said": `undefined` and `null` both mean the caller did not report it,
    /// and anything else is compared as the boolean it is.
    const judged = (value) => (value === undefined || value === null ? null : value === true);

    push(
      "timecode",
      "timecode running",
      judged(context.clockRunning),
      "no position is arriving, so nothing can be crossed",
      "this window is not being told whether the clock is running",
    );

    // The cue's **health** describes every cue once a snapshot has arrived and describes none of them before that, so a
    // missing entry is unknown rather than fine — the mistake that made a row report "the time exists at this rate" and
    // "macro chosen and present" before any snapshot had described the cue. One helper, so the two health-driven links
    // cannot drift apart.
    /// **The problems this build knows how to explain, in one list.** A problem outside it is one this window cannot
    /// word - a newer backend, or a rename that reached Rust and not here - and the honest third answer is **unknown**,
    /// not "fine". Before this list existed the two predicates below simply returned false for anything they did not
    /// recognise, so a cue carrying an unrecognised problem was drawn with its **broken** tag while the chain built to
    /// explain it reported every health link healthy: the surface contradicting the mark that sent the operator to it.
    /// The kit's own rule is the one being kept - *anything a machine decided can say yes, no or unknown, and the three
    /// are told apart*.
    const KNOWN_PROBLEMS = ["no_macro", "macro_missing", "frame_not_at_rate"];
    const fromHealth = (link, label, isBroken) => {
      const unrecognised = health !== null && health.problem != null && !KNOWN_PROBLEMS.includes(health.problem);
      const broken = health === null || unrecognised ? null : isBroken(health);
      push(
        link,
        label,
        broken === null ? null : !broken,
        health === null ? "" : brokenReason(health, libraryLen, cue),
        "no snapshot has described this cue yet",
      );
    };
    fromHealth("time", "time exists at this rate", (h) => h.problem === "frame_not_at_rate");
    const enabled = cue?.enabled !== false;
    push("enabled", "cue enabled", enabled, enabled ? "" : "the cue is parked: it is disabled");
    fromHealth("macro", "macro chosen and present", (h) => h.problem === "no_macro" || h.problem === "macro_missing");

    push(
      "permission",
      "firing allowed",
      judged(context.firingAllowed),
      "Live Safe Mode is on and the stream is running",
      // The LTC window is not the window that fires and cannot judge this: the padlock is enforced where the macros
      // run, and the backend's copy of it can never be armed in a shipped build. Saying so is the honest answer, and
      // the alternative — a hardcoded `true` — was a control reporting that all was well in a state where a cue would
      // have been refused.
      "Live Safe Mode is enforced by the main window, which is the one that fires",
    );
    push(
      "destination",
      "destination ready",
      judged(context.macroReady),
      "the macro has no enabled step to send",
      "this window is not being told whether the macro has anything to send",
    );
    return chain;
  }

  /// The first link that is **known** to be broken, or `null` when nothing is known to be wrong.
  function blockerFailure(chain) {
    return (Array.isArray(chain) ? chain : []).find((entry) => entry.ok === false) || null;
  }

  /// The chain as a tooltip reads it: a reason first when one is given, then every link with its state.
  ///
  /// `reason` is the sentence for the mark the row is carrying, and it leads because the tag is **about** that fact. The
  /// chain can hold more than one failure — a parked cue that also names a macro the library lost is two — and a tooltip
  /// that showed only the first would hide the other. With no `reason` the first known failure leads, which is what the
  /// cue window's inspector wants.
  function blockerChainText(chain, reason = "") {
    const entries = Array.isArray(chain) ? chain : [];
    const marks = entries.map((entry) => `${entry.ok === true ? "ok" : entry.ok === false ? "NO" : "?"} ${entry.label}`);
    const head = String(reason || blockerFailure(entries)?.detail || "").trim();
    return `${head ? `${head}\n\n` : ""}The chain when this cue is crossed: ${marks.join(" · ")}`;
  }

  /// The repeat policy in force for a cue: one of `pass`, `every` or `show`.
  ///
  /// It must answer exactly what the engine's `TimecodeCue::repeat_policy` answers, because this decides whether a row
  /// still expects the cue to fire: `every` is never spent, `show` is spent once and stays spent, `pass` is spent until
  /// a backward move arms it again. Two languages have to word this twice — there is no way round that — so the third
  /// answer is the **same three words** on both sides, and the legacy boolean is read here only for data that never
  /// went through the backend (a fixture, or a file the operator edited by hand).
  function cueRepeat(cue) {
    const policy = String(cue?.repeat ?? "").trim();
    if (policy === "pass" || policy === "every" || policy === "show") return policy;
    return cue?.repeats === true ? "every" : "pass";
  }

  /// The next unused id for a duplicated cue. The backend's own ids are `cue-<n>`; a duplicate takes the
  /// next free n so that two cues can never share an id (the engine's spent marks are keyed by id, and
  /// `validate()` refuses a list with duplicates).
  function nextCueId(cues) {
    const taken = new Set((Array.isArray(cues) ? cues : []).map((cue) => String(cue?.id ?? "")));
    let next = 1;
    for (const id of taken) {
      const match = /^cue-(\d+)$/.exec(id);
      if (match) next = Math.max(next, Number(match[1]) + 1);
    }
    while (taken.has(`cue-${next}`)) next += 1;
    return `cue-${next}`;
  }

  /// The cue list as the **file** carries it, and the questions a window asks about it.
  ///
  /// These are rules, not glue. The offset lives with the list; the order travels **with the file**, because a window
  /// that only remembered it would open the same list in a different order tomorrow; and `sort` is in **every** payload
  /// that writes, because the backend's field has a default — a payload that forgot it would not fail, it would quietly
  /// replace the operator's order with `smpte`. Both windows write this file, so both must write it the same way, and
  /// that is why it is here rather than written twice.
  function cueListPayload(cues, offsetFrames, sort, drive) {
    return {
      schema_version: 1,
      cues: JSON.parse(JSON.stringify(Array.isArray(cues) ? cues : [])),
      offset_frames: Math.trunc(Number(offsetFrames) || 0),
      sort: SORT_MODES.includes(sort) ? sort : SORT_MODES[0],
      // The drive mode is in every payload for exactly the reason `sort` is: the backend's field has a default, so a
      // save that forgot it would not fail — it would quietly put a sequential show back on the clock. That is why a
      // window that does not **own** this control still has to carry it, and why the payload is built here.
      drive: DRIVE_MODES.includes(drive) ? drive : DRIVE_MODES[0],
    };
  }

  /// What the backend answered, as the state both sides of the save line keep. It returns the working copy and the
  /// saved copy **separately**: a window that kept one array on both sides would report "nothing unsaved" the moment
  /// the operator typed, because the two would be the same object.
  ///
  /// `fallback` is for a backend answer that carries no offset or no order: the caller's current values stand, which is
  /// what an older build's answer means.
  function mergeCueList(dto, fallback = {}) {
    const working = JSON.parse(JSON.stringify(Array.isArray(dto?.cues) ? dto.cues : []));
    const offset = Number(dto?.offset_frames);
    const fallbackOffset = Number(fallback.offsetFrames);
    return {
      cues: working,
      savedCues: JSON.parse(JSON.stringify(working)),
      offsetFrames: Number.isFinite(offset) ? Math.trunc(offset) : (Number.isFinite(fallbackOffset) ? Math.trunc(fallbackOffset) : 0),
      sort: SORT_MODES.includes(dto?.sort)
        ? dto.sort
        : (SORT_MODES.includes(fallback.sort) ? fallback.sort : SORT_MODES[0]),
      drive: DRIVE_MODES.includes(dto?.drive)
        ? dto.drive
        : (DRIVE_MODES.includes(fallback.drive) ? fallback.drive : DRIVE_MODES[0]),
    };
  }

  /// Is anything on screen not in the file? The three things that can differ, in one place.
  ///
  /// A `savedSort` of `null` means "the file has not named an order yet", and then the order is not part of the
  /// question: a window that opened before the list did must not report unsaved changes for an order nobody chose.
  function cueListDirty({ cues, savedCues, offsetFrames, savedOffsetFrames, sort, savedSort, drive, savedDrive } = {}) {
    return JSON.stringify(cues) !== JSON.stringify(savedCues)
      || Math.trunc(Number(offsetFrames) || 0) !== Math.trunc(Number(savedOffsetFrames) || 0)
      || (savedSort !== null && savedSort !== undefined && sort !== savedSort)
      || (savedDrive !== null && savedDrive !== undefined && drive !== savedDrive);
  }

  /// The macro a cue or an inter-application binding names: **the rule, in one place for every window.**
  ///
  /// By the macro's own **key** whenever the reference has one, and by position only for a reference written before
  /// macros had keys — which is what the one-time migration converts. `null` when the reference names nothing, or names
  /// a macro the library no longer holds: the caller says which of the two, rather than firing a neighbour.
  ///
  /// It takes the macro array rather than reaching for one, because the two windows keep their library differently and
  /// a rule that reads a global is a rule that cannot be shared. The four helpers below are the whole vocabulary: find,
  /// locate, and the two directions of the token a picker shows and stores.
  function macroForReference(macros, reference) {
    const list = Array.isArray(macros) ? macros : [];
    const key = typeof reference?.macro_id === "string" ? reference.macro_id.trim() : "";
    if (key) return list.find((macro) => String(macro?.id ?? "").trim() === key) || null;
    const index = typeof reference?.macro_index === "number" ? reference.macro_index : null;
    return index === null ? null : list[index] || null;
  }

  /// Where that macro sits in the list, or `-1`. A firing path takes a position, so it asks this rather than searching.
  function macroIndexForReference(macros, reference) {
    const list = Array.isArray(macros) ? macros : [];
    const macro = macroForReference(list, reference);
    return macro ? list.indexOf(macro) : -1;
  }

  /// What a row's picker shows and stores for the macro at `index`: the macro's own **key** when it has one, and its
  /// position only while it has none.
  ///
  /// A macro created in a window has no key until the library is saved — the backend mints keys when it normalises a
  /// library, and nothing else does — so that is the one moment a positional reference is still written, and the
  /// migration converts it as soon as a key exists.
  function macroTokenAt(macros, index) {
    const macro = (Array.isArray(macros) ? macros : [])[index];
    if (!macro) return "";
    return String(macro.id ?? "").trim() || String(index);
  }

  /// Turn a picker's token back into the reference to store. A token nobody can resolve writes **nothing**, rather
  /// than a position that would point at whichever macro happens to sit there.
  function macroReferenceForToken(macros, token) {
    const list = Array.isArray(macros) ? macros : [];
    if (token === "" || token === null || token === undefined) return { macro_id: null, macro_index: null };
    const text = String(token);
    const byKey = list.find((macro) => String(macro?.id ?? "").trim() === text);
    if (byKey) return { macro_id: String(byKey.id).trim(), macro_index: null };
    const index = Number(text);
    return Number.isInteger(index) && index >= 0 && index < list.length
      ? { macro_id: null, macro_index: index }
      : { macro_id: null, macro_index: null };
  }

  /// The token a stored reference corresponds to, for the picker's own value.
  function macroTokenForReference(macros, reference) {
    const list = Array.isArray(macros) ? macros : [];
    const macro = macroForReference(list, reference);
    if (!macro) return "";
    return String(macro.id ?? "").trim() || String(list.indexOf(macro));
  }

  /// The duration of a cue as an operator writes it — seconds, with no trailing zeros — and back.
  ///
  /// One home for the two directions, because the row shows what the field accepts: a duration shown as `2.000 s` and
  /// typed back as `2` would look like two different durations to whoever is reading the list, and one of them is a
  /// string nobody meant.
  function durationText(cue) {
    const ms = Number(cue?.duration_ms);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    return String(Number((ms / 1000).toFixed(3)));
  }

  /// The milliseconds a typed duration means, `null` when it is not one, and `null` for an **empty** field too — the
  /// two are deliberately not distinguished here because the caller stores `null` for both: an empty field clears the
  /// duration, and a duration that cannot be read is refused before it gets that far.
  function parseDurationText(text) {
    const trimmed = String(text ?? "").trim();
    if (trimmed === "") return null;
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.round(seconds * 1000);
  }

  /// A **content hash** of a macro: what a cue records when it names one, so a row can later say "this macro has changed
  /// since you named it".
  ///
  /// A change detector, not a security check: FNV-1a over a canonical rendering of the macro's content. Two properties
  /// make it usable, and both are about what it must be **blind** to:
  ///
  /// * field **order**, because the same macro is built by different paths — a load, a save, an import — and a hash that
  ///   moved with the order would report every cue as changed after an unrelated edit;
  /// * `armed` and the stored `id`, because both are bookkeeping the application rewrites on its own (the backend forces
  ///   `armed` false on both sides of a save), so hashing them would flag every cue in the show on every save.
  ///
  /// Nothing acts on a difference. It is a note the health shows and never a refusal to fire: a cue that names a macro
  /// that has changed fires the macro it names, because that is what the operator asked for.
  function macroHash(macro) {
    const canonical = (value) => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) {
          if (key === "armed" || key === "id") continue;
          out[key] = canonical(value[key]);
        }
        return out;
      }
      return value;
    };
    const text = JSON.stringify(canonical(macro) ?? null);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  /// The cues of a list that name the **same macro** as this one: what "used by N cues" counts.
  ///
  /// By the macro's own key whenever the cue has one, and by position otherwise — the same two-level rule the rest of the
  /// reference model uses, so this cannot disagree with what firing resolves. A cue that names **nothing** shares
  /// nothing: it is not a user of any macro, which is what keeps an empty picker from reading as a shared one.
  function cuesSharingMacro(cues, cue) {
    const list = Array.isArray(cues) ? cues : [];
    const key = String(cue?.macro_id ?? "").trim();
    const index = typeof cue?.macro_index === "number" ? cue.macro_index : null;
    if (!key && index === null) return [];
    return list.filter((other) => {
      const otherKey = String(other?.macro_id ?? "").trim();
      if (key) return otherKey === key;
      return !otherKey && other?.macro_index === index;
    });
  }

  /// The group names the row's group box offers: computed from the list, never a registry.
  ///
  /// A group exists exactly when a cue carries it, so a name no cue carries any more disappears on its own with the
  /// next render — there is nothing to clean up and nothing to create.
  function cueGroupNames(cues) {
    const names = [];
    for (const cue of Array.isArray(cues) ? cues : []) {
      const name = String(cue?.group ?? "").trim();
      if (name && !names.includes(name)) names.push(name);
    }
    return names.sort((left, right) => left.localeCompare(right));
  }

  /// Does a row match the search box? The words an operator types to find a cue during a show: part of its
  /// name, its number, the **group** it is in, part of its position, or one of the states a row can be in —
  /// "off" for a parked cue, "locked" for one this Mac is protecting, "clash" for a frame that holds two.
  ///
  /// The group is compared exactly as the cue list stores it (the backend trims it on the way in), and it is
  /// only ever a word to search on: it decides nothing about what fires, and it is never turned into an
  /// address by anything here.
  ///
  /// The live marks (`fired`, `skipped`, `spent`) are deliberately **not** searchable: a filtered row that
  /// vanished the moment it fired would be a list that moved under the operator's hand mid-show. The
  /// snapshot's own state is read where it belongs — in the tags and the delivery line.
  function filterMatches(cue, query, clashes, isLocked) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    const words = [];
    const name = cueName(cue).text;
    if (name && name !== "(no name)") words.push(name.toLowerCase());
    const number = cueNumber(cue);
    if (number) words.push(number.toLowerCase());
    const group = String(cue?.group ?? "").trim();
    if (group) words.push(group.toLowerCase());
    words.push(positionText(cue?.at).toLowerCase());
    if (cue?.enabled === false) words.push("off");
    if (typeof isLocked === "function" && isLocked(cue?.id)) words.push("locked");
    if (clashes && clashes.has(positionKey(cue?.at))) words.push("clash");
    return words.some((word) => word.includes(q));
  }

  // ---- The lock: which rows this Mac is protecting --------------------------------------------------

  function readLockedIds() {
    try {
      const parsed = JSON.parse(readStored(LOCKED_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch (_) {
      return new Set();
    }
  }
  function writeLockedIds(ids) {
    writeStored(LOCKED_KEY, JSON.stringify([...ids].map(String).sort()));
  }

  // ---- The countdown states WATCHOUT publishes ------------------------------------------------------
  //
  // `Pre`, `Last10`, `Last5`, `Reached`: what an operator needs before a cue is not only the distance but
  // the fact that it has come close. The arithmetic is the snapshot's own `next_cue_seconds`, so this is a
  // reading of the engine's answer, not a second clock.
  function countdownState(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return null;
    if (value <= 0) return "now";
    if (value <= 5) return "last5";
    if (value <= 10) return "last10";
    return null;
  }
  function countdownLabel(state) {
    if (state === "now") return "now";
    if (state === "last5") return "5 s";
    if (state === "last10") return "10 s";
    return "";
  }

  // ---- What just happened ---------------------------------------------------------------------------
  //
  // The engine announces a cue the moment it crosses it, and until now the window showed only what was
  // about to happen. This keeps the last few announcements — the show's own position and the wall-clock
  // time the announcement arrived — so an operator can answer "did that fire, and when?" without the log.
  //
  // An announcement recovered from the engine's ledger when this window opened has **no** wall-clock time:
  // the ledger carries the receipt and the event, not when it happened. Such an entry says so rather than
  // borrowing the moment it was read, which would be a time that never happened.
  /// A duration the way this application says them everywhere else: one decimal and a unit, so a line that says
  /// "1.2 s" means the same thing wherever it is read.
  function secondsText(ms) {
    return `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)} s`;
  }

  /// **Why a skip happened, in one place, for every surface that shows it.** The row marks, the history line and the
  /// last-run view all word the same three facts, and a second copy of this sentence would be a second answer to the
  /// question the whole dropout-versus-seek work exists to answer. Called with an `AsRunLine` or a history entry —
  /// both carry `kind`, `across_silence`, `jumped_ms` and `arrival_gap_ms`, which is why one function can serve both.
  ///
  /// **Three readings, never two.** `across_silence` is `true`, `false` or `null`, and `null` means the verdict was
  /// never measured — which must not inherit either sentence: that is the project's own rule about `sent`, `confirmed`,
  /// `unconfirmed` and `unknown` keeping four words.
  function skipReason(entry) {
    // **Two vocabularies, and the extraction's first version got this wrong.** A history entry says `kind`;
    // an `AsRunLine` from the record says `spent`. The claim that both carry `kind` was false, and the panel's
    // contract caught it by rendering a measured jump with no reason at all - which is the failure mode a
    // one-home function is supposed to prevent, produced by the extraction rather than by a copy.
    const verb = entry.kind ?? entry.spent;
    if (!entry || verb !== "skipped") return "";
    const jumped = Number(entry.jumped_ms ?? entry.jumpedMs ?? 0);
    const gap = entry.arrival_gap_ms === undefined ? entry.arrivalGapMs : entry.arrival_gap_ms;
    const gapText = gap === null || gap === undefined ? "" : ` for ${secondsText(gap)}`;
    // **A MISSING VERDICT IS AN ABSENT KEY, NOT A NULL, and the first version of this got it wrong.** The record's
    // line carries `#[serde(skip_serializing_if = "Option::is_none")]`, so `None` never serialises as `null` - it
    // serialises as NOTHING, and JavaScript sees `undefined`. Testing only for `null` therefore let the one case this
    // view exists for fall through to "the position jumped": an assertion of a measurement nobody made. The
    // asymmetry is what hid it - `arrival_gap_ms` above already had an `=== undefined` fallback and this did not -
    // and a stub that wrote `null` explicitly kept the contract green while the real path was wrong.
    const verdict = entry.across_silence === undefined ? entry.acrossSilence : entry.across_silence;
    if (verdict !== true && verdict !== false) {
      return ` · the position moved${jumped > 0 ? ` ${secondsText(jumped)}` : ""}`;
    }
    return verdict
      ? ` · the timecode had stopped arriving${gapText}`
      : ` · the position jumped${jumped > 0 ? ` ${secondsText(jumped)}` : ""}`;
  }

  function createHistory(limit) {
    const entries = [];
    let fired = 0;
    let skipped = 0;
    const ceiling = Math.max(1, Number(limit) || 8);
    return {
      record(entry) {
        if (!entry || (entry.kind !== "fired" && entry.kind !== "skipped")) return;
        if (entry.kind === "fired") fired += 1; else skipped += 1;
        entries.unshift({
          kind: entry.kind,
          id: String(entry.id ?? ""),
          at: String(entry.at ?? ""),
          name: String(entry.name ?? "").slice(0, HISTORY_NAME_MAX),
          wall: entry.wall ? String(entry.wall) : "",
          // **Why a skip happened, which the engine decides and this line only reads.** A jump and a silence used to
          // produce the same sentence, and they are not the same event: one is the show being moved, the other is a
          // fault to go and look at. The verdict (`across_silence`) is the engine's; the numbers are what it measured.
          // **Three values, not two.** `across_silence` is a plain bool on the wire event, but the RECORD's line
          // carries `Option<bool>` — `None` for a fired cue and, the case that matters, `None` on a skipped line
          // whose verdict was never measured. Collapsing that to `false` renders an unmeasured skip as "the position
          // jumped", which is the exact confusion this whole feature exists to remove: it would ASSERT a measurement
          // nobody made, in the one view built to tell the two apart.
          acrossSilence: entry.across_silence === true ? true : entry.across_silence === false ? false : null,
          jumpedMs: Number(entry.jumped_ms ?? 0),
          arrivalGapMs: Number.isFinite(Number(entry.arrival_gap_ms)) ? Number(entry.arrival_gap_ms) : null,
        });
        if (entries.length > ceiling) entries.length = ceiling;
      },
      line() {
        const last = entries[0];
        if (!last) return "";
        const verb = last.kind === "fired" ? "Fired" : "Skipped";
        const name = last.name ? ` “${last.name}”` : "";
        const when = last.wall ? ` · ${last.wall}` : " · recovered when this window opened";
        // A skip says WHICH kind of skip it was, in the operator's own terms. A cue that vanished while the timecode
        // was gone is the one worth walking over to look at, so the two readings share no wording at all.
        const why = skipReason({ ...last, kind: last.kind });
        return `Last ${verb.toLowerCase()} ${last.at}${name}${why}${when}`;
      },
      counts() { return { fired, skipped }; },
      entries() { return entries.slice(); },
      clear() { entries.length = 0; fired = 0; skipped = 0; },
    };
  }

  /// The wall clock, in the form the history line shows: 24 hours, and seconds, because a cue fires once.
  function wallClock(now) {
    const date = now instanceof Date ? now : new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  // ---- The row itself -------------------------------------------------------------------------------

  function tagNode(text, extra) {
    const tag = document.createElement("span");
    tag.className = `cue-tag ${extra || ""}`.trim();
    tag.textContent = text;
    return tag;
  }

  function makeButton(text, className, title, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    if (className) button.className = className;
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  /// Build the panel around one window's list. The window keeps the state it owns — the draft, the saved
  /// copy, the backend calls — and this keeps the parts both windows must agree on: the rows, the order,
  /// the marks, the undo of a local change, the filter and the lock.
  ///
  /// config:
  ///   container()        -> the element the rows go into
  ///   cues()             -> the draft array (mutated in place; the window never reassigns it)
  ///   mode()             -> the layout in force
  ///   rowTag             -> "li" or "div" (the clock's list is an <ol>, Settings' is a <div>)
  ///   atTitle            -> the tooltip on a row's time
  ///   nameTitle(name)    -> the tooltip on a row's name
  ///   extras(cue, api)   -> a node to append after the row's line (Settings' macro picker and switches)
  ///   isDirty()          -> is the draft on screen not the list the engine has? The window's own answer, and the
  ///                         same one its "unsaved changes" line reads, so the Save button cannot disagree with it
  ///   local()            -> after a local change: the window clears its refusal and repaints its status
  ///   fail(message)      -> a local action that could not run: the window shows the sentence
  ///   rendered()         -> after a full render: the window repaints its status
  ///   currentPositionText() -> what "Now" copies into a cue's fields, or null
  ///   rateHint()         -> the list's rate, for the rewind boundary
  ///   armedId            -> the element that carries "Re-armed at …"
  ///   filterCountId      -> the element that carries "N of M"
  ///   locks              -> false to draw no lock control at all
  function createPanel(config) {
    const rowTag = config.rowTag || "div";
    let editingId = null;
    let filter = "";
    let nextId = null;
    let spent = new Set();
    // Which cues cannot fire what they name, from the engine's own `cue_health`; and how long this window's macro
    // library is, which is what turns "macro 7" into a sentence an operator can act on. `null` means no window has
    // reported a library, and then nothing is judged by index.
    let health = new Map();
    let libraryLen = null;
    // What the chain cannot know by itself. A window that supplies nothing gets every "only the caller knows" link as
    // **unknown**, which is the honest default: this module must not claim a cue is blocked for a reason it cannot see.
    const blockerContext = typeof config.blockerContext === "function" ? config.blockerContext : () => ({});
    const marks = new Map();
    let locked = readLockedIds();
    let undoStack = [];
    // The window's Save control, once `attach` has been given it. The unsaved state is read from `config.isDirty()` on
    // every paint rather than kept in a flag here: a second source of truth for "is it saved" is exactly how a Save
    // button ends up lying about what the engine has.
    let saveButton = null;
    // The hooks the buttons that appear and disappear with the undo stack run through. Declared before `local`
    // uses them; filled by `attach`, which is called once the window's elements exist.
    const undoHooks = [];
    function afterLocalChange() {
      for (const hook of undoHooks) hook();
      syncSave();
    }
    /// What the window's own unsaved question answers right now. A window that does not supply one gets "nothing
    /// unsaved": the calm state is the safe default, where a wrong "unsaved" would be a button that lies.
    function isDirty() {
      return typeof config.isDirty === "function" ? Boolean(config.isDirty()) : false;
    }
    /// Put the unsaved state on the Save control. `classList.toggle` with an explicit value writes nothing when the
    /// class is already right, so this is safe to call from a render that runs several times a second.
    function syncSave() {
      if (!saveButton) return;
      saveButton.classList.toggle(SAVE_UNSAVED_CLASS, isDirty());
    }

    function cues() {
      const list = config.cues();
      return Array.isArray(list) ? list : [];
    }
    function cueById(id) {
      return cues().find((cue) => String(cue?.id ?? "") === String(id)) || null;
    }
    function clashes() {
      return clashMap(cues());
    }
    function isLocked(id) {
      return locked.has(String(id ?? ""));
    }
    function local() {
      afterLocalChange();
      if (typeof config.local === "function") config.local();
    }
    function fail(message) {
      if (typeof config.fail === "function") config.fail(message);
    }

    // ---- undo of the last local change ----
    function pushUndo() {
      undoStack.push(JSON.stringify(cues()));
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
    function canUndo() {
      return undoStack.length > 0;
    }
    function resetUndo() {
      undoStack = [];
      // The button's visibility **is** a function of the stack, so clearing the stack repaints it here. A Save clears
      // the stack (the draft and the list are the same thing again), and an Undo left on screen after it is a control
      // that does nothing when pressed — which is the one thing this project does not put on screen.
      for (const hook of undoHooks) hook();
    }
    function undo() {
      if (undoStack.length === 0) return false;
      const previous = JSON.parse(undoStack.pop());
      const list = cues();
      list.splice(0, list.length, ...previous);
      editingId = null;
      local();
      render();
      return true;
    }

    // ---- the filter ----
    function setFilter(text) {
      filter = String(text ?? "");
    }
    function filterText() {
      return filter;
    }
    function visibleCues() {
      const q = filter.trim();
      if (!q) return cues();
      const clash = clashes();
      return cues().filter((cue) => filterMatches(cue, q, clash, isLocked));
    }
    function visibleCount() {
      return filter.trim() ? visibleCues().length : cues().length;
    }
    function totalCount() {
      return cues().length;
    }

    // ---- the marks ----
    function markSignature(cue, clash) {
      const id = String(cue?.id ?? "");
      const mark = marks.get(id);
      return [
        cue?.enabled === false,
        Boolean(clash),
        Boolean(nextId) && id === nextId,
        mark || (spent.has(id) ? "spent" : ""),
        isLocked(id),
        health.get(id)?.problem || "",
        libraryLen === null ? "" : String(libraryLen),
      ].join("|");
    }

    function paintTags(row, cue, clash) {
      const tags = row?.querySelector(".cue-tags");
      if (!tags || !cue) return;
      const id = String(cue.id ?? "");
      const mark = marks.get(id);
      const isSpent = spent.has(id);
      // What the tags will say, as one string: this runs on every poll, and rebuilding identical nodes four
      // times a second is the mutation storm the soak tests exist to catch. Only a change is repainted.
      const signature = markSignature(cue, clash);
      if (row.dataset.tagSignature === signature) return;
      row.dataset.tagSignature = signature;
      tags.textContent = "";
      if (cue.enabled === false) tags.appendChild(tagNode("off", "is-off"));
      if (isLocked(id)) tags.appendChild(tagNode("locked", "is-locked"));
      const broken = health.get(id);
      if (broken) {
        const tag = tagNode("broken", "is-broken");
        // The whole chain, in the order an operator would check it, led by the reason this mark is about. A cue carries
        // a mark for a **per-cue** fact (`health`); the chain is what explains it, including the links the window judged
        // and any second failure the one `problem` field cannot hold.
        tag.title = blockerChainText(
          blockerChain(cue, { ...blockerContext(cue), health: broken, libraryLen }),
          brokenReason(broken, libraryLen, cue),
        );
        tags.appendChild(tag);
      }
      if (clash) tags.appendChild(tagNode("clash", "is-clash"));
      if (nextId && id === nextId) tags.appendChild(tagNode("next", "is-next"));
      if (mark === "fired") tags.appendChild(tagNode("fired", "is-fired"));
      else if (mark === "skipped") tags.appendChild(tagNode("skipped", "is-skipped"));
      else if (isSpent) tags.appendChild(tagNode("spent", "is-spent"));
      row.classList.toggle("is-fired", mark === "fired");
      row.classList.toggle("is-skipped", mark === "skipped");
      row.classList.toggle("is-spent", mark !== "fired" && mark !== "skipped" && isSpent);
      row.classList.toggle("is-next", Boolean(nextId) && id === nextId);
      row.classList.toggle("is-off", cue.enabled === false);
      row.classList.toggle("is-locked", isLocked(id));
      row.classList.toggle("is-broken", Boolean(health.get(id)));
    }

    /// One row: its number when the list carries one, its time, its name, its state, and what can be done
    /// with it. Every fact comes from the list or from the engine's own announcements.
    function buildRow(cue, clash) {
      const id = String(cue?.id ?? "");
      const lockedNow = isLocked(id);
      // **A read-only panel draws no control that changes the list**, and the switch follows the precedent already in
      // this function: `config.locks !== false` suppresses one button for a whole host, and this suppresses the rest.
      // It exists because the settings page stops being a second editor and becomes a summary (the editor is the LTC
      // window), and the alternative — a second rendering of a row — would drift the way the row's CSS already did.
      // The failure mode being designed against is a "summary" that can still edit the show.
      const readOnly = config.readOnly === true;
      const row = document.createElement(rowTag);
      row.className = "cue-row";
      row.dataset.cueId = id;
      // The nudge shortcuts need a focusable row; tabindex is what makes ← / → land on it.
      row.tabIndex = 0;
      if (lockedNow) row.classList.add("is-locked");

      const line = document.createElement("div");
      line.className = "cue-line";

      const number = cueNumber(cue);
      // **The SLOT exists on every row; the BADGE only when the cue carries a number.** The time beside it is a flex
      // item, so with no element at all the time became the first cell and moved left - section 26 caught one column
      // reading three different x. But an always-present `.cue-number` is wrong too: a settings summary counts those
      // to show that a number the list carries is shown and only those, and an empty one made it read
      // ["12","","5.5",""] instead of ["12","5.5"]. A TRACK AND A VALUE ARE NOT THE SAME THING, so the spacer is not
      // the badge - which is the same distinction the dense grid needed between an empty track and a moved column.
      const slot = document.createElement("span");
      slot.className = number ? "cue-number" : "cue-number-slot";
      slot.textContent = number || "";
        if (number) slot.title = "This cue's number: the name the operator says out loud — “go to 12”. It is part of the cue, not its place in the list, so reordering the list or renaming a cue never moves it. What a system that triggers cues from outside addresses is the cue's id, which renumbering never touches.";
      line.appendChild(slot);

      const at = document.createElement("span");
      at.className = "cue-at";
      at.textContent = positionText(cue.at);
      at.title = config.atTitle || "The position this cue fires at.";

      const name = document.createElement("span");
      name.className = "cue-name";
      const resolved = cueName(cue);
      name.textContent = resolved.text;
      if (!resolved.from) name.classList.add("is-blank");
      name.title = typeof config.nameTitle === "function" ? config.nameTitle(resolved, cue) : "";

      const tags = document.createElement("span");
      tags.className = "cue-tags";

      const buttons = document.createElement("span");
      buttons.className = "cue-buttons";

      // A locked row keeps its facts and its lock and loses every control that would change it: the lock is
      // the operator's own "do not touch this one", and a control that a lock silently ignores is worse than
      // no control. The lock itself stays, because it is the way back.
      if (!readOnly && !lockedNow) {
        buttons.appendChild(makeButton("✎", "cue-edit",
          "Edit this cue's time: hours, minutes, seconds and frames, with a nudge of ±1 or ±10 frames. Editing is local — nothing is written until you press Save (re-arms).",
          () => {
            editingId = editingId === id ? null : id;
            render();
          }));

        buttons.appendChild(makeButton("✕", "cue-remove",
          "Removes this cue from the list. The macro itself is untouched, and nothing is written until you press Save (re-arms).",
          () => {
            pushUndo();
            const list = cues();
            list.splice(list.indexOf(cue), 1);
            if (editingId === id) editingId = null;
            local();
            render();
          }));

        if (clash) {
          buttons.appendChild(makeButton("→ free", "cue-free",
            "Moves this cue to the next frame no other cue uses. Two cues in one frame are both kept — the order they fire in is the list's own order — so this is never done for you.",
            () => {
              pushUndo();
              cue.at = nextFreeFrame(cue, cues());
              local();
              render();
            }));
        }

        // Reordering by hand is only offered where it means something: with the list in SMPTE or creation
        // order the arrows would fight the order being shown, and a control that cannot do its job does not
        // belong on screen.
        if (config.mode() === "manual") {
          buttons.appendChild(makeButton("▲", "cue-up",
            "Moves this cue one place earlier in the list's own order. The order the list is stored in is the order two cues in the same frame fire in.",
            () => {
              const index = cues().indexOf(cue);
              if (index > 0) {
                pushUndo();
                const list = cues();
                list.splice(index, 1);
                list.splice(index - 1, 0, cue);
                local();
                render();
              }
            }));

          buttons.appendChild(makeButton("▼", "cue-down",
            "Moves this cue one place later in the list's own order. The order the list is stored in is the order two cues in the same frame fire in.",
            () => {
              const list = cues();
              const index = list.indexOf(cue);
              if (index >= 0 && index < list.length - 1) {
                pushUndo();
                list.splice(index, 1);
                list.splice(index + 1, 0, cue);
                local();
                render();
              }
            }));
        }

        buttons.appendChild(makeButton("⧉", "cue-duplicate",
          "Copies this cue — its position, its macro and its switches — as a new cue with an id of its own, right after it. Two cues in one frame are both kept and fire in the list's own order, so the copy is marked as a clash and can be moved with “→ free”. Local: nothing is written until Save (re-arms).",
          () => duplicateCue(cue)));
      }

      if (!readOnly && config.locks !== false) {
        const lock = makeButton(lockedNow ? "Locked" : "Lock", "cue-lock",
          lockedNow
            ? "This cue is locked on this Mac: its row cannot be edited, moved or removed by accident while the show runs. Press to unlock it. The lock is a guard on this window, not part of the cue list, so it is not written into the show and saving is not needed to set it."
            : "Locks this cue on this Mac: its row cannot be edited, moved or removed by accident while the show runs. The lock is a guard on this window, not part of the cue list, so it is not written into the show and saving is not needed to set it.",
          () => toggleLock(id));
        lock.classList.toggle("is-on", lockedNow);
        buttons.appendChild(lock);
      }

      line.appendChild(at);
      line.appendChild(name);
      line.appendChild(tags);
      line.appendChild(buttons);
      row.appendChild(line);

      // The window's own line: the macro a cue fires and its switches on Settings, nothing on the clock.
      //
      // The window is handed the panel's API **object**, not the function that builds it: Settings' own line asks it
      // `isLocked(id)` to disable the controls of a protected row, and a function reference answers no such question —
      // it threw, the row was never drawn, and the list said "the cue list could not be read". The API is built once
      // per row here, which is also what keeps the two windows' extras on the same contract.
      // The host owns this line, but in a read-only panel it is an editing line by definition, so it is not drawn.
      if (!readOnly && typeof config.extras === "function") {
        const extras = config.extras(cue, api(), lockedNow ? { locked: true } : undefined);
        if (extras) row.appendChild(extras);
      }

      // The tags are painted once the row is whole: the painter finds them by class, and until the row is
      // assembled there is nothing for it to find.
      paintTags(row, cue, clash);

      if (!readOnly && editingId === id && !lockedNow) row.appendChild(buildEditor(cue));

      // ← / → nudge the focused row by one frame, Shift by ten: the keyboard equivalent of the buttons, and
      // the answer to "the press was a little late" without reaching for a mouse.
      if (!lockedNow) {
        row.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowLeft" ? -1 : 1);
          pushUndo();
          cue.at = nudgeAt(cue.at, step);
          local();
          event.preventDefault();
          render();
          const again = rowElement(id);
          if (again) again.focus();
        });
      }
      return row;
    }

    function rowElement(id) {
      const list = config.container();
      return list ? list.querySelector(`.cue-row[data-cue-id="${escapeForSelector(id)}"]`) : null;
    }

    /// The four fields, and the five nudge buttons. It edits the draft and calls no command: that is the
    /// whole difference between "the list on screen" and "the list the engine is firing".
    function buildEditor(cue) {
      const fps = framesPerSecond(cue.at);
      const editor = document.createElement("div");
      editor.className = "cue-editor";
      const fields = [
        { key: "hours", max: 23, label: "hours" },
        { key: "minutes", max: 59, label: "minutes" },
        { key: "seconds", max: 59, label: "seconds" },
        { key: "frames", max: fps - 1, label: `frames (0 to ${fps - 1} at ${fps} fps)` },
      ];
      fields.forEach((field, index) => {
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.max = String(field.max);
        input.value = String(Number(cue.at?.[field.key]) || 0).padStart(2, "0");
        input.title = `The ${field.label} of the position this cue fires at. Editing is local: nothing is saved until Save (re-arms).`;
        input.setAttribute("aria-label", `cue ${field.label}`);
        // One undo step per visit to a field, not one per keystroke: typing "12" into the seconds box is one
        // change, and undoing it in two halves would be a list the operator never had.
        let undoPushed = false;
        input.addEventListener("focus", () => { undoPushed = false; });
        input.addEventListener("input", () => {
          if (!undoPushed) { pushUndo(); undoPushed = true; }
          const value = Math.max(0, Math.min(field.max, Math.round(Number(input.value) || 0)));
          cue.at = { ...cue.at, [field.key]: value };
          local();
          // The position text beside the fields follows what is being typed: an operator editing a time
          // reads the whole time, not four boxes.
          const row = input.closest(".cue-row");
          const shown = row?.querySelector(".cue-at");
          if (shown) shown.textContent = positionText(cue.at);
        });
        if (index > 0) {
          const separator = document.createElement("span");
          separator.className = "cue-sep";
          separator.textContent = index === 3 && cue.at?.drop_frame ? ";" : ":";
          editor.appendChild(separator);
        }
        editor.appendChild(input);
      });
      for (const step of [-10, -1, 1, 10]) {
        editor.appendChild(makeButton(step > 0 ? `+${step}f` : `−${Math.abs(step)}f`, "cue-nudge",
          step > 0
            ? `Moves this cue ${step} frame(s) later. Local: nothing is saved until Save (re-arms).`
            : `Moves this cue ${Math.abs(step)} frame(s) earlier. Local: nothing is saved until Save (re-arms).`,
          () => {
            pushUndo();
            cue.at = nudgeAt(cue.at, step);
            local();
            render();
            const again = rowElement(cue.id);
            again?.querySelector(".cue-editor input")?.focus();
          }));
      }
      editor.appendChild(makeButton("Now", "cue-now",
        "Copies the position this clock is reading into this cue's fields. Local: nothing is saved until Save (re-arms).",
        () => {
          const text = typeof config.currentPositionText === "function" ? config.currentPositionText() : null;
          const current = parsePositionText(text);
          if (!current) {
            fail("No position has arrived yet, so there is nothing to copy.");
            return;
          }
          pushUndo();
          cue.at = { ...cue.at, hours: current.hours, minutes: current.minutes, seconds: current.seconds, frames: current.frames };
          local();
          render();
        }));
      return editor;
    }

    /// Copy a cue as a new cue right after it. The copy lands on the same frame, so the row says so and
    /// offers "→ free": moving a copy is the operator's decision, exactly like moving a clash.
    ///
    /// The copy is a **new** cue, so it inherits the facts that describe where it is and what it fires — the
    /// position, the macro, the switches — and **not** the number, which names one cue and which the backend
    /// refuses to see twice ("two cues share the number"), nor the label, which would be a row claiming a name
    /// the operator never gave it. It keeps its **group**: that says where the cue belongs, and a copy made in
    /// the middle of Act 2 belongs in Act 2 until somebody moves it.
    function duplicateCue(cue) {
      const list = cues();
      pushUndo();
      const copy = JSON.parse(JSON.stringify(cue));
      copy.id = nextCueId(list);
      copy.number = "";
      copy.label = "";
      list.splice(list.indexOf(cue) + 1, 0, copy);
      local();
      render();
      rowElement(copy.id)?.focus();
    }

    /// Renumber the whole list in its own order: 1, 2, 3 … This is the explicit action the design asks for and
    /// never a side effect of a save. It rewrites `number` only — every `id` and the order of `cues[]` are left
    /// exactly as they were, so a cue triggered from outside keeps working while the operator renumbers.
    function renumberCues() {
      const list = cues();
      if (list.length === 0) return false;
      pushUndo();
      list.forEach((cue, index) => { cue.number = renumberValue(index); });
      local();
      render();
      return true;
    }

    function toggleLock(id) {
      const key = String(id ?? "");
      if (!key) return;
      if (locked.has(key)) locked.delete(key); else locked.add(key);
      writeLockedIds(locked);
      // The row is rebuilt in place rather than the whole list: locking one cue must not close an editor that
      // is open on another, and the row is the only thing that changed.
      const old = rowElement(key);
      const cue = cueById(key);
      if (old && cue) {
        const replacement = buildRow(cue, clashes().has(positionKey(cue.at)));
        old.replaceWith(replacement);
      }
    }

    /// Paint the engine's announcements, without re-rendering the list: a re-render would close an editor
    /// that is open and take the focus with it.
    function mark(id, value) {
      const key = String(id ?? "");
      if (!key) return;
      if (value) marks.set(key, value); else marks.delete(key);
      const row = rowElement(key);
      const cue = cueById(key);
      if (row && cue) paintTags(row, cue, clashes().has(positionKey(cue.at)));
    }

    /// Paint the engine's own view of the list, in place: which cue is next, which ones it has spent, and
    /// where the list was last armed.
    ///
    /// A cue that is no longer spent has been armed again — a rewind, or a save that reset the list — and a
    /// mark that stayed would be the lie these windows exist not to tell. A cue that `repeats` is never in
    /// `spent` at all (it stays armed), so its mark is kept until a re-arm says otherwise rather than being
    /// wiped by every snapshot.
    function applySnapshot(snapshot) {
      nextId = snapshot?.next_cue_id ? String(snapshot.next_cue_id) : null;
      spent = new Set((Array.isArray(snapshot?.spent_ids) ? snapshot.spent_ids : []).map(String));
      const armedAt = String(snapshot?.armed_at || "");
      // A window opened late has heard no announcement, and `spent_ids` does not say *how* a cue was spent. When the
      // snapshot carries the kind (`spent_cues`), the row can be painted truthfully — fired or skipped — instead of
      // the neutral "spent" it can only offer from the ids alone. The announcement still wins once it arrives.
      if (Array.isArray(snapshot?.spent_cues)) {
        for (const entry of snapshot.spent_cues) {
          const id = String(entry?.id ?? "");
          const kind = entry?.kind;
          if (id && (kind === "fired" || kind === "skipped")) marks.set(id, kind);
        }
      }
      libraryLen = typeof snapshot?.macro_library_len === "number" ? snapshot.macro_library_len : null;
      health = new Map();
      if (Array.isArray(snapshot?.cue_health)) {
        for (const entry of snapshot.cue_health) {
          const id = String(entry?.id ?? "");
          if (id && entry?.problem) health.set(id, { problem: entry.problem, macro_id: entry.macro_id, macro_index: entry.macro_index });
        }
      }
      for (const id of [...marks.keys()]) {
        const cue = cueById(id);
        if (cueRepeat(cue) === "every") continue;
        if (!spent.has(String(id))) marks.delete(String(id));
      }
      const clash = clashes();
      const list = config.container();
      if (list) {
        for (const row of list.querySelectorAll(".cue-row")) {
          const cue = cueById(row.dataset.cueId);
          if (cue) paintTags(row, cue, clash.has(positionKey(cue.at)));
        }
      }
      const armed = config.armedId ? document.getElementById(config.armedId) : null;
      if (armed) {
        const wanted = armedAt ? `Re-armed at ${armedAt}.` : "";
        if (armed.textContent !== wanted) armed.textContent = wanted;
        armed.hidden = !armedAt;
      }
    }

    /// A rewind arms the cues the engine's own rule arms: the ones whose position is later than where the
    /// show went back to. Clearing the marks the same way is what keeps the picture from claiming a cue is
    /// spent when the engine has already armed it again.
    function clearMarksAfter(positionText) {
      const parsed = parsePositionText(positionText);
      if (!parsed) return;
      const list = cues();
      const hint = typeof config.rateHint === "function" ? config.rateHint() : list[0]?.at?.rate;
      const boundary = toFrames(parsed, framesPerSecond({ rate: hint || "fps25" }));
      for (const cue of list) {
        if (toFrames(cue.at, framesPerSecond(cue.at)) > boundary) mark(cue.id, null);
      }
    }

    /// A source change re-arms the engine (`reset_cues` is called when the ports open and when LTC starts), so every
    /// mark this window is holding is a mark about a list the engine no longer has.
    function clearMarks() {
      marks.clear();
      const clash = clashes();
      const list = config.container();
      if (!list) return;
      for (const row of list.querySelectorAll(".cue-row")) {
        const cue = cueById(row.dataset.cueId);
        if (cue) paintTags(row, cue, clash.has(positionKey(cue.at)));
      }
    }

    function api() {
      return { pushUndo, local, fail, render, isLocked, renumberCues };
    }
    function render() {
      // The Save control follows every paint: a render runs after a save and after a local change, and both are
      // exactly when "is anything unsaved?" can have changed.
      syncSave();
      const list = config.container();
      if (!list) {
        // A window whose list element is missing **says so** where the operator reads, instead of drawing nothing: an
        // empty cue list and a list that could not be drawn are different problems with different cures, and a panel
        // that silently showed neither is the placeholder rule's other half.
        if (typeof config.fail === "function") {
          config.fail("The cue list could not be drawn: this window has no list element.");
        }
        if (typeof config.rendered === "function") config.rendered();
        return;
      }
      const clash = clashes();
      // **The field the operator is in survives the repaint.** Several callers repaint the whole list in answer to a
      // click — a click on a row selects it, and selecting repaints — and replacing the element under the caret takes
      // the focus, the caret and the selection with it. Measured 2026-10-09, in WKWebView and in Chrome: after a real
      // click on a cue's time field, `document.activeElement` was `body` and the next keystroke changed nothing at all.
      // That is the "the clicks do not work in the cues window" the owner reported, and it is a property of the list
      // rather than of any one window: this function is the one place every paint passes through.
      const keptField = rememberFocusedField(list);
      list.textContent = "";
      // A cue the list no longer holds cannot stay selected, and this is the one place every paint passes through — so
      // it is where the selection is kept honest, whichever window or filter caused the paint.
      pruneSelection();
      // `orderedCues` answers with `{ cue, index }` entries — the index is the list's own order, which is what breaks a
      // tie — so the row is built from `entry.cue`, never from the entry itself.
      for (const entry of orderedCues(visibleCues(), config.mode(), cues())) {
        const row = buildRow(entry.cue, clash.has(positionKey(entry.cue.at)));
        row.classList.toggle(SELECTED_CLASS, selectedIds.has(String(entry.cue.id)));
        list.appendChild(row);
      }
      restoreFocusedField(list, keptField);
      const count = config.filterCountId ? document.getElementById(config.filterCountId) : null;
      if (count) {
        const active = Boolean(filter.trim());
        const text = active ? `${visibleCues().length} of ${cues().length} shown` : "";
        if (count.textContent !== text) count.textContent = text;
        count.hidden = !active;
      }
      if (typeof config.rendered === "function") config.rendered();
    }

    /// The field the operator is in, written down in a form that can be found again after the list is rebuilt: the row
    /// it belongs to, what the element is, and where it sits among its own siblings. `null` when nothing typeable in
    /// the list has the focus, which is the common case — a click on a row focuses the row, not a field.
    function rememberFocusedField(list) {
      const active = document.activeElement;
      if (!active || !list.contains(active)) return null;
      if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement)) return null;
      const row = active.closest(".cue-row");
      if (!row || !row.dataset.cueId) return null;
      const parent = active.parentElement;
      if (!parent) return null;
      const siblings = [...parent.children].filter(
        (node) => node.tagName === active.tagName && node.className === active.className,
      );
      const index = siblings.indexOf(active);
      if (index < 0) return null;
      return {
        cueId: row.dataset.cueId,
        tag: active.tagName,
        className: active.className,
        index,
        start: typeof active.selectionStart === "number" ? active.selectionStart : null,
        end: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
      };
    }

    /**
     * Put that field back, with the selection it had.
     *
     * The selection matters as much as the focus: the click rule put the whole value in it (or the caret at its end),
     * and the operator's next keystroke is meant to land on exactly that. A number field refuses `setSelectionRange`
     * — it has no selection API at all — so the focus alone is restored there.
     */
    function restoreFocusedField(list, kept) {
      if (!kept) return;
      const row = list.querySelector(`.cue-row[data-cue-id="${escapeForSelector(kept.cueId)}"]`);
      if (!row) return;
      const candidates = [...row.querySelectorAll(kept.tag)].filter((node) => node.className === kept.className);
      const field = candidates[kept.index];
      if (!field) return;
      try {
        field.focus({ preventScroll: true });
      } catch (_) {
        try {
          field.focus();
        } catch (_) {}
      }
      if (kept.start === null) return;
      try {
        field.setSelectionRange(kept.start, kept.end);
      } catch (_) {
        // Number and date fields: nothing to restore, and the focus above is what they need.
      }
    }

    /// Wire the controls the row cannot wire for itself — the search box, the undo button and the Save control —
    /// and keep the lock in step with the other window.
    // ---- selection: which cues the operator has picked out, and the only place it lives -------------------------
    let selectedIds = new Set();
    let selectionAnchor = null;

    /// The selection in the **list's** order, so a window can say "first … last …" about what it is moving rather than
    /// about the order the clicks happened in.
    function selection() {
      return cues()
        .filter((cue) => selectedIds.has(String(cue?.id ?? "")))
        .map((cue) => String(cue.id));
    }

    /// A cue that is no longer in the list cannot stay selected: the shift key would move a row nobody can see, and the
    /// count in the window would include it.
    function pruneSelection() {
      const live = new Set(cues().map((cue) => String(cue?.id ?? "")));
      for (const id of [...selectedIds]) {
        if (!live.has(id)) selectedIds.delete(id);
      }
      if (selectionAnchor !== null && !live.has(selectionAnchor)) selectionAnchor = null;
    }

    /// Pick cues out. `range` extends from the anchor over what is **on screen** — the rows between the two clicks,
    /// which is what a shift-click means everywhere else — and `toggle` adds or removes one.
    /// The selection as one comparable string. The set's own order is the order the clicks happened in, which is not
    /// what is painted, so it is sorted before it is compared.
    function selectionKey() {
      return [...selectedIds].sort().join("\u0000");
    }

    function select(id, { range = false, toggle = false } = {}) {
      const wanted = String(id ?? "");
      if (!wanted) return;
      const painted = selectionKey();
      if (toggle) {
        if (selectedIds.has(wanted)) selectedIds.delete(wanted);
        else selectedIds.add(wanted);
        selectionAnchor = wanted;
      } else if (range && selectionAnchor !== null) {
        const order = orderedCues(visibleCues(), config.mode(), cues()).map((entry) => String(entry.cue.id));
        const from = order.indexOf(selectionAnchor);
        const to = order.indexOf(wanted);
        selectedIds = from >= 0 && to >= 0
          ? new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1))
          : new Set([wanted]);
      } else {
        selectedIds = new Set([wanted]);
        selectionAnchor = wanted;
      }
      pruneSelection();
      // **A press inside the row that is already the selection repaints nothing, so it does not repaint.** A click on
      // a cue's field selects that row, and a repaint replaces the field the operator has just put the caret in — the
      // focus, the caret and the selection go with it (measured: four rows rebuilt on every click inside one, and the
      // next keystroke went nowhere). When the painted set is unchanged there is nothing to draw, and the field is
      // left exactly as the click rule left it.
      if (selectionKey() === painted) return;
      render();
    }

    /// Drop the selection. It does **not** paint: every caller either renders straight after or is about to replace
    /// the list entirely.
    function clearSelection() {
      selectedIds = new Set();
      selectionAnchor = null;
    }

    function attach(elements = {}) {
      const filterInput = elements.filterInput;
      if (filterInput) {
        setFilter(filterInput.value);
        filterInput.addEventListener("input", () => {
          setFilter(filterInput.value);
          render();
        });
      }
      const undoButton = elements.undoButton;
      if (undoButton) {
        const sync = () => { undoButton.hidden = !canUndo(); };
        undoButton.addEventListener("click", () => { undo(); sync(); });
        // The button is drawn only while there is something to take back: a control that cannot do its job is
        // not put on screen, and an undo with an empty stack is exactly that.
        undoButton.hidden = !canUndo();
        undoHooks.push(sync);
      }
      if (elements.saveButton) {
        saveButton = elements.saveButton;
        // The class is the module's handle on the control; the ids the stylesheet also names belong to the windows.
        saveButton.classList.add(SAVE_CLASS);
        syncSave();
      }
      window.addEventListener("storage", (event) => {
        if (event.key !== LOCKED_KEY) return;
        locked = readLockedIds();
        render();
      });
    }

    return {
      render,
      mark,
      clearMarks,
      applySnapshot,
      clearMarksAfter,
      setFilter,
      filterText,
      visibleCount,
      totalCount,
      undo,
      canUndo,
      resetUndo,
      // A **window-level** edit needs to open its own undo step, which until now only a row's own editor could do: a
      // bulk change is one step or it is a dozen, and the window cannot reach `extras`' API. One call before the edit
      // is what makes "one undo step" true.
      pushUndo,
      // Which cues are picked out. The panel owns it because it repaints every row on its own (a filter keystroke is
      // enough) and re-applies this per-row state as it paints, exactly as it does with the marks.
      select,
      selection,
      selectionAnchor: () => selectionAnchor,
      clearSelection,
      // The ids **on screen**, in the order they are drawn: what a shift-click range runs over, and what a window needs
      // to say how much of a selection the search is hiding.
      visibleIds: () => orderedCues(visibleCues(), config.mode(), cues()).map((entry) => String(entry.cue.id)),
      toggleLock,
      isLocked,
      // The window calls this from its own Renumber button: the numbering is the panel's (one undo step, a repaint,
      // the window's local-change hooks), and every id it leaves alone is what keeps an external firing working.
      renumberCues,
      attach,
      // The windows call this after their own local edits (a macro picker, a name field, the offset box) so the undo
      // button, the Save control and the status line follow.
      syncUndo() { afterLocalChange(); },
      // For a window that changed the draft without going through the panel at all — the offset box is one — and for a
      // test that wants the Save control re-read on demand.
      syncSave,
    };
  }

  // Loaded before the windows' own stylesheets. The Save/selection rules are id-scoped and the row's controls are
  // scoped under `.cue-row`, so neither depends on load order. That scoping is deliberate: `workstation.css` styles
  // every `button` and `input` on a page it is linked into, and it is linked **after** this file's injected sheet in
  // the LTC and clock windows — an equally specific row rule written here would lose to it and one row would be two
  // sizes in two windows (measured 2026-10-20: 18 px here, 24 px there, before the scoping). Each window's own copy
  // of the row rules still had to be deleted rather than left underneath (see `installRowStyles`).
  // Guarded because this file is plain browser JavaScript and a Node reader must not die on `document`.
  if (typeof document !== "undefined") {
    installSaveStyles();
    installSelectionStyles();
    installRowStyles();
  }

  window.WingCueList = {
    SORT_MODES,
    CREATED_ORDER_KEY,
    LOCKED_KEY,
    outcomeLabel: (outcome) => ({delivered: "executed", blocked: "blocked", nothing: "no macro",
      failed: "failed", cancelled: "cancelled", dropped: "dropped", superseded: "superseded",
      unconfirmed: "executed; writes unconfirmed"}[outcome] || "outcome unknown"),
    skipReason,
    framesPerSecond,
    positionText,
    timecodeStateText,
    blockerChain,
    blockerFailure,
    blockerChainText,
    positionKey,
    parsePositionText,
    framesInADay,
    toFrames,
    fromFrames,
    nudgeAt,
    nextFreeFrame,
    orderedCues,
    clashMap,
    cueNumber,
    renumberValue,
    numbersInUse,
    cueHasLabel,
    cueName,
    nextCueId,
    cueListPayload,
    mergeCueList,
    cueListDirty,
    cueGroupNames,
    macroHash,
    cuesSharingMacro,
    DRIVE_MODES,
    durationText,
    parseDurationText,
    cueRepeat,
    macroForReference,
    macroIndexForReference,
    macroTokenAt,
    macroReferenceForToken,
    macroTokenForReference,
    filterMatches,
    countdownState,
    countdownLabel,
    createHistory,
    wallClock,
    readLockedIds,
    writeLockedIds,
    createPanel,
  };
})();
