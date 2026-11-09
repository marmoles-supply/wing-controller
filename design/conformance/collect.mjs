// The rendered half of the conformance suite: a browser on the debug port, a tab, and one observation of the page as
// Chrome actually laid it out.
//
// Nothing here imports anything from `scripts/` or from the application. The suite has to survive being copied into a
// plain-HTML project with no build step (`DESIGN-SYSTEM-ROADMAP.md` §4, ITEM 3), so the only outside things it uses
// are Node's own built-ins, the global WebSocket (Node 22+), and a Chrome the caller already has or that this file
// starts and kills itself.
//
// Port discipline (AGENTS.md, "When The App Freezes"): the verification gate owns port 9223 and SIGKILLs whatever
// holds it. This suite **reuses** a browser that is already answering there and only starts its own when the port is
// silent. Never run it while the gate is running: two processes on that port manufacture failures for both.
//
// **Reusing a browser is harmless to the rules, and that is now a property of this file rather than a hope**: every
// tab is put in the suite's own declared `VIEWPORT` before a page is loaded into it, so the size of the window the
// browser was started with cannot reach a single measurement. What the port is, and who started the browser on it, is
// still the caller's decision - the suite reports which it did (`reused` or `started by the suite`) and never kills a
// browser it did not start.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_PORT = Number(process.env.WING_CHROME_PORT || 9223);
export const CDP_DEADLINE_MS = 20000;

/// The viewport every rendering is laid out in, **declared here rather than inherited** from whatever window the
/// browser this run found happens to have.
///
/// **It is declared because inheriting it was measured to hide a defect (2026-10-08).** `ensureBrowser` reuses any
/// browser already answering the debug port, and the portable gate template's default port is 9333 — the very number
/// `design/CONSUMING.md` and `design/conformance/README.md` document as the port for a hand run — so on a machine with
/// more than one session (this project's normal state) one session's browser is the one another session measures in.
/// Measured: with a foreign Chrome started at `--window-size=1280,900` answering the port, `self-test.mjs` reported
/// `bad-overflow.html → MISSED (no rule 11 overflows-viewport naming "section#wider-than-the-window")` and `the suite
/// exited 0 on a known-bad fixture`. Rule 11 laid the fixture out in the foreign 1280px window, the fixture's own 900px
/// element fitted, and the fixture that exists to prove the rule has teeth passed instead. With `setViewport` below,
/// that same foreign browser produces the same failure as a quiet port, so reuse stops mattering to the rules.
///
/// **756x469 is the size, and it is not a free choice.** It is the size every measurement taken this evening was taken
/// at — the headless Chrome this project starts already laid pages out in it (an accident, until now) — and every
/// published number assumes it: the counts in `design/CANON_PLAN.md` §"The judge's viewport, measured on a frozen
/// snapshot", the measured declarations in `design/conformance/allow.mjs` (the `timecode.html` clock's `7vw` at
/// 52.92px is a fact about 756), `desktop/ui/allow.mjs`'s allowances, and the five windows' counted and declared
/// numbers. It is also **below the kit's own `@media (max-width: 1180px)` band**, which is why `layout.css` lays the
/// plan out collapsed and what rule 10's reasoning in this tree was measured against. Declaring any other number — the
/// 1440x1000 desktop width was measured and rejected in that same section — would silently invalidate every one of
/// those counts without turning a single verdict red, which is the failure this constant exists to make impossible.
export const VIEWPORT = { width: 756, height: 469 };

/// How long `settleAnimations` may wait for the page's own animations before it samples anyway.
///
/// It is bounded on purpose: `document.getAnimations()` includes animations with `iterations: Infinity` (the windows
/// carry live LED pulses and strobing HUD frames), whose `finished` promise never resolves, so an unbounded wait for
/// them would hang the suite instead of measuring the page. 1000 ms is chosen against the tree this suite measures:
/// the longest `transition` in the five windows and the kit is 0.15 s - `desktop/ui/index.html`'s `.card-draggable`
/// `transition: border-color 0.15s`, the very declaration that made a count on that page non-reproducible (489, 475,
/// 454, 454 across one commit, and the same card measured `#525d5a`, `#606a66` or `#45514d` from run to run) - so a
/// real transition always finishes inside the bound, and a page that genuinely never settles costs one bounded second
/// per rendering rather than the suite. When the bound is reached the collector says so (`timedOut`), and `run.mjs`
/// prints it as a note, so a truncated read is visible rather than silent.
export const ANIMATION_SETTLE_MS = 1000;

