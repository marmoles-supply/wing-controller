import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../desktop/ui/meters.html', import.meta.url), 'utf8');
const start = source.indexOf('let latestValues = {};');
const end = source.indexOf('function renderMeters(isScaleOnly = false) {', start);
assert.ok(start >= 0 && end > start, 'meter selection handlers exist');

function meter(key, left) {
  const classes = new Set();
  return {
    dataset: { key },
    offsetParent: {},
    classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
    closest(selector) { return selector.includes('.v-meter-strip') ? this : null; },
    getBoundingClientRect() { return { left, right: left + 40, top: 0, bottom: 50 }; },
  };
}

const strips = [meter('usb:1', 0), meter('usb:2', 50)];
const listeners = new Map();
const viewport = { addEventListener(name, callback) { listeners.set(`viewport:${name}`, callback); }, getBoundingClientRect() { return { left: 0, top: 0 }; } };
const removeButton = { disabled: true, addEventListener(name, callback) { listeners.set(`remove:${name}`, callback); } };
const count = { textContent: '' };
const marquee = { style: {} };
const elements = { viewport, 'btn-remove-selected-meters': removeButton, 'meter-selection-count': count, 'meter-selection-marquee': marquee };
const context = {
  watchlist: [{ key: 'usb:1' }, { key: 'usb:2' }],
  activeGroupFilter: 'all',
  activeBankFilter: 'all',
  getChannelsForGroup() { return context.watchlist; },
  document: {
    getElementById(id) { return elements[id]; },
    querySelectorAll(selector) { return selector.includes('.v-meter-strip') ? strips : []; },
  },
  window: {
    addEventListener(name, callback) { listeners.set(`window:${name}`, callback); },
    removeEventListener(name) { listeners.delete(`window:${name}`); },
  },
  localStorage: { setItem() {} },
  renderMeters() { vm.runInContext('syncMeterSelectionUi()', context); },
  syncActiveMeters() {},
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const down = listeners.get('viewport:pointerdown');
down({ button: 0, target: strips[0], pointerId: 1, clientX: 10, clientY: 10, shiftKey: false, metaKey: false, ctrlKey: false });
listeners.get('window:pointerup')({ pointerId: 1 });
assert.equal(strips[0].classList.contains('is-selected'), true);
assert.equal(count.textContent, '1');

down({ button: 0, target: strips[0], pointerId: 2, clientX: 10, clientY: 10, shiftKey: false, metaKey: false, ctrlKey: false });
listeners.get('window:pointermove')({ pointerId: 2, clientX: 95, clientY: 45, preventDefault() {} });
listeners.get('window:pointerup')({ pointerId: 2 });
assert.equal(strips[1].classList.contains('is-selected'), true, 'marquee selects intersecting meters');
assert.equal(count.textContent, '2');
listeners.get('remove:click')();
assert.equal(context.watchlist.length, 0, 'delete removes both selected meters');
assert.equal(removeButton.disabled, true);
console.log('Desktop Meter Bridge selection tests passed.');

// ── The bridge must not paint "no value" as silence (readiness audit A4, 2026-09-30) ────────────────
// `lookupValue` answers `undefined` for a meter the frame did not carry and every readout says `–`
// then; a value the console really reported at the bottom of the scale is still `-inf`. Asserted on
// the source here because the behavioural half needs a live session (the bridge-status browser test),
// and this is the shape that keeps the two from drifting apart again.
assert.doesNotMatch(source, /if \(!item\) return -90;/,
  'lookupValue must answer undefined, not the bottom of the scale, for a meter with no value');
assert.match(source, /const hasData = raw !== undefined;/,
  'the bridge readouts must know whether the frame carried a value');
assert.match(source, /!hasData \? "\\u2013"/,
  'and must paint no data as – rather than -inf');
assert.doesNotMatch(source, /<div class="v-val-numeric">-inf<\/div>/,
  'the template must not start a meter at -inf before any frame arrives');
