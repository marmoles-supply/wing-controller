// The one home of the caret rule every window obeys.
//
// WHAT THE OPERATOR ASKED FOR (owner, 2026-10-09)
//
//   * The first click on a field selects the whole value, so the first key typed overwrites it.
//   * The second click on the same field leaves the caret at the end of the value, so it can be
//     appended to or corrected from the right.
//   * Clicking again after that is native: the caret goes wherever the operator points, which is
//     what correcting the middle of a value needs.
//   * The same behaviour in every window: the workstation, the meter bridge, LTC, Timecode and the
//     guide, and in every dialog, panel and pop-up of each of them.
//
// WHY IT IS ONE FILE AND NOT FIVE COPIES
//
// The click rule and the WKWebView workaround below were written by hand in `index.html` and
// `meters.html` and did not exist at all in `ltc.html`, `timecode.html` or `guide.html`, so the
// same gesture behaved three different ways depending on the screen. A rule that matters gets one
// home and callers (see AGENTS.md, "A Rule Written By Hand In Several Places Will Drift"). Every
// window loads this file with `<script src="field-editing.js"></script>` before its own inline
// script; `scripts/test-desktop-window-dialog-contracts.mjs` fails if a window keeps a second copy.
//
// WHAT IT ALSO HAS TO KEEP ALIVE (measured in WKWebView, 2026-10-05)
//
// A field can hold the DOM focus while WebKit refuses every edit: the caret is there, the keystroke
// arrives, and `execCommand("insertText")` still returns false. Touching the selection re-opens that
// editing pipeline, which is why a click on a field ends by setting a selection and not only by
// calling `focus()`. macOS does not deliver the click that activates an inactive window unless
// `acceptFirstMouse` is on (the Rust side sets it), so the window is claimed as well, on every click
// over a field.
//
// AND WHERE THE RULE IS APPLIED, WHICH IS THE WHOLE OF ITS RELIABILITY (measured in WKWebView,
// 2026-10-09, with `scripts/dev-webkit-probe.swift`'s real event path)
//
// The engine places the caret as the *default action* of the press, and a default action runs after every
// listener — so a selection set from a listener is collapsed again. Setting it one frame later is what this
// file used to do, and it is worse than it sounds: `requestAnimationFrame` does not fire at all in a WKWebView
// whose application is not the active one, which is exactly the window the operator is using, so the rule ran
// in Chrome's suites and never ran in the application. The press the rule owns therefore does not get to place
// a caret: its default action is cancelled and the selection is set in that same listener (see the `mousedown`
// listener below, which carries the measurements).
//
// WHAT THE OLD COPY GOT WRONG, SO IT IS NOT REPEATED HERE
//
// It re-applied the *first* click's select-all from the bounded re-focus that follows every click
// (`holdFieldFocus`), so the selection came back 140 ms later and again and again for nearly a
// second: the caret appeared to jump back to the left on its own and typing replaced text the
// operator had already written. The re-focus below therefore never moves the caret; it only re-opens
// the pipeline and preserves whatever selection the operator has.
//
// AND ONE MORE CAUSE OF THE SAME SYMPTOM (measured in Chrome 155, 2026-10-09)
//
// Both windows' channel-matrix grid registered a `pointerup` listener on the **window** that cleared
// the document selection unconditionally, so every release anywhere in the window emptied the
// selection of the field that had just been clicked (measured: `[2,2]` became `[0,0]` and
// `insertText` stopped being enabled). It now clears the selection only while the grid owns the
// pointer. That defect belonged to the grid and was fixed there; it is recorded here because the
// gesture is what the operator noticed, and because a window that wipes a field's selection on every
// release is a window where no caret rule can hold.