const CHROME_CANDIDATES = [
  process.env.WING_CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function chromeBinary() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('which', [name], { encoding: 'utf8' }).trim();
      if (found) return found;
    } catch (_) {
      // not on PATH; try the next
    }
  }
  return null;
}

export async function debuggerAlive(port = DEFAULT_PORT) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch (_) {
    return false;
  }
}

/// Reuse a live browser; start one only when the port is silent. The returned `close` kills **only** the browser this
/// call started, which is the same self-measuring rule `scripts/mutation-check-interapp.mjs` follows.
///
/// A reused browser no longer decides anything the rules read: `openTab` forces `VIEWPORT` on its tab before loading a
/// page. The one thing a foreign browser can still do is fail to answer (COULD-NOT-RUN), which is said out loud rather
/// than read as a verdict on the page.
export async function ensureBrowser(port = DEFAULT_PORT) {
  if (await debuggerAlive(port)) return { alive: true, own: false, close() {} };
  const binary = chromeBinary();
  if (!binary) return { alive: false, own: false, close() {}, reason: 'no Chrome or Chromium binary was found' };
  const profile = mkdtempSync(join(tmpdir(), 'wing-conformance-chrome.'));
  const child = spawn(binary, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank',
  ], { stdio: 'ignore', detached: false });
  const close = () => {
    try { process.kill(child.pid, 'SIGKILL'); } catch (_) {}
    try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  };
  process.on('exit', close);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await debuggerAlive(port)) return { alive: true, own: true, close };
    if (child.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 250));
  }
  close();
  return { alive: false, own: false, close() {}, reason: `Chrome was started but never answered port ${port}` };
}

