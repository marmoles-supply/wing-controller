// The complete guide window: it opens, it lists every chapter, each chapter has real content, the
// search filters and highlights, and the chapter list switches sections. The quick reference inside
// Properties keeps a button that opens it (checked statically).
//
// Needs Chrome on the debug port (the gate starts one); without it the test says so and passes.
//
// Run: node scripts/test-desktop-guide-browser.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';

const DEBUG_PORT = process.env.WING_CHROME_PORT || 9223;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE_URL = new URL('../desktop/ui/guide.html', import.meta.url).href;

async function debuggerPages() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

const pages = await debuggerPages();
if (!pages) {
  console.log(`SKIP: no Chrome remote debugging on port ${DEBUG_PORT}`);
  process.exit(3);
}

// The tab starts blank and the guide is navigated to below: a tab opened straight on the guide URL is
// already showing a document when the stub is installed, and that document is the one a reload replaces.
const target = await (
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })
).json();
assert.ok(target?.webSocketDebuggerUrl, 'could not open a Chrome tab for the guide');
process.on('exit', () => {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', `http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`]);
  } catch (_) {}
});

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});
let nextId = 0;
const pending = new Map();
socket.on('message', (data) => {
  const response = JSON.parse(data);
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  if (response.error) request.reject(new Error(response.error.message));
  else request.resolve(response.result);
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A bounded wait for the fact a step is about, in place of a fixed count of tries that measures the
// clock and then reads whatever the page happens to be: `expression` returns `{ ok: true, ... }` once
// the fact holds, and the caller names the property and prints the page it saw if it never did.
async function waitFor(expression, { tries = 30, every = 100 } = {}) {
  let state = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    state = await evaluate(expression);
    if (state?.ok) return state;
    await sleep(every);
  }
  return state;
}

await call('Page.enable');
// The window talks to Rust only for the geometry and the close button: stub what it may call.
// `__wingTestDocument` is a token the stub writes into every document this tab creates, and the waits
// below are keyed to it. `document.readyState` alone is not enough: for a moment after a navigation the
// *outgoing* document is still the one that answers, and this suite once read its chapter list out of it
// — the gate logged `FAIL (0s)` with "found 0" chapters while the window painted all thirteen. The token
// idiom is the one `test-desktop-meter-bank-selector-browser.mjs` documents.
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__wingTestDocument = String(Date.now()) + ':' + Math.random();
    window.__TAURI__ = { core: { invoke: async () => ({}) },
    event: { listen: async () => () => {} },
    window: { getCurrentWindow: () => ({ innerSize: async () => ({ width: 980, height: 720 }),
      outerPosition: async () => ({ x: 40, y: 40 }), setSize: async () => {}, setPosition: async () => {},
      close: async () => {}, onCloseRequested: async () => () => {} }),
      LogicalSize: class { constructor(w, h) { this.width = w; this.height = h; } },
      LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } } } };`,
});
// The tab is blank until this navigation, so the document the wait accepts is always one the stub built:
// there is no earlier guide document for a read to land in.
await call('Page.navigate', { url: GUIDE_URL });
const loaded = await waitFor(`(() => {
  const chapters = Array.from(document.querySelectorAll('#guide-chapters li')).map((li) => ({
    id: li.dataset.section,
    title: li.textContent.replace(/\\d+$/, '').trim(),
  }));
  return {
    ok: document.readyState === 'complete' && String(window.__wingTestDocument || '') !== '' && chapters.length > 0,
    token: String(window.__wingTestDocument || ''),
    href: location.href,
    ready: document.readyState,
    chapters,
    sections: Array.isArray(window.WING_GUIDE_SECTIONS) ? window.WING_GUIDE_SECTIONS.length : -1,
    status: document.getElementById('guide-status')?.textContent || '',
  };
})()`, { tries: 60 });
assert.ok(loaded.ok, `the guide window must have painted its chapters (page: ${JSON.stringify(loaded)})`);

// --- 1. Every chapter is there, with real prose ------------------------------
const chapters = loaded.chapters;
const sourceCount = fs
  .readdirSync(path.join(repoRoot, 'docs/guide'))
  .filter((name) => /^\d\d-.*\.md$/.test(name)).length;
assert.ok(chapters.length >= 10, `the guide must list every chapter, found ${chapters.length}`);
assert.equal(chapters.length, sourceCount, 'one chapter per Markdown source');
for (const chapter of chapters) {
  assert.ok(chapter.title.length > 2, `chapter ${chapter.id} needs a readable title`);
}

const stats = await evaluate(`(() => {
  const articles = Array.from(document.querySelectorAll('#guide-content article'));
  return {
    articles: articles.length,
    words: articles.map((article) => article.textContent.split(/\\s+/).filter(Boolean).length),
    hidden: articles.filter((article) => article.style.display === 'none').length,
    firstVisible: articles.findIndex((article) => article.style.display !== 'none'),
  };
})()`);
assert.equal(stats.articles, chapters.length, 'every chapter must have a rendered article');
assert.equal(stats.firstVisible, 0, 'the first chapter must be the one shown at boot');
assert.equal(stats.hidden, stats.articles - 1, 'a tabbed guide shows one chapter at a time');
for (const [index, words] of stats.words.entries()) {
  assert.ok(words >= 250, `chapter ${chapters[index].id} is too thin (${words} words)`);
}
console.log(`1. ${chapters.length} chapters, ${stats.words.reduce((a, b) => a + b, 0)} words`);

// --- 2. Technical details the operator asked for are actually in there -------
const text = await evaluate(`document.getElementById('guide-content').textContent`);
for (const needle of [
  ['sequential', /sequential/i],
  ['17 ms send limiter', /17\s?ms/],
  ['128 macros', /128\s+macros/i],
  ['the 32-step cap', /32\s+(ordered\s+)?steps/i],
  ['scopes', /scope/i],
  ['1/256 dB', /1\/256/],
]) {
  assert.ok(needle[1].test(text), `the guide must cover ${needle[0]}`);
}
console.log('2. the technical details are present (order, limits, scopes, protocol)');

// --- 3. The chapter list switches sections -----------------------------------
const switched = await evaluate(`(() => {
  const items = Array.from(document.querySelectorAll('#guide-chapters li'));
  items[3].click();
  const articles = Array.from(document.querySelectorAll('#guide-content article'));
  return {
    active: document.querySelector('#guide-chapters li.is-active')?.dataset.section,
    visible: articles.findIndex((article) => article.style.display !== 'none'),
    hash: location.hash,
  };
})()`);
assert.equal(switched.active, chapters[3].id, 'clicking a chapter must make it active');
assert.equal(switched.visible, 3, 'clicking a chapter must show that article');
assert.equal(switched.hash, `#${chapters[3].id}`, 'the chapter must be linkable through the hash');

