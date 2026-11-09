// Desktop UI contracts that only inspection used to catch.
//
// The strongest check here is the IPC one: every command the desktop frontend
// invokes must be registered in the Rust `tauri::generate_handler!` list. The
// context menu used to call `send_test_osc`, which was never registered, so the
// entry only ever logged "command not found". Nothing compared the two sides
// before this script.
//
// Run: node scripts/test-desktop-ui-contracts.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const indexHtml = read("desktop/ui/index.html");
const metersHtml = read("desktop/ui/meters.html");
const mainRs = read("desktop/src-tauri/src/main.rs");

// --- IPC surface ---------------------------------------------------------

const handlerBlock = /generate_handler!\[([\s\S]*?)\]/.exec(mainRs)?.[1] ?? "";
assert.ok(handlerBlock.length > 0, "main.rs must register commands through tauri::generate_handler!");
const registered = new Set(
  handlerBlock
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^[a-z_][a-z0-9_]*$/.test(entry)),
);
assert.ok(registered.size > 10, `expected the handler list to contain commands, got ${registered.size}`);

const invokedBy = (html) =>
  new Set([...html.matchAll(/invoke\(\s*"([A-Za-z0-9_]+)"/g)].map((match) => match[1]));

for (const [file, html] of [
  ["desktop/ui/index.html", indexHtml],
  ["desktop/ui/meters.html", metersHtml],
]) {
  const invoked = invokedBy(html);
  assert.ok(invoked.size > 0, `${file} must invoke at least one command`);
  const missing = [...invoked].filter((name) => !registered.has(name)).sort();
  assert.deepEqual(
    missing,
    [],
    `${file} invokes commands that the backend does not register: ${missing.join(", ")}`,
  );
}

// --- Library rows and the 1..9 hotkey ------------------------------------

const rowClass = /row\.className = `macro-row/.test(indexHtml)
  ? "macro-row"
  : null;
assert.equal(rowClass, "macro-row", "renderMacroLibrary must keep rendering rows as `macro-row`");
assert.doesNotMatch(
  indexHtml,
  /#macro-library-list \.library-item/,
  "no selector may target the nonexistent `.library-item` class; rows are `macro-row`",
);
assert.match(
  indexHtml,
  /querySelectorAll\("#macro-library-list \.macro-row"\)/,
  "the 1..9 hotkey must select the real library rows",
);

// --- Meter style values --------------------------------------------------

assert.match(indexHtml, /<option value="win95_graph">/, "the meter style select must offer win95_graph");
for (const [file, html] of [
  ["desktop/ui/index.html", indexHtml],
  ["desktop/ui/meters.html", metersHtml],
]) {
  assert.doesNotMatch(
    html,
    /\.value = "history"/,
    `${file} must not assign the nonexistent meter style value "history"`,
  );
}

// --- Inspector reads real macro fields -----------------------------------

assert.doesNotMatch(
  indexHtml,
  /macro\.actions\?/,
  "the inspector must read macro.actionSteps, not macro.actions",
);
assert.doesNotMatch(
  indexHtml,
  /macro\.threshold\b/,
  "the inspector must read macro.triggerThreshold, not macro.threshold",
);
assert.doesNotMatch(
  indexHtml,
  /macro\.overlapStrategy\b/,
  "the inspector must read macro.macroOverlapStrategy, not macro.overlapStrategy",
);
assert.match(indexHtml, /macro\.actionSteps\?/, "the inspector must read macro.actionSteps");
assert.match(
  indexHtml,
  /macro\.macroOverlapStrategy/,
  "the inspector must read macro.macroOverlapStrategy",
);

// --- Test Action (Shoot) runs the real step dispatcher --------------------

// The shoot button used to call `send_osc_message` with the step's raw
// address/kind/value. That bypassed `execute_configured_show_action`, so a
// `toggle` step (which stores no value by design) sent a fixed value and never
// alternated, and `fade`/`delay`/HUD steps behaved differently from the macro.
assert.match(
  indexHtml,
  /invoke\(\s*"test_action_step"/,
  "Test Action (Shoot) must run the step through the backend dispatcher",
);
assert.doesNotMatch(
  indexHtml,
  /invoke\(\s*"send_osc_message"/,
  "Test Action (Shoot) must not send raw OSC; that loses the step mode",
);
assert.match(
  mainRs,
  /fn test_action_step\(/,
  "main.rs must implement the single-step test dispatcher",
);

// --- A new macro starts unconfigured --------------------------------------

// A new macro used to be born as `usb 1 meter -> /ch/1/mute`: it looked ready
// to listen and fire, and the operator could not tell it apart from a
// configured macro. The Rust normaliser used to paint the same defaults back on
// every save, so both sides must preserve an explicit empty value.
assert.match(
  indexHtml,
  /triggerCategory: "",\s*\n\s*triggerIds: "",\s*\n\s*triggerParameter: "",/,
  "the New macro button must create an unconfigured trigger",
);
assert.doesNotMatch(
  indexHtml,
  /triggerCategory\.value = config\.triggerCategory \|\| "usb"/,
  "applyConfig must not paint an unconfigured trigger back as usb",
);
assert.doesNotMatch(
  indexHtml,
  /actionAddress \|\| "\/ch\/1\/mute"/,
  "a blank step must not be rewritten to /ch/1/mute anywhere in the UI",
);
assert.match(
  mainRs,
  /fn macro_incomplete_reason\(/,
  "the backend must classify an unconfigured macro",
);
assert.match(
  mainRs,
  /skipped\.push\(format!\("\{\}: \{reason\}", config\.name\)\)/,
  "an unconfigured enabled macro must be skipped with a named warning, not fail the session",
);

// --- Windows are covered by a capability ---------------------------------

// Tauri v2: "If a webview or its window is not matching any capability then it
// has no access to the IPC layer at all." A window created by the Rust side but
// missing from the ACL cannot `listen` (so it never receives meter frames) nor
// call the window APIs it uses. That is exactly how the detached Meter Bridge
// shipped broken in 1.2.16: `capabilities/default.json` listed only `main`.
const createdWindows = [
  ...mainRs.matchAll(/WebviewWindowBuilder::new\(\s*&?\w+,\s*"([^"]+)"/g),
].map((match) => match[1]);
assert.ok(createdWindows.length > 0, "expected main.rs to create at least one extra window");

const capabilityDir = path.join(repoRoot, "desktop/src-tauri/capabilities");
const capabilityFiles = fs
  .readdirSync(capabilityDir)
  .filter((name) => name.endsWith(".json"));
assert.ok(capabilityFiles.length > 0, "expected at least one capability file");

const patterns = [];
const granted = new Set();
for (const file of capabilityFiles) {
  const capability = JSON.parse(fs.readFileSync(path.join(capabilityDir, file), "utf8"));
  patterns.push(...(capability.windows ?? []), ...(capability.webviews ?? []));
  for (const permission of capability.permissions ?? []) {
    granted.add(typeof permission === "string" ? permission : permission.identifier);
  }
}

const matchesPattern = (label, pattern) => {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return label.startsWith(pattern.slice(0, -1));
  return label === pattern;
};

// The implicit `main` window is declared in tauri.conf.json; check it too.
const config = JSON.parse(read("desktop/src-tauri/tauri.conf.json"));
const mainLabels = (config.app?.windows ?? []).map((window) => window.label ?? "main");
for (const label of [...mainLabels, ...createdWindows]) {
  assert.ok(
    patterns.some((pattern) => matchesPattern(label, pattern)),
    `window "${label}" is created but no capability covers it, so it has no IPC access`,
  );
}

// The detached window restores its geometry and toggles always-on-top, which are
// window writes; `core:window:default` only grants reads.
for (const permission of [
  "core:window:allow-set-always-on-top",
  "core:window:allow-set-position",
  "core:window:allow-set-size",
]) {
  assert.ok(
    granted.has(permission),
    `capabilities must grant ${permission}: the Meter Bridge window calls that API`,
  );
}

// --- Action modes stay in sync with the runtime --------------------------

// A mode offered by the editor must be a mode the runtime understands, and a
// toggle must never be treated as a plain set.
const actionModeOptions = [
  ...indexHtml.matchAll(/<select id="action-mode">([\s\S]*?)<\/select>/g),
]
  .flatMap((match) => [...match[1].matchAll(/<option value="([^"]+)"/g)])
  .map((match) => match[1]);
assert.ok(actionModeOptions.includes("toggle"), "the action editor must offer a toggle mode");
assert.match(
  mainRs,
  /"delay" \| "delay_set" \| "fade" \| "automation_cue" \| "hud_alert" \| "toggle"/,
  "normalize_action_mode must preserve the toggle mode instead of falling back to set",
);
assert.match(
  mainRs,
  /"toggle" => execute_toggle_step/,
  "the action executor must dispatch toggle to its own step, not to a plain send",
);

// --- A toggle is the console's own `-1`, and nothing else -----------------
//
// The defect the owner reported on 2026-10-05 (a macro that changed nothing, and a Shoot card reading
// `/ch/11/in/set/altsrc int=0`): a toggle step must put the documented `-1` on the wire and must not read
// the live value first. `git log -S` shows the runtime already sent `-1` — what made the read *look*
// present was a second, read-and-invert executor kept beside the real one as a "tested escape hatch"
// (release note 0.2.63) and called only from tests. It is gone, and these contracts hold the door shut,
// because nothing but their shape stands between this tree and that defect.
//
// 1. The executor sends `-1`, from the document, whatever value the step was authored with
//    (Maillot 3.1.0, "Special case: Toggle", scratch/wing_protocols.txt:782-789; `/ch/1/in/set/altsrc`
//    is a member of the class by the document's own channel table, line 1938: `I  0..1`).
const toggleExecutor = /fn execute_toggle_step\([\s\S]*?\n}/.exec(mainRs)?.[0] ?? "";
assert.ok(toggleExecutor.length > 0, "main.rs must implement the toggle executor");
assert.match(
  toggleExecutor,
  /toggled\.value = "-1"\.to_string\(\);/,
  "a toggle step must send the documented -1, never the value the step was authored with",
);
assert.match(
  toggleExecutor,
  /toggled\.native_toggle = true;/,
  "and it must be marked as the console's own flip, so no read-back is expected of it",
);
assert.doesNotMatch(
  toggleExecutor,
  /read_leaf_state|verify_step_applied|inverted_binary_state/,
  "the toggle path must not read the console first: no read, no wait, one packet",
);

// 2. Nothing that reads-then-inverts survives anywhere. The fallback wrote back a value the app had
//    computed, which is exactly the silent write-back Maillot's special case exists to avoid.
assert.doesNotMatch(
  mainRs,
  /execute_toggle_step_by_reading/,
  "the read-and-invert toggle executor must not come back",
);
assert.doesNotMatch(
  mainRs,
  /fn inverted_binary_state/,
  "and neither must the inversion it computed here",
);

// 3. A native toggle is not read back: the console decided the result, so there is no expected value and
//    nothing on that path subscribes to or waits for a read.
const expectedValueToVerify = /fn expected_value_to_verify\([\s\S]*?\n}/.exec(mainRs)?.[0] ?? "";
assert.ok(expectedValueToVerify.length > 0, "main.rs must decide which writes are read back");
assert.match(
  expectedValueToVerify,
  /if step\.native_toggle \{\s*return None;/,
  "a native toggle must have no expected value: a read-back of the flip is impossible and must not run",
);
// The Rust test is where the body itself is proved; this asserts that proof still exists and still looks
// at the bytes rather than only at the number the fake console decoded.
assert.match(
  mainRs,
  /outcome\.sent\.packet_hex,\s*\n\s*hex\(&documented\)/,
  "the native-toggle test must assert the message body byte for byte, not only the decoded value",
);

// 4. What the operator reads says what left. The Shoot card, its dialogs and the session log all go
//    through `actionWireText`, which prints the toggle's `-1` and never the value the step stores — the
//    card is what showed the owner `/ch/11/in/set/altsrc int=0` for a packet carrying `,i -1`.
assert.match(
  indexHtml,
  /function actionWireText\(mode, address, argKind, value\)/,
  "the window needs one place that says what a step puts on the wire",
);
assert.match(
  indexHtml,
  /if \(String\(mode \|\| ""\) === "toggle"\) return `\$\{where\} toggle \(-1\)`;/,
  "and for a toggle that line is the address and `toggle (-1)`",
);
assert.match(
  indexHtml,
  /actionText = actionWireText\(noticeMode, noticeAddress, kind, value\);/,
  "the Shoot card must print the wire text, not the stored value",
);
assert.doesNotMatch(
  indexHtml,
  /actionText = `\$\{noticeAddress \|\| '\(no action target\)'\} \$\{kind\}=\$\{value\}`;/,
  "the card must not print `${kind}=${value}`: that is the report that showed int=0 for a -1 packet",
);

// 5. A toggle still needs an on/off parameter the console reports, and the refusal says why. This is the
//    half that keeps a `-1` honest: a step that cannot be a toggle is **refused with a reason**, never
//    quietly run as a write of whatever value it stores — which is how the operator's parameter came out
//    as `int=0`.
assert.match(
  mainRs,
  /toggle needs an on\/off parameter; \{\} is not one\./,
  "the validator must still refuse a toggle on a parameter that is not on/off",
);
assert.match(
  mainRs,
  /no state to flip; use Set\./,
  "and one on a command the console never reports, naming the reason instead of writing a value back",
);

// --- The macro summary: two drawings of the same recipe --------------------
// The operator asked for a second, clearer way to read WHEN / IF / THEN, chosen in Settings. Both
// presentations must exist, the choice must be a preference, and the sentences the rest of the
// window reads must never go away: they are what the cards are built from.
const summarySelect = /<select id="settings-macro-summary">([\s\S]*?)<\/select>/.exec(indexHtml)?.[1] ?? "";
const summaryOptions = [...summarySelect.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(
  summaryOptions,
  ["lines", "blocks"],
  "Settings must offer the classic lines and the cards for the macro summary",
);
for (const id of ["recipe-trigger", "recipe-condition", "recipe-action"]) {
  assert.match(
    indexHtml,
    new RegExp(`<strong id="${id}">`),
    `the ${id} sentence must stay: the cards and the rest of the window read it`,
  );
}
for (const id of ["recipe-trigger-detail", "recipe-condition-detail", "recipe-action-detail"]) {
  assert.match(indexHtml, new RegExp(`id="${id}"`), `the cards need their own container (${id})`);
}
assert.match(
  indexHtml,
  /body\.macro-summary-blocks \.recipe-detail \{\s*display: block;/,
  "the cards class must be what reveals the structured detail",
);
assert.match(
  indexHtml,
  /function applyMacroSummary\(style\)/,
  "the summary style must be applied through one function",
);
assert.match(
  indexHtml,
  /localStorage\.setItem\("wing_macro_summary", chosen\)/,
  "and the choice must be remembered",
);
assert.match(
  indexHtml,
  /applyMacroSummary\(localStorage\.getItem\("wing_macro_summary"\) \|\| "lines"\)/,
  "and applied at boot, defaulting to the classic lines",
);
assert.match(
  indexHtml,
  /renderMacroRecipeDetails\(config\);/,
  "the cards must be painted from the same config as the sentences",
);

console.log("desktop UI contracts passed");

// --- Meter watchlist: it starts empty and the only list action is Clear ----
// Two decisions that were reversed before and must not come back: the watchlist
// used to seed USB 1-3 on a fresh install, and a "Reset list" button restored it
// next to Clear, so the two buttons meant nearly the same thing.
assert.ok(
  !indexHtml.includes("btn-reset-meters"),
  "the meters panel must not bring back the Reset list button: Clear is the only list action",
);
assert.ok(
  !/DEFAULT_METERS_WATCHLIST\s*=\s*\[[^\]]*usb/.test(indexHtml),
  "the main window must not seed a default USB watchlist",
);
assert.match(
  indexHtml,
  /First run: nothing is metered until the operator adds channels/,
  "the first-run branch of the main window must leave the watchlist empty",
);
assert.ok(
  !/watchlist = \[\s*\{\s*group: "usb"/.test(metersHtml),
  "the meter bridge must not seed a default USB watchlist either",
);
// Clear keeps its confirmation, or it would wipe a carefully built meter page on a stray click.
assert.match(
  indexHtml,
  /btnClear\?\.addEventListener\("click", async \(\) => \{[\s\S]{0,240}win95Confirm\(/,
  "Clear must keep asking before it drops every meter",
);

// --- No native dialogs: WKWebView has no delegate, so confirm() returns false ---------------
// Every confirmation written with `window.confirm()` silently cancelled its action in the packaged
// app: meters Clear, Panic Stop, the backup restore and "Replace & View" were all dead buttons.
const withoutComments = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
for (const [file, html] of [
  ["desktop/ui/index.html", withoutComments(indexHtml)],
  ["desktop/ui/meters.html", withoutComments(metersHtml)],
]) {
  const calls = [...html.matchAll(/(^|[^.\w])(?:window\.)?confirm\s*\(/g)].map((match) => match.index);
  assert.deepEqual(
    calls,
    [],
    `${file} must not call the native confirm(): the packaged app returns false and the action is cancelled`,
  );
}
assert.match(indexHtml, /function win95Confirm\(/, "the main window must own a Win95 confirm dialog");
assert.match(metersHtml, /function metersConfirm\(/, "the bridge must own a Win95 confirm dialog");

console.log("meter watchlist contracts passed");

// --- The brand block is a label, only the logo is a button ---------------
// The icon-plus-name block kept the pointer cursor, the raised hover and the
// pressed state after About moved to the logo alone, so it still read as one big
// button that did nothing.
const brandRule = /\.master-brand\s*\{([\s\S]*?)\}/.exec(indexHtml)?.[1] ?? "";
assert.ok(brandRule.length > 0, "the .master-brand rule must exist");
assert.ok(
  !/cursor:\s*pointer/.test(brandRule),
  "the brand label block must not use the pointer cursor: only the logo is clickable",
);
for (const pseudo of [":hover", ":active", ":focus-visible"]) {
  assert.ok(
    !indexHtml.includes(`.master-brand${pseudo}`),
    `.master-brand${pseudo} must be gone: the label block must not react like a button`,
  );
}
assert.match(
  indexHtml,
  /<div class="brand-logo-wrap" id="brand-logo-button" role="button" tabindex="0"/,
  "the logo must stay the real button, with role and keyboard focus",
);
assert.ok(
  !/getElementById\("master-brand"\)|querySelector\('\.master-brand'\)[\s\S]{0,80}addEventListener/.test(indexHtml),
  "no click handler may be attached to the brand label block",
);

console.log("brand block contracts passed");

// --- Every Tauri window API the UI calls must be permitted ------------------
// 1.2.21 shipped a click-to-edit fix whose `setFocus()` call was rejected by Tauri's permission
// system (the capability only allowed set-always-on-top, set-position and set-size) and the rejection
// was swallowed, so the fix did nothing at all. Nothing compared the two sides before this.
const windowCapabilities = JSON.parse(read("desktop/src-tauri/capabilities/default.json"));
const windowPermissionsGranted = new Set(windowCapabilities.permissions);
const windowApiPermissions = {
  setAlwaysOnTop: "core:window:allow-set-always-on-top",
  setPosition: "core:window:allow-set-position",
  setSize: "core:window:allow-set-size",
  setFocus: "core:window:allow-set-focus",
  setResizable: "core:window:allow-set-resizable",
  setTitle: "core:window:allow-set-title",
  setFullscreen: "core:window:allow-set-fullscreen",
  maximize: "core:window:allow-maximize",
  unmaximize: "core:window:allow-unmaximize",
  minimize: "core:window:allow-minimize",
  show: "core:window:allow-show",
  hide: "core:window:allow-hide",
  center: "core:window:allow-center",
  startDragging: "core:window:allow-start-dragging",
  setIgnoreCursorEvents: "core:window:allow-set-ignore-cursor-events",
  setDecorations: "core:window:allow-set-decorations",
  setAlwaysOnBottom: "core:window:allow-set-always-on-bottom",
};
const missing = [];
for (const [file, html] of [
  ["desktop/ui/index.html", indexHtml],
  ["desktop/ui/meters.html", metersHtml],
]) {
  for (const [method, permission] of Object.entries(windowApiPermissions)) {
    // Optional chaining is the house style here (`?.setFocus?.(...)`), so the call may read
    // `.setFocus(`, `.setFocus?.(` or `?.setFocus?.(`.
    const used = new RegExp(`\\.${method}\\??\\.?\\(`);
    if (!used.test(html)) continue;
    // `setAlwaysOnTop` appears on both windows; one grant covers both because the capability lists
    // both window labels.
    if (!windowPermissionsGranted.has(permission)) missing.push(`${file} calls ${method}() but ${permission} is not granted`);
  }
}
assert.deepEqual(missing, [], `the frontend must be allowed to call every window API it uses: ${JSON.stringify(missing)}`);
assert.ok(
  windowPermissionsGranted.has("core:window:allow-set-focus"),
  "setFocus must stay granted: without it the click-to-edit fix cannot make the window key",
);

// `onCloseRequested` is closed by Tauri's own JS wrapper, which calls `destroy()` on the window
// afterwards. Without `core:window:allow-destroy` that call is rejected and the window simply never
// closes, which is why the app could only be force-quit.
if (/onCloseRequested/.test(indexHtml)) {
  assert.ok(
    windowPermissionsGranted.has("core:window:allow-destroy"),
    "a window that listens for onCloseRequested must be allowed to destroy() itself",
  );
}

console.log("window API permission contracts passed");

// --- "Only meters" governs its own card, not the window --------------------
// The button lives in the header of the Meters card: it hides THAT card's configuration
// (view strip, adding channels and banks) and nothing else. The first version hid the builder,
// the seam and the other cards —a whole window missing pieces—, which is not what the button
// promises. The static contract watches the shape of the CSS block; the real behaviour
// (measured with rectangles) is covered by `test-desktop-diagnostics-blocks-browser.mjs`.
const metersSoloBlock = /body\.meters-solo[^{]*\{([^}]*)\}/g;
const metersSoloRules = [...indexHtml.matchAll(metersSoloBlock)].map((match) => match[0]).join("\n");
assert.ok(metersSoloRules.length > 0, "the Only meters mode must have CSS rules");
for (const selector of [".meter-view-strip", ".meter-ingest-panel"]) {
  assert.ok(
    metersSoloRules.includes(selector),
    `Only meters must hide ${selector} (the card's own controls)`,
  );
}
for (const forbidden of [".builder-column", ".column-resizer", ".ops-column > .card-draggable", ".master-stats"]) {
  assert.ok(
    !metersSoloRules.includes(forbidden),
    `Only meters must not hide ${forbidden}: the button belongs to the meters card, not to the window`,
  );
}
// Banks are shared and each window PICKS its own: the dock's selector lists the same
// groups as the bridge (which is where they are created, renamed and updated) and each window
// remembers its own choice, so that what one shows does not depend on the other.
assert.match(indexHtml, /id="meter-bank-select"/,
  "the workstation must offer the shared bank selector");
assert.match(indexHtml, /wing_dock_bank/, "the workstation must remember its own bank choice");
assert.match(indexHtml, /wing_meters_bank/, "the bridge must keep its own bank choice (meters.html)");
assert.match(indexHtml, /function subscriptionMeters\(\)/,
  "a bank broader than the watchlist must still be subscribed, or it would show no data");
assert.ok(
  !/btn-meter-bank-(save|rename|update|delete)/.test(indexHtml),
  "creating, renaming, updating and deleting banks stays in the Meter Bridge",
);
assert.match(
  indexHtml,
  /data-diag-chevron="probe"/,
  "the Probe block must be collapsible too (it was the only one without a chevron)",
);
assert.match(
  indexHtml,
  /data-diag-body="probe"/,
  "the Probe block must expose a body the chevron can collapse",
);
// The OSC monitor keeps its header inside the section: if the generic rule hid it whole,
// the chevron would go with it and the block could not be opened again.
assert.match(
  indexHtml,
  /\.diag-body > \.is-collapsed:not\(#osc-monitor-section\)/,
  "the OSC section must be excluded from the generic collapse rule so its chevron stays reachable",
);
assert.match(
  indexHtml,
  /#osc-monitor-section\.is-collapsed \.osc-monitor-footer/,
  "collapsing the OSC block must hide its parts (header, filter bar, terminal, footer), not the section",
);

// --- The no-target refusal speaks the step row's language -------------------
//
// The owner's enable dialog said `Step 2: no action address.` while the step row said
// `Buses — Not configured — Mute`, and he had to ask which one meant the other (owner report,
// 2026-10-05). Three properties keep the two vocabularies from drifting apart again, and the fourth
// keeps the same fact from being printed twice:
//
//   1. the refusal quotes the editor's own placeholder, from the one literal the window draws;
//   2. it takes the category and parameter labels from the catalogue the window reads, so the row
//      it quotes is the row the editor draws;
//   3. it is the *only* copy of the rule, so `preflight_config` cannot print a second line for it.
const notConfiguredInEditor = /const NOT_CONFIGURED_LABEL = "— Not configured —";/.exec(indexHtml);
assert.ok(
  notConfiguredInEditor,
  "the editor must keep one literal for the unchosen target state (NOT_CONFIGURED_LABEL)",
);
assert.match(
  mainRs,
  /const NOT_CONFIGURED_LABEL: &str = "— Not configured —";/,
  'the backend refusal must quote the editor\'s own "— Not configured —", not a second word for it',
);
assert.match(
  mainRs,
  /fn missing_action_target_problem/,
  "the no-target reason must live in one named helper both the validator and the Shoot button reach",
);
assert.match(
  mainRs,
  /problems\.push\(missing_action_target_problem\(label, step\)\);/,
  "action_step_problems must refuse an empty action address through that shared reason",
);
assert.match(
  mainRs,
  /target_categories\(\)/,
  "the reason must take the category label from the catalogue the window reads, not a hand-written list",
);
assert.match(
  mainRs,
  /target_parameters_for_category\(category\)/,
  "and the parameter label from that same catalogue, so the quoted row matches the editor's",
);
// The single-line half: the preflight's own address rules must apply only to an address the operator
// gave. An empty one is the validator's reason (`missing_action_target_problem`), reached through
// `validate_macro_config`; a second push beside it is what made the dialog print the same fact
// twice. The behaviour is asserted in the Rust suite; this is the source shape that keeps it so.
assert.match(
  mainRs,
  /if !raw_address\.is_empty\(\) && !raw_address\.starts_with\('\/'\) \{/,
  "the preflight's address rules must apply only to an address the operator gave: an empty address is the validator's reason, printed once",
);

console.log("Only meters and Diagnostics block contracts passed");

// --- Every constructed write of the cue list comes from the one home -------------------------------
// `set_timecode_cues` is written from **five** call sites across three windows (it was six until 2026-10-07, when the
// settings page stopped being an editor and became a read-only summary — the sixth writer is gone with the Save
// button), and the backend's `sort` **and** `drive` fields each have a default. So a payload built by hand that forgot
// one would not fail: it would quietly replace the operator's order with `smpte`, or put a **sequential** show back on
// the clock — and installing a list re-arms the engine as well. That is not hypothetical. Until 2026-10-07 the clock
// window and the macro editor each forgot `drive`, while a comment beside the settings page claimed "sort and drive
// are in every write from every window".
//
// The rule has one home (`CUE.cueListPayload` in `cue-list.js`) and this is its contract: no window may build a
// payload by hand. A hand-built one is recognisable by its `schema_version`, and the slice checked is exactly the
// `invoke` call, so this cannot fail for something written after it. The two writers that legitimately build nothing
// — the station-backup restore and its rollback — pass back a whole document the backend itself produced, which
// carries both fields by construction and contains no `schema_version` literal of its own.
//
// The floor below is deliberately loose rather than an exact count: its job is to catch a walk that stopped finding
// anything, so it must not have to be edited every time a writer is added or removed. What keeps the count honest is
// the message, which names what was expected and why the number moved.
const uiWindows = fs.readdirSync(path.join(repoRoot, "desktop/ui"))
  .filter((name) => name.endsWith(".html"))
  .map((name) => [`desktop/ui/${name}`, read(`desktop/ui/${name}`)]);
let cueWriteSites = 0;
for (const [file, html] of uiWindows) {
  // `invoke(` is matched, not the bare name: the name also appears in prose inside comments, and a slice taken from a
  // comment would run on into unrelated code and fail for the wrong reason.
  for (const match of html.matchAll(/invoke\("set_timecode_cues"/g)) {
    const end = html.indexOf("});", match.index);
    const call = html.slice(match.index, end === -1 ? match.index + 400 : end);
    cueWriteSites += 1;
    assert.doesNotMatch(
      call,
      /schema_version\s*:/,
      `${file}: a write of the cue list builds its own payload — every constructed payload must come from CUE.cueListPayload, or it silently drops a field the backend has a default for (sort, drive)`,
    );
  }
}
assert.ok(
  cueWriteSites >= 4,
  `the guard must be looking at the writes it thinks it is (found ${cueWriteSites} invoke sites; five are expected since the settings page stopped writing — see the comment above)`,
);
console.log(`cue list write contracts passed (${cueWriteSites} write sites, none building its own payload)`);

// --- The cue row's look has ONE home, and a window may not take it back -----------------------------
// `cue-list.js` creates the row's elements and now also styles them, because the look was written by hand in two
// windows and the two copies had drifted — the line gap was 6px in one and 4px in the other, one marked a clashing
// cue's time and the other did not, and only one drew the time field with the application's etched border. A third
// window (`ltc.html`) had written none of it, so nine of the ten classes a row is made of had no rule there at all and
// its rows ran together (measured 2026-10-07; fixed in the commit that added the module's row block).
//
// **AND THIS GUARD CANNOT SEE THE DEFECT THE OWNER FOUND.** On 2026-10-08 a screenshot showed the LTC window's fields
// starting at a different x on every row, with every suite green and this guard passing. The cause was a property this
// check has no way to express: the module's `.cue-row` is a column flex, and the WINDOW's `.cue-dense` inside it was
// right-aligned with `margin-left: auto` — two classes, two files, ONE VISUAL ROW, and its alignment is joint. A
// source guard can say who declares a class; it cannot say that a declaration in one file and a declaration in another
// cancel each other out. **Section 26 of `test-desktop-ltc-window-browser.mjs` measures the rendered x of each column,
// because a coordinate is the only thing that can hold a property two files share.**
//
// The module cannot stop a window re-writing what it now owns, so this is the guard. The match is **anchored to the
// start of a line**, and that anchoring is the whole difference between catching the drift and failing for the wrong
// reason: a CSS rule for `.cue-line` starts a line with it, while the JavaScript that legitimately mentions the class
// does not — `row.querySelector(".cue-line")` lives in `index.html` and must not be mistaken for a second home.
const rowClasses = ["cue-row", "cue-line", "cue-at", "cue-name", "cue-number", "cue-tags", "cue-tag",
  "cue-buttons", "cue-editor", "cue-sep"];
const rowRule = new RegExp(`^[ \\t]*\\.(${rowClasses.join("|")})[ \\t]*\\{`, "m");
for (const [file, html] of uiWindows) {
  const found = html.match(rowRule);
  assert.equal(
    found,
    null,
    `${file}: a window declares a CSS rule for ".${found?.[1]}" — the cue row's look lives in cue-list.js beside the elements it creates, and a copy here is a rule written by hand in several places, which is how the two copies drifted the first time`,
  );
}
// And the module must still own it: a guard that passes because nobody styles the row is not a guard.
const cueModule = read("desktop/ui/cue-list.js");
assert.match(
  cueModule,
  /function installRowStyles\(\)/,
  "cue-list.js must still install the row's look itself, or this guard is passing because nothing styles a row at all",
);
assert.match(
  cueModule,
  /installRowStyles\(\);/,
  "and it must actually be called at load, not merely defined",
);
console.log(`cue row home contracts passed (${uiWindows.length} windows, none re-declaring the row's ${rowClasses.length} classes)`);

// **The other half of "one place": the row furniture a WINDOW owns.** `cue-dense` and the dense cells belong to the LTC
// window, and that is fine - but they lay out the shared row, so they must live in exactly one window. A second window
// writing them is how the two copies this whole arrangement exists to prevent would start.
{
  const furniture = /^[ \t]*\.(cue-dense|dense-[a-z]+)[ \t]*\{/m;
  const owners = [];
  for (const [file, html] of uiWindows) if (furniture.test(html)) owners.push(file);
  assert.deepEqual(
    owners,
    ["desktop/ui/ltc.html"],
    `the dense row's furniture lays out the shared row, so exactly one window may own it - and a second owner is how the two copies the module's block exists to prevent would start (found: ${JSON.stringify(owners)})`,
  );
  assert.ok(furniture.test(read("desktop/ui/ltc.html")), "and it must actually be there, not merely allowed");
  console.log("dense row furniture contracts passed (owned by the LTC window alone)");
}

// --- The one write door announces the list, and all three windows hear it ---------------------------
// Three surfaces edit one cue file and, until 2026-10-07, each read it once at open and never again: a save in one
// left the other two showing a list the engine no longer had, for as long as the show lasted.
//
// The windows' halves are contracted in their own browser suites, and those contracts **deliver the event
// themselves** — so they prove what a window DOES with it and nothing about whether the backend sends one. This is
// that other half, and it is a **source shape rather than a measurement**: a shape, not a runtime fact, and said so
// here because the difference matters in this repository. What makes it worth having is that it is pinned to the ONE
// door every write goes through — the save, the three adds, the import and the station-backup restore — so a second
// place that installed a list without announcing it is what a reader would have to add deliberately.
const installFn = mainRs.slice(mainRs.indexOf("fn install_timecode_cues("));
const installBody = installFn.slice(0, installFn.indexOf("\n}\n"));
assert.match(
  installBody,
  /app\.emit\("timecode-cues-changed"/,
  "install_timecode_cues must announce the list it installed: it is the one door every cue write goes through, and without the announcement the other two windows keep showing a list the engine no longer has",
);
assert.match(
  installBody,
  /app\.emit\("timecode-cues-changed",\s*&cues\)/,
  "and it must carry the list it installed, not a bare fact — the window that saved hears its own echo while its invoke is still in flight, and only the payload lets it tell that from somebody else's change",
);
for (const window of ["index.html", "timecode.html", "ltc.html"]) {
  const html = read(`desktop/ui/${window}`);
  assert.match(
    html,
    /"timecode-cues-changed"/,
    `${window} must listen for the list changing in another window: all three surfaces edit the same file, so a save in one has to reach the others`,
  );
}
console.log("cue list announcement contracts passed (one emitting door, three windows listening)");

// --- The engine's two locks are taken in ONE order, everywhere ------------------------------
//
// **This is a deadlock guard, and it is here because the application froze nothing but a test would have caught it
// anyway.** The engine has two mutexes that the hot paths both want: `cues` (the list) and `deliveries` (the ledger).
// `snapshot_at` takes `cues` and then `deliveries`, holding both — and every window calls it four times a second.
// The as-run record's first version had `announce` take `deliveries` and then `cues`, to look up the number of the
// cue it was recording. **That is the same two locks in the opposite order**: the 250 ms poll and the firing path
// crossing would leave each holding what the other wants, and the application would stop — mid-show, silently, with
// no error anywhere.
//
// The fix reads the numbers before the ledger is locked, so both functions take `cues` first. This asserts the
// order **structurally**, because the alternative is a test that deadlocks: a hanging test is a loud failure in a
// gate and a miserable one in a suite somebody is running by hand, and the property is visible in the source.
//
// It walks every function that takes both and fails on any that takes `deliveries` first. A function that grows a
// second lock later is covered the day it does, which is the point: the guard is about the SHAPE, not about the two
// functions that happen to have it today.
const timecodeRs = read("desktop/src-tauri/src/timecode.rs");
{
  // **Every pair of locks, not only the two that happened to be wrong.** The engine takes three: `cues`,
  // `deliveries` and `as_run`. A guard that watched one pair would let the next lock in invert against either of the
  // other two, and the shape of the failure — a silent stop mid-show — is the same whichever pair it is.
  const LOCKS = ["self.cues.lock()", "self.deliveries.lock()", "self.as_run.lock()"];
  const lines = timecodeRs.split("\n");
  let fn = null;
  let first = {};
  const pairs = [];
  const close = () => {
    const taken = Object.keys(first);
    for (let i = 0; i < taken.length; i += 1) {
      for (let j = i + 1; j < taken.length; j += 1) {
        pairs.push({ fn, a: taken[i], b: taken[j], aAt: first[taken[i]], bAt: first[taken[j]] });
      }
    }
    fn = null;
    first = {};
  };
  lines.forEach((line, index) => {
    if (/^    (pub )?fn /.test(line)) {
      close();
      fn = line.trim().replace(/^pub fn /, "fn ").split("(")[0];
    }
    for (const lock of LOCKS) {
      if (first[lock] === undefined && line.includes(lock)) first[lock] = index;
    }
  });
  close();
  // For each unordered PAIR, every function that takes both must take them in the same relative order. One pair with
  // two orders is a deadlock waiting for the right interleaving, which is exactly what happened here.
  const orders = new Map();
  for (const pair of pairs) {
    const key = [pair.a, pair.b].sort().join(" | ");
    const order = pair.aAt < pair.bAt ? pair.a + " then " + pair.b : pair.b + " then " + pair.a;
    if (!orders.has(key)) orders.set(key, new Map());
    const byOrder = orders.get(key);
    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order).push(pair.fn);
  }
  const inverted = [];
  for (const [key, byOrder] of orders) {
    if (byOrder.size > 1) {
      const described = [...byOrder].map(([order, fns]) => order + " (in " + fns.join(", ") + ")").join(" BUT ");
      inverted.push(key + ": " + described);
    }
  }
  assert.deepEqual(
    inverted,
    [],
    `the engine takes two locks in different orders in different functions — the poll and the firing path would deadlock and the application would stop mid-show: ${inverted.join("; ")}`,
  );
  const watched = [...orders.keys()].length;
  assert.ok(
    watched >= 1,
    `the guard must be looking at the locks it thinks it is: it found ${watched} pair(s) taken together and the poll and the firing path are one`,
  );
  console.log(`engine lock order passed (${watched} lock pair(s) taken together, each in one order everywhere)`);
}

// --- No disk write on a driver callback -----------------------------------------------------
//
// **D9, and it is a structural guard for the same reason the lock guard is one**: the property is visible in the
// source, and the alternative is a test that would have to observe a timing violation.
//
// The shape of the defect it prevents: the as-run record was flushed from **CoreMIDI's callback**, because that is
// where the MTC positions arrive — and the file containing that callback says, three lines above it, *"nothing is
// fired from here: running a macro on this thread would put a show's work in a driver callback."* A file write is a
// show's work by that definition, and the first build of the record did exactly that.
//
// The fix moved the flush to the position sink's consumer thread, which is installed once for the life of the
// application. So three things must stay true, and each is asserted where it lives:
//
//   1. the flush does **not** appear in the MIDI callback's file at all;
//   2. the sink is installed by a named function, so "installed once, unconditionally" is a thing that exists;
//   3. and that function is called from `setup` — an unused installer is how this would go quiet again.
// **A LIST of the files that are driver callbacks, and the flush must appear in none of them.** The first version of
// this guard named `inter_app_midi.rs` alone — **the file that had the bug** — and did not look at `ltc_device.rs`,
// **the file with the same bug**, which was found the next day: the LTC flush ran inside `feed_block`, which the cpal
// stream callbacks call (`:883`, `:898`, `:913`, `:928`). A guard that names one file is a guard that will name one
// file, so this one names every file a driver calls into and fails if the flush appears in any of them. A third
// transport is covered by adding a line here rather than by remembering.
const DRIVER_CALLBACK_FILES = [
  ["desktop/src-tauri/src/inter_app_midi.rs", "CoreMIDI's callback"],
  ["desktop/src-tauri/src/ltc_device.rs", "the cpal stream callbacks"],
];
for (const [file, what] of DRIVER_CALLBACK_FILES) {
  const source = read(file);
  assert.doesNotMatch(
    source,
    /flush_timecode_as_run_for/,
    `the as-run record must NOT be flushed from ${what} (${file}): that thread belongs to a driver, and a disk write is a show's work — the flush rides the position sink's consumer thread instead (D9, D10)`,
  );
}
assert.match(
  mainRs,
  /fn install_position_sink\(/,
  "the position sink must be installed by a named function, because 'installed once for the life of the application' is the property D9 rests on and it has to be something a reader can find",
);
assert.match(
  mainRs,
  /install_position_sink\(&state\)/,
  "and that function must actually be CALLED from startup: an unused installer would leave the record with no thread that may write, which is the state D9 was written to end",
);
console.log(`driver-callback contracts passed (no record flush in ${DRIVER_CALLBACK_FILES.length} driver-callback files, sink installed from startup)`);

// --- Every field a stub invents must exist in the Rust DTO it stands for ---------------------
//
// **The mechanism behind several defects this session found, named by the verification pass that found them.** A browser
// suite cannot start a backend, so it STUBS the wire shape - and a stub is therefore a second declaration of the Rust
// DTO, written by hand, in a file nothing compares with `timecode.rs`. It has already produced two defects, both in code
// written the same day:
//
//   * `renderLastRun` read `line.label`, which `AsRunLine` has never had - dead in production, alive only because the
//     stub fabricated it;
//   * `skipReason` tested `across_silence === null`, while the struct's `Option` carries
//     `skip_serializing_if = "Option::is_none"`, so the real record **omits the key** and JavaScript sees `undefined`.
//     The stub's explicit `null` - a value the backend cannot produce - is what kept the contract green.
//
// **So this asserts the one direction that catches both: no field a stub writes may be absent from the struct it stands
// for.** The other direction is deliberately not asserted: a struct field the stub omits is a suite that has not needed
// it yet, which is a gap rather than a lie. **A stub that mentions a field the record never carries is a stub that will
// keep a wrong window green**, and that is the shape to refuse.
{
  // The struct's own fields, read from its declaration up to the closing brace at column 0.
  const structStart = timecodeRs.indexOf("pub struct AsRunLine {");
  assert.ok(structStart > 0, "AsRunLine must be declared in timecode.rs for this contract to mean anything");
  const structBody = timecodeRs.slice(structStart, timecodeRs.indexOf("\n}", structStart));
  const declared = new Set([...structBody.matchAll(/^\s*pub ([a-z_][a-z0-9_]*):/gm)].map((m) => m[1]));
  assert.ok(declared.size >= 8, `the struct must have been parsed, not guessed at (found ${declared.size} fields)`);

  // **Scoped to the ONE case that stands for an `AsRunLine`, and that scoping is part of the contract.** A first
  // version took every `{ seq: … }` line in the file and reported five fields - but `kind`, `position` and
  // `delta_frames` belong to the DELIVERY LEDGER's fixture (`StampedCueEvent`, a different struct with different
  // fields), and a guard that mixes two structs is a guard whose failures cannot be believed. So it takes the lines of
  // the `timecode_as_run` case alone.
  const source = read("scripts/test-desktop-ltc-window-browser.mjs");
  const caseStart = source.indexOf('case "timecode_as_run": return [');
  assert.ok(caseStart > 0, "the as-run fixture must exist for this contract to mean anything");
  const caseEnd = source.indexOf("];", caseStart);
  const invented = new Set();
  for (const line of source.slice(caseStart, caseEnd).split("\n")) {
    if (!/^\s*\{ seq: \d+,/.test(line)) continue;
    for (const m of line.matchAll(/([a-z_][a-z0-9_]*):/g)) invented.add(m[1]);
  }
  assert.ok(invented.size >= 5, `the fixtures must have been parsed (found ${invented.size} written fields)`);
  const notInTheStruct = [...invented].filter((field) => !declared.has(field)).sort();
  assert.deepEqual(
    notInTheStruct,
    [],
    `a suite fixture writes ${notInTheStruct.join(", ")}, which AsRunLine does not declare - so the window is being tested against a wire shape the backend cannot produce, and a window that reads that field stays green while being dead in production`,
  );
  console.log(`as-run fixture contracts passed (${invented.size} written fields, all declared in the struct's ${declared.size})`);
}

// --- A number the operator reads must be the number the engine has ----------------------------
//
// **The fifth invented detail this session corrected was a number in prose, and the four before it were the same
// shape**: a figure written from memory, in the present tense, in more than one place, with nothing comparing it to the
// thing it describes. The worst of them was `~189-field DTO`, written in TWO files to justify a decision, where the
// struct has **37** fields (both copies agreed with each other and neither with the struct). This one is the same shape
// with a CORRECT number today:
//
//   `timecode.rs:806`  `pub const AS_RUN_LINES: usize = 2_000;`
//   `ltc.html:297`     the Last run button's tooltip: "…because it is up to 2 000 lines."
//
// The tooltip is **operator-visible** and cannot be derived from Rust at runtime, so it is a copy by necessity - which
// is exactly when a copy needs a contract. Change the constant and this fails naming both numbers.
{
  const constMatch = timecodeRs.match(/pub const AS_RUN_LINES: usize = ([0-9_]+);/);
  assert.ok(constMatch, "AS_RUN_LINES must be declared for this contract to mean anything");
  const asRunLines = Number(constMatch[1].replace(/_/g, ""));
  const html = read("desktop/ui/ltc.html");
  // The tooltip's own phrasing, and the number inside it, with the thin-space grouping the window uses.
  const tooltip = html.match(/id="last-run-show"[\s\S]{0,400}?title="([^"]+)"/);
  assert.ok(tooltip, "the Last run button and its tooltip must exist");
  const stated = tooltip[1].match(/([0-9][0-9 ]*[0-9])\s*lines/);
  assert.ok(stated, `the tooltip must state how many lines the record keeps, so the operator knows the bound (it said: ${tooltip[1]})`);
  const statedNumber = Number(stated[1].replace(/ /g, ""));
  assert.equal(
    statedNumber,
    asRunLines,
    `the tooltip tells the operator the record keeps ${statedNumber} lines while the engine keeps ${asRunLines} - a number the operator reads must come from the constant, and an HTML tooltip cannot, so this is the contract that keeps the two copies equal`,
  );
  // The same number in the operator's guide, which is the copy he reads before he ever presses the button.
  const guide = read("docs/guide/13-timecode.md");
  const inGuide = guide.match(/keeps the last ([0-9][0-9 ]*[0-9]) lines/);
  assert.ok(inGuide, "the guide must state how many lines the record keeps, because that is where an operator learns the bound");
  assert.equal(
    Number(inGuide[1].replace(/ /g, "")),
    asRunLines,
    `the guide tells the operator the record keeps ${inGuide[1]} lines while the engine keeps ${asRunLines} - every copy of a number the operator can read must agree with the constant, and there are three`,
  );
  console.log(`operator-visible number contracts passed (the tooltip and the guide both say ${asRunLines})`);
}

// --- One timecode parser, and it is the tree's ------------------------------------------------
//
// **main.rs states the rule in its own words**: the backend parser "is the only timecode parser in the tree, and the
// window is not allowed a second one". MEASURED 2026-10-08: that sentence was false. `index.html:26138` carried its
// own, and a MORE PERMISSIVE one - `\d+` per field accepted `1:2:3:4` and `000:00:00:99`, which the module's own
// `\d{1,2}` refuses - and it stored a cue from them. Five callers in three windows already used
// `CUE.parsePositionText`; that was the only surface that did not, and it was fixed in `b3c16651`.
//
// **So this counts the parsers rather than naming the file that had one**, which is the lesson the driver-callback
// guard cost a day to learn: a guard that names one file is a guard that will name one file. Every window file is
// walked, and the tree must contain exactly ONE regex shaped like a timecode - the module's.
{
  const windows = ["desktop/ui/cue-list.js", "desktop/ui/index.html", "desktop/ui/ltc.html", "desktop/ui/timecode.html"];
  const found = [];
  for (const file of windows) {
    const text = read(file);
    for (const line of text.split("\n")) {
      // A regex that reads hours, minutes, seconds and frames out of one string is a timecode parser, wherever it sits.
      if (/[:;]/.test(line) && /\\d/.test(line) && /\.exec\(/.test(line) && /\\d[^)]*\)\s*:\s*\\?\(/.test(line)) {
        found.push(`${file}: ${line.trim().slice(0, 90)}`);
      }
    }
  }
  assert.equal(
    found.length,
    1,
    `the tree must contain exactly one timecode parser, and it is the module's - main.rs says the window is not allowed a second one, and a parser that reads more loosely than the shared one stores cues the rest of the tree would reject:\n  ${found.join("\n  ") || "(none found - has the regex moved or changed shape?)"}`,
  );
  assert.ok(found[0].startsWith("desktop/ui/cue-list.js"), `and it must be the module's, not a window's: ${found[0]}`);
  console.log(`one-parser contract passed (${found.length} timecode parser in the tree, in the module)`);
}

// --- A window does not spell the module's defaults by hand -------------------------------------
//
// **cue-list.js exports the two words that decide a payload's order and drive, and uses them as its own fallback.**
// MEASURED 2026-10-08: eight literal fallbacks sat in two windows - `?? "smpte"` and `?? "timecode"`, twice each per
// file - AND IN THE VERY FILES THAT READ THE ARRAYS four hundred lines earlier. Fixed in f6f782f3.
//
// **What it costs when they disagree is not cosmetic**: reorder `SORT_MODES` and the payload's fallback moves while
// these comparisons do not, so the cross-window adoption check reports "nothing changed" about a list that changed -
// and the window that should adopt the new list keeps the old one believing it is up to date. **A check that says
// nothing changed about something that changed is worse than no check.**
//
// **Both spellings a fallback can take are covered, `??` and `||`**, because a guard that watched only the operator
// the defect used is the guard-shaped-by-the-defect mistake this repository has paid for repeatedly. What it does NOT
// catch, and says so: a window that writes the default some third way, or that hard-codes the array's ELEMENT rather
// than the literal. Widening the match to every bare "smpte" would flag the arrays themselves and the prose that names
// them, and a guard that fails for the wrong reason is worse than the defect it hunts.
{
  const windows = ["desktop/ui/index.html", "desktop/ui/ltc.html", "desktop/ui/timecode.html"];
  const defaults = ["smpte", "timecode"];
  const offenders = [];
  for (const file of windows) {
    read(file).split("\n").forEach((line, i) => {
      for (const word of defaults) {
        if (new RegExp(`(\\?\\?|\\|\\|)\\s*"${word}"`).test(line)) offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 80)}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `a window is spelling the module's default by hand, so it can disagree with cue-list.js the moment the array is reordered - and the payload fallback, the adoption check and this literal would then describe three different defaults:\n  ${offenders.join("\n  ")}`,
  );
  console.log("default-word contracts passed (no window spells the module's sort or drive default)");
}

// --- A window does not mint a cue id of its own ------------------------------------------------
//
// **main.rs documents its rule in its own words**: id minting lives *"in one place so the two add paths cannot mint
// different ids"*. MEASURED 2026-10-08: there were three. `index.html:26148` minted
// `cue-${cues.length + 1}-${Date.now() % 100000}`, fixed in 54969b2d, and the shape mattered more than the number:
// the module finds the next free id with /^cue-(\d+)$/, WHICH THE TIMESTAMP SHAPE DOES NOT MATCH, so a cue added from
// the macro editor was invisible to the uniqueness scan - while `nextCueId`'s own comment says the engine's spent
// marks are keyed by id and `validate()` refuses a list with duplicates.
//
// **What this covers and what it does not, stated because a guard that hides its edge is worse than one that has
// none**: it checks the WINDOWS. The backend has its own minting path and its own tests; this contract cannot see
// Rust, and does not pretend to. What it refuses is a window writing the id itself when `cue-list.js` exports the
// function that does it - which is the shape all three of this session's re-derivations took.
{
  const windows = ["desktop/ui/index.html", "desktop/ui/ltc.html", "desktop/ui/timecode.html"];
  const offenders = [];
  for (const file of windows) {
    read(file).split("\n").forEach((line, i) => {
      // An id literal built in the window. The module is allowed to build its own; a window is not.
      if (/id:\s*`cue-/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `a window is minting a cue id itself while cue-list.js exports nextCueId - and an id of a shape the module does not recognise is invisible to its uniqueness scan, which is how two add paths come to mint different ids:\n  ${offenders.join("\n  ")}`,
  );
  const module = read("desktop/ui/cue-list.js");
  assert.ok(/function nextCueId\(/.test(module), "and the module must still be the one that mints them");
  console.log("cue-id contracts passed (no window mints an id; the module still does)");
}

// --- A static default is a sentence its script actually writes --------------------------------
//
// **The copy an operator reads BEFORE any script runs must be a sentence the script can write.** MEASURED 2026-10-08:
// the timecode card shipped a static default of "No cue list yet." while the script wrote into that same element
// "No cue list yet. Cues are added in the LTC window — "Edit the cue list…"." - and the static one is what somebody who
// has no cues reads first, at the moment he needs to be told where they are added.
//
// **Why the test is an EQUALITY against the file's own string literals rather than a substring search**: "No cue list
// yet." IS a prefix of the sentence the script writes, so `includes` would have passed on the very defect this guard
// exists for. A static default must not merely be contained in the script - it must BE one of its sentences.
{
  const pairs = [
    { file: "desktop/ui/index.html", id: "timecode-card-cue" },
    { file: "desktop/ui/timecode.html", id: "cue-status" },
  ];
  const offenders = [];
  for (const { file, id } of pairs) {
    const source = read(file);
    const staticLine = source.split("\n").find((l) => l.includes(`id="${id}"`));
    assert.ok(staticLine, `${file} must still contain #${id}`);
    const inner = staticLine.match(/>([^<]+)<\//);
    assert.ok(inner, `#${id}'s static default must be readable on one line`);
    const sentence = inner[1];
    // Every double-quoted literal in the file, which is how the script writes a sentence.
    const literals = new Set([...source.matchAll(/"([^"\n]{20,})"/g)].map((m) => m[1]));
    if (!literals.has(sentence)) {
      offenders.push(`${file} #${id}: the static default is not one of the file's sentences - ${JSON.stringify(sentence.slice(0, 70))}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a static default says something its script never writes, and it is the copy an operator reads BEFORE the script runs:\n  ${offenders.join("\n  ")}`,
  );
  console.log(`static-default contracts passed (${pairs.length} elements say what their scripts say)`);
}