/// Put the tab in the suite's own declared viewport (`VIEWPORT`), whatever window the browser it found happens to have.
///
/// The override is target-scoped and survives navigation, so it is set once on the blank tab `openTab` has just made;
/// both themes, and rule 8's two forced-`--meter-scale` renderings, are laid out in it. `deviceScaleFactor` is pinned
/// as well: a foreign browser started with `--force-device-scale-factor=2` would otherwise change the pixel geometry
/// every rule reads, and the point of this call is that what the suite measures stops depending on whose browser it is.
export async function setViewport(tab, viewport = VIEWPORT) {
  await tab.call('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return viewport;
}

/// A tab of this suite's own, with a CDP client that has a deadline on every call. A wedged browser does not die, it
/// stops answering; an unbounded `Runtime.evaluate` on one waits for ever and takes the suite with it.
export async function openTab(port = DEFAULT_PORT) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  if (!target?.webSocketDebuggerUrl) throw new Error('the browser would not open a tab for this suite');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(new Error('the tab websocket refused to open')); });
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.onmessage = (data) => {
    let message;
    try { message = JSON.parse(data.data); } catch (_) { return; }
    if (message.id === undefined) { events.push(message); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((done, fail) => {
    const id = ++nextId;
    const timer = setTimeout(async () => {
      pending.delete(id);
      const alive = await debuggerAlive(port);
      fail(new Error(
        `the browser did not answer ${method} within ${CDP_DEADLINE_MS} ms; ` +
        (alive ? 'it still answers its http endpoint, so it is wedged (docs/MACOS_HANG_RUNNINGBOARD_2026-09-27.md)'
               : 'it no longer answers its http endpoint at all') +
        '. Nothing here says the page is wrong: this run is COULD-NOT-RUN.',
      ));
    }, CDP_DEADLINE_MS);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); done(value); }, reject: (error) => { clearTimeout(timer); fail(error); }, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const close = () => {
    try { socket.close(); } catch (_) {}
    try { execFileSync('curl', ['-s', '--max-time', '2', '-o', '/dev/null', `http://127.0.0.1:${port}/json/close/${target.id}`]); } catch (_) {}
  };
  await call('Page.enable');
  await call('Page.bringToFront');
  // Before anything is loaded into this tab: the suite's own viewport, so no page is ever laid out in the window the
  // browser happened to have. See `VIEWPORT` for the measurement that made this a declaration instead of an accident.
  await setViewport({ call });
  return { target, call, evaluate, close, events };
}

/// The page, as Chrome laid it out. This function is serialised into the tab with `Function.prototype.toString`, so it
/// must be self-contained: no imports, no closures over this module.
function pageObservation() {
  const MAX_ELEMENTS = 6000;
  const ownText = (element) => {
    let text = '';
    for (const node of element.childNodes) if (node.nodeType === 3) text += node.textContent;
    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  };
  const classesOf = (element) => Array.from(element.classList || []).filter((name) => name !== 'theme-dark').slice(0, 8);
  const className = (element) => {
    let name = element.tagName.toLowerCase();
    if (element.id) {
      name += '#' + element.id;
      return name;
    }
    const classes = classesOf(element).slice(0, 3);
    if (classes.length) name += '.' + classes.join('.');
    return name;
  };
  // Unique on the page, so two sibling cards can be told apart: the display name stays short, the path is exact.
  // The theme switch class is left out on purpose: it is state, not structure, and a path that changes with the
  // theme would split one finding into two (measured: it did).
  const uniqueName = (element) => {
    let name = element.tagName.toLowerCase();
    if (element.id) return name + '#' + element.id;
    const parent = element.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
      if (sameTag.length > 1) name += ':nth-of-type(' + (sameTag.indexOf(element) + 1) + ')';
    }
    const classes = classesOf(element).slice(0, 3);
    if (classes.length) name += '.' + classes.join('.');
    return name;
  };
  const chain = (element) => {
    const parts = [];
    let node = element;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      parts.unshift(uniqueName(node));
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  };
  // The element's place in the document, spelled so that two elements that are not the same element cannot share it:
  // every ancestor's tag plus its `nth-of-type` among same-tag siblings, all the way to <html>, with no cap. `chain`
  // above is a **display** name — capped at five levels and leaving the theme switch out so one defect is one finding
  // — and rule 4e used to pair the two renderings by it. A page whose two theme columns are identical markup gave both
  // cards the same five-level path, so rule 4e judged the frozen card against the changed card in the other column and
  // reported nothing (DESIGN-SYSTEM-ROADMAP.md §4d). Ids and classes are left out on purpose: those are exactly what a
  // theme switch, or a state, is allowed to change, so they are not structure.
  const structKey = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      let name = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        name += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      parts.unshift(name);
    }
    return parts.join(' > ');
  };
  const shapeOf = (element) => {
    const signature = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return [node.tagName.toLowerCase(), Math.round(rect.width), Math.round(rect.height), style.borderTopWidth, style.borderTopStyle, style.borderTopLeftRadius, style.textDecorationLine, style.fontWeight].join('|');
    };
    const style = getComputedStyle(element);
    return {
      text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      ariaLabel: element.getAttribute('aria-label') || '',
      title: element.getAttribute('title') || '',
      role: element.getAttribute('role') || '',
      weight: style.fontWeight,
      italic: style.fontStyle,
      decoration: style.textDecorationLine,
      children: Array.from(element.children).slice(0, 6).map(signature),
    };
  };

  const bodyStyle = getComputedStyle(document.body);
  const bodyTokens = {};
  for (let index = 0; index < bodyStyle.length; index += 1) {
    const name = bodyStyle.item(index);
    if (name && name.indexOf('--') === 0) bodyTokens[name] = bodyStyle.getPropertyValue(name).trim();
  }

  // The kit values a rule compares against an element's own paints: the two edge steps, the instrument well and the
  // field ground, the number type, and the one knob the type scale hangs from. Custom properties inherit, so a
  // `getComputedStyle` on the element answers with the value that resolves **where that element lives**. A page that
  // paints two themes at once (the kit's own specimen does, by design) resolves the two steps differently in each
  // column, and a rule that read them once from <body> judged the dark column against the light pair — measured on
  // the specimen as 154 rule-1 findings on bevels that are correct. The table is deduplicated because a page has a
  // handful of distinct resolvings, not one per element, and the element carries only its index into it.
  //
  // `--meter-scale` is in the table for rule 8: every `--font-*` step is a `clamp()` of it, so the expected size
  // of a text is a function of the knob **where that text lives**, exactly as the two edge steps are. Appending a
  // name here means appending it to `COMPARED_TOKENS` in `rules.mjs`, which indexes this table by position.
  const tokenNames = ['--line-light', '--win-btn-highlight', '--line-dark', '--win-btn-dark-shadow', '--crt', '--field', '--mono', '--meter-scale', '--space-3', '--space-4', '--ops-col-width'];
  const tokenTable = [];
  const tokenIndexByName = new Map();
  const tokenRef = (style) => {
    const values = tokenNames.map((name) => style.getPropertyValue(name).trim());
    const key = values.join('\u0000');
    let index = tokenIndexByName.get(key);
    if (index === undefined) {
      index = tokenTable.length;
      tokenTable.push(values);
      tokenIndexByName.set(key, index);
    }
    return index;
  };

  // The two ends of rule 11's defect, taken while the elements are walked: the element whose box reaches furthest
  // right, and the widest element whose box is past the viewport's right edge. A page that scrolls sideways usually
  // shows the second pushing the first — a row that should have wrapped, and its last child carried off the screen —
  // so both are recorded and the rule can name the one that gives a fix somewhere to go. `null` means no element
  // was past the edge, which is what a page that fits carries.
  let widestPastEdge = null;
  let rightmost = null;

  const nodes = [document.body, ...document.body.querySelectorAll('*')];
  const elements = [];
  const filteredIndex = new Map();
  let truncated = false;
  for (const element of nodes) {
    if (elements.length >= MAX_ELEMENTS) { truncated = true; break; }
    if (element !== document.body) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
    }
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role') || '';
    let dataStateSet = null;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const value = node.getAttribute('data-state-set');
      if (value) { dataStateSet = value; break; }
    }
    const interactive = ['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag) ||
      ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option'].includes(role) ||
      element.isContentEditable === true;
    // The parent is the nearest ancestor that is itself in this list: an element whose parent was skipped (no box of
    // its own) must not point at a stranger. Measured: the first version indexed the raw DOM and every walk that
    // used the index — the well search above all — read the wrong element.
    let parent = -1;
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (filteredIndex.has(node)) { parent = filteredIndex.get(node); break; }
    }
    const item = {
      i: elements.length,
      parent,
      tag,
      id: element.id || '',
      cls: classesOf(element),
      element: className(element),
      path: chain(element),
      // The unambiguous identity of this element in the document tree; `path` above is for a reader. Rule 4e pairs
      // the light and dark renderings on this, never on `path`.
      struct: structKey(element),
      text: ownText(element),
      descText: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      // Index into `tokenTable`: this element's own resolution of the kit values a rule compares against.
      tokens: tokenRef(style),
      color: style.color,
      bg: style.backgroundColor,
      borders: [
        { w: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor },
        { w: style.borderRightWidth, style: style.borderRightStyle, color: style.borderRightColor },
        { w: style.borderBottomWidth, style: style.borderBottomStyle, color: style.borderBottomColor },
        { w: style.borderLeftWidth, style: style.borderLeftStyle, color: style.borderLeftColor },
      ],
      radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
      shadow: style.boxShadow,
      outline: { w: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor },
      backgroundImage: style.backgroundImage,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      gridTemplateColumns: style.gridTemplateColumns,
      gap: style.gap,
      minWidth: style.minWidth,
      interactive,
      isField: ['input', 'textarea', 'select'].includes(tag),
      disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
      disabledWhy: (element.getAttribute('title') || element.getAttribute('aria-label') || '').trim().slice(0, 200),
      role,
      ariaLabel: (element.getAttribute('aria-label') || '').trim().slice(0, 200),
      title: (element.getAttribute('title') || '').trim().slice(0, 200),
      dataState: element.getAttribute('data-state'),
      dataStateSet,
      refusal: role === 'alert' || element.hasAttribute('data-refusal'),
      svgFill: element instanceof SVGElement ? style.fill : null,
      svgStroke: element instanceof SVGElement ? style.stroke : null,
      shape: null,
    };
    if (item.dataState) item.shape = shapeOf(element);
    // Rule 11's evidence, taken from the same `rect` the observation already measures. The half-pixel is tolerance for
    // a fractional layout (`Math.round` on the recorded value would otherwise report a 0.4px spill as 0 or 1
    // depending on which side it rounds), and `window.innerWidth` is the viewport the page was actually laid out in.
    if (rect.right > window.innerWidth + 0.5) {
      const past = {
        element: className(element),
        path: chain(element),
        width: Math.round(rect.width),
        right: Math.round(rect.right),
      };
      if (!rightmost || past.right > rightmost.right) rightmost = past;
      if (!widestPastEdge || past.width > widestPastEdge.width) widestPastEdge = past;
    }
    filteredIndex.set(element, elements.length);
    elements.push(item);
  }

  const styleTexts = Array.from(document.querySelectorAll('style')).map((node, index) => ({
    name: `inline style #${index + 1}`,
    css: node.textContent || '',
  }));
  const inlineStyles = Array.from(document.querySelectorAll('[style]')).map((element) => ({
    element: className(element),
    path: chain(element),
    css: element.getAttribute('style') || '',
  }));
  const linkHrefs = Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map((link) => link.href);

  // ---------------------------------------------------------------------------
  // The page's own width against the window it was laid out in (rule 11's input)
  // ---------------------------------------------------------------------------
  // `scrollWidth` is the one measurement in this file that answers "is this page wider than the window", and nothing
  // in the suite took it before rule 11: every other field here is a computed style, a rect of one element or a
  // colour, and a page can be 187px too wide with all of them correct — `desktop/ui/index.html` measures
  // `documentElement.scrollWidth` 943 against `innerWidth` 756 (measured 2026-10-08) while rules 1 to 10 read only
  // styles. **What a page that does not overflow carries: `excess: 0`** (and neither `widestPastEdge` nor `rightmost`,
  // both `null`). `excess` is `max(0, widestScrollWidth - viewportWidth)`, so it is unambiguous by construction and
  // never negative — `good.html` measures 756/756/740 across the three boxes, and 0 is the whole answer.
  //
  // All three boxes are recorded because a page may carry the overflow on any of them: `documentElement` is the usual
  // one, `body` is the box a page's own frame widens, and the two disagree on a page whose frame is `100vw`-based
  // (`good.html`: `documentElement` 756, `body` 740, because `body` is the inner box the kit's padding leaves). The
  // measured value is the **widest** of the three and `wideningBox` names which one that was, so the finding can say
  // what actually scrolled instead of asserting `<html>` did.
  const viewportWidth = window.innerWidth;
  const overflowBoxes = [
    { box: 'documentElement', node: document.documentElement },
    { box: 'body', node: document.body },
  ].map(({ box, node }) => ({ box, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  const widestBox = overflowBoxes.reduce((a, b) => (b.scrollWidth > a.scrollWidth ? b : a));

  return {
    url: location.href,
    title: document.title,
    themeDark: document.body.classList.contains('theme-dark'),
    overflow: {
      viewportWidth,
      viewportHeight: window.innerHeight,
      boxes: overflowBoxes,
      scrollWidth: widestBox.scrollWidth,
      wideningBox: widestBox.box,
      excess: Math.max(0, widestBox.scrollWidth - viewportWidth),
      widestPastEdge,
      rightmost,
    },
    bodyTokens,
    tokenNames,
    tokenTable,
    elements,
    styleTexts,
    inlineStyles,
    linkHrefs,
    truncated,
  };
}

/// Navigate and wait for a laid-out document. A page that never becomes ready, or that the browser could not load at
/// all (Chrome shows its own `chrome-error:` page, which a naive readiness check would happily observe and report as
/// nine failed checks), is COULD-NOT-RUN, not a verdict on the app.
export async function navigate(tab, url, { timeoutMs = 15000 } = {}) {
  await tab.call('Page.navigate', { url });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await tab.evaluate('document.readyState === "complete" && Boolean(document.body)')) {
        if (await tab.evaluate('location.protocol === "chrome-error:"')) {
          throw new Error(`the browser could not load ${url}: it showed its own error page instead`);
        }
        return true;
      }
    } catch (error) {
      if (/could not load/.test(error.message)) throw error;
      // mid-navigation: no execution context yet, which is the next attempt, not a failure
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`the page never finished loading: ${url}`);
}

