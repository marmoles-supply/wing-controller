import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureBrowser, openTab, navigate, setViewport } from '../design/conformance/collect.mjs';
import { check } from '../design/workstation/check.mjs';

const port = Number(process.env.WING_CHROME_PORT || 9223);
const browser = await ensureBrowser(port);
if (!browser.alive) { console.error(browser.reason); process.exit(3); }
let tab;
try {
  const parity = await check(new URL('../design/workstation/index.html', import.meta.url).href, { port });
  assert.deepEqual(parity.failures, [], JSON.stringify(parity.failures));
  tab = await openTab(port);
  await tab.call('Page.bringToFront');
  await setViewport(tab, { width: 820, height: 760 });
  await navigate(tab, new URL('../design/workstation/index.html', import.meta.url).href);
  await tab.evaluate(`document.getElementById('notes').value = 'Keep this draft'; document.getElementById('notes').dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('search').value = 'Open'; document.getElementById('search').dispatchEvent(new Event('input', { bubbles: true }))`);
  assert.equal(await tab.evaluate(`document.getElementById('notes').value`), 'Keep this draft', 'filtering must not discard an editor draft');
  await navigate(tab, new URL('../design/workstation/catalogue.html', import.meta.url).href);
  await tab.evaluate('document.fonts.ready');
  assert.ok(await tab.evaluate('!!window.WingDropdown && !!window.WingFieldEditing && !!window.WingVu'), 'production runtimes load independently');
  await tab.evaluate(`document.querySelector('[data-wc-dialog="sample-settings"]').click()`);
  assert.equal(await tab.evaluate(`document.getElementById('sample-settings').open`), true);
  await tab.evaluate(`document.getElementById('general-tab').focus()`);
  await tab.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  assert.equal(await tab.evaluate('document.activeElement.id'), 'appearance-tab');
  assert.equal(await tab.evaluate(`document.getElementById('appearance-page').hidden`), false);
  // Native dialog close events are queued separately from the key dispatch.
  // A zero-delay timer need not run after that event on another renderer.
  await tab.evaluate(`window.__SAMPLE_DIALOG_CLOSED = false; document.getElementById('sample-settings').addEventListener('close', () => { window.__SAMPLE_DIALOG_CLOSED = true; }, { once: true })`);
  await tab.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await tab.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await tab.evaluate(`new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.__SAMPLE_DIALOG_CLOSED && !document.getElementById('sample-settings').open && document.activeElement?.dataset.wcDialog === 'sample-settings') return resolve(true);
      if (Date.now() - start > 5000) return reject(new Error('Escape must close Properties and restore focus to its opener; active=' + document.activeElement?.tagName + '#' + document.activeElement?.id));
      setTimeout(tick, 25);
    }; tick();
  })`);
  assert.equal(await tab.evaluate(`document.getElementById('sample-settings').open`), false);
  assert.equal(await tab.evaluate(`document.activeElement.dataset.wcDialog`), 'sample-settings');
  await tab.evaluate(`document.getElementById('sample-select').value = 'Rehearsal'`);
  assert.match(await tab.evaluate(`document.getElementById('sample-select').parentElement.textContent`), /Rehearsal/);
  await tab.evaluate(`document.getElementById('menu-trigger').click()`);
  assert.equal(await tab.evaluate(`document.activeElement.getAttribute('role')`), 'menuitem');
  await tab.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await tab.evaluate(`document.getElementById('sample-menu').hidden`), true);
  await tab.evaluate(`document.querySelector('#sample-matrix button').click()`);
  assert.equal(await tab.evaluate(`document.getElementById('matrix-status').textContent`), '1 selected');
  await tab.evaluate(`document.getElementById('step-edit').click()`);
  assert.equal(await tab.evaluate(`document.activeElement.getAttribute('aria-label')`), 'Step name');
  await tab.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await tab.evaluate(`document.getElementById('step-name').textContent`), 'Opening');
  const lightMeter = await tab.evaluate(`document.getElementById('sample-vu').toDataURL()`);
  await tab.evaluate(`document.body.classList.add('theme-dark')`);
  const darkMeter = await tab.evaluate(`document.getElementById('sample-vu').toDataURL()`);
  assert.notEqual(darkMeter, lightMeter, 'the meter renderer follows the theme');
  for (const width of [420, 820, 1280]) {
    await setViewport(tab, { width, height: 760 });
    for (const dark of [false, true]) {
      await tab.evaluate(`document.body.classList.toggle('theme-dark', ${dark})`);
      assert.ok(await tab.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `catalogue fits ${width}/${dark}`);
    }
  }
  await tab.close();
  tab = await openTab(port);
  await tab.call('Page.bringToFront');
  await setViewport(tab, { width: 1440, height: 900 });
  const source = readFileSync(new URL('./test-desktop-interapp-smoke-browser.mjs', import.meta.url), 'utf8');
  const a = source.indexOf('const STUB = `') + 'const STUB = '.length;
  const b = source.indexOf('\n`;', a) + 2;
  const stub = Function('return ' + source.slice(a, b))();
  await tab.call('Page.addScriptToEvaluateOnNewDocument', { source: stub });
  await navigate(tab, new URL('../desktop/ui/index.html', import.meta.url).href);
  // Boot is asynchronous. A bounded page-side predicate waits for the actual entry point.
  await tab.evaluate(`new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (typeof window.openSettingsModal === 'function') return resolve(true);
      if (Date.now() - start > 10000) return reject(new Error('Settings did not initialise'));
      setTimeout(tick, 25);
    }; tick();
  })`);
  await tab.evaluate(`document.getElementById('btn-open-timecode-settings').focus(); document.getElementById('btn-open-timecode-settings').click(); window.__INVOKES.length = 0; document.getElementById('timecode-input-refresh').click()`);
  const measured = await tab.evaluate(`({
    refresh: window.__INVOKES.filter(item => item.cmd === 'list_timecode_inputs').length,
    focusInside: document.getElementById('settings-modal').contains(document.activeElement),
    tabs: document.querySelectorAll('.settings-nav-item[role="tab"]').length
  })`);
  assert.equal(measured.refresh, 1, 'Refresh works on the first card shortcut, without a category click');
  assert.equal(measured.focusInside, true, 'the settings shortcut transfers focus inside');
  assert.equal(measured.tabs, 13);
  await tab.evaluate(`document.getElementById('btn-close-settings').click()`);
  assert.equal(await tab.evaluate('document.activeElement.id'), 'btn-open-timecode-settings');
} finally {
  if (tab) await tab.close();
  browser.close();
}
console.log('WING_BROWSER_SUITE_OK');
