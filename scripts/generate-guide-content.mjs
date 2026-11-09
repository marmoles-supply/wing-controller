#!/usr/bin/env node
/**
 * Generates `desktop/ui/guide-content.js` from `docs/guide/NN-*.md`.
 *
 * The app has no bundler and cannot read `docs/` at runtime, so the complete guide travels inside
 * the window as a plain script that exposes `window.WING_GUIDE_SECTIONS`. This is the same pattern
 * the project already uses for `plugin_models.rs`: the Markdown is the reviewed source and
 * `scripts/test-desktop-guide-content.mjs` fails the gate when the generated file falls behind.
 *
 * Usage: node scripts/generate-guide-content.mjs [--check]
 *   --check  exit 1 instead of writing when the generated file would change
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guideDir = path.join(repoRoot, 'docs/guide');
const target = path.join(repoRoot, 'desktop/ui/guide-content.js');

/**
 * The published guide does not reveal how the application is built: no project file names, no
 * internal documents, no line numbers. The chapters are already written without citations (project
 * owner decision, 2026-09-22), and this stays as a safety net in case one slips back in: the content
 * contract also checks that nothing gets through.
 *
 * The files that ARE the operator's are kept: `macro_library.json`, an exported
 * `*.wingstation.json`, etc.
 */
const IMPLEMENTATION_REF =
  /\b(?:[A-Za-z0-9_./-]+\.(?:rs|html|mjs|js|md))(?::\d+(?:-\d+)?)?\b|\bwing_protocols(?:\.txt)?(?::\d+(?:-\d+)?)?\b|\bPLAN:\d+\b|\bMASTER_PLAN[A-Za-z0-9_.-]*/g;
const sanitize = (html) =>
  html
    // A parenthesis that only carried a citation goes whole: without it the sentence still reads fine.
    .replace(
      /[ \t]*\((?=[^()]*\b(?:[A-Za-z0-9_./-]+\.(?:rs|html|mjs|js|md)|wing_protocols|PLAN|MASTER_PLAN)\b)[^()]*\)/g,
      '',
    )
    .replace(IMPLEMENTATION_REF, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:)])/g, '$1');

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline Markdown: code spans first (their content is literal), then bold/italic/links. */
function inline(text) {
  const codes = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
}

const isTableSeparator = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

/** Markdown subset used by the guide: headings, tables, lists, quotes, fences, paragraphs. */
function renderMarkdown(markdown) {
  const lines = markdown.split('\n');
  const html = [];
  let paragraph = [];
  let list = null; // "ul" | "ol"
  let listItem = null; // text of the item being written (continuation lines join it)
  let fence = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${sanitize(inline(paragraph.join(' ')))}</p>`);
      paragraph = [];
    }
  };
  const flushItem = () => {
    if (listItem !== null) {
      html.push(`<li>${sanitize(inline(listItem.join(' ')))}</li>`);
      listItem = null;
    }
  };
  const flushList = () => {
    flushItem();
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = /^\s*```/.exec(line);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      if (fence) {
        html.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`);
        fence = null;
      } else {
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, heading[1].length + 1); // the window already has an <h1>
      html.push(`<h${level}>${sanitize(inline(heading[2].trim()))}</h${level}>`);
      continue;
    }
    // Tables: a header row followed by a separator row.
    if (line.includes('|') && isTableSeparator(lines[i + 1] || '')) {
      flushParagraph();
      flushList();
      const cells = (row) =>
        row
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((cell) => cell.trim());
      const header = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      i -= 1;
      html.push('<table><thead><tr>');
      header.forEach((cell) => html.push(`<th>${sanitize(inline(cell))}</th>`));
      html.push('</tr></thead><tbody>');
      rows.forEach((row) => {
        html.push('<tr>');
        row.forEach((cell) => html.push(`<td>${sanitize(inline(cell))}</td>`));
        html.push('</tr>');
      });
      html.push('</tbody></table>');
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const wanted = bullet ? 'ul' : 'ol';
      if (list !== wanted) {
        flushList();
        html.push(`<${wanted}>`);
        list = wanted;
      }
      flushItem();
      listItem = [(bullet || ordered)[1]];
      continue;
    }
    // Lazy continuation of the previous item: Markdown joins to it any line with content that does
    // not open another block (headings, tables and list items are already handled further up, so only
    // the quote is left here). Before, two spaces of indentation were required, and a line with just
    // one slipped through as a loose paragraph: it split a `**bold**` in two and the content contract
    // caught it in chapter 9.
    if (list && listItem && !/^\s*>/.test(line)) {
      listItem.push(line.trim());
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${sanitize(inline(quote[1]))}</blockquote>`);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return html.join('\n');
}

const titleOf = (markdown, fallback) => {
  const match = /^#\s+(.*)$/m.exec(markdown);
  if (!match) return fallback;
  return match[1].replace(/^\d+\s*·\s*/, '').trim();
};

const files = fs.existsSync(guideDir)
  ? fs.readdirSync(guideDir).filter((name) => /^\d\d-.*\.md$/.test(name)).sort()
  : [];
if (files.length === 0) {
  console.error(`No sections found in ${guideDir} (expected NN-*.md files).`);
  process.exit(1);
}

const sections = files.map((name) => {
  const markdown = fs.readFileSync(path.join(guideDir, name), 'utf8');
  const id = name.replace(/^\d\d-/, '').replace(/\.md$/, '');
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return { id, title: titleOf(markdown, id), words, html: renderMarkdown(markdown) };
});

const output = `// GENERATED by scripts/generate-guide-content.mjs from docs/guide/NN-*.md — do not edit by hand.
// scripts/test-desktop-guide-content.mjs fails the gate when this file falls behind the Markdown.
window.WING_GUIDE_SECTIONS = ${JSON.stringify(sections, null, 2)};
`;

const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
const changed = previous !== output;
if (process.argv.includes('--check')) {
  if (changed) {
    console.error('desktop/ui/guide-content.js is out of date: run node scripts/generate-guide-content.mjs');
    process.exit(1);
  }
  console.log(`guide content up to date (${sections.length} sections, ${sections.reduce((n, s) => n + s.words, 0)} words)`);
  process.exit(0);
}

fs.writeFileSync(target, output, 'utf8');
console.log(
  `${changed ? 'wrote' : 'unchanged'} desktop/ui/guide-content.js — ${sections.length} sections, ` +
    `${sections.reduce((n, s) => n + s.words, 0)} words`,
);