/// Let the page's animations finish before it is sampled, and report what was waited for.
///
/// `observe()` used to sample 2 rAF + 40 ms after it toggled the theme, which reads `desktop/ui/index.html`'s
/// `.card-draggable { transition: border-color 0.15s }` while it is still interpolating: at the sampling instant the
/// card measures `rgb(116, 125, 122)` and 42 `CSSTransition`s are running (`currentTime` 67 of 150 ms), while the
/// settled card measures `rgb(68, 80, 76)`. Whether an element happens to land on one of the kit's values then
/// depends on how far the interpolation got, which is why a count on that page was one sample of a cloud
/// (489/475/454/454 at one commit) rather than a number. This is the instrument: `document.getAnimations()` returns
/// the page's own animations and their `finished` promises are what is waited on.
///
/// The wait is bounded by `ANIMATION_SETTLE_MS` (see its comment for why 1000 ms) and nothing here is fatal - a
/// timeout returns `timedOut: true` so the caller can say the rendering is one instant of a moving page.
export async function settleAnimations(tab, { timeoutMs = ANIMATION_SETTLE_MS } = {}) {
  return tab.evaluate(`(async () => {
    if (typeof document.getAnimations !== 'function') {
      return { supported: false, waitedMs: 0, animations: 0, running: 0, neverEnding: 0, timedOut: false };
    }
    const bound = ${Number(timeoutMs)};
    const all = document.getAnimations();
    // A paused animation is part of the page's current picture too, and its finished promise is just as unresolved.
    const running = all.filter((animation) => animation.playState === 'running' || animation.playState === 'paused');
    if (!running.length) {
      return { supported: true, waitedMs: 0, animations: all.length, running: 0, neverEnding: 0, timedOut: false };
    }
    const neverEnding = running.filter((animation) => {
      try { return animation.effect.getComputedTiming().iterations === Infinity; } catch (_) { return false; }
    }).length;
    const startedAt = performance.now();
    // A finished promise rejects when an animation is cancelled mid-flight; a cancelled animation is not a page moving.
    const finished = Promise.all(running.map((animation) => animation.finished.catch(() => {})));
    let timedOut = false;
    await Promise.race([
      finished,
      new Promise((done) => setTimeout(() => { timedOut = true; done(); }, bound)),
    ]);
    return {
      supported: true,
      waitedMs: Math.round(performance.now() - startedAt),
      animations: all.length,
      running: running.length,
      neverEnding,
      timedOut,
    };
  })()`);
}

