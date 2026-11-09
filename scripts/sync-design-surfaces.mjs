#!/usr/bin/env node
// The production window remains the authority for its established components.
// Extract complete CSS rules (including pseudo states and responsive variants),
// never hand-maintained approximations. Runtime modules travel byte for byte.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const html = read('desktop/ui/index.html');
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const family = /(?:parameter-|dropdown|recipe|workflow-|card-header|card-body|section-head|health-|readout|meter|vu-|probe-|diag-|status|badge|chip|accessory|condition-|step-|macro-library|library-|filter-|search-|win95-|settings-|context-menu-|matrix-|courtesy-|hud-alert|hud-|inspector-|step-row|step-index|condition-row|macro-row|macro-item|macro-name|macro-actions|macro-status|mini-btn|tiny-btn|accessory-|meter-tag|status-chip|\.chip\b|\.badge\b|\.primary\b|\.danger\b|input\[type=["'](?:checkbox|radio|range)["']\]|input:focus|select:focus|button:focus-visible|scrollbar)/;

// Split balanced CSS rules without being fooled by braces in comments/strings.
export function blocks(css) {
  const result = [];
  let start = 0, open = -1, depth = 0, quote = '', comment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i], n = css[i + 1];
    if (comment) { if (c === '*' && n === '/') { comment = false; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '/' && n === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') { if (!depth) open = i; depth++; }
    if (c === '}' && --depth === 0) {
      const selector = css.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      result.push({ selector, body: css.slice(open + 1, i) });
      start = i + 1;
    } else if (c !== '}') {
      // Only closing braces alter depth; the decrement above is short-circuited.
    }
  }
  if (depth !== 0) throw new Error('Unbalanced production CSS');
  return result;
}
function extract(css) {
  return blocks(css).flatMap(({ selector, body }) => {
    if (/^@(media|supports)/.test(selector)) {
      const children = extract(body);
      return children ? [`${selector} {\n${children}\n}`] : [];
    }
    if (family.test(selector) || /^@(?:-\w+-)?keyframes/.test(selector)) {
      // A table row cannot take the flex layout of a macro row. Alias only its
      // selected drawing; both declarations still come from the production rule.
      const aliases = ['.macro-row.selected', 'body.theme-dark .macro-row.selected'];
      const shared = aliases.includes(selector) ? `${selector}, ${selector.replace('.macro-row.selected', '.wc-selected-row')}` : selector;
      return [`${shared} {${body}}`];
    }
    return [];
  }).join('\n\n');
}
const outputs = new Map([
  ['design/surfaces.css', '/* GENERATED from desktop/ui/index.html by scripts/sync-design-surfaces.mjs.\n * Production control, popup, settings and instrument drawings. Do not edit this copy.\n * Link after workstation.css. The original class names are the public recipe API.\n */\n' + extract(style) + '\n'],
  ...['dropdown.js', 'field-editing.js', 'dither.js', 'vu-draw.js'].map(name => [`design/runtime/${name}`, read(`desktop/ui/${name}`)]),
]);
let stale = 0;
for (const [path, wanted] of outputs) {
  let actual = null;
  try { actual = read(path); } catch {}
  if (actual === wanted) continue;
  stale++;
  if (!process.argv.includes('--check')) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), wanted);
  } else console.error(`Stale production extraction: ${path}`);
}
if (process.argv.includes('--check') && stale) process.exitCode = 1;
else console.log(`Production surfaces: ${stale ? `${stale} files synchronised` : 'current'}.`);
