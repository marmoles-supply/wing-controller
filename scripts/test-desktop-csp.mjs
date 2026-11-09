// The WebView security policy contract (independent security audit, 2026-10-04).
//
// The windows ran with `"csp": null`: no Content-Security-Policy at all, on a page that also exposes
// `window.__TAURI__` (`withGlobalTauri: true`). The policy pinned here does not remove that exposure —
// the interface still reaches the backend through `window.__TAURI__`, and migrating it to explicit
// imports is a refactor of its own — but it stops the page loading script, style, image, frame or
// object from anywhere that is not this application, and stops it talking to anything but the IPC
// transport. That is what makes a DOM injection much less useful than it was.
//
// Two silent disarms are what this contract exists for:
//
//   1. `csp` going back to `null` or empty. There is no warning for that: the windows simply stop
//      having a policy.
//   2. Tauri's own asset CSP modification being re-enabled. At compile time Tauri parses every window
//      and appends `'nonce-…'` and `'sha256-…'` sources to `script-src` and `style-src`. WebKit — the
//      engine this application's windows run in — treats the presence of any nonce or hash in a source
//      list as "ignore 'unsafe-inline'" (`ContentSecurityPolicySourceList::allowInline()` returns
//      `m_allowInline && m_hashes.isEmpty() && m_nonces.isEmpty()`, WebKit main, read 2026-10-04), and
//      `desktop/ui/index.html` positions 400-odd elements with inline `style="…"` attributes. With the
//      modification on, `'unsafe-inline'` is silently ignored and the interface loses its layout, so the
//      windows are the one place where that injection must stay off.
//
// Run: node scripts/test-desktop-csp.mjs

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const config = JSON.parse(readFileSync(`${ROOT}desktop/src-tauri/tauri.conf.json`, "utf8"));
const security = config?.app?.security ?? {};

// Tauri accepts the policy as one string or as an object of directive -> sources. Both are normalised
// here so a deliberate change of shape does not read as a missing directive.
function directivesOf(csp) {
  const directives = new Map();
  if (typeof csp === "string") {
    for (const part of csp.split(";")) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      assert.ok(!directives.has(tokens[0]), `the CSP repeats the directive ${tokens[0]}`);
      directives.set(tokens[0], tokens.slice(1));
    }
    return directives;
  }
  assert.ok(csp && typeof csp === "object" && !Array.isArray(csp), `the CSP must be a string or an object, got ${JSON.stringify(csp)}`);
  for (const [directive, sources] of Object.entries(csp)) {
    directives.set(directive, Array.isArray(sources) ? sources : [String(sources)]);
  }
  return directives;
}

// 1. The policy exists and is not empty. This is the regression the audit found.
assert.notEqual(security.csp, null, "tauri.conf.json must not leave the windows without a Content-Security-Policy");
if (typeof security.csp === "string") {
  assert.ok(security.csp.trim().length > 0, "and an empty CSP string is the same as no CSP");
}
assert.ok(
  typeof security.csp === "string" || (security.csp && typeof security.csp === "object"),
  `the CSP must be a policy, got ${JSON.stringify(security.csp)}`,
);
const directives = directivesOf(security.csp);
assert.ok(directives.size >= 6, `the CSP should pin every kind of load the windows make, found ${directives.size} directives`);

// 2. The directives the audit asked for by name.
for (const directive of ["default-src", "script-src", "style-src", "img-src", "connect-src", "object-src", "base-uri", "frame-ancestors"]) {
  assert.ok(directives.has(directive), `the CSP must pin ${directive}`);
}
assert.deepEqual(directives.get("default-src"), ["'self'"], "everything not named explicitly is this application and nothing else");
assert.deepEqual(directives.get("object-src"), ["'none'"], "no plugin or embedded object may load");
assert.deepEqual(directives.get("base-uri"), ["'none'"], "a <base> injection would repoint every relative script");
assert.deepEqual(directives.get("frame-ancestors"), ["'none'"], "nothing may frame these windows");

// 3. The windows are built out of inline <script> and inline styles, so those two directives have to allow
//    inline; anything else in them would be a strict policy that does not run this interface at all.
for (const directive of ["script-src", "style-src"]) {
  const sources = directives.get(directive);
  assert.ok(sources.includes("'self'"), `${directive} must allow this application's own files`);
  assert.ok(sources.includes("'unsafe-inline'"), `${directive} must allow inline, which is what the windows are made of: ${JSON.stringify(sources)}`);
}
//    The deliberate counterpart: Tauri must not add nonces/hashes to those two, because in WebKit that is
//    what makes `'unsafe-inline'` stop applying (see the note at the top of this file).
const disabled = security.dangerousDisableAssetCspModification;
const disabledDirectives = disabled === true ? ["script-src", "style-src"] : Array.isArray(disabled) ? disabled : [];
for (const directive of ["script-src", "style-src"]) {
  assert.ok(
    disabledDirectives.includes(directive),
    `Tauri's asset CSP modification for ${directive} must stay disabled, or 'unsafe-inline' is ignored and the interface breaks`,
  );
}

// 4. The two other things the windows really load: the IPC transport Tauri's `invoke` posts to
//    (`ipc://localhost/<command>`, measured in tauri 2.11.5 `src/ipc/protocol.rs`) and the inline
//    `data:image/svg+xml` arrows the interface paints as CSS backgrounds.
assert.ok(directives.get("connect-src").includes("ipc:"), "connect-src must allow the ipc: transport the back end is reached through");
assert.ok(directives.get("connect-src").includes("'self'"), "connect-src must allow this application's own origin");
const windows = ["index.html", "meters.html", "timecode.html", "guide.html"];
const paintsDataImages = windows.some((name) => readFileSync(`${ROOT}desktop/ui/${name}`, "utf8").includes('url("data:'));
if (paintsDataImages) {
  assert.ok(directives.get("img-src").includes("data:"), "the interface paints inline data: images, so img-src must allow them");
}

// 5. Nothing may widen the policy back to the open web. A bare `*`, or a scheme-only `https:`, allows any
//    origin there is; `http://ipc.localhost` is the transport's own host and is not one.
for (const [directive, sources] of directives) {
  for (const source of sources) {
    assert.notEqual(source, "*", `${directive} must not allow every origin`);
    assert.ok(!/^(https?|wss?):$/.test(source), `${directive} must not allow every ${source} origin`);
  }
}

// 6. `withGlobalTauri` stays **true**, deliberately: every window reaches the backend through
//    `window.__TAURI__`, and turning it off without migrating them all would leave the whole interface
//    without a back end. The migration is a refactor of its own and was left out of this change.
assert.equal(config?.app?.withGlobalTauri, true, "withGlobalTauri stays on until every window uses explicit imports");
for (const name of windows) {
  if (!existsSync(`${ROOT}desktop/ui/${name}`)) continue;
  const html = readFileSync(`${ROOT}desktop/ui/${name}`, "utf8");
  assert.match(html, /window\.__TAURI__/, `${name} reaches the backend through window.__TAURI__, which is why the global stays on`);
}

console.log(`CSP contract passed: ${directives.size} directives, no remote origin, ${disabledDirectives.join("/")} left untouched by Tauri`);
// The gate reads this seal from its Chrome suites; a plain Node suite prints it too so that a run which
// exits 0 without doing its work can never be mistaken for one that did (see scripts/verify-all.sh).
console.log("WING_BROWSER_SUITE_OK");
