// Live Safe Mode contracts for the desktop window.
//
// scripts/test-live-safety-contracts.mjs only reads the Android/Expo sources and
// the Rust core; nothing checked the desktop window, where Live Safe Mode is
// actually operated. This locks:
//
//   - liveLockActive() is on for live/connecting/reconnecting and only when the
//     operator turned the lock on;
//   - every library-mutating handler answers liveLockBlocks() before touching
//     the library, and arming refuses visibly;
//   - syncLiveLockUi() disables those buttons and restores their tooltips;
//   - the refusal is visible: liveLockBlocks() marks the always-visible status
//     chip, not only the collapsed Diagnostics readout;
//   - "Cannot reach console" (failed) is a different state from "Connection
//     lost" (offline): a first connect failure never reads as a lost link.
//
// Run: node scripts/test-desktop-live-safety-contracts.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = fs.readFileSync(path.join(repoRoot, "desktop/ui/index.html"), "utf8");

// Comments explain the behaviour at length and mention the strings we forbid, so
// scan the executable text only.
const withoutComments = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
const code = withoutComments(indexHtml);

const findClosing = (source, openIndex, openChar, closeChar) => {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

// Full `function name(...) { ... }` text, so pure functions can be evaluated.
const functionSource = (source, name) => {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(signature, `expected a function ${name}() in desktop/ui/index.html`);
  const paramsOpen = signature.index + signature[0].length - 1;
  const paramsClose = findClosing(source, paramsOpen, "(", ")");
  assert.ok(paramsClose > paramsOpen, `expected ${name}() to close its parameter list`);
  const bodyOpen = source.indexOf("{", paramsClose);
  const bodyClose = findClosing(source, bodyOpen, "{", "}");
  assert.ok(
    bodyOpen > paramsClose && bodyClose > bodyOpen,
    `expected ${name}() to have a body`,
  );
  return source.slice(signature.index, bodyClose + 1);
};

// Body of the arrow function attached at the first `anchor` in the source.
const arrowBodyFrom = (source, listener) => {
  const arrow = source.indexOf("=>", listener);
  assert.ok(arrow > listener, "expected the listener to be an arrow function");
  const open = source.indexOf("{", arrow);
  const close = findClosing(source, open, "{", "}");
  assert.ok(open > arrow && close > open, "expected the listener to have a body");
  return source.slice(open + 1, close);
};

const listenerBody = (source, anchor) => {
  const at = source.indexOf(anchor);
  assert.ok(at >= 0, `expected "${anchor}" in desktop/ui/index.html`);
  const listener = source.indexOf("addEventListener(", at);
  assert.ok(listener > at, `expected "${anchor}" to attach a listener`);
  return arrowBodyFrom(source, listener + "addEventListener(".length);
};

// The anchor must be the getElementById call that attaches the listener: some of
// these ids are also read elsewhere (to update a label), which has no listener.
const handlerBody = (source, id) => {
  const pattern = new RegExp(`getElementById\\("${id}"\\)\\??\\.addEventListener\\(`);
  const match = pattern.exec(source);
  assert.ok(
    match,
    `expected document.getElementById("${id}") to attach a listener in desktop/ui/index.html`,
  );
  return arrowBodyFrom(source, match.index + match[0].length);
};

// Evaluates a source-extracted function with its free variables as parameters.
// This checks the real truth table instead of a regex that a `||`/`&&` swap
// would satisfy.
const makePure = (source, name, argNames) => {
  const text = functionSource(source, name);
  try {
    // The extracted function's free variables (`safetyConfig`, `streamMode`, …)
    // resolve to the wrapper's parameters, so each call gets fresh values.
    return new Function(...argNames, `return (${text}).apply(null, arguments);`);
  } catch (error) {
    assert.fail(`could not evaluate ${name}() from index.html in isolation: ${error.message}`);
  }
};

// --- 1. liveLockActive() ---------------------------------------------------
// `liveReconnectWanted` and `lastLiveRequest` are free variables of the real
// function: a reconnect that was asked for keeps the session live from the
// console's point of view even while the label reads "failed".
const liveLockActive = makePure(code, "liveLockActive", [
  "safetyConfig",
  "streamMode",
  "liveReconnectWanted",
  "lastLiveRequest",
]);
const LOCKED_SESSION_MODES = ["live", "connecting", "reconnecting"];
const OTHER_MODES = ["idle", "offline", "failed", "stopped", ""];

for (const config of [undefined, null, {}, { liveLock: false }]) {
  for (const mode of [...LOCKED_SESSION_MODES, ...OTHER_MODES]) {
    for (const reconnect of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      assert.equal(
        liveLockActive(config, mode, ...reconnect),
        false,
        `liveLockActive() must be false when the operator did not turn the lock on (config=${JSON.stringify(config)}, streamMode=${JSON.stringify(mode)}, reconnect=${JSON.stringify(reconnect)})`,
      );
    }
  }
}
for (const mode of LOCKED_SESSION_MODES) {
  assert.equal(
    liveLockActive({ liveLock: true }, mode, false, false),
    true,
    `liveLockActive() must be true while the lock is on and the stream is ${mode}`,
  );
}
for (const mode of OTHER_MODES) {
  assert.equal(
    liveLockActive({ liveLock: true }, mode, false, false),
    false,
    `liveLockActive() must be false while the lock is on but no session is running (streamMode=${JSON.stringify(mode)})`,
  );
}
// The regression the audit found: a reconnect in flight must not drop the lock
// just because the visible label fell back to "failed" or "offline".
for (const mode of ["failed", "offline", "idle", ""]) {
  assert.equal(
    liveLockActive({ liveLock: true }, mode, true, true),
    true,
    `liveLockActive() must stay locked while a reconnect is wanted and was requested (streamMode=${JSON.stringify(mode)})`,
  );
}
assert.equal(
  liveLockActive({ liveLock: true }, "idle", true, false),
  false,
  "a wanted reconnect that was never requested must not lock on its own",
);

console.log("live lock state contracts passed");

// --- 2. Every library mutation is gated -----------------------------------
const GATED_ACTIONS = [
  ["library-new", "creating a macro"],
  ["library-duplicate", "duplicating a macro"],
  ["library-delete", "deleting a macro"],
  ["library-import", "importing a library"],
  ["library-toggle-enabled", "changing a macro's enabled state"],
  ["library-move-up", "reordering macros"],
  ["library-move-down", "reordering macros"],
];
for (const [id, action] of GATED_ACTIONS) {
  const body = handlerBody(code, id);
  const gate = new RegExp(
    `liveLockBlocks\\("${action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`,
  );
  assert.match(
    body,
    gate,
    `#${id} must refuse to mutate the library while Live Safe Mode locks it (missing liveLockBlocks("${action}"))`,
  );
  assert.match(
    body,
    /return;/,
    `#${id} must return without mutating once liveLockBlocks() refuses`,
  );
}

// Saving the draft is the one gate every persistence path shares.
const saveDraftBody = functionSource(code, "upsertCurrentDraftIntoLibrary");
assert.match(
  saveDraftBody,
  /liveLockBlocks\("saving the draft"\)/,
  "upsertCurrentDraftIntoLibrary() must refuse while Live Safe Mode locks the library",
);
assert.match(
  handlerBody(code, "library-save-current"),
  /upsertCurrentDraftIntoLibrary\(/,
  "Save Draft must persist through the gated upsertCurrentDraftIntoLibrary()",
);

// The inspector's per-row enable button and drag-and-drop reordering are the
// two mutation paths that do not go through the toolbar buttons.
assert.match(
  code,
  /enableButton\.addEventListener\("click",[\s\S]{0,400}?liveLockBlocks\("changing a macro's enabled state"\)/,
  "the inspector's enable/disable button must respect Live Safe Mode",
);
assert.match(
  code,
  /row\.addEventListener\("drop",[\s\S]{0,900}?liveLockBlocks\("reordering macros"\)/,
  "drag-and-drop reordering must respect Live Safe Mode",
);

// Arming runs the macro on the desk, so the refusal must be a real dialog.
const armBody = listenerBody(code, "armButton.addEventListener");
// `liveLockActive()` and not just `streamMode === "live"`: arming must be refused while the stream
// is connecting or reconnecting too, not only once it is fully live.
assert.match(
  armBody,
  /liveLockActive\(\)/,
  "arming must consult the Live Safe Mode lock state (live, connecting or reconnecting), not only the live mode",
);
assert.match(
  armBody,
  /liveLockActive\(\)[\s\S]{0,200}?win95Confirm\(\{[\s\S]{0,600}?return;/,
  "arming while Live Safe Mode locks the editor must open a visible dialog and return without arming",
);
assert.ok(
  !/alert\s*\(/.test(armBody),
  "the arm refusal must not use alert(): it is a no-op in the packaged app",
);

console.log("live lock mutation gate contracts passed");

// --- 3. syncLiveLockUi() ---------------------------------------------------
const syncLiveLockBody = functionSource(code, "syncLiveLockUi");
for (const id of [
  "library-save-current",
  "library-new",
  "library-duplicate",
  "library-delete",
  "library-import",
  "library-toggle-enabled",
  "library-toggle-notice",
]) {
  assert.ok(
    syncLiveLockBody.includes(`"${id}"`),
    `syncLiveLockUi() must disable #${id} while the lock is on`,
  );
}
assert.match(
  syncLiveLockBody,
  /button\.disabled = true/,
  "locked library buttons must actually be disabled",
);
assert.match(
  syncLiveLockBody,
  /button\.disabled = false/,
  "unlocking must re-enable the buttons",
);
assert.match(
  syncLiveLockBody,
  /button\.dataset\.liveLockTitle = button\.title/,
  "the original tooltip must be saved before the lock replaces it",
);
assert.match(
  syncLiveLockBody,
  /button\.title = button\.dataset\.liveLockTitle \|\| ""/,
  "unlocking must restore the original tooltip",
);
assert.match(
  syncLiveLockBody,
  /delete button\.dataset\.liveLockTitle/,
  "the stored tooltip must be cleared after it is restored",
);
assert.match(
  code,
  /function syncState\(\)[\s\S]{0,400}?syncLiveLockUi\(\)/,
  "syncState() must re-apply the lock to the buttons on every state change",
);
// The selection-based availability pass runs after the lock pass; it must not
// re-enable a button the lock disabled.
const availabilityBody = functionSource(code, "syncLibraryActionAvailability");
assert.match(
  availabilityBody,
  /liveLockDisabled !== "true"/,
  "syncLibraryActionAvailability() must leave Live Safe Mode's `disabled` alone",
);

console.log("live lock UI contracts passed");

// --- 4. The refusal is visible --------------------------------------------
const liveLockBlocksBody = functionSource(code, "liveLockBlocks");
assert.match(
  liveLockBlocksBody,
  /builderStatus/,
  "liveLockBlocks() must mark the always-visible status chip, not only write to the collapsed Diagnostics readout",
);
assert.match(
  liveLockBlocksBody,
  /classList\.add\("is-locked"\)/,
  "the locked chip must carry the is-locked class the CSS paints",
);
assert.match(
  liveLockBlocksBody,
  /builderStatus\.title = LIVE_LOCK_STATUS_TITLE/,
  "the locked chip must explain itself in the tooltip",
);
assert.match(
  indexHtml,
  /class="status" id="builder-status"/,
  "builder-status must stay an always-visible status chip (class status)",
);
assert.match(
  indexHtml,
  /class="status" id="arm-status"/,
  "arm-status must stay an always-visible status chip (class status)",
);

const cssRuleBody = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Anchored at the start of a line so a `body.theme-dark .status.is-locked`
  // variant cannot stand in for the base rule the light theme needs.
  const match = new RegExp(`^[ \\t]*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(source);
  return match ? match[1] : null;
};
const lockedCss = cssRuleBody(indexHtml, ".status.is-locked");
assert.ok(lockedCss, "the .status.is-locked class must have a CSS rule or the chip never changes face");
assert.match(lockedCss, /background\s*:/, "the locked chip must paint a different background");

assert.match(
  code,
  /armStatus\.classList\.toggle\("is-locked", liveLocked\)/,
  "syncState() must paint arm-status as locked",
);
assert.match(
  code,
  /builderStatus\.classList\.toggle\("is-locked", liveLocked\)/,
  "syncState() must paint builder-status as locked",
);

console.log("live lock visibility contracts passed");

// --- 5. "Cannot reach console" is not "Connection lost" --------------------
const streamStateLabel = makePure(code, "streamStateLabel", ["streamMode"]);
assert.equal(
  streamStateLabel("failed"),
  "Cannot reach console",
  "a first connect that never reached the console must read as Cannot reach console",
);
assert.equal(
  streamStateLabel("offline"),
  "Connection lost",
  "a link that existed and dropped must read as Connection lost",
);
assert.notEqual(
  streamStateLabel("failed"),
  streamStateLabel("offline"),
  "failed and offline must not share a label",
);
assert.notEqual(
  streamStateLabel("stopped"),
  streamStateLabel("offline"),
  "a stopped/idle stream must not read as a lost link",
);
assert.equal(streamStateLabel("live"), "Live");
assert.equal(streamStateLabel("connecting"), "Connecting");
assert.equal(streamStateLabel("reconnecting"), "Reconnecting");

// A failed first connect must be recorded as `failed`, never as `offline`; the
// decision is `streamReachedLive ? "offline" : "failed"`.
assert.match(
  code,
  /streamMode\s*=\s*streamReachedLive\s*\?\s*"offline"\s*:\s*"failed"/,
  "a connect error must set `failed` when the link never came up and `offline` only after it did",
);
assert.match(
  code,
  /streamReachedLive\s*=\s*true/,
  "the live state must record that the link came up",
);
assert.match(
  code,
  /Connection failed:/,
  "the first-failure branch must report a connection failure",
);
const failedCss = cssRuleBody(indexHtml, "#mode-status.failed");
assert.ok(
  failedCss,
  "the failed state must have its own #mode-status.failed rule so it is visually distinct",
);
assert.match(failedCss, /background\s*:/, "the failed face must paint a different background");

console.log("connection failure label contracts passed");

// --- Security holes found in the 2026-09-22 audit -------------------------
// The lock covered library changes but not sending straight to the console; and it switched itself off
// when the stream label fell to "failed" while the reconnect was still in flight and armed macros were
// still firing. Both things are checked against the served code.
// The handler's first branch is the cancel of a Shoot already in flight (it has to stay reachable
// while the lock is on: stopping is not a write), and the lock is the first thing the *sending* path
// meets. The address is matched with `[\s\S]*?` so the comment between them is free to grow.
assert.match(
  code,
  /getElementById\("send-osc"\)\.addEventListener\("click", async \(\) => \{[\s\S]{0,400}?if \(liveLockBlocks\("sending a test action to the console"\)\) return;/,
  "sending straight to the console must go through the Live Safe Mode lock",
);
assert.match(
  code,
  /if \(liveReconnectWanted && lastLiveRequest\) return Boolean\(safetyConfig\?\.liveLock\);/,
  "the lock must not switch off during a reconnect: armed macros would start firing again",
);
// Both free variables must really exist in the file, not only in the evaluated copy.
assert.match(
  code,
  /let liveReconnectWanted = false;/,
  "liveReconnectWanted must still hold the real reconnect state",
);
assert.match(
  code,
  /let lastLiveRequest = null;/,
  "lastLiveRequest must still hold the latest connection request",
);
assert.match(
  code,
  /liveReconnectWanted = true;/,
  "going live must mark the reconnect as wanted",
);
assert.match(
  code,
  /liveReconnectWanted = false;/,
  "disconnecting must clear the wanted reconnect",
);
console.log("desktop live safety holes contracts passed");
console.log("desktop live safety contracts passed");
