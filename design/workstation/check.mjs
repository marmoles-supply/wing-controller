#!/usr/bin/env node
// Compare a consumer against the shipped canonical page, not against the
// consumer's own screenshot. Runs without npm dependencies (Node 22+, Chrome).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ensureBrowser, openTab, navigate, setViewport } from '../conformance/collect.mjs';

export const ROLES = ['.wc-app', '.wc-toolbar', '.wc-card', '.wc-heading', '.wc-well:not(.wc-instrument)', '.wc-well.wc-instrument', '.wc-status'];
export const PROPERTIES = ['backgroundColor', 'color', 'fontFamily', 'fontSize', 'lineHeight',
  'borderTopColor', 'borderRightColor', 'borderTopWidth', 'borderRightWidth',
  'boxShadow', 'borderRadius', 'paddingTop', 'paddingRight'];
export const CONTROLS = {
  button: 'button, input[type="button"], input[type="submit"]',
  text: 'input:not([type]), input[type="text"], input[type="search"], input[type="number"]',
  textarea: 'textarea',
  checkbox: 'input[type="checkbox"]',
  radio: 'input[type="radio"]',
  range: 'input[type="range"]',
  select: 'select',
};
export function controlDifferences(references, actual) {
  const failures = [];
  const signature = value => JSON.stringify(PROPERTIES.map(property => value[property]));
  for (const [kind, measurements] of Object.entries(actual)) {
    const approved = new Set(references.flatMap(reference => reference[kind] || []).map(signature));
    for (const [index, measurement] of measurements.entries()) {
      if (!approved.has(signature(measurement)))
        failures.push(`${kind}[${index}] has a drawing absent from both canonical recipes: ${signature(measurement)}`);
    }
  }
  return failures;
}
export function differences(expected, actual) {
  const failures = [];
  for (const role of ROLES) {
    if (!actual[role]?.length) { failures.push(`Missing required block: ${role}`); continue; }
    // Each instance must match; a correct first card cannot hide a redesigned second.
    for (const [index, measured] of actual[role].entries()) {
      for (const property of PROPERTIES) {
        if (measured[property] !== expected[role][0][property])
          failures.push(`${role}[${index}].${property}: ${measured[property]} (canonical: ${expected[role][0][property]})`);
      }
    }
  }
  return failures;
}
export async function check(app, { port = 9339, out } = {}) {
  const browser = await ensureBrowser(port);
  if (!browser.alive) { const error = new Error(`COULD-NOT-RUN: ${browser.reason}`); error.exitCode = 3; throw error; }
  let reference, catalogue, consumer;
  const failures = [], measurements = [];
  const snapshot = `(() => {
    const result = {};
    for (const role of ${JSON.stringify(ROLES)}) {
      result[role] = [...document.querySelectorAll(role)].filter(e => !e.closest('[hidden]')).map(e => {
        const s = getComputedStyle(e);
        return Object.fromEntries(${JSON.stringify(PROPERTIES)}.map(p => [p, s[p]]));
      });
    }
    return result;
  })()`;
  const controls = `(() => {
    const result = {};
    for (const [kind, selector] of Object.entries(${JSON.stringify(CONTROLS)})) {
      result[kind] = [...document.querySelectorAll(selector)].map(element => {
        const style = getComputedStyle(element);
        return Object.fromEntries(${JSON.stringify(PROPERTIES)}.map(property => [property, style[property]]));
      });
    }
    return result;
  })()`;
  try {
    reference = await openTab(port);
    catalogue = await openTab(port);
    consumer = await openTab(port);
    await navigate(reference, pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'index.html')).href);
    await navigate(catalogue, pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'catalogue.html')).href);
    await navigate(consumer, /^[a-z]+:\/\//i.test(app) ? app : pathToFileURL(resolve(app)).href);
    for (const width of [420, 820, 1280]) {
      for (const theme of ['light', 'dark']) {
        for (const tab of [reference, catalogue, consumer]) {
          await setViewport(tab, { width, height: 900 });
          await tab.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
          // The dither is a canvas pattern painted from the theme; toggling the class without repainting leaves
          // the previous theme's pattern on every heading. The paired screenshots are evidence, and a light
          // screenshot carrying the dark pattern is not evidence of the light theme (measured 2026-10-20).
          await tab.evaluate(`(() => { document.body.classList.toggle('theme-dark', ${theme === 'dark'}); window.WingDither?.apply(); })()`);
          // A plain bounded wait, not `requestAnimationFrame`: a background tab's animation frames do not fire
          // (the same reason the production field-editing module could not use one), and this checker keeps three
          // tabs open. `WingDither.apply()` paints synchronously; the wait only lets the compositor settle.
          await tab.evaluate('new Promise(resolve => setTimeout(resolve, 60))');
        }
        const expected = await reference.evaluate(snapshot);
        const actual = await consumer.evaluate(snapshot);
        const found = differences(expected, actual);
        found.push(...controlDifferences(
          [await reference.evaluate(controls), await catalogue.evaluate(controls)],
          await consumer.evaluate(controls),
        ));
        const excess = await consumer.evaluate('Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth');
        if (excess > 1) found.push(`Horizontal overflow: ${excess}px`);
        failures.push(...found.map(message => `${width}/${theme}: ${message}`));
        measurements.push({ width, theme, failures: found.length });
        if (out) {
          mkdirSync(out, { recursive: true });
          for (const [name, tab] of [['canonical', reference], ['consumer', consumer]]) {
            const image = await tab.call('Page.captureScreenshot', { format: 'png' });
            writeFileSync(join(out, `${name}-${width}-${theme}.png`), Buffer.from(image.data, 'base64'));
          }
        }
      }
    }
    const result = { app, measurements, failures };
    if (out) writeFileSync(join(out, 'report.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (reference) await reference.close();
    if (catalogue) await catalogue.close();
    if (consumer) await consumer.close();
    browser.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node workstation/check.mjs <file-or-url> [screens-directory]');
  try {
    const result = await check(process.argv[2], { out: process.argv[3] });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.failures.length ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
