import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../desktop/ui/index.html', import.meta.url), 'utf8');
const availabilityStart = source.indexOf('function matrixCategoryAvailable(category) {');
const availabilityEnd = source.indexOf('function renderMatrixCategoryNavigation() {', availabilityStart);
assert.ok(availabilityStart >= 0 && availabilityEnd > availabilityStart);

const categoryContext = { activeMatrixCategorySelect: { options: [{ value: 'usb' }, { value: 'ch' }] } };
vm.createContext(categoryContext);
vm.runInContext(source.slice(availabilityStart, availabilityEnd), categoryContext);
assert.equal(vm.runInContext('matrixCategoryAvailable("usb")', categoryContext), true);
assert.equal(vm.runInContext('matrixCategoryAvailable("output_local")', categoryContext), false);
categoryContext.activeMatrixCategorySelect = null;
assert.equal(vm.runInContext('matrixCategoryAvailable("output_local")', categoryContext), true);

const closeStart = source.indexOf('function closeChannelMatrix() {');
const closeEnd = source.indexOf('function renderMatrixCells() {', closeStart);
assert.ok(closeStart >= 0 && closeEnd > closeStart);
let removedClass = '';
const closeContext = {
  document: {
    getElementById() { return { style: { display: 'flex' } }; },
    body: { classList: { remove(value) { removedClass = value; } } },
  },
};
vm.createContext(closeContext);
vm.runInContext(`let isMatrixDragging = true; let lastDraggedCell = {}; ${source.slice(closeStart, closeEnd)} closeChannelMatrix();`, closeContext);
assert.equal(removedClass, 'is-matrix-dragging');
assert.equal(vm.runInContext('isMatrixDragging', closeContext), false);

assert.match(source, /if \(currentMatrixCategory !== btn\.dataset\.cat\) selectedMatrixIds\.clear\(\)/);
assert.match(source, /if \(activeMatrixTargetInput\?\.id === "trigger-ids"\) \{\s*selectedMatrixIds = new Set\(\[id\]\)/);
console.log('Desktop macro Matrix UI tests passed.');
