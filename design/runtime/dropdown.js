// The drawn dropdown every plain `<select>` in the app wears.
//
// WKWebView ignores `appearance: none` on a native `<select>`: macOS draws both the closed box and
// the open list itself, so no rule in these documents can style them. The macro editor's parameter
// field is an app-drawn control instead (the grouped picker, `.parameter-picker` /
// `.parameter-menu-button` / `.parameter-menu` in `desktop/ui/index.html`), and a window that shows
// one macOS dropdown beside one app dropdown shows two different controls for the same job.
//
// This file gives every other `<select>` that same component and reuses those exact classes, so
// there is one look rather than two that resemble each other. The markup it draws is deliberately
// the picker's markup: the button wears `parameter-menu-button` (white sunken box, black text, the
// 10x6 chevron at `right 7px top 50%`, and the `body.theme-dark` variants) and the panel is a
// `parameter-menu is-flat` holding `parameter-menu-row`s, so the shared rules are the only rules.
//
// The native list stays in the DOM as the source of truth. Every other part of the app reads
// `select.value`, its `options`, its `<optgroup>`s and its `disabled`, the stored configs write it,
// and the editor's own tests set `.value` and dispatch `change`. So the drawn field only ever reads
// the list, hides it exactly the way the picker hides its own source (`.parameter-picker-source`,
// `display: none`) and writes a choice back through `input` + `change`, the two events a real
// selection fires — never around the control.
//
// Loaded by both windows; the bridge (`desktop/ui/meters.html`) has no grouped picker, so its own
// stylesheet carries the same declarations the workstation defines beside the picker.
(function () {
  "use strict";

  // The class the picker hides its source with. Reused rather than reinvented: a select hidden by
  // this component is hidden exactly like the picker's own, which is what `fieldIsOnScreen()` in
  // `desktop/ui/index.html` reads to decide whether a field is the operator's draft.
  var SOURCE_CLASS = "parameter-picker-source";
  // Marks a select this file already drew for. Wrapping twice would leave two buttons and an
  // orphaned panel behind one choice, so the mark is checked before anything is built.
  var DRAWN_FLAG = "data-dropdown-drawn";
  // The wording the editor uses for a list with nothing chosen (`NOT_CONFIGURED_LABEL` in
  // index.html). A field with no selection must read as "not configured", never as an empty box.
  var PLACEHOLDER = "\u2014 Not configured \u2014";
  // The panel's own bounds, taken from the picker's shared rules (`min-width: 220px;
  // max-width: 340px`): the drawn panel is the same box whichever select opened it.
  var PANEL_MIN_WIDTH = 220;
  var PANEL_MAX_WIDTH = 340;
  // Keeps a clamped panel off the window edge.
  var VIEWPORT_MARGIN = 4;
  // How long a type-ahead run of letters is kept before the next letter starts a new search, in the
  // spirit of the native list's own incremental search.
  var TYPE_AHEAD_RESET_MS = 800;

  // One record per drawn select, in document order; the value-write hook and the document listeners
  // walk it.
  var instances = [];
  var generatedKeys = 0;
  var typeBuffer = "";
  var typeTimer = null;

  function eventsSupported() {
    return typeof window.Event === "function";
  }

  /** Fires the two events a real selection fires, on the control the rest of the app listens to. */
  function dispatchSelection(select) {
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function instanceOf(select) {
    for (var i = 0; i < instances.length; i += 1) {
      if (instances[i].select === select) return instances[i];
    }
    return null;
  }

  /** The select's own words, without the option texts the native list contributes to `textContent`. */
  function labelTextOf(select) {
    var label = null;
    if (select.id) {
      try {
        label = document.querySelector('label[for="' + select.id + '"]');
      } catch (_) {
        label = null;
      }
    }
    if (!label && select.closest) label = select.closest("label");
    if (!label) {
      var sibling = select.parentElement
        ? select.parentElement.querySelector(".field-label, .control-label, .meter-tuning-label")
        : null;
      return sibling ? (sibling.textContent || "").replace(/\s+/g, " ").trim() : "";
    }
    var clone = label.cloneNode(true);
    var drop = clone.querySelectorAll("input, select, textarea, button, svg");
    for (var i = 0; i < drop.length; i += 1) {
      if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
    }
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function selectedOption(select) {
    return select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
  }

  /** What the closed field reads: the chosen option, or the placeholder when nothing is chosen. */
  function valueTextOf(select) {
    var option = selectedOption(select);
    if (option) {
      var text = (option.textContent || "").replace(/\s+/g, " ").trim();
      return text || option.value;
    }
    // No option is selected at all (an empty list, or a value the list does not carry): the field
    // says so instead of showing a blank box. `data-placeholder` lets a control name its own empty
    // wording; the default is the editor's "not configured".
    var declared = (select.getAttribute("data-placeholder") || "").trim();
    return declared || PLACEHOLDER;
  }

  /** True when other code has hidden the source, which the drawn button has to mirror. */
  function hiddenByApp(select) {
    if (select.classList.contains("hidden")) return true;
    if (select.hidden) return true;
    return select.style.display === "none";
  }

  // ---------------------------------------------------------------------------------------------
  // The drawn markup
  // ---------------------------------------------------------------------------------------------

  function groupOf(option) {
    var parent = option.parentElement;
    return parent && parent.tagName === "OPTGROUP" ? parent : null;
  }

  function optionIsUnavailable(option) {
    var group = groupOf(option);
    return Boolean(option.disabled || (group && group.disabled));
  }

  function rowLabel(text) {
    var label = document.createElement("span");
    label.className = "parameter-menu-label";
    label.textContent = text;
    return label;
  }

  /** The second level a category list carries on its options, empty when the group reads in one go. */
  function subgroupOf(option) {
    var declared = option.getAttribute("data-subgroup");
    return declared ? declared.replace(/\s+/g, " ").trim() : "";
  }

  /**
   * The headings a subgroup needs: only the groups that actually hold more than one.
   *
   * A group whose every entry shares one second level would otherwise be headed twice in a row ("Bus
   * meters" under "Sources"), which reads as a mistake rather than as a hierarchy.
   */
  function groupsNeedingSubheads(instance) {
    var options = instance.select.options;
    var perGroup = new Map();
    for (var i = 0; i < options.length; i += 1) {
      var group = groupOf(options[i]);
      var subgroup = subgroupOf(options[i]);
      if (!subgroup) continue;
      var key = group || null;
      if (!perGroup.has(key)) perGroup.set(key, []);
      var levels = perGroup.get(key);
      if (levels.indexOf(subgroup) < 0) levels.push(subgroup);
    }
    var needed = new Set();
    perGroup.forEach(function (levels, key) {
      if (levels.length > 1) needed.add(key);
    });
    return needed;
  }

  /**
   * One row per option, one header per `<optgroup>`, one subheading per run of options that share a
   * second level (`data-subgroup`, written by the window's `setCategoryOptions`).
   *
   * The rows are built from the source on every open instead of being kept in step with it: the app
   * rewrites lists in place (`renderMeterBanks`, `setCategoryOptions`) and reading the control at the
   * moment it is opened cannot show a stale list.
   */
  function buildRows(instance) {
    var panel = instance.panel;
    panel.innerHTML = "";
    // The old rows are gone with their ids, so the announcement has to go with them: whichever row is
    // drawn again becomes the highlighted one when the panel is shown.
    instance.activeRow = null;
    instance.button.removeAttribute("aria-activedescendant");
    var options = instance.select.options;
    var withSubheads = groupsNeedingSubheads(instance);
    var currentGroup = null;
    var currentSubgroup = "";
    for (var i = 0; i < options.length; i += 1) {
      var option = options[i];
      var group = groupOf(option);
      // One header before the first option of each group. A disabled `<optgroup>` disables its
      // options, and its header says so with the shared "a choice the console ignores" look.
      if (group && group !== currentGroup) {
        var header = document.createElement("div");
        header.className = "dropdown-group parameter-menu-row is-group is-header";
        header.setAttribute("role", "presentation");
        if (group.disabled) header.classList.add("is-unavailable");
        header.appendChild(rowLabel(group.label || ""));
        panel.appendChild(header);
      }
      // A new group starts a new run: the same second level on both sides of a group boundary is two
      // headings, not one heading over two families.
      if (group !== currentGroup) currentSubgroup = "";
      currentGroup = group;
      var subgroup = subgroupOf(option);
      if (subgroup && subgroup !== currentSubgroup && withSubheads.has(group || null)) {
        var subhead = document.createElement("div");
        subhead.className = "dropdown-subgroup parameter-menu-row is-subheader";
        subhead.setAttribute("role", "presentation");
        subhead.appendChild(rowLabel(subgroup));
        panel.appendChild(subhead);
      }
      currentSubgroup = subgroup;
      panel.appendChild(buildRow(instance, option, i));
    }
  }

  function buildRow(instance, option, index) {
    var unavailable = optionIsUnavailable(option);
    var row = document.createElement("button");
    row.type = "button";
    row.className = "dropdown-row parameter-menu-row";
    row.setAttribute("role", "option");
    row.id = instance.panel.id + "-option-" + index;
    row.setAttribute("data-menu-value", option.value);
    // The chosen row is marked the way the picker marks its own choice, bullet included.
    var selected = Boolean(option.selected);
    row.classList.toggle("is-selected", selected);
    row.setAttribute("aria-selected", selected ? "true" : "false");
    row.disabled = unavailable;
    row.classList.toggle("is-unavailable", unavailable);
    // A refused choice explains itself: the app writes the reason into the option's `title`
    // (`syncActionModeAvailability` hides the modes the parameter cannot support).
    if (option.title) row.title = option.title;
    row.appendChild(rowLabel((option.textContent || "").replace(/\s+/g, " ").trim() || option.value));
    if (!unavailable) {
      row.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        choose(instance, row);
      });
    }
    // Hovering a row highlights it too, so the arrow keys carry on from where the pointer left. It
    // does not scroll: see `setActive`.
    row.addEventListener("mouseenter", function () {
      if (!unavailable) setActive(instance, row, false);
    });
    return row;
  }

  /** The rows the arrow walk visits: the picker's `visibleMenuRows`, minus its hidden rows. */
  function selectableRows(instance) {
    var rows = instance.panel.querySelectorAll(".dropdown-row");
    var usable = [];
    for (var i = 0; i < rows.length; i += 1) {
      if (!rows[i].disabled) usable.push(rows[i]);
    }
    return usable;
  }

  /**
   * Highlights a row, and scrolls it into view only when the keyboard asked for it.
   *
   * Hovering never scrolls: the pointer is already on the row, and the picker's own menu does the same
   * (`focusMenuRow` scrolls, its `mouseenter` only opens a branch). Scrolling under a stationary
   * pointer makes the browser re-run the hover, which would re-enter this function from its own
   * effect — the one way a list like this can chase itself.
   */
  function setActive(instance, row, reveal) {
    if (instance.activeRow === row) return;
    if (instance.activeRow) instance.activeRow.classList.remove("is-active");
    instance.activeRow = row || null;
    if (instance.activeRow) {
      instance.activeRow.classList.add("is-active");
      // The keyboard highlight is announced through the button, which keeps the focus: the operator's
      // Tab stop never moves into the list.
      instance.button.setAttribute("aria-activedescendant", instance.activeRow.id);
      if (reveal !== false) revealRow(instance, instance.activeRow);
    } else {
      instance.button.removeAttribute("aria-activedescendant");
    }
  }

  /**
   * Keeps the highlighted row inside the scrolling panel without scrolling the window.
   *
   * A row taller than the panel cannot be made fully visible, so it is aligned by its top and left
   * there: asking for its bottom instead would move the list on every pass, and a list that scrolls
   * under the pointer never settles.
   */
  function revealRow(instance, row) {
    var panel = instance.panel;
    if (panel.hidden) return;
    var top = row.offsetTop;
    var bottom = top + row.offsetHeight;
    if (row.offsetHeight >= panel.clientHeight) {
      panel.scrollTop = top;
      return;
    }
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight;
  }

  function moveActive(instance, key) {
    var rows = selectableRows(instance);
    if (rows.length === 0) return;
    var current = rows.indexOf(instance.activeRow);
    var next;
    if (key === "Home") next = 0;
    else if (key === "End") next = rows.length - 1;
    else if (key === "ArrowDown") next = current < 0 ? 0 : Math.min(rows.length - 1, current + 1);
    else next = current < 0 ? rows.length - 1 : Math.max(0, current - 1);
    setActive(instance, rows[next]);
  }

  /** Typing letters jumps to the first option that starts with them; the panel stays open. */
  function typeAhead(instance, key) {
    if (instance.panel.hidden) return;
    if (typeTimer) clearTimeout(typeTimer);
    typeBuffer += key.toLowerCase();
    typeTimer = setTimeout(function () {
      typeBuffer = "";
      typeTimer = null;
    }, TYPE_AHEAD_RESET_MS);
    var match = firstRowStartingWith(instance, typeBuffer) || firstRowStartingWith(instance, key.toLowerCase());
    if (match) setActive(instance, match);
  }

  function firstRowStartingWith(instance, prefix) {
    if (!prefix) return null;
    var rows = selectableRows(instance);
    for (var i = 0; i < rows.length; i += 1) {
      var text = (rows[i].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text.indexOf(prefix) === 0) return rows[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Opening, closing and placing
  // ---------------------------------------------------------------------------------------------

  function close(instance) {
    if (!instance || instance.panel.hidden) return;
    instance.panel.hidden = true;
    instance.button.setAttribute("aria-expanded", "false");
    instance.button.removeAttribute("aria-activedescendant");
    instance.host.classList.remove("is-open");
    setActive(instance, null);
    // The next open starts a new search: a letter typed minutes ago must not narrow the new list.
    typeBuffer = "";
    if (typeTimer) {
      clearTimeout(typeTimer);
      typeTimer = null;
    }
  }

  function closeAll() {
    for (var i = 0; i < instances.length; i += 1) close(instances[i]);
  }

  /**
   * Draws the panel as wide as its longest option needs, inside the box the shared rules declare.
   *
   * The picker's panel is `min-width: 220px; max-width: 340px`, which is right for its two-word
   * parameter keys but wrong for a select whose options are shorter ("On"/"Off" in a 220px hole) or
   * longer. The row text wraps rather than clips (`white-space: normal` in the shared row rule), so
   * the bounds are never broken: the panel simply uses the room its own longest row asks for, and
   * never more than the window has.
   */
  function sizePanel(instance) {
    var panel = instance.panel;
    panel.style.removeProperty("min-width");
    // The floor of 80px is only for a window too narrow to hold anything: below it a wider panel would
    // hang off the edge, which is the one thing the panel may never do.
    var limit = Math.max(80, Math.min(PANEL_MAX_WIDTH, window.innerWidth - 2 * VIEWPORT_MARGIN));
    var wanted = Math.max(PANEL_MIN_WIDTH, instance.button.offsetWidth);
    var widest = widestLabelWidth(instance);
    if (widest > 0) wanted = Math.max(wanted, widest);
    panel.style.minWidth = Math.min(wanted, limit) + "px";
  }

  /** Measures the longest row label at the panel's own font, laid out off screen so nothing wraps. */
  function widestLabelWidth(instance) {
    var rows = instance.panel.querySelectorAll(".dropdown-row, .dropdown-group, .dropdown-subgroup");
    if (rows.length === 0) return 0;
    var probe = document.createElement("span");
    probe.className = "parameter-menu-label";
    probe.style.position = "absolute";
    probe.style.left = "-10000px";
    probe.style.top = "0";
    probe.style.whiteSpace = "nowrap";
    probe.style.visibility = "hidden";
    instance.panel.appendChild(probe);
    var widest = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var label = rows[i].querySelector(".parameter-menu-label");
      if (!label) continue;
      probe.textContent = label.textContent;
      if (probe.offsetWidth > widest) widest = probe.offsetWidth;
    }
    instance.panel.removeChild(probe);
    // The row's own padding (6px each side) and the bullet an `is-selected` row draws before its
    // label, plus the panel's 2px padding.
    return widest + 26;
  }

  /**
   * Places the open panel inside the window.
   *
   * The workstation publishes the grouped picker's own placement as `placeMenuInsideViewport`
   * (top-level function, `desktop/ui/index.html`), and the two menus hang off the same button shape:
   * calling it keeps the sideways flip and the clamp written once. The bridge has no picker to borrow
   * from, so the same rule is applied here in the same class (`is-flipped`).
   *
   * The vertical fit is this file's either way, because the borrowed rule leaves the flat list capped
   * with a 40px floor and never flips it: a field at the very bottom edge of the window opened a
   * sliver past the edge (measured on `meter-add-group`: button 741…765, panel 767…807 of 800).
   */
  function placePanel(instance) {
    if (typeof window.placeMenuInsideViewport === "function") window.placeMenuInsideViewport(instance.panel);
    else placePanelSideways(instance);
    fitPanelVertically(instance);
  }

  function placePanelSideways(instance) {
    var panel = instance.panel;
    panel.classList.remove("is-flipped");
    panel.style.removeProperty("left");
    panel.style.removeProperty("right");
    var rect = panel.getBoundingClientRect();
    if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
      panel.classList.add("is-flipped");
      rect = panel.getBoundingClientRect();
    }
    // A panel wider than the space between the two edges cannot be placed by choosing a side, so it
    // is clamped as well; `offsetLeft` is measured from the containing block the absolute position
    // uses, so the shift holds for a flipped panel too (whose `left` is `auto`).
    var wanted = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - VIEWPORT_MARGIN - rect.width));
    if (Math.abs(wanted - rect.left) >= 0.5) {
      panel.style.left = wanted - (rect.left - panel.offsetLeft) + "px";
      panel.style.right = "auto";
    }
  }

  /**
   * The vertical half: the list scrolls by design, so it keeps its place under the button and is capped
   * to the room it has. When that room is smaller than the list's own 40px floor, the space above the
   * button is the better side and the panel mirrors upwards with `is-up` — the class the grouped picker
   * uses for a panel that has no room below — instead of opening as a sliver off the edge.
   */
  function fitPanelVertically(instance) {
    var panel = instance.panel;
    panel.classList.remove("is-up");
    panel.style.removeProperty("max-height");
    var buttonRect = instance.button.getBoundingClientRect();
    var above = buttonRect.top - VIEWPORT_MARGIN - 2;
    // Measured with no inline cap, so this is the height the shared `is-flat` rule allows (its own
    // `max-height: 320px` already applied). Never write a cap above it: the borrowed rule sets
    // `max(40px, room below)` inline, which on a long list with room to spare outgrew the shared cap
    // and let a 42-entry panel cover 629px of the window instead of scrolling at 320.
    var rect = panel.getBoundingClientRect();
    var height = rect.height;
    var below = window.innerHeight - VIEWPORT_MARGIN - rect.top;
    if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN && below < 40 && above > below) {
      panel.classList.add("is-up");
      panel.style.maxHeight = Math.max(40, Math.min(height, above)) + "px";
      return;
    }
    if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
      panel.style.maxHeight = Math.max(40, Math.min(height, below)) + "px";
    }
  }

  function open(instance) {
    closeAll();
    buildRows(instance);
    instance.panel.hidden = false;
    instance.button.setAttribute("aria-expanded", "true");
    instance.host.classList.add("is-open");
    // Measured and placed after it is shown, because a hidden box has no geometry.
    sizePanel(instance);
    placePanel(instance);
    setActive(instance, selectedRow(instance) || selectableRows(instance)[0] || null);
  }

  function selectedRow(instance) {
    var option = selectedOption(instance.select);
    if (!option) return null;
    var rows = instance.panel.querySelectorAll(".dropdown-row");
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].getAttribute("data-menu-value") === option.value) return rows[i];
    }
    return null;
  }

  /** Writes the choice through the control the rest of the app reads, never around it. */
  function choose(instance, row) {
    var value = row.getAttribute("data-menu-value");
    if (instance.select.value !== value) {
      instance.select.value = value;
      // The same two events a real selection fires: the editor's own `input`/`change` listeners run
      // exactly as they do for the native list.
      dispatchSelection(instance.select);
    }
    close(instance);
    focusButton(instance);
  }

  function focusButton(instance) {
    if (typeof instance.button.focus !== "function") return;
    try {
      instance.button.focus({ preventScroll: true });
    } catch (_) {
      instance.button.focus();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Keeping the drawn field in step with the source
  // ---------------------------------------------------------------------------------------------

  /**
   * The button always names what the source has selected, and is disabled when the source is.
   *
   * `title` is written through `data-picker-title` as well: the app marks an invalid field on the
   * drawn button (`refreshFieldValidity` sets `${id}-menu`'s title and `is-invalid`) and restores the
   * resting wording from that attribute, so the field keeps its ScreenTip after the mark is cleared.
   */
  function syncChrome(instance) {
    var select = instance.select;
    var text = valueTextOf(select);
    instance.value.textContent = text;
    var title = instance.titleBase ? instance.titleBase + ": " + text : text;
    instance.button.dataset.pickerTitle = title;
    if (!instance.button.classList.contains("is-invalid")) instance.button.title = title;
    instance.button.setAttribute("aria-label", title);
    instance.button.disabled = Boolean(select.disabled);
    // A field the app hides with its own `.hidden` keeps its grid cell and is read as off screen: the
    // drawn button has to leave with it, or an off-screen field would answer hints and validation.
    var putAway = hiddenByApp(select);
    instance.host.classList.toggle("hidden", putAway);
    // A field that is disabled or put away cannot be operated, so an open list closes with it: left
    // open it would reappear the moment the field is shown again, over whatever the operator is doing.
    if (!instance.panel.hidden && (select.disabled || putAway)) close(instance);
  }

  function refresh(instance) {
    syncChrome(instance);
    // A list rewritten while the operator is reading it (a bank rename, a catalogue refresh) must not
    // leave the open panel showing choices that no longer exist.
    if (!instance.panel.hidden) {
      buildRows(instance);
      sizePanel(instance);
      placePanel(instance);
      setActive(instance, selectedRow(instance) || selectableRows(instance)[0] || null);
    }
  }

  function refreshAll() {
    for (var i = 0; i < instances.length; i += 1) refresh(instances[i]);
  }

  /**
   * `input`/`change` cover every interaction and every stored config the app applies through an
   * event, but not a bare `select.value = x`: `applyTriggerResponsePreset` writes five selects that
   * way and fires nothing at all, and the drawn field would keep reading the previous choice. The
   * setter is wrapped once for the whole document, does the real assignment and then tells the drawn
   * field to re-read it — nothing is dispatched, because a value write is not an interaction.
   */
  function observeValueWrites() {
    var proto = window.HTMLSelectElement && window.HTMLSelectElement.prototype;
    if (!proto || proto.__wingDropdownObserved) return;
    var descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (!descriptor || typeof descriptor.get !== "function" || typeof descriptor.set !== "function") return;
    Object.defineProperty(proto, "value", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: function () {
        return descriptor.get.call(this);
      },
      set: function (value) {
        descriptor.set.call(this, value);
        var instance = instanceOf(this);
        if (instance) syncChrome(instance);
      },
    });
    proto.__wingDropdownObserved = true;
  }

  // ---------------------------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------------------------

  function arrowKey(key) {
    return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
  }

  function confirmKey(key) {
    return key === "Enter" || key === " " || key === "Spacebar";
  }

  function buttonKeydown(instance, event) {
    var key = event.key;
    if (key === "Escape") {
      if (instance.panel.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      close(instance);
      return;
    }
    if (arrowKey(key)) {
      event.preventDefault();
      event.stopPropagation();
      // ArrowDown on the closed field opens it on the current choice, the way the picker's button
      // opens its own panel, and the next press walks the list.
      if (instance.panel.hidden) open(instance);
      else moveActive(instance, key);
      return;
    }
    if (confirmKey(key)) {
      // Both keys would otherwise run the button's own activation and toggle the panel shut again.
      event.preventDefault();
      event.stopPropagation();
      if (instance.panel.hidden) open(instance);
      else if (instance.activeRow) choose(instance, instance.activeRow);
      return;
    }
    if (key === "Tab") {
      close(instance);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) typeAhead(instance, key);
  }

  /** The same keys while the focus sits on a row (Tab reaches them; the picker's rows do too). */
  function panelKeydown(instance, event) {
    var key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(instance);
      focusButton(instance);
      return;
    }
    if (arrowKey(key)) {
      event.preventDefault();
      event.stopPropagation();
      moveActive(instance, key);
      return;
    }
    if (confirmKey(key)) {
      var row = event.target && event.target.closest ? event.target.closest(".dropdown-row") : null;
      if (!row || row.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      choose(instance, row);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) typeAhead(instance, key);
  }

  // ---------------------------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------------------------

  function alreadyDrawn(select) {
    if (select.getAttribute(DRAWN_FLAG) !== null) return true;
    // The grouped picker's own source: `createParameterPicker` hides it with this class and inserts
    // its button before it. Skipped before anything is built, so the picker keeps its control.
    if (select.classList.contains(SOURCE_CLASS)) return true;
    if (select.closest && select.closest("[data-parameter-picker]")) return true;
    return false;
  }

  /** A list box (`multiple`, or `size > 1`) is not a dropdown: its box shows the choices already. */
  function isListBox(select) {
    return Boolean(select.multiple) || Number(select.getAttribute("size") || 1) > 1;
  }

  function wrap(select) {
    var key = select.id || "wing-dropdown-" + (generatedKeys += 1);
    var host = document.createElement("div");
    host.className = "dropdown parameter-picker";
    host.setAttribute("data-dropdown-for", key);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "dropdown-button parameter-menu-button";
    if (select.id) button.id = select.id + "-menu";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    var listId = key + "-listbox";
    button.setAttribute("aria-controls", listId);
    // The button is the field's visible control, so it carries the field's own ScreenTip: the
    // inspector resolves a hovered control by id or `data-inspector`, and the id now lives on the
    // hidden source behind it (`fieldIsOnScreen` in index.html explains why the source is hidden).
    if (select.id) button.setAttribute("data-inspector", select.id);
    var value = document.createElement("span");
    value.className = "parameter-menu-value";
    button.appendChild(value);
    var panel = document.createElement("div");
    panel.className = "dropdown-panel parameter-menu is-flat";
    panel.id = listId;
    panel.setAttribute("role", "listbox");
    panel.hidden = true;
    var label = labelTextOf(select);
    if (label) panel.setAttribute("aria-label", label);
    host.appendChild(button);
    host.appendChild(panel);
    // Before the control, never after it: the source is hidden, so the button has to be the field's
    // own control — the one its `<label>` labels, the one a click on the word "Step type" opens, and
    // the one Tab reaches. The source stays in the DOM right behind it as the value holder.
    select.insertAdjacentElement("beforebegin", host);
    select.classList.add(SOURCE_CLASS);
    select.setAttribute(DRAWN_FLAG, "");
    var instance = {
      select: select,
      host: host,
      button: button,
      panel: panel,
      value: value,
      activeRow: null,
      // Read once, before any validation pass writes a problem into the source's own `title`.
      titleBase: (select.getAttribute("title") || "").trim() || label,
    };
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (panel.hidden) open(instance);
      else close(instance);
    });
    button.addEventListener("keydown", function (event) {
      buttonKeydown(instance, event);
    });
    panel.addEventListener("keydown", function (event) {
      panelKeydown(instance, event);
    });
    // The panel sits inside the field's `<label>`, and a click that lands on the panel itself (its
    // padding, an `<optgroup>` header, a row that cannot be chosen) is not a choice: without this the
    // label would forward its activation to the drawn button and close the open list under the
    // pointer.
    panel.addEventListener("click", function (event) {
      var row = event.target && event.target.closest ? event.target.closest(".dropdown-row") : null;
      if (!row || row.disabled) event.preventDefault();
    });
    // Tabbing or clicking out of the field leaves no panel hanging open behind the operator.
    host.addEventListener("focusout", function (event) {
      if (host.contains(event.relatedTarget)) return;
      close(instance);
    });
    var syncFromControl = function () {
      refresh(instance);
    };
    select.addEventListener("input", syncFromControl);
    select.addEventListener("change", syncFromControl);
    // The app rewrites option lists in place and toggles `hidden`/`disabled` on the source itself
    // (`valueOptions.classList.toggle("hidden", !closedList)`), so the drawn field follows those
    // attributes too — the `.parameter-picker-source` class this file adds is written before the
    // observer starts, and `hiddenByApp` therefore never reads it as "hidden by the app".
    var observer = new MutationObserver(function () {
      refresh(instance);
    });
    observer.observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "disabled", "title", "label"],
    });
    instance.observer = observer;
    instances.push(instance);
    syncChrome(instance);
    return instance;
  }

  function selectAll(root) {
    var found = (root || document).querySelectorAll("select");
    var pending = [];
    for (var i = 0; i < found.length; i += 1) {
      var select = found[i];
      if (alreadyDrawn(select) || isListBox(select)) continue;
      pending.push(select);
    }
    return pending;
  }

  /**
   * Draws every plain `<select>` in the document.
   *
   * Called once the DOM is there. In the workstation this runs from `DOMContentLoaded`, which fires
   * after the inline script at the end of `<body>` has created the grouped pickers, so their sources
   * already carry `.parameter-picker-source` and are skipped here. Calling it again (a test, or a
   * later window that adds a select) draws only what is still undrawn: the mark and the class make a
   * second wrap impossible, and `createParameterPicker` skips an already-drawn control in
   * index.html for the same reason in the other direction.
   */
  function init(root) {
    if (!eventsSupported()) return [];
    observeValueWrites();
    var pending = selectAll(root);
    var drawn = [];
    for (var i = 0; i < pending.length; i += 1) drawn.push(wrap(pending[i]));
    return drawn;
  }

  // Document-level behaviour is registered once, however often `init` runs.
  var listening = false;
  function listenOnce() {
    if (listening) return;
    listening = true;
    document.addEventListener("mousedown", function (event) {
      for (var i = 0; i < instances.length; i += 1) {
        if (!instances[i].host.contains(event.target)) close(instances[i]);
      }
    });
    // Escape anywhere closes the open list; when the focus was inside it, it goes back to the button.
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      for (var i = 0; i < instances.length; i += 1) {
        var instance = instances[i];
        if (instance.panel.hidden) continue;
        var inside = instance.host.contains(document.activeElement);
        close(instance);
        if (inside) focusButton(instance);
      }
    });
  }

  function start() {
    listenOnce();
    init(document);
  }

  window.WingDropdown = {
    init: init,
    refresh: refreshAll,
    closeAll: closeAll,
    instances: function () {
      return instances.slice();
    },
  };

  // The script tag sits in `<head>` beside `version.js`/`dither.js`/`vu-draw.js`, so the document is
  // still loading when it arrives. Waiting for `DOMContentLoaded` is what places every drawn field
  // after the grouped pickers the app builds at the end of `<body>`.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
