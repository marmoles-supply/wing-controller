// Renders `design/specimen.html` and checks the specimen **on screen**, not in its source.
//
// The static check (`scripts/test-specimen.mjs`) proves a sample is declared for every token; it cannot prove the page
// draws one. That distinction is the whole lesson of the roadmap's §6: a check that greps the source passes while the
// screen shows nothing, and eight traps in one night were all "a check that looked at the wrong artefact". So this
// suite opens the page in the same headless Chrome the other browser suites use and asks the DOM:
//
//   * every token `tokens.json` declares has a **rendered** sample in **both** columns, and the value printed beside it
//     is the value that column actually resolves — a printed value that disagreed with the pixels would be the exact
//     lie the kit forbids;
//   * a token the CSS declares differently in the dark theme reads differently in the dark column, and a
//     theme-independent token (the phosphor, the meter ramp, the type scale) reads the same in both — that is the page
//     demonstrating §3 rather than asserting it;
//   * the raised bevel is light-then-dark and the sunken one is its reverse, checked against the `--line-*` tokens the
//     column resolved, in both themes (§11.1);
//   * every component word of `UI_SYSTEM.md` §8 is rendered;
//   * no control is `disabled` (§11.5), the scale knob and the mute button actually change something, the filter finds
//     one token, and nothing on the page was fetched over a network.
//
// Run: node scripts/test-specimen-browser.mjs   (needs Chrome on the debug port; exits 3 without it)
import assert from 'node:assert/strict';

import { readCanonicalCss } from './lib/design-tokens.mjs';
import { debuggerPages, navigateDesktopPage, openDesktopTab } from './lib/desktop-ui-harness.mjs';
import { SPECIMEN_HTML, readVocabulary, requiredSamples } from './lib/specimen.mjs';

const SPECIMEN_URL = `file://${SPECIMEN_HTML}`;

if ((await debuggerPages()) == null) {
  console.error('skipped: no Chrome listening on the debug port (see AGENTS.md)');
  process.exit(3);
}

const required = requiredSamples();
const vocabulary = readVocabulary();
const { light, dark, shared } = readCanonicalCss();
const tokenNames = [...required.tokens.keys()];
const mustDiffer = [...dark.entries()]
  .filter(([name, value]) => light.has(name) && light.get(name) !== value)
  .map(([name]) => name);
const mustMatch = [...shared.keys()];

/// `#rrggbb` as the browser spells it, so a token's declared value and a computed border colour can be compared.
/// A future value in another notation fails the assertion loudly rather than passing quietly.
const asRgb = (value) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(value).trim());
  if (!hex) return String(value).trim();
  const number = parseInt(hex[1], 16);
  return `rgb(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255})`;
};