const deepLink = await evaluate(`(async () => {
  location.hash = '#saving-and-scopes';
  location.reload();
  return true;
})()`);
// The hash link goes through a real reload: the wait is for the document that reload produces (a new
// token) and for the chapter the hash names, instead of a fixed 1.2 s that guessed how long it takes.
const linked = await waitFor(`(() => {
  const state = {
    token: String(window.__wingTestDocument || ''),
    href: location.href,
    ready: document.readyState,
    active: document.querySelector('#guide-chapters li.is-active')?.dataset.section,
    visible: Array.from(document.querySelectorAll('#guide-content article')).findIndex((a) => a.style.display !== 'none'),
  };
  return { ...state,
    ok: state.ready === 'complete' && state.token !== '' && state.token !== ${JSON.stringify(loaded.token)}
      && state.active === 'saving-and-scopes' && state.visible > 0 };
})()`, { tries: 60 });
assert.ok(linked.active === 'saving-and-scopes' && linked.visible > 0,
  `a hash link must open that chapter: ${JSON.stringify(linked)}`);
console.log('3. the index and the hash links open the right chapter');

// --- 4. The search filters and highlights ------------------------------------
const search = await evaluate(`(() => {
  const input = document.getElementById('guide-search');
  input.value = 'panic';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const visibleChapters = Array.from(document.querySelectorAll('#guide-chapters li')).filter((li) => li.style.display !== 'none');
  return {
    visible: visibleChapters.length,
    all: document.querySelectorAll('#guide-chapters li').length,
    marks: document.querySelectorAll('#guide-content article[style*="block"] mark, #guide-content article:not([style*="none"]) mark').length,
    status: document.getElementById('guide-status').textContent,
  };
})()`);
assert.ok(search.visible > 0 && search.visible < search.all,
  `the search must narrow the chapter list (${search.visible} of ${search.all})`);
