// Deliberate visual-reference refresh. Run without another browser suite/gate.
import { mkdirSync, writeFileSync } from 'node:fs';
import { ensureBrowser, openTab, navigate, setViewport } from '../design/conformance/collect.mjs';
const browser = await ensureBrowser(9341);
if (!browser.alive) { console.error(browser.reason); process.exit(3); }
let tab;
const out = new URL('../design/workstation/reference/', import.meta.url);
mkdirSync(out, { recursive: true });
try {
  tab = await openTab(9341);
  await setViewport(tab, { width: 1280, height: 1100 });
  for (const page of ['index', 'catalogue']) {
    await navigate(tab, new URL(`../design/workstation/${page}.html`, import.meta.url).href);
    for (const theme of ['light', 'dark']) {
      await tab.evaluate(`document.body.classList.toggle('theme-dark', ${theme === 'dark'}); window.WingDither?.apply(); document.fonts.ready`);
      // The theme observer redraws the canvas before the next frame.
      await tab.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
      for (const state of page === 'catalogue' ? ['catalogue', 'properties'] : ['workstation']) {
        if (state === 'properties') await tab.evaluate(`document.querySelector('[data-wc-dialog="sample-settings"]').click(); window.WingDither?.apply()`);
        const shot = await tab.call('Page.captureScreenshot', { format: 'png' });
        writeFileSync(new URL(`${state}-${theme}.png`, out), Buffer.from(shot.data, 'base64'));
        if (state === 'properties') await tab.evaluate(`document.getElementById('sample-settings').close()`);
      }
    }
  }
} finally {
  if (tab) await tab.close();
  browser.close();
}
console.log('Wrote six production-kit references in design/workstation/reference/.');