const tab = await openDesktopTab();
try {
  await navigateDesktopPage({
    call: tab.call,
    evaluate: tab.evaluate,
    sleep: tab.sleep,
    url: SPECIMEN_URL,
    ready: 'document.body.dataset.specimenReady === "1"',
  });

  // 0. The page must have said it finished: the ready flag is set at the end of its own script, and an error the script
  // caught is reported here rather than looking like a page that rendered fine.
  assert.equal(
    await tab.evaluate('document.body.dataset.specimenError || ""'),
    '',
    'design/specimen.html reported an error while drawing itself',
  );

  // 1. Every declared token, rendered in both columns, with the value printed beside it live in that column and the
  //    visible name agreeing with the marker.
  const report = await tab.evaluate(`(() => {
    const names = ${JSON.stringify(tokenNames)};
    const out = { missing: [], unresolved: [], mismatchedLabel: [], staleValue: [], differ: [] };
    const value = (column, name) => getComputedStyle(column).getPropertyValue(name).trim();
    const lightColumn = document.querySelector('[data-theme="light"]');
    const darkColumn = document.querySelector('[data-theme="dark"]');
    for (const name of names) {
      const selector = '.sample[data-token="' + name + '"]';
      const inLight = lightColumn.querySelector(selector);
      const inDark = darkColumn.querySelector(selector);
      if (!inLight || !inDark) { out.missing.push(name); continue; }
      const printedLight = (inLight.querySelector('.val').textContent || '').trim();
      const printedDark = (inDark.querySelector('.val').textContent || '').trim();
      if (printedLight === '' || printedLight === 'unresolved in this theme') out.unresolved.push(name + ' (light)');
      if (printedDark === '' || printedDark === 'unresolved in this theme') out.unresolved.push(name + ' (dark)');
      if ((inLight.querySelector('.tok').textContent || '').trim() !== name) out.mismatchedLabel.push(name);
      if (printedLight !== value(lightColumn, name)) out.staleValue.push(name + ' (light)');
      if (printedDark !== value(darkColumn, name)) out.staleValue.push(name + ' (dark)');
      if (printedLight !== printedDark) out.differ.push(name);
    }
    return out;
  })()`);

  assert.deepEqual(report.missing, [], `the rendered specimen has no sample for: ${report.missing.join(', ')}`);
  assert.deepEqual(
    report.unresolved,
    [],
    `these samples printed no value in the theme beside them: ${report.unresolved.join(', ')}`,
  );
  assert.deepEqual(
    report.mismatchedLabel,
    [],
    `these samples' visible names disagree with their data-token marker: ${report.mismatchedLabel.join(', ')}`,
  );
  assert.deepEqual(
    report.staleValue,
    [],
    `these samples print a value other than the one the column resolves: ${report.staleValue.join(', ')}`,
  );

  // 2. §3's trap, measured: what the dark theme re-declares must read differently, and what it inherits must read the
  //    same in both columns. A page where both columns showed the light palette would pass a source-text check.
  const notDifferent = mustDiffer.filter((name) => !report.differ.includes(name));
  assert.deepEqual(
    notDifferent,
    [],
    `these tokens are re-declared by the dark theme in tokens.css but read the same in both columns of the specimen: ` +
    `${notDifferent.join(', ')} — the dark column has frozen to the light palette`,
  );
  const wronglyDifferent = mustMatch.filter((name) => report.differ.includes(name));
  assert.deepEqual(
    wronglyDifferent,
    [],
    `these tokens are theme-independent in tokens.css but read differently in the two columns: ` +
    `${wronglyDifferent.join(', ')} — the instrument must not change with the furniture`,
  );

  // 3. §11.1, on the rendered bevel: light before dark, or the same pair reversed, never a mix.
  const bevels = await tab.evaluate(`(() => {
    const out = [];
    for (const theme of ['light', 'dark']) {
      const column = document.querySelector('[data-theme="' + theme + '"]');
      const style = getComputedStyle(column);
      for (const key of ['raised', 'sunken']) {
        const sample = column.querySelector('.sample[data-bevel="' + key + '"]');
        const demo = sample && sample.querySelector('.bevel-demo');
        if (!demo) { out.push({ theme, key, missing: true }); continue; }
        const border = getComputedStyle(demo);
        out.push({
          theme, key,
          top: border.borderTopColor, left: border.borderLeftColor,
          bottom: border.borderBottomColor, right: border.borderRightColor,
          lineLight: style.getPropertyValue('--line-light').trim(),
          lineDark: style.getPropertyValue('--line-dark').trim(),
          printed: (sample.querySelector('.val').textContent || '').trim(),
        });
      }
    }
    return out;
  })()`);
  for (const theme of ['light', 'dark']) {
    const raised = bevels.find((entry) => entry.theme === theme && entry.key === 'raised');
    const sunken = bevels.find((entry) => entry.theme === theme && entry.key === 'sunken');
    assert.ok(raised && !raised.missing, `the ${theme} column must draw the raised bevel`);
    assert.ok(sunken && !sunken.missing, `the ${theme} column must draw the sunken bevel`);
    const lightSide = asRgb(raised.lineLight);
    const darkSide = asRgb(raised.lineDark);
    assert.deepEqual(
      [raised.top, raised.left, raised.bottom, raised.right],
      [lightSide, lightSide, darkSide, darkSide],
      `the raised bevel in the ${theme} column must be light before dark, got ` +
      `top ${raised.top} left ${raised.left} bottom ${raised.bottom} right ${raised.right}`,
    );
    assert.deepEqual(
      [sunken.top, sunken.left, sunken.bottom, sunken.right],
      [darkSide, darkSide, lightSide, lightSide],
      `the sunken bevel in the ${theme} column must be the raised pair reversed, got ` +
      `top ${sunken.top} left ${sunken.left} bottom ${sunken.bottom} right ${sunken.right}`,
    );
    for (const entry of [raised, sunken]) {
      assert.match(
        entry.printed,
        /--line-light .+ · bottom\/right --line-dark|--line-dark .+ · bottom\/right --line-light/,
        `the ${theme} ${entry.key} bevel must print the line token each edge resolved to, got "${entry.printed}"`,
      );
    }
  }

  // 4. Every component word of §8, rendered in both columns.
  const components = await tab.evaluate(`(() => {
    const words = ${JSON.stringify(vocabulary)};
    const out = { missing: [] };
    for (const theme of ['light', 'dark']) {
      for (const word of words) {
        if (!document.querySelector('[data-theme="' + theme + '"] [data-component="' + word + '"]')) {
          out.missing.push(word + ' (' + theme + ')');
        }
      }
    }
    return out;
  })()`);
  assert.deepEqual(components.missing, [], `the rendered specimen is missing components: ${components.missing.join(', ')}`);

  // 5. §11.5: a greyed control is a promise, and the specimen is the reference — so it must not carry one either.
  assert.equal(
    await tab.evaluate(`document.querySelectorAll('[disabled]').length`),
    0,
    'the specimen must not render a disabled control: a control works, or it is absent',
  );

  // 6. The kit's own rule: nothing was downloaded. Measured from the page's own resource timing, not from its source.
  const fetched = await tab.evaluate(
    `performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => !/^(file|data|blob):/.test(name))`,
  );
  assert.deepEqual(fetched, [], `the specimen fetched ${fetched.join(', ')}: it must render with no network access`);
  assert.ok(
    await tab.evaluate(`document.styleSheets.length > 0 && [...document.styleSheets].some((sheet) => (sheet.href || '').endsWith('tokens.css'))`),
    'the specimen must have loaded tokens.css, its only stylesheet',
  );

  // 7. Finding one token in a page of forty-six: the filter must isolate it and then restore every sample.
  const filtered = await tab.evaluate(`(() => {
    const input = document.querySelector('[data-control="sample-filter"]');
    const column = document.querySelector('[data-theme="light"]');
    const visible = () => [...column.querySelectorAll('.sample[data-token]')].filter((sample) => !sample.hidden).length;
    const all = visible();
    input.value = '--meter-ramp';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const one = visible();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { all, one, restored: visible() };
  })()`);
  assert.equal(filtered.all, tokenNames.length, `the light column must draw ${tokenNames.length} token samples, got ${filtered.all}`);
  assert.equal(filtered.one, 1, `filtering for --meter-ramp must leave one sample, got ${filtered.one}`);
  assert.equal(filtered.restored, filtered.all, 'clearing the filter must bring every sample back');

  // 8. The two controls the page offers work, or they would be the placeholders this project keeps finding.
  const knob = await tab.evaluate(`(() => {
    const input = document.querySelector('[data-control="meter-scale-knob"]');
    const sample = document.querySelector('[data-theme="light"] .sample[data-token="--font-base"]');
    const measured = () => parseFloat(sample.querySelector('[data-measure]').textContent);
    const before = measured();
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const after = measured();
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { before, after, restored: measured() };
  })()`);
  assert.ok(knob.after > knob.before, `raising --meter-scale must enlarge the type, got ${knob.before}px then ${knob.after}px`);
  assert.ok(Math.abs(knob.restored - knob.before) < 0.51, `the scale must return to where it was, got ${knob.restored}px`);

  const mute = await tab.evaluate(`(() => {
    const button = document.querySelector('[data-theme="light"] [data-control="mute-toggle"]');
    const before = button.textContent;
    button.click();
    const after = button.textContent;
    button.click();
    return { before, after, restored: button.textContent };
  })()`);
  assert.deepEqual(mute, { before: 'Mute', after: 'Muted', restored: 'Mute' }, 'the row button must do its job when pressed');
} finally {
  tab.closeTab();
}

console.log(`specimen rendered: ${tokenNames.length} tokens, ${vocabulary.length} components, both themes, no network`);

// The gate demands this line. A suite that could not run must not reach it.
console.log('WING_BROWSER_SUITE_OK');