assert.ok(/panic/i.test(search.status), `the status line must report the search: ${search.status}`);

const cleared = await evaluate(`(() => {
  document.getElementById('btn-clear-search').click();
  return {
    visible: Array.from(document.querySelectorAll('#guide-chapters li')).filter((li) => li.style.display !== 'none').length,
    marks: document.querySelectorAll('#guide-content mark').length,
    value: document.getElementById('guide-search').value,
  };
})()`);
assert.equal(cleared.visible, chapters.length, 'clearing the search must bring every chapter back');
assert.equal(cleared.marks, 0, 'clearing the search must remove the highlights');
assert.equal(cleared.value, '', 'the search field must be emptied');
console.log('4. the search filters the chapters and highlights the matches');

// --- 5. The quick reference keeps the door to the guide ----------------------
const indexHtml = fs.readFileSync(path.join(repoRoot, 'desktop/ui/index.html'), 'utf8');
assert.match(indexHtml, /id="open-guide-btn"/, 'the quick reference must offer the complete guide');
assert.match(indexHtml, /invoke\("open_guide_window"\)/, 'that button must open the guide window');
const rust = fs.readFileSync(path.join(repoRoot, 'desktop/src-tauri/src/main.rs'), 'utf8');
assert.match(rust, /fn open_guide_window/, 'the backend must own the guide window');
assert.match(rust, /"guide"/, 'the guide window must have its own label');
const capabilities = fs.readFileSync(path.join(repoRoot, 'desktop/src-tauri/capabilities/default.json'), 'utf8');
assert.match(capabilities, /"guide"/, 'the guide window needs its capability entry or it cannot run');
console.log('5. the quick reference opens the guide and the window is allowed');

// --- 6. The build line names the build --------------------------------------
// It read `window.WING_VERSION`, a name nothing in this repository defines — the generator publishes
// `window.APP_VERSION_INFO` — so the line was set to the empty string on every launch, and a version line that can
// only ever be blank reads as a build that has lost its version, which is worse than no line at all. The contract is
// the **rendered text against the shipped `version.json`**, not the variable name, so a rename inside the generator
// cannot quietly empty it again.
const shippedVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'version.json'), 'utf8'));
const guideBuild = await evaluate(`(() => ({
  build: document.getElementById('guide-build')?.textContent?.trim() || '',
  mark: document.getElementById('app-version-mark')?.textContent?.trim() || '',
  published: Boolean(window.APP_VERSION_INFO),
}))()`);
assert.ok(guideBuild.published, 'the guide window must load the generated version block');
assert.ok(guideBuild.build.includes(shippedVersion.version),
  `the guide must name the version it shipped in (got ${JSON.stringify(guideBuild.build)}, version.json says ${shippedVersion.version})`);
assert.ok(guideBuild.build.includes(shippedVersion.build),
  `and the build number, so a screenshot of the guide can be dated (got ${JSON.stringify(guideBuild.build)})`);
assert.ok(guideBuild.mark.length > 2,
  `and the version mark must name the application rather than being left at its markup (got ${JSON.stringify(guideBuild.mark)})`);
console.log('6. the guide names the build it was shipped in');

// Leave the shared origin clean for the next browser test.
await evaluate(`(async () => { try { localStorage.removeItem('wing_guide_geom'); } catch (_) {} })()`);
console.log('desktop guide contracts passed');
socket.close();

// The gate demands this line. Eighteen suites used to print "skipped" and exit 0 when the
// browser was wedged, and the gate booked that as PASS: a run that did not happen looked like a
// run that passed (audit 2026-10-02, S1). A suite that cannot run must not reach this line.
console.log("WING_BROWSER_SUITE_OK");