/// Render one theme (the kit says light is `:root` and dark is `body.theme-dark`) and take the observation.
///
/// The order matters and is the whole point of this function: the theme is toggled, the page is given its paint beat
/// (2 rAF + 40 ms, so the class change has been laid out and the transitions it starts exist), and then the settle
/// waits for every animation the page is running before a single rule reads it - so **every rule sees the same page**
/// instead of each one reading an interpolation at a different moment. The 40 ms beat is kept as well as the settle:
/// it is what guarantees a transition exists to be waited on, and it is shorter than the 0.15 s transition this was
/// measured against, so the settle still has real work to do.
export async function observe(tab, theme) {
  const dark = theme === 'dark';
  await tab.evaluate(`(() => {
    try { localStorage.setItem('wing_theme', ${JSON.stringify(theme)}); } catch (_) {}
    document.body.classList.toggle('theme-dark', ${dark ? 'true' : 'false'});
    return true;
  })()`);
  await tab.evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 40))))');
  const animationSettle = await settleAnimations(tab);
  const observation = await tab.evaluate(`(${pageObservation.toString()})()`);
  // Carried with the rendering rather than logged here: the observation is what the caller reports on, and a bounded
  // read has to be visible in that report.
  observation.animationSettle = animationSettle;
  return observation;
}

