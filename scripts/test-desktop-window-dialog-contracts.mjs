// Desktop dialog contracts for both windows.
//
// The packaged app runs in WKWebView with no dialog delegate, so the native
// `confirm()`, `prompt()` and `alert()` are dead paths: confirm returns false,
// prompt returns null and alert does nothing. Every "are you sure?" written with
// them silently cancelled its action (meters Clear, Panic Stop, backup restore,
// Replace & View, the rename prompts) and every warning vanished. Each window
// therefore owns a Win95 dialog helper, and this test keeps the native calls out
// of the source while keeping the helpers (and their danger styling, and the
// caret fix) wired.
//
// Run: node scripts/test-desktop-window-dialog-contracts.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const indexHtml = read("desktop/ui/index.html");
const metersHtml = read("desktop/ui/meters.html");
const windows = [
  ["desktop/ui/index.html", indexHtml],
  ["desktop/ui/meters.html", metersHtml],
];

// Strip the three comment forms the sources use, exactly as
// scripts/test-desktop-ui-contracts.mjs does. Scanning the comments would flag
// the documentation that *explains* why these calls are forbidden.
const withoutComments = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

const snippetAround = (source, index) =>
  source
    .slice(Math.max(0, index - 50), index + 50)
    .replace(/\s+/g, " ")
    .trim();