(function () {
  "use strict";

  // A positive list on purpose: a comma-separated list of negative selectors would re-include check
  // boxes and sliders through one of the other entries. A slider or a check box keeps native
  // behaviour and never claims the window.
  const TYPEABLE_FIELD_SELECTOR = [
    "input:not([type])",
    'input[type="text"]',
    'input[type="search"]',
    'input[type="url"]',
    'input[type="tel"]',
    'input[type="email"]',
    'input[type="password"]',
    'input[type="number"]',
    'input[type="date"]',
    'input[type="time"]',
    'input[type="datetime-local"]',
    'input[type="month"]',
    'input[type="week"]',
    "textarea",
    "select",
    '[contenteditable="true"]',
  ].join(", ");

  /// The field of the press being counted, and how many presses in a row it has taken. A press
  /// anywhere else — or a field that no longer has the focus — starts the count again, so coming
  /// back to a field is a first click.
  ///
  /// **A press counts against a field's ADDRESS, not against the element**, and the difference is one click the
  /// application got wrong: a click inside a cue row makes the row select itself, the row is rebuilt, and the element
  /// the operator clicked is replaced while its replacement takes the focus. Comparing elements made every click after
  /// a rebuild look like a first click, so the second click selected everything again instead of leaving the caret at
  /// the end (measured in WKWebView: two clicks on a cue's time field gave `42`, where the field's own value had been
  /// `01:00:10:00`, and only the third click behaved as the second should). `fieldKey` is that address: the id when
  /// there is one, the row it belongs to, and its place among its own siblings.
  let pressedFieldKey = null;
  let pressCount = 0;

  /// The press the current pointerup belongs to, so the release re-applies the rule the press chose.
  let lastPress = { field: null, mode: "native" };

  /// A field's address within the page, stable across a repaint of the list around it.
  function fieldKey(field) {
    const id = field.id ? `#${field.id}` : "";
    const row = typeof field.closest === "function" ? field.closest("[data-cue-id]") : null;
    const cue = row && row.dataset ? row.dataset.cueId || "" : "";
    const parent = field.parentElement;
    const index = parent
      ? [...parent.children].filter((node) => node.tagName === field.tagName && node.className === field.className).indexOf(field)
      : -1;
    return `${id}@${cue}|${field.tagName}|${field.className}|${index}`;
  }

  /// A field with a caret. A `<select>` opens a list instead, so it is claimed but never selected.
  const isCaretField = (field) =>
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    Boolean(field && field.isContentEditable);

  function typeableFieldFrom(event) {
    if (event.button !== 0) return null;
    const field = event.target && event.target.closest ? event.target.closest(TYPEABLE_FIELD_SELECTOR) : null;
    if (!field || field.disabled || field.readOnly) return null;
    return field;
  }

  /// The window's own log when it has one (`index.html`), the console otherwise. A failed focus
  /// claim must not be silent, and it must not throw inside a pointer handler either.
  function report(message) {
    try {
      if (typeof window.appendLog === "function") window.appendLog(message);
      else if (typeof console !== "undefined" && console.warn) console.warn(message);
    } catch (_) {}
  }

  /// The window has to be key (`core:window:allow-set-focus` must be granted in
  /// capabilities/default.json, or Tauri rejects this and the rejection is invisible), and its
  /// webview has to be the first responder: raising the window alone does not give WebKit the focus
  /// it needs to edit.
  function claimWindowFocus() {
    try {
      const request = window.__TAURI__?.window?.getCurrentWindow?.()?.setFocus?.();
      if (request && typeof request.catch === "function") {
        request.catch((error) => report(`window_focus_failed ${String(error)}`));
      }
      const webviewFocus = window.__TAURI__?.core?.invoke?.("focus_webview");
      if (webviewFocus && typeof webviewFocus.catch === "function") {
        webviewFocus.catch((error) => report(`webview_focus_failed ${String(error)}`));
      }
    } catch (error) {
      report(`window_focus_failed ${String(error)}`);
    }
  }

  /// Whether WebKit's editing pipeline is open. Closed means the caret is visible and every edit is
  /// dropped, which is the state this file exists to leave behind.
  function pipelineIsOpen() {
    try {
      return document.queryCommandEnabled ? document.queryCommandEnabled("insertText") !== false : true;
    } catch (_) {
      return true;
    }
  }

  function selectionRange(field) {
    return {
      start: typeof field.selectionStart === "number" ? field.selectionStart : null,
      end: typeof field.selectionEnd === "number" ? field.selectionEnd : null,
    };
  }

  function restoreRange(field, range) {
    if (!range || range.start === null || range.end === null) return;
    try {
      field.setSelectionRange(range.start, range.end);
    } catch (_) {
      // Number and date controls reject `setSelectionRange`.
    }
  }

  function valueLength(field) {
    return String(field.value == null ? "" : field.value).length;
  }

  /// A range over the whole contents of a `contenteditable`, which has no `select()` method.
  function contentEditableRange(field, collapseToEnd) {
    try {
      const range = document.createRange();
      range.selectNodeContents(field);
      if (collapseToEnd) range.collapse(false);
      const selection = window.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_) {}
  }

  function selectEverything(field) {
    if (field.isContentEditable) {
      contentEditableRange(field, false);
      return;
    }
    try {
      // `select()` is the call that also re-opens WebKit's editing pipeline.
      field.select();
    } catch (_) {}
    // It is a no-op on a control the engine refuses to select: a number input reports
    // `selectionStart === null` (measured in Chrome 155, 2026-10-09 — the highlight is painted but
    // the range is not readable), so an explicit all-range is attempted as well.
    if (typeof field.selectionStart !== "number") return;
    if (field.selectionStart === 0 && field.selectionEnd === valueLength(field)) return;
    try {
      field.setSelectionRange(0, valueLength(field));
    } catch (_) {}
  }

  function caretToEnd(field) {
    if (field.isContentEditable) {
      contentEditableRange(field, true);
      return;
    }
    const length = valueLength(field);
    try {
      field.setSelectionRange(length, length);
      return;
    } catch (_) {
      // Number and date controls reject `setSelectionRange` (InvalidStateError, measured in Chrome
      // 155, 2026-10-09) and report `selectionStart === null`, so there is no caret API to call at
      // all. Clearing the value and writing it back is what leaves the caret at its end there: the
      // plain `value = value` was measured to run the other way — it leaves the value *selected*,
      // which would make the second click overwrite instead of append. The value comes back
      // unchanged and no `input`/`change` event is fired by a programmatic assignment, so nothing
      // the window listens to can observe the empty instant.
    }
    try {
      const value = field.value;
      field.value = "";
      field.value = value;
    } catch (_) {}
  }

  /**
   * Put the caret where the click rule says it goes.
   *
   * `mode` is `"all"` (first click), `"end"` (second click) or `"native"` (anything later: keep the
   * selection the click just made). Setting a selection is also what re-opens a closed pipeline, and
   * a blur would fire the inline editors' commit handlers, so the recovery uses `select()` and a
   * synthetic click instead — both measured in WKWebView.
   */
  function placeCaret(field, mode) {
    const rule = mode || "native";
    if (!isCaretField(field)) return;
    // A native click is left alone the moment typing works: the engine placed the caret where the
    // operator pointed, and re-applying a range read a moment earlier would undo the click. The
    // first and second clicks do not depend on that read at all — their rule comes from `mode`, so
    // they are re-applied even if another listener wipes the selection in between.
    if (rule === "native" && pipelineIsOpen()) return;
    // The range to preserve, read at the moment it has to be preserved.
    const range = rule === "native" ? selectionRange(field) : null;
    const apply = () => {
      if (rule === "all") selectEverything(field);
      else if (rule === "end") caretToEnd(field);
      else restoreRange(field, range);
    };
    apply();
    if (pipelineIsOpen()) return;
    try {
      field.select();
    } catch (_) {}
    apply();
    if (pipelineIsOpen()) return;
    try {
      // Last resort, measured in WKWebView. A click on a text control also places the caret where it
      // points — at the start, for a synthetic one that carries no coordinates — so the rule is
      // applied once more afterwards: a recovery that leaves the caret somewhere the operator did not
      // ask for is the same defect in a new place.
      field.click();
    } catch (_) {}
    apply();
  }

  function claimFieldFocus(field, mode) {
    claimWindowFocus();
    if (document.activeElement !== field) {
      try {
        field.focus({ preventScroll: true });
      } catch (_) {
        try {
          field.focus();
        } catch (_) {}
      }
    }
    placeCaret(field, mode);
  }

  /**
   * The platform can revoke the page focus a moment *after* the click (measured in WKWebView:
   * editing works while the mouse button is held and dies on release). Re-claim it a few times over
   * the next second, bounded so this can never become a loop, and only while the operator is still
   * in the same field.
   *
   * The caret is deliberately left alone here (`"native"`): re-applying the first click's select-all
   * from this timer is exactly the defect that made the caret jump back to the left while typing.
   */
  function holdFieldFocus(field) {
    if (!isCaretField(field)) return;
    let attempts = 0;
    const recheck = () => {
      if (document.activeElement !== field) return;
      attempts += 1;
      if (!document.hasFocus() || !pipelineIsOpen()) claimFieldFocus(field, "native");
      if (attempts < 6) setTimeout(recheck, 140);
    };
    setTimeout(recheck, 60);
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      const field = typeableFieldFrom(event);
      if (!field) {
        // A press anywhere else ends the sequence: the next press on this field is a first click.
        pressedFieldKey = null;
        pressCount = 0;
        return;
      }
      const wasFocused = document.activeElement === field;
      const key = fieldKey(field);
      pressCount = pressedFieldKey === key && wasFocused ? pressCount + 1 : 1;
      pressedFieldKey = key;
      const mode = pressCount === 1 ? "all" : pressCount === 2 ? "end" : "native";
      lastPress = { field, mode };
      claimFieldFocus(field, mode);
    },
    true,
  );

  /**
   * **The rule is applied here, on the press, and the engine's own caret placement is cancelled.**
   *
   * This is the part that made the gesture work in Chrome and not in the application, and it was measured in the
   * engine the application runs: through `scripts/dev-webkit-probe.swift`'s real event path, a click on a field
   * whose value is `-18` with the whole range selected on the way *down* still typed `42` as `-1842` — the engine
   * places the caret as the default action of the press, and that default action runs after every listener, so
   * anything the listeners set is collapsed. Two attempts were measured and both failed the same way: doing it in
   * a `click` listener (`-1842`), and doing it a frame later, which is what this module did before — and that
   * frame is the deeper problem, because `requestAnimationFrame` does not fire at all in a WKWebView whose
   * application is not the active one, so in the window that has the operator's attention the rule ran in Chrome
   * and never ran in the app.
   *
   * So the press that the rule owns does not get to place a caret: `preventDefault()` here, focus here, selection
   * here. Measured after the change, same tool: one click then `42` gives `42`, two clicks give `-1842` (the caret
   * at the end, so typing appends), and a third click inside the text gives `-4218` — the engine's own caret, where
   * the operator pointed. `click` still arrives after a cancelled `mousedown` (measured: `pointerup+mouseup+click`),
   * so a row that selects itself from a click on one of its fields still does.
   *
   * A `<select>` is typeable and has no caret; cancelling its press would stop the only thing it does. Only a field
   * with a caret takes this path, and only for the two clicks the rule owns: a later one is left entirely alone.
   */
  document.addEventListener(
    "mousedown",
    (event) => {
      const field = typeableFieldFrom(event);
      if (!field) return;
      const mode = lastPress.field === field ? lastPress.mode : "native";
      if (mode === "native" || !isCaretField(field)) return;
      event.preventDefault();
      if (document.activeElement !== field) {
        try {
          field.focus({ preventScroll: true });
        } catch (_) {
          try {
            field.focus();
          } catch (_) {}
        }
      }
      placeCaret(field, mode);
    },
    true,
  );

  document.addEventListener(
    "pointerup",
    (event) => {
      const field = typeableFieldFrom(event);
      if (!field) return;
      // Once the platform has finished handling the release, take the focus back: WebKit can revoke the page
      // focus a moment after the click — editing works while the button is held and dies on release — and
      // without this the field is left with a caret and deaf. The rule itself is applied by the `mousedown`
      // listener above, which is the only moment the engine's own caret placement is behind us; this frame only
      // re-opens the pipeline and preserves whatever selection the operator has.
      requestAnimationFrame(() => {
        // ...but this frame runs later, and by then the operator may have moved on. Only claim the
        // focus back while this click is still the thing that has it, or while nothing has it (the
        // field whose focus the platform dropped is the case this recovery exists for, and then the
        // focus is on body). Without this test the window ate an editor it had just opened: Rename
        // opens the inline rename editor in the same frame as the click, this claim focused the name
        // field again, the editor's blur handler removed it, and the macro editor's contract failed
        // with "the inline rename editor must stay open to be typed into".
        if (document.activeElement !== field && document.activeElement !== document.body) return;
        claimFieldFocus(field, "native");
        holdFieldFocus(field);
      });
    },
    true,
  );

  // The windows use the selector for their own questions (which control owns Enter, whether a
  // dialog's field is typeable), and the browser suites drive `claimFieldFocus` directly, so both
  // are reachable. There is deliberately no second copy of either one.
  // One keyboard policy for every confirmation, prompt and picker in both windows.
  // Native buttons own Enter: accepting on keydown would turn Cancel into consent.
  function modalKey(event, root, accept, cancel, input = null) {
    const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden";
    const layers = Array.from(document.querySelectorAll(".win95-dialog-backdrop"))
      .filter((node) => !node.classList.contains("is-floating") && visible(node));
    if (layers.length && layers[layers.length - 1] !== root) return;
    const focus = document.activeElement;
    if (event.key === "Tab") {
      const controls = Array.from(root.querySelectorAll("button, input, select, textarea, a[href], [tabindex]"))
        .filter((node) => !node.disabled && node.tabIndex >= 0 && visible(node));
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (!root.contains(focus) || (event.shiftKey ? focus === first : focus === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
      event.stopImmediatePropagation();
    } else if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); cancel();
    } else if (event.key === "Enter") {
      event.stopImmediatePropagation();
      if (focus?.closest("button, a[href], [role='button']")) return;
      if (focus !== input && focus?.matches(TYPEABLE_FIELD_SELECTOR)) return;
      event.preventDefault(); accept();
    }
  }

  window.WingFieldEditing = {
    modalKey,
    selector: TYPEABLE_FIELD_SELECTOR,
    typeableFieldFrom,
    isCaretField,
    placeCaret,
    claimFieldFocus,
  };
})();