/// Force the type scale's single knob, or clear it again. `null` restores the page's own value.
///
/// It is set as an **inline** custom property on `<html>` and `<body>`: an inline declaration outranks the kit's own
/// `:root { --meter-scale: 1 }`, so the reading is the page at a scale it did not choose. That is the whole point of
/// rule 8's second check — a page that replaced the kit's ramp, or wrote the right pixels as literals, keeps its own
/// sizes under both readings and is caught; a page whose sizes come from the knob follows it.
///
/// Both roots are written because a page may declare its own knob on either of them, and forcing only `<html>` would
/// leave a `body { --meter-scale: … }` in charge of every text below it. A page that declares the knob on a deeper
/// container keeps it there: that is measured, not guessed, and rule 8 says so rather than pretending.
export async function setMeterScale(tab, scale) {
  const value = scale === null || scale === undefined ? null : String(scale);
  await tab.evaluate(`(() => {
    const value = ${JSON.stringify(value)};
    for (const node of [document.documentElement, document.body]) {
      if (value === null) node.style.removeProperty('--meter-scale');
      else node.style.setProperty('--meter-scale', value);
    }
    return value;
  })()`);
}

/// One rendering of the page with the knob forced, and the knob cleared again whatever happens. `theme` decides which
/// palette is rendered; the type scale is the kit's own in either.
export async function observeAtScale(tab, theme, scale) {
  await setMeterScale(tab, scale);
  try {
    return await observe(tab, theme);
  } finally {
    await setMeterScale(tab, null).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// The app's stylesheets, read so rule 4 knows which tokens it asks for
// ---------------------------------------------------------------------------
/// Turn `--app <path-or-url>` into an absolute URL the tab can load.
export function resolveAppUrl(app, cwd = process.cwd()) {
  if (/^https?:\/\//i.test(app)) return app;
  if (/^file:\/\//i.test(app)) return app;
  let path = resolve(cwd, app);
  if (existsSync(path) && existsSync(join(path, 'index.html'))) path = join(path, 'index.html');
  return pathToFileURL(path).href;
}

function readText(url) {
  if (url.startsWith('file:')) {
    try {
      return { text: readFileSync(fileURLToPath(url), 'utf8') };
    } catch (error) {
      return { error: `could not read ${url}: ${error.message}` };
    }
  }
  if (/^https?:/i.test(url)) {
    return { promise: fetch(url, { signal: AbortSignal.timeout(8000) }).then((response) => response.text()) };
  }
  return { error: `unsupported stylesheet address: ${url}` };
}

function stripped(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/// Every `var(--x)` the app asks for, and where it asked for it. A reference with a fallback (`var(--x, 4px)`) is a
/// deliberate fallback and is not reported as missing. `source` is `kit` for a stylesheet inside the kit copy itself,
/// because a defect in the kit is not the consuming app's failure.
export async function gatherReferences(observation, kitDir) {
  const references = [];
  const seen = new Set();
  const declaredTokens = new Set();
  const notes = [];
  const add = (name, hasFallback, source, element, path) => {
    if (hasFallback) return;
    const key = [name, element, path, source].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ name, hasFallback, source, element, path });
  };
  const scan = (css, source, element, path) => {
    const text = stripped(css);
    const re = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g;
    let match;
    while ((match = re.exec(text)) !== null) add(match[1], Boolean(match[2]), source, element, path);
  };
  for (const sheet of observation.styleTexts) scan(sheet.css, 'app', sheet.name, '');
  for (const inline of observation.inlineStyles) scan(inline.css, 'app', inline.element, inline.path);
  for (const href of observation.linkHrefs) {
    const where = href.startsWith('file:') ? fileURLToPath(href) : href;
    const underKit = where.startsWith(kitDir + '/') || where === kitDir;
    const source = underKit ? 'kit' : 'app';
    const name = where.split('/').pop();
    const result = readText(href);
    if (result.error) {
      notes.push(`${result.error} — token references in it were not checked`);
      continue;
    }
    let css;
    try { css = result.promise ? await result.promise : result.text; }
    catch (error) { notes.push(`could not download ${href}: ${error.message} — token references in it were not checked`); continue; }
    scan(css, source, source === 'kit' ? `the kit stylesheet ${name}` : name, href);
  }
  // Declarations, so a token defined on a descendant or in a sheet that never matched is still "defined somewhere".
  const declarationSources = [
    ...observation.styleTexts.map((sheet) => sheet.css),
    ...observation.inlineStyles.map((inline) => inline.css),
  ];
  for (const css of declarationSources) {
    const re = /(--[A-Za-z0-9_-]+)\s*:/g;
    let match;
    while ((match = re.exec(stripped(css))) !== null) declaredTokens.add(match[1]);
  }
  return { references, declaredTokens: [...declaredTokens], notes };
}

/// The kit's own directory, as seen from this file (`design/conformance/` -> `design/`).
export function kitDirOfThisCopy() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}