// --- No native dialogs anywhere in the executable source ------------------
for (const [file, raw] of windows) {
  const html = withoutComments(raw);
  const forbidden = [
    ["alert()", /(^|[^.\w])(?:window\.)?alert\s*\(/g],
    ["prompt()", /(^|[^.\w])(?:window\.)?prompt\s*\(/g],
    ["confirm()", /(^|[^.\w])(?:window\.)?confirm\s*\(/g],
  ];
  for (const [label, pattern] of forbidden) {
    const hits = [...html.matchAll(pattern)].map((match) =>
      snippetAround(html, match.index),
    );
    assert.deepEqual(
      hits,
      [],
      `${file} must not call the native ${label}: WKWebView has no dialog delegate, so the call is a dead path (found: ${hits.join(" | ")})`,
    );
  }
}

console.log("native dialog contracts passed");

// --- Each window owns its dialog helpers ----------------------------------
// `win95Confirm` answers "are you sure?", `win95Prompt` replaces `prompt()`
// (bank/macro renaming) and `metersConfirm` is the bridge's own confirmation.
assert.match(indexHtml, /function win95Confirm\s*\(/, "index.html must own a Win95 confirm dialog");
assert.match(indexHtml, /function win95Prompt\s*\(/, "index.html must own a Win95 prompt dialog");
assert.match(
  metersHtml,
  /function metersConfirm\s*\(/,
  "meters.html must own a Win95 confirm dialog",
);

// The prompt helper must actually be a dialog with an input, not a stub: the
// main window renames banks and macros through it.
assert.match(
  indexHtml,
  /<input[^>]*id="win95-prompt-input"/,
  "the Win95 prompt must render its own text input",
);
assert.match(
  indexHtml,
  /function win95Prompt\([\s\S]{0,4000}?win95-prompt-input/,
  "win95Prompt must read the value from the dialog input",
);

console.log("dialog helper contracts passed");

// --- A `danger: true` confirmation must paint its accept button differently --
// The helpers accepted a `danger` flag that did nothing (the bridge toggled a
// class no rule styled), so a destructive confirmation looked exactly like a
// harmless one. Every `danger: true` must reach a class with a real rule.
// Finds the delimiter matching `openIndex`, ignoring comments and string
// literals so a `)` inside `"…"` or a `}` inside a template never counts.
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

// Returns the text between a function's body braces. The parameter list is
// consumed first: these helpers take a destructured options object, whose `{`
// would otherwise be mistaken for the body.
const functionBody = (source, name) => {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(signature, `expected a function ${name}() in the source`);
  const paramsOpen = signature.index + signature[0].length - 1;
  const paramsClose = findClosing(source, paramsOpen, "(", ")");
  assert.ok(paramsClose > paramsOpen, `expected function ${name}() to close its parameter list`);
  const bodyOpen = source.indexOf("{", paramsClose);
  const bodyClose = findClosing(source, bodyOpen, "{", "}");
  assert.ok(
    bodyOpen > paramsClose && bodyClose > bodyOpen,
    `expected function ${name}() to have a body`,
  );
  return source.slice(bodyOpen + 1, bodyClose);
};

const cssRuleBody = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[\\s,>])${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match ? match[1] : null;
};

const cssProperty = (rule, property) => {
  if (!rule) return null;
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule);
  return match ? match[1].trim() : null;
};

const dangerContracts = [
  {
    file: "desktop/ui/index.html",
    html: indexHtml,
    helper: "win95Confirm",
    acceptId: "win95-confirm-accept",
    dangerSelector: "button.danger",
    baseSelector: "button.primary",
    apply: /accept\.className\s*=\s*danger\s*\?\s*"danger"\s*:\s*"primary"/,
    applyHint: 'win95Confirm must set accept.className = danger ? "danger" : "primary"',
  },
  {
    file: "desktop/ui/meters.html",
    html: metersHtml,
    helper: "metersConfirm",
    acceptId: "meters-confirm-accept",
    dangerSelector: "button.win-btn.is-danger",
    baseSelector: "button.win-btn",
    apply: /accept\.classList\.toggle\(\s*"is-danger"\s*,\s*Boolean\(danger\)\s*\)/,
    applyHint: 'metersConfirm must toggle the accept button\'s "is-danger" class from the danger flag',
  },
];

for (const contract of dangerContracts) {
  const { file, html, helper } = contract;

  // The dialog must have an accept button for the helper to paint.
  assert.match(
    html,
    new RegExp(`id="${contract.acceptId}"`),
    `${file} must keep the ${contract.acceptId} accept button`,
  );

  // The helper must map the flag onto the class; a helper that accepts `danger`
  // and ignores it is the regression this locks out.
  const helperBody = functionBody(withoutComments(html), helper);
  assert.match(helperBody, contract.apply, `${file}: ${contract.applyHint}`);

  // ...and the class must actually be painted. A class with no CSS rule looks
  // exactly like no class at all.
  const dangerCss = cssRuleBody(html, contract.dangerSelector);
  assert.ok(dangerCss, `${file} must define a ${contract.dangerSelector} CSS rule`);
  const baseCss = cssRuleBody(html, contract.baseSelector);
  assert.ok(baseCss, `${file} must define a ${contract.baseSelector} CSS rule`);
  const dangerBackground = cssProperty(dangerCss, "background");
  const baseBackground = cssProperty(baseCss, "background");
  assert.ok(dangerBackground, `${contract.dangerSelector} must set a background in ${file}`);
  assert.ok(
    dangerBackground !== baseBackground,
    `${contract.dangerSelector} must paint a different background (${dangerBackground}) than ${contract.baseSelector} (${baseBackground}) in ${file}`,
  );

  // Every `danger: true` call site must be an argument to the window's own
  // helper; a flag passed to anything else reaches no dialog class.
  const stripped = withoutComments(html);
  const dangerFlags = [...stripped.matchAll(/danger\s*:\s*true/g)];
  assert.ok(
    dangerFlags.length > 0,
    `${file} must still mark its destructive confirmations with danger: true`,
  );
  for (const flag of dangerFlags) {
    const before = stripped.slice(Math.max(0, flag.index - 600), flag.index);
    assert.match(
      before,
      new RegExp(`${helper}\\s*\\(`),
      `${file}: the danger: true at "${snippetAround(stripped, flag.index)}" must be passed to ${helper}()`,
    );
  }
}

console.log("danger styling contracts passed");

// --- The caret rule survives, in one home --------------------------------
// A click that lands leaves the DOM focus on the field while WebKit closes its editing pipeline, so
// typing goes nowhere; and the click rule itself (first click selects the value, the second puts the
// caret at its end) has to behave the same in every window. Both used to be written by hand, and only
// in two of the five windows, so the gesture behaved differently per screen. See `desktop/ui/field-editing.js`.
const fieldEditing = read("desktop/ui/field-editing.js");
const fieldEditingStripped = withoutComments(fieldEditing);

const caretBody = functionBody(fieldEditingStripped, "placeCaret");
assert.match(
  caretBody,
  /selectEverything\(field\)|caretToEnd\(field\)|restoreRange\(field, range\)/,
  "field-editing.js: placeCaret must reach the selection helpers (select all, caret to end, or restore)",
);
assert.match(
  fieldEditingStripped,
  /setSelectionRange\s*\(/,
  "field-editing.js: the caret must be moved through setSelectionRange, or WebKit never re-opens its editing pipeline",
);
const focusBody = functionBody(fieldEditingStripped, "claimFieldFocus");
assert.match(
  focusBody,
  /placeCaret\(/,
  "field-editing.js: the field-focus path (claimFieldFocus) must call placeCaret after focusing",
);
// The two-click rule, named so a rewrite that silently drops one of the two halves fails here.
assert.match(
  fieldEditingStripped,
  /pressCount === 1 \? "all" : pressCount === 2 \? "end" : "native"/,
  'field-editing.js: the first click must select the whole value ("all"), the second must put the caret at its end ("end"), and later clicks must stay native',
);
// The defect that made the caret jump back to the left: the bounded re-focus after a click re-applied
// the first click's select-all. That re-focus may only ever preserve the operator's caret.
const holdBody = functionBody(fieldEditingStripped, "holdFieldFocus");
assert.match(
  holdBody,
  /claimFieldFocus\(field, "native"\)/,
  'field-editing.js: the re-focus that follows a click must not move the caret (claimFieldFocus(field, "native"))',
);
assert.doesNotMatch(
  holdBody,
  /claimFieldFocus\(field, "(all|end)"\)/,
  "field-editing.js: the re-focus that follows a click must never re-apply the click rule",
);

// Every window loads the one module, and none of them keeps a second copy of the rule.
for (const [file] of [
  ["desktop/ui/index.html"],
  ["desktop/ui/meters.html"],
  ["desktop/ui/ltc.html"],
  ["desktop/ui/timecode.html"],
  ["desktop/ui/guide.html"],
]) {
  const html = read(file);
  assert.match(
    html,
    /<script src="field-editing\.js"><\/script>/,
    `${file} must load the shared caret rule (field-editing.js)`,
  );
  assert.doesNotMatch(
    withoutComments(html),
    /function\s+(placeCaret|claimFieldFocus|holdFieldFocus)\s*\(/,
    `${file} must not keep its own copy of the caret rule; the one home is field-editing.js`,
  );
}

// The focus path has to be reachable from the click: the module claims the focus on pointerdown and
// again on pointerup, which is what survives WebKit dropping the page focus on mouse-up.
for (const event of ["pointerdown", "pointerup"]) {
  const listener = new RegExp(
    `addEventListener\\(\\s*"${event}"[\\s\\S]{0,600}?claimFieldFocus\\(`,
  );
  assert.match(
    fieldEditingStripped,
    listener,
    `field-editing.js: the "${event}" listener must claim the field focus`,
  );
}

console.log("caret contracts passed");
// --- Every control inside a dialog must describe itself ---------------------
// The dialogs reuse one shell, so a button added without a `title` gets its id read aloud by the
// inspector ("win95-confirm-accept" -> "Win95 confirm accept"). This is static and cheap, and it
// covers dialogs the browser tests never open.
for (const [file, html] of [
  ["desktop/ui/index.html", indexHtml],
  ["desktop/ui/meters.html", metersHtml],
]) {
  const blocks = html.match(/<div id="(win95-confirm|win95-prompt|macro-delete-confirm|meters-confirm|meters-prompt)"[\s\S]*?<\/div>\s*<\/div>/g) || [];
  // The workstation owns three shells (confirm, prompt, macro delete); the bridge owns two.
  assert.ok(blocks.length >= 2, `${file}: the dialog shells must be found (got ${blocks.length})`);
  for (const block of blocks) {
    const shellId = block.match(/<div id="([^"]+)"/)[1];
    const controls = block.match(/<(?:button|input|select)\b[^>]*>/g) || [];
    assert.ok(controls.length > 0, `${file}: ${shellId} must have controls`);
    for (const control of controls) {
      if (/type="hidden"/.test(control)) continue;
      assert.match(control, /title="/,
        `${file}: every control in ${shellId} must carry a title so the inspector does not read its id aloud: ${control.slice(0, 80)}`);
    }
  }
}

console.log("desktop window dialog contracts passed");
